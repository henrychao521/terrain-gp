// Racing line of the current track (RACE.line, built by buildProfile() inside buildWorld()).
// out: samples where the line comes closer than 1.3 m to a road edge (the car's half width plus margin), i.e. the
// line leaves the road. lapCentre / lapLine: lap time of the speed profile along the centreline / along the line.
() => {
  const T = window.TGP, W = T.W, n = W.n, RC = T.RACE; let tc = 0, tl = 0, emax = 0, Ll = 0; const outAt = []; let out = 0;
  for (let k = 0; k < n; k++) {
    tc += W.ds / RC.prof[k]; tl += RC.lineStep[k] / RC.lineProf[k]; Ll += RC.lineStep[k];
    const e = RC.line[k];
    if (e > W.hwL[k] - 1.3 || e < -(W.hwR[k] - 1.3)) { out++; if (outAt.length < 10) outAt.push({ k, road: W.rname[k], e: +e.toFixed(2), hwL: +W.hwL[k].toFixed(2), hwR: +W.hwR[k].toFixed(2) }); }
    emax = Math.max(emax, Math.abs(e));
  }
  const t = performance.now(); T.buildProfileFn(); const ms = performance.now() - t;
  return {
    n, len: Math.round(W.len), lineLen: Math.round(Ll), lapCentre: +tc.toFixed(1), lapLine: +tl.toFixed(1), linePace: +RC.linePace.toFixed(3),
    out, outAt, emax: +emax.toFixed(1), minCentreKmh: Math.round(Math.min(...RC.prof) * 3.6), minLineKmh: Math.round(Math.min(...RC.lineProf) * 3.6),
    profileMs: Math.round(ms),
  };
}
