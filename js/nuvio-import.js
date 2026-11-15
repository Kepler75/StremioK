/* Profiles from a Nuvio account (Settings › Profiles › Import profiles from Nuvio; #23), once:
   each profile picked becomes a StremioK profile with its name, color, addons (in their order),
   watched marks and recent progress. Read only, nothing changed in the Nuvio account.
   - Nuvio's backend (https://github.com/NuvioMedia/self-host, Apache License 2.0, by Nuvio) as its
     hosted service publishes it: its client settings read at run time from
     https://api.nuvio.tv/.well-known/nuvio (its public client key with them: none kept in
     StremioK's code); the TV sign-in Nuvio's own TV apps use (a code and a link, approved on your
     phone, asked every few seconds); then its profiles, addons, progress and watched marks read.
   - The session Nuvio gives (one for the whole account) is kept in memory only, used for these
     reads, and signed out at once, whatever happens: never saved, never logged.
   - StremioK isn't Nuvio's and isn't affiliated with it: this relies on an interface Nuvio may
     change, and may stop working if it does. Nuvio's own app code (GPL) isn't used.
   Global namespace: NuvioImport */
var NuvioImport = (function () {
    'use strict';
    var DISCOVERY = 'https://api.nuvio.tv/.well-known/nuvio';
    var LOGIN_PAGE = 'https://nuvio.tv/tv-login';   // (where Nuvio's own TV apps send you to approve)
    var POLL_MS = 3000, WAIT_MS = 5 * 60 * 1000, MAX = 4 * 1048576, PROGRESS_MAX = 60, WATCHED_MAX = 20000;

    // Its client settings: { url (its backend, https), key (its public client key) }.
    function discover() {
        return U.getJSON(DISCOVERY, 15000, 65536).then(function (d) {
            var url = d && typeof d.backend_url === 'string' ? d.backend_url.replace(/\/+$/, '') : '', p = U.parseUrl(url);
            if (!p || !/^https:\/\//i.test(url) || typeof d.publishable_key !== 'string' || d.publishable_key.length > 2000 || !(d.capabilities && d.capabilities.tv_login)) {
                throw new Error(U.t('Nuvio’s sign-in isn’t available'));
            }
            return { url: url, key: d.publishable_key };
        });
    }
    // One request to it: its JSON answer. token: the session (else the public key).
    function ask(cfg, path, body, token) {
        var h = { apikey: cfg.key, Authorization: 'Bearer ' + (token || cfg.key), 'Content-Type': 'application/json' };
        return U.getJSON(cfg.url + path, 20000, MAX, null, h, body == null ? undefined : JSON.stringify(body), true);
    }
    function rpc(cfg, fn, params, token) { return ask(cfg, '/rest/v1/rpc/' + fn, params || {}, token); }
    function first(r) { return Array.isArray(r) ? r[0] : r; }

    // A code to approve: { code, link, nonce }.
    function start(cfg) {
        var nonce = U.randomHex(32);
        return rpc(cfg, 'start_tv_login_session', { p_device_nonce: nonce, p_redirect_base_url: LOGIN_PAGE, p_device_name: 'StremioK' }).then(function (r) {
            var x = first(r) || {}, link = '' + (x.web_url || '');
            if (!/^[0-9a-f]{8,64}$/i.test(x.code || '') || !U.parseUrl(link) || link.indexOf(LOGIN_PAGE) !== 0) { throw new Error(U.t('Nuvio didn’t give a code')); }
            return { code: x.code, link: link, nonce: nonce };
        });
    }
    // The session once approved on the phone (asked every POLL_MS, WAIT_MS at most). stopped():
    // true once the screen asking has gone (a session that arrives then is signed out).
    function wait(cfg, s, stopped) {
        var until = Date.now() + WAIT_MS;
        return new Promise(function (resolve, reject) {
            function poll() {
                if (stopped && stopped()) { reject(new Error('stopped')); return; }
                if (Date.now() > until) { reject(new Error(U.t('The code expired: try again'))); return; }
                rpc(cfg, 'poll_tv_login_session', { p_code: s.code, p_device_nonce: s.nonce }).then(function (r) {
                    var st = (first(r) || {}).status;
                    if (st === 'expired' || st === 'cancelled') { reject(new Error(U.t('The code expired: try again'))); return; }
                    if (st !== 'approved') { setTimeout(poll, POLL_MS); return; }
                    ask(cfg, '/functions/v1/tv-logins-exchange', { code: s.code, device_nonce: s.nonce }).then(function (t) {
                        var token = t && typeof t.access_token === 'string' && t.access_token.length < 8192 ? t.access_token : '';
                        if (!token) { reject(new Error(U.t('Nuvio didn’t sign StremioK in'))); return; }
                        if (stopped && stopped()) { signOut(cfg, token); reject(new Error('stopped')); return; }
                        // (the session: { access, refresh (to renew it, for a profile kept in sync), expires (ms) })
                        resolve({ access: token, refresh: typeof t.refresh_token === 'string' && t.refresh_token.length < 4096 ? t.refresh_token : '', expires: Date.now() + Math.max(60, +t.expires_in || 3600) * 1000 });
                    }, reject);
                }, function () { setTimeout(poll, POLL_MS); });   // (a dropped answer: asked again)
            }
            setTimeout(poll, POLL_MS);
        });
    }
    // The session given up (Nuvio's own sign-out): whatever happens, nothing is kept here.
    function signOut(cfg, token) { return ask(cfg, '/auth/v1/logout', {}, token).then(function () {}, function () {}); }

    // Its profiles: [{ index, name, color (#rrggbb), primaryAddons, primaryPlugins, locked }].
    function profiles(cfg, token) {
        return rpc(cfg, 'sync_pull_profiles', {}, token).then(function (r) {
            return U.listOf(r, 6, function (p) { return p && typeof p.profile_index === 'number'; }).map(function (p) {
                return { index: p.profile_index, name: U.drawable('' + (p.name || '')).trim().slice(0, 24) || U.t('Profile {n}', { n: p.profile_index }),
                    color: /^#?[0-9a-f]{6}$/i.test(p.avatar_color_hex || '') ? ('#' + ('' + p.avatar_color_hex).replace('#', '')).toLowerCase() : '',
                    primaryAddons: !!p.uses_primary_addons, primaryPlugins: !!p.uses_primary_plugins, locked: !!p.pin_enabled };
            }).sort(function (a, b) { return a.index - b.index; });
        });
    }
    // What a profile brings: { addons: [url] (in its order, the ones on), watched: { key: when },
    // progress: [{ type, id, parent, season, episode, position (s), duration (s), updated (ms) }] }.
    function profileData(cfg, token, p, all, plugins) {
        var repos = (plugins || []).filter(function (a) { return a.profile_id === (p.primaryPlugins ? 1 : p.index) && a.enabled !== false && typeof a.url === 'string'; })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }).map(function (a) { return { url: a.url.trim(), name: U.drawable('' + (a.name || '')).slice(0, 60) }; });
        var addons = all.filter(function (a) { return a.profile_id === (p.primaryAddons ? 1 : p.index) && a.enabled !== false && typeof a.url === 'string'; })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }).map(function (a) { return a.url.trim(); });
        return Promise.all([
            rpc(cfg, 'sync_pull_watched_items', { p_profile_id: p.index, p_page: 1, p_page_size: WATCHED_MAX }, token).then(null, function () { return []; }),
            rpc(cfg, 'sync_pull_watch_progress', { p_profile_id: p.index, p_limit: PROGRESS_MAX }, token).then(null, function () { return []; })
        ]).then(function (r) {
            var watched = {};
            U.listOf(r[0], WATCHED_MAX, function (w) { return w && /^tt\d+$/.test(w.content_id || '') && (w.content_type === 'movie' || w.content_type === 'series'); }).forEach(function (w) {
                var ep = w.content_type === 'series' && w.season > 0 && w.episode > 0, when = +w.watched_at || Date.now();
                if (w.content_type === 'series' && !ep) { return; }   // (a whole show: its episodes say)
                watched[w.content_type + ':' + w.content_id + (ep ? ':' + w.season + ':' + w.episode : '')] = when < 1e11 ? when * 1000 : when;
            });
            var progress = U.listOf(r[1], PROGRESS_MAX, function (x) { return x && /^tt\d+$/.test(x.content_id || '') && (x.content_type === 'movie' || x.content_type === 'series') && +x.position > 0; }).map(function (x) {
                var ep = x.content_type === 'series' && x.season > 0 && x.episode > 0, dur = +x.duration || 0, pos = +x.position || 0, ms = dur > 86400 || pos > 86400;   // (in milliseconds, as Nuvio keeps them)
                return { type: x.content_type, id: ep ? x.content_id + ':' + x.season + ':' + x.episode : x.content_id, parent: x.content_id, season: x.season, episode: x.episode,
                    position: Math.floor(ms ? pos / 1000 : pos), duration: Math.floor(ms ? dur / 1000 : dur), updated: (+x.last_watched || 0) < 1e11 ? (+x.last_watched || 0) * 1000 : +x.last_watched };
            }).filter(function (x) { return x.type === 'movie' || x.season > 0; });
            return { addons: addons, watched: watched, progress: progress, plugins: repos };
        });
    }
    // Everything at once: [{ index, name, color, locked, addons, watched, progress, plugins }]; then
    // signed out, unless keep (a profile kept in sync with it: js/nuvio-sync.js keeps the session).
    function readAll(cfg, token, keep) {
        var out = profiles(cfg, token).then(function (list) {
            return Promise.all([
                ask(cfg, '/rest/v1/addons?select=url,name,enabled,sort_order,profile_id&order=sort_order.asc', null, token),
                ask(cfg, '/rest/v1/plugins?select=url,name,enabled,sort_order,profile_id&order=sort_order.asc', null, token).then(null, function () { return []; })
            ]).then(function (r) {
                var addons = U.listOf(r[0], 2000, function (x) { return x && typeof x.url === 'string'; }), plugins = U.listOf(r[1], 200, function (x) { return x && typeof x.url === 'string'; });
                return Promise.all(list.map(function (p) { return profileData(cfg, token, p, addons, plugins).then(function (d) { return Object.assign({}, p, d); }); }));
            });
        });
        if (!keep) { out.then(function () { signOut(cfg, token); }, function () { signOut(cfg, token); }); }   // (signed out as soon as it's read)
        return out;
    }
    // Its profiles' addons only (Settings › Content › Addons › Import addons from Nuvio): [{ index,
    // name, addons: [{ url, name }] (in its order, the ones on) }]; then signed out, unless keep.
    function readAddons(cfg, token, keep) {
        var out = Promise.all([profiles(cfg, token), ask(cfg, '/rest/v1/addons?select=url,name,enabled,sort_order,profile_id&order=sort_order.asc', null, token)]).then(function (r) {
            var rows = U.listOf(r[1], 2000, function (x) { return x && typeof x.url === 'string'; });
            return r[0].map(function (p) {
                var own = p.primaryAddons ? 1 : p.index;
                return { index: p.index, name: p.name, addons: rows.filter(function (a) { return a.profile_id === own && a.enabled !== false; })
                    .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }).map(function (a) { return { url: a.url.trim(), name: U.drawable('' + (a.name || '')).slice(0, 60) }; }) };
            });
        });
        if (!keep) { out.then(function () { signOut(cfg, token); }, function () { signOut(cfg, token); }); }
        return out;
    }
    // The StremioK color nearest a Nuvio one.
    function nearestColor(hex, palette) {
        var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
        if (!m) { return null; }
        var best = null, bd = 1e9, r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
        Object.keys(palette).forEach(function (k) {
            var q = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(palette[k]);
            if (!q) { return; }
            var d = Math.pow(r - parseInt(q[1], 16), 2) + Math.pow(g - parseInt(q[2], 16), 2) + Math.pow(b - parseInt(q[3], 16), 2);
            if (d < bd) { bd = d; best = k; }
        });
        return best;
    }
    return { discover: discover, start: start, wait: wait, readAll: readAll, readAddons: readAddons, signOut: signOut, nearestColor: nearestColor, ask: ask, rpc: rpc, LOGIN_PAGE: LOGIN_PAGE };
})();
