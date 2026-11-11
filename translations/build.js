#!/usr/bin/env node
'use strict';
// StremioK's translations: translations/<code>.json, one per language (its `language` part and its
// `phrases`, English -> translation), checked and turned into what the TV loads:
//   js/lang/<code>.js        a language's translations (js/i18n.js loads it when it's chosen)
//   js/lang/languages.js     the languages Settings offers besides English: those at least 90%
//                            translated, with the TV languages each answers for and its plural rule
//   translations/template.json  every phrase StremioK shows, untranslated: a new language's start
// The phrases are read from js/: U.t('…'), U.tn(n, '…', '…'), and util.js's own t('…') and day and
// month names. New ones are added to each language's file as "" (untranslated, shown in English).
// Usage (from the project's folder):
//   node translations/build.js            check every file; if nothing's wrong, write the above
//   node translations/build.js --check    only check (writes nothing; out-of-date files are wrong)
//   node translations/build.js --prune    also drop phrases StremioK no longer shows
const fs = require('fs');
const path = require('path');

const MIN = 0.9;                                   // translated, for a language to be offered
// Each plural rule's forms besides one (the singular phrase's own translation): a plural phrase's
// translation is one text for all of them, or each by name ({ "few": "…", "many": "…" }).
const FORMS = { 'one': [], 'zero-one': [], 'none': [], 'slavic': ['few', 'many'], 'polish': ['few', 'many'],
  'hebrew': ['two', 'other'], 'arabic': ['zero', 'two', 'few', 'many', 'other'] };
const PLURALS = Object.keys(FORMS);
const CODE_RE = /^[a-z]{2,3}(-[A-Z]{2}|-[A-Z][a-z]{3})?$/;
const SKIP = /^(i18n|qrcode|polyfills)\.js$/;

