// Build a Taipei circuit with the real game.js in Node (no browser, no WebGL) and print its track geometry as JSON.
//
//   node tools/test/node/world.js <instrumented copy dir> <spec json>
//
// spec: {"preset": 0}  or  {"loop": [[X, Y], ...]}  (data coordinates, m east / north of TWD97 E 299000 / N 2766400)
//
// The copy comes from tools/test/instrument.py (window.TGP); this script adds a few more internals (cityPreset,
// trackPts) and runs the page with a stand-in DOM: every element is a stub that keeps what is written to it and
// reads its default value / checked state from index.html, canvases draw nothing, the WebGL renderer is a stub.
// Only the world geometry matters here: centreline, half widths, surface height, road names, Blender tiles in range.
// three.js r128 (the same build index.html loads) is cached in tools/test/.cache/.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const [copy, specArg] = process.argv.slice(2);
if (!copy || !specArg) { console.error('usage: node world.js <copy dir> <spec json>'); process.exit(2); }
const spec = JSON.parse(specArg);
const THREE_JS = path.join(__dirname, '..', '.cache', 'three-r128.min.js');
if (!fs.existsSync(THREE_JS)) { console.error('missing ' + THREE_JS + ' (tools/test/headless.py downloads it)'); process.exit(2); }

// ---------------------------------------------------------------- stand-in DOM
const html = fs.readFileSync(path.join(copy, 'index.html'), 'utf8');
const DEF = {}; // id -> {value, checked}
for (const m of html.matchAll(/<(input|select|textarea|output|button|div|span|canvas|label|section|p)\b([^>]*)>/g)) {
  const a = m[2], id = /\bid="([^"]+)"/.exec(a); if (!id) continue;
  const v = /\bvalue="([^"]*)"/.exec(a); DEF[id[1]] = { value: v ? v[1] : '', checked: /\bchecked\b/.test(a) };
}
// <select>: the selected option, or the first one
for (const m of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  const sel = /<option\b[^>]*\bvalue="([^"]*)"[^>]*\bselected/.exec(m[2]) || /<option\b[^>]*\bvalue="([^"]*)"/.exec(m[2]);
  if (sel) DEF[m[1]] = { value: sel[1], checked: false };
}
const noop = () => {};
function anyStub() { // callable, every property is another stub, numbers read as 0, iterates as empty
  const store = {};
  const p = new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k in store) return store[k];
      if (k === 'length') return 0;
      return (store[k] = anyStub());
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return anyStub(); },
    construct() { return anyStub(); },
  });
  return p;
}
function ctx2d(cv) {
  const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
  const base = {
    canvas: cv, createImageData: (w, h) => (typeof w === 'object' ? img(w.width, w.height) : img(w | 0, h | 0)),
    getImageData: (x, y, w, h) => img(w | 0, h | 0), measureText: s => ({ width: String(s).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => ({}),
  };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return (t[k] = noop); }, set(t, k, v) { t[k] = v; return true; } });
}
const ELS = {};
function element(id, tag) {
  const d = (id && DEF[id]) || { value: '', checked: false }, store = {
    id: id || '', tagName: (tag || 'div').toUpperCase(), value: d.value, checked: d.checked, hidden: false, disabled: false, textContent: '', innerHTML: '',
    style: new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => { t[k] = v; return true; } }), dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, width: 300, height: 150, clientWidth: 1000, clientHeight: 600,
    offsetWidth: 1000, offsetHeight: 600, children: [], childNodes: [], options: [], files: [],
    addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null, removeAttribute: noop, appendChild: x => x, removeChild: x => x,
    append: noop, prepend: noop, remove: noop, insertBefore: x => x, replaceChildren: noop, focus: noop, blur: noop, click: noop, select: noop, scrollIntoView: noop,
    querySelector: () => element(), querySelectorAll: () => [], closest: () => element(), contains: () => false, cloneNode: () => element(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0 }),
    setPointerCapture: noop, releasePointerCapture: noop, requestFullscreen: () => Promise.resolve(), showModal: noop, close: noop, play: () => Promise.resolve(), pause: noop,
  };
  store.getContext = kind => (kind === '2d' ? (store._c || (store._c = ctx2d(el))) : null);
  store.toDataURL = () => 'data:,';
  const el = new Proxy(store, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return (t[k] = anyStub()); }, set(t, k, v) { t[k] = v; return true; } });
  return el;
}
const byId = id => ELS[id] || (ELS[id] = element(id));
const select = s => { const m = /^#([\w-]+)$/.exec(s.trim()); return m ? byId(m[1]) : element(); };
const document = {
  querySelector: select, getElementById: byId, querySelectorAll: () => [], createElement: tag => element(null, tag), createElementNS: (ns, tag) => element(null, tag),
  addEventListener: noop, removeEventListener: noop, body: element('body'), documentElement: element('html'), head: element('head'), hidden: false, visibilityState: 'visible',
  fonts: { ready: Promise.resolve(), load: () => Promise.resolve() }, fullscreenElement: null, exitFullscreen: () => Promise.resolve(), activeElement: null, title: '',
};
const storage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const G = globalThis;
Object.assign(G, {
  window: G, self: G, document, localStorage: storage(), sessionStorage: storage(), innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }), addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop, ImageData: function (w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); },
  Image: function () { return element(null, 'img'); }, AudioContext: undefined, webkitAudioContext: undefined, location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:' },
  DOMParser: function () { this.parseFromString = () => ({ getElementsByTagName: () => [] }); }, alert: noop, confirm: () => false, prompt: () => null,
});
try { Object.defineProperty(G, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, hardwareConcurrency: 8, vibrate: noop, clipboard: { writeText: () => Promise.resolve() } }, configurable: true }); } catch (e) { /* read-only in this Node */ }
G.fetch = u => {
  const f = path.join(copy, decodeURIComponent(String(u).split('?')[0]));
  if (!/^https?:/.test(u) && fs.existsSync(f)) {
    const buf = fs.readFileSync(f);
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error('404'); }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) });
};

