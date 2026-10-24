// Map-mode geometry tests (Node, no browser): the functions are cut out of game.js by name and run as they are.
//
//   node tools/test/node/geo_test.js [game.js]
//
// 1. OSM import (parseOSM): lat/lon → local metres. Distances between known points against a WGS84 geodesic
//    (Vincenty inverse, written out below) must agree within 0.5 %. Taipei (25°N) and 0°, 45°, 60°.
// 2. Height-map tiles named z_x_y: tile bounds from tile2lon / tile2lat corners; ground size against the geodesic.
// 3. Terrarium decoding: a synthetic Terrarium image whose slope crosses the R-channel carry (−1 m = R 127 G 255 B 0,
//    0 m = R 128 G 0 B 0) and the G-channel carry. The old path (draw the encoded image onto an N×N canvas with
//    smoothing, then decode) is modelled byte for byte; the new path decodes metres at native size, then resamples.
// Prints a JSON report; exit code 1 if a check fails.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const file = process.argv[2] || path.join(__dirname, '..', '..', '..', 'game.js');
const src = fs.readFileSync(file, 'utf8');

// ---------------------------------------------------------------- cut functions / constants out of game.js
function cut(name) {
  let i = src.indexOf('function ' + name + '('), kind = 'fn';
  if (i < 0) { i = src.indexOf('const ' + name + ' = '); kind = 'const'; }
  if (i < 0) throw new Error('game.js has no ' + name);
  if (kind === 'const') { const e = src.indexOf(';\n', i); return src.slice(i, e + 1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') d++; else if (c === '}' && --d === 0) break; }
  return src.slice(i, j + 1);
}
const NAMES = ['degMetres', 'lonLatProjector', 'tile2lon', 'tile2lat', 'tileGround', 'tileFromName', 'decodeHeightPixels', 'resampleAxis', 'resampleGrid'];
const ctx = { Math, Float32Array, Float64Array, Uint8ClampedArray, Number, isFinite, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };
vm.createContext(ctx);
vm.runInContext(NAMES.map(cut).join('\n') + '\n;this.F = { ' + NAMES.join(', ') + ' };', ctx);
const F = ctx.F;

// ---------------------------------------------------------------- reference: Vincenty inverse on WGS84 (metres)
function vincenty(la1, lo1, la2, lo2) {
  const a = 6378137, f = 1 / 298.257223563, b = a * (1 - f), r = Math.PI / 180;
  const L = (lo2 - lo1) * r, U1 = Math.atan((1 - f) * Math.tan(la1 * r)), U2 = Math.atan((1 - f) * Math.tan(la2 * r));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, it = 0, sS, cS, sig, ca2, c2m;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sS = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2); if (sS === 0) return 0;
    cS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sS, cS);
    const sa = cU1 * cU2 * sl / sS; ca2 = 1 - sa * sa; c2m = ca2 ? cS - 2 * sU1 * sU2 / ca2 : 0;
    const C = f / 16 * ca2 * (4 + f * (4 - 3 * ca2)), prev = lam;
    lam = L + (1 - C) * f * sa * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
    if (Math.abs(lam - prev) < 1e-13) break;
  } while (++it < 200);
  const u2 = ca2 * (a * a - b * b) / (b * b), A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2m + B / 4 * (cS * (-1 + 2 * c2m * c2m) - B / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
  return b * A * (sig - dS);
}

