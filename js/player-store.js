/* Player, part 2 of 7 — what is saved: watched marks, Continue Watching progress, the subtitle
   look, audio and picture settings, and the subtitle / audio track remembered per title.
   Nothing here needs a playback.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';

    // ---------- watched model ----------
    var PROGRESS_KEY = 'stremiok.progress';
    var SUBCFG_KEY = 'stremiok.subcfg';
    var WATCHED_KEY = 'stremiok.watched';
    function watchedAll() { return U.store.get(WATCHED_KEY, {}) || {}; }
    // A mark made here: watched at (ms, > 0), or not watched at (−ms; false: an older "not
    // watched", at 0). Trakt's history (when connected) is weighed against it by time: marked
    // watched here: watched; marked not watched here: watched only if Trakt has it watched
    // since (on another device); no mark here: as Trakt has it. null: neither knows it.
    function traktAt(type, id) { return (typeof Trakt !== 'undefined' && Trakt.isConnected && Trakt.isConnected() && Trakt.watchedAt) ? Trakt.watchedAt(type, id) : 0; }
    function watchedState(type, id) {
        var v = watchedAll()[type + ':' + id], t = traktAt(type, id);
        if (typeof v === 'number' && v > 0) { return true; }
        if (v === false || (typeof v === 'number' && v <= 0)) { return t > -(v || 0); }
        return t > 0 ? true : null;
    }
    function isWatched(type, id) { return watchedState(type, id) === true; }
    // When it was watched (ms), here or (when later) on Trakt; 0: not watched / unknown.
    function watchedAt(type, id) {
        var v = watchedAll()[type + ':' + id], t = traktAt(type, id);
        if (typeof v === 'number' && v > 0) { return Math.max(v, t); }
        if (v === false || (typeof v === 'number' && v <= 0)) { return t > -(v || 0) ? t : 0; }
        return v === true ? 1 : t;
    }
    // Marked watched here since `since` (ms): [{ type, id, at }] (the Calendar's history).
    function watchedSince(since) {
        var a = watchedAll(), out = [];
        Object.keys(a).forEach(function (k) {
            var v = a[k], i = k.indexOf(':');
            if (typeof v === 'number' && v >= since && i > 0) { out.push({ type: k.slice(0, i), id: k.slice(i + 1), at: v }); }
        });
        return out;
    }
    // quiet: Trakt not told (it's been told another way: a finished scrobble)
    function setWatched(type, id, on, quiet) {
        var a = watchedAll();
        a[type + ':' + id] = on ? Date.now() : -Date.now();
        U.store.set(WATCHED_KEY, a);
        if (!quiet) { tellTrakt(type, [id], on); }
    }
    function setWatchedMany(type, ids, on) {
        var a = watchedAll();
        var value = on ? Date.now() : -Date.now();
        ids.forEach(function (id) { a[type + ':' + id] = value; });
        U.store.set(WATCHED_KEY, a);
        tellTrakt(type, ids, on);
    }
    // A "not watched" Trakt has confirmed (and its copy shows): dropped here, so Trakt decides.
    function clearUnwatched(type, id) {
        var a = watchedAll(), k = type + ':' + id, v = a[k];
        if (v === false || (typeof v === 'number' && v <= 0)) { delete a[k]; U.store.set(WATCHED_KEY, a); }
    }
    // every watched mark, however it's made, goes to Trakt too when you're connected — except a
    // YouTube video's (StremioK's YouTube, an addon's YouTube channel, one followed from a video,
    // a YouTube link): those aren't Trakt's, and nothing about them is sent (Trakt itself only
    // takes IMDb titles too)
    var YT_ID = /^(yt_id|ytk|yt):/;
    function tellTrakt(type, ids, on) {
        if (type === 'YouTube') { return; }
        ids = (ids || []).filter(function (id) { return !YT_ID.test('' + id); });
        if (ids.length && typeof Trakt !== 'undefined' && Trakt.onMarked) { Trakt.onMarked(type, ids, !!on); }
    }

    // ---------- subtitle look, audio language ----------
    // Look: color, background, edge and height on screen.
    var SUB_COLORS = [['white', 'White', '#ffffff'], ['yellow', 'Yellow', '#ffe14d'], ['cyan', 'Cyan', '#7fe7ff'], ['green', 'Green', '#9cff8a']];
    var SUB_BGS = [['none', 'None', 'transparent'], ['light', 'See-through box', 'rgba(0,0,0,0.55)'], ['solid', 'Solid box', 'rgba(0,0,0,0.9)']];
    var SUB_EDGES = [['shadow', 'Drop shadow', '0 2px 3px #000'],
        ['outline', 'Outline', '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000'],
        ['none', 'None', 'none']];
    // bottom offset: above the black bars of a widescreen film when raised
    var SUB_POSITIONS = [['lower', 'Lower', 60], ['bottom', 'Bottom', 130], ['raised', 'Raised', 210], ['higher', 'Higher', 290]];   // (Lower: near the screen's edge)
    function pick3(list, id) { for (var i = 0; i < list.length; i++) { if (list[i][0] === id) { return list[i]; } } return list[0]; }
    function getSubCfg() {
        var d = U.store.get(SUBCFG_KEY, {}) || {};
        return { lang: d.lang || 'off', lang2: d.lang2 || 'none', size: d.size || 'medium',   // (lang2: the second choice, 'none' = none)
            color: pick3(SUB_COLORS, d.color)[0], bg: pick3(SUB_BGS, d.bg || 'light')[0],
            edge: pick3(SUB_EDGES, d.edge)[0], pos: pick3(SUB_POSITIONS, d.pos || 'bottom')[0],   // (Bottom unless chosen: Lower comes first in the list)
            font: subFontFamily(d.font) ? d.font : 'default',   // an unknown font -> TV default
            skip: skipWords(d.skip),   // lines with one of these aren't shown (none by default: see player-subs' skipLines)
            second: typeof d.second === 'string' && /^[a-z]{2,3}$/.test(d.second) ? d.second : 'off' };   // a second subtitle at the top (player-subs; Off by default)
    }
    // Settings › Subtitles › Skip lines with: words (or bits, ".srt"), capitals or not; at most 20.
    function skipWords(x) {
        return (Array.isArray(x) ? x : ('' + (x || '')).split(',')).map(function (w) { return typeof w === 'string' ? w.trim().slice(0, 40) : ''; })
            .filter(function (w, i, a) { return w && a.indexOf(w) === i; }).slice(0, 20);
    }

    // Subtitle fonts: [id, label, CSS font-family]. The families are bundled in
    // css/fonts (see style.css); each falls back to a TV font for scripts it lacks.
    // 'default' leaves the subtitle in the app font (Arial / Tizen Sans).
    var SUB_FONTS = [
        ['default', 'TV default', ''],
        ['roboto', 'Roboto', "'SK Roboto', Arial, sans-serif"],
        ['atkinson', 'Atkinson Hyperlegible (easy reading)', "'SK Atkinson Hyperlegible', Arial, sans-serif"],
        ['nunito', 'Nunito (rounded)', "'SK Nunito', Arial, sans-serif"],
        ['cousine', 'Cousine (closed-caption style)', "'SK Cousine', 'Courier New', monospace"]
    ];
    function subFontFamily(id) {
        for (var i = 0; i < SUB_FONTS.length; i++) { if (SUB_FONTS[i][0] === id) { return SUB_FONTS[i][2]; } }
        return '';
    }
    var _subCfgVer = 0;   // bumped on every change: a styled line knows it's up to date
    function setSubCfg(cfg) { U.store.set(SUBCFG_KEY, cfg); _subCfgVer++; }
    function subCfgVersion() { return _subCfgVer; }

    // Preferred audio language ('default' = keep the stream's first audio track) and a
    // second choice used when the first isn't on the stream ('none' = no second choice).
    var AUDIOCFG_KEY = 'stremiok.audiocfg';
    function getAudioCfg() {
        var d = U.store.get(AUDIOCFG_KEY, {}) || {};
        // Switching to it (one choice, 1.9.15): Quick (no wait), or Safe waiting 3, 6 or 10 s, the
        // seconds a switch's reload waits after a start or a jump (see player-audio); Safe without
        // a wait saved: 10.
        var sw = d.switch === 'safe' ? 'safe' : 'quick';
        return { lang: d.lang || 'default', lang2: d.lang2 || 'none', switch: sw,
            wait: sw === 'quick' ? 0 : ([3, 6, 10].indexOf(d.wait) !== -1 ? d.wait : 10) };
    }
    function setAudioCfg(cfg) { U.store.set(AUDIOCFG_KEY, cfg); }

    // Applies the subtitle look to the line's <span> (and its height to the line).
    var SIZE_PX = { small: 28, medium: 36, large: 46, xlarge: 58 };
    function styleSpan(span) {
        var cfg = getSubCfg();
        span.style.fontSize = (SIZE_PX[cfg.size] || 36) + 'px';
        span.style.fontFamily = subFontFamily(cfg.font);
        span.style.color = pick3(SUB_COLORS, cfg.color)[2];
        span.style.background = pick3(SUB_BGS, cfg.bg)[2];
        span.style.textShadow = pick3(SUB_EDGES, cfg.edge)[2];
        if (span.parentNode) { span.parentNode.style.bottom = Math.max(subsPosPx(), (P.S && P.S.subsLift) || 0) + 'px'; }   // (raised over the progress bar: core's liftSubs)
    }
    function subsPosPx() { return pick3(SUB_POSITIONS, getSubCfg().pos)[2]; }

    // ---------- progress (Continue Watching) ----------
    function progressAll() { return U.store.get(PROGRESS_KEY, {}); }
    function progressKey(ctx) { return ctx.type + ':' + ctx.id; }
    function writeProgress(all) { U.store.set(PROGRESS_KEY, all); }

    // "Add to Continue Watching": list a title there without playing it. Also how
    // a show's next episode is queued (credits, marking episodes watched): like an added
    // title, it stays until it's finished or removed, even if you back out right away.
    // e = { id, type, name, poster, parent }. Never overwrites real progress.
    function addToContinue(e) {
        var all = progressAll(), k = e.type + ':' + e.id;
        if (all[k]) { all[k].added = true; }
        else { all[k] = { id: e.id, type: e.type, name: e.name, poster: e.poster, background: e.background, parent: e.parent, position: 0, duration: 0, updated: Date.now(), added: true }; }
        U.store.set(PROGRESS_KEY, all);
    }

    function progressFor(type, id) { return progressAll()[type + ':' + id] || null; }

    function getResume(type, id) {
        var e = progressAll()[type + ':' + id];
        return e ? e.position : 0;
    }

    function removeProgress(type, id) {
        var all = progressAll();
        delete all[type + ':' + id];
        U.store.set(PROGRESS_KEY, all);
    }

    function continueList() {
        var all = progressAll();
        var arr = [];
        for (var k in all) { if (Object.prototype.hasOwnProperty.call(all, k)) { arr.push(all[k]); } }
        arr.sort(function (a, b) { return b.updated - a.updated; });
        return arr;
    }

    var MEMORY_MAX = 50;   // titles whose subtitle / audio choice is remembered (each list)

    // ---------- subtitle memory (per title, last 50) ----------
    // Remembers the last MANUAL subtitle choice for a content id so replaying it
    // restores the same track (or "off") without re-selecting from the menu.
    var SUBHIST_KEY = 'stremiok.subhist';
    function subHist() { return U.store.get(SUBHIST_KEY, []) || []; }
    function rememberSub(id, sel) {
        if (!id || privateNow() || /^trailer:/.test(id)) { return; }   // (a trailer's choice: never asked for again)
        var list = subHist().filter(function (e) { return e.id !== id; });
        sel.id = id; sel.updated = Date.now();
        list.unshift(sel);
        if (list.length > MEMORY_MAX) { list = list.slice(0, MEMORY_MAX); }
        U.store.set(SUBHIST_KEY, list);
    }
    function recallSub(id) {
        var list = subHist();
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
        return null;
    }

    // ---------- private viewing ----------
    // On (Settings › Playback, or the player's menu): what you play isn't recorded — no
    // progress, no Continue Watching, nothing marked watched at the credits, no next episode
    // queued, nothing sent to Trakt, no "played before" or per-title subtitle / audio choice.
    // What you do by hand (Mark watched, Add to Continue Watching) still counts. Turned on or
    // off during a playback, it applies to it from then on.
    var PRIVATE_KEY = 'stremiok.private';
    function isPrivate() { return U.store.get(PRIVATE_KEY, false) === true; }
    function setPrivate(on) {
        U.store.set(PRIVATE_KEY, !!on);
        if (P.S && P.S.ctx && !P.S.ctx.trailer) { P.S.ctx.private = !!on; }
    }
    function privateNow() { return !!(P.S && P.S.active && P.S.ctx && P.S.ctx.private); }

    // ---------- audio memory (per title, last 50) ----------
    // Remembers the last MANUAL audio-track choice for a content id. Tracks have no
    // stable id, so it keeps the source url + track index plus the language and
    // channel count, to find the same track again on a different source.
    var AUDIOHIST_KEY = 'stremiok.audiohist';
    function audioHist() { return U.store.get(AUDIOHIST_KEY, []) || []; }
    function rememberAudio(id, sel) {
        if (!id || privateNow()) { return; }
        var list = audioHist().filter(function (e) { return e.id !== id; });
        sel.id = id; sel.updated = Date.now();
        list.unshift(sel);
        if (list.length > MEMORY_MAX) { list = list.slice(0, MEMORY_MAX); }
        U.store.set(AUDIOHIST_KEY, list);
    }
    function recallAudio(id) {
        var list = audioHist();
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
        return null;
    }

    // ---------- picture mode ----------
    // [id, label, AVPlay display method, CSS object-fit for the desktop <video>]; remembered.
    var PLAYERCFG_KEY = 'stremiok.playercfg';
    var ASPECTS = [
        ['fit', 'Fit (whole picture)', 'PLAYER_DISPLAY_MODE_LETTER_BOX', 'contain'],
        ['zoom', 'Zoom (fill the screen, trims edges)', 'PLAYER_DISPLAY_MODE_CROPPED_FULL', 'cover'],
        ['stretch', 'Stretch', 'PLAYER_DISPLAY_MODE_FULL_SCREEN', 'fill']
    ];
    // + seek: how far LEFT / RIGHT jump (s); buffer: 'normal' (the TV's own) | 'more' | 'most';
    // reconnect: a live channel that drops, 'off' | 'few' | 'always' (see player-core's liveDropped)
    // (Settings › Playback › Seeking & buffering)
    var SEEK_STEPS = [5, 10, 15, 30];
    function playerCfg() {
        var d = U.store.get(PLAYERCFG_KEY, {}) || {};
        return { aspect: d.aspect || 'fit', seek: SEEK_STEPS.indexOf(+d.seek) !== -1 ? +d.seek : 10,
            buffer: d.buffer === 'more' || d.buffer === 'most' ? d.buffer : 'normal',
            reconnect: d.reconnect === 'off' || d.reconnect === 'always' ? d.reconnect : 'few',
            phone: d.phone === 'infuse' || d.phone === 'link' ? d.phone : 'vlc' };   // (Continue on phone: what the QR opens)
    }
    function setPlayerCfg(cfg) {   // (what's given changes; the rest stays)
        var d = U.store.get(PLAYERCFG_KEY, {}) || {};
        Object.keys(cfg || {}).forEach(function (k) { d[k] = cfg[k]; });
        U.store.set(PLAYERCFG_KEY, d);
    }
    function aspectDef(id) { for (var i = 0; i < ASPECTS.length; i++) { if (ASPECTS[i][0] === id) { return ASPECTS[i]; } } return ASPECTS[0]; }
    // A live channel's own picture mode (picked while it played): { channel id: mode }, the last
    // ASPECTS_KEEP; one set back to the usual mode isn't kept apart. Anything else: the usual one.
    var ASPECTS_KEY = 'stremiok.aspects', ASPECTS_KEEP = 300;
    function aspectChannel() { var S = P.S; return (S && S.isLive && S.ctx && S.ctx.id) ? S.ctx.id : ''; }
    function aspectNow() {
        var ch = aspectChannel(), own = ch ? (U.store.get(ASPECTS_KEY, {}) || {})[ch] : '';
        return own && aspectDef(own)[0] === own ? own : playerCfg().aspect;
    }
    function setAspectNow(mode) {
        var ch = aspectChannel();
        if (!ch) { setPlayerCfg({ aspect: mode }); return; }
        var all = U.store.get(ASPECTS_KEY, {}) || {};
        delete all[ch];
        if (mode !== playerCfg().aspect) {
            all[ch] = mode;
            var keys = Object.keys(all);
            keys.slice(0, Math.max(0, keys.length - ASPECTS_KEEP)).forEach(function (k) { delete all[k]; });   // (the oldest picked)
        }
        U.store.set(ASPECTS_KEY, all);
    }

    // ----- for the other parts (and js/player.js) -----
    P.watchedState = watchedState; P.isWatched = isWatched; P.watchedAt = watchedAt; P.watchedSince = watchedSince;
    P.setWatched = setWatched; P.setWatchedMany = setWatchedMany; P.clearUnwatched = clearUnwatched; P.getSubCfg = getSubCfg;
    P.setSubCfg = setSubCfg; P.getAudioCfg = getAudioCfg; P.setAudioCfg = setAudioCfg;
    P.styleSpan = styleSpan; P.subsPosPx = subsPosPx; P.progressAll = progressAll; P.progressKey = progressKey;
    P.writeProgress = writeProgress; P.addToContinue = addToContinue; P.progressFor = progressFor;
    P.getResume = getResume; P.removeProgress = removeProgress; P.continueList = continueList;
    P.rememberSub = rememberSub; P.recallSub = recallSub; P.rememberAudio = rememberAudio;
    P.recallAudio = recallAudio; P.playerCfg = playerCfg; P.setPlayerCfg = setPlayerCfg;
    P.aspectDef = aspectDef; P.aspectNow = aspectNow; P.setAspectNow = setAspectNow; P.SUB_FONTS = SUB_FONTS; P.SUB_COLORS = SUB_COLORS; P.SUB_BGS = SUB_BGS;
    P.SUB_EDGES = SUB_EDGES; P.SUB_POSITIONS = SUB_POSITIONS; P.ASPECTS = ASPECTS;
    P.isPrivate = isPrivate; P.setPrivate = setPrivate; P.privateNow = privateNow; P.subCfgVersion = subCfgVersion;
})(PlayerParts);
