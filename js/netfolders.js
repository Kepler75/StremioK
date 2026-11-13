/* Network folders: folders a NAS or computer shares over WebDAV, in the Local tab beside USB
   drives. Global namespace: NetFolders
   - Kept here: each folder's address, user name, password and a certificate you trusted
     (Settings › Content › Network folders). Nothing else knows the password: the service is
     handed it with each request (a header, never in a link), and the player gets it in the
     file's link only as it starts (playUrl).
   - Listed through StremioK's service (/dav/list, /dav/walk, /dav/sub): no CORS rules to stop
     it, and an https certificate the folder made itself can be trusted (that one only).
   - As a USB drive otherwise (LocalMedia): a folder is a drive { label, root: 'dav:<id>', dav },
     its files matched, indexed and offered as sources ("On your network folder"). */
var NetFolders = (function () {
    'use strict';

    var KEY = 'stremiok.netfolders', MAX = 8;
    var _listeners = [];
    function onChange(fn) { _listeners.push(fn); }
    function emit() { _listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }

    // A folder: WebDAV (http(s)://…/, the kind unsaid) or a Windows / NAS share (kind 'smb',
    // smb://host/share/: through StremioK's service, its files played through it too).
    // Or a DLNA media server (kind 'dlna': known by dlna://<its id>/, asked at its control link,
    // f.control; no sign-in).
    function isSmb(f) { return !!f && f.kind === 'smb'; }
    function isDlna(f) { return !!f && f.kind === 'dlna'; }
    function valid(f) {
        if (!f || typeof f.id !== 'string' || !/^[a-z0-9]{4,16}$/.test(f.id) || typeof f.url !== 'string') { return false; }
        if (isDlna(f)) { return /^dlna:\/\/[a-z0-9]{4,40}\/$/.test(f.url) && typeof f.control === 'string' && /^https?:\/\/[^\s@]+$/i.test(f.control); }
        return isSmb(f) ? /^smb:\/\/[^\/\s@]+\/[^\/\\?#]+\/$/i.test(f.url) : /^https?:\/\/[^\s@]+\/$/i.test(f.url);
    }
    function all() { return U.listOf(U.store.get(KEY, []), MAX, valid); }
    function save(list) { U.store.set(KEY, list); emit(); }
    function folders() { return all().filter(function (f) { return !f.off; }); }
    function get(id) { return all().filter(function (f) { return f.id === id; })[0] || null; }
    function driveOf(f) { return { label: f.name, root: 'dav:' + f.id, dav: f }; }
    function drives() { return folders().map(driveOf); }

    // A folder's address as kept: http(s), a real host, no user:password@, no ?query or #, ending
    // in "/". addressProblem: why one typed can't be used, else null.
    function addressProblem(v) {
        var s = ('' + (v || '')).trim();
        var p = U.urlProblem(s);
        if (p) { return p; }
        if (/[?#]/.test(s)) { return 'The folder’s address, without ? or #'; }
        return null;
    }
    function baseOf(v) { return ('' + v).trim().replace(/\/*$/, '/'); }
    // A name to show: its last folder, and its server ("media on 192.168.0.50").
    function nameOf(url) {
        var sm = /^smb:\/\/([^\/:]+)(?::\d+)?\/([^\/]+)\/$/i.exec(url || '');
        if (sm) { return U.t('{folder} on {host}', { folder: sm[2], host: sm[1] }); }
        var m = /^https?:\/\/([^\/:]+)(?::\d+)?(\/.*)?$/i.exec(url) || [], segs = (m[2] || '/').split('/').filter(Boolean), last = segs.length ? segs[segs.length - 1] : '';
        try { last = decodeURIComponent(last); } catch (e) {}
        return last ? U.t('{folder} on {host}', { folder: last, host: m[1] || url }) : (m[1] || url);
    }

    // ---- through StremioK's service ----
    function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
    function headers(f) {
        var h = {};
        if (f.user || f.pass) { h['X-Dav-Auth'] = b64((f.user || '') + ':' + (f.pass || '')); }
        if (f.cert) { h['X-Dav-Cert'] = f.cert; }
        return h;
    }
    function query(f, rel) { return '?u=' + encodeURIComponent(isDlna(f) ? 'dlna:' + f.control : f.url) + (rel != null ? '&p=' + encodeURIComponent(rel) : ''); }
    var WHY = {
        auth: U.t('It refused the user name or password'),
        untrusted: U.t('Its certificate isn’t from a known authority'),
        unreachable: U.t('Couldn’t reach it'),
        notdav: U.t('Not a WebDAV folder'),
        missing: U.t('No such folder there'),
        elsewhere: U.t('It sent StremioK to another address (not followed)'),
        toolarge: U.t('Its answer was too large'),
        busy: U.t('Another folder is being indexed: try again when it’s done'),
        smb3: U.t('It only speaks SMB 3 (StremioK speaks SMB 2)'),
        other: U.t('It failed')
    };
    // The service's answer, or what went wrong: an Error with why (and, untrusted, the
    // certificate: cert, fp, name, until).
    function ask(f, path, rel, timeout, max, cancel) {
        if (typeof LocalMedia === 'undefined' || !LocalMedia.askService) { return Promise.reject(new Error(U.t('no StremioK service here'))); }
        return LocalMedia.askService((isDlna(f) ? '/dlna/' : isSmb(f) ? '/smb/' : '/dav/') + path + query(f, rel), timeout, max, cancel, headers(f)).then(function (r) {
            if (!r || typeof r !== 'object') { throw new Error(U.t('No answer from StremioK’s service')); }
            if (r.why) {
                var e = new Error((WHY[r.why] || U.t('It failed')) + (r.message && r.why !== 'auth' && r.why !== 'busy' ? ' (' + r.message + ')' : ''));
                e.why = r.why;
                if (r.why === 'untrusted' && typeof r.cert === 'string') { e.cert = r.cert; e.fp = '' + (r.fp || ''); e.name = '' + (r.name || ''); e.until = '' + (r.until || ''); }
                throw e;
            }
            return r;
        });
    }
    // A file's link (its identity: a source's, Continue Watching's), without the sign-in.
    function fileUrl(f, rel) { return f.url + ('' + rel).split('/').map(encodeURIComponent).join('/'); }
    function entryOf(f, rel, x) {
        var name = '' + x.name, r = rel ? rel + '/' + name : name;
        return { name: name, dir: !!x.dir, size: +x.size || 0, rel: r, abs: fileUrl(f, r), uri: fileUrl(f, r) };
    }
    // A folder's listing, as LocalMedia.list gives a drive's: { entries }.
    function list(f, rel) {
        rel = ('' + (rel || '')).replace(/^\/+|\/+$/g, '');
        return ask(f, 'list', rel, 30000, 4 * 1048576).then(function (r) {
            noteDigest(f, !!r.digest);
            return { entries: U.listOf(r.entries, 3000, function (x) { return x && typeof x.name === 'string' && x.name && x.name.indexOf('/') === -1; }).map(function (x) { return entryOf(f, rel, x); }) };
        });
    }
    // Every video and subtitle file under it (the index): { files: [{ p, size }], truncated }.
    function walk(f, cancel) {
        return ask(f, 'walk', null, 150000, 8 * 1048576, cancel).then(function (r) {
            return { files: U.listOf(r.files, 20000, function (x) { return x && typeof x.p === 'string'; }), truncated: !!r.truncated };
        });
    }
    function subPath(f, rel) { return (isDlna(f) ? '/dlna/sub' : isSmb(f) ? '/smb/sub' : '/dav/sub') + query(f, rel); }
    // A folder whose server signs in with Digest (the service found it out): kept with it, so its
    // files play through the service (a ticket: the TV's player sends Basic only).
    function noteDigest(f, digest) {
        if (!f || f.id === 'probe' || !!f.digest === digest) { if (f && f.id === 'probe') { f.digest = digest; } return; }
        save(all().map(function (x) { if (x.id !== f.id) { return x; } var g = Object.assign({}, x); if (digest) { g.digest = true; } else { delete g.digest; } return g; }));
    }
    // The service's ticket for a folder whose files play through it (Digest), asked as a file
    // starts (prepare) and kept TICKET_MS (the service keeps it hours, while used).
    var TICKET_MS = 3600000, _tickets = {};
    function needsTicket(f) { return !!(f && (f.digest || isSmb(f) || isDlna(f))); }   // (Digest, or a share: the TV's player can do neither)
    function prepare(url) {
        var f = folderOfUrl(url);
        if (!needsTicket(f)) { return null; }
        var t = _tickets[f.id];
        if (t && Date.now() - t.at < TICKET_MS) { return Promise.resolve(t.ticket); }
        return ask(f, 'open', null, 8000, 4096).then(function (r) {
            if (!r || !/^[0-9a-f]{32}$/.test(r.ticket || '')) { throw new Error('no ticket'); }
            _tickets[f.id] = { ticket: r.ticket, at: Date.now() };
            return r.ticket;
        });
    }
    // What's in a video there, from its header (the service's /dav/mi: see mediaInfo).
    function mediaInfo(f, rel, cancel) { return ask(f, 'mi', rel, 25000, 262144, cancel); }
    // A media server's id as a folder's name: its UDN (or control link), hashed short.
    function dlnaId(s) { var h = 5381; s = '' + s; for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; } return 'm' + h.toString(36) + s.length.toString(36); }
    // The media servers on the home network (asked now, a few seconds): [{ id, name, control }],
    // those already added left out.
    function discover() {
        if (typeof LocalMedia === 'undefined' || !LocalMedia.askService) { return Promise.reject(new Error(U.t('no StremioK service here'))); }
        return LocalMedia.askService('/dlna/discover', 20000, 262144).then(function (r) {
            var have = all().filter(isDlna).map(function (f) { return f.control; });
            return U.listOf(r && r.servers, 32, function (x) { return x && typeof x.control === 'string' && /^https?:\/\//i.test(x.control) && typeof x.name === 'string'; })
                .filter(function (x) { return have.indexOf(x.control) === -1; });
        });
    }
    // A server's shares, to pick one (smb://host/): [{ name, remark }].
    function shares(host, user, pass) {
        var f = { id: 'probe', kind: 'smb', url: 'smb://' + host + '/', user: '' + (user || ''), pass: '' + (pass || '') };
        return ask(f, 'shares', null, 30000, 262144).then(function (r) { return U.listOf(r.shares, 200, function (x) { return x && typeof x.name === 'string' && x.name; }); });
    }
    // A server's address as typed for a share: a host (name or address, a port after it), or null.
    function smbHostOf(v) {
        var m = /^(?:smb:\/\/|\\\\)?([A-Za-z0-9._-]{1,253})(?::(\d{1,5}))?[\/\\]*$/.exec(('' + (v || '')).trim());
        return m ? m[1] + (m[2] ? ':' + m[2] : '') : null;
    }

    // ---- links ----
    // The folder a link is in (its address a prefix of the link), or null.
    function folderOfUrl(url) {
        url = '' + (url || '');
        var l = all();
        for (var i = 0; i < l.length; i++) { if (url.indexOf(l[i].url) === 0 && url.length > l[i].url.length) { return l[i]; } }
        return null;
    }
    function relOf(f, url) {
        return ('' + url).slice(f.url.length).split('/').map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } }).join('/');
    }
    // The link the player opens: the file's, with the folder's user name and password in it
    // (http://user:password@host/…, which the TV's player sends as its sign-in). Not a folder's
    // file: null.
    function playUrl(url) {
        var f = folderOfUrl(url);
        if (!f) { return null; }
        var t = needsTicket(f) ? _tickets[f.id] : null;
        if (t && typeof LocalMedia !== 'undefined' && LocalMedia.serviceUrl) { return LocalMedia.serviceUrl('/net/' + t.ticket + '/f?p=' + encodeURIComponent(relOf(f, url))); }   // (Digest: through the service)
        if (isSmb(f) || isDlna(f)) { return null; }   // (a share's or a media server's file: through the service, its ticket asked first)
        if (!f.user && !f.pass) { return '' + url; }
        return ('' + url).replace(/^(https?:\/\/)/i, '$1' + encodeURIComponent(f.user || '') + ':' + encodeURIComponent(f.pass || '') + '@');
    }

    // ---- adding, on and off ----
    function newId() { var s = ''; while (s.length < 8) { s += Math.floor(Math.random() * 36).toString(36); } return s; }
    // Ask the folder (its top's listing) with this sign-in: resolves the folder to keep, or
    // rejects as ask does (untrusted: the certificate to ask about, then probe again with it).
    function probe(url, user, pass, cert, kind, server) {
        var f = { id: 'probe', url: baseOf(url), user: '' + (user || ''), pass: '' + (pass || ''), cert: cert || '' };
        if (kind === 'smb') { f.kind = 'smb'; f.cert = ''; }
        if (kind === 'dlna') { f = { id: 'probe', kind: 'dlna', url: 'dlna://' + dlnaId(server.id || server.control) + '/', control: server.control, user: '', pass: '', cert: '' }; }
        return list(f, '').then(function (r) { return { url: f.url, user: f.user, pass: f.pass, cert: f.cert, name: kind === 'dlna' ? ('' + (server.name || 'DLNA')).slice(0, 80) : nameOf(f.url), entries: r.entries.length, digest: !!f.digest, kind: f.kind, control: f.control }; });
    }
    // Keep a folder probe() found (the same address again: replaced).
    function add(p) {
        var l = all().filter(function (f) { return f.url !== p.url; });
        if (l.length >= MAX) { throw new Error(U.t('Up to {n} network folders', { n: MAX })); }
        var f = { id: newId(), name: p.name || nameOf(p.url), url: p.url, user: p.user || '', pass: p.pass || '', cert: p.cert || '', at: Date.now() };
        if (p.digest) { f.digest = true; }
        if (p.kind === 'smb') { f.kind = 'smb'; }
        if (p.kind === 'dlna') { f.kind = 'dlna'; f.control = p.control; }
        l.push(f);
        save(l);
        U.log('local', 'Network folder “' + f.name + '” added' + (f.cert ? ' (its certificate trusted)' : ''));
        return f;
    }
    function setOn(id, on) {
        save(all().map(function (f) {
            if (f.id !== id) { return f; }
            var g = Object.assign({}, f);
            if (on) { delete g.off; } else { g.off = true; }
            return g;
        }));
    }
    function remove(id) {
        var f = get(id);
        save(all().filter(function (x) { return x.id !== id; }));
        if (f && typeof LocalMedia !== 'undefined' && LocalMedia.forgetDrive) { LocalMedia.forgetDrive('dav:' + id); }
    }

    return {
        all: all, folders: folders, get: get, drives: drives, driveOf: driveOf, onChange: onChange,
        addressProblem: addressProblem, nameOf: nameOf, probe: probe, add: add, setOn: setOn, remove: remove,
        list: list, walk: walk, headers: headers, subPath: subPath, mediaInfo: mediaInfo, prepare: prepare, shares: shares, smbHostOf: smbHostOf, isSmb: isSmb, isDlna: isDlna, discover: discover, fileUrl: fileUrl, folderOfUrl: folderOfUrl, relOf: relOf, playUrl: playUrl
    };
})();
