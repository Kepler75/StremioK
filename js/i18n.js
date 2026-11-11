/* The interface's language (Settings › Appearance › Language): English or one of the languages
   js/lang/languages.js lists (I18N_LANGS, written from translations/*.json with each one's name,
   the TV languages it answers for and its plural rule); Automatic (the default) goes by the TV's
   own language. Loaded first, after that list and before every
   other script, so it can pull in the chosen language's phrases (js/lang/<code>.js, a list of
   English phrase -> its translation) before any of them builds its text: some build it as they
   load (a menu's choices). Changing the language restarts StremioK in it.
   Phrases are looked up by their English text (U.t), with {name} for what's filled in and
   singular / plural forms (U.tn) by the language's own rule; one not translated shows in English.
   What the logs record stays in English (Settings › Diagnostics: read to find a problem).
   Global namespace: I18N */
var I18N = (function () {
    'use strict';
    function isList(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
    var LANGS = [{ code: 'en', name: 'English', matches: ['en'], plural: 'one' }];
    try {
        (typeof I18N_LANGS !== 'undefined' && isList(I18N_LANGS) ? I18N_LANGS : []).forEach(function (L) {
            if (L && typeof L.code === 'string' && L.code !== 'en' && typeof L.name === 'string') { LANGS.push(L); }
        });
    } catch (e0) {}
    // The form a number takes in each plural rule (one: the singular phrase; any other: the plural
    // phrase's translation, one text for all of them or each by name). Whole numbers only.
    function f2to4(n) { var a = n % 10, b = n % 100; return a >= 2 && a <= 4 && (b < 12 || b > 14); }
    var PLURAL = {
        'one': function (n) { return n === 1 ? 'one' : 'other'; },
        'zero-one': function (n) { return n === 0 || n === 1 ? 'one' : 'other'; },
        'none': function () { return 'other'; },
        'slavic': function (n) { return n % 10 === 1 && n % 100 !== 11 ? 'one' : f2to4(n) ? 'few' : 'many'; },
        'polish': function (n) { return n === 1 ? 'one' : f2to4(n) ? 'few' : 'many'; },
        'hebrew': function (n) { return n === 1 ? 'one' : n === 2 ? 'two' : 'other'; },
        'arabic': function (n) { var b = n % 100; return n === 0 ? 'zero' : n === 1 ? 'one' : n === 2 ? 'two' : b >= 3 && b <= 10 ? 'few' : b >= 11 ? 'many' : 'other'; }
    };
    var PREFS_KEY = 'stremiok.prefs';
    function find(code) { for (var i = 0; i < LANGS.length; i++) { if (LANGS[i].code === code) { return LANGS[i]; } } return null; }
    function known(code) { return find(code) ? code : ''; }
    // The TV's own language: the language that matches it most closely (pt-PT before pt), else English.
    function auto() {
        var l = '', best = 'en', len = 0;
        try { l = ('' + ((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '')).toLowerCase().replace(/_/g, '-'); } catch (e) {}
        LANGS.forEach(function (L) {
            [L.code].concat(isList(L.matches) ? L.matches : []).forEach(function (m) {
                m = ('' + m).toLowerCase();
                if (m && (l === m || l.indexOf(m + '-') === 0) && m.length > len) { best = L.code; len = m.length; }
            });
        });
        return best;
    }
    // The choice kept in Settings ('auto' or a language), read straight from the TV's storage:
    // nothing else is loaded yet. None kept yet: a new install goes by the TV (Automatic); one
    // already used (StremioK's own data on the TV) stays in English, as it was. Kept either way,
    // so it doesn't change on a later launch.
    function choice() {
        var p = null, ls = null;
        try { ls = window.localStorage; p = JSON.parse(ls.getItem(PREFS_KEY) || 'null'); } catch (e) {}
        if (p && typeof p.lang === 'string') { return p.lang === 'auto' || known(p.lang) ? p.lang : 'auto'; }
        var used = false;
        try { for (var i = 0; ls && i < ls.length; i++) { if (/^stremiok\./.test(ls.key(i) || '')) { used = true; break; } } } catch (e2) {}
        var c = used ? 'en' : 'auto';
        try { p = (p && typeof p === 'object') ? p : {}; p.lang = c; ls.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e3) {}
        return c;
    }
    var _choice = choice(), _lang = _choice === 'auto' ? auto() : _choice;
    var _dict = {};
    // The page says which language it's in; one written right to left has its text run that way
    // (css: html.rtl-text).
    try {
        var root = document.documentElement, me0 = find(_lang);
        root.setAttribute('lang', _lang);
        if (me0 && me0.direction === 'rtl') { root.className = (root.className ? root.className + ' ' : '') + 'rtl-text'; }
    } catch (e1) {}
    // A language file says what it translates: I18N.add('es', { 'English phrase': 'Frase', … }).
    function add(code, dict) { if (code === _lang && dict && typeof dict === 'object') { _dict = dict; } }
    // Its file, before the scripts after this one run (this one's own ?v=, for the TV's cache).
    if (_lang !== 'en' && typeof document !== 'undefined' && document.write) {
        // (a version number only: rebuilt from its numbers)
        var me = document.currentScript, m = me && me.src ? /\?v=(\d+(?:\.\d+)*)/.exec(me.src) : null;
        var v = m ? '?v=' + m[1].split('.').map(function (x) { return +x; }).join('.') : '';
        if (known(_lang)) { try { document.write('<script src="js/lang/' + _lang + '.js' + v + '"><\/script>'); } catch (e) {} }
    }

    function fill(s, vars) {
        if (!vars) { return s; }
        return s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? '' + vars[k] : m; });
    }
    // A phrase in the language: its translation (or itself), {name}s filled from vars.
    function t(s, vars, form) {
        s = '' + s;
        var x = Object.prototype.hasOwnProperty.call(_dict, s) ? _dict[s] : s;
        if (x && typeof x === 'object') { x = x[form] || x.other || x.many || ''; }
        return fill(typeof x === 'string' && x ? x : s, vars);
    }
    // A phrase by a number (English: one for 1, else other), in the form the language's plural rule
    // gives that number; {n} is the number.
    function tn(n, one, other, vars) {
        var v = { n: n };
        if (vars) { Object.keys(vars).forEach(function (k) { v[k] = vars[k]; }); }
        var L = find(_lang), form = ((L && PLURAL[L.plural]) || PLURAL.one)(n);
        // A singular without its number ('saved once') says 1: any other number the rule calls
        // singular (Russian 21, Portuguese 0) takes the plural phrase.
        if (form === 'one' && n !== 1 && ('' + one).indexOf('{n}') < 0) { form = 'many'; }
        return form === 'one' ? t(one, v) : t(other, v, form);
    }

    return {
        lang: function () { return _lang; }, choice: choice, auto: auto, langs: function () { return LANGS.map(function (L) { return [L.code, L.name]; }); },
        add: add, t: t, tn: tn
    };
})();
