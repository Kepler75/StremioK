/* Trakt integration. Global namespace: Trakt
   Uses the OAuth device-code flow (TV-friendly: a code to enter at Trakt's activate
   page). StremioK is the Trakt app: its Client ID is built in (a public client: Trakt
   gives apps installed on people's devices no secret, they sign in with PKCE / the device
   flow), and each person signs in to their own Trakt account with it. Its caches are kept on
   the TV (the watched history, which can be large, in the TV's database, the rest in local
   storage) so isWatched()/continueList() are synchronous for rendering; refreshCaches()
   repopulates them from the API (one at a time). What you change here (watched, not watched,
   where you stopped) goes through an outbox: sent, retried with growing waits until Trakt
   confirms it, shown in Settings while it's waiting or if it failed. Everything Trakt answers
   is size-limited and checked (types, IMDb ids, numbers, string lengths) before it's kept. */
var Trakt = (function () {
    'use strict';

    var BASE = 'https://api.trakt.tv';
    var TOK_KEY = 'stremiok.trakt';           // { access_token, refresh_token, expires_at, user }
    var WATCHED_KEY = 'stremiok.trakt.watched';   // { 'movie:tt..': when, 'series:tt..:S:E': when } (in the TV's database)
    var PLAYBACK_KEY = 'stremiok.trakt.playback'; // [ CW entries ]
    var RATINGS_KEY = 'stremiok.trakt.ratings';   // { 'movie:tt…' | 'series:tt…' | 'season:tt…:N': 1-10 }: yours
    var WATCHLIST_KEY = 'stremiok.trakt.watchlist';   // { movie: [items], series: [items] }, Trakt's order
    var UPNEXT_KEY = 'stremiok.trakt.upnext';         // [ { imdb, title, year, season, episode, epTitle } ]
    var SHOWS_KEY = 'stremiok.trakt.shows';           // shows you've watched, the latest first: [ { trakt, imdb, title, year } ]
    var UPNEXT_SHOWS = 15;                            // (each one is a request)
    var DISMISSED_KEY = 'stremiok.trakt.dismissed';   // { 'type:id': when you removed it from Continue Watching }
    var DISMISSED_MAX = 300;
    var OUTBOX_KEY = 'stremiok.trakt.outbox';         // [ { id, kind: add | remove | progress, body, keys, tries, next, failed } ]
    var SYNC_KEY = 'stremiok.trakt.sync';             // { last: when Trakt last answered a refresh, reconnect: true when the sign-in no longer works }
    var MAX_BYTES = 8 * 1024 * 1024;                  // a Trakt answer larger than this is refused
    var CHUNK = 100;                                  // titles / episodes per history request
    var OUTBOX_MAX = 200, TRIES_MAX = 8;

    var APP_CLIENT_ID = 'lMXMadihwPmMgQikkqbyUd7ONDPZ9tNz3RkROJ8B4HE';   // StremioK's Trakt app (public: an id, not a secret)
    function getCreds() { return { id: APP_CLIENT_ID, secret: '' }; }
    function hasCreds() { return !!getCreds().id; }
    // client_id, and client_secret when the app has one (Trakt's PKCE apps don't)
    function client(o) { var c = getCreds(); o.client_id = c.id; if (c.secret) { o.client_secret = c.secret; } return o; }

    // The sign-in's generation: disconnecting, or signing in, starts a new one. Work started
    // for an older one (a token renewal, a refresh, a change being sent) changes nothing when
    // its answer comes: each checks current(g) before it writes.
    var _gen = 0;
    function current(g) { return g === _gen; }
    var STALE = { status: 0, stale: true };
    function live(g) { if (!current(g)) { throw STALE; } }

    function tokens() { return U.store.get(TOK_KEY, null); }
    function saveTokens(resp, user) {
        if (!resp || !resp.access_token) { return; }
        var t = {
            access_token: resp.access_token,
            refresh_token: resp.refresh_token || (tokens() ? tokens().refresh_token : ''),
            expires_at: Date.now() + ((resp.expires_in || 7776000) * 1000),
            user: user || (tokens() ? tokens().user : '')
        };
        U.store.set(TOK_KEY, t);
        if (needsReconnect()) { setSyncState({ reconnect: false }); }
        _toldReconnect = false;
    }
    function isConnected() { var t = tokens(); return !!(t && t.access_token); }
    function connectStatus() {
        var t = tokens() || {}, box = outbox();
        var failed = box.filter(function (x) { return x.failed; });
        return { connected: !!t.access_token, user: t.user || '', reconnect: needsReconnect(), lastSync: syncState().last || 0,
            pending: box.filter(function (x) { return !x.failed; }).length, failed: failed.length,
            failedItems: failed.map(function (x) { return { what: what(x), title: titleOf(x), err: x.err || '' }; }) };
    }

    function poster(imdb) { return imdb ? ('https://images.metahub.space/poster/small/' + imdb + '/img') : ''; }

    // ---- HTTP (XHR with Trakt headers; POST bodies as JSON) ----
    function req(method, path, body, auth) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            try { xhr.open(method, BASE + path, true); } catch (e) { reject({ status: 0 }); return; }
            xhr.timeout = 15000;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('trakt-api-version', '2');
            var c = getCreds();
            if (c.id) { xhr.setRequestHeader('trakt-api-key', c.id); }
            if (auth) { var t = tokens(); if (t && t.access_token) { xhr.setRequestHeader('Authorization', 'Bearer ' + t.access_token); } }
            var done = false;
            xhr.onprogress = function (ev) {   // (an answer too large to keep: refused, not read)
                var got = (ev && ev.loaded) || ('' + (xhr.responseText || '')).length;
                if (!done && got > MAX_BYTES) { done = true; try { xhr.abort(); } catch (e4) {} reject({ status: 0, tooBig: true }); }
            };
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || done) { return; }
                done = true;
                var text = '' + (xhr.responseText || ''), data = null;
                if (text.length > MAX_BYTES) { reject({ status: 0, tooBig: true }); return; }
                var bad = false;
                try { data = text ? JSON.parse(text) : null; } catch (e2) { bad = true; }
                var retry = 0;
                try { retry = parseInt(xhr.getResponseHeader('Retry-After'), 10) || 0; } catch (e5) {}
                var pages = 0, limit = 0;   // (a list sent a page at a time: how many pages, how many a page)
                try { pages = parseInt(xhr.getResponseHeader('X-Pagination-Page-Count'), 10) || 0; limit = parseInt(xhr.getResponseHeader('X-Pagination-Limit'), 10) || 0; } catch (e6) {}
                if (xhr.status >= 200 && xhr.status < 300) { resolve({ status: xhr.status, data: data, bad: bad, pages: pages, limit: limit }); }
                else { reject({ status: xhr.status, data: data, retryAfter: retry }); }
            };
            xhr.ontimeout = function () { if (!done) { done = true; reject({ status: 0, timeout: true }); } };
            xhr.onerror = function () { if (!done) { done = true; reject({ status: 0, error: true }); } };
            try { xhr.send(body != null ? JSON.stringify(body) : null); } catch (e3) { reject({ status: 0 }); }
        });
    }

    // ---- sync state: when Trakt last answered, and whether the sign-in still works ----
    function syncState() { var x = U.store.get(SYNC_KEY, null); return (x && typeof x === 'object') ? x : {}; }
    function setSyncState(patch) { var x = syncState(); Object.keys(patch).forEach(function (k) { x[k] = patch[k]; }); U.store.set(SYNC_KEY, x); }
    function needsReconnect() { return !!syncState().reconnect; }
    var _toldReconnect = false;
    function lostSignIn() {   // (401 / 403, or the token can't be renewed: nothing more is sent until you connect again)
        if (!isConnected()) { return; }
        if (!needsReconnect()) { setSyncState({ reconnect: true }); }
        if (!_toldReconnect) { _toldReconnect = true; U.toast('Trakt needs reconnecting: Settings › Content › Integrations', 6000); U.log('trakt', 'Trakt sign-in no longer works: reconnect in Settings'); }
    }

    // Renew the access token when it's near expiry. A renewal Trakt refuses means the sign-in
    // is gone (reconnect); one that can't reach Trakt keeps the token only while it's still valid.
    var _renewing = null;
    function ensureToken() {
        var t = tokens();
        if (!t || !t.access_token || needsReconnect()) { return Promise.reject({ status: 401 }); }
        if (!t.expires_at || Date.now() < t.expires_at - 60000) { return Promise.resolve(t); }
        if (!t.refresh_token) { return Date.now() < t.expires_at ? Promise.resolve(t) : (lostSignIn(), Promise.reject({ status: 401 })); }
        if (_renewing) { return _renewing; }
        var g = _gen, p = req('POST', '/oauth/token', client({
            refresh_token: t.refresh_token, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token'
        }), false).then(function (r) {
            if (_renewing === p) { _renewing = null; }
            live(g);   // (disconnected meanwhile: not signed back in)
            saveTokens(r.data, t.user);
            return tokens();
        }, function (err) {
            if (_renewing === p) { _renewing = null; }
            live(g);
            var s = err && err.status;
            if (s === 400 || s === 401 || s === 403) { lostSignIn(); return Promise.reject({ status: 401 }); }
            if (Date.now() < t.expires_at) { return t; }   // (not renewed now; still valid a little longer)
            return Promise.reject({ status: 0 });          // (expired: not used)
        });
        _renewing = p;
        return p;
    }
    function authed(method, path, body) {
        var g = _gen;
        return ensureToken().then(function () { live(g); return req(method, path, body, true); }).then(function (r) { live(g); return r; }, function (err) {
            if (current(g) && err && (err.status === 401 || err.status === 403)) { lostSignIn(); }
            throw err;
        });
    }

    // ---- Device code flow ----
    // callbacks: onCode(userCode, url), onPending(), onSuccess(user), onError(msg)
    // Returns a cancel() function.
    function startDeviceFlow(cb) {
        cb = cb || {};
        var canceled = false, timer = null, g0 = _gen;
        var c = getCreds();
        if (!c.id) { if (cb.onError) { cb.onError('Enter your Trakt Client ID first.'); } return function () {}; }

        req('POST', '/oauth/device/code', { client_id: c.id }, false).then(function (r) {
            if (canceled) { return; }
            var d = r.data || {};
            if (!d.device_code) { if (cb.onError) { cb.onError('Trakt did not return a device code.'); } return; }
            if (cb.onCode) { cb.onCode(d.user_code, d.verification_url || 'https://trakt.tv/activate'); }
            var interval = (d.interval || 5) * 1000;
            var deadline = Date.now() + ((d.expires_in || 600) * 1000);

            function pollOnce() {
                if (canceled) { return; }
                if (Date.now() > deadline) { if (cb.onError) { cb.onError('Code expired — try again.'); } return; }
                req('POST', '/oauth/device/token', client({ code: d.device_code }), false)
                    .then(function (tr) {
                        if (canceled || !current(g0)) { return; }
                        _gen++;   // (a new sign-in: nothing from before it writes over it)
                        var g = _gen;
                        saveTokens(tr.data, '');
                        // fetch username (keep the expiry we just stored), then refresh caches
                        req('GET', '/users/settings', null, true).then(function (us) {
                            if (!current(g)) { return; }
                            var user = (us.data && us.data.user && (us.data.user.username || us.data.user.name)) || 'Trakt';
                            var t = tokens(); if (t) { t.user = user; U.store.set(TOK_KEY, t); }
                            refreshCaches();
                            if (cb.onSuccess) { cb.onSuccess(user); }
                        }, function () { if (!current(g)) { return; } refreshCaches(); if (cb.onSuccess) { cb.onSuccess('Trakt'); } });
                    }, function (err) {
                        if (canceled) { return; }
                        var s = err && err.status;
                        if (s === 400) { timer = setTimeout(pollOnce, interval); return; }   // authorization pending
                        if (s === 429) { timer = setTimeout(pollOnce, interval + 1000); return; } // slow down
                        if (s === 418) { if (cb.onError) { cb.onError('Sign-in was denied.'); } return; }
                        if (s === 410) { if (cb.onError) { cb.onError('Code expired — try again.'); } return; }
                        if (s === 409) { if (cb.onError) { cb.onError('Code already used.'); } return; }
                        if (cb.onPending) { cb.onPending(); }
                        timer = setTimeout(pollOnce, interval);
                    });
            }
            timer = setTimeout(pollOnce, interval);
        }, function () { if (cb.onError) { cb.onError('Could not reach Trakt (or CORS blocked on desktop).'); } });

        return function cancel() { canceled = true; if (timer) { clearTimeout(timer); } };
    }

    function disconnect() {
        _gen++;   // (what's under way for this sign-in changes nothing when it answers)
        _renewing = null; _refreshing = null; _flushP = null; _backoffUntil = 0; _backoffMs = 0;
        if (_soon) { clearTimeout(_soon); _soon = null; }
        if (_every) { clearInterval(_every); _every = null; }
        if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
        _toldFull = false; _toldUnsaved = false;
        var t = tokens();
        if (t && t.access_token) {
            req('POST', '/oauth/revoke', client({ token: t.access_token }), false).then(function () {}, function () {});
        }
        U.store.remove(TOK_KEY);
        keepWatched({});
        U.store.remove(OUTBOX_KEY);
        U.store.remove(SYNC_KEY);
        U.store.remove(CONFIRMED_OFF_KEY);
        _toldReconnect = false;
        U.store.remove(PLAYBACK_KEY);
        U.store.remove(WATCHLIST_KEY);
        U.store.remove(UPNEXT_KEY);
        U.store.remove(SHOWS_KEY);
        U.store.remove(DISMISSED_KEY);
        U.store.remove(RATINGS_KEY);
        if (typeof Stremio !== 'undefined' && Stremio.addonsChanged) { Stremio.addonsChanged(); }   // (its rows go)
    }

    // ---- checking what Trakt sends (and what's sent) ----
    var IMDB = /^tt\d{1,12}$/;
    function imdbOf(ids) { return (ids && typeof ids === 'object' && typeof ids.imdb === 'string' && IMDB.test(ids.imdb)) ? ids.imdb : null; }
    function num(n, max) { return (typeof n === 'number' && isFinite(n) && n >= 0 && n <= max && Math.floor(n) === n) ? n : null; }
    function str(x, max) { return typeof x === 'string' ? x.slice(0, max) : ''; }
    function list(x, max) { return Array.isArray(x) ? x.slice(0, max) : []; }
    function when(x) { var t = Date.parse(typeof x === 'string' ? x : ''); return t > 0 ? t : 0; }

    // ---- id <-> Trakt payload ----
    function parseId(type, id) {
        var parts = ('' + id).split(':');
        var imdb = parts[0];
        if (!IMDB.test(imdb)) { return null; }
        if (type === 'movie') { return parts.length === 1 ? { movie: true, imdb: imdb } : null; }
        if (parts.length !== 3) { return null; }
        var se = num(parseInt(parts[1], 10), 1000), ep = num(parseInt(parts[2], 10), 10000);
        return (se === null || ep === null) ? null : { movie: false, imdb: imdb, season: se, episode: ep };
    }
    function historyBody(p) {
        if (p.movie) { return { movies: [{ ids: { imdb: p.imdb } }] }; }
        return { shows: [{ ids: { imdb: p.imdb }, seasons: [{ number: p.season, episodes: [{ number: p.episode }] }] }] };
    }
    // Your history's request for these keys ('movie:tt…', 'series:tt…:S:E'): by IMDb id, and
    // episodes by their show, season and number.
    function historyBodyOf(keys) {
        var body = { movies: [], shows: [] }, shows = {};
        (keys || []).forEach(function (k) {
            var i = k.indexOf(':'), p = parseId(k.slice(0, i), k.slice(i + 1));
            if (!p) { return; }
            if (p.movie) { body.movies.push({ ids: { imdb: p.imdb } }); return; }
            var sh = shows[p.imdb];
            if (!sh) { sh = shows[p.imdb] = { ids: { imdb: p.imdb }, seasons: [] }; body.shows.push(sh); }
            var se = null;
            sh.seasons.forEach(function (y) { if (y.number === p.season) { se = y; } });
            if (!se) { se = { number: p.season, episodes: [] }; sh.seasons.push(se); }
            se.episodes.push({ number: p.episode });
        });
        return body;
    }
    // ...and for episodes by their TheTVDB numbers (tv: key -> number).
    function tvdbHistoryBody(keys, tv) {
        return { episodes: (keys || []).filter(function (k) { return tv[k]; }).map(function (k) { return { ids: { tvdb: tv[k] } }; }) };
    }
    // Episodes' TheTVDB numbers, as the addons describing them give them (a video's tvdb_id,
    // or TheTVDB's own picture of it: artworks.thetvdb.com/banners/v4/episode/<number>/…):
    // what's sent instead when Trakt can't find an episode by its show's numbering (a show
    // Trakt splits in two). Kept for the session.
    var _tvdb = U.lru(3000);
    function tvdbOfVideo(v) {
        var n = +(v.tvdb_id || (v.ids && typeof v.ids === 'object' && v.ids.tvdb) || 0);
        if (n > 0 && n < 1e10 && Math.floor(n) === n) { return n; }
        var m = /^https?:\/\/artworks\.thetvdb\.com\/banners\/v4\/episode\/(\d{1,10})\//.exec(typeof v.thumbnail === 'string' ? v.thumbnail : '');
        return m ? +m[1] : 0;
    }
    function noteEpisodes(meta) {
        if (!meta || typeof meta !== 'object' || !Array.isArray(meta.videos)) { return; }
        var show = IMDB.test(meta.imdb_id || '') ? meta.imdb_id : ('' + meta.id).split(':')[0];
        if (!IMDB.test(show)) { return; }
        meta.videos.slice(0, 5000).forEach(function (v) {
            if (!v || typeof v !== 'object') { return; }
            var se = num(+v.season, 1000), ep = num(+(v.episode != null ? v.episode : v.number), 10000), n = tvdbOfVideo(v);
            if (se === null || ep === null || !n) { return; }
            _tvdb.set('series:' + show + ':' + se + ':' + ep, n);
            if (typeof v.id === 'string' && /^tt\d+:\d+:\d+$/.test(v.id)) { _tvdb.set('series:' + v.id, n); }
        });
    }
    function tvdbHint(key) { return _tvdb.get(key) || 0; }
    function scrobbleBody(p, progress) {
        if (p.movie) { return { movie: { ids: { imdb: p.imdb } }, progress: progress }; }
        return { show: { ids: { imdb: p.imdb } }, episode: { season: p.season, number: p.episode }, progress: progress };
    }

    // ---- watched cache: { key: when Trakt has it watched } ----
    // Kept in the TV's database (a long history is large), or, when the TV won't keep it there
    // (its database full), in the settings storage (its own room); read into memory once, so
    // isWatched() stays synchronous. Until it's read, nothing counts as watched by Trakt.
    var _watched = {};
    if (U.bigStore) {
        U.bigStore.get(WATCHED_KEY).then(function (m) {
            if (!m || typeof m !== 'object') { m = U.store.get(WATCHED_KEY, null, true); }
            if (m && typeof m === 'object' && !Object.keys(_watched).length) { _watched = m; }
        });
    }
    // Saved only when it changed (a refresh with nothing new isn't written again: each rewrite
    // leaves the database space to reclaim).
    var _watchedSaved = null;
    function keepWatched(map) {
        _watched = map;
        var text = JSON.stringify(map);
        if (text === _watchedSaved) { return; }
        _watchedSaved = text;
        if (!U.bigStore) { U.store.set(WATCHED_KEY, map); return; }
        U.bigStore.set(WATCHED_KEY, map).then(function (ok) {
            if (ok) { return; }
            // (the database's older copy goes first: a launch reads it before the settings
            // storage, and would take it for the latest; removing it clears the settings copy
            // too, so this is saved after. A save the database refused for a while is tried
            // again: kept waiting, it moves this back into the database when it's taken.)
            U.bigStore.remove(WATCHED_KEY, true);
            if (U.store.set(WATCHED_KEY, map)) { U.log('storage', 'Your Trakt history is kept in the settings storage instead'); }
        });
    }
    function watchedAt(type, id) { var v = _watched[type + ':' + id]; return typeof v === 'number' ? v : 0; }
    // What Trakt has you watching since `since` (ms), on any device: [{ type, id, at }].
    function watchedSince(since) {
        var out = [];
        Object.keys(_watched).forEach(function (k) {
            var v = _watched[k], i = k.indexOf(':');
            if (typeof v === 'number' && v >= since && i > 0) { out.push({ type: k.slice(0, i), id: k.slice(i + 1), at: v }); }
        });
        return out;
    }
    function isWatched(type, id) { return watchedAt(type, id) > 0; }
    // Watched past a place kept (Trakt's paused one, or this TV's): a movie watched since; an
    // episode watched since, or a later one of the show (on any device). A place kept after
    // those were watched (watching again) still stands. e: { type, id, updated }.
    var _byShow = null, _byShowFor = null;   // { imdb: [[season, episode, when]] }, built from _watched when it changes
    function byShow() {
        if (_byShowFor === _watched) { return _byShow; }
        var m = {};
        Object.keys(_watched).forEach(function (k) {
            var p = /^series:(tt\d+):(\d+):(\d+)$/.exec(k), v = _watched[k];
            if (p && typeof v === 'number' && v > 0) { (m[p[1]] = m[p[1]] || []).push([+p[2], +p[3], v]); }
        });
        _byShow = m; _byShowFor = _watched;
        return m;
    }
    function watchedPast(e) {
        var since = (e && e.updated) || 0;
        if (!e || !since) { return false; }
        if (e.type === 'movie') { return watchedAt('movie', e.id) > since; }
        var p = /^(tt\d+):(\d+):(\d+)$/.exec('' + e.id);
        if (e.type !== 'series' || !p) { return false; }
        var sn = +p[2], en = +p[3];
        return (byShow()[p[1]] || []).some(function (w) { return w[2] > since && (w[0] > sn || (w[0] === sn && w[1] >= en)); });
    }

    // Trakt's watched lists come a page at a time (since July 2026), and shows carry their
    // episodes only when asked (extended=progress). Every page is read: up to the count Trakt
    // gives, or, without one, until a page is shorter than its page size (Trakt's, or the one
    // asked); PAGES_MAX at most, and no more items than max. A page that repeats the one
    // before (a server that ignores the page asked) ends it too, and isn't kept twice.
    var PAGES_MAX = 100;
    function allPages(path, perPage, max, g) {
        var out = [], page = 1, before = '';
        function next() {
            return authed('GET', path + (path.indexOf('?') === -1 ? '?' : '&') + 'page=' + page + '&limit=' + perPage, null).then(function (r) {
                live(g);
                if (!Array.isArray(r.data)) { var bad = new Error('Trakt sent a page that couldn\'t be read (' + path.split('?')[0] + ', page ' + page + ')'); bad.status = r.status || 0; throw bad; }   // (not the last page: the refresh fails, the copy kept)
                var items = list(r.data, perPage), first = items.length ? JSON.stringify(items[0]) : '';
                if (page > 1 && first && first === before) { return out.slice(0, max); }
                before = first;
                out = out.concat(items);
                var last = !items.length || out.length >= max || page >= PAGES_MAX ||
                    (r.pages ? page >= r.pages : items.length < (r.limit || perPage));
                if (last) { return out.slice(0, max); }
                page++;
                return next();
            });
        }
        return next();
    }
    var SHOWS_MAX = 5000, SEASONS_MAX = 200, EPISODES_MAX = 1000;
    function fetchWatched(g) {
        var map = {};
        return allPages('/sync/watched/movies', 250, 20000, g).then(function (movies) {
            movies.forEach(function (m) {
                var imdb = m && imdbOf(m.movie && m.movie.ids);
                if (imdb) { map['movie:' + imdb] = when(m.last_watched_at) || 1; }
            });
            return allPages('/sync/watched/shows?extended=progress', 100, SHOWS_MAX, g);
        }).then(function (all) {
            var shows = [];
            all.forEach(function (sh) {
                var show = sh && sh.show, imdb = show && imdbOf(show.ids);
                if (!imdb) { return; }
                var trakt = num(show.ids.trakt, 1e10), at = when(sh.last_watched_at);
                if (trakt !== null) { shows.push({ trakt: trakt, imdb: imdb, title: str(show.title, 200), year: num(show.year, 3000), at: at }); }
                list(sh.seasons, SEASONS_MAX).forEach(function (se) {
                    var sn = se && num(se.number, 1000);
                    if (sn === null) { return; }
                    list(se.episodes, EPISODES_MAX).forEach(function (ep) {
                        var en = ep && num(ep.number, 10000);
                        if (en !== null) { map['series:' + imdb + ':' + sn + ':' + en] = when(ep.last_watched_at) || at || 1; }
                    });
                });
            });
            live(g);
            keepWatched(map);
            shows.sort(function (a, b) { return b.at - a.at; });
            U.store.set(SHOWS_KEY, shows.slice(0, UPNEXT_SHOWS));
            clearConfirmedUnwatched();
        });
    }

    // ---- watchlist and up next (Home rows: see synthAddon) ----
    function item(o, type) {
        var imdb = o && imdbOf(o.ids);
        return imdb ? { imdb: imdb, title: str(o.title, 200), year: num(o.year, 3000), type: type } : null;
    }
    var WATCHLIST_MAX = 500;
    // Your ratings (movies, shows, seasons), with the changes still on their way laid over them.
    var RATINGS_MAX = 5000;
    function fetchRatings(g) {
        var out = {};
        function imdbOf(x) { var i = x && x.ids && x.ids.imdb; return /^tt\d+$/.test(i || '') ? i : ''; }
        function n(r) { var v = +r; return v >= 1 && v <= 10 ? Math.round(v) : 0; }
        return authed('GET', '/sync/ratings/movies', null).then(function (r) {
            list(r.data, RATINGS_MAX).forEach(function (it) { var i = imdbOf(it && it.movie); if (i && n(it.rating)) { out['movie:' + i] = n(it.rating); } });
            return authed('GET', '/sync/ratings/shows', null);
        }).then(function (r) {
            list(r.data, RATINGS_MAX).forEach(function (it) { var i = imdbOf(it && it.show); if (i && n(it.rating)) { out['series:' + i] = n(it.rating); } });
            return authed('GET', '/sync/ratings/seasons', null);
        }).then(function (r) {
            list(r.data, RATINGS_MAX).forEach(function (it) {
                var i = imdbOf(it && it.show), sn = it && it.season && +it.season.number;
                if (i && sn >= 0 && n(it.rating)) { out['season:' + i + ':' + sn] = n(it.rating); }
            });
            outbox().forEach(function (x) { if (x.kind === 'rate') { out[x.key] = x.rating; } else if (x.kind === 'unrate') { delete out[x.key]; } });
            live(g);
            U.store.set(RATINGS_KEY, out);
        });
    }
    function myRating(kind, id) { var r = (U.store.get(RATINGS_KEY, {}) || {})[kind + ':' + id]; return r ? r : null; }
    // Rate (1-10) or, with 0, take your rating off: a movie, a series ('tt…') or a season ('tt…:N').
    function rate(kind, id, rating) {
        if (!isConnected()) { return; }
        var m = /^(tt\d+)(?::(\d+))?$/.exec('' + id);
        if (!m || (kind === 'season') !== !!m[2]) { return; }
        var key = kind + ':' + id, all = U.store.get(RATINGS_KEY, {}) || {};
        if (rating) { all[key] = rating; } else { delete all[key]; }
        U.store.set(RATINGS_KEY, all);
        var ids = { imdb: m[1] }, body;
        if (kind === 'movie') { body = { movies: [rating ? { ids: ids, rating: rating } : { ids: ids }] }; }
        else if (kind === 'series') { body = { shows: [rating ? { ids: ids, rating: rating } : { ids: ids }] }; }
        else { body = { shows: [{ ids: ids, seasons: [rating ? { number: +m[2], rating: rating } : { number: +m[2] }] }] }; }
        enqueue({ kind: rating ? 'rate' : 'unrate', key: key, keys: [key], rating: rating || undefined, body: body });
    }
    function fetchWatchlist(g) {
        var out = { movie: [], series: [] };
        return authed('GET', '/sync/watchlist/movies/rank', null).then(function (r) {
            list(r.data, WATCHLIST_MAX).forEach(function (it) { var x = it && item(it.movie, 'movie'); if (x) { out.movie.push(x); } });
            return authed('GET', '/sync/watchlist/shows/rank', null);
        }).then(function (r) {
            list(r.data, WATCHLIST_MAX).forEach(function (it) { var x = it && item(it.show, 'series'); if (x) { out.series.push(x); } });
            live(g);
            U.store.set(WATCHLIST_KEY, out);
        });
    }
    // The next episode of each show you've watched lately (Trakt's progress for it), in the
    // order you watched them; shows you've finished (nothing next) left out.
    function fetchUpNext(g) {
        var shows = U.store.get(SHOWS_KEY, []) || [], out = [];
        var i = 0;
        function next() {
            if (i >= shows.length) { live(g); U.store.set(UPNEXT_KEY, out); return Promise.resolve(); }
            var s = shows[i++];
            if (!s || num(s.trakt, 1e10) === null || !IMDB.test(s.imdb || '')) { return next(); }
            return authed('GET', '/shows/' + encodeURIComponent(s.trakt) + '/progress/watched?hidden=false&specials=false', null).then(function (r) {
                var d = (r.data && typeof r.data === 'object') ? r.data : {}, ne = d.next_episode, sn = ne && num(ne.season, 1000), en = ne && num(ne.number, 10000);
                if (sn !== null && en !== null && sn != null && en != null) {
                    out.push({ imdb: s.imdb, title: str(s.title, 200), year: s.year, season: sn, episode: en, epTitle: str(ne.title, 200), at: s.at || 0 });
                }
            }, function (err) { if (err && (err.stale || err.status === 401 || err.status === 403 || err.status === 429)) { throw err; } }).then(next);
        }
        return next();
    }
    // Trakt's rows on Home (Movies and Series tabs) and in Discover, while you're connected.
    function synthCatalog(catId) {
        var w = U.store.get(WATCHLIST_KEY, {}) || {}, list = [];
        if (catId === 'trakt_watchlist_movies') { list = w.movie || []; }
        else if (catId === 'trakt_watchlist_shows') { list = w.series || []; }
        else if (catId === 'trakt_upnext') {
            list = (U.store.get(UPNEXT_KEY, []) || []).map(function (u) {
                return { imdb: u.imdb, type: 'series', title: u.title || '', year: u.year,
                    next: 'S' + u.season + 'E' + u.episode + (u.epTitle ? '  “' + u.epTitle + '”' : '') };
            });
        }
        return Promise.resolve(list.map(function (x) {
            return { id: x.imdb, type: x.type, name: x.title || x.imdb, poster: poster(x.imdb), posterShape: 'poster',
                releaseInfo: x.year ? '' + x.year : '', description: x.next ? 'Up next: ' + x.next : '' };
        }));
    }
    function synthAddon() {
        return {
            __local: true, __impl: { catalog: synthCatalog }, url: 'local:trakt', base: 'local:trakt',
            manifest: { id: 'org.stremiok.trakt', name: 'Trakt', version: '1.0.0', types: ['movie', 'series'], resources: ['catalog'],
                catalogs: [{ type: 'series', id: 'trakt_upnext', name: 'Up next', extra: [{ name: 'skip' }] },
                    { type: 'movie', id: 'trakt_watchlist_movies', name: 'Watchlist', extra: [{ name: 'skip' }] },
                    { type: 'series', id: 'trakt_watchlist_shows', name: 'Watchlist', extra: [{ name: 'skip' }] }] }
        };
    }

    // ---- playback (Continue Watching) cache ----
    // Trakt's paused titles, but not one you removed from Continue Watching here, unless Trakt
    // has newer progress for it since (you watched more of it, here or elsewhere), nor one
    // you've watched past since (watchedPast: Trakt keeps a paused place it's been told of in
    // other ways, a history entry, and the show's next episode would wait behind it).
    // And the shows you're watching (Trakt's Up next): their next episode, placed by when you
    // last watched the show, unless Trakt has a paused episode of it already.
    function continueList() {
        var gone = U.store.get(DISMISSED_KEY, {}) || {};
        function kept(e) { var at = gone[e.type + ':' + e.id]; return !at || (e.updated || 0) > at; }
        var list = (U.store.get(PLAYBACK_KEY, []) || []).filter(function (e) { return kept(e) && !watchedPast(e); }), paused = {};
        list.forEach(function (e) { if (e.type === 'series') { paused[('' + e.id).split(':')[0]] = true; } });
        (U.store.get(UPNEXT_KEY, []) || []).forEach(function (u) {
            if (!u || !u.imdb || paused[u.imdb]) { return; }
            var e = { id: u.imdb + ':' + u.season + ':' + u.episode, type: 'series', parent: u.imdb,
                name: (u.title || 'Show') + '  S' + u.season + 'E' + u.episode, poster: poster(u.imdb),
                position: 0, duration: 0, updated: u.at || 0, _trakt: true, upNext: u.epTitle || '' };
            if (kept(e)) { list.push(e); }
        });
        return list;
    }
    function dismiss(type, id) {
        var gone = U.store.get(DISMISSED_KEY, {}) || {}, keys;
        gone[type + ':' + id] = Date.now();
        keys = Object.keys(gone);
        if (keys.length > DISMISSED_MAX) {   // (the oldest go)
            keys.sort(function (a, b) { return gone[a] - gone[b]; });
            keys.slice(0, keys.length - DISMISSED_MAX).forEach(function (k) { delete gone[k]; });
        }
        U.store.set(DISMISSED_KEY, gone);
    }

    function fetchPlayback(g) {
        return authed('GET', '/sync/playback', null).then(function (r) {
            var out = [];
            list(r.data, 300).forEach(function (it) {
                if (!it || typeof it !== 'object') { return; }
                var prog = (typeof it.progress === 'number' && isFinite(it.progress)) ? it.progress : 0;
                if (prog <= 0 || prog >= 100) { return; }
                var updated = when(it.paused_at) || Date.now();
                if (it.type === 'movie' && it.movie) {
                    var mi = imdbOf(it.movie.ids);
                    if (!mi) { return; }
                    out.push({ id: mi, type: 'movie', name: str(it.movie.title, 200) || 'Movie', poster: poster(mi),
                        position: prog, duration: 100, updated: updated, _trakt: true });
                } else if (it.type === 'episode' && it.show && it.episode) {
                    var si = imdbOf(it.show.ids), sn = num(it.episode.season, 1000), en = num(it.episode.number, 10000);
                    if (!si || sn === null || en === null) { return; }
                    out.push({ id: si + ':' + sn + ':' + en, type: 'series',
                        name: (str(it.show.title, 200) || 'Show') + '  S' + sn + 'E' + en,
                        poster: poster(si), position: prog, duration: 100, updated: updated, _trakt: true });
                }
            });
            live(g);
            U.store.set(PLAYBACK_KEY, out);
        });
    }

    // Everything asked again, one refresh at a time (launch, after a change, every 15 minutes:
    // one already running is shared). Pending changes are sent first (then Trakt is read, so
    // it already has them). Trakt busy or unreachable: the next refresh waits, longer each
    // time (and Trakt's own Retry-After when it gives one). Disconnected meanwhile: it stops.
    var _refreshing = null, _backoffUntil = 0, _backoffMs = 0;
    function refreshCaches() {
        if (!isConnected() || needsReconnect()) { return Promise.resolve(); }
        if (_refreshing) { return _refreshing; }
        if (Date.now() < _backoffUntil) { return Promise.resolve(); }
        startAutoRefresh();
        var failed = null, g = _gen, p;
        function step(fn) {
            return function () {
                live(g);
                return fn(g).then(null, function (e) {
                    failed = failed || e || { status: 0 };
                    if (e && (e.stale || e.status === 401 || e.status === 403 || e.status === 429)) { throw e; }   // (the rest waits too)
                });
            };
        }
        p = flushOutbox().then(null, function () {}).then(step(fetchWatched)).then(step(fetchPlayback)).then(step(fetchWatchlist)).then(step(fetchUpNext)).then(step(fetchRatings)).then(null, function () {}).then(function () {
            if (_refreshing === p) { _refreshing = null; }
            if (!current(g)) { return; }
            if (!failed) { _backoffMs = 0; setSyncState({ last: Date.now() }); }
            else if (failed.status !== 401 && failed.status !== 403) {
                _backoffMs = Math.min(_backoffMs ? _backoffMs * 2 : 60000, 30 * 60000);
                _backoffUntil = Date.now() + Math.max(_backoffMs, (failed.retryAfter || 0) * 1000);
            }
            if (typeof Stremio !== 'undefined' && Stremio.addonsChanged) { Stremio.addonsChanged(); }   // (its rows: there, and current)
            if (typeof ViewParts !== 'undefined' && ViewParts.refreshAddonRows) { ViewParts.refreshAddonRows('local:trakt'); }   // (only its rows asked again)
        });
        _refreshing = p;
        return p;
    }
    // Asked again a moment after you watch or mark something (once, however many), and every
    // 15 minutes while connected (not during playback): Up next and Continue Watching follow.
    var SOON_MS = 5000, EVERY_MS = 15 * 60 * 1000, _soon = null, _every = null;
    function refreshSoon() {
        if (!isConnected()) { return; }
        if (_soon) { clearTimeout(_soon); }
        _soon = setTimeout(function () { _soon = null; refreshCaches(); }, SOON_MS);
    }
    function startAutoRefresh() {
        if (_every) { return; }
        _every = setInterval(function () {
            if (!isConnected()) { clearInterval(_every); _every = null; return; }
            if (typeof Player !== 'undefined' && Player.isActive && Player.isActive()) { return; }
            if (U.isHidden && U.isHidden()) { return; }   // (in the background: refreshed when it's back, at the next one)
            refreshCaches();
        }, EVERY_MS);
    }

    // ---- sync out: the outbox ----
    // A change (watched, not watched, where you stopped) is kept until Trakt confirms it: sent at
    // once, then again after 30 s, 1 min, 2 min… (up to an hour apart, 8 tries; Trakt's own
    // Retry-After when it's busy). One Trakt refuses (other than busy / unreachable) or that
    // ran out of tries is marked failed: Settings shows it (Retry / Discard). A refused sign-in
    // stops everything until you connect again. The marks themselves show at once (kept on the
    // TV: Player's watched marks); Trakt's copy is only what Trakt says.
    function outbox() { var b = U.store.get(OUTBOX_KEY, []); return Array.isArray(b) ? b : []; }
    // Kept on the TV; more than OUTBOX_MAX waiting, the oldest go, and a save the TV refuses
    // (its storage full) means they'd be lost on closing: both said, once, and logged.
    var _toldFull = false, _toldUnsaved = false;
    function saveOutbox(b) {
        if (b.length > OUTBOX_MAX) {
            U.log('trakt', (b.length - OUTBOX_MAX) + ' older change(s) dropped, not sent to Trakt: more than ' + OUTBOX_MAX + ' waiting');
            if (!_toldFull) { _toldFull = true; U.toast('Trakt: too many changes waiting, the oldest were dropped', 6000); }
            b = b.slice(-OUTBOX_MAX);
        }
        if (U.store.set(OUTBOX_KEY, b) === false) {
            U.log('trakt', 'The changes waiting for Trakt couldn’t be saved on the TV (its storage is full): they’re lost if StremioK closes');
            if (!_toldUnsaved) { _toldUnsaved = true; U.toast('Trakt: the changes waiting couldn’t be saved on the TV (storage full)', 6000); }
        }
    }
    function newId() { return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
    function overlaps(x, y) {
        var k = x.keys || [];
        return (y.keys || []).some(function (z) { return k.indexOf(z) !== -1; });
    }
    // Watched / not watched (or a finish) for an episode or title: the latest choice wins. An
    // older one for it that hasn't gone yet is taken back (the episode out of its request; the
    // request dropped when nothing's left), so it can't undo the newer one when it's retried.
    function supersede(b, x) {
        var mine = {};
        (x.keys || []).forEach(function (k) { mine[k] = 1; });
        return b.filter(function (y) {
            if (y.kind === 'stop' && x.kind === 'remove' && mine[y.key]) { return false; }
            if (y.kind !== 'add' && y.kind !== 'remove') { return true; }
            var left = (y.keys || []).filter(function (k) { return !mine[k]; });
            if (left.length === (y.keys || []).length) { return true; }
            if (!left.length) { return false; }
            y.keys = left;
            y.body = y.byTvdb ? tvdbHistoryBody(left, y.tvdb || {}) : historyBodyOf(left);
            return true;
        });
    }
    function enqueue(x) {
        var b = outbox();
        if (x.kind === 'progress' || x.kind === 'stop') { b = b.filter(function (y) { return !(y.kind === 'progress' && y.key === x.key); }); }   // (the latest place only)
        if (x.kind === 'rate' || x.kind === 'unrate') { b = b.filter(function (y) { return !((y.kind === 'rate' || y.kind === 'unrate') && y.key === x.key); }); }   // (the latest rating only)
        if (x.kind === 'add' || x.kind === 'remove' || x.kind === 'stop') { b = supersede(b, x); }
        x.id = newId(); x.tries = 0; x.next = 0; x.at = Date.now();
        b.push(x);
        saveOutbox(b);
        flushSoon(0);
    }
    var _flushP = null, _flushTimer = null;
    function flushSoon(ms) {
        if (_flushTimer) { clearTimeout(_flushTimer); }
        _flushTimer = setTimeout(function () { _flushTimer = null; flushOutbox(); }, ms || 0);
    }
    function scheduleNextFlush() {
        var waiting = outbox().filter(function (x) { return !x.failed; });
        if (!waiting.length) { return; }
        var soonest = Math.min.apply(null, waiting.map(function (x) { return x.next || 0; }));
        flushSoon(Math.max(1000, soonest - Date.now()));
    }
    function what(x) { return x.kind === 'add' ? 'watched' : x.kind === 'remove' ? 'not watched' : x.kind === 'stop' ? 'watched (finished)' : x.kind === 'rate' ? 'rated ' + x.rating : x.kind === 'unrate' ? 'rating removed' : 'where you stopped'; }
    // The change's title: its name when it has one, else its IMDb id (and episode), or how many.
    function titleOf(x) {
        var keys = x.keys || [];
        if (x.name) { return x.name; }
        if (keys.length > 1) { return keys.length + ' titles / episodes'; }
        var m = ('' + (keys[0] || '')).match(/^(?:movie|series):(tt\d+)(?::(\d+):(\d+))?$/);
        var s = ('' + (keys[0] || '')).match(/^season:(tt\d+):(\d+)$/);
        if (s) { return s[1] + ' Season ' + s[2]; }
        return m ? m[1] + (m[2] ? ' S' + m[2] + 'E' + m[3] : '') : '';
    }
    function describe(x) { var t = titleOf(x); return what(x) + (t ? ', ' + t : ''); }
    // Trakt takes a paused place only under 80% ("Use stop to scrobble", HTTP 422): one past it is
    // sent as 79.9% (stopped past 85%, the player sends it as finished instead: onStopped).
    var PAUSE_MAX = 79.9;
    var PATHS = { add: '/sync/history', remove: '/sync/history/remove', progress: '/scrobble/pause', stop: '/scrobble/stop', rate: '/sync/ratings', unrate: '/sync/ratings/remove' };
    function bodyOf(x) {
        if (x.kind !== 'progress' || !x.body || !(x.body.progress > PAUSE_MAX)) { return x.body; }
        var b = JSON.parse(JSON.stringify(x.body));
        b.progress = PAUSE_MAX;
        return b;
    }
    // One sending at a time (a flush already under way is shared); each change confirmed
    // before the next. The first one due goes, unless an older one for the same title or
    // episode is still waiting: changes to one go in the order they were made.
    function nextDue() {
        var b = outbox(), now = Date.now();
        for (var i = 0; i < b.length; i++) {
            var x = b[i];
            if (x.failed) { continue; }
            var blocked = false;
            for (var j = 0; j < i && !blocked; j++) { blocked = !b[j].failed && overlaps(b[j], x); }
            if (!blocked && (x.next || 0) <= now) { return x; }
        }
        return null;
    }
    function flushOutbox() {
        if (_flushP) { return _flushP; }
        if (!isConnected() || needsReconnect()) { return Promise.resolve(); }
        var g = _gen, p = sendNext(g).then(function () { if (_flushP === p) { _flushP = null; } }, function () { if (_flushP === p) { _flushP = null; } });
        _flushP = p;
        return p;
    }
    // What Trakt's answer must be to count as confirming the change: its JSON object (a reply
    // that isn't is retried, not taken as done).
    function ackProblem(r) {
        var d = r && r.data;
        if (r && r.bad) { return 'an answer that isn’t Trakt’s JSON'; }
        if (!d || typeof d !== 'object' || Array.isArray(d)) { return 'an unexpected answer'; }
        return '';
    }
    function update(due, fn) {
        var b = outbox(), x = null;
        b.forEach(function (y) { if (y.id === due.id) { x = y; } });
        if (x) { fn(x); saveOutbox(b); }
        return x;
    }
    function sendNext(g) {
        if (!current(g) || !isConnected() || needsReconnect()) { return Promise.resolve(); }
        var due = nextDue();
        if (!due) { scheduleNextFlush(); return Promise.resolve(); }
        return authed('POST', PATHS[due.kind] || PATHS.add, bodyOf(due)).then(function (r) {
            if (!current(g)) { return; }
            var bad = ackProblem(r);
            if (bad) { failed(due, { status: 0, unexpected: bad }); return sendNext(g); }
            saveOutbox(outbox().filter(function (x) { return x.id !== due.id; }));
            if (due.kind === 'remove') { noteConfirmedOff(due.keys); }
            notFound(due, r.data);
            refreshSoon();
            return sendNext(g);   // (the next one)
        }, function (err) {
            if (!current(g) || (err && err.stale)) { return; }
            var st = err && err.status;
            if (st === 409 && due.kind === 'stop') {   // (Trakt has this finish already: done)
                saveOutbox(outbox().filter(function (x) { return x.id !== due.id; }));
                return sendNext(g);
            }
            if (st === 404 && (due.kind === 'progress' || due.kind === 'stop') && !due.byTvdb) {
                var tv = due.tvdbEp || tvdbHint(due.key);
                if (tv) {   // (a show Trakt numbers otherwise: by the episode's own TheTVDB number)
                    update(due, function (x) { x.byTvdb = true; x.tvdbEp = tv; x.body = { episode: { ids: { tvdb: tv } }, progress: x.body.progress }; x.next = 0; });
                    return sendNext(g);
                }
            }
            if (st === 401 || st === 403) { return; }   // (reconnect: kept, sent once you're back)
            failed(due, err);
            return sendNext(g);
        });
    }
    function failed(due, err) {
        var st = err && err.status;
        update(due, function (x) {
            x.tries = (x.tries || 0) + 1;
            var refused = st >= 400 && st < 500 && st !== 408 && st !== 429;
            if (refused || x.tries >= TRIES_MAX) {
                var said = err && err.data && typeof err.data.message === 'string' ? err.data.message.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
                x.failed = true; x.err = st ? 'HTTP ' + st + (said ? ': ' + said : '') : (err && err.unexpected) || (err && err.tooBig ? 'answer too large' : 'no answer');
                U.log('trakt', 'Not sent to Trakt: ' + describe(x) + ' (' + x.err + ')');
            } else {
                x.next = Date.now() + Math.max(((err && err.retryAfter) || 0) * 1000, Math.min(30000 * Math.pow(2, x.tries - 1), 3600000));
            }
        });
    }
    // Watched / not watched: the episodes Trakt answered it couldn't find (a show it numbers
    // otherwise) are sent again by their TheTVDB numbers, where the addon gave them.
    function notFound(due, d) {
        if ((due.kind !== 'add' && due.kind !== 'remove') || !d || typeof d !== 'object') { return; }
        var nf = d.not_found && typeof d.not_found === 'object' ? d.not_found : {}, keys = [];
        list(nf.movies, 1000).forEach(function (m) { var i = imdbOf(m && m.ids); if (i) { keys.push('movie:' + i); } });
        list(nf.shows, 1000).forEach(function (sh) {
            var i = imdbOf(sh && sh.ids);
            if (!i) { return; }
            if (!Array.isArray(sh.seasons)) { (due.keys || []).forEach(function (k) { if (k.indexOf('series:' + i + ':') === 0) { keys.push(k); } }); return; }
            list(sh.seasons, SEASONS_MAX).forEach(function (se) {
                list(se && se.episodes, EPISODES_MAX).forEach(function (ep) { if (ep && num(se.number, 1000) !== null && num(ep.number, 10000) !== null) { keys.push('series:' + i + ':' + se.number + ':' + ep.number); } });
            });
        });
        keys = keys.filter(function (k) { return (due.keys || []).indexOf(k) !== -1; });
        if (!keys.length) { return; }
        var tv = {}, again = [], lost = [];
        keys.forEach(function (k) { var n = (due.tvdb && due.tvdb[k]) || tvdbHint(k); if (n && !due.byTvdb) { tv[k] = n; again.push(k); } else { lost.push(k); } });
        if (lost.length) { U.log('trakt', 'Trakt doesn’t know ' + lost.length + ' of: ' + describe(due)); }
        if (again.length) { enqueue({ kind: due.kind, keys: again, tvdb: tv, byTvdb: true, name: due.name, body: tvdbHistoryBody(again, tv) }); }
    }
    function retryFailed() {
        saveOutbox(outbox().map(function (x) { if (x.failed) { x.failed = false; x.tries = 0; x.next = 0; delete x.err; } return x; }));
        flushSoon(0);
    }
    function discardFailed() { saveOutbox(outbox().filter(function (x) { return !x.failed; })); }
    // Everything now, the ones not sent too; of several places for one title, only the latest.
    function sendNow() {
        var b = outbox(), latest = {};
        b.forEach(function (x) { if (x.kind === 'progress' && (!latest[x.key] || (x.at || 0) >= (latest[x.key].at || 0))) { latest[x.key] = x; } });
        b = b.filter(function (x) { return x.kind !== 'progress' || latest[x.key] === x; });
        saveOutbox(b.map(function (x) { x.failed = false; x.tries = 0; x.next = 0; delete x.err; return x; }));
        flushSoon(0);
    }

    // "Not watched" confirmed by Trakt: once Trakt's own copy shows it too, the mark kept on the
    // TV is dropped, so Trakt decides again (watched later on another device: shown here).
    var CONFIRMED_OFF_KEY = 'stremiok.trakt.confirmedoff';
    function noteConfirmedOff(keys) {
        var c = U.store.get(CONFIRMED_OFF_KEY, {}) || {};
        (keys || []).forEach(function (k) { c[k] = 1; });
        U.store.set(CONFIRMED_OFF_KEY, c);
    }
    function clearConfirmedUnwatched() {
        var c = U.store.get(CONFIRMED_OFF_KEY, {}) || {}, keys = Object.keys(c);
        if (!keys.length) { return; }
        keys.forEach(function (k) {
            var i = k.indexOf(':');
            if (!_watched[k] && typeof Player !== 'undefined' && Player.clearUnwatched) { Player.clearUnwatched(k.slice(0, i), k.slice(i + 1)); }
        });
        U.store.remove(CONFIRMED_OFF_KEY);
    }

    // Watched / not watched, however it's marked (played to the credits, the episode or
    // season menu, a poster's long-press): to your Trakt history, CHUNK titles / episodes a
    // request (a whole series is many). (Titles without an IMDb id, YouTube's, aren't Trakt's.)
    function onMarked(type, ids, on) {
        if (!isConnected()) { return; }
        var keys = [];
        (ids || []).forEach(function (id) { if (parseId(type, id)) { keys.push(type + ':' + id); } });
        for (var i = 0; i < keys.length; i += CHUNK) {
            var part = keys.slice(i, i + CHUNK), tv = {}, any = false;
            part.forEach(function (k) { var n = tvdbHint(k); if (n) { tv[k] = n; any = true; } });
            var x = { kind: on ? 'add' : 'remove', body: historyBodyOf(part), keys: part };
            if (any) { x.tvdb = tv; }
            enqueue(x);
        }
    }
    function onWatched(type, id) { onMarked(type, [id], true); }

    // Where you stopped, so it shows in Trakt's (and so in our) Continue Watching (a paused place
    // goes up to 79.9%: Trakt takes no later one). name: the title, shown if it isn't sent.
    function onProgress(type, id, cur, dur, name) {
        if (!isConnected() || !dur) { return; }
        var p = parseId(type, id);
        if (!p) { return; }
        var pct = Math.max(1, Math.min(PAUSE_MAX, cur / dur * 100));
        enqueue({ kind: 'progress', key: type + ':' + id, keys: [type + ':' + id], name: name || undefined, body: scrobbleBody(p, pct), tvdbEp: tvdbHint(type + ':' + id) || undefined });
    }
    // Stopped past 85%: finished, Trakt's way (it marks it watched, and adds it to your history).
    function onStopped(type, id, cur, dur, name) {
        if (!isConnected() || !dur) { return; }
        var p = parseId(type, id);
        if (!p) { return; }
        var pct = Math.max(80.1, Math.min(100, cur / dur * 100));
        enqueue({ kind: 'stop', key: type + ':' + id, keys: [type + ':' + id], name: name || undefined, body: scrobbleBody(p, pct), tvdbEp: tvdbHint(type + ':' + id) || undefined });
    }

    return {
        hasCreds: hasCreds, isConnected: isConnected, connectStatus: connectStatus,
        startDeviceFlow: startDeviceFlow, disconnect: disconnect, refreshCaches: refreshCaches,
        isWatched: isWatched, watchedAt: watchedAt, watchedSince: watchedSince, watchedPast: watchedPast, continueList: continueList, dismiss: dismiss, synthAddon: synthAddon,
        onWatched: onWatched, onMarked: onMarked, onProgress: onProgress, onStopped: onStopped, refreshSoon: refreshSoon, rate: rate, myRating: myRating,
        retryFailed: retryFailed, discardFailed: discardFailed, sendNow: sendNow, flush: flushOutbox, noteEpisodes: noteEpisodes
    };
})();
