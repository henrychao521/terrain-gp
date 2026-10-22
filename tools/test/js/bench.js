// Frame-time benchmark, two phases. 'begin': zero the per-phase timers (TGP.PERF) and renderer counters and start
// recording the time between animation frames. 'end': frame-time percentiles and the average milliseconds per frame
// spent in physics, computer drivers, rendering (CPU side) and HUD, plus draw calls and triangles per frame.
({ phase }) => {
  const T = window.TGP;
  if (phase === 'begin') {
    for (const k in T.PERF) T.PERF[k] = 0;
    T.renderer.info.autoReset = false; T.renderer.info.reset();
    window.__B = { frames: [] };
    let last = performance.now();
    const f = now => { __B.frames.push(now - last); last = now; if (__B.frames.length < 100000) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    return true;
  }
  const fr = __B.frames.slice(5).sort((a, b) => a - b), n = fr.length, sum = fr.reduce((a, b) => a + b, 0), inf = T.renderer.info, r1 = v => +v.toFixed(2);
  return {
    frames: n, fps: r1(1000 * n / sum), p50_ms: r1(fr[n >> 1]), p95_ms: r1(fr[Math.floor(n * 0.95)]), p99_ms: r1(fr[Math.floor(n * 0.99)]),
    phys_ms: r1(T.PERF.phys / n), opp_ms: r1(T.PERF.opp / n), rend_ms: r1(T.PERF.rend / n), hud_ms: r1(T.PERF.hud / n), cpu_ms: r1(T.PERF.cpu / n),
    calls: Math.round(inf.render.calls / inf.render.frame), tris: Math.round(inf.render.triangles / inf.render.frame),
    geoms: inf.memory.geometries, texs: inf.memory.textures, quality: T.q(), dpr: T.renderer.getPixelRatio(), mode: T.state.mode, ai: T.RACE.cars.length,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
}
