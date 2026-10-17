/* Downloads to a USB drive (the sideloaded app): a source's file saved on a drive plugged into
   the TV, by StremioK's service (service/index.js, /fsdl/…), one at a time. What's asked for is
   also kept here (DL_KEY): the service keeps its list in memory only, so what it no longer knows
   (StremioK's service restarted) is asked for again, and it picks the partial file up where it
   stopped. The Local tab shows the list (onChange); a title's source menu starts one (start).
   Global namespace: Downloads */
var Downloads = (function () {
    'use strict';
    var DL_KEY = 'stremiok.downloads', MAX = 50, POLL_MS = 3000, FOLDER = 'StremioK';
    var _items = [], _watching = false, _listeners = [], _synced = false;

    function available() {
        return typeof YTPlay !== 'undefined' && YTPlay.installMode() === 'wgt' && typeof LocalMedia !== 'undefined' && LocalMedia.present && LocalMedia.present();
    }
    function kept() { var l = U.store.get(DL_KEY, []); return Array.isArray(l) ? l : []; }
    function keep(l) { U.store.set(DL_KEY, l.slice(-MAX)); }
    function keyOf(x) { return x.dir + '/' + x.name; }
    // The same file, renamed or not ("Film.mkv", "Film (k3x9).mkv"): its folder and its name's stem.
    function sameFile(y, k) {
        var stem = ('' + k.name).replace(/\.[^.]+$/, '');
        return y.dir === k.dir && ('' + y.name).indexOf(stem) === 0 && ('' + y.name).replace(/^.*\./, '') === ('' + k.name).replace(/^.*\./, '');
    }
    function ask(path, ms) { return LocalMedia.askService(path, ms || 15000, 65536); }
    function qs(o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }

    // The list as the service has it, joined with what's kept here (the service's file name: a
    // finished one may have been renamed to keep an older file).
    function items() { return _items.slice(); }
    function busy() { return _items.some(function (x) { return x.state === 'queued' || x.state === 'downloading' || x.state === 'waiting'; }); }
    function emit() { _listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
    function onChange(fn) { _listeners.push(fn); return function () { var i = _listeners.indexOf(fn); if (i !== -1) { _listeners.splice(i, 1); } }; }

    function sync() {
        if (!available()) { return Promise.resolve([]); }
        return ask('/fsdl/list').then(function (r) {
            var live = (r && Array.isArray(r.items)) ? r.items : [], byKey = {}, mine = kept(), again = [];
            live.forEach(function (x) { byKey[keyOf(x)] = x; });
            mine.forEach(function (k) {
                // (by its file; else by the service's id — a finished one may have been renamed to keep
                // an older file — only one in the same folder named after it: an id from before the
                // service restarted can be another download's now)
                var x = byKey[keyOf(k)] || (k.id && live.filter(function (y) { return y.id === k.id && sameFile(y, k); })[0]);
                if (x) {
                    k.id = x.id; k.state = x.state; k.err = x.err; k.size = x.size || k.size; k.got = x.got;
                    if (x.state === 'done') { k.name = x.name; register(k); }
                    return;
                }
                if (k.state !== 'done' && k.state !== 'failed' && k.state !== 'cancelled') { again.push(k); }   // (the service doesn't know it any more: asked again)
            });
            keep(mine);
            _items = mine.map(function (k) {
                var x = byKey[keyOf(k)] || {};
                return { id: k.id, key: keyOf(k), title: k.title, name: k.name, dir: k.dir, kind: k.kind, size: x.size || k.size || 0, got: x.got || k.got || 0,
                    speed: x.speed || 0, state: x.state || k.state || 'queued', err: x.err || k.err || '' };
            });
            _synced = true;
            emit();
            return U.settleAll(again.map(function (k) { return function () { return send(k); }; }), 1).then(function () { return _items; });
        }, function () { return _items; });
    }
    function send(k) {
        return ask('/fsdl/add?' + qs({ dir: k.dir, name: k.name, url: k.url, ua: k.ua, ref: k.ref, size: k.size, title: k.title }), 20000).then(function (x) {
            var mine = kept();
            mine.forEach(function (y) { if (keyOf(y) === keyOf(k)) { y.id = x.id; y.state = x.state; y.err = ''; } });
            keep(mine);
        });
    }
    // Asked every few seconds while the list is on screen or one is under way.
    function watch() {
        if (_watching) { return; }
        _watching = true;
        (function tick() {
            sync().then(function () {
                if (available() && (busy() || _listeners.length > 0)) { setTimeout(tick, POLL_MS); } else { _watching = false; }
            });
        })();
    }

    // Add one: { title, name, dir, url, ua, ref, size, kind: 'video' | 'sub', type, vid (the video's
    // id: its sources for a fresh link; id is the service's), sid }.
    function add(job) {
        var mine = kept().filter(function (y) { return keyOf(y) !== keyOf(job); });
        job.state = 'queued'; job.at = Date.now();
        mine.push(job);
        keep(mine);
        return send(job).then(function () { watch(); return true; });
    }
    function act(it, what) {
        var mine = kept();
        if (what === 'clear' || what === 'cancel') {
            keep(mine.filter(function (y) { return keyOf(y) !== it.key; }));
            _items = _items.filter(function (y) { return y.key !== it.key; });
            emit();
        }
        if (!it.id) { return Promise.resolve(); }
        return ask('/fsdl/' + (what === 'cancel' ? 'cancel' : 'clear') + '?id=' + encodeURIComponent(it.id)).then(function () {
            if (what === 'cancel') { return ask('/fsdl/clear?id=' + encodeURIComponent(it.id)).then(null, function () {}); }
        }, function () {}).then(sync);
    }
    function cancel(it) { return act(it, 'cancel'); }
    function clear(it) { return act(it, 'clear'); }
    // Again: with a fresh link from the addon when it gives the same file (a debrid link expires).
    function retry(it) {
        var k = kept().filter(function (y) { return keyOf(y) === it.key; })[0];
        if (!k) { return Promise.resolve(false); }
        var fresh = (k.type && k.vid && k.kind === 'video' && typeof Stremio !== 'undefined') ? Stremio.getStreams(k.type, k.vid, null, true).then(function (list) {
            var same = (list || []).filter(function (s) { return Stremio.sourceId && Stremio.sourceId(s) === k.sid && s.url; })[0];
            if (same) { k.url = same.url; }
        }, function () {}) : Promise.resolve();
        return fresh.then(function () { return add(k); });
    }

    // A video that finished: in its drive's index at once, matched to the title it was downloaded
    // for (a source on that title's page; no name to guess, no indexing again), its subtitle too.
    var _registered = {};
    function register(k) {
        if (_registered[keyOf(k)] || typeof LocalMedia === 'undefined' || !LocalMedia.addDownloaded) { return; }
        var root = (/^\/opt\/media\/[^\/]+/.exec(k.dir) || [])[0];
        if (!root) { return; }
        _registered[keyOf(k)] = 1;
        var rel = k.dir.slice(root.length + 1) + '/' + k.name;
        // (the drives read first: a drive StremioK hasn't read yet would drop it)
        var ready = LocalMedia.ensure ? LocalMedia.ensure() : Promise.resolve();
        ready.then(function () {
            if (k.kind === 'sub') { LocalMedia.addDownloaded(root, null, 0, null, [rel]); return; }   // (next to its video: its subtitles)
            LocalMedia.addDownloaded(root, rel, k.size || 0, k.tid ? { id: k.tid, type: k.ttype || 'movie', name: k.tname || '', poster: k.tposter || '', year: k.tyear || '' } : null, []);
        }, function () { delete _registered[keyOf(k)]; });
    }

    // ---- starting one, from a title's source (view-detail's source menu) ----
    var EXT = /\.(mkv|mp4|m4v|avi|ts|webm|mov|wmv|mpe?g)$/i;
    function fileNameFor(stream, label) {
        var bh = stream.behaviorHints || {}, path = ('' + (stream.url || '')).split(/[?#]/)[0];
        var named = typeof bh.filename === 'string' && EXT.test(bh.filename) ? bh.filename : '';
        var ext = (EXT.exec(path) || EXT.exec(named) || ['.mkv'])[0];
        return clean(named || (label + ext));
    }
    function clean(n) { return ('' + n).replace(/[\/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 180); }
    function size(n) { return LocalMedia.humanSize(n) || 'size unknown'; }
    // The drives with their free space: [{ drive, free, fs }]
    function spaces() {
        return LocalMedia.drives().then(function (ds) {
            return U.settleAll(ds.map(function (d) { return function () { return ask('/fsdl/space?path=' + encodeURIComponent(d.root)); }; }), 2).then(function (rs) {
                return ds.map(function (d, i) { return { drive: d, free: rs[i].ok ? rs[i].value.free : null, fs: rs[i].ok ? rs[i].value.fs : '' }; });
            });
        });
    }
    function driveName(d) { return ('' + (d.label || d.root)).replace(/^removable_/, ''); }
    // stream: the source; t: { type, videoId, label (the title, episode code), titleId };
    // ui: { pick(title, options, onPick), confirm(msg, ok, fn) } (the views' popups)
    function start(stream, t, ui) {
        if (!available()) { U.toast('Plug a USB drive into the TV first'); return; }
        var name = fileNameFor(stream, t.label), bytes = +((stream.behaviorHints || {}).videoSize) || 0;
        spaces().then(function (list) {
            if (!list.length) { U.toast('No USB drive'); return; }
            function go(sp) {
                if (bytes && sp.free != null && sp.free < bytes) { U.toast('Not enough space on ' + driveName(sp.drive) + ': it needs ' + size(bytes) + ', ' + size(sp.free) + ' free', 6000); return; }
                if (bytes > 4294967295 && /^(vfat|msdos|fat)/.test(sp.fs || '')) { U.toast(driveName(sp.drive) + ' is FAT32, which can’t hold a file over 4 GB', 6000); return; }
                var dir = sp.drive.root + '/' + FOLDER;
                ui.confirm('Download “' + name + '” (' + size(bytes) + ') to ' + driveName(sp.drive) + (sp.free != null ? ' (' + size(sp.free) + ' free)' : '') +
                    '? It goes into its ' + FOLDER + ' folder; Home › Local shows how it’s going.' + subNote(t.sub), 'Download', function () {
                    var h = stream._headers || {};
                    add({ kind: 'video', title: t.label, name: name, dir: dir, url: stream.url, ua: h.ua || '', ref: h.ref || '', size: bytes || 0,
                        type: t.type, vid: t.videoId, sid: Stremio.sourceId ? Stremio.sourceId(stream) : '',
                        tid: t.titleId, ttype: t.type === 'series' ? 'series' : 'movie', tname: t.name || '', tposter: t.poster || '', tyear: t.year || '' }).then(function () {
                        U.toast('Downloading to ' + driveName(sp.drive) + ': Home › Local shows how it’s going', 5000);
                    }, function (e) { U.toast('Couldn’t start the download: ' + U.problem(e), 6000); });
                    if (t.sub === undefined) { subtitleFor(stream, t, dir, name); }   // (from a source: your language's, when an addon has one)
                    else if (t.sub && t.sub.url) { addSub(t, dir, name, t.sub.url, t.sub.lang); }   // (from the player: the one that's on)
                });
            }
            if (list.length === 1) { go(list[0]); return; }
            ui.pick('Download to which drive?', list.map(function (sp, i) { return ['' + i, driveName(sp.drive) + (sp.free != null ? '   ·   ' + size(sp.free) + ' free' : '')]; }), function (k) { go(list[+k]); });
        }, function () { U.toast('Couldn’t read the USB drives'); });
    }
    // What's said about the subtitle, from the player (t.sub: the one that's on; undefined: from a
    // source, nothing said).
    function subNote(sub) {
        if (sub === undefined) { return ''; }
        if (sub && sub.url) { return ' With the subtitle that’s on' + (sub.name ? ' (' + sub.name + ')' : '') + ', next to it.'; }
        if (sub && sub.embedded) { return ' Its built-in subtitles come with it.'; }
        return ' No subtitle (they’re off).';
    }
    // A subtitle file next to the video: the video's name with the language (Film.en.srt).
    function addSub(t, dir, name, url, lang) {
        var two = (typeof Player !== 'undefined' && Player.lang2) ? (Player.lang2(lang) || (Player.langKey ? Player.lang2(Player.langKey(lang)) : '')) : '', code = two || ('' + (lang || '')).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12) || 'sub';
        var ext = /\.vtt(\?|$)/i.test(url) ? '.vtt' : '.srt';
        add({ kind: 'sub', title: t.label + ' (subtitles)', name: name.replace(/\.[^.]+$/, '') + '.' + code + ext, dir: dir, url: url, size: 0 });
    }
    // A subtitle in your language next to it (Film.en.srt), when a subtitle addon has one.
    function subtitleFor(stream, t, dir, name) {
        var want = (typeof Player !== 'undefined' && Player.getSubCfg) ? Player.getSubCfg().lang : '';
        if (!want || want === 'off' || typeof Stremio === 'undefined') { return; }
        var two = (typeof Player !== 'undefined' && Player.lang2) ? Player.lang2(want) : '';
        Stremio.getSubtitles(t.type, t.videoId).then(function (subs) {
            var hit = (subs || []).filter(function (s) {
                var l = ('' + (s.lang || '')).toLowerCase();
                return /^https?:\/\//.test(s.url || '') && (l === want || (two && (l === two || l.indexOf(two + '-') === 0)));
            })[0];
            if (!hit) { return; }
            addSub(t, dir, name, hit.url, two || want);
        }, function () {});
    }

    return { available: available, items: items, sync: sync, watch: watch, onChange: onChange, add: add, cancel: cancel, clear: clear, retry: retry,
        start: start, fileNameFor: fileNameFor, busy: busy, synced: function () { return _synced; } };
})();