// Every phrase written in js/, sorted; others: the plural phrases (U.tn's second).
function scan(root) {
  const LIT = "'((?:[^'\\\\\\n]|\\\\.)*)'";
  // a single-quoted literal's text as JSON text, in one pass: each escape kept (\' becomes '),
  // a bare " escaped
  const unq = (s) => JSON.parse('"' + s.replace(/\\([\s\S])|"/g, (m, c) => (c === undefined ? '\\"' : c === "'" ? "'" : m)) + '"');
  const out = new Set(), others = new Set();
  const dir = path.join(root, 'js');
  for (const f of fs.readdirSync(dir)) {
    if (!/\.js$/.test(f) || SKIP.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(new RegExp('U\\.t\\(\\s*' + LIT, 'g'))) out.add(unq(m[1]));
    for (const m of src.matchAll(new RegExp('U\\.tn\\([^\'()]*(?:\\([^\'()]*\\)[^\'()]*)*,\\s*' + LIT + '\\s*,\\s*' + LIT, 'g'))) { out.add(unq(m[1])); out.add(unq(m[2])); others.add(unq(m[2])); }
    if (f === 'util.js') {
      for (const m of src.matchAll(new RegExp('(?<![.\\w])t\\(\\s*' + LIT, 'g'))) out.add(unq(m[1]));
      for (const v of ['WDAYS', 'MONTHS']) {
        const a = new RegExp('var ' + v + ' = \\[([^\\]]*)\\]').exec(src);
        if (a) for (const m of a[1].matchAll(new RegExp(LIT, 'g'))) out.add(unq(m[1]));
      }
    }
  }
  return { list: [...out].sort(), others: [...others].sort() };
}
const phrases = (root) => scan(root).list;
const pluralOthers = (root) => scan(root).others;

const names = (s) => (s.match(/\{\w+\}/g) || []).sort().join(' ');
const cut = (s) => (s.length > 70 ? s.slice(0, 67) + '…' : s);

// One language's file, against the phrases shown: { errors, dict (its translations), translated,
// missing, unknown, coverage }.
function check(file, code, list, others) {
  const errors = [], dict = {}, missing = [], unknown = [];
  const want = new Set(list), plural = new Set(others || []);
  const L = file && file.language;
  if (!L || typeof L !== 'object') errors.push('no "language" part');
  else {
    if (L.code !== code) errors.push('"code" is ' + JSON.stringify(L.code) + ': it must be the file\'s name, ' + JSON.stringify(code));
    if (!CODE_RE.test(code) || code === 'en') errors.push('"' + code + '" isn\'t a language code such as fr or fr-CA');
    if (typeof L.name !== 'string' || !L.name.trim()) errors.push('"name" is missing: the language\'s name in itself');
    if (!Array.isArray(L.matches) || !L.matches.every((m) => typeof m === 'string' && m)) errors.push('"matches" must be a list of TV languages, such as ["fr"]');
    if (PLURALS.indexOf(L.plural) < 0) errors.push('"plural" must be one of ' + PLURALS.map((p) => '"' + p + '"').join(', '));
    if (L.direction !== undefined && L.direction !== 'rtl') errors.push('"direction" can only be "rtl" (right to left), or left out');
  }
  const forms = (L && FORMS[L.plural]) || [];
  const same = (k, v, what) => {
    if (names(v) !== names(k)) errors.push('"' + cut(k) + '"' + what + ': its {names} must be the English\'s (' + (names(k) || 'none') + '), not ' + (names(v) || 'none'));
    if (/^\s/.test(k) !== /^\s/.test(v)) errors.push('"' + cut(k) + '"' + what + ': it must ' + (/^\s/.test(k) ? '' : 'not ') + 'start with a space, as the English does');
    if (/\s$/.test(k) !== /\s$/.test(v)) errors.push('"' + cut(k) + '"' + what + ': it must ' + (/\s$/.test(k) ? '' : 'not ') + 'end with a space, as the English does');
  };
  const ph = file && file.phrases;
  if (!ph || typeof ph !== 'object' || Array.isArray(ph)) errors.push('no "phrases" part');
  else {
    for (const k of Object.keys(ph)) {
      const v = ph[k];
      if (!want.has(k)) { unknown.push(k); errors.push('"' + cut(k) + '": StremioK doesn\'t show this phrase (was its English changed?)'); continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!plural.has(k) || !forms.length) { errors.push('"' + cut(k) + '": only a plural phrase in a language with more than two forms takes forms by name'); continue; }
        const n0 = errors.length;
        Object.keys(v).forEach((f) => { if (forms.indexOf(f) < 0) errors.push('"' + cut(k) + '": "' + f + '" isn\'t one of this language\'s forms (' + forms.join(', ') + ')'); });
        forms.forEach((f) => {
          if (typeof v[f] !== 'string' || !v[f]) errors.push('"' + cut(k) + '": its "' + f + '" form is missing');
          else same(k, v[f], ' (' + f + ')');
        });
        if (errors.length === n0) dict[k] = v;
        continue;
      }
      if (typeof v !== 'string') { errors.push('"' + cut(k) + '": its translation must be text, in quotes'); continue; }
      if (v === '') continue;
      const n1 = errors.length;
      same(k, v, '');
      if (errors.length !== n1) continue;
      dict[k] = v;
    }
  }
  for (const k of list) if (!(k in dict)) missing.push(k);
  const translated = Object.keys(dict).length;
  return { errors, dict, missing, unknown, translated, coverage: list.length ? translated / list.length : 1 };
}
const offered = (r) => r.errors.length === 0 && r.coverage >= MIN;

// JSON with the phrases in the shown order (an object's own key order can't be trusted for
// keys that look like numbers).
const val = (v) => (v && typeof v === 'object' ? '{ ' + Object.keys(v).map((f) => JSON.stringify(f) + ': ' + JSON.stringify(v[f])).join(', ') + ' }' : JSON.stringify(v));
function fileText(language, ph, list) {
  const body = list.map((k) => '    ' + JSON.stringify(k) + ': ' + val(ph[k] === undefined ? '' : ph[k])).join(',\n');
  return '{\n  "language": ' + JSON.stringify(language, null, 2).replace(/\n/g, '\n  ') + ',\n  "phrases": {\n' + body + '\n  }\n}\n';
}
function langJs(code, name, dict, list) {
  const body = list.filter((k) => k in dict).map((k) => '    ' + JSON.stringify(k) + ': ' + val(dict[k])).join(',\n');
  return '/* StremioK in ' + name + '. Written by translations/build.js from translations/' + code + '.json:\n' +
    '   change that file, not this one. A phrase missing here shows in English. */\n' +
    'I18N.add(' + JSON.stringify(code) + ', {\n' + body + '\n});\n';
}
function languagesJs(langs) {
  const rows = langs.map((L) => '    { code: ' + JSON.stringify(L.code) + ', name: ' + JSON.stringify(L.name) + ', matches: ' + JSON.stringify(L.matches) + ', plural: ' + JSON.stringify(L.plural) + (L.direction ? ', direction: ' + JSON.stringify(L.direction) : '') + ' }');
  return '/* The languages StremioK offers besides English (Settings › Appearance › Language): those at\n' +
    '   least ' + Math.round(MIN * 100) + '% translated. Written by translations/build.js from translations/*.json: change\n' +
    '   those, not this. Each answers for the TV languages it matches (the closest wins) and says\n' +
    '   how numbers change its words (and whether it runs right to left). Global: I18N_LANGS (read by js/i18n.js) */\n' +
    'var I18N_LANGS = [\n' + rows.join(',\n') + '\n];\n';
}

function run(root, opts) {
  const sc = scan(root), list = sc.list;
  const tdir = path.join(root, 'translations'), ldir = path.join(root, 'js', 'lang');
  const writes = {}, errors = [], report = [], langs = [];
  writes[path.join(tdir, 'template.json')] = fileText({ code: '', name: '', matches: [], plural: 'one' }, {}, list);
  const files = fs.readdirSync(tdir).filter((f) => /\.json$/.test(f) && f !== 'template.json').sort();
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    let file;
    try { file = JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8')); } catch (e) { errors.push(f + ': not valid JSON (' + e.message + ')'); continue; }
    if (opts.prune && file && file.phrases && typeof file.phrases === 'object') {
      const keep = new Set(list);
      Object.keys(file.phrases).forEach((k) => { if (!keep.has(k)) delete file.phrases[k]; });
    }
    const r = check(file, code, list, sc.others);
    r.errors.forEach((e) => errors.push(f + ': ' + e));
    if (r.errors.length) continue;
    const pct = Math.floor(r.coverage * 1000) / 10;
    const ok = offered(r);
    report.push(code + ' (' + file.language.name + '): ' + pct + '% translated (' + r.translated + ' of ' + list.length + ')' + (ok ? '' : ', not offered until ' + Math.round(MIN * 100) + '%'));
    writes[path.join(tdir, f)] = fileText(file.language, file.phrases, list);
    if (ok) { langs.push(file.language); writes[path.join(ldir, code + '.js')] = langJs(code, file.language.name, r.dict, list); }
  }
  writes[path.join(ldir, 'languages.js')] = languagesJs(langs);
  // a language's js/lang file that isn't offered any more goes
  const drop = fs.readdirSync(ldir).filter((f) => /\.js$/.test(f) && !writes[path.join(ldir, f)]).map((f) => path.join(ldir, f));
  const stale = Object.keys(writes).filter((p) => !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== writes[p]).concat(drop);
  return { list, errors, report, writes, drop, stale };
}

function main() {
  const args = process.argv.slice(2);
  const opts = { check: args.indexOf('--check') >= 0, prune: args.indexOf('--prune') >= 0 };
  const root = path.join(__dirname, '..');
  const r = run(root, opts);
  console.log(r.list.length + ' phrases shown.');
  r.report.forEach((l) => console.log('  ' + l));
  if (r.errors.length) {
    console.log('\n' + r.errors.length + ' to correct:');
    r.errors.forEach((e) => console.log('  ' + e));
    process.exit(1);
  }
  const rel = (p) => path.relative(root, p);
  if (opts.check) {
    if (r.stale.length) { console.log('\nOut of date (run node translations/build.js): ' + r.stale.map(rel).join(', ')); process.exit(1); }
    console.log('Everything up to date.');
    return;
  }
  Object.keys(r.writes).forEach((p) => { if (r.stale.indexOf(p) >= 0) fs.writeFileSync(p, r.writes[p]); });
  r.drop.forEach((p) => fs.unlinkSync(p));
  console.log(r.stale.length ? 'Updated: ' + r.stale.map(rel).join(', ') : 'Everything up to date.');
}

module.exports = { MIN, PLURALS, FORMS, phrases, pluralOthers, check, offered, run };
if (require.main === module) main();
