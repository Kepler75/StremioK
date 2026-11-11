#!/usr/bin/env node
'use strict';
// Builds js/vendor/quickjs/ (Nuvio plugins' runtime) from this folder: run `npm ci` here once,
// then `node build.js`. Nothing here is part of the app; what it writes is, unchanged afterwards.
//   plugin-worker.js  worker.mjs bundled with quickjs-emscripten (MIT) and cheerio (MIT; its htmlparser2
//                     build, run natively; cheerio-shim.js is what plugins see), lowered to the 2021
//                     TVs' engine (Chromium 76): the libraries themselves use newer syntax
//   quickjs.wasm      QuickJS compiled to WebAssembly (quickjs-emscripten's release build)
//   plugin-worker-legacy.js  the same Worker for older engines (below Chromium 76: Tizen 3 to 5.5):
//                     QuickJS compiled to plain JavaScript (quickjs-emscripten's asm.js build), the
//                     whole lowered with Babel to Chromium 47, a few missing built-ins filled in
//   crypto-js.js      crypto-js (MIT), as released, run inside QuickJS
//   LICENSES.md       every bundled library's license
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const OUT = path.join(__dirname, '..', 'js', 'vendor', 'quickjs');
const NM = path.join(__dirname, 'node_modules');
const pkg = (name) => JSON.parse(fs.readFileSync(path.join(NM, name, 'package.json'), 'utf8'));
const HEAD = (what) => '/* ' + what + '\n   Built by plugin-runtime/build.js (StremioK): don\'t change it here, rebuild it. Licenses: LICENSES.md */\n';

fs.mkdirSync(OUT, { recursive: true });
const SHIM = fs.readFileSync(path.join(__dirname, 'cheerio-shim.js'), 'utf8');
const worker = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'worker.mjs')], bundle: true, format: 'iife', platform: 'browser', mainFields: ['browser', 'module', 'main'], target: 'chrome76', write: false, logLevel: 'warning', legalComments: 'inline', define: { __CHEERIO_SHIM__: JSON.stringify(SHIM), __LEGACY__: 'false' } });
fs.writeFileSync(path.join(OUT, 'plugin-worker.js'), HEAD('StremioK\'s Nuvio plugins runtime (a Web Worker), with quickjs-emscripten ' + pkg('quickjs-emscripten-core').version + '.') + worker.outputFiles[0].text);
fs.copyFileSync(path.join(NM, '@jitl', 'quickjs-wasmfile-release-sync', 'dist', 'emscripten-module.wasm'), path.join(OUT, 'quickjs.wasm'));

// The legacy Worker: bundled (the asm.js QuickJS in place of the WebAssembly one; quickjs-emscripten's
// Node-only branch pointed at nomodule.mjs), then lowered with Babel to Chromium 47 (classes, spread,
// block scoping, parameters and destructuring always converted: 47 takes some of them only in strict
// code), with regenerator's runtime for async functions and the built-ins 47 lacks.
const legacy = esbuild.buildSync({ absWorkingDir: __dirname, entryPoints: [path.join(__dirname, 'worker.mjs')], bundle: true, format: 'iife', platform: 'browser', mainFields: ['browser', 'module', 'main'], target: 'es2017', write: false, logLevel: 'warning', legalComments: 'inline',
  define: { __CHEERIO_SHIM__: JSON.stringify(SHIM), __LEGACY__: 'true', 'import.meta.url': '""' },
  alias: { '@jitl/quickjs-wasmfile-release-sync': '@jitl/quickjs-asmjs-mjs-release-sync', module: path.join(__dirname, 'nomodule.mjs') } });
const babel = require('@babel/core');
const lowered = babel.transformSync(legacy.outputFiles[0].text, { cwd: __dirname, babelrc: false, configFile: false, compact: true, sourceType: 'script',
  presets: [[require.resolve('@babel/preset-env'), { targets: { chrome: '47' }, modules: false, exclude: ['transform-typeof-symbol'],
    include: ['transform-classes', 'transform-spread', 'transform-block-scoping', 'transform-parameters', 'transform-destructuring'] }]] }).code;
