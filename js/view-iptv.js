/* ViewParts: the IPTV tab as a channel browser (Settings › Home › IPTV tab: Channel
   browser; #29, after ediziks' fork). Three panes: the groups (your favorites first), a group's
   channels (number, logo, name, what's on now and how far in) and the focused channel's now and
   next from its guide. Only the rows on screen are drawn (a group can hold thousands): UP / DOWN
   at a pane's edge move its window. OK plays a channel (its group the row CH+ / CH− go through),
   hold OK its menu (favorites, schedule, catch-up), as on a channel's card. */
(function (V) {
    'use strict';
    var G_ROWS = 11, C_ROWS = 9, PICK_MS = 200;
    var _b = null;   // { wrap, groups, g, gTop, c, cTop, gEl, cEl, iEl, at: { group name: channel index } }
    var _pickTimer = null, _hooked = false;

    function epg() { return typeof EPG !== 'undefined' ? EPG : null; }
    // The tab's groups: TV channels (sports and radio have their own tabs), favorites first.
    function groupsNow() {
        var z = typeof IPTV !== 'undefined' && IPTV.zapGroups ? IPTV.zapGroups(null) : null;
        if (!z) { return []; }
        return z.groups.map(function (g) { return { name: g.name, fav: !!g.fav, list: g.list.filter(function (m) { return m.type === 'tv'; }) }; })
            .filter(function (g) { return g.list.length; });
    }
    function alive() { return !!(_b && document.documentElement.contains(_b.wrap)); }

    function iptvBrowser(rows) {
        var groups = groupsNow(), old = _b;
        rows.className = 'rows iptvb-rows';
        if (!groups.length) { rows.appendChild(U.el('div', 'row-empty', U.t('Nothing here yet.'))); _b = null; return; }
        var wrap = U.el('div', 'iptvb');
        var gEl = U.el('div', 'iptvb-groups'), cEl = U.el('div', 'iptvb-chans'), iEl = U.el('div', 'iptvb-info');
        wrap.appendChild(gEl); wrap.appendChild(cEl); wrap.appendChild(iEl);
        rows.appendChild(wrap);
        // (drawn again — a guide arriving, coming back: the same group and channel)
        var g = 0;
        if (old) { groups.forEach(function (x, i) { if (x.name === old.groups[old.g].name) { g = i; } }); }
        _b = { wrap: wrap, groups: groups, g: g, gTop: 0, c: 0, cTop: 0, gEl: gEl, cEl: cEl, iEl: iEl, at: old ? old.at : {} };
        _b.c = Math.min(_b.at[groups[g].name] || 0, groups[g].list.length - 1);
        _b.gTop = Math.max(0, Math.min(g - 2, groups.length - G_ROWS));
        _b.cTop = Math.max(0, Math.min(_b.c - 2, groups[g].list.length - C_ROWS));
        drawGroups(); drawChans(); drawInfo();
        if (!_hooked && epg() && epg().onChange) {
            _hooked = true;
            epg().onChange(function () { if (alive()) { drawChans(true); drawInfo(); } });
        }
    }

    // ---- the groups ----
    function drawGroups() {
        var b = _b, n = b.groups.length;
        U.clear(b.gEl);
        b.groups.slice(b.gTop, b.gTop + G_ROWS).forEach(function (grp, k) {
            var i = b.gTop + k, el = U.el('div', 'iptvb-group focusable' + (i === b.g ? ' on' : ''));
            el.appendChild(U.el('span', 'iptvb-gname', grp.name));
            el.appendChild(U.el('span', 'iptvb-gcount', '' + grp.list.length));
            el.__gi = i;
            el.__goUP = function () {
                if (i === 0) { return undefined; }   // (the top menu)
                if (i === b.gTop) { b.gTop--; drawGroups(); }
                return groupNode(i - 1);
            };
            el.__goDOWN = function () {
                if (i >= n - 1) { return false; }
                if (i === b.gTop + G_ROWS - 1) { b.gTop++; drawGroups(); }
                return groupNode(i + 1);
            };
            el.__goRIGHT = function () { pickNow(i); return chanNode(b.c) || false; };
            el.__goLEFT = function () { return false; };
            el.__onselect = function () { pickNow(i); var c = chanNode(b.c); if (c) { Focus.setFocus(c); } };
            b.gEl.appendChild(el);
        });
        var more = U.el('div', 'iptvb-more', b.gTop + G_ROWS < n ? '▼' : '');
        b.gEl.appendChild(more);
    }
    function groupNode(i) { var l = _b.gEl.children; for (var k = 0; k < l.length; k++) { if (l[k].__gi === i) { return l[k]; } } return null; }
    // A group focused: its channels shown once you stop on it (passing groups doesn't draw each).
    function pickSoon(i) {
        if (_pickTimer) { clearTimeout(_pickTimer); }
        _pickTimer = setTimeout(function () { _pickTimer = null; if (alive()) { pickNow(i); } }, PICK_MS);
    }
    function pickNow(i) {
        var b = _b;
        if (_pickTimer) { clearTimeout(_pickTimer); _pickTimer = null; }
        if (i === b.g) { return; }
        b.at[b.groups[b.g].name] = b.c;
        b.g = i;
        var list = b.groups[i].list;
        b.c = Math.min(b.at[b.groups[i].name] || 0, list.length - 1);
        b.cTop = Math.max(0, Math.min(b.c - 2, list.length - C_ROWS));
        Array.prototype.forEach.call(b.gEl.querySelectorAll('.iptvb-group'), function (el) { el.className = 'iptvb-group focusable' + (el.__gi === i ? ' on' : '') + (Focus.current() === el ? ' focused' : ''); });
        drawChans(); drawInfo();
    }

    // ---- a group's channels ----
    function drawChans(keepFocus) {
        var b = _b, list = b.groups[b.g].list, n = list.length, cur = Focus.current(), had = cur && cur.__ci != null && b.cEl.contains(cur) ? cur.__ci : null;
        var playing = typeof Player !== 'undefined' && Player.inUse && Player.inUse() && Player.isBehind && Player.isBehind() ? lastPlayingId() : '';
        U.clear(b.cEl);
        b.cEl.appendChild(U.el('div', 'iptvb-head', b.groups[b.g].name + '   ·   ' + U.tn(n, '{n} channel', '{n} channels')));
        var shown = list.slice(b.cTop, b.cTop + C_ROWS), e = epg();
        if (e && e.want) { e.want(shown.map(function (m) { return m.id; })); }
        var now = Date.now() / 1000;
        shown.forEach(function (m, k) {
            var i = b.cTop + k, el = U.el('div', 'iptvb-ch focusable' + (m.id === playing ? ' playing' : ''));
            el.appendChild(U.el('div', 'iptvb-num', '' + (i + 1)));
            var logo = m.logo || (e && e.logo ? e.logo(m.id) : '');
            var box = U.el('div', 'iptvb-logo');
            if (logo) { var img = U.el('img'); img.onerror = function () { if (this.parentNode) { this.parentNode.removeChild(this); } }; img.src = logo; box.appendChild(img); }
            else { box.appendChild(U.el('span', 'iptvb-mono', (m.name || '?').replace(/^[^A-Za-z0-9]+/, '').slice(0, 2).toUpperCase())); }
            el.appendChild(box);
            var txt = U.el('div', 'iptvb-txt');
            txt.appendChild(U.el('div', 'iptvb-name', (IPTV.isFavorite && IPTV.isFavorite(m.id) ? '★ ' : '') + (m.name || '')));
            var ep = e && e.now ? e.now(m.id) : null;
            if (ep && ep.now) {
                txt.appendChild(U.el('div', 'iptvb-now', e.hhmm(ep.now.start) + '   ' + ep.now.title));
                var bar = U.el('div', 'iptvb-bar'), fill = U.el('div', 'iptvb-fill');
                fill.style.width = Math.max(0, Math.min(100, Math.round((now - ep.now.start) / (ep.now.stop - ep.now.start) * 100))) + '%';
                bar.appendChild(fill); txt.appendChild(bar);
            }
            el.appendChild(txt);
            el.__ci = i; el.__meta = m;
            el.__goUP = function () {
                if (i === 0) { return undefined; }
                if (i === b.cTop) { b.cTop--; drawChans(); }
                return chanNode(i - 1);
            };
            el.__goDOWN = function () {
                if (i >= n - 1) { return false; }
                if (i === b.cTop + C_ROWS - 1) { b.cTop++; drawChans(); }
                return chanNode(i + 1);
            };
            el.__goLEFT = function () { return groupNode(b.g) || (function () { b.gTop = Math.max(0, Math.min(b.g, b.groups.length - G_ROWS)); drawGroups(); return groupNode(b.g); })(); };
            el.__goRIGHT = function () { return false; };
            el.__onselect = function () { play(i); };
            el.__onplay = el.__onselect;
            el.__onlongpress = function () { if (V.liveSchedule) { V.liveSchedule(m, el); } };
            b.cEl.appendChild(el);
        });
        b.cEl.appendChild(U.el('div', 'iptvb-more', b.cTop + C_ROWS < n ? '▼' : ''));
        if (keepFocus && had != null) { var back = chanNode(had); if (back) { Focus.setFocus(back); } }
    }
    function chanNode(i) { var l = _b.cEl.children; for (var k = 0; k < l.length; k++) { if (l[k].__ci === i) { return l[k]; } } return null; }
    function lastPlayingId() { var l = U.store.get('stremiok.iptv.last', null); return l && typeof l.id === 'string' ? l.id : ''; }
    function play(i) {
        var b = _b, list = b.groups[b.g].list, m = list[i];
        b.c = i; b.at[b.groups[b.g].name] = i;
        // (its group the row CH+ / CH− go through; coming back, on the channel you switched to)
        var row = list.map(function (x, k) {
            var e = { meta: x };
            Object.defineProperty(e, 'card', { get: function () { return focusOn(k); } });
            return e;
        });
        App.openLive(m.type || 'tv', m.id, m, { list: row, idx: i });
    }
    // The channel at i in the group shown, drawn and returned (the way back from the player).
    function focusOn(i) {
        if (!alive()) { return null; }
        var b = _b, list = b.groups[b.g].list;
        if (i < 0 || i >= list.length) { return null; }
        b.c = i;
        if (i < b.cTop || i >= b.cTop + C_ROWS) { b.cTop = Math.max(0, Math.min(i - 2, list.length - C_ROWS)); }
        drawChans(); drawInfo();
        return chanNode(i);
    }

    // ---- the focused channel ----
    function drawInfo() {
        var b = _b, m = b.groups[b.g].list[b.c], e = epg();
        U.clear(b.iEl);
        if (!m) { return; }
        b.iEl.appendChild(U.el('div', 'iptvb-iname', m.name || ''));
        if (m.description) { b.iEl.appendChild(U.el('div', 'iptvb-igroup', m.description)); }
        var ep = e && e.now ? e.now(m.id) : null;
        if (!ep) { b.iEl.appendChild(U.el('div', 'iptvb-inone', e && e.hasGuide && e.hasGuide(m.id) ? U.t('Loading…') : U.t('No TV guide for this channel'))); }
        if (ep && ep.now) {
            b.iEl.appendChild(U.el('div', 'iptvb-ilabel', U.t('Now') + '   ' + e.hhmm(ep.now.start) + ' – ' + e.hhmm(ep.now.stop)));
            b.iEl.appendChild(U.el('div', 'iptvb-ititle', ep.now.title));
            if (ep.now.desc) { b.iEl.appendChild(U.el('div', 'iptvb-idesc', ep.now.desc)); }
        }
        if (ep && ep.next) {
            b.iEl.appendChild(U.el('div', 'iptvb-ilabel', U.t('Next:') + '   ' + e.hhmm(ep.next.start)));
            b.iEl.appendChild(U.el('div', 'iptvb-inext', ep.next.title));
        }
        b.iEl.appendChild(U.el('div', 'iptvb-ihint', U.t('OK: watch   Hold OK: schedule and favorites')));
    }

    // Focus on a group picks it (after a moment); on a channel shows its details.
    Focus.onFocus(function (node) {
        if (!alive() || !node) { return; }
        if (node.__gi != null && _b.gEl.contains(node)) { pickSoon(node.__gi); return; }
        if (node.__ci != null && _b.cEl.contains(node) && node.__ci !== _b.c) { _b.c = node.__ci; drawInfo(); }
    });

    V.iptvBrowser = iptvBrowser;
    V.iptvBrowserOn = function () { return typeof Stremio !== 'undefined' && Stremio.getPrefs().iptvLayout === 'browser'; };
})(ViewParts);
