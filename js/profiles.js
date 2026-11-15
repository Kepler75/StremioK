/* Profiles: who's watching. Global namespace: Profiles
   Each profile keeps its own addons, settings, progress, watched marks, history and sign-ins
   (Trakt, a Stremio account, media servers); what's the TV's — playlists, USB drives and network
   folders, plugins, API keys, the streaming server, what the TV plays, Diagnostics — every
   profile shares (TV below).
   - Kept as one list (stremiok.profiles, the TV's): each profile's id, name, color and slot.
   - A profile's saved state is StremioK's usual keys under its slot: the first profile's are the
     names StremioK has always used (stremiok.progress), another's carry its slot
     (stremiok.p2.progress). With one profile nothing changes, nothing is moved, and an older
     StremioK still finds its data.
   - U.store and U.bigStore turn each key into the active profile's (key()): the rest of
     StremioK keeps its key names. The active profile is the one StremioK started in: switching
     starts StremioK again.
   Loaded before everything else (it reads the TV's storage itself); nothing here needs U. */
var Profiles = (function () {
    'use strict';
    var KEY = 'stremiok.profiles', MAX = 5, SLOTS = ['', 'p2', 'p3', 'p4', 'p5'];
    // The TV's own (every profile shares them): stremiok.<name>, or its own keys under <name>.
    var TV = ['profiles', 'manifests', 'discoverempty', 'tmdbproviders', 'integrations', 'server', 'formats', 'resblock',
        'appshortcuts', 'appsallowed', 'bigdb', 'importurl', 'aspects', 'iptv.playlists', 'iptv.stalkerall', 'iptv.stalkerkeep',
        'iptv.every', 'iptv.size', 'liveformat', 'livefix', 'xtvod.cats', 'stvod.cats', 'local.index', 'local.indexes', 'local.matches',
        'local.fixes', 'local.matching', 'local.hidden', 'netfolders', 'plugins', 'downloads', 'homesnap', 'homecache',
        'homepreview', 'session', 'lastlog', 'startup'];
    var TV_PREFIX = ['iptv.cache.', 'local.index.', 'plugins.code.'];
    var SLOT_KEY = /^stremiok\.(p[2-9])\./;   // (a profile's own key, other than the first's)
    var COLORS = ['indigo', 'teal', 'orange', 'pink', 'green', 'red', 'purple', 'amber'];

    function valid(d) {
        if (!d || typeof d !== 'object' || !Array.isArray(d.list) || !d.list.length || d.list.length > MAX) { return false; }
        var seen = {};
        return d.list.every(function (p) {
            var ok = p && typeof p.id === 'string' && /^[a-z0-9]{2,12}$/.test(p.id) && typeof p.name === 'string' && SLOTS.indexOf(p.slot) !== -1 && !seen['s' + p.slot] && !seen['i' + p.id];
            if (ok) { seen['s' + p.slot] = 1; seen['i' + p.id] = 1; }
            return ok;
        });
    }
    function read() {
        try { var d = JSON.parse(window.localStorage.getItem(KEY) || 'null'); return valid(d) ? d : null; } catch (e) { return null; }
    }
    var _data = read();
    // When StremioK opens (Settings › Profiles): ask (the default), the last profile used, or one
    // profile always (_data.start, with ask off) — except right after a switch (see setActive).
    function recentSwitch() { var at = _data && +_data.switched, now = Date.now(); return !!at && at <= now && now - at < 60000; }
    if (_data && _data.ask === false && _data.start && _data.start !== _data.active && !recentSwitch()) {
        for (var s0 = 0; s0 < _data.list.length; s0++) { if (_data.list[s0].id === _data.start) { _data.active = _data.start; save(); break; } }   // (save: hoisted, below)
    }
    function active() {
        if (!_data) { return null; }
        for (var i = 0; i < _data.list.length; i++) { if (_data.list[i].id === _data.active) { return _data.list[i]; } }
        return _data.list[0];
    }
    var _slot = (active() || { slot: '' }).slot;   // (fixed for this run: switching starts StremioK again)

    // A key of StremioK's: the TV's own, or a profile's.
    function isTv(k) {
        k = '' + k;
        if (k.indexOf('stremiok.') !== 0) { return true; }   // (not StremioK's: left alone)
        var n = k.slice(9);
        if (TV.indexOf(n) !== -1) { return true; }
        for (var i = 0; i < TV_PREFIX.length; i++) { if (n.indexOf(TV_PREFIX[i]) === 0) { return true; } }
        return false;
    }
    // The key as kept for the active profile: the TV's as it is; a profile's under its slot (none
    // for the first profile). A key already under a slot is left as it is.
    function key(k) {
        k = '' + k;
        if (!_slot || SLOT_KEY.test(k) || isTv(k)) { return k; }
        return 'stremiok.' + _slot + '.' + k.slice(9);
    }
    function keyFor(slot, k) {
        k = '' + k;
        if (!slot || isTv(k)) { return k; }
        return 'stremiok.' + slot + '.' + k.slice(9);
    }
    // Whose a kept key is: the slot of the profile it belongs to ('' the first's), or null (the TV's).
    function slotOf(physical) {
        var m = SLOT_KEY.exec('' + physical);
        if (m) { return m[1]; }
        return isTv(physical) ? null : '';
    }
    function list() { return _data ? _data.list.map(function (p) { return { id: p.id, name: p.name, color: p.color, slot: p.slot, at: p.at }; }) : []; }

    // ---- changing the list (Settings › Profiles, the picker) ----
    function save() { try { window.localStorage.setItem(KEY, JSON.stringify(_data)); return true; } catch (e) { return false; } }
    function newId() {
        var s = '', used = _data ? _data.list.map(function (p) { return p.id; }) : [];
        do { s = ''; while (s.length < 6) { s += Math.floor(Math.random() * 36).toString(36); } } while (used.indexOf(s) !== -1);   // (an id only: not a secret)
        return s;
    }
    // The list made the first time a second profile is added: the profile StremioK has always
    // run as becomes the first (firstName), in the slot it always had.
    function ensure(firstName) {
        if (_data) { return; }
        _data = { v: 1, active: '', ask: true, list: [{ id: newId(), slot: '', name: firstName, color: COLORS[0], at: Date.now() }] };
        _data.active = _data.list[0].id;
    }
    function find(id) { return _data ? _data.list.filter(function (p) { return p.id === id; })[0] || null : null; }
    function cleanName(n) { return ('' + (n || '')).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24); }
    // A new profile (MAX at most), in the first free slot: its entry, or null (full).
    function add(name, color, firstName) {
        ensure(firstName);
        if (_data.list.length >= MAX) { return null; }
        var taken = _data.list.map(function (p) { return p.slot; }), slot = SLOTS.filter(function (x) { return taken.indexOf(x) === -1; })[0];
        var p = { id: newId(), slot: slot, name: cleanName(name) || 'Profile', color: COLORS.indexOf(color) !== -1 ? color : COLORS[_data.list.length % COLORS.length], at: Date.now() };
        _data.list.push(p);
        save();
        return { id: p.id, name: p.name, color: p.color, slot: p.slot };
    }
    function rename(id, name) { var p = find(id); if (p && cleanName(name)) { p.name = cleanName(name); save(); } }
    function recolor(id, color) { var p = find(id); if (p && COLORS.indexOf(color) !== -1) { p.color = color; save(); } }
    function setAsk(on) { if (_data) { _data.ask = !!on; delete _data.start; save(); } }
    // 'ask' | 'last' | a profile's id.
    function startChoice() { if (!_data || _data.ask !== false) { return 'ask'; } return (_data.start && find(_data.start)) ? _data.start : 'last'; }
    function setStart(v) {
        if (!_data) { return; }
        if (v === 'ask') { _data.ask = true; delete _data.start; } else if (v === 'last' || !find(v)) { _data.ask = false; delete _data.start; } else { _data.ask = false; _data.start = v; }
        save();
    }
    // The profile StremioK starts in next time (switching: then started again, see setActive's caller).
    // switched: chosen just now (a switch, which restarts StremioK): the restart doesn't ask
    // "Who's watching?" again (justSwitched, read once, within a minute).
    function setActive(id, switched) { if (find(id)) { _data.active = id; if (switched) { _data.switched = Date.now(); } else { delete _data.switched; } save(); } }
    function justSwitched() {
        if (!_data || !_data.switched) { return false; }
        var was = recentSwitch();
        delete _data.switched; save();
        return was;
    }
    // A profile's own keys in the settings storage: [physical key].
    function keysOf(slot) {
        var out = [];
        try {
            var ls = window.localStorage;
            for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && slotOf(k) === slot && k !== KEY) { out.push(k); } }
        } catch (e) {}
        return out;
    }
    // What a new profile copies from the one it's made from, when asked to: its addons and their
    // order, its settings and its media server sign-ins (not its history, nor its Trakt or Stremio
    // account, nor a server's device id).
    var COPY = ['addons', 'addonsoff', 'addonorigin', 'aiomanager', 'feeds', 'searchfeeds', 'sourcefeeds', 'ranking', 'youtube', 'prefs',
        'subcfg', 'audiocfg', 'playercfg', 'jellyfin.servers', 'jellyfin.libs', 'plex.servers', 'plex.libs'];
    function copyInto(toSlot, fromSlot) {
        var n = 0;
        COPY.forEach(function (k) {
            try {
                var v = window.localStorage.getItem(keyFor(fromSlot, 'stremiok.' + k));
                if (v !== null) { window.localStorage.setItem(keyFor(toSlot, 'stremiok.' + k), v); n++; }
            } catch (e) {}
        });
        return n;
    }
    // A profile gone: removed from the list, and everything it kept with it (the settings storage
    // here; the TV's database through bigRemove(physical key), StremioK's own). Never the active
    // one, nor the last.
    var BIG = ['trakt.watched', 'media.watched', 'stremio.items'];
    function remove(id, bigRemove) {
        var p = find(id);
        if (!p || p.id === _data.active || _data.list.length < 2) { return false; }
        keysOf(p.slot).forEach(function (k) { try { window.localStorage.removeItem(k); } catch (e) {} });
        if (bigRemove) { BIG.forEach(function (k) { bigRemove(keyFor(p.slot, 'stremiok.' + k)); }); }
        _data.list = _data.list.filter(function (x) { return x.id !== id; });
        if (_data.start === id) { delete _data.start; }   // (opened in: then the last one used)
        save();
        return true;
    }

    return {
        KEY: KEY, MAX: MAX, COLORS: COLORS,
        key: key, keyFor: keyFor, isTv: isTv, slotOf: slotOf,
        slot: function () { return _slot; },
        list: list,
        active: function () { var a = active(); return a ? { id: a.id, name: a.name, color: a.color, slot: a.slot } : null; },
        count: function () { return _data ? _data.list.length : 1; },
        justSwitched: justSwitched,
        ask: function () { return !!(_data && _data.list.length > 1 && _data.ask !== false); },
        askSetting: function () { return !_data || _data.ask !== false; },
        ensure: function (firstName) { ensure(firstName); save(); }, add: add, rename: rename, recolor: recolor, setAsk: setAsk, startChoice: startChoice, setStart: setStart, setActive: setActive, remove: remove, copyInto: copyInto, keysOf: keysOf, COPY: COPY,
        __data: function () { return _data; }, __reload: function () { _data = read(); _slot = (active() || { slot: '' }).slot; }
    };
})();
