"""Corrections to the OpenStreetMap roads of the Taipei map, from official Taipei City data (D1 / D2, docs/賽道修正_2026-10.md).

  python3 tools/taipei_overrides.py            apply data/taipei_overrides.json to data/taipei_osm.json (in place)
  python3 tools/taipei_overrides.py --check    only print what would change

tools/prep_taipei_osm.py applies the same overrides whenever it rebuilds data/taipei_osm.json, so the corrections
survive a fresh OSM extract; this script exists for the data already built (the OSM extract it came from is not kept).
Running it again is safe: the original road records are stored in taipei_osm.json ("overridden") and restored first,
so the result always equals "OSM as extracted + the overrides file as it is now".

Each override in data/taipei_overrides.json picks OSM roads by name and geometry, not by way id (the packed data has
no ids, and a geometric match also survives OSM edits):
  "name":   the road's OSM name
  "along":  a polyline [[X, Y], ...] (data metres) along the stretch, in the direction of travel; a road matches when at
            least half of its length lies within "tol" metres (default 4) of it and it runs the same way
  "width_m": new carriageway width (the game's track uses the full width of the way it drives)
  "lanes":   new lane count (optional)
  "pieces":  [{"to": [X, Y], "width_m": w}, ..., {"width_m": w}] split the matched road at the points "to" (in the
            direction of travel along "along") and give each piece its own width (null: keep the OSM width); for a road
            whose kerb distance changes along it (艋舺大道). The pieces share the split nodes, so the street graph stays joined.
  "shift":   [[X, Y, d], ...] move the road d metres to the right of the "along" direction (negative: left), linearly
            between the points and tapering to 0 over "taper_m" beyond the first and the last one. Junction nodes move
            with it in every other road that shares them, so the street graph stays connected; signals and crossings
            within 1.5 m of a moved node move too.
  "source", "note": where the numbers come from (kept in the file, not used).
"""
import copy, json, math, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM = os.path.join(REPO, 'data', 'taipei_osm.json')
OVR = os.path.join(REPO, 'data', 'taipei_overrides.json')


def _pts(r):  # road record -> [(x m, y m)]
    return [(r[6 + 2 * i] / 10, r[7 + 2 * i] / 10) for i in range((len(r) - 6) // 2)]


def _proj(p, line):
    """nearest point on the polyline: (distance, arc length, segment index, unit direction)"""
    best = (1e18, 0, 0, (1, 0)); s0 = 0
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        f = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (L * L)))
        d = math.hypot(p[0] - ax - dx * f, p[1] - ay - dy * f)
        if d < best[0]: best = (d, s0 + f * L, i, (dx / L, dy / L))
        s0 += L
    return best


def _matches(r, o):
    if r[1] != o['name'] or r[5] > 0: return False
    pts, line, tol = _pts(r), o['along'], o.get('tol', 4)
    tot = near = same = 0
    for a, b in zip(pts, pts[1:]):
        L = math.dist(a, b); m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); d, _, _, u = _proj(m, line)
        tot += L
        if d < tol: near += L; same += L * (1 if ((b[0] - a[0]) * u[0] + (b[1] - a[1]) * u[1]) > 0 else -1)
    return tot > 0 and near >= 0.5 * tot and same > 0


def _shift_at(p, o):
    """displacement (dx, dy) of a point near the stretch"""
    sh = o['shift']; line = [(x, y) for x, y, _ in sh]; ds = [d for _, _, d in sh]; taper = o.get('taper_m', 30)
    S = [0.0]
    for a, b in zip(line, line[1:]): S.append(S[-1] + math.dist(a, b))
    dist, s, i, u = _proj(p, line)
    # beyond the ends: distance past the end along the end segment's direction
    def along_end(k, sign):
        (ax, ay) = line[k]; return sign * ((p[0] - ax) * u[0] + (p[1] - ay) * u[1])
    if s <= 0: past = max(0.0, -along_end(0, 1)); d = ds[0] * max(0.0, 1 - past / taper)
    elif s >= S[-1]: past = max(0.0, along_end(-1, 1)); d = ds[-1] * max(0.0, 1 - past / taper)
    else:
        j = max(k for k in range(len(S) - 1) if S[k] <= s); f = (s - S[j]) / ((S[j + 1] - S[j]) or 1e-9); d = ds[j] + (ds[j + 1] - ds[j]) * f
    return u[1] * d, -u[0] * d  # right of the direction of travel


