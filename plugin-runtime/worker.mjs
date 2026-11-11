// StremioK's Nuvio plugins runtime: a Web Worker that runs one plugin at a time in a fresh
// QuickJS (WebAssembly) context. Built into js/vendor/quickjs/plugin-worker.js by build.js
// (bundled with quickjs-emscripten, lowered to the TV's engine); js/plugins.js starts it.
//
// Inside QuickJS a plugin sees nothing of StremioK's: no DOM, no storage, no keys but the TMDB
// key it's handed, no service token. What it gets (the plugin interface Nuvio defines):
// module / exports / require ('cheerio' and its two other names, 'crypto-js'), fetch (through
// StremioK's service, which applies the home-network rule), console, setTimeout / clearTimeout /
// setInterval / clearInterval, URL, URLSearchParams, atob / btoa, AbortController,
// SCRAPER_ID, SCRAPER_SETTINGS, TMDB_API_KEY. A run: 64 MB, the time it's given (an interrupt
// stops endless loops), 40 requests, its results as plain data.
// cheerio runs here, natively, not inside QuickJS (many times faster: a 200 KB page in tens of
// milliseconds instead of tens of seconds on an old TV): the plugin's require('cheerio') is a
// stand-in (cheerio-shim.js) that reaches it through one function, given only to that stand-in,
// passing text and numbers (cheerioBridge).
//
// Messages: in { type: 'run', id, code, scraperId, args: [tmdbId, mediaType, season, episode],
//   tmdbKey, net: { url, headers }, timeoutMs, maxResults }
// out { type: 'done', id, streams, logs, ms } | { type: 'failed', id, why, logs, ms }
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import base from '@jitl/quickjs-wasmfile-release-sync';
import { load as cheerioLoad } from 'cheerio/slim';

const MEMORY = 64 * 1024 * 1024, STACK = 1024 * 1024, MAX_FETCHES = 40, MAX_LOGS = 60, LOG_LEN = 300;
const LIBS = { 'crypto-js': 'crypto-js.js' };
const CHEERIO_SHIM = __CHEERIO_SHIM__;   // (cheerio-shim.js, put in by build.js)
const MAX_PAGES = 20, MAX_SELECTIONS = 200000, MAX_PAGE = 2 * 1048576;
// What a plugin may ask of cheerio (anything else is refused): methods that give a selection,
// and those that give a value.
const CHEERIO_METHODS = new Set(['find', 'children', 'parent', 'parents', 'parentsUntil', 'closest', 'next', 'prev', 'nextAll', 'prevAll', 'nextUntil', 'prevUntil', 'siblings', 'eq', 'first', 'last', 'not', 'has',
  'slice', 'contents', 'end', 'addBack', 'add', 'filter', 'text', 'html', 'attr', 'val', 'data', 'hasClass', 'is', 'index', 'prop']);
const ALIASES = { 'cheerio-without-node-native': 'cheerio', 'react-native-cheerio': 'cheerio' };
let _qjs = null, _libText = {};

// Two builds of this file (build.js): WebAssembly QuickJS for Chromium 76 and later, and
// (__LEGACY__) QuickJS compiled to plain JavaScript, lowered to Chromium 47, for older engines.
function engine() {
  if (!_qjs) { _qjs = newQuickJSWASMModuleFromVariant(__LEGACY__ ? base : newVariant(base, { wasmLocation: new URL('quickjs.wasm', self.location.href).href })); }
  return _qjs;
}
const now = () => Date.now();
// A request (XMLHttpRequest: an old engine's fetch can't read the app's own files): { status, text }.
function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    Object.keys(headers || {}).forEach((k) => x.setRequestHeader(k, headers[k]));
    x.onload = () => resolve({ status: x.status, text: x.responseText || '' });
    x.onerror = () => reject(new Error('network error'));
    x.send(body === undefined ? null : body);
  });
}
function libText(name) {
  if (_libText[name]) { return Promise.resolve(_libText[name]); }
  return request('GET', new URL(LIBS[name], self.location.href).href).then((r) => {
    if (r.status !== 200 && !(r.status === 0 && r.text)) { throw new Error('library ' + name + ': HTTP ' + r.status); }
    _libText[name] = r.text;
    return r.text;
  });
}
// The libraries a plugin's code names (require('…')), read before it runs: require is synchronous.
function libsFor(code) {
  const want = new Set();   // (cheerio isn't read: it's here already)
  String(code).replace(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m, n) => { const k = ALIASES[n] || n; if (LIBS[k]) { want.add(k); } return m; });
  return Array.from(want);
}