const FILL = `(function (g) {   // (built-ins Chromium 47 lacks and the bundle uses)
  if (typeof g.globalThis === 'undefined') { g.globalThis = g; }
  if (typeof Symbol !== 'undefined') { if (!Symbol.dispose) { Symbol.dispose = Symbol('Symbol.dispose'); } if (!Symbol.asyncDispose) { Symbol.asyncDispose = Symbol('Symbol.asyncDispose'); } }
  if (!Object.getOwnPropertyDescriptors) { Object.getOwnPropertyDescriptors = function (o) { var r = {}; Object.getOwnPropertyNames(o).concat(Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(o) : []).forEach(function (k) { r[k] = Object.getOwnPropertyDescriptor(o, k); }); return r; }; }
  if (!Object.entries) { Object.entries = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); }; }
  if (!Object.values) { Object.values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); }; }
  if (!Object.fromEntries) { Object.fromEntries = function (l) { var o = {}; Array.from(l).forEach(function (p) { o[p[0]] = p[1]; }); return o; }; }
  if (!String.prototype.padStart) { String.prototype.padStart = function (n, c) { var s = String(this); c = c === undefined ? ' ' : String(c); while (s.length < n) { s = c + s; } return s.slice(-Math.max(n, String(this).length)); }; }
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) { Promise.prototype.finally = function (f) { return this.then(function (v) { return Promise.resolve(f()).then(function () { return v; }); }, function (e) { return Promise.resolve(f()).then(function () { throw e; }); }); }; }
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(path.join(OUT, 'plugin-worker-legacy.js'), HEAD('StremioK\'s Nuvio plugins runtime for older engines (a Web Worker, Chromium 47 and up), with quickjs-emscripten ' + pkg('quickjs-emscripten-core').version + ' compiled to plain JavaScript, regenerator-runtime ' + pkg('regenerator-runtime').version + '.') +
  FILL + fs.readFileSync(require.resolve('regenerator-runtime/runtime.js', { paths: [__dirname] }), 'utf8') + '\n' + lowered);
if (fs.existsSync(path.join(OUT, 'cheerio.js'))) { fs.unlinkSync(path.join(OUT, 'cheerio.js')); }   // (since 2.3.5.5 cheerio runs in the Worker itself)
fs.writeFileSync(path.join(OUT, 'crypto-js.js'), HEAD('crypto-js ' + pkg('crypto-js').version + ', as released, for plugins: require(\'crypto-js\').') + fs.readFileSync(path.join(NM, 'crypto-js', 'crypto-js.js'), 'utf8'));

// The licenses of everything bundled (cheerio's own dependencies included)
const metafile = esbuild.buildSync({ stdin: { contents: "require('cheerio/slim');", resolveDir: __dirname }, bundle: true, platform: 'neutral', mainFields: ['module', 'main'], write: false, metafile: true, logLevel: 'silent' }).metafile;
const names = new Set(['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-asmjs-mjs-release-sync', '@jitl/quickjs-ffi-types', 'crypto-js', 'regenerator-runtime']);
Object.keys(metafile.inputs).forEach((f) => { const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(f); if (m) { names.add(m[1]); } });
let lic = '# Licenses of the Nuvio plugins runtime\n\nBundled, unchanged, in this folder (see plugin-runtime/build.js). QuickJS itself is by Fabrice\nBellard and Charlie Gordon (MIT), included in quickjs-emscripten\'s build.\n';
Array.from(names).sort().forEach((n) => {
  const dir = path.join(NM, n), p = pkg(n);
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  lic += '\n## ' + n + ' ' + p.version + ' (' + (p.license || 'see below') + ')\n\n';
  lic += file ? '```\n' + fs.readFileSync(path.join(dir, file), 'utf8').trim() + '\n```\n' : '(' + (p.license || 'no license file') + ', as its package says)\n';
});
fs.writeFileSync(path.join(OUT, 'LICENSES.md'), lic);
fs.readdirSync(OUT).forEach((f) => console.log(f.padEnd(18), fs.statSync(path.join(OUT, f)).size));
