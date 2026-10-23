"use strict";
/*
 * StremioK YouTube service: resolves a YouTube page (a live channel, a trailer, a video) to its
 * HLS master so StremioK plays it natively through AVPlay. Two endpoints:
 *   /health          -> "ok" (the app waits for this before playing)
 *   /yt?u=<page>     -> the HLS master; &h=<height> keeps one video rung, &fresh=1
 *                       resolves again instead of using the 4-minute cache, &lang=<code>
 *                       keeps that audio language (else the original)
 *   /ytlist?src=…    -> JSON: a YouTube search / channel / playlist page (StremioK's own
 *                       YouTube catalogs), &kind &sort &q &page &meta=1 &orig=1 (titles in
 *                       their own language): see ytList
 *   /ytsb?v=<id>     -> JSON { segments: [{ cat, action, start, end }], brand: { title, thumbAt } }:
 *                       SponsorBlock's marked sections and DeArrow's title / thumbnail
 *                       (sponsor.ajay.app, asked by a hash prefix: see sbVideo)
 *   /ytsubs?u=<page>&lang=<code>[&auto=1] -> the video's captions in that language as WebVTT
 *   Everything but /health answers StremioK only (this address, no Origin: callerProblem).
 *   The four USB ones (/fs…) also need its token (see fsAllowed) and have no CORS header;
 *   links aren't followed out of a drive (fsRealOk).
 *   /entry/open|poll|close -> the phone's one-time page on the home network (entryControl)
 *   /aiom/addons?base=<AIOManager address> (+ X-AIOM-Key: the account's API key) -> JSON
 *                       { addons: [{ url, name, enabled }] }: the account's addons (its Hydra
 *                       API), StremioK registered as a Pull app; StremioK only (entryAllowed)
 *   /epg/load?u=<guide>&k=<bitset>[&force=1] (or POSTed: the same in its body, as StremioK
 *                       asks) -> JSON { state, at, channels, programmes, partial,
 *                       error }: a playlist's TV guide (XMLTV) read for StremioK's channels
 *                       only; /epg/get?u=<guide>&ids=<key>|<key>&from&to[&max] -> JSON { <key>:
 *                       [[start, stop, title, desc, picture?, about?]], _icons: { <key>: logo } }: their programs and
 *                       the guide's logos for them (see epgControl)
 *   /epg/ticket -> JSON { ticket }: for guide POSTs from an app without the token (see hasTicket)
 *   /epg/files -> JSON { count, bytes }: the saved guides; /epg/clear (POST) -> { cleared }: deleted
 *   /live/open?u=<playlist>[&ua=&ref=&force=1] -> JSON { fix, sure, why, url }: is a live HLS
 *                       channel's AAC sound cut mid-frame (the TV's player stutters on it)?
 *                       If so, url: a relay that repacks it (/live/<id>/m|s?n=, see liveControl)
 *   /fsdl/add|list|cancel|clear|space -> downloads to a USB drive (dlControl), as the USB ones
 *   /fsfile?path=<file> -> a USB file, with Range (206): the 2017 TV's player can't read past
 *                       2 GB of a file straight from the drive (every jump stalls), so StremioK
 *                       plays one that big from here (LocalMedia.openUrl)
 *   /fslist?path=<dir> -> JSON { entries: [{ name, dir, size }], bad: [{ name, err }], total }:
 *                       a USB folder (under /opt/media/ only), each entry looked at on its own
 *                       (the app's own listing fails a whole folder over one it can't read)
 *   /fswalk?path=<dir> -> JSON { files: [{ p, size }], dirs, truncated }: the video and
 *                       subtitle files under a USB folder (relative paths; hidden ones left out)
 *   /fssub?path=<file> -> a subtitle file next to a video, as UTF-8 text (SRT / WebVTT as they
 *                       are; ASS / SSA as SRT; Windows-1252 and UTF-16 files converted)
 *   /fshash?path=<file> -> JSON { size, hash }: a video's OpenSubtitles hash (its size and the
 *                       first and last 64 KB), so subtitle addons can find ones made for it
 *   /ytinfo?u=<page> -> JSON { audio: [{ lang, name, original }], links: [{ kind, id, title,
 *                       teaser, startMs, endMs }], details, chapters: [{ t, title }] }: the
 *                       audio languages, the end screen and cards, the video, its chapters
 *
 * Runs two ways, from this one file:
 *   - the sideloaded .wgt: a bundled <tizen:service> (config.xml), on 127.0.0.1:8099
 *   - TizenBrew: package.json "serviceFile" — TizenBrew downloads this file and runs it
 *     inside its own Node service (a vm sandbox, no __filename), on 127.0.0.1:8098.
 *     Separate ports, so with both installed each app talks to its own copy.
 * Under TizenBrew an uncaught error would take down TizenBrew's service too, so every
 * request and callback here is fenced: a failure ends that one request, nothing more.
 *
 * Node core modules only (no bundling). ES5 only: the TV's Node is old (4.x on Tizen 3).
 */

var http = require('http');
var https = require('https');
var tls = require('tls');
var zlib = require('zlib');
var crypto = require('crypto');
var urllib = require('url');
var StringDecoder = require('string_decoder').StringDecoder;

var UNDER_TIZENBREW = typeof __filename === 'undefined';   // TizenBrew's sandbox has no module paths
var PORT = UNDER_TIZENBREW ? 8098 : 8099;
var TIMEOUT_MS = 15000;              // any single upstream request
var MAX_BODY = 8 * 1024 * 1024;      // a YouTube page is ~1-2 MB; anything far bigger is wrong
var CACHE_MAX = 50;                  // resolved pages kept

// The HLS master is fetched with a TV user-agent, as the TV's player would.
var TV_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36';

function log(msg) { try { console.log('[StremioK service] ' + msg); } catch (e) {} }
// Buffer.from arrived in Node 4.5; before that the name exists but is Uint8Array.from
// (inherited), which does something else entirely, so only a real one is used.
var HAS_BUFFER_FROM = typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from;
function toBuffer(s) { return HAS_BUFFER_FROM ? Buffer.from(s, 'utf8') : new Buffer(s, 'utf8'); }
function allocBuffer(n) { return typeof Buffer.alloc === 'function' ? Buffer.alloc(n) : new Buffer(n); }

// A callback that runs at most once, and never throws out to Node.
function once(cb) {
    var done = false;
    return function () {
        if (done) { return; }
        done = true;
        try { cb.apply(null, arguments); } catch (e) { log('callback error: ' + (e && e.message)); }
    };
}

// Unpacks gzip / deflate as a stream and stops at MAX_UNPACKED: a small compressed answer
// can't expand into gigabytes (the old Node here has no output limit of its own).
var MAX_UNPACKED = 10 * 1024 * 1024;
function decompress(buf, enc, cb, _raw) {
    cb = once(cb);
    enc = (enc || '').toLowerCase();
    if (enc !== 'gzip' && enc !== 'deflate') { cb(null, buf); return; }
    try {
        var z = enc === 'gzip' ? zlib.createGunzip() : (_raw ? zlib.createInflateRaw() : zlib.createInflate());
        var out = [], size = 0;
        z.on('data', function (c) {
            size += c.length;
            if (size > MAX_UNPACKED) { cb(new Error('unpacked answer too large')); try { z.removeAllListeners('data'); z.close(); } catch (e) {} return; }
            out.push(c);
        });
        z.on('end', function () { cb(null, Buffer.concat(out)); });
        z.on('error', function (e) {
            if (enc === 'deflate' && !_raw) { decompress(buf, enc, cb, true); return; }   // (raw deflate, no zlib header)
            cb(e);
        });
        z.end(buf);
    } catch (e) { cb(e); }
}

// Hosts each request may go to, redirects included (checked at every hop): YouTube for the
// page and its API, googlevideo for the HLS master. HTTPS only.
function youtubeHost(h) { return /(^|\.)youtube\.com$/i.test(h) || /^youtu\.be$/i.test(h); }
function videoHost(h) { return /(^|\.)googlevideo\.com$/i.test(h) || youtubeHost(h); }

// Minimal HTTPS request: cb(err, status, body as a string). Follows up to 4 redirects (a
// channel's /live URL redirects to /watch), each to a host `allow(host)` accepts; gives up
// after TIMEOUT_MS of silence or MAX_BODY bytes; an answer other than 200 is an error.
// Returns abort() (the hop under way, and no further one). Only through httpReq's gate.
// The body of an answer read straight off the connection: only when it's complete. Chunked:
// every chunk's size line, its bytes and their CRLF, up to the closing zero-size chunk; else its
// declared Content-Length, all of it. { body } or { error }.
function rawBody(hd, buf) {
    if (/chunked/i.test(hd['transfer-encoding'] || '')) {
        var out = [], pos = 0;
        for (;;) {
            var nl = buf.indexOf('\r\n', pos);
            if (nl === -1) { return { error: 'incomplete answer' }; }
            var line = buf.slice(pos, nl).toString('binary').split(';')[0].trim();
            if (!/^[0-9a-f]{1,8}$/i.test(line)) { return { error: 'malformed answer' }; }
            var n = parseInt(line, 16);
            if (n === 0) { return { body: Buffer.concat(out) }; }   // (the end: trailers, if any, not needed)
            if (nl + 2 + n + 2 > buf.length || buf[nl + 2 + n] !== 13 || buf[nl + 3 + n] !== 10) { return { error: 'incomplete answer' }; }
            out.push(buf.slice(nl + 2, nl + 2 + n));
            pos = nl + 2 + n + 2;
        }
    }
    if (hd['content-length'] !== undefined) {
        var len = +hd['content-length'];
        if (!(len >= 0) || buf.length < len) { return { error: 'incomplete answer' }; }
        return { body: buf.slice(0, len) };
    }
    return { body: buf };   // (no length: what came before the connection closed)
}
function rawReq(method, urlStr, headers, body, cb, allow, _n, _at) {
    cb = once(cb);
    var at = _at || {};
    var pu;
    try { pu = urllib.parse(urlStr); } catch (e) { cb(e); return; }
    if (pu.protocol !== 'https:') { cb(new Error('not https: ' + pu.protocol)); return; }
    if (!allow || !allow(pu.hostname || '')) { cb(new Error('host not allowed: ' + pu.hostname)); return; }
    if (at.aborted) { return; }
    var mod = pu.protocol === 'http:' ? http : https;
    var r;
    try {
        r = mod.request({
            hostname: pu.hostname, port: pu.port || (pu.protocol === 'http:' ? 80 : 443),
            path: pu.path, method: method, headers: headers || {},
            maxHeaderSize: 65536   // (YouTube's answers can bring 12 KB of headers; a newer Node reads 8 KB unless told: an older one ignores this)
        }, function (resp) {
            try {
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && (_n || 0) < 4) {
                    resp.resume();
                    rawReq(method, urllib.resolve(urlStr, resp.headers.location), headers, body, cb, allow, (_n || 0) + 1, at);   // (re-checked)
                    return;
                }
                if (sc !== 200) { resp.resume(); cb(new Error('HTTP ' + sc)); return; }
                var chunks = [], size = 0;
                resp.on('data', function (c) {
                    size += c.length;
                    if (size > MAX_BODY) { cb(new Error('response too large')); try { r.abort(); } catch (e) {} return; }
                    chunks.push(c);
                });
                resp.on('end', function () {
                    var raw = Buffer.concat(chunks);
                    decompress(raw, resp.headers['content-encoding'], function (e, buf) {
                        if (e) { cb(e); return; }
                        cb(null, sc, buf.toString('utf8'));
                    });
                });
                resp.on('error', function (e) { cb(e); });
            } catch (e) { cb(e); }
        });
        at.r = r;
        r.on('error', function (e) {
            // An answer with more headers than this Node reads ("Header overflow": YouTube's watch
            // page often brings an experiment's 7 KB header, 12 KB in all; a Tizen 6 TV's Node 12.4
            // reads 8 KB, and its maxHeaderSize option came later): a GET is read here instead
            // (bigHeaderGet: no limit of its own); anything else is asked again, twice at most.
            if (e && e.code === 'HPE_HEADER_OVERFLOW' && method === 'GET' && !body && !at.aborted && !at.bigHeaders) {
                at.bigHeaders = true;
                bigHeaderGet(urlStr, headers, cb, allow, at);
                return;
            }
            if (/Parse Error/i.test((e && e.message) || '') && (at.parseTries || 0) < 2 && !at.aborted) {
                at.parseTries = (at.parseTries || 0) + 1;
                rawReq(method, urlStr, headers, body, cb, allow, _n, at);
                return;
            }
            // (which parser error, on which Node, and from where: Diagnostics' log says)
            if (e && e.code && /^HPE_/.test(e.code) && String(e.message).indexOf(e.code) === -1) {
                e.message += ' (' + e.code + ', ' + pu.hostname + ', node ' + process.version + ')';
            }
            cb(e);
        });
        r.setTimeout(TIMEOUT_MS, function () { cb(new Error('timed out')); try { r.abort(); } catch (e) {} });
        if (body) { r.write(body); }
        r.end();
    } catch (e) { cb(e); }
    return function () { at.aborted = true; try { if (at.r) { at.r.abort(); } } catch (e) {} };
}

// A GET read straight off a TLS connection (rawReq's fallback for an answer whose headers this
// Node won't read): the status line and headers parsed here, redirects followed (to hosts
// allow() takes), a chunked body put back together; gzip isn't asked for. cb(err, status, text).
function bigHeaderGet(urlStr, headers, cb, allow, at, _n) {
    cb = once(cb);
    var pu;
    try { pu = urllib.parse(urlStr); } catch (e) { cb(e); return; }
    if (pu.protocol !== 'https:' || !allow || !allow(pu.hostname || '')) { cb(new Error('host not allowed: ' + pu.hostname)); return; }
    var lines = ['GET ' + (pu.path || '/') + ' HTTP/1.1', 'Host: ' + pu.host, 'Connection: close', 'Accept-Encoding: identity'];
    Object.keys(headers || {}).forEach(function (k) { if (!/^(host|connection|accept-encoding|content-length)$/i.test(k)) { lines.push(k + ': ' + String(headers[k]).replace(/[\r\n]/g, ' ')); } });
    var chunks = [], size = 0, done = false, sock;
    function end(err, sc, text) { if (done) { return; } done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} cb(err, sc, text); }
    var timer = setTimeout(function () { end(new Error('timed out')); }, TIMEOUT_MS);
    try {
        sock = tls.connect({ host: pu.hostname, port: +pu.port || 443, servername: pu.hostname }, function () { sock.write(lines.join('\r\n') + '\r\n\r\n'); });
    } catch (e) { end(e); return; }
    if (at) { at.r = { abort: function () { end(new Error('aborted')); } }; }
    sock.on('data', function (c) { chunks.push(c); size += c.length; if (size > MAX_BODY + 262144) { end(new Error('response too large')); } });
    sock.on('error', function (e) { end(e); });
    sock.on('close', function () {
        if (done) { return; }
        var all = Buffer.concat(chunks, size), at2 = all.indexOf('\r\n\r\n');
        if (at2 === -1) { end(new Error('no answer')); return; }
        var head = all.slice(0, at2).toString('binary').split('\r\n'), m = /^HTTP\/1\.[01] (\d{3})/.exec(head[0] || ''), hd = {};
        if (!m) { end(new Error('not an HTTP answer')); return; }
        head.slice(1).forEach(function (l) { var i = l.indexOf(':'); if (i > 0) { var k = l.slice(0, i).trim().toLowerCase(); hd[k] = hd[k] ? hd[k] + ', ' + l.slice(i + 1).trim() : l.slice(i + 1).trim(); } });
        var sc = +m[1], bodyBuf = all.slice(at2 + 4);
        if (sc >= 300 && sc < 400 && hd.location && (_n || 0) < 4) {
            done = true; clearTimeout(timer);
            bigHeaderGet(urllib.resolve(urlStr, hd.location), headers, cb, allow, at, (_n || 0) + 1);
            return;
        }
        var whole = rawBody(hd, bodyBuf);
        if (sc !== 200) { end(new Error('HTTP ' + sc)); return; }
        if (whole.error) { end(new Error(whole.error)); return; }
        bodyBuf = whole.body;
        if (bodyBuf.length > MAX_BODY) { end(new Error('response too large')); return; }
        end(null, sc, bodyBuf.toString('utf8'));
    });
}

// Every request the service makes to the internet goes through one gate: UP_ACTIVE at a
// time, UP_QUEUED waiting (more are told it's busy), UP_PER_MINUTE started a minute;
// identical GETs in progress share one download (UP_SHARED waiting on it at most); each is
// given UP_DEADLINE_MS from start to finish (TIMEOUT_MS above is silence only). Returns
// leave(): the one asking gave up (its request to the service closed), so its place in the
// queue goes, and a download nobody waits for any more is stopped.
var UP_ACTIVE = 6, UP_QUEUED = 40, UP_SHARED = 16, UP_PER_MINUTE = 600, UP_DEADLINE_MS = 30000;
var _upActive = 0, _upQueue = [], _upShared = {}, _upRecent = [];
function upError(msg, status) { return Object.assign(new Error(msg), { status: status }); }
function noop() {}
function httpReq(method, urlStr, headers, body, cb, allow) {
    var sub = { cb: once(cb), gone: false };
    var key = method === 'GET' && !body ? urlStr + '\n' + JSON.stringify(headers || {}) : null;
    var job = key ? _upShared[key] : null;
    if (job) {
        if (job.subs.length >= UP_SHARED) { sub.cb(upError('busy', 503)); return noop; }
        job.subs.push(sub);
        return upLeave(job, sub);
    }
    var now = Date.now();
    _upRecent = _upRecent.filter(function (t) { return now - t < 60000; });
    if (_upRecent.length >= UP_PER_MINUTE) { sub.cb(upError('too many requests, try again in a minute', 429)); return noop; }
    if (_upActive >= UP_ACTIVE && _upQueue.length >= UP_QUEUED) { sub.cb(upError('busy', 503)); return noop; }
    job = { key: key, subs: [sub], started: false, over: false, abort: null, finish: null };
    job.start = function () {
        job.started = true; _upActive++; _upRecent.push(Date.now());
        var deadline = setTimeout(function () { if (job.abort) { job.abort(); } finish(new Error('timed out')); }, UP_DEADLINE_MS);
        function finish(err, sc, text) {
            if (job.over) { return; }
            job.over = true; _upActive--; clearTimeout(deadline);
            if (key && _upShared[key] === job) { delete _upShared[key]; }
            job.subs.forEach(function (x) { if (!x.gone) { x.cb(err, sc, text); } });
            upPump();
        }
        job.finish = finish;
        var abort = rawReq(method, urlStr, headers, body, finish, allow);
        job.abort = typeof abort === 'function' ? abort : null;
    };
    if (key) { _upShared[key] = job; }
    if (_upActive < UP_ACTIVE) { job.start(); } else { _upQueue.push(job); }
    return upLeave(job, sub);
}
function upPump() { while (_upActive < UP_ACTIVE && _upQueue.length) { _upQueue.shift().start(); } }
function upLeave(job, sub) {
    return function () {
        if (sub.gone || job.over) { return; }
        sub.gone = true;
        if (job.subs.some(function (x) { return !x.gone; })) { return; }
        if (!job.started) {
            var i = _upQueue.indexOf(job);
            if (i !== -1) { _upQueue.splice(i, 1); }
            job.over = true;
            if (job.key && _upShared[job.key] === job) { delete _upShared[job.key]; }
            return;
        }
        if (job.abort) { job.abort(); }
        job.finish(upError('nobody waiting', 499));
    };
}

// ---- YouTube page -> HLS master ----
// Asks YouTube's InnerTube player API as the "visionOS" client, with the page's
// visitorData: for live streams it answers with hlsManifestUrl, with no PO token and no
// signature work, so it's doable in plain Node. The TV's player then fetches the master's
// variants and segments straight from googlevideo; the same device resolved and plays, so
// the IP-bound URLs match.
var VISIONOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
var _ytCache = {};   // page -> { master, links, exp }

function cacheSet(page, master, links) {
    var now = Date.now(), keys = Object.keys(_ytCache);
    keys.forEach(function (k) { if (_ytCache[k].exp <= now) { delete _ytCache[k]; } });
    keys = Object.keys(_ytCache);
    if (keys.length >= CACHE_MAX) {
        keys.sort(function (a, b) { return _ytCache[a].exp - _ytCache[b].exp; });
        keys.slice(0, keys.length - CACHE_MAX + 1).forEach(function (k) { delete _ytCache[k]; });
    }
    _ytCache[page] = { master: master, links: links || [], exp: now + 240000 };   // 4 min
}

// A YouTube channel's other pages to try for its live stream (@handle, /channel/, /c/, /user/,
// on any tab): its /live, then its Featured tab, leaving out the one given. A video's link: none.
function ytLivePages(u) {
    var m = /^(https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[^\/?#]+|(?:channel|c|user)\/[^\/?#]+))(\/[^?#]*)?(?:[?#].*)?$/i.exec(String(u || ''));
    if (!m) { return []; }
    var tab = (m[2] || '').replace(/\/+$/, '').toLowerCase();
    return ['/live', '/featured'].filter(function (t) { return t !== tab; }).map(function (t) { return m[1] + t; });
}
// The page as given first; with no live stream there, the channel's others in turn (ytLivePages).
// Which one leads to the stream on now varies: a channel's /live can point at one that isn't on
// while its Featured tab leads with the live one, or the other way round.
function resolveYtLive(page, fresh, cb) {
    var tries = [page].concat(ytLivePages(page)), first = null;
    (function next(i) {
        resolveYtMaster(tries[i], fresh, function (err, master, links) {
            if (!err) { cb(null, master, links); return; }
            first = first || err;
            if (i + 1 < tries.length) { next(i + 1); } else { cb(first); }
        });
    })(0);
}
function resolveYtMaster(ytPage, fresh, cb) {
    cb = once(cb);
    var hit = _ytCache[ytPage];
    if (!fresh && hit && Date.now() < hit.exp) { cb(null, hit.master, hit.links); return; }
    httpReq('GET', ytPage, { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en,es' }, null, function (err, sc, html) {
        if (err || !html) { cb(err || new Error('page fetch failed')); return; }
        var vid = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
        if (!vid) { cb(new Error('no videoId on page')); return; }
        var vd = html.match(/"visitorData":"([^"]+)"/);
        var links = [];
        try { links = pageLinks(html); } catch (eL) { links = []; }   // (the video plays without them)
        try { links.details = pageDetails(html); } catch (eD) {}
        try { links.chapters = pageChapters(html); } catch (eC) {}
        var payload = JSON.stringify({
            videoId: vid[1],
            context: { client: {
                clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple',
                deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471',
                hl: 'en', gl: 'US', visitorData: vd ? vd[1] : ''
            } },
            contentCheckOk: true, racyCheckOk: true
        });
        httpReq('POST', 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '101', 'X-YouTube-Client-Version': '1.02',
            'User-Agent': VISIONOS_UA, 'Content-Length': Buffer.byteLength(payload)
        }, payload, function (e2, sc2, resp) {
            if (e2 || !resp) { cb(e2 || new Error('player call failed')); return; }
            var m = resp.match(/"hlsManifestUrl":"([^"]+)"/);
            if (!m) { cb(new Error('no hlsManifestUrl (not live / blocked?)')); return; }
            var master;
            try { master = JSON.parse('"' + m[1] + '"'); }          // decode &, \/ etc.
            catch (e3) { master = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'); }
            try { links.captions = captionTracks(JSON.parse(resp)); } catch (eC) { links.captions = []; }
            cacheSet(ytPage, master, links);
            cb(null, master, links);
        }, youtubeHost);
    }, youtubeHost);
}

