/* Stremio addon protocol client. Global namespace: Stremio
   Mirrors how user-configured addons expose
   catalog / meta / stream resources over HTTP JSON. */
var Stremio = (function () {
    'use strict';

    var ADDONS_KEY = 'stremiok.addons';

    // Defaults for a fresh install. Cinemeta = catalogs + metadata, OpenSubtitles v3 =
    // subtitles. The user can add/remove more in Settings; this app hosts no content itself.
    // (WatchHub isn't one: its answers say it's only for clients Stremio authorizes in
    // writing. "Where to watch" comes from TMDB instead; see thirdPartyNote.)
    var DEFAULT_ADDONS = [
        'https://v3-cinemeta.strem.io/manifest.json',
        'https://opensubtitles-v3.strem.io/manifest.json'
    ];
    // Addons whose operator limits who may use them: what Settings says about one you add.
    var RESTRICTED = {
        'org.stremio.watchhub': 'Third-party service: its operator says it’s only for apps Stremio authorizes in writing, and StremioK isn’t one. Use it at your own discretion.'
    };
    var RESTRICTED_HOSTS = { 'watchhub.strem.io': 'org.stremio.watchhub' };
    // The note for an addon (its manifest id, or its URL before it has loaded), or ''.
    function thirdPartyNote(idOrUrl) {
        var id = '' + (idOrUrl || ''), p = U.parseUrl(id);
        if (p && RESTRICTED_HOSTS[p.host]) { id = RESTRICTED_HOSTS[p.host]; }
        return Object.prototype.hasOwnProperty.call(RESTRICTED, id) ? RESTRICTED[id] : '';
    }

    // An addon's manifest URL from what was typed / imported (U.parseUrl: http(s) only,
    // stremio:// links, no credentials): "…/manifest.json" as is (a query after it kept,
    // e.g. ?config=…), else "/manifest.json" added to the path. null if it isn't a URL.
    function normalizeManifestUrl(input) {
        var p = U.parseUrl(input);
        if (!p) { return null; }
        if (U.isManifestUrl(p)) { return p.href; }
        var root = p.href.slice(0, p.href.length - (p.query ? p.query.length + 1 : 0) - p.hash.length);
        if (root.slice(-1) === '/') { root = root.slice(0, -1); }
        return root + '/manifest.json' + (p.query ? '?' + p.query : '');
    }

    function baseOf(manifestUrl) {
        return manifestUrl.replace(/\/manifest\.json.*$/, '');
    }

    // The default addons are for a first launch only: once the list has been saved, it's
    // yours, even empty (removing the last addon used to bring the defaults back).
    function getAddonUrls() {
        var list = U.store.get(ADDONS_KEY, null);
        if (!Array.isArray(list)) { list = DEFAULT_ADDONS.slice(); }
        return list.slice();
    }

    function saveAddonUrls(list) { U.store.set(ADDONS_KEY, list); }
    // Your addons or playlists changed (added, removed, moved, refreshed, a playlist edited,
    // switched off or reloaded, local-network links allowed or not): a new revision. A load
    // still under way for the old one keeps nothing (it's loaded again as things are now),
    // and every cache that came from the old one goes: details, sources, their notes, the
    // catalog pages kept for an addon's empty answers.
    var _rev = 0;
    function configChanged() {
        _rev++;
        _loaded = null; _loading = null;
        resetMetaCache();
        _streamCache = {}; _streamOrder = [];
        if (_streamNotes) { _streamNotes.clear(); }
        if (_lastGood) { _lastGood.clear(); }
    }

    function addAddon(input) {
        var url = normalizeManifestUrl(input);
        if (!url) { return false; }
        var list = getAddonUrls();
        if (list.indexOf(url) === -1) { list.push(url); saveAddonUrls(list); }
        configChanged();
        return url;
    }

    // Your order (Settings › Addons ▲▼): the higher addon is asked first wherever one answer
    // is used (a title's details: the first that has them) and listed first where several are.
    // dir: -1 / 1 one place, -Infinity / Infinity to the top / bottom (U.moveIn)
    function moveAddon(url, dir) {
        var list = getAddonUrls();
        if (!U.moveIn(list, list.indexOf(url), dir)) { return false; }
        saveAddonUrls(list);
        configChanged();   // (rebuilt from the saved manifests: nothing fetched)
        return true;
    }

    // Addons you turned off (Settings › Content › Addons, OK on one): kept in your list, in
    // their place, but not loaded, so nothing is asked of them (rows, details, sources,
    // subtitles, search) until they're turned on again. A backup can wait there.
    var OFF_KEY = 'stremiok.addonsoff';
    function offUrls() { var l = U.store.get(OFF_KEY, []); return Array.isArray(l) ? l.filter(function (u) { return typeof u === 'string'; }) : []; }
    function isAddonOff(url) { return offUrls().indexOf(url) !== -1; }
    function setAddonOff(url, off) {
        var l = offUrls().filter(function (u) { return u !== url; });
        if (off) { l.push(url); }
        U.store.set(OFF_KEY, l);
        configChanged();   // (loaded again without it, or with it: from the saved manifests)
    }
    function removeAddon(url) {
        var list = getAddonUrls().filter(function (u) { return u !== url; });
        saveAddonUrls(list);
        if (isAddonOff(url)) { U.store.set(OFF_KEY, offUrls().filter(function (u) { return u !== url; })); }   // (added again: on)
        var o = originsAll();
        if (o[url]) { delete o[url]; U.store.set(ORIGIN_KEY, o); }   // (added again by hand: none)
        configChanged();
    }

    // Where an addon came from (Settings › Addons' letter badges): 'stremio' (your Stremio
    // account), 'aiomanager' (an AIOManager sync), 'config' (a configuration file), or '' (you).
    var ORIGIN_KEY = 'stremiok.addonorigin', ORIGINS = { stremio: 1, aiomanager: 1, config: 1 };
    function originsAll() { var o = U.store.get(ORIGIN_KEY, {}); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
    function addonOrigin(url) { var k = originsAll()[url]; return ORIGINS[k] ? k : ''; }
    function setAddonOrigin(url, kind) {
        if (!url || !ORIGINS[kind]) { return; }
        var o = originsAll(), mine = getAddonUrls();
        o[url] = kind;
        Object.keys(o).forEach(function (u) { if (mine.indexOf(u) === -1) { delete o[u]; } });   // (only addons you have)
        U.store.set(ORIGIN_KEY, o);
    }

    // One addon, from the network: only its manifest is fetched (and saved on the TV); the
    // loaded addons keep theirs. Resolves with the new manifest; rejects if it didn't answer.
    function refreshAddon(url) {
        return fetchManifests([url]).then(function (got) {
            var m = got[url];
            if (!m) { throw new Error('Could not refresh ' + U.redactUrl(url)); }
            if (_loaded) { _loaded.forEach(function (a) { if (a.url === url) { a.manifest = m; } }); }
            var kept = _loaded;
            configChanged();   // (its sources may differ now; fetched again as titles open)
            _loaded = kept;    // (the others keep theirs: nothing else fetched)
            return m;
        });
    }

    function refreshAddons() {
        configChanged();
        _forceNet = true;   // from the network, not the copies saved on the TV
        return loadAddons();
    }

    // ---- Integrations (API keys) + UI prefs ----
    var INTEG_KEY = 'stremiok.integrations';
    var PREFS_KEY = 'stremiok.prefs';

    function getIntegrations() {
        var o = U.store.get(INTEG_KEY, {}) || {};
        return { omdb: o.omdb || '', tmdb: o.tmdb || '', mdblist: o.mdblist || '', theintrodb: o.theintrodb || '',
            trakt_id: o.trakt_id || '', trakt_secret: o.trakt_secret || '' };
    }
    function setIntegration(key, val) {
        var o = U.store.get(INTEG_KEY, {}) || {};   // preserve any keys getIntegrations doesn't surface
        o[key] = ('' + val).trim();
        U.store.set(INTEG_KEY, o);
    }

    // Settings > Addons > Wait for addons: at least this long for every addon request (an addon
    // that sleeps when unused fails the first time while it wakes). Normal: each kind's own.
    var ADDON_WAITS = [20, 30, 45, 60];
    function addonMs(ms) { var w = getPrefs().addonWait * 1000; return w > ms ? w : ms; }
    function getPrefs() {
        var p = U.store.get(PREFS_KEY, {}) || {};
        return { posterShape: p.posterShape || 'portrait', accent: p.accent || 'indigo', bg: p.bg || 'dark',
            zoom: [110, 120, 130, 140].indexOf(p.zoom) !== -1 ? p.zoom : 100,   // Settings > Appearance: everything bigger (percent)
            rowCards: [50, 100, 200].indexOf(p.rowCards) !== -1 ? p.rowCards : 30,   // Settings > Appearance: titles in a Home row
            formatsAuto: p.formatsAuto !== false,   // Settings > Formats: mark "Not working" on its own
            allowLocal: p.allowLocal === true,      // Settings > Addons: home-network links from internet addons
            addonWait: ADDON_WAITS.indexOf(p.addonWait) !== -1 ? p.addonWait : 0,   // Settings > Addons: seconds to wait for an addon (0: Normal)
            autoSkip: [5, 10, 15, 30].indexOf(p.autoSkip) !== -1 ? p.autoSkip : 0,   // Settings > Skipping: intros / recaps after a countdown (0: ask)
            autoNext: [5, 10, 15, 30].indexOf(p.autoNext) !== -1 ? p.autoNext : 0,   // Settings > Skipping: the next episode at the credits after a countdown (0: ask)
            spoilers: p.spoilers === 'pictures' || p.spoilers === 'all' ? p.spoilers : 'off',   // Settings > Appearance: unwatched episodes' stills (and synopses) hidden
            hideUnplayable: p.hideUnplayable === true,   // Settings > Source ranking: the sources the TV can't play left out
            skipSourceList: p.skipSourceList === true,   // Settings > Source ranking: Play plays the top source at once
            nextOnFail: p.nextOnFail !== false,          // Settings > Source ranking: a source that doesn't start gives way to the next
            sizeLimits: { movie: sizeLimits(p.sizeLimits, 'movie'), series: sizeLimits(p.sizeLimits, 'series') },   // Settings > Source ranking (GB; 0: none)
            posterRatings: p.posterRatings === true,   // Settings > Appearance: IMDb rating on cards
            homePreview: p.homePreview !== false,      // Settings > Appearance: Continue Watching on the TV's home bar (js/hubpreview.js)
            homePreviewOrder: p.homePreviewOrder === 'watching' ? 'watching' : 'recent',   // ...its tiles: the latest first, or as in Watching
            hiddenTabs: wordList(p.hiddenTabs, 20, 20),   // Settings > Appearance > Menu: tabs hidden
            menuOrder: wordList(p.menuOrder, 20, 20),     // ...and the menu's order (see ViewParts.menuOrder)
            hideWords: wordList(p.hideWords, 30, 40),     // Settings > Source ranking: sources with these words at the bottom
            watchRegion: /^[A-Z]{2}$/.test(p.watchRegion || '') ? p.watchRegion : '' };   // Settings > Integrations ('' = automatic)
    }
    // A kind's size limits, in GB (0: none): { min, max, perHour }.
    function sizeLimits(all, kind) {
        var x = (all && typeof all === 'object' && all[kind] && typeof all[kind] === 'object') ? all[kind] : {};
        function gb(v) { v = +v; return isFinite(v) && v > 0 && v < 10000 ? v : 0; }
        return { min: gb(x.min), max: gb(x.max), perHour: gb(x.perHour) };
    }
    function setSizeLimit(kind, which, gbs) {
        var p = U.store.get(PREFS_KEY, {}) || {}, all = (p.sizeLimits && typeof p.sizeLimits === 'object') ? p.sizeLimits : {};
        var k = sizeLimits(all, kind);
        k[which] = +gbs > 0 ? +gbs : 0;
        all[kind] = k;
        setPref('sizeLimits', all);
    }
    function gbText(v) { return v >= 1 ? (Math.round(v * 10) / 10) + ' GB' : Math.round(v * 1000) + ' MB'; }
    // Why a source is outside your size limits (Settings › Source ranking), or '': kind 'movie' or
    // 'series' (an episode), minutes the title's length (0: unknown, no per-hour limit). A source
    // without a size isn't held to them.
    function sizeLimitHit(st, kind, minutes, info) {
        var L = getPrefs().sizeLimits[kind === 'series' ? 'series' : 'movie'];
        if (!L || (!L.min && !L.max && !L.perHour) || !st) { return ''; }
        var bytes = (info && info.size) || sizeBytes(st);
        if (!(bytes > 0)) { return ''; }
        var g = bytes / 1073741824;
        if (L.max && g > L.max) { return 'over ' + gbText(L.max); }
        if (L.min && g < L.min) { return 'under ' + gbText(L.min); }
        if (L.perHour && minutes > 0) {
            var ph = g / (minutes / 60);
            if (ph > L.perHour) { return (Math.round(ph * 10) / 10) + ' GB an hour, over ' + gbText(L.perHour); }
        }
        return '';
    }
    // A length as addons write it ("2h 12min", "132 min", "45m", "1h", 132) in minutes, or 0.
    function runtimeMinutes(r) {
        if (typeof r === 'number') { return r > 0 && r < 2000 ? r : 0; }
        var t = ('' + (r || '')).toLowerCase(), h = /(\d+(?:\.\d+)?)\s*h/.exec(t), m = /(\d+)\s*m/.exec(t);
        var n = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
        if (!n && /^\s*\d+\s*$/.test(t)) { n = +t; }
        return n > 0 && n < 2000 ? n : 0;
    }
    function wordList(x, max, len) {
        return Array.isArray(x) ? x.filter(function (w) { return typeof w === 'string' && w.trim(); }).map(function (w) { return w.trim().slice(0, len); }).slice(0, max) : [];
    }
    // Words to hide sources by (Settings › Source ranking), typed separated by commas.
    function setHideWords(text) {
        setPref('hideWords', wordList(('' + (text || '')).split(','), 30, 40));
    }
    // The first of your words a source has (as a whole word, capitals or not: "CAM" isn't in
    // "CAMERA") in its name, description or file name, or ''.
    var _wordRes = { key: null, res: [] };
    function hideWordHit(st) {
        var words = getPrefs().hideWords;
        if (!words.length || !st) { return ''; }
        var key = words.join('\n');
        if (_wordRes.key !== key) {
            _wordRes = { key: key, res: words.map(function (w) {
                return { w: w, re: new RegExp('(^|[^A-Za-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9]|$)', 'i') };
            }) };
        }
        var text = [st.name, st.title, st.description, (st.behaviorHints || {}).filename].join(' ');
        for (var i = 0; i < _wordRes.res.length; i++) { if (_wordRes.res[i].re.test(text)) { return _wordRes.res[i].w; } }
        return '';
    }
    function setPref(key, val) {
        var p = getPrefs();
        p[key] = val;
        U.store.set(PREFS_KEY, p);
    }

    // ---- Manifest loading ----
    // Manifests are kept in memory for the session and saved on the TV, so a launch
    // doesn't wait for every addon's manifest: saved copies are used straight away and
    // refreshed in the background a few seconds later (once per session). A manifest
    // that can't be fetched falls back to its saved copy.
    var MANIFESTS_KEY = 'stremiok.manifests';
    var MANIFEST_REFRESH_DELAY = 4000;
    var _loaded = null;
    var _loading = null;       // in-flight load, shared by concurrent callers
    var _forceNet = false;     // next load fetches every manifest (Settings > refresh)
    var _refreshedUrls = {};   // url -> fetched from the network this session

    var _hasIptv = (typeof IPTV !== 'undefined');
    function hasYouTube() { return typeof YouTube !== 'undefined' && YouTube.isEnabled(); }   // (StremioK's own, js/youtube.js)

    // Limits on what addons send (see U.getText): a title's details can be big (One Piece's
    // episode list is 1.4 MB), everything else is kept to 2 MB; and at most this many items.
    // Home-network links from internet addons (Settings > Addons). An addon on the internet
    // has no business sending links into your home network (a router, a NAS, a camera, the
    // TV itself): artwork, streams and subtitle files like that are dropped unless you allow
    // them. Addons on your own network (self-hosted), and your IPTV playlists, are trusted.
    function blocksLocal(addon) {
        if (!addon || addon.__local || getPrefs().allowLocal) { return false; }
        var p = U.parseUrl(addon.base || addon.url);
        return !(p && U.isPrivateHost(p.host));
    }
    if (U.setLocalPolicy) { U.setLocalPolicy(function () { return getPrefs().allowLocal; }); }   // (redirects into the home network, U.getText)

    // ---- What an addon sends, checked ----
    // Every answer is rebuilt from the addon's JSON before anything uses it, as data only:
    // the names StremioK gives its own fields (APP_FIELDS, and any starting "__") are dropped,
    // so an addon can't set them; so are names every object already has (hasOwnProperty,
    // __proto__…). The usual fields keep only their usual kind (STR_FIELDS text — an id, a
    // year or a runtime may come as a number —, NUM_FIELDS whole numbers, ARR_FIELDS lists —
    // one that isn't becomes none —, OBJ_FIELDS objects); text,
    // lists and nesting are capped. From an addon on the internet (blocksLocal), every link
    // into your home network is dropped, at any depth: a picture, a link in a field, a source
    // or subtitle track (the whole entry), an episode's own sources.
    var APP_FIELDS = {};
    ['_addon', '_addonPos', '_addonRank', '_also', '_cardImage', '_posterAlt', '_from', '_headers', '_keepStream', '_playlistId', '_reported', '_yt', '_file',
        '_group', '_local', '_localSubs', '_tmdbWhere', '_trakt', '_dupes', '_restoreKey', '_current', '_autoFocus', '_epFocus', '_focusNp', '_focusPill',
        '_focusSeason', '_focusTrailer', '_earlier', '_localFile', '_torrent', '_pickFile', 'stale', 'ytPage'].forEach(function (k) { APP_FIELDS[k] = 1; });
    function fieldSet(list) { var o = {}; list.forEach(function (k) { o[k] = 1; }); return o; }
    var STR_FIELDS = fieldSet(['id', 'type', 'name', 'title', 'description', 'poster', 'background', 'logo', 'thumbnail', 'banner', 'url', 'externalUrl', 'ytId',
        'infoHash', 'releaseInfo', 'released', 'imdb_id', 'lang', 'filename', 'bingeGroup', 'posterShape', 'runtime']);
    var NUMBER_AS_TEXT = fieldSet(['id', 'releaseInfo', 'released', 'runtime']);
    var NUM_FIELDS = fieldSet(['season', 'episode', 'number', 'fileIdx', 'videoSize']);
    var ARR_FIELDS = fieldSet(['metas', 'videos', 'streams', 'subtitles', 'trailers', 'trailerStreams', 'links', 'genres', 'catalogs', 'resources', 'types',
        'idPrefixes', 'extra', 'options', 'extraSupported', 'extraRequired']);
    var OBJ_FIELDS = fieldSet(['behaviorHints', 'proxyHeaders', 'meta']);
    var STR_MAX = 50000, ARR_MAX = 5000, DEPTH_MAX = 10;
    var LINK = /^\s*(https?:)?\/\//i, ENTRY_LISTS = fieldSet(['streams', 'subtitles', 'trailerStreams']);
    function isLocalLink(x) { return typeof x === 'string' && LINK.test(x) && U.urlIsPrivate(x); }
    function cleanValue(v, key, noLocal, c, depth) {
        if (typeof v === 'string') {
            if (noLocal && isLocalLink(v)) { c.dropped++; return undefined; }
            return v.length > STR_MAX ? v.slice(0, STR_MAX) : v;
        }
        if (typeof v === 'number') { return isFinite(v) ? v : undefined; }
        if (typeof v === 'boolean' || v === null) { return v; }
        if (!v || typeof v !== 'object' || depth >= DEPTH_MAX) { return undefined; }
        if (Array.isArray(v)) {
            var out = [];
            for (var i = 0; i < v.length && out.length < ARR_MAX; i++) {
                var e = v[i];
                if (noLocal && ENTRY_LISTS[key] && e && typeof e === 'object' && (isLocalLink(e.url) || isLocalLink(e.externalUrl))) { c.dropped++; continue; }
                var x = cleanValue(e, '', noLocal, c, depth + 1);
                if (x !== undefined) { out.push(x); }
            }
            return out;
        }
        var o = {};
        for (var k in v) {
            if (!Object.prototype.hasOwnProperty.call(v, k) || k.length > 100 || k in Object.prototype || APP_FIELDS[k] || k.indexOf('__') === 0) { continue; }
            var y = cleanValue(v[k], k, noLocal, c, depth + 1);
            if (y === undefined) { continue; }
            if (STR_FIELDS[k] && typeof y !== 'string') { if (typeof y === 'number' && NUMBER_AS_TEXT[k]) { y = '' + y; } else { continue; } }
            else if (NUM_FIELDS[k] && !(typeof y === 'number' && Math.floor(y) === y) && !(typeof y === 'string' && /^\d{1,10}$/.test(y))) { continue; }
            else if (ARR_FIELDS[k] && !Array.isArray(y)) { y = []; }
            else if (OBJ_FIELDS[k] && (y === null || typeof y !== 'object' || Array.isArray(y))) { continue; }
            o[k] = y;
        }
        return o;
    }
    // An addon's answer, checked (above); {} when it isn't an object.
    function fromAddon(addon, res, what) {
        var c = { dropped: 0 }, out = cleanValue(res, '', blocksLocal(addon), c, 0);
        if (c.dropped) { U.log('addons', ((addon && addon.manifest && addon.manifest.name) || 'An addon') + ': ' + c.dropped + ' link(s) into the home network left out of its ' + what + ' (Settings › Content › Addons to allow)'); }
        return (out && typeof out === 'object' && !Array.isArray(out)) ? out : {};
    }

    var META_MAX = 4 * 1024 * 1024;
    var MAX_METAS = 1000, MAX_STREAMS = 500, MAX_SUBTITLES = 300, MAX_EPISODES = 5000, MAX_CATALOGS = 200;
    var _manifestProblem = {};   // url -> why it didn't load ("too large (over 2 MB)", "not an addon manifest"…)
    var _manifestDetail = {};    // url -> what the addon itself said about it, if anything (its error message)
    // An addon's logo (its manifest's "logo", else "icon"), for Settings › Content › Addons: an
    // http(s) link by the artwork rules (U.cardImage), or a small base64 picture written into
    // the manifest, whole (one as long as STR_MAX was cut short). From an internet addon (url:
    // its link; none given, taken as one), never a link into your home network (blocksLocal).
    // Else null: its initial shows instead.
    var LOGO_DATA = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+\/]+=*$/i;
    function addonLogo(m, url) {
        if (!m || typeof m !== 'object') { return null; }
        var u = typeof m.logo === 'string' && m.logo.trim() ? m.logo : typeof m.icon === 'string' ? m.icon : '';
        u = u.trim();
        if (!u) { return null; }
        if (/^data:/i.test(u)) { return u.length < STR_MAX && LOGO_DATA.test(u) ? u : null; }
        u = U.cardImage(u, 'logo');
        return u && (url ? blocksLocal({ url: url }) : true) && U.urlIsPrivate(u) ? null : u;
    }
    // A manifest as the app can use it, or null: an id, and lists that are lists.
    // Its lists too: resources (a name, or { name, types, idPrefixes }), types and id prefixes
    // (text), catalogs (a type and id; extras each a name, their options text).
    function strings(x, max) { return Array.isArray(x) ? x.filter(function (y) { return typeof y === 'string' && y; }).slice(0, max || 500) : []; }
    function cleanManifest(m) {
        if (!m || typeof m !== 'object') { return null; }
        m = fromAddon(null, m, 'manifest');
        if (!m.id || typeof m.id !== 'string') { return null; }
        m.catalogs = U.listOf(m.catalogs, MAX_CATALOGS, function (c) { return typeof c.type === 'string' && typeof c.id === 'string'; }).map(function (c) {
            if (c.extra !== undefined) {
                c.extra = U.listOf(c.extra, 50, function (e) { return typeof e.name === 'string' && !!e.name; }).map(function (e) {
                    if (e.options !== undefined) { e.options = strings(e.options, 1000); }
                    if (e.isRequired !== undefined) { e.isRequired = e.isRequired === true; }
                    return e;
                });
            }
            ['extraSupported', 'extraRequired', 'genres'].forEach(function (f) { if (c[f] !== undefined) { c[f] = strings(c[f], 200); } });
            return c;
        });
        m.resources = (Array.isArray(m.resources) ? m.resources : []).filter(function (r) {
            return (typeof r === 'string' && r) || (r && typeof r === 'object' && typeof r.name === 'string' && r.name);
        }).slice(0, 50).map(function (r) {
            if (typeof r === 'string') { return r; }
            if (r.types !== undefined) { r.types = strings(r.types, 50); }
            if (r.idPrefixes !== undefined) { r.idPrefixes = strings(r.idPrefixes, 200); }
            return r;
        });
        m.types = strings(m.types, 50);
        if (m.idPrefixes !== undefined) { m.idPrefixes = strings(m.idPrefixes, 200); }
        return m;
    }
    function fetchManifests(urls) {
        return U.settleAll(urls.map(function (url) {
            return function () { return U.getJSON(url, addonMs(12000)); };
        }), 4).then(function (results) {
            var saved = U.store.get(MANIFESTS_KEY, {}) || {}, got = {};
            results.forEach(function (r, i) {
                var m = r.ok ? cleanManifest(r.value) : null;
                if (m) { got[urls[i]] = m; saved[urls[i]] = m; _refreshedUrls[urls[i]] = 1; delete _manifestProblem[urls[i]]; delete _manifestDetail[urls[i]]; }
                else {
                    _manifestProblem[urls[i]] = r.ok ? 'not an addon manifest' : U.problem(r.error);
                    _manifestDetail[urls[i]] = (!r.ok && U.problemDetail) ? U.problemDetail(r.error) : '';
                }
            });
            var keep = {};   // drop saved copies of removed addons
            getAddonUrls().forEach(function (u) { if (saved[u]) { keep[u] = saved[u]; } });
            U.store.set(MANIFESTS_KEY, keep);
            return got;
        });
    }

    // An addon's manifest as kept (its behaviorHints: a setup page), or null.
    function savedManifest(url) { return (U.store.get(MANIFESTS_KEY, {}) || {})[url] || null; }
    function loadAddons() {
        if (_loaded) { return Promise.resolve(_loaded); }
        if (_loading) { return _loading; }
        var off = offUrls(), urls = getAddonUrls().filter(function (u) { return off.indexOf(u) === -1; });   // (the ones turned off: not loaded)
        var saved = U.store.get(MANIFESTS_KEY, {}) || {};
        var force = _forceNet; _forceNet = false;
        var need = urls.filter(function (u) { return force || !saved[u]; }), rev = _rev, p;
        // The IPTV playlists aren't waited for (a big one takes a while to read): the synthetic
        // addon joins once they're read (iptvJoin), and onIptvReady's listeners redraw its rows.
        var iptvOn = _hasIptv && IPTV.isEnabled(), iptvNow = iptvOn && (!IPTV.isReady || IPTV.isReady());
        p = Promise.all([null, need.length ? fetchManifests(need) : Promise.resolve({})]).then(function (res) {
            if (_loading === p) { _loading = null; }
            if (rev !== _rev) { return loadAddons(); }   // (your addons changed meanwhile: loaded as they are now)
            var got = res[1], addons = [];
            urls.forEach(function (url) {
                var m = got[url] || saved[url];
                if (m) { addons.push({ url: url, base: baseOf(url), manifest: m }); }
            });
            // Prepend so the IPTV rows sort first on Home (reorder them in Settings >
            // Appearance > Home feeds; there's no cap on how many rows or feeds).
            if (iptvNow) { addons.unshift(IPTV.synthAddon()); }
            else if (iptvOn) { iptvJoin(addons, rev); }
            if (typeof XtVod !== 'undefined' && XtVod.isEnabled()) { addons.push(XtVod.synthAddon()); }   // (your Xtream accounts' films and series: after your addons)
            if (hasYouTube()) { addons.push(YouTube.synthAddon()); }   // (after your addons: its rows last on Home)
            if (typeof Trakt !== 'undefined' && Trakt.isConnected()) { addons.push(Trakt.synthAddon()); }   // (your Watchlist and Up next)
            _loaded = addons;
            U.mark('addons');
            var stale = urls.filter(function (u) { return !_refreshedUrls[u] && saved[u]; });
            if (stale.length) { setTimeout(function () { refreshSavedManifests(stale); }, MANIFEST_REFRESH_DELAY); }
            return addons;
        }, function (e) { if (_loading === p) { _loading = null; } throw e; });
        _loading = p;
        return p;
    }

    // The IPTV playlists, read after the addons loaded: their synthetic addon put first among them
    // (its rows sort first on Home), as if it had been there, and onIptvReady's listeners told.
    var _iptvReadyFns = [];
    function onIptvReady(fn) { _iptvReadyFns.push(fn); }
    function iptvJoin(addons, rev) {
        IPTV.load().then(function () {
            if (rev !== _rev || _loaded !== addons) { return; }   // (your addons changed meanwhile: loaded afresh, with it)
            if (!addons.some(function (a) { return a.url === 'local:iptv'; })) { addons.unshift(IPTV.synthAddon()); }
            _iptvReadyFns.forEach(function (fn) { try { fn(); } catch (e) {} });
        }, function () {});
    }
    // Background refresh of manifests that came from the TV's saved copies. Updates the
    // loaded addons in place, so anything holding them sees the new manifest.
    function refreshSavedManifests(urls) {
        urls = urls.filter(function (u) { return !_refreshedUrls[u]; });
        if (!urls.length) { return; }
        urls.forEach(function (u) { _refreshedUrls[u] = 1; });   // once per session, even if it fails
        fetchManifests(urls).then(function (got) {
            (_loaded || []).forEach(function (a) { if (got[a.url]) { a.manifest = got[a.url]; } });
        });
    }

    function iptvGetPlaylists() { return _hasIptv ? IPTV.getPlaylists() : []; }
    function iptvAddPlaylist(url) {
        var id = _hasIptv ? IPTV.addPlaylist(url) : false;
        configChanged();
        return id;
    }
    function iptvUpdatePlaylist(id, url) {
        var changed = _hasIptv ? IPTV.updatePlaylist(id, url) : false;
        configChanged();
        return changed;
    }
    function iptvRemovePlaylist(id) {
        if (_hasIptv) { IPTV.removePlaylist(id); }
        configChanged();
    }
    function iptvAddXtream(base, user, pass) {   // (as any playlist added: the addons' list made again)
        var id = _hasIptv ? IPTV.addXtream(base, user, pass) : false;
        configChanged();
        return id;
    }
    function iptvAddStalker(portal, mac) {   // (as an Xtream account)
        var id = _hasIptv ? IPTV.addStalker(portal, mac) : false;
        configChanged();
        return id;
    }
    function iptvSetXtreamFormat(id, fmt) {
        var changed = _hasIptv ? IPTV.setXtreamFormat(id, fmt) : false;
        configChanged();
        return changed;
    }
    function iptvRenamePlaylist(id, name) { return _hasIptv ? IPTV.renamePlaylist(id, name) : false; }
    function iptvSetPlaylistGuide(id, url) { return _hasIptv && IPTV.setPlaylistGuide ? IPTV.setPlaylistGuide(id, url) : false; }
    function iptvSetPlaylistOff(id, off) { var ok = _hasIptv ? IPTV.setPlaylistOff(id, off) : false; configChanged(); return ok; }
    function iptvMovePlaylist(id, dir) { var ok = _hasIptv ? IPTV.movePlaylist(id, dir) : false; configChanged(); return ok; }
    function iptvLabel(id) { return _hasIptv ? IPTV.label(id) : ''; }
    function iptvLoad() { return _hasIptv ? IPTV.load() : Promise.resolve(null); }
    function iptvRefreshEvery() { return _hasIptv && IPTV.refreshEvery ? IPTV.refreshEvery() : 0; }
    function iptvSetRefreshEvery(h) { if (_hasIptv && IPTV.setRefreshEvery) { IPTV.setRefreshEvery(h); } }
    function iptvReadAt() { return _hasIptv && IPTV.readAt ? IPTV.readAt() : Infinity; }
    function iptvStatus(id) { return _hasIptv ? IPTV.status(id) : { error: 'IPTV unavailable' }; }
    // Force a re-fetch of one playlist (Settings → Reload) and rebuild the addon list.
    // An Xtream account turned out to have films and series, or none (XtVod.onVodChange): the IPTV
    // rows made again from the saved copies (its film and episode lines in or out), not downloaded.
    function iptvRebuild() {
        if (!_hasIptv) { return; }
        IPTV.reset();
        configChanged();
        loadAddons().then(null, function () {});
    }
    if (typeof XtVod !== 'undefined' && XtVod.onVodChange) { XtVod.onVodChange(iptvRebuild); }
    if (typeof XtVod !== 'undefined' && XtVod.onChange) { XtVod.onChange(function () { sourcesChanged(); }); }   // (its list read: its copies, on titles asked before)
    function iptvReload(id) {
        configChanged();
        return _hasIptv ? IPTV.reload(id) : Promise.resolve(null);
    }

    // Import a mixed, line-oriented setup list. Exact-length alphanumeric lines
    // are integration keys; M3U/M3U8 URLs are IPTV playlists; other URLs are
    // treated as Stremio addon manifests. Blank lines and comments are ignored.
    // A configuration file's lines (Settings › Import configuration file), read but not yet
    // imported: { items: [{ kind: 'addon' | 'playlist' | 'omdb' | 'tmdb' | 'mdblist', value,
    // label, have (already yours), note }], ignored }. Blank lines and # comments skipped.
    var KEY_NAMES = { omdb: 'OMDb key', tmdb: 'TMDB key', mdblist: 'MDBList key' };
    function shortLink(u) {
        var p = U.parseUrl(u);
        if (!p) { return ('' + u).slice(0, 60); }
        var path = ('' + (p.path || '')).replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
        var t = p.host + path;
        return t.length > 64 ? t.slice(0, 61) + '…' : t;
    }
    function parseSetupList(text) {
        var out = { items: [], ignored: 0 }, seen = {}, mine = getAddonUrls(), integ = getIntegrations();
        var lists = (_hasIptv && IPTV.getPlaylists) ? IPTV.getPlaylists().map(function (x) { return x.url; }) : [];
        function push(it) { var k = it.kind + ' ' + it.value; if (seen[k]) { return; } seen[k] = 1; out.items.push(it); }
        ('' + (text || '')).split(/\r?\n/).forEach(function (line) {
            var value = line.trim(), key = null;
            if (!value || value.charAt(0) === '#') { return; }
            if (/^[A-Za-z0-9]{8}$/.test(value)) { key = 'omdb'; }
            else if (/^[A-Za-z0-9]{32}$/.test(value)) { key = 'tmdb'; }
            else if (/^[A-Za-z0-9]{25}$/.test(value)) { key = 'mdblist'; }
            if (key) {
                push({ kind: key, value: value, label: KEY_NAMES[key] + '  ·  …' + value.slice(-4), have: integ[key] === value,
                    note: (integ[key] && integ[key] !== value) ? 'replaces yours' : '' });
            } else if (U.isPlaylistUrl(U.parseUrl(value))) {   // …m3u / .m3u8 (a query after it too), Xtream get.php?…type=m3u_plus
                push({ kind: 'playlist', value: value, label: 'IPTV playlist  ·  ' + shortLink(value), have: lists.indexOf(value) !== -1, note: '' });
            } else if (value.indexOf('://') !== -1 && normalizeManifestUrl(value)) {
                var url = normalizeManifestUrl(value);
                push({ kind: 'addon', value: url, label: 'Addon  ·  ' + shortLink(url), have: mine.indexOf(url) !== -1, note: '' });
            } else {
                out.ignored++;
            }
        });
        return out;
    }
    // Import the chosen lines (parseSetupList's items): what was added, as importSetupList says.
    function applySetupEntries(items) {
        var result = { addons: 0, playlists: 0, omdb: false, tmdb: false, mdblist: false, ignored: 0 };
        (items || []).forEach(function (it) {
            if (KEY_NAMES[it.kind]) { setIntegration(it.kind, it.value); result[it.kind] = true; }
            else if (it.kind === 'playlist') { if (iptvAddPlaylist(it.value)) { result.playlists++; } else { result.ignored++; } }
            else if (it.kind === 'addon') {
                var added = addAddon(it.value);
                if (added) { result.addons++; if (!addonOrigin(added)) { setAddonOrigin(added, 'config'); } } else { result.ignored++; }
            }
        });
        return result;
    }
    // Every line at once (as before the list to tick: kept for what imports without asking).
    function importSetupList(text) {
        var parsed = parseSetupList(text), r = applySetupEntries(parsed.items);
        r.ignored += parsed.ignored;
        return r;
    }

    // ---- Resource matching ----
    function resourceEntries(addon) {
        var res = (addon.manifest.resources) || [];
        var out = [];
        res.forEach(function (r) {
            if (typeof r === 'string') {
                out.push({ name: r, types: addon.manifest.types || [], idPrefixes: addon.manifest.idPrefixes || null });
            } else if (r && r.name) {
                out.push({ name: r.name, types: r.types || addon.manifest.types || [], idPrefixes: r.idPrefixes || addon.manifest.idPrefixes || null });
            }
        });
        return out;
    }

    function supports(addon, resourceName, type, id) {
        var entries = resourceEntries(addon);
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.name !== resourceName) { continue; }
            if (type && e.types && e.types.length && e.types.indexOf(type) === -1) { continue; }
            if (id && e.idPrefixes && e.idPrefixes.length) {
                var ok = false;
                for (var j = 0; j < e.idPrefixes.length; j++) {
                    if (id.indexOf(e.idPrefixes[j]) === 0) { ok = true; break; }
                }
                if (!ok) { continue; }
            }
            return true;
        }
        return false;
    }

    // An addon that declares this id's prefix for a resource (whatever the type), and the
    // type it serves it as (its first for that resource).
    function ownsId(addon, resourceName, id) {
        var entries = resourceEntries(addon);
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.name !== resourceName || !e.idPrefixes || !e.idPrefixes.length) { continue; }
            for (var j = 0; j < e.idPrefixes.length; j++) { if (id.indexOf(e.idPrefixes[j]) === 0) { return true; } }
        }
        return false;
    }
    function ownType(addon, resourceName) {
        var entries = resourceEntries(addon);
        for (var i = 0; i < entries.length; i++) { if (entries[i].name === resourceName && entries[i].types && entries[i].types.length) { return entries[i].types[0]; } }
        return '';
    }

    // ---- Catalogs ----
    // Returns list of {addon, type, id, name} across all addons.
    var TYPE_LABELS = { movie: 'Movies', series: 'Series', tv: 'IPTV', radio: 'Radio', channel: 'Channels', people: 'People' };
    function prettyType(t) {
        if (TYPE_LABELS[t]) { return TYPE_LABELS[t]; }
        return t ? (t.charAt(0).toUpperCase() + t.slice(1)) : '';
    }

    function listCatalogs() {
        return loadAddons().then(function (addons) {
            var cats = [];
            addons.forEach(function (addon) {
                var cs = addon.manifest.catalogs || [];
                cs.forEach(function (c) {
                    if (!c.type || !c.id) { return; }
                    var label = c.name || c.id;
                    // Include the type so per-type catalogs sharing a name (e.g. Cinemeta's
                    // "Popular" for both movie & series) don't look like duplicates.
                    cats.push({ addon: addon, type: c.type, id: c.id, def: c, label: label,
                        name: prettyType(c.type) + ' · ' + label + '  ·  ' + (addon.manifest.name || 'Addon') });
                });
            });
            return cats;
        });
    }

    function buildCatalogUrl(addon, type, id, extra) {
        var extras = [];
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined && extra[k] !== '') {
                    extras.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
                }
            }
        }
        var tail = extras.length ? ('/' + extras.join('&')) : '';
        return addon.base + '/catalog/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + tail + '.json';
    }

    // A search can take an addon a while (Cinemeta's often 8 s or more): it gets longer
    // than a catalog page.
    var CATALOG_TIMEOUT_MS = 12000, SEARCH_TIMEOUT_MS = 25000;
    // Some addons answer an empty list when they fail (YouTubio does, on any error: a
    // "Nothing here" one moment, 100 videos the next). A catalog's (or a search's) first page
    // that had titles earlier this session: an empty answer or a failure is tried once more
    // after 2 s, and if that's empty too, the titles from earlier come back, marked
    // .stale = true (Discover and Search say so). Later pages are as they come.
    var _lastGood = U.lru(60), RETRY_EMPTY_MS = 2000;
    // cancel (optional, U.cancelToken): the screen asking was left — its download stopped.
    function getCatalog(cat, extra, cancel) {
        if (cat.addon && cat.addon.__local) { return (cat.addon.__impl || IPTV).catalog(cat.id, extra); }
        var first = !(extra && +extra.skip > 0);
        var key = first ? catalogKey(cat) + '|' + JSON.stringify(extra || {}) : null;
        function ask() {
            return U.getJSON(buildCatalogUrl(cat.addon, cat.type, cat.id, extra), addonMs((extra && extra.search) ? SEARCH_TIMEOUT_MS : CATALOG_TIMEOUT_MS), undefined, cancel)
                .then(function (res) {
                    return U.listOf(fromAddon(cat.addon, res, 'catalog').metas, MAX_METAS, function (m) { return !!m.id; });
                });
        }
        function earlier(e) {
            var prev = _lastGood.get(key);
            if (!prev) { if (e) { throw e; } return []; }
            var out = prev.slice(); out.stale = true;
            return out;
        }
        if (!key) { return ask(); }
        return ask().then(function (metas) {
            if (metas.length) { _lastGood.set(key, metas); return metas; }
            if (!_lastGood.get(key)) { return metas; }   // (nothing before either: really empty)
            return again();
        }, function (e) {
            if (!_lastGood.get(key)) { throw e; }
            return again(e);
        });
        function again(e0) {
            return new Promise(function (r) { setTimeout(r, RETRY_EMPTY_MS); }).then(ask).then(function (m2) {
                if (m2.length) { _lastGood.set(key, m2); return m2; }
                return earlier(null);
            }, function () { return earlier(e0 || null); });
        }
    }

    // ---- Feed lists: order + show / hide, as the user sets them ----
    // Home feeds (the Home rows: every catalog) and search sources (the Search rows:
    // every catalog that can search) each keep their own { order: [keys], hidden: [keys] }.
    // Anything new (an addon added later) goes after the ordered ones, in addon order, but for a
    // catalog that asks to come first (def._first: IPTV's Favorites) until you place it.
    var FEEDS_KEY = 'stremiok.feeds', SEARCH_FEEDS_KEY = 'stremiok.searchfeeds';
    function catalogKey(cat) {
        var aid = (cat.addon.manifest && cat.addon.manifest.id) || cat.addon.url;
        return cat.type + '|' + cat.id + '|' + aid;
    }
    // list(): all items (promise); keyOf(item): its key
    function feedList(storeKey, list, keyOf) {
        function cfg() { var f = U.store.get(storeKey, {}) || {}; return { order: f.order || [], hidden: f.hidden || [] }; }
        function sort(items) {
            var pos = {};
            cfg().order.forEach(function (k, i) { pos[k] = i; });
            return items.map(function (c, i) { return { c: c, i: i, k: keyOf(c) }; }).sort(function (a, b) {
                var pa = (pos[a.k] !== undefined) ? pos[a.k] : (a.c && a.c.def && a.c.def._first) ? -1 : (100000 + a.i);
                var pb = (pos[b.k] !== undefined) ? pos[b.k] : (b.c && b.c.def && b.c.def._first) ? -1 : (100000 + b.i);
                return pa - pb;
            }).map(function (x) { return x.c; });
        }
        function isHidden(key) { return cfg().hidden.indexOf(key) !== -1; }
        return {
            ordered: function () { return list().then(sort); },
            visible: function () { return list().then(function (items) { return sort(items).filter(function (c) { return !isHidden(keyOf(c)); }); }); },
            move: function (key, dir) {
                return list().then(function (items) {
                    var ordered = sort(items).map(keyOf);
                    if (!U.moveIn(ordered, ordered.indexOf(key), dir)) { return; }
                    var c = cfg(); c.order = ordered; U.store.set(storeKey, c);
                });
            },
            toggle: function (key) {
                var c = cfg(), h = {};
                c.hidden.forEach(function (k) { h[k] = 1; });
                if (h[key]) { delete h[key]; } else { h[key] = 1; }
                c.hidden = Object.keys(h);
                U.store.set(storeKey, c);
            },
            isHidden: isHidden
        };
    }
    // Home feeds: every catalog but those that only answer a search (they have nothing to
    // show as a row: YouTube's Videos / Channels, an addon's "Search" catalogs).
    function searchOnly(c) {
        var def = c.def || {};
        return (def.extra || []).some(function (e) { return e && e.name === 'search' && e.isRequired; }) || (def.extraRequired || []).indexOf('search') !== -1;
    }
    // Catalogs Home leaves to Discover (and Search): anime (AIOMetadata's "anime" type, movies
    // and series mixed, which no Home tab fits; it used to land in IPTV's).
    function discoverOnly(c) { return /^anime$/i.test(c.type || ''); }
    var homeFeeds = feedList(FEEDS_KEY, function () { return listCatalogs().then(function (cats) { return cats.filter(function (c) { return !searchOnly(c) && !discoverOnly(c); }); }); }, catalogKey);

    // Feed sources (the Addons list at the bottom of Settings > Playback > Source ranking):
    // the addons that provide sources to play (Torrentio, AIOStreams, …; not IPTV, whose
    // channels carry their own). One turned off isn't asked; they're asked in this order, and
    // it's the "Feed sources order" criterion (sources carry s._addonRank, and s._addonPos,
    // their place in their addon's list, for "Each addon's own order").
    var SOURCE_FEEDS_KEY = 'stremiok.sourcefeeds';
    function addonKey(a) { return (a.manifest && a.manifest.id) || a.url; }
    function streamAddons() {
        return loadAddons().then(function (addons) {
            return addons.filter(function (a) { return (!a.__local || a.__sources) && supports(a, 'stream'); }).map(function (a) {
                return { key: addonKey(a), name: (a.manifest && a.manifest.name) || a.url, addon: a };
            });
        });
    }
    var sourceFeeds = feedList(SOURCE_FEEDS_KEY, streamAddons, function (x) { return x.key; });
    // Whether any addon you have provides sources (true while the addons aren't loaded yet)
    function hasStreamAddons() { return !_loaded || _loaded.some(function (a) { return (!a.__local || a.__sources) && supports(a, 'stream'); }); }
    function sourcesChanged() { _streamCache = {}; _streamOrder = []; }   // (cached lists came from the old set)

    // ---- Source ranking (Settings > Source ranking) ----
    // How sources are ordered, each criterion movable and switchable (resolution too: first,
    // it groups the list by resolution); ties end in the order the addons gave them. And
    // whether sources played before go first. Stored as { order: [keys], off: [keys], played }.
    var RANKING_KEY = 'stremiok.ranking';
    var RANK_CRITERIA = [
        ['res', 'Resolution (high to low)', '4K, 1440p, 1080p, 720p, SD, then unknown; at the top, the sources are grouped by resolution'],
        ['uncached', 'Not yet cached last', 'sources an addon marks as not cached on your debrid service yet (they can’t start right away)'],
        ['kind', 'Release type', 'remux > Blu-ray > web > unknown > TV rip, CAM rips far below'],
        ['hdr', 'HDR before SDR', 'HDR10 / HDR10+ / Dolby Vision first'],
        ['seeds', 'Seeders (high to low)', 'torrent sources with more people sharing them first, by the count they state (👤 123, or Seeders: 123); the others keep their order'],
        ['addon', 'Feed sources order', 'your order of the addons (at the bottom of this page)'],
        ['within', 'Each addon\'s own order', 'the order an addon lists its sources in (its first, then its second…); right after Feed sources order: each addon\'s list as it gives it'],
        ['cached', 'Cached before unknown', 'sources an addon marks as cached ahead of ones with no mark']
    ];
    var RANK_OFF_DEFAULT = ['cached'];
    var RANK_AFTER = { seeds: 'hdr' };   // (added in 2.2.1.13)
    function getRanking() {
        var r = U.store.get(RANKING_KEY, null) || {}, known = {}, order = [];
        RANK_CRITERIA.forEach(function (c) { known[c[0]] = c; });
        (r.order || []).forEach(function (k) { if (known[k] && order.indexOf(k) === -1) { order.push(k); } });
        // one missing from a saved order goes where it is by default (Resolution: first), or right
        // after the one it follows (RANK_AFTER: Seeders after HDR, wherever you moved that)
        RANK_CRITERIA.forEach(function (c, i) {
            if (order.indexOf(c[0]) !== -1) { return; }
            var after = RANK_AFTER[c[0]] ? order.indexOf(RANK_AFTER[c[0]]) : -1;
            order.splice(after !== -1 ? after + 1 : Math.min(i, order.length), 0, c[0]);
        });
        var off = r.off || RANK_OFF_DEFAULT;
        return { played: r.played !== false, criteria: order.map(function (k) {
            return { key: k, name: known[k][1], sub: known[k][2], on: off.indexOf(k) === -1 };
        }) };
    }
    function saveRanking(g) {
        U.store.set(RANKING_KEY, { played: g.played, order: g.criteria.map(function (c) { return c.key; }),
            off: g.criteria.filter(function (c) { return !c.on; }).map(function (c) { return c.key; }) });
    }
    function moveRanking(key, dir) {
        var g = getRanking(), i = -1;
        g.criteria.forEach(function (c, n) { if (c.key === key) { i = n; } });
        if (!U.moveIn(g.criteria, i, dir)) { return; }
        saveRanking(g);
    }
    function toggleRanking(key) {
        var g = getRanking();
        g.criteria.forEach(function (c) { if (c.key === key) { c.on = !c.on; } });
        saveRanking(g);
    }
    function setPlayedFirst(on) { var g = getRanking(); g.played = !!on; saveRanking(g); }
    function resetRanking() { U.store.remove(RANKING_KEY); }

    function listCatalogsOrdered() { return homeFeeds.ordered(); }   // (Settings > Appearance > Home feeds)
    function catalogsForHome() { return homeFeeds.visible(); }      // ordered + shown (the Home rows)
    function moveFeed(key, dir) { return homeFeeds.move(key, dir); }
    function toggleFeed(key) { homeFeeds.toggle(key); }
    function isFeedHidden(key) { return homeFeeds.isHidden(key); }

    // ---- Meta ----
    // Session cache so Detail -> Back -> same title doesn't re-download the meta
    // (series metas carry every episode). Bounded; oldest entry is evicted first.
    var META_CACHE_MAX = 20;
    var _metaCache = {}, _metaOrder = [];
    function cacheMeta(key, meta) {
        if (meta && meta.noCache) { return; }   // addon asks for fresh data every time (e.g. a Downloads list)
        if (!_metaCache[key]) {
            _metaOrder.push(key);
            if (_metaOrder.length > META_CACHE_MAX) { delete _metaCache[_metaOrder.shift()]; }
        }
        _metaCache[key] = meta;
    }
    function resetMetaCache() { _metaCache = {}; _metaOrder = []; }

    // An episode listed more than once (an addon describing a show from your files: one
    // entry per file) is kept once, where it's first listed: the entry that looks most like
    // an episode (its id the show's own "<show>:<season>:<episode>", a real title rather than
    // a file name, a date, a picture). Entries without a season and episode are all kept.
    var FILE_NAME = /\.(mkv|mp4|avi|m4v|mov|wmv|ts|webm|flv)$/i;
    function oneEach(videos, showId) {
        function score(v) {
            var t = '' + (v.title || v.name || '');
            return (('' + v.id).indexOf(showId + ':') === 0 ? 8 : 0) + (t && !FILE_NAME.test(t) ? 4 : 0) + (v.released ? 2 : 0) + (v.thumbnail ? 1 : 0);
        }
        var at = {}, out = [];
        videos.forEach(function (v) {
            var sn = v && +v.season, ep = v && +v.episode;
            if (!v || !isFinite(sn) || !isFinite(ep) || v.season == null || v.episode == null) { out.push(v); return; }
            var k = sn + ':' + ep;
            if (at[k] === undefined) { at[k] = out.length; out.push(v); return; }
            if (score(v) > score(out[at[k]])) { out[at[k]] = v; }
        });
        return out.filter(Boolean);
    }

    // An addon's error sent as a title's details (AIOStreams: "aiostreamserror.…", its name
    // "[❌] <the addon that failed>", the error as its description; AIOMetadata: "aiom.error.…"):
    // not the title, so the next addon is asked.
    function isErrorMeta(m) { return /^(aiostreamserror\.|aiom\.error\.)/.test('' + (m && m.id)); }
    function getMeta(type, id, cancel) {
        if (/^ytk:/.test(id) && typeof YouTube !== 'undefined') {
            return YouTube.meta(id).then(function (m) { if (!m) { throw new Error('Not found on YouTube'); } return m; });
        }
        if (/^xv[ms]\./.test(id) && typeof XtVod !== 'undefined') {
            return XtVod.meta(type, id).then(function (m) { if (!m) { throw new Error('Not found on the Xtream server'); } return m; });
        }
        if (/^iptv:/.test(id)) {
            return IPTV.meta(id).then(function (m) {
                if (!m) { throw new Error('IPTV channel not found'); }
                return m;
            });
        }
        var ck = type + ':' + id;
        if (_metaCache[ck]) { return Promise.resolve(_metaCache[ck]); }
        return loadAddons().then(function (addons) {
            var providers = addons.filter(function (a) { return supports(a, 'meta', type, id); });
            var asType = {};   // addon url -> the type it's asked for, when not `type`
            // No addon for this type: one whose ids are these, asked as its own type. (A
            // YouTube channel StremioK shows as a series is "YouTube" to YouTubio: its
            // Continue Watching entries come back as series.)
            if (!providers.length && id) {
                providers = addons.filter(function (a) { return !a.__local && ownsId(a, 'meta', id); });
                providers.forEach(function (a) { asType[a.url] = ownType(a, 'meta'); });
            }
            if (!providers.length) { return Promise.reject(new Error('No meta addon for ' + type)); }
            var i = 0;
            function tryNext() {
                if (i >= providers.length) { return Promise.reject(new Error('Meta not found')); }
                var a = providers[i++];
                var url = a.base + '/meta/' + encodeURIComponent(asType[a.url] || type) + '/' + encodeURIComponent(id) + '.json';
                return U.getJSON(url, addonMs(12000), META_MAX, cancel).then(function (res) {
                    var meta = fromAddon(a, res, 'title details').meta;
                    if (meta && typeof meta === 'object' && isErrorMeta(meta)) {
                        U.log('addon', ((a.manifest && a.manifest.name) || 'An addon') + ' sent an error instead of details for ' + id + ': ' +
                            String(meta.name || '').slice(0, 80) + (meta.description ? ' (' + String(meta.description).slice(0, 120) + ')' : ''));
                        return tryNext();
                    }
                    if (meta && typeof meta === 'object') {
                        if (meta.videos !== undefined) { meta.videos = oneEach(U.listOf(meta.videos, MAX_EPISODES), meta.id || id); }
                        meta._from = (a.manifest && a.manifest.name) || '';   // (the title page says which addon described it)
                        if (type === 'series' && typeof Trakt !== 'undefined' && Trakt.noteEpisodes) { Trakt.noteEpisodes(meta); }   // (episodes' TheTVDB numbers, for shows Trakt numbers otherwise)
                        cacheMeta(ck, meta); return meta;
                    }
                    return tryNext();
                }, function (e) { if (e && e.cancelled) { throw e; } return tryNext(); });
            }
            return tryNext();
        });
    }

    // ---- Streams ----
    // Aggregates stream lists from every addon that supports the (type,id).
    //   onUpdate(list, pending): optional, called as each addon answers with everything
    //     received so far (in addon order) and how many addons are still loading, so a
    //     slow addon doesn't hold up the sources that already arrived.
    //   force: skip the short-lived cache (Re-scan).
    // Results are kept for a few minutes, and a request already in flight is shared, so
    // opening a title twice, or asking for the next episode early, costs no extra requests.
    var STREAM_TTL = 10 * 60 * 1000, STREAM_CACHE_MAX = 30, RETRY_EMPTY_STREAMS_MS = 3000;
    // AIOStreams answers some things as pretend sources: why it has none for you ("Removal
    // Reasons", "Digital Release Filter") and its errors (streamData.type statistic / error).
    // They're not listed as sources; a "No sources found" page shows them (streamNotes).
    function isNotice(s) { var t = s && s.streamData && s.streamData.type; return t === 'statistic' || t === 'error'; }
    var _streamNotes = U.lru(30);
    function streamNotes(type, id) { return _streamNotes.get(type + ':' + id) || []; }
    var _streamCache = {}, _streamOrder = [];
    function getStreams(type, id, onUpdate, force) {
        if (/^ytk:/.test(id) && typeof YouTube !== 'undefined') {
            return YouTube.streams(id).then(function (l) { l = l.map(youTubeSource); l.forEach(function (s) { s._addon = 'YouTube'; }); if (onUpdate) { onUpdate(l, 0); } return l; });
        }
        if (/^iptv:/.test(id)) {
            return IPTV.streams(id).then(function (l) { if (onUpdate) { onUpdate(l, 0); } return l; });
        }
        if (/^xv[ms]\./.test(id) && typeof XtVod !== 'undefined') {   // (an Xtream account's own film or episode)
            return XtVod.streams(type, id).then(function (l) { l.forEach(function (s) { s._addon = 'Xtream'; }); if (onUpdate) { onUpdate(l, 0); } return l; });
        }
        var key = type + ':' + id, e = _streamCache[key];
        if (e && !force && (e.pending > 0 || Date.now() - e.at < STREAM_TTL)) {
            syncLocal(e, type, id);   // (the addons' answers kept; the USB drive's matches as they are now)
            if (onUpdate) {
                if (!e.done) { e.listeners.push(onUpdate); }   // (still loading: told as each addon answers)
                if (e.started) { onUpdate(e.list, e.pending); }   // (done: told once, now, and not kept)
            }
            return e.promise.then(function () { syncLocal(e, type, id); return e.list; });
        }
        if (!_streamCache[key]) {
            _streamOrder.push(key);
            if (_streamOrder.length > STREAM_CACHE_MAX) { delete _streamCache[_streamOrder.shift()]; }
        }
        e = _streamCache[key] = { list: [], pending: 1, at: 0, listeners: onUpdate ? [onUpdate] : [], started: false };
        // the files on a USB drive matched to this movie / episode: first, as soon as asked (its
        // saved index read first when nothing has read the drive since launch: localReady)
        var local = localFor(type, id);
        function notify() {
            for (var i = 0; i < e.listeners.length; i++) { try { e.listeners[i](e.list, e.pending); } catch (x) {} }
        }
        e.promise = localReady().then(function () { local = localFor(type, id); return sourceFeeds.visible(); }).then(function (feeds) {   // (your order; the ones turned off left out)
            var providers = feeds.map(function (f) { return f.addon; }).filter(function (a) { return supports(a, 'stream', type, id); });
            var slots = providers.map(function () { return []; }), okCount = 0, notes = [];
            e.started = true;
            e.list = local.slice();
            function ask() {   // one round: every source addon, 4 at a time
                okCount = 0;
                e.pending = providers.length;
                notes = [];
                notify();
                return U.settleAll(providers.map(function (a, i) {
                    return function () {
                        var url = a.base + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
                        // (StremioK's own source, your Xtream accounts' copies: asked here, with the title's details)
                        var asked = a.__impl ? metaFirst(type, id).then(function (m) { return a.__impl.streams(type, id, m); }).then(function (l) { return { streams: l }; }) : U.getJSON(url, addonMs(15000));
                        return asked.then(function (res) {
                            var arr = U.listOf(a.__impl ? res.streams : fromAddon(a, res, 'sources').streams, MAX_STREAMS).map(youTubeSource).map(torrentSource), said = notes.length;
                            arr = arr.filter(function (s) {   // (an addon's notices: what it removed and why, its errors; not sources)
                                if (!isNotice(s)) { return true; }
                                notes.push({ addon: a.manifest.name || 'Addon', title: ('' + (s.name || '')).replace(/\s+/g, ' ').trim().slice(0, 120),
                                    text: ('' + (s.description || s.title || '')).split('\n').map(function (l) { return l.trim(); }).filter(Boolean).join('   ·   ').slice(0, 400) });
                                return false;
                            });
                            arr.forEach(function (s, n) {
                                s._addon = a.manifest.name || 'Addon'; s._addonRank = i; s._addonPos = n;
                                // (a source that needs its own player settings: its User-Agent and Referer, as an IPTV channel's)
                                var ph = s.behaviorHints && s.behaviorHints.proxyHeaders, h = ph && ph.request ? U.sanitizeHeaders(ph.request) : null;
                                if (h) { s._headers = h; }
                            });
                            slots[i] = arr; okCount++;
                            if (!arr.length && notes.length === said) { note(a, i, 'no sources for this'); }   // (its notices say why, when it sent any)
                        }).then(function () { done(); }, function (err) {
                            // (no answer in time: what you played from it before, marked so — see keptSources)
                            if (isTimeout(err) && !slots[i].length) { slots[i] = keptSources(type, id, a, i); }
                            note(a, i, whyNone(err));
                            done(); throw err;
                        });
                    };
                }), 4);
            }
            // Why an addon gave nothing ("No sources found" shows it), in your addon order
            function note(a, i, why) { notes.push({ addon: a.manifest.name || 'Addon', title: why, text: '', rank: i }); }
            function done() {
                e.pending--;
                e.list = local.concat([].concat.apply([], slots));
                notes.sort(function (x, y) { return (x.rank === undefined ? -1 : x.rank) - (y.rank === undefined ? -1 : y.rank); });
                _streamNotes.set(key, notes.slice(0, 10));
                notify();
            }
            // Addons that gather from others (AIOStreams…) can answer nothing while those are
            // slow, and have it a moment later; or take longer than we wait the first time, and
            // keep gathering after it, with it ready the next time: with nothing from anyone
            // (empty answers, or none in time), asked once more.
            function fresh() { return e.list.filter(function (s) { return !s._earlier; }).length; }   // (not the kept ones)
            return ask().then(function (results) {
                var late = !okCount && (results || []).some(function (r) { return r && !r.ok && isTimeout(r.error); });
                if (!providers.length || fresh() > local.length || (!okCount && !late)) { return null; }
                e.pending = providers.length; notify();   // (still loading, not "No sources found", meanwhile)
                return new Promise(function (r) { setTimeout(r, RETRY_EMPTY_STREAMS_MS); }).then(ask);
            }).then(function () {
                e.at = Date.now();
                e.done = true; e.listeners = [];   // (nothing more to tell: none kept)
                // Nothing (no answer, or no sources): not kept, so opening it again asks again.
                if (providers.length && (!okCount || fresh() <= local.length) && _streamCache[key] === e) { delete _streamCache[key]; }
                return e.list;
            });
        }, function (err) {
            if (_streamCache[key] === e) { delete _streamCache[key]; }
            throw err;
        });
        return e.promise;
    }

    // A title's details, if its page has them (a series': its show's): for StremioK's own sources.
    function metaKept(type, id) { return _metaCache[type + ':' + (type === 'series' ? ('' + id).split(':')[0] : id)] || null; }
    // ...asked for when it doesn't yet (a film's sources are asked for alongside its details): the
    // others' sources don't wait for this one's.
    function metaFirst(type, id) {
        var m = metaKept(type, id);
        if (m) { return Promise.resolve(m); }
        return getMeta(type, type === 'series' ? ('' + id).split(':')[0] : id).then(null, function () { return null; });
    }
    function isTimeout(err) { return /^(Timeout|Timed out)/.test((err && err.message) || ''); }
    // Why an addon's sources didn't come, in a few words (its link, and any token in it, left out):
    // "refused (HTTP 429 · rate_limited)", "didn't answer in time", "couldn't be reached"…
    function whyNone(err) {
        var m = String((err && err.message) || ''), h = /^HTTP (\d{3}) for \S+(?::\s+(.+))?$/.exec(m);   // (its message after ": ", not the link's "://")
        if (h) { return 'refused (HTTP ' + h[1] + (h[2] ? ' · ' + h[2].replace(/https?:\/\/\S+/g, '…').slice(0, 80) : '') + ')'; }
        if (isTimeout(err)) { return 'didn’t answer in time'; }
        if (/^(No answer|Network error)/.test(m)) { return 'couldn’t be reached'; }
        if (/^Too large/.test(m)) { return 'sent too much (' + (/\(([^)]+)\)/.exec(m) || ['', 'too large'])[1] + ')'; }
        return 'failed (' + m.replace(/https?:\/\/\S+/g, '…').slice(0, 80) + ')';
    }

    // The debrid service a source comes through, from its tag ("[TB⚡]", "[RD+]"): { tag, name } or null.
    var DEBRIDS = { TB: 'TorBox', RD: 'Real-Debrid', AD: 'AllDebrid', PM: 'Premiumize', DL: 'Debrid-Link', ED: 'EasyDebrid', OC: 'Offcloud', PP: 'PikPak' };
    function debridOf(st) {
        var m = /\[(TB|RD|AD|PM|DL|ED|OC|PP)\b/i.exec(st ? ('' + (st.name || '')) + ' ' + ('' + (st.title || '')) : '');
        return m ? { tag: m[1].toUpperCase(), name: DEBRIDS[m[1].toUpperCase()] } : null;
    }

    // A title's matches on a USB drive (js/local.js): the drive's saved index read first when a
    // drive is plugged in and nothing has read it since launch (LOCAL_WAIT_MS at most: the
    // addons aren't held up for long); a kept list given the matches as they are now.
    var LOCAL_WAIT_MS = 3000;
    function localFor(type, id) { return (typeof LocalMedia !== 'undefined' && LocalMedia.streamsFor) ? LocalMedia.streamsFor(type, id) : []; }
    function isLocal(s) { return (typeof LocalMedia !== 'undefined' && LocalMedia.isLocalStream) ? LocalMedia.isLocalStream(s) : !!(s && s._local); }
    function syncLocal(e, type, id) { e.list = localFor(type, id).concat(e.list.filter(function (s) { return !isLocal(s); })); }
    function localReady() {
        if (typeof LocalMedia === 'undefined' || !LocalMedia.ensure || !LocalMedia.present || !LocalMedia.present() || !LocalMedia.isRead || LocalMedia.isRead()) { return Promise.resolve(); }
        return new Promise(function (resolve) {
            var t = setTimeout(resolve, LOCAL_WAIT_MS);
            LocalMedia.ensure().then(function () { clearTimeout(t); resolve(); }, function () { clearTimeout(t); resolve(); });
        });
    }

    // ---- Sources you played, kept (per movie / episode) ----
    // A source that played (not privately) is kept as the addon sent it: the last KEPT_PER for
    // each movie or episode, KEPT_TITLES in all. When that addon doesn't answer in time, they're
    // listed anyway, marked _earlier (when you played it): not asked fresh, and a link given a
    // while ago may not play any more. One that fails to play is dropped.
    var KEPT_KEY = 'stremiok.keptsrc', KEPT_PER = 3, KEPT_TITLES = 150;
    var KEPT_SKIP = ['_addonRank', '_addonPos', '_also', '_earlier', '_dupes'];
    function keptAll() { var k = U.store.get(KEPT_KEY, {}); return (k && typeof k === 'object' && !Array.isArray(k)) ? k : {}; }
    function sourceId(st) { var bh = st.behaviorHints || {}; return (bh.filename && bh.videoSize) ? 'f|' + ('' + bh.filename).toLowerCase() + '|' + bh.videoSize : 'u|' + st.url; }
    function keepSource(type, id, st) {
        if (!st || typeof st.url !== 'string' || !/^https?:\/\//i.test(st.url) || st._localFile || !st._addon) { return; }
        var copy = {};
        Object.keys(st).forEach(function (k) { if (KEPT_SKIP.indexOf(k) === -1) { copy[k] = st[k]; } });
        if (st._torrent) { delete copy.url; delete copy._pickFile; }   // (its link: made again from the streaming server set then)
        var all = keptAll(), key = type + ':' + id, sid = sourceId(st);
        var list = (Array.isArray(all[key]) ? all[key] : []).filter(function (x) { return x && x.st && sourceId(x.st) !== sid; });
        list.unshift({ at: Date.now(), st: copy });
        all[key] = list.slice(0, KEPT_PER);
        var keys = Object.keys(all);
        if (keys.length > KEPT_TITLES) {
            keys.sort(function (a, b) { return ((all[a][0] || {}).at || 0) - ((all[b][0] || {}).at || 0); });
            keys.slice(0, keys.length - KEPT_TITLES).forEach(function (k) { delete all[k]; });
        }
        U.store.set(KEPT_KEY, all);
    }
    function forgetSource(type, id, st) {
        var all = keptAll(), key = type + ':' + id;
        if (!st || !Array.isArray(all[key])) { return; }
        var sid = sourceId(st);
        all[key] = all[key].filter(function (x) { return x && x.st && sourceId(x.st) !== sid; });
        if (!all[key].length) { delete all[key]; }
        U.store.set(KEPT_KEY, all);
    }
    function keptSources(type, id, addon, rank) {
        var name = (addon && addon.manifest && addon.manifest.name) || 'Addon', list = keptAll()[type + ':' + id];
        return (Array.isArray(list) ? list : []).filter(function (x) { return x && x.st && x.st._addon === name; }).map(function (x, n) {
            var s = {};
            Object.keys(x.st).forEach(function (k) { s[k] = x.st[k]; });
            s._earlier = x.at || 1; s._addonRank = rank; s._addonPos = n;
            if (s._torrent) { torrentSource(s); }   // (none with no server set: not playable)
            return s;
        });
    }

    // Warm the cache for a title's sources without waiting on them (e.g. the next episode).
    function prefetchStreams(type, id) { getStreams(type, id).then(null, function () {}); }

    // One entry per actual file. The same release is often offered by several addons
    // (e.g. Torrentio and MediaFusion both resolving it through Real-Debrid); keep the
    // first and note where else it's available (s._also). Matched by file name + size,
    // else torrent hash + file, else URL.
    function streamKey(s) {
        var bh = s.behaviorHints || {};
        if (bh.filename && bh.videoSize) { return 'f|' + ('' + bh.filename).toLowerCase() + '|' + bh.videoSize; }
        if (s.infoHash) { return 'h|' + ('' + s.infoHash).toLowerCase() + '|' + (s.fileIdx || 0); }
        if (s.url) { return 'u|' + s.url; }
        return null;
    }
    function dedupeStreams(list) {
        var seen = {}, out = [];   // (keys prefixed: f| h| u|, never an object's own names)
        (list || []).forEach(function (s) {
            var k = streamKey(s);
            var first = k ? seen[k] : null;
            if (!first) { if (k) { seen[k] = s; } out.push(s); return; }
            if (s._addon && s._addon !== first._addon) {
                // don't mutate the cached stream object: annotate a copy
                if (!Object.prototype.hasOwnProperty.call(first, '_also')) {
                    var copy = {}; for (var p in first) { if (Object.prototype.hasOwnProperty.call(first, p)) { copy[p] = first[p]; } }
                    copy._also = [];
                    out[out.indexOf(first)] = copy; seen[k] = copy; first = copy;
                }
                if (first._also.indexOf(s._addon) === -1) { first._also.push(s._addon); }
            }
        });
        return out;
    }

    // ---- Subtitles ----
    // Aggregates subtitle tracks from every addon that supports (type,id).
    // extra (a file on a USB drive): { videoHash, videoSize, filename }, as Stremio sends them,
    // so OpenSubtitles can put the ones made for that exact file first.
    function getSubtitles(type, id, extra) {
        var args = [];
        if (extra) {
            if (extra.videoHash && /^[0-9a-f]{16}$/.test(extra.videoHash)) { args.push('videoHash=' + extra.videoHash); }
            if (extra.videoSize > 0) { args.push('videoSize=' + Math.floor(extra.videoSize)); }
            if (extra.filename) { args.push('filename=' + encodeURIComponent(('' + extra.filename).slice(0, 200))); }
        }
        return loadAddons().then(function (addons) {
            var providers = addons.filter(function (a) { return supports(a, 'subtitles', type, id); });
            var tasks = providers.map(function (a) {
                return function () {
                    var url = a.base + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + (args.length ? '/' + args.join('&') : '') + '.json';
                    return U.getJSON(url, addonMs(15000)).then(function (res) {   // (15 s: a subtitle addon may fetch them from elsewhere first)
                        var arr = U.listOf(fromAddon(a, res, 'subtitles').subtitles, MAX_SUBTITLES);
                        arr.forEach(function (s) { s._addon = a.manifest.name || 'Addon'; });
                        return arr;
                    });
                };
            });
            return U.settleAll(tasks, 4).then(function (results) {
                var seen = {}, out = [];
                results.forEach(function (r) {
                    if (!r.ok) { return; }
                    r.value.forEach(function (s) {
                        if (!s || !s.url || seen[s.url]) { return; }
                        seen[s.url] = 1;
                        s._at = out.length;   // (your addon order, then each addon's own: the order within a language)
                        out.push(s);
                    });
                });
                // By language, and within one as they came (the TV's sort doesn't keep the order of
                // equal items: an addon's best match could end up anywhere among its language's).
                out.sort(function (a, b) { return ('' + (a.lang || '')).localeCompare('' + (b.lang || '')) || a._at - b._at; });
                return out;
            });
        });
    }

    // ---- TMDB / MDBList (uses keys from Integrations) ----
    var TMDB_IMG = 'https://image.tmdb.org/t/p/';
    // Session caches of TMDB / OMDb / MDBList answers: bounded, and failures aren't kept
    // (a network hiccup doesn't blank Cast & more or the ratings until the app restarts).
    var _tmdbCache = U.lru(60), _omdbCache = U.lru(60), _mdbCache = U.lru(100);

    function tmdbKey() { return getIntegrations().tmdb; }
    function tmdbImg(path, size) { return path ? (TMDB_IMG + (size || 'w300') + path) : ''; }

    function tmdbValidate(key) {
        if (!key) { return Promise.resolve(false); }
        return U.getJSON('https://api.themoviedb.org/3/configuration?api_key=' + encodeURIComponent(key), 8000)
            .then(function () { return true; }, function () { return false; });
    }
    function mdblistValidate(key) {
        if (!key) { return Promise.resolve(false); }
        return U.getJSON('https://api.mdblist.com/user?apikey=' + encodeURIComponent(key), 8000)
            .then(function (r) { return !!(r && !r.error); }, function () { return false; });
    }

    // Cached TMDB GET.
    function tmdbGet(path, extra, cancel) {
        var key = tmdbKey();
        if (!key) { return Promise.reject(new Error('no TMDB key')); }
        return U.cachedJSON(_tmdbCache, 'https://api.themoviedb.org/3' + path + '?api_key=' + encodeURIComponent(key) + (extra || ''), 12000, cancel);
    }

    // imdb id (tt..) -> TMDB id of a 'movie' or 'tv' title (null: not on TMDB, or unreachable).
    function tmdbFind(imdbId, kind, cancel) {
        if (!tmdbKey() || !imdbId) { return Promise.resolve(null); }
        return tmdbGet('/find/' + encodeURIComponent(imdbId), '&external_source=imdb_id', cancel).then(function (r) {
            var list = r && (kind === 'tv' ? r.tv_results : r.movie_results);
            return (list && list[0]) ? list[0].id : null;
        }, function () { return null; });
    }
    function tmdbFindTvId(imdbId, cancel) { return tmdbFind(imdbId, 'tv', cancel); }

    // A title's cast, recommendations and collection (Settings > Integrations > TMDB).
    //   type: 'movie' | 'series'; imdbId: tt...
    // -> { cast: [{id, name, character, photo}], similar: [item], collection: {name, parts: [item]} | null }
    //   item: { tmdbId, kind ('movie'|'tv'), type ('movie'|'series'), name, poster, year }
    function tmdbItem(r, kind) {
        kind = r.media_type || kind;
        var date = r.release_date || r.first_air_date || '';
        return { tmdbId: r.id, kind: kind, type: kind === 'tv' ? 'series' : 'movie',
            name: r.title || r.name || '', poster: tmdbImg(r.poster_path, 'w342'),
            background: tmdbImg(r.backdrop_path, 'w780'), year: date.slice(0, 4), popularity: r.popularity || 0, votes: r.vote_count || 0 };
    }
    function tmdbTitleExtras(type, imdbId, cancel) {
        var kind = type === 'series' ? 'tv' : 'movie';
        return tmdbFind(imdbId, kind, cancel).then(function (id) { return id ? tmdbExtrasById(kind, id, cancel) : null; });
    }
    // The same, for a title known by its TMDB id (kind 'movie' | 'tv'), e.g. from a person's
    // movies and series (the player's Cast & more goes from one to the other).
    function tmdbExtrasById(kind, id, cancel) {
        return tmdbGet('/' + kind + '/' + id, '&append_to_response=credits,recommendations,similar', cancel).then(function (d) {
            var out = {
                cast: ((d.credits && d.credits.cast) || []).slice(0, 20).map(function (c) {
                    return { id: c.id, name: c.name, character: c.character || '', photo: tmdbImg(c.profile_path, 'w185') };
                }),
                similar: (((d.recommendations && d.recommendations.results) || []).length
                    ? d.recommendations.results : ((d.similar && d.similar.results) || []))
                    .filter(function (r) { return r.poster_path; }).slice(0, 20)
                    .map(function (r) { return tmdbItem(r, kind); }),
                collection: null
            };
            // crew worth listing next to the cast: directors / creators
            var lead = ((d.credits && d.credits.crew) || []).filter(function (c) { return c.job === 'Director'; })
                .concat((d.created_by || []).map(function (c) { return { id: c.id, name: c.name, job: 'Creator', profile_path: c.profile_path }; }));
            lead.slice(0, 3).reverse().forEach(function (c) {
                if (!out.cast.some(function (x) { return x.id === c.id; })) {
                    out.cast.unshift({ id: c.id, name: c.name, character: c.job, photo: tmdbImg(c.profile_path, 'w185') });
                }
            });
            var coll = d.belongs_to_collection;
            if (!coll || !coll.id) { return out; }
            return tmdbGet('/collection/' + coll.id).then(function (c) {
                var parts = (c.parts || []).filter(function (p) { return p.poster_path; }).map(function (p) { return tmdbItem(p, 'movie'); });
                parts.sort(function (a, b) { return (a.year || '9999') < (b.year || '9999') ? -1 : 1; });
                if (parts.length > 1) { out.collection = { name: c.name || coll.name, parts: parts }; }
                return out;
            }, function () { return out; });
        });
    }

    // An episode's own cast & more (the player's Cast & more, watching one): its director and
    // writers, its cast, its guest stars, then the show's creators. The show's cast when
    // TMDB has nothing for the episode. imdbId: the show's (tt…).
    // -> [{ id, name, character, photo }] (character: the role, "Director", "… · guest"…)
    var EP_CREW = /^(Writer|Teleplay|Story|Screenplay|Novel)$/;
    function tmdbEpisodeCast(imdbId, season, episode) {
        return tmdbFind(imdbId, 'tv').then(function (id) {
            if (!id) { return []; }
            var show = tmdbExtrasById('tv', id).then(null, function () { return null; });
            return tmdbGet('/tv/' + id + '/season/' + season + '/episode/' + episode + '/credits').then(null, function () { return null; }).then(function (ep) {
                return show.then(function (sh) {
                    var out = [], seen = {};
                    function add(p, role, photo) {
                        if (!p || !p.id || seen[p.id] || out.length >= 60) { return; }
                        seen[p.id] = 1;
                        out.push({ id: p.id, name: p.name || '', character: role || '', photo: photo !== undefined ? photo : tmdbImg(p.profile_path, 'w185') });
                    }
                    var crew = (ep && ep.crew) || [];
                    crew.filter(function (c) { return c.job === 'Director'; }).forEach(function (c) { add(c, 'Director'); });
                    crew.filter(function (c) { return EP_CREW.test(c.job || ''); }).forEach(function (c) { add(c, c.job); });
                    ((ep && ep.cast) || []).forEach(function (c) { add(c, c.character); });
                    ((ep && ep.guest_stars) || []).forEach(function (c) { add(c, (c.character ? c.character + ' · ' : '') + 'guest'); });
                    if (out.length) {
                        ((sh && sh.cast) || []).forEach(function (c) { if (c.character === 'Creator') { add(c, 'Creator', c.photo); } });
                        return out;
                    }
                    return (sh && sh.cast) || [];   // (nothing for the episode: the show's)
                });
            });
        });
    }

    // An episode's trailer on TMDB: its own trailer or teaser, else its season's. YouTube only,
    // official ones first, a trailer before a teaser; never a clip (a scene from the episode),
    // bloopers or behind the scenes. imdbId: the show's (tt…).
    // -> { ytId, season: true when it's the season's } or null (none, no TMDB key, no answer).
    var TRAILER_TYPES = ['Trailer', 'Teaser'];
    function bestTrailer(r) {
        var vids = U.listOf(r && r.results, 100, function (v) {
            return v.site === 'YouTube' && typeof v.key === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.key) && TRAILER_TYPES.indexOf(v.type) !== -1;
        });
        vids.sort(function (a, b) { return ((b.official === true) - (a.official === true)) || (TRAILER_TYPES.indexOf(a.type) - TRAILER_TYPES.indexOf(b.type)); });
        return vids.length ? vids[0].key : null;
    }
    function tmdbEpisodeTrailer(imdbId, season, episode, cancel) {
        return tmdbFind(imdbId, 'tv', cancel).then(function (id) {
            if (!id) { return null; }
            var base = '/tv/' + id + '/season/' + encodeURIComponent(season);
            return tmdbGet(base + '/episode/' + encodeURIComponent(episode) + '/videos', '', cancel).then(bestTrailer, function () { return null; }).then(function (k) {
                if (k) { return { ytId: k, season: false }; }
                return tmdbGet(base + '/videos', '', cancel).then(bestTrailer, function () { return null; })
                    .then(function (k2) { return k2 ? { ytId: k2, season: true } : null; });
            });
        }).then(null, function () { return null; });
    }

    // Where a title streams in your country (TMDB's "where to watch", data from JustWatch):
    // the subscription and free services, as "where to watch" links like a where-to-watch
    // addon's ({ name, title, externalUrl }), besides any such addon's. A series' services
    // are the show's (TMDB doesn't list them per episode). [] without a TMDB key or an answer.
    // The country: the one picked in Settings > Integrations, else the TV's language region
    // (en-US -> US), else US (a language with no region, like "en").
    function autoWatchRegion() {
        var lang = '' + ((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '');
        var m = lang.match(/[-_]([A-Za-z]{2})\b/);
        return m ? m[1].toUpperCase() : 'US';
    }
    function watchRegion() { return getPrefs().watchRegion || autoWatchRegion(); }
    function tmdbWhereToWatch(type, imdbId, cancel) {
        var kind = type === 'series' ? 'tv' : 'movie';
        if (!tmdbKey() || !/^tt\d+$/.test('' + imdbId)) { return Promise.resolve([]); }
        return tmdbFind(imdbId, kind, cancel).then(function (id) {
            if (!id) { return []; }
            return tmdbGet('/' + kind + '/' + id + '/watch/providers', '', cancel).then(function (r) {
                var here = r && r.results && r.results[watchRegion()];
                if (!here) { return []; }
                var out = [], seen = {};
                [['flatrate', 'Subscription'], ['free', 'Free'], ['ads', 'Free with ads']].forEach(function (k) {
                    U.listOf(here[k[0]], 30).forEach(function (p) {
                        if (!p || !p.provider_name || seen[p.provider_name]) { return; }
                        seen[p.provider_name] = true;
                        out.push({ name: '' + p.provider_name, title: k[1], externalUrl: '' + (here.link || 'https://www.themoviedb.org/'),
                            _addon: 'TMDB (JustWatch)', _tmdbWhere: true });
                    });
                });
                return out;
            });
        }).then(null, function () { return []; });
    }

    // A person's page: { name, photo, bio, meta, movies: [item], series: [item] }
    // A person's page: name, photo, bio and their movies and series. TMDB lists their credits
    // in no useful order (movies before series, roughly as they were added), so they're put
    // in order of how many people rated each title on TMDB (what they're known for; TMDB's
    // "popularity" would put talk shows they guested on first). Appearances as themselves
    // (talk shows, documentaries, archive footage) are left out, and so are "Thanks" credits.
    var SELF_ROLE = /^(Himself|Herself|Self|Themselves)\b|archive footage/i;
    var PERSON_MAX = 60;   // per list (movies, series): the most rated
    function byVotes(a, b) { return (b.votes - a.votes) || (b.popularity - a.popularity) || ((b.year || '') > (a.year || '') ? 1 : (b.year || '') < (a.year || '') ? -1 : 0); }
    function tmdbPerson(personId, cancel) {
        return tmdbGet('/person/' + personId, '&append_to_response=combined_credits', cancel).then(function (p) {
            var cc = p.combined_credits || {}, seen = {}, credits = [];
            (cc.cast || []).concat(cc.crew || []).forEach(function (r) {
                var k = r.media_type + ':' + r.id;
                if (seen[k] || !r.poster_path || (r.media_type !== 'movie' && r.media_type !== 'tv')) { return; }
                if (r.character !== undefined && SELF_ROLE.test(r.character || '')) { return; }   // (as themselves)
                if (r.job === 'Thanks') { return; }
                seen[k] = 1;
                credits.push(tmdbItem(r, r.media_type));
            });
            var bits = [];
            if (p.known_for_department) { bits.push(p.known_for_department); }
            if (p.birthday) { bits.push('Born ' + p.birthday.slice(0, 4) + (p.deathday ? ' – ' + p.deathday.slice(0, 4) : '')); }
            if (p.place_of_birth) { bits.push(p.place_of_birth); }
            return { name: p.name || '', photo: tmdbImg(p.profile_path, 'w342'), bio: p.biography || '', meta: bits.join('   ·   '),
                movies: credits.filter(function (c) { return c.kind === 'movie'; }).sort(byVotes).slice(0, PERSON_MAX),
                series: credits.filter(function (c) { return c.kind === 'tv'; }).sort(byVotes).slice(0, PERSON_MAX) };
        });
    }

    // People by name (TMDB's person search), or TMDB's popular people without one; a page
    // (20) at a time. TMDB ranks a search by popularity, which suits people (for their
    // titles it doesn't: see tmdbPerson). -> { people: [{ id, name, photo, dept, knownFor:
    // ["Back to the Future (1985)", …] }], page, pages }
    function tmdbPeople(query, page, cancel) {
        query = ('' + (query || '')).trim();
        page = page || 1;
        var path = query ? '/search/person' : '/person/popular';
        var extra = (query ? '&query=' + encodeURIComponent(query) + '&include_adult=false' : '') + '&page=' + page;
        return tmdbGet(path, extra, cancel).then(function (r) {
            var people = ((r && r.results) || []).filter(function (p) { return p && p.id && p.name && !p.adult; }).map(function (p) {
                return { id: p.id, name: p.name, photo: tmdbImg(p.profile_path, 'w185'), dept: p.known_for_department || '',
                    knownFor: (p.known_for || []).filter(function (k) { return k && (k.title || k.name); }).slice(0, 4).map(function (k) {
                        var y = (k.release_date || k.first_air_date || '').slice(0, 4);
                        return (k.title || k.name) + (y ? ' (' + y + ')' : '');
                    }) };
            });
            return { people: people, page: (r && r.page) || page, pages: (r && r.total_pages) || 1 };
        });
    }

    // ---- Browse (Discover, with a TMDB key): Trending, Popular, and each streaming service in
    // your country, TMDB's, with its genres. ----
    var TMDB_GENRES = {
        movie: [['Action', 28], ['Adventure', 12], ['Animation', 16], ['Comedy', 35], ['Crime', 80], ['Documentary', 99], ['Drama', 18], ['Family', 10751],
            ['Fantasy', 14], ['History', 36], ['Horror', 27], ['Music', 10402], ['Mystery', 9648], ['Romance', 10749], ['Science Fiction', 878], ['Thriller', 53], ['War', 10752], ['Western', 37]],
        tv: [['Action & Adventure', 10759], ['Animation', 16], ['Comedy', 35], ['Crime', 80], ['Documentary', 99], ['Drama', 18], ['Family', 10751], ['Kids', 10762],
            ['Mystery', 9648], ['Reality', 10764], ['Sci-Fi & Fantasy', 10765], ['Soap', 10766], ['Talk', 10767], ['War & Politics', 10768], ['Western', 37]]
    };
    function tmdbGenres(kind) { return (TMDB_GENRES[kind] || []).map(function (g) { return g[0]; }); }
    // The streaming services in your country (the biggest first, PROVIDERS_MAX), kept a week:
    // [{ id, name }]. tmdbProvidersKept: what's kept now (none yet: [] , and they're asked for).
    var PROVIDERS_KEY = 'stremiok.tmdbproviders', PROVIDERS_MAX = 8, PROVIDERS_TTL = 7 * 24 * 3600 * 1000;
    function tmdbProvidersKept(kind) {
        var all = U.store.get(PROVIDERS_KEY, {}) || {}, k = kind + ':' + watchRegion(), x = all[k];
        return (x && Array.isArray(x.list) && Date.now() - (x.at || 0) < PROVIDERS_TTL) ? x.list : null;
    }
    function tmdbProviders(kind, cancel) {
        var kept = tmdbProvidersKept(kind);
        if (kept || !tmdbKey()) { return Promise.resolve(kept || []); }
        var region = watchRegion();
        return tmdbGet('/watch/providers/' + kind, '&watch_region=' + region, cancel).then(function (r) {
            var list = ((r && r.results) || []).filter(function (p) { return p && p.provider_id && p.provider_name; })
                .sort(function (a, b) { return (a.display_priority || 999) - (b.display_priority || 999); })
                .slice(0, PROVIDERS_MAX).map(function (p) { return { id: p.provider_id, name: ('' + p.provider_name).slice(0, 40) }; });
            var all = U.store.get(PROVIDERS_KEY, {}) || {};
            all[kind + ':' + region] = { at: Date.now(), list: list };
            U.store.set(PROVIDERS_KEY, all);
            return list;
        });
    }
    // A page of titles: how = { list: 'trending' | 'popular' | 'provider', provider: id, genre: name }
    // -> { items: [tmdbItem], page, pages }
    function tmdbBrowse(kind, how, page, cancel) {
        page = page || 1;
        var path, extra = '&page=' + page;
        if (how.list === 'trending') { path = '/trending/' + kind + '/week'; }
        else {
            path = '/discover/' + kind;
            extra += '&sort_by=popularity.desc&include_adult=false';
            if (how.list === 'provider') { extra += '&with_watch_providers=' + how.provider + '&watch_region=' + watchRegion() + '&with_watch_monetization_types=flatrate'; }
            var g = (TMDB_GENRES[kind] || []).filter(function (x) { return x[0] === how.genre; })[0];
            if (g) { extra += '&with_genres=' + g[1]; }
        }
        return tmdbGet(path, extra, cancel).then(function (r) {
            var items = ((r && r.results) || []).filter(function (x) { return x && x.id && (x.title || x.name) && !x.adult; }).map(function (x) { return tmdbItem(x, kind); });
            return { items: items, page: (r && r.page) || page, pages: (r && r.total_pages) || 1 };
        });
    }

    // A title's trailers on TMDB (YouTube), in the languages given (two-letter), English and none:
    // its Trailers (its Teasers only when it has none). -> [{ id, name, lang, official, date }]
    var TITLE_TRAILERS_MAX = 8;
    function tmdbTitleTrailers(type, imdbId, langs, cancel) {
        var kind = type === 'series' ? 'tv' : 'movie';
        if (!tmdbKey() || !/^tt\d+$/.test('' + imdbId)) { return Promise.resolve([]); }
        var want = [];
        (langs || []).concat(['en']).forEach(function (l) { if (/^[a-z]{2}$/.test(l) && want.indexOf(l) === -1) { want.push(l); } });
        return tmdbFind(imdbId, kind, cancel).then(function (id) {
            if (!id) { return []; }
            return tmdbGet('/' + kind + '/' + id + '/videos', '&include_video_language=' + want.concat(['null']).join(','), cancel).then(function (r) {
                var vids = ((r && r.results) || []).filter(function (v) { return v && v.site === 'YouTube' && /^[A-Za-z0-9_-]{11}$/.test(v.key || ''); });
                var pick = vids.filter(function (v) { return v.type === 'Trailer'; });
                if (!pick.length) { pick = vids.filter(function (v) { return v.type === 'Teaser'; }); }
                return pick.slice(0, TITLE_TRAILERS_MAX).map(function (v) {
                    return { id: v.key, name: ('' + (v.name || '')).replace(/\s+/g, ' ').trim().slice(0, 100), lang: /^[a-z]{2}$/.test(v.iso_639_1 || '') ? v.iso_639_1 : '',
                        official: v.official !== false, date: ('' + (v.published_at || '')).slice(0, 10) };
                });
            });
        });
    }
    // TMDB title -> IMDb id (what the addons use), cached.
    function tmdbImdbId(kind, tmdbId, cancel) {
        return tmdbGet('/' + kind + '/' + tmdbId + '/external_ids', '', cancel).then(function (r) { return (r && r.imdb_id) || null; });
    }

    // A film known only by a TV guide's program (the Guide's guide-only channels): { title (as
    // shown, Spanish say), orig (its original title), year } -> Promise of { type, id (IMDb), name,
    // poster } when exactly one film has that name (and that year, when known), else null.
    // TMDB with your key (the original title, else the shown one in Spanish), else Cinemeta
    // (original titles only).
    function plainTitle(s) {   // ("El Señor de los Anillos:" -> "elsenordelosanillos")
        var t = ('' + (s || '')).toLowerCase();
        if (t.normalize) { try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {} }
        return t.replace(/[^a-z0-9]+/g, '');
    }
    function findFilm(p, cancel) {
        var year = +p.year || 0;
        function near(y) { return !year || (y && Math.abs(y - year) <= 1); }
        function one(list, names) {
            var want = names.map(plainTitle).filter(Boolean), hits = (list || []).filter(function (r) {
                return near(r.year) && want.some(function (w) { return w === plainTitle(r.name) || w === plainTitle(r.orig); });
            });
            return hits.length === 1 ? hits[0] : null;
        }
        function tmdb(query, spanish) {
            var extra = '&query=' + encodeURIComponent(query) + (year ? '&year=' + year : '') + (spanish ? '&language=es-AR' : '');
            return tmdbGet('/search/movie', extra, cancel).then(function (r) {
                return ((r && r.results) || []).map(function (x) {
                    return { tmdbId: x.id, name: x.title || '', orig: x.original_title || '', year: +('' + (x.release_date || '')).slice(0, 4) || 0, poster: tmdbImg(x.poster_path, 'w342') };
                });
            }, function () { return []; });
        }
        function viaTmdb() {
            if (!tmdbKey()) { return Promise.resolve(null); }
            var first = p.orig ? tmdb(p.orig, false).then(function (l) { return one(l, [p.orig]); }) : Promise.resolve(null);
            return first.then(function (hit) {
                return hit || (p.title ? tmdb(p.title, true).then(function (l) { return one(l, [p.title]); }) : null);
            }).then(function (hit) {
                if (!hit) { return null; }
                return tmdbImdbId('movie', hit.tmdbId, cancel).then(function (imdb) {
                    return imdb ? { type: 'movie', id: imdb, name: hit.name || p.title, poster: hit.poster } : null;
                }, function () { return null; });
            });
        }
        function viaCinemeta() {
            if (!p.orig) { return Promise.resolve(null); }
            return U.getJSON('https://v3-cinemeta.strem.io/catalog/movie/top/search=' + encodeURIComponent(p.orig) + '.json', 10000, null, cancel).then(function (r) {
                var hit = one(((r && r.metas) || []).map(function (m) {
                    return { id: m.id, name: m.name || '', year: parseInt(m.releaseInfo || m.year || '', 10) || 0, poster: m.poster || '' };
                }), [p.orig]);
                return hit && /^tt\d+$/.test(hit.id) ? { type: 'movie', id: hit.id, name: p.title || hit.name, poster: hit.poster } : null;
            }, function () { return null; });
        }
        return viaTmdb().then(function (hit) { return hit || viaCinemeta(); });
    }

    // ---- MDBList ratings (Settings > Integrations > MDBList) ----
    // -> [{ key, label, text }] in a fixed order, only the ones the title has.
    var MDB_SOURCES = [['imdb', 'IMDb'], ['tomatoes', 'Rotten Tomatoes'], ['popcorn', 'Audience'],
        ['metacritic', 'Metacritic'], ['letterboxd', 'Letterboxd'], ['tmdb', 'TMDB']];
    function mdblistRatings(type, imdbId, cancel) {
        var key = getIntegrations().mdblist;
        if (!key || !/^tt\d+$/.test(imdbId || '')) { return Promise.resolve(null); }
        return U.cachedJSON(_mdbCache, 'https://api.mdblist.com/imdb/' + (type === 'series' ? 'show' : 'movie') + '/' +
            encodeURIComponent(imdbId) + '?apikey=' + encodeURIComponent(key), 10000, cancel).then(function (r) {
            var by = {};
            ((r && r.ratings) || []).forEach(function (x) {
                var v = (x && x.value != null) ? x.value : (x && x.score != null ? x.score : null);
                if (x && x.source && v != null && v !== 0 && v !== '') { by[x.source] = v; }
            });
            var out = [];
            MDB_SOURCES.forEach(function (s) {
                var v = by[s[0]];
                if (v == null) { return; }
                var text = (s[0] === 'tomatoes' || s[0] === 'popcorn') ? Math.round(v) + '%'
                    : (s[0] === 'metacritic') ? '' + Math.round(v)
                    : (s[0] === 'letterboxd') ? (Math.round(v * 10) / 10) + '/5'
                    : '' + (Math.round(v * 10) / 10);
                out.push({ key: s[0], label: s[1], text: text });
            });
            return out;
        });
    }

    // One request per season → { episodeNumber: {still, rating, overview, name} }.
    function tmdbSeasonEpisodes(tvId, season, cancel) {
        if (!tmdbKey() || !tvId) { return Promise.resolve(null); }
        return tmdbGet('/tv/' + tvId + '/season/' + season, '', cancel).then(function (r) {
            var map = {};
            ((r && r.episodes) || []).forEach(function (ep) {
                map[ep.episode_number] = { still: tmdbImg(ep.still_path, 'w300'),
                    rating: ep.vote_average, overview: ep.overview, name: ep.name };
            });
            return map;
        }, function () { return null; });
    }

    // ---- OMDb (real IMDb per-episode ratings) ----
    function omdbKey() { return getIntegrations().omdb; }

    function omdbValidate(key) {
        if (!key) { return Promise.resolve(false); }
        return U.getJSON('https://www.omdbapi.com/?apikey=' + encodeURIComponent(key) + '&i=tt0111161', 8000)
            .then(function (r) { return !!(r && r.Response === 'True'); }, function () { return false; });
    }

    // One request per season → { episodeNumber: imdbRatingString }.
    function omdbSeasonRatings(seriesImdb, season, cancel) {
        var key = omdbKey();
        if (!key || !seriesImdb) { return Promise.resolve(null); }
        return U.cachedJSON(_omdbCache, 'https://www.omdbapi.com/?apikey=' + encodeURIComponent(key) +
            '&i=' + encodeURIComponent(seriesImdb) + '&Season=' + encodeURIComponent(season), 12000, cancel)
            .then(function (r) {
                var map = {};
                if (r && r.Episodes) {
                    r.Episodes.forEach(function (ep) {
                        var n = parseInt(ep.Episode, 10);
                        if (!isNaN(n) && ep.imdbRating && ep.imdbRating !== 'N/A') { map[n] = ep.imdbRating; }
                    });
                }
                return map;
            }, function () { return null; });   // not kept: the next look tries again
    }

    // ---- Skip segments (TheIntroDB, then SkipDB, then IntroDB) ----
    // -> { intro, recap, credits, preview } arrays of {start,end} in seconds (null = open), or
    // null when none knows the title. TheIntroDB is asked first; SkipDB (skipdb.tv, open
    // crowdsourced data) and then IntroDB (introdb.app) fill in what it fails or lacks, a kind
    // of segment at a time, so an episode TheIntroDB only has the intro for still gets the
    // credits from one of the others.
    var SEG_KINDS = ['intro', 'recap', 'credits', 'preview'];
    // (times in ms; one that isn't a number counts as missing, a segment with neither is dropped,
    // and so is an empty one, ending where it starts or before: TheIntroDB has intros "ending
    // at 0:00", which would otherwise keep SkipDB's real one out)
    function msToSec(v) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? v / 1000 : null; }
    function segsOf(arr) {
        return U.listOf(arr, 50).map(function (s) {
            return s ? { start: msToSec(s.start_ms), end: msToSec(s.end_ms) } : null;
        }).filter(function (x) { return x && (x.start !== null || x.end !== null) && !(x.end !== null && x.end <= (x.start || 0)); });
    }
    function introIdParts(type, id) {
        var parts = ('' + id).split(':');
        // anime by its MyAnimeList or Kitsu id ("mal:52991:1:3", "kitsu:46474:1", a film
        // "mal:28851"): AniSkip, by the episode's number within that entry (the last part)
        var am = /^(mal|kitsu):(\d+)$/.exec(parts[0] + ':' + (parts[1] || ''));
        if (am) { return { anime: { src: am[1], id: am[2], ep: parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1]) ? +parts[parts.length - 1] : 1 } }; }
        if (!/^tt\d+$/.test(parts[0])) { return null; }
        // (an episode's id says so itself, "tt…:<season>:<episode>", whatever its catalog's type:
        // an anime catalog's "anime.series" too)
        var ep = parts.length >= 3 ? { season: parts[1], episode: parts[2] } : null;
        return { imdb: parts[0], ep: ep };
    }
    // GET https://api.theintrodb.org/v4/media?imdb_id=tt..[&season=&episode=][&duration_ms=]
    // (v4: answers keyed by the show's TheTVDB id, episodes in TheTVDB's default order; the
    // segments as v3 gave them. v2 and v3 stop on 18 Jan 2027.)
    // A skip-times lookup that gave nothing: why, for its line in Diagnostics (the lookups aren't
    // noted on their own). A 404 is the source having nothing for it (TheIntroDB: "no
    // submissions for this media"); anything else, why it didn't answer.
    function segMiss(err) {
        if (/^HTTP 404\b/.test((err && err.message) || '')) { return { _why: 'nothing' }; }
        var p = U.problem(err);
        return { _why: /^no answer/.test(p) ? p : 'no answer (' + p + ')' };   // ("no answer (connection refused…)" once, not twice)
    }
    function segWhy(r, has) { return r && r._why ? r._why : !r ? 'no answer' : has.length ? has.join(', ') : 'nothing'; }
    function theIntroDb(q, durationMs) {
        var url = 'https://api.theintrodb.org/v4/media?imdb_id=' + encodeURIComponent(q.imdb);
        if (q.ep) { url += '&season=' + encodeURIComponent(q.ep.season) + '&episode=' + encodeURIComponent(q.ep.episode); }
        if (durationMs && durationMs > 0) { url += '&duration_ms=' + Math.floor(durationMs); }
        return U.getJSON(url, 10000, 0, null, null, null, true).then(function (r) {
            if (!r) { return null; }
            return { intro: segsOf(r.intro), recap: segsOf(r.recap), credits: segsOf(r.credits), preview: segsOf(r.preview) };
        }, segMiss);
    }
    // GET https://api.skipdb.tv/api/segments?imdb_id=tt..[&season=&episode=][&duration=<sec>]
    // -> { segments: { intro, recap, outro, preview } }, each the best match or null.
    function skipDb(q, durationMs) {
        var url = 'https://api.skipdb.tv/api/segments?imdb_id=' + encodeURIComponent(q.imdb);
        if (q.ep) { url += '&season=' + encodeURIComponent(q.ep.season) + '&episode=' + encodeURIComponent(q.ep.episode); }
        if (durationMs && durationMs > 0) { url += '&duration=' + Math.round(durationMs / 1000); }
        return U.getJSON(url, 10000, 0, null, null, null, true).then(function (r) {
            var sg = r && r.segments;
            if (!sg || typeof sg !== 'object') { return null; }
            function one(x) { return segsOf(x ? [x] : []); }
            return { intro: one(sg.intro), recap: one(sg.recap), credits: one(sg.outro), preview: one(sg.preview) };
        }, segMiss);
    }
    // GET https://api.introdb.app/segments?imdb_id=tt..(&season=&episode= | &is_movie=true)
    // -> { intro, recap, outro, post_credits }, each one segment or null (a scene after the
    // credits isn't something to skip: not used).
    function introDb(q) {
        var url = 'https://api.introdb.app/segments?imdb_id=' + encodeURIComponent(q.imdb) +
            (q.ep ? '&season=' + encodeURIComponent(q.ep.season) + '&episode=' + encodeURIComponent(q.ep.episode) : '&is_movie=true');
        return U.getJSON(url, 10000, 0, null, null, null, true).then(function (r) {
            if (!r || typeof r !== 'object') { return null; }
            function one(x) { return segsOf(x ? [x] : []); }
            return { intro: one(r.intro), recap: one(r.recap), credits: one(r.outro), preview: [] };
        }, segMiss);
    }
    // GET https://api.aniskip.com/v2/skip-times/<MyAnimeList id>/<episode>?types[]=…&episodeLength=<s>
    // -> { found, results: [{ interval: { startTime, endTime }, skipType, episodeLength }] }: the
    // opening ("op", or "mixed-op") as the intro, the ending ("ed" / "mixed-ed") as credits, a
    // recap; of several, the one submitted for a copy closest in length to this one. (AniSkip
    // only takes TLS 1.3: a Tizen 3 TV can't reach it, and gets the IMDb-based sources only.)
    // An anime's other ids, from ARM (arm.haglund.dev: anime ids across sites, kept for the
    // session): { mal, imdb, season } — its MyAnimeList id for AniSkip, its IMDb id and season
    // for TheIntroDB / SkipDB / IntroDB. A MyAnimeList id still goes to AniSkip without it.
    var _animeIds = U.lru(200);
    // hints: the title's own ids, from its details ({ imdb, mal, season }: AIOMetadata gives them),
    // used before ARM, which a Tizen 3 TV can't reach (TLS 1.3 only, like AniSkip).
    function animeIds(a, hints) {
        var h = hints || {}, imdb = /^tt\d+$/.test('' + h.imdb) ? '' + h.imdb : null, mal = /^\d+$/.test('' + h.mal) ? '' + h.mal : (a.src === 'mal' ? a.id : null);
        var season = +h.season > 0 ? +h.season : 0;
        if (imdb && mal) { return Promise.resolve({ mal: mal, imdb: imdb, season: season || 1 }); }
        var key = a.src + ':' + a.id, known = _animeIds.get(key);
        if (known !== undefined) { return Promise.resolve(known); }
        var url = 'https://arm.haglund.dev/api/v2/ids?source=' + (a.src === 'mal' ? 'myanimelist' : 'kitsu') + '&id=' + a.id;
        return U.getJSON(url, 10000, 64 * 1024).then(function (r) {
            var o = r && typeof r === 'object' && !Array.isArray(r) ? r : {};
            var ids = { mal: /^\d+$/.test('' + o.myanimelist) ? '' + o.myanimelist : (a.src === 'mal' ? a.id : null),
                imdb: /^tt\d+$/.test('' + o.imdb) ? '' + o.imdb : null,
                season: +(o['thetvdb-season'] || o['themoviedb-season']) || 1, movie: /movie/i.test('' + o.media) };
            _animeIds.set(key, ids);
            return ids;
        }, function () { return { mal: a.src === 'mal' ? a.id : null, imdb: null, season: 1 }; });   // (not kept: asked again next time)
    }
    function aniSkip(mal, ep, durationMs) {
        return Promise.resolve(mal).then(function (mal) {
            if (!mal) { return null; }
            var len = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
            var url = 'https://api.aniskip.com/v2/skip-times/' + mal + '/' + ep + '?types[]=op&types[]=ed&types[]=recap&types[]=mixed-op&types[]=mixed-ed&episodeLength=' + len;
            return U.getJSON(url, 10000, 0, null, null, null, true).then(function (r) {
                if (!r || typeof r !== 'object') { return null; }
                var list = U.listOf(r.results, 50, function (v) { return v.interval && typeof v.interval.startTime === 'number' && typeof v.interval.endTime === 'number' && v.interval.endTime > v.interval.startTime; });
                function best(types) {
                    var c = list.filter(function (v) { return types.indexOf(v.skipType) !== -1; });
                    if (!c.length) { return []; }
                    c.sort(function (x, y) { return Math.abs((+x.episodeLength || 0) - len) - Math.abs((+y.episodeLength || 0) - len); });
                    return [{ start: Math.max(0, c[0].interval.startTime), end: c[0].interval.endTime }];
                }
                return { intro: best(['op', 'mixed-op']), recap: best(['recap']), credits: best(['ed', 'mixed-ed']), preview: [], from: { intro: 'AniSkip', recap: 'AniSkip', credits: 'AniSkip' } };
            }, segMiss);
        });
    }
    var SEG_SOURCES = [['TheIntroDB', theIntroDb], ['SkipDB', skipDb], ['IntroDB', introDb]];
    // asked (optional): an array told how each source answered, for Diagnostics ("SkipDB:
    // nothing", "IntroDB: credits"); out.from names the source of each kind it has.
    // ids (optional): the title's own ids from its details ({ imdb, mal, season }), for anime.
    function getIntroSegments(type, id, durationMs, asked, ids) {
        var q = introIdParts(type, id);
        if (!q) { return Promise.resolve(null); }
        if (q.anime) { return animeSegments(type, q.anime, durationMs, asked, ids); }
        return segChain(q, durationMs, asked, null);
    }
    // An anime: AniSkip first; what it doesn't give (on a Tizen 3 TV: everything, it can't be
    // reached), from the IMDb-based sources by the show's IMDb id, season and episode.
    function animeSegments(type, a, durationMs, asked, hints) {
        return animeIds(a, hints).then(function (ids) {
            return aniSkip(ids.mal, a.ep, durationMs).then(function (got) {
                var r = got && got._why ? null : got;   // (it gave nothing: why, in its line)
                var has = r ? SEG_KINDS.filter(function (k) { return r[k].length; }) : [];
                if (asked) { asked.push('AniSkip: ' + segWhy(got, has)); }
                var out = has.length ? r : null;
                if (!ids.imdb || has.length === SEG_KINDS.length - 1) { return out; }   // (all AniSkip has: intro, recap, credits)
                var q = { imdb: ids.imdb, ep: (type === 'movie' || ids.movie) ? null : { season: ids.season, episode: a.ep } };
                return segChain(q, durationMs, asked, out, 'as ' + ids.imdb + (q.ep ? ' S' + q.ep.season + 'E' + q.ep.episode : '') + ': ');
            });
        });
    }
    // TheIntroDB, then SkipDB, then IntroDB, each filling what the ones before lack (start: what
    // another source already gave, kept; note: what Diagnostics says before the first answer).
    function segChain(q, durationMs, asked, start, note) {
        var out = start ? { intro: start.intro, recap: start.recap, credits: start.credits, preview: start.preview, from: start.from || {} } : null;
        function from(i) {
            var missing = SEG_KINDS.filter(function (k) { return !(out && out[k] && out[k].length); });
            if (!missing.length || i >= SEG_SOURCES.length) { return Promise.resolve(out); }
            var name = SEG_SOURCES[i][0];
            return SEG_SOURCES[i][1](q, durationMs).then(function (got) {
                var more = got && got._why ? null : got;   // (it gave nothing: why, in its line)
                var has = more ? SEG_KINDS.filter(function (k) { return more[k].length; }) : [];
                if (asked) { asked.push((i === 0 && note ? note : '') + name + ': ' + segWhy(got, has)); }
                // (TheIntroDB knowing the title, even with nothing for it: an answer; from the
                // others, only the segments they have)
                if (more && (i === 0 || has.length)) {
                    out = out || { intro: [], recap: [], credits: [], preview: [], from: {} };
                    missing.forEach(function (k) { if (more[k].length) { out[k] = more[k]; out.from[k] = name; } });
                }
                return from(i + 1);
            });
        }
        return from(0);
    }

    // ---- Search ----
    // Titles for a name (a file on a USB drive): the movie / series search catalogs of the
    // addons you've installed, in your order (Settings › Addons), the first two. [meta] (each
    // with an IMDb id).
    function findTitles(type, query) {
        return getSearchCatalogs().then(function (cats) {
            cats = cats.filter(function (c) { return c.type === type && c.addon && !c.addon.__local && !c.addon.__impl; });
            var seen = {}, out = [];
            return U.settleAll(cats.slice(0, 2).map(function (c) {
                return function () { return getCatalog(c, { search: ('' + query).slice(0, 120) }); };
            }), 2).then(function (rs) {
                rs.forEach(function (r) {
                    if (!r.ok) { return; }
                    r.value.forEach(function (m) {
                        if (!m || !/^tt\d+$/.test(m.id) || seen[m.id]) { return; }
                        seen[m.id] = 1;
                        out.push(m);
                    });
                });
                if (!out.length && rs.length && rs.every(function (r) { return !r.ok; })) { throw (rs[0].error || new Error('search failed')); }
                return out;
            });
        });
    }

    // Catalogs (across addons) that declare support for the "search" extra.
    function getSearchCatalogs() {
        return loadAddons().then(function (addons) {
            var out = [];
            addons.forEach(function (addon) {
                (addon.manifest.catalogs || []).forEach(function (c) {
                    if (!c.type || !c.id) { return; }
                    var searchable = false;
                    if (c.extra && c.extra.length) {
                        searchable = c.extra.some(function (e) { return e && e.name === 'search'; });
                    }
                    if (!searchable && c.extraSupported) {
                        searchable = c.extraSupported.indexOf('search') !== -1;
                    }
                    if (searchable) { out.push({ addon: addon, type: c.type, id: c.id, def: c }); }
                });
            });
            return out;
        });
    }

    // What Search asks, as the Search rows: one source per catalog that can search, named
    // like its Home feed ("Series · Popular · Cinemeta"; a catalog just called "Search"
    // goes by its type and addon), and IPTV's groups as one source per type. Sources are
    // ordered and shown / hidden in Settings > Appearance > Search results.
    function searchSources() {
        return getSearchCatalogs().then(function (cats) {
            var out = [], local = {};
            cats.forEach(function (c) {
                if (c.addon && c.addon.__impl) {   // StremioK's own YouTube and Xtream: "YouTube · Videos"
                    var nm = prettyType(c.type) + '  ·  ' + ((c.def && c.def.name) || c.id);
                    out.push({ key: catalogKey(c), cats: [c], title: nm, name: nm.replace(/  ·  /g, ' · '), pages: true });
                    return;
                }
                if (c.addon && c.addon.__local) {
                    if (!local[c.type]) {
                        local[c.type] = { key: 'iptv-search|' + c.type, cats: [], title: prettyType(c.type),
                            name: prettyType(c.type) + ' · every group  ·  your playlists', pages: false };
                        out.push(local[c.type]);
                    }
                    local[c.type].cats.push(c);
                    return;
                }
                var def = c.def || {}, label = def.name || c.id, addonName = (c.addon.manifest && c.addon.manifest.name) || 'Addon';
                var title = prettyType(c.type) + '  ·  ' + (/^search$/i.test(('' + label).trim()) ? '' : label + '  ·  ') + addonName;
                out.push({ key: catalogKey(c), cats: [c], title: title, name: title.replace(/  ·  /g, ' · '),
                    pages: (def.extra || []).some(function (e) { return e && e.name === 'skip'; }) || (def.extraSupported || []).indexOf('skip') !== -1 });
            });
            return out;
        });
    }
    var searchFeeds = feedList(SEARCH_FEEDS_KEY, searchSources, function (src) { return src.key; });

    // A source that's only a YouTube video id ({ ytId }, Stremio's own YouTube player: e.g.
    // YouTubio's "Stremio Player"): its YouTube page as its link, marked _yt, so it lists and
    // ranks like any source and plays through StremioK's YouTube service (as trailers do).
    // Returns the source (changed in place when it is one).
    var YT_ID = /^[A-Za-z0-9_-]{11}$/;
    function youTubeSource(s) {
        if (s && !s.url && typeof s.ytId === 'string' && YT_ID.test(s.ytId)) {
            s.url = 'https://www.youtube.com/watch?v=' + s.ytId;
            s._yt = true;
            s.ytPage = s.url;
        }
        return s;
    }

    // ---- Streaming server (Settings › Content › Streaming server) ----
    // Stremio's streaming server or a TorrServer on your network. A torrent-only source (infoHash,
    // fileIdx) becomes a link on it (torrentSource), as Stremio's own apps make it; with Stremio's,
    // a source the TV refused can be converted by it (convertUrl: the player asks once).
    // { kind: '' (off) | 'stremio' | 'torrserver', url, convert }
    var SERVER_KEY = 'stremiok.server', SERVER_KINDS = { stremio: 1, torrserver: 1 }, TORRENT_WAITS = [45, 60, 120, 180, 300];
    function server() {
        var x = U.store.get(SERVER_KEY, {}) || {};
        return { kind: SERVER_KINDS[x.kind] ? x.kind : '', url: typeof x.url === 'string' ? x.url : '', convert: x.convert === true,   // (convert: off unless chosen, see convertUrl)
            wait: TORRENT_WAITS.indexOf(x.wait) !== -1 ? x.wait : 120 };   // (seconds a torrent has to start, see the player's startCheck)
    }
    // An address as typed ("192.168.0.10:11470/"): http:// unless given, no trailing slash.
    function serverAddress(v) {
        v = ('' + (v || '')).trim().replace(/\/+$/, '');
        if (v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) { v = 'http://' + v; }
        return v;
    }
    function serverAddressProblem(v) { return U.urlProblem(serverAddress(v)) || null; }
    // Returns null, or what's wrong with the address (nothing changed then). The sources found
    // so far are asked for again (their links change).
    function setServer(cfg) {
        var cur = server(), kind = SERVER_KINDS[cfg.kind] ? cfg.kind : '';
        var url = cfg.url !== undefined ? serverAddress(cfg.url) : cur.url;
        if (kind && U.urlProblem(url)) { return U.urlProblem(url); }
        U.store.set(SERVER_KEY, { kind: kind, url: url, convert: cfg.convert !== undefined ? cfg.convert === true : cur.convert,
            wait: TORRENT_WAITS.indexOf(cfg.wait) !== -1 ? cfg.wait : cur.wait });
        var kept = _loaded; configChanged(); _loaded = kept;
        return null;
    }
    // Does it answer? { ok, text } — Stremio's /settings (its version in it), TorrServer's /echo.
    function testServer() {
        var sv = server();
        if (!sv.kind || !sv.url) { return Promise.resolve({ ok: false, text: 'No server set' }); }
        var p = sv.kind === 'stremio'
            ? U.getJSON(sv.url + '/settings', 8000).then(function (r) {
                if (!r || typeof r !== 'object') { throw new Error('Not a Stremio streaming server'); }
                var v = r.values && r.values.serverVersion;
                return 'Stremio server answers' + (v ? ' (' + ('' + v).slice(0, 20) + ')' : '');
            })
            : U.getText(sv.url + '/echo', 8000).then(function (t) { return 'TorrServer answers (' + ('' + t).trim().slice(0, 30) + ')'; });
        return p.then(function (text) { return { ok: true, text: text }; },
            function (e) { return { ok: false, text: 'The server didn’t answer: ' + U.problem(e) }; });
    }
    // Made again each time it's asked (a page kept from before, just before playing): from the
    // server set now, or no link when there's none.
    var HASH = /^[0-9a-f]{40}$/i;
    function torrentSource(s) {
        var sv = server();
        if (s && s._torrent) { delete s.url; delete s._torrent; delete s._pickFile; }
        if (!s || s.url || !sv.kind || !sv.url || typeof s.infoHash !== 'string' || !HASH.test(s.infoHash)) { return s; }
        var h = s.infoHash.toLowerCase(), idx = /^\d{1,6}$/.test('' + s.fileIdx) ? +s.fileIdx : -1;
        var src = (Array.isArray(s.sources) ? s.sources : []).filter(function (x) { return typeof x === 'string' && /^(tracker|dht):/.test(x); }).slice(0, 20);
        if (sv.kind === 'stremio') {   // (-1: the server takes the torrent's largest file)
            s.url = sv.url + '/' + h + '/' + idx + (src.length ? '?' + src.map(function (x) { return 'tr=' + encodeURIComponent(x); }).join('&') : '');
        } else {   // (TorrServer: files counted from 1, its trackers in a magnet; without a file, torrentFile)
            var tr = src.filter(function (x) { return x.indexOf('tracker:') === 0; }).map(function (x) { return '&tr=' + encodeURIComponent(x.slice(8)); });
            s.url = sv.url + '/stream/play?link=' + encodeURIComponent(tr.length ? 'magnet:?xt=urn:btih:' + h + tr.join('') : h) + (idx >= 0 ? '&index=' + (idx + 1) : '') + '&play';
            if (idx < 0) { s._pickFile = true; }
        }
        s._torrent = true;
        return s;
    }
    // TorrServer, a torrent that doesn't say which of its files (_pickFile): its file list (&stat,
    // once it has the torrent's details), then the episode's file (S01E02, 1x02), a film's largest
    // video. Its link with that file; as it was when the list doesn't come (one file plays anyway);
    // null when the episode isn't in it (another episode isn't played in its place).
    var VIDEO_FILE = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|mpe?g|flv)$/i;
    function torrentFile(st, season, episode, cancel) {
        var sv = server(), m = /[?&]link=([^&]+)/.exec(st.url || '');
        if (sv.kind !== 'torrserver' || !m) { return Promise.resolve(st.url); }
        return U.getJSON(sv.url + '/stream/?link=' + m[1] + '&stat', 60000, undefined, cancel).then(function (r) {
            var files = U.listOf(r && r.file_stats, 5000).filter(function (f) { return f && typeof f.id === 'number' && VIDEO_FILE.test('' + f.path); });
            var pick = null, ep = (season && episode) ? new RegExp('(^|[^0-9a-z])(s0*' + season + '[ ._-]*e0*' + episode + '|0*' + season + 'x0*' + episode + ')([^0-9]|$)', 'i') : null;
            if (ep) {
                pick = files.filter(function (f) { return ep.test(f.path); })[0] || null;
                if (!pick && files.length) { return null; }
            }
            if (!pick) { files.forEach(function (f) { if (!pick || (+f.length || 0) > (+pick.length || 0)) { pick = f; } }); }
            return pick ? st.url.replace(/&play$/, '&index=' + pick.id + '&play') : st.url;
        }, function (e) { U.log('sources', 'The streaming server didn’t list the torrent’s files: ' + U.problem(e)); return st.url; });
    }
    // The server's HLS of a link, for what the TV plays (H.264 / HEVC video; AAC, AC-3, E-AC-3,
    // MP3 audio, 6 channels): the rest it converts. Null when there's no converting to ask for.
    // Off unless chosen: what it sends (fragmented-MP4 HLS, version 7) the 2017 TV's player
    // doesn't open (Stremio's own Tizen app doesn't convert either).
    var CONVERT_VIDEO = ['h264', 'hevc'], CONVERT_AUDIO = ['aac', 'ac3', 'eac3', 'mp3'];
    function convertUrl(url) {
        var sv = server();
        if (sv.kind !== 'stremio' || !sv.convert || !sv.url || !/^https?:\/\//i.test(url || '') || url.indexOf(sv.url + '/hlsv2/') === 0) { return null; }
        var id = '';
        while (id.length < 16) { id += Math.floor(Math.random() * 16).toString(16); }
        return sv.url + '/hlsv2/' + id + '/master.m3u8?mediaURL=' + encodeURIComponent(url) +
            CONVERT_VIDEO.map(function (c) { return '&videoCodecs=' + c; }).join('') +
            CONVERT_AUDIO.map(function (c) { return '&audioCodecs=' + c; }).join('') + '&maxAudioChannels=6';
    }

    // A stream is directly playable on the TV only if it exposes an http(s) URL.
    // Torrent (infoHash) / external-only streams need an engine this app doesn't embed (or a
    // streaming server: torrentSource gives them one).
    function isPlayable(stream) {
        if (typeof LocalMedia !== 'undefined' && LocalMedia.isLocalStream(stream)) { return true; }   // (a file on a USB drive: only one StremioK made)
        return !!(stream && typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url));
    }

    function streamLabel(stream) {
        var t = stream.title || stream.name || stream.description || 'Stream';
        return ('' + t).replace(/\n/g, ' ');
    }

    // Short first-line label (quality / addon tag), e.g. "MediaFusion 2160p".
    function streamName(stream) {
        var t = stream.name || stream.title || stream.description || 'Source';
        return U.drawable(('' + t).split('\n')[0]).trim();   // (without characters the TV can't draw)
    }

    function humanSize(bytes) {
        if (!bytes || bytes <= 0) { return ''; }
        var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, n = bytes;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
    }

    // File size from behaviorHints, or parsed from the title/description text.
    function streamSize(stream) {
        var b = stream.behaviorHints && stream.behaviorHints.videoSize;
        if (b) { return humanSize(b); }
        var txt = ('' + (stream.title || '') + ' ' + (stream.description || ''));
        var m = txt.match(/(\d+(?:[.,]\d+)?)\s?(TB|GB|MB)\b/i);
        return m ? (m[1].replace(',', '.') + ' ' + m[2].toUpperCase()) : '';
    }

    // The descriptive block (size, languages, seeds, etc. as the addon formats it).
    // Kept multi-line so details like MediaFusion's language list survive.
    function streamDescription(stream) {
        var d = '' + (stream.description || stream.title || '');
        if (!stream.name) {
            var parts = d.split('\n');
            if (parts.length > 1) { d = parts.slice(1).join('\n'); }
        }
        return U.drawable(d).trim();
    }

    // ---- What a source is (read from its name, file name and description) ----
    // { res: 2160|1440|1080|720|480|0, codec, bits10, hdr: 'dv-only'|'dv'|'hdr10p'|'hdr'|'',
    //   audio: [...], kind: 'remux'|'bluray'|'web'|'hdtv'|'cam'|'', cache: 1 cached / -1 not
    //   yet (debrid still downloading) / 0 unknown, container, size (bytes) }
    function tok(re) { return new RegExp('(^|[^a-z0-9])(' + re + ')(?=[^a-z0-9]|$)', 'i'); }
    var RX = {
        r2160: tok('2160p|4k|uhd'), r1440: tok('1440p'), r1080: tok('1080p|1080i'), r720: tok('720p'), r480: tok('576p|480p|360p|sd|dvdrip|dvd'),
        dv: tok('dv|dovi|dolby[ ._-]?vision'), hdr10p: /hdr10(\+|plus|p)/i, hdr: tok('hdr10|hdr|hlg'),
        av1: tok('av1'), hevc: tok('hevc|h[ .]?265|x265'), h264: tok('avc|h[ .]?264|x264'), bits10: tok('10[ ._-]?bit|hi10p'),
        atmos: tok('atmos'), truehd: tok('truehd|true[ ._-]hd'), dtshd: tok('dts[ ._-]?hd|dts[ ._-]?x|dts[ ._-]?ma|dts:x'), dts: tok('dts'),
        eac3: /(^|[^a-z0-9])(eac3|e-ac-3|ddp|dd\+|dolby digital plus)/i, ac3: tok('ac3|dd5[ .]?1|dd2[ .]?0|dd'), aac: tok('aac'), opus: tok('opus'), flac: tok('flac'),
        remux: tok('remux'), bluray: tok('blu[ ._-]?ray|bdrip|brrip|bdremux'), web: tok('web[ ._-]?dl|webrip|web'), hdtv: tok('hdtv|pdtv'),
        cam: tok('cam|hdcam|camrip|telesync|hdts|telecine|hdtc'),
        cached: /\[(rd|ad|pm|dl|tb|ed|oc|pr|dr|pp)\+\]|⚡|(^|[^a-z])(instant|cached)([^a-z]|$)/i,
        uncached: /\[(rd|ad|pm|dl|tb|ed|oc|pr|dr|pp) download\]|⏳|not[ ._-]cached|uncached/i
    };
    function sizeBytes(stream) {
        var b = stream.behaviorHints && stream.behaviorHints.videoSize;
        if (b) { return b; }
        var m = ('' + (stream.title || '') + ' ' + (stream.description || '') + ' ' + (stream.name || '')).match(/(\d+(?:[.,]\d+)?)\s?(TB|GB|MB)\b/i);
        if (!m) { return 0; }
        return parseFloat(m[1].replace(',', '.')) * ({ TB: 1099511627776, GB: 1073741824, MB: 1048576 })[m[2].toUpperCase()];
    }
    // The seeders a torrent source states: Torrentio's and MediaFusion's 👤 123, or "Seeders: 123".
    // -1: none stated.
    var SEEDS = /(?:\uD83D\uDC64|\uD83D\uDC65)\s*(\d[\d,.]*)|\bseed(?:er)?s?\s*[:=]\s*(\d[\d,.]*)/i;
    function seedersOf(t) {
        var m = SEEDS.exec(t);
        if (!m) { return -1; }
        var n = parseInt((m[1] || m[2]).replace(/[,.]/g, ''), 10);
        return isFinite(n) ? n : -1;
    }
    function streamInfo(stream) {
        var bh = stream.behaviorHints || {};
        var path = '';
        try { path = decodeURIComponent(('' + (stream.url || '')).split('?')[0]); } catch (e) { path = '' + (stream.url || ''); }
        var t = [stream.name, stream.title, stream.description, bh.filename, path.split('/').pop()].join(' \n ');
        var i = { res: 0, codec: '', bits10: RX.bits10.test(t), hdr: '', audio: [], kind: '', cache: 0, container: '', size: sizeBytes(stream), seeds: seedersOf(t) };
        i.res = RX.r2160.test(t) ? 2160 : RX.r1440.test(t) ? 1440 : RX.r1080.test(t) ? 1080 : RX.r720.test(t) ? 720 : RX.r480.test(t) ? 480 : 0;
        var dv = RX.dv.test(t), hdr = RX.hdr.test(t), hdr10p = RX.hdr10p.test(t);
        i.hdr = dv ? ((hdr || hdr10p) ? 'dv' : 'dv-only') : hdr10p ? 'hdr10p' : hdr ? 'hdr' : '';
        i.codec = RX.av1.test(t) ? 'av1' : RX.hevc.test(t) ? 'hevc' : RX.h264.test(t) ? 'h264' : '';
        if (RX.atmos.test(t)) { i.audio.push('atmos'); }
        if (RX.truehd.test(t)) { i.audio.push('truehd'); }
        if (RX.dtshd.test(t)) { i.audio.push('dtshd'); } else if (RX.dts.test(t)) { i.audio.push('dts'); }
        if (RX.eac3.test(t)) { i.audio.push('eac3'); } else if (RX.ac3.test(t)) { i.audio.push('ac3'); }
        if (RX.aac.test(t)) { i.audio.push('aac'); }
        if (RX.opus.test(t)) { i.audio.push('opus'); }
        if (RX.flac.test(t)) { i.audio.push('flac'); }
        i.kind = RX.cam.test(t) ? 'cam' : RX.remux.test(t) ? 'remux' : RX.bluray.test(t) ? 'bluray' : RX.web.test(t) ? 'web' : RX.hdtv.test(t) ? 'hdtv' : '';
        i.cache = RX.uncached.test(t) ? -1 : RX.cached.test(t) ? 1 : 0;
        var ext = t.match(/\.(mkv|mp4|m4v|avi|webm|ts|m3u8)(?=\s|$)/im);
        i.container = ext ? (ext[1].toLowerCase() === 'm3u8' ? 'hls' : ext[1].toLowerCase() === 'm4v' ? 'mp4' : ext[1].toLowerCase()) : '';
        return i;
    }

    // ---- Formats: what plays on this TV (Settings > Formats) ----
    // Nothing is known up front. Each playback attempt records the formats of the source:
    // its video profile (resolution + codec + bit depth + HDR, e.g. "4K · HEVC · 10-bit ·
    // HDR10"), and each video / HDR / audio format and file type. Anything in a source that
    // plays (for a couple of seconds, not just opens) becomes "working".
    // A start that fails because of the format (not a dead link or the network) is blamed
    // on the video profile, audio and file type not yet known to work; video codecs and
    // HDR alone are never blamed, so a 4K HEVC file that won't play doesn't condemn the
    // 1080p HEVC ones that do. Something becomes "not working" after failing with two
    // different files, at least once as the only suspect. You can set any either way.
    var FORMATS_KEY = 'stremiok.formats';
    var FORMAT_LABELS = {
        'v:h264': ['Video', 'H.264 (AVC)'], 'v:hevc': ['Video', 'HEVC (H.265)'], 'v:av1': ['Video', 'AV1'], 'v:10bit': ['Video', '10-bit color'],
        'h:hdr': ['HDR', 'HDR10 / HLG'], 'h:hdr10p': ['HDR', 'HDR10+'], 'h:dv': ['HDR', 'Dolby Vision (with HDR fallback)'], 'h:dv-only': ['HDR', 'Dolby Vision only'],
        'a:atmos': ['Audio', 'Dolby Atmos'], 'a:truehd': ['Audio', 'Dolby TrueHD'], 'a:dtshd': ['Audio', 'DTS-HD / DTS:X'], 'a:dts': ['Audio', 'DTS'],
        'a:eac3': ['Audio', 'Dolby Digital Plus (EAC3)'], 'a:ac3': ['Audio', 'Dolby Digital (AC3)'], 'a:aac': ['Audio', 'AAC'], 'a:opus': ['Audio', 'Opus'], 'a:flac': ['Audio', 'FLAC'],
        'c:mkv': ['File', 'MKV'], 'c:mp4': ['File', 'MP4'], 'c:avi': ['File', 'AVI'], 'c:webm': ['File', 'WebM'], 'c:ts': ['File', 'MPEG-TS'], 'c:hls': ['File', 'HLS stream']
    };
    var PROFILE_RES = { 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 480: 'SD', 0: 'Unknown resolution' };
    var PROFILE_CODEC = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', '?': 'unknown codec' };
    var PROFILE_HDR = { hdr: 'HDR10', hdr10p: 'HDR10+', dv: 'Dolby Vision + HDR', 'dv-only': 'Dolby Vision only', sdr: 'SDR' };
    // "p:<res>|<codec>|<bits>|<hdr>", or null when neither resolution nor codec is known.
    // HDR is 10-bit even when the name doesn't say so.
    function profileKey(info) {
        if (!info.res && !info.codec) { return null; }
        return 'p:' + (info.res || 0) + '|' + (info.codec || '?') + '|' + ((info.bits10 || info.hdr) ? 10 : 8) + '|' + (info.hdr || 'sdr');
    }
    function formatLabel(key) {
        if (FORMAT_LABELS[key]) { return FORMAT_LABELS[key]; }
        if (key.indexOf('p:') === 0) {
            var p = key.slice(2).split('|');
            return ['Video profile', [PROFILE_RES[p[0]] || p[0] + 'p', PROFILE_CODEC[p[1]] || p[1], p[2] + '-bit', PROFILE_HDR[p[3]] || p[3]].join(' · ')];
        }
        return ['Other', key];
    }
    // What's playing, in short (the player, next to the duration): "4K · HEVC · 10-bit · HDR10 ·
    // Atmos · 5.1 · MKV". info: streamInfo's; actual (optional): what the TV's player reports —
    // { height, codec, audio, channels } — which wins over the name where it says.
    var SHORT_AUDIO = { atmos: 'Atmos', truehd: 'TrueHD', dtshd: 'DTS-HD', dts: 'DTS', eac3: 'DD+', ac3: 'DD', aac: 'AAC', opus: 'Opus', flac: 'FLAC' };
    function formatTags(info, actual) {
        info = info || {}; actual = actual || {};
        var h = +actual.height || 0, res = h ? (h >= 1800 ? 2160 : h >= 1300 ? 1440 : h >= 900 ? 1080 : h >= 650 ? 720 : 480) : info.res;
        var codec = ('' + (actual.codec || '')).toLowerCase(), out = [];
        codec = /hevc|h265|hvc|hev/.test(codec) ? 'hevc' : /av01|av1/.test(codec) ? 'av1' : /avc|h264/.test(codec) ? 'h264' : info.codec;
        if (res) { out.push(PROFILE_RES[res] || res + 'p'); }
        if (codec) { out.push(PROFILE_CODEC[codec] || codec.toUpperCase()); }
        if (info.bits10 || info.hdr) { out.push('10-bit'); }
        if (info.hdr) { out.push({ hdr: 'HDR10', hdr10p: 'HDR10+', dv: 'Dolby Vision', 'dv-only': 'Dolby Vision' }[info.hdr]); }
        var a = ('' + (actual.audio || '')).toLowerCase(), aud = (info.audio || []).slice();
        var heard = /eac3|ec-3|ec3/.test(a) ? 'eac3' : /ac3|ac-3/.test(a) ? 'ac3' : /dts/.test(a) ? 'dts' : /aac|mp4a/.test(a) ? 'aac' : /opus/.test(a) ? 'opus' : /flac/.test(a) ? 'flac' : /truehd|mlp/.test(a) ? 'truehd' : '';
        if (heard && aud.indexOf(heard) === -1) { aud = aud.filter(function (x) { return x === 'atmos'; }).concat([heard]); }
        aud.slice(0, 2).forEach(function (x) { out.push(SHORT_AUDIO[x] || x); });
        var ch = +actual.channels || 0;
        if (ch) { out.push(ch === 6 ? '5.1' : ch === 8 ? '7.1' : ch === 2 ? 'Stereo' : ch === 1 ? 'Mono' : ch + 'ch'); }
        if (info.container && info.container !== 'hls') { out.push(info.container.toUpperCase()); }
        return out.join(' · ');
    }
    function formatKeys(info) {
        var k = [], pk = profileKey(info);
        if (pk) { k.push(pk); }
        if (info.codec) { k.push('v:' + info.codec); }
        if (info.bits10) { k.push('v:10bit'); }
        if (info.hdr) { k.push('h:' + info.hdr); }
        info.audio.forEach(function (a) { k.push('a:' + a); });
        if (info.container) { k.push('c:' + info.container); }
        return k;
    }
    var BLAMED = /^[pac]:/;   // what a failed start can be blamed on (see above)
    // A failure that says nothing about the format: the link, the server or the network.
    var NOT_FORMAT = /CONNECTION|NETWORK|DISCONNECT|INVALID_URI|TIMEOUT|TIMED_OUT|HTTP/i;
    function formatsAll() { return U.store.get(FORMATS_KEY, {}) || {}; }
    function formatStatus(key, all) {
        var f = (all || formatsAll())[key];
        if (!f) { return 'unknown'; }
        if (f.set) { return f.set; }
        if (f.ok > 0) { return 'ok'; }
        return (f.fail >= 2 && f.sole >= 1) ? 'bad' : 'unknown';
    }
    // started: it played. Else it failed to start: err (the player's error) and file
    // (the same file failing again counts once). With automatic "Not working" switched
    // off, failures aren't recorded (what's known stays; what plays still counts).
    function recordFormats(keys, started, err, file) {
        if (!keys || !keys.length) { return; }
        if (!started && (!getPrefs().formatsAuto || (err && NOT_FORMAT.test('' + err)))) { return; }
        var all = formatsAll(), now = Date.now();
        var suspects = started ? [] : keys.filter(function (k) { return BLAMED.test(k) && formatStatus(k, all) !== 'ok'; });
        keys.forEach(function (k) {
            var f = all[k] || (all[k] = { ok: 0, fail: 0, sole: 0 });
            if (started) { f.ok++; f.at = now; return; }
            if (suspects.indexOf(k) === -1) { if (!f.at) { f.at = now; } return; }   // known to work: not blamed
            f.at = now;
            if (file && f.lastFail === file) { return; }
            f.lastFail = file || null;
            f.fail++;
            if (suspects.length === 1) { f.sole = (f.sole || 0) + 1; }             // the only possible cause
        });
        U.store.set(FORMATS_KEY, all);
    }
    function setFormat(key, status) {   // 'ok' | 'bad'
        var all = formatsAll(), f = all[key] || (all[key] = { ok: 0, fail: 0, sole: 0 });
        f.set = status; f.at = f.at || Date.now();
        U.store.set(FORMATS_KEY, all);
    }
    function resetFormats() { U.store.remove(FORMATS_KEY); }   // (allowed resolutions are kept)

    // Allowed resolutions: yours to set (all allowed to begin with). A source at one that
    // isn't goes with the "Not working" ones: bottom of the list, never Play best / Next.
    var RES_KEY = 'stremiok.resblock';
    var RES_CHOICES = [[2160, '4K'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, 'SD'], [0, 'Unknown']];
    function resBucket(res) { return res >= 2160 ? 2160 : res >= 1440 ? 1440 : res >= 1080 ? 1080 : res >= 720 ? 720 : res > 0 ? 480 : 0; }
    function resList() {
        var off = U.store.get(RES_KEY, {}) || {};
        return RES_CHOICES.map(function (r) { return { res: r[0], label: r[1], allowed: !off[r[0]] }; });
    }
    function setResAllowed(res, on) {
        var off = U.store.get(RES_KEY, {}) || {};
        if (on) { delete off[res]; } else { off[res] = true; }
        U.store.set(RES_KEY, off);
    }
    // This source's resolution when it isn't allowed ("4K"), else ''.
    function blockedRes(stream, info) {
        var off = U.store.get(RES_KEY, {}) || {}, b = resBucket((info || streamInfo(stream)).res);
        if (!off[b]) { return ''; }
        for (var i = 0; i < RES_CHOICES.length; i++) { if (RES_CHOICES[i][0] === b) { return RES_CHOICES[i][1]; } }
        return '';
    }
    // Formats of this source marked "not working" (labels), empty when none.
    function badFormats(stream, info) {
        var all = formatsAll();
        return formatKeys(info || streamInfo(stream)).filter(function (k) { return formatStatus(k, all) === 'bad'; })
            .map(function (k) { return formatLabel(k)[1]; });
    }
    function formatList() {
        var all = formatsAll();
        return Object.keys(all).map(function (k) {
            var f = all[k], l = formatLabel(k), p = k.indexOf('p:') === 0 ? k.slice(2).split('|') : null;
            return { key: k, group: l[0], label: l[1], order: p ? -(+p[0] || 0) : 0, ok: f.ok || 0, fail: f.fail || 0, set: f.set || null, status: formatStatus(k, all) };
        });
    }

    return {
        DEFAULT_ADDONS: DEFAULT_ADDONS, prettyType: prettyType,
        addonUrlProblem: function (v) { return U.urlProblem(v); },
        getAddonUrls: getAddonUrls, manifestProblem: function (url) { return _manifestProblem[url] || ''; }, manifestDetail: function (url) { return _manifestDetail[url] || ''; }, addAddon: addAddon, removeAddon: removeAddon, moveAddon: moveAddon, streamNotes: streamNotes, keepSource: keepSource, forgetSource: forgetSource, sourceId: sourceId, hasStreamAddons: hasStreamAddons, thirdPartyNote: thirdPartyNote, refreshAddons: refreshAddons, refreshAddon: refreshAddon,
        getIntegrations: getIntegrations, setIntegration: setIntegration, getPrefs: getPrefs, setPref: setPref, addonLogo: addonLogo,
        getIntroSegments: getIntroSegments,
        tmdbValidate: tmdbValidate, mdblistValidate: mdblistValidate, omdbValidate: omdbValidate,
        tmdbFindTvId: tmdbFindTvId, tmdbSeasonEpisodes: tmdbSeasonEpisodes, tmdbImg: tmdbImg,
        tmdbTitleExtras: tmdbTitleExtras, tmdbExtrasById: tmdbExtrasById, tmdbEpisodeCast: tmdbEpisodeCast, tmdbEpisodeTrailer: tmdbEpisodeTrailer, setHideWords: setHideWords, hideWordHit: hideWordHit, normalizeAddonUrl: normalizeManifestUrl, debridOf: debridOf, addonOrigin: addonOrigin, setAddonOrigin: setAddonOrigin, parseSetupList: parseSetupList, applySetupEntries: applySetupEntries, sizeLimitHit: sizeLimitHit, setSizeLimit: setSizeLimit, gbText: gbText, runtimeMinutes: runtimeMinutes, tmdbPeople: tmdbPeople, tmdbPerson: tmdbPerson, tmdbBrowse: tmdbBrowse, tmdbTitleTrailers: tmdbTitleTrailers, tmdbProviders: tmdbProviders, tmdbProvidersKept: tmdbProvidersKept, tmdbGenres: tmdbGenres, tmdbWhereToWatch: tmdbWhereToWatch, watchRegion: watchRegion, autoWatchRegion: autoWatchRegion, tmdbImdbId: tmdbImdbId, findFilm: findFilm, hasTmdb: function () { return !!tmdbKey(); },
        mdblistRatings: mdblistRatings,
        omdbSeasonRatings: omdbSeasonRatings,
        loadAddons: loadAddons, listCatalogs: listCatalogs, getCatalog: getCatalog,
        catalogsForHome: catalogsForHome, listCatalogsOrdered: listCatalogsOrdered,
        catalogKey: catalogKey, moveFeed: moveFeed, toggleFeed: toggleFeed, isFeedHidden: isFeedHidden,
        getMeta: getMeta, getStreams: getStreams, prefetchStreams: prefetchStreams, dedupeStreams: dedupeStreams,
        getSubtitles: getSubtitles,
        getSearchCatalogs: getSearchCatalogs, findTitles: findTitles,
        addonsChanged: function () { _loaded = null; },   // (StremioK's own YouTube catalogs changed)
        setAllowLocal: function (on) { setPref('allowLocal', !!on); var kept = _loaded; configChanged(); _loaded = kept; },
        getRanking: getRanking, moveRanking: moveRanking, toggleRanking: toggleRanking,
        setPlayedFirst: setPlayedFirst, resetRanking: resetRanking,
        feedSourcesOrdered: function () { return sourceFeeds.ordered(); },
        moveFeedSource: function (key, dir) { return sourceFeeds.move(key, dir).then(sourcesChanged); },
        toggleFeedSource: function (key) { sourceFeeds.toggle(key); sourcesChanged(); },
        isFeedSourceOff: function (key) { return sourceFeeds.isHidden(key); },
        searchSourcesOrdered: function () { return searchFeeds.ordered(); },
        searchSourcesForSearch: function () { return searchFeeds.visible(); },
        moveSearchFeed: function (key, dir) { return searchFeeds.move(key, dir); },
        toggleSearchFeed: function (key) { searchFeeds.toggle(key); },
        isSearchFeedHidden: function (key) { return searchFeeds.isHidden(key); },
        isPlayable: isPlayable, youTubeSource: youTubeSource, torrentSource: torrentSource,
        keptSources: keptSources, torrentFile: torrentFile, server: server, setServer: setServer, testServer: testServer, convertUrl: convertUrl, serverAddressProblem: serverAddressProblem, streamLabel: streamLabel, streamName: streamName,
        streamSize: streamSize, streamDescription: streamDescription,
        streamInfo: streamInfo, formatTags: formatTags, formatKeys: formatKeys, recordFormats: recordFormats, setFormat: setFormat,
        resetFormats: resetFormats, badFormats: badFormats, formatList: formatList,
        resList: resList, setResAllowed: setResAllowed, blockedRes: blockedRes,
        importSetupList: importSetupList, savedManifest: savedManifest, isAddonOff: isAddonOff, setAddonOff: setAddonOff, onIptvReady: onIptvReady, streamListenerCount: function (type, id) { var e = _streamCache[type + ':' + id]; return e ? e.listeners.length : 0; },
        iptvGetPlaylists: iptvGetPlaylists, iptvAddPlaylist: iptvAddPlaylist,
        iptvUpdatePlaylist: iptvUpdatePlaylist, iptvRemovePlaylist: iptvRemovePlaylist,
        iptvRenamePlaylist: iptvRenamePlaylist, iptvSetPlaylistGuide: iptvSetPlaylistGuide, iptvAddXtream: iptvAddXtream, iptvAddStalker: iptvAddStalker, iptvSetXtreamFormat: iptvSetXtreamFormat, iptvRefreshEvery: iptvRefreshEvery, iptvSetRefreshEvery: iptvSetRefreshEvery, iptvReadAt: iptvReadAt, iptvSetPlaylistOff: iptvSetPlaylistOff, iptvMovePlaylist: iptvMovePlaylist, iptvLabel: iptvLabel,
        iptvLoad: iptvLoad, iptvStatus: iptvStatus, iptvReload: iptvReload
    };
})();
