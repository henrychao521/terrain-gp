"""Snap the Mapillary camera poses onto the game's carriageway before rendering the game view.

  python3 tools/streetview/snap_poses.py <work dir>

Photo GPS is off by several metres, which put the game camera on the sidewalk or inside the street-tree row. Each pose
moves to the nearest centreline sample of its circuit, keeping its lateral offset but clamped to the carriageway
(|offset| <= half width - 1 m). Heading: panoramas were cropped at the driving direction (unchanged); perspective
photos keep their own heading, and are dropped when it is more than 25 deg off the driving direction (the photo then
looks across the street, not along it). Writes <work>/mapillary/poses_snap_<track>.json.
"""
import json, math, sys, collections
W = sys.argv[1]; P = json.load(open(f'{W}/mapillary/poses.json')); out = collections.defaultdict(list); drop = collections.Counter()
T = {}
for p in P:
    tr, slot, dirn = p['id'].rsplit('_', 2)
    if tr not in T: T[tr] = json.load(open(f'{W}/tracks/{tr}.json'))
    t = T[tr]; X = [x + t['sx'] / 2 for x in t['x']]; Y = [t['sz'] / 2 - z for z in t['z']]
    k = min(range(t['n']), key=lambda k: (X[k] - p['X']) ** 2 + (Y[k] - p['Y']) ** 2)
    lx, ly = t['lx'][k], -t['lz'][k]; lat = (p['X'] - X[k]) * lx + (p['Y'] - Y[k]) * ly
    hw = t['hwL'][k] if lat > 0 else t['hwR'][k]; lat = max(-(t['hwR'][k] - 1), min(t['hwL'][k] - 1, lat))
    trav = math.degrees(math.atan2(ly, -lx)) % 360  # left rotated -90 deg: (ly, -lx) -> heading atan2(dx, dy)
    trav = math.degrees(math.atan2(ly, -lx)) % 360
    want = trav if dirn == 'fwd' else (trav + 180) % 360
    persp = '/crops/' in str(p.get('img', '')) and p.get('fov') != 70 or 'crops' not in str(p.get('img', ''))
    diff = abs((p['heading'] - want + 180) % 360 - 180)
    if persp and diff > 25: drop[tr] += 1; continue
    out[tr].append({**p, 'X': round(X[k] + lx * lat, 2), 'Y': round(Y[k] + ly * lat, 2), 'heading_diff': round(diff, 1), 'snap_m': round(math.hypot(p['X'] - X[k] - lx * lat, p['Y'] - Y[k] - ly * lat), 1)})
for tr, ps in out.items(): json.dump(ps, open(f'{W}/mapillary/poses_snap_{tr}.json', 'w'))
print({tr: len(v) for tr, v in out.items()}, 'dropped (heading > 25 deg)', dict(drop))