// Lookups are limited: identical ones in progress share one; at most MAX_ACTIVE run at a
// time, MAX_QUEUED wait, and MAX_PER_MINUTE fresh ones (cache hits don't count). Any page
// on the TV can reach this port; this keeps one from making the TV hammer YouTube. Returns
// leave(): the one asking gave up; a lookup nobody waits for that hasn't started is dropped
// (one under way finishes: it's kept for the next ask).
var MAX_ACTIVE = 2, MAX_QUEUED = 6, MAX_PER_MINUTE = 30;
var _active = 0, _queue = [], _inflight = {}, _recent = [];
function limitedResolve(page, fresh, cb) {
    var hit = _ytCache[page];
    if (!fresh && hit && Date.now() < hit.exp) { cb(null, hit.master, hit.links); return noop; }
    var key = page + (fresh ? '#fresh' : '');
    function leave() {
        var w = _inflight[key], i = w ? w.indexOf(cb) : -1;
        if (i === -1) { return; }
        w.splice(i, 1);
        var q = w.run ? _queue.indexOf(w.run) : -1;
        if (!w.length && q !== -1) { _queue.splice(q, 1); delete _inflight[key]; }
    }
    if (_inflight[key]) { _inflight[key].push(cb); return leave; }
    var now = Date.now();
    _recent = _recent.filter(function (t) { return now - t < 60000; });
    if (_recent.length >= MAX_PER_MINUTE) { cb(Object.assign(new Error('too many lookups, try again in a minute'), { status: 429 })); return noop; }
    if (_active >= MAX_ACTIVE && _queue.length >= MAX_QUEUED) { cb(Object.assign(new Error('busy'), { status: 503 })); return noop; }
    _inflight[key] = [cb];
    function run() {
        _active++; _recent.push(Date.now());
        resolveYtLive(page, fresh, function (err, master, links) {
            _active--;
            var waiting = _inflight[key] || [];
            delete _inflight[key];
            waiting.forEach(function (w) { try { w(err, master, links); } catch (e) {} });
            var next = _queue.shift();
            if (next) { next(); }
        });
    }
    if (_active < MAX_ACTIVE) { run(); } else { _inflight[key].run = run; _queue.push(run); }
    return leave;
}

// Reduce an HLS master to one video rung (by height), keeping the audio renditions and
// headers: the player gets an exact quality without relying on AVPlay's bitrate capping.
function filterMaster(text, h) {
    if (!h) { return text; }
    var lines = text.split(/\r?\n/), out = [], i = 0, kept = false;
    while (i < lines.length) {
        var ln = lines[i];
        if (ln.indexOf('#EXT-X-STREAM-INF') === 0) {
            var m = ln.match(/RESOLUTION=\d+x(\d+)/);
            var uri = (i + 1 < lines.length) ? lines[i + 1] : '';
            if (m && parseInt(m[1], 10) === h) { out.push(ln); out.push(uri); kept = true; }
            i += 2; continue;
        }
        out.push(ln); i++;
    }
    if (kept) { return out.join('\n'); }
    // none that tall (a wider picture: a 2:1 trailer's 1080p is 1920×960): the tallest below it
    var below = 0;
    text.replace(/RESOLUTION=\d+x(\d+)/g, function (all, y) { y = +y; if (y < h && y > below) { below = y; } return all; });
    return below ? filterMaster(text, below) : text;   // (nothing below either: the full master)
}

// YouTube now adds AI-dubbed audio to many videos: the master lists every language as an
// audio rendition ("American English - original", "Deutsch (Deutschland) - dubbed-auto",
// …), none marked default, a dub often first. AVPlay may start on a dub, and switching
// tracks on such a stream right after it starts hangs the 2017 TV's player (sound gone,
// picture frozen, the app waiting on it). So only the original is kept, as the default:
// one track, nothing to switch. A master with no track marked original is left as it is.
// lang (from the app's Audio language menu, "es", "pt-BR"…): that dub instead, where the
// video has it (same language: "es" is "es-US"); the original where it doesn't.
function isAudioLine(ln) { return ln.indexOf('#EXT-X-MEDIA:') === 0 && /(^|[:,])TYPE=AUDIO(,|$)/.test(ln); }
function isOriginalAudio(ln) { return /NAME="[^"]*\boriginal\b[^"]*"/i.test(ln); }
function attr(ln, name) { var m = ln.match(new RegExp('(?:^|[:,])' + name + '="([^"]*)"')); return m ? m[1] : ''; }
function sameLang(a, b) {
    a = ('' + a).toLowerCase(); b = ('' + b).toLowerCase();
    return !!a && !!b && (a === b || a.split('-')[0] === b.split('-')[0]);
}
function keepOriginalAudio(text, lang) {
    var lines = text.split(/\r?\n/), keep = {}, i, g, ln;
    // per audio group, the one to keep: the language asked for (exact first), else the original
    for (i = 0; i < lines.length; i++) {
        ln = lines[i];
        if (!isAudioLine(ln)) { continue; }
        g = attr(ln, 'GROUP-ID');
        var k = keep[g] || {}, l = attr(ln, 'LANGUAGE');
        if (lang && l.toLowerCase() === ('' + lang).toLowerCase()) { k.exact = i; }
        else if (lang && sameLang(l, lang) && k.near === undefined) { k.near = i; }
        if (isOriginalAudio(ln)) { k.original = i; }
        keep[g] = k;
    }
    var out = [], changed = false;
    for (i = 0; i < lines.length; i++) {
        ln = lines[i];
        if (isAudioLine(ln)) {
            var kk = keep[attr(ln, 'GROUP-ID')];
            var pick = kk.exact !== undefined ? kk.exact : kk.near !== undefined ? kk.near : kk.original;
            if (pick !== undefined) {
                if (pick !== i) { changed = true; continue; }   // another language: left out
                ln = ln.replace(/DEFAULT=NO/, 'DEFAULT=YES');
            }
        }
        out.push(ln);
    }
    return changed ? out.join('\n') : text;
}
// The video's audio languages, for the app's menu: [{ lang, name, original }] (each once).
function audioLanguages(text) {
    var seen = {}, out = [];
    text.split(/\r?\n/).forEach(function (ln) {
        if (!isAudioLine(ln)) { return; }
        var l = attr(ln, 'LANGUAGE');
        if (!l || seen[l]) { return; }
        seen[l] = true;
        out.push({ lang: l.slice(0, 20), name: attr(ln, 'NAME').slice(0, 80), original: isOriginalAudio(ln) });
    });
    return out.slice(0, 40);
}

// The video's end screen and cards, from the page (its ytInitialPlayerResponse): the links
// to other videos, with when they're on screen. [{ kind: 'end' | 'card', id, title, teaser,
// startMs, endMs }]. Only video links (channels, playlists and websites have nowhere to go
// in the app). Read with a bracket scan, not by parsing the whole page's JSON.
function objectAfter(text, key, from, to) {
    var at = text.indexOf(key, from);
    if (at === -1 || at > to) { return null; }
    var i = text.indexOf('{', at), depth = 0, inStr = false, esc = false;
    if (i === -1) { return null; }
    for (var j = i; j < text.length && j < i + 2000000; j++) {
        var ch = text.charAt(j);
        if (inStr) { if (esc) { esc = false; } else if (ch === '\\') { esc = true; } else if (ch === '"') { inStr = false; } continue; }
        if (ch === '"') { inStr = true; } else if (ch === '{') { depth++; } else if (ch === '}') { depth--; if (depth === 0) { return JSON.parse(text.slice(i, j + 1)); } }
    }
    return null;
}
function textOf(t) {
    if (!t) { return ''; }
    if (typeof t.simpleText === 'string') { return t.simpleText; }
    return (t.runs || []).map(function (r) { return r && r.text || ''; }).join('');
}
var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// The video's title, channel, length and description (for a page about it).
function pageDetails(html) {
    var from = html.indexOf('ytInitialPlayerResponse');
    if (from === -1) { return null; }
    var to = html.indexOf('ytInitialData', from);
    var d = objectAfter(html, '"videoDetails":', from, to === -1 ? html.length : to);
    if (!d || !VIDEO_ID.test(d.videoId || '')) { return null; }
    return { id: d.videoId, title: ('' + (d.title || '')).slice(0, 300), by: ('' + (d.author || '')).slice(0, 120), channelId: d.channelId || '',
        description: ('' + (d.shortDescription || '')).slice(0, 2000), seconds: +d.lengthSeconds || 0, live: !!d.isLiveContent };
}
function pageLinks(html) {
    var from = html.indexOf('ytInitialPlayerResponse');
    if (from === -1) { return []; }
    var to = html.indexOf('ytInitialData', from);
    if (to === -1) { to = html.length; }
    var out = [];
    var end = objectAfter(html, '"endscreen":', from, to);
    ((end && end.endscreenRenderer && end.endscreenRenderer.elements) || []).forEach(function (e) {
        var r = e && e.endscreenElementRenderer, ep = r && r.endpoint && r.endpoint.watchEndpoint;
        if (!r || r.style !== 'VIDEO' || !ep || !VIDEO_ID.test(ep.videoId || '')) { return; }
        out.push({ kind: 'end', id: ep.videoId, title: textOf(r.title).slice(0, 200), startMs: +r.startMs || 0, endMs: +r.endMs || 0 });
    });
    var cards = objectAfter(html, '"cards":', from, to);
    ((cards && cards.cardCollectionRenderer && cards.cardCollectionRenderer.cards) || []).forEach(function (c) {
        var r = c && c.cardRenderer, v = r && r.content && r.content.videoInfoCardContentRenderer;
        var ep = v && v.action && v.action.watchEndpoint, cue = (r && r.cueRanges && r.cueRanges[0]) || {};
        if (!v || !ep || !VIDEO_ID.test(ep.videoId || '')) { return; }
        var teaser = r.teaser && r.teaser.simpleCardTeaserRenderer && textOf(r.teaser.simpleCardTeaserRenderer.message);
        out.push({ kind: 'card', id: ep.videoId, title: textOf(v.videoTitle).slice(0, 200), teaser: (teaser || '').slice(0, 200),
            startMs: +cue.startCardActiveMs || 0, endMs: +cue.endCardActiveMs || 0 });
    });
    return out.slice(0, 16);
}

// The video's chapters, as on YouTube's progress bar: [{ t: <start, seconds>, title }],
// in order, from the page's ytInitialData (its player bar's markers). The uploader's (from
// the description) when there are, else YouTube's automatic ones; [] when neither.
function pageChapters(html) {
    var from = html.indexOf('ytInitialData');
    if (from === -1) { return []; }
    var bar = objectAfter(html, '"multiMarkersPlayerBarRenderer":', from, html.length);
    var byKey = {};
    ((bar && bar.markersMap) || []).forEach(function (m) {
        if (m && m.value && m.value.chapters) { byKey[m.key] = m.value.chapters; }
    });
    var list = byKey.DESCRIPTION_CHAPTERS || byKey.AUTO_CHAPTERS || [], out = [], last = -1;
    list.forEach(function (c) {
        var r = c && c.chapterRenderer, t = r ? Math.floor((+r.timeRangeStartMillis || 0) / 1000) : -1;
        if (!r || !(t >= 0) || t <= last) { return; }   // (in order, each once)
        last = t;
        out.push({ t: t, title: textOf(r.title).slice(0, 120) });
    });
    return out.length > 1 ? out.slice(0, 200) : [];
}

