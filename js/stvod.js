/* Stalker films and series. Global namespace: StVod
   A Stalker portal's (your IPTV playlists') films and series, as a local addon like Xtream's
   (js/xtvod.js): a Movies and a Series catalog per portal (its categories as genres; none: the
   newest; search), their pages and sources, and, on titles from your addons, the portal's copies
   (found by a search of it when a title's sources are asked). All of it through StremioK's
   service, which asks as a MAG box does (see service/index.js, /stalker/vod; YTPlay.stalkerVod).
   A source is the service's link that asks the portal for the title's own when it's played
   (/stalker/play): nothing is asked of the portal before, and the link saved to resume stays good.
   Ids: svm.<portal>.<id> (a film), svs.<portal>.<id> (a series; svs.<portal>.v.<id>: a film the
   portal marks as a series; its episodes svs.<portal>.<id>:<season>:<episode>, as other addons'
   tt…:1:2). */
var StVod = (function () {
    'use strict';

    var CATS_KEY = 'stremiok.stvod.cats', SEEN_KEY = 'stremiok.stvod.seen', CATS_FRESH_MS = 86400000, CATS_RETRY_MS = 6 * 3600000, SEEN_MAX = 200;
    function enc(v) { return encodeURIComponent('' + v); }

    // The Stalker portals among your playlists (switched on): { id, label, url, mac }.
    function accounts() {
        if (typeof IPTV === 'undefined' || !IPTV.isStalker) { return []; }
        return IPTV.getPlaylists().filter(function (p) { return !p.off && IPTV.isStalker(p); }).map(function (p) {
            return { id: p.id, label: IPTV.label(p.id), url: p.url, mac: p.mac };
        });
    }
    function account(id) {
        var l = accounts();
        for (var i = 0; i < l.length; i++) { if (l[i].id === id) { return l[i]; } }
        return null;
    }
    // How long the service keeps what it read of a portal (Settings › Content › IPTV › Stalker films
    // and series): 10 minutes, 5, or 0 (not kept).
    var KEEP_KEY = 'stremiok.iptv.stalkerkeep', KEEPS = [10, 5, 0];
    function keepMinutes() { var m = U.store.get(KEEP_KEY, 10); return KEEPS.indexOf(m) !== -1 ? m : 10; }
    function setKeepMinutes(m) { U.store.set(KEEP_KEY, KEEPS.indexOf(+m) !== -1 ? +m : 10); }
    // The service's answer ({ why }: an error).
    function ask(acc, more) {
        if (typeof YTPlay === 'undefined' || !YTPlay.stalkerVod) { return Promise.reject(new Error('Stalker portals are read by StremioK’s service (not in a desktop browser)')); }
        return YTPlay.stalkerVod(acc.url, acc.mac, more + '&keep=' + keepMinutes()).then(function (r) {
            if (!r || r.why) { throw new Error((r && r.why) || 'no answer'); }
            return r;
        });
    }

    // ---- Categories: Discover's genres, kept a day (U.store), read again in the background ----
    // What's kept follows the portal's address and MAC: either edited, the old one's aren't its own.
    var _cats = null, _catsAsked = {}, _changeFns = [], _reloaded = {};
    function onChange(fn) { _changeFns.push(fn); }   // (catalogs added or gone once its categories came)
    function changed() { _changeFns.forEach(function (fn) { try { fn(); } catch (e) {} }); }
    function sigOf(acc) { return acc.id + '|' + acc.url + '|' + acc.mac; }
    function catsAll() {
        if (!_cats) { var c = U.store.get(CATS_KEY, {}); _cats = c && typeof c === 'object' && !Array.isArray(c) ? c : {}; }
        return _cats;
    }
    function known(acc) { var c = catsAll()[acc.id]; return c && c.sig === sigOf(acc) ? c : null; }
    function catsOf(acc, type) { var c = known(acc); return c && Array.isArray(c[type]) ? c[type] : []; }
    // A portal with films or series of that type (either, without one), or whose categories
    // haven't come yet. One that lists none adds nothing: no catalogs, no copies.
    function hasVod(acc, type) {
        var c = known(acc);
        if (!c) { return !type; }
        return type ? catsOf(acc, type).length > 0 : !c.none;
    }
    function isEnabled() { return accounts().some(function (acc) { return hasVod(acc); }); }
    function catList(r) {
        return (r && Array.isArray(r.cats) ? r.cats : []).filter(function (c) { return c && c.id && c.title; }).slice(0, 1000).map(function (c) { return [('' + c.id).slice(0, 40), ('' + c.title).slice(0, 80)]; });
    }
    function refreshCats() {
        accounts().forEach(function (acc) {
            var c = known(acc), sk = sigOf(acc);
            if ((c && Date.now() - c.at < (c.none ? CATS_RETRY_MS : CATS_FRESH_MS)) || _catsAsked[sk]) { return; }
            _catsAsked[sk] = true;   // (once a launch: a portal that didn't answer is asked again at the next)
            function either(p) { return p.then(null, function (e) { return { failed: e }; }); }
            var fresh = _reloaded[acc.id] ? '&fresh=1' : '';   // (Reload: the service's kept lists let go too)
            Promise.all([either(ask(acc, '&type=movie&do=cats' + fresh)), either(ask(acc, '&type=series&do=cats' + fresh))]).then(function (r) {
                if (r[0].failed && r[1].failed) { U.log('iptv', 'Stalker “' + acc.label + '”: its films and series couldn’t be read (' + U.problem(r[0].failed) + ')'); return; }
                var all = catsAll(), keep = {}, o = { sig: sk, movie: catList(r[0]), series: catList(r[1]), at: Date.now() };
                if (!o.movie.length && !o.series.length) { o.none = true; U.log('iptv', 'Stalker “' + acc.label + '”: no films or series'); }
                accounts().forEach(function (a) { if (all[a.id]) { keep[a.id] = all[a.id]; } });   // (portals gone: dropped)
                keep[acc.id] = o;
                _cats = keep;
                U.store.set(CATS_KEY, keep);
                var before = _addon ? _addon.manifest.catalogs.length : 0;
                fillCatalogs();
                if (_addon && (_addon.manifest.catalogs.length !== before || _reloaded[acc.id])) { changed(); }   // (its rows: Home reads them now)
                delete _reloaded[acc.id];
            });
        });
    }
    // Reload on a portal (Settings › Content › IPTV): its categories asked again now, and the
    // service's kept lists of it let go (fresh=1).
    function reload(id) {
        var acc = account(id), all = catsAll();
        if (!acc) { return; }
        delete all[id];
        U.store.set(CATS_KEY, all);
        _catsAsked[sigOf(acc)] = false;
        _seasons.clear();
        _reloaded[id] = true;
        refreshCats();
    }

    // ---- The addon ----
    var _addon = null;
    function catalogsNow() {
        var out = [];
        accounts().forEach(function (acc) {
            ['movie', 'series'].forEach(function (type) {
                if (!hasVod(acc, type)) { return; }
                out.push({ type: type, id: 'sv.' + acc.id + '.' + type, name: acc.label,
                    extra: [{ name: 'genre', options: catsOf(acc, type).map(function (c) { return c[1]; }) }, { name: 'search' }, { name: 'skip' }] });
            });
        });
        return out;
    }
    var RESOURCES = ['catalog', { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }];
    function fillCatalogs() {   // (changed in place: the loaded addon holds the same list)
        if (!_addon) { return; }
        var l = _addon.manifest.catalogs;
        l.splice.apply(l, [0, l.length].concat(catalogsNow()));
        _addon.manifest.resources = accounts().some(function (acc) { return hasVod(acc, 'movie') || hasVod(acc, 'series'); }) ? RESOURCES : ['catalog'];
    }
    function synthAddon() {
        if (!_addon) {
            _addon = { __local: true, __impl: StVod, __sources: true, url: 'local:stvod', base: 'local:stvod',
                manifest: { id: 'org.stremiok.stvod', name: 'Stalker', version: '1.0.0', types: ['movie', 'series'], resources: RESOURCES, catalogs: [] } };
        }
        fillCatalogs();
        refreshCats();
        return _addon;
    }

    // ---- Titles: a card, and what the portal said of it (its cmd: what plays it) ----
    // Kept while StremioK runs; a title whose page was opened, also for the next launches (SEEN_MAX
    // of them: Continue Watching's open their pages again).
    var _items = U.lru(600);
    function slim(it) { var o = { name: it.name }; ['year', 'pic', 'cmd', 'rating', 'series'].forEach(function (k) { if (it[k]) { o[k] = it[k]; } }); return o; }
    function seenAll() { var a = U.store.get(SEEN_KEY, []); return Array.isArray(a) ? a : []; }
    function remember(id, it) {
        var all = seenAll().filter(function (x) { return x && x[0] !== id; });
        all.push([id, slim(it)]);
        U.store.set(SEEN_KEY, all.slice(-SEEN_MAX));
    }
    function recall(id) {
        var it = _items.get(id);
        if (it) { return it; }
        var all = seenAll();
        for (var i = all.length - 1; i >= 0; i--) { if (all[i] && all[i][0] === id && all[i][1] && all[i][1].name) { return all[i][1]; } }
        return null;
    }
    function idOf(acc, type, it) {
        var series = type === 'series' || !!it.series;
        return (series ? 'svs.' : 'svm.') + acc.id + '.' + (type === 'movie' && it.series ? 'v.' : '') + it.id;
    }
    function cardOf(acc, type, it) {
        if (!it || !it.id || !it.name) { return null; }
        var id = idOf(acc, type, it), m = { id: id, type: /^svs\./.test(id) ? 'series' : 'movie', name: it.name, posterShape: 'poster' };
        if (it.pic) { m.poster = it.pic; }
        if (it.rating > 0) { m.imdbRating = (+it.rating).toFixed(1); }
        if (it.year) { m.releaseInfo = '' + it.year; }
        if (it.desc) { m.description = it.desc; }
        _items.set(id, it);
        return m;
    }
    function catalog(catId, extra) {
        var m = /^sv\.([^.]+)\.(movie|series)$/.exec(catId || ''), acc = m && account(m[1]);
        if (!acc) { return Promise.resolve([]); }
        var type = m[2], skip = extra && extra.skip ? (parseInt(extra.skip, 10) || 0) : 0, cat = '*';
        if (extra && extra.genre) {
            var c = catsOf(acc, type).filter(function (x) { return x[1] === extra.genre; })[0];
            if (!c) { return Promise.resolve([]); }
            cat = c[0];
        }
        var more = '&type=' + type + '&do=list&cat=' + enc(cat) + (extra && extra.search ? '&q=' + enc(('' + extra.search).slice(0, 120)) : '') + (skip ? '&skip=' + skip : '');
        return ask(acc, more).then(function (r) {
            return (Array.isArray(r.items) ? r.items : []).map(function (it) { return cardOf(acc, type, it); }).filter(Boolean);
        }, function (e) {
            U.log('iptv', 'Stalker “' + acc.label + '”: its ' + (type === 'movie' ? 'films' : 'series') + ' couldn’t be read (' + U.problem(e) + ')');
            return [];
        });
    }

    // ---- A title's page ----
    function parseId(id) {
        var m = /^sv([ms])\.([^.]+)\.(v\.)?([\w-]+)(?::(\d+):(\d+))?$/.exec('' + id);
        if (!m) { return null; }
        var x = { kind: m[1], acc: account(m[2]), vod: !!m[3], num: m[4], season: m[5] != null ? +m[5] : null, episode: m[6] != null ? +m[6] : null };
        x.base = 'sv' + x.kind + '.' + m[2] + '.' + (x.vod ? 'v.' : '') + x.num;
        return x;
    }
    // A series' seasons, as the service lists them ({ season, name, cmd, eps: [{ n, cmd?, name? }] }).
    var _seasons = U.lru(20);
    function seasons(acc, x) {
        var k = sigOf(acc) + '|' + x.base, kept = _seasons.get(k);
        if (kept) { return kept; }
        var p = ask(acc, '&type=series&do=seasons&id=' + enc(x.num) + (x.vod ? '&via=vod' : '')).then(function (r) { return Array.isArray(r.seasons) ? r.seasons : []; });
        _seasons.set(k, p);
        p.then(null, function () { if (_seasons.get(k) === p) { _seasons.set(k, null); } });
        return p;
    }
    function list(v) { return ('' + (v || '')).split(/\s*,\s*/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12); }
    function details(m, it) {
        if (it.pic) { m.poster = it.pic; }
        if (it.desc) { m.description = it.desc; }
        if (list(it.genres).length) { m.genres = list(it.genres); }
        if (list(it.cast).length) { m.cast = list(it.cast); }
        if (list(it.director).length) { m.director = list(it.director); }
        if (it.rating > 0) { m.imdbRating = (+it.rating).toFixed(1); }
        if (it.mins > 0) { m.runtime = it.mins + ' min'; }
        if (it.year) { m.releaseInfo = '' + it.year; m.year = '' + it.year; }
        return m;
    }
    function meta(type, id) {
        var x = parseId(id);
        if (!x || !x.acc) { return Promise.resolve(null); }
        var it = recall(x.base);
        if (x.kind === 'm') {
            if (!it) { return Promise.resolve(null); }
            remember(x.base, it);
            return Promise.resolve(details({ id: x.base, type: 'movie', name: it.name, _from: x.acc.label }, it));
        }
        return seasons(x.acc, x).then(function (l) {
            if (!it && !l.length) { return null; }
            if (it) { remember(x.base, it); }
            var m = details({ id: x.base, type: 'series', name: it ? it.name : 'Series', _from: x.acc.label }, it || {});
            m.videos = [];
            l.forEach(function (se) {
                (se.eps || []).forEach(function (ep) { m.videos.push({ id: x.base + ':' + se.season + ':' + ep.n, season: se.season, episode: ep.n, title: ep.name || 'Episode ' + ep.n }); });
            });
            return m;
        });
    }

    // ---- Sources ----
    function source(acc, url, name) {
        var st = { url: url, name: 'Stalker', title: ('' + name).trim() + '\n' + acc.label, _stvod: true }, h = U.sanitizeHeaders({ ua: IPTV.stbUa });
        if (h) { st._headers = h; }
        return st;
    }
    function playUrl(acc, cmd, ep) {
        if (typeof YTPlay === 'undefined' || !YTPlay.stalkerPlayUrl) { return Promise.reject(new Error('no service')); }
        return YTPlay.stalkerPlayUrl(acc.url, acc.mac, cmd, ep);
    }
    function filmSource(acc, it) {
        if (!it || !it.cmd) { return Promise.resolve(null); }
        return playUrl(acc, it.cmd, -1).then(function (u) { return source(acc, u, it.name); }, function () { return null; });
    }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function episodeSource(acc, x, season, episode, name) {
        return seasons(acc, x).then(function (l) {
            var se = l.filter(function (s) { return s.season === season; })[0], ep = se && (se.eps || []).filter(function (e) { return e.n === episode; })[0];
            if (!ep || !(ep.cmd || se.cmd)) { return null; }
            return playUrl(acc, ep.cmd || se.cmd, ep.cmd ? -1 : episode).then(function (u) { return source(acc, u, (name || '') + ' S' + two(season) + 'E' + two(episode)); });
        }).then(null, function () { return null; });
    }
    // A title's sources: its own (svm / svs ids), or, for a title from your addons, each portal's
    // copies (m: its details, for its name and year), found by a search of the portal.
    function streams(type, id, m) {
        var x = parseId(id);
        if (x) {
            if (!x.acc) { return Promise.resolve([]); }
            var it = recall(x.base);
            var p = x.kind === 'm' ? filmSource(x.acc, it) : x.season != null ? episodeSource(x.acc, x, x.season, x.episode, it ? it.name : '') : Promise.resolve(null);
            return p.then(function (s) { return s ? [s] : []; });
        }
        return matches(type, id, m);
    }
    // A name to match: no accents, brackets, year at the end, quality words or punctuation.
    var WORDS = /\b(4k|uhd|fhd|hd|sd|hdr|hevc|x265|h265|1080p|720p|2160p|multi|sub|subs|dub|dubbed|latino|castellano)\b/g;
    function keyOf(name) {
        var s = ('' + (name || '')).toLowerCase();
        if (s.normalize) { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
        return s.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' ').replace(WORDS, ' ').trim().replace(/\b(19|20)\d{2}$/, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    }
    function yearOf(v) { var y = parseInt(('' + (v || '')).slice(0, 4), 10); return y > 1880 && y < 2100 ? y : 0; }
    function matches(type, id, m) {
        var parts = ('' + id).split(':'), season = type === 'series' ? parseInt(parts[parts.length - 2], 10) : null, episode = type === 'series' ? parseInt(parts[parts.length - 1], 10) : null;
        if (type === 'series' && !(season >= 0 && episode >= 0)) { return Promise.resolve([]); }
        var name = m && m.name ? '' + m.name : '', year = m ? yearOf(m.year || m.releaseInfo || m.released) : 0, k = keyOf(name);
        if (!k) { return Promise.resolve([]); }
        return Promise.all(accounts().filter(function (acc) { return hasVod(acc, type); }).map(function (acc) {
            return ask(acc, '&type=' + type + '&do=list&q=' + enc(name.slice(0, 120))).then(function (r) {
                var hits = (Array.isArray(r.items) ? r.items : []).filter(function (it) {
                    return it && keyOf(it.name) === k && (type === 'series' || !it.series) && (!year || !it.year || Math.abs(it.year - year) <= (type === 'series' ? 0 : 1));
                }).slice(0, 2);
                return Promise.all(hits.map(function (it) {
                    var card = cardOf(acc, type, it);   // (kept: what plays it)
                    return type === 'movie' ? filmSource(acc, it) : episodeSource(acc, parseId(card.id), season, episode, it.name);
                }));
            }, function () { return []; });
        })).then(function (all) { return [].concat.apply([], all).filter(Boolean); });
    }

    return { accounts: accounts, keepMinutes: keepMinutes, setKeepMinutes: setKeepMinutes, isEnabled: isEnabled, onChange: onChange, reload: reload, synthAddon: synthAddon, catalog: catalog, meta: meta, streams: streams, refreshCats: refreshCats };
})();