// What the plugin's world looks like, written in the plugin's own language (QuickJS runs it).
const PRELUDE = String.raw`
(function (g) {
  'use strict';
  var hostFetch = g.__hostFetch, hostLog = g.__hostLog, hostWait = g.__hostWait, hostLib = g.__hostLib, hostCheerio = g.__cheerio;
  delete g.__hostFetch; delete g.__hostLog; delete g.__hostWait; delete g.__hostLib; delete g.__cheerio;
  function str(v) { try { return typeof v === 'string' ? v : v instanceof Error ? v.name + ': ' + v.message : JSON.stringify(v); } catch (e) { return String(v); } }
  function say(level) { return function () { hostLog(level, Array.prototype.map.call(arguments, str).join(' ')); }; }
  g.console = { log: say('log'), info: say('log'), debug: say('log'), warn: say('warn'), error: say('error') };

  // timers: a host wait, then the callback (a cleared one doesn't run)
  var timers = {}, nextTimer = 1;
  function later(fn, ms, args, repeat) {
    var id = nextTimer++;
    timers[id] = true;
    (function tick() {
      hostWait(Math.max(0, +ms || 0)).then(function () {
        if (!timers[id]) { return; }
        if (!repeat) { delete timers[id]; }
        if (typeof fn === 'function') { fn.apply(null, args); }
        if (repeat && timers[id]) { tick(); }
      });
    })();
    return id;
  }
  g.setTimeout = function (fn, ms) { return later(fn, ms, Array.prototype.slice.call(arguments, 2), false); };
  g.setInterval = function (fn, ms) { return later(fn, Math.max(10, +ms || 0), Array.prototype.slice.call(arguments, 2), true); };
  g.clearTimeout = g.clearInterval = function (id) { delete timers[id]; };

  // base64
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  g.btoa = function (s) {
    s = String(s); var out = '', i = 0;
    for (; i < s.length; i += 3) {
      var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) { throw new Error('btoa: not Latin-1'); }
      out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4)) + (i + 1 < s.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : '=') + (i + 2 < s.length ? B64.charAt(c & 63) : '=');
    }
    return out;
  };
  g.atob = function (s) {
    s = String(s).replace(/[\s=]+/g, ''); var out = '', buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s.charAt(i)); if (v < 0) { throw new Error('atob: not base64'); }
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
    }
    return out;
  };

  // URLSearchParams and URL (what plugins use of them)
  function enc(s) { return encodeURIComponent(s).replace(/%20/g, '+'); }
  function dec(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } }
  function USP(init) {
    this._l = [];
    var self = this;
    if (init instanceof USP) { this._l = init._l.slice(); }
    else if (typeof init === 'string') { init.replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) { return; } var i = kv.indexOf('='); self._l.push(i < 0 ? [dec(kv), ''] : [dec(kv.slice(0, i)), dec(kv.slice(i + 1))]); }); }
    else if (init && typeof init === 'object') { (Array.isArray(init) ? init : Object.keys(init).map(function (k) { return [k, init[k]]; })).forEach(function (p) { self._l.push([String(p[0]), String(p[1])]); }); }
  }
  USP.prototype.append = function (k, v) { this._l.push([String(k), String(v)]); if (this._u) { this._u._sync(); } };
  USP.prototype.set = function (k, v) { k = String(k); var done = false; this._l = this._l.filter(function (p) { if (p[0] !== k) { return true; } if (done) { return false; } p[1] = String(v); done = true; return true; }); if (!done) { this._l.push([k, String(v)]); } if (this._u) { this._u._sync(); } };
  USP.prototype.get = function (k) { for (var i = 0; i < this._l.length; i++) { if (this._l[i][0] === String(k)) { return this._l[i][1]; } } return null; };
  USP.prototype.getAll = function (k) { return this._l.filter(function (p) { return p[0] === String(k); }).map(function (p) { return p[1]; }); };
  USP.prototype.has = function (k) { return this.get(k) !== null; };
  USP.prototype['delete'] = function (k) { this._l = this._l.filter(function (p) { return p[0] !== String(k); }); if (this._u) { this._u._sync(); } };
  USP.prototype.forEach = function (fn, that) { var self = this; this._l.slice().forEach(function (p) { fn.call(that, p[1], p[0], self); }); };
  USP.prototype.keys = function () { return this._l.map(function (p) { return p[0]; })[Symbol.iterator](); };
  USP.prototype.values = function () { return this._l.map(function (p) { return p[1]; })[Symbol.iterator](); };
  USP.prototype.entries = function () { return this._l.map(function (p) { return [p[0], p[1]]; })[Symbol.iterator](); };
  USP.prototype[Symbol.iterator] = USP.prototype.entries;
  USP.prototype.toString = function () { return this._l.map(function (p) { return enc(p[0]) + '=' + enc(p[1]); }).join('&'); };
  g.URLSearchParams = USP;

  var URL_RE = /^([a-z][a-z0-9+.\-]*:)\/\/(?:([^:@\/?#]*)(?::([^@\/?#]*))?@)?(\[[^\]]*\]|[^:\/?#]*)(?::(\d*))?([^?#]*)(\?[^#]*)?(#.*)?$/i;
  function dots(path) {
    var out = [];
    path.split('/').forEach(function (seg, i, all) {
      if (seg === '..') { if (out.length > 1) { out.pop(); } if (i === all.length - 1) { out.push(''); } }
      else if (seg === '.') { if (i === all.length - 1) { out.push(''); } }
      else { out.push(seg); }
    });
    var p = out.join('/');
    return p.charAt(0) === '/' ? p : '/' + p;
  }
  function URLx(input, baseUrl) {
    input = String(input).trim();
    var m = URL_RE.exec(input);
    if (!m) {
      if (baseUrl === undefined) { throw new TypeError('Invalid URL: ' + input); }
      var b = baseUrl instanceof URLx ? baseUrl : new URLx(baseUrl), rest;
      if (/^\/\//.test(input)) { return new URLx(b.protocol + input); }
      if (/^[a-z][a-z0-9+.\-]*:/i.test(input)) { throw new TypeError('Invalid URL: ' + input); }
      var origin = b.protocol + '//' + (b.username ? b.username + (b.password ? ':' + b.password : '') + '@' : '') + b.host;
      if (input.charAt(0) === '/') { rest = input; }
      else if (input.charAt(0) === '?') { rest = b.pathname + input; }
      else if (input.charAt(0) === '#') { rest = b.pathname + b.search + input; }
      else if (!input) { rest = b.pathname + b.search; }
      else { rest = b.pathname.replace(/[^\/]*$/, '') + input; }
      return new URLx(origin + rest);
    }
    this.protocol = m[1].toLowerCase(); this.username = m[2] || ''; this.password = m[3] || '';
    this.hostname = (m[4] || '').toLowerCase(); this.port = m[5] || '';
    if ((this.protocol === 'http:' && this.port === '80') || (this.protocol === 'https:' && this.port === '443')) { this.port = ''; }
    this.pathname = dots(m[6] || '/'); this.search = m[7] && m[7] !== '?' ? m[7] : ''; this.hash = m[8] && m[8] !== '#' ? m[8] : '';
    this.searchParams = new USP(this.search); this.searchParams._u = this;
  }
  URLx.prototype._sync = function () { var q = this.searchParams.toString(); this.search = q ? '?' + q : ''; };
  Object.defineProperty(URLx.prototype, 'host', { get: function () { return this.hostname + (this.port ? ':' + this.port : ''); } });
  Object.defineProperty(URLx.prototype, 'origin', { get: function () { return this.protocol + '//' + this.host; } });
  Object.defineProperty(URLx.prototype, 'href', { get: function () { return this.origin.replace('//', '//' + (this.username ? this.username + (this.password ? ':' + this.password : '') + '@' : '')) + this.pathname + this.search + this.hash; } });
  URLx.prototype.toString = URLx.prototype.toJSON = function () { return this.href; };
  g.URL = URLx;

  function AbortSignal() { this.aborted = false; this.onabort = null; }
  function AbortController() { this.signal = new AbortSignal(); }
  AbortController.prototype.abort = function () { if (!this.signal.aborted) { this.signal.aborted = true; if (typeof this.signal.onabort === 'function') { this.signal.onabort(); } } };
  g.AbortController = AbortController;

  // fetch: the request through StremioK's service; a Response with what plugins read
  function Headers(h) { var m = {}; if (h) { (h instanceof Headers ? h._list() : Array.isArray(h) ? h : Object.keys(h).map(function (k) { return [k, h[k]]; })).forEach(function (p) { m[String(p[0]).toLowerCase()] = String(p[1]); }); } this._m = m; }
  Headers.prototype.get = function (k) { var v = this._m[String(k).toLowerCase()]; return v === undefined ? null : v; };
  Headers.prototype.has = function (k) { return this._m[String(k).toLowerCase()] !== undefined; };
  Headers.prototype.set = function (k, v) { this._m[String(k).toLowerCase()] = String(v); };
  Headers.prototype.append = Headers.prototype.set;
  Headers.prototype['delete'] = function (k) { delete this._m[String(k).toLowerCase()]; };
  Headers.prototype._list = function () { var m = this._m; return Object.keys(m).map(function (k) { return [k, m[k]]; }); };
  Headers.prototype.forEach = function (fn, that) { var self = this; this._list().forEach(function (p) { fn.call(that, p[1], p[0], self); }); };
  Headers.prototype.entries = function () { return this._list()[Symbol.iterator](); };
  Headers.prototype[Symbol.iterator] = Headers.prototype.entries;
  g.Headers = Headers;
  g.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : input && (input.href || input.url) || String(input);
    var headers = init.headers instanceof Headers ? init.headers._m : new Headers(init.headers)._m;
    var body = init.body == null ? null : typeof init.body === 'string' ? init.body : init.body instanceof USP ? init.body.toString() : JSON.stringify(init.body);
    if (init.body instanceof USP && !headers['content-type']) { headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'; }
    if (init.signal && init.signal.aborted) { return Promise.reject(new Error('aborted')); }
    var ask = JSON.stringify({ url: String(url), method: String(init.method || 'GET').toUpperCase(), headers: headers, body: body, redirect: init.redirect === 'manual' ? 'manual' : 'follow' });
    return hostFetch(ask).then(function (text) {
      var r = JSON.parse(text), h = new Headers(r.headers || {}), used = false;
      function read() { if (used) { return Promise.reject(new TypeError('body already read')); } used = true; return Promise.resolve(r.body || ''); }
      return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText || '', url: r.url, redirected: !!r.redirected, headers: h,
        text: read, json: function () { return read().then(function (t) { return JSON.parse(t); }); },
        clone: function () { var c = Object.assign({}, this); used = false; return c; } };
    });
  };

  // require: the libraries the interface names, each run once per context
  var cache = {}, ALIAS = { 'cheerio-without-node-native': 'cheerio', 'react-native-cheerio': 'cheerio' };
  g.require = function (name) {
    var k = ALIAS[name] || name;
    if (cache[k]) { return cache[k].exports; }
    var text = hostLib(k);
    if (typeof text !== 'string') { throw new Error("Cannot find module '" + name + "'"); }
    var mod = { exports: {} };
    if (k === 'cheerio') { (new Function('module', 'exports', 'require', '__cheerio', text))(mod, mod.exports, g.require, hostCheerio); }   // (the bridge: to the stand-in only)
    else { (new Function('module', 'exports', 'require', text))(mod, mod.exports, g.require); }
    cache[k] = mod;
    return mod.exports;
  };
  g.global = g;
  g.module = { exports: {} };
  g.exports = g.module.exports;
})(globalThis);
`;

