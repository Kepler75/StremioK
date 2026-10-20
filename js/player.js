/* Player: playback via Tizen AVPlay, with an HTML5 <video> fallback for desktop dev.
   Global namespace: Player
   The code lives in js/player-core.js, player-store.js, player-lang.js, player-quality.js,
   player-subs.js, player-audio.js and player-controls.js (loaded before this file, in that
   order); this file just assembles the public API. */
var Player = (function (P) {
    'use strict';
    return {
        init: P.init, play: P.play, handleKey: P.handleKey, isActive: P.isActive,
        exit: P.exit, continueList: P.continueList, getResume: P.getResume, removeProgress: P.removeProgress,
        getSubCfg: P.getSubCfg, setSubCfg: P.setSubCfg, getAudioCfg: P.getAudioCfg, setAudioCfg: P.setAudioCfg,
        isWatched: P.isWatched, watchedState: P.watchedState, watchedAt: P.watchedAt, watchedSince: P.watchedSince, progressFor: P.progressFor,
        addToContinue: P.addToContinue, setWatched: P.setWatched, setWatchedMany: P.setWatchedMany, clearUnwatched: P.clearUnwatched,
        isPrivate: P.isPrivate, setPrivate: P.setPrivate, privateNow: P.privateNow, playerCfg: P.playerCfg, setPlayerCfg: P.setPlayerCfg, langName: P.langName, lang2: P.lang2, langKey: P.langKey,
        SUB_FONTS: P.SUB_FONTS, SUB_COLORS: P.SUB_COLORS, SUB_BGS: P.SUB_BGS, SUB_EDGES: P.SUB_EDGES, SUB_POSITIONS: P.SUB_POSITIONS
    };
})(PlayerParts);
