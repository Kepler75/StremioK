/* Views, part 3 of 6 — title pages: movie sources, series seasons and episodes, Cast & more, person pages, the episode ratings grid, trailers, bulk watched, playback launch, live channels (CH+/CH−), next-episode source matching.
   Parts share one namespace, ViewParts (V): each part publishes the functions the
   others use, and borrows theirs through the small forwarders below (resolved when
   called, so load order only matters for js/views.js, which assembles Views). */
(function (V) {
    'use strict';

    // ----- from the other parts -----
    function buildRow() { return V.buildRow.apply(null, arguments); }   // home
    function buildTopMenu() { return V.buildTopMenu.apply(null, arguments); }   // core
    function confirm() { return V.confirm.apply(null, arguments); }   // core
    function markHomeDirty() { return V.markHomeDirty.apply(null, arguments); }   // home
    function nowPlayingLabel() { return V.nowPlayingLabel.apply(null, arguments); }   // core
    function inNowPlaying() { return V.inNowPlaying.apply(null, arguments); }   // core
    function pickList() { return V.pickList.apply(null, arguments); }   // core
    function posterCard() { return V.posterCard.apply(null, arguments); }   // core
    function posterActions() { return V.posterActions.apply(null, arguments); }   // core
    function scr() { return V.scr.apply(null, arguments); }   // core
    function toggleNowPlaying() { return V.toggleNowPlaying.apply(null, arguments); }   // core
    function trimMeta() { return V.trimMeta.apply(null, arguments); }   // home
    function searchFor() { return V.searchFor.apply(null, arguments); }   // search

    // ================= DETAIL =================
    var _d = null; // { type, id, meta, mode, season }

    // Live TV entry: load sources and play the single one directly, else show the
    // source list (no info page). Reuses the streams flow.
    // Downloads for the page on screen (its details, ratings, cast, episode information, where to
    // watch): stopped when it's left — another page, or another screen (leaveDetail). Sources
    // aren't: they're shared and kept (the next episode's are fetched ahead).
    var _pageCancel = null;
    function newPage() {
        if (_pageCancel) { _pageCancel.cancel(); }
        _pageCancel = U.cancelToken ? U.cancelToken() : null;
        return _pageCancel;
    }
    function pageCancel() { return _pageCancel || newPage(); }
    function leaveDetail() { if (_pageCancel) { _pageCancel.cancel(); _pageCancel = null; } }
    // The page on screen as it is when something starts: still() says whether it still is
    // (not another page, not left). What comes back for a page that's gone — its sources,
    // details, the YouTube service starting — changes nothing: no playback, no BACK, no
    // spinner or note.
    function pageNow() {
        var page = _d, tok = _pageCancel;
        return function still() { return _d === page && !(tok && tok.cancelled); };
    }

    function renderLive(type, id, preview, channels) {
        newPage();
        _d = { type: type, id: id, meta: preview || { id: id, type: type }, mode: 'streams',
            season: null, preview: preview || null, target: null,
            streamId: id, streamLabel: (preview && (preview.name || preview.title)) || '', streams: null,
            exitToBack: true, live: true, channels: channels || null };
        var s = scr('detail');
        U.clear(s);
        s.appendChild(U.el('div', 'detail-hero'));
        s.appendChild(buildTopMenu('detail'));
        U.spinner(true);
        var still = pageNow();
        Stremio.getStreams(type, id).then(function (list) {
            if (!still()) { return; }
            U.spinner(false);
            _d.streams = list;
            var playable = list.filter(Stremio.isPlayable);
            if (!playable.length) {   // (and why: on screen, each addon's reason; in Settings › Diagnostics)
                var why = list.length ? '' : (Stremio.streamNotes ? Stremio.streamNotes(type, id) : []).slice(0, 3).map(function (n) { return n.addon + ' ' + n.title; }).join('; ');
                U.log('sources', 'No playable source for “' + ((_d.meta && _d.meta.name) || id) + '” (' + type + ' ' + id + '): ' +
                    (list.length ? list.length + ' source(s), none playable here' : 'no addon sent any') + (why ? ' (' + why + ')' : ''));
                U.toast('No playable source for this channel' + (why ? ': ' + why : ''), why ? 6000 : 3000); App.back(); return;
            }
            if (playable.length === 1) {
                startPlayback(playable[0], id, _d.streamLabel || _d.meta.name || 'Live');
            } else {
                drawDetail();   // multiple sources → straight to the source list
            }
        }, function () { if (!still()) { return; } U.spinner(false); U.toast('Could not load sources'); App.back(); });
    }

    // opts.resume: a Continue Watching entry to play straight away (see startResume).
    function renderDetail(type, id, preview, target, opts) {
        newPage();
        _d = { type: type, id: id, meta: null, mode: 'info', season: null, preview: preview || null, target: target || null };
        var resume = (opts && opts.resume) || null;
        var s = scr('detail');
        U.clear(s);
        s.appendChild(U.el('div', 'detail-hero'));
        s.appendChild(buildTopMenu('detail'));
        U.spinner(true);
        // A movie goes straight to its sources: ask for them alongside the details
        // instead of after (the request is shared with the source list).
        if (type === 'movie') { Stremio.prefetchStreams(type, id); }
        var still = pageNow();
        Stremio.getMeta(type, id, pageCancel()).then(function (meta) {
            if (!still()) { return; }
            _d.meta = meta;
            U.spinner(false);
            afterMeta();
        }, function (err) {
            if (!still() || (err && err.cancelled)) { return; }   // (left: that's all — not "couldn't load")
            U.spinner(false);
            // Fallback: stream-only addons (e.g. live TV/sports) may expose no meta
            // resource. Use the catalog preview so the title still opens & plays.
            if (_d.preview) {
                _d.meta = Object.assign({ id: id, type: type }, _d.preview);
                afterMeta();
            } else {
                U.toast('Could not load details');
                App.back();
            }
        });

        // On a movie landing page, skip the "Play" button and load sources automatically
        // (series still shows the episode browser; each episode loads its own sources).
        function afterMeta() {
            asEpisodeList();
            var files = embeddedFiles(_d.meta);
            if (_d.type === 'movie') { openStreams(_d.id, _d.meta.name || _d.meta.title); }
            else if (files.length === 1) { openEmbedded(files[0]); }
            else { drawDetail(); }
            if (resume) { startResume(resume); }
            else if (files.length === 1 && (_d.meta.videos || []).length === 1) { playYouTubeNow(files[0]); }
        }
    }

    // A YouTube channel or playlist (YouTubio's: a list of videos, their sources fetched one
    // by one, and a "Channel Options" entry first): shown as a series, the videos its
    // episodes, newest first as YouTube lists them. Requests to the addon keep its own type
    // ("YouTube": _d.addonType); progress, watched marks and next episode work as a series'.
    // A collection (AIOMetadata's "TVDB Collections": a "movie" whose videos are its films,
    // each by its own id): listed in the collection's order, OK on one opening its own page
    // (sources, progress and watched marks as that film's). Not a film with several files.
    var TITLE_ID = /^(tt\d+|tmdb:\d+|tvdb:\d+)$/;
    function asCollection() {
        var meta = _d.meta;
        if (!meta || _d.type !== 'movie' || !Array.isArray(meta.videos)) { return false; }
        var vids = meta.videos.filter(function (v) { return v && v.id && v.id !== meta.id && v.id !== _d.id; });
        if (!vids.length || !vids.every(function (v) { return TITLE_ID.test('' + v.id) && !(v.streams && v.streams.length); })) { return false; }
        meta.videos = vids.map(function (v, i) { return Object.assign({}, v, { season: 1, episode: i + 1 }); });
        _d.collection = true;
        _d.addonType = 'movie';
        _d.type = 'series';
        _d.yearSeasons = false;
        return true;
    }
    function openTitle(v) { App.openDetail('movie', v.id, { id: v.id, type: 'movie', name: v.title || v.name || '', poster: v.thumbnail }); }

    function asEpisodeList() {
        if (asCollection()) { return; }
        var meta = _d.meta, t = _d.type;
        // (opened again as a series, from Continue Watching: still a YouTube list, by its own type)
        var again = !!meta && t === 'series' && /^(ytk|yt_id):/.test('' + (meta.id || _d.id)) && !!meta.type && meta.type !== 'series';
        if (!meta || t === 'movie' || (t === 'series' && !again) || !Array.isArray(meta.videos)) { return; }
        // (not the channel's own entries: "Channel Options", "<channel id>:1:1", and a live one, ":1:2")
        function own(v) { var x = '' + v.id; return [meta.id, _d.id].some(function (c) { return c && (x === c || x.indexOf(c + ':') === 0); }); }
        var vids = meta.videos.filter(function (v) { return v && v.id && !own(v); });
        if (vids.length < 2 || vids.some(function (v) { return v.streams && v.streams.length; })) { return; }
        _d.addonType = again ? meta.type : t;
        _d.type = 'series';
        // Dated videos (StremioK's own YouTube lists: "4 days ago"): a season per year, the
        // newest first, the newest video first in it. No dates (YouTubio's 1970): one list,
        // "Videos", as the channel lists them.
        var DAY = 86400000, dated = vids.every(function (v) { return Date.parse(v.released) > 365 * DAY; });
        if (dated) {
            var byDate = vids.slice().sort(function (a, b) { return Date.parse(b.released) - Date.parse(a.released); });
            var inYear = {};
            meta.videos = byDate.map(function (v) {
                var y = new Date(Date.parse(v.released)).getFullYear();
                inYear[y] = (inYear[y] || 0) + 1;
                return Object.assign({}, v, { season: y, episode: inYear[y] });
            });
        } else {
            meta.videos = vids.map(function (v, i) {
                var o = Object.assign({}, v, { season: 1, episode: i + 1 });
                delete o.released;
                return o;
            });
        }
        _d.yearSeasons = dated;
    }
    // A season's name: a year ("2026"), "Videos" (a YouTube channel's undated list), or "Season 2".
    function seasonName(sn) {
        if (_d && _d.collection) { return 'Titles'; }
        if (_d && _d.addonType) { return _d.yearSeasons ? '' + sn : 'Videos'; }
        return sn >= 1900 && sn <= 2200 ? '' + sn : 'Season ' + sn;
    }
    // An episode as it's named on its own (the Play button, the player, Continue Watching): a
    // YouTube channel's video by its title, an episode by its code ("S2E5").
    function epName(v) {
        return (_d && _d.addonType) ? (v.title || 'Video') : _d.meta.name + '  S' + seasonOf(v) + 'E' + (v.episode || '');
    }
    // Seasons that are years (a YouTube channel): the newest first.
    function yearOrder() { return !!(_d && _d.yearSeasons); }
    function addonType() { return (_d && _d.addonType) || (_d && _d.type); }

    // Continue Watching / Resume: play the exact stream last used for this item, straight
    // away. The title's page (sources, episodes or files) is set up underneath and is
    // where you land when you stop; if a saved debrid link has expired, the player's
    // retries end there too, one press from another source.
    function startResume(p) {
        // (a file on a USB drive: its source again, with its subtitle files, from whichever drive has it now)
        var local = (typeof LocalMedia !== 'undefined' && /^file:\/\//i.test(p.url || '')) ? LocalMedia.streamForUrl(p.url) : null;
        var how = p.fromStart ? { fromStart: true } : null;   // (Play from start: the same source, from 0:00)
        if (local) { resumeSources(startPlayback(local, p.id, p.name, how), p.id); return; }
        var st = { url: p.url, name: p.name, _headers: U.sanitizeHeaders(p.headers) || undefined,
            behaviorHints: (p.fileHints && typeof p.fileHints === 'object') ? p.fileHints : undefined };   // (its file: for subtitles made for it)
        if (/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(p.url || '')) { st._yt = true; st.ytPage = p.url; }   // (a YouTube video: through the service again)
        resumeSources(startPlayback(st, p.id, p.name, how), p.id);
    }
    // Played straight away, before the title's sources were in (an episode's aren't loaded
    // until it's opened): the player's "Select source" filled in once they are.
    function resumeSources(ctx, id) {
        if (!ctx || (ctx.streams && ctx.streams.length)) { return; }
        var page = _d;
        Stremio.getStreams(addonType(), id).then(function (list) {
            if (_d !== page || !ctx.streams || ctx.streams.length) { return; }
            var ranked = rankStreams(Stremio.dedupeStreams(list), page.id).map(function (r) { return r.st; });
            ctx.streams = playableSources(ranked);
        }, function () {});
    }

    function drawDetail() {
        var s = scr('detail');
        U.clear(s);
        var meta = _d.meta;
        // Sources ranked before something they're ranked by changed (a source played, or
        // failed, while you were in the player; Source ranking or Formats changed in
        // Settings; a "not suitable" mark): ranked again, so the list and ▶ Play best follow.
        if (_d.mode === 'streams' && _d.streams && _d.streams.length && U.store.writes && _d.rankVer !== U.store.writes()) {
            _d.streams = sortStreams(_d.streams);
        }

        var listed = _d.mode === 'streams' || (_d.mode === 'info' && _d.type === 'series');   // (a source list, an episode list)
        var hero = U.el('div', 'detail-hero' + (listed ? ' hero-full' : ''));   // (a list: over the whole backdrop)
        var bg = meta.background || meta.poster;
        if (bg) { U.deferBg(hero, U.cardImage(bg, 'hero'), true); }   // (sized for the page, first in the queue)
        hero.appendChild(U.el('div', 'shade'));
        s.appendChild(hero);
        s.appendChild(buildTopMenu('detail'));   // the main menu, above the title

        var body = U.el('div', 'detail-body');
        body.__noScroll = true;   // clipped, never scrolled: the text doesn't shift when focus reaches the buttons
        body.appendChild(titleNode(meta));
        var ep = shownEpisode();   // (an episode's page: its sources, or its Cast & more)
        var bits = [];
        if (ep) {
            var epTitle = ep.title || ep.name || '';
            bits.push(epCode(ep) + (epTitle ? '  “' + epTitle + '”' : ''));
            var aired = airsAt(ep);
            if (aired > 0) { bits.push((aired > Date.now() ? 'Airs ' : 'Aired ') + U.dayLabel(aired)); }
            if (ep.rating && !isNaN(parseFloat(ep.rating))) { bits.push('★ ' + ep.rating); }
        } else {
            if (meta.releaseInfo) { bits.push(meta.releaseInfo); }
            else if (meta.year) { bits.push('' + meta.year); }
            if (meta.runtime) { bits.push(meta.runtime); }
            var own = addonLinks(meta);   // (the addon's links: where the details have none of their own)
            if (meta.imdbRating || own.imdb) { bits.push('★ ' + (meta.imdbRating || own.imdb)); }
            var genres = (meta.genres && meta.genres.length) ? meta.genres : own.genres;
            if (genres.length) { bits.push(genres.slice(0, 3).join(', ')); }
        }
        if (meta._from) { bits.push('Details: ' + meta._from); }   // (which addon: the highest in Settings › Addons that has them)
        body.appendChild(U.el('div', 'detail-meta', bits.join('   ·   ')));
        var ratings = U.el('div', 'detail-ratings');
        body.appendChild(ratings);
        if (!ep) { fillRatings(ratings); }   // (the show's: not the episode's)
        body.appendChild(U.el('div', 'detail-desc', (ep && spoilerFor(ep) === 'all') ? SPOILER_TEXT : (ep && (ep.overview || ep.description)) || meta.description || ''));
        s.appendChild(body);

        // If resuming a series episode, pre-select its season.
        if (_d.type === 'series' && _d.target && _d.season === null) {
            var tv = meta.videos && meta.videos.find(function (v) { return v.id === _d.target; });
            if (tv) {
                _d.season = (tv.season === undefined ? 1 : tv.season);
            } else {
                // fallback: parse "<id>:<season>:<episode>"
                var pp = ('' + _d.target).split(':');
                if (pp.length >= 2) { var sn = parseInt(pp[1], 10); if (!isNaN(sn)) { _d.season = sn; } }
            }
        }

        _d._epFocus = null;
        if (_d.mode === 'more') {
            body.className += ' more-body';
            s.appendChild(morePanel());
        } else if (_d.mode === 'ratings') {
            body.className += ' more-body ratings-body';
            s.appendChild(ratingsPanel());
        } else if (_d.mode === 'streams') {
            // no season row here: the compact text block of a series page, and the sources
            // take the space from where a series has its seasons
            body.className += ' series-body streams-body';
            body.appendChild(streamActionsBar());
            s.appendChild(streamsPanel());
        } else if (_d.type === 'series' && meta.videos && meta.videos.length) {
            body.className += ' series-body';   // shorter text block: room for the episode rows
            if (!_d.addonType) { syncSeriesTick(meta); }
            var up = nextUp(meta);
            if (_d.season === null) { _d.season = seasonOf(up.v); }   // open on that episode's season
            body.appendChild(seriesActions(up));
            s.appendChild(seriesPanel());
        } else if (embeddedFiles(meta).length > 1) {
            body.className += ' series-body';
            s.appendChild(filesPanel());
        } else {
            body.appendChild(movieActions());
        }
        fitPanel(s, body);
        Focus.setScope(s, _d._epFocus || firstBelowMenu(s));
        restoreFocusKey(s);
        _d.target = null; // consume: don't re-jump after the user navigates
        _d._focusSeason = null;
    }

    // The list (seasons and episodes, sources, a download's files) starts just under the text
    // block above it, however tall that is (a logo or a name, a ratings line or not, a
    // synopsis of up to 4 lines, the TV's taller font), so no gap is left between the
    // buttons and the list. The ratings line keeps its place from the start, so nothing in
    // the block changes height afterwards. (Not measurable while hidden: the CSS default.)
    var PANEL_GAP = 14, PANEL_MIN = 300, PANEL_MAX = 512;
    function fitPanel(s, body) {
        var panel = s.querySelector('.list-panel');
        if (!panel || (' ' + body.className + ' ').indexOf(' series-body ') === -1) { return; }
        var sr = s.getBoundingClientRect(), br = body.getBoundingClientRect();
        if (!(br.height > 0)) { return; }
        var top = Math.round(br.bottom - sr.top) + PANEL_GAP;
        panel.style.top = Math.max(PANEL_MIN, Math.min(PANEL_MAX, top)) + 'px';
    }

    // The page's first item, not the top menu's (UP reaches that).
    function inMenu(n) {
        for (var p = n; p && p.nodeType === 1; p = p.parentNode) { if ((p.className || '').indexOf('header') !== -1) { return true; } }
        return false;
    }
    function firstBelowMenu(s) {
        var all = s.querySelectorAll('.focusable');
        for (var i = 0; i < all.length; i++) { if (!inMenu(all[i])) { return all[i]; } }
        return undefined;
    }

    // The title as its logo (Cinemeta and others provide one), else as text.
    function titleNode(meta) {
        var name = meta.name || meta.title || '';
        var t = U.el('div', 'detail-title');
        var logo = U.cardImage(meta.logo, 'logo');   // (null unless it's a usable http(s) link)
        if (!logo) { t.textContent = name; return t; }
        t.className += ' has-logo';
        var img = U.el('img', 'detail-logo');
        // no logo after all: the name, in the logo's space (what's under it stays put)
        img.onerror = function () { t.className = 'detail-title has-logo logo-failed'; U.clear(t); t.textContent = name; };
        U.deferImage(img, logo, true);
        img.setAttribute('alt', name);
        t.appendChild(img);
        return t;
    }

    // Ratings from MDBList (IMDb, Rotten Tomatoes, Metacritic, Letterboxd...), when its key is set.
    // Its line is kept from the start (empty until they arrive), so the description under
    // it doesn't jump down when they do.
    function fillRatings(el) {
        var page = _d;
        if (!/^tt\d+$/.test(page.id || '') || (page.type !== 'movie' && page.type !== 'series')) { return; }
        if (!Stremio.getIntegrations().mdblist) { return; }
        el.className += ' reserve';
        Stremio.mdblistRatings(page.type, page.id, pageCancel()).then(function (list) {
            if (_d !== page || !list || !list.length || !document.documentElement.contains(el)) { return; }
            el.textContent = list.map(function (r) { return r.label + ' ' + r.text; }).join('   ·   ');
        }, function () {});
    }

    // ----- "Cast & more": cast & more, the collection a film belongs to, more like this -----
    // (TMDB's, with a key; the people the addon names where TMDB has none, or with no key)
    function withTmdb() { return Stremio.hasTmdb() && /^tt\d+$/.test(_d.id || ''); }
    function morePill() {
        if (!withTmdb() && !hasAddonPeople(_d.meta)) { return null; }
        var p = U.el('div', 'pill focusable more-pill', 'ⓘ  Cast & more');
        p.__onselect = function () { _d.moreFrom = _d.mode; _d.mode = 'more'; drawDetail(); };
        if (_d._focusPill === 'more') { _d._epFocus = p; _d._focusPill = null; }
        return p;
    }
    function ratingsPill() {
        var integ = Stremio.getIntegrations();
        if (!(integ.omdb || integ.tmdb) || !/^tt\d+$/.test(_d.id || '')) { return null; }
        var p = U.el('div', 'pill focusable ratings-pill', '★  Episode ratings');
        p.__onselect = function () { _d.moreFrom = _d.mode; _d.mode = 'ratings'; drawDetail(); };
        if (_d._focusPill === 'ratings') { _d._epFocus = p; _d._focusPill = null; }
        return p;
    }

    function morePanel() {
        var panel = U.el('div', 'list-panel more-panel');
        var rows = U.el('div', 'more-rows');
        rows.appendChild(U.el('div', 'row-empty', 'Loading…'));
        panel.appendChild(rows);
        var page = _d;
        var ep = shownEpisode();
        // the addon's people: where TMDB has none (or there's no TMDB key); true if there were any
        function theirs() { return appendAddonPeople(rows, page.meta); }
        if (!withTmdb()) { U.clear(rows); theirs(); focusLoaded(rows); return panel; }
        if (ep) {   // an episode's: its own people (the show's when TMDB has nothing for it)
            Stremio.tmdbEpisodeCast(page.id, seasonOf(ep), ep.episode).then(function (people) {
                if (_d !== page || _d.mode !== 'more') { return; }
                U.clear(rows);
                if (!people || !people.length) {
                    if (!theirs()) { rows.appendChild(U.el('div', 'row-empty', 'TMDB has nothing more for this episode.')); }
                    focusLoaded(rows);
                    return;
                }
                rows.appendChild(buildRow('Cast & more', people.map(personCard)));
                focusLoaded(rows);
            }, function () {
                if (_d !== page) { return; }
                U.clear(rows);
                if (!theirs()) { rows.appendChild(U.el('div', 'row-empty', 'Couldn\'t reach TMDB.')); }
                focusLoaded(rows);
            });
            return panel;
        }
        Stremio.tmdbTitleExtras(page.type, page.id, pageCancel()).then(function (x) {
            if (_d !== page || _d.mode !== 'more') { return; }
            U.clear(rows);
            if (x && x.cast.length) { rows.appendChild(buildRow('Cast & more', x.cast.map(personCard))); }
            var own = !(x && x.cast.length) && theirs();   // (no people from TMDB: the addon's)
            if (x && x.collection) { rows.appendChild(buildRow(x.collection.name, x.collection.parts.map(tmdbCard))); }
            if (x && x.similar.length) { rows.appendChild(buildRow('More like this', x.similar.map(tmdbCard))); }
            if (!rows.firstChild && !own) { rows.appendChild(U.el('div', 'row-empty', 'TMDB has nothing more for this title.')); }
            focusLoaded(rows);
        }, function (err) {
            if (_d !== page || (err && err.cancelled)) { return; }
            U.clear(rows);
            if (!theirs()) { rows.appendChild(U.el('div', 'row-empty', 'Couldn\'t reach TMDB.')); }
            focusLoaded(rows);
        });
        return panel;
    }
    // The addon's own people, genres and IMDb rating for a title (its links — cast, directors,
    // writers, genres, imdb — or the older cast / director / writer lists): shown where TMDB
    // gives none (no key, or nothing for the title).
    function addonLinks(meta) {
        var out = { cast: [], directors: [], writers: [], genres: [], imdb: '' };
        if (!meta || typeof meta !== 'object') { return out; }
        function add(list, n, max) { n = ('' + n).replace(/\s+/g, ' ').trim().slice(0, 80); if (n && list.length < max && list.indexOf(n) === -1) { list.push(n); } }
        (Array.isArray(meta.links) ? meta.links : []).forEach(function (l) {
            if (!l || typeof l.name !== 'string') { return; }
            var c = ('' + (l.category || '')).toLowerCase();
            if (c === 'cast') { add(out.cast, l.name, 30); }
            else if (c === 'directors' || c === 'director') { add(out.directors, l.name, 10); }
            else if (c === 'writers' || c === 'writer') { add(out.writers, l.name, 10); }
            else if (c === 'genres' || c === 'genre') { add(out.genres, l.name, 5); }
            else if (c === 'imdb' && /^\d{1,2}(\.\d)?$/.test(l.name.trim())) { out.imdb = l.name.trim(); }
        });
        [['cast', 'cast', 30], ['director', 'directors', 10], ['writer', 'writers', 10]].forEach(function (f) {
            if (out[f[1]].length || !Array.isArray(meta[f[0]])) { return; }
            meta[f[0]].forEach(function (n) { if (typeof n === 'string') { add(out[f[1]], n, f[2]); } });
        });
        return out;
    }
    function hasAddonPeople(meta) { var o = addonLinks(meta); return !!(o.cast.length || o.directors.length || o.writers.length); }
    // Rows of them, by name (no photos): OK searches for the name. Whether there were any.
    function appendAddonPeople(rows, meta) {
        var o = addonLinks(meta), any = false;
        [['Cast', o.cast, ''], ['Directors', o.directors, 'Director'], ['Writers', o.writers, 'Writer']].forEach(function (g) {
            if (!g[1].length) { return; }
            any = true;
            rows.appendChild(buildRow(g[0] + '   ·   from ' + ((meta && meta._from) || 'the addon'), g[1].map(function (n) { return namedPersonCard(n, g[2]); })));
        });
        return any;
    }
    function namedPersonCard(name, role) {
        var c = U.el('div', 'card person-card focusable');
        c.setAttribute('data-id', 'name:' + name);
        c.appendChild(U.el('div', 'fallback', name));
        var cap = U.el('div', 'cap');
        cap.appendChild(U.el('div', 'cap-name', name));
        if (role) { cap.appendChild(U.el('div', 'cap-sub', role)); }
        c.appendChild(cap);
        c.__onselect = function () { App.openSearch(); searchFor(name); };
        return c;
    }
    // Rows that arrive after the page is drawn: focus their first card (or, coming back to
    // this page, the card you left from).
    function focusLoaded(container) {
        var s = scr('detail');
        if (restoreFocusKey(s)) { return; }
        var cur = Focus.current();
        if (cur && s.contains(cur) && !inMenu(cur)) { return; }   // already somewhere on the page
        var first = container.querySelector('.focusable');
        if (first) { Focus.setFocus(first); }
    }

    function personCard(p) {
        var c = U.el('div', 'card person-card focusable');
        c.setAttribute('data-id', 'person:' + p.id);
        var photo = U.cardImage(p.photo, 'cast');   // (null unless a usable http(s) link)
        if (photo) {
            var img = U.el('img', 'poster');
            img.onerror = function () { img.style.display = 'none'; };
            c.appendChild(img);
            U.deferImage(img, photo);
        } else {
            c.appendChild(U.el('div', 'fallback', p.name));
        }
        var cap = U.el('div', 'cap');
        cap.appendChild(U.el('div', 'cap-name', p.name));
        if (p.character) { cap.appendChild(U.el('div', 'cap-sub', p.character)); }
        c.appendChild(cap);
        c.__onselect = function () { App.openPerson(p.id, p.name); };
        return c;
    }

    // A person found by name (Discover › People, Search): their department under the name,
    // and what they're known for in the info strip.
    function peopleCard(p) {
        var c = personCard({ id: p.id, name: p.name, photo: p.photo, character: p.dept });
        c.__meta = { id: 'person:' + p.id, name: p.name, releaseInfo: p.dept,
            description: p.knownFor && p.knownFor.length ? 'Known for: ' + p.knownFor.join(', ') : '' };
        return c;
    }

    // A TMDB title (collection, recommendations, filmography): opened through its IMDb id,
    // which is what the addons know it by.
    function tmdbCard(item) {
        var c = posterCard({ id: 'tmdb:' + item.kind + ':' + item.tmdbId, type: item.type,
            name: item.name + (item.year ? '  (' + item.year + ')' : ''), poster: item.poster, background: item.background }, item.type);
        c.__onselect = function () { openTmdbTitle(item); };
        // hold OK: the menu any poster has (Details, Continue Watching, watched), on the title
        // by its IMDb id (what the addons, Continue Watching and watched marks know it by)
        c.__onlongpress = function () {
            withImdb(item, function (imdb) { posterActions({ id: imdb, type: item.type, name: item.name, poster: item.poster, background: item.background }, item.type, c); });
        };
        return c;
    }
    function openTmdbTitle(item) {
        withImdb(item, function (imdb) { App.openDetail(item.type, imdb, { name: item.name, poster: item.poster, type: item.type }); });
    }
    function withImdb(item, then) {
        U.spinner(true);
        Stremio.tmdbImdbId(item.kind, item.tmdbId, pageCancel()).then(function (imdb) {
            U.spinner(false);
            if (!imdb) { U.toast('“' + item.name + '” has no IMDb id, so the addons can\'t open it.', 3500); return; }
            then(imdb);
        }, function () { U.spinner(false); U.toast('Couldn\'t reach TMDB.'); });
    }

    // ----- a person's page (from the cast row) -----
    function renderPerson(personId, name) {
        newPage();
        _d = { mode: 'person', type: 'person', id: 'person:' + personId, personId: personId, meta: { name: name || '' }, person: null };
        drawPerson();
        var page = _d;
        U.spinner(true);
        Stremio.tmdbPerson(personId, pageCancel()).then(function (p) {
            U.spinner(false);
            if (_d !== page) { return; }
            _d.person = p;
            drawPerson();
        }, function () {
            U.spinner(false);
            if (_d === page) { U.toast('Couldn\'t load this person from TMDB.'); }
        });
    }
    function drawPerson() {
        var s = scr('detail');
        U.clear(s);
        var p = _d.person;
        s.appendChild(U.el('div', 'detail-hero'));
        s.appendChild(buildTopMenu('detail'));
        if (p && p.photo) {
            var ph = U.el('div', 'person-photo');
            U.deferBg(ph, U.cardImage(p.photo, 'profile'), true);
            s.appendChild(ph);
        }
        var body = U.el('div', 'detail-body more-body person-body');
        body.__noScroll = true;
        body.appendChild(U.el('div', 'detail-title', (p && p.name) || _d.meta.name));
        body.appendChild(U.el('div', 'detail-meta', (p && p.meta) || ''));
        body.appendChild(U.el('div', 'detail-desc', (p && p.bio) || ''));
        s.appendChild(body);
        var panel = U.el('div', 'list-panel more-panel');
        var rows = U.el('div', 'more-rows');
        panel.appendChild(rows);
        s.appendChild(panel);
        if (p) {
            if (p.movies.length) { rows.appendChild(buildRow('Movies', p.movies.map(tmdbCard))); }
            if (p.series.length) { rows.appendChild(buildRow('Series', p.series.map(tmdbCard))); }
            if (!p.movies.length && !p.series.length) { rows.appendChild(U.el('div', 'row-empty', 'No titles listed on TMDB.')); }
        }
        Focus.setScope(s, rows.querySelector('.focusable') || undefined);
        restoreFocusKey(s);
    }

    // ----- episode ratings grid: seasons across, episodes down -----
    function ratingsPanel() {
        var meta = _d.meta, page = _d;
        var ss = seasons(meta).filter(function (x) { return x > 0; });
        if (!ss.length) { ss = seasons(meta); }
        var bySeason = {}, maxEp = 0;
        ss.forEach(function (sn) {
            bySeason[sn] = {};
            seasonEpisodes(meta, sn).forEach(function (v) {
                var e = v.episode || 0;
                if (e > 0) { bySeason[sn][e] = v; if (e > maxEp) { maxEp = e; } }
            });
        });
        var panel = U.el('div', 'list-panel grid-panel');
        var scroll = U.el('div', 'grid-scroll');
        var table = U.el('div', 'grid-table');
        var head = U.el('div', 'grid-row grid-head');
        head.appendChild(U.el('div', 'grid-cell grid-label', ''));
        ss.forEach(function (sn) { head.appendChild(U.el('div', 'grid-cell grid-label', 'S' + sn)); });
        table.appendChild(head);
        var cells = {};   // "s:e" -> cell
        var startCell = null;
        for (var e = 1; e <= maxEp; e++) {
            var row = U.el('div', 'grid-row');
            row.appendChild(U.el('div', 'grid-cell grid-label', 'E' + e));
            ss.forEach(function (sn) {
                var v = bySeason[sn][e];
                if (!v) { row.appendChild(U.el('div', 'grid-cell grid-none', '')); return; }
                var c = U.el('div', 'grid-cell focusable r-na', '·');
                c.setAttribute('data-id', v.id);
                c.__onselect = function () {   // to that episode in the list
                    _d.mode = 'info'; _d.season = sn; _d.target = v.id;
                    drawDetail();
                };
                cells[sn + ':' + e] = c;
                if (!startCell) { startCell = c; }
                row.appendChild(c);
            });
            table.appendChild(row);
        }
        scroll.appendChild(table);
        panel.appendChild(scroll);
        panel.appendChild(U.el('div', 'grid-legend', 'IMDb ratings where OMDb has them, else TMDB.   OK on an episode opens it.'));
        _d._epFocus = (_d.season != null && cells[_d.season + ':1']) || startCell;
        U.settleAll(ss.map(function (sn) {
            return function () {
                return seasonRatings(page.id, sn).then(function (map) {
                    if (_d !== page || !map) { return; }
                    Object.keys(map).forEach(function (ep) {
                        var c = cells[sn + ':' + ep], r = parseFloat(map[ep]);
                        if (!c || !(r > 0)) { return; }
                        c.textContent = (Math.round(r * 10) / 10).toFixed(1);
                        c.className = 'grid-cell focusable ' + (r >= 9 ? 'r-9' : r >= 8 ? 'r-8' : r >= 7 ? 'r-7' : r >= 6 ? 'r-6' : 'r-5') +
                            (c.className.indexOf('focused') !== -1 ? ' focused' : '');
                    });
                });
            };
        }), 3);
        return panel;
    }
    // { episode: rating } for one season: IMDb via OMDb when its key is set, else TMDB.
    function seasonRatings(seriesId, sn) {
        var integ = Stremio.getIntegrations();
        function fromTmdb() {
            if (!integ.tmdb) { return Promise.resolve(null); }
            var cancel = pageCancel();
            return Stremio.tmdbFindTvId(seriesId, cancel).then(function (tv) { return tv ? Stremio.tmdbSeasonEpisodes(tv, sn, cancel) : null; })
                .then(function (m) {
                    if (!m) { return null; }
                    var out = {};
                    Object.keys(m).forEach(function (ep) { if (m[ep] && m[ep].rating) { out[ep] = m[ep].rating; } });
                    return out;
                });
        }
        if (!integ.omdb) { return fromTmdb(); }
        return Stremio.omdbSeasonRatings(seriesId, sn, pageCancel()).then(function (m) {
            return (m && Object.keys(m).length) ? m : fromTmdb();
        });
    }

    // ----- title -> title navigation (cast, collections, filmographies) -----
    // Opening another title or a person from a title's page replaces the page; App keeps
    // this snapshot with the history entry so Back redraws it, focused where you left.
    function focusKey(n) {
        if (!n) { return null; }
        var id = n.getAttribute && n.getAttribute('data-id');
        return id ? 'id:' + id : 'text:' + n.textContent;
    }
    function detailSnapshot() { return { d: _d, key: focusKey(Focus.current()) }; }
    // A page further back than the last few (a long chain of title, cast and person pages) is
    // kept as what to open, not as it was: its details (a long series' episode list can be
    // over a megabyte) aren't held for it. BACK to it opens it again (from the session's
    // caches when they still have it), on the item you left it from.
    function lightSnapshot(snap) {
        var d = snap && snap.d;
        if (!d || d.live) { return snap; }
        if (d.mode === 'person') { return { light: true, person: d.personId, name: (d.meta && d.meta.name) || '', key: snap.key }; }
        var m = d.meta || {};
        return { light: true, type: d.addonType || d.type, id: d.id, target: d.target || null, key: snap.key,
            preview: d.preview || { id: d.id, type: d.addonType || d.type, name: m.name || '', poster: m.poster } };
    }
    function restoreDetail(snap) {
        if (snap.light) {
            if (snap.person) { renderPerson(snap.person, snap.name); } else { renderDetail(snap.type, snap.id, snap.preview, snap.target); }
            if (_d) { _d._restoreKey = snap.key; }
            return;
        }
        newPage();
        _d = snap.d;
        _d._restoreKey = snap.key;
        if (_d.mode === 'person') { drawPerson(); } else { drawDetail(); }
    }
    function restoreFocusKey(s) {
        var key = _d && _d._restoreKey;
        if (!key) { return false; }
        var all = s.querySelectorAll('.focusable');
        for (var i = 0; i < all.length; i++) {
            if (focusKey(all[i]) === key) { _d._restoreKey = null; Focus.setFocus(all[i]); return true; }
        }
        return false;
    }

    // ----- files with embedded streams -----
    // Some items aren't looked up by id: their meta lists the files themselves, each
    // with a ready stream (Torrentio's RealDebrid downloads: a single file, a season
    // pack, or the "Downloads" folder). Series metas are left to the episode browser.
    function embeddedFiles(meta) {
        if (!meta || meta.type === 'series' || _d.type === 'series') { return []; }
        return (meta.videos || []).filter(function (v) { return v && v.streams && v.streams.length; });
    }
    function fileLabel(v) {
        var t = '' + (v.title || v.name || v.id || 'File');
        return t.split('/').pop();
    }
    function fileStreams(v) {
        return v.streams.map(function (st) {
            var s = Object.assign({ name: fileLabel(v) }, st);
            return Stremio.youTubeSource ? Stremio.youTubeSource(s) : s;
        });
    }

    // A single YouTube video (YouTubio's: one video, its source the YouTube id, "Stremio
    // Player"): nothing to choose, so it plays straight away; stopping goes back where you
    // opened it from (the Discover grid, a Home row). Its source list stays underneath, and
    // is where you land if it doesn't play (to try the YouTube app instead, for one).
    function playYouTubeNow(v) {
        var yt = (_d.streams || []).filter(function (st) { return st._yt; })[0];
        if (!yt) { return; }
        _d.direct = true;
        startPlayback(yt, v.id, fileLabel(v));
    }

    // One file: straight to its source(s), like a movie's.
    function openEmbedded(v) {
        _d.mode = 'streams';
        _d.embedded = true;
        _d.streamId = v.id;
        _d.streamLabel = fileLabel(v);
        _d.streams = sortStreams(fileStreams(v));
        drawDetail();
    }

    // Several files: list them; each plays its own stream.
    function filesPanel() {
        var panel = U.el('div', 'list-panel files-panel');
        var listScroll = U.el('div', 'list-scroll');
        embeddedFiles(_d.meta).forEach(function (v) {
            var node = U.el('div', 'stream focusable');
            node.appendChild(document.createTextNode(fileLabel(v)));
            var path = ('' + (v.title || '')).split('/');
            if (path.length > 1) { node.appendChild(U.el('span', 's-sub', path.slice(0, -1).join(' / '))); }
            node.__onselect = function () {
                _d.streams = fileStreams(v);   // the player's "Select source" lists this file's streams
                startPlayback(_d.streams[0], v.id, fileLabel(v));
            };
            if (_d.target && v.id === _d.target) { _d._epFocus = node; }
            listScroll.appendChild(node);
        });
        panel.appendChild(listScroll);
        return panel;
    }

    // ----- series: Resume / Play -----
    function seasonOf(v) { return v.season === undefined ? 1 : v.season; }
    function epCode(v) {
        if (_d && _d.addonType) { var t = '' + (v.title || 'Video'); return '“' + (t.length > 40 ? t.slice(0, 39) + '…' : t) + '”'; }   // (a YouTube channel's video)
        return 'S' + seasonOf(v) + 'E' + (v.episode || '?');
    }

    // The episode Resume/Play starts: the most recently played unfinished one, else the
    // first unwatched one after the most recently watched, else the first unwatched,
    // else the first episode. Specials (season 0) only count when there's nothing else.
    function nextUp(meta) {
        var eps = orderedEpisodes(meta);
        var regular = eps.filter(function (v) { return v.season !== 0; });
        if (!regular.length) { regular = eps; }
        var best = null, kind = _d.collection ? 'movie' : 'series';
        regular.forEach(function (v) {
            var p = Player.progressFor(kind, v.id);
            if (p && p.position > 0 && (!best || p.updated > best.p.updated)) { best = { v: v, p: p }; }
        });
        if (best) { return { v: best.v, resume: best.p }; }
        var last = -1, lastAt = 0, i;
        regular.forEach(function (v, n) { var at = Player.watchedAt(kind, v.id); if (at > lastAt) { lastAt = at; last = n; } });
        for (i = last + 1; i < regular.length; i++) { if (!episodeWatched(regular[i])) { return { v: regular[i] }; } }
        for (i = 0; i < regular.length; i++) { if (!episodeWatched(regular[i])) { return { v: regular[i] }; } }
        return { v: regular[0] };
    }

    // When an episode airs (ms), or NaN when its date isn't known.
    function airsAt(v) { return Date.parse(v.released || v.firstAired || ''); }
    // The episode a series page is showing on its own (its sources, or its Cast & more), or
    // null: a page of the series itself, a YouTube channel's video, a collection's film.
    function shownEpisode() {
        if (!_d || _d.type !== 'series' || _d.addonType || _d.collection || !_d.meta || !_d.streamId) { return null; }
        if (!(_d.mode === 'streams' || (_d.mode === 'more' && _d.moreFrom === 'streams'))) { return null; }
        return (_d.meta.videos || []).find(function (v) { return v.id === _d.streamId; }) || null;
    }
    function seriesActions(up) {
        var row = U.el('div', 'btn-row series-actions');
        // The episode it would start hasn't aired yet (a show that hasn't started, or you've
        // watched all that's out): no Play, just when it airs.
        var airs = airsAt(up.v);
        if (_d.collection) {   // (the next film you haven't watched: its page)
            var open = U.el('div', 'pill focusable', '▶  Open  “' + (up.v.title || up.v.name || '') + '”');
            open.__onselect = function () { openTitle(up.v); };
            row.appendChild(open);
            var tpc = trailerPill();
            if (tpc) { row.appendChild(tpc); }
            return row;
        }
        if (!up.resume && !episodeWatched(up.v) && airs > Date.now()) {
            row.appendChild(U.el('div', 'pill airs-pill', epCode(up.v) + ' airs ' + U.dayLabel(airs)));
        } else {
            row.appendChild(playUpButton(up));
        }
        var np = U.el('div', 'pill focusable', nowPlayingLabel('series', _d.meta.id || _d.id));
        np.__onselect = function () { toggleNowPlaying('series', _d.meta); _d._focusNp = true; drawDetail(); };
        if (_d._focusNp) { _d._epFocus = np; _d._focusNp = false; }
        row.appendChild(np);
        var tp = trailerPill();
        if (tp) { row.appendChild(tp); }
        var mp = morePill();
        if (mp) { row.appendChild(mp); }
        var rp = ratingsPill();
        if (rp) { row.appendChild(rp); }
        return row;
    }
    function playUpButton(up) {
        var btn = U.el('div', 'pill focusable', up.resume
            ? '▶  Resume  ' + epCode(up.v) + '  ·  ' + U.fmtTime(up.resume.position)
            : '▶  Play  ' + epCode(up.v));
        btn.__onselect = function () {
            // resume the exact stream when one was saved; otherwise pick a source
            if (up.resume && up.resume.url) { startResume(up.resume); }
            else { openStreams(up.v.id, epName(up.v), false, AUTO); }
        };
        // hold OK: where you were, or the episode from the start (its saved source; with none
        // saved, its page, where everything then plays from the start)
        if (up.resume && up.resume.position > 0) {
            btn.__onlongpress = function () {
                var code = epCode(up.v);
                pickList((_d.meta.name || '') + '  ' + code, [['resume', 'Resume at ' + U.fmtTime(up.resume.position)], ['start', 'Play ' + code + ' from the start']], null, function (k) {
                    if (k === 'resume') { btn.__onselect(); return; }
                    if (up.resume.url) { startResume(Object.assign({}, up.resume, { fromStart: true })); }
                    else { openStreams(up.v.id, epName(up.v), false, { fromStart: true }); }
                });
            };
        }
        return btn;
    }
    // Your place in a movie or episode ({ position, … }), or null: what "from the start" is about.
    function savedPlace(videoId) {
        var p = videoId ? Player.progressFor((_d.collection || _d.type === 'movie') ? 'movie' : 'series', videoId) : null;
        return (p && p.position > 0) ? p : null;
    }
    // A page opened to play from the start (Play SxEx from the start, no source saved): how
    // everything played from it plays.
    function howHere() { return (_d && _d.fromStart) ? { fromStart: true } : null; }

    // ----- trailers -----
    // Addons (Cinemeta among them) list YouTube trailers; they play through the bundled
    // YouTube service like YouTube live channels, but as a normal video. Nothing about a
    // trailer is saved (progress, watched, Continue Watching).
    // A title's YouTube trailers, best first: [{ id, name }]. Official trailers, then trailers
    // (and unnamed ones), then teasers, then ticket ads, TV spots, clips…; the addon's order
    // within each. A name that's just the title's (Cinemeta's) isn't one: "Trailer 2".
    var TRAILER_LAST = /ticket|spots?|clip|featurette|behind the scenes|interview|reaction|review|promo|sneak peek/i;
    // + TMDB's (with a key: _d.tmdbTrailers, asked for once a page, see trailerPill), each video
    // once: they name the addon's unnamed ones, and give language, date and whether official. One
    // in your language (the audio's, the subtitles') comes first.
    function trailersOf(meta) {
        var out = [], seen = {}, title = ('' + ((meta && (meta.name || meta.title)) || '')).trim();
        function add(id, name, info) {
            if (!id) { return; }
            var nm = ('' + (name || '')).trim();
            if (nm === title) { nm = ''; }
            var t = seen[id];
            if (!t) { t = seen[id] = { id: id, name: nm, at: out.length }; out.push(t); }
            else if (!t.name) { t.name = nm; }
            info = info || {};
            ['lang', 'date', 'official', 'tmdbType'].forEach(function (k) { if (t[k] === undefined && info[k] !== undefined && info[k] !== '') { t[k] = info[k]; } });
        }
        ((meta && meta.trailerStreams) || []).forEach(function (t) { if (t) { add(t.ytId, t.title); } });
        ((meta && meta.trailers) || []).forEach(function (t) {
            if (t && t.source && (!t.type || /trailer|teaser/i.test(t.type))) { add(t.source, t.name, { lang: /^[a-z]{2}$/.test(t.lang || '') ? t.lang : undefined }); }
        });
        ((_d && _d.meta === meta && _d.tmdbTrailers) || []).forEach(function (t) { add(t.id, t.name, { lang: t.lang, date: t.date, official: t.official }); });
        var mine = out.some(function (t) { return t.lang; }) ? prefLangs() : [];   // (your settings read only when there's a language to go by)
        function rank(t) {
            var r;
            if (!t.name) { r = 1; }
            else if (TRAILER_LAST.test(t.name)) { r = 3; }
            else if (/official/i.test(t.name) && /tr[aá]iler/i.test(t.name)) { r = 0; }
            else { r = /teaser/i.test(t.name) ? 2 : 1; }
            return (t.lang && mine.indexOf(t.lang) !== -1 && r < 3 ? 0 : 10) + r;   // (yours first, ticket ads still last)
        }
        out.sort(function (a, b) { return (rank(a) - rank(b)) || (a.at - b.at); });
        out.forEach(function (t, i) { if (!t.name) { t.name = out.length > 1 ? 'Trailer ' + (i + 1) : 'Trailer'; } });
        return out;
    }
    // Your languages, two-letter (TMDB's): the audio's, the subtitles' (and their second choice).
    function prefLangs() {
        var out = [], a = Player.getAudioCfg ? Player.getAudioCfg() : {}, s = Player.getSubCfg ? Player.getSubCfg() : {};
        [a.lang, s.lang, s.lang2].forEach(function (k) {
            var l = (k && Player.lang2) ? Player.lang2(k) : '';
            if (l && out.indexOf(l) === -1) { out.push(l); }
        });
        return out;
    }
    // A trailer as listed: its title, then its language, month and "unofficial", where known.
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function trailerLabel(t) {
        var bits = [t.name];
        if (t.lang && Player.langName) { bits.push(Player.langName(t.lang)); }
        var m = /^(\d{4})-(\d{2})/.exec(t.date || '');
        if (m) { bits.push(MONTHS[+m[2] - 1] + ' ' + m[1]); }
        if (t.official === false) { bits.push('unofficial'); }
        return bits.join('  ·  ');
    }
    // Plays the first of the list YouTube gives out to StremioK's service (it refuses some studio
    // uploads to its player, though they play on YouTube's site); next: on to the following one
    // when it refuses (false: just that one, picked by hand).
    function playTrailers(list, next) {
        var meta = _d.meta, title = (meta && (meta.name || meta.title)) || '', passed = [], still = pageNow();
        U.spinner(true, 'Opening trailer…');
        YTPlay.ensureService().then(function () {
            function tryAt(i) {
                if (!still()) { U.spinner(false); return; }
                if (i >= list.length) {
                    U.spinner(false);
                    U.toast(list.length === 1 ? '“' + list[0].name + '” isn’t available from YouTube to StremioK' : 'YouTube won’t give out any of this title’s ' + list.length + ' trailers to StremioK', 6000);
                    return;
                }
                var t = list[i], page = 'https://www.youtube.com/watch?v=' + t.id;
                (YTPlay.canPlay ? YTPlay.canPlay(page) : Promise.resolve(true)).then(function (ok) {
                    if (!ok) {
                        U.log('youtube', 'Trailer “' + t.name + '” (' + t.id + ') of “' + title + '”: YouTube didn’t give it out' + (next && i + 1 < list.length ? '; trying the next one' : ''));
                        if (!next) { U.spinner(false); U.toast('“' + t.name + '” isn’t available from YouTube to StremioK', 6000); return; }
                        passed.push(t);
                        tryAt(i + 1);
                        return;
                    }
                    if (passed.length) { U.toast('“' + passed[0].name + '” isn’t available from YouTube: playing “' + t.name + '”', 6000); }
                    playTrailer(t.id);
                });
            }
            tryAt(0);
        }, function () {
            U.spinner(false);
            if (still()) { U.toast(YTPlay.unavailableMessage('trailer'), 6000); }
        });
    }
    function trailerPill() {
        // TMDB's trailers for the title (a key, an IMDb id): asked for once a page; when they come,
        // the page is drawn again with them
        var meta = _d.meta, page = _d, imdb = (meta && (meta.imdb_id || meta._imdbId)) || (/^tt\d+$/.test(_d.id || '') ? _d.id : '');
        if (_d.tmdbTrailers === undefined && !_d.collection && !_d.addonType && /^tt\d+$/.test(imdb || '') && Stremio.tmdbTitleTrailers && Stremio.hasTmdb && Stremio.hasTmdb()) {
            _d.tmdbTrailers = null;
            Stremio.tmdbTitleTrailers(_d.type, imdb, prefLangs(), pageCancel()).then(function (list) {
                if (_d !== page) { return; }
                var before = trailersOf(meta).length;
                page.tmdbTrailers = list || [];
                if ((trailersOf(meta).length !== before || list.length) && !Player.isActive()) {
                    var f = Focus.current();
                    if (f && ('' + f.className).indexOf('trailer-pill') !== -1) { page._focusTrailer = true; }   // (its count changes: still on it)
                    redrawKeepingFocus();
                }
            }, function () { if (_d === page) { page.tmdbTrailers = []; } });
        }
        var list = trailersOf(_d.meta);
        if (!list.length || typeof YTPlay === 'undefined') { return null; }
        var p = U.el('div', 'pill focusable trailer-pill', '▶  Trailer' + (list.length > 1 ? '  (' + list.length + ')' : ''));
        p.__onselect = function () { playTrailers(list, true); };
        if (list.length > 1) {   // hold OK: the list, to pick one
            p.__onlongpress = function () {
                pickList('Trailers', list.map(function (t, i) { return ['' + i, trailerLabel(t)]; }), '', function (k) { playTrailers([list[+k]], false); });
            };
        }
        if (_d._focusTrailer) { _d._epFocus = p; _d._focusTrailer = false; }
        return p;
    }
    // The audio language picked for a YouTube video ('' = the original; see YTPlay.audioLang).
    function ytLangFor(page) { return (typeof YTPlay !== 'undefined' && YTPlay.audioLang) ? YTPlay.audioLang(page) : ''; }

    // An episode's trailer (TMDB: its own, else its season's), asked for once per episode in
    // the session: known, its button is drawn with the page; not yet, it joins the row (before
    // Cast & more) when TMDB answers, if the page is still that episode's.
    var _epTrailers = U.lru(200);   // episode id -> { ytId, season } | null
    function episodeTrailerPill(row, ep) {
        if (!Stremio.hasTmdb() || !Stremio.tmdbEpisodeTrailer || !/^tt\d+$/.test(_d.id || '') || typeof YTPlay === 'undefined') { return null; }
        var known = _epTrailers.get(ep.id);
        if (known !== undefined) { return known ? epTrailerButton(ep, known) : null; }
        var page = _d, tok = pageCancel();
        Stremio.tmdbEpisodeTrailer(_d.id, seasonOf(ep), ep.episode, tok).then(function (t) {
            if (tok.cancelled) { return; }   // (the page left: asked again next time)
            _epTrailers.set(ep.id, t || null);
            if (!t || _d !== page || shownEpisode() !== ep) { return; }
            var bar = scr('detail').querySelector('.streams-actions');
            if (!bar || bar.querySelector('.trailer-pill')) { return; }
            bar.insertBefore(epTrailerButton(ep, t), bar.querySelector('.more-pill'));
        });
        return null;
    }
    function epTrailerButton(ep, t) {
        var season = seasonName(seasonOf(ep));
        var p = U.el('div', 'pill focusable trailer-pill', t.season ? '▶  ' + season + ' trailer' : '▶  Trailer');
        p.__onselect = function () { playTrailer(t.ytId, (_d.meta.name || _d.meta.title || '') + '  ' + (t.season ? season : epCode(ep))); };
        if (_d._focusTrailer) { _d._epFocus = p; _d._focusTrailer = false; }
        return p;
    }

    // label: what the trailer is of (an episode's or a season's), else the title's name
    function playTrailer(ytId, label) {
        var page = 'https://www.youtube.com/watch?v=' + ytId;
        var meta = _d.meta, still = pageNow();
        U.spinner(true, 'Opening trailer…');
        YTPlay.ensureService().then(function () {
            U.spinner(false);
            if (!still()) { return; }
            Player.play({
                url: YTPlay.resolverUrl(page, 1080, false, ytLangFor(page)), variantUrl: YTPlay.resolverUrl(page), initialQualityHeight: 1080,
                ytLang: ytLangFor(page), type: _d.type, id: 'trailer:' + ytId, name: (label || meta.name || meta.title || '') + '  ·  Trailer',
                poster: meta.poster, streams: [], yt: page, trailer: true
            }, function () { _d._focusTrailer = true; drawDetail(); });   // back on the page, on the Trailer button
        }, function () {
            U.spinner(false);
            if (still()) { U.toast(YTPlay.unavailableMessage('trailer'), 6000); }
        });
    }

    function movieActions() {
        var row = U.el('div', 'btn-row');
        var play = U.el('div', 'pill focusable', '▶  Play');
        play.__onselect = function () { openStreams(_d.id, _d.meta.name, false, AUTO); };
        row.appendChild(play);
        return row;
    }

    // ----- series episodes -----
    function seasons(meta) {
        var set = {};
        meta.videos.forEach(function (v) { var s = (v.season === undefined ? 1 : v.season); set[s] = true; });
        var arr = Object.keys(set).map(function (k) { return parseInt(k, 10); });
        arr.sort(function (a, b) { return yearOrder() ? b - a : a - b; });
        return arr;
    }

    // Hide spoilers (Settings › Appearance): for an episode not watched yet, 'pictures' (its still
    // blurred) or 'all' (its synopsis left out too); '' to show it.
    var SPOILER_TEXT = 'Synopsis hidden: not watched yet';
    function spoilerFor(v) {
        var mode = Stremio.getPrefs().spoilers;
        if (mode === 'off' || !v || _d.collection || episodeWatched(v)) { return ''; }
        return mode;
    }
    function episodeWatched(video) {
        var kind = (_d && _d.collection) ? 'movie' : 'series';   // (a collection's films: their own marks)
        return Player.isWatched(kind, video.id);   // (marks here and Trakt's history, weighed by time: player-store)
    }

    function seasonEpisodes(meta, season) {
        return meta.videos.filter(function (v) {
            return (v.season === undefined ? 1 : v.season) === season;
        });
    }

    // ----- watched state in bulk (hold OK on a season or an episode) -----
    // Finished episodes leave Continue Watching. If that was the show's card there, the next
    // episode takes its place (as after the credits) rather than the show dropping out;
    // none when the show is done, or its next episode isn't out yet.
    function markEpisodes(ids, on, message) {
        Player.setWatchedMany('series', ids, on);
        if (on) {
            var set = {}, meta = _d.meta, had = inNowPlaying('series', _d.id);
            ids.forEach(function (id) { set[id] = 1; });
            Player.continueList().forEach(function (e) { if (e.type === 'series' && set[e.id]) { Player.removeProgress('series', e.id); } });
            if (had && !inNowPlaying('series', _d.id)) {
                var v = nextUp(meta).v, out = airsAt(v);
                if (!episodeWatched(v) && !(out > Date.now())) {
                    Player.addToContinue({ id: v.id, type: 'series', name: epName(v), poster: meta.poster, background: meta.background, parent: _d.id });
                }
            }
        }
        markHomeDirty();
        U.toast(message);
    }
    function idsOf(videos) { return videos.map(function (v) { return v.id; }); }
    function seriesWatched(meta) { return meta.videos.length > 0 && meta.videos.every(episodeWatched); }

    function seasonMenu(meta, sn, allSeasons) {
        var on = !seasonWatched(meta, sn);
        var opts = [['season', (on ? 'Mark Season ' + sn + ' watched' : 'Mark Season ' + sn + ' unwatched')]];
        // "up to here": the regular seasons before this one too (not specials, Season 0)
        var earlier = allSeasons.filter(function (x) { return x > 0 && x < sn; });
        if (sn > 0 && earlier.length) { opts.push(['upto', 'Mark Seasons ' + earlier[0] + '–' + sn + ' watched']); }
        var allOn = !seriesWatched(meta);
        opts.push(['all', allOn ? 'Mark whole series watched' : 'Mark whole series unwatched']);
        var showId = (meta.id || _d.id || '').split(':')[0];
        if (typeof Trakt !== 'undefined' && Trakt.isConnected() && Trakt.rate && /^tt\d+$/.test(showId)) {   // (on Trakt: by the show's IMDb id)
            var mine = Trakt.myRating('season', showId + ':' + sn);
            opts.push(['rate', mine ? 'Season ' + sn + ': your rating ' + mine + ' · change' : 'Rate Season ' + sn + ' on Trakt']);
        }
        pickList(seasonName(sn), opts, null, function (what) {
            if (what === 'rate') { V.rateOnTrakt('season', showId + ':' + sn, (meta.name || '') + '  ' + seasonName(sn)); return; }
            if (what === 'season') {
                markEpisodes(idsOf(seasonEpisodes(meta, sn)), on, seasonName(sn) + (on ? ' marked watched' : ' marked unwatched'));
            } else if (what === 'upto') {
                markEpisodes(idsOf(meta.videos.filter(function (v) {
                    var x = (v.season === undefined ? 1 : v.season);
                    return x > 0 && x <= sn;
                })), true, 'Seasons ' + earlier[0] + '–' + sn + ' marked watched');
            } else {
                markEpisodes(idsOf(meta.videos), allOn, allOn ? 'Whole series marked watched' : 'Whole series marked unwatched');
            }
            _d.season = sn;
            _d._focusSeason = sn;
            drawDetail();
        });
    }

    function episodeMenu(meta, v) {
        var on = !episodeWatched(v);
        var code = epCode(v);
        var opts = [['details', 'Details'], ['one', on ? 'Mark ' + code + ' watched' : 'Mark ' + code + ' unwatched']];
        // every episode before this one (same order as Next), specials only within Season 0
        var ord = orderedEpisodes(meta), at = ord.indexOf(v), before = [];
        var sv = (v.season === undefined ? 1 : v.season);
        for (var i = 0; i < at; i++) {
            var x = (ord[i].season === undefined ? 1 : ord[i].season);
            if (x > 0 || sv === 0) { before.push(ord[i]); }
        }
        if (before.length) { opts.push(['upto', 'Mark watched up to ' + code]); }
        // it and every episode after it (the same order; specials only within Season 0), when one is watched
        var after = [v];
        for (var j = at + 1; j < ord.length; j++) {
            var y = (ord[j].season === undefined ? 1 : ord[j].season);
            if (y > 0 || sv === 0) { after.push(ord[j]); }
        }
        if (after.length > 1 && after.some(episodeWatched)) { opts.push(['fromhere', 'Mark unwatched from ' + code + ' on']); }
        pickList(meta.name + '  ' + code, opts, null, function (what) {
            if (what === 'details') { openStreams(v.id, epName(v)); return; }   // (its page: as OK on it)
            if (what === 'one') { markEpisodes([v.id], on, on ? 'Marked watched' : 'Marked unwatched'); }
            else if (what === 'fromhere') { markEpisodes(idsOf(after), false, 'Marked unwatched from ' + code + ' on'); }
            else { markEpisodes(idsOf(before.concat([v])), true, 'Marked watched up to ' + code); }
            _d.target = v.id;
            drawDetail();
        });
    }

    // A collection's film (hold OK): watched or not (as the film's own mark, Trakt too when
    // connected), every film up to it in the collection's order, or its page.
    function collectionMenu(meta, v) {
        var on = !episodeWatched(v), name = v.title || v.name || '';
        var before = orderedEpisodes(meta).slice(0, orderedEpisodes(meta).indexOf(v));
        var opts = [['one', on ? 'Mark watched' : 'Mark unwatched']];
        if (before.length) { opts.push(['upto', 'Mark watched up to “' + name + '” (' + (before.length + 1) + ' films)']); }
        opts.push(['open', 'Open its page']);
        pickList(name, opts, null, function (what) {
            if (what === 'open') { openTitle(v); return; }
            var films = what === 'one' ? [v] : before.concat([v]), mark = what === 'one' ? on : true;
            Player.setWatchedMany('movie', idsOf(films), mark);
            if (mark) { films.forEach(function (f) { Player.removeProgress('movie', f.id); }); }   // (off Continue Watching: watched)
            U.toast(what === 'one' ? (mark ? 'Marked watched' : 'Marked unwatched') : 'Marked watched up to “' + name + '”');
            _d.target = v.id;
            drawDetail();
        });
    }

    // A series' card shows ✓ when every episode out so far is watched (specials aside): kept
    // up to date whenever its page is drawn (episodes marked, a new one out since).
    function syncSeriesTick(meta) {
        var id = meta.id || _d.id, now = Date.now();
        var aired = (meta.videos || []).filter(function (v) { var at = airsAt(v); return seasonOf(v) !== 0 && !(at > now); });
        var all = aired.length > 0 && aired.every(episodeWatched);
        if (all !== Player.isWatched('series', id)) { Player.setWatched('series', id, all); markHomeDirty(); }
    }

    function seasonWatched(meta, season) {
        var eps = seasonEpisodes(meta, season);
        return eps.length > 0 && eps.every(episodeWatched);
    }

    // { season: allWatched } for every season, in one pass over the episodes
    // (the season bar used to re-filter meta.videos once per season).
    function seasonWatchedMap(meta) {
        var total = {}, done = {}, out = {};
        meta.videos.forEach(function (v) {
            var s = (v.season === undefined ? 1 : v.season);
            total[s] = (total[s] || 0) + 1;
            if (episodeWatched(v)) { done[s] = (done[s] || 0) + 1; }
        });
        for (var k in total) {
            if (Object.prototype.hasOwnProperty.call(total, k)) { out[k] = done[k] === total[k]; }
        }
        return out;
    }

    function seriesPanel() {
        var meta = _d.meta;
        var ss = seasons(meta);
        if (_d.season === null) { _d.season = ss.indexOf(1) !== -1 ? 1 : ss[0]; }

        // The season bar sits in a fixed strip; only .list-scroll scrolls, so the
        // selected season stays visible while browsing its episodes.
        var panel = U.el('div', 'list-panel series-panel');
        var bar = U.el('div', 'season-bar');
        // UP from the episodes lands on the season being shown, not the nearest button.
        bar.__onEnter = function () { return bar.querySelector('.season-sel'); };
        var watchedBySeason = seasonWatchedMap(meta);
        ss.forEach(function (sn) {
            var allWatched = !!watchedBySeason[sn];
            var p = U.el('div', 'pill focusable' + (sn === _d.season ? ' season-sel' : ''),
                (allWatched ? '✓ ' : '') + seasonName(sn));
            p.__onselect = function () { _d.season = sn; _d._focusSeason = sn; drawDetail(); };
            p.__onlongpress = function () { seasonMenu(meta, sn, ss); };
            // keep focus on the season pill the user just picked
            if (_d._focusSeason === sn) { _d._epFocus = p; }
            bar.appendChild(p);
        });
        panel.appendChild(bar);

        var listScroll = U.el('div', 'list-scroll');
        var eps = seasonEpisodes(meta, _d.season);
        eps.sort(function (a, b) { return (a.episode || 0) - (b.episode || 0); });
        var epRefs = [];
        var now = Date.now();
        eps.forEach(function (v) {
            var watched = episodeWatched(v);
            // not out yet: when it airs, where the rating goes once it's out
            var airs = airsAt(v);
            var unaired = !watched && airs > now;
            var e = U.el('div', 'ep ep-row focusable' + (watched ? ' watched' : '') + (unaired ? ' unaired' : ''));
            e.setAttribute('data-ep', v.id);   // (a redraw keeps focus on it: redrawKeepingFocus)

            var hide = spoilerFor(v);   // (Hide spoilers: an episode not watched yet)
            var thumb = U.el('div', 'ep-thumb' + (hide ? ' spoiler' : ''));
            // through the poster queue: a season's thumbnails don't all download at once
            if (v.thumbnail) { U.deferBg(thumb, U.cardImage(v.thumbnail, 'still')); }
            var pr = !watched && Player.progressFor(_d.collection ? 'movie' : 'series', v.id);
            if (pr && pr.duration && pr.position > 0) {   // partly watched: progress stripe
                var stripe = U.el('div', 'ep-prog');
                stripe.style.width = Math.min(100, pr.position / pr.duration * 100) + '%';
                thumb.appendChild(stripe);
            }
            e.appendChild(thumb);

            var body = U.el('div', 'ep-body');
            var line = U.el('div', 'ep-line');
            var yr = _d.collection && v.released ? ('' + v.released).slice(0, 4) : '';
            var title = U.el('span', 'ep-title', (watched ? '✓ ' : '') + (_d.collection ? (v.title || v.name || '') + (yr ? '  (' + yr + ')' : '') : 'E' + (v.episode || '?') + '  ' + (v.title || v.name || '')));
            var rating = U.el('span', 'ep-rating', '');
            line.appendChild(title);
            if (unaired) { var when = U.dayLabel(airs); line.appendChild(U.el('span', 'ep-airs', 'Airs ' + when)); }
            line.appendChild(rating);
            body.appendChild(line);
            var ov = U.el('span', 'ep-ov', hide === 'all' ? SPOILER_TEXT : v.overview || '');
            body.appendChild(ov);
            e.appendChild(body);

            e.__onselect = function () {
                if (_d.collection) { openTitle(v); return; }
                openStreams(v.id, epName(v), false, AUTO);
            };
            e.__onlongpress = function () { if (_d.collection) { collectionMenu(meta, v); } else { episodeMenu(meta, v); } };
            if (_d.target && v.id === _d.target) { _d._epFocus = e; }
            listScroll.appendChild(e);
            epRefs.push({ num: v.episode, thumb: thumb, rating: rating, ov: ov, hasThumb: !!v.thumbnail, hideOv: hide === 'all' });
        });
        panel.appendChild(listScroll);

        // Enrich episodes (one request per season each). Rating source priority:
        // OMDb (real IMDb) when its key is set, else TMDB vote_average. Images come from TMDB.
        var integ = Stremio.getIntegrations();
        var seasonAtFetch = _d.season;

        if (integ.omdb) {
            Stremio.omdbSeasonRatings(_d.id, seasonAtFetch, pageCancel()).then(function (map) {
                if (!map || _d.season !== seasonAtFetch) { return; }
                epRefs.forEach(function (r) {
                    var rt = map[r.num];
                    if (rt) { r.rating.textContent = '★ ' + rt + ' IMDb'; }
                });
            });
        }
        if (integ.tmdb) {
            var epCancel = pageCancel();
            Stremio.tmdbFindTvId(_d.id, epCancel).then(function (tvId) {
                if (!tvId || _d.season !== seasonAtFetch) { return; }
                return Stremio.tmdbSeasonEpisodes(tvId, seasonAtFetch, epCancel).then(function (map) {
                    if (!map || _d.season !== seasonAtFetch) { return; }
                    epRefs.forEach(function (r) {
                        var ep = map[r.num];
                        if (!ep) { return; }
                        if (ep.still && !r.hasThumb) { r.hasThumb = true; U.deferBg(r.thumb, U.cardImage(ep.still, 'still')); }
                        // Fill the rating only if OMDb didn't provide one for this episode
                        // (OMDb's dataset is missing IMDb ratings for some episodes).
                        if (ep.rating && !r.rating.textContent) { r.rating.textContent = '★ ' + (Math.round(ep.rating * 10) / 10) + ' TMDb'; }
                        if (ep.overview && !r.ov.textContent && !r.hideOv) { r.ov.textContent = ep.overview; }
                    });
                });
            });
        }
        return panel;
    }

    // ----- streams -----
    // "Where to watch" / subscription links (Paramount+, Netflix, rent/buy, etc.) are
    // pushed to the bottom, below directly-playable sources. Recognized by where the link
    // goes, or by the addon's label: never by the file name or description, which name
    // the film ("Mad.Max…", "Showtime…") or its bitrate ("max 80 GB").
    var SERVICE_HOSTS = /(^|\.)(netflix\.com|disneyplus\.com|max\.com|hbomax\.com|hulu\.com|primevideo\.com|amazon\.[a-z.]+|tv\.apple\.com|paramountplus\.com|peacocktv\.com|starz\.com|sho\.com|showtime\.com|crunchyroll\.com|mubi\.com)$/i;
    var SERVICE_LABEL = /\b(subscription|subscribe|rent|buy|purchase|netflix|disney\s*(\+|plus)|hbo|hbo max|hulu|peacock|prime video|apple tv\+?|paramount\+?|starz|showtime)\b/i;
    function isSubscriptionStream(stream) {
        if (!Stremio.isPlayable(stream)) { return true; }   // external "where to watch" always sinks to the bottom
        var host = (stream.url.match(/^https?:\/\/([^\/:?#]+)/i) || [])[1] || '';
        if (SERVICE_HOSTS.test(host)) { return true; }
        // the label's first line is the addon's tag ("Netflix · Subscription"), not the file
        return SERVICE_LABEL.test(('' + (stream.name || '')).split('\n')[0]);
    }
    // A "where to watch" link (TMDB's, or an addon's) -> the app on this TV that opens it:
    // { app: { id, name }, data: the app's own id for the title, from the link's tizenUrl
    // (WatchHub gives one), to open it on the title } or null. Matched by the app the link
    // names, else by the service's name against your streaming apps (see
    // TVApps.appForService, which never lets an addon pick an unrelated or hidden app:
    // the app is one of yours, or one for the link's own service, so the title's id is
    // for it even where its ID on this TV differs from the one in the link).
    var TIZEN_DATA_MAX = 2000;
    function whereApp(st) {
        if (typeof TVApps === 'undefined' || !TVApps.available() || !st || !st.externalUrl || Stremio.isPlayable(st)) { return null; }
        var tz = null;
        try { tz = (typeof st.tizenUrl === 'string' && st.tizenUrl.length < 4000) ? JSON.parse(st.tizenUrl) : null; } catch (e) { tz = null; }
        var tzId = (tz && typeof tz.id === 'string' && tz.id.length <= 200) ? tz.id : '';
        var app = TVApps.appForService(st.name, tzId);
        if (!app) { return null; }
        var data = (tz && (typeof tz.action_data === 'string' || typeof tz.action_data === 'number')) ? '' + tz.action_data : '';
        return { app: app, data: data.length <= TIZEN_DATA_MAX ? data : '' };
    }
    // Opens the app for a "where to watch" source; one that isn't among your streaming apps
    // (matched by the service's name) asks first, once, naming the exact app.
    function openWhere(opens) {
        function go() {
            U.toast('Opening ' + opens.app.name + '…', 2000);
            TVApps.openTitle(opens.app, opens.data).then(null, function (e) {
                U.toast('Couldn\'t open ' + opens.app.name + ': ' + e.message, 4000);
            });
        }
        if (!TVApps.isApproved || TVApps.isApproved(opens.app.id)) { go(); return; }
        confirm('Open “' + opens.app.name + '” (' + opens.app.id + ') from “where to watch” sources? It isn’t one of your streaming apps; ' +
            'StremioK will remember your answer for this app (Settings › Content › Streaming apps lists yours).', 'Open', function () {
            TVApps.approve(opens.app.id); go();
        });
    }
    // TMDB's services for the title, minus the ones already listed (an addon's) under
    // another spelling of the same service.
    function extraWhere(list, extra) {
        if (!extra || !extra.length) { return list; }
        var key = function (n) { return (typeof TVApps !== 'undefined') ? TVApps.serviceKey(n) : ('' + n).toLowerCase(); };
        var have = {};
        list.forEach(function (st) { if (!Stremio.isPlayable(st) && st.name) { have[key(st.name)] = true; } });
        return list.concat(extra.filter(function (st) { var k = key(st.name); if (have[k]) { return false; } have[k] = true; return true; }));
    }

    // ----- ranking: Play best and the quality groups -----
    // 1. sources played before for this title, newest first (for a series: like the ones
    //    used for its recent episodes), unless switched off;
    // 2. then the criteria in Settings > Source ranking, in your order (by default:
    //    resolution 4K > 1440p > 1080p > 720p > SD > unknown, not cached yet last, release
    //    type remux > Blu-ray > web > unknown > TV rip, HDR first, Feed sources order, each
    //    addon's own order), then the list's order. With resolution first, the list is grouped by resolution
    //    (4K, 1080p, …); otherwise it's one ranked list ("Sources");
    // 3. at the bottom, sources you marked "not suitable" for this title (hold OK on one),
    //    then ones with a format marked "not working" on this TV (Settings > Formats), then
    //    links that don't play here.
    var TIERS = ['2160', '1440', '1080', '720', 'sd', 'other'];
    var GROUPS = ['local', 'played'].concat(TIERS, ['ranked', 'unsuitable', 'worded', 'sized', 'bad', 'where']);
    var GROUP_TITLES = { local: 'On your USB drive', played: 'Played before', '2160': '4K', '1440': '1440p', '1080': '1080p', '720': '720p',
        sd: 'SD', other: 'Other', ranked: 'Sources', unsuitable: 'Marked not suitable', worded: 'Hidden by your words', sized: 'Outside your size limits', bad: 'Not working or not allowed on this TV', where: 'Where to watch  ·  other apps' };
    var KIND_SCORE = { remux: 4, bluray: 3, web: 2, hdtv: 1, '': 1.5, cam: -5 };
    function tierOf(info) {
        return info.res >= 2160 ? '2160' : info.res >= 1440 ? '1440' : info.res >= 1080 ? '1080' : info.res >= 720 ? '720' : info.res > 0 ? 'sd' : 'other';
    }
    // How two sources compare on one criterion (Settings > Source ranking), <0: a first.
    var RANK_CMP = {
        res: function (a, b) { return TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier); },
        uncached: function (a, b) { return (a.info.cache === -1 ? 1 : 0) - (b.info.cache === -1 ? 1 : 0); },
        kind: function (a, b) { return (KIND_SCORE[b.info.kind] || 0) - (KIND_SCORE[a.info.kind] || 0); },
        hdr: function (a, b) { return (b.info.hdr ? 1 : 0) - (a.info.hdr ? 1 : 0); },
        addon: function (a, b) { return (a.st._addonRank || 0) - (b.st._addonRank || 0); },
        // each source's place in its addon's own list (an addon's first ties with another's
        // first): a plain key, so it orders consistently wherever it sits among the criteria
        within: function (a, b) { return (a.st._addonPos || 0) - (b.st._addonPos || 0); },
        cached: function (a, b) { return b.info.cache - a.info.cache; }
    };
    function rankStreams(list, titleId) {
        var cfg = Stremio.getRanking ? Stremio.getRanking() : { played: true, criteria: [] };
        var on = cfg.criteria.filter(function (c) { return c.on && RANK_CMP[c.key]; });
        var cmps = on.length || cfg.criteria.length ? on.map(function (c) { return RANK_CMP[c.key]; }) : [RANK_CMP.res];
        var byRes = cmps[0] === RANK_CMP.res;   // resolution first: grouped by it
        var hist = cfg.played ? playedList(titleId) : [];
        var marked = unsuitableList(titleId);
        var rows = list.map(function (st, i) {
            var info = Stremio.streamInfo(st);
            var usable = Stremio.isPlayable(st) && !isSubscriptionStream(st);
            var unsuitable = usable && marked.length > 0 && marked.indexOf(fileIdentity(st)) !== -1;
            var worded = (usable && !unsuitable && Stremio.hideWordHit) ? Stremio.hideWordHit(st) : '';   // (one of your words: Settings › Source ranking)
            var sized = (usable && !unsuitable && !worded && !st._localFile) ? sizeHit(st, info) : '';   // (outside your size limits: Settings › Source ranking)
            var bad = usable ? Stremio.badFormats(st, info) : [];
            var blocked = usable ? Stremio.blockedRes(st, info) : '';   // a resolution you don't allow
            var pr = (usable && !unsuitable && !worded && !sized && !bad.length && !blocked) ? playedIndex(hist, st, info) : -1;
            var group = !usable ? 'where' : unsuitable ? 'unsuitable' : worded ? 'worded' : sized ? 'sized' : (bad.length || blocked) ? 'bad' : st._localFile ? 'local' : pr >= 0 ? 'played' : byRes ? tierOf(info) : 'ranked';
            var app = group === 'where' ? whereApp(st) : null;   // links that open an app here come first
            return { st: st, i: i, info: info, bad: bad, blocked: blocked, pr: pr, group: group, tier: tierOf(info), app: app, unsuitable: unsuitable, worded: worded, sized: sized };
        });
        rows.sort(function (a, b) {
            var ga = GROUPS.indexOf(a.group), gb = GROUPS.indexOf(b.group);
            if (ga !== gb) { return ga - gb; }
            if (a.group === 'played' && a.pr !== b.pr) { return a.pr - b.pr; }
            if (a.group === 'where' && !a.app !== !b.app) { return a.app ? -1 : 1; }
            // your criteria, in your order; then the addons' own order
            for (var c = 0; c < cmps.length; c++) { var d = cmps[c](a, b); if (d) { return d; } }
            return a.i - b.i;
        });
        return rows;
    }
    // Your size limits (Settings › Source ranking) for this page's title: a movie's, or an
    // episode's (the series' limits, its own length or the show's).
    function sizeHit(st, info, videoId) {
        if (!Stremio.sizeLimitHit || !_d) { return ''; }
        var meta = _d.meta || {}, series = _d.type === 'series', vid = videoId || _d.streamId, mins = 0;
        if (series) {
            var v = (meta.videos || []).filter(function (x) { return x.id === vid; })[0];
            mins = Stremio.runtimeMinutes(v && v.runtime) || Stremio.runtimeMinutes(meta.runtime);
        } else { mins = Stremio.runtimeMinutes(meta.runtime); }
        return Stremio.sizeLimitHit(st, series ? 'series' : 'movie', mins, info);
    }
    // Rank a title's sources: the list in order, with the ranking kept for drawing it.
    function sortStreams(list) {
        var rows = rankStreams(list, _d && _d.id);
        if (_d) { _d.rankRows = rows; _d.rankVer = U.store.writes ? U.store.writes() : 0; }   // (as things stood: see drawDetail)
        return rows.map(function (r) { return r.st; });
    }
    function rankRowsFor(list) {
        var rows = _d && _d.rankRows;
        if (rows && rows.length === list.length && (!list.length || rows[0].st === list[0])) { return rows; }
        return rankStreams(list, _d && _d.id);
    }
    function bestRow(rows) {
        for (var i = 0; i < rows.length; i++) { if (pickable(rows[i])) { return rows[i]; } }
        return null;
    }
    function pickable(r) { return r.group !== 'unsuitable' && r.group !== 'worded' && r.group !== 'sized' && r.group !== 'bad' && r.group !== 'where'; }
    // A source that didn't start (the player, Settings › Source ranking › The next source): the
    // best ranked one this playback hasn't tried (tried: their sourceIds; never the same file
    // again), as the player takes a source, or null. total: how many it could try in all.
    // avoid: [{ addon, tag }] — an addon's links through a debrid service that sent an account's
    // notice (access refused, a limit: the player's noticeOf): they'd say the same.
    function nextSourceFor(tried, avoid) {
        var rows = (_d && _d.streams) ? filterRows(rankRowsFor(_d.streams)) : [], seen = {}, all = [];   // (within the filter: Addon ▾ / Resolution ▾)
        rows.forEach(function (r) {
            var st = r.st, id = Stremio.sourceId(st), dt = Stremio.debridOf ? Stremio.debridOf(st) : null;
            if (!pickable(r) || seen[id] || st._yt || st._localFile || !/^https?:\/\//i.test(st.url || '')) { return; }
            if (dt && (avoid || []).some(function (x) { return x.addon === st._addon && x.tag === dt.tag; })) { return; }
            seen[id] = 1; all.push(st);
        });
        var next = all.filter(function (st) { return tried.indexOf(Stremio.sourceId(st)) === -1; })[0];
        return next ? { source: playableSources([next])[0], total: all.length } : null;
    }
    function describeRow(r) {
        var bits = [GROUP_TITLES[r.tier]];
        if (r.info.hdr === 'dv' || r.info.hdr === 'dv-only') { bits.push('Dolby Vision'); }
        else if (r.info.hdr) { bits.push('HDR'); }
        var out = bits.join(' ');
        if (r.info.cache > 0) { out += ' ⚡'; }
        if (r.group === 'played') { out += '  ·  played before'; }
        return out;
    }

    // ----- sources played, per title (the "Played before" group) -----
    var PLAYED_KEY = 'stremiok.playedsrc', PLAYED_PER_TITLE = 5, PLAYED_TITLES = 100;
    // the file itself: name + size when the addon says, else its link
    function fileIdentity(st) {
        var bh = st.behaviorHints || {};
        if (bh.filename && bh.videoSize) { return 'f|' + ('' + bh.filename).toLowerCase() + '|' + bh.videoSize; }
        return 'u|' + (st.url || '');
    }
    function playedList(titleId) { return titleId ? ((U.store.get(PLAYED_KEY, {}) || {})[titleId] || []) : []; }
    function rememberPlayed(titleId, st, info) {
        if (!titleId || !st.url) { return; }
        var all = U.store.get(PLAYED_KEY, {}) || {}, id = fileIdentity(st);
        var list = (all[titleId] || []).filter(function (x) { return x.id !== id; });
        list.unshift({ id: id, binge: (st.behaviorHints || {}).bingeGroup || '', addon: st._addon || '',
            res: info.res, group: groupOf(st), at: Date.now() });
        all[titleId] = list.slice(0, PLAYED_PER_TITLE);
        var ids = Object.keys(all);
        if (ids.length > PLAYED_TITLES) {
            ids.sort(function (a, b) { return (all[a][0] || {}).at - (all[b][0] || {}).at; });
            ids.slice(0, ids.length - PLAYED_TITLES).forEach(function (k) { delete all[k]; });
        }
        U.store.set(PLAYED_KEY, all);
    }
    // Position of the matching played source (0 = latest), or -1. Across a series'
    // episodes the files differ, so the same release family counts: the addon's binge
    // group, or the same addon, resolution and release group.
    function playedIndex(hist, st, info) {
        if (!hist.length) { return -1; }
        var same = playedMatcher(st, info);
        for (var i = 0; i < hist.length; i++) { if (same(hist[i])) { return i; } }
        return -1;
    }
    function playedMatcher(st, info) {
        var id = fileIdentity(st), binge = (st.behaviorHints || {}).bingeGroup || '', grp = null;
        var series = !!(_d && _d.type === 'series');
        return function (h) {
            if (h.id === id) { return true; }
            if (!series) { return false; }
            if (h.binge && h.binge === binge) { return true; }
            if (grp === null) { grp = groupOf(st); }
            return !!(h.group && h.group === grp && h.addon === st._addon && h.res === info.res);
        };
    }
    // A source that didn't play isn't "Played before" any more (nor its release family).
    function forgetPlayed(titleId, st, info) {
        var all = U.store.get(PLAYED_KEY, {}) || {};
        if (!titleId || !all[titleId]) { return; }
        var same = playedMatcher(st, info);
        all[titleId] = all[titleId].filter(function (h) { return !same(h); });
        if (!all[titleId].length) { delete all[titleId]; }
        U.store.set(PLAYED_KEY, all);
    }

    // ----- sources you marked "not suitable", per title (hold OK on a source) -----
    // Wrong language, bad quality, a fake… : it goes to the bottom of that title's list
    // (never Play best, nor the next episode's pick) and out of Played before. Kept by the
    // file (see fileIdentity), so the same file from another addon counts too.
    var UNSUIT_KEY = 'stremiok.unsuitable', UNSUIT_PER_TITLE = 50, UNSUIT_TITLES = 200;
    function unsuitableAll() { var a = U.store.get(UNSUIT_KEY, {}); return (a && typeof a === 'object' && !Array.isArray(a)) ? a : {}; }
    function unsuitableList(titleId) {
        var l = titleId ? unsuitableAll()[titleId] : null;
        return Array.isArray(l) ? l.map(function (x) { return x && x.id; }).filter(Boolean) : [];
    }
    function isUnsuitable(titleId, st) { return unsuitableList(titleId).indexOf(fileIdentity(st)) !== -1; }
    function setUnsuitable(titleId, st, on) {
        if (!titleId) { return; }
        var all = unsuitableAll(), id = fileIdentity(st);
        var list = (Array.isArray(all[titleId]) ? all[titleId] : []).filter(function (x) { return x && x.id && x.id !== id; });
        if (on) { list.unshift({ id: id, at: Date.now() }); }
        if (list.length) { all[titleId] = list.slice(0, UNSUIT_PER_TITLE); } else { delete all[titleId]; }
        var ids = Object.keys(all);
        if (ids.length > UNSUIT_TITLES) {
            ids.sort(function (a, b) { return ((all[a][0] || {}).at || 0) - ((all[b][0] || {}).at || 0); });
            ids.slice(0, ids.length - UNSUIT_TITLES).forEach(function (k) { delete all[k]; });
        }
        U.store.set(UNSUIT_KEY, all);
    }
    // Hold OK on a source: Play from the start (a place to resume), Not suitable (or back), and
    // with a USB drive plugged in, Download to it (js/downloads.js). With only Not suitable to
    // offer, it's asked at once.
    function sourceMenu(stream) {
        var canStart = !howHere() && savedPlace(_d.streamId);
        var canDownload = typeof Downloads !== 'undefined' && Downloads.available() && (Downloads.isFileLink ? Downloads.isFileLink(stream) : /^https?:\/\//i.test(stream.url || '')) && !stream._localFile && !stream._yt;
        if (!canStart && !canDownload) { toggleUnsuitable(stream); return; }
        var unsuit = isUnsuitable(_d.id, stream), opts = [];
        if (canStart) { opts.push(['start', 'Play from the start']); }
        if (canDownload) { opts.push(['download', '⬇  Download to USB drive']); }
        opts.push(['suit', unsuit ? 'Put back among the sources' : 'Not suitable']);
        pickList(Stremio.streamName(stream), opts, null, function (k) {
            if (k === 'start') { startPlayback(stream, _d.streamId, _d.streamLabel || _d.meta.name, { fromStart: true }); }
            else if (k === 'download') { downloadSource(stream); }
            else { toggleUnsuitable(stream); }
        });
    }
    // What a download of this title's video is saved as (here, and from the player: ctx.downloadAs).
    function downloadTitle(videoId) {
        var meta = _d.meta || {}, ep = (_d.type === 'series' && videoId) ? ('' + videoId).match(/:(\d+):(\d+)$/) : null;
        var label = (meta.name || meta.title || _d.streamLabel || 'Video') + (meta.year ? ' (' + meta.year + ')' : '') +
            (ep ? ' S' + (ep[1] < 10 ? '0' : '') + ep[1] + 'E' + (ep[2] < 10 ? '0' : '') + ep[2] : '');
        return { type: _d.type, videoId: videoId, label: label, titleId: _d.id, name: meta.name || meta.title || '', poster: meta.poster || '', year: meta.year || meta.releaseInfo || '' };
    }
    function downloadSource(stream) {
        Downloads.start(stream, downloadTitle(_d.streamId),
            { pick: function (title, options, fn) { pickList(title, options, null, fn); }, confirm: function (msg, ok, fn) { confirm(msg, ok, fn); } });
    }
    function toggleUnsuitable(stream) {
        var titleId = _d && _d.id, on = !isUnsuitable(titleId, stream), name = Stremio.streamName(stream);
        var msg = on ? 'Mark “' + name + '” as not suitable for this title? It moves to the bottom of the list, and out of Played before.'
            : 'Put “' + name + '” back among this title’s sources?';
        confirm(msg, on ? 'Not suitable' : 'Put back', function () {
            setUnsuitable(titleId, stream, on);
            if (on) { forgetPlayed(titleId, stream, Stremio.streamInfo(stream)); }
            U.toast(on ? 'Marked not suitable' : 'Back among the sources');
            if (_d && _d.id === titleId && _d.mode === 'streams' && _d.streams) {
                _d.streams = sortStreams(_d.streams);
                redrawKeepingFocus();   // (on the same source, in its new place)
            }
        });
    }

    // Sources appear as each addon answers (the rest are noted as still loading), with the
    // same file from several addons shown once. force: bypass the short-lived cache.
    // A movie known by an anime database's id (AIOMetadata: "mal:32281") whose details give its
    // IMDb id too: its sources are asked for by both. Stream addons that gather (AIOStreams)
    // only ask their anime sources by the anime id (Your Name.: 3 sources), and all of them by
    // the IMDb id (31); the same file from both is shown once (dedupeStreams).
    function imdbAlso(videoId) {
        var m = _d.meta || {}, tt = '' + (m.imdb_id || '');
        if (_d.type !== 'movie' || _d.addonType || !/^tt\d+$/.test(tt) || /^tt\d/.test(videoId) || videoId !== (m.id || _d.id)) { return []; }
        return [tt];
    }
    // Sources for several ids of one title, as one list (as each answers, like getStreams).
    function streamsFor(type, ids, onUpdate, force) {
        if (ids.length === 1) { return Stremio.getStreams(type, ids[0], onUpdate, force); }
        var lists = ids.map(function () { return []; }), pend = ids.map(function () { return 1; });
        function all() { return [].concat.apply([], lists); }
        function waiting() { return pend.reduce(function (a, b) { return a + b; }, 0); }
        return Promise.all(ids.map(function (id, i) {
            return Stremio.getStreams(type, id, function (l, p) { lists[i] = l; pend[i] = p; if (onUpdate) { onUpdate(all(), waiting()); } }, force)
                .then(function (l) { lists[i] = l; pend[i] = 0; return l; }, function () { pend[i] = 0; return null; });
        })).then(function (res) {
            if (res.every(function (r) { return r === null; })) { throw new Error('no sources'); }
            return all();
        });
    }

    // how (optional): { fromStart } — everything played from the page plays from the start;
    // { auto } — Skip the source list (Settings › Source ranking): the top source plays once the
    // addons have answered (with nothing playable, the list shows as usual).
    var AUTO = { auto: true };
    function openStreams(videoId, label, force, how) {
        if (!force) { _d.fromStart = !!(how && how.fromStart); }   // (a re-scan keeps it)
        var auto = !force && !!(how && how.auto) && Stremio.getPrefs().skipSourceList && !_d.live;
        _d.mode = 'streams';
        _d.streamId = videoId;
        _d.streamLabel = label;
        _d.streams = null;
        _d.streamsPending = 0;
        drawDetail();
        U.spinner(true);
        var page = _d;
        function here() { return _d === page && _d.mode === 'streams' && _d.streamId === videoId; }
        // TMDB's where to watch, alongside the addons' sources
        var extra = [], shown = null, shownPending = 0;
        if (Stremio.tmdbWhereToWatch && (_d.type === 'movie' || _d.type === 'series')) {
            Stremio.tmdbWhereToWatch(_d.type, _d.id, pageCancel()).then(function (list) {
                extra = list || [];
                if (extra.length && shown && here()) { show(shown, shownPending); }
            });
        }
        function show(list, pending) {
            if (!here()) { return; }
            shown = list; shownPending = pending;
            if (!Player.isActive()) { U.spinner(false); }
            var hadList = !!(_d.streams && _d.streams.length);
            _d.streams = sortStreams(extraWhere(Stremio.dedupeStreams(list), extra));
            _d.streamsPending = pending;
            if (Player.isActive()) { return; }
            // Focus stays put only once you've moved it. Until then each answer lands it on the
            // top again (the first addon to answer may have only "where to watch" links, which
            // the full list then sorts to the bottom).
            if (hadList && Focus.current() !== _d._autoFocus) { redrawKeepingFocus(); }
            else { drawDetail(); _d._autoFocus = Focus.current(); }
        }
        streamsFor(addonType(), [videoId].concat(imdbAlso(videoId)), function (list, pending) {
            if (pending > 0 && list.length) { show(list, pending); }   // partial: only once there's something to pick
        }, force).then(function (list) {
            if (!here() && !Player.isActive()) { U.spinner(false); }
            show(list, 0);
            if (auto && here() && !Player.isActive()) {   // (Skip the source list: the top one plays)
                var top = (_d.streams && _d.streams.length) ? bestRow(rankRowsFor(_d.streams)) : null;
                if (top) { startPlayback(top.st, videoId, label, howHere()); return; }
            }
            // a video of a YouTube channel / playlist: nothing to choose, it plays (stopping
            // goes back to the channel's videos, on it)
            if (here() && _d.addonType && !force && !Player.isActive()) {
                var yt = (_d.streams || []).filter(function (st) { return st._yt; })[0];
                if (yt) { _d.directList = true; startPlayback(yt, videoId, label); }
            }
        }, function () {
            if (!Player.isActive()) { U.spinner(false); }
            if (!here()) { return; }
            if (extra.length) { show([], 0); return; }
            _d.streams = []; _d.streamsPending = 0;
            drawDetail();
        });
    }

    // Redraw the source list without moving focus: the focused source (found again by its
    // identity, wherever it moved in the list) or the focused button above it.
    function redrawKeepingFocus() {
        var cur = Focus.current(), s = scr('detail');
        var onPage = cur && s.contains(cur);
        _d._keepStream = (onPage && cur.__streamKey) || null;
        var epId = onPage && cur.getAttribute ? cur.getAttribute('data-ep') : null;   // (an episode: still on it, not the first button)
        var btnText = (onPage && !epId && !cur.__streamKey && cur.className.indexOf('stream') === -1) ? cur.textContent : null;
        if (epId) { _d.target = epId; }
        drawDetail();
        _d._keepStream = null;
        if (btnText) {
            var btns = s.querySelectorAll('.btn-row .focusable');
            for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === btnText) { Focus.setFocus(btns[i]); break; } }
        }
    }
    function streamIdentity(st) {
        return st.url || st.externalUrl || (st.infoHash ? st.infoHash + ':' + (st.fileIdx || 0) : '') || (st._addon + '|' + Stremio.streamName(st));
    }

    // Re-fetch the current title's sources and land focus on the first result.
    function rescanStreams() {
        if (_d && _d.streamId) { openStreams(_d.streamId, _d.streamLabel, true); }
    }

    // Above the list: whose sources these are when that isn't the page's title (an episode,
    // "Sources for The Bear  S2E1"; a movie's are just its own), and addons still answering.
    function streamsHeading() {
        var pend = _d.streamsPending || 0, label = _d.streamLabel || '';
        var title = (_d.meta && (_d.meta.name || _d.meta.title)) || '';
        var parts = [];
        if (label && label !== title) { parts.push('Sources for ' + label); }
        if (pend) { parts.push(pend + ' more addon' + (pend > 1 ? 's' : '') + ' still loading…'); }
        return parts.join('   ·   ');
    }
    // ----- the source filter: Addon ▾ / Resolution ▾ next to ▶ Play best (this title's, on _d) -----
    // The list, Play best and the next source (nextSourceFor) show only what matches; each
    // button lists what's there within the other's choice, with how many.
    function filterOf() { return (_d && _d.filter) || { addon: '', res: '' }; }
    function rowAddons(r) { return [r.st._addon].concat(r.st._also || []).filter(Boolean); }   // (a file two addons offer: both)
    function matchFilter(r, f, skip) {
        if (f.addon && skip !== 'addon' && rowAddons(r).indexOf(f.addon) === -1) { return false; }
        if (f.res && skip !== 'res' && (r.group === 'where' || r.tier !== f.res)) { return false; }
        return true;
    }
    function filterRows(rows) {
        var f = filterOf();
        return (f.addon || f.res) ? rows.filter(function (r) { return matchFilter(r, f); }) : rows;
    }
    // [[key, label, how many]] for one button, within the other's choice
    function filterOptions(kind, rows) {
        var f = filterOf(), out = [], at = {};
        rows.forEach(function (r) {
            if (!matchFilter(r, f, kind)) { return; }
            var keys = kind === 'addon' ? rowAddons(r) : (r.group === 'where' ? [] : [r.tier]);
            keys.forEach(function (k) {
                if (at[k] === undefined) { at[k] = out.length; out.push([k, kind === 'addon' ? k : GROUP_TITLES[k], 0, Infinity]); }
                out[at[k]][2]++;
                if (kind === 'addon' && k === r.st._addon) { out[at[k]][3] = Math.min(out[at[k]][3], r.st._addonRank || 0); }
            });
        });
        // resolutions high to low; addons in your order (Settings › Addons)
        out.sort(kind === 'res' ? function (x, y) { return TIERS.indexOf(x[0]) - TIERS.indexOf(y[0]); } : function (x, y) { return x[3] - y[3]; });
        return out;
    }
    function filterPill(kind, rows) {
        var f = filterOf(), opts = filterOptions(kind, rows);
        if (opts.length < 2 && !f[kind]) { return null; }   // (no choice to make)
        var label = kind === 'addon' ? 'Addon: ' + (f.addon || 'All') : 'Resolution: ' + (f.res ? GROUP_TITLES[f.res] : 'All');
        var p = U.el('div', 'pill focusable filter-pill', label + '  ▾');
        if (_d._focusPill === 'filter-' + kind) { _d._epFocus = p; _d._focusPill = null; }
        p.__onselect = function () {
            var total = rows.filter(function (r) { return matchFilter(r, filterOf(), kind) && (kind === 'addon' || r.group !== 'where'); }).length;
            pickList(kind === 'addon' ? 'Sources from' : 'Resolution', [['', 'All  ·  ' + total]].concat(opts.map(function (o) { return [o[0], o[1] + '  ·  ' + o[2]]; })), f[kind], function (k) {
                var now = filterOf();
                _d.filter = { addon: kind === 'addon' ? k : now.addon, res: kind === 'res' ? k : now.res };
                _d._focusPill = 'filter-' + kind;
                drawDetail();
            });
        };
        return p;
    }
    function streamActionsBar() {
        var row = U.el('div', 'btn-row streams-actions');
        var allRows = (_d.streams && _d.streams.length) ? rankRowsFor(_d.streams) : [];
        // ▶ Play best: the top of the ranking (focused when the page opens), within the filter
        var best = allRows.length ? bestRow(filterRows(allRows)) : null;
        if (best) {
            var pb = U.el('div', 'pill focusable play-best', '▶  Play best' + (howHere() ? ' from the start' : '') + '  ·  ' + describeRow(best));
            pb.__onselect = function () { startPlayback(best.st, _d.streamId, _d.streamLabel || _d.meta.name, howHere()); };
            var place = !howHere() && savedPlace(_d.streamId);
            if (place) {   // hold OK: resuming, or from the start
                pb.__onlongpress = function () {
                    pickList(_d.streamLabel || _d.meta.name || '', [['resume', 'Play best, resuming at ' + U.fmtTime(place.position)], ['start', 'Play best from the start']], null, function (k) {
                        startPlayback(best.st, _d.streamId, _d.streamLabel || _d.meta.name, k === 'start' ? { fromStart: true } : null);
                    });
                };
            }
            if (!_d._epFocus && !_d._keepStream) { _d._epFocus = pb; }
            row.appendChild(pb);
        }
        if (allRows.length && !_d.live) {
            ['addon', 'res'].forEach(function (kind) { var fp = filterPill(kind, allRows); if (fp) { row.appendChild(fp); } });
        }
        if (_d.type === 'movie' && _d.meta) {
            var npId = _d.meta.id || _d.id;   // (the id it's added by: see nowPlayingLabel)
            var np = U.el('div', 'pill focusable', nowPlayingLabel('movie', npId));
            np.__onselect = function () { toggleNowPlaying('movie', _d.meta); np.textContent = nowPlayingLabel('movie', npId); };
            row.appendChild(np);
            var tp = trailerPill();
            if (tp) { row.appendChild(tp); }
            var mp = morePill();
            if (mp) { row.appendChild(mp); }
        } else if (shownEpisode()) {   // an episode's page: its trailer (TMDB's), its own Cast & more
            var etp = episodeTrailerPill(row, shownEpisode());
            if (etp) { row.appendChild(etp); }
            var emp = morePill();
            if (emp) { row.appendChild(emp); }
        }
        return row;
    }

    var STREAM_BATCH = 40;   // sources drawn up front; more as focus nears the end
    function streamsPanel() {
        var panel = U.el('div', 'list-panel streams-panel');
        var listScroll = U.el('div', 'list-scroll');
        if (_d.streams === null) {
            panel.appendChild(U.el('div', 'detail-meta', 'Loading sources…'));
            return panel;
        }
        if (!_d.streams.length) {   // (asked again from here: an addon may have been slow or down)
            var none = U.el('div', 'detail-meta no-sources', Stremio.hasStreamAddons && !Stremio.hasStreamAddons() ? 'No sources found. Add a stream addon in Settings.' : 'No sources found.');
            if (_d.embedded) { panel.appendChild(none); return panel; }
            listScroll.appendChild(none);   // (in the list, above Re-scan: the list sits at the panel's top)
            (Stremio.streamNotes ? Stremio.streamNotes(addonType(), _d.streamId) : []).forEach(function (n) {   // (why, when an addon says: AIOStreams)
                var note = U.el('div', 'stream-note');
                note.appendChild(U.el('div', 'sn-title', U.drawable(n.addon + (n.title ? '   ·   ' + n.title : ''))));
                if (n.text) { note.appendChild(U.el('div', 'sn-text', U.drawable(n.text))); }
                listScroll.appendChild(note);
            });
            var again = U.el('div', 'stream focusable rescan-row');
            again.appendChild(document.createTextNode('↻  Re-scan for sources'));
            again.appendChild(U.el('span', 's-sub', 'Ask all stream addons again'));
            again.__onselect = function () { rescanStreams(); };
            if (!_d._epFocus) { _d._epFocus = again; }
            listScroll.appendChild(again);
            panel.appendChild(listScroll);
            return panel;
        }
        // Long lists (150+ sources across addons) are drawn in batches: DOWN near the end
        // of what's drawn adds the next batch, like the Home rows. Each group (Played
        // before, 4K, 1080p, …) starts with its heading.
        var heading = streamsHeading();
        if (heading) { listScroll.appendChild(U.el('div', 'stream-for', heading)); }
        var list = _d.streams, keepAt = -1, rows = rankRowsFor(list), lastGroup = null;
        // Direct links only (Settings › Source ranking): the sources the TV can't play left out
        // (torrents, links it can't open); where-to-watch apps stay (they open)
        if (Stremio.getPrefs().hideUnplayable && !_d.live) {
            var keptList = [], keptRows = [];
            list.forEach(function (st, i) {
                var app = (rows[i] && rows[i].app !== undefined) ? rows[i].app : whereApp(st);
                if (Stremio.isPlayable(st) || app) { keptList.push(st); keptRows.push(rows[i]); }
            });
            var gone = list.length - keptList.length;
            if (gone) {
                listScroll.appendChild(U.el('div', 'streams-hidden', gone + (gone === 1 ? ' source the TV can’t play is hidden' : ' sources the TV can’t play are hidden') + '  (Settings › Playback › Source ranking)'));
                list = keptList; rows = keptRows;
            }
        }
        // the filter (Addon ▾ / Resolution ▾): only what matches, saying so
        var flt = filterOf();
        if ((flt.addon || flt.res) && !_d.live) {
            var fl = [], fr = [];
            list.forEach(function (st, i) { if (rows[i] && matchFilter(rows[i], flt)) { fl.push(st); fr.push(rows[i]); } });
            listScroll.appendChild(U.el('div', 'streams-hidden', 'Showing ' + fl.length + ' of ' + list.length + ' sources: ' +
                [flt.addon, flt.res ? GROUP_TITLES[flt.res] : ''].filter(Boolean).join('  ·  ') + '  (Addon ▾ / Resolution ▾ above)'));
            list = fl; rows = fr;
        }
        if (_d._keepStream) {
            for (var ki = 0; ki < list.length; ki++) { if (streamIdentity(list[ki]) === _d._keepStream) { keepAt = ki; break; } }
        }
        var rescan = null;
        function addBatch(from) {
            var to = Math.min(list.length, from + Math.max(STREAM_BATCH, keepAt + 10 - from));
            var built = [];
            for (var i = from; i < to; i++) {
                if (rows[i] && rows[i].group !== lastGroup) {
                    lastGroup = rows[i].group;
                    var n = rows.filter(function (r) { return r.group === lastGroup; }).length;
                    listScroll.insertBefore(U.el('div', 'stream-group', GROUP_TITLES[lastGroup] + '   ·   ' + n), rescan);
                }
                var node = streamNode(list[i], rows[i]);
                // the list, not the buttons above it, gets initial focus (unless a button asked for it)
                if (i === keepAt || (keepAt < 0 && i === 0 && !_d._epFocus)) { _d._epFocus = node; }
                listScroll.insertBefore(node, rescan);
                built.push(node);
            }
            if (to >= list.length) { return; }
            var added = false;
            function more() { if (!added) { added = true; addBatch(to); } return false; }   // then DOWN moves on as usual
            built.slice(-2).forEach(function (n) { n.__navDOWN = more; });
        }
        function streamNode(stream, row) {
            var playable = Stremio.isPlayable(stream);
            var opens = playable ? null : ((row && row.app !== undefined) ? (row.app || null) : whereApp(stream));
            var node = U.el('div', 'stream focusable');
            node.__streamKey = streamIdentity(stream);
            node.appendChild(document.createTextNode(Stremio.streamName(stream)));

            // Detail block: size + the addon's own description (languages, seeds, etc.)
            var lines = [];
            var size = Stremio.streamSize(stream);
            var desc = Stremio.streamDescription(stream);
            if (size && !/(TB|GB|MB)\b/i.test(desc)) { lines.push('💾 ' + size); }
            if (desc) { lines.push(desc); }
            if (stream._addon) { lines.push('⚙️ ' + stream._addon + (stream._also ? '   ·   also on ' + stream._also.join(', ') : '')); }
            if (stream._earlier) { lines.push('🕘 From earlier: you played it ' + U.dayLabel(stream._earlier) + '; the addon didn’t answer in time just now, so it may no longer play'); }
            if (row && row.unsuitable) { lines.push('⛔ Marked not suitable for this title  ·  hold OK to put it back'); }
            if (row && row.worded) { lines.push('🚫 Has your word “' + row.worded + '”  (Settings › Playback › Source ranking)'); }
            if (row && row.sized) { lines.push('📏 Outside your size limits: ' + row.sized + '  (Settings › Playback › Source ranking)'); }
            if (row && row.blocked) { lines.push('⚠ ' + row.blocked + ' isn’t allowed  (Settings › Playback › Formats)'); }
            if (row && row.bad.length) { lines.push('⚠ Marked “Not working” on this TV: ' + row.bad.join(', ') + '  (Settings › Playback › Formats)'); }
            if (opens) {
                lines.push('▶ OK opens ' + (opens.data ? 'it in ' : '') + opens.app.name);
            } else if (!playable) {
                if (stream.infoHash) { lines.push('— torrent, needs a debrid/torrent client'); }
                else if (stream.externalUrl) {
                    lines.push('— another app' + ((typeof TVApps !== 'undefined' && TVApps.available())
                        ? ': add it in Settings › Content › Streaming apps to open it from here' : ' (not playable here)'));
                }
                else { lines.push('— not directly playable on the TV'); }
            }
            var sub = U.el('span', 's-sub', lines.join('\n'));
            sub.style.whiteSpace = 'pre-line';
            node.appendChild(sub);
            if (!playable && !opens) { node.style.opacity = '0.55'; }
            // hold OK: "not suitable" (or back), for a title's own sources (not a live channel's);
            // with a place to resume, Play from the start too
            if (playable && !isSubscriptionStream(stream) && _d && !_d.live) {
                node.__onlongpress = function () { sourceMenu(stream); };
            }
            node.__onselect = function () {
                if (opens) { openWhere(opens); return; }
                if (!playable) { U.toast('This source can’t play directly on the TV.'); return; }
                startPlayback(stream, _d.streamId, _d.streamLabel || _d.meta.name, howHere());
            };
            return node;
        }

        // Re-scan: refresh the source list (and jump back to the first result). Not for a
        // file's own embedded stream, which no stream addon provides.
        if (!_d.embedded) {
            rescan = U.el('div', 'stream focusable rescan-row');
            rescan.appendChild(document.createTextNode('↻  Re-scan for sources'));
            rescan.appendChild(U.el('span', 's-sub', 'Refresh the list from all stream addons'));
            rescan.__onselect = function () { rescanStreams(); };
            listScroll.appendChild(rescan);
        }
        addBatch(0);

        panel.appendChild(listScroll);
        return panel;
    }

    // ----- playback launch (with prev/next episode wiring) -----
    function orderedEpisodes(meta) {
        var vids = (meta.videos || []).slice();
        vids.sort(function (a, b) {
            var sa = (a.season === undefined ? 1 : a.season), sb = (b.season === undefined ? 1 : b.season);
            if (sa !== sb) { return yearOrder() ? sb - sa : sa - sb; }
            return (a.episode || 0) - (b.episode || 0);
        });
        return vids;
    }

    function epMeta(v) {
        var at = airsAt(v);
        return { type: 'series', id: v.id,
            name: epName(v),
            poster: _d.meta.poster, background: _d.meta.background, airs: at > 0 ? at : 0 };
    }

    // The subtitle files a source comes with (an addon's stream "subtitles"): made for that file,
    // so the player lists them first ("with this source").
    function sourceSubsOf(st) {
        return U.listOf(st && st.subtitles, 50, function (t) { return typeof t.url === 'string' && /^https?:\/\//i.test(t.url); }).map(function (t, i) {
            return { id: 'src:' + (t.id != null ? t.id : i), url: t.url, lang: typeof t.lang === 'string' ? t.lang : '', _addon: (st._addon || 'Source') + ' · with this source' };
        });
    }
    // The player's "Select source" list: each source with the request headers it needs
    // (IPTV), so switching to it sends its own (or none).
    function playableSources(list) {
        return (list || _d.streams || []).filter(Stremio.isPlayable).map(function (st) {
            var sz = Stremio.streamSize(st);
            var desc = Stremio.streamDescription(st).replace(/\n/g, '   ');
            var dparts = [];
            if (sz && !/(TB|GB|MB)\b/i.test(desc)) { dparts.push('💾 ' + sz); }
            if (desc) { dparts.push(desc); }
            var yt = st._yt && typeof YTPlay !== 'undefined', page = st.ytPage || st.url;
            var url = yt ? YTPlay.resolverUrl(page, 1080, false, ytLangFor(page)) : st.url;   // (YouTube: through the service, its ladder from the full master)
            return { url: url, yt: st._yt ? page : undefined, variantUrl: yt ? YTPlay.resolverUrl(page) : undefined, initialQualityHeight: yt ? 1080 : undefined,
                headers: U.sanitizeHeaders(st._headers) || undefined, localSubs: st._localSubs, localFile: st._localFile, subExtra: fileHintsOf(st), sourceSubs: sourceSubsOf(st), stream: st,
                label: (st._addon ? st._addon + '  ·  ' : '') + Stremio.streamName(st), detail: dparts.join('   ') };
        });
    }

    // how (optional): { fromStart } — Play from start (Continue Watching): from 0:00.
    function startPlayback(stream, videoId, label, how) {
        // VOD changes progress/watched state. Live playback does not, and keeping Home
        // untouched lets us restore the exact originating card and scroll position.
        if (!(_d && _d.exitToBack)) { markHomeDirty(); }
        // Exit handler: single-source live channels return straight to the grid (skipping
        // the source/info pages we skipped on the way in); everything else redraws detail.
        var exitToBack = !!(_d && _d.exitToBack);
        // Single-source live: skip the (already-skipped) source/info pages and go
        // straight back to the home grid, on the tab we came from.
        var zap = (_d && _d.channels && _d.channels.list.length > 1) ? zapChannel : null;
        // Once it plays (or fails to): Formats learn from it; Played before and the series'
        // preferred source (Next episode) remember it, or forget it.
        var titleId = _d && _d.id, series = _d && _d.type === 'series', vtype = _d && _d.type;
        var remembers = !!(_d && !_d.live);
        // (also for another source picked in the player: what's learned is that one's)
        function learnFor(st) {
            var info = Stremio.streamInfo(st), fkeys = Stremio.formatKeys(info);
            return {
                // (private viewing: nothing about this playback remembered or forgotten — its own
                // flag, set when it started, see player-store; what plays on this TV is still learned)
                // (playing: the playback it's about, as it is now — another source's is a copy)
                onStarted: function (err, playing) {
                    Stremio.recordFormats(fkeys, true);
                    if ((playing || ctx || {}).private) { return; }
                    if (remembers) { rememberPlayed(titleId, st, info); Stremio.keepSource(vtype, videoId, st); }   // (kept: listed when its addon is late, see Stremio.keptSources)
                    if (series && st._addon) { rememberSeriesSource(titleId, st); }
                },
                onFailed: function (err, playing) {
                    Stremio.recordFormats(fkeys, false, err, fileIdentity(st));
                    if (remembers && !(playing || ctx || {}).private) { forgetPlayed(titleId, st, info); Stremio.forgetSource(vtype, videoId, st); }
                    if (page) { page.directFailed = true; }   // (played straight away and failed: its source list next)
                }
            };
        }
        var learn = learnFor(stream);
        var page = _d, direct = !!(_d && _d.direct), directList = !!(_d && _d.directList);
        if (_d) { _d.direct = false; _d.directList = false; _d.directFailed = false; }   // (only this once: played again from the list, back to the list)
        var onExit = function (how) {
            // (after CH+/CH−, back on the card of the channel you ended on)
            if (exitToBack) { var ch = _d.channels ? _d.channels.list[_d.channels.idx] : null; App.returnFromLive(ch ? ch.card : null, ch ? ch.meta.id : null); return; }
            // played straight away (a single YouTube video): back where it was opened from
            if (direct && !page.directFailed && _d === page) { App.back(); return; }   // (Home redrawn if Continue Watching changed)
            // a channel's video played straight away: back on the channel's videos, on it
            if (directList && !page.directFailed && _d === page && hasEpisodeList()) { _d.mode = 'info'; _d.target = videoId; drawDetail(); return; }
            // A finished series episode (now marked watched) returns to the episode list,
            // focused on that episode; otherwise back to the source list it was played from.
            if (how && how.finished && hasEpisodeList()) { _d.mode = 'info'; _d.target = videoId; }
            else if (_d.mode === 'info') { _d.target = videoId; }   // back on a list: focus what was playing
            drawDetail();
        };
        // YouTube-live IPTV channels: the bundled service resolves them to HLS; play that
        // via AVPlay like any channel (autoplay, ● LIVE, Back-to-grid all work normally).
        var still = pageNow();
        if (stream._yt && _d && _d.live) {
            U.spinner(true);
            YTPlay.ensureService().then(function () {
                var ytPage = stream.ytPage || stream.url;
                U.spinner(false);
                if (!still()) { return; }
                Player.play({
                    url: YTPlay.resolverUrl(ytPage, 1080),
                    variantUrl: YTPlay.resolverUrl(ytPage),
                    initialQualityHeight: 1080,
                    type: _d.type, id: videoId, name: label,
                    poster: _d.meta && _d.meta.poster, streams: [], yt: ytPage, zap: zap, zapTo: zap ? zapToChannel : null
                }, onExit);
            }, function () {
                U.spinner(false);
                if (!still()) { return; }
                U.toast(YTPlay.unavailableMessage('channel'), 6000);
                if (exitToBack) { onExit(); }   // opened from the grid: back on its card, not a blank page
            });
            return;
        }
        var ctx = { url: stream.url, type: _d.type, addonType: _d.addonType, id: videoId, name: label, parent: _d.id,
            poster: _d.meta.poster, background: _d.meta.background, streams: playableSources(), _headers: U.sanitizeHeaders(stream._headers) || undefined, zap: zap, zapTo: zap ? zapToChannel : null,
            localSubs: stream._localSubs, localFile: stream._localFile,
            subExtra: fileHintsOf(stream), sourceSubs: sourceSubsOf(stream), formatInfo: Stremio.streamInfo(stream), fromStart: !!(how && how.fromStart) || undefined,
            titleIds: titleIdsOf(_d.meta, videoId), stream: stream, nextSource: nextSourceFor, downloadAs: typeof Downloads !== 'undefined' ? downloadTitle(videoId) : undefined,
            onStarted: learn.onStarted, onFailed: learn.onFailed, learnFor: learnFor };
        if (_d.type === 'series' && _d.meta.videos) {
            // (only episodes that are out: Previous / Next, the near-the-end preload and the next
            // episode queued at the credits never point at one that hasn't aired; no date: out)
            var now = Date.now(), ord = orderedEpisodes(_d.meta).filter(function (v) { return v.id === videoId || !(airsAt(v) > now); });
            var idx = ord.findIndex(function (v) { return v.id === videoId; });
            if (idx > 0) { ctx.hasPrev = true; ctx.playPrev = function () { playEpisode(ord[idx - 1]); }; }
            if (idx >= 0 && idx < ord.length - 1) {
                ctx.hasNext = true;
                ctx.nextEpisode = epMeta(ord[idx + 1]);
                ctx.playNext = function () { playEpisode(ord[idx + 1]); };
                // near the end: load the next episode's sources so "Next" starts right away
                ctx.prefetchNext = function () { Stremio.prefetchStreams(addonType(), ord[idx + 1].id); };
            }
        }
        // A YouTube video (an addon's source that's only a YouTube id, e.g. YouTubio's): through
        // the YouTube service, like a trailer, but as the title it is (progress, Continue
        // Watching, Played before, next episode).
        if (stream._yt) {
            var ytPage = stream.ytPage || stream.url;
            U.spinner(true);
            YTPlay.ensureService().then(function () {
                U.spinner(false);
                if (!still()) { return; }
                ctx.ytLang = ytLangFor(ytPage);   // ('' = the original: the default)
                ctx.url = YTPlay.resolverUrl(ytPage, 1080, false, ctx.ytLang);
                ctx.variantUrl = YTPlay.resolverUrl(ytPage);
                ctx.initialQualityHeight = 1080;
                ctx.yt = ytPage;
                Player.play(ctx, onExit);
            }, function () {
                U.spinner(false);
                if (still()) { U.toast(YTPlay.unavailableMessage('video'), 6000); }
            });
            return ctx;
        }
        Player.play(ctx, onExit);
        return ctx;
    }

    // The title's own ids from its details, for skip times (an anime opened by its Kitsu or
    // MyAnimeList id: its IMDb id and the episode's season, as AIOMetadata gives them), or undefined.
    function titleIdsOf(meta, videoId) {
        if (!meta) { return undefined; }
        var imdb = [meta.imdb_id, meta._imdbId].filter(function (x) { return /^tt\d+$/.test('' + x); })[0];
        var mal = [meta._malId, meta.mal_id].filter(function (x) { return /^\d+$/.test('' + x); })[0];
        if (!imdb && !mal) { return undefined; }
        var v = (meta.videos || []).filter(function (x) { return x && x.id === videoId; })[0];
        return { imdb: imdb ? '' + imdb : undefined, mal: mal != null ? '' + mal : undefined, season: v && +v.season > 0 ? +v.season : undefined };
    }

    // A source's file as subtitle addons take it (Stremio's videoHash, videoSize, filename):
    // what the source says about it, or undefined (the player checks each one).
    function fileHintsOf(st) {
        var bh = (st && st.behaviorHints) || {}, o = {}, any = false;
        ['filename', 'videoSize', 'videoHash'].forEach(function (k) { if (bh[k] != null && bh[k] !== '') { o[k] = bh[k]; any = true; } });
        return any ? o : undefined;
    }

    // ----- live channels: CH+/CH− -----
    // Presses in quick succession move through the row (the name shows as you go); the
    // channel you stop on is tuned after a short pause, so skipping past several doesn't
    // open each one.
    var ZAP_DELAY = 700;
    var _zap = null;   // { target, timer }
    // A channel by its number in the row (the player's number keys): as CH+ / CH− tune.
    function zapToChannel(pos) {
        var ch = _d && _d.channels;
        if (!ch) { return; }
        var n = ch.list.length;
        if (!(pos >= 1 && pos <= n)) { U.toast('No channel ' + pos + ' here (1 to ' + n + ')', 2000); return; }
        if (_zap) { clearTimeout(_zap.timer); _zap = null; }
        var m = ch.list[pos - 1].meta;
        U.toast(pos + ' / ' + n + '    ' + (m.name || m.title || ''), 1600);
        if (pos - 1 === ch.idx && ch.tuning == null) { return; }   // (on it already)
        tuneTo(pos - 1);
    }
    function zapChannel(dir) {
        var ch = _d && _d.channels;
        if (!ch) { return; }
        var n = ch.list.length;
        // (from the channel being tuned, if one still is: CH+ twice is two channels on)
        var from = _zap ? _zap.target : (ch.tuning != null ? ch.tuning : ch.idx);
        var target = (from + dir + n) % n;
        if (_zap) { clearTimeout(_zap.timer); }
        _zap = { target: target, timer: setTimeout(function () { var t = _zap.target; _zap = null; tuneTo(t); }, ZAP_DELAY) };
        var m = ch.list[target].meta;
        U.toast((target + 1) + ' / ' + n + '    ' + (m.name || m.title || ''), 1600);
    }
    // Each tune is numbered: only the latest one's answer starts playback, clears the spinner or
    // shows an error (an older, slower lookup arriving later can't replace the channel you
    // chose since). Its lookup isn't stopped (it fills the source cache), only ignored.
    var _tuneGen = 0;
    function tuneTo(idx) {
        var page = _d, ch = page && page.channels;
        if (!ch || !Player.isActive()) { return; }
        var gen = ++_tuneGen;
        ch.tuning = idx;
        var m = ch.list[idx].meta, type = m.type || page.type, name = m.name || m.title || 'Live';
        U.spinner(true, 'Tuning to ' + name + '…');
        Stremio.getStreams(type, m.id).then(function (list) {
            if (gen !== _tuneGen) { return; }   // (a later channel was chosen: its own answer handles the spinner)
            ch.tuning = null;
            if (_d !== page || !Player.isActive()) { U.spinner(false); return; }   // left the player meanwhile
            var playable = list.filter(Stremio.isPlayable);
            if (!playable.length) { U.spinner(false); U.toast('No playable source for ' + name); return; }
            ch.idx = idx;
            page.id = m.id; page.type = type; page.meta = m; page.preview = m;
            page.streamId = m.id; page.streamLabel = name; page.streams = list;
            startPlayback(playable[0], m.id, name);
        }, function () {
            if (gen !== _tuneGen) { return; }
            ch.tuning = null;
            if (_d !== page || !Player.isActive()) { U.spinner(false); return; }
            U.spinner(false);
            U.toast('Couldn\'t load ' + name);
        });
    }

    // Load a specific episode's sources and auto-play the first playable one.
    function playEpisode(v) {
        _d.mode = 'streams';
        _d.streamId = v.id;
        _d.season = (v.season === undefined ? 1 : v.season);
        _d.streamLabel = epName(v);
        U.spinner(true);
        Stremio.getStreams(addonType(), v.id).then(function (list) {
            _d.streams = sortStreams(Stremio.dedupeStreams(list));
            U.spinner(false);
            var pick = pickLikeLast(_d.id, _d.streams);
            if (!pick) {
                U.toast('No playable source for that episode');
                if (!Player.isActive()) { drawDetail(); }
                return;
            }
            startPlayback(pick, v.id, _d.streamLabel);
        }, function () { U.spinner(false); U.toast('Failed to load that episode'); });
    }

    // ----- binge: the next episode plays a source like the one you've been watching -----
    // Remembered per series (on the TV): the addon, the addon's binge group (Stremio's own
    // "same release" tag), resolution and release group of the last source played.
    var SERIES_SRC_KEY = 'stremiok.seriessrc', SERIES_SRC_MAX = 60;
    function sourceText(st) {
        return [st.name, st.title, st.description, (st.behaviorHints || {}).filename].join(' ');
    }
    function resOf(st) {
        var t = sourceText(st), m = t.match(/(^|[^0-9a-z])(2160|1440|1080|720|576|480|360)[pi]([^0-9a-z]|$)/i);
        if (m) { return parseInt(m[2], 10); }
        return /(^|[^a-z])(4k|uhd)([^a-z]|$)/i.test(t) ? 2160 : 0;
    }
    // Release group: the "-GROUP" at the end of the file name ("...WEB.h264-ETHEL.mkv").
    function groupOf(st) {
        var f = (st.behaviorHints || {}).filename || ('' + (st.title || st.description || '')).split('\n')[0];
        f = ('' + f).trim().replace(/\.(mkv|mp4|avi|m4v|ts|webm)$/i, '');
        var m = f.match(/-([a-z0-9]{2,20})$/i);
        return (m && !/^(dl|rip|web|hdtv|x264|x265|h264|h265|hevc|avc)$/i.test(m[1])) ? m[1].toUpperCase() : '';
    }
    function rememberSeriesSource(seriesId, st) {
        var all = U.store.get(SERIES_SRC_KEY, {}) || {};
        all[seriesId] = { addon: st._addon || '', binge: (st.behaviorHints || {}).bingeGroup || '',
            res: resOf(st), group: groupOf(st), at: Date.now() };
        var ids = Object.keys(all);
        if (ids.length > SERIES_SRC_MAX) {
            ids.sort(function (a, b) { return all[a].at - all[b].at; });
            ids.slice(0, ids.length - SERIES_SRC_MAX).forEach(function (k) { delete all[k]; });
        }
        U.store.set(SERIES_SRC_KEY, all);
    }
    // The best playable match for the series' last source: same binge group first, then
    // same addon, resolution and release group; ties keep the list's order. With nothing
    // remembered, the first playable source (as before).
    function pickLikeLast(seriesId, list) {
        var marked = unsuitableList(seriesId);
        var playable = (list || []).filter(function (st) { return Stremio.isPlayable(st) && !isSubscriptionStream(st) && !Stremio.badFormats(st).length && !Stremio.blockedRes(st) && marked.indexOf(fileIdentity(st)) === -1 && !(Stremio.hideWordHit && Stremio.hideWordHit(st)) && !sizeHit(st); });
        if (!playable.length) { playable = (list || []).filter(function (st) { return Stremio.isPlayable(st) && !isSubscriptionStream(st); }); }
        if (!playable.length) { playable = (list || []).filter(Stremio.isPlayable); }
        if (!playable.length) { return null; }
        var last = (U.store.get(SERIES_SRC_KEY, {}) || {})[seriesId];
        if (!last) { return playable[0]; }
        var best = playable[0], bestScore = -1;
        playable.forEach(function (st) {
            var sc = 0, binge = (st.behaviorHints || {}).bingeGroup || '';
            if (last.binge && binge === last.binge) { sc += 1000; }
            if (last.addon && st._addon === last.addon) { sc += 100; }
            if (last.res && resOf(st) === last.res) { sc += 50; }
            if (last.group && groupOf(st) === last.group) { sc += 30; }
            if (sc > bestScore) { best = st; bestScore = sc; }
        });
        return best;
    }

    // Return true if BACK was handled inside detail (streams -> episode list). Only a
    // series has a page behind its source list. For a movie (or a multi-source live
    // channel) the source list IS the page: returning false lets App.back() leave
    // detail and go straight back to the grid, instead of to a page with only "Play".
    function hasEpisodeList() {
        return !!(_d && _d.type === 'series' && _d.meta && _d.meta.videos && _d.meta.videos.length);
    }

    function backInDetail() {
        if (_d && (_d.mode === 'more' || _d.mode === 'ratings')) {   // back to the page it was opened from, on its button
            _d._focusPill = _d.mode;
            _d.mode = _d.moreFrom || 'info';
            drawDetail();
            return true;
        }
        if (_d && _d.mode === 'streams' && hasEpisodeList()) {
            _d.mode = 'info';
            _d.target = _d.streamId;   // (on the episode it was)
            drawDetail();
            return true;
        }
        return false;
    }

    // ----- published for the other parts (and js/views.js) -----
    V.backInDetail = backInDetail;
    V.detailSnapshot = detailSnapshot;
    V.epCode = epCode;
    V.episodeWatched = episodeWatched;
    V.nextUp = nextUp;
    V.renderDetail = renderDetail;
    V.leaveDetail = leaveDetail;
    V.renderLive = renderLive;
    V.renderPerson = renderPerson;
    V.peopleCard = peopleCard;
    V.tmdbCard = tmdbCard;
    V.trailerNames = function () { return _d && _d.meta ? trailersOf(_d.meta).map(function (t) { return t.name; }) : []; };   // (for tests)
    V.restoreDetail = restoreDetail;
    V.lightSnapshot = lightSnapshot;
})(ViewParts);
