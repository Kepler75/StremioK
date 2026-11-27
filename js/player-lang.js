/* Player, part 3 of 7 — languages: the spellings a track language comes in, display names, and
   reading a track's details.
   Parts share one namespace, PlayerParts (P): see js/player-core.js. */
(function (P) {
    'use strict';

    // A track's details (the player's extra_info). Normally JSON; when it isn't (some
    // firmware), its "key": value pairs are read out of the text, so the language survives.
    function trackInfo(tr) {
        var info = tr && tr.extra_info;
        if (typeof info === 'string') {
            try { info = JSON.parse(info); } catch (e) {
                var out = Object.create(null), re = /["']?([A-Za-z_]+)["']?\s*[:=]\s*["']?([^"',}]*)/g, m;   // (no inherited names)
                while ((m = re.exec(info))) { out[m[1]] = m[2].trim(); }
                info = out;
            }
        }
        return (info && typeof info === 'object') ? info : {};
    }
    // Its language, under whichever name the player uses: audio usually "language",
    // subtitles "track_lang" (either can turn up on either, depending on the TV / file).
    function infoLang(info) {
        info = info || {};
        return '' + (info.language || info.track_lang || info.lang || info.language_code || info.languageCode || '');
    }
    function trackLang(tr) { return infoLang(trackInfo(tr)); }

    // Spellings a track's language can arrive in for each language code (audio tracks,
    // and subtitle addons, which don't all use OpenSubtitles' 3-letter codes):
    // ISO 639-2 (both B and T forms), ISO 639-1 (HLS uses it, e.g. "es-419"), and names.
    var LANG_ALIASES = {
        eng: ['eng', 'en', 'english'],
        spa: ['spa', 'spn', 'spl', 'es', 'esl', 'spanish', 'español', 'espanol', 'castellano', 'latino'],
        fre: ['fre', 'fra', 'fr', 'french', 'français', 'francais'],
        ger: ['ger', 'deu', 'de', 'german', 'deutsch'],
        ita: ['ita', 'it', 'italian', 'italiano'],
        por: ['por', 'pob', 'pom', 'pt', 'po', 'portuguese', 'português', 'portugues'],   // ("po": the 2017 TV's)
        dut: ['dut', 'nld', 'nl', 'dutch', 'nederlands'],
        rus: ['rus', 'ru', 'russian'],
        ara: ['ara', 'ar', 'arabic'],
        tur: ['tur', 'tr', 'turkish'],
        pol: ['pol', 'pl', 'polish', 'polski'],
        jpn: ['jpn', 'ja', 'japanese', '日本語'],
        kor: ['kor', 'ko', 'korean', '한국어'],
        chi: ['chi', 'zho', 'zh', 'cmn', 'zht', 'zhe', 'chinese', 'mandarin', '中文'],   // (zht / zhe: OpenSubtitles' traditional and bilingual)
        hin: ['hin', 'hi', 'hindi'],
        swe: ['swe', 'sv', 'swedish', 'svenska'],
        nor: ['nor', 'nob', 'nno', 'nb', 'nn', 'norwegian', 'norsk'],
        dan: ['dan', 'da', 'danish', 'dansk'],
        fin: ['fin', 'fi', 'finnish', 'suomi'],
        gre: ['gre', 'ell', 'el', 'greek'],
        heb: ['heb', 'he', 'iw', 'hebrew'],
        hun: ['hun', 'hu', 'hungarian', 'magyar'],
        cze: ['cze', 'ces', 'cs', 'czech', 'čeština'],
        slo: ['slo', 'slk', 'sk', 'slovak'],
        slv: ['slv', 'sl', 'slovenian', 'slovene'],
        rum: ['rum', 'ron', 'ro', 'romanian', 'română'],
        ukr: ['ukr', 'uk', 'ukrainian'],
        tha: ['tha', 'th', 'thai'],
        vie: ['vie', 'vi', 'vietnamese'],
        ind: ['ind', 'id', 'indonesian', 'indonesia'],   // ("Bahasa Indonesia": its last word)
        may: ['may', 'msa', 'ms', 'malay'],
        fil: ['fil', 'tgl', 'tl', 'filipino', 'tagalog'],
        cat: ['cat', 'ca', 'catalan', 'català'],
        baq: ['baq', 'eus', 'eu', 'basque', 'euskara'],
        glg: ['glg', 'gl', 'galician', 'galego'],
        bul: ['bul', 'bg', 'bulgarian'],
        hrv: ['hrv', 'hr', 'croatian', 'hrvatski'],
        srp: ['srp', 'scc', 'sr', 'serbian'],
        per: ['per', 'fas', 'fa', 'persian', 'farsi'],
        est: ['est', 'et', 'estonian'],
        lav: ['lav', 'lv', 'latvian'],
        lit: ['lit', 'lt', 'lithuanian'],
        ice: ['ice', 'isl', 'is', 'icelandic'],
        tam: ['tam', 'ta', 'tamil'],
        tel: ['tel', 'te', 'telugu'],
        ben: ['ben', 'bn', 'bengali'],
        // (2.2.0.2) the rest of OpenSubtitles' languages; two-letter codes that are also everyday
        // words or labels (my, be, or, so, an, se, si, ne, mr, SD, BR…) left out
        afr: ['afr', 'af', 'afrikaans'],
        alb: ['alb', 'sqi', 'sq', 'albanian', 'shqip'],
        arg: ['arg', 'aragonese'],
        arm: ['arm', 'hye', 'hy', 'armenian'],
        ast: ['ast', 'asturian'],
        aze: ['aze', 'az', 'azerbaijani'],
        bel: ['bel', 'belarusian'],
        bos: ['bos', 'bs', 'bosnian'],
        bre: ['bre', 'breton'],
        bur: ['bur', 'mya', 'burmese'],
        prs: ['prs', 'dari'],
        epo: ['epo', 'eo', 'esperanto'],
        ext: ['ext', 'extremaduran'],
        gla: ['gla', 'gd', 'gaelic'],
        geo: ['geo', 'kat', 'ka', 'georgian'],
        ibo: ['ibo', 'ig', 'igbo'],
        ina: ['ina', 'interlingua'],
        gle: ['gle', 'ga', 'irish'],
        kan: ['kan', 'kn', 'kannada'],
        kaz: ['kaz', 'kk', 'kazakh'],
        khm: ['khm', 'km', 'khmer'],
        kur: ['kur', 'ku', 'kurdish'],
        ltz: ['ltz', 'lb', 'luxembourgish'],
        mac: ['mac', 'mkd', 'mk', 'macedonian'],
        mal: ['mal', 'ml', 'malayalam'],
        mni: ['mni', 'manipuri'],
        mar: ['mar', 'marathi'],
        mon: ['mon', 'mn', 'mongolian'],
        mne: ['mne', 'montenegrin'],
        nav: ['nav', 'nv', 'navajo'],
        nep: ['nep', 'nepali'],
        sme: ['sme', 'sami'],
        oci: ['oci', 'oc', 'occitan'],
        ori: ['ori', 'odia', 'oriya'],
        pan: ['pan', 'pa', 'punjabi', 'panjabi'],
        pus: ['pus', 'pashto'],
        sat: ['sat', 'santali'],
        snd: ['snd', 'sindhi'],
        sin: ['sin', 'sinhala', 'sinhalese'],
        som: ['som', 'somali'],
        swa: ['swa', 'sw', 'swahili'],
        syr: ['syr', 'syriac'],
        tat: ['tat', 'tt', 'tatar'],
        tok: ['tok', 'toki'],
        tuk: ['tuk', 'tk', 'turkmen'],
        urd: ['urd', 'ur', 'urdu'],
        uzb: ['uzb', 'uz', 'uzbek'],
        wel: ['wel', 'cym', 'cy', 'welsh']
    };
    function langMatches(pref, lang) {
        var names = LANG_ALIASES[pref] || LANG_ALIASES[VARIANTS[pref] ? VARIANTS[pref].base : ''] || [pref];   // (a variant, "spa-419": any of its language's)
        // "es-419" -> ["es"], "Spanish (Latin America)" -> ["spanish", "latin", "america"]
        var words = ('' + (lang || '')).toLowerCase().split(/[^a-zà-ÿ]+/);
        for (var i = 0; i < words.length; i++) { if (words[i] && names.indexOf(words[i]) !== -1) { return true; } }
        return false;
    }

    // A language's regional variants (Settings › Subtitles / Audio: "Spanish (Latin America)"…): the
    // one chosen is taken first, then a track that doesn't say which, then the others. A track's
    // variant from its BCP 47 tag or language ("es-419", "pt-BR"), else its name's words
    // ("Latinoamérica", "Castellano", "Brasil"); one that says another variant isn't this one.
    var VARIANTS = {
        'spa-419': { base: 'spa', tag: /^es[-_](?!es\b)[a-z0-9]{2,3}\b/i, words: ['latino', 'latinoamérica', 'latinoamerica', 'latinoamericano', 'latam', 'latin', 'méxico', 'mexico', 'mexicano', 'argentina', 'lat', 'la', 'spl', 'ea'] },
        'spa-es': { base: 'spa', tag: /^es[-_]es\b/i, words: ['españa', 'espana', 'castellano', 'castilian', 'spain', 'european', 'europeo', 'eu', 'spn', 'sp'] },
        'eng-us': { base: 'eng', tag: /^en[-_]us\b/i, words: ['us', 'usa', 'american'] },
        'eng-gb': { base: 'eng', tag: /^en[-_](gb|uk)\b/i, words: ['uk', 'gb', 'british', 'england'] },
        'por-br': { base: 'por', tag: /^pt[-_]br\b/i, words: ['brasil', 'brazil', 'brazilian', 'brasileiro', 'br', 'pob', 'pb'] },
        'por-pt': { base: 'por', tag: /^pt[-_]pt\b/i, words: ['portugal', 'europeu', 'european'] },
        'fre-ca': { base: 'fre', tag: /^fr[-_]ca\b/i, words: ['canada', 'canadien', 'canadian', 'québec', 'quebec', 'québécois', 'quebecois', 'vfq'] },
        'fre-fr': { base: 'fre', tag: /^fr[-_]fr\b/i, words: ['france', 'vff', 'vfi'] },
        'chi-hans': { base: 'chi', tag: /^zh[-_](hans|cn|sg)\b/i, words: ['simplified', '简体', '简', 'chs', 'zhs', 'sc', 'gb'] },
        'chi-hant': { base: 'chi', tag: /^zh[-_](hant|tw|hk|mo)\b/i, words: ['traditional', '繁體', '繁体', '繁', 'cht', 'zht', 'tc', 'big5'] }
    };
    // Which variant a track is (its text: language, BCP 47 tag, name, joined), of a language's.
    function variantOf(base, text) {
        var t = ('' + (text || '')).toLowerCase(), words = t.split(/[^a-zà-ÿ\u4e00-\u9fff0-9]+/), found = '';
        for (var v in VARIANTS) {
            if (!Object.prototype.hasOwnProperty.call(VARIANTS, v) || VARIANTS[v].base !== base) { continue; }
            var tags = t.split(/[\s,;|()\[\]]+/).some(function (w) { return VARIANTS[v].tag.test(w); });
            if (tags || VARIANTS[v].words.some(function (w) { return words.indexOf(w) !== -1 || (/[\u4e00-\u9fff]/.test(w) && t.indexOf(w) !== -1); })) { if (found) { return ''; } found = v; }   // (says two: too unsure)
        }
        return found;
    }
    // How well a track fits a choice: 0 the variant chosen (or no variant chosen), 1 a track that
    // doesn't say which, 2 another variant. track: a language string, or { lang, bcp, name }.
    function variantRank(pref, track) {
        var v = VARIANTS[pref];
        if (!v) { return 0; }
        var text = track && typeof track === 'object' ? [track.bcp, track.lang, track.name, track.title, track.label].filter(Boolean).join(' | ') : track;
        var got = variantOf(v.base, text);
        return got === pref ? 0 : got ? 2 : 1;
    }

    // Display names for language codes (the aliases above, plus other common ones).
    var LANG_NAMES = { eng: U.t('English'), spa: U.t('Spanish'), fre: U.t('French'), ger: U.t('German'), ita: U.t('Italian'), por: U.t('Portuguese'),
        dut: U.t('Dutch'), rus: U.t('Russian'), ara: U.t('Arabic'), tur: U.t('Turkish'), pol: U.t('Polish'),
        jpn: U.t('Japanese'), ja: U.t('Japanese'), kor: U.t('Korean'), ko: U.t('Korean'), chi: U.t('Chinese'), zho: U.t('Chinese'), zh: U.t('Chinese'),
        hin: U.t('Hindi'), hi: U.t('Hindi'), swe: U.t('Swedish'), sv: U.t('Swedish'), nor: U.t('Norwegian'), no: U.t('Norwegian'), nob: U.t('Norwegian'),
        dan: U.t('Danish'), da: U.t('Danish'), fin: U.t('Finnish'), fi: U.t('Finnish'), gre: U.t('Greek'), ell: U.t('Greek'), el: U.t('Greek'),
        heb: U.t('Hebrew'), he: U.t('Hebrew'), hun: U.t('Hungarian'), hu: U.t('Hungarian'), cze: U.t('Czech'), ces: U.t('Czech'), cs: U.t('Czech'),
        rum: U.t('Romanian'), ron: U.t('Romanian'), ro: U.t('Romanian'), ukr: U.t('Ukrainian'), uk: U.t('Ukrainian'), tha: U.t('Thai'), th: U.t('Thai'),
        vie: U.t('Vietnamese'), vi: U.t('Vietnamese'), ind: U.t('Indonesian'), id: U.t('Indonesian'), cat: U.t('Catalan'), ca: U.t('Catalan'),
        bul: U.t('Bulgarian'), bg: U.t('Bulgarian'), hrv: U.t('Croatian'), hr: U.t('Croatian'), srp: U.t('Serbian'), sr: U.t('Serbian'),
        per: U.t('Persian'), fas: U.t('Persian'), fa: U.t('Persian'), slo: U.t('Slovak'), slv: U.t('Slovenian'), may: U.t('Malay'), fil: U.t('Filipino'),
        baq: U.t('Basque'), glg: U.t('Galician'), est: U.t('Estonian'), lav: U.t('Latvian'), lit: U.t('Lithuanian'), ice: U.t('Icelandic'),
        tam: U.t('Tamil'), tel: U.t('Telugu'), ben: U.t('Bengali'), mul: U.t('Multiple languages'), zxx: U.t('No language'),
        afr: U.t('Afrikaans'), alb: U.t('Albanian'), arg: U.t('Aragonese'), arm: U.t('Armenian'), ast: U.t('Asturian'), aze: U.t('Azerbaijani'),
        bel: U.t('Belarusian'), bos: U.t('Bosnian'), bre: U.t('Breton'), bur: U.t('Burmese'), prs: U.t('Dari'), epo: U.t('Esperanto'), ext:
        U.t('Extremaduran'), gla: U.t('Scottish Gaelic'), geo: U.t('Georgian'), ibo: U.t('Igbo'), ina: U.t('Interlingua'), gle: U.t('Irish'), kan:
        U.t('Kannada'), kaz: U.t('Kazakh'), khm: U.t('Khmer'), kur: U.t('Kurdish'), ltz: U.t('Luxembourgish'), mac: U.t('Macedonian'), mal:
        U.t('Malayalam'), mni: U.t('Manipuri'), mar: U.t('Marathi'), mon: U.t('Mongolian'), mne: U.t('Montenegrin'), nav: U.t('Navajo'), nep:
        U.t('Nepali'), sme: U.t('Northern Sami'), oci: U.t('Occitan'), ori: U.t('Odia'), pan: U.t('Punjabi'), pus: U.t('Pashto'), sat: U.t('Santali'),
        snd: U.t('Sindhi'), sin: U.t('Sinhala'), som: U.t('Somali'), swa: U.t('Swahili'), syr: U.t('Syriac'), tat: U.t('Tatar'), tok: U.t('Toki Pona'),
        tuk: U.t('Turkmen'), urd: U.t('Urdu'), uzb: U.t('Uzbek'), wel: U.t('Welsh'),
        und: U.t('Unknown language'), '': U.t('Unknown language') };
    function langName(lang) {
        var k = langKey(lang);
        if (LANG_NAMES[k]) { return LANG_NAMES[k]; }
        var raw = ('' + (lang || '')).trim();
        return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : U.t('Unknown language');
    }
    // Order for language groups: current choice, then the preferred languages, then by name.
    function langRank(k, prefs) {
        for (var i = 0; i < prefs.length; i++) { if (prefs[i] === k || langKey(prefs[i]) === k) { return i; } }   // (a variant chosen: its language's)
        return prefs.length;
    }

    // A track language in comparable form: the language code when a known spelling
    // ("es-419", "Spanish") is recognized, else the raw lowercased text.
    function langKey(lang) {
        for (var k in LANG_ALIASES) {
            if (Object.prototype.hasOwnProperty.call(LANG_ALIASES, k) && langMatches(k, lang)) { return k; }
        }
        return ('' + (lang || '')).toLowerCase().trim();
    }

    // The file's own track (its header's, S.mi: see player-core's startFileInfo) for each of the
    // TV player's tracks of a kind ('audio' | 'subs'), in the TV's order; else null (the player's
    // list as it is). As many in both, every language either states agreeing: by position. The
    // file listing more (the TV leaves some out, often picture subtitles): its text ones only, if
    // that makes as many; else matched in order by language, each of the TV's tracks to the next
    // of the file's in its language (every one stating one). Not matched: said once in
    // Diagnostics › Logs, with how many each lists.
    function agrees(tr, ft) {
        var tv = langKey(trackLang(tr)), fl = langKey(ft.lang || '');
        if (!tv || !fl || P.langUnstated(tv) || P.langUnstated(fl)) { return null; }   // (one says nothing)
        return tv === fl || langKey(('' + ft.lang).split('-')[0]) === tv;
    }
    function byPosition(list, tracks) {
        if (list.length !== tracks.length) { return null; }
        for (var i = 0; i < list.length; i++) { if (agrees(tracks[i], list[i]) === false) { return null; } }
        return list;
    }
    function inOrder(list, tracks) {
        var out = [], j = 0;
        for (var i = 0; i < tracks.length; i++) {
            while (j < list.length && agrees(tracks[i], list[j]) !== true) {
                if (agrees(tracks[i], list[j]) === null) { return null; }   // (a language unstated: too unsure)
                j++;
            }
            if (j >= list.length) { return null; }
            out.push(list[j++]);
        }
        return out;
    }
    // The 2017 TV with an MKV's many subtitle tracks: it lists the first 30 only (32 tracks in all),
    // states no language for any, and numbers them in the file's order, on from its video and audio
    // (2, 3, 4…). Those: the file's first ones, in order. Anything else stays unmatched.
    function firstOnes(list, tracks) {
        var mi = P.S.mi, before = (mi && mi.video ? 1 : 0) + ((mi && mi.audio) || []).length;
        for (var i = 0; i < tracks.length; i++) {
            if (agrees(tracks[i], list[i]) !== null || +tracks[i].index !== before + i) { return null; }
        }
        return list.slice(0, tracks.length);
    }
    var _ftMemo = { mi: null, said: {} };
    function fileTracks(kind, tracks) {
        var list = P.S.mi && P.S.mi[kind];
        if (!list || !tracks || !list.length || !tracks.length) { return null; }
        var bl = kind === 'subs' && P.S.ctx && P.S.ctx._relay && P.S.ctx._blank;   // (the others blanked by the service: the kept ones, in order)
        if (bl) { list = bl.map(function (i) { return list[i]; }).filter(Boolean); }   // (in the order the service put them in)
        var ao = kind === 'audio' && P.S.ctx && P.S.ctx._relay && P.S.ctx._blank && P.S.ctx._audioOrder;   // (the audio reordered by the service too: yours first)
        if (ao && ao.length) { var all = list; list = ao.map(function (i) { return all[i]; }).filter(Boolean).concat(all.filter(function (t, i) { return ao.indexOf(i) === -1; })); }
        var got = byPosition(list, tracks);
        if (!got && list.length > tracks.length) {
            got = byPosition(list.filter(function (t) { return t.text !== false; }), tracks) || inOrder(list, tracks) || firstOnes(list, tracks);
        }
        if (!got) {
            if (_ftMemo.mi !== P.S.mi) { _ftMemo = { mi: P.S.mi, said: {} }; }
            if (!_ftMemo.said[kind]) {
                _ftMemo.said[kind] = 1;
                U.log('player', (kind === 'audio' ? 'Audio' : 'Subtitle') + ' tracks: the TV lists ' + tracks.length + ', the file ' + list.length + ' (' +
                    tracks.map(function (t) { return trackLang(t) || '?'; }).join(' ') + ' / ' + list.map(function (t) { return t.lang || '?'; }).join(' ') + '): not matched, the TV\'s names shown');
            }
        }
        return got;
    }
    function fileTrack(kind, tracks, pos) { var l = fileTracks(kind, tracks); return l ? l[pos] || null : null; }
    P.fileTracks = fileTracks; P.fileTrack = fileTrack;

    // ----- for the other parts (and js/player.js) -----
    P.trackInfo = trackInfo; P.infoLang = infoLang; P.trackLang = trackLang; P.langMatches = langMatches;
    P.langName = langName; P.langRank = langRank; P.langKey = langKey; P.variantRank = variantRank; P.variantOf = variantOf;
    P.VARIANT_CODES = Object.keys(VARIANTS);
    // A track that doesn't say its language (by its key): none, "und", "unknown"…, or no letters.
    // (A language StremioK has no name for is still a language.)
    P.langUnstated = function (k) { k = ('' + (k || '')).trim(); return !/[a-zà-ÿ]/i.test(k) || /^(und|unk|unknown|unknown language|mul|zxx|n\/a|none)$/i.test(k); };
    // A language code's two-letter form (ISO 639-1: "spa" -> "es"), or '' (TMDB asks by it).
    P.lang2 = function (key) { var a = LANG_ALIASES[key] || LANG_ALIASES[VARIANTS[key] ? VARIANTS[key].base : ''] || []; for (var i = 0; i < a.length; i++) { if (/^[a-z]{2}$/.test(a[i])) { return a[i]; } } return ''; };
})(PlayerParts);
