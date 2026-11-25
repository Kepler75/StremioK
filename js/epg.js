/* TV guide (XMLTV) for IPTV channels. Global namespace: EPG
   Which guide a playlist has (guideUrl: the Guide link you set, else the one the playlist
   names, else an Xtream playlist's own), read by StremioK's service for your channels only
   (their keys as a bitset: see service/index.js, epgControl), and the programs asked for as
   the cards, Home's details strip, the player and a channel's schedule need them. Not in a
   desktop browser (no service). */
var EPG = (function () {
    'use strict';

    // A channel's key, as the service makes it: "i:" and its tvg-id (iptv-org's feed after an @
    // left out: "ElTrece.ar@SD" is a guide's "ElTrece.ar"), or "n:" and its name without
    // capitals, accents, spaces, "TV" or HD / FHD / 4K tags ("El Trece HD": "n:eltrece"). A
    // country is taken out and kept apart (2.4.6, after ediziks' fork, #29): a tvg-id's ".ar", a
    // name's " ARG" / " MX" at the end or "TR:" / "|UK|" / "DE -" at the start (COUNTRY), so
    // "TR: TRT 1 HD" is "trt1" in "tr". A guide's channel answers with its key in its country
    // (".tr", or ".~" when its guide names none) and without one (guideKeys); a channel asks with
    // its own country and ".~" when it knows its country, else without one (keysOf). So a Turkish
    // "FOX" never gets an American "FOX.us"'s guide, and a key two countries' channels share
    // answers neither (the service marks it unclear) rather than the first one listed.
    var ACCENTS = { 'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
        'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ñ': 'n', 'ç': 'c' };
    var COUNTRY = { ar: 'ar', arg: 'ar', mx: 'mx', mex: 'mx', us: 'us', usa: 'us', uk: 'uk', gb: 'uk', gbr: 'uk', eng: 'uk', es: 'es', esp: 'es', br: 'br', cl: 'cl', co: 'co', pe: 'pe',
        uy: 'uy', py: 'py', ve: 've', ec: 'ec', bo: 'bo', ca: 'ca', fr: 'fr', fra: 'fr', de: 'de', ger: 'de', deu: 'de', it: 'it', ita: 'it', pt: 'pt', por: 'pt',
        tr: 'tr', tur: 'tr', nl: 'nl', ned: 'nl', nld: 'nl', be: 'be', bel: 'be', pl: 'pl', pol: 'pl', at: 'at', aut: 'at', ch: 'ch', se: 'se', swe: 'se',
        no: 'no', dk: 'dk', fi: 'fi', gr: 'gr', gre: 'gr', ro: 'ro', hu: 'hu', cz: 'cz', sk: 'sk', ru: 'ru', rus: 'ru', ua: 'ua', 'in': 'in', au: 'au', aus: 'au',
        ie: 'ie', irl: 'ie', al: 'al', rs: 'rs', hr: 'hr', ba: 'ba', bg: 'bg', si: 'si', il: 'il', ae: 'ae', sa: 'sa', eg: 'eg', ma: 'ma', za: 'za', nz: 'nz', ir: 'ir', irn: 'ir', pk: 'pk', pak: 'pk', bd: 'bd', cn: 'cn', chn: 'cn', 'do': 'do', afg: 'af', sw: 'se', jp: 'jp', kr: 'kr', ph: 'ph', th: 'th', vn: 'vn', my: 'my',
        id: 'id', lk: 'lk', np: 'np', qa: 'qa', kw: 'kw', iq: 'iq', jo: 'jo', lb: 'lb', sy: 'sy', ps: 'ps', om: 'om', bh: 'bh', ye: 'ye', tn: 'tn', dz: 'dz', ly: 'ly',
        ng: 'ng', gh: 'gh', ke: 'ke', mk: 'mk', me: 'me', xk: 'xk', lt: 'lt', lv: 'lv', ee: 'ee', is: 'is', lu: 'lu', cy: 'cy', mt: 'mt', cr: 'cr', gt: 'gt', hn: 'hn',
        sv: 'sv', ni: 'ni', pa: 'pa', pr: 'pr', jm: 'jm', tt: 'tt', cu: 'cu' };
    var SUFFIX_SKIP = { 'in': 1, at: 1, no: 1, be: 1, ba: 1, ma: 1, sa: 1, si: 1, por: 1, aus: 1, 'do': 1, is: 1, me: 1, my: 1, id: 1, pa: 1, pr: 1, sv: 1, ni: 1, om: 1, cu: 1, ke: 1, ye: 1, ps: 1, tt: 1, gt: 1, cr: 1, lb: 1, jo: 1, np: 1, sw: 1 };   // (words a name may end with: "Plug In"; only as a prefix, "IN: …")
    var NOT_CC = { hd: 1, sd: 1, tv: 1, fm: 1, hq: 1 };   // (a tvg-id's ".hd" isn't a country)
    var PREFIX = /^[\s|\[(│┃]*([a-z]{2,3})(?:\s*[:|\])│┃]+|\s+-+)\s*/;   // ("TR:", "|UK|", "[DE]", "NL -"; not "AL-Jazeera")
    function parts(kind, s) {
        var t = ('' + (s || '')).toLowerCase().replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/g, function (c) { return ACCENTS[c]; }).trim(), cc = '', m;
        if (kind === 'i') { t = t.replace(/@.*$/, ''); }
        if (kind === 'n' && (m = PREFIX.exec(t)) && COUNTRY[m[1]] && t.length > m[0].length) { cc = COUNTRY[m[1]]; t = t.slice(m[0].length); }
        if ((m = /\.([a-z]{2})$/.exec(t)) && !NOT_CC[m[1]]) { cc = cc || COUNTRY[m[1]] || m[1]; t = t.slice(0, -3); }
        else if (kind === 'n' && (m = /[\s_-]+([a-z]{2,3})$/.exec(t)) && COUNTRY[m[1]] && !SUFFIX_SKIP[m[1]] && t.length > m[0].length) { cc = cc || COUNTRY[m[1]]; t = t.slice(0, -m[0].length); }
        if (kind === 'n') { t = t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b(hd|fhd|uhd|sd|hq|4k|8k|hevc|h265|1080p?|720p?|tv)\b/g, ' '); }
        t = t.replace(/[^a-z0-9]+/g, '');
        if (kind === 'n' && t.length > 4) { t = t.replace(/tv$/, ''); }   // ("CronicaTV")
        return { base: t.slice(0, 60), cc: cc };
    }
    function key(kind, s) { var p = parts(kind, s); return p.base ? kind + ':' + p.base + (p.cc ? '.' + p.cc : '') : ''; }
    // A guide's channel's keys (its id and display names), as the service makes them: each one
    // without a country and in the channel's (its id's, else a name's; ".~" when neither says).
    // Guides' and providers' other name forms (TV guide names: loose, see looseNames): a guide's
    // name in gatotv's form also as a playlist names it, a country in its brackets the channel's
    // (the same as service/index.js's epgNameForms); a provider's tag before a channel's name left
    // out (untagged). PLACE: country names, as groups and guides write them; '' a region.
    var PLACE = { argentina: 'ar', colombia: 'co', bolivia: 'bo', paraguay: 'py', chile: 'cl', uruguay: 'uy', peru: 'pe', mexico: 'mx', espana: 'es', spain: 'es', brasil: 'br', brazil: 'br',
        venezuela: 've', ecuador: 'ec', usa: 'us', eeuu: 'us', 'estados unidos': 'us', 'united states': 'us', 'united kingdom': 'uk', england: 'uk', turkey: 'tr', turkiye: 'tr', germany: 'de',
        deutschland: 'de', france: 'fr', italy: 'it', italia: 'it', portugal: 'pt', canada: 'ca', 'costa rica': 'cr', guatemala: 'gt', honduras: 'hn', 'el salvador': 'sv', nicaragua: 'ni',
        panama: 'pa', 'puerto rico': 'pr', 'republica dominicana': 'do', cuba: 'cu', latinoamerica: '', latam: '', internacional: '', international: '' };
    function place(s) {
        var k = ('' + (s || '')).toLowerCase().replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/g, function (c) { return ACCENTS[c]; }).replace(/[^a-z ]+/g, '').replace(/\s+/g, ' ').trim();
        return Object.prototype.hasOwnProperty.call(PLACE, k) ? PLACE[k] : null;
    }
    function nameForms(n) {
        var out = ['' + (n || '')], cc = '', m = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(out[0]);
        if (m) { var pl = place(m[2]); if (pl === null) { out.push(m[2].split(/\s+-\s+/)[0]); } else { cc = pl; } }
        out.slice().forEach(function (x) { var c = /^\s*canal\s+(.*[A-Za-zÀ-ɏ].*)$/i.exec(x); if (c) { out.push(c[1]); } });
        return { forms: out, cc: cc };
    }
    var LOOSE_KEY = 'stremiok.iptv.guidenames';
    function looseNames() { return U.store.get(LOOSE_KEY, '') === 'loose'; }
    function setLooseNames(on) { if (on) { U.store.set(LOOSE_KEY, 'loose'); } else { U.store.remove(LOOSE_KEY); } _tags = null; reset(); }
    function guideKeys(id, names, loose) {
        var all = [], where = '';
        (names || []).forEach(function (n) { if (!loose) { all.push(n); return; } var f = nameForms(n); if (f.cc && !where) { where = f.cc; } f.forms.forEach(function (x) { all.push(x); }); });
        var ip = parts('i', id), np = all.map(function (n) { return parts('n', n); }), cc = where || ip.cc, out = [];
        np.forEach(function (p) { if (!cc && p.cc) { cc = p.cc; } });
        function add(kind, p) { if (p.base) { out.push(kind + ':' + p.base, kind + ':' + p.base + '.' + (cc || '~')); } }
        add('i', ip);
        np.forEach(function (p) { add('n', p); });
        return { keys: out, cc: cc };
    }
    function hash(s) {
        var h = 0x811c9dc5;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
        return h;
    }
    // The keys as a bitset, base64url: 16 bits a key (1,024 to 1,048,576 in all); a key sets two
    // bits, its hash's and its "~"-hash's, so a big playlist's set still lets few of a guide's
    // other channels through (one bit a key in 131,072 let half of them in).
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    function bitsFor(keys) {
        var n = 1024, bytes = [], i;
        while (n < keys.length * 16 && n < 1048576) { n *= 2; }
        for (i = 0; i < n / 8; i++) { bytes.push(0); }
        keys.forEach(function (k) { if (k) { [hash(k) % n, hash('~' + k) % n].forEach(function (b) { bytes[b >> 3] |= 1 << (b & 7); }); } });
        var out = '';
        for (i = 0; i < bytes.length; i += 3) {
            var v = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
            out += B64.charAt((v >> 18) & 63) + B64.charAt((v >> 12) & 63) + (i + 1 < bytes.length ? B64.charAt((v >> 6) & 63) : '') + (i + 2 < bytes.length ? B64.charAt(v & 63) : '');
        }
        return out;
    }
    // A channel's copies (a merged channel's: IPTV's Merge duplicate channels), else itself.
    function membersOf(c) { return c && c._copies ? c._copies.map(function (x) { return x.c; }) : [c]; }
    // Its country: a copy's tvg-id's (".tr"), else a copy's name's ("TR: …", "… MX"), else its
    // group's ("UK | News": IPTV.countryOf; or a country's name, "→ ARGENTINA ←": PLACE). A region or language isn't one (REGION: "AR" Arabic,
    // "AM" Americas, "AS" Asia, "AF" Africa, "KU" Kurdish).
    var REGION = { ar: 1, am: 1, as: 1, af: 1, eu: 1, ww: 1, ku: 1, arab: 1, latino: 1 };
    function countryOf(c) {
        var ms = membersOf(c), i, cc = '';
        for (i = 0; i < ms.length && !cc; i++) { if (ms[i].tvgId) { cc = parts('i', ms[i].tvgId).cc; } }
        var loose = looseNames();
        for (i = 0; i < ms.length && !cc; i++) { var un = loose ? untagged(ms[i], ms[i].name) : { name: ms[i].name, cc: '' }; cc = un.cc || parts('n', un.name).cc; }
        var g = !cc && typeof IPTV !== 'undefined' && IPTV.countryOf ? ('' + IPTV.countryOf(c.group)).toLowerCase() : '';
        if (g && !REGION[g]) { cc = COUNTRY[g] || (/^[a-z]{2}$/.test(g) ? g : ''); }
        if (!cc && c && c.group) { var pl = place(('' + c.group).replace(/[^A-Za-zÀ-ɏ ]+/g, ' ')); if (pl) { cc = pl; } }   // ("→ ARGENTINA ←", "MEXICO")
        return cc;
    }
    // A provider's own tag before a channel's name, which no guide has (2.4.4.7): one before a ":" or
    // "|" ("ENT| Pasiones", "EN: TLNovelas", "LA_HD_MEX:Tlnovelas", "USA**:UNIVISION"; a country in
    // it, MEX or USA, kept as the channel's), or a first word most of its group's channels start
    // with ("ENT GLITZ", "ENT HGTV" in a group of ENT ones: TAG_MIN of them, over half). -> { name,
    // cc }; a plain "TR: …" is left to parts.
    var TAG_MIN = 5, _tags = null, _tagsOf = null;
    function groupTags() {
        var list = typeof IPTV !== 'undefined' && IPTV.channels ? IPTV.channels() : [];
        if (_tagsOf === list && _tags) { return _tags; }
        var count = {}, first = {};
        list.forEach(function (c) {
            var g = c.group || '', w = /^([A-Za-z]{2,5})\s+\S/.exec(c.name || '');
            count[g] = (count[g] || 0) + 1;
            if (w) { var k = g + '\u0001' + w[1].toUpperCase(); first[k] = (first[k] || 0) + 1; }
        });
        _tags = {};
        Object.keys(first).forEach(function (k) { var g = k.split('\u0001')[0]; if (first[k] >= TAG_MIN && first[k] * 2 > count[g]) { _tags[k] = 1; } });
        _tagsOf = list;
        return _tags;
    }
    // (and what a provider adds at the end, which no guide has: "HD" stuck on, "TelefeHD"; a "DASH"
    // or "Latin America" after the name)
    function untail(n) {
        return n.replace(/(?:\s*[\[(][^\])]*[\])])+\s*$/, '').replace(/\s+(?:dash|latin\s*america|latinoam[eé]rica|latam)\s*$/i, '').replace(/^(.*[a-z0-9])(?:FHD|UHD|HD|SD|4K)$/, '$1');
    }
    function untagged(c, name) {
        var n = '' + (name || ''), m = /^\s*([A-Za-z0-9_*]{2,12})\s*[|:]\s*(.{2,})$/.exec(n), cc = '';
        if (m && !COUNTRY[m[1].toLowerCase()]) {
            m[1].toLowerCase().split(/[_*]+/).forEach(function (t) { if (!cc && COUNTRY[t] && t !== 'la' && t !== 'en') { cc = COUNTRY[t]; } });
            return { name: untail(m[2]), cc: cc };
        }
        var w = /^([A-Za-z]{2,5})\s+(\S.*)$/.exec(n);
        if (w && groupTags()[(c.group || '') + '\u0001' + w[1].toUpperCase()] && !COUNTRY[w[1].toLowerCase()]) { return { name: untail(w[2]), cc: '' }; }
        var pm = PREFIX.exec(n.toLowerCase());   // ("ARG: EL TRECE DASH": its country left to parts, its end taken off)
        return { name: pm ? n.slice(0, pm[0].length) + untail(n.slice(pm[0].length)) : untail(n), cc: '' };
    }
    // Its keys in a guide: every copy's tvg-id and name, then its name as shown; in its country,
    // then in a guide that names none (".~"); without a country only when it has none.
    function keysOf(c) {
        var bases = [], seen = {}, cc = countryOf(c), loose = looseNames();
        function add(kind, s) { var p = parts(kind, s), b = p.base && kind + ':' + p.base; if (b && !seen[b]) { seen[b] = 1; bases.push(b); } }
        membersOf(c).forEach(function (m) { if (m.tvgId) { add('i', m.tvgId); } if (loose) { add('n', untagged(m, m.name).name); } add('n', m.name); });
        if (loose) { add('n', untagged(c, c.name).name); }
        add('n', c.name);
        if (!cc) { return bases; }
        return bases.map(function (b) { return b + '.' + cc; }).concat(bases.map(function (b) { return b + '.~'; }));
    }

    // A playlist's guide: yours (p.guide), else the first the playlist names (url-tvg), else an
    // Xtream get.php link's xmltv.php (the same login; also in place of a guide the playlist
    // names on its own server without the login). '' when none.
    function param(q, name) {
        var m = new RegExp('(?:^|&)' + name + '=([^&#]*)').exec(q || '');
        if (!m) { return ''; }
        try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
    }
    function guideUrl(p, named) {
        if (p && p.guide) { return p.guide; }
        var g = (named || []).filter(function (u) { return !!U.parseUrl(u) && /^https?:\/\//i.test(u); })[0];
        var u = U.parseUrl(p && p.url), xt = '';
        if (u && /\/get\.php$/i.test(u.path)) {
            var user = param(u.query, 'username'), pass = param(u.query, 'password');
            if (user && pass) { xt = u.scheme + '://' + u.host + (u.port ? ':' + u.port : '') + u.path.replace(/get\.php$/i, 'xmltv.php') + '?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass); }
        }
        var gu = g && U.parseUrl(g);
        if (g && xt && gu && gu.host === u.host && gu.port === u.port && !param(gu.query, 'username')) { return xt; }   // (its own server's, without the login)
        return g || xt;
    }

    // Extra TV guides (Settings › Content › IPTV › TV guide, none until you add them): XMLTV links read by the
    // service after each playlist's own guide, for the channels it gives no programs (see
    // service/index.js, epgSources), EXTRAS_MAX at most. EXTRA_CATALOG: epgshare01's free guides
    // by country (updated daily), offered to pick from, never added on their own.
    var EXTRAS_KEY = 'stremiok.iptv.extraguides', EXTRAS_MAX = 6, EXTRA_BASE = 'https://epgshare01.online/epgshare01/epg_ripper_';
    var EXTRA_CATALOG = { ae: ['AE1'], al: ['AL1'], ar: ['AR1'], at: ['AT1'], au: ['AU1'], ba: ['BA1'], bb: ['BB1'], be: ['BE2'], bg: ['BG1'], br: ['BR1', 'BR2'], ca: ['CA2'], ch: ['CH1'],
        cl: ['CL1'], co: ['CO1'], cr: ['CR1'], cy: ['CY1'], cz: ['CZ1'], de: ['DE1'], dk: ['DK1'], 'do': ['DO1'], ec: ['EC1'], eg: ['EG1'], es: ['ES1'], fi: ['FI1'], fr: ['FR1'], gr: ['GR1'],
        hk: ['HK1'], hr: ['HR1'], hu: ['HU1'], id: ['ID1'], ie: ['IE1'], il: ['IL1'], 'in': ['IN1', 'IN2', 'IN4'], it: ['IT1'], jm: ['JM1'], jp: ['JP1', 'JP2'], ke: ['KE1'], kr: ['KR1'], kz: ['KZ1'],
        lt: ['LT1'], lu: ['LU1'], lv: ['LV1'], mn: ['MN1'], mt: ['MT1'], mx: ['MX1'], my: ['MY1'], ng: ['NG1'], nl: ['NL1'], no: ['NO1'], nz: ['NZ1'], pa: ['PA1'], pe: ['PE1'], ph: ['PH1', 'PH2'],
        pk: ['PK1'], pl: ['PL1'], pt: ['PT1'], ro: ['RO1', 'RO2'], rs: ['RS1'], sa: ['SA1', 'SA2'], se: ['SE1'], sg: ['SG1'], sk: ['SK1'], sv: ['SV1'], th: ['TH1'], tr: ['TR1', 'TR3'], ua: ['UA1'],
        uk: ['UK1'], us: ['US2', 'US_SPORTS1', 'US_LOCALS1'], uy: ['UY1'], vn: ['VN1'], za: ['ZA1'] };
    function extraUrl(file) { return EXTRA_BASE + file + '.xml.gz'; }
    function extraGuides() {
        var l = U.store.get(EXTRAS_KEY, []) || [];
        return (Array.isArray(l) ? l : []).filter(function (u) { return typeof u === 'string' && /^https?:\/\/[^\s|#]+$/i.test(u); }).slice(0, EXTRAS_MAX);
    }
    function setExtraGuides(list) {
        var seen = {}, out = (list || []).map(function (u) { return ('' + u).trim(); }).filter(function (u) { if (!/^https?:\/\/[^\s|#]+$/i.test(u) || seen[u]) { return false; } seen[u] = 1; return true; }).slice(0, EXTRAS_MAX);
        if (out.length) { U.store.set(EXTRAS_KEY, out); } else { U.store.remove(EXTRAS_KEY); }
        reset();
        return out;
    }
    // epgshare01's guides to pick from: [{ url, file, cc, n (your channels from that country) }],
    // the countries you have channels from first (most first), then the rest.
    function extraCatalog() {
        var n = {}, out = [];
        (typeof IPTV !== 'undefined' && IPTV.channels ? IPTV.channels() : []).forEach(function (c) { var cc = countryOf(c); if (cc) { n[cc] = (n[cc] || 0) + 1; } });
        Object.keys(EXTRA_CATALOG).forEach(function (cc) { EXTRA_CATALOG[cc].forEach(function (f) { out.push({ url: extraUrl(f), file: f, cc: cc, n: n[cc] || 0 }); }); });
        return out.sort(function (a, b) { return b.n - a.n || (a.cc < b.cc ? -1 : a.cc > b.cc ? 1 : 0); });
    }
    // A guide's link with the extra ones after "#extra=" (never sent: a link's part after # stays
    // here), or the first extra one's when the playlist has no guide of its own; and "names=loose"
    // when TV guide names is set so (the service reads guides' other name forms then).
    function withExtras(url, extras, loose) {
        if (!url && extras.length) { url = extras[0]; extras = extras.slice(1); }
        if (!url) { return ''; }
        var frag = [];
        if (extras.length) { frag.push('extra=' + encodeURIComponent(extras.join('|'))); }
        if (loose) { frag.push('names=loose'); }
        return url + (frag.length ? '#' + frag.join('&') : '');
    }

    function available() { return typeof YTPlay !== 'undefined' && !!YTPlay.epgLoad && YTPlay.installMode() !== 'browser'; }

    // ---- the guides: asked to read, then waited for ----
    var _guides = {};    // url -> { k, state, at, channels, programmes, partial, error, timer }
    var _byList = {};    // playlist id -> its guide's url ('' none)
    var POLL_MS = [300, 300, 600, 1000, 2000], POLL_MS_LATER = 3000, POLLS = 300, CHECK_MS = 60 * 60 * 1000;
    // Every playlist's guide asked for (again: the service reads one only when it's old), for
    // its channels' keys. After the playlists are read, and every hour. again: a playlist's id,
    // or true for all (its Reload, IPTV.reload): their guides read again now, however new.
    function start(again) {
        if (!available() || typeof IPTV === 'undefined' || !IPTV.channels) { return; }
        var byGuide = {}, force = {};
        _byList = {};
        IPTV.getPlaylists().forEach(function (p) {
            if (p.off) { return; }
            var st = IPTV.status(p.id), url = withExtras(guideUrl(p, st && st.guides), extraGuides(), looseNames());
            _byList[p.id] = url;
            if (url && !byGuide[url]) { byGuide[url] = []; }
            if (url && (again === true || again === p.id)) { force[url] = true; }
        });
        IPTV.channels().forEach(function (c) {
            var url = _byList[c._playlistId];
            if (url) { byGuide[url].push.apply(byGuide[url], keysOf(c)); }
        });
        var gone = false;
        Object.keys(_guides).forEach(function (url) {   // (a guide no playlist uses any more: dropped)
            if (byGuide[url]) { return; }
            if (_guides[url].timer) { clearTimeout(_guides[url].timer); }
            delete _guides[url];
            forget(url);
            gone = true;
        });
        Object.keys(byGuide).forEach(function (url) { if (byGuide[url].length) { loadGuide(url, bitsFor(byGuide[url]), !!force[url]); } });
        if (!_checker) { _checker = setInterval(function () { start(); }, CHECK_MS); }
        if (gone) { changed(); }
    }
    var _checker = null;
    function loadGuide(url, k, force) {
        var g = _guides[url];
        if (!g || g.k !== k || force) { if (g && g.timer) { clearTimeout(g.timer); } g = _guides[url] = { k: k, state: 'loading' }; }
        else if (g.timer || g.asking) { return; }
        (function ask(n) {
            g.asking = true;
            YTPlay.epgLoad(url, k, force && !n).then(function (r) {
                g.asking = false;
                if (_guides[url] !== g) { return; }
                var was = g.state + '|' + g.at;
                ['state', 'at', 'channels', 'programmes', 'partial', 'error'].forEach(function (f) { g[f] = r && r[f]; });
                if (g.state === 'loading' && n < POLLS) { g.timer = setTimeout(function () { g.timer = null; ask(n + 1); }, n < POLL_MS.length ? POLL_MS[n] : POLL_MS_LATER); }
                if (g.state + '|' + g.at !== was) {
                    if (g.state === 'ready') { _gen++; forget(url); }   // (read again: what's on, and the Guide tab's grid, asked again)
                    changed();
                }
            }, function () {
                g.asking = false;
                if (_guides[url] !== g) { return; }
                g.state = 'failed'; g.error = U.t('StremioK’s service didn’t answer');
                changed();
            });
        })(0);
    }
    // For Settings › IPTV: a playlist's guide and how it stands, or null when it has none.
    function status(playlistId) {
        var url = _byList[playlistId];
        if (!url) { return null; }
        var g = _guides[url] || { state: 'loading' };
        return { url: url, state: g.state, at: g.at || 0, channels: g.channels || 0, programmes: g.programmes || 0, partial: !!g.partial, error: g.error || '' };
    }

    // ---- programs: asked for in batches, kept per channel ----
    var _progs = {};     // channel id -> { at, list: [{ start, stop, title, desc }], full (the whole window) }
    var _icons = {};     // channel id -> its guide's logo (for one the playlist gives none: logo)
    var _want = {}, _wantTimer = null, _asking = 0, BATCH = 60, PROG_MS = 30 * 60 * 1000;
    function channelOf(id) { return (typeof IPTV !== 'undefined' && IPTV.channel) ? IPTV.channel(id) : null; }
    function guideOf(c) { var url = c && _byList[c._playlistId], g = url && _guides[url]; return (g && g.state === 'ready') ? url : ''; }
    function forget(url) { Object.keys(_progs).forEach(function (id) { if (_progs[id].url === url) { delete _progs[id]; } }); }
    function want(ids) {
        (ids || []).forEach(function (id) { if (/^iptv:/.test(id || '')) { _want[id] = 1; } });
        if (!_wantTimer) { _wantTimer = setTimeout(flush, 50); }
    }
    function nowSec() { return Math.floor(Date.now() / 1000); }
    function asList(rows, url) {
        return (rows || []).filter(function (r) { return r && r.length >= 3 && r[1] > r[0]; })
            .map(function (r) {
                var p = { start: +r[0], stop: +r[1], title: '' + r[2], desc: '' + (r[3] || ''), picture: (typeof r[4] === 'string' && U.parseUrl(r[4]) && !(U.urlIsPrivate(r[4]) && !U.urlIsPrivate(url || ''))) ? r[4] : '' };   // (no picture into your home network from a guide on the internet)
                var a = r[5];   // (what it is, from the guide's categories: a film's original title and year)
                if (a && typeof a === 'object') {
                    if (a.m === 'movie' || a.m === 'series') { p.kind = a.m; }
                    if (typeof a.o === 'string' && a.o) { p.orig = a.o.slice(0, 120); }
                    if (+a.y >= 1900 && +a.y <= 2100) { p.year = +a.y; }
                }
                return p;
            });
    }
    // One request a guide at a time per batch (BATCH channels): from now, the next few.
    function flush() {
        _wantTimer = null;
        if (_asking) { _wantTimer = setTimeout(flush, 200); return; }
        var byGuide = {};
        Object.keys(_want).forEach(function (id) {
            var c = channelOf(id), url = guideOf(c);
            if (!url) { return; }   // (no guide, or not read yet: asked again once it is)
            delete _want[id];
            if (fresh(id)) { return; }
            (byGuide[url] = byGuide[url] || []).push(c);
        });
        Object.keys(byGuide).forEach(function (url) {
            var list = byGuide[url];
            for (var i = 0; i < list.length; i += BATCH) { ask(url, list.slice(i, i + BATCH), nowSec(), nowSec() + 6 * 3600, 4, false); }
        });
    }
    function ask(url, chans, from, to, max, full) {
        var keys = [], gen = _gen;
        chans.forEach(function (c) { keys.push.apply(keys, keysOf(c)); });
        _asking++;
        // Resolves { id: programs } for the channels answered ([] when none, or not in the guide),
        // and _unknown: the ids not answered (failed, cut off, not read there, or the guides
        // changed since): kept as they were and asked again, never taken as empty.
        function unknown() { var o = {}; o._unknown = chans.map(function (c) { return c.id; }); return o; }
        return YTPlay.epgGet(url, keys, from, to, max).then(function (r) {
            _asking--;
            if (gen !== _gen || !r || typeof r !== 'object' || r._unread) { return unknown(); }   // (the guides changed since, or no answer to read)
            var cut = {};
            (Array.isArray(r._cut) ? r._cut : []).forEach(function (k) { cut[k] = 1; });
            var out = {}, icons = (r._icons && typeof r._icons === 'object') ? r._icons : {};
            var unk = [];
            chans.forEach(function (c) {
                if (_byList[c._playlistId] !== url) { unk.push(c.id); return; }   // (its playlist's guide is another now)
                var ks = keysOf(c), rows = null;
                for (var i = 0; i < ks.length && !rows; i++) { if (Array.isArray(r[ks[i]])) { rows = r[ks[i]]; } }
                if (!rows && ks.some(function (k) { return cut[k]; })) { unk.push(c.id); return; }   // (cut off: not answered)
                for (var j = 0; j < ks.length; j++) {
                    var icon = icons[ks[j]];
                    // (a guide on the internet can't point one into your home network)
                    if (typeof icon === 'string' && U.parseUrl(icon) && !(U.urlIsPrivate(icon) && !U.urlIsPrivate(url))) { _icons[c.id] = icon; break; }
                }
                var e = { at: Date.now(), url: url, list: asList(rows, url), full: full };
                if (!full && _progs[c.id] && _progs[c.id].full && _progs[c.id].at > Date.now() - PROG_MS) { return; }   // (a whole schedule kept)
                _progs[c.id] = e;
                out[c.id] = e.list;
            });
            trimProgs();
            if (unk.length) { out._unknown = unk; }
            changed();
            return out;
        }, function () { _asking--; return unknown(); });
    }
    // Programs kept for PROGS_KEEP channels at most (the ones read longest ago go first): a long
    // session going through thousands of channels doesn't keep them all.
    var PROGS_KEEP = 400;
    function trimProgs() {
        var ids = Object.keys(_progs);
        if (ids.length <= PROGS_KEEP) { return; }
        ids.sort(function (a, b) { return _progs[a].at - _progs[b].at; }).slice(0, ids.length - PROGS_KEEP).forEach(function (id) { delete _progs[id]; });
    }
    function fresh(id) {
        var e = _progs[id];
        if (!e || Date.now() - e.at > PROG_MS) { return false; }
        var t = nowSec();
        return !e.list.length || e.list[e.list.length - 1].stop > t;   // (what's on, still in what was read)
    }
    // What's on now, and next: { now, next } (either may be null), or null without a guide.
    function now(id) {
        var c = channelOf(id);
        if (!c || !guideOf(c)) { return null; }
        if (!fresh(id)) { want([id]); }
        var e = _progs[id];
        if (!e || e.url !== guideOf(c)) { return null; }
        var t = nowSec(), cur = null, next = null;
        for (var i = 0; i < e.list.length; i++) {
            var p = e.list[i];
            if (!cur && p.start <= t && t < p.stop) { cur = p; continue; }
            if (p.start > t && (!next || p.start < next.start)) { next = p; break; }
        }
        return (cur || next) ? { now: cur, next: next } : null;
    }
    // A channel's schedule, from 2 hours ago to tomorrow: Promise of [{ start, stop, title, desc }].
    function schedule(id) {
        var c = channelOf(id), url = guideOf(c);
        if (!url) { return Promise.resolve([]); }
        return ask(url, [c], nowSec() - 2 * 3600, nowSec() + 30 * 3600, 150, true).then(function (out) { return out[id] || []; });
    }
    function hasGuide(id) { return !!guideOf(channelOf(id)); }
    // A channel's logo from its guide ('' when it gave none, or not asked yet).
    function logo(id) { return _icons[id] || ''; }
    // Whether any guide was read with channels in it (the Guide tab shows then), and the channels
    // that have a guide, in the IPTV tab's order.
    function hasAny() {
        return Object.keys(_byList).some(function (id) { var g = _guides[_byList[id]]; return !!g && g.state === 'ready' && g.channels > 0; });
    }
    function guided() {   // (your favorites first)
        var all = (typeof IPTV !== 'undefined' && IPTV.channels ? IPTV.channels() : []).filter(function (c) { return !!guideOf(c); });
        var fav = IPTV.isFavorite ? all.filter(function (c) { return IPTV.isFavorite(c.id); }) : [];
        return fav.concat(all.filter(function (c) { return fav.indexOf(c) === -1; }));
    }
    // Many channels' programs from 'from' to 'to' (the Guide tab): Promise of { id: programs },
    // RANGE_BATCH channels a request (each answer kept to 2 MB by the service: 150 programs
    // a channel with their pictures and descriptions fit).
    var RANGE_BATCH = 20;
    function range(ids, from, to) {
        var byGuide = {}, jobs = [];
        (ids || []).forEach(function (id) { var c = channelOf(id), url = guideOf(c); if (url) { (byGuide[url] = byGuide[url] || []).push(c); } });
        Object.keys(byGuide).forEach(function (url) {
            var list = byGuide[url];
            for (var i = 0; i < list.length; i += RANGE_BATCH) { jobs.push(ask(url, list.slice(i, i + RANGE_BATCH), Math.floor(from), Math.ceil(to), 150, true)); }
        });
        return Promise.all(jobs).then(function (outs) {
            var all = {}, unknown = [];
            outs.forEach(function (o) { Object.keys(o || {}).forEach(function (id) { if (id === '_unknown') { unknown = unknown.concat(o._unknown); } else { all[id] = o[id]; } }); });
            if (unknown.length) { all._unknown = unknown; }   // (not answered: see ask)
            return all;
        });
    }

    // Diagnostics › TV guide matches: for every channel, the guide's channel it got and what's on
    // it now, or why none. Promise of { rows: [{ c, state, guide, gid, now }], guides: [{ host,
    // state, channels, partial }] }; state: 'ok', 'empty' (in the guide, nothing on now), 'unclear'
    // (its name is two countries' channels'), 'none' (not in its guide), 'noguide' (its playlist
    // has none read), 'failed' (not answered). Never a guide's link (an Xtream one has the login).
    function matchReport() {
        if (!available() || typeof IPTV === 'undefined' || !IPTV.channels) { return Promise.resolve({ rows: [], guides: [] }); }
        var rows = [], byGuide = {}, jobs = [], t = nowSec();
        function host(url) { var u = U.parseUrl(url); return u ? u.host : '?'; }
        function source(url, gid) {   // (an extra guide's channel, "x2:…": that guide's host or epgshare01 file)
            var m = /^x(\d+):/.exec(gid || ''), e = /[#&]extra=([^&]*)/.exec(url);
            if (!m || !e) { return host(url.split('#')[0]); }
            var x = '';
            try { x = decodeURIComponent(e[1]).split('|')[+m[1] - 1] || ''; } catch (e2) {}
            var f = /epg_ripper_([A-Z0-9_]+)\.xml/.exec(x);
            return f ? 'epgshare01 ' + f[1] : host(x);
        }
        IPTV.channels().forEach(function (c) {
            if (c.guideOnly) { return; }
            var url = guideOf(c);
            if (!url) { rows.push({ c: c, state: 'noguide' }); return; }
            (byGuide[url] = byGuide[url] || []).push(c);
        });
        Object.keys(byGuide).forEach(function (url) {
            var list = byGuide[url];
            for (var i = 0; i < list.length; i += BATCH) {
                jobs.push((function (chans) {
                    var keys = [];
                    chans.forEach(function (c) { keys.push.apply(keys, keysOf(c)); });
                    return YTPlay.epgGet(url, keys, t - 60, t + 60, 1, true).then(function (r) {
                        var ids = (r && r._ids) || {}, amb = {}, cut = {};
                        ((r && r._amb) || []).forEach(function (k) { amb[k] = 1; });
                        ((r && r._cut) || []).forEach(function (k) { cut[k] = 1; });
                        chans.forEach(function (c) {
                            var ks = keysOf(c), hit = '';
                            for (var j = 0; j < ks.length && !hit; j++) { if (ids[ks[j]]) { hit = ks[j]; } }
                            var row = { c: c, guide: host(url), state: 'none' };
                            if (hit) {
                                var l = Array.isArray(r[hit]) ? r[hit] : [];
                                row.state = l.length ? 'ok' : 'empty'; row.gid = ('' + ids[hit]).replace(/^x\d+:/, ''); row.guide = source(url, ids[hit]); row.now = l.length ? '' + (l[0][2] || '') : '';
                            } else if (ks.some(function (k) { return amb[k]; })) { row.state = 'unclear'; }
                            else if (!r || r._unread || ks.some(function (k) { return cut[k]; })) { row.state = 'failed'; }
                            rows.push(row);
                        });
                    }, function () { chans.forEach(function (c) { rows.push({ c: c, guide: host(url), state: 'failed' }); }); });
                })(list.slice(i, i + BATCH)));
            }
        });
        return Promise.all(jobs).then(function () {
            var guides = Object.keys(_guides).map(function (url) { var g = _guides[url]; return { host: host(url.split('#')[0]) + (/[#&]extra=/.test(url) ? ' + ' + U.t('extra guides') : ''), state: g.state, channels: g.channels || 0, partial: !!g.partial }; });
            return { rows: rows, guides: guides };
        });
    }

    // 20:30, or with the day when it isn't today (Tue 01:00).
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function hhmm(sec) { var d = U.localDate(sec * 1000); return two(d.getHours()) + ':' + two(d.getMinutes()); }
    function dayTime(sec) {
        var d = U.localDate(sec * 1000), today = U.localDate();
        var same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
        return (same ? '' : U.weekday(d.getDay()) + ' ') + hhmm(sec);
    }

    // Told when a guide is read or programs arrive (once for a burst).
    var _fns = [], _changeTimer = null;
    function onChange(fn) { _fns.push(fn); }
    function changed() {
        if (_changeTimer) { return; }
        _changeTimer = setTimeout(function () {
            _changeTimer = null;
            if (Object.keys(_want).length && !_wantTimer) { _wantTimer = setTimeout(flush, 50); }   // (asked before the guide was read)
            _fns.forEach(function (fn) { try { fn(); } catch (e) {} });
        }, 60);
    }
    // The guide links changed (a playlist's Guide link, its link, its channels): asked again.
    // An answer asked before (an older _gen) is dropped when it comes.
    var _gen = 0;
    function reset() { _gen++; _progs = {}; _icons = {}; _want = {}; start(); }

    return {
        generation: function () { return _gen; },   // (changes when the guides do: what was read before isn't theirs)
        looseNames: looseNames, setLooseNames: setLooseNames, matchReport: matchReport, extraGuides: extraGuides, setExtraGuides: setExtraGuides, extraCatalog: extraCatalog, withExtras: withExtras, EXTRAS_MAX: EXTRAS_MAX,
        key: key, guideKeys: guideKeys, keysOf: keysOf, countryOf: countryOf, bitsFor: bitsFor, guideUrl: guideUrl, available: available, start: start, reset: reset, status: status,
        want: want, now: now, schedule: schedule, hasGuide: hasGuide, logo: logo, hasAny: hasAny, guided: guided, range: range, onChange: onChange, hhmm: hhmm, dayTime: dayTime
    };
})();
