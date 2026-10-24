(() => {
'use strict';
const $ = s => document.querySelector(s);
const G = 9.81, N = 513, DT = 1 / 240;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const fmt = t => { if (!(t >= 0) || !isFinite(t)) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };
const lin = h => new THREE.Color(h).convertSRGBToLinear();
const COARSE = matchMedia('(pointer:coarse)').matches;

/* ================= Noise ================= */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function valueNoise(seed) {
  const r = mulberry32(seed), tb = new Float32Array(65536);
  for (let i = 0; i < tb.length; i++) tb[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let xf = x - xi, yf = y - yi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, y0 = yi & 255, x1 = (xi + 1) & 255, y1 = (yi + 1) & 255;
    const a = tb[y0 * 256 + x0], b = tb[y0 * 256 + x1], c = tb[y1 * 256 + x0], d = tb[y1 * 256 + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(nz, x, y, oct, gain = 0.5) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * nz(x * f + i * 17.31, y * f - i * 9.13); n += a; a *= gain; f *= 2; } return s / n; }
function normalize01(arr) { let lo = Infinity, hi = -Infinity; for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; } const k = hi - lo > 1e-9 ? 1 / (hi - lo) : 0; for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * k; return { lo, hi }; }
function blur(arr, passes) {
  const tmp = new Float32Array(arr.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = arr[j * N + Math.max(0, i - 1)], b = arr[j * N + i], c = arr[j * N + Math.min(N - 1, i + 1)]; tmp[j * N + i] = (a + 2 * b + c) / 4; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = tmp[Math.max(0, j - 1) * N + i], b = tmp[j * N + i], c = tmp[Math.min(N - 1, j + 1) * N + i]; arr[j * N + i] = (a + 2 * b + c) / 4; }
  }
}

/* ================= Procedural textures ================= */
function canvasTex(w, h, draw, srgb = true, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
}
const TEX = {
  asphalt: canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(3), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 150 + (r() - 0.5) * 46 + (r() < 0.02 ? 50 : 0); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.06; for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 60, 8 + r() * 30, r() * 3, 0, 7); g.fill(); }
  }),
  detail: canvasTex(256, 256, (g, w, h) => {
    const nz = valueNoise(11), img = g.createImageData(w, h), r = mulberry32(8);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = (j * w + i) * 4, v = 205 + 40 * (fbm(nz, i / 32, j / 32, 4) - 0.5) + (r() - 0.5) * 30; img.data[o] = img.data[o + 1] = img.data[o + 2] = clamp(v, 0, 255); img.data[o + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, false),
  facade: canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(21);
    g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
    for (let fl = 0; fl < 4; fl++) for (let c = 0; c < 4; c++) {
      const x = c * 64 + 9, y = fl * 64 + 14, lit = r() < 0.12;
      g.fillStyle = lit ? '#c9b98f' : ['#3c4652', '#46505c', '#33404c'][Math.floor(r() * 3)]; g.fillRect(x, y, 46, 36);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 46, 4);
      g.fillStyle = '#9a978f'; g.fillRect(x - 3, y + 36, 52, 5);
      if (r() < 0.35) { g.fillStyle = '#8b8f94'; g.fillRect(x + 4, y + 40, 22, 10); } // AC unit
    }
  }),
  fence: canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(205,210,215,1)'; g.lineWidth = 3;
    for (let i = -w; i < w * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
    g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, 6, h);
  }),
  barrier: canvasTex(512, 64, (g, w, h) => {
    const cols = ['#e8e8e8', '#e8e8e8', '#c8102e', '#e8e8e8', '#1d3f8f', '#e8e8e8', '#e3a21a', '#e8e8e8'];
    g.fillStyle = '#b8b6b0'; g.fillRect(0, 0, w, h);
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 64 + 2, 6, 60, 40); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(i * 64 + 10, 20, 44, 6); });
    g.fillStyle = '#8e8c86'; g.fillRect(0, 50, w, 14);
  }),
};

TEX.fence.encoding = THREE.sRGBEncoding;
/* ---- tileable procedural materials (noise lattice wraps at the texture edge, so they repeat seamlessly) ---- */
function tileNoise(seed) {
  const r = mulberry32(seed), tb = new Float32Array(65536); for (let i = 0; i < tb.length; i++) tb[i] = r();
  const n = (x, y, P) => {
    const xi = Math.floor(x), yi = Math.floor(y); let xf = x - xi, yf = y - yi; xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = tb[y0 * 256 + x0], b = tb[y0 * 256 + x1], c = tb[y1 * 256 + x0], d = tb[y1 * 256 + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, P, oct = 4, gain = 0.5) => { let s = 0, a = 1, t = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * n(u * P * f + i * 13, v * P * f + i * 7, P * f); t += a; a *= gain; f *= 2; } return s / t; };
}
function pixTex(w, h, fn, opts = {}) { // fn(u, v) -> [r, g, b, a?] in 0..255
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = fn(i / w, j / h, i, j), o = (j * w + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c.length > 3 ? c[3] : 255; }
  g.putImageData(img, 0, 0); if (opts.after) opts.after(g, w, h);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (opts.srgb) t.encoding = THREE.sRGBEncoding; return t;
}
function normalFromHeight(hf, w, h, k) { // hf(u,v) height 0..1 -> tangent-space normal map
  const H = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = hf(i / w, j / h);
  return pixTex(w, h, (u, v, i, j) => {
    const dx = (H[j * w + (i + 1) % w] - H[j * w + (i - 1 + w) % w]) * k, dy = (H[((j + 1) % h) * w + i] - H[((j - 1 + h) % h) * w + i]) * k, l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
{
  const n1 = tileNoise(101), n2 = tileNoise(202), n3 = tileNoise(303), sp = mulberry32(77);
  TEX.grass = pixTex(256, 256, (u, v) => { const a = n1(u, v, 8, 5), b = n2(u, v, 64, 2), c = sp(); return lerp3(lerp3([62, 88, 38], [104, 128, 58], a), [138, 140, 74], Math.max(0, b - 0.62) * 1.6).map(x => x * (0.86 + 0.24 * c)); });
  TEX.dirt = pixTex(256, 256, (u, v) => { const a = n2(u, v, 6, 5), c = sp(); const base = lerp3([102, 82, 58], [148, 124, 92], a); return c < 0.03 ? [176, 168, 150] : base.map(x => x * (0.85 + 0.25 * c)); });
  TEX.rock = pixTex(256, 256, (u, v) => { const a = n3(u, v, 4, 6), b = n1(u, v, 16, 3), crack = Math.abs(n2(u, v, 8, 3) - 0.5) < 0.012 ? 0.55 : 1; return lerp3([92, 88, 84], [158, 152, 144], a * 0.7 + b * 0.3).map(x => x * crack); });
  TEX.snow = pixTex(128, 128, (u, v) => { const a = n1(u, v, 8, 4); return lerp3([214, 222, 232], [248, 250, 252], a); });
  TEX.pave = pixTex(256, 256, (u, v, i, j) => { const a = n2(u, v, 8, 4), joint = (i % 64 < 2 || j % 64 < 2) ? 0.72 : 1, c = sp(); return lerp3([150, 146, 138], [184, 180, 172], a).map(x => x * joint * (0.92 + 0.12 * c)); });
  // Taipei sidewalk: 32 cm grey pavers with terracotta bands, 2 m per texture tile
  TEX.walk = pixTex(256, 256, (u, v, i, j) => { const a = n2(u, v, 8, 3), c = sp(), joint = (i % 32 < 2 || j % 32 < 2) ? 0.7 : 1, band = (j >> 5) % 4 === 3; return (band ? lerp3([150, 92, 72], [176, 112, 88], a) : lerp3([156, 154, 148], [186, 184, 176], a)).map(x => x * joint * (0.9 + 0.14 * c)); }, { srgb: true });
  TEX.gravel = pixTex(256, 256, (u, v) => { const a = n3(u, v, 32, 2), c = sp(); return lerp3([168, 150, 118], [212, 196, 164], a).map(x => x * (0.7 + 0.45 * c)); }, { srgb: true });
  TEX.macro = pixTex(128, 128, (u, v) => { const a = n1(u, v, 4, 5) * 255; return [a, a, a]; });
  TEX.asphalt2 = pixTex(512, 512, (u, v) => { const a = n2(u, v, 16, 3), c = sp(); const g = 120 + a * 40 + (c - 0.5) * 70 + (c > 0.985 ? 60 : 0); return [g, g, g * 1.02]; }, { srgb: true });
  TEX.asphaltN = normalFromHeight((u, v) => n3(u, v, 128, 2) * 0.6 + sp() * 0.4, 256, 256, 2.2);
  TEX.waterN = normalFromHeight((u, v) => n1(u, v, 6, 4) * 0.7 + n2(u, v, 24, 2) * 0.3, 256, 256, 6);
  TEX.contact = (() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); })();
  // billboard foliage with alpha
  const foliage = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h, mulberry32(w + h)); const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
  TEX.treeBroad = foliage(256, 256, (g, w, h, r) => {
    g.fillStyle = '#4a3b2b'; g.fillRect(w / 2 - 6, h * 0.5, 12, h * 0.5); g.fillRect(w / 2 - 2, h * 0.38, 4, h * 0.2);
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()), x = w / 2 + Math.cos(a) * rr * w * 0.42, y = h * 0.4 + Math.sin(a) * rr * h * 0.34, lit = 1 - (y / h) * 0.9 + (w / 2 - x) / w * 0.4;
      const l = 14 + lit * 22 + r() * 8; g.fillStyle = `hsl(${88 + r() * 30},${38 + r() * 18}%,${l}%)`;
      g.beginPath(); g.arc(x, y, 5 + r() * 12, 0, 7); g.fill();
    }
  });
  TEX.treeCon = foliage(128, 256, (g, w, h, r) => {
    g.fillStyle = '#3d2f22'; g.fillRect(w / 2 - 4, h * 0.82, 8, h * 0.18);
    for (let i = 0; i < 900; i++) {
      const y = h * 0.04 + r() * h * 0.82, half = (y / h) * w * 0.46, x = w / 2 + (r() * 2 - 1) * half, lit = 1 - Math.abs(x - w / 2) / (half + 1) * 0.5;
      g.strokeStyle = `hsl(${110 + r() * 25},${30 + r() * 15}%,${10 + lit * 16 + r() * 6}%)`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x > w / 2 ? 6 : -6), y + 6 + r() * 4); g.stroke();
    }
  });
  TEX.tuft = foliage(128, 64, (g, w, h, r) => { for (let i = 0; i < 70; i++) { const x = 8 + r() * (w - 16); g.strokeStyle = `hsl(${70 + r() * 30},${35 + r() * 20}%,${18 + r() * 22}%)`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (r() - 0.5) * 10, h * 0.5, x + (r() - 0.5) * 22, h * (0.05 + r() * 0.4)); g.stroke(); } });
  // grandstand crowd, pit garages, armco, tyre walls
  TEX.crowd = canvasTex(256, 128, (g, w, h) => { const r = mulberry32(9); g.fillStyle = '#2a2e35'; g.fillRect(0, 0, w, h); for (let row = 0; row < 8; row++) for (let x = 2; x < w; x += 4 + r() * 2) { if (r() < 0.12) continue; g.fillStyle = r() < 0.15 ? `hsl(${[0, 210, 45][Math.floor(r() * 3)]},55%,45%)` : `hsl(${r() * 360},${8 + r() * 22}%,${22 + r() * 40}%)`; g.fillRect(x, row * 16 + 7, 3, 6); g.fillStyle = `hsl(28,${20 + r() * 20}%,${20 + r() * 35}%)`; g.fillRect(x, row * 16 + 3, 3, 3); } });
  TEX.garage = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#d9dbde'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) { g.fillStyle = '#2b2f36'; g.fillRect(i * 64 + 6, 18, 52, 46); g.fillStyle = 'rgba(255,255,255,.08)'; for (let y = 20; y < 64; y += 4) g.fillRect(i * 64 + 6, y, 52, 1); } g.fillStyle = '#c8102e'; g.fillRect(0, 4, w, 6); });
  TEX.armco = canvasTex(64, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c9ced3'); gr.addColorStop(0.25, '#eef1f3'); gr.addColorStop(0.45, '#8c939a'); gr.addColorStop(0.55, '#c9ced3'); gr.addColorStop(0.75, '#eef1f3'); gr.addColorStop(1, '#7d848b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  TEX.tyres = canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#121212'; g.fillRect(0, 0, w, h); for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) { const x = i * 32 + 16 + (row % 2) * 8, y = row * 21 + 11; g.fillStyle = '#262626'; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill(); g.fillStyle = '#060606'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, 3); });
  // Taipei facades: tiled walk-up with iron window grilles, glass office, weathered concrete; ground-floor arcade shops
  TEX.facA = canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(31); g.fillStyle = '#e2ddd3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let fl = 0; fl < 4; fl++) for (let c = 0; c < 3; c++) {
      const x = c * 85 + 12, y = fl * 64 + 12;
      g.fillStyle = '#30363d'; g.fillRect(x, y, 60, 38);
      g.fillStyle = r() < 0.15 ? '#cbbf9a' : '#56616c'; g.fillRect(x + 3, y + 3, 54, 32);
      g.strokeStyle = '#2e3236'; g.lineWidth = 2; for (let gx = x + 6; gx < x + 60; gx += 7) { g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + 44); g.stroke(); }
      g.fillStyle = '#9b958b'; g.fillRect(x - 4, y + 44, 68, 6);
      if (r() < 0.5) { g.fillStyle = '#c4c6c8'; g.fillRect(x + 64, y + 18, 16, 14); g.fillStyle = '#8f9295'; g.fillRect(x + 66, y + 20, 12, 10); }
      if (r() < 0.2) { g.fillStyle = `hsl(${r() * 360},40%,60%)`; g.fillRect(x + 4, y + 36, 50, 5); }
    }
    g.fillStyle = 'rgba(60,50,40,.12)'; for (let i = 0; i < 18; i++) g.fillRect(r() * w, 0, 2 + r() * 3, h);
  });
  TEX.facB = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#5d7a92'); gr.addColorStop(0.5, '#9db4c6'); gr.addColorStop(1, '#4c6378'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f3b46'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 4); for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y + 4, w, 6);
  });
  TEX.facC = canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(53); g.fillStyle = '#b3aea5'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,40,40,${0.03 + r() * 0.07})`; g.fillRect(r() * w, r() * h * 0.3, 3 + r() * 8, h * (0.4 + r() * 0.6)); }
    for (let fl = 0; fl < 4; fl++) for (let c = 0; c < 4; c++) { const x = c * 64 + 14, y = fl * 64 + 16; g.fillStyle = '#3a4047'; g.fillRect(x, y, 36, 30); g.fillStyle = '#7f8a92'; g.fillRect(x + 3, y + 3, 30, 12); g.fillStyle = '#8a857c'; g.fillRect(x - 3, y + 30, 42, 4); }
  });
  TEX.shop = canvasTex(256, 64, (g, w, h) => {
    const r = mulberry32(64); g.fillStyle = '#c9c3b8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const x = i * 64; g.fillStyle = '#1d2024'; g.fillRect(x + 8, 22, 48, 42);
      g.fillStyle = `hsl(${[0, 45, 120, 210, 30, 340][Math.floor(r() * 6)]},${55 + r() * 30}%,${45 + r() * 15}%)`; g.fillRect(x + 6, 4, 52, 14);
      g.fillStyle = 'rgba(255,240,200,.35)'; g.fillRect(x + 12, 30, 40, 26);
      g.fillStyle = '#9c968c'; g.fillRect(x, 0, 6, h);
    }
  });
}
for (const k of ['facA', 'facB', 'facC', 'shop', 'crowd', 'garage', 'armco', 'tyres']) TEX[k].anisotropy = 8;

/* ================= Terrain source ================= */
const TER = { norm: new Float32Array(N * N), meters: null, source: 'hills', seed: 7, size: 2400, range: 90, base: 150, raw: new Float32Array(N * N) };
const PRESETS = { hills: { range: 90, base: 150 }, mountain: { range: 320, base: 900 }, plateau: { range: 70, base: 2240 }, flat: { range: 8, base: 30 } };
function genPreset(name, seed) {
  const nz = valueNoise(seed), a = TER.norm;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / (N - 1), v = j / (N - 1); let h;
    if (name === 'mountain') { const r = 1 - Math.abs(2 * fbm(nz, u * 4, v * 4, 6) - 1); h = 0.55 * r * r + 0.45 * fbm(nz, u * 2 + 40, v * 2 + 40, 5); }
    else if (name === 'flat') h = fbm(nz, u * 3, v * 3, 4);
    else if (name === 'plateau') h = fbm(nz, u * 3.5, v * 3.5, 5, 0.45);
    else h = fbm(nz, u * 4.5, v * 4.5, 6, 0.5);
    a[j * N + i] = h;
  }
  normalize01(a); TER.meters = null; TER.source = name;
}
function applyTerrainScale() {
  const raw = TER.raw;
  if (TER.meters) for (let i = 0; i < raw.length; i++) raw[i] = TER.meters[i];
  else for (let i = 0; i < raw.length; i++) raw[i] = TER.norm[i] * TER.range;
}
// heights from an uploaded image. The encoded bytes are read at the image's own size with no smoothing, no colour
// management and no premultiplied alpha, decoded to metres, and only then resampled to N×N: blending encoded bytes
// corrupts Terrarium heights (−1 m = R 127 G 255 next to 0 m = R 128 G 0 blend to R 128 G 128, read as +128 m)
function decodeHeightPixels(d, w, h, enc) {
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    m[i] = enc === 'terrarium' ? r * 256 + g + b / 256 - 32768 : (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  return m;
}
// one axis of a w×h grid to n samples over the same extent (pixel centres, as drawImage(img, 0, 0, n, n) maps them);
// tent filter, widened to the source spacing when shrinking so every source pixel counts
function resampleAxis(src, w, h, n, alongX) {
  const L = alongX ? w : h, M = alongX ? h : w, s = L / n, r = Math.max(1, s), out = new Float32Array(alongX ? n * h : w * n);
  for (let o = 0; o < n; o++) {
    const c = Math.max(0, Math.min(L - 1, (o + 0.5) * s - 0.5)), i0 = Math.max(0, Math.ceil(c - r + 1e-9)), i1 = Math.min(L - 1, Math.floor(c + r - 1e-9));
    const wt = []; let sum = 0; for (let i = i0; i <= i1; i++) { const v = 1 - Math.abs(i - c) / r; wt.push(v); sum += v; }
    for (let q = 0; q < M; q++) { let acc = 0; for (let k = 0; k < wt.length; k++) acc += wt[k] * src[alongX ? q * w + i0 + k : (i0 + k) * w + q]; out[alongX ? q * n + o : o * w + q] = acc / sum; }
  }
  return out;
}
function resampleGrid(src, w, h, n) { return resampleAxis(resampleAxis(src, w, h, n, true), n, h, n, false); }
// WGS84 metres per degree of longitude and of latitude at latitude lat
function degMetres(lat) { const p = lat * Math.PI / 180; return [111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p), 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p)]; }
// slippy-map tiles: bounds from the tile's corners, ground size in metres (E–W at the middle latitude, N–S along a meridian)
function tile2lon(x, z) { return x / 2 ** z * 360 - 180; }
function tile2lat(y, z) { const t = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(t)); }
function tileGround(z, x, y) {
  const w = tile2lon(x, z), e = tile2lon(x + 1, z), n = tile2lat(y, z), s = tile2lat(y + 1, z), [kx] = degMetres((n + s) / 2);
  const p0 = s * Math.PI / 180, p1 = n * Math.PI / 180, ns = 111132.92 * (n - s) - 559.82 / 2 * 180 / Math.PI * (Math.sin(2 * p1) - Math.sin(2 * p0)); // meridian arc
  return { w, e, n, s, sx: (e - w) * kx, sz: ns };
}
// a tile saved as z_x_y.png (also z-x-y, z.x.y, or a z/x/y path when a folder is dropped); null if the name is not one
function tileFromName(name) {
  const m = /(?:^|[^0-9])(\d{1,2})[_\-./](\d{1,7})[_\-./](\d{1,7})\.(?:png|webp|jpe?g)$/i.exec(name || ''); if (!m) return null;
  const z = +m[1], x = +m[2], y = +m[3]; return z >= 1 && z <= 22 && x < 2 ** z && y < 2 ** z ? { z, x, y } : null;
}
async function imagePixels(file) {
  const draw = (src, w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = false; cx.drawImage(src, 0, 0, w, h); return { w, h, d: cx.getImageData(0, 0, w, h).data }; };
  const fit = (w, h) => { const k = Math.min(1, 4096 / Math.max(w, h)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; }; // past 4096 px: nearest pixels, never blended bytes
  if (typeof createImageBitmap === 'function') {
    try { const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); const [w, h] = fit(bmp.width, bmp.height), px = draw(bmp, w, h); px.srcW = bmp.width; px.srcH = bmp.height; bmp.close && bmp.close(); return px; }
    catch (e) { /* older browsers: fall back to <img> */ }
  }
  const url = URL.createObjectURL(file), img = new Image();
  try { await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }); const [w, h] = fit(img.naturalWidth || img.width, img.naturalHeight || img.height), px = draw(img, w, h); px.srcW = img.naturalWidth || img.width; px.srcH = img.naturalHeight || img.height; return px; }
  finally { URL.revokeObjectURL(url); }
}
async function loadHeightImage(file) {
  let px; try { px = await imagePixels(file); } catch (e) { $('#fileInfo').textContent = '無法讀取這個檔案。請使用 PNG 或 JPG 圖片。'; return; }
  const enc = $('#enc').value, inv = $('#invert').checked, raw = decodeHeightPixels(px.d, px.w, px.h, enc), dims = `${px.srcW}×${px.srcH}`;
  if (enc === 'terrarium') {
    const m = resampleGrid(raw, px.w, px.h, N);
    blur(m, 1);
    let lo = Infinity, hi = -Infinity; for (const v of m) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < m.length; i++) m[i] = inv ? hi - m[i] : m[i] - lo;
    TER.meters = m; TER.base = Math.max(0, Math.round(lo)); TER.range = Math.round(hi - lo);
    $('#base').value = TER.base; $('#range').value = Math.min(500, TER.range);
    // a z_x_y tile: its real ground size sets the map size, so slopes stay real (the map is square; the tile is within 1 %)
    const t = tileFromName(file.webkitRelativePath || file.name); let sizeNote = '水平尺寸由「地圖邊長」決定（檔名若是 z_x_y.png 的圖磚會自動換算實際大小）。';
    if (t) { const g = tileGround(t.z, t.x, t.y), side = (g.sx + g.sz) / 2, set = clamp(Math.round(side / 100) * 100, 1000, 6000);
      $('#size').value = set; TER.size = set;
      sizeNote = `圖磚 z${t.z}/${t.x}/${t.y} 實際約 ${(g.sx / 1000).toFixed(2)} × ${(g.sz / 1000).toFixed(2)} km` + (Math.abs(set - side) / side > 0.03 ? `，超出可用範圍，地圖邊長設為 ${(set / 1000).toFixed(1)} km（坡度是實際的 ${(side / set).toFixed(2)} 倍）。` : `，地圖邊長已設為 ${(set / 1000).toFixed(1)} km。`); }
    $('#fileInfo').textContent = `${file.name}：${dims}，實際海拔 ${Math.round(lo)}–${Math.round(hi)} m（高低差 ${Math.round(hi - lo)} m）。${sizeNote}`;
  } else {
    const a = TER.norm; a.set(resampleGrid(raw, px.w, px.h, N));
    if (inv) for (let i = 0; i < a.length; i++) a[i] = 1 - a[i];
    blur(a, 3); normalize01(a); TER.meters = null;
    $('#fileInfo').textContent = `${file.name}：${dims}，已重新取樣為 ${N}×${N}。高低差由下方滑桿決定。`;
  }
  TER.source = 'file';
  document.querySelectorAll('#presets .btn').forEach(b => b.classList.remove('sel'));
  syncLabels(); mapChanged();
}

/* ================= City maps (Taipei data file, or an imported .osm) ================= */
const CITY = { taipei: null, osm: null };
const ROAD_W = [18, 15, 12, 9, 6.5, 7];
function pointInPoly(x, z, p) {
  let c = false; for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) { const zi = p[i * 2 + 1], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < p[j * 2] + (z - zj) / (zi - zj) * (p[i * 2] - p[j * 2])) c = !c; }
  return c;
}
function finishCity(M) {
  // street graph for snapping and routing; expressways, bus lanes and ramps are left out of routing
  const key = new Map(), X = [], Z = [], adj = [], adjE = [], major = [], onViaduct = [];
  const node = (x, z) => { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let id = key.get(k); if (id === undefined) { id = X.length; key.set(k, id); X.push(x); Z.push(z); adj.push([]); adjE.push([]); } return id; };
  const COST = [1, 1, 1.12, 1.3, 2.2, 3];
  for (const r of M.roads) {
    if (/專用道/.test(r.n)) continue; // bus lanes stay out
    const elev = r.lay > 0 || /快速/.test(r.n), A = elev ? adjE : adj;
    let prev = -1;
    for (let i = 0; i < r.p.length; i += 2) {
      const id = node(r.p[i], r.p[i + 1]); if (r.c <= 3 && !(r.one && r.ln === 1) && !elev) major[id] = 1; if (r.lay > 0) onViaduct[id] = 1; // on a bridge or viaduct, not just an expressway at street level
      const inMap = Math.abs(X[id]) < M.sx / 2 - 20 && Math.abs(Z[id]) < M.sz / 2 - 20; // routes never leave the map
      if (!inMap) { prev = -1; continue; }
      if (prev >= 0 && prev !== id) { const w = Math.hypot(X[id] - X[prev], Z[id] - Z[prev]) * COST[r.c] * (r.one && r.ln === 1 ? 1.6 : 1); A[prev].push(id, w); if (!(elev && r.one)) A[id].push(prev, r.one ? w * 8 : w); } // single-lane frontage roads only when needed; viaducts strictly one way
      prev = id;
    }
  }
  M.graph = { x: Float32Array.from(X), z: Float32Array.from(Z), adj, adjE, major: Uint8Array.from(X, (_, i) => major[i] ? 1 : 0), viaduct: Uint8Array.from(X, (_, i) => onViaduct[i] ? 1 : 0) };
  // building footprint raster (4 m) so street trees never grow inside a building
  const cs = 4, rw = Math.ceil(M.sx / cs), rh = Math.ceil(M.sz / cs), occ = new Uint8Array(rw * rh);
  for (const b of M.blds) {
    const p = b.p, n = p.length / 2; let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { z0 = Math.min(z0, p[i * 2 + 1]); z1 = Math.max(z1, p[i * 2 + 1]); }
    for (let j = Math.max(0, Math.floor((z0 + M.sz / 2) / cs)); j <= Math.min(rh - 1, Math.floor((z1 + M.sz / 2) / cs)); j++) {
      const zc = -M.sz / 2 + (j + 0.5) * cs, xs = [];
      for (let i = 0, k = n - 1; i < n; k = i++) { const za = p[k * 2 + 1], zb = p[i * 2 + 1]; if ((za > zc) !== (zb > zc)) xs.push(p[k * 2] + (zc - za) / (zb - za) * (p[i * 2] - p[k * 2])); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.floor((xs[q] + M.sx / 2) / cs)); i <= Math.min(rw - 1, Math.floor((xs[q + 1] + M.sx / 2) / cs)); i++) occ[j * rw + i] = 1;
    }
  }
  M.occ = { cs, rw, rh, a: occ };
  return M;
}
function loadTaipei() {
  if (CITY.taipei) return Promise.resolve(CITY.taipei);
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  return Promise.all([get('data/taipei.json'), get('data/taipei_osm.json').catch(() => null), get('models/taipei/tiles.json').catch(() => null), loadProps(), loadTreeAtlas(), get('data/skyline.json').catch(() => null), loadPacks(), get('models/taipei/footprints.json').catch(() => null)]).then(([d, o, tl, , , sky, packs, fp]) => {
    const sx = d.nx * d.d, sz = d.ny * d.d, cell = 10, nx = sx / cell + 1, nz = sz / cell + 1;
    const zr = atob(d.z), mr = atob(d.mask), dz = new Float32Array(d.nx * d.ny), dm = new Uint8Array(d.nx * d.ny);
    for (let k = 0; k < dz.length; k++) { let v = zr.charCodeAt(2 * k) | (zr.charCodeAt(2 * k + 1) << 8); if (v > 32767) v -= 65536; dz[k] = v / 100; dm[k] = mr.charCodeAt(k); }
    const raw = new Float32Array(nx * nz), mask = new Uint8Array(nx * nz);
    for (let J = 0; J < nz; J++) for (let I = 0; I < nx; I++) {
      const X = I * cell, Y = sz - J * cell; // data: x east, y north
      const fi = clamp(X / d.d - 0.5, 0, d.nx - 1.001), fj = clamp(Y / d.d - 0.5, 0, d.ny - 1.001), i = fi | 0, j = fj | 0, a = fi - i, b = fj - j, o = j * d.nx + i;
      raw[J * nx + I] = dz[o] * (1 - a) * (1 - b) + dz[o + 1] * a * (1 - b) + dz[o + d.nx] * (1 - a) * b + dz[o + d.nx + 1] * a * b;
      mask[J * nx + I] = dm[Math.round(fj) * d.nx + Math.round(fi)];
    }
    const toW = arr => { const out = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 2) { out[i] = arr[i] - sx / 2; out[i + 1] = sz / 2 - arr[i + 1]; } return out; };
    const dW = a => toW(a.map(v => v / 10)), pt = (x, y) => [x / 10 - sx / 2, sz / 2 - y / 10];
    let roads = d.roads.map(r => ({ c: r[0], n: r[1], p: toW(r.slice(2).map(v => v / 10)) }));
    let blds = d.buildings.map(b => ({ h: b[0] / 10, p: toW(b.slice(1)) })), env = null;
    if (fp && fp.tiles) { // rebuilt Blender tiles: their final footprints replace data/taipei.json inside them (minimap, tree spots; D3)
      const boxes = Object.values(fp.tiles).map(t => [t.x0 - sx / 2, t.x1 - sx / 2, sz / 2 - t.y1, sz / 2 - t.y0]);
      const inBox = b => { const p = b.p, m = p.length / 2; let gx = 0, gz = 0; for (let i = 0; i < m; i++) { gx += p[i * 2]; gz += p[i * 2 + 1]; } gx /= m; gz /= m; return boxes.some(([x0, x1, z0, z1]) => gx >= x0 && gx < x1 && gz >= z0 && gz < z1); };
      blds = blds.filter(b => !inBox(b));
      for (const t of Object.values(fp.tiles)) for (const b of t.b) blds.push({ h: b[0] / 10, p: dW(b.slice(1)) });
    }
    if (o) { // OpenStreetMap detail: carriageway widths and lanes, one-way streets, street furniture and landmarks
      roads = o.roads.map(r => ({ c: r[0], n: r[1], one: r[2], ln: r[3], w: r[4] / 10, lay: r[5], p: dW(r.slice(6)) }));
      const bridges = (o.bridges || []).map(r => { const p = dW(r.slice(6)), m = p.length / 2, S = [0]; for (let i = 1; i < m; i++) S.push(S[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]));
        const L = S[m - 1], full = 6.5 * r[1], hv = Float32Array.from(S, s => Math.max(0.6, Math.min(full, r[3] ? s * 0.05 : full, r[4] ? (L - s) * 0.05 : full)));
        return { lay: r[1], w: r[2] / 10, name: r[5], p, hv }; });
      env = { bridges,
        signals: o.signals.map(([x, y, nm]) => { const [a, b] = pt(x, y); return { x: a, z: b, names: nm ? nm.split('／') : [] }; }),
        crossings: o.crossings.map(([x, y]) => pt(x, y)),
        trees: o.trees.map(([x, y, park, kind = 0, h = 90]) => { const [a, b] = pt(x, y); return [a, b, park, kind, h / 10]; }), // kind: 0 broadleaf, 1 banyan, 2 golden rain tree, 3 palm, 4 tall narrow; height m
        green: o.green.map(g => ({ kind: g[0], p: dW(g.slice(1)) })),
        landmarks: o.landmarks.map(l => ({ ...l, p: dW(l.p) })),
      };
      const inLm = (x, z) => env.landmarks.some(l => pointInPoly(x, z, l.p));
      blds = blds.filter(b => { const p = b.p, m = p.length / 2; let gx = 0, gz = 0; for (let i = 0; i < m; i++) { gx += p[i * 2]; gz += p[i * 2 + 1]; } return !inLm(gx / m, gz / m); });
    }
    // Blender-built scenery tiles replace the generated buildings and landmarks inside their bounds
    const tiles = tl && window.THREE.GLTFLoader ? tl.tiles.map(t => ({ file: 'models/taipei/' + t.file, x0: t.x0 - sx / 2, x1: t.x1 - sx / 2, z0: sz / 2 - t.y1, z1: sz / 2 - t.y0 })) : [];
    addPackTracks(packs);
    return (CITY.taipei = finishCity({ kind: 'city', id: 'taipei', name: d.name, sx, sz, nx, nz, raw, mask, base: 0, water: 0.35, roads, blds, env, tiles, skyline: sky, credits: d.credits + (o ? '；' + o.credits : '') + (sky ? '；' + sky.note : '') }));
  });
}
// lat/lon → metres east (x) / south (z) of (lat0, lon0): local equirectangular with WGS84 metres per degree at lat0
// (was 111320·cos φ0 and a fixed 110540 m per degree of latitude: −0.21 % north–south at 25°N)
function lonLatProjector(lat0, lon0) { const [kx, ky] = degMetres(lat0); return ([la, lo]) => [(lo - lon0) * kx, -(la - lat0) * ky]; }
function parseOSM(text, fileName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('不是有效的 OSM XML 檔。');
  const nodes = new Map();
  for (const n of doc.getElementsByTagName('node')) nodes.set(n.getAttribute('id'), [+n.getAttribute('lat'), +n.getAttribute('lon')]);
  if (!nodes.size) throw new Error('檔案裡沒有任何節點。');
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  const bd = doc.getElementsByTagName('bounds')[0];
  if (bd) { la0 = +bd.getAttribute('minlat'); la1 = +bd.getAttribute('maxlat'); lo0 = +bd.getAttribute('minlon'); lo1 = +bd.getAttribute('maxlon'); }
  else for (const [la, lo] of nodes.values()) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const lat0 = (la0 + la1) / 2, lon0 = (lo0 + lo1) / 2, P = lonLatProjector(lat0, lon0), [kx, ky] = degMetres(lat0);
  const sx = Math.max(600, Math.ceil(((lo1 - lo0) * kx + 160) / 10) * 10), sz = Math.max(600, Math.ceil(((la1 - la0) * ky + 160) / 10) * 10);
  if (sx > 12000 || sz > 12000) throw new Error(`範圍 ${(sx / 1000).toFixed(1)} × ${(sz / 1000).toFixed(1)} km 太大，請匯出 10 km 以內的範圍。`);
  const HW = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, residential: 4, unclassified: 4, living_street: 4, service: 4, road: 4, motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5 };
  const roads = [], blds = [], water = [];
  for (const w of doc.getElementsByTagName('way')) {
    const tags = {}; for (const t of w.getElementsByTagName('tag')) tags[t.getAttribute('k')] = t.getAttribute('v');
    const pts = []; for (const nd of w.getElementsByTagName('nd')) { const n = nodes.get(nd.getAttribute('ref')); if (n) pts.push(...P(n)); }
    if (pts.length < 4) continue;
    if (tags.highway in HW && tags.tunnel !== 'yes' && tags.area !== 'yes') roads.push({ c: HW[tags.highway], n: tags.name || '', p: Float32Array.from(pts) });
    else if (tags.building && tags.building !== 'no') {
      let h = parseFloat(tags.height); if (!(h > 0)) h = (parseFloat(tags['building:levels']) || 3) * 3.2;
      if (pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) pts.length -= 2;
      if (pts.length >= 6) blds.push({ h: Math.min(h, 400), p: Float32Array.from(pts) });
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') water.push(pts);
  }
  if (!roads.length) throw new Error('範圍內沒有可行駛的道路。');
  const cell = 8, nx = Math.round(sx / cell) + 1, nz = Math.round(sz / cell) + 1, raw = new Float32Array(nx * nz), mask = new Uint8Array(nx * nz).fill(1);
  for (const p of water) { // scanline fill water polygons into the mask and lower the ground under them
    const n = p.length / 2;
    for (let J = 0; J < nz; J++) {
      const zc = -sz / 2 + J * (sz / (nz - 1)), xs = [];
      for (let i = 0, k = n - 1; i < n; k = i++) { const za = p[k * 2 + 1], zb = p[i * 2 + 1]; if ((za > zc) !== (zb > zc)) xs.push(p[k * 2] + (zc - za) / (zb - za) * (p[i * 2] - p[k * 2])); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let I = Math.max(0, Math.ceil((xs[q] + sx / 2) / (sx / (nx - 1)))); I <= Math.min(nx - 1, Math.floor((xs[q + 1] + sx / 2) / (sx / (nx - 1)))); I++) { mask[J * nx + I] = 0; raw[J * nx + I] = -2.5; }
    }
  }
  return finishCity({ kind: 'city', id: 'osm', name: fileName, sx, sz, nx, nz, raw, mask, base: TER.base, water: water.length ? -0.4 : null, roads, blds, credits: '道路、建物與水域：© OpenStreetMap contributors（ODbL）' });
}

/* ================= Track points ================= */
// points live in the editor's square view: u,v ∈ [0,1] over V = max(map width, map height); city points also carry a street node id
let trackPts = [];
// hill tracks come from a seed (mulberry32), so a track can be driven again and its lap times compared (D7):
// 「標準丘陵 A」 is the default, any other seed can be typed in. hillSeed is null once the points are edited by hand.
const HILL_STD = 20261024; let hillSeed = HILL_STD, HILL_DEF = '';
const hillSig = () => ['size', 'range', 'base', 'width'].map(id => $('#' + id).value).concat([$('#walls').checked, $('#banking').checked]).join('|');
function newHillTrack(seed) {
  hillSeed = clamp(Math.floor(+seed) || HILL_STD, 1, 999999999); trackPts = randomTrack(hillSeed);
  const el = $('#hillSeed'); if (el) el.value = hillSeed;
}
const randomSeed = () => 1 + Math.floor(Math.random() * 999999998);
function randomTrack(seed) {
  const r = mulberry32(seed), n = 9 + Math.floor(r() * 5), pts = [];
  const cx = 0.5 + (r() - 0.5) * 0.06, cy = 0.5 + (r() - 0.5) * 0.06;
  for (let i = 0; i < n; i++) {
    const ang = -i / n * Math.PI * 2 + (r() - 0.5) * 0.35, rad = 0.2 + r() * 0.2 * (i % 3 === 0 ? 0.6 : 1);
    pts.push({ u: clamp(cx + Math.cos(ang) * rad, 0.06, 0.94), v: clamp(cy + Math.sin(ang) * rad * 0.92, 0.06, 0.94) });
  }
  return pts;
}
const TP_CIRCUITS = [ // street junctions in data coordinates (m east, m north of TWD97 299000 / 2766400)
  [[3239, 3774], [3913, 3406], [4745, 3209], [4971, 2370], [4077, 2450], [3732, 2478], [3516, 2781], [3156, 3318]],
  [[615, 2675], [1510, 3124], [2028, 3297], [1877, 2800], [1511, 2730]],
  [[4312, 3718], [4207, 3247], [4745, 3209], [4760, 3709]], // counter-clockwise: 信義路 is one way eastbound
];
const TP_ELEVATED = [false, false, false]; // presets that need elevated roads in the route (none: no viaduct in the map can be driven as a loop in its own direction)
// Optional track packs (data/trackpacks/*.json, format in data/trackpacks/README.md): circuits kept out of the default lists.
// Only the files listed here are loaded, and only their tracks get a button; a pack that is not listed never shows up anywhere.
const TRACK_PACKS = [];
const loadPacks = () => Promise.all(TRACK_PACKS.map(u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)));
function addPackTracks(packs) { // Taipei tracks of the listed packs become extra preset buttons
  for (const P of packs) for (const t of (P && P.tracks) || []) {
    if (t.map !== 'taipei' || !Array.isArray(t.loop) || t.loop.length < 3) continue;
    const i = TP_CIRCUITS.push(t.loop.map(p => [+p[0], +p[1]])) - 1; TP_ELEVATED.push(!!t.elevated);
    const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.dataset.c = String(i); b.textContent = t.name || '環線 ' + (i + 1);
    b.onclick = () => tpPick(b); $('#tpPresets').appendChild(b);
  }
}
// nearest street node; a main carriageway within 40 m wins over a closer frontage road or lane
function snapNode(M, x, z) { const g = M.graph; let best = 0, bd = Infinity; for (let i = 0; i < g.x.length; i++) { const d = (g.x[i] - x) ** 2 + (g.z[i] - z) ** 2 + (g.major && !g.major[i] ? 1600 : 0); if (d < bd) { bd = d; best = i; } } return best; }
const viewSize = M => Math.max(M.sx, M.sz);
function cityPoint(M, x, z) { const id = snapNode(M, x, z), V = viewSize(M); return { u: M.graph.x[id] / V + 0.5, v: M.graph.z[id] / V + 0.5, node: id }; }
function cityPreset(M, i) {
  const g = M.graph;
  return TP_CIRCUITS[i].map(([X, Y]) => { const x = X - M.sx / 2, z = M.sz / 2 - Y, p = cityPoint(M, x, z), c = [], near = k => (g.x[k] - x) ** 2 + (g.z[k] - z) ** 2 < 45 * 45;
    if (TP_ELEVATED[i] && g.viaduct) for (let k = 0; k < g.x.length; k++) if (g.viaduct[k] && near(k)) c.push(k); // elevated presets: the viaduct over the street, not the street
    if (!c.length) for (let k = 0; k < g.x.length; k++) if ((!g.major || g.major[k]) && near(k)) c.push(k);
    c.sort((a, b) => ((g.x[a] - x) ** 2 + (g.z[a] - z) ** 2) - ((g.x[b] - x) ** 2 + (g.z[b] - z) ** 2));
    p.alt = c.length ? c.slice(0, 6) : [p.node]; return p; });
}

// directed edges in one flat list (streets, then viaducts) so a search state can be "the edge just driven"
function graphEdges(g) {
  if (g.E) return g.E;
  const n = g.x.length, off = new Int32Array(n + 1), fr = [], to = [], w = [], el = [];
  for (let u = 0; u < n; u++) { off[u] = to.length; [g.adj[u], g.adjE ? g.adjE[u] : []].forEach((a, f) => { for (let e = 0; e < a.length; e += 2) { fr.push(u); to.push(a[e]); w.push(a[e + 1]); el.push(f); } }); }
  off[n] = to.length; return (g.E = { off, fr: Int32Array.from(fr), to: Int32Array.from(to), w: Float64Array.from(w), el: Uint8Array.from(el) });
}
// turning back by more than 100° (heading over the last 8 m against the next edge) costs up to 400 m of driving:
// where one-way carriageways touch at a node (a Y junction, a median crossing) the cheapest way is otherwise to drive past the turn and come back sharply
const TURN_FREE = 100, TURN_COST = 400;
function turnCost(g, bx, bz, u, v) {
  const ax = g.x[u] - bx, az = g.z[u] - bz, cx = g.x[v] - g.x[u], cz = g.z[v] - g.z[u], c = (ax * cx + az * cz) / (Math.hypot(ax, az) * Math.hypot(cx, cz) + 1e-9);
  const d = Math.acos(clamp(c, -1, 1)) * 180 / Math.PI; return d > TURN_FREE ? TURN_COST * (d - TURN_FREE) / (180 - TURN_FREE) : 0;
}
// A* over directed edges with turn costs; came: the node driven from into s (the previous leg), -1 if none
function astar(g, s, t, came = -1) {
  const E = graphEdges(g), m = E.to.length, dist = new Float64Array(m + 1).fill(Infinity), prev = new Int32Array(m + 1).fill(-1), done = new Uint8Array(m + 1), elev = setup.elevated && g.adjE;
  const hx = g.x[t], hz = g.z[t], heap = [];
  const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  dist[m] = 0; push(0, m); let end = -1; // state m: standing on s
  while (heap.length) {
    const [, q] = pop(); if (done[q]) continue; done[q] = 1;
    const u = q === m ? s : E.to[q]; if (u === t) { end = q; break; }
    let b = q === m ? came : E.fr[q]; // heading in: from a node at least 8 m back
    for (let r = q, run = 0; r !== m && b >= 0; ) { run += Math.hypot(g.x[E.to[r]] - g.x[E.fr[r]], g.z[E.to[r]] - g.z[E.fr[r]]); b = E.fr[r]; if (run >= 8) break; r = prev[r]; if (r === m) { if (came >= 0) b = came; break; } }
    for (let e = E.off[u]; e < E.off[u + 1]; e++) { if (E.el[e] && !elev) continue; const v = E.to[e], nd = dist[q] + E.w[e] + (b >= 0 ? turnCost(g, g.x[b], g.z[b], u, v) : 0); if (nd < dist[e]) { dist[e] = nd; prev[e] = q; push(nd + Math.hypot(g.x[v] - hx, g.z[v] - hz), e); } }
  }
  if (end < 0) return null;
  const path = []; for (let r = end; r !== m; r = prev[r]) path.push(E.to[r]); path.push(s); path.reverse(); path.cost = dist[end]; return path;
}
// number of U-turns along a node path: the heading reverses (> 150°) within about 30 m
function uTurns(g, path) {
  const P = []; for (const v of path) { const q = [g.x[v], g.z[v]], l = P[P.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 6) P.push(q); }
  let n = 0;
  for (let i = 1; i + 1 < P.length; i++) {
    let j = i + 1, run = 0; while (j < P.length - 1 && run < 30) { run += Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]); j++; }
    const ax = P[i][0] - P[i - 1][0], az = P[i][1] - P[i - 1][1], bx = P[j][0] - P[j - 1][0], bz = P[j][1] - P[j - 1][1];
    if ((ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) + 1e-9) < -0.87) { n++; i = j; }
  }
  return n;
}
function choosePresetNodes(M, pts) {
  const g = M.graph, cache = new Map(), n = pts.length, nodes = pts.map(p => p.node);
  const leg = (a, b) => { const k = a + ',' + b; if (!cache.has(k)) cache.set(k, a === b ? Object.assign([a], { cost: 0 }) : astar(g, a, b)); return cache.get(k); };
  const score = (i, c) => { const p1 = leg(nodes[(i - 1 + n) % n], c), p2 = leg(c, nodes[(i + 1) % n]); if (!p1 || !p2) return Infinity; return p1.cost + p2.cost + 5000 * uTurns(g, p1.concat(p2.slice(1))); };
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { let best = nodes[i], bs = Infinity; for (const c of pts[i].alt) { const s2 = score(i, c); if (s2 < bs) { bs = s2; best = c; } } nodes[i] = best; }
  return pts.map((p, i) => ({ ...p, node: nodes[i] }));
}
function routeLoop(M, pts) {
  const g = M.graph, n = pts.length, legs = [], near = (v, a) => Math.hypot(g.x[v] - g.x[a], g.z[v] - g.z[a]) < 45;
  // preset waypoints carry nearby carriageway nodes: pick the ones that give the cheapest legs without U-turns
  if (pts.every(p => p.alt)) pts = choosePresetNodes(M, pts);
  for (let i = 0; i < n; i++) { const a = pts[i].node, b = pts[(i + 1) % n].node, l = legs[i - 1]; legs.push(a === b ? [a] : astar(g, a, b, l && l.length > 1 ? l[l.length - 2] : -1) || [a, b]); }
  // the way in and the way out of a waypoint meeting at a sharp angle (it sits where carriageways cross, e.g. the tip of a Y junction):
  // route from 60 m before it to the next waypoint with turns priced and keep that if it still passes within 45 m (a slip road)
  let moved0 = false;
  for (let i = 0; i < n && n > 1; i++) {
    const L = legs[(i - 1 + n) % n], a = pts[i].node, N = legs[i]; if (L.length < 2 || N.length < 2) continue;
    let j = L.length - 1, run = 0; while (j > 0 && run < 8) { run += Math.hypot(g.x[L[j]] - g.x[L[j - 1]], g.z[L[j]] - g.z[L[j - 1]]); j--; }
    if (!turnCost(g, g.x[L[j]], g.z[L[j]], a, N[1])) continue;
    let k = L.length - 1; run = 0; while (k > 0 && run < 60) { run += Math.hypot(g.x[L[k]] - g.x[L[k - 1]], g.z[L[k]] - g.z[L[k - 1]]); k--; }
    const q = astar(g, L[k], pts[(i + 1) % n].node, k > 0 ? L[k - 1] : -1);
    if (!q || !q.some((v, x) => x > 0 && near(v, a))) continue;
    legs[(i - 1 + n) % n] = L.slice(0, k + 1); legs[i] = q; if (i === 0) moved0 = true;
  }
  let out = []; for (const l of legs) for (let k = 0; k < l.length - 1; k++) out.push(l[k]);
  if (moved0) { let s0 = 0; out.forEach((v, k) => { if (Math.hypot(g.x[v] - g.x[pts[0].node], g.z[v] - g.z[pts[0].node]) < Math.hypot(g.x[out[s0]] - g.x[pts[0].node], g.z[out[s0]] - g.z[pts[0].node])) s0 = k; }); out = out.slice(s0).concat(out.slice(0, s0)); } // the start stays at the first waypoint
  return out.map(v => [g.x[v], g.z[v]]);
}
function resampleLoop(P, step) {
  const n = P.length, cum = [0];
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], m = Math.max(8, Math.round(L / step)), out = []; let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k / m * L; while (j < n - 1 && cum[j + 1] < s) j++;
    const a = P[j], b = P[(j + 1) % n], f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
// is the straight segment a -> b on paved road all the way? (every 2 m within a ground-level street's half width + 1 m)
function chordOnRoad(M, a, b) {
  if (!M.roads.length || !M.roads[0].w) return false;
  const cs = 25, cell = (x, z) => Math.floor(x / cs) + ',' + Math.floor(z / cs);
  if (!M._chordGrid) { M._chordGrid = new Map(); M.roads.forEach((r, ri) => { if (r.lay > 0) return; for (let i = 0; i + 3 < r.p.length; i += 2) { const k = cell((r.p[i] + r.p[i + 2]) / 2, (r.p[i + 1] + r.p[i + 3]) / 2); if (!M._chordGrid.has(k)) M._chordGrid.set(k, []); M._chordGrid.get(k).push(ri, i); } }); }
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / 2));
  for (let s = 0; s <= steps; s++) {
    const x = a[0] + (b[0] - a[0]) * s / steps, z = a[1] + (b[1] - a[1]) * s / steps, cx = Math.floor(x / cs), cz = Math.floor(z / cs); let ok = false;
    for (let u = -1; u <= 1 && !ok; u++) for (let v = -1; v <= 1 && !ok; v++) { const lst = M._chordGrid.get((cx + u) + ',' + (cz + v)); if (!lst) continue;
      for (let e = 0; e < lst.length && !ok; e += 2) { const r = M.roads[lst[e]], i = lst[e + 1], x0 = r.p[i], z0 = r.p[i + 1], dx = r.p[i + 2] - x0, dz = r.p[i + 3] - z0, l2 = dx * dx + dz * dz || 1;
        const f = clamp(((x - x0) * dx + (z - z0) * dz) / l2, 0, 1); if (Math.hypot(x - x0 - dx * f, z - z0 - dz * f) <= r.w / 2 + 1) ok = true; } }
    if (!ok) return false;
  }
  return true;
}
function cleanRoute(P, M) {
  let p = P.filter((q, i) => i === 0 || Math.hypot(q[0] - P[i - 1][0], q[1] - P[i - 1][1]) > 0.5);
  if (M) { // cut across junction boxes: dual carriageways make the route zig-zag between their nodes (S, E, N, E for one left turn)
    for (let i = 0; i < p.length - 2; i++) {
      let len = 0, cut = -1;
      for (let j = i + 1; j < Math.min(p.length, i + 7); j++) {
        len += Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]); if (len > 70) break;
        if (j >= i + 2 && len > 1.35 * Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1]) && chordOnRoad(M, p[i], p[j])) cut = j;
      }
      if (cut > 0) p.splice(i + 1, cut - i - 1);
    }
  }
  for (let pass = 0; pass < 6; pass++) { // drop dead-end spikes (route going down a street and straight back)
    const keep = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
      const cs = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) + 1e-9);
      if (cs > -0.8 || p.length < 6) keep.push(b);
    }
    if (keep.length === p.length) break; p = keep;
  }
  p = resampleLoop(p, 3);
  const X = Float32Array.from(p, q => q[0]), Z = Float32Array.from(p, q => q[1]);
  smoothCirc(X, 5, 3); smoothCirc(Z, 5, 3);
  // a rounded corner must stay in the street: the smoothed line may move at most 3 m off the road centreline,
  // or a 90° turn on a narrow street cuts through the corner building
  const clampDev = maxDev => { for (let i = 0; i < p.length; i++) { const dx = X[i] - p[i][0], dz = Z[i] - p[i][1], d = Math.hypot(dx, dz); if (d > maxDev) { X[i] = p[i][0] + dx / d * maxDev; Z[i] = p[i][1] + dz / d * maxDev; } } };
  clampDev(3); smoothCirc(X, 2, 1); smoothCirc(Z, 2, 1); clampDev(3.2);
  return resampleLoop(Array.from(X, (x, i) => [x, Z[i]]), 2);
}

/* ================= Three setup ================= */
const canvas = $('#view');
// antialiasing is fixed when the WebGL context is made, so it follows the saved quality: always on 高, never on 低, and on 中 / 自動
// only on desktops (phones are fill-rate bound and their screens dense); window.TGP_ANTIALIAS (true / false) overrides it
const SAVED_Q = (() => { try { return (JSON.parse(localStorage.getItem('tgp-prefs') || 'null') || {}).quality || 'auto'; } catch (e) { return 'auto'; } })();
const wantAA = q => (typeof window.TGP_ANTIALIAS === 'boolean' ? window.TGP_ANTIALIAS : q === 'high' || (q !== 'low' && !COARSE));
const AA = wantAA(SAVED_Q);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: AA, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.38).normalize();
const SKY = { horizon: new THREE.Color(0.6, 0.71, 0.83) };
scene.fog = new THREE.FogExp2(SKY.horizon.clone().multiplyScalar(0.95), 0.00017);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 12000);
const RAIN = (() => { // streaks fall and wrap around the camera in the vertex shader; the buffer never changes
  const N = COARSE ? 1600 : 4000, P = new Float32Array(N * 6), tip = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 80, y = Math.random() * 30, z = (Math.random() - 0.5) * 80; P.set([x, y, z, x, y, z], i * 6); tip[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
  const u = { time: { value: 0 }, cam: { value: new THREE.Vector3() } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false,
    vertexShader: 'attribute float tip; uniform float time; uniform vec3 cam; void main(){ vec3 p = position; float y = mod(p.y - time * 19.0, 30.0) - 9.0 - tip * 0.9;'
      + ' vec3 w = vec3(cam.x + mod(p.x - cam.x + 40.0, 80.0) - 40.0 + tip * 0.1, cam.y + y, cam.z + mod(p.z - cam.z + 40.0, 80.0) - 40.0); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }',
    fragmentShader: 'void main(){ gl_FragColor = vec4(0.72, 0.77, 0.84, 0.32); }' });
  const mesh = new THREE.LineSegments(g, mat); mesh.frustumCulled = false; mesh.visible = false; return { mesh, u };
})();
const SKY_U = { sunDir: { value: SUN_DIR }, time: { value: 0 }, horizon: { value: SKY.horizon }, zenith: { value: new THREE.Color(0.07, 0.2, 0.55) }, cover: { value: 0 }, cloudLit: { value: 1 }, sunGlow: { value: 1 } };
function skyMaterial() {
  // single-scattering style gradient, Mie glow around the sun and fbm cumulus projected on a cloud plane
  return new THREE.ShaderMaterial({
    uniforms: SKY_U,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 sunDir, horizon, zenith; uniform float time, cover, cloudLit, sunGlow; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0), mu = max(dot(d, sunDir), 0.0);
        vec3 zen = zenith;
        vec3 c = mix(horizon, zen, pow(h, 0.42));
        c += vec3(1.0, 0.82, 0.58) * (pow(mu, 6.0) * 0.18 + pow(mu, 48.0) * 0.55) * sunGlow;
        c += vec3(1.0, 0.95, 0.85) * smoothstep(0.99935, 0.99968, mu) * 22.0 * sunGlow;
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.1) * 1.4 + vec2(time * 0.0035, time * 0.0012);
          float n = fbm(uv), cov = mix(smoothstep(0.5, 0.74, n), 0.75 + 0.25 * smoothstep(0.2, 0.6, n), cover);
          float lit = fbm(uv + sunDir.xz * 0.06);
          vec3 cc = mix(vec3(1.0, 0.99, 0.97), vec3(0.55, 0.6, 0.68), clamp((n - lit) * 4.0 + 0.35, 0.0, 1.0));
          cc += vec3(1.0, 0.88, 0.7) * pow(mu, 10.0) * 0.45 * sunGlow; cc *= cloudLit;
          c = mix(c, cc, cov * smoothstep(0.0, 0.2, d.y) * 0.95);
        }
        c = mix(c, horizon * 0.82, smoothstep(0.02, -0.06, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMaterial()); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
const ENV_SCENE = new THREE.Scene(); ENV_SCENE.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
function envRefresh() { // image-based light for paint, carbon and wet asphalt reflections, from the current sky
  const pm = new THREE.PMREMGenerator(renderer), old = scene.environment; scene.environment = pm.fromScene(ENV_SCENE, 0.02).texture; pm.dispose(); if (old) old.dispose();
}
envRefresh();
const hemi = new THREE.HemisphereLight(lin(0xbcd6f5), lin(0x5f5b4c), 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight(lin(0xfff1dc), 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 600 });
sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);
// time of day and weather: sun, sky, fog, exposure, street-lamp pools, headlight, rain, wet asphalt and grip
const ATMO = { tod: 'day', rain: false, grip: 1 };
const ATMO_P = {
  day: { dir: [-0.45, 0.62, 0.38], sun: 0xfff1dc, si: 2.6, hs: 0xbcd6f5, hg: 0x5f5b4c, hi: 0.62, hor: [0.6, 0.71, 0.83], zen: [0.07, 0.2, 0.55], fog: 0.00017, exp: 0.95, cl: 1, glow: 1, bloom: 0.2, lum: 1, night: 0 },
  dusk: { dir: [-0.8, 0.11, 0.45], sun: 0xffa463, si: 1.8, hs: 0x8f94b8, hg: 0x45362a, hi: 0.45, hor: [0.98, 0.6, 0.4], zen: [0.12, 0.15, 0.36], fog: 0.00022, exp: 1.0, cl: 0.8, glow: 1, bloom: 0.32, lum: 0.75, night: 0.4 },
  night: { dir: [0.3, 0.72, -0.25], sun: 0x9fb4e6, si: 0.3, hs: 0x2c3c5c, hg: 0x14120f, hi: 0.32, hor: [0.05, 0.07, 0.12], zen: [0.008, 0.012, 0.035], fog: 0.0002, exp: 1.15, cl: 0.1, glow: 0.12, bloom: 0.75, lum: 0.12, night: 1 },
};
const headlight = new THREE.SpotLight(0xfff4e0, 0, 90, 0.45, 0.6, 1.2); headlight.position.set(1.6, 0.7, 0); headlight.target.position.set(40, -2, 0);
const SKY_R = 8500, SKYLINE_U = { lum: { value: 1 } }; // far skyline impostors (skylineImpostors)
function applyAtmo() {
  const P = ATMO_P[ATMO.tod] || ATMO_P.day, r = ATMO.rain, grey = new THREE.Color(0.5, 0.53, 0.56).multiplyScalar(P.lum);
  SUN_DIR.set(...P.dir).normalize(); sun.color.copy(lin(P.sun)); sun.intensity = P.si * (r ? 0.3 : 1);
  hemi.color.copy(lin(P.hs)); hemi.groundColor.copy(lin(P.hg)); hemi.intensity = P.hi * (r ? 1.15 : 1);
  SKY.horizon.setRGB(...P.hor); SKY_U.zenith.value.setRGB(...P.zen);
  if (r) { SKY.horizon.lerp(grey, 0.75); SKY_U.zenith.value.lerp(grey.multiplyScalar(0.75), 0.8); }
  SKY_U.cover.value = r ? 1 : 0; SKY_U.cloudLit.value = P.cl * (r ? 0.75 : 1); SKY_U.sunGlow.value = r ? 0 : P.glow;
  scene.fog.color.copy(SKY.horizon).multiplyScalar(0.95); scene.fog.density = P.fog * (r ? 5 : 1);
  renderer.toneMappingExposure = P.exp; if (POST.bloom) POST.bloom.strength = P.bloom; SKYLINE_U.lum.value = P.lum;
  headlight.intensity = P.night > 0.3 || r ? 2.2 + 2 * P.night : 0;
  if (W.lampPools) W.lampPools.visible = P.night > 0.3; if (W.lampPools) W.lampPools.material.opacity = 0.55 * P.night;
  if (W.asphalt) { W.asphalt.roughness = r ? 0.42 : 0.8; W.asphalt.envMapIntensity = r ? 0.75 : 0.5; W.asphalt.color.setScalar(r ? 0.5 : 1); W.asphalt.normalScale.setScalar(r ? 0.22 : 0.55); } // wet: darker, smoother, softer grain
  if (W.lineMesh) W.lineMesh.material.opacity = 0.72 * (1 - 0.5 * P.night); // the unlit guide would glare at night
  RAIN.mesh.visible = r;
  const grip = r ? 0.72 : 1; if (grip !== ATMO.grip) { ATMO.grip = grip; if (W.n) { buildProfile(); analyzeCorners(); } }
  envRefresh();
}
// post-processing (high quality): multisampled render → subtle bloom → grade (vignette, saturation, grain, sRGB out)
let qLevel = null, qTier = -1; // graphics quality level and auto tier (-1: a fixed level), set by applyQuality
const POST = { comp: null, on: false, grade: null, bloom: null };
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.1);
      c = c * vec3(1.02, 1.0, 0.97);
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.6;
      float g = fract(sin(dot(vUv * res + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; c += g * 0.018 * (1.0 - l);
      gl_FragColor = LinearTosRGB(vec4(max(c, 0.0), 1.0)); }`,
};
function setupPost() {
  if (POST.comp || !THREE.EffectComposer || !THREE.UnrealBloomPass || !renderer.capabilities.isWebGL2) return !!POST.comp;
  try {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rtt = new THREE.WebGLMultisampleRenderTarget(sz.x, sz.y, { format: THREE.RGBAFormat }); rtt.samples = 4;
    const comp = new THREE.EffectComposer(renderer, rtt);
    comp.addPass(new THREE.RenderPass(scene, camera));
    POST.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(sz.x, sz.y), 0.2, 0.45, 0.86); comp.addPass(POST.bloom);
    POST.grade = new THREE.ShaderPass(GradeShader); comp.addPass(POST.grade);
    POST.comp = comp; return true;
  } catch (e) { POST.comp = null; return false; }
}
function resize() {
  const w = innerWidth, h = innerHeight; if (qLevel) renderer.setPixelRatio(pixelRatioNow()); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (POST.comp) { POST.comp.setPixelRatio(renderer.getPixelRatio()); POST.comp.setSize(w, h); POST.grade.uniforms.res.value.set(w, h); }
}
addEventListener('resize', resize); resize();

/* ================= World build ================= */
const W = { H: null, dist: null, group: null, n: 0, sx: 2400, sz: 2400, nx: N, nz: N, base: 0, wall: Infinity };
function gridSample(arr, x, z) {
  const fx = clamp((x + W.sx / 2) / W.sx * (W.nx - 1), 0, W.nx - 1.0001), fz = clamp((z + W.sz / 2) / W.sz * (W.nz - 1), 0, W.nz - 1.0001);
  const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, o = j * W.nx + i;
  const p = arr[o], q = arr[o + 1], c = arr[o + W.nx], d = arr[o + W.nx + 1];
  return p + (q - p) * a + (c - p) * b + (p - q - c + d) * a * b;
}
// the ground as drawn: the ground mesh splits every cell (i, j) along the diagonal (i+1, j)–(i, j+1) (its index buffer in
// buildMeshes), so heights come from the triangle under (x, z), not a bilinear blend of the four corners (on the steep
// generated terrain the two differed by up to 0.115 m and the drawn ground poked through the asphalt; tools/test/js/height_mesh.js)
function gridTri(arr, x, z) {
  const fx = clamp((x + W.sx / 2) / W.sx * (W.nx - 1), 0, W.nx - 1.0001), fz = clamp((z + W.sz / 2) / W.sz * (W.nz - 1), 0, W.nz - 1.0001);
  const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, o = j * W.nx + i;
  const p = arr[o], q = arr[o + 1], c = arr[o + W.nx], d = arr[o + W.nx + 1];
  return a + b <= 1 ? p + (q - p) * a + (c - p) * b   // triangle (i, j), (i+1, j), (i, j+1)
    : d + (d - c) * (a - 1) + (d - q) * (b - 1);        // triangle (i+1, j), (i, j+1), (i+1, j+1)
}
const Hq = (x, z) => gridTri(W.H, x, z);
// the slope of the drawn triangles over the car's footprint (±1.5 m). Not the plane of the single triangle under the
// car: that normal jumps at every crease (up to 8° per frame on 丘陵, measured), which the car's attitude and grade force follow
function normalAt(x, z, out) { const e = 1.5; out.set(-(Hq(x + e, z) - Hq(x - e, z)) / (2 * e), 1, -(Hq(x, z + e) - Hq(x, z - e)) / (2 * e)).normalize(); return out; }
function smoothCirc(a, rad, passes) {
  const n = a.length, tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    let s = 0; for (let o = -rad; o <= rad; o++) s += a[((o % n) + n) % n];
    for (let k = 0; k < n; k++) { tmp[k] = s / (2 * rad + 1); s += a[(k + rad + 1) % n] - a[((k - rad) % n + n) % n]; }
    a.set(tmp);
  }
}
function activeMap() {
  if (setup.map === 'terrain') { applyTerrainScale(); return { kind: 'terrain', sx: TER.size, sz: TER.size, nx: N, nz: N, raw: TER.raw, mask: null, base: TER.base, water: null }; }
  const M = CITY[setup.map]; if (M.id === 'osm') M.base = TER.base; return M;
}
function centreline(M) {
  const V = viewSize(M), pts = setup.reverse ? trackPts.slice().reverse() : trackPts;
  if (M.kind === 'city') return cleanRoute(routeLoop(M, pts), M);
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3((p.u - 0.5) * V, 0, (p.v - 0.5) * V)), true, 'centripetal', 0.5);
  curve.arcLengthDivisions = 4000;
  const n = Math.max(240, Math.round(curve.getLength() / 2)), sp = curve.getSpacedPoints(n); sp.pop();
  return sp.map(p => [p.x, p.z]);
}

// half widths left / right of the centreline: the real carriageway where the map knows it (Taipei), else the width setting
function realWidths(M, hw) {
  const n = W.n, X = W.x, Z = W.z, L = W.hwL = new Float32Array(n).fill(hw), R = W.hwR = new Float32Array(n).fill(hw);
  W.lanes = new Uint8Array(n).fill(0); W.two = new Uint8Array(n); W.rname = new Array(n).fill(''); W.real = !!(W.city && M.roads.length && M.roads[0].w);
  if (W.real) {
    const cs = 25, grid = new Map(), cell = (x, z) => Math.floor(x / cs) + ',' + Math.floor(z / cs);
    W.roadGrid = { cs, grid };
    M.roads.forEach((r, ri) => { if (r.lay > 0) return; for (let i = 0; i + 3 < r.p.length; i += 2) { const k = cell((r.p[i] + r.p[i + 2]) / 2, (r.p[i + 1] + r.p[i + 3]) / 2); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(ri, i); } });
    const wid = new Float32Array(n), ln = new Float32Array(n), two = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let best = Infinity, bw = hw * 2, bl = 0, bt = 0, bn = ''; const tx = -W.lz[k], tz = W.lx[k], cx0 = Math.floor(X[k] / cs), cz0 = Math.floor(Z[k] / cs);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const lst = grid.get((cx0 + a) + ',' + (cz0 + b)); if (!lst) continue;
        for (let e = 0; e < lst.length; e += 2) { const r = M.roads[lst[e]], i = lst[e + 1], x0 = r.p[i], z0 = r.p[i + 1], dx = r.p[i + 2] - x0, dz = r.p[i + 3] - z0, l2 = dx * dx + dz * dz || 1;
          const f = clamp(((X[k] - x0) * dx + (Z[k] - z0) * dz) / l2, 0, 1), d = Math.hypot(X[k] - x0 - dx * f, Z[k] - z0 - dz * f), par = Math.abs(dx * tx + dz * tz) / Math.sqrt(l2);
          const score = d + (1 - par) * 20 + (r.lay > 0 ? 0 : 0.5); if (score < best) { best = score; bw = r.w; bl = r.ln; bt = r.one ? 0 : 1; bn = r.n; } } }
      wid[k] = bw; ln[k] = bl; two[k] = bt; W.rname[k] = bn;
    }
    // junctions and short mismatches would make the width flicker: median over 30 m, then smooth
    const med = new Float32Array(n), h = Math.round(15 / W.ds);
    for (let k = 0; k < n; k++) { const a = []; for (let o = -h; o <= h; o++) a.push(wid[(k + o + n) % n]); a.sort((p, q) => p - q); med[k] = a[a.length >> 1]; }
    smoothCirc(med, Math.round(8 / W.ds), 2);
    for (let k = 0; k < n; k++) { L[k] = R[k] = clamp(med[k] / 2, 3.6, 13); W.lanes[k] = ln[k]; W.two[k] = two[k]; }
    // the barriers sit on these edges and cannot step sideways: where the road narrows (a junction, a lane drop) it narrows over
    // a taper of 1 m per 10 m, starting early, so a car along the barrier is guided in instead of shoved 2 m in one step (P5)
    const slope = 0.1 * W.ds;
    for (const A of [L, R]) for (let pass = 0; pass < 2; pass++) {
      for (let k = 1; k <= 2 * n; k++) { const i = k % n, j = (k - 1) % n; if (A[i] > A[j] + slope) A[i] = A[j] + slope; }
      for (let k = 2 * n - 1; k >= 0; k--) { const i = k % n, j = (k + 1) % n; if (A[i] > A[j] + slope) A[i] = A[j] + slope; }
    }
  }
  W.hwMax = Math.max(...L, ...R);
}
/* ================= Corner notes, location and the preview lap ================= */
const CORNER_WORD = ['髮夾彎', '急彎', '中彎', '緩彎', '微彎', '微彎'];
// corners of the lap: entry/exit sample, direction, turn angle, severity (1 hairpin .. 6 gentle), suggested speed, street turned onto
function analyzeCorners() {
  const n = W.n, ds = W.ds, K = Float32Array.from(W.kappa); smoothCirc(K, Math.round(10 / ds), 2);
  const on = k => Math.abs(K[k]) > 1 / 350, raw = [];
  let k0 = 0; while (k0 < n && on(k0)) k0++;
  if (k0 >= n) { W.corners = []; return; }
  for (let i = 0; i < n;) {
    const k = (k0 + i) % n; if (!on(k)) { i++; continue; }
    const sg = Math.sign(K[k]); let j = i, ang = 0, kmax = 0;
    while (j < n && on((k0 + j) % n) && Math.sign(K[(k0 + j) % n]) === sg) { const kk = (k0 + j) % n; ang += K[kk] * ds; kmax = Math.max(kmax, Math.abs(K[kk])); j++; }
    raw.push({ i0: i, i1: j, ang, kmax }); i = j;
  }
  const merged = []; // pieces of one corner split by a short straight
  for (const c of raw) { const p = merged[merged.length - 1]; if (p && Math.sign(p.ang) === Math.sign(c.ang) && (c.i0 - p.i1) * ds < 15) { p.i1 = c.i1; p.ang += c.ang; p.kmax = Math.max(p.kmax, c.kmax); } else merged.push({ ...c }); }
  W.corners = merged.filter(c => Math.abs(c.ang) > 0.3).map(c => {
    const entry = (k0 + c.i0) % n, exit = (k0 + c.i1) % n;
    const left = (-W.lz[exit]) * W.lx[entry] + W.lx[exit] * W.lz[entry] > 0; // exit direction against the entry's left
    const R = 1 / c.kmax, grade = R < 25 ? 1 : R < 45 ? 2 : R < 75 ? 3 : R < 120 ? 4 : R < 200 ? 5 : 6;
    let v = Infinity; for (let i = c.i0; i <= c.i1; i++) v = Math.min(v, RACE.prof[(k0 + i) % n]);
    const onto = W.real ? W.rname[(exit + Math.round(30 / ds)) % n] : '';
    return { entry, exit, left, deg: Math.round(Math.abs(c.ang) * 180 / Math.PI / 5) * 5, grade, vRec: v * 3.6 * (setup.level === 'easy' ? 0.94 : 1), onto };
  });
  // landmarks for the location card: one point per named landmark
  const lm = new Map(); if (W.M.env) for (const l of W.M.env.landmarks) { if (!l.n) continue; const e = lm.get(l.n) || { n: l.n, x: 0, z: 0, c: 0 }; for (let i = 0; i < l.p.length; i += 2) { e.x += l.p[i]; e.z += l.p[i + 1]; e.c++; } lm.set(l.n, e); }
  W.lmPts = [...lm.values()].map(e => ({ n: e.n, x: e.x / e.c, z: e.z / e.c }));
  NOTE.road = ''; NOTE.pending = ''; NOTE.run = 0;
}
const NOTE = { road: '', pending: '', run: 0, cardT: 0 };
function arrowPath(left, deg) { // a stem that bends through the turn angle, with a head
  const s = left ? -1 : 1, a = Math.min(180, Math.max(25, deg)) * Math.PI / 180, r = 20, pts = [[0, 38], [0, 6]];
  for (let i = 1; i <= 8; i++) { const t = a * i / 8; pts.push([s * (r - r * Math.cos(t)), 6 - r * Math.sin(t)]); }
  const [ex, ey] = pts[pts.length - 1], dx = s * Math.sin(a), dy = -Math.cos(a), hx = -dy, hy = dx;
  return 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L') + ` M${(ex - dx * 12 + hx * 9).toFixed(1)} ${(ey - dy * 12 + hy * 9).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${(ex - dx * 12 - hx * 9).toFixed(1)} ${(ey - dy * 12 - hy * 9).toFixed(1)}`;
}
// turn hint and location for the sample k (the car, or the preview camera), speed in m/s
function drivingNotes(k, spd, dt) {
  const n = W.n, th = $('#turnHint'), active = state.mode === 'race' || state.mode === 'lights' || state.mode === 'preview';
  let show = false;
  if (active && (setup.turnHints !== false || TUT.on) && W.corners && W.corners.length) {
    let best = null, bd = Infinity;
    for (const c of W.corners) { const d = ((c.entry - k + n) % n) * W.ds, inside = ((k - c.entry + n) % n) < ((c.exit - c.entry + n) % n); const dd = inside ? 0 : d; if (dd < bd) { bd = dd; best = c; } }
    const reach = Math.max(140, spd * 5);
    if (best && bd < reach) {
      show = true;
      $('#thArrow').setAttribute('d', arrowPath(best.left, best.deg));
      $('#thText').textContent = (best.left ? '左' : '右') + (best.deg >= 70 && best.grade <= 3 ? '轉' : '彎') + ' ' + CORNER_WORD[best.grade - 1] + ' ' + best.deg + '°';
      $('#thDist').textContent = bd > 0 ? Math.round(bd / 10) * 10 + ' m' : '彎中';
      $('#thInfo').textContent = '建議 ' + Math.round(best.vRec / 5) * 5 + ' km/h' + (best.onto && best.onto !== W.rname[k] ? '・進入 ' + best.onto : '');
      th.classList.toggle('fast', state.mode !== 'preview' && spd * 3.6 > best.vRec + 15 && bd < 150);
    }
  }
  th.hidden = !show;
  // current road, and a card when the circuit turns onto another major road
  const pill = $('#locPill');
  if (!W.real || !active) { pill.hidden = true; return; }
  const road = W.rname[k] || ''; pill.hidden = !road; pill.textContent = '目前位置　' + road;
  if (road && road !== NOTE.road) {
    if (road === NOTE.pending) NOTE.run += spd * dt; else { NOTE.pending = road; NOTE.run = 0; }
    if (NOTE.run > 25) {
      const first = !NOTE.road; NOTE.road = road;
      if (!first || state.mode === 'preview') {
        let near = '', nd = 350; for (const p of W.lmPts) { const d = Math.hypot(p.x - W.x[k], p.z - W.z[k]); if (d < nd) { nd = d; near = p.n; } }
        $('#lcRoad').textContent = road; $('#lcNear').textContent = near ? '附近：' + near : ''; $('#locCard').classList.add('show'); NOTE.cardT = 2.6;
      }
    }
  }
  if (NOTE.cardT > 0 && (NOTE.cardT -= dt) <= 0) $('#locCard').classList.remove('show');
}
// preview lap: a first-person run along the centreline, compressed to about half a minute, skippable
const PV = { s: 0, f: 1, k: 0, dir: new THREE.Vector3(), pos: new THREE.Vector3() };
function startPreview() {
  let T = 0; for (let k = 0; k < W.n; k++) T += W.ds / Math.max(8, RACE.prof[k]);
  PV.f = Math.max(1, T / 32); PV.s = 0; PV.k = 0; camInit = false;
  $('#pvInfo').textContent = (W.len / 1000).toFixed(2) + ' km・' + W.corners.length + ' 個彎・預估單圈 ' + fmt(T) + (ATMO.rain ? '・雨天濕滑，抓地力約剩七成' : '') + (state.best < Infinity ? '・你的最快圈 ' + fmt(state.best) : '');
  $('#preview').hidden = false; $('#lights').hidden = true; document.body.classList.add('previewing'); state.mode = 'preview';
  bannerT = 0; $('#banner').classList.remove('show'); // the hold-sideways hint waits for the end of the preview, it would cover the road cards
}
function endPreview() {
  if (state.mode !== 'preview') return;
  $('#preview').hidden = true; $('#turnHint').hidden = true; document.body.classList.remove('previewing'); camInit = false; NOTE.road = ''; NOTE.pending = '';
  state.mode = 'lights'; state.lightsT = 0; state.lightsOut = 4.2 + Math.random() * 1.2; $('#lights').hidden = false;
  if (COARSE && innerHeight > innerWidth) banner('橫向握持手機，視野更寬', 'info');
}
function previewStep(dt) {
  const n = W.n, k = Math.floor(PV.s / W.ds) % n, f = (PV.s / W.ds) % 1, k2 = (k + 1) % n;
  PV.k = k; PV.s += Math.max(8, RACE.prof[k]) * PV.f * dt;
  $('#pvBar').style.width = Math.min(100, PV.s / W.len * 100) + '%';
  if (PV.s >= W.len) { endPreview(); return; }
  const e = RACE.line ? RACE.line[k] + (RACE.line[k2] - RACE.line[k]) * f : 0, ka = (k + Math.round(28 / W.ds)) % n, ea = RACE.line ? RACE.line[ka] : 0;
  const x = W.x[k] + (W.x[k2] - W.x[k]) * f + W.lx[k] * e, z = W.z[k] + (W.z[k2] - W.z[k]) * f + W.lz[k] * e;
  PV.pos.set(x, Sq(x, z, k) + 1.5, z);
  // smooth the viewing direction, not the target point: at preview speed a lagging target ends up behind the camera
  const ax = W.x[ka] + W.lx[ka] * ea, az = W.z[ka] + W.lz[ka] * ea, want = new THREE.Vector3(ax, Sq(ax, az, ka) + 1.0, az).sub(PV.pos).normalize();
  if (!camInit) PV.dir.copy(want); else PV.dir.lerp(want, 1 - Math.exp(-dt * 5)).normalize(); camInit = true;
  camera.position.copy(PV.pos); camera.up.copy(UP); camera.lookAt(PV.pos.x + PV.dir.x * 30, PV.pos.y + PV.dir.y * 30, PV.pos.z + PV.dir.z * 30);
  if (Math.abs(camera.fov - 68) > 0.05) { camera.fov = 68; camera.updateProjectionMatrix(); }
  drivingNotes(k, Math.max(8, RACE.prof[k]) * PV.f, dt);
}
$('#pvSkip').onclick = () => endPreview();
for (const id of ['#tod', '#weather']) $(id).addEventListener('change', () => { ATMO.tod = $('#tod').value; ATMO.rain = $('#weather').value === 'rain'; applyAtmo(); savePrefs(); });
$('#lineGuide').addEventListener('change', () => { setup.lineGuide = $('#lineGuide').checked; if (W.lineMesh) W.lineMesh.visible = setup.lineGuide; savePrefs(); });
$('#elevated').addEventListener('change', () => { setup.elevated = $('#elevated').checked; mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); });
// deck height above the ground for each sample on an elevated road (0 elsewhere); W.deck is the surface height there
function trackElevation(M) {
  const n = W.n, E = W.elev = new Float32Array(n), D = W.deck = new Float32Array(n), br = W.real && M.env && setup.elevated ? M.env.bridges : null;
  if (br && br.length) {
    for (let k = 0; k < n; k++) {
      const tx = -W.lz[k], tz = W.lx[k]; let best = 3.5, h = 0, hit = null, abs = 0;
      for (const b of br) { const p = b.p;
        for (let i = 0; i + 3 < p.length; i += 2) { const x0 = p[i], z0 = p[i + 1], dx = p[i + 2] - x0, dz = p[i + 3] - z0, l2 = dx * dx + dz * dz || 1;
          if (Math.abs(dx * tx + dz * tz) / Math.sqrt(l2) < 0.85) continue;
          const f = clamp(((W.x[k] - x0) * dx + (W.z[k] - z0) * dz) / l2, 0, 1), d = Math.hypot(W.x[k] - x0 - dx * f, W.z[k] - z0 - dz * f);
          if (d < best) { best = d; const za = gridSample(M.raw, x0, z0) + b.hv[i / 2], zb = gridSample(M.raw, p[i + 2], p[i + 3]) + b.hv[i / 2 + 1]; h = b.hv[i / 2] + (b.hv[i / 2 + 1] - b.hv[i / 2]) * f; abs = za + (zb - za) * f; hit = b; } } }
      E[k] = h; D[k] = abs;
      if (hit && h > 0.3) { W.rname[k] = hit.name || '高架道路'; W.hwL[k] = W.hwR[k] = clamp(hit.w / 2, 3.6, 13); } // the viaduct's own name and width, not the street below
    }
  }
  for (let k = 0; k < n; k++) { if (E[k] < 0.3) E[k] = 0; if (!E[k]) D[k] = gridSample(M.raw, W.x[k], W.z[k]); }
  if (E.some(v => v > 0)) { // only where the matched bridge changes can the deck jump: cap the grade at 12 % there
    const lim = 0.12 * W.ds;
    for (let pass = 0; pass < 2; pass++) { for (let i = 0; i < 2 * n; i++) { const k = i % n, p = (k - 1 + n) % n; if (E[k]) D[k] = Math.min(D[k], D[p] + lim); } for (let i = 2 * n - 1; i >= 0; i--) { const k = i % n, q = (k + 1) % n; if (E[k]) D[k] = Math.min(D[k], D[q] + lim); } }
  }
  W.anyElev = E.some(v => v > 0); W.hwMax = Math.max(...W.hwL, ...W.hwR);
}
// another part of the lap (not the samples around k) within r of (x, z) and within 3 m of k's height
function otherStretchNear(k, x, z, r) {
  const n = W.n, skip = Math.round(40 / W.ds), y = W.elev[k] > 0 ? W.deck[k] : W.h[k];
  for (let j = 0; j < n; j++) { const dk = Math.min(Math.abs(j - k), n - Math.abs(j - k)); if (dk < skip) continue;
    if ((W.x[j] - x) ** 2 + (W.z[j] - z) ** 2 < r * r && Math.abs((W.elev[j] > 0 ? W.deck[j] : W.h[j]) - y) < 3) return true; }
  return false;
}
// surface height for the track at sample k: the deck where the lap is elevated, the ground elsewhere
const onDeck = k => W.anyElev && k >= 0 && W.elev[k % W.n] > 0;
const Sq = (x, z, k) => onDeck(k) ? W.deck[k % W.n] : Hq(x, z);
function normalS(x, z, k, out) {
  if (!onDeck(k)) return normalAt(x, z, out);
  const n = W.n, a = (k - 2 + n) % n, b = (k + 2) % n, g = (W.deck[b] - W.deck[a]) / (4 * W.ds); // the deck is flat across, sloped along
  return out.set(g * W.lz[k], 1, -g * W.lx[k]).normalize();
}
function buildWorld() {
  const M = activeMap();
  Object.assign(W, { M, sx: M.sx, sz: M.sz, nx: M.nx, nz: M.nz, base: M.base, city: M.kind === 'city' });
  const raw = M.raw, hw = setup.width / 2, NX = W.nx, NZ = W.nz, cx = W.sx / (NX - 1), cz = W.sz / (NZ - 1);
  W.wall = setup.walls && W.city ? hw + 3.2 : Infinity; // refined once the real widths are known
  // --- centreline
  const cl = centreline(M), n = cl.length;
  let len = 0; for (let k = 0; k < n; k++) { const a = cl[k], b = cl[(k + 1) % n]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  W.n = n; W.len = len; W.ds = len / n;
  const X = W.x = Float32Array.from(cl, p => p[0]), Z = W.z = Float32Array.from(cl, p => p[1]);
  const TH = W.h = new Float32Array(n), BK = W.bank = new Float32Array(n), LX = W.lx = new Float32Array(n), LZ = W.lz = new Float32Array(n), KA = W.kappa = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = (k - 1 + n) % n, b = (k + 1) % n; let tx = X[b] - X[a], tz = Z[b] - Z[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    LX[k] = tz; LZ[k] = -tx; // left of travel direction
  }
  realWidths(M, hw); trackElevation(M);
  const rawQ = (x, z) => gridSample(raw, x, z);
  for (let k = 0; k < n; k++) {
    TH[k] = rawQ(X[k], Z[k]);
    BK[k] = setup.banking && !W.city ? (rawQ(X[k] + LX[k] * 12, Z[k] + LZ[k] * 12) - rawQ(X[k] - LX[k] * 12, Z[k] - LZ[k] * 12)) / 24 : 0;
  }
  smoothCirc(TH, Math.round(22 / W.ds), 4);
  smoothCirc(BK, Math.round(30 / W.ds), 3);
  for (let k = 0; k < n; k++) BK[k] = clamp(BK[k], -0.09, 0.09);
  const st = 3;
  for (let k = 0; k < n; k++) {
    const a = (k - st + n) % n, b = (k + st) % n, ax = -LZ[a], az = LX[a], bx = -LZ[b], bz = LX[b];
    KA[k] = -Math.atan2(ax * bz - az * bx, ax * bx + az * bz) / (2 * st * W.ds);
  }
  smoothCirc(KA, 3, 2);
  W.kerb = new Uint8Array(n); W.drs = new Uint8Array(n);
  for (let k = 0; k < n; k++) W.kerb[k] = Math.abs(KA[k]) > 1 / 260 ? 1 : 0;
  { const kk = W.kerb.slice(); for (let k = 0; k < n; k++) if (kk[k]) for (let o = -6; o <= 6; o++) W.kerb[(k + o + n) % n] = 1; }
  { // straights longer than 380 m become DRS zones (opened 60 m after the straight begins)
    let start = -1; const straight = k => Math.abs(KA[k % n]) < 1 / 700;
    let k0 = 0; while (k0 < n && straight(k0)) k0++;
    for (let i = 0; i <= n; i++) {
      const k = (k0 + i) % n, s = straight(k) && i < n;
      if (s && start < 0) start = i;
      if (!s && start >= 0) { if ((i - start) * W.ds > 380) for (let j = start + Math.round(60 / W.ds); j < i; j++) W.drs[(k0 + j) % n] = 1; start = -1; }
    }
  }
  // --- carve the road into the ground
  const H = W.H = new Float32Array(raw), D = W.dist = new Float32Array(NX * NZ).fill(1e9);
  const tgt = new Float32Array(NX * NZ), HW = new Float32Array(NX * NZ), R = W.hwMax + (W.city ? 28 : 48), R2 = R * R, rci = Math.ceil(R / cx), rcj = Math.ceil(R / cz);
  for (let k = 0; k < n; k++) {
    const gi = Math.round((X[k] + W.sx / 2) / cx), gj = Math.round((Z[k] + W.sz / 2) / cz);
    // grid nodes take the height of their nearest sample k; carry it on along the track at k's grade (the nearest sample is
    // up to half a sample spacing ahead or behind: without this the carved road steps by grade × ds, which twists the cells)
    const tx = -LZ[k], tz = LX[k], gr = (TH[(k + 1) % n] - TH[(k - 1 + n) % n]) / (2 * W.ds);
    for (let j = Math.max(0, gj - rcj); j <= Math.min(NZ - 1, gj + rcj); j++) {
      const dz = -W.sz / 2 + j * cz - Z[k];
      for (let i = Math.max(0, gi - rci); i <= Math.min(NX - 1, gi + rci); i++) {
        const dx = -W.sx / 2 + i * cx - X[k], d2 = dx * dx + dz * dz, o = j * NX + i;
        if (d2 < R2 && d2 < D[o]) { D[o] = d2; HW[o] = Math.max(W.hwL[k], W.hwR[k]); tgt[o] = W.elev[k] > 0 ? NaN : TH[k] + gr * (dx * tx + dz * tz) + BK[k] * clamp(dx * LX[k] + dz * LZ[k], -HW[o] - 5, HW[o] + 5); }
      }
    }
  }
  for (let i = 0; i < NX * NZ; i++) {
    if (D[i] < 1e8) { const d = Math.sqrt(D[i]); D[i] = d; if (tgt[i] === tgt[i]) H[i] = tgt[i] + (raw[i] - tgt[i]) * smooth(HW[i] + 5, R, d); }
    else D[i] = 1e4;
  }
  W.hwGrid = HW;
  for (let k = 0; k < n; k++) TH[k] = W.elev[k] > 0 ? W.deck[k] : Hq(X[k], Z[k]);
  // gravel traps on the outside of tighter corners (and the run-off past the exit); barriers per side
  if (W.wall !== Infinity && W.real) W.wall = W.hwMax + 0.5;
  W.grav = new Int8Array(n);
  if (!W.city) {
    const Ks = Float32Array.from(KA); smoothCirc(Ks, 6, 2);
    const g0 = new Int8Array(n); for (let k = 0; k < n; k++) if (Math.abs(Ks[k]) > 1 / 170) g0[k] = Ks[k] > 0 ? -1 : 1;
    for (let k = 0; k < n; k++) if (g0[k]) for (let o = -4; o <= Math.round(70 / W.ds); o++) { const j = (k + o + n) % n; if (!W.grav[j]) W.grav[j] = g0[k]; }
  }
  W.wallL = new Float32Array(n).fill(Infinity); W.wallR = new Float32Array(n).fill(Infinity);
  if (setup.walls) for (let k = 0; k < n; k++) for (const side of [1, -1]) {
    const hs = side > 0 ? W.hwL[k] : W.hwR[k];
    let off = W.real ? (W.elev && W.elev[k] > 0 ? hs - 0.2 : hs + 0.5) : W.city ? hs + 3.2 : W.grav[k] === side ? hs + 17 : hs + 13; // Taipei: water barriers on the kerb line, on a viaduct just inside the parapet
    const wx = X[k] + LX[k] * off * side, wz = Z[k] + LZ[k] * off * side;
    if (gridSample(D, wx, wz) < off - 3 && (!W.anyElev || otherStretchNear(k, wx, wz, off - 3))) off = Infinity; // another stretch of track is nearer: leave a gap
    (side > 0 ? W.wallL : W.wallR)[k] = off;
  }
  for (const arr of [W.wallL, W.wallR]) { // drop barrier fragments shorter than 30 m
    let k = 0; while (k < n) { if (!isFinite(arr[k])) { k++; continue; } let e = k; while (e < n && isFinite(arr[e])) e++; if ((e - k) * W.ds < 30 && !(k === 0 || e === n)) for (let j = k; j < e; j++) arr[j] = Infinity; k = e; }
  }
  W.apronL = W.apronR = null;
  if (setup.wideCorners && setup.walls) widenCorners();
  W.tid = trackId();
  buildProfile();
  analyzeCorners();
  buildMeshes();
  applyAtmo(); // wet asphalt, lamp pools and fog for the new world
  drawMinimapBase();
  $('#trkLen').textContent = (len / 1000).toFixed(3) + ' km';
  $('#hudCredit').textContent = W.city ? '© OpenStreetMap contributors' + (M.id === 'taipei' ? ' · 內政部 DEM · 臺北市 3D 建物' + (W.activeTiles && W.activeTiles.length ? ' · 建物貼圖 AI 生成（Colab SDXL）' : '') + (/公園路燈/.test(M.credits || '') ? ' · 行道樹：臺北市公園處' : '') + (TREE_ATLAS ? ' · 樹木模型 AI 生成（SDXL＋TRELLIS.2）' : '') : '') : '';
}

// 「初階：較寬的轉彎區域」 (setup.wideCorners): at every sharp corner (radius under 45 m) the barrier on the outside moves out
// by up to 4 m in the city (6 m elsewhere) from 10 m before the corner to 30 m past it, as far as there is room (no building
// in the occupancy raster, no other stretch of the track, 2 m kept clear behind the barrier), tapering in and out at 1:4.
// The gained strip is asphalt (W.apronL / apronR: its width per sample). The track id gets "_wide", so its lap times are kept apart.
function widenCorners() {
  const n = W.n, ds = W.ds, occ = W.M.occ, K = Float32Array.from(W.kappa); smoothCirc(K, 2, 2);
  const L = new Float32Array(n), R = new Float32Array(n), EXTRA = W.city ? 4 : 6, before = Math.round(10 / ds), after = Math.round(30 / ds);
  for (let k = 0; k < n; k++) if (Math.abs(K[k]) > 1 / 45) { const A = K[k] > 0 ? R : L; for (let o = -before; o <= after; o++) A[(k + o + n) % n] = EXTRA; } // outside of a left bend: the right side
  const blocked = (x, z) => { if (Math.abs(x) > W.sx / 2 - 10 || Math.abs(z) > W.sz / 2 - 10) return true; if (!occ) return false;
    const i = Math.floor((x + W.sx / 2) / occ.cs), j = Math.floor((z + W.sz / 2) / occ.cs); return i < 0 || j < 0 || i >= occ.rw || j >= occ.rh || !!occ.a[j * occ.rw + i]; };
  const sl = 0.25 * ds;
  for (const [A, sd, wall] of [[L, 1, W.wallL], [R, -1, W.wallR]]) {
    for (let k = 0; k < n; k++) {
      if (!A[k] || !(wall[k] < Infinity) || (W.elev && W.elev[k] > 0)) { A[k] = 0; continue; }
      let e = 0;
      for (let l = wall[k] + 0.5; l <= wall[k] + A[k] + 2.0; l += 0.5) { const x = W.x[k] + W.lx[k] * l * sd, z = W.z[k] + W.lz[k] * l * sd; if (blocked(x, z) || gridSample(W.dist, x, z) < l - 3) break; e = l - wall[k] - 2.0; }
      A[k] = Math.max(0, Math.min(A[k], e));
    }
    for (let p = 0; p < 2; p++) {
      for (let k = 1; k <= 2 * n; k++) { const i = k % n, j = (k - 1) % n; if (A[i] > A[j] + sl) A[i] = A[j] + sl; }
      for (let k = 2 * n - 1; k >= 0; k--) { const i = k % n, j = (k + 1) % n; if (A[i] > A[j] + sl) A[i] = A[j] + sl; }
    }
    for (let k = 0; k < n; k++) if (A[k] > 0.05) wall[k] += A[k]; else A[k] = 0;
  }
  W.apronL = L; W.apronR = R;
}
// ground shader: blends grass / dirt / rock / special by per-vertex weights, sampled in world metres with a low-frequency macro layer to hide tiling
function splatMaterial(special, lambert) {
  const mat = lambert ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.25 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tG: { value: TEX.grass }, tD: { value: TEX.dirt }, tR: { value: TEX.rock }, tS: { value: special }, tM: { value: TEX.macro } });
    sh.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSplat = splat; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tG, tD, tR, tS, tM;\nvarying vec4 vSplat;\nvarying vec3 vWP;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 p1 = vWP.xz / 4.5;
      float mac = texture2D(tM, vWP.xz / 210.0).r, mac2 = texture2D(tM, vWP.xz / 37.0 + 0.31).r;
      vec4 w = vSplat; w.z *= smoothstep(0.2, 0.8, mac2 + w.z * 0.5); w.y *= 0.6 + mac2 * 0.8;
      w /= max(w.x + w.y + w.z + w.w, 1e-3);
      vec3 tcol = sRGBToLinear(texture2D(tG, p1)).rgb * w.x + sRGBToLinear(texture2D(tD, p1 * 0.7)).rgb * w.y
                + sRGBToLinear(texture2D(tR, p1 * 0.45)).rgb * w.z + sRGBToLinear(texture2D(tS, p1 * 0.6)).rgb * w.w;
      diffuseColor.rgb *= tcol * (0.74 + 0.5 * mac);`);
  };
  return mat;
}
// grandstand opposite the pits, just past the start line, in a frame aligned with the track there
function standFrame() {
  const n = W.n, hw = setup.width / 2, k = Math.round(25 / W.ds) % n, wl = W.wallL[k], wr = W.wallR[k];
  const off = (isFinite(wl) ? wl : hw + 12) + 3, pitOff = (isFinite(wr) ? wr : hw + 12) + 4;
  const fx = -W.lz[k], fz = W.lx[k], lx = W.lx[k], lz = W.lz[k], cx = W.x[k], cz = W.z[k];
  return { k, off, pitOff, cx, cz, fx, fz, lx, lz,
    inside(x, z) { const u = (x - cx) * fx + (z - cz) * fz, w = (x - cx) * lx + (z - cz) * lz; return Math.abs(u) < 40 && ((w > off - 2 && w < off + 16) || (!W.city && w < -pitOff + 2 && w > -pitOff - 18)); } };
}
function buildStands(grp, st) {
  const g = new THREE.Group(), y0 = Hq(st.cx + st.lx * st.off, st.cz + st.lz * st.off);
  g.matrixAutoUpdate = false; g.matrix.makeBasis(new THREE.Vector3(st.fx, 0, st.fz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-st.lx, 0, -st.lz)).setPosition(st.cx, y0, st.cz);
  const conc = new THREE.MeshStandardMaterial({ color: lin(0xb9b6ae), roughness: 0.9 }), white = new THREE.MeshStandardMaterial({ color: lin(0xeef0f2), roughness: 0.5, metalness: 0.2 });
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const o = st.off, L = 70;
  const sg = new THREE.BufferGeometry(); // raked seating with the crowd texture
  sg.setAttribute('position', new THREE.Float32BufferAttribute([-L / 2, 1.0, -o, L / 2, 1.0, -o, -L / 2, 7.2, -o - 10, L / 2, 7.2, -o - 10], 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, L / 8, 0, 0, 1, L / 8, 1], 2)); sg.setIndex([0, 1, 2, 1, 3, 2]); sg.computeVertexNormals();
  TEX.crowd.wrapS = THREE.RepeatWrapping;
  const seats = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: TEX.crowd, roughness: 0.9, side: THREE.DoubleSide })); seats.receiveShadow = true; g.add(seats);
  box(L, 5, 0.4, 0, -1.5, -o, conc); box(L, 12, 0.6, 0, 1.5, -o - 10.4, conc);
  for (const sx of [-1, 1]) box(0.4, 9, 11, sx * L / 2, 2.5, -o - 5, conc);
  const roof = box(L + 4, 0.3, 13, 0, 11.2, -o - 5, white); roof.rotation.x = -0.05;
  for (let i = 0; i <= 6; i++) box(0.35, 11, 0.35, -L / 2 + i * L / 6, 5.5, -o - 10, white);
  if (!W.city) { // pit building with garages facing the track
    const po = st.pitOff, mats = [conc, conc, white, conc, conc, new THREE.MeshStandardMaterial({ map: TEX.garage, roughness: 0.7 })];
    TEX.garage.repeat.set(5, 1);
    const pb = new THREE.Mesh(new THREE.BoxGeometry(84, 8, 14), mats); pb.position.set(0, 2.5, po + 7); pb.castShadow = pb.receiveShadow = true; g.add(pb);
    box(86, 0.4, 18, 0, 6.7, po + 6, white);
    box(84, 1.1, 0.3, 0, 0.1, po - 3, conc);
  }
  g.updateMatrixWorld(true); grp.add(g);
}
function crossGeo(tilt = 0.35) { // two crossed quads, origin at the bottom; normals lean up so foliage lights evenly
  const g = new THREE.BufferGeometry(), P = [], N = [], U = [], I = [];
  for (const a of [0, Math.PI / 2]) {
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, nx = -Math.sin(a), nz = Math.cos(a), b = P.length / 3;
    P.push(-cx, 0, -cz, cx, 0, cz, -cx, 1, -cz, cx, 1, cz); U.push(0, 0, 1, 0, 0, 1, 1, 1);
    for (let i = 0; i < 4; i++) { const l = Math.hypot(nx * (1 - tilt), tilt, nz * (1 - tilt)); N.push(nx * (1 - tilt) / l, tilt / l, nz * (1 - tilt) / l); }
    I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
}
function frontLit(m) { // thin foliage cards: light the back face exactly like the front instead of as an unlit underside
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace(/\( gl_FrontFacing \) \? vLightFront : vLightBack/g, 'vLightFront').replace(/\( gl_FrontFacing \) \? vIndirectFront : vIndirectBack/g, 'vIndirectFront'); };
  return m;
}
function foliageMat(map) {
  const m = frontLit(new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide }));
  m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
  return m;
}
function atlasFoliage(map, cols) {
  const m = foliageMat(map), base = m.onBeforeCompile;
  const cell = sh => { sh.vertexShader = 'attribute float aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_UV\n vUv.x = (vUv.x + aCell) / ' + cols.toFixed(1) + ';\n#endif'); };
  m.onBeforeCompile = sh => { base(sh); cell(sh); }; m.userData.depth.onBeforeCompile = cell;
  return m;
}
function ribbonGeo(build) { // build(push) where push(x,y,z,u,v,color) returns index
  const P = [], C = [], U = [], I = [];
  build((x, y, z, u, v, c) => { P.push(x, y, z); U.push(u, v); C.push(c.r, c.g, c.b); return P.length / 3 - 1; }, I);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I); g.computeVertexNormals(); return g;
}
/* ================= Taipei street dressing (real carriageways from OpenStreetMap) ================= */
// is (x, z) on another street's carriageway that crosses the circuit direction (tx, tz)? used to open kerbs at side streets
function sideStreetAt(x, z, tx, tz) {
  const G = W.roadGrid, M = W.M; if (!G) return false;
  const lst = G.grid.get(Math.floor(x / G.cs) + ',' + Math.floor(z / G.cs)); if (!lst) return false;
  for (let e = 0; e < lst.length; e += 2) {
    const r = M.roads[lst[e]], i = lst[e + 1], x0 = r.p[i], z0 = r.p[i + 1], dx = r.p[i + 2] - x0, dz = r.p[i + 3] - z0, l2 = dx * dx + dz * dz || 1;
    const f = clamp(((x - x0) * dx + (z - z0) * dz) / l2, 0, 1), d = Math.hypot(x - x0 - dx * f, z - z0 - dz * f);
    if (d < r.w / 2 + 0.5 && Math.abs(dx * tx + dz * tz) / Math.sqrt(l2) < 0.8) return true;
  }
  return false;
}
// nearest centreline sample to (x, z) within maxD metres, or -1
function nearestSample(x, z, maxD) {
  let best = -1, bd = maxD * maxD;
  for (let k = 0; k < W.n; k++) { const dx = X_(k) - x, dz = W.z[k] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
  return best;
}
const X_ = k => W.x[k];
const TAIPEI_PAINT = { white: lin(0xe9e9e4), yellow: lin(0xe0a81c), red: lin(0xb3262b) };
function buildTaipeiStreet(grp, ribbon, S) {
  const n = W.n, X = W.x, Z = W.z, ds = W.ds, env = W.M.env, P = TAIPEI_PAINT;
  // one mesh for every painted line: quads between consecutive samples at lateral offsets t0..t1
  const pos = [], col = [], idx = [];
  const quad = (r, t0, t1, c, y = 0.075) => {
    const b = pos.length / 3;
    for (const rr of [r, r + 1]) { const k = rr % n; for (const t of [t0, t1]) { const x = X[k] + W.lx[k] * t, z = Z[k] + W.lz[k] * t; pos.push(x, Sq(x, z, k) + y, z); col.push(c.r, c.g, c.b); } }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  // a mark of length len metres starting at sample k0 (several samples)
  const mark = (k0, len, t0, t1, c) => {
    if (len >= ds) { for (let i = 0; i < Math.round(len / ds); i++) quad(k0 + i, typeof t0 === 'function' ? t0(k0 + i) : t0, typeof t1 === 'function' ? t1(k0 + i) : t1, c); return; }
    const k = k0 % n, fx = -W.lz[k], fz = W.lx[k], b = pos.length / 3; // shorter than a sample: lay it along the local tangent
    for (const f of [0, len]) for (const t of [t0, t1]) { const x = X[k] + W.lx[k] * t + fx * f, z = Z[k] + W.lz[k] * t + fz * f; pos.push(x, Sq(x, z, k) + 0.075, z); col.push(c.r, c.g, c.b); }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  const dash = r => (S[r] % 10) < 4; // 4 m line, 6 m gap
  const near = new Uint8Array(n); // samples at a crossing or junction: no lane dashes there
  // crossings and signalised junctions on the circuit
  const cross = new Set(), stops = [];
  // street furniture of the road below never lands on a viaduct deck
  for (const [x, z] of env.crossings) { const k = nearestSample(x, z, 9); if (k >= 0 && !onDeck(k)) cross.add(k); }
  const sigK = new Set(); for (const sg of env.signals) { const k = nearestSample(sg.x, sg.z, 18); if (k >= 0 && !onDeck(k)) sigK.add(k); }
  const crossList = [...cross].sort((a, b) => a - b).filter((k, i, a) => i === 0 || k - a[i - 1] > Math.round(12 / ds));
  for (const k of crossList) {
    const w0 = k => -W.hwR[k % n] + 0.3, w1 = k => W.hwL[k % n] - 0.3, len = 4.5, k0 = (k - Math.round(len / 2 / ds) + n) % n;
    for (let i = 0; i < Math.round(len / ds); i++) {
      const r = (k0 + i) % n, a = w0(r), b = w1(r), m = Math.floor((b - a) / 1.0);
      for (let j = 0; j < m; j++) quad(r, a + j * 1.0, a + j * 1.0 + 0.45, P.white, 0.08); // zebra bars run with the traffic
      near[r] = 1;
    }
    for (let o = -Math.round(14 / ds); o <= Math.round(14 / ds); o++) near[(k + o + n) % n] = 1;
    const signal = [...sigK].some(s => Math.min(Math.abs(s - k), n - Math.abs(s - k)) * ds < 30);
    if (signal) stops.push(k0);
  }
  // stop line and scooter waiting box before each signalised crossing (traffic runs along +k, keeps right = negative lateral)
  const boxes = [];
  for (const k0 of stops) {
    const kb = (k0 - Math.round(4.5 / ds) + n) % n, ks = (kb - Math.round(0.5 / ds) + n) % n, hr = W.hwR[kb], half = W.two[kb] ? 0 : W.hwL[kb];
    mark(ks, 0.5, -hr + 0.3, half - 0.2, P.white); // stop line across our side of the road
    const bx0 = -hr + 0.6, bx1 = Math.min(half - 0.6, bx0 + Math.max(4, (hr + half) * 0.6));
    mark(kb, 0.15, bx0, bx1, P.white); mark((k0 - Math.round(0.4 / ds) + n) % n, 0.15, bx0, bx1, P.white);
    mark(kb, 4.1, bx0, bx0 + 0.15, P.white); mark(kb, 4.1, bx1 - 0.15, bx1, P.white);
    boxes.push([(kb + Math.round(2 / ds)) % n, (bx0 + bx1) / 2, bx1 - bx0]);
    for (let o = -Math.round(10 / ds); o <= 0; o++) near[(kb + o + n) % n] = 1;
  }
  // lane lines: edge lines, double yellow centre on two-way streets, dashed lane dividers, slow-lane line for scooters
  for (let r = 0; r < n; r++) {
    const hl = W.hwL[r], hr = W.hwR[r], two = W.two[r], ln = Math.max(1, W.lanes[r] || Math.round((hl + hr) / 3.4)), main = hl + hr >= 11;
    quad(r, hl - 0.35, hl - 0.2, P.white); quad(r, -hr + 0.2, -hr + 0.35, P.white);
    if (near[r]) continue;
    if (two) { quad(r, -0.2, -0.08, P.yellow); quad(r, 0.08, 0.2, P.yellow); }
    const curb = main ? 1.6 : 0;
    const dirs = two ? [[-hr + curb, -0.2, Math.max(1, Math.round(ln / 2))], [0.2, hl - curb, Math.max(1, Math.round(ln / 2))]] : [[-hr + curb, hl, ln]];
    for (const [a, b, m] of dirs) for (let j = 1; j < m; j++) if (dash(r)) { const t = a + (b - a) * j / m; quad(r, t - 0.07, t + 0.07, P.white); }
    if (main) { quad(r, -hr + curb - 0.08, -hr + curb + 0.08, P.white); if (two) quad(r, hl - curb - 0.08, hl - curb + 0.08, P.white); }
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); pg.setIndex(idx); pg.computeVertexNormals();
  const paint = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  paint.receiveShadow = true; grp.add(paint);
  // 機車停等區 lettering in the scooter boxes
  if (boxes.length) {
    const tex = canvasTex(512, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#ecece6'; g.font = '700 92px "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('機車停等區', w / 2, h / 2 + 4); }, true, false);
    const tp = [], tu = [], ti = [];
    for (const [k, c, wdt] of boxes) {
      const len = Math.min(wdt * 0.9, 6), dep = len / 4, kk = k % n, fx = -W.lz[kk], fz = W.lx[kk], b = tp.length / 3;
      // letters face drivers approaching along +k: text runs across the lane, its top toward the junction
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const lat = c + (0.5 - u) * len, fwd = (v - 0.5) * dep, x = X[kk] + W.lx[kk] * lat + fx * fwd, z = Z[kk] + W.lz[kk] * lat + fz * fwd;
        tp.push(x, Sq(x, z, kk) + 0.085, z); tu.push(u, v);
      }
      ti.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2)); tg.setIndex(ti); tg.computeVertexNormals();
    grp.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 })));
  }
  // kerbs and sidewalks, open where a side street joins or another part of the circuit runs alongside
  const open = side => { const o = new Uint8Array(n);
    for (let k = 0; k < n; k++) { const hs = side > 0 ? W.hwL[k] : W.hwR[k], t = (hs + 1.8) * side, x = X[k] + W.lx[k] * t, z = Z[k] + W.lz[k] * t;
      if (onDeck(k) || sideStreetAt(x, z, -W.lz[k], W.lx[k]) || gridSample(W.dist, x, z) < hs + 1.2) o[k] = 1; }
    const c = o.slice(); for (let k = 0; k < n; k++) if (c[k]) for (let q = -2; q <= 2; q++) o[(k + q + n) % n] = 1; return o; };
  const walkM = new THREE.MeshStandardMaterial({ map: TEX.walk, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const kerbM = new THREE.MeshStandardMaterial({ color: lin(0xa7a49c), roughness: 0.8, side: THREE.DoubleSide });
  for (const sd of [1, -1]) {
    const op = open(sd), keep = r => !op[r] && !op[(r + 1) % n], hs = k => sd > 0 ? W.hwL[k] : -W.hwR[k];
    ribbon(k => hs(k), k => hs(k) + sd * 3.5, 2, () => lin(0xffffff), 0.17, keep, false, walkM, 2);
    // kerb face: a thin vertical strip at the carriageway edge
    const kg = ribbonGeo((push, I) => { const w = lin(0xffffff), id = new Int32Array(n + 1);
      for (let r = 0; r <= n; r++) { const k = r % n, t = hs(k), x = X[k] + W.lx[k] * t, z = Z[k] + W.lz[k] * t, h = Hq(x, z); id[r] = push(x, h + 0.02, z, 0, 0, w); push(x, h + 0.17, z, 0, 1, w); }
      for (let r = 0; r < n; r++) if (keep(r)) I.push(id[r], id[r + 1], id[r] + 1, id[r] + 1, id[r + 1], id[r + 1] + 1); });
    const km = new THREE.Mesh(kg, kerbM); km.receiveShadow = true; grp.add(km);
  }
}
// parks and lawns, traffic lights with street-name signs, and landmark buildings from OpenStreetMap
const CSS_COL = { blue: 0x2f5fa8, white: 0xf1efe8, red: 0xa3302a, grey: 0x9a9a98, gray: 0x9a9a98, brown: 0x7a5236, yellow: 0xd9b23a, orange: 0xcf7a2c, green: 0x4b7a4a, black: 0x222222 };
const colOf = (c, d) => c ? (CSS_COL[c.toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : d)) : d;
// far mountains and towers outside the map (data/skyline.json: Copernicus DEM on a polar grid, Overture towers).
// They lie up to 40 km away, past the camera's far plane and the scene fog, so the vertex shader pulls every vertex
// farther than SKY_R back along its line of sight to SKY_R: bearing and angular size stay true, depth stays behind
// everything nearby. Their own haze uses the scene fog colour and a thinner density, so ridgelines read on a clear day.
function skylineImpostors(grp, S) {
  const sx = W.sx, sz = W.sz, cx = S.centre[0], cy = S.centre[1], A = 360 / S.az_step, R = S.radii, pos = [], col = [], idx = [], c = new THREE.Color();
  const inside = (x, z) => Math.abs(x) < sx / 2 - 50 && Math.abs(z) < sz / 2 - 50;
  const lo = lin(0x8f8b83), mid = lin(0x4f6447), hi = lin(0x3a4d36);
  for (let i = 0; i < R.length; i++) for (let a = 0; a < A; a++) {
    const az = a * S.az_step * Math.PI / 180, X = cx + R[i] * Math.sin(az), Y = cy + R[i] * Math.cos(az), h = S.h[i][a];
    pos.push(X - sx / 2, h, sz / 2 - Y); c.copy(h < 25 ? lo : h < 250 ? mid : hi); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i + 1 < R.length; i++) for (let a = 0; a < A; a++) {
    const p = i * A + a, q = i * A + (a + 1) % A, r = p + A, t = q + A;
    if ([p, q, r, t].every(v => inside(pos[v * 3], pos[v * 3 + 2]))) continue;
    idx.push(p, r, q, q, r, t);
  }
  const towerC = lin(0x8d97a2);
  for (const tw of S.towers || []) { // extruded footprint, flat roof
    const ring = tw.ring, m = ring.length, top = tw.base + tw.h, b = pos.length / 3;
    for (const [X, Y] of ring) { pos.push(X - sx / 2, tw.base, sz / 2 - Y, X - sx / 2, top, sz / 2 - Y); col.push(towerC.r, towerC.g, towerC.b, towerC.r * 1.1, towerC.g * 1.1, towerC.b * 1.1); }
    for (let k = 0; k < m; k++) { const k2 = (k + 1) % m; idx.push(b + k * 2, b + k2 * 2, b + k * 2 + 1, b + k2 * 2, b + k2 * 2 + 1, b + k * 2 + 1); }
    for (let k = 1; k + 1 < m; k++) idx.push(b + 1, b + k * 2 + 1, b + (k + 1) * 2 + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { sunDir: { value: SUN_DIR }, R: { value: SKY_R } }]), fog: true, side: THREE.DoubleSide, vertexColors: true,
    vertexShader: `uniform float R; uniform vec3 sunDir; varying vec3 vCol; varying float vL; varying float vSun;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vec3 d = wp.xyz - cameraPosition; float L = length(d); vL = L;
        if (L > R) wp.xyz = cameraPosition + d * (R / L);
        vCol = color; vSun = max(dot(normalize(mat3(modelMatrix) * normal), normalize(sunDir)), 0.0); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 fogColor; uniform float fogDensity; uniform float lum; varying vec3 vCol; varying float vL; varying float vSun;
      void main(){ float haze = 1.0 - exp(-vL * fogDensity * 0.36); vec3 c = vCol * (0.45 + 0.55 * vSun) * lum;
        gl_FragColor = vec4(mix(c, fogColor, clamp(haze, 0.0, 0.92)), 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  mat.uniforms.lum = SKYLINE_U.lum; mat.uniforms.sunDir = { value: SUN_DIR }; // merge() clones: keep the live objects
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'skyline'; mesh.frustumCulled = false; grp.add(mesh);
}
function taipeiScenery(grp) {
  const env = W.M.env, D = W.dist, HWg = W.hwGrid, n = W.n;
  // --- green areas, draped just above the ground
  { const pos = [], col = [], idx = [], c = new THREE.Color(), shade = { forest: 0x3f6a2c, wood: 0x3f6a2c, park: 0x5b8a3a, garden: 0x5f8f3e, grass: 0x6a9a44, pitch: 0x4f8a40, playground: 0x8a7a5a };
    for (const g of env.green) {
      const p = g.p, m = p.length / 2; if (m < 3) continue;
      const contour = []; for (let i = 0; i < m; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
      if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
      let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { continue; }
      c.copy(lin(shade[g.kind] ?? 0x5f8f3e)); const b = pos.length / 3;
      for (const v of contour) { pos.push(v.x, Hq(v.x, v.y) + 0.04, v.y); col.push(c.r, c.g, c.b); }
      for (const t of tris) idx.push(b + t[0], b + t[2], b + t[1]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.filter((v, i) => i % 3 !== 1).map(v => v / 6), 2)); g.setIndex(idx); g.computeVertexNormals();
    const gm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TEX.grass, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); gm.receiveShadow = true; grp.add(gm);
  }
  // --- traffic lights at the circuit's signalised junctions: pole on the right-hand kerb, mast arm over the road, green name sign
  { const sig = [];
    for (const sg of env.signals) {
      const k = nearestSample(sg.x, sg.z, 22); if (k < 0 || onDeck(k)) continue;
      if (sig.some(o => Math.min(Math.abs(o.k - k), n - Math.abs(o.k - k)) * W.ds < 25)) continue;
      const base = nm => nm.replace(/[一二三四五六七八九十]+段$/, ''), own = W.rname[k];
      let cross = sg.names.filter(nm => nm && base(nm) !== base(own));
      if (!cross.length && W.roadGrid) { // the signal node only carries our street: take the nearest crossing street
        const G = W.roadGrid, tx = -W.lz[k], tz = W.lx[k]; let bd = 30, bn = '';
        for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) { const lst = G.grid.get((Math.floor(sg.x / G.cs) + a) + ',' + (Math.floor(sg.z / G.cs) + b2)); if (!lst) continue;
          for (let e = 0; e < lst.length; e += 2) { const r = W.M.roads[lst[e]], i = lst[e + 1]; if (!r.n || base(r.n) === base(own)) continue;
            const x0 = r.p[i], z0 = r.p[i + 1], dx = r.p[i + 2] - x0, dz = r.p[i + 3] - z0, l2 = dx * dx + dz * dz || 1, f = clamp(((sg.x - x0) * dx + (sg.z - z0) * dz) / l2, 0, 1), d = Math.hypot(sg.x - x0 - dx * f, sg.z - z0 - dz * f);
            if (d < bd && Math.abs(dx * tx + dz * tz) / Math.sqrt(l2) < 0.6) { bd = d; bn = r.n; } } }
        if (bn) cross = [bn];
      }
      sig.push({ k: (k - Math.round(6 / W.ds) + n) % n, name: cross[0] || '' });
    }
    if (sig.length) {
      const cols = 4, rows = Math.ceil(sig.length / cols), cw = 256, ch = 64;
      const atlas = canvasTex(cw * cols, ch * rows, (g, w, h) => { g.fillStyle = '#1e6b3e'; g.fillRect(0, 0, w, h);
        sig.forEach((o, i) => { const x = (i % cols) * cw, y = Math.floor(i / cols) * ch; g.strokeStyle = '#f2f2f2'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
          g.fillStyle = '#ffffff'; g.font = `700 ${o.name.length > 5 ? 30 : 38}px "Noto Sans TC", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.name || '路口', x + cw / 2, y + ch / 2 + 2); }); }, true, false);
      const poleG = new THREE.CylinderGeometry(0.13, 0.16, 6.2, 8); poleG.translate(0, 3.1, 0);
      const armG = new THREE.CylinderGeometry(0.08, 0.1, 1, 6); armG.rotateZ(Math.PI / 2); armG.translate(0.5, 0, 0);
      const headG = new THREE.BoxGeometry(1.25, 0.42, 0.32);
      const metal = new THREE.MeshStandardMaterial({ color: lin(0x8c9196), roughness: 0.5, metalness: 0.6 });
      const poles = new THREE.InstancedMesh(poleG, metal, sig.length), arms = new THREE.InstancedMesh(armG, metal, sig.length), heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: lin(0x1c1e21), roughness: 0.6 }), sig.length);
      const lampG = new THREE.CircleGeometry(0.13, 12), lamps = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xffffff }), sig.length * 3);
      const sp = [], su = [], si = [];
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      const lampCol = [lin(0x401010), lin(0x40300a), lin(0x30ff80)], m4h = new THREE.Matrix4();
      sig.forEach((o, i) => {
        const k = o.k, hr = W.hwR[k], reach = Math.min(hr + W.hwL[k] * (W.two[k] ? 0 : 1), 9), bx = X_(k) - W.lx[k] * (hr + 1.3), bz = W.z[k] - W.lz[k] * (hr + 1.3), by = Hq(bx, bz);
        const yaw = Math.atan2(W.lx[k], W.lz[k]) - Math.PI / 2, fx = -W.lz[k], fz = W.lx[k]; // arm points left (+lateral), signals face oncoming (-forward)
        e.set(0, 0, 0); q.setFromEuler(e); p.set(bx, by, bz); sc.set(1, 1, 1); m.compose(p, q, sc); poles.setMatrixAt(i, m);
        e.set(0, yaw, 0); q.setFromEuler(e); p.set(bx, by + 5.9, bz); sc.set(reach + 1.3, 1, 1); m.compose(p, q, sc); arms.setMatrixAt(i, m);
        const hx = bx + W.lx[k] * (reach * 0.75 + 1.3), hz = bz + W.lz[k] * (reach * 0.75 + 1.3); p.set(hx, by + 5.55, hz); sc.set(1, 1, 1); m.compose(p, q, sc); heads.setMatrixAt(i, m);
        for (let j = 0; j < 3; j++) { const t = (j - 1) * 0.4, lx = hx + W.lx[k] * t - fx * 0.17, lz = hz + W.lz[k] * t - fz * 0.17; e.set(0, Math.atan2(-fx, -fz), 0); q.setFromEuler(e); p.set(lx, by + 5.55, lz); m.compose(p, q, sc); lamps.setMatrixAt(i * 3 + j, m); lamps.setColorAt(i * 3 + j, lampCol[j]); }
        // name sign on the arm, both faces
        const u0 = (i % cols) / cols, v1 = 1 - Math.floor(i / cols) / rows, u1 = u0 + 1 / cols, v0 = v1 - 1 / rows, sx = bx + W.lx[k] * (reach * 0.35 + 1.3), sz = bz + W.lz[k] * (reach * 0.35 + 1.3);
        for (const face of [-1, 1]) {
          const b = sp.length / 3, ox = fx * 0.06 * face, oz = fz * 0.06 * face;
          for (const [a, h] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const side = a * face; sp.push(sx + W.lx[k] * side * 1.3 + ox, by + 6.55 + h * 0.32, sz + W.lz[k] * side * 1.3 + oz); su.push(a < 0 ? u0 : u1, h < 0 ? v0 : v1); }
          si.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      });
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2)); sg.setIndex(si); sg.computeVertexNormals();
      poles.castShadow = arms.castShadow = heads.castShadow = true;
      if (PROPS && PROPS.signal_head) { // Blender head with visors; its lenses face local +z, so turn it to face oncoming traffic
        const flip = new THREE.Matrix4().makeRotationY(Math.PI);
        for (const { g, m } of PROPS.signal_head) { const im = new THREE.InstancedMesh(g, m, sig.length); for (let i = 0; i < sig.length; i++) { heads.getMatrixAt(i, m4h); m4h.multiply(flip); im.setMatrixAt(i, m4h); } im.castShadow = true; im.userData.keep = true; grp.add(im); }
        heads.visible = false;
      }
      grp.add(poles, arms, heads, lamps, new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5, side: THREE.DoubleSide })));
    }
  }
  // --- landmarks: OpenStreetMap 3D building parts (walls, flat or pyramidal roofs) and the old city gates
  { const wp = [], wc = [], wi = [], c = new THREE.Color();
    const tri = (a, b, cc, col) => { const s0 = wp.length / 3; wp.push(...a, ...b, ...cc); for (let i = 0; i < 3; i++) wc.push(col.r, col.g, col.b); wi.push(s0, s0 + 1, s0 + 2); };
    const quadV = (a, b, cc, d, col) => { tri(a, b, cc, col); tri(b, d, cc, col); };
    const prism = (ring, y0, y1, wallC, roofC, roof, rh) => { // ring: [[x,z]...] counter-clockwise seen from above
      const m = ring.length, top = roof === 'flat' || !rh ? y1 : y1 - rh;
      for (let i = 0; i < m; i++) { const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % m]; quadV([ax, y0, az], [bx, y0, bz], [ax, top, az], [bx, top, bz], wallC); }
      if (roof === 'pyramidal' || roof === 'hipped' || roof === 'dome' || roof === 'gabled') { let cx = 0, cz = 0; ring.forEach(([x, z]) => { cx += x; cz += z; }); cx /= m; cz /= m;
        for (let i = 0; i < m; i++) { const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % m]; tri([ax, top, az], [bx, top, bz], [cx, y1, cz], roofC); } }
      else { const v2 = ring.map(([x, z]) => new THREE.Vector2(x, z)); THREE.ShapeUtils.triangulateShape(v2, []).forEach(t => tri([ring[t[0]][0], top, ring[t[0]][1]], [ring[t[2]][0], top, ring[t[2]][1]], [ring[t[1]][0], top, ring[t[1]][1]], roofC)); }
    };
    const ringOf = p => { const r = []; for (let i = 0; i < p.length; i += 2) r.push([p[i], p[i + 1]]); const v = r.map(([x, z]) => new THREE.Vector2(x, z)); if (THREE.ShapeUtils.isClockWise(v)) r.reverse(); return r; };
    for (const L of env.landmarks) {
      const ring = ringOf(L.p); if (ring.length < 3) continue;
      { let gx = 0, gz = 0; ring.forEach(([x, z]) => { gx += x; gz += z; }); if (inTile(W.M, gx / ring.length, gz / ring.length)) continue; }
      let base = Infinity; ring.forEach(([x, z]) => { base = Math.min(base, Hq(x, z)); }); base -= 0.2;
      if (L.k === 'gate') { // 臺北府城 gates: stone platform with an arched passage, red-pillared pavilion, glazed hip roof
        let cx = 0, cz = 0; ring.forEach(([x, z]) => { cx += x; cz += z; }); cx /= ring.length; cz /= ring.length;
        const sh = (r, f) => r.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f]);
        prism(ring, base, base + 5.2, lin(0xa59c8c), lin(0x8f8778), 'flat', 0);
        prism(sh(ring, 0.62), base + 5.2, base + 9.0, lin(0x9a2d24), lin(0x9a2d24), 'flat', 0);
        prism(sh(ring, 0.95), base + 9.0, base + 12.6, lin(0x9a2d24), lin(0xd08a2a), 'hipped', 3.4);
        // arched passage: a dark slot through the long axis of the platform
        let best = 0, ax = 1, az = 0; for (let i = 0; i < ring.length; i++) { const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length], l = Math.hypot(x1 - x0, z1 - z0); if (l > best) { best = l; ax = (x1 - x0) / l; az = (z1 - z0) / l; } }
        const px = -az, pz = ax, hwA = 1.8, dark = lin(0x1d1a17);
        let half = 0; ring.forEach(([x, z]) => { half = Math.max(half, Math.abs((x - cx) * px + (z - cz) * pz)); });
        for (const sd of [1, -1]) { const ox = cx + px * (half + 0.04) * sd, oz = cz + pz * (half + 0.04) * sd;
          quadV([ox - ax * hwA, base + 0.2, oz - az * hwA], [ox + ax * hwA, base + 0.2, oz + az * hwA], [ox - ax * hwA, base + 3.6, oz - az * hwA], [ox + ax * hwA, base + 3.6, oz + az * hwA], dark); }
        continue;
      }
      const wall = lin(colOf(L.bc, 0xece8de)), roofC = lin(colOf(L.rc, L.rs === 'flat' ? 0xb8b4aa : 0x8a4b33));
      prism(ring, base + L.mh, base + L.h, wall, roofC, L.rs, L.rh);
    }
    if (wi.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3)); g.setIndex(wi); g.computeVertexNormals();
      const lm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })); lm.castShadow = lm.receiveShadow = true; grp.add(lm); }
  }
}
// direction cues: chevron boards on the outside of each real turn, facing the approaching car; white turn arrows painted before it (Taipei)
function cornerMarkers(grp) {
  if (!W.corners || !W.corners.length) return;
  const n = W.n;
  const boards = [], arrows = [];
  for (const c of W.corners) {
    if (c.deg < 45) continue;
    const len = ((c.exit - c.entry + n) % n), cnt = clamp(Math.round(len * W.ds / 14), 3, 7), side = c.left ? -1 : 1; // outside of the turn
    for (let i = 0; i < cnt; i++) boards.push([(c.entry + Math.round(len * (i + 0.5) / cnt)) % n, side, c.left]);
    if (W.real) for (const back of [15, 35]) arrows.push([(c.entry - Math.round(back / W.ds) + n) % n, c.left]);
  }
  if (boards.length) { // one mesh per arrow direction; each board faces the oncoming car (plane normal = -forward)
    const g = new THREE.PlaneGeometry(1.3, 0.95); g.translate(0, 1.55, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (const left of [true, false]) {
      const list = boards.filter(b => b[2] === left); if (!list.length) continue;
      const tx = canvasTex(128, 96, (gc, w, h) => { gc.fillStyle = '#c8102e'; gc.fillRect(0, 0, w, h); gc.fillStyle = '#fff'; gc.beginPath(); const P = left ? [[94, 12], [54, 48], [94, 84], [76, 84], [36, 48], [76, 12]] : [[34, 12], [74, 48], [34, 84], [52, 84], [92, 48], [52, 12]]; gc.moveTo(...P[0]); for (const pt of P.slice(1)) gc.lineTo(...pt); gc.closePath(); gc.fill(); }, true, false);
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: tx, roughness: 0.7 }), list.length);
      list.forEach(([k, sd], i) => {
        const hs = sd > 0 ? W.hwL[k] : W.hwR[k], wl = sd > 0 ? W.wallL[k] : W.wallR[k], off = (isFinite(wl) ? wl : hs) + 0.6, x = W.x[k] + W.lx[k] * off * sd, z = W.z[k] + W.lz[k] * off * sd;
        p.set(x, Sq(x, z, k), z); e.set(0, Math.atan2(W.lz[k], -W.lx[k]), 0); q.setFromEuler(e); m.compose(p, q, s); im.setMatrixAt(i, m);
      });
      im.castShadow = true; grp.add(im);
    }
  }
  if (arrows.length) { // Taiwanese lane arrow: stem with a bent head toward the turn, in the lane nearest the inside of the turn
    const pos = [], idx = [];
    for (const [k, left] of arrows) {
      const sd = left ? 1 : -1, lat = sd * Math.max(1.6, (sd > 0 ? W.hwL[k] : W.hwR[k]) * 0.45), fx = -W.lz[k], fz = W.lx[k], lx = W.lx[k] * sd, lz = W.lz[k] * sd;
      const P = (f, l) => { const x = W.x[k] + W.lx[k] * lat + fx * f + lx * l, z = W.z[k] + W.lz[k] * lat + fz * f + lz * l; return [x, Sq(x, z, k) + 0.09, z]; };
      const shape = [[0, -0.15], [3.2, -0.15], [3.2, 0.15], [0, 0.15], [2.9, 0.0], [4.4, 1.1], [4.0, 1.4], [2.9, 0.3], [4.9, 1.9], [3.5, 2.0], [4.6, 0.9]];
      const b = pos.length / 3; for (const [f, l] of shape) pos.push(...P(f, l));
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7, b + 8, b + 9, b + 10);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: lin(0xeaeae4), roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 })));
  }
}
// red and white plastic water barriers (水馬), the usual Taiwanese road-closure barrier, on the kerb line
function waterBarriers(grp) {
  const n = W.n, X = W.x, Z = W.z, spots = [];
  for (const sd of [1, -1]) { const arr = sd > 0 ? W.wallL : W.wallR; let acc = 0;
    for (let k = 0; k < n; k++) { acc += W.ds; if (!isFinite(arr[k]) || acc < 1.25 || onDeck(k)) continue; acc = 0; spots.push([k, sd, arr[k]]); } } // decks have parapets
  if (!spots.length) return;
  const g = new THREE.BoxGeometry(1.2, 0.8, 0.42, 1, 1, 1); g.translate(0, 0.4, 0);
  { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.5) p.setZ(i, p.getZ(i) * 0.55); g.computeVertexNormals(); } // narrower at the top
  const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.55 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), red = lin(0xc4212a), wht = lin(0xf2f0ea);
  const items = [];
  spots.forEach(([k, sd, off], i) => { const t = off * sd, x = X[k] + W.lx[k] * t, z = Z[k] + W.lz[k] * t; p.set(x, Sq(x, z, k), z); e.set(0, Math.atan2(W.lx[k], W.lz[k]) + Math.PI / 2, 0); q.setFromEuler(e); m.compose(p, q, sc); im.setMatrixAt(i, m); im.setColorAt(i, i & 1 ? wht : red); items.push({ m: m.clone(), kind: 'water_barrier', c: i & 1 ? wht : red }); });
  im.castShadow = im.receiveShadow = true; grp.add(im);
  if (PROPS && PROPS.water_barrier) nearLod(grp, im, items, { water_barrier: PROPS.water_barrier }, COARSE ? 300 : 900, COARSE ? 80 : 140);
}
const TILE_CACHE = new Map();
// repeated street parts of the Blender tiles, drawn as instances: geometry origin at the base, local x along the wall
let TILE_PARTS = null;
function tileParts() {
  if (TILE_PARTS) return TILE_PARTS;
  const grille = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#d4d6d4'; g.lineWidth = 7; g.strokeRect(4, 4, w - 8, h - 8); g.lineWidth = 4; for (let x = 20; x < w; x += 18) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - 4); g.stroke(); } g.beginPath(); g.moveTo(4, h / 2); g.lineTo(w - 4, h / 2); g.stroke(); }, true, false);
  const geo = (g, y) => { g.translate(0, y, 0); return g; };
  TILE_PARTS = {
    cage: { g: geo(new THREE.BoxGeometry(2.0, 1.7, 0.4), 0.85), m: new THREE.MeshStandardMaterial({ map: grille, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.6 }) },
    ac: { g: geo(new THREE.BoxGeometry(0.8, 0.5, 0.35), 0.25), m: new THREE.MeshStandardMaterial({ color: lin(0xdcdcd4), roughness: 0.6 }) },
    column: { g: geo(new THREE.BoxGeometry(0.55, 6.0, 0.55), 3.0), m: new THREE.MeshStandardMaterial({ color: lin(0xb4ae9f), roughness: 0.85 }) },
    tank: { g: geo(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 10), 0.7), m: new THREE.MeshStandardMaterial({ color: lin(0xd2d6da), roughness: 0.3, metalness: 0.8 }) },
  };
  if (PROPS && PROPS.scooter) TILE_PARTS.scooter = PROPS.scooter; // Blender model, several parts; the first (body) is tinted per scooter
  return TILE_PARTS;
}
const SCOOTER_COLORS = [0xf2f2ee, 0xf2f2ee, 0x1c1c1e, 0xa9adb2, 0xb3262b, 0x2a5aa8, 0xe8c547, 0x6f8f62].map(c => new THREE.Color(c).convertSRGBToLinear());
function tileInstances(js, M) {
  const grp = new THREE.Group(), parts = tileParts(), ox = js.x0 - M.sx / 2, oz = M.sz / 2 - js.y0, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  for (const k of Object.keys(parts)) {
    if (!js[k]) continue;
    const bin = atob(js[k]), a = new Int16Array(bin.length / 2); for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    const n = a.length / 4; if (!n) continue;
    (Array.isArray(parts[k]) ? parts[k] : [parts[k]]).forEach((part, pi) => {
      const im = new THREE.InstancedMesh(part.g, part.m, n);
      for (let i = 0; i < n; i++) { p.set(ox + a[i * 4] / 10, a[i * 4 + 2] / 10, oz - a[i * 4 + 1] / 10); e.set(0, a[i * 4 + 3] / 10000, 0); q.setFromEuler(e); m.compose(p, q, sc); im.setMatrixAt(i, m); }
      if (k === 'scooter' && pi === 0) for (let i = 0; i < n; i++) im.setColorAt(i, SCOOTER_COLORS[(a[i * 4] * 7 + a[i * 4 + 1] * 13) & 7]);
      im.castShadow = k !== 'cage' && k !== 'scooter'; im.receiveShadow = true; im.userData.tile = true; im.userData.detail = true; grp.add(im);
    });
  }
  return grp;
}
// tiles in use for the current circuit (set by buildMeshes); everything else keeps the generated buildings
const inTile = (M, x, z) => !!(W.activeTiles && W.activeTiles.some(t => x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1));
function pickTiles(M, maxD = 1200) {
  if (!M.tiles || !M.tiles.length) return [];
  const step = Math.max(1, Math.round(50 / W.ds));
  return M.tiles.filter(t => { for (let k = 0; k < W.n; k += step) { const dx = Math.max(t.x0 - W.x[k], 0, W.x[k] - t.x1), dz = Math.max(t.z0 - W.z[k], 0, W.z[k] - t.z1); if (dx * dx + dz * dz < maxD * maxD) return true; } return false; });
}
// Every tile's glTF names the same shared textures in models/taipei/tex. Left to itself each tile's parser decodes its
// own copy: fifteen tiles x ~50 images at once, a GPU copy each, and now and then Chrome fails a decode ("The source image
// could not be decoded") and drops the tile. This plugin hands every parser one texture per image URL and sampler.
const SHARED_TEX = new Map();
function sharedTextures(parser) {
  const own = parser.loadTextureImage.bind(parser);
  parser.loadTextureImage = (ti, source, loader) => {
    if (!source.uri) return own(ti, source, loader);
    const td = parser.json.textures[ti], key = (/^(https?:|data:|blob:|\/)/.test(source.uri) ? source.uri : (parser.options.path || '') + source.uri) + '|' + JSON.stringify(td.sampler != null ? parser.json.samplers[td.sampler] : null);
    if (!SHARED_TEX.has(key)) SHARED_TEX.set(key, own(ti, source, loader).catch(e => { SHARED_TEX.delete(key); throw e; }));
    return SHARED_TEX.get(key);
  };
  return { name: 'tgp_shared_textures' };
}
function gltfLoader() {
  const L = new THREE.GLTFLoader(); L.register(sharedTextures);
  if (THREE.DRACOLoader) { // one decoder (and worker pool) for every glTF, matching Blender 5's Draco 1.5 encoder
    if (!loadTile.draco) { loadTile.draco = new THREE.DRACOLoader(); loadTile.draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loadTile.draco.setWorkerLimit(2); }
    L.setDRACOLoader(loadTile.draco);
  }
  return L;
}
function loadTile(file, M, retry = 1) {
  if (!TILE_CACHE.has(file)) TILE_CACHE.set(file, Promise.all([new Promise((ok, fail) => {
    gltfLoader().load(file, g => {
      const detail = [];
      g.scene.traverse(o => { o.userData.tile = true; if (o.userData.detail) detail.push(o); if (o.isMesh) { o.castShadow = o.receiveShadow = true; const m = o.material; if (m.map) m.map.anisotropy = 4; } });
      g.scene.userData.detail = detail; ok(g.scene);
    }, undefined, fail);
  }), fetch(file.replace(/\.gltf$/, '.inst.json')).then(r => r.ok ? r.json() : null).catch(() => null)]).then(([sc, js]) => {
    if (js) { const ig = tileInstances(js, M); ig.userData.tile = true; sc.add(ig); sc.userData.detail.push(...ig.children); }
    return sc;
  }).catch(e => { // one more try a moment later rather than a missing block of the city
    TILE_CACHE.delete(file); if (!retry) throw e;
    return new Promise(ok => setTimeout(ok, 800)).then(() => loadTile(file, M, retry - 1));
  }));
  return TILE_CACHE.get(file);
}
// Blender street props (models/props): trees, water barrier, street lamp, signal head; parts = [{ g, m }] per prop
let PROPS = null;
function loadProps() {
  if (!window.THREE.GLTFLoader) return Promise.resolve(null);
  return new Promise(ok => gltfLoader().load('models/props/props.gltf', g => {
    const P = {};
    for (const node of g.scene.children) { const parts = []; node.traverse(o => { if (o.isMesh) { o.material.userData.prop = true; parts.push({ g: o.geometry, m: o.material }); } }); P[node.name] = parts; }
    ok(PROPS = P);
  }, undefined, () => ok(null)));
}
// side views of the five street-tree models, for the crossed cards that stand in for them beyond the near range
let TREE_ATLAS = null;
function loadTreeAtlas() {
  return fetch('models/props/trees_atlas.json').then(r => r.ok ? r.json() : null).then(j => j && new Promise(ok => new THREE.TextureLoader().load('models/props/trees_atlas.webp', t => {
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; ok(TREE_ATLAS = { tex: t, cols: j.cols, size: Object.fromEntries(j.cells.map(c => [c.name, c.size])) });
  }, undefined, () => ok(null)))).catch(() => null);
}
// near the camera an instanced item shows its Blender model; the cheap stand-in (far mesh) keeps the rest
const LODS = [];
let lodK = 1, detailR = 450; // set by applyQuality: share of the near-model budget, range of the tiles' street detail (m)
function nearLod(grp, far, items, kinds, cap, radius) {
  // items: [{ m: Matrix4 model transform, kind, c?: Color }]; kinds: { name: parts }
  const meshes = {};
  const tinted = items.some(it => it.c); // the colour buffer must exist before the first draw, or the shader is built without it
  for (const [k, parts] of Object.entries(kinds)) meshes[k] = parts.map(({ g, m }) => { const im = new THREE.InstancedMesh(g, m, cap); if (tinted) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); im.count = 0; im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.userData.keep = true; grp.add(im); return im; });
  const L = { far, items, meshes, cap, r2: radius * radius, farOrig: far.instanceMatrix.array.slice(), shown: new Set(), at: new THREE.Vector3(1e9, 0, 0), grp };
  LODS.push(L); return L;
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function updateLods() {
  for (let li = LODS.length - 1; li >= 0; li--) {
    const L = LODS[li];
    if (L.grp !== W.group) { LODS.splice(li, 1); continue; }
    if (L.at.distanceToSquared(camera.position) < 25) continue; L.at.copy(camera.position);
    const cx = camera.position.x, cz = camera.position.z, near = [], cap = Math.max(1, Math.round(L.cap * lodK)), r2 = L.r2 * lodK; // fewer and closer at the lower auto tiers
    L.items.forEach((it, i) => { const e = it.m.elements, d = (e[12] - cx) ** 2 + (e[14] - cz) ** 2; if (d < r2) near.push([d, i]); });
    near.sort((a, b) => a[0] - b[0]); if (near.length > cap) near.length = cap;
    const now = new Set(near.map(n => n[1])), arr = L.far.instanceMatrix.array, cnt = {};
    for (const i of L.shown) if (!now.has(i)) for (let j = 0; j < 16; j++) arr[i * 16 + j] = L.farOrig[i * 16 + j];
    for (const i of now) ZERO.toArray(arr, i * 16);
    L.far.instanceMatrix.needsUpdate = true; L.shown = now;
    for (const k in L.meshes) cnt[k] = 0;
    for (const i of now) { const it = L.items[i], j = cnt[it.kind]++; for (const im of L.meshes[it.kind]) { im.setMatrixAt(j, it.m); if (it.c) im.setColorAt(j, it.c); } }
    for (const k in L.meshes) for (const im of L.meshes[k]) { im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
}
let tileT = 0;
// Blender tiles of the circuit: the ones within 800 m of the start line load at once, the rest one after another in a few lanes,
// so the countdown is not held up by tiles at the far end of the lap (phones: 2 lanes)
function queueTiles(grp, M, x0, z0) {
  const order = W.activeTiles.map(t => ({ t, d: Math.hypot((t.x0 + t.x1) / 2 - x0, (t.z0 + t.z1) / 2 - z0) })).sort((a, b) => a.d - b.d);
  let next = 0;
  const lane = () => {
    if (W.group !== grp || next >= order.length) return;
    const { t } = order[next++];
    loadTile(t.file, M).then(sc => { if (W.group !== grp) return; grp.add(sc); autoHold(1.5); W.tiles.push({ sc, cx: (t.x0 + t.x1) / 2, cz: (t.z0 + t.z1) / 2, r: Math.hypot(t.x1 - t.x0, t.z1 - t.z0) / 2, near: null }); })
      .catch(e => console.warn('tile', t.file, e)).then(lane);
  };
  const lanes = Math.max(order.filter(o => o.d < 800).length, COARSE ? 2 : 4);
  for (let i = 0; i < lanes; i++) lane();
}
// work buildMeshes() left for later (city streets, generated buildings, trees, street furniture, landmarks): a little each frame
function runLater(budgetMs) {
  const L = W.later; if (!L || !L.length) return;
  const t0 = performance.now(); do L.shift()(); while (L.length && performance.now() - t0 < budgetMs);
}
function updateTiles(dt) {
  if ((tileT -= dt) > 0) return; tileT = 0.3;
  updateLods();
  if (!W.tiles || !W.tiles.length) return;
  for (const T of W.tiles) {
    const near = Math.hypot(camera.position.x - T.cx, camera.position.z - T.cz) - T.r < detailR;
    if (near !== T.near) { T.near = near; for (const o of T.sc.userData.detail) o.visible = near; }
  }
}
function buildMeshes() {
  W.lampPools = null;
  if (W.group) { scene.remove(W.group); W.group.traverse(o => { if (o.userData.tile || o.userData.keep) return; if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); }
  const grp = W.group = new THREE.Group(); scene.add(grp);
  const later = W.later = [], defer = f => later.push(() => { if (W.group === grp) f(); }); // built a few frames later, during the countdown (runLater)
  W.activeTiles = W.real ? pickTiles(W.M) : [];
  const M = W.M, NX = W.nx, NZ = W.nz, cx = W.sx / (NX - 1), cz = W.sz / (NZ - 1), H = W.H, D = W.dist, hw = setup.width / 2, n = W.n, X = W.x, Z = W.z;
  const nrm = new THREE.Vector3();
  // --- ground
  let lo = Infinity, hi = -Infinity; for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  W.minH = lo; W.maxH = hi;
  const pos = new Float32Array(NX * NZ * 3), col = new Float32Array(NX * NZ * 3), uv = new Float32Array(NX * NZ * 2), spl = new Float32Array(NX * NZ * 4), c = new THREE.Color();
  const cLow = lin(0x5a7a35), cHigh = lin(0x7d8541), cDry = lin(0x9a8a5e), cRock = lin(0x857d74), cSnow = lin(0xf0f3f6), cRun = lin(0x6a9a3c);
  const cUrban = lin(0xa9a49a), cUrban2 = lin(0x938f87), cPark = lin(0x5f8a3a), cRiver = lin(0x6b6a55), cWalk = lin(0x8e8c86);
  const hr = mulberry32(99);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const o = j * NX + i, x = -W.sx / 2 + i * cx, z = -W.sz / 2 + j * cz;
    pos[o * 3] = x; pos[o * 3 + 1] = H[o]; pos[o * 3 + 2] = z; uv[o * 2] = x / 9; uv[o * 2 + 1] = z / 9;
    let wg = 1, wd = 0, wr = 0, ws = 0; // grass, dirt, rock, special (snow in the hills, paving in the city)
    if (W.city) {
      const m = M.mask[o];
      if (m === 0) { const mud = H[o] < (M.water ?? -99) + 1.2; wg = mud ? 0.2 : 1; wd = mud ? 1 : 0.15; }
      else if (m === 2) { wg = 1; wd = 0.1; }
      else { wg = 0.08; ws = 1; }
      c.setRGB(1, 1, 1);
      if (D[o] < hw + 10) { wg = 0; wd = 0; ws = 1; c.setRGB(0.86, 0.86, 0.86); }
    } else {
      const t = (H[o] - lo) / (hi - lo + 1e-6);
      normalAt(x, z, nrm);
      wd = smooth(0.5, 0.85, t) * 0.8 + 0.12; wr = smooth(0.82, 0.62, nrm.y) * 2.2 + smooth(0.8, 0.95, t) * 0.4; ws = hi - lo > 150 ? smooth(0.86, 0.96, t) * 3 : 0;
      wg = 1 - smooth(0.7, 0.95, t) * 0.8;
      c.setRGB(1, 1, 1).lerp(cHigh, 0.08);
      if (D[o] < hw + 14) { wg = 1.4; wd = 0.05; wr = 0; ws = 0; c.setRGB(1.08, 1.12, 1.0); }
    }
    spl[o * 4] = wg; spl[o * 4 + 1] = wd; spl[o * 4 + 2] = wr; spl[o * 4 + 3] = ws;
    const j2 = 0.94 + hr() * 0.1; col[o * 3] = c.r * j2; col[o * 3 + 1] = c.g * j2; col[o * 3 + 2] = c.b * j2;
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6); let p = 0;
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1; idx[p++] = a; idx[p++] = cc; idx[p++] = b; idx[p++] = b; idx[p++] = cc; idx[p++] = d; }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.setAttribute('splat', new THREE.BufferAttribute(spl, 4)); tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
  const ground = new THREE.Mesh(tg, splatMaterial(W.city ? TEX.pave : TEX.snow, qLevel === 'low')); ground.receiveShadow = true; grp.add(ground);
  const og = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(W.sx, W.sz) * 8, Math.max(W.sx, W.sz) * 8), new THREE.MeshLambertMaterial({ color: W.city ? cUrban2 : cLow }));
  og.rotation.x = -Math.PI / 2; og.position.y = lo - 1.5; grp.add(og);
  if (W.city && M.water !== null) { // water surface over river / lake cells
    const wl = M.water, wp = [], wi = [];
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const o = j * NX + i; if (M.mask[o] !== 0 && M.mask[o + 1] !== 0 && M.mask[o + NX] !== 0) continue;
      if (Math.min(H[o], H[o + 1], H[o + NX], H[o + NX + 1]) > wl + 0.5) continue;
      const b = wp.length / 3, x = -W.sx / 2 + i * cx, z = -W.sz / 2 + j * cz;
      wp.push(x, wl, z, x + cx, wl, z, x, wl, z + cz, x + cx, wl, z + cz); wi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wp.filter((v, i) => i % 3 !== 1).map(v => v / 40), 2));
    grp.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: lin(0x2c4650), roughness: 0.12, metalness: 0.15, envMapIntensity: 1.3, normalMap: TEX.waterN, normalScale: new THREE.Vector2(0.35, 0.35) })));
  }
  // --- city streets (not the circuit)
  // vertices at Hq + 0.03 on the OSM nodes alone used to span tens of metres, and the flat triangles between them rose up to
  // 0.16 m above the circuit asphalt (Hq + 0.05) where a street runs along or across the lap. Streets near the circuit get a row
  // every 2 m and a column every ~2 m across (same columns along the whole street, so no T-junction cracks): they then follow
  // the ground as closely as the asphalt does and stay 0.02 m under it
  if (W.city) defer(() => {
    const g = ribbonGeo((push, I) => {
      const grey = lin(0x6f6f6f), nearC = (x, z) => gridSample(D, x, z) < W.hwMax + 25;
      for (const r of M.roads) {
        const pts = r.p, m = pts.length / 2, hwR = (r.w || ROAD_W[r.c]) / 2; if (m < 2 || r.lay > 0) continue;
        let close = false;
        for (let i = 0; i < m && !close; i++) { close = nearC(pts[i * 2], pts[i * 2 + 1]);
          if (!close && i + 1 < m) { const L = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]); for (let f = 4; f < L && !close; f += 4) { const t = f / L; close = nearC(pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t, pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t); } } }
        const cols = close ? Math.max(1, Math.ceil(hwR)) : 1, rows = []; // [x, z, tx, tz, s]
        let s = 0;
        for (let i = 0; i < m; i++) {
          const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1); let tx = pts[b * 2] - pts[a * 2], tz = pts[b * 2 + 1] - pts[a * 2 + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
          if (i) s += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
          rows.push([pts[i * 2], pts[i * 2 + 1], tx, tz, s]);
          if (close && i + 1 < m) { const dx = pts[i * 2 + 2] - pts[i * 2], dz = pts[i * 2 + 3] - pts[i * 2 + 1], L = Math.hypot(dx, dz), q = Math.ceil(L / 2);
            for (let j = 1; j < q; j++) { const t = j / q, x = pts[i * 2] + dx * t, z = pts[i * 2 + 1] + dz * t; if (nearC(x, z)) rows.push([x, z, dx / L, dz / L, s + L * t]); } }
        }
        let prevBase = -1;
        for (const [x, z, tx, tz, sr] of rows) {
          const lx = tz, lz = -tx, base = push(x + lx * hwR, Hq(x + lx * hwR, z + lz * hwR) + 0.03, z + lz * hwR, 0, sr / 8, grey);
          for (let q = 1; q <= cols; q++) { const o = hwR - 2 * hwR * q / cols, px = x + lx * o, pz = z + lz * o; push(px, Hq(px, pz) + 0.03, pz, q / cols, sr / 8, grey); }
          if (prevBase >= 0) for (let q = 0; q < cols; q++) I.push(prevBase + q, base + q, prevBase + q + 1, prevBase + q + 1, base + q, base + q + 1);
          prevBase = base;
        }
      }
    });
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.asphalt, roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    mesh.receiveShadow = true; grp.add(mesh);
  });
  // --- circuit ribbons
  const S = new Float32Array(n + 1); for (let k = 1; k <= n; k++) S[k] = S[k - 1] + W.ds;
  // from / to: lateral offsets, either numbers or functions of the sample index (real road widths vary along the lap)
  function ribbon(from, to, cols, colorAt, yOff, keep, flat, mat, metric) {
    const F = typeof from === 'function' ? from : () => from, T = typeof to === 'function' ? to : () => to;
    const g = ribbonGeo((push, I) => {
      const vert = (r, q, cc) => { const k = r % n, f = F(k), t = f + (T(k) - f) * q / cols, x = X[k] + W.lx[k] * t, z = Z[k] + W.lz[k] * t; return metric ? push(x, Sq(x, z, k) + yOff, z, t / metric, S[r] / metric, cc) : push(x, Hq(x, z) + yOff, z, q / cols, S[r] / 8, cc); };
      if (!flat) {
        for (let r = 0; r <= n; r++) for (let q = 0; q <= cols; q++) vert(r, q, colorAt(r % n, q));
        for (let r = 0; r < n; r++) { if (keep && !keep(r)) continue; for (let q = 0; q < cols; q++) { const a = r * (cols + 1) + q, b = a + 1, cc = a + cols + 1, d = cc + 1; I.push(a, b, cc, b, d, cc); } }
      } else {
        for (let r = 0; r < n; r++) { if (keep && !keep(r)) continue;
          for (let q = 0; q < cols; q++) { const cc = colorAt(r, q);
            const a = vert(r, q, cc), b = vert(r, q + 1, cc), c2 = vert(r + 1, q, cc), d = vert(r + 1, q + 1, cc); I.push(a, b, c2, b, d, c2); } }
      }
    });
    const m = new THREE.Mesh(g, mat || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    m.receiveShadow = true; grp.add(m); return m;
  }
  const asph = lin(0x8a8a8c), asph2 = lin(0x77777a), white = lin(0xf0f0f0), red = lin(0xc8202a), green = lin(0x2c9a46), black = lin(0x151515);
  // asphalt: darker rubber on the racing line, streaky braking marks where the speed profile drops
  const ar = mulberry32(5), shade = Array.from({ length: n }, () => ar()), line = new Float32Array(n), brake = new Float32Array(n);
  const hL = k => W.hwL[k % n], hR = k => -W.hwR[k % n];
  for (let k = 0; k < n; k++) { line[k] = RACE.line[k]; const v0 = RACE.prof[k], v1 = RACE.prof[(k + Math.round(40 / W.ds)) % n]; brake[k] = clamp((v0 - v1) / 25, 0, 1); }
  smoothCirc(line, 6, 2); smoothCirc(brake, 4, 2);
  const AC = 20, tmpC = new THREE.Color();
  ribbon(hR, hL, AC, (k, q) => {
    const t = -W.hwR[k] + (W.hwL[k] + W.hwR[k]) * q / AC, dl = (t - line[k]) / 1.7, rub = Math.exp(-dl * dl) * (W.real ? 0.45 : 1), streak = brake[k] * (W.real ? 0.4 : 1) * (0.5 + 0.5 * Math.sin(t * 5.3 + k * 0.05)) * Math.exp(-dl * dl * 0.6);
    const edge = smooth((t > 0 ? W.hwL[k] : W.hwR[k]) - 1.2, t > 0 ? W.hwL[k] : W.hwR[k], Math.abs(t)) * 0.12;
    return tmpC.copy(asph).lerp(asph2, shade[k] * 0.4).multiplyScalar(1 - rub * 0.22 - streak * 0.32 + edge).clone();
  }, 0.05, null, false,
    W.asphalt = new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.asphalt2, normalMap: TEX.asphaltN, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.8, envMapIntensity: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 6);
  if (W.apronL) { // beginners' corner apron: plain asphalt from the road edge to the moved barrier, above the sidewalk
    const apC = lin(0x707074);
    for (const [A, H, sd] of [[W.apronL, W.hwL, 1], [W.apronR, W.hwR, -1]])
      ribbon(k => sd * H[k], k => sd * (H[k] + A[k]), 2, () => apC, W.real ? 0.2 : 0.06, r => A[r] > 0.05 || A[(r + 1) % n] > 0.05, false);
  }
  { // racing-line guide painted over the asphalt: green where the line accelerates, yellow through the corner, red under braking
    const V = RACE.lineProf, la = Math.max(1, Math.round(5 / W.ds)), cG = new THREE.Color(0x2fd05a), cY = new THREE.Color(0xffc21a), cR = new THREE.Color(0xff3b30), ph = new Float32Array(n);
    for (let k = 0; k < n; k++) { const dv = V[(k + la) % n] - V[k]; ph[k] = dv < -0.25 ? -1 : dv > 0.12 || V[k] > 92 ? 1 : 0; }
    smoothCirc(ph, 2, 1); W.linePh = ph; // the tutorial watches for the red stretches
    W.lineMesh = ribbon(k => RACE.line[k] - 0.55, k => RACE.line[k] + 0.55, 1, k => ph[k] < 0 ? cY.clone().lerp(cR, -ph[k]) : cY.clone().lerp(cG, ph[k]), 0.07, null, false,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), 6);
    W.lineMesh.receiveShadow = false; W.lineMesh.visible = setup.lineGuide !== false;
  }
  const gravM = new THREE.MeshStandardMaterial({ map: TEX.gravel, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const sd of [1, -1]) { const keepG = r => W.grav[r] === sd && W.grav[(r + 1) % n] === sd; ribbon(sd > 0 ? hw + 1.5 : -hw - 17, sd > 0 ? hw + 17 : -hw - 1.5, 4, () => white, 0.035, keepG, false, gravM, 5); }
  if (W.real) buildTaipeiStreet(grp, ribbon, S); // Taiwanese road markings, kerbs, sidewalks, water barriers
  else {
    ribbon(k => W.hwL[k] - 0.45, k => W.hwL[k] - 0.15, 1, () => white, 0.07, null, false);
    ribbon(k => -W.hwR[k] + 0.15, k => -W.hwR[k] + 0.45, 1, () => white, 0.07, null, false);
    const kerbKeep = r => W.kerb[r] && W.kerb[(r + 1) % n], kerbCol = k => ((k >> 1) & 1) ? white : red;
    ribbon(hL, k => W.hwL[k] + 1.5, 1, kerbCol, 0.09, kerbKeep, true);
    ribbon(k => -W.hwR[k] - 1.5, hR, 1, kerbCol, 0.09, kerbKeep, true);
  }
  ribbon(hR, hL, 10, (k, q) => ((q + k) & 1) ? white : black, 0.1, r => r === 0 || r === 1, true);
  if (!W.real) ribbon(hR, hL, 1, () => green, 0.1, r => W.drs[r] && !W.drs[(r - 1 + n) % n], true);
  for (let gs = 1; gs <= 6; gs++) { // starting grid slots, staggered like a real grid
    const r0 = n - gs * 4, side = gs & 1 ? 1 : -1, wk = Math.min(W.hwL[r0], W.hwR[r0]);
    ribbon(side * Math.min(1.0, wk - 3), side * Math.min(4.6, wk - 0.4), 1, () => white, 0.1, r => r === r0, true);
  }
  // --- barriers: concrete + catch fence on street circuits; armco rails and tyre walls on road courses
  const vwall = (side, extra, y0, y1, mat, uScale, keep) => {
    const arr = side > 0 ? W.wallL : W.wallR;
    const g = ribbonGeo((push, I) => {
      const w = lin(0xffffff), idx = new Int32Array(n + 1).fill(-1);
      for (let r = 0; r <= n; r++) { const k = r % n; if (!isFinite(arr[k])) continue; const off = (arr[k] + extra) * side, x = X[k] + W.lx[k] * off, z = Z[k] + W.lz[k] * off, h = Hq(x, z); idx[r] = push(x, h + y0, z, S[r] / uScale, 0, w); push(x, h + y1, z, S[r] / uScale, 1, w); }
      for (let r = 0; r < n; r++) { const a = idx[r], b = idx[r + 1]; if (a < 0 || b < 0 || (keep && !keep(r))) continue; I.push(a, b, a + 1, a + 1, b, b + 1); }
    });
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; grp.add(m);
  };
  cornerMarkers(grp);
  if (W.real) waterBarriers(grp);
  else if (W.city) {
    const bm = new THREE.MeshStandardMaterial({ map: TEX.barrier, roughness: 0.8, side: THREE.DoubleSide });
    const fm = new THREE.MeshStandardMaterial({ map: TEX.fence, alphaTest: 0.4, transparent: false, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    for (const sd of [1, -1]) { vwall(sd, 0, -0.3, 1.05, bm, 32); vwall(sd, 0.15, 1.05, 4.2, fm, 3.2); }
  } else {
    const am = new THREE.MeshStandardMaterial({ map: TEX.armco, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide, envMapIntensity: 1 });
    const tm = new THREE.MeshStandardMaterial({ map: TEX.tyres, roughness: 0.9, side: THREE.DoubleSide });
    for (const sd of [1, -1]) {
      vwall(sd, 0, 0.35, 0.78, am, 4, r => W.grav[r] !== sd);
      vwall(sd, 0, -0.2, 1.0, tm, 2.2, r => W.grav[r] === sd);
    }
    // armco posts every 4 m
    const posts = []; for (let k = 0; k < n; k += Math.max(1, Math.round(4 / W.ds))) for (const sd of [1, -1]) { const a = (sd > 0 ? W.wallL : W.wallR)[k]; if (isFinite(a) && W.grav[k] !== sd) posts.push([k, sd, a]); }
    if (posts.length) {
      const pg = new THREE.BoxGeometry(0.1, 0.8, 0.12); pg.translate(0, 0.4, 0);
      const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: lin(0x6c7278), roughness: 0.5, metalness: 0.7 }), posts.length), mm4 = new THREE.Matrix4();
      posts.forEach(([k, sd, a], i) => { const off = (a + 0.12) * sd, x = X[k] + W.lx[k] * off, z = Z[k] + W.lz[k] * off; mm4.makeTranslation(x, Hq(x, z), z); pm.setMatrixAt(i, mm4); });
      grp.add(pm);
    }
  }
  // --- buildings (chunked so frustum culling works for both camera and shadow passes)
  const facM = [TEX.facA, TEX.facB, TEX.facC].map(t => new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: t === TEX.facB ? 0.25 : 0.85, metalness: t === TEX.facB ? 0.35 : 0, envMapIntensity: t === TEX.facB ? 1.1 : 0.3 }));
  const shopM = new THREE.MeshStandardMaterial({ map: TEX.shop, roughness: 0.8 }), roofM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const stand = standFrame();
  if (W.city && M.blds.length) { W.tiles = []; queueTiles(grp, M, X[0], Z[0]); } // Blender tiles: the start area at once, the rest a few at a time
  if (W.city && M.blds.length) defer(() => {
    const tile = 500, tiles = new Map(), pal = [0xffffff, 0xf2ece2, 0xe6ddd0, 0xdfe2e4, 0xd2cbbf, 0xf5efe6, 0xe9dccb, 0xd9dcdf].map(lin);
    const near = (x, z) => gridSample(D, x, z) < (isFinite(W.wall) ? W.wall + 3 : hw + 6) || stand.inside(x, z);
    const props = { tank: [], hut: [], shed: [] }, br = mulberry32(17);
    let kept = 0;
    M.blds.forEach((b, bi) => {
      const p = b.p, m = p.length / 2; let gx = 0, gz = 0;
      for (let i = 0; i < m; i++) { gx += p[i * 2]; gz += p[i * 2 + 1]; } gx /= m; gz /= m;
      if (near(gx, gz) || inTile(M, gx, gz)) return;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; if (near(p[i * 2], p[i * 2 + 1]) || near((p[i * 2] + p[j * 2]) / 2, (p[i * 2 + 1] + p[j * 2 + 1]) / 2)) return; }
      const key = Math.floor((gx + W.sx / 2) / tile) + ',' + Math.floor((gz + W.sz / 2) / tile);
      if (!tiles.has(key)) tiles.set(key, { F: [0, 1, 2].map(() => ({ P: [], U: [], C: [], I: [] })), S: { P: [], U: [], C: [], I: [] }, RP: [], RC: [], RI: [] });
      const T = tiles.get(key), hsh = (bi * 2654435761) >>> 0, tint = pal[hsh % pal.length];
      const fam = b.h > 42 ? (hsh % 3 === 0 ? 2 : 1) : b.h > 24 ? [0, 2, 1][hsh % 3] : (hsh % 5 === 0 ? 2 : 0), F = T.F[fam];
      let base = Infinity; for (let i = 0; i < m; i++) base = Math.min(base, Hq(p[i * 2], p[i * 2 + 1]));
      const top = Hq(gx, gz) + b.h; base -= 0.4;
      const shopTop = fam === 1 || b.h < 7 ? base : Math.min(top - 2, base + 4.6);
      // orient ring counter-clockwise (seen from above) so wall normals face out
      let area = 0; for (let i = 0; i < m; i++) { const j = (i + 1) % m; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
      const ord = area < 0 ? [...Array(m).keys()] : [...Array(m).keys()].reverse();
      let per = 0;
      for (let q = 0; q < m; q++) {
        const i = ord[q], j = ord[(q + 1) % m], x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1], L = Math.hypot(x1 - x0, z1 - z0);
        const quad = (Q, yb, yt, vb, vt, us) => { const v0 = Q.P.length / 3; Q.P.push(x0, yb, z0, x1, yb, z1, x0, yt, z0, x1, yt, z1); Q.U.push(per / us, vb, (per + L) / us, vb, per / us, vt, (per + L) / us, vt); for (let r = 0; r < 4; r++) Q.C.push(tint.r, tint.g, tint.b); Q.I.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2); };
        if (shopTop > base) quad(T.S, base, shopTop, 0, 1, 12);
        quad(F, shopTop, top, 0, (top - shopTop) / 13.2, 12);
        per += L;
      }
      const contour = ord.map(i => new THREE.Vector2(p[i * 2], p[i * 2 + 1])), tris = THREE.ShapeUtils.triangulateShape(contour, []), r0 = T.RP.length / 3;
      const rc = lin([0x8e8b86, 0x7d7a75, 0x9a978f, 0x5f8a6a, 0x8a8f8f][hsh % 5]); // grey concrete, and the green waterproofing common on Taipei roofs
      contour.forEach(v => { T.RP.push(v.x, top, v.y); T.RC.push(rc.r, rc.g, rc.b); });
      tris.forEach(t => T.RI.push(r0 + t[0], r0 + t[2], r0 + t[1]));
      // rooftop clutter: water tanks, stair huts and tin-roof add-ons
      if (qLevel !== 'low') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < m; i++) { x0 = Math.min(x0, p[i * 2]); x1 = Math.max(x1, p[i * 2]); z0 = Math.min(z0, p[i * 2 + 1]); z1 = Math.max(z1, p[i * 2 + 1]); }
        const ang = Math.atan2(p[3] - p[1], p[2] - p[0]), span = Math.min(x1 - x0, z1 - z0);
        if (span > 6 && b.h < 60) {
          if (br() < 0.65) props.tank.push([gx + (br() - 0.5) * span * 0.4, top, gz + (br() - 0.5) * span * 0.4, 0.8 + br() * 0.5]);
          if (br() < 0.45) props.hut.push([gx + (br() - 0.5) * span * 0.3, top, gz + (br() - 0.5) * span * 0.3, ang]);
          if (b.h < 26 && br() < 0.3) props.shed.push([gx, top, gz, ang, span * 0.55]);
        }
      }
      kept++;
    });
    const quadMesh = (Q, mat) => { if (!Q.I.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Q.P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(Q.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Q.C, 3)); g.setIndex(Q.I); g.computeVertexNormals(); const wm = new THREE.Mesh(g, mat); wm.castShadow = wm.receiveShadow = true; grp.add(wm); };
    for (const T of tiles.values()) {
      T.F.forEach((Q, i) => quadMesh(Q, facM[i])); quadMesh(T.S, shopM);
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(T.RP, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(T.RC, 3)); rg.setIndex(T.RI); rg.computeVertexNormals();
      const rm = new THREE.Mesh(rg, roofM); rm.castShadow = rm.receiveShadow = true; grp.add(rm);
    }
    W.bldKept = kept;
    const inst = (list, geo, mat, set) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length), mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), vv = new THREE.Vector3(), ss = new THREE.Vector3(), ee = new THREE.Euler(); list.forEach((it, i) => { set(it, vv, ee, ss); qq.setFromEuler(ee); mm.compose(vv, qq, ss); im.setMatrixAt(i, mm); }); im.castShadow = im.receiveShadow = true; grp.add(im); };
    const tankG = new THREE.CylinderGeometry(0.75, 0.75, 1.4, 12); tankG.translate(0, 1.6, 0);
    inst(props.tank, tankG, new THREE.MeshStandardMaterial({ color: lin(0xd5d9dd), roughness: 0.3, metalness: 0.8 }), ([x, y, z, sc], v, e, sv) => { v.set(x, y, z); e.set(0, 0, 0); sv.set(sc, sc, sc); });
    const hutG = new THREE.BoxGeometry(3, 2.8, 2.6); hutG.translate(0, 1.4, 0);
    inst(props.hut, hutG, new THREE.MeshStandardMaterial({ color: lin(0xb9b4ab), roughness: 0.9 }), ([x, y, z, a], v, e, sv) => { v.set(x, y, z); e.set(0, -a, 0); sv.set(1, 1, 1); });
    const shedG = new THREE.BoxGeometry(1, 2.6, 1); shedG.translate(0, 1.3, 0);
    inst(props.shed, shedG, new THREE.MeshStandardMaterial({ color: lin(0x6f8796), roughness: 0.45, metalness: 0.6 }), ([x, y, z, a, w], v, e, sv) => { v.set(x, y, z); e.set(0, -a, 0); sv.set(w, 1, w * 0.8); });
  });
  if (!W.real) buildStands(grp, stand);
  // --- vegetation, street furniture and scenery
  defer(() => {
  const tr = mulberry32(42), m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), tc = new THREE.Color();
  const treeGeo = crossGeo(0.4), eu = new THREE.Euler();
  const placeTrees = (spots, broadleaf) => {
    const cnt = spots.length; if (!cnt) return;
    const mat = foliageMat(broadleaf ? TEX.treeBroad : TEX.treeCon), trees = new THREE.InstancedMesh(treeGeo, mat, cnt);
    trees.customDepthMaterial = mat.userData.depth;
    spots.forEach(([x, z, s, kind], i) => {
      const hgt = broadleaf ? 8.5 * s : 14 * s, wid = (broadleaf ? 8 * s : 6 * s) * (kind === 3 ? 0.55 : kind === 4 ? 0.7 : 1);
      sc.set(wid, hgt, wid); ps.set(x, Hq(x, z) - 0.3, z); eu.set(0, tr() * Math.PI, 0); q4.setFromEuler(eu); m4.compose(ps, q4, sc);
      trees.setMatrixAt(i, m4); tc.setHSL(0.22 + tr() * 0.08, 0.25, 0.42 + tr() * 0.2); trees.setColorAt(i, tc);
    });
    q4.identity(); trees.castShadow = true; trees.receiveShadow = true; grp.add(trees); return trees;
  };
  if (!W.city && qLevel !== 'low') { // grass tufts in the verges, kept out of the gravel and off the asphalt
    const cnt = qLevel === 'high' ? 18000 : 8000, tufts = new THREE.InstancedMesh(crossGeo(0.85), frontLit(new THREE.MeshLambertMaterial({ map: TEX.tuft, alphaTest: 0.5, side: THREE.DoubleSide })), cnt);
    let i = 0;
    for (let tries = 0; tries < cnt * 2 && i < cnt; tries++) {
      const k = Math.floor(tr() * n), sd = tr() < 0.5 ? 1 : -1, lat = sd * (hw + 2.5 + Math.pow(tr(), 1.6) * 30);
      if (W.grav[k] === sd && Math.abs(lat) < hw + 18) continue;
      const wl = (sd > 0 ? W.wallL : W.wallR)[k]; if (Math.abs(Math.abs(lat) - wl) < 1) continue;
      const x = X[k] + W.lx[k] * lat, z = Z[k] + W.lz[k] * lat; if (gridSample(D, x, z) < hw + 2) continue;
      const s2 = 0.5 + tr() * 0.6; sc.set(s2 * 0.9, s2 * 0.38, s2 * 0.9); ps.set(x, Hq(x, z) - 0.03, z); eu.set(0, tr() * Math.PI, 0); q4.setFromEuler(eu); m4.compose(ps, q4, sc);
      tufts.setMatrixAt(i, m4); tc.setHSL(0.2 + tr() * 0.06, 0.3, 0.62 + tr() * 0.2); tufts.setColorAt(i, tc); i++;
    }
    tufts.count = i; q4.identity(); grp.add(tufts);
  }
  if (W.real) {
    const street = [], park = [], occ = M.occ, HWg = W.hwGrid;
    const free = (x, z) => { const i = Math.floor((x + W.sx / 2) / occ.cs), j = Math.floor((z + W.sz / 2) / occ.cs); return i >= 0 && j >= 0 && i < occ.rw && j < occ.rh && !occ.a[j * occ.rw + i]; };
    for (const [x, z, pk, kind, h] of M.env.trees) {
      if (Math.abs(x) > W.sx / 2 - 4 || Math.abs(z) > W.sz / 2 - 4 || !free(x, z)) continue;
      if (gridSample(D, x, z) < gridSample(HWg, x, z) + 1.4) continue; // keep the carriageway and barrier line clear
      (pk ? park : street).push([x, z, h / 9, kind]); // surveyed height; the stand-in card is 8.5 m at scale 1
    }
    const MODEL = ['tree_camphor', 'tree_banyan', 'tree_luan', 'tree_palm', 'tree_tall'], NATIVE_H = [9.5, 8.5, 9.0, 9.8, 10.5];
    const placeCards = spots => { // side views of the same models on crossed cards; the near range swaps in the models
      const cnt = spots.length; if (!cnt) return;
      const g = crossGeo(0.4), cellA = new THREE.InstancedBufferAttribute(new Float32Array(cnt), 1); g.setAttribute('aCell', cellA);
      const mat = atlasFoliage(TREE_ATLAS.tex, TREE_ATLAS.cols), cards = new THREE.InstancedMesh(g, mat, cnt); cards.customDepthMaterial = mat.userData.depth;
      spots.forEach(([x, z, s, kind], i) => {
        const side = TREE_ATLAS.size[MODEL[kind]] * s * 9 / NATIVE_H[kind];
        sc.set(side, side, side); ps.set(x, Hq(x, z) - 0.2, z); eu.set(0, tr() * Math.PI, 0); q4.setFromEuler(eu); m4.compose(ps, q4, sc);
        cards.setMatrixAt(i, m4); cellA.setX(i, kind); tc.setHSL(0.25, 0.1, 0.45 + tr() * 0.1).multiplyScalar(2.1); cards.setColorAt(i, tc);
      });
      q4.identity(); cards.castShadow = true; cards.receiveShadow = true; grp.add(cards); return cards;
    };
    const atlas = TREE_ATLAS && PROPS && PROPS.tree_camphor;
    const fs = atlas ? placeCards(street) : placeTrees(street, true), fp = atlas ? placeCards(park) : placeTrees(park, true);
    if (PROPS && PROPS.tree_camphor) { // the species group of each surveyed tree picks its model
      const lr = mulberry32(8), kinds = {}; for (const k of MODEL) if (PROPS[k]) kinds[k] = PROPS[k];
      const mk = (x, z, s, kind) => { const h = s * 9, f = h / NATIVE_H[kind]; eu.set(0, lr() * Math.PI * 2, 0); q4.setFromEuler(eu); return new THREE.Matrix4().compose(new THREE.Vector3(x, Hq(x, z) - 0.2, z), q4.clone(), new THREE.Vector3(f, f, f)); };
      const tint = () => new THREE.Color().setHSL(0.25, 0.1, 0.45 + lr() * 0.1).multiplyScalar(2.1);
      // ~3500 triangles a model: the cards past this range carry the same silhouettes, so the near set can stay small
      const cap = COARSE ? 150 : 600, R = COARSE ? 70 : 160, item = ([x, z, s, kind]) => { const k = kinds[MODEL[kind]] ? kind : 0; return { m: mk(x, z, s, k), kind: MODEL[k], c: tint() }; };
      if (fs) nearLod(grp, fs, street.map(item), kinds, cap, R);
      if (fp) nearLod(grp, fp, park.map(item), kinds, cap >> 1, R);
      q4.identity();
    }
    taipeiScenery(grp);
    if (W.M.skyline) skylineImpostors(grp, W.M.skyline);
  }
  if (W.city && !W.real) {
    const spots = [], occ = M.occ, free = (x, z) => { const i = Math.floor((x + W.sx / 2) / occ.cs), j = Math.floor((z + W.sz / 2) / occ.cs); return i >= 0 && j >= 0 && i < occ.rw && j < occ.rh && !occ.a[j * occ.rw + i]; };
    for (const r of M.roads) {
      if (r.c > 3) continue; const pts = r.p, off = ROAD_W[r.c] / 2 + 2.2;
      for (let i = 0; i + 1 < pts.length / 2; i++) {
        const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3], L = Math.hypot(x1 - x0, z1 - z0); if (L < 1) continue;
        const lx = (z1 - z0) / L, lz = -(x1 - x0) / L;
        for (let s = tr() * 12; s < L; s += 11 + tr() * 4) for (const sd of [1, -1]) {
          const x = x0 + (x1 - x0) * s / L + lx * off * sd, z = z0 + (z1 - z0) * s / L + lz * off * sd;
          if (!free(x, z) || gridSample(D, x, z) < (isFinite(W.wall) ? W.wall + 2 : hw + 4) || Math.abs(x) > W.sx / 2 - 5 || Math.abs(z) > W.sz / 2 - 5) continue;
          const mk = M.mask[Math.round((z + W.sz / 2) / cz) * NX + Math.round((x + W.sx / 2) / cx)]; if (mk === 0) continue;
          spots.push([x, z, 0.8 + tr() * 0.4]); if (spots.length > 5000) break;
        }
      }
    }
    placeTrees(spots, true);
  }
  if (W.city) {
    // street lights along the circuit
    const lamps = [], lampG = new THREE.CylinderGeometry(0.09, 0.12, 9, 6); lampG.translate(0, 4.5, 0);
    const headG = new THREE.BoxGeometry(1.6, 0.2, 0.4); headG.translate(0.7, 9, 0);
    for (let k = 0; k < n; k += Math.round(38 / W.ds)) for (const sd of [1, -1]) { const hs = sd > 0 ? W.hwL[k] : W.hwR[k], x = X[k] + W.lx[k] * (hs + 2) * sd, z = Z[k] + W.lz[k] * (hs + 2) * sd; if (!W.real || (gridSample(D, x, z) > hs + 1 && !onDeck(k))) lamps.push([k, sd]); }
    const poles = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: lin(0x5d6166), roughness: 0.5, metalness: 0.7 }), lamps.length);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: lin(0x4a4d52), roughness: 0.5, metalness: 0.5, emissive: lin(0x333020) }), lamps.length);
    const e = new THREE.Euler();
    lamps.forEach(([k, sd], i) => { const off = W.real ? (sd > 0 ? W.hwL[k] : W.hwR[k]) + 2.4 : (isFinite(W.wall) ? W.wall : (sd > 0 ? W.hwL[k] : W.hwR[k])) + 1.6, x = X[k] + W.lx[k] * off * sd, z = Z[k] + W.lz[k] * off * sd; ps.set(x, Hq(x, z), z); e.set(0, Math.atan2(W.lz[k] * sd, -W.lx[k] * sd), 0); q4.setFromEuler(e); sc.set(1, 1, 1); m4.compose(ps, q4, sc); poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4); });
    poles.castShadow = heads.castShadow = true; q4.identity();
    { // pools of lamp light on the road, shown after dusk: a soft additive disc under each lamp head
      const glow = canvasTex(128, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, true, false);
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      const pools = W.lampPools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: glow, color: lin(0xffd59a), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }), lamps.length);
      lamps.forEach(([k, sd], i) => { const off = (W.real ? (sd > 0 ? W.hwL[k] : W.hwR[k]) + 2.4 : (isFinite(W.wall) ? W.wall : (sd > 0 ? W.hwL[k] : W.hwR[k])) + 1.6) - 2.3, x = X[k] + W.lx[k] * off * sd, z = Z[k] + W.lz[k] * off * sd; ps.set(x, Sq(x, z, k) + 0.09, z); sc.set(14, 1, 14); m4.compose(ps, q4, sc); pools.setMatrixAt(i, m4); });
      sc.set(1, 1, 1); pools.visible = false; pools.renderOrder = 2; grp.add(pools);
    }
    if (PROPS && PROPS.street_lamp) { // Blender lamp: same transforms, arm along local +x over the road
      for (const { g, m } of PROPS.street_lamp) { const im = new THREE.InstancedMesh(g, m, lamps.length); for (let i = 0; i < lamps.length; i++) { poles.getMatrixAt(i, m4); im.setMatrixAt(i, m4); } im.castShadow = true; im.userData.keep = true; grp.add(im); }
    } else grp.add(poles, heads);
  } else {
    const spots = [];
    for (let tries = 0; tries < 40000 && spots.length < (qLevel === 'low' ? 1500 : 3200); tries++) {
      const x = (tr() - 0.5) * W.sx * 0.98, z = (tr() - 0.5) * W.sz * 0.98;
      if (gridSample(D, x, z) < hw + 24) continue; normalAt(x, z, nrm); if (nrm.y < 0.8) continue;
      if ((Hq(x, z) - lo) / (hi - lo + 1e-6) > 0.82 && hi - lo > 150) continue;
      spots.push([x, z, 0.75 + tr() * 0.6]);
    }
    const broad = spots.filter((_, i) => i % 3 === 0), con = spots.filter((_, i) => i % 3 !== 0);
    placeTrees(broad, true); placeTrees(con, false);
  }
  if (W.lampPools) applyAtmo(); // the lamp pools exist now: night visibility
  });
  // --- start gantry
  const gm = new THREE.MeshStandardMaterial({ color: lin(0x2b3038), roughness: 0.5, metalness: 0.6 }), fx = -W.lz[0], fz = W.lx[0], gw = (isFinite(W.wall) ? W.wall : hw + 3);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), gm), x = X[0] + W.lx[0] * gw * s, z = Z[0] + W.lz[0] * gw * s; post.position.set(x, Hq(x, z) + 3.5, z); post.castShadow = true; grp.add(post); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, gw * 2 + 0.5), gm); beam.position.set(X[0], W.h[0] + 7, Z[0]); beam.rotation.y = Math.atan2(-fz, fx); beam.castShadow = true; grp.add(beam);
}

/* ================= Car model ================= */
// loft: smooth body from rounded-rectangle cross sections ordered front → back: [x, width, height, yCentre, zCentre]
function loft(secs, seg = 24, e = 3) {
  const P = [], I = [], ring = (x, w, h, yc, zc) => { const r = []; for (let i = 0; i < seg; i++) { const t = i / seg * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); r.push(x, yc + h / 2 * Math.sign(s) * Math.pow(Math.abs(s), 2 / e), zc + w / 2 * Math.sign(c) * Math.pow(Math.abs(c), 2 / e)); } return r; };
  secs.forEach(([x, w, h, yc, zc = 0]) => P.push(...ring(x, w, h, yc, zc)));
  for (let a = 0; a < secs.length - 1; a++) for (let i = 0; i < seg; i++) { const i2 = (i + 1) % seg, p0 = a * seg + i, p1 = a * seg + i2, p2 = (a + 1) * seg + i, p3 = (a + 1) * seg + i2; I.push(p0, p1, p2, p1, p3, p2); }
  for (const [end, sign] of [[0, 1], [secs.length - 1, -1]]) { // caps
    const [x, w, h, yc, zc = 0] = secs[end], b = P.length / 3; P.push(x, yc, zc); P.push(...ring(x, w, h, yc, zc));
    for (let i = 0; i < seg; i++) { const i2 = (i + 1) % seg; if (sign > 0) I.push(b, b + 1 + i2, b + 1 + i); else I.push(b, b + 1 + i, b + 1 + i2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
const SPEC = {
  m: 850, Iz: 1100, L: 3.6, a: 1.944, b: 1.656, h: 0.30, rw: 0.36,
  ratios: [17.1, 12.5, 9.87, 8.15, 6.93, 6.15, 5.43, 4.79], rev: -15, eta: 0.92,
  Pmax: 760000, idle: 4000, limiter: 15000, upAt: 11900, maxBrake: 72000,
};
function buildCar(color, ghost, lite) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const ghostM = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.26, depthWrite: false });
  const std = o => ghost ? ghostM : new THREE.MeshStandardMaterial(o);
  const paint = ghost ? ghostM : new THREE.MeshPhysicalMaterial({ color: lin(color).multiplyScalar(0.72), roughness: 0.5, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.35 });
  const carbon = std({ color: lin(0x121417), roughness: 0.38, metalness: 0.35 }), satin = std({ color: lin(0x1d2025), roughness: 0.6, metalness: 0.2 });
  const white = std({ color: lin(0xf1f1f1), roughness: 0.35, metalness: 0.1 }), tyreM = std({ color: lin(0x1a1a1a), roughness: 0.92, metalness: 0 });
  const helmetM = std({ color: lin(0xffd23f), roughness: 0.25, metalness: 0.2 }), visor = std({ color: lin(0x0b0d10), roughness: 0.05, metalness: 0.9 });
  const soft = std({ color: lin(0xd8262c), roughness: 0.6 }), rimM = std({ color: lin(0x2a2d31), roughness: 0.3, metalness: 0.85 });
  const bright = new THREE.Color(color).getHSL({}).l > 0.6, accent = std({ color: lin(bright ? 0x1b1d22 : 0xf2f2f2), roughness: 0.35, metalness: 0.15 });
  if (!ghost) { // soft contact shadow so the car sits on the road even outside the shadow map
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.7), new THREE.MeshBasicMaterial({ map: TEX.contact, transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    cs.rotation.x = -Math.PI / 2; cs.position.set(-0.1, 0.035, 0); cs.renderOrder = 1; root.add(cs);
  }
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = !ghost && !lite; parent.add(m); return m; };
  const D = (...a) => lite ? null : add(...a); // detail parts skipped on opponents' cars
  // floor & plank
  const floor = new THREE.Shape([[2.0, 0.42], [1.2, 0.72], [-1.6, 0.8], [-2.05, 0.55], [-2.05, -0.55], [-1.6, -0.8], [1.2, -0.72], [2.0, -0.42]].map(([x, z]) => new THREE.Vector2(x, z)));
  const fg = new THREE.ExtrudeGeometry(floor, { depth: 0.035, bevelEnabled: false }); fg.rotateX(Math.PI / 2); add(fg, carbon, 0, 0.1, 0);
  // monocoque + nose
  add(loft([[3.02, 0.14, 0.09, 0.25], [2.75, 0.22, 0.15, 0.27], [2.3, 0.32, 0.24, 0.31], [1.8, 0.42, 0.32, 0.36], [1.25, 0.54, 0.4, 0.41], [0.8, 0.66, 0.46, 0.44], [0.3, 0.76, 0.48, 0.43], [-0.25, 0.8, 0.46, 0.41], [-0.45, 0.6, 0.36, 0.39]]), paint);
  // cockpit rim + driver
  add(loft([[0.62, 0.5, 0.06, 0.66], [0.05, 0.56, 0.06, 0.66], [-0.08, 0.36, 0.05, 0.66]], 16, 2.2), satin);
  add(new THREE.SphereGeometry(0.135, 20, 14), helmetM, 0.14, 0.75, 0);
  add(new THREE.SphereGeometry(0.137, 16, 8, Math.PI - 0.9, 1.8, 1.1, 0.55), visor, 0.14, 0.75, 0);
  // engine cover with airbox and shark fin
  add(loft([[0.08, 0.26, 0.22, 0.86], [-0.15, 0.4, 0.42, 0.78], [-0.6, 0.56, 0.62, 0.64], [-1.1, 0.56, 0.5, 0.56], [-1.6, 0.42, 0.36, 0.48], [-2.05, 0.24, 0.22, 0.42], [-2.4, 0.12, 0.12, 0.4]]), paint);
  D(loft([[0.1, 0.2, 0.14, 0.88], [0.04, 0.16, 0.1, 0.88]], 16, 2.5), satin); // intake mouth
  const fin = new THREE.Shape([new THREE.Vector2(-0.3, 0), new THREE.Vector2(-1.9, 0), new THREE.Vector2(-1.9, 0.22), new THREE.Vector2(-0.5, 0.06)]);
  const fing = new THREE.ExtrudeGeometry(fin, { depth: 0.015, bevelEnabled: false }); fing.translate(0, 0, -0.0075); add(fing, accent, 0, 0.9, 0);
  for (const s of [-1, 1]) {
    // sidepods with undercut
    add(loft([[0.42, 0.3, 0.3, 0.42, s * 0.56], [0.2, 0.42, 0.4, 0.42, s * 0.6], [-0.4, 0.42, 0.38, 0.4, s * 0.58], [-1.1, 0.3, 0.28, 0.34, s * 0.5], [-1.7, 0.16, 0.16, 0.3, s * 0.4]]), paint);
    add(new THREE.BoxGeometry(0.03, 0.24, 0.26), satin, 0.43, 0.43, s * 0.56);
    // mirrors
    D(new THREE.BoxGeometry(0.05, 0.07, 0.16), paint, 0.5, 0.68, s * 0.5);
    D(new THREE.BoxGeometry(0.02, 0.02, 0.14), carbon, 0.5, 0.64, s * 0.4);
    // front wing endplates
    add(new THREE.BoxGeometry(0.62, 0.28, 0.025), carbon, 2.72, 0.2, s * 0.97);
    // rear wing endplates
    const ep = new THREE.Shape([new THREE.Vector2(-2.0, 0.45), new THREE.Vector2(-2.7, 0.45), new THREE.Vector2(-2.7, 1.05), new THREE.Vector2(-2.12, 1.05)]);
    const epg = new THREE.ExtrudeGeometry(ep, { depth: 0.022, bevelEnabled: false }); epg.translate(0, 0, s * 0.5 - 0.011); add(epg, carbon);
    // wishbones
    if (!lite) for (const [ax, wz, wy] of [[SPEC.a, 0.8, 0.4], [SPEC.a, 0.8, 0.26], [-SPEC.b, 0.76, 0.42], [-SPEC.b, 0.76, 0.26]]) {
      const len = wz - 0.32, arm = add(new THREE.CylinderGeometry(0.018, 0.018, len, 6), carbon, ax, wy, s * (0.32 + len / 2)); arm.rotation.x = Math.PI / 2;
    }
  }
  // front wing: main plane + two flaps
  add(new THREE.BoxGeometry(0.42, 0.025, 1.92), carbon, 2.78, 0.1, 0);
  const f1 = add(new THREE.BoxGeometry(0.26, 0.02, 1.86), accent, 2.62, 0.155, 0); f1.rotation.z = -0.18;
  const f2 = add(new THREE.BoxGeometry(0.18, 0.018, 1.8), white, 2.5, 0.215, 0); f2.rotation.z = -0.35;
  for (const s of [-1, 1]) D(new THREE.BoxGeometry(0.3, 0.12, 0.02), carbon, 2.7, 0.16, s * 0.12);
  // rear wing, beam wing, diffuser
  add(new THREE.BoxGeometry(0.4, 0.04, 1.0), accent, -2.4, 0.88, 0);
  const flap = new THREE.Group(); flap.position.set(-2.16, 0.99, 0); body.add(flap);
  add(new THREE.BoxGeometry(0.26, 0.03, 0.98), white, -0.12, 0, 0, flap);
  D(new THREE.BoxGeometry(0.24, 0.025, 0.86), carbon, -2.3, 0.5, 0);
  if (!lite) add(new THREE.BoxGeometry(0.08, 0.5, 0.04), carbon, -2.25, 0.66, 0).rotation.z = 0.35;
  const dif = add(new THREE.BoxGeometry(0.5, 0.025, 1.05), carbon, -2.15, 0.18, 0); dif.rotation.z = 0.28;
  for (let i = -2; i <= 2; i++) D(new THREE.BoxGeometry(0.46, 0.12, 0.012), carbon, -2.14, 0.22, i * 0.22);
  // halo
  const halo = new THREE.CatmullRomCurve3([[-0.08, 0.58, -0.34], [-0.02, 0.84, -0.31], [0.3, 0.9, -0.26], [0.55, 0.88, 0], [0.3, 0.9, 0.26], [-0.02, 0.84, 0.31], [-0.08, 0.58, 0.34]].map(p => new THREE.Vector3(...p)));
  add(new THREE.TubeGeometry(halo, 40, 0.026, 8, false), satin);
  D(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.78, 0.58, 0), new THREE.Vector3(0.66, 0.78, 0), new THREE.Vector3(0.55, 0.88, 0)]), 10, 0.022, 8, false), satin);
  // T-camera and rain light
  D(new THREE.BoxGeometry(0.1, 0.05, 0.08), white, -0.05, 1.0, 0);
  const light = add(new THREE.BoxGeometry(0.04, 0.08, 0.14), ghost ? ghostM : new THREE.MeshBasicMaterial({ color: 0xff2020 }), -2.62, 0.33, 0);
  // wheels: lathed tyre profile, rim, aero cover and compound band
  const wheels = [];
  for (const [x, w] of [[SPEC.a, 0.37], [-SPEC.b, 0.44]]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(x, SPEC.rw, s * (1.0 - w / 2)); root.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const R = SPEC.rw, prof = [[0.23, -w / 2], [0.32, -w / 2], [R - 0.008, -w / 2 + 0.03], [R, -w / 2 + 0.08], [R, w / 2 - 0.08], [R - 0.008, w / 2 - 0.03], [0.32, w / 2], [0.23, w / 2]].map(([r, y]) => new THREE.Vector2(r, y));
    const tg = new THREE.LatheGeometry(prof, lite ? 18 : 36); tg.rotateX(Math.PI / 2); add(tg, tyreM, 0, 0, 0, spin);
    const rim = new THREE.CylinderGeometry(0.235, 0.235, w - 0.03, 24, 1, true); rim.rotateX(Math.PI / 2); add(rim, rimM, 0, 0, 0, spin);
    const cover = new THREE.CircleGeometry(0.235, 24); const cv = add(cover, carbon, 0, 0, s * (w / 2 - 0.01), spin); cv.rotation.y = s > 0 ? 0 : Math.PI;
    D(new THREE.TorusGeometry(0.29, 0.012, 4, 36), soft, 0, 0, s * (w / 2 + 0.001), spin);
    const mark = D(new THREE.BoxGeometry(0.2, 0.04, 0.005), white, 0.12, 0, s * (w / 2 - 0.005), spin);
    wheels.push({ pivot, spin, front: x > 0, mark });
  }
  if (ghost) root.traverse(o => { o.castShadow = false; });
  // one draw call per material instead of one per part; parts the frame loop moves stay separate
  const keep = new Set([flap, light]); mergeParts(body, keep);
  for (const w of wheels) { if (w.mark) keep.add(w.mark); mergeParts(w.spin, keep); }
  return { root, body, wheels, flap, light };
}
function mergeParts(group, keep) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), m = new THREE.Matrix4(), byMat = new Map();
  group.traverse(o => {
    if (!o.isMesh || keep.has(o)) return;
    for (let q = o.parent; q !== group; q = q.parent) if (keep.has(q)) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(o);
  });
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const P = [], Nn = [], I = [];
    for (const o of list) {
      const g = o.geometry.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)), pos = g.attributes.position, nor = g.attributes.normal, b = P.length / 3;
      for (let i = 0; i < pos.count; i++) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); Nn.push(nor.getX(i), nor.getY(i), nor.getZ(i)); }
      if (g.index) for (let i = 0; i < g.index.count; i++) I.push(b + g.index.getX(i)); else for (let i = 0; i < pos.count; i++) I.push(b + i);
      g.dispose(); o.geometry.dispose(); o.parent.remove(o);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setIndex(I);
    const mm = new THREE.Mesh(g, mat); mm.castShadow = list[0].castShadow; mm.receiveShadow = list[0].receiveShadow; group.add(mm);
  }
}

/* ================= Car state & physics ================= */
const setup = { level: 'easy', mode: 'solo', laps: 3, aiCount: 5, aiSkill: 0.45, map: 'terrain', width: 14, banking: true, walls: false, steerSens: 0.8, assist: true, steerMode: 'drag', autogas: false, quality: 'auto', aero: 0.5, bias: 57, tc: true, abs: true, auto: true, esc: true, brakeAssist: true, color: '#d7263d', reverse: false };
// calibrated against 2024 F1 qualifying laps (OpenF1 telemetry, tools/f1/): ~310 km/h flat out, 0.7 g at 270 km/h, ~5.5 g fast corners
const aeroOf = a => ({ CdA: 1.25 + a * 0.7, ClA: 3.6 + a * 2.4, front: 0.42 });
const car = {};
let carModel = buildCar(setup.color, false); scene.add(carModel.root); scene.add(RAIN.mesh);
let ghostModel = buildCar(0xffffff, true); scene.add(ghostModel.root); ghostModel.root.visible = false;
const nrm = new THREE.Vector3(), fp = new THREE.Vector3(), lp = new THREE.Vector3();
const AMBIENT = 28; // °C track-side air

function powerCurve(rpm) {
  const T = [[4000, .32], [6000, .5], [8000, .7], [9500, .84], [10500, .93], [11500, 1], [12200, 1], [13500, .95], [15000, .86]];
  if (rpm <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (rpm <= T[i][0]) { const [r0, p0] = T[i - 1], [r1, p1] = T[i]; return p0 + (p1 - p0) * (rpm - r0) / (r1 - r0); }
  return T[T.length - 1][1];
}
const MF = (al, B) => { const x = B * al; return Math.sin(1.9 * Math.atan(x - 0.97 * (x - Math.atan(x)))); };
const loadSens = r => clamp(1 - 0.06 * (r - 1), 0.8, 1.04);
const tyreGrip = T => clamp(1 - 0.000045 * (T - 100) * (T - 100), 0.74, 1); // slicks work best near 100 °C

function trackLocate(x, z, hint) {
  const n = W.n; let best = hint, bd = Infinity;
  for (let o = -40; o <= 40; o++) { const k = (hint + o + n) % n, dx = x - W.x[k], dz = z - W.z[k], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
  if (bd > 60 * 60) for (let k = 0; k < n; k++) { const dx = x - W.x[k], dz = z - W.z[k], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
  return { k: best, lat: (x - W.x[best]) * W.lx[best] + (z - W.z[best]) * W.lz[best] };
}
function placeCar(k, lat = 0, keepTyres = false) {
  const n = W.n; k = (k + n) % n;
  const tf = keepTyres ? car.tf : 80, trr = keepTyres ? car.tr : 80;
  Object.assign(car, {
    x: W.x[k] + W.lx[k] * lat, z: W.z[k] + W.lz[k] * lat, psi: Math.atan2(-W.lx[k], -W.lz[k]), vx: 0, vy: 0, r: 0, delta: 0, steerUser: 0,
    gear: 1, rpm: SPEC.idle, shiftT: 0, k, lat, axs: 0, ays: 0, fzc: 0, wheelRot: 0, drs: false, revT: 0,
    thr: 0, brk: 0, aF: 0, aR: 0, Fzf: 0, Fzr: 0, down: 0, drag: 0, rho: 1.2, surf: 0, spin: false, lockF: false, tcAct: false, grade: 0, bankV: 0,
    tf, tr: trr, hit: 0,
  });
  car.y = Sq(car.x, car.z, car.k);
}

function physicsStep(dt, inp) {
  const c = car, sp = SPEC, ae = aeroOf(setup.aero);
  const loc = trackLocate(c.x, c.z, c.k); c.k = loc.k; c.lat = loc.lat;
  const hw = (loc.lat > 0 ? W.hwL[loc.k] : W.hwR[loc.k]) + (W.apronL ? (loc.lat > 0 ? W.apronL : W.apronR)[loc.k] : 0), al = Math.abs(loc.lat); // + the beginners' corner apron
  const gs = W.grav[loc.k];
  const surf = al < hw ? 0 : (al < hw + 1.5 && W.kerb[loc.k]) ? 1 : (gs && Math.sign(loc.lat) === gs && al < hw + 17) ? 3 : 2; c.surf = surf;
  const off = surf === 2 && W.city; // city run-off is pavement, not grass
  const mu0 = [1.9 * ATMO.grip, 1.55 * ATMO.grip, off ? 1.05 : 0.85, 0.6][surf], crr = [0.012, 0.02, off ? 0.02 : 0.06, 0.18][surf];
  const h = Sq(c.x, c.z, loc.k); c.y = h; normalS(c.x, c.z, loc.k, nrm);
  const cp = Math.cos(c.psi), sn = Math.sin(c.psi);
  fp.set(cp, 0, -sn); fp.addScaledVector(nrm, -fp.dot(nrm)).normalize();
  lp.crossVectors(nrm, fp);
  const gtx = G * nrm.y * nrm.x, gty = -G + G * nrm.y * nrm.y, gtz = G * nrm.y * nrm.z;
  const gLong = gtx * fp.x + gty * fp.y + gtz * fp.z, gLat = gtx * lp.x + gty * lp.y + gtz * lp.z;
  c.grade = fp.y / Math.max(0.2, Math.hypot(fp.x, fp.z)); c.bankV = lp.y;
  const rho = 1.225 * Math.exp(-(W.base + h) / 8434); c.rho = rho;
  const v2 = c.vx * c.vx + c.vy * c.vy, spd = Math.sqrt(v2);
  const q = 0.5 * rho * v2, down = q * ae.ClA * (c.drs ? 0.84 : 1), drag = q * ae.CdA * (c.drs ? 0.80 : 1); c.down = down; c.drag = drag;
  // vertical curvature along heading: crests unload, compressions load the tyres
  const dd = 5, ko = Math.round(dd / W.ds), hA = onDeck(loc.k) ? W.deck[(loc.k + ko) % W.n] : Hq(c.x + cp * dd, c.z - sn * dd), hB = onDeck(loc.k) ? W.deck[(loc.k - ko + W.n) % W.n] : Hq(c.x - cp * dd, c.z + sn * dd);
  c.fzc += (sp.m * c.vx * c.vx * (hA - 2 * h + hB) / (dd * dd) - c.fzc) * Math.min(1, dt / 0.06);
  const Wn = Math.max(0, sp.m * G * nrm.y + c.fzc), tr = sp.m * c.axs * sp.h / sp.L;
  const Fzf = Math.max(0, Wn * sp.b / sp.L + down * ae.front - tr), Fzr = Math.max(0, Wn * sp.a / sp.L + down * (1 - ae.front) + tr);
  const fz0f = sp.m * G * sp.b / sp.L, fz0r = sp.m * G * sp.a / sp.L;
  const muF = mu0 * loadSens(Fzf / fz0f) * tyreGrip(c.tf), muR = mu0 * loadSens(Fzr / fz0r) * tyreGrip(c.tr);
  c.Fzf = Fzf; c.Fzr = Fzr;
  const cd = Math.cos(c.delta), sd = Math.sin(c.delta);
  const vyf = c.vy + sp.a * c.r, vyr = c.vy - sp.b * c.r;
  const vlonF = cd * c.vx + sd * vyf, vlatF = -sd * c.vx + cd * vyf;
  const aF = Math.atan(vlatF / Math.max(Math.abs(vlonF), 3)), aR = Math.atan(vyr / Math.max(Math.abs(c.vx), 3));
  c.aF = aF; c.aR = aR;
  // powertrain
  const rev = c.gear === -1, thr = rev ? inp.brk : inp.thr, brk = rev ? inp.thr : inp.brk;
  c.thr = thr; c.brk = brk;
  const ratio = rev ? sp.rev : sp.ratios[c.gear - 1];
  let rpm = Math.abs(c.vx) / sp.rw * 60 / (2 * Math.PI) * Math.abs(ratio);
  const launch = (c.gear === 1 || rev) ? SPEC.idle + 5200 * thr : SPEC.idle;
  if (rpm < launch) rpm = launch;
  c.rpm += (rpm - c.rpm) * Math.min(1, dt * 25);
  if (c.shiftT > 0) c.shiftT -= dt;
  let Fdrive = 0;
  if (c.rpm < sp.limiter && c.shiftT <= 0 && thr > 0) {
    const P = sp.Pmax * powerCurve(c.rpm) * Math.pow(rho / 1.225, 0.25) * (rev ? 0.25 : 1), w = c.rpm * 2 * Math.PI / 60;
    Fdrive = thr * (P / w) * ratio * sp.eta / sp.rw;
  }
  const sv = Math.abs(c.vx) > 0.25 ? Math.sign(c.vx) : 0;
  const engBrake = -sv * (1 - thr) * 1800 * (c.rpm / 15000);
  let bF = brk * sp.maxBrake * setup.bias / 100, bR = brk * sp.maxBrake * (1 - setup.bias / 100);
  const capF = muF * Fzf, capR = muR * Fzr;
  // lateral force the tyres are currently asked for; ABS and TC leave room for it on the friction circle
  const dyF = muF * Fzf * Math.abs(MF(aF, 11)), dyR = muR * Fzr * Math.abs(MF(aR, 12));
  const roomF = Math.max(0.3 * capF, Math.sqrt(Math.max(0, (0.96 * capF) ** 2 - dyF * dyF)));
  const roomR = Math.max(0.3 * capR, Math.sqrt(Math.max(0, (0.96 * capR) ** 2 - dyR * dyR)));
  let lockF = false, spin = false; c.tcAct = false;
  if (setup.abs) { bF = Math.min(bF, roomF); bR = Math.min(bR, Math.max(0, roomR - Math.abs(engBrake))); }
  else if (bF > capF && sv) { lockF = true; bF = capF * 0.8; }
  let FxF = -sv * bF;
  let FxR = Fdrive - sv * bR + engBrake;
  // stability control: brake the outer front wheel against oversteer, the inner rear against understeer
  let Mesc = 0; c.escAct = false;
  if (setup.esc && c.vx > 5) {
    const ayMax = (muF * Fzf + muR * Fzr) / sp.m, rLim = 0.9 * ayMax / c.vx;
    const rRef = clamp(c.vx * Math.tan(c.delta) / sp.L, -rLim, rLim), beta = Math.atan2(c.vy, c.vx);
    const e = c.r - rRef, dir = Math.sign(c.r || rRef || 1), Mwant = -sp.Iz * (10 * e - 6 * beta);
    const over = e * dir > 0.03 || Math.abs(beta) > 0.05, under = e * dir < -0.08;
    if (over || under) {
      const front = Math.sign(Mwant) === -dir, cap = 0.5 * (front ? capF : capR), Fb = Math.min(Math.abs(Mwant) / 0.8, cap);
      if (front) FxF -= sv * Fb; else FxR -= sv * Fb;
      if (over && FxR > 0) FxR *= 0.4; // and cut the engine
      Mesc = Math.sign(Mwant) * Fb * 0.8; c.escAct = true;
    }
  }
  if (Math.abs(FxR) > capR) {
    if (Fdrive !== 0 && Math.sign(FxR) === Math.sign(Fdrive) && setup.tc) { FxR = Math.sign(FxR) * capR * 0.98; c.tcAct = true; }
    else if (spd > 0.5 || Fdrive !== 0) { FxR = Math.sign(FxR) * capR * 0.85; spin = true; }
  }
  // beginners' traction control keeps a wider margin (80 % of the rear grip), pros' runs to the limit
  const tcUse = setup.level === 'easy' ? 0.8 : 0.97, tcMax = Math.max(0.12 * capR, Math.sqrt(Math.max(0, (tcUse * capR) ** 2 - dyR * dyR)));
  if (setup.tc && Fdrive > 0 && FxR > tcMax) { FxR = tcMax; c.tcAct = true; spin = false; }
  c.spin = spin; c.lockF = lockF;
  let FyF = -muF * Fzf * MF(aF, 11), FyR = -muR * Fzr * MF(aR, 12);
  const latF = Math.sqrt(Math.max(0, capF * capF - FxF * FxF)) * (lockF ? 0.3 : 1);
  const latR = Math.sqrt(Math.max(0, capR * capR - FxR * FxR)) * (spin ? 0.35 : 1);
  FyF = clamp(FyF, -latF, latF); FyR = clamp(FyR, -latR, latR);
  // tyre temperature: sliding power heats the rubber, airflow cools it (≈30 kJ/K per axle pair)
  const pF = Math.abs(FyF) * spd * Math.abs(Math.sin(aF)) + Math.abs(FxF) * (lockF ? spd : 0.03 * spd);
  const pR = Math.abs(FyR) * spd * Math.abs(Math.sin(aR)) + Math.abs(FxR) * (spin ? 5 + 0.2 * spd : c.tcAct ? 2.5 : 0.025 * spd);
  const cool = 0.0075 * (1 + spd / 25);
  c.tf += (pF / 30000 - cool * (c.tf - AMBIENT)) * dt; c.tr += (pR / 30000 - cool * (c.tr - AMBIENT)) * dt;
  // resistances
  const Froll = sv * crr * (Fzf + Fzr);
  const Fdx = spd > 0.01 ? -drag * c.vx / spd : 0, Fdy = spd > 0.01 ? -drag * c.vy / spd : 0;
  const grass = surf === 2 && !off ? 0.045 * sp.m : surf === 3 ? 0.2 * sp.m : 0;
  const Mz = sp.a * (FxF * sd + FyF * cd) - sp.b * FyR + Mesc;
  const Fx = FxR + FxF * cd - FyF * sd + Fdx - Froll - grass * c.vx + sp.m * gLong;
  const Fy = FyR + FxF * sd + FyF * cd + Fdy - grass * c.vy + sp.m * gLat;
  c.vx += (Fx / sp.m + c.vy * c.r) * dt;
  c.vy += (Fy / sp.m - c.vx * c.r) * dt;
  c.r += Mz / sp.Iz * dt;
  if (spd < 4) { const k = 1 - spd / 4; c.r += (c.vx * Math.tan(c.delta) / sp.L - c.r) * k * Math.min(1, dt * 12); c.vy *= 1 - k * Math.min(1, dt * 8); }
  if (brk > 0.05 && Math.abs(c.vx) < 0.3 && Fdrive === 0) { c.vx *= 0.8; c.vy *= 0.8; c.r *= 0.8; }
  c.axs += ((Fx - sp.m * gLong) / sp.m - c.axs) * Math.min(1, dt * 20);
  c.ays += ((Fy - sp.m * gLat) / sp.m - c.ays) * Math.min(1, dt * 20);
  c.psi += c.r * dt;
  const dx = (c.vx * fp.x + c.vy * lp.x) * dt, dz = (c.vx * fp.z + c.vy * lp.z) * dt;
  c.x += dx; c.z += dz;
  // barrier contact: reflect the velocity component into the wall, scrub speed. The barrier is the continuous line through
  // the barrier points of consecutive samples (wallContact), measured where the car is now: at a sharp junction corner the
  // nearest sample's own sideways offset used to jump between the two legs and shove the car 2-4 m in one step
  // On the inside of a bend that line folds back on itself, so there the nearest sample's sideways offset is used as before.
  const wc = wallContact(c.x, c.z, loc.k, loc.lat + dx * W.lx[loc.k] + dz * W.lz[loc.k]);
  if (wc && wc.d < 1.0) {
    const Lx = -wc.nx, Lz = -wc.nz, s = 1, e = 1.0 - wc.d; // L: outward normal of the barrier line at the contact
    c.x += wc.nx * e; c.z += wc.nz * e;
    let Vx = c.vx * fp.x + c.vy * lp.x, Vz = c.vx * fp.z + c.vy * lp.z;
    const vn = Vx * Lx + Vz * Lz;
    if (vn * s > 0) { // glancing contact: kill the inward speed, keep most of the speed along the wall, turn the nose back to the track
      Vx -= 1.12 * vn * Lx; Vz -= 1.12 * vn * Lz;
      const scrub = 1 - Math.min(0.22, 0.015 * Math.abs(vn)); Vx *= scrub; Vz *= scrub;
      const tf = Math.atan2(-W.lx[loc.k], -W.lz[loc.k]);
      let dpsi = tf - c.psi; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi)); if (Math.abs(dpsi) < Math.PI / 2) c.psi += dpsi * 0.35;
      const cp2 = Math.cos(c.psi), sn2 = Math.sin(c.psi), fx2 = cp2, fz2 = -sn2, lx2 = -sn2, lz2 = -cp2;
      c.vx = Vx * fx2 + Vz * fz2; c.vy = Vx * lx2 + Vz * lz2; c.r *= 0.3;
      c.hit = Math.max(c.hit, Math.abs(vn)); c.wallT = state.t; // raceUpdate clears hit every frame; autoRecover reads the time
    }
  }
  const limE = W.sx / 2 - 4, limZ = W.sz / 2 - 4;
  if (Math.abs(c.x) > limE || Math.abs(c.z) > limZ) { c.x = clamp(c.x, -limE, limE); c.z = clamp(c.z, -limZ, limZ); c.vx *= 0.3; c.vy = 0; c.r = 0; }
  c.wheelRot += c.vx / sp.rw * dt;
}

// Barrier on the side of the track the car is on (lat: its sideways offset from sample k). On the outside of a bend and on
// straights the barrier is the polyline through the barrier points of consecutive samples (gaps, wallL / wallR = Infinity,
// break it): continuous, so a car in the wedge outside a sharp junction corner is no longer measured against the wrong leg.
// On the inside of a bend (|kappa| > 1/150) the offset line folds back, so there it is the nearest sample's barrier offset.
// Returns { d: clearance from the barrier toward the track (negative: past it), nx / nz: unit normal back to the track,
// side: 1 left / -1 right } or null (no barrier there).
function wallContact(x, z, k, lat) {
  const n = W.n, side = lat >= 0 ? 1 : -1, kap = W.kappa[k];
  if (Math.sign(kap) === side && Math.abs(kap) > 1 / 150) {
    const off = side > 0 ? W.wallL[k] : W.wallR[k];
    return off < Infinity ? { d: off - Math.abs(lat), nx: -W.lx[k] * side, nz: -W.lz[k] * side, side } : null;
  }
  let best = null;
  for (const sd of [side]) {
    const arr = sd > 0 ? W.wallL : W.wallR;
    for (let o = -8; o < 8; o++) {
      const i = (k + o + n) % n, j = (i + 1) % n, a = arr[i], b = arr[j];
      if (!(a < Infinity) || !(b < Infinity)) continue;
      const ax = W.x[i] + W.lx[i] * a * sd, az = W.z[i] + W.lz[i] * a * sd, ex = W.x[j] + W.lx[j] * b * sd - ax, ez = W.z[j] + W.lz[j] * b * sd - az;
      const tx = W.x[j] - W.x[i], tz = W.z[j] - W.z[i];
      if (ex * tx + ez * tz < 0.3 * (tx * tx + tz * tz)) continue; // the inside of a sharp corner, where the barrier line folds back: its neighbours cover it
      const L2 = ex * ex + ez * ez || 1e-9, f = clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1), qx = ax + ex * f, qz = az + ez * f, dist = Math.hypot(x - qx, z - qz);
      if (best && dist >= best.dist) continue;
      let nx = -ez, nz = ex; const ln = Math.hypot(nx, nz) || 1; nx /= ln; nz /= ln;
      if (nx * (W.x[i] - qx) + nz * (W.z[i] - qz) < 0) { nx = -nx; nz = -nz; } // toward the centreline
      best = { d: (x - qx) * nx + (z - qz) * nz, nx, nz, dist, side: sd };
    }
  }
  return best;
}
function gearLogic(dt, inp) {
  const c = car, sp = SPEC, spd = Math.hypot(c.vx, c.vy);
  if (c.gear >= 1 && spd < 0.6 && inp.brk > 0.5 && inp.thr < 0.05) { c.revT += dt; if (c.revT > 0.6) { c.gear = -1; c.revT = 0; } } else if (c.gear >= 1) c.revT = 0;
  if (c.gear === -1 && inp.thr > 0.3 && c.vx > -0.6) c.gear = 1;
  if (c.gear < 1) return;
  if (setup.auto && c.shiftT <= 0) {
    if (c.gear < 8 && c.rpm > sp.upAt) { c.gear++; c.shiftT = 0.05; }
    else if (c.gear > 1 && c.rpm * sp.ratios[c.gear - 2] / sp.ratios[c.gear - 1] < 11000 && c.rpm < 10500) { c.gear--; c.shiftT = 0.04; }
  }
}
function shift(d) {
  const c = car; if (c.gear === -1) { if (d > 0) c.gear = 1; return; }
  const g = clamp(c.gear + d, 1, 8);
  if (d < 0 && c.rpm * SPEC.ratios[g - 1] / SPEC.ratios[c.gear - 1] > SPEC.limiter) return;
  if (g !== c.gear) { c.gear = g; c.shiftT = 0.05; }
}

/* ================= Input ================= */
const keys = {}, touch = { l: 0, r: 0, gas: 0, brake: 0, steer: 0, sActive: false }, inp = { thr: 0, brk: 0, steer: 0 };
let drsReq = false; const padPrev = {};
addEventListener('keydown', e => {
  if (!$('#setup').hidden || !$('#pause').hidden) { if (e.code === 'Escape' && state.mode !== 'menu0') resume(); return; }
  if (state.mode === 'preview' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { endPreview(); e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'Space') { drsReq = true; e.preventDefault(); }
  if (e.code === 'KeyE') shift(1);
  if (e.code === 'KeyQ') shift(-1);
  if (e.code === 'KeyC') nextCam();
  if (e.code === 'KeyR') resetToTrack();
  if (e.code === 'KeyM') { muted = !muted; banner(muted ? '音效關閉' : '音效開啟', 'info'); }
  if (e.code === 'Escape') openMenu();
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function readInput(dt) {
  let tK = (keys.ArrowUp || keys.KeyW || touch.gas) ? 1 : 0, bK = (keys.ArrowDown || keys.KeyS || touch.brake) ? 1 : 0;
  let sK = ((keys.ArrowLeft || keys.KeyA || touch.l) ? 1 : 0) - ((keys.ArrowRight || keys.KeyD || touch.r) ? 1 : 0);
  let analog = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0, rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
    if (Math.abs(ax) > 0.08 || rt > 0.05 || lt > 0.05) { analog = true; sK = -Math.sign(ax) * Math.pow(Math.max(0, Math.abs(ax) - 0.08) / 0.92, 1.4); tK = Math.max(tK, rt); bK = Math.max(bK, lt); }
    const pr = i => p.buttons[i] && p.buttons[i].pressed, was = i => padPrev[p.index + ':' + i];
    for (const i of [0, 1, 2, 3, 4, 5, 9]) { const now = pr(i); if (now && !was(i)) { if (i === 5 || i === 1) shift(1); if (i === 4 || i === 2) shift(-1); if (i === 0) drsReq = true; if (i === 3) camMode = (camMode + 1) % 3; if (i === 9) openMenu(); } padPrev[p.index + ':' + i] = now; }
  }
  if (touch.sActive) { const a = Math.abs(touch.steer); sK = Math.sign(touch.steer) * Math.pow(Math.max(0, a - 0.04) / 0.96, 1.25); }
  inp.uB = bK; // what the player pressed, before auto throttle and the brake assist
  if (setup.autogas && car.gear !== -1 && state.mode === 'race') tK = bK > 0 ? 0 : 1;
  if (RACE.done) { tK = 0; bK = 0.35; sK = 0; }
  if (analog) { inp.thr = tK; inp.brk = bK; }
  else { inp.thr += clamp(tK - inp.thr, -8 * dt, 5 * dt); inp.brk += clamp(bK - inp.brk, -10 * dt, 8 * dt); }
  inp.steer = sK;
  autoRecover(dt, inp); // automatic throttle: back off a barrier the car is stuck against
  // full lock is limited to what the tyres can use at this speed: Ackermann angle for the available lateral grip plus a small slip margin
  const spd = Math.hypot(car.vx, car.vy), aAvail = 1.7 * G * (1 + (car.down || 0) / (SPEC.m * G));
  const easy = setup.level === 'easy';
  const vmax = Math.min(0.3, SPEC.L * aAvail * (easy ? 0.85 : 1) / Math.max(spd * spd, 1) + (easy ? 0.01 : 0.02)) * setup.steerSens;
  const target = inp.steer * vmax, away = Math.abs(target) < Math.abs(car.steerUser) || target * car.steerUser < 0;
  // keys build lock over 0.4 s (0.25 s for beginners), release in 0.15 s; analog and touch follow in 0.08 s (0.15 s for beginners)
  const rate = vmax / (analog || touch.sActive ? (easy ? 0.15 : 0.08) : away ? 0.15 : easy ? 0.25 : 0.4);
  car.steerUser += clamp(target - car.steerUser, -rate * dt, rate * dt);
  // steering assist: counter-steer into a rear slide, the way a driver catches oversteer
  const assist = setup.assist && spd > 8 ? clamp(0.9 * car.aR, -0.12, 0.12) : 0;
  car.delta = clamp(car.steerUser + assist, -0.34, 0.34);
  // braking assist: slow to the speed the corner ahead allows (the computer drivers' profile, with a margin)
  car.baAct = false;
  if (setup.brakeAssist && state.mode === 'race' && RACE.prof && car.gear !== -1) {
    const vT = RACE.prof[car.k] * 0.94;
    if (spd > vT + 0.5) { inp.brk = Math.max(inp.brk, clamp((spd - vT) / 6, 0.25, 1)); inp.thr = 0; car.baAct = true; }
  }
}
// Automatic throttle against a barrier (P2, docs/賽道修正_2026-10.md): throttle on, not moving and touching the
// barrier for 1.2 s -> reverse out for up to 1 s (2 s when it does not move), then drive on; still stuck -> resetToTrack().
// Only with setup.autogas in a race; the player's own reverse gear or reset always wins. Writes inp (thr, brk, steer).
/* P2-begin: autoRecover (written by the collaborating AI from the spec in docs/賽道修正_2026-10.md; changes marked 「改」) */
const REC_STEER = 0.8; // hands off the wheel while reversing near the left barrier (lat > 0): steer left, which swings the nose to the right, back along the road (改: the spec had the opposite sign, which turned the car further into the barrier); mirrored on the right
const REC = { phase: 'drive', t: 0, x0: 0, z0: 0, activeRev: false };
function autoRecover(dt, inp) {
  if (!setup.autogas || state.mode !== 'race') { REC.phase = 'drive'; REC.t = 0; REC.activeRev = false; return; }
  // 改: raceUpdate() clears car.hit at the end of every frame, before the next frame reads the input, so car.hit is always 0
  // here; physicsStep() keeps the time of the last barrier contact in car.wallT
  const touching = car.hit > 0 || state.t - (car.wallT === undefined ? -9 : car.wallT) < 0.25;
  if (REC.phase === 'drive') {
    if (car.gear === -1) { REC.t = 0; return; } // the player's own reverse
  } else if (REC.phase === 'reverse') {
    if ((REC.activeRev && car.gear !== -1) || inp.uB > 0.1) { REC.phase = 'drive'; REC.t = 0; REC.activeRev = false; return; } // the player took over (改: braking counts too)
  }
  if (REC.phase === 'drive') {
    if (inp.uB <= 0.1 && inp.thr > 0.5 && Math.abs(car.vx) < 0.8 && touching) {
      REC.t += dt;
      if (REC.t >= 1.2) { REC.phase = 'reverse'; REC.t = 0; REC.x0 = car.x; REC.z0 = car.z; REC.activeRev = false; } else return;
    } else { REC.t = 0; return; }
  }
  if (REC.phase === 'reverse') {
    // 改: shift(-1) never goes below 1st gear (reverse only comes from holding the brake at a standstill, gearLogic), so the
    // spec's while (gear > -1) shift(-1) did nothing; the car is standing, so reverse is engaged directly
    if (car.gear !== -1) { car.gear = -1; car.shiftT = 0; car.revT = 0; }
    REC.activeRev = true; REC.t += dt;
    const dist = Math.hypot(car.x - REC.x0, car.z - REC.z0);
    const k = car.k || 0, tx = -W.lz[k], tz = W.lx[k], cx = Math.cos(car.psi), cz = -Math.sin(car.psi);
    const angleDeg = Math.acos(clamp(cx * tx + cz * tz, -1, 1)) * (180 / Math.PI);
    if (dist >= 2.5 || angleDeg < 35) REC.phase = 'resume';
    else if (REC.t >= 2.0) {
      if (dist < 0.3) { resetToTrack(); REC.phase = 'drive'; REC.t = 0; REC.activeRev = false; return; }
      REC.phase = 'resume';
    } else if (REC.t >= 1.0 && dist >= 0.3) REC.phase = 'resume';
    if (REC.phase === 'reverse') {
      // 改: in reverse gear physicsStep() takes the brake pedal as the reverse throttle and the throttle as the brake (and
      // gearLogic() shifts back to 1st on throttle > 0.3), so the spec's thr = 0.7 / brk = 0 would have braked
      inp.brk = 0.7; inp.thr = 0;
      if (Math.abs(inp.steer) < 0.1) inp.steer = car.lat >= 0 ? REC_STEER : -REC_STEER;
      else inp.steer = -inp.steer;
      return;
    }
  }
  if (REC.phase === 'resume') {
    if (car.gear === -1) { car.gear = 1; car.shiftT = 0; } // 改: back to 1st directly (shift(+1) from reverse does the same)
    REC.phase = 'drive'; REC.t = 0; REC.activeRev = false;
  }
}
/* P2-end */
function bindTouch(id, key) {
  const el = $(id);
  const on = e => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); touch[key] = 1; el.classList.add('held'); };
  const off = () => { touch[key] = 0; el.classList.remove('held'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
bindTouch('#tLeft', 'l'); bindTouch('#tRight', 'r'); bindTouch('#tGas', 'gas'); bindTouch('#tBrake', 'brake');
$('#tDrs').addEventListener('pointerdown', e => { e.preventDefault(); drsReq = true; });
$('#tUp').addEventListener('pointerdown', e => { e.preventDefault(); shift(1); });
$('#tDown').addEventListener('pointerdown', e => { e.preventDefault(); shift(-1); });
{ // steering pad: the rail appears under the thumb, horizontal travel of ±70 px maps to full lock
  const zone = $('#steerZone'), rail = $('#steerRail'), knob = $('#steerKnob'), RANGE = 70; let id = null, x0 = 0;
  zone.addEventListener('pointerdown', e => {
    if (id !== null) return; e.preventDefault(); id = e.pointerId; zone.setPointerCapture && zone.setPointerCapture(id);
    const r = zone.getBoundingClientRect(); x0 = e.clientX; rail.style.left = (e.clientX - r.left) + 'px'; rail.style.top = (e.clientY - r.top) + 'px';
    zone.classList.add('active', 'used'); touch.sActive = true; touch.steer = 0; knob.style.transform = '';
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId !== id) return; const dx = clamp(e.clientX - x0, -RANGE, RANGE); touch.steer = -dx / RANGE; knob.style.transform = `translateX(${dx}px)`; });
  const end = e => { if (e.pointerId !== id) return; id = null; touch.sActive = false; touch.steer = 0; knob.style.transform = ''; zone.classList.remove('active'); rail.style.left = rail.style.top = ''; };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => zone.addEventListener(ev, end));
}
['#touch', '#view'].forEach(sel => $(sel).addEventListener('contextmenu', e => e.preventDefault()));
$('#touchOn').checked = COARSE;
function applyControls() {
  const showTouch = $('#touchOn').checked;
  $('#touch').hidden = !showTouch; document.body.classList.toggle('touch', showTouch);
  $('#steerZone').hidden = setup.steerMode !== 'drag'; $('#steerBtns').hidden = setup.steerMode !== 'buttons';
  $('#shiftBtns').hidden = setup.auto;
  document.body.classList.toggle('autogas', setup.autogas);
  document.querySelectorAll('#steerMode button').forEach(b => b.classList.toggle('sel', b.dataset.s === setup.steerMode));
}

/* ================= Race state ================= */
const state = { mode: 'menu0', t: 0, lightsT: 0, lap: 0, lapStart: 0, valid: true, best: Infinity, last: NaN, secBest: [Infinity, Infinity, Infinity], secLast: [NaN, NaN, NaN], secCur: [NaN, NaN, NaN], secIdx: 0, secStart: 0, lastK: 0, ghostRec: [], ghostBest: null, bestTimes: null, curTimes: null };
function resetRace() {
  Object.assign(state, { lap: 0, valid: true, best: Infinity, last: NaN, secBest: [Infinity, Infinity, Infinity], secLast: [NaN, NaN, NaN], secCur: [NaN, NaN, NaN], secIdx: 0, ghostRec: [], ghostBest: null, bestTimes: null, curTimes: new Float32Array(W.n).fill(-1) });
  ghostModel.root.visible = false;
  for (let i = 0; i < 3; i++) { const el = $('#s' + i); el.className = 'sec'; el.querySelector('span').textContent = '–'; }
}
function startLap() {
  state.lap++; state.lapStart = state.t; state.valid = true; state.secIdx = 0; state.secStart = state.t; state.secCur = [NaN, NaN, NaN];
  state.ghostRec = []; state.curTimes = new Float32Array(W.n).fill(-1);
}
function resetToTrack() {
  if (state.mode !== 'race') return;
  const loc = trackLocate(car.x, car.z, car.k); placeCar(loc.k, 0, true); banner('回到賽道', 'info');
}
function raceUpdate() {
  const n = W.n, k = car.k, lk = state.lastK, t = state.t - state.lapStart, fwd = (k - lk + n) % n;
  if (fwd > 0 && fwd < n / 2) {
    if (k < lk) finishLap();
    else {
      const s1 = Math.floor(n / 3), s2 = Math.floor(2 * n / 3);
      if (state.secIdx === 0 && lk < s1 && k >= s1) sectorDone(0);
      else if (state.secIdx === 1 && lk < s2 && k >= s2) sectorDone(1);
      for (let j = lk + 1; j <= k; j++) if (state.curTimes[j] < 0) state.curTimes[j] = t;
    }
  }
  if (car.hit > 14) banner('擦撞護欄', 'info');
  car.hit = 0;
  state.lastK = k;
}
function sectorDone(i) { const st = state.t - state.secStart; state.secCur[i] = st; state.secStart = state.t; state.secIdx = i + 1; paintSector(i, st); }
function paintSector(i, st) {
  const el = $('#s' + i); el.className = 'sec';
  el.classList.add(st < state.secBest[i] ? 'purple' : st < state.secLast[i] ? 'green' : 'yellow'); el.querySelector('span').textContent = st.toFixed(3);
}
function finishLap() {
  const lt = state.t - state.lapStart, completed = state.lap;
  if (state.lap > 0 && state.secIdx === 2) {
    sectorDone(2); state.last = lt;
    if (state.valid) {
      const sb = state.secBest.join(), pb = lt < state.best;
      for (let i = 0; i < 3; i++) state.secBest[i] = Math.min(state.secBest[i], state.secCur[i]);
      if (pb) { state.best = lt; state.ghostBest = state.ghostRec; state.bestTimes = state.curTimes; banner('最快圈 ' + fmt(lt), 'good'); }
      else banner('圈速 ' + fmt(lt), 'info');
      if (!RACE.on && (pb || state.secBest.join() !== sb)) saveBest();
    } else banner('圈速 ' + fmt(lt) + ' · 無效', 'bad');
    state.secLast = state.secCur.slice();
  }
  startLap();
  if (RACE.on && completed >= 1) {
    if (completed === setup.laps - 1 && !RACE.done) banner('最後一圈', 'info');
    if (completed >= setup.laps && !RACE.done) playerFinished();
  }
  setTimeout(() => { if (state.secIdx === 0) for (let i = 0; i < 3; i++) { const el = $('#s' + i); el.className = 'sec'; el.querySelector('span').textContent = '–'; } }, 2500);
}
function recordGhost() {
  const t = state.t - state.lapStart, r = state.ghostRec;
  if (!r.length || t - r[r.length - 1][0] >= 0.05) { const q = carModel.root.quaternion, p = carModel.root.position; r.push([t, p.x, p.y, p.z, q.x, q.y, q.z, q.w]); }
}
const gA = new THREE.Quaternion(), gB = new THREE.Quaternion();
function showGhost() {
  const g = state.ghostBest; if (!g || g.length < 2 || state.mode !== 'race') { ghostModel.root.visible = false; return; }
  const t = state.t - state.lapStart; let i = Math.min(g.length - 2, Math.floor(t / (g[g.length - 1][0] || 1) * (g.length - 1))); // samples are frame-aligned, not exactly 0.05 s apart
  while (i > 0 && g[i][0] > t) i--; while (i < g.length - 2 && g[i + 1][0] < t) i++;
  const a = g[i], b = g[i + 1], f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  ghostModel.root.visible = t < g[g.length - 1][0];
  ghostModel.root.position.set(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
  gA.set(a[4], a[5], a[6], a[7]); gB.set(b[4], b[5], b[6], b[7]); ghostModel.root.quaternion.copy(gA).slerp(gB, f);
}
// solo best lap per track, kept in localStorage: time, sector bests, per-sample times and the ghost; the 10 most recently driven tracks
const BEST_KEY = 'tgp-best:', BEST_IDX = 'tgp-best-idx', BEST_MAX = 10;
function trackId() { // hash of the lap as built (centreline, surface height, widths, banking, barriers): a reversed or edited route is another track
  let h = 0x811c9dc5 ^ W.n; const mix = v => { h = Math.imul(h ^ Math.round(v), 16777619); };
  for (let k = 0; k < W.n; k++) { mix(W.x[k] * 10); mix(W.z[k] * 10); mix(W.h[k] * 10); mix(W.hwL[k] * 10); mix(W.hwR[k] * 10); mix(W.bank[k] * 1000); }
  mix(setup.walls ? 1 : 0);
  const hash = (h >>> 0).toString(36), wide = W.apronL ? '_wide' : ''; // beginners' wide corners: lap times kept apart
  if (setup.map === 'terrain' && hillSeed !== null && TER.source === 'hills' && TER.seed === 7 && !TER.meters) { // a seeded hill track: hill_<seed>, plus the hash when the terrain or road settings are not the defaults
    const id = 'hill_' + hillSeed + (setup.reverse ? '_r' : '');
    return (hillSig() === HILL_DEF ? id : id + '_' + hash) + wide;
  }
  return setup.map + '-' + W.n + '-' + hash + wide;
}
const b64 = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
// ghost rows as int16 deltas, 16 bytes per row: time in ms, position in cm (from the first row, kept in o), quaternion * 32767
function packGhost(g) {
  while (g.length > 6000) g = g.filter((_, i) => i % 2 === 0); // over ~6 min: every other row, keeps a record near 150 KB
  const d = new Int16Array(g.length * 8), o = g.length ? [1, 2, 3].map(c => Math.round(g[0][c] * 100)) : [0, 0, 0], p = o.slice(); let pt = 0;
  g.forEach((r, i) => {
    const j = i * 8; d[j] = clamp(Math.round(r[0] * 1000) - pt, 0, 32767); pt += d[j];
    for (let c = 0; c < 3; c++) { d[j + 1 + c] = clamp(Math.round(r[c + 1] * 100) - p[c], -32768, 32767); p[c] += d[j + 1 + c]; }
    for (let c = 0; c < 4; c++) d[j + 4 + c] = Math.round(clamp(r[c + 4], -1, 1) * 32767);
  });
  return { o, d: b64(d) };
}
function unpackGhost(G) {
  const d = unb64(G.d, Int16Array), p = G.o.slice(), g = []; let pt = 0;
  for (let j = 0; j < d.length; j += 8) { pt += d[j]; for (let c = 0; c < 3; c++) p[c] += d[j + 1 + c]; g.push([pt / 1000, p[0] / 100, p[1] / 100, p[2] / 100, d[j + 4] / 32767, d[j + 5] / 32767, d[j + 6] / 32767, d[j + 7] / 32767]); }
  return g;
}
function bestIdx() { try { const a = JSON.parse(localStorage.getItem(BEST_IDX) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function setBestIdx(idx) { try { while (idx.length > BEST_MAX) localStorage.removeItem(BEST_KEY + idx.pop()); localStorage.setItem(BEST_IDX, JSON.stringify(idx)); } catch (e) { /* storage unavailable */ } }
function saveBest() {
  if (!W.tid || !(state.best < Infinity) || !state.bestTimes) return;
  try {
    const rec = JSON.stringify({ v: 1, best: state.best, sec: state.secBest, n: W.n, bt: b64(state.bestTimes), g: packGhost(state.ghostBest || []) }), idx = bestIdx().filter(x => x !== W.tid);
    for (;;) { try { localStorage.setItem(BEST_KEY + W.tid, rec); break; } catch (e) { if (!idx.length) return; localStorage.removeItem(BEST_KEY + idx.pop()); } } // full: drop the least recently driven track and retry
    idx.unshift(W.tid); setBestIdx(idx);
  } catch (e) { /* storage unavailable */ }
}
// best laps saved under the ids the three Taipei presets had before the 2026-10 road fixes (same number of samples, so the
// per-sample times and the ghost still fit): read once, then saved under the new id at the next best lap
const OLD_TID = { 'taipei-2610-1fqdctv': ['taipei-2610-fo6wqn'], 'taipei-1685-1rizzf': ['taipei-1685-1p875b5', 'taipei-1685-1jdwle7'], 'taipei-964-1tiakky': ['taipei-964-xial2w'] };
function loadBest() {
  if (!W.tid) return;
  try {
    let r = JSON.parse(localStorage.getItem(BEST_KEY + W.tid) || 'null');
    for (const old of OLD_TID[W.tid] || []) { if (r) break; r = JSON.parse(localStorage.getItem(BEST_KEY + old) || 'null'); }
    if (!r || r.v !== 1 || r.n !== W.n || !(r.best > 0)) return;
    const bt = unb64(r.bt, Float32Array), g = unpackGhost(r.g), sec = [0, 1, 2].map(i => r.sec[i] > 0 ? r.sec[i] : Infinity); if (bt.length !== W.n) return;
    Object.assign(state, { best: r.best, secBest: sec, bestTimes: bt, ghostBest: g });
    setBestIdx([W.tid, ...bestIdx().filter(x => x !== W.tid)]);
    banner('本賽道最快圈 ' + fmt(r.best), 'info');
  } catch (e) { /* storage unavailable or a damaged record */ }
}
function clearBest() {
  try { localStorage.removeItem(BEST_KEY + W.tid); } catch (e) { /* storage unavailable */ }
  setBestIdx(bestIdx().filter(x => x !== W.tid));
  Object.assign(state, { best: Infinity, secBest: [Infinity, Infinity, Infinity], bestTimes: null, ghostBest: null });
}
let bannerT = 0;
function banner(txt, kind) { const b = $('#banner'); b.textContent = txt; b.className = 'hud show ' + kind; bannerT = 2.2; }

/* ================= Visuals ================= */
let camMode = 0;
const CAMS = ['追車視角', '遠景追車', '車手視角', '鼻錐視角', '前翼低視角', '轉播視角'];
function nextCam() { camMode = (camMode + 1) % CAMS.length; camInit = false; tvCam.k = -1; banner(CAMS[camMode], 'info'); }
const tvCam = { k: -1, pos: new THREE.Vector3() };
const m4 = new THREE.Matrix4(), rt = new THREE.Vector3(), camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camFwd = new THREE.Vector3(1, 0, 0), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
let camInit = false, shake = 0;
function updateCarVisual() {
  const c = car, mdl = carModel;
  if (headlight.parent !== mdl.root) mdl.root.add(headlight, headlight.target);
  c.y = Sq(c.x, c.z, c.k); normalS(c.x, c.z, c.k, nrm);
  const cp = Math.cos(c.psi), sn = Math.sin(c.psi);
  fp.set(cp, 0, -sn); fp.addScaledVector(nrm, -fp.dot(nrm)).normalize(); rt.crossVectors(fp, nrm);
  m4.makeBasis(fp, nrm, rt); mdl.root.quaternion.setFromRotationMatrix(m4); mdl.root.position.set(c.x, c.y, c.z);
  mdl.body.rotation.set(clamp(c.ays * 0.0005, -0.03, 0.03), 0, clamp(c.axs * 0.0006, -0.035, 0.02));
  for (const w of mdl.wheels) { w.spin.rotation.z = -c.wheelRot; if (w.front) w.pivot.rotation.y = c.delta; if (w.mark) w.mark.visible = Math.abs(c.vx) < 14; }
  mdl.flap.rotation.z = c.drs ? 0.55 : 0;
  mdl.light.visible = c.brk > 0.1;
  // keep the shadow camera centred on the car
  const sx = c.x + fp.x * 28, sz = c.z + fp.z * 28; sun.target.position.set(sx, c.y, sz); sun.position.set(sx + SUN_DIR.x * 300, c.y + SUN_DIR.y * 300, sz + SUN_DIR.z * 300);
}
function updateCamera(dt) {
  const c = car, root = carModel.root;
  const fwd = tmp.set(1, 0, 0).applyQuaternion(root.quaternion), up = tmp2.set(0, 1, 0).applyQuaternion(root.quaternion);
  const spd = Math.hypot(c.vx, c.vy);
  if (camMode === 5) { // broadcast: fixed trackside cameras about every 180 m, switching as the car passes
    const n = W.n, gap = Math.max(1, Math.round(180 / W.ds)), ahead = Math.round(60 / W.ds), slot = Math.floor(((c.k + ahead) % n) / gap) * gap;
    if (slot !== tvCam.k) { tvCam.k = slot; const sd = (slot / gap) & 1 ? 1 : -1, off = ((sd > 0 ? W.hwL : W.hwR)[slot] || 6) + 6, x = W.x[slot] + W.lx[slot] * off * sd, z = W.z[slot] + W.lz[slot] * off * sd; tvCam.pos.set(x, Sq(x, z, slot) + 5.5, z); }
    camPos.copy(tvCam.pos); camLook.copy(root.position); camLook.y += 0.6;
  } else if (camMode === 0 || camMode === 1) {
    const back = camMode === 0 ? 7.2 : 13, up = camMode === 0 ? 2.5 : 5.2;
    if (!camInit) camFwd.copy(fwd); else camFwd.lerp(fwd, 1 - Math.exp(-dt * 6)).normalize();
    const want = new THREE.Vector3().copy(root.position).addScaledVector(camFwd, -back); want.y += up;
    const gh = Sq(want.x, want.z, c.k) + 1.2; if (want.y < gh) want.y = gh;
    if (!camInit) camPos.copy(want); else camPos.lerp(want, 1 - Math.exp(-dt * 12));
    camLook.copy(root.position).addScaledVector(camFwd, 4); camLook.y += 0.9;
  } else {
    const local = camMode === 2 ? [-0.05, 1.12, 0] : camMode === 3 ? [0.12, 0.9, 0] : [3.1, 0.32, 0], ahead = camMode === 2 ? [10, 0.85, 0] : camMode === 3 ? [10, 0.75, 0] : [12, 0.3, 0];
    camPos.set(...local).applyQuaternion(root.quaternion).add(root.position);
    camLook.set(...ahead).applyQuaternion(root.quaternion).add(root.position);
  }
  camInit = true;
  camera.position.copy(camPos);
  if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - .5) * shake, (Math.random() - .5) * shake, (Math.random() - .5) * shake));
  camera.up.copy(camMode <= 1 || camMode === 5 ? UP : up);
  camera.lookAt(camLook);
  const fov = camMode === 5 ? clamp(40 - Math.hypot(camPos.x - root.position.x, camPos.z - root.position.z) * 0.15, 18, 40) : (camMode === 3 || camMode === 4 ? 74 : 62) + clamp(spd / 90, 0, 1) * 10;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ================= HUD ================= */
const leds = $('#leds'); for (let i = 0; i < 15; i++) leds.appendChild(document.createElement('i'));
const ledEls = [...leds.children];
const mm = $('#minimap'), pf = $('#profile'), gm = $('#gmeter');
const dpr = Math.min(2, window.devicePixelRatio || 1);
gm.width = 116 * dpr; gm.height = 116 * dpr;
let mmBase = null, mmT = null;
function drawMinimapBase() {
  const w = 170 * dpr, h = 170 * dpr; mm.width = w; mm.height = h;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < W.n; k++) { x0 = Math.min(x0, W.x[k]); x1 = Math.max(x1, W.x[k]); z0 = Math.min(z0, W.z[k]); z1 = Math.max(z1, W.z[k]); }
  const pad = 10 * dpr, s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (z1 - z0 || 1)), ox = (w - (x1 - x0) * s) / 2, oz = (h - (z1 - z0) * s) / 2;
  mmT = (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  const path = (filter, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); let pen = false; for (let k = 0; k <= W.n; k++) { const kk = k % W.n; if (filter && !filter(kk)) { pen = false; continue; } const [px, pz] = mmT(W.x[kk], W.z[kk]); if (!pen) { g.moveTo(px, pz); pen = true; } else g.lineTo(px, pz); } g.stroke(); };
  path(null, 'rgba(0,0,0,.6)', 7 * dpr); path(null, '#d9dee6', 3.2 * dpr); path(k => W.drs[k], '#25d26a', 3.2 * dpr);
  const [sx, sz] = mmT(W.x[0], W.z[0]); g.fillStyle = '#fff'; g.save(); g.translate(sx, sz); g.rotate(Math.atan2(W.lz[0], W.lx[0])); g.fillRect(-6 * dpr, -1.5 * dpr, 12 * dpr, 3 * dpr); g.restore();
  mmBase = cv;
  pf.width = 170 * dpr; pf.height = 44 * dpr;
  let lo = Infinity, hi = -Infinity; for (const v of W.h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  W.pLo = lo; W.pHi = hi;
  $('#elevRange').textContent = `${Math.round(W.base + lo)}–${Math.round(W.base + hi)} m`;
}
function drawMinimap() {
  if (!mmBase) return; const g = mm.getContext('2d'); g.clearRect(0, 0, mm.width, mm.height); g.drawImage(mmBase, 0, 0);
  if (ghostModel.root.visible) { const [gx, gz] = mmT(ghostModel.root.position.x, ghostModel.root.position.z); g.fillStyle = '#9fe0ff'; g.beginPath(); g.arc(gx, gz, 3.5 * dpr, 0, 7); g.fill(); }
  const [cx, cz] = mmT(car.x, car.z); g.fillStyle = '#57c4ff'; g.strokeStyle = '#04131d'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(cx, cz, 5 * dpr, 0, 7); g.fill(); g.stroke();
  const p = pf.getContext('2d'), w = pf.width, h = pf.height, lo = W.pLo, span = Math.max(4, W.pHi - lo), n = W.n;
  p.clearRect(0, 0, w, h); p.beginPath(); p.moveTo(0, h);
  for (let i = 0; i <= w; i += 2) { const k = Math.floor(i / w * (n - 1)); p.lineTo(i, h - 3 - (W.h[k] - lo) / span * (h - 8)); }
  p.lineTo(w, h); p.closePath(); p.fillStyle = 'rgba(87,196,255,.18)'; p.fill(); p.strokeStyle = 'rgba(87,196,255,.8)'; p.lineWidth = 1.5 * dpr; p.stroke();
  p.fillStyle = '#e9edf3'; p.fillRect(car.k / n * w - dpr, 0, 2 * dpr, h);
}
function drawG() {
  const g = gm.getContext('2d'), w = gm.width, h = gm.height, cx = w / 2, cy = h / 2, R = w / 2 - 4 * dpr, maxG = 6;
  g.clearRect(0, 0, w, h); g.strokeStyle = '#263042'; g.lineWidth = dpr;
  for (let i = 2; i <= maxG; i += 2) { g.beginPath(); g.arc(cx, cy, R * i / maxG, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  g.fillStyle = '#8792a5'; g.font = `${9 * dpr}px "IBM Plex Mono", monospace`; g.fillText('2g', cx + R / 3 + 2 * dpr, cy - 2 * dpr); g.fillText('6g', cx + R - 14 * dpr, cy - 2 * dpr);
  const gx = car.ays / G, gy = car.axs / G; // dot points where the car is being pushed: left turn → left, braking → down
  const px = cx - clamp(gx, -maxG, maxG) / maxG * R, py = cy - clamp(gy, -maxG, maxG) / maxG * R;
  g.fillStyle = '#57c4ff'; g.beginPath(); g.arc(px, py, 4.5 * dpr, 0, 7); g.fill();
  g.fillStyle = '#e9edf3'; g.font = `600 ${11 * dpr}px "Saira Condensed", sans-serif`; g.fillText(Math.hypot(gx, gy).toFixed(1) + ' g', 3 * dpr, h - 4 * dpr);
}
const tyreCls = T => T < 80 ? 'tyre-cold' : T > 120 ? 'tyre-hot' : 'tyre-ok';
let hudT = 0;
function hud(dt) {
  hudT += dt; if (hudT < 1 / 30) return;
  if (state.mode !== 'preview') drivingNotes(car.k, Math.hypot(car.vx, car.vy), hudT);
  hudT = 0;
  const c = car, spd = Math.hypot(c.vx, c.vy) * 3.6;
  $('#spd').textContent = Math.round(spd);
  $('#gear').textContent = c.gear === -1 ? 'R' : c.gear;
  $('#rpm').textContent = Math.round(c.rpm / 10) * 10 + ' RPM';
  const lit = clamp(Math.floor((c.rpm - 10200) / (SPEC.upAt - 10200) * 15), 0, 15);
  ledEls.forEach((e, i) => e.className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : '');
  leds.classList.toggle('flash', !setup.auto && c.rpm > SPEC.upAt && (state.t * 8 % 1) < 0.5);
  $('#pThr i').style.height = (c.thr * 100) + '%'; $('#pBrk i').style.height = (c.brk * 100) + '%';
  const drsAvail = W.drs[c.k] && state.mode === 'race';
  $('#cDrs').className = 'chip' + (c.drs ? ' on' : drsAvail ? ' avail' : '');
  $('#tDrs').className = 'tbtn' + (c.drs ? ' on' : drsAvail ? ' avail' : '');
  $('#cTc').className = 'chip' + (!setup.tc ? '' : c.tcAct ? ' act' : ' avail') + (c.spin && !setup.tc ? ' warn' : '');
  $('#cAbs').className = 'chip' + (!setup.abs ? (c.lockF ? ' warn' : '') : ' avail');
  $('#cGb').textContent = setup.auto ? 'AUTO' : 'MANUAL';
  const lt = state.mode === 'race' ? (state.lap > 0 ? state.t - state.lapStart : RACE.on ? state.t : 0) : 0;
  $('#lapNo').textContent = RACE.on ? `${clamp(state.lap, 1, setup.laps)}/${setup.laps}` : (state.lap || '–');
  $('#lapTime').textContent = fmt(lt); $('#lapTime').classList.toggle('invalid', !state.valid);
  $('#lapState').textContent = state.mode === 'race' ? (state.valid ? '計時中' : '無效圈') : state.mode === 'lights' ? '起跑' : '暫停';
  const dEl = $('#delta');
  if (state.bestTimes && state.mode === 'race' && state.bestTimes[c.k] > 0 && state.curTimes[c.k] > 0) {
    const d = state.curTimes[c.k] - state.bestTimes[c.k]; dEl.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3); dEl.className = d >= 0 ? 'up' : 'down';
  } else dEl.textContent = '';
  $('#best').textContent = fmt(state.best); $('#last').textContent = fmt(state.last);
  $('#tDown').textContent = (c.down / 1000).toFixed(1) + ' kN';
  $('#tDrag').textContent = (c.drag / 1000).toFixed(1) + ' kN';
  $('#tGrade').textContent = (c.grade * 100 >= 0 ? '+' : '') + (c.grade * 100).toFixed(1) + ' %';
  $('#tBank').textContent = (c.bankV * 100).toFixed(1) + ' %';
  $('#tAlt').textContent = Math.round(W.base + c.y) + ' m';
  $('#tRho').textContent = c.rho.toFixed(3) + ' kg/m³';
  $('#tLoad').textContent = (c.Fzf / 1000).toFixed(1) + ' / ' + (c.Fzr / 1000).toFixed(1) + ' kN';
  $('#tSurf').textContent = ['柏油賽道', '路肩 Kerb', W.city ? '人行道' : '草地', '碎石區'][c.surf];
  $('#tTyre').innerHTML = `<span class="${tyreCls(c.tf)}">${Math.round(c.tf)}</span> / <span class="${tyreCls(c.tr)}">${Math.round(c.tr)}</span> °C`;
  const dF = Math.abs(c.aF) * 57.3, dR = Math.abs(c.aR) * 57.3, peak = 6.2;
  $('#bF').style.width = clamp(dF / 12, 0, 1) * 100 + '%'; $('#bR').style.width = clamp(dR / 12, 0, 1) * 100 + '%';
  $('#bF').classList.toggle('hot', dF > peak); $('#bR').classList.toggle('hot', dR > peak);
  $('#oF').textContent = dF.toFixed(1) + '°'; $('#oR').textContent = dR.toFixed(1) + '°';
  const bal = $('#balance');
  if (spd < 30 || (dF < 1.2 && dR < 1.2)) { bal.textContent = '中性'; bal.className = ''; }
  else if (dF > dR + 1.2) { bal.textContent = '轉向不足 UNDERSTEER'; bal.className = 'under'; }
  else if (dR > dF + 1.2) { bal.textContent = '轉向過度 OVERSTEER'; bal.className = 'over'; }
  else { bal.textContent = '中性'; bal.className = ''; }
  drawMinimap(); drawG();
}

/* ================= Audio ================= */
let AC = null, eng = null, muted = false, volume = 0.7; // volume 0..1 scales the master gain
function startAudio() {
  if (AC) { AC.resume && AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const master = AC.createGain(); master.gain.value = 0.7 * volume; master.connect(AC.destination);
    const filt = AC.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1500; filt.Q.value = 3;
    const g = AC.createGain(); g.gain.value = 0; filt.connect(g); g.connect(master);
    const o1 = AC.createOscillator(); o1.type = 'sawtooth'; const o2 = AC.createOscillator(); o2.type = 'square'; const o3 = AC.createOscillator(); o3.type = 'sawtooth';
    const g2 = AC.createGain(); g2.gain.value = 0.35; const g3 = AC.createGain(); g3.gain.value = 0.25;
    o1.connect(filt); o2.connect(g2); g2.connect(filt); o3.connect(g3); g3.connect(filt); o1.start(); o2.start(); o3.start();
    const buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = AC.createBufferSource(); ns.buffer = buf; ns.loop = true; const nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.6;
    const ng = AC.createGain(); ng.gain.value = 0; ns.connect(nf); nf.connect(ng); ng.connect(master); ns.start();
    eng = { o1, o2, o3, filt, g, ng, master };
  } catch (e) { AC = null; }
}
// volume slider in the settings and the pause menu (kept in sync, saved with the preferences)
function setVolume(v, save = true) {
  volume = clamp(v, 0, 1);
  for (const id of ['#vol', '#pVol']) $(id).value = Math.round(volume * 100);
  $('#oVol').textContent = $('#oPVol').textContent = Math.round(volume * 100) + '%';
  if (eng) eng.master.gain.setTargetAtTime(0.7 * volume, AC.currentTime, 0.05);
  if (save) savePrefs();
}
['#vol', '#pVol'].forEach(id => $(id).addEventListener('input', e => { setVolume(+e.target.value / 100); if (volume > 0 && muted) { muted = false; $('#sound').checked = true; } }));
function updateAudio() {
  if (!eng) return; const t = AC.currentTime, c = car, f = c.rpm / 60 * 3, spd = Math.hypot(c.vx, c.vy);
  eng.o1.frequency.setTargetAtTime(f, t, 0.015); eng.o2.frequency.setTargetAtTime(f / 2, t, 0.015); eng.o3.frequency.setTargetAtTime(f * 1.005, t, 0.015);
  eng.filt.frequency.setTargetAtTime(700 + c.thr * 2600 + c.rpm * 0.08, t, 0.03);
  const on = !muted && state.mode !== 'menu' && state.mode !== 'menu0';
  eng.g.gain.setTargetAtTime(on ? 0.05 + 0.11 * c.thr : 0, t, 0.05);
  eng.ng.gain.setTargetAtTime(on ? Math.min(0.12, spd * spd / 80000) + (c.surf >= 2 && spd > 3 ? 0.05 : 0) + ((c.spin || c.lockF) && spd > 5 ? 0.06 : 0) : 0, t, 0.08);
}

/* ================= Setup UI ================= */
let mapDirty = true;
const COLORS = ['#d7263d', '#1f5bff', '#ff8a00', '#12a596', '#e3e7ec', '#1b1d22'];
const sw = $('#swatches');
COLORS.forEach(cl => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sw' + (cl === setup.color ? ' sel' : ''); b.style.background = cl; b.setAttribute('aria-label', '車色 ' + cl); b.onclick = () => { setup.color = cl; sw.querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x === b)); recolor(); }; sw.appendChild(b); });
function recolor() { scene.remove(carModel.root); carModel = buildCar(setup.color, false); scene.add(carModel.root); }
function syncLabels() {
  $('#oSize').textContent = (+$('#size').value / 1000).toFixed(1) + ' km';
  $('#oRange').textContent = TER.meters ? TER.range + ' m' : $('#range').value + ' m';
  $('#range').disabled = !!TER.meters;
  $('#oBase').textContent = $('#base').value + ' m';
  $('#oWidth').textContent = $('#width').value + ' m';
  const a = +$('#aero').value, ae = aeroOf(a);
  $('#oAero').textContent = a < 0.25 ? '低（蒙札）' : a > 0.75 ? '高（摩納哥）' : '中';
  $('#aeroHint').textContent = `CdA ${ae.CdA.toFixed(2)} m² · ClA ${ae.ClA.toFixed(2)} m² · L/D ${(ae.ClA / ae.CdA).toFixed(2)}`;
  $('#oBias').textContent = (+$('#bias').value).toFixed(1) + '% 前';
  $('#oSteer').textContent = Math.round(+$('#steer').value * 100) + '%';
  $('#oLaps').textContent = $('#laps').value + ' 圈'; $('#oAiCount').textContent = $('#aiCount').value + ' 台';
  $('#oAiSkill').textContent = ['新手', '業餘', '職業', '冠軍'][Math.min(3, Math.floor(+$('#aiSkill').value * 4))];
}
function readSetup() {
  TER.size = +$('#size').value; if (!TER.meters) TER.range = +$('#range').value; TER.base = +$('#base').value;
  setup.elevated = $('#elevated').checked;
  setup.width = +$('#width').value; setup.banking = $('#banking').checked; setup.walls = $('#walls').checked; setup.wideCorners = $('#wideCorners').checked; setup.aero = +$('#aero').value; setup.bias = +$('#bias').value;
  setup.tc = $('#tc').checked; setup.abs = $('#abs').checked; setup.auto = $('#auto').checked; setup.esc = $('#esc').checked; setup.brakeAssist = $('#brakeAssist').checked;
  setup.turnHints = $('#turnHints').checked; setup.preview = $('#previewOn').checked; setup.lineGuide = $('#lineGuide').checked;
  setup.steerSens = +$('#steer').value; setup.assist = $('#assist').checked; setup.autogas = $('#autogas').checked; muted = !$('#sound').checked; setVolume(+$('#vol').value / 100, false);
  setup.laps = +$('#laps').value; setup.aiCount = +$('#aiCount').value; setup.aiSkill = +$('#aiSkill').value;
  if (setup.level === 'easy') Object.assign(setup, { aero: 0.5, bias: 57, tc: true, abs: true, auto: true, assist: true, esc: true, brakeAssist: true });
  savePrefs();
}
// driving level: beginners get every aid and no setup sliders; pro shows the car setup and lets each aid be switched off
function applyLevel() {
  const easy = setup.level === 'easy';
  document.querySelectorAll('#level button').forEach(b => b.classList.toggle('sel', b.dataset.l === setup.level));
  document.querySelectorAll('.pro-only').forEach(el => { el.hidden = easy; });
  $('#levelHint').textContent = easy ? '新手：循跡控制、防鎖死、車身穩定、煞車輔助、自動換檔全部開啟，彎前會自動減速到過得了彎的速度。熟悉後再切到「專業」調整賽車。' : '專業：可調尾翼與煞車平衡，每項輔助都能關閉。全部關閉時，油門、煞車與轉向都要自己控制抓地力。';
}
document.querySelectorAll('#level button').forEach(b => b.onclick = () => { setup.level = b.dataset.l; applyLevel(); readSetup(); });
function mapChanged() { mapDirty = true; drawEditorBase(); drawEditor(); updateStartBtn(); }
['size', 'range', 'base'].forEach(id => $('#' + id).addEventListener('input', () => { syncLabels(); readSetup(); mapDirty = true; if (id !== 'base' && setup.map === 'terrain') { drawEditorBase(); drawEditor(); } updateStartBtn(); }));
['width', 'banking', 'walls', 'wideCorners'].forEach(id => $('#' + id).addEventListener('input', () => { syncLabels(); readSetup(); mapDirty = true; updateStartBtn(); }));
['aero', 'bias', 'tc', 'abs', 'auto', 'steer', 'assist', 'autogas', 'sound', 'touchOn', 'laps', 'aiCount', 'aiSkill'].forEach(id => $('#' + id).addEventListener('input', () => { syncLabels(); readSetup(); applyControls(); }));
document.querySelectorAll('#presets .btn').forEach(b => b.onclick = () => {
  document.querySelectorAll('#presets .btn').forEach(x => x.classList.toggle('sel', x === b));
  const p = PRESETS[b.dataset.p]; TER.seed = (TER.seed * 7 + 13) % 997;
  genPreset(b.dataset.p, TER.seed); $('#range').value = p.range; $('#base').value = p.base; readSetup(); syncLabels();
  $('#fileInfo').textContent = 'PNG / JPG 皆可，也可直接拖放到這裡。Terrarium 編碼的真實地形圖磚會讀出實際海拔。';
  mapChanged();
});
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadHeightImage(f); e.target.value = ''; });
function dropZone(el, fn) {
  ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove('over'); }));
  el.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) fn(f); });
}
dropZone($('#drop'), loadHeightImage);
function importOSM(file) {
  $('#osmInfo').textContent = `讀取 ${file.name}…`;
  file.text().then(txt => {
    const M = parseOSM(txt, file.name); CITY.osm = M;
    $('#osmInfo').textContent = `${file.name}：${(M.sx / 1000).toFixed(2)} × ${(M.sz / 1000).toFixed(2)} km，${M.roads.length} 條道路、${M.blds.length} 棟建物。在地圖上點路口放置賽道點。`;
    trackPts = []; selectMap('osm');
  }).catch(err => { $('#osmInfo').textContent = '匯入失敗：' + err.message; });
}
$('#osmFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importOSM(f); e.target.value = ''; });
dropZone($('#osmDrop'), importOSM);
function selectMap(m) {
  const go = () => {
    setup.map = m;
    document.querySelectorAll('#mapTabs .tab').forEach(t => { t.classList.toggle('sel', t.dataset.m === m); t.setAttribute('aria-selected', t.dataset.m === m); });
    $('#terrainOpts').hidden = m !== 'terrain'; $('#taipeiOpts').hidden = m !== 'taipei'; $('#osmOpts').hidden = m !== 'osm'; $('#tpPresetGroup').hidden = m !== 'taipei'; document.querySelectorAll('.only-taipei').forEach(el => { el.hidden = m !== 'taipei'; });
    $('#baseField').hidden = m === 'taipei'; $('#banking').closest('label').hidden = m !== 'terrain';
    const M = m === 'terrain' ? null : CITY[m];
    $('#mapCredit').hidden = !M; if (M) $('#mapCredit').textContent = M.credits;
    readSetup();
    if (m === 'taipei' && (!trackPts.length || trackPts[0].node === undefined)) trackPts = cityPreset(M, 0);
    if (m === 'terrain' && (!trackPts.length || trackPts[0].node !== undefined)) newHillTrack(HILL_STD);
    $('#btnRand').textContent = m === 'taipei' ? '換一條預設環線' : '隨機賽道'; $('#btnRand').disabled = m === 'osm';
    refreshRoute(); mapChanged();
  };
  if (m === 'taipei' && !CITY.taipei) {
    $('#busy').textContent = '載入臺北地形與建物…'; $('#busy').hidden = false;
    loadTaipei().then(() => { $('#busy').hidden = true; go(); }).catch(() => { $('#busy').hidden = true; $('#trackInfo').textContent = '臺北資料載入失敗，請重新整理頁面再試。'; });
  } else if (m === 'osm' && !CITY.osm) {
    setup.map = 'osm'; document.querySelectorAll('#mapTabs .tab').forEach(t => t.classList.toggle('sel', t.dataset.m === m));
    $('#terrainOpts').hidden = true; $('#taipeiOpts').hidden = true; $('#osmOpts').hidden = false; $('#baseField').hidden = false; $('#mapCredit').hidden = true;
    edBase = null; drawEditor(); updateStartBtn();
  } else go();
}
document.querySelectorAll('#mapTabs .tab').forEach(t => t.onclick = () => { if (t.dataset.m !== setup.map || (t.dataset.m === 'osm' && !CITY.osm)) { trackPts = []; selectMap(t.dataset.m); } });
function tpPick(b) { if (TP_ELEVATED[+b.dataset.c]) { setup.elevated = true; $('#elevated').checked = true; } trackPts = cityPreset(CITY.taipei, +b.dataset.c); setup.reverse = false; $('#btnRev').classList.remove('sel'); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); }
document.querySelectorAll('#tpPresets .btn').forEach(b => b.onclick = () => tpPick(b));

// ---- editor map
const ed = $('#editor'); let edBase = null, edSize = 0, routePreview = null, presetCycle = 0;
function drawEditorBase() {
  if (setup.map === 'terrain') {
    applyTerrainScale();
    const raw = TER.raw, img = new ImageData(N, N); let lo = Infinity, hi = -Infinity; for (const v of raw) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const cell = TER.size / (N - 1), span = hi - lo + 1e-6;
    const ramp = [[0, [62, 92, 46]], [0.45, [118, 132, 70]], [0.75, [150, 128, 92]], [0.9, [140, 132, 125]], [1, [235, 238, 242]]];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = j * N + i, t = (raw[o] - lo) / span;
      const dx = (raw[j * N + Math.min(N - 1, i + 1)] - raw[j * N + Math.max(0, i - 1)]) / (2 * cell), dz = (raw[Math.min(N - 1, j + 1) * N + i] - raw[Math.max(0, j - 1) * N + i]) / (2 * cell);
      const sh = clamp(0.75 + (-dx * 0.7 - dz * 0.7) * 1.6, 0.35, 1.25);
      let a = ramp[0], b = ramp[1]; for (let r = 1; r < ramp.length; r++) if (t <= ramp[r][0]) { a = ramp[r - 1]; b = ramp[r]; break; }
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      for (let ch = 0; ch < 3; ch++) img.data[o * 4 + ch] = clamp((a[1][ch] + (b[1][ch] - a[1][ch]) * f) * sh, 0, 255);
      img.data[o * 4 + 3] = 255;
    }
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N; cv.getContext('2d').putImageData(img, 0, 0); edBase = cv;
    return;
  }
  const M = CITY[setup.map]; if (!M) { edBase = null; return; }
  const s = 1200, V = viewSize(M), cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
  const T = (x, z) => [(x / V + 0.5) * s, (z / V + 0.5) * s];
  g.fillStyle = '#10141b'; g.fillRect(0, 0, s, s);
  const mc = document.createElement('canvas'); mc.width = M.nx; mc.height = M.nz; const mg = mc.getContext('2d'), img = mg.createImageData(M.nx, M.nz);
  let lo = Infinity, hi = -Infinity; for (const v of M.raw) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < M.nx * M.nz; i++) {
    const m = M.mask[i], t = clamp((M.raw[i] - lo) / (Math.min(hi, lo + 40) - lo + 1e-6), 0, 1);
    const c = m === 0 ? (M.raw[i] < (M.water ?? -99) + 1.2 ? [44, 82, 110] : [52, 84, 52]) : m === 2 ? [70, 96, 62] : m === 3 ? [44, 48, 56] : [56 + t * 30, 60 + t * 28, 68 + t * 20];
    img.data.set([...c, 255], i * 4);
  }
  mg.putImageData(img, 0, 0);
  const [ax, az] = T(-M.sx / 2, -M.sz / 2); g.imageSmoothingEnabled = true; g.drawImage(mc, ax, az, M.sx / V * s, M.sz / V * s);
  g.fillStyle = 'rgba(150,158,172,.55)';
  for (const b of M.blds) { const p = b.p; g.beginPath(); for (let i = 0; i < p.length; i += 2) { const [x, z] = T(p[i], p[i + 1]); i ? g.lineTo(x, z) : g.moveTo(x, z); } g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  for (const r of [...M.roads].sort((a, b) => b.c - a.c)) {
    g.strokeStyle = r.c <= 1 ? '#f2e6c4' : r.c <= 3 ? '#d6dbe3' : 'rgba(200,206,216,.55)'; g.lineWidth = Math.max(0.7, ROAD_W[r.c] / V * s);
    g.beginPath(); for (let i = 0; i < r.p.length; i += 2) { const [x, z] = T(r.p[i], r.p[i + 1]); i ? g.lineTo(x, z) : g.moveTo(x, z); } g.stroke();
  }
  edBase = cv;
}
function refreshRoute() {
  const M = setup.map === 'terrain' ? null : CITY[setup.map];
  routePreview = M && trackPts.length >= 2 ? routeLoop(M, setup.reverse ? trackPts.slice().reverse() : trackPts) : null;
}
function edResize() { const s = Math.round(ed.clientWidth * dpr); if (s && s !== edSize) { edSize = s; ed.width = s; ed.height = s; } }
function drawEditor() {
  edResize(); if (!edSize) return;
  const g = ed.getContext('2d'), s = edSize, city = setup.map !== 'terrain', M = city ? CITY[setup.map] : null;
  g.fillStyle = '#10141b'; g.fillRect(0, 0, s, s);
  if (!edBase) { g.fillStyle = '#8792a5'; g.font = `${14 * dpr}px "Noto Sans TC", sans-serif`; g.textAlign = 'center'; g.fillText('先匯入 .osm 檔', s / 2, s / 2); g.textAlign = 'left'; $('#trackInfo').textContent = '匯入 OpenStreetMap 檔後，就能在街道上點出賽道。'; return; }
  g.imageSmoothingEnabled = true; g.drawImage(edBase, 0, 0, s, s);
  if (!city) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, s, s); }
  const V = city ? viewSize(M) : TER.size;
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
  const step = 500 / V * s; for (let x = step; x < s; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `${10 * dpr}px "IBM Plex Mono", monospace`; g.fillText('格線 500 m', 6 * dpr, s - 6 * dpr);
  const pts = setup.reverse ? trackPts.slice().reverse() : trackPts;
  let line = null, approx = 0;
  if (city && routePreview && routePreview.length > 1) line = routePreview.map(([x, z]) => [(x / V + 0.5), (z / V + 0.5)]).concat([[routePreview[0][0] / V + 0.5, routePreview[0][1] / V + 0.5]]);
  else if (!city && pts.length >= 3) line = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.u, 0, p.v)), true, 'centripetal', 0.5).getPoints(600).map(p => [p.x, p.z]);
  if (line) {
    for (let i = 1; i < line.length; i++) approx += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) * V;
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const [c, lw] of [['rgba(0,0,0,.6)', 7], [city ? '#ff5a4f' : '#e9edf3', 3.2]]) { g.strokeStyle = c; g.lineWidth = lw * dpr; g.beginPath(); line.forEach((p, i) => i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)); g.stroke(); }
    const a = line[0], b = line[Math.min(line.length - 1, 4)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.save(); g.translate(a[0] * s, a[1] * s); g.rotate(ang); g.fillStyle = '#57c4ff'; g.beginPath(); g.moveTo(14 * dpr, 0); g.lineTo(-6 * dpr, -8 * dpr); g.lineTo(-6 * dpr, 8 * dpr); g.closePath(); g.fill(); g.restore();
  }
  trackPts.forEach((p, i) => {
    g.fillStyle = i === 0 ? '#57c4ff' : '#10141b'; g.strokeStyle = '#e9edf3'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(p.u * s, p.v * s, 8 * dpr, 0, 7); g.fill(); g.stroke();
    g.fillStyle = i === 0 ? '#04131d' : '#e9edf3'; g.font = `600 ${10 * dpr}px "Saira Condensed", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i + 1, p.u * s, p.v * s + 0.5);
  });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  $('#footStatus').textContent = (city ? (M.id === 'taipei' ? '臺北街道賽' : 'OSM 街道') : '自訂地形') + (line && trackPts.length >= (city ? 3 : 4) ? ` · ${trackPts.length} 點 · ${(approx / 1000).toFixed(2)} km` : ' · 尚未完成賽道');
  $('#trackInfo').innerHTML = trackPts.length < (city ? 3 : 4)
    ? `在地圖上依序點擊放置${city ? '路口' : '彎道控制點'}（目前 <b>${trackPts.length}</b> 點，至少 ${city ? 3 : 4} 點）。${city ? '點會吸附到最近的路口，路線沿真實街道走。' : '點可以拖曳調整，賽道會自動閉合並貼合地形。'}`
    : `<b>${trackPts.length}</b> 個${city ? '路口' : '控制點'} · 約 <b>${(approx / 1000).toFixed(2)} km</b>。拖曳點可調整，藍色箭頭是行駛方向與起跑線。`;
}
let dragI = -1;
function edPos(e) { const r = ed.getBoundingClientRect(); return { u: clamp((e.clientX - r.left) / r.width, 0.01, 0.99), v: clamp((e.clientY - r.top) / r.height, 0.01, 0.99) }; }
function snapIfCity(p) { if (setup.map === 'terrain') return p; const M = CITY[setup.map], V = viewSize(M); return cityPoint(M, (p.u - 0.5) * V, (p.v - 0.5) * V); }
ed.addEventListener('pointerdown', e => {
  if (!edBase || (setup.mode === 'online' && NET.room2 && !NET.isHost)) return;
  const p = edPos(e), r = ed.getBoundingClientRect(); dragI = -1;
  trackPts.forEach((q, i) => { if (Math.hypot((q.u - p.u) * r.width, (q.v - p.v) * r.height) < 14) dragI = i; });
  if (dragI < 0) { trackPts.push(snapIfCity(p)); dragI = trackPts.length - 1; }
  if (setup.map === 'terrain') hillSeed = null; // edited by hand: no longer the seeded track
  ed.setPointerCapture(e.pointerId); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn();
});
ed.addEventListener('pointermove', e => { if (dragI >= 0) { trackPts[dragI] = setup.map === 'terrain' ? edPos(e) : snapIfCity(edPos(e)); if (setup.map === 'terrain') drawEditor(); else { drawEditor(); } } });
ed.addEventListener('pointerup', () => { if (dragI >= 0) { refreshRoute(); drawEditor(); } dragI = -1; });
$('#btnRand').onclick = () => {
  if (setup.map === 'terrain') newHillTrack(randomSeed());
  else if (setup.map === 'taipei') trackPts = cityPreset(CITY.taipei, presetCycle = (presetCycle + 1) % TP_CIRCUITS.length);
  else return;
  mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn();
};
$('#btnUndo').onclick = () => { trackPts.pop(); hillSeed = null; mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
$('#btnClear').onclick = () => { trackPts = []; hillSeed = null; mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
$('#btnRev').onclick = () => { setup.reverse = !setup.reverse; $('#btnRev').classList.toggle('sel', setup.reverse); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
$('#hillSeed').addEventListener('change', () => { if (setup.map !== 'terrain') return; newHillTrack($('#hillSeed').value); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); });
$('#btnHillStd').onclick = () => { if (setup.map !== 'terrain') return; newHillTrack(HILL_STD); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
addEventListener('resize', () => { if (!$('#setup').hidden) drawEditor(); });
function updateStartBtn() {
  const ok = trackPts.length >= (setup.map === 'terrain' ? 4 : 3) && (setup.map === 'terrain' || CITY[setup.map]);
  $('#btnStart').disabled = !ok;
  $('#btnStart').textContent = state.mode === 'menu' && mapDirty ? '套用並重新開始' : state.mode === 'menu' ? '重新開始' : '開始比賽';
  if (setup.mode === 'online') {
    const inRoom = !!NET.room2, n = netPlayers().length;
    $('#btnStart').disabled = !ok || !inRoom || !NET.isHost || !netCanHost();
    $('#btnStart').textContent = !inRoom ? '先加入房間' : NET.isHost ? `開始比賽（${n} 人）` : '等待房主開始';
  }
  $('#btnResume').hidden = !(state.mode === 'menu' && !mapDirty);
  $('#tutReplay').disabled = !ok; // the lesson runs solo, so only the track matters
}
let prevMode = 'race', wakeLock = null;
function openMenu() {
  if (state.mode === 'menu' || state.mode === 'menu0') return; prevMode = state.mode; state.mode = 'menu';
  $('#pLap').textContent = state.lap || '–'; $('#pBest').textContent = fmt(state.best); $('#pLast').textContent = fmt(state.last);
  $('#pause').hidden = false; for (const k in keys) keys[k] = false;
  $('#pRestart').hidden = setup.mode === 'online' && !NET.isHost;
  const cb = $('#pClearBest'); cb.hidden = RACE.on || !(state.best < Infinity); cb.textContent = '清除此賽道紀錄'; delete cb.dataset.arm;
}
// two taps: the first arms the button, the second clears the stored best lap and ghost of this track
$('#pClearBest').onclick = () => {
  const cb = $('#pClearBest'); if (!cb.dataset.arm) { cb.dataset.arm = '1'; cb.textContent = '再按一次確認清除'; return; }
  clearBest(); cb.hidden = true; $('#pBest').textContent = fmt(state.best); banner('已清除此賽道紀錄', 'info');
};
function resume() { if (mapDirty && !$('#setup').hidden) return; $('#setup').hidden = true; $('#pause').hidden = true; state.mode = prevMode; startAudio(); keepAwake(); }
function keepAwake() { try { if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {}); } catch (e) { /* not offered here */ } }
function startRace(fromNet) {
  if (setup.mode === 'online' && !fromNet) { if (!NET.room2 || !NET.isHost) return; if (!netCanHost()) return; netHostGo(); return; }
  readSetup(); startAudio(); keepAwake();
  const go = () => {
    if (mapDirty) { buildWorld(); mapDirty = false; }
    resetRace(); camInit = false; autoHold(4);
    setupGrid(); if (!RACE.on) loadBest();
    $('#setup').hidden = true; $('#pause').hidden = true; $('#busy').hidden = true;
    state.mode = 'lights'; state.lightsT = 0; state.lightsOut = 4.2 + Math.random() * 1.2; $('#lights').hidden = false;
    NOTE.road = ''; NOTE.pending = '';
    if (setup.preview !== false && setup.mode !== 'online' && W.corners && !TUT.on) startPreview();
    if (COARSE && innerHeight > innerWidth && state.mode !== 'preview') banner('橫向握持手機，視野更寬', 'info');
  };
  if (mapDirty) { $('#busy').textContent = setup.map !== 'terrain' ? '生成街道與建物中…' : '生成地形中…'; $('#busy').hidden = false; setTimeout(go, 30); } else go();
}
$('#btnResume').onclick = resume;
$('#btnStart').onclick = () => startRace();
$('#menuBtn').onclick = openMenu;
$('#pResume').onclick = resume;
$('#pRestart').onclick = () => startRace();
$('#pSetup').onclick = () => { $('#pause').hidden = true; $('#setup').hidden = false; drawEditor(); updateStartBtn(); };
$('#bCam').onclick = () => nextCam();
$('#bReset').onclick = () => resetToTrack();
$('#bTele').onclick = () => { $('#tele').hidden = !$('#tele').hidden; $('#bTele').classList.toggle('on', !$('#tele').hidden); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state.mode === 'race' || state.mode === 'lights') openMenu(); } else if (state.mode === 'race') keepAwake(); });
// settings pages
document.querySelectorAll('.step').forEach(b => b.onclick = () => {
  document.querySelectorAll('.step').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-selected', x === b); });
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.pane; });
});
document.querySelectorAll('#steerMode button').forEach(b => b.onclick = () => { setup.steerMode = b.dataset.s; applyControls(); savePrefs(); });
document.querySelectorAll('#quality button').forEach(b => b.onclick = () => { setup.quality = b.dataset.q; document.querySelectorAll('#quality button').forEach(x => x.classList.toggle('sel', x === b)); setQuality(); savePrefs(); });
if (document.fullscreenEnabled) { $('#btnFull').hidden = false; $('#btnFull').onclick = () => { document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); }; }
// per-viewer preferences
function savePrefs() { try { localStorage.setItem('tgp-prefs', JSON.stringify({ nick: $('#nick').value, steerSens: setup.steerSens, steerMode: setup.steerMode, autogas: setup.autogas, quality: setup.quality, assist: setup.assist, sound: !muted, level: setup.level, volume, turnHints: setup.turnHints, preview: setup.preview, lineGuide: setup.lineGuide, tod: ATMO.tod, rain: ATMO.rain, tut: TUT.done, wideCorners: setup.wideCorners })); } catch (e) { /* storage unavailable */ } }
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('tgp-prefs') || 'null'); if (!p) return;
    if (p.nick) $('#nick').value = p.nick; if (p.steerSens) $('#steer').value = p.steerSens; if (p.steerMode) setup.steerMode = p.steerMode; if (p.quality) setup.quality = p.quality; if (p.level === 'pro' || p.level === 'easy') setup.level = p.level;
    $('#autogas').checked = !!p.autogas; if (typeof p.wideCorners === 'boolean') $('#wideCorners').checked = p.wideCorners; $('#assist').checked = p.assist !== false; $('#sound').checked = p.sound !== false; if (typeof p.volume === 'number') $('#vol').value = Math.round(p.volume * 100); if (p.turnHints === false) $('#turnHints').checked = false; if (p.preview === false) $('#previewOn').checked = false; if (p.lineGuide === false) $('#lineGuide').checked = false; if (ATMO_P[p.tod]) { ATMO.tod = p.tod; $('#tod').value = p.tod; } if (p.rain) { ATMO.rain = true; $('#weather').value = 'rain'; } TUT.done = !!p.tut;
    document.querySelectorAll('#quality button').forEach(x => x.classList.toggle('sel', x.dataset.q === setup.quality));
  } catch (e) { /* storage unavailable */ }
}
// graphics quality: pixel ratio, shadow map, post-processing; "auto" starts at the device default and follows the frame time
const autoLevel = () => COARSE ? 'mid' : 'high';
// pixel ratio for a quality level, also capped by total pixels so big Retina screens don't render 6 MP through the bloom chain
function pixelRatioFor(level) {
  const dprMax = level === 'high' ? 2 : level === 'mid' ? 1.5 : 1, maxPx = level === 'high' ? 3.7e6 : level === 'mid' ? 2.4e6 : 1.3e6;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, dprMax, Math.sqrt(maxPx / (innerWidth * innerHeight))));
}
// the auto ladder, best first: named level (shadows, post), render scale on its pixel ratio, share of the near-model budget
// (trees, barriers), range of the tiles' street detail (m). Tiers 0, 2 and 4 are exactly the fixed high, mid and low.
// Range of the tiles' small street props (AC units, window cages, signs, scooters) per quality, m (P7): instanced by the
// tens of thousands, they cost phones the most, and at speed nobody sees them a block away. window.TGP_DETAIL_R overrides one or all levels.
const DETAIL_R = Object.assign(COARSE ? { high: 300, mid: 150, low: 120 } : { high: 450, mid: 450, low: 450 }, window.TGP_DETAIL_R || {});
const QTIERS = [
  { q: 'high', rs: 1, lod: 1, det: DETAIL_R.high }, { q: 'high', rs: 0.85, lod: 1, det: DETAIL_R.high }, { q: 'mid', rs: 1, lod: 1, det: DETAIL_R.mid }, { q: 'mid', rs: 0.85, lod: 1, det: DETAIL_R.mid },
  { q: 'low', rs: 1, lod: 1, det: DETAIL_R.low }, { q: 'low', rs: 0.85, lod: 0.5, det: Math.round(DETAIL_R.low * 2 / 3) }, { q: 'low', rs: 0.7, lod: 0.25, det: Math.round(DETAIL_R.low * 4 / 9) }];
function pixelRatioNow() {
  if (qTier < 0) return pixelRatioFor(qLevel);
  let pr = Infinity; for (let i = AQ.start; i <= qTier; i++) pr = Math.min(pr, pixelRatioFor(QTIERS[i].q) * QTIERS[i].rs); // never more pixels than a better tier (1x screens)
  return Math.max(0.6, pr);
}
function applyQuality(level, tier = -1) { // a fixed level ('low' | 'mid' | 'high'), or a tier of the auto ladder
  const T = QTIERS[tier], lv = T ? T.q : level; if (lv === qLevel && tier === qTier) return;
  qTier = T ? tier : -1; lodK = T ? T.lod : 1; detailR = T ? T.det : DETAIL_R[lv]; LODS.forEach(L => L.at.set(1e9, 0, 0)); // near models re-picked on the next tile tick
  if (lv !== qLevel) {
    qLevel = lv; const shadows = COARSE ? lv === 'high' : lv !== 'low', size = lv === 'high' ? 2048 : 1024; // phones: shadows only on 高 (P7: 19 -> 28 fps on 中)
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(size, size); sun.castShadow = shadows;
    POST.on = lv === 'high' && setupPost();
    if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }
  }
  resize(); qualityHint();
  if (POST.bloom) POST.bloom.strength = (ATMO_P[ATMO.tod] || ATMO_P.day).bloom; // a fresh composer starts with the daytime bloom
}
// auto: rAF intervals while racing, in one-second windows. Four windows in a row with the 95th percentile above 22 ms (on phones: the mean above 20 ms, under 50 fps) step one
// tier down; forty in a row under 20 ms (no dropped frames) step one back up. A tier that has to be left again after such a
// step up is not offered a third time. When three step downs in a row leave the frame time as it was although the main
// thread has time to spare (a 30 Hz cap), they are undone and auto stays put for the session.
// Not measured: the first seconds after a world build, a new tile, a change or a resume; stalls.
const AQ = { start: 0, ceil: 0, hold: 0, on: false, buf: new Float32Array(512), n: 0, t: 0, b: 0, t0: 0, busy: 0, win: [], bad: 0, good: 0, upTo: [], check: null, useless: 0, from: 0, frozen: false, msg: '' };
function setQuality() {
  if (setup.quality !== 'auto') { applyQuality(setup.quality); return; }
  AQ.start = AQ.ceil = AQ.from = QTIERS.findIndex(T => T.q === autoLevel());
  Object.assign(AQ, { hold: 0, on: false, n: 0, t: 0, b: 0, win: [], bad: 0, good: 0, upTo: [], check: null, useless: 0, frozen: false, msg: '' });
  applyQuality(null, AQ.start);
}
function qualityHint() { const el = $('#qNow'); if (el) el.textContent = (setup.quality === 'auto' && qTier > AQ.start ? '目前已自動調低 ' + (qTier - AQ.start) + ' 級。' : '') + (wantAA(setup.quality) !== AA ? '反鋸齒在重新載入頁面後' + (AA ? '關閉' : '開啟') + '。' : ''); }
function autoHold(s) { AQ.hold = Math.max(AQ.hold, s); AQ.n = AQ.t = AQ.b = 0; }
function autoStep(tier, msg) { applyQuality(null, tier); AQ.bad = AQ.good = 0; AQ.win = []; autoHold(2.5); AQ.msg = msg; }
function autoQuality(rawDt) { // first thing in a frame: rawDt is the previous frame's interval, AQ.busy its time in frame()
  AQ.t0 = performance.now();
  if (AQ.msg && bannerT <= 0 && state.mode === 'race') { banner(AQ.msg, 'info'); AQ.msg = ''; } // after the race's own banners
  if (setup.quality !== 'auto' || qTier < 0 || AQ.frozen) return;
  if (state.mode !== 'race' || RACE.done || document.hidden) { AQ.on = false; return; }
  if (!AQ.on) { AQ.on = true; autoHold(1.5); }
  if (rawDt > 0.25) { autoHold(1); return; } // a stall or a hidden tab, not a frame rate
  if (AQ.hold > 0) { AQ.hold -= rawDt; return; }
  AQ.buf[AQ.n++ & 511] = rawDt * 1000; AQ.b += AQ.busy; if ((AQ.t += rawDt) < 1) return;
  const n = Math.min(AQ.n, 512), p95 = AQ.buf.slice(0, n).sort()[Math.floor(n * 0.95)];
  AQ.win.push({ mean: AQ.t * 1000 / AQ.n, busy: AQ.b / AQ.n }); if (AQ.win.length > 4) AQ.win.shift(); AQ.n = AQ.t = AQ.b = 0;
  const avg = k => AQ.win.reduce((s, w) => s + w[k], 0) / AQ.win.length, c = AQ.check;
  if (c && ++c.w === 3) { // three windows after a step down, against the slow ones before it
    AQ.check = null;
    if (avg('mean') > c.mean * 0.96 && c.busy < c.mean * 0.5) { if (++AQ.useless === 1) AQ.from = c.from; } else AQ.useless = 0;
    if (AQ.useless >= 3) { AQ.frozen = true; autoStep(AQ.from, '已恢復原本畫質'); return; }
  }
  AQ.bad = (COARSE ? AQ.win[AQ.win.length - 1].mean > 20 : p95 > 22) ? AQ.bad + 1 : 0; AQ.good = p95 < 20 ? AQ.good + 1 : 0; // phones: under 50 fps on average for 4 s steps down
  if (AQ.bad >= 4 && qTier < QTIERS.length - 1) {
    if (AQ.upTo[qTier]) AQ.ceil = qTier + 1; // this tier already had its second chance
    AQ.check = { w: 0, mean: avg('mean'), busy: avg('busy'), from: qTier };
    autoStep(qTier + 1, '畫面自動調整為流暢模式');
  } else if (AQ.good >= 40 && qTier > AQ.ceil) {
    AQ.upTo[qTier - 1] = 1; AQ.check = null; AQ.useless = 0;
    autoStep(qTier - 1, '畫面很順，自動提高畫質');
  }
}

/* ================= Opponents: computer drivers and online players ================= */
const AI_COLORS = ['#1f5bff', '#ff8a00', '#12a596', '#e3e7ec', '#7a3cff', '#f2c400', '#00a3e0', '#2e7d32', '#ff4f9a', '#9aa3ad'];
const AI_NAMES = ['藍隼', '橘焰', '青嵐', '銀翼', '紫電', '金鋒', '天藍', '綠野', '粉影', '灰狼'];
const RACE = { on: false, done: false, cars: [], prof: null, ks: null, finT: NaN, go() { RACE.cars.forEach(c => { c.delay = 0.15 + Math.random() * 0.4; }); } };
function nameTag(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,.72)'; g.fillRect(0, 8, 256, 48); g.fillStyle = color; g.fillRect(0, 8, 10, 48);
  g.fillStyle = '#fff'; g.font = '600 30px "Noto Sans TC", sans-serif'; g.textBaseline = 'middle'; g.fillText(text.slice(0, 10), 22, 33);
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(3.4, 0.85, 1); sp.position.set(0, 2.2, 0); return sp;
}
function disposeModel(m) { scene.remove(m.root); m.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
function gridSlot(i) { const n = W.n; return { k: ((n - 8 - i * 5) % n + n) % n, lat: (i % 2 ? -1 : 1) * Math.min(2.8, Math.min(W.hwL[((n - 8 - i * 5) % n + n) % n], W.hwR[((n - 8 - i * 5) % n + n) % n]) - 1.8) }; }
// Speed a path allows at each sample: cornering limit with downforce, then braking (backward) and traction (forward) passes.
// K = |curvature| along the path, step[k] = path length from sample k to k + 1
function speedProfile(K, step) {
  const n = W.n, ae = aeroOf(0.5), kA = 0.5 * 1.2 * ae.ClA / SPEC.m, mu = 1.72 * ATMO.grip, v = new Float32Array(n); // below the tyres' tarmac peak (1.9): this pace also sets the beginner brake assist
  for (let k = 0; k < n; k++) v[k] = Math.min(94, K[k] > mu * kA + 1e-5 ? Math.sqrt(mu * G / (K[k] - mu * kA)) : 94);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 2 * n - 1; i >= 0; i--) { const k = i % n, nk = (k + 1) % n, ab = mu * (G + kA * v[nk] * v[nk]) * 0.82; v[k] = Math.min(v[k], Math.sqrt(v[nk] * v[nk] + 2 * ab * step[k])); }
    for (let i = 0; i < 2 * n; i++) { const k = i % n, pk = (k - 1 + n) % n, gr = (W.h[k] - W.h[pk]) / step[pk]; v[k] = Math.min(v[k], Math.sqrt(v[pk] * v[pk] + 2 * Math.max(0.5, accelAt(v[pk]) - G * gr) * step[pk])); }
  }
  return v;
}
// Minimum-curvature racing line: lateral offset (+ = left) minimising the summed squared second difference of the path,
// 1.6 m inside each edge. Gauss-Seidel with over-relaxation, coarse to fine: plain relaxation barely moves the long, gentle shapes.
function racingLine() {
  const n = W.n, ds = W.ds, E = new Float32Array(n);
  for (const spacing of [64, 32, 16, 8]) {
    const h = Math.max(1, Math.round(spacing / ds)), m = Math.max(8, Math.floor(n / h));
    const idx = Int32Array.from({ length: m }, (_, i) => Math.round(i * n / m) % n);
    const cx = new Float64Array(m), cz = new Float64Array(m), lx = new Float64Array(m), lz = new Float64Array(m), lo = new Float64Array(m), hi = new Float64Array(m), e = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const k = idx[i], w = Math.max(1, Math.round(4 / ds)); let a = Infinity, b = Infinity;
      for (let o = -w; o <= w; o++) { const j = (k + o + n) % n; a = Math.min(a, W.hwR[j]); b = Math.min(b, W.hwL[j]); } // narrowest width near the node
      cx[i] = W.x[k]; cz[i] = W.z[k]; lx[i] = W.lx[k]; lz[i] = W.lz[k]; lo[i] = -Math.max(0, a - 1.6); hi[i] = Math.max(0, b - 1.6); e[i] = clamp(E[k], lo[i], hi[i]);
    }
    // positions of the line points kept in arrays and updated with e (same arithmetic as computing them on the fly, a few times faster)
    const PX = Float64Array.from(cx, (v, i) => v + lx[i] * e[i]), PZ = Float64Array.from(cz, (v, i) => v + lz[i] * e[i]), w = new Float64Array(m).fill(1);
    const prv = Int32Array.from({ length: m }, (_, i) => (i - 1 + m) % m), nxt = Int32Array.from({ length: m }, (_, i) => (i + 1) % m);
    const dx = i => PX[prv[i]] - 2 * PX[i] + PX[nxt[i]], dz = i => PZ[prv[i]] - 2 * PZ[i] + PZ[nxt[i]];
    // weighted sum of w_i |D_i|^2; on the finest level the weights grow with the curvature (iteratively reweighted), which
    // trades a little overall smoothness for flatter peaks: the tightest point of a corner is what sets its speed
    for (let round = 0; round < (spacing === 8 ? 6 : 1); round++) {
      if (round) { let mean = 0; for (let i = 0; i < m; i++) mean += Math.hypot(dx(i), dz(i)) / m; for (let i = 0; i < m; i++) { const r = Math.hypot(dx(i), dz(i)) / (mean || 1); w[i] = 1 + r * r; } }
      for (let it = 0; it < 3000; it++) {
        let moved = 0;
        for (let i = 0; i < m; i++) {
          const a1 = prv[i], b1 = nxt[i], wa = w[a1], wi = w[i], wb = w[b1];
          // d/de_i of sum w_j |D_j|^2: point i is in D[i-1], D[i], D[i+1] with weights 1, -2, 1
          const rx = wa * dx(a1) - 2 * wi * dx(i) + wb * dx(b1), rz = wa * dz(a1) - 2 * wi * dz(i) + wb * dz(b1);
          const ne = clamp(e[i] - 1.7 * (lx[i] * rx + lz[i] * rz) / (wa + 4 * wi + wb), lo[i], hi[i]); moved = Math.max(moved, Math.abs(ne - e[i])); e[i] = ne;
          PX[i] = cx[i] + lx[i] * ne; PZ[i] = cz[i] + lz[i] * ne;
        }
        if (moved < 2e-4) break;
      }
    }
    for (let i = 0; i < m; i++) { // every sample, for the next level's start and the result
      const k0 = idx[i], span = ((idx[(i + 1) % m] - k0 + n) % n) || n;
      for (let j = 0; j < span; j++) E[(k0 + j) % n] = e[i] + (e[(i + 1) % m] - e[i]) * j / span;
    }
  }
  smoothCirc(E, Math.max(1, Math.round(4 / ds)), 2);
  for (let k = 0; k < n; k++) E[k] = clamp(E[k], -Math.max(0, W.hwR[k] - 1.4), Math.max(0, W.hwL[k] - 1.4));
  const X = k => W.x[k] + W.lx[k] * E[k], Z = k => W.z[k] + W.lz[k] * E[k];
  const step = new Float32Array(n), K = new Float32Array(n), st = 3, hx = new Float32Array(n), hz = new Float32Array(n);
  for (let k = 0; k < n; k++) { const b = (k + 1) % n; step[k] = Math.max(0.05, Math.hypot(X(b) - X(k), Z(b) - Z(k))); }
  for (let k = 0; k < n; k++) { const a = (k - 1 + n) % n, b = (k + 1) % n, tx = X(b) - X(a), tz = Z(b) - Z(a), l = Math.hypot(tx, tz) || 1; hx[k] = tx / l; hz[k] = tz / l; }
  for (let k = 0; k < n; k++) { // turn of the heading over +-st samples, per metre of path (as the centreline's kappa)
    const a = (k - st + n) % n, b = (k + st) % n; let s2 = 0; for (let j = -st; j < st; j++) s2 += step[(k + j + n) % n];
    K[k] = Math.abs(Math.atan2(hx[a] * hz[b] - hz[a] * hx[b], hx[a] * hx[b] + hz[a] * hz[b])) / s2;
  }
  smoothCirc(K, 3, 2); smoothCirc(K, 3, 2);
  return { E, K, step };
}
function buildProfile() {
  const n = W.n, ds = W.ds;
  const K = Float32Array.from(W.kappa, Math.abs); smoothCirc(K, 3, 2);
  const paceRef = speedProfile(K, new Float32Array(n).fill(ds)); // plain centreline pace: the yardstick for the computer drivers' speed
  { // a short sharp corner (a junction cut, say) averages away in the smoothing: keep most of its local peak
    const raw = Float32Array.from(W.kappa, Math.abs), w = Math.max(2, Math.round(8 / ds));
    for (let k = 0; k < n; k++) { let m = 0; for (let o = -w; o <= w; o++) m = Math.max(m, raw[(k + o + n) % n]); K[k] = Math.max(K[k], 0.85 * m); }
  }
  RACE.prof = speedProfile(K, new Float32Array(n).fill(ds)); // centreline pace: turn hints, brake assist, the preview lap
  const L = racingLine(); RACE.line = L.E; RACE.lineStep = L.step; RACE.lineProf = speedProfile(L.K, L.step);
  // computer drivers take the line but keep their old lap times: the line is 2-5 % quicker and the difficulty slider was tuned without it
  let tc = 0, tl = 0; for (let k = 0; k < n; k++) { tc += ds / paceRef[k]; tl += L.step[k] / RACE.lineProf[k]; }
  RACE.linePace = clamp(tl / tc, 0.9, 1);
  const ks = Float32Array.from(W.kappa); smoothCirc(ks, Math.round(30 / ds), 2);
  RACE.ks = ks;
}
const accelAt = v => clamp(SPEC.Pmax * 0.82 / (SPEC.m * Math.max(v, 4)), 0, 12.5) - 0.5 * 1.2 * aeroOf(0.5).CdA * v * v / SPEC.m;
function clearOpponents() { RACE.cars.forEach(c => disposeModel(c.model)); RACE.cars = []; }
function setupGrid() {
  clearOpponents(); $('#results').hidden = true;
  RACE.on = setup.mode !== 'solo'; RACE.done = false; RACE.finT = NaN;
  if (!RACE.on) { placeCar(3, 0); return; }
  buildProfile();
  let mySlot = 0;
  if (setup.mode === 'ai') {
    const cnt = Math.min(setup.aiCount, COARSE ? 7 : 9); mySlot = Math.floor(cnt / 2);
    const base = 0.86 + setup.aiSkill * 0.13;
    for (let i = 0, a = 0; i <= cnt; i++) {
      if (i === mySlot) continue;
      const g = gridSlot(i), col = AI_COLORS[a % AI_COLORS.length], model = buildCar(col, false, true);
      model.root.add(nameTag(AI_NAMES[a % AI_NAMES.length], col)); scene.add(model.root);
      RACE.cars.push({ name: AI_NAMES[a % AI_NAMES.length], color: col, model, s: g.k * W.ds - W.len, lat: g.lat, latV: 0, v: 0, lap: -1, lapT0: 0, best: Infinity, finT: NaN, delay: 99,
        skill: clamp(base + (Math.random() - 0.5) * 0.035 - (cnt - i) * 0.002, 0.8, 1.0), wheel: 0 });
      a++;
    }
  } else mySlot = netMySlot();
  const g = gridSlot(mySlot); placeCar(g.k, g.lat);
  RACE.cars.forEach(c => poseOpponent(c));
}
const playerProgress = () => state.lap >= 1 ? (state.lap - 1) * W.len + car.k * W.ds : car.k * W.ds - W.len;
const wrapGap = d => { const L = W.len; d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; };
function poseOpponent(c) {
  const L = W.len, n = W.n, sm = ((c.s % L) + L) % L, f = sm / W.ds, k = Math.floor(f) % n, k1 = (k + 1) % n, t = f - Math.floor(f);
  const lx = W.lx[k] + (W.lx[k1] - W.lx[k]) * t, lz = W.lz[k] + (W.lz[k1] - W.lz[k]) * t;
  const x = W.x[k] + (W.x[k1] - W.x[k]) * t + lx * c.lat, z = W.z[k] + (W.z[k1] - W.z[k]) * t + lz * c.lat;
  c.k = k; c.x = x; c.z = z; c.psi = Math.atan2(-lx, -lz) + Math.atan2(c.latV, Math.max(c.v, 2));
  poseModel(c.model, x, z, c.psi, k);
  const tag = c.model.root.children[c.model.root.children.length - 1]; if (tag && tag.isSprite) tag.visible = camera.position.distanceToSquared(c.model.root.position) > 144;
  c.wheel += c.v / SPEC.rw * (1 / 60);
  for (const w of c.model.wheels) { w.spin.rotation.z = -c.wheel; if (w.front) w.pivot.rotation.y = Math.atan(W.kappa[k] * SPEC.L); }
}
function poseModel(mdl, x, z, psi, k = -1) {
  const y = Sq(x, z, k); normalS(x, z, k, nrm);
  fp.set(Math.cos(psi), 0, -Math.sin(psi)); fp.addScaledVector(nrm, -fp.dot(nrm)).normalize(); rt.crossVectors(fp, nrm);
  m4.makeBasis(fp, nrm, rt); mdl.root.quaternion.setFromRotationMatrix(m4); mdl.root.position.set(x, y, z);
}
// Racecraft on top of the racing line: slipstream, committed overtakes (inside of the next corner, or the side with room),
// one defensive move to the inside, keeping a car's width when side by side, and now and then a late brake that runs wide.
function opponentsStep(dt) {
  if (!RACE.on) return;
  const L = W.len, n = W.n, pv = Math.hypot(car.vx, car.vy);
  const others = [{ s: playerProgress(), lat: car.lat, v: pv }, ...RACE.cars];
  for (const r of NET.remote.values()) if (r.inRace) others.push({ s: r.prog, lat: r.lat || 0, v: r.v || 0 });
  for (const c of RACE.cars) {
    if (state.t < c.delay) { poseOpponent(c); continue; }
    const sm = ((c.s % L) + L) % L, k = Math.floor(sm / W.ds) % n;
    const cool = c.finT >= 0 ? 0.75 : 1; let lo = -(W.hwR[k] - 1.2), hi = W.hwL[k] - 1.2;
    const lead = (k + Math.round(Math.max(6, c.v * 0.7) / W.ds)) % n;
    const turn = Math.sign(RACE.ks[(k + Math.round(Math.max(40, c.v * 2.5) / W.ds)) % n]); // inside of the next corner (+ = left)
    const straight = Math.abs(RACE.ks[k]) < 1 / 400;
    let vT = RACE.lineProf[k] * RACE.linePace * c.skill * cool, latT = RACE.line[lead], latRate = 3.2;
    if (c.aggr === undefined) { c.aggr = clamp(0.35 + c.skill * 0.5 + (Math.random() - 0.5) * 0.3, 0.2, 1); c.pass = null; c.defT = 0; c.errT = 0; }
    // a mistake: braking a little late into a corner, then running wide and losing speed
    const braking = RACE.lineProf[(k + Math.round(30 / W.ds)) % n] < RACE.lineProf[k] - 4;
    if (c.errT <= 0 && braking && Math.random() < dt * (1 - c.skill) * 0.25) c.errT = 2.2;
    if (c.errT > 0) { c.errT -= dt; if (c.errT > 1.4) vT *= 1.06; else { vT *= 0.86; latT = -turn * (Math.min(W.hwL[k], W.hwR[k]) - 1.4); } }
    // a stopped car ahead (a spun or parked player, a car stuck at the wall), from braking distance on: keep to its free side, a car's width
    // (2.4 m) off its line, so every rule below works inside that lane; no such lane: brake to a crawl 9 m behind it and squeeze through the widest gap
    let stop = null, side = 0;
    for (const o of others) { if (o === c || o.v >= 4 || state.t < (o.delay || 0)) continue; const d = wrapGap(o.s - c.s); if (d > -5 && d < 25 + c.v * c.v / 40 && (!stop || d < stop.d)) stop = { o, d }; }
    if (stop) {
      const o = stop.o, roomL = hi - o.lat, roomR = o.lat - lo, cur = c.lat >= o.lat ? 1 : -1;
      side = (cur > 0 ? roomL : roomR) >= 2.4 ? cur : (cur > 0 ? roomR : roomL) >= 2.4 ? -cur : 0;
      if (side > 0) lo = o.lat + 2.4; else if (side < 0) hi = o.lat - 2.4; else if (stop.d > 0) vT = Math.min(vT, Math.max(3, Math.sqrt(24 * Math.max(0, stop.d - 9))));
    }
    let ahead = null, behind = null;
    for (const o of others) {
      if (o === c) continue;
      const d = wrapGap(o.s - c.s), dl = o.lat - c.lat;
      if (d > 0 && d < 40 && (!ahead || d < ahead.d)) ahead = { o, d };
      if (d < 0 && d > -18 && (!behind || d > behind.d)) behind = { o, d };
      const stopped = o.v < 4; // a stopped car (a spun player, say) is something to drive round, not a pace to match
      if (Math.abs(d) < 5 && Math.abs(dl) < 2.3) { // side by side: keep a car's width, the one behind gives way
        const away = Math.sign(-dl) || (c.lat > 0 ? -1 : 1); latT = clamp(o.lat + away * 2.4, lo, hi); latRate = 4;
        if (d > 0.5) vT = Math.min(vT, stopped ? 6 : o.v);
      }
      if (d > 0 && d < 8 && Math.abs(dl) < 2.0) vT = Math.min(vT, stopped ? Math.max(3, (d - 3) * 1.5) : o.v - (8 - d) * 0.8); // nose to a gearbox: drop back to 8 m until clear to the side
    }
    if (ahead) {
      const { o, d } = ahead, dl = o.lat - c.lat;
      if (straight && d > 5 && d < 30 && Math.abs(dl) < 1.6) vT *= 1.03; // slipstream
      const closing = c.v > o.v + 0.3 || vT > o.v + 1;
      if (c.pass && c.pass.o !== o) c.pass = null;
      if (!c.pass && (closing || o.v < 4) && d < 32 && Math.abs(dl) < 2.4) { // commit to a side: inside of the next corner if there is room, else the wider side
        const roomL = hi - o.lat, roomR = o.lat - lo, want = turn || (roomL > roomR ? 1 : -1);
        const side = (want > 0 ? roomL : roomR) >= 2.4 ? want : (want > 0 ? roomR : roomL) >= 2.4 ? -want : 0;
        if (side) c.pass = { o, side, t: 0 };
        else if (o.v < 4) c.pass = { o, side: roomL > roomR ? 1 : -1, t: 0 }; // squeeze past a stopped car on the wider side
      }
      if (c.pass) {
        c.pass.t += dt; latT = clamp(o.lat + c.pass.side * 2.6, lo, hi); latRate = 3.8;
        if (Math.abs(latT - o.lat) < 2.2 && d < 9) vT = Math.min(vT, o.v < 4 ? 5 : o.v + Math.max(0, d - 6) * 0.6); // squeezed: wait (or creep past a stopped car)
        if (c.pass.t > 7) c.pass = null;
      } else if (d < 26 && Math.abs(dl) < 2.3) vT = Math.min(vT, o.v + Math.max(0, d - 8) * 0.6); // no room: follow
    } else c.pass = null;
    // defend: a quicker car close behind and a corner coming, so cover the inside once
    if (behind && behind.d < -8 && c.defT <= 0 && c.aggr > 0.45 && behind.o.v > c.v + 0.8 && turn && !c.pass) c.defT = 3.5; // not once they are alongside
    if (c.defT > 0) { c.defT -= dt; if (c.defT > 1.8 && !c.pass && c.errT <= 0) latT = clamp(turn * Math.min(Math.abs(lo), hi) * 0.7, lo, hi); }
    if (side) { // in the lane beside a stopped car: aim 2.8 m off its line, and slow down if the move to 2.15 m (clear of it) would not be done before the noses meet
      const o = stop.o, e = side * (o.lat + side * 2.15 - c.lat); latT = side > 0 ? clamp(latT, Math.min(lo + 0.4, hi), hi) : clamp(latT, lo, Math.max(hi - 0.4, lo)); latRate = Math.max(latRate, 3.8);
      const D = Math.abs(latT - c.lat); if (e > 0 && stop.d > -2) vT = Math.min(vT, o.v + Math.max(0, stop.d - 5) * 1.1 / Math.log(Math.max(1.01, D / Math.max(0.05, D - e)))); // the lateral move closes in on latT at 1.1/s
    }
    c.stuckT = c.v < 2 && c.finT !== c.finT ? (c.stuckT || 0) + dt : 0; // watchdog: stopped for 2 s, crawl out to the widest gap
    if (c.stuckT > 2) { latT = (hi - c.lat > c.lat - lo) ? hi : lo; vT = Math.max(vT, 5); latRate = 4; }
    if (c.v < vT) c.v = Math.min(vT, c.v + accelAt(c.v) * (0.88 + 0.12 * c.skill) * dt); else c.v = Math.max(vT, c.v - 34 * dt);
    c.latV = clamp((latT - c.lat) * 1.1, -latRate, latRate); c.lat = clamp(c.lat + c.latV * dt, -(W.hwR[k] - 1), W.hwL[k] - 1);
    c.s += c.v * dt * W.ds / RACE.lineStep[k]; // c.s is centreline distance; the line is shorter through a corner
    const done = Math.floor(c.s / L);
    if (done > c.lap) {
      if (c.lap >= 0) c.best = Math.min(c.best, state.t - c.lapT0);
      c.lap = done; c.lapT0 = state.t;
      if (c.lap >= setup.laps && !(c.finT >= 0)) c.finT = state.t;
    }
    poseOpponent(c);
  }
  separateOpponents(dt); for (const c of RACE.cars) if (state.t >= c.delay) poseOpponent(c); // computer cars never drive through each other: pose again after
  // contact with the player: two circles per car (nose and tail), the player's car is the one pushed
  for (const c of RACE.cars) if (bump(c)) { const kk = Math.floor((((c.s % L) + L) % L) / W.ds) % n, hk = Math.min(W.hwL[kk], W.hwR[kk]); c.v *= 0.97; c.lat = clamp(c.lat + Math.sign(c.lat - car.lat || 1) * 0.3, -(hk - 1), hk - 1); }
  for (const r of NET.remote.values()) if (r.inRace && r.x !== undefined) bump(r);
}
// Computer cars against each other, in track coordinates (s along the centreline, lat across): an overlapping pair is
// pushed apart sideways, or the car behind drops back when there is no room (P1, docs/賽道修正_2026-10.md).
/* P1-begin: separateOpponents (written by the collaborating AI from the spec in docs/賽道修正_2026-10.md; changes marked 「改」) */
function _oppTrackIdx(s) {
  const L = W.len, sMod = ((s % L) + L) % L;
  let k = Math.floor(sMod / W.ds);
  if (k >= W.n) k = W.n - 1; else if (k < 0) k = 0;
  return k;
}
// 改: s is measured along the centreline, so on the inside of a tight corner two cars 8 m apart in s can stand on each other
// (the campus loop's first corner). This is how many metres a car moves per metre of s at this offset, from the geometry.
function _oppLatScale(kA, kB, lat) {
  const n = W.n; let d = ((kB - kA) % n + n) % n; if (d > n / 2) { const t = kA; kA = kB; kB = t; d = n - d; }
  if (!d) { kB = (kA + 1) % n; d = 1; }
  const x0 = W.x[kA] + W.lx[kA] * lat, z0 = W.z[kA] + W.lz[kA] * lat, x1 = W.x[kB] + W.lx[kB] * lat, z1 = W.z[kB] + W.lz[kB] * lat;
  return clamp(Math.hypot(x1 - x0, z1 - z0) / (d * W.ds), 0.15, 2);
}
// 改: where the centreline turns sharply (junction corners), the line at a fixed offset on the inside folds back on itself and
// two cars 8 m apart in s land on the same spot. Per sample, the largest offset on each side whose line still runs forward.
function _oppFoldLimits() {
  if (W._fold && W._fold.x === W.x) return W._fold;
  const n = W.n, L = new Float32Array(n), R = new Float32Array(n), seg = (k, lat) => { const j = (k + 1) % n, x0 = W.x[k] + W.lx[k] * lat, z0 = W.z[k] + W.lz[k] * lat, x1 = W.x[j] + W.lx[j] * lat, z1 = W.z[j] + W.lz[j] * lat;
    return ((x1 - x0) * (W.x[j] - W.x[k]) + (z1 - z0) * (W.z[j] - W.z[k])) / (W.ds * W.ds); }; // forward progress of the offset line per metre of centreline
  for (let k = 0; k < n; k++) for (const [arr, sd, hw] of [[L, 1, W.hwL[k]], [R, -1, W.hwR[k]]]) {
    let lim = hw;
    for (let o = -3; o <= 3; o++) { const kk = (k + o + n) % n; for (let l = 0.5; l <= hw; l += 0.25) if (seg(kk, sd * l) < 0.35) { lim = Math.min(lim, l - 0.25); break; } }
    arr[k] = Math.max(0, lim);
  }
  return (W._fold = { x: W.x, L, R });
}
const OPP_LONG_RATE = 6; // 改: m/s; the car behind drops back at most this fast when there is no room beside, instead of jumping up to 4.6 m in one frame
function separateOpponents(dt) {
  if (!RACE.on) return;
  const L = W.len, maxLatStep = 3.0 * dt, active = [];
  const FL = _oppFoldLimits();
  for (const c of RACE.cars) if (state.t >= c.delay) {
    const k = _oppTrackIdx(c.s); c.lat = clamp(c.lat, -Math.max(0, FL.R[k] - 1.0), Math.max(0, FL.L[k] - 1.0)); // 改: off the folded inside of a sharp corner
    active.push({ c, sMod: ((c.s % L) + L) % L, remPos: maxLatStep, remNeg: maxLatStep });
  }
  const m = active.length;
  if (m < 2) return;
  active.sort((a, b) => a.sMod - b.sMod);
  const seen = new Set();
  for (let i = 0; i < m; i++) {
    for (let offset = 1; offset <= 2 && offset < m; offset++) { // neighbours in track order, across the start line too: three abreast at most
      const j = (i + offset) % m, p1 = i < j ? i : j, p2 = i < j ? j : i, pairKey = p1 * 32 + p2;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const wa = active[i], wb = active[j], a = wa.c, b = wb.c;
      const ds = wrapGap(a.s - b.s);
      if (Math.abs(ds) >= 12) continue; // 改: wider window, the corner scale below can shrink it to 4.6 m
      const dlat = a.lat - b.lat, absDlat = Math.abs(dlat);
      if (absDlat >= 2.0) continue;
      const kA = _oppTrackIdx(a.s), minA = -Math.min(W.hwR[kA] - 1.2, FL.R[kA] - 1.0), maxA = Math.min(W.hwL[kA] - 1.2, FL.L[kA] - 1.0);
      const kB = _oppTrackIdx(b.s), minB = -Math.min(W.hwR[kB] - 1.2, FL.R[kB] - 1.0), maxB = Math.min(W.hwL[kB] - 1.2, FL.L[kB] - 1.0);
      const f = _oppLatScale(kA, kB, (a.lat + b.lat) / 2), absDs = Math.abs(ds) * f; // 改: distance along the cars' own path
      if (absDs >= 4.6) continue;
      const aIsHi = dlat > 0 || (dlat === 0 && ds < 0);
      const wHi = aIsHi ? wa : wb, wLo = aIsHi ? wb : wa, hi = wHi.c, lo = wLo.c;
      const minHi = aIsHi ? minA : minB, maxHi = aIsHi ? maxA : maxB, minLo = aIsHi ? minB : minA, maxLo = aIsHi ? maxB : maxA;
      const curSpan = hi.lat - lo.lat, ovLat = 2.0 - curSpan;
      const roomHi = Math.max(0, maxHi - hi.lat), roomLo = Math.max(0, lo.lat - minLo);
      const front = ds >= 0 ? a : b, rear = ds >= 0 ? b : a;
      if (roomHi + roomLo > ovLat + 1e-6) { // room beside: each moves half the overlap away, at most 3 m/s; one at its edge, the other takes it all
        const targetOv = 2.0 + 1e-7 - curSpan;
        let wantHi = 0.5 * targetOv, wantLo = 0.5 * targetOv;
        if (wantHi > roomHi) { wantHi = roomHi; wantLo = Math.min(roomLo, targetOv - wantHi); }
        else if (wantLo > roomLo) { wantLo = roomLo; wantHi = Math.min(roomHi, targetOv - wantLo); }
        const stepHi = Math.min(wantHi, wHi.remPos), stepLo = Math.min(wantLo, wLo.remNeg);
        hi.lat = clamp(hi.lat + stepHi, minHi, maxHi); lo.lat = clamp(lo.lat - stepLo, minLo, maxLo);
        wHi.remPos -= stepHi; wLo.remNeg -= stepLo;
        if (absDs > 1e-4) { // still nearly on top of each other this frame: the car behind backs off just enough
          const newDlat = hi.lat - lo.lat, minSafeDist = 1.25;
          if (absDs * absDs + newDlat * newDlat < minSafeDist * minSafeDist) {
            const reqDs = Math.min(4.6, Math.sqrt(Math.max(0, minSafeDist * minSafeDist - newDlat * newDlat))), pushBack = Math.min(4.6 - absDs, reqDs - absDs);
            if (pushBack > 0) { rear.s -= pushBack / f; if (rear.v > front.v * 0.95) rear.v = front.v * 0.95; }
          }
        }
      } else { // no room beside: the car behind drops back (改: gradually, OPP_LONG_RATE, but never closer than 1.25 m centre to centre)
        const ovS = 4.6 - absDs, need = Math.max(0, Math.sqrt(Math.max(0, 1.25 * 1.25 - absDlat * absDlat)) - absDs);
        rear.s -= Math.min(ovS, Math.max(need, OPP_LONG_RATE * dt)) / f;
        if (rear.v > front.v * 0.95) rear.v = front.v * 0.95;
      }
    }
  }
}
/* P1-end */
function bump(o) {
  if (o.x === undefined) return false;
  const cf = [Math.cos(car.psi), -Math.sin(car.psi)], cl = [-Math.sin(car.psi), -Math.cos(car.psi)], of = [Math.cos(o.psi), -Math.sin(o.psi)];
  let hit = false; const d0 = car.x + car.z;
  for (const a of [1.25, -1.25]) for (const b of [1.25, -1.25]) {
    const dx = car.x + cf[0] * a - (o.x + of[0] * b), dz = car.z + cf[1] * a - (o.z + of[1] * b), d = Math.hypot(dx, dz);
    if (d >= 2.1 || d < 1e-3) continue;
    const nx = dx / d, nz = dz / d; car.x += nx * (2.1 - d); car.z += nz * (2.1 - d);
    let Vx = car.vx * cf[0] + car.vy * cl[0], Vz = car.vx * cf[1] + car.vy * cl[1];
    const vn = (Vx - o.v * of[0]) * nx + (Vz - o.v * of[1]) * nz;
    if (vn < 0) { Vx -= 0.7 * vn * nx; Vz -= 0.7 * vn * nz; car.vx = Vx * cf[0] + Vz * cf[1]; car.vy = Vx * cl[0] + Vz * cl[1]; car.r *= 0.7; hit = true; }
  }
  if (hit || d0 !== car.x + car.z) { // a push never moves the player's car through the barrier (it used to, by up to a metre, at the start)
    const lc = trackLocate(car.x, car.z, car.k), wc = wallContact(car.x, car.z, lc.k, lc.lat);
    if (wc && wc.d < 1.0) { car.x += wc.nx * (1.0 - wc.d); car.z += wc.nz * (1.0 - wc.d); }
  }
  return hit;
}
function playerFinished() {
  RACE.done = true; RACE.finT = state.t;
  banner('完賽！', 'good');
  setTimeout(() => { if (RACE.done) { renderResults(); $('#results').hidden = false; } }, 1200);
}
function raceEntries() {
  const me = { name: nick() + '（你）', color: setup.color, prog: playerProgress(), finT: RACE.finT, best: state.best, me: true, lap: state.lap };
  const list = [me];
  if (setup.mode === 'ai') RACE.cars.forEach(c => list.push({ name: c.name, color: c.color, prog: c.s, finT: c.finT, best: c.best, lap: c.lap + 1 }));
  else for (const r of NET.remote.values()) if (r.inRace) list.push({ name: r.name, color: r.color, prog: r.prog, finT: r.fin, best: r.best, lap: r.lap });
  list.sort((a, b) => { const fa = a.finT >= 0, fb = b.finT >= 0; if (fa && fb) return a.finT - b.finT; if (fa !== fb) return fa ? -1 : 1; return b.prog - a.prog; });
  return list;
}
let standT = 0;
function standingsHud(dt) {
  const el = $('#standings');
  if (!RACE.on || (state.mode !== 'race' && state.mode !== 'lights')) { el.hidden = true; return; }
  standT += dt; if (standT < 0.2) return; standT = 0;
  const list = raceEntries(), my = list.findIndex(e => e.me), sp = Math.max(20, Math.hypot(car.vx, car.vy));
  el.hidden = false;
  $('#posBig').textContent = `P${my + 1}`; $('#posOf').textContent = `/${list.length}`;
  const wide = innerWidth >= 900 && innerHeight >= 560, from = wide ? 0 : Math.max(0, Math.min(my - 1, list.length - 3)), rows = list.slice(from, from + (wide ? 10 : 3));
  $('#posRows').innerHTML = '';
  rows.forEach((e, i) => {
    const li = document.createElement('li'); if (e.me) li.className = 'me';
    const gap = e.me ? '' : e.finT >= 0 ? '完賽' : ((e.prog - list[my].prog) / sp > 0 ? '−' : '+') + Math.abs((e.prog - list[my].prog) / sp).toFixed(1);
    li.innerHTML = '<span class="pn"></span><i></i><span class="nm"></span><span class="gp"></span>';
    li.querySelector('.pn').textContent = from + i + 1; li.querySelector('i').style.background = e.color;
    li.querySelector('.nm').textContent = e.name; li.querySelector('.gp').textContent = gap;
    $('#posRows').appendChild(li);
  });
  if (!$('#results').hidden && RACE.done) renderResults();
}
function renderResults() {
  const list = raceEntries(), my = list.findIndex(e => e.me), lead = list[0];
  $('#resTitle').textContent = `第 ${my + 1} 名 · 共 ${list.length} 台`;
  const tb = $('#resRows'); tb.innerHTML = '';
  list.forEach((e, i) => {
    const tr = document.createElement('tr'); if (e.me) tr.className = 'me';
    const time = e.finT >= 0 ? (i === 0 || !(lead.finT >= 0) ? fmt(e.finT) : '+' + (e.finT - lead.finT).toFixed(3)) : `行駛中 L${Math.max(1, Math.min(setup.laps, e.lap || 1))}`;
    [i + 1, null, e.name, time, fmt(e.best)].forEach((v, j) => { const td = document.createElement('td'); if (j === 1) { const d = document.createElement('i'); d.style.background = e.color; td.appendChild(d); } else td.textContent = v; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  $('#resAgain').hidden = setup.mode === 'online' && !NET.isHost;
}
$('#resAgain').onclick = () => startRace();
$('#resSetup').onclick = () => { $('#results').hidden = true; state.mode = 'menu'; prevMode = 'race'; $('#setup').hidden = false; drawEditor(); updateStartBtn(); };
$('#resWatch').onclick = () => { $('#results').hidden = true; };

// ---- online rooms (the page's live "room": presence carries each car's state, the earliest joiner hosts)
const NET = { api: null, room2: null, code: '', j: Date.now(), isHost: false, host: null, lastGo: null, myGo: null, sendT: 0, remote: new Map(), applied: '', trkReady: Promise.resolve(), connected: false };
const nick = () => ($('#nick').value.trim() || '車手').slice(0, 12);
(async () => { try { NET.api = window.claude && window.claude.use ? await window.claude.use('room') : null; } catch (e) { NET.api = null; } netUi(); })();
function netPlayers() {
  if (!NET.room2) return [];
  return NET.room2.peers().filter(p => p.presence && p.presence.tgp === 1).slice().sort((a, b) => (a.presence.j - b.presence.j) || (a.peer < b.peer ? -1 : 1));
}
function netMySlot() { const i = netPlayers().findIndex(p => p.sameTab); return Math.max(0, i); }
function myTrack() {
  if (setup.map === 'osm' || (setup.map === 'terrain' && (TER.source === 'file' || TER.meters))) return null;
  const pts = setup.map === 'taipei' ? trackPts.map(p => p.node) : trackPts.map(p => [+p.u.toFixed(4), +p.v.toFixed(4)]);
  return { m: setup.map, hs: setup.map === 'terrain' ? hillSeed : null, ps: TER.source, sd: TER.seed, sz: TER.size, rg: TER.range, bs: TER.base, w: setup.width, wl: setup.walls ? 1 : 0, wc: setup.wideCorners ? 1 : 0, bk: setup.banking ? 1 : 0, rv: setup.reverse ? 1 : 0, laps: setup.laps, pts };
}
const netCanHost = () => !!myTrack() && trackPts.length >= (setup.map === 'terrain' ? 4 : 3);
function netPresence() {
  if (!NET.room2) return;
  const racing = (state.mode === 'race' || state.mode === 'lights' || state.mode === 'menu') && RACE.on && setup.mode === 'online';
  const p = { tgp: 1, j: NET.j, nm: nick(), col: setup.color, st: racing ? (RACE.done ? 'fin' : 'race') : 'lobby', rgo: racing ? NET.lastGo : null,
    trk: NET.isHost ? myTrack() : null, go: NET.isHost ? NET.myGo : null };
  if (racing) {
    const q = carModel.root.quaternion;
    Object.assign(p, { x: +car.x.toFixed(2), y: +(car.y || 0).toFixed(2), z: +car.z.toFixed(2), q: [q.x, q.y, q.z, q.w].map(v => +v.toFixed(4)), v: +Math.hypot(car.vx, car.vy).toFixed(2),
      lat: +car.lat.toFixed(2), prog: +playerProgress().toFixed(1), lap: state.lap, fin: RACE.done ? +RACE.finT.toFixed(3) : null, best: isFinite(state.best) ? +state.best.toFixed(3) : null });
  } else Object.assign(p, { x: null, y: null, z: null, q: null, v: null, lat: null, prog: null, lap: null, fin: null, best: null });
  NET.room2.presence(p).catch(() => {});
}
function netTick(dt) {
  if (!NET.room2) return;
  NET.sendT += dt; const racing = setup.mode === 'online' && (state.mode === 'race' || state.mode === 'lights');
  if (NET.sendT >= (racing ? 1 / 15 : 0.5)) { NET.sendT = 0; netPresence(); }
}
const okColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#9aa3ad';
function netOnPeers(ch) {
  const players = netPlayers(), host = players[0] || null;
  NET.host = host; NET.isHost = !!host && host.sameTab;
  if (host && !host.sameTab && host.presence.trk && setup.mode === 'online') NET.trkReady = netApplyTrack(host.presence.trk);
  if (host && !host.sameTab && host.presence.go && host.presence.go !== NET.lastGo && setup.mode === 'online') {
    NET.lastGo = host.presence.go; const go = NET.lastGo;
    NET.trkReady.then(() => { if (NET.lastGo === go) startRace(true); });
  }
  for (const p of ch.left) { const r = NET.remote.get(p.peer); if (r) { disposeModel(r.model); NET.remote.delete(p.peer); } }
  for (const p of players) {
    if (p.sameTab) continue;
    const pr = p.presence, inRace = setup.mode === 'online' && !!NET.lastGo && pr.rgo === NET.lastGo && typeof pr.x === 'number';
    let r = NET.remote.get(p.peer);
    if (!r && inRace) {
      const color = okColor(pr.col), name = String(pr.nm || '車手').slice(0, 12), model = buildCar(color, false, true);
      model.root.add(nameTag(name, color)); scene.add(model.root);
      r = { model, name, color, cur: null }; NET.remote.set(p.peer, r);
    }
    if (!r) continue;
    r.inRace = inRace; r.model.root.visible = inRace;
    if (!inRace) continue;
    Object.assign(r, { tx: pr.x, ty: pr.y, tz: pr.z, tq: Array.isArray(pr.q) ? pr.q : [0, 0, 0, 1], v: +pr.v || 0, lat: +pr.lat || 0, prog: +pr.prog || 0, lap: +pr.lap || 0, fin: typeof pr.fin === 'number' ? pr.fin : NaN, best: typeof pr.best === 'number' ? pr.best : Infinity, t: performance.now() });
  }
  if (!$('#setup').hidden) netUi(); else updateStartBtn();
}
const rq = new THREE.Quaternion(), rv = new THREE.Vector3();
function remoteStep(dt) {
  const now = performance.now();
  for (const r of NET.remote.values()) {
    if (!r.inRace || r.tx === undefined) continue;
    rq.set(r.tq[0], r.tq[1], r.tq[2], r.tq[3]).normalize();
    rv.set(1, 0, 0).applyQuaternion(rq);
    const lead = Math.min(0.25, (now - r.t) / 1000) * r.v, px = r.tx + rv.x * lead, pz = r.tz + rv.z * lead;
    const root = r.model.root, k = r.cur ? 1 - Math.exp(-dt * 10) : 1;
    root.position.x += (px - root.position.x) * k; root.position.z += (pz - root.position.z) * k; root.position.y = Hq(root.position.x, root.position.z);
    root.quaternion.slerp(rq, k); r.cur = true;
    r.x = root.position.x; r.z = root.position.z; rv.set(1, 0, 0).applyQuaternion(root.quaternion); r.psi = Math.atan2(-rv.z, rv.x);
    r.wheel = (r.wheel || 0) + r.v / SPEC.rw * dt; for (const w of r.model.wheels) w.spin.rotation.z = -r.wheel;
  }
}
function netShowMap(m) {
  setup.map = m;
  document.querySelectorAll('#mapTabs .tab').forEach(t => t.classList.toggle('sel', t.dataset.m === m));
  $('#terrainOpts').hidden = m !== 'terrain'; $('#taipeiOpts').hidden = m !== 'taipei'; $('#osmOpts').hidden = m !== 'osm'; $('#tpPresetGroup').hidden = m !== 'taipei'; document.querySelectorAll('.only-taipei').forEach(el => { el.hidden = m !== 'taipei'; });
  $('#baseField').hidden = m === 'taipei'; $('#banking').closest('label').hidden = m !== 'terrain';
  const M = m === 'terrain' ? null : CITY[m]; $('#mapCredit').hidden = !M; if (M) $('#mapCredit').textContent = M.credits;
}
async function netApplyTrack(trk) {
  const key = JSON.stringify(trk); if (key === NET.applied) return; NET.applied = key;
  try {
    if (trk.m === 'taipei') {
      $('#busy').textContent = '同步房主的賽道…'; $('#busy').hidden = false;
      const M = await loadTaipei(); $('#busy').hidden = true; netShowMap('taipei');
      const V = viewSize(M); trackPts = trk.pts.filter(id => id >= 0 && id < M.graph.x.length).map(id => ({ u: M.graph.x[id] / V + 0.5, v: M.graph.z[id] / V + 0.5, node: id }));
    } else {
      if (TER.source !== trk.ps || TER.seed !== trk.sd || TER.meters) { TER.seed = trk.sd; genPreset(PRESETS[trk.ps] ? trk.ps : 'hills', trk.sd); }
      netShowMap('terrain');
      $('#size').value = trk.sz; $('#range').value = trk.rg; $('#base').value = trk.bs;
      document.querySelectorAll('#presets .btn').forEach(x => x.classList.toggle('sel', x.dataset.p === trk.ps));
      trackPts = trk.pts.map(([u, v]) => ({ u: clamp(+u, 0, 1), v: clamp(+v, 0, 1) })); hillSeed = trk.hs > 0 ? trk.hs : null; if (hillSeed) $('#hillSeed').value = hillSeed;
    }
    $('#width').value = trk.w; $('#walls').checked = !!trk.wl; $('#wideCorners').checked = !!trk.wc; $('#banking').checked = !!trk.bk; $('#laps').value = trk.laps;
    setup.reverse = !!trk.rv; $('#btnRev').classList.toggle('sel', setup.reverse);
    readSetup(); syncLabels(); mapDirty = true; drawEditorBase(); refreshRoute(); drawEditor(); updateStartBtn();
  } catch (e) { $('#busy').hidden = true; }
}
function netHostGo() {
  NET.myGo = Math.random().toString(36).slice(2, 10); NET.lastGo = NET.myGo;
  netPresence(); startRace(true);
}
async function netJoin(code) {
  code = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  if (code.length < 3) { $('#netHint').textContent = '房間代碼至少 3 個英數字。'; return; }
  if (!NET.api) return;
  try {
    if (NET.room2) await netLeave();
    $('#netHint').textContent = '連線中…';
    const room = await NET.api.join('tgp-' + code);
    NET.room2 = room; NET.code = code; NET.j = Date.now(); NET.lastGo = null; NET.applied = '';
    room.onPeers(netOnPeers, e => { $('#netHint').textContent = '房間連線已結束（' + e.code + '）。'; NET.room2 = null; netUi(); });
    room.onConnection(c => { NET.connected = c; netUi(); });
    netPresence(); netUi(); savePrefs();
  } catch (e) {
    $('#netHint').textContent = e && e.code === 'not_permitted' ? '這個檢視不能使用多人房間。' : e && e.code === 'limit_reached' ? '目前房間已滿，請稍後再試。' : '加入失敗，請稍後再試。';
  }
}
async function netLeave() {
  const r = NET.room2; NET.room2 = null; NET.isHost = false; NET.lastGo = null;
  for (const x of NET.remote.values()) disposeModel(x.model); NET.remote.clear();
  if (r) { try { await r.leave(); } catch (e) { /* already gone */ } }
  netUi();
}
function netUi() {
  const has = !!NET.api, inRoom = !!NET.room2;
  $('#netOff').hidden = has; $('#netJoinRow').hidden = !has || inRoom; $('#netRoom').hidden = !inRoom;
  if (inRoom) {
    $('#netCodeShow').textContent = NET.code;
    const players = netPlayers(), ul = $('#roster'); ul.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li'), pr = p.presence, dot = document.createElement('i'), nm = document.createElement('span'), st = document.createElement('em');
      dot.style.background = okColor(pr.col); nm.textContent = String(pr.nm || '車手').slice(0, 12) + (p.sameTab ? '（你）' : '');
      st.textContent = (i === 0 ? '房主 · ' : '') + (pr.st === 'race' ? '比賽中' : pr.st === 'fin' ? '已完賽' : '大廳');
      li.append(dot, nm, st); ul.appendChild(li);
    });
    if (!players.length) { const li = document.createElement('li'); li.textContent = NET.connected ? '等待其他車手加入…' : '連線中…'; ul.appendChild(li); }
    $('#netHint').textContent = NET.isHost
      ? (netCanHost() ? '你是房主：選好地圖與賽道後按「開始比賽」，所有人會一起起跑。把房間代碼傳給朋友。' : '線上對戰只支援內建地形與臺北街道賽，自訂高度圖或 OSM 檔無法同步給其他人。')
      : `賽道由房主決定並自動同步，等房主按開始。`;
  }
  updateStartBtn();
}
$('#netCreate').onclick = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let c = ''; for (let i = 0; i < 5; i++) c += a[Math.floor(Math.random() * a.length)]; $('#netCode').value = c; netJoin(c); };
$('#netJoin').onclick = () => netJoin($('#netCode').value);
$('#netLeave').onclick = () => netLeave();
$('#netCopy').onclick = () => { const t = NET.code; if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { $('#netCopy').textContent = '已複製'; setTimeout(() => { $('#netCopy').textContent = '複製代碼'; }, 1500); }).catch(() => {}); };
$('#nick').addEventListener('change', () => { savePrefs(); netPresence(); });
document.querySelectorAll('#raceMode button').forEach(b => b.onclick = () => { setup.mode = b.dataset.r; applyRaceMode(); });
function applyRaceMode() {
  document.querySelectorAll('#raceMode button').forEach(x => x.classList.toggle('sel', x.dataset.r === setup.mode));
  $('#lapsGroup').hidden = setup.mode === 'solo'; $('#aiGroup').hidden = setup.mode !== 'ai'; $('#netGroup').hidden = setup.mode !== 'online';
  if (setup.mode !== 'online' && NET.room2) netLeave();
  netUi();
}

/* ================= First-run tutorial ================= */
// a guided first lap: one card at a time, each advancing when the player actually does the thing; skippable, replayable from the settings.
// Cards go in order, except braking, which cuts in as soon as a red stretch comes up once the colours have been explained.
const TUT = { on: false, done: false, s: null, did: {}, t: 0, hl: null, L: 0, R: 0, brk: 0, inRed: false, miss: 0, red: true, cam: 0, camN: 0, camT: 0, hv: 0, hintVis: null, paused: false, stuck: 0, note: '', noteT: 0 };
const KEY = s => `<kbd>${s}</kbd>`, SW = (c, t) => `<span class="tsw ${c}">${t}</span>`;
const tutTouch = () => document.body.classList.contains('touch'); // same switch as the on-screen controls (on by default when COARSE)
const TUT_STEPS = [
  { id: 'gas', title: '踩油門', hl: () => tutTouch() && !setup.autogas ? '#tGas' : null,
    text: () => setup.autogas ? '已開啟自動油門：紅燈熄滅後，車子會自己往前開。' : tutTouch() ? '紅燈全部熄滅就出發：按住右下角綠色的「油門」。' : `紅燈全部熄滅就出發：按住 ${KEY('↑')} 或 ${KEY('W')} 踩油門。` },
  { id: 'steer', title: '轉方向', hl: () => tutTouch() ? (setup.steerMode === 'drag' ? '#steerRail' : '#steerBtns') : null,
    text: () => !tutTouch() ? `按 ${KEY('←')} ${KEY('→')} 或 ${KEY('A')} ${KEY('D')} 轉方向，讓車子留在路面上。左右都試試看。` : setup.steerMode === 'drag' ? '手指按住畫面左半邊，往左右拖就會轉彎，拖越遠轉越多。左右都試試看。' : '按左下角的 ◀ ▶ 轉方向，讓車子留在路面上。左右都試試看。' },
  { id: 'line', title: '路上的顏色線', hl: () => null,
    text: () => `路上的彩色線是建議路線：${SW('g', '綠')} 踩油門，${SW('y', '黃')} 放開油門準備轉彎，${SW('r', '紅')} 要煞車。` },
  { id: 'hint', title: '轉彎提示', hl: () => '#turnHint',
    text: () => $('#turnHint').hidden ? '快到彎道時，畫面上方會出現轉彎提示卡。' : '上方的卡片說的是下一個彎：往哪邊轉、還有多遠、建議速度。箭頭變紅就是太快，要煞車。' },
  { id: 'cam', title: '換視角', hl: () => '#bCam',
    text: () => (tutTouch() ? '按右上角的眼睛按鈕' : `按 ${KEY('C')} 或右上角的眼睛按鈕`) + '換視角，選一個最順手的。多按幾次會換回來。' },
  { id: 'pause', title: '暫停', hl: () => '#menuBtn',
    text: () => (tutTouch() ? '按右上角的 ‖' : `按 ${KEY('Esc')} 或右上角的 ‖`) + ' 可以暫停，暫停選單能調音量、重新起跑。試一次，再按「繼續」回來。' },
  { id: 'brake', title: '紅色，煞車！', hl: () => tutTouch() ? '#tBrake' : null,
    text: () => tutTouch() ? '開到紅色那段，按住右下角紅色的「煞車」，慢下來再轉彎。' : `開到紅色那段，按住 ${KEY('↓')} 或 ${KEY('S')} 煞車，慢下來再轉彎。` },
  { id: 'end', title: '教學完成！', hl: () => null,
    text: () => '照著顏色線跑完這一圈吧！想再看一次教學，到設定的「操作」頁。' },
];
const TUT_BY = Object.fromEntries(TUT_STEPS.map(s => [s.id, s]));
// distance to the red (braking) stretch of the guide line within range metres ahead of the car, -1 if none
function redAhead(range) { const P = W.linePh; if (!P) return -1; const n = W.n, m = Math.round(range / W.ds); for (let o = 0; o <= m; o++) if (P[(car.k + o) % n] < -0.5) return o * W.ds; return -1; }
function tutOffer() { $('#tutOffer').hidden = false; requestAnimationFrame(() => $('#toGo').focus()); }
function tutBegin() {
  $('#tutOffer').hidden = true; if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (setup.mode !== 'solo') { setup.mode = 'solo'; applyRaceMode(); } // the lesson is a solo lap
  Object.assign(TUT, { on: true, did: {}, paused: false, stuck: 0 }); tutGo(TUT_STEPS[0]); startRace();
}
function tutGo(s) {
  Object.assign(TUT, { s, t: 0, L: 0, R: 0, brk: 0, inRed: false, miss: 0, cam: camMode, camN: 0, camT: 0, hv: 0, hintVis: null, red: !!W.linePh && W.linePh.some(v => v < -0.5) });
  if (s.id === 'end') { TUT.done = true; savePrefs(); }
  $('#tutNo').textContent = s.id === 'end' ? '' : (Object.keys(TUT.did).length + 1) + '/' + (TUT_STEPS.length - 1); $('#tutTitle').textContent = s.title; $('#tutText').innerHTML = s.text();
  $('#tutSkip').textContent = s.id === 'end' ? '關閉' : '跳過教學'; $('#tutChk').hidden = s.id !== 'steer'; $('#tcL').classList.remove('ok'); $('#tcR').classList.remove('ok');
  tutNote(''); tutHl(null);
}
function tutNext() { TUT.did[TUT.s.id] = true; if (!TUT.red) TUT.did.brake = true; tutGo(TUT_STEPS.find(s => !TUT.did[s.id])); } // a track without a braking zone skips that card
function tutNote(html, secs = 0) { if (TUT.note !== html) { TUT.note = html; $('#tutNote').innerHTML = html; } TUT.noteT = secs; }
function tutHl(sel) { const el = sel ? $(sel) : null; if (el === TUT.hl) return; if (TUT.hl) TUT.hl.classList.remove('tut-hl'); TUT.hl = el; if (el) el.classList.add('tut-hl'); }
function tutStop(save) {
  TUT.on = false; $('#tut').hidden = true; document.body.classList.remove('tut-on'); tutHl(null); $('#bReset').classList.remove('tut-hl');
  if (W.lineMesh) W.lineMesh.visible = setup.lineGuide !== false;
  if (save) { TUT.done = true; savePrefs(); }
}
function tutStep(dt) {
  if (!TUT.on) return;
  if (RACE.on) { tutStop(true); return; } // a race against others ends the lesson
  const s = TUT.s, live = (state.mode === 'race' || state.mode === 'lights') && $('#setup').hidden && $('#pause').hidden, el = $('#tut');
  if (s.id === 'pause' && state.mode === 'menu') TUT.paused = true;
  if (el.hidden === live) { el.hidden = !live; document.body.classList.toggle('tut-on', live); }
  if (!live) { tutHl(null); return; }
  if (W.lineMesh) W.lineMesh.visible = true; // the lesson shows the guides even if they were switched off
  TUT.t += dt; const spd = Math.hypot(car.vx, car.vy) * 3.6, race = state.mode === 'race'; let next = false;
  // a red stretch coming up: braking cuts in (but not while the camera or the pause is being tried)
  if (race && TUT.red && !TUT.did.brake && (s.id === 'line' && TUT.t > 4 || s.id === 'hint' || s.id === 'cam' && !TUT.camN || s.id === 'pause' && !TUT.paused) && redAhead(110) >= 0) {
    if (s.id === 'line') TUT.did.line = true; tutGo(TUT_BY.brake); return;
  }
  switch (s.id) {
    case 'gas': next = race && spd > 50; break;
    case 'steer':
      if (race && inp.steer > 0.25 && (TUT.L += dt) > 0.3) $('#tcL').classList.add('ok');
      if (race && inp.steer < -0.25 && (TUT.R += dt) > 0.3) $('#tcR').classList.add('ok');
      next = TUT.t > 2 && TUT.L > 0.3 && TUT.R > 0.3 || TUT.t > 25; break;
    case 'line': next = TUT.t > 6; break;
    case 'hint': { const vis = !$('#turnHint').hidden; if (vis !== TUT.hintVis) { TUT.hintVis = vis; $('#tutText').innerHTML = s.text(); } if (vis) TUT.hv += dt; next = TUT.hv > 4.5 || TUT.hv > 2 && !vis || TUT.t > 40 || !W.corners.length; break; }
    case 'cam': if (camMode !== TUT.cam) { TUT.cam = camMode; TUT.camN++; TUT.camT = 0; } TUT.camT += dt; next = TUT.camN > 0 && TUT.camT > 2.5; break;
    case 'pause': next = TUT.paused; break;
    case 'brake': { // brake on (or just before) a red stretch; a miss counts once past the whole zone (it can come in pieces); after three, move on
      if (inp.uB > 0.5 && redAhead(70) >= 0) TUT.brk += dt;
      if (TUT.brk > 0.2) { next = true; break; }
      if (W.linePh[car.k] < -0.5) TUT.inRed = true;
      else if (TUT.inRed && redAhead(150) < 0) { TUT.inRed = false; if (++TUT.miss >= 3) next = true; else tutNote('這次沒踩到煞車，下一段紅色再試一次。', 6); }
      break;
    }
    case 'end': if (TUT.t > 9) { tutStop(false); return; } break;
  }
  if (next) { tutNext(); return; }
  // stopped against a wall or off the road: point at the reset
  if (race && s.id !== 'gas') TUT.stuck = spd < 4 ? TUT.stuck + dt : 0;
  const stuck = TUT.stuck > 4; $('#bReset').classList.toggle('tut-hl', stuck);
  if (stuck) tutNote(tutTouch() ? '卡住了？按右上角的 ↺ 回到賽道。' : `卡住了？按 ${KEY('R')} 或右上角的 ↺ 回到賽道。`, 0.1);
  else if (TUT.noteT > 0 && (TUT.noteT -= dt) <= 0) tutNote('');
  tutHl(s.hl());
}
$('#toGo').onclick = () => tutBegin();
$('#toNo').onclick = () => { $('#tutOffer').hidden = true; TUT.done = true; savePrefs(); };
$('#tutReplay').onclick = () => tutBegin();
$('#tutSkip').onclick = () => { const end = TUT.s.id === 'end'; tutStop(true); if (!end) banner('已跳過教學，設定的「操作」頁可以重看', 'info'); };

/* ================= Main loop ================= */
// longest frame step: below 10 fps the game slows down instead of jumping; physics always runs in fixed 1/240 s steps (P4)
const MAX_DT = 0.1;
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000, dt = Math.min(window.TGP_MAX_DT || MAX_DT, rawDt); last = now;
  autoQuality(rawDt);
  runLater(COARSE ? 6 : 12); // the rest of the world build, a job or two per frame
  if (state.mode === 'race' || state.mode === 'lights') readInput(dt);
  if (state.mode === 'lights') {
    state.lightsT += dt; const on = Math.min(5, Math.floor(state.lightsT / 0.8)), out = state.lightsT >= state.lightsOut;
    [...$('#lights').children].forEach((l, i) => l.classList.toggle('on', !out && i < on));
    car.thr = inp.thr; car.brk = inp.brk; car.rpm += ((SPEC.idle + inp.thr * 8000) - car.rpm) * Math.min(1, dt * 8);
    if (out) { state.mode = 'race'; state.t = 0; if (RACE.on) { state.lap = 0; state.lapStart = 0; } else startLap(); state.lastK = car.k; RACE.go(); setTimeout(() => { $('#lights').hidden = true; }, 600); banner('出發！', 'info'); }
  } else if (state.mode === 'race') {
    gearLogic(dt, inp);
    if (drsReq && W.drs[car.k]) car.drs = true;
    drsReq = false;
    if (car.drs && (!W.drs[car.k] || inp.brk > 0.1)) car.drs = false;
    acc += dt;
    while (acc >= DT) { physicsStep(DT, inp); acc -= DT; state.t += DT; }
    raceUpdate();
    opponentsStep(dt);
  }
  updateCarVisual();
  if (state.mode === 'race' && !RACE.on) { recordGhost(); showGhost(); } else ghostModel.root.visible = false;
  const spd = Math.hypot(car.vx, car.vy);
  shake = car.surf === 3 ? Math.min(0.16, spd * 0.006) : car.surf === 2 && !W.city ? Math.min(0.1, spd * 0.003) : car.surf === 1 ? Math.min(0.05, spd * 0.0015) : 0;
  if (state.mode === 'preview') previewStep(dt);
  else if (state.mode === 'menu0') { const t = now / 1000 * 0.08, R = 26; camera.position.set(car.x + Math.cos(t) * R, (car.y || 0) + 9, car.z + Math.sin(t) * R); camera.up.copy(UP); camera.lookAt(car.x, (car.y || 0) + 0.5, car.z); }
  else updateCamera(dt);
  sky.position.copy(camera.position); SKY_U.time.value = now / 1000; updateTiles(dt);
  if (RAIN.mesh.visible) { RAIN.u.time.value = now / 1000; RAIN.u.cam.value.copy(camera.position); }
  TEX.waterN.offset.set(now * 0.000011, now * 0.000006);
  if (POST.on && POST.comp) { POST.grade.uniforms.time.value = (now / 1000) % 100; POST.comp.render(); } else renderer.render(scene, camera);
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').classList.remove('show'); }
  tutStep(dt);
  remoteStep(dt); netTick(dt);
  hud(dt); standingsHud(dt); updateAudio();
  AQ.busy = performance.now() - AQ.t0;
}

/* ================= Boot ================= */
genPreset('hills', TER.seed);
HILL_DEF = hillSig(); // the page's default terrain and road settings, before saved preferences
newHillTrack(HILL_STD);
loadPrefs(); applyLevel(); readSetup(); syncLabels(); applyControls(); applyRaceMode();
setQuality();
if (!COARSE && innerWidth >= 900) { $('#tele').hidden = false; $('#bTele').classList.add('on'); }
drawEditorBase();
buildWorld(); mapDirty = false;
resetRace(); placeCar(3, 0);
if (!TUT.done) tutOffer();
requestAnimationFrame(() => { drawEditor(); updateStartBtn(); });
requestAnimationFrame(frame);
})();
