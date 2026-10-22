// Computer drivers raced faster than real time: opponentsStep() with a fixed 1/60 s step and a seeded Math.random,
// nothing rendered. The player's car stays parked on its grid slot, so every lap the field also passes a stopped car.
// Run after the race has been started from the menu (race mode "ai"), so the world and the grid exist.
// contactSec: summed time of every pair of cars closer than 4.4 m along and 1.8 m across the road.
// offroadSec: summed time of cars with a wheel off the tarmac (lateral offset beyond half width - 0.85 m).
// overtakes: checks (every 0.1 s) where the running order changed. spread: metres from the leader to the last car;
// lappedCars: cars a full lap (W.len) or more behind the leader.
async ({ secs, seed, count, skill }) => {
  let a = seed >>> 0; // mulberry32: the same seed gives the same race
  Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const T = window.TGP, W = T.W, R = T.RACE, S = T.state, dt = 1 / 60;
  // setupGrid() reads these; the menu has already copied its sliders into setup at start, so set them here
  Object.assign(T.setup, { mode: 'ai', aiCount: count, aiSkill: skill, laps: 1e6 });
  T.setupGrid(); S.mode = 'sim'; S.t = 0; R.go();
  const n = W.n, L = W.len, cars = R.cars; let contacts = 0, offroad = 0, overtakes = 0, steps = 0;
  const order = () => cars.map((c, i) => [c.s, i]).sort((x, y) => y[0] - x[0]).map(x => x[1]);
  let prev = order(); const where = {}, kind = {};
  for (let t = 0; t < secs; t += dt) {
    T.opponentsStep(dt); S.t += dt; steps++;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], k = Math.floor((((c.s % L) + L) % L) / W.ds) % n;
      if (c.lat > W.hwL[k] - 0.85 || c.lat < -(W.hwR[k] - 0.85)) offroad++;
      for (let j = i + 1; j < cars.length; j++) {
        const o = cars[j], g = Math.abs(T.wrapGap(o.s - c.s));
        if (g < 4.4 && Math.abs(o.lat - c.lat) < 1.8) {
          contacts++; const kb = Math.floor(k / 25) * 25; where[kb] = (where[kb] || 0) + dt;
          // side-by-side or nose-to-tail, and what the two were doing: P passing, D defending, E making a mistake
          const tag = (g < 2 ? 'side' : 'tail') + '/' + [c, o].map(q => q.pass ? 'P' : q.defT > 0 ? 'D' : q.errT > 0 ? 'E' : '-').sort().join('');
          kind[tag] = (kind[tag] || 0) + dt;
        }
      }
    }
    if (steps % 6 === 0) { const now = order(); for (let r = 0; r < now.length; r++) if (now[r] !== prev[r]) { overtakes++; break; } prev = now; }
  }
  const lead = Math.max(...cars.map(c => c.s));
  return {
    cars: cars.length, skillSetting: T.setup.aiSkill, skillMean: +(cars.reduce((s, c) => s + c.skill, 0) / cars.length).toFixed(3),
    trackM: Math.round(L), laps: Math.max(...cars.map(c => c.lap)), overtakes,
    contactSec: +(contacts * dt).toFixed(1), offroadSec: +(offroad * dt).toFixed(1),
    best: cars.map(c => isFinite(c.best) ? +c.best.toFixed(1) : null),
    spread: Math.round(lead - Math.min(...cars.map(c => c.s))), lappedCars: cars.filter(c => lead - c.s >= L).length,
    contactWhere: Object.entries(where).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([kk, v]) => ({ k: +kk, sec: +v.toFixed(1), road: W.rname[+kk], hwL: +W.hwL[+kk].toFixed(1), hwR: +W.hwR[+kk].toFixed(1) })),
    contactKind: Object.fromEntries(Object.entries(kind).map(([x, y]) => [x, +y.toFixed(1)])),
    final: cars.map(c => ({ s: Math.round(c.s), lap: c.lap, lat: +c.lat.toFixed(1), v: +c.v.toFixed(1) })),
    player: { k: T.car.k, lat: +T.car.lat.toFixed(1) },
  };
}
