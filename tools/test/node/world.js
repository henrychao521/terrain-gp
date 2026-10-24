// Build a Taipei circuit with the real game.js in Node (no browser, no WebGL) and print its track geometry as JSON.
//
//   node tools/test/node/world.js <instrumented copy dir> <spec json>
//
// spec: {"preset": 0}  or  {"loop": [[X, Y], ...]}  or  {"pack": "<track pack file>", "id": "<track id>"}  (data coordinates, m east / north of TWD97 E 299000 / N 2766400)
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
const EXTRA = "window.TGPX = { cityPreset: (M, i) => cityPreset(M, i), setPts: p => { trackPts = p; }, TP_CIRCUITS, TP_ELEVATED, loadTaipei, TEX, raceUpdate: () => raceUpdate(), startLap: () => startLap(), trackLocate: (x, z, k) => trackLocate(x, z, k), resetRace: () => resetRace(), runLater: ms => (typeof runLater === 'function' ? runLater(ms) : 0), normalS: (...a) => normalS(...a), newHillTrack: s => (typeof newHillTrack === 'function' ? newHillTrack(s) : null), wallContact: (x, z, k, lat) => (typeof wallContact === 'function' ? wallContact(x, z, k, lat) : null), RACE, ATMO };\nwindow.TGP = (() =>";
let src = fs.readFileSync(path.join(copy, 'game.js'), 'utf8');
if (src.split('window.TGP = (() =>').length !== 2) { console.error('world.js: the copy is not instrumented (run instrument.py first)'); process.exit(2); }
src = src.replace('window.TGP = (() =>', EXTRA);
// spec.dump: also record the street trees the game keeps (position, scale, species), for tools/streetview/blender_render.py
const TREE_ANCHOR = '(pk ? park : street).push([x, z, h / 9, kind]);';
if (spec.dump) {
  if (src.split(TREE_ANCHOR).length !== 2) { console.error('world.js: tree anchor not found in game.js'); process.exit(2); }
  src = src.replace(TREE_ANCHOR, TREE_ANCHOR + ' (window.__TREES || (window.__TREES = [])).push([x, z, h / 9, kind, pk ? 1 : 0]);');
}
const errors = [];
const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
const origWarn = console.warn; console.warn = noop; console.log = noop;
process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + String(e && e.stack || e).slice(0, 300)));
try { vm.runInThisContext(src, { filename: 'game.js' }); }
catch (e) { origErr('game.js failed to boot in Node: ' + (e.stack || e)); process.exit(2); }

function dumpScene(W, file, R) {
  const T3 = G.THREE, cs = 50, near = new Set();
  for (let k = 0; k < W.n; k++) { const i = Math.floor(W.x[k] / cs), j = Math.floor(W.z[k] / cs), r = Math.ceil(R / cs); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) near.add((i + a) + ',' + (j + b)); }
  const keep = (x, z) => near.has(Math.floor(x / cs) + ',' + Math.floor(z / cs));
  const groups = {}, v = new T3.Vector3(), m = new T3.Matrix4(), mi = new T3.Matrix4();
  W.group.updateMatrixWorld(true);
  W.group.traverse(o => {
    if (!o.isMesh || !o.visible || o.name === 'skyline') return; // drawn by blender_render.py from data/skyline.json
    const g = o.geometry, pos = g && g.attributes && g.attributes.position; if (!pos) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material; if (!mat || (mat.blending === T3.AdditiveBlending)) return;
    const col = mat.color ? mat.color.getHexString() : 'ffffff', vc = !!mat.vertexColors && g.attributes.color;
    const texKey = mat.map ? (Object.keys(G.TGPX.TEX).find(k => G.TGPX.TEX[k] === mat.map) || 'canvas') : (mat.uniforms ? 'shader' : ''); const key = [col, texKey, mat.transparent ? 'tr' : '', o.isInstancedMesh ? 'inst' : '', g.type].join('|');
    const gr = groups[key] || (groups[key] = { color: col, map: !!mat.map, tex: texKey, rough: mat.roughness, metal: mat.metalness, vc: !!vc, transparent: !!mat.transparent, opacity: mat.opacity, type: mat.type, geo: g.type, name: o.name || '', inst: !!o.isInstancedMesh, p: [], c: [] });
    const idx = g.index ? g.index.array : null, nt = idx ? idx.length / 3 : pos.count / 3;
    const cnt = o.isInstancedMesh ? o.count : 1;
    for (let ii = 0; ii < cnt; ii++) {
      m.copy(o.matrixWorld); if (o.isInstancedMesh) { o.getMatrixAt(ii, mi); m.multiply(mi); }
      const ic = o.isInstancedMesh && o.instanceColor ? [o.instanceColor.getX(ii), o.instanceColor.getY(ii), o.instanceColor.getZ(ii)] : null;
      for (let t = 0; t < nt; t++) {
        const tri = [];
        for (let q = 0; q < 3; q++) { const vi = idx ? idx[t * 3 + q] : t * 3 + q; v.fromBufferAttribute(pos, vi).applyMatrix4(m); tri.push(v.x, v.y, v.z); }
        if (!keep((tri[0] + tri[3] + tri[6]) / 3, (tri[2] + tri[5] + tri[8]) / 3)) continue;
        for (const f of tri) gr.p.push(Math.round(f * 100) / 100);
        let cc = [1, 1, 1];
        if (vc) { const vi = idx ? idx[t * 3] : t * 3, ca = g.attributes.color; cc = [ca.getX(vi), ca.getY(vi), ca.getZ(vi)]; }
        if (ic) cc = [cc[0] * ic[0], cc[1] * ic[1], cc[2] * ic[2]];
        gr.c.push(...cc.map(x => Math.round(x * 255)));
      }
    }
  });
  const out = { R, groups: Object.values(groups).filter(g => g.p.length).map(g => ({ ...g, p: Buffer.from(new Float32Array(g.p).buffer).toString('base64'), c: Buffer.from(Uint8Array.from(g.c)).toString('base64'), tris: g.p.length / 9 })),
    trees: (G.__TREES || []).filter(([x, z]) => keep(x, z)) };
  fs.writeFileSync(file, JSON.stringify(out));
  return { file, groups: out.groups.length, tris: out.groups.reduce((s, g) => s + g.tris, 0), trees: out.trees.length };
}

