// The car's performance envelope on flat tarmac: top speed, 100-200 km/h time, acceleration / braking g by speed
// band, braking distance, peak steady lateral g at five speeds. Pure physics (physicsStep at 240 Hz), nothing rendered.
// The track is a flat 60 m wide preset and every half width is set huge, so the car is on tarmac wherever the runs
// take it (an older harness put the car at the origin, which is grass, and measured the grass).
// maxSurf: highest surface code seen during all runs (0 tarmac, 1 kerb, 2 grass, 3 gravel); must stay 0.
// opts.setup: overrides for the game's setup object; run.py passes the calibration conditions of tools/f1/README.md
// (pro level: traction control and ABS on, stability control off) plus anything given with --setup.
(opts) => {
  const T = window.TGP, c = T.car, DT = 1 / 240;
  T.setup.width = 60; T.setup.walls = false; Object.assign(T.setup, (opts && opts.setup) || {}); T.genPreset('flat', T.TER.seed); T.buildWorld(); T.state.mode = 'bench';
  for (let k = 0; k < T.W.n; k++) { T.W.wallL[k] = Infinity; T.W.wallR[k] = Infinity; T.W.hwL[k] = T.W.hwR[k] = 1e5; } // all tarmac wherever the run goes
  const gearFor = v => { for (let g = 1; g <= 8; g++) if (v / T.SPEC.rw * 60 / (2 * Math.PI) * T.SPEC.ratios[g - 1] < 11500) return g; return 8; };
  const start = v0 => { T.placeCar(0, 0); Object.assign(c, { x: 0, z: 0, psi: 0, vx: v0, vy: 0, r: 0, gear: gearFor(v0), tf: 95, tr: 95, delta: 0, steerUser: 0 }); c.rpm = v0 / T.SPEC.rw * 60 / (2 * Math.PI) * T.SPEC.ratios[c.gear - 1]; for (const k in T.keys) T.keys[k] = false; };
  let maxSurf = 0;
  const step = (inp, n = 1) => { for (let i = 0; i < n; i++) { T.physicsStep(DT, inp); maxSurf = Math.max(maxSurf, c.surf | 0); } T.gearLogic(DT * n, inp); };
  const G = 9.81, inp = T.inp;
  // straight line from 60 km/h at full throttle
  start(60 / 3.6); inp.thr = 1; inp.brk = 0; inp.steer = 0;
  const acc = []; let t = 0, t100 = null, t200 = null, top = 0, last = c.vx;
  while (t < 40) { step(inp, 4); t += DT * 4; const v = c.vx * 3.6; acc.push([v, (c.vx - last) / (DT * 4) / G]); last = c.vx; top = Math.max(top, v); if (t100 === null && v >= 100) t100 = t; if (t200 === null && v >= 200) t200 = t; }
  // full braking from top speed (at most 330 km/h) down to 70 km/h
  start(Math.min(top, 330) / 3.6); inp.thr = 0; inp.brk = 1;
  const brk = []; last = c.vx; t = 0; let dist = 0;
  while (c.vx > 70 / 3.6 && t < 15) { step(inp, 4); t += DT * 4; dist += c.vx * DT * 4; brk.push([c.vx * 3.6, -(c.vx - last) / (DT * 4) / G]); last = c.vx; }
  // lateral: hold the speed, ramp the steering slowly; peak lateral g before the car lets go (slip angle > 0.35 rad)
  const lat = {};
  for (const kmh of [80, 125, 175, 225, 275]) {
    start(kmh / 3.6); let best = 0, s = 0;
    for (let i = 0; i < 6000; i++) { s += 0.00003; c.steerUser = s; c.delta = s; inp.brk = 0; inp.thr = Math.max(0, Math.min(1, 0.3 + (kmh / 3.6 - c.vx) * 0.6)); step(inp, 1); if (Math.abs(Math.atan2(c.vy, Math.abs(c.vx))) > 0.35 || c.vx < kmh / 3.6 * 0.8) break; best = Math.max(best, Math.abs(c.ays) / G); }
    lat[kmh] = +best.toFixed(2);
  }
  const band = (arr, lo, hi, q) => { const v = arr.filter(e => e[0] >= lo && e[0] < hi).map(e => e[1]).sort((a, b) => a - b); return v.length > 3 ? +v[Math.min(v.length - 1, Math.floor(v.length * q))].toFixed(2) : null; };
  return {
    top_kmh: +top.toFixed(1), t_100_200_s: t100 !== null && t200 !== null ? +(t200 - t100).toFixed(2) : null,
    accel_g: Object.fromEntries([[60, 120], [120, 180], [180, 240], [240, 300], [300, 360]].map(([lo, hi]) => [lo + '-' + hi, band(acc, lo, hi, 0.95)])),
    brake_g: Object.fromEntries([[80, 150], [150, 220], [220, 290], [290, 360]].map(([lo, hi]) => [lo + '-' + hi, band(brk, lo, hi, 0.98)])),
    brake_dist_m: +dist.toFixed(0), lat_g: lat, maxSurf,
    setupUsed: Object.fromEntries(['level', 'tc', 'abs', 'esc', 'brakeAssist', 'auto', 'aero', 'bias'].map(k => [k, T.setup[k]])),
  };
}
