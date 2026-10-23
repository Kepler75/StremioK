/* Views, part 1 of 6 — shared pieces: dialogs (confirm, pick lists, addon / playlist actions), the top menu, poster cards, Add to Continue Watching and poster long-press actions.
   Parts share one namespace, ViewParts (V): each part publishes the functions the
   others use, and borrows theirs through the small forwarders below (resolved when
   called, so load order only matters for js/views.js, which assembles Views). */
var ViewParts = {};
(function (V) {
    'use strict';

    // ----- from the other parts -----
    function availableTabs() { return V.availableTabs.apply(null, arguments); }   // home
    function menuItems() { return V.menuItems.apply(null, arguments); }   // home
    function clearCatalogCache() { return V.clearCatalogCache.apply(null, arguments); }   // home
    function refreshAddonRows() { return V.refreshAddonRows.apply(null, arguments); }   // home
    function epCode() { return V.epCode.apply(null, arguments); }   // detail
    function episodeWatched() { return V.episodeWatched.apply(null, arguments); }   // detail
    function markHomeDirty() { return V.markHomeDirty.apply(null, arguments); }   // home
    function nextUp() { return V.nextUp.apply(null, arguments); }   // detail
    function renderSettings() { return V.renderSettings.apply(null, arguments); }   // settings

    function scr(name) { return U.byId('screen-' + name); }

    // ---------- confirm modal (D-pad friendly) ----------
    var _modalOpen = false;
    var _modalPrevFocus = null;
    var _modalScope = null;

    // opts (optional): { noLabel, onNo, plain } — another label and an action for the other
    // button; plain: the confirm button not marked as destructive.
    function confirm(message, confirmLabel, onYes, opts) {
        opts = opts || {};
        // defensive: never stack modals
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', message));
        var row = U.el('div', 'modal-row');
        var no = U.el('div', 'pill focusable modal-btn', opts.noLabel || 'Cancel');
        var yes = U.el('div', 'pill focusable modal-btn' + (opts.plain ? '' : ' danger'), confirmLabel || 'Confirm');
        no.__onselect = function () { closeModal(); if (opts.onNo) { opts.onNo(); } };
        yes.__onselect = function () { closeModal(); onYes(); };
        row.appendChild(no);
        row.appendChild(yes);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        showModal(overlay, no);   // default to Cancel (safe)
    }

    // A QR code for the phone (an addon's link or setup page): the code holds the whole link;
    // what's written under it is masked (keys, tokens: as everywhere on screen). lines: notes.
    function qrSpot(text) {
        var spot = U.el('div', 'qr-spot');
        (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
            var cv = U.qrCanvas(text, 0, { level: 'L', quiet: 2, fit: 260 });
            if (cv) { spot.appendChild(cv); }
        }, function () {});
        return spot;
    }
    function qrModal(title, text, lines) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay'), box = U.el('div', 'modal-box qr-box');
        box.appendChild(U.el('div', 'modal-msg', title));
        box.appendChild(qrSpot(text));
        box.appendChild(U.el('div', 'qr-link', U.redactUrl ? U.redactUrl(text) : text));
        (lines || []).forEach(function (l) { box.appendChild(U.el('div', 'qr-note', l)); });
        var row = U.el('div', 'modal-row'), done = U.el('div', 'pill focusable modal-btn', 'Done');
        done.__onselect = function () { closeModal(); };
        row.appendChild(done);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, done);
    }
    // Text from the phone, or typed: a QR to the service's one-time page on the home network
    // (YTPlay.entryOpen; what's sent there arrives here), and Type it (the TV's keyboard).
    // o: { title, what ('link' | …), typeTitle, placeholder, hint, validate(text) -> problem or
    // null, onText(text), onType (optional: Type it does this instead of opening the TV's keyboard
    // screen, e.g. back to a field already on screen) }
    var ENTRY_POLL_MS = 900;
    function phoneEntry(o) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay'), box = U.el('div', 'modal-box qr-box');
        box.appendChild(U.el('div', 'modal-msg', o.title));
        var spot = U.el('div', 'qr-spot'), how = U.el('div', 'qr-note', 'Opening the page for your phone…'), link = U.el('div', 'qr-link', '');
        box.appendChild(spot); box.appendChild(link); box.appendChild(how);
        var row = U.el('div', 'modal-row');
        var cancel = U.el('div', 'pill focusable modal-btn', 'Cancel'), type = U.el('div', 'pill focusable modal-btn', 'Type it');
        var token = null, timer = null, over = false;
        function stop() {
            over = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (token && YTPlay.entryClose) { YTPlay.entryClose(token); token = null; }
            try { document.removeEventListener('visibilitychange', hidden, false); } catch (e) {}
        }
        // (StremioK in the background: the page closes; the service also closes it once the TV
        // stops asking)
        function hidden() { if (U.isHidden && U.isHidden() && !over) { closeModal(); } }
        try { document.addEventListener('visibilitychange', hidden, false); } catch (e) {}
        cancel.__onselect = function () { closeModal(); };
        type.__onselect = function () {
            closeModal();
            if (o.onType) { o.onType(); return; }
            App.openEntry({ title: o.typeTitle || o.title, placeholder: o.placeholder || '', hint: o.hint || '', validate: o.validate || function () { return null; },
                onConfirm: function (v) { App.back(); o.onText(('' + v).trim()); } });
        };
        row.appendChild(cancel); row.appendChild(type);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, type);
        onModalClose(stop);
        function poll() {
            timer = setTimeout(function () {
                timer = null;
                if (over) { return; }
                YTPlay.entryPoll(token).then(function (text) {
                    if (over) { return; }
                    if (text === null) { poll(); return; }
                    token = null;   // (collected: the service closed it)
                    closeModal();
                    var bad = o.validate ? o.validate(text) : null;
                    if (bad) { U.toast(bad, 5000); return; }
                    o.onText(text);
                }, function () { if (!over) { how.textContent = 'The phone page closed. Type it instead, or try again.'; token = null; } });
            }, ENTRY_POLL_MS);
        }
        if (typeof YTPlay === 'undefined' || !YTPlay.entryOpen) { how.textContent = 'Type it with the TV’s keyboard.'; return; }
        YTPlay.ensureService().then(function () { return YTPlay.entryOpen(o.what); }).then(function (r) {
            if (over) { if (r && r.token) { YTPlay.entryClose(r.token); } return; }
            token = r.token;
            spot.appendChild(qrSpotCanvas(r.url));
            link.textContent = r.url;
            how.textContent = 'Scan it with your phone (on the same Wi-Fi as the TV), then type or paste it there. Only for the next 5 minutes, and once. It travels unencrypted over your home network: use it only on a network you trust.';
            poll();
        }, function () { if (!over) { how.textContent = 'Your phone can’t reach the TV just now (no home network, or StremioK’s service isn’t running): type it instead.'; } });
    }
    function qrSpotCanvas(text) { var s = qrSpot(text); s.className = ''; return s; }

    // Show `overlay` (already in the page) as the modal: focus moves into it, and
    // closeModal() returns focus to where it was on the screen underneath.
    function showModal(overlay, focusNode) {
        _modalPrevFocus = Focus.current();
        _modalScope = _current();          // remember which screen is under the modal
        _modalOpen = true;
        Focus.setScope(overlay, focusNode);
    }
    function isModalOpen() { return _modalOpen; }
    // fn runs when the modal closes (e.g. to stop polling); null clears it
    function onModalClose(fn) { _modalOnClose = fn; }

    var _modalOnClose = null;
    function closeModal() {
        var o = document.querySelector('.modal-overlay');
        if (o) { document.body.removeChild(o); }
        _modalOpen = false;
        if (_modalOnClose) { var f = _modalOnClose; _modalOnClose = null; try { f(); } catch (e) {} }
        if (_modalScope) { Focus.setScope(_modalScope, _modalPrevFocus); }
        _modalScope = null; _modalPrevFocus = null;
    }

    // A YouTube channel or playlist (StremioK's own, or YouTubio's): its source for your
    // YouTube catalogs (Settings › Content › YouTube), or '' when it isn't one.
    function youTubeList(id) {
        var m = ('' + (id || '')).match(/^(?:ytk:[cp]:|yt_id:)((?:UC[A-Za-z0-9_-]{22})|(?:(?:PL|UU|OL|FL)[A-Za-z0-9_-]{10,64}))$/);
        return (m && typeof YouTube !== 'undefined') ? m[1] : '';
    }
    function addYouTubeCatalog(meta) {
        var src = youTubeList(meta.id), name = meta.name || meta.title || src;
        if (YouTube.catalogFor(src)) { U.toast('“' + name + '” is already one of your YouTube catalogs'); return; }
        confirm('Add “' + name + '” to your YouTube catalogs? It becomes a row on Home and a catalog in Discover (Settings › Content › YouTube).', 'Add', function () {
            if (!YouTube.add({ src: src, name: name })) { U.toast('Couldn\'t add it (40 catalogs at most)'); return; }
            refreshAddonRows('local:youtube');
            U.toast('Added “' + name + '” to your YouTube catalogs', 3000);
        });
    }

    function addonActions(name, url) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }

        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box actions-box');   // (as wide as its buttons)

        box.appendChild(U.el('div', 'modal-msg', 'Update “' + name + '”'));

        var row = U.el('div', 'modal-row');

        var cancel = U.el('div', 'pill focusable modal-btn', 'Cancel');
        var refresh = U.el('div', 'pill focusable modal-btn', 'Refresh');
        var remove = U.el('div', 'pill focusable modal-btn danger', 'Remove');
        // Turn off / on: kept in your list, not asked for anything while it's off (a backup)
        var isOff = !!(Stremio.isAddonOff && Stremio.isAddonOff(url));
        var onoff = U.el('div', 'pill focusable modal-btn', isOff ? 'Turn on' : 'Turn off');
        onoff.__onselect = function () {
            closeModal();
            Stremio.setAddonOff(url, !isOff);
            refreshAddonRows();   // (its rows come or go; nothing else is fetched)
            U.toast(isOff ? '“' + name + '” is on' : '“' + name + '” is off: not asked for anything until you turn it on', 4000);
            renderSettings();
        };

        cancel.__onselect = function () {
            closeModal();
        };

        refresh.__onselect = function () {
            closeModal();
            U.spinner(true);
  
            Stremio.refreshAddon(url).then(function () {   // just this one; the others keep theirs
                refreshAddonRows(url);
                U.spinner(false);
                U.toast('Addon refreshed');
                renderSettings();
            }, function () {
                U.spinner(false);
                var why = Stremio.manifestProblem ? Stremio.manifestProblem(url) : '', said = Stremio.manifestDetail ? Stremio.manifestDetail(url) : '';
                U.toast('Could not refresh addon' + (why ? ' (' + why + ')' : '') + (said ? ': ' + said : ''), said ? 8000 : 3000);
                renderSettings();   // (its row shows the reason)
            });
        };

        remove.__onselect = function () {
            closeModal();
            Stremio.removeAddon(url);
            refreshAddonRows();   // its rows go; nothing else is fetched
            U.toast('Removed');
            setTimeout(renderSettings, 300);
        };

        // Share: a QR of its link (to add it elsewhere); Configure: of its setup page (its
        // manifest says it has one), to change its settings on the phone
        var base = ('' + url).replace(/\/manifest\.json(\?.*)?$/, '');
        var share = U.el('div', 'pill focusable modal-btn', 'Share');
        share.__onselect = function () {
            qrModal('Share “' + name + '”', url, ['Scan it to add this addon on another device. It carries the personal parts of its link (your tokens and settings): show it only to your own devices.']);
        };
        var m = Stremio.savedManifest ? Stremio.savedManifest(url) : null, bh = (m && m.behaviorHints) || {};
        var configure = (bh.configurable || bh.configurationRequired) ? U.el('div', 'pill focusable modal-btn', 'Configure') : null;
        if (configure) {
            configure.__onselect = function () {
                qrModal('Configure “' + name + '”', base + '/configure', ['Scan it to change this addon’s settings on your phone. Then add the new link it gives you (Settings › Content › Addons): it replaces this one.']);
            };
        }
        row.appendChild(cancel);
        row.appendChild(refresh);
        row.appendChild(onoff);
        if (configure) { row.appendChild(configure); }
        row.appendChild(share);
        row.appendChild(remove);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        showModal(overlay, cancel);
        }

    function playlistActions(playlist, label) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }

        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box actions-box');   // (as wide as its buttons)
        box.appendChild(U.el('div', 'modal-msg', 'Update “' + label + '”'));

        var row = U.el('div', 'modal-row');
        var cancel = U.el('div', 'pill focusable modal-btn', 'Cancel');
        var rename = U.el('div', 'pill focusable modal-btn', 'Rename');
        var onoff = U.el('div', 'pill focusable modal-btn', playlist.off ? 'Turn on' : 'Turn off');
        var edit = U.el('div', 'pill focusable modal-btn', 'Edit link');
        var guide = U.el('div', 'pill focusable modal-btn', 'Guide link');
        var fmt = IPTV.xtreamFormat ? IPTV.xtreamFormat(playlist.id) : '';   // (an Xtream account: MPEG-TS or HLS)
        var format = U.el('div', 'pill focusable modal-btn', 'Format: ' + (fmt === 'hls' ? 'HLS' : 'MPEG-TS'));
        format.__onselect = function () {
            closeModal();
            Stremio.iptvSetXtreamFormat(playlist.id, fmt === 'hls' ? 'ts' : 'hls');
            refreshAddonRows('local:iptv');
            U.toast('Its channels now play as ' + (fmt === 'hls' ? 'MPEG-TS' : 'HLS') + ' (reading the account again…)', 4000);
            renderSettings();
        };
        var reload = U.el('div', 'pill focusable modal-btn', 'Reload');
        var remove = U.el('div', 'pill focusable modal-btn danger', 'Remove');

        cancel.__onselect = function () { closeModal(); };
        rename.__onselect = function () {
            closeModal();
            App.openEntry({
                title: 'Rename IPTV playlist',
                hint: 'Type a name (up to 60 characters), then Confirm. Empty uses the playlist’s own name, or its server’s. RETURN cancels.',
                value: playlist.name || '', placeholder: label,
                validate: function (v) { return ('' + v).trim().length > 60 ? 'Up to 60 characters' : null; },
                onConfirm: function (v) {
                    Stremio.iptvRenamePlaylist(playlist.id, v);
                    refreshAddonRows('local:iptv');   // (channels show the playlist they're from)
                    U.toast(('' + v).trim() ? 'Playlist renamed' : 'Playlist name cleared');
                    App.back(); renderSettings();
                }
            });
        };
        onoff.__onselect = function () {
            closeModal();
            Stremio.iptvSetPlaylistOff(playlist.id, !playlist.off);
            refreshAddonRows('local:iptv');
            U.toast(playlist.off ? 'Playlist on: its channels are back' : 'Playlist off: its channels are hidden (nothing is deleted)', 3000);
            renderSettings();
        };
        edit.__onselect = function () {
            closeModal();
            App.openEntry({
                title: 'Edit IPTV playlist', phone: 'playlist',
                hint: 'Update the M3U/M3U8 playlist URL, then Confirm. RETURN cancels.',
                value: playlist.url, placeholder: 'https://example.com/playlist.m3u',
                validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                onConfirm: function (v) {
                    Stremio.iptvUpdatePlaylist(playlist.id, v);
                    refreshAddonRows('local:iptv');   // just the IPTV rows
                    U.toast('Playlist updated');
                    App.back(); renderSettings();
                }
            });
        };
        guide.__onselect = function () {   // its TV guide: yours, or the playlist's own (empty)
            closeModal();
            App.openEntry({
                title: 'TV guide link', phone: 'playlist',
                hint: 'An XMLTV guide (.xml or .xml.gz), then Confirm. Empty uses the playlist’s own (the one it names, or an Xtream playlist’s). RETURN cancels.',
                value: playlist.guide || '', placeholder: 'https://example.com/guide.xml.gz',
                validate: function (v) { return ('' + v).trim() ? (U.urlProblem(v) || null) : null; },
                onConfirm: function (v) {
                    Stremio.iptvSetPlaylistGuide(playlist.id, v);
                    U.toast(('' + v).trim() ? 'Guide link set: reading it…' : 'Back to the playlist’s own guide', 3000);
                    App.back(); renderSettings();
                }
            });
        };
        reload.__onselect = function () {
            closeModal();
            U.toast('Reloading playlist…', 4000);
            Stremio.iptvReload(playlist.id).then(function () {
                refreshAddonRows('local:iptv');
                var st = Stremio.iptvStatus(playlist.id);
                U.toast(st.error ? ('Reload failed: ' + st.error) : ('Loaded ' + st.count + ' channels'), 4000);
                renderSettings();
            });
        };
        remove.__onselect = function () {
            closeModal();
            Stremio.iptvRemovePlaylist(playlist.id);
            refreshAddonRows('local:iptv');
            U.toast('Playlist removed');
            setTimeout(renderSettings, 300);
        };

        row.appendChild(cancel);
        row.appendChild(rename);
        row.appendChild(onoff);
        row.appendChild(edit);
        if (!playlist.off && typeof EPG !== 'undefined' && EPG.available && EPG.available()) { row.appendChild(guide); }
        if (!playlist.off && fmt) { row.appendChild(format); }
        if (!playlist.off) { row.appendChild(reload); }
        row.appendChild(remove);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        showModal(overlay, cancel);
    }

    // A scrollable single-choice list overlay (D-pad). options = [[value,label],...]; an
    // optional third entry is a CSS font-family to preview the option in (subtitle fonts).
    function pickList(title, options, current, onPick) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box pick-box');
        box.appendChild(U.el('div', 'modal-msg', title));
        var listEl = U.el('div', 'pick-list');
        var pref = null;
        options.forEach(function (opt) {
            var it = U.el('div', 'pick-item focusable' + (opt[0] === current ? ' sel' : ''));
            if (opt[3]) {   // optional color swatch (Appearance)
                var sw = U.el('span', 'swatch');
                sw.style.background = opt[3];
                it.appendChild(sw);
            }
            it.appendChild(document.createTextNode(opt[1]));
            if (opt[2]) { it.style.fontFamily = opt[2]; }
            it.__onselect = function () { closeModal(); onPick(opt[0]); };
            if (opt[0] === current) { pref = it; }
            listEl.appendChild(it);
        });
        box.appendChild(listEl);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        showModal(overlay, pref);
    }

    // Ticks in a popup (what to import): nothing ticked at first; OK on one ticks or unticks it,
    // Select all ticks every one that can be (again: none); the button counts what's ticked.
    // items: [{ key, label, have (already yours: shown as such, can't be ticked), note }];
    // opts: { button(n) -> its label, haveText }; onDone(keys) on the button with something
    // ticked (Cancel / BACK: nothing).
    function pickMany(title, items, opts, onDone) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box pick-box');
        box.appendChild(U.el('div', 'modal-msg', title));
        var listEl = U.el('div', 'pick-list'), on = {}, nodes = [];
        var can = items.filter(function (it) { return !it.have; });
        var go = U.el('div', 'pill focusable modal-btn');
        function ticked() { return items.filter(function (it) { return on[it.key]; }).map(function (it) { return it.key; }); }
        function drawGo() { go.textContent = opts.button(ticked().length); }
        var all = U.el('div', 'pick-item focusable', 'Select all');
        all.__onselect = function () {
            var every = can.every(function (it) { return on[it.key]; });
            can.forEach(function (it) { on[it.key] = !every; });
            nodes.forEach(function (n) { n.__draw(); });
            all.textContent = every ? 'Select all' : 'Select none';
            drawGo();
        };
        if (can.length > 1) { listEl.appendChild(all); }
        items.forEach(function (it) {
            var n = U.el('div', 'pick-item focusable');
            n.__draw = function () {
                n.textContent = (on[it.key] ? '✓  ' : '') + it.label +
                    (it.have ? '   (' + (opts.haveText || 'already added') + ')' : it.note ? '   (' + it.note + ')' : '');
                if (on[it.key]) { n.classList.add('sel'); } else { n.classList.remove('sel'); }
            };
            n.__onselect = function () {
                if (it.have) { U.toast(opts.haveText ? 'That one is ' + opts.haveText : 'You already have that one', 2000); return; }
                on[it.key] = !on[it.key]; n.__draw(); drawGo();
            };
            n.__draw();
            nodes.push(n);
            listEl.appendChild(n);
        });
        box.appendChild(listEl);
        var row = U.el('div', 'modal-row');
        go.__onselect = function () {
            var keys = ticked();
            if (!keys.length) { U.toast('Nothing ticked: OK on one ticks it', 2500); return; }
            closeModal();
            onDone(keys);
        };
        drawGo();
        var cancel = U.el('div', 'pill focusable modal-btn', 'Cancel');
        cancel.__onselect = function () { closeModal(); };
        row.appendChild(go);
        row.appendChild(cancel);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, listEl.firstChild || cancel);
    }

    function _current() {
        var names = ['home', 'discover', 'detail', 'search', 'settings', 'addaddon'];
        for (var i = 0; i < names.length; i++) {
            var e = scr(names[i]);
            if (e && e.className.indexOf('hidden') === -1) { return e; }
        }
        return scr('settings');
    }

    // ---------- shared bits ----------
    // Text-entry page header: page title on the left, StremioK on the right (same
    // placement as buildTopMenu(), used by Home / Search / Settings).
    function header(title) {
        var h = U.el('div', 'header');
        h.appendChild(U.el('div', 'header-title', title || ''));
        h.appendChild(U.el('div', 'spacer'));
        var brand = U.el('div', 'brand');
        brand.innerHTML = 'Stremio<span class="dot">K</span>';
        h.appendChild(brand);
        return h;
    }

    // The shared top menu, used on Home / Search / Settings so they look and navigate
    // the same: Watching, then the tabs, Discover and Search in your order (menuItems), then
    // Settings, on the left; StremioK on the right.
    // `active` is the key of the current view: a tab key, 'search' or 'settings'.
    function buildTopMenu(active) {
        var head = U.el('div', 'header home-header');
        // Going UP into the menu always lands on the current view's item (not the pill
        // nearest the column you left), and remembers where you came from so DOWN
        // returns there. A re-render (e.g. switching tabs) starts fresh.
        head.__onEnter = function (from) {
            head.__lastContent = from;
            return head.querySelector('.tab-pill.active, .hchip.active');
        };
        function down() { return focusBelowTop(head); }
        var tabbar = U.el('div', 'tabbar-inline');
        // a pill: a Home tab, Discover (browse any catalog in full, its own screen), Search;
        // Settings a chip like them (name, then icon), after them
        function item(cls, key, label, icon, open, into) {
            var p = U.el('div', cls + ' focusable' + (key === active ? ' active' : ''));
            p.appendChild(document.createTextNode(label));
            p.appendChild(U.el('span', 'tab-ic', icon));
            p.__onselect = open;
            p.__navDOWN = down;
            into.appendChild(p);
        }
        menuItems().forEach(function (m) {
            if (m.tab) { item('tab-pill', m.key, m.tab.label, m.tab.icon, function () { App.goHome(m.key); }, tabbar); }
            else if (m.key === 'discover') { item('tab-pill', 'discover', 'Discover', '🔭', function () { App.openDiscover(); }, tabbar); }
            else if (m.key === 'search') { item('hchip', 'search', 'Search', '🔍', function () { App.openSearch(); }, tabbar); }
        });
        head.appendChild(tabbar);
        item('hchip', 'settings', 'Settings', '⚙', function () { App.openSettings(); }, head);

        head.appendChild(U.el('div', 'spacer'));
        var brand = U.el('div', 'brand');
        brand.innerHTML = 'Stremio<span class="dot">K</span>';
        if (Player.isPrivate && Player.isPrivate()) { brand.className += ' private'; }   // (private viewing on: drawn as an outline)
        head.appendChild(brand);
        return head;
    }

    // DOWN from the top menu returns to where focus was before going UP (if it's still
    // on screen), else the first focusable in the content area below the menu.
    function focusBelowTop(head) {
        var last = head && head.__lastContent;
        if (last && document.documentElement.contains(last)) {
            var lr = last.getBoundingClientRect();
            if (lr.width > 0 && lr.height > 0) { Focus.setFocus(last); return true; }
        }
        var s = _current();
        var all = s.querySelectorAll('.focusable');
        for (var i = 0; i < all.length; i++) {
            var r = all[i].getBoundingClientRect();
            if (r.height > 0 && r.top > 80) { Focus.setFocus(all[i]); return true; }
        }
        return false;
    }

    // A title's id (a movie's or a show's, from IMDb, TMDB, TVDB or an anime database), and
    // the anime types some addons use for them (AIOMetadata: "anime.movie", "anime.series").
    var TITLE_ID = /^(tt\d|tmdb:|tvdb:|tvdbc:|mal:|kitsu:|anilist:|anidb:|tvmaze:)/;
    function titleType(t) { return t === 'anime.movie' ? 'movie' : t === 'anime.series' ? 'series' : t; }

    function posterCard(meta, fallbackType) {
        var landscape = Stremio.getPrefs().posterShape === 'landscape';
        var c = U.el('div', 'card focusable' + (landscape ? ' landscape' : ''));
        c.setAttribute('data-id', meta.id || '');   // lets Home put focus back on it after a rebuild
        var src = meta._cardImage || (landscape ? (meta.background || meta.thumbnail || meta.poster) : (meta.poster || meta.background));   // (_cardImage: DeArrow's, for either shape)
        src = U.cardImage(src, landscape ? 'landscape' : 'poster');   // card-sized, not full-screen artwork
        if (src) {
            var img = U.el('img', 'poster');
            img.onerror = function () {
                if (meta._posterAlt && !img.__alt) { img.__alt = true; U.deferImage(img, U.cardImage(meta._posterAlt, landscape ? 'landscape' : 'poster')); return; }   // (a second picture to try)
                img.style.display = 'none'; c.appendChild(U.el('div', 'fallback', meta.name || meta.title || ''));
            };
            c.appendChild(img);
            U.deferImage(img, src);
        } else {
            c.appendChild(U.el('div', 'fallback', meta.name || meta.title || ''));
        }
        c.appendChild(U.el('div', 'cap', meta.name || meta.title || ''));
        c.__meta = meta;   // shown above the rows on Home while focused
        var kind = meta.type || fallbackType;
        if ((kind === 'movie' || kind === 'series') && meta.id && Player.isWatched(kind, meta.id)) { c.appendChild(U.el('div', 'card-watched', '✓')); }
        var rating = parseFloat(meta.imdbRating);   // (Ratings on posters: the catalog's own, nothing downloaded)
        if (rating > 0 && rating <= 10 && Stremio.getPrefs().posterRatings) { c.appendChild(U.el('div', 'card-rating', '★ ' + rating.toFixed(1))); }   // (a series: marked watched whole, see setTitleWatched / the title page)
        if (kind === 'movie' || kind === 'series') { c.__onlongpress = function () { posterActions(meta, kind, c); }; }
        else if (youTubeList(meta.id)) { c.__onlongpress = function () { addYouTubeCatalog(meta); }; }   // (a channel / playlist: to your YouTube)
        else if (/^iptv:/.test(meta.id || '') && typeof EPG !== 'undefined') {   // an IPTV channel: what's on, and its schedule
            guideOnCard(c, meta.id);
            c.__onlongpress = function () { liveSchedule(meta, c); };
        }
        c.__onselect = function () {
            var t = titleType(meta.type || fallbackType);
            // Live TV catalogs (anything that isn't movies/series) skip the info page and
            // go straight to Play — auto-playing when there's a single source. YouTube videos
            // and channels (YouTubio's "YouTube", Stremio's "channel") are titles: their page
            // (a video plays from it at once, a channel lists its videos). So is anything that
            // is a movie or series itself, or has a title's id, whatever its catalog's type
            // (AIOMetadata's "anime" catalogs list movies and series: "mal:28851", a movie).
            var isTitle = t === 'movie' || t === 'series' || TITLE_ID.test(meta.id || '');
            if (fallbackType && fallbackType !== 'movie' && fallbackType !== 'series' && !isTitle && !/^(youtube|channel)$/i.test(fallbackType) && !/^(ytk|yt_id):/.test(meta.id || '')) {
                App.openLive(t, meta.id, meta, rowChannels(c));
            } else {
                App.openDetail(t, meta.id, meta);
            }
        };
        return c;
    }

    // ---- TV guide (js/epg.js) on IPTV channel cards ----
    // What's on now, under the channel's name, with how far along it is; drawn again when the
    // guide brings more (the cards still on a page; the most recent GUIDE_CARDS).
    var _guideCards = [], GUIDE_CARDS = 3000;
    function guideOnCard(card, id) {
        drawGuide(card, id);
        _guideCards.push(card);
        if (_guideCards.length > GUIDE_CARDS) { _guideCards = _guideCards.slice(-GUIDE_CARDS); }
    }
    function drawGuide(card, id) {
        guideLogo(card, id);
        var g = EPG.now(id), old = card.querySelector('.card-epg');
        if (!g || !g.now) { if (old) { card.removeChild(old); } return; }
        var t = Date.now() / 1000, pct = Math.max(0, Math.min(100, Math.round((t - g.now.start) / (g.now.stop - g.now.start) * 100)));
        var box = old || U.el('div', 'card-epg');
        U.clear(box);
        box.appendChild(U.el('div', 'card-epg-t', g.now.title));
        var bar = U.el('div', 'card-epg-bar'), fill = U.el('i', 'card-epg-fill');
        fill.setAttribute('style', 'width: ' + pct + '%');
        bar.appendChild(fill);
        box.appendChild(bar);
        if (!old) { card.appendChild(box); }
    }
    // A channel card without a picture (no tvg-logo): its guide's logo, once it's known; the
    // name stays until it has loaded.
    function guideLogo(card, id) {
        var src = !card.__guideLogo && !card.querySelector('img.poster') && EPG.logo(id);
        if (!src) { return; }
        card.__guideLogo = true;
        var img = U.el('img', 'poster'), fb = card.querySelector('.fallback');
        img.style.visibility = 'hidden';
        img.onload = function () { img.style.visibility = ''; if (fb && fb.parentNode) { fb.parentNode.removeChild(fb); } };
        img.onerror = function () { if (img.parentNode) { img.parentNode.removeChild(img); } };
        card.insertBefore(img, card.firstChild);
        U.deferImage(img, U.cardImage(src, 'landscape'));
    }
    function redrawGuideCards() {
        _guideCards = _guideCards.filter(function (c) { return document.documentElement.contains(c); });
        _guideCards.forEach(function (c) { drawGuide(c, c.getAttribute('data-id')); });
    }
    if (typeof EPG !== 'undefined') {
        EPG.onChange(redrawGuideCards);
        // every minute: the cards' progress bars (and what's on, once it changed) along with the time
        setInterval(function () {
            if (!_guideCards.length || document.hidden || (typeof Player !== 'undefined' && Player.isActive())) { return; }
            redrawGuideCards();
        }, 60000);
    }
    // Hold OK on a channel card: ▶ Watch now, ★ Add to / Remove from favorites, and its schedule
    // from 2 hours ago to tomorrow (what's on now marked, and picked); OK on a program says
    // what it is. A channel without a guide: the first two.
    var _schedGen = 0;
    function liveSchedule(meta, card) {
        var gen = ++_schedGen;
        U.spinner(true);
        EPG.schedule(meta.id).then(null, function () { return []; }).then(function (list) {
            if (gen !== _schedGen) { return; }   // (held on another card since: its own)
            U.spinner(false);
            if (!document.documentElement.contains(card) || (typeof Player !== 'undefined' && Player.isActive())) { return; }   // (left meanwhile)
            var fav = IPTV.isFavorite(meta.id), t = Date.now() / 1000, at = 'play';
            var items = [['play', '▶  Watch now'], ['fav', fav ? '★  Remove from favorites' : '★  Add to favorites']];
            list.forEach(function (p, i) {
                var on = p.start <= t && t < p.stop;
                if (on) { at = 'p' + i; }
                items.push(['p' + i, (on ? '●  ' : '') + EPG.dayTime(p.start) + '   ' + p.title]);
            });
            pickList((meta.name || '') + (list.length ? '  ·  TV guide' : ''), items, at, function (v) {
                if (v === 'play') { card.__onselect(); return; }
                if (v === 'fav') {
                    IPTV.setFavorite(meta.id, !fav);
                    U.toast(fav ? 'Removed from favorites' : 'Added to favorites: ★ Favorites, first on the IPTV tab', 3000);
                    refreshAddonRows('local:iptv');
                    return;
                }
                var p = list[+v.slice(1)];
                if (p) { U.toast(EPG.dayTime(p.start) + '–' + EPG.hhmm(p.stop) + '   ' + p.title + (p.desc ? ':  ' + p.desc : ''), 8000); }
            });
        });
    }

    // The channels of the row a live card sits in, for CH+/CH− while it plays.
    function rowChannels(card) {
        var sib = card.parentNode ? card.parentNode.children : [card], list = [], idx = 0;
        for (var i = 0; i < sib.length; i++) {
            if (!sib[i].__meta) { continue; }
            if (sib[i] === card) { idx = list.length; }
            list.push({ meta: sib[i].__meta, card: sib[i] });
        }
        return { list: list, idx: idx };
    }

    // Long-press on a movie / series poster: open it, add it to (or remove it from) Now
    // Playing, or mark it watched / unwatched (a series as a whole). The title's details
    // are fetched first (usually cached) so the choices match its current state.
    function posterActions(meta, type, card) {
        U.spinner(true);
        titleActions(meta, type).then(function (a) {
            U.spinner(false);
            pickList(a.name, a.items, null, a.run);
        });
    }
    // What a title's hold-OK menu offers, wherever it's held (a poster; the player's Cast & more,
    // in its own menu): -> Promise of { name, items: [[key, label]], run(key) } — Details, Add to
    // / Remove from Continue Watching, Mark watched / unwatched (a series: when its episodes load).
    function titleActions(meta, type) {
        return Stremio.getMeta(type, meta.id).then(null, function () { return null; }).then(function (full) {
            var m = Object.assign({ id: meta.id, type: type }, meta, full || {});
            var eps = (type === 'series') ? (m.videos || []) : null;
            var opts = [['details', 'Details']];
            if (type === 'movie' || eps.length) {
                opts.push(['np', inNowPlaying(type, m.id) ? 'Remove from Continue Watching' : 'Add to Continue Watching']);
            }
            var watched = (type === 'movie') ? Player.isWatched('movie', m.id) : (eps.length > 0 && eps.every(episodeWatched));
            if (type === 'movie' || eps.length) {
                opts.push(['watched', watched ? 'Mark unwatched' : (type === 'series' ? 'Mark whole series watched' : 'Mark watched')]);
            }
            // Rate on Trakt (connected, a title with an IMDb id): yours shown once rated
            var canRate = typeof Trakt !== 'undefined' && Trakt.isConnected() && Trakt.rate && /^tt\d+$/.test(m.id);
            var mine = canRate ? Trakt.myRating(type, m.id) : null;
            if (canRate) { opts.push(['rate', mine ? 'Your rating: ' + mine + ' · change' : 'Rate on Trakt']); }
            return { name: m.name || m.title || '', items: opts, run: function (v) {
                if (v === 'details') { App.openDetail(type, m.id, meta); }
                else if (v === 'np') { toggleNowPlaying(type, m); }
                else if (v === 'watched') { setTitleWatched(type, m, !watched); }
                else if (v === 'rate') { rateOnTrakt(type, m.id, m.name || m.title || ''); }
            } };
        });
    }

    // 1 to 10, as Trakt words them; Remove rating when it has yours. kind: 'movie' | 'series' |
    // 'season' (id 'tt…:N').
    var TRAKT_RATINGS = ['Weak Sauce', 'Terrible', 'Bad', 'Poor', 'Meh', 'Fair', 'Good', 'Great', 'Superb', 'Totally Ninja!'];
    function rateOnTrakt(kind, id, name) {
        var mine = Trakt.myRating(kind, id), opts = [];
        for (var n = 10; n >= 1; n--) { opts.push(['' + n, n + ' · ' + TRAKT_RATINGS[n - 1]]); }
        if (mine) { opts.push(['0', 'Remove rating']); }
        pickList('Rate “' + name + '” on Trakt', opts, mine ? '' + mine : null, function (v) {
            Trakt.rate(kind, id, +v);
            U.toast(+v ? 'Rated ' + v + ' on Trakt' : 'Rating removed on Trakt');
        });
    }
    V.rateOnTrakt = rateOnTrakt;
    // Watched / unwatched for a whole movie or series. Marking watched also drops it from
    // Continue Watching (a finished title leaves the row).
    function setTitleWatched(type, m, on) {
        if (type === 'movie') {
            Player.setWatched('movie', m.id, on);
            if (on) { Player.removeProgress('movie', m.id); }
        } else {
            Player.setWatchedMany('series', (m.videos || []).map(function (v) { return v.id; }), on);
            Player.setWatched('series', m.id, on);   // (the show itself: its cards' tick)
            if (on) { nowPlayingEntries('series', m.id).forEach(function (e) { Player.removeProgress(e.type, e.id); }); }
        }
        watchedTicks(m.id, on);
        markHomeDirty();
        U.toast(on ? 'Marked watched' : 'Marked unwatched');
    }
    // Every card of this title on screen, in every row (Home, Discover, Search): its ✓.
    function watchedTicks(id, on) {
        var cards = document.querySelectorAll('.card');
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].getAttribute('data-id') !== id) { continue; }
            var badge = cards[i].querySelector('.card-watched');
            if (on && !badge) { cards[i].appendChild(U.el('div', 'card-watched', '✓')); }
            if (!on && badge) { cards[i].removeChild(badge); }
        }
    }

    // ----- Add to Continue Watching -----
    // Lists a title in Continue Watching without playing it:
    // a movie as itself, a series as its next-up episode (what Resume / Play would start).
    // It stays there until it's finished or removed.
    // (Trakt's Watching entries too — its paused titles, a show's next episode — when connected:
    // they're in Watching as much as StremioK's own are)
    function nowPlayingEntries(type, id) {
        var all = Player.continueList();
        if (typeof Trakt !== 'undefined' && Trakt.isConnected && Trakt.isConnected() && Trakt.continueList) { all = all.concat(Trakt.continueList()); }
        return all.filter(function (e) {
            return e.type === type && (e.id === id || e.parent === id || (type === 'series' && ('' + e.id).split(':')[0] === id));
        });
    }
    function inNowPlaying(type, id) { return nowPlayingEntries(type, id).length > 0; }
    function toggleNowPlaying(type, m) {
        var present = nowPlayingEntries(type, m.id);
        if (present.length) {
            present.forEach(function (e) {   // (Trakt's: hidden from Watching, as Watching's own Remove does)
                if (e._trakt) { if (Trakt.dismiss) { Trakt.dismiss(e.type, e.id); } } else { Player.removeProgress(e.type, e.id); }
            });
            U.toast('Removed from Continue Watching');
        } else if (type === 'movie') {
            Player.addToContinue({ id: m.id, type: 'movie', name: m.name || m.title, poster: m.poster, background: m.background, parent: m.id });
            U.toast('Added to Continue Watching');
        } else {
            var v = nextUp(m).v;
            Player.addToContinue({ id: v.id, type: 'series', name: (m.name || '') + '  ' + epCode(v), poster: m.poster, background: m.background, parent: m.id });
            U.toast('Added to Continue Watching');
        }
        markHomeDirty();
    }
    // The button's label, for a title page's meta (checked by the same id toggleNowPlaying
    // adds and removes by: the id the title's details came with, which can differ from the
    // one it was opened by, e.g. a TMDB id in Discover for an IMDb one).
    function nowPlayingLabel(type, id) { return inNowPlaying(type, id) ? '✓  In Continue Watching' : '+  Add to Continue Watching'; }

    // "Hold OK for more": shown while the focused item has a menu of its own behind a held OK
    // (a card, a season, an episode, a source, a file on the USB drive…), so those menus can
    // be found. In #app: hidden with it during playback.
    var _holdHint = null;
    Focus.onFocus(function (node) {
        if (!_holdHint) {
            var app = U.byId('app');
            if (!app) { return; }
            _holdHint = U.el('div', 'hidden', 'Hold OK for more');
            _holdHint.id = 'hold-hint';
            app.appendChild(_holdHint);
        }
        _holdHint.className = (node && typeof node.__onlongpress === 'function') ? '' : 'hidden';
    });

    // ----- published for the other parts (and js/views.js) -----
    V._current = _current;
    V.addonActions = addonActions;
    V.buildTopMenu = buildTopMenu;
    V.closeModal = closeModal;
    V.confirm = confirm;
    V.qrModal = qrModal;
    V.phoneEntry = phoneEntry;
    V.header = header;
    V.isModalOpen = isModalOpen;
    V.nowPlayingLabel = nowPlayingLabel;
    V.inNowPlaying = inNowPlaying;
    V.onModalClose = onModalClose;
    V.pickList = pickList;
    V.pickMany = pickMany;
    V.playlistActions = playlistActions;
    V.posterCard = posterCard;
    V.posterActions = posterActions;
    V.titleActions = titleActions;
    V.scr = scr;
    V.showModal = showModal;
    V.toggleNowPlaying = toggleNowPlaying;
})(ViewParts);
