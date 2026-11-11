/* Your Stremio account kept in step with StremioK (Settings › Content › Integrations › Stremio
   account): its Continue Watching, watched marks and Library, both ways. Signing in is the
   import's (js/stremio-account.js: a code approved on your phone); here the sign-in key is kept.

   Stremio keeps one record a title (a "library item", as its own apps keep it: stremio-core):
   where you stopped (one episode a show), how often it's been watched, the episodes watched (a
   packed list of bits in the show's episode order), and whether it's in your Library or was only
   watched. Each has the time it last changed: the newest wins, both ways, as Stremio's own apps
   sync (datastoreMeta: every record's time; datastoreGet the ones newer there; datastorePut the
   ones newer here). What you do here changes the copy kept on the TV at once (its time now), and
   is sent a few seconds later (where you stopped while playing: at most every 3 minutes, as
   Stremio's player does); anything not sent goes with the next sync (launch, every 15 minutes).

   Only films and series are kept, and only titles with an addon's id (IMDb, TMDB, Kitsu…): never
   a USB file, a media server's own item, YouTube or a channel. A show's watched episodes are read
   with its details (its episodes in Stremio's order); written only where the list read here
   matches the one in the account (its last watched episode found in it), never over it.
   Global namespace: StremioSync */
var StremioSync = (function () {
    'use strict';

    var KEY = 'stremiok.stremio';               // { key, user, at }: the sign-in (not in a configuration export)
    var STATE_KEY = 'stremiok.stremio.sync';    // { last, reconnect, err, fails }
    var DATA_KEY = 'stremiok.stremio.items';    // (the TV's database) { items: { id: record }, rm: { id: its time in the account, ms }, eps: { id: { m, v: [video ids] } }, marks: { id: { videoId: 1 | 0 } } }
    var COLLECTION = 'libraryItem';
    var ITEMS_MAX = 4000, GET_CHUNK = 100, PUT_CHUNK = 50, META_MAX = 4 * 1048576, GET_MAX = 4 * 1048576;
    var SEND_MS = 5000, PLAYING_EVERY_MS = 180000, EVERY_MS = 15 * 60 * 1000, EPS_PER_SYNC = 30;
    var ID_OK = /^(tt\d{1,12}|(tmdb|tvdb|kitsu|mal|anilist|anidb|imdb):[\w.-]{1,40})(:\d{1,5}:\d{1,6})?$/;

    // ---------- the sign-in ----------
    function auth() { var a = U.store.get(KEY, null); return (a && typeof a.key === 'string' && a.key) ? a : null; }
    function isConnected() { return !!auth(); }
    function authKey() { var a = auth(); return a ? a.key : ''; }
    function state() { var s = U.store.get(STATE_KEY, null); return (s && typeof s === 'object') ? s : {}; }
    function setState(patch) { var s = state(); Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); U.store.set(STATE_KEY, s); }
    var _gen = 0;   // (disconnecting starts a new one: work under way for the old one changes nothing)

    // Signed in (the key from StremioAccount.wait): the account's email, then a first sync.
    function connect(key) {
        var g = ++_gen;
        return StremioAccount.call('getUser', { type: 'GetUser', authKey: key }).then(function (r) { return r; }, function () { return null; }).then(function (u) {
            if (g !== _gen) { return ''; }
            var user = (u && typeof u.email === 'string') ? U.drawable(u.email).slice(0, 120) : '';
            return _ready.then(function () {
                if (g !== _gen) { return ''; }
                U.store.set(KEY, { key: key, user: user, at: Date.now() });
                U.store.remove(STATE_KEY);
                _data = blank(); dirty(); save();
                sync();
                return user;
            });
        });
    }
    function disconnect() {
        _gen++;
        var k = authKey();
        if (k) { StremioAccount.signOut(k); }
        U.store.remove(KEY); U.store.remove(STATE_KEY);
        if (_timer) { clearTimeout(_timer); _timer = null; }
        if (_every) { clearInterval(_every); _every = null; }
        _syncing = null; _data = blank();
        if (U.bigStore) { U.bigStore.remove(DATA_KEY); } else { U.store.remove(DATA_KEY); }
        changed();
    }
    // A key Stremio no longer takes: nothing more sent until you connect again.
    var _told = false;
    function lostSignIn() {
        if (!isConnected()) { return; }
        setState({ reconnect: true });
        if (!_told) { _told = true; U.toast(U.t('Your Stremio account needs connecting again: Settings › Content › Integrations'), 6000); U.log('stremio', 'Stremio sign-in no longer works: connect again in Settings'); }
    }
    function connectStatus() {
        var a = auth() || {}, s = state();
        return { connected: !!a.key, user: a.user || '', reconnect: !!s.reconnect, lastSync: s.last || 0, pending: pending().length, err: s.err || '' };
    }

    // ---------- the copy kept on the TV ----------
    function blank() { return { items: {}, rm: {}, eps: {}, marks: {} }; }
    var _data = blank(), _loaded = false;
    var _ready = (U.bigStore ? U.bigStore.get(DATA_KEY) : Promise.resolve(U.store.get(DATA_KEY, null, true))).then(function (d) {
        if (!d || typeof d !== 'object') { d = U.store.get(DATA_KEY, null, true); }
        if (isConnected() && d && typeof d === 'object' && d.items && typeof d.items === 'object') {
            ['rm', 'eps', 'marks'].forEach(function (k) { if (!d[k] || typeof d[k] !== 'object') { d[k] = {}; } });
            _data = d;
        }
        _loaded = true;
    }, function () { _loaded = true; });
    var _saveTimer = null;
    function save() {
        if (_saveTimer) { return; }
        _saveTimer = setTimeout(function () {
            _saveTimer = null;
            if (!isConnected()) { return; }
            if (!U.bigStore) { U.store.set(DATA_KEY, _data); return; }
            U.bigStore.set(DATA_KEY, _data).then(function (ok) {
                if (ok) { return; }
                U.bigStore.remove(DATA_KEY, true);
                if (U.store.set(DATA_KEY, _data)) { U.log('storage', 'Your Stremio library is kept in the settings storage instead'); }
            });
        }, 1000);
    }
    function changed() {
        if (typeof Stremio !== 'undefined' && Stremio.addonsChanged) { Stremio.addonsChanged(); }
        if (typeof ViewParts !== 'undefined' && ViewParts.refreshAddonRows) { ViewParts.refreshAddonRows('local:stremio'); }
    }

    // ---------- reading what Stremio sends ----------
    function iso(ms) { return new Date(ms).toISOString(); }
    function ms(x) { var t = typeof x === 'number' ? x : Date.parse(typeof x === 'string' ? x : ''); return t > 0 ? t : 0; }
    function sec(t) { return Math.floor((t || 0) / 1000); }
    function n(x) { return (typeof x === 'number' && isFinite(x) && x >= 0) ? Math.floor(x) : 0; }
    // A record worth keeping: a film or series with an id and a time; its state's numbers checked.
    function usable(it) {
        if (!it || typeof it !== 'object' || typeof it._id !== 'string' || it._id.length > 200 || (it.type !== 'movie' && it.type !== 'series') || !ms(it._mtime)) { return false; }
        if (!it.state || typeof it.state !== 'object') { it.state = {}; }
        var s = it.state;
        ['timeOffset', 'timeWatched', 'overallTimeWatched', 'timesWatched', 'flaggedWatched', 'duration'].forEach(function (k) { s[k] = n(s[k]); });
        if (typeof s.video_id !== 'string' || s.video_id.length > 300) { s.video_id = null; }
        if (typeof s.watched !== 'string' || s.watched.length > 20000) { s.watched = null; }
        it.removed = it.removed === true; it.temp = it.temp === true;
        return true;
    }
    function mtime(it) { return ms(it && it._mtime); }
    function nameOf(it) { return U.drawable('' + (it.name || '')).slice(0, 200); }
    function posterOf(it) {
        var p = typeof it.poster === 'string' ? it.poster : '';
        return /^https?:\/\//.test(p) ? p : (/^tt\d+$/.test(it._id) ? 'https://images.metahub.space/poster/small/' + it._id + '/img' : '');
    }

    // ---------- Stremio's watched episodes: a packed list of bits ----------
    // "{last watched video id}:{its place + 1}:{base64 of the zlib-packed bytes}", bit i (low bit
    // first) for the i-th video in the show's order: season, then episode, then release date.
    function videoOrder(meta) {
        var vids = ((meta && meta.videos) || []).filter(function (v) { return v && typeof v.id === 'string'; }).map(function (v, i) {
            var s = typeof v.season === 'number' ? v.season : -Infinity, e = typeof v.episode === 'number' ? v.episode : (typeof v.number === 'number' ? v.number : -Infinity);
            return { id: v.id, s: s, e: e, r: ms(v.released) || -Infinity, i: i, released: v.released };
        });
        vids.sort(function (a, b) { return (a.s - b.s) || (a.e - b.e) || ((a.r === b.r) ? 0 : (a.r < b.r ? -1 : 1)) || (a.i - b.i); });   // (the place in the list last: a stable order)
        return vids;
    }
    // The bits as the account has them, laid on this list of videos (moved by where the last
    // watched one is now); null: that one isn't in the list (a different list: not ours to read).
    function readBits(field, ids) {
        var bits = [], i;
        for (i = 0; i < ids.length; i++) { bits.push(false); }
        if (!field) { return bits; }
        var parts = ('' + field).split(':');
        if (parts.length < 3) { return null; }
        var packed = parts.pop(), len = parseInt(parts.pop(), 10), anchor = parts.join(':'), bytes = unpack(packed);
        if (!bytes || isNaN(len)) { return null; }
        var at = ids.indexOf(anchor);
        if (at === -1) { return anchor === 'undefined' ? bits : null; }
        var offset = len - at - 1;
        for (i = 0; i < ids.length; i++) {
            var j = i + offset;
            if (j >= 0 && j < bytes.length * 8) { bits[i] = ((bytes[j >> 3] >> (j & 7)) & 1) === 1; }
        }
        return bits;
    }
    function writeBits(bits, ids) {
        var bytes = [], last = -1, i;
        for (i = 0; i < Math.ceil(ids.length / 8); i++) { bytes.push(0); }
        for (i = 0; i < bits.length; i++) { if (bits[i]) { bytes[i >> 3] |= 1 << (i & 7); last = i; } }
        return (last >= 0 ? ids[last] : (ids.length ? ids[0] : 'undefined')) + ':' + (Math.max(last, 0) + 1) + ':' + pack(bytes);
    }
    function pack(bytes) {   // (zlib, stored as is: tiny, and any zlib reader takes it)
        var out = [0x78, 0x01], a = 1, b = 0, i, at = 0;
        do {
            var len = Math.min(65535, bytes.length - at), last = at + len >= bytes.length;
            out.push(last ? 1 : 0, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255);
            for (i = at; i < at + len; i++) { out.push(bytes[i]); }
            at += len;
        } while (at < bytes.length);
        for (i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
        out.push((b >> 8) & 255, b & 255, (a >> 8) & 255, a & 255);
        var s = '';
        for (i = 0; i < out.length; i++) { s += String.fromCharCode(out[i]); }
        return btoa(s);
    }
    function unpack(b64) {
        var s;
        try { s = atob(b64); } catch (e) { return null; }
        var bytes = [];
        for (var i = 0; i < s.length; i++) { bytes.push(s.charCodeAt(i) & 255); }
        try { return inflate(bytes); } catch (e2) { return null; }
    }
    // zlib's inflate (stored, fixed and dynamic blocks), for these few bytes: at most OUT_MAX out.
    var OUT_MAX = 65536;
    var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    function inflate(src) {
        if (src.length < 6 || (src[0] & 15) !== 8 || ((src[0] << 8) | src[1]) % 31 || (src[1] & 32)) { throw new Error('not zlib'); }
        var pos = 2, bit = 0, out = [];
        function bits(k) {
            var v = 0;
            for (var i = 0; i < k; i++) {
                if (pos >= src.length) { throw new Error('short'); }
                v |= ((src[pos] >> bit) & 1) << i;
                if (++bit === 8) { bit = 0; pos++; }
            }
            return v;
        }
        function table(lengths) {
            var count = [], offs = [0, 0], sym = [], i;
            for (i = 0; i <= 15; i++) { count[i] = 0; }
            for (i = 0; i < lengths.length; i++) { count[lengths[i]]++; }
            count[0] = 0;
            for (i = 1; i < 15; i++) { offs[i + 1] = offs[i] + count[i]; }
            for (i = 0; i < lengths.length; i++) { if (lengths[i]) { sym[offs[lengths[i]]++] = i; } }
            return { count: count, sym: sym };
        }
        function decode(h) {
            var code = 0, first = 0, index = 0;
            for (var len = 1; len <= 15; len++) {
                code |= bits(1);
                var c = h.count[len];
                if (code - c < first) { return h.sym[index + (code - first)]; }
                index += c; first += c; first <<= 1; code <<= 1;
            }
            throw new Error('bad code');
        }
        function put(x) { if (out.length >= OUT_MAX) { throw new Error('too long'); } out.push(x); }
        function codes(lit, dist) {
            for (;;) {
                var s = decode(lit);
                if (s < 256) { put(s); continue; }
                if (s === 256) { return; }
                s -= 257;
                if (s >= 29) { throw new Error('bad length'); }
                var len = LBASE[s] + bits(LEXT[s]), d = decode(dist);
                if (d >= 30) { throw new Error('bad distance'); }
                var back = DBASE[d] + bits(DEXT[d]);
                if (back > out.length) { throw new Error('too far'); }
                for (var k = 0; k < len; k++) { put(out[out.length - back]); }
            }
        }
        var fixedLit = null, fixedDist = null, last;
        do {
            last = bits(1);
            var type = bits(2), i;
            if (type === 0) {
                if (bit) { bit = 0; pos++; }
                if (pos + 4 > src.length) { throw new Error('short'); }
                var len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
                if ((len ^ 0xffff) !== nlen || pos + 4 + len > src.length) { throw new Error('bad stored'); }
                for (i = 0; i < len; i++) { put(src[pos + 4 + i]); }
                pos += 4 + len;
            } else if (type === 1) {
                if (!fixedLit) {
                    var l = [];
                    for (i = 0; i < 288; i++) { l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8); }
                    fixedLit = table(l);
                    var dl = [];
                    for (i = 0; i < 30; i++) { dl.push(5); }
                    fixedDist = table(dl);
                }
                codes(fixedLit, fixedDist);
            } else if (type === 2) {
                var nlit = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, cl = [], lens = [];
                for (i = 0; i < 19; i++) { cl.push(0); }
                for (i = 0; i < ncode; i++) { cl[CLORDER[i]] = bits(3); }
                var clt = table(cl);
                while (lens.length < nlit + ndist) {
                    var sym = decode(clt), rep = 0, val = 0;
                    if (sym < 16) { lens.push(sym); continue; }
                    if (sym === 16) { if (!lens.length) { throw new Error('bad repeat'); } val = lens[lens.length - 1]; rep = 3 + bits(2); }
                    else if (sym === 17) { rep = 3 + bits(3); }
                    else { rep = 11 + bits(7); }
                    if (lens.length + rep > nlit + ndist) { throw new Error('too many lengths'); }
                    while (rep--) { lens.push(val); }
                }
                codes(table(lens.slice(0, nlit)), table(lens.slice(nlit)));
            } else { throw new Error('bad block'); }
        } while (!last);
        return out;
    }

    // ---------- what StremioK reads from it ----------
    function idOk(id) { return ID_OK.test('' + id); }
    function showOf(type, id) { return type === 'series' ? ('' + id).replace(/:\d+:\d+$/, '') : '' + id; }
    function item(type, id) { var it = _data.items[showOf(type, id)]; return (it && it.type === type) ? it : null; }
    function seOf(vid) { var p = /:(\d+):(\d+)$/.exec('' + vid); return p ? [+p[1], +p[2]] : null; }
    function further(a, b) { var x = seOf(a), y = seOf(b); return !!(x && y && (x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]))); }
    // When the account has it watched (ms), 0: not watched (or not known).
    var _watchedIdx = null;
    function watchedIdx() {
        if (_watchedIdx) { return _watchedIdx; }
        var m = {};
        Object.keys(_data.items).forEach(function (id) {
            var it = _data.items[id], at = ms(it.state.lastWatched) || mtime(it);
            if (it.type === 'movie' && (it.state.timesWatched > 0 || it.state.flaggedWatched > 0)) { m['movie:' + id] = at; }
            var e = _data.eps[id];
            if (it.type === 'series' && e) { (e.v || []).forEach(function (v) { m['series:' + v] = at; }); }   // (an older read until it's read again)
        });
        _watchedIdx = m;
        return m;
    }
    function dirty() { _watchedIdx = null; }
    function watchedAt(type, id) { return isConnected() ? (watchedIdx()[type + ':' + id] || 0) : 0; }
    // Continue Watching as the account has it: what's been started (or queued: an episode at the
    // start), a show at its episode. Records it calls removed only once watched (as Stremio's do).
    function continueList() {
        if (!isConnected()) { return []; }
        var out = [];
        Object.keys(_data.items).forEach(function (id) {
            var it = _data.items[id], s = it.state;
            if ((it.removed && !it.temp) || !s.timeOffset || !idOk(id)) { return; }
            var vid = it.type === 'series' ? s.video_id : id;
            if (it.type === 'series' && (!vid || !seOf(vid))) { return; }
            var se = seOf(vid);
            out.push({ id: vid, type: it.type, parent: id, name: nameOf(it) + (it.type === 'series' ? '  S' + se[0] + 'E' + se[1] : ''), poster: posterOf(it),
                position: s.timeOffset > 1000 ? Math.floor(s.timeOffset / 1000) : 0, duration: Math.floor(s.duration / 1000), updated: ms(s.lastWatched) || mtime(it), _stremio: true });
        });
        return out;
    }
    // A place kept on this TV that the account has you past since: a film watched since, a show
    // moved on to a later episode (or this one watched).
    function watchedPast(e) {
        if (!isConnected() || !e || !e.updated) { return false; }
        var it = item(e.type, e.parent || e.id);
        if (!it || (ms(it.state.lastWatched) || mtime(it)) <= e.updated) { return false; }
        if (e.type === 'movie') { return it.state.timesWatched > 0 && !it.state.timeOffset; }
        return further(it.state.video_id, e.id) || watchedAt('series', e.id) > e.updated;
    }
    function inLibrary(type, id) { var it = item(type, id); return !!(it && !it.removed && !it.temp); }
    // The Library as Home rows (Movies, Series) and in Discover: the latest added first.
    function synthCatalog(catId, extra) {
        var type = catId === 'stremio_library_movies' ? 'movie' : 'series', skip = (extra && +extra.skip) || 0;
        return _ready.then(function () {
            var list = Object.keys(_data.items).map(function (id) { return _data.items[id]; }).filter(function (it) { return it.type === type && !it.removed && !it.temp && idOk(it._id); });
            list.sort(function (a, b) { return (ms(b._ctime) || mtime(b)) - (ms(a._ctime) || mtime(a)); });
            return list.slice(skip, skip + 100).map(function (it) { return { id: it._id, type: it.type, name: nameOf(it) || it._id, poster: posterOf(it), posterShape: 'poster' }; });
        });
    }
    function synthAddon() {
        return {
            __local: true, __impl: { catalog: synthCatalog }, url: 'local:stremio', base: 'local:stremio',
            manifest: { id: 'org.stremiok.stremio-library', name: U.t('Stremio Library'), version: '1.0.0', types: ['movie', 'series'], resources: ['catalog'],
                catalogs: [{ type: 'movie', id: 'stremio_library_movies', name: U.t('Stremio Library'), extra: [{ name: 'skip' }] },
                    { type: 'series', id: 'stremio_library_shows', name: U.t('Stremio Library'), extra: [{ name: 'skip' }] }] }
        };
    }

    // ---------- what StremioK changes ----------
    // The record for a title (a new one as Stremio makes it: only watched, not in the Library);
    // null: not one for the account. m: { name, poster } when it's new.
    function record(type, show, m) {
        if ((type !== 'movie' && type !== 'series') || !idOk(show)) { return null; }
        var it = _data.items[show];
        if (it && it.type === type) { return it; }
        var kept = (typeof Stremio !== 'undefined' && Stremio.metaKept) ? Stremio.metaKept(type, show) : null;
        m = m || {};
        var now = iso(Date.now());
        it = { _id: show, name: ('' + ((kept && kept.name) || m.name || '')).replace(/\s+S\d+E\d+$/, '').slice(0, 200), type: type,
            poster: (kept && kept.poster) || m.poster || '', posterShape: 'poster', removed: true, temp: true, _ctime: now, _mtime: now,
            state: { lastWatched: now, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false },
            behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false } };
        _data.items[show] = it;
        return it;
    }
    function touched(it) { it._mtime = iso(Math.max(Date.now(), mtime(it) + 1000)); dirty(); save(); }
    function when(fn) { if (!isConnected()) { return; } if (_loaded) { fn(); } else { _ready.then(function () { if (isConnected()) { fn(); } }); } }

    // A playback's place (Player's own saves: while it plays, and on stopping). final: stopped or
    // left (sent soon); otherwise at most every PLAYING_EVERY_MS.
    var _last = { key: '', cur: 0, at: 0, sent: 0 };
    function onProgress(ctx, cur, dur, final) {
        if (!ctx || ctx.addonType || !dur || cur < 5) { return; }
        when(function () {
            var type = ctx.type, vid = '' + ctx.id, show = type === 'series' ? (ctx.parent || showOf(type, vid)) : vid;
            if (type === 'series' && !seOf(vid)) { return; }
            var it = record(type, show, { name: ctx.name, poster: ctx.poster });
            if (!it) { return; }
            var s = it.state, key = show + '|' + vid, now = Date.now(), video = type === 'series' ? vid : show;
            if (s.video_id !== video) {
                s.overallTimeWatched += s.timeWatched; s.timeWatched = 0; s.flaggedWatched = 0; s.video_id = video;
            } else if (_last.key === key) {
                var moved = (cur - _last.cur) * 1000;   // (watched since the last save: at most the time that's passed)
                if (moved > 0) { moved = Math.min(moved, now - _last.at + 1000); s.timeWatched += moved; s.overallTimeWatched += moved; }
            }
            s.timeOffset = Math.max(1, Math.floor(cur * 1000)); s.duration = Math.floor(dur * 1000); s.lastWatched = iso(now);
            if (it.temp && !s.timesWatched) { it.removed = true; }
            if (it.removed) { it.temp = true; }
            _last = { key: key, cur: cur, at: now, sent: _last.key === key ? _last.sent : 0 };
            touched(it);
            if (final || now - _last.sent >= PLAYING_EVERY_MS) { _last.sent = now; sendSoon(); }
        });
    }
    // Watched / not watched (however it's marked here): a film's count; an episode's bit (set when
    // its show's episodes are read, before it's sent). A finished episode or film leaves Continue
    // Watching there too.
    function onMarked(type, ids, on) {
        when(function () {
            var shows = {};
            (ids || []).forEach(function (id) {
                id = '' + id;
                if (type === 'movie') {
                    var it = on ? record('movie', id, null) : item('movie', id);
                    if (!it) { return; }
                    if (on) { it.state.timesWatched += 1; it.state.flaggedWatched = 1; it.state.lastWatched = iso(Date.now()); it.state.timeOffset = 0; }
                    else { it.state.timesWatched = 0; it.state.flaggedWatched = 0; }
                    touched(it);
                } else if (type === 'series' && seOf(id)) {
                    var show = showOf('series', id), r = on ? record('series', show, null) : item('series', show);
                    if (!r) { return; }
                    (_data.marks[show] = _data.marks[show] || {})[id] = on ? 1 : 0;
                    if (on && r.state.video_id === id) { r.state.timeOffset = 0; }
                    shows[show] = r;
                }
            });
            Object.keys(shows).forEach(function (k) { touched(shows[k]); });
            sendSoon();
        });
    }
    // Put in Continue Watching here (the next episode queued, or "Add to Continue Watching"): there
    // too, at its start, as Stremio's own player queues the next episode.
    function onAdded(e) {
        if (!e) { return; }
        when(function () {
            var vid = '' + e.id, show = e.type === 'series' ? (e.parent || showOf('series', vid)) : vid;
            if (e.type === 'series' && !seOf(vid)) { return; }
            var it = record(e.type, show, e);
            if (!it) { return; }
            var s = it.state, video = e.type === 'series' ? vid : show;
            if (s.video_id !== video) { s.overallTimeWatched += s.timeWatched; s.timeWatched = 0; s.flaggedWatched = 0; s.video_id = video; s.timeOffset = 1; }
            else { s.timeOffset = Math.max(1, s.timeOffset); }
            s.lastWatched = iso(Date.now());
            touched(it);
            sendSoon();
        });
    }
    // Off Continue Watching (Remove): there too (Stremio's "rewind": its place cleared).
    function dismiss(type, id) {
        when(function () {
            var it = item(type, id);
            if (!it || !it.state.timeOffset) { return; }
            if (type === 'series' && seOf(id) && it.state.video_id && it.state.video_id !== '' + id && further(it.state.video_id, id)) { return; }   // (the account has it at a later episode)
            it.state.timeOffset = 0;
            touched(it);
            sendSoon();
        });
    }
    function setInLibrary(type, meta, on) {
        when(function () {
            var it = on ? record(type, meta.id, meta) : item(type, meta.id);
            if (!it) { return; }
            if (on) { if (meta.name) { it.name = ('' + meta.name).slice(0, 200); } if (meta.poster) { it.poster = meta.poster; } }
            it.removed = !on; it.temp = false;
            touched(it);
            changed();
            sendSoon();
        });
    }

    // ---------- talking to the account ----------
    function call(method, body, max) {
        var g = _gen;
        body.authKey = authKey();
        return StremioAccount.call(method, body, max).then(function (r) { if (g !== _gen) { throw { stale: true }; } return r; }, function (e) {
            if (g === _gen && e && (e.code === 1 || /session|auth/i.test(e.message || ''))) { lostSignIn(); }
            throw e;
        });
    }
    function pending() {
        return Object.keys(_data.items).filter(function (id) {
            var it = _data.items[id];
            return idOk(id) && sec(mtime(it)) > sec(_data.rm[id] || 0) && !(it.removed && mtime(it) < Date.now() - 365 * 86400000);
        });
    }
    // Episode marks made here, laid on the account's bits (the show's episodes read first).
    function applyMarks() {
        var shows = Object.keys(_data.marks);
        return shows.reduce(function (p, show) {
            return p.then(function () {
                var it = _data.items[show], marks = _data.marks[show];
                if (!it || it.type !== 'series') { delete _data.marks[show]; return; }
                return Stremio.getMeta('series', show).then(function (meta) {
                    var vids = videoOrder(meta), ids = vids.map(function (v) { return v.id; }), bits = readBits(it.state.watched, ids);
                    delete _data.marks[show];
                    if (!bits || !ids.length) { U.log('stremio', 'Watched episodes of ' + (nameOf(it) || show) + ' not sent: its episode list differs from your Stremio account’s'); return; }
                    var newest = ms(it.state.lastWatched);
                    Object.keys(marks).forEach(function (vid) {
                        var at = ids.indexOf(vid);
                        if (at === -1) { return; }
                        bits[at] = marks[vid] === 1;
                        if (marks[vid] === 1 && ms(vids[at].released) > newest) { newest = ms(vids[at].released); }
                    });
                    it.state.watched = writeBits(bits, ids);
                    if (newest) { it.state.lastWatched = iso(Math.min(newest, Date.now())); }
                    touched(it);
                    _data.eps[show] = { m: mtime(it), v: ids.filter(function (x, i) { return bits[i]; }) };
                }, function () {});   // (its details not read now: kept for the next sync)
            });
        }, Promise.resolve());
    }
    function push(ids) {
        var chunks = [];
        for (var i = 0; i < ids.length; i += PUT_CHUNK) { chunks.push(ids.slice(i, i + PUT_CHUNK)); }
        return chunks.reduce(function (p, chunk) {
            return p.then(function () {
                var items = chunk.map(function (id) { return _data.items[id]; }).filter(Boolean);
                var times = items.map(function (it) { return mtime(it); });   // (as sent: a change made while it's under way is newer, and goes next)
                return call('datastorePut', { collection: COLLECTION, changes: items }).then(function () {
                    items.forEach(function (it, i) { _data.rm[it._id] = Math.max(_data.rm[it._id] || 0, times[i]); });
                    save();
                });
            });
        }, Promise.resolve());
    }
    function pull(ids) {
        var chunks = [];
        for (var i = 0; i < ids.length; i += GET_CHUNK) { chunks.push(ids.slice(i, i + GET_CHUNK)); }
        return chunks.reduce(function (p, chunk) {
            return p.then(function () {
                return call('datastoreGet', { collection: COLLECTION, ids: chunk, all: false }, GET_MAX).then(function (list) {
                    (Array.isArray(list) ? list : []).forEach(function (it) {
                        if (!it || typeof it._id !== 'string') { return; }
                        var t = ms(it._mtime), mine = _data.items[it._id];
                        if (usable(it) && mine && !_data.rm[it._id]) { _data.items[it._id] = merged(it, mine); }   // (made here before the account's was read)
                        else if (usable(it) && t >= mtime(mine)) { _data.items[it._id] = it; }
                        if (t) { _data.rm[it._id] = Math.max(_data.rm[it._id] || 0, t); }
                    });
                    dirty(); save();
                });
            });
        }, Promise.resolve());
    }
    // A record made here (never sent) for a title the account has a record of: the account's, with
    // what was done here laid on (its place when newer, watched counts, in the Library); episode
    // marks are kept apart and laid on its watched episodes when sent. Newer than both: it's sent.
    function merged(theirs, mine) {
        var a = theirs.state, b = mine.state;
        if (ms(b.lastWatched) > ms(a.lastWatched) && b.timeOffset) {
            ['video_id', 'timeOffset', 'duration', 'timeWatched', 'lastWatched'].forEach(function (k) { a[k] = b[k]; });
        }
        a.timesWatched = Math.max(a.timesWatched, b.timesWatched); a.flaggedWatched = Math.max(a.flaggedWatched, b.flaggedWatched);
        if (b.flaggedWatched && !b.timeOffset && (mine.type === 'movie' || a.video_id === b.video_id)) { a.timeOffset = 0; }   // (finished here)
        if (!mine.removed) { theirs.removed = false; theirs.temp = false; }
        theirs._mtime = iso(Math.max(Date.now(), mtime(theirs) + 1000, mtime(mine)));
        return theirs;
    }
    // A show's watched episodes read (its details: the episode order), for the ones that changed.
    function readEpisodes() {
        var todo = Object.keys(_data.items).filter(function (id) {
            var it = _data.items[id], e = _data.eps[id];
            return it.type === 'series' && it.state.watched && !_data.marks[id] && (!e || e.m !== mtime(it)) && idOk(id);
        }).slice(0, EPS_PER_SYNC);
        return todo.reduce(function (p, id) {
            return p.then(function () {
                return Stremio.getMeta('series', id).then(function (meta) {
                    var it = _data.items[id];
                    if (!it) { return; }
                    var ids = videoOrder(meta).map(function (v) { return v.id; }), bits = readBits(it.state.watched, ids);
                    _data.eps[id] = { m: mtime(it), v: bits ? ids.filter(function (x, i) { return bits[i]; }) : [] };
                    dirty(); save();
                }, function () {});
            });
        }, Promise.resolve());
    }
    // Only so many records kept: the oldest go (not ones waiting to be sent).
    function trim() {
        var ids = Object.keys(_data.items);
        if (ids.length <= ITEMS_MAX) { return; }
        var wait = {};
        pending().forEach(function (id) { wait[id] = 1; });
        ids.sort(function (a, b) { return mtime(_data.items[b]) - mtime(_data.items[a]); });
        ids.slice(ITEMS_MAX).forEach(function (id) { if (!wait[id]) { delete _data.items[id]; delete _data.eps[id]; } });
    }

    // Both ways: what's newer there read, the episode marks made here laid on, what's newer here
    // sent, then the shows' watched episodes read. sendOnly: only the sending (a change made here).
    // One at a time (one under way is shared, and a send asked meanwhile follows it); a failure
    // waits for the next.
    var _syncing = null, _again = false;
    function sync(sendOnly) {
        if (!isConnected() || state().reconnect) { return Promise.resolve(); }
        if (_syncing) { if (sendOnly) { _again = true; } return _syncing; }
        startEvery();
        var g = _gen, p = _ready.then(function () {
            if (sendOnly) { return null; }
            return call('datastoreMeta', { collection: COLLECTION }, META_MAX).then(compare);
        }).then(applyMarks).then(function () { return push(pending()); }).then(function () {
            if (sendOnly) { return; }
            trim();
            return readEpisodes();
        }).then(function () {
            if (g !== _gen) { return; }
            setState(sendOnly ? { err: '' } : { last: Date.now(), err: '' });
        }, function (e) {
            if (g !== _gen || (e && e.stale)) { return; }
            setState({ err: (e && e.message) || U.t('couldn’t reach Stremio') });
            U.log('stremio', 'Stremio sync: ' + ((e && e.message) || 'failed'));
        }).then(function () {
            if (_syncing === p) { _syncing = null; }
            if (g !== _gen) { return; }
            dirty(); save();
            if (!sendOnly) { changed(); }
            if (_again) { _again = false; sendSoon(); }
        });
        _syncing = p;
        return p;
    }
    // The account's records' times against the ones kept here: the newer ones there read.
    function compare(list) {
        var remote = {}, want = [];
        (Array.isArray(list) ? list : []).forEach(function (x) {
            var id = Array.isArray(x) ? x[0] : null, t = Array.isArray(x) ? ms(x[1]) : 0;
            if (typeof id !== 'string' || !t) { return; }
            remote[id] = t;
            var it = _data.items[id];
            if (it ? (sec(mtime(it)) < sec(t) || !_data.rm[id]) : sec(_data.rm[id] || 0) < sec(t)) { want.push(id); }   // (one made here, never sent: read, to be merged)
        });
        Object.keys(remote).forEach(function (id) { if (_data.items[id] && _data.rm[id] && sec(_data.rm[id]) < sec(remote[id]) && sec(mtime(_data.items[id])) >= sec(remote[id])) { _data.rm[id] = remote[id]; } });   // (not one made here and never sent: that's merged)
        want.sort(function (a, b) { return remote[b] - remote[a]; });
        return pull(want.slice(0, ITEMS_MAX));
    }
    // Sent a few seconds after a change (however many), with a sync of its own.
    var _timer = null, _every = null;
    function sendSoon() {
        if (_timer) { clearTimeout(_timer); }
        _timer = setTimeout(function () { _timer = null; sync(true); }, SEND_MS);
    }
    function startEvery() {
        if (_every) { return; }
        _every = setInterval(function () {
            if (!isConnected()) { clearInterval(_every); _every = null; return; }
            if (U.isHidden && U.isHidden()) { return; }
            sync();
        }, EVERY_MS);
    }

    return {
        isConnected: isConnected, authKey: authKey, connect: connect, disconnect: disconnect, connectStatus: connectStatus, sync: sync,
        watchedAt: watchedAt, continueList: continueList, watchedPast: watchedPast, inLibrary: inLibrary, setInLibrary: setInLibrary, synthAddon: synthAddon,
        onProgress: onProgress, onMarked: onMarked, onAdded: onAdded, dismiss: dismiss,
        __bits: { readBits: readBits, writeBits: writeBits, pack: pack, unpack: unpack, videoOrder: videoOrder }
    };
})();
