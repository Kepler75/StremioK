/* A profile kept in step with a Nuvio account's profile (Settings › Profiles › + Add a profile ›
   A Nuvio account, or Settings › Content › Integrations › Nuvio account; #23): where you stopped and
   what you've watched, both ways. Signing in is the import's (js/nuvio-import.js: Nuvio's TV
   sign-in, approved on your phone); here its session is kept, for this StremioK profile only, and
   renewed as it runs out.
   - Each sync (launch, every EVERY_MS, a few seconds after playing or marking, before switching
     profile): first what changed here since the last one (progress, watched marks: a mark taken
     off as Nuvio's removed) goes to Nuvio; then what changed there comes here, the newer winning
     (a title new here gets its name and poster from this profile's addons, a few each time).
     Something Nuvio sent isn't sent back.
   - Its Library too: what you add or remove here goes first, then Nuvio's whole Library comes
     back as it now is (its own rows on Home and Discover: Nuvio Library).
   - Only films and series with an IMDb id (tt…), as Nuvio keeps them.
   - Nuvio's backend (github.com/NuvioMedia/self-host, Apache License 2.0, by Nuvio) as its hosted
     service publishes it; StremioK isn't affiliated with Nuvio, and this may stop working if
     Nuvio changes it. The session is a whole Nuvio account's: Disconnect signs it out and forgets it.
   Global namespace: NuvioSync */
