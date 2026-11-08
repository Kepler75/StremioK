/* Jellyfin and Emby servers on your network. Global namespace: Jellyfin
   - Added in Settings › Content › Media servers: its address, then (Jellyfin) Quick Connect, a
     code to enter in Jellyfin, or a user name and password. What's kept: its address, kind, name
     and version, who's signed in and the sign-in it gave back (never the password).
   - Emby speaks the same API family (Jellyfin started as its fork): its paths under /emby, per
     user (/Users/<id>/Items…), its sign-in line as X-Emby-Authorization, api_key in links; no
     Quick Connect or media segments, but intro and credits markers in its chapters, and its seek
     pictures in a BIF file, not trickplay (KINDS: what differs).
   - As local addons like Xtream's, one per kind ("Jellyfin", "Emby"): a catalog per Movies or
     Shows library (Home rows, Discover, Search); a title the server knows the IMDb id of is a
     card with that id (the usual title page, your addons' sources too), any other
     jfm.<server>.<item> (a film) or jfs.<server>.<series> (its episodes …:<season>:<episode>),
     its details from the server.
   - On titles from your addons (tt…, tmdb:…), the server's copies as sources: each server's list
     of films and series with their ids, read when first needed and again after INDEX_FRESH_MS.
   - Played as the file is (/Videos/<item>/stream.<container>?static=true: nothing converted),
     its subtitle files with it; what you play is reported back (Jellyfin's sessions: where you
     are, stopped, played), except during private viewing. Jellyfin 10.9 or newer, Emby 4.7.
   - Watched marks: what each server (Plex's too) has played, by the ids its titles go by here,
     read at launch and after MARKS_FRESH_MS; Player weighs them against its own by time
     (player-store), as Trakt's. */
