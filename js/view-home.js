/* Views, part 2 of 6 — Home: tabs, catalog rows (loading, saved copy, refresh), the details strip, Continue Watching (one card per show, NEW badges).
   Parts share one namespace, ViewParts (V): each part publishes the functions the
   others use, and borrows theirs through the small forwarders below (resolved when
   called, so load order only matters for js/views.js, which assembles Views). */
(function (V) {
    'use strict';

    // ----- from the other parts -----
    function _current() { return V._current.apply(null, arguments); }   // core
    function buildTopMenu() { return V.buildTopMenu.apply(null, arguments); }   // core
    function closeModal() { return V.closeModal.apply(null, arguments); }   // core
    function isModalOpen() { return V.isModalOpen.apply(null, arguments); }   // core
    function confirm() { return V.confirm.apply(null, arguments); }   // core
    function pickList() { return V.pickList.apply(null, arguments); }   // core
    function posterCard() { return V.posterCard.apply(null, arguments); }   // core
    function scr() { return V.scr.apply(null, arguments); }   // core
    function showModal() { return V.showModal.apply(null, arguments); }   // core

    // ================= HOME =================
    // Home is split into tabs (pills at the top). Continue Watching is local; the
    // other three are the catalog rows of that Stremio type, in the user's
    // Home-Feeds order/visibility. A tab only appears when it has content.
    var HOME_TABS = [
        { key: 'continue', icon: '▶', label: 'Watching' },   // (Continue Watching: short, the menu is full)
        { key: 'calendar', icon: '📅', label: 'Calendar' },   // (coming up, and what you watched: see calendarRows)
        { key: 'movie', icon: '🎬', label: 'Movies' },
        { key: 'series', icon: '📺', label: 'Series' },
        { key: 'tv', icon: '📡', label: 'IPTV' },
        { key: 'radio', icon: '📻', label: 'Radio' },
        { key: 'sport', icon: '⚽', label: 'Sports' },
        { key: 'youtube', icon: '📹', label: 'YouTube' },   // (StremioK's YouTube catalogs, an addon's YouTube / channel ones: see isYouTubeCat)
        { key: 'local', icon: '💾', label: 'Local' }   // (a USB drive plugged in: see LocalMedia)
    ];
    function hasLocal() { return typeof LocalMedia !== 'undefined' && LocalMedia.present(); }

    // Which tabs to show in the top menu (needs the home catalogs; falls back to the
    // standard set before they've loaded so the menu is consistent everywhere).
    // Tabs you hid (Settings › Appearance › Home tabs) aren't shown; Watching always is.
    function availableTabs() {
        var hidden = Stremio.getPrefs().hiddenTabs || [];
        function shown(t) { return t.key === 'continue' || hidden.indexOf(t.key) === -1; }
        if (_homeCatalogs === null || _homeFirstLoad) {   // first load still running
            return HOME_TABS.filter(function (t) { return shown(t) && (t.key !== 'local' || hasLocal()); });
        }
        return HOME_TABS.filter(function (t) {
            return shown(t) && (t.key === 'continue' || t.key === 'calendar' || (t.key === 'local' ? hasLocal() : catsForTab(t.key).length > 0));
        });
    }

    // YouTube's tab: StremioK's own YouTube catalogs (whatever type you gave one: "Podcasts"),
    // and another addon's YouTube or channel catalogs (YouTubio's "YouTube", Stremio's "channel").
    function isYouTubeCat(c) {
        var m = c.addon && c.addon.manifest;
        return !!(m && m.id === 'org.stremiok.youtube') || /^(youtube|channel)$/i.test('' + c.type);
    }
    // Which cached catalogs belong to a tab. Sports, radio and YouTube have dedicated tabs;
    // IPTV is the catch-all for every other live source (tv, …).
    function catsForTab(key) {
        return (_homeCatalogs || []).filter(function (c) {
            if (key === 'youtube') { return isYouTubeCat(c); }
            if (isYouTubeCat(c)) { return false; }
            if (key === 'movie') { return c.type === 'movie'; }
            if (key === 'series') { return c.type === 'series'; }
            if (key === 'sport') { return c.type === 'sport'; }
            if (key === 'radio') { return c.type === 'radio'; }
            if (key === 'tv') {
                return c.type !== 'movie' && c.type !== 'series' &&
                    c.type !== 'sport' && c.type !== 'radio';
            }
            return false;
        });
    }
    var _homeCatalogs = null;   // [{name,type,metas}] — fetched once per session, filtered per tab
    var _homeTab = null;        // active tab key
    var _homeDirty = false;     // set when Continue Watching / poster / addons changed
    // Picking a tab (or opening the app) puts focus on the tab's first title. 'new' for the
    // render right after the pick; 'pending' while that tab's rows are still loading, kept
    // only as long as focus stays on the tab's pill, so it never pulls focus from elsewhere.
    var _focusFirstCard = 'new';
    var _tabRows = {};          // tab key -> built .rows element, re-attached on tab switches until Home is dirty
    var ROW_BATCH = 6;          // catalog rows rendered up front; more are added as focus nears the bottom

    // Home rows are reloaded when Home is (re)entered and they're older than this, so
    // catalogs that change on the addon side (a library, a watchlist) stay current even
    // though the TV keeps the app running for days.
    var HOME_MAX_AGE = 15 * 60 * 1000;
    var _homeLoadedAt = 0;
    var _homeLoading = false;

    function markHomeDirty() { _homeDirty = true; }
    function homeStale() {
        return _homeCatalogs !== null && !_homeLoading && Date.now() - _homeLoadedAt > HOME_MAX_AGE;
    }
    function homeDirty() { return _homeDirty || homeStale(); }
    function clearCatalogCache() { _homeCatalogs = null; _homeDirty = true; _reloadOnly = null; U.store.remove(HOME_SNAP_KEY); if (U.bigStore) { U.bigStore.remove(HOME_CACHE_KEY); } }
    // One addon added, refreshed or removed (or an IPTV playlist changed, or the feeds
    // reordered): reload just its rows; every other row keeps what it has, with no request.
    // url: the addon ('local:iptv' for IPTV); none: nothing to fetch (only the set / order
    // of rows changed). Calls before the reload runs add up.
    var _reloadOnly = null;   // { addon url: 1 } for the next reload, else a full one
    function refreshAddonRows(url) {
        if (_homeCatalogs === null) { clearCatalogCache(); return; }   // nothing loaded yet: a full load anyway
        _reloadOnly = _reloadOnly || {};
        if (url) { _reloadOnly[url] = 1; }
        _homeDirty = true;
        if (_current() === scr('home') && !isModalOpen() && !Player.isActive()) { loadHomeCatalogs(); }
    }

    // The Home rows are also saved on the TV, trimmed to what a card and the details strip
    // use, so a launch shows the last rows at once and refreshes them in the background
    // (as the 15-minute refresh does). Saved rows are only used with the same addons.
    // Two copies: a small snapshot for the launch (SNAP_ROWS rows of SNAP_CARDS cards, just
    // what a card shows) in the settings storage, read at once; and the whole (HOME_ROWS_MAX
    // rows, about HOME_BYTES_MAX) in the TV's database, written without holding up the remote,
    // which takes the snapshot's place a moment later if nothing fresh has come yet.
    var HOME_CACHE_KEY = 'stremiok.homecache', HOME_SNAP_KEY = 'stremiok.homesnap';
    var HOME_ROWS_MAX = 60, HOME_BYTES_MAX = 1500000, SNAP_ROWS = 40, SNAP_CARDS = 20;
    var SNAP_FIELDS = ['poster', 'background', 'posterShape', 'imdbRating'];   // (a rating: Ratings on posters)
    var CACHE_FIELDS = ['poster', 'background', 'thumbnail', 'logo', 'posterShape', 'releaseInfo', 'year', 'runtime', 'imdbRating'];
    function trimMeta(m) {
        var o = { id: m.id, type: m.type, name: m.name || m.title || '' };
        CACHE_FIELDS.forEach(function (k) { if (m[k] != null && m[k] !== '') { o[k] = m[k]; } });
        if (m.genres && m.genres.length) { o.genres = m.genres.slice(0, 3); }
        if (m.description) { o.description = ('' + m.description).slice(0, 320); }
        return o;
    }
    function addonsSig() { return Stremio.getAddonUrls().join('|'); }
    function sizeOf(o) {   // (about how many bytes a trimmed card takes saved)
        var n = 40;
        for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { n += k.length + ('' + o[k]).length + 6; } }
        return n;
    }
    // (written only when the rows changed; after a failed write, not again until the next launch:
    // copying ~1.5 MB into a database that refuses it, on every refresh, is wasted work)
    var _savedHomeSig = '', _homeSaveFailed = false;
    // A TV with little room (it gives an app a share of its free storage): a smaller copy.
    var SMALL_QUOTA = 50 * 1048576, HOME_BYTES_SMALL = 300000, _homeBytesMax = HOME_BYTES_MAX;
    if (U.bigStore && U.bigStore.quota) { U.bigStore.quota().then(function (q) { if (q && q.quota && q.quota < SMALL_QUOTA) { _homeBytesMax = HOME_BYTES_SMALL; } }); }
    function saveHomeCache() {
        var sig = addonsSig(), bytes = 0, cats = [];
        var what = sig + '#' + (_homeCatalogs || []).map(function (c) {
            var n = c.metas.length;
            return c.name + ':' + n + ':' + (n ? c.metas[0].id + ':' + c.metas[n - 1].id + ':' + (c.metas[0].poster || '') : '');
        }).join('|');
        if (what === _savedHomeSig) { return; }
        _savedHomeSig = what;
        (_homeCatalogs || []).slice(0, HOME_ROWS_MAX).forEach(function (c) {
            if (bytes > _homeBytesMax) { return; }
            var metas = c.metas.map(trimMeta);
            metas.forEach(function (m) { bytes += sizeOf(m); });
            if (bytes <= _homeBytesMax) { cats.push({ name: c.name, type: c.type, metas: metas }); }
        });
        if (U.bigStore && !_homeSaveFailed) {
            U.bigStore.set(HOME_CACHE_KEY, { sig: sig, cats: cats }).then(function (ok) { if (ok === false) { _homeSaveFailed = true; } });
        }
        U.store.set(HOME_SNAP_KEY, { sig: sig, cats: cats.slice(0, SNAP_ROWS).map(function (c) {
            return { name: c.name, type: c.type, metas: c.metas.slice(0, SNAP_CARDS).map(function (m) {
                var o = { id: m.id, type: m.type, name: m.name };
                SNAP_FIELDS.forEach(function (k) { if (m[k] != null) { o[k] = m[k]; } });
                return o;
            }) };
        }) });
    }
    function useHomeCache() {
        var c = U.store.get(HOME_SNAP_KEY, null, true), sig = addonsSig();
        if (!c || c.sig !== sig || !c.cats || !c.cats.length) { return false; }
        var snap = c.cats;
        _homeCatalogs = snap;
        _homeLoadedAt = 0;   // shown now, refreshed right away in the background
        if (U.bigStore) {
            U.bigStore.get(HOME_CACHE_KEY).then(function (full) {   // (the whole, unless fresh rows came first)
                if (!full || full.sig !== sig || !full.cats || !full.cats.length || _homeCatalogs !== snap) { return; }
                _homeCatalogs = full.cats;
                _homeDirty = true;   // (the rows built from the snapshot: rebuilt)
                if (_current() === scr('home') && !isModalOpen() && !_moving && !Player.isActive()) { renderHome(); } else { _homeDirty = true; }
            });
        }
        return true;
    }
    // StremioK back in the foreground: reload stale rows in the background.
    function refreshHomeIfStale() { if (homeStale()) { loadHomeCatalogs(); } }

    function menuItem(s, text) {
        var items = s.querySelectorAll('.home-header .focusable');
        for (var i = 0; i < items.length; i++) { if (items[i].textContent === text) { return items[i]; } }
        return null;
    }

    // Focus the tab's first title, or (none yet / tab empty, or preferPill) its pill.
    function focusHome(s, preferPill) {
        var firstCard = preferPill ? null : s.querySelector('.rows .card.focusable');
        Focus.setScope(s, firstCard || s.querySelector('.tab-pill.active') || undefined);
        return !!firstCard;
    }

    // The artwork the Home rows show for each title (the first row it's in, in your feed
    // order): id -> { poster, background }. Continue Watching uses it, so a show looks the
    // same there as in its row; what was saved at play time comes from the title's page
    // (often Cinemeta's plainer poster) and is only the fallback.
    var _art = null, _artFor = null;   // (kept until the rows change: they're replaced, never edited)
    function homeArt() {
        if (_art && _artFor === _homeCatalogs) { return _art; }
        var art = {};
        (_homeCatalogs || []).forEach(function (cat) {
            if (cat.type !== 'movie' && cat.type !== 'series') { return; }
            (cat.metas || []).forEach(function (m) {
                if (m && m.id && !art[m.id] && (m.poster || m.background)) { art[m.id] = { poster: m.poster, background: m.background }; }
            });
        });
        _art = art; _artFor = _homeCatalogs;
        return art;
    }

    // ----- Local: a USB drive's folders and videos (see LocalMedia) -----
    // One folder at a time, as a grid: its folders, then its videos (posters once matched to a
    // title). OK on a folder opens it, BACK goes up (then to the top menu as on any tab); OK on
    // a video plays it (a matched one through its title's page); long-press: match it by hand.
    var _local = { root: null, rel: '', listing: null, key: '', loading: '', error: '', focusRel: null };
    function localDrive() {
        var ds = LocalMedia.knownDrives();
        for (var i = 0; i < ds.length; i++) { if (ds[i].root === _local.root) { return ds[i]; } }
        return null;
    }
    function localTitle(d) {
        var name = LocalMedia.knownDrives().length > 1 ? 'USB · ' + d.label.replace(/^removable_/, '') : 'USB drive';
        return [name].concat(_local.rel ? _local.rel.split('/') : []).join('  ›  ');
    }
    function localRows(rows) {
        if (!LocalMedia.isRead()) {   // (read when the tab opens, not at launch)
            rows.appendChild(U.el('div', 'row-empty', 'Reading USB drives…'));
            LocalMedia.ensure().then(redrawLocal);
            return;
        }
        var ds = LocalMedia.knownDrives();
        if (!ds.length) { rows.appendChild(U.el('div', 'row-empty', 'No USB drive. Plug one into the TV.')); return; }
        downloadsList(rows);
        if (!localDrive()) { _local.root = ds.length === 1 ? ds[0].root : null; _local.rel = ''; _local.listing = null; _local.key = ''; }
        var d = localDrive();
        if (!d) {   // several drives: one card each
            rows.appendChild(buildGrid('USB drives', ds.map(function (x) {
                var c = posterCard({ id: 'drive:' + x.root, name: '💾  ' + x.label.replace(/^removable_/, '') }, 'local');
                c.className += ' local-folder';
                c.__onselect = function () { _local.root = x.root; _local.rel = ''; _local.listing = null; _local.key = ''; _local.focusRel = '__first'; renderHome(); };
                c.__onlongpress = null;
                c.__meta = { name: x.label, description: x.root };
                return c;
            })));
            return;
        }
        var key = d.root + '|' + _local.rel;
        if (_local.key !== key || !_local.listing) {
            if (_local.loading !== key) {
                _local.loading = key; _local.error = '';
                LocalMedia.list(d, _local.rel).then(function (r) {
                    if (_local.loading !== key) { return; }
                    _local.loading = ''; _local.key = key; _local.listing = r;
                    if (r.via === 'service') { U.log('local', localTitle(d) + ': listed through StremioK’s service (' + r.why + ')'); }
                    redrawLocal();
                    if (!LocalMedia.matchingAsked() && LocalMedia.wouldMatch(r.entries)) { askMatching(d, r.entries); }
                    else { LocalMedia.matchFolder(d, r.entries).then(function (n) { if (n) { redrawLocal(); } }); }
                }, function (e) {
                    if (_local.loading !== key) { return; }
                    _local.loading = ''; _local.key = key; _local.listing = { entries: [] }; _local.error = (e && e.message) || '' + e;
                    U.log('local', localTitle(d) + ': ' + _local.error);
                    redrawLocal();
                });
            }
            rows.appendChild(U.el('div', 'row-empty', 'Reading ' + localTitle(d) + '…'));
            return;
        }
        var all = _local.listing.entries;
        var hidden = LocalMedia.showHidden(), entries = all.filter(function (x) {
            return (hidden || !LocalMedia.isHidden(x.name)) && (x.dir || LocalMedia.isVideo(x.name) || (LocalMedia.isStandaloneSub && LocalMedia.isStandaloneSub(all, x)));
        });
        var cards = entries.map(function (x) { return x.dir ? localFolderCard(d, x) : LocalMedia.isVideo(x.name) ? localVideoCard(d, x) : localSubCard(d, x); });
        if (!_local.rel) { cards.unshift(indexCard(d)); }   // (the drive's top: index it, when you ask)
        var up = (_local.rel || LocalMedia.knownDrives().length > 1) ? localBackCard(d) : null;
        if (up) { cards.unshift(up); }   // (a card for BACK: easier with the arrows alone)
        if (cards.length) { rows.appendChild(buildGrid(localTitle(d), cards)); }
        if (!entries.length) {
            rows.appendChild(U.el('div', 'row-empty', (cards.length ? '' : localTitle(d) + ':  ') + (_local.error ? 'Couldn’t read this folder (' + _local.error + ').' : 'No videos or folders here.')));
        }
        if (_local.focusRel) { setTimeout(localFocus, 0); }   // (after Home's own focusing)
    }
    // Back up a folder, or back from playing: focus on that card; a folder just opened: on its
    // first item (not ⬆ Back or indexing). Looked up when it applies (the rows may have been
    // drawn again meanwhile: matches arriving), and tried again at the next drawing if absent.
    function localFocus() {
        var want = _local.focusRel;
        if (!want || _homeTab !== 'local' || _current() !== scr('home') || isModalOpen()) { return; }
        var all = scr('home').querySelectorAll('.rows .card'), hit = null;
        for (var i = 0; i < all.length && !hit; i++) {
            var id = all[i].getAttribute('data-id') || '';
            if (want === '__first' ? (id !== '..' && id.indexOf('index:') !== 0) : id === want) { hit = all[i]; }
        }
        if (!hit && want === '__first' && all.length) { hit = all[0]; }
        if (hit) { _local.focusRel = null; Focus.setScope(scr('home'), hit); }
    }
    // Stop indexing: said as it is — while it's listing the drive nothing new is kept yet (the
    // drive stays as it was indexed before, if it was); while matching, the listing and the
    // matches so far stay.
    function confirmStopIndexing(d, st, after) {
        confirm(st.phase === 'matching' ? 'Stop matching this drive’s videos? The listing and what’s been matched so far are kept; the rest can be matched later (Continue matching).'
            : 'Stop indexing this drive? It hasn’t been listed yet, so nothing new is kept: it stays as it was indexed before (if it was).',
            'Stop', function () { LocalMedia.stopScan(d); after(); }, { noLabel: 'Keep going', plain: true });
    }
    V.confirmStopIndexing = confirmStopIndexing;
    // The drive's index (so title pages know what's on it): read only when asked.
    function indexCard(d) {
        var st = LocalMedia.status(d), busy = st.state === 'scanning';
        var busyName = st.phase === 'matching' ? '⏳  Matching ' + st.done + ' / ' + st.total : '⏳  Listing the drive…';
        var c = posterCard({ id: 'index:' + d.root, name: busy ? busyName : st.state === 'none' ? '🔍  Index this drive' : st.left ? '🔍  Continue matching (' + st.left + ' left)' : '🔍  Index again' }, 'local');
        c.className += ' local-folder';
        c.__onlongpress = null;
        c.__meta = { name: 'Index this drive', description: (st.state === 'none' ? 'Not indexed yet. ' : st.state === 'failed' ? 'Indexing failed: ' + st.error + '. ' :
            busy ? 'Indexing… (OK: stop) ' : st.videos + ' videos, ' + st.matched + ' matched to titles, indexed ' + U.dayLabel(st.at) + '. ') +
            (LocalMedia.matchingAllowed() ? 'Indexing lists the drive’s videos and matches them to titles, so their title pages offer them (“On your USB drive”).'
                : 'Indexing lists the drive’s videos (matching them to titles is off: Settings › Content › USB drive).') };
        c.__onselect = function () {
            if (busy) { confirmStopIndexing(d, st, function () { renderHome(); }); return; }
            if (st.left) {
                pickList('Index this drive', [['more', 'Continue matching (' + st.left + ' titles left)'], ['again', 'Index again (list the drive afresh)']], 'more', function (k) {
                    _local.focusRel = 'index:' + d.root;
                    if (k === 'more') { LocalMedia.continueMatching(d); } else { LocalMedia.scan(d); }
                    renderHome();
                });
                return;
            }
            _local.focusRel = 'index:' + d.root;
            LocalMedia.scan(d).then(function () { var s2 = LocalMedia.status(d); U.toast(s2.state === 'failed' ? 'Indexing failed' : 'Indexed: ' + s2.videos + ' videos, ' + s2.matched + ' matched', 4000); });
            renderHome();
        };
        return c;
    }
    // Matching sends the titles worked out from the videos' names to your search addons: asked
    // once (until answered: again next launch), before anything is sent.
    var _askedMatching = false;
    function askMatching(d, entries) {
        if (_askedMatching || _homeTab !== 'local' || _current() !== scr('home') || isModalOpen() || Player.isActive()) { return; }
        _askedMatching = true;
        confirm('Match your videos to movies and series? Each one’s title is worked out from its name and looked up with your search addons, so they see those titles. Matched videos get posters and play as that title; without it, Local just browses. Settings › Content › USB drive changes this.',
            'Match', function () {
                LocalMedia.setMatching(true);
                LocalMedia.matchFolder(d, entries).then(function (n) { if (n) { redrawLocal(); } });
            }, { noLabel: 'Don’t match', plain: true, onNo: function () { LocalMedia.setMatching(false); } });
    }
    // ----- Downloads (js/downloads.js): at the top of the Local tab while it has any -----
    // Each: what it is, how far it's got, its speed and time left (or done, or what went wrong);
    // OK: Cancel / Retry / Remove from the list. Updated in place every few seconds (the tab is
    // drawn again only when one is added, removed or finishes).
    var _dlWatching = null, _dlShown = '', _dlRows = {};   // (key -> its status line, updated in place)
    function dlLine(x) {
        var pct = x.size ? Math.min(100, Math.floor(x.got / x.size * 100)) : 0;
        if (x.state === 'done') { return 'Done   ·   ' + (LocalMedia.humanSize(x.size || x.got) || '') + '   ·   in ' + x.dir.replace(/^\/opt\/media\//, ''); }
        if (x.state === 'failed') { return 'Didn’t finish: ' + (x.err || 'unknown') + '   ·   OK to retry'; }
        if (x.state === 'queued') { return 'Waiting for the one before it'; }
        if (x.state === 'waiting') { return 'Paused (' + (x.err || 'connection') + '), picked up again shortly   ·   ' + (pct ? pct + '%' : LocalMedia.humanSize(x.got)); }
        var left = x.speed > 0 && x.size ? Math.round((x.size - x.got) / x.speed / 60) : null;
        return (x.size ? pct + '%  of  ' + LocalMedia.humanSize(x.size) : LocalMedia.humanSize(x.got) + ' so far') +
            (x.speed > 0 ? '   ·   ' + (x.speed / 1048576).toFixed(1) + ' MB/s' : '') + (left != null ? '   ·   about ' + (left < 1 ? 'a minute' : left + ' min') + ' left' : '');
    }
    function dlSig(list) { return list.map(function (x) { return x.key + ':' + (x.state === 'done' || x.state === 'failed' ? x.state : 'on'); }).join('|'); }
    function downloadsList(rows) {
        if (typeof Downloads === 'undefined' || !Downloads.available()) { return; }
        if (!_dlWatching) {
            _dlWatching = Downloads.onChange(function () {
                if (_homeTab !== 'local' || _current() !== scr('home')) { if (_dlWatching) { _dlWatching(); _dlWatching = null; } return; }
                var list = Downloads.items(), box = scr('home').querySelector('.dl-list');
                if (dlSig(list) !== _dlShown) {   // (added, removed, finished: the tab drawn again)
                    var finished = list.some(function (x) { return x.state === 'done' && _dlShown.indexOf(x.key + ':on') !== -1 && x.kind === 'video'; });
                    if (finished) { _local.listing = null; _local.key = ''; }   // (the new file in its folder)
                    redrawLocal();
                    return;
                }
                if (!box) { return; }
                list.forEach(function (x) { var n = _dlRows[x.key]; if (n) { n.textContent = dlLine(x); } });
            });
            Downloads.watch();
            Downloads.sync();   // (now, not at its next turn)
        }
        var list = Downloads.items();
        _dlShown = dlSig(list); _dlRows = {};
        if (!list.length) { return; }
        var box = U.el('div', 'dl-list');
        box.appendChild(U.el('div', 'row-title', 'Downloads   ·   OK on one: cancel, retry or remove it'));
        list.slice().reverse().forEach(function (x) {
            var r = U.el('div', 'addon-item focusable dl-item ' + x.state);
            r.setAttribute('data-dl', x.key.replace(/"/g, ''));
            r.appendChild(U.el('div', 'a-name', (x.state === 'done' ? '✓  ' : x.state === 'failed' ? '⚠  ' : '⬇  ') + (x.kind === 'sub' ? x.name : (x.title || x.name))));
            var line = U.el('div', 'a-url', dlLine(x));
            _dlRows[x.key] = line;
            r.appendChild(line);
            // (focused: the file in the strip above — its name, size, where it goes, how it's going)
            r.__meta = { name: x.title || x.name, releaseInfo: (x.size ? LocalMedia.humanSize(x.size) : '') ,
                description: x.name + '   ·   ' + x.dir.replace(/^\/opt\/media\//, '') + '   ·   ' + dlLine(x) };
            r.__onselect = function () {
                var now = Downloads.items().filter(function (y) { return y.key === x.key; })[0] || x, opts = [];
                if (now.state === 'failed') { opts.push(['retry', 'Retry']); }
                if (now.state === 'queued' || now.state === 'downloading' || now.state === 'waiting') { opts.push(['cancel', 'Cancel (its partial file deleted)']); }
                opts.push(['clear', now.state === 'done' ? 'Remove from the list (the file stays)' : 'Remove from the list']);
                pickList(now.title || now.name, opts, null, function (k) {
                    if (k === 'retry') { Downloads.retry(now); }
                    else if (k === 'cancel') { confirm('Cancel “' + (now.title || now.name) + '”? What’s been downloaded is deleted.', 'Cancel it', function () { Downloads.cancel(now); }, { noLabel: 'Keep going' }); }
                    else { Downloads.clear(now); }
                });
            };
            box.appendChild(r);
        });
        rows.appendChild(box);
    }
    function redrawLocal() {
        if (_homeTab === 'local' && _current() === scr('home') && !isModalOpen() && !Player.isActive()) { renderHome(); }
    }
    function localFolderCard(d, x) {
        var c = posterCard({ id: x.rel, name: '📁  ' + x.name }, 'local');
        c.className += ' local-folder';
        c.__onlongpress = null;
        c.__meta = { name: x.name, description: 'Folder' + (x.bad ? '   ·   the TV can’t read its details' : '') };
        c.__onselect = function () { _local.rel = x.rel; _local.listing = null; _local.key = ''; _local.focusRel = '__first'; renderHome(); };
        return c;
    }
    // ⬆ Back: up a folder (from a drive's top, to the drives), as BACK does.
    function localBackCard(d) {
        var parent = _local.rel ? (_local.rel.indexOf('/') === -1 ? 'the drive’s top' : '“' + _local.rel.split('/').slice(-2, -1)[0] + '”') : 'your USB drives';
        var c = posterCard({ id: '..', name: '⬆  Back' }, 'local');
        c.className += ' local-folder';
        c.__onlongpress = null;
        c.__meta = { name: 'Back', description: 'Up to ' + parent + ' (or press BACK)' };
        c.__onselect = function () { backInLocal(); };
        return c;
    }
    function localVideoCard(d, x) {
        var m = LocalMedia.matchOf(x.rel, x.size);
        var label = m ? (m.type === 'series' ? m.name + '  ·  S' + m.parsed.season + 'E' + m.parsed.episode : m.name) : x.name.replace(/\.[^.]+$/, '');
        var c = posterCard({ id: x.rel, name: label, poster: m ? m.poster : '' }, 'local');
        c.className += ' local-video';
        var pType = m ? m.type : 'movie', pId = m ? m.vid : LocalMedia.plainId(x.rel, x.size);
        var prog = Player.progressFor(pType, pId);
        if (prog && prog.duration) { var bar = U.el('div', 'prog'); bar.style.width = Math.min(100, prog.position / prog.duration * 100) + '%'; c.appendChild(bar); }
        if (Player.isWatched(pType, pId)) { c.appendChild(U.el('div', 'card-watched', '✓')); }
        c.__meta = { name: label, description: x.name + (x.size ? '   ·   ' + LocalMedia.humanSize(x.size) : '') + '   ·   ' +
            (m ? 'Matched' + (m.fixed ? ' by you' : '') + ': ' + m.name : 'Not matched to a title  ·  long-press to match it') };
        c.__onselect = function () {
            _local.focusRel = x.rel;
            LocalMedia.play(d, x, _local.listing.entries, function () { renderHome(); });
        };
        c.__onlongpress = function () { localActions(d, x, m, pType, pId); };
        return c;
    }
    // A subtitle file of its own (no video with it): what it's matched to; hold OK (or OK) to
    // match it, or say it's no title's. Matched by its path alone (size 0: its index has no size).
    function localSubCard(d, x) {
        var m = LocalMedia.matchOf(x.rel, 0), sx = { name: x.name, rel: x.rel, size: 0 };
        var label = m ? (m.type === 'series' ? m.name + '  ·  S' + m.parsed.season + 'E' + m.parsed.episode : m.name) : x.name.replace(/\.[^.]+$/, '');
        var c = posterCard({ id: x.rel, name: label, poster: m ? m.poster : '' }, 'local');
        c.className += ' local-sub';
        c.appendChild(U.el('div', 'card-new card-code', 'Subtitles'));
        c.__meta = { name: label, description: x.name + '   ·   subtitles   ·   ' +
            (m ? 'Matched' + (m.fixed ? ' by you' : '') + ': ' + m.name + ' (offered for its sources)' : 'Not matched to a title  ·  OK to match it') };
        function actions() {
            var opts = [];
            if (m) { opts.push(['page', 'Title page: ' + m.name]); }
            opts.push(['match', m ? 'Match to another title…' : 'Match to a title…']);
            if (m) { opts.push(['none', 'Not a movie or episode']); }
            if (m && m.fixed) { opts.push(['auto', 'Back to the automatic match']); }
            pickList(x.name, opts, null, function (k) {
                _local.focusRel = x.rel;
                if (k === 'page') { App.openDetail(m.type, m.id, { id: m.id, type: m.type, name: m.name, poster: m.poster }, m.type === 'series' ? m.vid : null); }
                else if (k === 'none') { LocalMedia.setMatch(x.rel, 0, { none: true }); U.toast('“' + x.name + '”: no title’s'); renderHome(); }
                else if (k === 'auto') { LocalMedia.setMatch(x.rel, 0, null); LocalMedia.matchFolder(d, [sx]).then(function () { renderHome(); }); }
                else if (k === 'match') { matchByHand(d, sx); }
            });
        }
        c.__onselect = actions;
        c.__onlongpress = actions;
        return c;
    }
    function localActions(d, x, m, pType, pId) {
        var watched = Player.isWatched(pType, pId), opts = [['play', '▶  Play']];
        if (m) { opts.push(['page', 'Title page: ' + m.name]); }
        opts.push(['watched', watched ? 'Mark not watched' : 'Mark watched']);
        opts.push(['match', m ? 'Match to another title…' : 'Match to a title…']);
        if (m) { opts.push(['none', 'Not a movie or episode (a plain file)']); }
        if (m && m.fixed) { opts.push(['auto', 'Back to the automatic match']); }
        pickList(x.name, opts, null, function (k) {
            _local.focusRel = x.rel;
            if (k === 'play') { LocalMedia.play(d, x, _local.listing.entries, function () { renderHome(); }); }
            else if (k === 'page') { App.openDetail(m.type, m.id, { id: m.id, type: m.type, name: m.name, poster: m.poster }, m.type === 'series' ? m.vid : null); }
            else if (k === 'watched') { Player.setWatched(pType, pId, !watched); renderHome(); }
            else if (k === 'none') { LocalMedia.setMatch(x.rel, x.size, { none: true }); U.toast('“' + x.name + '”: a plain file'); renderHome(); }
            else if (k === 'auto') { LocalMedia.setMatch(x.rel, x.size, null); LocalMedia.matchFolder(d, [x]).then(function () { renderHome(); }); }
            else if (k === 'match') { matchByHand(d, x); }
        });
    }
    // Match by hand: movie or series, the name to search for, then one of the results.
    function matchByHand(d, x) {
        var p = LocalMedia.parsedOf(x.rel);
        function ask(type) {
            App.openEntry({
                title: 'Search for ' + (type === 'series' ? 'a series' : 'a movie'), value: p ? p.title : x.name.replace(/\.[^.]+$/, ''),
                hint: '“' + x.name + '”' + (type === 'series' && p && p.kind === 'series' ? ': every episode of the show follows.' : ''),
                validate: function (v) { return v ? null : 'Type a name'; },
                onConfirm: function (q) {
                    App.back();
                    U.spinner(true, 'Searching…');
                    LocalMedia.searchTitles(type, q).then(function (metas) {
                        U.spinner(false);
                        if (!metas.length) { U.toast('Nothing found for “' + q + '”'); return; }
                        pickList('Which one is “' + x.name + '”?', metas.slice(0, 20).map(function (mm) {
                            return [mm.id, (mm.name || mm.id) + (mm.releaseInfo ? '  (' + mm.releaseInfo + ')' : '')];
                        }), null, function (id) {
                            var mm = metas.filter(function (y) { return y.id === id; })[0];
                            LocalMedia.setMatch(x.rel, x.size, { id: mm.id, type: type, name: mm.name, poster: mm.poster, releaseInfo: mm.releaseInfo });
                            U.toast('Matched: ' + mm.name);
                            renderHome();
                        });
                    }, function () { U.spinner(false); U.toast('Search failed'); });
                }
            });
        }
        if (p && p.kind === 'series') { ask('series'); return; }
        pickList('“' + x.name + '” is…', [['movie', 'A movie'], ['series', 'An episode of a series']], p ? p.kind : 'movie', ask);
    }
    // BACK on the Local tab: up a folder (then to the drives, with several), wherever focus is —
    // an empty folder has nothing to focus but the top menu — and only then the top menu.
    function backInLocal() {
        if (_homeTab !== 'local' || _current() !== scr('home') || typeof LocalMedia === 'undefined') { return false; }
        if (_local.rel) {
            _local.focusRel = _local.rel;
            _local.rel = _local.rel.indexOf('/') === -1 ? '' : _local.rel.slice(0, _local.rel.lastIndexOf('/'));
            _local.listing = null; _local.key = '';
            renderHome();
            return true;
        }
        if (_local.root && LocalMedia.knownDrives().length > 1) { _local.focusRel = 'drive:' + _local.root; _local.root = null; renderHome(); return true; }
        return false;
    }
    if (typeof LocalMedia !== 'undefined') {
        LocalMedia.onChange(function (what) {
            if (what === 'drives') {
                if (!localDrive()) { _local.root = null; _local.rel = ''; _local.listing = null; _local.key = ''; }
                if (_current() === scr('home') && !isModalOpen() && !Player.isActive()) { renderHome(); }
            } else if (what === 'matches' || what === 'index') { redrawLocal(); }
            else if (what === 'status' && !_local.rel) { redrawLocal(); }   // (indexing progress: on the drive's top, where its card is)
        });
    }

    function continueCard(e, art) {
        if (typeof LocalMedia !== 'undefined' && LocalMedia.isPlainId(e.id)) { return plainContinueCard(e); }
        // The title to open: the recorded parent (a series, or the download a file came
        // from), else the id's first part ("tt123:1:2" -> "tt123"): Trakt entries and
        // next episodes queued at the credits don't record one.
        var base = e.parent || e.id.split(':')[0];
        var a = (art && art[base]) || {};
        var c = posterCard({ id: base, type: e.type, name: e.name, poster: a.poster || e.poster, background: a.background || e.background }, e.type);
        // Keep the full episode/file id so detail opens on it. With a saved stream the
        // card resumes it directly; long-press offers the Details page instead.
        var preview = { name: e.name, poster: e.poster, type: e.type };
        var target = e.id !== base ? e.id : null;
        c.__onselect = function () {
            App.openDetail(e.type, base, preview, target, e.url ? { resume: e } : null);
        };
        c.__onlongpress = function () { continueActions(e, base, preview, target, c); };
        c.__cwKey = showKey(e);
        c.__meta = { name: e.name, description: e.position
            ? 'Resume at ' + U.fmtTime(e.position) + (e.duration ? '  of  ' + U.fmtTime(e.duration) : '')
            : e.upNext !== undefined ? 'Next episode' + (e.upNext ? ': “' + e.upNext + '”' : '') + '   ·   from Trakt'
            : 'Added, not started yet' };
        var fresh = e.type === 'series' ? newEpisodeFor(e) : null, soon = notOutYet(e);
        if (soon) {   // (a next episode that hasn't aired: when it does)
            c.appendChild(U.el('div', 'card-new card-code', soon === true ? 'Not out yet' : 'Airs ' + U.dayLabel(soon)));
            c.__meta.description = 'Next episode' + (e.upNext ? ': “' + e.upNext + '”' : '') + '   ·   ' + (soon === true ? 'not out yet' : 'airs ' + U.dayLabel(soon)) + (e._trakt ? '   ·   from Trakt' : '');
        }
        if (fresh) {   // an episode came out since you last watched
            c.appendChild(U.el('div', 'card-new', 'NEW'));
            c.__meta.description = 'New episode: ' + fresh.code + (fresh.title ? '  “' + fresh.title + '”' : '') +
                '  ·  out ' + U.dayLabel(fresh.r) + '.   ' + c.__meta.description;
        }
        if (e.duration) {
            var p = U.el('div', 'prog');
            p.style.width = Math.min(100, (e.position / e.duration * 100)) + '%';
            c.appendChild(p);
        }
        return c;
    }

    // A plain file from a USB drive (not matched to a title): plays from where you stopped.
    function plainContinueCard(e) {
        var c = posterCard({ id: e.id, name: e.name || ('' + e.id).split('/').pop() }, 'local');
        c.className += ' local-video';
        c.__cwKey = showKey(e);
        c.__meta = { name: e.name, description: (e.position ? 'Resume at ' + U.fmtTime(e.position) + (e.duration ? '  of  ' + U.fmtTime(e.duration) : '') : 'Added, not started yet') + '   ·   on your USB drive' };
        c.__onselect = function () { LocalMedia.resumePlain(e, function () { renderHome(); }); };
        c.__onlongpress = function () { continueActions(e, null, null, null, c); };
        if (e.duration) { var p = U.el('div', 'prog'); p.style.width = Math.min(100, (e.position / e.duration * 100)) + '%'; c.appendChild(p); }
        return c;
    }

    // ----- followed shows: "NEW" badges (Continue Watching tab) -----
    // For the series in Continue Watching, the episodes released recently or coming soon
    // are kept on the TV (refreshed every 12 hours in the background from their details).
    var SHOWINFO_KEY = 'stremiok.showinfo', SHOWINFO_TTL = 12 * 3600 * 1000, SHOWS_MAX = 15;
    var DAY = 24 * 3600 * 1000;
    var _showRefreshing = false;
    function showIdOf(e) { return e.parent || ('' + e.id).split(':')[0]; }
    function showInfoAll() { return U.store.get(SHOWINFO_KEY, {}) || {}; }
    // done (optional): called once what's kept is current (at once when nothing was stale).
    function refreshShowInfo(entries, done) {
        if (_showRefreshing) { if (done) { setTimeout(function () { refreshShowInfo(entries, done); }, 2000); } return; }
        var info = showInfoAll(), now = Date.now(), seen = {};
        var ids = entries.filter(function (e) { return e.type === 'series'; }).map(showIdOf)
            .filter(function (id) { if (seen[id] || !/^tt\d+$/.test(id)) { return false; } seen[id] = 1; return true; })
            .slice(0, SHOWS_MAX);
        var stale = ids.filter(function (id) { return !info[id] || now - info[id].at > SHOWINFO_TTL; });
        if (!stale.length) { if (done) { done(); } return; }
        _showRefreshing = true;
        var badges = badgeSig(entries), got = {};
        U.settleAll(stale.map(function (id) {
            return function () {
                return Stremio.getMeta('series', id).then(function (m) {
                    var all = (m.videos || []).map(function (v) {
                        var r = Date.parse(v.released || v.firstAired || '');
                        return { id: v.id, s: v.season === undefined ? 1 : v.season, e: v.episode || v.number || 0,
                                 t: v.title || v.name || '', r: r };
                    });
                    // the recent and coming ones (the year ahead too: a next season's, for the home
                    // bar's tiles), and the episodes with no date yet (not out: see playableNow)
                    var eps = all.filter(function (x) { return x.r && x.s > 0 && x.r > now - 60 * DAY && x.r < now + 400 * DAY; });
                    var tba = all.filter(function (x) { return !x.r && x.s > 0 && x.id; }).map(function (x) { return x.id; }).slice(0, 200);
                    got[id] = { at: Date.now(), name: m.name || '', poster: m.poster || '', eps: eps, tba: tba };
                }, function () {   // try again at the next refresh, not on every redraw
                    var was = info[id] || {};
                    got[id] = { at: Date.now(), name: was.name || '', poster: was.poster || '', eps: was.eps || [], tba: was.tba || [] };
                });
            };
        }), 2).then(function () {
            _showRefreshing = false;
            // what came, and the followed shows kept: one write (not one per show)
            var all = showInfoAll(), keep = {};
            Object.keys(all).forEach(function (k) { if (seen[k]) { keep[k] = all[k]; } });
            Object.keys(got).forEach(function (k) { keep[k] = got[k]; });
            U.store.set(SHOWINFO_KEY, keep);
            // redraw only if a NEW badge changed (a redraw reloads every card's artwork: flicker)
            if (_homeTab === 'continue' && _current() === scr('home') && !isModalOpen() && !_moving && !Player.isActive() && badgeSig(entries) !== badges) { renderHome(); }
            if (done) { done(); }
        });
    }

    // ----- Calendar (a Home tab): what's coming up for the shows you're watching, and what you
    // watched — on this TV, and on Trakt when you're connected (any device) — a row a day. -----
    var CAL_AHEAD = 60, CAL_BACK = 30, _calCancel = null, _calWatched = false;   // (Watched shown: for the session)
    function dayStart(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    function dayTitle(ms) { var l = U.dayLabel(ms); return l.charAt(0).toUpperCase() + l.slice(1); }
    function calPoster(id) { return /^tt\d+$/.test(id) ? 'https://images.metahub.space/poster/small/' + id + '/img' : ''; }
    function codeOfId(id) { var p = ('' + id).split(':'); return p.length >= 3 ? 'S' + p[p.length - 2] + 'E' + p[p.length - 1] : ''; }
    function calendarRows(rows) {
        if (_calCancel) { _calCancel.cancel(); }
        _calCancel = U.cancelToken();
        var entries = continueEntries(), now = Date.now();
        var sig = upcomingSig();
        appendUpcoming(rows, now);
        appendWatchedToggle(rows, now);
        // (the shows' episodes kept on the TV, refreshed every 12 hours: drawn again if that changed them)
        refreshShowInfo(entries, function () {
            if (_homeTab === 'calendar' && _current() === scr('home') && !isModalOpen() && !Player.isActive() && upcomingSig() !== sig) { renderHome(); }
        });
    }
    // Coming up: the episodes of the shows in Watching airing from today, CAL_AHEAD days ahead
    // (from the details kept for the NEW badges: refreshShowInfo).
    function upcomingByDay(now) {
        var info = showInfoAll(), today = dayStart(now), by = {};
        Object.keys(info).forEach(function (sid) {
            var sh = info[sid] || {};
            (sh.eps || []).forEach(function (x) {
                if (!(x.r >= today && x.r < today + CAL_AHEAD * DAY)) { return; }
                var d = dayStart(x.r);
                (by[d] = by[d] || []).push({ show: sid, name: sh.name || '', poster: sh.poster || '', ep: x });
            });
        });
        return by;
    }
    function upcomingSig() {
        var by = upcomingByDay(Date.now());
        return Object.keys(by).sort().map(function (d) { return d + ':' + by[d].map(function (u) { return u.ep.id; }).join(','); }).join('|');
    }
    function appendUpcoming(rows, now) {
        var by = upcomingByDay(now), days = Object.keys(by).map(Number).sort(function (a, b) { return a - b; });
        if (!days.length) {
            var any = continueEntries().some(function (e) { return e.type === 'series'; });
            rows.appendChild(U.el('div', 'row-empty', any ? 'Coming up: nothing in the next ' + CAL_AHEAD + ' days for the shows you’re watching.'
                : 'Coming up: the new episodes of the shows in Watching show here, by day.'));
            return;
        }
        days.forEach(function (d) {
            // (the same day: by time, then by show, a show's episodes in their order)
            var list = by[d].sort(function (a, b) { return a.ep.r - b.ep.r || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.ep.s - b.ep.s || a.ep.e - b.ep.e; });
            rows.appendChild(buildRow('Coming up   ·   ' + dayTitle(d), list.map(function (u) {
                var c = posterCard({ id: u.show, type: 'series', name: u.name, poster: u.poster || calPoster(u.show) }, 'series');
                var code = epCodeOf(u.ep);
                c.appendChild(U.el('div', 'card-new card-code', code));
                c.__meta = { name: u.name, description: code + (u.ep.t ? '  “' + u.ep.t + '”' : '') + '   ·   ' + (u.ep.r > now ? 'out ' : 'came out ') + U.dayLabel(u.ep.r) };
                c.__onselect = function () { App.openDetail('series', u.show, { name: u.name, poster: u.poster, type: 'series' }, u.ep.id); };
                return c;
            })));
        });
    }
    // What you watched in the last CAL_BACK days: marked watched here (played to the credits, or
    // by hand), on Trakt (connected: any device), and what you stopped part-way (Watching). A
    // row a day, the latest first; a show's episodes that day on one card.
    function historyItems(since) {
        var all = {}, parent = {}, names = {}, posters = {};
        function add(type, id, at, how, pct) {
            if (!(at >= since) || !id) { return; }
            var k = type + ':' + id, x = all[k];
            if (x && x.how !== 'partial' && how === 'partial') { return; }   // (watched beats stopped part-way)
            if (!x || at > x.at || (x.how === 'partial' && how !== 'partial')) { all[k] = { type: type, id: id, at: Math.max(at, x ? x.at : 0), how: how, pct: pct }; }
            else if (x.how === 'trakt' && how === 'here') { x.how = 'here'; }
        }
        Player.continueList().forEach(function (e) {
            if (!e || !e.id) { return; }
            if (e.parent) { parent[e.type + ':' + e.id] = e.parent; }
            if (e.name) { names[e.parent || e.id] = ('' + e.name).replace(/\s+S\d+E\d+$/, ''); }
            if (e.poster) { posters[e.parent || e.id] = e.poster; }
            if (e.position > 0) { add(e.type, e.id, e.updated || 0, 'partial', e.duration ? Math.round(e.position / e.duration * 100) : 0); }
        });
        Player.watchedSince(since).forEach(function (w) { add(w.type, w.id, w.at, 'here'); });
        if (typeof Trakt !== 'undefined' && Trakt.isConnected() && Trakt.watchedSince) { Trakt.watchedSince(since).forEach(function (w) { add(w.type, w.id, w.at, 'trakt'); }); }
        var info = showInfoAll();
        return Object.keys(all).map(function (k) {
            var x = all[k];
            x.base = parent[k] || (/^tt\d+(:|$)/.test(x.id) ? x.id.split(':')[0] : (x.type === 'movie' ? x.id : ''));
            x.name = names[x.base] || (info[x.base] && info[x.base].name) || '';
            x.poster = posters[x.base] || (info[x.base] && info[x.base].poster) || calPoster(x.base);
            return x;
        }).filter(function (x) { return x.base && !/^(trailer|link):/.test(x.id); });
    }
    // Watched waits behind a row of its own (OK shows it, OK again hides it): scrolling down the
    // coming days doesn't run on into past ones.
    function appendWatchedToggle(rows, now) {
        var t = U.el('div', 'addon-item focusable cal-watched' + (_calWatched ? ' open' : ''));
        t.setAttribute('data-id', 'cal-watched');
        t.appendChild(U.el('div', 'a-name', (_calWatched ? '▾' : '▸') + '  Watched: the last ' + CAL_BACK + ' days'));
        t.appendChild(U.el('div', 'a-url', _calWatched ? 'OK to hide them' : 'OK to show what you watched, here' + (typeof Trakt !== 'undefined' && Trakt.isConnected() ? ' and on Trakt' : '')));
        t.__onselect = function () {
            _calWatched = !_calWatched;
            renderHome();
            var again = scr('home').querySelector('.cal-watched');
            if (again) { Focus.setScope(scr('home'), again); }
        };
        rows.appendChild(t);
        if (_calWatched) { appendHistory(rows, now); }
    }
    function appendHistory(rows, now) {
        var items = historyItems(dayStart(now) - (CAL_BACK - 1) * DAY), byDay = {};
        items.forEach(function (x) {
            var d = dayStart(x.at), day = byDay[d] = byDay[d] || {}, t = day[x.type + ':' + x.base];
            if (!t) { t = day[x.type + ':' + x.base] = { type: x.type, base: x.base, name: x.name, poster: x.poster, at: 0, eps: [] }; }
            t.at = Math.max(t.at, x.at);
            t.eps.push(x);
        });
        var days = Object.keys(byDay).map(Number).sort(function (a, b) { return b - a; });
        if (!days.length) {
            rows.appendChild(U.el('div', 'row-empty', 'Watched: nothing in the last ' + CAL_BACK + ' days' + (typeof Trakt !== 'undefined' && Trakt.isConnected() ? ', here or on Trakt.' : '.')));
            return;
        }
        var unnamed = [];
        days.forEach(function (d) {
            var titles = Object.keys(byDay[d]).map(function (k) { return byDay[d][k]; }).sort(function (a, b) { return b.at - a.at; });
            rows.appendChild(buildRow('Watched   ·   ' + dayTitle(d), titles.map(function (t) {
                t.eps.sort(function (a, b) { return b.at - a.at; });
                var c = posterCard({ id: t.base, type: t.type, name: t.name, poster: t.poster }, t.type);
                var latest = t.eps[0], codes = t.eps.map(function (x) { return codeOfId(x.id); }).filter(Boolean);
                var partial = t.eps.length === 1 && latest.how === 'partial';
                var tag = partial ? (latest.pct ? latest.pct + '%' : '…') : codes.length ? codes[0] + (codes.length > 1 ? ' +' + (codes.length - 1) : '') : '';   // (the latest, and how many more)
                if (tag) { c.appendChild(U.el('div', 'card-new card-code', tag)); }
                var what = partial ? 'Stopped part-way' + (latest.pct ? ' (' + latest.pct + '%)' : '') + (codes.length ? ': ' + codes[0] : '')
                    : 'Watched' + (codes.length ? ' ' + codes.slice().reverse().join(', ') : '');
                var where = t.eps.every(function (x) { return x.how === 'trakt'; }) ? '   ·   on Trakt' : '';
                c.__meta = { name: t.name, description: what + where };
                c.__onselect = function () { App.openDetail(t.type, t.base, { name: c.__meta.name, poster: t.poster, type: t.type }, t.type === 'series' && latest.id !== t.base ? latest.id : null); };
                if (!t.name) { unnamed.push({ t: t, c: c }); }
                return c;
            })));
        });
        nameLater(unnamed);
    }
    // Titles known only by id (Trakt's history, a mark made here): named from their details,
    // two at a time, once the tab is drawn (the cards show their poster meanwhile).
    function nameLater(list) {
        if (!list.length) { return; }
        var tok = _calCancel, byBase = {};
        list.forEach(function (u) { (byBase[u.t.type + ':' + u.t.base] = byBase[u.t.type + ':' + u.t.base] || []).push(u); });
        U.settleAll(Object.keys(byBase).map(function (k) {
            return function () {
                if (tok && tok.cancelled) { return null; }
                var u0 = byBase[k][0];
                return Stremio.getMeta(u0.t.type, u0.t.base, tok).then(function (m) {
                    if ((tok && tok.cancelled) || !m) { return; }
                    byBase[k].forEach(function (u) {
                        u.c.__meta.name = m.name || '';
                        var fb = u.c.querySelector('.fallback');
                        if (fb && m.name) { fb.textContent = m.name; }
                        if (Focus.current() === u.c) { fillHomeInfo(u.c.__meta); }
                    });
                });
            };
        }), 2);
    }

    // ----- the TV's home bar (Smart Hub preview, js/hubpreview.js) -----
    // Continue Watching as tiles, only what can be played now: a movie or an episode stopped
    // part-way, or one not started that's out — not a next episode that hasn't aired (a show
    // waiting for it), nor one with no date yet. Movies and series only (not YouTube, IPTV,
    // sports or radio, nor a file on a USB drive). Up to PREVIEW_MAX, each with a small 16:9
    // picture (a large one isn't shown).
    var PREVIEW_MAX = 8;
    function playableNow(e) {
        if (!e || typeof e.id !== 'string' || (e.type !== 'movie' && e.type !== 'series') || e.localFile) { return false; }
        if (!/^tt\d+$/.test(e.parent || e.id.split(':')[0])) { return false; }   // (IMDb titles only: YouTube's, IPTV's, a USB file's aren't)
        if (e.position > 0) { return true; }
        if (e.type === 'movie') { return true; }
        var info = showInfoAll()[showIdOf(e)];
        if (!info) { return false; }   // (its episodes not known yet: not until they are)
        if ((info.tba || []).indexOf(e.id) !== -1) { return false; }
        var ep = null;
        (info.eps || []).forEach(function (x) { if (x.id === e.id) { ep = x; } });
        return ep ? ep.r <= Date.now() : true;   // (not among the recent or coming ones: out long ago)
    }
    // A next episode (not started) that hasn't aired: when it does (ms), true (no date yet), or
    // false (out, or not known).
    function notOutYet(e) {
        if (!e || e.type !== 'series' || e.position > 0) { return false; }
        var info = showInfoAll()[showIdOf(e)];
        if (!info) { return false; }
        if ((info.tba || []).indexOf(e.id) !== -1) { return true; }
        var ep = null;
        (info.eps || []).forEach(function (x) { if (x.id === e.id) { ep = x; } });
        return ep && ep.r > Date.now() ? ep.r : false;
    }
    function previewTiles() {
        var out = [];
        var recent = Stremio.getPrefs().homePreviewOrder !== 'watching';   // (Settings › Appearance › Home bar order)
        continueEntries(recent).forEach(function (e) {   // (the latest first: what you're bingeing leads; or Watching's order)
            if (out.length >= PREVIEW_MAX || !playableNow(e)) { return; }
            var base = e.parent || e.id.split(':')[0], code = e.type === 'series' ? codeOfId(e.id) : '';
            var name = ('' + (e.name || (showInfoAll()[base] || {}).name || '')).replace(/\s+S\d+E\d+$/, '') || 'StremioK';
            out.push({ title: name.slice(0, 60),
                subtitle: (code ? code + '   ·   ' : '') + (e.position > 0 ? 'Resume at ' + (e._trakt ? Math.round(e.position) + '%' : U.fmtTime(e.position)) : e.type === 'series' ? 'Next episode' : 'Start watching'),
                image_ratio: '16by9', image_url: 'https://images.metahub.space/background/small/' + base + '/img',
                action_data: JSON.stringify({ type: e.type, id: e.id, parent: base }), is_playable: false });
        });
        return out;
    }
    // The shows in Watching with their episodes current (refreshShowInfo), then fn.
    function withShowInfo(fn) { refreshShowInfo(continueEntries(), fn); }

    // New-episode alerts (TVs have no notifications): once after launch (App), a note naming the
    // shows in Watching with a new episode out since you last watched them, each episode once.
    // Off per show (Watching's hold-OK menu). { off: { showId: 1 }, told: { showId: episode id } }
    var ALERTS_KEY = 'stremiok.epalerts';
    function epAlerts() { var a = U.store.get(ALERTS_KEY, {}) || {}; return { off: a.off || {}, told: a.told || {} }; }
    function alertsOn(showId) { return !epAlerts().off[showId]; }
    function setAlerts(showId, on) {
        var a = epAlerts();
        if (on) { delete a.off[showId]; } else { a.off[showId] = 1; }
        U.store.set(ALERTS_KEY, a);
    }
    function alertNewEpisodes() {
        var entries = continueEntries().filter(function (e) { return e.type === 'series'; });
        if (!entries.length) { return; }
        refreshShowInfo(entries, function () {
            var a = epAlerts(), info = showInfoAll(), news = [];
            entries.forEach(function (e) {
                var id = showIdOf(e), n = newEpisodeFor(e);
                if (!n || a.off[id] || a.told[id] === id + ':' + n.code) { return; }
                a.told[id] = id + ':' + n.code;
                news.push(((info[id] && info[id].name) || ('' + (e.name || '')).replace(/\s+S\d+E\d+$/, '')) + ' ' + n.code);
            });
            if (!news.length) { return; }
            U.store.set(ALERTS_KEY, a);
            var shown = news.slice(0, 3).join('  ·  ') + (news.length > 3 ? '  ·  and ' + (news.length - 3) + ' more' : '');
            U.toast((news.length === 1 ? 'New episode: ' : 'New episodes: ') + shown, 8000);
        });
    }
    function epCodeOf(x) { return 'S' + x.s + 'E' + x.e; }
    function badgeSig(entries) {
        return entries.map(function (e) { var n = newEpisodeFor(e); return e.id + (n ? ':' + n.code : ''); }).join('|');
    }
    // The first episode after where you are that came out since your last activity on
    // the show (the queued episode itself counts while it's not started).
    function newEpisodeFor(e) {
        var info = showInfoAll()[showIdOf(e)];
        if (!info) { return null; }
        var p = ('' + e.id).split(':'), s = parseInt(p[1], 10) || 0, n = parseInt(p[2], 10) || 0;
        var started = e.position > 0, now = Date.now(), best = null;
        info.eps.forEach(function (x) {
            var after = x.s > s || (x.s === s && (started ? x.e > n : x.e >= n));
            if (!after || x.r > now || x.r <= (e.updated || 0)) { return; }
            if (Player.isWatched('series', x.id)) { return; }
            if (!best || x.s < best.s || (x.s === best.s && x.e < best.e)) { best = x; }
        });
        return best ? { code: epCodeOf(best), title: best.t, r: best.r } : null;
    }

    // Long-press on a Continue Watching card: open its page, move it, or drop it from the row.
    function continueActions(e, base, preview, target, card) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box actions-box');   // (as wide as its buttons)
        box.appendChild(U.el('div', 'modal-msg', e.name || 'Continue Watching'));
        var row = U.el('div', 'modal-row');
        var cancel = U.el('div', 'pill focusable modal-btn', 'Cancel');
        var details = U.el('div', 'pill focusable modal-btn', 'Details');
        var remove = U.el('div', 'pill focusable modal-btn danger', 'Remove');
        var move = U.el('div', 'pill focusable modal-btn', 'Move');
        // a show: its new-episode alerts off (or on again)
        var showId = e.type === 'series' && base ? showIdOf(e) : '', alerts = null;
        if (showId) {
            var on = alertsOn(showId), showName = ((showInfoAll()[showId] || {}).name) || ('' + (e.name || '')).replace(/\s+S\d+E\d+$/, '');
            alerts = U.el('div', 'pill focusable modal-btn', on ? 'Alerts off' : 'Alerts on');
            alerts.__onselect = function () {
                closeModal();
                setAlerts(showId, !on);
                U.toast(on ? 'No new-episode alerts for ' + showName : 'New-episode alerts for ' + showName + ' again');
            };
        }
        var watched = U.el('div', 'pill focusable modal-btn', 'Mark watched');
        // Play from start: the same source, from 0:00 (a card with a source saved and a place to resume)
        var restart = (e.url && e.position > 0) ? U.el('div', 'pill focusable modal-btn', 'Play from start') : null;
        if (restart) {
            restart.__onselect = function () {
                closeModal();
                if (!base) { LocalMedia.resumePlain(e, function () { renderHome(); }, true); return; }
                App.openDetail(e.type, base, preview, target, { resume: Object.assign({}, e, { fromStart: true }) });
            };
        }
        var recent = cwOrder() ? U.el('div', 'pill focusable modal-btn', 'Recent first') : null;
        move.__onselect = function () { closeModal(); startMove(card); };
        if (recent) { recent.__onselect = function () { closeModal(); U.store.remove(CW_ORDER_KEY); U.toast('Continue Watching: most recent first'); renderHome(); }; }
        cancel.__onselect = function () { closeModal(); };
        details.__onselect = function () { closeModal(); App.openDetail(e.type, base, preview, target); };
        if (!base) { details = null; }   // (a plain file from a USB drive: no title page)
        // Off the row: its progress here, and Trakt's paused one (kept off until Trakt has newer)
        function dropCard() {
            [e].concat(e._dupes || []).forEach(function (d) {   // (the show's other episodes too)
                Player.removeProgress(d.type, d.id);
                if (typeof Trakt !== 'undefined' && Trakt.dismiss) { Trakt.dismiss(d.type, d.id); }
            });
        }
        remove.__onselect = function () {
            closeModal();
            dropCard();
            U.toast('Removed from Continue Watching');
            renderHome();
        };
        // Watched (not just off the row): marked watched (Trakt too, when connected), then off
        watched.__onselect = function () {
            closeModal();
            Player.setWatched(e.type, e.id, true);
            dropCard();
            U.toast('Marked watched' + (e.type === 'series' && /:\d+:\d+$/.test(e.id) ? ': ' + e.id.replace(/^.*:(\d+):(\d+)$/, 'S$1E$2') : ''));
            renderHome();
        };
        row.appendChild(cancel);
        if (details) { row.appendChild(details); }
        if (restart) { row.appendChild(restart); }
        if (card && !card.__upcoming && card.parentNode && card.parentNode.children.length > 1) { row.appendChild(move); }   // (Upcoming: in date order)
        if (recent) { row.appendChild(recent); }
        if (alerts) { row.appendChild(alerts); }
        row.appendChild(watched);
        row.appendChild(remove);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, details || watched);
    }

    // Local progress merged with Trakt playback (when connected), deduped, newest first; a
    // place kept here that Trakt has you watching past since (another TV) left out.
    // One card per show: its furthest episode (highest season, then episode), placed by
    // the show's most recent activity. The others ride along as _dupes so Remove clears
    // the whole show.
    // byActivity: the most recent activity first, whatever order you gave the row (Move): the
    // home bar's tiles (previewTiles).
    function continueEntries(byActivity) {
        var local = Player.continueList(), traktOn = typeof Trakt !== 'undefined' && Trakt.isConnected();
        if (traktOn && Trakt.watchedPast) { local = local.filter(function (e) { return !Trakt.watchedPast(e); }); }
        var merged = local.slice();
        if (traktOn) {
            var seen = {};
            local.forEach(function (e) { seen[e.type + ':' + e.id] = 1; });
            Trakt.continueList().forEach(function (e) {
                var k = e.type + ':' + e.id;
                if (!seen[k]) { seen[k] = 1; merged.push(e); }
            });
        }
        var list = onePerShow(merged);   // (the most recent activity first)
        return byActivity ? list : inYourOrder(list);
    }

    // ----- your own order (Move) -----
    // Once you've moved a card, the row keeps your order: a title new to the row comes
    // first (the newest first), the rest where you put them, watched or not since.
    // "Recent first" goes back to the most recent activity first.
    var CW_ORDER_KEY = 'stremiok.cworder', CW_ORDER_MAX = 500;
    function cwOrder() { var o = U.store.get(CW_ORDER_KEY, null); return Array.isArray(o) && o.length ? o : null; }
    function inYourOrder(list) {
        var o = cwOrder();
        if (!o) { return list; }
        var at = {};
        o.forEach(function (k, i) { at['k' + k] = i + 1; });
        var fresh = list.filter(function (e) { return !at['k' + showKey(e)]; });
        var placed = list.filter(function (e) { return !!at['k' + showKey(e)]; });
        placed.sort(function (a, b) { return at['k' + showKey(a)] - at['k' + showKey(b)]; });
        return fresh.concat(placed);
    }
    // Moving a card: the arrows carry it through the row (UP / DOWN a line), OK leaves it
    // there (saved), BACK puts it back. Other keys wait until then.
    var _moving = null;   // { card, grid, before: [cards as they were] }
    function cardsOf(grid) { return Array.prototype.slice.call(grid.children); }
    function moveTitle(on) {
        var t = _moving && _moving.grid.parentNode && _moving.grid.parentNode.querySelector('.row-title');
        if (t) { t.textContent = on ? 'Continue Watching   ·   arrows: move it   ·   OK: leave it there   ·   BACK: cancel' : CW_TITLE; }
    }
    function startMove(card) {
        if (!card || !card.parentNode) { return; }
        _moving = { card: card, grid: card.parentNode, before: cardsOf(card.parentNode) };
        card.classList.add('moving');
        moveTitle(true);
        Focus.setScope(scr('home'), card);
    }
    function endMove(keep) {
        var m = _moving;
        if (!m) { return; }
        moveTitle(false);
        _moving = null;
        m.card.classList.remove('moving');
        if (keep) {
            // (this row's order, then Upcoming's titles where they were: they come back up in it)
            var mine = cardsOf(m.grid).map(function (c) { return c.__cwKey; }).filter(Boolean);
            var rest = (cwOrder() || []).filter(function (k) { return mine.indexOf(k) === -1; });
            U.store.set(CW_ORDER_KEY, mine.concat(rest).slice(0, CW_ORDER_MAX));
        } else {
            m.before.forEach(function (c) { m.grid.appendChild(c); });
        }
        Focus.setScope(scr('home'), m.card);
    }
    function perLine(cards) {   // cards on the first line of the grid
        var top = cards[0].offsetTop, n = 0;
        while (n < cards.length && cards[n].offsetTop === top) { n++; }
        return n;
    }
    function moveKey(action) {
        if (!_moving) { return false; }
        if (!_moving.grid.parentNode || _current() !== scr('home')) { _moving = null; return false; }
        var m = _moving, cards = cardsOf(m.grid), i = cards.indexOf(m.card), n = cards.length;
        var by = { LEFT: -1, RIGHT: 1 }[action];
        if (action === 'UP' || action === 'DOWN') {
            var line = perLine(cards);
            by = line < n ? (action === 'UP' ? -line : line) : 0;
        }
        if (by !== undefined) {
            var j = Math.max(0, Math.min(n - 1, i + by));
            if (j !== i) {
                var rest = cards.filter(function (c) { return c !== m.card; });
                m.grid.insertBefore(m.card, rest[j] || null);
            }
            Focus.setScope(scr('home'), m.card);
            return true;
        }
        if (action === 'OK' || action === 'OK_LONG') { endMove(true); return true; }
        if (action === 'BACK') { endMove(false); return true; }
        return true;
    }
    function showKey(e) {
        return e.type === 'series' ? 'series:' + (e.parent || ('' + e.id).split(':')[0]) : e.type + ':' + e.id;
    }
    // [season, episode] from "tt123:2:5"; specials (season 0) and unknowns rank lowest
    function epOrder(e) {
        var p = ('' + e.id).split(':'), sn = parseInt(p[1], 10), ep = parseInt(p[2], 10);
        return [isNaN(sn) ? -1 : (sn === 0 ? -0.5 : sn), isNaN(ep) ? -1 : ep];
    }
    function furtherThan(a, b) {
        var x = epOrder(a), y = epOrder(b);
        if (x[0] !== y[0]) { return x[0] > y[0]; }
        if (x[1] !== y[1]) { return x[1] > y[1]; }
        return (a.updated || 0) > (b.updated || 0);
    }
    function onePerShow(list) {
        var groups = {}, order = [];
        list.forEach(function (e) {
            var k = showKey(e), g = groups[k];
            if (!g) { groups[k] = { keep: e, all: [e], updated: e.updated || 0 }; order.push(k); return; }
            g.all.push(e);
            if (furtherThan(e, g.keep)) { g.keep = e; }
            if ((e.updated || 0) > g.updated) { g.updated = e.updated || 0; }
        });
        var out = order.map(function (k) {
            var g = groups[k];
            if (g.all.length === 1) { return { e: g.keep, updated: g.updated }; }
            // a copy: the entries themselves are the stored progress objects
            var c = Object.assign({}, g.keep);
            c._dupes = g.all.filter(function (x) { return x !== g.keep; });
            return { e: c, updated: g.updated };
        });
        out.sort(function (a, b) { return b.updated - a.updated; });
        return out.map(function (x) { return x.e; });
    }

    // Switch the active home tab (from the shared top menu) and show it.
    function setHomeTab(key) { _homeTab = key || _homeTab; _focusFirstCard = 'new'; }

    // prevFocus: a Home card to put focus back on after the rebuild (the card a title
    // was opened from). Otherwise the card currently focused on Home is kept, so rows
    // refreshed in the background don't move focus.
    var CW_TITLE = 'Continue Watching';   // (holding OK: the corner's "Hold OK for more" says so)
    var UPCOMING_TITLE = 'Upcoming';
    function renderHome(prevFocus) {
        _moving = null;   // (a move not left yet: as it was)
        var s = scr('home');
        var cur = Focus.current();
        var inMenu = !!(cur && s.contains(cur) && /\b(tab-pill|hchip)\b/.test(cur.className));
        // a tab picked while its rows were loading: still wanted if focus hasn't left its pill
        if (_focusFirstCard === 'pending' && !(inMenu && /\btab-pill\b/.test(cur.className) && /\bactive\b/.test(cur.className))) {
            _focusFirstCard = false;
        }
        var firstCard = !!_focusFirstCard;
        // otherwise a rebuild keeps focus where it is: a menu item, or a card
        var keep = (firstCard || inMenu) ? null : cardKey(prevFocus || cur);
        if (_homeDirty) { _tabRows = {}; }   // feeds / addons / poster shape / progress changed
        _homeDirty = false;
        U.clear(s);

        if (_homeCatalogs === null) { useHomeCache(); }
        // Keep the active tab valid for what's actually available.
        var avail = availableTabs();
        if (!_homeTab || !avail.some(function (t) { return t.key === _homeTab; })) {
            _homeTab = avail.length ? avail[0].key : 'movie';
        }

        s.appendChild(buildTopMenu(_homeTab));
        // The focused title's details, between the top menu and the rows (#home-info).
        var info = U.el('div', 'home-info');
        info.appendChild(U.el('div', 'home-info-title'));
        info.appendChild(U.el('div', 'home-info-meta'));
        info.appendChild(U.el('div', 'home-info-desc'));
        s.appendChild(info);

        // Rows for the active tab, from the once-per-session catalog cache. Catalog tabs
        // keep their built rows, so switching back doesn't rebuild every card; Continue
        // Watching is small and changes after every playback, so it's always rebuilt.
        var rows = (_homeTab !== 'continue' && _homeTab !== 'local' && _homeTab !== 'calendar') ? _tabRows[_homeTab] : null;
        if (_homeTab !== 'calendar' && _calCancel) { _calCancel.cancel(); _calCancel = null; }   // (its titles' details still coming: not wanted)
        if (rows) {
            s.appendChild(rows);
            U.requeueImages(rows);
        } else {
            rows = U.el('div', 'rows');
            s.appendChild(rows);
            if (_homeTab === 'local') {
                localRows(rows);
            } else if (_homeTab === 'calendar') {
                calendarRows(rows);
            } else if (_homeTab === 'continue') {
                var entries = continueEntries();
                if (entries.length) {
                    // two rows: what can be played now (your order), and Upcoming (a show's next
                    // episode not out yet: the soonest first, one with no date last); an empty
                    // row isn't shown
                    var art = homeArt(), now = [], soon = [];
                    entries.forEach(function (e) { var w = notOutYet(e); if (w) { soon.push({ e: e, w: w === true ? Infinity : w }); } else { now.push(e); } });
                    soon.sort(function (x, y) { return x.w - y.w; });
                    if (now.length) { rows.appendChild(buildGrid(CW_TITLE, now.map(function (e) { return continueCard(e, art); }))); }
                    if (soon.length) {
                        rows.appendChild(buildGrid(UPCOMING_TITLE, soon.map(function (x) { var c = continueCard(x.e, art); c.__upcoming = true; return c; })));
                    }
                    refreshShowInfo(entries);
                } else {
                    rows.appendChild(U.el('div', 'row-empty', 'Nothing in Continue Watching yet.'));
                }
            } else {
                var cats = catsForTab(_homeTab);
                if (!cats.length) { rows.appendChild(U.el('div', 'row-empty', _homeLoading ? 'Loading…' : 'Nothing here yet.')); }
                else {
                    // render at least down to the row focus is going back to
                    var need = 0;
                    for (var ci = 0; keep && ci < cats.length; ci++) { if (cats[ci].name === keep.row) { need = ci + 1; break; } }
                    appendRows(rows, cats, 0, need);
                }
                _tabRows[_homeTab] = rows;
            }
        }
        var again = keep ? findCard(s, keep) : null;
        var landed = false;
        var sameItem = (!firstCard && inMenu) ? menuItem(s, cur.textContent) : null;   // the menu item focus was on
        if (again || sameItem) { Focus.setScope(s, again || sameItem); } else { landed = focusHome(s, !firstCard && inMenu); }
        if (_homeCatalogs === null || homeStale() || _reloadOnly) { loadHomeCatalogs(); }
        // No title to focus yet: try again when the rows arrive (Continue Watching and a
        // tab with no catalogs have nothing coming, so focus simply stays on the pill).
        _focusFirstCard = (firstCard && !landed && _homeLoading && _homeTab !== 'continue' && _homeTab !== 'calendar') ? 'pending' : false;
        _renderedSig = tabSig();
        if (s.querySelector('.rows .card')) { U.mark('firstCard'); }
        // the strip describes the focused title only (empty while focus is in the menu)
        clearTimeout(_homeInfoTimer); _homeInfoTimer = null;
        fillHomeInfo(Focus.current() && Focus.current().__meta);
    }

    // Details strip: updated when focus settles on a Home card (debounced, so holding a
    // direction doesn't redo it for every card passed).
    var _homeInfoTimer = null;
    function fillHomeInfo(m) { fillInfoBox(scr('home').querySelector('.home-info'), m); }
    // Fill a details strip (Home, Discover) with a title's logo / name, facts and synopsis.
    function fillInfoBox(box, m) {
        if (!box) { return; }
        m = m || {};
        var bits = [];
        if (m.releaseInfo) { bits.push(m.releaseInfo); } else if (m.year) { bits.push('' + m.year); }
        if (m.runtime) { bits.push(m.runtime); }
        if (m.imdbRating) { bits.push('★ ' + m.imdbRating); }
        if (m.genres && m.genres.length) { bits.push(m.genres.slice(0, 3).join(', ')); }
        if (m.name || m.title) { box.classList.add('on'); } else { box.classList.remove('on'); }   // shaded only while describing a title
        var t = box.children[0], name = m.name || m.title || '';
        U.clear(t);
        var logoSrc = U.cardImage(m.logo, 'logo');
        if (logoSrc) {   // the title's logo when it has one; its name if that fails to load
            var img = U.el('img', 'home-info-logo');
            img.onerror = function () { if (img.parentNode === t) { U.clear(t); t.textContent = name; } };
            t.appendChild(img);
            U.deferImage(img, logoSrc, true);   // (through the queue, ahead of the rest)
        } else {
            t.textContent = name;
        }
        box.children[1].textContent = bits.join('   ·   ');
        box.children[2].textContent = m.description || '';
    }
    Focus.onFocus(function (node) {
        if (!node || !scr('home').contains(node)) { return; }
        if (_homeInfoTimer) { clearTimeout(_homeInfoTimer); }
        _homeInfoTimer = setTimeout(function () { _homeInfoTimer = null; fillHomeInfo(node.__meta); }, 120);
    });

    // Identify a Home card by its row title + content id, to find it again after a rebuild.
    function cardKey(node) {
        if (!node || !node.getAttribute || !node.getAttribute('data-id') || !scr('home').contains(node)) { return null; }
        var row = node.parentNode && node.parentNode.parentNode;   // card -> row-scroller -> row
        var title = row && row.querySelector ? row.querySelector('.row-title') : null;
        return title ? { row: title.textContent, id: node.getAttribute('data-id') } : null;
    }
    function findCard(s, key) {
        var rows = s.querySelectorAll('.rows .row');
        for (var i = 0; i < rows.length; i++) {
            var title = rows[i].querySelector('.row-title');
            if (!title || title.textContent !== key.row) { continue; }
            var cards = rows[i].querySelectorAll('.card');
            for (var j = 0; j < cards.length; j++) { if (cards[j].getAttribute('data-id') === key.id) { return cards[j]; } }
        }
        return null;
    }

    // What the current tab's rows are built from (row names and sizes), to tell whether
    // newly arrived catalogs change what's on screen.
    // Everything the tab on screen shows from the catalogs (which titles, in which rows),
    // to tell whether a refresh changed it. Continue Watching shows none of it.
    function shownSig() {
        if (_homeTab === 'continue' || _homeTab === 'calendar') { return _homeTab; }
        return _homeTab + '#' + catsForTab(_homeTab).map(function (c) {
            return c.name + ':' + c.metas.map(function (m) { return m.id + '/' + (m.poster || ''); }).join(',');
        }).join('|');
    }
    var _renderedSig = '';
    function tabSig() {
        return _homeTab + '#' + catsForTab(_homeTab).map(function (c) { return c.name + ':' + c.metas.length; }).join('|');
    }

    // Fetch every Home catalog's metas. The first load starts from nothing (spinner) and
    // shows rows in order as they arrive, so one slow addon doesn't hold back the rest.
    // A refresh keeps the current rows on screen, keeps a row's old items if its addon
    // fails this time, and swaps the new rows in when they all arrive.
    var _homeFirstLoad = false;
    // A big IPTV playlist takes a while to read: say how far along it is under the spinner.
    function channelsText(n) { return 'Reading IPTV playlists…  ' + ('' + n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' channels'; }
    if (typeof IPTV !== 'undefined' && IPTV.onProgress) {
        IPTV.onProgress(function (n) { if (_homeFirstLoad) { U.spinner(true, channelsText(n)); } });
    }
    // The IPTV playlists read after your addons loaded (they aren't waited for): their rows join.
    if (typeof Stremio !== 'undefined' && Stremio.onIptvReady) { Stremio.onIptvReady(function () { refreshAddonRows('local:iptv'); }); }
    var PARTIAL_DELAY = 150;   // coalesces catalogs that arrive together into one redraw
    function loadHomeCatalogs() {
        if (_homeLoading) { return; }
        _homeLoading = true;
        var first = (_homeCatalogs === null);
        var only = first ? null : _reloadOnly;   // a partial reload: just these addons' rows
        _reloadOnly = null;
        _homeFirstLoad = first;
        var old = {};
        (_homeCatalogs || []).forEach(function (c) { old[c.type + '|' + c.name] = c.metas; });
        function oldFor(cat) {
            return cat.type === 'other'
                ? (old['movie|' + otherRowName('Movies', cat.name)] || []).concat(old['series|' + otherRowName('Series', cat.name)] || [])
                : (old[cat.type + '|' + cat.name] || []);
        }
        var before = first ? null : shownSig();
        if (first) { _homeCatalogs = []; U.spinner(true); }
        var s = scr('home');
        function done() {
            _homeLoadedAt = Date.now();
            _homeLoading = false;
            _homeFirstLoad = false;
            if (first) { U.spinner(false); }
            if (_reloadOnly && onHome()) { setTimeout(loadHomeCatalogs, 0); }   // (rows asked for meanwhile: the IPTV ones, read after the addons)
        }
        function onHome() { return _current() === s && !isModalOpen() && !Player.isActive(); }
        Stremio.catalogsForHome().then(function (cats) {
            var acc = cats.map(function (cat) { return { name: cat.name, type: cat.type, metas: [] }; });
            var arrived = cats.map(function () { return false; }), shown = 0, partialTimer = null;
            // First load: publish each row as soon as it arrives, in its own place (a slower one above
            // it held by a "Loading…" placeholder, so nothing jumps when it comes), and redraw when
            // that changes the tab on screen.
            function partial() {
                var n = arrived.filter(Boolean).length, last = arrived.lastIndexOf(true);
                if (!first || n <= shown) { return; }
                shown = n;
                var now = acc.slice(0, last + 1).map(function (c, i) { return arrived[i] ? c : { name: c.name, type: c.type, metas: [], loading: true }; });
                _homeCatalogs = splitOtherCatalogs(now).filter(function (c) { return c.loading || (c.metas && c.metas.length); });
                if (partialTimer) { return; }
                partialTimer = setTimeout(function () {
                    partialTimer = null;
                    if (!_homeFirstLoad) { return; }   // everything arrived meanwhile: drawn below
                    var keep = {};
                    if (tabSig() === _renderedSig) { keep[_homeTab] = _tabRows[_homeTab]; }
                    _tabRows = keep;   // other tabs rebuild from the new rows when opened
                    if (!keep[_homeTab] && onHome()) { renderHome(); }
                }, PARTIAL_DELAY);
            }
            var tasks = cats.map(function (cat, i) {
                return function () {
                    if (only && !only[cat.addon.url]) {   // not the addon that changed: keep its rows
                        acc[i].metas = oldFor(cat); arrived[i] = true;
                        return Promise.resolve();
                    }
                    return Stremio.getCatalog(cat).then(function (metas) { acc[i].metas = metas; }, function () {
                        acc[i].metas = oldFor(cat);
                    }).then(function () { arrived[i] = true; partial(); });
                };
            });
            U.settleAll(tasks, 3).then(function () {
                _homeCatalogs = splitOtherCatalogs(acc).filter(function (c) { return c.metas && c.metas.length; });
                done();
                saveHomeCache();
                // The tab on screen is redrawn only if what it shows changed: redrawing rebuilds
                // every card (and reloads its artwork), which shows as a flicker. Continue
                // Watching doesn't come from catalogs at all. Other tabs rebuild when opened.
                var same = before !== null && shownSig() === before;
                var keep = {};
                if (same && _tabRows[_homeTab]) { keep[_homeTab] = _tabRows[_homeTab]; }
                _tabRows = keep;
                if (same) { return; }
                // Swap in now if Home is what's on screen; otherwise on the next visit.
                if (onHome()) { renderHome(); }
                else { _homeDirty = true; }
            });
        }, function () {
            done();
            if (first) { U.toast('Failed to load addons. Check network / Settings.'); }
        });
    }

    // Catalogs of type "other" (e.g. Torrentio's RealDebrid downloads) aren't live TV:
    // their items go to a Movies row and a Series row, split by the release name.
    // Everything is capped to the ROW_CARDS cards a Home row shows.
    var ROW_CARDS = 30;
    var SERIES_NAME = /(^|[^a-z0-9])(s\d{1,2}(e\d{1,3})?|\d{1,2}x\d{2}|season[\s._-]*\d+|temporada[\s._-]*\d+|complete[\s._-]*series)([^a-z0-9]|$)/i;
    function otherRowName(kind, name) { return kind + ' · ' + ('' + name).replace(/^Other · /, ''); }
    function splitOtherCatalogs(list) {
        var out = [];
        list.forEach(function (c) {
            if (c.loading) { if (c.type !== 'other') { out.push({ name: c.name, type: c.type, metas: [], loading: true }); } return; }   // (a placeholder: still loading)
            if (c.type !== 'other') { out.push({ name: c.name, type: c.type, metas: c.metas.slice(0, ROW_CARDS) }); return; }
            var movies = [], series = [];
            c.metas.forEach(function (m) { (SERIES_NAME.test(m.name || '') ? series : movies).push(m); });
            out.push({ name: otherRowName('Movies', c.name), type: 'movie', metas: movies.slice(0, ROW_CARDS) });
            out.push({ name: otherRowName('Series', c.name), type: 'series', metas: series.slice(0, ROW_CARDS) });
        });
        return out;
    }

    // Render cats[from .. from+ROW_BATCH) into `rows`. A large IPTV list can have 50+
    // groups x ROW_CARDS cards; building them all up front bloats the DOM, the poster queue
    // and every D-pad scan. While more remain, DOWN on either of the last two rendered
    // rows renders the next batch first, then the normal DOWN move continues into it.
    function appendRows(rows, cats, from, atLeast) {
        var to = Math.min(cats.length, from + Math.max(ROW_BATCH, atLeast || 0));
        var built = [];
        for (var i = from; i < to; i++) {
            var c = cats[i];
            var row = buildRow(c.name, c.metas.map(function (m) { return posterCard(m, c.type); }));
            if (c.loading) { row.className += ' row-loading'; row.appendChild(U.el('div', 'row-empty', 'Loading…')); }   // (its place kept: nothing to focus)
            rows.appendChild(row);
            built.push(row);
        }
        if (to >= cats.length) { return; }
        var done = false;
        function more() {
            if (!done) { done = true; appendRows(rows, cats, to); }
            return false;   // not handled: App still runs Focus.move('DOWN')
        }
        built.slice(-2).forEach(function (row) {
            var cards = row.querySelectorAll('.card');
            for (var k = 0; k < cards.length; k++) { cards[k].__navDOWN = more; }
        });
    }

    // Continue Watching: a grid like Discover's (it can hold a lot), scrolling down.
    // Still a .row with a .row-title (the card's grandparent), so cardKey / findCard find
    // a card again after a rebuild.
    function buildGrid(title, cards) {
        var row = U.el('div', 'row grid-row');
        row.appendChild(U.el('div', 'row-title', title));
        var grid = U.el('div', 'card-grid');
        cards.forEach(function (c) { grid.appendChild(c); });
        row.appendChild(grid);
        return row;
    }

    function buildRow(title, cards) {
        var row = U.el('div', 'row');
        row.appendChild(U.el('div', 'row-title', title));
        var scroller = U.el('div', 'row-scroller');
        cards.forEach(function (c) { scroller.appendChild(c); });
        row.appendChild(scroller);
        return row;
    }

    // ----- published for the other parts (and js/views.js) -----
    V.fillInfoBox = fillInfoBox;
    V.availableTabs = availableTabs;
    V.HOME_TABS = HOME_TABS;
    V.buildRow = buildRow;
    V.clearCatalogCache = clearCatalogCache;
    V.refreshAddonRows = refreshAddonRows;
    V.homeDirty = homeDirty;
    V.markHomeDirty = markHomeDirty;
    V.refreshHomeIfStale = refreshHomeIfStale;
    V.renderHome = renderHome;
    V.alertNewEpisodes = alertNewEpisodes;
    V.previewTiles = previewTiles;
    V.withShowInfo = withShowInfo;
    V.backInLocal = backInLocal;
    V.moveKey = moveKey;
    V.setHomeTab = setHomeTab;
    V.trimMeta = trimMeta;
})(ViewParts);
