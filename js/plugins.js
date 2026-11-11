/* Nuvio plugins (Settings › Content › Nuvio plugins; docs/PLUGINS.md): programs written for the
   Nuvio apps that look for a title's sources. A repository is a manifest.json the user adds by its
   address; it lists plugins, each one JavaScript file (CommonJS) exporting
   getStreams(tmdbId, mediaType, season, episode) -> a promise of sources.

   Each plugin runs in a fresh QuickJS context inside a Web Worker (js/vendor/quickjs/
   plugin-worker.js, built by plugin-runtime/): nothing of StremioK's inside, its requests through
   the service (/plug/fetch: the home network as Local-network links from internet addons says),
   64 MB, RUN_MS. Only where that can run: see supported() (2017 and newer TVs)
   and StremioK's own service (the sideloaded app); elsewhere the option isn't shown.

   The code is downloaded on Add and Refresh only, kept in the TV's database (U.bigStore). New
   plugins start off. Plugins are handed the user's TMDB key (they look titles up by TMDB number),
   which Settings says before they're turned on. Their sources come in as a synthetic addon's,
   "Nuvio plugins", placed and ranked like any addon's.
   Global namespace: Plugins */
var Plugins = (function () {
    'use strict';
    var KEY = 'stremiok.plugins';   // { on, repos: [{ id, url, name, at, plugins: [{ id, name, version, file, types, on, size, hash }] }] }
    var CODE = 'stremiok.plugins.code.';   // + repo id + '.' + plugin id (U.bigStore)
    var MAX_REPOS = 10, MAX_PLUGINS = 50, CODE_MAX = 1048576, MANIFEST_MAX = 262144, RUN_MS = 20000, RUN_MS_LEGACY = 30000, MAX_RESULTS = 100, AT_ONCE = 2, IDLE_MS = 120000;
    var WORKER = 'js/vendor/quickjs/plugin-worker.js', WORKER_LEGACY = 'js/vendor/quickjs/plugin-worker-legacy.js';

    // Can this TV run them? Two runtimes (js/vendor/quickjs/): WebAssembly for Chromium 76 and later
    // (Tizen 6 on: built for and tried there), and QuickJS as plain JavaScript (-legacy) for older
    // engines, down to Chromium 47 (Tizen 3: tried on a 2017 TV), one plugin at a time with more time.
    // Offered on both; experimental where not tried (Tizen 4, 5.0, 5.5: Chromium 56 to 69). Both
    // need Workers and the sideloaded app's own service (TizenBrew's is shared with other modules:
    // not there yet; a browser has none).
    var MIN_CHROMIUM = 76, MIN_LEGACY = 47, TRIED_LEGACY = 47;
    var TIZEN_CHROMIUM = { '3.0': 47, '4.0': 56, '5.0': 63, '5.5': 69, '6.0': 76, '6.5': 85 };
    function chromium() {   // (a Tizen TV says it without "Chrome/": "(KHTML, like Gecko) 76.0.3809.146/6.0 TV"; Tizen 3 not at all)
        var ua = '' + ((typeof navigator !== 'undefined' && navigator.userAgent) || '');
        var m = /Chrome\/(\d+)\./.exec(ua) || /\(KHTML, like Gecko\) (\d+)\.\d+\.\d+/.exec(ua), t = /Tizen (\d+\.\d+)/.exec(ua);
        return m ? +m[1] : t && TIZEN_CHROMIUM[t[1]] ? TIZEN_CHROMIUM[t[1]] : 0;
    }
    function legacy() { return !(chromium() >= MIN_CHROMIUM && typeof WebAssembly === 'object'); }
    function workerFile() { return legacy() ? WORKER_LEGACY : WORKER; }
    function supported() {
        return chromium() >= MIN_LEGACY && typeof Worker === 'function' && typeof YTPlay !== 'undefined' && !!YTPlay.pluginNet && YTPlay.installMode() === 'wgt';
    }
    function experimental() { var c = chromium(); return c > TRIED_LEGACY && c < MIN_CHROMIUM; }
    function runMs() { return legacy() ? RUN_MS_LEGACY : RUN_MS; }
    function state() {
        var s = U.store.get(KEY, null);
        if (!s || typeof s !== 'object') { s = {}; }
        return { on: s.on === true, repos: (Array.isArray(s.repos) ? s.repos : []).filter(function (r) { return r && typeof r.url === 'string' && Array.isArray(r.plugins); }) };
    }
    function save(s) { U.store.set(KEY, { on: !!s.on, repos: s.repos }); }
    function isEnabled() { return supported() && state().on; }
    function setEnabled(on) { var s = state(); s.on = !!on; save(s); reloadAddons(); }
    function repos() { return state().repos; }
    function enabledPlugins() {
        var out = [];
        repos().forEach(function (r) { r.plugins.forEach(function (p) { if (p.on) { out.push({ repo: r, p: p }); } }); });
        return out;
    }
    // (the addon list rebuilt with, or without, the plugins' source addon; titles' sources asked again)
    function reloadAddons() {
        if (typeof Stremio === 'undefined') { return; }
        try { if (Stremio.addonsChanged) { Stremio.addonsChanged(); } if (Stremio.sourcesChanged) { Stremio.sourcesChanged(); } } catch (e) {}
    }

    // A repository's manifest address from what was typed: its manifest.json, or the folder it's in.
    function manifestUrl(input) {
        var u = ('' + (input || '')).trim();
        if (!/^https?:\/\/[^\s]+$/i.test(u)) { return ''; }
        if (!/\/manifest\.json(?:[?#]|$)/i.test(u)) { u = u.replace(/[?#].*$/, '').replace(/\/+$/, '') + '/manifest.json'; }
        return u;
    }
    function addressProblem(input) { return manifestUrl(input) ? null : U.t('A web address, like https://example.com/plugins/manifest.json'); }
    function resolve(base, rel) {
        rel = '' + rel;
        if (/^https?:\/\//i.test(rel)) { return rel; }
        var origin = /^(https?:\/\/[^\/]+)/i.exec(base)[1];
        if (rel.charAt(0) === '/') { return origin + rel; }
        return base.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + rel.replace(/^\.\//, '');
    }
    function hashOf(text) {   // (FNV-1a: to tell when a plugin's code changed)
        var h = 0x811c9dc5;
        for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
        return ('0000000' + h.toString(16)).slice(-8);
    }
    function str(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : ''; }
    function idOf(v) { return ('' + v).replace(/[^\w.\-]/g, '_').slice(0, 64); }

    // A repository read (its manifest, then each plugin's code): { name, plugins: [{…, code}] }.
    function readRepo(url) {
        return U.getJSON(url, 20000, MANIFEST_MAX).then(function (m) {
            var list = m && (Array.isArray(m.scrapers) ? m.scrapers : Array.isArray(m.plugins) ? m.plugins : null);
            if (!list) { throw new Error(U.t('not a plugin repository (no list of plugins)')); }
            list = list.filter(function (x) { return x && x.id && typeof x.filename === 'string'; }).slice(0, MAX_PLUGINS);
            var seen = {};
            list = list.filter(function (x) { var k = idOf(x.id); if (seen[k]) { return false; } seen[k] = true; return true; });
            return Promise.all(list.map(function (x) {
                var types = (Array.isArray(x.supportedTypes) ? x.supportedTypes : ['movie', 'tv']).filter(function (t) { return t === 'movie' || t === 'tv'; });
                var p = { id: idOf(x.id), name: str(x.name, 80) || idOf(x.id), version: str(x.version, 20), file: resolve(url, x.filename), types: types, on: false };
                return U.getText(p.file, 20000, CODE_MAX).then(function (code) { p.code = '' + code; p.size = p.code.length; p.hash = hashOf(p.code); return p; },
                    function (e) { p.error = U.problem(e); return p; });
            })).then(function (plugins) { return { name: str(m.name, 80) || url.replace(/^https?:\/\//, '').replace(/\/manifest\.json.*$/i, ''), plugins: plugins }; });
        });
    }
    // Add a repository (or read it again: refresh), keeping each plugin's on / off. Resolves to
    // { repo, added, changed, failed } (failed: plugins whose code didn't come; kept as they were).
    function saveRepo(url, id) {
        var s = state(), old = null;
        s.repos.forEach(function (r) { if (r.id === id || (!id && r.url === url)) { old = r; } });
        if (!old && s.repos.length >= MAX_REPOS) { return Promise.reject(new Error(U.t('up to {n} repositories', { n: MAX_REPOS }))); }
        return readRepo(url).then(function (got) {
            var rid = old ? old.id : 'r' + Date.now().toString(36);
            var before = {};
            if (old) { old.plugins.forEach(function (p) { before[p.id] = p; }); }
            var added = 0, changed = 0, failed = 0, writes = [];
            var plugins = got.plugins.map(function (p) {
                var was = before[p.id];
                if (p.error) { failed++; return was || null; }
                if (!was) { added++; } else if (was.hash !== p.hash) { changed++; }
                writes.push(U.bigStore.set(CODE + rid + '.' + p.id, p.code));
                return { id: p.id, name: p.name, version: p.version, file: p.file, types: p.types, on: !!(was && was.on), size: p.size, hash: p.hash };
            }).filter(Boolean);
            return Promise.all(writes).then(function () {
                if (old) { old.plugins.forEach(function (p) { if (!plugins.some(function (q) { return q.id === p.id; })) { U.bigStore.remove(CODE + rid + '.' + p.id); } }); }
                var repo = { id: rid, url: url, name: got.name, at: Date.now(), plugins: plugins };
                var s2 = state();
                s2.repos = s2.repos.filter(function (r) { return r.id !== rid; });
                s2.repos.push(repo);
                save(s2);
                reloadAddons();
                return { repo: repo, added: added, changed: changed, failed: failed };
            });
        });
    }
    function addRepo(input) {
        var url = manifestUrl(input);
        if (!url) { return Promise.reject(new Error(addressProblem(input))); }
        return saveRepo(url, null);
    }
    function refreshRepo(id) {
        var r = repos().filter(function (x) { return x.id === id; })[0];
        return r ? saveRepo(r.url, r.id) : Promise.reject(new Error('gone'));
    }
    function removeRepo(id) {
        var s = state();
        s.repos.forEach(function (r) { if (r.id === id) { r.plugins.forEach(function (p) { U.bigStore.remove(CODE + r.id + '.' + p.id); }); } });
        s.repos = s.repos.filter(function (r) { return r.id !== id; });
        save(s);
        reloadAddons();
    }
    function setPlugin(repoId, pluginId, on) {
        var s = state();
        s.repos.forEach(function (r) { if (r.id === repoId) { r.plugins.forEach(function (p) { if (p.id === pluginId) { p.on = !!on; } }); } });
        save(s);
        reloadAddons();
    }

    // ---- The Worker (one, kept while in use; gone after IDLE_MS, or when it asks to start over)
    var _worker = null, _waiting = {}, _next = 1, _idle = null;
    function worker() {
        if (_idle) { clearTimeout(_idle); _idle = null; }
        if (_worker) { return _worker; }
        _worker = new Worker(workerFile());
        _worker.onmessage = function (ev) {
            var m = ev.data || {};
            if (m.type === 'restart') { drop(); return; }
            var w = _waiting[m.id];
            if (!w) { return; }
            delete _waiting[m.id];
            clearTimeout(w.timer);
            w.done(m);
            idleLater();
        };
        _worker.onerror = function (e) { U.log('plugins', 'Plugin runtime error: ' + ((e && e.message) || 'unknown')); fail('the plugin runtime stopped'); };
        return _worker;
    }
    function idleLater() { if (!Object.keys(_waiting).length) { _idle = setTimeout(drop, IDLE_MS); } }
    function drop() { if (_worker) { try { _worker.terminate(); } catch (e) {} _worker = null; } }
    function fail(why) { var w = _waiting; _waiting = {}; drop(); Object.keys(w).forEach(function (k) { clearTimeout(w[k].timer); w[k].done({ type: 'failed', why: why, logs: [] }); }); }
    function runOne(code, plugin, args, net) {
        return new Promise(function (resolve) {
            var id = _next++;
            var timer = setTimeout(function () { if (_waiting[id]) { fail('took too long'); } }, runMs() + 5000);   // (a runtime that stopped answering: started over)
            _waiting[id] = { done: resolve, timer: timer };
            var tmdbKey = typeof Stremio !== 'undefined' && Stremio.getIntegrations ? (Stremio.getIntegrations().tmdb || '') : '';
            try { worker().postMessage({ type: 'run', id: id, code: code, scraperId: plugin.id, args: args, tmdbKey: tmdbKey, net: net, timeoutMs: runMs(), maxResults: MAX_RESULTS }); }
            catch (e) { delete _waiting[id]; clearTimeout(timer); resolve({ type: 'failed', why: (e && e.message) || 'couldn’t start', logs: [] }); }
        });
    }

    // ---- A title's sources
    function lanAllowed() { return typeof Stremio !== 'undefined' && Stremio.getPrefs ? !!Stremio.getPrefs().allowLocal : false; }
    // A plugin's source as an addon's: plain data, its headers as proxyHeaders (played as an addon's).
    function toSource(x, plugin, n) {
        if (!x || typeof x !== 'object') { return null; }
        var url = typeof x.url === 'string' ? x.url.trim() : '', hash = typeof x.infoHash === 'string' && /^[0-9a-f]{40}$/i.test(x.infoHash) ? x.infoHash.toLowerCase() : '';
        if (!hash && (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 4096)) { return null; }
        if (url && !lanAllowed() && U.urlIsPrivate && U.urlIsPrivate(url)) { return null; }
        var bits = [str(x.title, 300) || str(x.name, 120)];
        if (str(x.quality, 20)) { bits.push(str(x.quality, 20)); }
        if (str(x.size, 30)) { bits.push(str(x.size, 30)); }
        var s = { name: plugin.name + (str(x.name, 60) && str(x.name, 60) !== plugin.name ? '\n' + str(x.name, 60) : ''), title: bits.filter(Boolean).join('\n'), _plugin: plugin.id, _pluginPos: n };
        if (hash) { s.infoHash = hash; if (typeof x.fileIdx === 'number') { s.fileIdx = x.fileIdx; } } else { s.url = url; }
        var h = x.headers && typeof x.headers === 'object' ? x.headers : (x.behaviorHints && x.behaviorHints.proxyHeaders && x.behaviorHints.proxyHeaders.request);
        var clean = h ? U.sanitizeHeaders(h) : null;
        s.behaviorHints = { notWebReady: true };
        if (clean) {
            s.behaviorHints.proxyHeaders = { request: {} };
            if (clean.ua) { s.behaviorHints.proxyHeaders.request['User-Agent'] = clean.ua; }
            if (clean.ref) { s.behaviorHints.proxyHeaders.request.Referer = clean.ref; }
            if (clean.cookie) { s.behaviorHints.proxyHeaders.request.Cookie = clean.cookie; }
            if (clean.origin) { s.behaviorHints.proxyHeaders.request.Origin = clean.origin; }
            if (clean.accept) { s.behaviorHints.proxyHeaders.request.Accept = clean.accept; }
            if (clean.lang) { s.behaviorHints.proxyHeaders.request['Accept-Language'] = clean.lang; }
            s._headers = clean;
        }
        return s;
    }
    // The TMDB number plugins ask by: in the id (tmdb:…), the title's details, or looked up.
    function tmdbOf(type, id, meta) {
        var m = /^tmdb:(\d+)/.exec(id);
        if (m) { return Promise.resolve(m[1]); }
        var known = meta && (meta.moviedb_id || meta.tmdb_id || (meta.behaviorHints && meta.behaviorHints.tmdbId));
        if (known && /^\d+$/.test('' + known)) { return Promise.resolve('' + known); }
        var imdb = /^(tt\d+)/.exec(id);
        if (!imdb || typeof Stremio === 'undefined' || !Stremio.tmdbFind) { return Promise.resolve(null); }
        return Stremio.tmdbFind(imdb[1], type === 'series' ? 'tv' : 'movie').then(function (n) { return n ? '' + n : null; });
    }
    function streams(type, id, meta) {
        if (!isEnabled()) { return Promise.resolve([]); }
        var kind = type === 'series' ? 'tv' : type === 'movie' ? 'movie' : '';
        var todo = enabledPlugins().filter(function (x) { return kind && x.p.types.indexOf(kind) !== -1; });
        if (!todo.length) { return Promise.resolve([]); }
        var ep = /:(\d+):(\d+)$/.exec(id || '');
        return tmdbOf(type, id || '', meta).then(function (tmdb) {
            if (!tmdb) { U.log('plugins', 'No TMDB number for ' + id + ' (a TMDB key is needed: Settings › Content › Integrations)'); return []; }
            var args = [tmdb, kind, ep ? +ep[1] : null, ep ? +ep[2] : null];
            return YTPlay.pluginNet(lanAllowed()).then(function (net) {
                var out = [];
                return U.settleAll(todo.map(function (x) {
                    return function () {
                        return U.bigStore.get(CODE + x.repo.id + '.' + x.p.id).then(function (code) {
                            if (typeof code !== 'string' || !code) { throw new Error('its code isn’t on the TV: refresh its repository'); }
                            return runOne(code, x.p, args, net);
                        }).then(function (r) {
                            (r.logs || []).slice(0, 20).forEach(function (l) { U.log('plugins', x.p.name + ': ' + l); });
                            if (r.type !== 'done') { throw new Error(r.why || 'failed'); }
                            var list = (Array.isArray(r.streams) ? r.streams : []).slice(0, MAX_RESULTS).map(function (s, n) { return toSource(s, x.p, n); }).filter(Boolean);
                            out = out.concat(list);
                        }).then(null, function (e) { U.log('plugins', x.p.name + ' (' + args.slice(0, 2).join(' ') + '): ' + ((e && e.message) || e)); });
                    };
                }), legacy() ? 1 : AT_ONCE).then(function () { return out; });
            }, function () { return []; });
        });
    }

    // The synthetic addon its sources come in as ("Nuvio plugins": a source addon, no catalogs)
    var _addon = null;
    function synthAddon() {
        if (!_addon) {
            _addon = { __local: true, __sources: true, __impl: { streams: streams }, url: 'local:plugins', base: 'local:plugins',
                manifest: { id: 'org.stremiok.plugins', name: 'Nuvio plugins', version: '1.0.0', types: ['movie', 'series'], catalogs: [],
                    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }] } };
        }
        return _addon;
    }
    function hasSources() { return isEnabled() && enabledPlugins().length > 0; }

    return { supported: supported, isEnabled: isEnabled, setEnabled: setEnabled, repos: repos, addRepo: addRepo, refreshRepo: refreshRepo, removeRepo: removeRepo,
        setPlugin: setPlugin, addressProblem: addressProblem, manifestUrl: manifestUrl, streams: streams, synthAddon: synthAddon, hasSources: hasSources,
        toSource: toSource, workerFile: workerFile, experimental: experimental, slower: legacy, MAX_REPOS: MAX_REPOS };
})();