// The video's captions, from the player answer: [{ lang, name, auto, url }] (the url, YouTube's
// timedtext link, stays here: the app asks /ytsubs for a track by its language).
function captionTracks(j) {
    var r = j && j.captions && j.captions.playerCaptionsTracklistRenderer, out = [];
    ((r && r.captionTracks) || []).forEach(function (t) {
        if (!t || typeof t.baseUrl !== 'string' || !/^https:\/\/www\.youtube\.com\/api\/timedtext\?/.test(t.baseUrl)) { return; }
        var lang = ('' + (t.languageCode || '')).slice(0, 20);
        if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,2}$/.test(lang)) { return; }
        out.push({ lang: lang, name: textOf(t.name).slice(0, 80), auto: t.kind === 'asr', url: t.baseUrl });
    });
    return out.slice(0, 60);
}
function decodeEntities(t) {
    return t.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos);/gi, function (all, e) {
        var low = e.toLowerCase();
        if (low.charAt(0) === '#') { var n = low.charAt(1) === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCharCode(n > 0xffff ? 0xfffd : n) : ''; }
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[low];
    });
}
function vttTime(sec) {
    var ms = Math.max(0, Math.round(sec * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(h) + ':' + two(m) + ':' + two(s) + '.' + ('00' + (ms % 1000)).slice(-3);
}
// YouTube's caption file (its "srv1" form: <text start dur>…</text>) as WebVTT. Automatic
// captions roll (each line stays up while the next comes): each ends when the next starts,
// one line at a time.
// Tags taken out, a stray < with them: one pass, in time with the text's length however it's
// made (a run of < with no > after it used to take seconds); nothing left can start a tag.
function noTags(t) {
    var out = '', i = 0, n = t.length;
    while (i < n) {
        var lt = t.indexOf('<', i);
        if (lt === -1) { out += t.slice(i); break; }
        out += t.slice(i, lt);
        var gt = t.indexOf('>', lt + 1);
        if (gt === -1) { out += t.slice(lt + 1).split('<').join(''); break; }   // (no tag ends after it: the rest, its < gone)
        i = gt + 1;
    }
    return out;
}
function srv1ToVtt(xml, auto) {
    var cues = [], re = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g, m;
    while ((m = re.exec(xml)) && cues.length < 20000) {
        var text = noTags(decodeEntities(decodeEntities(m[3]))).replace(/\r/g, '').trim();   // (YouTube escapes them twice)
        if (!text) { continue; }
        var st = +m[1], en = st + (+m[2] || 2);
        cues.push({ st: st, en: en, text: text });
    }
    var out = ['WEBVTT', ''];
    cues.forEach(function (c, i) {
        var next = cues[i + 1], en = c.en;
        if (auto && next && next.st < en) { en = next.st; }
        if (en <= c.st) { en = c.st + 0.5; }
        out.push(vttTime(c.st) + ' --> ' + vttTime(en), c.text.replace(/--!?>/g, '->'), '');
    });
    return out.join('\n');
}

// ---- YouTube lists: searches, channels, playlists (StremioK's own YouTube catalogs) ----
// YouTube's InnerTube API as its web client (no key, no sign-in): a search, a channel's
// videos, a playlist, and their next pages. Asked from the TV, so YouTube sees a home
// connection, not a shared server. /ytlist answers JSON:
//   { items: [{ kind: 'video' | 'channel' | 'playlist', id, title, thumb, by, length, ago, views }],
//     next: '<token for the next page>' | '', head: { title, description, thumb } (with &meta=1) }
var WEB_CLIENT = { clientName: 'WEB', clientVersion: '2.20260901.00.00', hl: 'en', gl: 'US' };
var VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';   // a channel's Videos tab, newest first
// search filters: what (videos / channels / everything) x order
var SEARCH_SP = {
    videos: { relevance: 'EgIQAQ%3D%3D', date: 'CAISAhAB', views: 'CAMSAhAB', rating: 'CAESAhAB' },
    channels: { relevance: 'EgIQAg%3D%3D', date: 'CAISAhAC', views: 'CAMSAhAC', rating: 'CAESAhAC' },
    auto: { relevance: '', date: 'CAI%3D', views: 'CAM%3D', rating: 'CAE%3D' },
    live: { relevance: 'EgJAAQ%3D%3D', date: 'CAISAkAB', views: 'CAMSAkAB', rating: 'CAESAkAB' }
};
var LIVE_TAB = 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D';   // a channel's Live tab (its streams, live now first)
var LIST_MAX_PER_MINUTE = 60, LIST_CACHE_MAX = 60, LIST_TTL_MS = 10 * 60 * 1000;
var _listCache = {}, _listRecent = [];

function innertube(endpoint, body, cb, hl) {
    body.context = { client: hl ? { clientName: WEB_CLIENT.clientName, clientVersion: WEB_CLIENT.clientVersion, hl: hl, gl: WEB_CLIENT.gl } : WEB_CLIENT };
    var payload = JSON.stringify(body);
    httpReq('POST', 'https://www.youtube.com/youtubei/v1/' + endpoint + '?prettyPrint=false', {
        'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Content-Length': Buffer.byteLength(payload)
    }, payload, function (err, sc, text) {
        if (err || !text) { cb(err || new Error('no answer')); return; }
        var j;
        try { j = JSON.parse(text); } catch (e) { cb(new Error('not JSON')); return; }
        cb(null, j);
    }, youtubeHost);
}

// What a source names: { type: 'channel', id: 'UC…' | handle: '@x' | url } | { type:
// 'playlist', id } | { type: 'search', q } | null. Takes an @handle, a channel / playlist ID,
// a youtube.com link (/@x, /channel/UC…, /c/x, /user/x, ?list=…), or "search:words".
function classify(src) {
    src = ('' + (src || '')).trim();
    var m;
    if (/^search:/i.test(src)) { return { type: 'search', q: src.slice(7).trim() }; }
    if ((m = src.match(/[?&]list=([A-Za-z0-9_-]{10,64})/))) { return { type: 'playlist', id: m[1] }; }
    if (/^(PL|UU|OL|FL|RD)[A-Za-z0-9_-]{10,64}$/.test(src)) { return { type: 'playlist', id: src }; }
    if ((m = src.match(/(?:^|\/channel\/)(UC[A-Za-z0-9_-]{22})(?:[\/?#]|$)/))) { return { type: 'channel', id: m[1] }; }
    if ((m = src.match(/(?:^|youtube\.com\/)(@[A-Za-z0-9._-]{2,64})/))) { return { type: 'channel', url: 'https://www.youtube.com/' + m[1] }; }
    if ((m = src.match(/youtube\.com\/((?:c|user)\/[A-Za-z0-9._-]{1,100})/))) { return { type: 'channel', url: 'https://www.youtube.com/' + m[1] }; }
    return src ? { type: 'search', q: src } : null;
}

function textOf2(t) {
    if (!t) { return ''; }
    if (typeof t === 'string') { return t; }
    if (typeof t.content === 'string') { return t.content; }
    return textOf(t);
}
function bigThumb(list) {   // the largest no wider than 720 (a TV card or page), else the first
    var best = null;
    (list || []).forEach(function (t) { if (t && t.url && (t.width || 0) <= 720 && (!best || (t.width || 0) > (best.width || 0))) { best = t; } });
    best = best || (list && list[0]);
    if (!best || !best.url) { return ''; }
    return /^\/\//.test(best.url) ? 'https:' + best.url : best.url;
}
function videoThumb(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }   // 320×180
// Every video / channel / playlist in an answer, in order (shorts left out: vertical, made
// for phones), and the next page's token: the list's own "more" entry
// (continuationItemRenderer / -ViewModel) after the most items, not a filter chip's.
function listItems(j) {
    var items = [], seen = {}, next = '', nextAt = -1;
    function add(it) { if (it.id && !seen[it.kind + it.id]) { seen[it.kind + it.id] = true; items.push(it); } }
    function walk(o, depth) {
        if (!o || typeof o !== 'object' || depth > 60) { return; }
        if (o.reelItemRenderer || o.shortsLockupViewModel) { return; }
        var v = o.videoRenderer || o.gridVideoRenderer || o.playlistVideoRenderer || o.compactVideoRenderer;
        if (v && VIDEO_ID.test(v.videoId || '')) {
            var it = { kind: 'video', id: v.videoId, title: textOf(v.title).slice(0, 300), thumb: videoThumb(v.videoId),
                by: textOf(v.ownerText || v.shortBylineText || v.longBylineText).slice(0, 120), length: textOf(v.lengthText),
                ago: textOf(v.publishedTimeText), views: textOf(v.shortViewCountText || v.viewCountText) };
            if (/BADGE_STYLE_TYPE_LIVE_NOW/.test(JSON.stringify(v.badges || [])) || /"style":"LIVE"/.test(JSON.stringify(v.thumbnailOverlays || []))) { it.live = true; }
            add(it);
            return;
        }
        var c = o.channelRenderer;
        if (c && /^UC[A-Za-z0-9_-]{22}$/.test(c.channelId || '')) {
            add({ kind: 'channel', id: c.channelId, title: textOf(c.title).slice(0, 200), thumb: bigThumb(c.thumbnail && c.thumbnail.thumbnails),
                by: textOf(c.subscriberCountText || c.videoCountText), description: textOf(c.descriptionSnippet).slice(0, 400) });
            return;
        }
        var pl = o.playlistRenderer;
        if (pl && pl.playlistId) {
            add({ kind: 'playlist', id: pl.playlistId, title: textOf(pl.title).slice(0, 200), thumb: bigThumb(pl.thumbnails && pl.thumbnails[0] && pl.thumbnails[0].thumbnails),
                by: textOf(pl.shortBylineText || pl.longBylineText), views: textOf(pl.videoCountText) });
            return;
        }
        var l = o.lockupViewModel;
        if (l && l.contentId) {
            var md = l.metadata && l.metadata.lockupMetadataViewModel, parts = [], len = '';
            ((md && md.metadata && md.metadata.contentMetadataViewModel && md.metadata.contentMetadataViewModel.metadataRows) || []).forEach(function (r) {
                (r.metadataParts || []).forEach(function (p) { var t = textOf2(p.text); if (t) { parts.push(t); } });
            });
            JSON.stringify(l.contentImage || {}).replace(/"(?:text|content)":"(\d{1,2}(?::\d{2}){1,2})"/, function (all, t) { len = t; return all; });
            var ago = '', views = '', by = '';
            parts.forEach(function (t) { if (/\bago$/.test(t)) { ago = t; } else if (/views?$|watching$/.test(t)) { views = t; } else if (!by) { by = t; } });
            if (l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && VIDEO_ID.test(l.contentId)) {
                var lv = { kind: 'video', id: l.contentId, title: textOf2(md && md.title).slice(0, 300), thumb: videoThumb(l.contentId), by: by, length: len, ago: ago, views: views };
                if (/THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"/.test(JSON.stringify(l.contentImage || {}))) { lv.live = true; }
                add(lv);
            } else if (l.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
                var img = l.contentImage && (l.contentImage.collectionThumbnailViewModel || l.contentImage.thumbnailViewModel);
                img = img && (img.primaryThumbnail ? img.primaryThumbnail.thumbnailViewModel : img);
                add({ kind: 'playlist', id: l.contentId, title: textOf2(md && md.title).slice(0, 200), thumb: bigThumb(img && img.image && img.image.sources), by: by });
            }
            return;
        }
        var more = o.continuationItemRenderer || o.continuationItemViewModel;
        if (more) {
            var tok = '';
            JSON.stringify(more).replace(/"continuationCommand":\{"token":"([^"]+)"/, function (all, t) { tok = t; return all; });
            if (tok && items.length > nextAt) { next = tok; nextAt = items.length; }   // (a tie: the first, the list's own)
            return;
        }
        for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { walk(o[k], depth + 1); } }
    }
    walk(j, 0);
    return { items: items, next: next };
}
// A channel's or playlist's name, description and picture, from its first page.
function listHead(j) {
    var cm = j && j.metadata && j.metadata.channelMetadataRenderer, pm = j && j.metadata && j.metadata.playlistMetadataRenderer;
    if (cm) { return { title: cm.title || '', description: (cm.description || '').slice(0, 2000), thumb: bigThumb(cm.avatar && cm.avatar.thumbnails) }; }
    if (pm) { return { title: pm.title || '', description: (pm.description || '').slice(0, 2000), thumb: '' }; }
    return null;
}

// One page: a source's first (src, kind, sort, q for a search catalog's words), or the
// next (page = a token from the last answer, "s:…" a search's, "b:…" a channel's /
// playlist's). meta: a channel / playlist with its name and up to 4 pages of videos.
// Titles in their own language (&orig=1): YouTube puts translated titles (the creator's, or
// its machine translation) in its answers in the language it's asked in, and gives no other.
// Asked again in a language it doesn't translate titles into, the same list comes back with
// the original titles; only those are taken from it (dates, views and the next page stay as
// the English answer has them, for reading them). If that second answer fails, English titles.
var ORIG_HL = 'zu';
function ytList(o, cb) {
    cb = once(cb);
    // innertube(), then (orig) the titles from the same request in ORIG_HL: cb(err, j, titles)
    function ask(endpoint, body, done) {
        var again = JSON.stringify(body);
        innertube(endpoint, body, function (err, j) {
            if (err || !o.orig) { done(err, j, null); return; }
            innertube(endpoint, JSON.parse(again), function (e2, j2) {
                var t = null;
                if (!e2) { t = {}; listItems(j2).items.forEach(function (i) { if (i.title) { t[i.kind + i.id] = i.title; } }); }
                done(null, j, t);
            }, ORIG_HL);
        });
    }
    function titled(r, t) {
        if (t) { r.items.forEach(function (i) { if (t[i.kind + i.id]) { i.title = t[i.kind + i.id]; } }); }
        return r;
    }
    if (o.page) {
        var ep = o.page.charAt(0) === 's' ? 'search' : 'browse';
        ask(ep, { continuation: o.page.slice(2) }, function (err, j, t) {
            if (err) { cb(err); return; }
            var r = titled(listItems(j), t);
            cb(null, { items: r.items, next: r.next ? ep.charAt(0) + ':' + r.next : '' });
        });
        return;
    }
    var what = classify(o.src);
    if (!what) { cb(new Error('no source')); return; }
    if (what.type === 'search') {
        var q = (what.q || '').replace(/\{term\}/g, o.q || '').trim() || o.q || '';
        if (!q) { cb(null, { items: [], next: '' }); return; }
        var sp = (SEARCH_SP[o.kind] || SEARCH_SP.auto)[o.sort] || (SEARCH_SP[o.kind] || SEARCH_SP.auto).relevance;
        var body = { query: q.slice(0, 200) };
        if (sp) { body.params = decodeURIComponent(sp); }
        ask('search', body, function (err, j, t) {
            if (err) { cb(err); return; }
            var r = titled(listItems(j), t);
            if (o.kind === 'videos') { r.items = r.items.filter(function (i) { return i.kind === 'video'; }); }
            if (o.kind === 'channels') { r.items = r.items.filter(function (i) { return i.kind === 'channel'; }); }
            if (o.kind === 'live') { r.items = r.items.filter(function (i) { return i.kind === 'video' && i.live; }); }
            cb(null, { items: r.items, next: r.next ? 's:' + r.next : '' });
        });
        return;
    }
    // A channel's page (meta): also what it's streaming now, from its Live tab, first.
    function withLive(channelId, v) {
        if (!o.meta || !channelId) { cb(null, v); return; }
        ask('browse', { browseId: channelId, params: decodeURIComponent(LIVE_TAB) }, function (e3, j3, t3) {
            if (!e3) { v.live = titled(listItems(j3), t3).items.filter(function (i) { return i.kind === 'video' && i.live; }).slice(0, 10); }
            cb(null, v);
        });
    }
    function browse(browseId, params) {
        var body = { browseId: browseId };
        if (params) { body.params = params; }
        if (o.kind === 'live' && /^UC/.test(browseId)) { body.params = decodeURIComponent(LIVE_TAB); }   // (a channel's streams: the live ones)
        ask('browse', body, function (err, j, t) {
            if (err) { cb(err); return; }
            var r = titled(listItems(j), t), head = o.meta ? listHead(j) : null, pages = 1;
            if (o.kind === 'live' && /^UC/.test(browseId)) { cb(null, { items: r.items.filter(function (i) { return i.kind === 'video' && i.live; }), next: '' }); return; }
            (function more(token) {   // (with meta: a few pages, enough for a series' episodes)
                if (!o.meta || !token || pages >= 4 || r.items.length >= 120) { withLive(/^UC/.test(browseId) ? browseId : '', { items: r.items, next: token ? 'b:' + token : '', head: head }); return; }
                pages++;
                ask('browse', { continuation: token }, function (e2, j2, t2) {
                    if (e2) { withLive(/^UC/.test(browseId) ? browseId : '', { items: r.items, next: 'b:' + token, head: head }); return; }
                    var r2 = titled(listItems(j2), t2), seen = {};
                    r.items.forEach(function (i) { seen[i.kind + i.id] = true; });
                    r2.items.forEach(function (i) { if (!seen[i.kind + i.id]) { r.items.push(i); } });
                    more(r2.next);
                });
            })(r.next);
        });
    }
    if (what.type === 'playlist') { browse('VL' + what.id); return; }
    if (what.id) { browse(what.id, VIDEOS_TAB); return; }
    innertube('navigation/resolve_url', { url: what.url }, function (err, j) {   // @handle, /c/, /user/ -> UC…
        var id = j && j.endpoint && j.endpoint.browseEndpoint && j.endpoint.browseEndpoint.browseId;
        if (err || !/^UC[A-Za-z0-9_-]{22}$/.test(id || '')) { cb(err || new Error('channel not found')); return; }
        browse(id, VIDEOS_TAB);
    });
}
// Limited like the playback lookups (a page on the TV can reach this port), and kept for
// 10 minutes (Home, Discover and a channel's page ask for the same things).
function limitedList(o, cb) {
    var key = JSON.stringify([o.src, o.kind, o.sort, o.q, o.page, !!o.meta, !!o.orig]), now = Date.now(), hit = _listCache[key];
    if (hit && now < hit.exp) { cb(null, hit.v); return; }
    _listRecent = _listRecent.filter(function (t) { return now - t < 60000; });
    if (_listRecent.length >= LIST_MAX_PER_MINUTE) { cb(Object.assign(new Error('too many lookups, try again in a minute'), { status: 429 })); return; }
    _listRecent.push(now);
    ytList(o, function (err, v) {
        if (!err) {
            var keys = Object.keys(_listCache);
            keys.forEach(function (k) { if (_listCache[k].exp <= now) { delete _listCache[k]; } });
            keys = Object.keys(_listCache);
            if (keys.length >= LIST_CACHE_MAX) { delete _listCache[keys[0]]; }
            _listCache[key] = { v: v, exp: Date.now() + LIST_TTL_MS };
        }
        cb(err, v);
    });
}

// ---- SponsorBlock and DeArrow (sponsor.ajay.app): sections of a video its viewers marked
// (sponsor, self-promotion…), and titles / thumbnails they wrote to replace clickbait. No key,
// no account. The video you play is asked for by the first 4 characters of its id's SHA-256
// (as their browser extensions do): the answer covers every video sharing them, so the server
// isn't told which one. Lists (/ytlist &brand=1) ask per video: what a channel lists, not what
// you watch.
var SB_API = 'https://sponsor.ajay.app/api/';
var SB_CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic', 'filler', 'poi_highlight', 'exclusive_access'];
var SB_ACTIONS = ['skip', 'poi', 'full'];
var SB_MAX_PER_MINUTE = 300, SB_TTL_MS = 60 * 60 * 1000, SB_CACHE_MAX = 2000, BRAND_BUDGET_MS = 4000, BRAND_PARALLEL = 8;
var _sbCache = {}, _sbCount = 0, _sbRecent = [];
function sbHost(h) { return h === 'sponsor.ajay.app'; }
function sbCached(key) { var h = _sbCache[key]; return h && Date.now() < h.exp ? h.v : undefined; }
function sbKeep(key, v) {
    if (!_sbCache[key]) { _sbCount++; }
    _sbCache[key] = { v: v, exp: Date.now() + SB_TTL_MS };
    if (_sbCount > SB_CACHE_MAX) {   // (the oldest half goes)
        var keys = Object.keys(_sbCache);
        keys.slice(0, keys.length >> 1).forEach(function (k) { delete _sbCache[k]; });
        _sbCount = Object.keys(_sbCache).length;
    }
}
// GET sponsor.ajay.app/api/<path>: cb(err, json); "nothing there" (404) is null, not an error.
function sbJSON(path, cb) {
    var now = Date.now();
    _sbRecent = _sbRecent.filter(function (t) { return now - t < 60000; });
    if (_sbRecent.length >= SB_MAX_PER_MINUTE) { cb(Object.assign(new Error('too many lookups, try again in a minute'), { status: 429 })); return; }
    _sbRecent.push(now);
    httpReq('GET', SB_API + path, { 'User-Agent': 'StremioK' }, null, function (err, sc, text) {
        if (err) { cb(/HTTP 404/.test(err.message) ? null : err, null); return; }
        var j;
        try { j = JSON.parse(text); } catch (e) { cb(new Error('not JSON')); return; }
        cb(null, j);
    }, sbHost);
}
function hashPrefix(id) { return crypto.createHash('sha256').update(id).digest('hex').slice(0, 4); }
function cleanTitle(t) { return ('' + t).replace(/(^|\s)>(?=\S)/g, '$1').trim().slice(0, 300); }   // (">" marks a word not to re-case)
// DeArrow's pick for a video: the top title / thumbnail its voters stand by (not the original).
function pickBrand(b) {
    var out = {};
    if (!b || typeof b !== 'object') { return out; }
    function good(x) { return x && !x.original && (x.locked || (+x.votes || 0) >= 0); }
    var t = (Array.isArray(b.titles) ? b.titles : []).filter(function (x) { return good(x) && typeof x.title === 'string' && x.title.trim(); })[0];
    var th = (Array.isArray(b.thumbnails) ? b.thumbnails : []).filter(function (x) { return good(x) && typeof x.timestamp === 'number' && x.timestamp >= 0; })[0];
    if (t) { out.title = cleanTitle(t.title); }
    if (th) { out.thumbAt = Math.round(th.timestamp * 1000) / 1000; }
    return out;
}
function sbSegments(list, id) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
        if (!v || v.videoID !== id) { return; }
        (v.segments || []).forEach(function (x) {
            var seg = x && x.segment, a = seg && +seg[0], b = seg && +seg[1];
            if (!seg || SB_CATEGORIES.indexOf(x.category) === -1 || SB_ACTIONS.indexOf(x.actionType) === -1 || !(a >= 0) || !(b >= a)) { return; }
            out.push({ cat: x.category, action: x.actionType, start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 });
        });
    });
    out.sort(function (x, y) { return x.start - y.start; });
    return out.slice(0, 100);
}
// The video you play: its marked sections and its DeArrow title / thumbnail.
function sbVideo(id, cb) {
    var hit = sbCached('v:' + id);
    if (hit) { cb(null, hit); return; }
    var prefix = hashPrefix(id), left = 2, out = { segments: [], brand: {} }, failed = null;
    function done(err) {
        if (err) { failed = err; }
        if (--left) { return; }
        if (failed && !out.segments.length && !out.brand.title) { cb(failed); return; }
        if (!failed) { sbKeep('v:' + id, out); }
        cb(null, out);
    }
    sbJSON('skipSegments/' + prefix + '?categories=' + encodeURIComponent(JSON.stringify(SB_CATEGORIES)) + '&actionTypes=' + encodeURIComponent(JSON.stringify(SB_ACTIONS)), function (err, j) {
        if (!err) { out.segments = sbSegments(j, id); }
        done(err);
    });
    sbJSON('branding/' + prefix, function (err, j) {
        if (!err && j && typeof j === 'object') { out.brand = pickBrand(j[id]); sbKeep('b:' + id, out.brand); }
        done(err);
    });
}
// DeArrow for a list's videos: { id: { title, thumbAt } }, what's in by BRAND_BUDGET_MS (the
// rest without; they're kept for next time).
function brandMany(ids, cb) {
    cb = once(cb);
    var out = {}, todo = [], running = 0;
    ids.forEach(function (id) {
        var hit = sbCached('b:' + id);
        if (hit) { out[id] = hit; } else if (todo.indexOf(id) === -1) { todo.push(id); }
    });
    if (!todo.length) { cb(out); return; }
    var timer = setTimeout(function () { cb(out); }, BRAND_BUDGET_MS);
    function next() {
        if (!todo.length) { if (!running) { clearTimeout(timer); cb(out); } return; }
        var id = todo.shift();
        running++;
        sbJSON('branding?videoID=' + id, function (err, j) {
            running--;
            if (!err) { out[id] = pickBrand(j); sbKeep('b:' + id, out[id]); }
            next();
        });
    }
    for (var i = 0; i < BRAND_PARALLEL; i++) { next(); }
}

// ---- USB drives (the Local tab) ----
// Folders and files on the TV's USB mounts only (/opt/media/<drive>/…). Who may ask (see
// fsAllowed): StremioK itself — a request that names this service by its local address (a
// web page's DNS-rebound request names its own domain), carries no Origin (StremioK's pages
// send none; a web page's always does) and the token the service keeps in StremioK's private
// folder, which no web page or other app can read. Answers carry no CORS header. Links are
// never followed, nor out of the drive asked about; the work is bounded: FS_PARALLEL file
// lookups at a time for the whole service, FS_LISTS_MAX listings at once, one drive walk.
var FS_LIST_MAX = 2000, FS_PARALLEL = 12, FS_LISTS_MAX = 4;
var VIDEO_EXT = /\.(mkv|mp4|m4v|avi|ts|m2ts|mts|mov|webm|wmv|mpe?g|flv|3gp|ogv|vob)$/i;
var SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
var HIDDEN_NAME = /^(\.|\$RECYCLE\.BIN$|System Volume Information$)/i;
function fsDirOk(p) {
    if (typeof p !== 'string' || p.length > 1024 || p.indexOf('\0') !== -1) { return false; }
    if (!/^\/opt\/media\/[^\/]+(\/|$)/.test(p)) { return false; }
    return !p.split('/').some(function (seg) { return seg === '..' || seg === '.'; });
}
function mountOf(p) { var m = /^\/opt\/media\/[^\/]+/.exec(p); return m ? m[0] : ''; }
function inside(p, root) { return p === root || p.indexOf(root + '/') === 0; }

// The token (see fsAllowed): kept in StremioK's private folder (the app reads it there as
// wgt-private), the same one across restarts. Where it can't be kept (TizenBrew runs this
// file inside its own package), the USB endpoints stay closed.
var TOKEN_FILE = 'stremiok-service-token';
function tokenDir() {
    if (typeof __filename === 'string') {
        var i = __filename.indexOf('/res/wgt/');
        if (i !== -1) { return __filename.slice(0, i) + '/data'; }
    }
    return UNDER_TIZENBREW ? null : '/opt/usr/home/owner/apps_rw/StremioK01/data';
}
var _fsToken = null;
(function () {
    try {
        var fs = require('fs'), dir = tokenDir();
        if (!dir) { log('USB endpoints closed: nowhere private to keep their token'); return; }
        var p = dir + '/' + TOKEN_FILE, t = '';
        try { t = String(fs.readFileSync(p, 'utf8')).trim(); } catch (e) {}
        if (!/^[0-9a-f]{48}$/.test(t)) {
            t = crypto.randomBytes(24).toString('hex');
            fs.writeFileSync(p, t, { mode: 384 });   // (0600: StremioK only)
        }
        _fsToken = t;
    } catch (e) {
        // (the sideloaded app where its folder can't be written: a token kept in memory, which the
        // app can't read either, so it uses its header — see fsAllowed)
        _fsToken = UNDER_TIZENBREW ? null : crypto.randomBytes(24).toString('hex');
        log('USB token not kept (' + (e && (e.code || e.message)) + ')' + (_fsToken ? ': StremioK\'s header instead' : ': USB endpoints closed'));
    }
})();
function sameToken(a, b) {   // (in constant time)
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) { return false; }
    var d = 0;
    for (var i = 0; i < a.length; i++) { d |= a.charCodeAt(i) ^ b.charCodeAt(i); }
    return d === 0;
}
var TIZENBREW_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):8081$/;
// Who the service answers (everything but /health): a request that names it by its local
// address (a web page's DNS-rebound request names its own domain) and carries no Origin
// (StremioK's pages and the TV's player send none; a web page's request always does), or,
// under TizenBrew, comes from TizenBrew's own pages. null when allowed, else why not.
function callerProblem(req) {
    var host = String((req.headers && req.headers.host) || '').toLowerCase();
    if (host !== '127.0.0.1:' + PORT && host !== 'localhost:' + PORT) { return 'host'; }
    var origin = req.headers.origin;
    if (origin !== undefined && !(UNDER_TIZENBREW && TIZENBREW_ORIGIN.test(origin))) { return 'origin'; }
    return null;
}
function hasToken(query) {
    var m = /(?:^|&)token=([0-9a-f]{1,64})(?:&|$)/.exec(query || '');
    return !!(m && _fsToken && sameToken(m[1], _fsToken));
}
// null when allowed, else why not
function fsAllowed(req, query) {
    var why = callerProblem(req);
    if (why) { return why; }
    if (!_fsToken) { return 'closed'; }
    // the token; or, where the app can't read it (Tizen 6: the service's folder isn't the
    // app's), its X-StremioK header, which a web page can't send without a pre-check (refused)
    if (!hasToken(query) && !(req.headers && req.headers['x-stremiok'])) { return 'token'; }
    return null;
}

// File lookups, a few at a time for the whole service (a big folder or drive can't flood it).
var _fsActive = 0, _fsQueue = [];
function fsOp(fn) { _fsQueue.push(fn); fsPump(); }
function fsPump() {
    while (_fsActive < FS_PARALLEL && _fsQueue.length) {
        _fsActive++;
        (function (fn) {
            var released = false;
            function done() { if (released) { return; } released = true; _fsActive--; setTimeout(fsPump, 0); }
            try { fn(done); } catch (e) { done(); }
        })(_fsQueue.shift());
    }
}
function pReaddir(fs, p, cb) { fsOp(function (done) { fs.readdir(p, function (e, n) { done(); cb(e, n); }); }); }
function pLstat(fs, p, cb) { fsOp(function (done) { fs.lstat(p, function (e, st) { done(); cb(e, st); }); }); }
function errStatus(e) { return e.code === 'ENOENT' ? 404 : e.code === 'EACCES' || e.code === 'EPERM' ? 403 : 500; }

// Where a path really is (links resolved), refused unless it's still inside the drive it
// was asked under (that drive's own real place: a link to another drive, or out of
// /opt/media, isn't followed).
function fsRealOk(p, cb) {
    var fs = require('fs');
    fs.realpath(mountOf(p), function (e0, realMount) {
        if (e0) { cb({ status: errStatus(e0), message: e0.code || e0.message }); return; }
        fs.realpath(p, function (err, real) {
            if (err) { cb({ status: errStatus(err), message: err.code || err.message }); return; }
            if (!inside(real, realMount)) { cb({ status: 403, message: 'outside the USB drive' }); return; }
            cb(null, real);
        });
    });
}

// A folder: each entry looked at on its own (Tizen 3's own listing fails a whole folder over
// one it can't look at); the ones that can't be, and links (not followed), named.
var _lists = 0;
function fsList(dir, cb) {
    cb = once(cb);
    var fs;
    try { fs = require('fs'); } catch (e) { cb({ status: 501, message: 'no file access here' }); return; }
    if (_lists >= FS_LISTS_MAX) { cb({ status: 503, message: 'busy' }); return; }
    _lists++;
    var finish = once(function (err, val) { _lists--; cb(err, val); });
    fsRealOk(dir, function (err, real) {
        if (err) { finish(err); return; }
        pReaddir(fs, real, function (e, names) {
            if (e || !names) { finish({ status: e ? errStatus(e) : 500, message: e ? (e.code || e.message) : 'unreadable' }); return; }
            var total = names.length, out = [], bad = [];
            names = names.slice(0, FS_LIST_MAX);
            var left = names.length;
            if (!left) { finish(null, { entries: [], bad: [], total: total }); return; }
            names.forEach(function (n) {
                pLstat(fs, real + '/' + n, function (e2, st) {
                    try {
                        if (e2 || !st) { bad.push({ name: n, err: (e2 && (e2.code || e2.message)) || 'unreadable' }); }
                        else if (st.isSymbolicLink()) { bad.push({ name: n, err: 'a link (not followed)' }); }
                        else { out.push({ name: n, dir: st.isDirectory(), size: st.isFile() ? st.size : 0 }); }
                    } catch (x) { bad.push({ name: n, err: 'unreadable' }); }
                    if (--left === 0) { finish(null, { entries: out, bad: bad, total: total }); }
                });
            });
        });
    });
}

// The video and subtitle files under a drive's folder (its index): two folders at a time,
// their entries through the shared lookups, links not followed; at most FS_WALK_DIRS
// folders / FS_WALK_FILES files / FS_WALK_DEPTH deep, and nothing new started after
// FS_WALK_MS. One walk at a time: the same drive asked again shares it, another waits.
var FS_WALK_DIRS = 5000, FS_WALK_FILES = 20000, FS_WALK_DEPTH = 12, FS_WALK_MS = 90000;
// Everyone who asked gone (StremioK stopped indexing: its request closed), the walk stops too
// (fsWalkLeave): nothing new is looked at.
var _walk = null;   // { root, cbs, cancelled }
function fsWalk(root, cb) {
    cb = once(cb);
    var fs;
    try { fs = require('fs'); } catch (e) { cb({ status: 501, message: 'no file access here' }); return; }
    if (_walk) {
        if (_walk.root === root && !_walk.cancelled) { _walk.cbs.push(cb); return cb; }
        cb({ status: 503, message: 'busy: another drive is being indexed' });
        return cb;
    }
    var w = _walk = { root: root, cbs: [cb], cancelled: false };
    function finish(err, val) { if (_walk === w) { _walk = null; } var cbs = w.cbs; w.cbs = []; cbs.forEach(function (f) { f(err, val); }); }
    fsRealOk(root, function (err, base) {
        if (err) { finish(err); return; }
        var files = [], queue = [{ rel: '', depth: 0 }], dirs = 0, running = 0, truncated = false, deadline = Date.now() + FS_WALK_MS;
        function over() {
            if (w.cancelled) { return true; }
            if (Date.now() > deadline || dirs >= FS_WALK_DIRS || files.length >= FS_WALK_FILES) { truncated = true; return true; }
            return false;
        }
        function next() {
            while (running < 2 && queue.length && !over()) { readOne(queue.shift()); }
            if (queue.length && over()) { queue = []; }
            if (!running && !queue.length) { finish(null, { files: files, dirs: dirs, truncated: truncated }); }
        }
        function readOne(d) {
            running++; dirs++;
            var abs = base + (d.rel ? '/' + d.rel : ''), finished = false;
            function dirDone() { if (finished) { return; } finished = true; running--; next(); }
            pReaddir(fs, abs, function (e, names) {
                if (e || !names) { dirDone(); return; }
                names = names.filter(function (n) { return !HIDDEN_NAME.test(n); }).slice(0, FS_LIST_MAX);
                var i = 0, active = 0;
                function step() {
                    while (active < FS_PARALLEL && i < names.length) {
                        if (over()) { i = names.length; break; }   // (past the deadline: nothing new)
                        look(names[i++]);
                    }
                    if (i >= names.length && !active) { dirDone(); }
                }
                function look(n) {
                    active++;
                    var rel = d.rel ? d.rel + '/' + n : n;
                    pLstat(fs, abs + '/' + n, function (e2, st) {
                        active--;
                        try {
                            if (!e2 && st && !st.isSymbolicLink()) {
                                if (st.isDirectory()) { if (d.depth + 1 <= FS_WALK_DEPTH) { queue.push({ rel: rel, depth: d.depth + 1 }); } else { truncated = true; } }
                                else if ((VIDEO_EXT.test(n) || SUB_EXT.test(n)) && files.length < FS_WALK_FILES) { files.push({ p: rel, size: st.size }); }
                            }
                        } catch (x) {}
                        step();
                    });
                }
                step();
            });
        }
        next();
    });
    return cb;
}
function fsWalkLeave(cb) {
    var w = _walk;
    if (!w) { return; }
    var i = w.cbs.indexOf(cb);
    if (i !== -1) { w.cbs.splice(i, 1); }
    if (!w.cbs.length && !w.cancelled) { w.cancelled = true; _walk = null; log('drive walk stopped: nobody waiting for it'); }
}

// Subtitle text: the file's encoding worked out (a byte-order mark, else UTF-8 when it reads
// as UTF-8, else Windows-1252: most older .srt files), ASS / SSA turned into SRT.
var FS_SUB_MAX = 5 * 1024 * 1024;
function decodeText(buf) {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) { return buf.slice(2).toString('utf16le'); }
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {   // (UTF-16 big-endian: bytes swapped first)
        var sw = allocBuffer(buf.length - 2);
        for (var i = 2; i + 1 < buf.length; i += 2) { sw[i - 2] = buf[i + 1]; sw[i - 1] = buf[i]; }
        return sw.toString('utf16le');
    }
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { return buf.slice(3).toString('utf8'); }
    var t = buf.toString('utf8');
    if (t.indexOf('\uFFFD') === -1) { return t; }
    var cp = '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178';
    var out = [];
    for (var j = 0; j < buf.length; j++) { var b = buf[j]; out.push(b >= 0x80 && b < 0xA0 ? cp.charAt(b - 0x80) : String.fromCharCode(b)); }
    return out.join('');
}
function assToSrt(text) {
    var lines = text.replace(/\r/g, '').split('\n'), fmt = null, inEvents = false, cues = [];
    function ts(s) {
        var m = /^(\d+):(\d{2}):(\d{2})[.:](\d{1,3})$/.exec(s.trim());
        if (!m) { return null; }
        var cs = m[4].length === 2 ? +m[4] * 10 : m[4].length === 1 ? +m[4] * 100 : +m[4];
        function two(n) { return (n < 10 ? '0' : '') + n; }
        return two(+m[1]) + ':' + m[2] + ':' + m[3] + ',' + ('00' + cs).slice(-3);
    }
    lines.forEach(function (l) {
        if (/^\[events\]/i.test(l)) { inEvents = true; return; }
        if (/^\[/.test(l)) { inEvents = false; return; }
        if (!inEvents) { return; }
        var m = /^format\s*:\s*(.*)$/i.exec(l);
        if (m) { fmt = m[1].split(',').map(function (x) { return x.trim().toLowerCase(); }); return; }
        m = /^dialogue\s*:\s*(.*)$/i.exec(l);
        if (!m || !fmt) { return; }
        var parts = m[1].split(','), n = fmt.length;
        if (parts.length < n) { return; }
        var f = {};
        for (var i = 0; i < n - 1; i++) { f[fmt[i]] = parts[i]; }
        f[fmt[n - 1]] = parts.slice(n - 1).join(',');
        var a = ts(f.start || ''), b = ts(f.end || '');
        var txt = ('' + (f.text || '')).replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
        if (a && b && txt) { cues.push({ a: a, b: b, t: txt }); }
    });
    cues.sort(function (x, y) { return x.a < y.a ? -1 : x.a > y.a ? 1 : 0; });
    return cues.map(function (c, i) { return (i + 1) + '\n' + c.a + ' --> ' + c.b + '\n' + c.t; }).join('\n\n') + '\n';
}
function fsSub(p, cb) {
    cb = once(cb);
    if (!SUB_EXT.test(p)) { cb({ status: 400, message: 'not a subtitle file' }); return; }
    fsRealOk(p, function (err, real) {
        if (err) { cb(err); return; }
        var fs = require('fs');
        fs.stat(real, function (e, st) {
            if (e || !st || !st.isFile()) { cb({ status: 404, message: 'not a file' }); return; }
            if (st.size > FS_SUB_MAX) { cb({ status: 413, message: 'over 5 MB' }); return; }
            fs.readFile(real, function (e2, buf) {
                if (e2) { cb({ status: 500, message: e2.code || e2.message }); return; }
                var text = decodeText(buf);
                cb(null, /\.(ass|ssa)$/i.test(p) ? assToSrt(text) : text);
            });
        });
    });
}

// OpenSubtitles' hash: the file's size plus its first and last 64 KB read as 64-bit
// little-endian numbers, all added (wrapping at 64 bits); 16 hex digits. (Two 32-bit halves:
// the TV's Node has no 64-bit integers.)
var HASH_CHUNK = 65536, TWO32 = 4294967296;
function osHashOf(size, head, tail) {
    var lo = size % TWO32, hi = Math.floor(size / TWO32) % TWO32;
    [head, tail].forEach(function (b) {
        for (var i = 0; i + 8 <= b.length; i += 8) {
            lo += b.readUInt32LE(i);
            hi += b.readUInt32LE(i + 4) + Math.floor(lo / TWO32);
            lo = lo % TWO32; hi = hi % TWO32;
        }
    });
    function hex8(n) { return ('00000000' + n.toString(16)).slice(-8); }
    return hex8(hi) + hex8(lo);
}
function fsHash(p, cb) {
    cb = once(cb);
    if (!VIDEO_EXT.test(p)) { cb({ status: 400, message: 'not a video file' }); return; }
    fsRealOk(p, function (err, real) {
        if (err) { cb(err); return; }
        var fs = require('fs');
        fs.open(real, 'r', function (e, fd) {
            if (e) { cb({ status: 404, message: e.code || e.message }); return; }
            function close(errOut, val) { fs.close(fd, function () { cb(errOut, val); }); }
            fs.fstat(fd, function (e1, st) {
                if (e1 || !st) { close({ status: 500, message: 'stat failed' }); return; }
                var size = st.size, n = Math.min(HASH_CHUNK, size), head = allocBuffer(n), tail = allocBuffer(n);
                fs.read(fd, head, 0, n, 0, function (e2) {
                    if (e2) { close({ status: 500, message: e2.code || e2.message }); return; }
                    fs.read(fd, tail, 0, n, Math.max(0, size - n), function (e3) {
                        if (e3) { close({ status: 500, message: e3.code || e3.message }); return; }
                        close(null, { size: size, hash: osHashOf(size, head, tail) });
                    });
                });
            });
        });
    });
}

// ---- Downloads to a USB drive ----
// StremioK asks (/fsdl/add: a link, the folder on a drive, the file's name); one at a time, the
// rest wait. Into "<name>.part", renamed when complete. A dropped connection is picked up where
// it stopped (a Range request; from the start if the server won't), DL_TRIES times, waiting
// longer each time; a link the server refuses (4xx: an expired debrid link) stops it. Before
// writing: enough free space (df), and no file over 4 GB on a FAT32 drive. Over HTTPS with
// Mozilla's list of trusted certificates (service/cacert.pem): the 2017 TV's Node (4.4) has a
// 2016 one that refuses many servers. Not to this TV itself (localhost, link-local). Kept in
// memory: StremioK adds again what the service no longer knows (js/downloads.js), and a
// partial file is picked up from where it is.
var DL_TRIES = 5, DL_WAIT_MS = [5000, 15000, 30000, 60000, 120000], DL_SILENCE_MS = 60000, DL_MAX = 50, FAT_MAX = 4294967295, DL_SPARE = 50 * 1048576;
var _dls = [], _dlActive = null, _dlSeq = 0, _ca = null;
function caList() {
    if (_ca === null) {
        try {
            var t = String(require('fs').readFileSync(require('path').join(require('path').dirname(__filename), 'cacert.pem'), 'utf8'));
            _ca = t.split(/(?=-----BEGIN CERTIFICATE-----)/).filter(function (c) { return c.indexOf('-----BEGIN CERTIFICATE-----') === 0; });
        } catch (e) { _ca = []; }
    }
    return _ca;
}
function dlName(n) {   // a file name: no folders, nothing a drive refuses, not hidden
    var s = String(n || '').replace(/[\/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    return s.slice(0, 200);
}
// The TV itself (loopback, unspecified, link-local), however an address is written: dotted,
// decimal, hex or octal IPv4 ("2130706433", "0x7f.1", "0177.0.0.1"), IPv6 and IPv4-mapped IPv6
// ("::ffff:127.0.0.1", "::ffff:7f00:1"), "localhost". Home-network addresses (a NAS) are fine.
function ipv4Int(h) {   // inet_aton's forms: 1 to 4 parts, each decimal, 0x hex or 0 octal; else -1
    var parts = h.split('.');
    if (!parts.length || parts.length > 4) { return -1; }
    var nums = [];
    for (var i = 0; i < parts.length; i++) {
        var t = parts[i], v;
        if (/^0x[0-9a-f]+$/i.test(t)) { v = parseInt(t.slice(2), 16); }
        else if (/^0[0-7]*$/.test(t)) { v = parseInt(t, 8); }
        else if (/^[1-9][0-9]*$/.test(t)) { v = parseInt(t, 10); }
        else { return -1; }
        if (!isFinite(v)) { return -1; }
        nums.push(v);
    }
    var last = nums.pop(), max = [4294967296, 16777216, 65536, 256][nums.length], n = 0;
    if (last >= max || nums.some(function (x) { return x > 255; })) { return -1; }
    nums.forEach(function (x, k) { n += x * Math.pow(256, 3 - k); });
    return n + last;
}
function ipv6Words(h) {   // 8 numbers, or null
    var tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(h), extra = null;
    if (tail) {   // (a dotted IPv4 at the end: its two words)
        var v = ipv4Int(tail[1]);
        if (v < 0) { return null; }
        extra = [Math.floor(v / 65536), v % 65536];
        h = h.slice(0, -tail[1].length) + '0:0';
    }
    var halves = h.split('::');
    if (halves.length > 2) { return null; }
    var a = halves[0] ? halves[0].split(':') : [], b = halves.length === 2 && halves[1] ? halves[1].split(':') : [], all;
    if (halves.length === 1) { all = a; }
    else {
        var fill = 8 - a.length - b.length, zeros = [];
        if (fill < 1) { return null; }
        while (zeros.length < fill) { zeros.push('0'); }
        all = a.concat(zeros, b);
    }
    if (all.length !== 8 || !all.every(function (w) { return /^[0-9a-f]{1,4}$/i.test(w); })) { return null; }
    all = all.map(function (w) { return parseInt(w, 16); });
    if (extra) { all[6] = extra[0]; all[7] = extra[1]; }
    return all;
}
function isSelfAddr(host) {
    var h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/\.$/, '');
    if (!h || h === 'localhost' || /\.localhost$/.test(h)) { return true; }
    function v4self(n) { var a = Math.floor(n / 16777216); return a === 127 || a === 0 || Math.floor(n / 65536) === 0xA9FE; }
    if (h.indexOf(':') === -1) { var n = ipv4Int(h); return n >= 0 && v4self(n); }
    var w = ipv6Words(h);
    if (!w) { return false; }
    var zero5 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0;
    if (zero5 && (w[5] === 0xffff || w[5] === 0) && !(w[5] === 0 && w[6] === 0 && w[7] <= 1)) { return v4self(w[6] * 65536 + w[7]); }   // (IPv4-mapped, or the old IPv4-compatible)
    if (zero5 && w[5] === 0 && w[6] === 0 && w[7] <= 1) { return true; }   // (::1, ::)
    return (w[0] & 0xffc0) === 0xfe80;   // (link-local)
}
function dlHostOk(h) { return !!String(h || '') && !isSelfAddr(h); }
// Checked again where a name actually leads: the address it resolves to, before connecting, and
// the one connected to (a name that resolves to the TV itself, now or after a change, is refused).
function guardSelf(req, fail) {
    req.on('socket', function (sock) {
        sock.on('lookup', function (err, addr) { if (!err && isSelfAddr(addr)) { fail(); } });
        sock.on('connect', function () { if (isSelfAddr(sock.remoteAddress)) { fail(); } });
    });
}
// A drive's free space: df run directly (execFile: the path an argument, never a shell), without
// holding up the service. cb({ free, total } in bytes, or null).
function dfOf(dir, cb) {
    try {
        require('child_process').execFile('df', ['-k', dir], { timeout: 5000 }, function (err, out) {
            if (err) { cb(null); return; }
            var line = String(out || '').trim().split('\n').slice(-1)[0].split(/\s+/);
            var total = +line[1] * 1024, free = +line[3] * 1024;
            cb(isFinite(total) && isFinite(free) ? { total: total, free: free } : null);
        });
    } catch (e) { cb(null); }
}
// A USB drive that's actually mounted (in /proc/mounts, its mount point's escapes undone).
function isMounted(mount) {
    try {
        return String(require('fs').readFileSync('/proc/mounts', 'utf8')).split('\n').some(function (l) {
            return (l.split(' ')[1] || '').replace(/\\([0-7]{3})/g, function (a, o) { return String.fromCharCode(parseInt(o, 8)); }) === mount;
        });
    } catch (e) { return false; }
}
function fsTypeOf(mount) {
    try {
        var hit = String(require('fs').readFileSync('/proc/mounts', 'utf8')).split('\n').filter(function (l) { return l.split(' ')[1] === mount; })[0];
        return hit ? hit.split(' ')[2] : '';
    } catch (e) { return ''; }
}
// /fsfile: a file on a USB drive, with ranges: only where it really is (fsRealOk: a link that
// leads off the drive is refused), opened once, and served only if that's a regular file.
function fsFileServe(req, res, path) {
    var fs = require('fs');
    fsRealOk(path, function (bad, real) {
        if (bad) { send(res, bad.status === 403 ? 403 : 404, 'text/plain', bad.status === 403 ? 'not on the USB drive' : 'no such file'); return; }
        fs.open(real, 'r', function (oe, fd) {
            if (oe) { send(res, 404, 'text/plain', 'no such file'); return; }
            fs.fstat(fd, function (se, st) {
                if (se || !st.isFile()) { fs.close(fd, function () {}); send(res, 404, 'text/plain', 'no such file'); return; }
                var size = st.size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''), a0 = 0, b0 = size - 1, part = false;
                if (m) { part = true; if (m[1] !== '') { a0 = +m[1]; if (m[2] !== '') { b0 = Math.min(+m[2], size - 1); } } else if (m[2] !== '') { a0 = Math.max(0, size - (+m[2])); } }
                if (a0 > b0 || a0 >= size) { fs.close(fd, function () {}); res.writeHead(416, { 'Content-Range': 'bytes */' + size }); res.end(); return; }
                var h = { 'Content-Type': /\.mp4$|\.m4v$/i.test(real) ? 'video/mp4' : 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': b0 - a0 + 1, 'Cache-Control': 'no-store' };
                if (part) { h['Content-Range'] = 'bytes ' + a0 + '-' + b0 + '/' + size; }
                res.writeHead(part ? 206 : 200, h);
                var rs = fs.createReadStream(real, { fd: fd, start: a0, end: b0 });
                rs.on('error', function () { try { res.end(); } catch (e) {} });
                res.on('close', function () { try { rs.destroy(); } catch (e) {} });
                rs.pipe(res);
            });
        });
    });
}
function dlView(e) {
    return { id: e.id, title: e.title, name: e.name, dir: e.dir, size: e.size || 0, got: e.got || 0, speed: Math.round(e.speed || 0), state: e.state, err: e.err || '', at: e.at, tries: e.tries || 0 };
}
function dlControl(path, query, res) {
    var q = {};
    (query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {} } });
    if (path === '/fsdl/list') { send(res, 200, 'application/json', JSON.stringify({ items: _dls.map(dlView) })); return; }
    if (path === '/fsdl/space') {
        var m = mountOf(q.path || '');
        if (!m || !fsDirOk(m) || !isMounted(m)) { send(res, 400, 'text/plain', 'not a USB drive'); return; }
        dfOf(m, function (df) { send(res, 200, 'application/json', JSON.stringify({ free: df ? df.free : null, total: df ? df.total : null, fs: fsTypeOf(m) })); });
        return;
    }
    if (path === '/fsdl/add') {
        var dir = q.dir || '', name = dlName(q.name), u = q.url || '', pu = null;
        try { pu = urllib.parse(u); } catch (e) {}
        if (!fsDirOk(dir) || dir.split('/').length > 6 || !isMounted(mountOf(dir))) { send(res, 400, 'text/plain', 'not a folder on a USB drive'); return; }
        if (!name) { send(res, 400, 'text/plain', 'no file name'); return; }
        if (!pu || (pu.protocol !== 'https:' && pu.protocol !== 'http:') || !dlHostOk(pu.hostname)) { send(res, 400, 'text/plain', 'not a link it can download'); return; }
        var same = _dls.filter(function (x) { return x.dir === dir && x.name === name && (x.state === 'queued' || x.state === 'downloading' || x.state === 'waiting'); })[0];
        if (same) { send(res, 200, 'application/json', JSON.stringify(dlView(same))); return; }
        if (_dls.filter(function (x) { return x.state !== 'done'; }).length >= DL_MAX) { send(res, 429, 'text/plain', 'too many downloads waiting'); return; }
        var e = { id: 'd' + Date.now().toString(36) + (++_dlSeq), title: String(q.title || '').slice(0, 200), name: name, dir: dir, url: u, size: +q.size || 0, got: 0, state: 'queued', at: Date.now(),
            headers: { 'User-Agent': String(q.ua || 'Mozilla/5.0').slice(0, 300) } };
        if (/^https?:\/\//.test(q.ref || '')) { e.headers.Referer = String(q.ref).slice(0, 2000); }
        _dls = _dls.filter(function (x) { return !(x.dir === dir && x.name === name); });   // (a done / failed one of the same file: replaced)
        // Asked again by the app (this service restarted meanwhile): one that had already finished
        // (its file there, a regular file at its size, no partial file left) is done, not downloaded twice.
        dlFinishedBefore(q.again === '1' ? e : null, function (done) {
            if (done) { e.state = 'done'; e.got = e.size = done.size; }
            _dls.push(e);
            if (!done) { dlPump(); }
            send(res, 200, 'application/json', JSON.stringify(dlView(e)));
        });
        return;
    }
    var x = _dls.filter(function (y) { return y.id === q.id; })[0];
    if (!x) { send(res, 404, 'text/plain', 'no such download'); return; }
    if (path === '/fsdl/cancel') { dlCancel(x); send(res, 200, 'application/json', JSON.stringify(dlView(x))); return; }
    if (path === '/fsdl/clear') {
        if (x.state === 'downloading' || x.state === 'queued' || x.state === 'waiting') { dlCancel(x); }
        else if (x.state === 'failed') { require('fs').unlink(x.dir + '/' + x.name + '.part', function () {}); }   // (its partial file: not left behind)
        _dls = _dls.filter(function (y) { return y !== x; });
        send(res, 200, 'text/plain', 'cleared');
        return;
    }
    send(res, 404, 'text/plain', 'not found');
}
function dlCancel(e) {
    var fs = require('fs');
    e.state = 'cancelled'; e.err = '';
    if (e.stop) { try { e.stop(); } catch (er) {} }
    clearTimeout(e.timer);
    fs.unlink(e.dir + '/' + e.name + '.part', function () {});
    if (_dlActive === e) { _dlActive = null; setTimeout(dlPump, 0); }
}
function dlPump() {
    if (_dlActive) { return; }
    var next = _dls.filter(function (e) { return e.state === 'queued'; })[0];
    if (!next) { return; }
    _dlActive = next;
    dlRun(next);
}
function dlEnd(e, state, err) {
    e.state = state; e.err = err || ''; e.stop = null; e.speed = 0;
    if (_dlActive === e) { _dlActive = null; }
    setTimeout(dlPump, 0);
}
// cb({ size }) when e's file is already on the drive, finished: a regular file, at its size (when
// known), with no partial file beside it; else cb(null).
function dlFinishedBefore(e, cb) {
    if (!e) { cb(null); return; }
    var fs = require('fs'), file = e.dir + '/' + e.name;
    fs.lstat(file + '.part', function (pe) {
        if (!pe) { cb(null); return; }   // (a partial file: picked up where it stopped instead)
        fs.lstat(file, function (fe, st) {
            if (fe || !st.isFile() || (e.size && st.size !== e.size)) { cb(null); return; }
            cb({ size: st.size });
        });
    });
}
// A partial answer's range ("bytes <first>-<last>/<total or *>"): { first, last, total (0:
// unknown) }, or null when it isn't one that can be (last before first, past the total).
function rangeOf(contentRange) {
    var m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(contentRange || '').trim());
    if (!m) { return null; }
    var r = { first: +m[1], last: +m[2], total: m[3] === '*' ? 0 : +m[3] };
    return (r.last < r.first || (r.total && r.last >= r.total)) ? null : r;
}
// A partial answer must go on exactly where the file so far ends (have: 0 for a new one).
function resumeOk(have, contentRange) {
    var r = rangeOf(contentRange);
    return !!r && r.first === have;
}
// A streamed playlist (HLS, DASH) isn't a file to download: by its type, or its first bytes.
function isPlaylistAnswer(type, first) {
    if (/mpegurl|dash\+xml/i.test(String(type || ''))) { return true; }
    var t = String(first || '').replace(/^\uFEFF/, '').replace(/^\s+/, '');
    return t.indexOf('#EXTM3U') === 0 || (/^<\?xml/.test(t) && /<MPD[\s>]/.test(t.slice(0, 512))) || t.indexOf('<MPD') === 0;
}
// The partial file opened without following a link (O_NOFOLLOW where the TV's Node has it),
// and only if it's a regular file. cb(err, fd).
function openPart(fs, part, append, cb) {
    var C = {};
    try { C = require('constants'); } catch (e) {}
    var flags = append ? 'a' : 'w';
    if (C.O_WRONLY && C.O_CREAT) { flags = C.O_WRONLY | C.O_CREAT | (append ? C.O_APPEND : C.O_TRUNC) | (C.O_NOFOLLOW || 0); }
    fs.lstat(part, function (le, lst) {
        if (!le && !lst.isFile()) { cb(new Error('the partial file isn\'t a regular file')); return; }
        fs.open(part, flags, 420, function (oe, fd) {
            if (oe) { cb(oe); return; }
            fs.fstat(fd, function (fe, st) {
                if (fe || !st.isFile()) { fs.close(fd, function () {}); cb(fe || new Error('the partial file isn\'t a regular file')); return; }
                cb(null, fd);
            });
        });
    });
}
function dlRun(e) {
    var fs = require('fs'), part = e.dir + '/' + e.name + '.part';
    e.state = 'downloading'; e.err = '';
    function again(why) {   // a dropped connection, a server's 5xx: picked up later, DL_TRIES times
        e.tries = (e.tries || 0) + 1;
        if (e.tries > DL_TRIES) { dlEnd(e, 'failed', why + ' (' + DL_TRIES + ' tries)'); return; }
        e.state = 'waiting'; e.err = why; e.speed = 0;
        e.timer = setTimeout(function () { if (e.state === 'waiting') { e.state = 'downloading'; dlRun(e); } }, DL_WAIT_MS[Math.min(e.tries - 1, DL_WAIT_MS.length - 1)]);
    }
    fs.mkdir(e.dir, function () {
        fsRealOk(e.dir, function (bad) {
            if (bad) { dlEnd(e, 'failed', 'the folder: ' + bad.message); return; }
            fs.stat(part, function (se, st) {
                var have = se ? 0 : st.size;
                if (!have || e.answered) { get(e.url, 0, have); return; }   // (this one's own, from this run: picked up as it was)
                fs.readFile(part + '.v', 'utf8', function (ve, v) {   // (a partial file from before a restart: resumed only with its validator)
                    e.validator = ve ? '' : String(v).trim().slice(0, 300);
                    if (e.validator) { get(e.url, 0, have); } else { dropPart(function () { get(e.url, 0, 0); }); }
                });
            });
        });
    });
    function dropPart(then) { fs.unlink(part + '.v', function () { fs.unlink(part, function () { then(); }); }); }
    function get(u, hops, have) {
        if (e.state !== 'downloading') { return; }
        var pu = urllib.parse(u), mod = pu.protocol === 'https:' ? https : http;
        if ((pu.protocol !== 'https:' && pu.protocol !== 'http:') || !dlHostOk(pu.hostname)) { dlEnd(e, 'failed', 'a link it can\'t follow'); return; }
        var h = {};
        Object.keys(e.headers).forEach(function (k) { h[k] = e.headers[k]; });
        if (have > 0) { h.Range = 'bytes=' + have + '-'; if (e.validator) { h['If-Range'] = e.validator; } }   // (the same file, or the whole of it again)
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        var r, ws = null, closed = false;
        function stop() { closed = true; try { r.abort(); } catch (er) {} if (ws) { try { ws.end(); } catch (er2) {} } }
        e.stop = stop;
        try { r = mod.get(opts, onResp); } catch (er) { again('couldn\'t connect: ' + (er.code || er.message)); return; }
        guardSelf(r, function () { if (!closed) { stop(); dlEnd(e, 'failed', 'a link to the TV itself'); } });
        r.on('error', function (er) { if (!closed) { closed = true; if (ws) { try { ws.end(); } catch (x) {} } again('connection: ' + (er.code || er.message)); } });
        r.setTimeout(DL_SILENCE_MS, function () { if (!closed) { stop(); again('no data for ' + (DL_SILENCE_MS / 1000) + ' s'); } });
        function onResp(resp) {
            var sc = resp.statusCode;
            if (sc >= 300 && sc < 400 && resp.headers.location && hops < 6) { resp.resume(); get(urllib.resolve(u, resp.headers.location), hops + 1, have); return; }
            if (sc >= 400 && sc < 500) { resp.resume(); closed = true; dlEnd(e, 'failed', 'the server refused it (HTTP ' + sc + '): the link may have expired'); return; }
            if (sc >= 500) { resp.resume(); closed = true; again('the server: HTTP ' + sc); return; }
            if (sc !== 200 && sc !== 206) { resp.resume(); closed = true; dlEnd(e, 'failed', 'HTTP ' + sc); return; }
            if (sc === 206 && !resumeOk(have, resp.headers['content-range'])) {   // (not where the file so far ends, or a range that can't be)
                resp.resume(); closed = true;
                if (have > 0) { dropPart(function () { if (e.state === 'downloading') { get(e.url, 0, 0); } }); }   // (started over)
                else { dlEnd(e, 'failed', 'the server sent part of the file, not from its start'); }
                return;
            }
            var range = sc === 206 ? rangeOf(resp.headers['content-range']) : null, expect = range ? range.last - range.first + 1 : 0, came = 0;
            var resumed = sc === 206 && have > 0;
            if (!resumed) { have = 0; }
            e.answered = true;   // (its partial file is this run's: see dlRun)
            if (!resumed) {   // (asked again on a resume: If-Range; kept beside the partial file, for one after a restart)
                var et = resp.headers.etag;
                e.validator = et && !/^W\//.test(et) ? et : (resp.headers['last-modified'] || '');
                fs.writeFile(part + '.v', e.validator, { mode: 384 }, function () {});
            }
            if (isPlaylistAnswer(resp.headers['content-type'], '')) { resp.resume(); closed = true; dlEnd(e, 'failed', 'a streamed playlist (HLS or DASH), not a file: it can\'t be downloaded'); return; }
            var total = 0, cr = /\/(\d+)\s*$/.exec(resp.headers['content-range'] || '');
            if (cr) { total = +cr[1]; } else if (resp.headers['content-length']) { total = have + (+resp.headers['content-length']); }
            if (total) { e.size = total; }
            var need = (e.size || 0) - have, mount = mountOf(e.dir), fsType = fsTypeOf(mount);
            if (e.size > FAT_MAX && /^(vfat|msdos|fat)/.test(fsType)) { resp.resume(); closed = true; dlEnd(e, 'failed', 'the drive is FAT32, which can\'t hold a file over 4 GB'); return; }
            dfOf(e.dir, function (df) {   // (the answer waits, unread, meanwhile)
                if (closed || e.state !== 'downloading') { resp.resume(); return; }
                if (df && need > 0 && df.free < need + DL_SPARE) { resp.resume(); closed = true; dlEnd(e, 'failed', 'not enough space on the drive'); return; }
                openPart(fs, part, resumed, function (oe, fd) {
                    if (closed || e.state !== 'downloading') { if (fd) { fs.close(fd, function () {}); } resp.resume(); return; }
                    if (oe) { resp.resume(); closed = true; dlEnd(e, 'failed', 'can\'t write to the drive: ' + (oe.code || oe.message)); return; }
                    write(fd);
                });
            });
            function write(fd) {
            try { ws = fs.createWriteStream(part, { fd: fd }); }
            catch (er) { resp.resume(); closed = true; dlEnd(e, 'failed', 'can\'t write to the drive: ' + (er.code || er.message)); return; }
            e.got = have;
            var seen = resumed, head = [], headLen = 0;   // (a playlist's first bytes, where its type didn't say: refused; up to 600, however they come)
            function lookAtHead() {
                seen = true;
                if (isPlaylistAnswer('', Buffer.concat(head).slice(0, 600).toString('utf8'))) { stop(); dropPart(function () {}); dlEnd(e, 'failed', 'a streamed playlist (HLS or DASH), not a file: it can\'t be downloaded'); }
                head = null;
            }
            resp.on('data', function (c) {
                came += c.length;
                if (seen) { return; }
                head.push(c); headLen += c.length;
                if (headLen >= 600) { lookAtHead(); }
            });
            var tick = { at: Date.now(), got: have };
            ws.on('error', function (er) { if (!closed) { stop(); dlEnd(e, 'failed', 'can\'t write to the drive: ' + (er.code || er.message)); } });
            resp.on('data', function (c) {
                e.got += c.length;
                var t = Date.now();
                if (t - tick.at >= 1000) { var sp = (e.got - tick.got) / ((t - tick.at) / 1000); e.speed = e.speed ? e.speed * 0.7 + sp * 0.3 : sp; tick = { at: t, got: e.got }; }
            });
            // (the server closing before the end: a dropped connection, picked up where it stopped)
            var ended = false;
            resp.on('end', function () { ended = true; if (!seen) { lookAtHead(); } });
            function dropped() {
                // (all of it came: on the 2017 TV's Node a small answer without a size — a
                // subtitle, sent chunked — can report its connection closed before its end
                // is read: not a dropped connection)
                if (ended || closed || resp.complete) { return; }
                closed = true;
                try { ws.end(); } catch (er) {}
                again('the connection dropped');
            }
            resp.on('aborted', dropped);
            resp.on('close', dropped);
            resp.on('error', dropped);
            resp.pipe(ws);
            ws.on('finish', function () {
                if (closed || e.state !== 'downloading') { return; }
                closed = true;
                if (expect && came > expect) { dropPart(function () {}); dlEnd(e, 'failed', 'more came than the server said it sent: started again it may work'); return; }
                if (e.size && e.got < e.size) { again('the connection dropped'); return; }   // (picked up where it stopped)
                if (e.size && e.got > e.size) { dropPart(function () {}); dlEnd(e, 'failed', 'more came than the file\'s size: started again it may work'); return; }
                var final = e.dir + '/' + e.name;
                fs.lstat(final, function (fe) {   // (anything there, a link too: not replaced)
                    if (!fe) { final = e.dir + '/' + e.name.replace(/(\.[^.]+)?$/, ' (' + Date.now().toString(36) + ')$1'); }   // (one already there: not overwritten)
                    fs.rename(part, final, function (re) {
                        if (re) { dlEnd(e, 'failed', 'couldn\'t finish the file: ' + (re.code || re.message)); return; }
                        e.name = final.split('/').pop(); e.tries = 0;
                        fs.unlink(part + '.v', function () {});
                        dlEnd(e, 'done');
                    });
                });
            });
            }
        }
    }
}

// ---- HTTP ----
function send(res, code, type, body) {
    try {
        if (res.headersSent) { res.end(); return; }
        var h = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (!res.__noCors) { h['Access-Control-Allow-Origin'] = '*'; }   // (the USB endpoints: none, see fsAllowed)
        res.writeHead(code, h);
        res.end(typeof body === 'string' ? toBuffer(body) : body);
    } catch (e) { log('send failed: ' + (e && e.message)); }
}

// Each request is answered within REQ_MS (504 otherwise; the USB ones have their own
// limits), and at most MAX_CONNECTIONS are open at once.
var REQ_MS = 60000, MAX_CONNECTIONS = 64;
function handle(req, res) {
    try {
        var parts = String(req.url || '').split('?'), path = parts[0];
        var isFs = /^\/fs/.test(path);   // (the USB endpoints: StremioK only, no CORS; see fsAllowed)
        res.__noCors = isFs;
        if (!isFs) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'X-StremioK, X-AIOM-Key, *');   // (named: older engines don't take *)
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (path === '/health' && req.method === 'GET') { send(res, 200, 'text/plain', 'ok'); return; }
        var who = callerProblem(req);
        // The app's own guide POSTs: a browser sends an Origin with every POST (the app's page is
        // file://: "null"); let through with the token, or the guide ticket (for an app that can't
        // read the token: see /epg/ticket), which no web page has (/epg/ only).
        if (who === 'origin' && req.method === 'POST' && /^\/epg\/(load|get|clear)$/.test(path) && /^(null|file:\/\/)$/.test(String(req.headers.origin || '')) && (hasToken(parts[1]) || hasTicket(parts[1]))) { who = null; }
        if (who) { send(res, 403, 'text/plain', 'not allowed (' + who + ')'); return; }
        if (req.method === 'OPTIONS') { if (isFs) { send(res, 403, 'text/plain', 'not allowed'); return; } res.writeHead(200); res.end(); return; }
        var epgPost = req.method === 'POST' && /^\/epg\/(load|get|clear)$/.test(path);   // (a guide's channels: in the body, see epgControl)
        if (req.method !== 'GET' && !epgPost) { send(res, 405, 'text/plain', 'GET only'); return; }   // (before any work)
        if (req.url.length > (/^\/epg\//.test(path) ? 32768 : /^\/fsdl\/add$/.test(path) ? 8192 : 2048)) { send(res, 414, 'text/plain', 'request too long'); return; }   // (a download's link can be long; a guide's channels, a bitset)
        // (StremioK gave up on it — a screen left, the player closed: what it still waits for is
        // dropped; 'close' before the response finished means that on every Node)
        var leaving = [];
        function leaveAll() { var l = leaving; leaving = []; l.forEach(function (f) { try { f(); } catch (e) {} }); }
        if (!isFs) {
            var deadline = setTimeout(function () { if (!res.headersSent) { send(res, 504, 'text/plain', 'took too long'); } leaveAll(); }, REQ_MS);
            res.on('finish', function () { clearTimeout(deadline); });
            res.on('close', function () { clearTimeout(deadline); if (!res.finished) { leaveAll(); } });
        }

        if (/^\/entry\//.test(path)) { entryControl(req, res, path, parts[1]); return; }
        if (/^\/live\//.test(path)) { liveControl(req, res, path, parts[1], leaving); return; }
        if (epgPost) {   // what's asked, in the body (to EPG_BODY_MAX), after the address's own (its token)
            if (+(req.headers['content-length'] || 0) > EPG_BODY_MAX) { send(res, 413, 'text/plain', 'too much asked'); req.resume(); return; }
            var body = '', over = false;
            req.setEncoding('utf8');
            req.on('data', function (c) { if (over) { return; } body += c; if (body.length > EPG_BODY_MAX) { over = true; send(res, 413, 'text/plain', 'too much asked'); } });
            req.on('end', function () { if (!over) { epgControl(req, res, path, (parts[1] ? parts[1] + '&' : '') + body); } });
            return;
        }
        if (/^\/epg\//.test(path)) { epgControl(req, res, path, parts[1]); return; }   // (a playlist's TV guide: see epgControl)
        if (path === '/aiom/addons') { aiomControl(req, res, parts[1], leaving); return; }   // (AIOManager's addons: see aiomControl)   // (a live channel's sound repacked: see liveControl)   // (the phone's one-time page: see below)
        if (path === '/fsfile') {   // a USB file over HTTP, with Range: the player reads a big one from here (see fsfile in the header)
            var whyF = fsAllowed(req, parts[1]);
            if (whyF) { send(res, 403, 'text/plain', 'not allowed (' + whyF + ')'); return; }
            var fq = {};
            (parts[1] || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { fq[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } });
            if (!fsDirOk(fq.path || '')) { send(res, 400, 'text/plain', 'not on a USB drive'); return; }
            fsFileServe(req, res, fq.path);
            return;
        }
        if (/^\/fsdl\//.test(path)) {   // (downloads to a USB drive: see dlControl)
            var whyDl = fsAllowed(req, parts[1]);
            if (whyDl) { send(res, 403, 'text/plain', 'not allowed (' + whyDl + ')'); return; }
            dlControl(path, parts[1], res);
            return;
        }
        if (isFs) {
            if (['/fslist', '/fswalk', '/fssub', '/fshash'].indexOf(path) === -1) { send(res, 404, 'text/plain', 'not found'); return; }
            var why = fsAllowed(req, parts[1]);
            if (why) { send(res, 403, 'text/plain', 'not allowed (' + why + ')'); return; }
            var fm = (parts[1] || '').match(/(?:^|&)path=([^&]*)/), fp = '';
            try { fp = fm ? decodeURIComponent(fm[1]) : ''; } catch (e) { fp = ''; }
            if (!fsDirOk(fp)) { send(res, 400, 'text/plain', 'not on a USB drive'); return; }
            var job = path === '/fslist' ? fsList : path === '/fswalk' ? fsWalk : path === '/fssub' ? fsSub : fsHash;
            var waiting = job(fp, function (err, r) {
                if (err) { send(res, err.status || 500, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
                if (path === '/fssub') { send(res, 200, 'text/plain; charset=utf-8', r); return; }
                send(res, 200, 'application/json', JSON.stringify(r));
            });
            // (the app gone before the answer — Stop, Clear: its request closed — a walk stops;
            // 'close' before the response finished means that on every Node)
            if (path === '/fswalk') { res.on('close', function () { if (!res.finished) { fsWalkLeave(waiting); } }); }
            return;
        }
        if (path === '/ytlist') {   // (StremioK's YouTube catalogs: see ytList)
            var o = {};
            (parts[1] || '').split('&').forEach(function (kv) {
                var i = kv.indexOf('='), k = i === -1 ? kv : kv.slice(0, i), v = '';
                try { v = i === -1 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { v = ''; }
                if (['src', 'kind', 'sort', 'q', 'page', 'meta', 'brand', 'orig'].indexOf(k) !== -1) { o[k] = v.slice(0, k === 'page' ? 2000 : 300); }
            });
            o.meta = o.meta === '1';
            o.orig = o.orig === '1';
            var brand = o.brand === '1';
            delete o.brand;
            if (o.page && !/^[sb]:[A-Za-z0-9_%=-]+$/.test(o.page)) { send(res, 400, 'text/plain', 'bad page'); return; }
            limitedList(o, function (err, v) {
                if (err) { send(res, (err && err.status) || 502, 'text/plain', 'list failed: ' + ((err && err.message) || 'unknown')); return; }
                var vids = (v.items || []).filter(function (it) { return it.kind === 'video'; });
                if (!brand || !vids.length) { send(res, 200, 'application/json', JSON.stringify(v)); return; }
                brandMany(vids.map(function (it) { return it.id; }), function (b) {   // (DeArrow's titles: on copies, the list kept as YouTube gave it)
                    var out = {};
                    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
                    out.items = v.items.map(function (it) {
                        var x = it.kind === 'video' && b[it.id];
                        if (!x || (!x.title && x.thumbAt === undefined)) { return it; }
                        var c = {};
                        Object.keys(it).forEach(function (k) { c[k] = it[k]; });
                        c.brand = x;
                        return c;
                    });
                    send(res, 200, 'application/json', JSON.stringify(out));
                });
            });
            return;
        }
        if (path === '/ytsb') {   // (SponsorBlock / DeArrow for the video you play)
            var vm = (parts[1] || '').match(/(?:^|&)v=([A-Za-z0-9_-]{11})(?:&|$)/);
            if (!vm) { send(res, 400, 'text/plain', 'bad video id'); return; }
            sbVideo(vm[1], function (err, r) {
                if (err) { send(res, (err && err.status) || 502, 'text/plain', 'lookup failed: ' + ((err && err.message) || 'unknown')); return; }
                send(res, 200, 'application/json', JSON.stringify(r));
            });
            return;
        }
        if (path !== '/yt' && path !== '/ytinfo' && path !== '/ytsubs') { send(res, 404, 'text/plain', 'not found'); return; }
        var info = path === '/ytinfo', subs = path === '/ytsubs', subAuto = /(?:^|&)auto=1(?:&|$)/.test(parts[1] || '');

        var page = '', height = 0, fresh = false, lang = '';
        (parts[1] || '').split('&').forEach(function (kv) {
            if (kv.indexOf('u=') === 0) { try { page = decodeURIComponent(kv.slice(2)); } catch (e) {} }
            else if (kv.indexOf('h=') === 0) { height = parseInt(kv.slice(2), 10) || 0; }
            else if (kv.indexOf('fresh=') === 0) { fresh = kv.slice(6) === '1'; }
            else if (kv.indexOf('lang=') === 0) { lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,2}$/.test(kv.slice(5)) ? kv.slice(5) : ''; }
        });
        // YouTube pages only (the same test the app uses for playlist entries): this is
        // no general-purpose fetcher
        if (!/^https?:\/\/(?:[^\/]+\.)?youtube\.com(?::\d+)?(?:\/|$)/i.test(page) &&
            !/^https?:\/\/youtu\.be(?::\d+)?(?:\/|$)/i.test(page)) { send(res, 400, 'text/plain', 'not a YouTube page'); return; }
        page = page.replace(/^http:/i, 'https:');   // (fetched over HTTPS only)

        leaving.push(limitedResolve(page, fresh, function (err, master, links) {
            if (err || !master) { send(res, (err && err.status) || 502, 'text/plain', 'yt resolve failed: ' + ((err && err.message) || 'no manifest')); return; }
            if (subs) {   // /ytsubs: a caption track (by language; &auto=1 the automatic one) as WebVTT
                var track = null;
                ((links && links.captions) || []).forEach(function (t) { if (!track && t.lang === lang && t.auto === subAuto) { track = t; } });
                if (!track) { send(res, 404, 'text/plain', 'no such captions'); return; }
                leaving.push(httpReq('GET', track.url + '&fmt=srv1', { 'User-Agent': 'Mozilla/5.0' }, null, function (e4, sc4, xml) {
                    if (e4 || !xml) { send(res, 502, 'text/plain', 'captions fetch failed'); return; }
                    send(res, 200, 'text/vtt; charset=utf-8', srv1ToVtt(xml, track.auto));
                }, youtubeHost));
                return;
            }
            // The master's variant / segment URLs are absolute googlevideo ones that AVPlay
            // fetches directly.
            leaving.push(httpReq('GET', master, { 'User-Agent': TV_UA }, null, function (e2, sc2, body) {
                if (e2 || !body) { send(res, 502, 'text/plain', 'master fetch failed'); return; }
                if (info) {   // /ytinfo: the audio languages and the links, for the app
                    send(res, 200, 'application/json', JSON.stringify({ audio: audioLanguages(body), links: links || [], details: (links && links.details) || null,
                        chapters: (links && links.chapters) || [],
                        captions: ((links && links.captions) || []).map(function (t) { return { lang: t.lang, name: t.name, auto: t.auto }; }) }));
                    return;
                }
                send(res, 200, 'application/vnd.apple.mpegurl', filterMaster(keepOriginalAudio(body, lang), height));
            }, videoHost));
        }));
    } catch (e) {
        log('request failed: ' + (e && e.message));
        send(res, 500, 'text/plain', 'service error');
    }
}

// ---- Live channels with choppy sound (/live/…) ----
// Some IPTV servers cut a channel's AAC sound into PES packets of a fixed size, whatever the
// frames: each packet then starts inside a frame, and the TV's player stutters on every one.
// Once a live HLS channel plays, StremioK asks here (/live/open?u=<playlist>[&ua=&ref=], its
// token or header: entryAllowed): the start of one of its segments says whether its sound is
// cut that way (liveCut). If so, a relay for it: /live/<id>/m?n= its playlists, /live/<id>/s?n=
// its segments, only the links its own playlists named (by number), each fetched with the
// channel's User-Agent and Referer. A segment comes back with its sound repacked (liveFix:
// whole ADTS frames per packet, each packet with its first frame's own time), everything else
// as it was. &force=1: the relay without the look (StremioK already knows the channel); &fix=0
// with it: the sound as it is. &cc=: the relay with closed captions too (see ccSegment).
var HLS_MASTER_MAX = 524288;   // (an HLS quality list: /live/master)
var LIVE_MAX = 4, LIVE_IDLE_MS = 5 * 60 * 1000, LIVE_LINKS = 400, LIVE_LIST_MAX = 1048576, LIVE_SEG_MAX = 32 * 1048576, LIVE_PROBE = 1536 * 1024, LIVE_MS = 20000;
var ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
var _live = Object.create(null);   // (no prototype: whatever key it's asked for, nothing shared is reached)
// A link's body: cb(err, Buffer, the link it ended at). part: stop at max and keep what came
// (the look at a segment's start), else more than max is an error. Returns abort().
// For all the relay's downloads together: LIVE_ACTIVE_MAX at once, LIVE_HELD_MAX bytes held
// between them (a segment can be 32 MB; four channels' sessions don't mean four downloads):
// past either, "busy" (503), which the TV's player asks again; one let go stops at once.
var LIVE_ACTIVE_MAX = 6, LIVE_HELD_MAX = 64 * 1048576, _liveActive = 0, _liveHeld = 0;
function liveGet(u, who, max, cb, part) {
    if (_liveActive >= LIVE_ACTIVE_MAX) { cb(upError('busy: too many at once', 503)); return function () {}; }
    _liveActive++;
    var held = 0, freed = false;
    function free() { if (freed) { return; } freed = true; _liveActive--; _liveHeld -= held; held = 0; }
    var answer = cb;
    cb = once(function (err, body, at) { free(); answer(err, body, at); });
    var hops = 0, r = null, gone = false;
    function get(url) {
        var pu;
        try { pu = urllib.parse(url); } catch (e) { cb(e); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { cb(upError('a link it can\'t follow', 400)); return; }
        var h = { 'User-Agent': who.ua || TV_UA };
        if (who.ref) { h.Referer = who.ref; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        var chunks = [], size = 0, done = false;
        var timer = setTimeout(function () { end(upError('timed out', 504)); }, LIVE_MS);
        function end(err) {
            if (done) { return; }
            done = true; clearTimeout(timer);
            try { r.abort(); } catch (e) {}
            cb(err, err ? null : Buffer.concat(chunks, size), url);
        }
        try {
            r = (pu.protocol === 'https:' ? https : http).get(opts, function (resp) {
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 5) {
                    done = true; clearTimeout(timer); resp.resume(); hops++;
                    if (!gone) { get(urllib.resolve(url, resp.headers.location)); }
                    return;
                }
                if (sc !== 200) { resp.resume(); end(upError('HTTP ' + sc, sc >= 400 && sc < 600 ? sc : 502)); return; }
                resp.on('data', function (c) {
                    if (done) { return; }
                    chunks.push(c); size += c.length; held += c.length; _liveHeld += c.length;
                    if (size >= max) { if (part) { end(null); } else { end(upError('too large', 502)); } }
                    else if (_liveHeld > LIVE_HELD_MAX) { end(upError('busy: too much at once', 503)); }
                });
                resp.on('end', function () { end(null); });
                resp.on('error', function (e) { end(e); });
            });
            r.on('error', function (e) { end(e); });
            guardSelf(r, function () { end(upError('a link to the TV itself', 400)); });
        } catch (e) { end(e); }
    }
    get(u);
    return function () { gone = true; try { if (r) { r.abort(); } } catch (e) {} free(); };
}

// MPEG-TS: a packet's PID, where its payload starts (-1: none).
function tsPid(b, i) { return ((b[i + 1] & 0x1f) << 8) | b[i + 2]; }
function tsPayload(b, i) {
    var afc = (b[i + 3] >> 4) & 3, o = i + 4;
    if (!(afc & 1)) { return -1; }
    if (afc & 2) { o += 1 + b[i + 4]; }
    return o < i + 188 ? o : -1;
}
// The program's streams and the PID its clock is on: { pcr, list: [{ type, pid }] } or null.
function tsProgram(b) {
    var pmt = -1;
    for (var i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47 || !(b[i + 1] & 0x40)) { continue; }
        var pid = tsPid(b, i), p = tsPayload(b, i);
        if (p < 0 || (pid !== 0 && pid !== pmt)) { continue; }
        var o = p + 1 + b[p], len = ((b[o + 1] & 15) << 8) | b[o + 2], last = Math.min(o + 3 + len - 4, i + 188), k;
        if (pid === 0 && b[o] === 0) {
            for (k = o + 8; k + 4 <= last; k += 4) { if ((b[k] << 8 | b[k + 1]) !== 0) { pmt = ((b[k + 2] & 0x1f) << 8) | b[k + 3]; break; } }
        } else if (pid === pmt && b[o] === 2) {
            var list = [];
            for (k = o + 12 + (((b[o + 10] & 15) << 8) | b[o + 11]); k + 5 <= last; k += 5 + (((b[k + 3] & 15) << 8) | b[k + 4])) {
                list.push({ type: b[k], pid: ((b[k + 1] & 0x1f) << 8) | b[k + 2] });
            }
            return { pcr: ((b[o + 8] & 0x1f) << 8) | b[o + 9], list: list };
        }
    }
    return null;
}
// The program's first AAC (ADTS) stream and the PID its clock is on: { audio, pcr } or null.
function tsAudio(b) {
    var pr = tsProgram(b), audio = null;
    if (!pr) { return null; }
    for (var k = 0; k < pr.list.length && audio === null; k++) { if (pr.list[k].type === 0x0f) { audio = pr.list[k].pid; } }
    return { audio: audio, pcr: pr.pcr };
}
function readPts(b, o) { return ((b[o] >> 1) & 7) * 1073741824 + ((b[o + 1] << 7) | (b[o + 2] >> 1)) * 32768 + ((b[o + 3] << 7) | (b[o + 4] >> 1)); }
function writePts(b, o, v) {
    v = Math.round(v) % 8589934592;   // (33 bits: wraps)
    var hi = Math.floor(v / 1073741824), mid = Math.floor(v / 32768) % 32768, lo = v % 32768;
    b[o] = 0x21 | (hi << 1); b[o + 1] = mid >> 7; b[o + 2] = ((mid & 127) << 1) | 1; b[o + 3] = lo >> 7; b[o + 4] = ((lo & 127) << 1) | 1;
}
function adtsAt(b, k) { return b[k] === 0xff && (b[k + 1] & 0xf6) === 0xf0; }
// Is the sound cut mid-frame? { fix, sure, why } from the start of a segment.
function liveCut(b) {
    if (!b || b.length < 188 * 10 || b[0] !== 0x47 || b[188] !== 0x47) { return { fix: false, sure: true, why: 'not MPEG-TS segments' }; }
    var pr = tsAudio(b);
    if (!pr || pr.audio === null) { return { fix: false, sure: true, why: 'no AAC sound' }; }
    if (pr.pcr === pr.audio) { return { fix: false, sure: true, why: 'its clock is on the sound' }; }
    var starts = 0, mid = 0;
    for (var i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47 || tsPid(b, i) !== pr.audio || !(b[i + 1] & 0x40)) { continue; }
        var p = tsPayload(b, i);
        if (p < 0 || b[p] !== 0 || b[p + 1] !== 0 || b[p + 2] !== 1) { continue; }
        var d = p + 9 + b[p + 8];
        if (d + 1 >= i + 188) { continue; }
        starts++;
        if (!adtsAt(b, d)) { mid++; }
    }
    if (starts < 2) { return { fix: false, sure: false, why: 'too little sound to tell' }; }
    return { fix: mid * 2 > starts, sure: true, why: mid + ' of ' + starts + ' sound packets start mid-frame' };
}
// A relay's state for its sound, across its segments (each the next one: what's left of a
// frame at a segment's end goes on in the next).
function liveAudio() { return { pid: null, pcr: null, sid: 0xc0, buf: allocBuffer(0), base: 0, marks: [], prev: null, prevDur: 0, cc: 0, seq: null, wait: true }; }
// The complete frames at the front of what's come so far, each with its time: a packet's own
// for the first frame starting in it, else the frame before's plus one frame.
function liveFrames(a, group) {
    while (a.buf.length >= 7) {
        var x = a.buf, k;
        if (!adtsAt(x, 0)) {   // (a frame's tail, or what can't be read: up to the next frame)
            for (k = 1; k + 1 < x.length && !adtsAt(x, k); k++) {}
            liveDrop(a, k);
            continue;
        }
        var len = ((x[3] & 3) << 11) | (x[4] << 3) | (x[5] >> 5), rate = ADTS_RATES[(x[2] >> 2) & 15];
        if (len < 7 || !rate) { liveDrop(a, 1); continue; }
        if (x.length < len) { break; }
        var pts = null;
        while (a.marks.length && a.marks[0][0] <= a.base) { pts = a.marks.shift()[1]; }
        if (pts === null && a.prev !== null) { pts = a.prev + a.prevDur; }
        a.prev = pts; a.prevDur = 1024 * 90000 / rate * ((x[6] & 3) + 1);
        if (pts !== null) { group.push({ data: x.slice(0, len), pts: pts, dur: a.prevDur }); }
        liveDrop(a, len);
    }
}
function liveDrop(a, k) { a.buf = a.buf.slice(k); a.base += k; }
// Frames out as PES packets (one per run of frames back to back), in TS packets.
function livePes(a, group) {
    var out = [], run = [];
    function pes() {
        if (!run.length) { return; }
        var payload = Buffer.concat(run.map(function (f) { return f.data; })), head = allocBuffer(14), plen = 8 + payload.length;
        head[0] = 0; head[1] = 0; head[2] = 1; head[3] = a.sid;
        if (plen > 65535) { plen = 0; }
        head[4] = plen >> 8; head[5] = plen & 255; head[6] = 0x84; head[7] = 0x80; head[8] = 5;
        writePts(head, 9, run[0].pts);
        var all = Buffer.concat([head, payload]);
        for (var o = 0; o < all.length; o += 184) {
            var n = Math.min(184, all.length - o), t = allocBuffer(188), h = 4;
            t[0] = 0x47; t[1] = (o === 0 ? 0x40 : 0) | ((a.pid >> 8) & 0x1f); t[2] = a.pid & 255;
            if (n < 184) {
                var af = 183 - n;
                t[3] = 0x30 | a.cc; t[4] = af;
                if (af > 0) { t[5] = 0; t.fill(0xff, 6, 5 + af); }
                h = 5 + af;
            } else { t[3] = 0x10 | a.cc; }
            a.cc = (a.cc + 1) & 15;
            all.copy(t, h, o, o + n);
            out.push(t);
        }
        run = [];
    }
    group.forEach(function (f) {
        var last = run[run.length - 1];
        if (last && Math.abs(f.pts - (last.pts + last.dur)) > last.dur / 2) { pes(); }
        run.push(f);
    });
    pes();
    return Buffer.concat(out);
}
// A segment with its sound repacked; seq: its number in the playlist (the one after the last:
// it goes on from it; another: its sound from its first packet start).
function liveFix(s, b, seq) {
    var a = s.a;
    if (b.length < 188 || b[0] !== 0x47) { return b; }
    var pr = tsAudio(b);
    if (pr && pr.audio !== null) {
        if (a.pid !== pr.audio) { s.a = a = liveAudio(); a.pid = pr.audio; }
        a.pcr = pr.pcr;
    }
    if (a.pid === null || a.pcr === a.pid) { return b; }
    if (a.seq === null || seq !== a.seq + 1) { a.buf = allocBuffer(0); a.marks = []; a.prev = null; a.wait = true; }
    a.seq = seq;
    var out = [], from = 0, group = [];
    for (var i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47) { a.seq = null; return b; }   // (lost sync: as it is)
        if (tsPid(b, i) !== a.pid) { continue; }
        if (i > from) { out.push(b.slice(from, i)); }
        from = i + 188;
        var p = tsPayload(b, i), d = p;
        if (p < 0) { continue; }
        if (b[i + 1] & 0x40) {
            if (b[p] !== 0 || b[p + 1] !== 0 || b[p + 2] !== 1) { continue; }
            a.sid = b[p + 3];
            d = p + 9 + b[p + 8];
            if (group.length) { out.push(livePes(a, group)); group = []; }   // (what came before it, here)
            if (b[p + 7] & 0x80) { a.marks.push([a.base + a.buf.length, readPts(b, p + 9)]); }
            a.wait = false;
        }
        if (a.wait || d >= i + 188) { continue; }
        a.buf = Buffer.concat([a.buf, b.slice(d, i + 188)]);
        liveFrames(a, group);
    }
    if (from < b.length - b.length % 188) { out.push(b.slice(from, b.length - b.length % 188)); }
    if (group.length) { out.push(livePes(a, group)); }
    return Buffer.concat(out);
}

// ---- A live channel's closed captions (CEA-608, inside its picture) ----
// Some channels carry their subtitles as closed captions in the video itself (ATSC A/53: in each
// picture's own data, 'GA94'), which the TV's player doesn't show. The look (/live/open) says
// which caption channels have text (cc: [{ ch: 'CC1', lang }]); asked for (&cc=CC1-en,CC3), the
// relay adds a subtitle track for each: a WebVTT playlist (/live/<id>/c?n=) whose segments
// (/live/<id>/v?n=) hold the captions of the picture's own segments, read from them as they pass
// (one download for both: liveShared). CC1/CC2 are the first field's two channels, CC3/CC4 the
// second's. Pop-on captions (films) become a cue each; roll-up ones (live shows) a cue per
// finished line, with the lines above it.
var CC_KEEP = 30, CC_BODIES = 2, CC_BODY_MAX = 8 * 1048576, CC_BODY_MS = 30000, CC_PROBE = 8 * 1048576;
var CC_VIDEO = { 0x1b: true, 0x24: true, 0x02: false };   // (H.264, HEVC: their bytes escaped; MPEG-2 video: not)
var CC_ROW = [11, 1, 3, 12, 14, 5, 7, 9];   // (a row code's first byte, low 3 bits: its row, 1–15; the next one down with 0x20 in the second)
var CC_BASIC = { 0x2a: 'á', 0x5c: 'é', 0x5e: 'í', 0x5f: 'ó', 0x60: 'ú', 0x7b: 'ç', 0x7c: '÷', 0x7d: 'Ñ', 0x7e: 'ñ', 0x7f: '█' };
var CC_SPECIAL = '®°½¿™¢£♪à èâêîôû';
var CC_EXT = ['ÁÉÓÚÜü‘¡*’—©℠•“”ÀÂÇÈÊËëÎÏïÔÙùÛ«»',
    'ÃãÍÌìÒòÕõ{}\\^_|~ÄäÖöß¥¤¦ÅåØø┌┐└┘'];
var CC_WORDS = { en: / (the|you|and|that|what|this|it|is|to|of|don't|i'm|we|are)(?= )/g, es: / (que|el|los|las|es|por|una|con|para|está|qué|no|lo|se|del)(?= )/g, pt: / (não|você|uma|com|para|isso|está|que|o|é|do|da)(?= )/g };
var GA94 = toBuffer('GA94');
var _ccTag = 0;
// A picture's caption pairs: [field, b1, b2, …] (parity off; empty ones left out).
function ccPairs(d, esc) {
    var out = [], k = 0;
    while ((k = d.indexOf(GA94, k)) >= 0) {
        var at = k, w, i;
        k += 4;
        if (!((at >= 3 && d[at - 3] === 0xb5 && d[at - 2] === 0 && d[at - 1] === 0x31) || (at >= 4 && d[at - 4] === 0 && d[at - 3] === 0 && d[at - 2] === 1 && d[at - 1] === 0xb2))) { continue; }
        if (d[k] !== 3) { continue; }
        w = d.slice(k + 1, k + 1 + 2 + 31 * 3 + 12);
        if (esc) {   // (H.264 / HEVC: a 3 after two zeros is only there to break a start code)
            var raw = w, z = 0;
            w = [];
            for (i = 0; i < raw.length; i++) { if (z >= 2 && raw[i] === 3) { z = 0; continue; } w.push(raw[i]); z = raw[i] === 0 ? z + 1 : 0; }
        }
        if (w.length < 2 || !(w[0] & 0x40)) { continue; }
        for (i = 0; i < (w[0] & 0x1f) && 2 + 3 * i + 2 < w.length; i++) {
            var m = w[2 + 3 * i], b1 = w[3 + 3 * i] & 0x7f, b2 = w[4 + 3 * i] & 0x7f;
            if ((m & 4) && (m & 3) < 2 && (b1 || b2)) { out.push(m & 3, b1, b2); }
        }
    }
    return out;
}
// A segment's pictures with captions, in the order they're shown: { start, end, frames: [{ pts,
// pairs }] } (times unwrapped from the first picture's), or null (no video it can read).
function ccFrames(b) {
    var pr = tsProgram(b), v = null, i;
    if (!pr) { return null; }
    for (i = 0; i < pr.list.length && !v; i++) { if (CC_VIDEO[pr.list[i].type] !== undefined) { v = pr.list[i]; } }
    if (!v) { return null; }
    var esc = CC_VIDEO[v.type], frames = [], cur = null, base = null, lo = null, hi = null, n = 0;
    function done() {
        if (!cur) { return; }
        var d = Buffer.concat(cur.parts);
        cur.parts = null;
        if (cur.pts !== null) {
            if (base === null) { base = cur.pts; }
            var r = cur.pts - base;
            if (r > 4294967296) { r -= 8589934592; } else if (r < -4294967296) { r += 8589934592; }
            cur.pts = base + r; n++;
            if (lo === null || cur.pts < lo) { lo = cur.pts; }
            if (hi === null || cur.pts > hi) { hi = cur.pts; }
            cur.pairs = ccPairs(d, esc);
            if (cur.pairs.length) { frames.push(cur); }
        }
        cur = null;
    }
    for (i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47) { break; }
        if (tsPid(b, i) !== v.pid) { continue; }
        var p = tsPayload(b, i);
        if (p < 0) { continue; }
        if (b[i + 1] & 0x40) {
            done();
            if (b[p] !== 0 || b[p + 1] !== 0 || b[p + 2] !== 1 || p + 9 + b[p + 8] > i + 188) { continue; }
            cur = { pts: (b[p + 7] & 0x80) ? readPts(b, p + 9) : null, parts: [b.slice(p + 9 + b[p + 8], i + 188)] };
        } else if (cur) { cur.parts.push(b.slice(p, i + 188)); }
    }
    done();
    if (lo === null) { return null; }
    frames.sort(function (x, y) { return x.pts - y.pts; });
    return { start: lo, end: hi + (n > 1 ? (hi - lo) / (n - 1) : 3003), frames: frames };
}
function ccRows() { var r = []; for (var i = 0; i < 15; i++) { r.push([]); } return r; }
// One caption channel: what's on screen (rows) and what's being written off it (back, pop-on),
// the cursor, and the cue it shows since when.
function ccChan() { return { mode: 'pop', rows: ccRows(), back: ccRows(), roll: 2, row: 14, col: 0, shown: '', since: 0, out: null, seen: '' }; }
function ccField() { return { ch: 0, last: -1, xds: false }; }
function ccState() { return { f: [ccField(), ccField()], d: [ccChan(), ccChan(), ccChan(), ccChan()], seq: null, segs: Object.create(null), order: [] }; }
function ccText(rows) {
    var out = [];
    for (var r = 0; r < rows.length; r++) { var s = rows[r].join('').replace(/^\s+|\s+$/g, ''); if (s) { out.push(s); } }
    return out.join('\n');
}
// The screen changed (or may have): the cue up to now out, a new one from now.
function ccCommit(c, t) {
    var s = ccText(c.rows);
    if (s === c.shown) { return; }
    if (c.shown && c.out && t > c.since) { c.out.push({ from: c.since, to: t, text: c.shown }); }
    c.shown = s; c.since = t;
}
function ccPut(c, ch) {
    if (c.mode === 'text') { return; }
    var line = (c.mode === 'pop' ? c.back : c.rows)[c.row];
    while (line.length < c.col) { line.push(' '); }
    line[c.col] = ch;
    if (c.col < 31) { c.col++; }
    if (c.seen.length < 4000) { c.seen += ch; }
}
function ccRoll(c) {   // (roll-up: the lines move up one, the bottom one starts empty)
    var top = c.row - c.roll + 1, r;
    for (r = 0; r < 15; r++) { if (r < top || r > c.row) { c.rows[r] = []; } }
    for (r = Math.max(top, 0); r < c.row; r++) { c.rows[r] = c.rows[r + 1]; }
    c.rows[c.row] = []; c.col = 0;
}
// A control code (its channel bit off: 0x10–0x17 first).
function ccControl(c, b1, b2, t) {
    if ((b1 === 0x14 || b1 === 0x15) && b2 >= 0x20 && b2 <= 0x2f) {
        var line = (c.mode === 'pop' ? c.back : c.rows)[c.row];
        if (b2 === 0x20) { c.mode = 'pop'; }   // (resume loading: pop-on)
        else if (b2 === 0x21) { if (c.col > 0) { c.col--; if (line.length > c.col) { line[c.col] = ' '; } } }   // (backspace)
        else if (b2 === 0x24) { if (line.length > c.col) { line.length = c.col; } }   // (delete to the end of the row)
        else if (b2 >= 0x25 && b2 <= 0x27) {   // (roll-up, 2–4 rows)
            if (c.mode !== 'roll') { c.rows = ccRows(); c.back = ccRows(); c.row = 14; c.col = 0; }
            c.mode = 'roll'; c.roll = b2 - 0x23;
            ccCommit(c, t);
        }
        else if (b2 === 0x29) { c.mode = 'paint'; }   // (paint-on)
        else if (b2 === 0x2a || b2 === 0x2b) { c.mode = 'text'; }   // (text mode: not captions)
        else if (b2 === 0x2c) { c.rows = ccRows(); ccCommit(c, t); }   // (erase what's shown)
        else if (b2 === 0x2d) { if (c.mode === 'roll') { ccCommit(c, t); ccRoll(c); } else { if (c.mode === 'paint') { ccCommit(c, t); } c.col = 0; } }   // (carriage return: roll-up shows the lines as they stand once one's finished)
        else if (b2 === 0x2e) { c.back = ccRows(); }   // (erase what's being written)
        else if (b2 === 0x2f) { var x = c.rows; c.rows = c.back; c.back = x; c.mode = 'pop'; ccCommit(c, t); }   // (end of caption: it shows)
        return;
    }
    if (b1 === 0x17 && b2 >= 0x21 && b2 <= 0x23) { c.col = Math.min(31, c.col + b2 - 0x20); return; }   // (tab)
    if (b1 === 0x11 && b2 >= 0x20 && b2 <= 0x2f) { ccPut(c, ' '); return; }   // (a style change: shows as a space)
    if (b1 === 0x11 && b2 >= 0x30 && b2 <= 0x3f) { ccPut(c, CC_SPECIAL.charAt(b2 - 0x30)); return; }
    if ((b1 === 0x12 || b1 === 0x13) && b2 >= 0x20 && b2 <= 0x3f) {   // (an accented letter: in place of the plain one sent before it)
        if (c.col > 0) { c.col--; }
        ccPut(c, CC_EXT[b1 - 0x12].charAt(b2 - 0x20));
        return;
    }
    if (b2 >= 0x40 && b2 <= 0x7f && !(b1 === 0x10 && b2 >= 0x60)) {   // (a row and indent)
        var row = CC_ROW[b1 & 7] + ((b2 & 0x20) ? 1 : 0) - 1;
        if (c.mode === 'roll' && row !== c.row) {   // (the roll-up lines move to it)
            var moved = ccRows();
            for (var k = 0; k < c.roll; k++) { if (c.row - k >= 0 && row - k >= 0) { moved[row - k] = c.rows[c.row - k]; } }
            c.rows = moved;
        }
        if (c.mode === 'paint') { ccCommit(c, t); }
        c.row = row; c.col = (b2 & 0x10) ? ((b2 & 0x0e) >> 1) * 4 : 0;
    }
}
function ccFeed(st, field, b1, b2, t) {
    var f = st.f[field], c;
    if (b1 >= 0x01 && b1 <= 0x0f) { f.xds = b1 !== 0x0f; f.last = -1; return; }   // (programme data, not captions)
    if (b1 >= 0x10 && b1 <= 0x1f) {
        f.xds = false;
        var code = (b1 << 8) | b2;
        if (code === f.last) { f.last = -1; return; }   // (each control code is sent twice)
        f.last = code; f.ch = (b1 & 0x08) ? 1 : 0;
        ccControl(st.d[field * 2 + f.ch], b1 & 0xf7, b2, t);
        return;
    }
    if (f.xds) { return; }
    f.last = -1; c = st.d[field * 2 + f.ch];
    if (b1 >= 0x20) { ccPut(c, CC_BASIC[b1] || String.fromCharCode(b1)); }
    if (b2 >= 0x20) { ccPut(c, CC_BASIC[b2] || String.fromCharCode(b2)); }
}
// A segment's cues per caption channel ({ start, cues: [[…CC1], …] }), read once (by number:
// asked again, the same), the channels going on from the segment before when it's the next one.
function ccSegment(st, b, seq) {
    if (st.segs[seq]) { return st.segs[seq]; }
    var fr = ccFrames(b), seg = { start: fr ? fr.start : 0, cues: [[], [], [], []] }, k;
    if (!fr || st.seq === null || seq !== st.seq + 1) { st.f = [ccField(), ccField()]; st.d = [ccChan(), ccChan(), ccChan(), ccChan()]; }
    st.seq = fr ? seq : null;
    if (fr) {
        for (k = 0; k < 4; k++) { st.d[k].out = seg.cues[k]; st.d[k].since = fr.start; }
        fr.frames.forEach(function (f) { for (var j = 0; j + 2 < f.pairs.length; j += 3) { ccFeed(st, f.pairs[j], f.pairs[j + 1], f.pairs[j + 2], f.pts); } });
        for (k = 0; k < 4; k++) {   // (what's still on: up to the segment's end, and on from the next one's start)
            var c = st.d[k];
            if (c.shown && fr.end > c.since) { c.out.push({ from: c.since, to: fr.end, text: c.shown }); }
            c.out = null;
        }
    }
    st.segs[seq] = seg; st.order.push(seq);
    while (st.order.length > CC_KEEP) { delete st.segs[st.order.shift()]; }
    return seg;
}
// Which caption channels have text in a segment, and their language when the words say it:
// [{ ch: 'CC1', lang: 'en' }] (null: no captions in it at all).
function ccFound(b) {
    var fr = ccFrames(b);
    if (!fr || !fr.frames.length) { return null; }
    var st = ccState(), out = [];
    fr.frames.forEach(function (f) { for (var j = 0; j + 2 < f.pairs.length; j += 3) { ccFeed(st, f.pairs[j], f.pairs[j + 1], f.pairs[j + 2], f.pts); } });
    st.d.forEach(function (c, k) {
        var words = ' ' + c.seen.replace(/[^A-Za-zÀ-ÿ']+/g, ' ').toLowerCase() + ' ';
        if (!/[a-zà-ÿ]{2}/.test(words)) { return; }
        var best = '', n1 = 0, n2 = 0;
        Object.keys(CC_WORDS).forEach(function (l) {
            var n = (words.match(CC_WORDS[l]) || []).length;
            if (n > n1) { n2 = n1; n1 = n; best = l; } else if (n > n2) { n2 = n; }
        });
        out.push({ ch: 'CC' + (k + 1), lang: n1 >= 3 && n1 >= n2 * 1.5 ? best : '' });
    });
    return out;
}
function ccTime(v) {
    v = Math.max(0, Math.round(v / 90));
    function two(x) { return (x < 10 ? '0' : '') + x; }
    var ms = v % 1000;
    return two(Math.floor(v / 3600000)) + ':' + two(Math.floor(v / 60000) % 60) + ':' + two(Math.floor(v / 1000) % 60) + '.' + (ms < 100 ? (ms < 10 ? '00' : '0') : '') + ms;
}
// A segment's WebVTT for caption channel k (0–3): its times on the picture's own clock.
function ccVtt(seg, k) {
    var out = ['WEBVTT', 'X-TIMESTAMP-MAP=MPEGTS:' + ((Math.round(seg.start) % 8589934592) + 8589934592) % 8589934592 + ',LOCAL:00:00:00.000', ''];
    seg.cues[k].forEach(function (q) {
        out.push(ccTime(q.from - seg.start) + ' --> ' + ccTime(q.to - seg.start), q.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), '');
    });
    return out.join('\n');
}
// The caption channels asked for: [{ k: 0–3, lang }] from 'CC1-en,CC3' (others left out).
function ccAsked(v) {
    var out = [];
    String(v || '').split(',').forEach(function (x) {
        var m = /^CC([1-4])(?:-([a-z]{2,3}))?$/.exec(x);
        if (m && !out.some(function (o) { return o.k === m[1] - 1; })) { out.push({ k: m[1] - 1, lang: m[2] || '' }); }
    });
    return out;
}
// A segment downloaded once for its picture and its captions, whichever asks first: kept a
// little (CC_BODIES, each up to CC_BODY_MAX, CC_BODY_MS) for the other. Returns its leave():
// the download stops when no one waits for it any more.
function liveShared(url, s, max, cb) {   // (as liveGet: s, the relay, is who asks)
    var now = Date.now(), e = s.got[url];
    Object.keys(s.got).forEach(function (u) { var x = s.got[u]; if (x.body && now - x.t > CC_BODY_MS) { delete s.got[u]; } });
    e = s.got[url];
    if (e && e.body) { cb(null, e.body, e.at); return function () {}; }
    if (!e) {
        e = s.got[url] = { cbs: [], tag: ++_ccTag };
        e.stop = liveGet(url, s, max, function (err, body, at) {
            var cbs = e.cbs;
            e.cbs = [];
            if (s.got[url] === e) {
                if (err || body.length > CC_BODY_MAX) { delete s.got[url]; }
                else {
                    e.body = body; e.at = at; e.t = Date.now();
                    var kept = Object.keys(s.got).filter(function (u) { return s.got[u].body; }).sort(function (x, y) { return s.got[x].tag - s.got[y].tag; });
                    while (kept.length > CC_BODIES) { delete s.got[kept.shift()]; }
                }
            }
            cbs.forEach(function (f) { f(err, body, at); });
        });
    }
    e.cbs.push(cb);
    return function () {
        var i = e.cbs.indexOf(cb);
        if (i >= 0) { e.cbs.splice(i, 1); }
        if (!e.cbs.length && !e.body) { if (s.got[url] === e) { delete s.got[url]; } e.stop(); }
    };
}
// The top playlist with the captions as subtitle tracks: a quality list gets them added (each
// quality naming them); a plain one is put under a made-up quality list of its own (p).
function ccMaster(s, text, base) {
    var pre = liveBase(s), lines = String(text).split(/\r?\n/), uris = lines.map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#'; });
    if (!uris.length || /#EXT-X-STREAM-INF:[^\n]*SUBTITLES=|#EXT-X-KEY:METHOD=(?!NONE)|#EXT-X-MAP/.test(text)) { return liveRewrite(s, text, base); }
    var master = /#EXT-X-STREAM-INF/.test(text), media = master ? urllib.resolve(base, uris[0]) : base;
    var tracks = s.cc.map(function (c) {
        var name = 'Closed captions (CC' + (c.k + 1) + ')';
        return '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="cc",NAME="' + name + '",' + (c.lang ? 'LANGUAGE="' + c.lang + '",' : '') + 'DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="' + pre + 'c?n=' + liveLink(s, media, 'c', undefined, c.k) + '"';
    });
    if (!master) {
        return ['#EXTM3U'].concat(tracks, ['#EXT-X-STREAM-INF:BANDWIDTH=2000000,SUBTITLES="cc"', pre + 'p?n=' + liveLink(s, base, 'p')]).join('\n') + '\n';
    }
    var out = liveRewrite(s, text, base).split('\n').map(function (l) { return /^#EXT-X-STREAM-INF:/.test(l.trim()) ? l.replace(/\s+$/, '') + ',SUBTITLES="cc"' : l; });
    var head = 0;
    while (head < out.length && !/^#EXTM3U/.test(out[head].trim())) { head++; }
    return out.slice(0, head + 1).concat(tracks, out.slice(head + 1)).join('\n');
}
// A caption track's playlist: the picture's own segments, each as its captions (v).
function ccList(s, text, base, k) {
    var sq = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/.exec(text), seq = sq ? +sq[1] : 0, pre = liveBase(s);
    return String(text).split(/\r?\n/).filter(function (ln) { return !/^#EXT-X-(KEY|MAP|BYTERANGE|STREAM-INF|MEDIA:|I-FRAME)/.test(ln.trim()); }).map(function (ln) {
        var t = ln.trim();
        if (!t || t.charAt(0) === '#') { return ln; }
        return pre + 'v?n=' + liveLink(s, urllib.resolve(base, t), 'v', seq++, k);
    }).join('\n');
}

// A playlist with its links through the relay: a master's variants and renditions (m), a media
// playlist's segments (s, numbered from its media sequence); encrypted or fMP4 segments, keys:
// fetched directly (their absolute links).
function liveLink(s, url, kind, seq, ch) {
    var key = kind + (ch !== undefined ? ch : '') + ' ' + url;
    if (s.at[key] !== undefined) { return s.at[key]; }
    var n = s.next++;
    s.links[n] = { url: url, kind: kind, seq: seq, ch: ch, key: key };
    s.at[key] = n;
    var old = s.links[n - LIVE_LINKS];
    if (old) { delete s.at[old.key]; delete s.links[n - LIVE_LINKS]; }
    return n;
}
function liveBase(s) { return 'http://localhost:' + PORT + '/live/' + s.id + '/'; }
function liveRewrite(s, text, base) {
    var master = /#EXT-X-STREAM-INF/.test(text), direct = !master && /#EXT-X-KEY:METHOD=(?!NONE)|#EXT-X-MAP/.test(text);
    var sq = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/.exec(text), seq = sq ? +sq[1] : 0, pre = liveBase(s);
    return String(text).split(/\r?\n/).map(function (ln) {
        var t = ln.trim();
        if (!t) { return ln; }
        if (t.charAt(0) === '#') {
            return t.replace(/URI="([^"]*)"/, function (all, v) {
                var abs = urllib.resolve(base, v);
                return 'URI="' + (/^#EXT-X-MEDIA:/.test(t) ? pre + 'm?n=' + liveLink(s, abs, 'm') : abs) + '"';
            });
        }
        var abs = urllib.resolve(base, t);
        if (master) { return pre + 'm?n=' + liveLink(s, abs, 'm'); }
        if (direct) { seq++; return abs; }
        return pre + 's?n=' + liveLink(s, abs, 's', seq++);
    }).join('\n');
}
// opts: { fix: the sound repacked, cc: the caption channels added (ccAsked) }.
function liveSession(u, who, opts) {
    var ids = Object.keys(_live);
    if (ids.length >= LIVE_MAX) {   // (the one asked for longest ago goes)
        ids.sort(function (x, y) { return _live[x].last - _live[y].last; });
        delete _live[ids[0]];
    }
    var s = { id: crypto.randomBytes(16).toString('hex'), ua: who.ua, ref: who.ref, links: {}, at: {}, next: 0, last: Date.now(), a: liveAudio(),
        fix: opts.fix !== false, cc: opts.cc && opts.cc.length ? opts.cc : null, c: ccState(), got: Object.create(null) };
    _live[s.id] = s;
    s.top = liveLink(s, u, 'm');
    return s;
}
function livePurge() {
    var now = Date.now();
    Object.keys(_live).forEach(function (id) { if (now - _live[id].last > LIVE_IDLE_MS) { delete _live[id]; } });
}
// The look: the playlist (a master's first variant), then the start of the segment a player
// starts with (the third from the end); with captions in that start, the whole segment (up to
// CC_PROBE) for which caption channels have text: cc, ccSure (false: none had text in it).
function liveProbe(u, who, cb, leaving) {
    var depth = 0;
    function list(url) {
        leaving.push(liveGet(url, who, LIVE_LIST_MAX, function (err, body, at) {
            if (err) { cb(err); return; }
            var text = body.toString('utf8');
            if (!/^\s*#EXTM3U/.test(text)) { cb(null, { fix: false, sure: true, why: 'not an HLS playlist' }); return; }
            var uris = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#'; });
            if (/#EXT-X-STREAM-INF/.test(text)) {
                if (!uris.length || ++depth > 2) { cb(null, { fix: false, sure: true, why: 'no variant' }); return; }
                list(urllib.resolve(at, uris[0]));
                return;
            }
            if (/#EXT-X-KEY:METHOD=(?!NONE)|#EXT-X-MAP/.test(text)) { cb(null, { fix: false, sure: true, why: 'encrypted or fMP4 segments' }); return; }
            if (!uris.length) { cb(null, { fix: false, sure: false, why: 'no segments yet' }); return; }
            var su = urllib.resolve(at, uris[Math.max(0, uris.length - 3)]);
            leaving.push(liveGet(su, who, LIVE_PROBE, function (e2, seg) {
                if (e2) { cb(e2); return; }
                var v = liveCut(seg), found = null;
                try { found = ccFound(seg); } catch (e) { found = null; }
                if (!found) { v.cc = []; v.ccSure = true; cb(null, v); return; }
                leaving.push(liveGet(su, who, CC_PROBE, function (e3, whole) {
                    try { found = e3 ? found : (ccFound(whole) || found); } catch (e) {}
                    v.cc = found; v.ccSure = found.length > 0;
                    cb(null, v);
                }, true));
            }, true));
        }));
    }
    list(u);
}
function liveHeader(v) { v = String(v || ''); return /^[\x20-\x7e]{1,300}$/.test(v) ? v : ''; }
function liveControl(req, res, path, query, leaving) {
    livePurge();
    var q = {};
    (query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } });
    if (path === '/live/master') {   // an HLS stream's quality list, asked with its own User-Agent / Referer (which a web page can't send)
        if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
        var mu = q.u || '';
        if (!/^https?:\/\/[^\s]+$/i.test(mu) || mu.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        leaving.push(liveGet(mu, { ua: liveHeader(q.ua), ref: liveHeader(q.ref) }, HLS_MASTER_MAX, function (err, buf) {
            if (err) { send(res, err.status || 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            var text = buf.toString('utf8').replace(/^\uFEFF/, '');
            if (text.replace(/^\s+/, '').indexOf('#EXTM3U') !== 0) { send(res, 502, 'text/plain', 'not an HLS playlist'); return; }
            send(res, 200, 'application/vnd.apple.mpegurl', text);
        }));
        return;
    }
    if (path === '/live/open') {
        if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
        var u = q.u || '', who = { ua: liveHeader(q.ua), ref: liveHeader(q.ref) };
        if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        var cc = ccAsked(q.cc);
        if (q.force === '1') {
            var sf = liveSession(u, who, { fix: q.fix !== '0', cc: cc });
            send(res, 200, 'application/json', JSON.stringify({ fix: true, sure: true, why: 'asked for', url: liveBase(sf) + 'm?n=' + sf.top }));
            return;
        }
        liveProbe(u, who, function (err, v) {
            if (err) { send(res, 200, 'application/json', JSON.stringify({ fix: false, sure: false, why: 'couldn\'t check: ' + (err.message || 'unknown') })); return; }
            if (v.fix) { var s = liveSession(u, who, { fix: true, cc: cc }); v.url = liveBase(s) + 'm?n=' + s.top; }
            send(res, 200, 'application/json', JSON.stringify(v));
        }, leaving);
        return;
    }
    // (m: a playlist; p: the top one under its made-up quality list; s: a segment; c: a caption
    // track's playlist; v: a segment's captions)
    var m = /^\/live\/([0-9a-f]{32})\/(m|p|s|c|v)$/.exec(path), s = m && _live[m[1]], link = s && /^\d+$/.test(q.n || '') ? s.links[+q.n] : null;
    if (!link || link.kind !== m[2]) { send(res, 404, 'text/plain', 'not found'); return; }
    s.last = Date.now();
    var kind = m[2], seg = kind === 's' || kind === 'v';
    function captions(body) {
        try { return ccSegment(s.c, body, link.seq); } catch (e) { log('live captions: ' + (e && e.message)); s.c = ccState(); return null; }
    }
    if (kind === 'v' && s.c.segs[link.seq]) { send(res, 200, 'text/vtt; charset=utf-8', ccVtt(s.c.segs[link.seq], link.ch)); return; }
    leaving.push((seg && s.cc ? liveShared : liveGet)(link.url, s, seg ? LIVE_SEG_MAX : LIVE_LIST_MAX, function (err, body, at) {
        if (err) { send(res, err.status || 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
        if (kind === 'v') { var cs = captions(body); send(res, 200, 'text/vtt; charset=utf-8', cs ? ccVtt(cs, link.ch) : 'WEBVTT\n'); return; }
        if (kind === 'c') { send(res, 200, 'application/vnd.apple.mpegurl', ccList(s, body.toString('utf8'), at, link.ch)); return; }
        if (kind !== 's') { send(res, 200, 'application/vnd.apple.mpegurl', s.cc && kind === 'm' && +q.n === s.top ? ccMaster(s, body.toString('utf8'), at) : liveRewrite(s, body.toString('utf8'), at)); return; }
        var out = body;
        if (s.cc) { captions(body); }
        if (s.fix) { try { out = liveFix(s, body, link.seq); } catch (e) { log('live: ' + (e && e.message)); s.a = liveAudio(); } }
        send(res, 200, 'video/mp2t', out);
    }));
}

// ---- AIOManager (/aiom/addons) ----
// The addons of an AIOManager account, read with its Hydra API (GET <base>/hydra/addons, the
// account's API key in X-API-Key) for StremioK's Settings › Addons › Import addons from
// AIOManager; then StremioK registered as a Pull app (POST <base>/hydra/register: its card in
// AIOManager's Connections, with when it last read). Here rather than in the app: an instance
// only answers the web origins it's set to (CORS_ORIGINS). Nothing is written to AIOManager.
var AIOM_MS = 20000, AIOM_MAX = 2 * 1048576;
// A redirect it follows with the key: the same server only (its name and port; plain HTTP may
// move to HTTPS on the default ports, never the other way). The key goes nowhere else.
function sameServerRedirect(from, to) {
    if (!to || (to.protocol !== 'http:' && to.protocol !== 'https:') || String(to.hostname || '').toLowerCase() !== String(from.hostname || '').toLowerCase()) { return false; }
    function port(u) { return +(u.port || (u.protocol === 'https:' ? 443 : 80)); }
    if (from.protocol === to.protocol) { return port(from) === port(to); }
    return from.protocol === 'http:' && to.protocol === 'https:' && !from.port && !to.port;
}
// One request (with its redirects) to an AIOManager instance: one deadline for the whole chain,
// and the abort it returns stops whichever request is under way.
function hydraReq(method, url, key, body, cb) {
    cb = once(cb);
    var ctl = { r: null, done: false }, first = null;
    try { first = urllib.parse(url); } catch (e) { first = null; }
    var timer = setTimeout(function () { finish(upError('AIOManager didn\'t answer', 504)); }, AIOM_MS);
    function finish(err, sc, text) { if (ctl.done) { return; } ctl.done = true; clearTimeout(timer); try { if (ctl.r) { ctl.r.abort(); } } catch (e) {} cb(err, sc, text); }
    function go(u, hops) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { finish(upError('bad address', 400)); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { finish(upError('an address it can\'t reach', 400)); return; }
        var h = { 'X-API-Key': key, 'Accept': 'application/json', 'User-Agent': 'StremioK' }, data = body ? toBuffer(JSON.stringify(body)) : null;
        if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: method, headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        var chunks = [], size = 0;
        try {
            var r = ctl.r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (ctl.done || ctl.r !== r) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && method === 'GET' && hops < 4) {
                    resp.resume();
                    var next = urllib.resolve(u, resp.headers.location), np = null;
                    try { np = urllib.parse(next); } catch (e) { np = null; }
                    if (!sameServerRedirect(first, np)) { finish(upError('AIOManager redirected to another server: not followed (your API key stays with it)', 502)); return; }
                    go(next, hops + 1);
                    return;
                }
                resp.on('data', function (c) { if (ctl.done) { return; } chunks.push(c); size += c.length; if (size > AIOM_MAX) { finish(upError('too large an answer', 502)); } });
                resp.on('end', function () { if (sc !== 200) { finish(upError('HTTP ' + sc, sc === 401 || sc === 403 ? 401 : 502)); return; } finish(null, sc, Buffer.concat(chunks, size).toString('utf8')); });
                resp.on('error', function (e) { finish(e); });
            });
            r.on('error', function (e) { if (ctl.r === r) { finish(upError('couldn\'t reach it (' + (e.code || e.message) + ')', 502)); } });
            guardSelf(r, function () { finish(upError('an address it can\'t reach', 400)); });
            if (data) { r.write(data); }
            r.end();
        } catch (e) { finish(e); }
    }
    go(url, 0);
    return function () { if (!ctl.done) { ctl.done = true; clearTimeout(timer); try { if (ctl.r) { ctl.r.abort(); } } catch (e) {} } };
}
function aiomControl(req, res, query, leaving) {
    if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
    var m = /(?:^|&)base=([^&]*)/.exec(query || ''), base = '';
    try { base = m ? decodeURIComponent(m[1]) : ''; } catch (e) { base = ''; }
    base = base.trim().replace(/\/+$/, '');
    var key = String((req.headers && req.headers['x-aiom-key']) || '');
    if (!/^https?:\/\/[^\s]+$/i.test(base) || base.length > 500) { send(res, 400, 'text/plain', 'bad address'); return; }
    if (!/^[\x21-\x7e]{6,300}$/.test(key)) { send(res, 400, 'text/plain', 'bad key'); return; }
    leaving.push(hydraReq('GET', base + '/hydra/addons', key, null, function (err, sc, text) {
        if (err) { send(res, err.status || 502, 'text/plain', (err.status === 401 ? 'AIOManager refused the API key' : 'failed: ' + (err.message || 'unknown'))); return; }
        var j = null;
        try { j = JSON.parse(text); } catch (e) { j = null; }
        if (!j || !Array.isArray(j.addons)) { send(res, 502, 'text/plain', 'not an AIOManager answer'); return; }
        var seen = {}, out = [];
        j.addons.slice(0, 500).forEach(function (a) {
            var u = a && typeof a.transportUrl === 'string' ? a.transportUrl.trim() : '';
            if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 2000 || seen[u]) { return; }
            seen[u] = 1;
            out.push({ url: u, name: String((a && a.name) || '').slice(0, 80), enabled: a.enabled !== false });
        });
        send(res, 200, 'application/json', JSON.stringify({ addons: out }));
        hydraReq('POST', base + '/hydra/register', key, { name: 'StremioK' }, noop);   // (its Connections card: best effort)
    }));
}

// ---- TV guide (/epg/load, /epg/get) ----
// A playlist's XMLTV guide, read for StremioK's channels only. The app sends their keys (epgKey:
// "i:" and a tvg-id, "n:" and a name without capitals, accents, spaces or HD / FHD / 4K tags) as
// a bitset (k: base64url; a key's FNV-1a hash picks its bit), and a guide's channel is kept when
// its id or one of its names is in it (a few others may slip through: harmless). Downloaded
// (gzipped or not) up to EPG_MAX, read a piece at a time up to EPG_XML_MAX unpacked, within
// EPG_MS (past a limit: what was read, "partial"); programs from EPG_BEFORE ago to EPG_AFTER
// ahead, EPG_PER a channel, EPG_TOTAL in all. One guide read at a time, EPG_GUIDES kept. On the
// sideloaded app saved in its folder (epg-<hash>.json), read again after EPG_FRESH_MS; under
// TizenBrew (no folder) kept in memory. While a guide is read again, the last one still answers.
var EPG_MAX = 60 * 1048576, EPG_XML_MAX = 200 * 1048576, EPG_MS = 5 * 60000, EPG_BEFORE = 2 * 3600, EPG_AFTER = 30 * 3600;
var EPG_GET_BYTES = 2 * 1048576, EPG_BODY_MAX = 65536;   // (an /epg/get answer; a POST's body: the channels' keys)
var EPG_PER = 150, EPG_TOTAL = 60000, EPG_TITLE = 120, EPG_DESC = 200, EPG_GUIDES = 4, EPG_FRESH_MS = 6 * 3600000, EPG_RETRY_MS = 10 * 60000;
var _epg = Object.create(null), _epgQueue = [], _epgBusy = false;
var EPG_ACCENTS = { 'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ñ': 'n', 'ç': 'c' };
// A channel's key (the same as js/epg.js's EPG.key, see there): a tvg-id ("i:", iptv-org's feed
// after an @ left out) or a name ("n:", no capitals, accents, spaces, "TV" or HD tags), a country
// at the end kept apart after a dot. A guide's channel answers with it and without (epgKeys).
var EPG_COUNTRY = { ar: 'ar', arg: 'ar', mx: 'mx', mex: 'mx', us: 'us', usa: 'us', uk: 'uk', gb: 'uk', es: 'es', br: 'br', cl: 'cl', co: 'co', pe: 'pe',
    uy: 'uy', py: 'py', ve: 've', ec: 'ec', bo: 'bo', ca: 'ca', fr: 'fr', de: 'de', it: 'it', pt: 'pt' };
function epgParts(kind, s) {
    var t = String(s || '').toLowerCase().replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/g, function (c) { return EPG_ACCENTS[c]; }).trim(), cc = '', m;
    if (kind === 'i') { t = t.replace(/@.*$/, ''); }
    if ((m = /\.([a-z]{2})$/.exec(t))) { cc = m[1]; t = t.slice(0, -3); }
    else if (kind === 'n' && (m = /[\s_-]+([a-z]{2,3})$/.exec(t)) && EPG_COUNTRY[m[1]] && t.length > m[0].length) { cc = EPG_COUNTRY[m[1]]; t = t.slice(0, -m[0].length); }
    if (kind === 'n') { t = t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b(hd|fhd|uhd|sd|hq|4k|8k|hevc|h265|1080p?|720p?|tv)\b/g, ' '); }
    t = t.replace(/[^a-z0-9]+/g, '');
    if (kind === 'n' && t.length > 4) { t = t.replace(/tv$/, ''); }
    return { base: t.slice(0, 60), cc: cc };
}
function epgKey(kind, s) { var p = epgParts(kind, s); return p.base ? kind + ':' + p.base + (p.cc ? '.' + p.cc : '') : ''; }
function epgKeys(kind, s) { var p = epgParts(kind, s); return !p.base ? [] : p.cc ? [kind + ':' + p.base + '.' + p.cc, kind + ':' + p.base] : [kind + ':' + p.base]; }
function epgHash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return h;
}
function epgHas(bits, key) {
    if (!bits || !bits.length || !key) { return false; }
    var i = epgHash(key) % (bits.length * 8);
    return !!(bits[i >> 3] & (1 << (i & 7)));
}
function epgBits(k) {   // base64url -> bytes
    var b64 = String(k || '').replace(/-/g, '+').replace(/_/g, '/');
    try { return HAS_BUFFER_FROM ? Buffer.from(b64, 'base64') : new Buffer(b64, 'base64'); } catch (e) { return null; }
}
function epgTime(s) {   // "20261021203000 -0300" -> seconds
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s || '').trim());
    if (!m) { return 0; }
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
    if (m[7]) { t -= (m[7].charAt(0) === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 3600 + +m[7].slice(3, 5) * 60); }
    return Math.floor(t);
}
function epgText(s) {   // an element's text, or an attribute's: entities read, white space folded
    return noTags(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (all, e) {
        var l = e.toLowerCase();
        if (l.charAt(0) !== '#') { return { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }[l]; }
        var n = l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
        if (!(n > 0 && n < 0x110000)) { return ''; }
        if (n < 0x10000) { return String.fromCharCode(n); }
        n -= 0x10000;
        return String.fromCharCode(0xd800 + (n >> 10), 0xdc00 + (n & 0x3ff));
    }).replace(/\s+/g, ' ').trim();
}
function epgAttr(tag, name) {
    var m = new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"').exec(tag) || new RegExp('\\s' + name + '\\s*=\\s*\'([^\']*)\'').exec(tag);
    return m ? epgText(m[1]) : '';
}
function epgInner(el, name, all) {   // the text of a child element (all: of each one)
    var re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'g'), out = [], m;
    while ((m = re.exec(el))) { out.push(epgText(m[1])); if (!all) { break; } }
    return all ? out : (out[0] || '');
}
// What a program is, from its <category>s: { m: 'movie' | 'series', o: its original title, y:
// its year } (what's known), or null. A film's often reads "The Book ThiefDrama / 2013 / 7.6":
// the original title with the genre stuck on, the year, a rating ("Acción / 2015": no title).
var EPG_GENRES = ['Ciencia ficción', 'C.Ficción', 'Acción', 'Animación', 'Aventura', 'Biográfico', 'Bélica', 'Comedia', 'Crimen', 'Deportivo',
    'Documental', 'Drama', 'Familiar', 'Fantasía', 'Ficción', 'Histórico', 'Infantil', 'Misterio', 'Musical', 'Policial', 'Romance',
    'Romántica', 'Suspenso', 'Terror', 'Thriller', 'Western'];
function epgAbout(cats) {
    var out = null;
    (cats || []).forEach(function (c) {
        var parts = String(c).split(' / '), y = parts.length > 1 && /^(19|20)\d\d$/.test(parts[1].trim()) ? +parts[1].trim() : 0;
        if (y) {
            var t = parts[0].trim();
            for (var i = 0; i < EPG_GENRES.length; i++) {
                var g = EPG_GENRES[i];
                if (t.length > g.length && t.slice(-g.length).toLowerCase() === g.toLowerCase()) { t = t.slice(0, -g.length).trim(); break; }
                if (t.toLowerCase() === g.toLowerCase()) { t = ''; break; }
            }
            out = { m: 'movie', y: y };
            if (t) { out.o = t.slice(0, EPG_TITLE); }
        } else if (!out && /^(temporada \d+ episodio \d+|series|episode)$/i.test(String(c).trim())) {
            out = { m: 'series' };
        } else if (!out && /^(movie|feature film|película|pelicula|cine)$/i.test(String(c).trim())) {
            out = { m: 'movie' };
        }
    });
    return out;
}
// The reader: text in, a piece at a time (feed); <channel> and <programme> elements read as
// they complete.
function epgParser(want, now) {
    var p = { buf: '', channels: Object.create(null), keys: Object.create(null), progs: Object.create(null), icons: Object.create(null), count: 0, partial: false, isGuide: false };   // (no prototype: a channel id like "__proto__" or "constructor" is just a name)
    var from = now - EPG_BEFORE, to = now + EPG_AFTER;
    function channel(el) {
        var id = epgAttr(el.slice(0, el.indexOf('>') + 1), 'id');
        if (!id) { return; }
        var keys = epgKeys('i', id);
        epgInner(el, 'display-name', true).forEach(function (n) { keys = keys.concat(epgKeys('n', n)); });
        if (!keys.some(function (k) { return epgHas(want, k); })) { return; }
        p.channels[id] = 1;
        keys.forEach(function (k) { if (!p.keys[k]) { p.keys[k] = id; } });
        var icon = /<icon\s[^>]*\bsrc\s*=\s*["']([^"']{1,1000})["']/i.exec(el);   // (its logo: for a channel the playlist gives none)
        if (icon && /^https?:\/\/[^\s]+$/i.test(epgText(icon[1]))) { p.icons[id] = epgText(icon[1]); }
    }
    function programme(el) {
        var tag = el.slice(0, el.indexOf('>') + 1), ch = epgAttr(tag, 'channel');
        if (!ch || !p.channels[ch]) { return; }
        var start = epgTime(epgAttr(tag, 'start')), stop = epgTime(epgAttr(tag, 'stop')) || start + 1800;
        if (!start || stop <= from || start >= to || stop <= start) { return; }
        if (p.count >= EPG_TOTAL) { p.partial = true; return; }
        var row = [start, stop, epgInner(el, 'title').slice(0, EPG_TITLE) || '?', epgInner(el, 'desc').slice(0, EPG_DESC)];
        var pic = /<icon\s[^>]*\bsrc\s*=\s*["']([^"']{1,1000})["']/i.exec(el);   // (its picture)
        if (pic && /^https?:\/\/[^\s]+$/i.test(epgText(pic[1]))) { row.push(epgText(pic[1])); }
        var about = epgAbout(epgInner(el, 'category', true));
        if (about) { if (row.length < 5) { row.push(''); } row.push(about); }
        var l = p.progs[ch] = p.progs[ch] || [];
        l.push(row);
        p.count++;
        if (l.length > 2 * EPG_PER) {   // (held to EPG_PER as it's read, the earliest: a feed may list one channel's programs out of order)
            l.sort(function (a, b) { return a[0] - b[0]; });
            p.count -= l.length - EPG_PER;
            l.length = EPG_PER;
        }
    }
    p.feed = function (text) {
        if (!text) { return; }
        var b = p.buf + text, at = 0;
        if (!p.isGuide && /<tv[\s>]/.test(b)) { p.isGuide = true; }
        for (;;) {
            var c = b.indexOf('<channel', at), g = b.indexOf('<programme', at);
            var i = c === -1 ? g : g === -1 ? c : Math.min(c, g);
            if (i === -1) { at = Math.max(at, b.length - 16); break; }   // (an element's start may be split: kept)
            var isCh = i === c, gt = b.indexOf('>', i);
            if (gt === -1) { at = i; break; }
            if (b.charAt(gt - 1) === '/') { at = gt + 1; continue; }   // (<channel id="…"/>: nothing in it)
            var close = isCh ? '</channel>' : '</programme>', j = b.indexOf(close, gt);
            if (j === -1) { at = i; break; }
            if (isCh) { channel(b.slice(i, j)); } else { programme(b.slice(i, j)); }
            at = j + close.length;
        }
        p.buf = b.slice(at);
        if (p.buf.length > 4 * 1048576) { p.buf = p.buf.slice(-16); }   // (an element that never ends: not a guide's)
    };
    p.finish = function () {
        var total = 0;
        Object.keys(p.progs).forEach(function (ch) {
            var l = p.progs[ch].sort(function (a, b) { return a[0] - b[0]; });
            if (l.length > EPG_PER) { l = p.progs[ch] = l.slice(0, EPG_PER); }
            total += l.length;
        });
        p.count = total;
    };
    return p;
}
// The guide's download, unpacked if it's gzipped, its text handed to onText as it comes; past
// EPG_MAX / EPG_XML_MAX it stops there (cb(null, true): what was read is kept).
function epgFetch(url, onText, cb) {
    cb = once(cb);
    var hops = 0, r = null, done = false, got = 0, unpacked = 0, stopGz = null;
    var timer = setTimeout(function () { end(null, true); }, EPG_MS);
    function end(err, partial) { if (done) { return; } done = true; clearTimeout(timer); try { if (r) { r.abort(); } } catch (e) {} if (stopGz) { stopGz(); } cb(err, !!partial); }
    function get(u) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { end(upError('a bad link', 400)); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { end(upError('a link it can\'t follow', 400)); return; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, headers: { 'User-Agent': TV_UA, 'Accept-Encoding': 'gzip' } };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        try {
            r = (pu.protocol === 'https:' ? https : http).get(opts, function (resp) {
                if (done) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 5) { resp.resume(); hops++; get(urllib.resolve(u, resp.headers.location)); return; }
                if (sc !== 200) { resp.resume(); end(upError('HTTP ' + sc, 502)); return; }
                var dec = new StringDecoder('utf8'), gz = null, head = null;   // (head: the first bytes, until there are two to tell gzip by)
                function text(buf) {
                    if (done) { return; }
                    unpacked += buf.length;
                    try { onText(dec.write(buf)); } catch (e) { end(e); return; }
                    if (unpacked > EPG_XML_MAX) { end(null, true); }
                }
                var told = /gzip/i.test(String(resp.headers['content-encoding'] || '')), decided = false;
                function decide(b) {   // gzip (its header said so, or 1f 8b) or text
                    decided = true;
                    if (told || (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b)) {
                        gz = zlib.createGunzip();
                        gz.on('data', text);
                        gz.on('error', function () { end(upError('the guide couldn\'t be unpacked', 502)); });
                        gz.on('end', function () { if (!done) { try { onText(dec.end()); } catch (e) {} end(null); } });
                        stopGz = function () { try { gz.removeAllListeners('data'); if (gz.close) { gz.close(); } } catch (e) {} };
                    }
                }
                function feed(b) {
                    if (gz) { if (gz.write(b) === false && resp.pause) { resp.pause(); gz.once('drain', function () { if (!done && resp.resume) { resp.resume(); } }); } }
                    else { text(b); }
                }
                resp.on('data', function (chunk) {
                    if (done) { return; }
                    got += chunk.length;
                    if (!decided) {
                        head = head ? Buffer.concat([head, chunk]) : chunk;
                        if (head.length < 2 && !told) { return; }
                        decide(head);
                        chunk = head; head = null;
                    }
                    feed(chunk);
                    if (got > EPG_MAX) { end(null, true); }
                });
                resp.on('end', function () {
                    if (done) { return; }
                    if (!decided && head) { decide(head); feed(head); head = null; }
                    if (gz) { gz.end(); } else { try { onText(dec.end()); } catch (e) {} end(null); }
                });
                resp.on('error', function (e) { end(e); });
            });
            r.on('error', function (e) { end(upError('couldn\'t reach it (' + (e.code || e.message) + ')', 502)); });
            guardSelf(r, function () { end(upError('a link it can\'t follow', 400)); });
        } catch (e) { end(e); }
    }
    get(url);
}
function epgFile(url) { var d = tokenDir(); return d ? d + '/epg-' + epgHash(url).toString(36) + '.json' : null; }
// A saved guide is read only up to EPG_FILE_MAX (a bigger one is deleted); one saved more than
// EPG_KEEP_MS ago, of any guide, is deleted (looked at once, as the first guide is asked for).
var EPG_FILE_MAX = 32 * 1048576, EPG_KEEP_MS = 2 * 86400000, _epgSwept = false;
function epgSweep() {
    if (_epgSwept) { return; }
    _epgSwept = true;
    var d = tokenDir(), fs = require('fs');
    if (!d) { return; }
    fs.readdir(d, function (err, names) {
        (err ? [] : names).filter(function (n) { return /^epg-[0-9a-z]+\.json(\.part)?$/.test(n); }).forEach(function (n) {
            fs.stat(d + '/' + n, function (e, st) { if (!e && st && Date.now() - st.mtime.getTime() > EPG_KEEP_MS) { fs.unlink(d + '/' + n, function () {}); } });
        });
    });
}
function epgSaved(url) {
    var f = epgFile(url), fs = require('fs');
    if (!f) { return null; }
    try {
        var st = fs.statSync(f);
        if (st.size > EPG_FILE_MAX) { fs.unlink(f, function () {}); return null; }
        var g = JSON.parse(String(fs.readFileSync(f, 'utf8')));
        if (!g || g.url !== url || typeof g.k !== 'string' || !g.keys || !g.progs) { return null; }
        g.state = 'ready';
        return g;
    } catch (e) { return null; }
}
function epgView(g) { return { state: g.state, at: g.at || 0, channels: g.channels || 0, programmes: g.programmes || 0, partial: !!g.partial, error: g.error || '' }; }
function epgStart(url, k, force) {
    epgSweep();
    var g = _epg[url], now = Date.now();
    if (!g || g.k !== k) {   // (not read here yet, or for other channels: the saved copy, if it's for these)
        var saved = epgSaved(url);
        if (saved && saved.k === k) { g = _epg[url] = saved; }
    }
    if (g && g.k === k && !force) {
        if (g.state === 'loading') { return g; }
        if (g.state === 'ready' && now - g.at < EPG_FRESH_MS) { return g; }
        if (g.failedAt && now - g.failedAt < EPG_RETRY_MS) { return g; }   // (failed lately: not again yet)
    }
    var next = { url: url, k: k, state: 'loading', at: g ? g.at : 0, keys: g && g.keys, progs: g && g.progs, icons: g && g.icons, channels: g && g.channels, programmes: g && g.programmes };
    _epg[url] = next;
    var urls = Object.keys(_epg);
    if (urls.length > EPG_GUIDES) {   // (the oldest others dropped, their saved files too: the one just asked for stays)
        urls.filter(function (u) { return u !== url; }).sort(function (a, b) { return (_epg[a].at || 0) - (_epg[b].at || 0); }).slice(0, urls.length - EPG_GUIDES).forEach(function (u) {
            delete _epg[u];
            var f = epgFile(u);
            if (f) { require('fs').unlink(f, function () {}); }
        });
    }
    _epgQueue.push(next);
    epgPump();
    return next;
}
function epgPump() {
    if (_epgBusy || !_epgQueue.length) { return; }
    var g = _epgQueue.shift();
    if (_epg[g.url] !== g) { epgPump(); return; }   // (replaced meanwhile)
    _epgBusy = true;
    var p = epgParser(epgBits(g.k), Math.floor(Date.now() / 1000));
    epgFetch(g.url, p.feed, function (err, partial) {
        _epgBusy = false;
        try {
            p.finish();
            var kept = Object.keys(p.channels).length;
            if (err || (!p.isGuide && !kept)) {
                g.state = g.keys ? 'ready' : 'failed';   // (the last one read still answers)
                g.error = err ? (err.message || 'failed') : 'not a TV guide (XMLTV)';
                g.failedAt = Date.now();
                if (!g.keys) { g.at = g.failedAt; }
                log('TV guide not read: ' + g.error);
            } else if (_epg[g.url] === g) {   // (still wanted: not cleared, nor dropped, meanwhile)
                g.keys = p.keys; g.progs = p.progs; g.icons = p.icons; g.channels = kept; g.programmes = p.count;
                g.partial = partial || p.partial; g.error = ''; g.state = 'ready'; g.at = Date.now();
                var f = epgFile(g.url);
                if (f) {
                    var keep = { url: g.url, k: g.k, at: g.at, keys: g.keys, progs: g.progs, icons: g.icons, channels: g.channels, programmes: g.programmes, partial: g.partial };
                    require('fs').writeFile(f + '.part', JSON.stringify(keep), { mode: 384 }, function (e) {   // (written whole, then swapped in)
                        if (e) { log('TV guide not saved (' + (e.code || e.message) + ')'); return; }
                        require('fs').rename(f + '.part', f, function (e2) { if (e2) { log('TV guide not saved (' + (e2.code || e2.message) + ')'); } });
                    });
                }
            }
        } catch (e) { g.state = 'failed'; g.error = 'failed'; g.at = Date.now(); }
        epgPump();
    });
}
// The guide ticket: for an app that can't read the service's token (its header instead), asked
// for once (/epg/ticket, a GET with the header: what that app reaches everything with; a web page,
// which sends an Origin, can't), then given with its guide POSTs. Made anew each time the service starts.
var _epgTicket = crypto.randomBytes(24).toString('hex');
function hasTicket(query) {
    var m = /(?:^|&)ticket=([0-9a-f]{48})(?:&|$)/.exec(query || '');
    return !!(m && sameToken(m[1], _epgTicket));
}
// Settings › Storage: the saved guides (/epg/files: how many, their size), and Clear saved
// copies (/epg/clear, a POST: every saved guide deleted, and those kept here let go).
function epgSavedFiles() {
    var d = tokenDir(), fs = require('fs'), out = { count: 0, bytes: 0 };
    if (!d) { return out; }
    try {
        fs.readdirSync(d).filter(function (n) { return /^epg-[0-9a-z]+\.json(\.part)?$/.test(n); }).forEach(function (n) {
            try { var st = fs.statSync(d + '/' + n); out.count++; out.bytes += st.size; out.names = (out.names || []).concat(n); } catch (e) {}
        });
    } catch (e) {}
    return out;
}
function epgClear() {
    var d = tokenDir(), files = epgSavedFiles();
    (files.names || []).forEach(function (n) { try { require('fs').unlinkSync(d + '/' + n); } catch (e) {} });
    _epg = Object.create(null); _epgQueue = [];   // (one being read: not saved, see epgPump)
    return files.count;
}
function epgControl(req, res, path, query) {
    if (!entryAllowed(req, query) && !(req.method === 'POST' && hasTicket(query))) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }   // (the guide ticket: its POSTs, see hasTicket)
    if (path === '/epg/ticket') {
        if (req.method !== 'GET' || (req.headers && req.headers.origin !== undefined)) { send(res, 403, 'text/plain', 'not allowed'); return; }
        send(res, 200, 'application/json', JSON.stringify({ ticket: _epgTicket }));
        return;
    }
    if (path === '/epg/files') { var sf = epgSavedFiles(); send(res, 200, 'application/json', JSON.stringify({ count: sf.count, bytes: sf.bytes })); return; }
    if (path === '/epg/clear') {
        if (req.method !== 'POST') { send(res, 405, 'text/plain', 'POST only'); return; }
        send(res, 200, 'application/json', JSON.stringify({ cleared: epgClear() }));
        return;
    }
    var q = {};
    String(query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } });
    var u = String(q.u || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 2000) { send(res, 400, 'text/plain', 'bad guide link'); return; }
    if (path === '/epg/load') {
        if (!/^[A-Za-z0-9_-]{4,24000}$/.test(q.k || '')) { send(res, 400, 'text/plain', 'bad channels'); return; }
        send(res, 200, 'application/json', JSON.stringify(epgView(epgStart(u, q.k, q.force === '1'))));
        return;
    }
    if (path === '/epg/get') {
        // Each key asked: its programs; [] for a channel in the guide with none then; nothing for one
        // not in it; _cut: those not looked at (past EPG_GET_BYTES); _unread: no guide here to ask.
        var g = _epg[u], now = Math.floor(Date.now() / 1000), out = Object.create(null);
        var from = +q.from || now - EPG_BEFORE, to = +q.to || now + EPG_AFTER, max = Math.min(EPG_PER, Math.max(1, +q.max || EPG_PER));
        if (!(g && g.keys)) { out._unread = true; }
        else {
            var icons = {}, bytes = 0;   // (an answer kept to EPG_GET_BYTES: past it, said to be partial)
            String(q.ids || '').split('|').slice(0, 300).forEach(function (key) {
                var own = Object.prototype.hasOwnProperty;   // (a saved guide's tables have a prototype: own entries only, of the right kind)
                var id = key && own.call(g.keys, key) && typeof g.keys[key] === 'string' ? g.keys[key] : null;
                var l = id && own.call(g.progs, id) && Array.isArray(g.progs[id]) ? g.progs[id] : null;
                if (id && g.icons && own.call(g.icons, id) && typeof g.icons[id] === 'string') { icons[key] = g.icons[id]; }
                if (!id) { return; }
                if (out._partial) { (out._cut = out._cut || []).push(key); return; }
                var sel = [];
                for (var i = 0; l && i < l.length && sel.length < max; i++) {
                    if (!(l[i][1] > from && l[i][0] < to)) { continue; }
                    bytes += JSON.stringify(l[i]).length + 1;
                    if (bytes > EPG_GET_BYTES) { out._partial = true; break; }
                    sel.push(l[i]);
                }
                if (out._partial) { (out._cut = out._cut || []).push(key); return; }   // (this one too: looked at in part)
                out[key] = sel;
            });
            if (Object.keys(icons).length) { out._icons = icons; }
        }
        send(res, 200, 'application/json', JSON.stringify(out));
        return;
    }
    send(res, 404, 'text/plain', 'not found');
}

