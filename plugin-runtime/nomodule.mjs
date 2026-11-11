// (the legacy build only) quickjs-emscripten's Node branch imports 'module'; a TV Worker never runs
// it, but an old engine can't even parse a dynamic import(), so the bundle gets this instead.
export function createRequire() { return function () { throw new Error('no require in a TV Worker'); }; }
