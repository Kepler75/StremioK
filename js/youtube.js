/* StremioK's own YouTube: your YouTube catalogs (channels, playlists, searches) and YouTube
   search, as a built-in addon like IPTV's (Home rows, Discover, Search rows). The YouTube
   service on the TV (service/index.js /ytlist, /ytinfo) asks YouTube for the lists, from
   the TV's own connection; videos play through it as any YouTube video does.
   Ids: ytk:v:<video> · ytk:c:<channel UC…> · ytk:p:<playlist>. A channel or playlist opens
   as a series of its videos (see view-detail's asEpisodeList).
   Global namespace: YouTube */
var YouTube = (function () {
    'use strict';

    var KEY = 'stremiok.youtube';   // { catalogs: [{ id, name, type, src, kind, sort, off }], search: bool, sb: bool, sbModes: { cat: mode }, dearrow: { titles, thumbs } }
    var MAX_CATALOGS = 40;
    var KINDS = ['auto', 'videos', 'channels', 'live'];
    var SORTS = ['relevance', 'date', 'views', 'rating'];
    var KIND_NAMES = { auto: 'Auto (what the source is)', videos: 'Videos', channels: 'Channels', live: 'Live now' };
    var SORT_NAMES = { relevance: 'Relevance', date: 'Upload date', views: 'View count', rating: 'Rating' };
    // SponsorBlock's sections, what each is called, and what's done with it by default:
    // skip (jump over it), ask (a "Skip …" button), show (on the progress bar only), off.
    // The highlight is a button on the UP bar; a whole-video label, a note when it starts.
    var SB_CATS = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic', 'filler', 'poi_highlight', 'exclusive_access'];
    var SB_NAMES = { sponsor: 'Sponsor', selfpromo: 'Self-promotion', interaction: 'Interaction reminder', intro: 'Intro', outro: 'Endcards / credits',
        preview: 'Preview / recap', music_offtopic: 'Non-music section', filler: 'Filler / tangent', poi_highlight: 'Highlight', exclusive_access: 'Exclusive access' };
    var SB_DEFAULTS = { sponsor: 'skip', selfpromo: 'ask', interaction: 'ask', intro: 'show', outro: 'show', preview: 'show', music_offtopic: 'show', filler: 'show',
        poi_highlight: 'show', exclusive_access: 'show' };
    var SB_MODE_NAMES = { skip: 'Skip', ask: 'Ask (a Skip button)', show: 'Show on the bar', off: 'Off' };
    function sbModesFor(cat) { return (cat === 'poi_highlight' || cat === 'exclusive_access') ? ['show', 'off'] : ['skip', 'ask', 'show', 'off']; }

    // ----- your catalogs -----
    function cfg() {
        var c = U.store.get(KEY, null) || {};
        var list = Array.isArray(c.catalogs) ? c.catalogs : [];
        var modes = {}, saved = (c.sbModes && typeof c.sbModes === 'object') ? c.sbModes : {}, da = (c.dearrow && typeof c.dearrow === 'object') ? c.dearrow : {};
        SB_CATS.forEach(function (k) { modes[k] = sbModesFor(k).indexOf(saved[k]) !== -1 ? saved[k] : SB_DEFAULTS[k]; });
        return {
            search: c.search !== false,   // (on unless turned off)
            sb: c.sb !== false, sbModes: modes,
            titles: c.titles === 'english' ? 'english' : 'original',   // (video titles: as uploaded, or as YouTube translates them)
            dearrow: { titles: da.titles !== false, thumbs: da.thumbs !== false },
            catalogs: list.filter(function (x) { return x && typeof x.id === 'string' && typeof x.src === 'string' && x.src.trim(); }).map(function (x) {
                return { id: x.id, name: ('' + (x.name || x.src)).slice(0, 80), type: ('' + (x.type || 'YouTube')).slice(0, 30) || 'YouTube',
                    src: x.src.trim().slice(0, 300), kind: KINDS.indexOf(x.kind) !== -1 ? x.kind : 'auto',
                    sort: SORTS.indexOf(x.sort) !== -1 ? x.sort : 'relevance', off: x.off === true };
            }).slice(0, MAX_CATALOGS)
        };
    }
    function save(c) {
        U.store.set(KEY, c); _pages = {};
        if (typeof Stremio !== 'undefined' && Stremio.addonsChanged) { Stremio.addonsChanged(); }   // (the addon list is rebuilt with these)
    }
    function catalogs() { return cfg().catalogs; }
    function searchOn() { return cfg().search; }
    function setSearch(on) { var c = cfg(); c.search = !!on; save(c); }
    // SponsorBlock and DeArrow (asked through the service: see its /ytsb)
    function sbOn() { return cfg().sb; }
    function setSbOn(on) { var c = cfg(); c.sb = !!on; U.store.set(KEY, c); }
    function sbMode(cat) { var c = cfg(); return c.sb ? (c.sbModes[cat] || 'off') : 'off'; }
    function sbModes() { return cfg().sbModes; }
    function setSbMode(cat, mode) { var c = cfg(); if (sbModesFor(cat).indexOf(mode) === -1) { return; } c.sbModes[cat] = mode; U.store.set(KEY, c); }
    function dearrow() { return cfg().dearrow; }
    function setDearrow(patch) {   // (the lists are asked again: their titles change)
        var c = cfg();
        if (patch.titles !== undefined) { c.dearrow.titles = !!patch.titles; }
        if (patch.thumbs !== undefined) { c.dearrow.thumbs = !!patch.thumbs; }
        save(c);
    }
    function originalTitles() { return cfg().titles === 'original'; }
    function setOriginalTitles(on) { var c = cfg(); c.titles = on ? 'original' : 'english'; save(c); }   // (the lists are asked again)
    function wantBrand() { var d = dearrow(); return d.titles || d.thumbs; }
    function dearrowThumb(id, at) { return 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=' + id + '&time=' + at; }
    // A video's SponsorBlock sections and DeArrow title / thumbnail: { segments, brand }, or
    // null when the service couldn't ask (kept per video for this session).
    var _extras = U.lru(100);
    function videoExtras(id) {
        if (!/^[A-Za-z0-9_-]{11}$/.test('' + id)) { return Promise.resolve(null); }
        var hit = _extras.get(id);
        if (hit) { return hit; }
        var ready = (typeof YTPlay !== 'undefined' && YTPlay.ensureService) ? YTPlay.ensureService() : Promise.resolve();
        var p = ready.then(function () { return U.getJSON(proxy() + '/ytsb?v=' + id, 15000, 256 * 1024); }).then(function (r) {
            return { segments: U.listOf(r && r.segments, 100, function (g) { return SB_CATS.indexOf(g.cat) !== -1 && typeof g.start === 'number' && typeof g.end === 'number' && g.end >= g.start; }),
                brand: (r && r.brand && typeof r.brand === 'object') ? r.brand : {} };
        }, function () { _extras.del(id); return null; });
        _extras.set(id, p);
        return p;
    }
    function newId() { return 'y' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }

    // What a source is, for its name and the hint: 'channel' | 'playlist' | 'search'.
    function sourceKind(src) {
        src = ('' + (src || '')).trim();
        if (/^search:/i.test(src) || /\{term\}/.test(src)) { return 'search'; }
        if (/[?&]list=|^(PL|UU|OL|FL|RD)[A-Za-z0-9_-]{10,}$/.test(src)) { return 'playlist'; }
        if (/^@|youtube\.com\/(@|channel\/|c\/|user\/)|^UC[A-Za-z0-9_-]{22}$/.test(src)) { return 'channel'; }
        return 'search';
    }
    // A source as typed: a link, an @handle, an ID, or words (a search: "search:words",
    // "{term}" = what you search for).
    function normalSource(src) {
        src = ('' + (src || '')).trim();
        if (!src) { return ''; }
        if (sourceKind(src) === 'search' && !/^search:/i.test(src)) { return 'search:' + src; }
        return src;
    }
    function add(o) {
        var c = cfg(), src = normalSource(o.src);
        if (!src || c.catalogs.length >= MAX_CATALOGS) { return null; }
        for (var i = 0; i < c.catalogs.length; i++) { if (c.catalogs[i].src === src && c.catalogs[i].kind === (o.kind || 'auto')) { return c.catalogs[i].id; } }
        var name = ('' + (o.name || '')).trim() || src.replace(/^search:/i, '').replace(/^https?:\/\/(www\.)?youtube\.com\//, '');
        var item = { id: newId(), name: name.slice(0, 80), type: ('' + (o.type || 'YouTube')).trim() || 'YouTube', src: src,
            kind: KINDS.indexOf(o.kind) !== -1 ? o.kind : 'auto', sort: SORTS.indexOf(o.sort) !== -1 ? o.sort : 'relevance' };
        c.catalogs.push(item);
        save(c);
        return item.id;
    }
    function update(id, patch) {
        var c = cfg(), found = false;
        c.catalogs.forEach(function (x) {
            if (x.id !== id) { return; }
            found = true;
            if (patch.name !== undefined) { x.name = ('' + patch.name).trim().slice(0, 80) || x.name; }
            if (patch.src !== undefined && normalSource(patch.src)) { x.src = normalSource(patch.src); }
            if (patch.type !== undefined) { x.type = ('' + patch.type).trim().slice(0, 30) || 'YouTube'; }
            if (KINDS.indexOf(patch.kind) !== -1) { x.kind = patch.kind; }
            if (SORTS.indexOf(patch.sort) !== -1) { x.sort = patch.sort; }
            if (patch.off !== undefined) { x.off = !!patch.off; }
        });
        if (found) { save(c); }
        return found;
    }
    function remove(id) { var c = cfg(); c.catalogs = c.catalogs.filter(function (x) { return x.id !== id; }); save(c); }
    function move(id, dir) {
        var c = cfg(), i = -1;
        c.catalogs.forEach(function (x, n) { if (x.id === id) { i = n; } });
        var j = i + dir;
        if (i < 0 || j < 0 || j >= c.catalogs.length) { return false; }
        var t = c.catalogs[i]; c.catalogs[i] = c.catalogs[j]; c.catalogs[j] = t;
        save(c);
        return true;
    }
    // Is this channel / playlist one of your catalogs already? (its catalog id, or '')
    function catalogFor(src) {
        var list = catalogs();
        for (var i = 0; i < list.length; i++) { if (list[i].src === src) { return list[i].id; } }
        return '';
    }

    // ----- the built-in addon -----
    function isEnabled() { return searchOn() || catalogs().some(function (x) { return !x.off; }); }
    function manifestCatalogs() {
        var out = [];
        catalogs().forEach(function (x) {
            if (x.off) { return; }
            var search = /\{term\}/.test(x.src);   // (a search catalog: the words you search for)
            out.push({ type: x.type, id: 'ytk_cat_' + x.id, name: x.name,
                extra: search ? [{ name: 'search', isRequired: true }, { name: 'skip' }] : [{ name: 'skip' }] });
        });
        if (searchOn()) {
            out.push({ type: 'YouTube', id: 'ytk_search_videos', name: 'Videos', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }] });
            out.push({ type: 'YouTube', id: 'ytk_search_channels', name: 'Channels', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }] });
            out.push({ type: 'YouTube', id: 'ytk_search_live', name: 'Live now', extra: [{ name: 'search', isRequired: true }, { name: 'skip' }] });
        }
        return out;
    }
    function synthAddon() {
        var cats = manifestCatalogs(), types = [];
        cats.forEach(function (c) { if (types.indexOf(c.type) === -1) { types.push(c.type); } });
        if (types.indexOf('YouTube') === -1) { types.push('YouTube'); }
        return {
            __local: true, __impl: api, url: 'local:youtube', base: 'local:youtube',
            manifest: { id: 'org.stremiok.youtube', name: 'YouTube', version: '1.0.0', types: types,
                resources: ['catalog', 'meta', 'stream'], idPrefixes: ['ytk:'], catalogs: cats }
        };
    }

    // ----- asking the service -----
    function proxy() { return 'http://localhost:' + ((typeof YTPlay !== 'undefined' && YTPlay.port) || 8099); }
    function ask(params) {
        var q = Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
            .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
        var ready = (typeof YTPlay !== 'undefined' && YTPlay.ensureService) ? YTPlay.ensureService() : Promise.resolve();
        return ready.then(function () { return U.getJSON(proxy() + '/ytlist?' + q + (wantBrand() ? '&brand=1' : '') + (originalTitles() ? '&orig=1' : ''), 25000, 4 * 1024 * 1024); });
    }
    // A video's title and picture, with DeArrow's (when it has them and they're turned on).
    function titleOf(it) { var b = it.brand; return (b && typeof b.title === 'string' && b.title && dearrow().titles) ? b.title : (it.title || 'YouTube video'); }
    function thumbOf(it) { var b = it.brand; return (b && typeof b.thumbAt === 'number' && dearrow().thumbs) ? dearrowThumb(it.id, b.thumbAt) : it.thumb; }

    // What a list item becomes on a card. Video items are kept (by id) for their pages.
    var _known = U.lru(500);
    function toMeta(it, type) {
        var desc = [it.by, it.length, it.views, it.ago].filter(Boolean).join('   ·   ');
        if (it.kind === 'video') {
            var name = titleOf(it), poster = thumbOf(it);
            if (name !== it.title && it.title) { desc = 'On YouTube: “' + it.title + '”' + (desc ? '   ·   ' + desc : ''); }
            if (it.live) { desc = '● LIVE now' + (desc ? '   ·   ' + desc : ''); }
            var m = { id: 'ytk:v:' + it.id, type: type, name: name, poster: it.thumb, posterShape: 'landscape',
                background: 'https://i.ytimg.com/vi/' + it.id + '/hqdefault.jpg', description: desc, releaseInfo: it.live ? '● LIVE' : (it.ago || '') };
            if (poster !== it.thumb) { m._cardImage = poster; m._posterAlt = it.thumb; }   // (DeArrow's on the card; not made yet: YouTube's)
            _known.set(m.id, { meta: m, item: it });
            return m;
        }
        if (it.kind === 'channel') {
            return { id: 'ytk:c:' + it.id, type: type, name: it.title, poster: it.thumb, posterShape: 'square',
                description: [it.by, it.description].filter(Boolean).join('   ·   ') };
        }
        return { id: 'ytk:p:' + it.id, type: type, name: it.title, poster: it.thumb, posterShape: 'landscape', description: desc };
    }

    // A catalog's page: skip = titles you have; the service pages by token, so the lists are
    // kept (per catalog and words) and topped up as you go.
    var _pages = {};
    function catalog(catId, extra) {
        var q = (extra && extra.search) ? ('' + extra.search).trim() : '';
        var skip = (extra && +extra.skip) || 0, src, kind, sort, type = 'YouTube';
        var SEARCH_KINDS = { ytk_search_videos: 'videos', ytk_search_channels: 'channels', ytk_search_live: 'live' };
        if (SEARCH_KINDS[catId]) {
            src = 'search:{term}'; kind = SEARCH_KINDS[catId]; sort = 'relevance';
        } else {
            var x = null;
            catalogs().forEach(function (c) { if ('ytk_cat_' + c.id === catId) { x = c; } });
            if (!x) { return Promise.resolve([]); }
            src = x.src; kind = x.kind; sort = x.sort; type = x.type;
        }
        if (/\{term\}/.test(src) && !q) { return Promise.resolve([]); }
        var key = catId + '|' + q, st = _pages[key];
        if (!st || skip === 0) { st = _pages[key] = { items: [], next: null }; }
        function fill() {
            if (st.items.length > skip || st.next === '') { return Promise.resolve(); }
            var p = st.next ? { page: st.next } : { src: src, kind: kind, sort: sort, q: q };
            return ask(p).then(function (r) {
                var seen = {};
                st.items.forEach(function (i) { seen[i.kind + i.id] = true; });
                U.listOf(r && r.items, 200).forEach(function (i) { if (!seen[i.kind + i.id]) { st.items.push(i); } });
                st.next = (r && typeof r.next === 'string') ? r.next : '';
            });
        }
        return fill().then(function () {
            return st.items.slice(skip, skip + 60).map(function (it) { return toMeta(it, type); });
        });
    }

    // How long ago, as a date ("4 days ago" -> that day; YouTube gives no exact dates in lists).
    var UNIT = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
    function agoToDate(ago) {
        var m = ('' + (ago || '')).match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
        return m ? new Date(Date.now() - (+m[1]) * UNIT[m[2].toLowerCase()] * 1000).toISOString() : undefined;
    }

    // A page: a video's (it plays from it straight away), a channel's or playlist's (its
    // videos as episodes, up to ~120).
    function meta(id) {
        var m = ('' + id).match(/^ytk:([vcp]):(.+)$/);
        if (!m) { return Promise.resolve(null); }
        if (m[1] === 'v') {
            var k = _known.get(id), base = k ? Object.assign({}, k.meta) : null;
            var page = 'https://www.youtube.com/watch?v=' + m[2];
            var details = base ? Promise.resolve(null) : (typeof YTPlay !== 'undefined' && YTPlay.infoUrl
                ? YTPlay.ensureService().then(function () { return U.getJSON(YTPlay.infoUrl(page), 20000, 512 * 1024); }).then(function (r) { return r && r.details; }, function () { return null; })
                : Promise.resolve(null));
            var brand = (base || !dearrow().titles) ? Promise.resolve(null) : videoExtras(m[2]).then(function (x) { return x && x.brand; });
            return Promise.all([details, brand]).then(function (both) {
                var d = both[0], b = both[1], yt = (d && d.title) || 'YouTube video', better = b && b.title;
                var out = base || { id: id, type: 'YouTube', name: better || yt, poster: 'https://i.ytimg.com/vi/' + m[2] + '/mqdefault.jpg',
                    posterShape: 'landscape', background: 'https://i.ytimg.com/vi/' + m[2] + '/hqdefault.jpg',
                    description: (better && d && d.title ? 'On YouTube: “' + d.title + '”   ·   ' : '') + (d ? [d.by, d.description].filter(Boolean).join('   ·   ') : '') };
                out.videos = [{ id: id, title: out.name, streams: [{ name: 'YouTube', ytId: m[2] }] }];
                return out;
            });
        }
        return ask({ src: m[2], meta: '1' }).then(function (r) {
            var head = (r && r.head) || {}, vids = U.listOf(r && r.items, 200).filter(function (i) { return i.kind === 'video'; });
            // what it's streaming now: first (dated now, so the newest)
            var seen = {}, now = new Date().toISOString();
            vids.forEach(function (v) { seen[v.id] = true; });
            var live = U.listOf(r && r.live, 10).filter(function (i) { return i.kind === 'video' && !seen[i.id]; });
            var first = vids[0];
            return { id: id, type: 'YouTube', name: head.title || (first && first.by) || 'YouTube', poster: head.thumb || (first && first.thumb) || '',
                posterShape: m[1] === 'c' ? 'square' : 'landscape', background: first ? 'https://i.ytimg.com/vi/' + first.id + '/hqdefault.jpg' : '',
                description: head.description || '',
                videos: live.map(function (v) {
                    var vm = toMeta(v, 'YouTube');
                    return { id: vm.id, title: '● LIVE   ' + vm.name, season: 1, episode: 0, released: now, thumbnail: v.thumb, live: true,
                        overview: ['Live now', v.views].filter(Boolean).join('   ·   ') };
                }).concat(vids.map(function (v, i) {
                    var vm = toMeta(v, 'YouTube');
                    return { id: vm.id, title: vm.name, season: 1, episode: i + 1, released: agoToDate(v.ago), thumbnail: v.thumb,
                        overview: [v.length, v.views, v.ago].filter(Boolean).join('   ·   ') };
                })) };
        });
    }
    // A video's source: its YouTube id (played through the service, see Stremio.youTubeSource).
    function streams(id) {
        var m = ('' + id).match(/^ytk:v:([A-Za-z0-9_-]{11})$/);
        return Promise.resolve(m ? [{ name: 'YouTube', title: 'Plays through StremioK’s YouTube service', ytId: m[1] }] : []);
    }

    // ----- copying a YouTubio addon's catalogs -----
    // A YouTubio link carries its settings in the link itself (JSON before /manifest.json;
    // only its sign-in cookies and keys are encrypted, and those aren't wanted here).
    var YTB_CHANNEL_TYPES = ['auto', 'video', 'channel'];
    function youTubioOf(url) {
        var m = ('' + url).match(/^https?:\/\/([^\/?#]+)\/([^\/?#]+)\/manifest\.json(?:[?#].*)?$/), c = null;
        if (!m) { return null; }
        try { c = JSON.parse(decodeURIComponent(m[2])); } catch (e) { return null; }
        return (c && typeof c === 'object' && Array.isArray(c.catalogs)) ? { host: m[1].toLowerCase(), cfg: c } : null;
    }
    // Its catalogs as yours: { list: [{ src, name, type, kind, sort }], left: (its own feeds,
    // which need its sign-in, and its built-in search: YouTube in Search is that) }.
    function fromYouTubio(url) {
        var y = youTubioOf(url);
        if (!y) { return null; }
        var list = [], left = 0;
        y.cfg.catalogs.slice(0, 100).forEach(function (c) {
            var id = (c && typeof c.id === 'string') ? c.id.replace(/^yt_id:/, '').trim() : '';
            if (!id || /^:/.test(id)) { left++; return; }
            var ct = /^[0-9]+$/.test('' + c.channelType) ? YTB_CHANNEL_TYPES[+c.channelType] : ('' + (c.channelType || 'auto'));
            var kind = ct === 'video' ? 'videos' : (ct === 'channel' ? 'channels' : 'auto'), sort = 'relevance', src;
            var q = id.match(/youtube\.com\/results\?(?:[^#]*&)?search_query=([^&#]*)/);
            if (q) {   // a search link: its words, what it lists (sp), in its order
                var words = '', sp = (id.match(/[?&]sp=([^&#]*)/) || [])[1] || '';
                try { words = decodeURIComponent(q[1].replace(/\+/g, ' ')); sp = decodeURIComponent(sp); } catch (e) {}
                words = words.replace(/\{sort\}/g, '').trim();
                if (/AhAC|EgIQAg/.test(sp)) { kind = 'channels'; } else if (/AhAB|EgIQAQ/.test(sp)) { kind = 'videos'; } else if (/AkAB|EgJAAQ/.test(sp)) { kind = 'live'; }
                if (/^CAI/.test(sp)) { sort = 'date'; } else if (/^CAM/.test(sp)) { sort = 'views'; } else if (/^CAE/.test(sp)) { sort = 'rating'; }
                src = 'search:' + (words || '{term}');
            } else if (kind !== 'auto') {   // (YouTubio: a Video / Channel type searches; its words, when it has some)
                src = 'search:' + (/^(https?:|@|UC[A-Za-z0-9_-]{22}$|PL)/.test(id) ? '{term}' : id);
            } else {
                src = id;
            }
            list.push({ src: src, name: ('' + (c.name || '')).trim(), type: ('' + (c.type || y.cfg.catalogType || 'YouTube')).trim(), kind: kind, sort: sort });
        });
        return { host: y.host, list: list, left: left };
    }
    // Installed addons that are YouTubio: [{ url, host, count }].
    function youTubioAddons() {
        var urls = (typeof Stremio !== 'undefined' && Stremio.getAddonUrls) ? Stremio.getAddonUrls() : [];
        return urls.map(function (u) { var y = fromYouTubio(u); return y && y.list.length ? { url: u, host: y.host, count: y.list.length } : null; }).filter(Boolean);
    }
    // Copied: { added, already }.
    function copyYouTubio(url) {
        var y = fromYouTubio(url), added = 0, already = 0;
        (y ? y.list : []).forEach(function (x) {
            var before = catalogs().length, id = add(x);
            if (!id) { return; }
            if (catalogs().length > before) { added++; } else { already++; }
        });
        return { added: added, already: already };
    }

    var api = { catalog: catalog, meta: meta, streams: streams };
    return {
        catalogs: catalogs, searchOn: searchOn, setSearch: setSearch, add: add, update: update, remove: remove, move: move,
        catalogFor: catalogFor, sourceKind: sourceKind, isEnabled: isEnabled, synthAddon: synthAddon,
        catalog: catalog, meta: meta, streams: streams, agoToDate: agoToDate,
        originalTitles: originalTitles, setOriginalTitles: setOriginalTitles,
        sbOn: sbOn, setSbOn: setSbOn, sbMode: sbMode, sbModes: sbModes, setSbMode: setSbMode, sbModesFor: sbModesFor, dearrow: dearrow, setDearrow: setDearrow,
        videoExtras: videoExtras, fromYouTubio: fromYouTubio, youTubioAddons: youTubioAddons, copyYouTubio: copyYouTubio, SB_CATS: SB_CATS, SB_NAMES: SB_NAMES, SB_MODE_NAMES: SB_MODE_NAMES,
        KINDS: KINDS, SORTS: SORTS, KIND_NAMES: KIND_NAMES, SORT_NAMES: SORT_NAMES
    };
})();
