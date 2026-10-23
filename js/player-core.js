/* Player, part 1 of 7 — the playback session: opening a stream on AVPlay (or the desktop's
   <video>), the progress bar, seeking, credits and the next episode, stall recovery, stopping.
   Parts share one namespace, PlayerParts (P). The playback session every part reads is
   P.S (below); anything else a part keeps to itself. Each part publishes the functions the
   others use and borrows theirs through the small forwarders at its top (resolved when
   called). This file loads first; js/player.js, last, assembles Player. */
var PlayerParts = {};
(function (P) {
    'use strict';

    // ----- from the other parts -----
    function addToContinue() { return P.addToContinue.apply(null, arguments); }   // store
    function getResume() { return P.getResume.apply(null, arguments); }   // store
    function progressAll() { return P.progressAll.apply(null, arguments); }   // store
    function progressKey() { return P.progressKey.apply(null, arguments); }   // store
    function removeProgress() { return P.removeProgress.apply(null, arguments); }   // store
    function setWatched() { return P.setWatched.apply(null, arguments); }   // store
    function isPrivate() { return P.isPrivate.apply(null, arguments); }   // store
    function writeProgress() { return P.writeProgress.apply(null, arguments); }   // store
    function adaptiveInfo() { return P.adaptiveInfo.apply(null, arguments); }   // quality
    function clearStartNote() { return P.clearStartNote.apply(null, arguments); }   // quality
    function qualityHeight() { return P.qualityHeight.apply(null, arguments); }   // quality
    function qualityOnStart() { return P.qualityOnStart.apply(null, arguments); }   // quality
    function resetQuality() { return P.resetQuality.apply(null, arguments); }   // quality
    function tryFallback() { return P.tryFallback.apply(null, arguments); }   // quality
    function closeSubs() { return P.closeSubs.apply(null, arguments); }   // subs
    function renderSubs() { return P.renderSubs.apply(null, arguments); }   // subs
    function resetSubs() { return P.resetSubs.apply(null, arguments); }   // subs
    function showEmbeddedText() { return P.showEmbeddedText.apply(null, arguments); }   // subs
    function startSubtitles() { return P.startSubtitles.apply(null, arguments); }   // subs
    function subsBeforeOpen() { return P.subsBeforeOpen.apply(null, arguments); }   // subs
    function subsOnTick() { return P.subsOnTick.apply(null, arguments); }   // subs
    function applyPreferredAudio() { return P.applyPreferredAudio.apply(null, arguments); }   // audio
    function audioOnStart() { return P.audioOnStart.apply(null, arguments); }   // audio
    function audioOnTick() { return P.audioOnTick.apply(null, arguments); }   // audio
    function audioOnReady() { return P.audioOnReady.apply(null, arguments); }   // audio
    function resetAudio() { return P.resetAudio.apply(null, arguments); }   // audio
    function applyAspect() { return P.applyAspect.apply(null, arguments); }   // controls
    function closeControls() { return P.closeControls.apply(null, arguments); }   // controls
    function renderScrub() { return P.renderScrub.apply(null, arguments); }   // controls
    function resetControls() { return P.resetControls.apply(null, arguments); }   // controls
    function scrubbing() { return P.scrubbing.apply(null, arguments); }   // controls
    function ytLinksTick() { return P.ytLinksTick ? P.ytLinksTick.apply(null, arguments) : undefined; }   // controls
    function showSkip() { return P.showSkip.apply(null, arguments); }   // controls
    function skipTick() { return P.skipTick.apply(null, arguments); }   // controls
    function barShown() { return P.barShown.apply(null, arguments); }   // controls
    function subsPosPx() { return P.subsPosPx.apply(null, arguments); }   // store
    function skipShown() { return P.skipShown.apply(null, arguments); }   // controls

    var avplay = (window.webapis && webapis.avplay) ? webapis.avplay : null;
    var useAV = !!avplay;
    P.avplay = avplay; P.useAV = useAV;

    // The playback session: read by every part, written here (and a few fields where noted).
    var S = P.S = {
        active: false,
        ctx: null,           // { id, type, name, poster, resumeSec, url, ... } of what's playing
        dur: 0,              // seconds
        cur: 0,              // seconds
        isLive: false,       // live stream (sports/IPTV): no fixed duration
        playStarted: false,  // this AVPlay attempt was prepared (opened, ready to play)
        playing: false,      // ...and actually played: its position moved for a second (see oncurrentplaytime)
        // seek robustness (AVPlay can error if you seek mid-buffer)
        buffering: false,
        pendingSeek: null,
        lastSeekAt: 0,       // (also set by an audio switch's reload seek)
        // page elements (init)
        videoEl: null,       // html5 fallback
        subsEl: null,        // the subtitle line
        subMenuEl: null,     // in-player menu
        barEl: null,         // contextual quick-action bar (UP)
        skipEl: null         // skip intro/recap/credits prompt
    };

    var objEl = null;
    var _onExit = null;
    var _ticker = null;
    var _osdTimer = null;
    var _seekRecovering = false;
    var _playToken = 0;      // invalidates callbacks from closed/replaced AVPlay attempts
    var _prefetchedNext = false; // the next episode's sources were requested
    var _lastTickMs = null;  // this attempt's last play time, and how much it has actually played (2 s: the
    var _playedMs = 0;       // source counts as played, reportStart; a seek's jump doesn't count)

    // skip segments (TheIntroDB) + auto-advance
    var _sbDone = {};        // SponsorBlock sections already skipped / offered this playback (by index)
    var _segments = null;    // { intro, recap, credits, preview } arrays of {start,end} sec
    var _creditsSec = null;  // credits start (sec) if known
    var _creditsHandled = false;

    // stall watch (see checkStall)
    var _stall = { t: -1, since: 0, bufSince: 0, recoveries: [] };

    // Jumps ahead the player makes on its own (see checkJump): the last play time and when
    // it came, and where one was last undone.
    var JUMP_SLACK_SECS = 5;
    var _tick = null;        // { pos (s), wall (ms) }
    var _jumpUndone = null;  // the position (s) a jump was last taken back to
    var _pausedOnce = false; // paused since this was opened (it only happens after pauses)

    function init() {
        objEl = U.byId('av-player');
        S.videoEl = U.byId('html5-player');
        S.subsEl = U.byId('subs');
        S.subMenuEl = U.byId('sub-menu');
        S.barEl = U.byId('player-bar');
        S.skipEl = U.byId('skip-prompt');
        try { document.addEventListener('visibilitychange', onVisibility, false); } catch (e) {}
    }

    // ---------- StremioK in the background (the TV's Home, another app) ----------
    // A movie or an episode is paused and its place saved (on Trakt too), as if stopped: if
    // the TV then closes StremioK there, nothing is lost. The TV's player is suspended (as
    // Samsung asks of apps that go to the background) and restored on the way back, where a
    // paused video waits for you; a live channel plays on. If the player can't be restored,
    // the stream is opened again where it was.
    var _bg = null;   // { paused, suspended } while in the background with a playback open
    function onVisibility() {
        var hidden = false;
        try { hidden = !!document.hidden; } catch (e) {}
        if (hidden) { toBackground(); } else { fromBackground(); }
    }
    function toBackground() {
        if (!S.active || _bg) { return; }
        _bg = { paused: false, suspended: false };
        if (U.crumb) { U.crumb('player in the background'); }
        if (!S.isLive && S.playStarted && !isPaused()) { pause_(); _bg.paused = true; }
        saveProgress();
        // (where you stopped to Trakt; past 80% nothing: Trakt takes no paused place there, and you
        // may come back)
        if (!S.isLive && !_creditsHandled && S.ctx && !S.ctx.trailer && !S.ctx.private && !isNotice() && S.cur > 60 && typeof Trakt !== 'undefined' && Trakt.onProgress &&
            !(S.dur > 0 && S.cur / S.dur >= 0.8)) {
            Trakt.onProgress(S.ctx.type, S.ctx.id, S.cur, S.dur, S.ctx.name);
        }
        if (useAV && S.playStarted) { try { avplay.suspend(); _bg.suspended = true; } catch (e) {} }
    }
    function fromBackground() {
        var bg = _bg;
        _bg = null;
        if (!bg || !S.active) { return; }
        _stall.t = -1; _stall.since = 0; _stall.bufSince = 0;   // (time away isn't a stall)
        if (bg.suspended) {
            try {
                avplay.restore();
                try { avplay.setDisplayRect(0, 0, 1920, 1080); } catch (e1) {}
                applyAspect(true);
            } catch (e) {
                U.log('player', 'The TV\'s player couldn\'t be restored after the background: opening the stream again');
                reopen('Opening the stream again…');
                return;
            }
        }
        if (S.isLive) { if (isPaused()) { play_(); } return; }
        if (bg.paused) { showOSD(true); }   // (paused where you left: OK plays on)
    }
    function inBackground() { return !!_bg; }

    function isActive() { return S.active; }

    // fromTicker: the 5-second save while it plays: skipped when nothing moved since the last one
    // (paused); a stop, a leave or a jump always saves.
    var _savedSig = '';
    function saveProgress(fromTicker) {
        if (!S.ctx || !S.dur || S.isLive || S.ctx.trailer || S.ctx.private || isNotice()) { return; }   // (a notice clip, private viewing: nothing saved, nothing removed)
        var sig = progressKey(S.ctx) + '|' + Math.floor(S.cur) + '|' + Math.floor(S.dur);
        if (fromTicker && sig === _savedSig) { return; }
        _savedSig = sig;
        // Past the credits the episode is watched: its entry was removed and the next one
        // queued (handleCredits). Saving again would put it back next to the next episode.
        if (_creditsHandled) { return; }
        var all = progressAll();
        var k = progressKey(S.ctx);
        var added = all[k] && all[k].added;   // put there with "Add to Continue Watching"
        if (S.cur / S.dur > 0.95) {
            delete all[k];
        } else if (S.cur < 5) {
            if (!added) { delete all[k]; }        // an added title stays until it's finished
        } else {
            all[k] = { id: S.ctx.id, type: S.ctx.type, name: S.ctx.name, poster: S.ctx.poster, background: S.ctx.background, parent: S.ctx.parent,
                       position: Math.floor(S.cur), duration: Math.floor(S.dur), updated: Date.now(),
                       url: S.ctx.yt || S.ctx.url, headers: S.ctx._headers,   // the exact stream, to resume it directly (YouTube: its page)
                       fileHints: (P.fileHints && P.fileHints(S.ctx.subExtra)) || undefined,   // (its file, for subtitles made for it)
                       added: added || undefined };
        }
        writeProgress(all);
    }

    // ---------- OSD ----------
    // Subtitles move up above the progress bar while it's on screen (above the UP bar too,
    // when that's open), and back to their position after.
    var SUBS_OVER_OSD = 240, SUBS_OVER_BAR = 340;
    function liftSubs(px) {
        S.subsLift = px || 0;
        if (S.subsEl) { S.subsEl.style.bottom = Math.max(subsPosPx(), S.subsLift) + 'px'; }
    }
    function showOSD(sticky) {
        var wasHidden = osdHidden();
        U.byId('player-osd').className = '';
        liftSubs(barShown() ? SUBS_OVER_BAR : SUBS_OVER_OSD);
        if (wasHidden && S.ctx) { renderOSD(); }   // it isn't kept current while hidden
        if (_osdTimer) { clearTimeout(_osdTimer); _osdTimer = null; }
        if (!sticky) { _osdTimer = setTimeout(hideOSD, 4000); }
    }
    function hideOSD() { U.byId('player-osd').className = 'hidden'; liftSubs(0); }
    function osdHidden() { return U.byId('player-osd').className.indexOf('hidden') !== -1; }

    // ---------- chapters (a YouTube video's, from the service: S.ytInfo.chapters) ----------
    function chapters() { return (!S.isLive && S.ytInfo && S.ytInfo.chapters) || []; }
    // The chapter playing at `sec`: its index, or -1 (no chapters, or before the first).
    function chapterAt(sec) {
        var list = chapters(), at = -1;
        for (var i = 0; i < list.length && list[i].t <= sec; i++) { at = i; }
        return at;
    }
    function chapterLabel(i) {
        var list = chapters(), c = list[i];
        return c ? (i + 1) + '/' + list.length + '  ·  ' + (c.title || 'Chapter ' + (i + 1)) : '';
    }
    // A gap in the bar where each chapter starts (but the first), as on YouTube; redrawn
    // only when the chapters or the length change.
    var _chapKey = '', _sbKey = '';
    // Sections on the progress bar, colored as SponsorBlock does: a YouTube video's
    // SponsorBlock sections (not the off ones), a movie's or episode's intro, recap,
    // credits and preview (TheIntroDB, as the Skip prompts use them; credits to the end).
    function barSegments() {
        if (S.isLive) { return []; }
        var out = (S.sponsor || []).slice();
        ['recap', 'intro', 'credits', 'preview'].forEach(function (k) {
            ((_segments && _segments[k]) || []).forEach(function (g) {
                var a = g.start != null ? +g.start : 0, b = g.end != null ? +g.end : S.dur;
                if (b > a) { out.push({ cat: k === 'credits' ? 'outro' : k, action: 'skip', start: a, end: b }); }
            });
        });
        return out;
    }
    function renderSponsor() {
        var box = U.byId('osd-sponsor');
        var list = barSegments(), key = S.dur > 0 && list.length ? S.dur + '|' + (S.ctx && S.ctx.id) + '|' + list.map(function (g) { return g.cat + g.start; }).join(',') : '';
        if (!box || key === _sbKey) { return; }
        _sbKey = key;
        U.clear(box);
        if (!key) { return; }
        list.forEach(function (g) {
            if (g.action === 'full' || g.start >= S.dur) { return; }
            var m = U.el('div', g.action === 'poi' ? 'osd-sb-poi' : 'osd-sb');
            m.style.left = (g.start / S.dur * 100) + '%';
            if (g.action !== 'poi') {
                m.style.width = (Math.max(0.2, (Math.min(g.end, S.dur) - g.start) / S.dur * 100)) + '%';
                m.style.background = SB_COLORS[g.cat] || '#00d400';
            }
            box.appendChild(m);
        });
    }
    function renderChapters() {
        renderSponsor();
        var box = U.byId('osd-chapters'), line = U.byId('osd-chapter');
        var list = chapters(), key = S.dur > 0 && list.length ? S.dur + '|' + list.length + '|' + list[1].t : '';
        if (box && key !== _chapKey) {
            _chapKey = key;
            U.clear(box);
            if (key) {
                list.forEach(function (c, i) {
                    if (i === 0 || c.t >= S.dur) { return; }
                    var m = U.el('div', 'osd-chapter-mark');
                    m.style.left = (c.t / S.dur * 100) + '%';
                    box.appendChild(m);
                });
            }
        }
        if (line) {
            var txt = key ? chapterLabel(chapterAt(S.cur)) : '';
            line.textContent = txt;
            line.className = txt ? '' : 'hidden';
        }
    }

    // What's playing, in short (next to the duration): the source's formats (ctx.formatInfo, else
    // read from its link), with what the TV's player reports where it does (read once it plays).
    function renderTags() {
        var el = U.byId('osd-tags');
        if (!el) { return; }
        var t = '';
        if (S.ctx && !S.ctx.trailer && typeof Stremio !== 'undefined' && Stremio.formatTags) {
            if (S.playStarted && !S.actual) { S.actual = playerFormats(); }
            t = Stremio.formatTags(S.ctx.formatInfo || (Stremio.streamInfo ? Stremio.streamInfo({ url: S.ctx.url, name: S.ctx.name }) : null), S.actual);
        }
        if (el.textContent !== t) { el.textContent = t; }
    }
    function playerFormats() {
        var out = {};
        if (!useAV) { if (S.videoEl && S.videoEl.videoHeight) { out.height = S.videoEl.videoHeight; } return out; }
        try {
            (avplay.getCurrentStreamInfo() || []).forEach(function (x) {
                var t = ('' + x.type).toUpperCase(), e = {};
                try { e = typeof x.extra_info === 'string' ? JSON.parse(x.extra_info) : (x.extra_info || {}); } catch (er) {}
                if (t === 'VIDEO') { out.height = +(e.Height || e.height) || 0; out.codec = e.fourCC || e.codec || ''; }
                if (t === 'AUDIO') { out.audio = e.fourCC || e.codec || ''; out.channels = +(e.channels || e.Channels) || 0; }
            });
        } catch (er2) {}
        return out;
    }
    // An IPTV channel's TV guide (js/epg.js): { now, next } or null.
    function guideNow() { return (typeof EPG !== 'undefined' && S.ctx && /^iptv:/.test(S.ctx.id || '')) ? EPG.now(S.ctx.id) : null; }
    function clock(sec) { var d = new Date(sec * 1000); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
    if (typeof EPG !== 'undefined' && EPG.onChange) { EPG.onChange(function () { if (S.active && S.isLive) { renderOSD(); } }); }
    function renderOSD() {
        U.byId('osd-title').textContent = S.ctx ? S.ctx.name : '';
        var ck = U.byId('osd-clock');   // (the time of day, top right while the bar is on screen)
        if (ck) { ck.textContent = clock(Date.now() / 1000); }
        renderTags();
        renderChapters();
        if (S.isLive) {
            var cur = U.byId('osd-cur'), g = guideNow();
            cur.className = 'live';
            if (g && g.now) {   // an IPTV channel with a TV guide: what's on, how far along, and next
                var t = Date.now() / 1000;
                U.byId('osd-bar').style.display = '';
                U.byId('osd-progress').style.width = Math.max(0, Math.min(100, Math.round((t - g.now.start) / (g.now.stop - g.now.start) * 100))) + '%';
                cur.textContent = '● LIVE   ' + clock(g.now.start) + '–' + clock(g.now.stop) + '   ' + g.now.title;
                U.byId('osd-dur').textContent = g.next ? 'Next  ' + clock(g.next.start) + '   ' + g.next.title : '';
                return;
            }
            U.byId('osd-bar').style.display = 'none';
            cur.textContent = '● LIVE';
            U.byId('osd-dur').textContent = '';
            return;
        }
        U.byId('osd-bar').style.display = '';
        U.byId('osd-cur').className = '';
        var pct = S.dur > 0 ? (S.cur / S.dur * 100) : 0;
        U.byId('osd-progress').style.width = pct + '%';
        U.byId('osd-cur').textContent = U.fmtTime(S.cur);
        U.byId('osd-dur').textContent = U.fmtTime(S.dur);
        if (scrubbing()) { renderScrub(); }
    }

    // ---------- lifecycle ----------
    // Another YouTube video from this one's end screen or a card: played in its place, where
    // you are now saved first; stopping it goes back where this one was opened from.
    function playLinked(link) {
        if (!S.active || typeof YTPlay === 'undefined') { return; }
        saveProgress();
        var page = 'https://www.youtube.com/watch?v=' + link.id, lang = YTPlay.audioLang(page);
        play({ url: YTPlay.resolverUrl(page, 1080, false, lang), variantUrl: YTPlay.resolverUrl(page), initialQualityHeight: 1080,
            yt: page, ytLang: lang, type: 'YouTube', id: 'yt_id:' + link.id, parent: 'yt_id:' + link.id, name: link.title || 'YouTube',
            poster: 'https://i.ytimg.com/vi/' + link.id + '/hqdefault.jpg', streams: [], private: !!(S.ctx && S.ctx.private) || undefined }, _onExit);   // (from a private one: private too)
    }
    // ---------- a live Xtream channel's format ----------
    // An Xtream server sends a channel as MPEG-TS (…/live/USER/PASS/123.ts) or as HLS (….m3u8).
    // The menu's Format plays it the other way and keeps that for the channel (FORMAT_KEY, by its
    // id, the last FORMAT_KEEP), so it starts that way next time; its playlist's own way isn't
    // kept. ctx._ownUrl: the link as its playlist gives it.
    var FORMAT_KEY = 'stremiok.liveformat', FORMAT_KEEP = 300;
    var XT_LIVE = /^(https?:\/\/[^?#]+\/live\/[^\/?#]+\/[^\/?#]+\/[^\/?#.]+)\.(ts|m3u8)([?#].*)?$/i;
    function liveFormat(url) { var m = XT_LIVE.exec(url || ''); return m ? (m[2].toLowerCase() === 'm3u8' ? 'hls' : 'ts') : ''; }
    function withFormat(url, fmt) { var m = XT_LIVE.exec(url || ''); return m ? m[1] + '.' + (fmt === 'hls' ? 'm3u8' : 'ts') + (m[3] || '') : url; }
    function formatStart(ctx) {
        if (!S.isLive || !ctx.id || !liveFormat(ctx._ownUrl || ctx.url)) { return; }
        if (!ctx._ownUrl) { ctx._ownUrl = ctx.url; }
        var want = (U.store.get(FORMAT_KEY, {}) || {})[ctx.id];
        ctx.url = (want === 'ts' || want === 'hls') ? withFormat(ctx._ownUrl, want) : ctx._ownUrl;
    }
    function setLiveFormat(fmt) {
        var old = S.ctx;
        if (!S.active || !old || !old._ownUrl || !liveFormat(old.url) || liveFormat(old.url) === fmt) { return; }
        var all = U.store.get(FORMAT_KEY, {}) || {};
        delete all[old.id];
        if (fmt !== liveFormat(old._ownUrl)) {
            all[old.id] = fmt;
            var keys = Object.keys(all);
            keys.slice(0, Math.max(0, keys.length - FORMAT_KEEP)).forEach(function (k) { delete all[k]; });   // (the oldest picked)
        }
        U.store.set(FORMAT_KEY, all);
        var ctx = {};   // (the channel again, without what was learned from the other link: its relay, its look)
        Object.keys(old).forEach(function (k) { if (!/^_(relay|relayFor|relayCc|ccOffer|liveChecked)$/.test(k)) { ctx[k] = old[k]; } });
        ctx.switching = true;
        play(ctx, _onExit);
        U.spinner(true, 'Opening it as ' + (fmt === 'hls' ? 'HLS' : 'MPEG-TS') + '…');
    }
    P.liveFormat = function () { return S.active && S.ctx && S.isLive && S.ctx._ownUrl ? liveFormat(S.ctx.url) : ''; };
    P.setLiveFormat = setLiveFormat;

    // Another source of what's playing (the player's source list): played in its place, at
    // the same point, as a playback of its own — its quality ladder, YouTube details,
    // captions, SponsorBlock sections, headers and file details are the new source's, and so
    // is what's learned from it (s.stream, through ctx.learnFor); the title, its episodes and
    // whether it's private stay.
    var SOURCE_FIELDS = ['url', 'variantUrl', 'initialQualityHeight', 'yt', 'ytLang', '_headers', 'localSubs', 'localFile', 'subExtra', 'sourceSubs', 'formatInfo', 'onStarted', 'onFailed', 'stream',
        '_reported', 'fromStart', 'resumeSec', 'switching'];
    // keep: a source that didn't start gives way to the next (nextSourceOnFail): the same place to
    // resume, and Play from the start as it was.
    function replaceSource(s, keep) {
        if (!S.active || !S.ctx || !s || !s.url) { return; }
        var old = S.ctx, ctx = {};
        Object.keys(old).forEach(function (k) { if (SOURCE_FIELDS.indexOf(k) === -1) { ctx[k] = old[k]; } });
        ctx.url = s.url; ctx.variantUrl = s.variantUrl; ctx.initialQualityHeight = s.initialQualityHeight;
        ctx.yt = s.yt || undefined;
        ctx.ytLang = (s.yt && typeof YTPlay !== 'undefined') ? YTPlay.audioLang(s.yt) : '';
        ctx._headers = U.sanitizeHeaders(s.headers) || undefined;   // this source's own (or none)
        ctx.localSubs = s.localSubs; ctx.localFile = s.localFile; ctx.subExtra = s.subExtra; ctx.sourceSubs = s.sourceSubs;
        ctx.formatInfo = (s.stream && typeof Stremio !== 'undefined' && Stremio.streamInfo) ? Stremio.streamInfo(s.stream) : undefined;
        ctx.stream = s.stream;   // (the addon's source: ⬇ Download, player-controls)
        var learn = (old.learnFor && s.stream) ? old.learnFor(s.stream) : {};
        ctx.onStarted = learn.onStarted; ctx.onFailed = learn.onFailed;
        ctx.resumeSec = keep ? old.resumeSec : (S.isLive ? 0 : S.cur);
        if (keep) { ctx.fromStart = old.fromStart; }
        ctx.private = !!old.private;
        ctx.switching = true;
        saveProgress();
        play(ctx, _onExit);
    }

    function play(ctx, onExit) {
        // Replacing a YouTube stream that's playing (CH+/CH− to the next channel): the TV's
        // player can freeze on an open straight after closing it, so settle first (startAV).
        var settle = !!(S.active && S.ctx && S.ctx.yt);
        S.ctx = ctx; _onExit = onExit;
        // (private viewing, a link played as it is, or one started from a private playback —
        // a video followed from it, another source: nothing recorded, see player-store)
        ctx.private = !ctx.trailer && (ctx.private === true || !!ctx.link || isPrivate());
        if (ctx.private && !ctx.switching) { U.toast('Private viewing: not tracked', 2500); }
        if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null; }
        if (U.crumb) { U.crumb('play ' + (ctx.type || '') + ' ' + (ctx.private ? '(private)' : /^file:/i.test(ctx.url || '') ? 'file .' + ('' + ctx.url).split('.').pop() : ('' + (ctx.url || '')).replace(/^https?:\/\/([^\/?#]+).*$/i, '$1'))); }   // (Diagnostics, after an unexpected close)
        S.active = true; S.cur = 0; S.dur = 0; _bg = null; S.actual = null;
        // Stremio "tv" and "radio" types are strong live hints; refined after prepare.
        S.isLive = (ctx.type === 'tv' || ctx.type === 'radio') || /^iptv:/.test(ctx.id || '') || !!ctx.isLive;   // (an IPTV channel: live, a sports one too)
        formatStart(ctx);
        S.ctx.resumeSec = (ctx.trailer || ctx.fromStart) ? 0 : (ctx.resumeSec || getResume(ctx.type, ctx.id));   // (Play from start: 0:00)

        // reset subtitle + audio + quality + on-screen controls state
        resetSubs();
        resetAudio();
        resetQuality(ctx);
        resetControls();
        _stall = { t: -1, since: 0, bufSince: 0, recoveries: [] };
        recoReset();
        _prefetchedNext = false; S.playStarted = false; S.playing = false;
        _segments = null; _creditsSec = null; _creditsHandled = false; _segmentsFor = null;
        S.buffering = false; S.pendingSeek = null; S.lastSeekAt = 0; S.settleFrom = 0; _seekRecovering = false; _jumpUndone = null; _pausedOnce = false;
        updateHint();

        U.byId('app').className = 'hidden';
        document.body.style.background = 'transparent';
        showOSD(true);
        renderOSD();   // show the NEW title immediately (not the previous item's)
        U.spinner(true, ctx.switching ? 'Switching source…' : ctx.initialQualityHeight ? 'Opening stream at ' + ctx.initialQualityHeight + 'p…' : 'Opening stream…');

        if (useAV) { startLive(ctx, settle); } else { startHTML5(ctx.url); }

        // A YouTube video (not a live channel): its audio languages and its links (end screen,
        // cards) from the service, for the menu and the overlays (player-quality / -controls).
        S.ytInfo = null; S.ytInfoP = null;
        if (ctx.yt && !S.isLive && typeof YTPlay !== 'undefined' && YTPlay.infoUrl) {
            S.ytInfoP = U.getJSON(YTPlay.infoUrl(ctx.yt), 20000, 256 * 1024);   // (its captions: player-subs)
            S.ytInfoP.then(function (info) {
                if (S.ctx !== ctx || !info) { return; }
                S.ytInfo = { audio: U.listOf(info.audio, 40, function (a) { return typeof a.lang === 'string'; }),
                    links: U.listOf(info.links, 16, function (l) { return /^[A-Za-z0-9_-]{11}$/.test(l.id || '') && (l.kind === 'end' || l.kind === 'card'); }),
                    chapters: U.listOf(info.chapters, 200, function (c) { return typeof c.t === 'number' && c.t >= 0 && typeof c.title === 'string'; }) };
                if (!osdHidden()) { renderOSD(); }
            }, function () {});
        }

        // A trailer is just watched: no skip segments, progress or watched state. Its subtitles
        // (your language, else your second choice) from its own captions (see startSubtitles).
        if (ctx.trailer) { startSubtitles(ctx); return; }

        // A YouTube video: the sections SponsorBlock's viewers marked (sponsor, self-promotion…).
        S.sponsor = null; _sbDone = {};
        var ytv = ctx.yt && !S.isLive && ('' + ctx.yt).match(/(?:[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        if (ytv && typeof YouTube !== 'undefined' && YouTube.sbOn && YouTube.sbOn()) {
            YouTube.videoExtras(ytv[1]).then(function (x) {
                if (S.ctx !== ctx || !x) { return; }
                var segs = x.segments.map(function (g) { return { cat: g.cat, action: g.action, start: g.start, end: g.end, mode: YouTube.sbMode(g.cat) }; })
                    .filter(function (g) { return g.mode !== 'off'; });
                S.sponsor = segs;
                var whole = segs.filter(function (g) { return g.action === 'full'; })[0];
                if (whole) { U.toast('SponsorBlock: this whole video is marked “' + YouTube.SB_NAMES[whole.cat] + '”', 5000); }
                if (!osdHidden()) { renderOSD(); }
            }, function () {});
        }

        // Subtitle tracks from the addons, and the remembered or preferred one turned on.
        startSubtitles(ctx);

        // Skip segments (intro/recap/credits): asked for once the length is known (askSegments).
    }

    // TheIntroDB / SkipDB / IntroDB's segments for this playback: asked once its length is known (they
    // match it, and it checks them), and taken only by the playback that asked (another one
    // started meanwhile: dropped, so video A's credits can't end video B).
    var _segmentsFor = null;
    function askSegments() {
        var ctx = S.ctx;
        if (!ctx || ctx.trailer || S.isLive || !(S.dur > 0) || _segmentsFor === ctx) { return; }
        _segmentsFor = ctx;
        var dur = S.dur, asked = [];
        Stremio.getIntroSegments(ctx.type, ctx.id, Math.round(dur * 1000), asked, ctx.titleIds).then(function (seg) {
            if (!S.active || S.ctx !== ctx) { return; }
            var notes = [];
            _segments = checkedSegments(seg, S.dur || dur, notes);
            // (Diagnostics: who was asked, what was used, and what didn't fit this video and why)
            if (asked.length) {   // (private: the title not named)
                U.log('skip', 'Skip times for ' + (ctx.private ? 'a private playback' : '“' + (ctx.name || ctx.id) + '”') + ' (' + U.fmtTime(S.dur || dur) + '): ' + asked.join(' · ') +
                    (notes.length ? '. ' + notes.join('; ') : ''));
            }
            var cr = _segments && _segments.credits && _segments.credits[0];
            _creditsSec = (cr && cr.start != null) ? cr.start : null;
            if (!osdHidden()) { renderOSD(); }   // (on the bar)
        }, function () {});
    }
    // Only what fits this video: inside its length, in order (a start before its end), and
    // where it can be (credits and a preview in its second half, an intro and a recap in its
    // first). Another file's (or a wrong) answer doesn't place anything.
    // Credits or a preview timed on a longer copy (running past this one's end: another
    // release, a few seconds longer) are cut at its end, not dropped: where they start is what
    // the prompt needs. notes (optional): told what was cut or dropped, and why.
    function checkedSegments(seg, dur, notes) {
        if (!seg || typeof seg !== 'object' || !(dur > 0)) { return null; }
        var out = {}, half = dur / 2, from = seg.from || {};
        function span(g) { return (g.start != null ? U.fmtTime(g.start) : '…') + '–' + (g.end != null ? U.fmtTime(g.end) : '…'); }
        function note(k, g, why) { if (notes) { notes.push(k + ' ' + span(g) + (from[k] ? ' (' + from[k] + ')' : '') + ': ' + why); } }
        ['intro', 'recap', 'credits', 'preview'].forEach(function (k) {
            var late = k === 'credits' || k === 'preview';
            out[k] = [];
            U.listOf(seg[k], 10).forEach(function (g) {
                var a = g.start, b = g.end;
                if (a != null && !(typeof a === 'number' && isFinite(a) && a >= 0 && a < dur)) { note(k, g, 'dropped, outside this video'); return; }
                if (b != null && !(typeof b === 'number' && isFinite(b) && b > 0)) { note(k, g, 'dropped, no usable end'); return; }
                if (a != null && b != null && !(b > a)) { note(k, g, 'dropped, ends before it starts'); return; }
                if (late && !(a != null && a >= half)) { note(k, g, 'dropped, not in this video\'s second half'); return; }
                if (b != null && b > dur + 5) {
                    if (!late) { note(k, g, 'dropped, runs past this video\'s end'); return; }
                    note(k, g, 'cut at this video\'s end');
                    g = { start: a, end: dur };
                }
                if (!late && (b != null ? b : a) > half) { note(k, g, 'dropped, not in this video\'s first half'); return; }
                out[k].push(g);
            });
        });
        return out;
    }

    function updateHint() {
        var base = S.isLive ? 'OK: Play/Pause' : 'OK: Play/Pause   ←/→: Seek';
        base += '   UP: Controls   DOWN: Menu   RETURN: Back';
        var h = U.byId('osd-hint');
        if (h) { h.textContent = base; }
    }

    // Decides live vs VOD from the reported duration (0 / non-finite = live).
    function markLiveFromDuration() {
        if (S.ctx && (S.ctx.type === 'tv' || S.ctx.type === 'radio' || /^iptv:/.test(S.ctx.id || ''))) { S.isLive = true; }
        if (!S.dur || S.dur <= 0 || !isFinite(S.dur)) { S.isLive = true; }
    }

    // settle: a re-open of what's playing (a quality switch, or its retry). This TV's player
    // tends to fail the first open straight after closing a playing stream (YouTube
    // especially), so stop it properly and give it a moment before opening again.
    var SETTLE_MS = 300;
    // A file on a USB drive over 2 GB: through StremioK's service (LocalMedia.openUrl), the
    // only way the 2017 TV's player jumps in one.
    function opened(url) {
        return (typeof LocalMedia !== 'undefined' && LocalMedia.openUrl) ? LocalMedia.openUrl(url, S.ctx && S.ctx.localFile && S.ctx.localFile.size) : url;
    }
    function startAV(url, settle) {
        url = (S.ctx && S.ctx._relay && S.ctx._relayFor === url) ? S.ctx._relay : opened(url);   // (a live channel's sound repacked: see liveCheck)
        var token = ++_playToken;
        objEl.className = 'active';
        S.playStarted = false; S.playing = false;
        _lastTickMs = null; _playedMs = 0;
        _tick = null; _pausedOnce = false;   // (a new open: the jump watch starts over, see checkJump)
        subsBeforeOpen();   // a built-in subtitle track is selected again once this attempt plays
        if (settle) { try { avplay.stop(); } catch (e0) {} }
        try {
            avplay.close();
        } catch (e) {}
        if (settle) {
            setTimeout(function () { if (S.active && token === _playToken) { openAV(url, token); } }, SETTLE_MS);
            return;
        }
        openAV(url, token);
    }
    var BUFFERS = { more: [8, 10], most: [15, 20] };
    function openAV(url, token) {
        try {
            avplay.open(url);
            // Best-effort per-stream HTTP headers (some IPTV channels need a UA / Referer).
            // Guarded: unsupported properties simply throw and are ignored.
            try {
                var h = U.sanitizeHeaders(S.ctx && S.ctx._headers);
                if (h && h.ua) { avplay.setStreamingProperty('USER_AGENT', h.ua); }
                if (h && h.ref) { avplay.setStreamingProperty('CUSTOM_MESSAGE', 'Referer:' + h.ref); }
            } catch (eh) {}
            // A bigger buffer (Settings › Playback › Seeking & buffering): seconds loaded before it
            // starts, and before it goes on after running dry (the TV's own when Normal)
            var buf = BUFFERS[P.playerCfg().buffer];
            if (buf) {
                try {
                    avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', buf[0]);
                    avplay.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', buf[1]);
                } catch (eb) {}
            }
            avplay.setListener({
                onbufferingstart: function () {
                    if (!S.active || token !== _playToken) { return; }
                    S.buffering = true; U.spinner(true, S.playStarted ? 'Buffering…' : undefined);
                },
                onbufferingcomplete: function () {
                    if (!S.active || token !== _playToken) { return; }
                    S.buffering = false; U.spinner(false);
                    if (S.pendingSeek != null) { var pt = S.pendingSeek; S.pendingSeek = null; doAVSeek(pt, 0); }
                },
                onstreamcompleted: function () {
                    if (!S.active || token !== _playToken) { return; }
                    S.cur = S.dur; onEnded();
                },
                oncurrentplaytime: function (ms) {
                    if (!S.active || token !== _playToken) { return; }
                    if (checkJump(ms / 1000)) { return; }
                    S.cur = ms / 1000; onProgress();
                    // Played, not just opened: a file can open and then fail (or show nothing)
                    if (_lastTickMs !== null && ms > _lastTickMs && ms - _lastTickMs < 1500) { _playedMs += ms - _lastTickMs; }
                    _lastTickMs = ms;
                    if (!S.playing && _playedMs >= 1000) { S.playing = true; _reco.tries = 0; }   // (started: playing, not just opened; a reconnect's tries start over)
                    if (_playedMs >= 2000 && !isNotice()) { reportStart(true); }   // (a notice clip proves nothing about the format)
                    audioOnTick();
                    subsOnTick();
                },
                onsubtitlechange: function (duration, text) {
                    if (!S.active || token !== _playToken) { return; }
                    showEmbeddedText(text, duration);
                },
                onerror: function (err) {
                    // stop()/close() may emit a late NOT_SUPPORTED_FORMAT for an HLS
                    // session that played successfully. Ignore callbacks after exit or
                    // after another quality/retry attempt has replaced this session.
                    if (!S.active || token !== _playToken) { return; }
                    U.spinner(false);
                    // A seek can throw a transient error on some HLS streams. If we just
                    // sought, try to recover (resume) instead of ending playback.
                    if (Date.now() - S.lastSeekAt < 6000 && !_seekRecovering) {
                        _seekRecovering = true;
                        try { avplay.play(); } catch (e) {}
                        setTimeout(function () { _seekRecovering = false; }, 4000);
                        return;
                    }
                    // A live channel that played: its connection dropped → opened again (liveDropped).
                    if (S.playing && liveReconnects()) { U.log('player', 'Playback error: ' + err + ' (' + where(S.ctx.url) + ')'); liveDropped('Connection lost'); return; }
                    // A reconnect's try that didn't play → the next try.
                    if (!S.playing && _reco.tries) { if (!relayFailed()) { liveDropped('Couldn’t reconnect'); } return; }
                    // Failed before it ever played (opened, maybe, but nothing shown) → retry / step down / Auto.
                    if (!S.playing && (relayFailed() || tryFallback())) { return; }
                    reportStart(false, err);   // (unless it had already played)
                    U.log('player', 'Playback error: ' + err + ' (' + where(S.ctx && S.ctx.url) + ')');
                    if (!S.playing) { failedStart('Playback error: ' + err); return; }
                    U.toast('Playback error: ' + err);
                    exitLater();
                }
            });
            try { avplay.setStreamingProperty('ADAPTIVE_INFO', adaptiveInfo()); } catch (e0) {}
            _openedAt = Date.now();
            setTimeout(startCheck, AV_START_MS + 500);
            avplay.prepareAsync(function () {
                if (!S.active || token !== _playToken) { return; }
                U.spinner(false);
                S.playStarted = true;
                qualityOnStart();
                try { avplay.setDisplayRect(0, 0, 1920, 1080); } catch (e1) {}
                applyAspect(true);
                try { S.dur = avplay.getDuration() / 1000; } catch (e3) { S.dur = 0; }
                markLiveFromDuration();
                askSegments();
                updateHint();
                S.settleFrom = Date.now();   // (the start, or the resume jump just below: no other jump for a while, see player-audio's SETTLE_MS)
                audioOnStart();   // the audio track is picked once playback is running…
                var picked = audioOnReady();   // …or now, before it plays (Quick): the seek below loads its audio
                if (!S.isLive && S.ctx.resumeSec > 5) { try { avplay.seekTo(S.ctx.resumeSec * 1000); } catch (e4) {} }
                else if (picked) { try { avplay.seekTo(0); } catch (e5) {} }
                avplay.play();
                S.settleFrom = Date.now();   // (counted again from here: on the 2017 TV the resume jump above takes seconds to return)
                liveCheck();
                screenSaver(false);
                renderOSD();
                startTicker();
                showOSD(false);
            }, function (err) {
                if (!S.active || token !== _playToken) { return; }
                U.spinner(false);
                if (relayFailed()) { return; }
                if (_reco.tries) { liveDropped('Couldn’t reconnect'); return; }   // (a reconnect's try: the next one)
                // Prepare failed → retry / step down / Auto.
                if (tryFallback()) { return; }
                U.log('player', 'Could not open: ' + (err && (err.name || err.message || err)) + ' (' + where(url) + ')');
                reportStart(false, err && (err.name || err.message || err));
                failedStart('Could not open stream');
            });
        } catch (e) {
            U.log('player', 'AVPlay failed: ' + (e && e.message));
            reportStart(false, e && e.message);
            U.spinner(false); U.toast('AVPlay failed: ' + e.message); exitLater();
        }
    }
    // What a log entry names: the link, or, playing privately, nothing that says what.
    function where(u) { return S.ctx && S.ctx.private ? 'private playback' : u; }
    // After a failure: the player closes a moment later, unless by then something else plays
    // (another title, another source, a retry of this one): only the playback that failed.
    var _exitTimer = null;
    function exitLater() {
        var ctx = S.ctx, token = _playToken;
        if (_exitTimer) { clearTimeout(_exitTimer); }
        _exitTimer = setTimeout(function () {
            _exitTimer = null;
            if (S.active && S.ctx === ctx && token === _playToken) { exit(); }
        }, 1500);
    }

    // Tell whoever started this playback, once, whether the source played (ctx.onStarted)
    // or couldn't be played at all (ctx.onFailed(err), after every retry / fallback).
    // Settings > Formats and Played before learn from this. Leaving before either: nothing.
    function reportStart(ok, err) {
        if (!S.ctx || S.ctx._reported) { return; }
        S.ctx._reported = true;
        var cb = ok ? S.ctx.onStarted : S.ctx.onFailed;
        if (cb) { try { cb(err, S.ctx); } catch (e) {} }
    }

    // The desktop's <video> has no start timeout of its own (AVPlay's prepare does): a
    // stream the browser never gets going would leave the spinner up for good.
    var HTML5_START_MS = 20000;
    function startHTML5(url) {
        url = opened(url);
        var token = ++_playToken, loaded = false;
        S.videoEl.className = 'active';
        S.videoEl.src = url;
        setTimeout(function () {
            if (loaded || !S.active || token !== _playToken) { return; }
            reportStart(false, 'TIMEOUT');
            U.spinner(false);
            U.toast('This stream didn\'t start'); exitLater();
        }, HTML5_START_MS);
        S.videoEl.onloadedmetadata = function () {
            if (!S.active || token !== _playToken) { return; }
            loaded = true;
            S.dur = S.videoEl.duration || 0;
            markLiveFromDuration();
            askSegments();
            updateHint();
            try { applyPreferredAudio(); } catch (eA) {}
            if (!S.isLive && S.ctx.resumeSec > 5) { try { S.videoEl.currentTime = S.ctx.resumeSec; } catch (e) {} }
            reportStart(true);
            U.spinner(false); showOSD(false);
        };
        S.videoEl.ontimeupdate = function () {
            if (!S.active || token !== _playToken) { return; }
            S.cur = S.videoEl.currentTime; onProgress();
        };
        S.videoEl.onended = function () {
            if (S.active && token === _playToken) { onEnded(); }
        };
        S.videoEl.onerror = function () {
            if (!S.active || token !== _playToken) { return; }
            reportStart(false, S.videoEl.error && S.videoEl.error.code === 2 ? 'NETWORK' : 'MEDIA_ERR');
            U.toast('Playback error'); exitLater();
        };
        var p = S.videoEl.play();
        if (p && p['catch']) { p['catch'](function () {}); }
        applyAspect(true);
        startTicker();
    }

    function startTicker() {
        if (_ticker) { clearInterval(_ticker); }
        _ticker = setInterval(function () {
            if (inBackground()) { return; }   // (saved on the way there; nothing to watch until it's back)
            if (useAV) { try { S.cur = avplay.getCurrentTime() / 1000; } catch (e) {} onProgress(); checkStall(); }
            saveProgress(true);
        }, 5000);
    }

    // A debrid service's "not ready yet" notice: a few seconds of video standing in for a
    // file it's still downloading (Real-Debrid through AIOStreams…). A movie or an episode is
    // never this short, so it isn't the title: not watched (nor on Trakt), not in Continue
    // Watching, no next episode, nothing learned about the source's format.
    var NOTICE_MAX_S = 120;
    function isNotice() {
        return !!S.ctx && !S.ctx.yt && !S.ctx.trailer && !S.isLive && (S.ctx.type === 'movie' || S.ctx.type === 'series') && S.dur > 0 && S.dur < NOTICE_MAX_S;
    }
    function onEnded() {
        // a live channel whose stream ended (its server stopped it): opened again (liveDropped)
        if (liveReconnects()) { liveDropped('The stream ended'); return; }
        if (isNotice()) {   // (back to its sources: another one, or this one later)
            U.toast('That source isn\'t ready yet (the debrid service is still getting it): try another, or this one later', 6000);
            exit();
            return;
        }
        // reaching the end counts as watched + advances the series queue
        if (S.ctx) { handleCredits(true); }
        saveProgress();
        exit();
    }

    // Load the next episode's sources shortly before the credits (or the last 8%), so
    // "Next" / "Skip Credits → Next" starts without waiting on the addons.
    var PREFETCH_LEAD = 90;
    function maybePrefetchNext() {
        if (_prefetchedNext || !S.ctx || !S.ctx.prefetchNext || S.isLive || !(S.dur > 0)) { return; }
        var end = (_creditsSec != null) ? _creditsSec : S.dur * 0.92;
        if (S.cur >= end - PREFETCH_LEAD) { _prefetchedNext = true; try { S.ctx.prefetchNext(); } catch (e) {} }
    }

    function onProgress() {
        maybePrefetchNext();
        // The bar is redrawn on every time update only while it's on screen (showOSD
        // brings it up to date when it appears); hidden, it would just be wasted layout work.
        if (!osdHidden() || scrubbing()) { renderOSD(); }
        renderSubs();
        checkSegments();
        skipTick();   // (a skip counting down: on its own once it reaches zero)
        checkSponsor();
        checkCredits();
        ytLinksTick();
    }

    // Show a transient Skip button when entering an intro/recap/credits segment.
    // No credits timing from TheIntroDB (none found, or the lookup failed): treat a series
    // episode's last 10 s as its credits, so "Skip Credits → Next" still comes up when
    // there's a next episode to go to.
    var FALLBACK_CREDITS_SEC = 10;
    function creditsSegments() {
        if (isNotice()) { return null; }
        if (_segments && _segments.credits && _segments.credits.length) { return _segments.credits; }
        if (S.ctx && S.ctx.type === 'series' && S.ctx.nextEpisode && S.dur > FALLBACK_CREDITS_SEC * 6) {
            return [{ start: S.dur - FALLBACK_CREDITS_SEC, fallback: true }];
        }
        return null;
    }

    function checkSegments() {
        if (S.isLive) { return; }
        var t = S.cur;
        function inSeg(list, endRequired) {
            if (!list || !list.length) { return null; }
            var s = list[0];
            var start = (s.start != null ? s.start : 0);
            var end = (s.end != null ? s.end : (endRequired ? 0 : 1e9));
            if (endRequired) { return (t >= start && t <= end) ? s : null; }
            return (t >= start) ? s : null;  // credits/preview: open-ended
        }
        // priority: credits (near end) > recap > intro
        var credits = creditsSegments();
        if (inSeg(credits, false) && !skipShown('credits')) { showSkip('credits', credits[0]); return; }
        if (!_segments) { return; }
        if (inSeg(_segments.recap, true) && !skipShown('recap')) { showSkip('recap', _segments.recap[0]); return; }
        if (inSeg(_segments.intro, true) && !skipShown('intro')) { showSkip('intro', _segments.intro[0]); return; }
        // a preview with an end ("next time on…" in the middle; one running to the end comes with the credits)
        if (inSeg(_segments.preview, true) && !skipShown('preview')) { showSkip('preview', _segments.preview[0]); return; }
    }

    // SponsorBlock: playing into a marked section skips it ("Skip") or offers to ("Ask"), once
    // a playback (going back into it, it plays). Not while scrubbing: where you land is yours.
    var SB_COLORS = { sponsor: '#00d400', selfpromo: '#ffff00', interaction: '#cc00ff', intro: '#00ffff', outro: '#4f7cff', recap: '#008fd6', preview: '#008fd6',
        music_offtopic: '#ff9900', filler: '#7300ff' };
    function checkSponsor() {
        if (!S.sponsor || S.isLive || scrubbing()) { return; }
        var t = S.cur;
        for (var i = 0; i < S.sponsor.length; i++) {
            var g = S.sponsor[i];
            if (g.action !== 'skip' || _sbDone[i] || g.mode === 'show' || !(t >= g.start && t < g.end - 1)) { continue; }
            _sbDone[i] = true;
            var name = YouTube.SB_NAMES[g.cat] || 'section';
            if (g.mode === 'skip') {
                seekTo(g.end);
                U.toast('Skipped: ' + name + '  (' + U.fmtTime(g.end - g.start) + ')', 3000);
            } else {
                showSkip('sb', { end: g.end, label: 'Skip ' + name });
            }
            return;
        }
    }
    function sponsorHighlight() {
        var h = (S.sponsor || []).filter(function (g) { return g.action === 'poi'; })[0];
        return h ? h.start : null;
    }

    // Passing the credits threshold marks the item watched and queues the next episode.
    var WATCHED_MIN = 0.8;
    function checkCredits() {
        if (S.isLive || _creditsHandled || !S.ctx || S.ctx.trailer || isNotice()) { return; }
        // the credits (when known), but never before WATCHED_MIN of it has played: a wrong
        // answer can't mark it watched early ("Skip Credits → Next", chosen, still does)
        var threshold = (_creditsSec != null) ? Math.max(_creditsSec, S.dur * WATCHED_MIN) : (S.dur ? S.dur * 0.92 : Infinity);
        if (S.cur >= threshold && isFinite(threshold)) { handleCredits(false); }
    }

    var FINISHED_SHARE = 0.85;   // (stopped past it, with Trakt: watched, see exit)
    function handleCredits() {
        if (_creditsHandled || !S.ctx || S.ctx.trailer || isNotice()) { return; }
        _creditsHandled = true;
        if (S.ctx.private) { return; }   // (private viewing: not marked watched, nothing queued)
        // With Trakt: sent as a finish (Trakt's own way, which also clears a paused place it
        // kept for it), not as a separate "watched"
        if (S.dur > 0 && typeof Trakt !== 'undefined' && Trakt.onStopped && Trakt.isConnected && Trakt.isConnected()) {
            markFinished(true);
            Trakt.onStopped(S.ctx.type, S.ctx.id, S.cur, S.dur, S.ctx.name);
            return;
        }
        markFinished(false);
    }
    // Watched: off Continue Watching, the next episode queued. quiet: Trakt's been told another
    // way (stopped past 85%: a finished scrobble), so not as a separate "watched" too.
    function markFinished(quiet) {
        setWatched(S.ctx.type, S.ctx.id, true, quiet);   // (and to Trakt, when connected)
        removeProgress(S.ctx.type, S.ctx.id);
        if (S.ctx.nextEpisode && !(S.ctx.nextEpisode.airs > Date.now())) {   // (not one that hasn't aired)
            var ne = S.ctx.nextEpisode;
            addToContinue({ id: ne.id, type: ne.type, name: ne.name, poster: ne.poster, background: ne.background, parent: ne.parent || S.ctx.parent });
        }
    }

    // ---------- transport ----------
    function state() {
        if (useAV) { try { return avplay.getState(); } catch (e) { return ''; } }
        return S.videoEl.paused ? 'PAUSED' : 'PLAYING';
    }

    function isPaused() {
        if (useAV) { return state() !== 'PLAYING'; }
        return S.videoEl.paused;
    }
    function play_() { if (useAV) { try { avplay.play(); } catch (e) {} } else { S.videoEl.play(); } screenSaver(false); }
    function pause_() { _pausedOnce = true; if (useAV) { try { avplay.pause(); } catch (e) {} } else { S.videoEl.pause(); } screenSaver(true); }

    // The TV's screensaver stays off while a video plays and is allowed again when it's
    // paused or stopped. No-op where the Samsung appcommon API isn't available.
    function screenSaver(allow) {
        try {
            var ac = window.webapis && webapis.appcommon;
            if (!ac || !ac.setScreenSaver) { return; }
            var st = ac.AppCommonScreenSaverState || {};
            ac.setScreenSaver(allow ? st.SCREEN_SAVER_ON : st.SCREEN_SAVER_OFF, function () {}, function () {});
        } catch (e) {}
    }

    function seekTo(sec) {
        if (S.isLive) { showOSD(false); U.toast('Live — seeking unavailable', 1500); return; }
        // keep a small margin from the very end (seeking to EOF can error)
        var maxT = S.dur ? Math.max(0, S.dur - 2) : 1e9;
        var target = Math.max(0, Math.min(maxT, sec));
        S.cur = target;
        renderOSD();
        showOSD(false);
        if (useAV) {
            // Don't seek while buffering — queue it until buffering completes.
            if (S.buffering) { S.pendingSeek = target; U.spinner(true); return; }
            doAVSeek(target, 0);
        } else {
            try { S.videoEl.currentTime = target; } catch (e2) {}
        }
    }

    // Seek only when AVPlay is in a seekable state; retry briefly otherwise.
    function doAVSeek(targetSec, attempt) {
        S.lastSeekAt = Date.now();
        var st = '';
        try { st = avplay.getState(); } catch (e) {}
        if (st === 'PLAYING' || st === 'PAUSED' || st === 'READY') {
            try { avplay.seekTo(Math.floor(targetSec * 1000)); } catch (e2) { /* non-fatal */ }
        } else if (attempt < 4 && S.active) {
            var tok = _playToken;
            setTimeout(function () { if (S.active && tok === _playToken) { doAVSeek(targetSec, attempt + 1); } }, 350);   // (the same playback still)
        }
    }

    function seekBy(delta) { seekTo(S.cur + delta); }

    // ---------- jumps ahead on its own ----------
    // At normal speed, play time can't move ahead faster than the clock. After pauses, this
    // TV's player sometimes jumps forward at the next buffering, to where it would be had it
    // never paused (so this only watches once it has been paused). A jump like that we didn't ask for (no seek, skip or resume since the
    // last play time) is taken back to where you were, and noted in Diagnostics. A second
    // jump from the same place is let through (a real gap in the file: no endless loop).
    // Returns true when it took one back (that play time isn't shown).
    function checkJump(pos) {
        var now = Date.now(), t = _tick;
        _tick = { pos: pos, wall: now };
        if (!t || !_pausedOnce || S.isLive || !useAV || scrubbing() || S.pendingSeek != null || S.lastSeekAt >= t.wall) { return false; }
        var ahead = (pos - t.pos) - (now - t.wall) / 1000;
        if (ahead <= JUMP_SLACK_SECS) { return false; }
        if (_jumpUndone !== null && Math.abs(_jumpUndone - t.pos) < 3) {   // (the same one again)
            U.log('player', 'Playback jumped ahead ' + Math.round(ahead) + ' s again from ' + U.fmtTime(t.pos) + ': let through (a gap in the file?)');
            _jumpUndone = null;
            return false;
        }
        U.log('player', 'Playback jumped ahead ' + Math.round(ahead) + ' s on its own (' + U.fmtTime(t.pos) + ' -> ' + U.fmtTime(pos) + '): back to where it was');
        _jumpUndone = t.pos;
        _tick = { pos: t.pos, wall: now };
        S.cur = t.pos;
        doAVSeek(t.pos, 0);
        return true;
    }

    // ---------- a source that doesn't start ----------
    // Refused by the TV, or not started after AV_START_MS: with Settings › Source ranking › The
    // next source on (the default), the next best one this playback hasn't tried (the title's
    // page picks it: ctx.nextSource), at the same place, NEXT_TRIES more at most. Not for live
    // channels, YouTube or a USB file.
    var NEXT_TRIES = 3, AV_START_MS = 45000, _openedAt = 0;
    function nextSourceOnFail(notice) {
        var c = S.ctx;
        if (!c || !S.active || S.playing || S.isLive || c.trailer || c.yt || c.localFile || !c.stream || typeof c.nextSource !== 'function') { return false; }
        if (typeof Stremio === 'undefined' || !Stremio.getPrefs || !Stremio.getPrefs().nextOnFail) { return false; }
        var tried = (c._tried || []).concat([Stremio.sourceId(c.stream)]);
        if (tried.length > NEXT_TRIES) { return false; }
        var n = null;
        try { n = c.nextSource(tried, c._avoid || []); } catch (e) { n = null; }
        if (!n || !n.source || !n.source.url) { return false; }
        c._tried = tried;   // (kept by the next one: not a source's own field)
        var msg = (notice ? notice.text + '  ·  trying' : 'Didn’t start: trying') + ' the next source (' + (tried.length + 1) + ' of ' + Math.min(n.total, NEXT_TRIES + 1) + ')…';
        U.log('player', 'Source didn’t start: trying the next one (' + (tried.length + 1) + ')');
        replaceSource(n.source, true);
        U.spinner(true, msg); U.toast(msg, notice ? 7000 : 4000);
        return true;
    }
    // A start that failed: is the link a debrid addon's notice video (Torrentio's failed_access,
    // limits_exceeded…: noticeOf)? Then that's said, and for the account's ones the next source
    // skips the addon's links through that service; then the next source, or what's to say.
    function failedStart(why) {
        var c = S.ctx, token = _playToken, st = c && c.stream;
        function finish(notice) {
            if (!S.active || S.ctx !== c || token !== _playToken) { return; }   // (something else playing meanwhile)
            if (notice) {
                U.log('player', 'The source sent a notice: ' + notice.kind + (notice.service ? ' (' + notice.service + ')' : ''));
                if (notice.account && notice.tag) { c._avoid = (c._avoid || []).concat([{ addon: st._addon, tag: notice.tag }]); }
            }
            if (nextSourceOnFail(notice)) { return; }
            U.toast(notice ? notice.text : why, notice ? 8000 : undefined);
            exitLater();
        }
        if (!c || !st || c.yt || c.localFile || S.isLive || !/^https?:\/\//i.test(st.url || '')) { finish(null); return; }
        noticeOf(st, finish);
    }
    // Where a source's link leads (its first bytes, asked for): a notice video, by its name, or null.
    var NOTICE_PATH = /\/(?:videos|static\/exceptions|static\/videos|exceptions)\/([a-z0-9_-]+?)(?:_v\d+)?\.mp4$/i, NOTICE_MAX = 20 * 1048576;
    function noticeOf(st, cb) {
        var done = false;
        function end(n) { if (!done) { done = true; clearTimeout(t); cb(n); } }
        var t = setTimeout(function () { end(null); }, 8000), x;
        try {
            x = new XMLHttpRequest();
            x.open('GET', st.url, true);
            x.setRequestHeader('Range', 'bytes=0-15');
            x.onreadystatechange = function () {
                if (x.readyState !== 4) { return; }
                var path = ('' + (x.responseURL || '')).replace(/^https?:\/\/[^\/]+/, '').split(/[?#]/)[0], m = NOTICE_PATH.exec(path);
                var total = +((/\/(\d+)\s*$/.exec(x.getResponseHeader('Content-Range') || '') || [])[1] || 0);
                end(m && (!total || total < NOTICE_MAX) ? describeNotice(m[1].toLowerCase(), st) : null);
            };
            x.onerror = function () { end(null); };   // (the real file on another host, often unreadable here: no notice)
            x.send();
        } catch (e) { end(null); }
    }
    function describeNotice(kind, st) {
        var d = (typeof Stremio !== 'undefined' && Stremio.debridOf) ? Stremio.debridOf(st) : null;
        var svc = d ? d.name : 'The debrid service', addon = st._addon || 'the addon', key = d ? d.name + ' key' : 'debrid key';
        var n = { kind: kind, service: d ? d.name : '', tag: d ? d.tag : '', account: false, text: '' };
        if (/access|auth|unauthorized|forbidden|premium/.test(kind)) { n.account = true; n.text = svc + ' refused access (' + addon + '): check its ' + key + ' in the addon’s settings'; }
        else if (/limit|too_many|exceeded/.test(kind)) { n.account = true; n.text = svc + ': your limit is reached for now (' + addon + ')'; }
        else if (/infring|blocked|dmca|removed/.test(kind)) { n.text = svc + ' won’t give this file (' + addon + '): try another source'; }
        else if (/download|caching|queued/.test(kind)) { n.text = 'Still downloading on ' + svc + ' (' + addon + '): try again later'; }
        else { n.text = svc + ' couldn’t give this file (' + addon + ': “' + kind.replace(/_/g, ' ') + '”)'; }
        return n;
    }
    // Not playing after AV_START_MS (no answer from the server, or opened and nothing shown): the
    // next source when there's one; else it stops and says so (not while you've paused it).
    function startCheck() {
        if (!S.active || S.playing || !useAV || !_openedAt || Date.now() - _openedAt < AV_START_MS) { return; }
        if (_reco.tries) { liveDropped('Couldn’t reconnect'); return; }   // (a reconnect's try: the next one)
        if (nextSourceOnFail()) { return; }
        if (S.playStarted && isPaused()) { return; }
        U.log('player', 'Didn’t start: nothing played in ' + (AV_START_MS / 1000) + ' s (' + where(S.ctx && S.ctx.url) + ')');
        U.spinner(false);
        U.toast('Didn’t start: nothing played in ' + (AV_START_MS / 1000) + ' seconds. Try another source.', 6000);
        exitLater();
    }
    P.startCheck = startCheck;

    // ---------- a live channel's choppy sound ----------
    // Some IPTV servers cut a channel's AAC sound mid-frame, and the TV's player stutters on it.
    // Once a live HLS channel plays, StremioK's service looks (YTPlay.liveOpen); if its sound is
    // cut that way, the channel restarts through the service's relay, which repacks the sound.
    // The answer is kept per link (LIVE_KEY, LIVE_DAYS): a channel known to need it starts
    // through the relay (startLive), one known not to isn't asked about again.
    // The same look says which closed-caption channels (CC1–CC4) are in its picture (cc, kept
    // with it once sure). They're offered in the subtitle menu (ctx._ccOffer); turned on (picked
    // there, remembered for the channel, or in your default subtitle language), the channel plays
    // through the relay with them as subtitle tracks (ctx._relayCc), the sound as it is unless it
    // needs repacking too.
    var LIVE_KEY = 'stremiok.livefix', LIVE_KEEP = 300, LIVE_DAYS = 14;
    function liveFixable(ctx) {
        return useAV && S.isLive && !!ctx && !ctx.yt && !ctx.trailer && /^https?:\/\//i.test(ctx.url || '') &&
            typeof YTPlay !== 'undefined' && !!YTPlay.liveOpen && YTPlay.installMode() !== 'browser';
    }
    function liveKnown(url) {
        var k = (U.store.get(LIVE_KEY, {}) || {})[url];
        return (k && Date.now() - k.at < LIVE_DAYS * 86400000) ? k : null;
    }
    // The caption channels kept for a link: [{ ch: 'CC1', lang: 'en' }], or null (not known yet).
    function ccOf(k) {
        if (!k || !Array.isArray(k.cc)) { return null; }
        return k.cc.filter(function (c) { return c && /^CC[1-4]$/.test(c.ch) && (!c.lang || /^[a-z]{2,3}$/.test(c.lang)); }).slice(0, 4);
    }
    function liveKeep(url, fix, cc) {
        var all = U.store.get(LIVE_KEY, {}) || {};
        all[url] = { fix: fix ? 1 : 0, at: Date.now() };
        if (cc) { all[url].cc = cc; }
        var keys = Object.keys(all);
        if (keys.length > LIVE_KEEP) {
            keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - LIVE_KEEP).forEach(function (k) { delete all[k]; });
        }
        U.store.set(LIVE_KEY, all);
    }
    // Captions on from the start: your choice for this channel (a closed-caption track picked
    // there last), else one in your default subtitle language (or second choice).
    function ccWanted(ctx, cc) {
        if (!cc || !cc.length) { return false; }
        var mem = P.recallSub(ctx.id);
        if (mem) { return !!mem.embedded; }
        var cfg = P.getSubCfg(), langs = [cfg.lang, cfg.lang2].filter(function (l) { return l && l !== 'off' && l !== 'none'; });
        return cc.some(function (c) { return c.lang && langs.some(function (l) { return P.langMatches(l, c.lang); }); });
    }
    function ccIndex(cc, w) { for (var i = 0; i < cc.length; i++) { if (cc[i].ch === w.ch) { return i; } } return 0; }
    function relayed(ctx, r, cc) {
        if (!r || typeof r.url !== 'string' || !/^http:\/\/localhost:\d+\/live\//.test(r.url)) { return false; }
        ctx._relay = r.url; ctx._relayFor = ctx.url; ctx._relayCc = cc || null; ctx._ccOffer = cc ? null : ctx._ccOffer;
        return true;
    }
    function startLive(ctx, settle) {
        var known = liveFixable(ctx) ? liveKnown(ctx.url) : null, cc = ccOf(known);
        if (cc && cc.length) { ctx._ccOffer = cc; }
        var withCc = ccWanted(ctx, cc) ? cc : null;
        if (cc) { ctx._liveChecked = true; }   // (both answers in: not asked again)
        if (!known || (!known.fix && !withCc)) { startAV(ctx.url, settle); return; }
        YTPlay.liveOpen(ctx.url, ctx._headers, true, { fix: !!known.fix, cc: withCc }).then(function (r) {
            if (S.ctx !== ctx || !S.active) { return; }
            relayed(ctx, r, withCc);
            startAV(ctx.url, settle);
        }, function () { if (S.ctx === ctx && S.active) { startAV(ctx.url, settle); } });
    }
    function liveCheck() {
        var ctx = S.ctx;
        if (!ctx || ctx._liveChecked || !liveFixable(ctx)) { return; }
        ctx._liveChecked = true;
        var known = liveKnown(ctx.url);
        if (known && ccOf(known)) { return; }
        var url = ctx.url;
        YTPlay.liveOpen(url, ctx._headers, false).then(function (r) {
            if (!r || !r.sure) { return; }   // (couldn't tell: asked again next time)
            var cc = (r.ccSure || r.cc === undefined) ? (ccOf(r) || []) : null, fix = known ? !!known.fix : !!r.fix;   // (captions with no text yet: asked again next time; the sound's answer: as first found)
            liveKeep(url, fix, cc);
            if (S.ctx !== ctx || !S.active || ctx.url !== url) { return; }
            if (cc && cc.length && !ctx._relayCc) { ctx._ccOffer = cc; }
            if (cc && cc.length && ccWanted(ctx, cc)) { ccOn(ctx, 'Adding this channel’s captions…'); return; }
            if (known || !fix || ctx._relay || !relayed(ctx, r, null)) { return; }   // (the sound: restarted for on its first look only)
            U.log('player', 'Live sound repacked by StremioK\'s service (' + (r.why || '') + ')');
            reopen('Fixing this channel’s sound…');
        }, function () {});
    }
    // The channel again through the relay with its closed captions as subtitle tracks (the sound
    // repacked too when it needs it); then: true once it's reopening. want: a caption track to
    // select once it plays ({ ch, lang }).
    function ccOn(ctx, message, want) {
        var known = liveKnown(ctx.url), cc = ccOf(known) || ctx._ccOffer;
        if (!cc || !cc.length || !liveFixable(ctx)) { return Promise.resolve(false); }
        return YTPlay.liveOpen(ctx.url, ctx._headers, true, { fix: !!(known && known.fix), cc: cc }).then(function (r) {
            if (S.ctx !== ctx || !S.active || !relayed(ctx, r, cc)) { return false; }
            var w = want || cc.filter(function (c) { return ccWanted(ctx, [c]); })[0] || null;
            U.log('player', 'Live captions through StremioK\'s service (' + cc.map(function (c) { return c.ch; }).join(', ') + ')');
            reopen(message);
            if (w && P.wantEmbedded) { P.wantEmbedded({ nth: ccIndex(cc, w), lang: w.lang }); }   // (after the reopen: on its tracks)
            return true;
        }, function () { return false; });
    }
    P.ccOn = function (want) { return S.ctx ? ccOn(S.ctx, 'Adding this channel’s captions…', want) : Promise.resolve(false); };
    // The relay didn't start (StremioK's service gone): the channel as it is.
    function relayFailed() {
        if (S.playStarted || !S.ctx || !S.ctx._relay) { return false; }
        U.log('player', 'Live sound relay failed: playing the channel as it is');
        S.ctx._relay = null;
        startAV(S.ctx.url);
        return true;
    }

    // ---------- stall recovery ----------
    // Time not moving while playing (not paused or buffering) for STALL_SECS, or buffering
    // that never finishes, reloads the stream in place: VOD at the same position, live at
    // the edge. A source that stalls STALL_MAX times within STALL_WINDOW_MS is given up on
    // (VOD lands back on its source list). Checked from the 5 s ticker.
    var STALL_SECS = 12, BUFFER_STALL_SECS = 30, STALL_MAX = 3, STALL_WINDOW_MS = 5 * 60 * 1000;
    function checkStall() {
        if (!S.active || !S.playStarted || scrubbing()) { _stall.since = 0; _stall.bufSince = 0; return; }
        var now = Date.now();
        if (S.buffering) {
            if (!_stall.bufSince) { _stall.bufSince = now; }
            else if (now - _stall.bufSince > BUFFER_STALL_SECS * 1000) { recoverStall('Stream stopped loading'); }
            return;
        }
        _stall.bufSince = 0;
        if (isPaused() || S.cur !== _stall.t) { _stall.t = S.cur; _stall.since = now; return; }
        if (_stall.since && now - _stall.since > STALL_SECS * 1000) { recoverStall('Playback stalled'); }
    }
    function recoverStall(why) {
        if (liveReconnects()) { liveDropped(why); return; }
        var now = Date.now();
        _stall.recoveries = _stall.recoveries.filter(function (t) { return now - t < STALL_WINDOW_MS; });
        if (_stall.recoveries.length >= STALL_MAX) {
            U.spinner(false);
            U.toast('This source keeps stalling — try another one', 4000);
            exit();
            return;
        }
        _stall.recoveries.push(now);
        reopen(why + ' — reloading…');
    }

    // ---------- a live channel that drops ----------
    // A live channel that stops (an error once it played, its connection lost; frozen, stuck
    // loading, or ended by its server) is opened again at the live edge, as Settings › Playback ›
    // Seeking & buffering › Reconnect live channels says: Off (the player closes), A few times
    // (STALL_MAX within STALL_WINDOW_MS, as any stall) or Keep trying (no limit). A try that
    // doesn't play is followed by another, each a little later (RECO_WAIT_S); BACK stops it.
    // Not for a trailer or YouTube (a stall there reloads as a video's does).
    var RECO_WAIT_S = [0, 5, 10, 20, 40, 60], _reco = { tries: 0, timer: null };
    function liveReconnects() { return S.isLive && !!S.ctx && !S.ctx.trailer && !S.ctx.yt; }
    function recoReset() {
        if (_reco.timer) { clearTimeout(_reco.timer); }
        _reco = { tries: 0, timer: null };
    }
    function liveDropped(why) {
        if (_reco.timer) { return; }   // (a try already waiting)
        var mode = P.playerCfg().reconnect, now = Date.now();
        if (mode === 'off') {
            U.log('player', 'Live channel: ' + why + '; reconnecting is off');
            U.spinner(false); U.toast(why + ': the channel stopped (reconnecting is off)', 5000);
            exitLater();
            return;
        }
        _stall.recoveries = _stall.recoveries.filter(function (t) { return now - t < STALL_WINDOW_MS; });
        if (mode !== 'always' && _stall.recoveries.length >= STALL_MAX) {
            U.log('player', 'Live channel: ' + why + '; dropped ' + STALL_MAX + ' times in ' + (STALL_WINDOW_MS / 60000) + ' minutes, given up');
            U.spinner(false); U.toast('This channel keeps dropping — try it again later', 5000);
            exit();
            return;
        }
        _stall.recoveries.push(now);
        var n = ++_reco.tries, wait = RECO_WAIT_S[Math.min(n - 1, RECO_WAIT_S.length - 1)] * 1000, ctx = S.ctx;
        var msg = why + ' — reconnecting' + (n > 1 ? ' (try ' + n + ')' : '') + '…';
        U.log('player', 'Live channel: ' + why + ', reconnecting (try ' + n + (wait ? ', in ' + (wait / 1000) + ' s' : '') + ')');
        if (!wait) { reopen(msg); return; }
        U.spinner(true, msg);
        function due() {
            _reco.timer = null;
            if (!S.active || S.ctx !== ctx) { return; }
            if (inBackground()) { _reco.timer = setTimeout(due, 5000); return; }   // (back first)
            reopen(msg);
        }
        _reco.timer = setTimeout(due, wait);
    }
    // The stream opened again in place: VOD at the same position, live at the edge.
    function reopen(message) {
        _stall.t = -1; _stall.since = 0; _stall.bufSince = 0;
        S.ctx.resumeSec = S.isLive ? 0 : S.cur;
        if (S.ctx.yt && typeof YTPlay !== 'undefined') { S.ctx.url = YTPlay.resolverUrl(S.ctx.yt, qualityHeight(), true, S.ctx.ytLang); }
        clearStartNote();
        U.spinner(true, message);
        if (useAV) { startAV(S.ctx.url); } else { startHTML5(S.ctx.url); }
    }

    function exit() {
        if (!S.active) { return; }
        if (U.crumb) { U.crumb('player closed'); }
        if (P.sleepClear) { P.sleepClear(); }   // (the sleep timer: this playback's)
        saveProgress();
        // Record partial progress to Trakt (unfinished VOD) so it shows in Continue Watching. Past
        // 85% (Trakt connected): finished, Trakt's way (it marks it watched), and here as at the credits.
        if (!S.isLive && !_creditsHandled && S.ctx && !S.ctx.trailer && !S.ctx.private && !isNotice() && S.cur > 60 && typeof Trakt !== 'undefined' && Trakt.onProgress) {
            if (S.dur > 0 && S.cur / S.dur >= FINISHED_SHARE && Trakt.onStopped && Trakt.isConnected && Trakt.isConnected()) {
                _creditsHandled = true;
                markFinished(true);
                Trakt.onStopped(S.ctx.type, S.ctx.id, S.cur, S.dur, S.ctx.name);
            } else {
                Trakt.onProgress(S.ctx.type, S.ctx.id, S.cur, S.dur, S.ctx.name);
            }
        }
        S.active = false;
        _bg = null;
        closeControls();
        screenSaver(true);
        _playToken++;   // invalidate AVPlay/HTML5 callbacks before stop/close emits any
        recoReset();
        if (_ticker) { clearInterval(_ticker); _ticker = null; }
        if (_osdTimer) { clearTimeout(_osdTimer); _osdTimer = null; }
        hideOSD();
        closeSubs();
        if (useAV) {
            try { avplay.stop(); } catch (e) {}
            try { avplay.close(); } catch (e2) {}
            objEl.className = '';
        } else {
            try { S.videoEl.pause(); } catch (e3) {}
            S.videoEl.removeAttribute('src');
            S.videoEl.className = '';
        }
        document.body.style.background = '';
        U.byId('app').className = '';
        U.spinner(false);
        // finished: this playback reached the credits/end (and so marked the item watched)
        var cb = _onExit, finished = _creditsHandled; _onExit = null; S.ctx = null;
        if (cb) { cb({ finished: finished }); }
    }

    // ----- for the other parts (and js/player.js) -----
    P.init = init; P.isActive = isActive; P.showOSD = showOSD; P.hideOSD = hideOSD; P.renderOSD = renderOSD; P.play = play; P.playLinked = playLinked; P.replaceSource = replaceSource;
    P.updateHint = updateHint; P.startAV = startAV; P.startHTML5 = startHTML5;
    P.handleCredits = handleCredits; P.isPaused = isPaused; P.play_ = play_; P.pause_ = pause_;
    P.sponsorHighlight = sponsorHighlight;
    P.chapters = chapters; P.chapterAt = chapterAt; P.chapterLabel = chapterLabel;
    P.seekTo = seekTo; P.doAVSeek = doAVSeek; P.seekBy = seekBy; P.exit = exit;
    P.reload = function () { if (S.active && S.ctx) { reopen(S.isLive ? 'Reloading the channel…' : 'Reloading…'); } };   // (the menu's Reload)
})(PlayerParts);
