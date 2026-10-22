// A keyboard "novice" driving the real game in real time with automatic throttle. Two phases.
// 'begin': every 1/60 s aim at a point 18 m (or 0.7 s) ahead on the centreline and press only the arrow keys,
// left or right or nothing, with a 7-tick (~0.12 s) reaction delay. Counts spins (slip angle > 0.5 rad above 18 km/h,
// re-armed once it drops below 0.15 rad) and wall hits (impact > 2, at most one per 0.8 s); keeps a 2.5 s telemetry
// ring and saves its last 12 ticks (0.2 s) at the first spin.
// 'end': spins, wall hits, laps, best lap, details of each spin and the telemetry before the first one.
({ phase }) => {
  const T = window.TGP, c = T.car;
  if (phase === 'begin') {
    const q = []; window.__N = { spins: 0, sp: false, hits: 0, lastHit: 0, ring: [], at: [], trace: null };
    window.__N.timer = setInterval(() => {
      if (T.state.mode !== 'race') return;
      const n = T.W.n, v = Math.hypot(c.vx, c.vy), ahead = (c.k + Math.round(Math.max(18, v * 0.7) / T.W.ds)) % n;
      let err = Math.atan2(-(T.W.z[ahead] - c.z), T.W.x[ahead] - c.x) - c.psi; err = Math.atan2(Math.sin(err), Math.cos(err));
      q.push(err > 0.04 ? 1 : err < -0.04 ? -1 : 0);
      const s = q.length > 7 ? q.shift() : 0; T.keys.ArrowLeft = s > 0; T.keys.ArrowRight = s < 0;
      const beta = Math.abs(Math.atan2(c.vy, Math.abs(c.vx)));
      __N.ring.push({ kmh: Math.round(v * 3.6), thr: +c.thr.toFixed(2), brk: +c.brk.toFixed(2), steerDeg: +(c.delta * 57.3).toFixed(1), betaDeg: Math.round(beta * 57.3), key: s > 0 ? 'L' : s < 0 ? 'R' : '-', tc: !!c.tcAct, esc: !!c.escAct, gear: c.gear, lat: +c.lat.toFixed(2), k: c.k });
      if (__N.ring.length > 150) __N.ring.shift();
      if (v > 5 && beta > 0.5 && !__N.sp) {
        __N.spins++; __N.sp = true; if (!__N.trace) __N.trace = __N.ring.slice(-12);
        __N.at.push({ k: c.k, road: T.W.rname[c.k], kmh: Math.round(v * 3.6), thr: +c.thr.toFixed(2), brk: +c.brk.toFixed(2), tc: !!c.tcAct, esc: !!c.escAct, ba: !!c.baAct, steerDeg: +(c.delta * 57.3).toFixed(1), aF: Math.round(c.aF * 57.3), aR: Math.round(c.aR * 57.3), gear: c.gear, surf: c.surf, lat: +c.lat.toFixed(1) });
      } else if (beta < 0.15) __N.sp = false;
      if (c.hit > 2 && performance.now() - __N.lastHit > 800) { __N.hits++; __N.lastHit = performance.now(); }
      c.hit = 0;
    }, 1000 / 60);
    return true;
  }
  clearInterval(__N.timer); T.keys.ArrowLeft = T.keys.ArrowRight = false;
  return { spins: __N.spins, wallHits: __N.hits, lap: T.state.lap, best: isFinite(T.state.best) ? +T.state.best.toFixed(1) : null, spinsAt: __N.at, beforeFirstSpin: __N.trace };
}