// ---- Entering text from the phone ----
// While the TV shows its QR code, a one-time page on the home network (ENTRY_PORT, on the
// TV's home-network address only): one field, one entry, behind a random code in its address.
// StremioK opens it (/entry/open → its address), collects what was sent (/entry/poll) and
// closes it (/entry/close): those answer StremioK alone (see entryAllowed). A page closes
// after ENTRY_MS, or ENTRY_IDLE_MS after the TV last asked for it (StremioK closed, or in the
// background); at most ENTRY_OPEN_MAX are open (another closes the oldest), ENTRY_OPENS a
// minute. The port is open only while one is: ENTRY_CONNECTIONS at a time, each given
// ENTRY_VISIT_MS (ENTRY_QUIET_MS of silence). It's plain HTTP: the page says so.
var ENTRY_PORT = PORT + 10, ENTRY_MS = 5 * 60 * 1000, ENTRY_IDLE_MS = 30000, ENTRY_MAX = 8192;
var ENTRY_OPEN_MAX = 2, ENTRY_OPENS = 12, ENTRY_CONNECTIONS = 8, ENTRY_VISIT_MS = 20000, ENTRY_QUIET_MS = 10000;
var ENTRY_TITLES = { link: 'Play a link on StremioK', addon: 'Add an addon to StremioK', playlist: 'Add an IPTV playlist to StremioK', config: 'Import a configuration file into StremioK',
    search: 'Search on StremioK', youtube: 'Add a YouTube catalog to StremioK', aiom: 'Your AIOManager address for StremioK', aiomkey: 'Your AIOManager API key for StremioK' };
