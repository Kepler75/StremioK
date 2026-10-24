/* ViewParts: the Guide tab: the IPTV channels' TV guide as a grid (js/epg.js).
   A row a channel that has a guide (in the IPTV tab's order, favorites first), across SPAN from
   the current half hour, a line at the time now. Only ROWS rows are drawn at a time: ↑ / ↓ past
   them move the window along, through every channel; programs are read for the rows drawn and
   the AHEAD after them (a row not read yet says so until they come). Each program knows its
   neighbors (Focus's __go hooks): ← / → the program before / after it (the hours move along past
   an edge, never back before the current half hour for one still on), ↑ / ↓ the channel above /
   below, at the same time. Home's details strip describes the focused program; OK on what's on
   now plays the channel, on another says what it is. A guide-only channel's (tvg-type="guide":
   watched elsewhere) any program: the film looked up in your addons (findInAddons). Hold OK on
   a program: Watch now, the channel's favorites, Find in your addons (hold). */
(function (V) {
    'use strict';
    function scr() { return V.scr.apply(null, arguments); }   // core
    function pickList() { return V.pickList.apply(null, arguments); }   // core
    function refreshAddonRows() { return V.refreshAddonRows.apply(null, arguments); }   // home

    var SPAN = 150 * 60, STEP = 30 * 60, ROWS = 10, AHEAD = 10;
    var _g = null;   // the grid on screen: { el, start, chans, lists: { id: programs }, asked: { id: 1 }, top, nodes: [row: cells], box }
    function floorStep(t) { return Math.floor(t / STEP) * STEP; }
    function pct(x) { return Math.round(x * 10000) / 100; }

    // Drawn again soon after (Home redrawn, the tab picked again): from what the grid before had
    // read (REUSE_MS), the same channels in the same window and hours, focus where it was;
    // no "Reading…" between, nothing asked again.
    var REUSE_MS = 5 * 60 * 1000;
    function guideGrid(rows) {
        stopFinding();   // (a lookup from the grid drawn before: stopped)
        var now = Date.now() / 1000, chans = EPG.guided(), was = _g;
        var g = _g = { el: rows, start: floorStep(now), live: true, chans: chans, lists: {}, asked: {}, failed: {}, got: {}, top: 0, nodes: [], at: Date.now(), gen: EPG.generation ? EPG.generation() : 0 };   // (live: the hours show the present, and follow the clock: tick)
        if (!chans.length) { rows.appendChild(U.el('div', 'row-empty', 'No TV guide yet (Settings › Content › IPTV › Guide link).')); return; }
        if (was && was.at && Date.now() - was.at < REUSE_MS && was.gen === g.gen && sameChans(was, chans)) {
            var f = Focus.current(), want = (f && was.box && was.box.contains(f) && f.__chan) ? (f.__loading ? { id: f.__chan, t: f.__t } : { id: f.__chan, start: f.__p.start }) : null;
            g.lists = was.lists; g.asked = was.asked; g.failed = was.failed || {}; g.got = was.got || {}; g.at = was.at; g.top = was.top;
            g.chans = chans.filter(function (c) { return !(c.id in g.lists) || g.lists[c.id].length; });
            if (!was.live) { g.start = was.start; g.live = false; }
            var n = draw(g, want), cur = Focus.current();   // (focus: back on the cell it was on; else as when first drawn)
            if (n && (want || !cur || !document.documentElement.contains(cur) || /\b(tab-pill|hchip)\b/.test(cur.className || ''))) { Focus.setScope(scr('home'), n); }
            return;
        }
        rows.appendChild(U.el('div', 'row-empty guide-loading', 'Reading the TV guide…'));
        ensure(g).then(function () {
            if (_g !== g || !document.documentElement.contains(rows)) { return; }
            var first = draw(g);
            var cur = Focus.current();   // (focus still where the tab was picked: onto what's on now)
            if (first && (!cur || !document.documentElement.contains(cur) || /\b(tab-pill|hchip)\b/.test(cur.className || '') || rows.contains(cur))) { Focus.setScope(scr('home'), first); }
        });
    }

    function sameChans(was, chans) {   // (the same channels as the grid before: none added, none gone)
        var ids = {}, n = 0;
        was.chans.forEach(function (c) { ids[c.id] = 1; });
        Object.keys(was.lists).forEach(function (id) { if (!ids[id] && !was.lists[id].length) { ids[id] = 1; } });   // (dropped for having nothing)
        for (var i = 0; i < chans.length; i++) { if (!ids[chans[i].id]) { return false; } n++; }
        return n >= was.chans.length;
    }
    // The programs of the rows drawn and the AHEAD after them, those not asked for yet (from 2
    // hours ago to 30 ahead: the hours move without asking again). A channel with nothing at all
    // in that time is dropped once read. Resolves once they're in.
    // What's kept: the programs of the channels within KEEP rows of the window, read in the last
    // KEEP_MS (older, or further off: let go, read again if they're come back to); all of it,
    // once the guides changed (EPG's generation).
    var KEEP = 40, KEEP_MS = 2 * 3600 * 1000;
    function prune(g) {
        if (EPG.generation && g.gen !== EPG.generation()) { g.gen = EPG.generation(); g.lists = {}; g.asked = {}; g.failed = {}; g.got = {}; return; }
        var near = {}, now = Date.now();
        g.chans.slice(Math.max(0, g.top - KEEP), g.top + ROWS + AHEAD + KEEP).forEach(function (c) { near[c.id] = 1; });
        Object.keys(g.lists).forEach(function (id) {
            if (!g.lists[id].length) { return; }   // (known to have nothing: kept, it's what keeps it off the grid)
            if (!near[id] || now - (g.got[id] || 0) > KEEP_MS) { delete g.lists[id]; delete g.asked[id]; delete g.got[id]; }
        });
    }
    function ensure(g) {
        prune(g);
        var ids = g.chans.slice(g.top, g.top + ROWS + AHEAD).filter(function (c) { return !g.asked[c.id]; }).map(function (c) { g.asked[c.id] = 1; return c.id; });
        if (!ids.length) { return Promise.resolve(false); }
        var now = Date.now() / 1000;
        return EPG.range(ids, now - 2 * 3600, now + 30 * 3600).then(function (lists) {
            var unknown = {};
            ((lists && lists._unknown) || []).forEach(function (id) { unknown[id] = 1; });
            ids.forEach(function (id) {
                if (unknown[id]) { delete g.asked[id]; g.failed[id] = 1; return; }   // (not answered: kept, asked again)
                delete g.failed[id];
                g.lists[id] = (lists && lists[id]) || [];
                g.got[id] = Date.now();
            });
            g.chans = g.chans.filter(function (c) { return !(c.id in g.lists) || g.lists[c.id].length; });
            g.top = Math.max(0, Math.min(g.top, g.chans.length - ROWS));
            if (Object.keys(unknown).length) { retryLater(g); }
            return true;
        }, function () { ids.forEach(function (id) { delete g.asked[id]; g.failed[id] = 1; }); retryLater(g); return true; });
    }
    // Channels whose programs didn't come (the service didn't answer, or not all of it): asked
    // again RETRY_MS later, while the grid is still on screen; their rows say so meanwhile.
    var RETRY_MS = 30000;
    function retryLater(g) {
        if (g.retry) { return; }
        g.retry = setTimeout(function () {
            g.retry = null;
            if (_g !== g || !g.box || !document.documentElement.contains(g.box)) { return; }
            ensure(g).then(function (got) { if (got) { refresh(g); } });
        }, RETRY_MS);
    }
    // Rows read after the grid was drawn: drawn again, focus kept where it was (a "Loading…" row's:
    // that row, at the same time).
    function refresh(g) {
        if (_g !== g || !g.box || !document.documentElement.contains(g.box)) { return; }
        var cur = Focus.current(), mine = cur && g.box.contains(cur), want = null;
        if (mine && cur.__p) { want = cur.__loading ? { id: cur.__chan, t: cur.__t } : { id: cur.__chan, start: cur.__p.start }; }
        var n = draw(g, want);
        if (mine && n) { Focus.setScope(scr('home'), n); }
    }
    // The guides changed (EPG's generation) while the grid is on screen: what it had let go, the
    // rows on screen read again.
    if (typeof EPG !== 'undefined' && EPG.onChange) {
        EPG.onChange(function () {
            var g = _g;
            if (!g || !g.box || !document.documentElement.contains(g.box) || !EPG.generation || g.gen === EPG.generation()) { return; }
            ensure(g).then(function (got) { if (got) { refresh(g); } });
        });
    }
    // The window moved to show row r (↑ / ↓): the rows to read next asked for, and drawn again once in.
    function showRow(g, r) {
        if (r < g.top) { g.top = r; } else if (r >= g.top + ROWS) { g.top = r - ROWS + 1; }
        ensure(g).then(function (got) { if (got) { refresh(g); } });
    }

    // The grid for g.start, rows g.top to g.top + ROWS: the hours, then a row a channel. Returns
    // the cell wanted: { id, start } that program, { id, t } that channel's at time t; else
    // what's on now on the first channel drawn.
    function draw(g, want) {
        var old = g.el.querySelector('.guide'), loading = g.el.querySelector('.guide-loading');
        if (loading) { loading.parentNode.removeChild(loading); }
        var box = U.el('div', 'guide'), now = Date.now() / 1000, end = g.start + SPAN, found = null, first = null;
        var head = U.el('div', 'guide-head'), hours = U.el('div', 'guide-hours');
        head.appendChild(U.el('div', 'guide-corner', EPG.dayTime(g.start).length > 5 ? EPG.dayTime(g.start).split(' ')[0] : 'Today'));
        for (var t = g.start; t < end; t += STEP) {
            var mark = U.el('div', 'guide-time', EPG.hhmm(t));
            mark.setAttribute('style', 'left: ' + pct((t - g.start) / SPAN) + '%');
            hours.appendChild(mark);
        }
        head.appendChild(hours);
        box.appendChild(head);
        g.nodes = [];
        var any = false;
        g.chans.slice(g.top, g.top + ROWS).forEach(function (c, k) {
            var r = g.top + k, row = U.el('div', 'guide-row'), track = U.el('div', 'guide-track'), nodes = [], onNode = null;
            var name = U.el('div', 'guide-ch'), logo = c.logo || EPG.logo(c.id);
            if (logo && U.cardImage(logo, 'logo')) {
                var img = U.el('img', 'guide-ch-logo');
                img.onerror = function () { if (img.parentNode) { img.parentNode.removeChild(img); } };
                name.appendChild(img);
                U.deferImage(img, U.cardImage(logo, 'logo'));
            }
            name.appendChild(document.createTextNode(c.name));
            row.appendChild(name);
            function hooks(n, i) {
                n.__row = r; n.__chan = c.id;
                n.__goLEFT = function () { return i < 0 ? false : step(g, r, i, -1); };
                n.__goRIGHT = function () { return i < 0 ? false : step(g, r, i, 1); };
                n.__goUP = function () { return vertical(g, r, -1, n); };
                n.__goDOWN = function () { return vertical(g, r, 1, n); };
            }
            if (!(c.id in g.lists)) {   // (not read yet: says so, and can be passed through)
                var wait = U.el('div', 'guide-prog guide-wait focusable', g.failed[c.id] ? 'Its TV guide didn’t come: asked again shortly' : 'Loading…');
                wait.setAttribute('style', 'left: 0%; width: 100%');
                wait.__p = { start: g.start, stop: end, title: '' }; wait.__loading = true;
                wait.__t = want && want.id === c.id && typeof want.t === 'number' ? want.t : Math.max(now, g.start);
                wait.__meta = { name: c.name, releaseInfo: 'Reading its TV guide…' };
                hooks(wait, -1);
                wait.__onlongpress = function () { hold(g, r, null); };
                track.appendChild(wait);
                nodes.push(wait);
                if (want && want.id === c.id) { found = wait; }
            } else {
                g.lists[c.id].forEach(function (p, i) {
                    if (p.stop <= g.start || p.start >= end) { return; }
                    var on = p.start <= now && now < p.stop, a = Math.max(p.start, g.start), b = Math.min(p.stop, end);
                    var n = U.el('div', 'guide-prog focusable' + (on ? ' now' : ''), p.title);
                    n.setAttribute('style', 'left: ' + pct((a - g.start) / SPAN) + '%; width: ' + pct((b - a) / SPAN) + '%');
                    n.__meta = { name: p.title, releaseInfo: c.name + '   ·   ' + EPG.dayTime(p.start) + '–' + EPG.hhmm(p.stop) + (c.guideOnly ? '   ·   OK: find it in your addons' : ''), description: p.desc, picture: p.picture };
                    n.__p = p; n.__i = i;
                    n.__onselect = function () { pick(g, r, p); };
                    n.__onlongpress = function () { hold(g, r, p); };
                    hooks(n, i);
                    track.appendChild(n);
                    nodes.push(n);
                    any = true;
                    if (want && want.id === c.id && want.start === p.start) { found = n; }
                    if (on) { onNode = n; }
                });
                if (want && want.id === c.id && typeof want.t === 'number' && !found) { found = at(nodes, want.t, g.start) || null; }   // (a time, 0 too)
            }
            if (k === 0) { first = onNode || nodes[0] || null; }
            if (now >= g.start && now < end) {
                var line = U.el('div', 'guide-nowline');
                line.setAttribute('style', 'left: ' + pct((now - g.start) / SPAN) + '%');
                track.appendChild(line);
            }
            row.appendChild(track);
            box.appendChild(row);
            g.nodes[r] = nodes;
        });
        if (!any && g.chans.slice(g.top, g.top + ROWS).every(function (c) { return c.id in g.lists; })) {
            box.appendChild(U.el('div', 'row-empty guide-empty', 'Nothing on any channel in these hours.'));
        }
        if (old) { g.el.removeChild(old); }   // (the grid is all the tab has)
        g.el.appendChild(box);
        g.box = box;
        if (!_ticker) { _ticker = setInterval(tick, 60000); }
        return found || first || (g.nodes[g.top] && g.nodes[g.top][0]) || null;
    }

    // Every minute, while the grid is on screen: the line at the time now moved along, and what's
    // on now marked again (nothing drawn again: focus and the cells stay). At a new half hour, a
    // grid showing the present moves its hours along (follow). Stops once it's gone.
    var _ticker = null;
    function tick() {
        var g = _g;
        if (!g || !g.box || !document.documentElement.contains(g.box)) { clearInterval(_ticker); _ticker = null; return; }
        if (/\bhidden\b/.test(scr('home').className) || document.hidden) { return; }
        var now = Date.now() / 1000, end = g.start + SPAN;
        if (g.live && g.start < floorStep(now)) { follow(g, now); return; }
        var lines = g.box.querySelectorAll('.guide-nowline');   // (a loop: a NodeList's forEach is newer than the 2017 TV's browser)
        for (var i = 0; i < lines.length; i++) {
            if (now >= g.start && now < end) { lines[i].setAttribute('style', 'left: ' + pct((now - g.start) / SPAN) + '%'); } else { lines[i].setAttribute('style', 'display: none'); }
        }
        (g.nodes || []).forEach(function (nodes) {
            nodes.forEach(function (n) { var on = n.__p.start <= now && now < n.__p.stop; if (on !== /\bnow\b/.test(n.className)) { n.className = on ? n.className + ' now' : n.className.replace(/\s*\bnow\b/, ''); } });
        });
    }
    // The current half hour first again: focus on the program it was on, or (it has ended) what's
    // on now on that channel.
    function follow(g, now) {
        var start = floorStep(now), f = Focus.current(), mine = !!(f && g.box.contains(f)), want = null;
        if (mine && f.__chan) { want = (f.__p && !f.__loading && f.__p.stop > start) ? { id: f.__chan, start: f.__p.start } : { id: f.__chan, t: now }; }
        g.start = start;
        var n = draw(g, want);
        if (mine && n) { Focus.setScope(scr('home'), n); }
    }
    // ← / →: the program before / after this one on its channel; past an edge, the hours move
    // to it (for one still on, never before the current half hour).
    function step(g, r, i, dir) {
        var c = g.chans[r], list = g.lists[c.id] || [], p = list[i + dir];
        if (!p) { return false; }
        if (p.stop <= g.start || p.start >= g.start + SPAN) {
            var now = Date.now() / 1000;
            g.start = dir > 0 ? Math.max(floorStep(p.start) - 2 * STEP, floorStep(now))
                : (p.stop <= now ? floorStep(p.start) : Math.max(floorStep(p.start), floorStep(now)));
            g.live = g.start === floorStep(now);   // (moved away from the present: stays put)
            return draw(g, { id: c.id, start: p.start });
        }
        return find(g, r, p);
    }
    // ↑ / ↓: the next channel up / down with something in these hours (one with nothing in them
    // is passed; one not read yet is stopped at: it says so); from the top row, on up to the menu.
    // Past the rows drawn, the window moves along to it.
    function vertical(g, r, dir, from) {
        var end = g.start + SPAN, t = from.__loading ? from.__t : Math.max(from.__p.start, g.start);
        for (var k = r + dir; k >= 0 && k < g.chans.length; k += dir) {
            var c = g.chans[k], list = g.lists[c.id];
            var has = !list || list.some(function (p) { return p.stop > g.start && p.start < end; });
            if (!has) { continue; }
            if (k >= g.top && k < g.top + ROWS) { return at(g.nodes[k] || [], t, g.start) || false; }
            showRow(g, k);
            return draw(g, { id: c.id, t: t }) || false;
        }
        return dir < 0 ? undefined : false;
    }
    // In a row's cells: the program on at time t (or the window's start, for one that began
    // before it); else the nearest.
    function at(nodes, t, start) {
        var best = null, gap = Infinity;
        for (var i = 0; i < nodes.length; i++) {
            var p = nodes[i].__p;
            if (p.start <= t && t < p.stop) { return nodes[i]; }
            var d = Math.abs(Math.max(p.start, start) - t);
            if (d < gap) { gap = d; best = nodes[i]; }
        }
        return best;
    }
    function find(g, r, p) {
        var nodes = g.nodes[r] || [];
        for (var i = 0; i < nodes.length; i++) { if (nodes[i].__p === p) { return nodes[i]; } }
        return false;
    }
    // OK: what's on now plays the channel; another program says what it is.
    // Played, CH+ / CH− go through the Guide's channels; each one's card (where BACK lands, on
    // the channel you end on) is what's on now on it.
    function pick(g, r, p) {
        var c = g.chans[r], now = Date.now() / 1000;
        if (c.guideOnly) { findInAddons(p); return; }
        if (p.start <= now && now < p.stop) {
            var list = [], idx = 0;
            g.chans.forEach(function (ch, i) {   // (every channel: a cell only for the rows drawn, where BACK lands)
                if (ch.guideOnly) { return; }   // (nothing to play)
                var nodes = g.nodes[i] || [], card = nodes[0] || null;
                for (var j = 0; j < nodes.length; j++) { if (nodes[j].__p.start <= now && now < nodes[j].__p.stop) { card = nodes[j]; break; } }
                if (i === r) { idx = list.length; }
                list.push({ meta: { id: ch.id, type: ch.type, name: ch.name, poster: ch.logo || '', logo: ch.logo || '', posterShape: 'landscape' }, card: card });
            });
            App.openLive(c.type, c.id, list[idx].meta, { list: list, idx: idx });
            return;
        }
        U.toast(EPG.dayTime(p.start) + '–' + EPG.hhmm(p.stop) + '   ' + c.name + '   ·   ' + p.title + (p.desc ? ':  ' + p.desc : '') +
            (p.stop <= now ? '   (already shown)' : ''), 8000);
    }

    // Hold OK on a program: ▶ Watch now (what's on now, a channel that plays), ★ Add to / Remove
    // from favorites (its channel), Find in your addons (that program, as a guide-only channel's
    // OK). p: null for a channel whose guide hasn't come (its favorites only).
    function hold(g, r, p) {
        var c = g.chans[r], now = Date.now() / 1000, fav = IPTV.isFavorite(c.id), items = [];
        if (p && !c.guideOnly && p.start <= now && now < p.stop) { items.push(['play', '▶  Watch now']); }
        items.push(['fav', fav ? '★  Remove from favorites' : '★  Add to favorites']);
        if (p && p.title) { items.push(['find', '🔍  Find in your addons']); }
        pickList(c.name + (p && p.title ? '  ·  ' + p.title : ''), items, items[0][0], function (v) {
            if (v === 'play') { pick(g, r, p); return; }
            if (v === 'find') { findInAddons(p); return; }
            IPTV.setFavorite(c.id, !fav);
            U.toast(fav ? 'Removed from favorites' : 'Added to favorites: ★ Favorites, first on the IPTV and Guide tabs', 3000);
            refreshAddonRows('local:iptv');
        });
    }

    // A guide-only channel's program: a film found by the guide's original title and year (else
    // its title) opens its page with your addons' sources, as Discover does; a show, or a film
    // without one sure match, opens Search with its name.
    // Each pick stops the lookup before it (its answer ignored, its spinner gone); an answer that
    // comes once the Guide was left (another tab, or drawn again) opens nothing.
    var _finding = 0, _findCancel = null;
    function stopFinding() {
        _finding++;
        if (_findCancel) { _findCancel.cancel(); _findCancel = null; U.spinner(false); }
    }
    function onGuide(grid) { return _g === grid && !!grid.box && document.documentElement.contains(grid.box) && !/\bhidden\b/.test(scr('home').className); }
    function findInAddons(p) {
        stopFinding();
        function search() { App.openSearch(); Views.searchFor(p.title); }
        if (p.kind === 'series') { search(); return; }
        var gen = _finding, grid = _g, cancel = _findCancel = U.cancelToken();
        U.spinner(true, 'Looking for “' + p.title + '”…');
        function done(hit) {
            if (gen !== _finding) { return; }
            _findCancel = null;
            U.spinner(false);
            if (!onGuide(grid)) { return; }
            if (hit) { App.openDetail(hit.type, hit.id, { name: hit.name, poster: hit.poster, type: hit.type }); } else { search(); }
        }
        Stremio.findFilm({ title: p.title, orig: p.orig, year: p.year }, cancel).then(done, function () { done(null); });
    }

    // Back on the Guide from a channel played from it (BACK, or its stream gave up), after CH+ /
    // CH−: the hours at the present again, the row of the channel ended on in view (read if it
    // wasn't), and what's on now on it. Returns that cell; null when the Guide isn't on screen or
    // the channel isn't on it.
    function guideBackOn(id) {
        var g = _g, r = -1;
        if (!id || !g || !g.box || !document.documentElement.contains(g.box)) { return null; }
        for (var i = 0; i < g.chans.length; i++) { if (g.chans[i].id === id) { r = i; break; } }
        if (r < 0) { return null; }
        var now = Date.now() / 1000;
        g.start = floorStep(now); g.live = true;
        if (r < g.top) { g.top = r; } else if (r >= g.top + ROWS) { g.top = r - ROWS + 1; }
        var n = draw(g, { id: id, t: now });
        ensure(g).then(function (got) { if (got) { refresh(g); } });   // (its programs, when they weren't read: then onto what's on)
        return n;
    }

    V.guideGrid = guideGrid; V.guideBackOn = guideBackOn;
})(ViewParts);
