// Buildings inside the carriageway (Taipei). Run after buildWorld() once every Blender tile has loaded.
// From every second centreline sample, 1 m above the road, cast a ray sideways across the band the car can reach on each
// side: up to its barrier - 1 m (the car's centre is held there), at least to the road edge (W.hwL / W.hwR); a hit on a
// tile's building or landmark mesh is a "wall": a building standing where the car drives. arg.kerb: only to the road edge.
// Also returns a route summary: length, metres on viaducts, hairpins (>= 150 deg) and the roads driven.
(arg) => {
  const T = window.TGP, W = T.W, rc = new THREE.Raycaster(), meshes = [];
  T.scene.updateMatrixWorld(true);
  W.group.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.userData.tile && /^(buildings|landmarks)/.test(o.name)) meshes.push(o); });
  const at = []; let rays = 0; const o = new THREE.Vector3(), d = new THREE.Vector3();
  for (let k = 0; k < W.n; k += 2) for (const sd of [1, -1]) {
    const hs = sd > 0 ? W.hwL[k] : W.hwR[k], wl = sd > 0 ? W.wallL[k] : W.wallR[k], far = isFinite(wl) && !(arg && arg.kerb) ? Math.max(hs, wl - 1.0) : hs;
    o.set(W.x[k], T.Sq(W.x[k], W.z[k], k) + 1.0, W.z[k]); d.set(W.lx[k] * sd, 0, W.lz[k] * sd);
    rc.set(o, d); rc.far = far; rays++;
    const h = rc.intersectObjects(meshes, false)[0];
    if (h) at.push({ k, side: sd > 0 ? 'L' : 'R', road: W.rname[k], m: +h.distance.toFixed(1), halfWidth: +hs.toFixed(1), reach: +far.toFixed(1), mesh: h.object.name });
  }
  const seq = [];
  for (let k = 0; k < W.n; k++) { const nm = W.rname[k] + (W.elev[k] > 0 ? '^' : ''); if (!seq.length || seq[seq.length - 1][0] !== nm) seq.push([nm, 0]); seq[seq.length - 1][1] += W.ds; }
  return {
    walls: at.length, wallsAt: at.slice(0, 12), rays, buildingMeshes: meshes.length,
    tiles: W.tiles ? W.tiles.length : 0, tilesWanted: W.activeTiles ? W.activeTiles.length : 0,
    len: Math.round(W.len), viaductM: Math.round(W.elev.filter(v => v > 0).length * W.ds),
    hairpins: W.corners.filter(c => c.deg >= 150).map(c => c.deg + '@' + W.rname[c.entry]),
    route: seq.filter(s => s[1] > 120).map(s => s[0] + ' ' + Math.round(s[1])).join(' → '),
  };
}
