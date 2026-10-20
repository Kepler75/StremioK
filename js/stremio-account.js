/* Your addons from your Stremio account (Settings › Content › Addons › Import addons from your
   Stremio account), the way Stremio's own TV apps sign in: link.stremio.com gives a short code
   and a link (a QR code here); you sign in to Stremio on your phone and approve; asked every few
   seconds, it then gives a sign-in key (start, wait). With it the account's addons are read
   (addons) and the key is given up at once (signOut): no password on the TV, nothing of the
   account kept, the account itself unchanged. StremioK has no key of Stremio's: none is needed.
   Global namespace: StremioAccount */
var StremioAccount = (function () {
    'use strict';
    var LINK = 'https://link.stremio.com/api/v2/', API = 'https://api.strem.io/api/';
    var POLL_MS = 3000, WAIT_MS = 5 * 60 * 1000, MAX_BYTES = 1048576;

    // A code to approve: { code, link }.
    function start() {
        return U.getJSON(LINK + 'create?type=Create', 15000, 65536).then(function (r) {
            var x = (r && r.result) || r || {};
            if (!/^[A-Za-z0-9]{2,16}$/.test(x.code || '') || !U.parseUrl(x.link)) { throw new Error('Stremio didn’t give a code'); }
            return { code: x.code, link: x.link };
        });
    }
    // The sign-in key once the code is approved on the phone; asked every POLL_MS until WAIT_MS
    // (an answer without one: not yet). stopped(): true once the screen asking has gone.
    function wait(code, stopped) {
        var until = Date.now() + WAIT_MS;
        return new Promise(function (resolve, reject) {
            function ask() {
                if (stopped && stopped()) { reject(new Error('stopped')); return; }
                if (Date.now() > until) { reject(new Error('The code expired: try again')); return; }
                U.getJSON(LINK + 'read?type=Read&code=' + encodeURIComponent(code), 15000, 65536).then(function (r) {
                    var key = r && r.result && r.result.authKey;
                    if (typeof key === 'string' && key && key.length < 200) { if (stopped && stopped()) { signOut(key); reject(new Error('stopped')); return; } resolve(key); return; }
                    setTimeout(ask, POLL_MS);
                }, function () { setTimeout(ask, POLL_MS); });   // (a dropped answer: asked again)
            }
            setTimeout(ask, POLL_MS);
        });
    }
    // POST a request to Stremio's API: its result.
    function call(method, body) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest(), done = false;
            try { xhr.open('POST', API + method, true); } catch (e) { reject(new Error('couldn’t reach Stremio')); return; }
            xhr.timeout = 20000;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onprogress = function (ev) {   // (an answer over MAX_BYTES: stopped as it arrives, as every other request is)
                if (!done && ev && ev.loaded > MAX_BYTES) { done = true; try { xhr.abort(); } catch (e) {} reject(new Error('too large an answer')); }
            };
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || done) { return; }
                done = true;
                var text = '' + (xhr.responseText || ''), data = null;
                if (text.length > MAX_BYTES) { reject(new Error('too large an answer')); return; }
                try { data = JSON.parse(text); } catch (e2) { data = null; }
                if (xhr.status >= 200 && xhr.status < 300 && data && data.result) { resolve(data.result); return; }
                reject(new Error((data && data.error && data.error.message) || ('HTTP ' + xhr.status)));
            };
            xhr.ontimeout = function () { if (!done) { done = true; reject(new Error('Stremio didn’t answer')); } };
            xhr.onerror = function () { if (!done) { done = true; reject(new Error('couldn’t reach Stremio')); } };
            try { xhr.send(JSON.stringify(body)); } catch (e3) { reject(new Error('couldn’t reach Stremio')); }
        });
    }
    // The account's addons StremioK can use: [{ url, name, description }] (a link on the
    // computer Stremio runs on, or that isn't a web address, left out).
    function addons(key) {
        return call('addonCollectionGet', { type: 'AddonCollectionGet', authKey: key, update: true }).then(function (r) {
            var seen = {};
            return (Array.isArray(r.addons) ? r.addons : []).map(function (a) {
                var url = a && typeof a.transportUrl === 'string' ? a.transportUrl.trim() : '', p = U.parseUrl(url), m = (a && a.manifest) || {};
                if (!p || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i.test(p.host || '') || seen[url]) { return null; }
                seen[url] = 1;
                return { url: url, name: U.drawable('' + (m.name || p.host)).slice(0, 60), description: U.drawable('' + (m.description || '')).slice(0, 140) };
            }).filter(Boolean);
        });
    }
    // The key given up (Stremio's own sign-out): whatever happens, nothing is kept here.
    function signOut(key) { return call('logout', { type: 'Logout', authKey: key }).then(function () {}, function () {}); }

    return { start: start, wait: wait, addons: addons, signOut: signOut };
})();
