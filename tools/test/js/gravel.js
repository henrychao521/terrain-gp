// Gravel run-off: can a stopped car drive out, and does gravel still slow a car on flat ground?
// Runs in the page or in Node (tools/test/node/world.js, "check": "gravel.js").
//
// escape: the car stands still in the middle of a gravel trap (or at arg.spots [[k, lat], ...]), full throttle, steering
//   for the centreline 20 m ahead; it has escaped when it is back on the asphalt within arg.secs (default 25 s).
//   Spots: the arg.worst (default 12) steepest run-off samples, gravel or grass (ground gradient under the car), the arg.wall
//   (default 6) steepest of them again right at the barrier, plus arg.spots.
// decel: from 100 km/h with no throttle or brake, the speed lost in the first second on asphalt, grass and flat gravel.
(arg = {}) => {
  const T = window.TGP, X = window.TGPX, W = T.W, car = T.car, n = W.n, DT = 1 / 240, FPS = 60, secs = arg.secs || 25;
  const r2 = v => Math.round(v * 100) / 100;
  const grad = (x, z) => { const e = 1.0, H = (a, b) => T.Sq(a, b, -1); return Math.hypot(H(x + e, z) - H(x - e, z), H(x, z + e) - H(x, z - e)) / (2 * e); };
  const spotXZ = (k, lat) => [W.x[k] + W.lx[k] * lat, W.z[k] + W.lz[k] * lat];
  Object.assign(T.setup, { level: 'easy', autogas: false, brakeAssist: false, mode: 'solo' });
  const t = T.touch;
  function drive(k, lat, v0, gas, until) {
    X.resetRace(); X.RACE.on = false; T.placeCar(k, lat); T.state.mode = 'race'; T.state.t = 0;
    for (const q in T.keys) T.keys[q] = false;
    t.sActive = true; t.gas = gas; t.brake = 0; car.vx = v0;
    let acc = 0, surf0 = -1;
    for (let f = 0; f < secs * FPS; f++) {
      const keepLat = until === 'time' ? lat : 0, tk = (car.k + Math.round(20 / W.ds)) % n, ax = W.x[tk] + W.lx[tk] * keepLat, az = W.z[tk] + W.lz[tk] * keepLat;
      let err = Math.atan2(-(az - car.z), ax - car.x) - car.psi; err = Math.atan2(Math.sin(err), Math.cos(err)); t.steer = Math.max(-1, Math.min(1, err * 2.5));
      T.readInput(1 / FPS); T.gearLogic(1 / FPS, T.inp);
      acc += 1 / FPS; while (acc >= DT) { T.physicsStep(DT, T.inp); acc -= DT; T.state.t += DT; }
      if (surf0 < 0) surf0 = car.surf;
      const hw = car.lat > 0 ? W.hwL[car.k] : W.hwR[car.k];
      if (until === 'asphalt' && Math.abs(car.lat) < hw) return { out: true, t: r2(T.state.t), surf0 };
      if (until === 'time' && T.state.t >= 1) return { v1: Math.hypot(car.vx, car.vy), surf0 };
    }
    return { out: false, t: secs, surf0, endLat: r2(car.lat), kmh: Math.round(Math.hypot(car.vx, car.vy) * 3.6) };
  }
  // gravel samples, steepest first
  // the run-off areas (W.runoff since 2026-10-24: steep ones are grass, not gravel); older builds: the gravel itself
  const RO = W.runoff || W.grav, cand = [], all = [];
  for (let k = 0; k < n; k += 2) { const sd = RO[k]; if (!sd) continue; const hs = sd > 0 ? W.hwL[k] : W.hwR[k], lat = sd * (hs + 9), [x, z] = spotXZ(k, lat), c = { k, lat: r2(lat), slope: grad(x, z), gravel: W.grav[k] === sd }; all.push(c); if (c.gravel) cand.push(c); }
  cand.sort((a, b) => b.slope - a.slope); all.sort((a, b) => b.slope - a.slope);
  // the same steepest run-off, but against the barrier (lateral = barrier − 1 m, where the barrier code stops the car)
  const atWall = all.slice(0, arg.wall ?? 6).map(c => { const sd = Math.sign(c.lat), w = (sd > 0 ? W.wallL : W.wallR)[c.k], lat = isFinite(w) ? sd * (w - 1) : c.lat, [x, z] = spotXZ(c.k, lat); return { k: c.k, lat: r2(lat), slope: grad(x, z), wall: true }; });
  const spots = all.slice(0, arg.worst ?? 12).concat(atWall).concat((arg.spots || []).map(([k, lat]) => { const [x, z] = spotXZ(k, lat); return { k, lat, slope: grad(x, z), given: true }; }));
  const escape = spots.map(s => ({ k: s.k, lat: s.lat, slopePct: r2(s.slope * 100), given: !!s.given, wall: !!s.wall, gravelHere: (W.grav[s.k] === Math.sign(s.lat)), ...drive(s.k, s.lat, 0, 1, 'asphalt') }));
  // deceleration from 100 km/h in the first second
  const v0 = 100 / 3.6, flat = cand.filter(c => c.slope < 0.02);
  const dec = (k, lat) => { const r = drive(k, lat, v0, 0, 'time'); return { k, lat: r2(lat), surf: r.surf0, decel_ms2: r.v1 != null ? r2(v0 - r.v1) : null }; };
  let decel = null;
  if (flat.length) {
    const g = flat[Math.floor(flat.length / 2)], sd = Math.sign(g.lat), hs = sd > 0 ? W.hwL[g.k] : W.hwR[g.k];
    decel = { asphalt: dec(g.k, 0), grass: dec(g.k, -sd * (hs + 9)), gravel: dec(g.k, g.lat) };
  }
  let gravM = 0; for (let k = 0; k < n; k++) if (W.grav[k]) gravM += W.ds;
  return { track: { n, len: Math.round(W.len) }, gravelSamples: cand.length, gravelM: Math.round(gravM), maxGravelSlopePct: cand.length ? r2(cand[0].slope * 100) : null,
    escaped: escape.filter(e => e.out).length, of: escape.length, escape, decel };
}
