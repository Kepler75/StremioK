/* Player, part 5 of 7 — subtitles: addon tracks (download, parse, draw, timing), the file's
   own tracks, and the subtitle menus.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';
    var S = P.S;
    var avplay = P.avplay, useAV = P.useAV;

    // ----- from the other parts -----
    function updateHint() { return P.updateHint.apply(null, arguments); }   // core
    function getSubCfg() { return P.getSubCfg.apply(null, arguments); }   // store
    function recallSub() { return P.recallSub.apply(null, arguments); }   // store
    function rememberSub() { return P.rememberSub.apply(null, arguments); }   // store
    function setSubCfg() { return P.setSubCfg.apply(null, arguments); }   // store
    function styleSpan() { return P.styleSpan.apply(null, arguments); }   // store
    function langKey() { return P.langKey.apply(null, arguments); }   // lang
    function langMatches() { return P.langMatches.apply(null, arguments); }   // lang
    function langName() { return P.langName.apply(null, arguments); }   // lang
    function langRank() { return P.langRank.apply(null, arguments); }   // lang
    function trackLang() { return P.trackLang.apply(null, arguments); }   // lang
    function closeMenu() { return P.closeMenu.apply(null, arguments); }   // controls
    function menuOpen() { return P.menuOpen.apply(null, arguments); }   // controls
    function pushMenu() { return P.pushMenu.apply(null, arguments); }   // controls
    function replaceTop() { return P.replaceTop.apply(null, arguments); }   // controls
    function popMenu() { return P.popMenu.apply(null, arguments); }   // controls
    function topMenu() { return P.topMenu.apply(null, arguments); }   // controls

    var _subTracks = [];     // [{lang,url,_addon}]
    var _cues = null;        // [{start,end,text}]
    var _cueIdx = 0;         // cues before this index ended before _cueT (renderSubs scan start)
    var _cueT = 0;           // playback time of the last renderSubs pass
    var _subOn = false;
    var _subLabel = '';
    var _subTrackUrl = '';
    var _subDelay = 0;       // seconds added to addon-subtitle timing (+ later, − earlier)
    var _subTrackId = null;  // id of the loaded addon subtitle track (per-title timing memory)
    // built-in (embedded) subtitle tracks, drawn from AVPlay's onsubtitlechange text
    var _embSub = null;      // index of the selected built-in text track, or null
    var _embLang = '';
    var _embWant = null;     // { index?, lang } to select once playback runs
    var _embTimer = null;
    var _embDelay = 0;       // seconds a built-in track's lines are held back (later only: see showEmbeddedText)
    var _embQueue = [];      // held lines: { due (playback s), from (s when it came), text, duration }
    var _ticked = false;     // this AVPlay attempt has reported play time (tracks can be switched)
    // the second subtitle (Settings › Subtitles › Second subtitle): an addon track in that
    // language, at the top, with the main one's timing
    var _cues2 = null, _sub2Label = '', _sub2Gen = 0, _cue2Idx = 0, _cue2T = 0;

    // A new playback: no subtitles yet.
    function resetSubs() {
        _subGen++;
        _subTracks = []; _cues = null; _subOn = false; _subLabel = ''; _subTrackUrl = '';
        _subDelay = 0; _subTrackId = null; _embSub = null; _embLang = ''; _embWant = null;
        _embDelay = 0; _embQueue = []; _embNudge = null;
        if (_embTimer) { clearTimeout(_embTimer); _embTimer = null; }
        S.subsEl.className = 'hidden'; U.clear(S.subsEl);
        secondOff();
    }
    // Playback stopped.
    function closeSubs() {
        S.subsEl.className = 'hidden'; U.clear(S.subsEl);
        _subOn = false; _cues = null; _subTracks = [];
        secondOff();
    }

    function startSubtitles(ctx) {
        // Fetch subtitle tracks in parallel; enables the UP menu when ready. A YouTube video:
        // its own captions too, after the addons' (the uploader's, then the automatic ones).
        // A file on a USB drive: the subtitle files next to it first; the addons asked with its
        // hash, size and name (a plain file, not matched to a title: no addons).
        // A trailer: its own captions only (the addons know the title, not its trailer).
        // An addon's source: its file's name, size and fingerprint when the source gives them, so
        // OpenSubtitles puts the subtitles made for that release first (as Stremio asks).
        var local = typeof LocalMedia !== 'undefined' && ctx.localFile;
        var fromAddons = (ctx.trailer || (local && LocalMedia.isPlainId(ctx.id))) ? Promise.resolve([])
            : (local ? LocalMedia.subtitleExtra(ctx.localFile) : Promise.resolve(fileHints(ctx.subExtra))).then(function (extra) {
                return Stremio.getSubtitles(ctx.addonType || ctx.type, ctx.id, extra || undefined);   // (a YouTube channel's video: its addon's own type)
            }).then(null, function () { return []; });
        var fromYouTube = S.ytInfoP ? S.ytInfoP.then(function (info) { return youTubeCaptions(ctx, info); }, function () { return []; }) : Promise.resolve([]);
        var localReady = local ? LocalMedia.ready() : Promise.resolve();   // (the subtitle files' links need the service's token)
        // The subtitle files next to a USB video are offered as soon as their links are ready (not
        // after the addons answer): one that's your remembered choice or default language starts
        // at once. The addons' join them when they come; what's showing (or what you chose
        // meanwhile) is kept.
        var localSubs = ctx.localSubs || [], early = false;
        // Any source of a movie / an episode (not the drive's own file): the subtitle files on a USB
        // drive for that title too, after the addons' (the alternative you pick: LocalMedia.subsForTitle)
        var usbSubs = (!local && !ctx.trailer && !ctx.yt && typeof LocalMedia !== 'undefined' && LocalMedia.subsForTitle && LocalMedia.present && LocalMedia.present() &&
            (ctx.type === 'movie' || ctx.type === 'series') && /^tt\d+/.test('' + ctx.id))
            ? LocalMedia.ensure().then(function () { return LocalMedia.ready(); }).then(function () { return LocalMedia.subsForTitle(ctx.type, ctx.id); }).then(null, function () { return []; })
            : Promise.resolve([]);
        if (localSubs.length) { localReady.then(function () { early = pickSubs(localSubs, true); }); }
        Promise.all([fromAddons, fromYouTube, localReady, usbSubs]).then(function (r) {
            var all = localSubs.concat(ctx.sourceSubs || [], r[0] || [], r[1], r[3] || []);   // (a source's own: made for its file, so first after a USB file's)
            if (!S.active || S.ctx !== ctx) { return; }   // (another playback started meanwhile: not its tracks)
            if (early || _subOn || _embSub != null) { _subTracks = all; updateHint(); startSecond(); return; }
            pickSubs(all, false);
            startSecond();
        });
        // Choose a track: your remembered one for this title, else your default language (else one
        // built into the file). partial: only these tracks so far (the subtitle files) — nothing
        // chosen unless one of them is it. Returns whether something was chosen.
        function pickSubs(tracks, partial) {
            if (!S.active || S.ctx !== ctx) { return false; }
            if (partial && (_subOn || _embSub != null)) { return false; }
            _subTracks = tracks || [];
            updateHint();

            // 1) A remembered choice for this exact title wins: an addon track (subtitle id,
            //    then url, then any track in that language), a built-in track, or "off".
            var mem = recallSub(ctx.id);
            if (mem) {
                if (mem.off) { return true; }
                if (mem.embedded) {
                    if (partial) { return false; }
                    wantEmbedded({ index: mem.index, lang: mem.lang, nth: mem.nth }); _embDelay = Math.max(0, +mem.delay || 0); return true;
                }
                var exact =
                    (mem.trackId != null ? _subTracks.find(function (t) { return t.id === mem.trackId; }) : null) ||
                    (mem.url ? _subTracks.find(function (t) { return t.url === mem.url; }) : null);
                var remembered = exact ||
                    (mem.lang ? _subTracks.find(function (t) { return langKey(t.lang) === langKey(mem.lang); }) : null);
                if (remembered) {
                    // the timing adjustment belongs to that exact file
                    loadTrack(remembered, function () { if (exact && mem.delay) { _subDelay = mem.delay; renderSubs(); } });
                    return true;
                }
                if (partial) { return false; }
            }

            // 2) Otherwise the default language: an addon track, else one built into the file;
            //    then the second choice, the same way (see applyEmbeddedWant: once the file's own
            //    tracks are known, so the default language built into it comes first).
            var cfg = getSubCfg();
            if (!cfg.lang || cfg.lang === 'off') { return !partial; }
            // "spa" also matches "es", "es-419", "Spanish", "Español"...
            var match = _subTracks.find(function (t) { return langMatches(cfg.lang, t.lang); });
            if (match) { loadTrack(match); return true; }
            if (partial) { return false; }
            wantEmbedded({ lang: cfg.lang, lang2: (cfg.lang2 && cfg.lang2 !== 'none' && cfg.lang2 !== cfg.lang) ? cfg.lang2 : null });
            return true;
        }
    }

    // A source's file details as subtitle addons take them: only what looks right (a name, a
    // size that's a number, a 16-hex-digit fingerprint), or null.
    function fileHints(h) {
        if (!h || typeof h !== 'object') { return null; }
        var o = {}, any = false;
        if (typeof h.filename === 'string' && h.filename) { o.filename = h.filename.slice(0, 200); any = true; }
        if (typeof h.videoSize === 'number' && isFinite(h.videoSize) && h.videoSize > 0) { o.videoSize = Math.floor(h.videoSize); any = true; }
        if (typeof h.videoHash === 'string' && /^[0-9a-f]{16}$/.test(h.videoHash)) { o.videoHash = h.videoHash; any = true; }
        return any ? o : null;
    }

    function youTubeCaptions(ctx, info) {
        if (typeof YTPlay === 'undefined' || !YTPlay.subsUrl) { return []; }
        var list = U.listOf(info && info.captions, 60, function (t) { return typeof t.lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,2}$/.test(t.lang); });
        list = list.filter(function (t) { return !t.auto; }).concat(list.filter(function (t) { return t.auto; }));
        return list.map(function (t) {
            return { id: 'yt:' + t.lang + (t.auto ? ':auto' : ''), lang: t.lang, url: YTPlay.subsUrl(ctx.yt, t.lang, !!t.auto), _addon: t.auto ? 'YouTube (automatic)' : 'YouTube' };
        });
    }

    // A new AVPlay attempt (re-open, quality switch, retry): a built-in track is selected
    // again once it plays.
    function subsBeforeOpen() {
        _ticked = false;
        if (_embSub != null) { _embWant = { index: _embSub, lang: _embLang }; _embSub = null; }
    }
    // The attempt reports play time: built-in tracks can be switched now.
    function subsOnTick() {
        if (!_ticked) { _ticked = true; if (_embWant) { try { applyEmbeddedWant(); } catch (eS) {} } }
        if (_embNudge && Date.now() >= _embNudge.at && !S.buffering && S.pendingSeek == null) { try { nudgeEmbedded(); } catch (eN) {} }
    }
    // A built-in track picked on its own when playback starts (remembered, or your language)
    // can be taken by the TV without its subtitles following (shown as selected, nothing on
    // screen; picking it again by hand works). So it's picked once more when playback has run
    // a moment: through another text track first (or off and on, with only one), since picking
    // the track the TV already reports is ignored.
    var EMB_NUDGE_MS = 2500, _embNudge = null;
    function nudgeEmbedded() {
        var n = _embNudge; _embNudge = null;
        if (!n || _subOn || _embSub !== n.index) { return; }   // (another choice meanwhile)
        var other = getTextTracks().filter(function (t) { return t.index !== n.index; })[0];
        if (other) { try { avplay.setSelectTrack('TEXT', other.index); } catch (e1) {} }
        else { try { avplay.setSilentSubtitle(true); } catch (e2) {} }
        try { avplay.setSilentSubtitle(false); } catch (e3) {}
        try { avplay.setSelectTrack('TEXT', n.index); }
        catch (e4) { try { avplay.setSelectTrack('TEXT', '' + n.index); } catch (e5) {} }
    }
    // Stream info's "Subtitles" line.
    function subtitleSummary() {
        return _subOn ? (_subLabel + (_subDelay ? '  (' + fmtDelay(_subDelay) + ')' : '')) : (_embSub != null ? (_embLang || 'on') + '  (built-in)' : 'Off');
    }

    // ---------- subtitles ----------
    // Parses SRT or VTT: HH:MM:SS,mmm / HH:MM:SS.mmm timing lines, or WebVTT's MM:SS.mmm
    // (its hours are optional).
    // WebVTT: a block starting with NOTE is a comment (an addon may set aside a line its own
    // banner overlaps there, timing and all); STYLE and REGION blocks aren't text either.
    var WEBVTT_ASIDE = /^(NOTE|STYLE|REGION)([ \t]|$)/;
    // Character codes (&amp; &gt; &#8212; …) as the characters they stand for.
    var CHAR_CODES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' };
    // A subtitle's tags taken out, a stray < with them: one pass, in time with the text's length
    // however it's made (a run of < with no > after it used to hold the remote for seconds).
    // Its text is only ever shown as text (textContent): this is for how it reads.
    function noTags(t) {
        var out = '', i = 0, n = t.length;
        while (i < n) {
            var lt = t.indexOf('<', i);
            if (lt === -1) { out += t.slice(i); break; }
            out += t.slice(i, lt);
            var gt = t.indexOf('>', lt + 1);
            if (gt === -1) { out += t.slice(lt + 1).split('<').join(''); break; }   // (no tag ends after it: the rest, its < gone)
            i = gt + 1;
        }
        return out;
    }
    function charCodes(t) {
        if (t.indexOf('&') === -1) { return t; }
        return t.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, function (all, c) {
            if (c.charAt(0) === '#') {
                var n = /^#[xX]/.test(c) ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
                if (!(n > 0 && n <= 0xFFFF)) { return all; }
                return String.fromCharCode(n);
            }
            return CHAR_CODES.hasOwnProperty(c) ? CHAR_CODES[c] : all;
        });
    }
    // A file's cues: CUES_MAX at most, CUE_TEXT_MAX characters of text each (a broken or hostile
    // file can't hold the remote: the whole parse stays in time with the file's length).
    var CUES_MAX = 20000, CUE_TEXT_MAX = 1000;
    function parseCues(text) {
        text = ('' + text).replace(/\r/g, '');
        var blocks = text.split(/\n\n+/);
        var cues = [], skip = skipper();   // (Skip lines with: your words)
        var re = /(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{1,3})/;
        function ms(x) { return +((x + '00').slice(0, 3)) / 1000; }   // (".5" is half a second)
        for (var i = 0; i < blocks.length && cues.length < CUES_MAX; i++) {
            var lines = blocks[i].replace(/^\n+/, '').split('\n');
            if (WEBVTT_ASIDE.test(lines[0])) { continue; }   // (a WebVTT comment, style or region: not shown)
            var ti = -1;
            for (var j = 0; j < lines.length; j++) { if (lines[j].indexOf('-->') !== -1) { ti = j; break; } }
            if (ti === -1) { continue; }
            var m = lines[ti].match(re);
            if (!m) { continue; }
            var start = (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + ms(m[4]);
            var end = (+(m[5] || 0)) * 3600 + (+m[6]) * 60 + (+m[7]) + ms(m[8]);
            // (tags out, a stray < with them, in one pass; then entities read: one written as &lt; is the file's own text,
            // "<b>" shown as written. Never a tag: subtitles reach the screen as text only, textContent)
            var txt = skip(charCodes(noTags(lines.slice(ti + 1).join('\n').slice(0, CUE_TEXT_MAX)).replace(/\{[^}]+\}/g, '')).replace(/\s+$/, ''));
            if (txt) { cues.push({ start: start, end: end, text: txt }); }
        }
        cues.sort(function (a, b) { return a.start - b.start; });
        return cues;
    }

    function renderSubs() {
        if (_embQueue.length) { flushEmbQueue(); }
        renderSecond();
        if (!_subOn || !_cues) { return; }
        var t = S.cur - _subDelay;   // timing adjustment: + shows later, − earlier
        var show = '';
        // Skip the prefix of cues that already ended (they can't show again unless we go
        // back in time, which resets the index), then scan as before. Same cue as a full
        // scan from 0, without walking the whole list late in a movie on every tick.
        if (t < _cueT) { _cueIdx = 0; }
        _cueT = t;
        while (_cueIdx < _cues.length && _cues[_cueIdx].end < t) { _cueIdx++; }
        for (var i = _cueIdx; i < _cues.length; i++) {
            if (_cues[i].start <= t && t <= _cues[i].end) { show = _cues[i].text; break; }
            if (_cues[i].start > t) { break; }
        }
        if (show) {
            S.subsEl.className = '';
            var span = S.subsEl.firstChild;
            if (!span) { span = document.createElement('span'); S.subsEl.appendChild(span); styleSpan(span); }
            if (span.textContent !== show) { span.textContent = show; }
        } else {
            S.subsEl.className = 'hidden';
        }
    }

    // Each choice (a track, Off, a built-in one) is a new one: a download still on its way
    // for an earlier choice is dropped when it comes, without a word (_subGen).
    var _subGen = 0;
    function loadTrack(track, onDone) {
        if (!U.parseUrl(track.url)) { U.toast('That subtitle track has no usable link'); return; }   // (http(s) only)
        U.toast('Loading subtitles…', 1500);
        var forCtx = S.ctx, gen = ++_subGen;
        function stale() { return !S.active || S.ctx !== forCtx || gen !== _subGen; }   // (another playback, or another choice, meanwhile)
        U.getText(track.url, 15000, undefined, null, false, track.headers || null).then(function (text) {   // (a USB file's: the service's header where there's no token)
            if (stale()) { return; }
            var cues = parseCues(text);
            if (!cues.length) { U.toast('Could not parse subtitles'); return; }
            embOff();   // an addon track replaces a built-in one
            _cues = cues; _cueIdx = 0; _cueT = 0; _subOn = true; _subLabel = track.lang || 'on'; _subTrackUrl = track.url;
            _subTrackId = (track.id != null) ? track.id : null; _subDelay = 0;
            renderSubs();
            U.toast('Subtitles: ' + (track.lang || 'on'));
            if (onDone) { onDone(); }
        }, function () { if (!stale()) { U.toast('Failed to download subtitles'); } });
    }

    // ---------- the second subtitle ----------
    function secondEl() {
        var el = U.byId('subs2');
        if (!el) { el = document.createElement('div'); el.id = 'subs2'; el.className = 'hidden'; (S.subsEl.parentNode || document.body).appendChild(el); }
        return el;
    }
    function secondOff() {
        _sub2Gen++; _cues2 = null; _sub2Label = '';
        var el = U.byId('subs2');
        if (el) { el.className = 'hidden'; U.clear(el); }
    }
    // The language at the bottom (not shown twice).
    function mainKey() { return _subOn ? langKey(_subLabel) : (_embSub != null ? langKey(_embLang) : ''); }
    // Load the second language's first addon track (when it's set and isn't what's at the bottom).
    function startSecond() {
        var want = getSubCfg().second;
        if (!want || want === 'off') { secondOff(); return; }
        var track = _subTracks.filter(function (t) { return t.url && langMatches(want, t.lang); })[0];
        if (!track || (_cues2 && _sub2Label === track.url)) { if (!track) { secondOff(); } return; }
        var forCtx = S.ctx, gen = ++_sub2Gen;
        U.getText(track.url, 15000, undefined, null, false, track.headers || null).then(function (text) {
            if (!S.active || S.ctx !== forCtx || gen !== _sub2Gen) { return; }
            var cues = parseCues(text);
            if (!cues.length) { return; }
            _cues2 = cues; _sub2Label = track.url; _cue2Idx = 0; _cue2T = 0;
            secondEl();
            renderSecond();
        }, function () {});
    }
    function renderSecond() {
        var el = U.byId('subs2');
        if (!el) { return; }
        var want = getSubCfg().second, show = '';
        if (_cues2 && want !== 'off' && langKey(want) !== mainKey()) {
            var t = S.cur - _subDelay;
            if (t < _cue2T) { _cue2Idx = 0; }
            _cue2T = t;
            while (_cue2Idx < _cues2.length && _cues2[_cue2Idx].end < t) { _cue2Idx++; }
            for (var i = _cue2Idx; i < _cues2.length; i++) {
                if (_cues2[i].start <= t && t <= _cues2[i].end) { show = _cues2[i].text; break; }
                if (_cues2[i].start > t) { break; }
            }
        }
        if (!show) { el.className = 'hidden'; return; }
        el.className = '';
        var span = el.firstChild;
        if (!span) { span = document.createElement('span'); el.appendChild(span); }
        var ver = P.subCfgVersion ? P.subCfgVersion() : -1;
        if (span.__styled !== ver || ver === -1) {   // (styled when made, and when the subtitle settings change: not every tick)
            styleSpan(span);
            el.style.bottom = '';   // (styleSpan places the bottom one: this one stays at the top)
            span.__styled = ver;
        }
        if (span.textContent !== show) { span.textContent = show; }
    }
    // Green › Second subtitle: Off, or a language the addons have (the same setting as Settings').
    function secondMenu() {
        var keys = [], cur = getSubCfg().second;
        _subTracks.forEach(function (t) { var k = langKey(t.lang); if (t.url && k && keys.indexOf(k) === -1) { keys.push(k); } });
        var items = [{ label: 'Off', sel: cur === 'off', run: function () { var c = getSubCfg(); c.second = 'off'; setSubCfg(c); secondOff(); popMenu(); } }];
        keys.forEach(function (k) {
            items.push({ label: langName(k), sel: langKey(cur) === k, run: function () {
                var c = getSubCfg(); c.second = /^[a-z]{2,3}$/.test(k) ? k : 'off'; setSubCfg(c); secondOff(); startSecond(); popMenu();
            } });
        });
        var idx = 0;
        items.forEach(function (it, i) { if (it.sel) { idx = i; } });
        return { title: 'Second subtitle (at the top)', items: items, idx: idx };
    }

    function subsOff() {
        _subGen++;
        _subOn = false; _cues = null; _subLabel = ''; _subTrackUrl = ''; _subTrackId = null; _subDelay = 0;
        embOff();
        S.subsEl.className = 'hidden'; U.clear(S.subsEl);
    }

    // ---------- built-in (embedded) subtitle tracks ----------
    // AVPlay lists the file's own text tracks (e.g. an MKV's SRT/ASS tracks) and, once
    // one is selected and not silenced, hands over each line via onsubtitlechange;
    // StremioK draws it like an addon subtitle. Like audio, a track is only switched
    // once playback runs. Image-based tracks (PGS) produce no text and show nothing.
    function getTextTracks() {
        if (!useAV) { return []; }
        try {
            var all = avplay.getTotalTrackInfo() || [], out = [];
            for (var i = 0; i < all.length; i++) { if (('' + all[i].type).toUpperCase() === 'TEXT') { out.push(all[i]); } }
            return out;
        } catch (e) { return []; }
    }
    function textLang(tr) { return trackLang(tr); }

    function wantEmbedded(w) { _embWant = w; if (_ticked) { applyEmbeddedWant(); } }
    function applyEmbeddedWant() {
        var w = _embWant; _embWant = null;
        if (!w || _subOn) { return; }   // an addon track was chosen meanwhile
        var tracks = getTextTracks(), pick = null, key = w.lang ? langKey(w.lang) : '';
        if (w.index != null) {
            pick = tracks.find(function (t) { return t.index === w.index && (!key || langKey(textLang(t)) === key); }) || null;
        }
        if (!pick && key) { pick = tracks.find(function (t) { return langMatches(key, textLang(t)); }) || null; }
        if (!pick && w.nth != null && S.ctx && S.ctx._relayCc) { pick = tracks[w.nth] || null; }   // (a live channel's closed captions: in the order asked for)
        if (!pick && w.lang2) {   // nothing in the default language anywhere: the second choice, a track to download first
            var key2 = langKey(w.lang2);
            var dl = _subTracks.find(function (t) { return langMatches(key2, t.lang); });
            if (dl) { loadTrack(dl); return; }
            pick = tracks.find(function (t) { return langMatches(key2, textLang(t)); }) || null;
        }
        if (pick) { selectEmbeddedSub(pick); _embNudge = { index: pick.index, at: Date.now() + EMB_NUDGE_MS }; }
    }
    function selectEmbeddedSub(tr) {
        subsOff();   // addon subtitles (and any other built-in track) off
        try { avplay.setSilentSubtitle(false); } catch (e) {}
        try { avplay.setSelectTrack('TEXT', tr.index); }
        catch (e2) { try { avplay.setSelectTrack('TEXT', '' + tr.index); } catch (e3) {} }
        _embSub = tr.index; _embLang = textLang(tr);
        U.toast('Subtitles: ' + (_embLang || 'on') + (S.ctx && S.ctx._relayCc ? ' (closed captions)' : ' (built-in)'), 1800);
    }
    function embOff() {
        if (_embSub != null) { try { avplay.setSilentSubtitle(true); } catch (e) {} }
        _embSub = null; _embLang = ''; _embQueue = [];
        if (_embTimer) { clearTimeout(_embTimer); _embTimer = null; }
    }
    // A built-in track's line, as the TV's player hands it over (at its time: so it can be held
    // back for later, never shown earlier). Held, it's drawn once playback reaches its time
    // (renderSubs, every play-time report); a jump in between drops it.
    // Settings › Subtitles › Skip lines with: a line with one of your words in it (capitals or not:
    // "OPENSUBTITLES" for the subtitle site's ads, ".srt" for a file's own name) isn't shown; a
    // subtitle with nothing else isn't either. None by default.
    // skipper() -> fn(text) -> the text without those lines (read once per track: not per line)
    var _skipRe = { key: null, re: null };
    function skipper() {
        var words = getSubCfg().skip || [], key = words.join('\u0001');
        if (!words.length) { return function (t) { return t; }; }
        if (_skipRe.key !== key) { _skipRe = { key: key, re: new RegExp(words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'i') }; }
        var re = _skipRe.re;
        return function (text) {
            if (!re.test(text)) { return text; }
            return ('' + text).split('\n').filter(function (l) { return !re.test(l); }).join('\n').trim();
        };
    }
    function showEmbeddedText(text, duration) {
        if (_embSub == null || _subOn) { return; }
        text = skipper()('' + (text || ''));
        if (!text) { return; }
        if (_embDelay > 0) {
            _embQueue.push({ due: S.cur + _embDelay, from: S.cur, text: text, duration: duration });
            if (_embQueue.length > 50) { _embQueue.shift(); }
            return;
        }
        drawEmbedded(text, duration);
    }
    function flushEmbQueue() {
        var keep = [], show = null;
        _embQueue.forEach(function (q) {
            if (S.cur < q.from - 1 || S.cur > q.due + 3) { return; }   // (a jump back or ahead since: dropped)
            if (S.cur >= q.due) { show = q; } else { keep.push(q); }
        });
        _embQueue = keep;
        if (show) { drawEmbedded(show.text, show.duration); }
    }
    function drawEmbedded(text, duration) {
        if (_embSub == null || _subOn) { return; }
        if (_embTimer) { clearTimeout(_embTimer); _embTimer = null; }
        var t = noTags(('' + (text || '')).replace(/<br\s*\/?>/gi, '\n')).replace(/\{[^}]+\}/g, '').trim();
        if (!t) { S.subsEl.className = 'hidden'; return; }
        S.subsEl.className = '';
        var span = S.subsEl.firstChild;
        if (!span) { span = document.createElement('span'); S.subsEl.appendChild(span); styleSpan(span); }
        span.textContent = t;
        _embTimer = setTimeout(function () { S.subsEl.className = 'hidden'; }, Math.max(500, (+duration) || 3000));
    }

    // ---------- menus ----------
    function applyStyleNow() {
        var span = S.subsEl.firstChild;
        if (span) { styleSpan(span); }
    }

    function subConfigMenu() {
        var items = [
            { label: 'Language', run: function () { pushMenu(langMenu()); } },
            { label: 'Size', run: function () { pushMenu(sizeMenu()); } },
            { label: 'Color', run: function () { pushMenu(optionMenu('Subtitle color', 'color', P.SUB_COLORS)); } },
            { label: 'Background', run: function () { pushMenu(optionMenu('Subtitle background', 'bg', P.SUB_BGS)); } },
            { label: 'Edge', run: function () { pushMenu(optionMenu('Subtitle edge', 'edge', P.SUB_EDGES)); } },
            { label: 'Position', run: function () { pushMenu(optionMenu('Subtitle position', 'pos', P.SUB_POSITIONS)); } },
            { label: 'Font', run: function () { pushMenu(fontMenu()); } }
        ];
        // timing applies to addon subtitles (built-in ones are timed by the player)
        if (_subOn) { items.splice(1, 0, { label: 'Timing', detail: fmtDelay(_subDelay), run: function () { pushMenu(timingMenu(5)); } }); }   // (opens on the small steps)
        else if (_embSub != null) { items.splice(1, 0, { label: 'Timing', detail: fmtDelay(_embDelay) + '  ·  built-in: later only', run: function () { pushMenu(embTimingMenu(0)); } }); }
        return { title: 'Subtitles', idx: 0, items: items, rebuild: subConfigMenu };
    }

    function fmtDelay(d) { return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(1) + ' s'; }
    // Nudge addon subtitles earlier/later; kept per title with that subtitle file.
    function timingMenu(idx) {
        function to(next) {
            return function () {
                _subDelay = Math.round(next() * 10) / 10;
                rememberSub(S.ctx.id, { lang: _subLabel, url: _subTrackUrl, trackId: _subTrackId, delay: _subDelay });
                renderSubs();
                replaceTop(timingMenu(topMenu().idx));
                U.toast('Subtitles: ' + fmtDelay(_subDelay) + (_subDelay > 0 ? ' (later)' : _subDelay < 0 ? ' (earlier)' : ' (as in the file)'), 1500);
            };
        }
        return { title: 'Subtitle timing: ' + fmtDelay(_subDelay), idx: idx || 0, items: [
            // by ear: the moment you hear a line sets the timing (then the steps fine-tune it)
            { label: 'Press when you hear it', detail: 'the next line: OK the moment it’s said', run: function () { pushMenu(earMenu()); } },
            { label: 'Pick the line being said', detail: 'from the lines around now', run: function () { pushMenu(lineMenu()); } },
            // (a file made for another release can be seconds off: the big steps get there)
            { label: 'Earlier  −5 s', run: to(function () { return _subDelay - 5; }) },
            { label: 'Earlier  −1 s', run: to(function () { return _subDelay - 1; }) },
            { label: 'Earlier  −0.5 s', run: to(function () { return _subDelay - 0.5; }) },
            { label: 'Earlier  −0.1 s', run: to(function () { return _subDelay - 0.1; }) },
            { label: 'Later  +0.1 s', run: to(function () { return _subDelay + 0.1; }) },
            { label: 'Later  +0.5 s', run: to(function () { return _subDelay + 0.5; }) },
            { label: 'Later  +1 s', run: to(function () { return _subDelay + 1; }) },
            { label: 'Later  +5 s', run: to(function () { return _subDelay + 5; }) },
            { label: 'Reset', run: to(function () { return 0; }) }
        ] };
    }

    // Sync by ear: the line said now is the file's line at `start`, so the timing is the gap.
    function syncTo(start) {
        _subDelay = Math.round((S.cur - start) * 10) / 10;
        rememberSub(S.ctx.id, { lang: _subLabel, url: _subTrackUrl, trackId: _subTrackId, delay: _subDelay });
        renderSubs();
        popMenu();
        replaceTop(timingMenu(topMenu().idx));
        U.toast('Subtitles: ' + fmtDelay(_subDelay) + (_subDelay > 0 ? ' (later)' : _subDelay < 0 ? ' (earlier)' : ' (as in the file)'), 1800);
    }
    function lineText(c) { return '“' + noTags('' + c.text).replace(/\s+/g, ' ').trim().slice(0, 70) + '”'; }
    // The next line coming up (as timed now): OK the moment it's said.
    function earMenu() {
        var t = S.cur - _subDelay, next = null;
        for (var i = 0; _cues && i < _cues.length; i++) { if (_cues[i].start > t + 0.3) { next = _cues[i]; break; } }
        if (!next) { return { title: 'Press when you hear it', idx: 0, items: [{ label: 'No line coming up', run: function () { popMenu(); } }] }; }
        return { title: 'Press OK when you hear it', idx: 0, items: [{ label: lineText(next), detail: 'OK the moment it’s said   ·   BACK: never mind', run: function () { syncTo(next.start); } }] };
    }
    // The lines around now (as timed now): pick the one being said, or just said.
    function lineMenu() {
        var t = S.cur - _subDelay, at = 0;
        for (var i = 0; _cues && i < _cues.length; i++) { if (_cues[i].start <= t) { at = i; } }
        var from = Math.max(0, at - 4), list = (_cues || []).slice(from, at + 4);
        if (!list.length) { return { title: 'Pick the line being said', idx: 0, items: [{ label: 'No lines in this file', run: function () { popMenu(); } }] }; }
        return { title: 'Pick the line being said', idx: at - from, items: list.map(function (c) {
            return { label: lineText(c), detail: 'at ' + U.fmtTime(c.start) + ' in the file', run: function () { syncTo(c.start); } };
        }) };
    }

    // A built-in track's timing: its lines held back (later); they can't come earlier than the
    // TV's player gives them. Kept per title with that track.
    function embTimingMenu(idx) {
        function to(next) {
            return function () {
                var want = Math.round(next() * 10) / 10;
                _embDelay = Math.max(0, want);
                _embQueue = [];
                rememberSub(S.ctx.id, { embedded: true, index: _embSub, lang: _embLang, delay: _embDelay });
                replaceTop(embTimingMenu(topMenu().idx));
                U.toast(want < 0 ? 'Built-in subtitles can\'t come earlier than the file has them' : 'Subtitles: ' + fmtDelay(_embDelay) + (_embDelay ? ' (later)' : ' (as in the file)'), 1800);
            };
        }
        return { title: 'Built-in subtitle timing: ' + fmtDelay(_embDelay), idx: idx || 0, items: [
            { label: 'Later  +0.1 s', run: to(function () { return _embDelay + 0.1; }) },
            { label: 'Later  +0.5 s', run: to(function () { return _embDelay + 0.5; }) },
            { label: 'Later  +1 s', run: to(function () { return _embDelay + 1; }) },
            { label: 'Later  +5 s', run: to(function () { return _embDelay + 5; }) },
            { label: 'Back  −0.5 s', run: to(function () { return _embDelay - 0.5; }) },
            { label: 'Back  −1 s', run: to(function () { return _embDelay - 1; }) },
            { label: 'Reset (as in the file)', run: to(function () { return 0; }) }
        ] };
    }

    // Level 1: Off + one row per language (with option count).
    // Level 1: one entry per language, spellings merged ("en", "eng" and "English" are one
    // group), named in full, with the file's own tracks in the same groups as the addons'.
    // Order: the language showing now, the preferred language, then by name.
    function langMenu() {
        var groups = Object.create(null), order = [];   // (no inherited names: a language an addon calls "__proto__" is just a key)
        function add(k, item) {
            if (!groups[k]) { groups[k] = []; order.push(k); }
            groups[k].push(item);
        }
        getTextTracks().forEach(function (tr, i) { add(langKey(textLang(tr)), { emb: tr, n: i }); });
        var offer = S.ctx && !S.ctx._relayCc ? S.ctx._ccOffer : null;   // (a live channel's closed captions, not on yet)
        (offer || []).forEach(function (c, i) { add(langKey(c.lang || ''), { cc: c, n: i, emb: true }); });
        _subTracks.forEach(function (tr) { add(langKey(tr.lang), { track: tr }); });
        var curKey = _subOn ? langKey(_subLabel) : (_embSub != null ? langKey(_embLang) : null);
        var pref = getSubCfg().lang;
        var prefs = [curKey, pref].filter(function (x) { return x && x !== 'off'; });
        order.sort(function (a, b) {
            var ra = langRank(a, prefs), rb = langRank(b, prefs);
            if (ra !== rb) { return ra - rb; }
            var na = langName(a), nb = langName(b);
            return na < nb ? -1 : na > nb ? 1 : 0;
        });
        var items = [{ label: 'Off', sel: !_subOn && _embSub == null, run: function () { subsOff(); secondOff(); rememberSub(S.ctx.id, { off: true }); closeMenu(); } }];
        order.forEach(function (k) {
            var list = groups[k], n = list.length, emb = list.filter(function (x) { return x.emb; }).length;
            items.push({ label: langName(k),
                detail: n + ' option' + (n > 1 ? 's' : '') + (emb ? (emb === n ? ', ' + inFile() : ', ' + emb + ' ' + inFile()) : ''),
                sel: (k === curKey),
                run: function () { pushMenu(langTracksMenu(k, list)); } });
        });
        var sec = getSubCfg().second;
        if (_subTracks.length) { items.push({ label: 'Second subtitle: ' + (sec === 'off' ? 'Off' : langName(sec)), detail: 'At the top, at the same time', run: function () { pushMenu(secondMenu()); } }); }
        var idx = 0;
        for (var i = 0; i < items.length; i++) { if (items[i].sel) { idx = i; break; } }
        return { title: 'Subtitle language', items: items, idx: idx, rebuild: langMenu };
    }

    function inFile() { return S.ctx && (S.ctx._relayCc || S.ctx._ccOffer) ? 'closed captions' : 'in the file'; }
    // Level 2: the tracks in one language: the file's own first, then each addon's.
    // Picking a track keeps the menu open, the checkmark on it (an addon's once it loads), so
    // several can be tried in a row: the file's own the same as an addon's.
    function langTracksMenu(key, list) {
        var idx = 0, nAddon = 0;
        list = list.filter(function (x) { return x.emb; }).concat(list.filter(function (x) { return !x.emb; }));
        var items = list.map(function (x, i) {
            if (x.cc) {   // (turning a live channel's closed captions on: it restarts with them)
                var c = x.cc;
                return { label: 'Closed captions (' + c.ch + ')', detail: 'The channel restarts with them',
                    run: function () { closeMenu(); rememberSub(S.ctx.id, { embedded: true, nth: x.n, lang: c.lang }); P.ccOn(c); } };
            }
            if (x.emb) {
                var tr = x.emb, l = textLang(tr);
                if (_embSub === tr.index) { idx = i; }
                return { label: (S.ctx && S.ctx._relayCc ? 'Closed captions' : 'Built into the file') + (l ? '  (' + l + ')' : '  ·  track ' + (x.n + 1)), sel: _embSub === tr.index,
                    run: function () {
                        _embDelay = 0; _embQueue = []; _embNudge = null; selectEmbeddedSub(tr); rememberSub(S.ctx.id, { embedded: true, index: tr.index, lang: l });
                        if (menuOpen()) { replaceTop(langTracksMenu(key, list)); }
                    } };
            }
            var t = x.track;
            nAddon++;
            if (_subTrackUrl === t.url) { idx = i; }
            return { label: t._file ? t._addon + '  ·  ' + t._file : (t._addon || 'Source') + '  ·  option ' + nAddon +
                    (t.lang && langName(t.lang).toLowerCase() !== ('' + t.lang).toLowerCase() ? '  (' + t.lang + ')' : ''),
                sel: (_subTrackUrl === t.url),
                run: function () {
                    loadTrack(t, function () {
                        if (menuOpen()) { replaceTop(langTracksMenu(key, list)); }
                    });
                    rememberSub(S.ctx.id, { lang: t.lang, url: t.url, trackId: t.id });
                } };
        });
        return { title: langName(key) + ' subtitles', items: items, idx: idx };
    }

    function optionMenu(title, key, opts) {
        var cfg = getSubCfg();
        var idx = 0;
        var items = opts.map(function (p, i) {
            if (cfg[key] === p[0]) { idx = i; }
            return { label: p[1], sel: (cfg[key] === p[0]), run: function () {
                var c = getSubCfg(); c[key] = p[0]; setSubCfg(c); applyStyleNow();
                replaceTop(optionMenu(title, key, opts)); // refresh checkmark
            } };
        });
        return { title: title, items: items, idx: idx };
    }
    function sizeMenu() {
        return optionMenu('Subtitle size', 'size',
            [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra Large']]);
    }
    function fontMenu() { return optionMenu('Subtitle font', 'font', P.SUB_FONTS); }

    // ----- for the other parts (and js/player.js) -----
    // The player's number keys (player-controls' numberKey): 1 / 2 / 3 timing (an addon track's
    // earlier / as the file / later, kept for the title as the Timing menu's; a built-in track's
    // later only), 4 / 5 / 6 position, 7 / 8 / 9 size. Each says what it did.
    var KEY_POS = { 4: ['lower', 'Lower'], 5: ['bottom', 'Bottom'], 6: ['raised', 'Raised'] };
    var KEY_SIZE = { 7: ['medium', 'Medium'], 8: ['large', 'Large'], 9: ['xlarge', 'Extra Large'] };
    function subsKey(n) {
        if (n >= 1 && n <= 3) {
            var step = n === 1 ? -0.1 : n === 3 ? 0.1 : 0;
            if (_subOn) {
                _subDelay = step ? Math.round((_subDelay + step) * 10) / 10 : 0;
                rememberSub(S.ctx.id, { lang: _subLabel, url: _subTrackUrl, trackId: _subTrackId, delay: _subDelay });
                renderSubs();
                U.toast('Subtitles: ' + fmtDelay(_subDelay) + (_subDelay > 0 ? ' (later)' : _subDelay < 0 ? ' (earlier)' : ' (as in the file)'), 1500);
            } else if (_embSub != null) {
                var was = _embDelay;
                _embDelay = step ? Math.max(0, Math.round((_embDelay + step) * 10) / 10) : 0;
                rememberSub(S.ctx.id, { embedded: true, index: _embSub, lang: _embLang, delay: _embDelay });
                U.toast('Subtitles: ' + fmtDelay(_embDelay) + (step < 0 && was === 0 ? ' (built-in: later only)' : ''), 1500);
            } else {
                U.toast('No subtitles on', 1500);
            }
            return;
        }
        var look = KEY_POS[n] ? ['pos', KEY_POS[n]] : KEY_SIZE[n] ? ['size', KEY_SIZE[n]] : null;
        if (!look) { return; }
        var cfg = getSubCfg();
        cfg[look[0]] = look[1][0];
        setSubCfg(cfg);
        var span = S.subsEl && S.subsEl.firstChild;
        if (span) { styleSpan(span); }
        U.toast('Subtitles: ' + look[1][1] + (look[0] === 'size' ? ' size' : ''), 1500);
    }
    // The subtitle that's on, for a download (player-controls): an addon's file { url, lang },
    // { embedded: true } (built into the video: it comes with it), or null (off).
    function activeSub() {
        if (_subOn && /^file:/.test('' + _subTrackId)) { return null; }   // (a file on a USB drive: there already)
        if (_subOn && /^https?:\/\//i.test(_subTrackUrl || '')) { return { url: _subTrackUrl, lang: _subLabel }; }
        if (_embSub != null) { return { embedded: true }; }
        return null;
    }
    P.activeSub = activeSub;
    P.subsKey = subsKey;
    P.fileHints = fileHints; P.parseCues = parseCues; P.loadTrack = loadTrack; P.subsOff = subsOff;
    P.resetSubs = resetSubs; P.closeSubs = closeSubs; P.startSubtitles = startSubtitles;
    P.subsBeforeOpen = subsBeforeOpen; P.subsOnTick = subsOnTick; P.subtitleSummary = subtitleSummary;
    P.wantEmbedded = wantEmbedded;
    P.renderSubs = renderSubs; P.showEmbeddedText = showEmbeddedText; P.subConfigMenu = subConfigMenu; P.langMenu = langMenu;
})(PlayerParts);
