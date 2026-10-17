/* Views, part 4 of 6 — Search: catalogs that support it, people (TMDB), results, recent searches.
   Parts share one namespace, ViewParts (V): each part publishes the functions the
   others use, and borrows theirs through the small forwarders below (resolved when
   called, so load order only matters for js/views.js, which assembles Views). */
(function (V) {
    'use strict';

    // ----- from the other parts -----
    function buildTopMenu() { return V.buildTopMenu.apply(null, arguments); }   // core
    function confirm() { return V.confirm.apply(null, arguments); }   // core
    function buildRow() { return V.buildRow.apply(null, arguments); }   // home
    function posterCard() { return V.posterCard.apply(null, arguments); }   // core
    function peopleCard() { return V.peopleCard.apply(null, arguments); }   // detail
    function scr() { return V.scr.apply(null, arguments); }   // core

    // ================= SEARCH =================
    var SEARCH_HIST_KEY = 'stremiok.searchhist';
    var SEARCH_HIST_MAX = 5;
    var IME_DONE = 65376;   // Tizen on-screen keyboard "Done"
    var _search = null;     // { input, go, recent } of the rendered search screen

    // A link to play: http(s) only (no name:password@), else what's wrong with it.
    function linkProblem(text) {
        var why = U.urlProblem ? U.urlProblem(text) : (U.parseUrl(text) ? null : 'Not a link');
        return why ? why + ' (a link starts with https:// or http://)' : null;
    }
    // Played as it is (nothing recorded): a YouTube video's page through StremioK's YouTube
    // service, anything else straight to the player.
    function playLink(text) {
        var p = U.parseUrl(text);
        if (!p) { U.toast('That isn’t a link StremioK can play'); return; }
        var url = p.href, back = function () { var s = scr('search'); Focus.setScope(s, s.querySelector('.play-link') || undefined); };
        var yt = url.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/) || url.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/);
        if (yt) {
            var page = 'https://www.youtube.com/watch?v=' + yt[1], gen = _gen;
            YTPlay.ensureService().then(function () {
                if (gen !== _gen) { return; }   // (Search left, or another search, meanwhile)
                Player.play({ url: YTPlay.resolverUrl(page, 1080, false, ''), variantUrl: YTPlay.resolverUrl(page), initialQualityHeight: 1080, yt: page,
                    type: 'movie', id: 'link:yt:' + yt[1], name: 'YouTube video', streams: [], link: true, private: true }, back);
            }, function () { if (gen === _gen) { U.toast(YTPlay.unavailableMessage('video'), 6000); } });
            return;
        }
        var name = '';
        try { name = decodeURIComponent((p.path || '').split('/').pop() || ''); } catch (e) { name = ''; }
        Player.play({ url: url, type: 'movie', id: 'link:' + url.length + ':' + url.slice(-40), name: (name || p.host || 'Link').slice(0, 120), streams: [], link: true, private: true }, back);
    }
    function searchHistory() { return U.store.get(SEARCH_HIST_KEY, []) || []; }
    function rememberSearch(q) {
        var lq = q.toLowerCase();
        var list = searchHistory().filter(function (x) { return ('' + x).toLowerCase() !== lq; });
        list.unshift(q);
        U.store.set(SEARCH_HIST_KEY, list.slice(0, SEARCH_HIST_MAX));
    }
    function forgetSearch(q) {
        U.store.set(SEARCH_HIST_KEY, searchHistory().filter(function (x) { return x !== q; }));
    }

    function renderSearch() {
        var s = scr('search');
        U.clear(s);
        s.appendChild(buildTopMenu('search'));   // shared top menu (UP reaches it; no Back button)

        var wrap = U.el('div', 'search-wrap');
        var bar = U.el('div', 'search-bar');

        var input = document.createElement('input');
        input.id = 'search-input';
        input.type = 'text';
        input.className = 'focusable';
        input.placeholder = hasPeople() ? 'Search movies, series & people…' : 'Search movies & series…';
        input.__onselect = function () { input.focus(); };
        var go = U.el('div', 'pill focusable search-go', 'Search');
        go.__onselect = function () { runSearch(input.value); };

        // Enter runs the search. The keyboard's Done moves focus to Search, so one OK
        // searches. No onchange — it fires on blur when moving to a result and would
        // re-run the search and steal focus.
        input.onkeydown = function (ev) {
            if (ev.keyCode === 13) { if (ev.stopPropagation) { ev.stopPropagation(); } runSearch(input.value); }
            else if (ev.keyCode === IME_DONE) { if (ev.stopPropagation) { ev.stopPropagation(); } Focus.setFocus(go); }
        };
        // Fallback when the keyboard closes without a Done key event: if focus is still
        // on the field (not moved elsewhere by the D-pad) and there's text, go to Search.
        input.addEventListener('blur', function () {
            setTimeout(function () {
                if (Focus.current() === input && ('' + input.value).trim()) { Focus.setFocus(go); }
            }, 0);
        }, false);
        bar.appendChild(input);
        bar.appendChild(go);
        // Search words from the phone: searched as soon as they arrive (Type it: the field)
        var fromPhone = U.el('div', 'pill focusable search-go search-phone', '▣  From phone');
        fromPhone.__onselect = function () {
            V.phoneEntry({ title: 'Search from your phone', what: 'search',
                onText: function (t) { input.value = t; runSearch(t); },
                onType: function () { Focus.setFocus(input); } });
        };
        bar.appendChild(fromPhone);
        // ▶ Play a link: typed, or sent from the phone (its QR)
        var link = U.el('div', 'pill focusable search-go play-link', '▶  Play a link');
        link.__onselect = function () {
            V.phoneEntry({ title: 'Play a link', what: 'link', typeTitle: 'Play a link', placeholder: 'https://…/film.mkv',
                hint: 'A video’s direct link (an MKV or MP4 file, an HLS .m3u8) or a YouTube video’s page. It plays as it is, and nothing about it is recorded.',
                validate: linkProblem, onText: playLink });
        };
        bar.appendChild(link);
        wrap.appendChild(bar);

        var results = U.el('div', 'search-results');
        results.id = 'search-results';
        results.appendChild(U.el('div', 'search-empty', 'Type a title and press OK on Search. Results come from every addon catalog that supports search.'));
        wrap.appendChild(results);

        // Recent searches use the space to the right of the results grid.
        var recent = U.el('div', 'search-recent');
        wrap.appendChild(recent);
        _search = { input: input, go: go, recent: recent };
        renderRecent(-1);

        // DOWN from the field goes to the results (or recents); from Search, the
        // recents directly below it (or results).
        function firstOf(a, b) { return function () { var t = a() || b(); if (t) { Focus.setFocus(t); return true; } return false; }; }
        function firstCard() { return results.querySelector('.card'); }
        function firstRecent() { return recent.querySelector('.recent-item'); }
        input.__navDOWN = firstOf(firstCard, firstRecent);
        go.__navDOWN = firstOf(firstRecent, firstCard);

        s.appendChild(wrap);
        Focus.setScope(s, input);
    }

    // Draw the recent-searches column. focusIdx >= 0 focuses that entry (or the
    // nearest remaining one, else the field) after a removal.
    function renderRecent(focusIdx) {
        if (!_search) { return; }
        var recent = _search.recent;
        U.clear(recent);
        var list = searchHistory();
        if (list.length) { recent.appendChild(U.el('div', 'recent-title', 'Recent searches')); }
        list.forEach(function (q, i) {
            var it = U.el('div', 'recent-item focusable', q);
            it.__onselect = function () { _search.input.value = q; Focus.setFocus(_search.go); };
            it.__onlongpress = function () {
                confirm('Remove “' + q + '” from recent searches?', 'Remove', function () {
                    forgetSearch(q);
                    renderRecent(i);
                });
            };
            recent.appendChild(it);
        });
        if (focusIdx >= 0) {
            var items = recent.querySelectorAll('.recent-item');
            Focus.setFocus(items[Math.min(focusIdx, items.length - 1)] || _search.input);
        }
    }

    // Results come as one row per search source (Stremio.searchSources): each searchable
    // catalog ("Series · Popular · Cinemeta"), IPTV's groups as one per type, in the order
    // and with the ones shown in Settings > Appearance > Search results; each row in its
    // addon's own order (its best match first). A row appears as its catalog answers, in its
    // place; one whose catalog pages loads more as focus nears its end.
    var LOAD_AHEAD = 6;
    var _gen = 0;
    // A search's requests: stopped when another search starts or Search is left.
    var _searchCancel = null;
    // (left: what's still to come for it — a row, the next page, a link's video — changes nothing)
    function leaveSearch() { _gen++; if (_searchCancel) { _searchCancel.cancel(); _searchCancel = null; } }
    function fetchRow(def, query, skip) {
        var extra = { search: query }, cancel = _searchCancel;
        if (skip) { extra.skip = skip; }
        return Promise.all(def.cats.map(function (c) {
            return Stremio.getCatalog(c, extra, cancel).then(function (m) { return m || []; }, function (e) { if (def.cats.length === 1) { throw e; } return []; });
        })).then(function (lists) {
            var all = [].concat.apply([], lists);
            all.stale = lists.some(function (l) { return l && l.stale; });   // (an addon sent nothing: its titles from earlier)
            return all;
        });
    }
    function runSearch(query) {
        query = ('' + query).trim();
        var results = U.byId('search-results');
        if (!query) { return; }
        rememberSearch(query);
        renderRecent(-1);
        U.clear(results);
        results.scrollTop = 0;
        // While sources answer: a line above the rows ("Searching “fast”…  2 of 5 sources
        // answered"); the rows that are in can be browsed meanwhile. It goes when all have
        // answered, or names the ones that didn't.
        var status = U.el('div', 'search-status');
        status.appendChild(U.el('span', 'spin spin-small'));
        var statusText = U.el('span', 'search-status-text', 'Searching “' + query + '”…');
        status.appendChild(statusText);
        results.appendChild(status);
        leaveSearch();
        _searchCancel = U.cancelToken ? U.cancelToken() : null;
        var gen = ++_gen, focused = false, found = 0, failed = 0, answered = 0, total = 0, silent = [];
        function progress() {
            if (gen !== _gen) { return; }
            statusText.textContent = 'Searching “' + query + '”…   ' + answered + ' of ' + total + ' source' + (total === 1 ? '' : 's') + ' answered';
        }
        Stremio.searchSourcesForSearch().then(function (defs) {
            if (gen !== _gen) { return; }
            var slots = defs.map(function () { var sl = U.el('div', 'search-slot'); results.appendChild(sl); return sl; });
            var people = hasPeople() ? U.el('div', 'search-slot') : null;
            if (people) { results.appendChild(people); }
            total = defs.length + (people ? 1 : 0);
            progress();
            function shown(cards) {   // the first row to arrive gets focus; the rest fall in around it
                found++;
                if (!focused) {
                    focused = true;
                    if (Focus.current() === _search.input || Focus.current() === _search.go || !Focus.current()) { Focus.setScope(scr('search'), cards[0]); }
                }
            }
            function done(ok, name) { answered++; if (!ok) { silent.push(name); } progress(); }
            var tasks = defs.map(function (def, i) {
                return function () {
                    if (gen !== _gen) { return null; }   // (waiting its turn when Search was left: not asked)
                    return fetchRow(def, query, 0).then(function (metas) {
                        if (gen !== _gen) { return; }
                        var st = { def: def, query: query, seen: {}, count: 0, loading: false, done: !def.pages };
                        var cards = addCards(st, metas);
                        done(true);
                        if (!cards.length) { return; }
                        var row = buildRow(def.title + (metas.stale ? '  ·  from earlier: the addon sent nothing just now' : ''), cards);
                        row.__search = st;
                        slots[i].appendChild(row);
                        shown(cards);
                    }, function () { if (gen !== _gen) { return; } failed++; done(false, def.title); });
                };
            });
            // People (TMDB): first when the best match is called what you typed, else last
            if (people) {
                tasks.unshift(function () {
                    if (gen !== _gen) { return null; }
                    return Stremio.tmdbPeople(query, 1, _searchCancel).then(function (r) {
                        if (gen !== _gen) { return; }
                        done(true);
                        var st = { def: { people: true, title: 'People' }, query: query, seen: {}, count: 0, page: 1, loading: false, done: r.page >= r.pages };
                        var cards = addCards(st, r.people);
                        if (!cards.length) { return; }
                        var row = buildRow('People', cards);
                        row.__search = st;
                        people.appendChild(row);
                        if (sameName(r.people[0].name, query)) { results.insertBefore(people, results.firstChild); }
                        shown(cards);
                    }, function () { if (gen === _gen) { done(false, 'People (TMDB)'); } });   // (no TMDB answer: the titles are still there)
                });
            }
            U.settleAll(tasks, 4).then(function () {
                if (gen !== _gen) { return; }
                if (silent.length && found) {   // some rows are in: say which sources didn't answer
                    status.className = 'search-status search-status-warn';
                    U.clear(status);
                    status.appendChild(U.el('span', 'search-status-text', 'No answer from: ' + silent.join(',  ') + '   (try the search again)'));
                } else if (status.parentNode) {
                    status.parentNode.removeChild(status);
                }
                if (!found) {
                    results.appendChild(U.el('div', 'search-empty', (failed && failed === defs.length) ? 'Search failed. Check your network.'
                        : (!defs.length && !people) ? 'Nothing to search: no addon can, or all are hidden (Settings › Appearance › Search results).'
                        : 'No results for “' + query + '”.' + (silent.length ? '  No answer from: ' + silent.join(',  ') + ' (try again).' : '')));
                }
            });
        }, function () {
            if (gen !== _gen) { return; }
            if (status.parentNode) { status.parentNode.removeChild(status); }
            results.appendChild(U.el('div', 'search-empty', 'Search failed. Check your network.'));
        });
    }
    // Cards for the new titles of a row (a title twice in one row shows once); people for
    // the People row.
    function addCards(st, metas) {
        var out = [];
        (metas || []).forEach(function (m) {
            if (!m || !m.id || st.seen[m.id]) { return; }
            st.seen[m.id] = 1;
            st.count++;
            out.push(st.def.people ? peopleCard(m) : posterCard(m, m.type || st.def.cats[0].type || 'movie'));
        });
        return out;
    }
    // People search: with a TMDB key (Settings › Content › Integrations).
    function hasPeople() { return !!(Stremio.hasTmdb && Stremio.hasTmdb() && Stremio.tmdbPeople); }
    // Is this person called what was typed? Every word of it in their name, in any case,
    // with or without accents and dots ("michael j fox" = "Michael J. Fox"); one word only
    // when that's their whole name ("Zendaya"), so "Dune" isn't taken for "Dune Smith".
    function plain(t) {
        t = ('' + t).toLowerCase();
        try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
        return t.replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim();
    }
    function sameName(name, query) {
        var words = plain(name).split(' '), q = plain(query).split(' ');
        if (!q.length || q[0] === '' || (q.length === 1 && words.length > 1)) { return false; }
        return q.every(function (w) { return words.indexOf(w) !== -1; });
    }
    // The next page of a row, when focus gets near its end.
    function loadMore(row) {
        var st = row.__search;
        if (!st || st.loading || st.done) { return; }
        st.loading = true;
        var gen = _gen;
        if (st.def.people) {   // TMDB's next page of people
            Stremio.tmdbPeople(st.query, st.page + 1, _searchCancel).then(function (r) {
                st.loading = false;
                if (gen !== _gen) { return; }
                st.page = r.page;
                if (r.page >= r.pages) { st.done = true; }
                var cards = addCards(st, r.people), scroller = row.querySelector('.row-scroller');
                if (!cards.length) { st.done = true; return; }
                cards.forEach(function (k) { scroller.appendChild(k); });
            }, function () { st.loading = false; st.done = true; });
            return;
        }
        fetchRow(st.def, st.query, st.count).then(function (metas) {
            st.loading = false;
            if (gen !== _gen) { return; }
            var cards = addCards(st, metas), scroller = row.querySelector('.row-scroller');
            if (!cards.length) { st.done = true; return; }
            cards.forEach(function (k) { scroller.appendChild(k); });
        }, function () { st.loading = false; st.done = true; });
    }
    Focus.onFocus(function (node) {
        var s = scr('search');
        if (!node || !s || !s.contains(node) || (node.className || '').indexOf('card') === -1) { return; }
        var row = node.parentNode && node.parentNode.parentNode;
        if (!row || !row.__search) { return; }
        // (a NodeList: loop, no indexOf on Chromium 47)
        var cards = row.querySelectorAll('.card');
        for (var i = cards.length - 1; i >= 0 && i >= cards.length - LOAD_AHEAD; i--) {
            if (cards[i] === node) { loadMore(row); break; }
        }
    });

    // ----- published for the other parts (and js/views.js) -----
    V.renderSearch = renderSearch;
    V.leaveSearch = leaveSearch;
    // Search for these words, as if typed (a person named by an addon, from a title page).
    V.searchFor = function (q) { var i = U.byId('search-input'); if (i) { i.value = q; } runSearch(q); };
})(ViewParts);