const fails = [], report = {};
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// ---------------------------------------------------------------- 1. OSM projection
function projTest(name, pts) {
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  for (const [la, lo] of pts) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const P = F.lonLatProjector((la0 + la1) / 2, (lo0 + lo1) / 2);
  // the constants game.js used before 2026-10-24, for the report
  const lat0 = (la0 + la1) / 2, lon0 = (lo0 + lo1) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540, Pold = ([la, lo]) => [(lo - lon0) * kx, -(la - lat0) * ky];
  let worst = 0, worstOld = 0, pairs = 0; const rows = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const g = vincenty(pts[i][0], pts[i][1], pts[j][0], pts[j][1]); if (g < 200) continue;
    const a = P(pts[i]), b = P(pts[j]), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ao = Pold(pts[i]), bo = Pold(pts[j]), dOld = Math.hypot(ao[0] - bo[0], ao[1] - bo[1]);
    const e = (d - g) / g, eo = (dOld - g) / g; pairs++;
    if (Math.abs(e) > Math.abs(worst)) worst = e; if (Math.abs(eo) > Math.abs(worstOld)) worstOld = eo;
    rows.push({ pair: (pts[i][2] || i) + '–' + (pts[j][2] || j), geodesic_m: Math.round(g * 10) / 10, new_m: Math.round(d * 10) / 10, old_m: Math.round(dOld * 10) / 10, newErrPct: +(e * 100).toFixed(4), oldErrPct: +(eo * 100).toFixed(4) });
  }
  report['proj_' + name] = { pairs, worstNewPct: +(worst * 100).toFixed(4), worstOldPct: +(worstOld * 100).toFixed(4), rows: rows.slice(0, 12) };
  check(Math.abs(worst) < 0.005, `projection ${name}: worst ${(worst * 100).toFixed(3)} % ≥ 0.5 %`);
}
projTest('taipei', [[25.0340, 121.5645, '台北101'], [25.0478, 121.5170, '台北車站'], [25.0349, 121.5219, '中正紀念堂'], [25.0372, 121.4999, '龍山寺'], [25.0329, 121.5122, '建國中學'], [25.0605, 121.5495, '南京復興'], [25.0170, 121.5395, '台大']]);
const ring = (la, lo, km) => { const out = [[la, lo, 'c']]; for (let a = 0; a < 360; a += 45) { const r = km / 111; out.push([la + r * Math.cos(a * Math.PI / 180), lo + r * Math.sin(a * Math.PI / 180) / Math.cos(la * Math.PI / 180), 'a' + a]); } return out; };
for (const la of [0, 45, 60]) projTest('lat' + la + '_5km', ring(la, 10, 5));
projTest('taipei_10km', ring(25.04, 121.53, 5));

// ---------------------------------------------------------------- 2. tiles
{
  const z = 12, lat = 25.0340, lon = 121.5645, n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const t = F.tileGround(z, x, y), mid = (t.n + t.s) / 2;
  const gEW = vincenty(mid, t.w, mid, t.e), gNS = vincenty(t.s, (t.w + t.e) / 2, t.n, (t.w + t.e) / 2);
  const inside = lat <= t.n && lat >= t.s && lon >= t.w && lon <= t.e;
  const centre = [(t.w + t.e) / 2, mid], off = [vincenty(lat, lon, lat, centre[0]), vincenty(lat, lon, centre[1], lon)];
  const parsed = F.tileFromName('terrarium_' + z + '_' + x + '_' + y + '.png'), parsed2 = F.tileFromName('12-' + x + '-' + y + '.png'), bad = F.tileFromName('photo_2024_10_24.png');
  report.tile = { z, x, y, bounds: t, ground_ew_m: Math.round(t.sx), geodesic_ew_m: Math.round(gEW), ground_ns_m: Math.round(t.sz), geodesic_ns_m: Math.round(gNS),
    ewErrPct: +((t.sx - gEW) / gEW * 100).toFixed(4), nsErrPct: +((t.sz - gNS) / gNS * 100).toFixed(4),
    taipei101_inside: inside, taipei101_from_tile_centre_m: off.map(Math.round), parsed, parsed2, rejected: bad };
  check(inside, 'tile corners do not contain the point the tile was computed from');
  check(Math.abs(t.sx - gEW) / gEW < 0.005 && Math.abs(t.sz - gNS) / gNS < 0.005, 'tile ground size off by ≥ 0.5 %');
  check(parsed && parsed.z === z && parsed.x === x && parsed.y === y && parsed2 && parsed2.x === x && !bad, 'tile file name parsing');
}

