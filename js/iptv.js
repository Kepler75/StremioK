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
    var _rev = 0, _pending = null;
    function reset() { _cache = null; _rev++; }

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

    function truthy(v) { return /^(?:1|true|yes)$/i.test(('' + (v || '')).trim()); }

    function audioUrl(u) {
        return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)(?:[?#]|$)/i.test(u || '');
    }

    // Returns [{ id, type, name, logo, group, tvgId, ua, ref, url, _yt }]
    // The M3U reader, a line at a time (so a big playlist can be read in chunks, see
    // parseM3UAsync). max: channels kept; any beyond are only counted (dropped).
    function m3uReader(max) {
        var r = { channels: [], dropped: 0, title: '' }, cur = null, seen = {};
        r.line = function (raw) {
            var s = raw.replace(/^\s+/, '');
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
                    ref: attr(s, /http-referrer="([^"]*)"/i),
                    radio: truthy(attr(s, /(?:^|\s)radio="([^"]*)"/i)) || /^radio$/i.test(kind),
                    sport: /^sports?$/i.test(kind),   // (StremioK's own mark: the Sports tab)
                    url: ''
                };
            } else if (s.indexOf('#EXTVLCOPT:http-user-agent=') === 0) {
                if (cur) { cur.ua = s.slice('#EXTVLCOPT:http-user-agent='.length).trim(); }
            } else if (s.indexOf('#EXTVLCOPT:http-referrer=') === 0) {
                if (cur) { cur.ref = s.slice('#EXTVLCOPT:http-referrer='.length).trim(); }
            } else if (s && s.charAt(0) !== '#') {
                if (cur) {
                    var u = s.trim();
                    if (/^https?:\/\//i.test(u)) {
                        if (max && r.channels.length >= max) { r.dropped++; cur = null; return; }
                        cur.url = u;
                        cur.radio = !cur.sport && (cur.radio || /\bradio\b/i.test(cur.group) || audioUrl(u));
                        cur.type = cur.sport ? 'sport' : cur.radio ? 'radio' : 'tv';
                        if (!cur.group) { cur.group = cur.sport ? 'Sports' : cur.radio ? 'Live Radio' : 'Live TV'; }
                        cur._yt =
                            /^https?:\/\/(?:[^\/]+\.)?youtube\.com(?::\d+)?(?:\/|$)/i.test(u) ||
                            /^https?:\/\/youtu\.be(?::\d+)?(?:\/|$)/i.test(u);
                        var base = 'iptv:' + idOf(cur.tvgId || cur.name);
                        var id = base, n = 2;
                        while (seen[id]) { id = base + '-' + n; n++; }
                        seen[id] = 1; cur.id = id;
                        r.channels.push(cur);
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

    function build(channels) {
        var groups = [], byGroup = {}, byId = {};
        channels.forEach(function (c) {
            byId[c.id] = c;
            var key = c.type + '|' + c.group;
            if (!byGroup[key]) { byGroup[key] = []; groups.push({ type: c.type, name: c.group }); }
            byGroup[key].push(c);
        });
        var catalogs = groups.map(function (g) {
            var prefix = g.type === 'radio' ? 'iptv_radio_' : g.type === 'sport' ? 'iptv_sport_' : 'iptv_';
            return { type: g.type, id: prefix + idOf(g.name, g.type + '|' + g.name), name: g.name,
                extra: [{ name: 'search' }], _group: g.name };
        });
        return { ts: Date.now(), channels: channels, groups: groups, byId: byId, byGroup: byGroup, catalogs: catalogs };
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
                if (/HTTP 0\b/.test(msg) || /Network error/i.test(msg)) {
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
        if (!playlists.length) { _cache = build([]); return Promise.resolve(_cache); }
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
            return _cache;
        });
        _pending = { rev: rev, p: pr };
        return pr;
    }

    function sameKey(c) {
        var p = U.parseUrl(c.url);   // (scheme and host in lower case)
        return [p ? p.href : c.url, c.name, c.group, c.type, c.ua || '', c.ref || ''].join('\u0001');
    }

    function reload(id) { reset(); return load(id || true); }
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
            (d.byGroup[cat.type + '|' + cat._group] || []).forEach(function (c) {
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

    function streams(id) {
        return load().then(function (d) {
            var c = d.byId[id];
            if (!c) { return []; }
            if (c._yt) {
                return [{ url: c.url, _yt: true, ytPage: c.url, name: c.name, title: 'YouTube · ' + c.group }];
            }
            var from = sourceOf(c);
            var st = { url: c.url, name: c.name, title: 'IPTV · ' + c.group + (from ? ' · ' + from : '') };
            var h = U.sanitizeHeaders({ ua: c.ua, ref: c.ref });   // (only what the player takes, checked)
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
        movePlaylist: movePlaylist, label: labelOf, isEnabled: isEnabled, reset: reset, status: status,
        load: load, reload: reload, catalog: catalog, meta: meta, streams: streams, synthAddon: synthAddon, isReady: isReady,
        onProgress: onProgress
    };
})();
