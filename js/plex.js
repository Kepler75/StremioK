/* Plex servers: yours, or ones shared with you. Global namespace: Plex
   - Added in Settings › Content › Media servers: a code you enter at plex.tv/link (plex.tv's
     PIN sign-in), then one of the account's servers. Its connections are tried, the ones on your
     network first (never Plex's relay), and the first that answers is kept, with that server's own
     sign-in (its access token). What's kept: its address, name and version, the account's name and
     that sign-in.
   - Like Jellyfin and Emby (js/jellyfin.js: what's shared, the player's side too), as a local
     addon ("Plex"): a catalog per Movies or Shows library, Continue watching and Next up (its On
     Deck); a title the server knows the IMDb id of is a card with that id, any other
     pxm.<server>.<item> (a film) or pxs.<server>.<show> (its episodes …:<season>:<episode>).
   - On titles from your addons (tt…, tmdb:…), the server's copies as sources: its titles and
     their ids, read when first needed and again after INDEX_FRESH_MS.
   - Played as the file is (a part's own link: nothing converted), its SRT / VTT files with it;
     what you play goes back to Plex (/:/timeline; watched: /:/scrobble), except during private
     viewing. Sources carry _jf (kind 'plex'), as a Jellyfin one does: place, chapters, markers,
     seek pictures. */
