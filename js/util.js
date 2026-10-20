/* Utilities: DOM, HTTP, storage, formatting. Global namespace: U */
var U = (function () {
    'use strict';

    function byId(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined && text !== null) { node.textContent = text; }
        return node;
    }

    function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

    /* A URL with its secrets masked (•••), for anything shown on screen or put in an error
       message: a user:password@ part; query values named like credentials (password,
       username, token, key, apikey, api_key, auth, secret, sig…); an Xtream-style
       /live|movie|series/USER/PASS/ path; and path segments that look like tokens (the
       long base64 / UUID / hex configs in addon URLs such as AIOStreams or MediaFusion). Names
       are read %-decoded (%70assword is password), and a #fragment is masked the same way
       (name=value pairs, or one token). Scheme, host, port and the rest of the path stay
       readable. */
    var SECRET_PARAM = /^(pass(word)?|pwd|passwd|user(name)?|login|token|access_token|refresh_token|auth(orization)?|key|apikey|api_key|api-key|secret|client_secret|sig|signature|session|sid|hash)$/i;
    function looksLikeToken(seg) {
        if (seg.length < 20 || !/^[A-Za-z0-9._~+=%-]+$/.test(seg)) { return false; }
        if (/%3A%2F%2F/i.test(seg)) { return false; }   // an encoded URL (a YouTube page for the service), not a token
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) { return true; }   // UUID
        return /[0-9]/.test(seg) && /[A-Za-z]/.test(seg);   // mixed letters and digits: not a word
    }
    function secretName(k) {
        var d = k;
        try { d = decodeURIComponent(('' + k).replace(/\+/g, ' ')); } catch (e) {}
        return SECRET_PARAM.test(d.trim());
    }
    function maskParams(str) {
        return str.split('&').map(function (kv) {
            var eq = kv.indexOf('='), k = eq === -1 ? kv : kv.slice(0, eq);
            if (eq !== -1 && secretName(k)) { return k + '=•••'; }
            return (eq !== -1 && looksLikeToken(kv.slice(eq + 1))) ? k + '=•••' : kv;
        }).join('&');
    }
    function redactUrl(url) {
        var u = '' + (url || ''), m = u.match(/^([a-z][a-z0-9+.-]*:\/\/)([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i);
        if (!m) { return u; }
        var auth = m[2].lastIndexOf('@');
        var host = auth === -1 ? m[2] : '•••@' + m[2].slice(auth + 1);
        var segs = m[3].split('/');
        var xt = -1;   // Xtream: /live/USER/PASS/123.ts (also movie / series)
        for (var i = 0; i < segs.length; i++) { if (/^(live|movie|series)$/i.test(segs[i]) && i + 3 < segs.length) { xt = i; break; } }
        segs = segs.map(function (seg, j) {
            if (xt !== -1 && (j === xt + 1 || j === xt + 2)) { return '•••'; }
            return looksLikeToken(seg) ? '•••' : seg;
        });
        var query = m[4] ? '?' + maskParams(m[4].slice(1)) : '';
        var frag = m[5] ? m[5].slice(1) : null;
        if (frag !== null) { frag = '#' + (frag.indexOf('=') !== -1 ? maskParams(frag) : looksLikeToken(frag) ? '•••' : frag); }
        return m[1] + host + segs.join('/') + query + (frag || '');
    }

    /* Diagnostics: the last LOG_MAX problems (failed downloads, player errors, script errors
       that used to be swallowed, storage failures), for Settings > Diagnostics, with every URL
       in a message masked (redactUrl): no keys, tokens or passwords in it. source: a short
       area name ("network", "player", "storage"…). The last LASTLOG_MAX are also kept on the
       TV, so a launch after StremioK closed unexpectedly can show what came before (see
       sessionStart). */
    var LOG_MAX = 200, _log = [];
    function redactText(t) {
        return ('' + (t === undefined ? '' : t)).replace(/\b(?:https?|stremio):\/\/[^\s"'<>)]+/gi, function (u) { return redactUrl(u); });
    }
    function log(source, message) {
        try {
            var msg = redactText(message && message.message ? message.message : message).slice(0, 400);
            var last = _log[_log.length - 1];
            if (last && last.src === source && last.msg === msg) { last.n = (last.n || 1) + 1; last.t = Date.now(); return; }   // (repeats counted, not listed)
            _log.push({ t: Date.now(), src: '' + source, msg: msg });
            if (_log.length > LOG_MAX) { _log.shift(); }
            keepLogSoon();
        } catch (e) {}
    }

    // ---- what StremioK was doing, kept across a close ----
    // A launch finds out whether the last one ended without exiting (a crash, the TV closing
    // it, or the TV turned off): the session record says it was still running. It's
    // updated every 30 s and on each step taken (a screen, a playback: crumb), with the
    // memory in use where the TV reports it.
    var SESSION_KEY = 'stremiok.session', LASTLOG_KEY = 'stremiok.lastlog', LASTLOG_MAX = 40;
    var _session = null, _logT = null;
    function lsGet(k) { try { return JSON.parse(window.localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function heapMb() {
        try { var m = window.performance && window.performance.memory; return m && m.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1048576) : null; } catch (e) { return null; }
    }
    function keepLogSoon() {
        if (!_session || _logT) { return; }
        _logT = setTimeout(function () { _logT = null; lsSet(LASTLOG_KEY, _log.slice(-LASTLOG_MAX).filter(function (e) { return e.src.indexOf('before · ') !== 0; })); }, 1500);
    }
    function saveSession() { if (_session) { _session.alive = Date.now(); _session.heap = heapMb(); lsSet(SESSION_KEY, _session); } }
    function crumb(what) {
        if (!_session) { return; }
        _session.crumbs.push({ t: Date.now(), w: ('' + what).slice(0, 100) });
        if (_session.crumbs.length > 12) { _session.crumbs.shift(); }
        saveSession();
    }
    function hhmm(ms) { var d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
    // When this install was made (the TV's own record): a new one since the last launch means
    // it was installed again (an update closes the running app), not that it closed by itself.
    function installedAt() {
        try { var d = window.tizen && tizen.application.getAppInfo(null).installDate; return d ? +d : 0; } catch (e) { return 0; }
    }
    function sessionStart() {
        if (_session) { return; }
        var prev = lsGet(SESSION_KEY), prevLog = lsGet(LASTLOG_KEY) || [];
        _session = { start: Date.now(), state: 'running', crumbs: [], installed: installedAt() };
        lsSet(LASTLOG_KEY, []);
        if (prev && prev.installed && _session.installed && prev.installed !== _session.installed) {
            log('closed', 'StremioK was installed again (updated) since it last ran' + (prev.alive ? ': it was closed for that around ' + hhmm(Math.min(prev.alive, _session.installed)) : ''));
        } else if (prev && prev.start && (prev.state === 'running' || prev.state === 'hidden') && Array.isArray(prev.crumbs)) {
            (Array.isArray(prevLog) ? prevLog : []).slice(-15).forEach(function (e) {
                if (e && e.t && e.src) { _log.push({ t: e.t, src: 'before · ' + e.src, msg: '' + e.msg, n: e.n }); }
            });
            var mins = Math.max(0, Math.round(((prev.alive || prev.start) - prev.start) / 60000));
            log('closed', (prev.state === 'hidden' ? 'Last time, StremioK was closed while in the background (by the TV: memory?)'
                : 'Last time, StremioK closed without being exited (a crash, or the TV turned off)') +
                ' around ' + hhmm(prev.alive || prev.start) + ', after ' + mins + ' min' + (prev.heap ? ', using ' + prev.heap + ' MB' : '') +
                (prev.crumbs.length ? '. Last steps: ' + prev.crumbs.slice(-5).map(function (c) { return hhmm(c.t) + ' ' + c.w; }).join(' → ') : ''));
        }
        saveSession();
        var iv = setInterval(saveSession, 30000);
        if (iv && iv.unref) { iv.unref(); }   // (tests run in Node: not what keeps one running)
    }
    // 'exit' (exited: nothing to report next time), 'hidden' (in the background), 'running'
    function sessionState(st) { if (_session && _session.state !== st) { _session.state = st; saveSession(); } }
    function logEntries() { return _log.slice().reverse(); }   // newest first
    function clearLog() { _log = []; }

    /* Size limits for anything downloaded: an answer bigger than expected (a video file,
       a broken or hostile server) is stopped as it arrives rather than filling the TV's
       memory. Callers pass a bigger or smaller limit where they expect one (a title's
       details for a long series, an IPTV playlist, a quality list, a health check). */
    var TEXT_MAX = 5 * 1024 * 1024;   // subtitles, anything text without its own limit
    var JSON_MAX = 2 * 1024 * 1024;   // addon manifests, catalogs, streams, API answers
    function mb(n) { return n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.round(n / 1024) + ' KB'; }

    /* One URL parser for what you type or import, and what addons send (addons, playlists,
       configuration files, subtitles, artwork). Only http(s); no user:password@ in the
       address (credentials there would show in lists and logs); a real host name and port.
       stremio:// install links become https://, and a bare "example.com/…" gets https://.
       Returns { href, scheme, host, port, path, query, hash } or null (urlProblem says why). */
    function parseUrl(input) { return parseUrlWhy(input).url; }
    function urlProblem(input) { return parseUrlWhy(input).why; }
    function parseUrlWhy(input) {
        var u = ('' + (input || '')).trim();
        if (!u || u === 'https://' || u === 'http://') { return { why: 'Enter a URL' }; }
        if (/\s/.test(u)) { return { why: 'A URL can’t contain spaces' }; }
        if (/^stremio:\/\//i.test(u)) { u = 'https://' + u.slice(10); }
        else if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) { u = 'https://' + u.replace(/^\/\//, ''); }
        var m = u.match(/^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i);
        if (!m) { return { why: 'That isn’t a URL' }; }
        var scheme = m[1].toLowerCase();
        if (scheme !== 'http' && scheme !== 'https') { return { why: 'Only http:// and https:// URLs are supported' }; }
        if (m[2].indexOf('@') !== -1) { return { why: 'Remove the user:password@ part (put credentials where your provider says, e.g. ?username=…&password=…)' }; }
        var hp = m[2].match(/^(\[[0-9a-f:.]+\]|[^\[\]:]+)(?::(\d{1,5}))?$/i);
        if (!hp) { return { why: 'That address has no valid host' }; }
        var host = canonicalHost(hp[1]);
        if (host === null) { return { why: 'That address has no valid host' }; }
        if (host.charAt(0) === '[') {
            if (!v6Words(host.slice(1, -1))) { return { why: 'That address has no valid host' }; }
        } else {
            if (/[^.]\.$/.test(host)) { host = host.slice(0, -1); }   // "localhost." is localhost
            if (!/^[a-z0-9\u00a1-\uffff._-]+$/.test(host) || /^[.-]|[.-]$|\.\./.test(host)) { return { why: 'That address has no valid host' }; }
            // an IP address only in its usual form: 127.1, 2130706433, 0x7f.0.0.1, 0177.0.0.1
            // all mean 127.0.0.1 to the browser, and would slip past the checks below
            if (numericHost(host) && !quad(host)) { return { why: 'Write the IP address the usual way (four numbers 0–255, like 203.0.113.5)' }; }
        }
        var port = hp[2] ? parseInt(hp[2], 10) : null;
        if (port !== null && (port < 1 || port > 65535)) { return { why: 'That port isn’t valid' }; }
        var path = m[3] || '';
        return { url: { href: scheme + '://' + host + (hp[2] ? ':' + hp[2] : '') + path + (m[4] || '') + (m[5] || ''),
            scheme: scheme, host: host, port: port, path: path || '/', query: m[4] ? m[4].slice(1) : '', hash: m[5] || '' } };
    }
    // A host name as a browser reads it (WHATWG URL / IDNA): %-escapes decoded, compatibility
    // forms folded (fullwidth digits and letters), the ideographic and fullwidth full stops
    // (。．｡) as dots, invisible characters dropped, lower case. So 127。0。0。1 is 127.0.0.1
    // to the checks below as it is to the browser. Where the engine can't fold (no
    // String#normalize), the fullwidth forms are folded by hand. null: not a host.
    function canonicalHost(h) {
        var c = '' + h;
        if (c.indexOf('%') !== -1) { try { c = decodeURIComponent(c); } catch (e) { return null; } }
        if (c.normalize) { try { c = c.normalize('NFKC'); } catch (e2) {} }
        c = c.replace(/[\uff01-\uff5e]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); })
            .replace(/[\u3002\uff61]/g, '.').replace(/[\u00ad\u034f\u180b-\u180d\u200b-\u200d\u2060\ufe00-\ufe0f\ufeff]/g, '');
        return c.toLowerCase();
    }
    // An IPTV playlist: a path ending in .m3u / .m3u8 (a query after it is fine), or an
    // Xtream-style link (get.php?username=…&password=…&type=m3u_plus).
    function isPlaylistUrl(p) {
        if (!p) { return false; }
        return /\.m3u8?$/i.test(p.path) || /(^|&)type=m3u(_plus|8)?(&|$)/i.test(p.query) || (/\/get\.php$/i.test(p.path) && /(^|&)username=/i.test(p.query));
    }
    function isManifestUrl(p) { return !!p && /\/manifest\.json$/i.test(p.path); }
    // IP address forms. quad: "a.b.c.d", four plain decimal numbers 0-255 -> [a, b, c, d],
    // else null. numericHost: the browser would read it as an IPv4 address (its last label
    // is a number: decimal, 0x… hex or 0… octal). v6Words: an IPv6 address (no brackets)
    // -> its eight 16-bit words, else null.
    function quad(h) {
        var p = ('' + h).split('.');
        if (p.length !== 4) { return null; }
        for (var i = 0; i < 4; i++) {
            if (!/^(0|[1-9]\d{0,2})$/.test(p[i]) || +p[i] > 255) { return null; }
            p[i] = +p[i];
        }
        return p;
    }
    function numericHost(h) {
        var labels = ('' + h).split('.');
        return /^(0x[0-9a-f]*|\d+)$/i.test(labels[labels.length - 1]);
    }
    function v6Words(h) {
        h = ('' + h).toLowerCase();
        if (!/^[0-9a-f:.]+$/.test(h)) { return null; }
        var m = h.match(/^(.*:)([^:]*\.[^:]*)$/);   // ending in an IPv4 address (::ffff:1.2.3.4)
        if (m) {
            var q = quad(m[2]);
            if (!q) { return null; }
            h = m[1] + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16);
        }
        var halves = h.split('::');
        if (halves.length > 2) { return null; }
        function words(x) {
            if (x === '') { return []; }
            var g = x.split(':'), out = [];
            for (var i = 0; i < g.length; i++) {
                if (!/^[0-9a-f]{1,4}$/.test(g[i])) { return null; }
                out.push(parseInt(g[i], 16));
            }
            return out;
        }
        var head = words(halves[0]), tail = halves.length === 2 ? words(halves[1]) : [];
        if (!head || !tail) { return null; }
        if (halves.length === 1) { return head.length === 8 ? head : null; }
        var fill = 8 - head.length - tail.length;
        if (fill < 1) { return null; }
        while (fill--) { head.push(0); }
        return head.concat(tail);
    }
    // Not on the public internet: "this network" 0/8, private 10/8, 172.16/12, 192.168/16,
    // carrier-grade NAT 100.64/10, loopback 127/8, link-local (and cloud metadata) 169.254/16,
    // IETF 192.0.0/24, documentation 192.0.2/24, 198.51.100/24, 203.0.113/24, benchmarking
    // 198.18/15, multicast 224/4, reserved 240/4 and broadcast.
    function v4Private(a, b, c) {
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
            (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||
            a >= 224;
    }
    function v6Private(w) {
        function v4At(i) { return v4Private(w[i] >> 8, w[i] & 255, w[i + 1] >> 8); }
        var zero4 = !w[0] && !w[1] && !w[2] && !w[3];
        if (zero4 && !w[4] && !w[5]) { return true; }                     // ::, ::1, ::a.b.c.d (deprecated)
        if (zero4 && !w[4] && w[5] === 0xffff) { return v4At(6); }         // ::ffff:a.b.c.d (IPv4-mapped)
        if (zero4 && w[4] === 0xffff && !w[5]) { return v4At(6); }         // ::ffff:0:a.b.c.d (IPv4-translated)
        if (w[0] === 0x64 && w[1] === 0xff9b) { return w[2] === 1 || v4At(6); }   // NAT64 (64:ff9b:1::/48 is local)
        if (w[0] === 0x2002) { return v4At(1); }                           // 6to4
        if (w[0] === 0x100 && !w[1] && !w[2] && !w[3]) { return true; }   // discard 100::/64
        if ((w[0] === 0x2001 && w[1] === 0xdb8) || (w[0] === 0x3fff && w[1] < 0x1000)) { return true; }   // documentation
        return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00;
        // (unique-local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8)
    }
    // A host on this TV or the home network: localhost, *.local / *.lan / *.home.arpa /
    // *.internal, and every non-public IPv4 / IPv6 address above. An IP address written in an
    // unusual form (see numericHost), or an IPv6 address that doesn't parse, counts as one
    // (never let through unchecked). By name only: a public name that resolves to a home
    // address (DNS), and where a link redirects to, can't be told here (see getText).
    function isPrivateHost(host) {
        var h = (canonicalHost(host || '') || '').replace(/^\[|\]$/g, '').replace(/([^.])\.$/, '$1');
        if (!h) { return false; }
        if (h === 'localhost' || /\.(localhost|local|lan|home\.arpa|internal|localdomain)$/.test(h)) { return true; }
        if (h.indexOf(':') !== -1) { var w = v6Words(h); return !w || v6Private(w); }
        if (numericHost(h)) { var q = quad(h); return !q || v4Private(q[0], q[1], q[2]); }
        return false;
    }
    // A link into the home network (see isPrivateHost). One that doesn't parse but would
    // still be fetched (http(s):// or //…, e.g. an IP address in an unusual form) counts too.
    function urlIsPrivate(u) {
        var p = parseUrl(u);
        if (!p) { return /^\s*(https?:)?\/\//i.test('' + (u || '')); }
        return isPrivateHost(p.host);
    }
    // Whether links into the home network may be followed from internet addresses (Stremio
    // sets it: Settings › Content › Addons). getText refuses a public link that redirects
    // into the home network unless it says yes.
    var _localOk = function () { return false; };
    function setLocalPolicy(fn) { _localOk = fn; }

    /* Text as the TV can draw it: characters its font doesn't have (emoji newer than the
       TV, e.g. the ones addons like AIOStreams put in source names) show as a box, so
       they're left out, or swapped for a stand-in it has (STAND_INS). Each character is tried once: drawn on a small canvas and compared
       with the font's "missing" box (a character no font has); the answer is kept. Where
       the canvas can't say (no canvas, or the box can't be told apart), text is unchanged.
       What was left out is noted once in Diagnostics, by its code (U+…). */
    var _drawable = {}, _tofu, _glyphCtx;
    // unassigned or private-use: U+10FFFD, U+F0001, U+E0FF, U+0378, U+1FFFD
    var TOFU_PROBES = ['\udbff\udffd', '\udb80\udc01', '\ue0ff', '\u0378', '\ud83f\udffd'];
    // Stand-ins the TV's font has, for ones it may not: MediaFusion's 🧲 (U+1F9F2, 2018:
    // a torrent through your debrid service) -> 🔌 (U+1F50C, 2010).
    var STAND_INS = { '\ud83e\uddf2': '\ud83d\udd0c' };
    function glyphPixels(ch) {
        if (_glyphCtx === undefined) {
            _glyphCtx = null;
            try {
                var cv = document.createElement('canvas');
                if (cv && cv.getContext) {
                    cv.width = 32; cv.height = 32;
                    var g = cv.getContext('2d');
                    if (g && g.getImageData) {
                        var fam = '';
                        try { fam = window.getComputedStyle(document.body).fontFamily; } catch (e0) {}
                        g.font = '24px ' + (fam || 'sans-serif');
                        g.textBaseline = 'top';
                        _glyphCtx = g;
                    }
                }
            } catch (e) { _glyphCtx = null; }
        }
        if (!_glyphCtx) { return null; }
        try {
            _glyphCtx.clearRect(0, 0, 32, 32);
            _glyphCtx.fillStyle = '#000';
            _glyphCtx.fillText(ch, 2, 2);
            var d = _glyphCtx.getImageData(0, 0, 32, 32).data, out = [], ink = 0;
            for (var i = 3; i < d.length; i += 4) { out.push(d[i]); ink += d[i]; }
            return { key: out.join(','), ink: ink };
        } catch (e2) { return null; }
    }
    function canDraw(ch) {
        if (Object.prototype.hasOwnProperty.call(_drawable, ch)) { return _drawable[ch]; }
        if (_tofu === undefined) {   // the box: what two of these (no font has them) look like alike
            _tofu = null;
            var seen = {};
            TOFU_PROBES.forEach(function (x) {
                var q = glyphPixels(x);
                if (!q || !q.ink || _tofu) { return; }
                if (seen[q.key]) { _tofu = q.key; } else { seen[q.key] = 1; }
            });
        }
        var ok = true;
        if (_tofu) { var p = glyphPixels(ch); ok = !(p && p.key === _tofu); }
        _drawable[ch] = ok;
        if (!ok) { log('display', 'A character this TV’s font can’t draw was left out of (or replaced in) what an addon sent: U+' + (ch.length === 2 ? (ch.charCodeAt(0) - 0xd800) * 0x400 + ch.charCodeAt(1) - 0xdc00 + 0x10000 : ch.charCodeAt(0)).toString(16).toUpperCase()); }
        return ok;
    }
    // Only characters past the Latin letters are tried (a pair of surrogates is one).
    function drawable(text) {
        var t = '' + (text == null ? '' : text);
        if (!/[\u0250-\uffff]/.test(t)) { return t; }
        var cut = false;
        var out = t.replace(/[\ud800-\udbff][\udc00-\udfff]|[\u0250-\ud7ff\ue000-\uffff]/g, function (ch) {
            if (/^[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufe00-\ufe0f\ufeff]$/.test(ch)) { return ch; }   // (invisible joiners and selectors: nothing to draw)
            if (canDraw(ch)) { return ch; }
            var alt = STAND_INS[ch];
            if (alt && canDraw(alt)) { return alt; }
            cut = true;
            return '';
        });
        return cut ? out.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '') : out;
    }

    /* Request headers a stream needs (IPTV's http-user-agent / http-referrer): only these
       two (the only ones the TV's player takes), as { ua, ref }. Each is kept to printable
       ASCII on one line (a line break would add a header of its own) and a sane length; a
       Referer must be an http(s) link. The names Stremio uses ("User-Agent", "Referer") are
       read too. Returns null when nothing usable is left. */
    var HEADER_MAX = { ua: 512, ref: 2048 };
    function headerValue(v, max) {
        if (typeof v !== 'string') { return ''; }
        v = v.trim();
        return (v && v.length <= max && /^[\x20-\x7e]+$/.test(v)) ? v : '';
    }
    function sanitizeHeaders(h) {
        if (!h || typeof h !== 'object') { return null; }
        var ua = headerValue(h.ua != null ? h.ua : (h['User-Agent'] || h['user-agent']), HEADER_MAX.ua);
        var ref = headerValue(h.ref != null ? h.ref : (h.Referer || h.referer), HEADER_MAX.ref);
        if (ref && !/^https?:\/\/[^\s]+$/i.test(ref)) { ref = ''; }
        if (!ua && !ref) { return null; }
        var out = {};
        if (ua) { out.ua = ua; }
        if (ref) { out.ref = ref; }
        return out;
    }

    /* What went wrong, in a few words, for a status shown on screen: "too large (over 2 MB)",
       "not valid JSON", "timed out", "network error", "HTTP 404", or the message itself. */
    // What the server said about it, if anything (see serverMessage).
    function problemDetail(err) { return (err && err.serverMessage) || ''; }
    function problem(err) {
        var m = '' + ((err && err.message) || err || '');
        var big = m.match(/^Too large \((over [^)]+)\)/);
        if (big) { return 'too large (' + big[1] + ')'; }
        if (/^Bad JSON/.test(m)) { return 'not valid JSON'; }
        if (/^Timeout/.test(m)) { return 'timed out'; }
        if (/^Network error/.test(m)) { return 'network error'; }
        if (/^Redirected into the home network/.test(m)) { return 'redirected into the home network'; }
        var st = m.match(/^HTTP (\d+)/);
        if (st) { return st[1] === '0' ? 'no answer (blocked?)' : 'HTTP ' + st[1]; }
        return m.split(':')[0] || 'failed';
    }

    /* A list from an answer: [] unless it really is one, only its object items (the rest
       are dropped), and at most `max` of them. Addons and APIs are outside our control:
       a list that's a string, or has nulls in it, or runs to a million items, must not
       stop the app. */
    // Moves list[i] in place: dir -1 / 1 one step, -Infinity / Infinity to the top / bottom
    // (the others keep their order). False when it can't move (not found, already there).
    function moveIn(list, i, dir) {
        var j = dir === -Infinity ? 0 : dir === Infinity ? list.length - 1 : i + dir;
        if (i < 0 || i >= list.length || j < 0 || j >= list.length || j === i) { return false; }
        list.splice(j, 0, list.splice(i, 1)[0]);
        return true;
    }
    function listOf(x, max, keep) {   // keep(item): an extra test, applied before counting
        if (!Array.isArray(x)) { return []; }
        var out = [];
        for (var i = 0; i < x.length && out.length < (max || 1000); i++) {
            if (x[i] && typeof x[i] === 'object' && (!keep || keep(x[i]))) { out.push(x[i]); }
        }
        return out;
    }

    /* GET via XHR with a timeout. Returns a Promise of the response text.
       maxBytes: give up as soon as more than that has arrived ("Too large (over …)");
       TEXT_MAX when not given. */
    // A failed download, in Diagnostics. During a private playback, only its server: its link (a
    // title's name can be in it) isn't kept, in the log or the copy saved for the next launch.
    function privateNow() { try { return typeof Player !== 'undefined' && !!Player.privateNow && Player.privateNow(); } catch (e) { return false; } }
    function logged(err) {
        var msg = '' + err.message;
        if (privateNow()) { msg = msg.replace(/(https?:\/\/[^\/\s?#]+)[^\s]*/g, '$1/…'); }
        log('network', msg); err.logged = true; return err;
    }
    function noteNetwork(err) { return logged(err); }
    // What a server said when it refused (an error answer's own message, e.g. AIOStreams'
    // { error: { message: "Invalid stream expression … Expected :" } }, or short plain text),
    // on one line, links in it masked, a long one kept to its start and end (where the what
    // and the why usually are). '' when there's nothing readable (an HTML error page…).
    var SERVER_MSG_MAX = 220;
    function serverMessage(body) {
        var t = '' + (body || ''), m = '';
        if (!t || t.length > 200000) { return ''; }
        try {
            var j = JSON.parse(t), e = j && j.error;
            m = (e && typeof e === 'object' && (e.message || e.msg)) || (typeof e === 'string' && e) ||
                (j && (j.message || j.errorMessage || (typeof j.detail === 'string' && j.detail))) || '';
        } catch (x) {
            if (!/^\s*</.test(t) && t.length < 1000) { m = t; }   // plain text, not an HTML page
        }
        m = ('' + m).replace(/\s+/g, ' ').trim().replace(/https?:\/\/[^\s'")]+/g, function (u) { return redactUrl(u); });
        if (m.length > SERVER_MSG_MAX) { m = m.slice(0, 100).trim() + ' … ' + m.slice(-(SERVER_MSG_MAX - 104)).trim(); }
        return m;
    }

    // cancel (optional): a cancelToken(); cancelling it stops this download (the transfer itself,
    // not just its answer) — it rejects with err.cancelled, and isn't logged as a problem.
    // quiet: a failure isn't noted in Diagnostics (a check that's expected to fail at times, like
    // the YouTube service's while it starts; the caller says so if it matters).
    // headers (optional): { name: value } sent with it.
    function getText(url, timeoutMs, maxBytes, cancel, quiet, headers) {
        function logged(err) { return quiet ? err : noteNetwork(err); }
        maxBytes = maxBytes || TEXT_MAX;
        return new Promise(function (resolveP, rejectP) {
            if (cancel && cancel.cancelled) { rejectP(cancelledError(url)); return; }   // (nothing started)
            var xhr = new XMLHttpRequest();
            var done = false, off = null;
            function resolve(v) { if (off) { off(); } resolveP(v); }
            function reject(e) { if (off) { off(); } rejectP(e); }
            if (cancel) {
                off = cancel.onCancel(function () {
                    if (done) { return; }
                    done = true;
                    try { xhr.abort(); } catch (e0) {}
                    rejectP(cancelledError(url));
                });
            }
            try {
                xhr.open('GET', url, true);
                if (headers) { Object.keys(headers).forEach(function (h) { xhr.setRequestHeader(h, headers[h]); }); }
            } catch (e) { reject(e); return; }
            xhr.timeout = timeoutMs || 15000;
            if (maxBytes) {
                xhr.onprogress = function (ev) {
                    var got = (ev && ev.loaded) || ('' + (xhr.responseText || '')).length;
                    if (!done && got > maxBytes) {
                        done = true;
                        try { xhr.abort(); } catch (e2) {}
                        reject(logged(new Error('Too large (over ' + mb(maxBytes) + '): ' + redactUrl(url))));
                    }
                };
            }
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || done) { return; }
                done = true;
                var body = xhr.responseText;
                if (body && body.length > maxBytes) { reject(logged(new Error('Too large (over ' + mb(maxBytes) + '): ' + redactUrl(url)))); return; }   // (no progress events)
                var landed = xhr.responseURL;   // where the redirects (if any) ended
                if (landed && landed !== url && urlIsPrivate(landed) && !urlIsPrivate(url) && !_localOk()) {
                    reject(logged(new Error('Redirected into the home network: ' + redactUrl(url) + ' -> ' + redactUrl(landed))));
                    return;
                }
                if (xhr.status >= 200 && xhr.status < 300) { resolve(body); }
                else {
                    var err = new Error('HTTP ' + xhr.status + ' for ' + redactUrl(url));
                    var said = serverMessage(body);
                    if (said) { err.serverMessage = said; err.message += ': ' + said; }
                    reject(logged(err));
                }
            };
            xhr.ontimeout = function () { if (!done) { done = true; reject(logged(new Error('Timeout: ' + redactUrl(url)))); } };
            xhr.onerror = function () { if (!done) { done = true; reject(logged(new Error('Network error: ' + redactUrl(url)))); } };
            try { xhr.send(); } catch (e3) { reject(e3); }
        });
    }

    function cancelledError(url) { var e = new Error('Cancelled: ' + redactUrl(url)); e.cancelled = true; return e; }
    // Downloads for one screen (or one job), stopped together: getText / getJSON(url, …, token).
    function cancelToken() {
        var t = { cancelled: false }, fns = [];
        t.onCancel = function (fn) {
            if (t.cancelled) { fn(); return function () {}; }
            fns.push(fn);
            return function () { var i = fns.indexOf(fn); if (i !== -1) { fns.splice(i, 1); } };
        };
        t.cancel = function () {
            if (t.cancelled) { return; }
            t.cancelled = true;
            var list = fns; fns = [];
            list.forEach(function (fn) { try { fn(); } catch (e) {} });
        };
        return t;
    }

    // ---- the app in the background (the TV's Home, another app): low-priority work waits ----
    function isHidden() { try { return !!document.hidden; } catch (e) { return false; } }
    var _visibleWaiters = [];
    // Resolves at once while StremioK is on screen, else when it's back.
    function whenVisible() {
        if (!isHidden()) { return Promise.resolve(); }
        return new Promise(function (r) { _visibleWaiters.push(r); });
    }
    try {
        document.addEventListener('visibilitychange', function () {
            if (isHidden()) { return; }
            var w = _visibleWaiters; _visibleWaiters = [];
            w.forEach(function (r) { try { r(); } catch (e) {} });
            try { pumpImages(); } catch (e2) {}   // (artwork that waited)
        }, false);
    } catch (e) {}

    /* GET JSON via XHR with a timeout. Returns a Promise of the parsed body (JSON_MAX
       unless maxBytes says otherwise). cancel, headers: see getText. */
    function getJSON(url, timeoutMs, maxBytes, cancel, headers) {
        return getText(url, timeoutMs, maxBytes || JSON_MAX, cancel, false, headers).then(function (text) {
            try { return JSON.parse(text); }
            catch (e) { throw logged(new Error('Bad JSON from ' + redactUrl(url))); }
        });
    }

    /* A small most-recently-used cache: keeps the last `max` entries. The TV keeps the
       app running for days, so session caches must not grow without limit. */
    function lru(max) {
        var map = {}, order = [];
        function drop(k) { var i = order.indexOf(k); if (i !== -1) { order.splice(i, 1); } }
        return {
            get: function (k) {
                if (!Object.prototype.hasOwnProperty.call(map, k)) { return undefined; }
                drop(k); order.push(k);   // most recent last
                return map[k];
            },
            set: function (k, v) {
                if (Object.prototype.hasOwnProperty.call(map, k)) { drop(k); }
                map[k] = v; order.push(k);
                while (order.length > max) { delete map[order.shift()]; }
            },
            del: function (k) { if (Object.prototype.hasOwnProperty.call(map, k)) { delete map[k]; drop(k); } },
            clear: function () { map = {}; order = []; },
            size: function () { return order.length; }
        };
    }

    /* GET JSON through an lru() cache: concurrent callers share one request, and a failure is
       forgotten so the next call tries again. cancel (each caller's own): that caller stops
       waiting (its promise rejects, err.cancelled); the shared download is stopped only once
       every caller still waiting on it has cancelled, so one screen left doesn't fail
       another's. */
    function cachedJSON(cache, url, timeoutMs, cancel) {
        var e = cache.get(url);
        if (!e) {
            e = { tok: cancelToken(), waiting: 0 };
            e.p = U.getJSON(url, timeoutMs, undefined, e.tok);   // through U, so it can be swapped (tests, previews)
            cache.set(url, e);
            e.p.then(null, function () { if (cache.get(url) === e) { cache.del(url); } });
        }
        if (!cancel) { e.waiting = Infinity; return e.p; }   // (someone who never cancels: never stopped)
        if (cancel.cancelled) { return Promise.reject(cancelledError(url)); }
        e.waiting++;
        return new Promise(function (resolve, reject) {
            var done = false;
            var off = cancel.onCancel(function () {
                if (done) { return; }
                done = true;
                reject(cancelledError(url));
                if (--e.waiting <= 0) { e.tok.cancel(); if (cache.get(url) === e) { cache.del(url); } }
            });
            e.p.then(function (v) { if (!done) { done = true; off(); e.waiting--; resolve(v); } },
                function (err) { if (!done) { done = true; off(); e.waiting--; reject(err); } });
        });
    }

    /* Storage for big, regenerable things (IPTV playlist copies): IndexedDB, which has far
       more room than localStorage (kept for small, important state). Promise-based. Where
       IndexedDB isn't there (or fails to open), it falls back to localStorage (store), so it
       always works. get(key) -> value or null; set(key, value) -> true / false; remove(key). */
    // The TV's own disk (its internal storage), as the TV reports it: { free, total } in bytes,
    // or null where it doesn't say (a computer's browser). What the TV allows StremioK's
    // database follows the free space (about a fifteenth of it).
    function diskInfo() {
        return new Promise(function (resolve) {
            try {
                if (!(window.tizen && tizen.systeminfo && tizen.systeminfo.getPropertyValue)) { resolve(null); return; }
                tizen.systeminfo.getPropertyValue('STORAGE', function (s) {
                    var u = ((s && s.units) || []).filter(function (x) { return x && x.type === 'INTERNAL'; })[0];
                    resolve(u ? { free: +u.availableCapacity || 0, total: +u.capacity || 0 } : null);
                }, function () { resolve(null); });
            } catch (e) { resolve(null); }
        });
    }
    var BIG_CACHES = ['stremiok.homecache', 'stremiok.local.index', 'stremiok.iptv.cache.'];   // (in the TV's database: given up first, in this order)
    var bigStore = (function () {
        var DB = 'stremiok', OS = 'kv', _db = null, _failed = false;
        var BIG_SHARE = 0.25, RETRY_MS = 60000, RETRY_MAX = 3, _retry = {};
        var _saves = {};   // times each item was saved since StremioK started (Diagnostics: what keeps changing)
        // Old versions of saved items the TV's database keeps (the 2017 TV doesn't always clear
        // them out: seen full, 0.6 MB of StremioK's own in 16 MB, refusing every save). Only
        // deleting the database gives their space back (emptying it doesn't): tidy() does, and
        // writes StremioK's data back; on its own when they take over LEFTOVER_SHARE of what the
        // TV allows (after launch, see App; or a save refused, once a session).
        var LEFTOVER_SHARE = 0.5, _busy = null, _refusalTidy = false;
        // Use the TV's database (Settings › Diagnostics › Storage; on unless turned off):
        // off, the big copies are kept in the settings storage (BIG_KEY: the ones that go here).
        var USE_KEY = 'stremiok.bigdb', BIG_KEY = /^stremiok\.(homecache|local\.index|iptv\.cache\.|trakt\.watched)/;
        function enabled() { return store.get(USE_KEY, true) !== false; }
        function lsBigKeys() {
            var out = [];
            try { for (var i = 0; i < window.localStorage.length; i++) { var k = window.localStorage.key(i); if (k && BIG_KEY.test(k)) { out.push(k); } } } catch (e) {}
            return out;
        }
        function open() { return _busy ? _busy.then(rawOpen) : rawOpen(); }   // (a tidy-up under way: after it)
        function rawOpen() {
            if (_db) { return Promise.resolve(_db); }
            if (_failed || typeof window === 'undefined' || !window.indexedDB || !enabled()) { return Promise.resolve(null); }
            return new Promise(function (resolve) {
                var req;
                try { req = window.indexedDB.open(DB, 1); } catch (e) { _failed = true; resolve(null); return; }
                req.onupgradeneeded = function () { try { req.result.createObjectStore(OS); } catch (e) {} };
                req.onsuccess = function () {
                    var d = req.result;
                    d.onversionchange = function () { try { d.close(); } catch (e) {} if (_db === d) { _db = null; } };   // (a deletion waits for it)
                    _db = d; resolve(_db);
                };
                req.onerror = req.onblocked = function () { _failed = true; log('storage', 'IndexedDB unavailable: big caches use localStorage'); resolve(null); };
            });
        }
        var _why = '';   // why the last write failed (the database's own error: QuotaExceededError…)
        function tx(db, mode, fn) {
            return new Promise(function (resolve) {
                try {
                    var t = db.transaction(OS, mode), os = t.objectStore(OS), r = fn(os);
                    t.oncomplete = function () { resolve(r && r.result !== undefined ? r.result : true); };
                    t.onerror = t.onabort = function () {
                        var er = t.error || (r && r.error);
                        _why = er ? (er.name || '') + (er.message ? ': ' + er.message : '') : 'aborted';
                        resolve(mode === 'readonly' ? null : false);
                    };
                } catch (e) { _why = (e && (e.name || e.message)) || 'failed'; resolve(mode === 'readonly' ? null : false); }
            });
        }
        return {
            get: function (key) {
                return open().then(function (db) {
                    if (!db) { return store.get(key, null, true); }
                    return tx(db, 'readonly', function (os) { return os.get(key); }).then(function (v) { return v === undefined || v === true ? null : v; });
                });
            },
            // The database full (QuotaExceededError): copies that can be made again are given up,
            // least needed first (BIG_CACHES: Home's saved rows, a USB drive's index, playlist
            // copies; never the one being saved), and it's tried once more.
            // A refusal for something small next to what the TV allows (under BIG_SHARE of it) is
            // the TV's database refusing for a while (seen on the 2017 TV: even 6 KB, with 15 MB
            // allowed and under 1 MB used; right after an install, or before it reclaims space):
            // nothing is given up for it, it's tried again a minute later (RETRY_MAX times), and
            // a newer save of the same key replaces the one waiting. Each refusal is noted with
            // the item's size, the database's figures and the TV's free disk.
            set: function (key, value) {
                delete _retry[key];   // (a newer copy: the one waiting to be tried again isn't wanted)
                return open().then(function (db) {
                    if (!db) { return store.set(key, value); }
                    var size = sizeOf(value);
                    function put() {
                        return open().then(function (d) {
                            return d ? tx(d, 'readwrite', function (os) { os.put(value, key); }) : store.set(key, value);
                        }).then(function (ok) { if (ok) { saved(key); } return ok; });
                    }
                    var freed = [];
                    function tryAgain(ok, step) {   // one kind of copy given up at a time, until it fits
                        if (ok || !/Quota/i.test(_why) || step >= BIG_CACHES.length) { return ok; }
                        return freeFor(db, key, BIG_CACHES[step]).then(function (gone) {
                            if (!gone.length) { return tryAgain(false, step + 1); }
                            freed = freed.concat(gone);
                            return put().then(function (ok2) { return tryAgain(ok2, step + 1); });
                        });
                    }
                    return put().then(function (ok) {
                        if (ok || !/Quota/i.test(_why)) { return ok; }
                        return quota().then(function (q) {
                            if (q && q.quota && size < q.quota * BIG_SHARE) {   // (small: a passing refusal, or old versions filling it)
                                if (_refusalTidy) { return { later: q }; }   // (tidied up once this session: something else)
                                return tidyIfNeeded().then(function (t) {
                                    if (!t) { return { later: q }; }
                                    _refusalTidy = true;
                                    return put().then(function (ok2) { return ok2 || { later: q }; });
                                });
                            }
                            return tryAgain(false, 0);
                        });
                    }).then(function (ok) {
                        if (freed.length) { log('storage', 'The TV’s database was full: gave up ' + freed.join(', ') + (ok ? ' to save ' : ', and still couldn’t save ') + key); }
                        var why = _why || 'no reason given';
                        if (ok && ok.later) {
                            return figures(size, ok.later).then(function (f) {
                                log('storage', 'Could not save ' + key + ' in the TV’s database (' + why + '): trying again in a minute — ' + f);
                                retryLater(key, value, 1);
                                return false;
                            });
                        }
                        if (ok) { store.remove(key); return true; }   // (a copy left in localStorage from before: freed)
                        return quota().then(function (q) { return figures(size, q); }).then(function (f) {
                            log('storage', 'Could not save ' + key + ' in the TV’s database (' + why + ') — ' + f);
                            return false;
                        });
                    });
                });
            },
            // keepRetry: a save waiting to be tried again stays (the Trakt history, moved to the
            // settings storage meanwhile, goes back into the database when it's taken)
            remove: function (key, keepRetry) {
                if (!keepRetry) { delete _retry[key]; }
                store.remove(key);
                return open().then(function (db) { return db ? tx(db, 'readwrite', function (os) { os['delete'](key); }) : true; });
            },
            keys: function () { return open().then(function (db) { return db ? keysOf(db) : lsBigKeys(); }); },
            quota: function () { return quota(); },
            enabled: function () { return enabled(); },
            setEnabled: function (on) { return setEnabled(!!on); },
            tidy: function () { return tidy(); },
            tidyIfNeeded: function () { return tidyIfNeeded(); },
            // For Settings › Diagnostics: each entry's size (about: characters, as the TV keeps
            // them, two bytes each) and how many times it was saved since StremioK started, and
            // how much the TV lets StremioK keep.
            info: function () { return info(); }
        };
        function info() {
                return open().then(function (db) {
                    if (!db) { return { entries: [] }; }
                    return keysOf(db).then(function (ks) {
                        return Promise.all(ks.map(function (k) {
                            return tx(db, 'readonly', function (os) { return os.get(k); }).then(function (v) { return { key: k, bytes: sizeOf(v), saves: _saves[k] || 0 }; });
                        }));
                    }).then(function (entries) {
                        return quota().then(function (q) { return { entries: entries, usage: q && q.usage, quota: q && q.quota }; });
                    });
                });
        }
        // The database deleted and made anew with StremioK's data (everything else waits for it):
        // { before, after } (what the TV said was used), or null when it couldn't be.
        function tidy() {
            if (_busy) { return _busy; }
            var before = null, done = rawOpen().then(function (db) {
                if (!db) { return null; }
                return quota().then(function (q) { before = q; return readAll(db); }).then(function (all) {
                    try { db.close(); } catch (e) {}
                    if (_db === db) { _db = null; }
                    return dropDb().then(function (gone) {
                        if (!gone) { log('storage', 'Could not tidy up the TV’s database: it was in use'); return null; }
                        return rawOpen().then(function (db2) {
                            if (!db2) { return null; }
                            var ks = Object.keys(all);
                            return tx(db2, 'readwrite', function (os) { ks.forEach(function (k) { os.put(all[k], k); }); }).then(function (ok) {
                                return quota().then(function (q2) {
                                    var r = { before: before && before.usage, after: q2 && q2.usage };
                                    if (!ok) { log('storage', 'Tidied up the TV’s database, but couldn’t write StremioK’s data back (' + (_why || 'no reason given') + '): it’s made again as needed'); }
                                    else { log('storage', 'Tidied up the TV’s database: ' + (r.before != null ? fmtSize(r.before) : '?') + ' → ' + (r.after != null ? fmtSize(r.after) : '?') + ' (old versions of what StremioK saved, cleared out; its data kept)'); }
                                    return r;
                                });
                            });
                        });
                    });
                });
            });
            _busy = done.then(function (r) { _busy = null; return r; }, function () { _busy = null; return null; });
            return _busy;
        }
        // Tidied up when old versions take over LEFTOVER_SHARE of what the TV allows: the result, or null.
        function tidyIfNeeded() {
            if (!enabled()) { return Promise.resolve(null); }
            return quota().then(function (q) {
                if (!q || !q.quota || (q.usage || 0) < q.quota * LEFTOVER_SHARE) { return null; }
                return info().then(function (inf) {
                    var mine = (inf.entries || []).reduce(function (n, e) { return n + e.bytes; }, 0);
                    return (q.usage - mine > q.quota * LEFTOVER_SHARE) ? tidy() : null;
                });
            });
        }
        // Off: the database's items moved to the settings storage (what fits) and the database
        // deleted. On: the big copies in the settings storage moved back into it. { moved, total }
        function setEnabled(on) {
            if (on === enabled()) { return Promise.resolve({ moved: 0, total: 0 }); }
            if (_busy) { return _busy.then(function () { return setEnabled(on); }); }
            var done;
            if (!on) {
                done = rawOpen().then(function (db) {
                    if (!db) { store.set(USE_KEY, false); return { moved: 0, total: 0 }; }
                    return readAll(db).then(function (all) {
                        try { db.close(); } catch (e) {}
                        if (_db === db) { _db = null; }
                        return dropDb().then(function (gone) {
                            store.set(USE_KEY, false);
                            var ks = Object.keys(all), n = 0;
                            ks.forEach(function (k) { delete _retry[k]; if (store.set(k, all[k])) { n++; } });
                            log('storage', 'Stopped using the TV’s database' + (gone ? '' : ' (it couldn’t be deleted: in use)') + ': ' + n + ' of ' + ks.length + ' items kept in the settings storage');
                            return { moved: n, total: ks.length };
                        });
                    });
                });
            } else {
                store.remove(USE_KEY);
                done = rawOpen().then(function (db) {
                    if (!db) { return { moved: 0, total: 0 }; }
                    var all = {}, ks = [];
                    lsBigKeys().forEach(function (k) { var v = store.get(k, null, true); if (v != null) { all[k] = v; ks.push(k); } });
                    return tx(db, 'readwrite', function (os) { ks.forEach(function (k) { os.put(all[k], k); }); }).then(function (ok) {
                        if (ok) { ks.forEach(function (k) { store.remove(k); }); }
                        else { log('storage', 'Using the TV’s database again, but couldn’t move StremioK’s copies into it (' + (_why || 'no reason given') + '): they stay in the settings storage'); }
                        return { moved: ok ? ks.length : 0, total: ks.length };
                    });
                });
            }
            _busy = done.then(function (r) { _busy = null; return r; }, function () { _busy = null; return null; });
            return _busy;
        }
        function readAll(db) {
            return keysOf(db).then(function (ks) {
                var all = {};
                return Promise.all(ks.map(function (k) {
                    return tx(db, 'readonly', function (os) { return os.get(k); }).then(function (v) { if (v != null && v !== true) { all[k] = v; } });
                })).then(function () { return all; });
            });
        }
        function dropDb() {   // true once deleted (false: still in use after 10 s, or refused)
            return new Promise(function (resolve) {
                var req, t = setTimeout(function () { resolve(false); }, 10000);
                try { req = window.indexedDB.deleteDatabase(DB); } catch (e) { clearTimeout(t); resolve(false); return; }
                req.onsuccess = function () { clearTimeout(t); resolve(true); };
                req.onerror = function () { clearTimeout(t); resolve(false); };
            });
        }
        function saved(key) { _saves[key] = (_saves[key] || 0) + 1; }
        // A save the TV refused for a while, tried again a minute later (see set).
        function retryLater(key, value, n) {
            var mine = { value: value };
            _retry[key] = mine;
            setTimeout(function () {
                if (_retry[key] !== mine) { return; }   // (saved anew, or removed, meanwhile)
                open().then(function (db) {
                    if (!db || _retry[key] !== mine) { return; }
                    return tx(db, 'readwrite', function (os) { os.put(value, key); }).then(function (ok) {
                        if (_retry[key] !== mine) { return; }
                        if (ok) {
                            saved(key);
                            delete _retry[key];
                            store.remove(key);   // (the copy kept in localStorage meanwhile, if any: freed)
                            log('storage', 'Saved ' + key + ' in the TV’s database after all (' + (n === 1 ? 'a minute' : n + ' minutes') + ' later)');
                            return;
                        }
                        if (n < RETRY_MAX) { retryLater(key, value, n + 1); return; }
                        delete _retry[key];
                        var why = _why || 'no reason given';
                        return quota().then(function (q) { return figures(sizeOf(value), q); }).then(function (f) {
                            log('storage', 'Gave up saving ' + key + ' in the TV’s database after ' + RETRY_MAX + ' more tries (' + why + ') — ' + f);
                        });
                    });
                });
            }, RETRY_MS);
        }
        // "6 KB; the database: 380 KB used of 15.3 MB; the TV: 225 MB free" (what's known)
        function figures(size, q) {
            return diskInfo().then(function (d) {
                return fmtSize(size) + (q && q.quota ? '; the database: ' + fmtSize(q.usage || 0) + ' used of ' + fmtSize(q.quota) : '') +
                    (d ? '; the TV: ' + fmtSize(d.free) + ' free' : '');
            });
        }
        function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
        function sizeOf(v) {
            if (v == null) { return 0; }
            if (typeof v === 'string') { return v.length * 2; }
            if (typeof v.text === 'string') { return v.text.length * 2 + 200; }
            try { return JSON.stringify(v).length * 2; } catch (e) { return 0; }
        }
        function keysOf(db) {
            return new Promise(function (resolve) {
                var out = [];
                try {
                    var t = db.transaction(OS, 'readonly'), os = t.objectStore(OS);
                    var req = os.openKeyCursor ? os.openKeyCursor() : os.openCursor();
                    req.onsuccess = function () { var cur = req.result; if (cur) { out.push('' + cur.key); cur['continue'](); } };
                    t.oncomplete = function () { resolve(out); };
                    t.onerror = t.onabort = function () { resolve(out); };
                } catch (e) { resolve(out); }
            });
        }
        function freeFor(db, key, prefix) {
            return keysOf(db).then(function (ks) {
                var gone = ks.filter(function (k) { return k !== key && k.indexOf(prefix) === 0; });
                return Promise.all(gone.map(function (k) { return tx(db, 'readwrite', function (os) { os['delete'](k); }); })).then(function () { return gone; });
            });
        }
        function quota() {
            return new Promise(function (resolve) {
                try {
                    var ts = navigator.webkitTemporaryStorage;
                    if (ts && ts.queryUsageAndQuota) { ts.queryUsageAndQuota(function (u, q) { resolve({ usage: u, quota: q }); }, function () { resolve(null); }); return; }
                    if (navigator.storage && navigator.storage.estimate) { navigator.storage.estimate().then(function (e) { resolve({ usage: e.usage, quota: e.quota }); }, function () { resolve(null); }); return; }
                } catch (e) {}
                resolve(null);
            });
        }
    })();

    /* localStorage JSON helpers, all guarded (storage can throw / be unavailable).
       Reads are memoized: hot paths (episode lists, poster grids) call get() per item,
       and re-parsing a large blob each time stalls the TV. The returned object is
       shared, so a caller that mutates it must persist the change with set(). set()
       and remove() drop the memo entry, so the next get() re-reads what was stored.
       Pass noMemo=true for large one-shot blobs (IPTV playlist text) so they aren't
       kept in memory for the whole session. */
    var _memo = {};
    // Regenerable caches, cleared first (in this order) when the storage is full.
    var CACHES = ['stremiok.homesnap', 'stremiok.homecache', 'stremiok.iptv.cache.', 'stremiok.showinfo', 'stremiok.manifests'];
    var _fullToldAt = null;   // (when you were last told the storage is full)
    function isCacheKey(key) {
        for (var i = 0; i < CACHES.length; i++) { if (key === CACHES[i] || (CACHES[i].slice(-1) === '.' && key.indexOf(CACHES[i]) === 0)) { return true; } }
        return false;
    }
    function tryWrite(key, text) {
        try { window.localStorage.setItem(key, text); return true; } catch (e) { return false; }
    }
    function clearCache(name) {   // true if anything was removed
        var removed = false;
        try {
            var ls = window.localStorage, keys = [];
            for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k === name || (name.slice(-1) === '.' && k && k.indexOf(name) === 0)) { keys.push(k); } }
            keys.forEach(function (k) { ls.removeItem(k); delete _memo[k]; removed = true; });
        } catch (e) {}
        return removed;
    }
    var _writes = 0;   // saved changes so far (see store.writes)
    var store = {
        // How many changes have been saved so far: a page drawn from saved settings can tell
        // whether anything changed since (the title page re-ranks its sources then).
        writes: function () { return _writes; },
        get: function (key, fallback, noMemo) {
            var m = _memo[key];
            if (!m) {
                try {
                    var raw = window.localStorage.getItem(key);
                    m = { missing: raw === null, val: raw === null ? null : JSON.parse(raw) };
                } catch (e) { return fallback; }
                if (!noMemo) { _memo[key] = m; }
            }
            return m.missing ? fallback : m.val;
        },
        // When the TV's storage is full, what matters wins: saving progress, watched marks,
        // settings, addons or playlists clears regenerable caches (in CACHES order) until it
        // fits; if it still doesn't, it's logged and you're told (once a minute at most).
        // A cache that doesn't fit simply isn't saved.
        set: function (key, value) {
            delete _memo[key];
            _writes++;
            var text;
            try { text = JSON.stringify(value); } catch (e0) { return false; }
            if (tryWrite(key, text)) { return true; }
            if (isCacheKey(key)) { return false; }
            var freed = [];
            for (var i = 0; i < CACHES.length; i++) {
                var gone = clearCache(CACHES[i]);
                if (gone) { freed.push(CACHES[i]); }
                if (gone && tryWrite(key, text)) { log('storage', 'TV storage full: cleared ' + freed.join(', ') + ' to save ' + key); return true; }
            }
            log('storage', 'TV storage full: could not save ' + key);
            var now = Date.now();
            if (_fullToldAt === null || now - _fullToldAt > 60000) { _fullToldAt = now; try { toast('The TV’s storage is full: a change couldn’t be saved (Settings › Diagnostics).', 4000); } catch (e2) {} }
            return false;
        },
        remove: function (key) {
            delete _memo[key];
            _writes++;
            try { window.localStorage.removeItem(key); } catch (e) {}
        }
    };

    var _toastTimer = null;
    function toast(msg, ms) {
        var t = byId('toast');
        t.textContent = msg;
        t.className = '';
        if (_toastTimer) { clearTimeout(_toastTimer); }
        _toastTimer = setTimeout(function () { t.className = 'hidden'; }, ms || 2600);
    }

    // Show/hide the loading overlay. `msg` sets the status line under the spinner; when
    // it's left out the current line stays, so a generic "busy" call (e.g. a buffering
    // event) doesn't wipe a more specific one ("Opening stream at 1080p…").
    function spinner(on, msg) {
        byId('spinner').className = on ? '' : 'hidden';
        var m = byId('spinner-msg');
        if (m) {
            if (!on) { m.textContent = ''; }
            else if (msg !== undefined) { m.textContent = msg; }
        }
    }

    // Poster loading is deliberately throttled for older TV webviews. Assigning
    // every grid image's src at render time starts a large burst of downloads and
    // image decodes on the UI thread, which can make D-pad navigation unresponsive.
    var IMAGE_LOAD_LIMIT = 3;
    var _imageQueue = [];
    var _imageActive = 0;
    var _imagePumpTimer = null;

    function scheduleImagePump(delay) {
        if (_imagePumpTimer !== null) { return; }
        _imagePumpTimer = setTimeout(function () {
            _imagePumpTimer = null;
            pumpImages();
        }, delay || 0);
    }

    // One download per image URL: a card asking for one that's already on its way waits
    // for that download (it isn't started twice). A URL that failed isn't tried again for
    // a while: its cards show their fallback (their onerror) at once. The failures kept are
    // bounded (the oldest forgotten), for sessions that run for days.
    var FAIL_TTL = 10 * 60 * 1000, FAILED_MAX = 300;
    var _inflight = {};   // src -> [queued items waiting on that download]
    var _failedAt = lru(FAILED_MAX);   // src -> when it failed
    function failedRecently(src) {
        var t = _failedAt.get(src);
        if (t && Date.now() - t < FAIL_TTL) { return true; }
        if (t) { _failedAt.del(src); }
        return false;
    }
    // A link as a CSS url(): quotes, backslashes and line breaks escaped, so an addon's
    // artwork link can't close the url( ) and add another image of its own choosing.
    function cssUrl(src) {
        return 'url("' + ('' + src).replace(/["\\\n\r\f]/g, function (c) { return encodeURIComponent(c); }) + '")';
    }
    function showOn(item) {   // the image is in the browser now: put it on this node
        if (item.bg) { item.img.style.backgroundImage = cssUrl(item.src); } else { item.img.src = item.src; }
    }
    function failOn(item) {   // it can't load: this node's own fallback
        if (!item.bg && typeof item.img.onerror === 'function') { try { item.img.onerror(); } catch (e) {} }
    }
    // A download that neither loads nor fails (a stalled host) gives up after this, so a
    // few of them can't hold every slot and stop all later artwork.
    var IMAGE_TIMEOUT_MS = 12000;
    var _loading = [];   // { it, cancel } of the downloads in progress
    function onPage(node) { return document.documentElement.contains(node); }
    // Downloads nothing on screen is waiting for any more (the screen was redrawn or left)
    // are stopped, freeing their slot for the pictures that are.
    function dropUnwanted() {
        _loading.slice().forEach(function (l) {
            if (onPage(l.it.img)) { return; }
            var waiting = _inflight[l.it.src] || [];
            for (var i = 0; i < waiting.length; i++) { if (onPage(waiting[i].img)) { return; } }
            l.cancel();
        });
    }
    function pumpImages() {
        dropUnwanted();
        if (isHidden()) { return; }   // (in the background: nothing new until StremioK is back)
        while (_imageActive < IMAGE_LOAD_LIMIT && _imageQueue.length) {
            var item = _imageQueue.shift();
            var img = item.img;
            // Re-rendered screens leave their old queued nodes detached; discard them.
            if (!onPage(img) || img.__queuedImage !== item) {
                continue;
            }
            img.__queuedImage = null;
            if (_inflight[item.src]) { _inflight[item.src].push(item); continue; }   // already loading
            _imageActive++;
            _inflight[item.src] = [];
            (function (it) {
                var finished = false, timer = null, entry = { it: it };
                // A CSS background loads through a detached <img> (so it counts against the
                // same limit), an <img> through itself.
                var node = it.bg ? document.createElement('img') : it.img;
                function onLoad() { done(true); }
                function onError() { done(false); }
                function stop() {   // no more events from this download, its slot freed
                    finished = true;
                    if (timer !== null) { clearTimeout(timer); timer = null; }
                    node.removeEventListener('load', onLoad, false);
                    node.removeEventListener('error', onError, false);
                    var i = _loading.indexOf(entry);
                    if (i !== -1) { _loading.splice(i, 1); }
                    _imageActive--;
                }
                function abort() {   // the browser stops fetching it (where it supports that)
                    try { node.removeAttribute('src'); } catch (e) {}
                }
                function done(ok) {
                    if (finished) { return; }
                    stop();
                    if (ok) { markLoaded(it.src); if (it.bg) { showOn(it); } } else { _failedAt.set(it.src, Date.now()); }
                    var waiting = _inflight[it.src] || [];
                    delete _inflight[it.src];
                    waiting.forEach(function (w) { if (ok) { showOn(w); } else { failOn(w); } });
                    // Yield after each decode so pending remote-control input gets a turn.
                    scheduleImagePump(35);
                }
                // Nobody on screen is waiting for it: stop, no failure noted. Its cards keep their
                // place in line, so a screen that comes back (a Home tab kept aside) re-queues
                // them (requeueImages).
                entry.cancel = function () {
                    if (finished) { return; }
                    stop();
                    abort();
                    (_inflight[it.src] || []).concat([it]).forEach(function (w) { w.img.__queuedImage = w; });
                    delete _inflight[it.src];
                    scheduleImagePump(0);
                };
                timer = setTimeout(function () {
                    if (finished) { return; }
                    timer = null;
                    log('images', 'Timed out after ' + (IMAGE_TIMEOUT_MS / 1000) + ' s: ' + it.src);
                    done(false);
                    abort();
                    if (!it.bg) { failOn(it); }   // (a stalled <img> never fires its own error)
                }, IMAGE_TIMEOUT_MS);
                _loading.push(entry);
                node.addEventListener('load', onLoad, false);
                node.addEventListener('error', onError, false);
                node.src = it.src;
            })(item);
        }
    }

    // Images that have loaded once this session. A card built again (a tab redrawn, Home
    // on the way back) shows those at once instead of queueing: the browser has them, so
    // there's no blank-then-image flicker.
    var LOADED_MAX = 800, _loadedSrc = {}, _loadedOrder = [];
    function markLoaded(src) {
        if (_loadedSrc[src]) { return; }
        _loadedSrc[src] = 1; _loadedOrder.push(src);
        if (_loadedOrder.length > LOADED_MAX) { delete _loadedSrc[_loadedOrder.shift()]; }
    }
    // Queue an <img>'s picture (bg: an element's CSS background instead). first: ahead of
    // the rest (a title page's backdrop and logo, the focused title's logo).
    function queueImage(node, src, bg, first) {
        if (!node || !src) { return; }
        var item = { img: node, src: src, bg: !!bg };
        if (_loadedSrc[src]) { node.__queuedImage = null; showOn(item); return; }
        if (failedRecently(src)) { node.__queuedImage = null; failOn(item); return; }
        node.__queuedImage = item;
        if (first) { _imageQueue.unshift(item); } else { _imageQueue.push(item); }
        scheduleImagePump(0);
    }
    function deferImage(img, src, first) { queueImage(img, src, false, first); }
    function deferBg(node, src, first) { queueImage(node, src, true, first); }

    // Card-sized artwork. Addons often link far bigger images than a 200x300 poster or a
    // 340x200 landscape card needs (Cinemeta's backgrounds are 1920x1080, ~780 KB), and
    // decoding those stalls the 2017 TV. Known image hosts serve smaller renditions at a
    // predictable path; anything else is returned unchanged. Only ever sizes down.
    //   role: 'poster' | 'landscape' | 'still' (episode thumbnail) | 'hero' (a title page's
    //   backdrop) | 'logo' | 'cast' (a cast card) | 'profile' (a person page's photo)
    var TMDB_W = { poster: 342, landscape: 780, still: 300, hero: 1280, logo: 500, cast: 185, profile: 342 };
    function cardImage(url, role) {
        if (!url || typeof url !== 'string') { return null; }
        if (/^\/\//.test(url)) { url = 'https:' + url; }   // (a scheme-relative link)
        if (!/^https?:\/\/[^\s\/@]+(\/[^\s]*)?$/i.test(url)) { return null; }   // artwork only from http(s), no user:password@
        // images.metahub.space/{poster|background|logo}/{small|medium|large}/<id>/img
        var mh = url.match(/^(https?:\/\/images\.metahub\.space\/(poster|background)\/)(medium|large)(\/.*)$/);
        if (mh) {
            if (role === 'hero') { return mh[3] === 'large' ? mh[1] + 'medium' + mh[4] : url; }   // a backdrop behind the page
            return mh[1] + 'small' + mh[4];   // cards: poster 300x450, background 480x270
        }
        // episodes.metahub.space/<id>/<s>/<e>/w780.jpg (TMDB still sizes)
        var ep = url.match(/^(https?:\/\/episodes\.metahub\.space\/.*\/)(w\d+|original)(\.jpg)$/);
        if (ep && (ep[2] === 'original' || parseInt(ep[2].slice(1), 10) > 300)) { return ep[1] + 'w300' + ep[3]; }
        // image.tmdb.org/t/p/<size>/<file>
        var tm = url.match(/^(https?:\/\/image\.tmdb\.org\/t\/p\/)(w\d+|original)(\/.*)$/);
        if (tm) {
            var want = TMDB_W[role] || 342;
            if (tm[2] === 'original' || parseInt(tm[2].slice(1), 10) > want) { return tm[1] + 'w' + want + tm[3]; }
        }
        return url;
    }

    function promoteQueuedImage(img) {
        if (!img || !img.__queuedImage) { return; }
        for (var i = 0; i < _imageQueue.length; i++) {
            if (_imageQueue[i] === img.__queuedImage) {
                _imageQueue.unshift(_imageQueue.splice(i, 1)[0]);
                return;
            }
        }
    }

    // Re-queue posters under `root` that never started loading. pumpImages() drops
    // entries whose node is detached, so a cached screen (e.g. a Home tab that was
    // swapped out) needs this when it's attached again. Posters already loading or
    // loaded have no pending entry; a duplicate entry is skipped by the pump.
    function requeueImages(root) {
        if (!root || !root.querySelectorAll) { return; }
        var imgs = root.querySelectorAll('img.poster');
        for (var i = 0; i < imgs.length; i++) {
            if (imgs[i].__queuedImage) { _imageQueue.push(imgs[i].__queuedImage); }
        }
        scheduleImagePump(0);
    }

    // Called after focus/scroll changes. Load the focused card first, then its
    // closest horizontal neighbors, while the rest continue in the background.
    function prioritizeImages(node) {
        if (!node || !node.querySelector || !node.classList.contains('card')) { return; }
        var nearby = [node];
        var prev = node.previousElementSibling;
        var next = node.nextElementSibling;
        if (next) { nearby.push(next); }
        if (prev) { nearby.push(prev); }
        if (next && next.nextElementSibling) { nearby.push(next.nextElementSibling); }
        if (prev && prev.previousElementSibling) { nearby.push(prev.previousElementSibling); }
        // Promote in reverse because each item is moved to the front of the queue.
        for (var i = nearby.length - 1; i >= 0; i--) {
            promoteQueuedImage(nearby[i].querySelector('img.poster'));
        }
        scheduleImagePump(0);
    }

    // ---- Appearance: accent color and background (Settings > Appearance) ----
    // Chromium 47 has no CSS variables, so a theme copies just the declarations that use
    // the default colors into one override stylesheet, with the new colors swapped in.
    // Each accent is [main, strong, light], matching the default indigo's three shades.
    var THEME_BASE = { main: [129, 140, 248], strong: [99, 102, 241], light: [165, 180, 252], bg: [14, 17, 23] };
    var ACCENTS = {
        indigo: null,   // the stylesheet's own colors
        sky: [[56, 189, 248], [14, 165, 233], [125, 211, 252]],
        teal: [[45, 212, 191], [20, 184, 166], [94, 234, 212]],
        emerald: [[52, 211, 153], [16, 185, 129], [110, 231, 183]],
        amber: [[251, 191, 36], [245, 158, 11], [252, 211, 77]],
        orange: [[251, 146, 60], [249, 115, 22], [253, 186, 116]],
        rose: [[251, 113, 133], [244, 63, 94], [253, 164, 175]],
        violet: [[167, 139, 250], [139, 92, 246], [196, 181, 253]],
        gray: [[156, 163, 175], [107, 114, 128], [209, 213, 219]],
        darkgray: [[75, 85, 99], [107, 114, 128], [156, 163, 175]]
    };
    // Accents too dark for the dark text drawn on them (focused buttons, selected rows):
    // that text turns light instead.
    var DARK_ACCENTS = { darkgray: 1 };
    var ON_ACCENT_LIGHT = [[[14, 17, 23], [255, 255, 255]], [[23, 32, 58], [229, 231, 235]], [[38, 48, 74], [209, 213, 219]]];
    function hex(c) { return '#' + c.map(function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join(''); }
    function accentColor(key) { return hex((ACCENTS[key] || [THEME_BASE.main])[0]); }

    // Light backgrounds: the dark palette's colors mapped by role. 'bg' colors are
    // changed everywhere except text color, 'text' ones only in text and borders.
    var LIGHT_BG = {
        gray:  { page: [228, 230, 234], panel: [240, 241, 244], card: [246, 247, 249], raised: [201, 206, 216], deep: [214, 218, 226] },
        white: { page: [255, 255, 255], panel: [241, 243, 246], card: [233, 236, 241], raised: [213, 218, 227], deep: [224, 228, 235] }
    };
    var LIGHT_TEXT = [
        [[230, 233, 239], [21, 24, 30]], [[207, 211, 220], [43, 48, 58]], [[199, 203, 212], [51, 56, 68]],
        [[174, 182, 196], [68, 75, 88]], [[167, 173, 186], [74, 81, 96]], [[154, 162, 177], [82, 90, 105]],
        [[139, 147, 165], [91, 99, 115]], [[139, 147, 163], [91, 99, 115]], [[111, 119, 136], [107, 114, 130]],
        [[255, 210, 87], [138, 90, 0]]   // gold ratings
    ];
    // Drawn over video or pictures: keep their own (light-on-dark) look.
    var KEEP_DARK = /#osd|#player-|#subs|#sub-menu|#skip-prompt|#stream-info|#cast-strip|#yt-links|#yt-card|#toast|#hold-hint|#spinner|\.skip-btn|\.pb-btn|\.sm-|\.si-|\.card \.cap|\.card-new|\.card-watched|\.card-rating|\.grid-cell|\.r-|\.spin\b/;
    var LIGHT_EXTRA = '.card .cap { color: #ffffff }\n' +
        // title logos are made for dark backgrounds: a soft dark outline keeps them readable
        '.detail-logo, .home-info-logo { -webkit-filter: drop-shadow(0 0 2px rgba(0,0,0,0.85)) drop-shadow(0 0 6px rgba(0,0,0,0.45)); ' +
        'filter: drop-shadow(0 0 2px rgba(0,0,0,0.85)) drop-shadow(0 0 6px rgba(0,0,0,0.45)) }\n' +
        '#player-osd, #sub-menu, #player-bar, #skip-prompt, #stream-info, #cast-strip, #yt-links, #yt-card, #toast, #hold-hint, #spinner { color: #e6e9ef }';

    // bg: 'dark' (the stylesheet's own), 'black', 'gray' or 'white' (the last two with dark text)
    function applyTheme(accent, bg) {
        if (bg === true) { bg = 'black'; }
        var pairs = [], acc = ACCENTS[accent], light = LIGHT_BG[bg], darkAccent = !!DARK_ACCENTS[accent];
        if (acc) { pairs.push([THEME_BASE.main, acc[0]], [THEME_BASE.strong, acc[1]], [THEME_BASE.light, acc[2]]); }
        if (darkAccent) {   // only in rules for focused / selected items (see swap)
            ON_ACCENT_LIGHT.forEach(function (t) { pairs.push([t[0], t[1], 'onaccent']); });
        }
        if (bg === 'black') { pairs.push([THEME_BASE.bg, [0, 0, 0]]); }
        if (light) {
            pairs.push([THEME_BASE.bg, light.page, 'bg'], [[22, 27, 38], light.panel, 'bg'], [[26, 31, 43], light.card, 'bg'],
                [[42, 51, 70], light.raised, 'bg'], [[38, 48, 74], light.raised, 'bg'], [[23, 32, 58], light.deep, 'bg'],
                [[58, 33, 48], [243, 214, 220], 'bg'], [[255, 255, 255], [17, 17, 17], 'color']);
            LIGHT_TEXT.forEach(function (t) { pairs.push([t[0], t[1], 'text']); });
        }
        var el = byId('theme-override');
        if (!pairs.length) { if (el) { el.textContent = ''; } return; }
        var subs = pairs.map(function (p) {
            var f = p[0], t = p[1];
            return { rgb: new RegExp('(rgba?\\()\\s*' + f[0] + '\\s*,\\s*' + f[1] + '\\s*,\\s*' + f[2] + '\\s*([,)])', 'g'),
                     hex: new RegExp(hex(f) + '(?![0-9a-f])', 'gi'), kind: p[2] || null,
                     to: t[0] + ', ' + t[1] + ', ' + t[2], toHex: hex(t) };
        });
        function swap(v, prop, keep, selected) {
            var out = v, isColor = prop === 'color', isBorder = prop.indexOf('border') === 0;
            // text on a dark accent: lightened, and then left alone (a light background
            // would otherwise turn that light text dark again)
            if (selected && isColor) {
                subs.forEach(function (x) { if (x.kind === 'onaccent') { out = out.replace(x.rgb, '$1' + x.to + '$2').replace(x.hex, x.toHex); } });
                if (out !== v) { return out; }
            }
            subs.forEach(function (x) {
                if (x.kind === 'onaccent') { return; }
                if (x.kind && keep) { return; }   // light-mode colors: not over video / pictures
                if (x.kind === 'bg' && isColor) { return; }
                if (x.kind === 'text' && !(isColor || isBorder)) { return; }
                if (x.kind === 'color' && !isColor) { return; }
                out = out.replace(x.rgb, '$1' + x.to + '$2').replace(x.hex, x.toHex);
            });
            return out;
        }
        function walk(rules, css) {
            for (var i = 0; i < rules.length; i++) {
                var r = rules[i];
                if (r.type === 4 && r.cssRules) {   // @media
                    var inner = [];
                    walk(r.cssRules, inner);
                    if (inner.length) { css.push('@media ' + r.media.mediaText + ' { ' + inner.join('\n') + ' }'); }
                    continue;
                }
                if (r.type !== 1 || !r.style) { continue; }
                var decls = [], keep = KEEP_DARK.test(r.selectorText || '');
                var selected = /focused|\.sel\b/.test(r.selectorText || '');
                for (var j = 0; j < r.style.length; j++) {
                    var name = r.style[j], val = r.style.getPropertyValue(name), nv = swap(val, name, keep, selected);
                    if (nv !== val) { decls.push(name + ': ' + nv + (r.style.getPropertyPriority(name) ? ' !important' : '')); }
                }
                if (decls.length) { css.push(r.selectorText + ' { ' + decls.join('; ') + ' }'); }
            }
        }
        var css = [], sheets = document.styleSheets || [];
        for (var k = 0; k < sheets.length; k++) {
            if (sheets[k].ownerNode && sheets[k].ownerNode.id === 'theme-override') { continue; }
            try { walk(sheets[k].cssRules || [], css); } catch (e) {}   // unreadable sheet: skip
        }
        if (!el) {
            el = document.createElement('style');
            el.id = 'theme-override';
            (document.head || document.documentElement).appendChild(el);
        }
        if (light) { css.push(LIGHT_EXTRA); }
        el.textContent = css.join('\n');
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        return (h > 0 ? h + ':' + p(m) : p(m)) + ':' + p(s);
    }

    // A day relative to today: "today", "tomorrow", "yesterday", else "Thu 2 Oct" (and the
    // year when it isn't this one).
    var WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function dayLabel(ms) {
        var d = new Date(ms), today = new Date(Date.now());
        function startOf(x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); }
        var diff = Math.round((startOf(d) - startOf(today)) / 86400000);
        if (diff === 0) { return 'today'; }
        if (diff === 1) { return 'tomorrow'; }
        if (diff === -1) { return 'yesterday'; }
        return WDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] +
            (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
    }

    /* Run an array of promise-returning fns with limited concurrency; never rejects.
       Returns Promise of array of {ok, value|error} in original order. */
    // A QR code for text (js/qrcode.js, qrcode-generator, MIT): { n, dark(row, col) }, or null.
    // level: error correction, 'M' unless given ('L': the simplest code, plenty for a screen)
    function qrModules(text, level) {
        if (typeof qrcode === 'undefined') { return null; }
        try {
            var qr = qrcode(0, level || 'M');
            qr.addData('' + text);
            qr.make();
            return { n: qr.getModuleCount(), dark: function (r, c) { return qr.isDark(r, c); } };
        } catch (e) { return null; }
    }
    // ...drawn on a canvas: dark squares on white with the quiet margin a scanner needs.
    // opts (optional): { level, quiet: border in squares (4), fit: about how many pixels across
    // (the squares sized to it, at least 2 px; then scale isn't needed) }
    function qrCanvas(text, scale, opts) {
        opts = opts || {};
        var m = qrModules(text, opts.level), quiet = opts.quiet != null ? opts.quiet : 4;
        if (!m) { return null; }
        scale = opts.fit ? qrScale(m.n, opts.fit, quiet) : (scale || 8);
        var cv = document.createElement('canvas'), g = cv.getContext ? cv.getContext('2d') : null;
        if (!g) { return null; }
        var size = (m.n + quiet * 2) * scale;
        cv.width = size; cv.height = size;
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
        g.fillStyle = '#000000';
        for (var r = 0; r < m.n; r++) {
            for (var c = 0; c < m.n; c++) { if (m.dark(r, c)) { g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale); } }
        }
        return cv;
    }
    function qrScale(n, fit, quiet) { return Math.max(2, Math.floor(fit / (n + quiet * 2))); }

    // A script of the app's own, loaded the first time it's needed (the QR library: only the
    // Trakt connect box uses it). Once: later asks share it.
    var _scripts = {};
    function loadScript(src) {
        if (_scripts[src]) { return _scripts[src]; }
        _scripts[src] = new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src;
            el.onload = function () { resolve(); };
            el.onerror = function () { delete _scripts[src]; reject(new Error('Could not load ' + src)); };
            (document.head || document.body).appendChild(el);
        });
        return _scripts[src];
    }

    // ---- startup timings (Settings › Diagnostics): ms from when the page started loading ----
    var T0 = (window.performance && window.performance.timing && window.performance.timing.navigationStart) || Date.now();
    // (each one once per launch; this launch's are kept for the next one to show as well)
    var STARTUP_KEY = 'stremiok.startup';
    var _marks = {}, _prevMarks = null;
    try { _prevMarks = JSON.parse(window.localStorage.getItem(STARTUP_KEY) || 'null'); } catch (e) {}
    if (!_prevMarks || typeof _prevMarks !== 'object') { _prevMarks = null; }
    function mark(name) {
        if (_marks[name] != null) { return; }
        _marks[name] = Math.max(0, Date.now() - T0);
        try { window.localStorage.setItem(STARTUP_KEY, JSON.stringify(_marks)); } catch (e) {}
    }
    function copyMarks(m) { var o = {}; for (var k in m) { if (Object.prototype.hasOwnProperty.call(m, k) && typeof m[k] === 'number') { o[k] = m[k]; } } return o; }
    function startupMarks(previous) { return previous ? (_prevMarks ? copyMarks(_prevMarks) : null) : copyMarks(_marks); }

    function settleAll(tasks, concurrency) {
        concurrency = concurrency || 4;
        return new Promise(function (resolve) {
            var results = new Array(tasks.length);
            var idx = 0, active = 0, finished = 0;
            if (tasks.length === 0) { resolve(results); return; }
            function launch() {
                while (active < concurrency && idx < tasks.length) {
                    (function (i) {
                        active++;
                        var p;   // (a task that throws, or returns no promise, settles all the same)
                        try { p = Promise.resolve(tasks[i]()); } catch (e0) { p = Promise.reject(e0); }
                        p.then(function (v) {
                            results[i] = { ok: true, value: v };
                        }, function (e) {
                            results[i] = { ok: false, error: e };
                        }).then(function () {
                            active--; finished++;
                            if (finished === tasks.length) { resolve(results); }
                            else { launch(); }
                        });
                    })(idx);
                    idx++;
                }
            }
            launch();
        });
    }

    return {
        byId: byId, el: el, clear: clear, moveIn: moveIn, getJSON: getJSON, getText: getText, redactUrl: redactUrl, problem: problem, problemDetail: problemDetail, listOf: listOf, lru: lru, cachedJSON: cachedJSON,
        parseUrl: parseUrl, urlProblem: urlProblem, isPlaylistUrl: isPlaylistUrl, isManifestUrl: isManifestUrl,
        isPrivateHost: isPrivateHost, urlIsPrivate: urlIsPrivate, setLocalPolicy: setLocalPolicy, sanitizeHeaders: sanitizeHeaders, drawable: drawable,
        log: log, logEntries: logEntries, clearLog: clearLog, bigStore: bigStore, diskInfo: diskInfo,
        store: store, toast: toast, spinner: spinner,
        deferImage: deferImage, deferBg: deferBg, cardImage: cardImage, prioritizeImages: prioritizeImages, requeueImages: requeueImages,
        fmtTime: fmtTime, dayLabel: dayLabel, settleAll: settleAll, cancelToken: cancelToken, isHidden: isHidden, whenVisible: whenVisible, crumb: crumb, sessionStart: sessionStart, sessionState: sessionState, mark: mark, startupMarks: startupMarks, loadScript: loadScript, qrModules: qrModules, qrCanvas: qrCanvas, qrScale: qrScale,
        applyTheme: applyTheme, accentColor: accentColor, ACCENT_KEYS: Object.keys(ACCENTS)
    };
})();
