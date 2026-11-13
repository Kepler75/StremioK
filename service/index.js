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
 *   /xtvod/list?base=<server>&user=<user>&pass=<password>&type=movie|series[&q=<words>][&skip=n][&force=1] -> JSON
 *                       { state, at, items: [{ id, name, year, tmdb, cat, ext, pic, rating }] }: an Xtream
 *                       account's newest films or series (200), or those whose names have the words
 *                       (force: its list read again now, as Reload asks);
 *                       /xtvod/find?…&type&[tmdb=][&name=&year=] -> the same: a title's copies there
 *                       (see xtvControl); StremioK only (entryAllowed)
 *   /stalker/list?portal=<address>&mac=<MAC> -> JSON { m3u, count } or { refused | unreachable,
 *                       why }: a Stalker portal's channels as an M3U playlist; /stalker/link?portal&mac
 *                       &u=<a channel's link in it> -> JSON { url } or { why }: its link to play now
 *                       (see stalkerControl); StremioK only (entryAllowed)
 *   /stalker/vod?portal&mac&type=movie|series&do=cats|list|seasons[&cat=][&q=][&skip=][&id=][&via=vod]
 *                       -> JSON { cats } | { items, more } | { seasons } or { why }: its films and
 *                       series; /stalker/play?portal&mac&cmd=[&ep=] -> 302 to a film's or episode's
 *                       link, asked now (the player's: the token, or the guide ticket)
 *   /epg/load?u=<guide>&k=<bitset>[&force=1] (or POSTed: the same in its body, as StremioK
 *                       asks) -> JSON { state, at, channels, programmes, partial,
 *                       error }: a playlist's TV guide (XMLTV) read for StremioK's channels
 *                       only; /epg/get?u=<guide>&ids=<key>|<key>&from&to[&max] -> JSON { <key>:
 *                       [[start, stop, title, desc, picture?, about?]], _icons: { <key>: logo } }: their programs and
 *                       the guide's logos for them (see epgControl)
 *   /entry/give (POSTed: a configuration file) -> JSON { url, token }: a one-time phone page to
 *                       copy or download it (see entryControl); the token or the ticket
 *   /drm/license (POSTed: { u, h, c }) -> JSON { license } or { why }: a Widevine channel's license
 *                       request posted to its license server (see drmControl); the token or the ticket
 *   /epg/ticket -> JSON { ticket }: for guide POSTs from an app without the token (see hasTicket)
 *   /epg/files -> JSON { count, bytes, xtv: { count, bytes } }: the saved guides, and Xtream lists;
 *                       /epg/clear (POST) -> { cleared }: all of them deleted
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
 *   /dav/list?u=<folder>&p=<path>, /dav/walk?u=, /dav/sub?u=&p= (+ X-Dav-Auth, X-Dav-Cert) ->
 *                       a network folder's (WebDAV) listing, every video and subtitle file under
 *                       it, a subtitle file as UTF-8 (see davControl); the token or the header
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
var net = require('net');
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
function fromBase64(s) { return HAS_BUFFER_FROM ? Buffer.from(String(s), 'base64') : new Buffer(String(s), 'base64'); }
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
var SUB_EXT = /\.(srt|vtt|ass|ssa|smi|sub|txt)$/i;
// A drive's walk lists videos and subtitles; a .sub or .txt only when named like a video in its
// folder (Film.txt for Film.mkv: not every readme), as the app takes them (local.js' sidecars).
var WEAK_SUB_EXT = /\.(sub|txt)$/i;
function walkWants(n, siblings) {
    if (VIDEO_EXT.test(n)) { return true; }
    if (!SUB_EXT.test(n)) { return false; }
    if (!WEAK_SUB_EXT.test(n)) { return true; }
    var low = n.toLowerCase();
    return siblings.some(function (v) { return VIDEO_EXT.test(v) && low.indexOf(v.replace(/\.[^.]+$/, '').toLowerCase()) === 0; });
}
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
                                else if (walkWants(n, names) && files.length < FS_WALK_FILES) { files.push({ p: rel, size: st.size }); }
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

// Subtitle text: the file's encoding worked out: a byte-order mark, else UTF-8 when it reads as
// UTF-8, else one of the old Windows ones, told apart by their letters (oldEncoding). Passed on as
// text: the page reads its format (SRT, WebVTT, ASS, SAMI, MicroDVD…: player-subs' parseCues).
var FS_SUB_MAX = 5 * 1024 * 1024;
// Windows-1252 (Western), -1250 (Central European) and -1251 (Cyrillic): bytes 0x80-0xFF.
var CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';   // (0xA0 on: as Latin-1)
var CP1250_HIGH = '€\u0081‚\u0083„…†‡\u0088‰Š‹ŚŤŽŹ\u0090‘’“”•–—\u0098™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';
var CP1251_HIGH = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕї\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042A\u042B\u042C\u042D\u042E\u042F\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F';
// Which old encoding: Cyrillic when most letters are high bytes (Russian, Ukrainian, Serbian…);
// else Central European when its own letters show (ą ł ś ź ż ť ř ů ě, which in Western are ¹ ³ œ Ÿ
// and the like) more than Western's (à, ¡, ¿ starting a word); Western otherwise.
function isLetterByte(b) { return (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b >= 0xC0; }
function oldEncoding(buf) {
    var high = 0, ascii = 0, ce = 0, we = 0, n = Math.min(buf.length, 262144);
    for (var i = 0; i < n; i++) {
        var b = buf[i], prev = i ? buf[i - 1] : 0x20, next = i + 1 < n ? buf[i + 1] : 0x20;
        if ((b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A)) { ascii++; continue; }
        if (b < 0x80) { continue; }
        if (b >= 0xC0) { high++; }
        if (b === 0x8C || b === 0x8D || b === 0x8F || b === 0x9C || b === 0x9D || b === 0x9F || b === 0xA5 || b === 0xB9 || b === 0xB3) { ce += 3; }
        else if (b === 0xBF) { if (isLetterByte(prev)) { ce += 3; } else if (isLetterByte(next)) { we += 2; } }   // (ż inside a word; ¿ before one)
        else if (b === 0xA3) { if (isLetterByte(next)) { ce += 1; } }   // (Ł before letters; £ before a number)
        else if (b === 0xF8 || b === 0xD8 || b === 0xEC || b === 0xF9) { ce += 1; }   // (ř Ř ě ů: ø Ø ì ù in Western, rarer)
        else if (b === 0xE0 || b === 0xC0 || b === 0xA1) { we += 2; }   // (à À ¡: ŕ Ŕ ˇ in Central European, rare)
    }
    if (high > 20 && high > (high + ascii) * 0.45) { return CP1251_HIGH; }
    return ce >= 2 && ce > we ? CP1250_HIGH : CP1252_HIGH;
}
function decodeText(buf) {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) { return buf.slice(2).toString('utf16le'); }
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {   // (UTF-16 big-endian: bytes swapped first)
        var sw = allocBuffer(buf.length - 2);
        for (var i = 2; i + 1 < buf.length; i += 2) { sw[i - 2] = buf[i + 1]; sw[i - 1] = buf[i]; }
        return sw.toString('utf16le');
    }
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { return buf.slice(3).toString('utf8'); }
    var t = buf.toString('utf8');
    if (t.indexOf('�') === -1) { return t; }
    var table = oldEncoding(buf), full = table.length === 128;
    var out = [];
    for (var j = 0; j < buf.length; j++) {
        var b = buf[j];
        out.push(b < 0x80 ? String.fromCharCode(b) : full ? table.charAt(b - 0x80) : b < 0xA0 ? table.charAt(b - 0x80) : String.fromCharCode(b));
    }
    return out.join('');
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
                cb(null, text);
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

// ---- What's in a video file: its header read (/live/mi, /fsmi, /dav/mi) ----
// A file's container, length and tracks, from its header only: an MKV / WebM's EBML header,
// Info and Tracks (through its SeekHead when they come after the start), an MP4's moov box. Read
// in pieces (MI_CHUNK at a time), MI_BYTES and MI_READS at most whatever the file's size, by
// MI_MS; a server that won't read from a given place (no Range) only for the start. Every length
// the file gives is bounded by what was read (a broken or hostile file can't make it allocate,
// loop or recurse). AVI, MPEG-TS and the rest: { container: null } (unknown).
// The answer: { container, duration (s), size, video: { codec, width, height, bitDepth, hdr
// ('hdr10' | 'hlg' | ''), dv: { profile, compat } }, audio: [{ codec, channels, lang, name,
// default, forced, commentary }], subs: [{ codec, lang, name, default, forced, hi, text }],
// cues (it can be jumped through), more (tracks left out past MI_TRACKS) }.
var MI_BYTES = 16 * 1048576, MI_READS = 10, MI_MS = 20000, MI_CHUNK = 262144, MI_ELEMENT_MAX = 8 * 1048576, MI_TRACKS = 128, MI_ACTIVE_MAX = 2;
var _miActive = 0;
// readAt(offset, length, cb(err, buf, total)) -> { get(offset, length, cb(err, buf)), size() }:
// what was read kept, so a piece already in is never asked for again.
function miReader(readAt) {
    var pieces = [], total = null, used = 0, reads = 0;
    function have(off, len) {
        for (var i = 0; i < pieces.length; i++) {
            var p = pieces[i];
            if (off >= p.off && off + len <= p.off + p.buf.length) { return p.buf.slice(off - p.off, off - p.off + len); }
        }
        return null;
    }
    function get(off, len, cb) {
        if (!(off >= 0) || !(len >= 0)) { cb(upError('bad place in the file', 422)); return; }
        if (total !== null) { if (off >= total) { cb(null, allocBuffer(0)); return; } len = Math.min(len, total - off); }
        var h = have(off, len);
        if (h) { cb(null, h); return; }
        // (the end of a piece already read, when the file ended there: what there is)
        for (var i = 0; i < pieces.length; i++) { if (pieces[i].short && off >= pieces[i].off && off <= pieces[i].off + pieces[i].buf.length) { cb(null, pieces[i].buf.slice(off - pieces[i].off)); return; } }
        var want = Math.max(len, MI_CHUNK);
        if (total !== null) { want = Math.min(want, total - off); }
        if (reads >= MI_READS || used + want > MI_BYTES) { cb(upError('the header is too big to read', 422)); return; }
        reads++; used += want;
        readAt(off, want, function (err, buf, tot) {
            if (err) { cb(err); return; }
            if (tot > 0) { total = tot; }
            pieces.push({ off: off, buf: buf, short: buf.length < want });
            cb(null, buf.slice(0, Math.min(len, buf.length)));
        });
    }
    return { get: get, size: function () { return total; } };
}
// EBML (MKV / WebM): an element's ID (its length marker kept, as the spec writes IDs) and size.
function ebmlId(b, o) {
    var x = b[o];
    if (x === undefined) { return null; }
    var n = x & 0x80 ? 1 : x & 0x40 ? 2 : x & 0x20 ? 3 : x & 0x10 ? 4 : 0;
    if (!n || o + n > b.length) { return null; }
    var v = 0;
    for (var i = 0; i < n; i++) { v = v * 256 + b[o + i]; }
    return { v: v, n: n };
}
function ebmlSize(b, o) {
    var x = b[o];
    if (x === undefined) { return null; }
    var n = 1, mask = 0x80;
    while (n <= 8 && !(x & mask)) { n++; mask = mask >> 1; }
    if (n > 8 || o + n > b.length) { return null; }
    var v = x & (mask - 1), all = v === mask - 1;
    for (var i = 1; i < n; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 0xFF) { all = false; } }
    return { v: all ? -1 : v, n: n };   // (-1: unknown, to the end of what holds it)
}
// Each child element of b[o..end): fn(id, dataStart, dataSize); false stops. Sizes past the end
// are cut to it; 4096 children at most.
function ebmlEach(b, o, end, fn) {
    end = Math.min(end, b.length);
    for (var n = 0; o < end && n < 4096; n++) {
        var id = ebmlId(b, o), sz = id && ebmlSize(b, o + id.n);
        if (!id || !sz) { return; }
        var d = o + id.n + sz.n, s = sz.v < 0 ? end - d : sz.v;
        if (d > end) { return; }
        if (d + s > end) { s = end - d; }
        if (fn(id.v, d, s) === false) { return; }
        o = d + s;
    }
}
function ebmlUint(b, d, s) { var v = 0; for (var i = 0; i < Math.min(s, 8); i++) { v = v * 256 + b[d + i]; } return v; }   // (8 bytes: exact to 2^53, past any file)
function ebmlStr(b, d, s) { return b.slice(d, d + Math.min(s, 400)).toString('utf8').replace(/\0[\s\S]*$/, '').trim(); }
function ebmlFloat(b, d, s) { try { return s === 4 ? b.readFloatBE(d) : s === 8 ? b.readDoubleBE(d) : 0; } catch (e) { return 0; } }
var MKV_IDS = { SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB, SEEKPOS: 0x53AC, INFO: 0x1549A966, SCALE: 0x2AD7B1, DURATION: 0x4489,
    TRACKS: 0x1654AE6B, CLUSTER: 0x1F43B675, CUES: 0x1C53BB6B, DOCTYPE: 0x4282 };
// A codec, short and the same whatever the container: h264, hevc, av1, vp9, aac, ac3, eac3,
// dts, truehd, flac, opus, srt, ass, pgs… ('' unknown).
var MI_CODECS = [
    [/^V_MPEG4\/ISO\/AVC|^(avc1|avc3)$/, 'h264'], [/^V_MPEGH\/ISO\/HEVC|^(hvc1|hev1|dvh1|dvhe)$/, 'hevc'], [/^V_AV1|^(av01|dav1)$/, 'av1'], [/^V_VP9|^vp09$/, 'vp9'],
    [/^V_VP8|^vp08$/, 'vp8'], [/^V_MPEG2|^(mp2v|m2v1)$/, 'mpeg2'], [/^V_MPEG4\/ISO\/(SP|ASP|AP)|^V_MS\/VFW|^mp4v$/, 'mpeg4'], [/^V_REAL/, 'real'], [/^(dvav|dva1)$/, 'h264'],
    [/^A_AAC|^mp4a$/, 'aac'], [/^A_AC3|^ac-3$/, 'ac3'], [/^A_EAC3|^ec-3$/, 'eac3'], [/^A_DTS|^dts[chle]$|^dtsx$/, 'dts'], [/^A_TRUEHD|^mlpa$/, 'truehd'], [/^A_FLAC|^fLaC$/, 'flac'],
    [/^A_OPUS|^Opus$/, 'opus'], [/^A_VORBIS/, 'vorbis'], [/^A_MPEG\/L3|^\.mp3$/, 'mp3'], [/^A_MPEG\/L2/, 'mp2'], [/^A_PCM|^(lpcm|ipcm|sowt|twos)$/, 'pcm'], [/^A_ALAC|^alac$/, 'alac'],
    [/^S_TEXT\/UTF8|^S_TEXT\/ASCII/, 'srt'], [/^S_TEXT\/ASS|^S_ASS/, 'ass'], [/^S_TEXT\/SSA|^S_SSA/, 'ssa'], [/^S_TEXT\/WEBVTT|^D_WEBVTT|^wvtt$/, 'vtt'], [/^S_HDMV\/PGS/, 'pgs'],
    [/^S_VOBSUB/, 'vobsub'], [/^S_DVBSUB/, 'dvb'], [/^S_HDMV\/TEXTST/, 'textst'], [/^tx3g$/, 'mov_text'], [/^stpp$/, 'ttml'], [/^c608$/, 'cc608'], [/^S_TEXT\/USF/, 'usf']];
var MI_TEXT_SUBS = /^(srt|ass|ssa|vtt|mov_text|ttml|usf|textst)$/;
function miCodec(id) {
    id = String(id || '');
    for (var i = 0; i < MI_CODECS.length; i++) { if (MI_CODECS[i][0].test(id)) { return MI_CODECS[i][1]; } }
    return '';
}
// A Dolby Vision configuration record (dvcC / dvvC): { profile, compat } (compat 1: an HDR10
// layer underneath, 4: HLG, 2: SDR, 0: none).
function miDv(b, d, s) {
    if (s < 5) { return null; }
    return { profile: (b[d + 2] >> 1) & 0x7F, compat: b[d + 4] >> 4 };
}
function miMkvTrack(b, d, s) {
    var t = { type: 0, codec: '', lang: 'eng', name: '', default: true, forced: false, hi: false, commentary: false };
    ebmlEach(b, d, d + s, function (id, cd, cs) {
        if (id === 0x83) { t.type = ebmlUint(b, cd, cs); }
        else if (id === 0x86) { t.codecId = ebmlStr(b, cd, cs); t.codec = miCodec(t.codecId); }
        else if (id === 0x63A2 && cs >= 4) { t.priv = [cd, cs]; }   // (CodecPrivate: HEVC's or AV1's record, its bit depth)
        else if (id === 0x22B59C) { t.lang = ebmlStr(b, cd, cs).slice(0, 12); }
        else if (id === 0x22B59D) { t.bcp = ebmlStr(b, cd, cs).slice(0, 35); }
        else if (id === 0x536E) { t.name = ebmlStr(b, cd, cs).slice(0, 120); }
        else if (id === 0x88) { t.default = ebmlUint(b, cd, cs) !== 0; }
        else if (id === 0x55AA) { t.forced = ebmlUint(b, cd, cs) !== 0; }
        else if (id === 0x55AB) { t.hi = ebmlUint(b, cd, cs) !== 0; }
        else if (id === 0x55AF) { t.commentary = ebmlUint(b, cd, cs) !== 0; }
        else if (id === 0xE0) {   // Video
            ebmlEach(b, cd, cd + cs, function (vid, vd, vs) {
                if (vid === 0xB0) { t.width = ebmlUint(b, vd, vs); }
                else if (vid === 0xBA) { t.height = ebmlUint(b, vd, vs); }
                else if (vid === 0x55B0) {   // Colour
                    ebmlEach(b, vd, vd + vs, function (cid, xd, xs) {
                        if (cid === 0x55B2) { t.bitDepth = ebmlUint(b, xd, xs); }
                        else if (cid === 0x55BA) { var tc = ebmlUint(b, xd, xs); t.hdr = tc === 16 ? 'hdr10' : tc === 18 ? 'hlg' : ''; }
                    });
                }
            });
        }
        else if (id === 0xE1) {   // Audio
            ebmlEach(b, cd, cd + cs, function (aid, ad, as) { if (aid === 0x9F) { t.channels = ebmlUint(b, ad, as); } });
        }
        else if (id === 0x41E4) {   // BlockAdditionMapping: Dolby Vision's record
            var kind = 0, extra = null;
            ebmlEach(b, cd, cd + cs, function (mid, md, ms) { if (mid === 0x41E7) { kind = ebmlUint(b, md, ms); } else if (mid === 0x41ED) { extra = [md, ms]; } });
            if ((kind === 0x64766343 || kind === 0x64767643) && extra) { t.dv = miDv(b, extra[0], extra[1]); }
        }
    });
    if (t.bcp) { t.lang = t.bcp; }
    if (t.priv && !t.bitDepth) {
        if (t.codec === 'hevc' && t.priv[1] >= 19 && b[t.priv[0]] === 1) { t.bitDepth = (b[t.priv[0] + 17] & 7) + 8; }
        else if (t.codec === 'av1') { t.bitDepth = (b[t.priv[0] + 2] & 0x40) ? ((b[t.priv[0] + 2] & 0x20) ? 12 : 10) : 8; }
    }
    return t;
}
// The tracks as answered: the first video, every audio and subtitle (MI_TRACKS at most).
function miTracks(out, list) {
    var n = 0;
    list.forEach(function (t) {
        if (n >= MI_TRACKS) { out.more = true; return; }
        if (t.type === 1 && !out.video) {
            out.video = { codec: t.codec, width: t.width || 0, height: t.height || 0, bitDepth: t.bitDepth || 0, hdr: t.hdr || '' };
            if (t.dv) { out.video.dv = t.dv; }
            n++;
        } else if (t.type === 2) {
            out.audio.push({ codec: t.codec, channels: t.channels || 0, lang: t.lang || '', name: t.name || '', default: !!t.default, forced: !!t.forced, commentary: !!t.commentary || /commentary/i.test(t.name || '') });
            n++;
        } else if (t.type === 17) {
            out.subs.push({ codec: t.codec, lang: t.lang || '', name: t.name || '', default: !!t.default, forced: !!t.forced || /forced/i.test(t.name || ''), hi: !!t.hi || /\bSDH\b|hearing/i.test(t.name || ''), text: MI_TEXT_SUBS.test(t.codec) });
            n++;
        }
    });
}
function miMkv(r, out, cb) {
    var I = MKV_IDS, segData = 0, segEnd = Infinity, seek = {}, got = {}, steps = 0, jumps = 0;
    r.get(0, 64, function (e, b) {
        var id = !e && ebmlId(b, 0), sz = id && ebmlSize(b, id.n);
        if (!sz || sz.v < 0) { cb(e || upError('not a Matroska file', 422)); return; }
        ebmlEach(b, id.n + sz.n, id.n + sz.n + sz.v, function (cid, d, s) { if (cid === I.DOCTYPE && ebmlStr(b, d, s) === 'webm') { out.container = 'webm'; } });
        var at = id.n + sz.n + sz.v;
        r.get(at, 16, function (e2, b2) {
            var sid = !e2 && ebmlId(b2, 0), ssz = sid && ebmlSize(b2, sid.n);
            if (!ssz || sid.v !== I.SEGMENT) { cb(e2 || upError('no Matroska segment', 422)); return; }
            segData = at + sid.n + ssz.n;
            if (ssz.v >= 0) { segEnd = segData + ssz.v; }
            walk(segData);
        });
    });
    function parse(id, b) {
        if (id === I.INFO) {
            var scale = 1000000, dur = 0;
            ebmlEach(b, 0, b.length, function (cid, d, s) { if (cid === I.SCALE) { scale = ebmlUint(b, d, s) || 1000000; } else if (cid === I.DURATION) { dur = ebmlFloat(b, d, s); } });
            if (dur > 0 && isFinite(dur)) { out.duration = Math.round(dur * scale / 1e6) / 1000; }
            got.info = true;
        } else if (id === I.TRACKS) {
            var list = [];
            ebmlEach(b, 0, b.length, function (cid, d, s) { if (cid === 0xAE) { list.push(miMkvTrack(b, d, s)); } });
            miTracks(out, list);
            got.tracks = true;
        } else if (id === I.SEEKHEAD && !got.seek) {   // (the first one only: one pointing at itself can't send it round)
            got.seek = true;
            ebmlEach(b, 0, b.length, function (cid, d, s) {
                if (cid !== I.SEEK) { return; }
                var sid = 0, pos = -1;
                ebmlEach(b, d, d + s, function (x, xd, xs) { if (x === I.SEEKID) { sid = ebmlUint(b, xd, xs); } else if (x === I.SEEKPOS) { pos = ebmlUint(b, xd, xs); } });
                if (pos >= 0) { if (sid === I.INFO) { seek.info = pos; } else if (sid === I.TRACKS) { seek.tracks = pos; } else if (sid === I.CUES) { out.cues = true; } }
            });
        }
    }
    function element(at, then) {   // one element at at: read and parsed when it's one wanted; then(next place, its id)
        r.get(at, 16, function (e, b) {
            var id = !e && ebmlId(b, 0), sz = id && ebmlSize(b, id.n);
            if (!sz) { then(-1, 0); return; }
            var d = at + id.n + sz.n;
            if (sz.v < 0 || id.v === I.CLUSTER) { then(-1, id.v); return; }
            if (id.v === I.CUES) { out.cues = true; }
            if ((id.v === I.INFO || id.v === I.TRACKS || id.v === I.SEEKHEAD) && sz.v <= MI_ELEMENT_MAX) {
                r.get(d, sz.v, function (e2, body) { if (!e2) { parse(id.v, body); } then(d + sz.v, id.v); });
                return;
            }
            then(d + sz.v, id.v);
        });
    }
    function walk(at) {
        if (got.info && got.tracks) { cb(null); return; }
        if (at < 0 || at >= segEnd || steps++ > 64 || (r.size() !== null && at >= r.size())) { fromSeek(); return; }
        element(at, walk);
    }
    function fromSeek() {   // (Info or Tracks after the clusters: where its SeekHead says)
        var want = !got.tracks && seek.tracks >= 0 ? seek.tracks : !got.info && seek.info >= 0 ? seek.info : -1;
        if (jumps++ >= 2) { want = -1; }
        if (want < 0) { cb(got.tracks ? null : upError('no track list found', 422)); return; }
        if (want === seek.tracks) { seek.tracks = -1; } else { seek.info = -1; }
        element(segData + want, function () { fromSeek(); });
    }
}
// MP4 / MOV: the top-level boxes walked to moov, read when it's MI_ELEMENT_MAX or less.
function mp4Each(b, o, end, fn) {
    end = Math.min(end, b.length);
    for (var n = 0; o + 8 <= end && n < 4096; n++) {
        var size = b.readUInt32BE(o), type = b.toString('binary', o + 4, o + 8), hdr = 8;
        if (size === 1) { if (o + 16 > end) { return; } size = b.readUInt32BE(o + 8) * TWO32 + b.readUInt32BE(o + 12); hdr = 16; }
        else if (size === 0) { size = end - o; }
        if (size < hdr) { return; }
        if (fn(type, o + hdr, Math.min(size, end - o) - hdr) === false) { return; }
        o += size;
    }
}
var MP4_GENERIC_NAMES = /handler|^core media|^mainconcept|^gpac|^l-smash|^apple |^isomedia|^bento4|^video$|^audio$|^sound$|^subtitle$|^text$/i;
function miMp4Track(b, d, s) {
    var t = { type: 0, codec: '', lang: '', name: '', default: false };
    (function walk(o, end, depth) {
        if (depth > 6) { return; }
        mp4Each(b, o, end, function (type, bd, bs) {
            if (type === 'mdia' || type === 'minf' || type === 'stbl' || type === 'udta') { walk(bd, bd + bs, depth + 1); }
            else if (type === 'tkhd' && bs >= 4) { t.enabled = (b[bd + 3] & 1) === 1; }
            else if (type === 'mdhd' && bs >= 24) {
                var lo = b[bd] === 1 ? bd + 32 : bd + 20;
                if (lo + 2 <= bd + bs) { var l = b.readUInt16BE(lo); if (l && l !== 0x7FFF) { t.lang = String.fromCharCode(((l >> 10) & 31) + 0x60, ((l >> 5) & 31) + 0x60, (l & 31) + 0x60); } }
            }
            else if (type === 'hdlr' && bs >= 12) {
                var h = b.toString('binary', bd + 8, bd + 12);
                t.type = h === 'vide' ? 1 : h === 'soun' ? 2 : (h === 'subt' || h === 'text' || h === 'sbtl' || h === 'clcp') ? 17 : 0;
                var nm = bs > 24 ? b.slice(bd + 24, bd + Math.min(bs, 24 + 200)).toString('utf8').replace(/\0[\s\S]*$/, '').trim() : '';
                if (nm && !MP4_GENERIC_NAMES.test(nm) && !t.name) { t.name = nm.slice(0, 120); }
            }
            else if (type === 'name' && bs > 0 && bs < 400) { var un = b.slice(bd, bd + bs).toString('utf8').replace(/\0/g, '').trim(); if (un && !MP4_GENERIC_NAMES.test(un)) { t.name = un.slice(0, 120); } }
            else if (type === 'stsd' && bs >= 16) { mp4Each(b, bd + 8, bd + bs, function (et, ed, es) { entry(et, ed, es); return false; }); }
        });
    })(d, d + s, 0);
    function entry(type, ed, es) {   // the first sample description: its codec, and what's in it
        t.codecId = type;
        t.codec = miCodec(type);
        if (/^(dvh1|dvhe|dvav|dva1)$/.test(type)) { t.dv = t.dv || { profile: 0, compat: 0 }; }
        if (t.type === 1 && es >= 78) {
            t.width = b.readUInt16BE(ed + 24); t.height = b.readUInt16BE(ed + 26);
            mp4Each(b, ed + 78, ed + es, function (ct, cd, cs) {
                if ((ct === 'dvcC' || ct === 'dvvC') && cs >= 5) { t.dv = miDv(b, cd, cs); }
                else if (ct === 'colr' && cs >= 10 && b.toString('binary', cd, cd + 4) === 'nclx') { var tc = b.readUInt16BE(cd + 6); t.hdr = tc === 16 ? 'hdr10' : tc === 18 ? 'hlg' : ''; }
                else if (ct === 'hvcC' && cs >= 19) { t.bitDepth = (b[cd + 17] & 7) + 8; }
                else if (ct === 'av1C' && cs >= 3) { t.bitDepth = (b[cd + 2] & 0x40) ? ((b[cd + 2] & 0x20) ? 12 : 10) : 8; }
            });
        } else if (t.type === 2 && es >= 28) {
            t.channels = b.readUInt16BE(ed + 16);
            mp4Each(b, ed + 28, ed + es, function (ct, cd, cs) {
                var acmod = -1, lfe = 0;
                if (ct === 'dac3' && cs >= 3) { var v = (b[cd] << 16) | (b[cd + 1] << 8) | b[cd + 2]; acmod = (v >> 11) & 7; lfe = (v >> 10) & 1; }
                else if (ct === 'dec3' && cs >= 6) { var u = b.readUInt32BE(cd + 2); acmod = (u >>> 17) & 7; lfe = (u >>> 16) & 1; }
                if (acmod >= 0) { t.channels = [2, 1, 2, 3, 3, 4, 4, 5][acmod] + lfe; }
            });
        }
    }
    return t;
}
function miMp4(r, out, cb) {
    var steps = 0;
    out.container = 'mp4';
    (function box(at) {
        if (steps++ > 32 || (r.size() !== null && at >= r.size())) { cb(upError('no moov box found', 422)); return; }
        r.get(at, 16, function (e, b) {
            if (e || b.length < 8) { cb(e || upError('no moov box found', 422)); return; }
            var size = b.readUInt32BE(0), type = b.toString('binary', 4, 8), hdr = 8;
            if (size === 1) { if (b.length < 16) { cb(upError('a broken box', 422)); return; } size = b.readUInt32BE(8) * TWO32 + b.readUInt32BE(12); hdr = 16; }
            else if (size === 0) { size = r.size() !== null ? r.size() - at : -1; }
            if (!/^[\x20-\x7e]{4}$/.test(type) || size < hdr) { cb(upError('not an MP4 file', 422)); return; }
            if (type === 'qt  ' || type === 'ftyp') { if (type === 'ftyp' && b.length >= 12 && b.toString('binary', 8, 12) === 'qt  ') { out.container = 'mov'; } }
            if (type !== 'moov') { box(at + size); return; }
            if (size - hdr > MI_ELEMENT_MAX) { cb(upError('the header is too big to read', 422)); return; }
            r.get(at + hdr, size - hdr, function (e2, m) {
                if (e2) { cb(e2); return; }
                var list = [], ts = 0, dur = 0;
                mp4Each(m, 0, m.length, function (t, d, s) {
                    if (t === 'mvhd' && s >= 20) {
                        if (m[d] === 1 && s >= 32) { ts = m.readUInt32BE(d + 20); dur = m.readUInt32BE(d + 24) * TWO32 + m.readUInt32BE(d + 28); }
                        else { ts = m.readUInt32BE(d + 12); dur = m.readUInt32BE(d + 16); }
                    }
                    else if (t === 'trak') { list.push(miMp4Track(m, d, s)); }
                    else if (t === 'mvex') { out.fragmented = true; }
                });
                if (ts > 0 && dur > 0 && dur < 0xFFFFFFFF) { out.duration = Math.round(dur / ts * 1000) / 1000; }
                var firstOf = {};
                list.forEach(function (t) { if (!firstOf[t.type] && t.enabled !== false) { firstOf[t.type] = true; t.default = true; } });   // (MP4 has no default flag: the first enabled one plays)
                miTracks(out, list);
                out.cues = true;   // (an MP4's sample tables: always seekable)
                cb(null);
            });
        });
    })(0);
}
// The file's header read through readAt (see miReader): cb(err, answer).
function mediaInfo(readAt, cb) {
    cb = once(cb);
    if (_miActive >= MI_ACTIVE_MAX) { cb(upError('busy', 503)); return; }
    _miActive++;
    var done = false, timer = setTimeout(function () { finish(upError('timed out', 504)); }, MI_MS);
    function finish(err, val) { if (done) { return; } done = true; clearTimeout(timer); _miActive--; cb(err, val); }
    var r = miReader(readAt), out = { container: null, duration: 0, size: 0, video: null, audio: [], subs: [], cues: false };
    r.get(0, 64, function (e, b) {
        if (e) { finish(e); return; }
        var then = function (err) { out.size = r.size() || 0; if (err && !out.video && !out.audio.length) { finish(err); return; } finish(null, out); };
        if (b.length >= 4 && b.readUInt32BE(0) === 0x1A45DFA3) { out.container = 'mkv'; miMkv(r, out, then); }
        else if (b.length >= 8 && /^(ftyp|moov|mdat|free|skip|wide|pnot)$/.test(b.toString('binary', 4, 8))) { miMp4(r, out, then); }
        else { out.size = r.size() || 0; finish(null, out); }   // (AVI, MPEG-TS…: not read)
    });
    return function () { finish(upError('stopped', 499)); };
}
// readAt for a link (a source's): Range requests with its own headers, its redirects followed
// once (the next pieces asked at the final address), not into the home network from outside it
// unless lan, never to the TV itself; a server that ignores Range: only from the start.
function miHttpReader(url, who, lan, stops) {
    var at = url, firstHost = null, hops = 0;
    return function readAt(off, len, cb) {
        cb = once(cb);
        var pu;
        try { pu = urllib.parse(at); } catch (e) { cb(upError('bad link', 400)); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { cb(upError('a link it can\'t follow', 400)); return; }
        if (firstHost === null) { firstHost = pu.hostname; }
        else if (!fileHopOk(firstHost, pu.hostname, lan)) { cb(upError('a link into your home network', 403)); return; }
        var h = liveHeaders(who), r = null, chunks = [], got = 0, ended = false;
        h.Range = 'bytes=' + off + '-' + (off + len - 1);
        h['Accept-Encoding'] = 'identity';
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: 'GET', headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        function end(err, total) {
            if (ended) { return; }
            ended = true; clearTimeout(timer);
            try { if (r) { r.abort(); } } catch (e) {}
            if (err) { cb(err); return; }
            var buf = Buffer.concat(chunks, got);
            cb(null, buf.length > len ? buf.slice(0, len) : buf, total);
        }
        var timer = setTimeout(function () { end(upError('timed out', 504)); }, 12000);
        stops.push(function () { end(upError('stopped', 499)); });
        try {
            r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (ended) { resp.resume(); return; }
                var sc = resp.statusCode, total = 0;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 5) {
                    resp.resume(); hops++; ended = true; clearTimeout(timer);
                    try { at = urllib.resolve(at, String(resp.headers.location)); } catch (e) { cb(upError('bad link', 400)); return; }
                    readAt(off, len, cb);
                    return;
                }
                if (sc === 200 && off > 0) { resp.resume(); end(upError('the server only sends the whole file', 502)); return; }
                if (sc !== 200 && sc !== 206) { resp.resume(); end(upError('HTTP ' + sc, sc >= 400 && sc < 600 ? sc : 502)); return; }
                var cr = /\/(\d+)\s*$/.exec(String(resp.headers['content-range'] || ''));
                total = cr ? +cr[1] : sc === 200 ? +(resp.headers['content-length'] || 0) : 0;
                resp.on('data', function (c) { if (ended) { return; } chunks.push(c); got += c.length; if (got >= len) { end(null, total); } });
                resp.on('end', function () { end(null, total); });
                resp.on('error', function () { end(upError('the host stopped sending', 502)); });
            });
            guardSelf(r, function () { end(upError('a link it can\'t follow', 400)); });
            r.on('error', function (e) { end(upError((e && e.message) || 'network error', 502)); });
            r.end();
        } catch (e) { end(upError('bad link', 400)); }
    };
}
// readAt for a file on a USB drive (a video, on a drive: fsRealOk); done() closes it.
function miFileReader(p, cb) {
    if (!VIDEO_EXT.test(p)) { cb({ status: 400, message: 'not a video file' }); return; }
    fsRealOk(p, function (err, real) {
        if (err) { cb(err); return; }
        var fs = require('fs');
        fs.open(real, 'r', function (e, fd) {
            if (e) { cb({ status: 404, message: e.code || e.message }); return; }
            fs.fstat(fd, function (e1, st) {
                var size = !e1 && st ? st.size : 0;
                cb(null, function readAt(off, len, rcb) {
                    var n = Math.max(0, Math.min(len, size - off)), buf = allocBuffer(n);
                    if (!n) { rcb(null, buf, size); return; }
                    fs.read(fd, buf, 0, n, off, function (e2, got) { if (e2) { rcb({ status: 500, message: e2.code || e2.message }); return; } rcb(null, buf.slice(0, got), size); });
                }, function done() { fs.close(fd, function () {}); });
            });
        });
    });
}
// readAt for a file in a network folder (davReq: its sign-in, its certificate).
function miDavReader(f, url, stops) {
    return function readAt(off, len, cb) {
        stops.push(davReq(f, 'GET', url, { Range: 'bytes=' + off + '-' + (off + len - 1) }, null, len + 65536, function (err, sc, buf) {
            if (err) { cb(err); return; }
            if (sc !== 206 && !(sc === 200 && off === 0)) { cb(upError('HTTP ' + sc, 502)); return; }
            cb(null, buf.length > len ? buf.slice(0, len) : buf, 0);
        }));
    };
}