var ENTRY_TEXT = { search: 'Words to search for', youtube: 'A channel, a playlist link, or words to search YouTube for', aiomkey: 'Your account API key' };   // (plain text, not a link)
var _entries = Object.create(null), _entryServer = null, _entrySockets = [], _entryOpened = [];
function lanAddress() {
    try {
        var nets = require('os').networkInterfaces(), names = Object.keys(nets), i, j;
        for (i = 0; i < names.length; i++) {
            for (j = 0; j < nets[names[i]].length; j++) {
                var a = nets[names[i]][j];
                if (a && a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) { return a.address; }
            }
        }
    } catch (e) {}
    return null;
}
// StremioK itself (callerProblem, checked in handle), with the token from its private
// folder, or, where it can't read it (TizenBrew has nowhere private to keep one; on Tizen 6
// the service's folder isn't the app's), an X-StremioK header: a web page can't send one
// without a pre-check naming where it comes from, and that's refused.
function entryAllowed(req, query) {
    return hasToken(query) || !!(req.headers && req.headers['x-stremiok']);
}
function entryDrop(token, keepPort) {
    var e = _entries[token];
    if (e) { clearTimeout(e.timer); clearTimeout(e.idle); delete _entries[token]; }
    if (!keepPort && !Object.keys(_entries).length && _entryServer) {   // (none open: the port closes, its connections too)
        var s = _entryServer; _entryServer = null;
        try { s.close(); } catch (e2) {}
        _entrySockets.forEach(function (k) { try { k.destroy(); } catch (e3) {} });
        _entrySockets = [];
    }
}
function entryIdle(token) {
    var e = _entries[token];
    if (!e) { return; }
    clearTimeout(e.idle);
    e.idle = setTimeout(function () { entryDrop(token); }, ENTRY_IDLE_MS);
}
function entryControl(req, res, path, query) {
    if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed'); return; }
    var tm = /(?:^|&)t=([0-9a-f]{32})(?:&|$)/.exec(query || ''), token = tm ? tm[1] : '';
    if (path === '/entry/open') {
        var now = Date.now();
        _entryOpened = _entryOpened.filter(function (x) { return now - x < 60000; });
        if (_entryOpened.length >= ENTRY_OPENS) { send(res, 429, 'text/plain', 'too many, try again in a minute'); return; }
        var wm = /(?:^|&)what=([a-z]{1,12})(?:&|$)/.exec(query || ''), what = wm && ENTRY_TITLES[wm[1]] ? wm[1] : 'link';
        var ip = lanAddress();
        if (!ip) { send(res, 503, 'text/plain', 'no home network address'); return; }
        _entryOpened.push(now);
        var open = Object.keys(_entries).sort(function (a, b) { return _entries[a].at - _entries[b].at; });
        while (open.length >= ENTRY_OPEN_MAX) { entryDrop(open.shift(), true); }   // (the oldest goes)
        var t = crypto.randomBytes(16).toString('hex');
        _entries[t] = { what: what, text: null, sent: false, at: now, timer: setTimeout(function () { entryDrop(t); }, ENTRY_MS), idle: null };
        entryIdle(t);
        var opened = function () { send(res, 200, 'application/json', JSON.stringify({ url: 'http://' + ip + ':' + ENTRY_PORT + '/e/' + t, token: t, expires: ENTRY_MS })); };
        if (_entryServer) { opened(); return; }
        _entryServer = http.createServer(entryPage);
        _entryServer.maxConnections = ENTRY_CONNECTIONS;
        _entryServer.timeout = ENTRY_QUIET_MS;
        _entryServer.on('clientError', function (err, socket) { try { socket.destroy(); } catch (e) {} });
        _entryServer.on('connection', function (k) {
            _entrySockets.push(k);
            var visit = setTimeout(function () { try { k.destroy(); } catch (e) {} }, ENTRY_VISIT_MS);
            k.on('close', function () { clearTimeout(visit); var i = _entrySockets.indexOf(k); if (i !== -1) { _entrySockets.splice(i, 1); } });
        });
        _entryServer.on('error', function (err) {
            log('phone page: ' + (err && (err.code || err.message)));
            _entryServer = null; entryDrop(t);
            if (!res.headersSent) { send(res, 503, 'text/plain', 'could not open the phone page'); }
        });
        _entryServer.listen(ENTRY_PORT, ip, opened);
        return;
    }
    var e = token && _entries[token];
    if (!e) { send(res, 404, 'text/plain', 'not open'); return; }
    if (path === '/entry/poll') {
        var text = e.text;
        if (e.sent) { entryDrop(token); } else { entryIdle(token); }   // (collected: the page and its code go)
        send(res, 200, 'application/json', JSON.stringify({ text: text }));
        return;
    }
    if (path === '/entry/close') { entryDrop(token); send(res, 200, 'text/plain', 'closed'); return; }
    send(res, 404, 'text/plain', 'not found');
}
function entryHtml(title, body) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + title + '</title><style>body{font-family:-apple-system,Roboto,sans-serif;background:#0e1117;color:#e6e9ef;margin:0;padding:24px}' +
        'h1{font-size:22px;margin:0 0 16px}input{width:100%;box-sizing:border-box;font-size:17px;padding:12px;border-radius:10px;border:1px solid #2a3346;background:#161b26;color:#e6e9ef}' +
        'button{margin-top:14px;width:100%;font-size:17px;padding:12px;border:0;border-radius:10px;background:#818cf8;color:#0e1117;font-weight:600}p{color:#9aa3b5;font-size:15px}</style></head><body>' +
        '<h1>' + title + '</h1>' + body + '</body></html>';
}
function entryPage(req, res) {
    try {
        res.setHeader('Cache-Control', 'no-store');
        var m = /^\/e\/([0-9a-f]{32})$/.exec(String(req.url || '')), e = m && _entries[m[1]];
        if (!e || e.sent) { send(res, 404, 'text/plain', 'Not here (it was used, or the TV closed it)'); return; }
        var title = ENTRY_TITLES[e.what];
        if (req.method === 'GET') {
            var plain = ENTRY_TEXT[e.what];
            send(res, 200, 'text/html; charset=utf-8', entryHtml(title, '<form method="post"><input name="text" type="' + (plain ? 'text' : 'url') + '" autofocus autocomplete="off" placeholder="' + (plain || 'https://…') + '" required>' +
                '<button type="submit">Send to the TV</button></form><p>It goes straight to your TV over your home network, <b>unencrypted</b>: use this only on a network you trust' +
                (plain ? '' : ' (links to addons and playlists often carry your tokens or passwords)') + '. This page stops working once it has been sent.</p>'));
            return;
        }
        if (req.method !== 'POST') { send(res, 405, 'text/plain', 'GET or POST only'); return; }
        var body = '', size = 0, done = false;
        req.on('data', function (c) {
            if (done) { return; }
            size += c.length;
            if (size > ENTRY_MAX) { done = true; send(res, 413, 'text/plain', 'Too long'); return; }   // (the rest read and dropped: the connection stays usable)
            body += c;
        });
        req.on('end', function () {
            if (done) { return; }
            done = true;
            var tm = /(?:^|&)text=([^&]*)/.exec(body), text = '';
            try { text = tm ? decodeURIComponent(tm[1].replace(/\+/g, ' ')).replace(/[\r\n\t]+/g, ' ').trim() : ''; } catch (e3) { text = ''; }
            if (!text || !_entries[m[1]] || e.sent) { send(res, 400, 'text/plain', 'Nothing sent'); return; }
            e.text = text; e.sent = true;
            send(res, 200, 'text/html; charset=utf-8', entryHtml(title, '<p>Sent to your TV.</p>'));
        });
    } catch (err) { send(res, 500, 'text/plain', 'error'); }
}

var server = http.createServer(handle);
server.maxConnections = MAX_CONNECTIONS;
server.on('error', function (err) { log('listen error: ' + (err && (err.code || err.message))); });
server.on('clientError', function (err, socket) { try { socket.destroy(); } catch (e) {} });
server.listen(PORT, '127.0.0.1', function () {
    log('YouTube resolver on 127.0.0.1:' + PORT + (UNDER_TIZENBREW ? ' (TizenBrew)' : ''));
});
