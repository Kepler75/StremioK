/* ViewParts: the IPTV tab as a channel browser (Settings › Home › IPTV tab: Channel
   browser; #29, after ediziks' fork). Three panes: the groups (your favorites first), a group's
   channels (number, logo, name, what's on now and how far in) and the focused channel's now and
   next from its guide. Only the rows on screen are drawn (a group can hold thousands): UP / DOWN
   at a pane's edge move its window. OK plays a channel (its group the row CH+ / CH− go through),
   hold OK its menu (favorites, schedule, catch-up), as on a channel's card. Below the focused
   channel's pane, its preview (Settings › Home › IPTV tab: the browser with a preview): it plays
   there once focus rests on it, unless a channel plays behind the menus. */
(function (V) {
    'use strict';
    var G_ROWS = 11, C_ROWS = 9, PICK_MS = 200;   // (at most: as many as fit, see fit)
    var G_H = 64, C_H = 80, HEAD_H = 40, MORE_H = 22;   // a group's and a channel's row with the gap after it, the channels' heading, the ▼ (style.css)
    var _b = null;   // { wrap, groups, g, gTop, c, cTop, gEl, cEl, iEl, at: { group name: channel index } }
    var _pickTimer = null, _hooked = false;
    var PREVIEW_MS = 1200, PREVIEW_H = 480;   // focus resting on a channel this long; the height asked of a YouTube channel
    var _pv = { timer: null, id: '', tok: 0, at: '' };   // the preview: due (timer), playing (id), the latest asked (tok), the channel it's for (at: due, loading, playing or not playable)

    function epg() { return typeof EPG !== 'undefined' ? EPG : null; }
    // The tab's groups: TV channels (sports and radio have their own tabs), favorites first; then
    // each live TV catalog from your addons, by its row's name (as the IPTV tab's rows show them).
    function groupsNow() {
        var z = typeof IPTV !== 'undefined' && IPTV.zapGroups ? IPTV.zapGroups(null) : null;
        var out = !z ? [] : z.groups.map(function (g) { return { name: g.name, fav: !!g.fav, list: g.list.filter(function (m) { return m.type === 'tv'; }) }; })
            .filter(function (g) { return g.list.length; });
        (V.addonLiveCatalogs ? V.addonLiveCatalogs() : []).forEach(function (c) {
            var list = c.metas.filter(function (m) { return m && m.id; }).map(function (m) { return Object.assign({}, m, { type: m.type || c.type || 'tv' }); });
            if (list.length) { out.push({ name: c.name, addon: true, list: list }); }
        });
        return out;
    }
    function fromPlaylist(m) { return !!(m && IPTV.owns(m.id)); }
    function alive() { return !!(_b && document.documentElement.contains(_b.wrap)); }
    // Focus in the channels (or the info beside them): the groups fold to a narrow strip and the
    // channels take the room (.groups-away, css/style.css); back in the groups: open again. The
    // info / preview column on the right doesn't move, so the preview's video stays where it is.
    if (typeof Focus !== 'undefined' && Focus.onFocus) {
        Focus.onFocus(function (n) {
            if (!alive() || !_b.wrap.contains(n)) { return; }
            var away = !_b.gEl.contains(n);
            if (away !== /\bgroups-away\b/.test(_b.wrap.className)) { _b.wrap.className = _b.wrap.className.replace(/\s*groups-away/g, '') + (away ? ' groups-away' : ''); }
        });
    }

    function iptvBrowser(rows) {
        var groups = groupsNow(), old = _b;
        rows.className = 'rows iptvb-rows';
        if (!groups.length) { rows.appendChild(U.el('div', 'row-empty', U.t('Nothing here yet.'))); _b = null; return; }
        var wrap = U.el('div', 'iptvb' + (previewOn() ? ' with-pip' : ''));
        var gEl = U.el('div', 'iptvb-groups'), cEl = U.el('div', 'iptvb-chans'), side = U.el('div', 'iptvb-side'), iEl = U.el('div', 'iptvb-info');
        var pEl = previewOn() ? U.el('div', 'iptvb-pip') : null;
        side.appendChild(iEl);
        if (pEl) { side.appendChild(pEl); }
        wrap.appendChild(gEl); wrap.appendChild(cEl); wrap.appendChild(side);
        rows.appendChild(wrap);
        // (drawn again — a guide arriving, coming back: the same group and channel)
        var g = 0;
        if (old) { groups.forEach(function (x, i) { if (x.name === old.groups[old.g].name) { g = i; } }); }
        var b = _b = { wrap: wrap, groups: groups, g: g, gTop: 0, c: 0, cTop: 0, gEl: gEl, cEl: cEl, iEl: iEl, pEl: pEl, at: old ? old.at : {}, gRows: G_ROWS, cRows: C_ROWS };
        // (the rows Home's area has room for: past them, the whole browser would scroll, the
        // focused channel's pane with it; it never scrolls itself: its lists move their windows)
        rows.__noScroll = true;
        fit(b);
        b.c = Math.min(b.at[groups[g].name] || 0, groups[g].list.length - 1);
        b.gTop = Math.max(0, Math.min(g - 2, groups.length - b.gRows));
        b.cTop = Math.max(0, Math.min(b.c - 2, groups[g].list.length - b.cRows));
        drawGroups(); drawChans(); drawInfo(); drawPip();
        if (!_hooked && epg() && epg().onChange) {
            _hooked = true;
            epg().onChange(function () { if (alive()) { drawChans(true); drawInfo(); } });
        }
    }

    // As many groups and channels as the browser's height holds (it depends on the look, the zoom
    // and Home's details strip), G_ROWS and C_ROWS at most; not on screen yet: those.
    function fit(b) {
        var h = b.wrap.clientHeight;
        if (!(h > 0)) { return; }
        b.gRows = Math.max(3, Math.min(G_ROWS, Math.floor((h - MORE_H) / G_H)));
        b.cRows = Math.max(3, Math.min(C_ROWS, Math.floor((h - HEAD_H - MORE_H) / C_H)));
    }

    // ---- the groups ----
    function drawGroups() {
        var b = _b, n = b.groups.length;
        U.clear(b.gEl);
        b.groups.slice(b.gTop, b.gTop + b.gRows).forEach(function (grp, k) {
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
                if (i === b.gTop + b.gRows - 1) { b.gTop++; drawGroups(); }
                return groupNode(i + 1);
            };
            el.__goRIGHT = function () { pickNow(i); return chanNode(b.c) || false; };
            el.__goLEFT = function () { return false; };
            el.__onselect = function () { pickNow(i); var c = chanNode(b.c); if (c) { Focus.setFocus(c); } };
            b.gEl.appendChild(el);
        });
        var more = U.el('div', 'iptvb-more', b.gTop + b.gRows < n ? '▼' : '');
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
        b.cTop = Math.max(0, Math.min(b.c - 2, list.length - b.cRows));
        Array.prototype.forEach.call(b.gEl.querySelectorAll('.iptvb-group'), function (el) { el.className = 'iptvb-group focusable' + (el.__gi === i ? ' on' : '') + (Focus.current() === el ? ' focused' : ''); });
        drawChans(); drawInfo();
    }

    // ---- a group's channels ----
    function drawChans(keepFocus) {
        var b = _b, list = b.groups[b.g].list, n = list.length, cur = Focus.current(), had = cur && cur.__ci != null && b.cEl.contains(cur) ? cur.__ci : null;
        var playing = typeof Player !== 'undefined' && Player.inUse && Player.inUse() && Player.isBehind && Player.isBehind() && !(Player.isPreview && Player.isPreview()) ? lastPlayingId() : '';
        U.clear(b.cEl);
        b.cEl.appendChild(U.el('div', 'iptvb-head', b.groups[b.g].name + '   ·   ' + U.tn(n, '{n} channel', '{n} channels')));
        var shown = list.slice(b.cTop, b.cTop + b.cRows), e = epg();
        if (e && e.want) { e.want(shown.map(function (m) { return m.id; })); }
        var now = Date.now() / 1000;
        shown.forEach(function (m, k) {
            var i = b.cTop + k, el = U.el('div', 'iptvb-ch focusable' + (m.id === playing ? ' playing' : ''));
            el.appendChild(U.el('div', 'iptvb-num', '' + (i + 1)));
            var logo = m.logo || (e && e.logo && fromPlaylist(m) ? e.logo(m.id) : '') || (!fromPlaylist(m) ? m.poster || '' : '');
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
                if (i === b.cTop + b.cRows - 1) { b.cTop++; drawChans(); }
                return chanNode(i + 1);
            };
            el.__goLEFT = function () { return groupNode(b.g) || (function () { b.gTop = Math.max(0, Math.min(b.g, b.groups.length - b.gRows)); drawGroups(); return groupNode(b.g); })(); };
            el.__goRIGHT = function () { return false; };
            el.__onselect = function () { _pv.tok++; if (_pv.timer) { clearTimeout(_pv.timer); _pv.timer = null; } play(i); };   // (the preview, if any: replaced by the channel full screen)
            el.__onplay = el.__onselect;
            if (fromPlaylist(m)) { el.__onlongpress = function () { if (V.liveSchedule) { V.liveSchedule(m, el); } }; }   // (an addon's channel: no guide or favorites here)
            b.cEl.appendChild(el);
        });
        b.cEl.appendChild(U.el('div', 'iptvb-more', b.cTop + b.cRows < n ? '▼' : ''));
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
        if (i < b.cTop || i >= b.cTop + b.cRows) { b.cTop = Math.max(0, Math.min(i - 2, list.length - b.cRows)); }
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
        if (!ep && fromPlaylist(m)) { b.iEl.appendChild(U.el('div', 'iptvb-inone', e && e.hasGuide && e.hasGuide(m.id) ? U.t('Loading…') : U.t('No TV guide for this channel'))); }
        if (ep && ep.now) {
            b.iEl.appendChild(U.el('div', 'iptvb-ilabel', U.t('Now') + '   ' + e.hhmm(ep.now.start) + ' – ' + e.hhmm(ep.now.stop)));
            b.iEl.appendChild(U.el('div', 'iptvb-ititle', ep.now.title));
            if (ep.now.desc) { b.iEl.appendChild(U.el('div', 'iptvb-idesc', ep.now.desc)); }
        }
        if (ep && ep.next) {
            b.iEl.appendChild(U.el('div', 'iptvb-ilabel', U.t('Next:') + '   ' + e.hhmm(ep.next.start)));
            b.iEl.appendChild(U.el('div', 'iptvb-inext', ep.next.title));
        }
        if (fromPlaylist(m)) { b.iEl.appendChild(U.el('div', 'iptvb-ihint', U.t('OK: watch   Hold OK: schedule and favorites'))); }
    }

    // ---- the focused channel's preview ----
    // Settings › Home › IPTV tab: the channel browser with a preview.
    function previewOn() { return typeof Stremio !== 'undefined' && Stremio.getPrefs().iptvLayout === 'preview' && typeof Player !== 'undefined' && !!Player.isPreview; }
    // A channel playing behind the menus (Settings › Playback › Live TV): no preview over it.
    function otherPlaying() { return !!(Player.inUse && Player.inUse() && !Player.isPreview()); }
    function pipText(t) {
        var b = _b;
        if (!b || !b.pEl) { return; }
        U.clear(b.pEl);
        if (t) { b.pEl.appendChild(U.el('div', 'iptvb-pip-note', t)); }
    }
    function drawPip() {
        var b = _b;
        if (!b || !b.pEl) { return; }
        b.pEl.className = 'iptvb-pip' + (otherPlaying() ? ' off' : '');
        pipText(otherPlaying() ? '' : U.t('Preview'));
    }
    function stopPreview() {
        if (_pv.timer) { clearTimeout(_pv.timer); _pv.timer = null; }
        _pv.tok++;
        if (_pv.id && Player.isPreview && Player.isPreview()) { Player.exit(); }
        _pv.id = ''; _pv.at = '';
        if (alive() && _b.pEl) { _b.pEl.className = 'iptvb-pip'; pipText(U.t('Preview')); }
    }
    function previewSoon(i) {
        stopPreview();
        _pv.at = _b && _b.groups[_b.g].list[i] ? _b.groups[_b.g].list[i].id : '';
        if (!previewOn() || !alive() || !_b.pEl || otherPlaying()) { return; }
        _pv.timer = setTimeout(function () { _pv.timer = null; startPreview(i); }, PREVIEW_MS);
    }
    function startPreview(i) {
        var b = _b, m = b && b.groups[b.g].list[i], tok = ++_pv.tok;
        if (!m || !alive() || otherPlaying()) { return; }
        function still() { return tok === _pv.tok && alive() && _b === b && b.c === i && Focus.current() && Focus.current().__ci === i; }
        pipText(U.t('Loading…'));
        (fromPlaylist(m) ? IPTV.streams(m.id) : Stremio.getStreams(m.type || 'tv', m.id)).then(function (list) {
            if (!still()) { return; }
            var st = (list || []).filter(function (x) { return x && !x._drm && (x._yt || Stremio.isPlayable(x)); })[0];
            if (!st) { pipText(U.t('No preview for this channel')); return; }
            var go = function (ctx) {
                if (!still() || otherPlaying()) { return; }
                var r = b.pEl.getBoundingClientRect();
                if (!(r.width > 0 && r.height > 0)) { return; }
                var inset = 3 * (U.zoom ? U.zoom() : 1);   // (inside its border)
                ctx.type = m.type || 'tv'; ctx.id = m.id; ctx.name = m.name || '';
                ctx.preview = { x: r.left + inset, y: r.top + inset, w: r.width - 2 * inset, h: r.height - 2 * inset };
                // (ended: its box as it was. Not playable: said so, and not tried again until focus
                // comes back to it; closed or replaced — watched full screen — it starts again then)
                ctx.onPreviewEnd = function (failed) {
                    if (_pv.id === m.id) { _pv.id = ''; if (!failed) { _pv.at = ''; } }
                    if (alive() && _b === b && b.c === i && !(Player.isPreview && Player.isPreview())) { b.pEl.className = 'iptvb-pip'; pipText(failed ? U.t('No preview for this channel') : U.t('Preview')); }
                };
                _pv.id = m.id;
                b.pEl.className = 'iptvb-pip playing';
                U.clear(b.pEl);
                Player.play(ctx, null);
            };
            if (st._yt) {
                var page = st.ytPage || st.url;
                YTPlay.ensureService().then(function () { go({ url: YTPlay.resolverUrl(page, PREVIEW_H), variantUrl: YTPlay.resolverUrl(page), yt: page, streams: [] }); },
                    function () { if (still()) { pipText(U.t('No preview for this channel')); } });
                return;
            }
            go({ url: st.url, _headers: U.sanitizeHeaders(st._headers) || undefined, stream: st, streams: [] });
        }, function () { if (still()) { pipText(U.t('No preview for this channel')); } });
    }

    // Focus on a group picks it (after a moment); on a channel shows its details, and its preview
    // once focus rests there. Anywhere else (a group, the top menu, another page): no preview.
    Focus.onFocus(function (node) {
        var onChan = !!(node && alive() && node.__ci != null && _b.cEl.contains(node));
        if (!onChan && (_pv.id || _pv.timer)) { stopPreview(); }
        if (!alive() || !node) { return; }
        if (node.__gi != null && _b.gEl.contains(node)) { pickSoon(node.__gi); return; }
        if (onChan && node.__ci !== _b.c) { _b.c = node.__ci; drawInfo(); }
        // (the same channel focused again — its row drawn again, a guide arriving: left as it is)
        if (onChan && node.__meta && node.__meta.id !== _pv.at) { previewSoon(node.__ci); }
    });

    V.iptvBrowser = iptvBrowser;
    V.iptvBrowserOn = function () { return typeof Stremio !== 'undefined' && /^(browser|preview)$/.test(Stremio.getPrefs().iptvLayout); };
})(ViewParts);
