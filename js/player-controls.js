/* Player, part 7 of 7 — the remote and what's on screen: keys, scrubbing, the quick-action
   bar, the menu, the skip prompt, stream info and picture mode.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';
    var S = P.S;
    var avplay = P.avplay, useAV = P.useAV;

    // ----- from the other parts -----
    function exit() { return P.exit.apply(null, arguments); }   // core
    function handleCredits() { return P.handleCredits.apply(null, arguments); }   // core
    function isPaused() { return P.isPaused.apply(null, arguments); }   // core
    function pause_() { return P.pause_.apply(null, arguments); }   // core
    function play_() { return P.play_.apply(null, arguments); }   // core
    function renderOSD() { return P.renderOSD.apply(null, arguments); }   // core
    function seekBy() { return P.seekBy.apply(null, arguments); }   // core
    function seekTo() { return P.seekTo.apply(null, arguments); }   // core
    function showOSD() { return P.showOSD.apply(null, arguments); }   // core
    function aspectDef() { return P.aspectDef.apply(null, arguments); }   // store
    function playerCfg() { return P.playerCfg.apply(null, arguments); }   // store
    function setPlayerCfg() { return P.setPlayerCfg.apply(null, arguments); }   // store
    function infoLang() { return P.infoLang.apply(null, arguments); }   // lang
    function trackInfo() { return P.trackInfo.apply(null, arguments); }   // lang
    function hasQualities() { return P.hasQualities.apply(null, arguments); }   // quality
    function qualityUnread() { return P.qualityUnread ? P.qualityUnread() : false; }   // quality
    function qualityCount() { return P.qualityCount.apply(null, arguments); }   // quality
    function qualityLabel() { return P.qualityLabel.apply(null, arguments); }   // quality
    function qualityMenu() { return P.qualityMenu.apply(null, arguments); }   // quality
    function switchSource() { return P.switchSource.apply(null, arguments); }   // quality
    function subConfigMenu() { return P.subConfigMenu.apply(null, arguments); }   // subs
    function langMenu() { return P.langMenu.apply(null, arguments); }   // subs
    function subtitleSummary() { return P.subtitleSummary.apply(null, arguments); }   // subs
    function audioMenu() { return P.audioMenu.apply(null, arguments); }   // audio
    function getAudioTracks() { return P.getAudioTracks.apply(null, arguments); }   // audio
    function hasYtLanguages() { return P.hasYtLanguages.apply(null, arguments); }   // quality
    function ytLanguageLabel() { return P.ytLanguageLabel.apply(null, arguments); }   // quality
    function ytLanguageMenu() { return P.ytLanguageMenu.apply(null, arguments); }   // quality
    function playLinked() { return P.playLinked.apply(null, arguments); }   // core
    function chapters() { return P.chapters.apply(null, arguments); }   // core
    function chapterAt() { return P.chapterAt.apply(null, arguments); }   // core
    function sponsorHighlight() { return P.sponsorHighlight.apply(null, arguments); }   // core

    // A list position moved past either end comes round to the other (the quick bar, the
    // menu, Cast & more).
    function wrap(i, n) { return n ? ((i % n) + n) % n : 0; }

    var _menuOpen = false;
    var _barOpen = false;
    var _barIdx = 0;
    var _skip = null;        // active skip prompt {type, buttons, idx, timer}
    var _segShown = {};      // which segment prompts already shown this playback

    function menuOpen() { return _menuOpen; }
    function scrubbing() { return !!_scrub; }
    function skipShown(type) { return !!_segShown[type]; }

    // A new playback: nothing open, no skip prompt shown yet.
    function resetControls() {
        _menuOpen = false; _barOpen = false; _segShown = {};
        if (_barTimer) { clearTimeout(_barTimer); _barTimer = null; }
        closeCast(true);
        resetYtLinks();
        endScrub();
        hideSkip();
        S.subMenuEl.className = 'hidden';
        S.barEl.className = 'hidden';
    }
    // Playback stopped: everything closed (without bringing the progress bar back up).
    function closeControls() {
        closeCast(true);
        resetYtLinks();
        endScrub();
        streamInfoOff();
        S.subMenuEl.className = 'hidden'; _menuOpen = false; _menuStack = [];
        S.barEl.className = 'hidden'; _barOpen = false;
        if (_barTimer) { clearTimeout(_barTimer); _barTimer = null; }
        hideSkip();
    }

    // ---------- skip prompt ----------
    function showSkip(type, seg) {
        _segShown[type] = true;
        var buttons = [];
        if (type === 'sb') {   // (SponsorBlock: "Skip Sponsor")
            buttons.push({ label: seg.label + '  ▸', run: function () { seekTo(seg.end); hideSkip(); } });
        } else if (type === 'intro' || type === 'recap' || type === 'preview') {
            var base = type === 'intro' ? 'Skip Intro' : type === 'recap' ? 'Skip Recap' : 'Skip Preview';
            buttons.push({ label: base, run: function () { if (seg.end != null) { seekTo(seg.end); } hideSkip(); } });
            // Skipping on its own (Settings › Playback › Skipping): a countdown in video time (it
            // waits while paused), and Cancel; see skipTick.
            var auto = autoSkipSecs();
            if (auto && seg.end != null) {
                buttons[0].label = base + ' · ' + auto;
                buttons.push({ label: 'Cancel', run: function () { hideSkip(); } });
                _skip = { type: type, buttons: buttons, idx: 0, timer: null, countdown: { secs: auto, from: S.cur, seg: seg, base: base } };
                renderSkip();
                return;
            }
        } else { // credits
            var goOn = function () {
                handleCredits();
                hideSkip();
                if (S.ctx.nextEpisode && S.ctx.playNext) { S.ctx.playNext(); } else { exit(); }
            };
            buttons.push({ label: S.ctx.nextEpisode ? 'Skip Credits → Next' : 'Skip Credits', run: goOn });
            buttons.push({ label: 'Watch Credits', run: function () { hideSkip(); } });
            // The next episode on its own (Settings › Playback › Skipping): a countdown in video
            // time, as the intro's; Watch Credits stays. Without a next episode: the prompt.
            var next = autoNextSecs();
            if (next && S.ctx.nextEpisode && S.ctx.playNext) {
                buttons[0].label = 'Next episode · ' + next;
                _skip = { type: type, buttons: buttons, idx: 0, timer: null, countdown: { secs: next, from: S.cur, base: 'Next episode', run: goOn } };
                renderSkip();
                return;
            }
        }
        _skip = { type: type, buttons: buttons, idx: 0, timer: null };
        renderSkip();
        // auto-hide after a few seconds
        _skip.timer = setTimeout(hideSkip, 9000);
    }

    function autoNextSecs() {
        try { return (typeof Stremio !== 'undefined' && Stremio.getPrefs) ? (+Stremio.getPrefs().autoNext || 0) : 0; } catch (e) { return 0; }
    }
    function autoSkipSecs() {
        try { return (typeof Stremio !== 'undefined' && Stremio.getPrefs) ? (+Stremio.getPrefs().autoSkip || 0) : 0; } catch (e) { return 0; }
    }
    // A skip counting down (each time update): at zero, to the segment's end; once the segment
    // is over (watched through, or a seek past it), nothing more to skip.
    function skipTick() {
        var cd = _skip && _skip.countdown;
        if (!cd) { return; }
        if (cd.seg && S.cur >= cd.seg.end) { hideSkip(); return; }
        var left = Math.ceil(cd.secs - (S.cur - cd.from) - 0.001);
        if (left <= 0) {
            if (cd.run) { cd.run(); return; }   // (the next episode)
            seekTo(cd.seg.end); hideSkip(); return;
        }
        var label = cd.base + ' · ' + left;
        if (_skip.buttons[0].label !== label) { _skip.buttons[0].label = label; renderSkip(); }
    }

    function renderSkip() {
        if (!_skip) { return; }
        U.clear(S.skipEl);
        _skip.buttons.forEach(function (b, i) {
            var node = U.el('div', 'skip-btn' + (i === _skip.idx ? ' sel' : ''), b.label);
            node.addEventListener('click', function () {
                if (_skip && _skip.buttons[i] && _skip.buttons[i].run) { _skip.buttons[i].run(); }
            }, false);
            S.skipEl.appendChild(node);
        });
        S.skipEl.className = '';
    }

    function hideSkip() {
        if (_skip && _skip.timer) { clearTimeout(_skip.timer); }
        _skip = null;
        if (S.skipEl) { S.skipEl.className = 'hidden'; U.clear(S.skipEl); }
    }

    function skipKey(action) {
        if (!_skip) { return; }
        if (action === 'OK') { var b = _skip.buttons[_skip.idx]; if (b && b.run) { b.run(); } return; }
        if (action === 'LEFT') { _skip.idx = Math.max(0, _skip.idx - 1); renderSkip(); return; }
        if (action === 'RIGHT') { _skip.idx = Math.min(_skip.buttons.length - 1, _skip.idx + 1); renderSkip(); return; }
        if (action === 'BACK') { hideSkip(); return; }
    }

    // ---------- play / pause ----------
    function togglePlay() {
        if (isPaused()) { play_(); } else { pause_(); }
        showOSD(false);
        if (_barOpen) { renderBar(); barIdle(); }
    }

    // ---------- scrubbing (LEFT/RIGHT, FF/REW) ----------
    // Presses move a landing marker on the progress bar instead of seeking right away;
    // playback continues until the presses stop for SCRUB_COMMIT_MS (or OK), then one
    // seek jumps there. BACK cancels. Holding a direction speeds up: the base step,
    // then 30 s steps after 10 presses, then 60 s after 30. Reversing starts over. A
    // YouTube video's chapter start within half a step (at most 15 s) is landed on instead:
    // scrubbing past one stops there (and the next press goes on from it).
    var SCRUB_COMMIT_MS = 800, SNAP_MAX = 15;
    function seekStep() { return playerCfg().seek; }   // (Settings › Playback › Seeking & buffering: 5 / 10 / 15 / 30 s)
    var _scrub = null;   // { target, from, dir, presses, timer }

    function scrub(delta) {
        if (S.isLive) { showOSD(false); U.toast('Live — seeking unavailable', 1500); return; }
        if (!_scrub) { _scrub = { target: S.cur, from: S.cur, dir: 0, presses: 0, timer: null }; }
        var dir = delta > 0 ? 1 : -1;
        if (dir !== _scrub.dir) { _scrub.dir = dir; _scrub.presses = 0; }
        _scrub.presses++;
        var step = Math.abs(delta);
        if (_scrub.presses > 30) { step = Math.max(step, 60); } else if (_scrub.presses > 10) { step = Math.max(step, 30); }
        var maxT = S.dur ? Math.max(0, S.dur - 2) : 1e9;
        _scrub.target = snapToChapter(Math.max(0, Math.min(maxT, _scrub.target + dir * step)), Math.min(step / 2, SNAP_MAX), maxT);
        renderScrub();
        showOSD(true);   // keep the bar up while scrubbing
        if (_scrub.timer) { clearTimeout(_scrub.timer); }
        _scrub.timer = setTimeout(commitScrub, SCRUB_COMMIT_MS);
    }
    function snapToChapter(t, within, maxT) {
        var best = t, gap = within + 1;
        chapters().forEach(function (c) {
            var g = Math.abs(c.t - t);
            if (g <= within && g < gap && c.t <= maxT) { best = c.t; gap = g; }
        });
        return best;
    }
    function endScrub() {
        if (!_scrub) { return null; }
        if (_scrub.timer) { clearTimeout(_scrub.timer); }
        var t = _scrub.target;
        _scrub = null;
        renderScrub();
        return t;
    }
    function commitScrub() {
        var t = endScrub();
        if (t !== null && S.active) { seekTo(t); }
    }
    function cancelScrub() {
        if (endScrub() === null) { return false; }
        renderOSD(); showOSD(false);
        return true;
    }
    function renderScrub() {
        var mark = U.byId('osd-scrub'), range = U.byId('osd-scrub-range'), tip = U.byId('osd-scrub-time');
        if (!mark || !range || !tip) { return; }
        if (!_scrub || !(S.dur > 0)) { mark.className = 'hidden'; range.className = 'hidden'; return; }
        var pT = _scrub.target / S.dur * 100, pC = Math.min(100, S.cur / S.dur * 100);
        mark.className = pT < 8 ? 'edge-l' : (pT > 92 ? 'edge-r' : '');
        mark.style.left = pT + '%';
        range.className = '';
        range.style.left = Math.min(pT, pC) + '%';
        range.style.width = Math.abs(pT - pC) + '%';
        var d = _scrub.target - _scrub.from;   // how far this scrub jumps
        var ci = chapterAt(_scrub.target), ch = ci >= 0 ? chapters()[ci].title : '';   // (the chapter it lands in)
        if (ch.length > 40) { ch = ch.slice(0, 39) + '…'; }
        tip.textContent = U.fmtTime(_scrub.target) + '   ' + (d < 0 ? '−' : '+') + U.fmtTime(Math.abs(d)) + (ch ? '   ·   ' + ch : '');
    }

    // ---------- in-player menu (stack of levels) ----------
    var _menuStack = [];

    function topMenu() { return _menuStack[_menuStack.length - 1]; }

    function openMenu(first) {   // (the menu, or one of its lists on its own: Chapters, from the bar)
        _menuOpen = true;
        _menuStack = [first || rootMenu()];
        renderMenu();
        S.subMenuEl.className = '';
        showOSD(true);
    }
    function closeMenu() {
        _menuOpen = false; _menuStack = [];
        S.subMenuEl.className = 'hidden';
        showOSD(false);
    }
    function pushMenu(desc) { _menuStack.push(desc); renderMenu(); }
    // Backing out to a level that depends on state (e.g. Subtitles, after picking a
    // track) rebuilds it, keeping the highlighted row.
    function popMenu() {
        _menuStack.pop();
        if (!_menuStack.length) { closeMenu(); return; }
        var top = topMenu();
        if (top.rebuild) {
            var fresh = top.rebuild();
            fresh.idx = Math.min(top.idx, fresh.items.length - 1);
            fresh.color = top.color;   // (opened by a colored key: still that one's)
            _menuStack[_menuStack.length - 1] = fresh;
        }
        renderMenu();
    }
    function replaceTop(desc) { _menuStack[_menuStack.length - 1] = desc; renderMenu(); }

    function renderMenu() {
        var m = topMenu();
        U.clear(S.subMenuEl);
        S.subMenuEl.style.width = m.wide ? '820px' : '';   // (sources: wider, each on three lines)
        S.subMenuEl.appendChild(U.el('div', 'sm-title', m.title));
        if (m.node) { S.subMenuEl.appendChild(m.node); }   // (Continue on phone: its QR)
        var list = U.el('div', 'sm-list');
        m.items.forEach(function (it, i) {
            var node = U.el('div', 'sm-item' + (m.wide ? ' sm-tall' : '') + (i === m.idx ? ' sel' : ''));
            node.appendChild(U.el('div', 'sm-main', it.label + (it.sel ? '  ✓' : '')));
            if (it.detail) { node.appendChild(U.el('div', 'sm-detail', it.detail)); }
            node.addEventListener('click', function () {
                if (topMenu() === m && m.items[i] && m.items[i].run) { m.items[i].run(); }
            }, false);
            list.appendChild(node);
        });
        S.subMenuEl.appendChild(list);
        var sel = list.children[m.idx];
        if (sel && sel.scrollIntoView) { try { sel.scrollIntoView(false); } catch (e) {} }
    }

    // ---------- contextual quick-action bar (UP) ----------
    function barButtons() {
        // Glyphs kept to the old Geometric-Shapes/Arrows blocks — the media-control
        // symbols (⏵ ⏸ ⏮ ⏭ ⤶) don't render on Tizen 3.0's fonts.
        var b = [{ label: isPaused() ? '▶ Play' : '‖ Pause', run: togglePlay }];
        if (!S.isLive) { b.push({ label: '↺ Restart', run: function () { seekTo(0); closeBar(); } }); }
        if (chapters().length) { b.push({ label: '≡ Chapters', run: function () { closeBar(); openMenu(chaptersMenu()); } }); }
        var hl = sponsorHighlight();
        if (hl !== null && !S.isLive) { b.push({ label: '◆ Highlight', run: function () { closeBar(); seekTo(hl); } }); }
        if (S.ctx.hasPrev) { b.push({ label: '◀◀ Previous', run: function () { closeBar(); S.ctx.playPrev(); } }); }
        if (S.ctx.hasNext) { b.push({ label: '▶▶ Next', run: function () { closeBar(); S.ctx.playNext(); } }); }
        if (castTitle()) { b.push({ label: 'ⓘ Cast & more', run: function () { closeBar(); openCast(); } }); }
        // continue on phone (its QR, in the menu's panel), and private viewing from now on
        if (phoneLink()) { b.push({ label: '▣ Phone', run: function () { closeBar(); openMenu(phoneMenu()); } }); }
        if (canDownload()) { b.push({ label: '⬇ Download', run: function () { closeBar(); downloadPlaying(); } }); }
        if (!S.ctx.trailer && !S.isLive) {
            var priv = !!S.ctx.private;
            b.push({ label: '◐ Private: ' + (priv ? 'On' : 'Off'), run: function () {
                P.setPrivate(!priv);
                U.toast(!priv ? 'Private viewing: not tracked from now on' : 'Private viewing off: tracked again', 2500);
                closeBar();
            } });
        }
        b.push({ label: '← Back', run: function () { exit(); } });   // stop playback, return to the previous page
        return b;
    }
    // The bar closes by itself after BAR_IDLE_MS without a key on it (Cast & more doesn't).
    var BAR_IDLE_MS = 5000, _barTimer = null;
    function barIdle() {
        if (_barTimer) { clearTimeout(_barTimer); }
        _barTimer = setTimeout(function () { _barTimer = null; if (_barOpen) { closeBar(); } }, BAR_IDLE_MS);
    }
    function openBar() {
        _barOpen = true; _barIdx = 0;
        renderBar();
        showOSD(true);
        barIdle();
    }
    function closeBar() {
        if (_barTimer) { clearTimeout(_barTimer); _barTimer = null; }
        _barOpen = false;
        S.barEl.className = 'hidden';
        showOSD(false);
    }
    function renderBar() {
        var b = barButtons();
        if (_barIdx >= b.length) { _barIdx = b.length - 1; }
        U.clear(S.barEl);
        b.forEach(function (it, i) {
            var node = U.el('div', 'pb-btn' + (i === _barIdx ? ' sel' : ''), it.label);
            node.addEventListener('click', function () { if (S.active && it.run) { it.run(); } }, false);
            S.barEl.appendChild(node);
        });
        S.barEl.className = '';
    }
    function barKey(action) {
        var b = barButtons();
        barIdle();   // (a key on it: another 5 s)
        if (action === 'LEFT' || action === 'RIGHT') { _barIdx = wrap(_barIdx + (action === 'LEFT' ? -1 : 1), b.length); renderBar(); return; }   // (past either end: round to the other)
        if (action === 'OK') { var it = b[_barIdx]; if (it && it.run) { it.run(); } return; }
        if (action === 'UP' || action === 'BACK') { closeBar(); return; }
        if (action === 'DOWN') { closeBar(); openMenu(); return; }
    }

    // ---------- cast & more (quick bar) ----------
    // Who's in what's playing (TMDB, with a key in Settings › Content › Integrations; for an
    // episode, that episode's), on a see-through strip over the video, which keeps playing. Levels, one at a time: a
    // title's cast & more -> OK on a person: their movies and series (best known first) -> OK on one: its cast
    // & crew -> … BACK goes up a level (from the first, closes it); UP / DOWN close it.
    // LEFT / RIGHT look through a level (round past either end); each level keeps its place.
    var _cast = null;        // { el, head, strip, levels: [level] } while it's open
    // level: { kind: 'cast' | 'works', name, load: fn -> Promise of items, items (null while
    // loading), note, idx }
    var CAST_W = 196;        // a card and the gap after it (px)
    var CAST_DEPTH = 30;     // levels kept (the oldest go first)
    function castTitle() {
        var c = S.ctx, id = c && (c.parent || c.id);
        if (!c || S.isLive || (c.type !== 'movie' && c.type !== 'series') || !/^tt\d+$/.test('' + (id || ''))) { return null; }
        if (typeof Stremio === 'undefined' || !Stremio.hasTmdb || !Stremio.hasTmdb() || !Stremio.tmdbTitleExtras) { return null; }
        var ep = c.type === 'series' ? ('' + (c.id || '')).match(/^tt\d+:(\d+):(\d+)$/) : null;   // watching an episode
        return { type: c.type, id: id, season: ep ? +ep[1] : null, episode: ep ? +ep[2] : null };
    }
    function castLevel(name, load) { return { kind: 'cast', name: name, load: load, items: null, note: '', idx: 0 }; }
    function openCast() {
        var t = castTitle();
        if (!t) { return; }
        var el = U.byId('cast-strip');
        if (!el) { el = U.el('div', 'hidden'); el.id = 'cast-strip'; document.body.appendChild(el); }
        U.clear(el);
        var head = U.el('div', 'cs-head');
        var strip = U.el('div', 'cs-strip');
        el.appendChild(head);
        el.appendChild(strip);
        el.className = '';
        _cast = { el: el, head: head, strip: strip, levels: [] };
        // an episode: its own cast & more (guest stars, its director and writers); else the title's
        var name = '' + (S.ctx.name || '');
        pushCast(castLevel(name, t.episode !== null && Stremio.tmdbEpisodeCast
            ? function () { return Stremio.tmdbEpisodeCast(t.id, t.season, t.episode); }
            : function () { return Stremio.tmdbTitleExtras(t.type, t.id).then(castOf); }));
        showOSD(true);
    }
    function castOf(x) { return (x && x.cast) || []; }
    // A person's movies and series together, the most rated on TMDB first (what they're
    // known for; see Stremio.tmdbPerson).
    function worksOf(p) {
        var all = ((p && p.movies) || []).concat((p && p.series) || []);
        all.sort(function (a, b) { return ((b.votes || 0) - (a.votes || 0)) || ((b.popularity || 0) - (a.popularity || 0)) || ((b.year || '') > (a.year || '') ? 1 : (b.year || '') < (a.year || '') ? -1 : 0); });
        return all;
    }
    function pushCast(level) {
        var me = _cast;
        me.levels.push(level);
        if (me.levels.length > CAST_DEPTH) { me.levels.shift(); }
        drawCast();
        level.load().then(function (items) {
            level.items = items || [];
            if (!level.items.length) { level.note = level.kind === 'cast' ? 'TMDB has no cast for this title.' : 'TMDB has no movies or series for them.'; }
            if (_cast === me && topCast() === level) { drawCast(); }
        }, function () {
            level.items = []; level.note = 'Couldn\'t reach TMDB.';
            if (_cast === me && topCast() === level) { drawCast(); }
        });
    }
    function topCast() { return _cast ? _cast.levels[_cast.levels.length - 1] : null; }
    function castCard(level, it) {
        var card = U.el('div', 'cs-card');
        var pic = U.cardImage(level.kind === 'cast' ? it.photo : it.poster, level.kind === 'cast' ? 'cast' : 'poster');
        if (pic) {
            var img = U.el('img', 'cs-photo');
            img.onerror = function () { img.style.visibility = 'hidden'; };
            card.appendChild(img);
            U.deferImage(img, pic);
        } else {
            card.appendChild(U.el('div', 'cs-photo cs-none', (it.name || '?').charAt(0)));
        }
        card.appendChild(U.el('div', 'cs-name', it.name || ''));
        var sub = level.kind === 'cast' ? (it.character || '') : [it.kind === 'tv' ? 'Series' : 'Movie', it.year].filter(Boolean).join(' · ');
        if (sub) { card.appendChild(U.el('div', 'cs-role', sub)); }
        return card;
    }
    // The whole level: where you are (the path, its last three steps), what OK / BACK do, the strip.
    function drawCast() {
        var lv = topCast();
        if (!lv) { return; }
        U.clear(_cast.head);
        var path = _cast.levels.map(function (l) { return l.name + (l.kind === 'cast' ? '  ·  cast & more' : '  ·  movies & series'); });
        _cast.head.appendChild(U.el('div', 'cs-title', (path.length > 3 ? '…  ›  ' : '') + path.slice(-3).join('   ›   ')));
        var deeper = lv.kind === 'cast' ? 'OK: their movies & series' : 'OK: its cast & more     Hold OK: more';
        _cast.head.appendChild(U.el('div', 'cs-hint', deeper + '     BACK: ' + (_cast.levels.length > 1 ? 'up a level' : 'close')));
        U.clear(_cast.strip);
        _cast.strip.style.marginLeft = '0px';
        if (!lv.items) { _cast.strip.appendChild(U.el('div', 'cs-note', 'Loading…')); return; }
        if (!lv.items.length) { _cast.strip.appendChild(U.el('div', 'cs-note', lv.note)); return; }
        lv.items.forEach(function (it) { _cast.strip.appendChild(castCard(lv, it)); });
        renderCast();
    }
    function renderCast() {
        var lv = topCast();
        if (!lv || !lv.items) { return; }
        var cards = _cast.strip.children, n = lv.items.length;
        for (var i = 0; i < cards.length; i++) { cards[i].className = 'cs-card' + (i === lv.idx ? ' sel' : ''); }
        // keep the selected card in view (1800 px wide): centered, not past either end
        var view = 1800, total = n * CAST_W;
        var off = Math.max(0, Math.min(total - view, lv.idx * CAST_W - (view - CAST_W) / 2));
        _cast.strip.style.marginLeft = (total > view ? -Math.round(off) : 0) + 'px';
    }
    // A movie or series in Cast & more, held OK: the poster menu (view-core's titleActions) in the
    // player's own menu, on the title by its IMDb id. Continue Watching and watched marks right
    // away (playing on); Details stops playing (its place kept) and opens its page.
    function castTitleMenu(it) {
        var V = typeof ViewParts !== 'undefined' ? ViewParts : null;
        if (!V || !V.titleActions || !Stremio.tmdbImdbId) { return; }
        var type = it.kind === 'tv' ? 'series' : 'movie', name = it.name || '', me = _cast;
        Stremio.tmdbImdbId(it.kind, it.tmdbId).then(function (imdb) {
            if (!imdb) { U.toast('“' + name + '” has no IMDb id, so the addons can\'t open it.', 3500); return null; }
            var meta = { id: imdb, type: type, name: name, poster: it.poster };
            return V.titleActions(meta, type).then(function (act) {
                if (_cast !== me || !S.active) { return; }   // (the strip closed, or playback ended, meanwhile)
                // (Details last: the one that stops what's playing)
                var opts = act.items.filter(function (o) { return o[0] !== 'details'; }).concat(act.items.filter(function (o) { return o[0] === 'details'; }));
                openMenu({ title: name, idx: 0, items: opts.map(function (o) {
                    return { label: o[0] === 'details' ? 'Details (stops playing)' : o[1], run: function () {
                        closeMenu();
                        if (o[0] === 'details') { exit(); App.openDetail(type, imdb, meta); return; }
                        act.run(o[0]);
                    } };
                }) });
            });
        }, function () { U.toast('Couldn\'t reach TMDB.'); });
    }
    function closeCast(quiet) {   // quiet: playback is stopping (the progress bar stays down)
        if (!_cast) { return; }
        _cast.el.className = 'hidden';
        U.clear(_cast.el);
        _cast = null;
        if (!quiet) { showOSD(false); }
    }
    function castKey(action) {
        var lv = topCast(), n = lv && lv.items ? lv.items.length : 0;
        if (action === 'LEFT' || action === 'RIGHT') {
            if (n) { lv.idx = wrap(lv.idx + (action === 'LEFT' ? -1 : 1), n); renderCast(); showOSD(true); }   // (round past either end)
            return;
        }
        if (action === 'OK_LONG') {   // a movie or series: the menu any poster has, over the video
            if (n && lv.kind !== 'cast') { castTitleMenu(lv.items[lv.idx]); }
            return;
        }
        if (action === 'OK') {
            if (!n) { return; }
            var it = lv.items[lv.idx];
            if (lv.kind === 'cast') {
                pushCast({ kind: 'works', name: it.name || '', items: null, note: '', idx: 0,
                    load: function () { return Stremio.tmdbPerson(it.id).then(worksOf); } });
            } else {
                pushCast(castLevel(it.name + (it.year ? ' (' + it.year + ')' : ''),
                    function () { return Stremio.tmdbExtrasById(it.kind, it.tmdbId).then(castOf); }));
            }
            showOSD(true);
            return;
        }
        if (action === 'BACK' && _cast.levels.length > 1) {   // up a level, where you were on it
            _cast.levels.pop();
            drawCast();
            showOSD(true);
            return;
        }
        closeCast();
    }

    // ---------- a YouTube video's links: end screen and cards ----------
    // From the service (S.ytInfo.links). At the end-screen time a strip shows the videos the
    // creator links to ("Up next on YouTube"), over the video, which keeps playing: UP to
    // choose (LEFT / RIGHT, OK plays it, BACK / UP / DOWN back), BACK hides it. A card is a
    // note in the corner for 8 s ("UP to watch"). A video opened from either plays in this
    // one's place (playLinked); stopping it goes back where this one was opened from.
    var _yl = null;          // the end-screen strip: { el, items, idx, active }
    var _ylHidden = false;   // hidden with BACK (this video)
    var _card = null;        // the card note: { el, link, timer }
    var _cardsShown = {};
    function resetYtLinks() {
        hideEnd(); hideCard();
        _ylHidden = false; _cardsShown = {};
    }
    function ytLinks(kind) { return ((S.ytInfo && S.ytInfo.links) || []).filter(function (l) { return l.kind === kind; }); }
    function ytLinksTick() {
        if (!S.active || S.isLive || !S.ytInfo) { return; }
        var ms = S.cur * 1000;
        ytLinks('card').forEach(function (l) {
            var k = l.id + '@' + l.startMs;
            if (!_cardsShown[k] && ms >= l.startMs && ms < l.startMs + 8000) { _cardsShown[k] = true; showCard(l); }
        });
        var ends = ytLinks('end');
        if (!ends.length) { return; }
        var from = Math.min.apply(null, ends.map(function (l) { return l.startMs; }));
        if (ms < from - 1000) { if (_yl && !_yl.active) { hideEnd(); } return; }   // (gone back before it: again when it comes)
        if (!_yl && !_ylHidden) { showEnd(ends); }
    }
    function linkCard(l) {
        var card = U.el('div', 'yl-card');
        var img = U.el('img', 'yl-thumb');
        img.onerror = function () { img.style.visibility = 'hidden'; };
        card.appendChild(img);
        U.deferImage(img, 'https://i.ytimg.com/vi/' + l.id + '/mqdefault.jpg');
        card.appendChild(U.el('div', 'yl-title', l.title || 'YouTube video'));
        return card;
    }
    function showEnd(items) {
        var el = U.byId('yt-links');
        if (!el) { el = U.el('div', 'hidden'); el.id = 'yt-links'; document.body.appendChild(el); }
        U.clear(el);
        var head = U.el('div', 'yl-head');
        head.appendChild(U.el('div', 'yl-heading', 'Up next on YouTube'));
        head.appendChild(U.el('div', 'yl-hint', 'UP: choose     BACK: hide'));
        el.appendChild(head);
        var row = U.el('div', 'yl-row');
        items.forEach(function (l) { row.appendChild(linkCard(l)); });
        el.appendChild(row);
        el.className = '';
        _yl = { el: el, row: row, head: head, items: items, idx: 0, active: false };
    }
    function renderEnd() {
        if (!_yl) { return; }
        var cards = _yl.row.children;
        for (var i = 0; i < cards.length; i++) { cards[i].className = 'yl-card' + (_yl.active && i === _yl.idx ? ' sel' : ''); }
        _yl.head.children[1].textContent = _yl.active ? 'OK: play     BACK: back' : 'UP: choose     BACK: hide';
    }
    function hideEnd() {
        if (!_yl) { return; }
        _yl.el.className = 'hidden';
        U.clear(_yl.el);
        _yl = null;
    }
    function showCard(l) {
        hideCard();
        var el = U.byId('yt-card');
        if (!el) { el = U.el('div', 'hidden'); el.id = 'yt-card'; document.body.appendChild(el); }
        U.clear(el);
        el.appendChild(U.el('div', 'yc-teaser', 'ⓘ  ' + (l.teaser || 'Watch')));
        el.appendChild(U.el('div', 'yc-title', l.title || ''));
        el.appendChild(U.el('div', 'yc-hint', 'UP: watch'));
        el.className = '';
        var me = _card = { el: el, link: l, timer: setTimeout(function () { if (_card === me) { hideCard(); } }, 8000) };
    }
    function hideCard() {
        if (!_card) { return; }
        clearTimeout(_card.timer);
        _card.el.className = 'hidden';
        _card = null;
    }
    // Keys while one is up (none of the menus open). Returns true when it took the key.
    function ytLinksKey(action) {
        if (_yl && _yl.active) {
            var n = _yl.items.length;
            if (action === 'LEFT' || action === 'RIGHT') { _yl.idx = wrap(_yl.idx + (action === 'LEFT' ? -1 : 1), n); renderEnd(); return true; }
            if (action === 'OK') { var l = _yl.items[_yl.idx]; hideEnd(); playLinked(l); return true; }
            if (action === 'BACK' || action === 'UP' || action === 'DOWN') { _yl.active = false; renderEnd(); showOSD(false); return true; }
            return false;
        }
        if (_yl && action === 'UP') { _yl.active = true; _yl.idx = 0; renderEnd(); showOSD(true); return true; }
        if (_yl && action === 'BACK') { hideEnd(); _ylHidden = true; return true; }
        if (_card && action === 'UP') { var c = _card.link; hideCard(); playLinked(c); return true; }
        return false;
    }

    function rootMenu() {
        // Order per spec: Subtitles, Audio Track, Select Source, Playback
        var items = [];
        items.push({ label: 'Subtitles', run: function () { pushMenu(subConfigMenu()); } });
        if (getAudioTracks().length > 1) {
            items.push({ label: 'Audio track', run: function () { pushMenu(audioMenu()); } });
        }
        if (hasYtLanguages()) {   // (a YouTube video with dubs: each is a stream of its own)
            items.push({ label: 'Audio language', detail: ytLanguageLabel(), run: function () { pushMenu(ytLanguageMenu()); } });
        }
        if (S.ctx.streams && S.ctx.streams.length) {
            items.push({ label: 'Select source', run: function () { pushMenu(sourceMenu()); } });
        }
        if (hasQualities()) {
            items.push({ label: 'Video quality', detail: qualityLabel(), run: function () { pushMenu(qualityMenu()); } });
        } else if (qualityUnread()) {
            items.push({ label: 'Video quality', detail: 'Auto: this stream’s qualities couldn’t be read', run: function () { U.toast('This stream’s qualities couldn’t be read: it plays on Auto', 4000); } });
        }
        if (chapters().length) {
            var ci = chapterAt(S.cur);
            items.push({ label: 'Chapters', detail: ci >= 0 ? chapters()[ci].title : '', run: function () { pushMenu(chaptersMenu()); } });
        }
        if (!S.isLive) {
            items.push({ label: 'Playback', run: function () { pushMenu(playbackMenu()); } });
        }
        items.push({ label: 'Picture', detail: aspectDef(P.aspectNow())[1].split(' (')[0], run: function () { pushMenu(pictureMenu()); } });
        if (P.liveFormat()) { items.push({ label: 'Format', detail: P.liveFormat() === 'hls' ? 'HLS' : 'MPEG-TS', run: function () { pushMenu(formatMenu()); } }); }
        items.push({ label: streamInfoOn() ? 'Hide stream info' : 'Stream info', run: function () { toggleStreamInfo(); closeMenu(); } });
        items.push({ label: 'Reload', detail: S.isLive ? 'Open the channel again' : 'Open it again, where it is', run: function () { closeMenu(); P.reload(); } });
        items.push({ label: 'Sleep timer', detail: sleepLeft(), run: function () { pushMenu(sleepMenu()); } });
        return { title: 'Menu', items: items, idx: 0 };
    }

    // ---- Sleep timer: playback stops after 30, 60 or 90 minutes (said, then the player closes);
    // for this playback session, cleared when the player closes ----
    var SLEEP_MINUTES = [30, 60, 90], _sleep = null;   // { at, timer }
    function sleepLeft() {
        if (!_sleep) { return 'Off'; }
        return Math.max(1, Math.ceil((_sleep.at - Date.now()) / 60000)) + ' min left';
    }
    function sleepClear() { if (_sleep) { clearTimeout(_sleep.timer); _sleep = null; } }
    function sleepSet(min) {
        sleepClear();
        if (!min) { return; }
        var at = Date.now() + min * 60000;
        _sleep = { at: at, timer: setTimeout(function () {
            _sleep = null;
            if (!S.active) { return; }
            U.toast('Sleep timer: playback stopped', 5000);
            exit();
        }, min * 60000) };
    }
    function sleepMenu() {
        var items = [{ label: 'Off', sel: !_sleep, run: function () { sleepSet(0); closeMenu(); U.toast('Sleep timer off', 2000); } }];
        SLEEP_MINUTES.forEach(function (m) {
            items.push({ label: m + ' minutes', run: function () { sleepSet(m); closeMenu(); U.toast('Sleep timer: playback stops in ' + m + ' minutes', 3000); } });
        });
        return { title: 'Sleep timer', items: items, idx: 0 };
    }
    P.sleepClear = sleepClear;

    // Continue on phone: the link playing, or '' (a file on a USB drive: no link to give)…
    function streamLink() {
        var c = S.ctx;
        if (!c) { return ''; }
        if (c.yt) { return ('' + c.yt).replace(/[&?]t=\d+s?/, '') + (S.cur > 5 ? '&t=' + Math.floor(S.cur) + 's' : ''); }   // (its page, at the minute you're at)
        var u = '' + (c.url || '');
        return /^https?:\/\//i.test(u) ? u : '';
    }
    // …as the QR opens it: in VLC or Infuse (a phone's browser downloads a file it can't play,
    // an MKV, HEVC, surround sound), or the direct link; a YouTube video's page as it is (the
    // YouTube app opens it).
    var PHONE_APPS = [['vlc', 'VLC'], ['infuse', 'Infuse'], ['link', 'Direct link']];
    function phoneLink() {
        var u = streamLink(), app = playerCfg().phone;
        if (!u || S.ctx.yt || app === 'link') { return u; }
        return app === 'infuse' ? 'infuse://x-callback-url/play?url=' + encodeURIComponent(u) : 'vlc://' + u;
    }
    // ...its QR, with what it gives away (anyone who scans it can play it; a debrid link carries
    // your account's access); the QR library is loaded the first time.
    function phoneMenu() {
        var link = phoneLink(), box = U.el('div', 'phone-qr'), spot = U.el('div', 'phone-qr-spot');
        box.appendChild(spot);
        var host = (streamLink().match(/^https?:\/\/([^\/?#]+)/i) || [])[1] || '';
        box.appendChild(U.el('div', 'sm-detail', 'Scan it with your phone to open the link there (' + host + ')' + (S.ctx.yt || S.isLive ? '.' : ': it starts from the beginning; you\'re at ' + U.fmtTime(S.cur) + '.')));
        box.appendChild(U.el('div', 'sm-detail', 'Anyone who scans it can play it; a debrid link carries your account’s access.' + (S.ctx._headers ? ' This channel needs its own player settings, so it may not open elsewhere.' : '')));
        (typeof qrcode !== 'undefined' ? Promise.resolve() : U.loadScript('js/qrcode.js')).then(function () {
            var cv = U.qrCanvas(link, 0, { level: 'L', quiet: 2, fit: 200 });   // (small: about 200 px)
            if (cv) { spot.appendChild(cv); } else { spot.appendChild(U.el('div', 'sm-detail', link)); }
        }, function () { spot.appendChild(U.el('div', 'sm-detail', link)); });
        var items = S.ctx.yt ? [] : PHONE_APPS.map(function (a) {
            return { label: a[1], sel: playerCfg().phone === a[0], run: function () { setPlayerCfg({ phone: a[0] }); replaceTop(phoneMenu()); } };
        });
        items.push({ label: 'Close', run: function () { closeMenu(); } });
        var at = 0;
        items.forEach(function (it, i) { if (it.sel) { at = i; } });
        return { title: 'Continue on phone', idx: at, wide: true, node: box, items: items };
    }

    // ⬇ Download: the source playing to a USB drive (js/downloads.js), with the subtitle that's
    // on; its questions (which drive, then what and where) in this menu, the video playing on.
    function canDownload() {
        var c = S.ctx, st = c && c.stream;
        return !!(st && c.downloadAs && !S.isLive && !c.trailer && !c.yt && !c.localFile && !st._localFile && !st._yt && /^https?:\/\//i.test(st.url || '') &&
            (typeof Downloads === 'undefined' || !Downloads.isFileLink || Downloads.isFileLink(st)) &&
            typeof Downloads !== 'undefined' && Downloads.available());
    }
    function downloadPlaying() {
        var t = {}, as = S.ctx.downloadAs, sub = P.activeSub ? P.activeSub() : null;
        Object.keys(as).forEach(function (k) { t[k] = as[k]; });
        t.sub = sub ? (sub.url ? { url: sub.url, lang: sub.lang, name: P.langName(sub.lang) } : sub) : null;
        function show(desc) { if (_menuOpen) { replaceTop(desc); } else { openMenu(desc); } }
        Downloads.start(S.ctx.stream, t, {
            pick: function (title, options, fn) {
                show({ title: title, idx: 0, items: options.map(function (o) { return { label: o[1], run: function () { fn(o[0]); } }; })
                    .concat([{ label: 'Cancel', run: function () { closeMenu(); } }]) });
            },
            confirm: function (msg, ok, fn) {
                show({ title: 'Download to USB drive', idx: 0, wide: true, node: U.el('div', 'sm-detail', msg),
                    items: [{ label: ok, run: function () { closeMenu(); fn(); } }, { label: 'Cancel', run: function () { closeMenu(); } }] });
            }
        });
    }

    // A YouTube video's chapters: OK on one goes to its start.
    function chaptersMenu() {
        var cur = chapterAt(S.cur);
        var items = chapters().map(function (c, i) {
            return { label: c.title || 'Chapter ' + (i + 1), detail: U.fmtTime(c.t), sel: i === cur,
                run: function () { closeMenu(); seekTo(c.t); } };
        });
        return { title: 'Chapters', items: items, idx: Math.max(0, cur) };
    }

    // ---------- picture mode ----------
    // Apply the saved mode (a live channel's own, else the usual one: player-store's aspectNow); a
    // mode this TV rejects falls back to Fit (quiet = at stream start).
    function applyAspect(quiet) {
        var a = aspectDef(P.aspectNow());
        if (!useAV) { if (S.videoEl) { S.videoEl.style.objectFit = a[3]; } return true; }
        try { avplay.setDisplayMethod(a[2]); return true; } catch (e) {
            try { avplay.setDisplayMethod(aspectDef('fit')[2]); } catch (e2) {}
            if (!quiet) { U.toast(a[1].split(' (')[0] + ' isn\'t available on this TV', 2500); }
            return false;
        }
    }
    function pictureMenu() {
        var cur = P.aspectNow(), idx = 0;
        var items = P.ASPECTS.map(function (a, i) {
            if (a[0] === cur) { idx = i; }
            return { label: a[1], sel: a[0] === cur, run: function () {
                var prev = P.aspectNow();
                P.setAspectNow(a[0]);
                if (!applyAspect(false)) { P.setAspectNow(prev === a[0] ? 'fit' : prev); applyAspect(true); }
                replaceTop(pictureMenu());
            } };
        });
        return { title: S.isLive && S.ctx && S.ctx.id ? 'Picture (this channel)' : 'Picture', items: items, idx: idx };
    }

    // An Xtream channel's format (player-core's setLiveFormat): it opens again the other way.
    function formatMenu() {
        var now = P.liveFormat();
        var items = [['ts', 'MPEG-TS'], ['hls', 'HLS']].map(function (f) {
            return { label: f[1], sel: f[0] === now, run: function () { closeMenu(); if (f[0] !== now) { P.setLiveFormat(f[0]); } } };
        });
        return { title: 'Format (this channel)', items: items, idx: now === 'hls' ? 1 : 0 };
    }

    // ---------- stream info overlay ----------
    // Player menu → Stream info: what's actually playing, refreshed every 2 s.
    var _infoTimer = null;
    function streamInfoOn() { return !!_infoTimer; }
    function toggleStreamInfo() {
        var el = U.byId('stream-info');
        if (!el) { return; }
        if (_infoTimer) { clearInterval(_infoTimer); _infoTimer = null; el.className = 'hidden'; return; }
        el.className = '';
        renderStreamInfo();
        _infoTimer = setInterval(renderStreamInfo, 2000);
    }
    function streamInfoOff() {
        if (_infoTimer) { clearInterval(_infoTimer); _infoTimer = null; }
        var el = U.byId('stream-info');
        if (el) { el.className = 'hidden'; }
    }
    // The source playing (an addon's): its addon, name, file, size, the addon's description on one
    // line, and what it is in short (Stremio.formatTags, the player's own where it says).
    function sourceLines(lines) {
        var st = S.ctx.stream;
        if (st && typeof Stremio !== 'undefined') {
            var bh = st.behaviorHints || {}, path = ('' + (st.url || '')).split(/[?#]/)[0], file = bh.filename || '';
            if (!file && /\.(mkv|mp4|m4v|avi|ts|webm|mov)$/i.test(path)) { try { file = decodeURIComponent(path.split('/').pop()); } catch (e) { file = path.split('/').pop(); } }
            var name = (Stremio.streamName ? Stremio.streamName(st) : st.name || '').replace(/\s+/g, ' ').trim();
            lines.push(['Source', [st._addon, name].filter(Boolean).join('  ·  ') || '—']);
            if (file) { lines.push(['File', file]); }
            var size = Stremio.streamSize ? Stremio.streamSize(st) : '';
            if (size) { lines.push(['Size', size]); }
            var desc = (Stremio.streamDescription ? Stremio.streamDescription(st) : '').replace(/\s*\n\s*/g, '  ·  ').replace(/\s+/g, ' ').trim();
            if (desc) { lines.push(['Details', desc.length > 170 ? desc.slice(0, 167) + '…' : desc]); }
        }
        var info = S.ctx.formatInfo || (typeof Stremio !== 'undefined' && Stremio.streamInfo ? Stremio.streamInfo({ url: S.ctx.url, name: S.ctx.name }) : null);
        var tags = (info && Stremio.formatTags) ? Stremio.formatTags(info, S.actual) : '';
        if (tags) { lines.push(['Format', tags]); }
    }
    // How it reaches the player (no link): straight from its server, or through StremioK's service.
    function howItPlays() {
        var c = S.ctx;
        if (c.yt) { return 'Through YouTube’s service (on the TV)'; }
        if (c._relay) { return 'Through StremioK’s service: the sound repacked'; }
        if (c.localFile) { return /^http:\/\/localhost/.test(typeof LocalMedia !== 'undefined' && LocalMedia.openUrl ? LocalMedia.openUrl(c.url, c.localFile.size) : '') ? 'From the USB drive, through StremioK’s service (over 2 GB)' : 'From the USB drive'; }
        return 'Straight from the server';
    }
    function renderStreamInfo() {
        var el = U.byId('stream-info');
        if (!el || !S.ctx) { return; }
        var lines = [], video = null, audio = null;
        sourceLines(lines);
        if (useAV) {
            try {
                var now = avplay.getCurrentStreamInfo() || [];
                for (var i = 0; i < now.length; i++) {
                    var t = ('' + now[i].type).toUpperCase();
                    if (t === 'VIDEO') { video = trackInfo(now[i]); } else if (t === 'AUDIO') { audio = trackInfo(now[i]); }
                }
            } catch (e) {}
        } else if (S.videoEl && S.videoEl.videoWidth) {
            video = { Width: S.videoEl.videoWidth, Height: S.videoEl.videoHeight };
        }
        if (video) {
            var w = video.Width || video.width, h = video.Height || video.height;
            lines.push(['Video', [w && h ? w + '×' + h : '', video.fourCC || video.codec || ''].filter(Boolean).join('  ·  ') || '—']);
        }
        if (audio) {
            lines.push(['Audio', [infoLang(audio), audio.channels ? audio.channels + 'ch' : '', audio.fourCC || audio.codec || '']
                .filter(function (x) { return x && x !== 'und'; }).join('  ·  ') || '—']);
        }
        lines.push(['Subtitles', subtitleSummary()]);
        if (hasQualities()) { lines.push(['Quality', qualityLabel() + '  (' + qualityCount() + ' available)']); }
        else if (qualityUnread()) { lines.push(['Quality', 'Auto (this stream’s qualities couldn’t be read)']); }
        if (useAV) {
            try {
                var bw = +avplay.getStreamingProperty('CURRENT_BANDWIDTH');
                if (bw > 0) { lines.push(['Bandwidth', (bw / 1e6).toFixed(1) + ' Mbps']); }
            } catch (e2) {}
        }
        var host = (('' + (S.ctx.url || '')).match(/^https?:\/\/([^\/:?#]+)/) || [])[1];
        if (host) { lines.push(['Server', host === 'localhost' ? 'YouTube (built-in service)' : host]); }
        lines.push(['Plays', howItPlays()]);
        var buf = playerCfg().buffer;
        if (buf && buf !== 'normal') { lines.push(['Buffer', buf === 'most' ? 'Most' : 'More']); }
        lines.push(['Position', S.isLive ? 'Live' : U.fmtTime(S.cur) + ' / ' + U.fmtTime(S.dur)]);
        U.clear(el);
        lines.forEach(function (l) {
            var row = U.el('div', 'si-row');
            row.appendChild(U.el('span', 'si-k', l[0]));
            row.appendChild(U.el('span', 'si-v', l[1]));
            el.appendChild(row);
        });
    }

    function playbackMenu() {
        return { title: 'Playback', idx: 0, items: [
            { label: 'Restart', run: function () { seekTo(0); closeMenu(); } },
            { label: 'Rewind 10′', run: function () { seekBy(-600); closeMenu(); } },
            { label: 'Rewind 5′', run: function () { seekBy(-300); closeMenu(); } },
            { label: 'Forward 5′', run: function () { seekBy(300); closeMenu(); } },
            { label: 'Forward 10′', run: function () { seekBy(600); closeMenu(); } }
        ] };
    }

    function sourceMenu() {
        var idx = 0;
        var now = JSON.stringify(U.sanitizeHeaders(S.ctx._headers));
        var items = S.ctx.streams.map(function (s, i) {
            var sel = s.url === S.ctx.url && JSON.stringify(U.sanitizeHeaders(s.headers)) === now;
            if (sel) { idx = i; }
            return { label: s.label || 'Source', detail: s.detail || '', sel: sel,
                run: function () { switchSource(s); closeMenu(); } };
        });
        return { title: 'Select source', items: items, idx: idx, wide: true };
    }

    // ---------- the colored keys ----------
    // Red: the audio tracks (a YouTube video's: its audio languages); green: the subtitle
    // languages; yellow: the sources. Each on its own, BACK or the same key again closes it;
    // another color while one is open: that one instead. Nothing to choose: said so.
    function colorMenu(key) {
        if (_menuOpen && _menuStack[0] && _menuStack[0].color === key) { closeMenu(); return; }
        var m = null;
        if (key === 'RED') {
            if (getAudioTracks().length > 1) { m = audioMenu(); }
            else if (hasYtLanguages()) { m = ytLanguageMenu(); }
            else { U.toast('Only one audio track', 1800); return; }
        } else if (key === 'GREEN') {
            m = langMenu();
        } else {
            if (!(S.ctx && S.ctx.streams && S.ctx.streams.length)) { U.toast('No other source for this', 1800); return; }
            m = sourceMenu();
        }
        if (_barOpen) { closeBar(); }
        if (_cast) { closeCast(true); }
        m.color = key;
        openMenu(m);
    }

    // ---------- keys ----------
    function menuKey(action) {
        var m = topMenu();
        if (action === 'UP' || action === 'DOWN') { m.idx = wrap(m.idx + (action === 'UP' ? -1 : 1), m.items.length); renderMenu(); return; }   // (round past either end)
        if (action === 'OK') { var it = m.items[m.idx]; if (it && it.run) { it.run(); } return; }
        if (action === 'LEFT' || action === 'BACK') { popMenu(); return; }
        if (action === 'STOP') { closeMenu(); return; }
    }

    // Number keys: on a live channel, its number in the row (one or two digits, a second and a
    // half for the second); anything else, the subtitles (1 / 2 / 3 timing earlier / as the file
    // / later, 4 / 5 / 6 Lower / Bottom / Raised, 7 / 8 / 9 Medium / Large / Extra Large).
    var _chDigits = '', _chTimer = null, CH_WAIT_MS = 1500;
    function numberKey(n) {
        if (S.ctx && S.ctx.zapTo) {
            _chDigits += n;
            if (_chTimer) { clearTimeout(_chTimer); _chTimer = null; }
            function go() { var k = +_chDigits; _chDigits = ''; if (_chTimer) { clearTimeout(_chTimer); _chTimer = null; } if (k > 0 && S.ctx && S.ctx.zapTo) { S.ctx.zapTo(k); } }
            if (_chDigits.length >= 2) { go(); return; }
            U.toast('Channel ' + _chDigits + '_', CH_WAIT_MS);
            _chTimer = setTimeout(go, CH_WAIT_MS);
            return;
        }
        if (S.isLive) { return; }
        P.subsKey(n);
    }
    function handleKey(action) {
        if (!S.active) { return true; }
        // Dedicated transport keys ALWAYS control playback, even with an overlay open (#9).
        switch (action) {
            case 'PLAY': play_(); if (_barOpen) { renderBar(); barIdle(); } showOSD(false); return true;
            case 'PAUSE': pause_(); if (_barOpen) { renderBar(); barIdle(); } showOSD(false); return true;
            case 'PLAYPAUSE': togglePlay(); return true;
            case 'STOP': exit(); return true;
            case 'FF': scrub(seekStep() * 3); return true;   // (three steps: 30 s at the default 10)
            case 'REW': scrub(-seekStep() * 3); return true;
            case 'CHUP': case 'CHDOWN':   // live channels: next / previous in the row it came from
                if (S.ctx && S.ctx.zap) { S.ctx.zap(action === 'CHUP' ? 1 : -1); }
                return true;
            case 'RED': case 'GREEN': case 'YELLOW': colorMenu(action); return true;
            case 'BLUE': toggleStreamInfo(); return true;   // the stream info, shown or hidden
            case 'NUM0': case 'NUM1': case 'NUM2': case 'NUM3': case 'NUM4': case 'NUM5': case 'NUM6': case 'NUM7': case 'NUM8': case 'NUM9':
                numberKey(+action.slice(3)); return true;
            case 'NEXT': case 'PREV':   // ⏭ / ⏮: the next / previous episode (a live channel: the next / previous one)
                var fwd = action === 'NEXT';
                if (S.ctx && S.ctx.zap) { S.ctx.zap(fwd ? 1 : -1); return true; }
                if (S.ctx && (fwd ? S.ctx.hasNext : S.ctx.hasPrev)) { closeControls(); if (fwd) { S.ctx.playNext(); } else { S.ctx.playPrev(); } return true; }
                if (S.ctx && S.ctx.type === 'series') { U.toast(fwd ? 'No next episode' : 'No previous episode', 1800); }
                return true;
        }
        // A held OK: a title's menu in Cast & more; anywhere else, OK.
        if (action === 'OK_LONG') {
            if (_cast && !_menuOpen) { castKey('OK_LONG'); return true; }
            action = 'OK';
        }
        // Route directional/OK/BACK to the active overlay (menu > cast > bar > skip prompt: the
        // menu over Cast & more is a title's, opened from it).
        if (_menuOpen) { menuKey(action); return true; }
        if (_cast) { castKey(action); return true; }
        if (_barOpen) { barKey(action); return true; }
        if ((_yl || _card) && ytLinksKey(action)) { return true; }   // (UP chooses one; BACK hides the end screen)
        if (_skip) {
            if (action === 'OK' || action === 'BACK') { skipKey(action); return true; }
            if ((action === 'LEFT' || action === 'RIGHT') && _skip.buttons.length > 1) { skipKey(action); return true; }
        }
        // Scrubbing: OK jumps now, BACK cancels (instead of pausing / leaving the player).
        if (_scrub && action === 'OK') { commitScrub(); return true; }
        if (_scrub && action === 'BACK') { cancelScrub(); return true; }
        // No overlay: default transport on the D-pad.
        showOSD(false);
        switch (action) {
            case 'OK': togglePlay(); return true;
            case 'RIGHT': scrub(seekStep()); return true;
            case 'LEFT': scrub(-seekStep()); return true;
            case 'UP': openBar(); return true;
            case 'DOWN': openMenu(); return true;
            case 'BACK': exit(); return true;
        }
        return true;
    }

    // ----- for the other parts (and js/player.js) -----
    P.barShown = function () { return _barOpen; };
    P.menuOpen = menuOpen; P.scrubbing = scrubbing; P.skipShown = skipShown; P.resetControls = resetControls;
    P.rootMenu = rootMenu;
    P.closeControls = closeControls; P.showSkip = showSkip; P.skipTick = skipTick; P.renderScrub = renderScrub; P.topMenu = topMenu;
    P.closeMenu = closeMenu; P.pushMenu = pushMenu; P.popMenu = popMenu; P.replaceTop = replaceTop; P.applyAspect = applyAspect;
    P.handleKey = handleKey; P.ytLinksTick = ytLinksTick; P.phoneLink = phoneLink;
})(PlayerParts);