def _split(r, line, cuts):
    """split road record r at the arc lengths cuts (along line); returns [(record, arc length of its middle)]"""
    pts = _pts(r); out = [[]]; mids = []
    def flush(): pass
    S = [(_proj(p, line)[1]) for p in pts]
    for i, p in enumerate(pts):
        if i:
            a, b, sa, sb = pts[i - 1], p, S[i - 1], S[i]
            for c in cuts:
                if (sa - c) * (sb - c) < 0:  # a cut between these two vertices: new shared vertex
                    f = (c - sa) / (sb - sa); q = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
                    out[-1].append(q); out.append([q])
        out[-1].append(p)
    recs = []
    for seg in out:
        if len(seg) < 2: continue
        rec = r[:6] + [round(v * 10) for q in seg for v in q]
        recs.append((rec, _proj(((seg[0][0] + seg[-1][0]) / 2, (seg[0][1] + seg[-1][1]) / 2), line)[1]))
    return recs


def apply(osm, overrides, log=print):
    """modify osm (the taipei_osm.json dict) in place; returns a list of what changed"""
    roads = osm['roads']
    n0 = (osm.get('overridden') or {}).get('roads0')
    if n0: del roads[n0:]  # pieces an earlier application split off
    for i, rec in (osm.get('overridden') or {}).get('orig', {}).items():  # undo an earlier application
        roads[int(i)] = rec
    for k in ('signals', 'crossings'):
        if (osm.get('overridden') or {}).get(k): osm[k] = osm['overridden'][k]
    osm.pop('overridden', None)
    orig, changes, roads0 = {}, [], len(roads)
    sig0, cr0 = copy.deepcopy(osm.get('signals', [])), copy.deepcopy(osm.get('crossings', []))
    for o in overrides.get('roads', []):
        hit = [i for i, r in enumerate(roads) if _matches(r, o)]
        if not hit:
            log(f"override {o['name']}: no road matched"); changes.append({'name': o['name'], 'roads': 0}); continue
        moved = {}
        if 'pieces' in o:  # split first; the widths go with the pieces
            line = o['along']; ends = [_proj(pc['to'], line)[1] for pc in o['pieces'] if 'to' in pc]
            npieces = 0
            for i in list(hit):
                orig.setdefault(str(i), copy.deepcopy(roads[i]))
                parts = _split(roads[i], line, ends)
                for j, (rec, mid) in enumerate(parts):
                    w = o['pieces'][sum(1 for e in ends if mid > e)].get('width_m')
                    if w: rec[4] = round(w * 10)
                    if j == 0: roads[i] = rec
                    else: roads.append(rec)
                npieces += len(parts)
            changes.append({'name': o['name'], 'roads': len(hit), 'pieces': npieces, 'widths': [pc.get('width_m') for pc in o['pieces']]})
            log(f"override {o['name']}: {len(hit)} roads split into {npieces} pieces, widths {[pc.get('width_m') for pc in o['pieces']]}")
            continue
        for i in hit:
            orig.setdefault(str(i), copy.deepcopy(roads[i])); r = roads[i]
            if 'width_m' in o: r[4] = round(o['width_m'] * 10)
            if 'lanes' in o: r[3] = int(o['lanes'])
            if 'shift' in o:
                for v in range(6, len(r), 2):
                    p = (r[v] / 10, r[v + 1] / 10); dx, dy = _shift_at(p, o)
                    if abs(dx) + abs(dy) > 0.01: moved[(r[v], r[v + 1])] = (round(dx * 10), round(dy * 10))
        if moved:  # every road vertex at a moved node, in any road: keeps junctions joined
            for i, r in enumerate(roads):
                for v in range(6, len(r), 2):
                    m = moved.get((r[v], r[v + 1]))
                    if m:
                        orig.setdefault(str(i), copy.deepcopy(r)); r[v] += m[0]; r[v + 1] += m[1]
            for k in ('signals', 'crossings'):
                for e in osm.get(k, []):
                    for (x, y), (dx, dy) in moved.items():
                        if abs(e[0] - x) <= 15 and abs(e[1] - y) <= 15: e[0] += dx; e[1] += dy; break
        mx = max((math.hypot(*d) / 10 for d in moved.values()), default=0)
        changes.append({'name': o['name'], 'roads': len(hit), 'width_m': o.get('width_m'), 'lanes': o.get('lanes'), 'nodesMoved': len(moved), 'maxShiftM': round(mx, 1)})
        log(f"override {o['name']}: {len(hit)} roads" + (f", width {o['width_m']} m" if 'width_m' in o else '') + (f", {len(moved)} nodes moved up to {mx:.1f} m" if moved else ''))
    osm['overridden'] = {'file': 'data/taipei_overrides.json', 'changes': changes, 'orig': orig, 'roads0': roads0,
                         **({'signals': sig0} if osm.get('signals') != sig0 else {}), **({'crossings': cr0} if osm.get('crossings') != cr0 else {})}
    return changes


def main():
    osm = json.load(open(OSM)); ovr = json.load(open(OVR))
    apply(osm, ovr)
    if '--check' in sys.argv: return
    json.dump(osm, open(OSM, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', OSM, os.path.getsize(OSM) // 1024, 'KB')


if __name__ == '__main__':
    main()
