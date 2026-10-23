"""Catalogue the corridor's scenery problems against the official layers.

  python3 tools/jianzhong/audit.py <dump dir> <walls.json> <track.json> <out.json> [--prefix before]

<dump dir>/<prefix>_t_<i>_<j>.json: final footprints written by tools/blender/build_tile.py with TGP_DUMP.
Writes one JSON with every issue (type, location in data metres, building id, measure) and a summary by type.
Only issues inside the corridor (ref/clip/corridor.geojson) are listed.
"""
import argparse, glob, json, math, os, sys
from collections import Counter, defaultdict
from shapely.geometry import shape, Polygon, LineString, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import explain_validity
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, load_track

ap = argparse.ArgumentParser(); ap.add_argument('dump'); ap.add_argument('walls'); ap.add_argument('track'); ap.add_argument('out'); ap.add_argument('--prefix', default='before')
a = ap.parse_args()
L = lambda n: json.load(open(os.path.join(REF, 'clip', n + '.geojson')))['features']
area = shape(L('corridor')[0]['geometry'])
road8 = [shape(f['geometry']) for f in L('road8m')]; reserve = unary_union(road8)
side = [(shape(f['geometry']), f['properties']) for f in L('sidewalk')]; sidewalks = unary_union([g for g, _ in side])
permits = [(shape(f['geometry']), f['properties']) for f in L('permit')]
zoning = [(shape(f['geometry']), f['properties']) for f in L('zoning')]
track = load_track(a.track); n = track['n']
INSTITUTIONAL = ('高中用地', '國小用地', '機關用地', '郵政用地', '保存區', '社福及機關用地', '變電所用地', '公園用地', '交通用地')

blds = []
for f in sorted(glob.glob(os.path.join(a.dump, f'{a.prefix}_t_*.json'))):
    d = json.load(open(f))
    for b in d['buildings']:
        b['tile'] = os.path.basename(f)[len(a.prefix) + 1:-5]; blds.append(b)
issues = []
def add(kind, at, **kw): issues.append({'type': kind, 'at': [round(at[0], 1), round(at[1], 1)], **kw})

def zone_at(p):
    return min(((g.area, pr['zone'] or pr['short']) for g, pr in zoning if g.contains(p)), default=(0, None))[1]

polys = {}
for b in blds:
    if b.get('dropped'):
        g = Polygon(b['ring0'])
        if g.is_valid and g.intersects(area): add('dropped_building', g.centroid.coords[0], bid=b['bid'], h=b['h'], note='build_tile.py 判定建物重心在道路上而整棟刪除')
        continue
    g0, g = Polygon(b['ring0']), Polygon(b['ring'])
    if not g.intersects(area): continue
    c = g.centroid.coords[0]
    # footprint stretched by clear_roads (vertices pushed across the road)
    mv = max(math.dist(p, q) for p, q in zip(b['ring0'], b['ring'])) if len(b['ring0']) == len(b['ring']) else 0
    if g0.area > 0 and (g.area / max(g0.area, 1) > 1.25 or mv > 4):
        add('stretched_footprint', c, bid=b['bid'], tile=b['tile'], moved_m=round(mv, 1), area_ratio=round(g.area / max(g0.area, 1), 2), note='clear_roads 把頂點推過道路中線，建物被拉長')
    if not g.is_valid:
        add('invalid_footprint', c, bid=b['bid'], tile=b['tile'], note=explain_validity(g))
        g = g.buffer(0)
    if b.get('inner'):
        gi = Polygon(b['inner'])
        bad = (not gi.is_valid) or gi.area > g.area * 1.02 or not g.buffer(0.5).contains(gi.buffer(0) if not gi.is_valid else gi)
        if bad: add('arcade_ring_broken', c, bid=b['bid'], tile=b['tile'], note='騎樓內縮輪廓自我交叉或跑出建物外（offset_ring），一樓店面牆穿出建物')
    polys[b['bid']] = (g, b)
    # footprint inside the official road reserve
    if g.intersects(reserve):
        ov = g.intersection(reserve)
        if ov.area > 3:
            depth = max((Point(p).distance(reserve.boundary) for pg in getattr(g, 'geoms', [g]) for p in pg.exterior.coords if reserve.contains(Point(p))), default=0)
            if depth > 1.0: add('footprint_in_road_reserve', ov.centroid.coords[0], bid=b['bid'], tile=b['tile'], area_m2=round(ov.area, 1), depth_m=round(depth, 1), note='建物輪廓伸進官方道路用地（8m 道路圖資）')
    z = zone_at(g.representative_point())
    b['zone'] = z
    if z in INSTITUTIONAL and (b.get('shops') or b.get('arcade')):
        add('wrong_use_storefront', c, bid=b['bid'], tile=b['tile'], zone=z, note='機關／學校／公園用地上的建物被做成騎樓店面（招牌、機車）')
