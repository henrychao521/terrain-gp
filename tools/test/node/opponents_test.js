// Regression test for separateOpponents (P1): the collaborating AI's own four scenarios (2026-10-24), run against the code
// as it is in game.js (the block between /* P1-begin */ and /* P1-end */), in a fake straight track.
//   node tools/test/node/opponents_test.js        exit 0 when every scenario passes
// Changed from the returned test: scenario 2 (no room beside) no longer expects the car behind to jump 4.6 m in one frame
// (it drops back at most 6 m/s, never closer than 1.25 m), and the fake track has the centreline geometry the code now reads.
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', '..', 'game.js'), 'utf8'); // or another checkout's game.js
const a = src.indexOf('/* P1-begin'), b = src.indexOf('/* P1-end */');
if (a < 0 || b < 0) { console.error('P1 block not found in game.js'); process.exit(2); }
const N = 3000, W = { len: N, n: N, ds: 1, hwL: new Float32Array(N), hwR: new Float32Array(N), x: Float32Array.from({ length: N }, (_, k) => k), z: new Float32Array(N), lx: new Float32Array(N), lz: new Float32Array(N).fill(-1) };
const RACE = { on: true, cars: [] }, state = { t: 10 };
const wrapGap = d => ((d + W.len * 0.5) % W.len + W.len) % W.len - W.len * 0.5;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const separateOpponents = new Function('W', 'RACE', 'state', 'wrapGap', 'clamp', src.slice(a, b) + '\nreturn separateOpponents;')(W, RACE, state, wrapGap, clamp);
const dt = 1 / 240; let ok = true;
const report = (name, pass, info) => { console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${info}`); ok = ok && pass; };
const road = hw => { W.hwL.fill(hw); W.hwR.fill(hw); W._fold = null; };

road(7); // 1. side by side, 0.5 m apart -> 2 m apart within a second, inside the road, at most 3 m/s sideways
RACE.cars = [{ s: 500, lat: -0.25, v: 40, delay: 0, finT: -1 }, { s: 500, lat: 0.25, v: 40, delay: 0, finT: -1 }];
{ let mx = 0; for (let i = 0; i < 240; i++) { const l0 = RACE.cars[0].lat, l1 = RACE.cars[1].lat; separateOpponents(dt); mx = Math.max(mx, Math.abs(RACE.cars[0].lat - l0), Math.abs(RACE.cars[1].lat - l1)); }
  const d = Math.abs(RACE.cars[0].lat - RACE.cars[1].lat); report('1 side by side', d >= 2 && mx <= 3 * dt + 1e-9 && RACE.cars.every(c => Math.abs(c.lat) <= 5.8), `|dlat| ${d.toFixed(3)}, max step ${mx.toFixed(5)}`); }

road(2.2); // 2. one lane only, 1 m apart -> the car behind is at once >= 1.25 m back and slower, and 4.6 m back within a second
RACE.cars = [{ s: 200, lat: 0, v: 50, delay: 0, finT: -1 }, { s: 201, lat: 0, v: 40, delay: 0, finT: -1 }];
{ separateOpponents(dt); const r = RACE.cars[0], f = RACE.cars[1], first = f.s - r.s;
  let t = 0; while (t < 1 && f.s - r.s < 4.6 - 1e-6) { for (const c of RACE.cars) c.s += c.v * dt; separateOpponents(dt); t += dt; }
  report('2 no room beside', first >= 1.25 - 1e-9 && r.v <= f.v * 0.95 + 1e-9 && f.s - r.s >= 4.6 - 1e-6, `gap after one frame ${first.toFixed(2)} m, 4.6 m after ${t.toFixed(2)} s, v ${r.v} / ${f.v}`); }

road(7); // 3. across the start line
RACE.cars = [{ s: W.len - 1, lat: 0, v: 45, delay: 0, finT: -1 }, { s: W.len + 1, lat: 0.5, v: 40, delay: 0, finT: -1 }];
{ separateOpponents(dt); const d = Math.abs(RACE.cars[1].lat - RACE.cars[0].lat); report('3 across the line', d > 0.5, `dlat ${d.toFixed(4)}`); }

road(7); // 4. ten cars, random places and speeds, 120 s: never closer than 1.2 m
{ let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  RACE.cars = Array.from({ length: 10 }, (_, i) => ({ s: i * 15 + rnd() * 5, lat: (rnd() - 0.5) * 8, v: 25 + rnd() * 30, delay: 0, finT: -1 }));
  let bad = 0;
  for (let st = 0; st < 120 * 240; st++) {
    for (const c of RACE.cars) c.s += c.v * dt; separateOpponents(dt);
    let hit = false; for (let i = 0; i < 10 && !hit; i++) for (let j = i + 1; j < 10; j++) if (Math.hypot(wrapGap(RACE.cars[i].s - RACE.cars[j].s), RACE.cars[i].lat - RACE.cars[j].lat) < 1.2) { hit = true; break; }
    if (hit) bad++;
  }
  report('4 ten cars, 120 s', bad === 0, `frames under 1.2 m: ${bad}`); }
process.exit(ok ? 0 : 1);
