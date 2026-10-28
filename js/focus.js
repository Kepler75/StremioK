/* Spatial focus navigation for the D-pad. Global namespace: Focus
   Any element with class "focusable" participates. */
var Focus = (function () {
    'use strict';

    var _scope = null;
    var _current = null;
    var _onFocus = [];     // listeners, told about every newly focused node (Home, Discover)

    function items() {
        if (!_scope) { return []; }
        var nodes = _scope.querySelectorAll('.focusable');
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var r = n.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { out.push(n); }
        }
        return out;
    }

    function setFocus(node) {
        if (!node) { return; }
        // Moving to a non-input control must blur any text field that still holds
        // DOM keyboard focus — otherwise the remote's OK/Enter is delivered to the
        // input (e.g. re-running a search) instead of the visually-focused element.
        try {
            var ae = document.activeElement;
            if (ae && ae !== node && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
                node.tagName !== 'INPUT' && node.tagName !== 'TEXTAREA') {
                ae.blur();
            }
        } catch (e) {}
        if (_current && _current !== node && _current.classList) { _current.classList.remove('focused'); }
        _current = node;
        if (node.classList) { node.classList.add('focused'); }
        ensureVisible(node);
        if (typeof U !== 'undefined' && U.prioritizeImages) { U.prioritizeImages(node); }
        for (var li = 0; li < _onFocus.length; li++) { try { _onFocus[li](node); } catch (e2) { if (U.log) { U.log('focus', e2); } } }
    }

    // Scrolls each overflowing box around the node so it's in view, with a margin. A box
    // marked __noScroll only clips (a page's text block): it never moves.
    function ensureVisible(node) {
        var p = node.parentNode, z = (typeof U !== 'undefined' && U.zoom) ? U.zoom() : 1;   // (rects are on screen, zoomed; scrolling isn't)
        while (p && p.nodeType === 1 && p !== document.body) {
            var canX = !p.__noScroll && p.scrollWidth > p.clientWidth + 2;
            var canY = !p.__noScroll && p.scrollHeight > p.clientHeight + 2;
            if (canX || canY) {
                var pr = p.getBoundingClientRect();
                var nr = node.getBoundingClientRect();
                if (canX) {
                    var mx = 90;
                    if (nr.left < pr.left + mx) { p.scrollLeft -= (pr.left + mx - nr.left) / z; }
                    else if (nr.right > pr.right - mx) { p.scrollLeft += (nr.right - (pr.right - mx)) / z; }
                }
                if (canY) {
                    var my = 70;
                    if (nr.top < pr.top + my) { p.scrollTop -= (pr.top + my - nr.top) / z; }
                    else if (nr.bottom > pr.bottom - my) { p.scrollTop += (nr.bottom - (pr.bottom - my)) / z; }
                }
            }
            p = p.parentNode;
        }
    }

    function move(dir) {
        if (!_scope) { return; }
        var r = _current ? _current.getBoundingClientRect() : null;
        if (!r || r.width <= 0 || r.height <= 0 || !_scope.contains(_current)) {
            var list = items();
            if (list.length) { setFocus(list[0]); }
            return;
        }
        var best = null;
        // An item that knows its neighbors (a Discover card: by its place in the grid) says
        // where a move goes, without measuring anything: a node, false (stay), or nothing
        // (work it out as usual).
        var hook = _current['__go' + dir];
        if (typeof hook === 'function') {
            var t = hook();
            if (t === false) { return; }
            if (t && t.nodeType === 1) { setFocus(enterGroup(t)); return; }
        }
        // UP/DOWN in a list of rows (Home, Search, Cast & more): only the next / previous
        // row's items are candidates, not every card on the screen (thousands on a big IPTV
        // tab). No row that way: as below (the top menu, …).
        if ((dir === 'UP' || dir === 'DOWN') && (best = nextRowPick(dir, r))) { setFocus(enterGroup(best)); return; }
        // LEFT/RIGHT fast path: in a carousel row the only same-row candidates are the
        // card's siblings, so skip measuring the whole screen. At a row end (nothing
        // there) fall back to the full scan, which may reach a non-sibling on the same
        // line (e.g. last tab pill -> Search).
        if ((dir === 'LEFT' || dir === 'RIGHT') && _current.parentNode) {
            best = pick(dir, r, _current.parentNode.children);
        }
        // UP/DOWN: stay inside the scrolling area focus is in (Home rows, a Settings
        // list, an episode list) while it has something in that direction. Items
        // scrolled out of such an area still report their layout position, beyond its
        // clip edge and so under the top menu, which made a whole-screen comparison
        // jump to the menu (or skip a row) instead of the row just scrolled out of view.
        if (dir === 'UP' || dir === 'DOWN') {
            for (var p = _current.parentNode; !best && p && p !== _scope && p.nodeType === 1; p = p.parentNode) {
                if (p.scrollHeight > p.clientHeight + 2) { best = pick(dir, r, p.querySelectorAll('.focusable')); }
            }
        }
        if (!best) { best = pick(dir, r, _scope.querySelectorAll('.focusable')); }
        if (best) { setFocus(enterGroup(best)); }
    }

    function nextRowPick(dir, r) {
        var row = null, box = null;
        for (var p = _current.parentNode; p && p !== _scope && p.nodeType === 1; p = p.parentNode) {
            var cn = ' ' + (p.className || '') + ' ';
            if (!row && cn.indexOf(' row ') !== -1) { row = p; continue; }
            if (row && /\s(rows|search-results|more-rows)\s/.test(cn)) { box = p; break; }
        }
        if (!row || !box) { return null; }
        // a row that's a grid (Watching's): its next / previous line first (a sideways row has
        // one line: nothing more to measure)
        var grid = _current.parentNode && (' ' + (_current.parentNode.className || '') + ' ').indexOf(' card-grid ') !== -1 ? _current.parentNode : null;
        var own = grid ? pick(dir, r, grid.children) : null;
        if (own) { return own; }
        var rows = box.querySelectorAll('.row'), at = -1;
        for (var i = 0; i < rows.length; i++) { if (rows[i] === row) { at = i; break; } }
        for (var j = at + (dir === 'DOWN' ? 1 : -1); at !== -1 && j >= 0 && j < rows.length; j += (dir === 'DOWN' ? 1 : -1)) {
            var got = pick(dir, r, rows[j].querySelectorAll('.focusable'));
            if (got) { return got; }
        }
        return null;
    }

    // A container can own entry into itself: when a move crosses into an element
    // with __onEnter (e.g. the top menu), it's told where focus came from and may
    // return a different target (e.g. the active tab rather than the nearest pill).
    function enterGroup(target) {
        for (var p = target; p && p !== _scope && p.nodeType === 1; p = p.parentNode) {
            if (p.__onEnter && !p.contains(_current)) { return p.__onEnter(_current) || target; }
        }
        return target;
    }

    // Best focusable in `nodes` for a move in `dir` from rect `r` (null if none).
    function pick(dir, r, nodes) {
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;

        // Collect candidates in the pressed direction with their primary (distance
        // along the axis of travel) and cross (offset on the other axis). Each node
        // is measured once; zero-size (hidden) nodes are skipped.
        var cands = [];
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node === _current || !node.classList || !node.classList.contains('focusable')) { continue; }
            var b = node.getBoundingClientRect();
            if (b.width <= 0 || b.height <= 0) { continue; }
            var bx = b.left + b.width / 2, by = b.top + b.height / 2;
            var dx = bx - cx, dy = by - cy;
            var primary, cross;
            if (dir === 'LEFT') { if (dx > -1) { continue; } primary = -dx; cross = Math.abs(dy); }
            else if (dir === 'RIGHT') { if (dx < 1) { continue; } primary = dx; cross = Math.abs(dy); }
            else if (dir === 'UP') { if (dy > -1) { continue; } primary = -dy; cross = Math.abs(dx); }
            else { if (dy < 1) { continue; } primary = dy; cross = Math.abs(dx); }
            cands.push({ node: node, rect: b, primary: primary, cross: cross });
        }
        if (!cands.length) { return null; }

        // Two-phase, direction-aware:
        //  - Vertical (UP/DOWN): first restrict to the NEAREST row (min primary =
        //    vertical distance), then pick the horizontally closest (min cross).
        //  - Horizontal (LEFT/RIGHT): first restrict to the SAME row (min cross =
        //    vertical offset), then pick the horizontally closest (min primary).
        // This stops vertical moves skipping a short row, and stops horizontal moves
        // jumping into another row (e.g. Settings -> LEFT should land on Search).
        var vertical = (dir === 'UP' || dir === 'DOWN');
        var best = null, bestSel = Infinity, bestTie = Infinity;

        if (vertical) {
            // nearest row first (min primary band), then closest horizontally
            var BAND = 120, minP = Infinity;
            for (var j = 0; j < cands.length; j++) { if (cands[j].primary < minP) { minP = cands[j].primary; } }
            for (var k = 0; k < cands.length; k++) {
                var c = cands[k];
                if (c.primary > minP + BAND) { continue; }
                if (c.cross < bestSel || (c.cross === bestSel && c.primary < bestTie)) {
                    best = c.node; bestSel = c.cross; bestTie = c.primary;
                }
            }
        } else {
            // Horizontal (LEFT/RIGHT): only elements on the SAME visual row — they must
            // actually overlap the current element vertically. This guarantees L/R never
            // drifts up or down into another row (grids or the top menu); at a row end it
            // simply doesn't move. Then pick the nearest one horizontally.
            for (var m = 0; m < cands.length; m++) {
                var d = cands[m];
                var db = d.rect;
                var overlap = Math.min(db.bottom, r.bottom) - Math.max(db.top, r.top);
                if (overlap < Math.min(db.height, r.height) * 0.5) { continue; }  // not the same row
                if (d.primary < bestSel || (d.primary === bestSel && d.cross < bestTie)) {
                    best = d.node; bestSel = d.primary; bestTie = d.cross;
                }
            }
        }
        return best;
    }

    // scope: root element to search within. preferred: optional element to focus first.
    function setScope(scope, preferred) {
        // the old item loses its highlight (a screen that isn't redrawn, like Discover,
        // would otherwise show two focused items)
        if (_current && _current.classList) { _current.classList.remove('focused'); }
        _scope = scope;
        _current = null;
        var list = items();
        if (preferred && list.indexOf(preferred) !== -1) { setFocus(preferred); }
        else if (list.length) { setFocus(list[0]); }
    }

    function current() { return _current; }
    function clickCurrent() { if (_current) { fireClick(_current); } }
    function fireClick(node) {
        if (node.__onselect) { node.__onselect(node); return; }
        if (node.click) { node.click(); }
    }

    function onFocus(fn) { _onFocus.push(fn); }

    return { setScope: setScope, move: move, setFocus: setFocus, current: current, onFocus: onFocus,
             clickCurrent: clickCurrent, refresh: function () { return items(); } };
})();
