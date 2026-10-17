/* Remote control input. Global namespace: Keys
   Registers TV media keys and normalizes keyCodes into symbolic actions. */
var Keys = (function () {
    'use strict';

    var CODE = {
        37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN',
        13: 'OK',
        10009: 'BACK',      // RETURN
        415: 'PLAY',
        19: 'PAUSE',
        10252: 'PLAYPAUSE',
        413: 'STOP',
        417: 'FF',
        412: 'REW',
        427: 'CHUP', 428: 'CHDOWN',
        10232: 'PREV', 10233: 'NEXT',   // ⏮ / ⏭ (MediaTrackPrevious / MediaTrackNext)
        403: 'RED', 404: 'GREEN', 405: 'YELLOW', 406: 'BLUE',   // the colored keys (the player's audio, subtitles, sources, stream info)
        48: 'NUM0', 49: 'NUM1', 50: 'NUM2', 51: 'NUM3', 52: 'NUM4', 53: 'NUM5', 54: 'NUM6', 55: 'NUM7', 56: 'NUM8', 57: 'NUM9'   // the number keys
    };

    // Names to register via the TVInputDevice API (arrows/OK/RETURN are always on).
    var REGISTER = [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaRewind', 'MediaFastForward',
        'MediaTrackPrevious', 'MediaTrackNext',
        'ChannelUp', 'ChannelDown',   // CH+/CH− switch live channels in the player
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'   // (Home's tabs, the player's subtitles, a channel's number)
    ];

    function register() {
        try {
            if (window.tizen && tizen.tvinputdevice && tizen.tvinputdevice.registerKey) {
                REGISTER.forEach(function (name) {
                    try { tizen.tvinputdevice.registerKey(name); } catch (e) {}
                });
            }
        } catch (e) {}
    }

    var _handler = null;
    function setHandler(fn) { _handler = fn; }

    var LONG_MS = 550;      // hold threshold for a long-press
    var _okDownAt = 0;

    // Holding a D-pad key auto-repeats. If one move takes longer than the repeat
    // interval, keydowns queue up and focus keeps sliding after release. Drop a
    // repeat of the held key that arrives within REPEAT_GAP_MS of the previous move
    // *finishing*, so a backlog is discarded rather than replayed.
    var DIRECTIONS = { LEFT: 1, RIGHT: 1, UP: 1, DOWN: 1 };
    var REPEAT_GAP_MS = 80;
    var _heldCode = 0;
    var _lastDirDone = 0;

    function dispatch(action, ev) {
        if (!_handler) { return; }
        var handled = _handler(action, ev);
        if (handled !== false && ev.preventDefault) { ev.preventDefault(); }
    }

    function typing(ev) { var t = ev && ev.target, n = t && t.tagName ? ('' + t.tagName).toUpperCase() : ''; return n === 'INPUT' || n === 'TEXTAREA'; }
    function onKeyDown(ev) {
        var action = CODE[ev.keyCode];
        if (!action) { return; }
        if (/^NUM/.test(action) && typing(ev)) { return; }   // (a number typed into a field: the field's)
        if (action === 'OK') {
            // Defer OK to keyup so we can tell a tap from a long-press.
            if (_okDownAt === 0) { _okDownAt = Date.now(); }
            if (ev.preventDefault) { ev.preventDefault(); }
            return;
        }
        if (DIRECTIONS[action]) {
            if (ev.keyCode === _heldCode && Date.now() - _lastDirDone < REPEAT_GAP_MS) {
                if (ev.preventDefault) { ev.preventDefault(); }
                return;
            }
            _heldCode = ev.keyCode;
            dispatch(action, ev);
            _lastDirDone = Date.now();
            return;
        }
        dispatch(action, ev);
    }

    function onKeyUp(ev) {
        if (ev.keyCode === _heldCode) { _heldCode = 0; }
        if (CODE[ev.keyCode] !== 'OK') { return; }
        // If _okDownAt is 0 the keydown was consumed elsewhere (e.g. a text input
        // that stopped propagation) — don't fire a stray action.
        if (_okDownAt === 0) { return; }
        var held = Date.now() - _okDownAt;
        _okDownAt = 0;
        dispatch(held >= LONG_MS ? 'OK_LONG' : 'OK', ev);
    }

    // Tizen also delivers hardware RETURN/BACK as a 'tizenhwkey' event. Route it
    // through the same handler and preventDefault so the platform doesn't exit the
    // app behind our back when a normal keydown isn't delivered.
    function onHwKey(ev) {
        if (ev && ev.keyName === 'back') { dispatch('BACK', ev); }
    }

    function init() {
        register();
        document.addEventListener('keydown', onKeyDown, false);
        document.addEventListener('keyup', onKeyUp, false);
        document.addEventListener('tizenhwkey', onHwKey, false);
    }

    return { init: init, setHandler: setHandler, CODE: CODE };
})();
