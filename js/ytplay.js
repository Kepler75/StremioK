/* YouTube support (live IPTV channels, trailers, videos from addons). Global namespace: YTPlay
   The YouTube service (service/index.js) resolves a YouTube page to its HLS master on the
   TV and serves it at /yt?u=<page>; the Player then plays that like any HLS channel
   (autoplay, ● LIVE, quality menu, Back-to-grid). This module works out how StremioK was
   installed, which says where the service runs and who starts it:
     - 'wgt'       sideloaded .wgt: our own <tizen:service>, port 8099, started from here
     - 'tizenbrew' TizenBrew module: TizenBrew runs the service (package.json serviceFile)
                   when it launches StremioK, port 8098; we can only wait for it
     - 'browser'   a desktop browser (development): no service */
var YTPlay = (function () {
    'use strict';

    // TizenBrew serves an app module's pages from its own local server:
    // http://127.0.0.1:8081/module/<npm%2Fstremiok>/index.html
    function installMode() {
        var href = '' + ((window.location && window.location.href) || '');
        if (/^https?:\/\/(127\.0\.0\.1|localhost):8081\/module\//i.test(href)) { return 'tizenbrew'; }
        if (window.tizen && tizen.application) { return 'wgt'; }
        if (window.AndroidApp && typeof AndroidApp.isAndroidApp === 'function' && AndroidApp.isAndroidApp()) { return 'android'; }
        return 'browser';
    }
    var MODE = installMode();
    var PORT = MODE === 'tizenbrew' ? 8098 : 8099;   // (the service picks the same, see service/index.js)
    var PROXY = 'http://localhost:' + PORT;

    // The playable HLS URL for a YouTube page (served by the service).
    //   height : cap the master to a single video rung of this pixel height (0/omit = full ladder)
    //   fresh  : bypass the service's resolve cache so googlevideo's live URLs are current
    //            (needed when RE-opening mid-stream — the cached master's session goes stale)
    //   lang   : that audio language instead of the original (a YouTube dub: see audioLang)
    function resolverUrl(ytPage, height, fresh, lang) {
        var u = PROXY + '/yt?u=' + encodeURIComponent(ytPage);
        if (height) { u += '&h=' + height; }
        if (fresh) { u += '&fresh=1'; }
        if (lang) { u += '&lang=' + encodeURIComponent(lang); }
        return u;
    }
    // A video's audio languages and links (end screen, cards): { audio: [{ lang, name,
    // original }], links: [{ kind, id, title, teaser, startMs, endMs }] }.
    function infoUrl(ytPage) { return PROXY + '/ytinfo?u=' + encodeURIComponent(ytPage); }
    // Entering text from the phone (the service's one-time page on the home network, see
    // service/index.js): open it (-> { url, token }), ask what was sent (-> text, or null), close it.
    // The service answers these to StremioK alone: the sideloaded app sends the token the
    // service keeps in its private folder (as for the USB drives) when it can read it (the
    // 2017 TV); where it can't (TizenBrew has none; on Tizen 6 the service keeps it elsewhere),
    // an X-StremioK header instead (only then: a header could make an older engine send an
    // Origin, which the service refuses).
    var HEADER = { q: '', h: { 'X-StremioK': '1' } };
    function entryAuth() {
        if (MODE === 'tizenbrew') { return Promise.resolve(HEADER); }
        var t = (typeof LocalMedia !== 'undefined' && LocalMedia.serviceToken) ? LocalMedia.serviceToken() : Promise.resolve('');
        return t.then(function (tk) { return tk ? { q: '&token=' + encodeURIComponent(tk), h: null } : HEADER; }, function () { return HEADER; });
    }
    function entryOpen(what) {
        return entryAuth().then(function (a) { return U.getJSON(PROXY + '/entry/open?what=' + encodeURIComponent(what || 'link') + a.q, 8000, undefined, null, a.h); });
    }
    function entryPoll(token) {
        return entryAuth().then(function (a) { return U.getJSON(PROXY + '/entry/poll?t=' + encodeURIComponent(token) + a.q, 5000, undefined, null, a.h); })
            .then(function (r) { return (r && typeof r.text === 'string') ? r.text : null; });
    }
    function entryClose(token) {
        return entryAuth().then(function (a) { return U.getText(PROXY + '/entry/close?t=' + encodeURIComponent(token) + a.q, 4000, 4096, null, true, a.h); }).then(null, function () {});
    }
    // A live HLS channel whose sound the TV's player stutters on (its server cuts the AAC sound
    // mid-frame): the service looks at it and, if so, gives a relay that repacks the sound:
    // { fix, sure, why, url, cc: [{ ch, lang }] (its closed captions), ccSure }. force: the relay
    // at once (the channel's already known to need it). h: the channel's own User-Agent /
    // Referer ({ ua, ref }). opts (with force): { fix: false (the sound as it is), cc: the caption
    // channels to add as subtitle tracks }.
    function liveOpen(url, h, force, opts) {
        if (MODE === 'browser') { return Promise.reject(new Error('no service')); }
        var cc = opts && opts.cc ? opts.cc.map(function (c) { return c.ch + (c.lang ? '-' + c.lang : ''); }).join(',') : '';
        return ensureService().then(entryAuth).then(function (a) {
            var q = '/live/open?u=' + encodeURIComponent(url) + (h && h.ua ? '&ua=' + encodeURIComponent(h.ua) : '') + (h && h.ref ? '&ref=' + encodeURIComponent(h.ref) : '') + (force ? '&force=1' : '') +
                (force && opts && opts.fix === false ? '&fix=0' : '') + (force && cc ? '&cc=' + encodeURIComponent(cc) : '');
            return U.getJSON(PROXY + q + a.q, force ? 5000 : 30000, 65536, null, a.h);
        });
    }
    // An HLS stream's quality list, read by the service with the stream's own User-Agent /
    // Referer (h: { ua, ref }), which a web page can't send: its text.
    function hlsMaster(url, h) {
        if (MODE === 'browser') { return Promise.reject(new Error('no service')); }
        return ensureService().then(entryAuth).then(function (a) {
            var q = '/live/master?u=' + encodeURIComponent(url) + (h && h.ua ? '&ua=' + encodeURIComponent(h.ua) : '') + (h && h.ref ? '&ref=' + encodeURIComponent(h.ref) : '');
            return U.getText(PROXY + q + a.q, 12000, 524288, null, false, a.h);
        });
    }
    // An AIOManager account's addons (its Hydra API, through the service: an instance only
    // answers the web origins it's set to): { addons: [{ url, name, enabled }] }. base: its
    // address; key: the account's API key (a header, never in the link).
    function aiomAddons(base, key) {
        if (MODE === 'browser') { return Promise.reject(new Error('no service')); }
        return ensureService().then(entryAuth).then(function (a) {
            var h = { 'X-AIOM-Key': key };
            if (a.h) { Object.keys(a.h).forEach(function (k) { h[k] = a.h[k]; }); }
            return U.getJSON(PROXY + '/aiom/addons?base=' + encodeURIComponent(base) + a.q, 40000, 1048576, null, h);
        });
    }
    // A playlist's TV guide, read and kept by the service (see service/index.js, epgControl):
    // epgLoad asks it to read it for these channels (k: their keys as a bitset, EPG.bitsFor) ->
    // { state, at, channels, programmes, partial, error }; epgGet: their programs -> { <key>:
    // [[start, stop, title, desc]] }. Both POSTs, what's asked in the body: a newer TV's service
    // reads 8 KB of a request's address and headers, less than thousands of channels' keys.
    // (a POST refused, a service from before it took them or one without the token: asked
    // again as a GET, when it fits in the address)
    // An app that can't read the service's token (its header instead): the guide ticket, asked
    // for once, given with the POSTs (the TV adds an Origin to them, which the header alone doesn't pass).
    var _ticket = null;
    function epgTicket(a) {
        if (a.q || MODE === 'tizenbrew') { return Promise.resolve(a.q); }   // (the token; TizenBrew's origin passes as it is)
        if (!_ticket) {
            _ticket = U.getJSON(PROXY + '/epg/ticket', 8000, 4096, null, a.h).then(function (r) {
                return r && /^[0-9a-f]{48}$/.test(r.ticket || '') ? '&ticket=' + r.ticket : '';
            }, function () { _ticket = null; return ''; });
        }
        return _ticket;
    }
    function epgAsk(path, body, maxBytes) {
        if (MODE === 'browser') { return Promise.reject(new Error('no service')); }
        return ensureService().then(entryAuth).then(function (a) {
            return epgTicket(a).then(function (cred) { return { a: a, cred: cred }; });
        }).then(function (x) {
            var a = x.a, q = x.cred ? '?' + x.cred.replace(/^&/, '') : '';
            return U.postJSON(PROXY + path + q, body, 15000, maxBytes, a.h).then(null, function (err) {
                if (err && /^HTTP 403\b/.test(err.message || '') && /ticket=/.test(q)) { _ticket = null; }   // (the service started again since: a new ticket next time)
                if (!(err && /^HTTP (403|405)\b/.test(err.message || '') && body.length < 6000)) { throw err; }
                return U.getJSON(PROXY + path + (q ? q + '&' : '?') + body, 15000, maxBytes, null, a.h);
            });
        });
    }
    // Settings › Storage: the saved guides ({ count, bytes }), and deleting them all.
    function epgFiles() {
        if (MODE === 'browser') { return Promise.resolve(null); }
        return ensureService().then(entryAuth).then(function (a) { return U.getJSON(PROXY + '/epg/files' + (a.q ? '?' + a.q.replace(/^&/, '') : ''), 8000, 4096, null, a.h); });
    }
    function epgClear() { return epgAsk('/epg/clear', '', 4096); }
    function epgLoad(u, k, force) {
        return epgAsk('/epg/load', 'u=' + encodeURIComponent(u) + '&k=' + k + (force ? '&force=1' : ''), 65536);
    }
    function epgGet(u, keys, from, to, max) {
        return epgAsk('/epg/get', 'u=' + encodeURIComponent(u) + '&ids=' + encodeURIComponent(keys.join('|')) + '&from=' + from + '&to=' + to + (max ? '&max=' + max : ''), 4194304);
    }
    // Whether YouTube gives the video out to the service (it refuses some uploads to the player
    // the service asks as): false when it says no; true when it does, or no answer came (the
    // player tries). The service keeps what it found, so playing it next asks YouTube nothing new.
    function canPlay(ytPage) {
        return U.getText(infoUrl(ytPage), 30000, 2097152, null, true).then(function () { return true; },
            function (e) { return !/^HTTP [45]\d\d/.test((e && e.message) || ''); });
    }
    // A caption track of the video, as WebVTT (auto: YouTube's automatic one).
    function subsUrl(ytPage, lang, auto) { return PROXY + '/ytsubs?u=' + encodeURIComponent(ytPage) + '&lang=' + encodeURIComponent(lang) + (auto ? '&auto=1' : ''); }

    // The audio language you picked for a video (Player › Audio language), remembered per
    // video ('' = the original, the default). Kept for the last 300 videos.
    var LANG_KEY = 'stremiok.ytlang', LANG_MAX = 300;
    function videoKey(ytPage) { var m = ('' + ytPage).match(/[?&]v=([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; }
    function audioLang(ytPage) {
        var all = U.store.get(LANG_KEY, {}) || {}, k = videoKey(ytPage);
        return (k && all[k] && typeof all[k].l === 'string') ? all[k].l : '';
    }
    function setAudioLang(ytPage, lang) {
        var k = videoKey(ytPage);
        if (!k) { return; }
        var all = U.store.get(LANG_KEY, {}) || {};
        if (lang) { all[k] = { l: '' + lang, at: Date.now() }; } else { delete all[k]; }
        var keys = Object.keys(all);
        if (keys.length > LANG_MAX) {
            keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
            keys.slice(0, keys.length - LANG_MAX).forEach(function (x) { delete all[x]; });
        }
        U.store.set(LANG_KEY, all);
    }

    // Resolve once the service answers /health. Sideloaded, launch our <tizen:service> if it
    // isn't up yet. Under TizenBrew it's TizenBrew's to start (it does on launching StremioK,
    // after downloading the file), so just wait a little longer.
    function ensureService() {
        return new Promise(function (resolve, reject) {
            if (MODE === 'android' || MODE === 'browser') {
                reject(new Error('service-down'));
                return;
            }
            function poll(left) {
                U.getText(PROXY + '/health', 2500, 4096, null, true).then(function () { resolve(); }, function () {
                    if (left <= 0) {
                        U.log('youtube', 'StremioK\'s YouTube service didn\'t answer (' + (MODE === 'tizenbrew' ? 'TizenBrew didn\'t start it' : 'started, then checked for a while') + ')');
                        reject(new Error('service-down'));
                        return;
                    }
                    setTimeout(function () { poll(left - 1); }, 500);
                });
            }
            // (its checks while it starts are expected to fail: quiet, see U.getText)
            U.getText(PROXY + '/health', 1500, 4096, null, true).then(function () { resolve(); }, function () {
                if (MODE === 'tizenbrew') { poll(20); return; }
                if (MODE !== 'wgt') { reject(new Error('service-down')); return; }
                var launched = false;
                try {
                    if (tizen.application.launchAppControl) {
                        var pkgId = tizen.application.getCurrentApplication().appInfo.packageId;
                        tizen.application.launchAppControl(
                            new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
                            pkgId + '.StremioKProxy',
                            function () {}, function () {}
                        );
                        launched = true;
                    }
                } catch (e) { /* fall through to polling */ }
                poll(launched ? 40 : 10);
            });
        });
    }

    // What to tell you when the service doesn't answer. what: 'channel' | 'trailer'
    function unavailableMessage(what) {
        var thing = what === 'trailer' ? 'Trailers play' : what === 'video' ? 'YouTube videos play' : 'YouTube channels play';
        if (MODE === 'tizenbrew') {
            return thing + ' through StremioK’s YouTube service, which TizenBrew hasn’t started. ' +
                'Close StremioK and open it again from TizenBrew; if that doesn’t help, update TizenBrew.';
        }
        if (MODE === 'wgt') {
            return thing + ' through StremioK’s YouTube service, which didn’t start. Try again, or restart StremioK.';
        }
        if (MODE === 'android') {
            return thing + ' through the optional StremioK service, which is not included in this Android build.';
        }
        return thing + ' through StremioK’s YouTube service, which runs on the TV (not in a browser).';
    }

    // One look at the service, without starting it: resolves true / false.
    function isRunning() {
        return U.getText(PROXY + '/health', 1500, 4096, null, true).then(function () { return true; }, function () { return false; });
    }

    // For Settings: how StremioK was installed.
    function installLabel() {
        return MODE === 'tizenbrew' ? 'TizenBrew module' : MODE === 'wgt' ? 'Sideloaded app (.wgt)' : MODE === 'android' ? 'Android app' : 'Browser (development)';
    }

    return { ensureService: ensureService, resolverUrl: resolverUrl, infoUrl: infoUrl, canPlay: canPlay, liveOpen: liveOpen, hlsMaster: hlsMaster, aiomAddons: aiomAddons, epgLoad: epgLoad, epgGet: epgGet, epgFiles: epgFiles, epgClear: epgClear, entryOpen: entryOpen, entryPoll: entryPoll, entryClose: entryClose, subsUrl: subsUrl, audioLang: audioLang, setAudioLang: setAudioLang, installMode: function () { return MODE; },
        installLabel: installLabel, unavailableMessage: unavailableMessage, isRunning: isRunning, port: PORT };
})();