// One run's pages and selections, by number (gone with the run). op: load (the page as text),
// select, items (a selection's elements, each as its own), pick (some of them again), node (an
// element's own fields), call (an allowed method; selections as { sel: n }).
function cheerioBridge() {
  const pages = [], sels = [];
  function put(x) { if (sels.length >= MAX_SELECTIONS) { throw new Error('too many selections in one run'); } sels.push(x); return sels.length - 1; }
  function sel(n) { const s = sels[n]; if (!s) { throw new Error('no such selection'); } return s; }
  function page(n) { const p = pages[n]; if (!p) { throw new Error('no such page'); } return p; }
  function isSel(x) { return !!x && typeof x === 'object' && typeof x.toArray === 'function' && typeof x.length === 'number'; }
  function plain(v) { return v === undefined ? null : (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v; }
  return function (op, a, text) {
    if (op === 'load') {
      if (pages.length >= MAX_PAGES) { throw new Error('too many pages parsed in one run (' + MAX_PAGES + ')'); }
      if (text.length > MAX_PAGE) { throw new Error('a page over 2 MB'); }
      const $ = cheerioLoad(text); pages.push($);
      const root = $.root();
      return { doc: pages.length - 1, sel: put(root), n: root.length };
    }
    if (op === 'select') { const $ = page(a.doc), s = a.ctx != null ? $(String(a.sel), sel(a.ctx)) : $(String(a.sel)); return { sel: put(s), n: s.length }; }
    if (op === 'items') { const $ = page(a.doc); return { sels: sel(a.sel).toArray().map((e) => put($(e))) }; }
    if (op === 'pick') { const $ = page(a.doc), s = $((a.sels || []).map((n) => sel(n)[0]).filter(Boolean)); return { sel: put(s), n: s.length }; }
    if (op === 'node') { const e = sel(a.sel)[0]; return e ? { name: e.name || null, type: e.type || null, data: typeof e.data === 'string' ? e.data : null, attribs: Object.assign({}, e.attribs || {}) } : null; }
    if (op === 'call') {
      const m = String(a.m);
      if (!CHEERIO_METHODS.has(m)) { throw new Error('not a cheerio method a plugin may use: ' + m); }
      const args = (Array.isArray(a.args) ? a.args : []).map((x) => (x && typeof x === 'object' && typeof x.sel === 'number' ? sel(x.sel) : (x === null || ['string', 'number', 'boolean'].indexOf(typeof x) !== -1 ? x : undefined)));
      const s = sel(a.sel), r = s[m].apply(s, args);
      return isSel(r) ? { sel: put(r), n: r.length } : { v: plain(r) };
    }
    throw new Error('unknown cheerio request');
  };
}

async function run(msg) {
  const t0 = now(), logs = [];
  const QJS = await engine();
  const libs = {};
  for (const k of libsFor(msg.code)) { libs[k] = await libText(k); }
  const rt = QJS.newRuntime();
  rt.setMemoryLimit(MEMORY);
  rt.setMaxStackSize(STACK);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + msg.timeoutMs));
  const vm = rt.newContext();
  const open = new Set();   // (promises the plugin waits on: settled or dropped before the context goes)
  let fetches = 0, alive = true;
  function pump() { if (alive) { const r = rt.executePendingJobs(); if (r.error) { r.error.dispose(); } } }
  function deferred(work) {
    const d = vm.newPromise();
    open.add(d);
    work().then((value) => {
      if (!alive || !d.alive) { return; }
      const h = vm.newString(value); d.resolve(h); h.dispose();
    }, (err) => {
      if (!alive || !d.alive) { return; }
      const h = vm.newError(String((err && err.message) || err)); d.reject(h); h.dispose();
    }).then(() => { open.delete(d); if (d.alive) { d.dispose(); } pump(); });
    return d.handle.dup();   // (the caller frees what's returned: ours is kept until it's settled)
  }
  function fn(name, f) { const h = vm.newFunction(name, f); vm.setProp(vm.global, name, h); h.dispose(); }
  fn('__hostLog', (lh, th) => {
    if (logs.length < MAX_LOGS) { logs.push(vm.getString(lh) + ': ' + vm.getString(th).slice(0, LOG_LEN)); }
  });
  fn('__hostWait', (mh) => {
    const ms = Math.min(vm.getNumber(mh) || 0, msg.timeoutMs);
    return deferred(() => new Promise((res) => setTimeout(() => res(''), ms)));
  });
  fn('__hostLib', (nh) => {
    const k = vm.getString(nh);
    if (k === 'cheerio') { return vm.newString(CHEERIO_SHIM); }
    return Object.prototype.hasOwnProperty.call(libs, k) ? vm.newString(libs[k]) : vm.undefined;
  });
  const cheerioRun = cheerioBridge();
  fn('__cheerio', (oh, jh, th) => vm.newString(JSON.stringify(cheerioRun(vm.getString(oh), JSON.parse(vm.getString(jh)), th === undefined ? '' : vm.getString(th)))));
  fn('__hostFetch', (ah) => {
    const ask = vm.getString(ah);
    return deferred(() => {
      if (++fetches > MAX_FETCHES) { return Promise.reject(new Error('too many requests in one run (' + MAX_FETCHES + ')')); }
      const headers = Object.assign({ 'Content-Type': 'text/plain' }, msg.net.headers || {});   // (a simple request: no preflight)
      return request('POST', msg.net.url, headers, ask).then((r) => {
        if (r.status < 200 || r.status >= 300) { throw new Error(r.text.replace(/^failed: /, '') || 'HTTP ' + r.status); }
        return r.text;
      });
    });
  });
  const globals = { SCRAPER_ID: String(msg.scraperId || ''), SCRAPER_SETTINGS: {}, TMDB_API_KEY: String(msg.tmdbKey || '') };
  let result;
  try {
    try {
    vm.unwrapResult(vm.evalCode(PRELUDE, 'stremiok-prelude.js')).dispose();
    const gh = vm.unwrapResult(vm.evalCode('(' + JSON.stringify(globals) + ')'));
    for (const k of Object.keys(globals)) { const v = vm.getProp(gh, k); vm.setProp(vm.global, k, v); v.dispose(); }
    gh.dispose();
    vm.unwrapResult(vm.evalCode(String(msg.code), 'plugin-' + String(msg.scraperId || 'x').replace(/[^\w.-]/g, '_') + '.js')).dispose();
    const call = vm.unwrapResult(vm.evalCode(
      '(function (a) { var g = module.exports && typeof module.exports.getStreams === "function" ? module.exports.getStreams : globalThis.getStreams;' +
      ' if (typeof g !== "function") { throw new Error("no getStreams in this plugin"); }' +
      ' return Promise.resolve(g(a[0], a[1], a[2], a[3])).then(function (r) { return JSON.stringify(Array.isArray(r) ? r.slice(0, ' + (msg.maxResults | 0) + ') : []); }); })(' + JSON.stringify(msg.args) + ')', 'call.js'));
    const settled = vm.resolvePromise(call);
    call.dispose();
    pump();
    const timer = new Promise((res) => setTimeout(() => res({ timeout: true }), msg.timeoutMs + 250));
    const r = await Promise.race([settled, timer]);
    if (r.timeout) { throw new Error('took longer than ' + Math.round(msg.timeoutMs / 1000) + ' s'); }
    if (r.error) { const e = vm.dump(r.error); r.error.dispose(); throw new Error(e && e.message ? e.message : String(e)); }
    const text = vm.getString(r.value); r.value.dispose();
    result = JSON.parse(text);
    } catch (e) { const err = e instanceof Error ? e : new Error(String(e)); err.logs = logs; throw err; }
  } finally {
    alive = false;
    open.forEach((d) => { try { if (d.alive) { d.dispose(); } } catch (e) {} });
    let clean = true;
    try { vm.dispose(); rt.dispose(); } catch (e) { clean = false; }
    if (!clean) { _qjs = null; self.postMessage({ type: 'restart' }); }   // (something left inside: a new engine next time)
  }
  return { streams: result, logs, ms: Math.round(now() - t0) };
}

let _queue = Promise.resolve();
self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type !== 'run') { return; }
  _queue = _queue.then(() => run(msg).then((r) => {
    self.postMessage({ type: 'done', id: msg.id, streams: r.streams, logs: r.logs, ms: r.ms });
  }, (err) => {
    self.postMessage({ type: 'failed', id: msg.id, why: String((err && err.message) || err).slice(0, 300), logs: (err && err.logs) || [], ms: 0 });
  }));
};
