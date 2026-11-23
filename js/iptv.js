/* IPTV / M3U support. Global namespace: IPTV
   Parses user-supplied M3U playlists into Stremio-shaped `tv` / `radio` catalogs, so the
   rest of the app (home rows, search, detail, player) treats live channels exactly
   like any other addon's content. Exposed to Stremio as a local synthetic addon
   (see synthAddon()); Stremio.loadAddons / getCatalog / getMeta / getStreams route
   `iptv:` ids here instead of over HTTP.

   Direct HTTP(S) streams play through AVPlay. YouTube channels are tagged `_yt` and
   handed to YTPlay's native-HLS resolver at playback time. */
var IPTV = (function () {
    'use strict';

    var PLAYLISTS_KEY = 'stremiok.iptv.playlists';
    var CACHE_PREFIX = 'stremiok.iptv.cache.';       // one key per playlist id
    var _cache = null;   // merged { ts, channels, groups, byId, byGroup, catalogs }
    // A playlist is downloaded up to playlistMax() and kept to maxChannels() channels: bigger
    // ones would exhaust an older TV's memory (both show in Settings > IPTV when they apply).
    // Settings › Content › IPTV › Largest playlist: 20 MB (30,000 channels) unless raised, the
    // channels in step (1,500 per MB), the download given longer (15 s per 20 MB).
    var SIZE_KEY = 'stremiok.iptv.size', SIZES = [20, 40, 60, 100], CHANNELS_PER_MB = 1500;
    function sizeMb() { var n = +U.store.get(SIZE_KEY, 20); return SIZES.indexOf(n) !== -1 ? n : 20; }
    function setSizeMb(n) { n = +n; if (SIZES.indexOf(n) === -1 || n === 20) { U.store.remove(SIZE_KEY); } else { U.store.set(SIZE_KEY, n); } }
    function playlistMax() { return sizeMb() * 1024 * 1024; }
    function maxChannels() { return sizeMb() * CHANNELS_PER_MB; }
    var _status = {};    // playlist id -> { url, count, groups, error, uncached, title, fetchedAt, stale }
    var NAME_MAX = 60, GROUPS_MAX = 3000;

    function cleanUrl(u) { return ('' + (u || '')).trim(); }

    function getPlaylists() {
        var saved = U.store.get(PLAYLISTS_KEY, []) || [];
        if (!Array.isArray(saved)) { saved = []; }
        return saved.filter(function (p) { return p && p.id && cleanUrl(p.url); })
            .map(function (p) {
                var o = { id: '' + p.id, url: cleanUrl(p.url) };
                if (typeof p.name === 'string' && p.name.trim()) { o.name = p.name.trim().slice(0, NAME_MAX); }
                if (p.off === true) { o.off = true; }
                if (typeof p.guide === 'string' && U.parseUrl(p.guide)) { o.guide = p.guide; }   // (its TV guide, yours: see EPG.guideUrl)
                if (macOf(p.mac)) { o.mac = macOf(p.mac); }   // (a Stalker portal: see addStalker)
                if (Array.isArray(p.genres)) {   // (only those groups read: see setPlaylistGroups)
                    var gs = p.genres.map(String).filter(function (g) { return /^[\w.-]{1,40}$/.test(g); }).slice(0, GROUPS_MAX);
                    if (gs.length) { o.genres = gs; }
                }
                if (p.noVod === true) { o.noVod = true; }   // (an Xtream account's Live TV only: see setLiveOnly)
                if (typeof p.cuTz === 'number' && p.cuTz >= -720 && p.cuTz <= 840) { o.cuTz = Math.round(p.cuTz); }   // (its catch-up time: see setCatchupTz)
                return o;
            });
    }

    // keepChannels: only a name changed (the channels read stay as they are).
    function savePlaylists(list, keepChannels) {
        U.store.set(PLAYLISTS_KEY, list);
        _sources = null;
        if (!keepChannels) { reset(); }
    }
    function find(list, id) {
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return i; } }
        return -1;
    }

    // What a playlist is called: its name (its file's when added, or yours), else the one in
    // the playlist (#PLAYLIST: / playlist-name="…"), else its server's address.
    function label(p) {
        if (!p) { return ''; }
        if (p.name) { return p.name; }
        var st = _status[p.id];
        if (st && st.title) { return st.title; }
        var u = U.parseUrl(p.url);
        return u ? u.host : U.t('Playlist');
    }
    function labelOf(id) { var list = getPlaylists(), i = find(list, id); return i === -1 ? '' : label(list[i]); }
    // Your name for it ('' puts back the playlist's own / its server's).
    function renamePlaylist(id, name) {
        var list = getPlaylists(), i = find(list, id);
        if (i === -1) { return false; }
        name = ('' + (name || '')).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
        if (name) { list[i].name = name; } else { delete list[i].name; }
        savePlaylists(list, true);
        return true;
    }
    // Its TV guide: a link of yours (an XMLTV file), or '' for the one it names / an Xtream
    // playlist's own (EPG.guideUrl). false: not a link.
    function setPlaylistGuide(id, url) {
        var list = getPlaylists(), i = find(list, id);
        url = ('' + (url || '')).trim();
        if (i === -1 || (url && !checkedUrl(url))) { return false; }
        if (url) { list[i].guide = checkedUrl(url); } else { delete list[i].guide; }
        savePlaylists(list, true);
        if (typeof EPG !== 'undefined' && EPG.reset) { EPG.reset(); }
        return true;
    }
    // Off: kept (with its saved copy), but its channels aren't read or shown.
    function setPlaylistOff(id, off) {
        var list = getPlaylists(), i = find(list, id);
        if (i === -1) { return false; }
        if (off) { list[i].off = true; } else { delete list[i].off; }
        savePlaylists(list);
        return true;
    }
    // Up (-1) or down (1): a channel in two playlists comes from the first, and rows are
    // in playlist order.
    function movePlaylist(id, dir) {
        var list = getPlaylists();
        if (!U.moveIn(list, find(list, id), dir)) { return false; }   // (one place, or to the top / bottom)
        savePlaylists(list);
        return true;
    }

    function newId() {
        return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
    }

    // A playlist URL as typed / imported: U.parseUrl's (http(s), no user:password@), else ''.
    // (Saved playlists aren't re-checked: getPlaylists only trims them.)
    function checkedUrl(u) { var p = U.parseUrl(u); return p ? p.href : ''; }
    // A playlist's file name without its extension ("…/sports.m3u8?token=…": "sports"), or ''
    // (a link without one, like an Xtream get.php: named as before, see label).
    function fileName(url) {
        var m = ('' + url).replace(/[?#].*$/, '').match(/\/([^\/]+)\.m3u8?$/i);
        if (!m) { return ''; }
        var n = m[1];
        try { n = decodeURIComponent(n); } catch (e) {}
        return n.replace(/\s+/g, ' ').trim();
    }
    // A name no other playlist goes by, capitals or not: "(2)", "(3)"… after it when one does.
    function freeName(base, list) {
        var taken = {};
        list.forEach(function (p) { taken[label(p).toLowerCase()] = 1; });
        base = base.slice(0, NAME_MAX);
        if (!taken[base.toLowerCase()]) { return base; }
        for (var n = 2; ; n++) {
            var tail = ' (' + n + ')', name = base.slice(0, NAME_MAX - tail.length).replace(/\s+$/, '') + tail;
            if (!taken[name.toLowerCase()]) { return name; }
        }
    }
    // Added (by hand or with a configuration file): named after its file, when it has one.
    function addPlaylist(url) {
        url = checkedUrl(url);
        if (!url) { return false; }
        var list = getPlaylists();
        for (var i = 0; i < list.length; i++) { if (list[i].url === url) { return list[i].id; } }
        var id = newId(), o = { id: id, url: url }, fn = fileName(url);
        if (fn) { o.name = freeName(fn, list); }
        list.push(o);
        savePlaylists(list);
        return id;
    }

    // ---- An Xtream account: its server, username and password ----
    // The server as typed ("tv.example.net:8080": http:// when it has no scheme; a page or a
    // .php after it left out), or a whole Xtream link pasted there (its username and password
    // too): { base, user, pass } or null.
    function xtreamParts(server) {
        var s = ('' + (server || '')).trim();
        if (!s) { return null; }
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { s = 'http://' + s.replace(/^\/+/, ''); }
        var u = U.parseUrl(s);
        if (!u) { return null; }
        function param(name) { var m = new RegExp('(?:^|&)' + name + '=([^&#]*)').exec(u.query || ''); try { return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; } catch (e) { return ''; } }
        var path = (u.path || '/').replace(/\/[^\/]*\.php$/i, '').replace(/\/+$/, '');
        return { base: u.scheme + '://' + u.host + (u.port ? ':' + u.port : '') + path, user: param('username'), pass: param('password') };
    }
    // Its channels as MPEG-TS (output=ts): servers' own HLS tends to stall a few minutes in;
    // Format (setXtreamFormat) switches an account to HLS (output=m3u8) and back.
    function xtreamUrl(base, user, pass) {
        return base + '/get.php?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass) + '&type=m3u_plus&output=ts';
    }
    function isXtream(url) { var u = U.parseUrl(url); return !!(u && /\/get\.php$/i.test(u.path) && /(?:^|&)username=/.test(u.query) && /(?:^|&)password=/.test(u.query)); }
    // An Xtream account's format: 'ts' or 'hls' ('' for a playlist that isn't one).
    function xtreamFormat(id) {
        var list = getPlaylists(), i = find(list, id);
        if (i === -1 || !isXtream(list[i].url)) { return ''; }
        return /(?:[?&])output=(m3u8|hls)(?:&|$)/i.test(list[i].url) ? 'hls' : 'ts';
    }
    function setXtreamFormat(id, fmt) {
        var list = getPlaylists(), i = find(list, id);
        if (i === -1 || !isXtream(list[i].url)) { return false; }
        var out = fmt === 'hls' ? 'm3u8' : 'ts', u = list[i].url;
        u = /([?&])output=[^&#]*/i.test(u) ? u.replace(/([?&])output=[^&#]*/i, '$1output=' + out) : u + '&output=' + out;
        return updatePlaylist(id, u);
    }
    // Checked with the server (player_api.php): resolves 'ok', 'refused' (a wrong login, an
    // account expired or banned: { refused, status }) or 'unreachable'.
    function xtreamCheck(base, user, pass) {
        return U.getJSON(base + '/player_api.php?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass), 15000, 1048576).then(function (j) {
            var ui = j && j.user_info;
            return (ui && +ui.auth === 1 && !/^(expired|banned|disabled)$/i.test('' + (ui.status || ''))) ? { ok: true } : { refused: true, status: ui && ui.status ? '' + ui.status : '' };
        }, function () { return { unreachable: true }; });
    }
    // Added as its get.php link, named after its server ("Xtream · tv.example.net"). Its id.
    function addXtream(base, user, pass) {
        var id = addPlaylist(xtreamUrl(base, user, pass));
        var u = U.parseUrl(base);
        if (id && u) {
            var list = getPlaylists(), i = find(list, id);
            if (i !== -1 && !list[i].name) { list[i].name = freeName('Xtream · ' + u.host, list.filter(function (p) { return p.id !== id; })); savePlaylists(list, true); }
        }
        return id;
    }

    // ---- A Stalker portal: its address and the MAC address your provider registered ----
    // Read by StremioK's service, which asks as a MAG box does (YTPlay.stalkerList): its channels
    // come as an M3U playlist, and a channel's link is asked for each time it plays (streams). Saved
    // as a playlist with its MAC ({ url: the portal, mac }).
    var STB_UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
    // A MAC address as typed (00:1A:79:12:34:56, with dashes, or none): 00:1A:79:12:34:56, or ''.
    function macOf(v) {
        var h = ('' + (v || '')).trim().toUpperCase().replace(/[:\-.\s]/g, '');
        return /^[0-9A-F]{12}$/.test(h) ? h.match(/../g).join(':') : '';
    }
    // The portal as typed (http:// when it has no scheme): its address, or ''.
    function stalkerPortal(v) {
        var s = ('' + (v || '')).trim();
        if (s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { s = 'http://' + s.replace(/^\/+/, ''); }
        return checkedUrl(s);
    }
    function isStalker(p) { return !!(p && p.mac); }
    // Settings › Content › IPTV › Stalker channels: a portal read past its first 100 pages, up to
    // 30,000 channels (adding one is still checked by those pages: stalkerCheck).
    var STALKER_ALL_KEY = 'stremiok.iptv.stalkerall';
    function stalkerAll() { return U.store.get(STALKER_ALL_KEY, false) === true; }
    function setStalkerAll(on) { U.store.set(STALKER_ALL_KEY, !!on); }
    // A portal's Channel groups: its genres (the service's { genres: [{ id, title }] } or { why }),
    // and the ones to read (none: as Stalker channels says). Read again by whoever sets them.
    function stalkerGroups(id) {
        var list = getPlaylists(), i = find(list, id);
        if (i < 0 || typeof YTPlay === 'undefined' || !YTPlay.stalkerGenres) { return Promise.reject(new Error(U.t('Stalker portals are read by StremioK’s service (not in a desktop browser)'))); }
        return YTPlay.stalkerGenres(list[i].url, list[i].mac).then(function (r) {
            if (!r || !Array.isArray(r.genres)) { throw new Error(U.t('Couldn’t read the portal: {why}', { why: (r && r.why) || U.t('no answer') })); }
            return r.genres;
        });
    }
    function setStalkerGroups(id, ids) {   // (any playlist's, since 2.4.5: see setPlaylistGroups)
        var list = getPlaylists(), i = find(list, id);
        if (i < 0) { return false; }
        if (ids && ids.length) { list[i].genres = ids.map(String).slice(0, GROUPS_MAX); } else { delete list[i].genres; }
        savePlaylists(list);
        return true;
    }

    // ---- Playlists read by StremioK's service (2.4.5, after ediziks' fork: #29) ----
    // An M3U playlist's link or an Xtream account's live channels (from its player_api.php) read by
    // the service, up to 250 MB, and kept there; the TV gets only the Channel groups picked, as an
    // M3U it reads as before (the same channels: see service/index.js, iptvControl). Not in a
    // desktop browser, nor for a Stalker portal (read by the service its own way); if the service
    // can't, the TV reads it itself as before. A group's key: an M3U's, its name's hash; an Xtream
    // account's, its category's number.
    function serviceSrc(p) {
        if (!p || isStalker(p) || typeof YTPlay === 'undefined' || !YTPlay.iptvRead || (YTPlay.installMode && YTPlay.installMode() === 'browser')) { return null; }
        if (isXtream(p.url)) {
            var x = xtreamParts(p.url);
            return x && x.user && x.pass ? { base: x.base, user: x.user, pass: x.pass, fmt: xtreamFormat(p.id) === 'hls' ? 'hls' : 'ts' } : null;
        }
        return /^https?:\/\//i.test(p.url) ? { u: p.url } : null;
    }
    function canGroup(p) { return !!p && (isStalker(p) || !!serviceSrc(p)); }
    // Its groups: [{ id, title, n }] (n: its channels; a Stalker portal's: unknown), read now.
    function playlistGroups(id) {
        var list = getPlaylists(), i = find(list, id), p = i < 0 ? null : list[i];
        if (p && isStalker(p)) { return stalkerGroups(id); }
        var src = serviceSrc(p);
        if (!src) { return Promise.reject(new Error(U.t('Channel groups are read by StremioK’s service (not in a desktop browser)'))); }
        return YTPlay.iptvRead(src, false, true).then(function (r) {
            if (!r || r.state !== 'ready' || !Array.isArray(r.groups)) { throw new Error(U.t('Couldn’t read the playlist’s groups: {why}', { why: (r && r.error) || U.t('no answer') })); }
            return r.groups.map(function (g) { return { id: g.k, title: ('' + (g.name || '')).trim() || U.t('Without a group'), n: +g.n || 0 }; });
        });
    }
    // An Xtream account's Live TV only: its Movies and Series left out (js/xtvod.js), and its
    // get.php's film and episode lines.
    function liveOnly(id) { var list = getPlaylists(), i = find(list, id); return i !== -1 && !!list[i].noVod; }
    function setLiveOnly(id, on) {
        var list = getPlaylists(), i = find(list, id);
        if (i < 0 || !isXtream(list[i].url)) { return false; }
        if (on) { list[i].noVod = true; } else { delete list[i].noVod; }
        savePlaylists(list);
        return true;
    }
    // The service's copies of a playlist (its login in them): deleted when it goes or its link changes.
    function forgetSaved(p) {
        var src = serviceSrc(p);
        if (src && YTPlay.iptvForget) { YTPlay.iptvForget(src); }
    }
    // Checked through the service (its channels read): { ok, count }, { refused, why },
    // { unreachable, why } or { noService } (a desktop browser).
    function stalkerCheck(portal, mac) {
        if (typeof YTPlay === 'undefined' || !YTPlay.stalkerList) { return Promise.resolve({ noService: true }); }
        return YTPlay.stalkerList(portal, mac).then(function (r) {
            if (r && typeof r.m3u === 'string') { return { ok: true, count: r.count || 0, cut: r.cut || null }; }
            return r && r.refused ? { refused: true, why: '' + (r.why || '') } : { unreachable: true, why: '' + ((r && r.why) || '') };
        }, function (e) { return /no service/.test((e && e.message) || '') ? { noService: true } : { unreachable: true, why: U.problem(e) }; });
    }
    // Added (named after its server: "Stalker · portal.example.com"), or the one already there with
    // that portal and MAC. Its id.
    function addStalker(portal, mac) {
        portal = stalkerPortal(portal); mac = macOf(mac);
        if (!portal || !mac) { return false; }
        var list = getPlaylists();
        for (var i = 0; i < list.length; i++) { if (list[i].url === portal && list[i].mac === mac) { return list[i].id; } }
        var id = newId(), u = U.parseUrl(portal);
        list.push({ id: id, url: portal, mac: mac, name: freeName('Stalker · ' + (u ? u.host : 'portal'), list) });
        savePlaylists(list);
        return id;
    }

    function updatePlaylist(id, url) {
        url = checkedUrl(url);
        if (!url) { return false; }
        var list = getPlaylists(), changed = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id !== id) { continue; }
            changed = list[i].url !== url;
            if (changed) {
                forgetSaved(list[i]);
                // Another Xtream server or account: its categories (by number) aren't this one's
                var a = isXtream(list[i].url) ? xtreamParts(list[i].url) : null, b = isXtream(url) ? xtreamParts(url) : null;
                if (a && (!b || a.base !== b.base || a.user !== b.user)) { delete list[i].genres; }
            }
            list[i].url = url;
            break;
        }
        if (!changed) { return false; }
        U.bigStore.remove(CACHE_PREFIX + id);
        savePlaylists(list);
        return true;
    }

    function removePlaylist(id) {
        var all = getPlaylists(), list = all.filter(function (p) { return p.id !== id; });
        all.forEach(function (p) { if (p.id === id) { forgetSaved(p); } });
        U.bigStore.remove(CACHE_PREFIX + id);
        delete _status[id];
        savePlaylists(list);
    }

    function isEnabled() { return getPlaylists().some(function (p) { return !p.off; }); }
    // The playlists' revision: changed (added, edited, removed, switched off, moved, reloaded),
    // a load still under way for the old ones keeps nothing, and they're read as they are now.
    var _rev = 0, _pending = null, _ytEnds = {};   // (_ytEnds: Xtream link -> where it led, linkEnd)
    function reset() { _cache = null; _rev++; _ytEnds = {}; }

    // Playlist text is cached per playlist (one key each), in the big store (IndexedDB:
    // far more room than localStorage, which keeps settings and progress). A playlist that
    // can't be saved is flagged in its status (uncached) instead of failing silently.
    // Both are promises.
    function readPersist(id) {
        return U.bigStore.get(CACHE_PREFIX + id);
    }
    // Returns false when the text didn't fit in storage (it re-downloads next launch).
    function writePersist(id, url, text, at) {
        return U.bigStore.set(CACHE_PREFIX + id, { url: url, text: text, at: at });
    }

    function slug(s) {
        var v = ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return v.slice(0, 40) || 'x';
    }
    // A short hash of the exact text (FNV-1a, base 36). Added to the readable slug so ids
    // stay unique and stable: "News HD" / "News-HD", "news" / "News", names alike in their
    // first 40 characters, and names in other scripts (all slug to "x") no longer share one.
    function hash(s) {
        var h = 0x811c9dc5, t = '' + s;
        for (var i = 0; i < t.length; i++) {
            h ^= t.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(36);
    }
    function idOf(s, exact) { return slug(s) + '-' + hash(exact === undefined ? s : exact); }

    function attr(line, re) { var m = line.match(re); return m ? m[1] : ''; }
    // A header a playlist gives a channel, by name: its User-Agent, Referer or Cookie (the ones the
    // TV's player takes: any other is left out). Checked when played (U.sanitizeHeaders).
    function headerInto(c, name, value) {
        var n = ('' + name).trim().toLowerCase(), v = ('' + (value || '')).trim();
        if (!v) { return; }
        if (n === 'user-agent') { c.ua = v; } else if (n === 'referer' || n === 'referrer') { c.ref = v; } else if (n === 'cookie') { c.cookie = v; }
    }

    // A channel's DRM, from Kodi's #KODIPROP:inputstream.adaptive.<key>=<value> lines: { sys:
    // 'widevine' | 'playready' | 'clearkey' | 'other', url: its license server, h: { name: value }
    // for the license request, b64: its answer comes in base64, bad: a request or answer template
    // StremioK can't follow, keys: ClearKey's { kid: key } (hex) when the playlist gives them }.
    // Widevine or PlayReady with a license server: the TV's player (drmPlayable); ClearKey with keys
    // or a key server: Shaka Player (drmShaka, see the player's startShaka). stream_headers /
    // manifest_headers: the stream's own User-Agent and Referer.
    function drmSys(v) { v = ('' + v).toLowerCase(); return /widevine/.test(v) ? 'widevine' : /playready/.test(v) ? 'playready' : /clearkey/.test(v) ? 'clearkey' : 'other'; }
    function headersOf(text) {   // "Name=value&Name2=value2" (values may be %-encoded) -> { Name: value }
        var out = {}, n = 0;
        ('' + (text || '')).split('&').forEach(function (kv) {
            var eq = kv.indexOf('='), k = eq > 0 ? kv.slice(0, eq).trim() : '', v = eq > 0 ? kv.slice(eq + 1) : '';
            try { v = decodeURIComponent(v); } catch (e) {}
            if (/^[A-Za-z0-9-]{1,40}$/.test(k) && v && v.length <= 1000 && !/[\r\n]/.test(v) && n < 16) { out[k] = v; n++; }
        });
        return out;
    }
    function hexOf(v) {   // a key id or key: hex (32 digits), or base64url (a JWK's)
        v = ('' + (v || '')).trim();
        if (/^[0-9a-f]{32}$/i.test(v)) { return v.toLowerCase(); }
        if (!/^[A-Za-z0-9_-]{21,24}={0,2}$/.test(v)) { return ''; }
        try {
            var bin = atob(v.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '') + '=='.slice(0, (4 - v.replace(/=+$/, '').length % 4) % 4)), out = '';
            for (var i = 0; i < bin.length; i++) { out += (bin.charCodeAt(i) < 16 ? '0' : '') + bin.charCodeAt(i).toString(16); }
            return out.length === 32 ? out : '';
        } catch (e) { return ''; }
    }
    // ClearKey's keys as a playlist gives them: kid:key[,kid:key], { "kid": "key" }, or a JWK set
    // { "keys": [{ "kid", "k" }] } -> { kid: key } in hex, or null.
    function keysOf(text) {
        var out = {}, n = 0, j = null;
        function put(kid, key) { kid = hexOf(kid); key = hexOf(key); if (kid && key && n < 32) { out[kid] = key; n++; } }
        text = ('' + (text || '')).trim();
        if (text.charAt(0) === '{') {
            try { j = JSON.parse(text); } catch (e) { j = null; }
            if (j && Array.isArray(j.keys)) { j.keys.forEach(function (k) { if (k) { put(k.kid, k.k); } }); }
            else if (j && typeof j === 'object') { Object.keys(j).forEach(function (k) { put(k, j[k]); }); }
        } else {
            text.split(',').forEach(function (pair) { var p = pair.split(':'); if (p.length === 2) { put(p[0], p[1]); } });
        }
        return n ? out : null;
    }
    function drmServer(d, url, headers) {
        if (/^https?:\/\/[^\s|]+$/i.test(url || '') && url.length <= 2000) { d.url = url; }
        else if (url) { d.inline = true; d.keys = keysOf(url); }   // (ClearKey's kid:key, or keys as JSON)
        if (headers) { d.h = headersOf(headers); }
    }
    function drmInto(c, key, v) {
        if (key === 'stream_headers' || key === 'manifest_headers') { var sh = headersOf(v); Object.keys(sh).forEach(function (k) { headerInto(c, k, sh[k]); }); return; }
        var d = c.drm || (c.drm = { sys: '' });
        if (key === 'license_type') { d.sys = drmSys(v); return; }
        if (key === 'license_key') {   // URL|headers|request template|answer template
            var p = v.split('|');
            drmServer(d, p[0], p[1]);
            if (p[2] && p[2] !== 'R{SSM}') { d.bad = true; }
            if (p[3] === 'B') { d.b64 = true; } else if (p[3]) { d.bad = true; }
            return;
        }
        if (key === 'drm_legacy') { var q = v.split('|'); d.sys = drmSys(q[0]); drmServer(d, q[1], q[2]); return; }
        if (key === 'drm') {   // {"com.widevine.alpha": {"license": {"server_url": …, "req_headers": "Name=value&…"}}}
            var j = null;
            try { j = JSON.parse(v); } catch (e) { j = null; }
            var sys = j && typeof j === 'object' ? Object.keys(j)[0] : '', lic = sys && j[sys] && j[sys].license;
            d.sys = sys ? drmSys(sys) : 'other';
            if (lic && typeof lic === 'object') { drmServer(d, typeof lic.server_url === 'string' ? lic.server_url : '', typeof lic.req_headers === 'string' ? lic.req_headers : ''); }
            if (lic && (lic.keyids || lic.keys)) { d.inline = true; d.keys = keysOf(JSON.stringify(lic.keyids || { keys: lic.keys })); }
        }
    }
    function drmPlayable(d) { return !!d && (d.sys === 'widevine' || d.sys === 'playready') && !!d.url && !d.bad && !d.inline; }
    function drmShaka(d) { return !!d && d.sys === 'clearkey' && !d.bad && (!!d.keys || (!!d.url && !d.inline)); }

    // A link to a file, not a stream: a film or an episode (an Xtream account's /movie/… and
    // /series/… links, or a video file's name), played as one (seeking; see Player's isLive).
    var VOD_LINK = /\.(mkv|mp4|m4v|avi|mov|wmv|mpg|mpeg|webm)(?:[?#]|$)/i;
    var XTREAM_VOD = /^https?:\/\/[^\/]+(?:\/[^?#]*)?\/(movie|series)\/[^\/?#]+\/[^\/?#]+\/\d+\.[a-z0-9]{2,4}(?:[?#]|$)/i;
    function truthy(v) { return /^(?:1|true|yes)$/i.test(('' + (v || '')).trim()); }

    function audioUrl(u) {
        return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)(?:[?#]|$)/i.test(u || '');
    }

    // Returns [{ id, type, name, logo, group, tvgId, ua, ref, url, _yt }]
    // The M3U reader, a line at a time (so a big playlist can be read in chunks, see
    // parseM3UAsync). max: channels kept; any beyond are only counted (dropped). guides: the TV
    // guides it names (url-tvg / x-tvg-url / tvg-url, several split by commas).
    function m3uReader(max) {
        var r = { channels: [], dropped: 0, title: '', guides: [] }, cur = null, seen = {}, pre = null, cuHead = null, tz = null;   // (pre: #KODIPROP lines before a channel's #EXTINF; cuHead: the playlist's catch-up for every channel, tz: its server's time, see catchupOf)
        function add(c) {
            var base = 'iptv:' + idOf(c.tvgId || c.name);
            var id = base, n = 2;
            while (seen[id]) { id = base + '-' + n; n++; }
            seen[id] = 1; c.id = id;
            r.channels.push(c);
        }
        r.line = function (raw) {
            var s = raw.replace(/^\s+/, '');
            if (s.indexOf('#EXTM3U') === 0 && !r.guides.length) {
                r.guides = attr(s, /(?:^|\s)(?:url-tvg|x-tvg-url|tvg-url)="([^"]{1,4000})"/i).split(',').map(function (u) { return u.trim(); })
                    .filter(function (u) { return /^https?:\/\//i.test(u); }).slice(0, 5);
            }
            if (s.indexOf('#EXTM3U') === 0) {   // (its catch-up for every channel; its server's time from UTC, minutes: an Xtream account's, see the service's m3uXtream)
                cuHead = cuOf(s, null);
                var tzm = attr(s, /(?:^|\s)x-tz-offset="(-?\d{1,3})"/i);
                if (tzm !== '') { tz = +tzm; }
            }
            if (!r.title && s.indexOf('#EXTM3U') === 0) {   // the playlist's own name, if it has one
                r.title = attr(s, /(?:^|\s)(?:x-playlist-name|playlist-name|x-tvg-name)="([^"]{1,200})"/i).trim().slice(0, NAME_MAX);
            } else if (!r.title && s.indexOf('#PLAYLIST:') === 0) {
                r.title = s.slice(10).trim().slice(0, NAME_MAX);
            }
            if (s.indexOf('#EXTINF') === 0) {
                var group = attr(s, /group-title="([^"]*)"/i);
                var kind = attr(s, /tvg-type="([^"]*)"/i);
                cur = {
                    name: (s.slice(s.lastIndexOf(',') + 1).trim()) || U.t('Channel'),
                    logo: attr(s, /tvg-logo="([^"]*)"/i),
                    group: group,
                    tvgId: attr(s, /tvg-id="([^"]*)"/i),
                    ua: attr(s, /http-user-agent="([^"]*)"/i),
                    ref: attr(s, /http-referr?er="([^"]*)"/i),   // (both spellings)
                    radio: truthy(attr(s, /(?:^|\s)radio="([^"]*)"/i)) || /^radio$/i.test(kind),
                    sport: /^sports?$/i.test(kind),   // (StremioK's own mark: the Sports tab)
                    url: ''
                };
                var cu = cuOf(s, cuHead);
                if (cu) { if (tz !== null) { cu.tz = tz; } cur.cu = cu; }
                if (pre) { if (pre.drm) { cur.drm = pre.drm; } if (!cur.ua && pre.ua) { cur.ua = pre.ua; } if (!cur.ref && pre.ref) { cur.ref = pre.ref; } if (!cur.cookie && pre.cookie) { cur.cookie = pre.cookie; } pre = null; }
                if (/^guide$/i.test(kind)) {   // (StremioK's own mark: a channel watched elsewhere, kept for its TV guide alone; a link after it is ignored)
                    if (max && r.channels.length >= max) { r.dropped++; cur = null; return; }
                    cur.guideOnly = true; cur.radio = false; cur.type = 'tv';
                    if (!cur.group) { cur.group = 'TV guide'; }
                    add(cur);
                    cur = null;
                }
            } else if (/^#EXTVLCOPT:http-(user-agent|referr?er)=/i.test(s)) {   // (http-referer: the one-r spelling too)
                if (cur) { var opt = /^#EXTVLCOPT:http-(user-agent|referr?er)=(.*)$/i.exec(s); headerInto(cur, opt[1], opt[2]); }
            } else if (/^#KODIPROP:inputstream\.adaptive\.[a-z_]+=/i.test(s)) {   // a channel's DRM (Kodi's: see drmInto)
                var kp = /^#KODIPROP:inputstream\.adaptive\.([a-z_]+)=(.*)$/i.exec(s);
                drmInto(cur || (pre = pre || {}), kp[1].toLowerCase(), kp[2].trim());
            } else if (s.indexOf('#EXTHTTP:') === 0) {   // #EXTHTTP:{"User-Agent": "…", "Referer": "…"}
                var j = null;
                try { j = JSON.parse(s.slice(9)); } catch (e) { j = null; }
                if (cur && j && typeof j === 'object') { Object.keys(j).forEach(function (k) { if (typeof j[k] === 'string') { headerInto(cur, k, j[k]); } }); }
            } else if (s && s.charAt(0) !== '#') {
                if (cur) {
                    var u = s.trim();
                    // headers after a | (Kodi's): …m3u8|Referer=…&User-Agent=… (values may be %-encoded)
                    var bar = u.indexOf('|');
                    if (bar !== -1 && /^[A-Za-z][A-Za-z-]*=/.test(u.slice(bar + 1))) {
                        u.slice(bar + 1).split('&').forEach(function (kv) {
                            var eq = kv.indexOf('='), v = eq === -1 ? '' : kv.slice(eq + 1);
                            try { v = decodeURIComponent(v); } catch (e) {}
                            if (eq > 0) { headerInto(cur, kv.slice(0, eq), v); }
                        });
                        u = u.slice(0, bar);
                    }
                    if (/^https?:\/\//i.test(u)) {
                        if (max && r.channels.length >= max) { r.dropped++; cur = null; return; }
                        cur.url = u;
                        cur.radio = !cur.sport && (cur.radio || /\bradio\b/i.test(cur.group) || audioUrl(u));
                        cur.type = cur.sport ? 'sport' : cur.radio ? 'radio' : 'tv';
                        if (!cur.group) { cur.group = cur.sport ? 'Sports' : cur.radio ? 'Live Radio' : 'Live TV'; }
                        cur._yt =
                            /^https?:\/\/(?:[^\/]+\.)?youtube\.com(?::\d+)?(?:\/|$)/i.test(u) ||
                            /^https?:\/\/youtu\.be(?::\d+)?(?:\/|$)/i.test(u);
                        if (VOD_LINK.test(u) || XTREAM_VOD.test(u)) { cur.vod = true; }   // (a film's file: played as one, see plainStreams)
                        add(cur);
                    }
                    cur = null;
                }
            }
        };
        return r;
    }
    // ---- Catch-up (2.4.6, #29: Xtream's as in ediziks' fork, and the M3U attributes players read) ----
    // A channel's catch-up from its #EXTINF (or the playlist's #EXTM3U, for every channel): catchup
    // (or catchup-type) "xc" (an Xtream server's timeshift links), "default" (catchup-source in the
    // link's place), "append" (added to the link), "shift" (?utc=…&lutc=…), "flussonic"
    // (-hls / -ts, "fs"); catchup-days (or timeshift, tvg-rec) how far back, CU_DAYS when it says
    // none. -> { m, d, s } or null. CU_MAX_DAYS at most.
    var CU_DAYS = 3, CU_MAX_DAYS = 31, CU_MODES = { xc: 'xc', 'default': 'default', append: 'append', shift: 'shift', timeshift: 'shift', flussonic: 'flussonic', 'flussonic-hls': 'flussonic', 'flussonic-ts': 'flussonic-ts', fs: 'flussonic', stalker: 'stalker' };
    function cuOf(line, base) {
        var m = attr(line, /(?:^|\s)catchup(?:-type)?="([^"]*)"/i).toLowerCase().trim(), days = attr(line, /(?:^|\s)(?:catchup-days|timeshift|tvg-rec)="([^"]*)"/i), src = attr(line, /(?:^|\s)catchup-source="([^"]{1,2000})"/i);
        if (!m && !days && !src) { return base ? { m: base.m, d: base.d, s: base.s } : null; }
        var mode = CU_MODES[m] || (src ? 'default' : base ? base.m : '');
        var d = parseInt(days, 10);
        if (!mode || m === 'disabled' || m === 'false' || d === 0) { return null; }
        return { m: mode, d: Math.min(CU_MAX_DAYS, d > 0 ? d : (base && base.d) || CU_DAYS), s: src || (base && base.s) || '' };
    }
    // A merged channel's: its first copy that has it.
    function catchupOf(c) {
        if (!c) { return null; }
        if (c.cu) { return { c: c, cu: c.cu }; }
        var hit = null;
        (c._copies || []).some(function (x) { if (x.c.cu) { hit = { c: x.c, cu: x.c.cu }; return true; } return false; });
        return hit;
    }
    function catchupDays(id) { var h = _cache && catchupOf(_cache.byId[id]); return h ? h.cu.d : 0; }
    // An Xtream account's catch-up time (Settings: OK on it, Catch-up time): its server's own, as it
    // said (null), or yours, minutes from UTC (cuTz).
    function catchupTz(id) { var list = getPlaylists(), i = find(list, id); return i !== -1 && typeof list[i].cuTz === 'number' ? list[i].cuTz : null; }
    function setCatchupTz(id, mins) {
        var list = getPlaylists(), i = find(list, id);
        if (i < 0) { return false; }
        if (mins === null || mins === undefined || !isFinite(+mins)) { delete list[i].cuTz; } else { list[i].cuTz = Math.max(-720, Math.min(840, Math.round(+mins))); }
        savePlaylists(list, true);
        return true;
    }
    function hasCatchup(id) { return !!_cache && _cache.channels.some(function (c) { return c._playlistId === id && !!catchupOf(c); }); }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    // A program's catch-up link: from start to stop (seconds), within the channel's days and begun
    // already (what's on now: from its start). -> the source to play ({ url, _vod, _catchup, ... })
    // or null.
    var XC_LIVE = /^(https?:\/\/[^\/?#]+(?:\/[^?#]*?)?)\/live\/([^\/?#]+)\/([^\/?#]+)\/(\d+)(?:\.([a-z0-9]{2,4}))?(?:[?#]|$)/i;
    function catchupStream(id, start, stop) {
        var c = _cache && _cache.byId[id], h = catchupOf(c);
        if (!h || !(start > 0) || !(stop > start)) { return null; }
        var now = Math.floor(Date.now() / 1000), ch = h.c, cu = h.cu;
        if (start >= now || start < now - cu.d * 86400) { return null; }
        if (cu.m === 'stalker') { return stalkerCatchup(ch, cu, Math.floor(start), Math.ceil(stop)); }
        var url = catchupUrl(ch, cu, Math.floor(start), Math.ceil(stop), now);
        if (!url) { return null; }
        var st = { url: url, name: ch.name, title: 'IPTV · ' + ch.group + ' · ' + U.t('catch-up'), _vod: true, _catchup: true };
        var hd = U.sanitizeHeaders({ ua: ch.ua, ref: ch.ref, cookie: ch.cookie });
        if (hd) { st._headers = hd; }
        return st;
    }
    // A Stalker portal channel's recording: its link from the service, asked when it's played
    // (st._later resolves the source with it: see ViewParts.playCatchup).
    function stalkerCatchup(ch, cu, start, stop) {
        var list = getPlaylists(), pl = list[find(list, ch._playlistId)];
        if (!pl || !isStalker(pl) || !/^[\w-]{1,40}$/.test(cu.s || '') || typeof YTPlay === 'undefined' || !YTPlay.stalkerArchiveUrl) { return null; }
        var st = { url: '', name: ch.name, title: 'IPTV · ' + ch.group + ' · ' + U.t('catch-up'), _vod: true, _catchup: true };
        var hd = U.sanitizeHeaders({ ua: STB_UA, ref: ch.ref, cookie: ch.cookie });
        if (hd) { st._headers = hd; }
        st._later = function () { return YTPlay.stalkerArchiveUrl(pl.url, pl.mac, cu.s, start, stop).then(function (u) { st.url = u; return st; }); };
        return st;
    }
    function catchupUrl(ch, cu, start, stop, now) {
        var dur = stop - start, u = ch.url;
        function fill(t) {
            var d = new Date(start * 1000);
            return t.replace(/\$?\{(utc|start|timestamp|utcend|end|lutc|now|duration|offset)(?::(\d+))?\}/g, function (all, k, div) {
                var v = k === 'utc' || k === 'start' ? start : k === 'utcend' || k === 'end' ? stop : k === 'lutc' || k === 'now' || k === 'timestamp' ? now : k === 'duration' ? dur : now - start;
                return String(div ? Math.floor(v / +div) : v);
            }).replace(/\{(Y|m|d|H|M|S)\}/g, function (all, k) {
                return k === 'Y' ? d.getUTCFullYear() : two(k === 'm' ? d.getUTCMonth() + 1 : k === 'd' ? d.getUTCDate() : k === 'H' ? d.getUTCHours() : k === 'M' ? d.getUTCMinutes() : d.getUTCSeconds());
            });
        }
        if (cu.m === 'xc') {
            var x = XC_LIVE.exec(u);
            if (!x) { return ''; }
            var tz = catchupTz(ch._playlistId), off = tz !== null ? tz : (typeof cu.tz === 'number' ? cu.tz : 0), t = new Date((start + off * 60) * 1000);
            var stamp = t.getUTCFullYear() + '-' + two(t.getUTCMonth() + 1) + '-' + two(t.getUTCDate()) + ':' + two(t.getUTCHours()) + '-' + two(t.getUTCMinutes());
            return x[1] + '/timeshift/' + x[2] + '/' + x[3] + '/' + Math.max(1, Math.ceil(dur / 60)) + '/' + stamp + '/' + x[4] + '.' + (/^m3u8$/i.test(x[5] || '') ? 'm3u8' : 'ts');
        }
        if (cu.m === 'shift') { return u + (u.indexOf('?') === -1 ? '?' : '&') + 'utc=' + start + '&lutc=' + now; }
        if (cu.m === 'flussonic' || cu.m === 'flussonic-ts') {
            if (cu.m === 'flussonic' && /\.m3u8(?:[?#]|$)/i.test(u)) { return u.replace(/\/([^\/?#]*)\.m3u8/i, function (all, n) { return '/' + (n || 'index') + '-' + start + '-' + dur + '.m3u8'; }); }
            return /\/mpegts(?:[?#]|$)/i.test(u) ? u.replace(/\/mpegts/i, '/timeshift_abs-' + start + '.ts') : u.replace(/\/[^\/?#]*\.ts(?=[?#]|$)/i, '/timeshift_abs-' + start + '.ts');
        }
        if (cu.m === 'append') { return u + fill(cu.s || '?utc={utc}&lutc={lutc}'); }
        if (!cu.s) { return ''; }   // (default: its catch-up-source in the link's place)
        var f = fill(cu.s);
        return /^https?:\/\//i.test(f) ? f : u + f;
    }

    function parseM3U(text) {
        var r = m3uReader(0), lines = ('' + text).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) { r.line(lines[i]); }
        return r.channels;
    }
    // The same, PARSE_CHUNK lines at a time with a pause between (the remote stays
    // responsive while a big playlist is read); onProgress(channels so far). Resolves
    // { channels, dropped }. The text isn't kept once split.
    var PARSE_CHUNK = 3000;
    function parseM3UAsync(text, max, onProgress) {
        return new Promise(function (resolve) {
            var lines = ('' + text).split(/\r?\n/), r = m3uReader(max), i = 0;
            text = null;
            (function step() {
                var end = Math.min(lines.length, i + PARSE_CHUNK);
                for (; i < end; i++) { r.line(lines[i]); }
                if (onProgress) { try { onProgress(r.channels.length); } catch (e) {} }
                if (i < lines.length) { setTimeout(step, 0); return; }
                lines = null;
                resolve(r);
            })();
        });
    }

    // ---- ★ Favorites: channels you picked (hold OK on a channel card), a row first on the IPTV
    // tab (FAV_CAT, asks to come first among Home feeds unless you've placed it) and first on the
    // Guide tab; by channel id (its playlist and tvg-id / name), FAV_MAX at most.
    var FAV_KEY = 'stremiok.iptv.favs', FAV_MAX = 300, FAV_CAT = 'iptv_favs';
    function favs() { var f = U.store.get(FAV_KEY, []) || []; return Array.isArray(f) ? f.filter(function (x) { return typeof x === 'string'; }) : []; }
    // A saved id that's gone (its copy left out by Channel groups, or the provider's order changed
    // its number) is found again by the channel's key, kept with it (CHANKEYS_KEY: id -> type,
    // country and plain name, as the merge matches copies), for favorites and Recent.
    var CHANKEYS_KEY = 'stremiok.iptv.chankeys', _favMemo = { d: null, rev: -1, set: null, list: null }, _favRev = 0;
    function chanKey(c) {
        var x = c && c._copies ? c._copies[0].c : c;
        return x ? x.type + '|' + (countryOf(x.name) || countryOf(x.group)) + '|' + plainName(x.name).toLowerCase() : '';
    }
    function byKeyOf(d) {
        if (!d._byKey) { var m = {}; d.channels.forEach(function (c) { if (!c.guideOnly) { var k = chanKey(c); if (k && !m[k]) { m[k] = c; } } }); d._byKey = m; }
        return d._byKey;
    }
    function resolve(d, id) {
        if (d.byId[id]) { return d.byId[id]; }
        var k = (U.store.get(CHANKEYS_KEY, {}) || {})[id];
        return (k && byKeyOf(d)[k]) || null;
    }
    function keepKeys(add) {   // (the keys of saved favorites and recents only)
        var all = U.store.get(CHANKEYS_KEY, {}) || {}, out = {}, want = favs().concat(recents());
        if (add && add.id && add.key) { all[add.id] = add.key; }
        want.forEach(function (id) { if (all[id]) { out[id] = all[id]; } });
        U.store.set(CHANKEYS_KEY, out);
    }
    function favInfo(d) {   // (the favorite channels, once for this list and these favorites)
        if (_favMemo.d === d && _favMemo.rev === _favRev) { return _favMemo; }
        var set = {}, list = [];
        favs().forEach(function (id) { var c = resolve(d, id); if (c && !set[c.id]) { set[c.id] = true; list.push(c); } });
        _favMemo = { d: d, rev: _favRev, set: set, list: list };
        return _favMemo;
    }
    function isFavorite(id) {
        if (!_cache) { var f = favs(); return f.indexOf(id) !== -1; }
        var c = _cache.byId[id];
        return !!c && !!favInfo(_cache).set[c.id];
    }
    function setFavorite(id, on) {
        var c = _cache && _cache.byId[id];
        var f = favs().filter(function (x) { return c ? resolve(_cache, x) !== c : x !== id; });
        if (on) { f.unshift(id); }
        U.store.set(FAV_KEY, f.slice(0, FAV_MAX));
        _favRev++;
        keepKeys(c ? { id: id, key: chanKey(c) } : null);
        if (_cache) { favCatalog(_cache); }
        return true;
    }
    // The Favorites catalog, first in the list, while there are favorites among the channels read
    // (changed in place: the IPTV addon's manifest holds the same list).
    function favCatalog(d) {
        var at = -1;
        for (var i = 0; i < d.catalogs.length; i++) { if (d.catalogs[i].id === FAV_CAT) { at = i; } }
        var any = favInfo(d).list.length > 0;
        if (any && at === -1) { d.catalogs.unshift({ type: 'tv', id: FAV_CAT, name: U.t('★ Favorites'), extra: [{ name: 'search' }], _favs: true, _first: true }); }
        if (!any && at !== -1) { d.catalogs.splice(at, 1); }
        recentCatalog(d);
    }
    // ---- ⟲ Recent: the channels you played last (noteRecent, from a channel's page as it plays),
    // newest first, RECENT_MAX at most; a row after Favorites while one of them is among the
    // channels read. ----
    var RECENT_KEY = 'stremiok.iptv.recent', RECENT_MAX = 25, RECENT_CAT = 'iptv_recent';
    function recents() { var r = U.store.get(RECENT_KEY, []) || []; return Array.isArray(r) ? r.filter(function (x) { return typeof x === 'string'; }) : []; }
    function noteRecent(id) {
        if (typeof id !== 'string' || !/^iptv:/.test(id)) { return; }
        var c = _cache && _cache.byId[id];
        U.store.set(RECENT_KEY, [id].concat(recents().filter(function (x) { return x !== id && (!c || resolve(_cache, x) !== c); })).slice(0, RECENT_MAX));
        keepKeys(c ? { id: id, key: chanKey(c) } : null);
        if (_cache) { recentCatalog(_cache); }
    }
    function recentCatalog(d) {
        var at = -1, fav = -1;
        for (var i = 0; i < d.catalogs.length; i++) { if (d.catalogs[i].id === RECENT_CAT) { at = i; } if (d.catalogs[i].id === FAV_CAT) { fav = i; } }
        var any = recents().some(function (id) { return !!resolve(d, id); });
        if (any && at === -1) { d.catalogs.splice(fav + 1, 0, { type: 'tv', id: RECENT_CAT, name: U.t('⟲ Recent'), extra: [{ name: 'search' }], _recent: true }); }
        if (!any && at !== -1) { d.catalogs.splice(at, 1); }
    }

    // ---- What a channel's link really played as (the player's report, a few seconds in) ----
    // { link's fingerprint: { h, f, hevc, at } }, MEASURED_MAX links at most (the oldest go). A merged
    // channel's copies are ranked by it once known, ahead of what their names say (see streams).
    // Kept by a fingerprint of the link, not the link: an Xtream link holds the account's login,
    // and 1,500 of them would take a good part of the TV's settings storage. (From ediziks' fork.)
    var MEASURED_KEY = 'stremiok.iptv.measured', MEASURED_MAX = 1500, MEASURED_DAY = 86400000;
    function mkey(url) { return hash(url) + '.' + ('' + url).length.toString(36); }
    function measured(url) { var all = U.store.get(MEASURED_KEY, null); return (all && url && all[mkey(url)]) || null; }
    function noteMeasured(url, a) {
        if (!url || !a || !(+a.height > 0)) { return; }
        var rec = { h: +a.height, f: Math.round(+a.fps || 0), hevc: /hev|hvc|h\.?265/i.test(a.codec || '') ? 1 : 0, at: Date.now() };
        var all = U.store.get(MEASURED_KEY, {}) || {}, k = mkey(url), prev = all[k];
        if (prev && prev.h === rec.h && prev.f === rec.f && prev.hevc === rec.hevc && rec.at - prev.at < MEASURED_DAY) { return; }
        all[k] = rec;
        var urls = Object.keys(all);
        if (urls.length > MEASURED_MAX) { urls.sort(function (x, y) { return all[x].at - all[y].at; }).slice(0, urls.length - MEASURED_MAX).forEach(function (u) { delete all[u]; }); }
        U.store.set(MEASURED_KEY, all);
    }
    // On the same scale as quality(): what a name says
    function measuredScore(m) { return (m.h >= 2000 ? 400 : m.h >= 1000 ? 300 : m.h >= 700 ? 200 : m.h >= 400 ? 100 : 50) + (m.f >= 48 ? 30 : 0) + (m.hevc ? 25 : 0); }
    function measuredLabel(m) { return (m.h >= 2000 ? '4K' : m.h + 'p') + (m.f >= 48 ? (m.h >= 2000 ? ' ' : '') + m.f : ''); }   // ("1080p50", "720p", "4K")
    function build(channels) {
        var groups = [], byGroup = {}, byId = {};
        channels.forEach(function (c) {
            byId[c.id] = c;
            if (c._copies) { c._copies.forEach(function (x) { if (!byId[x.c.id]) { byId[x.c.id] = c; } }); }   // (a merged channel: by each copy's id too, favorites and the guide)
            if (c.guideOnly) { return; }   // (its TV guide alone: the Guide tab, no row)
            var key = c.type + '|' + c.group;
            if (!byGroup[key]) { byGroup[key] = []; groups.push({ type: c.type, name: c.group }); }
            byGroup[key].push(c);
        });
        groups = groupOrder(groups);
        var catalogs = groups.map(function (g) {
            var prefix = g.type === 'radio' ? 'iptv_radio_' : g.type === 'sport' ? 'iptv_sport_' : 'iptv_';
            return { type: g.type, id: prefix + idOf(g.name, g.type + '|' + g.name), name: g.name,
                extra: [{ name: 'search' }], _group: g.name };
        });
        var d = { ts: Date.now(), channels: channels, groups: groups, byId: byId, byGroup: byGroup, catalogs: catalogs };
        favCatalog(d);
        return d;
    }

    // One of your playlists' channels (iptv:<its playlist>:…), not an addon's that names its own
    // channels iptv:… too (Roxxy HUB's "iptv:A24.ar"): theirs are asked of their addon.
    function owns(id) {
        var m = /^iptv:([^:]+):/.exec('' + (id || ''));
        return !!m && getPlaylists().some(function (p) { return p.id === m[1]; });
    }
    function tagChannels(channels, playlistId) {
        channels.forEach(function (c) {
            c.id = 'iptv:' + playlistId + ':' + c.id.slice(5);
            c._playlistId = playlistId;
        });
        return channels;
    }
    // The playlist a channel came from, by name (shown with its group). A playlist named
    // only by its server's address says nothing more when there's just one playlist.
    var _sources = null;   // playlist id -> that, worked out once (a row may list thousands)
    function sourceOf(c) {
        if (!_sources) {
            _sources = {};
            var list = getPlaylists();
            list.forEach(function (p) {
                var st = _status[p.id];
                _sources[p.id] = (p.name || (st && st.title) || list.length > 1) ? label(p) : '';
            });
        }
        return _sources[c._playlistId] || '';
    }

    function loadOne(playlist, force) {
        var st = { id: playlist.id, url: playlist.url, count: 0, groups: 0, error: '', uncached: false, title: '', fetchedAt: 0, stale: false };
        _status[playlist.id] = st;
        if (/^http:/i.test(playlist.url)) {   // (Settings › Diagnostics › Logs)
            U.log('iptv', 'Playlist “' + label(playlist) + '” is downloaded over unencrypted http:// — anyone on the network path can see or change it (and ' + (isStalker(playlist) ? 'its MAC address' : 'any username / password in its link') + ')');
        }
        var src = playlist.url + (playlist.mac ? '#mac=' + playlist.mac : '') + (playlist.genres ? '#genres=' + playlist.genres.join(',') : '');   // (its saved copy: this portal, MAC and groups')

        function finish(text, at) {
            st.fetchedAt = at || 0;
            readNote(text);
            return parseM3UAsync(text, maxChannels(), function (n) { progress(playlist.id, n); }).then(function (r) {
                if (r.dropped) { st.dropped = r.dropped; }   // (kept to what the TV can hold; the rest dropped, and said so)
                st.title = r.title || '';
                st.guides = r.guides || [];
                _sources = null;
                // An Xtream account's films and episodes: its Movies and Series (js/xtvod.js), not channels
                var channels = r.channels;
                if (isXtream(playlist.url) && (playlist.noVod || (typeof XtVod !== 'undefined' && XtVod.hidesVodLines && XtVod.hidesVodLines(playlist.id)))) {
                    channels = channels.filter(function (c) { return !XTREAM_VOD.test(c.url); });
                    st.vodLines = r.channels.length - channels.length;
                }
                if (!st.picked && playlist.genres && !isStalker(playlist) && !isXtream(playlist.url)) {   // (read by the TV itself: its groups picked out here)
                    var want = {}, plain = { 'Live TV': 1, 'Sports': 1, 'Live Radio': 1, 'TV guide': 1 };
                    playlist.genres.forEach(function (k) { want[k] = 1; });
                    channels = channels.filter(function (c) { return want[hash(c.group)] || (want[hash('')] && plain[c.group]); });
                }
                return counted(tagChannels(channels, playlist.id));
            });
        }
        function counted(channels) {
            var groups = {};
            channels.forEach(function (c) { groups[c.type + '|' + c.group] = 1; });
            st.count = channels.length;
            st.groups = Object.keys(groups).length;
            if (!channels.length && !st.error && !st.vodLines) {
                st.error = U.t('No channels parsed (is the URL returning the .m3u file?)');
            }
            return channels;
        }

        // The service's note at the end of what it gave (see service/index.js, m3uServe): stopped
        // short of what the TV holds (st.svcCut: the groups' channels, and how many it kept).
        function readNote(text) {
            var i = text.lastIndexOf('#STREMIOK-READ:'), o = null;
            if (i === -1) { return; }
            try { o = JSON.parse(text.slice(i + 15).split('\n')[0]); } catch (e) { o = null; }
            if (!o) { return; }
            st.picked = true;   // (the groups picked out already)
            if (o.cut) { st.svcCut = { total: +o.total || 0, kept: +o.kept || 0 }; }   // (more than the TV holds: Settings says how many, and what to do)
            if (o.partial) { U.log('iptv', 'Playlist “' + label(playlist) + '”: only its first part was read (it is over 250 MB, or took over 12 minutes)'); }
        }
        var svc = serviceSrc(playlist);
        function serviceText() {
            var answered = false;
            return YTPlay.iptvRead(svc, force).then(function (r) {
                answered = !!r;
                if (!r || r.state !== 'ready') { throw new Error((r && r.error) || U.t('no answer')); }
                if (r.stale) { st.stale = true; st.error = r.error ? U.t('Couldn’t read it again: {why}', { why: r.error }) : ''; }
                return YTPlay.iptvText(svc, playlist.genres || [], playlistMax());
            }).then(null, function (e) {   // (the TV reads it itself, as before)
                // (not an Xtream account the service answered for: the TV reading its 20,000 channels
                // itself, without your Channel groups, times out or keeps the wrong ones; its saved
                // copy is used instead, see fetchIt)
                if (answered && isXtream(playlist.url)) { throw e; }
                U.log('iptv', 'Playlist “' + label(playlist) + '”: not read by StremioK’s service (' + U.problem(e) + '); reading it here');
                return U.getText(playlist.url, 15000 * sizeMb() / 20, playlistMax());
            });
        }

        var saved = force ? Promise.resolve(null) : readPersist(playlist.id);
        return saved.then(function (p) {
            if (p && p.url === src && typeof p.text === 'string') { return finish(p.text, p.at); }
            return fetchIt();
        });
        // A Stalker portal's channels, from the service (see stalkerCheck): its M3U text.
        function stalkerText() {
            if (typeof YTPlay === 'undefined' || !YTPlay.stalkerList) { return Promise.reject(new Error(U.t('Stalker portals are read by StremioK’s service (not in a desktop browser)'))); }
            return YTPlay.stalkerList(playlist.url, playlist.mac, stalkerAll(), playlist.genres).then(function (r) {
                if (r && typeof r.m3u === 'string') {
                    if (r.cut) {   // (stopped short: said, with what's there)
                        st.cut = r.cut.total || true;
                        U.log('iptv', 'Stalker portal “' + label(playlist) + '”: read ' + (r.count || 0) + ' channels' + (r.cut.total ? ' of ' + r.cut.total : '') + ', and stopped' + (r.cut.why ? ' (' + r.cut.why + ')' : ''));
                    }
                    return r.m3u;
                }
                var why = (r && r.why) || U.t('no answer');
                throw new Error(r && r.refused ? U.t('The portal refused it: {why}', { why: why }) : U.t('Couldn’t read the portal: {why}', { why: why }));
            }, function (e) {
                throw new Error(/no service/.test((e && e.message) || '') ? U.t('Stalker portals are read by StremioK’s service (not in a desktop browser)') : U.t('Couldn’t reach StremioK’s service: {why}', { why: U.problem(e) }));
            });
        }
        function fetchIt() {
            return (isStalker(playlist) ? stalkerText() : svc ? serviceText() : U.getText(playlist.url, 15000 * sizeMb() / 20, playlistMax())).then(function (text) {
                var at = Date.now();
                return writePersist(playlist.id, src, text, at).then(function (ok) {
                    st.uncached = !ok;
                    return finish(text, at);
                });
            }, function (e) {
                var msg = (e && e.message) ? e.message : U.t('Could not fetch the playlist URL');
                // status 0 / network error on a URL that opens fine in a browser almost
                // always means the server sent no Access-Control-Allow-Origin header.
                if (!isStalker(playlist) && (/HTTP 0\b/.test(msg) || /Network error|^No answer/i.test(msg))) {
                    msg += U.t(' — the playlist server likely isn\'t sending an Access-Control-Allow-Origin header (CORS). Serve the .m3u with CORS enabled.');
                }
                st.error = msg;
                // Fall back to this playlist's saved copy so a failed refresh doesn't wipe it.
                return readPersist(playlist.id).then(function (prev) {
                    if (!(prev && prev.url === src && typeof prev.text === 'string')) { return []; }
                    st.stale = true;   // (the channels are the saved copy's)
                    return finish(prev.text, prev.at);
                });
            });
        }
    }

    // Progress while playlists are read: onProgress(fn) -> fn(channels read so far, all playlists).
    var _progress = {}, _progressFns = [];
    function progress(id, n) {
        _progress[id] = n;
        var total = 0;
        for (var k in _progress) { if (Object.prototype.hasOwnProperty.call(_progress, k)) { total += _progress[k]; } }
        _progressFns.forEach(function (fn) { try { fn(total); } catch (e) {} });
    }
    function onProgress(fn) { _progressFns.push(fn); }
    function isReady() { return !!_cache; }   // (the playlists read: synthAddon has their channels)

    // Each playlist is fetched once and saved (the big store). Passing a playlist id
    // forces only that entry to refresh; true refreshes every configured playlist.
    function load(forceId) {
        var playlists = getPlaylists().filter(function (p) { return !p.off; });   // (switched off: not read)
        if (!playlists.length) {
            _cache = build([]);
            if (typeof EPG !== 'undefined' && EPG.start) { setTimeout(EPG.start, 0); }   // (their guides dropped: no Guide tab)
            return Promise.resolve(_cache);
        }
        if (!forceId && _cache) { return Promise.resolve(_cache); }
        if (!forceId && _pending && _pending.rev === _rev) { return _pending.p; }   // (one under way: shared)
        var rev = _rev;
        var tasks = playlists.map(function (p) {
            return function () { return loadOne(p, forceId === true || forceId === p.id); };
        });
        _progress = {};
        var pr = U.settleAll(tasks, 3).then(function (results) {
            if (_pending && _pending.p === pr) { _pending = null; }
            if (rev !== _rev) { return load(); }   // (the playlists changed meanwhile)
            // All playlists together; a channel listed more than once (exactly the same: link,
            // name, group and the headers it's played with) once, from the first playlist that
            // has it. The same link under another name, group, User-Agent or Referer is a
            // channel of its own (a provider may need its own headers for it).
            var channels = [], seen = {};
            results.forEach(function (r) {
                if (!r.ok || !r.value) { return; }
                r.value.forEach(function (c) {
                    var k = sameKey(c);
                    if (!seen[k]) { seen[k] = 1; channels.push(c); }
                });
            });
            _cache = build(tidy(channels));
            if (typeof EPG !== 'undefined' && EPG.start) { setTimeout(EPG.start, 0); }   // (their TV guides: see js/epg.js)
            return _cache;
        });
        _pending = { rev: rev, p: pr };
        return pr;
    }

    // ---- Tidying (Settings › Content › IPTV, each off until you set it; ported in spirit from
    // ediziks' fork, #29, with the countries and words yours rather than built in) ----
    // { merge: 'all' one tile for a channel listed more than once (the same name, the quality words
    // left out, in the same country), each copy a source, the best first; 'best' one tile that plays
    // the best copy at once, the next ones if it doesn't start (its stream's _fallbacks); 'off'; countries: your countries,
    // their groups first, in your order; hide: words, a channel whose name or group has one left
    // out }. A line with no letter or digit (a playlist's "-----" divider) is always left out.
    var TIDY_KEY = 'stremiok.iptv.tidy', TIDY_WORDS_MAX = 40, TIDY_COUNTRIES_MAX = 12;
    var HIDE_SUGGESTED = ['xxx', 'adult', 'porn', 'porno', 'erotic', 'erotik', '18+', '+18', 'sex', 'nsfw', 'playboy', 'brazzers', 'hustler', 'dorcel', 'redlight'];
    function listOf(v, max, up) {
        var out = [], seen = {};
        (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).forEach(function (w) {
            w = String(w || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            if (up) { w = w.toUpperCase(); }
            var k = w.toLowerCase();
            if (w && !seen[k] && out.length < max) { seen[k] = 1; out.push(w); }
        });
        return out;
    }
    function tidyCfg() {
        var t = U.store.get(TIDY_KEY, null) || {};
        return { merge: t.merge === 'best' ? 'best' : (t.merge === 'all' || t.merge === true) ? 'all' : 'off', countries: listOf(t.countries, TIDY_COUNTRIES_MAX, true), hide: listOf(t.hide, TIDY_WORDS_MAX) };
    }
    function setTidy(patch) {   // (the channels made again from what's read: reset, then load)
        var t = tidyCfg();
        if (patch.merge !== undefined) { t.merge = patch.merge === 'best' ? 'best' : (patch.merge === 'all' || patch.merge === true) ? 'all' : 'off'; }
        if (patch.countries !== undefined) { t.countries = listOf(patch.countries, TIDY_COUNTRIES_MAX, true); }
        if (patch.hide !== undefined) { t.hide = listOf(patch.hide, TIDY_WORDS_MAX); }
        if (t.merge === 'off' && !t.countries.length && !t.hide.length) { U.store.remove(TIDY_KEY); } else { U.store.set(TIDY_KEY, t); }
        reset();
        return tidyCfg();
    }
    // A country named at the start of a group or channel name ("UK | News", "[DE] Sport", "TR: …"):
    // its usual code (COUNTRY_WORDS: the names and codes playlists use), or any two letters before
    // a separator; '' when none.
    var COUNTRY_WORDS = { UK: 'UK', GB: 'UK', ENG: 'UK', BRITISH: 'UK', ENGLAND: 'UK', US: 'US', USA: 'US', AMERICA: 'US', TR: 'TR', TUR: 'TR', TURK: 'TR', TURKIYE: 'TR', TURKEY: 'TR',
        NL: 'NL', NED: 'NL', NLD: 'NL', DUTCH: 'NL', NEDERLAND: 'NL', HOLLAND: 'NL', DE: 'DE', GER: 'DE', GERMANY: 'DE', DEUTSCH: 'DE', DEUTSCHLAND: 'DE',
        FR: 'FR', FRA: 'FR', FRANCE: 'FR', FRENCH: 'FR', ES: 'ES', ESP: 'ES', SPAIN: 'ES', SPANISH: 'ES', ESPANA: 'ES', IT: 'IT', ITA: 'IT', ITALY: 'IT', ITALIA: 'IT', ITALIAN: 'IT',
        PT: 'PT', POR: 'PT', PORTUGAL: 'PT', BR: 'BR', BRA: 'BR', BRAZIL: 'BR', BRASIL: 'BR', AR: 'AR', ARG: 'AR', ARGENTINA: 'AR', MX: 'MX', MEX: 'MX', MEXICO: 'MX',
        CA: 'CA', CAN: 'CA', CANADA: 'CA', AU: 'AU', AUS: 'AU', AUSTRALIA: 'AU', IN: 'IN', IND: 'IN', INDIA: 'IN', PL: 'PL', POL: 'PL', POLAND: 'PL', RU: 'RU', RUS: 'RU', RUSSIA: 'RU',
        GR: 'GR', GRE: 'GR', GREECE: 'GR', BE: 'BE', BEL: 'BE', BELGIUM: 'BE', AT: 'AT', AUT: 'AT', AUSTRIA: 'AT', CH: 'CH', SUI: 'CH', SWISS: 'CH', SWITZERLAND: 'CH',
        SE: 'SE', SW: 'SE', SWE: 'SE', SWEDEN: 'SE', DK: 'DK', DENMARK: 'DK', NO: 'NO', NORWAY: 'NO', FI: 'FI', FINLAND: 'FI', IE: 'IE', IRELAND: 'IE',
        RO: 'RO', ROMANIA: 'RO', AL: 'AL', ALBANIA: 'AL',
        ARAB: 'ARAB', ARABIC: 'ARAB', LATINO: 'LATINO', LATIN: 'LATINO' };
    var NOT_COUNTRY = { TV: 1, HD: 1, SD: 1, FHD: 1, UHD: 1, '4K': 1, '8K': 1, IP: 1, FX: 1, VIP: 1, RAW: 1, PPV: 1, VOD: 1, NEW: 1, ALL: 1 };
    function countryCode(w) { w = String(w || '').toUpperCase(); return COUNTRY_WORDS[w] || w; }
    // A region before the country ("EU | UK DOCUMENTARY", "INT: TR …") isn't one: the word after
    // it is, a country's name or code ("UK", "TURK"), even before a space.
    var REGION_WORDS = { EU: 1, EUR: 1, EUROPE: 1, INT: 1, WW: 1, WORLD: 1, AF: 1, AFRICA: 1, AS: 1, ASIA: 1, AM: 1, LATAM: 1 };
    function countryOf(text) {
        var t = String(text || '').replace(/^[\s\[({|┃│#*=\-]+/, ''), m = /^([A-Za-z]{2,12})([\s]*[:|\-┃│\/\])]|$)/.exec(t);
        if (!m) { return ''; }
        var w = m[1].toUpperCase();
        if (REGION_WORDS[w] && m[2]) {
            var n = /^([A-Za-z]{2,12})(?=[\s:|\-┃│\/\])]|$)/.exec(t.slice(m[0].length).replace(/^[\s\[({|┃│#*=\-]+/, ''));
            return n && COUNTRY_WORDS[n[1].toUpperCase()] ? COUNTRY_WORDS[n[1].toUpperCase()] : '';
        }
        if (COUNTRY_WORDS[w]) { return COUNTRY_WORDS[w]; }
        return w.length === 2 && !NOT_COUNTRY[w] && m[2] ? w : '';
    }
    var DECOR = /[\s\-=_*#|~.+<>•·─═━┃│★☆●◆■▲►»«✦()\[\]{}:\/\\'"!?,;]+/g;
    function isDivider(name) {   // (nothing but decoration, or a heading between runs of it: "#### UK ####", "=== Sports ===")
        var n = String(name || '').trim();
        return !n.replace(DECOR, '') || /^[#=*~_\-─═━]{2,}.*[#=*~_\-─═━]{2,}$/.test(n);
    }
    function hideTest(words) {
        if (!words.length) { return null; }
        var esc = words.map(function (w) { return w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
        var re = new RegExp('(?:^|[^a-z0-9])(?:' + esc.join('|') + ')(?=$|[^a-z0-9])', 'i');
        return function (c) { return re.test((' ' + (c.name || '') + ' ' + (c.group || '') + ' ').replace(/adult\s*swim/ig, ' ')); };   // ("Adult Swim": cartoons)
    }
    // The quality a copy's name says (its source's order: best first, a backup last) and its name
    // without it, for matching copies: the country prefix, quality words and punctuation left out.
    var QUALITY_WORDS = /\b(?:4k\s*uhd|uhd\s*4k|full\s*hd|uhd|4k|8k|fhd|hevc|h\.?265|x265|h\.?264|x264|2160p?|1080[pi]?|720p?|576p|480p|360p|50\s*fps|60\s*fps|hd|sd|lq|hq|backup|yedek|bk|mirror|spare)\b/ig;
    // group: the copy's group, for a name that says no resolution ("EU | UK 4K" → 4K).
    var BACKUP_WORDS = /\b(?:backup|yedek|bk|mirror|spare|alt\s*\d)\b/i;
    function quality(name, group) {
        var s = String(name || ''), score = 100, badge = '', said = true;
        if (/\b(?:8k|4k|uhd|2160p?)\b/i.test(s)) { score = 400; badge = '4K'; }
        else if (/\b(?:fhd|1080[pi]?|full\s*hd)\b/i.test(s)) { score = 300; badge = 'FHD'; }
        else if (/\b(?:hd|720p?)\b/i.test(s)) { score = 200; badge = 'HD'; }
        else if (/\b(?:sd|576p|480p|360p|lq)\b/i.test(s)) { score = 50; badge = 'SD'; }
        else { said = false; }
        if (!said && group) {
            var g = String(group);
            if (/\b(?:8k|4k|uhd)\b/i.test(g)) { score = 400; badge = '4K'; } else if (/\b(?:fhd|full\s*hd)\b/i.test(g)) { score = 300; badge = 'FHD'; }
        }
        if (/\b(?:hevc|h\.?265|x265)\b/i.test(s)) { score = (said || score > 100 ? score : 225) + 25; badge = (badge ? badge + ' ' : '') + 'HEVC'; }   // (HEVC alone: an HD one)
        if (/\b(?:50|60)\s*fps\b/i.test(s)) { score += 30; }
        if (BACKUP_WORDS.test(s)) { score -= 150; badge = (badge ? badge + ' ' : '') + U.t('backup'); }
        return { score: score, badge: badge };
    }
    var QUALITY_ONE = new RegExp(QUALITY_WORDS.source, 'i');
    // A "+1" channel (the same an hour later) stays apart from its channel ("ITV +1", "ITV+ 1"), and
    // a country in brackets other than the copy's own stays in the name ("( US )", "(SP)", "(NI)").
    function plainName(name) {
        var own = countryOf(name);
        var s = String(name || '').replace(/^[\s\[({|┃│#*=\-]*[A-Za-z]{2,12}[\s]*[:|\-┃│\/\])][\s\-|:]*/, function (all) { return countryOf(all) ? '' : all; });
        s = s.replace(/[\[(]\s*([^\])]{1,12}?)\s*[\])]/g, function (all, inner) { var cc = countryOf(inner + ':'); return (cc && cc === own) || QUALITY_ONE.test(inner) ? ' ' : (cc ? ' ' + cc + ' ' : all); });   // ("[UK]" in a UK one, "(HD)")
        s = s.replace(/\+\s*([12])(?![0-9])/g, ' plus$1 ');
        return s.replace(QUALITY_WORDS, ' ').replace(DECOR, ' ').replace(/\s+/g, ' ').trim();
    }
    function tidy(channels) {
        var cfg = tidyCfg(), hidden = hideTest(cfg.hide);
        var out = channels.filter(function (c) { return c.guideOnly || (!isDivider(c.name) && !(hidden && hidden(c))); });
        if (cfg.merge === 'off') { return out; }
        var byKey = {}, merged = [];
        out.forEach(function (c) {
            var plain = plainName(c.name);
            if (c.guideOnly || plain.length < 2) { merged.push(c); return; }
            var k = c.type + '|' + (countryOf(c.name) || countryOf(c.group)) + '|' + plain.toLowerCase();   // (the copy's own country first: "FR| DISCOVERY" in an "EU | UK …" group is French)
            var m = byKey[k];
            if (!m) { m = byKey[k] = { first: c, copies: [], name: plain }; merged.push(m); }
            m.copies.push(c);
        });
        return merged.map(function (m) {
            if (!m.copies) { return m; }
            if (m.copies.length === 1) { return m.first; }
            var copies = m.copies.map(function (c, i) { var q = quality(c.name, c.group); return { c: c, i: i, score: q.score, badge: q.badge }; })
                .sort(function (a, b) { return b.score - a.score || a.i - b.i; });
            var SPECIAL = /\b(?:4k|uhd|8k|vip|ppv|hevc|backup|events?)\b|\+\s*1\b/i, home = m.first;
            if (SPECIAL.test(home.group || '')) { m.copies.some(function (c) { if (!SPECIAL.test(c.group || '')) { home = c; return true; } return false; }); }
            m.first = home;   // (its tile shows in a plain group: "EU | UK SPORTS", not "EU | UK 4K")
            var one = {}, k;
            for (k in m.first) { if (Object.prototype.hasOwnProperty.call(m.first, k)) { one[k] = m.first[k]; } }
            one.name = m.name;
            one._copies = copies.map(function (x) { return { c: x.c, badge: x.badge }; });
            if (cfg.merge === 'best') { one._best = true; }
            if (!one.logo) { copies.some(function (x) { if (x.c.logo) { one.logo = x.c.logo; return true; } return false; }); }
            if (!one.tvgId) { copies.some(function (x) { if (x.c.tvgId) { one.tvgId = x.c.tvgId; return true; } return false; }); }
            return one;
        });
    }
    // Countries first: the groups in your countries, in your order, then the rest as they were.
    function groupOrder(groups) {
        var want = tidyCfg().countries.map(countryCode);
        if (!want.length) { return groups; }
        return groups.map(function (g, i) { var at = want.indexOf(countryOf(g.name)); return { g: g, i: i, r: at === -1 ? want.length : at }; })
            .sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.g; });
    }

    function sameKey(c) {
        var p = U.parseUrl(c.url);   // (scheme and host in lower case)
        return [p ? p.href : c.url, c.name, c.group, c.type, c.ua || '', c.ref || '', c.cookie || ''].join('\u0001');
    }

    function reload(id) {   // (its TV guide read again too: EPG.start)
        reset();
        return load(id || true).then(function (d) {
            if (typeof EPG !== 'undefined' && EPG.start) { EPG.start(id || true); }
            return d;
        });
    }
    // Auto-refresh (Settings › Content › IPTV): every this many hours (0: Off), all playlists and
    // their guides downloaded again, as Reload does (the Home ticker: see view-home's
    // iptvRefreshTick). EVERY: the choices.
    var EVERY_KEY = 'stremiok.iptv.every', EVERY = [0, 1, 3, 6, 12];
    function refreshEvery() { var h = +U.store.get(EVERY_KEY, 0); return EVERY.indexOf(h) !== -1 ? h : 0; }
    function setRefreshEvery(h) { h = +h; U.store.set(EVERY_KEY, EVERY.indexOf(h) !== -1 ? h : 0); }
    // When the playlists switched on were last downloaded: the oldest of them (a saved copy's own
    // date), 0 when one never was.
    function readAt() {
        var on = getPlaylists().filter(function (p) { return !p.off; }), t = Infinity;
        on.forEach(function (p) { var st = _status[p.id]; t = Math.min(t, st && st.fetchedAt ? st.fetchedAt : 0); });
        return on.length ? t : Infinity;
    }
    function status(id) {
        if (id) { return _status[id] || { id: id, url: '', count: 0, groups: 0, error: '', title: '', fetchedAt: 0 }; }
        return _status;
    }

    function toMeta(c) {
        return {
            id: c.id, type: c.type, name: c.name,
            poster: c.logo || '', background: c.logo || '', logo: c.logo || '',
            posterShape: 'landscape', description: c.group + (sourceOf(c) ? '  ·  ' + U.t('from {source}', { source: sourceOf(c) }) : '')
        };
    }

    function catalog(catId, extra) {
        return load().then(function (d) {
            var cat = null;
            for (var i = 0; i < d.catalogs.length; i++) {
                if (d.catalogs[i].id === catId) { cat = d.catalogs[i]; break; }
            }
            if (!cat) { return []; }
            var q = (extra && extra.search) ? ('' + extra.search).toLowerCase() : '';
            var out = [];
            var ids = cat._favs ? favs() : cat._recent ? recents() : null;
            var list = ids ? ids.map(function (id) { return resolve(d, id); }).filter(function (c, i, all) { return !!c && all.indexOf(c) === i; }) : (d.byGroup[cat.type + '|' + cat._group] || []);   // (a merged channel once)
            list.forEach(function (c) {
                if (q && c.name.toLowerCase().indexOf(q) === -1) { return; }
                out.push(toMeta(c));
            });
            // Discover pages through a group 100 channels at a time (Home takes them all)
            if (extra && extra.skip != null) { var sk = parseInt(extra.skip, 10) || 0; return out.slice(sk, sk + 100); }
            return out;
        });
    }

    // The player's channel list (LEFT on a live channel): your favorites, then each group in its
    // order, radio with radio, TV and sports together; `at` the playing channel's group.
    // -> { groups: [{ name, list: [meta] }], at } or null (no channels read).
    function zapGroups(id) {
        if (!_cache) { return null; }
        var me = _cache.byId[id], radio = !!(me && me.type === 'radio'), out = [], at = 0;
        var favList = favInfo(_cache).list.filter(function (c, i, l) { return c && !c.guideOnly && (c.type === 'radio') === radio && l.indexOf(c) === i; });
        if (favList.length) { out.push({ name: U.t('★ Favorites'), list: favList.map(toMeta), fav: true }); }
        _cache.groups.forEach(function (g) {
            if ((g.type === 'radio') !== radio) { return; }
            var list = _cache.byGroup[g.type + '|' + g.name] || [];
            if (!list.length) { return; }
            if (me && list.indexOf(me) !== -1) { at = out.length; }
            out.push({ name: g.name, list: list.map(toMeta) });
        });
        return out.length ? { groups: out, at: at } : null;
    }

    function meta(id) {
        return load().then(function (d) { var c = d.byId[id]; return c ? toMeta(c) : null; });
    }

    // An Xtream channel's link (…/live/user/pass/id.ext) can lead anywhere: YouTube (a provider's
    // "Alt" channel), or an HLS playlist somewhere else, which the TV's player refuses under a .ts
    // link (it goes by the link's ending). Looked at (redirects followed, its headers only: the
    // answer isn't read), within YT_PROBE_MS. Resolves { page: the YouTube page it ends on, hls:
    // the playlist } (either, or neither). A YouTube end (or a plain one) is kept YT_KEEP_MS, a
    // playlist HLS_KEEP_MS (its link may carry a short-lived token), or until the playlists reload
    // (reset): a server can renumber its channels, and the same link then leads somewhere else.
    // While a channel plays it isn't looked at (a second connection, which a one-connection
    // account drops the picture for), unless CH+ / CH− or the channel list is switching away from
    // it (zapping(): that channel is closed anyway) — what's kept is still used.
    var XTREAM_LIVE = /^https?:\/\/[^\/]+(?:\/[^?#]*)?\/live\/[^\/?#]+\/[^\/?#]+\/\d+(?:\.[a-z0-9]{2,4})?(?:[?#]|$)/i, YT_PROBE_MS = 4000, YT_KEEP_MS = 5 * 60000, HLS_KEEP_MS = 60000, ZAP_PROBE_MS = 15000;
    var HLS_TYPE = /mpegurl/i, NO_END = { page: '', hls: '' }, _zapAt = 0;
    function isYouTube(u) { return /^https?:\/\/(?:[^\/]+\.)?youtube\.com(?::\d+)?(?:\/|$)/i.test(u) || /^https?:\/\/youtu\.be(?::\d+)?(?:\/|$)/i.test(u); }
    function zapping() { _zapAt = Date.now(); }
    function linkEnd(url) {
        if (!XTREAM_LIVE.test(url)) { return Promise.resolve(NO_END); }
        var kept = Object.prototype.hasOwnProperty.call(_ytEnds, url) ? _ytEnds[url] : null;
        if (kept && Date.now() - kept.at < (kept.end.hls ? HLS_KEEP_MS : YT_KEEP_MS)) { return Promise.resolve(kept.end); }
        if (typeof Player !== 'undefined' && Player.inUse && Player.inUse() && Date.now() - _zapAt > ZAP_PROBE_MS) { return Promise.resolve(NO_END); }
        return new Promise(function (resolve) {
            var x = null, done = false;
            function end(e, keep) { if (done) { return; } done = true; clearTimeout(t); try { x.abort(); } catch (er) {} if (keep) { _ytEnds[url] = { end: e, at: Date.now() }; } resolve(e); }
            var t = setTimeout(function () { end(NO_END, false); }, YT_PROBE_MS);   // (not remembered: asked again next time)
            try {
                x = new XMLHttpRequest();
                x.open('GET', url, true);
                x.onreadystatechange = function () {
                    if (x.readyState < 2) { return; }
                    var to = '' + (x.responseURL || '');
                    if (isYouTube(to)) { end({ page: to, hls: '' }, true); return; }
                    var hls = x.status >= 200 && x.status < 300 && /^https?:\/\//i.test(to) && to !== url && !/\.m3u8(?:[?#]|$)/i.test(url) &&
                        (HLS_TYPE.test(x.getResponseHeader('Content-Type') || '') || /\.m3u8(?:[?#]|$)/i.test(to));
                    end(hls ? { page: '', hls: to } : NO_END, x.status > 0 && x.status < 500);
                };
                x.onerror = function () { end(NO_END, false); };
                x.send();
            } catch (e) { end(NO_END, false); }
        });
    }
    function streams(id) {
        return load().then(function (d) {
            var c = d.byId[id];
            if (!c || c.guideOnly) { return []; }
            if (c._copies) {   // (merged: each copy's, the best first, its quality said)
                return Promise.all(c._copies.map(function (x) {
                    return copyStreams(x.c).then(function (l) {
                        return l.map(function (st) {
                            var m = measured(st.url), badge = m ? measuredLabel(m) + (/\b(?:backup|yedek)\b/i.test(x.c.name || '') ? ' ' + U.t('backup') : '') : x.badge;
                            if (badge) { st.title = (st.title || '') + ' · ' + badge; }
                            return st;
                        });
                    }, function () { return []; });
                })).then(function (lists) {
                    // (what each copy really played as, where known, ahead of what its name says)
                    var ranked = lists.map(function (l, i) {
                        var x = c._copies[i], m = l.length ? measured(l[0].url) : null;
                        var backup = /\b(?:backup|yedek)\b/i.test(x.c.name || '') ? 150 : 0;
                        return { l: l, i: i, score: m ? measuredScore(m) - backup : quality(x.c.name).score };
                    }).sort(function (a, b) { return b.score - a.score || a.i - b.i; });
                    var all = [].concat.apply([], ranked.map(function (r) { return r.l; }));
                    if (!c._best) { return all; }
                    var tries = withHlsAlts(all);
                    if (tries.length < 2) { return all; }
                    all[0]._fallbacks = tries.slice(1);   // (the best alone, played at once; the rest if it doesn't start: see the player's nextSourceOnFail)
                    return [all[0]];
                });
            }
            return copyStreams(c).then(function (l) {   // (one copy: its HLS link if its MPEG-TS one doesn't play)
                if (l.length === 1) { var alt = withHlsAlts(l).slice(1); if (alt.length) { l[0]._fallbacks = alt; } }
                return l;
            });
        });
    }
    // An Xtream channel's MPEG-TS link (…/live/u/p/123.ts) is offered as HLS too (….m3u8), right
    // after it, as a fallback: the same channel the other way, which the account usually allows.
    var XT_TS = /^(https?:\/\/[^?#]+\/live\/[^\/?#]+\/[^\/?#]+\/[^\/?#.]+)\.ts((?:[?#].*)?)$/i;
    function withHlsAlts(list) {
        var out = [], seen = {};
        list.forEach(function (st) {
            if (!st || seen[st.url]) { return; }
            seen[st.url] = 1; out.push(st);
            var m = XT_TS.exec(st.url || '');
            if (!m || seen[m[1] + '.m3u8' + m[2]]) { return; }
            var o = {}, k;
            for (k in st) { if (Object.prototype.hasOwnProperty.call(st, k) && k !== '_fallbacks') { o[k] = st[k]; } }
            o.url = m[1] + '.m3u8' + m[2]; o.title = (st.title || '') + ' · HLS';
            seen[o.url] = 1; out.push(o);
        });
        return out;
    }
    function copyStreams(c) {
        return Promise.resolve().then(function () {
            if (c._yt) {
                return [{ url: c.url, _yt: true, ytPage: c.url, name: c.name, title: 'YouTube · ' + c.group }];
            }
            var list = getPlaylists(), pl = list[find(list, c._playlistId)];
            if (isStalker(pl)) { return stalkerStreams(c, pl); }
            return linkEnd(c.url).then(function (e) {
                if (e.page) { return [{ url: e.page, _yt: true, ytPage: e.page, name: c.name, title: 'YouTube · ' + c.group }]; }
                var l = plainStreams(c);
                if (e.hls) { l[0].url = e.hls; }   // (the playlist it leads to: the TV's player takes it by its own link)
                return l;
            });
        });
    }
    function plainStreams(c) {
        var from = sourceOf(c);
        var st = { url: c.url, name: c.name, title: 'IPTV · ' + c.group + (from ? ' · ' + from : '') };
        if (c.vod) { st._vod = true; }
        if (c.drm) {   // (see the player's drmSetup and startShaka)
            st._drm = { sys: c.drm.sys || 'other', url: c.drm.url || '', h: c.drm.h || {}, b64: !!c.drm.b64, ok: drmPlayable(c.drm), shaka: drmShaka(c.drm) };
            if (c.drm.keys) { st._drm.keys = c.drm.keys; }
        }
        var h = U.sanitizeHeaders({ ua: c.ua, ref: c.ref, cookie: c.cookie });   // (only what the player takes, checked)
        if (h) { st._headers = h; }
        return [st];
    }

    // A Stalker portal's channel: its link asked for now (create_link: most portals' links work for
    // a short while, or once), played with a MAG User-Agent. None given: the one in its playlist,
    // unless that's a stand-in (http://localhost/ch/…), which plays nothing.
    function stalkerStreams(c, pl) {
        var asked = typeof YTPlay !== 'undefined' && YTPlay.stalkerLink ? YTPlay.stalkerLink(pl.url, pl.mac, c.url) : Promise.reject(new Error('no service'));
        return asked.then(function (r) {
            if (r && r.url) { return r.url; }
            U.log('iptv', 'Stalker: no link for “' + c.name + '” (' + ((r && r.why) || 'no answer') + ')');
            return '';
        }, function (e) { U.log('iptv', 'Stalker: no link for “' + c.name + '” (' + U.problem(e) + ')'); return ''; }).then(function (url) {
            if (!url && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(c.url)) { return []; }
            var st = plainStreams(c)[0];
            st.url = url || c.url;
            var h = U.sanitizeHeaders({ ua: STB_UA, ref: c.ref, cookie: c.cookie });
            if (h) { st._headers = h; }
            return [st];
        });
    }

    // A local addon object shaped like the HTTP addons in Stremio.loadAddons().
    // `__local` tells Stremio to route resource calls here instead of over HTTP.
    function synthAddon() {
        var d = _cache || build([]);
        return {
            __local: true, url: 'local:iptv', base: 'local:iptv',
            manifest: {
                id: 'org.stremiok.iptv', name: 'IPTV', version: '1.0.0',
                types: ['tv', 'radio', 'sport'], resources: ['catalog', 'meta', 'stream'],
                idPrefixes: ['iptv:'], catalogs: d.catalogs
            }
        };
    }

    return {
        getPlaylists: getPlaylists, addPlaylist: addPlaylist, updatePlaylist: updatePlaylist,
        removePlaylist: removePlaylist, renamePlaylist: renamePlaylist, setPlaylistOff: setPlaylistOff,
        movePlaylist: movePlaylist, setPlaylistGuide: setPlaylistGuide, label: labelOf,
        macOf: macOf, stbUa: STB_UA, stalkerPortal: stalkerPortal, stalkerCheck: stalkerCheck, addStalker: addStalker, isStalker: isStalker, stalkerAll: stalkerAll, setStalkerAll: setStalkerAll, stalkerGroups: stalkerGroups, setStalkerGroups: setStalkerGroups,
        canGroup: canGroup, playlistGroups: playlistGroups, setPlaylistGroups: setStalkerGroups, liveOnly: liveOnly, setLiveOnly: setLiveOnly,
        xtreamParts: xtreamParts, xtreamUrl: xtreamUrl, xtreamCheck: xtreamCheck, addXtream: addXtream, xtreamFormat: xtreamFormat, setXtreamFormat: setXtreamFormat,
        catchupStream: catchupStream, catchupDays: catchupDays, hasCatchup: hasCatchup, catchupTz: catchupTz, setCatchupTz: setCatchupTz,
        isFavorite: isFavorite, setFavorite: setFavorite, noteRecent: noteRecent, noteMeasured: noteMeasured, tidyCfg: tidyCfg, setTidy: setTidy, HIDE_SUGGESTED: HIDE_SUGGESTED, countryOf: countryOf, plainName: plainName, refreshEvery: refreshEvery, setRefreshEvery: setRefreshEvery, readAt: readAt,
        sizeMb: sizeMb, setSizeMb: setSizeMb, maxChannels: maxChannels, SIZES: SIZES,
        owns: owns, channels: function () { return _cache ? _cache.channels : []; }, channel: function (id) { return _cache ? _cache.byId[id] || null : null; }, isEnabled: isEnabled, reset: reset, status: status,
        load: load, reload: reload, catalog: catalog, meta: meta, zapGroups: zapGroups, zapping: zapping, streams: streams, synthAddon: synthAddon, isReady: isReady,
        onProgress: onProgress
    };
})();