var Jellyfin = (function () {
    'use strict';

    var KEY = 'stremiok.jellyfin.servers', DEV_KEY = 'stremiok.jellyfin.device', LIBS_KEY = 'stremiok.jellyfin.libs';
    var PAGE = 100, INDEX_FRESH_MS = 30 * 60000, INDEX_RETRY_MS = 60000, INDEX_SLOW_MS = 30 * 60000, LIBS_FRESH_MS = 86400000;
    var QC_EVERY = 3000, QC_FOR = 10 * 60000, REPORT_EVERY = 60000, TICKS = 10000000;
    var _changeFns = [];
    function onChange(fn) { _changeFns.push(fn); }
    function changed() { _changeFns.forEach(function (fn) { try { fn(); } catch (e) {} }); }
    function enc(v) { return encodeURIComponent('' + v); }
    function rand(n) { return U.randomHex(n); }   // (the TV's secure random numbers)
    function none() { return []; }
    function flat(lists) { return [].concat.apply([], lists || []); }

    // ---- What differs between Jellyfin and Emby (u: the signed-in user's id, encoded) ----
    var KINDS = {
        jellyfin: { name: 'Jellyfin', prefix: '', header: 'Authorization', key: 'ApiKey', fill: 'fillHeight=450',
            views: function (u) { return '/UserViews?userId=' + u; }, items: function (u) { return '/Items?userId=' + u + '&'; },
            item: function (u, id) { return '/Items/' + id + '?userId=' + u; }, resume: function (u) { return '/UserItems/Resume?userId=' + u + '&'; },
            played: function (u, id) { return '/UserPlayedItems/' + id + '?userId=' + u; }, sub: '/0/Stream.srt' },
        emby: { name: 'Emby', prefix: '/emby', header: 'X-Emby-Authorization', key: 'api_key', fill: 'maxHeight=450',
            views: function (u) { return '/Users/' + u + '/Views'; }, items: function (u) { return '/Users/' + u + '/Items?'; },
            item: function (u, id) { return '/Users/' + u + '/Items/' + id + '?Fields=Chapters,MediaSources,MediaStreams,ProviderIds,People,Genres,Overview'; },
            resume: function (u) { return '/Users/' + u + '/Items/Resume?'; }, played: function (u, id) { return '/Users/' + u + '/PlayedItems/' + id; }, sub: '/Stream.srt' }
    };
    function kindOf(srv) { return srv && srv.kind === 'emby' ? 'emby' : 'jellyfin'; }   // (servers kept before Emby: Jellyfin)
    function K(srv) { return KINDS[kindOf(srv)]; }
    function api(srv) { return srv.url + K(srv).prefix; }
    function uid(srv) { return enc(srv.userId); }

    // ---- Your servers ----
    // (every one kept, on or off: Settings' list; servers: the ones on, all that's used)
    function allServers(kind) {
        var l = U.store.get(KEY, []);
        return Array.isArray(l) ? l.filter(function (s) { return s && s.id && s.url && s.token && s.userId && (!kind || kindOf(s) === kind); }) : [];
    }
    function servers(kind) { return allServers(kind).filter(function (s) { return !s.off; }); }
    function server(id) { return servers().filter(function (s) { return s.id === id; })[0] || null; }
    function anyServer(id) { return allServers().filter(function (s) { return s.id === id; })[0] || null; }
    // Turned off: its rows, sources and watched marks set aside, nothing asked of it, its sign-in
    // kept; on again: its libraries read again.
    function setOn(id, on) {
        if (!anyServer(id)) { return; }
        U.store.set(KEY, allServers().map(function (s) {
            if (s.id !== id) { return s; }
            var t = {};
            Object.keys(s).forEach(function (k) { if (k !== 'off') { t[k] = s[k]; } });
            if (!on) { t.off = true; }
            return t;
        }));
        forget(id);
        fillAll();
        if (on) { delete _libsAsked[id]; _libsP[id] = refreshLibs(true, id); }
        changed();
    }
    function isEnabled(kind) { return servers(kind).length > 0; }
    function kindsOn() { return Object.keys(KINDS).filter(function (k) { return isEnabled(k); }); }
    function deviceId() {
        var d = U.store.get(DEV_KEY, '');
        if (!/^[0-9a-f]{16,40}$/.test('' + d)) { d = rand(32); U.store.set(DEV_KEY, d); }
        return d;
    }
    function version() {   // (StremioK's, from the ?v= build.sh stamps on the script tags)
        try {
            var tag = document.querySelector('script[src*="jellyfin.js"]');
            var m = tag && /[?&]v=([0-9][0-9.]*)/.exec(tag.getAttribute('src') || '');
            if (m) { return m[1]; }
        } catch (e) {}
        return '2';
    }
    // The server's own sign-in line: who's asking (StremioK, this TV) and, signed in, its token;
    // in the kind's header (s: a server, or what probe found).
    function auth(token) {
        return 'MediaBrowser Client="StremioK", Device="Samsung TV", DeviceId="' + deviceId() + '", Version="' + version() + '"' + (token ? ', Token="' + token + '"' : '');
    }
    function headers(s, token, json) {
        var h = {};
        h[K(s).header] = auth(token);
        if (json) { h['Content-Type'] = 'application/json'; }
        return h;
    }
    // How long to wait for its answer: Settings › Media servers › Wait for a server (Normal: 20 s;
    // Plex's too).
    function waitMs() { var w = typeof Stremio !== 'undefined' && Stremio.getPrefs ? +Stremio.getPrefs().serverWait : 0; return w > 0 ? w * 1000 : 20000; }
    function get(srv, path, max) { return U.getJSON(api(srv) + path, waitMs(), max || 4 * 1048576, null, headers(srv, srv.token)); }
    function post(srv, path, body) { return U.getText(api(srv) + path, 15000, 65536, null, true, headers(srv, srv.token, true), body == null ? '' : JSON.stringify(body)); }

    // An address as typed (192.168.0.50, http://nas:8096/web/…, …/emby/web/…): with http:// and
    // the usual port (8096, both's) when it has none, nothing after the host.
    function normAddress(v) {
        var s = ('' + (v || '')).trim().replace(/#.*$/, '').replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '').replace(/\/emby$/i, '');
        if (s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { s = 'http://' + s; }
        if (/^http:\/\/[^\/:@]+$/i.test(s)) { s += ':8096'; }
        return s;
    }
    function addressProblem(v) {
        var s = normAddress(v), p = /^https?:\/\//i.test(s) ? U.parseUrl(s) : null;
        return p && p.host ? null : 'An address like http://192.168.0.50:8096';
    }
    // What answers there: a Jellyfin (10.9 or newer) or Emby (4.7 or newer) server, its kind, name
    // and version. Asked at the address, then under /emby (an Emby that answers only there).
    function probe(address) {
        var url = normAddress(address);
        function info() { return U.getJSON(url + '/System/Info/Public', 10000, 65536).then(null, function (e) { return U.getJSON(url + '/emby/System/Info/Public', 10000, 65536).then(null, function () { throw e; }); }); }
        return info().then(function (r) {
            if (!r || typeof r !== 'object' || !r.Id || !r.Version) { throw new Error('That address doesn’t answer as a Jellyfin or Emby server.'); }
            // (Jellyfin always names itself, "Jellyfin Server"; Emby usually sends no ProductName at
            // all: one that doesn't say Jellyfin is Emby when it says so or its version is Emby's, 4.x)
            var v = ('' + r.Version).split('.').map(function (x) { return parseInt(x, 10) || 0; }), pn = '' + (r.ProductName || '');
            var kind = /jellyfin/i.test(pn) ? 'jellyfin' : (/emby/i.test(pn) || v[0] < 10) ? 'emby' : 'jellyfin';
            if (kind === 'jellyfin' && !(v[0] > 10 || (v[0] === 10 && v[1] >= 9))) { throw new Error('Jellyfin ' + r.Version + ' is too old: 10.9 or newer is needed.'); }
            if (kind === 'emby' && !(v[0] > 4 || (v[0] === 4 && v[1] >= 7))) { throw new Error('Emby ' + r.Version + ' is too old: 4.7 or newer is needed.'); }
            return { url: url, kind: kind, serverId: '' + r.Id, name: ('' + (r.ServerName || KINDS[kind].name)).replace(/\s+/g, ' ').trim().slice(0, 60) || KINDS[kind].name, version: ('' + r.Version).slice(0, 20) };
        }, function (e) { throw new Error('No answer from ' + url + ' (' + U.problem(e) + ').'); });
    }
    function kindName(s) { return K(s).name; }
    // Signed in: kept (the same server and user again: in its place, its id kept).
    function added(info, r) {
        if (!r || !r.AccessToken || !r.User || !r.User.Id) { throw new Error(kindName(info) + ' didn’t sign in.'); }
        var list = allServers(), old = list.filter(function (s) { return s.serverId === info.serverId && s.userId === '' + r.User.Id; })[0];
        var srv = { id: old ? old.id : 's' + rand(8), url: info.url, kind: kindOf(info), serverId: info.serverId, name: info.name, version: info.version,
            user: ('' + (r.User.Name || '')).slice(0, 60), userId: '' + r.User.Id, token: '' + r.AccessToken, at: Date.now() };
        list = list.filter(function (s) { return s !== old; });
        list.push(srv);
        U.store.set(KEY, list);
        forget(srv.id);
        _libsP[srv.id] = refreshLibs(true, srv.id);
        changed();
        U.log('jellyfin', 'Signed in to “' + srv.name + '” (' + kindName(srv) + ' ' + srv.version + ') as ' + srv.user);
        return srv;
    }
    // Signed in, once its libraries are read (or that failed): Settings shows them at once.
    var _libsP = {};
    function withLibs(srv) { return (_libsP[srv.id] || Promise.resolve()).then(function () { return srv; }); }
    function signIn(info, user, pass) {
        return U.getJSON(api(info) + '/Users/AuthenticateByName', 15000, 1048576, null, headers(info, '', true), JSON.stringify({ Username: '' + user, Pw: '' + pass })).then(function (r) {
            return withLibs(added(info, r));
        }, function (e) {
            throw new Error(/HTTP 401/.test(e && e.message) ? 'Wrong user name or password.' : 'Couldn’t sign in (' + U.problem(e) + ').');
        });
    }
    // Quick Connect: a code for you to enter in Jellyfin, then asked every QC_EVERY whether it
    // was (for QC_FOR). cb: onCode(code), onSuccess(server), onError(message). Returns a stop.
    function quickConnect(info, cb) {
        var stopped = false, timer = null, until = Date.now() + QC_FOR;
        function fail(msg) { if (!stopped) { stopped = true; cb.onError(msg); } }
        U.getJSON(info.url + '/QuickConnect/Enabled', 10000, 4096, null, headers(info, ''), null, true).then(function (on) {
            if (stopped) { return; }
            if (on !== true) { fail('Quick Connect is off on this server: turn it on in Jellyfin (Dashboard › General), or sign in with a password.'); return; }
            return U.getJSON(info.url + '/QuickConnect/Initiate', 10000, 65536, null, headers(info, '', true), '').then(function (r) {
                if (stopped) { return; }
                if (!r || !r.Secret || !r.Code) { fail('Jellyfin didn’t give a code.'); return; }
                cb.onCode('' + r.Code);
                function signedIn() {
                    U.getJSON(info.url + '/Users/AuthenticateWithQuickConnect', 15000, 1048576, null, headers(info, '', true), JSON.stringify({ Secret: r.Secret })).then(function (a) {
                        if (stopped) { return; }
                        return withLibs(added(info, a)).then(function (srv) {
                            if (stopped) { return; }
                            stopped = true;
                            cb.onSuccess(srv);
                        });
                    }).then(null, function (e) { fail('Couldn’t sign in (' + U.problem(e) + ').'); });
                }
                function poll() {
                    timer = setTimeout(function () {
                        if (stopped) { return; }
                        if (Date.now() > until) { fail('The code expired: try again.'); return; }
                        U.getJSON(info.url + '/QuickConnect/Connect?secret=' + enc(r.Secret), 10000, 65536, null, headers(info, ''), null, true).then(function (s) {
                            if (stopped) { return; }
                            if (s && s.Authenticated) { signedIn(); } else { poll(); }
                        }, function (e) {
                            if (stopped) { return; }
                            if (/HTTP 404/.test(e && e.message)) { fail('The code expired: try again.'); } else { poll(); }
                        });
                    }, QC_EVERY);
                }
                poll();
            });
        }).then(null, function (e) { fail('Couldn’t start Quick Connect (' + U.problem(e) + ').'); });
        return function () { stopped = true; clearTimeout(timer); };
    }
    // Sign out and remove: its sign-in ended on the server too (if it answers).
    function remove(id) {
        var srv = anyServer(id);
        if (!srv) { return; }
        post(srv, '/Sessions/Logout', null).then(null, function () {});
        U.store.set(KEY, allServers().filter(function (s) { return s.id !== id; }));
        var libs = libsAll();
        delete libs[id];
        U.store.set(LIBS_KEY, libs);
        forget(id);
        fillAll();
        changed();
    }
    // Reload: its libraries and its list of titles read again now.
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
    // (a promise: done when they're read, or that failed)
    function refreshLibs(force, only) {
        return Promise.all(servers().map(function (srv) {
            if (only && srv.id !== only) { return null; }
            var l = libsAll()[srv.id];
            if (!force && ((l && Date.now() - l.at < LIBS_FRESH_MS) || _libsAsked[srv.id])) { return null; }
            _libsAsked[srv.id] = true;   // (once a launch, unless asked)
            return get(srv, K(srv).views(uid(srv))).then(function (r) {
                var list = U.listOf(r && r.Items, 50, function (x) { return x.Id && (x.CollectionType === 'movies' || x.CollectionType === 'tvshows'); }).map(function (x) {
                    return { id: '' + x.Id, name: ('' + (x.Name || '')).replace(/\s+/g, ' ').trim().slice(0, 60) || (x.CollectionType === 'movies' ? 'Movies' : 'Shows'), type: x.CollectionType === 'movies' ? 'movie' : 'series' };
                });
                if (!server(srv.id)) { return; }   // (removed meanwhile)
                var all = libsAll(), keep = {}, before = JSON.stringify(all[srv.id] && all[srv.id].list);
                allServers().forEach(function (s) { if (all[s.id]) { keep[s.id] = all[s.id]; } });
                keep[srv.id] = { at: Date.now(), list: list };
                _libs = keep;
                U.store.set(LIBS_KEY, keep);
                fillAll();
                if (JSON.stringify(list) !== before || force) { changed(); }
            }, function (e) { U.log('jellyfin', '“' + srv.name + '”: its libraries couldn’t be read (' + U.problem(e) + ')'); });
        }));
    }

    // ---- The addons: one per kind ("Jellyfin", "Emby": its rows say so, Source ranking lists it) ----
    var _addons = {};
    var RESOURCES = ['catalog', { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }];
    function catalogsNow(kind) {
        var out = [], many = servers(kind).length > 1;
        servers(kind).forEach(function (srv) {
            var libs = libsOf(srv), on = many ? ' · ' + srv.name : '';   // (Home adds “Jellyfin” / “Emby”)
            if (!libs.length) { return; }   // (its libraries not read yet, or none)
            if (libs.some(function (l) { return l.type === 'movie'; })) { out.push({ type: 'movie', id: 'jf.' + srv.id + '.resume', name: 'Continue watching' + on, extra: [] }); }
            if (libs.some(function (l) { return l.type === 'series'; })) { out.push({ type: 'series', id: 'jf.' + srv.id + '.nextup', name: 'Next up' + on, extra: [] }); }
            libs.forEach(function (lib) {
                out.push({ type: lib.type, id: 'jf.' + srv.id + '.' + lib.id, name: lib.name + (many ? ' · ' + srv.name : ''), extra: [{ name: 'search' }, { name: 'skip' }] });
            });
        });
        return out;
    }
    function fillCatalogs(kind) {   // (changed in place: the loaded addon holds the same list)
        var a = _addons[kind];
        if (!a) { return; }
        var l = a.manifest.catalogs;
        l.splice.apply(l, [0, l.length].concat(catalogsNow(kind)));
        a.manifest.resources = isEnabled(kind) ? RESOURCES : ['catalog'];
    }
    function fillAll() { Object.keys(KINDS).forEach(fillCatalogs); }
    function synthAddon(kind) {
        kind = KINDS[kind] ? kind : 'jellyfin';
        if (!_addons[kind]) {
            _addons[kind] = { __local: true, __sources: true, url: 'local:' + kind, base: 'local:' + kind,
                __impl: { catalog: catalog, meta: meta, streams: function (type, id, m) { return streams(type, id, kind, m); } },
                manifest: { id: 'org.stremiok.' + kind, name: KINDS[kind].name, version: '1.0.0', types: ['movie', 'series'], resources: RESOURCES, catalogs: [] } };
        }
        fillCatalogs(kind);
        refreshLibs(false);
        return _addons[kind];
    }
    // The addons of the kinds you have a server of, Jellyfin first.
    function synthAddons() { return kindsOn().map(synthAddon); }

    // ---- Titles ----
    function imdbOf(it) { var p = (it && it.ProviderIds) || {}, v = '' + (p.Imdb || p.IMDB || p.imdb || ''); return /^tt\d{5,10}$/.test(v) ? v : ''; }
    function tmdbOf(it) { var p = (it && it.ProviderIds) || {}, v = '' + (p.Tmdb || p.TMDB || p.tmdb || ''); return /^\d{1,10}$/.test(v) ? v : ''; }
    function img(srv, id, kind, tag, size) {
        return api(srv) + '/Items/' + enc(id) + '/Images/' + kind + '?' + (kind === 'Backdrop' ? 'maxWidth=1280' : size || K(srv).fill) + '&quality=90' + (tag ? '&tag=' + enc(tag) : '');
    }
    function cardOf(srv, type, it) {
        if (!it || !it.Id || !it.Name) { return null; }
        var tt = imdbOf(it);
        var m = { id: tt || ((type === 'movie' ? 'jfm.' : 'jfs.') + srv.id + '.' + it.Id), type: type, name: ('' + it.Name).replace(/\s+/g, ' ').trim(), posterShape: 'poster' };
        if (it.ImageTags && it.ImageTags.Primary) { m.poster = img(srv, it.Id, 'Primary', it.ImageTags.Primary); }
        if (Array.isArray(it.BackdropImageTags) && it.BackdropImageTags[0]) { m.background = img(srv, it.Id, 'Backdrop', it.BackdropImageTags[0]); }
        if (it.ProductionYear > 1880) { m.releaseInfo = '' + it.ProductionYear; }
        var r = parseFloat(it.CommunityRating);
        if (r > 0 && r <= 10) { m.imdbRating = r.toFixed(1); }
        return m;
    }
    var CARD_FIELDS = '&fields=ProviderIds&enableImageTypes=Primary,Backdrop&imageTypeLimit=1';
    // Jellyfin's Continue watching (films part-watched) and Next up (a show's next episode, or
    // the one part-watched): a show's card opens at that episode (_openEp).
    function resumeCards(srv) {
        return get(srv, K(srv).resume(uid(srv)) + 'includeItemTypes=Movie&limit=50' + CARD_FIELDS + '&enableTotalRecordCount=false').then(function (r) {
            return U.listOf(r && r.Items, 50).map(function (it) { return cardOf(srv, 'movie', it); }).filter(Boolean);
        });
    }
    function nextUpCards(srv) {
        return Promise.all([get(srv, '/Shows/NextUp?userId=' + uid(srv) + '&limit=50' + CARD_FIELDS + '&enableTotalRecordCount=false'), index(srv)]).then(function (r) {
            var seen = {};
            return U.listOf(r[0] && r[0].Items, 50, function (e) { return e.SeriesId && e.ParentIndexNumber >= 0 && e.IndexNumber >= 0; }).map(function (e) {
                var sid = '' + e.SeriesId, show = (r[1].__ids || {})[sid] || ('jfs.' + srv.id + '.' + sid);
                if (seen[show]) { return null; }
                seen[show] = 1;
                var m = { id: show, type: 'series', name: ('' + (e.SeriesName || e.Name || '')).replace(/\s+/g, ' ').trim(), posterShape: 'poster',
                    _openEp: show + ':' + e.ParentIndexNumber + ':' + e.IndexNumber, _ep: 'S' + e.ParentIndexNumber + 'E' + e.IndexNumber };
                if (e.SeriesPrimaryImageTag) { m.poster = img(srv, sid, 'Primary', e.SeriesPrimaryImageTag); }
                if (Array.isArray(e.ParentBackdropImageTags) && e.ParentBackdropImageTags[0]) { m.background = img(srv, e.ParentBackdropItemId || sid, 'Backdrop', e.ParentBackdropImageTags[0]); }
                return m.name ? m : null;
            }).filter(Boolean);
        });
    }
    function catalog(catId, extra) {
        var m = /^jf\.([^.]+)\.([^.]+)$/.exec(catId || ''), srv = m && server(m[1]);
        if (srv && m[2] === 'resume') { return resumeCards(srv); }
        if (srv && m[2] === 'nextup') { return nextUpCards(srv); }
        var lib = srv && libsOf(srv).filter(function (l) { return l.id === m[2]; })[0];
        if (!lib) { return Promise.resolve([]); }
        var skip = extra && extra.skip ? (parseInt(extra.skip, 10) || 0) : 0, term = extra && extra.search ? ('' + extra.search).slice(0, 120) : '';
        var path = K(srv).items(uid(srv)) + 'parentId=' + enc(lib.id) + '&recursive=true&includeItemTypes=' + (lib.type === 'movie' ? 'Movie' : 'Series') +
            CARD_FIELDS + '&enableUserData=false&enableTotalRecordCount=false&startIndex=' + skip + '&limit=' + PAGE +
            (term ? '&searchTerm=' + enc(term) : '&sortBy=DateCreated,SortName&sortOrder=Descending');
        return get(srv, path).then(function (r) {
            return U.listOf(r && r.Items, PAGE).map(function (it) { return cardOf(srv, lib.type, it); }).filter(Boolean);
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
    function item(srv, id) { return kept(_items, srv.id + '|' + id, function () { return get(srv, K(srv).item(uid(srv), enc(id))); }); }
    // A show's episodes on the server (not the missing ones Jellyfin may list): [{ season, episode, it }].
    function episodes(srv, sid) {
        return kept(_eps, srv.id + '|' + sid, function () {
            return get(srv, '/Shows/' + enc(sid) + '/Episodes?userId=' + uid(srv) + '&fields=Overview,MediaSources,MediaStreams,Chapters,Trickplay&isMissing=false&enableUserData=true', 16 * 1048576).then(function (r) {
                return U.listOf(r && r.Items, 5000, function (e) { return e.Id && e.LocationType !== 'Virtual' && e.ParentIndexNumber >= 0 && e.IndexNumber >= 0; }).map(function (e) {
                    return { season: +e.ParentIndexNumber, episode: +e.IndexNumber, it: e };
                }).sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
            });
        });
    }
    function parseId(id) {
        var m = /^jf([ms])\.([^.]+)\.([0-9a-f-]{8,40})(?::(\d+):(\d+))?$/i.exec('' + id);
        return m ? { kind: m[1], srv: server(m[2]), item: m[3], season: m[4] != null ? +m[4] : null, episode: m[5] != null ? +m[5] : null } : null;
    }
    function names(people, kind) {
        return U.listOf(people, 200, function (p) { return p.Type === kind && p.Name; }).slice(0, 12).map(function (p) { return '' + p.Name; });
    }
    function meta(type, id) {
        var x = parseId(id);
        if (!x || !x.srv) { return Promise.resolve(null); }
        var srv = x.srv, t = x.kind === 'm' ? 'movie' : 'series';
        return item(srv, x.item).then(function (it) {
            if (!it || !it.Id || !it.Name) { return null; }
            var showId = 'jf' + x.kind + '.' + srv.id + '.' + it.Id, m = cardOf(srv, t, it);
            m.id = showId; m._from = srv.name;
            if (it.Overview) { m.description = ('' + it.Overview).slice(0, 2000); }
            if (Array.isArray(it.Genres) && it.Genres.length) { m.genres = it.Genres.slice(0, 12).map(String); }
            if (names(it.People, 'Actor').length) { m.cast = names(it.People, 'Actor'); }
            if (names(it.People, 'Director').length) { m.director = names(it.People, 'Director'); }
            if (+it.RunTimeTicks > 0) { m.runtime = Math.round(it.RunTimeTicks / TICKS / 60) + ' min'; }
            if (m.releaseInfo) { m.year = m.releaseInfo; }
            if (t === 'movie') { return m; }
            return episodes(srv, it.Id).then(function (eps) {
                m.videos = eps.map(function (e) {
                    var v = { id: showId + ':' + e.season + ':' + e.episode, season: e.season, episode: e.episode, title: ('' + (e.it.Name || '')).trim() || 'Episode ' + e.episode };
                    if (e.it.Overview) { v.overview = ('' + e.it.Overview).slice(0, 1000); }
                    if (e.it.ImageTags && e.it.ImageTags.Primary) { v.thumbnail = img(srv, e.it.Id, 'Primary', e.it.ImageTags.Primary, 'maxWidth=640'); }
                    var rel = Date.parse(e.it.PremiereDate || '');
                    if (rel) { v.released = new Date(rel).toISOString(); }
                    return v;
                });
                return m;
            });
        });
    }

    // ---- Which titles each server has (for titles from your addons) ----
    // type|tt… and type|tmdb:… -> its item ids; read when first asked, kept INDEX_FRESH_MS (the
    // old list answers while a new one is read).
    var _index = {};
    function index(srv) {
        var x = _index[srv.id];
        if (x && x.map && (x.p || Date.now() - x.at < INDEX_FRESH_MS)) { return Promise.resolve(x.map); }
        if (x && x.p) { return x.p; }
        var p = get(srv, K(srv).items(uid(srv)) + 'recursive=true&includeItemTypes=Movie,Series&fields=ProviderIds&enableImages=false&enableUserData=true&enableTotalRecordCount=false', 16 * 1048576).then(function (r) {
            var map = { __ids: {}, __tm: {}, __played: [] };   // (__ids, __tm: an item's IMDb, TMDB id, for Next up's cards and watched marks; __played: its played films and shows)
            function add(k, v) { (map[k] = map[k] || []).push(v); }
            U.listOf(r && r.Items, 100000).forEach(function (it) {
                var t = it.Type === 'Movie' ? 'movie' : it.Type === 'Series' ? 'series' : '', tt = imdbOf(it), tm = tmdbOf(it);
                if (!t || !it.Id) { return; }
                if (tt) { add(t + '|' + tt, '' + it.Id); map.__ids['' + it.Id] = tt; }
                if (tm) { add(t + '|tmdb:' + tm, '' + it.Id); map.__tm['' + it.Id] = tm; }
                if (it.UserData && it.UserData.Played) { map.__played.push({ t: t, ids: titleIds(map, (t === 'movie' ? 'jfm.' : 'jfs.') + srv.id + '.', '' + it.Id), at: Date.parse(it.UserData.LastPlayedDate || '') || 1 }); }
            });
            if (_index[srv.id] && _index[srv.id].p === p) { _index[srv.id] = { at: Date.now(), map: map }; }
            return map;
        }, function (e) {
            U.log('jellyfin', '“' + srv.name + '” (' + kindName(srv) + '): its titles couldn’t be read (' + U.problem(e) + ')');
            var old = _index[srv.id], map = (old && old.map) || { __ids: {}, __tm: {}, __played: [], __err: true };   // (__err: never read)
            // (asked again in a minute; one that timed out — a list too big or slow for one answer, as a server
            // presenting a whole catalog has — after 30 minutes, titles looked up one at a time meanwhile: idsFor)
            var slow = /Timed out/i.test((e && e.message) || '');
            if (old && old.p === p) { _index[srv.id] = { at: Date.now() - INDEX_FRESH_MS + (slow ? INDEX_SLOW_MS : INDEX_RETRY_MS), map: map }; }
            return map;
        });
        _index[srv.id] = { at: x ? x.at : 0, map: x ? x.map : null, p: p };
        return x && x.map ? Promise.resolve(x.map) : p;
    }
    // The list as it is now: one being read again waited for (index answers with the old one).
    function indexFresh(srv) { var p = index(srv), x = _index[srv.id]; return x && x.p ? x.p : p; }
    // The ids a server's title goes by here: its IMDb and TMDB ones, and its own (own: its prefix).
    function titleIds(map, own, id) {
        var l = [own + id];
        if (map.__ids[id]) { l.unshift(map.__ids[id]); }
        if (map.__tm && map.__tm[id]) { l.push('tmdb:' + map.__tm[id]); }
        return l;
    }
    // A title the server's list can't give (never read: too big or slow for one answer, as a server
    // presenting a whole catalog is): searched for by its name, taken only when its IMDb or TMDB id
    // is the one asked for. Kept FOUND_MS (a failed search: asked again next time).
    var FOUND_MS = 30 * 60000, _found = U.lru(300);
    function lookup(srv, type, key, name) {
        name = ('' + (name || '')).replace(/\s+/g, ' ').trim().slice(0, 100);
        if (!name) { return Promise.resolve([]); }
        var k = srv.id + '|' + type + '|' + key, had = _found.get(k);
        if (had && had.p && Date.now() - had.at < FOUND_MS) { return had.p; }
        var p = get(srv, K(srv).items(uid(srv)) + 'recursive=true&includeItemTypes=' + (type === 'movie' ? 'Movie' : 'Series') + '&searchTerm=' + enc(name) +
            '&fields=ProviderIds&enableImages=false&enableUserData=false&limit=40').then(function (r) {
            return U.listOf(r && r.Items, 40, function (it) { return it && it.Id && (imdbOf(it) === key || (!!tmdbOf(it) && 'tmdb:' + tmdbOf(it) === key)); }).map(function (it) { return '' + it.Id; });
        }, function (e) {
            _found.set(k, null);
            U.log('jellyfin', '“' + srv.name + '”: “' + name + '” couldn’t be looked up (' + U.problem(e) + ')');
            return [];
        });
        _found.set(k, { at: Date.now(), p: p });
        return p;
    }
    // The server's items for a title: from its list, as before; with no list yet, or none to be
    // had, looked up by name meanwhile (lookup), the list's answer used when that finds none.
    function idsFor(srv, type, key, name) {
        var x = _index[srv.id];
        var fromList = index(srv).then(function (map) { return map[type + '|' + key] || []; });
        if (x && x.map && !x.map.__err) { return fromList; }
        return lookup(srv, type, key, name).then(function (ids) { return ids.length ? ids : fromList; });
    }
    // A film or episode listed without its files (a server presenting remote ones gives them only
    // when asked to play it: PlaybackInfo): asked for them then.
    function withFiles(srv, it) {
        if (!it || !it.Id || (it.MediaSources && it.MediaSources.length)) { return Promise.resolve(it); }
        return U.getJSON(api(srv) + '/Items/' + enc(it.Id) + '/PlaybackInfo?userId=' + uid(srv), waitMs(), 8 * 1048576, null, headers(srv, srv.token, true), '{}').then(function (r) {
            var l = U.listOf(r && r.MediaSources, 200, function (ms) { return ms && ms.Id; });
            return l.length ? Object.assign({}, it, { MediaSources: l }) : it;
        }, function (e) {
            U.log('jellyfin', '“' + srv.name + '”: the files of “' + (it.Name || it.Id) + '” couldn’t be read (' + U.problem(e) + ')');
            return it;
        });
    }
    function filesOf(srv, it) { return withFiles(srv, it).then(function (x) { return sourcesOf(srv, x); }); }
    function copies(type, id, kind, meta) {
        var key = '', season = null, episode = null;
        if (type === 'movie') { key = /^(tt\d+|tmdb:\d+)$/.test('' + id) ? '' + id : ''; }
        else if (type === 'series') {
            var mm = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec('' + id);
            if (mm) { key = mm[1]; season = +mm[2]; episode = +mm[3]; }
        }
        if (!key) { return Promise.resolve([]); }
        var name = meta && typeof meta.name === 'string' ? meta.name : '';
        return Promise.all(servers(kind).map(function (srv) {
            return idsFor(srv, type, key, name).then(function (ids) {
                return Promise.all(ids.slice(0, 3).map(function (iid) {
                    return type === 'movie' ? item(srv, iid).then(function (it) { return filesOf(srv, it); }, none) : episodeSources(srv, iid, season, episode);
                }));
            }).then(flat, none);
        })).then(flat);
    }

    // ---- Watched marks (Jellyfin, Emby; Plex's from js/plex.js) ----
    // { 'movie:<id>': when, 'series:<id>': when (the whole show), 'series:<show>:<s>:<e>': when }
    // from [{ t, ids, at, s?, e? }].
    var MARKS_MAX = 50000;
    function marksFrom(list) {
        var out = {}, n = 0;
        (list || []).forEach(function (x) {
            (x.ids || []).forEach(function (id) {
                var k = x.t + ':' + id + (x.s != null ? ':' + x.s + ':' + x.e : '');
                if (out[k] == null) { if (n >= MARKS_MAX) { return; } n++; }
                out[k] = Math.max(out[k] || 0, x.at > 0 ? x.at : 1);
            });
        });
        return out;
    }
    // Its played films and shows (its list of titles) and episodes.
    function jfMarks(srv) {
        return Promise.all([indexFresh(srv), get(srv, K(srv).items(uid(srv)) + 'recursive=true&includeItemTypes=Episode&isPlayed=true&enableImages=false&enableTotalRecordCount=false', 16 * 1048576)]).then(function (r) {
            var map = r[0], list = map.__played.slice();
            if (map.__err) { throw new Error('its titles couldn’t be read'); }
            U.listOf(r[1] && r[1].Items, 100000, function (e) { return e.SeriesId && e.ParentIndexNumber >= 0 && e.IndexNumber >= 0 && (!e.UserData || e.UserData.Played !== false); }).forEach(function (e) {
                list.push({ t: 'series', ids: titleIds(map, 'jfs.' + srv.id + '.', '' + e.SeriesId), s: +e.ParentIndexNumber, e: +e.IndexNumber, at: Date.parse((e.UserData && e.UserData.LastPlayedDate) || '') || 1 });
            });
            return marksFrom(list);
        });
    }
    // Every server's, kept in the TV's database (U.store when it won't take them), read into
    // memory at launch (watchedAt is synchronous; until then, none).
    var MARKS_KEY = 'stremiok.media.watched', MARKS_FRESH_MS = 30 * 60000;
    var _marks = null, _all = {}, _marksP = null, _marksSaved = null;
    function merge() {
        var all = {};
        Object.keys(_marks || {}).forEach(function (id) {
            var m = (_marks[id] && _marks[id].m) || {};
            Object.keys(m).forEach(function (k) { if (!(all[k] >= m[k])) { all[k] = m[k]; } });
        });
        _all = all;
    }
    var _marksRead = (U.bigStore ? U.bigStore.get(MARKS_KEY) : Promise.resolve(null)).then(function (m) {
        if (!m || typeof m !== 'object') { m = U.store.get(MARKS_KEY, null, true); }
        if (m && typeof m === 'object' && !_marks) { _marks = m; _marksSaved = JSON.stringify(m); merge(); }
    }, function () {});
    function saveMarks() {
        var text = JSON.stringify(_marks);
        if (text === _marksSaved) { return; }
        _marksSaved = text;
        if (!U.bigStore) { U.store.set(MARKS_KEY, _marks); return; }
        U.bigStore.set(MARKS_KEY, _marks).then(function (ok) {
            if (ok) { return; }
            U.bigStore.remove(MARKS_KEY, true);
            U.store.set(MARKS_KEY, _marks);
        });
    }
    function markSources() {
        var l = servers().map(function (s) { return { id: s.id, name: s.name, read: function () { return jfMarks(s); } }; });
        if (typeof Plex !== 'undefined' && Plex.servers && Plex.marksOf) {
            Plex.servers().forEach(function (s) { l.push({ id: s.id, name: s.name, read: function () { return Plex.marksOf(s); } }); });
        }
        return l;
    }
    // Read again where older than MARKS_FRESH_MS (force: all), a removed server's dropped; a
    // promise of whether they changed.
    function refreshMarks(force) {
        if (_marksP) { return _marksP; }
        _marksP = _marksRead.then(function () {
            var was = _marks || {}, list = markSources(), next = {}, changed = false;
            if (!list.length && !Object.keys(was).length) { return false; }   // (no servers, none kept: nothing saved)
            Object.keys(was).forEach(function (id) { if (!list.some(function (x) { return x.id === id; })) { changed = true; } });
            return Promise.all(list.map(function (x) {
                var old = was[x.id];
                if (old && !force && Date.now() - old.at < MARKS_FRESH_MS) { next[x.id] = old; return null; }
                return x.read().then(function (m) {
                    if (!old || JSON.stringify(m) !== JSON.stringify(old.m)) { changed = true; }
                    next[x.id] = { at: Date.now(), m: m };
                }, function (e) {
                    if (old) { next[x.id] = old; }
                    U.log('jellyfin', '“' + x.name + '”: its watched marks couldn’t be read (' + U.problem(e) + ')');
                });
            })).then(function () {
                _marks = next;
                merge();
                saveMarks();
                return changed;
            });
        }).then(function (ch) { _marksP = null; return ch; }, function () { _marksP = null; return false; });
        return _marksP;
    }
    // When a server has it played (ms; 0: not, or not known): the latest of them.
    function watchedAt(type, id) { return _all[type + ':' + id] || 0; }

    // ---- Sources ----
    var EXT = { mkv: 'mkv', matroska: 'mkv', webm: 'webm', mp4: 'mp4', mov: 'mp4', m4v: 'mp4', avi: 'avi', mpegts: 'ts', ts: 'ts', m2ts: 'm2ts', mpeg: 'mpg', mpg: 'mpg', flv: 'flv', wmv: 'wmv', asf: 'wmv', ogg: 'ogv' };
    function extOf(c) { var f = ('' + (c || '')).toLowerCase().split(',')[0].trim(); return EXT[f] || (/^[a-z0-9]{2,5}$/.test(f) ? f : 'mkv'); }
    function quality(v) {
        var w = +(v && v.Width) || 0, h = +(v && v.Height) || 0;
        return w >= 3200 || h >= 1600 ? '4K' : w >= 1800 || h >= 900 ? '1080p' : w >= 1200 || h >= 600 ? '720p' : h > 0 ? h + 'p' : '';
    }
    function human(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB'; }
    var SUB_CODECS = /^(srt|subrip|ass|ssa|vtt|webvtt)$/i;
    function source(srv, it, ms) {
        var all = U.listOf(ms.MediaStreams, 200), v = all.filter(function (s) { return s.Type === 'Video'; })[0];
        var range = '' + ((v && (v.VideoRangeType || v.VideoRange)) || ''), hdr = /DOVI/i.test(range) ? 'DV' : /HDR|HLG/i.test(range) ? 'HDR' : '';
        var q = quality(v), ext = extOf(ms.Container), size = +ms.Size || 0;
        var file = ('' + (ms.Path || ms.Name || it.Name || '')).split(/[\/\\]/).pop() || ('' + it.Name);
        var st = {
            url: api(srv) + '/Videos/' + enc(it.Id) + '/stream.' + ext + '?static=true&mediaSourceId=' + enc(ms.Id) + '&' + K(srv).key + '=' + enc(srv.token),
            name: kindName(srv) + (q ? '\n' + q + (hdr ? ' ' + hdr : '') : ''),
            title: file + '\n' + srv.name + (size ? ' · 💾 ' + human(size) : '') + ' · ' + ext.toUpperCase(),
            behaviorHints: { filename: file, videoSize: size || undefined, bingeGroup: 'stremiok-jellyfin-' + srv.id },
            _jf: placeOf({ srv: srv.id, kind: kindOf(srv), item: '' + it.Id, ms: '' + ms.Id }, it.UserData)
        };
        var ch = chapterSegments(it), mk = markerSegments(it), named = namedChapters(it), tp = trickplayOf(srv, it, ms) || bifOf(srv, it, ms, v);
        if (ch) { st._jf.ch = ch; }
        if (mk) { st._jf.mk = mk; }
        if (named) { st._jf.chapters = named; }
        if (tp) { st._jf.tp = tp; }
        // its subtitle files (text ones), as SRT
        var subs = all.filter(function (s) { return s.Type === 'Subtitle' && s.IsExternal && SUB_CODECS.test('' + (s.Codec || '')) && s.Index >= 0; }).slice(0, 30).map(function (s) {
            return { id: 'jf' + s.Index, url: api(srv) + '/Videos/' + enc(it.Id) + '/' + enc(ms.Id) + '/Subtitles/' + (+s.Index) + K(srv).sub + '?' + K(srv).key + '=' + enc(srv.token),
                lang: ('' + (s.Language || '')).slice(0, 12) };
        });
        if (subs.length) { st.subtitles = subs; }
        return st;
    }
    // Where Jellyfin last had it (any of its apps): pos seconds (0: finished), at when.
    function placeOf(jf, ud) {
        var at = ud ? Date.parse(ud.LastPlayedDate || '') : 0;
        if (at > 0) { jf.at = at; jf.pos = ud.Played ? 0 : Math.max(0, Math.round((+ud.PlaybackPositionTicks || 0) / TICKS)); }
        return jf;
    }
    // Where to start a Jellyfin source: Jellyfin's place when it played it later than StremioK
    // did (by over SAME_MS: the two are told the same place on leaving), else StremioK's (own).
    var SAME_MS = 120000;
    function resumeFor(jf, entry, own) {
        if (!jf || !(jf.at > 0) || (entry && +entry.updated + SAME_MS >= jf.at)) { return own; }
        return jf.pos > 5 ? jf.pos : 0;
    }
    // The file's chapters named for an intro, a recap, the credits or a preview (a release's own
    // "Opening", "Recap", "End Credits"…; Jellyfin's "Chapter 3" isn't): each up to the next
    // chapter (the last, to the end). { intro: [{ start, end }], … } in seconds, or null.
    var CHAPTERS = [['intro', /^(intro|opening|opening (credits|titles|theme|song)|title sequence|main titles?|op)$/],
        ['recap', /^(recap|previously|previously on.*)$/], ['credits', /^(credits|end credits|ending|ending credits|closing credits|outro|ed)$/],
        ['preview', /^(preview|next time|next episode|coming up|next on.*)$/]];
    function isChapter(c) { return !c.MarkerType || c.MarkerType === 'Chapter'; }   // (Emby's markers are among its chapters)
    function chapterSegments(it) {
        var ch = U.listOf(it && it.Chapters, 200, function (c) { return c.Name != null && +c.StartPositionTicks >= 0 && isChapter(c); }).sort(function (a, b) { return a.StartPositionTicks - b.StartPositionTicks; });
        var end = +(it && it.RunTimeTicks) || 0, out = null;
        ch.forEach(function (c, i) {
            var name = ('' + c.Name).toLowerCase().replace(/[\s._-]+/g, ' ').trim(), kind = null;
            CHAPTERS.forEach(function (x) { if (!kind && x[1].test(name)) { kind = x[0]; } });
            var a = +c.StartPositionTicks / TICKS, b = (i + 1 < ch.length ? +ch[i + 1].StartPositionTicks : end) / TICKS;
            if (!kind || !(b > a)) { return; }
            out = out || {};
            (out[kind] = out[kind] || []).push({ start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 });
        });
        return out;
    }
    // Its chapters as the player shows a YouTube video's ([{ t, title }]), when one has a name of
    // its own: none for a file whose chapters are only numbered ("Chapter 3", "Chapter 03"), or
    // timed ("00:05:00.000"). Among named ones, a numbered one has none (the player calls it by
    // its place, "Chapter 3", not the file's "Chapter 04" left from before a chapter was added).
    var PLAIN_CHAPTER = /^((chapter|chapitre|kapitel|cap[ií]tulo|capitolo|hoofdstuk)\s*\d+|\d+|[\d:.]+)$/i;
    // Emby's intro and credits markers (its chapters' MarkerType: IntroStart, IntroEnd,
    // CreditsStart; the credits to the end): { intro, credits }, or null.
    function markerSegments(it) {
        var at = {}, end = +(it && it.RunTimeTicks) || 0, out = null;
        U.listOf(it && it.Chapters, 200, function (c) { return c.MarkerType && +c.StartPositionTicks >= 0; }).forEach(function (c) {
            if (at[c.MarkerType] == null) { at[c.MarkerType] = +c.StartPositionTicks / TICKS; }
        });
        if (at.IntroStart != null && at.IntroEnd > at.IntroStart) { out = { intro: [{ start: at.IntroStart, end: at.IntroEnd }] }; }
        if (at.CreditsStart != null && end / TICKS > at.CreditsStart) { (out = out || {}).credits = [{ start: at.CreditsStart, end: end / TICKS }]; }
        return out;
    }
    function namedChapters(it) {
        var list = U.listOf(it && it.Chapters, 200, function (c) { return c.Name != null && +c.StartPositionTicks >= 0 && isChapter(c); }).map(function (c) {
            return { t: Math.round(+c.StartPositionTicks / TICKS * 10) / 10, title: ('' + c.Name).replace(/\s+/g, ' ').trim().slice(0, 80) };
        }).sort(function (a, b) { return a.t - b.t; });
        if (list.length < 2 || !list.some(function (c) { return c.title && !PLAIN_CHAPTER.test(c.title); })) { return null; }
        list.forEach(function (c) { if (PLAIN_CHAPTER.test(c.title)) { c.title = ''; } });
        return list;
    }
    // Its seek pictures (trickplay, made by Jellyfin 10.9 and later when switched on): the set
    // nearest 320 wide. { w, h, cols, rows, n, every (ms), base (a tile's link, its number and
    // .jpg added) }, or null.
    function trickplayOf(srv, it, ms) {
        var sets = it && it.Trickplay && (it.Trickplay[ms.Id] || it.Trickplay[it.Id]), best = null;
        if (!sets || typeof sets !== 'object') { return null; }
        Object.keys(sets).forEach(function (k) {
            var x = sets[k];
            if (!x || !(+x.Width > 0) || !(+x.Height > 0) || !(+x.TileWidth > 0) || !(+x.TileHeight > 0) || !(+x.ThumbnailCount > 0) || !(+x.Interval > 0)) { return; }
            if (!best || Math.abs(x.Width - 320) < Math.abs(best.Width - 320)) { best = x; }
        });
        if (!best) { return null; }
        return { w: +best.Width, h: +best.Height, cols: +best.TileWidth, rows: +best.TileHeight, n: +best.ThumbnailCount, every: +best.Interval,
            base: api(srv) + '/Videos/' + enc(it.Id) + '/Trickplay/' + (+best.Width) + '/', q: '.jpg?mediaSourceId=' + enc(ms.Id) + '&' + K(srv).key + '=' + enc(srv.token) };
    }
    // Emby's seek pictures: its BIF file (the Roku format: the JPEGs and when each is), 320 wide,
    // read at the first ◀ ▶ (bifAt). Emby makes them where the library's thumbnail extraction is on.
    function bifOf(srv, it, ms, v) {
        if (kindOf(srv) !== 'emby' || !(+it.RunTimeTicks > 0)) { return null; }
        var w = +(v && v.Width) || 0, h = +(v && v.Height) || 0;
        return { bif: api(srv) + '/Videos/' + enc(it.Id) + '/index.bif?width=320&mediaSourceId=' + enc(ms.Id) + '&' + K(srv).key + '=' + enc(srv.token),
            w: 320, h: w > 0 && h > 0 ? Math.round(320 * h / w) : 180, cols: 1, rows: 1, every: 10000, n: 1 };
    }
    // The file being played's (one at a time): { url, p } while it's read, then { url, frames:
    // [{ t (ms), a, b (where its JPEG is) }], bytes, pics: the latest pictures' links }, or
    // { url, failed }.
    var BIF_MAX = 40 * 1048576, BIF_PICS = 12, BIF_MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], _bif = null;
    function parseBif(b) {
        for (var i = 0; i < 8; i++) { if (b[i] !== BIF_MAGIC[i]) { return null; } }
        function u32(o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
        var n = u32(12), every = u32(16) || 1000, out = [];
        for (var k = 0; k < n && 79 + k * 8 < b.length; k++) {
            var t = u32(64 + k * 8), a = u32(68 + k * 8), z = u32(76 + k * 8);
            if (t === 0xffffffff) { break; }
            if (z > a && z <= b.length) { out.push({ t: t * every, a: a, b: z }); }
        }
        return out;
    }
    function dropBif() {
        if (_bif && _bif.pics) { Object.keys(_bif.pics).forEach(function (k) { try { URL.revokeObjectURL(_bif.pics[k]); } catch (e) {} }); }
        _bif = null;
    }
    function loadBif(tp) {
        dropBif();
        var b = { url: tp.bif };
        _bif = b;
        b.p = U.getBytes(tp.bif, 30000, BIF_MAX, true).then(function (bytes) {
            var frames = parseBif(bytes);
            if (_bif !== b) { return; }
            if (!frames || !frames.length) { throw new Error('not a BIF file'); }
            b.frames = frames; b.bytes = bytes; b.pics = {}; b.order = [];
            if (frames.length > 1) { tp.every = Math.max(1000, Math.round((frames[frames.length - 1].t - frames[0].t) / (frames.length - 1))); }
            tp.n = frames.length;
        }).then(null, function (e) {
            if (_bif !== b) { return; }
            b.failed = true;
            U.log('jellyfin', 'Emby has no seek pictures for this file (' + (/HTTP 404/.test(e && e.message) ? 'none made: the library’s thumbnail extraction' : U.problem(e)) + ')');
        });
    }
    function bifPic(i) {
        var b = _bif, f = b.frames[i];
        if (b.pics[i]) { return b.pics[i]; }
        var url = null;
        try { url = URL.createObjectURL(new Blob([b.bytes.subarray(f.a, f.b)], { type: 'image/jpeg' })); } catch (e) { return null; }
        b.pics[i] = url;
        b.order.push(i);
        if (b.order.length > BIF_PICS) { var old = b.order.shift(); try { URL.revokeObjectURL(b.pics[old]); } catch (e2) {} delete b.pics[old]; }
        return url;
    }
    function bifAt(tp, sec) {
        if (!_bif || _bif.url !== tp.bif) { loadBif(tp); return null; }
        var f = _bif.frames;
        if (!f) { return null; }
        var ms = sec * 1000, lo = 0, hi = f.length - 1;
        while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (f[mid].t <= ms) { lo = mid; } else { hi = mid - 1; } }
        var url = bifPic(lo);
        return url ? { url: url, x: 0, y: 0, w: tp.w, h: tp.h, cols: 1, rows: 1 } : null;
    }
    // The seek picture for a moment (seconds): its tile's link and where in it, or null.
    // (tp.one: a picture a link, base + its moment in ms, as Plex's are; tp.bif: Emby's file)
    function trickplayAt(tp, sec) {
        if (!tp || !(sec >= 0)) { return null; }
        if (tp.bif) { return bifAt(tp, sec); }
        var i = Math.min(tp.n - 1, Math.floor(sec * 1000 / tp.every)), per = tp.cols * tp.rows, at = i % per;
        if (tp.one) { return { url: tp.base + (i * tp.every) + tp.q, x: 0, y: 0, w: tp.w, h: tp.h, cols: 1, rows: 1 }; }
        return { url: tp.base + Math.floor(i / per) + tp.q, x: (at % tp.cols) * tp.w, y: Math.floor(at / tp.cols) * tp.h, w: tp.w, h: tp.h, cols: tp.cols, rows: tp.rows };
    }
    // Its media segments (Jellyfin 10.10 and later, made by a plugin such as Intro Skipper) or
    // markers (Emby's, Plex's), else its file's chapters (chapterSegments), as the skip-time
    // services give theirs (seconds); null without any. asked: Diagnostics' line.
    var SEG_TYPES = { Intro: 'intro', Recap: 'recap', Outro: 'credits', Preview: 'preview' };
    function segments(jf, asked) {
        var plex = !!jf && jf.kind === 'plex', srv = jf && !plex ? server(jf.srv) : null, name = plex ? 'Plex' : srv ? kindName(srv) : '';
        if (!srv && !plex) { return Promise.resolve(null); }
        function done(out, has, why) {
            var ch = jf.ch || {}, more = [];
            out = out || { intro: [], recap: [], credits: [], preview: [], from: {} };
            ['intro', 'recap', 'credits', 'preview'].forEach(function (k) {
                if (!out[k].length && U.listOf(ch[k], 10).length) { out[k] = U.listOf(ch[k], 10); out.from[k] = name + '’s chapters'; more.push(k); }
            });
            if (asked) { asked.push(name + ': ' + (has.length ? has.join(', ') : why) + (more.length ? '; its chapters: ' + more.join(', ') : '')); }
            return has.length || more.length ? out : null;
        }
        if (plex || kindOf(srv) === 'emby') {   // (its markers, read with its details: nothing to ask)
            var out = { intro: [], recap: [], credits: [], preview: [], from: {} }, has = [];
            ['intro', 'credits'].forEach(function (k) { if (jf.mk && U.listOf(jf.mk[k], 4).length) { out[k] = U.listOf(jf.mk[k], 4); out.from[k] = name; has.push(k); } });
            return Promise.resolve(done(out, has, 'no intro or credits markers'));
        }
        return U.getJSON(api(srv) + '/MediaSegments/' + enc(jf.item), 8000, 262144, null, headers(srv, srv.token), null, true).then(function (r) {
            var out = { intro: [], recap: [], credits: [], preview: [], from: {} }, has = [];
            U.listOf(r && r.Items, 40).forEach(function (g) {
                var k = SEG_TYPES[g.Type], a = +g.StartTicks / TICKS, b = +g.EndTicks / TICKS;
                if (!k || !(a >= 0) || !(b > a)) { return; }
                out[k].push({ start: a, end: b });
                out.from[k] = 'Jellyfin';
                if (has.indexOf(k) === -1) { has.push(k); }
            });
            return done(out, has, 'no media segments');
        }, function (e) {
            return done(null, [], /HTTP 404/.test(e && e.message) ? 'no media segments (before 10.10)' : U.problem(e));
        });
    }
    function sourcesOf(srv, it) {
        if (!it || !it.Id) { return []; }
        return U.listOf(it.MediaSources, 16, function (ms) { return ms.Id; }).map(function (ms) { return source(srv, it, ms); });
    }
    function episodeSources(srv, sid, season, episode) {
        return episodes(srv, sid).then(function (eps) {
            var e = eps.filter(function (x) { return x.season === season && x.episode === episode; })[0];
            return e ? filesOf(srv, e.it) : [];
        }).then(null, none);
    }
    // A title's sources: its own (jfm / jfs ids), or the servers' copies (of that kind: each
    // kind's addon asks for its own) of a title from your addons.
    // meta: the title's details (its name: lookup).
    function streams(type, id, kind, meta) {
        var x = parseId(id);
        if (x) {
            if (!x.srv) { return Promise.resolve([]); }
            if (x.kind === 'm') { return item(x.srv, x.item).then(function (it) { return filesOf(x.srv, it); }).then(null, none); }
            return x.season != null ? episodeSources(x.srv, x.item, x.season, x.episode) : Promise.resolve([]);
        }
        return copies(type, id, kind, meta);
    }
    function isJellyfinId(id) { return /^jf[ms]\./.test('' + id); }
    function nameOfId(id) { var x = parseId(id); return x && x.srv ? kindName(x.srv) : 'Jellyfin'; }
    // The kind of server a source is from, by name ("Jellyfin", "Emby", "Plex").
    function sourceKind(jf) { return jf && jf.kind === 'plex' ? 'Plex' : jf && KINDS[jf.kind] ? KINDS[jf.kind].name : 'Jellyfin'; }

    // ---- What you play, back to Jellyfin (its sessions) ----
    // From the player (player-core): 'progress' as it plays, 'pause', 'stop' on leaving,
    // 'watched' at the credits. Started once it's playing; where it is every REPORT_EVERY and on
    // pausing or carrying on. Nothing during private viewing, for a trailer, or another source.
    var _play = null;
    function report(p, path, cur) {
        var srv = server(p.srv);
        if (!srv) { return; }
        var b = { ItemId: p.item, MediaSourceId: p.ms, PlaySessionId: p.sid, PositionTicks: Math.max(0, Math.round((cur || 0) * TICKS)) };
        if (path !== '/Sessions/Playing/Stopped') { b.CanSeek = true; b.IsPaused = !!p.paused; b.PlayMethod = 'DirectPlay'; }
        post(srv, path, b).then(null, function (e) { U.log('jellyfin', '“' + srv.name + '” wasn’t told where you are (' + U.problem(e) + ')'); });
    }
    function stopNow(cur) {
        var p = _play;
        _play = null;
        if (p && p.started) { report(p, '/Sessions/Playing/Stopped', cur != null ? cur : p.cur); }
    }
    function onPlayer(ev, ctx, cur, dur, paused) {
        if (typeof Plex !== 'undefined' && Plex.onPlayer) { try { Plex.onPlayer(ev, ctx, cur, dur, paused); } catch (e) {} }   // (a Plex source: told to Plex)
        var jf = ctx && !ctx.private && !ctx.trailer && ctx.stream && ctx.stream._jf, srv = jf && jf.kind !== 'plex' && server(jf.srv);
        if (ev === 'watched') {
            if (srv) { post(srv, K(srv).played(uid(srv), enc(jf.item)), null).then(null, function (e) { U.log('jellyfin', '“' + srv.name + '”: not marked played (' + U.problem(e) + ')'); }); }
            return;
        }
        if (ev === 'stop') { dropBif(); }   // (Emby's seek pictures: given up with the playback)
        if (_play && (!srv || _play.ctx !== ctx || _play.item !== jf.item || _play.ms !== jf.ms)) { stopNow(); }   // (another playback, or another source)
        if (!srv || ev === 'stop') { if (ev === 'stop') { stopNow(cur); } return; }
        if (!_play) { _play = { ctx: ctx, srv: srv.id, item: jf.item, ms: jf.ms, sid: rand(32), started: false, sent: 0, paused: false, cur: 0 }; }
        var p = _play, now = Date.now(), pz = ev === 'pause' || !!paused;
        if (cur > 0) { p.cur = cur; }
        if (!(cur > 0)) { return; }   // (not playing yet)
        if (!p.started) { p.started = true; p.sent = now; p.paused = pz; report(p, '/Sessions/Playing', cur); return; }
        if (pz !== p.paused || now - p.sent >= REPORT_EVERY) { p.sent = now; p.paused = pz; report(p, '/Sessions/Playing/Progress', cur); }
    }

    return {
        servers: servers, allServers: allServers, server: server, setOn: setOn, isEnabled: isEnabled, onChange: onChange, normAddress: normAddress, addressProblem: addressProblem, probe: probe,
        signIn: signIn, quickConnect: quickConnect, remove: remove, reload: reload, libraries: libsOf, synthAddon: synthAddon, synthAddons: synthAddons, kindsOn: kindsOn,
        kindName: kindName, nameOfId: nameOfId, catalog: catalog, meta: meta, streams: streams, isJellyfinId: isJellyfinId, onPlayer: onPlayer, resumeFor: resumeFor,
        segments: segments, trickplayAt: trickplayAt, waitMs: waitMs, sourceKind: sourceKind, refreshMarks: refreshMarks, watchedAt: watchedAt,
        shared: { chapterSegments: chapterSegments, namedChapters: namedChapters, marksFrom: marksFrom }   // (Plex's chapters and watched marks read the same way)
    };
})();
