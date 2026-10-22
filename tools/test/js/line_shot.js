// Put the player car 45 m before the tightest corner (lowest grade) and stop it, for a screenshot of the line guide.
() => {
  const T = window.TGP, W = T.W, cs = W.corners;
  const c = cs.reduce((a, b) => (b.grade < a.grade ? b : a), cs[0]);
  T.placeCar((c.entry - Math.round(45 / W.ds) + W.n) % W.n, 0); T.car.vx = 0;
  return { corner: c.entry, road: W.rname[c.entry], deg: c.deg };
}
