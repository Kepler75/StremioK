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
        s.appendChild(header(cfg.title || U.t('Enter value')));

        var wrap = U.el('div', 'add-wrap');
        if (cfg.hint) { wrap.appendChild(U.el('div', 'add-hint', cfg.hint)); }

        var input = document.createElement('input');
        input.id = 'entry-input';
        input.type = cfg.secret ? U.t('password') : 'text';
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
        var confirmBtn = U.el('div', 'pill focusable', U.t('Confirm'));
        var cancelBtn = U.el('div', 'pill focusable', U.t('Cancel'));
        confirmBtn.__onselect = doConfirm;
        cancelBtn.__onselect = function () { App.back(); };

        // Order: Validate · Confirm · Cancel
        var valBtn = null;
        if (cfg.validator) {
            valBtn = U.el('div', 'pill focusable', U.t('Validate'));
            valBtn.__onselect = function () {
                var v = ('' + input.value).trim();
                if (!v) { U.toast(U.t('Enter a key first')); return; }
                U.toast(U.t('Validating…'), 4000);
                cfg.validator(v).then(function (ok) {
                    U.toast(ok ? U.t('✓ Key is valid') : U.t('✗ Key rejected (or unreachable)'), 3500);
                });
            };
            row.appendChild(valBtn);
        }
        row.appendChild(confirmBtn);
        // From your phone (cfg.phone: what it's for): what's sent fills the field, to check and Confirm
        if (cfg.phone && V.phoneEntry) {
            var phoneBtn = U.el('div', 'pill focusable', U.t('▣  From your phone'));
            phoneBtn.__onselect = function () {
                var takes = cfg.phoneText;   // (text the caller takes as it is from the phone: an import's pasted file)
                V.phoneEntry({ title: cfg.title || U.t('Enter value'), what: cfg.phone, validate: function (t) { return takes && takes.accepts(t) ? null : (cfg.validate ? cfg.validate(t) : null); },
                    onText: function (t) { if (takes && takes.accepts(t)) { takes.take(t); return; } input.value = t; Focus.setFocus(confirmBtn); U.toast(U.t('From your phone: check it, then Confirm'), 3500); },
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
    // Every language player-lang recognizes on a track (its LANG_ALIASES), by name.
    var SUB_LANGS = [['off', U.t('Off')], ['afr', U.t('Afrikaans')], ['alb', U.t('Albanian')], ['ara', U.t('Arabic')],
        ['arg', U.t('Aragonese')], ['arm', U.t('Armenian')], ['ast', U.t('Asturian')], ['aze', U.t('Azerbaijani')],
        ['baq', U.t('Basque')], ['bel', U.t('Belarusian')], ['ben', U.t('Bengali')], ['bos', U.t('Bosnian')],
        ['bre', U.t('Breton')], ['bul', U.t('Bulgarian')], ['bur', U.t('Burmese')], ['cat', U.t('Catalan')],
        ['chi', U.t('Chinese')], ['hrv', U.t('Croatian')], ['cze', U.t('Czech')], ['dan', U.t('Danish')], ['prs', U.t('Dari')],
        ['dut', U.t('Dutch')], ['eng', 'English'], ['epo', U.t('Esperanto')], ['est', U.t('Estonian')],
        ['ext', U.t('Extremaduran')], ['fil', U.t('Filipino')], ['fin', U.t('Finnish')], ['fre', U.t('French')],
        ['glg', U.t('Galician')], ['geo', U.t('Georgian')], ['ger', U.t('German')], ['gre', U.t('Greek')],
        ['heb', U.t('Hebrew')], ['hin', U.t('Hindi')], ['hun', U.t('Hungarian')], ['ice', U.t('Icelandic')],
        ['ibo', U.t('Igbo')], ['ind', U.t('Indonesian')], ['ina', U.t('Interlingua')], ['gle', U.t('Irish')],
        ['ita', U.t('Italian')], ['jpn', U.t('Japanese')], ['kan', U.t('Kannada')], ['kaz', U.t('Kazakh')],
        ['khm', U.t('Khmer')], ['kor', U.t('Korean')], ['kur', U.t('Kurdish')], ['lav', U.t('Latvian')],
        ['lit', U.t('Lithuanian')], ['ltz', U.t('Luxembourgish')], ['mac', U.t('Macedonian')], ['may', U.t('Malay')],
        ['mal', U.t('Malayalam')], ['mni', U.t('Manipuri')], ['mar', U.t('Marathi')], ['mon', U.t('Mongolian')],
        ['mne', U.t('Montenegrin')], ['nav', U.t('Navajo')], ['nep', U.t('Nepali')], ['sme', U.t('Northern Sami')],
        ['nor', U.t('Norwegian')], ['oci', U.t('Occitan')], ['ori', U.t('Odia')], ['pus', U.t('Pashto')],
        ['per', U.t('Persian')], ['pol', U.t('Polish')], ['por', U.t('Portuguese')], ['pan', U.t('Punjabi')],
        ['rum', U.t('Romanian')], ['rus', U.t('Russian')], ['sat', U.t('Santali')], ['gla', U.t('Scottish Gaelic')],
        ['srp', U.t('Serbian')], ['snd', U.t('Sindhi')], ['sin', U.t('Sinhala')], ['slo', U.t('Slovak')],
        ['slv', U.t('Slovenian')], ['som', U.t('Somali')], ['spa', U.t('Spanish')], ['swa', U.t('Swahili')],
        ['swe', U.t('Swedish')], ['syr', U.t('Syriac')], ['tam', U.t('Tamil')], ['tat', U.t('Tatar')], ['tel', U.t('Telugu')],
        ['tha', U.t('Thai')], ['tok', U.t('Toki Pona')], ['tur', U.t('Turkish')], ['tuk', U.t('Turkmen')],
        ['ukr', U.t('Ukrainian')], ['urd', U.t('Urdu')], ['uzb', U.t('Uzbek')], ['vie', U.t('Vietnamese')],
        ['wel', U.t('Welsh')]];
    // A second choice, turned on when nothing is in the default language (from any source).
    var SUB_LANGS2 = [['none', U.t('None')]].concat(SUB_LANGS.slice(1));
    // The subtitle menu with only the three languages above (and tracks of no known language).
    var SUB_ONLY = [['off', U.t('Off')], ['on', U.t('On')]];
    var SUB_SIZES = [['small', U.t('Small')], ['medium', U.t('Medium')], ['large', U.t('Large')], ['xlarge', U.t('Extra Large')]];

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
        row.appendChild(U.el('div', 'a-url', U.t('Press OK to choose') + (store.warning ? '. ' + store.warning : '')));
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
    var AUDIO_LANGS = [['default', U.t('Default (first track)')]].concat(SUB_LANGS.slice(1));
    var AUDIO_LANGS2 = [['none', U.t('None')]].concat(SUB_LANGS.slice(1));
    // Switching to it, one choice: Quick (picked before it plays; a later switch reloads at
    // once), or Safe (picked once it plays) whose reload waits 3, 6 or 10 s after a start or a
    // jump: the 2017 TV's player crashes on a jump made right after another (10 s it needed).
    var AUDIO_SWITCH = [['quick', U.t('Quick (no wait)')], ['safe3', U.t('Safe, waits 3 seconds')], ['safe6', U.t('Safe, waits 6 seconds')], ['safe10', U.t('Safe, waits 10 seconds (safest)')]];
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
        wrap.appendChild(U.el('h2', null, U.t('Audio')));
        wrap.appendChild(subPickRow(U.t('Preferred language'), AUDIO_LANGS, 'lang', store));
        wrap.appendChild(subPickRow(U.t('Second choice'), AUDIO_LANGS2, 'lang2', store));
        wrap.appendChild(subPickRow(U.t('Switching to it'), AUDIO_SWITCH, 'mode', switching));
        wrap.appendChild(U.el('div', 'hint',
            U.t('The track in your preferred language plays on its own; with none, the second choice. The red key switches while watching. Switching to it: Quick starts in your language at once. Safe is for files where Quick names your language but you hear another (the 2017 TV needs 10 seconds).')));
        if (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew') {
            wrap.appendChild(U.el('div', 'hint', U.t('⚠ Under TizenBrew none of this applies: StremioK has no TV player there, and only a file’s first audio track plays. The sideloaded app can switch.')));
        }
        focusSettings();
    }

    // Appearance: background and accent color, applied right away and at every launch.
    var ACCENT_NAMES = { indigo: U.t('Indigo (default)'), sky: U.t('Sky'), teal: U.t('Teal'), emerald: U.t('Emerald'),
        amber: U.t('Amber'), orange: U.t('Orange'), rose: U.t('Rose'), violet: U.t('Violet'), gray: U.t('Gray'), darkgray: U.t('Dark gray') };
    // darkest to lightest (Dark is the default)
    var BACKGROUNDS = [['black', U.t('Black'), null, '#000000'], ['dark', U.t('Dark'), null, '#0e1117'],
        ['gray', U.t('Light Gray'), null, '#e4e6ea'], ['white', U.t('White'), null, '#ffffff']];
    function appearance() {
        var p = Stremio.getPrefs();
        var accent = p.accent, bg = p.bg;
        var bgs = { dark: 1, black: 1, gray: 1, white: 1 };
        return { accent: ACCENT_NAMES[accent] ? accent : 'indigo', bg: bgs[bg] ? bg : 'dark' };
    }
    // Zoom: everything bigger (see U.setZoom), in percent.
    var ZOOMS = [['100', '100%'], ['110', '110%'], ['120', '120%'], ['130', '130%'], ['140', '140%']];
    function zoomPct() { return Stremio.getPrefs().zoom; }
    // Look: Classic (the stylesheet as it is) or Modern (css/modern.css, its rules only under
    // body.look-modern). Effects, Modern's blur and motion: Auto turns them on where the TV's
    // browser can blur behind a panel (Tizen 6 and later), Light keeps them off, Full on.
    var LOOKS = [['classic', U.t('Classic')], ['modern', U.t('Modern')]];
    var EFFECTS = [['auto', U.t('Auto (by the TV)')], ['light', U.t('Light')], ['full', U.t('Full')]];
    function applyAppearance() {
        var a = appearance(), p = Stremio.getPrefs();
        U.applyTheme(a.accent, a.bg);
        U.setLook(p.look, p.effects, a.bg === 'gray' || a.bg === 'white');
        U.setZoom(zoomPct() / 100);
    }
    // The interface's language (js/i18n.js): Automatic (the TV's own), or one picked; each named in
    // its own language. Another one: StremioK restarts in it (its phrases are read as it starts).
    function languageRow() {
        var langs = typeof I18N !== 'undefined' ? I18N.langs() : [['en', 'English']];
        var name = function (code) { return (langs.filter(function (l) { return l[0] === code; })[0] || langs[0])[1]; };
        var auto = typeof I18N !== 'undefined' ? I18N.auto() : 'en';
        var list = [['auto', U.t('Automatic (the TV’s: {language})', { language: name(auto) })]].concat(langs);
        return subPickRow(U.t('Language'), list, 'lang', {
            get: function () { return { lang: Stremio.getPrefs().lang || 'auto' }; },
            set: function (cfg) {
                Stremio.setPref('lang', cfg.lang);
                var now = typeof I18N !== 'undefined' ? I18N.lang() : 'en', next = cfg.lang === 'auto' ? auto : cfg.lang;
                if (next === now) { return; }
                U.toast(U.t('Restarting in {language}…', { language: name(next) }));
                setTimeout(function () { try { window.location.reload(); } catch (e) {} }, 1200);
            }
        });
    }
    function settingsAppearance(wrap) {
        var store = { get: appearance, set: function (cfg) {
            Stremio.setPref('accent', cfg.accent);
            Stremio.setPref('bg', cfg.bg);
            applyAppearance();
        } };
        var accents = U.ACCENT_KEYS.map(function (k) { return [k, ACCENT_NAMES[k] || k, null, U.accentColor(k)]; });
        wrap.appendChild(U.el('h2', null, U.t('Appearance')));
        wrap.appendChild(languageRow());
        var looks = { get: function () { var p = Stremio.getPrefs(); return { look: p.look, effects: p.effects }; },
            set: function (cfg) { Stremio.setPref('look', cfg.look); Stremio.setPref('effects', cfg.effects); applyAppearance(); markHomeDirty(); } };
        wrap.appendChild(subPickRow(U.t('Look'), LOOKS, 'look', looks));
        wrap.appendChild(subPickRow(U.t('Effects'), EFFECTS, 'effects', looks));
        wrap.appendChild(subPickRow(U.t('Background'), BACKGROUNDS, 'bg', store));
        wrap.appendChild(subPickRow(U.t('Accent color'), accents, 'accent', store));
        wrap.appendChild(subPickRow(U.t('Zoom'), ZOOMS, 'zoom', {
            get: function () { return { zoom: '' + zoomPct() }; },
            set: function (cfg) { Stremio.setPref('zoom', +cfg.zoom); applyAppearance(); }
        }));
        wrap.appendChild(subPickRow(U.t('Poster orientation'), POSTER_SHAPES, 'posterShape', {
            get: function () { return { posterShape: Stremio.getPrefs().posterShape }; },
            set: function (cfg) { Stremio.setPref('posterShape', cfg.posterShape); markHomeDirty(); }   // Home redraws on return
        }));
        wrap.appendChild(subPickRow(U.t('Ratings on posters'), [['off', U.t('Off')], ['on', U.t('On')]], 'posterRatings', {
            get: function () { return { posterRatings: Stremio.getPrefs().posterRatings ? 'on' : 'off' }; },
            set: function (cfg) { Stremio.setPref('posterRatings', cfg.posterRatings === 'on'); markHomeDirty(); }
        }));
        wrap.appendChild(subPickRow(U.t('Watched titles'), [['show', U.t('Show')], ['dim', U.t('Dim')], ['hide', U.t('Hide')]], 'watchedCards', {
            get: function () { return { watchedCards: Stremio.getPrefs().watchedCards }; },
            set: function (cfg) { Stremio.setPref('watchedCards', cfg.watchedCards); markHomeDirty(); }   // (Home and Discover drawn again with it)
        }));
        wrap.appendChild(subPickRow(U.t('Hide spoilers'), [['off', U.t('Off')], ['pictures', U.t('Pictures')], ['all', U.t('Pictures and synopses')]], 'spoilers', {
            get: function () { return { spoilers: Stremio.getPrefs().spoilers }; },
            set: function (cfg) { Stremio.setPref('spoilers', cfg.spoilers); }
        }));
        focusSettings();
    }
    // Home: the tab a launch opens on, how many titles a row holds, the TV's home bar, and the
    // pages ordering the top menu, the Home rows and the Search rows.
    function settingsHome(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Home')));
        wrap.appendChild(subPickRow(U.t('Start on'), V.HOME_TABS.map(function (t) { return [t.key, t.label]; }), 'startTab', {
            get: function () { return { startTab: Stremio.getPrefs().startTab }; },
            set: function (cfg) { Stremio.setPref('startTab', cfg.startTab); }   // (the next launch: Home stays where it is now)
        }));
        wrap.appendChild(subPickRow(U.t('Titles in a Home row'), [['30', '30'], ['50', '50'], ['100', '100'], ['200', '200'], ['all', U.t('Unlimited')]], 'rowCards', {
            warning: U.t('Unlimited: Home can take much longer to load, an addon may refuse so many requests, and very long rows can slow an older TV'),
            get: function () { return { rowCards: '' + Stremio.getPrefs().rowCards }; },
            set: function (cfg) { Stremio.setPref('rowCards', cfg.rowCards === 'all' ? 'all' : +cfg.rowCards); clearCatalogCache(); }   // (the rows read again, with more pages or fewer)
        }));
        if (typeof HubPreview !== 'undefined' && HubPreview.available()) {   // (the sideloaded app: see js/hubpreview.js)
            // one choice: the tiles' order, or none (sent at once, whatever the wait)
            wrap.appendChild(subPickRow(U.t('Home bar preview'), [['recent', U.t('Most recent first')], ['watching', U.t('As in Watching')], ['off', U.t('Off')]], 'homeBar', {
                get: function () { var p = Stremio.getPrefs(); return { homeBar: p.homePreview ? p.homePreviewOrder : 'off' }; },
                set: function (cfg) {
                    Stremio.setPref('homePreview', cfg.homeBar !== 'off');
                    if (cfg.homeBar !== 'off') { Stremio.setPref('homePreviewOrder', cfg.homeBar === 'watching' ? 'watching' : 'recent'); }
                    HubPreview.send(true);
                }
            }));
        }
        var menu = sectionRow(U.t('Menu  ›'), U.t('Order the top menu, and show or hide its tabs'), 'menuorder');
        menu.className += ' cfg-row';
        wrap.appendChild(menu);
        var feeds = sectionRow(U.t('Home feeds  ›'), U.t('Order the Home rows, and show or hide each one'), 'feeds');
        feeds.className += ' cfg-row';
        wrap.appendChild(feeds);
        var sfeeds = sectionRow(U.t('Search results  ›'), U.t('Order the Search rows (one per catalog that can search), and show or hide each one'), 'searchfeeds');
        sfeeds.className += ' cfg-row';
        wrap.appendChild(sfeeds);
        var back = _focusChild === 'menuorder' ? menu : _focusChild === 'feeds' ? feeds : _focusChild === 'searchfeeds' ? sfeeds : null;
        _focusChild = null;
        if (back) { Focus.setScope(scr('settings'), back); } else { focusSettings(); }
    }

    // Formats: what plays on this TV. At the top, your settings: whether failures mark
    // formats "Not working" on their own, and which resolutions are allowed. Below, what's
    // been learned, filling in as sources are played: a format is "Working" once a source
    // with it plays, "Not working" after failed starts that point at it. OK switches one
    // between Working and Not working (your choice then sticks); sources with a "Not
    // working" format or a resolution you don't allow go to the bottom of the source list.
    var FORMAT_GROUPS = ['Video profile', 'Video', 'HDR', 'Audio', 'File', 'Other'];   // (the groups js/stremio.js names: shown as FORMAT_GROUP_NAMES)
    var FORMAT_GROUP_NAMES = { 'Video profile': U.t('Video profile'), Video: U.t('Video'), HDR: 'HDR', Audio: U.t('Audio'), File: U.t('File'), Other: U.t('Other') };
    var FORMAT_STATUS = { ok: U.t('Working'), bad: U.t('Not working'), unknown: U.t('Not sure yet') };
    function settingsFormats(wrap, focusKey) {
        wrap.appendChild(U.el('h2', null, U.t('Formats')));
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
        row('auto', U.t('Mark “Not working” automatically:') + '  ' + (auto ? U.t('On') : U.t('Off')),
            auto ? U.t('Formats that keep failing to start are marked Not working   ·   OK to turn off')
                 : U.t('Failures aren’t recorded; what’s marked stays, and what plays still counts   ·   OK to turn on'),
            'format-' + (auto ? 'ok' : 'unknown'), function () { Stremio.setPref('formatsAuto', !auto); });

        // allowed resolutions: yours to set, all allowed to begin with
        wrap.appendChild(U.el('div', 'formats-group', U.t('Resolutions')));
        Stremio.resList().forEach(function (r) {
            row('res:' + r.res, r.label + ':  ' + (r.allowed ? U.t('Allowed') : U.t('Not allowed')),
                (r.res === 0 ? U.t('Sources that don’t say') + '   ·   ' : '') + (r.allowed ? U.t('OK to not allow it') : U.t('OK to allow it')),
                'format-' + (r.allowed ? 'ok' : 'bad'), function () { Stremio.setResAllowed(r.res, !r.allowed); });
        });

        var list = Stremio.formatList();
        if (!list.length) {
            wrap.appendChild(U.el('div', 'hint',
                U.t('No formats yet. Each time you play a source, its formats are added here: its video profile (resolution, codec, bit depth, HDR), audio and file type, as working, or not working if it won’t start.')));
        }
        FORMAT_GROUPS.forEach(function (g) {
            var items = list.filter(function (f) { return f.group === g; });
            if (!items.length) { return; }
            items.sort(function (a, b) { return (a.order - b.order) || (a.label < b.label ? -1 : 1); });   // profiles: 4K first
            wrap.appendChild(U.el('div', 'formats-group', FORMAT_GROUP_NAMES[g] || g));
            items.forEach(function (f) {
                var sub = [];
                if (f.ok) { sub.push(U.tn(f.ok, 'played {n} time', 'played {n} times')); }
                if (f.fail) { sub.push(U.tn(f.fail, 'didn’t start {n} time', 'didn’t start {n} times')); }
                sub.push(f.set ? U.t('set by you') : (f.status === 'ok' ? U.t('OK to mark it Not working') : U.t('OK to mark it Working')));
                row(f.key, f.label + ':  ' + FORMAT_STATUS[f.status], sub.join('   ·   '), 'format-' + f.status, function () {
                    Stremio.setFormat(f.key, f.status === 'ok' ? 'bad' : 'ok');
                });
            });
        });
        if (list.length) {
            var reset = U.el('div', 'addon-item focusable');
            reset.appendChild(U.el('div', 'a-name', U.t('Forget all formats')));
            reset.appendChild(U.el('div', 'a-url', U.t('Start learning again from the next source you play (resolutions stay as set)')));
            reset.__onselect = function () {
                confirm(U.t('Forget what’s known about every format?'), U.t('Forget'), function () { Stremio.resetFormats(); redrawFormats(null); });
            };
            wrap.appendChild(reset);
        }
        wrap.appendChild(U.el('div', 'hint',
            U.t('Sources at a resolution that isn’t allowed, or with a “Not working” format, go to the bottom of the source list; ▶ Play best and Next episode skip them.')));
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

    // Settings is five groups (Content, Playback, Appearance, Home, Diagnostics); each opens a page
    // of its sections. [title, description, section] rows; Appearance and Home are pages of their
    // own (their settings right on them; Home's Menu, Home feeds and Search results open pages).
    var SETTINGS_GROUPS = {
        content: { title: U.t('Content'), rows: [
            [U.t('Addons'), U.t('Catalog, stream & subtitle addons'), 'addons'],
            [U.t('Streaming server'), U.t('Stremio’s streaming server or TorrServer on your network: torrents, and videos the TV can’t play'), 'server'],
            [U.t('Integrations'), U.t('API keys (OMDb, TMDB, MDBList), where-to-watch country'), 'integrations'],
            ['IPTV', U.t('Manage M3U playlist URLs'), 'iptv'],
            ['YouTube', U.t('Your YouTube channels, playlists and searches; YouTube in Search'), 'youtube'],
            [U.t('Streaming apps'), U.t('Your apps (Prime Video, Netflix, …) that open a title\'s "where to watch" sources'), 'appshortcuts'],
            [U.t('USB drive'), U.t('The Local tab: what\'s on your drive, matched to titles; hidden files'), 'usb'],
            [U.t('Network folders'), U.t('Folders a NAS or computer shares over WebDAV, in the Local tab: their videos as sources'), 'netfolders'],
            [U.t('Media servers'), U.t('Your Jellyfin or Emby server: its libraries on Home, its files as sources'), 'mediaservers'],
            [U.t('Nuvio plugins'), U.t('Programs written for the Nuvio apps that look for sources: someone else’s code, run on your TV'), 'plugins'],
            [U.t('Import configuration file'), U.t('Import addons, API keys & IPTV playlists'), 'import'],
            [U.t('Export configuration'), U.t('Your addons, playlists, API keys and settings, to your phone'), 'export']] },
        playback: { title: U.t('Playback'), rows: [
            [U.t('Audio'), U.t('Preferred and second-choice audio language'), 'audio'],
            [U.t('Subtitles'), U.t('Default language, size, color, background, position, font'), 'subtitles'],
            [U.t('Skipping'), U.t('Intros, recaps and previews, and the next episode at the credits: ask, or on their own after a countdown'), 'skipping'],
            [U.t('Seeking & buffering'), U.t('How far ◀ ▶ jump; a bigger buffer for slow connections; reconnecting live channels'), 'seeking'],
            [U.t('Source ranking'), U.t('How sources are ordered (played before, resolution, release type…), and your addons: their order, on or off'), 'ranking'],
            [U.t('Formats'), U.t('Allowed resolutions, and what plays on this TV, learned as you watch'), 'formats'],
            [U.t('Private viewing'), U.t('Play without anything recorded: no progress, Continue Watching, watched marks or Trakt'), 'private']] },
        diagnostics: { title: U.t('Diagnostics'), rows: [
            [U.t('Logs'), U.t('Recent problems (failed downloads, playback and script errors), secrets masked; how long launches took'), 'logs'],
            [U.t('Storage'), U.t('What StremioK keeps on the TV; the TV’s database: on or off, tidying it up; clearing saved copies'), 'storage'],
            [U.t('Installed apps'), U.t('The TV’s apps with their IDs; OK on one opens it'), 'tvapps']] }
    };

    // Return true if BACK stepped a settings section back to the menu.
    // BACK goes up one level, onto the row it came from: from a section to its group (on
    // that section, not the first one), from Menu / Home feeds / Search results to Home,
    // from a group to the Settings list (on that group).
    var SECTION_PARENT = { menuorder: 'home', feeds: 'home', searchfeeds: 'home', aiomanager: 'addons', subtitlelook: 'subtitles', rankfilters: 'ranking', rankplay: 'ranking' };
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
        else if (_settingsSection === 'subtitlelook') { settingsSubtitleLook(wrap); }
        else if (_settingsSection === 'skipping') { settingsSkipping(wrap); }
        else if (_settingsSection === 'seeking') { settingsSeeking(wrap); }
        else if (_settingsSection === 'menuorder') { settingsFeeds(wrap, 'menu'); }
        else if (_settingsSection === 'feeds') { settingsFeeds(wrap, 'home'); }
        else if (_settingsSection === 'searchfeeds') { settingsFeeds(wrap, 'search'); }
        else if (_settingsSection === 'ranking') { settingsFeeds(wrap, 'ranking'); }
        else if (_settingsSection === 'rankfilters') { settingsRankFilters(wrap); }
        else if (_settingsSection === 'rankplay') { settingsRankPlay(wrap); }
        else if (SETTINGS_GROUPS[_settingsSection]) { settingsGroup(wrap, _settingsSection); }
        else if (_settingsSection === 'logs') { settingsLogs(wrap); }
        else if (_settingsSection === 'storage') { settingsStorage(wrap); }
        else if (_settingsSection === 'tvapps') { settingsTvApps(wrap); }
        else if (_settingsSection === 'usb') { settingsUsb(wrap); }
        else if (_settingsSection === 'netfolders') { settingsNetFolders(wrap); }
        else if (_settingsSection === 'mediaservers') { settingsMediaServers(wrap); }
        else if (_settingsSection === 'plugins') { settingsPlugins(wrap); }
        else if (_settingsSection === 'private') { settingsPrivate(wrap); }
        else if (_settingsSection === 'appshortcuts') { settingsAppShortcuts(wrap); }
        else if (_settingsSection === 'import') { settingsImport(wrap); }
        else if (_settingsSection === 'export') { settingsExport(wrap); }
        else if (_settingsSection === 'aiomanager') { settingsAiom(wrap); }
        else if (_settingsSection === 'server') { settingsServer(wrap); }
        else if (_settingsSection === 'appearance') { settingsAppearance(wrap); }
        else if (_settingsSection === 'home') { settingsHome(wrap); }
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
                el.textContent = U.t('Reading playlists…  {n} channels', { n: ('' + n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') });
            }
        });
    }

    // TizenBrew serves every module from the same address, so they all share one storage:
    // another module you install can read what StremioK saves (see the README).
    var TIZENBREW_NOTE = U.t('⚠ Installed with TizenBrew: other TizenBrew modules can read what StremioK saves, including API keys and addon links with their tokens. Only install modules you trust; the sideloaded app keeps its data to itself.');
    function settingsMenu(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Settings')));
        wrap.appendChild(sectionRow(U.t('Content'), U.t('Addons, API keys, IPTV playlists, media servers, streaming apps, importing a configuration file'), 'content'));
        wrap.appendChild(sectionRow(U.t('Playback'), U.t('Audio and subtitles, source ranking, feed sources, formats'), 'playback'));
        wrap.appendChild(sectionRow(U.t('Appearance'), U.t('Look, background, accent color, zoom, posters, spoilers'), 'appearance'));
        wrap.appendChild(sectionRow(U.t('Home'), U.t('The tab it opens on, the top menu, Home feeds, Search results'), 'home'));
        wrap.appendChild(sectionRow(U.t('Diagnostics'), U.t('Logs, storage, installed apps; how StremioK was installed'), 'diagnostics'));
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
        g.rows.forEach(function (row) {
            if (row[2] === 'plugins' && !(typeof Plugins !== 'undefined' && Plugins.supported())) { return; }   // (a TV that can't run them: not offered)
            wrap.appendChild(sectionRow(row[0], row[1], row[2]));
        });
        if (key === 'diagnostics') {
            if (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew') { wrap.appendChild(U.el('div', 'hint', TIZENBREW_NOTE)); }
            // How StremioK was installed, and whether its YouTube service (channels, trailers) answers
            if (typeof YTPlay !== 'undefined' && YTPlay.installLabel) {
                // (and which video player plays: the TV's own, or the page's, as under TizenBrew)
                var player = '   ·   ' + U.t('Video player: {player}', { player: (window.webapis && webapis.avplay) ? U.t('the TV’s own') : YTPlay.installMode() === 'tizenbrew' ? U.t('the page’s (TizenBrew has no TV player: one audio track)') : U.t('the browser’s') });
                var about = U.el('div', 'hint settings-about', U.t('Installed as: {how}', { how: YTPlay.installLabel() }) + player + '   ·   ' + U.t('YouTube service: checking…'));
                wrap.appendChild(about);
                YTPlay.isRunning().then(function (up) {
                    about.textContent = U.t('Installed as: {how}', { how: YTPlay.installLabel() }) + player + '   ·   ' +
                        (up ? U.t('YouTube service: running') : YTPlay.installMode() === 'wgt' ? U.t('YouTube service: starts when needed') : U.t('YouTube service: not running'));
                });
            }
        }
        focusBack(wrap);
    }

    var _addonFocus = null;   // { url, ctl }: the ▲ / ▼ just pressed, focused again once redrawn
    // What an addon gives StremioK, from its manifest: catalogs (how many), search, details,
    // sources, subtitles; and the kinds of titles.
    var TYPE_NAMES = { movie: U.t('Movies'), series: U.t('Series'), anime: U.t('Anime'), tv: U.t('TV'), channel: U.t('Channels'), events: U.t('Events'), sport: U.t('Sports'), radio: U.t('Radio'), other: U.t('Other') };
    function addonGives(m) {
        var res = (m.resources || []).map(function (r) { return typeof r === 'string' ? r : r && r.name; });
        var cats = m.catalogs || [], bits = [], types = [];
        if (cats.length) { bits.push(U.t('Catalogs ({n})', { n: cats.length })); }
        if (cats.some(function (c) { return (c.extra || []).some(function (e) { return e && e.name === 'search'; }) || (c.extraSupported || []).indexOf('search') !== -1; })) { bits.push(U.t('Search')); }
        if (res.indexOf('meta') !== -1) { bits.push(U.t('Details')); }
        if (res.indexOf('stream') !== -1) { bits.push(U.t('Sources')); }
        if (res.indexOf('subtitles') !== -1) { bits.push(U.t('Subtitles')); }
        (m.types || []).forEach(function (t) {
            var n = TYPE_NAMES[t] || (('' + t).charAt(0).toUpperCase() + ('' + t).slice(1));
            if (types.indexOf(n) === -1) { types.push(n); }
        });
        return U.t('Gives: {what}', { what: bits.length ? bits.join(' · ') : U.t('nothing StremioK uses') }) + (types.length ? '   ·   ' + types.slice(0, 8).join(', ') : '');
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
        wrap.appendChild(U.el('h2', null, U.t('Addons')));
        // Home-network links from addons on the internet (see Stremio.blocksLocal)
        var allow = !!Stremio.getPrefs().allowLocal;
        var lan = U.el('div', 'addon-item focusable cfg-row');
        lan.appendChild(U.el('div', 'a-name', U.t('Local-network links from internet addons:') + '  ' + (allow ? U.t('Allowed') : U.t('Blocked'))));
        lan.appendChild(U.el('div', 'a-url', (allow ? U.t('An addon on the internet may send links into your home network (router, NAS, cameras…)')
            : U.t('Links an internet addon points into your home network are left out (your own network’s addons and playlists aren’t affected)')) +
            '   ·   ' + (allow ? U.t('OK to block') : U.t('OK to allow'))));
        lan.__onselect = function () { Stremio.setAllowLocal(!allow); clearCatalogCache(); renderSettings(); };
        wrap.appendChild(lan);
        wrap.appendChild(subPickRow(U.t('Wait for addons'), ADDON_WAITS, 'addonWait', {
            get: function () { return { addonWait: '' + Stremio.getPrefs().addonWait }; },
            set: function (cfg) { Stremio.setPref('addonWait', +cfg.addonWait || 0); }
        }));
        Stremio.loadAddons().then(function (addons) {
            var urls = Stremio.getAddonUrls(), want = null;
            if (urls.length > 1) { wrap.appendChild(U.el('div', 'hint', U.t('▲ / ▼ set the order: a title\'s details come from the highest addon that has them (its page says which), and the higher addon comes first where several answer.'))); }
            urls.forEach(function (url) {
                var off = !!(Stremio.isAddonOff && Stremio.isAddonOff(url)), kept = off && Stremio.savedManifest ? Stremio.savedManifest(url) : null;
                var loaded = addons.find(function (a) { return a.url === url; }) || (kept ? { url: url, manifest: kept } : null);   // (one that's off: its saved manifest)
                var frow = U.el('div', 'feed-row playlist-row' + (off ? ' feed-off' : ''));
                var btns = orderButtons(function (dir, ctl) { if (Stremio.moveAddon(url, dir)) { _addonFocus = { url: url, ctl: ctl }; refreshAddonRows(); renderSettings(); } });
                var item = U.el('div', 'addon-item focusable playlist-item has-logo');
                item.appendChild(addonTile(loaded && loaded.manifest, url));
                var why = !loaded && Stremio.manifestProblem ? Stremio.manifestProblem(url) : '';   // "too large (over 2 MB)", "not an addon manifest"…
                var nm = U.el('div', 'a-name', (loaded ? (loaded.manifest.name || U.t('Addon')) : off ? U.t('Addon') : (why ? U.t('(failed to load: {why})', { why: why }) : U.t('(failed to load)'))) + (off ? '   ' + U.t('(off)') : ''));
                var origin = Stremio.addonOrigin ? Stremio.addonOrigin(url) : '', ob = originBadge(origin);
                if (ob) { nm.appendChild(ob); }
                item.appendChild(nm);
                item.appendChild(U.el('div', 'a-url', U.redactUrl(url) + (origin ? '   ·   ' + ORIGIN_BADGE[origin][2] : '')));   // (personal tokens masked)
                if (loaded) { item.appendChild(U.el('div', 'a-url addon-gives', addonGives(loaded.manifest))); }
                var said = !loaded && Stremio.manifestDetail ? Stremio.manifestDetail(url) : '';   // the addon's own error message
                if (said) { item.appendChild(U.el('div', 'a-url addon-said', U.t('The addon says: {said}', { said: said }))); }
                var note = Stremio.thirdPartyNote ? Stremio.thirdPartyNote(loaded ? loaded.manifest.id : url) : '';   // (WatchHub)
                if (note) { item.appendChild(U.el('div', 'a-url addon-said', '⚠ ' + note)); }
                var name = loaded ? (loaded.manifest.name || U.t('Addon')) : U.t('this addon');
                item.__onselect = function () {
                    addonActions(name, url);
                };
                if (urls.length > 1) { btns.forEach(function (b) { frow.appendChild(b); }); }
                frow.appendChild(item);
                wrap.appendChild(frow);
                if (_addonFocus && _addonFocus.url === url) { want = btns[ctlIndex(_addonFocus.ctl)]; }
            });

            var addRow = U.el('div', 'addon-item focusable add-row');
            addRow.appendChild(U.el('div', 'a-name', U.t('+  Add addon')));
            addRow.appendChild(U.el('div', 'a-url', U.t('Enter a Stremio addon manifest URL on its own page')));
            addRow.__onselect = function () {
                App.openEntry({
                    title: U.t('Add addon'), phone: 'addon',
                    hint: U.t('Type a Stremio addon manifest URL. Nothing is saved until you Confirm.'),
                    value: 'https://', placeholder: 'https://addon.example/manifest.json',
                    validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                    onConfirm: function (v) {
                        var added = Stremio.addAddon(v), note = Stremio.thirdPartyNote(added || v);
                        refreshAddonRows(added || null);
                        U.toast(note ? U.t('Addon added. {note}', { note: note }) : U.t('Addon added'), note ? 8000 : undefined);
                        App.back(); renderSettings();
                    }
                });
            };
            wrap.appendChild(addRow);
            if (typeof StremioAccount !== 'undefined') {
                var acct = U.el('div', 'addon-item focusable add-row');
                var an = U.el('div', 'a-name', U.t('Import addons from your Stremio account'));
                an.appendChild(originBadge('stremio'));
                acct.appendChild(an);
                acct.appendChild(U.el('div', 'a-url', typeof StremioSync !== 'undefined' && StremioSync.isConnected() ? U.t('From the account connected in Integrations: tick the addons to add')
                    : U.t('Sign in on your phone with a QR code, then tick the addons to add (StremioK signs out straight after)')));
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
                aio.appendChild(U.el('div', 'a-url', am.base && am.key ? (am.at ? U.t('Last synced {when}', { when: U.dayLabel(am.at) }) + '   ·   ' : '') + U.t('OK for ↻ Sync: refresh, add new, remove the ones gone from it')
                    : U.t('Your AIOManager’s address and API key, then ↻ Sync your addons with it')));
                aio.__onselect = function () { _settingsSection = 'aiomanager'; renderSettings(); };
                wrap.appendChild(aio);
                if (_focusChild === 'aiomanager') { want = aio; _focusChild = null; }
            }

            wrap.appendChild(U.el('div', 'hint',
                U.t('StremioK hosts no content — add Stremio addon manifest URLs for catalogs, streams and subtitles.')));
            _addonFocus = null;
            if (want) { Focus.setScope(scr('settings'), want); } else { focusSettings(); }
        });
    }

    // Import addons from your Stremio account (js/stremio-account.js): a QR code of Stremio's
    // sign-in link, asked until you approve on your phone; then the account's addons to tick
    // (none ticked; yours already shown as such); the account signed out as soon as it's read.
    // Connected (Settings › Integrations): its kept sign-in used, and kept.
    function stremioImport() {
        if (typeof StremioSync !== 'undefined' && StremioSync.isConnected() && !StremioSync.connectStatus().reconnect) {
            U.spinner(true);
            StremioAccount.addons(StremioSync.authKey()).then(function (list) { U.spinner(false); importPick(list); }, function (e) {
                U.spinner(false);
                U.toast(U.t('Couldn’t import: {why}', { why: (e && e.message) || U.t('unknown') }), 5000);
            });
            return;
        }
        stremioSignIn(U.t('Import addons from your Stremio account'), function (key, body, gone, fail) {
            U.clear(body);
            body.appendChild(U.el('div', 'tc-line', U.t('Reading your addons…')));
            var read = StremioAccount.addons(key);
            read.then(function () { StremioAccount.signOut(key); }, function () { StremioAccount.signOut(key); });   // (signed out as soon as it's read)
            return read.then(function (list) {
                if (gone()) { return; }
                if (!list.length) { fail(new Error(U.t('your account has no addons StremioK can use'))); return; }
                closeModal();
                importPick(list);
            });
        });
    }
    function importPick(list) {
        if (!list.length) { U.toast(U.t('Your Stremio account has no addons StremioK can use'), 5000); return; }
        var mine = Stremio.getAddonUrls();
        var items = list.map(function (x, i) {
            var have = mine.indexOf(x.url) !== -1 || mine.indexOf(Stremio.normalizeUrl ? Stremio.normalizeUrl(x.url) : x.url) !== -1;
            return { key: '' + i, label: x.name + '  ·  ' + shortHost(x.url), have: have };
        });
        pickMany(U.t('Your Stremio addons: tick the ones to add'), items, { button: function (n) { return U.tn(n, 'Import {n} addon', 'Import {n} addons'); } }, function (keys) {
            var n = 0, last = null;
            keys.forEach(function (k) { var added = Stremio.addAddon(list[+k].url); if (added) { n++; last = added; if (Stremio.setAddonOrigin) { Stremio.setAddonOrigin(added, 'stremio'); } } });
            clearCatalogCache();
            refreshAddonRows(last);
            U.toast(U.tn(n, 'Imported {n} addon', 'Imported {n} addons'), 3000);
            renderSettings();
        });
    }
    // Stremio's sign-in box: a code and a QR code of its link, asked until it's approved on your
    // phone; then signedIn(key, body, gone, fail) (gone(): the box closed meanwhile: the key is
    // given up).
    function stremioSignIn(title, signedIn) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay'), box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', title));
        var body = U.el('div', 'trakt-connect');
        body.appendChild(U.el('div', 'tc-line', U.t('Asking Stremio for a code…')));
        box.appendChild(body);
        var row = U.el('div', 'modal-row'), cancel = U.el('div', 'pill focusable modal-btn', U.t('Cancel'));
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
            body.appendChild(U.el('div', 'tc-line', 'Couldn’t ' + (/^Import/.test(title) ? 'import' : 'connect') + ': ' + ((e && e.message) || 'unknown')));
        }
        StremioAccount.start().then(function (c) {
            if (gone) { return; }
            U.clear(body);
            var qrSpot = U.el('div', 'tc-qr-spot');
            body.appendChild(qrSpot);
            var goTo = body.appendChild(U.el('div', 'tc-line', U.t('On your phone or computer, go to:')));
            (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
                var qr = U.qrCanvas(c.link, 8);
                if (!qr || !qrSpot.parentNode) { return; }
                qr.className = 'tc-qr';
                qrSpot.appendChild(U.el('div', 'tc-line', U.t('Scan with your phone:')));
                qrSpot.appendChild(qr);
                goTo.textContent = U.t('or go to');
            }, function () {});
            body.appendChild(U.el('div', 'tc-url', c.link));
            body.appendChild(U.el('div', 'tc-line', U.t('Code:')));
            body.appendChild(U.el('div', 'tc-code', c.code));
            body.appendChild(U.el('div', 'tc-line small', U.t('Sign in to Stremio there and approve. Waiting…')));
            return StremioAccount.wait(c.code, stopped).then(function (key) {
                if (gone) { StremioAccount.signOut(key); return; }
                return signedIn(key, body, stopped, fail);
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
    var ORIGIN_BADGE = { stremio: ['S', 'src-s', U.t('From Stremio')], aiomanager: ['A', 'src-a', U.t('From AIOManager')], config: ['C', 'src-c', U.t('From a configuration file')] };
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
        pickList(U.t('Your AIOManager'), AIOM_PUBLIC.map(function (x) { return [x[0], x[1] + '  ·  ' + shortHost(x[0])]; })
            .concat([['other', U.t('Another address…  (your own: type it, or ▣ from your phone)')]]), am.base || null, function (k) {
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
            title: U.t('Your AIOManager’s address'), phone: 'aiom',
            hint: U.t('The address you open AIOManager at (your instance), e.g. https://aiomanager.example.com. Kept on the TV.'),
            value: am.base || 'https://', placeholder: 'https://aiomanager.example.com',
            validate: function (v) { return U.urlProblem(v) || null; },
            onConfirm: function (v) { aiomSetBase(('' + v).trim().replace(/\/+$/, '')); App.back(); if (then) { then(); } else { renderSettings(); } }
        });
    }
    function aiomAskKey(then) {
        App.openEntry({
            title: U.t('Your AIOManager API key'), phone: 'aiomkey', secret: true,
            hint: U.t('Your account’s API key, from AIOManager (the account’s settings). Kept on the TV like your other API keys; StremioK only reads your addons with it.'),
            value: '', placeholder: U.t('API key'),
            validate: function (v) { return /^[\x21-\x7e]{6,300}$/.test(('' + v).trim()) ? null : U.t('That doesn’t look like an API key'); },
            onConfirm: function (v) { aiomSave({ key: ('' + v).trim() }); App.back(); if (then) { then(); } else { renderSettings(); } }
        });
    }
    function settingsAiom(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Addons  ›  AIOManager')));
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
        row(U.t('Address:') + '  ' + (am.base || U.t('Not set')), U.t('Your AIOManager instance') + '   ·   ' + (am.base ? U.t('OK to change') : U.t('OK to set')), function () { aiomAskAddress(); });
        row(U.t('API key:') + '  ' + (am.key ? '••••' + am.key.slice(-4) : U.t('Not set')), U.t('Your account’s, from AIOManager') + '   ·   ' + (am.key ? U.t('OK to change') : U.t('OK to set')), function () { aiomAskKey(); });
        if (am.base && am.key) {
            row(U.t('↻  Sync with AIOManager'), (am.at ? U.t('Last synced {when}', { when: U.dayLabel(am.at) }) + (am.count ? '   ·   ' + U.tn(am.count, '{n} addon in AIOManager', '{n} addons in AIOManager') : '') : U.t('Not synced yet')) +
                '   ·   ' + U.t('refresh, add new, remove the ones gone from it'), aiomSync);
        }
        if (am.base || am.key) {
            row(U.t('Forget AIOManager'), U.t('Its address, your API key and what came from it, cleared (your addons stay)'), function () { U.store.remove(AIOM_KEY); U.toast(U.t('AIOManager forgotten'), 2500); renderSettings(); });
        }
        focusSettings();
    }
    function aiomSync() {
        var am = aiomSaved();
        if (!am.base) { aiomAskAddress(aiomSync); return; }
        if (!am.key) { aiomAskKey(aiomSync); return; }
        function norm(u) { return (Stremio.normalizeAddonUrl && Stremio.normalizeAddonUrl(u)) || u; }
        U.toast(U.t('Reading your AIOManager addons…'), 4000);
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
            if (shared.length) { items.push({ key: 'refresh', label: U.tn(shared.length, '↻ Refresh the {n} addon you have from AIOManager', '↻ Refresh the {n} addons you have from AIOManager') }); }
            add.forEach(function (x, i) { items.push({ key: 'add:' + i, label: U.t('+ Add') + '  ·  ' + U.drawable(x.name || shortHost(x.url)).slice(0, 50) + '  ·  ' + shortHost(x.url) }); });
            gone.forEach(function (u, i) {
                var x = byNorm[norm(u)];
                items.push({ key: 'rm:' + i, label: U.t('− Remove') + '  ·  ' + (x && x.name ? U.drawable(x.name).slice(0, 50) + '  ·  ' : '') + shortHost(u), note: x ? U.t('off in AIOManager') : U.t('gone from AIOManager') });
            });
            function done(n, addedUrls) {   // what came from it: as before, and what this sync added (still in your list)
                var now = (addedUrls || []).map(norm);
                var keptUrls = Stremio.getAddonUrls().filter(function (u) { return fromIt(u) || now.indexOf(norm(u)) !== -1; });
                aiomSave({ synced: keptUrls.map(norm), at: Date.now(), count: there.length });
                if (n) { clearCatalogCache(); refreshAddonRows(null); }
                renderSettings();
            }
            if (!items.length) { U.toast(U.t('Nothing to sync: AIOManager has no addons StremioK can use'), 4000); done(0); return; }
            pickMany(U.t('Sync with AIOManager: tick what to do'), items, { button: function (n) { return U.t('Apply {n}', { n: n }); } }, function (keys) {
                var added = 0, removed = 0, addedUrls = [];
                keys.forEach(function (k) {
                    if (k.indexOf('add:') === 0) { var got = Stremio.addAddon(add[+k.slice(4)].url); if (got) { added++; addedUrls.push(got); Stremio.setAddonOrigin(got, 'aiomanager'); } }
                    else if (k.indexOf('rm:') === 0) { Stremio.removeAddon(gone[+k.slice(3)]); removed++; }
                });
                var refreshing = keys.indexOf('refresh') !== -1 ? shared.filter(function (u) { return Stremio.getAddonUrls().indexOf(u) !== -1; }) : [];
                U.settleAll(refreshing.map(function (u) { return function () { return Stremio.refreshAddon(u); }; }), 2).then(function (rs) {
                    var refreshed = (rs || []).filter(function (x) { return x && x.ok; }).length, parts = [];
                    if (added) { parts.push(U.t('{n} added', { n: added })); }
                    if (removed) { parts.push(U.t('{n} removed', { n: removed })); }
                    if (refreshing.length) { parts.push(U.t('{n} refreshed', { n: refreshed }) + (refreshed < refreshing.length ? ' ' + U.t('({n} didn’t answer)', { n: refreshing.length - refreshed }) : '')); }
                    U.toast(U.t('Synced: {what}', { what: parts.join(', ') || U.t('nothing changed') }), 4000);
                    done(added + removed + refreshed, addedUrls);
                });
            });
        }, function (e) {
            var why = (e && e.message) || '';
            if (/HTTP 401\b/.test(why) || (e && e.status === 401)) {
                aiomSave({ key: '' });
                U.toast(U.t('AIOManager refused the API key: enter it again'), 4500);
                aiomAskKey(aiomSync);
                return;
            }
            U.toast(U.t('Couldn’t read your AIOManager addons ({why})', { why: U.problem ? U.problem(e) : why }), 5000);
        });
    }

    // The last configuration-file URL, kept so it can be imported again with one Confirm.
    var IMPORT_URL_KEY = 'stremiok.importurl';

    var _importGen = 0;   // (the configuration file being imported, the latest)
    // A configuration file's text: what it has listed, none ticked, to tick and import. here():
    // the entry screen still showing (back to Settings from it). Imported settings: StremioK
    // starts again with them.
    function importText(text, here) {
        var parsed = Stremio.parseSetupList(text);
        if (!parsed.items.length) { U.toast(U.t('No supported entries found in that file') + (parsed.ignored ? ' ' + U.t('({n} ignored)', { n: parsed.ignored }) : ''), 4500); return; }
        if (here()) { App.back(); renderSettings(); }
        pickMany(U.t('In that file: tick what to import'), parsed.items.map(function (it, i) { return { key: '' + i, label: it.label, have: it.have, note: it.note }; }),
            { button: function (n) { return U.t('Import {n}', { n: n }); } }, function (keys) {
                var imported = Stremio.applySetupEntries(keys.map(function (k) { return parsed.items[+k]; })), parts = [];
                if (imported.addons) { parts.push(U.tn(imported.addons, '{n} addon', '{n} addons')); }
                if (imported.playlists) { parts.push(U.tn(imported.playlists, '{n} playlist', '{n} playlists')); }
                if (imported.omdb) { parts.push(U.t('OMDb key')); }
                if (imported.tmdb) { parts.push(U.t('TMDB key')); }
                if (imported.mdblist) { parts.push(U.t('MDBList key')); }
                if (imported.settings) { parts.push(U.t('your settings')); }
                if (imported.addons || imported.playlists) { clearCatalogCache(); }
                var message = parts.length ? U.t('Imported: {what}', { what: parts.join(', ') }) : U.t('Nothing imported');
                if (parsed.ignored) { message += ' ' + U.t('({n} ignored)', { n: parsed.ignored }); }
                if (imported.settings) {   // (every part of StremioK reads them afresh)
                    U.toast(message + '. StremioK starts again with them…', 4000);
                    setTimeout(function () { try { window.location.reload(); } catch (e) {} }, 2500);
                    return;
                }
                U.toast(message, 4500);
                renderSettings();
            });
    }
    // Settings › Content › Export configuration: what goes in, all ticked at first, given to your
    // phone (V.phoneGive) as the file Import configuration file reads (Stremio.exportSetup).
    function settingsExport(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Export configuration')));
        var row = U.el('div', 'addon-item focusable add-row');
        row.appendChild(U.el('div', 'a-name', U.t('⇧  Export to your phone')));
        row.appendChild(U.el('div', 'a-url', U.t('Your addons, IPTV playlists, API keys and settings, as a file to import later')));
        row.__onselect = function () {
            var groups = Stremio.exportGroups();
            pickMany(U.t('Tick what to export'), groups.map(function (g) { return { key: g.key, label: g.label }; }),
                { on: groups.map(function (g) { return g.key; }), button: function (n) { return U.t('Export {n}', { n: n }); } }, function (keys) {
                    V.phoneGive(U.t('Export configuration'), Stremio.exportSetup(keys, appVersion()),
                        U.t('It holds your addon links, playlist logins, API keys and MAC addresses: keep the file private. Not in it: your Trakt sign-in, history and progress.'));
                });
        };
        wrap.appendChild(row);
        wrap.appendChild(U.el('div', 'hint', U.t('To restore it (after a reinstall, or on another TV): Import configuration file › ▣ From your phone, then choose the file there (or paste it).')));
        focusSettings();
    }
    function settingsImport(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Import configuration file')));
        var lastUrl = U.store.get(IMPORT_URL_KEY, '') || '';
        var listRow = U.el('div', 'addon-item focusable add-row');
        var ln = U.el('div', 'a-name', U.t('+  Import configuration file'));
        ln.appendChild(originBadge('config'));
        listRow.appendChild(ln);
        listRow.appendChild(U.el('div', 'a-url', lastUrl ? U.t('Last used: {link}  ·  OK to import again', { link: lastUrl })
            : U.t('Addon URLs, API keys and IPTV playlist URLs')));
        listRow.__onselect = function () {
            App.openEntry({
                title: U.t('Import configuration file'), phone: 'config',
                hint: U.t('Enter a text-file URL containing one addon URL, API key or M3U/M3U8 playlist URL per line. Lines starting with # are ignored. The URL is remembered for next time.'),
                value: lastUrl || 'https://', placeholder: 'https://example.com/stremiok.txt',
                validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                onConfirm: function (v) {
                    // Saved even if the fetch fails, so a typo can be fixed instead of retyped.
                    U.store.set(IMPORT_URL_KEY, v);
                    lastUrl = v;
                    U.toast(U.t('Fetching configuration file…'), 5000);
                    // (what you confirmed is imported even if you've moved on; only the screen
                    // you're on stays: back to Settings only from this entry, still showing)
                    var entry = scr('addaddon'), mine = ++_importGen;
                    function here() { return mine === _importGen && !/\bhidden\b/.test(entry.className); }
                    U.getText(v, 15000, 256 * 1024).then(function (text) {   // (a list of URLs and keys: 256 KB is plenty)
                        importText(text, here);
                    }, function (err) {
                        if (!here()) { return; }
                        var why = U.problem(err);
                        U.toast(/^Too large/.test((err && err.message) || '') ? U.t('That file is {why}: a configuration file is a short list of URLs and keys.', { why: why })
                            : U.t('Could not fetch that configuration file ({why}; check the URL / CORS).', { why: why }), 5000);
                    });
                },
                // From your phone, the file itself pasted (not a link): imported as it is
                phoneText: { accepts: function (t) { return /\n/.test(t) || !/^https?:\/\//i.test(('' + t).trim()); },
                    take: function (t) { ++_importGen; importText(t, function () { return true; }); } }
            });
        };
        wrap.appendChild(listRow);
        wrap.appendChild(U.el('div', 'hint',
            U.t('Accepted lines: addon URLs, M3U/M3U8 URLs, and OMDb, TMDB or MDBList API keys.')));
        focusSettings();
    }

    // Settings › IPTV: each playlist with ▲ / ▼ (order: a channel in two comes from the
    // first; rows follow it), its name, link, channels, when it was last downloaded and
    // what went wrong; OK for its actions (Rename, Turn off / on, Edit link, Reload, Remove).
    var _iptvFocus = null;   // { id, ctl } to focus once the page is drawn again
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function thousands(n) { return ('' + n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    // The playlist rows IPTV Settings drew last: their guide lines kept current by one listener
    // (one added each time it was drawn used to pile up, each holding its rows).
    var _guideRows = [];
    if (typeof EPG !== 'undefined' && EPG.onChange) {
        EPG.onChange(function () {
            _guideRows = _guideRows.filter(function (r) { return document.documentElement.contains(r.info); });
            _guideRows.forEach(function (r) { r.info.textContent = playlistInfo(r.p); });
        });
    }
    function playlistInfo(p) {
        if (p.off) { return U.t('Off — its channels aren’t shown'); }
        var st = Stremio.iptvStatus(p.id), parts = [];
        if (!st.url) { return U.t('Not read yet'); }
        parts.push(U.tn(st.count || 0, '{n} channel', '{n} channels', { n: thousands(st.count || 0) }) + (st.groups ? ' ' + U.tn(st.groups, 'in {n} group', 'in {n} groups') : ''));
        if (st.fetchedAt) { var d = new Date(st.fetchedAt); parts.push(U.t('downloaded {when}', { when: U.dayLabel(st.fetchedAt) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) })); }
        if (st.dropped) { parts.push(U.t('{n} more left out (a playlist keeps its first 30,000)', { n: thousands(st.dropped) })); }
        if (p.genres) { parts.push(U.tn(p.genres.length, '{n} group chosen', '{n} groups chosen')); }
        if (st.cut) { parts.push(st.cut > 0 ? U.t('stopped short of {n}: OK on it, then Channel groups, reads only what you want', { n: thousands(st.cut) }) : U.t('stopped short: OK on it, then Channel groups, reads only what you want')); }
        if (st.uncached) { parts.push(U.t('too large to save on the TV: downloaded each launch')); }
        var g = guideInfo(p);
        if (g) { parts.push(g); }
        return parts.join('   ·   ');
    }
    // Its TV guide (js/epg.js): being read, read (for how many of its channels), or why not.
    function guideInfo(p) {
        var g = typeof EPG !== 'undefined' && EPG.status ? EPG.status(p.id) : null;
        if (!g) { return typeof EPG !== 'undefined' && EPG.available && EPG.available() ? U.t('no TV guide') : ''; }
        if (g.state === 'ready') {
            var d = new Date(g.at);
            return U.t('TV guide: {channels}, {programs} programs', { channels: U.tn(g.channels, '{n} channel', '{n} channels', { n: thousands(g.channels) }), programs: thousands(g.programmes) }) + (g.partial ? ' ' + U.t('(part of it: too large)') : '') +
                (g.at ? ', ' + U.t('read {when}', { when: U.dayLabel(g.at) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) }) : '') + (g.error ? ' ' + U.t('(the last read failed: {why})', { why: g.error }) : '');
        }
        if (g.state === 'failed') { return '⚠ ' + U.t('TV guide: {why}', { why: g.error || U.t('couldn’t be read') }); }
        return U.t('TV guide: reading…');
    }
    function playlistProblem(p) {
        var st = Stremio.iptvStatus(p.id);
        if (p.off || !st.error) { return ''; }
        return '⚠ ' + (st.stale ? U.t('Couldn’t refresh it (showing the saved copy):') + ' ' : '') + st.error;
    }
    // + Add Xtream account: its server, username and password, a page each (a whole Xtream link
    // in the server's fills the rest); checked with the server, then added (Stremio.iptvAddXtream).
    function addXtream() {
        function done(base, user, pass) {
            U.toast(U.t('Checking the account…'), 15000);
            IPTV.xtreamCheck(base, user, pass).then(function (r) {
                if (r.unreachable) { U.toast(U.t('Couldn’t reach the server: check its address (nothing was saved)'), 5000); return; }
                if (r.refused) { U.toast(U.t('The server refused that username and password{code}: nothing was saved', { code: r.status ? ' (' + r.status + ')' : '' }), 5000); return; }
                Stremio.iptvAddXtream(base, user, pass);
                refreshAddonRows('local:iptv');
                U.toast(U.t('Xtream account added: reading its channels and TV guide…'), 4000);
                renderSettings();
            });
        }
        App.openEntry({
            title: U.t('Xtream account: server'), phone: 'playlist',
            hint: U.t('The server address your provider gave you (http://line.example.com:8080), or a whole Xtream link. RETURN cancels.'),
            value: 'http://', placeholder: 'http://line.example.com:8080',
            validate: function (v) { return IPTV.xtreamParts(v) ? null : U.t('That isn’t a server address'); },
            onConfirm: function (v) {
                var x = IPTV.xtreamParts(v);
                App.back();
                if (x.user && x.pass) { done(x.base, x.user, x.pass); return; }
                App.openEntry({
                    title: U.t('Xtream account: username'), hint: U.t('Your account’s username. RETURN cancels.'), value: x.user, placeholder: 'username',
                    validate: function (u) { return ('' + u).trim() ? null : U.t('Type the username'); },
                    onConfirm: function (u) {
                        App.back();
                        App.openEntry({
                            title: U.t('Xtream account: password'), hint: U.t('Your account’s password (kept on the TV, in the playlist’s link). RETURN cancels.'), value: '', placeholder: U.t('password'), secret: true,
                            validate: function (p) { return ('' + p) ? null : U.t('Type the password'); },
                            onConfirm: function (p) { App.back(); done(x.base, ('' + u).trim(), '' + p); }
                        });
                    }
                });
            }
        });
    }
    // + Add Stalker portal: its address, then its MAC address; checked (its channels read through
    // the service), then added (Stremio.iptvAddStalker).
    function addStalker() {
        function done(portal, mac) {
            U.toast(U.t('Checking the portal…'), 60000);
            IPTV.stalkerCheck(portal, mac).then(function (r) {
                if (r.noService) { U.toast(U.t('Stalker portals are read by StremioK’s service, which a desktop browser doesn’t have (nothing was saved)'), 5000); return; }
                if (r.unreachable) { U.toast(U.t('Couldn’t read the portal{why}: nothing was saved', { why: r.why ? ' (' + r.why + ')' : '' }), 6000); return; }
                if (r.refused) { U.toast(U.t('The portal refused that MAC address{why}: nothing was saved', { why: r.why ? ' (' + r.why + ')' : '' }), 6000); return; }
                Stremio.iptvAddStalker(portal, mac);
                refreshAddonRows('local:iptv');
                U.toast(!r.cut ? U.t('Stalker portal added: {n} channels', { n: r.count }) : r.cut.total ? U.t('Stalker portal added: {n} channels of {total}: see Stalker channels', { n: r.count, total: r.cut.total }) : U.t('Stalker portal added: {n} channels so far: see Stalker channels', { n: r.count }), r.cut ? 6000 : 4000);
                renderSettings();
            });
        }
        App.openEntry({
            title: U.t('Stalker portal: address'), phone: 'playlist',
            hint: U.t('The portal address your provider gave you (http://portal.example.com/c/). RETURN cancels.'),
            value: 'http://', placeholder: 'http://portal.example.com/c/',
            validate: function (v) { return IPTV.stalkerPortal(v) ? null : U.t('That isn’t a portal address'); },
            onConfirm: function (v) {
                var portal = IPTV.stalkerPortal(v);
                App.back();
                App.openEntry({
                    title: U.t('Stalker portal: MAC address'), phone: 'mac',
                    hint: U.t('The MAC address your provider registered for you (00:1A:79:…), kept on the TV. RETURN cancels.'), value: '00:1A:79:', placeholder: U.t('00:1A:79:00:00:00'),
                    validate: function (m) { return IPTV.macOf(m) ? null : U.t('A MAC address is six pairs, like 00:1A:79:12:34:56'); },
                    onConfirm: function (m) { App.back(); done(portal, IPTV.macOf(m)); }
                });
            }
        });
    }
    // Streaming server: Stremio's or TorrServer, on your network (see Stremio.server). Picking one
    // asks for its address; Test says whether it answers.
    var SERVERS = [['', U.t('Off')], ['stremio', U.t('Stremio server')], ['torrserver', U.t('TorrServer')]];
    var SERVER_PORT = { stremio: 11470, torrserver: 8090 };
    var TORRENT_WAITS = [['45', U.t('45 seconds')], ['60', U.t('1 minute')], ['120', U.t('2 minutes')], ['180', U.t('3 minutes')], ['300', U.t('5 minutes')]];
    function askServerAddress(kind, url) {
        var eg = 'http://192.168.0.10:' + SERVER_PORT[kind];
        App.openEntry({
            title: U.t('{server}: address', { server: kind === 'stremio' ? U.t('Stremio server') : 'TorrServer' }),
            hint: U.t('Its address on your network, like {example}. RETURN cancels.', { example: eg }),
            value: url || 'http://', placeholder: eg, phone: 'server',
            validate: function (v) { return Stremio.serverAddressProblem(v); },
            onConfirm: function (v) { Stremio.setServer({ kind: kind, url: v }); App.back(); renderSettings(); }
        });
    }
    function settingsServer(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Streaming server')));
        wrap.appendChild(U.el('div', 'hint', 'Torrent-only sources play through it; Stremio’s can also convert a video the TV can’t play.'));
        var sv = Stremio.server();
        wrap.appendChild(subPickRow(U.t('Server'), SERVERS, 'kind', {
            get: function () { return { kind: Stremio.server().kind }; },
            set: function (cfg) {
                var cur = Stremio.server();
                if (!cfg.kind) { Stremio.setServer({ kind: '' }); renderSettings(); return; }
                askServerAddress(cfg.kind, cur.kind === cfg.kind ? cur.url : '');
            }
        }));
        if (!sv.kind) { return; }
        var addr = U.el('div', 'addon-item focusable cfg-row');
        addr.appendChild(U.el('div', 'a-name', U.t('Address:') + '  ' + sv.url));
        addr.appendChild(U.el('div', 'a-url', U.t('Press OK to change')));
        addr.__onselect = function () { askServerAddress(sv.kind, sv.url); };
        wrap.appendChild(addr);
        var test = U.el('div', 'addon-item focusable cfg-row'), said = U.el('div', 'a-url', U.t('Press OK to see whether it answers'));
        test.appendChild(U.el('div', 'a-name', U.t('Test')));
        test.appendChild(said);
        test.__onselect = function () {
            said.textContent = U.t('Asking…');
            Stremio.testServer().then(function (r) { said.textContent = (r.ok ? '✓ ' : '✗ ') + r.text; });
        };
        wrap.appendChild(test);
        wrap.appendChild(subPickRow(U.t('Wait for a torrent to start'), TORRENT_WAITS, 'wait', {
            get: function () { return { wait: '' + Stremio.server().wait }; },
            set: function (cfg) { Stremio.setServer({ kind: Stremio.server().kind, wait: +cfg.wait }); }
        }));
        if (sv.kind === 'stremio') {
            wrap.appendChild(subPickRow(U.t('Convert videos the TV can’t play'), [['on', U.t('On')], ['off', U.t('Off')]], 'convert', {
                get: function () { return { convert: Stremio.server().convert ? 'on' : 'off' }; },
                set: function (cfg) { Stremio.setServer({ kind: 'stremio', convert: cfg.convert === 'on' }); }
            }));
        }
    }

    var IPTV_EVERY = [['0', U.t('Off')], ['1', U.t('Every hour')], ['3', U.t('Every 3 hours')], ['6', U.t('Every 6 hours')], ['12', U.t('Every 12 hours')]];
    function settingsIptv(wrap) {
        wrap.appendChild(U.el('h2', null, 'IPTV'));
        var playlists = Stremio.iptvGetPlaylists ? Stremio.iptvGetPlaylists() : [];
        var rows = [];

        // Combined load status — turns silent per-playlist fetch failures into a visible message.
        var statusEl = null;
        if (playlists.some(function (p) { return !p.off; }) && Stremio.iptvLoad) {
            statusEl = U.el('div', 'hint', U.t('Checking playlists…'));
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
            item.appendChild(U.el('div', 'a-name', label + (playlist.off ? '   ' + U.t('(off)') : '')));
            item.appendChild(U.el('div', 'a-url', U.redactUrl(playlist.url) + (playlist.mac ? '  ·  MAC ' + playlist.mac.slice(0, 8) + ':••:••:••' : '')));   // (credentials masked; a Stalker portal's MAC too)
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

        _guideRows = rows;   // (their guide lines kept current as guides are read: _guideRows)
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
                statusEl.textContent = (failed ? '⚠ ' : '✓ ') + U.t('Loaded {channels} channels from {playlists} playlist(s) in {groups} group(s).', { channels: thousands(channels), playlists: on, groups: groups }) + (failed ? (' ' + U.t('{n} playlist(s) reported an error.', { n: failed })) : '') +
                    (on < playlists.length ? ' ' + U.t('{n} switched off.', { n: playlists.length - on }) : '');
            });
        }

        var add = U.el('div', 'addon-item focusable add-row');
        add.appendChild(U.el('div', 'a-name', U.t('+  Add playlist')));
        add.appendChild(U.el('div', 'a-url', U.t('Enter another M3U/M3U8 playlist URL')));
        add.__onselect = function () {
            App.openEntry({
                title: U.t('Add IPTV playlist'), phone: 'playlist',
                hint: U.t('Type an M3U/M3U8 playlist URL. Nothing is saved until you Confirm.'),
                value: 'https://', placeholder: 'https://example.com/playlist.m3u',
                validate: function (v) { return U.urlProblem(v) || null; },   // (U.parseUrl: http(s), a real host, no user:password@)
                onConfirm: function (v) {
                    Stremio.iptvAddPlaylist(v);
                    refreshAddonRows('local:iptv');
                    U.toast(U.t('Playlist added'));
                    App.back(); renderSettings();
                }
            });
        };
        wrap.appendChild(add);
        var xt = U.el('div', 'addon-item focusable add-row');
        xt.appendChild(U.el('div', 'a-name', U.t('+  Add Xtream account')));
        xt.appendChild(U.el('div', 'a-url', U.t('Its server, username and password: its channels and TV guide added')));
        xt.__onselect = addXtream;
        wrap.appendChild(xt);
        var sk = U.el('div', 'addon-item focusable add-row');
        sk.appendChild(U.el('div', 'a-name', U.t('+  Add Stalker portal')));
        sk.appendChild(U.el('div', 'a-url', U.t('Its address and MAC address: its channels added')));
        sk.__onselect = addStalker;
        wrap.appendChild(sk);
        if (playlists.length && Stremio.iptvRefreshEvery) {   // (all of them, with their guides, as Reload does)
            wrap.appendChild(subPickRow(U.t('Auto-refresh'), IPTV_EVERY, 'every',
                { get: function () { return { every: String(Stremio.iptvRefreshEvery()) }; }, set: function (c) { Stremio.iptvSetRefreshEvery(+c.every); } }));
        }
        wrap.appendChild(subPickRow(U.t('Stalker channels'), [['pages', U.t('First 100 pages (about 1,400 channels)')], ['all', U.t('Whole portal (up to 30,000 channels)')]], 'stalker', {
            warning: U.t('Whole portal can take many minutes on every Reload and Auto-refresh, the IPTV rows wait for a first read, and a portal may slow down, cut off or block a MAC address that asks so much'),
            get: function () { return { stalker: IPTV.stalkerAll() ? 'all' : 'pages' }; },
            set: function (c) {
                var on = c.stalker === 'all', was = IPTV.stalkerAll();
                IPTV.setStalkerAll(on);
                if (!on || was) { return; }
                var mine = playlists.filter(IPTV.isStalker);   // (read again now: leave StremioK open meanwhile)
                if (!mine.length) { return; }
                U.toast(U.t('Reading the whole portal: this can take many minutes, leave StremioK open'), 6000);
                mine.forEach(function (p) { Stremio.iptvReload(p.id).then(function () { refreshAddonRows('local:iptv'); }); });
            }
        }));

        if (typeof StVod !== 'undefined' && StVod.keepMinutes) {   // (what the service keeps of a portal's films and series)
            wrap.appendChild(subPickRow(U.t('Stalker films and series'), [['10', U.t('Kept 10 minutes')], ['5', U.t('Kept 5 minutes')], ['0', U.t('Off (asked each time)')]], 'keep', {
                get: function () { return { keep: String(StVod.keepMinutes()) }; },
                set: function (c) { StVod.setKeepMinutes(+c.keep); }
            }));
        }

        wrap.appendChild(U.el('div', 'hint',
            U.t('Channels are grouped into IPTV and Radio rows on Home. ▲ / ▼ set the playlists\' order: a channel in two playlists comes from the first.')));
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
        var kind = YouTube.sourceKind(x.src), what = { channel: U.t('Channel'), playlist: U.t('Playlist'), search: U.t('Search') }[kind];
        var bits = [what + ':  ' + x.src.replace(/^search:/i, '')];
        if (x.kind !== 'auto') { bits.push(YouTube.KIND_NAMES[x.kind]); }
        if (kind === 'search' && x.sort !== 'relevance') { bits.push(U.t('by {order}', { order: YouTube.SORT_NAMES[x.sort].toLowerCase() })); }
        if (x.type !== 'YouTube') { bits.push(U.t('type “{type}”', { type: x.type })); }
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
    var YT_SOURCE_HINT = U.t('A channel (like @ScreenJunkies, or its link), a playlist link, or words to search YouTube for (like “honest trailers”).');
    // YouTubio's catalogs as yours (its own feeds need its sign-in: left out), then its
    // addon can go.
    function copyFrom(y) {
        var info = YouTube.fromYouTubio(y.url);
        confirm(U.tn(info.list.length, 'Copy {n} catalog from YouTubio ({host}) to your YouTube?', 'Copy {n} catalogs from YouTubio ({host}) to your YouTube?', { host: y.host }) +
            (info.left ? '  ' + U.t('{n} of its own (subscriptions, its search…) need its sign-in or are YouTube in Search already: left out.', { n: info.left }) : ''), U.t('Copy'), function () {
            var r = YouTube.copyYouTubio(y.url);
            ytChanged(OPT('copy'));
            U.toast(U.tn(r.added, '{n} catalog copied', '{n} catalogs copied') + (r.already ? ', ' + U.t('{n} you had already', { n: r.already }) : ''), 3500);
            setTimeout(function () {
                confirm(U.t('Remove the YouTubio addon? Its catalogs are in your YouTube now.'), U.t('Remove'), function () {
                    Stremio.removeAddon(y.url);
                    refreshAddonRows();
                    ytChanged(null);
                    U.toast(U.t('YouTubio removed'));
                });
            }, 400);
        });
    }
    function OPT(name) { return { id: 'opt', ctl: name }; }   // (a settings row, to come back to)
    function optRow(node, name) { node.setAttribute('data-pl', 'opt'); node.setAttribute('data-ctl', name); return node; }
    function sbModeShort(cat, mode) { return mode === 'show' && (cat === 'poi_highlight' || cat === 'exclusive_access') ? U.t('On') : YouTube.SB_MODE_NAMES[mode].split(' (')[0]; }
    // SponsorBlock sections: each, and what's done with it.
    function sbSections(focusCat) {
        var modes = YouTube.sbModes();
        pickList(U.t('SponsorBlock sections'), YouTube.SB_CATS.map(function (k) { return [k, YouTube.SB_NAMES[k] + '  ·  ' + sbModeShort(k, modes[k])]; }), focusCat || null, function (cat) {
            var names = cat === 'poi_highlight' ? { show: U.t('On: “◆ Highlight” on the UP bar goes to it'), off: U.t('Off') }
                : cat === 'exclusive_access' ? { show: U.t('On: a note when the video starts'), off: U.t('Off') } : YouTube.SB_MODE_NAMES;
            pickList(YouTube.SB_NAMES[cat], YouTube.sbModesFor(cat).map(function (m) { return [m, names[m]]; }), modes[cat], function (m) {
                YouTube.setSbMode(cat, m);
                ytChanged(OPT('sbcats'));
                sbSections(cat);
            });
        });
    }
    function ytActions(x) {
        var opts = [['rename', U.t('Rename') + '  ·  ' + x.name], ['src', U.t('Source') + '  ·  ' + x.src.replace(/^search:/i, '')],
            ['kind', U.t('Search type') + '  ·  ' + YouTube.KIND_NAMES[x.kind]], ['sort', U.t('Sort order') + '  ·  ' + YouTube.SORT_NAMES[x.sort]],
            ['type', U.t('Type') + '  ·  ' + x.type], ['off', x.off ? U.t('Turn on') : U.t('Turn off')], ['remove', U.t('Remove')]];
        pickList(x.name, opts, null, function (a) {
            var focus = { id: x.id, ctl: 'item' };
            if (a === 'rename') {
                ytEntry(U.t('Rename YouTube catalog'), U.t('Its name on Home and in Discover.'), x.name, x.name,
                    function (v) { return ('' + v).trim() ? null : U.t('Type a name'); }, function (v) { YouTube.update(x.id, { name: v }); ytChanged(focus); });
            } else if (a === 'src') {
                ytEntry(U.t('YouTube catalog source'), YT_SOURCE_HINT, x.src.replace(/^search:/i, ''), U.t('@channel, a playlist link, or words'),
                    function (v) { return ('' + v).trim() ? null : U.t('Type a channel, a playlist or words'); }, function (v) { YouTube.update(x.id, { src: v }); ytChanged(focus); });
            } else if (a === 'kind') {
                pickList(U.t('Search type'), YouTube.KINDS.map(function (k) { return [k, YouTube.KIND_NAMES[k]]; }), x.kind, function (k) { YouTube.update(x.id, { kind: k }); ytChanged(focus); });
            } else if (a === 'sort') {
                pickList(U.t('Sort order (searches)'), YouTube.SORTS.map(function (k) { return [k, YouTube.SORT_NAMES[k]]; }), x.sort, function (k) { YouTube.update(x.id, { sort: k }); ytChanged(focus); });
            } else if (a === 'type') {
                ytEntry(U.t('YouTube catalog type'), U.t('Where it\'s listed: its Home tab and Discover type, like “Podcasts”. Leave it empty for “YouTube”.'), x.type, 'YouTube',
                    null, function (v) { YouTube.update(x.id, { type: v || 'YouTube' }); ytChanged(focus); });
            } else if (a === 'off') {
                YouTube.update(x.id, { off: !x.off }); ytChanged(focus);
            } else if (a === 'remove') {
                confirm(U.t('Remove the YouTube catalog “{name}”?', { name: x.name }), U.t('Remove'), function () { YouTube.remove(x.id); ytChanged(null); });
            }
        });
    }
    function settingsYouTube(wrap) {
        wrap.appendChild(U.el('h2', null, 'YouTube'));
        if (typeof YouTube === 'undefined') { wrap.appendChild(U.el('div', 'hint', U.t('Not available here.'))); focusSettings(); return; }
        var on = YouTube.searchOn();
        var srch = U.el('div', 'addon-item focusable cfg-row');
        srch.appendChild(U.el('div', 'a-name', U.t('YouTube in Search:') + '  ' + (on ? U.t('On') : U.t('Off'))));
        srch.appendChild(U.el('div', 'a-url', (on ? U.t('Search shows YouTube videos and channels (as rows: YouTube · Videos, YouTube · Channels)') : U.t('Search leaves YouTube out')) + '   ·   ' + (on ? U.t('OK to turn off') : U.t('OK to turn on'))));
        srch.__onselect = function () { YouTube.setSearch(!on); ytChanged(OPT('search')); };
        wrap.appendChild(optRow(srch, 'search'));
        var orig = YouTube.originalTitles(), tRow = U.el('div', 'addon-item focusable cfg-row');
        tRow.appendChild(U.el('div', 'a-name', U.t('Video titles:') + '  ' + (orig ? U.t('Original') : U.t('English'))));
        tRow.appendChild(U.el('div', 'a-url', (orig ? U.t('In the language they were uploaded in') : U.t('In English where YouTube has a translation (the uploader\'s, or its own)')) + '   ·   ' + (orig ? U.t('OK for English') : U.t('OK for the original'))));
        tRow.__onselect = function () { YouTube.setOriginalTitles(!orig); ytChanged(OPT('titles')); };
        wrap.appendChild(optRow(tRow, 'titles'));

        // SponsorBlock (sections viewers marked) and DeArrow (titles / thumbnails they wrote)
        var sb = YouTube.sbOn(), modes = YouTube.sbModes();
        var sbRow = U.el('div', 'addon-item focusable cfg-row');
        sbRow.appendChild(U.el('div', 'a-name', 'SponsorBlock:  ' + (sb ? U.t('On') : U.t('Off'))));
        sbRow.appendChild(U.el('div', 'a-url', (sb ? U.t('Sponsors, self-promotion and other sections other viewers marked in a video: skipped, offered or shown on the bar, as set below') : U.t('Videos play as they are')) + '   ·   ' + (sb ? U.t('OK to turn off') : U.t('OK to turn on'))));
        sbRow.__onselect = function () { YouTube.setSbOn(!sb); ytChanged(OPT('sb')); };
        wrap.appendChild(optRow(sbRow, 'sb'));
        if (sb) {
            var cats = U.el('div', 'addon-item focusable cfg-row');
            cats.appendChild(U.el('div', 'a-name', U.t('SponsorBlock sections')));
            cats.appendChild(U.el('div', 'a-url', YouTube.SB_CATS.filter(function (k) { return modes[k] !== 'off'; }).map(function (k) { return YouTube.SB_NAMES[k] + ': ' + sbModeShort(k, modes[k]); }).join('   ·   ') || U.t('All off')));
            cats.__onselect = function () { sbSections(); };
            wrap.appendChild(optRow(cats, 'sbcats'));
        }
        var da = YouTube.dearrow();
        [['titles', U.t('DeArrow titles'), U.t('Titles other viewers rewrote to say what a video is (the original on its page)'), U.t('YouTube\'s titles')],
         ['thumbs', U.t('DeArrow thumbnails'), U.t('A still from the video in place of a clickbait thumbnail, where viewers chose one'), U.t('YouTube\'s thumbnails')]].forEach(function (d) {
            var onD = da[d[0]], r = U.el('div', 'addon-item focusable cfg-row');
            r.appendChild(U.el('div', 'a-name', d[1] + ':  ' + (onD ? U.t('On') : U.t('Off'))));
            r.appendChild(U.el('div', 'a-url', (onD ? d[2] : d[3]) + '   ·   ' + (onD ? U.t('OK to turn off') : U.t('OK to turn on'))));
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
            item.appendChild(U.el('div', 'a-name', x.name + (x.off ? '   ' + U.t('(off)') : '')));
            item.appendChild(U.el('div', 'a-url', ytDescribe(x)));
            item.__onselect = function () { ytActions(x); };
            btns.forEach(function (b) { frow.appendChild(b); }); frow.appendChild(item);
            wrap.appendChild(frow);
        });

        var add = U.el('div', 'addon-item focusable add-row');
        add.appendChild(U.el('div', 'a-name', U.t('+  Add catalog')));
        add.appendChild(U.el('div', 'a-url', U.t('A channel, a playlist or a search (or hold OK on a channel / playlist wherever it\'s shown)')));
        add.__onselect = function () {
            ytEntry(U.t('Add YouTube catalog'), YT_SOURCE_HINT, '', U.t('@channel, a playlist link, or words'), function (v) { return ('' + v).trim() ? null : U.t('Type a channel, a playlist or words'); }, function (src) {
                var id = YouTube.add({ src: src });
                if (!id) { U.toast(U.t('Couldn\'t add it (40 catalogs at most)')); return; }
                U.toast(U.t('Added: OK on it to rename it or change what it lists'), 3500);
                ytChanged({ id: id, ctl: 'item' });
            });
        };
        wrap.appendChild(add);
        var ytb = YouTube.youTubioAddons();
        if (ytb.length) {   // (a YouTubio addon installed: its catalogs can come over)
            var copy = optRow(U.el('div', 'addon-item focusable add-row'), 'copy');
            copy.appendChild(U.el('div', 'a-name', U.t('+  Copy from YouTubio')));
            copy.appendChild(U.el('div', 'a-url', ytb.map(function (y) { return y.host + ': ' + U.tn(y.count, '{n} catalog', '{n} catalogs'); }).join('   ·   ')));
            copy.__onselect = function () {
                if (ytb.length === 1) { copyFrom(ytb[0]); return; }
                pickList(U.t('Copy from which YouTubio?'), ytb.map(function (y, i) { return ['' + i, y.host + '  ·  ' + U.tn(y.count, '{n} catalog', '{n} catalogs') + '  ·  ' + U.t('addon {n}', { n: i + 1 })]; }), null, function (i) { copyFrom(ytb[+i]); });
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
        r.appendChild(U.el('div', 'a-url', val ? U.t('Set — {key}', { key: maskKey(val) }) : U.t('Not set — press OK to enter')));
        r.__onselect = function () {
            App.openEntry({
                title: title,
                hint: U.t('Paste your key, then Confirm. Use Validate to test it. Leave blank and Confirm to clear.'),
                value: val, placeholder: placeholder, validator: validator,
                onConfirm: function (v) { Stremio.setIntegration(key, v); U.toast(v ? U.t('Saved') : U.t('Cleared')); App.back(); renderSettings(); }
            });
        };
        return r;
    }

    function settingsIntegrations(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Integrations')));
        if (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew') { wrap.appendChild(U.el('div', 'hint', TIZENBREW_NOTE)); }
        wrap.appendChild(keyRow(U.t('OMDb API key'), 'omdb', U.t('OMDb API key'), Stremio.omdbValidate));
        wrap.appendChild(keyRow(U.t('TMDB API key (v3)'), 'tmdb', U.t('TMDB v3 API key'), Stremio.tmdbValidate));
        wrap.appendChild(keyRow(U.t('MDBList API key'), 'mdblist', U.t('MDBList API key'), Stremio.mdblistValidate));
        if (Stremio.autoWatchRegion) { wrap.appendChild(regionRow()); }

        // Trakt: your account (StremioK is the Trakt app: nothing to set up)
        if (typeof Trakt !== 'undefined') {
            wrap.appendChild(U.el('h2', null, 'Trakt'));
            wrap.appendChild(traktAccountRow());
            if (Trakt.connectStatus().connected) { wrap.appendChild(traktSyncRow()); }
            wrap.appendChild(U.el('div', 'hint', U.t('Connect your Trakt account (a free one will do): the TV shows a code to enter on Trakt\'s site. Your watched marks and Continue Watching then sync with Trakt.')));
        }

        // Your Stremio account, kept in step (js/stremio-sync.js)
        if (typeof StremioSync !== 'undefined' && typeof StremioAccount !== 'undefined') {
            wrap.appendChild(U.el('h2', null, U.t('Stremio account')));
            wrap.appendChild(stremioAccountRow());
            wrap.appendChild(U.el('div', 'hint', U.t('Connect your Stremio account (sign in on your phone): its Continue Watching, watched marks and Library then sync with StremioK, both ways.')));
        }

        wrap.appendChild(U.el('div', 'hint',
            U.t('Keys are stored on this TV only. OMDb gives real IMDb per-episode ratings (used first when set); TMDB adds episode images & ratings.')));
        focusSettings();
    }

    // The country TMDB's "where to watch" services are for (a title's sources). Automatic:
    // the TV's language region, which a language-only setting ("en") doesn't have.
    var WATCH_REGIONS = [['AR', U.t('Argentina')], ['AU', U.t('Australia')], ['AT', U.t('Austria')], ['BE', U.t('Belgium')], ['BR', U.t('Brazil')],
        ['BG', U.t('Bulgaria')], ['CA', U.t('Canada')], ['CL', U.t('Chile')], ['CO', U.t('Colombia')], ['CZ', U.t('Czech Republic')], ['DK', U.t('Denmark')],
        ['EC', U.t('Ecuador')], ['EG', U.t('Egypt')], ['EE', U.t('Estonia')], ['FI', U.t('Finland')], ['FR', U.t('France')], ['DE', U.t('Germany')],
        ['GR', U.t('Greece')], ['HK', U.t('Hong Kong')], ['HU', U.t('Hungary')], ['IS', U.t('Iceland')], ['IN', U.t('India')], ['ID', U.t('Indonesia')],
        ['IE', U.t('Ireland')], ['IL', U.t('Israel')], ['IT', U.t('Italy')], ['JP', U.t('Japan')], ['LV', U.t('Latvia')], ['LT', U.t('Lithuania')],
        ['MY', U.t('Malaysia')], ['MX', U.t('Mexico')], ['NL', U.t('Netherlands')], ['NZ', U.t('New Zealand')], ['NO', U.t('Norway')], ['PE', U.t('Peru')],
        ['PH', U.t('Philippines')], ['PL', U.t('Poland')], ['PT', U.t('Portugal')], ['RO', U.t('Romania')], ['SA', U.t('Saudi Arabia')],
        ['SG', U.t('Singapore')], ['SK', U.t('Slovakia')], ['ZA', U.t('South Africa')], ['KR', U.t('South Korea')], ['ES', U.t('Spain')],
        ['SE', U.t('Sweden')], ['CH', U.t('Switzerland')], ['TW', U.t('Taiwan')], ['TH', U.t('Thailand')], ['TR', U.t('Turkey')], ['UA', U.t('Ukraine')],
        ['AE', U.t('United Arab Emirates')], ['GB', U.t('United Kingdom')], ['US', U.t('United States')], ['VE', U.t('Venezuela')]];
    function regionRow() {
        var auto = Stremio.autoWatchRegion();
        var list = [['', U.t('Automatic ({country}, from the TV\'s language)', { country: labelFor(WATCH_REGIONS, auto) || auto })]].concat(WATCH_REGIONS.map(function (c) { return [c[0], c[1] + '  (' + c[0] + ')']; }));
        var row = U.el('div', 'addon-item focusable cfg-row');
        var name = U.el('div', 'a-name');
        function render() { name.textContent = U.t('Where to watch: country:') + '  ' + labelFor(list, Stremio.getPrefs().watchRegion); }
        render();
        row.appendChild(name);
        row.appendChild(U.el('div', 'a-url', U.t('The services TMDB lists on a title\'s page are for this country   ·   OK to choose')));
        row.__onselect = function () {
            pickList(U.t('Where to watch: country'), list, Stremio.getPrefs().watchRegion, function (v) { Stremio.setPref('watchRegion', v); render(); });
        };
        return row;
    }

    function traktAccountRow() {
        var st = Trakt.connectStatus();
        var r = U.el('div', 'addon-item focusable');
        r.appendChild(U.el('div', 'a-name', U.t('Trakt account')));
        r.appendChild(U.el('div', 'a-url',
            st.connected && st.reconnect ? U.t('Trakt needs reconnecting ({user}): its sign-in no longer works — press OK to connect again', { user: st.user || 'Trakt' })
                : st.connected ? U.t('Connected as {user} — press OK to disconnect', { user: st.user || 'Trakt' })
                : U.t('Not connected — press OK to connect')));
        r.__onselect = function () {
            if (st.connected && st.reconnect) { traktConnect(); return; }
            if (st.connected) {
                confirm(U.t('Disconnect Trakt account?'), U.t('Disconnect'), function () {
                    Trakt.disconnect();
                    U.toast(U.t('Trakt disconnected'));
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
        var last = d ? U.t('Last synced {when}', { when: (U.dayLabel ? U.dayLabel(st.lastSync) + ' ' : '') + two(d.getHours()) + ':' + two(d.getMinutes()) }) : U.t('Not synced yet');
        var bits = [last];
        if (st.pending) { bits.push(U.tn(st.pending, '{n} change waiting to reach Trakt', '{n} changes waiting to reach Trakt')); }
        if (st.failed) { bits.push('⚠ ' + U.tn(st.failed, '{n} change not sent', '{n} changes not sent')); }
        r.appendChild(U.el('div', 'a-name', U.t('Trakt sync:') + '  ' + (st.failed ? U.t('some changes not sent') : st.pending ? U.t('changes waiting') : U.t('up to date'))));
        r.appendChild(U.el('div', 'a-url', bits.join('   ·   ') + '   ·   ' + U.t('OK for options')));
        (st.failedItems || []).slice(0, 6).forEach(function (f) {
            r.appendChild(U.el('div', 'a-url', '⚠ ' + f.what.charAt(0).toUpperCase() + f.what.slice(1) + (f.title ? '  ·  ' + f.title : '') + (f.err ? '  ·  ' + f.err : '')));
        });
        if ((st.failedItems || []).length > 6) { r.appendChild(U.el('div', 'a-url', U.t('and {n} more', { n: st.failedItems.length - 6 }))); }
        r.__onselect = function () {
            var opts = [['now', st.failed ? U.t('Sync now (the {n} not sent too)', { n: st.failed }) : U.t('Sync now')]];
            if (st.failed) { opts.push(['discard', U.t('Let them go (not sent to Trakt)')]); }
            pickList(U.t('Trakt sync'), opts, null, function (v) {
                if (v === 'now') { Trakt.sendNow(); Trakt.refreshCaches(); U.toast(U.t('Syncing with Trakt…')); }
                else if (v === 'discard') { Trakt.discardFailed(); U.toast(U.t('Not sent: left out')); }
                setTimeout(renderSettings, 1500);
            });
        };
        return r;
    }

    // Your Stremio account: connected (who, when it last synced, OK for Sync now / Disconnect), or
    // not (OK to connect: Stremio's sign-in code, as the addon import).
    function stremioAccountRow() {
        var st = StremioSync.connectStatus(), r = U.el('div', 'addon-item focusable cfg-row');
        function two(x) { return (x < 10 ? '0' : '') + x; }
        var d = st.lastSync ? new Date(st.lastSync) : null;
        var bits = [];
        if (st.connected) {
            bits.push(d ? U.t('Last synced {when}', { when: (U.dayLabel ? U.dayLabel(st.lastSync) + ' ' : '') + two(d.getHours()) + ':' + two(d.getMinutes()) }) : U.t('Not synced yet'));
            if (st.pending) { bits.push(U.tn(st.pending, '{n} change waiting', '{n} changes waiting')); }
            if (st.err) { bits.push('⚠ ' + st.err); }
        }
        r.appendChild(U.el('div', 'a-name', U.t('Stremio account') + (st.connected && st.user ? ':  ' + st.user : '')));
        r.appendChild(U.el('div', 'a-url', st.connected && st.reconnect ? U.t('Its sign-in no longer works — press OK to connect again')
            : st.connected ? bits.join('   ·   ') + '   ·   ' + U.t('OK for options') : U.t('Not connected — press OK to connect')));
        r.__onselect = function () {
            if (!st.connected || st.reconnect) { stremioConnect(); return; }
            pickList(U.t('Stremio account'), [['now', U.t('Sync now')], ['off', U.t('Disconnect')]], null, function (v) {
                if (v === 'now') { U.toast(U.t('Syncing with your Stremio account…')); StremioSync.sync().then(function () { markHomeDirty(); renderSettings(); }); }
                else if (v === 'off') {
                    confirm(U.t('Disconnect your Stremio account?'), U.t('Disconnect'), function () {
                        StremioSync.disconnect();
                        U.toast(U.t('Stremio account disconnected'));
                        markHomeDirty();
                        renderSettings();
                    });
                }
            });
        };
        return r;
    }
    // Stremio's sign-in code (a QR code): approved on your phone, the key kept (StremioSync.connect).
    function stremioConnect() {
        stremioSignIn(U.t('Connect your Stremio account'), function (key, body, gone) {
            U.clear(body);
            body.appendChild(U.el('div', 'tc-line', U.t('Connecting…')));
            return StremioSync.connect(key).then(function (user) {
                if (gone()) { return; }
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', user ? U.t('✓ Connected as {user}: syncing', { user: user }) : U.t('✓ Connected: syncing')));
                markHomeDirty();
                setTimeout(function () { if (isModalOpen()) { onModalClose(null); closeModal(); renderSettings(); } }, 1500);
            });
        });
    }

    // Device-code connect overlay: shows the code + URL, polls, updates on success.
    function traktConnect() {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay');
        var box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', U.t('Connect Trakt')));
        var body = U.el('div', 'trakt-connect');
        body.appendChild(U.el('div', 'tc-line', U.t('Starting…')));
        box.appendChild(body);
        var row = U.el('div', 'modal-row');
        var cancel = U.el('div', 'pill focusable modal-btn', U.t('Cancel'));
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
                var goTo = body.appendChild(U.el('div', 'tc-line', U.t('On your phone or computer, go to:')));
                // (the QR library is loaded the first time this box opens: nothing else uses it)
                (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
                    var qr = U.qrCanvas(qrText, 8);
                    if (!qr || !qrSpot.parentNode) { return; }
                    qr.className = 'tc-qr';
                    qrSpot.appendChild(U.el('div', 'tc-line', U.t('Scan with your phone:')));
                    qrSpot.appendChild(qr);
                    goTo.textContent = U.t('or go to');
                }, function () {});
                body.appendChild(U.el('div', 'tc-url', url));
                body.appendChild(U.el('div', 'tc-line', U.t('and enter this code:')));
                body.appendChild(U.el('div', 'tc-code', code));
                body.appendChild(U.el('div', 'tc-line small', U.t('Waiting for you to authorize…')));
            },
            onSuccess: function (user) {
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', U.t('✓ Connected as {user}', { user: user })));
                markHomeDirty();
                setTimeout(function () { if (isModalOpen()) { onModalClose(null); closeModal(); renderSettings(); } }, 1500);
            },
            onError: function (msg) {
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', msg || U.t('Could not connect.')));
            }
        });
        onModalClose(cancelFlow);   // canceling the overlay stops polling
    }

    // ---- Media servers: your Jellyfin servers ----
    // Settings › Content › Nuvio plugins (js/plugins.js): on / off (after a warning), the
    // repositories you added, each one's plugins on / off. Only on a TV that can run them.
    function settingsPlugins(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Nuvio plugins')));
        if (typeof Plugins === 'undefined' || !Plugins.supported()) {
            wrap.appendChild(U.el('div', 'hint', U.t('Nuvio plugins need a 2017 or newer TV and the sideloaded app.')));
            focusSettings(); return;
        }
        var on = Plugins.isEnabled(), focus = null;
        var sw = U.el('div', 'addon-item focusable cfg-row');
        sw.appendChild(U.el('div', 'a-name', U.t('Nuvio plugins:') + '  ' + (on ? U.t('On') : U.t('Off'))));
        sw.appendChild(U.el('div', 'a-url', (on ? U.t('Your plugins look for sources on title pages') : U.t('Off: no plugin runs'))
            + '   ·   ' + (on ? U.t('OK to turn off') : U.t('OK to turn on'))));
        sw.__onselect = function () {
            _focusChild = 'pl:switch';
            if (on) { Plugins.setEnabled(false); renderSettings(); return; }
            confirm(U.t('Nuvio plugins are someone else’s code, run on your TV. StremioK keeps them apart from your settings and files, but they can reach any website, they learn which titles you open, and they’re given your TMDB key. StremioK doesn’t check what they find, and gives no help with any particular plugin. Turn them on?'),
                U.t('Turn on'), function () { Plugins.setEnabled(true); renderSettings(); });
        };
        if (_focusChild === 'pl:switch') { focus = sw; }
        wrap.appendChild(sw);
        if (!Stremio.getIntegrations().tmdb) { wrap.appendChild(U.el('div', 'hint', U.t('Plugins look titles up by their TMDB number: add a TMDB key in Settings › Content › Integrations.'))); }
        if (Plugins.experimental()) { wrap.appendChild(U.el('div', 'hint', U.t('Experimental on this TV: plugins haven’t been tried on its generation yet, and run slower here (one at a time).'))); }
        else if (Plugins.slower()) { wrap.appendChild(U.el('div', 'hint', U.t('Plugins run slower on this TV than on 2021 and newer ones (one at a time).'))); }
        var add = U.el('div', 'addon-item focusable cfg-row');
        add.appendChild(U.el('div', 'a-name', U.t('+ Add a repository')));
        add.appendChild(U.el('div', 'a-url', U.t('Its address (a manifest.json): its plugins are listed, each off until you turn it on')));
        add.__onselect = function () {
            App.openEntry({
                title: U.t('Nuvio plugins: repository'), hint: U.t('Its address, like https://example.com/plugins/manifest.json. RETURN cancels.'),
                value: 'https://', placeholder: 'https://example.com/plugins/manifest.json', phone: 'plugins',
                validate: function (v) { return Plugins.addressProblem(v); },
                onConfirm: function (url) {
                    App.back();
                    U.spinner(true, U.t('Reading the repository…'));
                    Plugins.addRepo(url).then(function (r) {
                        U.spinner(false);
                        U.toast(U.tn(r.repo.plugins.length, 'Added “{name}”: {n} plugin (off until you turn it on)', 'Added “{name}”: {n} plugins (off until you turn them on)', { name: r.repo.name }), 5000);
                        _focusChild = 'pl:' + r.repo.id;
                        renderSettings();
                    }, function (e) { U.spinner(false); U.toast(U.t('Couldn’t add it: {why}', { why: U.problem(e) }), 6000); });
                }
            });
        };
        wrap.appendChild(add);
        Plugins.repos().forEach(function (r) {
            var row = U.el('div', 'addon-item focusable cfg-row');
            row.appendChild(U.el('div', 'a-name', '📦  ' + r.name));
            row.appendChild(U.el('div', 'a-url', r.url + '   ·   ' + U.tn(r.plugins.length, '{n} plugin', '{n} plugins') + '   ·   ' + U.t('OK: refresh or remove')));
            row.__onselect = function () {
                pickList(r.name, [['refresh', U.t('↻ Refresh')], ['remove', U.t('Remove')]], null, function (v) {
                    _focusChild = 'pl:' + r.id;
                    if (v === 'refresh') {
                        U.spinner(true, U.t('Reading the repository…'));
                        Plugins.refreshRepo(r.id).then(function (x) {
                            U.spinner(false);
                            U.toast(U.t('“{name}”: {added} new, {changed} changed', { name: r.name, added: x.added, changed: x.changed }) + (x.failed ? '   ·   ' + U.tn(x.failed, '{n} didn’t come (kept as it was)', '{n} didn’t come (kept as they were)') : ''), 5000);
                            renderSettings();
                        }, function (e) { U.spinner(false); U.toast(U.t('Couldn’t refresh it: {why}', { why: U.problem(e) }), 6000); });
                    } else {
                        confirm(U.t('Remove “{name}” and its plugins?', { name: r.name }), U.t('Remove'), function () { Plugins.removeRepo(r.id); renderSettings(); });
                    }
                });
            };
            if (_focusChild === 'pl:' + r.id) { focus = row; }
            wrap.appendChild(row);
            r.plugins.forEach(function (p) {
                var pr = U.el('div', 'addon-item focusable cfg-row');
                pr.appendChild(U.el('div', 'a-name', '      ' + (p.on ? '✓  ' : '○  ') + p.name + (p.version ? '  ' + p.version : '')));
                var kinds = p.types.map(function (t) { return t === 'tv' ? U.t('Series') : U.t('Movies'); }).join(', ');
                pr.appendChild(U.el('div', 'a-url', '      ' + kinds + '   ·   ' + (p.on ? U.t('On') : U.t('Off')) + '   ·   ' + (p.on ? U.t('OK to turn off') : U.t('OK to turn on'))));
                pr.__onselect = function () { _focusChild = 'pp:' + r.id + '.' + p.id; Plugins.setPlugin(r.id, p.id, !p.on); renderSettings(); };
                if (_focusChild === 'pp:' + r.id + '.' + p.id) { focus = pr; }
                wrap.appendChild(pr);
            });
        });
        wrap.appendChild(U.el('div', 'hint', U.t('Repositories come only from addresses you add. Their sources show with your addons’ (From: Nuvio plugins). The plugin format is the Nuvio project’s; StremioK isn’t affiliated with it.')));
        if (focus) { _focusChild = null; Focus.setScope(scr('settings'), focus); } else { focusSettings(); }
    }
    function settingsMediaServers(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Media servers')));
        var have = typeof Jellyfin !== 'undefined';
        var add = U.el('div', 'addon-item focusable cfg-row');
        add.appendChild(U.el('div', 'a-name', U.t('+ Add a Jellyfin or Emby server')));
        add.appendChild(U.el('div', 'a-url', U.t('Its address on your network, then a user name and password, or Jellyfin’s Quick Connect')));
        add.__onselect = function () { askJellyfinAddress(''); };
        if (have) { wrap.appendChild(add); }
        var hasPlex = typeof Plex !== 'undefined';
        if (hasPlex) {
            var addPx = U.el('div', 'addon-item focusable cfg-row');
            addPx.appendChild(U.el('div', 'a-name', U.t('+ Add a Plex server')));
            addPx.appendChild(U.el('div', 'a-url', U.t('A code to enter at plex.tv/link, then which of your servers')));
            addPx.__onselect = function () { plexLink(); };
            wrap.appendChild(addPx);
        }
        var focus = null;
        // (each server with the module it's from: Jellyfin's for Jellyfin and Emby, Plex's)
        var all = (have ? Jellyfin.allServers().map(function (s) { return { srv: s, mod: Jellyfin, kind: Jellyfin.kindName(s) }; }) : [])
            .concat(hasPlex ? Plex.allServers().map(function (s) { return { srv: s, mod: Plex, kind: 'Plex' }; }) : []);
        all.forEach(function (x) {
            var srv = x.srv, mod = x.mod;
            var r = U.el('div', 'addon-item focusable cfg-row'), libs = mod.libraries(srv);
            r.appendChild(U.el('div', 'a-name', srv.name + '   ·   ' + x.kind + ' ' + srv.version + (srv.off ? '   ·   ' + U.t('Off') : '')));
            r.appendChild(U.el('div', 'a-url', srv.url + (srv.user ? '   ·   ' + U.t('signed in as {user}', { user: srv.user }) : '') + (srv.off ? '   ·   ' + U.t('its rows, sources and watched marks set aside') : libs.length ? '   ·   ' + libs.map(function (l) { return l.name; }).join(', ') : '')));
            r.__onselect = function () {
                var opts = srv.off ? [['on', U.t('Turn on')]] : [['off', U.t('Turn off')], ['reload', U.t('Reload')]];
                pickList(srv.name, opts.concat([['remove', U.t('Sign out and remove')]]), null, function (v) {
                    if (v === 'on' || v === 'off') {
                        mod.setOn(srv.id, v === 'on');
                        markHomeDirty();
                        U.toast('“' + srv.name + '” ' + (v === 'on' ? 'on' : 'off'));
                        _focusChild = 'jf:' + srv.id;
                        renderSettings();
                        if (v === 'on') { setTimeout(function () { if (_settingsSection === 'mediaservers') { _focusChild = 'jf:' + srv.id; renderSettings(); } }, 1500); }   // (its libraries, once read)
                    } else if (v === 'reload') {
                        mod.reload(srv.id);
                        markHomeDirty();
                        U.toast(U.t('Reading “{name}” again…', { name: srv.name }));
                        setTimeout(function () { if (_settingsSection === 'mediaservers') { renderSettings(); } }, 1500);
                    } else if (v === 'remove') {
                        confirm(U.t('Sign out of “{name}” and remove it?', { name: srv.name }), U.t('Remove'), function () { mod.remove(srv.id); markHomeDirty(); renderSettings(); });
                    }
                });
            };
            if (_focusChild === 'jf:' + srv.id) { focus = r; }
            wrap.appendChild(r);
        });
        if (all.length) {
            wrap.appendChild(subPickRow(U.t('Wait for a server'), SERVER_WAITS, 'serverWait', {
                get: function () { return { serverWait: '' + Stremio.getPrefs().serverWait }; },
                set: function (cfg) { Stremio.setPref('serverWait', +cfg.serverWait || 0); }
            }));
        }
        wrap.appendChild(U.el('div', 'hint', U.t('Jellyfin 10.9 or newer, Emby 4.7 or newer, Plex. Their files play as they are (nothing converted), so the TV must play their format.')));
        if (focus) { _focusChild = null; Focus.setScope(scr('settings'), focus); } else { focusSettings(); }
    }
    function askJellyfinAddress(value) {
        App.openEntry({
            title: U.t('Jellyfin or Emby server: address'),
            hint: U.t('Its address on your network, like http://192.168.0.50:8096. RETURN cancels.'),
            value: value || 'http://', placeholder: 'http://192.168.0.50:8096', phone: 'jellyfin',
            validate: function (v) { return Jellyfin.addressProblem(v); },
            onConfirm: function (v) {
                App.back();
                U.spinner(true, U.t('Asking the server…'));
                Jellyfin.probe(v).then(function (info) { U.spinner(false); if (info.kind === 'emby') { jellyfinPassword(info, ''); } else { jellyfinSignIn(info); } }, function (e) {
                    U.spinner(false);
                    U.toast(e.message, 6000);
                    if (_settingsSection === 'mediaservers') { renderSettings(); }
                });
            }
        });
    }
    function jellyfinDone(srv) {
        markHomeDirty();
        _settingsSection = 'mediaservers';
        _focusChild = 'jf:' + srv.id;
        renderSettings();
        U.toast(srv.user ? U.t('✓ Signed in to “{name}” as {user}', { name: srv.name, user: srv.user }) : U.t('✓ Signed in to “{name}”', { name: srv.name }));
    }
    // Plex: its code to enter at plex.tv/link (a QR of the page too), then which server.
    function plexLink() {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay'), box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', U.t('Add a Plex server')));
        var body = U.el('div', 'trakt-connect');
        body.appendChild(U.el('div', 'tc-line', U.t('Asking Plex for a code…')));
        box.appendChild(body);
        var row = U.el('div', 'modal-row'), cancel = U.el('div', 'pill focusable modal-btn', U.t('Cancel'));
        cancel.__onselect = function () { closeModal(); };
        row.appendChild(cancel);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, cancel);
        function addIt(res) {
            U.spinner(true, U.t('Finding “{name}”…', { name: res.name }));
            Plex.add(res).then(function (srv) { U.spinner(false); jellyfinDone(srv); }, function (e) { U.spinner(false); U.toast(e.message, 8000); });
        }
        var stop = Plex.link({
            onCode: function (code, url) {
                U.clear(body);
                var qrSpot = U.el('div', 'tc-qr-spot');
                body.appendChild(qrSpot);
                var goTo = body.appendChild(U.el('div', 'tc-line', U.t('On your phone or computer, go to:')));
                (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
                    var qr = U.qrCanvas(url, 8);
                    if (!qr || !qrSpot.parentNode) { return; }
                    qr.className = 'tc-qr';
                    qrSpot.appendChild(U.el('div', 'tc-line', U.t('Scan with your phone:')));
                    qrSpot.appendChild(qr);
                    goTo.textContent = U.t('or go to');
                }, function () {});
                body.appendChild(U.el('div', 'tc-url', url.replace(/^https:\/\//, '')));
                body.appendChild(U.el('div', 'tc-line', U.t('sign in, and enter this code:')));
                body.appendChild(U.el('div', 'tc-code', code));
                body.appendChild(U.el('div', 'tc-line small', U.t('Waiting for you to enter it…')));
            },
            onServers: function (list) {
                if (isModalOpen()) { onModalClose(null); closeModal(); }
                if (list.length === 1) { addIt(list[0]); return; }
                pickList(U.t('Which Plex server?'), list.map(function (x, i) { return ['' + i, x.name + (x.owned ? '' : '  ' + U.t('(shared with you)'))]; }), null, function (v) { addIt(list[+v]); });
            },
            onError: function (msg) { U.clear(body); body.appendChild(U.el('div', 'tc-line', msg)); }
        });
        onModalClose(stop);
    }
    // Signing in: Quick Connect's code, or a user name and password instead.
    function jellyfinSignIn(info) {
        var existing = document.querySelector('.modal-overlay');
        if (existing) { existing.parentNode.removeChild(existing); }
        var overlay = U.el('div', 'modal-overlay'), box = U.el('div', 'modal-box');
        box.appendChild(U.el('div', 'modal-msg', U.t('Sign in to “{name}”', { name: info.name })));
        var body = U.el('div', 'trakt-connect');
        body.appendChild(U.el('div', 'tc-line', U.t('Starting Quick Connect…')));
        box.appendChild(body);
        var row = U.el('div', 'modal-row');
        var pw = U.el('div', 'pill focusable modal-btn', U.t('User name and password'));
        var cancel = U.el('div', 'pill focusable modal-btn', U.t('Cancel'));
        row.appendChild(pw); row.appendChild(cancel);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        showModal(overlay, cancel);
        var stop = Jellyfin.quickConnect(info, {
            onCode: function (code) {
                U.clear(body);
                body.appendChild(U.el('div', 'tc-line', U.t('In Jellyfin on your phone or computer, open your profile › Quick Connect, and enter:')));
                body.appendChild(U.el('div', 'tc-code', code));
                body.appendChild(U.el('div', 'tc-line small', U.t('Waiting for you to enter it…')));
            },
            onSuccess: function (srv) { if (isModalOpen()) { onModalClose(null); closeModal(); } jellyfinDone(srv); },
            onError: function (msg) { U.clear(body); body.appendChild(U.el('div', 'tc-line', msg)); }
        });
        onModalClose(stop);   // (closed: no more asking)
        pw.__onselect = function () { onModalClose(null); stop(); closeModal(); jellyfinPassword(info, ''); };
        cancel.__onselect = function () { closeModal(); };
    }
    function jellyfinPassword(info, user) {
        App.openEntry({
            title: U.t('{server} “{name}”: user name', { server: Jellyfin.kindName(info), name: info.name }), hint: U.t('Your {server} user name. RETURN cancels.', { server: Jellyfin.kindName(info) }), value: user || '', placeholder: U.t('user name'),
            validate: function (v) { return ('' + v).trim() ? null : U.t('Your user name'); },
            onConfirm: function (u) {
                App.back();
                App.openEntry({
                    title: U.t('{server} “{name}”: password', { server: Jellyfin.kindName(info), name: info.name }), hint: U.t('Its password (not kept: only the sign-in the server gives back). RETURN cancels.'), value: '', placeholder: U.t('password'), secret: true,
                    validate: function () { return null; },
                    onConfirm: function (p) {
                        App.back();
                        U.spinner(true, U.t('Signing in…'));
                        Jellyfin.signIn(info, ('' + u).trim(), p).then(function (srv) { U.spinner(false); jellyfinDone(srv); }, function (e) {
                            U.spinner(false);
                            U.toast(e.message, 6000);
                        });
                    }
                });
            }
        });
    }

    function settingsSubtitles(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Subtitles')));
        wrap.appendChild(subPickRow(U.t('Default language'), SUB_LANGS, 'lang'));
        wrap.appendChild(subPickRow(U.t('Second choice'), SUB_LANGS2, 'lang2'));
        wrap.appendChild(subPickRow(U.t('Second subtitle (at the top)'), SUB_LANGS, 'second'));
        wrap.appendChild(subPickRow(U.t('Only my languages'), SUB_ONLY, 'only'));
        // lines to leave out: those with one of your words (a subtitle site's ads, a file's name…)
        var skip = Player.getSubCfg().skip || [];
        var sk = U.el('div', 'addon-item focusable cfg-row');
        sk.appendChild(U.el('div', 'a-name', U.t('Skip lines with:') + '  ' + (skip.length ? skip.join(', ') : U.t('None'))));
        sk.appendChild(U.el('div', 'a-url', U.t('Press OK to change   ·   a subtitle line with one of these in it isn’t shown (capitals or not)')));
        sk.__onselect = function () {
            App.openEntry({ title: U.t('Skip subtitle lines with'), value: skip.join(', '), placeholder: U.t('OPENSUBTITLES, .SRT'),
                hint: U.t('Words (or bits of them) separated by commas, capitals or not: lines with one aren’t shown. For example OPENSUBTITLES (ads) and .SRT (file names). Leave it empty for none.'),
                validate: function () { return null; },
                onConfirm: function (v) { var c = Player.getSubCfg(); c.skip = ('' + v).split(','); Player.setSubCfg(c); App.back(); renderSettings(); } });
        };
        wrap.appendChild(sk);
        var look = sectionRow(U.t('Appearance  ›'), U.t('Size, color, background, edge, position, font'), 'subtitlelook');   // (their own page: settingsSubtitleLook)
        wrap.appendChild(look);
        if (_focusChild === 'subtitlelook') { _focusChild = null; Focus.setScope(scr('settings'), look); } else { focusSettings(); }
    }
    // Subtitles › Appearance: how subtitles look.
    function settingsSubtitleLook(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Subtitle appearance')));
        wrap.appendChild(subPickRow(U.t('Size'), SUB_SIZES, 'size'));
        // [id, label] for the picker (colors with a swatch)
        function plain(list) { return list.map(function (x) { return [x[0], x[1]]; }); }
        wrap.appendChild(subPickRow(U.t('Color'), Player.SUB_COLORS.map(function (x) { return [x[0], x[1], null, x[2]]; }), 'color'));
        wrap.appendChild(subPickRow(U.t('Background'), plain(Player.SUB_BGS), 'bg'));
        wrap.appendChild(subPickRow(U.t('Edge'), plain(Player.SUB_EDGES), 'edge'));
        wrap.appendChild(subPickRow(U.t('Position'), plain(Player.SUB_POSITIONS), 'pos'));
        wrap.appendChild(subPickRow(U.t('Font'), Player.SUB_FONTS, 'font'));
        focusSettings();
    }

    // Skipping: intros and recaps skipped on their own after a countdown (with Cancel), or asked.
    var SKIP_CHOICES = [['0', U.t('Ask (a Skip button)')], ['5', U.t('After 5 seconds')], ['10', U.t('After 10 seconds')], ['15', U.t('After 15 seconds')], ['30', U.t('After 30 seconds')]];
    // Settings › Addons: how long an addon's answer is waited for (an addon that sleeps when
    // unused fails the first time while it wakes up).
    var SERVER_WAITS = [['0', U.t('Normal (20 s)')], ['45', U.t('45 seconds')], ['90', U.t('90 seconds')], ['180', U.t('180 seconds')]];   // (a media server's answer)
    var ADDON_WAITS = [['0', U.t('Normal (12 s; sources 15, search 25)')], ['20', U.t('20 seconds')], ['30', U.t('30 seconds')], ['45', U.t('45 seconds')], ['60', U.t('60 seconds')]];
    var NEXT_CHOICES = [['0', U.t('Ask')], ['5', U.t('After 5 seconds')], ['10', U.t('After 10 seconds')], ['15', U.t('After 15 seconds')], ['30', U.t('After 30 seconds')]];
    // Seeking & buffering: how far LEFT / RIGHT jump; a bigger buffer for slow connections; how
    // often a live channel that drops is opened again.
    var RECONNECTS = [['off', U.t('Off')], ['few', U.t('A few times (3 in 5 minutes)')], ['always', U.t('Keep trying')]];
    // (an HLS source through the service, with its own headers on every piece: see player-core's viaService)
    var HLS_ROUTES = [['off', U.t('Off')], ['headers', U.t('Sources that need headers')], ['all', U.t('All HLS sources')]];
    function settingsSeeking(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Seeking & buffering')));
        var store = { get: function () { var c = Player.playerCfg(); return { seek: '' + c.seek, buffer: c.buffer, reconnect: c.reconnect, hls: c.hls }; },
            set: function (cfg) { Player.setPlayerCfg({ seek: +cfg.seek || 10, buffer: cfg.buffer, reconnect: cfg.reconnect, hls: cfg.hls }); } };
        wrap.appendChild(subPickRow(U.t('Seek step'), [['5', '5 s'], ['10', '10 s'], ['15', '15 s'], ['30', '30 s']], 'seek', store));
        wrap.appendChild(subPickRow(U.t('Buffer'), [['normal', U.t('Normal (the TV’s own)')], ['more', U.t('More')], ['most', U.t('Most')]], 'buffer', store));
        wrap.appendChild(subPickRow(U.t('Reconnect live channels'), RECONNECTS, 'reconnect', store));
        wrap.appendChild(subPickRow(U.t('HLS through StremioK’s service'), HLS_ROUTES, 'hls', store));
        wrap.appendChild(U.el('div', 'hint', 'Seek step: FF / REW jump three. Buffer: More or Most starts slower but stops less on a slow connection. Reconnect: a live channel that drops opens again (BACK stops it). HLS through StremioK’s service: for a host that wants headers the TV’s player can’t send; a step more before it starts.'));
        focusSettings();
    }
    function settingsSkipping(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Skipping')));
        wrap.appendChild(subPickRow(U.t('Intros, recaps and previews'), SKIP_CHOICES, 'autoSkip', {
            get: function () { return { autoSkip: '' + Stremio.getPrefs().autoSkip }; },
            set: function (cfg) { Stremio.setPref('autoSkip', +cfg.autoSkip || 0); }
        }));
        wrap.appendChild(subPickRow(U.t('Next episode'), NEXT_CHOICES, 'autoNext', {
            get: function () { return { autoNext: '' + Stremio.getPrefs().autoNext }; },
            set: function (cfg) { Stremio.setPref('autoNext', +cfg.autoNext || 0); }
        }));
        wrap.appendChild(U.el('div', 'hint', 'Ask shows a Skip button at an intro, recap or preview, and Skip Credits → Next at the credits. With a time, it counts down and skips (or plays the next episode) on its own; Cancel keeps watching.'));
        focusSettings();
    }

    var POSTER_SHAPES = [['portrait', U.t('Portrait')], ['landscape', U.t('Landscape')]];
    // ----- Diagnostics › Logs: the recent problems U.log kept (in memory, URLs masked), and
    // how long launches took -----
    function settingsLogs(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Diagnostics  ›  Logs')));
        var list = U.logEntries ? U.logEntries() : [];
        wrap.appendChild(U.el('div', 'hint', list.length
            ? U.tn(list.length, 'The last problem since StremioK started, with keys and passwords masked. After a crash, what came just before is here too. Nothing here leaves the TV.', 'The last {n} problems since StremioK started, newest first, with keys and passwords masked. After a crash, what came just before is here too. Nothing here leaves the TV.')
            : U.t('No problems since StremioK started.')));
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
            clear.appendChild(U.el('div', 'a-name', U.t('Clear log')));
            clear.__onselect = function () { U.clearLog(); renderSettings(); };
            wrap.appendChild(clear);
        }
        startupLines(wrap);
        focusSettings();
    }
    // ----- Diagnostics › Storage: the database on or off, what's using the storage, tidying the
    // database up, giving up the copies that can be made again -----
    function settingsStorage(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Diagnostics  ›  Storage')));
        var was = Focus.current(), wasName = was && was.querySelector && was.querySelector('.a-name');   // (drawn again: on the same row)
        var wasKey = wasName ? wasName.textContent.split(/:|   —/)[0] : '';
        var on = !!(U.bigStore && U.bigStore.enabled && U.bigStore.enabled());
        var db = U.el('div', 'addon-item focusable');
        db.appendChild(U.el('div', 'a-name', U.t('Use the TV’s database:') + ' ' + (on ? U.t('On') : U.t('Off'))));
        db.appendChild(U.el('div', 'a-url', U.t('Holds StremioK’s big copies (saved Home rows, playlists, USB indexes, your Trakt history). Off: they go in the smaller settings storage, and the database is deleted')));
        db.__onselect = function () {
            function apply(v) {
                U.bigStore.setEnabled(v).then(function (r) {
                    _storageInfo = null;
                    U.toast(!r ? U.t('Couldn’t change it (Diagnostics › Logs says why)') : v ? U.t('Using the TV’s database') : r.total ? U.t('The TV’s database is off and deleted: {moved} of {total} copies kept in the settings storage', { moved: r.moved, total: r.total }) : U.t('The TV’s database is off and deleted'));
                    if (_settingsSection === 'storage') { renderSettings(); }
                });
            }
            if (!on) { apply(true); return; }
            confirm(U.t('Stop using the TV’s database? It’s deleted, and StremioK’s copies are kept in the settings storage (what doesn’t fit is made again when needed).'), U.t('Turn off'), function () { apply(false); });
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
        wrap.appendChild(U.el('h2', null, U.t('Private viewing')));
        var on = Player.isPrivate();
        var r = U.el('div', 'addon-item focusable');
        r.appendChild(U.el('div', 'a-name', U.t('Private viewing:') + ' ' + (on ? U.t('On') : U.t('Off'))));
        r.appendChild(U.el('div', 'a-url', on ? U.t('What you play isn’t recorded (StremioK, at the top, drawn as an outline meanwhile)') : U.t('What you play is recorded as usual')));
        r.__onselect = function () { Player.setPrivate(!on); markHomeDirty(); renderSettings(); };
        wrap.appendChild(r);
        wrap.appendChild(U.el('div', 'hint', U.t('While it’s on, what you play isn’t recorded: no progress, Continue Watching, watched marks, Trakt or remembered choices. What you do by hand still counts. Addons and other services are contacted as usual. UP › ◐ Private switches it while something plays.')));
        Focus.setScope(scr('settings'), r);
    }

    // ----- USB drive: each drive's index (what it has, how much is matched to titles), the
    // hidden-files switch, and forgetting the matches. -----
    var _usbListening = false;
    // folder: a network folder's (its own words: a folder, not a drive)
    function usbDriveLine(st, folder) {
        if (st.state === 'scanning') { return st.phase === 'matching' ? U.t('Indexing: matching {done} of {total} titles   ·   OK: stop', { done: st.done, total: st.total }) : (folder ? U.t('Indexing: listing the folder…   ·   OK: stop') : U.t('Indexing: listing the drive…   ·   OK: stop')); }
        if (st.state === 'failed') { return U.t('Indexing failed: {why}', { why: st.error }); }
        if (st.state === 'none') { return U.t('Not indexed yet'); }
        return U.tn(st.videos, '{n} video', '{n} videos') + ', ' + U.t('{n} matched to titles', { n: st.matched }) + (st.truncated ? ' ' + (folder ? U.t('(a very large folder: only part of it)') : U.t('(a very large drive: only part of it)')) : '') +
            (st.left ? ', ' + U.t('{n} titles left to match', { n: st.left }) : '') + '   ·   ' + U.t('indexed {when}', { when: U.dayLabel(st.at) + ' ' + new Date(st.at).toTimeString().slice(0, 5) });
    }
    // ---- Network folders (WebDAV): NetFolders ----
    var _netListening = false;
    function settingsNetFolders(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Network folders')));
        if (typeof NetFolders === 'undefined' || typeof LocalMedia === 'undefined') { focusSettings(); return; }
        if (!_netListening) {
            _netListening = true;
            LocalMedia.onChange(function (what) {
                if (_settingsSection !== 'netfolders' || /\bhidden\b/.test(scr('settings').className || '') || isModalOpen()) { return; }
                if (what === 'status' || what === 'matches' || what === 'index') {
                    var rows = scr('settings').querySelectorAll('.settings-wrap .addon-item');
                    for (var i = 0; i < rows.length; i++) { if (rows[i].__netFolder) { rows[i].querySelector('.a-url').textContent = netFolderLine(rows[i].__netFolder); } }
                }
            });
        }
        var add = U.el('div', 'addon-item focusable cfg-row');
        add.appendChild(U.el('div', 'a-name', U.t('+ Add a network folder')));
        add.appendChild(U.el('div', 'a-url', U.t('Its WebDAV address, then the user name and password it asks for, if any')));
        add.__onselect = function () { askNetAddress(''); };
        wrap.appendChild(add);
        var focus = null;
        NetFolders.all().forEach(function (f) {
            var r = U.el('div', 'addon-item focusable cfg-row');
            r.__netFolder = f;
            r.appendChild(U.el('div', 'a-name', '🌐  ' + f.name + (f.off ? '   ·   ' + U.t('Off') : '')));
            r.appendChild(U.el('div', 'a-url', netFolderLine(f)));
            r.__onselect = function () {
                var d = NetFolders.driveOf(f), st = LocalMedia.status(d);
                if (!f.off && st.state === 'scanning') { V.confirmStopIndexing(d, st, renderSettings); return; }
                var opts = f.off ? [['on', U.t('Turn on')]] : [['off', U.t('Turn off')], ['index', st.left ? U.t('Continue matching ({n} titles left)', { n: st.left }) : U.t('Index again')]];
                pickList(f.name, opts.concat([['remove', U.t('Remove')]]), null, function (v) {
                    _focusChild = 'nf:' + f.id;
                    if (v === 'on' || v === 'off') {
                        NetFolders.setOn(f.id, v === 'on');
                        markHomeDirty();
                        U.toast('“' + f.name + '” ' + (v === 'on' ? 'on' : 'off'));
                        renderSettings();
                    } else if (v === 'index') {
                        (st.left ? LocalMedia.continueMatching(d) : LocalMedia.scan(d)).then(function () {
                            var s2 = LocalMedia.status(d);
                            U.toast(s2.state === 'failed' ? (s2.error ? U.t('Indexing failed: {why}', { why: s2.error }) : U.t('Indexing failed')) : U.t('Indexed: {videos} videos, {matched} matched', { videos: s2.videos, matched: s2.matched }), 5000);
                        });
                        renderSettings();
                    } else if (v === 'remove') {
                        confirm(U.t('Remove “{name}”? Its index goes too; the folder itself isn’t touched.', { name: f.name }), U.t('Remove'), function () { NetFolders.remove(f.id); markHomeDirty(); renderSettings(); });
                    }
                });
            };
            if (_focusChild === 'nf:' + f.id) { focus = r; }
            wrap.appendChild(r);
        });
        wrap.appendChild(U.el('div', 'hint', 'A NAS (Synology, QNAP), Nextcloud, or a computer running rclone (rclone serve webdav). Home › Local shows each folder; its videos play as they are (nothing converted), so the TV must play their format.'));
        if (focus) { _focusChild = null; Focus.setScope(scr('settings'), focus); } else { focusSettings(); }
    }
    function netFolderLine(f) {
        if (f.off) { return f.url + '   ·   ' + U.t('its sources set aside, its index kept'); }
        var st = LocalMedia.status(NetFolders.driveOf(f));
        return f.url + (f.user ? '   ·   ' + U.t('as {user}', { user: f.user }) : '') + (f.cert ? '   ·   ' + U.t('its certificate trusted') : '') + '   ·   ' + usbDriveLine(st, true);
    }
    function askNetAddress(value) {
        App.openEntry({
            title: U.t('Network folder: address'),
            hint: U.t('Its WebDAV address, like http://192.168.0.50:8080/media (https:// too). RETURN cancels.'),
            value: value || 'http://', placeholder: 'http://192.168.0.50:8080/media', phone: 'webdav',
            validate: function (v) { return NetFolders.addressProblem(v); },
            onConfirm: function (url) {
                App.back();
                App.openEntry({
                    title: U.t('Network folder: user name'), hint: U.t('The user name it asks for; leave it empty if it asks for none. RETURN cancels.'), value: '', placeholder: U.t('user name'),
                    validate: function () { return null; },
                    onConfirm: function (user) {
                        App.back();
                        if (!('' + user).trim()) { netProbe(url, '', '', ''); return; }
                        App.openEntry({
                            title: U.t('Network folder: password'), hint: U.t('Its password (kept on the TV, sent only to that folder). RETURN cancels.'), value: '', placeholder: U.t('password'), secret: true,
                            validate: function () { return null; },
                            onConfirm: function (pass) { App.back(); netProbe(url, ('' + user).trim(), '' + pass, ''); }
                        });
                    }
                });
            }
        });
    }
    // Ask the folder with that sign-in; a certificate it made itself: asked about first.
    function netProbe(url, user, pass, cert) {
        U.spinner(true, U.t('Asking the folder…'));
        NetFolders.probe(url, user, pass, cert).then(function (p) {
            U.spinner(false);
            var f;
            try { f = NetFolders.add(p); } catch (e) { U.toast(e.message, 5000); return; }
            markHomeDirty();
            _settingsSection = 'netfolders';
            _focusChild = 'nf:' + f.id;
            renderSettings();
            U.toast(U.t('✓ Added “{name}”: Home › Local shows it', { name: f.name }), 5000);
        }, function (e) {
            U.spinner(false);
            if (e && e.why === 'untrusted' && e.cert && !cert) {
                confirm(U.t('“{url}”: trust this certificate? It isn’t from a known authority (one the folder made itself?)', { url: url }) + (e.name ? ', ' + U.t('for {name}', { name: e.name }) : '') + (e.until ? ', ' + U.t('until {date}', { date: e.until }) : '') +
                    '. ' + U.t('Its fingerprint (SHA-256): {fp}. StremioK then accepts this certificate only, for this folder.', { fp: e.fp }), U.t('Trust this certificate'), function () { netProbe(url, user, pass, e.cert); }, { noLabel: U.t('Cancel'), plain: true });
                return;
            }
            U.toast((e && e.message) || U.t('It failed'), 7000);
            if (_settingsSection === 'netfolders') { renderSettings(); }
        });
    }

    function settingsUsb(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('USB drive')));
        if (typeof LocalMedia === 'undefined' || !LocalMedia.available()) {
            wrap.appendChild(U.el('div', 'hint', U.t('Only on the TV: this install can’t see USB drives.')));
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
        wrap.appendChild(U.el('div', 'hint', U.t('Home › Local shows your drive. Videos are matched to titles by their names, and a matched one plays as that title. Index a drive to have its videos and subtitle files offered on their title pages.')));
        if (!LocalMedia.isRead()) {   // (read when asked, not at launch)
            wrap.appendChild(U.el('div', 'hint', U.t('Reading USB drives…')));
            LocalMedia.ensure().then(function () { if (_settingsSection === 'usb') { renderSettings(); } });
            focusSettings();
            return;
        }
        var ds = LocalMedia.knownDrives().filter(function (d) { return !d.dav; }), first = null;   // (network folders: their own page)
        if (!ds.length) { wrap.appendChild(U.el('div', 'hint', U.t('No USB drive plugged in.'))); }
        ds.forEach(function (d) {
            var r = U.el('div', 'addon-item focusable');
            r.__usbDrive = d;
            r.appendChild(U.el('div', 'a-name', '💾  ' + d.label.replace(/^removable_/, '') + '   —   ' + U.t('Index')));
            r.appendChild(U.el('div', 'a-url', usbDriveLine(LocalMedia.status(d))));
            r.__onselect = function () {
                var st = LocalMedia.status(d);
                if (st.state === 'scanning') { V.confirmStopIndexing(d, st, renderSettings); return; }
                if (st.left) {
                    pickList(U.t('Index this drive'), [['more', U.t('Continue matching ({n} titles left)', { n: st.left })], ['again', U.t('Index again (list the drive afresh)')]], 'more', function (k) {
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
        mt.appendChild(U.el('div', 'a-name', U.t('Match videos to titles:') + ' ' + (LocalMedia.matchingAllowed() ? U.t('On') : LocalMedia.matchingAsked() ? U.t('Off') : U.t('Off (not asked yet)'))));
        mt.appendChild(U.el('div', 'a-url', U.t('On: titles worked out from your videos’ names (not the files) are looked up with your search addons, which see them. Off: Local just browses')));
        mt.__onselect = function () { LocalMedia.setMatching(!LocalMedia.matchingAllowed()); markHomeDirty(); renderSettings(); Focus.setScope(scr('settings'), scr('settings').querySelectorAll('.settings-wrap .addon-item')[ds.length]); };
        wrap.appendChild(mt);
        var hid = U.el('div', 'addon-item focusable');
        hid.appendChild(U.el('div', 'a-name', U.t('Show hidden files:') + ' ' + (LocalMedia.showHidden() ? U.t('On') : U.t('Off'))));
        hid.appendChild(U.el('div', 'a-url', U.t('Names starting with “.” (a Mac leaves ._… copies, .DS_Store, .Spotlight-V100…), $RECYCLE.BIN, System Volume Information')));
        hid.__onselect = function () { LocalMedia.setShowHidden(!LocalMedia.showHidden()); markHomeDirty(); renderSettings(); Focus.setScope(scr('settings'), scr('settings').querySelectorAll('.settings-wrap .addon-item')[ds.length + 1]); };
        wrap.appendChild(hid);
        var clr = U.el('div', 'addon-item focusable');
        clr.appendChild(U.el('div', 'a-name', U.t('Clear the USB index')));
        clr.appendChild(U.el('div', 'a-url', U.t('What StremioK listed of your drives: title pages stop offering their files until a drive is indexed again (Local still browses them)')));
        clr.__onselect = function () {
            confirm(U.t('Clear the index of your USB drives?'), U.t('Clear'), function () { LocalMedia.clearIndex(); U.toast(U.t('USB index cleared')); renderSettings(); });
        };
        wrap.appendChild(clr);
        var forget = U.el('div', 'addon-item focusable');
        forget.appendChild(U.el('div', 'a-name', U.t('Forget matches')));
        forget.appendChild(U.el('div', 'a-url', U.t('Every video matched again from its name, as you browse or index (the ones you matched by hand too)')));
        forget.__onselect = function () {
            confirm(U.t('Forget which title each video is (yours too)? They’re matched again as you browse, or when a drive is indexed.'), U.t('Forget'), function () {
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
        if (key === 'stremiok.homecache') { return { name: U.t('Home’s saved rows') }; }
        if (key === 'stremiok.trakt.watched') { return { name: U.t('Trakt watched history') }; }
        if (key === 'stremiok.media.watched') { return { name: U.t('Media servers’ watched marks') }; }
        if (key === 'stremiok.stremio.items') { return { name: U.t('Your Stremio account’s library') }; }
        if ((m = key.match(/^stremiok\.iptv\.cache\.(.+)$/))) {
            var p = (typeof IPTV !== 'undefined' ? IPTV.getPlaylists() : []).filter(function (x) { return x.id === m[1]; })[0];
            return p ? { name: U.t('IPTV playlist copy: {name}', { name: p.name || (('' + p.url).match(/^[a-z]+:\/\/(?:[^\/@]*@)?([^\/?#:]+)/i) || [])[1] || U.t('a playlist') }) }
                : { name: U.t('IPTV playlist copy ({key})', { key: key }), unused: U.t('its playlist was removed') };
        }
        if ((m = key.match(/^stremiok\.local\.index\.(.+)$/))) {
            var kept = U.store.get('stremiok.local.indexes', {}) || {};
            return kept[m[1]] ? { name: U.t('USB drive index: {drive}', { drive: m[1] }) } : { name: U.t('USB drive index: {drive}', { drive: m[1] }), unused: U.t('not one of the drives kept') };
        }
        if (key === 'stremiok.local.index') { return { name: U.t('USB index ({key})', { key: key }), unused: U.t('kept by an earlier version') }; }
        return { name: key };
    }
    function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function storageLines(wrap, dbOn) {
        var r = U.el('div', 'addon-item focusable startup-row');
        r.appendChild(U.el('div', 'a-name', U.t('TV storage') + (_storageInfo ? '' : '   —   ' + U.t('check what’s using it'))));
        if (_storageInfo === 'busy') { r.appendChild(U.el('div', 'a-url', U.t('Checking…'))); }
        else if (_storageInfo) {
            var inf = _storageInfo;
            var line = function (t) { r.appendChild(U.el('div', 'a-url', t)); };
            var mine = inf.entries.reduce(function (n, e) { return n + e.bytes; }, 0);
            if (inf.quota) { line(U.t('The TV’s database: {used} used of {quota} it allows StremioK', { used: fmtBytes(inf.usage || 0), quota: fmtBytes(inf.quota) })); }
            if (inf.entries.length) {
                var own = U.tn(inf.entries.length, 'StremioK’s own data: about {size} in {n} item', 'StremioK’s own data: about {size} in {n} items', { size: fmtBytes(mine) });
                line((inf.usage || 0) > mine + 65536 ? U.t('Of that, {own}; the other {rest} is the database’s own: old versions of items saved again, which it clears out over time on its own (not copies StremioK keeps)', { own: own, rest: fmtBytes(inf.usage - mine) }) : own);
            }
            var sorted = inf.entries.slice().sort(function (a, b) { return b.bytes - a.bytes; });
            sorted.slice(0, STORAGE_ITEMS).forEach(function (e) {
                var d = storageItem(e.key), notes = [];
                if (e.saves) { notes.push(U.tn(e.saves, 'saved once since StremioK started', 'saved {n} times since StremioK started')); }
                if (d.unused) { notes.push(U.t('no longer used: {why}', { why: d.unused })); }
                if (inf.lsKeys[e.key]) { notes.push(U.t('also in the settings storage')); }
                line(fmtBytes(e.bytes) + '   ' + d.name + notes.map(function (n) { return '   ·   ' + n; }).join(''));
            });
            if (sorted.length > STORAGE_ITEMS) {
                line(U.t('and {n} more:', { n: sorted.length - STORAGE_ITEMS }) + ' ' + fmtBytes(sorted.slice(STORAGE_ITEMS).reduce(function (n, e) { return n + e.bytes; }, 0)));
            }
            if (!inf.entries.length) { line(dbOn ? U.t('Nothing in the TV’s database.') : U.t('The TV’s database isn’t used (turned off above).')); }
            line(U.t('Settings storage: {size} (progress, watched marks, settings…)', { size: fmtBytes(inf.ls) }) + (inf.lsTop.length ? '; ' + U.t('the largest:') : ''));
            inf.lsTop.forEach(function (e) { line('   ' + fmtBytes(e.bytes) + '   ' + e.key); });
            if (inf.guides && inf.guides.count) { line(U.tn(inf.guides.count, 'Saved TV guides (in StremioK’s folder): {size} in {n} file', 'Saved TV guides (in StremioK’s folder): {size} in {n} files', { size: fmtBytes(inf.guides.bytes) })); }
            if (inf.guides && inf.guides.xtv && inf.guides.xtv.count) { line(U.tn(inf.guides.xtv.count, 'Saved Xtream film and series lists (in StremioK’s folder): {size} in {n} file', 'Saved Xtream film and series lists (in StremioK’s folder): {size} in {n} files', { size: fmtBytes(inf.guides.xtv.bytes) })); }
            if (inf.disk) { line(U.t('The TV’s own disk: {free} free of {total}  (what the TV allows StremioK follows it: freeing space, unused apps for one, raises it)', { free: fmtBytes(inf.disk.free), total: fmtBytes(inf.disk.total) })); }
        }
        r.__onselect = function () {
            if (!U.bigStore || !U.bigStore.info || _storageInfo === 'busy') { return; }
            _storageInfo = 'busy'; renderSettings();
            var guides = (typeof YTPlay !== 'undefined' && YTPlay.epgFiles) ? YTPlay.epgFiles().then(null, function () { return null; }) : null;
            Promise.all([U.bigStore.info(), U.diskInfo ? U.diskInfo() : null, guides]).then(function (both) {
                var inf = both[0], ls = 0, lsAll = [];
                inf.disk = both[1];
                inf.guides = both[2];   // ({ count, bytes }: the TV guides StremioK's service saved)
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
            }, function () { _storageInfo = null; U.toast(U.t('Couldn’t check')); renderSettings(); });
        };
        wrap.appendChild(r);
        if (dbOn) {   // (tidying up: only while it's used)
            var tidy = U.el('div', 'addon-item focusable');
            tidy.appendChild(U.el('div', 'a-name', U.t('Tidy up the TV’s database')));
            tidy.appendChild(U.el('div', 'a-url', U.t('Gives back the space of old versions of what StremioK saved, which the TV’s database keeps (StremioK’s data stays). Done on its own when they take over half of what the TV allows')));
            tidy.__onselect = function () {
                if (!U.bigStore || !U.bigStore.tidy) { return; }
                U.toast(U.t('Tidying up the TV’s database…'));
                U.bigStore.tidy().then(function (res) {
                    U.toast(!res ? U.t('Couldn’t tidy it up (Diagnostics › Logs says why)') : res.before != null && res.after != null ? U.t('The TV’s database: {before} → {after}', { before: fmtBytes(res.before), after: fmtBytes(res.after) }) : U.t('Tidied up'));
                    _storageInfo = null;
                    if (_settingsSection === 'storage') { renderSettings(); }
                });
            };
            wrap.appendChild(tidy);
        }
        var clr = U.el('div', 'addon-item focusable');
        clr.appendChild(U.el('div', 'a-name', U.t('Clear saved copies')));
        clr.appendChild(U.el('div', 'a-url', U.t('Home’s saved rows, IPTV playlist copies, saved TV guides and Xtream lists, the USB index: made again when needed (playlists, guides and lists download again)')));
        clr.__onselect = function () {
            confirm(U.t('Clear the copies StremioK can make again (Home rows, playlist copies, TV guides, Xtream lists, USB index)?'), U.t('Clear'), function () {
                U.bigStore.keys().then(function (ks) {
                    return Promise.all(ks.filter(function (k) { return /^stremiok\.(homecache|local\.index|iptv\.cache\.)/.test(k); }).map(function (k) { return U.bigStore.remove(k); }));
                }).then(function () {
                    return (typeof YTPlay !== 'undefined' && YTPlay.epgClear) ? YTPlay.epgClear().then(null, function () {}) : null;   // (the saved guides: read again as they're needed)
                }).then(function () {
                    if (typeof EPG !== 'undefined' && EPG.reset) { EPG.reset(); }
                    if (typeof LocalMedia !== 'undefined') { LocalMedia.clearIndex(); }
                    _storageInfo = null;
                    U.toast(U.t('Saved copies cleared'));
                    renderSettings();
                });
            });
        };
        wrap.appendChild(clr);
    }

    // How long this launch (and the one before) took to get going, from when the TV
    // started loading the app.
    var STARTUP_STEPS = [['css', U.t('stylesheet')], ['firstScreen', U.t('first screen')], ['addons', U.t('addons')], ['firstCard', U.t('first title')]];
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
        r.appendChild(U.el('div', 'a-name', U.t('Startup')));
        if (now) { r.appendChild(U.el('div', 'a-url', U.t('This launch: {steps}', { steps: now }))); }
        if (before) { r.appendChild(U.el('div', 'a-url', U.t('Launch before: {steps}', { steps: before }))); }
        wrap.appendChild(r);
    }

    // ----- Streaming apps: your apps on this TV that a title's "where to watch" sources
    // open (TVApps.appForService), then this TV's apps to add. OK on one of yours removes it. -----
    var _appsFocus = null;   // { id, ctl } to focus after a change
    var _appsAll = false;    // the add list includes hidden (system) apps
    function settingsAppShortcuts(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Streaming apps')));
        if (!canListApps()) {
            wrap.appendChild(U.el('div', 'hint', U.t('Only on the TV: this install can\'t see or open the TV\'s apps.')));
            focusSettings();
            return;
        }
        wrap.appendChild(U.el('div', 'hint feeds-hint', 'A title\'s "where to watch" sources open these apps. Most are found by name; list one only where the TV has several for a service (like Netflix). OK on one of yours removes it.'));
        function redo(id, ctl) { _appsFocus = { id: id, ctl: ctl }; renderSettings(); }
        var mine = TVApps.shortcuts(), nameOf = {};
        if (!mine.length) { wrap.appendChild(U.el('div', 'hint', U.t('None listed yet: pick apps below.'))); }
        mine.forEach(function (a, i) {
            var r = U.el('div', 'addon-item focusable app-mine');
            r.setAttribute('data-fk', a.id); r.setAttribute('data-ctl', 'name');
            r.appendChild(U.el('div', 'a-name', a.name));
            nameOf[a.id] = U.el('div', 'a-url', a.id);
            r.appendChild(nameOf[a.id]);
            r.__onselect = function () {
                TVApps.remove(a.id);
                U.toast(U.t('{name} removed', { name: a.name }), 1500);
                var next = mine[i + 1] || mine[i - 1];   // focus stays in the list
                redo(next ? next.id : null, next ? 'name' : 'add');
            };
            wrap.appendChild(r);
        });
        wrap.appendChild(U.el('div', 'formats-group', U.t('Add an app')));
        var status = U.el('div', 'hint', U.t('Reading this TV\'s apps…'));
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
            mine.forEach(function (a) { if (!onTv[a.id]) { nameOf[a.id].textContent += '   ·   ' + U.t('not on this TV any more'); } });
            var hidden = 0;
            var list = apps.filter(function (a) {
                if (TVApps.has(a.id)) { return false; }
                if (!_appsAll && !a.show) { hidden++; return false; }
                return true;
            });
            status.textContent = list.length ? U.t('OK adds one. Where an app is listed more than once, pick the one that opens (Settings › Diagnostics › Installed apps tries them).')
                : U.t('Every app on this TV is already listed.');
            list.forEach(function (a, i) {
                var r = U.el('div', 'addon-item focusable app-add');
                r.setAttribute('data-fk', a.id); r.setAttribute('data-ctl', 'add');
                r.appendChild(U.el('div', 'a-name', a.name));
                r.appendChild(U.el('div', 'a-url', a.id + (a.show ? '' : '   ·   ' + U.t('hidden (system) app'))));
                r.__onselect = function () {
                    if (!TVApps.add(a)) { U.toast(U.t('That\'s the most apps StremioK keeps ({n})', { n: TVApps.MAX })); return; }
                    U.toast(U.t('{name} added', { name: a.name }), 1500);
                    var next = list[i + 1] || list[i - 1];   // keep adding from here
                    redo(next ? next.id : a.id, next ? 'add' : 'name');
                };
                wrap.appendChild(r);
            });
            if (_appsAll || hidden) {
                var more = U.el('div', 'addon-item focusable app-add');
                more.setAttribute('data-fk', '*hidden'); more.setAttribute('data-ctl', 'hidden');
                more.appendChild(U.el('div', 'a-name', _appsAll ? U.t('Hide the hidden (system) apps') : U.tn(hidden, 'Also show {n} hidden (system) app', 'Also show {n} hidden (system) apps')));
                more.__onselect = function () { _appsAll = !_appsAll; redo('*hidden', 'hidden'); };
                wrap.appendChild(more);
            }
            focusNow();
        }, function (e) {
            if (_settingsSection !== 'appshortcuts' || !wrap.parentNode) { return; }
            status.textContent = U.t('The TV didn\'t list its apps: {why}', { why: e.message });
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
        TVApps.launch(a).then(null, function (e) { U.toast(U.t('Couldn\'t open {name}: {why}', { name: a.name, why: e.message }), 4000); });
    }
    // Returns the first app row (to focus), if the list is showing.
    function tvAppsSection(wrap) {
        wrap.appendChild(U.el('h2', null, U.t('Diagnostics  ›  Installed apps')));
        if (!canListApps()) {
            wrap.appendChild(U.el('div', 'hint', U.t('Only on the TV: this install can\'t see the TV\'s apps.')));
            return null;
        }
        if (!_tvApps) {
            var show = U.el('div', 'addon-item focusable');
            show.appendChild(U.el('div', 'a-name', U.t('Show installed apps')));
            show.appendChild(U.el('div', 'a-url', U.t('Their names and IDs, as the TV reports them')));
            show.__onselect = function () { readTvApps(false); };
            wrap.appendChild(show);
            return null;
        }
        if (_tvApps.error) {
            wrap.appendChild(U.el('div', 'hint', U.t('The TV didn\'t list its apps: {why}', { why: _tvApps.error })));
            return null;
        }
        wrap.appendChild(U.el('div', 'hint', (_tvApps.all ? U.tn(_tvApps.list.length, '{n} app, including hidden ones.', '{n} apps, including hidden ones.') : U.tn(_tvApps.list.length, '{n} app.', '{n} apps.')) +
            ' ' + U.t('OK on one opens it (to check StremioK can launch it).')));
        var first = null;
        _tvApps.list.forEach(function (a) {
            var r = U.el('div', 'addon-item focusable diag-row');
            r.appendChild(U.el('div', 'a-name', a.name));
            r.appendChild(U.el('div', 'a-url', a.id + (a.version ? '   ·   ' + U.t('version {v}', { v: a.version }) : '')));
            r.__onselect = function () { launchTvApp(a); };
            wrap.appendChild(r);
            if (!first) { first = r; }
        });
        if (!_tvApps.all && _tvApps.hidden > 0) {
            var more = U.el('div', 'addon-item focusable');
            more.appendChild(U.el('div', 'a-name', U.tn(_tvApps.hidden, 'Also show {n} hidden (system) app', 'Also show {n} hidden (system) apps')));
            more.__onselect = function () { readTvApps(true); };
            wrap.appendChild(more);
        }
        return first;
    }

    // ----- Home feeds and Search results (Settings > Home): order, show / hide -----
    // kind 'home': the Home rows (every catalog); 'search': the Search rows (every catalog
    // that can search, IPTV as one per type). ▲/▼ moves one; OK on its name shows / hides it.
    // 'menu': the top menu between Watching and Settings (the tabs, Discover, Search: ViewParts'
    // menuOrder); OK on a tab shows / hides it, Discover and Search always show.
    var MENU_FIXED = { discover: U.t('Discover'), search: U.t('Search') };
    function menuHidden(k) { return !MENU_FIXED[k] && (Stremio.getPrefs().hiddenTabs || []).indexOf(k) !== -1; }
    var FEED_KINDS = {
        menu: { section: 'menuorder', title: U.t('Home  ›  Menu'), hint: U.t('Watching comes first and Settings last: ⇈ ▲ ▼ ⇊ put the rest in your order · OK on a tab shows/hides it.'),
            list: function () {
                return Promise.resolve(V.menuOrder().map(function (k) {
                    var t = (V.HOME_TABS || []).filter(function (x) { return x.key === k; })[0];
                    return { key: k, name: MENU_FIXED[k] || (t ? t.label : k) + (k === 'local' ? ' ' + U.t('(with a USB drive in)') : k === 'guide' ? ' ' + U.t('(once a TV guide is read)') : '') };
                }));
            },
            keyOf: function (x) { return x.key; },
            move: function (k, d) { V.moveMenuItem(k, d); markHomeDirty(); return Promise.resolve(); },
            toggle: function (k) {
                if (MENU_FIXED[k]) { U.toast(U.t('{tab} is always in the menu', { tab: MENU_FIXED[k] })); return; }
                var now = (Stremio.getPrefs().hiddenTabs || []).filter(function (x) { return x !== k; });
                if (!menuHidden(k)) { now.push(k); }
                Stremio.setPref('hiddenTabs', now);
                markHomeDirty();
            },
            hidden: menuHidden },
        home: { section: 'feeds', title: U.t('Home  ›  Home feeds'), hint: U.t('▲/▼ reorder a feed · OK on the name shows/hides it on Home.'),
            list: function () { return Stremio.listCatalogsOrdered(); }, keyOf: function (c) { return Stremio.catalogKey(c); },
            move: function (k, d) { return Stremio.moveFeed(k, d); }, toggle: function (k) { Stremio.toggleFeed(k); },
            hidden: function (k) { return Stremio.isFeedHidden(k); } },
        search: { section: 'searchfeeds', title: U.t('Home  ›  Search results'), hint: U.t('▲/▼ reorder the Search rows · OK on the name shows/hides one in Search.'),
            list: function () { return Stremio.searchSourcesOrdered(); }, keyOf: function (src) { return src.key; },
            move: function (k, d) { return Stremio.moveSearchFeed(k, d); }, toggle: function (k) { Stremio.toggleSearchFeed(k); },
            hidden: function (k) { return Stremio.isSearchFeedHidden(k); } },
        ranking: { section: 'ranking', title: U.t('Playback  ›  Source ranking'), off: 'off',
            hint: U.t('Sources are ordered by these, top first: ▲/▼ moves one, OK turns it off or on. Resolution at the top groups the list by resolution. Your addons are below.'),
            list: function () { return Promise.resolve(Stremio.getRanking().criteria); }, keyOf: function (c) { return c.key; },
            move: function (k, d) { Stremio.moveRanking(k, d); return Promise.resolve(); }, toggle: function (k) { Stremio.toggleRanking(k); },
            hidden: function (k) { return !Stremio.getRanking().criteria.some(function (c) { return c.key === k && c.on; }); },
            before: function (wrap) {   // played before, above the resolution groups; then the two pages
                var played = Stremio.getRanking().played;
                var r = U.el('div', 'addon-item focusable cfg-row feed-extra');
                r.setAttribute('data-fk', 'played'); r.setAttribute('data-ctl', 'extra');
                r.appendChild(U.el('div', 'a-name', U.t('Played before first:') + '  ' + (played ? U.t('On') : U.t('Off'))));
                r.appendChild(U.el('div', 'a-url', (played ? U.t('Sources you played for a title (for a series, its release) come before the resolution groups')
                    : U.t('Sources you played rank like any other')) + '   ·   ' + (played ? U.t('OK to turn off') : U.t('OK to turn on'))));
                r.__onselect = function () { Stremio.setPlayedFirst(!played); refeed('ranking', 'played', 'extra'); };
                wrap.appendChild(r);
                wrap.appendChild(rankPageRow(U.t('Filters  ›'), filtersSummary(), 'rankfilters'));
                wrap.appendChild(rankPageRow(U.t('When you press Play  ›'), onPlaySummary(), 'rankplay'));
                if (_focusChild === 'rankfilters' || _focusChild === 'rankplay') { _feedFocus = { key: _focusChild, ctl: 'extra' }; _focusChild = null; }   // (BACK from one: on its row)
                wrap.appendChild(U.el('div', 'formats-group', U.t('Then, in this order')));
            },
            after: function (wrap) {
                var r = U.el('div', 'addon-item focusable feed-extra');
                r.setAttribute('data-fk', 'reset'); r.setAttribute('data-ctl', 'extra');
                r.appendChild(U.el('div', 'a-name', U.t('Restore defaults')));
                r.appendChild(U.el('div', 'a-url', 'Played before first; then resolution, not yet cached last, release type, HDR before SDR, Feed sources order, each addon\'s own order (your addons stay as they are)'));
                r.__onselect = function () { Stremio.resetRanking(); refeed('ranking', 'reset', 'extra'); U.toast(U.t('Source ranking restored')); };
                wrap.appendChild(r);
                // The addons that provide sources (Feed sources): their order, and on / off
                wrap.appendChild(U.el('div', 'formats-group', U.t('Addons')));
                wrap.appendChild(U.el('div', 'hint', U.t('The addons that give sources: ▲/▼ sets their order, OK turns one off (it isn\'t asked).')));
                return Stremio.feedSourcesOrdered().then(function (items) {
                    if (!items.length) { wrap.appendChild(U.el('div', 'hint', U.t('None of your addons provide sources: add a stream addon in Settings › Content › Addons.'))); }
                    feedRows(wrap, 'ranking', items, SOURCE_ROWS);
                }, function () { wrap.appendChild(U.el('div', 'hint', U.t('Your addons couldn\'t be read just now.'))); });
            } }
    };
    // Source ranking's two pages (rankfilters, rankplay): a row on it that opens one, saying
    // what's set there.
    function rankPageRow(title, summary, section) {
        var r = U.el('div', 'addon-item focusable cfg-row feed-extra');
        r.setAttribute('data-fk', section); r.setAttribute('data-ctl', 'extra');
        r.appendChild(U.el('div', 'a-name', title));
        r.appendChild(U.el('div', 'a-url', summary));
        r.__onselect = function () { _settingsSection = section; renderSettings(); };
        return r;
    }
    function filtersSummary() {
        var P = Stremio.getPrefs(), bits = [U.t('Sources the TV can’t play:') + ' ' + (P.hideUnplayable ? U.t('Hidden') : U.t('Shown'))], sizes = [];
        [['movie', U.t('Movies')], ['series', U.t('Series')]].forEach(function (k) { var L = P.sizeLimits[k[0]]; if (L.min || L.max || L.perHour) { sizes.push(k[1] + ' ' + sizeSummary(L)); } });
        bits.push(sizes.length ? sizes.join(', ') : U.t('No size limits'));
        bits.push(P.hideWords.length ? U.t('Words: {words}', { words: P.hideWords.join(', ') }) : U.t('No words'));
        return bits.join('   ·   ');
    }
    function onPlaySummary() {
        var P = Stremio.getPrefs();
        return (P.skipSourceList ? U.t('Source list: skipped') : U.t('Source list: shown')) + '   ·   ' + U.t('The next source if one doesn’t start:') + ' ' + (P.nextOnFail ? U.t('On') : U.t('Off'));
    }
    // A page of its own: its title, a hint, its rows; focus back on the one just changed.
    function rankPage(wrap, title, hint, rows) {
        wrap.appendChild(U.el('h2', null, U.t('Playback') + '  ›  ' + U.t('Source ranking') + '  ›  ' + title));
        wrap.appendChild(U.el('div', 'hint feeds-hint', hint));
        rows.forEach(function (r) { wrap.appendChild(r); });
        var pref = null;
        if (_feedFocus) { pref = rows.filter(function (r) { return r.getAttribute('data-fk') === _feedFocus.key; })[0] || null; _feedFocus = null; }
        Focus.setScope(scr('settings'), pref || rows[0]);
    }
    // Filters: what's left out, or sent to the bottom.
    function settingsRankFilters(wrap) {
        rankPage(wrap, U.t('Filters'), U.t('Sources these leave out, or send to the bottom of the list: never picked on their own.'),
            [unplayableRow(), sizeRow('movie', U.t('Movies’ sizes')), sizeRow('series', U.t('Series’ sizes (an episode)')), wordsRow()]);
    }
    // When you press Play: whether the list shows, and a source that doesn't start.
    function settingsRankPlay(wrap) {
        rankPage(wrap, U.t('When you press Play'), U.t('What ▶ Play does with the ranked list.'), [skipListRow(), nextOnFailRow()]);
    }
    // direct links only: the sources the TV can't play left out of the list
    function unplayableRow() {
        var hideUn = Stremio.getPrefs().hideUnplayable;
        var un = U.el('div', 'addon-item focusable cfg-row feed-extra');
        un.setAttribute('data-fk', 'unplayable'); un.setAttribute('data-ctl', 'extra');
        un.appendChild(U.el('div', 'a-name', U.t('Sources the TV can’t play:') + '  ' + (hideUn ? U.t('Hidden') : U.t('Shown'))));
        un.appendChild(U.el('div', 'a-url', (hideUn ? U.t('Left out (torrents, links it can’t open): direct links only; where-to-watch apps stay')
            : U.t('Listed, dimmed, at the bottom (torrents, links it can’t open)')) + '   ·   ' + (hideUn ? U.t('OK to show them') : U.t('OK to hide them'))));
        un.__onselect = function () { Stremio.setPref('hideUnplayable', !hideUn); refeed('ranking', 'unplayable', 'extra'); };
        return un;
    }
    // skip the source list: Play plays the top source at once
    function skipListRow() {
        var skipList = Stremio.getPrefs().skipSourceList;
        var sl = U.el('div', 'addon-item focusable cfg-row feed-extra');
        sl.setAttribute('data-fk', 'skiplist'); sl.setAttribute('data-ctl', 'extra');
        sl.appendChild(U.el('div', 'a-name', U.t('Skip the source list:') + '  ' + (skipList ? U.t('On') : U.t('Off'))));
        sl.appendChild(U.el('div', 'a-url', (skipList ? U.t('▶ Play, OK on an episode and ▶ Play SxEx play the top source at once (hold OK on an episode › Details for the list)')
            : U.t('▶ Play and OK on an episode show the sources to pick from (the remote’s Play key plays the top one)')) + '   ·   ' + (skipList ? U.t('OK to turn off') : U.t('OK to turn on'))));
        sl.__onselect = function () { Stremio.setPref('skipSourceList', !skipList); refeed('ranking', 'skiplist', 'extra'); };
        return sl;
    }
    // a source that doesn't start: the next one
    function nextOnFailRow() {
        var nextOn = Stremio.getPrefs().nextOnFail;
        var nx = U.el('div', 'addon-item focusable cfg-row feed-extra');
        nx.setAttribute('data-fk', 'nextonfail'); nx.setAttribute('data-ctl', 'extra');
        nx.appendChild(U.el('div', 'a-name', U.t('The next source if one doesn’t start:') + '  ' + (nextOn ? U.t('On') : U.t('Off'))));
        nx.appendChild(U.el('div', 'a-url', (nextOn ? U.t('A source the TV refuses, or that hasn’t started after 45 s, gives way to the next best one (up to 3 more)')
            : U.t('A source that doesn’t start takes you back to the list')) + '   ·   ' + (nextOn ? U.t('OK to turn off') : U.t('OK to turn on'))));
        nx.__onselect = function () { Stremio.setPref('nextOnFail', !nextOn); refeed('ranking', 'nextonfail', 'extra'); };
        return nx;
    }
    // your words: sources with one of them at the bottom, for every title
    function wordsRow() {
        var words = Stremio.getPrefs().hideWords;
        var w = U.el('div', 'addon-item focusable cfg-row feed-extra');
        w.setAttribute('data-fk', 'words'); w.setAttribute('data-ctl', 'extra');
        w.appendChild(U.el('div', 'a-name', U.t('Hide sources with these words:') + '  ' + (words.length ? words.join(', ') : U.t('None'))));
        w.appendChild(U.el('div', 'a-url', U.t('A source with one of them in its name, description or file name (a whole word: “CAM” isn’t in “CAMERA”) goes to the bottom, for every title   ·   OK to change')));
        w.__onselect = function () {
            App.openEntry({ title: U.t('Hide sources with these words'), value: words.join(', '), placeholder: U.t('CAM, HDTS, TELESYNC'),
                hint: U.t('Words separated by commas, capitals or not. Sources with one go to the bottom and are never picked on their own. Leave it empty for none.'),
                validate: function () { return null; },
                onConfirm: function (v) { App.back(); Stremio.setHideWords(v); refeed('ranking', 'words', 'extra'); } });
        };
        return w;
    }
    // Size limits (Settings › Source ranking › Filters): smallest, largest and most per hour, for movies or
    // series; OK on the row: which one, then its value.
    var SIZE_CHOICES = {
        min: { label: U.t('Smallest'), none: U.t('None'), values: [0.1, 0.3, 0.5, 1, 2] },
        max: { label: U.t('Largest'), none: U.t('None'), values: [2, 4, 8, 15, 20, 30, 50, 80] },
        perHour: { label: U.t('Most per hour'), none: U.t('None'), values: [1, 1.5, 2, 3, 4, 6, 10], unit: ' ' + U.t('an hour') }
    };
    function sizeSummary(L) {
        var bits = [];
        if (L.min) { bits.push(U.t('at least {size}', { size: Stremio.gbText(L.min) })); }
        if (L.max) { bits.push(U.t('up to {size}', { size: Stremio.gbText(L.max) })); }
        if (L.perHour) { bits.push(U.t('up to {size} an hour', { size: Stremio.gbText(L.perHour) })); }
        return bits.length ? bits.join(', ') : U.t('No limits');
    }
    function sizeRow(kind, title) {
        var L = Stremio.getPrefs().sizeLimits[kind];
        var r = U.el('div', 'addon-item focusable cfg-row feed-extra');
        r.setAttribute('data-fk', 'size-' + kind); r.setAttribute('data-ctl', 'extra');
        r.appendChild(U.el('div', 'a-name', title + ':  ' + sizeSummary(L)));
        r.appendChild(U.el('div', 'a-url', U.t('Sources outside them go to the bottom (Outside your size limits) and are never picked on their own; a source without a size isn’t held to them   ·   OK to change')));
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
            if (!items.length) { wrap.appendChild(U.el('div', 'hint', kind === 'search' ? U.t('None of your addons can search.') : U.t('No feeds yet: add catalog addons in Settings › Content › Addons.'))); }
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
