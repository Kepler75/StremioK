/* Player, part 5 of 7 — subtitles: addon tracks (download, parse, draw, timing), the file's
   own tracks, and the subtitle menus.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';
    var S = P.S;
    var avplay = P.avplay;   // (P.useAV: the TV's player's playback or the page's, as it is now: see player-core's engineFor)

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
        _subGen++; stopSubLoad();
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
            return { id: 'yt:' + t.lang + (t.auto ? ':auto' : ''), lang: t.lang, url: YTPlay.subsUrl(ctx.yt, t.lang, !!t.auto), _addon: t.auto ? U.t('YouTube (automatic)') : 'YouTube' };
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
        return _subOn ? (_subLabel + (_subDelay ? '  (' + fmtDelay(_subDelay) + ')' : '')) : (_embSub != null ? (_embLang || U.t('on')) + '  ' + U.t('(built-in)') : U.t('Off'));
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
    // A cue: { start, end, text } (text: as read, plain), with runs when it has styling: [{ t, i, b,
    // u, c }] (italic, bold, underline, a color '#rrggbb'), pieces drawn as text (drawCues).
    // The format told by the file's content, whatever its name: ASS / SSA, SAMI, MicroDVD, MPL2,
    // TMPlayer, else SRT / WebVTT.
    var CUES_MAX = 20000, CUE_TEXT_MAX = 1000;
    function parseCues(text) {
        text = ('' + text).replace(/\r/g, '').replace(/^﻿/, '');
        var head = text.slice(0, 4096), cues;
        if (/^\s*\[script info\]/i.test(head) || /^\[v4\+? styles\]/im.test(head) || /^dialogue\s*:/im.test(head)) { cues = parseAss(text); }
        else if (/<sami[\s>]/i.test(head)) { cues = parseSami(text); }
        else if (/^\s*\{\d+\}\{\d*\}/.test(head)) { cues = parseFramed(text); }
        else if (/^\s*\[\d+\]\[\d*\]/.test(head)) { cues = parseMpl2(text); }
        else if (/^\s*\d{1,2}:\d{2}:\d{2}[:=]/.test(head) && head.indexOf('-->') === -1) { cues = parseTmp(text); }
        else { cues = parseSrt(text); }
        cues.sort(function (a, b) { return a.start - b.start; });
        return cues;
    }
    // A cue from its runs: neighbours styled alike joined, the ends' spaces trimmed; runs kept only
    // when one is styled; Skip lines with applied (a line taken out: the cue plain).
    function makeCue(start, end, runs, skip) {
        var out = [];
        runs.forEach(function (r) {
            if (!r.t) { return; }
            var last = out[out.length - 1];
            if (last && !!last.i === !!r.i && !!last.b === !!r.b && !!last.u === !!r.u && (last.c || '') === (r.c || '')) { last.t += r.t; return; }
            out.push(runOf(r.t, r));
        });
        while (out.length && !/\S/.test(out[0].t)) { out.shift(); }
        while (out.length && !/\S/.test(out[out.length - 1].t)) { out.pop(); }
        if (!out.length) { return null; }
        out[0].t = out[0].t.replace(/^\s+/, '');
        out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '');
        var plain = out.map(function (r) { return r.t; }).join('').slice(0, CUE_TEXT_MAX);
        var txt = skip(plain);
        if (!txt) { return null; }
        var cue = { start: start, end: end, text: txt };
        if (txt === plain && out.some(function (r) { return r.i || r.b || r.u || r.c; })) { cue.runs = out; }
        return cue;
    }
    function runOf(t, st) {
        var r = { t: t };
        if (st.i) { r.i = true; } if (st.b) { r.b = true; } if (st.u) { r.u = true; } if (st.c) { r.c = st.c; }
        return r;
    }
    // A color as '#rrggbb': #rgb / #rrggbb, or a plain color name (red); else none.
    function cssColor(x) {
        x = ('' + (x || '')).trim().toLowerCase().replace(/^["']|["']$/g, '');
        var m = /^#?([0-9a-f]{6})$/.exec(x);
        if (m) { return '#' + m[1]; }
        m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(x);
        if (m) { return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]; }
        return /^[a-z]{3,20}$/.test(x) ? x : '';
    }
    // HTML-like text (SRT, WebVTT, SAMI) as runs: <i> <b> <u> <font color> kept as styling, <br> a new
    // line, other tags and a stray < left out (one pass, in time with the text's length), character
    // codes read after (one written as &lt; is the file's own text: "<b>" shown as written).
    function tagRuns(t) {
        var runs = [], st = { i: 0, b: 0, u: 0 }, colors = [], i = 0, n = t.length;
        function add(s) { if (s) { runs.push(runOf(charCodes(s), { i: st.i > 0, b: st.b > 0, u: st.u > 0, c: colors[colors.length - 1] })); } }
        while (i < n) {
            var lt = t.indexOf('<', i);
            if (lt === -1) { add(t.slice(i)); break; }
            add(t.slice(i, lt));
            var gt = t.indexOf('>', lt + 1);
            if (gt === -1) { add(t.slice(lt + 1).split('<').join('')); break; }   // (no tag ends after it: the rest, its < gone)
            var m = /^\s*(\/?)\s*([a-zA-Z]+)([\s\S]*)$/.exec(t.slice(lt + 1, gt));
            i = gt + 1;
            if (!m) { continue; }
            var close = m[1] === '/', name = m[2].toLowerCase();
            if (name === 'i' || name === 'b' || name === 'u') { st[name] = close ? Math.max(0, st[name] - 1) : st[name] + 1; }
            else if (name === 'font') {
                if (close) { colors.pop(); }
                else { var cm = /color\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(m[3]); colors.push(cm ? cssColor(cm[1]) : colors[colors.length - 1]); }
            }
            else if (name === 'br' && !close) { runs.push({ t: '\n' }); }
        }
        return runs;
    }
    function parseSrt(text) {
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
            var cue = makeCue(start, end, tagRuns(lines.slice(ti + 1).join('\n').slice(0, CUE_TEXT_MAX).replace(/\{\\[^}]*\}/g, '')), skip);   // ({\an8}: an ASS position, not shown)
            if (cue) { cues.push(cue); }
        }
        return cues;
    }
    // SAMI (.smi): <SYNC Start=ms> marks; a line shows until the next one (a blank one ends it).
    function parseSami(text) {
        var cues = [], skip = skipper(), re = /<sync[^>]*?start\s*=\s*["']?(\d+)[^>]*>/gi, marks = [], m;
        while ((m = re.exec(text)) && marks.length < CUES_MAX) { marks.push({ at: +m[1] / 1000, from: re.lastIndex, to: text.length }); if (marks.length > 1) { marks[marks.length - 2].to = m.index; } }
        for (var i = 0; i < marks.length; i++) {
            var body = text.slice(marks[i].from, Math.min(marks[i].to, marks[i].from + CUE_TEXT_MAX * 4)).replace(/<\/(body|sami)>[\s\S]*$/i, '').replace(/\s*\n\s*/g, ' ');
            var end = i + 1 < marks.length ? marks[i + 1].at : marks[i].at + 4;
            var cue = makeCue(marks[i].at, end, tagRuns(body), skip);
            if (cue) { cues.push(cue); }
        }
        return cues;
    }
    // A line's own styling in the frame-based formats: MicroDVD's {y:i} {y:b} {y:u} {c:$BBGGRR} at its
    // start, a / starting a line for italics (MPL2, often MicroDVD); | between lines.
    function slashRuns(body, st) {
        var runs = [];
        body.split('|').forEach(function (line, k) {
            if (k) { runs.push({ t: '\n' }); }
            var it = /^\s*\//.test(line);
            runs.push(runOf(line.replace(/^\s*\//, '').replace(/\{[^}]*\}/g, ''), { i: st.i || it, b: st.b, u: st.u, c: st.c }));
        });
        return runs;
    }
    // MicroDVD (.sub, .txt): {start frame}{end frame}text, at the frame rate its first line gives
    // ({1}{1}25.000), else 23.976.
    function parseFramed(text) {
        var lines = text.split('\n'), cues = [], skip = skipper(), fps = 23.976, re = /^\s*\{(\d+)\}\{(\d*)\}(.*)$/;
        for (var i = 0; i < lines.length && cues.length < CUES_MAX; i++) {
            var m = re.exec(lines[i]);
            if (!m) { continue; }
            var rate = /^\s*(\d{1,3}(?:\.\d+)?)\s*$/.exec(m[3]);
            if (!cues.length && rate && +rate[1] >= 10 && +rate[1] <= 120 && +m[1] <= 1) { fps = +rate[1]; continue; }
            var body = m[3].slice(0, CUE_TEXT_MAX), st = {}, code;
            while ((code = /^\s*\{([a-zA-Z]):([^}]*)\}/.exec(body))) {
                var k = code[1].toLowerCase(), v = code[2].toLowerCase();
                if (k === 'y') { st.i = v.indexOf('i') !== -1; st.b = v.indexOf('b') !== -1; st.u = v.indexOf('u') !== -1; }
                else if (k === 'c') { var hx = /\$?([0-9a-f]{6})/.exec(v); if (hx) { st.c = '#' + hx[1].slice(4, 6) + hx[1].slice(2, 4) + hx[1].slice(0, 2); } }
                body = body.slice(code[0].length);
            }
            var start = +m[1] / fps, end = m[2] !== '' ? +m[2] / fps : start + 3;
            var cue = makeCue(start, end, slashRuns(body, st), skip);
            if (cue) { cues.push(cue); }
        }
        return cues;
    }
    // MPL2 (.txt): [start][end] in tenths of a second.
    function parseMpl2(text) {
        var lines = text.split('\n'), cues = [], skip = skipper(), re = /^\s*\[(\d+)\]\[(\d*)\](.*)$/;
        for (var i = 0; i < lines.length && cues.length < CUES_MAX; i++) {
            var m = re.exec(lines[i]);
            if (!m) { continue; }
            var start = +m[1] / 10, end = m[2] !== '' ? +m[2] / 10 : start + 3;
            var cue = makeCue(start, end, slashRuns(m[3].slice(0, CUE_TEXT_MAX), {}), skip);
            if (cue) { cues.push(cue); }
        }
        return cues;
    }
    // TMPlayer (.txt): hh:mm:ss:text, no end: each line until the next, TMP_MAX seconds at most.
    var TMP_MAX = 5;
    function parseTmp(text) {
        var lines = text.split('\n'), marks = [], skip = skipper(), re = /^\s*(\d{1,2}):(\d{2}):(\d{2})[:=](.*)$/, cues = [];
        for (var i = 0; i < lines.length && marks.length < CUES_MAX; i++) {
            var m = re.exec(lines[i]);
            if (m) { marks.push({ at: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]), body: m[4].slice(0, CUE_TEXT_MAX) }); }
        }
        for (var j = 0; j < marks.length; j++) {
            var next = j + 1 < marks.length ? marks[j + 1].at : Infinity;
            var cue = makeCue(marks[j].at, Math.min(next, marks[j].at + TMP_MAX), slashRuns(marks[j].body, {}), skip);
            if (cue) { cues.push(cue); }
        }
        return cues;
    }
    // ASS / SSA: its Dialogue lines, with each line's style (its color, bold, italic, underline) and
    // the overrides in it ({\i1} {\b1} {\u1} {\c&HBBGGRR&} {\r}); drawings ({\p1}) and positions left out.
    function assColor(x) {
        x = ('' + (x || '')).trim();
        var v = /^&h/i.test(x) ? parseInt(x.replace(/^&h/i, '').replace(/&$/, ''), 16) : parseInt(x, 10);
        if (isNaN(v)) { return ''; }
        var hex = function (n) { return ('0' + n.toString(16)).slice(-2); };
        var c = '#' + hex(v & 0xFF) + hex((v >> 8) & 0xFF) + hex((v >> 16) & 0xFF);
        return c === '#ffffff' ? '' : c;   // (white: a file's usual color, yours shown instead)
    }
    function assTime(s) {
        var m = /^\s*(\d+):(\d{2}):(\d{2})[.:](\d{1,3})\s*$/.exec(s || '');
        return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + +((m[4] + '00').slice(0, 3)) / 1000 : null;
    }
    function parseAss(text) {
        var lines = text.split('\n'), sect = '', sFmt = null, eFmt = null, styles = {}, cues = [], skip = skipper();
        function on(v) { v = ('' + (v || '')).trim(); return v !== '' && v !== '0'; }
        function fields(rest, fmt) {
            var parts = rest.split(','), f = {}, n = fmt.length;
            if (parts.length < n) { return null; }
            for (var k = 0; k < n - 1; k++) { f[fmt[k]] = parts[k].trim(); }
            f[fmt[n - 1]] = parts.slice(n - 1).join(',');
            return f;
        }
        for (var i = 0; i < lines.length && cues.length < CUES_MAX; i++) {
            var l = lines[i], h = /^\s*\[([^\]]+)\]\s*$/.exec(l), m;
            if (h) { sect = h[1].toLowerCase(); continue; }
            if ((m = /^\s*format\s*:\s*(.*)$/i.exec(l))) {
                var fmt = m[1].split(',').map(function (x) { return x.trim().toLowerCase(); });
                if (/styles/.test(sect)) { sFmt = fmt; } else if (sect === 'events') { eFmt = fmt; }
                continue;
            }
            if ((m = /^\s*style\s*:\s*(.*)$/i.exec(l)) && sFmt) {
                var s = fields(m[1], sFmt);
                if (s) { styles[(s.name || '').toLowerCase()] = { i: on(s.italic), b: on(s.bold), u: on(s.underline), c: assColor(s.primarycolour || s.primarycolor) }; }
                continue;
            }
            if (!(m = /^\s*dialogue\s*:\s*(.*)$/i.exec(l))) { continue; }
            var f = fields(m[1], eFmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']);
            if (!f) { continue; }
            var start = assTime(f.start), end = assTime(f.end);
            if (start === null || end === null) { continue; }
            var cue = makeCue(start, end, assRuns(('' + (f.text || '')).slice(0, CUE_TEXT_MAX * 2), styles, (f.style || '').replace(/^\*/, '').toLowerCase()), skip);
            if (cue) { cues.push(cue); }
        }
        return cues;
    }
    function assRuns(t, styles, name) {
        var base = styles[name] || styles['default'] || {}, st = runOf('', base), runs = [], draw = false, i = 0, n = t.length;
        function add(s) {
            if (!s || draw) { return; }
            runs.push(runOf(s.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '), st));
        }
        while (i < n) {
            var ob = t.indexOf('{', i);
            if (ob === -1) { add(t.slice(i)); break; }
            add(t.slice(i, ob));
            var cb = t.indexOf('}', ob + 1);
            if (cb === -1) { break; }
            var block = t.slice(ob + 1, cb), re = /\\(1c|c|[ibu]|r|p)([^\\]*)/g, m;
            i = cb + 1;
            while ((m = re.exec(block))) {
                var k = m[1], v = m[2].trim();
                if (k === 'i' || k === 'u') { if (/^[01]$/.test(v)) { st[k] = v === '1'; } }
                else if (k === 'b') { if (/^\d+$/.test(v)) { st.b = v === '1' || +v >= 600; } }
                else if (k === 'c' || k === '1c') { var c = /^&?h([0-9a-f]{1,8})&?$/i.exec(v); if (c || !v) { st.c = c ? assColor('&H' + c[1]) : base.c; } }   // (\c alone: the style's; \clip isn't a color)
                else if (k === 'r') { var to = (v && styles[v.toLowerCase()]) || base; st = runOf('', to); }
                else if (k === 'p') { draw = /^\d+$/.test(v) && +v > 0; }
            }
        }
        return runs;
    }

    // Lines that overlap (dialogue and a sign) show together, up to SHOW_MAX, the earliest first.
    var SHOW_MAX = 4;
    function renderSubs() {
        if (_embQueue.length) { flushEmbQueue(); }
        renderSecond();
        if (!_subOn || !_cues) { return; }
        var t = S.cur - _subDelay;   // timing adjustment: + shows later, − earlier
        var show = [], key = '';
        // Skip the prefix of cues that already ended (they can't show again unless we go
        // back in time, which resets the index), then scan as before. Same cues as a full
        // scan from 0, without walking the whole list late in a movie on every tick.
        // (A long cue keeps the index at it: those after it that ended are passed over below.)
        if (t < _cueT) { _cueIdx = 0; }
        _cueT = t;
        while (_cueIdx < _cues.length && _cues[_cueIdx].end < t) { _cueIdx++; }
        for (var i = _cueIdx; i < _cues.length && show.length < SHOW_MAX; i++) {
            if (_cues[i].start > t) { break; }
            if (t <= _cues[i].end) { show.push(_cues[i]); key += i + ','; }
        }
        if (show.length) {
            S.subsEl.className = '';
            var span = S.subsEl.firstChild;
            if (!span) { span = document.createElement('span'); S.subsEl.appendChild(span); styleSpan(span); }
            key += P.subCfgVersion ? P.subCfgVersion() : '';
            if (span.__cues !== key || span.__list !== _cues) { drawCues(span, show); span.__cues = key; span.__list = _cues; }   // (drawn again only when what shows changes)
        } else {
            S.subsEl.className = 'hidden';
        }
    }
    // The line's text, from its cues: each its own line; a styled cue's pieces each their own span,
    // written as text (textContent: never markup). The file's colors only with Subtitles ›
    // Appearance › The file's colors On (else yours: the line's own color).
    function drawCues(span, cues) {
        var colors = getSubCfg().fileColors === 'on';
        U.clear(span);
        cues.forEach(function (cue, k) {
            var runs = (k ? [{ t: '\n' }] : []).concat(cue.runs || [{ t: cue.text }]);   // (each cue its own line: the break unstyled)
            runs.forEach(function (r) {
                var piece = document.createElement('span');
                piece.textContent = r.t;
                if (r.i) { piece.style.fontStyle = 'italic'; }
                if (r.b) { piece.style.fontWeight = 'bold'; }
                if (r.u) { piece.style.textDecoration = 'underline'; }
                if (r.c && colors) { piece.style.color = r.c; }
                span.appendChild(piece);
            });
        });
    }

    // Each choice (a track, Off, a built-in one) is a new one: a download still on its way
    // for an earlier choice is dropped when it comes, without a word (_subGen).
    var _subGen = 0;
    // A subtitle file's time to arrive: some servers build it when asked (12 s, seen from an
    // OpenSubtitles proxy); the video plays on meanwhile.
    var SUB_FILE_MS = 20000;
    // The download under way (_subLoad: { url, ctx, cancel, timer, done }): the same track picked
    // again while it comes waits for it (it used to be asked for again, what was on its way
    // dropped: slow servers took several picks); another choice stops it, its connection freed.
    // The files downloaded (the last SUB_FILES_MAX, while StremioK runs) come back at once.
    var _subLoad = null, SUB_FILES_MAX = 8, _subFiles = [];   // ([{ url, text }], newest last)
    function subFile(url) { for (var i = 0; i < _subFiles.length; i++) { if (_subFiles[i].url === url) { return _subFiles[i].text; } } return null; }
    function keepSubFile(url, text) {
        _subFiles = _subFiles.filter(function (f) { return f.url !== url; });
        _subFiles.push({ url: url, text: text });
        if (_subFiles.length > SUB_FILES_MAX) { _subFiles.shift(); }
    }
    function stopSubLoad() {
        var l = _subLoad;
        _subLoad = null;
        if (l) { clearInterval(l.timer); l.cancel.cancel(); }
    }
    // A subtitle file: from those kept, else downloaded (the same one shared by whoever asks).
    function subText(track, cancel) {
        var kept = subFile(track.url);
        if (kept !== null) { return Promise.resolve(kept); }
        return U.getText(track.url, SUB_FILE_MS, undefined, cancel || null, false, track.headers || null).then(function (text) { keepSubFile(track.url, text); return text; });   // (a USB file's: the service's header where there's no token)
    }
    function loadTrack(track, onDone) {
        if (!U.parseUrl(track.url)) { U.toast(U.t('That subtitle track has no usable link')); return; }   // (http(s) only)
        var l = _subLoad;
        if (l && l.url === track.url && l.ctx === S.ctx) {   // (still coming: waited for, not asked for again)
            if (onDone) { l.done.push(onDone); }
            U.toast(U.t('Still loading subtitles… {n} s', { n: l.secs }), 1500);
            return;
        }
        stopSubLoad();
        var forCtx = S.ctx, gen = ++_subGen;
        function stale() { return !S.active || S.ctx !== forCtx || gen !== _subGen; }   // (another playback, or another choice, meanwhile)
        var cancel = U.cancelToken(), mine = { url: track.url, ctx: forCtx, cancel: cancel, secs: 0, done: onDone ? [onDone] : [], timer: null };
        if (subFile(track.url) === null) {   // (a download: how long it's been, every second, till it's in)
            _subLoad = mine;
            U.toast(U.t('Loading subtitles…'), 1500);
            mine.timer = setInterval(function () { mine.secs++; if (_subLoad === mine) { U.toast(U.t('Loading subtitles… {n} s', { n: mine.secs }), 1500); } }, 1000);
        }
        function finished() { clearInterval(mine.timer); if (_subLoad === mine) { _subLoad = null; } }
        onDone = function () { mine.done.forEach(function (f) { try { f(); } catch (e) {} }); };
        subText(track, cancel).then(function (text) {
            finished();
            if (stale()) { return; }
            var cues = parseCues(text);
            if (!cues.length) { U.toast(U.t('Could not parse subtitles')); return; }
            embOff();   // an addon track replaces a built-in one
            _cues = cues; _cueIdx = 0; _cueT = 0; _subOn = true; _subLabel = track.lang || 'on'; _subTrackUrl = track.url;
            _subTrackId = (track.id != null) ? track.id : null; _subDelay = 0;
            renderSubs();
            U.toast(U.t('Subtitles: {what}', { what: track.lang || U.t('on') }));
            onDone();
        }, function () { finished(); if (!stale()) { U.toast(U.t('Failed to download subtitles')); } });
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
        subText(track).then(function (text) {
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
        var items = [{ label: U.t('Off'), sel: cur === 'off', run: function () { var c = getSubCfg(); c.second = 'off'; setSubCfg(c); secondOff(); popMenu(); } }];
        keys.forEach(function (k) {
            items.push({ label: langName(k), sel: langKey(cur) === k, run: function () {
                var c = getSubCfg(); c.second = /^[a-z]{2,3}$/.test(k) ? k : 'off'; setSubCfg(c); secondOff(); startSecond(); popMenu();
            } });
        });
        var idx = 0;
        items.forEach(function (it, i) { if (it.sel) { idx = i; } });
        return { title: U.t('Second subtitle (at the top)'), items: items, idx: idx };
    }

    function subsOff() {
        _subGen++; stopSubLoad();   // (a download under way for a track: stopped)
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
        if (!P.useAV) { return []; }
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
        // (of a language's tracks, by the file's header: a full one in text, then any in text — a
        // picture one, PGS, shows nothing here — then a forced one)
        var own = P.fileTracks ? P.fileTracks('subs', tracks) : null;
        function best(match) {
            var c = tracks.filter(match);
            if (!own || c.length < 2) { return c[0] || null; }
            var o = function (t) { return own[tracks.indexOf(t)] || {}; };
            return c.filter(function (t) { return o(t).text !== false && !o(t).forced; })[0] || c.filter(function (t) { return o(t).text !== false; })[0] || c[0];
        }
        if (w.index != null) {
            pick = tracks.find(function (t) { return t.index === w.index && (!key || langKey(textLang(t)) === key); }) || null;
        }
        if (!pick && key) { pick = best(function (t) { return langMatches(key, textLang(t)); }); }
        if (!pick && w.nth != null && S.ctx && S.ctx._relayCc) { pick = tracks[w.nth] || null; }   // (a live channel's closed captions: in the order asked for)
        if (!pick && w.lang2) {   // nothing in the default language anywhere: the second choice, a track to download first
            var key2 = langKey(w.lang2);
            var dl = _subTracks.find(function (t) { return langMatches(key2, t.lang); });
            if (dl) { loadTrack(dl); return; }
            pick = best(function (t) { return langMatches(key2, textLang(t)); });
        }
        if (pick) { selectEmbeddedSub(pick); _embNudge = { index: pick.index, at: Date.now() + EMB_NUDGE_MS }; }
    }
    function selectEmbeddedSub(tr) {
        subsOff();   // addon subtitles (and any other built-in track) off
        try { avplay.setSilentSubtitle(false); } catch (e) {}
        try { avplay.setSelectTrack('TEXT', tr.index); }
        catch (e2) { try { avplay.setSelectTrack('TEXT', '' + tr.index); } catch (e3) {} }
        _embSub = tr.index; _embLang = textLang(tr);
        U.toast(U.t('Subtitles: {what}', { what: (_embLang || U.t('on')) + ' ' + (S.ctx && S.ctx._relayCc ? U.t('(closed captions)') : U.t('(built-in)')) }), 1800);
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
        span.textContent = t; span.__list = null;
        _embTimer = setTimeout(function () { S.subsEl.className = 'hidden'; }, Math.max(500, (+duration) || 3000));
    }

    // ---------- menus ----------
    function applyStyleNow() {
        var span = S.subsEl.firstChild;
        if (span) { styleSpan(span); }
    }

    function subConfigMenu() {
        var items = [
            { label: U.t('Language'), run: function () { pushMenu(langMenu()); } },
            { label: U.t('Size'), run: function () { pushMenu(sizeMenu()); } },
            { label: U.t('Color'), run: function () { pushMenu(optionMenu(U.t('Subtitle color'), 'color', P.SUB_COLORS)); } },
            { label: U.t('Background'), run: function () { pushMenu(optionMenu(U.t('Subtitle background'), 'bg', P.SUB_BGS)); } },
            { label: U.t('Edge'), run: function () { pushMenu(optionMenu(U.t('Subtitle edge'), 'edge', P.SUB_EDGES)); } },
            { label: U.t('Position'), run: function () { pushMenu(optionMenu(U.t('Subtitle position'), 'pos', P.SUB_POSITIONS)); } },
            { label: U.t('Font'), run: function () { pushMenu(fontMenu()); } }
        ];
        // timing applies to addon subtitles (built-in ones are timed by the player)
        if (_subOn) { items.splice(1, 0, { label: U.t('Timing'), detail: fmtDelay(_subDelay), run: function () { pushMenu(timingMenu(5)); } }); }   // (opens on the small steps)
        else if (_embSub != null) { items.splice(1, 0, { label: U.t('Timing'), detail: fmtDelay(_embDelay) + '  ·  ' + U.t('built-in: later only'), run: function () { pushMenu(embTimingMenu(0)); } }); }
        return { title: U.t('Subtitles'), idx: 0, items: items, rebuild: subConfigMenu };
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
                U.toast(U.t('Subtitles: {what}', { what: fmtDelay(_subDelay) + ' ' + (_subDelay > 0 ? U.t('(later)') : _subDelay < 0 ? U.t('(earlier)') : U.t('(as in the file)')) }), 1500);
            };
        }
        return { title: U.t('Subtitle timing: {delay}', { delay: fmtDelay(_subDelay) }), idx: idx || 0, items: [
            // by ear: the moment you hear a line sets the timing (then the steps fine-tune it)
            { label: U.t('Press when you hear it'), detail: U.t('the next line: OK the moment it’s said'), run: function () { pushMenu(earMenu()); } },
            { label: U.t('Pick the line being said'), detail: U.t('from the lines around now'), run: function () { pushMenu(lineMenu()); } },
            // (a file made for another release can be seconds off: the big steps get there)
            { label: U.t('Earlier  −5 s'), run: to(function () { return _subDelay - 5; }) },
            { label: U.t('Earlier  −1 s'), run: to(function () { return _subDelay - 1; }) },
            { label: U.t('Earlier  −0.5 s'), run: to(function () { return _subDelay - 0.5; }) },
            { label: U.t('Earlier  −0.1 s'), run: to(function () { return _subDelay - 0.1; }) },
            { label: U.t('Later  +0.1 s'), run: to(function () { return _subDelay + 0.1; }) },
            { label: U.t('Later  +0.5 s'), run: to(function () { return _subDelay + 0.5; }) },
            { label: U.t('Later  +1 s'), run: to(function () { return _subDelay + 1; }) },
            { label: U.t('Later  +5 s'), run: to(function () { return _subDelay + 5; }) },
            { label: U.t('Reset'), run: to(function () { return 0; }) }
        ] };
    }

    // Sync by ear: the line said now is the file's line at `start`, so the timing is the gap.
    function syncTo(start) {
        _subDelay = Math.round((S.cur - start) * 10) / 10;
        rememberSub(S.ctx.id, { lang: _subLabel, url: _subTrackUrl, trackId: _subTrackId, delay: _subDelay });
        renderSubs();
        popMenu();
        replaceTop(timingMenu(topMenu().idx));
        U.toast(U.t('Subtitles: {what}', { what: fmtDelay(_subDelay) + ' ' + (_subDelay > 0 ? U.t('(later)') : _subDelay < 0 ? U.t('(earlier)') : U.t('(as in the file)')) }), 1800);
    }
    function lineText(c) { return '“' + noTags('' + c.text).replace(/\s+/g, ' ').trim().slice(0, 70) + '”'; }
    // The next line coming up (as timed now): OK the moment it's said.
    function earMenu() {
        var t = S.cur - _subDelay, next = null;
        for (var i = 0; _cues && i < _cues.length; i++) { if (_cues[i].start > t + 0.3) { next = _cues[i]; break; } }
        if (!next) { return { title: U.t('Press when you hear it'), idx: 0, items: [{ label: U.t('No line coming up'), run: function () { popMenu(); } }] }; }
        return { title: U.t('Press OK when you hear it'), idx: 0, items: [{ label: lineText(next), detail: U.t('OK the moment it’s said   ·   BACK: never mind'), run: function () { syncTo(next.start); } }] };
    }
    // The lines around now (as timed now): pick the one being said, or just said.
    function lineMenu() {
        var t = S.cur - _subDelay, at = 0;
        for (var i = 0; _cues && i < _cues.length; i++) { if (_cues[i].start <= t) { at = i; } }
        var from = Math.max(0, at - 4), list = (_cues || []).slice(from, at + 4);
        if (!list.length) { return { title: U.t('Pick the line being said'), idx: 0, items: [{ label: U.t('No lines in this file'), run: function () { popMenu(); } }] }; }
        return { title: U.t('Pick the line being said'), idx: at - from, items: list.map(function (c) {
            return { label: lineText(c), detail: U.t('at {at} in the file', { at: U.fmtTime(c.start) }), run: function () { syncTo(c.start); } };
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
                U.toast(want < 0 ? U.t('Built-in subtitles can\'t come earlier than the file has them') : U.t('Subtitles: {what}', { what: fmtDelay(_embDelay) + ' ' + (_embDelay ? U.t('(later)') : U.t('(as in the file)')) }), 1800);
            };
        }
        return { title: U.t('Built-in subtitle timing: {delay}', { delay: fmtDelay(_embDelay) }), idx: idx || 0, items: [
            { label: U.t('Later  +0.1 s'), run: to(function () { return _embDelay + 0.1; }) },
            { label: U.t('Later  +0.5 s'), run: to(function () { return _embDelay + 0.5; }) },
            { label: U.t('Later  +1 s'), run: to(function () { return _embDelay + 1; }) },
            { label: U.t('Later  +5 s'), run: to(function () { return _embDelay + 5; }) },
            { label: U.t('Back  −0.5 s'), run: to(function () { return _embDelay - 0.5; }) },
            { label: U.t('Back  −1 s'), run: to(function () { return _embDelay - 1; }) },
            { label: U.t('Reset (as in the file)'), run: to(function () { return 0; }) }
        ] };
    }

    // Level 1: Off + one row per language (with option count).
    // Level 1: one entry per language, spellings merged ("en", "eng" and "English" are one
    // group), named in full, with the file's own tracks in the same groups as the addons'.
    // Order: the language showing now, the preferred language, then by name.
    // Only my languages (Settings, Off by default): just your default, second-choice and
    // second-subtitle languages, the one showing, and tracks that don't say their language;
    // Other languages, after them, lists the rest (all: that list).
    function langMenu(all) {
        var groups = Object.create(null), order = [];   // (no inherited names: a language an addon calls "__proto__" is just a key)
        function key(l) { var k = langKey(l); return P.langUnstated(k) ? '' : k; }   // (no language, "und"…: one Unknown language)
        function add(k, item) {
            if (!groups[k]) { groups[k] = []; order.push(k); }
            groups[k].push(item);
        }
        getTextTracks().forEach(function (tr, i) { add(key(textLang(tr)), { emb: tr, n: i }); });
        var offer = S.ctx && !S.ctx._relayCc ? S.ctx._ccOffer : null;   // (a live channel's closed captions, not on yet)
        (offer || []).forEach(function (c, i) { add(key(c.lang || ''), { cc: c, n: i, emb: true }); });
        _subTracks.forEach(function (tr) { add(key(tr.lang), { track: tr }); });
        var curKey = _subOn ? key(_subLabel) : (_embSub != null ? key(_embLang) : null);
        var pref = getSubCfg().lang;
        var prefs = [curKey, pref].filter(function (x) { return x && x !== 'off'; });
        var cfg = getSubCfg(), hidden = 0;
        var mine = [cfg.lang, cfg.lang2, cfg.second].filter(function (l) { return l && l !== 'off' && l !== 'none'; });
        if (cfg.only === 'on' && !all && mine.length) {
            order = order.filter(function (k) {
                var keep = k === curKey || k === '' || mine.some(function (l) { return langKey(l) === k || langMatches(l, k); });
                if (!keep) { hidden++; }
                return keep;
            });
        }
        order.sort(function (a, b) {
            var ra = langRank(a, prefs), rb = langRank(b, prefs);
            if (ra !== rb) { return ra - rb; }
            var na = langName(a), nb = langName(b);
            return na < nb ? -1 : na > nb ? 1 : 0;
        });
        var items = [{ label: U.t('Off'), sel: !_subOn && _embSub == null, run: function () { subsOff(); secondOff(); rememberSub(S.ctx.id, { off: true }); closeMenu(); } }];
        order.forEach(function (k) {
            var list = groups[k], n = list.length, emb = list.filter(function (x) { return x.emb; }).length;
            items.push({ label: langName(k),
                detail: U.tn(n, '{n} option', '{n} options') + (emb ? ', ' + (emb === n ? inFile() : emb + ' ' + inFile()) : ''),
                sel: (k === curKey),
                run: function () { pushMenu(langTracksMenu(k, list)); } });
        });
        if (hidden) { items.push({ label: U.t('Other languages'), detail: U.t('{n} more', { n: hidden }), run: function () { pushMenu(langMenu(true)); } }); }
        var sec = getSubCfg().second;
        if (_subTracks.length) { items.push({ label: U.t('Second subtitle:') + ' ' + (sec === 'off' ? U.t('Off') : langName(sec)), detail: U.t('At the top, at the same time'), run: function () { pushMenu(secondMenu()); } }); }
        var idx = 0;
        for (var i = 0; i < items.length; i++) { if (items[i].sel) { idx = i; break; } }
        return { title: all ? U.t('All subtitle languages') : U.t('Subtitle language'), items: items, idx: idx, rebuild: function () { return langMenu(all); } };
    }

    function inFile() { return S.ctx && (S.ctx._relayCc || S.ctx._ccOffer) ? U.t('closed captions') : U.t('in the file'); }
    // Level 2: the tracks in one language: the file's own first, then each addon's.
    // Picking a track keeps the menu open, the checkmark on it (an addon's once it loads), so
    // several can be tried in a row: the file's own the same as an addon's.
    function langTracksMenu(key, list) {
        var idx = 0, nAddon = 0;
        list = list.filter(function (x) { return x.emb; }).concat(list.filter(function (x) { return !x.emb; }));
        var items = list.map(function (x, i) {
            if (x.cc) {   // (turning a live channel's closed captions on: it restarts with them)
                var c = x.cc;
                return { label: U.t('Closed captions ({ch})', { ch: c.ch }), detail: U.t('The channel restarts with them'),
                    run: function () { closeMenu(); rememberSub(S.ctx.id, { embedded: true, nth: x.n, lang: c.lang }); P.ccOn(c); } };
            }
            if (x.emb) {
                var tr = x.emb, l = textLang(tr), own = P.fileTrack ? P.fileTrack('subs', getTextTracks(), x.n) : null;
                if (_embSub === tr.index) { idx = i; }
                return { label: (S.ctx && S.ctx._relayCc ? U.t('Closed captions') : U.t('Built into the file')) + (l ? '  (' + l + ')' : '  ·  ' + U.t('track {n}', { n: x.n + 1 })), sel: _embSub === tr.index,
                    detail: own && P.fileTrackNote ? P.fileTrackNote(own) || undefined : undefined,   // (its own name and marks, from the file's header)
                    run: function () {
                        _embDelay = 0; _embQueue = []; _embNudge = null; selectEmbeddedSub(tr); rememberSub(S.ctx.id, { embedded: true, index: tr.index, lang: l });
                        if (menuOpen()) { replaceTop(langTracksMenu(key, list)); }
                    } };
            }
            var t = x.track;
            nAddon++;
            if (_subTrackUrl === t.url) { idx = i; }
            return { label: t._file ? t._addon + '  ·  ' + t._file : (t._addon || U.t('Source')) + '  ·  ' + U.t('option {n}', { n: nAddon }) +
                    (t.lang && langName(t.lang).toLowerCase() !== ('' + t.lang).toLowerCase() ? '  (' + t.lang + ')' : ''),
                sel: (_subTrackUrl === t.url),
                run: function () {
                    loadTrack(t, function () {
                        if (menuOpen()) { replaceTop(langTracksMenu(key, list)); }
                    });
                    rememberSub(S.ctx.id, { lang: t.lang, url: t.url, trackId: t.id });
                } };
        });
        return { title: U.t('{language} subtitles', { language: langName(key) }), items: items, idx: idx };
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
        return optionMenu(U.t('Subtitle size'), 'size',
            [['small', U.t('Small')], ['medium', U.t('Medium')], ['large', U.t('Large')], ['xlarge', U.t('Extra Large')]]);
    }
    function fontMenu() { return optionMenu(U.t('Subtitle font'), 'font', P.SUB_FONTS); }

    // ----- for the other parts (and js/player.js) -----
    // The player's number keys (player-controls' numberKey): 1 / 2 / 3 timing (an addon track's
    // earlier / as the file / later, kept for the title as the Timing menu's; a built-in track's
    // later only), 4 / 5 / 6 position, 7 / 8 / 9 size. Each says what it did.
    var KEY_POS = { 4: ['lower', U.t('Lower')], 5: ['bottom', U.t('Bottom')], 6: ['raised', U.t('Raised')] };
    var KEY_SIZE = { 7: ['medium', U.t('Medium')], 8: ['large', U.t('Large')], 9: ['xlarge', U.t('Extra Large')] };
    function subsKey(n) {
        if (n >= 1 && n <= 3) {
            var step = n === 1 ? -0.1 : n === 3 ? 0.1 : 0;
            if (_subOn) {
                _subDelay = step ? Math.round((_subDelay + step) * 10) / 10 : 0;
                rememberSub(S.ctx.id, { lang: _subLabel, url: _subTrackUrl, trackId: _subTrackId, delay: _subDelay });
                renderSubs();
                U.toast(U.t('Subtitles: {what}', { what: fmtDelay(_subDelay) + ' ' + (_subDelay > 0 ? U.t('(later)') : _subDelay < 0 ? U.t('(earlier)') : U.t('(as in the file)')) }), 1500);
            } else if (_embSub != null) {
                var was = _embDelay;
                _embDelay = step ? Math.max(0, Math.round((_embDelay + step) * 10) / 10) : 0;
                rememberSub(S.ctx.id, { embedded: true, index: _embSub, lang: _embLang, delay: _embDelay });
                U.toast(U.t('Subtitles: {what}', { what: fmtDelay(_embDelay) + (step < 0 && was === 0 ? ' ' + U.t('(built-in: later only)') : '') }), 1500);
            } else {
                U.toast(U.t('No subtitles on'), 1500);
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
        U.toast(U.t('Subtitles: {what}', { what: look[0] === 'size' ? U.t('{size} size', { size: look[1][1] }) : look[1][1] }), 1500);
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
    P.fileHints = fileHints; P.parseCues = parseCues; P.drawCues = drawCues; P.loadTrack = loadTrack; P.subsOff = subsOff;
    P.resetSubs = resetSubs; P.closeSubs = closeSubs; P.startSubtitles = startSubtitles;
    P.subsBeforeOpen = subsBeforeOpen; P.subsOnTick = subsOnTick; P.subtitleSummary = subtitleSummary;
    P.wantEmbedded = wantEmbedded;
    P.renderSubs = renderSubs; P.showEmbeddedText = showEmbeddedText; P.subConfigMenu = subConfigMenu; P.langMenu = langMenu;
})(PlayerParts);
