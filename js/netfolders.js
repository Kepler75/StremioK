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

    function valid(f) { return !!f && typeof f.id === 'string' && /^[a-z0-9]{4,16}$/.test(f.id) && typeof f.url === 'string' && /^https?:\/\/[^\s@]+\/$/i.test(f.url); }
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
    function query(f, rel) { return '?u=' + encodeURIComponent(f.url) + (rel != null ? '&p=' + encodeURIComponent(rel) : ''); }
    var WHY = {
        auth: U.t('It refused the user name or password'),
        untrusted: U.t('Its certificate isn’t from a known authority'),
        unreachable: U.t('Couldn’t reach it'),
        notdav: U.t('Not a WebDAV folder'),
        missing: U.t('No such folder there'),
        elsewhere: U.t('It sent StremioK to another address (not followed)'),
        toolarge: U.t('Its answer was too large'),
        busy: U.t('Another folder is being indexed: try again when it’s done')
    };
    // The service's answer, or what went wrong: an Error with why (and, untrusted, the
    // certificate: cert, fp, name, until).
    function ask(f, path, rel, timeout, max, cancel) {
        if (typeof LocalMedia === 'undefined' || !LocalMedia.askService) { return Promise.reject(new Error(U.t('no StremioK service here'))); }
        return LocalMedia.askService('/dav/' + path + query(f, rel), timeout, max, cancel, headers(f)).then(function (r) {
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
            return { entries: U.listOf(r.entries, 3000, function (x) { return x && typeof x.name === 'string' && x.name && x.name.indexOf('/') === -1; }).map(function (x) { return entryOf(f, rel, x); }) };
        });
    }
    // Every video and subtitle file under it (the index): { files: [{ p, size }], truncated }.
    function walk(f, cancel) {
        return ask(f, 'walk', null, 150000, 8 * 1048576, cancel).then(function (r) {
            return { files: U.listOf(r.files, 20000, function (x) { return x && typeof x.p === 'string'; }), truncated: !!r.truncated };
        });
    }
    function subPath(f, rel) { return '/dav/sub' + query(f, rel); }

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
        if (!f.user && !f.pass) { return '' + url; }
        return ('' + url).replace(/^(https?:\/\/)/i, '$1' + encodeURIComponent(f.user || '') + ':' + encodeURIComponent(f.pass || '') + '@');
    }

    // ---- adding, on and off ----
    function newId() { var s = ''; while (s.length < 8) { s += Math.floor(Math.random() * 36).toString(36); } return s; }
    // Ask the folder (its top's listing) with this sign-in: resolves the folder to keep, or
    // rejects as ask does (untrusted: the certificate to ask about, then probe again with it).
    function probe(url, user, pass, cert) {
        var f = { id: 'probe', url: baseOf(url), user: '' + (user || ''), pass: '' + (pass || ''), cert: cert || '' };
        return list(f, '').then(function (r) { return { url: f.url, user: f.user, pass: f.pass, cert: f.cert, name: nameOf(f.url), entries: r.entries.length }; });
    }
    // Keep a folder probe() found (the same address again: replaced).
    function add(p) {
        var l = all().filter(function (f) { return f.url !== p.url; });
        if (l.length >= MAX) { throw new Error(U.t('Up to {n} network folders', { n: MAX })); }
        var f = { id: newId(), name: p.name || nameOf(p.url), url: p.url, user: p.user || '', pass: p.pass || '', cert: p.cert || '', at: Date.now() };
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
        list: list, walk: walk, headers: headers, subPath: subPath, fileUrl: fileUrl, folderOfUrl: folderOfUrl, relOf: relOf, playUrl: playUrl
    };
})();
