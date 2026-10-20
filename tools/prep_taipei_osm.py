"""Pack OpenStreetMap detail for the Taipei street circuit into data/taipei_osm.json.

Input: a directory of OSM XML files covering the map, TWD97 E 299000-304600 / N 2766400-2770600.
Output coordinates are decimetres east / north of TWD97 E 299000 / N 2766400, the same frame as data/taipei.json.

Recommended source, the daily Geofabrik extract of Taiwan (ODbL), cut to the map with osmium-tool:
  curl -LO https://download.geofabrik.de/asia/taiwan-latest.osm.pbf
  osmium extract -b 121.48346,25.00303,121.54309,25.04435 -s smart -o area.osm.pbf taiwan-latest.osm.pbf
  mkdir xml && osmium cat area.osm.pbf -o xml/area.osm
  python3 tools/prep_taipei_osm.py xml
Overlapping tiles from api.openstreetmap.org/api/0.6/map also work.
"""
import glob, json, math, random, sys, xml.etree.ElementTree as ET
from pyproj import Transformer

X0, Y0, SX, SY, PAD = 299000, 2766400, 5600, 4200, 40
TM = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
CLS = {'trunk': 0, 'primary': 1, 'secondary': 2, 'tertiary': 3, 'residential': 4, 'unclassified': 4, 'living_street': 4,
       'trunk_link': 5, 'primary_link': 5, 'secondary_link': 5, 'tertiary_link': 5}
LANES = {0: (6, 3), 1: (4, 3), 2: (4, 2), 3: (2, 2), 4: (2, 1), 5: (2, 1)}  # default lanes (two-way, one-way) when untagged
LANE_W, CURB_W = 3.2, 1.5  # Taipei arterial lanes ~3.0-3.5 m; outside lane has a scooter/slow strip
GREEN = {'park', 'garden', 'grass', 'forest', 'wood', 'pitch', 'playground', 'recreation_ground', 'village_green', 'meadow', 'scrub', 'golf_course'}
WOODED = {'forest', 'wood', 'park'}

nodes, ways, rels = {}, {}, {}
for fn in sorted(glob.glob(sys.argv[1] + '/*.osm')):
    for ev, el in ET.iterparse(fn, events=('end',)):
        if el.tag == 'node':
            tg = {t.get('k'): t.get('v') for t in el.findall('tag')}
            nodes[el.get('id')] = (float(el.get('lon')), float(el.get('lat')), tg or None); el.clear()
        elif el.tag == 'way':
            ways[el.get('id')] = ([n.get('ref') for n in el.findall('nd')], {t.get('k'): t.get('v') for t in el.findall('tag')}); el.clear()
        elif el.tag == 'relation':
            rels[el.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in el.findall('member')], {t.get('k'): t.get('v') for t in el.findall('tag')}); el.clear()  # by id: overlapping tiles repeat relations
print('osm', len(nodes), 'nodes', len(ways), 'ways', len(rels), 'relations')

proj = {}
def xy(nid):
    if nid not in proj:
        lo, la, _ = nodes[nid]; e, n = TM.transform(lo, la); proj[nid] = (e - X0, n - Y0)
    return proj[nid]
inside = lambda p: -PAD <= p[0] <= SX + PAD and -PAD <= p[1] <= SY + PAD
dm = lambda v: int(round(v * 10))
def flat(pts): return [dm(v) for p in pts for v in p]
def num(v, d=None):
    try: return float(str(v).split(';')[0].replace('m', '').strip())
    except (TypeError, ValueError): return d

