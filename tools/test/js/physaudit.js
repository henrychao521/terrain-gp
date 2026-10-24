// 物理與穿圖稽核（在 Node 的 tools/test/node/world.js 裡跑，game.js 是真的、沒有畫面）。world.js 建好賽道後呼叫這個函式。
// 入口：python3 tools/test/run.py phys（tools/test/physaudit.py）。原本是 iOS 移植 CampusRacer 的 tools/physaudit/audit.js。
// arg: { scenarios: [{ name, mode, secs, fps, cap, k0 }], fitWalls }
//   mode: normal（照中線、遊戲的自動油門＋煞車輔助）｜wall（貼左牆開）｜nobrake（全油門、不煞車）｜wrong（逆向開過起點）
//         ｜ai（9 台電腦車、故意去撞）｜perp（車頭垂直頂著左側護欄、方向盤回正、自動油門：看會不會自己脫困）
// 偵測：牆外（超過護欄）、車身在建物腳印內、賽道索引跳動（定位跳到別段）、瞬移、速度突變、垂直顛簸、卡住、圈數錯誤、與電腦車重疊。
(arg) => {
  function crFitWalls(T) {
    var W = T.W, M = T.CITY && T.CITY.taipei, occ = M && M.occ; if (!W || !W.city || !occ || !W.wallL) return { changed: 0 };
    var sx = W.sx, sz = W.sz, n = W.n, changed = 0, minLat = Infinity;
    var inB = function (x, z) { var i = Math.floor((x + sx / 2) / occ.cs), j = Math.floor((z + sz / 2) / occ.cs); return i >= 0 && j >= 0 && i < occ.rw && j < occ.rh && occ.a[j * occ.rw + i] === 1; };
    [[W.wallL, W.hwL, 1], [W.wallR, W.hwR, -1]].forEach(function (s) {
      var wall = s[0], hw = s[1], sd = s[2];
      for (var k = 0; k < n; k++) {
        var reach = isFinite(wall[k]) ? wall[k] : hw[k] + 8;
        for (var l = hw[k] + 0.3; l <= reach; l += 0.5) {
          if (inB(W.x[k] + W.lx[k] * l * sd, W.z[k] + W.lz[k] * l * sd)) {
            var nw = Math.max(hw[k] + 1.0, l - 0.3);            // 護欄放在建物前 0.3 m，但至少留路寬＋1 m
            if (nw < wall[k]) { wall[k] = nw; changed++; minLat = Math.min(minLat, nw - hw[k]); }
            break;
          }
        }
      }
    });
    return { changed: changed, minGap: isFinite(minLat) ? Math.round(minLat * 10) / 10 : null };
  }
  
  const fitted = arg.fitWalls ? crFitWalls(window.TGP) : null;
  const T = window.TGP, X = window.TGPX, W = T.W, car = T.car, RACE = X.RACE, n = W.n, ds = W.ds, DT = 1 / 240;
  const M = T.CITY.taipei, occ = M && M.occ, sx = W.sx, sz = W.sz;
  const D = (x, z) => [Math.round(x + sx / 2), Math.round(sz / 2 - z)];                 // 世界座標 → 資料座標（TWD97 E 299000／N 2766400 起算）
  // 精確判斷：建物腳印多邊形（M.blds），20 m 格網加速；4 m 佔用格太粗，路邊會誤判
  const G = 20, grid = new Map();
  if (M && M.blds) M.blds.forEach((b, bi) => { const p = b.p, m = p.length / 2; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < m; i++) { x0 = Math.min(x0, p[i * 2]); x1 = Math.max(x1, p[i * 2]); z0 = Math.min(z0, p[i * 2 + 1]); z1 = Math.max(z1, p[i * 2 + 1]); }
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) { const key = gx + ',' + gz; (grid.get(key) || grid.set(key, []).get(key)).push(bi); } });
  const pip = (x, z, p) => { let c = false; const m = p.length / 2; for (let i = 0, j = m - 1; i < m; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const inBld = (x, z) => { const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)); return !!l && l.some(bi => pip(x, z, M.blds[bi].p)); };
  const road = k => W.rname ? (W.rname[((k % n) + n) % n] || '?') : '?';
  const r1 = v => Math.round(v * 10) / 10;

  // ---------------- 靜態：護欄缺口、車子可到的範圍內有建物
  const stat = { wallGapM: { L: 0, R: 0 }, wallGaps: [], bldInCorridor: 0, bldSamples: [], slopeJumps: [] };
  for (const [side, arr, hwA] of [['L', W.wallL, W.hwL], ['R', W.wallR, W.hwR]]) {
    let run = 0, start = -1;
    for (let k = 0; k <= n; k++) {
      const gap = k < n && !isFinite(arr[k]);
      if (gap) { if (run === 0) start = k; run++; }
      else if (run) { stat.wallGapM[side] += run * ds; if (run * ds >= 20) stat.wallGaps.push({ side, k: start, m: Math.round(run * ds), road: road(start), at: D(W.x[start], W.z[start]) }); run = 0; }
    }
    const sd = side === 'L' ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const lim = (isFinite(arr[k]) ? arr[k] : hwA[k] + 6) - 1.0;                       // 沒護欄時看路緣外 6 m
      for (let l = 1.0; l <= lim; l += 0.5) {
        const x = W.x[k] + W.lx[k] * l * sd, z = W.z[k] + W.lz[k] * l * sd;
        if (inBld(x, z)) { stat.bldInCorridor++; if (stat.bldSamples.length < 12 && (!stat.bldSamples.length || Math.abs(stat.bldSamples[stat.bldSamples.length - 1].k - k) > 10))
          stat.bldSamples.push({ k, side, lat: r1(l), wall: isFinite(arr[k]) ? r1(arr[k]) : null, hw: r1(hwA[k]), road: road(k), at: D(x, z) }); break; }
      }
    }
  }
  for (let k = 0; k < n; k++) { const a = T.Sq(W.x[k], W.z[k], k), b = T.Sq(W.x[(k + 1) % n], W.z[(k + 1) % n], (k + 1) % n), g = (b - a) / ds;
    if (Math.abs(g) > 0.15 && stat.slopeJumps.length < 10) stat.slopeJumps.push({ k, grade: r1(g * 100) + '%', road: road(k), elev: W.elev[k] > 0, at: D(W.x[k], W.z[k]) }); }

  // ---------------- 動態
  function run(sc) {
    // seeded randomness (the computer drivers' mistakes and aggression): same formula as the height-sampling harness, so its seeds reproduce
    const seed = sc.seed != null ? sc.seed : arg.seed;
    if (seed != null) { let a = (seed * 2654435761) >>> 0; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    const fps = sc.fps || 60, cap = sc.cap || 0.1, frameDt = Math.min(cap, 1 / fps), frames = Math.round((sc.secs || 60) * fps);
    Object.assign(T.setup, { level: 'easy', autogas: sc.autogas !== undefined ? sc.autogas : sc.mode !== 'wrong', brakeAssist: sc.mode === 'normal' || sc.mode === 'ai', mode: sc.mode === 'ai' ? 'ai' : 'solo', aiCount: 9, aiSkill: 0.6 });
    X.resetRace(); RACE.on = false;
    if (sc.mode === 'ai') { T.setupGrid(); RACE.on = true; RACE.go(); } else T.placeCar(sc.k0 || 0, 0);
    if (sc.mode === 'wrong') { T.placeCar(sc.k0 || 30, 0); car.psi += Math.PI; }
    if (sc.mode === 'perp') { const k = sc.k0 || 60, lim = (isFinite(W.wallL[k]) ? W.wallL[k] : W.hwL[k] + 2) - 1.0; T.placeCar(k, Math.max(0, lim - 0.3)); car.psi += Math.PI / 2; } // nose against the left barrier
    T.state.mode = 'race'; T.state.t = 0; T.state.lap = 0; T.state.lapStart = 0; T.state.lastK = car.k; if (!RACE.on) X.startLap();
    for (const k in T.keys) T.keys[k] = false;
    const t = T.touch; t.sActive = true; t.gas = 0; t.brake = 0;
    const ev = { wallHits: 0, aiStuck: 0, aiJump: 0, aiJumpMax: 0, maxOverWall: 0, beyondWall: 0, inBuilding: 0, kJump: 0, teleport: 0, spike: 0, spikeWall: 0, jolt: 0, stuck: 0, offTrackSec: 0, aiOverlapDeep: 0, aiContactSec: 0, aiAiDeep: 0 };
    const samples = {}; const keep = (kind, o) => { (samples[kind] = samples[kind] || []); if (samples[kind].length < 5) samples[kind].push(o); };
    let acc = 0, px = car.x, pz = car.z, pv = 0, pk = car.k, py = car.y, pdy = 0, still = 0, dist = 0, laps = [], lastLap = 0, wasStuck = false, dist60 = null, prog = 0, freedAt = null, resets = 0;
    let prevHit = 0; const k0 = car.k, x0 = car.x, z0 = car.z, aiPrev = new Map(), aiStill = new Map();
    for (let f = 0; f < frames; f++) {
      // 駕駛：看前方 18 m（或 0.7 秒）的中線點；wall＝往左偏到路寬邊；wrong＝看後方
      const v = Math.hypot(car.vx, car.vy), look = Math.round(Math.max(18, v * 0.7) / ds) * (sc.mode === 'wrong' ? -1 : 1);
      let tk = (((car.k + look) % n) + n) % n, ax = W.x[tk], az = W.z[tk];
      if (sc.mode === 'wall') { const off = W.hwL[tk] - 0.3; ax += W.lx[tk] * off; az += W.lz[tk] * off; }
      if (sc.mode === 'ai' && RACE.cars.length) { // 故意靠向前方最近的電腦車
        let best = null, bd = 60; for (const o of RACE.cars) { const dx = o.x - car.x, dz = o.z - car.z, d = Math.hypot(dx, dz); const fwd = dx * Math.cos(car.psi) - dz * Math.sin(car.psi); if (fwd > 0 && d < bd) { bd = d; best = o; } }
        if (best) { ax = best.x; az = best.z; }
      }
      let err = Math.atan2(-(az - car.z), ax - car.x) - car.psi; err = Math.atan2(Math.sin(err), Math.cos(err));
      t.steer = Math.max(-1, Math.min(1, err * 2.5));
      if (sc.mode === 'wrong') { t.gas = 1; }
      if (sc.mode === 'perp') { t.steer = 0; if (T.setup.autogas === false) t.gas = 1; } // hands off: only the game's own recovery can get the car out (manual: holding the throttle)
      // 遊戲一格（同 frame() 的比賽分支）
      T.readInput(frameDt); T.gearLogic(frameDt, T.inp);
      acc += frameDt; while (acc >= DT) { T.physicsStep(DT, T.inp); acc -= DT; T.state.t += DT; }
      const hitNow = car.hit; if (hitNow > 3 && !(prevHit > 3)) ev.wallHits++; prevHit = hitNow; /* barrier impacts over 3 m/s */ X.raceUpdate(); if (RACE.on) T.opponentsStep(frameDt);
      // 檢查
      const nv = Math.hypot(car.vx, car.vy), mv = Math.hypot(car.x - px, car.z - pz), here = { t: r1(T.state.t), k: car.k, road: road(car.k), kmh: Math.round(nv * 3.6), at: D(car.x, car.z) };
      dist += mv; if (dist60 === null && T.state.t >= 60) dist60 = Math.round(dist);
      { let d = car.k - pk; if (d > n / 2) d -= n; if (d < -n / 2) d += n; prog += d * ds; }
      if (sc.mode === 'perp' && freedAt === null && Math.abs(prog) > 15 && nv > 3) freedAt = r1(T.state.t); // driving on along the track
      if (mv > 3 && Math.hypot(car.x - W.x[car.k], car.z - W.z[car.k]) < 0.6 && nv < 0.1) resets++; // resetToTrack: back on the centreline, standing
      // how far the car's centre is past "barrier - 1 m": against the continuous barrier line when the game has one (wallContact),
      // else against the nearest sample's barrier offset (older game.js; it over-reads at junction corners)
      const wcl = X.wallContact ? X.wallContact(car.x, car.z, car.k, car.lat) : null;
      const lim = wcl ? Math.abs(car.lat) + wcl.d - 1.0 : (car.lat > 0 ? W.wallL[car.k] : W.wallR[car.k]) - 1.0;
      if (Math.abs(car.lat) - lim > ev.maxOverWall) { ev.maxOverWall = r1(Math.abs(car.lat) - lim); samples.maxOverWall = [{ ...here, lat: r1(car.lat), lim: r1(lim), hit: r1(hitNow) }]; }
      if (Math.abs(car.lat) > lim + 0.05) { ev.beyondWall++; keep('beyondWall', { ...here, lat: r1(car.lat), lim: r1(lim) }); }
      const fx = Math.cos(car.psi), fz = -Math.sin(car.psi), lx = -Math.sin(car.psi), lz = -Math.cos(car.psi);
      const box = [[0, 0], [2.3, 0.9], [2.3, -0.9], [-2.3, 0.9], [-2.3, -0.9]].some(([a, b]) => inBld(car.x + fx * a + lx * b, car.z + fz * a + lz * b));
      if (box) { ev.inBuilding++; keep('inBuilding', { ...here, lat: r1(car.lat) }); }
      let dk = car.k - pk; if (dk > n / 2) dk -= n; if (dk < -n / 2) dk += n;
      const maxDk = Math.ceil((Math.max(pv, nv) * frameDt) / ds) + 4;
      if (Math.abs(dk) > maxDk) { ev.kJump++; keep('kJump', { ...here, from: pk, dk, fromRoad: road(pk) }); }
      if (mv > Math.max(pv, nv) * frameDt * 1.5 + 1.0) { ev.teleport++; keep('teleport', { ...here, moved: r1(mv) }); }
      const a = Math.abs(nv - pv) / frameDt;
      if (a > 80) { if (hitNow > 0) { ev.spikeWall++; keep('spikeWall', { ...here, g: r1(a / 9.81) }); } else { ev.spike++; keep('spike', { ...here, g: r1(a / 9.81) }); } }
      const dy = (car.y - py), ddy = (dy - pdy) / frameDt / frameDt;
      if (f > 2 && Math.abs(ddy) > 40 && nv > 5) { ev.jolt++; keep('jolt', { ...here, vertG: r1(ddy / 9.81), elev: W.elev[car.k] > 0 }); }
      if (nv < 1 && T.state.t > 3) { still += frameDt; if (still > 3 && !wasStuck) { ev.stuck++; wasStuck = true; keep('stuck', { ...here, lat: r1(car.lat) }); } } else { still = 0; wasStuck = false; }
      if (car.surf >= 2) ev.offTrackSec += frameDt;
      if (T.state.lap > lastLap) { laps.push({ lap: T.state.lap, t: r1(T.state.t), best: isFinite(T.state.best) ? Math.round(T.state.best * 100) / 100 : null }); lastLap = T.state.lap; }
      if (RACE.on) {
        let close = false;
        for (const o of RACE.cars) { const d = Math.hypot(o.x - car.x, o.z - car.z); if (d < 4.4) close = true; if (d < 1.2) { ev.aiOverlapDeep++; keep('aiOverlapDeep', { ...here, d: r1(d) }); } }
        if (close) ev.aiContactSec += frameDt;
        for (let i = 0; i < RACE.cars.length; i++) { // computer cars: stopped for 3 s after their start, or moved along the track much more / less than v dt
          const o = RACE.cars[i], pr = aiPrev.get(i);
          if (pr && T.state.t > o.delay) { const jump = Math.abs((o.s - pr.s) - pr.v * frameDt); if (jump > 1.0) { ev.aiJump++; keep('aiJump', { ...here, car: i, ds: r1(o.s - pr.s), v: r1(pr.v), lat: r1(o.lat) }); } if (jump > ev.aiJumpMax) ev.aiJumpMax = r1(jump); }
          aiPrev.set(i, { s: o.s, v: o.v });
          if (T.state.t > o.delay + 1 && o.v < 1 && !(o.finT >= 0)) { const st = (aiStill.get(i) || 0) + frameDt; aiStill.set(i, st); if (st > 3 && st - frameDt <= 3) { ev.aiStuck++; keep('aiStuck', { t: r1(T.state.t), car: i, s: r1(o.s), lat: r1(o.lat), k: Math.floor((((o.s % W.len) + W.len) % W.len) / ds), delay: r1(o.delay), playerK: car.k, playerLat: r1(car.lat), playerKmh: Math.round(nv * 3.6) }); } }
          else aiStill.set(i, 0);
        }
        for (let i = 0; i < RACE.cars.length; i++) for (let j = i + 1; j < RACE.cars.length; j++) { const p = RACE.cars[i], q = RACE.cars[j]; if (Math.hypot(p.x - q.x, p.z - q.z) < 1.2) { ev.aiAiDeep++; keep('aiAiDeep', { t: r1(T.state.t), i, j, d: r1(Math.hypot(p.x - q.x, p.z - q.z)), ds: r1(X.wrapGap ? 0 : p.s - q.s), si: r1(p.s), sj: r1(q.s), li: r1(p.lat), lj: r1(q.lat), di: r1(p.delay), dj: r1(q.delay), vi: r1(p.v), vj: r1(q.v) }); } }
      }
      car.hit = 0;
      px = car.x; pz = car.z; pv = nv; pk = car.k; pdy = dy; py = car.y;
    }
    for (const k of ['offTrackSec', 'aiContactSec']) ev[k] = r1(ev[k]);
    return { name: sc.name, mode: sc.mode, seed, autogas: T.setup.autogas, fps: sc.fps || 60, cap: sc.cap || 0.1, gameSec: r1(T.state.t), distM: Math.round(dist), dist60M: dist60, progressM: Math.round(prog), finalK: car.k, laps, ev,
      ...(sc.mode === 'perp' ? { freedAt, resets } : {}), samples };
  }
  const out = { track: { n, len: Math.round(W.len), ds }, fitted, stat, runs: [] };
  for (const sc of arg.scenarios) { try { out.runs.push(run(sc)); } catch (e) { out.runs.push({ name: sc.name, error: String(e && e.stack || e).slice(0, 300) }); } }
  return out;
}
