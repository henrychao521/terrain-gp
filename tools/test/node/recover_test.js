// Regression test for autoRecover (P2): the collaborating AI's own four scenarios (2026-10-24), run against the code as it is
// in game.js (the block between /* P2-begin */ and /* P2-end */) and the game's real shift(), with a small fake car.
//   node tools/test/node/recover_test.js          exit 0 when every scenario passes
// Changed from the returned test, to match the game: car.hit is cleared every frame as raceUpdate() does (contact is read
// from car.wallT), shift() is the game's (it never goes below 1st), and in reverse the brake pedal drives the car backwards.
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', '..', 'game.js'), 'utf8'); // or another checkout's game.js
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) { console.error('not found in game.js: ' + from); process.exit(2); } return src.slice(a, b); };
const code = cut('/* P2-begin', '/* P2-end */') + cut('function shift(d) {', '\n}\n') + '\n}\n';
const W = { lx: new Float32Array([0]), lz: new Float32Array([-1]) }; // travel along +x
const SPEC = { ratios: [1, 1, 1, 1, 1, 1, 1, 1], limiter: 1e9 }, setup = { autogas: true }, state = { mode: 'race', t: 0 };
const car = {}; let resets = 0;
const resetToTrack = () => { resets++; Object.assign(car, { x: 0, z: 0, psi: 0, vx: 0, vy: 0, gear: 1, hit: 0 }); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const [autoRecover, REC] = new Function('W', 'SPEC', 'setup', 'state', 'car', 'resetToTrack', 'clamp', code + '\nreturn [autoRecover, REC];')(W, SPEC, setup, state, car, resetToTrack, clamp);
const dt = 1 / 240; let ok = true;
const report = (name, pass, info) => { console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${info}`); ok = ok && pass; };
const start = (o = {}) => { Object.assign(car, { x: 0, z: -3.5, psi: Math.PI / 2, vx: 0, vy: 0, gear: 1, hit: 0, wallT: undefined, k: 0, lat: 3.5, shiftT: 0, revT: 0, rpm: 0 }, o); REC.phase = 'drive'; REC.t = 0; state.t = 0; resets = 0; };
// one step of the fake car: against the barrier (forward) it stops with a contact; in reverse the brake pedal drives it back
const step = (inp, blockedBehind) => {
  state.t += dt;
  if (car.gear === -1) { if (!blockedBehind) { car.vx = -inp.brk * 4.5; car.z -= car.vx * dt; car.psi += inp.steer * 0.8 * dt; } else { car.vx = 0; car.hit = 5; car.wallT = state.t; } }
  else if (inp.thr > 0.3) { car.vx = 0; car.hit = 5; car.wallT = state.t; }
  car.hit = 0; // raceUpdate()
};

start(); // 1. nose against the barrier with the automatic throttle: reverses after 1.2-1.3 s, back in 1st, all within 3.5 s
{ let rev = -1, sawRev = false, done = -1;
  for (let i = 1; i <= 240 * 4; i++) { const inp = { thr: 0.9, brk: 0, steer: 0, uB: 0 }; autoRecover(dt, inp);
    if (REC.phase === 'reverse' && rev < 0) rev = state.t; if (car.gear === -1) sawRev = true;
    if (rev > 0 && REC.phase === 'drive' && car.gear === 1) { done = state.t; break; }
    step(inp); }
  report('1 reverse out', rev >= 1.2 && rev <= 1.3 + dt && sawRev && car.gear === 1 && done > 0 && done < 3.5, `reverse at ${rev.toFixed(3)} s, back in 1st at ${done.toFixed(3)} s`); }

start(); // 2. blocked behind too: one resetToTrack() 2 s into reversing, and only one
{ let rev = -1, at = -1;
  for (let i = 1; i <= 240 * 4; i++) { const inp = { thr: 0.9, brk: 0, steer: 0, uB: 0 }; const r0 = resets; autoRecover(dt, inp);
    if (REC.phase === 'reverse' && rev < 0) rev = state.t; if (resets === 1 && r0 === 0) at = state.t - rev;
    if (resets) { state.t += dt; continue; } step(inp, true); }
  report('2 blocked behind', resets === 1 && Math.abs(at - 2.0) < 0.02, `resets ${resets}, after ${at.toFixed(3)} s of reversing`); }

start(); // 3. the player holds the brake at the barrier: never reverses
{ let rev = false; for (let i = 0; i < 240 * 5; i++) { const inp = { thr: 0.9, brk: 1, steer: 0, uB: 0.8 }; autoRecover(dt, inp); if (REC.phase !== 'drive' || car.gear === -1) rev = true; step(inp); }
  report('3 braking', !rev && car.gear === 1, `entered reverse: ${rev}`); }

start({ gear: 2 }); setup.autogas = false; // 4. automatic throttle off: input and gear untouched
{ let same = true; for (let i = 0; i < 240 * 3; i++) { const inp = { thr: 0.85, brk: 0.15, steer: 0.25, uB: 0 }; autoRecover(dt, inp); if (inp.thr !== 0.85 || inp.brk !== 0.15 || inp.steer !== 0.25 || car.gear !== 2) { same = false; break; } step(inp); }
  report('4 automatic throttle off', same, `untouched: ${same}`); }
setup.autogas = true;
process.exit(ok ? 0 : 1);
