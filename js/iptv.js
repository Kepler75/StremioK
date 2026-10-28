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
    // A playlist is downloaded up to PLAYLIST_MAX and kept to MAX_CHANNELS channels: bigger
    // ones would exhaust an older TV's memory (both show in Settings > IPTV when they apply).
    var PLAYLIST_MAX = 20 * 1024 * 1024, MAX_CHANNELS = 30000;
    var _status = {};    // playlist id -> { url, count, groups, error, uncached, title, fetchedAt, stale }
    var NAME_MAX = 60;

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
        return u ? u.host : 'Playlist';
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

    function updatePlaylist(id, url) {
        url = checkedUrl(url);
        if (!url) { return false; }
        var list = getPlaylists(), changed = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) { changed = list[i].url !== url; list[i].url = url; break; }
        }
        if (!changed) { return false; }
        U.bigStore.remove(CACHE_PREFIX + id);
        savePlaylists(list);
        return true;
    }

    function removePlaylist(id) {
        var list = getPlaylists().filter(function (p) { return p.id !== id; });
        U.bigStore.remove(CACHE_PREFIX + id);
        delete _status[id];
        savePlaylists(list);
    }

    function isEnabled() { return getPlaylists().some(function (p) { return !p.off; }); }
    // The playlists' revision: changed (added, edited, removed, switched off, moved, reloaded),
    // a load still under way for the old ones keeps nothing, and they're read as they are now.
    var _rev = 0, _pending = null, _ytEnds = {};   // (_ytEnds: Xtream link -> where it led, youTubeEnd)
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
    // A header a playlist gives a channel, by name: its User-Agent or Referer (the only two the
    // TV's player takes: any other is left out). Checked when played (U.sanitizeHeaders).
    function headerInto(c, name, value) {
        var n = ('' + name).trim().toLowerCase(), v = ('' + (value || '')).trim();
        if (!v) { return; }
        if (n === 'user-agent') { c.ua = v; } else if (n === 'referer' || n === 'referrer') { c.ref = v; }
    }

    function truthy(v) { return /^(?:1|true|yes)$/i.test(('' + (v || '')).trim()); }

    function audioUrl(u) {
        return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)(?:[?#]|$)/i.test(u || '');
    }

    // Returns [{ id, type, name, logo, group, tvgId, ua, ref, url, _yt }]
    // The M3U reader, a line at a time (so a big playlist can be read in chunks, see
    // parseM3UAsync). max: channels kept; any beyond are only counted (dropped). guides: the TV
    // guides it names (url-tvg / x-tvg-url / tvg-url, several split by commas).
    function m3uReader(max) {
        var r = { channels: [], dropped: 0, title: '', guides: [] }, cur = null, seen = {};
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
            if (!r.title && s.indexOf('#EXTM3U') === 0) {   // the playlist's own name, if it has one
                r.title = attr(s, /(?:^|\s)(?:x-playlist-name|playlist-name|x-tvg-name)="([^"]{1,200})"/i).trim().slice(0, NAME_MAX);
            } else if (!r.title && s.indexOf('#PLAYLIST:') === 0) {
                r.title = s.slice(10).trim().slice(0, NAME_MAX);
            }
            if (s.indexOf('#EXTINF') === 0) {
                var group = attr(s, /group-title="([^"]*)"/i);
                var kind = attr(s, /tvg-type="([^"]*)"/i);
                cur = {
                    name: (s.slice(s.lastIndexOf(',') + 1).trim()) || 'Channel',
                    logo: attr(s, /tvg-logo="([^"]*)"/i),
                    group: group,
                    tvgId: attr(s, /tvg-id="([^"]*)"/i),
                    ua: attr(s, /http-user-agent="([^"]*)"/i),
                    ref: attr(s, /http-referr?er="([^"]*)"/i),   // (both spellings)
                    radio: truthy(attr(s, /(?:^|\s)radio="([^"]*)"/i)) || /^radio$/i.test(kind),
                    sport: /^sports?$/i.test(kind),   // (StremioK's own mark: the Sports tab)
                    url: ''
                };
                if (/^guide$/i.test(kind)) {   // (StremioK's own mark: a channel watched elsewhere, kept for its TV guide alone; a link after it is ignored)
                    if (max && r.channels.length >= max) { r.dropped++; cur = null; return; }
                    cur.guideOnly = true; cur.radio = false; cur.type = 'tv';
                    if (!cur.group) { cur.group = 'TV guide'; }
                    add(cur);
                    cur = null;
                }
            } else if (/^#EXTVLCOPT:http-(user-agent|referr?er)=/i.test(s)) {   // (http-referer: the one-r spelling too)
                if (cur) { var opt = /^#EXTVLCOPT:http-(user-agent|referr?er)=(.*)$/i.exec(s); headerInto(cur, opt[1], opt[2]); }
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
                        add(cur);
                    }
                    cur = null;
                }
            }
        };
        return r;
    }
    function parseM3U(text) {
        var r = m3uReader(0), lines = ('' + text).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) { r.line(lines[i]); }
        return r.channels;
    }
    // The same, PARSE_CHUNK lines at a time with a pause between (the remote stays
    // responsive while a 20 MB playlist is read); onProgress(channels so far). Resolves
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
    function isFavorite(id) { return favs().indexOf(id) !== -1; }
    function setFavorite(id, on) {
        var f = favs().filter(function (x) { return x !== id; });
        if (on) { f.unshift(id); }
        U.store.set(FAV_KEY, f.slice(0, FAV_MAX));
        if (_cache) { favCatalog(_cache); }
        return true;
    }
    // The Favorites catalog, first in the list, while there are favorites among the channels read
    // (changed in place: the IPTV addon's manifest holds the same list).
    function favCatalog(d) {
        var at = -1;
        for (var i = 0; i < d.catalogs.length; i++) { if (d.catalogs[i].id === FAV_CAT) { at = i; } }
        var any = favs().some(function (id) { return !!d.byId[id]; });
        if (any && at === -1) { d.catalogs.unshift({ type: 'tv', id: FAV_CAT, name: '★ Favorites', extra: [{ name: 'search' }], _favs: true, _first: true }); }
        if (!any && at !== -1) { d.catalogs.splice(at, 1); }
    }
    function build(channels) {
        var groups = [], byGroup = {}, byId = {};
        channels.forEach(function (c) {
            byId[c.id] = c;
            if (c.guideOnly) { return; }   // (its TV guide alone: the Guide tab, no row)
            var key = c.type + '|' + c.group;
            if (!byGroup[key]) { byGroup[key] = []; groups.push({ type: c.type, name: c.group }); }
            byGroup[key].push(c);
        });
        var catalogs = groups.map(function (g) {
            var prefix = g.type === 'radio' ? 'iptv_radio_' : g.type === 'sport' ? 'iptv_sport_' : 'iptv_';
            return { type: g.type, id: prefix + idOf(g.name, g.type + '|' + g.name), name: g.name,
                extra: [{ name: 'search' }], _group: g.name };
        });
        var d = { ts: Date.now(), channels: channels, groups: groups, byId: byId, byGroup: byGroup, catalogs: catalogs };
        favCatalog(d);
        return d;
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
            U.log('iptv', 'Playlist “' + label(playlist) + '” is downloaded over unencrypted http:// — anyone on the network path can see or change it (and any username / password in its link)');
        }

        function finish(text, at) {
            st.fetchedAt = at || 0;
            return parseM3UAsync(text, MAX_CHANNELS, function (n) { progress(playlist.id, n); }).then(function (r) {
                if (r.dropped) { st.dropped = r.dropped; }   // (kept to what the TV can hold; the rest dropped, and said so)
                st.title = r.title || '';
                st.guides = r.guides || [];
                _sources = null;
                return counted(tagChannels(r.channels, playlist.id));
            });
        }
        function counted(channels) {
            var groups = {};
            channels.forEach(function (c) { groups[c.type + '|' + c.group] = 1; });
            st.count = channels.length;
            st.groups = Object.keys(groups).length;
            if (!channels.length && !st.error) {
                st.error = 'No channels parsed (is the URL returning the .m3u file?)';
            }
            return channels;
        }

        var saved = force ? Promise.resolve(null) : readPersist(playlist.id);
        return saved.then(function (p) {
            if (p && p.url === playlist.url && typeof p.text === 'string') { return finish(p.text, p.at); }
            return fetchIt();
        });
        function fetchIt() {
            return U.getText(playlist.url, 15000, PLAYLIST_MAX).then(function (text) {
                var at = Date.now();
                return writePersist(playlist.id, playlist.url, text, at).then(function (ok) {
                    st.uncached = !ok;
                    return finish(text, at);
                });
            }, function (e) {
                var msg = (e && e.message) ? e.message : 'Could not fetch the playlist URL';
                // status 0 / network error on a URL that opens fine in a browser almost
                // always means the server sent no Access-Control-Allow-Origin header.
                if (/HTTP 0\b/.test(msg) || /Network error|^No answer/i.test(msg)) {
                    msg += ' — the playlist server likely isn\'t sending an ' +
                        'Access-Control-Allow-Origin header (CORS). Serve the .m3u with CORS enabled.';
                }
                st.error = msg;
                // Fall back to this playlist's saved copy so a failed refresh doesn't wipe it.
                return readPersist(playlist.id).then(function (prev) {
                    if (!(prev && prev.url === playlist.url && typeof prev.text === 'string')) { return []; }
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
            _cache = build(channels);
            if (typeof EPG !== 'undefined' && EPG.start) { setTimeout(EPG.start, 0); }   // (their TV guides: see js/epg.js)
            return _cache;
        });
        _pending = { rev: rev, p: pr };
        return pr;
    }

    function sameKey(c) {
        var p = U.parseUrl(c.url);   // (scheme and host in lower case)
        return [p ? p.href : c.url, c.name, c.group, c.type, c.ua || '', c.ref || ''].join('\u0001');
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
            posterShape: 'landscape', description: c.group + (sourceOf(c) ? '  ·  from ' + sourceOf(c) : '')
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
            var list = cat._favs ? favs().map(function (id) { return d.byId[id]; }).filter(Boolean) : (d.byGroup[cat.type + '|' + cat._group] || []);
            list.forEach(function (c) {
                if (q && c.name.toLowerCase().indexOf(q) === -1) { return; }
                out.push(toMeta(c));
            });
            // Discover pages through a group 100 channels at a time (Home takes them all)
            if (extra && extra.skip != null) { var sk = parseInt(extra.skip, 10) || 0; return out.slice(sk, sk + 100); }
            return out;
        });
    }

    function meta(id) {
        return load().then(function (d) { var c = d.byId[id]; return c ? toMeta(c) : null; });
    }

    // An Xtream channel's link (…/live/user/pass/id.ext) can lead anywhere, YouTube among them
    // (a provider's "Alt" channel): looked at (redirects followed, its headers only: the answer
    // isn't read), within YT_PROBE_MS. Resolves the YouTube page it ends on, or ''. Where it led
    // is kept YT_KEEP_MS, or until the playlists reload (reset): a server can renumber its
    // channels, and the same link then leads somewhere else.
    var XTREAM_LIVE = /^https?:\/\/[^\/]+(?:\/[^?#]*)?\/live\/[^\/?#]+\/[^\/?#]+\/\d+(?:\.[a-z0-9]{2,4})?(?:[?#]|$)/i, YT_PROBE_MS = 4000, YT_KEEP_MS = 5 * 60000;
    function isYouTube(u) { return /^https?:\/\/(?:[^\/]+\.)?youtube\.com(?::\d+)?(?:\/|$)/i.test(u) || /^https?:\/\/youtu\.be(?::\d+)?(?:\/|$)/i.test(u); }
    function youTubeEnd(url) {
        if (!XTREAM_LIVE.test(url)) { return Promise.resolve(''); }
        var kept = Object.prototype.hasOwnProperty.call(_ytEnds, url) ? _ytEnds[url] : null;
        if (kept && Date.now() - kept.at < YT_KEEP_MS) { return Promise.resolve(kept.page); }
        return new Promise(function (resolve) {
            var x = null, done = false;
            function end(page) { if (done) { return; } done = true; clearTimeout(t); try { x.abort(); } catch (e) {} _ytEnds[url] = { page: page, at: Date.now() }; resolve(page); }
            var t = setTimeout(function () { done = true; try { x.abort(); } catch (e) {} resolve(''); }, YT_PROBE_MS);   // (not remembered: asked again next time)
            try {
                x = new XMLHttpRequest();
                x.open('GET', url, true);
                x.onreadystatechange = function () {
                    if (x.readyState < 2) { return; }
                    var to = '' + (x.responseURL || '');
                    end(isYouTube(to) ? to : '');
                };
                x.onerror = function () { end(''); };
                x.send();
            } catch (e) { end(''); }
        });
    }
    function streams(id) {
        return load().then(function (d) {
            var c = d.byId[id];
            if (!c || c.guideOnly) { return []; }
            if (c._yt) {
                return [{ url: c.url, _yt: true, ytPage: c.url, name: c.name, title: 'YouTube · ' + c.group }];
            }
            return youTubeEnd(c.url).then(function (page) {
                if (page) { return [{ url: page, _yt: true, ytPage: page, name: c.name, title: 'YouTube · ' + c.group }]; }
                return plainStreams(c);
            });
        });
    }
    function plainStreams(c) {
        var from = sourceOf(c);
        var st = { url: c.url, name: c.name, title: 'IPTV · ' + c.group + (from ? ' · ' + from : '') };
        var h = U.sanitizeHeaders({ ua: c.ua, ref: c.ref });   // (only what the player takes, checked)
        if (h) { st._headers = h; }
        return [st];
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
        xtreamParts: xtreamParts, xtreamUrl: xtreamUrl, xtreamCheck: xtreamCheck, addXtream: addXtream, xtreamFormat: xtreamFormat, setXtreamFormat: setXtreamFormat,
        isFavorite: isFavorite, setFavorite: setFavorite, refreshEvery: refreshEvery, setRefreshEvery: setRefreshEvery, readAt: readAt,
        channels: function () { return _cache ? _cache.channels : []; }, channel: function (id) { return _cache ? _cache.byId[id] || null : null; }, isEnabled: isEnabled, reset: reset, status: status,
        load: load, reload: reload, catalog: catalog, meta: meta, streams: streams, synthAddon: synthAddon, isReady: isReady,
        onProgress: onProgress
    };
})();