// /fsmi: a video's header on a USB drive.
function fsMediaInfo(p, cb) {
    miFileReader(p, function (err, readAt, done) {
        if (err) { cb(err); return; }
        mediaInfo(readAt, function (e, r) { done(); cb(e, r); });
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
// A partial download's version tag (ETag / Last-Modified), for resuming it after a restart: kept
// in StremioK's own folder by the partial file's path (DL_VALIDATORS at most, the oldest dropped),
// never on the drive, where a prepared file could be a link elsewhere (read: its contents sent
// as If-Range; written: overwritten). None to keep it in (TizenBrew): downloads are closed there.
var DL_VALIDATORS = 64;
function dlValFile() { var d = tokenDir(); return d ? d + '/dl-validators.json' : null; }
function dlValAll() {
    var f = dlValFile(), o = null;
    if (!f) { return {}; }
    try { o = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch (e) { o = null; }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}
function dlValGet(part) { var v = dlValAll()[part]; return typeof v === 'string' ? v.slice(0, 300) : ''; }
function dlValSet(part, v) {
    var f = dlValFile();
    if (!f) { return; }
    var all = dlValAll();
    delete all[part];
    if (v) { all[part] = String(v).slice(0, 300); }
    var keys = Object.keys(all);
    while (keys.length > DL_VALIDATORS) { delete all[keys.shift()]; }
    try { require('fs').writeFileSync(f, JSON.stringify(all), { mode: 384 }); } catch (e) { log('download version not kept: ' + (e && (e.code || e.message))); }
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
            fs.lstat(part, function (se, st) {   // (not through a link: a partial file is a regular one, see openPart)
                if (!se && !st.isFile()) { dlEnd(e, 'failed', 'the partial file isn\'t a regular file'); return; }
                var have = se ? 0 : st.size;
                if (!have || e.answered) { get(e.url, 0, have); return; }   // (this one's own, from this run: picked up as it was)
                e.validator = dlValGet(part);   // (a partial file from before a restart: resumed only with its version kept)
                if (e.validator) { get(e.url, 0, have); } else { dropPart(function () { get(e.url, 0, 0); }); }
            });
        });
    });
    // (….part.v: where 2.1.17–2.2.1 kept the version, removed; a link removed, not what it points to)
    function dropPart(then) { dlValSet(part, ''); fs.unlink(part + '.v', function () { fs.unlink(part, function () { then(); }); }); }
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
                dlValSet(part, e.validator);
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
                        dlValSet(part, ''); fs.unlink(part + '.v', function () {});
                        dlEnd(e, 'done');
                    });
                });
            });
            }
        }
    }
}