var Plex = (function () {
    'use strict';

    var KEY = 'stremiok.plex.servers', DEV_KEY = 'stremiok.plex.device', LIBS_KEY = 'stremiok.plex.libs';
    var TV = 'https://clients.plex.tv', LINK = 'https://plex.tv/link';
    var PAGE = 100, INDEX_FRESH_MS = 30 * 60000, INDEX_RETRY_MS = 60000, LIBS_FRESH_MS = 86400000;
    var PIN_EVERY = 3000, PIN_FOR = 10 * 60000, REPORT_EVERY = 60000, PIC_EVERY = 5000;
    var _changeFns = [];
    function onChange(fn) { _changeFns.push(fn); }
    function changed() { _changeFns.forEach(function (fn) { try { fn(); } catch (e) {} }); }
    function enc(v) { return encodeURIComponent('' + v); }
    function rand(n) { return U.randomHex(n); }   // (the TV's secure random numbers)
    function none() { return []; }
    function flat(lists) { return [].concat.apply([], lists || []); }
    function clean(v, max) { return ('' + (v == null ? '' : v)).replace(/\s+/g, ' ').trim().slice(0, max || 60); }
    function mc(r) { return (r && r.MediaContainer) || {}; }   // (every Plex answer is in one)

    // ---- Your servers ----
    function servers() {
        var l = U.store.get(KEY, []);
        return Array.isArray(l) ? l.filter(function (s) { return s && s.id && s.url && s.token && s.machineId; }) : [];
    }
    function server(id) { return servers().filter(function (s) { return s.id === id; })[0] || null; }
    function isEnabled() { return servers().length > 0; }
    function deviceId() {
        var d = U.store.get(DEV_KEY, '');
        if (!/^[0-9a-f]{16,40}$/.test('' + d)) { d = rand(32); U.store.set(DEV_KEY, d); }
        return d;
    }
    function version() {   // (StremioK's, from the ?v= build.sh stamps on the script tags)
        try {
            var tag = document.querySelector('script[src*="plex.js"]');
            var m = tag && /[?&]v=([0-9][0-9.]*)/.exec(tag.getAttribute('src') || '');
            if (m) { return m[1]; }
        } catch (e) {}
        return '2';
    }
    // Who's asking (StremioK, this TV) and, signed in, its token; answers as JSON.
    function headers(token) {
        var h = { 'Accept': 'application/json', 'X-Plex-Product': 'StremioK', 'X-Plex-Version': version(), 'X-Plex-Client-Identifier': deviceId(),
            'X-Plex-Platform': 'Tizen', 'X-Plex-Device': 'Samsung TV', 'X-Plex-Device-Name': 'StremioK (Samsung TV)' };
        if (token) { h['X-Plex-Token'] = token; }
        return h;
    }
    function get(srv, path, max) { return U.getJSON(srv.url + path, 20000, max || 4 * 1048576, null, headers(srv.token)); }
    function tell(srv, path) { return U.getText(srv.url + path, 15000, 65536, null, true, headers(srv.token)); }
    function linkOf(srv, path) { return srv.url + path + (path.indexOf('?') === -1 ? '?' : '&') + 'X-Plex-Token=' + enc(srv.token); }

    // ---- Signing in: plex.tv's code, then the account's servers ----
    // cb: onCode(code, link), onServers([{ name, owned, … }]: pick one, then add()), onError(message).
    // Returns a stop.
    function link(cb) {
        var stopped = false, timer = null, t0 = Date.now();
        function fail(msg) { if (!stopped) { stopped = true; cb.onError(msg); } }
        U.getJSON(TV + '/api/v2/pins?strong=false', 15000, 65536, null, headers(''), '').then(function (pin) {
            if (!pin || !pin.id || !pin.code) { throw new Error('no code'); }
            if (stopped) { return; }
            cb.onCode(clean(pin.code, 12), LINK);
            function poll() {
                timer = setTimeout(function () {
                    if (stopped) { return; }
                    if (Date.now() - t0 > PIN_FOR) { fail('The code ran out: start again.'); return; }
                    U.getJSON(TV + '/api/v2/pins/' + enc(pin.id), 10000, 65536, null, headers(''), null, true).then(function (p) {
                        if (stopped) { return; }
                        if (!p || !p.authToken) { poll(); return; }
                        stopped = true;
                        accountServers('' + p.authToken).then(function (list) {
                            if (!list.length) { cb.onError('Your Plex account has no servers.'); return; }
                            cb.onServers(list);
                        }, function (e) { cb.onError('Couldn’t list your Plex servers (' + U.problem(e) + ').'); });
                    }, function (e) {
                        if (/HTTP 404/.test(e && e.message)) { fail('The code ran out: start again.'); } else { poll(); }
                    });
                }, PIN_EVERY);
            }
            poll();
        }).then(null, function (e) { fail('Couldn’t get a code from Plex (' + U.problem(e) + ').'); });
        return function () { stopped = true; clearTimeout(timer); };
    }
    // The account's servers (plex.tv's resources), each with its connections and its own token.
    function accountServers(token) {
        return Promise.all([
            U.getJSON(TV + '/api/v2/resources?includeHttps=1&includeRelay=0&includeIPv6=0', 15000, 2 * 1048576, null, headers(token)),
            U.getJSON(TV + '/api/v2/user', 15000, 262144, null, headers(token)).then(null, function () { return null; })
        ]).then(function (r) {
            var user = r[1] ? clean(r[1].username || r[1].title || '') : '';
            return U.listOf(r[0], 50, function (x) { return x && /(^|,)server(,|$)/.test('' + x.provides) && x.clientIdentifier; }).map(function (x) {
                return { machineId: '' + x.clientIdentifier, name: clean(x.name) || 'Plex', version: clean(x.productVersion, 20), owned: !!x.owned,
                    token: '' + (x.accessToken || token), user: user, connections: U.listOf(x.connections, 20) };
            });
        });
    }
    // The links to try, in order: on your network (its plain http address first: plex.direct's
    // names need DNS that some routers block), then from the internet; never a relay.
    function candidates(res) {
        var out = [];
        function add(u) { u = ('' + (u || '')).replace(/\/+$/, ''); if (/^https?:\/\/[^\/]+$/i.test(u) && out.indexOf(u) === -1) { out.push(u); } }
        [true, false].forEach(function (local) {
            res.connections.forEach(function (c) {
                if (!c || c.relay || !!c.local !== local) { return; }
                if (local && c.address && /^[\d.]+$/.test('' + c.address) && c.port) { add('http://' + c.address + ':' + c.port); }
                add(c.uri);
            });
        });
        return out;
    }
    // Adds one of onServers' list: its first link that answers as that server, kept.
    function add(res) {
        var list = candidates(res), tried = [];
        function next(i) {
            if (i >= list.length) { return Promise.reject(new Error('No address of “' + res.name + '” answered' + (tried.length ? ' (' + tried.join(', ') + ')' : '') + '.')); }
            return U.getJSON(list[i] + '/identity', 6000, 65536, null, { 'Accept': 'application/json' }, null, true).then(function (r) {
                if (('' + mc(r).machineIdentifier) !== res.machineId) { throw new Error('another server'); }
                return list[i];
            }).then(null, function (e) { tried.push(list[i]); U.log('plex', '“' + res.name + '” didn’t answer at ' + list[i] + ' (' + U.problem(e) + ')'); return next(i + 1); });
        }
        return next(0).then(function (url) {
            var all = servers(), old = all.filter(function (s) { return s.machineId === res.machineId; })[0];
            var srv = { id: old ? old.id : 'p' + rand(8), kind: 'plex', url: url, machineId: res.machineId, name: res.name, version: res.version,
                user: res.user, owned: res.owned, token: res.token, at: Date.now() };
            all = all.filter(function (s) { return s !== old; });
            all.push(srv);
            U.store.set(KEY, all);
            forget(srv.id);
            U.log('plex', 'Signed in to “' + srv.name + '” (Plex ' + srv.version + ')' + (srv.user ? ' as ' + srv.user : ''));
            return refreshLibs(true, srv.id).then(function () { changed(); return srv; });
        });
    }
    function remove(id) {
        if (!server(id)) { return; }
        U.store.set(KEY, servers().filter(function (s) { return s.id !== id; }));
        var libs = libsAll();
        delete libs[id];
        U.store.set(LIBS_KEY, libs);
        forget(id);
        fillCatalogs();
        changed();
    }
    function reload(id) {
        if (!server(id)) { return; }
        forget(id);
        delete _libsAsked[id];
        refreshLibs(true, id);
    }
    function forget(id) {
        delete _index[id];
        _items.clear(); _eps.clear();
    }

    // ---- Libraries: the catalogs, kept a day (U.store) so Home has its rows at launch ----
    var _libs = null, _libsAsked = {};
    function libsAll() {
        if (!_libs) { var l = U.store.get(LIBS_KEY, {}); _libs = l && typeof l === 'object' && !Array.isArray(l) ? l : {}; }
        return _libs;
    }
    function libsOf(srv) { var l = libsAll()[srv.id]; return l && Array.isArray(l.list) ? l.list : []; }
    function refreshLibs(force, only) {
        return Promise.all(servers().map(function (srv) {
            if (only && srv.id !== only) { return null; }
            var l = libsAll()[srv.id];
            if (!force && ((l && Date.now() - l.at < LIBS_FRESH_MS) || _libsAsked[srv.id])) { return null; }
            _libsAsked[srv.id] = true;
            return get(srv, '/library/sections').then(function (r) {
                var list = U.listOf(mc(r).Directory, 50, function (x) { return x.key != null && (x.type === 'movie' || x.type === 'show'); }).map(function (x) {
                    return { id: clean(x.key, 20), name: clean(x.title) || (x.type === 'movie' ? 'Movies' : 'Shows'), type: x.type === 'movie' ? 'movie' : 'series' };
                });
                if (!server(srv.id)) { return; }
                var all = libsAll(), keep = {}, before = JSON.stringify(all[srv.id] && all[srv.id].list);
                servers().forEach(function (s) { if (all[s.id]) { keep[s.id] = all[s.id]; } });
                keep[srv.id] = { at: Date.now(), list: list };
                _libs = keep;
                U.store.set(LIBS_KEY, keep);
                fillCatalogs();
                if (JSON.stringify(list) !== before || force) { changed(); }
            }, function (e) { U.log('plex', '“' + srv.name + '”: its libraries couldn’t be read (' + U.problem(e) + ')'); });
        }));
    }

    // ---- The addon ("Plex": its rows say so, Source ranking lists it) ----
    var _addon = null;
    var RESOURCES = ['catalog', { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }];
    function catalogsNow() {
        var out = [], many = servers().length > 1;
        servers().forEach(function (srv) {
            var libs = libsOf(srv), on = many ? ' · ' + srv.name : '';
            if (!libs.length) { return; }
            if (libs.some(function (l) { return l.type === 'movie'; })) { out.push({ type: 'movie', id: 'px.' + srv.id + '.resume', name: 'Continue watching' + on, extra: [] }); }
            if (libs.some(function (l) { return l.type === 'series'; })) { out.push({ type: 'series', id: 'px.' + srv.id + '.nextup', name: 'Next up' + on, extra: [] }); }
            libs.forEach(function (lib) {
                out.push({ type: lib.type, id: 'px.' + srv.id + '.' + lib.id, name: lib.name + on, extra: [{ name: 'search' }, { name: 'skip' }] });
            });
        });
        return out;
    }
    function fillCatalogs() {
        if (!_addon) { return; }
        var l = _addon.manifest.catalogs;
        l.splice.apply(l, [0, l.length].concat(catalogsNow()));
        _addon.manifest.resources = isEnabled() ? RESOURCES : ['catalog'];
    }
    function synthAddon() {
        if (!_addon) {
            _addon = { __local: true, __sources: true, url: 'local:plex', base: 'local:plex',
                __impl: { catalog: catalog, meta: meta, streams: streams },
                manifest: { id: 'org.stremiok.plex', name: 'Plex', version: '1.0.0', types: ['movie', 'series'], resources: RESOURCES, catalogs: [] } };
        }
        fillCatalogs();
        refreshLibs(false);
        return _addon;
    }
    function synthAddons() { return isEnabled() ? [synthAddon()] : []; }

    // ---- Titles ----
    // Its ids: includeGuids' list (imdb://tt…, tmdb://…), or an older agent's guid
    // (com.plexapp.agents.imdb://tt…?lang=en, …themoviedb://…).
    function guids(it) {
        var l = U.listOf(it && it.Guid, 20).map(function (g) { return '' + (g && g.id); });
        if (it && it.guid) { l.push('' + it.guid); }
        return l;
    }
    function imdbOf(it) {
        var m = null;
        guids(it).some(function (g) { m = /(?:^imdb|agents\.imdb):\/\/(tt\d{5,10})/.exec(g); return !!m; });
        return m ? m[1] : '';
    }
    function tmdbOf(it) {
        var m = null;
        guids(it).some(function (g) { m = /(?:^tmdb|agents\.themoviedb):\/\/(\d{1,10})(?:\D|$)/.exec(g); return !!m; });
        return m ? m[1] : '';
    }
    function img(srv, path, w, h) {
        if (!path) { return ''; }
        if (/^https?:\/\//i.test(path)) { return '' + path; }
        return linkOf(srv, '/photo/:/transcode?width=' + w + '&height=' + h + '&minSize=1&upscale=1&url=' + enc(path));
    }
    function cardOf(srv, type, it) {
        if (!it || it.ratingKey == null || !it.title) { return null; }
        var tt = imdbOf(it);
        var m = { id: tt || ((type === 'movie' ? 'pxm.' : 'pxs.') + srv.id + '.' + it.ratingKey), type: type, name: clean(it.title, 200), posterShape: 'poster' };
        if (it.thumb) { m.poster = img(srv, it.thumb, 300, 450); }
        if (it.art) { m.background = img(srv, it.art, 1280, 720); }
        if (+it.year > 1880) { m.releaseInfo = '' + it.year; }
        var r = parseFloat(it.audienceRating || it.rating);
        if (r > 0 && r <= 10) { m.imdbRating = r.toFixed(1); }
        return m;
    }
    // On Deck: films part-watched (Continue watching), and a show's next episode or the one
    // part-watched (Next up: its card opens at that episode, _openEp).
    function onDeck(srv) {
        return get(srv, '/library/onDeck?includeGuids=1').then(null, function () { return get(srv, '/hubs/continueWatching/items?includeGuids=1'); }).then(function (r) {
            return U.listOf(mc(r).Metadata, 100);
        });
    }
    function resumeCards(srv) {
        return onDeck(srv).then(function (l) {
            return l.filter(function (it) { return it.type === 'movie'; }).slice(0, 50).map(function (it) { return cardOf(srv, 'movie', it); }).filter(Boolean);
        });
    }
    function nextUpCards(srv) {
        return Promise.all([onDeck(srv), index(srv)]).then(function (r) {
            var seen = {};
            return r[0].filter(function (e) { return e.type === 'episode' && e.grandparentRatingKey != null && e.parentIndex >= 0 && e.index >= 0; }).map(function (e) {
                var sid = '' + e.grandparentRatingKey, show = (r[1].__ids || {})[sid] || ('pxs.' + srv.id + '.' + sid);
                if (seen[show]) { return null; }
                seen[show] = 1;
                var m = { id: show, type: 'series', name: clean(e.grandparentTitle || e.title, 200), posterShape: 'poster',
                    _openEp: show + ':' + e.parentIndex + ':' + e.index, _ep: 'S' + e.parentIndex + 'E' + e.index };
                if (e.grandparentThumb) { m.poster = img(srv, e.grandparentThumb, 300, 450); }
                if (e.grandparentArt || e.art) { m.background = img(srv, e.grandparentArt || e.art, 1280, 720); }
                return m.name ? m : null;
            }).filter(Boolean).slice(0, 50);
        });
    }
    function catalog(catId, extra) {
        var m = /^px\.([^.]+)\.([^.]+)$/.exec(catId || ''), srv = m && server(m[1]);
        if (srv && m[2] === 'resume') { return resumeCards(srv); }
        if (srv && m[2] === 'nextup') { return nextUpCards(srv); }
        var lib = srv && libsOf(srv).filter(function (l) { return l.id === m[2]; })[0];
        if (!lib) { return Promise.resolve([]); }
        var skip = extra && extra.skip ? (parseInt(extra.skip, 10) || 0) : 0, term = extra && extra.search ? ('' + extra.search).slice(0, 120) : '';
        var path = '/library/sections/' + enc(lib.id) + '/all?type=' + (lib.type === 'movie' ? 1 : 2) + '&includeGuids=1' +
            (term ? '&title=' + enc(term) + '&sort=titleSort' : '&sort=addedAt:desc') + '&X-Plex-Container-Start=' + skip + '&X-Plex-Container-Size=' + PAGE;
        return get(srv, path).then(function (r) {
            return U.listOf(mc(r).Metadata, PAGE).map(function (it) { return cardOf(srv, lib.type, it); }).filter(Boolean);
        });
    }
    var _items = U.lru(40), _eps = U.lru(20);
    function kept(cache, k, make) {
        var p = cache.get(k);
        if (p) { return p; }
        p = make();
        cache.set(k, p);
        p.then(null, function () { if (cache.get(k) === p) { cache.set(k, null); } });
        return p;
    }
    // A film, show or episode in full: its versions and their streams, markers and chapters.
    function item(srv, rk) {
        return kept(_items, srv.id + '|' + rk, function () {
            return get(srv, '/library/metadata/' + enc(rk) + '?includeGuids=1&includeMarkers=1&includeChapters=1').then(function (r) { return U.listOf(mc(r).Metadata, 1)[0] || null; });
        });
    }
    // A show's episodes: [{ season, episode, it }] (it: as listed, without its streams).
    function episodes(srv, sid) {
        return kept(_eps, srv.id + '|' + sid, function () {
            return get(srv, '/library/metadata/' + enc(sid) + '/allLeaves', 16 * 1048576).then(function (r) {
                return U.listOf(mc(r).Metadata, 5000, function (e) { return e.ratingKey != null && e.parentIndex >= 0 && e.index >= 0; }).map(function (e) {
                    return { season: +e.parentIndex, episode: +e.index, it: e };
                }).sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
            });
        });
    }
    function parseId(id) {
        var m = /^px([ms])\.([^.]+)\.(\d{1,12})(?::(\d+):(\d+))?$/.exec('' + id);
        return m ? { kind: m[1], srv: server(m[2]), item: m[3], season: m[4] != null ? +m[4] : null, episode: m[5] != null ? +m[5] : null } : null;
    }
    function tags(l) { return U.listOf(l, 200, function (t) { return t && t.tag; }).slice(0, 12).map(function (t) { return clean(t.tag, 80); }); }
    function meta(type, id) {
        var x = parseId(id);
        if (!x || !x.srv) { return Promise.resolve(null); }
        var srv = x.srv, t = x.kind === 'm' ? 'movie' : 'series';
        return item(srv, x.item).then(function (it) {
            if (!it || !it.title) { return null; }
            var showId = 'px' + x.kind + '.' + srv.id + '.' + it.ratingKey, m = cardOf(srv, t, it);
            m.id = showId; m._from = srv.name;
            if (it.summary) { m.description = ('' + it.summary).slice(0, 2000); }
            if (tags(it.Genre).length) { m.genres = tags(it.Genre); }
            if (tags(it.Role).length) { m.cast = tags(it.Role); }
            if (tags(it.Director).length) { m.director = tags(it.Director); }
            if (+it.duration > 0 && t === 'movie') { m.runtime = Math.round(it.duration / 60000) + ' min'; }
            if (m.releaseInfo) { m.year = m.releaseInfo; }
            if (t === 'movie') { return m; }
            return episodes(srv, it.ratingKey).then(function (eps) {
                m.videos = eps.map(function (e) {
                    var v = { id: showId + ':' + e.season + ':' + e.episode, season: e.season, episode: e.episode, title: clean(e.it.title, 200) || 'Episode ' + e.episode };
                    if (e.it.summary) { v.overview = ('' + e.it.summary).slice(0, 1000); }
                    if (e.it.thumb) { v.thumbnail = img(srv, e.it.thumb, 640, 360); }
                    var rel = Date.parse(e.it.originallyAvailableAt || '');
                    if (rel) { v.released = new Date(rel).toISOString(); }
                    return v;
                });
                return m;
            });
        });
    }

    // ---- Which titles each server has (for titles from your addons) ----
    var _index = {};
    function index(srv) {
        var x = _index[srv.id];
        if (x && x.map && (x.p || Date.now() - x.at < INDEX_FRESH_MS)) { return Promise.resolve(x.map); }
        if (x && x.p) { return x.p; }
        var p = Promise.all(libsOf(srv).map(function (lib) {
            return get(srv, '/library/sections/' + enc(lib.id) + '/all?type=' + (lib.type === 'movie' ? 1 : 2) + '&includeGuids=1', 16 * 1048576).then(function (r) {
                return U.listOf(mc(r).Metadata, 100000).map(function (it) { return { t: lib.type, it: it }; });
            });
        })).then(function (lists) {
            var map = { __ids: {} };
            function add(k, v) { (map[k] = map[k] || []).push(v); }
            flat(lists).forEach(function (e) {
                var it = e.it, tt = imdbOf(it), tm = tmdbOf(it);
                if (it.ratingKey == null) { return; }
                if (tt) { add(e.t + '|' + tt, '' + it.ratingKey); map.__ids['' + it.ratingKey] = tt; }
                if (tm) { add(e.t + '|tmdb:' + tm, '' + it.ratingKey); }
            });
            if (_index[srv.id] && _index[srv.id].p === p) { _index[srv.id] = { at: Date.now(), map: map }; }
            return map;
        }, function (e) {
            U.log('plex', '“' + srv.name + '”: its titles couldn’t be read (' + U.problem(e) + ')');
            var old = _index[srv.id], map = (old && old.map) || { __ids: {} };
            if (old && old.p === p) { _index[srv.id] = { at: Date.now() - INDEX_FRESH_MS + INDEX_RETRY_MS, map: map }; }
            return map;
        });
        _index[srv.id] = { at: x ? x.at : 0, map: x ? x.map : null, p: p };
        return x && x.map ? Promise.resolve(x.map) : p;
    }
    function copies(type, id) {
        var key = '', season = null, episode = null;
        if (type === 'movie') { key = /^(tt\d+|tmdb:\d+)$/.test('' + id) ? '' + id : ''; }
        else if (type === 'series') {
            var mm = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec('' + id);
            if (mm) { key = mm[1]; season = +mm[2]; episode = +mm[3]; }
        }
        if (!key) { return Promise.resolve([]); }
        return Promise.all(servers().map(function (srv) {
            return index(srv).then(function (map) {
                return Promise.all((map[type + '|' + key] || []).slice(0, 3).map(function (rk) {
                    return type === 'movie' ? item(srv, rk).then(function (it) { return sourcesOf(srv, it); }, none) : episodeSources(srv, rk, season, episode);
                }));
            }).then(flat, none);
        })).then(flat);
    }

    // ---- Sources ----
    var SUB_CODECS = /^(srt|subrip|vtt|webvtt)$/i;
    function share() { return (typeof Jellyfin !== 'undefined' && Jellyfin.shared) || null; }
    function quality(w, h) { return w >= 3200 || h >= 1600 ? '4K' : w >= 1800 || h >= 900 ? '1080p' : w >= 1200 || h >= 600 ? '720p' : h > 0 ? h + 'p' : ''; }
    function human(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB'; }
    function source(srv, it, media, part) {
        var all = U.listOf(part.Stream, 200), v = all.filter(function (s) { return +s.streamType === 1; })[0] || {};
        var hdr = v.DOVIPresent || /dovi|dolby vision/i.test('' + (v.displayTitle || '')) ? 'DV' : /smpte2084|arib-std-b67/i.test('' + (v.colorTrc || '')) || /hdr|hlg/i.test('' + (v.displayTitle || '')) ? 'HDR' : '';
        var w = +media.width || +v.width || 0, h = +media.height || +v.height || 0, q = quality(w, h);
        var ext = ('' + (part.container || media.container || 'mkv')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mkv', size = +part.size || 0;
        var file = ('' + (part.file || it.title || '')).split(/[\/\\]/).pop() || ('' + it.title);
        var st = {
            url: linkOf(srv, '' + part.key),
            name: 'Plex' + (q ? '\n' + q + (hdr ? ' ' + hdr : '') : ''),
            title: file + '\n' + srv.name + (size ? ' · 💾 ' + human(size) : '') + ' · ' + ext.toUpperCase(),
            behaviorHints: { filename: file, videoSize: size || undefined, bingeGroup: 'stremiok-plex-' + srv.id },
            _jf: placeOf({ srv: srv.id, kind: 'plex', item: '' + it.ratingKey, ms: '' + part.id, dur: Math.round((+it.duration || +media.duration || 0) / 1000) }, it)
        };
        var sh = share(), asJf = { Chapters: chaptersOf(it), RunTimeTicks: (+it.duration || 0) * 10000 };
        var ch = sh && sh.chapterSegments(asJf), named = sh && sh.namedChapters(asJf), mk = markersOf(it), tp = picturesOf(srv, part, st._jf.dur, w, h);
        if (ch) { st._jf.ch = ch; }
        if (mk) { st._jf.mk = mk; }
        if (named) { st._jf.chapters = named; }
        if (tp) { st._jf.tp = tp; }
        var subs = all.filter(function (s) { return +s.streamType === 3 && s.key && SUB_CODECS.test('' + (s.codec || '')); }).slice(0, 30).map(function (s) {
            return { id: 'px' + s.id, url: linkOf(srv, '' + s.key), lang: ('' + (s.languageCode || s.language || '')).slice(0, 12) };
        });
        if (subs.length) { st.subtitles = subs; }
        return st;
    }
    // Where Plex last had it (any of its apps): pos seconds (0: finished or not started), at when.
    function placeOf(jf, it) {
        var at = +(it && it.lastViewedAt) || 0;
        if (at > 0) { jf.at = at * 1000; jf.pos = Math.max(0, Math.round((+it.viewOffset || 0) / 1000)); }
        return jf;
    }
    // Its chapters in Jellyfin's shape (Name, StartPositionTicks), for the shared readers.
    function chaptersOf(it) {
        return U.listOf(it && it.Chapter, 200, function (c) { return c && +c.startTimeOffset >= 0; }).map(function (c) {
            return { Name: c.tag == null ? '' : '' + c.tag, StartPositionTicks: +c.startTimeOffset * 10000 };
        });
    }
    // Its intro and credits markers: { intro: [{ start, end }], credits }, seconds; or null.
    function markersOf(it) {
        var out = null;
        U.listOf(it && it.Marker, 20, function (k) { return k && (k.type === 'intro' || k.type === 'credits') && +k.endTimeOffset > +k.startTimeOffset && +k.startTimeOffset >= 0; }).forEach(function (k) {
            out = out || {};
            (out[k.type] = out[k.type] || []).push({ start: +k.startTimeOffset / 1000, end: +k.endTimeOffset / 1000 });
        });
        return out;
    }
    // Its seek pictures (video preview thumbnails, when the server made them: indexes="sd"): one
    // picture a link, every PIC_EVERY (the server answers with the nearest).
    function picturesOf(srv, part, dur, w, h) {
        if (!/(^|,)sd(,|$)/.test('' + (part.indexes || '')) || !(dur > 0)) { return null; }
        return { one: true, w: 320, h: w > 0 && h > 0 ? Math.round(320 * h / w) : 180, cols: 1, rows: 1, n: Math.ceil(dur * 1000 / PIC_EVERY), every: PIC_EVERY,
            base: srv.url + '/library/parts/' + enc(part.id) + '/indexes/sd/', q: '?X-Plex-Token=' + enc(srv.token) };
    }
    function sourcesOf(srv, it) {
        if (!it || it.ratingKey == null) { return []; }
        var out = [];
        U.listOf(it.Media, 8).forEach(function (media) {
            U.listOf(media.Part, 4, function (p) { return p && p.key && p.id != null; }).slice(0, 1).forEach(function (part) { out.push(source(srv, it, media, part)); });
        });
        return out;
    }
    function episodeSources(srv, sid, season, episode) {
        return episodes(srv, sid).then(function (eps) {
            var e = eps.filter(function (x) { return x.season === season && x.episode === episode; })[0];
            return e ? item(srv, e.it.ratingKey).then(function (it) { return sourcesOf(srv, it); }, none) : [];
        }, none);
    }
    function streams(type, id) {
        var x = parseId(id);
        if (x) {
            if (!x.srv) { return Promise.resolve([]); }
            if (x.kind === 'm') { return item(x.srv, x.item).then(function (it) { return sourcesOf(x.srv, it); }, none); }
            return x.season != null ? episodeSources(x.srv, x.item, x.season, x.episode) : Promise.resolve([]);
        }
        return copies(type, id);
    }
    function isPlexId(id) { return /^px[ms]\./.test('' + id); }

    // ---- What you play, back to Plex (its timeline) ----
    // From the player (through Jellyfin.onPlayer): 'progress', 'pause', 'stop', 'watched'. Nothing
    // during private viewing, for a trailer, or another source.
    var _play = null;
    function report(p, state, cur) {
        var srv = server(p.srv);
        if (!srv) { return; }
        tell(srv, '/:/timeline?ratingKey=' + enc(p.item) + '&key=' + enc('/library/metadata/' + p.item) + '&identifier=com.plexapp.plugins.library&state=' + state +
            '&time=' + Math.max(0, Math.round((cur || 0) * 1000)) + '&duration=' + Math.max(0, Math.round((p.dur || 0) * 1000))).then(null, function (e) {
            U.log('plex', '“' + srv.name + '” wasn’t told where you are (' + U.problem(e) + ')');
        });
    }
    function stopNow(cur) {
        var p = _play;
        _play = null;
        if (p && p.started) { report(p, 'stopped', cur != null ? cur : p.cur); }
    }
    function onPlayer(ev, ctx, cur, dur, paused) {
        var jf = ctx && !ctx.private && !ctx.trailer && ctx.stream && ctx.stream._jf, srv = jf && jf.kind === 'plex' && server(jf.srv);
        if (ev === 'watched') {
            if (srv) { tell(srv, '/:/scrobble?identifier=com.plexapp.plugins.library&key=' + enc(jf.item)).then(null, function (e) { U.log('plex', '“' + srv.name + '”: not marked played (' + U.problem(e) + ')'); }); }
            return;
        }
        if (_play && (!srv || _play.ctx !== ctx || _play.item !== jf.item || _play.ms !== jf.ms)) { stopNow(); }
        if (!srv || ev === 'stop') { if (ev === 'stop') { stopNow(cur); } return; }
        if (!_play) { _play = { ctx: ctx, srv: srv.id, item: jf.item, ms: jf.ms, dur: dur || jf.dur, started: false, sent: 0, paused: false, cur: 0 }; }
        var p = _play, now = Date.now(), pz = ev === 'pause' || !!paused;
        if (dur > 0) { p.dur = dur; }
        if (cur > 0) { p.cur = cur; }
        if (!(cur > 0)) { return; }
        if (!p.started || pz !== p.paused || now - p.sent >= REPORT_EVERY) { p.started = true; p.sent = now; p.paused = pz; report(p, pz ? 'paused' : 'playing', cur); }
    }

    return {
        servers: servers, server: server, isEnabled: isEnabled, onChange: onChange, link: link, add: add, remove: remove, reload: reload,
        libraries: libsOf, synthAddon: synthAddon, synthAddons: synthAddons, catalog: catalog, meta: meta, streams: streams, isPlexId: isPlexId,
        onPlayer: onPlayer, candidates: candidates
    };
})();
