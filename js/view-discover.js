/* Views, part 6 of 6 — Discover: browse any catalog in full, by type, catalog and genre /
   year, page by page; and people (TMDB), by name.
   Parts share one namespace, ViewParts (V): each part publishes the functions the
   others use, and borrows theirs through the small forwarders below (resolved when
   called, so load order only matters for js/views.js, which assembles Views). */
(function (V) {
    'use strict';

    // ----- from the other parts -----
    function buildTopMenu() { return V.buildTopMenu.apply(null, arguments); }   // core
    function fillInfoBox() { return V.fillInfoBox.apply(null, arguments); }   // home
    function pickList() { return V.pickList.apply(null, arguments); }   // core
    function posterCard() { return V.posterCard.apply(null, arguments); }   // core
    function peopleCard() { return V.peopleCard.apply(null, arguments); }   // detail
    function scr() { return V.scr.apply(null, arguments); }   // core

    var DISCOVER_KEY = 'stremiok.discover';   // the last type / catalog / genre, for next time
    var TYPE_ORDER = ['movie', 'series', 'tv', 'radio', 'sport', 'people'];
    var LOAD_AHEAD = 16;                       // load the next page when focus is this close to the end
    // Genres that came back empty. Addons can list genres their catalog has nothing in
    // (MediaFusion's Live TV offers every TV genre in its database, including ones only
    // other catalogs or dead channels have); those are left out of the picker for a day.
    var EMPTY_KEY = 'stremiok.discoverempty', EMPTY_TTL = 24 * 3600 * 1000, SHOW_ALL = '\u0000all';
    var IME_DONE = 65376;                      // Tizen on-screen keyboard "Done"
    var _dv = null;   // { cats, allCats, type, cat, value, query, items, seen, loading, done, gen, focusFirst, error, page }

    // People (with a TMDB key): a type of its own, with one "catalog", TMDB's. Popular people
    // until you search a name; OK on one opens their page (their movies and series). Shaped
    // like an addon's catalog, so the pickers, search field, paging and focus work as they do
    // for titles; loadMore asks TMDB a page at a time (Stremio.tmdbPeople).
    var PEOPLE = { type: 'people', id: 'people', name: 'Popular', label: 'Popular', __people: true,
        addon: { url: 'tmdb:people', base: 'tmdb:people', __local: true, manifest: { id: 'tmdb.people', name: 'TMDB' } },
        def: { extra: [{ name: 'search' }, { name: 'skip' }] } };
    function withPeople(cats) {
        return (Stremio.hasTmdb && Stremio.hasTmdb() && Stremio.tmdbPeople) ? cats.concat([PEOPLE]) : cats;
    }
    // Browse (with a TMDB key): Trending, Popular, and each streaming service in your country,
    // for movies and series, TMDB's. Shaped like an addon's catalogs too (the Genre filter,
    // paging), loaded by loadTmdb; their titles open through their IMDb id (tmdbCard).
    var TMDB_ADDON = { url: 'tmdb:browse', base: 'tmdb:browse', __local: true, manifest: { id: 'tmdb.browse', name: 'TMDB' } };
    function browseCat(type, id, label, how) {
        var kind = type === 'series' ? 'tv' : 'movie';
        var extra = how.list === 'trending' ? [{ name: 'skip' }] : [{ name: 'genre', options: Stremio.tmdbGenres(kind) }, { name: 'skip' }];
        return { type: type, id: 'tmdb_' + id, name: label, label: label, __tmdb: { kind: kind, how: how }, addon: TMDB_ADDON, def: { extra: extra } };
    }
    var _provAsked = {};
    function withBrowse(cats) {
        if (!(Stremio.hasTmdb && Stremio.hasTmdb() && Stremio.tmdbBrowse)) { return cats; }
        var out = cats.slice();
        ['movie', 'series'].forEach(function (type) {
            var kind = type === 'series' ? 'tv' : 'movie';
            out.push(browseCat(type, 'trending', 'Trending this week', { list: 'trending' }));
            out.push(browseCat(type, 'popular', 'Popular', { list: 'popular' }));
            var provs = Stremio.tmdbProvidersKept(kind);
            if (provs) { provs.forEach(function (p) { out.push(browseCat(type, 'p' + p.id, 'On ' + p.name, { list: 'provider', provider: p.id })); }); }
            else if (!_provAsked[kind]) {   // (asked once: when they come, Discover is drawn again with them)
                _provAsked[kind] = true;
                Stremio.tmdbProviders(kind).then(function (list) {
                    if (list.length && scr('discover').className.indexOf('hidden') === -1) { renderDiscover(); }
                }, function () { _provAsked[kind] = false; });
            }
        });
        return out;
    }
    function extras(cats) { return withPeople(withBrowse(cats)); }
    // What the catalog list is made of (addon, catalog, its name and options): Discover keeps
    // its list for the session, and draws it again when this changes (an addon added, removed
    // or refreshed, its link changed, a playlist on or off, a TMDB key added or removed).
    function catsSig(cats) {
        return (cats || []).map(function (c) {
            return [c.type, c.id, (c.addon && (c.addon.base || c.addon.url)) || '', c.label || '', JSON.stringify((c.def && c.def.extra) || [])].join('\u0001');
        }).join('\u0002');
    }

    // Catalogs Discover can page through: all except those that need something other than
    // a genre / year to answer (search-only catalogs, "calendar" / "last videos" feeds).
    function browsable(c) {
        var def = c.def || {}, extra = def.extra || [];
        for (var i = 0; i < extra.length; i++) {
            if (extra[i] && extra[i].isRequired && extra[i].name !== 'genre') { return false; }
        }
        return !(def.extraRequired || []).some(function (n) { return n !== 'genre'; });
    }
    // The catalog's genre (or year) filter: { options, required, label } or null.
    function genreFilter(c) {
        var def = c.def || {}, extra = def.extra || [], opts = null, required = false;
        for (var i = 0; i < extra.length; i++) {
            if (extra[i] && extra[i].name === 'genre') { opts = extra[i].options || []; required = !!extra[i].isRequired; }
        }
        if (!opts && def.genres) { opts = def.genres; required = (def.extraRequired || []).indexOf('genre') !== -1; }
        if (!opts || !opts.length) { return null; }
        var years = opts.every(function (o) { return /^\d{4}$/.test('' + o); });
        return { options: opts, required: required, label: years ? 'Year' : 'Genre' };
    }
    // Where a search in this catalog goes: the catalog itself when it takes an optional
    // search (IPTV's do), else its addon's search catalog for the same type (a genre doesn't
    // apply there); null when there's neither (no search field then).
    function hasSearch(c, required) {
        var def = c.def || {};
        return (def.extra || []).some(function (e) { return e && e.name === 'search' && !!e.isRequired === required; }) ||
            (!required && (def.extraSupported || []).indexOf('search') !== -1 && (def.extraRequired || []).indexOf('search') === -1);
    }
    function searchTarget(c) {
        if (!c) { return null; }
        if (hasSearch(c, false)) { return { cat: c, genre: true }; }
        var sib = (_dv.allCats || []).filter(function (x) {
            return x.type === c.type && x.addon === c.addon && (hasSearch(x, true) || ((x.def || {}).extraRequired || []).indexOf('search') !== -1);
        })[0];
        return sib ? { cat: sib, genre: false } : null;
    }
    function pages(c) {
        if (c.addon && c.addon.__local) { return true; }   // IPTV: 100 channels at a time
        var def = c.def || {};
        return (def.extra || []).some(function (e) { return e && e.name === 'skip'; }) ||
            (def.extraSupported || []).indexOf('skip') !== -1;
    }
    function typesOf(cats) {
        var seen = {}, out = [];
        cats.forEach(function (c) { if (!seen[c.type]) { seen[c.type] = 1; out.push(c.type); } });
        out.sort(function (a, b) {
            var ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
        });
        return out;
    }
    // Genres that came back empty lately: { 'catalog|genre': { t: when last, n: how many times
    // in a row } } (a plain time: saved by 1.9.15 and before, once). Left out of the list at twice.
    function emptyGenres() {
        var all = U.store.get(EMPTY_KEY, {}) || {}, now = Date.now(), out = {};
        Object.keys(all).forEach(function (k) {
            var e = all[k], t = typeof e === 'number' ? e : (e && e.t) || 0;
            if (now - t < EMPTY_TTL) { out[k] = { t: t, n: (typeof e === 'number' ? 1 : (e && e.n) || 1) }; }
        });
        return out;
    }
    function leftOut(e) { return !!e && e.n >= 2; }
    // A genre as shown: without the ending of the web page an addon took it from ("Wit Studio -
    // Companies - MyAnimeList.net": "Wit Studio"); the addon still gets the name it listed.
    var PAGE_END = /(?:\s+[-–|]\s+[^-–|]{1,40})?\s+[-–|]\s+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:net|com|org|io|tv|jp)$/i;
    function genreLabel(v) { var s = '' + v; return s.replace(PAGE_END, '') || s; }
    function markEmpty(cat, value, empty) {
        var all = emptyGenres(), k = Stremio.catalogKey(cat) + '|' + value;
        if (empty) { all[k] = { t: Date.now(), n: (all[k] ? all[k].n : 0) + 1 }; } else if (all[k]) { delete all[k]; } else { return; }
        U.store.set(EMPTY_KEY, all);
    }
    function catLabel(c) { return c.label + '  ·  ' + ((c.addon.manifest && c.addon.manifest.name) || 'Addon'); }
    function save() {
        U.store.set(DISCOVER_KEY, { type: _dv.type, cat: Stremio.catalogKey(_dv.cat), value: _dv.value || '' });
    }
    function choose(type, cat, value) {
        var was = _dv.cat;
        _dv.type = type;
        _dv.cat = cat || _dv.cats.filter(function (c) { return c.type === type; })[0];
        if (_dv.cat !== was) { _dv.query = ''; }   // a search belongs to its catalog
        var f = genreFilter(_dv.cat);
        _dv.value = (value !== undefined) ? value : (f && f.required ? f.options[0] : '');
        if (f && _dv.value && f.options.indexOf(_dv.value) === -1) { _dv.value = f.required ? f.options[0] : ''; }
        save();
    }

    function renderDiscover() {
        var s = scr('discover');
        U.clear(s);
        s.appendChild(buildTopMenu('discover'));
        s.appendChild(U.el('div', 'discover-bar'));
        var info = U.el('div', 'home-info discover-info');
        info.appendChild(U.el('div', 'home-info-title'));
        info.appendChild(U.el('div', 'home-info-meta'));
        info.appendChild(U.el('div', 'home-info-desc'));
        s.appendChild(info);
        s.appendChild(U.el('div', 'discover-grid'));
        if (_dv && _dv.cats) {   // this session's catalog, as you left it
            var kept = _dv;
            Stremio.listCatalogs().then(function (all) {   // (unless the addons changed meanwhile: then afresh)
                if (_dv !== kept || catsSig(extras(all.filter(browsable))) === kept.sig) { return; }
                if (s.className.indexOf('hidden') !== -1) { _dv = null; return; }   // (left already: afresh next time)
                _dv = null;
                renderDiscover();
            }, function () {});
            drawBar(); drawGrid(); focusStart();
            // Focus onto this screen: the title you were on, else the first, else the Type
            // picker. (Reopened from another screen's top menu, focus stayed on that hidden
            // screen, and the remote seemed frozen until BACK.)
            if (!s.contains(Focus.current())) {
                var again = null, cards = s.querySelectorAll('.discover-grid .card');
                for (var i = 0; _dv.focusId && i < cards.length; i++) { if (cards[i].__meta && cards[i].__meta.id === _dv.focusId) { again = cards[i]; break; } }
                Focus.setScope(s, again || cards[0] || s.querySelector('.discover-bar .pill') || undefined);
            }
            return;
        }
        _dv = { cats: null, items: [], seen: {}, gen: 0, focusFirst: true };
        s.querySelector('.discover-grid').appendChild(U.el('div', 'row-empty', 'Loading…'));
        Focus.setScope(s, s.querySelector('.tab-pill.active') || undefined);
        Stremio.listCatalogs().then(function (all) {
            var cats = extras(all.filter(browsable));
            _dv.cats = cats;
            _dv.sig = catsSig(cats);
            _dv.allCats = extras(all);   // (search-only catalogs too: a catalog's search may go to one)
            if (!cats.length) { drawBar(); drawGrid(); return; }
            var last = U.store.get(DISCOVER_KEY, null), cat = null;
            if (last) { cat = cats.filter(function (c) { return Stremio.catalogKey(c) === last.cat; })[0] || null; }
            if (cat) { choose(cat.type, cat, last.value || undefined); } else { choose(typesOf(cats)[0]); }
            drawBar();
            startLoad();
        }, function () {
            _dv.cats = [];
            drawBar(); drawGrid();
        });
    }

    // Type · Catalog · Genre / Year pickers, and how much is loaded.
    function drawBar() {
        var s = scr('discover'), bar = s.querySelector('.discover-bar');
        U.clear(bar);
        if (!_dv.cats || !_dv.cats.length) { return; }
        function pill(text, onSelect) {
            var p = U.el('div', 'pill focusable', text);
            p.__onselect = onSelect;
            bar.appendChild(p);
            return p;
        }
        var types = typesOf(_dv.cats);
        pill('Type:  ' + Stremio.prettyType(_dv.type) + '  ▾', function () {
            pickList('Type', types.map(function (t) { return [t, Stremio.prettyType(t)]; }), _dv.type, function (t) {
                if (t === _dv.type) { return; }
                choose(t); reload();
            });
        });
        var ofType = _dv.cats.filter(function (c) { return c.type === _dv.type; });
        pill('Catalog:  ' + catLabel(_dv.cat) + '  ▾', function () {
            pickList('Catalog', ofType.map(function (c) { return [Stremio.catalogKey(c), catLabel(c)]; }), Stremio.catalogKey(_dv.cat), function (k) {
                var c = ofType.filter(function (x) { return Stremio.catalogKey(x) === k; })[0];
                if (!c || c === _dv.cat) { return; }
                choose(_dv.type, c); reload();
            });
        });
        var f = genreFilter(_dv.cat);
        if (f) {
            pill(f.label + ':  ' + (_dv.value ? genreLabel(_dv.value) : 'All') + '  ▾', function () { genrePicker(f, false); });
        }
        // Search this catalog: type, then OK / the keyboard's Done
        var target = searchTarget(_dv.cat);
        if (target) {
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'focusable discover-search';
            input.placeholder = _dv.cat.__people ? '🔍  Search a name' : '🔍  Search';
            input.value = _dv.query || '';
            input.__onselect = function () { input.focus(); };
            var apply = function () { setQuery(input.value); };
            input.onkeydown = function (ev) {
                if (ev.keyCode === 13 || ev.keyCode === IME_DONE) { if (ev.stopPropagation) { ev.stopPropagation(); } apply(); }
            };
            // the keyboard closed without Enter / Done: still on the field, with new text
            input.addEventListener('blur', function () {
                setTimeout(function () { if (Focus.current() === input && ('' + input.value).trim() !== (_dv.query || '')) { apply(); } }, 0);
            }, false);
            bar.appendChild(input);
            if (_dv.query) { pill('✕  Clear', function () { setQuery(''); }); }
        }
        bar.appendChild(U.el('div', 'discover-count'));
        updateCount();
    }
    // The Genre (or Year) list: the ones empty twice lately left out, with a row at the end that
    // lists them all again (all: that list).
    function genrePicker(f, all) {
        var gone = emptyGenres(), ck = Stremio.catalogKey(_dv.cat) + '|';
        var left = all ? [] : f.options.filter(function (o) { return leftOut(gone[ck + o]) && '' + o !== _dv.value; });
        var shown = f.options.filter(function (o) { return left.indexOf(o) === -1; });
        var opts = (f.required ? [] : [['', 'All']]).concat(shown.map(function (o) { return ['' + o, genreLabel(o)]; }));
        if (left.length) { opts.push([SHOW_ALL, 'Show ' + left.length + ' left out (empty lately)']); }
        pickList(f.label, opts, _dv.value || '', function (v) {
            if (v === SHOW_ALL) { genrePicker(f, true); return; }
            if (v === (_dv.value || '')) { return; }
            choose(_dv.type, _dv.cat, v); reload();
        });
    }
    function searchAddonName() {
        if (_dv.cat && _dv.cat.__people) { return 'TMDB'; }
        var t = searchTarget(_dv.cat), a = t && t.cat.addon;
        return (a && a.manifest && a.manifest.name) || 'The addon';
    }
    function setQuery(q) {
        q = ('' + (q || '')).trim();
        if (q === (_dv.query || '') && !_dv.error) { return; }   // (the same search again: only to retry one that failed)
        _dv.query = q;
        reload();
    }
    // Only the count changes while pages load: the pickers stay as they are (redrawing
    // them would pull focus out from under you if you're on one).
    function updateCount() {
        var el = scr('discover').querySelector('.discover-count');
        if (!el) { return; }
        var n = _dv.items.length;
        var what = _dv.query ? (n === 1 ? ' result' : ' results') + ' for “' + _dv.query + '”' : (_dv.cat && _dv.cat.__people ? (n === 1 ? ' person' : ' people') : ' titles');
        el.textContent = _dv.loading ? (n ? n + what + '  ·  loading more…' : (_dv.query ? 'Searching…' : 'Loading…'))
            : _dv.error ? (_dv.query ? 'Search failed' : 'Couldn’t load this catalog')
            : (_dv.done ? n + what : n + what + ' so far') + (_dv.stale ? '  ·  from earlier: the addon sent nothing just now' : '');
    }

    // A new type / catalog / filter: start over from its first page, then focus its first title.
    function reload() {
        drawBar();
        startLoad();
    }
    // A catalog's pages for what's chosen: stopped when the choice changes or Discover is left.
    var _dvCancel = null;
    function leaveDiscover() { if (_dvCancel) { _dvCancel.cancel(); _dvCancel = null; } }
    function startLoad() {
        leaveDiscover();
        _dvCancel = U.cancelToken ? U.cancelToken() : null;
        _dv.items = []; _dv.seen = {}; _dv.done = false; _dv.error = false; _dv.loading = false; _dv.offset = 0; _dv.page = 0; _dv.stale = false;
        _dv.gen++; _dv.focusFirst = true;
        drawGrid();
        loadMore();
    }

    // The grid. Only a window of it is on the page: at most WINDOW cards (whole rows),
    // items[_dv.offset …]. A long catalog (a MediaFusion Live TV has ~16,000 channels) never
    // puts thousands of cards on the page: scrolling on drops rows at the top, scrolling
    // back rebuilds them from what's loaded (no request), so the page stays small and the
    // remote quick. Cards know their neighbors by position (index ± columns), so moving
    // measures nothing.
    var WINDOW = 600;
    function gridEl() { return scr('discover').querySelector('.discover-grid'); }
    function cols() {
        var els = _dv.cardEls || [];
        if (_dv.cols && els.length > _dv.cols) { return _dv.cols; }
        if (els.length < 2) { return 1; }
        var top = els[0].getBoundingClientRect().top, n = 1;   // (the cards of the first row share its top)
        while (n < els.length && Math.abs(els[n].getBoundingClientRect().top - top) < 2) { n++; }
        if (n < els.length) { _dv.cols = n; }   // (known once a second row exists)
        return Math.max(1, n);
    }
    function rowHeight() {
        var els = _dv.cardEls, c = cols();
        return (els.length > c) ? (els[c].getBoundingClientRect().top - els[0].getBoundingClientRect().top) : 0;
    }
    function drawGrid() {
        var grid = gridEl();
        U.clear(grid);
        grid.scrollTop = 0;
        _dv.cardEls = []; _dv.cols = 0;
        if (_dv.offset === undefined || _dv.offset > _dv.items.length) { _dv.offset = 0; }
        if (_dv.cats && !_dv.cats.length) {
            grid.appendChild(U.el('div', 'row-empty', 'No catalogs to browse. Add catalog addons in Settings.'));
            return;
        }
        appendCards(_dv.items.slice(_dv.offset, _dv.offset + WINDOW));
        if (_dv.done && !_dv.items.length) {
            // (addons can answer nothing when they're busy, YouTubio among them: a way to ask again)
            var retry = U.el('div', 'pill focusable discover-retry', '↻  Try again');
            retry.__onselect = function () { reload(); };
            var empty = U.el('div', 'discover-empty');   // (the message, then the button under it: a line of their own, not cards)
            grid.appendChild(empty);
            empty.appendChild(U.el('div', 'row-empty', _dv.error ? (_dv.query ? searchAddonName() + ' didn’t answer this search (its search can be slow or busy). OK on the search field tries again.' : 'Couldn’t load this catalog.')
                : _dv.query ? (_dv.cat && _dv.cat.__people ? 'No one called “' + _dv.query + '” on TMDB.' : 'Nothing matches “' + _dv.query + '”.') : !_dv.value ? 'Nothing here.'
                : 'Nothing here. The addon lists “' + genreLabel(_dv.value) + '” but has nothing in it ' + (leftOut(emptyGenres()[Stremio.catalogKey(_dv.cat) + '|' + _dv.value])
                    ? 'again; it’s left out of the list for a day.' : 'just now.')));
            empty.appendChild(retry);
        }
    }
    function makeCard(m) {
        var card = m.__person ? peopleCard(m.__person) : m.__tmdbItem ? V.tmdbCard(m.__tmdbItem) : posterCard(m, _dv.cat.type);
        card.__navUP = function () { return upToPickers(card); };
        function at() { return _dv.cardEls.indexOf(card); }
        card.__goUP = function () {
            var k = at(), c = cols();
            if (k >= c) { return _dv.cardEls[k - c]; }
            if (_dv.offset > 0) { prependRows(); k = at(); return _dv.cardEls[k - c] || null; }
            return null;
        };
        card.__goDOWN = function () {
            var k = at(), c = cols(), els = _dv.cardEls;
            if (k + c < els.length) { return els[k + c]; }
            if (Math.floor(k / c) < Math.floor((els.length - 1) / c)) { return els[els.length - 1]; }   // (a shorter last row)
            return false;   // (more come as focus nears the end)
        };
        card.__goLEFT = function () { var k = at(); return (k % cols() === 0) ? false : _dv.cardEls[k - 1]; };
        card.__goRIGHT = function () { var k = at(), c = cols(); return ((k + 1) % c === 0 || k + 1 >= _dv.cardEls.length) ? false : _dv.cardEls[k + 1]; };
        return card;
    }
    function appendCards(metas) {
        var grid = gridEl();
        var empty = grid.querySelector('.row-empty');
        if (empty && metas.length) { grid.removeChild(empty); }
        metas.forEach(function (m) {
            var card = makeCard(m);
            grid.appendChild(card);
            _dv.cardEls.push(card);
        });
        trimTop();
    }
    // Over WINDOW: whole rows off the top, the grid scrolled up by as much (no jump).
    function trimTop() {
        var els = _dv.cardEls, c = cols();
        if (els.length <= WINDOW || !_dv.cols) { return; }
        var rows = Math.floor((els.length - WINDOW) / c), n = rows * c, h = rowHeight(), grid = gridEl();
        if (n <= 0) { return; }
        els.splice(0, n).forEach(function (el) { if (el.parentNode) { el.parentNode.removeChild(el); } });
        _dv.offset += n;
        grid.scrollTop = Math.max(0, grid.scrollTop - rows * h);
    }
    // Back above the window's top: rows rebuilt from what's loaded, the bottom dropped.
    var PREPEND_ROWS = 10;
    function prependRows() {
        var c = cols(), n = Math.min(_dv.offset, PREPEND_ROWS * c), grid = gridEl(), h = rowHeight();
        if (n <= 0) { return; }
        var first = _dv.cardEls[0], metas = _dv.items.slice(_dv.offset - n, _dv.offset), made = [];
        metas.forEach(function (m) { var card = makeCard(m); grid.insertBefore(card, first); made.push(card); });
        _dv.cardEls = made.concat(_dv.cardEls);
        _dv.offset -= n;
        grid.scrollTop += (n / c) * h;
        var extra = _dv.cardEls.length - WINDOW;   // (drop whole rows at the bottom; rebuilt from items when needed)
        if (extra > 0) {
            var cut = Math.floor(extra / c) * c;
            _dv.cardEls.splice(_dv.cardEls.length - cut, cut).forEach(function (el) { if (el.parentNode) { el.parentNode.removeChild(el); } });
        }
    }
    // Near the window's end: loaded items not on the page yet first, then the next page.
    function extendDown() {
        var shown = _dv.offset + _dv.cardEls.length;
        if (shown < _dv.items.length) { appendCards(_dv.items.slice(shown, shown + 100)); return; }
        loadMore();
    }

    // UP from the first row of titles lands on the pickers above: the one nearest across.
    // (Left to the plain spatial move, a title on the right is closer to the top menu than
    // to the pickers, which sit on the left, and UP would skip them.) Other rows: as usual;
    // the window's first row when rows above were dropped: those come back (see __goUP).
    function upToPickers(card) {
        if (_dv.offset > 0) { return false; }
        var s = scr('discover'), first = _dv.cardEls[0];
        var pills = s.querySelectorAll('.discover-bar .focusable');   // (the pickers, search field, Clear)
        if (!first || !pills.length) { return false; }
        var k = _dv.cardEls.indexOf(card);
        if (k >= cols()) { return false; }   // not the first row
        var r = card.getBoundingClientRect();
        var cx = r.left + r.width / 2, best = pills[0], bestD = Infinity;
        for (var i = 0; i < pills.length; i++) {
            var p = pills[i].getBoundingClientRect(), d = Math.abs(p.left + p.width / 2 - cx);
            if (d < bestD) { best = pills[i]; bestD = d; }
        }
        Focus.setFocus(best);
        return true;
    }

    // People: TMDB's next page (by page number: names can repeat across pages).
    function loadPeople() {
        var gen = _dv.gen, page = (_dv.page || 0) + 1;
        _dv.loading = true;
        updateCount();
        Stremio.tmdbPeople(_dv.query, page, _dvCancel).then(function (r) {
            if (gen !== _dv.gen) { return; }
            _dv.loading = false;
            _dv.page = page;
            var fresh = r.people.filter(function (p) {
                var id = 'person:' + p.id;
                if (_dv.seen[id]) { return false; }
                _dv.seen[id] = 1; return true;
            }).map(function (p) { return { id: 'person:' + p.id, type: 'people', name: p.name, __person: p }; });
            if (r.page >= r.pages || !r.people.length) { _dv.done = true; }
            gotItems(fresh);
        }, function () {
            if (gen !== _dv.gen) { return; }
            failed();
        });
    }
    function gotItems(fresh) {
        var reachesEnd = (_dv.offset + _dv.cardEls.length === _dv.items.length);   // (else they join as you scroll down, extendDown)
        _dv.items = _dv.items.concat(fresh);
        if (reachesEnd) { appendCards(fresh); }
        if (_dv.done && !_dv.items.length) { drawGrid(); }
        updateCount();
        focusStart();
    }
    function failed() {
        _dv.loading = false; _dv.done = true; _dv.error = !_dv.items.length;
        updateCount();
        if (!_dv.items.length) { drawGrid(); }
        focusStart();   // (a failed search: back on its field)
    }

    // The next page (catalogs that page) — skip = titles loaded so far, as Stremio does.
    function loadTmdb() {
        var gen = _dv.gen, page = (_dv.page || 0) + 1, t = _dv.cat.__tmdb;
        _dv.loading = true;
        updateCount();
        Stremio.tmdbBrowse(t.kind, { list: t.how.list, provider: t.how.provider, genre: _dv.value || '' }, page, _dvCancel).then(function (r) {
            if (gen !== _dv.gen) { return; }
            _dv.loading = false;
            _dv.page = page;
            var fresh = r.items.filter(function (it) {
                var id = 'tmdb:' + it.kind + ':' + it.tmdbId;
                if (_dv.seen[id]) { return false; }
                _dv.seen[id] = 1; return true;
            }).map(function (it) { return { id: 'tmdb:' + it.kind + ':' + it.tmdbId, type: it.type, name: it.name, poster: it.poster, background: it.background, releaseInfo: it.year, __tmdbItem: it }; });
            if (r.page >= r.pages || !r.items.length) { _dv.done = true; }
            gotItems(fresh);
        }, function () {
            if (gen !== _dv.gen) { return; }
            failed();
        });
    }
    function loadMore() {
        if (!_dv.cat || _dv.loading || _dv.done) { return; }
        if (_dv.cat.__people) { loadPeople(); return; }
        if (_dv.cat.__tmdb) { loadTmdb(); return; }
        var gen = _dv.gen, cat = _dv.cat, extra = {}, genre = true;
        if (_dv.query) {   // a search: in this catalog, or its addon's search catalog
            var t = searchTarget(cat);
            if (t) { cat = t.cat; genre = t.genre; extra.search = _dv.query; }
        }
        if (_dv.value && genre) { extra.genre = _dv.value; }
        if (_dv.items.length || (cat.addon && cat.addon.__local)) {
            if (_dv.items.length && !pages(cat)) { _dv.done = true; updateCount(); return; }
            extra.skip = _dv.items.length;
        }
        _dv.loading = true;
        updateCount();
        Stremio.getCatalog(cat, extra, _dvCancel).then(function (metas) {
            if (gen !== _dv.gen) { return; }
            _dv.loading = false;
            if (metas && metas.stale) { _dv.stale = true; }   // (the addon sent nothing: the titles from earlier)
            var fresh = (metas || []).filter(function (m) {
                if (!m || !m.id || _dv.seen[m.id]) { return false; }
                _dv.seen[m.id] = 1; return true;
            });
            if (!fresh.length || !pages(cat)) { _dv.done = true; }
            if (_dv.value && !_dv.query && !_dv.items.length) { markEmpty(cat, _dv.value, !fresh.length); }   // (first page)
            gotItems(fresh);
        }, function () {
            if (gen !== _dv.gen) { return; }
            failed();
        });
    }

    // After opening Discover or picking something new: the first title (or the Type picker
    // when there's nothing), unless you've moved on meanwhile.
    function focusStart() {
        var s = scr('discover');
        if (!_dv.focusFirst || s.className.indexOf('hidden') !== -1) { return; }
        var first = s.querySelector('.discover-grid .card');
        var cur = Focus.current();
        if (!first && _dv.loading) { return; }
        _dv.focusFirst = false;
        if (cur && s.contains(cur) && cur.className.indexOf('card') !== -1) { return; }
        // nothing found for a search: back on the field, to try again
        // (a search: its field, to type another; a catalog: ↻ Try again)
        Focus.setScope(s, first || (_dv.query && s.querySelector('.discover-search')) || s.querySelector('.discover-retry') || s.querySelector('.discover-bar .pill') || undefined);
    }

    // Focus near the end loads the next page; the strip describes the focused title.
    var _infoTimer = null;
    Focus.onFocus(function (node) {
        var s = scr('discover');
        if (!node || !s || !s.contains(node) || !_dv) { return; }
        var box = s.querySelector('.discover-info');
        if (node.className.indexOf('card') !== -1) {
            _dv.focusId = node.__meta && node.__meta.id;   // (to come back to it when Discover is reopened)
            // (a NodeList: no indexOf on the TV's Chromium 47, so look from the end)
            var cards = _dv.cardEls || [];
            for (var i = cards.length - 1; i >= 0 && i >= cards.length - LOAD_AHEAD; i--) {
                if (cards[i] === node) { extendDown(); break; }
            }
        }
        if (_infoTimer) { clearTimeout(_infoTimer); }
        _infoTimer = setTimeout(function () { _infoTimer = null; fillInfoBox(box, node.__meta); }, 120);
    });

    // ----- published for the other parts (and js/views.js) -----
    V.renderDiscover = renderDiscover;
    V.leaveDiscover = leaveDiscover;
})(ViewParts);
