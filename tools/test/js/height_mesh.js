// Physics height vs the rendered surface under the car (runs in the page, or in Node through tools/test/node/world.js).
//
// The car's height is Sq(x, z, k): on the ground that is Hq = gridSample(W.H), a bilinear interpolation of the height
// grid. What is drawn are triangles: the ground mesh (W.H on the grid, two triangles per cell, split along the diagonal
// its index buffer uses), the circuit asphalt ribbon (vertices at Sq + 0.05 m), and in the city the street ribbon
// (vertices at Hq + 0.03 m on the OSM polyline nodes). This reads the triangles back from the meshes' own index
// buffers, finds the triangle under each sample point and compares its barycentric height with Sq.
//
// Samples: every 0.5 m along the lap, every 0.5 m across from -hwR to +hwL (the driven lane).
// arg: { step: 0.5, worst: 8 }
(arg = {}) => {
  const T = window.TGP, X = window.TGPX, W = T.W, n = W.n, step = arg.step || 0.5, nWorst = arg.worst || 8;
  const TEX = X && X.TEX;
  const D = (x, z) => [Math.round((x + W.sx / 2) * 10) / 10, Math.round((W.sz / 2 - z) * 10) / 10]; // world → data coordinates
  // ---------------------------------------------------------------- triangles of each surface mesh, in a 4 m xz hash
  const CS = 4;
  function surface(mesh, yOff) {
    const g = mesh.geometry, pos = g.attributes.position.array, idx = g.index ? g.index.array : null, nt = idx ? idx.length / 3 : pos.length / 9;
    mesh.updateMatrixWorld(true);
    const e = mesh.matrixWorld.elements; // the meshes are in world space (identity), checked here
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].every((v, i) => Math.abs(e[i] - v) < 1e-9);
    if (!ident) throw new Error('mesh not in world space: ' + mesh.name);
    const hash = new Map(), tri = new Float64Array(nt * 9), diag = { n: 0 };
    for (let t = 0; t < nt; t++) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let q = 0; q < 3; q++) { const vi = idx ? idx[t * 3 + q] : t * 3 + q; for (let c = 0; c < 3; c++) tri[t * 9 + q * 3 + c] = pos[vi * 3 + c];
        const x = pos[vi * 3], z = pos[vi * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      if (x1 - x0 > 400 || z1 - z0 > 400) continue; // a giant quad (the outer ground plane) is not a surface under the lane
      for (let i = Math.floor(x0 / CS); i <= Math.floor(x1 / CS); i++) for (let j = Math.floor(z0 / CS); j <= Math.floor(z1 / CS); j++) {
        const key = i * 100003 + j; let l = hash.get(key); if (!l) hash.set(key, l = []); l.push(t); }
    }
    // height of the top-most triangle of this mesh containing (x, z), or NaN; also returns the triangle index
    const out = { h: NaN, t: -1 };
    function at(x, z) {
      out.h = NaN; out.t = -1;
      const l = hash.get(Math.floor(x / CS) * 100003 + Math.floor(z / CS)); if (!l) return out;
      for (const t of l) {
        const o = t * 9, ax = tri[o], ay = tri[o + 1], az = tri[o + 2], bx = tri[o + 3], by = tri[o + 4], bz = tri[o + 5], cx = tri[o + 6], cy = tri[o + 7], cz = tri[o + 8];
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(det) < 1e-12) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const h = l1 * ay + l2 * by + l3 * cy - yOff;
        if (!(h <= out.h)) { out.h = h; out.t = t; }
      }
      return out;
    }
    return { at, tris: nt, name: mesh.name };
  }
  // ---------------------------------------------------------------- find the meshes
  let ground = null, asphalt = null, street = null, deck = null;
  W.group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
    const g = o.geometry, m = o.material;
    if (g.attributes.splat) ground = o;
    else if (m === W.asphalt) asphalt = o;
    else if (W.city && TEX && m && m.map === TEX.asphalt && !street) street = o;
  });
  // the index buffer diagonal of the ground mesh: cell (i, j) → which corners the shared edge joins
  let groundDiag = null;
  if (ground) { const I = ground.geometry.index.array, a = I[0], b = I[1], c = I[2], d4 = I[3], e = I[4], f = I[5];
    const s1 = new Set([a, b, c]), sh = [d4, e, f].filter(v => s1.has(v)).sort((p, q) => p - q);
    groundDiag = { firstCell: [a, b, c, d4, e, f], shared: sh, note: sh[1] - sh[0] === W.nx - 1 ? 'diagonal (i+1, j)–(i, j+1)' : sh[1] - sh[0] === W.nx + 1 ? 'diagonal (i, j)–(i+1, j+1)' : '?' }; }
  const G = ground && surface(ground, 0), A = asphalt && surface(asphalt, 0.05), S = street && surface(street, 0.03);
  // ---------------------------------------------------------------- sample the lane
  const Hs = [], rec = { contact: [], visible: [], asphalt: [], ground: [], street: [], pokeGround: [], streetOver: [] }, worst = { visible: [], asphalt: [], ground: [], pokeGround: [], streetOver: [] };
  const push = (arr, v) => arr.push(v);
  // the worst samples, at least 30 m apart; pruned in batches
  const prune = list => { list.sort((p, q) => Math.abs(q.d) - Math.abs(p.d)); const out = []; for (const w of list) { if (out.every(u => Math.hypot(u.x - w.x, u.z - w.z) > 30)) out.push(w); if (out.length >= nWorst) break; } list.length = 0; list.push(...out); };
  const keepWorst = (list, o) => { list.push(o); if (list.length > 2000) prune(list); };
  let samples = 0, noAsph = 0, onDeckN = 0; const edge = { street: 0, streetUnderGround: 0, samples: [] };
  const twist = []; // per sample: |p - q - c + d| of the height-grid cell under it (the bilinear vs triangle gap is |twist| / 4 at most)
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n, segL = Math.hypot(W.x[k1] - W.x[k], W.z[k1] - W.z[k]), m = Math.max(1, Math.round(segL / step));
    for (let s = 0; s < m; s++) {
      const f = s / m, cxp = W.x[k] + (W.x[k1] - W.x[k]) * f, czp = W.z[k] + (W.z[k1] - W.z[k]) * f;
      let lx = W.lx[k] + (W.lx[k1] - W.lx[k]) * f, lz = W.lz[k] + (W.lz[k1] - W.lz[k]) * f; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
      const hl = W.hwL[k] + (W.hwL[k1] - W.hwL[k]) * f, hr = W.hwR[k] + (W.hwR[k1] - W.hwR[k]) * f;
      const kk = f < 0.5 ? k : k1;
      // just outside the lane (0.25 … 3 m past each edge): does the street mesh still cover what it covered, and is it above the ground there?
      if (S && G) for (const sd of [1, -1]) for (let e = 0.25; e <= 3; e += step) {
        const lat = sd > 0 ? hl + e : -hr - e, x = cxp + lx * lat, z = czp + lz * lat, hs = S.at(x, z).h;
        if (hs === hs) { edge.street++; const hg = G.at(x, z).h; if (hs + 0.03 < hg - 1e-4) { edge.streetUnderGround++; if (edge.samples.length < 5) edge.samples.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, k: kk, below_mm: Math.round((hg - hs - 0.03) * 1000) }); } }
      }
      for (let lat = -hr; lat <= hl + 1e-6; lat += step) {
        const x = cxp + lx * lat, z = czp + lz * lat, ph = T.Sq(x, z, kk); samples++;
        if (W.anyElev && W.elev[kk] > 0) onDeckN++;
        // grid twist
        const fx = Math.min(Math.max((x + W.sx / 2) / W.sx * (W.nx - 1), 0), W.nx - 1.0001), fz = Math.min(Math.max((z + W.sz / 2) / W.sz * (W.nz - 1), 0), W.nz - 1.0001), o = (fz | 0) * W.nx + (fx | 0);
        twist.push(Math.abs(W.H[o] - W.H[o + 1] - W.H[o + W.nx] + W.H[o + W.nx + 1]));
        const here = { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, at: D(x, z), k: kk, lat: Math.round(lat * 10) / 10, road: W.rname ? W.rname[kk] : '' };
        let ha = NaN;
        if (A) { ha = A.at(x, z).h; if (ha === ha) { const d = ph - ha; push(rec.asphalt, Math.abs(d)); if (Math.abs(d) > 0.02) keepWorst(worst.asphalt, { ...here, d: Math.round(d * 1000) / 1000 }); } else noAsph++; }
        if (G) { const hg = G.at(x, z).h; if (hg === hg) { const d = ph - hg; push(rec.ground, Math.abs(d)); if (Math.abs(d) > 0.02) keepWorst(worst.ground, { ...here, d: Math.round(d * 1000) / 1000 });
          if (ha === ha) { const poke = hg - (ha + 0.05); push(rec.pokeGround, poke); if (poke > 0) keepWorst(worst.pokeGround, { ...here, d: Math.round(poke * 1000) / 1000 }); }
          // what is seen under the car: the higher of the ground and the drawn asphalt, less the asphalt's deliberate 0.05 m lift
          // tyre contact: where the car is drawn (Sq + the game's surface lift, 0 before 2026-10-24) against the top drawn surface
          const top = ha === ha ? Math.max(hg, ha + 0.05) : hg, lift = X && X.surfLift ? X.surfLift(kk, lat) : 0; if (ha === ha) push(rec.contact, Math.abs(ph + lift - top)); // on the asphalt
          const vis = (ha === ha ? Math.max(hg, ha + 0.05) - 0.05 : hg) - ph; push(rec.visible, Math.abs(vis)); if (Math.abs(vis) > 0.02) keepWorst(worst.visible, { ...here, d: Math.round(vis * 1000) / 1000 }); } }
        if (S) { const hs = S.at(x, z).h; if (hs === hs) { push(rec.street, Math.abs(ph - hs)); if (ha === ha) { const ov = (hs + 0.03) - (ha + 0.05); push(rec.streetOver, ov); if (ov > 0) keepWorst(worst.streetOver, { ...here, d: Math.round(ov * 1000) / 1000 }); } } }
      }
    }
  }
  for (const k in worst) prune(worst[k]);
  const stats = (a, signed) => { if (!a.length) return null; const s = Float64Array.from(a).sort(), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; let sum = 0; for (const v of s) sum += v;
    const r = v => Math.round(v * 10000) / 10; // mm
    return signed ? { n: s.length, above0: a.filter(v => v > 0).length, max_mm: r(s[s.length - 1]), p99_mm: r(q(0.99)), median_mm: r(q(0.5)) } : { n: s.length, max_mm: r(s[s.length - 1]), p99_mm: r(q(0.99)), mean_mm: r(sum / s.length) }; };
  return {
    track: { n, len: Math.round(W.len), ds: Math.round(W.ds * 1000) / 1000, city: !!W.city, cell: [Math.round(W.sx / (W.nx - 1) * 1000) / 1000, Math.round(W.sz / (W.nz - 1) * 1000) / 1000], anyElev: !!W.anyElev },
    meshes: { ground: G ? G.tris : 0, asphalt: A ? A.tris : 0, street: S ? S.tris : 0, groundDiag },
    samples, onDeck: onDeckN, noAsphalt: noAsph,
    // |physics − surface| (surface minus the mesh's own constant lift: asphalt 0.05 m, street 0.03 m)
    contact: stats(rec.contact), // |car drawn height − top drawn surface| (no allowance for the asphalt lift)
    visible: stats(rec.visible), asphalt: stats(rec.asphalt), ground: stats(rec.ground), street: stats(rec.street),
    twist: stats(twist), // per-cell |p − q − c + d|; bilinear − triangle ≤ twist / 4
    pokeGround: stats(rec.pokeGround, true), streetOver: stats(rec.streetOver, true), // > 0: that mesh is drawn above the circuit asphalt
    edge, // street coverage just outside the lane edges, and where it sinks under the ground (a hole)
    worst,
  };
}
