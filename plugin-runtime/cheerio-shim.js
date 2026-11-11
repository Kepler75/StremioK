// (runs inside QuickJS, given to a plugin as require('cheerio')) cheerio's API over the Worker's
// own cheerio, run natively outside QuickJS (worker.mjs, cheerioBridge): a page and its selections
// are numbers on the other side; every call crosses as text (__cheerio(op, json, page)), and only
// text, numbers, booleans and those numbers come back. Nothing native is ever handed in.
// Each, map(fn), filter(fn), get and toArray run here, over one-element selections.
var host = __cheerio;
function call(op, a, text) { return JSON.parse(host(op, JSON.stringify(a), text === undefined ? '' : text)); }
function Sel(d, id, n) { this._d = d; this._id = id; this.length = n; }
var P = Sel.prototype;
function wrap(d, r) { return new Sel(d, r.sel, r.n); }
function argsOf(list) { return Array.prototype.map.call(list, function (x) { return x instanceof Sel ? { sel: x._id } : x; }); }
P._call = function (m, args) { return call('call', { doc: this._d, sel: this._id, m: m, args: argsOf(args || []) }); };
['find', 'children', 'parent', 'parents', 'parentsUntil', 'closest', 'next', 'prev', 'nextAll', 'prevAll', 'nextUntil', 'prevUntil', 'siblings', 'eq', 'first', 'last', 'not', 'has', 'slice', 'contents', 'end', 'addBack', 'add'].forEach(function (m) {
  P[m] = function () { return wrap(this._d, this._call(m, arguments)); };
});
['text', 'html', 'attr', 'val', 'data', 'hasClass', 'is', 'index', 'prop'].forEach(function (m) {
  P[m] = function () { var r = this._call(m, arguments); return r.sel !== undefined ? wrap(this._d, r) : r.v; };
});
P._items = function () { var d = this._d; return call('items', { doc: d, sel: this._id }).sels.map(function (id) { return new Sel(d, id, 1); }); };
P.each = function (f) { var it = this._items(); for (var i = 0; i < it.length; i++) { if (f.call(it[i], i, it[i]) === false) { break; } } return this; };
P.map = function (f) {
  var out = [], it = this._items();
  for (var i = 0; i < it.length; i++) { var v = f.call(it[i], i, it[i]); if (v !== null && v !== undefined) { out = out.concat(v); } }
  return { length: out.length, get: function (n) { return n === undefined ? out.slice() : out[n < 0 ? out.length + n : n]; }, toArray: function () { return out.slice(); }, join: function (s) { return out.join(s); } };
};
P.filter = function (f) {
  if (typeof f !== 'function') { return wrap(this._d, this._call('filter', arguments)); }
  var keep = [], it = this._items();
  for (var i = 0; i < it.length; i++) { if (f.call(it[i], i, it[i])) { keep.push(it[i]._id); } }
  return wrap(this._d, call('pick', { doc: this._d, sels: keep }));
};
P.get = function (n) { var it = this._items(); return n === undefined ? it : it[n < 0 ? it.length + n : n]; };
P.toArray = function () { return this._items(); };
// an element's own fields, as a plugin may read them off what each / get gives it
function node(s) { return call('node', { doc: s._d, sel: s._id }) || {}; }
Object.defineProperty(P, 'attribs', { get: function () { return node(this).attribs; } });
Object.defineProperty(P, 'tagName', { get: function () { return node(this).name; } });
Object.defineProperty(P, 'name', { get: function () { return node(this).name; } });
Object.defineProperty(P, 'type', { get: function () { return node(this).type; } });
Object.defineProperty(P, 'nodeValue', { get: function () { return node(this).data; } });
function load(html) {
  var r = call('load', {}, String(html)), d = r.doc;
  var $ = function (s, ctx) {
    if (s instanceof Sel) { return s; }
    var c = ctx instanceof Sel ? ctx._id : (typeof ctx === 'string' ? call('select', { doc: d, sel: ctx }).sel : null);
    return wrap(d, call('select', { doc: d, sel: String(s), ctx: c }));
  };
  $.root = function () { return new Sel(d, r.sel, r.n); };
  $.html = function (x) { return (x instanceof Sel ? x : $.root()).html(); };
  $.text = function (x) { return (x instanceof Sel ? x : $.root()).text(); };
  return $;
}
module.exports = { load: load };
module.exports['default'] = module.exports;