// ---- Backup and logs on a USB drive: /bak/write (POST), /bak/read ----
// For when the phone's page can't be reached: Export configuration's file and Diagnostics' logs
// written to a USB drive StremioK lists (a mounted one under /opt/media), and the backup read back.
// Only into its StremioK folder, under two names: stremiok-backup.txt (replaced each time) and
// stremiok-logs-<date and time>.txt; BAK_MAX at most. Written in full to a .part file, flushed to
// the drive, then renamed (a stick pulled meanwhile leaves the last backup whole). Nothing else
// is read or written: no path comes from the page but the drive's.
var BAK_MAX = 1572864, BAK_DIR = 'StremioK', BAK_FILE = 'stremiok-backup.txt';
function bakDrive(q) {
    var d = String(q.drive || '');
    if (!/^\/opt\/media\/[^\/]+$/.test(d) || !fsDirOk(d) || !isMounted(d)) { return null; }
    return d;
}
function bakName(kind) {
    if (kind === 'backup') { return BAK_FILE; }
    var t = new Date(Date.now()), two = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'stremiok-logs-' + t.getFullYear() + '-' + two(t.getMonth() + 1) + '-' + two(t.getDate()) + '-' + two(t.getHours()) + two(t.getMinutes()) + two(t.getSeconds()) + '.txt';
}
function bakWrite(drive, kind, text, cb) {
    cb = once(cb);
    var fs = require('fs'), dir = drive + '/' + BAK_DIR, name = bakName(kind), data = toBuffer(text);
    if (data.length > BAK_MAX) { cb({ status: 413, message: 'too much' }); return; }
    fs.mkdir(dir, function (e0) {
        if (e0 && e0.code !== 'EEXIST') { cb({ status: errStatus(e0), message: e0.code || e0.message }); return; }
        fsRealOk(dir, function (err, realDir) {   // (StremioK's folder, not a link out of the drive)
            if (err) { cb(err); return; }
            fs.lstat(realDir, function (e1, st) {
                if (e1 || !st || !st.isDirectory()) { cb({ status: 409, message: 'not a folder' }); return; }
                var part = realDir + '/' + name + '.part', dest = realDir + '/' + name;
                fs.open(part, 'w', function (e2, fd) {
                    if (e2) { cb({ status: errStatus(e2), message: e2.code || e2.message }); return; }
                    fs.write(fd, data, 0, data.length, 0, function (e3) {
                        fs.fsync(fd, function () {
                            fs.close(fd, function () {
                                if (e3) { fs.unlink(part, function () {}); cb({ status: 507, message: e3.code || e3.message }); return; }
                                fs.rename(part, dest, function (e4) {
                                    if (e4) { fs.unlink(part, function () {}); cb({ status: errStatus(e4), message: e4.code || e4.message }); return; }
                                    cb(null, { file: BAK_DIR + '/' + name, size: data.length });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}
function bakRead(drive, cb) {
    cb = once(cb);
    var fs = require('fs'), p = drive + '/' + BAK_DIR + '/' + BAK_FILE;
    fsRealOk(p, function (err, real) {
        if (err) { cb(err.status === 404 || /ENOENT/.test(err.message || '') ? { status: 404, message: 'no backup on that drive' } : err); return; }
        fs.open(real, 'r', function (e0, fd) {
            if (e0) { cb({ status: 404, message: 'no backup on that drive' }); return; }
            fs.fstat(fd, function (e1, st) {
                if (e1 || !st || !st.isFile()) { fs.close(fd, function () {}); cb({ status: 404, message: 'no backup on that drive' }); return; }
                if (st.size > BAK_MAX) { fs.close(fd, function () {}); cb({ status: 413, message: 'too large to be a backup' }); return; }
                var buf = allocBuffer(st.size);
                fs.read(fd, buf, 0, st.size, 0, function (e2, n) {
                    fs.close(fd, function () {});
                    if (e2) { cb({ status: 500, message: e2.code || e2.message }); return; }
                    cb(null, { text: buf.slice(0, n).toString('utf8'), at: st.mtime ? +st.mtime : 0 });
                });
            });
        });
    });
}
function bakControl(req, res, path, query, body) {
    var q = davQ(query), drive = bakDrive(q);
    if (!drive) { send(res, 400, 'text/plain', 'not a USB drive'); return; }
    function answer(err, r) {
        if (err) { send(res, err.status && err.status < 600 ? err.status : 500, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
        send(res, 200, 'application/json', JSON.stringify(r));
    }
    if (path === '/bak/write') { bakWrite(drive, q.kind === 'logs' ? 'logs' : 'backup', body, answer); return; }
    bakRead(drive, answer);
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
            res.setHeader('Access-Control-Allow-Headers', 'X-StremioK, X-AIOM-Key, X-Dav-Auth, X-Dav-Cert, *');   // (named: older engines don't take *)
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (path === '/health' && req.method === 'GET') { send(res, 200, 'text/plain', 'ok'); return; }
        var who = callerProblem(req);
        // The app's own guide POSTs: a browser sends an Origin with every POST (the app's page is
        // file://: "null"); let through with the token, or the guide ticket (for an app that can't
        // read the token: see /epg/ticket), which no web page has (/epg/ only).
        if (who === 'origin' && req.method === 'POST' && /^\/(epg\/(load|get|clear)|drm\/license|entry\/give|plug\/fetch|bak\/write)$/.test(path) && /^(null|file:\/\/)$/.test(String(req.headers.origin || '')) && (hasToken(parts[1]) || hasTicket(parts[1]))) { who = null; }   // (and a DRM license's: see drmControl)
        if (who) { send(res, 403, 'text/plain', 'not allowed (' + who + ')'); return; }
        if (req.method === 'OPTIONS') { if (isFs) { send(res, 403, 'text/plain', 'not allowed'); return; } res.writeHead(200); res.end(); return; }
        var epgPost = req.method === 'POST' && /^\/epg\/(load|get|clear)$/.test(path);   // (a guide's channels: in the body, see epgControl)
        var drmPost = req.method === 'POST' && path === '/drm/license';   // (a Widevine license request: see drmControl)
        var givePost = req.method === 'POST' && path === '/entry/give';   // (a configuration file for the phone: see entryControl)
        var plugPost = req.method === 'POST' && path === '/plug/fetch';   // (a Nuvio plugin's request: see plugControl)
        var bakPost = req.method === 'POST' && path === '/bak/write';   // (a backup or the logs for a USB drive: see bakControl)
        if (req.method !== 'GET' && !epgPost && !drmPost && !givePost && !plugPost && !bakPost) { send(res, 405, 'text/plain', 'GET only'); return; }   // (before any work)
        if (req.url.length > (/^\/epg\//.test(path) ? 32768 : /^\/(fsdl\/add|live\/(open|master)|dav\/(list|walk|sub|mi|open)|smb\/[a-z]+|dlna\/[a-z]+)$/.test(path) ? 8192 : 2048)) { send(res, 414, 'text/plain', 'request too long'); return; }   // (a download's link can be long; a guide's channels, a bitset)
        // (StremioK gave up on it — a screen left, the player closed: what it still waits for is
        // dropped; 'close' before the response finished means that on every Node)
        var leaving = [];
        function leaveAll() { var l = leaving; leaving = []; l.forEach(function (f) { try { f(); } catch (e) {} }); }
        if (!isFs && path !== '/dav/walk' && path !== '/smb/walk' && path !== '/dlna/walk' && !/^\/live\/[0-9a-f]{32}\/[tf]$/.test(path) && !/^\/net\/[0-9a-f]{32}\/f$/.test(path)) {   // (a folder's walk, a raw channel's or a file's stream: their own limits)
            var deadline = setTimeout(function () { if (!res.headersSent) { send(res, 504, 'text/plain', 'took too long'); } leaveAll(); }, REQ_MS);
            res.on('finish', function () { clearTimeout(deadline); });
            res.on('close', function () { clearTimeout(deadline); if (!res.finished) { leaveAll(); } });
        }

        if (givePost) {
            if (+(req.headers['content-length'] || 0) > GIVE_MAX) { send(res, 413, 'text/plain', 'too much'); req.resume(); return; }
            var gbody = '', gover = false;
            req.setEncoding('utf8');
            req.on('data', function (c) { if (gover) { return; } gbody += c; if (gbody.length > GIVE_MAX) { gover = true; send(res, 413, 'text/plain', 'too much'); } });
            req.on('end', function () { if (!gover) { entryControl(req, res, path, parts[1], gbody); } });
            return;
        }
        if (bakPost || path === '/bak/read') {
            if (!entryAllowed(req, parts[1]) && !(bakPost && hasTicket(parts[1]))) { send(res, 403, 'text/plain', 'not allowed (token)'); req.resume(); return; }
            if (!bakPost) { bakControl(req, res, path, parts[1], ''); return; }
            if (+(req.headers['content-length'] || 0) > BAK_MAX) { send(res, 413, 'text/plain', 'too much'); req.resume(); return; }
            var bbody = '', bover = false;
            req.setEncoding('utf8');
            req.on('data', function (c) { if (bover) { return; } bbody += c; if (bbody.length > BAK_MAX) { bover = true; send(res, 413, 'text/plain', 'too much'); } });
            req.on('end', function () { if (!bover) { bakControl(req, res, path, parts[1], bbody); } });
            return;
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
        if (path === '/plug/fetch' && !plugPost) { send(res, 405, 'text/plain', 'POST only'); return; }
        if (plugPost) {
            if (!entryAllowed(req, parts[1])) { send(res, 403, 'text/plain', 'not allowed (token)'); req.resume(); return; }
            if (+(req.headers['content-length'] || 0) > PLUG_ASK_MAX) { send(res, 413, 'text/plain', 'too much asked'); req.resume(); return; }
            var pbody = '', pover = false;
            req.setEncoding('utf8');
            req.on('data', function (c) { if (pover) { return; } pbody += c; if (pbody.length > PLUG_ASK_MAX) { pover = true; send(res, 413, 'text/plain', 'too much asked'); } });
            req.on('end', function () { if (!pover) { plugControl(res, parts[1], pbody, leaving); } });
            return;
        }
        if (drmPost) {
            if (+(req.headers['content-length'] || 0) > DRM_BODY_MAX) { send(res, 413, 'text/plain', 'too much asked'); req.resume(); return; }
            var dbody = '', dover = false;
            req.setEncoding('utf8');
            req.on('data', function (c) { if (dover) { return; } dbody += c; if (dbody.length > DRM_BODY_MAX) { dover = true; send(res, 413, 'text/plain', 'too much asked'); } });
            req.on('end', function () { if (!dover) { drmControl(req, res, parts[1], dbody, leaving); } });
            return;
        }
        if (/^\/epg\//.test(path)) { epgControl(req, res, path, parts[1]); return; }   // (a playlist's TV guide: see epgControl)
        if (/^\/dav\//.test(path)) { davControl(req, res, path, parts[1], leaving); return; }
        if (/^\/net\//.test(path)) { netControl(req, res, path, parts[1]); return; }
        if (/^\/smb\//.test(path)) { smbControl(req, res, path, parts[1], leaving); return; }   // (a Windows / NAS share: see smbControl)
        if (/^\/dlna\//.test(path)) { dlnaControl(req, res, path, parts[1], leaving); return; }   // (a DLNA media server: see dlnaControl)   // (a network folder's file, for the player: its ticket)   // (a network folder: see davControl)
        if (path === '/aiom/addons') { aiomControl(req, res, parts[1], leaving); return; }
        if (path === '/xtvod/list' || path === '/xtvod/find') { xtvControl(req, res, path, parts[1]); return; }   // (an Xtream account's films and series: see xtvControl)
        if (path === '/stalker/list' || path === '/stalker/link' || path === '/stalker/genres' || path === '/stalker/vod' || path === '/stalker/play') { stalkerControl(req, res, path, parts[1], leaving); return; }   // (a Stalker portal: see stalkerControl)   // (AIOManager's addons: see aiomControl)   // (a live channel's sound repacked: see liveControl)   // (the phone's one-time page: see below)
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
            if (['/fslist', '/fswalk', '/fssub', '/fshash', '/fsmi'].indexOf(path) === -1) { send(res, 404, 'text/plain', 'not found'); return; }
            var why = fsAllowed(req, parts[1]);
            if (why) { send(res, 403, 'text/plain', 'not allowed (' + why + ')'); return; }
            var fm = (parts[1] || '').match(/(?:^|&)path=([^&]*)/), fp = '';
            try { fp = fm ? decodeURIComponent(fm[1]) : ''; } catch (e) { fp = ''; }
            if (!fsDirOk(fp)) { send(res, 400, 'text/plain', 'not on a USB drive'); return; }
            var job = path === '/fslist' ? fsList : path === '/fswalk' ? fsWalk : path === '/fssub' ? fsSub : path === '/fsmi' ? fsMediaInfo : fsHash;
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
// A raw MPEG-TS channel (one endless stream, no playlist: an Xtream account's default) is looked
// at the same way, its first LIVE_RAW_PROBE bytes (raw: true); its relay, /live/<id>/t, is the
// stream as it comes, its sound repacked on the way (liveStream); &raw=1 asks for that one.
var HLS_MASTER_MAX = 524288;   // (an HLS quality list: /live/master)
var LIVE_RAW_PROBE = 1048576, LIVE_RAW_CHUNK = 65536;
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
        var h = liveHeaders(who);
        if (who.range) { h.Range = who.range; }   // (a film's piece that's part of a file: EXT-X-BYTERANGE)
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
                if (who.range && sc === 200) { resp.resume(); end(upError('the server sent the whole file, not the part asked for', 502)); return; }
                if (sc !== 200 && !(sc === 206 && who.range)) { resp.resume(); end(upError('HTTP ' + sc, sc >= 400 && sc < 600 ? sc : 502)); return; }
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
// A film's relay (&film=1: HLS through StremioK's service) keeps every link (up to
// LIVE_FILM_LINKS: seeking goes back to any of them), a live channel's its last LIVE_LINKS.
// raw: a key, an init section or an encrypted / fMP4 piece, passed on as it is; range: a byte
// range of its link ('bytes=a-b').
var LIVE_FILM_LINKS = 30000, LIVE_FILM_IDLE_MS = 3 * 3600 * 1000;
function liveLink(s, url, kind, seq, ch, raw, range) {
    var key = kind + (ch !== undefined ? ch : '') + (range ? '@' + range : '') + ' ' + url;
    if (s.at[key] !== undefined) { return s.at[key]; }
    var n = s.next++, keep = s.film ? LIVE_FILM_LINKS : LIVE_LINKS;
    s.links[n] = { url: url, kind: kind, seq: seq, ch: ch, key: key, raw: !!raw, range: range || '' };
    s.at[key] = n;
    var old = s.links[n - keep];
    if (old) { delete s.at[old.key]; delete s.links[n - keep]; }
    return n;
}
// EXT-X-BYTERANGE's "<length>[@<offset>]" as a Range header, after the one before it (a piece
// without an offset follows the last of the same link): { range, end } or null.
function liveRange(v, last, url) {
    var m = /^\s*(\d+)(?:@(\d+))?\s*$/.exec(v || '');
    if (!m) { return null; }
    var len = +m[1], off = m[2] !== undefined ? +m[2] : (last && last.url === url ? last.end : 0);
    if (!(len > 0)) { return null; }
    return { range: 'bytes=' + off + '-' + (off + len - 1), end: off + len, url: url };
}
function liveBase(s) { return 'http://localhost:' + PORT + '/live/' + s.id + '/'; }
function liveEntry(s) { return liveBase(s) + (s.raw ? 't' : 'm?n=' + s.top); }   // (the link the player opens)
// Where an MPEG-TS stream's packets start (three in a row), or -1.
function tsSync(b) {
    for (var i = 0; i < 188 && i + 376 < b.length; i++) { if (b[i] === 0x47 && b[i + 188] === 0x47 && b[i + 376] === 0x47) { return i; } }
    return -1;
}
// A raw channel's relay (/live/<id>/t): the stream fetched with its headers and passed on as it
// comes, in whole TS packets, its sound repacked chunk by chunk (liveFix: each chunk the next one,
// what's left of a frame going on in the next). One at a time per relay (the player opening it
// again: the old one stops); the TV's player reading slowly holds the server back (no piling up).
function liveStream(s, req, res) {
    if (s.stop) { s.stop(); }
    var r = null, gone = false, seq = 0, carry = null, started = false, hops = 0, synced = false;
    s.a = liveAudio();
    function stop() { gone = true; try { if (r) { r.abort(); } } catch (e) {} if (s.stop === stop) { s.stop = null; } }
    s.stop = stop;
    res.on('close', stop);
    function fail(code, why) { if (gone) { return; } if (!started) { send(res, code, 'text/plain', 'failed: ' + why); } else { try { res.end(); } catch (e) {} } stop(); }
    var timer = setTimeout(function () { if (!started) { fail(504, 'timed out'); } }, LIVE_MS);
    // A chunk's whole packets out, its sound repacked (what's after its last whole packet kept for
    // the next): false when the player has enough for now.
    function pass(b) {
        var whole = b.length - b.length % 188, out = b.slice(0, whole);
        carry = whole < b.length ? b.slice(whole) : null;
        if (!whole) { return true; }
        if (s.fix) { try { out = liveFix(s, out, seq); } catch (e) { log('live (raw): ' + (e && e.message)); s.a = liveAudio(); } }
        seq++;
        return res.write(out);
    }
    function get(url) {
        var pu;
        try { pu = urllib.parse(url); } catch (e) { fail(400, 'bad link'); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { fail(400, 'a link it can\'t follow'); return; }
        var h = liveHeaders(s);
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        try {
            r = (pu.protocol === 'https:' ? https : http).get(opts, function (resp) {
                if (gone) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 5) { resp.resume(); hops++; get(urllib.resolve(url, resp.headers.location)); return; }
                if (sc !== 200) { resp.resume(); clearTimeout(timer); fail(sc >= 400 && sc < 600 ? sc : 502, 'HTTP ' + sc); return; }
                clearTimeout(timer);
                started = true;
                res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                resp.on('data', function (c) {
                    if (gone) { return; }
                    s.last = Date.now();
                    var b = carry ? Buffer.concat([carry, c]) : c;
                    if (!synced) {   // (the stream's first bytes: from its first packet)
                        var at = tsSync(b);
                        if (at < 0) { carry = b.length > 1024 ? b.slice(-376) : b; return; }
                        b = b.slice(at); synced = true;
                    }
                    if (b.length < LIVE_RAW_CHUNK && !(seq === 0 && b.length >= 188 * 3)) { carry = b; return; }   // (whole chunks: fewer, larger pieces to repack)
                    if (!pass(b)) { resp.pause(); res.once('drain', function () { if (!gone) { resp.resume(); } }); }
                });
                resp.on('end', function () {   // (what's held back goes too)
                    if (gone) { return; }
                    if (carry && synced) { pass(carry); }
                    try { res.end(); } catch (e) {}
                    stop();
                });
                resp.on('error', function () { fail(502, 'the stream broke off'); });
            });
            r.on('error', function (e) { fail(502, (e && (e.code || e.message)) || 'unknown'); });
            guardSelf(r, function () { fail(400, 'a link to the TV itself'); });
        } catch (e) { fail(502, (e && e.message) || 'unknown'); }
    }
    get(s.raw);
}
function liveRewrite(s, text, base) {
    var master = /#EXT-X-STREAM-INF/.test(text), direct = !master && /#EXT-X-KEY:METHOD=(?!NONE)|#EXT-X-MAP/.test(text);
    var sq = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/.exec(text), seq = sq ? +sq[1] : 0, pre = liveBase(s);
    var span = null, last = null;   // (a film's: the byte range of the next piece, and of the one before)
    return String(text).split(/\r?\n/).map(function (ln) {
        var t = ln.trim();
        if (!t) { return ln; }
        if (t.charAt(0) === '#') {
            if (s.film && /^#EXT-X-BYTERANGE:/.test(t)) { span = t.slice(17); return ln; }
            return t.replace(/URI="([^"]*)"/, function (all, v) {
                var abs = urllib.resolve(base, v);
                if (/^#EXT-X-MEDIA:/.test(t)) { return 'URI="' + pre + 'm?n=' + liveLink(s, abs, 'm') + '"'; }
                if (s.film && /^#EXT-X-(KEY|MAP|SESSION-KEY):/.test(t)) {   // (a film's key or init section: with its headers too)
                    var br = /^#EXT-X-MAP:/.test(t) && /BYTERANGE="([^"]*)"/.exec(t), r = br ? liveRange(br[1], null, abs) : null;
                    return 'URI="' + pre + 's?n=' + liveLink(s, abs, 's', -1, undefined, true, r ? r.range : '') + '"';
                }
                return 'URI="' + abs + '"';
            });
        }
        var abs = urllib.resolve(base, t);
        if (master) { return pre + 'm?n=' + liveLink(s, abs, 'm'); }
        if (s.film) {
            var rg = span !== null ? liveRange(span, last, abs) : null;
            span = null; last = rg;
            return pre + 's?n=' + liveLink(s, abs, 's', seq++, undefined, direct, rg ? rg.range : '');
        }
        if (direct) { seq++; return abs; }
        return pre + 's?n=' + liveLink(s, abs, 's', seq++);
    }).join('\n');
}
// opts: { fix: the sound repacked, cc: the caption channels added (ccAsked) }.
function liveSession(u, who, opts) {
    var ids = Object.keys(_live);
    if (ids.length >= LIVE_MAX) {   // (the one asked for longest ago goes)
        ids.sort(function (x, y) { return _live[x].last - _live[y].last; });
        if (_live[ids[0]].stop) { _live[ids[0]].stop(); }   // (a raw stream it was relaying: stopped)
        delete _live[ids[0]];
    }
    var raw = !!opts.raw && !opts.film;
    var s = { id: crypto.randomBytes(16).toString('hex'), ua: who.ua, ref: who.ref, cookie: who.cookie || '', origin: who.origin || '', accept: who.accept || '', lang: who.lang || '', links: {}, at: {}, next: 0, last: Date.now(), a: liveAudio(),
        fix: opts.fix !== false && !opts.film, cc: opts.cc && opts.cc.length && !opts.film && !raw ? opts.cc : null, film: !!opts.film, c: ccState(), got: Object.create(null),
        raw: raw ? u : null };
    _live[s.id] = s;
    s.top = liveLink(s, u, 'm');
    return s;
}
function livePurge() {
    var now = Date.now();
    Object.keys(_live).forEach(function (id) { if (now - _live[id].last > (_live[id].film ? LIVE_FILM_IDLE_MS : LIVE_IDLE_MS)) { if (_live[id].stop) { _live[id].stop(); } delete _live[id]; } });   // (a film may be paused a while)
}
// The look: the playlist (a master's first variant), then the start of the segment a player
// starts with (the third from the end); with captions in that start, the whole segment (up to
// CC_PROBE) for which caption channels have text: cc, ccSure (false: none had text in it).
function liveProbe(u, who, cb, leaving) {
    var depth = 0;
    function list(url) {
        leaving.push(liveGet(url, who, depth ? LIVE_LIST_MAX : LIVE_RAW_PROBE, function (err, body, at) {
            if (err) { cb(err); return; }
            var text = body.toString('utf8');
            if (!/^\s*#EXTM3U/.test(text)) {
                var at0 = depth ? -1 : tsSync(body);   // (a raw MPEG-TS stream, not a playlist: its first MB looked at)
                if (at0 >= 0) { var vr = liveCut(body.slice(at0)); vr.raw = true; vr.cc = []; vr.ccSure = true; cb(null, vr); return; }
                cb(null, { fix: false, sure: true, why: 'not an HLS playlist' }); return;
            }
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
        }, !depth));   // (the first link: what it gives up to LIVE_RAW_PROBE, a raw stream never ending)
    }
    list(u);
}
// ---- Nuvio plugins' requests (/plug/fetch) ----
// A plugin (js/plugins.js runs it, in QuickJS inside a Web Worker) reaches the network only
// through here: POST, the token in the link (a page's Worker can't send the header without a
// preflight), the ask in the body as JSON { url, method, headers, body, redirect }. http(s) only;
// never the TV itself; the home network only when the link says lan=1 (Local-network links from
// internet addons: Allowed), checked on the name, on the address it resolves to, and at every
// redirect. Nothing of StremioK's is added (no cookies, keys or its headers); the plugin's own
// headers go as they are, but for those that only the connection decides. The answer: JSON
// { status, statusText, url, redirected, headers, body } (text, up to 1 MB after unpacking).
var PLUG_ASK_MAX = 300 * 1024, PLUG_BODY_MAX = 1048576, PLUG_MS = 20000, PLUG_ACTIVE = 6, PLUG_PER_MINUTE = 240, PLUG_HOPS = 5;
var PLUG_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
var PLUG_DROP = /^(host|content-length|connection|keep-alive|transfer-encoding|te|trailer|upgrade|proxy-.*|x-stremiok|accept-encoding)$/i;
var _plugActive = 0, _plugRecent = [];
function plugHeaders(h) {
    var out = {}, n = 0, size = 0;
    if (!h || typeof h !== 'object') { return out; }
    Object.keys(h).forEach(function (k) {
        var v = String(h[k] == null ? '' : h[k]);
        if (n >= 40 || !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]{1,64}$/.test(k) || PLUG_DROP.test(k) || !/^[\x20-\x7e\t]*$/.test(v) || (size += k.length + v.length) > 16384) { return; }
        out[k] = v; n++;
    });
    return out;
}
function plugControl(res, query, text, leaving) {
    var ask = null;
    try { ask = JSON.parse(text); } catch (e) { ask = null; }
    if (!ask || typeof ask !== 'object') { send(res, 400, 'text/plain', 'failed: not a request'); return; }
    var url = String(ask.url || ''), method = String(ask.method || 'GET').toUpperCase(), lan = /(?:^|&)lan=1(?:&|$)/.test(query || '');
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 4096) { send(res, 400, 'text/plain', 'failed: only http(s) links'); return; }
    if (PLUG_METHODS.indexOf(method) === -1) { send(res, 400, 'text/plain', 'failed: method ' + method); return; }
    var body = ask.body == null ? null : String(ask.body);
    var now = Date.now();
    _plugRecent = _plugRecent.filter(function (t) { return now - t < 60000; });
    if (_plugRecent.length >= PLUG_PER_MINUTE) { send(res, 429, 'text/plain', 'failed: too many requests, wait a minute'); return; }
    if (_plugActive >= PLUG_ACTIVE) { send(res, 503, 'text/plain', 'failed: busy'); return; }
    _plugActive++; _plugRecent.push(now);
    var r = null, over = false, hops = 0, headers = plugHeaders(ask.headers);
    if (!Object.keys(headers).some(function (k) { return /^user-agent$/i.test(k); })) { headers['User-Agent'] = TV_UA; }
    headers['Accept-Encoding'] = 'gzip, deflate';
    function done(code, out) {
        if (over) { return; }
        over = true; _plugActive--; clearTimeout(timer);
        try { if (r) { r.abort(); } } catch (e) {}
        if (code === 200) { send(res, 200, 'application/json', JSON.stringify(out)); } else { send(res, code, 'text/plain', 'failed: ' + out); }
    }
    leaving.push(function () { done(499, 'nobody waiting'); });
    var timer = setTimeout(function () { done(504, 'timed out'); }, PLUG_MS);
    function go(u) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { done(400, 'bad link'); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { done(403, 'not a link a plugin may follow'); return; }
        if (!lan && isLanName(pu.hostname)) { done(403, 'a link into your home network (Local-network links from internet addons: Blocked)'); return; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: method, headers: headers };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        try {
            r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (over) { resp.resume(); return; }
                var sc = resp.statusCode, loc = resp.headers.location;
                if (ask.redirect !== 'manual' && sc >= 300 && sc < 400 && loc && sc !== 304) {
                    resp.resume();
                    if (++hops > PLUG_HOPS) { done(502, 'too many redirects'); return; }
                    if (sc === 303 || ((sc === 301 || sc === 302) && method === 'POST')) { method = 'GET'; body = null; }
                    go(urllib.resolve(u, loc));
                    return;
                }
                var parts = [], size = 0;
                resp.on('data', function (c) {
                    if (over) { return; }
                    size += c.length;
                    if (size > PLUG_BODY_MAX) { done(502, 'answer too large (over 1 MB)'); return; }
                    parts.push(c);
                });
                resp.on('end', function () {
                    if (over) { return; }
                    decompress(Buffer.concat(parts), resp.headers['content-encoding'], function (err, buf) {
                        if (err) { done(502, 'couldn\'t unpack the answer'); return; }
                        if (buf.length > PLUG_BODY_MAX) { done(502, 'answer too large (over 1 MB)'); return; }
                        var hs = {};
                        Object.keys(resp.headers).forEach(function (k) { if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) { var v = resp.headers[k]; hs[k] = (Array.isArray(v) ? v.join(', ') : String(v)).slice(0, 8192); } });
                        done(200, { status: sc, statusText: resp.statusMessage || '', url: u, redirected: hops > 0, headers: hs, body: buf.toString('utf8') });
                    });
                });
                resp.on('error', function () { done(502, 'the site stopped sending'); });
            });
            guardSelf(r, function () { done(403, 'not a link a plugin may follow'); });
            if (!lan) {   // (the address a name leads to, before connecting: not into the home network)
                r.on('socket', function (sock) {
                    sock.on('lookup', function (err, addr) { if (!err && isLanName(addr)) { done(403, 'a link into your home network (Local-network links from internet addons: Blocked)'); } });
                    sock.on('connect', function () { if (isLanName(sock.remoteAddress)) { done(403, 'a link into your home network (Local-network links from internet addons: Blocked)'); } });
                });
            }
            r.on('error', function (e) { done(502, (e && e.message) || 'network error'); });
            if (body !== null && method !== 'GET' && method !== 'HEAD') { r.write(body); }
            r.end();
        } catch (e) { done(400, 'bad request'); }
    }
    go(url);
}

// ---- A file through the relay (/live/file, then /live/<id>/f) ----
// A video file (not HLS) that needs headers the TV's player can't send (Origin, Accept,
// Accept-Language; under TizenBrew the page's player sends none), or one asked for (hold OK ›
// Play through StremioK's service): each of the player's requests passed on with the file's
// headers and its byte range (seeking works), the answer streamed back as it comes, nothing kept.
// Shares the relays' count (LIVE_MAX); dropped after LIVE_FILM_IDLE_MS unused. Redirects: the
// downloads' host rule (never the TV itself), and into the home network only when allowed (lan).
function liveFileSession(u, who, lan) {
    var ids = Object.keys(_live);
    if (ids.length >= LIVE_MAX) {
        ids.sort(function (x, y) { return _live[x].last - _live[y].last; });
        if (_live[ids[0]].stop) { _live[ids[0]].stop(); }
        delete _live[ids[0]];
    }
    var s = { id: crypto.randomBytes(16).toString('hex'), file: u, ua: who.ua, ref: who.ref, cookie: who.cookie || '', origin: who.origin || '', accept: who.accept || '', lang: who.lang || '',
        lan: !!lan, film: true, links: {}, last: Date.now() };
    _live[s.id] = s;
    return s;
}
// A host in the home network (by its name or address): a private, link-local or carrier-grade
// address, a name without a dot, or a .local / .lan / .home.arpa / .internal one.
function isLanName(host) {
    var h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/\.$/, '');
    if (!h) { return false; }
    if (isSelfAddr(h)) { return true; }
    if (h.indexOf(':') !== -1) { var w = ipv6Words(h); return !!w && ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80); }
    var n = ipv4Int(h);
    if (n >= 0) {
        var a = Math.floor(n / 16777216), b = Math.floor(n / 65536) % 256;
        return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    return h.indexOf('.') === -1 || /\.(local|lan|home\.arpa|internal|home)$/.test(h);
}
// May a redirect go from the file's own host to this one? Not into the home network from a host
// outside it, unless Local-network links from internet addons allows it.
function fileHopOk(firstHost, nextHost, lan) { return lan || isLanName(firstHost) || !isLanName(nextHost); }
function liveFile(s, req, res) {
    var r = null, gone = false, hops = 0, firstHost = '';
    var range = /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(String(req.headers.range || '')) ? String(req.headers.range) : '';
    function stop() { gone = true; try { if (r) { r.abort(); } } catch (e) {} }
    res.on('close', stop);
    function fail(code, why) { if (gone) { return; } if (!res.headersSent) { send(res, code, 'text/plain', 'failed: ' + why); } else { try { res.end(); } catch (e) {} } stop(); }
    var timer = setTimeout(function () { if (!res.headersSent) { fail(504, 'timed out'); } }, LIVE_MS);
    function get(url) {
        var pu;
        try { pu = urllib.parse(url); } catch (e) { fail(400, 'bad link'); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { fail(400, 'a link it can\'t follow'); return; }
        if (!hops) { firstHost = pu.hostname; }
        else if (!fileHopOk(firstHost, pu.hostname, s.lan)) { fail(403, 'a link into your home network'); return; }
        var h = liveHeaders(s);
        if (range) { h.Range = range; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        try {
            r = (pu.protocol === 'https:' ? https : http).get(opts, function (resp) {
                if (gone) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 5) { resp.resume(); hops++; get(urllib.resolve(url, resp.headers.location)); return; }
                if (sc !== 200 && sc !== 206) { resp.resume(); clearTimeout(timer); fail(sc >= 400 && sc < 600 ? sc : 502, 'HTTP ' + sc); return; }
                clearTimeout(timer);
                var out = { 'Content-Type': String(resp.headers['content-type'] || 'application/octet-stream'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
                if (resp.headers['content-length']) { out['Content-Length'] = resp.headers['content-length']; }
                if (resp.headers['content-range']) { out['Content-Range'] = resp.headers['content-range']; }
                res.writeHead(sc, out);
                resp.on('data', function (c) {
                    if (gone) { return; }
                    s.last = Date.now();
                    if (!res.write(c)) { resp.pause(); res.once('drain', function () { if (!gone) { resp.resume(); } }); }
                });
                resp.on('end', function () { if (!gone) { try { res.end(); } catch (e) {} } });
                resp.on('error', function () { fail(502, 'the host stopped sending'); });
            });
            guardSelf(r, function () { fail(400, 'a link it can\'t follow'); });
            r.on('error', function (e) { clearTimeout(timer); fail(502, (e && e.message) || 'network error'); });
        } catch (e) { clearTimeout(timer); fail(400, 'bad link'); }
    }
    get(s.file);
}
function liveHeader(v, max) { v = String(v || ''); return v.length <= (max || 300) && /^[\x20-\x7e]+$/.test(v) ? v : ''; }
function liveWho(q) {   // (a stream's own headers, as the app sends them)
    var origin = liveHeader(q.origin, 2048);
    return { ua: liveHeader(q.ua), ref: liveHeader(q.ref), cookie: liveHeader(q.cookie, 4096), origin: /^https?:\/\/[^\s\/?#]+$/i.test(origin) ? origin : '', accept: liveHeader(q.accept, 512), lang: liveHeader(q.lang, 512) };
}
// The request headers a relay sends: the stream's own (the TV's User-Agent when it has none).
function liveHeaders(who) {
    var h = { 'User-Agent': who.ua || TV_UA };
    if (who.ref) { h.Referer = who.ref; }
    if (who.cookie) { h.Cookie = who.cookie; }
    if (who.origin) { h.Origin = who.origin; }
    if (who.accept) { h.Accept = who.accept; }
    if (who.lang) { h['Accept-Language'] = who.lang; }
    return h;
}
function liveControl(req, res, path, query, leaving) {
    livePurge();
    var q = {};
    (query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } });
    if (path === '/live/master') {   // an HLS stream's quality list (or a DASH manifest), asked with its own User-Agent / Referer (which a web page can't send)
        if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
        var mu = q.u || '';
        if (!/^https?:\/\/[^\s]+$/i.test(mu) || mu.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        leaving.push(liveGet(mu, liveWho(q), HLS_MASTER_MAX, function (err, buf) {
            if (err) { send(res, err.status || 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            var text = buf.toString('utf8').replace(/^\uFEFF/, '');
            var dash = /<MPD[\s>]/i.test(text.slice(0, 4000));   // (a DASH manifest: is it a film? see the player's manifestVod)
            if (text.replace(/^\s+/, '').indexOf('#EXTM3U') !== 0 && !dash) { send(res, 502, 'text/plain', 'not an HLS playlist'); return; }
            send(res, 200, dash ? 'application/dash+xml' : 'application/vnd.apple.mpegurl', text);
        }));
        return;
    }
    if (path === '/live/open') {
        if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
        var u = q.u || '', who = liveWho(q);
        if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        var cc = ccAsked(q.cc);
        if (q.force === '1') {
            var sf = liveSession(u, who, { fix: q.fix !== '0', cc: cc, film: q.film === '1', raw: q.raw === '1' });
            send(res, 200, 'application/json', JSON.stringify({ fix: true, sure: true, why: 'asked for', url: liveEntry(sf) }));
            return;
        }
        liveProbe(u, who, function (err, v) {
            if (err) { send(res, 200, 'application/json', JSON.stringify({ fix: false, sure: false, why: 'couldn\'t check: ' + (err.message || 'unknown') })); return; }
            if (v.fix) { var s = liveSession(u, who, { fix: true, cc: cc, raw: v.raw }); v.url = liveEntry(s); }
            send(res, 200, 'application/json', JSON.stringify(v));
        }, leaving);
        return;
    }
    if (path === '/live/mi') {   // what's in a source's file, from its header (see mediaInfo)
        if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
        var iu = q.u || '', stops = [];
        if (!/^https?:\/\/[^\s]+$/i.test(iu) || iu.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        var stopMi = mediaInfo(miHttpReader(iu, liveWho(q), q.lan === '1', stops), function (err, r) {
            stops.forEach(function (f) { try { f(); } catch (e) {} });
            if (err) { send(res, err.status && err.status < 600 ? err.status : 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            send(res, 200, 'application/json', JSON.stringify(r));
        });
        if (stopMi) { leaving.push(stopMi); }
        return;
    }
    if (path === '/live/file') {   // a file through the relay (see liveFile)
        if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
        var fu = q.u || '';
        if (!/^https?:\/\/[^\s]+$/i.test(fu) || fu.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        var fsn = liveFileSession(fu, liveWho(q), q.lan === '1');
        send(res, 200, 'application/json', JSON.stringify({ url: liveBase(fsn) + 'f' }));
        return;
    }
    var rf = /^\/live\/([0-9a-f]{32})\/f$/.exec(path);
    if (rf) {
        var fs0 = _live[rf[1]];
        if (!fs0 || !fs0.file) { send(res, 404, 'text/plain', 'not found'); return; }
        fs0.last = Date.now();
        liveFile(fs0, req, res);
        return;
    }
    // (m: a playlist; p: the top one under its made-up quality list; s: a segment; c: a caption
    // track's playlist; v: a segment's captions)
    var rt = /^\/live\/([0-9a-f]{32})\/t$/.exec(path);
    if (rt) {   // (a raw stream's relay: see liveStream)
        var rs = _live[rt[1]];
        if (!rs || !rs.raw) { send(res, 404, 'text/plain', 'not found'); return; }
        rs.last = Date.now();
        liveStream(rs, req, res);
        return;
    }
    var m = /^\/live\/([0-9a-f]{32})\/(m|p|s|c|v)$/.exec(path), s = m && _live[m[1]], link = s && /^\d+$/.test(q.n || '') ? s.links[+q.n] : null;
    if (!link || link.kind !== m[2]) { send(res, 404, 'text/plain', 'not found'); return; }
    s.last = Date.now();
    var kind = m[2], seg = kind === 's' || kind === 'v';
    function captions(body) {
        try { return ccSegment(s.c, body, link.seq); } catch (e) { log('live captions: ' + (e && e.message)); s.c = ccState(); return null; }
    }
    if (kind === 'v' && s.c.segs[link.seq]) { send(res, 200, 'text/vtt; charset=utf-8', ccVtt(s.c.segs[link.seq], link.ch)); return; }
    var who = link.range ? { ua: s.ua, ref: s.ref, cookie: s.cookie, origin: s.origin, accept: s.accept, lang: s.lang, range: link.range } : s;   // (a byte range: asked as one)
    leaving.push((seg && s.cc ? liveShared : liveGet)(link.url, who, seg ? LIVE_SEG_MAX : LIVE_LIST_MAX, function (err, body, at) {
        if (err) { send(res, err.status || 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
        if (kind === 'v') { var cs = captions(body); send(res, 200, 'text/vtt; charset=utf-8', cs ? ccVtt(cs, link.ch) : 'WEBVTT\n'); return; }
        if (kind === 'c') { send(res, 200, 'application/vnd.apple.mpegurl', ccList(s, body.toString('utf8'), at, link.ch)); return; }
        if (kind !== 's') { send(res, 200, 'application/vnd.apple.mpegurl', s.cc && kind === 'm' && +q.n === s.top ? ccMaster(s, body.toString('utf8'), at) : liveRewrite(s, body.toString('utf8'), at)); return; }
        if (link.raw) { send(res, 200, 'application/octet-stream', body); return; }   // (a film's key, init section or encrypted piece: as it came)
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

// ---- Network folders (WebDAV: /dav/list, /dav/walk, /dav/sub) ----
// A folder a NAS or computer shares over WebDAV, for the Local tab. Each request names the
// folder's address (?u=, no sign-in in it) and a path under it (&p=), and carries its sign-in
// (X-Dav-Auth: base64 "user:password", sent on as Basic) and a certificate the user trusted
// (X-Dav-Cert: its base64 DER) in headers, never in a link: nothing is kept here. Requests go
// to that server only, below that address (redirects: the same server, still below it), never
// to the TV itself. An https certificate no known authority signed is sent back (why:
// 'untrusted') for the app to ask about; trusted, it's the only one accepted for that folder
// (its name not checked: that certificate or nothing). What the user can fix is answered 200
// { why, message } (the app reads it); a malformed request, 400.
var DAV_MS = 20000, DAV_LIST_MAX = 2 * 1048576, DAV_ENTRIES = 2000;
var DAV_WALK_DIRS = 2000, DAV_WALK_FILES = 20000, DAV_WALK_DEPTH = 12, DAV_WALK_PAR = 4, DAV_WALK_MS = 90000;
var DAV_PROPS = '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/></D:prop></D:propfind>';
var _davWalking = null;
function davQ(query) {
    var q = {};
    String(query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {} } });
    return q;
}
function davWhy(why, message) { return Object.assign(new Error(message), { why: why }); }
// The folder a request names: { base (its address, ending in /), pu, auth, cert } or null.
function davFolder(req, q) {
    var u = String(q.u || '').trim(), pu;
    if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 1000) { return null; }
    try { pu = urllib.parse(u); } catch (e) { return null; }
    if (!pu.hostname || pu.auth || pu.search || pu.hash || !dlHostOk(pu.hostname)) { return null; }
    var base = pu.protocol + '//' + pu.host + String(pu.pathname || '/').replace(/\/*$/, '/');
    var a = String((req.headers && req.headers['x-dav-auth']) || ''), c = String((req.headers && req.headers['x-dav-cert']) || '');
    if (a && !/^[A-Za-z0-9+\/=]{4,1400}$/.test(a)) { return null; }
    if (c && !/^[A-Za-z0-9+\/=]{200,5000}$/.test(c)) { return null; }
    var pem = c ? '-----BEGIN CERTIFICATE-----\n' + c.replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END CERTIFICATE-----\n' : '';
    var up = a ? fromBase64(a).toString('utf8') : '', colon = up.indexOf(':');
    return { base: base, pu: urllib.parse(base), auth: a ? 'Basic ' + a : '', cert: pem, user: colon === -1 ? up : up.slice(0, colon), pass: colon === -1 ? '' : up.slice(colon + 1) };
}
// Digest sign-in (RFC 7616, MD5 and MD5-sess, qop=auth): a folder whose server asks for it in its
// 401 (some NAS and router firmwares offer nothing else). Its challenge kept here, in memory, per
// folder and sign-in (DAV_DIGEST_MAX), so the next requests send it at once (no 401 round trip
// each); a stale or new challenge replaces it. Adapted from Tessel's (MIT License, Copyright (c)
// 2026 Patrick: github.com/PatrickSt1991/tessel-tizen-tv).
var DAV_DIGEST_MAX = 16, _davDigest = {};
function davDigestKey(f) { return f.base + '\n' + crypto.createHash('sha256').update(f.auth || '').digest('hex'); }
function md5hex(s) { return crypto.createHash('md5').update(toBuffer(String(s), 'utf8')).digest('hex'); }
function davChallenge(h) {
    var m = /(^|[\s,])digest\s+([\s\S]*)/i.exec(String(h || ''));
    if (!m) { return null; }
    var d = {}, re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi, p, n = 0;
    while ((p = re.exec(m[2])) && n++ < 20) { d[p[1].toLowerCase()] = (p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3]).slice(0, 500); }
    if (d.realm === undefined || !d.nonce) { return null; }
    var alg = String(d.algorithm || 'MD5').toUpperCase();
    if (alg !== 'MD5' && alg !== 'MD5-SESS') { return null; }   // (SHA-256 Digest: not offered by the servers seen)
    return d;
}
function davDigestAuth(f, method, uri) {
    var k = davDigestKey(f), st = _davDigest[k];
    if (!st || !f.auth) { return ''; }
    var ch = st.ch, alg = String(ch.algorithm || 'MD5').toUpperCase(), cnonce = crypto.randomBytes(8).toString('hex');
    st.nc++;
    var ha1 = md5hex(f.user + ':' + ch.realm + ':' + f.pass);
    if (alg === 'MD5-SESS') { ha1 = md5hex(ha1 + ':' + ch.nonce + ':' + cnonce); }
    var ha2 = md5hex(method + ':' + uri), qop = /(^|,)\s*auth\s*(,|$)/i.test(ch.qop || '') ? 'auth' : '';
    var nc = ('00000000' + st.nc.toString(16)).slice(-8);
    var resp = qop ? md5hex(ha1 + ':' + ch.nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2) : md5hex(ha1 + ':' + ch.nonce + ':' + ha2);
    var q = function (v) { return '"' + String(v).replace(/["\\]/g, '\\$&') + '"'; };
    var out = 'Digest username=' + q(f.user) + ', realm=' + q(ch.realm) + ', nonce=' + q(ch.nonce) + ', uri=' + q(uri) + ', response="' + resp + '", algorithm=' + (alg === 'MD5-SESS' ? 'MD5-sess' : 'MD5');
    if (qop) { out += ', qop=auth, nc=' + nc + ', cnonce="' + cnonce + '"'; }
    if (ch.opaque) { out += ', opaque=' + q(ch.opaque); }
    return out;
}
function davDigestLearn(f, header) {
    var ch = f.auth ? davChallenge(header) : null;
    if (!ch) { return false; }
    var k = davDigestKey(f), keys = Object.keys(_davDigest);
    if (!_davDigest[k] && keys.length >= DAV_DIGEST_MAX) { delete _davDigest[keys[0]]; }
    _davDigest[k] = { ch: ch, nc: 0 };
    return true;
}
function davUsesDigest(f) { return !!_davDigest[davDigestKey(f)]; }
// The sign-in a request to the folder carries: Digest once its server asked for it, else Basic.
function davAuthFor(f, method, path) { return davDigestAuth(f, method, path) || f.auth; }
// A path under the folder (each part %-escaped; '', '.' and '..' refused), or null.
function davUrl(f, rel, dir) {
    rel = String(rel || '').replace(/^\/+|\/+$/g, '');
    if (!rel) { return f.base; }
    if (rel.length > 1024 || rel.indexOf('\0') !== -1) { return null; }
    var segs = rel.split('/');
    if (segs.some(function (s) { return !s || s === '.' || s === '..'; })) { return null; }
    return f.base + segs.map(encodeURIComponent).join('/') + (dir ? '/' : '');
}
function davUnder(f, pu) { return sameServerRedirect(f.pu, pu) && String(pu.pathname || '').indexOf(String(f.pu.pathname || '/')) === 0; }
function davCertProblem(e) { return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|Hostname\/IP|altnames|ERR_TLS/i.test(String((e && e.code) || '') + ' ' + String((e && e.message) || '')); }
// One request to the folder's server (with its redirects): one deadline for the whole chain; the
// abort it returns stops it. cb(err, status, body (a 2xx's), final address).
function davReq(f, method, url, headers, body, max, cb) {
    cb = once(cb);
    var ctl = { r: null, done: false };
    var timer = setTimeout(function () { finish(davWhy('unreachable', 'no answer in ' + (DAV_MS / 1000) + ' s')); }, DAV_MS);
    function finish(err, sc, buf, at) { if (ctl.done) { return; } ctl.done = true; clearTimeout(timer); try { if (ctl.r) { ctl.r.abort(); } } catch (e) {} cb(err, sc, buf, at); }
    function go(u, hops) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { finish(upError('bad address', 400)); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { finish(upError('an address it can\'t reach', 400)); return; }
        var h = { 'User-Agent': 'StremioK', 'Accept': '*/*' }, data = body ? toBuffer(body) : null;
        Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
        if (f.auth) { h.Authorization = davAuthFor(f, method, pu.path); }
        if (data) { h['Content-Length'] = data.length; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: method, headers: h };
        if (pu.protocol === 'https:') {
            if (f.cert) { opts.ca = [f.cert]; opts.checkServerIdentity = function () { return undefined; }; opts.agent = false; }
            else if (caList().length) { opts.ca = caList(); }
        }
        var chunks = [], size = 0;
        try {
            var r = ctl.r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (ctl.done || ctl.r !== r) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && sc !== 304 && resp.headers.location && hops < 4) {
                    resp.resume();
                    var np = null;
                    try { np = urllib.parse(urllib.resolve(u, String(resp.headers.location))); } catch (e) { np = null; }
                    if (!np || !davUnder(f, np)) { finish(davWhy('elsewhere', 'it sent StremioK to another address: not followed (the sign-in stays with it)')); return; }
                    go(urllib.format(np), hops + 1);
                    return;
                }
                // (a Digest challenge, new or stale: answered once with it)
                if (sc === 401 && !ctl.digested && davDigestLearn(f, resp.headers['www-authenticate'])) { resp.resume(); ctl.digested = true; go(u, hops); return; }
                if (sc < 200 || sc >= 300) { resp.resume(); finish(null, sc, null, u); return; }
                resp.on('data', function (c) { if (ctl.done) { return; } chunks.push(c); size += c.length; if (size > max) { finish(davWhy('toolarge', 'its answer is over ' + Math.round(max / 1048576) + ' MB')); } });
                resp.on('end', function () { finish(null, sc, Buffer.concat(chunks, size), u); });
                resp.on('error', function (e) { finish(e); });
            });
            r.on('error', function (e) { if (ctl.r === r) { finish(e); } });
            guardSelf(r, function () { finish(upError('an address it can\'t reach', 400)); });
            if (data) { r.write(data); }
            r.end();
        } catch (e) { finish(e); }
    }
    go(url, 0);
    return function () { if (!ctl.done) { ctl.done = true; clearTimeout(timer); try { if (ctl.r) { ctl.r.abort(); } } catch (e) {} } };
}
// The certificate an https folder shows (not trusted): { cert (base64 DER), fp (SHA-256), name,
// until }, or null. Only the handshake: nothing is sent. Checking is off for this one connection
// on purpose (a certificate that fails it can't be read otherwise: Node gives none after the
// failure); it's only shown to you to trust or not, and every request is checked (davReq: the
// bundled authorities, or the one certificate you trusted).
function davCertOf(f, cb) {
    cb = once(cb);
    var pu = f.pu, sock = null, timer = setTimeout(function () { done(null); }, 10000);
    function done(r) { clearTimeout(timer); try { if (sock) { sock.destroy(); } } catch (e) {} cb(r); }
    try {
        var o = { host: pu.hostname, port: +(pu.port || 443), rejectUnauthorized: false };
        if (!/^[\d.]+$/.test(pu.hostname) && String(pu.hostname).indexOf(':') === -1) { o.servername = pu.hostname; }
        sock = tls.connect(o, function () {
            if (isSelfAddr(sock.remoteAddress)) { done(null); return; }
            var c = null;
            try { c = sock.getPeerCertificate(); } catch (e) { c = null; }
            if (!c || !c.raw) { done(null); return; }
            var fp = crypto.createHash('sha256').update(c.raw).digest('hex').toUpperCase().replace(/(..)(?!$)/g, '$1:');
            done({ cert: c.raw.toString('base64'), fp: fp, name: String((c.subject && c.subject.CN) || '').slice(0, 200), until: String(c.valid_to || '').slice(0, 60) });
        });
        sock.on('error', function () { done(null); });
    } catch (e) { done(null); }
}
// What went wrong, as the app shows it: { why, message[, cert, fp, name, until] }.
function davProblem(f, err, cb) {
    if (err && err.why) { cb({ why: err.why, message: err.message }); return; }
    if (f.pu.protocol === 'https:' && davCertProblem(err)) {
        davCertOf(f, function (c) {
            var p = { why: 'untrusted', message: 'its certificate isn\'t from a known authority (' + String((err && (err.code || err.message)) || '') + ')' };
            if (c) { p.cert = c.cert; p.fp = c.fp; p.name = c.name; p.until = c.until; }
            cb(p);
        });
        return;
    }
    var code = String((err && (err.code || err.message)) || 'unknown');
    cb({ why: /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(code) ? 'unreachable' : 'failed', message: 'couldn\'t reach it (' + code + ')' });
}
function xmlText(s) {
    return String(s).replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }).replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&');
}
function davNorm(p) { return String(p || '').replace(/\/+$/, ''); }
// A PROPFIND answer's entries directly in the folder (dirPath: its path, decoded): [{ name, dir,
// size }], the folder itself left out. Any namespace prefix (D:, d:, lp1:, none).
function davEntries(xml, dirPath) {
    var out = [], self = davNorm(dirPath), seen = {};
    var parts = String(xml).split(/<(?:[\w.-]+:)?response(?:\s[^>]*)?>/i).slice(1);
    for (var i = 0; i < parts.length && out.length < DAV_ENTRIES; i++) {
        var x = parts[i], hm = /<(?:[\w.-]+:)?href(?:\s[^>]*)?>([^<]*)</i.exec(x);
        if (!hm) { continue; }
        var href = xmlText(hm[1]).trim(), p;
        try { p = /^https?:\/\//i.test(href) ? String(urllib.parse(href).pathname || '/') : href.split('?')[0]; } catch (e) { continue; }
        try { p = decodeURIComponent(p); } catch (e) {}
        var n = davNorm(p), name;
        if (n === self) { continue; }
        if (n.indexOf(self + '/') === 0) { name = n.slice(self.length + 1); if (name.indexOf('/') !== -1) { continue; } }
        else { name = n.split('/').pop(); }
        if (!name || name.length > 255 || name.indexOf('\0') !== -1 || name === '.' || name === '..' || seen[name]) { continue; }
        seen[name] = 1;
        var dir = /<(?:[\w.-]+:)?collection\s*\/?>/i.test(x);
        var sm = /<(?:[\w.-]+:)?getcontentlength(?:\s[^>]*)?>\s*(\d+)\s*</i.exec(x);
        out.push({ name: name, dir: dir, size: dir ? 0 : (sm ? +sm[1] : 0) });
    }
    return out;
}
// A folder's listing (one level): cb(err, { entries }).
function davList(f, rel, cb) {
    cb = once(cb);
    var url = davUrl(f, rel, true);
    if (!url) { cb(upError('not a path in the folder', 400)); return noop; }
    return davReq(f, 'PROPFIND', url, { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, DAV_PROPS, DAV_LIST_MAX, function (err, sc, buf, at) {
        if (err) { cb(err); return; }
        if (sc === 401 || sc === 403) { cb(davWhy('auth', 'it refused the user name or password (HTTP ' + sc + ')')); return; }
        if (sc === 404) { cb(davWhy('missing', 'no such folder there (HTTP 404)')); return; }
        var text = buf ? buf.toString('utf8') : '';
        if (sc !== 207 || !/multistatus/i.test(text)) { cb(davWhy('notdav', 'not a WebDAV folder (HTTP ' + sc + ')')); return; }
        var dirPath = '/';
        try { dirPath = String(urllib.parse(at).pathname || '/'); dirPath = decodeURIComponent(dirPath); } catch (e) {}
        cb(null, { entries: davEntries(text, dirPath), digest: davUsesDigest(f) || undefined });   // (digest: plays through the service, see /net/)
    });
}
// Every video and subtitle file under the folder (the index): cb(err, { files: [{ p, size }],
// dirs, truncated }). Bounded (DAV_WALK_*); a subfolder it can't read is left out (truncated).
function davWalk(f, st, cb) {
    cb = once(cb);
    var files = [], queue = [{ rel: '', depth: 0 }], active = 0, dirs = 0, truncated = false, started = Date.now();
    function end() { if (!active && !queue.length) { cb(null, { files: files, dirs: dirs, truncated: truncated }); } }
    function pump() {
        while (!st.cancelled && active < DAV_WALK_PAR && queue.length) {
            if (dirs >= DAV_WALK_DIRS || files.length >= DAV_WALK_FILES || Date.now() - started > DAV_WALK_MS) { truncated = true; queue = []; break; }
            var d = queue.shift();
            dirs++; active++;
            st.aborts.push(davList(f, d.rel, (function (d) {
                return function (err, r) {
                    active--;
                    if (st.cancelled) { return; }
                    if (err) {
                        if (!d.rel) { st.cancelled = true; cb(err); return; }   // (the folder itself)
                        truncated = true;
                    } else {
                        var names = r.entries.map(function (e) { return e.name; });
                        r.entries.forEach(function (e) {
                            if (HIDDEN_NAME.test(e.name)) { return; }
                            var p = d.rel ? d.rel + '/' + e.name : e.name;
                            if (e.dir) { if (d.depth < DAV_WALK_DEPTH) { queue.push({ rel: p, depth: d.depth + 1 }); } else { truncated = true; } }
                            else if (walkWants(e.name, names) && files.length < DAV_WALK_FILES) { files.push({ p: p, size: e.size || 0 }); }
                        });
                    }
                    pump();
                };
            })(d)));
        }
        end();
    }
    pump();
}
// A subtitle file in the folder, as UTF-8 text (as /fssub: ASS / SSA as SRT).
function davSub(f, rel, cb) {
    cb = once(cb);
    var url = davUrl(f, rel, false);
    if (!url || !SUB_EXT.test(String(rel))) { cb(upError('not a subtitle file in the folder', 400)); return noop; }
    return davReq(f, 'GET', url, null, null, FS_SUB_MAX, function (err, sc, buf) {
        if (err) { cb(err); return; }
        if (sc !== 200 || !buf) { cb(upError('HTTP ' + sc, 502)); return; }
        var text = decodeText(buf);
        cb(null, text);
    });
}
// ---- Windows / NAS shares (SMB): /smb/shares, /smb/list, /smb/walk, /smb/sub, /smb/mi, /smb/open ----
// A share as a network folder: listed, indexed, its subtitle files read and its files played (through
// /net/<ticket>/f: the player's byte ranges as SMB reads). The client: SMB 2.0.2 / 2.1 (no SMB 1, no
// SMB 3 encryption), NTLMv2 sign-in or guest, HMAC-SHA256 signing where the server wants it (or the
// session isn't a guest's), CREATE / QUERY_DIRECTORY / READ / CLOSE, and the share list through
// the srvsvc pipe (NetrShareEnum). Adapted from Tessel's (MIT License, Copyright (c) 2026 Patrick:
// github.com/PatrickSt1991/tessel-tizen-tv, tizen-app/service/service.js), every length and offset a
// server sends checked against what came (a broken or hostile one can't make it throw, allocate or
// wait for ever): SMB_MSG_MAX a message, SMB_REQ_MS a request, SMB_CONN_MAX connections, closed
// SMB_IDLE_MS unused. Only to the home network (a private address, or a name in it: isLanName).
// The sign-in comes with each request (X-Dav-Auth: user:password, "DOMAIN\user" for a domain; none:
// a guest) and is kept only with an open connection or a player's ticket.
var SMB_PORT = 445, SMB_CONNECT_MS = 8000, SMB_REQ_MS = 15000, SMB_IDLE_MS = 120000, SMB_CONN_MAX = 4, SMB_MSG_MAX = 8 * 1048576;
var SMB_READ = 262144, SMB_LIST_MAX = 3000, SMB_WALK_DIRS = 2000, SMB_WALK_FILES = 20000, SMB_WALK_DEPTH = 12, SMB_WALK_MS = 90000, SMB_SUB_MAX = 5 * 1048576;
var SMB2 = { NEGOTIATE: 0, SESSION_SETUP: 1, TREE_CONNECT: 3, CREATE: 5, CLOSE: 6, READ: 8, IOCTL: 0x0B, QUERY_DIRECTORY: 0x0E };
var SMB_ST = { SUCCESS: 0, MORE_PROCESSING: 0xC0000016, NO_MORE_FILES: 0x80000006, END_OF_FILE: 0xC0000011, BUFFER_OVERFLOW: 0x80000005, PENDING: 0x00000103 };
// The statuses a person can do something about: [why (the app's wording), what it means].
var SMB_STATUS = {
    0xc0000022: ['auth', 'this account isn\'t allowed in here'], 0xc0000064: ['auth', 'no such user on the server'], 0xc000006a: ['auth', 'wrong password'],
    0xc000006d: ['auth', 'wrong user name or password'], 0xc000006f: ['auth', 'this account may not sign in at this hour'], 0xc0000070: ['auth', 'the server refuses sign-ins from this device'],
    0xc0000071: ['auth', 'that password has expired'], 0xc0000072: ['auth', 'that account is disabled'], 0xc000015b: ['auth', 'this account may not sign in over the network'],
    0xc0000234: ['auth', 'that account is locked out'], 0xc00000bb: ['smb3', 'the server refused (it may want SMB 3, or NTLM is off)'],
    0xc00000cc: ['missing', 'no share with that name on the server'], 0xc0000034: ['missing', 'no such file or folder'], 0xc000003a: ['missing', 'no such folder'],
    0xc0000043: ['other', 'the file is in use by another program'], 0xc0000203: ['other', 'the server ended the session']
};
function smbErr(status, what) {
    var e = SMB_STATUS[status >>> 0], hex = '0x' + ((status >>> 0).toString(16));
    var err = new Error((what ? what + ': ' : '') + (e ? e[1] : status === -1 ? 'the connection dropped' : 'status ' + hex));
    err.why = e ? e[0] : status === -1 ? 'unreachable' : 'other';
    err.status = e && e[0] === 'missing' ? 404 : 502;
    return err;
}
// Strings and numbers as SMB has them (by hand: the 2017 TV's Buffer lacks some encodings).
function smbU16(str) { str = String(str == null ? '' : str); var b = allocBuffer(str.length * 2); for (var i = 0; i < str.length; i++) { b.writeUInt16LE(str.charCodeAt(i) & 0xFFFF, i * 2); } return b; }
function smbFromU16(buf, start, end) { var s = ''; end = Math.min(end, buf.length); for (var i = start; i + 1 < end; i += 2) { s += String.fromCharCode(buf.readUInt16LE(i)); } return s; }
function smbAscii(str) { var b = allocBuffer(str.length); for (var i = 0; i < str.length; i++) { b[i] = str.charCodeAt(i) & 0xFF; } return b; }
function smbBytes(arr) { var b = allocBuffer(arr.length); for (var i = 0; i < arr.length; i++) { b[i] = arr[i] & 0xFF; } return b; }
function smbW64(b, off, n) { b.writeUInt32LE(n % 4294967296 >>> 0, off); b.writeUInt32LE(Math.floor(n / 4294967296) >>> 0, off + 4); }
function smbR64(b, off) { return b.readUInt32LE(off) + b.readUInt32LE(off + 4) * 4294967296; }
function smbFill(n, v) { var b = allocBuffer(n); b.fill(v || 0); return b; }
// MD4 (RFC 1320), for the NT hash: the TV's OpenSSL may not have it.
function md4(buf) {
    function rol(x, n) { return (x << n) | (x >>> (32 - n)); }
    function F(x, y, z) { return (x & y) | (~x & z); }
    function G(x, y, z) { return (x & y) | (x & z) | (y & z); }
    function Hh(x, y, z) { return x ^ y ^ z; }
    var len = buf.length, withPad = len + 1;
    while (withPad % 64 !== 56) { withPad++; }
    var m = smbFill(withPad + 8);
    buf.copy(m, 0); m[len] = 0x80;
    m.writeUInt32LE((len * 8) >>> 0, withPad); m.writeUInt32LE(Math.floor(len * 8 / 4294967296) >>> 0, withPad + 4);
    var a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, X = [], i, k, t;
    var R2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15], R3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    var S1 = [3, 7, 11, 19], S2 = [3, 5, 9, 13], S3 = [3, 9, 11, 15];
    for (var off = 0; off < m.length; off += 64) {
        for (i = 0; i < 16; i++) { X[i] = m.readUInt32LE(off + i * 4); }
        var aa = a, bb = b, cc = c, dd = d;
        for (i = 0; i < 48; i++) {
            var r = i >> 4, j = i & 15, f, s;
            if (r === 0) { k = j; s = S1[j & 3]; } else if (r === 1) { k = R2[j]; s = S2[j & 3]; } else { k = R3[j]; s = S3[j & 3]; }
            var add = r === 0 ? 0 : r === 1 ? 0x5a827999 : 0x6ed9eba1;
            var w = j & 3;
            var x0 = w === 0 ? a : w === 1 ? d : w === 2 ? c : b, x1 = w === 0 ? b : w === 1 ? a : w === 2 ? d : c, x2 = w === 0 ? c : w === 1 ? b : w === 2 ? a : d, x3 = w === 0 ? d : w === 1 ? c : w === 2 ? b : a;
            f = r === 0 ? F(x1, x2, x3) : r === 1 ? G(x1, x2, x3) : Hh(x1, x2, x3);
            t = rol((x0 + f + X[k] + add) | 0, s);
            if (w === 0) { a = t; } else if (w === 1) { d = t; } else if (w === 2) { c = t; } else { b = t; }
        }
        a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
    }
    var out = allocBuffer(16);
    out.writeUInt32LE(a >>> 0, 0); out.writeUInt32LE(b >>> 0, 4); out.writeUInt32LE(c >>> 0, 8); out.writeUInt32LE(d >>> 0, 12);
    return out;
}
function hmacMd5(key, data) { return crypto.createHmac('md5', key).update(data).digest(); }
var NTLM_FLAGS = (0x00000001 | 0x00000004 | 0x00000010 | 0x00000200 | 0x00008000 | 0x00080000 | 0x20000000 | 0x80000000) >>> 0, NTLM_ANON = 0x00000800;
function ntlmNegotiate() { var b = smbFill(32); smbAscii('NTLMSSP\0').copy(b, 0); b.writeUInt32LE(1, 8); b.writeUInt32LE(NTLM_FLAGS, 12); return b; }
function ntlmAvPair(ti, id) {   // an AV pair's value in target info, or null
    for (var p = 0; p + 4 <= ti.length;) {
        var aid = ti.readUInt16LE(p), alen = ti.readUInt16LE(p + 2);
        if (aid === 0 || p + 4 + alen > ti.length) { return null; }
        if (aid === id) { return ti.slice(p + 4, p + 4 + alen); }
        p += 4 + alen;
    }
    return null;
}
function ntlmWithMicFlag(ti) {   // MsvAvFlags with "MIC present" (0x2), added before MsvAvEOL if missing
    var p = 0, eol = ti.length;
    while (p + 4 <= ti.length) {
        var id = ti.readUInt16LE(p), len = ti.readUInt16LE(p + 2);
        if (id === 0 || p + 4 + len > ti.length) { eol = p; break; }
        if (id === 6 && len === 4) { var out = smbFill(ti.length); ti.copy(out); out.writeUInt32LE((out.readUInt32LE(p + 4) | 2) >>> 0, p + 4); return out; }
        p += 4 + len;
    }
    var pair = smbFill(8); pair.writeUInt16LE(6, 0); pair.writeUInt16LE(4, 2); pair.writeUInt32LE(2, 4);
    return Buffer.concat([ti.slice(0, eol), pair, smbFill(4)]);
}
function ntlmField(len, off) { var f = smbFill(8); f.writeUInt16LE(len, 0); f.writeUInt16LE(len, 2); f.writeUInt32LE(off, 4); return f; }
function ntlmAuthenticate(challenge, user, pass, domain) {
    if (challenge.length < 48 || smbAscii('NTLMSSP\0').toString('hex') !== challenge.slice(0, 8).toString('hex') || challenge.readUInt32LE(8) !== 2) { throw new Error('not an NTLM challenge'); }
    var serverChallenge = challenge.slice(24, 32), tiLen = challenge.readUInt16LE(40), tiOff = challenge.readUInt32LE(44);
    if (tiOff + tiLen > challenge.length) { throw new Error('a broken NTLM challenge'); }
    var ti = challenge.slice(tiOff, tiOff + tiLen), ts = ntlmAvPair(ti, 7), haveTs = !!(ts && ts.length === 8);
    var key = hmacMd5(md4(smbU16(pass)), smbU16(String(user).toUpperCase() + domain)), cc = crypto.randomBytes(8);
    var blob = Buffer.concat([smbBytes([1, 1, 0, 0, 0, 0, 0, 0]), haveTs ? ts : smbFill(8), cc, smbFill(4), haveTs ? ntlmWithMicFlag(ti) : ti, smbFill(4)]);
    var proof = hmacMd5(key, Buffer.concat([serverChallenge, blob])), nt = Buffer.concat([proof, blob]);
    var lm = haveTs ? smbFill(24) : Buffer.concat([hmacMd5(key, Buffer.concat([serverChallenge, cc])), cc]);
    var sessionKey = hmacMd5(key, proof), dom = smbU16(domain), usr = smbU16(user), ws = smbU16('STREMIOK');
    var fixed = 88, cur = fixed, lmOff = cur; cur += lm.length;
    var ntOff = cur; cur += nt.length; var domOff = cur; cur += dom.length; var userOff = cur; cur += usr.length; var wsOff = cur; cur += ws.length;
    var hdr = smbFill(fixed);
    smbAscii('NTLMSSP\0').copy(hdr, 0); hdr.writeUInt32LE(3, 8);
    ntlmField(lm.length, lmOff).copy(hdr, 12); ntlmField(nt.length, ntOff).copy(hdr, 20); ntlmField(dom.length, domOff).copy(hdr, 28);
    ntlmField(usr.length, userOff).copy(hdr, 36); ntlmField(ws.length, wsOff).copy(hdr, 44); ntlmField(0, cur).copy(hdr, 52);
    hdr.writeUInt32LE(NTLM_FLAGS, 60);
    var token = Buffer.concat([hdr, lm, nt, dom, usr, ws]);
    if (haveTs) { hmacMd5(sessionKey, Buffer.concat([ntlmNegotiate(), challenge, token])).copy(token, 72); }   // (the MIC: over all three messages)
    return { token: token, sessionKey: sessionKey };
}
function ntlmAnonymous() {
    var ws = smbU16('STREMIOK'), fixed = 72, hdr = smbFill(fixed);
    smbAscii('NTLMSSP\0').copy(hdr, 0); hdr.writeUInt32LE(3, 8);
    ntlmField(1, fixed).copy(hdr, 12); ntlmField(0, fixed + 1).copy(hdr, 20); ntlmField(0, fixed + 1).copy(hdr, 28); ntlmField(0, fixed + 1).copy(hdr, 36);
    ntlmField(ws.length, fixed + 1).copy(hdr, 44); ntlmField(0, fixed + 1 + ws.length).copy(hdr, 52);
    hdr.writeUInt32LE((NTLM_FLAGS | NTLM_ANON) >>> 0, 60);
    return Buffer.concat([hdr, smbBytes([0]), ws]);
}
// One connection to one share (or IPC$, for the share list): requests matched to answers by their
// message id, several at once (the player reads ahead).
function SmbConn(o) {
    this.host = o.host; this.port = o.port || SMB_PORT; this.share = o.share; this.user = o.user || ''; this.pass = o.pass || ''; this.domain = o.domain || '';
    this.guest = !this.user;
    this.sock = null; this.rx = []; this.rxLen = 0; this.msgId = 0; this.sessionId = smbFill(8); this.treeId = 0;
    this.signKey = null; this.signing = false; this.pending = {}; this.dead = false; this.maxRead = 65536; this.last = Date.now(); this.users = 0;
}
SmbConn.prototype._take = function (chunk) {
    this.rx.push(chunk); this.rxLen += chunk.length;
    while (this.rxLen >= 4) {
        var head = this.rx.length === 1 ? this.rx[0] : Buffer.concat(this.rx, this.rxLen);
        this.rx = [head];
        var len = (head[1] << 16) | (head[2] << 8) | head[3];
        if (head[0] !== 0 || len > SMB_MSG_MAX) { this._die('a message that isn\'t SMB, or too large'); return; }
        if (head.length < 4 + len) { return; }
        var msg = head.slice(4, 4 + len), rest = head.slice(4 + len);
        this.rx = rest.length ? [rest] : []; this.rxLen = rest.length;
        this._dispatch(msg);
        if (this.dead) { return; }
    }
};
SmbConn.prototype._dispatch = function (msg) {
    if (msg.length < 64 || msg.readUInt32BE(0) !== 0xFE534D42) { return; }   // (SMB 2 only)
    var status = msg.readUInt32LE(8) >>> 0, mid = smbR64(msg, 24);
    if (status === SMB_ST.PENDING) { return; }   // (the answer follows)
    var p = this.pending[mid];
    if (!p) { return; }
    delete this.pending[mid];
    clearTimeout(p.timer);
    try { p.cb(status, msg.slice(0, 64), msg.slice(64)); } catch (e) { try { p.cb(-2, null, null); } catch (e2) {} }   // (an answer too short for what it says: as an error)
};
SmbConn.prototype._die = function (why) {
    if (this.dead) { return; }
    this.dead = true;
    var p = this.pending; this.pending = {};
    Object.keys(p).forEach(function (k) { clearTimeout(p[k].timer); try { p[k].cb(-1, null, null); } catch (e) {} });
    try { if (this.sock) { this.sock.destroy(); } } catch (e) {}
    this.why = why;
};
SmbConn.prototype._send = function (command, body, charge, cb) {
    var self = this;
    if (this.dead) { cb(-1, null, null); return; }
    charge = charge || 1;
    var h = smbFill(64), id = this.msgId;
    this.msgId += charge;   // (a request of several credits uses as many message ids)
    h.writeUInt32BE(0xFE534D42, 0); h.writeUInt16LE(64, 4); h.writeUInt16LE(charge, 6); h.writeUInt16LE(command, 12); h.writeUInt16LE(64, 14);
    smbW64(h, 24, id); h.writeUInt32LE(this.treeId >>> 0, 36); this.sessionId.copy(h, 40);
    if (this.signing && this.signKey && command !== SMB2.SESSION_SETUP) {
        h.writeUInt32LE(0x00000008, 16);
        crypto.createHmac('sha256', this.signKey).update(Buffer.concat([h, body])).digest().slice(0, 16).copy(h, 48);
    }
    var packet = Buffer.concat([h, body]), pfx = smbBytes([0, (packet.length >> 16) & 0xFF, (packet.length >> 8) & 0xFF, packet.length & 0xFF]);
    this.pending[id] = { cb: cb, timer: setTimeout(function () { if (self.pending[id]) { delete self.pending[id]; cb(-1, null, null); self._die('no answer in ' + (SMB_REQ_MS / 1000) + ' s'); } }, SMB_REQ_MS) };
    this.last = Date.now();
    try { this.sock.write(Buffer.concat([pfx, packet])); } catch (e) { this._die('write: ' + e.message); }
};
SmbConn.prototype.connect = function (done) {
    var self = this, finished = false;
    function finish(err) { if (finished) { return; } finished = true; clearTimeout(timer); if (err) { self._die(err.message); } done(err || null); }
    var timer = setTimeout(function () { var e = new Error('couldn\'t reach ' + self.host + ' (port ' + self.port + ')'); e.why = 'unreachable'; finish(e); }, SMB_CONNECT_MS);
    try { this.sock = net.connect(this.port, this.host); } catch (e) { var e0 = new Error('couldn\'t reach it: ' + e.message); e0.why = 'unreachable'; finish(e0); return; }
    this.sock.on('connect', function () {
        if (isSelfAddr(self.sock.remoteAddress)) { var es = new Error('not this TV'); es.why = 'unreachable'; finish(es); return; }
        self._negotiate(function (e1) {
            if (e1) { finish(e1); return; }
            self._session(function (e2) { if (e2) { finish(e2); return; } self._tree(finish); });
        });
    });
    this.sock.on('data', function (c) { self._take(c); });
    this.sock.on('error', function (e) { var er = new Error('couldn\'t reach it: ' + (e.code || e.message)); er.why = 'unreachable'; self._die(er.message); finish(er); });
    this.sock.on('close', function () { self._die('closed'); var ec = new Error('the server closed the connection'); ec.why = 'unreachable'; finish(ec); });
    try { this.sock.setNoDelay(true); } catch (e) {}
};
SmbConn.prototype._negotiate = function (cb) {
    var self = this, body = smbFill(40);
    body.writeUInt16LE(36, 0); body.writeUInt16LE(2, 2); body.writeUInt16LE(1, 4); body.writeUInt32LE(4, 8);   // (2 dialects, signing on, large reads)
    crypto.randomBytes(16).copy(body, 12);
    body.writeUInt16LE(0x0202, 36); body.writeUInt16LE(0x0210, 38);
    this._send(SMB2.NEGOTIATE, body, 1, function (st, hdr, r) {
        if (st !== 0) { var e = st === -1 ? smbErr(-1) : new Error('it doesn\'t speak SMB 2 (only SMB 3, or SMB 1?)'); if (st !== -1) { e.why = 'smb3'; } cb(e); return; }
        if (r.length < 40) { cb(smbErr(-2, 'negotiate')); return; }
        self.dialect = r.readUInt16LE(4);
        if (self.dialect !== 0x0202 && self.dialect !== 0x0210) { var e2 = new Error('it doesn\'t speak SMB 2.0 or 2.1'); e2.why = 'smb3'; cb(e2); return; }
        self.signing = !!(r.readUInt16LE(2) & 2);
        self.maxRead = Math.max(65536, Math.min(r.readUInt32LE(32) || 65536, 8388608));
        cb(null);
    });
};
SmbConn.prototype._setup = function (token, cb) {
    var body = smbFill(24 + token.length);
    body.writeUInt16LE(25, 0); body.writeUInt8(this.signing ? 2 : 1, 3); body.writeUInt16LE(88, 12); body.writeUInt16LE(token.length, 14);
    token.copy(body, 24);
    this._send(SMB2.SESSION_SETUP, body, 1, cb);
};
SmbConn.prototype._session = function (done) {
    var self = this;
    this._setup(ntlmNegotiate(), function (st, hdr, r) {
        if (st !== SMB_ST.MORE_PROCESSING) { done(smbErr(st, 'sign-in')); return; }
        hdr.copy(self.sessionId, 0, 40, 48);
        var off = r.readUInt16LE(4) - 64, len = r.readUInt16LE(6);
        if (off < 0 || off + len > r.length) { done(smbErr(-2, 'sign-in')); return; }
        var t3;
        try {
            if (self.guest) { self.signing = false; t3 = { token: ntlmAnonymous() }; }
            else { t3 = ntlmAuthenticate(r.slice(off, off + len), self.user, self.pass, self.domain); self.signKey = t3.sessionKey; }
        } catch (e) { var er = new Error('sign-in: ' + e.message); er.why = 'other'; done(er); return; }
        self._setup(t3.token, function (st2, hdr2, r2) {
            if (st2 !== 0) { done(smbErr(st2, 'sign-in')); return; }
            var flags = r2.length >= 4 ? r2.readUInt16LE(2) : 0;
            if (!self.guest && !(flags & 3) && self.signKey) { self.signing = true; }   // (SMB 2.1 on a real session: signed, as Samba expects)
            if (flags & 3) { self.signing = false; }   // (a guest or null session: no key to sign with)
            done(null);
        });
    });
};
SmbConn.prototype._tree = function (done) {
    var self = this, unc = smbU16('\\\\' + this.host + '\\' + this.share), body = smbFill(8 + unc.length);
    body.writeUInt16LE(9, 0); body.writeUInt16LE(72, 4); body.writeUInt16LE(unc.length, 6); unc.copy(body, 8);
    this._send(SMB2.TREE_CONNECT, body, 1, function (st, hdr) {
        if (st !== 0) { done(smbErr(st, 'the share “' + self.share + '”')); return; }
        self.treeId = hdr.readUInt32LE(36);
        done(null);
    });
};
function smbPath(p) { return String(p || '').replace(/^[\\/]+|[\\/]+$/g, '').replace(/\//g, '\\'); }
SmbConn.prototype.open = function (path, dir, cb, access) {
    var name = smbU16(smbPath(path)), body = smbFill(56 + Math.max(name.length, 1));
    body.writeUInt16LE(57, 0); body.writeUInt32LE(2, 4); body.writeUInt32LE(access || 0x00100081, 24); body.writeUInt32LE(7, 32); body.writeUInt32LE(1, 36);
    body.writeUInt32LE(dir ? 1 : 0x40, 40); body.writeUInt16LE(120, 44); body.writeUInt16LE(name.length, 46);
    name.copy(body, 56);
    this._send(SMB2.CREATE, body, 1, function (st, hdr, r) {
        if (st !== 0) { cb(smbErr(st)); return; }
        if (r.length < 80) { cb(smbErr(-2)); return; }
        cb(null, { id: r.slice(64, 80), size: smbR64(r, 48), dir: !!(r.readUInt32LE(56) & 0x10) });
    });
};
SmbConn.prototype.close = function (id) {
    var body = smbFill(24); body.writeUInt16LE(24, 0); id.copy(body, 8);
    this._send(SMB2.CLOSE, body, 1, function () {});
};
// A folder's entries: [{ name, dir, size }] (SMB_LIST_MAX at most, hidden "." and ".." left out).
SmbConn.prototype.list = function (path, done) {
    var self = this;
    done = once(done);
    this.open(path, true, function (err, d) {
        if (err) { done(err); return; }
        var out = [], pat = smbU16('*'), rounds = 0;
        (function round(first) {
            var body = smbFill(32 + pat.length);
            body.writeUInt16LE(33, 0); body.writeUInt8(1, 2); body.writeUInt8(first ? 1 : 0, 3); d.id.copy(body, 8);
            body.writeUInt16LE(96, 24); body.writeUInt16LE(pat.length, 26); body.writeUInt32LE(65536, 28); pat.copy(body, 32);
            self._send(SMB2.QUERY_DIRECTORY, body, 1, function (st, hdr, r) {
                if (st === SMB_ST.NO_MORE_FILES || out.length >= SMB_LIST_MAX || rounds++ > 200) { self.close(d.id); done(null, out); return; }
                if (st !== 0) { self.close(d.id); done(smbErr(st)); return; }
                var off = r.readUInt16LE(2) - 64, len = r.readUInt32LE(4);
                if (off < 0 || off + len > r.length) { self.close(d.id); done(smbErr(-2)); return; }
                var b = r.slice(off, off + len), p = 0;
                for (var n = 0; p + 64 <= b.length && n < 4096; n++) {
                    var next = b.readUInt32LE(p), nlen = b.readUInt32LE(p + 60), attrs = b.readUInt32LE(p + 56);
                    if (p + 64 + nlen > b.length) { break; }
                    var name = smbFromU16(b, p + 64, p + 64 + nlen), isDir = !!(attrs & 0x10);
                    if (name !== '.' && name !== '..' && name && name.length <= 255 && !/[\0\/\\]/.test(name) && out.length < SMB_LIST_MAX) { out.push({ name: name, dir: isDir, size: isDir ? 0 : smbR64(b, p + 40) }); }
                    if (!next) { break; }
                    p += next;
                }
                round(false);
            });
        })(true);
    });
};
SmbConn.prototype.read = function (id, offset, length, cb) {
    var body = smbFill(49);
    body.writeUInt16LE(49, 0); body.writeUInt32LE(length, 4); smbW64(body, 8, offset); id.copy(body, 16);
    this._send(SMB2.READ, body, Math.max(1, Math.ceil(length / 65536)), function (st, hdr, r) {
        if (st === SMB_ST.END_OF_FILE) { cb(null, allocBuffer(0)); return; }
        if (st !== 0 && st !== SMB_ST.BUFFER_OVERFLOW) { cb(smbErr(st)); return; }
        var off = r.readUInt8(2) - 64, len = r.readUInt32LE(4);
        if (off < 0 || off + len > r.length || len > length) { cb(smbErr(-2)); return; }
        cb(null, r.slice(off, off + len), st === SMB_ST.BUFFER_OVERFLOW);
    });
};
// The share list (connected to IPC$): NetrShareEnum (MS-SRVS) over the \srvsvc pipe, DCE/RPC by
// hand. Disk shares only; hidden and administrative ones (C$, ADMIN$, print$) left out.
function rpcSyntax(uuid, major) {
    var h = uuid.replace(/-/g, ''), b = smbFill(20);
    b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0); b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4); b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
    for (var i = 0; i < 8; i++) { b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16); }
    b.writeUInt16LE(major, 16);
    return b;
}
function rpcPdu(type, callId, body) { var h = smbFill(16); h[0] = 5; h[2] = type; h[3] = 3; h[4] = 0x10; h.writeUInt16LE(16 + body.length, 8); h.writeUInt32LE(callId, 12); return Buffer.concat([h, body]); }
function rpcU32s(list) { var b = smbFill(list.length * 4); list.forEach(function (v, i) { b.writeUInt32LE(v >>> 0, i * 4); }); return b; }
function ndrStr(str) { var ch = smbU16(str + '\0'), n = ch.length / 2, pad = (4 - ch.length % 4) % 4, b = smbFill(12 + ch.length + pad); b.writeUInt32LE(n, 0); b.writeUInt32LE(n, 8); ch.copy(b, 12); return b; }
SmbConn.prototype.pipe = function (id, input, cb) {   // FSCTL_PIPE_TRANSCEIVE, then reads until the reply's last fragment
    var self = this, body = smbFill(56 + input.length), got = [], total = 0;
    body.writeUInt16LE(57, 0); body.writeUInt32LE(0x0011C017, 4); id.copy(body, 8); body.writeUInt32LE(120, 24); body.writeUInt32LE(input.length, 28);
    body.writeUInt32LE(8560, 44); body.writeUInt32LE(1, 48); input.copy(body, 56);
    function more(buf, overflow) {
        got.push(buf); total += buf.length;
        var all = Buffer.concat(got, total), p = 0, last = false;
        while (all.length - p >= 16) { var len = all.readUInt16LE(p + 8); if (len < 16 || all.length - p < len) { break; } if (all[p + 3] & 2) { last = true; } p += len; }
        if ((last && !overflow) || total > 1048576) { cb(null, all); return; }
        self.read(id, 0, 8560, function (e, chunk, ov) { if (e) { cb(e); return; } if (!chunk.length) { cb(null, all); return; } more(chunk, ov || chunk.length >= 8560); });
    }
    this._send(SMB2.IOCTL, body, 1, function (st, hdr, r) {
        if (st !== 0 && st !== SMB_ST.BUFFER_OVERFLOW) { cb(smbErr(st, 'the share list')); return; }
        var off = r.readUInt32LE(32) - 64, len = r.readUInt32LE(36);
        if (off < 0 || off + len > r.length) { cb(smbErr(-2, 'the share list')); return; }
        more(r.slice(off, off + len), st === SMB_ST.BUFFER_OVERFLOW);
    });
};
function rpcStub(all) {   // the reply PDUs' stub data, joined; throws on a fault or a broken one
    var out = [], p = 0;
    while (all.length - p >= 24) {
        var len = all.readUInt16LE(p + 8), auth = all.readUInt16LE(p + 10);
        if (len < 24 || all.length - p < len) { break; }
        if (all[p + 2] === 3) { throw new Error('the server refused the call'); }
        if (all[p + 2] !== 2 || 24 > len - auth) { throw new Error('an answer it didn\'t expect'); }
        out.push(all.slice(p + 24, p + len - auth));
        p += len;
    }
    return Buffer.concat(out);
}
function parseShares(stub) {
    var p = 0;
    function u32() { if (p + 4 > stub.length) { throw new Error('cut short'); } var v = stub.readUInt32LE(p); p += 4; return v; }
    function str() { var max = u32(); u32(); var n = u32(); if (n > max || n > 1024 || p + n * 2 > stub.length) { throw new Error('a broken name'); } var s = smbFromU16(stub, p, p + n * 2).replace(/\0+$/, ''); p += n * 2; p += (4 - p % 4) % 4; return s; }
    u32(); u32();
    if (!u32()) { return []; }
    var count = u32();
    if (!u32() || !count) { return []; }
    if (u32() !== count || count > 1000) { throw new Error('a broken share list'); }
    var rows = [], i;
    for (i = 0; i < count; i++) { rows.push({ np: u32(), type: u32(), rp: u32() }); }
    for (i = 0; i < count; i++) { rows[i].name = rows[i].np ? str() : ''; rows[i].remark = rows[i].rp ? str() : ''; }
    return rows.filter(function (r) { return (r.type & 0x0FFFFFFF) === 0 && !(r.type & 0x80000000) && r.name && !/\$$/.test(r.name); })
        .map(function (r) { return { name: r.name.slice(0, 80), remark: r.remark.slice(0, 120) }; })
        .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
}
SmbConn.prototype.shares = function (done) {
    var self = this;
    done = once(done);
    this.open('srvsvc', false, function (err, pipeId) {
        if (err) { done(err); return; }
        var id = pipeId.id;
        function fin(e, v) { self.close(id); done(e, v); }
        var bind = smbFill(56);
        bind.writeUInt16LE(4280, 0); bind.writeUInt16LE(4280, 2); bind[8] = 1; bind[14] = 1;
        rpcSyntax('4b324fc8-1670-01d3-1278-5a47bf6ee188', 3).copy(bind, 16); rpcSyntax('8a885d04-1ceb-11c9-9fe8-08002b104860', 2).copy(bind, 36);
        self.pipe(id, rpcPdu(11, 1, bind), function (e1, ack) {
            if (e1) { fin(e1); return; }
            if (ack.length < 16 || ack[2] !== 12) { var eb = new Error('the share list: the server refused'); eb.why = 'other'; fin(eb); return; }
            var stub = Buffer.concat([rpcU32s([0x00020000]), ndrStr('\\\\' + self.host), rpcU32s([1, 1, 0x00020004, 0, 0, 0xFFFFFFFF, 0x00020008, 0])]);
            var hdr = smbFill(8); hdr.writeUInt32LE(stub.length, 0); hdr.writeUInt16LE(15, 6);
            self.pipe(id, rpcPdu(0, 2, Buffer.concat([hdr, stub])), function (e2, reply) {
                if (e2) { fin(e2); return; }
                try {
                    var s = rpcStub(reply), werr = s.length >= 4 ? s.readUInt32LE(s.length - 4) : 0;
                    if (werr) { throw new Error('error 0x' + werr.toString(16)); }
                    fin(null, parseShares(s));
                } catch (e3) { var er = new Error('the share list: ' + e3.message); er.why = 'other'; fin(er); }
            });
        });
    }, 0x0012019F);
};
// A share's folder from the app: smb://host[:port]/share/[path/] (a host in the home network), the
// sign-in from X-Dav-Auth ("DOMAIN\user:password"; none: a guest), or null.
function smbFolder(req, q, noShare) {
    var u = String(q.u || '').trim(), m = /^smb:\/\/([A-Za-z0-9._-]{1,253}|\[[0-9a-fA-F:.]{2,45}\])(?::(\d{1,5}))?\/([^\/\\?#]{0,80})(\/[^?#]*)?$/.exec(u);
    if (!m || u.length > 1000) { return null; }
    var host = m[1].replace(/^\[|\]$/g, ''), port = m[2] ? +m[2] : SMB_PORT, share = m[3];
    if (!isLanName(host) || isSelfAddr(host) || !(port > 0 && port < 65536) || (!share && !noShare)) { return null; }
    if (share && (share === '.' || share === '..' || /[\0"*:<>|]/.test(share))) { return null; }
    var base = String(m[4] || '/').replace(/^\/+|\/+$/g, '');
    if (base && base.split('/').some(function (s) { return !s || s === '.' || s === '..'; })) { return null; }
    var a = String((req.headers && req.headers['x-dav-auth']) || '');
    if (a && !/^[A-Za-z0-9+\/=]{4,1400}$/.test(a)) { return null; }
    var up = a ? fromBase64(a).toString('utf8') : '', colon = up.indexOf(':'), user = colon === -1 ? up : up.slice(0, colon), pass = colon === -1 ? '' : up.slice(colon + 1), domain = '';
    var dm = /^([^\\\/]{1,64})[\\\/](.+)$/.exec(user);
    if (dm) { domain = dm[1]; user = dm[2]; }
    return { host: host, port: port, share: share, base: base, user: user, pass: pass, domain: domain, auth: a };
}
// A path under the folder (its base, then rel), checked as davUrl does; null: not one.
function smbRel(f, rel) {
    rel = String(rel == null ? '' : rel).replace(/^\/+|\/+$/g, '');
    if (rel.length > 1024 || rel.indexOf('\0') !== -1 || /\\/.test(rel)) { return null; }
    if (rel && rel.split('/').some(function (s) { return !s || s === '.' || s === '..'; })) { return null; }
    return [f.base, rel].filter(Boolean).join('/');
}
// Connections kept for reuse (by server, share and sign-in), SMB_CONN_MAX at most, closed unused.
var _smbConns = {};
function smbKey(f, share) { return f.host + '|' + f.port + '|' + share + '|' + crypto.createHash('sha256').update(f.domain + '\\' + f.user + ':' + f.pass).digest('hex'); }
function smbConn(f, share, cb) {
    cb = once(cb);
    var k = smbKey(f, share), c = _smbConns[k];
    if (c && !c.dead) { c.last = Date.now(); cb(null, c); return; }
    if (c && c.waiting) { c.waiting.push(cb); return; }
    var keys = Object.keys(_smbConns);
    if (keys.length >= SMB_CONN_MAX) { keys.sort(function (a, b) { return _smbConns[a].last - _smbConns[b].last; }); _smbConns[keys[0]]._die('too many open'); delete _smbConns[keys[0]]; }
    c = new SmbConn({ host: f.host, port: f.port, share: share, user: f.user, pass: f.pass, domain: f.domain });
    c.waiting = [cb];
    _smbConns[k] = c;
    c.connect(function (err) {
        var w = c.waiting; c.waiting = null;
        if (err) { if (_smbConns[k] === c) { delete _smbConns[k]; } }
        w.forEach(function (fn) { fn(err, err ? null : c); });
    });
}
setInterval(function () {
    var now = Date.now();
    Object.keys(_smbConns).forEach(function (k) { var c = _smbConns[k]; if (c.dead || (!c.waiting && now - c.last > SMB_IDLE_MS && !Object.keys(c.pending).length && !c.users)) { c._die('unused'); delete _smbConns[k]; } });
}, 30000);
function smbList(f, rel, cb) {
    cb = once(cb);
    var p = smbRel(f, rel);
    if (p === null) { cb(upError('not a path in the share', 400)); return; }
    smbConn(f, f.share, function (err, c) {
        if (err) { cb(err); return; }
        c.list(p, function (e, entries) { if (e) { cb(e); return; } cb(null, { entries: entries }); });
    });
}
function smbWalk(f, st, cb) {
    cb = once(cb);
    var files = [], queue = [{ rel: '', depth: 0 }], active = 0, dirs = 0, truncated = false, started = Date.now();
    function end() { if (!active && !queue.length) { cb(null, { files: files, dirs: dirs, truncated: truncated }); } }
    function pump() {
        while (!st.cancelled && active < 2 && queue.length) {
            if (dirs >= SMB_WALK_DIRS || files.length >= SMB_WALK_FILES || Date.now() - started > SMB_WALK_MS) { truncated = true; queue = []; break; }
            var d = queue.shift();
            dirs++; active++;
            (function (d) {
                smbList(f, d.rel, function (err, r) {
                    active--;
                    if (st.cancelled) { return; }
                    if (err) { if (!d.rel) { st.cancelled = true; cb(err); return; } truncated = true; }
                    else {
                        var names = r.entries.map(function (e) { return e.name; });
                        r.entries.forEach(function (e) {
                            if (HIDDEN_NAME.test(e.name)) { return; }
                            var p = d.rel ? d.rel + '/' + e.name : e.name;
                            if (e.dir) { if (d.depth < SMB_WALK_DEPTH) { queue.push({ rel: p, depth: d.depth + 1 }); } else { truncated = true; } }
                            else if (walkWants(e.name, names) && files.length < SMB_WALK_FILES) { files.push({ p: p, size: e.size }); }
                        });
                    }
                    pump();
                });
            })(d);
        }
        end();
    }
    pump();
}
// readAt over a file of the share (mediaInfo, subtitles): its size from the open; done() closes it.
function smbOpenFile(f, rel, cb) {
    var p = smbRel(f, rel);
    if (p === null || !rel) { cb(upError('not a path in the share', 400)); return; }
    smbConn(f, f.share, function (err, c) {
        if (err) { cb(err); return; }
        c.open(p, false, function (e, h) {
            if (e) { cb(e); return; }
            c.users++;
            var closed = false;
            cb(null, function readAt(off, len, rcb) {
                var want = Math.max(0, Math.min(len, h.size - off)), parts = [], got = 0;
                (function next() {
                    if (got >= want) { rcb(null, Buffer.concat(parts, got), h.size); return; }
                    c.read(h.id, off + got, Math.min(SMB_READ, c.maxRead, want - got), function (re, data) {
                        if (re) { rcb(re); return; }
                        if (!data.length) { rcb(null, Buffer.concat(parts, got), h.size); return; }
                        parts.push(data); got += data.length; next();
                    });
                })();
            }, function done() { if (!closed) { closed = true; c.users--; c.close(h.id); } }, h.size);
        });
    });
}
function smbSub(f, rel, cb) {
    cb = once(cb);
    if (!SUB_EXT.test(String(rel))) { cb(upError('not a subtitle file in the share', 400)); return; }
    smbOpenFile(f, rel, function (err, readAt, done, size) {
        if (err) { cb(err); return; }
        if (size > SMB_SUB_MAX) { done(); cb(upError('too large for a subtitle file', 413)); return; }
        readAt(0, size, function (e, buf) { done(); if (e) { cb(e); return; } cb(null, decodeText(buf)); });
    });
}
// A file of the share for the player: its byte range (Range) read and sent on, the server's
// largest read at a time, as fast as the player takes it.
function smbFileRelay(f, rel, req, res) {
    var gone = false;
    res.on('close', function () { gone = true; });
    smbOpenFile(f, rel, function (err, readAt, done, size) {
        if (err) { if (!gone) { send(res, err.status === 400 || err.status === 404 ? err.status : 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); } return; }
        if (gone) { done(); return; }
        var start = 0, end = size - 1, partial = false, m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
        if (m && (m[1] !== '' || m[2] !== '')) {
            partial = true;
            if (m[1] === '') { start = Math.max(0, size - (+m[2])); } else { start = +m[1]; if (m[2] !== '') { end = Math.min(+m[2], size - 1); } }
        }
        if (start > end || start >= size) { done(); res.writeHead(416, { 'Content-Range': 'bytes */' + size, 'Cache-Control': 'no-store' }); res.end(); return; }
        var h = { 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (partial) { h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size; }
        res.writeHead(partial ? 206 : 200, h);
        var pos = start;
        (function pump() {
            if (gone || pos > end) { done(); if (!gone) { try { res.end(); } catch (e) {} } return; }
            readAt(pos, Math.min(SMB_READ, end - pos + 1), function (re, data) {
                if (gone) { done(); return; }
                if (re || !data.length) { done(); try { res.destroy(); } catch (e) {} return; }   // (cut short: the connection dropped, so the player knows; ended, it would wait for the rest)
                pos += data.length;
                if (res.write(data)) { pump(); } else { res.once('drain', pump); }
            });
        })();
    });
}
function smbProblem(err) { return { why: err.why || 'other', message: String(err.message || 'unknown').slice(0, 300) }; }
function smbControl(req, res, path, query, leaving) {
    if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
    var q = davQ(query), f = smbFolder(req, q, path === '/smb/shares');
    if (!f) { send(res, 400, 'text/plain', 'not a share in the home network'); return; }
    function answer(err, r) {
        if (!err) { send(res, 200, 'application/json', JSON.stringify(r)); return; }
        if (err.status === 400) { send(res, 400, 'text/plain', err.message); return; }
        send(res, 200, 'application/json', JSON.stringify(smbProblem(err)));
    }
    if (path === '/smb/shares') {
        var c = new SmbConn({ host: f.host, port: f.port, share: 'IPC$', user: f.user, pass: f.pass, domain: f.domain });
        leaving.push(function () { c._die('left'); });
        c.connect(function (err) {
            if (err) { answer(err); return; }
            c.shares(function (e, shares) { c._die('done'); if (e) { answer(e); return; } answer(null, { shares: shares }); });
        });
        return;
    }
    if (path === '/smb/list') { smbList(f, q.p, answer); return; }
    if (path === '/smb/walk') {
        var st = { cancelled: false };
        leaving.push(function () { st.cancelled = true; });
        smbWalk(f, st, answer);
        return;
    }
    if (path === '/smb/sub') {
        smbSub(f, q.p, function (err, text) {
            if (err) { send(res, err.status === 400 ? 400 : err.status === 413 ? 413 : 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            send(res, 200, 'text/plain; charset=utf-8', text);
        });
        return;
    }
    if (path === '/smb/mi') {
        if (!VIDEO_EXT.test(String(q.p || ''))) { send(res, 400, 'text/plain', 'not a video in the share'); return; }
        smbOpenFile(f, q.p, function (err, readAt, done) {
            if (err) { send(res, 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            var stop = mediaInfo(readAt, function (e, r) {
                done();
                if (e) { send(res, e.status && e.status < 600 ? e.status : 502, 'text/plain', 'failed: ' + (e.message || 'unknown')); return; }
                send(res, 200, 'application/json', JSON.stringify(r));
            });
            if (stop) { leaving.push(stop); }
        });
        return;
    }
    if (path === '/smb/open') { send(res, 200, 'application/json', JSON.stringify({ ticket: netTicket('smb', f) })); return; }
    send(res, 404, 'text/plain', 'not found');
}

// ---- DLNA media servers: /dlna/discover, /dlna/list, /dlna/walk, /dlna/sub, /dlna/mi, /dlna/open ----
// A NAS's or a computer's media server (miniDLNA, Serviio, Windows' media sharing, a router's) as
// a network folder: found on the home network when asked (SSDP: multicast and broadcast, for
// DLNA_SEARCH_MS), listed to add (none added on its own), its folders browsed (ContentDirectory
// Browse over SOAP), its videos played from its own links. A server knows its folders by id, not by
// path: their names are kept here per server (DLNA_SERVERS of them, DLNA_ITEMS names each, in
// memory), so a path in it ("Films/Dune.mkv") finds its id again; a video's title without an
// extension gets one from its type (the name matching needs one). Only servers in the home network;
// no sign-in (DLNA has none). Adapted from Tessel's (MIT License, Copyright (c) 2026 Patrick:
// github.com/PatrickSt1991/tessel-tizen-tv, tizen-app/service/service.js).
var DLNA_SEARCH_MS = 3000, DLNA_HTTP_MS = 8000, DLNA_MAX_BYTES = 8 * 1048576, DLNA_PAGE = 200, DLNA_ENTRIES = 3000, DLNA_SERVERS = 8, DLNA_ITEMS = 40000, DLNA_FOUND_MAX = 32;
var DLNA_WALK_DIRS = 2000, DLNA_WALK_FILES = 20000, DLNA_WALK_DEPTH = 12, DLNA_WALK_MS = 90000;
var DLNA_MIME_EXT = { 'video/x-matroska': 'mkv', 'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/x-msvideo': 'avi', 'video/avi': 'avi', 'video/mpeg': 'mpg', 'video/mp2t': 'ts', 'video/vnd.dlna.mpeg-tts': 'ts',
    'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-ms-wmv': 'wmv', 'video/x-flv': 'flv', 'video/3gpp': '3gp', 'video/ogg': 'ogv' };
function dlnaTag(xml, name) {   // the first <name> (any prefix): its text, unescaped
    var m = new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '\\s*>', 'i').exec(xml || '');
    return m ? xmlText(m[1]).trim() : '';
}
function dlnaEach(xml, name, max) {   // every <name …>…</name> or <name …/>: [{ attrs, body }]
    var out = [], m, re = new RegExp('<(?:[\\w.-]+:)?' + name + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '\\s*>)', 'gi');
    while ((m = re.exec(xml || '')) && out.length < (max || 10000)) { out.push({ attrs: m[1] || '', body: m[2] || '' }); }
    return out;
}
function dlnaAttr(attrs, name) {
    var m = new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\]\\:\/-]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(attrs || '');
    return m ? xmlText(m[1] !== undefined ? m[1] : m[2]) : '';
}
// A link the server may give: http(s), in the home network, not the TV itself.
function dlnaLanUrl(u) {
    var pu;
    try { pu = urllib.parse(String(u || '')); } catch (e) { return null; }
    if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !pu.hostname || !isLanName(pu.hostname) || isSelfAddr(pu.hostname)) { return null; }
    return pu;
}
// One request to a server (description, Browse): cb(err, status, text), DLNA_MAX_BYTES, DLNA_HTTP_MS.
function dlnaHttp(target, method, headers, body, cb) {
    cb = once(cb);
    var pu = dlnaLanUrl(target), r = null;
    if (!pu) { cb(upError('not a server in the home network', 400)); return noop; }
    var timer = setTimeout(function () { try { if (r) { r.abort(); } } catch (e) {} cb(upError('no answer in ' + (DLNA_HTTP_MS / 1000) + ' s', 504)); }, DLNA_HTTP_MS);
    try {
        var data = body ? toBuffer(body) : null, h = { 'User-Agent': 'StremioK' };
        Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
        if (data) { h['Content-Length'] = data.length; }
        r = (pu.protocol === 'https:' ? https : http).request({ hostname: pu.hostname, port: pu.port, path: pu.path, method: method, headers: h, agent: false }, function (resp) {
            var chunks = [], size = 0;
            resp.on('data', function (c) { size += c.length; if (size > DLNA_MAX_BYTES) { clearTimeout(timer); try { r.abort(); } catch (e) {} cb(upError('its answer is too large', 502)); return; } chunks.push(c); });
            resp.on('end', function () { clearTimeout(timer); cb(null, resp.statusCode, Buffer.concat(chunks, size).toString('utf8')); });
            resp.on('error', function (e) { clearTimeout(timer); cb(e); });
        });
        guardSelf(r, function () { clearTimeout(timer); cb(upError('not a server in the home network', 400)); });
        r.on('error', function (e) { clearTimeout(timer); cb(e); });
        if (data) { r.write(data); }
        r.end();
    } catch (e) { clearTimeout(timer); cb(e); }
    return function () { clearTimeout(timer); try { if (r) { r.abort(); } } catch (e) {} };
}
// A device description: { id, name, control } of its ContentDirectory, or null (not a media server).
function dlnaDescription(xml, location) {
    var services = dlnaEach(xml, 'service', 50), control = '';
    for (var i = 0; i < services.length && !control; i++) { if (/:ContentDirectory:/i.test(dlnaTag(services[i].body, 'serviceType'))) { control = dlnaTag(services[i].body, 'controlURL'); } }
    if (!control) { return null; }
    var abs;
    try { abs = urllib.resolve(dlnaTag(xml, 'URLBase') || location, control); } catch (e) { return null; }
    var pu = dlnaLanUrl(abs);
    if (!pu) { return null; }
    return { id: (dlnaTag(xml, 'UDN') || location).slice(0, 120), name: (dlnaTag(xml, 'friendlyName') || pu.hostname).slice(0, 80), control: abs };
}
function dlnaBrowseBody(id, start) {
    return '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
        '<s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>' + String(id).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
        '</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>' + start + '</StartingIndex><RequestedCount>' + DLNA_PAGE +
        '</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>';
}
// A Browse page's DIDL-Lite: folders, and videos with their link, size and subtitle files.
function dlnaDidl(didl) {
    var out = [];
    dlnaEach(didl, 'container', DLNA_ENTRIES).forEach(function (c) { out.push({ id: dlnaAttr(c.attrs, 'id'), title: dlnaTag(c.body, 'title'), dir: true }); });
    dlnaEach(didl, 'item', DLNA_ENTRIES).forEach(function (it) {
        if (!/videoItem/i.test(dlnaTag(it.body, 'class'))) { return; }   // (videos only: Local plays nothing else)
        var res = dlnaEach(it.body, 'res', 20), pick = null, subs = [];
        res.forEach(function (r) {
            var url = xmlText(r.body).trim(), mime = (String(dlnaAttr(r.attrs, 'protocolInfo')).split(':')[2] || '').toLowerCase();
            if (!/^https?:\/\//i.test(url)) { return; }
            if (/^text\/|subrip|x-ssa|x-ass|smi/.test(mime)) { subs.push(url); return; }
            if (!pick && /^http-get:/i.test(dlnaAttr(r.attrs, 'protocolInfo') || 'http-get:')) { pick = { url: url, mime: mime, size: +dlnaAttr(r.attrs, 'size') || 0 }; }
        });
        ['CaptionInfoEx', 'CaptionInfo'].forEach(function (t) { dlnaEach(it.body, t, 10).forEach(function (cp) { var u = xmlText(cp.body).trim(); if (/^https?:\/\//i.test(u)) { subs.push(u); } }); });
        if (pick) { out.push({ id: dlnaAttr(it.attrs, 'id'), title: dlnaTag(it.body, 'title'), dir: false, url: pick.url, mime: pick.mime, size: pick.size, subs: subs.slice(0, 8) }); }
    });
    return out;
}
// The servers' names kept here: per control URL, a path's id (folders) or its link (files).
var _dlna = {};
function dlnaServer(control) {
    var key = 'c:' + control, s = _dlna[key];   // (prefixed: no address can name an object's own properties)
    if (!s) {
        var keys = Object.keys(_dlna);
        if (keys.length >= DLNA_SERVERS) { keys.sort(function (a, b) { return _dlna[a].at - _dlna[b].at; }); delete _dlna[keys[0]]; }
        s = _dlna[key] = { dirs: { '': '0' }, files: {}, n: 0, at: Date.now() };
    }
    s.at = Date.now();
    return s;
}
function dlnaName(title) { return String(title || '?').replace(/[\/\\\0]/g, '-').replace(/^\.+/, '').trim().slice(0, 200) || '?'; }
function dlnaExt(e) {
    var path = '';
    try { path = String(urllib.parse(e.url).pathname || ''); } catch (x) {}
    var m = /\.([a-z0-9]{2,4})$/i.exec(path), ext = m && VIDEO_EXT.test('.' + m[1]) ? m[1].toLowerCase() : '';
    return ext || DLNA_MIME_EXT[e.mime] || 'mkv';
}
function dlnaSubExt(u) { var m = /\.(srt|vtt|ass|ssa|smi)(?:[?#]|$)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : 'srt'; }
// A folder's entries (its id), page by page, named and kept: cb(err, [{ name, dir, size }]).
function dlnaFolder(control, rel, id, cb) {
    cb = once(cb);
    var s = dlnaServer(control), raw = [];
    (function page(start) {
        dlnaHttp(control, 'POST', { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"' }, dlnaBrowseBody(id, start), function (err, status, xml) {
            if (err) { cb(err); return; }
            if (status !== 200) { var e = upError('the server refused (' + (dlnaTag(xml, 'errorDescription') || 'HTTP ' + status) + ')', 502); e.why = 'missing'; cb(e); return; }
            var got = dlnaDidl(dlnaTag(xml, 'Result')), returned = +dlnaTag(xml, 'NumberReturned') || 0, total = +dlnaTag(xml, 'TotalMatches') || 0;
            raw = raw.concat(got);
            if (returned > 0 && start + returned < total && raw.length < DLNA_ENTRIES) { page(start + returned); return; }
            var out = [], seen = {};
            function unique(n) { var base = n, i = 2, dot = n.lastIndexOf('.'); while (seen[n.toLowerCase()]) { n = dot > 0 ? base.slice(0, dot) + ' (' + (i++) + ')' + base.slice(dot) : base + ' (' + (i++) + ')'; } seen[n.toLowerCase()] = 1; return n; }
            raw.slice(0, DLNA_ENTRIES).forEach(function (e) {
                var name = dlnaName(e.title), p;
                if (e.dir) { name = unique(name); p = rel ? rel + '/' + name : name; if (s.n < DLNA_ITEMS) { s.dirs[p] = e.id; s.n++; } out.push({ name: name, dir: true, size: 0 }); return; }
                if (!VIDEO_EXT.test(name)) { name += '.' + dlnaExt(e); }
                name = unique(name);
                p = rel ? rel + '/' + name : name;
                if (s.n < DLNA_ITEMS) { s.files[p] = e.url; s.n++; }
                out.push({ name: name, dir: false, size: e.size });
                e.subs.forEach(function (su, k) {   // (its subtitle files, as files beside it: Film.srt, Film.2.srt…)
                    var sn = unique(name.replace(/\.[^.]+$/, '') + (k ? '.' + (k + 1) : '') + '.' + dlnaSubExt(su)), sp = rel ? rel + '/' + sn : sn;
                    if (s.n < DLNA_ITEMS) { s.files[sp] = su; s.n++; }
                    out.push({ name: sn, dir: false, size: 0 });
                });
            });
            cb(null, out);
        });
    })(0);
}
// A path's folder id, its parents browsed for their names when not known yet: cb(err, id).
function dlnaDirId(control, rel, cb) {
    var s = dlnaServer(control);
    if (Object.prototype.hasOwnProperty.call(s.dirs, rel)) { cb(null, s.dirs[rel]); return; }
    var segs = rel.split('/'), parent = segs.slice(0, -1).join('/');
    dlnaDirId(control, parent, function (err, pid) {
        if (err) { cb(err); return; }
        dlnaFolder(control, parent, pid, function (e2) {
            if (e2) { cb(e2); return; }
            if (Object.prototype.hasOwnProperty.call(s.dirs, rel)) { cb(null, s.dirs[rel]); return; }
            var e = upError('no such folder there', 404); e.why = 'missing'; cb(e);
        });
    });
}
// A file's link (video or subtitle file), its folder browsed when not known yet.
function dlnaFileUrl(control, rel, cb) {
    var s = dlnaServer(control);
    if (Object.prototype.hasOwnProperty.call(s.files, rel)) { cb(null, s.files[rel]); return; }
    var parent = rel.split('/').slice(0, -1).join('/');
    dlnaDirId(control, parent, function (err, pid) {
        if (err) { cb(err); return; }
        dlnaFolder(control, parent, pid, function (e2) {
            if (e2) { cb(e2); return; }
            if (Object.prototype.hasOwnProperty.call(s.files, rel)) { cb(null, s.files[rel]); return; }
            var e = upError('no such file there', 404); e.why = 'missing'; cb(e);
        });
    });
}
// A server from the app: its control URL (?u=dlna:<control>), in the home network, or null.
function dlnaOf(q) {
    var u = String(q.u || '');
    if (u.indexOf('dlna:') !== 0 || u.length > 1100) { return null; }
    var control = u.slice(5).replace(/\/+$/, '').replace(/#$/, '');
    return dlnaLanUrl(control) ? { control: control } : null;
}
function dlnaRel(rel) {
    rel = String(rel == null ? '' : rel).replace(/^\/+|\/+$/g, '');
    if (rel.length > 1024 || rel.indexOf('\0') !== -1 || (rel && rel.split('/').some(function (s) { return !s || s === '.' || s === '..'; }))) { return null; }
    return rel;
}
// The media servers on the home network, asked for now: cb([{ id, name, control }]).
function dlnaDiscover(cb) {
    cb = once(cb);
    var dgram = null, locations = [], sockets = [], done = false;
    try { dgram = require('dgram'); } catch (e) { cb([]); return; }
    var msgs = ['urn:schemas-upnp-org:device:MediaServer:1', 'urn:schemas-upnp-org:service:ContentDirectory:1'].map(function (st) {
        return toBuffer('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
    });
    var ifaces = [];
    try {
        var nets = require('os').networkInterfaces();
        Object.keys(nets).forEach(function (n) { (nets[n] || []).forEach(function (a) { if (a && (a.family === 'IPv4' || a.family === 4) && !a.internal && a.address) { ifaces.push(a); } }); });
    } catch (e) {}
    function bcast(a) {   // an interface's broadcast address
        var ip = a.address.split('.').map(Number), m = String(a.netmask || '255.255.255.0').split('.').map(Number);
        return ip.length === 4 && m.length === 4 ? ip.map(function (x, i) { return (x | (~m[i] & 255)) & 255; }).join('.') : '';
    }
    function onMsg(msg, rinfo) {
        var t = String(msg).split(/\r?\n/), h = {};
        if (!/^HTTP\/1\.[01] 200|^NOTIFY /i.test(t[0] || '')) { return; }
        t.slice(1).forEach(function (l) { var i = l.indexOf(':'); if (i > 0) { h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); } });
        if (h.location && dlnaLanUrl(h.location) && locations.indexOf(h.location) === -1 && locations.length < DLNA_FOUND_MAX && rinfo && isLanName(rinfo.address)) { locations.push(h.location); }
    }
    function open(a) {
        var sock;
        try { sock = dgram.createSocket('udp4'); } catch (e) { return; }
        sockets.push(sock);
        sock.on('message', onMsg);
        sock.on('error', function () { try { sock.close(); } catch (e) {} });
        function ask() {
            msgs.forEach(function (m) {
                var to = ['239.255.255.250'].concat(a ? [bcast(a), '255.255.255.255'].filter(Boolean) : []);
                to.forEach(function (addr) { try { sock.send(m, 0, m.length, 1900, addr, function () {}); } catch (e) {} });
            });
        }
        function ready() { if (a) { try { sock.setBroadcast(true); } catch (e) {} } ask(); setTimeout(function () { if (!done) { ask(); } }, 800); }   // (UDP gets lost: asked twice)
        try { if (a) { sock.bind(0, a.address, ready); } else { sock.bind(ready); } } catch (e) {}
    }
    open(null);
    ifaces.forEach(open);
    setTimeout(function () {
        done = true;
        sockets.forEach(function (s) { try { s.close(); } catch (e) {} });
        var found = [], left = locations.length;
        if (!left) { cb([]); return; }
        locations.forEach(function (loc) {
            dlnaHttp(loc, 'GET', null, null, function (err, status, xml) {
                var d = !err && status === 200 ? dlnaDescription(xml, loc) : null;
                if (d && !found.some(function (x) { return x.id === d.id; })) { found.push(d); }
                if (--left === 0) { cb(found.sort(function (x, y) { return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1; })); }
            });
        });
    }, DLNA_SEARCH_MS);
}
function dlnaWalk(control, st, cb) {
    cb = once(cb);
    var files = [], queue = [{ rel: '', depth: 0 }], active = 0, dirs = 0, truncated = false, started = Date.now();
    function end() { if (!active && !queue.length) { cb(null, { files: files, dirs: dirs, truncated: truncated }); } }
    function pump() {
        while (!st.cancelled && active < 2 && queue.length) {
            if (dirs >= DLNA_WALK_DIRS || files.length >= DLNA_WALK_FILES || Date.now() - started > DLNA_WALK_MS) { truncated = true; queue = []; break; }
            var d = queue.shift();
            dirs++; active++;
            (function (d) {
                dlnaDirId(control, d.rel, function (err, id) {
                    if (err) { active--; if (!d.rel) { st.cancelled = true; cb(err); return; } truncated = true; pump(); return; }
                    dlnaFolder(control, d.rel, id, function (e2, entries) {
                        active--;
                        if (st.cancelled) { return; }
                        if (e2) { if (!d.rel) { st.cancelled = true; cb(e2); return; } truncated = true; }
                        else {
                            entries.forEach(function (e) {
                                var p = d.rel ? d.rel + '/' + e.name : e.name;
                                if (e.dir) { if (d.depth < DLNA_WALK_DEPTH) { queue.push({ rel: p, depth: d.depth + 1 }); } else { truncated = true; } }
                                else if ((VIDEO_EXT.test(e.name) || SUB_EXT.test(e.name)) && files.length < DLNA_WALK_FILES) { files.push({ p: p, size: e.size || 0 }); }
                            });
                        }
                        pump();
                    });
                });
            })(d);
        }
        end();
    }
    pump();
}
// A server's file for the player: sent on to its own link (the same server's, in the home network).
function dlnaFileRedirect(f, rel, res) {
    dlnaFileUrl(f.control, rel, function (err, url) {
        if (err) { send(res, err.status || 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
        var to = dlnaLanUrl(url), from = dlnaLanUrl(f.control);
        if (!to || !from || to.hostname !== from.hostname) { send(res, 403, 'text/plain', 'a link off the server'); return; }
        res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
        res.end();
    });
}
function dlnaControl(req, res, path, query, leaving) {
    if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
    function answer(err, r) {
        if (!err) { send(res, 200, 'application/json', JSON.stringify(r)); return; }
        if (err.status === 400) { send(res, 400, 'text/plain', err.message); return; }
        send(res, 200, 'application/json', JSON.stringify({ why: err.why || (/no answer|ECONN|EHOST|ENET/.test(String(err.message || err.code)) ? 'unreachable' : 'other'), message: String(err.message || err.code || 'unknown').slice(0, 300) }));
    }
    if (path === '/dlna/discover') { dlnaDiscover(function (servers) { answer(null, { servers: servers }); }); return; }
    var q = davQ(query), f = dlnaOf(q), rel = dlnaRel(q.p);
    if (!f || rel === null) { send(res, 400, 'text/plain', 'not a media server in the home network'); return; }
    if (path === '/dlna/list') { dlnaDirId(f.control, rel, function (err, id) { if (err) { answer(err); return; } dlnaFolder(f.control, rel, id, function (e2, entries) { answer(e2, e2 ? null : { entries: entries }); }); }); return; }
    if (path === '/dlna/walk') { var st = { cancelled: false }; leaving.push(function () { st.cancelled = true; }); dlnaWalk(f.control, st, answer); return; }
    if (path === '/dlna/open') { send(res, 200, 'application/json', JSON.stringify({ ticket: netTicket('dlna', f) })); return; }
    if (path === '/dlna/sub' || path === '/dlna/mi') {
        var sub = path === '/dlna/sub';
        if (!(sub ? SUB_EXT : VIDEO_EXT).test(rel)) { send(res, 400, 'text/plain', 'not a ' + (sub ? 'subtitle file' : 'video') + ' on the server'); return; }
        dlnaFileUrl(f.control, rel, function (err, url) {
            if (err || !dlnaLanUrl(url)) { send(res, err && err.status === 404 ? 404 : 502, 'text/plain', 'failed: ' + ((err && err.message) || 'a link off the server')); return; }
            if (sub) {
                leaving.push(liveGet(url, { ua: 'StremioK' }, FS_SUB_MAX, function (e2, buf) {
                    if (e2) { send(res, 502, 'text/plain', 'failed: ' + (e2.message || 'unknown')); return; }
                    send(res, 200, 'text/plain; charset=utf-8', decodeText(buf));
                }));
                return;
            }
            var stops = [], stop = mediaInfo(miHttpReader(url, { ua: 'StremioK' }, true, stops), function (e3, r) {
                stops.forEach(function (x) { try { x(); } catch (e) {} });
                if (e3) { send(res, e3.status && e3.status < 600 ? e3.status : 502, 'text/plain', 'failed: ' + (e3.message || 'unknown')); return; }
                send(res, 200, 'application/json', JSON.stringify(r));
            });
            if (stop) { leaving.push(stop); }
        });
        return;
    }
    send(res, 404, 'text/plain', 'not found');
}

// ---- Network files for the player: /net/<ticket>/f?p=<path> ----
// The TV's player can't send a sign-in a header carries (or a Digest one at all), nor speak SMB:
// such a folder's file plays through the service. StremioK asks for a ticket (/dav/open, with the
// folder and its sign-in in headers as usual) and gives the player /net/<ticket>/f?p=…; the
// ticket, random and kept only in memory, stands for that folder and its sign-in, NET_TICKET_IDLE_MS
// unused at most, NET_TICKETS_MAX of them (the oldest dropped). Nothing else is reachable with
// it: a video file's path under that folder.
var NET_TICKETS_MAX = 16, NET_TICKET_IDLE_MS = 6 * 3600000, _netTickets = {};
function netTicket(kind, f) {
    var now = Date.now(), ids = Object.keys(_netTickets);
    ids.forEach(function (id) { if (now - _netTickets[id].last > NET_TICKET_IDLE_MS) { delete _netTickets[id]; } });
    ids = Object.keys(_netTickets);
    for (var i = 0; i < ids.length; i++) { var t = _netTickets[ids[i]]; if (t.kind === kind && t.key === netKey(kind, f)) { t.f = f; t.last = now; return ids[i].slice(2); } }   // (the same folder and sign-in: its ticket)
    if (ids.length >= NET_TICKETS_MAX) { ids.sort(function (a, b) { return _netTickets[a].last - _netTickets[b].last; }); delete _netTickets[ids[0]]; }
    var id = crypto.randomBytes(16).toString('hex');
    _netTickets['t:' + id] = { kind: kind, f: f, key: netKey(kind, f), last: now };   // (prefixed, as _dlna's)
    return id;
}
function netKey(kind, f) { return kind + '\n' + crypto.createHash('sha256').update(JSON.stringify([f.base || f.host || f.control || '', f.share || '', f.auth || f.user || '', f.pass || '', f.cert || ''])).digest('hex'); }
function netControl(req, res, path, query) {
    var m = /^\/net\/([0-9a-f]{32})\/f$/.exec(path), t = m && Object.prototype.hasOwnProperty.call(_netTickets, 't:' + m[1]) ? _netTickets['t:' + m[1]] : null;
    if (!t || Date.now() - t.last > NET_TICKET_IDLE_MS) { send(res, 404, 'text/plain', 'not found'); return; }
    t.last = Date.now();
    var q = davQ(query), rel = String(q.p || '');
    if (!VIDEO_EXT.test(rel)) { send(res, 400, 'text/plain', 'not a video in the folder'); return; }
    if (t.kind === 'dav') {
        var url = davUrl(t.f, rel);
        if (!url) { send(res, 400, 'text/plain', 'not a path in the folder'); return; }
        davFileRelay(t.f, url, req, res);
        return;
    }
    if (t.kind === 'smb') { smbFileRelay(t.f, rel, req, res); return; }
    if (t.kind === 'dlna') { var dr = dlnaRel(rel); if (dr === null) { send(res, 400, 'text/plain', 'not a path on the server'); return; } dlnaFileRedirect(t.f, dr, res); return; }
    send(res, 404, 'text/plain', 'not found');
}
// A file in a WebDAV folder, relayed to the player: its byte range asked for with the folder's
// sign-in (Basic or Digest), redirects on the same server only, its certificate as trusted.
var DAV_FILE_MS = 20000;
function davFileRelay(f, url, req, res) {
    var range = /^bytes=\d*-\d*$/.test(String(req.headers.range || '')) ? String(req.headers.range) : '';
    var r = null, gone = false, digested = false;
    function stop() { gone = true; clearTimeout(timer); try { if (r) { r.abort(); } } catch (e) {} }
    res.on('close', stop);
    function fail(code, why) { if (gone) { return; } if (!res.headersSent) { send(res, code, 'text/plain', 'failed: ' + why); } else { try { res.end(); } catch (e) {} } stop(); }
    var timer = setTimeout(function () { if (!res.headersSent) { fail(504, 'no answer in ' + (DAV_FILE_MS / 1000) + ' s'); } }, DAV_FILE_MS);
    function go(u, hops) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { fail(400, 'bad address'); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { fail(400, 'an address it can\'t reach'); return; }
        var h = { 'User-Agent': 'StremioK', 'Accept': '*/*' };
        if (range) { h.Range = range; }
        if (f.auth) { h.Authorization = davAuthFor(f, 'GET', pu.path); }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: 'GET', headers: h };
        if (pu.protocol === 'https:') {
            if (f.cert) { opts.ca = [f.cert]; opts.checkServerIdentity = function () { return undefined; }; opts.agent = false; }
            else if (caList().length) { opts.ca = caList(); }
        }
        try {
            r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (gone) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 4) {
                    resp.resume();
                    var np = null;
                    try { np = urllib.parse(urllib.resolve(u, String(resp.headers.location))); } catch (e) { np = null; }
                    if (!np || !davUnder(f, np)) { fail(502, 'it sent StremioK to another address: not followed'); return; }
                    go(urllib.format(np), hops + 1);
                    return;
                }
                if (sc === 401 && !digested && davDigestLearn(f, resp.headers['www-authenticate'])) { resp.resume(); digested = true; go(u, hops); return; }
                if (sc !== 200 && sc !== 206) { resp.resume(); fail(sc >= 400 && sc < 600 ? sc : 502, 'HTTP ' + sc); return; }
                clearTimeout(timer);
                var out = { 'Content-Type': String(resp.headers['content-type'] || 'application/octet-stream'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
                if (resp.headers['content-length']) { out['Content-Length'] = resp.headers['content-length']; }
                if (resp.headers['content-range']) { out['Content-Range'] = resp.headers['content-range']; }
                res.writeHead(sc, out);
                resp.on('data', function (c) {
                    if (gone) { return; }
                    if (!res.write(c)) { resp.pause(); res.once('drain', function () { if (!gone) { resp.resume(); } }); }
                });
                resp.on('end', function () { if (!gone) { try { res.end(); } catch (e) {} } });
                resp.on('error', function () { fail(502, 'the folder stopped sending'); });
            });
            guardSelf(r, function () { fail(400, 'an address it can\'t reach'); });
            r.on('error', function (e) { fail(502, (e && e.message) || 'network error'); });
            r.end();
        } catch (e) { fail(400, 'bad address'); }
    }
    go(url, 0);
}
function davControl(req, res, path, query, leaving) {
    if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
    var q = davQ(query), f = davFolder(req, q);
    if (!f) { send(res, 400, 'text/plain', 'bad folder'); return; }
    function answer(err, r) {
        if (!err) { send(res, 200, 'application/json', JSON.stringify(r)); return; }
        if (err.status === 400) { send(res, 400, 'text/plain', err.message); return; }
        davProblem(f, err, function (p) { send(res, 200, 'application/json', JSON.stringify(p)); });
    }
    if (path === '/dav/list') { leaving.push(davList(f, q.p, answer)); return; }
    if (path === '/dav/open') {   // a ticket the player's link carries (see /net/)
        send(res, 200, 'application/json', JSON.stringify({ ticket: netTicket('dav', f) }));
        return;
    }
    if (path === '/dav/mi') {   // what's in a file there, from its header (see mediaInfo)
        var mu = davUrl(f, q.p), mstops = [];
        if (!mu || !VIDEO_EXT.test(String(q.p || ''))) { send(res, 400, 'text/plain', 'not a video in the folder'); return; }
        var stopDm = mediaInfo(miDavReader(f, mu, mstops), function (err, r) {
            mstops.forEach(function (x) { try { x(); } catch (e) {} });
            if (err) { send(res, err.status === 400 ? 400 : 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            send(res, 200, 'application/json', JSON.stringify(r));
        });
        if (stopDm) { leaving.push(stopDm); }
        return;
    }
    if (path === '/dav/sub') {
        leaving.push(davSub(f, q.p, function (err, text) {
            if (err) { send(res, err.status === 400 ? 400 : 502, 'text/plain', 'failed: ' + (err.message || 'unknown')); return; }
            send(res, 200, 'text/plain; charset=utf-8', text);
        }));
        return;
    }
    if (path === '/dav/walk') {
        if (_davWalking) { send(res, 200, 'application/json', JSON.stringify({ why: 'busy', message: 'another folder is being indexed' })); return; }
        var st = _davWalking = { cancelled: false, aborts: [] };
        leaving.push(function () { st.cancelled = true; st.aborts.forEach(function (a) { try { a(); } catch (e) {} }); if (_davWalking === st) { _davWalking = null; } });
        davWalk(f, st, function (err, r) { if (_davWalking === st) { _davWalking = null; } answer(err, r); });
        return;
    }
    send(res, 404, 'text/plain', 'not found');
}

// ---- Xtream films and series (/xtvod/list, /xtvod/find) ----
// An Xtream account's whole list of films (get_vod_streams) and series (get_series), read a piece
// at a time (xtvItems: one title parsed at a time, never the whole answer) into a small record each
// ({ i: id, n: name, k: name to match, y: year, t: TMDB id, c: category, a: added, e: file type,
// p: picture, r: rating }), up to XTV_MAX bytes, XTV_MS and XTV_ITEMS titles. Kept XTV_KEEP accounts
// and types at once; on the sideloaded app saved in its folder (xtvSave), read again after
// XTV_FRESH_MS. While it's read again, what's asked is answered with the old list. One download at
// a time.
var XTV_SLICE = 2000, XTV_IDLE_MS = 30 * 60000, XTV_FILE_MS = 3 * 86400000;
var XTV_MAX = 150 * 1048576, XTV_MS = 6 * 60000, XTV_ITEMS = 100000, XTV_FRESH_MS = 86400000, XTV_RETRY_MS = 10 * 60000, XTV_KEEP = 4, XTV_NEWEST = 200, XTV_FOUND = 100;
var _xtv = Object.create(null), _xtvQueue = [], _xtvBusy = false;
// A name to match: no language tag (EN - , |EN|, [EN]), brackets, year, quality words or accents.
var XTV_WORDS = /\b(4k|uhd|fhd|hd|sd|hdr|hevc|x265|h265|1080p|720p|2160p|multi|multisub|vostfr|vost|dual|sub|subs|dub|dubbed|latino|castellano|vf|vo)\b/g;
function xtvKey(name) {
    var s = String(name || '').toLowerCase().replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/g, function (c) { return EPG_ACCENTS[c]; });
    for (var i = 0; i < 3; i++) { s = s.replace(/^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\]|[a-z]{2,3}\s*[-:|]\s+)\s*/, ''); }
    return s.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' ').replace(XTV_WORDS, ' ').trim().replace(/\b(19|20)\d{2}$/, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function xtvYear(o, name) {
    var y = parseInt(o.year, 10) || parseInt(String(o.releaseDate || o.release_date || '').slice(0, 4), 10);
    if (!(y > 1880 && y < 2100)) { var n = String(name || '').trim(), m = /[(\s\[](19\d{2}|20\d{2})[)\]]?$/.exec(n) || /\((19\d{2}|20\d{2})\)/.exec(n); y = m ? +m[1] : 0; }
    return y > 1880 && y < 2100 ? y : 0;
}
function xtvRecord(o, type) {
    if (!o || typeof o !== 'object') { return null; }
    var id = type === 'movie' ? o.stream_id : o.series_id, name = String(o.name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!(+id > 0) || !name) { return null; }
    var r = { i: +id, n: name, k: xtvKey(name), y: xtvYear(o, name), c: String(o.category_id || '').slice(0, 20), a: +(o.added || o.last_modified || 0) || 0 };
    var t = parseInt(o.tmdb || o.tmdb_id, 10);
    if (t > 0) { r.t = t; }
    if (type === 'movie' && /^[a-z0-9]{2,5}$/i.test(String(o.container_extension || ''))) { r.e = String(o.container_extension).toLowerCase(); }
    var pic = String(o.stream_icon || o.cover || '');
    if (/^https?:\/\//i.test(pic) && pic.length < 600) { r.p = pic; }
    var rating = parseFloat(o.rating_5based ? o.rating_5based * 2 : o.rating);
    if (rating > 0 && rating <= 10) { r.r = Math.round(rating * 10) / 10; }
    return r;
}
// The titles in a JSON array, one at a time: feed(text) as it comes; onItem(each object directly
// in the array). A title bigger than 1 MB is skipped.
function xtvItems(onItem) {
    var depth = 0, inStr = false, esc = false, inItem = false, carry = '', skip = false;
    return function (text) {
        var start = inItem ? 0 : -1;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charCodeAt(i);
            if (inStr) { if (esc) { esc = false; } else if (ch === 92) { esc = true; } else if (ch === 34) { inStr = false; } continue; }
            if (ch === 34) { inStr = true; }
            else if (ch === 123 || ch === 91) { depth++; if (depth === 2 && ch === 123 && !inItem) { inItem = true; start = i; carry = ''; skip = false; } }
            else if (ch === 125 || ch === 93) {
                if (depth === 2 && inItem) {
                    var piece = carry + text.slice(start, i + 1);
                    inItem = false; carry = '';
                    if (!skip) { try { onItem(JSON.parse(piece)); } catch (e) {} }
                }
                depth--;
            }
        }
        if (inItem && !skip) { carry += text.slice(start); if (carry.length > 1048576) { skip = true; carry = ''; } }
    };
}
// A GET read as it comes (onText each piece, as text): redirects on the same server, XTV_MAX bytes,
// XTV_MS in all. cb(err) once it's done.
function xtvGet(url, onText, cb) {
    cb = once(cb);
    var first = null, r = null, size = 0, done = false;
    try { first = urllib.parse(url); } catch (e) { first = null; }
    var timer = setTimeout(function () { finish(upError('took too long', 504)); }, XTV_MS);
    function finish(err) { if (done) { return; } done = true; clearTimeout(timer); try { if (err && r) { r.abort(); } } catch (e) {} cb(err); }
    function go(u, hops) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { finish(upError('bad address', 400)); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { finish(upError('an address it can\'t reach', 400)); return; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: 'GET', headers: { 'User-Agent': TV_UA, 'Accept': 'application/json', 'Accept-Encoding': 'identity' } };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        try {
            r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (done) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 4) {
                    resp.resume();
                    var next = urllib.resolve(u, resp.headers.location), np = null;
                    try { np = urllib.parse(next); } catch (e) { np = null; }
                    if (!sameServerRedirect(first, np)) { finish(upError('redirected to another server: not followed (your login stays with it)', 502)); return; }
                    go(next, hops + 1);
                    return;
                }
                if (sc !== 200) { resp.resume(); finish(upError('HTTP ' + sc, sc === 401 || sc === 403 ? 401 : 502)); return; }
                var dec = new StringDecoder('utf8');
                resp.on('data', function (c) {
                    if (done) { return; }
                    size += c.length;
                    if (size > XTV_MAX) { finish(upError('too large', 502)); return; }
                    try { onText(dec.write(c)); } catch (e) { finish(e); }
                });
                resp.on('end', function () { if (!done) { try { onText(dec.end()); } catch (e) {} finish(null); } });
                resp.on('error', function (e) { finish(e); });
            });
            r.on('error', function (e) { finish(upError('couldn\'t reach it (' + (e.code || e.message) + ')', 502)); });
            guardSelf(r, function () { finish(upError('an address it can\'t reach', 400)); });
            r.end();
        } catch (e) { finish(e); }
    }
    go(url, 0);
}
// The saved list: xtv-<hash>.jsonl in the app's folder, a line for its key and date, then a line a
// title, written and read in small pieces (the service also relays live channels, YouTube and
// guides: nothing here holds it up for long). Saved lists not used for XTV_FILE_MS are deleted.
function xtvFile(key) { var d = tokenDir(); return d ? d + '/xtv-' + epgHash(key).toString(36) + '.jsonl' : null; }
var _xtvSwept = false, XTV_FILES = /^xtv-[0-9a-z]+\.jsonl?(\.part)?$/;
function xtvSweep() {
    if (_xtvSwept) { return; }
    _xtvSwept = true;
    var d = tokenDir(), fs = require('fs');
    if (!d) { return; }
    fs.readdir(d, function (err, names) {
        (err ? [] : names).filter(function (n) { return XTV_FILES.test(n); }).forEach(function (n) {
            if (/\.json$/.test(n)) { fs.unlink(d + '/' + n, noop); return; }   // (the first version's)
            fs.stat(d + '/' + n, function (e, st) { if (!e && st && Date.now() - st.mtime.getTime() > XTV_FILE_MS) { fs.unlink(d + '/' + n, noop); } });
        });
    });
}
function xtvSave(x) {
    var f = xtvFile(x.key), fs = require('fs'), items = x.items, at = 0, failed = false, s;
    if (!f) { return; }
    try { s = fs.createWriteStream(f + '.part', { mode: 384 }); } catch (e) { return; }
    s.on('error', function (e) { failed = true; log('Xtream list not saved (' + (e.code || e.message) + ')'); });
    s.write(JSON.stringify({ key: x.key, at: x.at }) + '\n');
    (function more() {
        if (failed) { return; }
        var lines = [], end = Math.min(items.length, at + XTV_SLICE);
        for (; at < end; at++) { lines.push(JSON.stringify(items[at])); }
        var room = s.write(lines.length ? lines.join('\n') + '\n' : '');
        if (at >= items.length) {
            s.end(function () {
                if (failed) { return; }
                if (_xtv[x.key] !== x) { fs.unlink(f + '.part', noop); return; }   // (cleared meanwhile: Clear saved copies)
                fs.rename(f + '.part', f, function (e) { if (!e && x.items === items) { x.saved = true; xtvIdle(x); } });
            });
            return;
        }
        if (room) { setTimeout(more, 0); } else { s.once('drain', more); }
    })();
}
// cb(items, at): the saved list, or nothing (none, another's, unreadable).
function xtvLoad(x, cb) {
    var f = xtvFile(x.key), fs = require('fs'), items = [], at = 0, first = true, rest = '', dec = new StringDecoder('utf8'), s;
    cb = once(cb);
    try { s = fs.createReadStream(f, { highWaterMark: 65536 }); } catch (e) { cb(); return; }
    function line(l) {
        if (!l) { return; }
        var o = null;
        try { o = JSON.parse(l); } catch (e) { o = null; }
        if (first) {
            first = false;
            if (!o || o.key !== x.key) { items = null; try { s.destroy(); } catch (e2) {} cb(); return; }
            at = +o.at || 0;
        } else if (o && items) { items.push(o); }
    }
    s.on('data', function (c) {
        var ls = (rest + dec.write(c)).split('\n');
        rest = ls.pop();
        ls.forEach(line);
    });
    s.on('end', function () { line(rest); if (items && items.length) { cb(items, at); } else { cb(); } });
    s.on('error', function () { cb(); });
}
// The newest titles, without sorting the whole list: the XTV_NEWEST latest kept in order.
function xtvNewestOf(items) {
    var top = [];
    items.forEach(function (r) {
        if (top.length >= XTV_NEWEST && r.a <= top[top.length - 1].a) { return; }
        var lo = 0, hi = top.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (top[mid].a >= r.a) { lo = mid + 1; } else { hi = mid; } }
        top.splice(lo, 0, r);
        if (top.length > XTV_NEWEST) { top.pop(); }
    });
    return top;
}
function xtvHave(x, items, at) {
    x.items = items; x.at = at; x.newest = xtvNewestOf(items); x.state = 'ready'; x.error = '';
    xtvIdle(x);
}
// Unused for XTV_IDLE_MS, a list that's saved leaves memory (its newest titles stay: Home's row),
// and comes back from the file when it's asked for.
function xtvIdle(x) {
    if (x.idleTimer) { return; }
    x.idleTimer = setTimeout(function () {
        x.idleTimer = null;
        if (_xtv[x.key] !== x || !x.items) { return; }
        if (!x.saved || x.busy || Date.now() - x.used < XTV_IDLE_MS) { xtvIdle(x); return; }
        x.items = null; x.triedFile = false; x.state = 'new';
    }, XTV_IDLE_MS);
    if (x.idleTimer.unref) { x.idleTimer.unref(); }
}
// What it needs now: its saved list read (at once: one account's download doesn't hold up
// another's file), or its list downloaded (queued, one at a time). Those waiting for the file are
// answered when it's read.
function xtvDue(x, force) {
    if (force) { x.force = true; }
    if (x.busy || _xtvQueue.indexOf(x) !== -1) { return; }
    if (!x.items && !x.triedFile && xtvFile(x.key)) {
        x.triedFile = true; x.busy = true; x.loading = true; x.state = 'reading';
        xtvLoad(x, function (items, at) {
            x.busy = false; x.loading = false;
            if (items) { x.saved = true; xtvHave(x, items, at); } else { x.state = 'new'; }
            xtvDue(x);
            var w = x.waiters; x.waiters = [];
            w.forEach(function (fn) { try { fn(); } catch (e) {} });
        });
        return;
    }
    var stale = x.force || !x.at || Date.now() - x.at > XTV_FRESH_MS, retry = x.force || Date.now() - (x.failedAt || 0) > XTV_RETRY_MS;
    if (!stale || !retry) { return; }
    if (!x.items) { x.state = 'queued'; }
    _xtvQueue.push(x);
    xtvPump();
}
// The list of this account and type: kept, saved, or read (queued); x.state 'ready' with x.items.
function xtvList(base, user, pass, type, force) {
    var key = base + '|' + user + '|' + type, x = _xtv[key];
    xtvSweep();
    if (!x) {
        var keys = Object.keys(_xtv);
        if (keys.length >= XTV_KEEP) { keys.sort(function (a, b) { return _xtv[a].used - _xtv[b].used; }); delete _xtv[keys[0]]; }
        x = _xtv[key] = { key: key, base: base, user: user, pass: pass, type: type, state: 'new', items: null, newest: null, at: 0, waiters: [] };
    }
    x.pass = pass; x.used = Date.now();
    xtvDue(x, force);
    return x;
}
function xtvPump() {
    if (_xtvBusy || !_xtvQueue.length) { return; }
    var x = _xtvQueue.shift();
    if (_xtv[x.key] !== x) { xtvPump(); return; }
    _xtvBusy = true; x.busy = true; x.force = false;
    if (!x.items) { x.state = 'reading'; }
    var items = [], url = x.base + '/player_api.php?username=' + encodeURIComponent(x.user) + '&password=' + encodeURIComponent(x.pass) + '&action=' + (x.type === 'movie' ? 'get_vod_streams' : 'get_series');
    var feed = xtvItems(function (o) { if (items.length < XTV_ITEMS) { var r = xtvRecord(o, x.type); if (r) { items.push(r); } } });
    xtvGet(url, feed, function (err) {
        _xtvBusy = false; x.busy = false;
        try {
            if (err || (!items.length && !x.items)) {
                x.failedAt = Date.now(); x.error = err ? (err.message || 'failed') : 'no titles in its answer';
                if (!x.items) { x.state = 'failed'; }
                log('Xtream ' + x.type + ' list not read: ' + x.error);
            } else if (_xtv[x.key] === x) {
                xtvHave(x, items, Date.now());
                x.failedAt = 0;
                xtvSave(x);
            }
        } catch (e) { x.state = x.items ? 'ready' : 'failed'; }
        xtvPump();
    });
}
function xtvOut(r) { var o = { id: r.i, name: r.n, year: r.y || 0, cat: r.c }; if (r.t) { o.tmdb = r.t; } if (r.e) { o.ext = r.e; } if (r.p) { o.pic = r.p; } if (r.r) { o.rating = r.r; } return o; }
function xtvControl(req, res, path, query) {
    if (!entryAllowed(req, query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
    var q = {};
    (query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } });
    var base = String(q.base || '').replace(/\/+$/, ''), type = q.type === 'series' ? 'series' : 'movie';
    if (!/^https?:\/\/[^\s]+$/i.test(base) || base.length > 500 || !q.user || !q.pass || q.user.length > 200 || q.pass.length > 200) { send(res, 400, 'text/plain', 'bad account'); return; }
    var x = xtvList(base, String(q.user), String(q.pass), type, q.force === '1');
    function answer() {
        var items = x.items || [], out = [], i;
        if (path === '/xtvod/find') {
            var tmdb = parseInt(q.tmdb, 10) || 0, k = xtvKey(q.name), y = parseInt(q.year, 10) || 0;
            for (i = 0; i < items.length && out.length < 12; i++) {
                var r = items[i];
                if (tmdb && r.t) { if (r.t === tmdb) { out.push(r); } continue; }
                if (k && r.k === k && (!y || !r.y || Math.abs(r.y - y) <= (type === 'series' ? 0 : 1))) { out.push(r); }
            }
        } else if (q.q) {
            var words = xtvKey(q.q).split(' ').filter(Boolean), first = [], rest = [], whole = words.join(' ');
            for (i = 0; words.length && i < items.length && first.length + rest.length < XTV_FOUND * 3; i++) {
                var t = items[i], all = true;
                for (var w = 0; all && w < words.length; w++) { var at = t.k.indexOf(words[w]); all = at === 0 || (at > 0 && t.k.indexOf(' ' + words[w]) !== -1); }
                if (all) { (t.k.indexOf(whole) === 0 ? first : rest).push(t); }
            }
            out = first.concat(rest).slice(0, XTV_FOUND);
        } else {
            out = x.newest || [];
        }
        var skip = parseInt(q.skip, 10) || 0;
        if (skip > 0) { out = out.slice(skip); }
        send(res, 200, 'application/json', JSON.stringify({ state: x.state, at: x.at, error: x.error || '', items: out.map(xtvOut) }));
    }
    // (its saved list on its way: a moment; the newest row doesn't need it)
    if (x.loading && !(path === '/xtvod/list' && !q.q && x.newest)) { x.waiters.push(answer); return; }
    answer();
}

// ---- Stalker portals (/stalker/list, /stalker/link, /stalker/genres; films and series below) ----
// A Stalker (Ministra) portal, asked as a MAG box asks: its MAC address in a cookie, a MAG
// User-Agent, a session token from a handshake (none of which a web page can send). Its API at
// <address>/portal.php, else /server/load.php (the address's /c/ left out). list: its genres and
// channels (get_all_channels, else get_ordered_list a page at a time, STALKER_PAGES at most; all=1:
// the whole portal, up to STALKER_CHANNELS within STALKER_WHOLE_MS, a failed page tried again after
// each of STALKER_WAITS, the rest then read STALKER_PACE_MS apart; genres=: only those genres, read
// the same way; cut: it stopped short) as an
// M3U playlist, genres as groups, xmltv_id as tvg-id, each channel's link the one in its cmd (often
// a stand-in, http://localhost/ch/123_), kept STALKER_LIST_MS (adding a portal just checked reads it
// once). link: the link to play now (create_link, with the channel's own cmd). A session whose
// token the portal no longer takes is opened again, once. Redirects only on the same server.
var STALKER_UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
var STALKER_MS = 20000, STALKER_MAX = 16 * 1048576, STALKER_PAGES = 100, STALKER_CHANNELS = 30000, STALKER_LIST_MS = 2 * 60000, STALKER_KEEP = 4;
var STALKER_GENRES = 1000, STALKER_WAITS = [3000, 10000, 30000, 60000, 120000], STALKER_PACE_MS = 1000, STALKER_WHOLE_MS = 17 * 60000;   // (the app waits 20 minutes: what was read gets there)
var _stalker = Object.create(null);   // portal|mac -> { api, base, mac, token, cmds: { link: cmd }, list: { at, m3u, count }, used }
function stalkerKeep(key) {
    var s = _stalker[key];
    if (!s) {
        var keys = Object.keys(_stalker);
        if (keys.length >= STALKER_KEEP) { keys.sort(function (a, b) { return _stalker[a].used - _stalker[b].used; }); delete _stalker[keys[0]]; }
        s = _stalker[key] = { token: '', cmds: {}, list: null };
    }
    s.used = Date.now();
    return s;
}
function stalkerApis(portal) {
    var b = portal.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/(portal|load)\.php$/i, '').replace(/\/(c|server)$/i, '').replace(/\/+$/, '');
    var apis = [b + '/portal.php', b + '/server/load.php'];
    if (!/\/stalker_portal$/i.test(b)) { apis.push(b + '/stalker_portal/server/load.php'); }
    return { base: b, apis: apis };
}
// One GET to the portal: cb(err, js) with its answer's "js"; an answer that isn't JSON (a portal
// that refuses the session says "Authorization failed.") is an error, err.auth when it says so.
function stalkerAsk(s, params, ctl, cb) {
    cb = once(cb);
    var url = s.api + '?' + params + '&JsHttpRequest=1-xml', first = null, done = false;
    try { first = urllib.parse(url); } catch (e) { first = null; }
    var h = { 'User-Agent': STALKER_UA, 'X-User-Agent': 'Model: MAG250; Link: WiFi', 'Accept': '*/*', 'Accept-Encoding': 'gzip',
        'Cookie': 'mac=' + s.mac + '; stb_lang=en; timezone=UTC', 'Referer': s.base + '/c/' };
    if (s.token) { h.Authorization = 'Bearer ' + s.token; }
    var timer = setTimeout(function () { finish(upError('the portal didn\'t answer', 504)); }, STALKER_MS), r = null;
    function finish(err, js) { if (done) { return; } done = true; clearTimeout(timer); if (ctl.abort === abort) { ctl.abort = null; } if (err) { try { if (r) { r.abort(); } } catch (e) {} } cb(err, js); }
    function abort() { finish(upError('stopped', 499)); }
    if (ctl.gone) { finish(upError('stopped', 499)); return; }
    ctl.abort = abort;
    function go(u, hops) {
        var pu;
        try { pu = urllib.parse(u); } catch (e) { finish(upError('bad address', 400)); return; }
        if ((pu.protocol !== 'http:' && pu.protocol !== 'https:') || !dlHostOk(pu.hostname)) { finish(upError('an address it can\'t reach', 400)); return; }
        var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: 'GET', headers: h };
        if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
        var chunks = [], size = 0;
        try {
            r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
                if (done) { resp.resume(); return; }
                var sc = resp.statusCode;
                if (sc >= 300 && sc < 400 && resp.headers.location && hops < 4) {
                    resp.resume();
                    var next = urllib.resolve(u, resp.headers.location), np = null;
                    try { np = urllib.parse(next); } catch (e) { np = null; }
                    if (!sameServerRedirect(first, np)) { finish(upError('the portal redirected to another server: not followed (your MAC address stays with it)', 502)); return; }
                    go(next, hops + 1);
                    return;
                }
                resp.on('data', function (c) { if (done) { return; } chunks.push(c); size += c.length; if (size > STALKER_MAX) { finish(upError('too large an answer', 502)); } });
                resp.on('end', function () {
                    if (done) { return; }
                    if (sc !== 200) { finish(upError('HTTP ' + sc, sc === 401 || sc === 403 ? 401 : 502)); return; }
                    decompress(Buffer.concat(chunks, size), resp.headers['content-encoding'], function (e, buf) {
                        if (e) { finish(e); return; }
                        var text = buf.toString('utf8').replace(/^﻿/, ''), j = null;
                        try { j = JSON.parse(text); } catch (e2) { j = null; }
                        if (!j || typeof j !== 'object') {
                            var err = upError('not a Stalker answer' + (text.trim() ? ' (' + text.trim().slice(0, 80) + ')' : ''), 502);
                            err.auth = /authori[sz]ation|unauthori[sz]ed|access denied/i.test(text);
                            finish(err);
                            return;
                        }
                        finish(null, j.js);
                    });
                });
                resp.on('error', function (e) { finish(e); });
            });
            r.on('error', function (e) { finish(upError('couldn\'t reach it (' + (e.code || e.message) + ')', 502)); });
            guardSelf(r, function () { finish(upError('an address it can\'t reach', 400)); });
            r.end();
        } catch (e) { finish(e); }
    }
    go(url, 0);
}
// A MAG box's profile request: its serial number and device id made from the MAC, as other
// players do (some portals check that they're there).
function stalkerProfile(mac) {
    var sn = crypto.createHash('md5').update(mac).digest('hex').toUpperCase().slice(0, 13);
    var id = crypto.createHash('sha256').update(mac).digest('hex').toUpperCase();
    return 'type=stb&action=get_profile&hd=1&ver=' + encodeURIComponent('ImageDescription: 0.2.18-r23-250; PORTAL version: 5.6.2; API Version: JS API version: 343; STB API version: 146') +
        '&num_banks=2&sn=' + sn + '&stb_type=MAG250&client_type=STB&image_version=218&video_out=hdmi&device_id=' + id + '&device_id2=' + id +
        '&signature=&auth_second_step=1&hw_version=1.7-BD-00&not_valid_token=0&api_signature=262&prehash=';
}
// The session: its API found (the first that answers a handshake with a token), its profile asked.
function stalkerOpen(s, portal, mac, ctl, cb) {
    var p = stalkerApis(portal), i = 0, why = null;
    s.base = p.base; s.mac = mac; s.token = '';
    (function next() {
        if (i >= p.apis.length) { cb(why || upError('not a Stalker portal at that address', 502)); return; }
        s.api = p.apis[i++];
        stalkerAsk(s, 'type=stb&action=handshake&token=&prehash=0', ctl, function (err, js) {
            if (ctl.gone) { cb(upError('stopped', 499)); return; }
            if (err || !js || !js.token) { if (!why || /couldn.t reach/.test(why.message)) { why = err || upError('not a Stalker portal at that address', 502); } next(); return; }
            s.token = String(js.token).slice(0, 200);
            stalkerAsk(s, stalkerProfile(mac), ctl, function (e2, prof) {
                if (e2) { s.token = ''; cb(e2); return; }
                s.block = prof && typeof prof === 'object' && prof.block_msg ? String(prof.block_msg).slice(0, 120) : '';
                cb(null, s);
            });
        });
    })();
}
// job(s, done) with the session open; done(err) with err.auth: opened again and job run once more.
function stalkerWith(s, portal, mac, ctl, job, cb) {
    function run(again) {
        job(s, function (err, v) {
            if (err && err.auth && !again && !ctl.gone) { s.token = ''; open(true); return; }
            cb(err, v);
        });
    }
    function open(again) { stalkerOpen(s, portal, mac, ctl, function (err) { if (err) { cb(err); return; } run(again); }); }
    if (s.token && s.api) { run(false); } else { open(false); }
}
function stalkerSlim(c) {   // (a page's channel: what the playlist takes; thousands of them are held meanwhile)
    if (!c || typeof c !== 'object') { return null; }
    return { name: c.name, cmd: c.cmd, cmds: Array.isArray(c.cmds) ? c.cmds.slice(0, 1) : null, logo: c.logo, xmltv_id: c.xmltv_id, number: c.number, tv_genre_id: c.tv_genre_id };
}
// picks: the genres to read (their ids), or none: all of them.
function stalkerChannels(s, ctl, whole, picks, cb) {
    stalkerAsk(s, 'type=itv&action=get_genres', ctl, function (e0, genres) {
        if (e0 && e0.auth) { cb(e0); return; }
        var g = {};
        if (Array.isArray(genres)) { genres.forEach(function (x) { if (x && x.id != null && x.title) { g[String(x.id)] = String(x.title); } }); }
        stalkerAsk(s, 'type=itv&action=get_all_channels', ctl, function (e1, js) {
            if (e1 && e1.auth) { cb(e1); return; }
            var all = js && Array.isArray(js.data) ? js.data : Array.isArray(js) ? js : [];
            if (all.length && picks.length) { all = all.filter(function (c) { return c && picks.indexOf(String(c.tv_genre_id)) !== -1; }); cb(null, all.slice(0, STALKER_CHANNELS), g, all.length > STALKER_CHANNELS ? { total: all.length } : null); return; }
            if (all.length) { cb(null, all.slice(0, STALKER_CHANNELS), g, all.length > STALKER_CHANNELS ? { total: all.length } : null); return; }
            var todo = picks.length ? picks : ['*'], at = 0, page = 1, tries = 0, pace = 0, from = 0, known = 0, began = Date.now();
            (function more() {
                stalkerAsk(s, 'type=itv&action=get_ordered_list&genre=' + encodeURIComponent(todo[at]) + '&fav=0&sortby=number&hd=0&p=' + page, ctl, function (e2, o) {
                    if (e2 && (!all.length || (whole && e2.auth))) { cb(e2); return; }   // (whole: a session gone midway read again, once: stalkerWith)
                    var late = whole && Date.now() - began > STALKER_WHOLE_MS;
                    if (e2 && whole && !ctl.gone && !late && tries < STALKER_WAITS.length) { pace = STALKER_PACE_MS; setTimeout(more, STALKER_WAITS[tries++]); return; }
                    tries = 0;
                    var d = !e2 && o && Array.isArray(o.data) ? o.data : [], total = +(o && o.total_items) || 0, room = STALKER_CHANNELS - all.length;
                    d.slice(0, room).forEach(function (c) { var x = stalkerSlim(c); if (x) { if (picks.length) { x.tv_genre_id = todo[at]; } all.push(x); } });
                    if (total) { known = total; }
                    var ended = !d.length || (total && all.length - from >= total), lastOne = at + 1 >= todo.length;   // (this genre's all read; no other to read)
                    var full = all.length >= STALKER_CHANNELS, last = !whole && page >= STALKER_PAGES;
                    if (e2 || full || last || late || (ended && lastOne)) {
                        var cut = e2 || ((!ended || !lastOne) && (full || last || late)) ? { total: picks.length ? 0 : known, why: e2 ? (e2.message || 'failed') : late ? 'it took too long' : '' } : null;
                        cb(null, all, g, cut);
                        return;
                    }
                    if (ended) { at++; page = 1; from = all.length; } else { page++; }
                    if (pace) { setTimeout(more, pace); } else { more(); }
                });
            })();
        });
    });
}
function stalkerM3u(s, list, genres) {
    function clean(v) { return String(v == null ? '' : v).replace(/[\r\n"]+/g, ' ').trim().slice(0, 300); }
    var out = ['#EXTM3U'], cmds = {}, n = 0;
    list.forEach(function (c) {
        if (!c || typeof c !== 'object') { return; }
        var cmd = String(c.cmd || (Array.isArray(c.cmds) && c.cmds[0] && c.cmds[0].url) || ''), m = /(https?:\/\/[^\s"]+)/i.exec(cmd);
        if (!m || m[1].length > 1000) { return; }
        cmds[m[1]] = cmd.slice(0, 2000);
        var logo = clean(c.logo);
        if (logo && !/^https?:\/\//i.test(logo)) { logo = s.base + '/misc/logos/320/' + logo.replace(/^\/+/, ''); }
        out.push('#EXTINF:-1' + (c.xmltv_id ? ' tvg-id="' + clean(c.xmltv_id) + '"' : '') + (logo ? ' tvg-logo="' + logo + '"' : '') + (c.number ? ' tvg-chno="' + clean(c.number) + '"' : '') +
            ' group-title="' + clean(genres[String(c.tv_genre_id)] || 'Live TV') + '",' + (clean(c.name).replace(/,/g, ' ·') || 'Channel'));
        out.push(m[1]);
        n++;
    });
    s.cmds = cmds;
    return { m3u: out.join('\n') + '\n', count: n };
}

// ---- A Stalker portal's films and series (/stalker/vod, /stalker/play) ----
// Asked as they're shown, never read whole: cats (a type's categories: films type=vod, series
// type=series, a portal without that module none), list (a category's titles, newest first, or
// those a search finds: STALKER_VOD_TAKE from skip, STALKER_VOD_PAGES of the portal's pages at
// most; a film that's a series, is_series, marked so), seasons (a series' seasons and their
// episodes: a season's cmd and its episodes' numbers, or each episode's own cmd) and play (a film's
// or an episode's link asked now, create_link, and sent there: what's saved to resume stays good).
var STALKER_VOD_TAKE = 42, STALKER_VOD_PAGES = 4, STALKER_VOD_CATS_MS = 10 * 60000, STALKER_SEASONS = 60, STALKER_EPISODES = 500;
// What a portal answered (a list from a position, a search, a series' seasons): kept
// STALKER_VOD_KEEP_MS, the last STALKER_VOD_KEEP a portal, so a row or category shown again isn't
// asked again (a portal may stop answering many quick asks); fresh=1 (Reload) lets it all go.
// &keep=: the app's Stalker films and series setting, in minutes (0: not kept; up to 10).
var STALKER_VOD_KEEP_MS = 10 * 60000, STALKER_VOD_KEEP = 40;
function stalkerKeepMs(q) { var m = /^\d{1,2}$/.test(q.keep || '') ? +q.keep : 10; return Math.min(m, 10) * 60000; }
function stalkerKept(s, key, ms) { var k = s.vodKept && s.vodKept[key]; return k && Date.now() - k.at < Math.min(ms, STALKER_VOD_KEEP_MS) ? k.v : null; }
function stalkerKeepVod(s, key, v) {
    if (!s.vodKept) { s.vodKept = Object.create(null); s.vodOrder = []; }
    if (!s.vodKept[key]) { s.vodOrder.push(key); while (s.vodOrder.length > STALKER_VOD_KEEP) { delete s.vodKept[s.vodOrder.shift()]; } }
    s.vodKept[key] = { at: Date.now(), v: v };
}
function stalkerText(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
function stalkerCmdOk(cmd) { return !!cmd && cmd.length <= 2000 && !/[\r\n]/.test(cmd); }
function stalkerVodItem(s, o) {
    if (!o || typeof o !== 'object' || o.id == null) { return null; }
    var id = String(o.id), name = stalkerText(o.name || o.o_name, 200);
    if (!/^[\w-]{1,40}$/.test(id) || !name) { return null; }
    var it = { id: id, name: name }, y = parseInt(o.year, 10), pic = String(o.screenshot_uri || o.cover || ''), r = parseFloat(o.rating_imdb) || parseFloat(o.rating_kinopoisk), t = parseInt(o.time, 10), cmd = String(o.cmd || '');
    if (y > 1880 && y < 2100) { it.year = y; }
    if (/^\//.test(pic)) { var b = urllib.parse(s.base); pic = b.protocol + '//' + b.host + pic; }   // (a picture on the portal's own server)
    if (/^https?:\/\//i.test(pic) && pic.length < 600) { it.pic = pic; }
    if (r > 0 && r <= 10) { it.rating = Math.round(r * 10) / 10; }
    if (stalkerText(o.description, 1)) { it.desc = stalkerText(o.description, 2000); }
    if (stalkerText(o.director, 1)) { it.director = stalkerText(o.director, 200); }
    if (stalkerText(o.actors, 1)) { it.cast = stalkerText(o.actors, 400); }
    if (stalkerText(o.genres_str, 1)) { it.genres = stalkerText(o.genres_str, 200); }
    if (t > 0 && t < 1000) { it.mins = t; }
    if (stalkerCmdOk(cmd)) { it.cmd = cmd; }
    if (+o.is_series === 1 || o.is_series === true) { it.series = true; }
    return it;
}
function stalkerVodCats(s, type, ctl, cb) {
    var kept = s.vodCats && s.vodCats[type];
    if (kept && Date.now() - kept.at < STALKER_VOD_CATS_MS) { cb(null, kept.list); return; }
    stalkerAsk(s, 'type=' + (type === 'movie' ? 'vod' : 'series') + '&action=get_categories', ctl, function (err, js) {
        if (err && (err.auth || type === 'movie')) { cb(err); return; }   // (no series module: no series)
        var list = (Array.isArray(js) ? js : []).filter(function (x) { return x && x.id != null && String(x.id) !== '*' && x.title; }).slice(0, STALKER_GENRES)
            .map(function (x) { return { id: String(x.id).slice(0, 40), title: stalkerText(x.title, 100) }; });
        s.vodCats = s.vodCats || {};
        s.vodCats[type] = { at: Date.now(), list: list };
        cb(null, list);
    });
}
// cb(err, { items, more }): from skip on, in the portal's pages (s.vodSize titles each, learned
// from its first answer: a page asked for that first, once, when skip is past it).
function stalkerVodList(s, type, cat, words, skip, ctl, cb) {
    var params = 'type=' + (type === 'movie' ? 'vod' : 'series') + '&action=get_ordered_list&category=' + encodeURIComponent(cat || '*') + '&genre=*&sortby=added&hd=0&not_ended=0&fav=0' +
        (words ? '&search=' + encodeURIComponent(words) : '');
    function page(p, done) {
        stalkerAsk(s, params + '&p=' + p, ctl, function (err, o) {
            if (err) { done(err); return; }
            var d = o && Array.isArray(o.data) ? o.data : [], total = +(o && o.total_items) || 0;
            if (!s.vodSize && d.length && total > d.length) { s.vodSize = d.length; }
            done(null, d, total);
        });
    }
    function from() {
        var size = s.vodSize || STALKER_VOD_TAKE, p = Math.floor(skip / size) + 1, drop = skip % size, out = [], asked = 0;
        (function more() {
            page(p, function (err, d, total) {
                if (err) { if (out.length) { cb(null, { items: out, more: true }); } else { cb(err); } return; }
                asked++;
                d.slice(drop).forEach(function (o) { var it = stalkerVodItem(s, o); if (it) { out.push(it); } });
                drop = 0;
                var left = d.length && (!total || p * (s.vodSize || d.length) < total);
                if (!left || out.length >= STALKER_VOD_TAKE || asked >= STALKER_VOD_PAGES) { cb(null, { items: out.slice(0, STALKER_VOD_TAKE * 2), more: !!left }); return; }
                p++;
                more();
            });
        })();
    }
    if (skip > 0 && !s.vodSize) {
        page(1, function (err, d) {
            if (err) { cb(err); return; }
            if (s.vodSize) { from(); return; }
            var out = [];   // (one page held all there is)
            d.slice(skip).forEach(function (o) { var it = stalkerVodItem(s, o); if (it) { out.push(it); } });
            cb(null, { items: out, more: false });
        });
        return;
    }
    from();
}
// A series' seasons: { season, name, cmd, eps: [{ n, cmd?, name? }] }. viaVod: a film that's a
// series (is_series), its seasons asked of the films (type=vod).
function stalkerSeasonNo(o, at) {
    var n = parseInt(o.season_number, 10), m = /(\d+)/.exec(String(o.name || ''));
    return n >= 0 ? n : m ? +m[1] : at;
}
function stalkerSeasons(s, id, viaVod, ctl, cb) {
    var base = viaVod ? 'type=vod&action=get_ordered_list&movie_id=' + encodeURIComponent(id) : 'type=series&action=get_ordered_list&movie_id=' + encodeURIComponent(id) + '&season_id=0&episode_id=0';
    var out = [], p = 1;
    function all(params, each, done) {   // (every page of an answer, 10 at most)
        var page = 1, got = 0;
        (function more() {
            stalkerAsk(s, params + '&p=' + page, ctl, function (err, o) {
                if (err) { done(err); return; }
                var d = o && Array.isArray(o.data) ? o.data : [], total = +(o && o.total_items) || 0;
                d.forEach(function (x, i) { each(x, got + i + 1); });
                got += d.length;
                if (d.length && page < 10 && total > got) { page++; more(); } else { done(null); }
            });
        })();
    }
    all(base, function (x, at) {
        if (!x || typeof x !== 'object' || out.length >= STALKER_SEASONS) { return; }
        var cmd = String(x.cmd || ''), eps = Array.isArray(x.series) ? x.series.map(function (n) { return parseInt(n, 10); }).filter(function (n) { return n >= 0; }).slice(0, STALKER_EPISODES) : null;
        out.push({ season: stalkerSeasonNo(x, at), name: stalkerText(x.name, 100), cmd: stalkerCmdOk(cmd) ? cmd : '', id: String(x.id == null ? '' : x.id).slice(0, 60), eps: eps ? eps.map(function (n) { return { n: n }; }) : null });
    }, function (err) {
        if (err && !out.length) { cb(err); return; }
        (function next(i) {   // (seasons that don't list their episodes: asked for them, each with its own cmd)
            while (i < out.length && out[i].eps) { i++; }
            if (i >= out.length || viaVod) { cb(null, out.filter(function (x) { return x.eps && x.eps.length; }).map(function (x) { delete x.id; return x; })); return; }
            var se = out[i];
            se.eps = [];
            all('type=series&action=get_ordered_list&movie_id=' + encodeURIComponent(id) + '&season_id=' + encodeURIComponent(se.id) + '&episode_id=0', function (e, at) {
                var cmd = String((e && e.cmd) || '');
                if (!e || !stalkerCmdOk(cmd) || se.eps.length >= STALKER_EPISODES) { return; }
                var n = parseInt(e.series_number, 10), m = /(\d+)/.exec(String(e.name || ''));
                se.eps.push({ n: n >= 0 ? n : m ? +m[1] : at, cmd: cmd, name: stalkerText(e.name, 120) });
            }, function () { next(i + 1); });
        })(0);
    });
}
// A film's or an episode's link to play now: cmd (an episode of a season's cmd: ep, its number).
function stalkerVodLink(s, cmd, ep, ctl, cb) {
    stalkerAsk(s, 'type=vod&action=create_link&cmd=' + encodeURIComponent(cmd) + '&series=' + (ep >= 0 ? ep : '') + '&forced_storage=undefined&disable_ad=0&download=0&force_ch_link_check=0', ctl, function (err, js) {
        if (err) { cb(err); return; }
        var m = /(https?:\/\/[^\s"]+)/i.exec(String((js && js.cmd) || ''));
        cb(m ? null : upError('the portal gave no link for this title', 502), m ? m[1] : null);
    });
}
function stalkerControl(req, res, path, query, leaving) {
    if (!entryAllowed(req, query) && !(path === '/stalker/play' && hasTicket(query))) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }   // (play: the player asks, without the header)
    var q = {};
    (query || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } });
    var portal = String(q.portal || '').trim(), mac = String(q.mac || '').toUpperCase();
    if (!/^https?:\/\/[^\s]+$/i.test(portal) || portal.length > 500) { send(res, 400, 'text/plain', 'bad address'); return; }
    if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(mac)) { send(res, 400, 'text/plain', 'bad MAC address'); return; }
    var key = portal + '|' + mac, s = stalkerKeep(key), ctl = { gone: false, abort: null };
    leaving.push(function () { ctl.gone = true; if (ctl.abort) { ctl.abort(); } });
    function json(o) { send(res, 200, 'application/json', JSON.stringify(o)); }
    if (path === '/stalker/link') {
        var u = String(q.u || '');
        if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 2000) { send(res, 400, 'text/plain', 'bad link'); return; }
        stalkerWith(s, portal, mac, ctl, function (ss, done) {
            var cmd = ss.cmds[u] || 'ffmpeg ' + u;   // (a session opened after a restart: as most portals write it)
            stalkerAsk(ss, 'type=itv&action=create_link&cmd=' + encodeURIComponent(cmd) + '&series=&forced_storage=0&disable_ad=0&download=0&force_ch_link_check=0', ctl, function (err, js) {
                if (err) { done(err); return; }
                var m = /(https?:\/\/[^\s"]+)/i.exec(String((js && js.cmd) || ''));
                done(m ? null : upError('the portal gave no link for this channel', 502), m ? m[1] : null);
            });
        }, function (err, link) { json(err ? { why: err.message || 'failed' } : { url: link }); });
        return;
    }
    if (path === '/stalker/play') {   // (a film's or episode's link: asked now, and sent there)
        var cmd = String(q.cmd || ''), ep = /^\d{1,4}$/.test(q.ep || '') ? +q.ep : -1;
        if (!stalkerCmdOk(cmd)) { send(res, 400, 'text/plain', 'bad title'); return; }
        stalkerWith(s, portal, mac, ctl, function (ss, done) { stalkerVodLink(ss, cmd, ep, ctl, done); }, function (err, link) {
            if (err) { log('Stalker: no link for a title (' + (err.message || 'failed') + ')'); send(res, 502, 'text/plain', err.message || 'failed'); return; }
            res.writeHead(302, { 'Location': link, 'Cache-Control': 'no-store' });
            res.end();
        });
        return;
    }
    if (path === '/stalker/vod') {
        var type = q.type === 'series' ? 'series' : 'movie', what = String(q.do || '');
        if (q.fresh === '1') { s.vodCats = null; s.vodKept = null; s.vodOrder = null; }   // (Reload: all of it read again)
        var vkey = what === 'list' || what === 'seasons' ? [what, type, q.cat || '*', String(q.q || '').trim().slice(0, 120), parseInt(q.skip, 10) || 0, q.id || '', q.via || ''].join('|') : '';
        var keepMs = stalkerKeepMs(q);
        if (!keepMs) { vkey = ''; }   // (not kept: asked each time)
        var kept = vkey && stalkerKept(s, vkey, keepMs);
        if (kept) { json(kept); return; }
        stalkerWith(s, portal, mac, ctl, function (ss, done) {
            if (what === 'cats') { stalkerVodCats(ss, type, ctl, function (err, list) { done(err, { cats: list }); }); return; }
            if (what === 'list') {
                var cat = /^[\w.-]{1,40}$/.test(q.cat || '') ? q.cat : '*', words = String(q.q || '').trim().slice(0, 120), skip = Math.min(parseInt(q.skip, 10) || 0, 100000);
                stalkerVodList(ss, type, cat, words, skip, ctl, done);
                return;
            }
            if (what === 'seasons' && /^[\w-]{1,40}$/.test(q.id || '')) { stalkerSeasons(ss, q.id, q.via === 'vod', ctl, function (err, l) { done(err, { seasons: l }); }); return; }
            done(upError('bad request', 400));
        }, function (err, r) {
            if (!err && vkey) { stalkerKeepVod(s, vkey, r); }   // (an error isn't kept: asked again next time)
            json(err ? { why: err.message || 'failed' } : r);
        });
        return;
    }
    if (path === '/stalker/genres') {
        stalkerWith(s, portal, mac, ctl, function (ss, done) { stalkerAsk(ss, 'type=itv&action=get_genres', ctl, done); }, function (err, js) {
            if (err) { json({ why: err.message || 'failed' }); return; }
            json({ genres: (Array.isArray(js) ? js : []).filter(function (x) { return x && x.id != null && x.id !== '*' && x.title; }).slice(0, STALKER_GENRES).map(function (x) { return { id: String(x.id).slice(0, 40), title: String(x.title).slice(0, 100) }; }) });
        });
        return;
    }
    var picks = String(q.genres || '').split(',').filter(function (x) { return /^[\w.-]{1,40}$/.test(x); }).slice(0, STALKER_GENRES), wanted = picks.join(',');
    var whole = q.all === '1', sock = req.socket;
    if (whole && sock && sock.setTimeout) {   // (a read of many minutes: Node's two idle minutes would end it)
        sock.setTimeout(0);
        if (res.on) { res.on('finish', function () { sock.setTimeout(120000); }); }
    }
    function listed(l) { var o = { m3u: l.m3u, count: l.count }; if (l.cut) { o.cut = l.cut; } return o; }
    if (s.list && Date.now() - s.list.at < STALKER_LIST_MS && s.list.genres === wanted && (s.list.whole || !whole)) { json(listed(s.list)); return; }
    stalkerWith(s, portal, mac, ctl, function (ss, done) {
        stalkerChannels(ss, ctl, whole, picks, function (err, list, genres, cut) {
            var m = err ? null : stalkerM3u(ss, list, genres);
            if (m && cut) { m.cut = cut; }
            done(err, m);
        });
    }, function (err, r) {
        if (err) {
            var refused = err.auth || err.status === 401 || /^not a Stalker answer/.test(err.message || '') && !!s.token;
            json(refused ? { refused: true, why: s.block || 'the portal refused that MAC address' } : { unreachable: true, why: err.message || 'failed' });
            return;
        }
        if (!r.count) { json({ refused: true, why: s.block || (picks.length ? 'the portal listed no channels in the groups you chose' : 'the portal listed no channels for that MAC address') }); return; }
        s.list = { at: Date.now(), m3u: r.m3u, count: r.count, cut: r.cut || null, whole: whole, genres: wanted };
        json(listed(s.list));
    });
}

// ---- A DRM channel's license (/drm/license) ----
// A Widevine channel's license request, posted to the license server its playlist names, with the
// playlist's headers for it (a web page can't send a User-Agent, a Cookie…, and some servers refuse
// its origin), its answer sent back in base64. The player hands over the request and installs the
// answer (see js/player-core.js, drmSetup). POSTed: { u: the license server, h: { name: value },
// c: the request, base64, b64: the answer is base64 already }; the token, or the guide ticket.
var DRM_BODY_MAX = 65536, DRM_MS = 15000, DRM_MAX = 1048576;
var DRM_NOT = /^(host|content-length|connection|transfer-encoding|keep-alive|upgrade|te|trailer|proxy-.*)$/i;
function drmControl(req, res, query, body, leaving) {
    if (!entryAllowed(req, query) && !hasTicket(query)) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }
    var o = null;
    try { o = JSON.parse(body); } catch (e) { o = null; }
    function json(x) { send(res, 200, 'application/json', JSON.stringify(x)); }
    var u = o && typeof o.u === 'string' ? o.u : '', c = o && typeof o.c === 'string' ? o.c : '', pu = null;
    try { pu = urllib.parse(u); } catch (e) { pu = null; }
    if (!pu || (pu.protocol !== 'http:' && pu.protocol !== 'https:') || u.length > 2000 || !dlHostOk(pu.hostname)) { json({ why: 'not a license server StremioK can reach' }); return; }
    if (!c || !/^[A-Za-z0-9+\/=]+$/.test(c)) { json({ why: 'no license request' }); return; }
    var data = HAS_BUFFER_FROM ? Buffer.from(c, 'base64') : new Buffer(c, 'base64'), h = { 'Content-Type': 'application/octet-stream', 'User-Agent': TV_UA, 'Accept': '*/*' };
    Object.keys((o.h && typeof o.h === 'object') ? o.h : {}).slice(0, 16).forEach(function (k) {
        var v = o.h[k];
        if (/^[A-Za-z0-9-]{1,40}$/.test(k) && !DRM_NOT.test(k) && typeof v === 'string' && v.length <= 1000 && !/[\r\n]/.test(v)) { h[k] = v; }
    });
    h['Content-Length'] = data.length;
    var done = false, r = null, chunks = [], size = 0;
    var timer = setTimeout(function () { finish({ why: 'the license server didn\'t answer' }); }, DRM_MS);
    function finish(x) { if (done) { return; } done = true; clearTimeout(timer); try { if (x.why && r) { r.abort(); } } catch (e) {} if (x.why) { log('DRM: no license (' + x.why + ')'); } json(x); }
    leaving.push(function () { done = true; clearTimeout(timer); try { if (r) { r.abort(); } } catch (e) {} });
    var opts = { hostname: pu.hostname, port: pu.port, path: pu.path, method: 'POST', headers: h };
    if (pu.protocol === 'https:' && caList().length) { opts.ca = caList(); }
    try {
        r = (pu.protocol === 'https:' ? https : http).request(opts, function (resp) {
            var sc = resp.statusCode;
            resp.on('data', function (b) { if (done) { return; } chunks.push(b); size += b.length; if (size > DRM_MAX) { finish({ why: 'too large an answer' }); } });
            resp.on('end', function () {
                if (done) { return; }
                var all = Buffer.concat(chunks, size);
                if (sc !== 200) { finish({ why: 'HTTP ' + sc + (all.length && all.length < 200 ? ': ' + all.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 120) : '') }); return; }
                if (!all.length) { finish({ why: 'an empty answer' }); return; }
                finish({ license: o.b64 ? all.toString('utf8').trim() : all.toString('base64') });
            });
            resp.on('error', function (e) { finish({ why: e.message || 'failed' }); });
        });
        r.on('error', function (e) { finish({ why: 'couldn\'t reach it (' + (e.code || e.message) + ')' }); });
        guardSelf(r, function () { finish({ why: 'an address it can\'t reach' }); });
        r.end(data);
    } catch (e) { finish({ why: e.message || 'failed' }); }
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
    xtvSweep();
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
function epgSavedFiles(re) {
    var d = tokenDir(), fs = require('fs'), out = { count: 0, bytes: 0 };
    if (!d) { return out; }
    try {
        fs.readdirSync(d).filter(function (n) { return (re || /^epg-[0-9a-z]+\.json(\.part)?$/).test(n); }).forEach(function (n) {
            try { var st = fs.statSync(d + '/' + n); out.count++; out.bytes += st.size; out.names = (out.names || []).concat(n); } catch (e) {}
        });
    } catch (e) {}
    return out;
}
function epgClear() {
    var d = tokenDir(), files = epgSavedFiles(), lists = epgSavedFiles(XTV_FILES);
    (files.names || []).concat(lists.names || []).forEach(function (n) { try { require('fs').unlinkSync(d + '/' + n); } catch (e) {} });
    _epg = Object.create(null); _epgQueue = [];   // (one being read: not saved, see epgPump)
    _xtv = Object.create(null); _xtvQueue = [];   // (the Xtream lists: read again when asked for)
    return files.count + lists.count;
}
function epgControl(req, res, path, query) {
    if (!entryAllowed(req, query) && !(req.method === 'POST' && hasTicket(query))) { send(res, 403, 'text/plain', 'not allowed (token)'); return; }   // (the guide ticket: its POSTs, see hasTicket)
    if (path === '/epg/ticket') {
        if (req.method !== 'GET' || (req.headers && req.headers.origin !== undefined)) { send(res, 403, 'text/plain', 'not allowed'); return; }
        send(res, 200, 'application/json', JSON.stringify({ ticket: _epgTicket }));
        return;
    }
    if (path === '/epg/files') { var sf = epgSavedFiles(), xf = epgSavedFiles(XTV_FILES); send(res, 200, 'application/json', JSON.stringify({ count: sf.count, bytes: sf.bytes, xtv: { count: xf.count, bytes: xf.bytes } })); return; }
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
// A configuration file: pasted on the import's page (CONFIG_MAX, sent %-encoded: 3 times that), or
// given by the TV to the export's page (GIVE_MAX, POSTed to /entry/give), shown to copy or download.
var CONFIG_MAX = 1572864, GIVE_MAX = 1572864;   // (1.5 MB: a file with your history too; the page reads it as JSON, 2 MB at most)
var ENTRY_OPEN_MAX = 2, ENTRY_OPENS = 12, ENTRY_CONNECTIONS = 8, ENTRY_VISIT_MS = 20000, ENTRY_QUIET_MS = 10000;
var ENTRY_TITLES = { link: 'Play a link on StremioK', addon: 'Add an addon to StremioK', playlist: 'Add an IPTV playlist to StremioK', config: 'Import a configuration file into StremioK', give: 'Your StremioK configuration', givelog: 'Your StremioK logs',
    search: 'Search on StremioK', youtube: 'Add a YouTube catalog to StremioK', aiom: 'Your AIOManager address for StremioK', aiomkey: 'Your AIOManager API key for StremioK',
    server: 'Your streaming server’s address for StremioK', mac: 'Your Stalker portal’s MAC address for StremioK', webdav: 'Your network folder’s address for StremioK',
    jellyfin: 'Your media server’s address for StremioK', plugins: 'Add a Nuvio plugin repository to StremioK' };
var ENTRY_TEXT = { search: 'Words to search for', youtube: 'A channel, a playlist link, or words to search YouTube for', aiomkey: 'Your account API key', mac: 'Its MAC address (00:1A:79:…)' };   // (plain text, not a link)
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
function entryControl(req, res, path, query, body) {
    if (!entryAllowed(req, query) && !(path === '/entry/give' && hasTicket(query))) { send(res, 403, 'text/plain', 'not allowed'); return; }   // (the export's POST: the guide ticket too)
    var tm = /(?:^|&)t=([0-9a-f]{32})(?:&|$)/.exec(query || ''), token = tm ? tm[1] : '';
    if (path === '/entry/open' || path === '/entry/give') {
        if (path === '/entry/give' && !String(body || '').trim()) { send(res, 400, 'text/plain', 'nothing to give'); return; }
        var now = Date.now();
        _entryOpened = _entryOpened.filter(function (x) { return now - x < 60000; });
        if (_entryOpened.length >= ENTRY_OPENS) { send(res, 429, 'text/plain', 'too many, try again in a minute'); return; }
        var wm = /(?:^|&)what=([a-z]{1,12})(?:&|$)/.exec(query || ''), what = path === '/entry/give' ? (/(?:^|&)kind=logs(?:&|$)/.test(query || '') ? 'givelog' : 'give') : wm && ENTRY_TITLES[wm[1]] && !/^give/.test(wm[1]) ? wm[1] : 'link';   // (an export: a configuration, or the logs)
        var ip = lanAddress();
        if (!ip) { send(res, 503, 'text/plain', 'no home network address'); return; }
        _entryOpened.push(now);
        var open = Object.keys(_entries).sort(function (a, b) { return _entries[a].at - _entries[b].at; });
        while (open.length >= ENTRY_OPEN_MAX) { entryDrop(open.shift(), true); }   // (the oldest goes)
        var t = crypto.randomBytes(16).toString('hex');
        _entries[t] = { what: what, text: null, sent: false, at: now, timer: setTimeout(function () { entryDrop(t); }, ENTRY_MS), idle: null, give: /^give/.test(what) ? String(body) : null, seen: false };
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
        send(res, 200, 'application/json', JSON.stringify(e.give !== null ? { seen: e.seen } : { text: text }));   // (an export: whether the phone has it)
        return;
    }
    if (path === '/entry/close') { entryDrop(token); send(res, 200, 'text/plain', 'closed'); return; }
    send(res, 404, 'text/plain', 'not found');
}
function entryHtml(title, body) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + title + '</title><style>body{font-family:-apple-system,Roboto,sans-serif;background:#0e1117;color:#e6e9ef;margin:0;padding:24px}' +
        'h1{font-size:22px;margin:0 0 16px}input,textarea{width:100%;box-sizing:border-box;font-size:17px;padding:12px;border-radius:10px;border:1px solid #2a3346;background:#161b26;color:#e6e9ef}' +
        'button{margin-top:14px;width:100%;font-size:17px;padding:12px;border:0;border-radius:10px;background:#818cf8;color:#0e1117;font-weight:600}p{color:#9aa3b5;font-size:15px}</style></head><body>' +
        '<h1>' + title + '</h1>' + body + '</body></html>';
}
function entryPage(req, res) {
    try {
        res.setHeader('Cache-Control', 'no-store');
        var m = /^\/e\/([0-9a-f]{32})(\/stremiok(?:-logs)?\.txt)?$/.exec(String(req.url || '')), e = m && _entries[m[1]];
        if (!e || e.sent) { send(res, 404, 'text/plain', 'Not here (it was used, or the TV closed it)'); return; }
        var title = ENTRY_TITLES[e.what];
        if (e.give !== null) {   // (an export: the file to copy, or download)
            if (req.method !== 'GET') { send(res, 405, 'text/plain', 'GET only'); return; }
            e.seen = true;
            var logs = e.what === 'givelog', fname = logs ? 'stremiok-logs.txt' : 'stremiok.txt';
            if (m[2]) { if (m[2] !== '/' + fname) { send(res, 404, 'text/plain', 'Not here'); return; } res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"'); send(res, 200, 'text/plain; charset=utf-8', e.give); return; }
            var esc = e.give.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            send(res, 200, 'text/html; charset=utf-8', entryHtml(title, (logs ? '<p>StremioK\'s recent problems and how long it took to start, with its version and the TV\'s. Keys and passwords are masked; still, look it over before sharing it publicly.</p>' +
                '<p>To report a problem: open an issue at <a href="https://github.com/Kepler75/StremioK/issues">github.com/Kepler75/StremioK/issues</a>, say what you did, what you expected and what happened instead, and attach this file (Download).</p>'
                : '<p>It holds your addon links, playlist logins, API keys and MAC addresses: keep it somewhere private. To restore it: Settings › Content › Import configuration file, ▣ From your phone, then choose this file there (or paste it).</p>') +
                '<textarea id="f" readonly rows="12">' + esc + '</textarea><button type="button" onclick="var f=document.getElementById(\'f\');f.focus();f.select();try{document.execCommand(\'copy\');this.textContent=\'Copied\';}catch(x){}">Copy</button>' +
                '<a href="/e/' + m[1] + '/' + fname + '" download="' + fname + '"><button type="button">Download</button></a><p>It came over your home network <b>unencrypted</b>. This page closes when the TV stops showing its code.</p>'));
            return;
        }
        if (m[2]) { send(res, 404, 'text/plain', 'Not here'); return; }
        var config = e.what === 'config', max = config ? CONFIG_MAX * 3 : ENTRY_MAX;   // (a pasted file: its lines kept, %-encoded as sent)
        if (req.method === 'GET' && config) {   // (its link, as before; or the file itself, chosen from the phone's files or pasted)
            send(res, 200, 'text/html; charset=utf-8', entryHtml(title, '<form method="post"><p>A link to the file</p><input name="link" type="url" autocomplete="off" placeholder="https://…">' +
                '<p>Or the file itself (an export\'s stremiok.txt)</p><input id="pick" type="file" accept=".txt,.cfg,.conf,text/plain">' +
                '<textarea id="f" name="text" rows="8" autocomplete="off" placeholder="…or paste it here"></textarea>' +
                '<button type="submit">Send to the TV</button></form><p>It goes straight to your TV over your home network, <b>unencrypted</b>: use this only on a network you trust (a configuration file holds your tokens, passwords and keys). This page stops working once it has been sent.</p>' +
                '<script>document.getElementById("pick").onchange=function(){var f=this.files&&this.files[0];if(!f){return;}var r=new FileReader();r.onload=function(){document.getElementById("f").value=r.result;};r.readAsText(f);};</script>'));
            return;
        }
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
            if (size > max) { done = true; send(res, 413, 'text/plain', 'Too long'); return; }   // (the rest read and dropped: the connection stays usable)
            body += c;
        });
        req.on('end', function () {
            if (done) { return; }
            done = true;
            var tm = /(?:^|&)text=([^&]*)/.exec(body), lm = config && /(?:^|&)link=([^&]*)/.exec(body), text = '';
            try { text = tm ? decodeURIComponent(tm[1].replace(/\+/g, ' ')) : ''; } catch (e3) { text = ''; }
            if (!text.trim() && lm) { try { text = decodeURIComponent(lm[1].replace(/\+/g, ' ')); } catch (e4) { text = ''; } }   // (a link to the file, as before)
            text = config ? text.replace(/\r\n?/g, '\n').trim().slice(0, CONFIG_MAX) : text.replace(/[\r\n\t]+/g, ' ').trim();
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