var NuvioSync = (function () {
    'use strict';
    var KEY = 'stremiok.nuvio';               // { url, key, access, refresh, exp, profile (Nuvio's 1-6), name, at }
    var STATE_KEY = 'stremiok.nuvio.sync';    // { last, pushed, pulled, err, reconnect }
    var EVERY_MS = 15 * 60 * 1000, SOON_MS = 10000, META_PER_SYNC = 30, PROGRESS_PULL = 300, WATCHED_PULL = 20000, MAX = 4 * 1048576;
    var TT = /^tt\d{1,12}$/;
    var LIB_KEY = 'stremiok.nuvio.library';   // { items: { 'type:id': { id, type, name, poster, background, added } }, out: { 'type:id': true (add) | false (remove) } }
    var LIB_PAGE = 500, LIB_MAX = 2000;

    function auth() { var a = U.store.get(KEY, null); return (a && typeof a.access === 'string' && a.access && typeof a.url === 'string') ? a : null; }
    function isConnected() { return !!auth(); }
    function state() { var s = U.store.get(STATE_KEY, null); return (s && typeof s === 'object') ? s : {}; }
    function setState(patch) { var s = state(); Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); U.store.set(STATE_KEY, s); }
    function connectStatus() { var a = auth() || {}, s = state(); return { connected: !!a.access, name: a.name || '', reconnect: !!s.reconnect, lastSync: s.last || 0, err: s.err || '' }; }

    // The session kept for a profile: this one (slot undefined), or a new one's (its slot), from the
    // sign-in (cfg: NuvioImport.discover's; s: NuvioImport.wait's) and the Nuvio profile it follows.
    function record(cfg, s, p) { return { url: cfg.url, key: cfg.key, access: s.access, refresh: s.refresh, exp: s.expires, profile: p.index, name: p.name, at: Date.now() }; }
    function connectFor(slot, cfg, s, p) {
        try { window.localStorage.setItem(Profiles.keyFor(slot, KEY), JSON.stringify(record(cfg, s, p))); } catch (e) {}
    }
    function connect(cfg, s, p) {
        U.store.set(KEY, record(cfg, s, p));
        U.store.remove(STATE_KEY); U.store.remove(LIB_KEY);
        setState({ pushed: Date.now() });   // (what's here already isn't all sent: from now on)
        return sync();
    }
    function disconnect() {
        var a = auth();
        U.store.remove(KEY); U.store.remove(STATE_KEY); U.store.remove(LIB_KEY);
        libChanged();
        if (a) { ask(a, '/auth/v1/logout', {}, a.access).then(null, function () {}); }
    }

    // ---- talking to it ----
    function ask(a, path, body, token) {
        var h = { apikey: a.key, Authorization: 'Bearer ' + (token || a.key), 'Content-Type': 'application/json' };
        return U.getJSON(a.url + path, 20000, MAX, null, h, body == null ? undefined : JSON.stringify(body), true);
    }
    // A fresh session (renewed when within a minute of running out, or refused): its token.
    function renew(a) {
        if (!a.refresh) { return Promise.reject(new Error('no refresh')); }
        return ask(a, '/auth/v1/token?grant_type=refresh_token', { refresh_token: a.refresh }).then(function (t) {
            if (!t || typeof t.access_token !== 'string') { throw new Error('refused'); }
            a.access = t.access_token; a.refresh = typeof t.refresh_token === 'string' ? t.refresh_token : a.refresh;
            a.exp = Date.now() + Math.max(60, +t.expires_in || 3600) * 1000;
            U.store.set(KEY, a);
            return a.access;
        }, function (e) { if (/HTTP 40[01]/.test((e && e.message) || '')) { setState({ reconnect: true, err: U.t('Its sign-in no longer works') }); } throw e; });
    }
    function token(a) { return a.exp && a.exp - Date.now() > 60000 ? Promise.resolve(a.access) : renew(a); }
    function rpc(a, fn, params) {
        return token(a).then(function (t) {
            return ask(a, '/rest/v1/rpc/' + fn, params || {}, t).then(null, function (e) {
                if (!/HTTP 401/.test((e && e.message) || '')) { throw e; }
                return renew(a).then(function (t2) { return ask(a, '/rest/v1/rpc/' + fn, params || {}, t2); });
            });
        });
    }

    // ---- here and there ----
    function epOf(id) { var m = /^(tt\d+):(\d+):(\d+)$/.exec('' + id); return m ? { id: m[1], s: +m[2], e: +m[3] } : null; }
    function progressKey(contentId, s, e) { return s ? contentId + '_s' + s + 'e' + e : contentId; }
    // What changed here since `since`: { progress: [Nuvio entries], watched: [items], unwatched: [keys] }.
    function changes(since) {
        var out = { progress: [], watched: [], unwatched: [] };
        var prog = U.store.get('stremiok.progress', {}) || {};
        Object.keys(prog).forEach(function (k) {
            var x = prog[k];
            if (!x || !(x.updated > since) || x.updated === x.nv || !(x.position > 0)) { return; }
            var ep = x.type === 'series' ? epOf(x.id) : null, cid = ep ? ep.id : '' + x.id;
            if ((x.type !== 'movie' && !ep) || !TT.test(cid)) { return; }
            out.progress.push({ content_id: cid, content_type: x.type, video_id: '' + x.id, season: ep ? ep.s : null, episode: ep ? ep.e : null,
                position: Math.round(x.position * 1000), duration: Math.round((x.duration || 0) * 1000), last_watched: x.updated, progress_key: progressKey(cid, ep && ep.s, ep && ep.e) });
        });
        var w = U.store.get('stremiok.watched', {}) || {}, from = U.store.get('stremiok.nuvio.marks', {}) || {};
        Object.keys(w).forEach(function (k) {
            var v = w[k], m = /^(movie|series):(tt\d+)(?::(\d+):(\d+))?$/.exec(k);
            if (!m || !(Math.abs(v) > since) || from[k] === v) { return; }
            if (m[1] === 'series' && !m[3]) { return; }
            if (v > 0) { out.watched.push({ content_id: m[2], content_type: m[1], title: '', season: m[3] ? +m[3] : null, episode: m[4] ? +m[4] : null, watched_at: v }); }
            else { out.unwatched.push({ content_id: m[2], season: m[3] ? +m[3] : null, episode: m[4] ? +m[4] : null }); }
        });
        return out;
    }
    // ---- its Library ----
    function lib() { var l = U.store.get(LIB_KEY, null); return { items: (l && l.items && typeof l.items === 'object') ? l.items : {}, out: (l && l.out && typeof l.out === 'object') ? l.out : {} }; }
    function libSave(l) { U.store.set(LIB_KEY, l); }
    function inLibrary(type, id) { return !!lib().items[type + ':' + id]; }
    function setInLibrary(type, meta, on) {
        if (!isConnected() || (type !== 'movie' && type !== 'series') || !meta || !meta.id) { return; }
        var l = lib(), k = type + ':' + meta.id;
        if (on) { l.items[k] = { id: '' + meta.id, type: type, name: ('' + (meta.name || meta.title || '')).slice(0, 200), poster: meta.poster || '', background: meta.background || '', added: Date.now() }; }
        else { delete l.items[k]; }
        l.out[k] = !!on;
        libSave(l);
        libChanged();
        soon();
    }
    function libChanged() {
        if (typeof Stremio !== 'undefined' && Stremio.addonsChanged) { Stremio.addonsChanged(); }
        if (typeof ViewParts !== 'undefined' && ViewParts.refreshAddonRows) { ViewParts.refreshAddonRows('local:nuvio'); }
    }
    // What was added or removed here goes; then its whole Library, as Nuvio now has it.
    function libSync(a) {
        var l = lib(), adds = [], dels = [], sent = {};
        Object.keys(l.out).forEach(function (k) {
            var m = /^(movie|series):(.+)$/.exec(k);
            if (!m) { return; }
            sent[k] = l.out[k];
            if (l.out[k] && l.items[k]) { var it = l.items[k]; adds.push({ content_id: it.id, content_type: it.type, name: it.name, poster: it.poster || null, poster_shape: 'POSTER', background: it.background || null, added_at: it.added }); }
            else if (!l.out[k]) { dels.push({ content_id: m[2], content_type: m[1] }); }
        });
        var sends = [];
        if (adds.length) { sends.push(rpc(a, 'sync_push_library_items', { p_items: adds, p_profile_id: a.profile })); }
        if (dels.length) { sends.push(rpc(a, 'sync_delete_library_items', { p_keys: dels, p_profile_id: a.profile })); }
        return Promise.all(sends).then(function () {
            var got = [];
            function page(off) {
                return rpc(a, 'sync_pull_library', { p_profile_id: a.profile, p_limit: LIB_PAGE, p_offset: off }).then(function (r) {
                    var rows = U.listOf(r, LIB_PAGE, function (x) { return x && typeof x.content_id === 'string' && x.content_id && (x.content_type === 'movie' || x.content_type === 'series'); });
                    got = got.concat(rows);
                    return rows.length === LIB_PAGE && got.length < LIB_MAX ? page(off + LIB_PAGE) : got;
                });
            }
            return page(0);
        }).then(function (rows) {
            var now = lib(), items = {};
            rows.forEach(function (x) {
                var at = +x.added_at || 0;
                items[x.content_type + ':' + x.content_id] = { id: x.content_id, type: x.content_type, name: U.drawable('' + (x.name || '')).slice(0, 200), poster: typeof x.poster === 'string' ? x.poster : '',
                    background: typeof x.background === 'string' ? x.background : '', added: at < 1e11 ? at * 1000 : at };
            });
            // (a change made here meanwhile: kept, and sent next time)
            Object.keys(now.out).forEach(function (k) {
                if (k in sent && sent[k] === now.out[k]) { delete now.out[k]; return; }
                if (now.out[k] && now.items[k]) { items[k] = now.items[k]; } else if (!now.out[k]) { delete items[k]; }
            });
            var before = JSON.stringify(Object.keys(now.items).sort()), after = JSON.stringify(Object.keys(items).sort());
            libSave({ items: items, out: now.out });
            if (before !== after) { libChanged(); return true; }
            return false;
        });
    }
    function libCatalog(catId, extra) {
        var type = catId === 'nuvio_library_movies' ? 'movie' : 'series', skip = (extra && +extra.skip) || 0, items = lib().items;
        var list = Object.keys(items).map(function (k) { return items[k]; }).filter(function (it) { return it.type === type; });
        list.sort(function (x, y) { return (y.added || 0) - (x.added || 0); });
        return Promise.resolve(list.slice(skip, skip + 100).map(function (it) { return { id: it.id, type: it.type, name: it.name || it.id, poster: it.poster, background: it.background, posterShape: 'poster' }; }));
    }
    // Its Library as an addon of StremioK's own (rows on Home and Discover), while connected.
    function synthAddon() {
        return {
            __local: true, __impl: { catalog: libCatalog }, url: 'local:nuvio', base: 'local:nuvio',
            manifest: { id: 'org.stremiok.nuvio-library', name: U.t('Nuvio Library'), version: '1.0.0', types: ['movie', 'series'], resources: ['catalog'],
                catalogs: [{ type: 'movie', id: 'nuvio_library_movies', name: U.t('Nuvio Library'), extra: [{ name: 'skip' }] },
                    { type: 'series', id: 'nuvio_library_shows', name: U.t('Nuvio Library'), extra: [{ name: 'skip' }] }] }
        };
    }

    var _busy = null, _timer = null;
    // One sync (one at a time: asked again meanwhile, the same one): resolves either way.
    function sync() {
        var a = auth();
        if (!a || state().reconnect) { return Promise.resolve(false); }
        if (_busy) { return _busy; }
        var started = Date.now(), st = state(), c = changes(st.pushed || started), idx = a.profile;
        var sends = [];
        if (c.progress.length) { sends.push(rpc(a, 'sync_push_watch_progress', { p_entries: c.progress, p_profile_id: idx })); }
        if (c.watched.length) { sends.push(rpc(a, 'sync_push_watched_items', { p_items: c.watched, p_profile_id: idx })); }
        if (c.unwatched.length) { sends.push(rpc(a, 'sync_delete_watched_items', { p_keys: c.unwatched, p_profile_id: idx })); }
        _busy = Promise.all(sends).then(function () {
            setState({ pushed: started });
            return Promise.all([
                rpc(a, 'sync_pull_watch_progress', { p_profile_id: idx, p_limit: PROGRESS_PULL }),
                rpc(a, 'sync_pull_watched_items', { p_profile_id: idx, p_page: 1, p_page_size: WATCHED_PULL })
            ]);
        }).then(function (r) { return pullIn(r[0], r[1]); }).then(function (changed) {
            return libSync(a).then(function (l) { return changed || l; });
        }).then(function (changed) {
            setState({ last: Date.now(), err: '' });
            return changed;
        }, function (e) {
            if (!state().reconnect) { setState({ err: (e && e.message) || U.t('unknown') }); }
            U.log('nuvio', 'Nuvio sync failed: ' + ((e && e.message) || 'unknown'));
            return false;
        }).then(function (v) { _busy = null; return v; });
        return _busy;
    }
    // What Nuvio has, merged in (the newer wins): true when something changed here.
    function pullIn(progress, watched) {
        var changed = false, w = U.store.get('stremiok.watched', {}) || {}, from = U.store.get('stremiok.nuvio.marks', {}) || {};
        U.listOf(watched, WATCHED_PULL, function (x) { return x && TT.test(x.content_id || '') && (x.content_type === 'movie' || x.content_type === 'series'); }).forEach(function (x) {
            var ep = x.content_type === 'series' && x.season > 0 && x.episode > 0;
            if (x.content_type === 'series' && !ep) { return; }
            var k = x.content_type + ':' + x.content_id + (ep ? ':' + x.season + ':' + x.episode : ''), when = +x.watched_at || 0;
            if (when < 1e11) { when *= 1000; }
            if (!w[k] || when > Math.abs(w[k])) { w[k] = when; from[k] = when; changed = true; }
        });
        if (changed) { U.store.set('stremiok.watched', w); U.store.set('stremiok.nuvio.marks', from); }
        var prog = U.store.get('stremiok.progress', {}) || {}, want = [];
        U.listOf(progress, PROGRESS_PULL, function (x) { return x && TT.test(x.content_id || '') && (x.content_type === 'movie' || x.content_type === 'series') && +x.position > 0; }).forEach(function (x) {
            var ep = x.content_type === 'series' && x.season > 0 && x.episode > 0;
            if (x.content_type === 'series' && !ep) { return; }
            var id = ep ? x.content_id + ':' + x.season + ':' + x.episode : x.content_id, k = x.content_type + ':' + id, at = +x.last_watched || 0;
            if (at < 1e11) { at *= 1000; }
            var mine = prog[k];
            if (mine && (mine.updated || 0) >= at) { return; }
            var done = w[k] > 0 && w[k] >= at;   // (watched since: not brought back to Continue Watching)
            if (done) { return; }
            want.push({ k: k, x: x, id: id, ep: ep, at: at, mine: mine });
        });
        if (!want.length) { return Promise.resolve(changed); }
        want.sort(function (p, q) { return q.at - p.at; });
        var named = want.filter(function (y) { return y.mine && y.mine.name; }), unnamed = want.filter(function (y) { return !(y.mine && y.mine.name); }).slice(0, META_PER_SYNC);
        return Promise.all(unnamed.map(function (y) {
            return Promise.resolve(typeof Stremio !== 'undefined' && Stremio.getMeta ? Stremio.getMeta(y.x.content_type, y.x.content_id) : null).then(function (m) { y.meta = m; }, function () {});
        })).then(function () {
            prog = U.store.get('stremiok.progress', {}) || {};
            named.concat(unnamed).forEach(function (y) {
                var x = y.x, m = y.meta, ms = (+x.duration || 0) > 86400 || (+x.position || 0) > 86400;
                var name = y.mine && y.mine.name ? y.mine.name : m && m.name ? (y.ep ? m.name + '  S' + x.season + 'E' + x.episode : m.name) : '';
                if (!name) { return; }
                prog[y.k] = Object.assign({}, y.mine || {}, { id: y.id, type: x.content_type, name: name, poster: (y.mine && y.mine.poster) || (m && m.poster), background: (y.mine && y.mine.background) || (m && m.background),
                    parent: y.ep ? x.content_id : undefined, position: Math.floor(ms ? x.position / 1000 : x.position), duration: Math.floor(ms ? x.duration / 1000 : x.duration), updated: y.at, nv: y.at });
                changed = true;
            });
            U.store.set('stremiok.progress', prog);
            return changed;
        });
    }
    // Something changed here (played, marked): a sync a few seconds later.
    function soon() {
        if (!isConnected()) { return; }
        if (_timer) { clearTimeout(_timer); }
        _timer = setTimeout(function () { _timer = null; sync(); }, SOON_MS);
    }
    var _every = null;
    function start(onChanged) {
        if (!isConnected() || _every) { return; }
        function go() { sync().then(function (ch) { if (ch && onChanged) { onChanged(); } }); }
        go();
        _every = setInterval(go, EVERY_MS);
    }
    // The kept session, renewed if need be, for a read of the import's: { cfg, token, profile }.
    function session() {
        var a = auth();
        if (!a || state().reconnect) { return Promise.reject(new Error(U.t('Its sign-in no longer works'))); }
        return token(a).then(function (t) { return { cfg: { url: a.url, key: a.key }, token: t, profile: a.profile }; });
    }
    return { session: session, inLibrary: inLibrary, setInLibrary: setInLibrary, synthAddon: synthAddon, isConnected: isConnected, connectStatus: connectStatus, connect: connect, connectFor: connectFor, disconnect: disconnect, sync: sync, soon: soon, start: start, KEY: KEY };
})();