// ---------------------------------------------------------------- 3. Terrarium
function terrarium(m) { const q = Math.round((m + 32768) * 256); return [q >> 16, (q >> 8) & 255, q & 255]; } // R·256 + G + B/256 − 32768, B rounded
function synth(w, h, f) { const d = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const [r, g, b] = terrarium(f(i, j)), o = (j * w + i) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; } return d; }
// the old path: drawImage(img, 0, 0, N, N) with imageSmoothingEnabled = true (bilinear on the encoded bytes, rounded to 8 bits)
function oldPath(d, w, h, N) {
  const out = new Uint8ClampedArray(N * N * 4);
  for (let J = 0; J < N; J++) for (let I = 0; I < N; I++) {
    const u = Math.max(0, Math.min(w - 1, (I + 0.5) * w / N - 0.5)), v = Math.max(0, Math.min(h - 1, (J + 0.5) * h / N - 0.5)), i = Math.min(w - 2, u | 0), j = Math.min(h - 2, v | 0), a = u - i, b = v - j;
    for (let c = 0; c < 4; c++) { const p = (k, l) => d[((j + l) * w + i + k) * 4 + c]; out[(J * N + I) * 4 + c] = Math.round(p(0, 0) * (1 - a) * (1 - b) + p(1, 0) * a * (1 - b) + p(0, 1) * (1 - a) * b + p(1, 1) * a * b); }
  }
  const m = new Float32Array(N * N); for (let i = 0; i < N * N; i++) m[i] = out[i * 4] * 256 + out[i * 4 + 1] + out[i * 4 + 2] / 256 - 32768; return m;
}
function terrTest(name, w, h, f, N = 513) {
  const d = synth(w, h, f), old = oldPath(d, w, h, N), neu = F.resampleGrid(F.decodeHeightPixels(d, w, h, 'terrarium'), w, h, N);
  // reference: the same resampling of the exact metres (what a perfect decoder gives)
  const exact = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) exact[j * w + i] = f(i, j);
  const ref = F.resampleGrid(exact, w, h, N);
  let eo = 0, en = 0, spikesOld = 0, spikesNew = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N * N; i++) { const a = Math.abs(old[i] - ref[i]), b = Math.abs(neu[i] - ref[i]); eo = Math.max(eo, a); en = Math.max(en, b); if (a > 5) spikesOld++; if (b > 5) spikesNew++; lo = Math.min(lo, ref[i]); hi = Math.max(hi, ref[i]); }
  report['terrarium_' + name] = { size: w + '×' + h + ' → ' + N + '×' + N, range_m: [+lo.toFixed(2), +hi.toFixed(2)], oldMaxErr_m: +eo.toFixed(3), oldSpikes_gt5m: spikesOld, newMaxErr_m: +en.toFixed(4), newSpikes_gt5m: spikesNew };
  check(spikesNew === 0 && en < 0.01, `terrarium ${name}: new path error ${en.toFixed(3)} m`);
  check(spikesOld > 0, `terrarium ${name}: the synthetic image does not show the old failure (test is not testing anything)`);
}
terrTest('R_carry_0m', 64, 64, (i, j) => -3 + 6 * i / 63 + 0.5 * j / 63);              // −3 … +3.5 m: R 127 ↔ 128
terrTest('G_carry_256m', 64, 64, (i, j) => 250 + 12 * (i + j) / 126);                   // 250 … 262 m: G 255 ↔ 0 at 256 m
terrTest('ramp_upsample_37', 37, 37, (i, j) => -40 + 80 * Math.hypot(i - 18, j - 18) / 26); // cone through 0 m, odd size
terrTest('downsample_2048', 1024, 1024, (i, j) => 30 * Math.sin(i / 90) + 20 * Math.cos(j / 70), 257); // shrinking, crosses 0 m many times

// grayscale still maps 0 … 255 to 0 … 1
{ const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), g = F.decodeHeightPixels(d, 2, 1, 'gray'); check(g[0] === 0 && Math.abs(g[1] - 1) < 1e-6, 'grayscale decode'); }

report.failures = fails;
console.log(JSON.stringify(report, null, 1));
process.exit(fails.length ? 1 : 0);
