/* Bootstrap + navigation router. Global namespace: App */
var App = (function () {
    'use strict';

    var _current = 'home';
    var _stack = [];   // frames: { screen, focus }
    var _lastBackAt = 0;   // debounce BACK across keydown + tizenhwkey
    var _exitArmedAt = 0;  // double-Back-to-exit guard on the home root

    function screenEl(name) { return U.byId('screen-' + name); }

    function showScreen(name) {
        if (name !== _current) { U.crumb(name); }
        ['home', 'discover', 'detail', 'search', 'settings', 'addaddon'].forEach(function (n) {
            var el = screenEl(n);
            if (el) { el.className = 'screen' + (n === name ? '' : ' hidden'); }
        });
        _current = name;
    }

    // Title / person pages kept whole behind the current one; further back, only what to open.
    var DETAIL_KEPT = 6;
    function pushFrame() {
        var f = { screen: _current, focus: Focus.current() };
        // Leaving a title / person page for another one: keep it to redraw on Back.
        if (_current === 'detail') { f.detail = Views.detailSnapshot(); }
        _stack.push(f);
        for (var i = _stack.length - 1, kept = 0; i >= 0; i--) {
            var d = _stack[i].detail;
            if (d && !d.light && ++kept > DETAIL_KEPT && Views.lightSnapshot) { _stack[i].detail = Views.lightSnapshot(d); }
        }
    }

    function openDetail(type, id, preview, target, opts) {
        if (!id) { return; }
        U.crumb('title ' + type + ' ' + ('' + id).slice(0, 40));
        pushFrame();
        showScreen('detail');
        Views.renderDetail(type, id, preview, target, opts);
    }

    // Go to a Home tab from the shared top menu (works from any screen).
    // A screen left for good (BACK out of it, or Home from the menu: not one kept to come back
    // to): what it was still downloading is stopped.
    function abandon(name) { if (Views.leaveScreen) { Views.leaveScreen(name); } }

    function goHome(tab) {
        U.crumb('home: ' + tab);
        Views.setHomeTab(tab);
        ['detail', 'discover', 'search'].forEach(abandon);   // (the stack cleared: none of them is coming back)
        _stack = [];           // Home is the root
        showScreen('home');
        Views.renderHome();
        focusOn('home');
    }

    // Live TV: skip the info page — load sources and (if a single one) play immediately.
    // channels: { list: [{ meta, card }], idx } — the row it was picked from, for CH+/CH−
    function openLive(type, id, preview, channels) {
        if (!id) { return; }
        pushFrame();
        showScreen('detail');
        Views.renderLive(type, id, preview, channels);
    }

    // A person's page (from a title's cast row).
    function openPerson(personId, name) {
        pushFrame();
        showScreen('detail');
        Views.renderPerson(personId, name);
    }

    // Close a live player directly back to the screen/card that launched it. The
    // originating screen stays mounted while the player is open, so restoring its
    // saved focus node also preserves the grid's horizontal and vertical scroll.
    // focusNode: the card to land on instead (the channel you switched to with CH+/CH−); liveId:
    // that channel, for the Guide tab, which lands on it at the time now (Views.guideBackOn: its
    // cells from when it was played may be gone, or show hours long past).
    function returnFromLive(focusNode, liveId) {
        var f = _stack.pop();
        if (!f) { goHome(); return; }
        if (f.screen !== _current) { abandon(_current); }
        showScreen(f.screen);
        var guide = liveId && f.screen === 'home' && Views.guideBackOn ? Views.guideBackOn(liveId) : null;
        var alt = focusNode && document.documentElement.contains(focusNode) ? focusNode : null;
        Focus.setScope(screenEl(f.screen), guide || alt || f.focus);
    }

    // After a screen is drawn, focus must be on it. A drawing path that doesn't put it there
    // leaves it on the screen just hidden, where the remote seems frozen until BACK.
    function focusOn(name) {
        var el = screenEl(name), cur = Focus.current();
        if (el && !(cur && el.contains(cur))) { Focus.setScope(el); }
    }

    function openSettings() {
        pushFrame();
        showScreen('settings');
        Views.settingsRoot();
        focusOn('settings');
    }

    function openSearch() {
        pushFrame();
        showScreen('search');
        Views.renderSearch();
        focusOn('search');
    }

    function openDiscover() {
        pushFrame();
        showScreen('discover');
        Views.renderDiscover();
        focusOn('discover');
    }

    function openEntry(cfg) {
        pushFrame();
        showScreen('addaddon');
        Views.renderEntry(cfg);
    }

    // On a main page (Home's tabs, Discover, Search, Settings), BACK goes to the top menu first
    // (its current item; DOWN comes back), and from there does what it did: the page before,
    // or "Press Back again to exit" on Home. Also a way out if focus is ever lost on a page.
    var MAIN_SCREENS = { home: 1, discover: 1, search: 1, settings: 1 };
    function toTopMenu() {
        if (!MAIN_SCREENS[_current]) { return false; }
        var scr = screenEl(_current), head = scr && scr.querySelector('.home-header');
        if (!head) { return false; }
        var cur = Focus.current();
        if (cur && head.contains(cur) && scr.contains(cur)) { return false; }   // (there already)
        var item = head.querySelector('.tab-pill.active, .hchip.active') || head.querySelector('.focusable');
        if (!item) { return false; }
        head.__lastContent = (cur && scr.contains(cur)) ? cur : null;
        Focus.setScope(scr, item);
        return true;
    }

    function back() {
        if (Player.isActive()) { Player.exit(); return; }
        if (Views.isModalOpen()) { Views.closeModal(); return; }
        if (_current === 'detail' && Views.backInDetail()) { return; }
        if (_current === 'settings' && Views.backInSettings()) { return; }
        if (_current === 'home' && Views.backInLocal && Views.backInLocal()) { return; }   // (the Local tab: up a folder)
        if (toTopMenu()) { return; }
        var f = _stack.pop();
        if (!f) { tryExitApp(); return; }
        if (f.screen !== _current) { abandon(_current); }
        showScreen(f.screen);
        if (f.detail) { Views.restoreDetail(f.detail); return; }   // the previous title / person page
        // Refresh home when returning if Continue Watching / poster / addons changed, or
        // its rows are stale; focus goes back to the card the user left from.
        if (f.screen === 'home' && Views.homeDirty()) {
            Views.renderHome(f.focus);
        } else {
            Focus.setScope(screenEl(f.screen), f.focus);
        }
    }

    // Require a deliberate double-Back from the home root to exit, so a single stray
    // Back (e.g. left over from closing the player) can never close the app by accident.
    function tryExitApp() {
        var now = Date.now();
        if (now - _exitArmedAt < 3000) {
            try {
                if (window.AndroidApp && AndroidApp.exitApp) {
                    U.sessionState('exit');
                    AndroidApp.exitApp();
                    return;
                }
                if (window.tizen && tizen.application) {
                    U.sessionState('exit');
                    tizen.application.getCurrentApplication().exit();
                    return;
                }
            } catch (e) {}
        }
        _exitArmedAt = now;
        U.toast('Press Back again to exit', 3000);
    }

    function onKey(action) {
        // Debounce BACK globally (before any routing): keydown(10009) and tizenhwkey both
        // fire for one press, and during playback the first goes to the player — without
        // this, the duplicate leaks through after exit and can close the app.
        if (action === 'BACK') {
            var nowb = Date.now();
            if (nowb - _lastBackAt < 500) { return true; }
            _lastBackAt = nowb;
        }
        if (action === 'GUIDE') { guideKey(); return true; }
        if (Player.isActive()) { return Player.handleKey(action); }   // (a held OK too: the player's Cast & more has a menu behind it)
        if (Views.moveKey && Views.moveKey(action)) { return true; }   // (a Continue Watching card being moved)
        switch (action) {
            case 'LEFT': Focus.move('LEFT'); return true;
            case 'RIGHT': Focus.move('RIGHT'); return true;
            case 'UP': {
                // an item can decide where UP goes (e.g. Discover's first row -> its pickers)
                var cu = Focus.current();
                if (cu && cu.__navUP && cu.__navUP() !== false) { return true; }
                Focus.move('UP');
                return true;
            }
            case 'DOWN': {
                var c = Focus.current();
                if (c && c.__navDOWN && c.__navDOWN() !== false) { return true; }
                Focus.move('DOWN');
                return true;
            }
            case 'OK': Focus.clickCurrent(); return true;
            case 'OK_LONG': {
                var cur = Focus.current();
                if (cur && cur.__onlongpress) { cur.__onlongpress(cur); }
                else { Focus.clickCurrent(); }
                return true;
            }
            case 'BACK': back(); return true;
            default:
                if (/^NUM\d$/.test(action)) { numberKey(+action.slice(3)); }
                return true;
        }
    }

    // The remote's GUIDE key: the Guide tab (once a TV guide is read: it's in the top menu), the
    // player closed first. Not over a popup, nor while an addon's link is typed.
    function guideKey() {
        var on = (Views.menuItems ? Views.menuItems() : []).some(function (m) { return m.key === 'guide'; });
        if (!on) { U.toast('No TV guide yet (Settings › Content › IPTV › Guide link)', 3000); return; }
        if (Player.isActive()) { Player.exit(); }
        else if (Views.isModalOpen() || _current === 'addaddon') { return; }
        goHome('guide');
    }

    // Number keys away from the player: 0 Settings, 1–9 the top menu's items as they show (1:
    // Watching, the rest in your order: Views.menuItems). Not over a popup, nor on a page where
    // something's being typed.
    function numberKey(n) {
        if (Views.isModalOpen() || _current === 'addaddon') { return; }
        if (n === 0) { if (_current !== 'settings') { openSettings(); } return; }
        var m = (Views.menuItems ? Views.menuItems() : [])[n - 1];
        if (!m) { return; }
        if (m.key === 'discover') { if (_current !== 'discover') { openDiscover(); } }
        else if (m.key === 'search') { if (_current !== 'search') { openSearch(); } }
        else { goHome(m.key); }
    }

    function actualStart() {
        Player.init();
        Keys.init();
        Keys.setHandler(onKey);
        Views.applyAppearance();   // background / accent color from Settings
        // The TV's database filled with old versions of what was saved: tidied up, once started
        setTimeout(function () { if (U.bigStore && U.bigStore.tidyIfNeeded) { U.bigStore.tidyIfNeeded(); } }, 30000);
        // New episodes out for the shows in Watching: said once, half a minute in (Home's ready)
        setTimeout(function () { if (Views.alertNewEpisodes && !Player.isActive()) { Views.alertNewEpisodes(); } }, 30000);
        showScreen('home');
        Views.renderHome();
        U.mark('firstScreen');
        if (typeof LocalMedia !== 'undefined') { LocalMedia.watch(); }   // (a USB drive plugged in? the Local tab; nothing read from it)
        document.addEventListener('visibilitychange', function () { U.sessionState(document.hidden ? 'hidden' : 'running'); }, false);
        // The TV keeps the app running in the background for days: when it comes back
        // to the foreground on Home, reload rows older than 15 minutes.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden || _current !== 'home' || Player.isActive() || Views.isModalOpen()) { return; }
            Views.refreshHomeIfStale();
        }, false);
        // Pull Trakt watched + playback in the background, then refresh Home if still there.
        if (typeof Trakt !== 'undefined' && Trakt.isConnected()) {
            Trakt.refreshCaches().then(function () { if (_current === 'home') { Views.renderHome(); } });
        }
    }

    // On a cold launch the stylesheet fetch can race/fail, leaving the app unstyled.
    // Confirm the CSS applied (sentinel width) before rendering; re-request it if not.
    function start() {
        U.sessionStart();   // (did the last one close without exiting? Settings > Diagnostics)
        // Script errors nothing caught: into Settings > Diagnostics instead of vanishing
        try {
            window.addEventListener('error', function (ev) {
                U.log('script', (ev && ev.message ? ev.message : 'error') + (ev && ev.filename ? ' (' + ('' + ev.filename).split('/').pop().split('?')[0] + ':' + ev.lineno + ')' : ''));
            }, false);
            // A failure nothing waited for (newer TVs report these; Tizen 3 doesn't): one a
            // download already noted, or a stopped one, isn't noted twice.
            window.addEventListener('unhandledrejection', function (ev) {
                var r = ev && ev.reason;
                if (r && (r.logged || r.cancelled)) { return; }
                U.log('script', 'Unhandled failure: ' + ((r && (r.message || r.name)) || ('' + r)).slice(0, 300));
            }, false);
        } catch (e) {}
        // The TV's app list, for opening "where to watch" links in them (TVApps.appForService)
        if (typeof TVApps !== 'undefined' && TVApps.available()) { TVApps.installed().then(null, function () {}); }
        function styled() {
            var s = document.getElementById('css-sentinel');
            return s && s.offsetWidth === 11;
        }
        // Not applied (a failed read on a cold start): asked again through one extra
        // stylesheet node (its address changed each time, never a new node), at once and after
        // 1, 2, 4 and 8 s; started as soon as it applies (its load event, or a check every
        // 250 ms where the TV doesn't report that), else after the last wait anyway (logged).
        var started = false, poll = null, timer = null, attempt = 0, retryLink = null;
        function go(why) {
            if (started) { return; }
            started = true;
            if (poll) { clearInterval(poll); }
            if (timer) { clearTimeout(timer); }
            if (styled()) { U.mark('css'); } else if (why) { U.log('display', why); }
            actualStart();
        }
        function check() { if (styled()) { go(); } }
        if (styled()) { go(); return; }
        function retry() {
            if (started) { return; }
            if (attempt >= CSS_RETRY_MS.length) { go('The stylesheet didn’t load: started without it'); return; }
            if (!retryLink) {
                retryLink = document.createElement('link');
                retryLink.rel = 'stylesheet';
                retryLink.onload = check;
                document.head.appendChild(retryLink);
            }
            retryLink.href = 'css/style.css?rl=' + Date.now();
            timer = setTimeout(retry, CSS_RETRY_MS[attempt++]);
        }
        poll = setInterval(check, 250);
        retry();
    }
    var CSS_RETRY_MS = [1000, 2000, 4000, 8000];

    return {
        start: start, back: back,
        openDetail: openDetail, openLive: openLive, openPerson: openPerson, openDiscover: openDiscover, returnFromLive: returnFromLive, goHome: goHome,
        openSettings: openSettings, openSearch: openSearch, openEntry: openEntry
    };
})();

window.onload = function () { App.start(); if (typeof HubPreview !== 'undefined') { HubPreview.start(); } };