# --- roads: class, name, one-way, lanes and carriageway width
roads = []
road_names_at = {}
for wid, (nds, t) in ways.items():
    c = CLS.get(t.get('highway'))
    if c is None or t.get('area') == 'yes' or t.get('tunnel') in ('yes', 'building_passage') or t.get('access') in ('no', 'private'): continue
    pts = [xy(n) for n in nds if n in nodes]
    if len(pts) < 2 or not any(inside(p) for p in pts): continue
    one = 1 if t.get('oneway') in ('yes', '1', 'true') or t.get('junction') == 'roundabout' else -1 if t.get('oneway') == '-1' else 0
    if one == -1: pts = pts[::-1]; one = 1
    ln = int(num(t.get('lanes'), 0) or 0) or LANES[c][1 if one else 0]
    if one and ln == 1 and c <= 2 and sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)) > 300:
        ln = LANES[c][1]  # a long single-lane primary/secondary mainline is a tagging gap (e.g. 艋舺大道 eastbound), not a real lane count
    w = num(t.get('width')) or ln * LANE_W + (CURB_W if one else 2 * CURB_W) * (1 if c <= 3 else 0)
    w = max(4.0, min(w, 40.0))
    lay = int(num(t.get('layer'), 0) or 0) if t.get('bridge') else 0
    roads.append([c, t.get('name', ''), one, ln, dm(w), lay] + flat(pts))
    for n in nds:
        if t.get('name'): road_names_at.setdefault(n, set()).add(t['name'])
print('roads', len(roads))

# --- traffic lights (with the names of the streets that meet there) and crossings
signals, crossings = [], []
for nid, (lo, la, t) in nodes.items():
    if not t: continue
    hw = t.get('highway')
    if hw == 'traffic_signals' or hw == 'crossing':
        p = xy(nid)
        if not inside(p): continue
        if hw == 'traffic_signals': signals.append([dm(p[0]), dm(p[1]), '／'.join(sorted(road_names_at.get(nid, ())))])
        else: crossings.append([dm(p[0]), dm(p[1])])
for wid, (nds, t) in ways.items():  # crossings mapped as short footway ways across the road
    if t.get('footway') == 'crossing' and len(nds) >= 2 and all(n in nodes for n in (nds[0], nds[-1])):
        a, b = xy(nds[0]), xy(nds[-1])
        if inside(a): crossings.append([dm((a[0] + b[0]) / 2), dm((a[1] + b[1]) / 2)])
print('signals', len(signals), 'crossings', len(crossings))

# --- green areas and trees
def ring_of(nds): return [xy(n) for n in nds if n in nodes]
def area(r): return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2
def pip(x, y, r):
    c = False
    for i in range(len(r)):
        (x1, y1), (x2, y2) = r[i - 1], r[i]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1): c = not c
    return c
green, trees = [], []
rnd = random.Random(7)
def add_green(r, kind):
    if len(r) < 4 or area(r) < 150 or not any(inside(p) for p in r): return
    green.append([kind] + flat(r))
    if kind in WOODED:  # scatter trees: forests dense, parks lighter (lawns and plazas stay open)
        dens = 1 / 45 if kind in ('forest', 'wood') else 1 / 420  # parks keep their lawns and plazas open
        x0, x1 = min(p[0] for p in r), max(p[0] for p in r); y0, y1 = min(p[1] for p in r), max(p[1] for p in r)
        for _ in range(min(4000, int(area(r) * dens))):
            x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
            if pip(x, y, r) and inside((x, y)): trees.append([dm(x), dm(y), 1])
for wid, (nds, t) in ways.items():
    kind = t.get('leisure') if t.get('leisure') in GREEN else t.get('landuse') if t.get('landuse') in GREEN else t.get('natural') if t.get('natural') in GREEN else None
    if kind and nds and nds[0] == nds[-1]: add_green(ring_of(nds), kind)
for members, t in rels.values():
    kind = t.get('leisure') if t.get('leisure') in GREEN else t.get('landuse') if t.get('landuse') in GREEN else None
    if kind and t.get('type') == 'multipolygon':
        for typ, ref, role in members:
            if typ == 'way' and role == 'outer' and ref in ways and ways[ref][0][0] == ways[ref][0][-1]: add_green(ring_of(ways[ref][0]), kind)
for nid, (lo, la, t) in nodes.items():
    if t and t.get('natural') == 'tree':
        p = xy(nid)
        if inside(p): trees.append([dm(p[0]), dm(p[1]), 0])
