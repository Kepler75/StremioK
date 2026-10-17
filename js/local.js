/* Local media: the videos on a USB drive plugged into the TV. Global namespace: LocalMedia
   - Home › Local browses a drive by folder (hidden files left out unless asked).
   - Each video is matched to a movie or an episode by its name (and its folders'): your search
     addons asked once per title, the answer kept. A matched file is a source on its title's page
     ("On your USB drive"), with progress, watched marks, Continue Watching and Trakt as that
     title's; one that isn't plays as a plain file (its progress and Continue Watching by file).
   - Nothing is read at launch: drives are read when the Local tab (or Settings › USB drive)
     opens, and a drive is indexed (StremioK's service walks it: which videos and subtitle
     files it has, so title pages know what's on it) only when you ask; the last index is kept.
   - Subtitle files next to a video (Film.srt, Film.en.srt…) are its subtitles, read through the
     service; with a match, subtitle addons are asked with the file's OpenSubtitles hash too. */
var LocalMedia = (function () {
    'use strict';

    var VIDEO_RE = /\.(mkv|mp4|m4v|avi|ts|m2ts|mts|mov|webm|wmv|mpe?g|flv|3gp|ogv|vob)$/i;
    var SUB_RE = /\.(srt|vtt|ass|ssa)$/i;
    // Hidden: names starting with "." (a Mac leaves ._… copies, .DS_Store, .Spotlight-V100,
    // .fseventsd, .Trashes on a drive) and Windows' recycle bin and system folder.
    var HIDDEN_RE = /^(\.|\$RECYCLE\.BIN$|System Volume Information$)/i;
    var MATCH_KEY = 'stremiok.local.matches';   // parsed title -> { id, type, name, poster, year } | { none, at }
    var FIX_KEY = 'stremiok.local.fixes';       // a file (or a show) -> your own match | { none }
    var INDEX_KEY = 'stremiok.local.index.';    // + a drive's root (the TV's database): { label, at, files, subs }, one per drive
    var INDEXES_KEY = 'stremiok.local.indexes'; // the drives with one kept: root -> when (the INDEXES_MAX latest)
    var INDEXES_MAX = 4;
    var HIDDEN_KEY = 'stremiok.local.hidden';
    var MATCHES_MAX = 3000, FIXES_MAX = 2000, NONE_RETRY_MS = 7 * 86400000;
    var LIST_MAX = 3000, FS_WAIT = 10000, WALK_WAIT = 150000;
    var CLIENT_WALK_DIRS = 400, CLIENT_WALK_DEPTH = 8;
    var MARK = {};   // a local source carries this (an addon's JSON can't): see isLocalStream

    function isVideo(n) { return VIDEO_RE.test(n || ''); }
    function isSub(n) { return SUB_RE.test(n || ''); }
    function isHidden(n) { return HIDDEN_RE.test(n || ''); }
    function showHidden() { return U.store.get(HIDDEN_KEY, false) === true; }
    function setShowHidden(on) { U.store.set(HIDDEN_KEY, !!on); }
    function errText(e) { return (e && (e.name || e.message)) ? ((e.name || '') + (e.message ? ': ' + e.message : '')) : ('' + e); }
    function within(p, ms, what) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error(what + ': no answer in ' + Math.round(ms / 1000) + ' s')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function nameOf(p) { return ('' + p).split('/').pop(); }
    function dirOf(p) { var i = ('' + p).lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); }
    function stem(n) { return ('' + n).replace(/\.[^.]+$/, ''); }
    function humanSize(n) {
        if (!n) { return ''; }
        return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    }
    function service() { return (typeof YTPlay !== 'undefined') ? 'http://localhost:' + YTPlay.port : ''; }
    // The service answers its USB endpoints only with the token it keeps in StremioK's private
    // folder (see service/index.js, fsAllowed): read there, sent with each request (re-read once
    // if refused: a reinstall makes a new one).
    var TOKEN_FILE = 'stremiok-service-token', _token = '', _tokenP = null;
    function readToken(fresh) {
        if (_token && !fresh) { return Promise.resolve(_token); }
        if (_tokenP) { return _tokenP; }
        var f = fsApi();
        if (!f) { return Promise.resolve(''); }
        _tokenP = within(new Promise(function (resolve) {
            try {
                f.resolve('wgt-private/' + TOKEN_FILE, function (file) {
                    try { file.readAsText(function (t) { resolve('' + t); }, function () { resolve(''); }, 'UTF-8'); }
                    catch (e) {
                        try { file.openStream('r', function (st) { var t = st.read(128); st.close(); resolve('' + t); }, function () { resolve(''); }, 'UTF-8'); }
                        catch (e2) { resolve(''); }
                    }
                }, function () { resolve(''); }, 'r');
            } catch (e) { resolve(''); }
        }), FS_WAIT, 'token').then(function (t) {
            t = t.trim();
            _token = /^[0-9a-f]{48}$/.test(t) ? t : '';
            _tokenP = null;
            return _token;
        }, function () { _tokenP = null; return ''; });
        return _tokenP;
    }
    function svcUrl(path, token) { return service() + path + (path.indexOf('?') === -1 ? '?' : '&') + 'token=' + (token || ''); }
    // Where the token can't be read (Tizen 6: the service keeps it in a folder of its own), the
    // service takes StremioK's X-StremioK header instead (a web page can't send one).
    var NO_TOKEN = { 'X-StremioK': '1' };
    function svcHeaders(token) { return token ? null : NO_TOKEN; }
    // The service running and its token read (for the subtitle files' links): resolves either way.
    function ready() {
        if (!service()) { return Promise.resolve(false); }
        return YTPlay.ensureService().then(function () { return readToken(); }).then(function () { return true; }, function () { return false; });   // (no token: its header)
    }
    function askService(path, timeout, max, cancel) {
        if (!service()) { return Promise.reject(new Error('no StremioK service here')); }
        return YTPlay.ensureService().then(function () { return readToken(); }).then(function (t) {
            return U.getJSON(svcUrl(path, t), timeout, max, cancel, svcHeaders(t)).then(null, function (e) {
                if (!/HTTP 403\b/.test((e && e.message) || '')) { throw e; }
                return readToken(true).then(function (t2) {
                    if (!t2 || t2 === t) { throw e; }
                    return U.getJSON(svcUrl(path, t2), timeout, max, cancel, svcHeaders(t2));
                });
            });
        });
    }

    // ---------- drives ----------
    function fsApi() { return (typeof tizen !== 'undefined' && tizen && tizen.filesystem) ? tizen.filesystem : null; }
    function available() { return !!fsApi(); }
    function uriOf(file) { try { return file.toURI() || ''; } catch (e) { return ''; } }
    // the real path in a file:// URI (percent-escapes undone when it has them)
    function realPath(uri) {
        var p = ('' + (uri || '')).replace(/^file:\/\//i, '');
        if (/%[0-9a-f]{2}/i.test(p) && !/ /.test(p)) { try { p = decodeURI(p); } catch (e) {} }
        return p;
    }
    function fileUri(abs) { return 'file://' + abs; }
    function resolveP(vpath) {
        var f = fsApi();
        U.crumb('usb: open ' + vpath);   // (the TV's own file calls: the last one, after an unexpected close)
        return within(new Promise(function (resolve, reject) {
            try { f.resolve(vpath, resolve, function (e) { reject(new Error('resolve: ' + errText(e))); }, 'r'); }
            catch (e) { reject(new Error('resolve: ' + errText(e))); }
        }), FS_WAIT, 'resolve');
    }
    var _drives = null, _drivesP = null, _listeners = [];
    function onChange(fn) { _listeners.push(fn); }
    function emit(what) { _listeners.slice().forEach(function (fn) { try { fn(what); } catch (e) {} }); }
    // The mounted USB drives: [{ label (removable_sda1), root (/opt/media/USBDriveA1) }]
    function refreshDrives() {
        var f = fsApi();
        if (!f) { _drives = []; return Promise.resolve([]); }
        if (_drivesP) { return _drivesP; }
        U.crumb('usb: drives');
        _drivesP = usbStorages().then(function (usb) {
            _present = usb.length;
            return Promise.all(usb.map(function (s) {
                return resolveP(s.label).then(function (d) {
                    var root = realPath(uriOf(d));
                    return root ? { label: s.label, root: root.replace(/\/+$/, '') } : null;
                }, function (e) { U.log('local', s.label + ': ' + e.message); return null; });
            }));
        }).then(function (ds) {
            _drives = ds.filter(Boolean);
            _drivesP = null;
            return _drives;
        }, function (e) {
            U.log('local', 'USB drives: ' + e.message);
            _drives = []; _drivesP = null;
            return _drives;
        });
        return _drivesP;
    }
    function drives() { return _drives ? Promise.resolve(_drives) : refreshDrives(); }
    function knownDrives() { return _drives || []; }
    function hasDrive() { return !!(_drives && _drives.length); }
    function driveOf(abs) {
        var ds = knownDrives();
        for (var i = 0; i < ds.length; i++) { if (abs === ds[i].root || abs.indexOf(ds[i].root + '/') === 0) { return ds[i]; } }
        return null;
    }

    // At launch only whether a USB drive is plugged in (the TV's list of storages: no drive is
    // opened), so the Local tab shows only then; plugging one in or out updates it.
    // On demand (the Local tab, Settings › USB drive): the drives read, each one's saved index
    // loaded.
    var _ensured = null, _read = false, _listening = false, _present = 0;
    function usbStorages() {
        var f = fsApi();
        return within(new Promise(function (resolve, reject) {
            try { f.listStorages(function (l) { resolve(l || []); }, function (e) { reject(new Error(errText(e))); }); }
            catch (e) { reject(new Error(errText(e))); }
        }), FS_WAIT, 'listStorages').then(function (list) {
            return list.filter(function (s) { return (/^removable/i.test(s.label || '') || s.type === 'EXTERNAL') && s.state === 'MOUNTED'; });
        });
    }
    function watch() {
        if (!fsApi()) { return; }
        U.crumb('usb: plugged in?');
        usbStorages().then(function (l) { _present = l.length; listen(); if (_present) { emit('drives'); } }, function () { listen(); });
    }
    function present() { return _present > 0; }
    function ensure() {
        if (!fsApi()) { return Promise.resolve([]); }
        if (_ensured) { return _ensured; }
        _ensured = refreshDrives().then(function (ds) {
            listen();
            if (service() && ds.length) { YTPlay.ensureService().then(function () { return readToken(); }).then(null, function () {}); }   // (for a big file's link: openUrl)
            return Promise.all(ds.map(loadIndex)).then(function () { _read = true; emit('drives'); return ds; });
        });
        return _ensured;
    }
    function isRead() { return _read; }
    function listen() {
        if (_listening) { return; }
        _listening = true;
        try {
            fsApi().addStorageStateChangeListener(function (s) {
                if (!_read) {   // (drives not opened yet: only whether one is plugged in)
                    usbStorages().then(function (l) { _present = l.length; emit('drives'); }, function () {});
                    return;
                }
                _drives = null;
                refreshDrives().then(function (ds) {
                    Object.keys(_index).forEach(function (root) { if (!ds.some(function (d) { return d.root === root; })) { delete _index[root]; } });
                    return Promise.all(ds.map(loadIndex));
                }).then(function () {
                    rebuild();
                    emit('drives');
                    U.toast(s.state === 'MOUNTED' ? 'USB drive connected' : 'USB drive removed', 2500);
                });
            }, function () {});
        } catch (e) {}
    }

    // ---------- a folder ----------
    // One entry of the TV's own listing. On Tizen 3 an entry's details (isDirectory, fileSize)
    // are looked up when first read, and for one it can't look at that throws ("Cannot read
    // property 'isFile' of undefined"): read one by one, such an entry kept (bad), worked
    // out from its name.
    function fileEntry(file, drive, rel) {
        var e = { name: '', dir: false, size: 0, rel: '', abs: '', uri: '' };
        try { e.name = '' + file.name; } catch (x) { try { e.name = nameOf(file.fullPath); } catch (y) { e.name = '?'; } }
        try { e.dir = !!file.isDirectory; } catch (x) { e.bad = errText(x); }
        if (!e.bad && !e.dir) { try { e.size = file.fileSize || 0; } catch (x) { e.bad = errText(x); } }
        if (e.bad) { e.dir = !/\.[A-Za-z0-9]{2,4}$/.test(e.name); }
        e.rel = rel ? rel + '/' + e.name : e.name;
        e.abs = drive.root + '/' + e.rel;
        e.uri = (!e.bad && uriOf(file)) || fileUri(e.abs);
        return e;
    }
    function sortEntries(list) {
        return list.sort(function (a, b) {
            if (a.dir !== b.dir) { return a.dir ? -1 : 1; }
            var x = a.name.toLowerCase(), y = b.name.toLowerCase();
            return x < y ? -1 : x > y ? 1 : 0;
        });
    }
    // A folder of a drive (rel '' its top): { entries: [{ name, dir, size, rel, abs, uri, bad? }],
    // via? 'service' } — the TV's own listing, else (Tizen 3 failing a whole folder) the service's.
    function list(drive, rel) {
        rel = (rel || '').replace(/^\/+|\/+$/g, '');
        var vpath = drive.label + (rel ? '/' + rel : ''), abs = drive.root + (rel ? '/' + rel : '');
        function viaService(why) {
            U.crumb('usb: list ' + vpath + ' (service)');
            return askService('/fslist?path=' + encodeURIComponent(abs), 15000, 2 * 1024 * 1024).then(function (r) {
                var entries = (r && r.entries || []).slice(0, LIST_MAX).map(function (x) {
                    var er = rel ? rel + '/' + x.name : '' + x.name;
                    return { name: '' + x.name, dir: !!x.dir, size: +x.size || 0, rel: er, abs: drive.root + '/' + er, uri: fileUri(drive.root + '/' + er) };
                });
                return { entries: sortEntries(entries), via: 'service', why: why };
            }, function (e) { throw new Error(why + '; ' + (e && e.message ? e.message : e)); });
        }
        if (!fsApi()) { return viaService('no Filesystem API'); }
        return resolveP(vpath).then(function (d) {
            return within(new Promise(function (resolve, reject) {
                // (Tizen 3 can throw from inside its own callback, where no catch here sees it:
                // the page's error event says so while this listing waits)
                function onErr(ev) { var m = ev && ev.message ? '' + ev.message : ''; if (/isFile|isDirectory|fileSize/.test(m)) { done(); reject(new Error('listFiles: ' + m)); } }
                function done() { try { window.removeEventListener('error', onErr, false); } catch (e) {} }
                try { window.addEventListener('error', onErr, false); } catch (e) {}
                U.crumb('usb: list ' + vpath);
                try { d.listFiles(function (files) { done(); resolve(files || []); }, function (e) { done(); reject(new Error('listFiles: ' + errText(e))); }); }
                catch (e) { done(); reject(new Error('listFiles: ' + errText(e))); }
                setTimeout(done, FS_WAIT + 100);
            }), FS_WAIT, 'listFiles').then(function (files) {
                U.crumb('usb: read ' + files.length + ' entries of ' + vpath);
                var entries;
                try { entries = files.slice(0, LIST_MAX).map(function (f) { return fileEntry(f, drive, rel); }); }
                catch (e) { return viaService('reading its entries: ' + errText(e)); }
                // (an entry the TV can't read — the 2017 TV can't, a file over 2 GB its service wrote —
                // is no name and no details: the service's listing instead, else the TV's as it is)
                var bad = entries.filter(function (x) { return x.bad; }).length;
                if (bad) { return viaService('the TV couldn’t read ' + bad + ' of its entries').then(null, function () { return { entries: sortEntries(entries) }; }); }
                return { entries: sortEntries(entries) };
            }, function (e) { return viaService(e.message); });
        }, function (e) { return viaService(e.message); });
    }

    // ---------- names -> titles ----------
    var QUALITY = /\b(2160p|1080[pi]|720p|576p|480p|4k|uhd|hdr10?|hdr|dv|dovi|blu ?ray|bdrip|brrip|bdremux|remux|web ?dl|webrip|web|hdtv|dvdrip|dvd|hdrip|x264|x265|h ?26[45]|hevc|avc|aac|ac3|eac3|dts|ddp?|atmos|10bit|proper|repack|extended|unrated|imax|internal|limited|multi|subbed|dubbed|complete)\b/i;
    var CAMERA = /^(img|vid|mov|mvi|dsc|dscn|gopr|gp|dji|pxl|vlc record|screen recording|whatsapp video)[ _-]?\d/i;
    function words(s) { return ('' + s).replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(); }
    function tidyTitle(s) {
        var t = words(s);
        var q = QUALITY.exec(t);
        if (q) { t = t.slice(0, q.index); }
        return t.replace(/[(\[{]\s*$/, '').replace(/\s*[-–:([{]+\s*$/, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function yearOf(s) {
        var re = /(?:^|[\s(\[._-])((?:19[2-9]|20[0-4])\d)(?=$|[\s)\]._-])/g, m, last = null;
        while ((m = re.exec(s))) { if (m.index > 0) { last = { year: +m[1], at: m.index }; } }
        return last;
    }
    var SEASON_DIR = /^(season|series|saison|temporada|staffel|stagione|s)\s*\d{1,2}$|^specials?$|^extras?$/i;
    // What a video is, by its name (and its folders', nearest first): { kind: 'movie' | 'series',
    // title, year?, season?, episode? }, or null (a camera's file, a name with no title).
    function parseName(name, dirs) {
        dirs = dirs || [];
        var base = stem(name), s = ' ' + words(base) + ' ';
        if (CAMERA.test(words(base))) { return null; }
        var ep = /\bS(\d{1,2})\s?E(\d{1,3})\b/i.exec(s) || /\b(\d{1,2})x(\d{2,3})\b/.exec(s) || /\bSeason\s?(\d{1,2})\s?Episode\s?(\d{1,3})\b/i.exec(s);
        if (ep) {
            var title = tidyTitle(s.slice(0, ep.index)), year = null;
            if (!title) {
                for (var i = 0; i < dirs.length && !title; i++) { if (!SEASON_DIR.test(words(dirs[i]))) { title = tidyTitle(dirs[i]); } }
            }
            var y = yearOf(title);
            if (y) { year = y.year; title = tidyTitle(title.slice(0, y.at)) || title; }
            if (!title) { return null; }
            return { kind: 'series', title: title, year: year, season: +ep[1], episode: +ep[2] };
        }
        function movie(str) {
            var w = words(str), y2 = yearOf(w), t;
            if (y2) { t = tidyTitle(w.slice(0, y2.at)); }
            else { t = tidyTitle(w); }
            return t ? { kind: 'movie', title: t, year: y2 ? y2.year : null } : null;
        }
        var m = movie(base);
        // "Dune (2021)/dune.mkv": the folder says it better
        var parent = dirs.length ? movie(dirs[0]) : null;
        if (parent && parent.year && (!m || !m.year)) { return parent; }
        if (!m || m.title.length < 2 || /^(movie|film|video|sample|trailer|feature)$/i.test(m.title)) { return parent && parent.year ? parent : null; }
        return m;
    }
    function norm(s) {
        var t = ('' + (s || '')).toLowerCase();
        if (t.normalize) { try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {} }
        return t.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();
    }
    function similarity(a, b) {
        var x = norm(a), y = norm(b);
        if (!x || !y) { return 0; }
        if (x === y) { return 1; }
        var A = x.split(' '), B = y.split(' '), both = 0;
        A.forEach(function (w) { if (B.indexOf(w) !== -1) { both++; } });
        return both / (A.length + B.length - both);
    }
    function metaYear(m) { var r = /(\d{4})/.exec('' + (m.releaseInfo || m.year || '')); return r ? +r[1] : null; }
    // The best of a search's results for a parsed name, or null when none is close enough.
    function choose(p, metas) {
        var best = null, bestScore = 0;
        metas.forEach(function (m, i) {
            var sim = similarity(m.name, p.title), y = metaYear(m), dy = (p.year && y) ? Math.abs(p.year - y) : null;
            var ok = (sim === 1 && (dy === null || dy <= 1)) || (sim >= 0.75 && dy === 0);
            if (!ok) { return; }
            var score = sim + (dy === 0 ? 0.5 : dy === 1 ? 0.2 : 0) - i * 0.01;
            if (score > bestScore) { best = m; bestScore = score; }
        });
        return best;
    }
    function matchKey(p) { return p.kind + '|' + norm(p.title) + '|' + (p.year || ''); }
    function showKey(p) { return 'show|' + norm(p.title) + '|' + (p.year || ''); }
    function matches() { return U.store.get(MATCH_KEY, {}) || {}; }
    function fixes() { return U.store.get(FIX_KEY, {}) || {}; }
    function keepCapped(key, all, max) {
        var ks = Object.keys(all);
        if (ks.length > max) {
            ks.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
            ks.slice(0, ks.length - max).forEach(function (k) { delete all[k]; });
        }
        U.store.set(key, all);
    }
    function titleOf(m) { return { id: m.id, type: m.type, name: m.name || '', poster: m.poster || '', year: metaYear(m), at: Date.now() }; }

    // A file, for your own matches (and a plain file's progress, see plainId): its place on the
    // drive and its size, so the same path on two drives isn't taken for one file.
    function fileKey(rel, size) { return 'file|' + (+size || 0) + '|' + rel; }
    // What a file is matched to (from what's kept: your own match first): { type, id (the
    // movie / show), vid (the movie / episode), name, poster, parsed, fixed? } or null.
    function matchOf(rel, size) {
        var dirs = dirOf(rel) ? dirOf(rel).split('/').reverse() : [];
        var p = parseName(nameOf(rel), dirs), fx = fixes();
        var f = fx[fileKey(rel, size)] || fx['file|' + rel] || (p && p.kind === 'series' ? fx[showKey(p)] : null);   // ('file|<path>': kept by 1.9.0–1.9.2)
        if (f) {
            if (f.none) { return null; }
            if (f.type === 'series') {
                if (!p || p.kind !== 'series') { return null; }   // (a show picked for a file with no episode number)
                return { type: 'series', id: f.id, vid: f.id + ':' + p.season + ':' + p.episode, name: f.name, poster: f.poster, parsed: p, fixed: true };
            }
            return { type: 'movie', id: f.id, vid: f.id, name: f.name, poster: f.poster, parsed: p, fixed: true };
        }
        if (!p) { return null; }
        var m = matches()[matchKey(p)];
        if (!m || !m.id) { return null; }
        return { type: p.kind, id: m.id, vid: p.kind === 'series' ? m.id + ':' + p.season + ':' + p.episode : m.id, name: m.name, poster: m.poster, parsed: p };
    }
    function parsedOf(rel) { var d = dirOf(rel); return parseName(nameOf(rel), d ? d.split('/').reverse() : []); }
    // Ask the search addons about a parsed name (once; a miss asked again after a week).
    var _asking = {};
    function lookup(p) {
        var key = matchKey(p), had = matches()[key];
        if (had && (had.id || Date.now() - (had.at || 0) < NONE_RETRY_MS)) { return Promise.resolve(had.id ? had : null); }
        if (!matchingAllowed()) { return Promise.resolve(null); }   // (nothing sent until you've said yes)
        if (_asking[key]) { return _asking[key]; }
        _asking[key] = Stremio.findTitles(p.kind, p.title).then(function (metas) {
            var m = choose(p, metas), all = matches();
            all[key] = m ? titleOf(Object.assign({}, m, { type: p.kind })) : { none: true, at: Date.now() };
            keepCapped(MATCH_KEY, all, MATCHES_MAX);
            delete _asking[key];
            return m ? all[key] : null;
        }, function (e) { delete _asking[key]; throw e; });
        return _asking[key];
    }
    // Your own match: a title for a file (a show: for all its episodes), "not a title", or
    // back to the automatic one (null).
    function setMatch(rel, size, choice) {
        var p = parsedOf(rel), fx = fixes();
        var key = (choice && choice.type === 'series' && p && p.kind === 'series') ? showKey(p) : fileKey(rel, size);
        delete fx['file|' + rel];
        delete fx[fileKey(rel, size)];
        if (p && p.kind === 'series') { delete fx[showKey(p)]; }
        if (choice) { fx[key] = choice.none ? { none: true, at: Date.now() } : titleOf(choice); }
        keepCapped(FIX_KEY, fx, FIXES_MAX);
        rebuild();
        emit('matches');
    }
    // A file StremioK downloaded (Local › Downloads): in its drive's index at once, matched to the
    // title it was downloaded for — a source on that title's page, with no name to guess and no
    // indexing again — and its subtitle file with it. rel: its path on the drive.
    function addDownloaded(root, rel, size, title, subs) {
        var d = knownDrives().filter(function (x) { return x.root === root; })[0];
        if (!d) { return; }
        if (rel && title && title.id && /^tt\d+$/.test(title.id)) {
            var fx = fixes();
            fx[fileKey(rel, size)] = titleOf(title);
            keepCapped(FIX_KEY, fx, FIXES_MAX);
        }
        var x = _index[root] || { label: d.label, at: Date.now(), files: [], subs: [] };
        if (rel) { x.files = (x.files || []).filter(function (f) { return f.p !== rel; }).concat([{ p: rel, size: +size || 0 }]); }   // (no rel: a subtitle file only)
        x.subs = (x.subs || []).concat((subs || []).filter(function (s) { return (x.subs || []).indexOf(s) === -1; }));
        _index[root] = x;
        saveIndex(d);
        rebuild();
        emit('index');
    }
    // Forget the drives' indexes (here and kept on the TV): title pages stop offering their files
    // until a drive is indexed again.
    function clearIndex() {
        Object.keys(_scanning).forEach(function (root) { _gen[root] = (_gen[root] || 0) + 1; });   // (indexing now: stopped, nothing saved)
        Object.keys(_cancel).forEach(function (root) { _cancel[root].cancel(); });
        _scanning = {}; _cancel = {};
        _index = {}; _status = {};
        rebuild();
        if (U.bigStore) {
            Object.keys(U.store.get(INDEXES_KEY, {}) || {}).forEach(function (root) { U.bigStore.remove(INDEX_KEY + root); });
            U.bigStore.remove('stremiok.local.index');   // (1.9.0–1.9.3 kept every drive's in one)
        }
        U.store.remove(INDEXES_KEY);
        emit('index'); emit('status');
    }
    function forgetMatches() { U.store.remove(MATCH_KEY); U.store.remove(FIX_KEY); rebuild(); emit('matches'); }
    function searchTitles(type, q) { return Stremio.findTitles(type, q); }

    // ---------- the index (what each drive has) ----------
    var _index = {}, _byId = {}, _subsById = {}, _scanning = {}, _status = {};
    // A drive's index: its own record (reading or saving one drive's never touches another's),
    // saved one at a time per drive; the INDEXES_MAX drives indexed latest are kept.
    function loadIndex(drive) {
        if (!U.bigStore) { return Promise.resolve(); }
        return U.bigStore.get(INDEX_KEY + drive.root).then(function (x) {
            if (x && x.label === drive.label && Array.isArray(x.files) && !_index[drive.root]) { _index[drive.root] = x; rebuild(); emit('index'); }
        }, function () {});
    }
    var _saving = {};
    function saveIndex(drive) {
        if (!U.bigStore || !_index[drive.root]) { return Promise.resolve(); }
        var root = drive.root;
        _saving[root] = (_saving[root] || Promise.resolve()).then(function () {
            var x = _index[root];
            if (!x) { return null; }
            return U.bigStore.set(INDEX_KEY + root, x).then(function (ok) {
                if (_index[root] !== x) { U.bigStore.remove(INDEX_KEY + root); return; }   // (cleared while it was being saved)
                if (!ok) { return; }
                var kept = U.store.get(INDEXES_KEY, {}) || {};
                kept[root] = x.at || Date.now();
                var roots = Object.keys(kept).sort(function (a, b) { return kept[b] - kept[a]; });
                roots.slice(INDEXES_MAX).forEach(function (r) { delete kept[r]; U.bigStore.remove(INDEX_KEY + r); });
                U.store.set(INDEXES_KEY, kept);
            });
        }).then(null, function () {});
        return _saving[root];
    }
    function rebuild() {
        var by = {};
        knownDrives().forEach(function (d) {
            var x = _index[d.root];
            if (!x) { return; }
            x.files.forEach(function (f) {
                var m = matchOf(f.p, f.size);
                if (m) { (by[m.vid] = by[m.vid] || []).push({ drive: d, file: f }); }
            });
        });
        _byId = by;
        // subtitle files of their own (no video next to them), matched by their names or by you
        var bySub = {};
        knownDrives().forEach(function (d) {
            var x = _index[d.root];
            if (!x) { return; }
            standaloneSubs(x).forEach(function (rel) {
                var m = matchOf(rel, 0);
                if (m) { (bySub[m.vid] = bySub[m.vid] || []).push({ drive: d, rel: rel }); }
            });
        });
        _subsById = bySub;
    }
    // A drive's subtitle files that aren't a video's (in a folder with no video, or not named
    // after one of its videos when it has several): matched on their own.
    function standaloneSubs(x) {
        var vids = {};
        (x.files || []).forEach(function (f) { var dd = dirOf(f.p); (vids[dd] = vids[dd] || []).push(stem(nameOf(f.p)).toLowerCase()); });
        return (x.subs || []).filter(function (s) { return !isHidden(nameOf(s)) && !s.split('/').some(isHidden) && !isVideosSub(vids[dirOf(s)], s); });
    }
    function isVideosSub(stems, rel) {
        if (!stems || !stems.length) { return false; }
        if (stems.length === 1) { return true; }   // (the folder's only video: its subtitles, whatever their names)
        var st = stem(nameOf(rel)).toLowerCase();
        return stems.some(function (v) { return st.indexOf(v) === 0; });
    }
    // In a folder's listing (the Local tab): a subtitle file of its own, to match by hand.
    function isStandaloneSub(entries, x) {
        if (!x || x.dir || !isSub(x.name)) { return false; }
        var stems = (entries || []).filter(function (y) { return !y.dir && isVideo(y.name); }).map(function (y) { return stem(y.name).toLowerCase(); });
        return !isVideosSub(stems, x.rel || x.name);
    }
    // Walk a drive: the service in one go (its own file access), else folder by folder here.
    // cancel: stopping it (Stop, Clear) closes the request, and the service stops walking.
    function walk(drive, cancel) {
        return askService('/fswalk?path=' + encodeURIComponent(drive.root), WALK_WAIT, 8 * 1024 * 1024, cancel).then(function (r) {
            return { files: U.listOf(r && r.files, 20000, function (f) { return f && typeof f.p === 'string'; }), truncated: !!(r && r.truncated) };
        }, function (e) {
            if (e && e.cancelled) { throw e; }
            U.log('local', 'Indexing ' + drive.label + ' through the service failed (' + e.message + '): folder by folder instead');
            var out = [], queue = [{ rel: '', depth: 0 }], seen = 0;
            function next() {
                if (cancel && cancel.cancelled) { return Promise.resolve({ files: out, truncated: true }); }
                if (!queue.length || seen >= CLIENT_WALK_DIRS) { return Promise.resolve({ files: out, truncated: !!queue.length }); }
                var d = queue.shift();
                seen++;
                return list(drive, d.rel).then(function (r) {
                    r.entries.forEach(function (x) {
                        if (isHidden(x.name)) { return; }
                        if (x.dir) { if (d.depth < CLIENT_WALK_DEPTH) { queue.push({ rel: x.rel, depth: d.depth + 1 }); } }
                        else if (isVideo(x.name) || isSub(x.name)) { out.push({ p: x.rel, size: x.size }); }
                    });
                }, function () {}).then(next);
            }
            return next();
        });
    }
    // Index a drive: list it (the service, in one go), keep that, then match its videos (when
    // you've said yes). Stopped (stopScan) or cleared (clearIndex) meanwhile: what it finds
    // after that is dropped — never saved over what you cleared; asked again, it starts afresh.
    var _gen = {};   // drive root -> generation: a newer one means this indexing was stopped
    var _cancel = {};   // drive root -> its walk's cancelToken
    function scan(drive) {
        var root = drive.root;
        if (_scanning[root]) { return _scanning[root]; }
        var gen = _gen[root] = (_gen[root] || 0) + 1;
        function current() { return _gen[root] === gen; }
        _status[root] = { state: 'scanning', phase: 'listing', at: Date.now() };
        U.crumb('usb: index ' + drive.label);
        emit('status');
        var cancel = _cancel[root] = U.cancelToken();
        var job = walk(drive, cancel).then(function (r) {
            if (!current()) { return; }
            var files = r.files.filter(function (f) { return isVideo(f.p) && !f.p.split('/').some(isHidden); });
            var subs = r.files.filter(function (f) { return isSub(f.p); }).map(function (f) { return f.p; });
            _index[root] = { label: drive.label, at: Date.now(), files: files, subs: subs, truncated: r.truncated };
            saveIndex(drive);
            rebuild();
            emit('index');
            return matchAll(drive, current);
        }).then(function (left) {
            if (!current()) { return; }
            delete _scanning[root]; delete _cancel[root];
            _status[root] = { state: 'done', at: Date.now(), left: left || 0 };
            emit('status');
        }, function (e) {
            if (!current()) { return; }
            delete _scanning[root];
            _status[root] = { state: 'failed', at: Date.now(), error: e && e.message ? e.message : '' + e };
            U.log('local', 'Indexing ' + drive.label + ' failed: ' + _status[root].error);
            emit('status');
        });
        _scanning[root] = job;
        return job;
    }
    // Stop indexing a drive: what's listed and matched so far stays.
    function stopScan(drive) {
        var root = drive.root;
        if (!_scanning[root]) { return; }
        _gen[root] = (_gen[root] || 0) + 1;
        if (_cancel[root]) { _cancel[root].cancel(); delete _cancel[root]; }   // (the service stops walking)
        delete _scanning[root];
        delete _status[root];   // (as kept: the listing, if it got that far)
        rebuild();
        emit('status');
    }
    // { state: 'scanning' | 'failed' (error) | 'done' | 'saved' (from before) | 'none', at, videos, matched, truncated }
    function status(drive) {
        var s = _status[drive.root], x = _index[drive.root];
        if (s && s.state !== 'done') { return s; }
        if (!x) { return { state: 'none' }; }
        return { state: s ? 'done' : 'saved', at: x.at, videos: x.files.length, matched: x.files.filter(function (f) { return !!matchOf(f.p, f.size); }).length, truncated: x.truncated,
            left: (s && s.left) || 0 };   // (titles a run left to match: continueMatching)
    }
    // Each title the drive's videos name, asked once (two at a time).
    // Match an indexed drive's videos: two lookups at a time, walking the drive's list (nothing
    // built per video up front: a big drive is thousands), waiting while StremioK is in the
    // background, MATCH_BUDGET titles a run; the rest left for later (continueMatching).
    // Resolves how many titles are left.
    var MATCH_BUDGET = 300;
    function matchAll(drive, current) {
        var x = _index[drive.root], root = drive.root;
        current = current || function () { return true; };
        if (!x || !matchingAllowed()) { return Promise.resolve(0); }
        function needs(f, seen) {   // a title still to ask about: { k, p }, else null
            if (matchOf(f.p, f.size)) { return null; }
            var p = parsedOf(f.p);
            if (!p) { return null; }
            var k = matchKey(p), had = matches()[k];
            if (seen[k] || (had && (had.id || Date.now() - (had.at || 0) < NONE_RETRY_MS))) { return null; }
            return { k: k, p: p };
        }
        var counted = {}, total = 0;
        var list = x.files.concat(standaloneSubs(x).map(function (rel) { return { p: rel, size: 0 }; }));   // (subtitle files of their own: matched by their names too)
        list.forEach(function (f) { var n = needs(f, counted); if (n) { counted[n.k] = 1; total++; } });
        counted = null;
        var budget = Math.min(total, MATCH_BUDGET), asked = {}, i = 0, started = 0, done = 0;
        function progress() {
            if (!current()) { return; }
            _status[root] = { state: 'scanning', phase: 'matching', done: done, total: budget, left: total - budget, at: (_status[root] || {}).at || Date.now() };
            emit('status');
        }
        function nextTitle() {
            while (i < list.length) { var n = needs(list[i++], asked); if (n) { asked[n.k] = 1; return n; } }
            return null;
        }
        function worker() {
            if (!current() || started >= budget) { return Promise.resolve(); }
            var n = nextTitle();
            if (!n) { return Promise.resolve(); }
            started++;
            return U.whenVisible().then(function () {
                if (!current()) { return null; }
                return lookup(n.p).then(null, function () {});
            }).then(function () {
                done++;
                if (done % 10 === 0 && current()) { rebuild(); emit('matches'); progress(); }
                return worker();
            });
        }
        progress();
        return Promise.all([worker(), worker()]).then(function () {
            if (current()) { rebuild(); emit('matches'); }
            return Math.max(0, total - done);
        });
    }
    // Match the titles a run left (its budget reached), without listing the drive again.
    function continueMatching(drive) {
        var root = drive.root;
        if (_scanning[root] || !_index[root]) { return _scanning[root] || Promise.resolve(); }
        var gen = _gen[root] = (_gen[root] || 0) + 1;
        function current() { return _gen[root] === gen; }
        _scanning[root] = matchAll(drive, current).then(function (left) {
            if (!current()) { return; }
            delete _scanning[root];
            _status[root] = { state: 'done', at: (_index[root] || {}).at || Date.now(), left: left };
            emit('status');
        });
        return _scanning[root];
    }
    // The videos of a folder on screen not matched yet: asked now (two at a time), not after the
    // drive's index. Resolves how many were matched.
    function matchFolder(drive, entries) {
        if (!matchingAllowed()) { return Promise.resolve(0); }
        var want = {}, order = [];
        (entries || []).forEach(function (x) {
            var sub = isStandaloneSub(entries, x);   // (a subtitle file of its own: matched by its name, size 0)
            if (x.dir || (!isVideo(x.name) && !sub) || matchOf(x.rel, sub ? 0 : x.size)) { return; }
            var p = parsedOf(x.rel);
            if (!p) { return; }
            var k = matchKey(p), had = matches()[k];
            if (had && (had.id || Date.now() - (had.at || 0) < NONE_RETRY_MS)) { return; }
            if (!want[k]) { want[k] = p; order.push(k); }
        });
        if (!order.length) { return Promise.resolve(0); }
        var found = 0;
        return U.settleAll(order.slice(0, 60).map(function (k) {
            return function () { return lookup(want[k]).then(function (m) { if (m) { found++; } }); };
        }), 2).then(function () { if (found) { rebuild(); } return found; });
    }

    // ---------- sources and subtitles ----------
    function langFrom(rest) {
        var forced = false, lang = '';
        rest.split(/[._\s()\[\]-]+/).forEach(function (t) {
            if (!t || lang) { return; }
            if (/^(forced|foreign)$/i.test(t)) { forced = true; return; }
            if (/^(sdh|cc|hi|default|full|subs?|subtitles?)$/i.test(t)) { return; }
            if (/^[a-z]{2,3}$/i.test(t) || /^[a-z]{2}-[a-z]{2,4}$/i.test(t) || /^[a-zÀ-ɏ]{4,}$/i.test(t)) { lang = t; }
        });
        return { lang: lang, forced: forced };
    }
    // A video's subtitle files: in its folder, named like it (Film.srt, Film.en.srt,
    // Film.forced.eng.srt), or any there when it's the folder's only video.
    function sidecars(drive, rel, subRels, alone) {
        var dir = dirOf(rel), base = stem(nameOf(rel)).toLowerCase();
        return subRels.filter(function (s) {
            if (dirOf(s) !== dir || isHidden(nameOf(s))) { return false; }
            return alone || stem(nameOf(s)).toLowerCase().indexOf(base) === 0;
        }).map(function (s) {
            var st = stem(nameOf(s)), rest = st.toLowerCase().indexOf(base) === 0 ? st.slice(base.length) : st;
            var l = langFrom(rest);
            return subTrack(drive, s, l.lang, 'Next to the file' + (l.forced ? ' (forced)' : ''));
        });
    }
    function subTrack(drive, s, lang, label) {
        var subPath = '/fssub?path=' + encodeURIComponent(drive.root + '/' + s);
        var track = { id: 'file:' + s, lang: lang, _addon: label, _file: nameOf(s) };
        // (its link with the token as it is when used: read once the service is up)
        Object.defineProperty(track, 'url', { enumerable: true, get: function () { return svcUrl(subPath, _token); } });
        Object.defineProperty(track, 'headers', { enumerable: false, get: function () { return svcHeaders(_token); } });   // (no token: its header)
        return track;
    }
    // A subtitle file of its own: its language when its name says one StremioK knows (after its
    // episode or year: "….S01E04.en.srt", "Film.2020.spanish.srt"), else '' (a tag it doesn't
    // know, "-ESP", isn't guessed).
    function langOfName(rel) {
        var st = stem(nameOf(rel)), m = /S\d{1,2}\s?E\d{1,3}|\b\d{1,2}x\d{2,3}\b|\b(?:19|20)\d{2}\b/i.exec(st);
        var toks = (m ? st.slice(m.index + m[0].length) : st).split(/[._\s()\[\]-]+/).filter(Boolean).reverse();
        var known = (typeof Player !== 'undefined' && Player.langKey) ? Player.langKey : null;
        for (var i = 0; known && i < toks.length; i++) {
            var t = toks[i];
            if (/^(forced|foreign|sdh|cc|hi|default|full|subs?|subtitles?)$/i.test(t)) { continue; }
            if (/^[a-z]{2,3}$/i.test(t) || /^[a-zÀ-ɏ]{4,}$/i.test(t)) { if (known(t) !== t.toLowerCase()) { return t; } }
        }
        return '';
    }
    function subsInIndex(drive, rel) {
        var x = _index[drive.root];
        if (!x) { return []; }
        var dir = dirOf(rel), alone = x.files.filter(function (f) { return dirOf(f.p) === dir; }).length === 1;
        return sidecars(drive, rel, x.subs || [], alone);
    }
    var _recent = U.lru(200);   // url -> a source made here lately (Continue Watching's resume finds it)
    function makeStream(drive, file, subs, uri) {
        var abs = drive.root + '/' + file.p, name = nameOf(file.p), url = uri || fileUri(abs);
        var st = { name: '💾 USB drive', title: name + (file.size ? '\n💾 ' + humanSize(file.size) : ''), url: url,
            behaviorHints: { filename: name, videoSize: file.size || undefined, bingeGroup: 'stremiok-local' },
            _addon: 'Your USB drive', _local: MARK, _localSubs: subs || subsInIndex(drive, file.p),
            _localFile: { abs: abs, rel: file.p, size: file.size || 0, name: name } };
        _recent.set(url, st);
        return st;
    }
    // The link the player opens for a file on a drive: a file over 2 GB through StremioK's
    // service (/fsfile, with its token) where the token can be read — the 2017 TV's player can't
    // read past 2 GB of a file straight from the drive (playing from the start goes, every jump
    // stalls) —, else the file itself. The source's own link stays the file's (its identity).
    var BIG = 2147483647;
    function openUrl(url, size) {
        if (!/^file:\/\/\/opt\/media\//i.test(url || '')) { return url; }
        var abs = realPath(url);
        if (!size) { var hit = _recent.get(url); size = hit && hit._localFile ? hit._localFile.size : 0; }
        if (!(size > BIG) || !_token || !service()) { return url; }
        return svcUrl('/fsfile?path=' + encodeURIComponent(abs), _token);
    }
    function isLocalStream(s) { return !!(s && s._local === MARK && typeof s.url === 'string' && /^file:\/\/\/opt\/media\//i.test(s.url)); }
    // The files on your drives for a movie (tt…) or an episode (tt…:1:2), as sources.
    function streamsFor(type, id) {
        if ((type !== 'movie' && type !== 'series') || !/^tt\d+(:\d+:\d+)?$/.test('' + id)) { return []; }
        return (_byId[id] || []).map(function (x) { return makeStream(x.drive, x.file); });
    }
    // The subtitle files on the drives for a movie / an episode (next to a file matched to it), for
    // any source of it (player-subs): the drive's, as such.
    function subsForTitle(type, id) {
        if ((type !== 'movie' && type !== 'series') || !/^tt\d+(:\d+:\d+)?$/.test('' + id)) { return []; }
        var seen = {}, out = [];
        (_byId[id] || []).forEach(function (x) {
            subsInIndex(x.drive, x.file.p).forEach(function (t) {
                if (seen[t.id]) { return; }
                seen[t.id] = 1;
                t._addon = 'Your USB drive';
                out.push(t);
            });
        });
        (_subsById[id] || []).forEach(function (x) {   // (subtitle files of their own, matched to it)
            if (seen['file:' + x.rel]) { return; }
            seen['file:' + x.rel] = 1;
            out.push(subTrack(x.drive, x.rel, langOfName(x.rel), 'Your USB drive'));
        });
        return out;
    }
    // A local file's source again from its link (Continue Watching), on whichever drive has it now.
    function streamForUrl(url) {
        if (_recent.get(url)) { return _recent.get(url); }
        var abs = realPath(url), d = driveOf(abs);
        if (!/^\/opt\/media\//.test(abs)) { return null; }
        var rel = d ? abs.slice(d.root.length + 1) : abs.replace(/^\/opt\/media\/[^\/]+\//, '');
        var ds = d ? [d].concat(knownDrives().filter(function (x) { return x !== d; })) : knownDrives();
        for (var i = 0; i < ds.length; i++) {
            var x = _index[ds[i].root], f = x && x.files.filter(function (y) { return y.p === rel; })[0];
            if (f) { return makeStream(ds[i], f); }
        }
        // (drives not read this session: the file where it was, without its index)
        var mount = /^\/opt\/media\/[^\/]+/.exec(abs);
        return makeStream(d || { label: '', root: mount[0] }, { p: rel, size: 0 });
    }
    // For subtitle addons: the file's OpenSubtitles hash, size and name (the hash asked of the
    // service; without it if that fails).
    var _hashes = {};
    function subtitleExtra(localFile) {
        if (!localFile || !localFile.abs) { return Promise.resolve(null); }
        var base = { videoSize: localFile.size || undefined, filename: localFile.name };
        if (!_hashes[localFile.abs]) {
            _hashes[localFile.abs] = within(askService('/fshash?path=' + encodeURIComponent(localFile.abs), 8000, 4096), 9000, 'hash').then(function (r) {
                return r && /^[0-9a-f]{16}$/.test(r.hash) ? r : null;
            }, function () { delete _hashes[localFile.abs]; return null; });
        }
        return _hashes[localFile.abs].then(function (h) {
            if (h) { base.videoHash = h.hash; base.videoSize = h.size; }
            return base;
        });
    }

    // ---------- playing ----------
    // From the Local tab: a matched file through its title's page (next episode, sources,
    // addon subtitles…), straight into playback; any other as a plain file.
    function play(drive, entry, siblings, onPlainExit) {
        var file = { p: entry.rel, size: entry.size || 0 };
        var dir = dirOf(entry.rel), subNames = (siblings || []).filter(function (e) { return !e.dir && isSub(e.name); }).map(function (e) { return e.rel; });
        var alone = (siblings || []).filter(function (e) { return !e.dir && isVideo(e.name); }).length <= 1;
        var subs = sidecars(drive, entry.rel, subNames.length ? subNames : ((_index[drive.root] || {}).subs || []).filter(function (s) { return dirOf(s) === dir; }), alone);
        var st = makeStream(drive, file, subs, entry.uri);
        var m = matchOf(entry.rel, entry.size);
        if (m) {
            App.openDetail(m.type, m.id, { id: m.id, type: m.type, name: m.name, poster: m.poster }, m.type === 'series' ? m.vid : null,
                { resume: { url: st.url, id: m.vid, name: m.type === 'series' ? m.name + '  ·  S' + m.parsed.season + 'E' + m.parsed.episode : m.name } });
            return;
        }
        playPlain(st, onPlainExit);
    }
    // A plain file's id (its progress, watched mark, Continue Watching card): "local:<size>:<path
    // on the drive>" — the size telling apart the same path on two drives.
    function plainId(rel, size) { return 'local:' + (+size || 0) + ':' + rel; }
    function parsePlainId(id) {
        var m = /^local:(\d+):(.*)$/.exec('' + id);
        return m ? { size: +m[1], rel: m[2] } : { size: 0, rel: ('' + id).replace(/^local:/, '') };   // ('local:<path>': 1.9.0–1.9.2)
    }
    // fromStart: Play from start (Continue Watching), from 0:00.
    function playPlain(st, onExit, id, fromStart) {
        var f = st._localFile;
        Player.play({ url: st.url, type: 'movie', id: id || plainId(f.rel, f.size), name: f.name, streams: [], localSubs: st._localSubs, localFile: f, fromStart: !!fromStart || undefined }, onExit || function () {});
    }
    // A plain file's Continue Watching card: on whichever drive has that file (that path, that
    // size) now.
    function resumePlain(e, onExit, fromStart) {
        var want = parsePlainId(e.id), rel = want.rel;
        return ensure().then(function (ds) {
            if (!ds.length) { U.toast('Plug in the USB drive with “' + nameOf(rel) + '”', 4000); return false; }
            var d = null, f = null;
            ds.forEach(function (x) {
                var idx = _index[x.root], hit = idx && idx.files.filter(function (y) { return y.p === rel && (!want.size || y.size === want.size); })[0];
                if (!d && hit) { d = x; f = hit; }
            });
            if (!d) { d = driveOf(realPath(e.url || '')) || ds[0]; f = { p: rel, size: want.size }; }
            playPlain(makeStream(d, f), onExit, e.id, fromStart);
            return true;
        });
    }

    // ---------- matching: only once you've said yes ----------
    // Matching sends the titles worked out from the videos' names (not the files) to the search
    // addons you've installed: asked once (Local, the first folder with videos to match),
    // changed in Settings › USB drive. Off: Local just browses; matches made before still show.
    var CONSENT_KEY = 'stremiok.local.matching';
    function matchingAllowed() { return U.store.get(CONSENT_KEY, null) === true; }
    function matchingAsked() { var v = U.store.get(CONSENT_KEY, null); return v === true || v === false; }
    function setMatching(on) { U.store.set(CONSENT_KEY, !!on); emit('matches'); }
    // Whether a folder has videos matching would look up (not matched yet, a title in the name).
    function wouldMatch(entries) {
        return (entries || []).some(function (x) { return !x.dir && isVideo(x.name) && !matchOf(x.rel, x.size) && !!parsedOf(x.rel); });
    }

    return {
        available: available, ready: ready, watch: watch, present: present, ensure: ensure, isRead: isRead, onChange: onChange, drives: drives, knownDrives: knownDrives, hasDrive: hasDrive, refreshDrives: refreshDrives,
        serviceToken: function () { return readToken(); }, askService: askService, addDownloaded: addDownloaded, openUrl: openUrl, list: list, isVideo: isVideo, isSub: isSub, isHidden: isHidden, showHidden: showHidden, setShowHidden: setShowHidden, humanSize: humanSize,
        parseName: parseName, choose: choose, matchOf: matchOf, lookup: lookup, matchFolder: matchFolder, parsedOf: parsedOf, setMatch: setMatch, forgetMatches: forgetMatches, searchTitles: searchTitles,
        scan: scan, stopScan: stopScan, continueMatching: continueMatching, status: status, clearIndex: clearIndex, streamsFor: streamsFor, subsForTitle: subsForTitle, isStandaloneSub: isStandaloneSub, streamForUrl: streamForUrl, isLocalStream: isLocalStream, subtitleExtra: subtitleExtra,
        play: play, playPlain: playPlain, resumePlain: resumePlain, plainId: plainId, parsePlainId: parsePlainId,
        matchingAllowed: matchingAllowed, matchingAsked: matchingAsked, setMatching: setMatching, wouldMatch: wouldMatch, isPlainId: function (id) { return /^local:/.test('' + id); }
    };
})();
