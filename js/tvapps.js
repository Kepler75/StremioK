/* Other apps on this TV: the installed list, the streaming apps you list (Settings ›
   Streaming apps), opening one, and finding the app for a title's "where to watch" source
   (a streaming service's name, e.g. "Amazon Prime Video" -> your "Amazon Video"). Uses Tizen's application API (the .wgt has the
   application.launch privilege). App IDs differ between TV models, so apps are picked from
   this TV's own list and saved on this TV only.
   Global namespace: TVApps */
var TVApps = (function () {
    'use strict';

    var KEY = 'stremiok.appshortcuts';   // [{ id, name }], your streaming apps
    var MAX = 40;

    function api() { return (window.tizen && tizen.application) || null; }
    function available() { var a = api(); return !!(a && a.getAppsInfo && a.launch); }
    function errText(e) { return '' + ((e && (e.name || e.message)) || 'unknown error'); }
    function byName(x, y) { var p = x.name.toLowerCase(), q = y.name.toLowerCase(); return p < q ? -1 : p > q ? 1 : 0; }

    // The installed apps, by name: [{ id, name, version, show }] (show false: a hidden
    // system app). Rejects with the TV's reason when it won't say. The last answer is kept
    // for matching links to apps (see appForService).
    var _last = null;
    function installed() {
        return new Promise(function (resolve, reject) {
            function fail(e) {
                var m = errText(e);
                U.log('apps', 'Listing the installed apps failed: ' + m);
                reject(new Error(m));
            }
            var a = api();
            if (!a || !a.getAppsInfo) { reject(new Error('Not available here')); return; }
            try {
                a.getAppsInfo(function (apps) {
                    var list = [];
                    (apps || []).forEach(function (x) {
                        if (!x || !x.id) { return; }
                        list.push({ id: '' + x.id, name: '' + (x.name || x.id), version: x.version ? '' + x.version : '', show: x.show !== false });
                    });
                    list.sort(byName);
                    _last = list;
                    resolve(list);
                }, fail);
            } catch (e) { fail(e); }
        });
    }

    // Opens an app ({ id, name }). Resolves once the TV has started it; rejects with its reason.
    function launch(app) {
        return new Promise(function (resolve, reject) {
            function fail(e) {
                var m = errText(e);
                U.log('apps', 'Opening ' + app.name + ' (' + app.id + ') failed: ' + m);
                reject(new Error(m));
            }
            var a = api();
            if (!a || !a.launch) { fail(new Error('Not available here')); return; }
            try { a.launch(app.id, function () { resolve(); }, fail); } catch (e) { fail(e); }
        });
    }

    // Sends an app control to an app: { operation, uri, data: [[key, value], …] }. Resolves
    // once the TV has handed it over; rejects with the TV's reason.
    var OP = {
        'default': 'http://tizen.org/appcontrol/operation/default'
    };
    function sendControl(appId, spec) {
        return new Promise(function (resolve, reject) {
            var a = api();
            if (!a || !a.launchAppControl || !window.tizen.ApplicationControl) { reject(new Error('Not available here')); return; }
            try {
                var data = (spec.data || []).map(function (d) { return new tizen.ApplicationControlData(d[0], ['' + d[1]]); });
                var ctl = new tizen.ApplicationControl(OP[spec.operation] || spec.operation, spec.uri || null, null, null, data);
                a.launchAppControl(ctl, appId, function () { resolve(); }, function (e) { reject(new Error(errText(e))); });
            } catch (e) { reject(new Error(errText(e))); }
        });
    }

    // Opens an app on a title: data the app gave the TV's Smart Hub for it (a where-to-watch
    // addon's tizenUrl "action_data"), handed over the way Smart Hub does (PAYLOAD: {"values": …}).
    // Apple TV opens on the title; Prime Video (tried every other way in 1.3.0's test on a
    // 2021 Q80A) opens on its home screen. One that refuses it is simply launched.
    function openTitle(app, actionData) {
        var a = api();
        if (!actionData || !a || !a.launchAppControl || !window.tizen.ApplicationControl) { return launch(app); }
        return sendControl(app.id, { operation: 'default', data: [['PAYLOAD', JSON.stringify({ values: '' + actionData })]] })
            .then(null, function (e) {
                U.log('apps', 'Opening ' + app.name + ' on the title failed (' + e.message + '): opening the app');
                return launch(app);
            });
    }

    // ---- streaming services ----
    // A service's name as a key, so the spellings of one service match: "Amazon Prime Video",
    // "Amazon Video", "Prime Video" -> 'amazon'; "Apple TV", "Apple TV+" -> 'apple'; "HBO Max",
    // "Max" -> 'hbo'. A service's channel inside another app ("Paramount+ Amazon Channel")
    // is that app. Unknown names: the name itself, simplified.
    var SERVICES = [
        [/ amazon channel$/, 'amazon'], [/ (apple tv|itunes) channel$/, 'apple'], [/ roku premium channel$/, 'roku'],
        [/^(amazon|prime video|primevideo)\b/, 'amazon'], [/^(apple tv|apple itunes|itunes)\b/, 'apple'],
        [/^(hbo|max$)/, 'hbo'], [/^netflix\b/, 'netflix'], [/^paramount\b/, 'paramount'], [/^disney\b/, 'disney'],
        [/^hulu\b/, 'hulu'], [/^peacock\b/, 'peacock'], [/^youtube tv\b/, 'youtubetv'], [/^youtube\b/, 'youtube'],
        [/^google play\b/, 'googleplay'], [/^starz\b/, 'starz'], [/^mgm\b/, 'mgm'], [/^amc\b/, 'amc'],
        [/^crunchyroll\b/, 'crunchyroll'], [/^tubi\b/, 'tubi'], [/^pluto\b/, 'pluto'], [/^plex\b/, 'plex'],
        [/^(the )?roku\b/, 'roku'], [/^(fandango|vudu)\b/, 'vudu'], [/^showtime\b/, 'showtime'], [/^britbox\b/, 'britbox'],
        [/^acorn\b/, 'acorn'], [/^shudder\b/, 'shudder'], [/^mubi\b/, 'mubi'], [/^fubo\b/, 'fubo'], [/^sling\b/, 'sling'],
        [/^philo\b/, 'philo'], [/^kanopy\b/, 'kanopy'], [/^hoopla\b/, 'hoopla'], [/^samsung tv plus\b/, 'samsungtvplus']
    ];
    function serviceKey(name) {
        var n = ('' + (name || '')).toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, ' ').trim();
        for (var i = 0; i < SERVICES.length; i++) { if (SERVICES[i][0].test(n)) { return SERVICES[i][1]; } }
        return n;
    }
    // The app to open for a service's link: { id, name } or null. An addon only names the
    // service (and maybe an app id): the app must be one of your streaming apps, or a
    // visible installed app for that same service (never a hidden / system app, nor an
    // unrelated one just because its id is installed). In order: your listed app the link
    // names (tizenId), a visible installed one it names that's for the service, your listed
    // app for the service, else the one visible installed app for it (several, like a TV's
    // three Netflix entries: none, since only one may open; listing it picks it). One not on
    // your list asks before it first opens (see isApproved).
    function appForService(name, tizenId) {
        if (!available()) { return null; }
        var mine = shortcuts(), inst = _last || [], i;
        var key = serviceKey(name);
        if (tizenId) {
            for (i = 0; i < mine.length; i++) { if (mine[i].id === tizenId) { return mine[i]; } }
            for (i = 0; i < inst.length; i++) {
                if (inst[i].id === tizenId && inst[i].show && key && serviceKey(inst[i].name) === key) { return { id: inst[i].id, name: inst[i].name }; }
            }
        }
        if (!key) { return null; }
        for (i = 0; i < mine.length; i++) { if (serviceKey(mine[i].name) === key) { return mine[i]; } }
        var hits = inst.filter(function (a) { return a.show && serviceKey(a.name) === key; });
        return hits.length === 1 ? { id: hits[0].id, name: hits[0].name } : null;
    }

    // Apps a source may open without asking: your streaming apps, and the ones you've said
    // yes to once ("Open <app> from sources?").
    var ALLOWED_KEY = 'stremiok.appsallowed';   // [app id]
    function allowedList() { var l = U.store.get(ALLOWED_KEY, []); return Array.isArray(l) ? l.filter(function (x) { return typeof x === 'string'; }) : []; }
    function isApproved(id) { return has(id) || allowedList().indexOf(id) !== -1; }
    function approve(id) {
        if (!id || isApproved(id)) { return; }
        var l = allowedList(); l.push('' + id);
        U.store.set(ALLOWED_KEY, l.slice(-MAX));
    }

    // ---- your streaming apps ----
    function valid(s) { return !!(s && typeof s.id === 'string' && s.id && typeof s.name === 'string'); }
    function shortcuts() {
        var list = U.store.get(KEY, []);
        return Array.isArray(list) ? list.filter(valid) : [];
    }
    function save(list) { U.store.set(KEY, list); }
    function indexOf(list, id) {
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return i; } }
        return -1;
    }
    function has(id) { return indexOf(shortcuts(), id) !== -1; }
    // Adds one at the end; false if it's already there or the list is full.
    function add(app) {
        var list = shortcuts();
        if (!app || !app.id || indexOf(list, app.id) !== -1 || list.length >= MAX) { return false; }
        list.push({ id: '' + app.id, name: '' + (app.name || app.id) });
        save(list);
        return true;
    }
    function remove(id) {
        var list = shortcuts(), i = indexOf(list, id);
        if (i === -1) { return false; }
        list.splice(i, 1);
        save(list);
        return true;
    }

    return {
        available: available, installed: installed, launch: launch, openTitle: openTitle,
        serviceKey: serviceKey, appForService: appForService, isApproved: isApproved, approve: approve,
        shortcuts: shortcuts, has: has, add: add, remove: remove, MAX: MAX
    };
})();