(async () => {
  const TGP = G.TGP, X = G.TGPX;
  const need = ['W', 'setup', 'CITY', 'buildWorld', 'Sq'].filter(k => TGP.missing.includes(k));
  if (need.length) { origErr('game.js no longer has ' + need); process.exit(2); }
  await X.loadTaipei();
  const M = TGP.CITY.taipei; TGP.setup.map = 'taipei'; TGP.setup.reverse = false;
  let idx = spec.preset;
  if (spec.pack) { // a track from a track pack file (data/trackpacks), whether or not the game lists the pack
    const P = JSON.parse(fs.readFileSync(spec.pack, 'utf8')), t = (P.tracks || []).find(t => t.id === spec.id) || (P.tracks || [])[0];
    if (!t) { origErr('world.js: no track ' + spec.id + ' in ' + spec.pack); process.exit(2); }
    spec.loop = t.loop; spec.elevated = !!t.elevated; spec.id = t.id;
  }
  if (spec.loop) { X.TP_CIRCUITS.push(spec.loop); X.TP_ELEVATED.push(!!spec.elevated); idx = X.TP_CIRCUITS.length - 1; }
  if (X.TP_ELEVATED[idx]) TGP.setup.elevated = true;
  if (spec.setup) Object.assign(TGP.setup, spec.setup); // e.g. {"wideCorners": true}
  X.setPts(X.cityPreset(M, idx));
  TGP.buildWorld(); X.runLater(Infinity); // the parts of the build the game leaves for the next frames
  const W = TGP.W, n = W.n, r1 = v => Math.round(v * 1000) / 1000;
  const surf = new Float32Array(n); for (let k = 0; k < n; k++) surf[k] = TGP.Sq(W.x[k], W.z[k], k);
  const seq = []; for (let k = 0; k < n; k++) { const nm = W.rname[k] + (W.elev[k] > 0 ? '^' : ''); if (!seq.length || seq[seq.length - 1][0] !== nm) seq.push([nm, 0]); seq[seq.length - 1][1] += W.ds; }
  const out = {
    spec, n, ds: W.ds, len: Math.round(W.len), sx: W.sx, sz: W.sz,
    x: Array.from(W.x, r1), z: Array.from(W.z, r1), lx: Array.from(W.lx, r1), lz: Array.from(W.lz, r1), hwL: Array.from(W.hwL, r1), hwR: Array.from(W.hwR, r1),
    wallL: Array.from(W.wallL, v => (isFinite(v) ? r1(v) : null)), wallR: Array.from(W.wallR, v => (isFinite(v) ? r1(v) : null)), // barrier offsets (null: none); the car reaches barrier - 1 m
    surf: Array.from(surf, r1), elev: Array.from(W.elev, r1), rname: Array.from(W.rname), two: Array.from(W.two), lanes: Array.from(W.lanes),
    activeTiles: (W.activeTiles || []).map(t => ({ file: t.file, x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1 })),
    viaductM: Math.round(Array.from(W.elev).filter(v => v > 0).length * W.ds),
    hairpins: (W.corners || []).filter(c => c.deg >= 150).map(c => c.deg + '@' + W.rname[c.entry]),
    route: seq.filter(s => s[1] > 120).map(s => s[0] + ' ' + Math.round(s[1])).join(' → '),
    errors,
  };
  // optional: dump the scene the game built (everything in W.group: ground, road, kerbs, green areas, signals, lamps,
  // procedural buildings) within spec.dumpR m of the centreline, as triangle soups per material, plus the street trees.
  // glTF content (Blender tiles, props) does not load in Node; tools/streetview/blender_render.py imports it itself.
  if (spec.dump) out.dump = dumpScene(TGP.W, spec.dump, spec.dumpR || 300);
  // optional: run one of tools/test/js/*.js against this world (the same function Playwright evaluates in the page)
  if (spec.check) { try { out.check = await vm.runInThisContext('(' + fs.readFileSync(path.isAbsolute(spec.check) ? spec.check : path.join(__dirname, '..', 'js', spec.check), 'utf8') + ')')(spec.arg); } catch (e) { out.check = { error: String(e && e.stack || e).slice(0, 400) }; } }
  fs.writeSync(1, JSON.stringify(out)); // synchronous: process.exit would cut a piped stdout at 64 KB
  process.exit(0);
})().catch(e => { origErr('world.js: ' + (e.stack || e)); process.exit(2); });
