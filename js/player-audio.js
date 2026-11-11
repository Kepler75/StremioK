/* Player, part 6 of 7 — audio tracks: the remembered or preferred one picked once playback
   runs, switching, and the audio menu.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';
    var S = P.S;
    var avplay = P.avplay;   // (P.useAV: the TV's player's playback or the page's, as it is now: see player-core's engineFor)

    // ----- from the other parts -----
    function doAVSeek() { return P.doAVSeek.apply(null, arguments); }   // core
    function getAudioCfg() { return P.getAudioCfg.apply(null, arguments); }   // store
    function recallAudio() { return P.recallAudio.apply(null, arguments); }   // store
    function rememberAudio() { return P.rememberAudio.apply(null, arguments); }   // store
    function infoLang() { return P.infoLang.apply(null, arguments); }   // lang
    function langKey() { return P.langKey.apply(null, arguments); }   // lang
    function langMatches() { return P.langMatches.apply(null, arguments); }   // lang
    function langName() { return P.langName.apply(null, arguments); }   // lang
    function langRank() { return P.langRank.apply(null, arguments); }   // lang
    function trackInfo() { return P.trackInfo.apply(null, arguments); }   // lang
    function trackLang() { return P.trackLang.apply(null, arguments); }   // lang
    function closeMenu() { return P.closeMenu.apply(null, arguments); }   // controls

    var _audioIdx = null;    // currently selected audio track index
    var _audioPending = false; // apply the remembered/preferred track once playback is running
    var _audioSteadySince = 0; // when playback was last seen running without buffering/seeking
    // The automatic pick (Safe) waits for playback to settle, but only briefly (1.2.5: it
    // used to be 1.5 s after a seek plus 1.5 s steady, 3-4 s of the wrong language on a
    // resume; 1.6.1: 600 + 700 ms, about 1.5 s): the second steady play-time report.
    var AUDIO_QUIET_MS = 300;    // after a seek (the resume one) before counting
    var AUDIO_STEADY_MS = 400;   // then this long playing without buffering
    var AUDIO_REWIND_S = 6;      // a switch's reload starts this far back (see selectAudio)
    // The 2017 TV's player crashes on a jump made within a few seconds of the resume one (an
    // audio switch's reload 3 s after a resume: StremioK gone; 10 s or 20 s in: fine). So the
    // reload never comes within SETTLE_MS of the start / resume or of a jump: the track
    // switches at once, its reload waits (_reseek), and is dropped if you jump meanwhile.
    // How long is yours (Settings › Audio › Wait after a start or jump): 0, 3, 6 or 10 s (the
    // default: what the 2017 TV needed; a newer TV may do with less).
    function settleMs() { return getAudioCfg().wait * 1000; }
    var _reseek = null;          // { at, mark: S.lastSeekAt when it was asked }

    function resetAudio() { _audioIdx = null; _audioPending = false; _reseek = null; _held = null; }
    // Playback is starting. The track is picked only once it's running (play-time ticks):
    // selected before play(), the TV records the choice but keeps decoding the default
    // track, and then ignores re-selecting it.
    // (Not on a YouTube video: its stream's own audio plays, the original, see the service's
    // keepOriginalAudio; switching tracks on one right after it starts can hang the 2017
    // TV's player. The menu still offers the others.)
    function audioOnStart() { _audioPending = !(S.ctx && S.ctx.yt); _audioSteadySince = 0; }
    function audioOnTick() {
        if (_held && !busyWhy()) { selectAudio(_held.index, _held.message, _held.force); }   // (a switch held: made now it plays)
        if (_audioPending) { maybeApplyAudio(); }
        if (_reseek && Date.now() >= _reseek.at) {
            var r = _reseek; _reseek = null;
            if (S.lastSeekAt === r.mark) { reloadAudio(); }   // (a jump of yours since: it reloaded the audio)
        }
    }
    // Quick (1.6.1, Settings › Audio › Switching): the track is picked as soon as the stream
    // is ready, before it plays, and the opening seek (the resume one, or to the start) makes
    // the player load its audio from that track: no wrong language first, no second
    // buffering. true: picked (the caller seeks). Safe: once it plays, as before. Not on
    // live streams (nothing to seek) or YouTube videos.
    function audioOnReady() {
        if (!P.useAV || S.isLive || (S.ctx && S.ctx.yt) || getAudioCfg().switch === 'safe') { return false; }
        var tracks = getAudioTracks();
        _audioIdx = playingAudioIndex(tracks);
        _audioPending = false;   // (decided here: not again once it plays)
        var pos = preferredPos(tracks);
        if (pos < 0 || tracks[pos].index === _audioIdx) { return false; }
        setAudioTrack(tracks[pos].index);
        _audioIdx = tracks[pos].index;
        U.log('player', 'Audio picked before playback (Quick): ' + audioLabel(tracks[pos], pos));
        U.toast(U.t('Audio: {track}', { track: audioLabel(tracks[pos], pos) }));
        return true;
    }

    function getAudioTracks() {
        if (P.useAV) {
            try {
                var all = avplay.getTotalTrackInfo() || [];
                var out = [];
                for (var i = 0; i < all.length; i++) {
                    if (('' + all[i].type).toUpperCase() === 'AUDIO') { out.push(all[i]); }
                }
                return out;
            } catch (e) { return []; }
        }
        try {
            var at = S.videoEl.audioTracks, arr = [];
            if (at) {
                for (var j = 0; j < at.length; j++) {
                    arr.push({ index: j, extra_info: JSON.stringify({ language: at[j].language || at[j].label }) });
                }
            }
            return arr;
        } catch (e2) { return []; }
    }

    // Position in `tracks` of a remembered choice, or -1: the same track on the same
    // source, else a track in the same language (same channel count preferred).
    function rememberedAudioPos(tracks, mem) {
        var i, info, lang = langKey(mem.lang);
        if (mem.url === (S.ctx && S.ctx.url)) {
            for (i = 0; i < tracks.length; i++) {
                info = trackInfo(tracks[i]);
                if (tracks[i].index === mem.index && langKey(infoLang(info)) === lang) { return i; }
            }
        }
        if (!lang || lang === 'und') { return -1; }
        var sameLang = -1;
        for (i = 0; i < tracks.length; i++) {
            info = trackInfo(tracks[i]);
            if (langKey(infoLang(info)) !== lang) { continue; }
            if ('' + (info.channels || info.channel || '') === '' + (mem.ch || '')) { return i; }
            if (sameLang < 0) { sameLang = i; }
        }
        return sameLang;
    }

    // The TV can accept an audio switch made while playback is still starting (right after
    // the first frame, or around the resume seek) without its decoder following: it then
    // reports the new track while the old one keeps playing, and ignores picking the new
    // one again. So the automatic pick waits until playback has run steadily for a moment.
    function maybeApplyAudio() {
        var now = Date.now();
        if (S.buffering || S.pendingSeek != null || now - S.lastSeekAt < AUDIO_QUIET_MS) { _audioSteadySince = 0; return; }
        if (!_audioSteadySince) { _audioSteadySince = now; return; }
        if (now - _audioSteadySince < AUDIO_STEADY_MS) { return; }
        _audioPending = false;
        try { applyPreferredAudio(); } catch (e) {}
    }

    // Once a stream is ready, pick the audio track: the one last chosen for this title,
    // else one in the preferred language, else leave the first track (the stream's
    // default) playing.
    function applyPreferredAudio() {
        var tracks = getAudioTracks();
        _audioIdx = playingAudioIndex(tracks);
        var pos = preferredPos(tracks);
        if (pos >= 0 && tracks[pos].index !== _audioIdx) { selectAudio(tracks[pos].index, U.t('Audio: {track}', { track: audioLabel(tracks[pos], pos) })); }
    }
    // The track to play (its position in tracks), or -1: leave the one playing.
    function preferredPos(tracks) {
        if (tracks.length < 2) { return -1; }
        // (an episode: its own choice, else the one made last in the series — by its language)
        var pos = -1, mem = recallAudio(S.ctx && S.ctx.id) || (seriesOf(S.ctx) && recallAudio(seriesOf(S.ctx)));
        if (mem) { pos = rememberedAudioPos(tracks, mem); }
        if (pos < 0) {
            // preferred language, then the second choice ("Default" = first track, no preference)
            var cfg = getAudioCfg();
            var prefs = cfg.lang === 'default' ? [] : [cfg.lang];
            if (prefs.length && cfg.lang2 !== 'none' && cfg.lang2 !== cfg.lang) { prefs.push(cfg.lang2); }
            // (the track playing already in that language: kept, not swapped for another
            // track in it, e.g. the first English one when the file plays its second)
            var playing = -1;
            for (var k = 0; k < tracks.length; k++) { if (tracks[k].index === _audioIdx) { playing = k; break; } }
            for (var p = 0; p < prefs.length && pos < 0; p++) {
                if (playing >= 0 && langMatches(prefs[p], infoLang(trackInfo(tracks[playing])))) { pos = playing; break; }
                for (var i = 0; i < tracks.length; i++) {
                    var info = trackInfo(tracks[i]);
                    if (langMatches(prefs[p], infoLang(info))) { pos = i; break; }
                }
            }
        }
        return pos;
    }

    // The audio track the player is on: AVPlay reports it (a file can flag a track
    // other than the first as its default); otherwise assume the first track.
    function playingAudioIndex(tracks) {
        if (P.useAV) {
            try {
                var now = avplay.getCurrentStreamInfo() || [];
                for (var i = 0; i < now.length; i++) {
                    if (('' + now[i].type).toUpperCase() !== 'AUDIO') { continue; }
                    for (var j = 0; j < tracks.length; j++) { if (tracks[j].index === now[i].index) { return now[i].index; } }
                }
            } catch (e) {}
        }
        return tracks.length ? tracks[0].index : null;
    }

    function audioLabel(tr, n) {
        var info = trackInfo(tr);
        var lang = info && infoLang(info);
        var ch = info && (info.channels || info.channel);
        var parts = [];
        parts.push((lang && lang !== 'und' && lang !== '') ? lang : U.t('Audio {n}', { n: n + 1 }));
        if (ch) { parts.push(ch + 'ch'); }
        return parts.join('  ·  ');
    }
    // Menu wording: "English  ·  6ch  ·  EAC3  (eng)"; the raw tag keeps regional
    // variants apart (es-419 vs es-ES).
    function audioMenuLabel(tr, n) {
        var info = trackInfo(tr), lang = infoLang(info);
        var ch = info.channels || info.channel, codec = info.fourCC || info.codec || '';
        var parts = [lang && lang !== 'und' ? langName(lang) : U.t('Audio {n}', { n: n + 1 })];
        if (ch) { parts.push(ch + 'ch'); }
        if (codec) { parts.push(('' + codec).toUpperCase()); }
        var label = parts.join('  ·  ');
        return (lang && lang !== 'und' && langName(lang).toLowerCase() !== ('' + lang).toLowerCase()) ? label + '  (' + lang + ')' : label;
    }

    // force: the track picked is the one the TV already reports. If you can still hear
    // another language, the TV took an earlier switch without following it, and it
    // ignores re-picking the same track; stepping through a different track first makes
    // it switch for real (the manual workaround, in one press).
    function selectAudio(index, message, force) {
        if (P.useAV) {
            var why = busyWhy();
            if (why) { hold(index, message, force, why); return; }
            if (force) {
                var tracks = getAudioTracks();
                for (var k = 0; k < tracks.length; k++) {
                    if (tracks[k].index !== index) { setAudioTrack(tracks[k].index); break; }
                }
            }
            var asked = Date.now();
            U.log('player', 'Audio switch to track ' + index + (force ? ' (again)' : '') + '. The TV lists: ' + rawAudio() + '. Playing: ' + playingRaw());
            if (!setAudioTrack(index)) { hold(index, message, false, 'refused'); return; }
            _held = null;
            setTimeout(function () {   // (what the TV says it plays once it's had time: a switch it took without following shows here)
                if (S.active && _audioIdx === index && Date.now() - asked < 10000) { U.log('player', 'Audio switch to track ' + index + ': the TV now plays ' + playingRaw()); }
            }, SWITCH_CHECK_MS);
            // A seek makes the player reload audio from the selected track instead of carrying
            // on with what it had buffered (movies/episodes; live can't seek): now, or once
            // SETTLE_MS have passed since the start / resume or a jump (see above).
            if (!S.isLive && S.playStarted) {
                var settled = Math.max(S.settleFrom || 0, S.lastSeekAt || 0) + settleMs();
                if (Date.now() >= settled) { _reseek = null; reloadAudio(); }
                else { _reseek = { at: settled, mark: S.lastSeekAt }; }
            }
        } else {
            try { var at = S.videoEl.audioTracks; for (var i = 0; i < at.length; i++) { at[i].enabled = (i === index); } } catch (e3) {}
        }
        _audioIdx = index;
        U.toast(message || U.t('Audio track changed'));
    }

    // A series' episode: the series it's in (its choice of audio carries to the next episodes).
    function seriesOf(ctx) {
        return ctx && ctx.type === 'series' && ctx.parent && ctx.parent !== ctx.id ? 'series:' + ctx.parent : null;
    }

    // The player starts at the next keyframe after where it's sent, which can be seconds on:
    // sent AUDIO_REWIND_S back, a few seconds play again (in the new language) rather than
    // being skipped.
    function reloadAudio() {
        var back = Math.max(0, S.cur - AUDIO_REWIND_S);
        S.cur = back;
        doAVSeek(back, 0);
    }

    // true: the TV took it (asked as a number, else as text); false: it refused both.
    function setAudioTrack(index) {
        try { avplay.setSelectTrack('AUDIO', index); return true; }
        catch (e) {
            try { avplay.setSelectTrack('AUDIO', '' + index); return true; }
            catch (e2) { U.log('player', 'Audio track ' + index + ' refused by the TV: ' + trackError(e2) + ' (as a number: ' + trackError(e) + ')'); return false; }
        }
    }
    // The TV refuses a switch while paused or while a jump is still going on (it says it plays
    // meanwhile), PLAYER_ERROR_INVALID_OPERATION (2.3.0.2, issue 17: the menu ticked the track,
    // the audio stayed). Such a switch is held (_held) and made at the first play-time report
    // once it plays on, steadily; one it still refuses, held again, up to HOLD_TRIES times.
    var _held = null;            // { index, message, force, tries }
    var SEEK_BUSY_MS = 1500, HOLD_TRIES = 4;
    function busyWhy() {
        if (P.isPaused()) { return 'paused'; }
        if (S.buffering || S.pendingSeek != null) { return 'buffering'; }
        if (Date.now() - (S.lastSeekAt || 0) < SEEK_BUSY_MS) { return 'jumping'; }
        return '';
    }
    function hold(index, message, force, why) {
        var tries = _held && _held.index === index ? _held.tries + 1 : 0;
        if (tries >= HOLD_TRIES) {
            _held = null;
            U.log('player', 'Audio switch to track ' + index + ': still refused after ' + HOLD_TRIES + ' tries, left');
            U.toast(U.t('The TV didn’t switch the audio: choose it again'), 4000);
            return;
        }
        var first = !_held || _held.index !== index;
        _held = { index: index, message: message, force: force, tries: tries };
        _audioIdx = index;   // (the menu ticks it meanwhile)
        if (first) { U.log('player', 'Audio switch to track ' + index + ' held (' + why + '): made once it plays on'); }
        if (first && why === 'paused') { U.toast(U.t('{what}: when you carry on', { what: message || U.t('Audio track changed') }), 3000); }
    }
    // ----- Diagnostics: what the TV said of its audio tracks around a switch -----
    var SWITCH_CHECK_MS = 2500;
    function trackError(e) { return ('' + ((e && (e.name || e.code)) || '') + ' ' + ((e && e.message) || '')).replace(/\s+/g, ' ').trim().slice(0, 120) || 'no reason given'; }
    function rawOf(t) { return t.index + ' ' + ('' + (t.extra_info == null ? '' : t.extra_info)).replace(/\s+/g, ' ').slice(0, 160); }
    // its audio tracks as it lists them (getTotalTrackInfo): index, then what it says of each
    function rawAudio() {
        try {
            var l = (avplay.getTotalTrackInfo() || []).filter(function (t) { return t && ('' + t.type).toUpperCase() === 'AUDIO'; }).map(rawOf);
            return l.length ? l.join(' | ') : 'none';
        } catch (e) { return U.t('(unreadable: {why})', { why: trackError(e) }); }
    }
    // the audio track it says is playing (getCurrentStreamInfo)
    function playingRaw() {
        try {
            var now = (avplay.getCurrentStreamInfo() || []).filter(function (t) { return t && ('' + t.type).toUpperCase() === 'AUDIO'; });
            return now.length ? rawOf(now[0]) : 'none reported';
        } catch (e) { return U.t('(unreadable: {why})', { why: trackError(e) }); }
    }

    // No TV player (TizenBrew: the TV gives it only to installed apps; a desktop browser): the
    // page's <video> plays a file's first audio track whatever is chosen (the TV's engine ignores
    // its audioTracks; checked on the Tizen 6 TV, issue 17), so the menu says so instead.
    function cantSwitch() { return !avplay; }
    function cantSwitchText() {
        return (typeof YTPlay !== 'undefined' && YTPlay.installMode && YTPlay.installMode() === 'tizenbrew')
            ? U.t('Under TizenBrew only a file’s first audio track plays: the TV gives its own player only to installed apps. The sideloaded app can switch.')
            : U.t('Here only a file’s first audio track plays (no TV player).');
    }
    // Tracks sorted by language (preferred languages first) and named in full, so the
    // same language's tracks sit together.
    function audioMenu() {
        var cfg = getAudioCfg(), prefs = [cfg.lang, cfg.lang2].filter(function (x) { return x && x !== 'default' && x !== 'none'; });
        var tracks = getAudioTracks().map(function (tr, i) { return { tr: tr, n: i, k: langKey(trackLang(tr)) }; });
        tracks.sort(function (a, b) {
            var ra = langRank(a.k, prefs), rb = langRank(b.k, prefs);
            if (ra !== rb) { return ra - rb; }
            var na = langName(a.k), nb = langName(b.k);
            return na !== nb ? (na < nb ? -1 : 1) : a.n - b.n;
        });
        var idx = 0, stuck = cantSwitch() && tracks.length > 1;
        var items = tracks.map(function (x, i) {
            var tr = x.tr;
            if (tr.index === _audioIdx) { idx = i; }
            return { label: audioMenuLabel(tr, x.n), sel: (tr.index === _audioIdx),
                run: function () {
                    if (stuck) { closeMenu(); U.toast(cantSwitchText(), 6000); return; }
                    // re-picking the checked track re-applies it (see selectAudio)
                    selectAudio(tr.index, U.t('Audio: {track}', { track: audioLabel(tr, x.n) }), tr.index === _audioIdx);
                    var info = trackInfo(tr);
                    var sel = { url: S.ctx.url, index: tr.index, lang: infoLang(info), ch: info.channels || info.channel || '' };
                    rememberAudio(S.ctx.id, sel);
                    if (seriesOf(S.ctx)) { rememberAudio(seriesOf(S.ctx), { url: sel.url, index: sel.index, lang: sel.lang, ch: sel.ch }); }
                    closeMenu();
                } };
        });
        // A live channel: its sound straight from the server, or repacked by StremioK's service
        // (player-core's setLiveSound), after its tracks.
        var ls = P.liveSound ? P.liveSound() : null;
        if (ls) {
            [[false, U.t('Sound: straight from the server'), U.t('Already straight from the server')], [true, U.t('Sound: repacked by StremioK’s service'), U.t('Already repacked by StremioK’s service')]].forEach(function (o) {
                var on = o[0] === ls.repacked;
                items.push({ label: o[1], sel: on, detail: on && ls.mine ? U.t('your choice') : '', run: function () {
                    closeMenu();
                    if (on) { U.toast(o[2], 2500); return; }
                    P.setLiveSound(o[0]);
                } });
            });
        }
        if (stuck) { return { title: U.t('Audio track'), items: items, idx: idx, wide: true, node: U.el('div', 'sm-detail', cantSwitchText()) }; }
        return { title: U.t('Audio track'), items: items, idx: idx };
    }

    // ----- for the other parts (and js/player.js) -----
    P.resetAudio = resetAudio; P.audioOnStart = audioOnStart; P.audioOnTick = audioOnTick; P.audioOnReady = audioOnReady;
    P.getAudioTracks = getAudioTracks; P.applyPreferredAudio = applyPreferredAudio; P.audioMenu = audioMenu;
})(PlayerParts);
