/* Xtream films and series. Global namespace: XtVod
   An Xtream account's (your IPTV playlists') films and series, as a local addon like IPTV's: a
   Movies and a Series catalog per account (its categories as genres; none: the newest; search),
   their pages (get_vod_info / get_series_info) and sources. On titles from your addons (IMDb or
   TMDB ids), the accounts' copies of them as sources, found by StremioK's service, which keeps
   each account's whole list (see service/index.js, xtvControl; YTPlay.xtvodAsk).
   Ids: xvm.<account>.<id> (a film), xvs.<account>.<id> (a series; its episodes
   xvs.<account>.<id>:<season>:<episode>, as other addons' tt…:1:2). */
var XtVod = (function () {
    'use strict';

    var CATS_KEY = 'stremiok.xtvod.cats', CATS_FRESH_MS = 86400000, CATS_RETRY_MS = 6 * 3600000, PAGE = 100, CATS_MAX = 2000;
    function enc(v) { return encodeURIComponent('' + v); }

    // The Xtream accounts among your playlists (switched on): { id, label, base, user, pass }.
    function accounts() {
        if (typeof IPTV === 'undefined' || !IPTV.xtreamParts || !IPTV.xtreamFormat) { return []; }
        return IPTV.getPlaylists().filter(function (p) { return !p.off && IPTV.xtreamFormat(p.id); }).map(function (p) {
            var x = IPTV.xtreamParts(p.url);
            return x && x.user && x.pass ? { id: p.id, label: IPTV.label(p.id), base: x.base, user: x.user, pass: x.pass } : null;
        }).filter(Boolean);
    }
    function account(id) {
        var l = accounts();
        for (var i = 0; i < l.length; i++) { if (l[i].id === id) { return l[i]; } }
        return null;
    }
    // An account whose server lists films or series (of that type: either, without one), or whose
    // categories haven't been asked yet. A server that offers only live channels (its film and
    // series answers empty, or not JSON) adds nothing: no catalogs, no copies, no source.
    function hasVod(acc, type) {
        var c = known(acc);
        if (!c) { return true; }
        return type ? catsOf(acc, type).length > 0 : (catsOf(acc, 'movie').length > 0 || catsOf(acc, 'series').length > 0);
    }
    // What's kept follows the account's server and username: its link edited, the old server's
    // categories and titles aren't shown as its own.
    function sigOf(acc) { return acc.id + '|' + acc.base + '|' + acc.user; }
    function known(acc) { var c = catsAll()[acc.id]; return c && c.sig === sigOf(acc) ? c : null; }
    function isEnabled() { return accounts().some(function (acc) { return hasVod(acc); }); }
    // Whether an Xtream playlist's own film and episode lines (/movie/…, /series/…) stay out of the
    // IPTV tab: yes, unless its server is known to list none (they're its films and series here).
    // onVodChange: told when an account turns out to have some, or none (its IPTV rows made again).
    function noneKnown(id) { var acc = account(id), c = acc ? known(acc) : null; return !!(c && c.none); }
    function hidesVodLines(id) { return !noneKnown(id); }
    var _vodFns = [];
    function onVodChange(fn) { _vodFns.push(fn); }
    function api(acc, action, more) {
        return U.getJSON(acc.base + '/player_api.php?username=' + enc(acc.user) + '&password=' + enc(acc.pass) + '&action=' + action + (more || ''), 20000, 16 * 1048576);
    }

    // ---- Categories: Discover's genres, kept a day (U.store), read again in the background ----
    var _cats = null, _catsAsked = {}, _changeFns = [];
    function onChange(fn) { _changeFns.push(fn); }   // (catalogs added or gone once its categories came)
    // Reload on an account (Settings › Content › IPTV): its categories asked again now, and the
    // service's list of its films and series read again (the next time it's asked: force).
    var _force = {}, _reloaded = {};
    function reload(id) {
        var acc = account(id), all = catsAll();
        if (!acc) { return; }
        delete all[id];
        U.store.set(CATS_KEY, all);
        _catsAsked[sigOf(acc)] = false;
        _catItems.clear(); _info.clear();   // (an answer still on its way isn't kept: it's the cached promise that's dropped)
        _reloaded[id] = true;   // (its rows drawn again once its categories come, whatever they are)
        _force[id + '|movie'] = _force[id + '|series'] = true;
        refreshCats();
        var since = Date.now();
        ['movie', 'series'].forEach(function (type) {   // (the service starts reading at once; its rows drawn again when it's done)
            indexAsk('list', acc, type, '').then(function () { watchIndex(acc, type, since); });
        });
    }
    function catsAll() {
        if (!_cats) { var c = U.store.get(CATS_KEY, {}); _cats = c && typeof c === 'object' && !Array.isArray(c) ? c : {}; }
        return _cats;
    }
    function catsOf(acc, type) { var c = known(acc); return c && Array.isArray(c[type]) ? c[type] : []; }
    function catList(a) {
        return (Array.isArray(a) ? a : []).filter(function (x) { return x && x.category_id != null && x.category_name; }).slice(0, CATS_MAX)
            .map(function (x) { return [('' + x.category_id).slice(0, 20), ('' + x.category_name).replace(/\s+/g, ' ').trim().slice(0, 80)]; });
    }
    function refreshCats() {
        accounts().forEach(function (acc) {
            var c = known(acc), sk = sigOf(acc);
            if ((c && Date.now() - c.at < (c.none ? CATS_RETRY_MS : CATS_FRESH_MS)) || _catsAsked[sk]) { return; }
            _catsAsked[sk] = true;   // (once a launch: an answer that failed isn't asked again until the next)
            function either(p) { return p.then(null, function (e) { return { failed: e }; }); }
            Promise.all([either(api(acc, 'get_vod_categories')), either(api(acc, 'get_series_categories'))]).then(function (r) {
                var all = catsAll(), keep = {}, o = { sig: sk, movie: catList(r[0]), series: catList(r[1]), at: Date.now() }, wasNone = noneKnown(acc.id);
                if (!o.movie.length && !o.series.length) {   // (none: asked again in CATS_RETRY_MS)
                    o.none = true;
                    var why = r[0] && r[0].failed ? U.problem(r[0].failed) : 'its server lists none';
                    U.log('iptv', 'Xtream “' + acc.label + '”: no films or series (' + why + ')');
                }
                accounts().forEach(function (a) { if (all[a.id]) { keep[a.id] = all[a.id]; } });   // (accounts gone: dropped)
                keep[acc.id] = o;
                _cats = keep;
                U.store.set(CATS_KEY, keep);
                var before = _addon ? _addon.manifest.catalogs.length : 0;
                fillCatalogs();
                if (_addon && (_addon.manifest.catalogs.length !== before || _reloaded[acc.id])) { changed(); }   // (its rows: Home reads them now)
                delete _reloaded[acc.id];
                if (!!o.none !== wasNone) { _vodFns.forEach(function (fn) { try { fn(acc.id); } catch (e) {} }); }   // (its film and episode lines: into IPTV, or out)
            });
        });
    }

    // ---- The addon ----
    // Its catalogs: per account, Movies and Series (named after it), the categories as genres.
    // Its sources: on titles from your addons (tt…, tmdb:…); its own titles' are asked directly
    // (Stremio.getStreams).
    var _addon = null;
    function catalogsNow() {
        var out = [];
        accounts().forEach(function (acc) {
            ['movie', 'series'].forEach(function (type) {
                if (!hasVod(acc, type) || !known(acc)) { return; }   // (its categories first: none, no catalog)
                out.push({ type: type, id: 'xv.' + acc.id + '.' + type, name: acc.label,
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
        _addon.manifest.resources = isEnabled() ? RESOURCES : ['catalog'];   // (no account with films or series: not a source either)
    }
    function synthAddon() {
        if (!_addon) {
            _addon = { __local: true, __impl: XtVod, __sources: true, url: 'local:xtvod', base: 'local:xtvod',
                manifest: { id: 'org.stremiok.xtvod', name: 'Xtream', version: '1.0.0', types: ['movie', 'series'], resources: RESOURCES, catalogs: [] } };
        }
        fillCatalogs();
        refreshCats();
        return _addon;
    }

    // ---- Titles: a card's meta, from a category's list or the service's ----
    function itemOf(o, type) {   // a category list's title -> the service's shape
        return { id: type === 'movie' ? o.stream_id : o.series_id, name: o.name, pic: o.stream_icon || o.cover, rating: o.rating, ext: o.container_extension,
            year: parseInt(o.year, 10) || parseInt(('' + (o.releaseDate || o.release_date || '')).slice(0, 4), 10) || 0 };
    }
    function cardOf(acc, type, it) {
        if (!it || !(+it.id > 0) || !it.name) { return null; }
        var id = (type === 'movie' ? 'xvm.' : 'xvs.') + acc.id + '.' + (+it.id);
        var m = { id: id, type: type, name: ('' + it.name).replace(/\s+/g, ' ').trim(), posterShape: 'poster' };
        if (/^https?:\/\//i.test(it.pic || '')) { m.poster = it.pic; }
        var r = parseFloat(it.rating);
        if (r > 0 && r <= 10) { m.imdbRating = r.toFixed(1); }
        if (it.year > 1880) { m.releaseInfo = '' + it.year; }
        return m;
    }
    function cards(acc, type, items) { return items.map(function (it) { return cardOf(acc, type, it); }).filter(Boolean); }

    // The service's answer for this account: /xtvod/list (the newest, or a search) or /xtvod/find.
    // Nothing (no service: a desktop browser; or it failed): { items: [] }.
    function indexAsk(path, acc, type, more) {
        if (typeof YTPlay === 'undefined' || !YTPlay.xtvodAsk) { return Promise.resolve({ items: [] }); }
        if (_force[acc.id + '|' + type]) { delete _force[acc.id + '|' + type]; more = (more || '') + '&force=1'; }
        return YTPlay.xtvodAsk(path, acc, type, more).then(function (r) {
            if (r && r.state === 'failed' && r.error) { U.log('iptv', 'Xtream “' + acc.label + '”: its ' + (type === 'movie' ? 'films' : 'series') + ' couldn’t be read (' + r.error + ')'); }
            if (r && isReading(r)) { watchIndex(acc, type, 0); }
            return r && Array.isArray(r.items) ? r : { items: [] };
        }, function (e) { U.log('iptv', 'Xtream “' + acc.label + '”: StremioK’s service didn’t answer (' + U.problem(e) + ')'); return { items: [] }; });
    }
    // The service's list still being read: looked at again, less and less often, until it's done
    // (since: read after then, for a Reload's), and those told (Home's rows, sources kept).
    var _watching = {}, WATCH_FIRST_MS = 3000, WATCH_MAX_MS = 60000, WATCH_FOR_MS = 20 * 60000;
    function isReading(r) { return r.state === 'queued' || r.state === 'reading' || r.state === 'new'; }
    function changed() { _changeFns.forEach(function (fn) { try { fn(); } catch (e) {} }); }
    function watchIndex(acc, type, since) {
        var k = acc.id + '|' + type, wait = WATCH_FIRST_MS, until = Date.now() + WATCH_FOR_MS;
        if (_watching[k]) { return; }
        _watching[k] = true;
        function again() {
            setTimeout(function () {
                if (!account(acc.id) || Date.now() > until) { delete _watching[k]; return; }
                YTPlay.xtvodAsk('list', acc, type, '').then(function (r) {
                    if (r && (r.state === 'failed' || (r.state === 'ready' && (!since || r.at >= since)))) { delete _watching[k]; changed(); return; }
                    wait = Math.min(wait * 2, WATCH_MAX_MS);
                    again();
                }, function () { wait = Math.min(wait * 2, WATCH_MAX_MS); again(); });
            }, wait);
        }
        again();
    }
    // A category's titles, as the provider lists them (kept: the last few asked).
    var _catItems = U.lru(8);
    function categoryCards(acc, type, catId) {
        var k = sigOf(acc) + '|' + type + '|' + catId, kept = _catItems.get(k);
        if (kept) { return kept; }
        var p = api(acc, type === 'movie' ? 'get_vod_streams' : 'get_series', '&category_id=' + enc(catId)).then(function (a) {
            return cards(acc, type, (Array.isArray(a) ? a : []).map(function (o) { return itemOf(o, type); }));
        });
        _catItems.set(k, p);
        p.then(null, function () { if (_catItems.get(k) === p) { _catItems.set(k, null); } });
        return p;
    }
    function catalog(catId, extra) {
        var m = /^xv\.([^.]+)\.(movie|series)$/.exec(catId || ''), acc = m && account(m[1]);
        if (!acc) { return Promise.resolve([]); }
        var type = m[2], skip = extra && extra.skip ? (parseInt(extra.skip, 10) || 0) : 0;
        if (extra && extra.genre) {
            var cat = catsOf(acc, type).filter(function (c) { return c[1] === extra.genre; })[0];
            return cat ? categoryCards(acc, type, cat[0]).then(function (l) { return l.slice(skip, skip + PAGE); }) : Promise.resolve([]);
        }
        var more = (extra && extra.search ? '&q=' + enc(('' + extra.search).slice(0, 120)) : '') + (skip ? '&skip=' + skip : '');
        return indexAsk('list', acc, type, more).then(function (r) {
            var out = cards(acc, type, r.items);
            if (!(extra && extra.search) && isReading(r)) { out.pending = true; }   // (being read: Home's Loading…, not an empty row)
            return out;
        });
    }

    // ---- A title's page ----
    var _info = U.lru(40);   // account|action|id -> its answer (a promise)
    function info(acc, action, num) {
        var k = sigOf(acc) + '|' + action + '|' + num, kept = _info.get(k);
        if (kept) { return kept; }
        var p = api(acc, action, (action === 'get_vod_info' ? '&vod_id=' : '&series_id=') + enc(num));
        _info.set(k, p);
        p.then(null, function () { if (_info.get(k) === p) { _info.set(k, null); } });
        return p;
    }
    function parseId(id) {
        var m = /^xv([ms])\.([^.]+)\.(\d+)(?::(\d+):(\d+))?$/.exec('' + id);
        return m ? { kind: m[1], acc: account(m[2]), num: m[3], season: m[4] != null ? +m[4] : null, episode: m[5] != null ? +m[5] : null } : null;
    }
    function list(v) { return ('' + (v || '')).split(/\s*,\s*/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12); }
    function link(v) { return /^https?:\/\//i.test('' + (v || '')) ? '' + v : ''; }
    function firstOf(v) { return Array.isArray(v) ? v[0] : v; }
    function yearOf(v) { var y = parseInt(('' + (v || '')).slice(0, 4), 10); return y > 1880 && y < 2100 ? '' + y : ''; }
    function common(m, i) {   // what a film's and a series' info share
        var bg = link(firstOf(i.backdrop_path)), rating = parseFloat(i.rating);
        if (bg) { m.background = bg; }
        if (i.plot || i.description) { m.description = ('' + (i.plot || i.description)).slice(0, 2000); }
        if (list(i.genre).length) { m.genres = list(i.genre); }
        if (list(i.cast || i.actors).length) { m.cast = list(i.cast || i.actors); }
        if (list(i.director).length) { m.director = list(i.director); }
        if (rating > 0 && rating <= 10) { m.imdbRating = rating.toFixed(1); }
        var yt = /^[\w-]{11}$/.test('' + (i.youtube_trailer || '')) ? '' + i.youtube_trailer : '';
        if (yt) { m.trailers = [{ source: yt, type: 'Trailer' }]; }
        return m;
    }
    function meta(type, id) {
        var x = parseId(id);
        if (!x || !x.acc) { return Promise.resolve(null); }
        if (x.kind === 'm') {
            return info(x.acc, 'get_vod_info', x.num).then(function (r) {
                var i = (r && r.info) || {}, d = (r && r.movie_data) || {};
                if (!d.stream_id && !i.name) { return null; }
                var m = common({ id: id, type: 'movie', name: ('' + (i.name || d.name)).trim(), _from: x.acc.label }, i);
                var pic = link(i.cover_big || i.movie_image);
                if (pic) { m.poster = pic; }
                var secs = +i.duration_secs || 0;
                if (secs > 0) { m.runtime = Math.round(secs / 60) + ' min'; }
                var y = yearOf(i.releasedate || i.release_date);
                if (y) { m.releaseInfo = y; m.year = y; }
                return m;
            });
        }
        return info(x.acc, 'get_series_info', x.num).then(function (r) {
            var i = (r && r.info) || {}, showId = 'xvs.' + x.acc.id + '.' + x.num;
            if (!i.name) { return null; }
            var m = common({ id: showId, type: 'series', name: ('' + i.name).trim(), _from: x.acc.label }, i);
            var pic = link(i.cover);
            if (pic) { m.poster = pic; }
            var y = yearOf(i.releaseDate || i.release_date);
            if (y) { m.releaseInfo = y; m.year = y; }
            m.videos = episodes(r).map(function (e) {
                var ei = e.info || {}, v = { id: showId + ':' + e.season + ':' + e.episode, season: e.season, episode: e.episode, title: ('' + (e.title || '')).trim() || 'Episode ' + e.episode };
                if (ei.plot) { v.overview = ('' + ei.plot).slice(0, 1000); }
                if (link(ei.movie_image)) { v.thumbnail = link(ei.movie_image); }
                var rel = Date.parse(ei.releasedate || ei.air_date || '');
                if (rel) { v.released = new Date(rel).toISOString(); }
                return v;
            });
            return m;
        });
    }
    // A series' episodes, however its server lists them ({ "1": [...] } or [[...]]): [{ season,
    // episode, id, ext, title, info }], in order.
    function episodes(r) {
        var out = [], eps = r && r.episodes;
        if (!eps || typeof eps !== 'object') { return out; }
        Object.keys(eps).forEach(function (k) {
            (Array.isArray(eps[k]) ? eps[k] : []).forEach(function (e) {
                var season = parseInt(e && (e.season != null ? e.season : k), 10), ep = parseInt(e && e.episode_num, 10);
                if (!e || !(+e.id > 0) || !(season >= 0) || !(ep >= 0)) { return; }
                out.push({ season: season, episode: ep, id: +e.id, ext: /^[a-z0-9]{2,5}$/i.test(e.container_extension || '') ? ('' + e.container_extension).toLowerCase() : 'mp4', title: e.title, info: e.info });
            });
        });
        out.sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
        return out;
    }

    // ---- Sources ----
    // Its quality, from its name ("… 4K", "FHD") or the file's own (info.video.height).
    function quality(name, video) {
        var h = video && +video.height;
        if (h >= 1600) { return '4K'; }
        if (h >= 900) { return '1080p'; }
        if (h >= 600) { return '720p'; }
        var n = ' ' + ('' + (name || '')).toUpperCase() + ' ';
        if (/[^A-Z0-9](4K|UHD|2160P)[^A-Z0-9]/.test(n)) { return '4K'; }
        if (/[^A-Z0-9](FHD|1080P)[^A-Z0-9]/.test(n)) { return '1080p'; }
        if (/[^A-Z0-9](HD|720P)[^A-Z0-9]/.test(n)) { return '720p'; }
        return '';
    }
    function source(acc, url, name, ext, video) {
        var q = quality(name, video);
        return { url: url, name: 'Xtream' + (q ? '\n' + q : ''), title: ('' + name).trim() + '\n' + acc.label + (ext ? ' · ' + ext.toUpperCase() : ''), _xtvod: true };
    }
    function movieUrl(acc, num, ext) { return acc.base + '/movie/' + enc(acc.user) + '/' + enc(acc.pass) + '/' + num + '.' + ext; }
    function episodeSource(acc, num, season, episode) {
        return info(acc, 'get_series_info', num).then(function (r) {
            var e = episodes(r).filter(function (x) { return x.season === season && x.episode === episode; })[0];
            if (!e) { return null; }
            var name = ((r.info && r.info.name) || '') + ' S' + (season < 10 ? '0' : '') + season + 'E' + (episode < 10 ? '0' : '') + episode;
            return source(acc, acc.base + '/series/' + enc(acc.user) + '/' + enc(acc.pass) + '/' + e.id + '.' + e.ext, name, e.ext, e.info && e.info.video);
        }, function () { return null; });
    }
    function filmSource(acc, num, name, ext) {
        if (ext) { return Promise.resolve(source(acc, movieUrl(acc, num, ext), name, ext)); }
        return info(acc, 'get_vod_info', num).then(function (r) {
            var d = (r && r.movie_data) || {}, i = (r && r.info) || {};
            var e = /^[a-z0-9]{2,5}$/i.test(d.container_extension || '') ? ('' + d.container_extension).toLowerCase() : 'mp4';
            return source(acc, movieUrl(acc, num, e), name || i.name || d.name || '', e, i.video);
        }, function () { return null; });
    }
    // A title's sources: its own (xvm / xvs ids: from its info, which its page has asked for
    // already), or, for a title from your addons, each account's copies (m: its details, for its
    // TMDB id, name and year).
    function streams(type, id, m) {
        var x = parseId(id);
        if (x) {
            if (!x.acc) { return Promise.resolve([]); }
            var p = x.kind === 'm' ? filmSource(x.acc, x.num, '', '') : x.season != null ? episodeSource(x.acc, x.num, x.season, x.episode) : Promise.resolve(null);
            return p.then(function (s) { return s ? [s] : []; });
        }
        return matches(type, id, m);
    }
    function tmdbOf(id, m) {
        var t = /^tmdb:(\d+)/.exec('' + id);
        return t ? t[1] : (m && +(m.moviedb_id || m.tmdb_id || m.tmdbId) > 0 ? '' + +(m.moviedb_id || m.tmdb_id || m.tmdbId) : '');
    }
    function matches(type, id, m) {
        var parts = ('' + id).split(':'), season = type === 'series' ? parseInt(parts[parts.length - 2], 10) : null, episode = type === 'series' ? parseInt(parts[parts.length - 1], 10) : null;
        if (type === 'series' && !(season >= 0 && episode >= 0)) { return Promise.resolve([]); }
        var tmdb = tmdbOf(id, m), name = m && m.name ? '' + m.name : '', year = m ? yearOf(m.year || m.releaseInfo || m.released) : '';
        if (!tmdb && !name) { return Promise.resolve([]); }
        var more = (tmdb ? '&tmdb=' + tmdb : '') + (name ? '&name=' + enc(name.slice(0, 120)) : '') + (year ? '&year=' + year : '');
        return Promise.all(accounts().filter(function (acc) { return known(acc) && hasVod(acc, type); }).map(function (acc) {
            return indexAsk('find', acc, type, more).then(function (r) {
                return Promise.all(r.items.slice(0, 6).map(function (it) {
                    return type === 'movie' ? filmSource(acc, +it.id, it.name, it.ext || '') : episodeSource(acc, +it.id, season, episode);
                }));
            });
        })).then(function (all) { return [].concat.apply([], all).filter(Boolean); });
    }

    return { accounts: accounts, isEnabled: isEnabled, onChange: onChange, reload: reload, hidesVodLines: hidesVodLines, onVodChange: onVodChange, synthAddon: synthAddon, catalog: catalog, meta: meta, streams: streams, refreshCats: refreshCats };
})();
