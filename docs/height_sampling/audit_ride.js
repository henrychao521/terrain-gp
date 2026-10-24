// 物理與穿圖稽核（在 Node 的 world.js 裡跑，game.js 是真的、沒有畫面）。world.js 建好賽道後呼叫這個函式。
// arg: { scenarios: [{ name, mode, secs, fps, cap, laneOff, ai }] }
//   mode: normal（照中線、遊戲的自動油門＋煞車輔助）｜wall（貼左牆開）｜nobrake（全油門、不煞車）｜wrong（逆向開過起點）｜ai（9 台電腦車、故意去撞）
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
    if (arg.seed != null) { let a = (arg.seed * 2654435761) >>> 0; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    const fps = sc.fps || 60, cap = sc.cap || 0.1, frameDt = Math.min(cap, 1 / fps), frames = Math.round((sc.secs || 60) * fps);
    Object.assign(T.setup, { level: 'easy', autogas: sc.mode !== 'wrong', brakeAssist: sc.mode === 'normal' || sc.mode === 'ai', mode: sc.mode === 'ai' ? 'ai' : 'solo', aiCount: 9, aiSkill: 0.6 });
    X.resetRace(); RACE.on = false;
    if (sc.mode === 'ai') { T.setupGrid(); RACE.on = true; RACE.go(); } else T.placeCar(sc.k0 || 0, 0);
    if (sc.mode === 'wrong') { T.placeCar(sc.k0 || 30, 0); car.psi += Math.PI; }
    T.state.mode = 'race'; T.state.t = 0; T.state.lap = 0; T.state.lapStart = 0; T.state.lastK = car.k; if (!RACE.on) X.startLap();
    for (const k in T.keys) T.keys[k] = false;
    const t = T.touch; t.sActive = true; t.gas = 0; t.brake = 0;
    const ev = { beyondWall: 0, inBuilding: 0, kJump: 0, teleport: 0, spike: 0, spikeWall: 0, jolt: 0, stuck: 0, offTrackSec: 0, aiOverlapDeep: 0, aiContactSec: 0, aiAiDeep: 0 };
    const samples = {}; const keep = (kind, o) => { (samples[kind] = samples[kind] || []); if (samples[kind].length < 5) samples[kind].push(o); };
    const NV = new window.THREE.Vector3(), PN = new window.THREE.Vector3(); let havePN = false; const ride = { nJumpMaxDeg: 0, nJump1: 0, nJump2: 0, ddyMax: 0, ddy20: 0, gradeJumpMax: 0 }; let pgrade = null;
    let acc = 0, px = car.x, pz = car.z, pv = 0, pk = car.k, py = car.y, pdy = 0, still = 0, dist = 0, laps = [], lastLap = 0, wasStuck = false;
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
      // 遊戲一格（同 frame() 的比賽分支）
      T.readInput(frameDt); T.gearLogic(frameDt, T.inp);
      acc += frameDt; while (acc >= DT) { T.physicsStep(DT, T.inp); acc -= DT; T.state.t += DT; }
      const hitNow = car.hit; X.raceUpdate(); if (RACE.on) T.opponentsStep(frameDt);
      // 檢查
      const nv = Math.hypot(car.vx, car.vy), mv = Math.hypot(car.x - px, car.z - pz), here = { t: r1(T.state.t), k: car.k, road: road(car.k), kmh: Math.round(nv * 3.6), at: D(car.x, car.z) };
      dist += mv;
      const lim = (car.lat > 0 ? W.wallL[car.k] : W.wallR[car.k]) - 1.0;
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
      if (nv < 1 && T.state.t > 3) { still += frameDt; if (still > 3 && !wasStuck) { ev.stuck++; wasStuck = true; keep('stuck', { ...here, lat: r1(car.lat), hit: car.hit, surf: car.surf, grade: r1(car.grade * 100), thr: r1(car.thr), brk: r1(car.brk), gear: car.gear, near: RACE.on ? RACE.cars.map(o => [r1(Math.hypot(o.x - car.x, o.z - car.z)), r1(o.v), r1(o.lat)]).filter(q => q[0] < 12) : [] }); } } else { still = 0; wasStuck = false; }
      if (car.surf >= 2) ev.offTrackSec += frameDt;
      if (T.state.lap > lastLap) { laps.push({ lap: T.state.lap, t: r1(T.state.t), best: isFinite(T.state.best) ? Math.round(T.state.best * 100) / 100 : null }); lastLap = T.state.lap; }
      if (RACE.on) {
        let close = false;
        for (const o of RACE.cars) { const d = Math.hypot(o.x - car.x, o.z - car.z); if (d < 4.4) close = true; if (d < 1.2) { ev.aiOverlapDeep++; keep('aiOverlapDeep', { ...here, d: r1(d) }); } }
        if (close) ev.aiContactSec += frameDt;
        for (let i = 0; i < RACE.cars.length; i++) for (let j = i + 1; j < RACE.cars.length; j++) { const p = RACE.cars[i], q = RACE.cars[j]; if (Math.hypot(p.x - q.x, p.z - q.z) < 1.2) ev.aiAiDeep++; }
      }
      X.normalS(car.x, car.z, car.k, NV);
      if (havePN && nv > 5) { const ang = Math.acos(Math.min(1, NV.dot(PN))) * 180 / Math.PI; ride.nJumpMaxDeg = Math.max(ride.nJumpMaxDeg, ang); if (ang > 1) ride.nJump1++; if (ang > 2) ride.nJump2++;
        if (f > 2) { ride.ddyMax = Math.max(ride.ddyMax, Math.abs(ddy)); if (Math.abs(ddy) > 20) ride.ddy20++; } }
      PN.copy(NV); havePN = true;
      if (pgrade !== null && nv > 5) ride.gradeJumpMax = Math.max(ride.gradeJumpMax, Math.abs(car.grade - pgrade)); pgrade = car.grade;
      car.hit = 0;
      px = car.x; pz = car.z; pv = nv; pk = car.k; pdy = dy; py = car.y;
    }
    for (const k of ['offTrackSec', 'aiContactSec']) ev[k] = r1(ev[k]);
    for (const k of ['nJumpMaxDeg', 'ddyMax', 'gradeJumpMax']) ride[k] = Math.round(ride[k] * 1000) / 1000;
    return { ride, name: sc.name, mode: sc.mode, fps: sc.fps || 60, cap: sc.cap || 0.1, gameSec: r1(T.state.t), distM: Math.round(dist), finalK: car.k, laps, ev, samples };
  }
  const out = { track: { n, len: Math.round(W.len), ds }, fitted, stat, runs: [] };
  for (const sc of arg.scenarios) { try { out.runs.push(run(sc)); } catch (e) { out.runs.push({ name: sc.name, error: String(e && e.stack || e).slice(0, 300) }); } }
  return out;
}
