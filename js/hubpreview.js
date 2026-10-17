/* Continue Watching on the TV's own home bar (Samsung's Smart Hub preview). The tiles
   (Views.previewTiles: only what can be played now) go to StremioK's preview service
   (service/preview.js), which hands them to the TV: when StremioK opens (once the shows'
   episodes are current) and when it's left (the TV's Home), only when they changed, and at
   most once every 10 minutes, as Samsung asks. A tile picked on the home bar opens StremioK
   on that title, on its episode. Off (Settings › Appearance › Home bar preview): the row
   emptied. The sideloaded app only: TizenBrew runs no such service. Global namespace: HubPreview */
var HubPreview = (function () {
    'use strict';
    var SERVICE = 'StremioK01.service', EVERY_MS = 10 * 60 * 1000, SENT_KEY = 'stremiok.homepreview';
    var _timer = null;
    // Tizen 4 and later: the 2017 TV (Tizen 3) shows no preview for it, so there it's left out
    // (no setting, nothing sent).
    function tizenMajor() {
        var m = /\bTizen (\d+)/.exec('' + ((window.navigator && navigator.userAgent) || ''));
        if (m) { return +m[1]; }
        try { return parseInt(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'), 10) || 0; } catch (e) { return 0; }
    }
    function available() {
        return typeof YTPlay !== 'undefined' && YTPlay.installMode() === 'wgt' && !!(window.tizen && tizen.application && tizen.application.launchAppControl && tizen.ApplicationControl) &&
            tizenMajor() >= 4;
    }
    function payload() {
        var tiles = (Stremio.getPrefs().homePreview && Views.previewTiles) ? Views.previewTiles() : [];
        return { sections: tiles.length ? [{ title: 'Continue Watching', tiles: tiles }] : [] };
    }
    // now: on / off just switched (sent whatever the wait). Else only a change, 10 minutes apart.
    function send(now) {
        if (!available()) { return; }
        var json = JSON.stringify(payload()), last = U.store.get(SENT_KEY, null) || {}, t = Date.now();
        if (!now && json === last.json) { return; }
        if (!now && t - (last.at || 0) < EVERY_MS) { later(last.at + EVERY_MS - t); return; }
        U.store.set(SENT_KEY, { json: json, at: t });
        try {
            tizen.application.launchAppControl(
                new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick', null, 'image/jpeg', null,
                    [new tizen.ApplicationControlData('caller', ['ForegroundApp']), new tizen.ApplicationControlData('tiles', [json])]),
                SERVICE, function () {}, function (e) { U.log('preview', 'Home bar preview not sent: ' + ((e && e.message) || e)); });
        } catch (e) { U.log('preview', 'Home bar preview not sent: ' + (e && e.message)); }
    }
    function later(ms) {
        if (_timer) { clearTimeout(_timer); }
        _timer = setTimeout(function () { _timer = null; send(); }, Math.max(1000, ms));
    }
    // A tile picked: its title (the action data each tile carries), as Continue Watching opens it.
    function picked(data) {
        var o = null;
        (data || []).forEach(function (d) {
            if (o || (d.key !== 'PAYLOAD' && d.key !== 'action_data')) { return; }
            try { o = JSON.parse(d.value && d.value[0]); if (o && typeof o.values === 'string') { o = JSON.parse(o.values); } } catch (e) { o = null; }
        });
        if (!o || typeof o.id !== 'string' || typeof o.type !== 'string') { return false; }
        var series = o.type === 'series', base = (series && typeof o.parent === 'string' && o.parent) || o.id;
        App.openDetail(series ? 'series' : 'movie', base, null, base !== o.id ? o.id : null);
        return true;
    }
    function received() {
        try {
            var req = tizen.application.getCurrentApplication().getRequestedAppControl();
            if (req && req.appControl) { picked(req.appControl.data); }
        } catch (e) {}
    }
    function start() {
        if (!available()) { return; }
        received();   // (opened from a tile)
        try { window.addEventListener('appcontrol', received, false); } catch (e) {}   // (a tile picked while it runs)
        try { document.addEventListener('visibilitychange', function () { if (U.isHidden()) { send(); } }, false); } catch (e2) {}
        setTimeout(function () { if (Views.withShowInfo) { Views.withShowInfo(function () { send(); }); } else { send(); } }, 8000);
    }
    return { start: start, send: send, available: available, picked: picked, payload: payload };
})();
