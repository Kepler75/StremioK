/* Views, part 5 of 6 — text-entry pages (add addon / playlist) and Settings with its sections.
   Parts share one namespace, ViewParts (V): each part publishes the functions the
   others use, and borrows theirs through the small forwarders below (resolved when
   called, so load order only matters for js/views.js, which assembles Views). */
(function (V) {
    'use strict';

    // ----- from the other parts -----
    function addonActions() { return V.addonActions.apply(null, arguments); }   // core
    function buildTopMenu() { return V.buildTopMenu.apply(null, arguments); }   // core
    function clearCatalogCache() { return V.clearCatalogCache.apply(null, arguments); }   // home
    function refreshAddonRows() { return V.refreshAddonRows.apply(null, arguments); }   // home
    function closeModal() { return V.closeModal.apply(null, arguments); }   // core
    function confirm() { return V.confirm.apply(null, arguments); }   // core
    function header() { return V.header.apply(null, arguments); }   // core
    function isModalOpen() { return V.isModalOpen.apply(null, arguments); }   // core
    function markHomeDirty() { return V.markHomeDirty.apply(null, arguments); }   // home
    function onModalClose() { return V.onModalClose.apply(null, arguments); }   // core
    function pickList() { return V.pickList.apply(null, arguments); }   // core
    function toggleList() { return V.toggleList.apply(null, arguments); }   // core
    function playlistActions() { return V.playlistActions.apply(null, arguments); }   // core
    function scr() { return V.scr.apply(null, arguments); }   // core
    function showModal() { return V.showModal.apply(null, arguments); }   // core
    function pickMany() { return V.pickMany.apply(null, arguments); }   // core

    // ================= GENERIC TEXT-ENTRY PAGE =================
    // cfg = { title, hint, value, placeholder, validate(v)->err|null, onConfirm(v) }
    // Field kept high on its own page so the on-screen keyboard never covers it.
    function renderEntry(cfg) {
        var s = scr('addaddon');
        U.clear(s);
        s.appendChild(header(cfg.title || 'Enter value'));

        var wrap = U.el('div', 'add-wrap');
        if (cfg.hint) { wrap.appendChild(U.el('div', 'add-hint', cfg.hint)); }

        var input = document.createElement('input');
        input.id = 'entry-input';
        input.type = cfg.secret ? 'password' : 'text';
        input.className = 'focusable add-input';
        input.value = cfg.value || '';
        if (cfg.placeholder) { input.placeholder = cfg.placeholder; }
        input.__onselect = function () {
            input.focus();
            var n = input.value.length;
            try { input.setSelectionRange(n, n); } catch (e) {}
        };
        input.onkeydown = function (ev) {
            if (ev.keyCode === 13) { if (ev.stopPropagation) { ev.stopPropagation(); } doConfirm(); }
        };
        wrap.appendChild(input);

        var row = U.el('div', 'add-btn-row');
        var confirmBtn = U.el('div', 'pill focusable', 'Confirm');
        var cancelBtn = U.el('div', 'pill focusable', 'Cancel');
        confirmBtn.__onselect = doConfirm;
        cancelBtn.__onselect = function () { App.back(); };

        // Order: Validate · Confirm · Cancel
        var valBtn = null;
        if (cfg.validator) {
            valBtn = U.el('div', 'pill focusable', 'Validate');
            valBtn.__onselect = function () {
                var v = ('' + input.value).trim();
                if (!v) { U.toast('Enter a key first'); return; }
                U.toast('Validating…', 4000);
                cfg.validator(v).then(function (ok) {
                    U.toast(ok ? '✓ Key is valid' : '✗ Key rejected (or unreachable)', 3500);
                });
            };
            row.appendChild(valBtn);
        }
        row.appendChild(confirmBtn);
        // From your phone (cfg.phone: what it's for): what's sent fills the field, to check and Confirm
        if (cfg.phone && V.phoneEntry) {
            var phoneBtn = U.el('div', 'pill focusable', '▣  From your phone');
            phoneBtn.__onselect = function () {
                V.phoneEntry({ title: cfg.title || 'Enter value', what: cfg.phone, validate: cfg.validate,
                    onText: function (t) { input.value = t; Focus.setFocus(confirmBtn); U.toast('From your phone: check it, then Confirm', 3500); },
                    onType: function () { Focus.setFocus(input); } });
            };
            row.appendChild(phoneBtn);
        }
        row.appendChild(cancelBtn);
        wrap.appendChild(row);

        // DOWN from the field lands on Validate (or Confirm when there's no validator)
        input.__navDOWN = function () { Focus.setFocus(valBtn || confirmBtn); return true; };

        s.appendChild(wrap);
        Focus.setScope(s, input);

        function doConfirm() {
            var v = ('' + input.value).trim();
            var err = cfg.validate ? cfg.validate(v) : null;
            if (err) { U.toast(err); return; }
            cfg.onConfirm(v);
        }
    }

    // ================= SUBTITLE CONFIG =================
    var SUB_LANGS = [['off', 'Off'], ['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'],
        ['ger', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['dut', 'Dutch'],
        ['rus', 'Russian'], ['ara', 'Arabic'], ['tur', 'Turkish'], ['pol', 'Polish']];
    // A second choice, turned on when nothing is in the default language (from any source).
    var SUB_LANGS2 = [['none', 'None']].concat(SUB_LANGS.slice(1));
    var SUB_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra Large']];

    function labelFor(list, v) {
        for (var i = 0; i < list.length; i++) { if (list[i][0] === v) { return list[i][1]; } }
        return v;
    }
    // A player setting row; OK opens a scrollable list picker. `store` ({get, set})
    // defaults to the subtitle settings.
    function subPickRow(caption, list, key, store) {
        store = store || { get: Player.getSubCfg, set: Player.setSubCfg };
        var row = U.el('div', 'addon-item focusable cfg-row');
        var name = U.el('div', 'a-name');
        function render() { name.textContent = caption + ':  ' + labelFor(list, store.get()[key]); }
        render();
        row.appendChild(name);
        row.appendChild(U.el('div', 'a-url', 'Press OK to choose'));
        row.__onselect = function () {
            pickList(caption, list, store.get()[key], function (v) {
                var cfg = store.get(); cfg[key] = v; store.set(cfg);
                render();
            });
        };
        return row;
    }

    // Audio: same languages as subtitles, with "use the first track" in place of Off, and
    // a second choice for when the first isn't on the stream.
    var AUDIO_LANGS = [['default', 'Default (first track)']].concat(SUB_LANGS.slice(1));
    var AUDIO_LANGS2 = [['none', 'None']].concat(SUB_LANGS.slice(1));
    // Switching to it, one choice: Quick (picked before it plays; a later switch reloads at
    // once), or Safe (picked once it plays) whose reload waits 3, 6 or 10 s after a start or a
    // jump: the 2017 TV's player crashes on a jump made right after another (10 s it needed).
    var AUDIO_SWITCH = [['quick', 'Quick (no wait)'], ['safe3', 'Safe, waits 3 seconds'], ['safe6', 'Safe, waits 6 seconds'], ['safe10', 'Safe, waits 10 seconds (safest)']];
    function settingsAudio(wrap) {
        var store = { get: Player.getAudioCfg, set: Player.setAudioCfg };
        var switching = {
            get: function () { var a = Player.getAudioCfg(); return { mode: a.switch === 'quick' ? 'quick' : 'safe' + a.wait }; },
            set: function (cfg) {
                var a = Player.getAudioCfg(), quick = cfg.mode === 'quick';
                a.switch = quick ? 'quick' : 'safe';
                a.wait = quick ? 0 : (parseInt(('' + cfg.mode).slice(4), 10) || 10);
                Player.setAudioCfg(a);
            }
        };
        wrap.appendChild(U.el('h2', null, 'Audio'));
        wrap.appendChild(subPickRow('Preferred language', AUDIO_LANGS, 'lang', store));
        wrap.appendChild(subPickRow('Second choice', AUDIO_LANGS2, 'lang2', store));
        wrap.appendChild(subPickRow('Switching to it', AUDIO_SWITCH, 'mode', switching));
        wrap.appendChild(U.el('div', 'hint',
            'The track in your preferred language plays on its own; with none, the second choice. The red key switches while watching. ' +
            'Switching to it: Quick starts in your language at once. Safe is for files where Quick names your language but you hear another (the 2017 TV needs 10 seconds).'));
        focusSettings();
    }

    // Appearance: background and accent color, applied right away and at every launch.
    var ACCENT_NAMES = { indigo: 'Indigo (default)', sky: 'Sky', teal: 'Teal', emerald: 'Emerald',
        amber: 'Amber', orange: 'Orange', rose: 'Rose', violet: 'Violet', gray: 'Gray', darkgray: 'Dark gray' };
    // darkest to lightest (Dark is the default)
    var BACKGROUNDS = [['black', 'Black', null, '#000000'], ['dark', 'Dark', null, '#0e1117'],
        ['gray', 'Light Gray', null, '#e4e6ea'], ['white', 'White', null, '#ffffff']];
    function appearance() {
        var p = Stremio.getPrefs();
        var accent = p.accent, bg = p.bg;
        var bgs = { dark: 1, black: 1, gray: 1, white: 1 };
        return { accent: ACCENT_NAMES[accent] ? accent : 'indigo', bg: bgs[bg] ? bg : 'dark' };
    }
    function applyAppearance() {
        var a = appearance();
        U.applyTheme(a.accent, a.bg);
    }
    function settingsAppearance(wrap) {
        var store = { get: appearance, set: function (cfg) {
            Stremio.setPref('accent', cfg.accent);
            Stremio.setPref('bg', cfg.bg);
            applyAppearance();
        } };
        var accents = U.ACCENT_KEYS.map(function (k) { return [k, ACCENT_NAMES[k] || k, null, U.accentColor(k)]; });
        wrap.appendChild(U.el('h2', null, 'Appearance'));
        wrap.appendChild(subPickRow('Background', BACKGROUNDS, 'bg', store));
        wrap.appendChild(subPickRow('Accent color', accents, 'accent', store));
        wrap.appendChild(subPickRow('Poster orientation', POSTER_SHAPES, 'posterShape', {
            get: function () { return { posterShape: Stremio.getPrefs().posterShape }; },
            set: function (cfg) { Stremio.setPref('posterShape', cfg.posterShape); markHomeDirty(); }   // Home redraws on return
        }));
        wrap.appendChild(subPickRow('Ratings on posters', [['off', 'Off'], ['on', 'On']], 'posterRatings', {
            get: function () { return { posterRatings: Stremio.getPrefs().posterRatings ? 'on' : 'off' }; },
            set: function (cfg) { Stremio.setPref('posterRatings', cfg.posterRatings === 'on'); markHomeDirty(); }
        }));
        if (typeof HubPreview !== 'undefined' && HubPreview.available()) {   // (the sideloaded app: see js/hubpreview.js)
            // one choice: the tiles' order, or none (sent at once, whatever the wait)
            wrap.appendChild(subPickRow('Home bar preview', [['recent', 'Most recent first'], ['watching', 'As in Watching'], ['off', 'Off']], 'homeBar', {
                get: function () { var p = Stremio.getPrefs(); return { homeBar: p.homePreview ? p.homePreviewOrder : 'off' }; },
                set: function (cfg) {
                    Stremio.setPref('homePreview', cfg.homeBar !== 'off');
                    if (cfg.homeBar !== 'off') { Stremio.setPref('homePreviewOrder', cfg.homeBar === 'watching' ? 'watching' : 'recent'); }
                    HubPreview.send(true);
                }
            }));
        }
        wrap.appendChild(subPickRow('Hide spoilers', [['off', 'Off'], ['pictures', 'Pictures'], ['all', 'Pictures and synopses']], 'spoilers', {
            get: function () { return { spoilers: Stremio.getPrefs().spoilers }; },
            set: function (cfg) { Stremio.setPref('spoilers', cfg.spoilers); }
        }));
        wrap.appendChild(homeTabsRow());
        var feeds = sectionRow('Home feeds  ›', 'Order the Home rows, and show or hide each one', 'feeds');
        feeds.className += ' cfg-row';
        wrap.appendChild(feeds);
        var sfeeds = sectionRow('Search results  ›', 'Order the Search rows (one per catalog that can search), and show or hide each one', 'searchfeeds');
        sfeeds.className += ' cfg-row';
        wrap.appendChild(sfeeds);
        var back = _focusChild === 'feeds' ? feeds : _focusChild === 'searchfeeds' ? sfeeds : null;
        _focusChild = null;
        if (back) { Focus.setScope(scr('settings'), back); } else { focusSettings(); }
    }

    // Formats: what plays on this TV. At the top, your settings: whether failures mark
    // formats "Not working" on their own, and which resolutions are allowed. Below, what's
    // been learned, filling in as sources are played: a format is "Working" once a source
    // with it plays, "Not working" after failed starts that point at it. OK switches one
    // between Working and Not working (your choice then sticks); sources with a "Not
    // working" format or a resolution you don't allow go to the bottom of the source list.
    var FORMAT_GROUPS = ['Video profile', 'Video', 'HDR', 'Audio', 'File', 'Other'];
    var FORMAT_STATUS = { ok: 'Working', bad: 'Not working', unknown: 'Not sure yet' };
    function settingsFormats(wrap, focusKey) {
        wrap.appendChild(U.el('h2', null, 'Formats'));
        var pref = null;
        function row(key, name, sub, cls, onSelect) {
            var r = U.el('div', 'addon-item focusable cfg-row format-row ' + cls);
            r.setAttribute('data-fk', key);
            r.appendChild(U.el('div', 'a-name', name));
            r.appendChild(U.el('div', 'a-url', sub));
            r.__onselect = function () { onSelect(); redrawFormats(key); };
            if (key === focusKey) { pref = r; }
            wrap.appendChild(r);
            return r;
        }
        // automatic "Not working" (what's already known stays either way)
        var auto = Stremio.getPrefs().formatsAuto;
        row('auto', 'Mark “Not working” automatically:  ' + (auto ? 'On' : 'Off'),
            auto ? 'Formats that keep failing to start are marked Not working   ·   OK to turn off'
                 : 'Failures aren’t recorded; what’s marked stays, and what plays still counts   ·   OK to turn on',
            'format-' + (auto ? 'ok' : 'unknown'), function () { Stremio.setPref('formatsAuto', !auto); });

        // allowed resolutions: yours to set, all allowed to begin with
        wrap.appendChild(U.el('div', 'formats-group', 'Resolutions'));
        Stremio.resList().forEach(function (r) {
            row('res:' + r.res, r.label + ':  ' + (r.allowed ? 'Allowed' : 'Not allowed'),
                (r.res === 0 ? 'Sources that don’t say   ·   ' : '') + 'OK to ' + (r.allowed ? 'not allow it' : 'allow it'),
                'format-' + (r.allowed ? 'ok' : 'bad'), function () { Stremio.setResAllowed(r.res, !r.allowed); });
        });

        var list = Stremio.formatList();
        if (!list.length) {
            wrap.appendChild(U.el('div', 'hint',
                'No formats yet. Each time you play a source, its formats are added here: its video profile ' +
                '(resolution, codec, bit depth, HDR), audio and file type, as working, or not working if it won’t start.'));
        }
        FORMAT_GROUPS.forEach(function (g) {
            var items = list.filter(function (f) { return f.group === g; });
            if (!items.length) { return; }
            items.sort(function (a, b) { return (a.order - b.order) || (a.label < b.label ? -1 : 1); });   // profiles: 4K first
            wrap.appendChild(U.el('div', 'formats-group', g));
            items.forEach(function (f) {
                var sub = [];
                if (f.ok) { sub.push('played ' + f.ok + (f.ok > 1 ? ' times' : ' time')); }
                if (f.fail) { sub.push('didn’t start ' + f.fail + (f.fail > 1 ? ' times' : ' time')); }
                sub.push(f.set ? 'set by you' : 'OK to mark it ' + (f.status === 'ok' ? 'Not working' : 'Working'));
                row(f.key, f.label + ':  ' + FORMAT_STATUS[f.status], sub.join('   ·   '), 'format-' + f.status, function () {
                    Stremio.setFormat(f.key, f.status === 'ok' ? 'bad' : 'ok');
                });
            });
        });
        if (list.length) {
            var reset = U.el('div', 'addon-item focusable');
            reset.appendChild(U.el('div', 'a-name', 'Forget all formats'));
            reset.appendChild(U.el('div', 'a-url', 'Start learning again from the next source you play (resolutions stay as set)'));
            reset.__onselect = function () {
                confirm('Forget what’s known about every format?', 'Forget', function () { Stremio.resetFormats(); redrawFormats(null); });
            };
            wrap.appendChild(reset);
        }
        wrap.appendChild(U.el('div', 'hint',
            'Sources at a resolution that isn’t allowed, or with a “Not working” format, go to the bottom of the ' +
            'source list; ▶ Play best and Next episode skip them.'));
        if (pref) { Focus.setScope(scr('settings'), pref); } else { focusSettings(); }
    }
    function redrawFormats(focusKey) {
        var s = scr('settings'), wrap = s.querySelector('.settings-wrap');
        U.clear(wrap);
        settingsFormats(wrap, focusKey);
    }

    // ================= SETTINGS (sectioned) =================
    var _settingsSection = 'menu';

    function settingsRoot() { _settingsSection = 'menu'; renderSettings(); }

    // Focus the first item in the settings content (not the top menu) so UP reaches the menu.
    function focusSettings() {
        var s = scr('settings');
        Focus.setScope(s, s.querySelector('.settings-wrap .focusable') || undefined);
    }

    // Settings is four groups (Content, Playback, Appearance, Diagnostics); each opens a page of
    // its sections. [title, description, section] rows; Appearance is its own page (its
    // look settings are right on it, above Home feeds and Search results).
    var SETTINGS_GROUPS = {
        content: { title: 'Content', rows: [
            ['Addons', 'Catalog, stream & subtitle addons', 'addons'],
            ['Integrations', 'API keys (OMDb, TMDB, MDBList), where-to-watch country', 'integrations'],
            ['IPTV', 'Manage M3U playlist URLs', 'iptv'],
            ['YouTube', 'Your YouTube channels, playlists and searches; YouTube in Search', 'youtube'],
            ['Streaming apps', 'Your apps (Prime Video, Netflix, …) that open a title\'s "where to watch" sources', 'appshortcuts'],
            ['USB drive', 'The Local tab: what\'s on your drive, matched to titles; hidden files', 'usb'],
            ['Import configuration file', 'Import addons, API keys & IPTV playlists', 'import']] },
        playback: { title: 'Playback', rows: [
            ['Audio', 'Preferred and second-choice audio language', 'audio'],
            ['Subtitles', 'Default language, size, color, background, position, font', 'subtitles'],
            ['Skipping', 'Intros, recaps and previews, and the next episode at the credits: ask, or on their own after a countdown', 'skipping'],
            ['Seeking & buffering', 'How far ◀ ▶ jump; a bigger buffer for slow connections; reconnecting live channels', 'seeking'],
            ['Source ranking', 'How sources are ordered (played before, resolution, release type…), and your addons: their order, on or off', 'ranking'],
            ['Formats', 'Allowed resolutions, and what plays on this TV, learned as you watch', 'formats'],
            ['Private viewing', 'Play without anything recorded: no progress, Continue Watching, watched marks or Trakt', 'private']] },
        diagnostics: { title: 'Diagnostics', rows: [
            ['Logs', 'Recent problems (failed downloads, playback and script errors), secrets masked; how long launches took', 'logs'],
            ['Storage', 'What StremioK keeps on the TV; the TV’s database: on or off, tidying it up; clearing saved copies', 'storage'],
            ['Installed apps', 'The TV’s apps with their IDs; OK on one opens it', 'tvapps']] }
    };

    // Return true if BACK stepped a settings section back to the menu.
    // BACK goes up one level, onto the row it came from: from a section to its group (on
    // that section, not the first one), from Home feeds / Search results to Appearance,
    // from a group to the Settings list (on that group).
    var SECTION_PARENT = { feeds: 'appearance', searchfeeds: 'appearance', aiomanager: 'addons' };
    Object.keys(SETTINGS_GROUPS).forEach(function (g) {
        SETTINGS_GROUPS[g].rows.forEach(function (row) { SECTION_PARENT[row[2]] = g; });
    });
    var _focusChild = null;   // the section whose row to focus when back on its parent
    function backInSettings() {
        if (_settingsSection === 'menu') { return false; }
        _focusChild = _settingsSection;
        _settingsSection = SECTION_PARENT[_settingsSection] || 'menu';
        renderSettings();
        return true;
    }

    var _crumbSection = null;
    function renderSettings() {
        if (_settingsSection !== _crumbSection) { _crumbSection = _settingsSection; U.crumb('settings: ' + _settingsSection); }
        var s = scr('settings');
        U.clear(s);
        s.appendChild(buildTopMenu('settings'));   // shared top menu (UP reaches it; no Back button)
        var wrap = U.el('div', 'settings-wrap');
        s.appendChild(wrap);
        if (_settingsSection === 'addons') { settingsAddons(wrap); }
        else if (_settingsSection === 'iptv') { settingsIptv(wrap); }
        else if (_settingsSection === 'youtube') { settingsYouTube(wrap); }
        else if (_settingsSection === 'integrations') { settingsIntegrations(wrap); }
        else if (_settingsSection === 'audio') { settingsAudio(wrap); }
        else if (_settingsSection === 'subtitles') { settingsSubtitles(wrap); }
        else if (_settingsSection === 'skipping') { settingsSkipping(wrap); }
        else if (_settingsSection === 'seeking') { settingsSeeking(wrap); }
        else if (_settingsSection === 'feeds') { settingsFeeds(wrap, 'home'); }
        else if (_settingsSection === 'searchfeeds') { settingsFeeds(wrap, 'search'); }
        else if (_settingsSection === 'ranking') { settingsFeeds(wrap, 'ranking'); }
        else if (SETTINGS_GROUPS[_settingsSection]) { settingsGroup(wrap, _settingsSection); }
        else if (_settingsSection === 'logs') { settingsLogs(wrap); }
        else if (_settingsSection === 'storage') { settingsStorage(wrap); }
        else if (_settingsSection === 'tvapps') { settingsTvApps(wrap); }
        else if (_settingsSection === 'usb') { settingsUsb(wrap); }
        else if (_settingsSection === 'private') { settingsPrivate(wrap); }
        else if (_settingsSection === 'appshortcuts') { settingsAppShortcuts(wrap); }
        else if (_settingsSection === 'import') { settingsImport(wrap); }
        else if (_settingsSection === 'aiomanager') { settingsAiom(wrap); }
        else if (_settingsSection === 'appearance') { settingsAppearance(wrap); }
        else if (_settingsSection === 'formats') { settingsFormats(wrap); }
        else { settingsMenu(wrap); }
        var ver = appVersion();
        if (ver) { s.appendChild(U.el('div', 'settings-version', 'StremioK ' + ver)); }
    }

    // The app version, from the ?v= cache-buster build.sh stamps on every script tag
    // (kept in sync with package.json / config.xml; works on TizenBrew and desktop too).
    function appVersion() {
        var tag = document.querySelector('script[src*="views.js"]');
        var m = tag && /[?&]v=([0-9][0-9.]*)/.exec(tag.getAttribute('src') || '');
        return m ? m[1] : '';
    }

    function sectionRow(title, sub, section) {
        var r = U.el('div', 'addon-item focusable');
        r.setAttribute('data-section', section);
        r.appendChild(U.el('div', 'a-name', title));
        if (sub) { r.appendChild(U.el('div', 'a-url', sub)); }
        r.__onselect = function () { _settingsSection = section; renderSettings(); };
        return r;
    }

    // Settings > IPTV's status line while playlists are read (one listener for the app).
    var _iptvStatusEl = null;
    if (typeof IPTV !== 'undefined' && IPTV.onProgress) {
        IPTV.onProgress(function (n) {
            var el = _iptvStatusEl;
            if (el && document.documentElement.contains(el) && /^(Checking|Reading)/.test(el.textContent)) {
                el.textContent = 'Reading playlists…  ' + ('' + n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' channels';
            }
        });
    }

    // TizenBrew serves every module from the same address, so they all share one storage:
    // another module you install can read what StremioK saves (see the README).
    var TIZENBREW_NOTE = '⚠ Installed with TizenBrew: other TizenBrew modules can read what StremioK saves, including API keys and addon links with their tokens. Only install modules you trust; the sideloaded app keeps its data to itself.';
    function settingsMenu(wrap) {
        wrap.appendChild(U.el('h2', null, 'Settings'));
        wrap.appendChild(sectionRow('Content', 'Addons, API keys, IPTV playlists, streaming apps, importing a configuration file', 'content'));
        wrap.appendChild(sectionRow('Playback', 'Audio and subtitles, source ranking, feed sources, formats', 'playback'));
        wrap.appendChild(sectionRow('Appearance', 'Background, accent color, poster orientation, Home feeds, Search results', 'appearance'));
        wrap.appendChild(sectionRow('Diagnostics', 'Logs, storage, installed apps; how StremioK was installed', 'diagnostics'));
        if (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew') { wrap.appendChild(U.el('div', 'hint', TIZENBREW_NOTE)); }
        focusBack(wrap);
    }
    // Back from a section: on its row (not the first one).
    function focusBack(wrap) {
        var backTo = null, rowsNow = wrap.querySelectorAll('.addon-item');
        for (var bi = 0; _focusChild && bi < rowsNow.length; bi++) { if (rowsNow[bi].getAttribute('data-section') === _focusChild) { backTo = rowsNow[bi]; } }
        _focusChild = null;
        if (backTo) { Focus.setScope(scr('settings'), backTo); } else { focusSettings(); }
    }
    // A group's page: its sections; Diagnostics also says how StremioK was installed.
    function settingsGroup(wrap, key) {
        var g = SETTINGS_GROUPS[key];
        wrap.appendChild(U.el('h2', null, g.title));
        g.rows.forEach(function (row) { wrap.appendChild(sectionRow(row[0], row[1], row[2])); });
        if (key === 'diagnostics') {
            if (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew') { wrap.appendChild(U.el('div', 'hint', TIZENBREW_NOTE)); }
            // How StremioK was installed, and whether its YouTube service (channels, trailers) answers
            if (typeof YTPlay !== 'undefined' && YTPlay.installLabel) {
                var about = U.el('div', 'hint settings-about', 'Installed as: ' + YTPlay.installLabel() + '   ·   YouTube service: checking…');
                wrap.appendChild(about);
                YTPlay.isRunning().then(function (up) {
                    about.textContent = 'Installed as: ' + YTPlay.installLabel() + '   ·   YouTube service: ' +
                        (up ? 'running' : YTPlay.installMode() === 'wgt' ? 'starts when needed' : 'not running');
                });
            }
        }
        focusBack(wrap);
    }

    var _addonFocus = null;   // { url, ctl }: the ▲ / ▼ just pressed, focused again once redrawn
    // What an addon gives StremioK, from its manifest: catalogs (how many), search, details,
    // sources, subtitles; and the kinds of titles.
    var TYPE_NAMES = { movie: 'Movies', series: 'Series', anime: 'Anime', tv: 'TV', channel: 'Channels', events: 'Events', sport: 'Sports', radio: 'Radio', other: 'Other' };
    function addonGives(m) {
        var res = (m.resources || []).map(function (r) { return typeof r === 'string' ? r : r && r.name; });
        var cats = m.catalogs || [], bits = [], types = [];
        if (cats.length) { bits.push('Catalogs (' + cats.length + ')'); }
        if (cats.some(function (c) { return (c.extra || []).some(function (e) { return e && e.name === 'search'; }) || (c.extraSupported || []).indexOf('search') !== -1; })) { bits.push('Search'); }
        if (res.indexOf('meta') !== -1) { bits.push('Details'); }
        if (res.indexOf('stream') !== -1) { bits.push('Sources'); }
        if (res.indexOf('subtitles') !== -1) { bits.push('Subtitles'); }
        (m.types || []).forEach(function (t) {
            var n = TYPE_NAMES[t] || (('' + t).charAt(0).toUpperCase() + ('' + t).slice(1));
            if (types.indexOf(n) === -1) { types.push(n); }
        });
        return 'Gives: ' + (bits.length ? bits.join(' · ') : 'nothing StremioK uses') + (types.length ? '   ·   ' + types.slice(0, 8).join(', ') : '');
    }
    // An addon's logo tile: its initial (the first character, an emoji whole; "?" for one that
    // didn't load; drawn by the CSS from data-initial, so the row's text is still its name),
    // and over it the logo from its manifest (Stremio.addonLogo), loaded with the other
    // artwork; one that can't load is taken away, leaving the initial.
    function addonTile(m, url) {
        var name = ('' + ((m && m.name) || '')).replace(/^\s+/, ''), c = name.charCodeAt(0);
        var tile = U.el('div', 'addon-logo');
        tile.setAttribute('data-initial', !m ? '?' : name ? name.slice(0, c >= 0xD800 && c <= 0xDBFF ? 2 : 1).toUpperCase() : 'A');
        var src = Stremio.addonLogo ? Stremio.addonLogo(m, url) : null;
        if (src) {
            var img = document.createElement('img');
            img.onload = function () { tile.className = 'addon-logo loaded'; };
            img.onerror = function () { if (img.parentNode) { img.parentNode.removeChild(img); } tile.className = 'addon-logo'; };
            tile.appendChild(img);
            U.deferImage(img, src);
        }
        return tile;
    }
    function settingsAddons(wrap) {
        wrap.appendChild(U.el('h2', null, 'Addons'));
        // Home-network links from addons on the internet (see Stremio.blocksLocal)
        var allow = !!Stremio.getPrefs().allowLocal;
        var lan = U.el('div', 'addon-item focusable cfg-row');
        lan.appendChild(U.el('div', 'a-name', 'Local-network links from internet addons:  ' + (allow ? 'Allowed' : 'Blocked')));
        lan.appendChild(U.el('div', 'a-url', (allow ? 'An addon on the internet may send links into your home network (router, NAS, cameras…)'
            : 'Links an internet addon points into your home network are left out (your own network’s addons and playlists aren’t affected)') +
            '   ·   OK to ' + (allow ? 'block' : 'allow')));
        lan.__onselect = function () { Stremio.setAllowLocal(!allow); clearCatalogCache(); renderSettings(); };
        wrap.appendChild(lan);
        wrap.appendChild(subPickRow('Wait for addons', ADDON_WAITS, 'addonWait', {
            get: function () { return { addonWait: '' + Stremio.getPrefs().addonWait }; },
            set: function (cfg) { Stremio.setPref('addonWait', +cfg.addonWait || 0); }
        }));
        Stremio.loadAddons().then(function (addons) {
            var urls = Stremio.getAddonUrls(), want = null;
            if (urls.length > 1) { wrap.appendChild(U.el('div', 'hint', '▲ / ▼ set the order: a title\'s details come from the highest addon that has them (its page says which), and the higher addon comes first where several answer.')); }
            urls.forEach(function (url) {
                var off = !!(Stremio.isAddonOff && Stremio.isAddonOff(url)), kept = off && Stremio.savedManifest ? Stremio.savedManifest(url) : null;
                var loaded = addons.find(function (a) { return a.url === url; }) || (kept ? { url: url, manifest: kept } : null);   // (one that's off: its saved manifest)
                var frow = U.el('div', 'feed-row playlist-row' + (off ? ' feed-off' : ''));
                var btns = orderButtons(function (dir, ctl) { if (Stremio.moveAddon(url, dir)) { _addonFocus = { url: url, ctl: ctl }; refreshAddonRows(); renderSettings(); } });
                var item = U.el('div', 'addon-item focusable playlist-item has-logo');
                item.appendChild(addonTile(loaded && loaded.manifest, url));
                var why = !loaded && Stremio.manifestProblem ? Stremio.manifestProblem(url) : '';   // "too large (over 2 MB)", "not an addon manifest"…
                var nm = U.el('div', 'a-name', (loaded ? (loaded.manifest.name || 'Addon') : off ? 'Addon' : '(failed to load' + (why ? ': ' + why : '') + ')') + (off ? '   (off)' : ''));
                var origin = Stremio.addonOrigin ? Stremio.addonOrigin(url) : '', ob = originBadge(origin);
                if (ob) { nm.appendChild(ob); }
                item.appendChild(nm);
                item.appendChild(U.el('div', 'a-url', U.redactUrl(url) + (origin ? '   ·   ' + ORIGIN_BADGE[origin][2] : '')));   // (personal tokens masked)
                if (loaded) { item.appendChild(U.el('div', 'a-url addon-gives', addonGives(loaded.manifest))); }
                var said = !loaded && Stremio.manifestDetail ? Stremio.manifestDetail(url) : '';   // the addon's own error message
                if (said) { item.appendChild(U.el('div', 'a-url addon-said', 'The addon says: ' + said)); }
                var note = Stremio.thirdPartyNote ? Stremio.thirdPartyNote(loaded ? loaded.manifest.id : url) : '';   // (WatchHub)
                if (note) { item.appendChild(U.el('div', 'a-url addon-said', '⚠ ' + note)); }
                var name = loaded ? (loaded.manifest.name || 'Addon') : 'this addon';
                item.__onselect = function () {
                    addonActions(name, url);
                };
                if (urls.length > 1) { btns.forEach(function (b) { frow.appendChild(b); }); }
                frow.appendChild(item);
                wrap.appendChild(frow);
                if (_addonFocus && _addonFocus.url === url) { want = btns[ctlIndex(_addonFocus.ctl)]; }
            });

            var addRow = U.el('div', 'addon-item focusable add-row');
            addRow.appendChild(U.el('div', 'a-name', '+  Add addon'));
            addRow.appendChild(U.el('div', 'a-url', 'Enter a Stremio addon manifest URL on its own page'));
            addRow.__onselect = function () {
                App.openEntry({
                    title: 'Add addon', phone: 'addon',
                    hint: 'Type a Stremio addon manifest URL. Nothing is saved until you Confirm.',
                    value: 'https://', placeholder: 'https://addon.example/manifest.json',
                    validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                    onConfirm: function (v) {
                        var added = Stremio.addAddon(v), note = Stremio.thirdPartyNote(added || v);
                        refreshAddonRows(added || null);
                        U.toast(note ? 'Addon added. ' + note : 'Addon added', note ? 8000 : undefined);
                        App.back(); renderSettings();
                    }
                });
            };
            wrap.appendChild(addRow);
            if (typeof StremioAccount !== 'undefined') {
                var acct = U.el('div', 'addon-item focusable add-row');
                var an = U.el('div', 'a-name', 'Import addons from your Stremio account');
                an.appendChild(originBadge('stremio'));
                acct.appendChild(an);
                acct.appendChild(U.el('div', 'a-url', 'Sign in on your phone with a QR code, then tick the addons to add (StremioK signs out straight after)'));
                acct.__onselect = stremioImport;
                wrap.appendChild(acct);
            }
            if (typeof YTPlay !== 'undefined' && YTPlay.aiomAddons && YTPlay.installMode() !== 'browser') {
                var am = aiomSaved();
                var aio = U.el('div', 'addon-item focusable');
                aio.setAttribute('data-section', 'aiomanager');
                var aname = U.el('div', 'a-name', 'AIOManager' + (am.base ? '  ·  ' + shortHost(am.base) : ''));
                aname.appendChild(originBadge('aiomanager'));
                aio.appendChild(aname);
                aio.appendChild(U.el('div', 'a-url', am.base && am.key ? (am.at ? 'Last synced ' + U.dayLabel(am.at) + '   ·   ' : '') + 'OK for ↻ Sync: refresh, add new, remove the ones gone from it'
                    : 'Your AIOManager’s address and API key, then ↻ Sync your addons with it'));
                aio.__onselect = function () { _settingsSection = 'aiomanager'; renderSettings(); };
                wrap.appendChild(aio);
                if (_focusChild === 'aiomanager') { want = aio; _focusChild = null; }
            }

            wrap.appendChild(U.el('div', 'hint',
                'StremioK hosts no content — add Stremio addon manifest URLs for catalogs, streams and subtitles.'));
            _addonFocus = null;
            if (want) { Focus.setScope(scr('settings'), want); } else { focusSettings(); }
        });
    }

    // Import addons from your Stremio account (js/stremio-account.js): a QR code of Stremio's
    // sign-in link, asked until you approve on your phone; then the account's addons to tick
    // (none ticked; yours already shown as such); the account signed out as soon as it's read.
    function stremioImport() {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay'), box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', 'Import addons from your Stremio account'));
        var body = U.el('div', 'trakt-connect');
        body.appendChild(U.el('div', 'tc-line', 'Asking Stremio for a code…'));
        box.appendChild(body);
        var row = U.el('div', 'modal-row'), cancel = U.el('div', 'pill focusable modal-btn', 'Cancel');
        cancel.__onselect = function () { closeModal(); };
        row.appendChild(cancel);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, cancel);
        var gone = false;
        onModalClose(function () { gone = true; });
        function stopped() { return gone; }
        function fail(e) {
            if (gone) { return; }
            U.clear(body);
            body.appendChild(U.el('div', 'tc-line', 'Couldn’t import: ' + ((e && e.message) || 'unknown')));
        }
        StremioAccount.start().then(function (c) {
            if (gone) { return; }
            U.clear(body);
            var qrSpot = U.el('div', 'tc-qr-spot');
            body.appendChild(qrSpot);
            var goTo = body.appendChild(U.el('div', 'tc-line', 'On your phone or computer, go to:'));
            (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
                var qr = U.qrCanvas(c.link, 8);
                if (!qr || !qrSpot.parentNode) { return; }
                qr.className = 'tc-qr';
                qrSpot.appendChild(U.el('div', 'tc-line', 'Scan with your phone:'));
                qrSpot.appendChild(qr);
                goTo.textContent = 'or go to';
            }, function () {});
            body.appendChild(U.el('div', 'tc-url', c.link));
            body.appendChild(U.el('div', 'tc-line', 'Code:'));
            body.appendChild(U.el('div', 'tc-code', c.code));
            body.appendChild(U.el('div', 'tc-line small', 'Sign in to Stremio there and approve. Waiting…'));
            return StremioAccount.wait(c.code, stopped).then(function (key) {
                if (gone) { StremioAccount.signOut(key); return; }
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', 'Reading your addons…'));
                var read = StremioAccount.addons(key);
                read.then(function () { StremioAccount.signOut(key); }, function () { StremioAccount.signOut(key); });   // (signed out as soon as it's read)
                return read.then(function (list) {
                    if (gone) { return; }
                    if (!list.length) { fail(new Error('your account has no addons StremioK can use')); return; }
                    var mine = Stremio.getAddonUrls();
                    var items = list.map(function (x, i) {
                        var have = mine.indexOf(x.url) !== -1 || mine.indexOf(Stremio.normalizeUrl ? Stremio.normalizeUrl(x.url) : x.url) !== -1;
                        return { key: '' + i, label: x.name + '  ·  ' + shortHost(x.url), have: have };
                    });
                    closeModal();
                    pickMany('Your Stremio addons: tick the ones to add', items, { button: function (n) { return 'Import ' + n + ' addon' + (n === 1 ? '' : 's'); } }, function (keys) {
                        var n = 0, last = null;
                        keys.forEach(function (k) { var added = Stremio.addAddon(list[+k].url); if (added) { n++; last = added; if (Stremio.setAddonOrigin) { Stremio.setAddonOrigin(added, 'stremio'); } } });
                        clearCatalogCache();
                        refreshAddonRows(last);
                        U.toast('Imported ' + n + ' addon' + (n === 1 ? '' : 's'), 3000);
                        renderSettings();
                    });
                });
            });
        }).then(null, function (e) { if (!e || e.message !== 'stopped') { fail(e); } });
    }
    function shortHost(u) { var p = U.parseUrl(u); return p ? p.host : ''; }

    // Settings › Addons › AIOManager (YTPlay.aiomAddons, through the service): its address and
    // the account's API key (kept, AIOM_KEY: { base, key, synced, at, count }), then ↻ Sync:
    // what it would do, none ticked: refresh the addons you share, add the ones you haven't
    // got, remove the ones that came from it (synced) and are gone or off there now. A key it
    // refuses is forgotten (the address stays) and asked for again.
    var AIOM_KEY = 'stremiok.aiomanager';
    // Where an addon came from (Stremio.addonOrigin): a letter badge, and the words for it.
    var ORIGIN_BADGE = { stremio: ['S', 'src-s', 'From Stremio'], aiomanager: ['A', 'src-a', 'From AIOManager'], config: ['C', 'src-c', 'From a configuration file'] };
    function originBadge(kind) { var b = ORIGIN_BADGE[kind]; return b ? U.el('span', 'src-badge ' + b[1], b[0]) : null; }
    function aiomSaved() {
        var x = U.store.get(AIOM_KEY, {}) || {};
        return { base: typeof x.base === 'string' ? x.base : '', key: typeof x.key === 'string' ? x.key : '',
            synced: Array.isArray(x.synced) ? x.synced.filter(function (u) { return typeof u === 'string'; }) : [], at: +x.at || 0, count: +x.count || 0 };
    }
    function aiomSave(patch) {
        var x = aiomSaved();
        Object.keys(patch).forEach(function (k) { x[k] = patch[k]; });
        var out = {};
        Object.keys(x).forEach(function (k) { if (x[k] !== '' && x[k] !== 0 && !(Array.isArray(x[k]) && !x[k].length)) { out[k] = x[k]; } });
        U.store.set(AIOM_KEY, out);
    }
    // AIOManager's public instances (as its own docs list them: src/lib/instances.ts), beta ones
    // left out; then your own address (typed, or from your phone).
    var AIOM_PUBLIC = [['https://aiomanager.elfhosted.com', 'ElfHosted'], ['https://aiomanagerfortheweebs.midnightignite.me', 'Midnight’s'],
        ['https://aiomanager.fortheweak.cloud', 'Yeb’s'], ['https://aiomanager.stremio.ru', 'Kuu’s']];
    function aiomAskAddress(then) {
        var am = aiomSaved();
        pickList('Your AIOManager', AIOM_PUBLIC.map(function (x) { return [x[0], x[1] + '  ·  ' + shortHost(x[0])]; })
            .concat([['other', 'Another address…  (your own: type it, or ▣ from your phone)']]), am.base || null, function (k) {
            if (k === 'other') { aiomTypeAddress(then); return; }
            aiomSetBase(k);
            if (then) { then(); } else { renderSettings(); }
        });
    }
    // Another instance: its key and what came from the old one don't carry over.
    function aiomSetBase(base) {
        var am = aiomSaved();
        if (am.base && am.base !== base) { aiomSave({ base: base, key: '', synced: [], at: 0, count: 0 }); } else { aiomSave({ base: base }); }
    }
    function aiomTypeAddress(then) {
        var am = aiomSaved();
        App.openEntry({
            title: 'Your AIOManager’s address', phone: 'aiom',
            hint: 'The address you open AIOManager at (your instance), e.g. https://aiomanager.example.com. Kept on the TV.',
            value: am.base || 'https://', placeholder: 'https://aiomanager.example.com',
            validate: function (v) { return U.urlProblem(v) || null; },
            onConfirm: function (v) { aiomSetBase(('' + v).trim().replace(/\/+$/, '')); App.back(); if (then) { then(); } else { renderSettings(); } }
        });
    }
    function aiomAskKey(then) {
        App.openEntry({
            title: 'Your AIOManager API key', phone: 'aiomkey', secret: true,
            hint: 'Your account’s API key, from AIOManager (the account’s settings). Kept on the TV like your other API keys; StremioK only reads your addons with it.',
            value: '', placeholder: 'API key',
            validate: function (v) { return /^[\x21-\x7e]{6,300}$/.test(('' + v).trim()) ? null : 'That doesn’t look like an API key'; },
            onConfirm: function (v) { aiomSave({ key: ('' + v).trim() }); App.back(); if (then) { then(); } else { renderSettings(); } }
        });
    }
    function settingsAiom(wrap) {
        wrap.appendChild(U.el('h2', null, 'Addons  ›  AIOManager'));
        wrap.appendChild(U.el('div', 'hint', 'Your addons from AIOManager: its address and your account’s API key, then ↻ Sync. Each change is yours to tick; nothing is sent back to AIOManager.'));
        var am = aiomSaved();
        function row(name, sub, fn) {
            var r = U.el('div', 'addon-item focusable cfg-row');
            r.appendChild(U.el('div', 'a-name', name));
            if (sub) { r.appendChild(U.el('div', 'a-url', sub)); }
            r.__onselect = fn;
            wrap.appendChild(r);
            return r;
        }
        row('Address:  ' + (am.base || 'Not set'), 'Your AIOManager instance   ·   OK to ' + (am.base ? 'change' : 'set'), function () { aiomAskAddress(); });
        row('API key:  ' + (am.key ? '••••' + am.key.slice(-4) : 'Not set'), 'Your account’s, from AIOManager   ·   OK to ' + (am.key ? 'change' : 'set'), function () { aiomAskKey(); });
        if (am.base && am.key) {
            row('↻  Sync with AIOManager', (am.at ? 'Last synced ' + U.dayLabel(am.at) + (am.count ? '   ·   ' + am.count + ' addon' + (am.count === 1 ? '' : 's') + ' in AIOManager' : '') : 'Not synced yet') +
                '   ·   refresh, add new, remove the ones gone from it', aiomSync);
        }
        if (am.base || am.key) {
            row('Forget AIOManager', 'Its address, your API key and what came from it, cleared (your addons stay)', function () { U.store.remove(AIOM_KEY); U.toast('AIOManager forgotten', 2500); renderSettings(); });
        }
        focusSettings();
    }
    function aiomSync() {
        var am = aiomSaved();
        if (!am.base) { aiomAskAddress(aiomSync); return; }
        if (!am.key) { aiomAskKey(aiomSync); return; }
        function norm(u) { return (Stremio.normalizeAddonUrl && Stremio.normalizeAddonUrl(u)) || u; }
        U.toast('Reading your AIOManager addons…', 4000);
        YTPlay.aiomAddons(am.base, am.key).then(function (r) {
            var there = (r && Array.isArray(r.addons) ? r.addons : []).filter(function (x) { return x && U.parseUrl(x.url); });
            var byNorm = {};
            there.forEach(function (x) { byNorm[norm(x.url)] = x; });
            var mine = Stremio.getAddonUrls(), mineNorm = mine.map(norm);
            // Only what came from AIOManager is its to refresh or remove (am.synced: the ones a sync
            // added); an addon you added yourself stays yours, even when AIOManager has it too.
            function fromIt(u) { return am.synced.indexOf(norm(u)) !== -1; }
            var shared = mine.filter(function (u) { var x = byNorm[norm(u)]; return fromIt(u) && x && x.enabled !== false; });
            var add = there.filter(function (x) { return x.enabled !== false && mineNorm.indexOf(norm(x.url)) === -1; });
            var gone = mine.filter(function (u) { var x = byNorm[norm(u)]; return fromIt(u) && (!x || x.enabled === false); });
            var items = [];
            if (shared.length) { items.push({ key: 'refresh', label: '↻ Refresh the ' + shared.length + ' addon' + (shared.length === 1 ? '' : 's') + ' you have from AIOManager' }); }
            add.forEach(function (x, i) { items.push({ key: 'add:' + i, label: '+ Add  ·  ' + U.drawable(x.name || shortHost(x.url)).slice(0, 50) + '  ·  ' + shortHost(x.url) }); });
            gone.forEach(function (u, i) {
                var x = byNorm[norm(u)];
                items.push({ key: 'rm:' + i, label: '− Remove  ·  ' + (x && x.name ? U.drawable(x.name).slice(0, 50) + '  ·  ' : '') + shortHost(u), note: x ? 'off in AIOManager' : 'gone from AIOManager' });
            });
            function done(n, addedUrls) {   // what came from it: as before, and what this sync added (still in your list)
                var now = (addedUrls || []).map(norm);
                var keptUrls = Stremio.getAddonUrls().filter(function (u) { return fromIt(u) || now.indexOf(norm(u)) !== -1; });
                aiomSave({ synced: keptUrls.map(norm), at: Date.now(), count: there.length });
                if (n) { clearCatalogCache(); refreshAddonRows(null); }
                renderSettings();
            }
            if (!items.length) { U.toast('Nothing to sync: AIOManager has no addons StremioK can use', 4000); done(0); return; }
            pickMany('Sync with AIOManager: tick what to do', items, { button: function (n) { return 'Apply ' + n; } }, function (keys) {
                var added = 0, removed = 0, addedUrls = [];
                keys.forEach(function (k) {
                    if (k.indexOf('add:') === 0) { var got = Stremio.addAddon(add[+k.slice(4)].url); if (got) { added++; addedUrls.push(got); Stremio.setAddonOrigin(got, 'aiomanager'); } }
                    else if (k.indexOf('rm:') === 0) { Stremio.removeAddon(gone[+k.slice(3)]); removed++; }
                });
                var refreshing = keys.indexOf('refresh') !== -1 ? shared.filter(function (u) { return Stremio.getAddonUrls().indexOf(u) !== -1; }) : [];
                U.settleAll(refreshing.map(function (u) { return function () { return Stremio.refreshAddon(u); }; }), 2).then(function (rs) {
                    var refreshed = (rs || []).filter(function (x) { return x && x.ok; }).length, parts = [];
                    if (added) { parts.push(added + ' added'); }
                    if (removed) { parts.push(removed + ' removed'); }
                    if (refreshing.length) { parts.push(refreshed + ' refreshed' + (refreshed < refreshing.length ? ' (' + (refreshing.length - refreshed) + ' didn’t answer)' : '')); }
                    U.toast('Synced: ' + (parts.join(', ') || 'nothing changed'), 4000);
                    done(added + removed + refreshed, addedUrls);
                });
            });
        }, function (e) {
            var why = (e && e.message) || '';
            if (/HTTP 401\b/.test(why) || (e && e.status === 401)) {
                aiomSave({ key: '' });
                U.toast('AIOManager refused the API key: enter it again', 4500);
                aiomAskKey(aiomSync);
                return;
            }
            U.toast('Couldn’t read your AIOManager addons (' + (U.problem ? U.problem(e) : why) + ')', 5000);
        });
    }

    // The last configuration-file URL, kept so it can be imported again with one Confirm.
    var IMPORT_URL_KEY = 'stremiok.importurl';

    var _importGen = 0;   // (the configuration file being imported, the latest)
    function settingsImport(wrap) {
        wrap.appendChild(U.el('h2', null, 'Import configuration file'));
        var lastUrl = U.store.get(IMPORT_URL_KEY, '') || '';
        var listRow = U.el('div', 'addon-item focusable add-row');
        var ln = U.el('div', 'a-name', '+  Import configuration file');
        ln.appendChild(originBadge('config'));
        listRow.appendChild(ln);
        listRow.appendChild(U.el('div', 'a-url', lastUrl ? ('Last used: ' + lastUrl + '  ·  OK to import again')
            : 'Addon URLs, API keys and IPTV playlist URLs'));
        listRow.__onselect = function () {
            App.openEntry({
                title: 'Import configuration file', phone: 'config',
                hint: 'Enter a text-file URL containing one addon URL, API key or M3U/M3U8 playlist URL per line. Lines starting with # are ignored. The URL is remembered for next time.',
                value: lastUrl || 'https://', placeholder: 'https://example.com/stremiok.txt',
                validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                onConfirm: function (v) {
                    // Saved even if the fetch fails, so a typo can be fixed instead of retyped.
                    U.store.set(IMPORT_URL_KEY, v);
                    lastUrl = v;
                    U.toast('Fetching configuration file…', 5000);
                    // (what you confirmed is imported even if you've moved on; only the screen
                    // you're on stays: back to Settings only from this entry, still showing)
                    var entry = scr('addaddon'), mine = ++_importGen;
                    function here() { return mine === _importGen && !/\bhidden\b/.test(entry.className); }
                    U.getText(v, 15000, 256 * 1024).then(function (text) {   // (a list of URLs and keys: 256 KB is plenty)
                        var parsed = Stremio.parseSetupList(text);
                        if (!parsed.items.length) { U.toast('No supported entries found in that file' + (parsed.ignored ? ' (' + parsed.ignored + ' ignored)' : ''), 4500); return; }
                        if (here()) { App.back(); renderSettings(); }
                        // what the file has, none ticked: you tick what to import
                        pickMany('In that file: tick what to import', parsed.items.map(function (it, i) { return { key: '' + i, label: it.label, have: it.have, note: it.note }; }),
                            { button: function (n) { return 'Import ' + n; } }, function (keys) {
                                done(Stremio.applySetupEntries(keys.map(function (k) { return parsed.items[+k]; })), parsed.ignored);
                            });
                    }, function (err) {
                        if (!here()) { return; }
                        var why = U.problem(err);
                        U.toast(/^too large/.test(why) ? 'That file is ' + why + ': a configuration file is a short list of URLs and keys.'
                            : 'Could not fetch that configuration file (' + why + '; check the URL / CORS).', 5000);
                    });
                    function done(imported, ignored) {
                        var parts = [];
                        if (imported.addons) { parts.push(imported.addons + ' addon' + (imported.addons === 1 ? '' : 's')); }
                        if (imported.playlists) { parts.push(imported.playlists + ' playlist' + (imported.playlists === 1 ? '' : 's')); }
                        if (imported.omdb) { parts.push('OMDb key'); }
                        if (imported.tmdb) { parts.push('TMDB key'); }
                        if (imported.mdblist) { parts.push('MDBList key'); }
                        if (imported.addons || imported.playlists) { clearCatalogCache(); }
                        var message = parts.length ? ('Imported: ' + parts.join(', ')) : 'Nothing imported';
                        if (ignored) { message += ' (' + ignored + ' ignored)'; }
                        U.toast(message, 4500);
                        renderSettings();
                    }
                }
            });
        };
        wrap.appendChild(listRow);
        wrap.appendChild(U.el('div', 'hint',
            'Accepted lines: addon URLs, M3U/M3U8 URLs, and OMDb, TMDB or MDBList API keys.'));
        focusSettings();
    }

    // Settings › IPTV: each playlist with ▲ / ▼ (order: a channel in two comes from the
    // first; rows follow it), its name, link, channels, when it was last downloaded and
    // what went wrong; OK for its actions (Rename, Turn off / on, Edit link, Reload, Remove).
    var _iptvFocus = null;   // { id, ctl } to focus once the page is drawn again
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function thousands(n) { return ('' + n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function playlistInfo(p) {
        if (p.off) { return 'Off — its channels aren’t shown'; }
        var st = Stremio.iptvStatus(p.id), parts = [];
        if (!st.url) { return 'Not read yet'; }
        parts.push(thousands(st.count || 0) + ' channel' + (st.count === 1 ? '' : 's') + (st.groups ? ' in ' + st.groups + ' group' + (st.groups === 1 ? '' : 's') : ''));
        if (st.fetchedAt) { var d = new Date(st.fetchedAt); parts.push('downloaded ' + U.dayLabel(st.fetchedAt) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes())); }
        if (st.dropped) { parts.push(thousands(st.dropped) + ' more left out (a playlist keeps its first 30,000)'); }
        if (st.uncached) { parts.push('too large to save on the TV: downloaded each launch'); }
        return parts.join('   ·   ');
    }
    function playlistProblem(p) {
        var st = Stremio.iptvStatus(p.id);
        if (p.off || !st.error) { return ''; }
        return '⚠ ' + (st.stale ? 'Couldn’t refresh it (showing the saved copy): ' : '') + st.error;
    }
    function settingsIptv(wrap) {
        wrap.appendChild(U.el('h2', null, 'IPTV'));
        var playlists = Stremio.iptvGetPlaylists ? Stremio.iptvGetPlaylists() : [];
        var rows = [];

        // Combined load status — turns silent per-playlist fetch failures into a visible message.
        var statusEl = null;
        if (playlists.some(function (p) { return !p.off; }) && Stremio.iptvLoad) {
            statusEl = U.el('div', 'hint', 'Checking playlists…');
            wrap.appendChild(statusEl);
            _iptvStatusEl = statusEl;   // (updated as big playlists are read, see below)
        }

        playlists.forEach(function (playlist, idx) {
            var label = Stremio.iptvLabel(playlist.id);
            var frow = U.el('div', 'feed-row playlist-row' + (playlist.off ? ' feed-off' : ''));
            function ctl(node, name) { node.setAttribute('data-pl', playlist.id); node.setAttribute('data-ctl', name); return node; }
            function move(dir, name) {
                return function () {
                    if (!Stremio.iptvMovePlaylist(playlist.id, dir)) { return; }
                    refreshAddonRows('local:iptv');
                    _iptvFocus = { id: playlist.id, ctl: name };
                    renderSettings();
                };
            }
            var btns = orderButtons(function (dir, name) { move(dir, name)(); }, ctl);
            var item = ctl(U.el('div', 'addon-item focusable playlist-item'), 'item');
            item.appendChild(U.el('div', 'a-name', label + (playlist.off ? '   (off)' : '')));
            item.appendChild(U.el('div', 'a-url', U.redactUrl(playlist.url)));   // (credentials masked)
            var info = U.el('div', 'a-url playlist-info', playlistInfo(playlist));
            var problem = U.el('div', 'a-url addon-said', playlistProblem(playlist));
            item.appendChild(info);
            item.appendChild(problem);
            item.__onselect = function () {
                _iptvFocus = { id: playlist.id, ctl: 'item' };
                playlistActions(playlist, label);
            };
            btns.forEach(function (b) { frow.appendChild(b); });
            frow.appendChild(item);
            wrap.appendChild(frow);
            rows.push({ p: playlist, info: info, problem: problem, idx: idx });
        });

        if (statusEl) {
            Stremio.iptvLoad().then(function () {
                var channels = 0, groups = 0, failed = 0, on = 0;
                rows.forEach(function (r) {
                    r.info.textContent = playlistInfo(r.p);
                    r.problem.textContent = playlistProblem(r.p);
                    if (r.p.off) { return; }
                    var st = Stremio.iptvStatus(r.p.id);
                    on++;
                    channels += st.count || 0;
                    groups += st.groups || 0;
                    if (st.error) { failed++; }
                });
                statusEl.textContent = (failed ? '⚠ ' : '✓ ') + 'Loaded ' + thousands(channels) + ' channels from ' +
                    on + ' playlist(s) in ' + groups + ' group(s).' + (failed ? (' ' + failed + ' playlist(s) reported an error.') : '') +
                    (on < playlists.length ? ' ' + (playlists.length - on) + ' switched off.' : '');
            });
        }

        var add = U.el('div', 'addon-item focusable add-row');
        add.appendChild(U.el('div', 'a-name', '+  Add playlist'));
        add.appendChild(U.el('div', 'a-url', 'Enter another M3U/M3U8 playlist URL'));
        add.__onselect = function () {
            App.openEntry({
                title: 'Add IPTV playlist', phone: 'playlist',
                hint: 'Type an M3U/M3U8 playlist URL. Nothing is saved until you Confirm.',
                value: 'https://', placeholder: 'https://example.com/playlist.m3u',
                validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                onConfirm: function (v) {
                    Stremio.iptvAddPlaylist(v);
                    refreshAddonRows('local:iptv');
                    U.toast('Playlist added');
                    App.back(); renderSettings();
                }
            });
        };
        wrap.appendChild(add);

        wrap.appendChild(U.el('div', 'hint',
            'Channels are grouped into IPTV and Radio rows on Home. ▲ / ▼ set the playlists\' order: a channel in two playlists comes from the first.'));
        var s = scr('settings'), want = null;
        if (_iptvFocus) {
            var nodes = wrap.querySelectorAll('.playlist-row .focusable');
            for (var k = 0; k < nodes.length; k++) {
                if (nodes[k].getAttribute('data-pl') === _iptvFocus.id && nodes[k].getAttribute('data-ctl') === _iptvFocus.ctl) { want = nodes[k]; break; }
            }
            _iptvFocus = null;
        }
        Focus.setScope(s, want || wrap.querySelector('.playlist-item') || wrap.querySelector('.focusable') || undefined);   // (the playlist, not its ▲)
    }

    // Settings › Content › YouTube: YouTube in Search (Videos and Channels rows), and your
    // YouTube catalogs (a channel, a playlist or a search each, a row on Home and a catalog in
    // Discover): ▲ / ▼ for their order, OK for what to change. (Channels and playlists can
    // also be added by holding OK on one, wherever it's shown.)
    var _ytFocus = null;   // { id, ctl } to focus once the page is drawn again
    function ytDescribe(x) {
        var what = { channel: 'Channel', playlist: 'Playlist', search: 'Search' }[YouTube.sourceKind(x.src)];
        var bits = [what + ':  ' + x.src.replace(/^search:/i, '')];
        if (x.kind !== 'auto') { bits.push(YouTube.KIND_NAMES[x.kind]); }
        if (what === 'Search' && x.sort !== 'relevance') { bits.push('by ' + YouTube.SORT_NAMES[x.sort].toLowerCase()); }
        if (x.type !== 'YouTube') { bits.push('type “' + x.type + '”'); }
        return bits.join('   ·   ');
    }
    function ytChanged(focus) {
        refreshAddonRows('local:youtube');
        _ytFocus = focus || null;
        renderSettings();
    }
    function ytEntry(title, hint, value, placeholder, validate, onConfirm) {
        App.openEntry({ title: title, hint: hint, value: value, placeholder: placeholder, phone: 'youtube',
            validate: validate || function () { return null; },
            onConfirm: function (v) { App.back(); onConfirm(('' + v).trim()); } });   // (back on Settings, then redrawn on the change)
    }
    var YT_SOURCE_HINT = 'A channel (like @ScreenJunkies, or its link), a playlist link, or words to search YouTube for (like “honest trailers”).';
    // YouTubio's catalogs as yours (its own feeds need its sign-in: left out), then its
    // addon can go.
    function copyFrom(y) {
        var info = YouTube.fromYouTubio(y.url);
        confirm('Copy ' + info.list.length + ' catalog' + (info.list.length === 1 ? '' : 's') + ' from YouTubio (' + y.host + ') to your YouTube?' +
            (info.left ? '  ' + info.left + ' of its own (subscriptions, its search…) need its sign-in or are YouTube in Search already: left out.' : ''), 'Copy', function () {
            var r = YouTube.copyYouTubio(y.url);
            ytChanged(OPT('copy'));
            U.toast(r.added + ' catalog' + (r.added === 1 ? '' : 's') + ' copied' + (r.already ? ', ' + r.already + ' you had already' : ''), 3500);
            setTimeout(function () {
                confirm('Remove the YouTubio addon? Its catalogs are in your YouTube now.', 'Remove', function () {
                    Stremio.removeAddon(y.url);
                    refreshAddonRows();
                    ytChanged(null);
                    U.toast('YouTubio removed');
                });
            }, 400);
        });
    }
    function OPT(name) { return { id: 'opt', ctl: name }; }   // (a settings row, to come back to)
    function optRow(node, name) { node.setAttribute('data-pl', 'opt'); node.setAttribute('data-ctl', name); return node; }
    function sbModeShort(cat, mode) { return mode === 'show' && (cat === 'poi_highlight' || cat === 'exclusive_access') ? 'On' : YouTube.SB_MODE_NAMES[mode].split(' (')[0]; }
    // SponsorBlock sections: each, and what's done with it.
    function sbSections(focusCat) {
        var modes = YouTube.sbModes();
        pickList('SponsorBlock sections', YouTube.SB_CATS.map(function (k) { return [k, YouTube.SB_NAMES[k] + '  ·  ' + sbModeShort(k, modes[k])]; }), focusCat || null, function (cat) {
            var names = cat === 'poi_highlight' ? { show: 'On: “◆ Highlight” on the UP bar goes to it', off: 'Off' }
                : cat === 'exclusive_access' ? { show: 'On: a note when the video starts', off: 'Off' } : YouTube.SB_MODE_NAMES;
            pickList(YouTube.SB_NAMES[cat], YouTube.sbModesFor(cat).map(function (m) { return [m, names[m]]; }), modes[cat], function (m) {
                YouTube.setSbMode(cat, m);
                ytChanged(OPT('sbcats'));
                sbSections(cat);
            });
        });
    }
    function ytActions(x) {
        var opts = [['rename', 'Rename  ·  ' + x.name], ['src', 'Source  ·  ' + x.src.replace(/^search:/i, '')],
            ['kind', 'Search type  ·  ' + YouTube.KIND_NAMES[x.kind]], ['sort', 'Sort order  ·  ' + YouTube.SORT_NAMES[x.sort]],
            ['type', 'Type  ·  ' + x.type], ['off', x.off ? 'Turn on' : 'Turn off'], ['remove', 'Remove']];
        pickList(x.name, opts, null, function (a) {
            var focus = { id: x.id, ctl: 'item' };
            if (a === 'rename') {
                ytEntry('Rename YouTube catalog', 'Its name on Home and in Discover.', x.name, x.name,
                    function (v) { return ('' + v).trim() ? null : 'Type a name'; }, function (v) { YouTube.update(x.id, { name: v }); ytChanged(focus); });
            } else if (a === 'src') {
                ytEntry('YouTube catalog source', YT_SOURCE_HINT, x.src.replace(/^search:/i, ''), '@channel, a playlist link, or words',
                    function (v) { return ('' + v).trim() ? null : 'Type a channel, a playlist or words'; }, function (v) { YouTube.update(x.id, { src: v }); ytChanged(focus); });
            } else if (a === 'kind') {
                pickList('Search type', YouTube.KINDS.map(function (k) { return [k, YouTube.KIND_NAMES[k]]; }), x.kind, function (k) { YouTube.update(x.id, { kind: k }); ytChanged(focus); });
            } else if (a === 'sort') {
                pickList('Sort order (searches)', YouTube.SORTS.map(function (k) { return [k, YouTube.SORT_NAMES[k]]; }), x.sort, function (k) { YouTube.update(x.id, { sort: k }); ytChanged(focus); });
            } else if (a === 'type') {
                ytEntry('YouTube catalog type', 'Where it\'s listed: its Home tab and Discover type, like “Podcasts”. Leave it empty for “YouTube”.', x.type, 'YouTube',
                    null, function (v) { YouTube.update(x.id, { type: v || 'YouTube' }); ytChanged(focus); });
            } else if (a === 'off') {
                YouTube.update(x.id, { off: !x.off }); ytChanged(focus);
            } else if (a === 'remove') {
                confirm('Remove the YouTube catalog “' + x.name + '”?', 'Remove', function () { YouTube.remove(x.id); ytChanged(null); });
            }
        });
    }
    function settingsYouTube(wrap) {
        wrap.appendChild(U.el('h2', null, 'YouTube'));
        if (typeof YouTube === 'undefined') { wrap.appendChild(U.el('div', 'hint', 'Not available here.')); focusSettings(); return; }
        var on = YouTube.searchOn();
        var srch = U.el('div', 'addon-item focusable cfg-row');
        srch.appendChild(U.el('div', 'a-name', 'YouTube in Search:  ' + (on ? 'On' : 'Off')));
        srch.appendChild(U.el('div', 'a-url', (on ? 'Search shows YouTube videos and channels (as rows: YouTube · Videos, YouTube · Channels)' : 'Search leaves YouTube out') + '   ·   OK to turn ' + (on ? 'off' : 'on')));
        srch.__onselect = function () { YouTube.setSearch(!on); ytChanged(OPT('search')); };
        wrap.appendChild(optRow(srch, 'search'));
        var orig = YouTube.originalTitles(), tRow = U.el('div', 'addon-item focusable cfg-row');
        tRow.appendChild(U.el('div', 'a-name', 'Video titles:  ' + (orig ? 'Original' : 'English')));
        tRow.appendChild(U.el('div', 'a-url', (orig ? 'In the language they were uploaded in' : 'In English where YouTube has a translation (the uploader\'s, or its own)') + '   ·   OK for ' + (orig ? 'English' : 'the original')));
        tRow.__onselect = function () { YouTube.setOriginalTitles(!orig); ytChanged(OPT('titles')); };
        wrap.appendChild(optRow(tRow, 'titles'));

        // SponsorBlock (sections viewers marked) and DeArrow (titles / thumbnails they wrote)
        var sb = YouTube.sbOn(), modes = YouTube.sbModes();
        var sbRow = U.el('div', 'addon-item focusable cfg-row');
        sbRow.appendChild(U.el('div', 'a-name', 'SponsorBlock:  ' + (sb ? 'On' : 'Off')));
        sbRow.appendChild(U.el('div', 'a-url', (sb ? 'Sponsors, self-promotion and other sections other viewers marked in a video: skipped, offered or shown on the bar, as set below' : 'Videos play as they are') + '   ·   OK to turn ' + (sb ? 'off' : 'on')));
        sbRow.__onselect = function () { YouTube.setSbOn(!sb); ytChanged(OPT('sb')); };
        wrap.appendChild(optRow(sbRow, 'sb'));
        if (sb) {
            var cats = U.el('div', 'addon-item focusable cfg-row');
            cats.appendChild(U.el('div', 'a-name', 'SponsorBlock sections'));
            cats.appendChild(U.el('div', 'a-url', YouTube.SB_CATS.filter(function (k) { return modes[k] !== 'off'; }).map(function (k) { return YouTube.SB_NAMES[k] + ': ' + sbModeShort(k, modes[k]); }).join('   ·   ') || 'All off'));
            cats.__onselect = function () { sbSections(); };
            wrap.appendChild(optRow(cats, 'sbcats'));
        }
        var da = YouTube.dearrow();
        [['titles', 'DeArrow titles', 'Titles other viewers rewrote to say what a video is (the original on its page)', 'YouTube\'s titles'],
         ['thumbs', 'DeArrow thumbnails', 'A still from the video in place of a clickbait thumbnail, where viewers chose one', 'YouTube\'s thumbnails']].forEach(function (d) {
            var onD = da[d[0]], r = U.el('div', 'addon-item focusable cfg-row');
            r.appendChild(U.el('div', 'a-name', d[1] + ':  ' + (onD ? 'On' : 'Off')));
            r.appendChild(U.el('div', 'a-url', (onD ? d[2] : d[3]) + '   ·   OK to turn ' + (onD ? 'off' : 'on')));
            r.__onselect = function () { var p = {}; p[d[0]] = !onD; YouTube.setDearrow(p); ytChanged(OPT('da' + d[0])); };
            wrap.appendChild(optRow(r, 'da' + d[0]));
        });

        var list = YouTube.catalogs();
        if (list.length) { wrap.appendChild(U.el('div', 'hint', 'Your YouTube catalogs: a row on Home and a catalog in Discover each; a channel or playlist opens as a series of its videos.')); }
        list.forEach(function (x) {
            var frow = U.el('div', 'feed-row playlist-row' + (x.off ? ' feed-off' : ''));
            function ctl(node, name) { node.setAttribute('data-pl', x.id); node.setAttribute('data-ctl', name); return node; }
            var btns = orderButtons(function (dir, name) { if (YouTube.move(x.id, dir)) { ytChanged({ id: x.id, ctl: name }); } }, ctl);
            var item = ctl(U.el('div', 'addon-item focusable playlist-item yt-catalog'), 'item');
            item.appendChild(U.el('div', 'a-name', x.name + (x.off ? '   (off)' : '')));
            item.appendChild(U.el('div', 'a-url', ytDescribe(x)));
            item.__onselect = function () { ytActions(x); };
            btns.forEach(function (b) { frow.appendChild(b); }); frow.appendChild(item);
            wrap.appendChild(frow);
        });

        var add = U.el('div', 'addon-item focusable add-row');
        add.appendChild(U.el('div', 'a-name', '+  Add catalog'));
        add.appendChild(U.el('div', 'a-url', 'A channel, a playlist or a search (or hold OK on a channel / playlist wherever it\'s shown)'));
        add.__onselect = function () {
            ytEntry('Add YouTube catalog', YT_SOURCE_HINT, '', '@channel, a playlist link, or words', function (v) { return ('' + v).trim() ? null : 'Type a channel, a playlist or words'; }, function (src) {
                var id = YouTube.add({ src: src });
                if (!id) { U.toast('Couldn\'t add it (40 catalogs at most)'); return; }
                U.toast('Added: OK on it to rename it or change what it lists', 3500);
                ytChanged({ id: id, ctl: 'item' });
            });
        };
        wrap.appendChild(add);
        var ytb = YouTube.youTubioAddons();
        if (ytb.length) {   // (a YouTubio addon installed: its catalogs can come over)
            var copy = optRow(U.el('div', 'addon-item focusable add-row'), 'copy');
            copy.appendChild(U.el('div', 'a-name', '+  Copy from YouTubio'));
            copy.appendChild(U.el('div', 'a-url', ytb.map(function (y) { return y.host + ': ' + y.count + ' catalog' + (y.count === 1 ? '' : 's'); }).join('   ·   ')));
            copy.__onselect = function () {
                if (ytb.length === 1) { copyFrom(ytb[0]); return; }
                pickList('Copy from which YouTubio?', ytb.map(function (y, i) { return ['' + i, y.host + '  ·  ' + y.count + ' catalogs  ·  addon ' + (i + 1)]; }), null, function (i) { copyFrom(ytb[+i]); });
            };
            wrap.appendChild(copy);
        }
        wrap.appendChild(U.el('div', 'hint', 'These work without any addon, through StremioK’s YouTube service. Search type and Sort order are for searches; Live now with a channel shows what it’s streaming.'));
        var s = scr('settings'), want = null;
        if (_ytFocus) {
            var nodes = wrap.querySelectorAll('.focusable');
            for (var k = 0; k < nodes.length; k++) {
                if (nodes[k].getAttribute('data-pl') === _ytFocus.id && nodes[k].getAttribute('data-ctl') === _ytFocus.ctl) { want = nodes[k]; break; }
            }
            _ytFocus = null;
        }
        Focus.setScope(s, want || wrap.querySelector('.focusable') || undefined);
    }

    function maskKey(v) { v = '' + v; return v.length <= 4 ? '••••' : ('••••' + v.slice(-4)); }

    function keyRow(title, key, placeholder, validator) {
        var val = Stremio.getIntegrations()[key] || '';
        var r = U.el('div', 'addon-item focusable');
        r.appendChild(U.el('div', 'a-name', title));
        r.appendChild(U.el('div', 'a-url', val ? ('Set — ' + maskKey(val)) : 'Not set — press OK to enter'));
        r.__onselect = function () {
            App.openEntry({
                title: title,
                hint: 'Paste your key, then Confirm. Use Validate to test it. Leave blank and Confirm to clear.',
                value: val, placeholder: placeholder, validator: validator,
                onConfirm: function (v) { Stremio.setIntegration(key, v); U.toast(v ? 'Saved' : 'Cleared'); App.back(); renderSettings(); }
            });
        };
        return r;
    }

    function settingsIntegrations(wrap) {
        wrap.appendChild(U.el('h2', null, 'Integrations'));
        if (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew') { wrap.appendChild(U.el('div', 'hint', TIZENBREW_NOTE)); }
        wrap.appendChild(keyRow('OMDb API key', 'omdb', 'OMDb API key', Stremio.omdbValidate));
        wrap.appendChild(keyRow('TMDB API key (v3)', 'tmdb', 'TMDB v3 API key', Stremio.tmdbValidate));
        wrap.appendChild(keyRow('MDBList API key', 'mdblist', 'MDBList API key', Stremio.mdblistValidate));
        if (Stremio.autoWatchRegion) { wrap.appendChild(regionRow()); }

        // Trakt: your account (StremioK is the Trakt app: nothing to set up)
        if (typeof Trakt !== 'undefined') {
            wrap.appendChild(U.el('h2', null, 'Trakt'));
            wrap.appendChild(traktAccountRow());
            if (Trakt.connectStatus().connected) { wrap.appendChild(traktSyncRow()); }
            wrap.appendChild(U.el('div', 'hint', 'Connect your Trakt account (a free one will do): the TV shows a code to enter on Trakt\'s site. ' +
                'Your watched marks and Continue Watching then sync with Trakt.'));
        }

        wrap.appendChild(U.el('div', 'hint',
            'Keys are stored on this TV only. OMDb gives real IMDb per-episode ratings (used first when set); TMDB adds episode images & ratings.'));
        focusSettings();
    }

    // The country TMDB's "where to watch" services are for (a title's sources). Automatic:
    // the TV's language region, which a language-only setting ("en") doesn't have.
    var WATCH_REGIONS = [['AR', 'Argentina'], ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'],
        ['BG', 'Bulgaria'], ['CA', 'Canada'], ['CL', 'Chile'], ['CO', 'Colombia'], ['CZ', 'Czech Republic'], ['DK', 'Denmark'],
        ['EC', 'Ecuador'], ['EG', 'Egypt'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'], ['DE', 'Germany'],
        ['GR', 'Greece'], ['HK', 'Hong Kong'], ['HU', 'Hungary'], ['IS', 'Iceland'], ['IN', 'India'], ['ID', 'Indonesia'],
        ['IE', 'Ireland'], ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['LV', 'Latvia'], ['LT', 'Lithuania'],
        ['MY', 'Malaysia'], ['MX', 'Mexico'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NO', 'Norway'], ['PE', 'Peru'],
        ['PH', 'Philippines'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SA', 'Saudi Arabia'],
        ['SG', 'Singapore'], ['SK', 'Slovakia'], ['ZA', 'South Africa'], ['KR', 'South Korea'], ['ES', 'Spain'],
        ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TW', 'Taiwan'], ['TH', 'Thailand'], ['TR', 'Turkey'], ['UA', 'Ukraine'],
        ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States'], ['VE', 'Venezuela']];
    function regionRow() {
        var auto = Stremio.autoWatchRegion();
        var list = [['', 'Automatic (' + (labelFor(WATCH_REGIONS, auto) || auto) + ', from the TV\'s language)']].concat(WATCH_REGIONS.map(function (c) { return [c[0], c[1] + '  (' + c[0] + ')']; }));
        var row = U.el('div', 'addon-item focusable cfg-row');
        var name = U.el('div', 'a-name');
        function render() { name.textContent = 'Where to watch: country:  ' + labelFor(list, Stremio.getPrefs().watchRegion); }
        render();
        row.appendChild(name);
        row.appendChild(U.el('div', 'a-url', 'The services TMDB lists on a title\'s page are for this country   ·   OK to choose'));
        row.__onselect = function () {
            pickList('Where to watch: country', list, Stremio.getPrefs().watchRegion, function (v) { Stremio.setPref('watchRegion', v); render(); });
        };
        return row;
    }

    function traktAccountRow() {
        var st = Trakt.connectStatus();
        var r = U.el('div', 'addon-item focusable');
        r.appendChild(U.el('div', 'a-name', 'Trakt account'));
        r.appendChild(U.el('div', 'a-url',
            st.connected && st.reconnect ? ('Trakt needs reconnecting (' + (st.user || 'Trakt') + '): its sign-in no longer works — press OK to connect again')
                : st.connected ? ('Connected as ' + (st.user || 'Trakt') + ' — press OK to disconnect')
                : 'Not connected — press OK to connect'));
        r.__onselect = function () {
            if (st.connected && st.reconnect) { traktConnect(); return; }
            if (st.connected) {
                confirm('Disconnect Trakt account?', 'Disconnect', function () {
                    Trakt.disconnect();
                    U.toast('Trakt disconnected');
                    markHomeDirty();
                    renderSettings();
                });
            } else {
                traktConnect();
            }
        };
        return r;
    }

    // When Trakt last answered, and the changes waiting to reach it, and each one not sent (by
    // title, with what Trakt said): OK to send everything now, or let the ones not sent go.
    function traktSyncRow() {
        var st = Trakt.connectStatus(), r = U.el('div', 'addon-item focusable cfg-row trakt-sync');
        function two(n) { return (n < 10 ? '0' : '') + n; }
        var d = st.lastSync ? new Date(st.lastSync) : null;
        var last = d ? 'Last synced ' + (U.dayLabel ? U.dayLabel(st.lastSync) + ' ' : '') + two(d.getHours()) + ':' + two(d.getMinutes()) : 'Not synced yet';
        var bits = [last];
        if (st.pending) { bits.push(st.pending + ' change' + (st.pending === 1 ? '' : 's') + ' waiting to reach Trakt'); }
        if (st.failed) { bits.push('⚠ ' + st.failed + ' change' + (st.failed === 1 ? '' : 's') + ' not sent'); }
        r.appendChild(U.el('div', 'a-name', 'Trakt sync:  ' + (st.failed ? 'some changes not sent' : st.pending ? 'changes waiting' : 'up to date')));
        r.appendChild(U.el('div', 'a-url', bits.join('   ·   ') + '   ·   OK for options'));
        (st.failedItems || []).slice(0, 6).forEach(function (f) {
            r.appendChild(U.el('div', 'a-url', '⚠ ' + f.what.charAt(0).toUpperCase() + f.what.slice(1) + (f.title ? '  ·  ' + f.title : '') + (f.err ? '  ·  ' + f.err : '')));
        });
        if ((st.failedItems || []).length > 6) { r.appendChild(U.el('div', 'a-url', 'and ' + (st.failedItems.length - 6) + ' more')); }
        r.__onselect = function () {
            var opts = [['now', st.failed ? 'Sync now (the ' + st.failed + ' not sent too)' : 'Sync now']];
            if (st.failed) { opts.push(['discard', 'Let them go (not sent to Trakt)']); }
            pickList('Trakt sync', opts, null, function (v) {
                if (v === 'now') { Trakt.sendNow(); Trakt.refreshCaches(); U.toast('Syncing with Trakt…'); }
                else if (v === 'discard') { Trakt.discardFailed(); U.toast('Not sent: left out'); }
                setTimeout(renderSettings, 1500);
            });
        };
        return r;
    }

    // Device-code connect overlay: shows the code + URL, polls, updates on success.
    function traktConnect() {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', 'Connect Trakt'));
        var body = U.el('div', 'trakt-connect');
        body.appendChild(U.el('div', 'tc-line', 'Starting…'));
        box.appendChild(body);
        var row = U.el('div', 'modal-row');
        var cancel = U.el('div', 'pill focusable modal-btn', 'Cancel');
        cancel.__onselect = function () { closeModal(); };
        row.appendChild(cancel);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        showModal(overlay, cancel);

        var cancelFlow = Trakt.startDeviceFlow({
            onCode: function (code, url) {
                U.clear(body);
                // a QR of Trakt's activate page with the code in it (Trakt keeps it through
                // signing in): scan, sign in if asked, confirm; the code and link for typing
                var qrText = /\/activate\/?$/.test(url) ? url.replace(/\/+$/, '') + '/' + encodeURIComponent(code) : url;
                var qrSpot = U.el('div', 'tc-qr-spot');
                body.appendChild(qrSpot);
                var goTo = body.appendChild(U.el('div', 'tc-line', 'On your phone or computer, go to:'));
                // (the QR library is loaded the first time this box opens: nothing else uses it)
                (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
                    var qr = U.qrCanvas(qrText, 8);
                    if (!qr || !qrSpot.parentNode) { return; }
                    qr.className = 'tc-qr';
                    qrSpot.appendChild(U.el('div', 'tc-line', 'Scan with your phone:'));
                    qrSpot.appendChild(qr);
                    goTo.textContent = 'or go to';
                }, function () {});
                body.appendChild(U.el('div', 'tc-url', url));
                body.appendChild(U.el('div', 'tc-line', 'and enter this code:'));
                body.appendChild(U.el('div', 'tc-code', code));
                body.appendChild(U.el('div', 'tc-line small', 'Waiting for you to authorize…'));
            },
            onSuccess: function (user) {
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', '✓ Connected as ' + user));
                markHomeDirty();
                setTimeout(function () { if (isModalOpen()) { onModalClose(null); closeModal(); renderSettings(); } }, 1500);
            },
            onError: function (msg) {
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', msg || 'Could not connect.'));
            }
        });
        onModalClose(cancelFlow);   // canceling the overlay stops polling
    }

    function settingsSubtitles(wrap) {
        wrap.appendChild(U.el('h2', null, 'Subtitles'));
        wrap.appendChild(subPickRow('Default language', SUB_LANGS, 'lang'));
        wrap.appendChild(subPickRow('Second choice', SUB_LANGS2, 'lang2'));
        wrap.appendChild(subPickRow('Second subtitle (at the top)', SUB_LANGS, 'second'));
        wrap.appendChild(subPickRow('Size', SUB_SIZES, 'size'));
        // [id, label] for the picker (colors with a swatch)
        function plain(list) { return list.map(function (x) { return [x[0], x[1]]; }); }
        wrap.appendChild(subPickRow('Color', Player.SUB_COLORS.map(function (x) { return [x[0], x[1], null, x[2]]; }), 'color'));
        wrap.appendChild(subPickRow('Background', plain(Player.SUB_BGS), 'bg'));
        wrap.appendChild(subPickRow('Edge', plain(Player.SUB_EDGES), 'edge'));
        wrap.appendChild(subPickRow('Position', plain(Player.SUB_POSITIONS), 'pos'));
        wrap.appendChild(subPickRow('Font', Player.SUB_FONTS, 'font'));
        // lines to leave out: those with one of your words (a subtitle site's ads, a file's name…)
        var skip = Player.getSubCfg().skip || [];
        var sk = U.el('div', 'addon-item focusable cfg-row');
        sk.appendChild(U.el('div', 'a-name', 'Skip lines with:  ' + (skip.length ? skip.join(', ') : 'None')));
        sk.appendChild(U.el('div', 'a-url', 'Press OK to change   ·   a subtitle line with one of these in it isn’t shown (capitals or not)'));
        sk.__onselect = function () {
            App.openEntry({ title: 'Skip subtitle lines with', value: skip.join(', '), placeholder: 'OPENSUBTITLES, .SRT',
                hint: 'Words (or bits of them) separated by commas, capitals or not: lines with one aren’t shown. For example OPENSUBTITLES (ads) and .SRT (file names). Leave it empty for none.',
                validate: function () { return null; },
                onConfirm: function (v) { var c = Player.getSubCfg(); c.skip = ('' + v).split(','); Player.setSubCfg(c); App.back(); renderSettings(); } });
        };
        wrap.appendChild(sk);
        focusSettings();
    }

    // Skipping: intros and recaps skipped on their own after a countdown (with Cancel), or asked.
    var SKIP_CHOICES = [['0', 'Ask (a Skip button)'], ['5', 'After 5 seconds'], ['10', 'After 10 seconds'], ['15', 'After 15 seconds'], ['30', 'After 30 seconds']];
    // Settings › Addons: how long an addon's answer is waited for (an addon that sleeps when
    // unused fails the first time while it wakes up).
    var ADDON_WAITS = [['0', 'Normal (12 s; sources 15, search 25)'], ['20', '20 seconds'], ['30', '30 seconds'], ['45', '45 seconds'], ['60', '60 seconds']];
    var NEXT_CHOICES = [['0', 'Ask'], ['5', 'After 5 seconds'], ['10', 'After 10 seconds'], ['15', 'After 15 seconds'], ['30', 'After 30 seconds']];
    // Seeking & buffering: how far LEFT / RIGHT jump; a bigger buffer for slow connections; how
    // often a live channel that drops is opened again.
    var RECONNECTS = [['off', 'Off'], ['few', 'A few times (3 in 5 minutes)'], ['always', 'Keep trying']];
    function settingsSeeking(wrap) {
        wrap.appendChild(U.el('h2', null, 'Seeking & buffering'));
        var store = { get: function () { var c = Player.playerCfg(); return { seek: '' + c.seek, buffer: c.buffer, reconnect: c.reconnect }; },
            set: function (cfg) { Player.setPlayerCfg({ seek: +cfg.seek || 10, buffer: cfg.buffer, reconnect: cfg.reconnect }); } };
        wrap.appendChild(subPickRow('Seek step', [['5', '5 s'], ['10', '10 s'], ['15', '15 s'], ['30', '30 s']], 'seek', store));
        wrap.appendChild(subPickRow('Buffer', [['normal', 'Normal (the TV’s own)'], ['more', 'More'], ['most', 'Most']], 'buffer', store));
        wrap.appendChild(subPickRow('Reconnect live channels', RECONNECTS, 'reconnect', store));
        wrap.appendChild(U.el('div', 'hint', 'Seek step: how far LEFT / RIGHT jump (FF / REW jump three steps). Buffer: More or Most starts a little slower but stops less on a slow connection, from the next video you play. Reconnect: a live channel that drops opens again; Keep trying waits a little longer each time (BACK stops it).'));
        focusSettings();
    }
    function settingsSkipping(wrap) {
        wrap.appendChild(U.el('h2', null, 'Skipping'));
        wrap.appendChild(subPickRow('Intros, recaps and previews', SKIP_CHOICES, 'autoSkip', {
            get: function () { return { autoSkip: '' + Stremio.getPrefs().autoSkip }; },
            set: function (cfg) { Stremio.setPref('autoSkip', +cfg.autoSkip || 0); }
        }));
        wrap.appendChild(subPickRow('Next episode', NEXT_CHOICES, 'autoNext', {
            get: function () { return { autoNext: '' + Stremio.getPrefs().autoNext }; },
            set: function (cfg) { Stremio.setPref('autoNext', +cfg.autoNext || 0); }
        }));
        wrap.appendChild(U.el('div', 'hint', 'Ask shows a Skip button at an intro, recap or preview, and Skip Credits → Next at the credits. With a time, it counts down and skips (or plays the next episode) on its own; Cancel keeps watching.'));
        focusSettings();
    }

    // Home tabs: hide the ones you never use (Watching always stays: it's where Home opens). A
    // row like the ones above it; OK opens the tabs, OK on one shows or hides it (the list
    // stays open). A hidden tab's rows are back when it's shown again.
    function homeTabsRow() {
        function hiddenNow() { return Stremio.getPrefs().hiddenTabs || []; }
        var r = U.el('div', 'addon-item focusable cfg-row'), name = U.el('div', 'a-name');
        var tabs = (V.HOME_TABS || []).filter(function (t) { return t.key !== 'continue'; });
        function draw() {
            var hidden = hiddenNow().filter(function (k) { return tabs.some(function (t) { return t.key === k; }); });
            name.textContent = 'Home tabs:  ' + (hidden.length ? hidden.length + ' hidden' : 'All shown');
        }
        draw();
        r.appendChild(name);
        r.appendChild(U.el('div', 'a-url', 'Press OK to choose'));
        r.__onselect = function () {
            var hidden = hiddenNow();
            toggleList('Home tabs', tabs.map(function (t) { return [t.key, t.label + (t.key === 'local' ? ' (with a USB drive in)' : ''), hidden.indexOf(t.key) === -1]; }),
                { on: 'Shown', off: 'Hidden' }, function (key, on) {
                    var now = hiddenNow().filter(function (k) { return k !== key; });
                    if (!on) { now.push(key); }
                    Stremio.setPref('hiddenTabs', now);
                    markHomeDirty();
                    draw();
                });
        };
        return r;
    }

    var POSTER_SHAPES = [['portrait', 'Portrait'], ['landscape', 'Landscape']];
    // ----- Diagnostics › Logs: the recent problems U.log kept (in memory, URLs masked), and
    // how long launches took -----
    function settingsLogs(wrap) {
        wrap.appendChild(U.el('h2', null, 'Diagnostics  ›  Logs'));
        var list = U.logEntries ? U.logEntries() : [];
        wrap.appendChild(U.el('div', 'hint', list.length
            ? 'The last ' + list.length + ' problem' + (list.length === 1 ? '' : 's') + ' since StremioK started, newest first, with keys and passwords masked. After a crash, what came just before is here too. Nothing here leaves the TV.'
            : 'No problems since StremioK started.'));
        function two(n) { return (n < 10 ? '0' : '') + n; }
        list.forEach(function (e) {
            var d = new Date(e.t);
            var r = U.el('div', 'addon-item focusable diag-row');
            r.appendChild(U.el('div', 'a-name', two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '   ' + e.src + (e.n > 1 ? '   ×' + e.n : '')));
            r.appendChild(U.el('div', 'a-url', e.msg));
            wrap.appendChild(r);
        });
        if (list.length) {
            var clear = U.el('div', 'addon-item focusable');
            clear.appendChild(U.el('div', 'a-name', 'Clear log'));
            clear.__onselect = function () { U.clearLog(); renderSettings(); };
            wrap.appendChild(clear);
        }
        startupLines(wrap);
        focusSettings();
    }
    // ----- Diagnostics › Storage: the database on or off, what's using the storage, tidying the
    // database up, giving up the copies that can be made again -----
    function settingsStorage(wrap) {
        wrap.appendChild(U.el('h2', null, 'Diagnostics  ›  Storage'));
        var was = Focus.current(), wasName = was && was.querySelector && was.querySelector('.a-name');   // (drawn again: on the same row)
        var wasKey = wasName ? wasName.textContent.split(/:|   —/)[0] : '';
        var on = !!(U.bigStore && U.bigStore.enabled && U.bigStore.enabled());
        var db = U.el('div', 'addon-item focusable');
        db.appendChild(U.el('div', 'a-name', 'Use the TV’s database: ' + (on ? 'On' : 'Off')));
        db.appendChild(U.el('div', 'a-url', 'Holds StremioK’s big copies (saved Home rows, playlists, USB indexes, your Trakt history). Off: they go in the smaller settings storage, and the database is deleted'));
        db.__onselect = function () {
            function apply(v) {
                U.bigStore.setEnabled(v).then(function (r) {
                    _storageInfo = null;
                    U.toast(!r ? 'Couldn’t change it (Diagnostics › Logs says why)' : v ? 'Using the TV’s database' : 'The TV’s database is off and deleted' + (r.total ? ': ' + r.moved + ' of ' + r.total + ' copies kept in the settings storage' : ''));
                    if (_settingsSection === 'storage') { renderSettings(); }
                });
            }
            if (!on) { apply(true); return; }
            confirm('Stop using the TV’s database? It’s deleted, and StremioK’s copies are kept in the settings storage (what doesn’t fit is made again when needed).', 'Turn off', function () { apply(false); });
        };
        wrap.appendChild(db);
        storageLines(wrap, on);
        var rows = wrap.querySelectorAll('.addon-item'), back = db;
        for (var i = 0; wasKey && i < rows.length; i++) { var nm = rows[i].querySelector('.a-name'); if (nm && nm.textContent.split(/:|   —/)[0] === wasKey) { back = rows[i]; break; } }
        Focus.setScope(scr('settings'), back);
    }
    // ----- Diagnostics › Installed apps -----
    function settingsTvApps(wrap) {
        var firstApp = tvAppsSection(wrap);
        if (firstApp && _tvApps.fresh) {   // just read: land on the list
            _tvApps.fresh = false;
            Focus.setScope(scr('settings'), firstApp);
        } else {
            focusSettings();
        }
    }

    // ----- Private viewing (see player-store): on or off; also on the player's quick bar (UP). -----
    function settingsPrivate(wrap) {
        wrap.appendChild(U.el('h2', null, 'Private viewing'));
        var on = Player.isPrivate();
        var r = U.el('div', 'addon-item focusable');
        r.appendChild(U.el('div', 'a-name', 'Private viewing: ' + (on ? 'On' : 'Off')));
        r.appendChild(U.el('div', 'a-url', on ? 'What you play isn’t recorded (StremioK, at the top, drawn as an outline meanwhile)' : 'What you play is recorded as usual'));
        r.__onselect = function () { Player.setPrivate(!on); markHomeDirty(); renderSettings(); };
        wrap.appendChild(r);
        wrap.appendChild(U.el('div', 'hint', 'While it’s on, what you play isn’t recorded: no progress, Continue Watching, watched marks, Trakt or remembered choices. What you do by hand still counts. Addons and other services are contacted as usual. UP › ◐ Private switches it while something plays.'));
        Focus.setScope(scr('settings'), r);
    }

    // ----- USB drive: each drive's index (what it has, how much is matched to titles), the
    // hidden-files switch, and forgetting the matches. -----
    var _usbListening = false;
    function usbDriveLine(st) {
        if (st.state === 'scanning') { return st.phase === 'matching' ? 'Indexing: matching ' + st.done + ' of ' + st.total + ' titles   ·   OK: stop' : 'Indexing: listing the drive…   ·   OK: stop'; }
        if (st.state === 'failed') { return 'Indexing failed: ' + st.error; }
        if (st.state === 'none') { return 'Not indexed yet'; }
        return st.videos + ' video' + (st.videos === 1 ? '' : 's') + ', ' + st.matched + ' matched to titles' + (st.truncated ? ' (a very large drive: only part of it)' : '') +
            (st.left ? ', ' + st.left + ' titles left to match' : '') + '   ·   indexed ' + U.dayLabel(st.at) + ' ' + new Date(st.at).toTimeString().slice(0, 5);
    }
    function settingsUsb(wrap) {
        wrap.appendChild(U.el('h2', null, 'USB drive'));
        if (typeof LocalMedia === 'undefined' || !LocalMedia.available()) {
            wrap.appendChild(U.el('div', 'hint', 'Only on the TV: this install can’t see USB drives.'));
            focusSettings();
            return;
        }
        if (!_usbListening) {
            _usbListening = true;
            LocalMedia.onChange(function (what) {
                if (_settingsSection !== 'usb' || /\bhidden\b/.test(scr('settings').className || '') || isModalOpen()) { return; }
                if (what === 'drives') { renderSettings(); return; }
                if (what === 'status' || what === 'matches') {   // (indexing progress: the drives' lines updated where they are, focus untouched)
                    var rows = scr('settings').querySelectorAll('.settings-wrap .addon-item');
                    for (var i = 0; i < rows.length; i++) {   // (a NodeList: no forEach on Tizen 3)
                        if (rows[i].__usbDrive) { rows[i].querySelector('.a-url').textContent = usbDriveLine(LocalMedia.status(rows[i].__usbDrive)); }
                    }
                }
            });
        }
        wrap.appendChild(U.el('div', 'hint', 'Home › Local shows your drive. Videos are matched to titles by their names, and a matched one plays as that title. Index a drive to have its videos and subtitle files offered on their title pages.'));
        if (!LocalMedia.isRead()) {   // (read when asked, not at launch)
            wrap.appendChild(U.el('div', 'hint', 'Reading USB drives…'));
            LocalMedia.ensure().then(function () { if (_settingsSection === 'usb') { renderSettings(); } });
            focusSettings();
            return;
        }
        var ds = LocalMedia.knownDrives(), first = null;
        if (!ds.length) { wrap.appendChild(U.el('div', 'hint', 'No USB drive plugged in.')); }
        ds.forEach(function (d) {
            var r = U.el('div', 'addon-item focusable');
            r.__usbDrive = d;
            r.appendChild(U.el('div', 'a-name', '💾  ' + d.label.replace(/^removable_/, '') + '   —   Index'));
            r.appendChild(U.el('div', 'a-url', usbDriveLine(LocalMedia.status(d))));
            r.__onselect = function () {
                var st = LocalMedia.status(d);
                if (st.state === 'scanning') { V.confirmStopIndexing(d, st, renderSettings); return; }
                if (st.left) {
                    pickList('Index this drive', [['more', 'Continue matching (' + st.left + ' titles left)'], ['again', 'Index again (list the drive afresh)']], 'more', function (k) {
                        if (k === 'more') { LocalMedia.continueMatching(d); } else { LocalMedia.scan(d); }
                        renderSettings();
                    });
                    return;
                }
                LocalMedia.scan(d); renderSettings();
            };
            wrap.appendChild(r);
            first = first || r;
        });
        var mt = U.el('div', 'addon-item focusable');
        mt.appendChild(U.el('div', 'a-name', 'Match videos to titles: ' + (LocalMedia.matchingAllowed() ? 'On' : LocalMedia.matchingAsked() ? 'Off' : 'Off (not asked yet)')));
        mt.appendChild(U.el('div', 'a-url', 'On: titles worked out from your videos’ names (not the files) are looked up with your search addons, which see them. Off: Local just browses'));
        mt.__onselect = function () { LocalMedia.setMatching(!LocalMedia.matchingAllowed()); markHomeDirty(); renderSettings(); Focus.setScope(scr('settings'), scr('settings').querySelectorAll('.settings-wrap .addon-item')[ds.length]); };
        wrap.appendChild(mt);
        var hid = U.el('div', 'addon-item focusable');
        hid.appendChild(U.el('div', 'a-name', 'Show hidden files: ' + (LocalMedia.showHidden() ? 'On' : 'Off')));
        hid.appendChild(U.el('div', 'a-url', 'Names starting with “.” (a Mac leaves ._… copies, .DS_Store, .Spotlight-V100…), $RECYCLE.BIN, System Volume Information'));
        hid.__onselect = function () { LocalMedia.setShowHidden(!LocalMedia.showHidden()); markHomeDirty(); renderSettings(); Focus.setScope(scr('settings'), scr('settings').querySelectorAll('.settings-wrap .addon-item')[ds.length + 1]); };
        wrap.appendChild(hid);
        var clr = U.el('div', 'addon-item focusable');
        clr.appendChild(U.el('div', 'a-name', 'Clear the USB index'));
        clr.appendChild(U.el('div', 'a-url', 'What StremioK listed of your drives: title pages stop offering their files until a drive is indexed again (Local still browses them)'));
        clr.__onselect = function () {
            confirm('Clear the index of your USB drives?', 'Clear', function () { LocalMedia.clearIndex(); U.toast('USB index cleared'); renderSettings(); });
        };
        wrap.appendChild(clr);
        var forget = U.el('div', 'addon-item focusable');
        forget.appendChild(U.el('div', 'a-name', 'Forget matches'));
        forget.appendChild(U.el('div', 'a-url', 'Every video matched again from its name, as you browse or index (the ones you matched by hand too)'));
        forget.__onselect = function () {
            confirm('Forget which title each video is (yours too)? They’re matched again as you browse, or when a drive is indexed.', 'Forget', function () {
                LocalMedia.forgetMatches();
                markHomeDirty();
                renderSettings();
            });
        };
        wrap.appendChild(forget);
        if (first) { Focus.setScope(scr('settings'), first); } else { focusSettings(); }
    }


    // What's using the TV's storage for StremioK (checked when asked: it reads every saved copy),
    // and giving up the copies that can be made again.
    var _storageInfo = null, STORAGE_ITEMS = 20;
    // An item in the TV's database by what it is: { name, unused: why it's no longer used, if so }
    function storageItem(key) {
        var m;
        if (key === 'stremiok.homecache') { return { name: 'Home’s saved rows' }; }
        if (key === 'stremiok.trakt.watched') { return { name: 'Trakt watched history' }; }
        if ((m = key.match(/^stremiok\.iptv\.cache\.(.+)$/))) {
            var p = (typeof IPTV !== 'undefined' ? IPTV.getPlaylists() : []).filter(function (x) { return x.id === m[1]; })[0];
            return p ? { name: 'IPTV playlist copy: ' + (p.name || (('' + p.url).match(/^[a-z]+:\/\/(?:[^\/@]*@)?([^\/?#:]+)/i) || [])[1] || 'a playlist') }
                : { name: 'IPTV playlist copy (' + key + ')', unused: 'its playlist was removed' };
        }
        if ((m = key.match(/^stremiok\.local\.index\.(.+)$/))) {
            var kept = U.store.get('stremiok.local.indexes', {}) || {};
            return kept[m[1]] ? { name: 'USB drive index: ' + m[1] } : { name: 'USB drive index: ' + m[1], unused: 'not one of the drives kept' };
        }
        if (key === 'stremiok.local.index') { return { name: 'USB index (' + key + ')', unused: 'kept by an earlier version' }; }
        return { name: key };
    }
    function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function storageLines(wrap, dbOn) {
        var r = U.el('div', 'addon-item focusable startup-row');
        r.appendChild(U.el('div', 'a-name', 'TV storage' + (_storageInfo ? '' : '   —   check what’s using it')));
        if (_storageInfo === 'busy') { r.appendChild(U.el('div', 'a-url', 'Checking…')); }
        else if (_storageInfo) {
            var inf = _storageInfo;
            var line = function (t) { r.appendChild(U.el('div', 'a-url', t)); };
            var mine = inf.entries.reduce(function (n, e) { return n + e.bytes; }, 0);
            if (inf.quota) { line('The TV’s database: ' + fmtBytes(inf.usage || 0) + ' used of ' + fmtBytes(inf.quota) + ' it allows StremioK'); }
            if (inf.entries.length) {
                var own = 'StremioK’s own data: about ' + fmtBytes(mine) + ' in ' + inf.entries.length + (inf.entries.length === 1 ? ' item' : ' items');
                line((inf.usage || 0) > mine + 65536 ? 'Of that, ' + own + '; the other ' + fmtBytes(inf.usage - mine) + ' is the database’s own: old versions of items saved again, which it clears out over time on its own (not copies StremioK keeps)' : own);
            }
            var sorted = inf.entries.slice().sort(function (a, b) { return b.bytes - a.bytes; });
            sorted.slice(0, STORAGE_ITEMS).forEach(function (e) {
                var d = storageItem(e.key), notes = [];
                if (e.saves) { notes.push(e.saves === 1 ? 'saved once since StremioK started' : 'saved ' + e.saves + ' times since StremioK started'); }
                if (d.unused) { notes.push('no longer used: ' + d.unused); }
                if (inf.lsKeys[e.key]) { notes.push('also in the settings storage'); }
                line(fmtBytes(e.bytes) + '   ' + d.name + notes.map(function (n) { return '   ·   ' + n; }).join(''));
            });
            if (sorted.length > STORAGE_ITEMS) {
                line('and ' + (sorted.length - STORAGE_ITEMS) + ' more: ' + fmtBytes(sorted.slice(STORAGE_ITEMS).reduce(function (n, e) { return n + e.bytes; }, 0)));
            }
            if (!inf.entries.length) { line(dbOn ? 'Nothing in the TV’s database.' : 'The TV’s database isn’t used (turned off above).'); }
            line('Settings storage: ' + fmtBytes(inf.ls) + ' (progress, watched marks, settings…)' + (inf.lsTop.length ? '; the largest:' : ''));
            inf.lsTop.forEach(function (e) { line('   ' + fmtBytes(e.bytes) + '   ' + e.key); });
            if (inf.disk) { line('The TV’s own disk: ' + fmtBytes(inf.disk.free) + ' free of ' + fmtBytes(inf.disk.total) + '  (what the TV allows StremioK follows it: freeing space, unused apps for one, raises it)'); }
        }
        r.__onselect = function () {
            if (!U.bigStore || !U.bigStore.info || _storageInfo === 'busy') { return; }
            _storageInfo = 'busy'; renderSettings();
            Promise.all([U.bigStore.info(), U.diskInfo ? U.diskInfo() : null]).then(function (both) {
                var inf = both[0], ls = 0, lsAll = [];
                inf.disk = both[1];
                inf.lsKeys = {};
                try {
                    for (var i = 0; i < window.localStorage.length; i++) {
                        var k = window.localStorage.key(i), n = (k.length + (window.localStorage.getItem(k) || '').length) * 2;
                        ls += n; lsAll.push({ key: k, bytes: n }); inf.lsKeys[k] = true;
                    }
                } catch (e) {}
                inf.ls = ls;
                inf.lsTop = lsAll.sort(function (a, b) { return b.bytes - a.bytes; }).slice(0, 5);
                _storageInfo = inf;
                if (_settingsSection === 'storage') { renderSettings(); }
            }, function () { _storageInfo = null; U.toast('Couldn’t check'); renderSettings(); });
        };
        wrap.appendChild(r);
        if (dbOn) {   // (tidying up: only while it's used)
            var tidy = U.el('div', 'addon-item focusable');
            tidy.appendChild(U.el('div', 'a-name', 'Tidy up the TV’s database'));
            tidy.appendChild(U.el('div', 'a-url', 'Gives back the space of old versions of what StremioK saved, which the TV’s database keeps (StremioK’s data stays). Done on its own when they take over half of what the TV allows'));
            tidy.__onselect = function () {
                if (!U.bigStore || !U.bigStore.tidy) { return; }
                U.toast('Tidying up the TV’s database…');
                U.bigStore.tidy().then(function (res) {
                    U.toast(!res ? 'Couldn’t tidy it up (Diagnostics › Logs says why)' : res.before != null && res.after != null ? 'The TV’s database: ' + fmtBytes(res.before) + ' → ' + fmtBytes(res.after) : 'Tidied up');
                    _storageInfo = null;
                    if (_settingsSection === 'storage') { renderSettings(); }
                });
            };
            wrap.appendChild(tidy);
        }
        var clr = U.el('div', 'addon-item focusable');
        clr.appendChild(U.el('div', 'a-name', 'Clear saved copies'));
        clr.appendChild(U.el('div', 'a-url', 'Home’s saved rows, IPTV playlist copies, the USB index: made again when needed (playlists download again)'));
        clr.__onselect = function () {
            confirm('Clear the copies StremioK can make again (Home rows, playlist copies, USB index)?', 'Clear', function () {
                U.bigStore.keys().then(function (ks) {
                    return Promise.all(ks.filter(function (k) { return /^stremiok\.(homecache|local\.index|iptv\.cache\.)/.test(k); }).map(function (k) { return U.bigStore.remove(k); }));
                }).then(function () {
                    if (typeof LocalMedia !== 'undefined') { LocalMedia.clearIndex(); }
                    _storageInfo = null;
                    U.toast('Saved copies cleared');
                    renderSettings();
                });
            });
        };
        wrap.appendChild(clr);
    }

    // How long this launch (and the one before) took to get going, from when the TV
    // started loading the app.
    var STARTUP_STEPS = [['css', 'stylesheet'], ['firstScreen', 'first screen'], ['addons', 'addons'], ['firstCard', 'first title']];
    function startupText(m) {
        var parts = [];
        STARTUP_STEPS.forEach(function (st) { if (m && typeof m[st[0]] === 'number') { parts.push(st[1] + ' ' + (m[st[0]] / 1000).toFixed(1) + ' s'); } });
        return parts.join('   ·   ');
    }
    function startupLines(wrap) {
        if (!U.startupMarks) { return; }
        var now = startupText(U.startupMarks()), before = startupText(U.startupMarks(true));
        if (!now && !before) { return; }
        var r = U.el('div', 'addon-item focusable startup-row');
        r.appendChild(U.el('div', 'a-name', 'Startup'));
        if (now) { r.appendChild(U.el('div', 'a-url', 'This launch: ' + now)); }
        if (before) { r.appendChild(U.el('div', 'a-url', 'Launch before: ' + before)); }
        wrap.appendChild(r);
    }

    // ----- Streaming apps: your apps on this TV that a title's "where to watch" sources
    // open (TVApps.appForService), then this TV's apps to add. OK on one of yours removes it. -----
    var _appsFocus = null;   // { id, ctl } to focus after a change
    var _appsAll = false;    // the add list includes hidden (system) apps
    function settingsAppShortcuts(wrap) {
        wrap.appendChild(U.el('h2', null, 'Streaming apps'));
        if (!canListApps()) {
            wrap.appendChild(U.el('div', 'hint', 'Only on the TV: this install can\'t see or open the TV\'s apps.'));
            focusSettings();
            return;
        }
        wrap.appendChild(U.el('div', 'hint feeds-hint', 'A title\'s "where to watch" sources open these apps. Most are found by name; list one only where the TV has several for a service (like Netflix). OK on one of yours removes it.'));
        function redo(id, ctl) { _appsFocus = { id: id, ctl: ctl }; renderSettings(); }
        var mine = TVApps.shortcuts(), nameOf = {};
        if (!mine.length) { wrap.appendChild(U.el('div', 'hint', 'None listed yet: pick apps below.')); }
        mine.forEach(function (a, i) {
            var r = U.el('div', 'addon-item focusable app-mine');
            r.setAttribute('data-fk', a.id); r.setAttribute('data-ctl', 'name');
            r.appendChild(U.el('div', 'a-name', a.name));
            nameOf[a.id] = U.el('div', 'a-url', a.id);
            r.appendChild(nameOf[a.id]);
            r.__onselect = function () {
                TVApps.remove(a.id);
                U.toast(a.name + ' removed', 1500);
                var next = mine[i + 1] || mine[i - 1];   // focus stays in the list
                redo(next ? next.id : null, next ? 'name' : 'add');
            };
            wrap.appendChild(r);
        });
        wrap.appendChild(U.el('div', 'formats-group', 'Add an app'));
        var status = U.el('div', 'hint', 'Reading this TV\'s apps…');
        wrap.appendChild(status);
        function focusNow() {
            var want = _appsFocus, pref = null;
            _appsFocus = null;
            var nodes = wrap.querySelectorAll('.app-mine, .app-add');
            for (var k = 0; want && k < nodes.length; k++) {
                if (nodes[k].getAttribute('data-fk') === (want.id || '') && nodes[k].getAttribute('data-ctl') === want.ctl) { pref = nodes[k]; break; }
            }
            if (!pref && want && want.ctl === 'add') { pref = wrap.querySelector('.app-add'); }
            Focus.setScope(scr('settings'), pref || wrap.querySelector('.app-mine, .app-add') || undefined);
        }
        TVApps.installed().then(function (apps) {
            if (_settingsSection !== 'appshortcuts' || !wrap.parentNode) { return; }   // left meanwhile
            var onTv = {};
            apps.forEach(function (a) { onTv[a.id] = true; });
            mine.forEach(function (a) { if (!onTv[a.id]) { nameOf[a.id].textContent += '   ·   not on this TV any more'; } });
            var hidden = 0;
            var list = apps.filter(function (a) {
                if (TVApps.has(a.id)) { return false; }
                if (!_appsAll && !a.show) { hidden++; return false; }
                return true;
            });
            status.textContent = list.length ? 'OK adds one. Where an app is listed more than once, pick the one that opens (Settings › Diagnostics › Installed apps tries them).'
                : 'Every app on this TV is already listed.';
            list.forEach(function (a, i) {
                var r = U.el('div', 'addon-item focusable app-add');
                r.setAttribute('data-fk', a.id); r.setAttribute('data-ctl', 'add');
                r.appendChild(U.el('div', 'a-name', a.name));
                r.appendChild(U.el('div', 'a-url', a.id + (a.show ? '' : '   ·   hidden (system) app')));
                r.__onselect = function () {
                    if (!TVApps.add(a)) { U.toast('That\'s the most apps StremioK keeps (' + TVApps.MAX + ')'); return; }
                    U.toast(a.name + ' added', 1500);
                    var next = list[i + 1] || list[i - 1];   // keep adding from here
                    redo(next ? next.id : a.id, next ? 'add' : 'name');
                };
                wrap.appendChild(r);
            });
            if (_appsAll || hidden) {
                var more = U.el('div', 'addon-item focusable app-add');
                more.setAttribute('data-fk', '*hidden'); more.setAttribute('data-ctl', 'hidden');
                more.appendChild(U.el('div', 'a-name', _appsAll ? 'Hide the hidden (system) apps' : 'Also show ' + hidden + ' hidden (system) app' + (hidden === 1 ? '' : 's')));
                more.__onselect = function () { _appsAll = !_appsAll; redo('*hidden', 'hidden'); };
                wrap.appendChild(more);
            }
            focusNow();
        }, function (e) {
            if (_settingsSection !== 'appshortcuts' || !wrap.parentNode) { return; }
            status.textContent = 'The TV didn\'t list its apps: ' + e.message;
            focusNow();
        });
    }

    // ----- Diagnostics › Installed apps: what the TV has installed, with each app's ID, read
    // on request. OK on one opens it, to check StremioK may launch it from this install. -----
    var _tvApps = null;   // null: not read yet; else { list, hidden, error, all, fresh }
    function canListApps() { return typeof TVApps !== 'undefined' && TVApps.available(); }
    function readTvApps(all) {
        function done(v) {
            v.all = !!all; v.fresh = true; _tvApps = v;
            if (_settingsSection === 'tvapps') { renderSettings(); }
        }
        TVApps.installed().then(function (apps) {
            var list = apps.filter(function (a) { return all || a.show; });
            done({ list: list, hidden: apps.length - list.length });
        }, function (e) { done({ error: e.message }); });
    }
    function launchTvApp(a) {
        TVApps.launch(a).then(null, function (e) { U.toast('Couldn\'t open ' + a.name + ': ' + e.message, 4000); });
    }
    // Returns the first app row (to focus), if the list is showing.
    function tvAppsSection(wrap) {
        wrap.appendChild(U.el('h2', null, 'Diagnostics  ›  Installed apps'));
        if (!canListApps()) {
            wrap.appendChild(U.el('div', 'hint', 'Only on the TV: this install can\'t see the TV\'s apps.'));
            return null;
        }
        if (!_tvApps) {
            var show = U.el('div', 'addon-item focusable');
            show.appendChild(U.el('div', 'a-name', 'Show installed apps'));
            show.appendChild(U.el('div', 'a-url', 'Their names and IDs, as the TV reports them'));
            show.__onselect = function () { readTvApps(false); };
            wrap.appendChild(show);
            return null;
        }
        if (_tvApps.error) {
            wrap.appendChild(U.el('div', 'hint', 'The TV didn\'t list its apps: ' + _tvApps.error));
            return null;
        }
        wrap.appendChild(U.el('div', 'hint', _tvApps.list.length + ' app' + (_tvApps.list.length === 1 ? '' : 's') +
            (_tvApps.all ? ', including hidden ones' : '') + '. OK on one opens it (to check StremioK can launch it).'));
        var first = null;
        _tvApps.list.forEach(function (a) {
            var r = U.el('div', 'addon-item focusable diag-row');
            r.appendChild(U.el('div', 'a-name', a.name));
            r.appendChild(U.el('div', 'a-url', a.id + (a.version ? '   ·   version ' + a.version : '')));
            r.__onselect = function () { launchTvApp(a); };
            wrap.appendChild(r);
            if (!first) { first = r; }
        });
        if (!_tvApps.all && _tvApps.hidden > 0) {
            var more = U.el('div', 'addon-item focusable');
            more.appendChild(U.el('div', 'a-name', 'Also show ' + _tvApps.hidden + ' hidden (system) app' + (_tvApps.hidden === 1 ? '' : 's')));
            more.__onselect = function () { readTvApps(true); };
            wrap.appendChild(more);
        }
        return first;
    }

    // ----- Home feeds and Search results (Settings > Appearance): order, show / hide -----
    // kind 'home': the Home rows (every catalog); 'search': the Search rows (every catalog
    // that can search, IPTV as one per type). ▲/▼ moves one; OK on its name shows / hides it.
    var FEED_KINDS = {
        home: { section: 'feeds', title: 'Appearance  ›  Home feeds', hint: '▲/▼ reorder a feed · OK on the name shows/hides it on Home.',
            list: function () { return Stremio.listCatalogsOrdered(); }, keyOf: function (c) { return Stremio.catalogKey(c); },
            move: function (k, d) { return Stremio.moveFeed(k, d); }, toggle: function (k) { Stremio.toggleFeed(k); },
            hidden: function (k) { return Stremio.isFeedHidden(k); } },
        search: { section: 'searchfeeds', title: 'Appearance  ›  Search results', hint: '▲/▼ reorder the Search rows · OK on the name shows/hides one in Search.',
            list: function () { return Stremio.searchSourcesOrdered(); }, keyOf: function (src) { return src.key; },
            move: function (k, d) { return Stremio.moveSearchFeed(k, d); }, toggle: function (k) { Stremio.toggleSearchFeed(k); },
            hidden: function (k) { return Stremio.isSearchFeedHidden(k); } },
        ranking: { section: 'ranking', title: 'Playback  ›  Source ranking', off: 'off',
            hint: 'Sources are ordered by these, top first: ▲/▼ moves one, OK turns it off or on. Resolution at the top groups the list by resolution. Your addons are below.',
            list: function () { return Promise.resolve(Stremio.getRanking().criteria); }, keyOf: function (c) { return c.key; },
            move: function (k, d) { Stremio.moveRanking(k, d); return Promise.resolve(); }, toggle: function (k) { Stremio.toggleRanking(k); },
            hidden: function (k) { return !Stremio.getRanking().criteria.some(function (c) { return c.key === k && c.on; }); },
            before: function (wrap) {   // played before, above the resolution groups
                var played = Stremio.getRanking().played;
                var r = U.el('div', 'addon-item focusable cfg-row feed-extra');
                r.setAttribute('data-fk', 'played'); r.setAttribute('data-ctl', 'extra');
                r.appendChild(U.el('div', 'a-name', 'Played before first:  ' + (played ? 'On' : 'Off')));
                r.appendChild(U.el('div', 'a-url', (played ? 'Sources you played for a title (for a series, its release) come before the resolution groups'
                    : 'Sources you played rank like any other') + '   ·   OK to turn ' + (played ? 'off' : 'on')));
                r.__onselect = function () { Stremio.setPlayedFirst(!played); refeed('ranking', 'played', 'extra'); };
                wrap.appendChild(r);
                // direct links only: the sources the TV can't play left out of the list
                var hideUn = Stremio.getPrefs().hideUnplayable;
                var un = U.el('div', 'addon-item focusable cfg-row feed-extra');
                un.setAttribute('data-fk', 'unplayable'); un.setAttribute('data-ctl', 'extra');
                un.appendChild(U.el('div', 'a-name', 'Sources the TV can’t play:  ' + (hideUn ? 'Hidden' : 'Shown')));
                un.appendChild(U.el('div', 'a-url', (hideUn ? 'Left out (torrents, links it can’t open): direct links only; where-to-watch apps stay'
                    : 'Listed, dimmed, at the bottom (torrents, links it can’t open)') + '   ·   OK to ' + (hideUn ? 'show them' : 'hide them')));
                un.__onselect = function () { Stremio.setPref('hideUnplayable', !hideUn); refeed('ranking', 'unplayable', 'extra'); };
                wrap.appendChild(un);
                // skip the source list: Play plays the top source at once
                var skipList = Stremio.getPrefs().skipSourceList;
                var sl = U.el('div', 'addon-item focusable cfg-row feed-extra');
                sl.setAttribute('data-fk', 'skiplist'); sl.setAttribute('data-ctl', 'extra');
                sl.appendChild(U.el('div', 'a-name', 'Skip the source list:  ' + (skipList ? 'On' : 'Off')));
                sl.appendChild(U.el('div', 'a-url', (skipList ? '▶ Play, OK on an episode and ▶ Play SxEx play the top source at once (hold OK on an episode › Details for the list)'
                    : '▶ Play and OK on an episode show the sources to pick from') + '   ·   OK to turn ' + (skipList ? 'off' : 'on')));
                sl.__onselect = function () { Stremio.setPref('skipSourceList', !skipList); refeed('ranking', 'skiplist', 'extra'); };
                wrap.appendChild(sl);
                // a source that doesn't start: the next one
                var nextOn = Stremio.getPrefs().nextOnFail;
                var nx = U.el('div', 'addon-item focusable cfg-row feed-extra');
                nx.setAttribute('data-fk', 'nextonfail'); nx.setAttribute('data-ctl', 'extra');
                nx.appendChild(U.el('div', 'a-name', 'The next source if one doesn’t start:  ' + (nextOn ? 'On' : 'Off')));
                nx.appendChild(U.el('div', 'a-url', (nextOn ? 'A source the TV refuses, or that hasn’t started after 45 s, gives way to the next best one (up to 3 more)'
                    : 'A source that doesn’t start takes you back to the list') + '   ·   OK to turn ' + (nextOn ? 'off' : 'on')));
                nx.__onselect = function () { Stremio.setPref('nextOnFail', !nextOn); refeed('ranking', 'nextonfail', 'extra'); };
                wrap.appendChild(nx);
                // size limits: movies and series apart
                [['movie', 'Movies’ sizes'], ['series', 'Series’ sizes (an episode)']].forEach(function (k) { wrap.appendChild(sizeRow(k[0], k[1])); });
                // your words: sources with one of them at the bottom, for every title
                var words = Stremio.getPrefs().hideWords;
                var w = U.el('div', 'addon-item focusable cfg-row feed-extra');
                w.setAttribute('data-fk', 'words'); w.setAttribute('data-ctl', 'extra');
                w.appendChild(U.el('div', 'a-name', 'Hide sources with these words:  ' + (words.length ? words.join(', ') : 'None')));
                w.appendChild(U.el('div', 'a-url', 'A source with one of them in its name, description or file name (a whole word: “CAM” isn’t in “CAMERA”) goes to the bottom, for every title   ·   OK to change'));
                w.__onselect = function () {
                    App.openEntry({ title: 'Hide sources with these words', value: words.join(', '), placeholder: 'CAM, HDTS, TELESYNC',
                        hint: 'Words separated by commas, capitals or not. Sources with one go to the bottom and are never picked on their own. Leave it empty for none.',
                        validate: function () { return null; },
                        onConfirm: function (v) { App.back(); Stremio.setHideWords(v); refeed('ranking', 'words', 'extra'); } });
                };
                wrap.appendChild(w);
                wrap.appendChild(U.el('div', 'formats-group', 'Then, in this order'));
            },
            after: function (wrap) {
                var r = U.el('div', 'addon-item focusable feed-extra');
                r.setAttribute('data-fk', 'reset'); r.setAttribute('data-ctl', 'extra');
                r.appendChild(U.el('div', 'a-name', 'Restore defaults'));
                r.appendChild(U.el('div', 'a-url', 'Played before first; then resolution, not yet cached last, release type, HDR before SDR, Feed sources order, each addon\'s own order (your addons stay as they are)'));
                r.__onselect = function () { Stremio.resetRanking(); refeed('ranking', 'reset', 'extra'); U.toast('Source ranking restored'); };
                wrap.appendChild(r);
                // The addons that provide sources (Feed sources): their order, and on / off
                wrap.appendChild(U.el('div', 'formats-group', 'Addons'));
                wrap.appendChild(U.el('div', 'hint', 'The addons that give sources: ▲/▼ sets their order, OK turns one off (it isn\'t asked).'));
                return Stremio.feedSourcesOrdered().then(function (items) {
                    if (!items.length) { wrap.appendChild(U.el('div', 'hint', 'None of your addons provide sources: add a stream addon in Settings › Content › Addons.')); }
                    feedRows(wrap, 'ranking', items, SOURCE_ROWS);
                }, function () { wrap.appendChild(U.el('div', 'hint', 'Your addons couldn\'t be read just now.')); });
            } }
    };
    // Size limits (Settings › Source ranking): smallest, largest and most per hour, for movies or
    // series; OK on the row: which one, then its value.
    var SIZE_CHOICES = {
        min: { label: 'Smallest', none: 'None', values: [0.1, 0.3, 0.5, 1, 2] },
        max: { label: 'Largest', none: 'None', values: [2, 4, 8, 15, 20, 30, 50, 80] },
        perHour: { label: 'Most per hour', none: 'None', values: [1, 1.5, 2, 3, 4, 6, 10], unit: ' an hour' }
    };
    function sizeSummary(L) {
        var bits = [];
        if (L.min) { bits.push('at least ' + Stremio.gbText(L.min)); }
        if (L.max) { bits.push('up to ' + Stremio.gbText(L.max)); }
        if (L.perHour) { bits.push('up to ' + Stremio.gbText(L.perHour) + ' an hour'); }
        return bits.length ? bits.join(', ') : 'No limits';
    }
    function sizeRow(kind, title) {
        var L = Stremio.getPrefs().sizeLimits[kind];
        var r = U.el('div', 'addon-item focusable cfg-row feed-extra');
        r.setAttribute('data-fk', 'size-' + kind); r.setAttribute('data-ctl', 'extra');
        r.appendChild(U.el('div', 'a-name', title + ':  ' + sizeSummary(L)));
        r.appendChild(U.el('div', 'a-url', 'Sources outside them go to the bottom (Outside your size limits) and are never picked on their own; a source without a size isn’t held to them   ·   OK to change'));
        r.__onselect = function () {
            var which = ['min', 'max', 'perHour'].map(function (w) {
                var C = SIZE_CHOICES[w];
                return [w, C.label + ':  ' + (L[w] ? Stremio.gbText(L[w]) + (C.unit || '') : C.none)];
            });
            pickList(title, which, null, function (w) {
                var C = SIZE_CHOICES[w];
                var opts = [['0', C.none]].concat(C.values.map(function (v) { return ['' + v, Stremio.gbText(v) + (C.unit || '')]; }));
                pickList(title + '  ›  ' + C.label, opts, '' + (L[w] || 0), function (v) {
                    Stremio.setSizeLimit(kind, w, +v);
                    refeed('ranking', 'size-' + kind, 'extra');
                });
            });
        };
        return r;
    }
    var _feedFocus = null;   // { key, ctl } of the control that made the last change
    function refeed(kind, key, ctl) {
        _feedFocus = { key: key, ctl: ctl };
        if (kind === 'home') { refreshAddonRows(); }   // the same rows, reordered / shown / hidden: nothing fetched
        renderSettings();
    }

    // The addons list at the bottom of Source ranking (Feed sources). Their keys are
    // prefixed, apart from the criteria's above them.
    var SOURCE_ROWS = { prefix: 'src:', off: 'off', keyOf: function (x) { return x.key; },
        move: function (k, d) { return Stremio.moveFeedSource(k, d); }, toggle: function (k) { Stremio.toggleFeedSource(k); },
        hidden: function (k) { return Stremio.isFeedSourceOff(k); } };
    // ⇈ ▲ ▼ ⇊ for a row of a list you put in order: to the top, one place up, one down, to the
    // bottom. move(dir, ctl) moves it (dir -Infinity / -1 / 1 / Infinity: see U.moveIn); mark(node,
    // ctl) tags each button, so the page can focus the one used once it's drawn again.
    var ORDER_BTNS = [['top', '⇈', -Infinity], ['up', '▲', -1], ['down', '▼', 1], ['bottom', '⇊', Infinity]];
    function orderButtons(move, mark) {
        return ORDER_BTNS.map(function (b) {
            var n = U.el('div', 'feed-btn focusable', b[1]);
            if (mark) { mark(n, b[0]); }
            n.__onselect = function () { move(b[2], b[0]); };
            return n;
        });
    }
    function ctlIndex(ctl) { for (var i = 0; i < ORDER_BTNS.length; i++) { if (ORDER_BTNS[i][0] === ctl) { return i; } } return 1; }
    // ⇈ ▲ ▼ ⇊ / name rows for an ordered list (L: keyOf, hidden, move, toggle, off, prefix).
    // After a change the page is drawn again, focused on the control used (refeed).
    function feedRows(wrap, kind, items, L) {
        items.forEach(function (item) {
            var key = L.keyOf(item), fk = (L.prefix || '') + key;
            var hidden = L.hidden(key);
            var frow = U.el('div', 'feed-row' + (hidden ? ' feed-off' : ''));

            var btns = orderButtons(function (dir, ctl) { L.move(key, dir).then(function () { refeed(kind, fk, ctl); }); },
                function (n, ctl) { n.setAttribute('data-fk', fk); n.setAttribute('data-ctl', ctl); });

            var name = U.el('div', 'feed-name focusable', item.name + (hidden ? '   (' + (L.off || 'hidden') + ')' : ''));
            name.setAttribute('data-fk', fk); name.setAttribute('data-ctl', 'name');
            name.__onselect = function () { L.toggle(key); refeed(kind, fk, 'name'); };

            btns.forEach(function (b) { frow.appendChild(b); });
            frow.appendChild(name);
            wrap.appendChild(frow);
        });
    }

    function settingsFeeds(wrap, kind) {
        var K = FEED_KINDS[kind];
        wrap.appendChild(U.el('h2', null, K.title));
        wrap.appendChild(U.el('div', 'hint feeds-hint', K.hint));
        if (K.before) { K.before(wrap); }
        K.list().then(function (items) {
            if (!items.length) { wrap.appendChild(U.el('div', 'hint', kind === 'search' ? 'None of your addons can search.' : 'No feeds yet: add catalog addons in Settings › Content › Addons.')); }
            feedRows(wrap, kind, items, K);
            return K.after ? K.after(wrap) : null;
        }).then(function () {
            // restore focus to the control that triggered the last change
            var pref = null;
            if (_feedFocus) {
                var nodes = wrap.querySelectorAll('.feed-btn, .feed-name, .feed-extra');
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i].getAttribute('data-fk') === _feedFocus.key && nodes[i].getAttribute('data-ctl') === _feedFocus.ctl) { pref = nodes[i]; break; }
                }
                _feedFocus = null;
            }
            Focus.setScope(scr('settings'), pref || wrap.querySelector('.feed-name') || undefined);
        });
    }

    // ----- published for the other parts (and js/views.js) -----
    V.applyAppearance = applyAppearance;
    V.backInSettings = backInSettings;
    V.renderEntry = renderEntry;
    V.renderSettings = renderSettings;
    V.settingsRoot = settingsRoot;
})(ViewParts);