# overlaps between footprints: interpenetrating walls and coplanar roofs (z-fighting)
ids = list(polys); tree = STRtree([polys[i][0] for i in ids])
seen = set()
for i in ids:
    gi, bi = polys[i]
    for j in tree.query(gi):
        j = ids[j]
        if j <= i or (i, j) in seen: continue
        gj, bj = polys[j]; ov = gi.intersection(gj)
        if ov.area < 1.0: continue
        seen.add((i, j)); small = min(gi.area, gj.area)
        kind = 'coplanar_roof' if abs(bi['top'] - bj['top']) < 0.05 else ('nested_building' if ov.area > 0.9 * small else 'overlapping_buildings')
        add(kind, ov.centroid.coords[0], bid=i, bid2=j, area_m2=round(ov.area, 1), dz=round(abs(bi['top'] - bj['top']), 2),
            note={'coplanar_roof': '兩棟重疊且屋頂同高：屋頂閃爍（z-fighting）', 'nested_building': '一棟建物整個包在另一棟裡（零件重複）', 'overlapping_buildings': '兩棟建物輪廓重疊，牆面互相穿插'}[kind])
# official permits (2001+) against the scenery: missing buildings and height errors
allg = unary_union([g for g, _ in polys.values()])
for g, p in permits:
    if not g.intersects(area) or g.area < 30: continue
    cov = g.intersection(allg).area / g.area
    if cov < 0.3: add('missing_building', g.centroid.coords[0], permit=p['permit'], src_id=p['src_id'], floors=p['floors'], covered=round(cov, 2), note='官方建照套繪有建物，場景沒有（或位置差很多）')
    if p['floors']:
        est = 4.2 + (p['floors'] - 1) * 3.2
        best = max(polys.values(), key=lambda gb: gb[0].intersection(g).area)
        if best[0].intersection(g).area > 0.3 * g.area:
            err = best[1]['h'] - est
            if abs(err) > max(4.0, 0.25 * est): add('wrong_height', g.centroid.coords[0], bid=best[1]['bid'], permit=p['permit'], floors=p['floors'], h_scene=round(best[1]['h'], 1), h_est=round(est, 1), err_m=round(err, 1), note='場景高度和建照樓層推估差很多')
# intrusions from the ray check, merged into runs along the centreline
W = json.load(open(a.walls))['results'][0]
for key, kind, note in (('wallsAt', 'intrusion_wall', '建物在車道裡（離地 1 m 射線）'), ('overhangAt', 'intrusion_overhang', '樓上外牆懸在車道上（4／8 m 射線）'), ('columnsAt', 'intrusion_column', '騎樓柱站在車道裡')):
    runs = []
    for h in sorted(W.get(key, []), key=lambda h: h['k']):
        if runs and h['k'] - runs[-1][-1]['k'] <= 4 and h['side'] == runs[-1][-1]['side']: runs[-1].append(h)
        else: runs.append([h])
    for r in runs:
        k0, k1 = r[0]['k'], r[-1]['k']; km = r[len(r) // 2]['k']
        add(kind, (track['X'][km], track['Y'][km]), k=[k0, k1], s_m=[round(k0 * track['ds']), round(k1 * track['ds'])], rays=len(r), side=r[0]['side'], road=r[0]['road'],
            min_m=min(h['m'] for h in r), halfWidth=r[0]['halfWidth'], mesh=sorted({h.get('mesh', 'column') for h in r}), note=note)
# carriageway width and edge offset against the official layers, every ~25 m
step = max(1, round(25 / track['ds'])); widths = []
for k in range(0, n, step):
    X, Y = track['X'][k], track['Y'][k]; lx, ly = track['lx'][k], -track['lz'][k]
    res = {}
    for sd, hw in ((1, track['hwL'][k]), (-1, track['hwR'][k])):
        ray = LineString([(X, Y), (X + lx * sd * 40, Y + ly * sd * 40)])
        # kerb: first sidewalk polygon crossed; road reserve edge: where the ray leaves the reserve
        hit = ray.intersection(sidewalks)
        kerb = min((Point(X, Y).distance(Point(c)) for g in getattr(hit, 'geoms', [hit]) if not g.is_empty for c in g.coords), default=None)
        inside = ray.intersection(reserve)
        edge = None
        for g in getattr(inside, 'geoms', [inside]):
            if g.is_empty: continue
            cs = list(g.coords)
            if Point(cs[0]).distance(Point(X, Y)) < 0.5: edge = Point(cs[-1]).distance(Point(X, Y))
        res[sd] = (hw, kerb, edge)
    rec = {'k': k, 's_m': round(k * track['ds']), 'road': track['rname'][k], 'at': [round(X, 1), round(Y, 1)],
           'game_hwL': res[1][0], 'game_hwR': res[-1][0], 'kerbL': res[1][1] and round(res[1][1], 1), 'kerbR': res[-1][1] and round(res[-1][1], 1),
           'reserveL': res[1][2] and round(res[1][2], 1), 'reserveR': res[-1][2] and round(res[-1][2], 1)}
    widths.append(rec)
    for sdn, sd in (('L', 1), ('R', -1)):
        hw, kerb, edge = res[sd]
        # on a divided road the game drives one carriageway: the far kerb on the median side belongs to the other one
        if kerb is not None and kerb < hw + 6 and abs(hw - kerb) > 2.0:
            add('road_edge_offset', (X + lx * sd * kerb, Y + ly * sd * kerb), k=k, s_m=rec['s_m'], road=rec['road'], side=sdn, game_m=round(hw, 1), official_kerb_m=round(kerb, 1), err_m=round(hw - kerb, 1),
                note='遊戲路緣和官方人行道邊線差超過 2 m')
summary = Counter(i['type'] for i in issues)
json.dump({'summary': dict(summary), 'issues': issues, 'widths': widths, 'buildings_checked': len(polys)}, open(a.out, 'w'), ensure_ascii=False, indent=1)
print(dict(summary), 'buildings', len(polys))
