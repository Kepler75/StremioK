/* TV guide (XMLTV) for IPTV channels. Global namespace: EPG
   Which guide a playlist has (guideUrl: the Guide link you set, else the one the playlist
   names, else an Xtream playlist's own), read by StremioK's service for your channels only
   (their keys as a bitset: see service/index.js, epgControl), and the programs asked for as
   the cards, Home's details strip, the player and a channel's schedule need them. Not in a
   desktop browser (no service). */
var EPG = (function () {
    'use strict';

    // A channel's key, as the service makes it: "i:" and its tvg-id (iptv-org's feed after an @
    // left out: "ElTrece.ar@SD" is a guide's "ElTrece.ar"), or "n:" and its name without
    // capitals, accents, spaces, "TV" or HD / FHD / 4K tags ("El Trece HD": "n:eltrece"). A
    // country at the end (".ar", or a name's " ARG" / " MX": COUNTRY) is kept apart, after a dot
    // ("FOX SPORTS 2 ARG": "n:foxsports2.ar"); a guide's channel answers with it and without
    // (keysAll), so "A24" finds a guide's "A24.ar", and "ESPN 2 MX" doesn't find "Espn2.ar".
    var ACCENTS = { 'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
        'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ñ': 'n', 'ç': 'c' };
    var COUNTRY = { ar: 'ar', arg: 'ar', mx: 'mx', mex: 'mx', us: 'us', usa: 'us', uk: 'uk', gb: 'uk', es: 'es', br: 'br', cl: 'cl', co: 'co', pe: 'pe',
        uy: 'uy', py: 'py', ve: 've', ec: 'ec', bo: 'bo', ca: 'ca', fr: 'fr', de: 'de', it: 'it', pt: 'pt' };
    function parts(kind, s) {
        var t = ('' + (s || '')).toLowerCase().replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/g, function (c) { return ACCENTS[c]; }).trim(), cc = '', m;
        if (kind === 'i') { t = t.replace(/@.*$/, ''); }
        if ((m = /\.([a-z]{2})$/.exec(t))) { cc = m[1]; t = t.slice(0, -3); }
        else if (kind === 'n' && (m = /[\s_-]+([a-z]{2,3})$/.exec(t)) && COUNTRY[m[1]] && t.length > m[0].length) { cc = COUNTRY[m[1]]; t = t.slice(0, -m[0].length); }
        if (kind === 'n') { t = t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b(hd|fhd|uhd|sd|hq|4k|8k|hevc|h265|1080p?|720p?|tv)\b/g, ' '); }
        t = t.replace(/[^a-z0-9]+/g, '');
        if (kind === 'n' && t.length > 4) { t = t.replace(/tv$/, ''); }   // ("CronicaTV")
        return { base: t.slice(0, 60), cc: cc };
    }
    function key(kind, s) { var p = parts(kind, s); return p.base ? kind + ':' + p.base + (p.cc ? '.' + p.cc : '') : ''; }
    function keysAll(kind, s) { var p = parts(kind, s); return !p.base ? [] : p.cc ? [kind + ':' + p.base + '.' + p.cc, kind + ':' + p.base] : [kind + ':' + p.base]; }
    function hash(s) {
        var h = 0x811c9dc5;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
        return h;
    }
    // The keys as a bitset, base64url: 16 bits a key (1,024 to 131,072 in all); a key's hash
    // picks its bit.
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    function bitsFor(keys) {
        var n = 1024, bytes = [], i;
        while (n < keys.length * 16 && n < 131072) { n *= 2; }
        for (i = 0; i < n / 8; i++) { bytes.push(0); }
        keys.forEach(function (k) { if (k) { var b = hash(k) % n; bytes[b >> 3] |= 1 << (b & 7); } });
        var out = '';
        for (i = 0; i < bytes.length; i += 3) {
            var v = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
            out += B64.charAt((v >> 18) & 63) + B64.charAt((v >> 12) & 63) + (i + 1 < bytes.length ? B64.charAt((v >> 6) & 63) : '') + (i + 2 < bytes.length ? B64.charAt(v & 63) : '');
        }
        return out;
    }
    function keysOf(c) { return [c.tvgId ? key('i', c.tvgId) : '', key('n', c.name)].filter(Boolean); }

    // A playlist's guide: yours (p.guide), else the first the playlist names (url-tvg), else an
    // Xtream get.php link's xmltv.php (the same login; also in place of a guide the playlist
    // names on its own server without the login). '' when none.
    function param(q, name) {
        var m = new RegExp('(?:^|&)' + name + '=([^&#]*)').exec(q || '');
        if (!m) { return ''; }
        try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
    }
    function guideUrl(p, named) {
        if (p && p.guide) { return p.guide; }
        var g = (named || []).filter(function (u) { return !!U.parseUrl(u) && /^https?:\/\//i.test(u); })[0];
        var u = U.parseUrl(p && p.url), xt = '';
        if (u && /\/get\.php$/i.test(u.path)) {
            var user = param(u.query, 'username'), pass = param(u.query, 'password');
            if (user && pass) { xt = u.scheme + '://' + u.host + (u.port ? ':' + u.port : '') + u.path.replace(/get\.php$/i, 'xmltv.php') + '?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass); }
        }
        var gu = g && U.parseUrl(g);
        if (g && xt && gu && gu.host === u.host && gu.port === u.port && !param(gu.query, 'username')) { return xt; }   // (its own server's, without the login)
        return g || xt;
    }

    function available() { return typeof YTPlay !== 'undefined' && !!YTPlay.epgLoad && YTPlay.installMode() !== 'browser'; }

    // ---- the guides: asked to read, then waited for ----
    var _guides = {};    // url -> { k, state, at, channels, programmes, partial, error, timer }
    var _byList = {};    // playlist id -> its guide's url ('' none)
    var POLL_MS = [300, 300, 600, 1000, 2000], POLL_MS_LATER = 3000, POLLS = 300, CHECK_MS = 60 * 60 * 1000;
    // Every playlist's guide asked for (again: the service reads one only when it's old), for
    // its channels' keys. After the playlists are read, and every hour. again: a playlist's id,
    // or true for all (its Reload, IPTV.reload): their guides read again now, however new.
    function start(again) {
        if (!available() || typeof IPTV === 'undefined' || !IPTV.channels) { return; }
        var byGuide = {}, force = {};
        _byList = {};
        IPTV.getPlaylists().forEach(function (p) {
            if (p.off) { return; }
            var st = IPTV.status(p.id), url = guideUrl(p, st && st.guides);
            _byList[p.id] = url;
            if (url && !byGuide[url]) { byGuide[url] = []; }
            if (url && (again === true || again === p.id)) { force[url] = true; }
        });
        IPTV.channels().forEach(function (c) {
            var url = _byList[c._playlistId];
            if (url) { byGuide[url].push.apply(byGuide[url], keysOf(c)); }
        });
        var gone = false;
        Object.keys(_guides).forEach(function (url) {   // (a guide no playlist uses any more: dropped)
            if (byGuide[url]) { return; }
            if (_guides[url].timer) { clearTimeout(_guides[url].timer); }
            delete _guides[url];
            forget(url);
            gone = true;
        });
        Object.keys(byGuide).forEach(function (url) { if (byGuide[url].length) { loadGuide(url, bitsFor(byGuide[url]), !!force[url]); } });
        if (!_checker) { _checker = setInterval(function () { start(); }, CHECK_MS); }
        if (gone) { changed(); }
    }
    var _checker = null;
    function loadGuide(url, k, force) {
        var g = _guides[url];
        if (!g || g.k !== k || force) { if (g && g.timer) { clearTimeout(g.timer); } g = _guides[url] = { k: k, state: 'loading' }; }
        else if (g.timer || g.asking) { return; }
        (function ask(n) {
            g.asking = true;
            YTPlay.epgLoad(url, k, force && !n).then(function (r) {
                g.asking = false;
                if (_guides[url] !== g) { return; }
                var was = g.state + '|' + g.at;
                ['state', 'at', 'channels', 'programmes', 'partial', 'error'].forEach(function (f) { g[f] = r && r[f]; });
                if (g.state === 'loading' && n < POLLS) { g.timer = setTimeout(function () { g.timer = null; ask(n + 1); }, n < POLL_MS.length ? POLL_MS[n] : POLL_MS_LATER); }
                if (g.state + '|' + g.at !== was) {
                    if (g.state === 'ready') { forget(url); }   // (read again: what's on, asked again)
                    changed();
                }
            }, function () {
                g.asking = false;
                if (_guides[url] !== g) { return; }
                g.state = 'failed'; g.error = 'StremioK’s service didn’t answer';
                changed();
            });
        })(0);
    }
    // For Settings › IPTV: a playlist's guide and how it stands, or null when it has none.
    function status(playlistId) {
        var url = _byList[playlistId];
        if (!url) { return null; }
        var g = _guides[url] || { state: 'loading' };
        return { url: url, state: g.state, at: g.at || 0, channels: g.channels || 0, programmes: g.programmes || 0, partial: !!g.partial, error: g.error || '' };
    }

    // ---- programs: asked for in batches, kept per channel ----
    var _progs = {};     // channel id -> { at, list: [{ start, stop, title, desc }], full (the whole window) }
    var _icons = {};     // channel id -> its guide's logo (for one the playlist gives none: logo)
    var _want = {}, _wantTimer = null, _asking = 0, BATCH = 60, PROG_MS = 30 * 60 * 1000;
    function channelOf(id) { return (typeof IPTV !== 'undefined' && IPTV.channel) ? IPTV.channel(id) : null; }
    function guideOf(c) { var url = c && _byList[c._playlistId], g = url && _guides[url]; return (g && g.state === 'ready') ? url : ''; }
    function forget(url) { Object.keys(_progs).forEach(function (id) { if (_progs[id].url === url) { delete _progs[id]; } }); }
    function want(ids) {
        (ids || []).forEach(function (id) { if (/^iptv:/.test(id || '')) { _want[id] = 1; } });
        if (!_wantTimer) { _wantTimer = setTimeout(flush, 50); }
    }
    function nowSec() { return Math.floor(Date.now() / 1000); }
    function asList(rows, url) {
        return (rows || []).filter(function (r) { return r && r.length >= 3 && r[1] > r[0]; })
            .map(function (r) {
                var p = { start: +r[0], stop: +r[1], title: '' + r[2], desc: '' + (r[3] || ''), picture: (typeof r[4] === 'string' && U.parseUrl(r[4]) && !(U.urlIsPrivate(r[4]) && !U.urlIsPrivate(url || ''))) ? r[4] : '' };   // (no picture into your home network from a guide on the internet)
                var a = r[5];   // (what it is, from the guide's categories: a film's original title and year)
                if (a && typeof a === 'object') {
                    if (a.m === 'movie' || a.m === 'series') { p.kind = a.m; }
                    if (typeof a.o === 'string' && a.o) { p.orig = a.o.slice(0, 120); }
                    if (+a.y >= 1900 && +a.y <= 2100) { p.year = +a.y; }
                }
                return p;
            });
    }
    // One request a guide at a time per batch (BATCH channels): from now, the next few.
    function flush() {
        _wantTimer = null;
        if (_asking) { _wantTimer = setTimeout(flush, 200); return; }
        var byGuide = {};
        Object.keys(_want).forEach(function (id) {
            var c = channelOf(id), url = guideOf(c);
            if (!url) { return; }   // (no guide, or not read yet: asked again once it is)
            delete _want[id];
            if (fresh(id)) { return; }
            (byGuide[url] = byGuide[url] || []).push(c);
        });
        Object.keys(byGuide).forEach(function (url) {
            var list = byGuide[url];
            for (var i = 0; i < list.length; i += BATCH) { ask(url, list.slice(i, i + BATCH), nowSec(), nowSec() + 6 * 3600, 4, false); }
        });
    }
    function ask(url, chans, from, to, max, full) {
        var keys = [], gen = _gen;
        chans.forEach(function (c) { keys.push.apply(keys, keysOf(c)); });
        _asking++;
        // Resolves { id: programs } for the channels answered ([] when none, or not in the guide),
        // and _unknown: the ids not answered (failed, cut off, not read there, or the guides
        // changed since): kept as they were and asked again, never taken as empty.
        function unknown() { var o = {}; o._unknown = chans.map(function (c) { return c.id; }); return o; }
        return YTPlay.epgGet(url, keys, from, to, max).then(function (r) {
            _asking--;
            if (gen !== _gen || !r || typeof r !== 'object' || r._unread) { return unknown(); }   // (the guides changed since, or no answer to read)
            var cut = {};
            (Array.isArray(r._cut) ? r._cut : []).forEach(function (k) { cut[k] = 1; });
            var out = {}, icons = (r._icons && typeof r._icons === 'object') ? r._icons : {};
            var unk = [];
            chans.forEach(function (c) {
                if (_byList[c._playlistId] !== url) { unk.push(c.id); return; }   // (its playlist's guide is another now)
                var ks = keysOf(c), rows = null;
                for (var i = 0; i < ks.length && !rows; i++) { if (Array.isArray(r[ks[i]])) { rows = r[ks[i]]; } }
                if (!rows && ks.some(function (k) { return cut[k]; })) { unk.push(c.id); return; }   // (cut off: not answered)
                for (var j = 0; j < ks.length; j++) {
                    var icon = icons[ks[j]];
                    // (a guide on the internet can't point one into your home network)
                    if (typeof icon === 'string' && U.parseUrl(icon) && !(U.urlIsPrivate(icon) && !U.urlIsPrivate(url))) { _icons[c.id] = icon; break; }
                }
                var e = { at: Date.now(), url: url, list: asList(rows, url), full: full };
                if (!full && _progs[c.id] && _progs[c.id].full && _progs[c.id].at > Date.now() - PROG_MS) { return; }   // (a whole schedule kept)
                _progs[c.id] = e;
                out[c.id] = e.list;
            });
            trimProgs();
            if (unk.length) { out._unknown = unk; }
            changed();
            return out;
        }, function () { _asking--; return unknown(); });
    }
    // Programs kept for PROGS_KEEP channels at most (the ones read longest ago go first): a long
    // session going through thousands of channels doesn't keep them all.
    var PROGS_KEEP = 400;
    function trimProgs() {
        var ids = Object.keys(_progs);
        if (ids.length <= PROGS_KEEP) { return; }
        ids.sort(function (a, b) { return _progs[a].at - _progs[b].at; }).slice(0, ids.length - PROGS_KEEP).forEach(function (id) { delete _progs[id]; });
    }
    function fresh(id) {
        var e = _progs[id];
        if (!e || Date.now() - e.at > PROG_MS) { return false; }
        var t = nowSec();
        return !e.list.length || e.list[e.list.length - 1].stop > t;   // (what's on, still in what was read)
    }
    // What's on now, and next: { now, next } (either may be null), or null without a guide.
    function now(id) {
        var c = channelOf(id);
        if (!c || !guideOf(c)) { return null; }
        if (!fresh(id)) { want([id]); }
        var e = _progs[id];
        if (!e || e.url !== guideOf(c)) { return null; }
        var t = nowSec(), cur = null, next = null;
        for (var i = 0; i < e.list.length; i++) {
            var p = e.list[i];
            if (!cur && p.start <= t && t < p.stop) { cur = p; continue; }
            if (p.start > t && (!next || p.start < next.start)) { next = p; break; }
        }
        return (cur || next) ? { now: cur, next: next } : null;
    }
    // A channel's schedule, from 2 hours ago to tomorrow: Promise of [{ start, stop, title, desc }].
    function schedule(id) {
        var c = channelOf(id), url = guideOf(c);
        if (!url) { return Promise.resolve([]); }
        return ask(url, [c], nowSec() - 2 * 3600, nowSec() + 30 * 3600, 150, true).then(function (out) { return out[id] || []; });
    }
    function hasGuide(id) { return !!guideOf(channelOf(id)); }
    // A channel's logo from its guide ('' when it gave none, or not asked yet).
    function logo(id) { return _icons[id] || ''; }
    // Whether any guide was read with channels in it (the Guide tab shows then), and the channels
    // that have a guide, in the IPTV tab's order.
    function hasAny() {
        return Object.keys(_byList).some(function (id) { var g = _guides[_byList[id]]; return !!g && g.state === 'ready' && g.channels > 0; });
    }
    function guided() {   // (your favorites first)
        var all = (typeof IPTV !== 'undefined' && IPTV.channels ? IPTV.channels() : []).filter(function (c) { return !!guideOf(c); });
        var fav = IPTV.isFavorite ? all.filter(function (c) { return IPTV.isFavorite(c.id); }) : [];
        return fav.concat(all.filter(function (c) { return fav.indexOf(c) === -1; }));
    }
    // Many channels' programs from 'from' to 'to' (the Guide tab): Promise of { id: programs },
    // RANGE_BATCH channels a request (each answer kept to 2 MB by the service: 150 programs
    // a channel with their pictures and descriptions fit).
    var RANGE_BATCH = 20;
    function range(ids, from, to) {
        var byGuide = {}, jobs = [];
        (ids || []).forEach(function (id) { var c = channelOf(id), url = guideOf(c); if (url) { (byGuide[url] = byGuide[url] || []).push(c); } });
        Object.keys(byGuide).forEach(function (url) {
            var list = byGuide[url];
            for (var i = 0; i < list.length; i += RANGE_BATCH) { jobs.push(ask(url, list.slice(i, i + RANGE_BATCH), Math.floor(from), Math.ceil(to), 150, true)); }
        });
        return Promise.all(jobs).then(function (outs) {
            var all = {}, unknown = [];
            outs.forEach(function (o) { Object.keys(o || {}).forEach(function (id) { if (id === '_unknown') { unknown = unknown.concat(o._unknown); } else { all[id] = o[id]; } }); });
            if (unknown.length) { all._unknown = unknown; }   // (not answered: see ask)
            return all;
        });
    }

    // 20:30, or with the day when it isn't today (Tue 01:00).
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function hhmm(sec) { var d = new Date(sec * 1000); return two(d.getHours()) + ':' + two(d.getMinutes()); }
    function dayTime(sec) {
        var d = new Date(sec * 1000), today = new Date(Date.now());
        var same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
        return (same ? '' : DAYS[d.getDay()] + ' ') + hhmm(sec);
    }

    // Told when a guide is read or programs arrive (once for a burst).
    var _fns = [], _changeTimer = null;
    function onChange(fn) { _fns.push(fn); }
    function changed() {
        if (_changeTimer) { return; }
        _changeTimer = setTimeout(function () {
            _changeTimer = null;
            if (Object.keys(_want).length && !_wantTimer) { _wantTimer = setTimeout(flush, 50); }   // (asked before the guide was read)
            _fns.forEach(function (fn) { try { fn(); } catch (e) {} });
        }, 60);
    }
    // The guide links changed (a playlist's Guide link, its link, its channels): asked again.
    // An answer asked before (an older _gen) is dropped when it comes.
    var _gen = 0;
    function reset() { _gen++; _progs = {}; _icons = {}; _want = {}; start(); }

    return {
        generation: function () { return _gen; },   // (changes when the guides do: what was read before isn't theirs)
        key: key, keysAll: keysAll, bitsFor: bitsFor, guideUrl: guideUrl, available: available, start: start, reset: reset, status: status,
        want: want, now: now, schedule: schedule, hasGuide: hasGuide, logo: logo, hasAny: hasAny, guided: guided, range: range, onChange: onChange, hhmm: hhmm, dayTime: dayTime
    };
})();
