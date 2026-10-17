/* Player, part 4 of 7 — video quality (the HLS ladder, caps, retries and fallbacks after a
   failed start), switching source, and a YouTube video's audio language.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';
    var S = P.S;
    var useAV = P.useAV;

    // ----- from the other parts -----
    function startAV() { return P.startAV.apply(null, arguments); }   // core
    function startHTML5() { return P.startHTML5.apply(null, arguments); }   // core
    function closeMenu() { return P.closeMenu.apply(null, arguments); }   // controls
    function langName() { return P.langName.apply(null, arguments); }   // lang

    // video quality (HLS variants, capped via AVPlay ADAPTIVE_INFO)
    var _variants = [];      // [{ bw, w, h, label }] parsed from the HLS master, highest first
    var _qualityBw = null;   // null = Auto; else a target bandwidth cap (bps)
    var _sepAudio = false;   // master has a separate audio rendition group (YouTube-style HLS)
    var _ytRetried = false;  // YouTube re-open: one-shot retry of the SAME pick (first open often fails)
    var _switchNote = null;  // "Switching to 720p…" while a quality switch (and its routine retry) opens
    var _userPicked = false; // quality was chosen in the menu (vs. the automatic 1080p start / Auto)
    var _autoRetried = false;// one last re-open in Auto (starting low) was used for this attempt
    var _startNote = '';     // toast once playback starts, e.g. after a fallback ("Playing at 720p")

    // A new playback: Auto, nothing tried yet, and the new stream's quality list read.
    function resetQuality(ctx) {
        _variants = []; _qualityBw = null; _ytRetried = false; _switchNote = null;
        _userPicked = false; _autoRetried = false; _startNote = '';
        loadVariants(ctx.variantUrl || ctx.url, ctx.initialQualityHeight || 0, !!ctx.variantUrl);
    }
    // Playback started: a switch is done; say where a fallback landed.
    function qualityOnStart() {
        _switchNote = null;
        if (_startNote) { U.toast(_startNote, 2500); _startNote = ''; }
    }
    function clearStartNote() { _startNote = ''; }
    // The picked quality's height (0 = Auto), for a fresh YouTube resolve.
    function qualityHeight() { var v = variantByBw(_qualityBw); return v ? v.h : 0; }
    function qualityCount() { return _variants.length; }
    function hasQualities() { return _variants.length > 1; }

    // Auto lets AVPlay adapt to bandwidth; an explicit pick caps the ladder via ADAPTIVE_INFO.
    // Two cap strategies, because YouTube-style HLS breaks the usual one:
    //  - YouTube-style masters have VIDEO-ONLY #EXT-X-STREAM-INF rungs plus a SEPARATE audio
    //    rendition group. On this TV's AVPlay, ANY `BITRATES=` restriction on such a ladder
    //    breaks the audio-group association and playback fails (Auto, with no BITRATES, is the
    //    only thing that plays). So for these we cap by RESOLUTION (FIXED_MAX_RESOLUTION),
    //    which leaves AVPlay's normal audio muxing intact.
    //  - Muxed masters (regular IPTV/VOD) keep the bitrate cap, set just below the next-higher
    //    rung so the picked rung stays selected.
    // If a resolution cap can't be built (or the property is unsupported and throws), we fall
    // back to Auto rather than a BITRATES cap that would crash a YouTube-style stream.
    function adaptiveInfo() {
        // YouTube streams pick quality server-side (the proxy serves a single-rung master via
        // &h=), so AVPlay must NOT also cap — any cap here breaks their video-only+audio ladder.
        if (_qualityBw != null && !(S.ctx && S.ctx.yt)) {
            if (_sepAudio) {
                var v = variantByBw(_qualityBw);
                if (v && v.w && v.h) {
                    return 'FIXED_MAX_RESOLUTION=' + v.w + 'x' + v.h + '|STARTBITRATE=HIGHEST';
                }
                return 'STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST';
            }
            var higher = nextHigherBw(_qualityBw);
            var cap = (higher != null) ? (higher - 1) : (_qualityBw + 4000000);
            return 'BITRATES=1~' + cap + '|STARTBITRATE=HIGHEST';
        }
        // After a failed start, the Auto retry begins at the lowest rung and climbs.
        return _autoRetried ? 'STARTBITRATE=LOWEST' : 'STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST';
    }
    function variantByBw(bw) {
        for (var i = 0; i < _variants.length; i++) { if (_variants[i].bw === bw) { return _variants[i]; } }
        return null;
    }

    function nextLowerBw(cur) {
        if (cur == null) { return null; }
        var best = null;
        for (var i = 0; i < _variants.length; i++) {
            var bw = _variants[i].bw;
            if (bw < cur && (best == null || bw > best)) { best = bw; }
        }
        return best;
    }
    function nextHigherBw(cur) {
        if (cur == null) { return null; }
        var best = null;
        for (var i = 0; i < _variants.length; i++) {
            var bw = _variants[i].bw;
            if (bw > cur && (best == null || bw < best)) { best = bw; }
        }
        return best;
    }
    function labelForBw(bw) {
        for (var i = 0; i < _variants.length; i++) { if (_variants[i].bw === bw) { return _variants[i].label; } }
        return '';
    }

    // Re-open capped at a specific bandwidth (null = Auto). Keeps position for VOD, edge for live.
    // `message` replaces the default "Switching to …" status (used by the step-down).
    function setQuality(bw, message) {
        _qualityBw = bw;
        if (S.ctx) { S.ctx.initialQualityHeight = 0; }
        _ytRetried = false;                 // new pick → its one-shot retry is available again
        _autoRetried = false;               // ...and so is the final Auto fallback
        _userPicked = true;
        var label = bw == null ? 'Auto quality' : (labelForBw(bw) || 'new quality');
        _startNote = bw == null ? 'Playing with Auto quality' : 'Playing at ' + label;
        S.ctx.resumeSec = S.isLive ? 0 : S.cur;
        _switchNote = message || 'Switching to ' + label + '…';
        U.spinner(true, _switchNote);
        // YouTube: don't re-open the same (cached, now-stale) master and lean on an AVPlay cap.
        // Rebuild the proxy URL so the service serves a single-rung master (&h=) from a FRESH
        // resolve (&fresh=1) — new googlevideo session URLs, which re-open reliably. Auto (null
        // bw) drops &h= for the full ladder but still forces a fresh resolve.
        if (S.ctx.yt && typeof YTPlay !== 'undefined') {
            var v = variantByBw(bw);
            S.ctx.url = YTPlay.resolverUrl(S.ctx.yt, v ? v.h : 0, true, S.ctx.ytLang);
        }
        if (useAV) { startAV(S.ctx.url, true); } else { startHTML5(S.ctx.url); }
    }

    // YouTube re-opens fail on the FIRST attempt but succeed on the next (an AVPlay
    // close→open quirk on this TV — observed: every quality drops one rung via step-down,
    // and the step-down attempt plays fine). So retry the SAME pick once (fresh resolve)
    // before stepping down; this keeps the actual quality the user chose and lets 144p/Auto
    // (which have no lower rung) recover instead of exiting. One-shot per pick.
    function tryYtReopen() {
        if (!(S.ctx && S.ctx.yt) || _ytRetried || typeof YTPlay === 'undefined') { return false; }
        _ytRetried = true;
        var v = variantByBw(_qualityBw);
        var retryHeight = v ? v.h : (S.ctx.initialQualityHeight || 0);
        S.ctx.resumeSec = S.isLive ? 0 : S.cur;
        S.ctx.url = YTPlay.resolverUrl(S.ctx.yt, retryHeight, true, S.ctx.ytLang);
        // Right after a switch this retry is routine: keep saying "Switching to …"
        U.spinner(true, _switchNote || ((retryHeight ? retryHeight + 'p' : 'The stream') + ' didn\'t start — retrying…'));
        _switchNote = null;
        if (useAV) { startAV(S.ctx.url, true); } else { startHTML5(S.ctx.url); }
        return true;
    }

    // An explicit pick that failed to start → drop to the next lower rung and retry, so a
    // pick beyond this TV's capability settles on the highest it can actually play.
    function tryQualityStepDown() {
        if (_qualityBw == null) { return false; }
        var lower = nextLowerBw(_qualityBw);
        if (lower == null) { return false; }
        setQuality(lower, (labelForBw(_qualityBw) || 'That quality') + ' didn\'t start — trying ' + labelForBw(lower) + '…');
        return true;
    }

    // Last resort before giving up: re-open once in Auto, starting at the lowest rung so
    // the player climbs to what works. Covers the automatic 1080p start when 1080p won't
    // play (even if the quality list hasn't loaded yet), a pick with no lower rung left,
    // and a plain stream whose first open failed.
    function tryAutoFallback() {
        if (_autoRetried || !S.ctx) { return false; }
        var wasAuto = (_qualityBw == null && !S.ctx.initialQualityHeight);   // a plain stream already in Auto
        _autoRetried = true;
        _qualityBw = null;
        S.ctx.initialQualityHeight = 0;
        S.ctx.resumeSec = S.isLive ? 0 : S.cur;
        if (S.ctx.yt && typeof YTPlay !== 'undefined') { S.ctx.url = YTPlay.resolverUrl(S.ctx.yt, 0, true, S.ctx.ytLang); }
        _startNote = wasAuto ? '' : 'Playing with Auto quality';
        U.spinner(true, wasAuto ? 'Stream didn\'t start — retrying…' : 'Retrying with Auto quality…');
        if (useAV) { startAV(S.ctx.url); } else { startHTML5(S.ctx.url); }
        return true;
    }

    // What to try after a failed start: the same YouTube pick once more, a lower rung
    // (only for a quality picked in the menu), then Auto. False = nothing left.
    function tryFallback() {
        return tryYtReopen() || (_userPicked && tryQualityStepDown()) || tryAutoFallback();
    }

    // Parse the HLS master's variant ladder (one entry per resolution, highest first).
    // Also flags _sepAudio when the master carries a separate audio rendition group
    // (#EXT-X-MEDIA:TYPE=AUDIO, or STREAM-INF lines referencing an AUDIO group) — the
    // YouTube-style shape that can't take a BITRATES cap (see adaptiveInfo).
    // The quality menu needs the stream's HLS master (its list of resolutions). Only a
    // stream known to be HLS is asked for it: the list's own URL (YouTube), or a link to an
    // .m3u8. Anything else (a debrid MKV / MP4, an extensionless download link) is the
    // video itself: fetching it "to look" would download it a second time, into memory,
    // while the player starts on it. And the answer is capped and must be a playlist.
    var HLS_MASTER_MAX = 512 * 1024;
    function isHlsUrl(url) {
        var u = '' + (url || ''), path = u.split('#')[0].split('?')[0], query = u.split('#')[0].split('?')[1] || '';
        return /\.m3u8$/i.test(path) || /(^|&)(type|format|ext|output)=m3u8(&|$)/i.test(query);
    }
    function getHlsMaster(url) {
        return U.getText(url, 8000, HLS_MASTER_MAX).then(function (text) {
            var t = ('' + (text || '')).replace(/^\uFEFF/, '').replace(/^\s+/, '');
            if (t.indexOf('#EXTM3U') !== 0) { throw new Error('not an HLS playlist'); }
            return t;
        });
    }
    var _variantsToken = 0;
    // url: the master to read (a ctx's variantUrl), or a stream to read it from only when
    // it's an .m3u8 (see above).
    // A picture's quality class: its height, or for a wider one the height its width makes at
    // 16:9 (1920×960 → 1080, 3840×1920 → 2160), to the usual steps.
    var CLASSES = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
    function qualityClass(w, h) {
        var t = Math.max(h, Math.round(w * 9 / 16)), best = t;
        CLASSES.forEach(function (c) { if (Math.abs(c - t) <= c * 0.06) { best = c; } });
        return best;
    }
    function loadVariants(url, initialHeight, isMaster) {
        var tok = ++_variantsToken;   // a list arriving after you've moved on is for the old stream
        _variants = [];
        _sepAudio = false;
        if (!url || !(isMaster || isHlsUrl(url))) { return; }
        getHlsMaster(url).then(function (text) {
            if (tok !== _variantsToken) { return; }
            var t = '' + text;
            _sepAudio = t.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') !== -1 || /#EXT-X-STREAM-INF[^\r\n]*[,:]AUDIO=/.test(t);
            var lines = t.split(/\r?\n/), byH = {};
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf('#EXT-X-STREAM-INF') !== 0) { continue; }
                var bwM = lines[i].match(/BANDWIDTH=(\d+)/);
                var resM = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
                if (!resM) { continue; }   // only selectable video rungs (have a resolution)
                var bw = bwM ? parseInt(bwM[1], 10) : 0;
                var w = parseInt(resM[1], 10);
                var h = parseInt(resM[2], 10);
                // named by its class, a wide picture's too: 1920×960 is 1080p (h: its own height, as the service filters)
                var cls = qualityClass(w, h);
                if (!byH[h] || bw > byH[h].bw) { byH[h] = { bw: bw, w: w, h: h, cls: cls, label: cls + 'p' }; }
            }
            var out = [];
            for (var k in byH) { if (Object.prototype.hasOwnProperty.call(byH, k)) { out.push(byH[k]); } }
            out.sort(function (a, b) { return (b.h - a.h) || (b.bw - a.bw); });
            _variants = out;
            if (initialHeight && _qualityBw == null) {
                for (var n = 0; n < _variants.length; n++) {
                    if (_variants[n].h === initialHeight || _variants[n].cls === initialHeight) {
                        _qualityBw = _variants[n].bw;
                        break;
                    }
                }
            }
        }, function () { if (tok === _variantsToken) { _variants = []; _sepAudio = false; } });
    }

    // Switch to a different source mid-playback, keeping position (VOD): a playback of its
    // own, everything about the source reset through the usual path (player-core's
    // replaceSource → play → resetQuality: its ladder from s.variantUrl, a YouTube one's too).
    function switchSource(s) { P.replaceSource(s); }

    // ----- a YouTube video's audio language (its dubs) -----
    // The service plays one audio track only (switching tracks in such a stream hangs the
    // 2017 TV's player): another language is another stream, reopened at the same point,
    // like a quality change. The choice is remembered for the video (YTPlay.audioLang).
    function ytLanguages() { return (S.ytInfo && S.ytInfo.audio) || []; }
    function hasYtLanguages() { return !!(S.ctx && S.ctx.yt && !S.isLive && ytLanguages().length > 1); }
    function sameLang(a, b) { a = ('' + a).toLowerCase(); b = ('' + b).toLowerCase(); return !!a && !!b && (a === b || a.split('-')[0] === b.split('-')[0]); }
    function ytLangLabel(a) {
        var n = ('' + (a.name || '')).replace(/\s*-\s*(dubbed-auto|dubbed|original)\s*$/i, '').trim();
        if (!n || n.toLowerCase() === ('' + a.lang).toLowerCase()) { n = langName(('' + a.lang).split('-')[0]); }
        return n;
    }
    function currentYtLanguage() {
        var list = ytLanguages(), want = S.ctx && S.ctx.ytLang, i;
        for (i = 0; want && i < list.length; i++) { if (sameLang(list[i].lang, want)) { return list[i]; } }
        for (i = 0; i < list.length; i++) { if (list[i].original) { return list[i]; } }
        return list[0] || null;
    }
    function ytLanguageLabel() { var a = currentYtLanguage(); return a ? ytLangLabel(a) : ''; }
    function setYtLanguage(a) {
        var lang = a.original ? '' : a.lang;
        if ((S.ctx.ytLang || '') === lang) { return; }
        S.ctx.ytLang = lang;
        if (!S.ctx.private) { YTPlay.setAudioLang(S.ctx.yt, lang); }   // (private: not kept for the video)
        _ytRetried = false; _autoRetried = false;
        S.ctx.resumeSec = S.cur;
        var v = variantByBw(_qualityBw);
        S.ctx.url = YTPlay.resolverUrl(S.ctx.yt, v ? v.h : (S.ctx.initialQualityHeight || 0), true, lang);
        _switchNote = 'Switching to ' + ytLangLabel(a) + '…';
        _startNote = 'Audio: ' + ytLangLabel(a);
        U.spinner(true, _switchNote);
        if (useAV) { startAV(S.ctx.url, true); } else { startHTML5(S.ctx.url); }
    }
    function ytLanguageMenu() {
        var cur = currentYtLanguage(), list = ytLanguages().slice();
        list.sort(function (x, y) { return (y.original ? 1 : 0) - (x.original ? 1 : 0) || (ytLangLabel(x) < ytLangLabel(y) ? -1 : 1); });   // (the original first)
        var idx = 0;
        var items = list.map(function (a, i) {
            if (a === cur) { idx = i; }
            return { label: ytLangLabel(a), detail: a.original ? 'Original' : 'AI-dubbed by YouTube', sel: a === cur,
                run: function () { closeMenu(); setYtLanguage(a); } };
        });
        return { title: 'Audio language', items: items, idx: idx };
    }

    function qualityLabel() {
        if (_qualityBw == null) { return 'Auto'; }
        for (var i = 0; i < _variants.length; i++) { if (_variants[i].bw === _qualityBw) { return _variants[i].label; } }
        return 'Auto';
    }

    function qualityMenu() {
        var items = [{ label: 'Auto', detail: 'Adapt to bandwidth', sel: _qualityBw == null,
            run: function () { setQuality(null); closeMenu(); } }];
        _variants.forEach(function (v) {
            items.push({ label: v.label, detail: Math.round(v.bw / 1000) + ' kbps', sel: _qualityBw === v.bw,
                run: function () { setQuality(v.bw); closeMenu(); } });
        });
        var idx = 0;
        for (var i = 0; i < items.length; i++) { if (items[i].sel) { idx = i; break; } }
        return { title: 'Video quality', items: items, idx: idx };
    }

    // ----- for the other parts (and js/player.js) -----
    P.resetQuality = resetQuality; P.qualityOnStart = qualityOnStart; P.clearStartNote = clearStartNote;
    P.qualityHeight = qualityHeight; P.qualityCount = qualityCount; P.hasQualities = hasQualities;
    P.adaptiveInfo = adaptiveInfo; P.tryFallback = tryFallback; P.switchSource = switchSource;
    P.qualityLabel = qualityLabel; P.qualityMenu = qualityMenu;
    P.hasYtLanguages = hasYtLanguages; P.ytLanguageLabel = ytLanguageLabel; P.ytLanguageMenu = ytLanguageMenu;
})(PlayerParts);