for wid, (nds, t) in ways.items():
    if t.get('natural') == 'tree_row':
        pts = ring_of(nds)
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]; L = math.hypot(bx - ax, by - ay)
            for s in range(int(L // 7) + 1):
                f = s * 7 / max(L, 1e-6); p = (ax + (bx - ax) * f, ay + (by - ay) * f)
                if inside(p): trees.append([dm(p[0]), dm(p[1]), 0])
print('green', len(green), 'trees', len(trees))

# --- landmarks: OSM 3D building parts inside historic / heritage / museum buildings, and city gates
# roofs OSM leaves untagged on the Liberty Square buildings: (shape, colour, roof height m) for the top parts
STYLE = {'國家戲劇院': ('hipped', '#d6a237', 11), '國家音樂廳': ('hipped', '#d6a237', 11), '自由廣場門': ('hipped', 'blue', 4),
         '大忠門': ('hipped', 'blue', 3.5), '大孝門': ('hipped', 'blue', 3.5)}
outlines = []
for wid, (nds, t) in ways.items():
    if 'building' in t and (t.get('historic') or t.get('heritage') or t.get('tourism') in ('museum', 'attraction') or t.get('name') in STYLE) and nds and nds[0] == nds[-1]:
        r = ring_of(nds)
        if len(r) >= 4 and any(inside(p) for p in r) and area(r) > 60: outlines.append((wid, r, t))
parts = []
def h_of(t, lv=3.4):
    return num(t.get('height')) or (num(t.get('building:levels'), 0) or 0) * lv or None
for wid, r, t in outlines:
    x0, x1 = min(p[0] for p in r) - 1, max(p[0] for p in r) + 1; y0, y1 = min(p[1] for p in r) - 1, max(p[1] for p in r) + 1
    mine = []
    for pid, (pn, pt) in ways.items():
        if 'building:part' not in pt or not pn or pn[0] != pn[-1]: continue
        pr = ring_of(pn)
        if len(pr) < 4: continue
        cx, cy = sum(p[0] for p in pr) / len(pr), sum(p[1] for p in pr) / len(pr)
        if x0 <= cx <= x1 and y0 <= cy <= y1 and pip(cx, cy, r): mine.append((pr, pt))
    kind = 'gate' if t.get('historic') == 'city_gate' else 'part'
    if not mine: mine = [(r, t)]
    st = STYLE.get(t.get('name')); hmax = max((h_of(pt) or h_of(t) or 9) for pr, pt in mine)
    for pr, pt in mine:
        top = h_of(pt) or h_of(t) or 9
        roof = pt.get('roof:shape', 'flat'); rh = num(pt.get('roof:height'), 0) or (top * 0.3 if roof != 'flat' else 0)
        if st and roof == 'flat' and top >= 0.75 * hmax: roof, rh = st[0], st[2]; pt = {**pt, 'roof:colour': pt.get('roof:colour') or st[1]}
        parts.append({'k': kind, 'n': t.get('name', ''), 'h': round(top, 1), 'mh': round(num(pt.get('min_height'), 0) or 0, 1), 'rs': roof, 'rh': round(rh, 1),
                      'rc': pt.get('roof:colour') or t.get('roof:colour') or '', 'bc': pt.get('building:colour') or t.get('building:colour') or '', 'p': flat(pr[:-1])})
print('landmark outlines', len(outlines), 'parts', len(parts), 'styled', sum(1 for p in parts if p['n'] in STYLE and p['rs'] != 'flat'))

out = {'source': 'OpenStreetMap', 'credits': '道路、樹木、號誌、公園與地標：© OpenStreetMap contributors（ODbL）',
       'roads': roads, 'signals': signals, 'crossings': crossings, 'green': green, 'trees': trees, 'landmarks': parts}
json.dump(out, open('data/taipei_osm.json', 'w'), ensure_ascii=False, separators=(',', ':'))
import os; print('wrote data/taipei_osm.json', os.path.getsize('data/taipei_osm.json') // 1024, 'KB')
