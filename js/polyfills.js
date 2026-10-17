/* Minimal polyfills for Tizen 3.0 (Chromium ~47). Each is feature-guarded. */
(function () {
    'use strict';

    if (typeof Object.assign !== 'function') {
        Object.assign = function (target) {
            for (var i = 1; i < arguments.length; i++) {
                var src = arguments[i];
                if (src) { for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) { target[k] = src[k]; } } }
            }
            return target;
        };
    }

    if (!Array.prototype.find) {
        Array.prototype.find = function (fn) {
            for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) { return this[i]; } }
            return undefined;
        };
    }

    if (!Array.prototype.findIndex) {
        Array.prototype.findIndex = function (fn) {
            for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) { return i; } }
            return -1;
        };
    }

    if (!Array.prototype.includes) {
        Array.prototype.includes = function (v) { return this.indexOf(v) !== -1; };
    }

    if (!String.prototype.includes) {
        String.prototype.includes = function (v) { return this.indexOf(v) !== -1; };
    }

    if (!Array.from) {
        Array.from = function (arrLike) {
            var out = []; for (var i = 0; i < arrLike.length; i++) { out.push(arrLike[i]); } return out;
        };
    }

    // requestAnimationFrame fallback (usually present, but be safe)
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = function (cb) { return window.setTimeout(function () { cb(Date.now()); }, 16); };
    }
})();