// ---------------------------------------------------------------- three.js r128 with stand-ins for everything that needs WebGL
vm.runInThisContext(fs.readFileSync(THREE_JS, 'utf8'), { filename: 'three.min.js' });
const T3 = G.THREE;
T3.WebGLRenderer = function () { return anyStub(); };
T3.PMREMGenerator = function () { return { fromScene: () => ({ texture: null }), dispose: noop, compileEquirectangularShader: noop }; };
// GLTFLoader must exist so the Taipei tiles are listed; nothing is loaded
// (loads fail at once, so the game carries on without props and tiles; the geometry does not depend on them)
const fail = (url, onLoad, onProgress, onError) => { setTimeout(() => onError && onError(new Error('not loaded in Node: ' + url)), 0); };
T3.GLTFLoader = function () { return { register: noop, setDRACOLoader: noop, load: fail, parse: noop }; };
T3.TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) { fail(url, onLoad, onProgress, onError); return new T3.Texture(); };
T3.DRACOLoader = function () { return { setDecoderPath: noop, setWorkerLimit: noop, preload: noop, dispose: noop }; };

// ---------------------------------------------------------------- the game
const EXTRA = "window.TGPX = { cityPreset: (M, i) => cityPreset(M, i), setPts: p => { trackPts = p; }, TP_CIRCUITS, TP_ELEVATED, loadTaipei };\nwindow.TGP = (() =>";
let src = fs.readFileSync(path.join(copy, 'game.js'), 'utf8');
if (src.split('window.TGP = (() =>').length !== 2) { console.error('world.js: the copy is not instrumented (run instrument.py first)'); process.exit(2); }
src = src.replace('window.TGP = (() =>', EXTRA);
const errors = [];
const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
const origWarn = console.warn; console.warn = noop; console.log = noop;
process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + String(e && e.stack || e).slice(0, 300)));
try { vm.runInThisContext(src, { filename: 'game.js' }); }
catch (e) { origErr('game.js failed to boot in Node: ' + (e.stack || e)); process.exit(2); }

(async () => {
  const TGP = G.TGP, X = G.TGPX;
  const need = ['W', 'setup', 'CITY', 'buildWorld', 'Sq'].filter(k => TGP.missing.includes(k));
  if (need.length) { origErr('game.js no longer has ' + need); process.exit(2); }
  await X.loadTaipei();
  const M = TGP.CITY.taipei; TGP.setup.map = 'taipei'; TGP.setup.reverse = false;
  let idx = spec.preset;
  if (spec.loop) { X.TP_CIRCUITS.push(spec.loop); X.TP_ELEVATED.push(!!spec.elevated); idx = X.TP_CIRCUITS.length - 1; }
  if (X.TP_ELEVATED[idx]) TGP.setup.elevated = true;
  X.setPts(X.cityPreset(M, idx));
  TGP.buildWorld();
  const W = TGP.W, n = W.n, r1 = v => Math.round(v * 1000) / 1000;
  const surf = new Float32Array(n); for (let k = 0; k < n; k++) surf[k] = TGP.Sq(W.x[k], W.z[k], k);
  const seq = []; for (let k = 0; k < n; k++) { const nm = W.rname[k] + (W.elev[k] > 0 ? '^' : ''); if (!seq.length || seq[seq.length - 1][0] !== nm) seq.push([nm, 0]); seq[seq.length - 1][1] += W.ds; }
  const out = {
    spec, n, ds: W.ds, len: Math.round(W.len), sx: W.sx, sz: W.sz,
    x: Array.from(W.x, r1), z: Array.from(W.z, r1), lx: Array.from(W.lx, r1), lz: Array.from(W.lz, r1), hwL: Array.from(W.hwL, r1), hwR: Array.from(W.hwR, r1),
    surf: Array.from(surf, r1), elev: Array.from(W.elev, r1), rname: Array.from(W.rname), two: Array.from(W.two), lanes: Array.from(W.lanes),
    activeTiles: (W.activeTiles || []).map(t => ({ file: t.file, x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1 })),
    viaductM: Math.round(Array.from(W.elev).filter(v => v > 0).length * W.ds),
    hairpins: (W.corners || []).filter(c => c.deg >= 150).map(c => c.deg + '@' + W.rname[c.entry]),
    route: seq.filter(s => s[1] > 120).map(s => s[0] + ' ' + Math.round(s[1])).join(' → '),
    errors,
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})().catch(e => { origErr('world.js: ' + (e.stack || e)); process.exit(2); });
