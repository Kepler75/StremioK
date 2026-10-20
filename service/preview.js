"use strict";
/*
 * StremioK's tiles on the TV's home bar (Samsung's Smart Hub preview). A short-lived service,
 * started two ways:
 *   - by StremioK (js/hubpreview.js), with its Continue Watching as tiles (app control data
 *     "tiles", caller "ForegroundApp"): kept in the service's folder, then set;
 *   - by the TV on its own, about every 10 minutes: the tiles StremioK last sent are set
 *     again (none kept: nothing changes).
 * It sets them (webapis.preview.setPreviewData) and exits, as Samsung asks.
 * Node core modules only; ES5 (the 2017 TV's Node is old).
 */
var TILES_FILE = 'preview-tiles.json', TILES_MAX = 65536;
function dataDir() {
    try {
        if (typeof __filename === 'string') { var i = __filename.indexOf('/res/wgt/'); if (i !== -1) { return __filename.slice(0, i) + '/data'; } }
    } catch (e) {}
    return '/opt/usr/apps/StremioK01/data';
}
function done() { try { tizen.application.getCurrentApplication().exit(); } catch (e) {} }
var _ran = false;
module.exports.onStart = function () { run(); };
module.exports.onRequest = function () { run(); };
module.exports.onExit = function () {};
function run() {
    if (_ran) { return; }
    _ran = true;
    var json = null, fs = null, fromApp = false;
    try { fs = require('fs'); } catch (e) {}
    try {
        var req = tizen.application.getCurrentApplication().getRequestedAppControl();
        var data = (req && req.appControl && req.appControl.data) || [], caller = '', tiles = null;
        data.forEach(function (d) {
            if (d.key === 'caller') { caller = d.value && d.value[0]; }
            if (d.key === 'tiles') { tiles = d.value && d.value[0]; }
        });
        if (caller === 'ForegroundApp' && typeof tiles === 'string' && tiles.length <= TILES_MAX) { json = tiles; fromApp = true; }
    } catch (e1) {}
    if (json) { try { fs.writeFileSync(dataDir() + '/' + TILES_FILE, json); } catch (e2) {} }
    else { try { json = String(fs.readFileSync(dataDir() + '/' + TILES_FILE, 'utf8')); } catch (e3) { json = null; } }   // (the TV asking: the last ones sent)
    var ok = false;
    try { var o = JSON.parse(json); ok = !!o && Array.isArray(o.sections) && json.length <= TILES_MAX; } catch (e4) {}
    // StremioK (not the TV) asked: told whether the TV took them (it counts them as sent only then)
    function answer(took) {
        if (fromApp) {
            try {
                var rq = tizen.application.getCurrentApplication().getRequestedAppControl();
                if (took) { rq.replyResult([new tizen.ApplicationControlData('result', ['ok'])]); } else { rq.replyFailure(); }
            } catch (e6) {}
        }
        done();
    }
    if (!ok || typeof webapis === 'undefined' || !webapis || !webapis.preview || typeof webapis.preview.setPreviewData !== 'function') { answer(false); return; }
    try { webapis.preview.setPreviewData(json, function () { answer(true); }, function () { answer(false); }); } catch (e5) { answer(false); }
}
