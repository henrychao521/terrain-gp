"""Overture Maps buildings along the Taipei circuits, and a cross-check against the game's buildings.

  venv/bin/python tools/streetview/overture.py --tracks name=track.json ... --out <dir> [--release 2026-10-21.0]

Reads the public GeoParquet release on S3 with DuckDB (bbox filter, no download of the whole theme), keeps buildings
within 150 m of each centreline, converts them to the data frame (TWD97 TM2 minus E 299000 / N 2766400) and writes
<out>/overture_buildings.geojson (not for git: ODbL / CDLA mix, see licences in the summary).
Cross-check per track (±150 m band) against the scenery the game builds (data/taipei.json outside corridors, plus
data/corridors/*.json inside them): Overture buildings >= 40 m² less than 30 % covered by game footprints (missing in
game), game footprints >= 40 m² less than 20 % covered by Overture where Overture has buildings within 30 m (extra /
demolished?), and height differences > 6 m where Overture has a height or floor count from a source other than the game's.
"""
import argparse, json, os
from collections import Counter
import duckdb
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import Polygon, LineString, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

ap = argparse.ArgumentParser(); ap.add_argument('--tracks', nargs='+', required=True); ap.add_argument('--out', required=True); ap.add_argument('--release', default='2026-10-21.0')
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
E0, N0 = 299000.0, 2766400.0
to_wgs = Transformer.from_crs(3826, 4326, always_xy=True); to_tm = Transformer.from_crs(4326, 3826, always_xy=True)
tracks = {}
for s in a.tracks:
    nm, p = s.split('='); t = json.load(open(p)); X = [x + t['sx'] / 2 for x in t['x']]; Y = [t['sz'] / 2 - z for z in t['z']]
    tracks[nm] = LineString(list(zip(X, Y)) + [(X[0], Y[0])]).buffer(150)
allband = unary_union(list(tracks.values())); x0, y0, x1, y1 = allband.bounds
lo0, la0 = to_wgs.transform(x0 + E0, y0 + N0); lo1, la1 = to_wgs.transform(x1 + E0, y1 + N0)
c = duckdb.connect(); c.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
q = f"""SELECT id, ST_AsWKB(geometry) g, height, num_floors, roof_shape, class, subtype, is_underground,
        to_json(sources) src FROM read_parquet('s3://overturemaps-us-west-2/release/{a.release}/theme=buildings/type=building/*', hive_partitioning=1)
        WHERE bbox.xmin < {lo1} AND bbox.xmax > {lo0} AND bbox.ymin < {la1} AND bbox.ymax > {la0}"""
rows = c.sql(q).fetchall()
feats, ov = [], []
for id_, g, h, nf, rs, cl, sub, ug, src in rows:
    geom = transform(lambda lo, la, z=None: tuple(v - o for v, o in zip(to_tm.transform(lo, la), (E0, N0))), wkb.loads(bytes(g)))
    if not geom.intersects(allband) or ug: continue
    srcs = json.loads(src) if src else []
    p = {'id': id_, 'height': h, 'num_floors': nf, 'roof_shape': rs, 'class': cl, 'datasets': sorted({s.get('dataset') for s in srcs if s}), 'licenses': sorted({str(s.get('license')) for s in srcs if s})}
    feats.append({'type': 'Feature', 'properties': p, 'geometry': mapping(geom)}); ov.append((geom.buffer(0), p))
json.dump({'type': 'FeatureCollection', 'note': f'Overture Maps buildings release {a.release}, data frame metres', 'features': feats}, open(os.path.join(a.out, 'overture_buildings.geojson'), 'w'))
summary = {'release': a.release, 'n': len(ov), 'datasets': Counter(d for _, p in ov for d in p['datasets']), 'licenses': Counter(l for _, p in ov for l in p['licenses']),
           'with_height': sum(1 for _, p in ov if p['height']), 'with_floors': sum(1 for _, p in ov if p['num_floors']), 'tracks': {}}
# the game's buildings: data/taipei.json, replaced inside corridor areas by the corridor's own list
T = json.load(open(os.path.join(REPO, 'data', 'taipei.json'))); CORR = []
cd = os.path.join(REPO, 'data', 'corridors')
for f in sorted(os.listdir(cd)) if os.path.isdir(cd) else []:
    if f.endswith('.json'): CORR.append(json.load(open(os.path.join(cd, f))))
areas = [Polygon(c_['area']) for c_ in CORR]; repl = {b for c_ in CORR for b in c_.get('replaces', [])}
game = []
for i, b in enumerate(T['buildings']):
    r = [(b[1 + 2 * k], b[2 + 2 * k]) for k in range((len(b) - 1) // 2)]
    if len(r) < 3 or i in repl: continue
    g = Polygon(r).buffer(0)
    if g.is_empty or any(ar.contains(g.centroid) for ar in areas): continue
    game.append((g, {'src': f'tpe3d:{i}', 'h': b[0] / 10}))
for c_ in CORR:
    for b in c_['buildings']: game.append((Polygon(b['ring']).buffer(0), {'src': b['id'], 'h': b['h']}))
gt = STRtree([g for g, _ in game]); ot = STRtree([g for g, _ in ov])
issues = []
for nm, band in tracks.items():
    gi = [i for i in gt.query(band) if game[i][0].intersects(band)]; oi = [i for i in ot.query(band) if ov[i][0].intersects(band)]
    gu = unary_union([game[i][0] for i in gi]); ou = unary_union([ov[i][0] for i in oi]); cnt = Counter()
    for i in oi:
        g, p = ov[i]
        if g.area < 40: continue
        cov = g.intersection(gu).area / g.area
        if cov < 0.3: issues.append({'track': nm, 'type': 'missing_in_game', 'at': list(g.centroid.coords[0]), 'overture': p['id'], 'datasets': p['datasets'], 'area': round(g.area), 'covered': round(cov, 2)}); cnt['missing_in_game'] += 1
        hh = p['height'] or (p['num_floors'] and 4.2 + (p['num_floors'] - 1) * 3.2)
        if hh and cov >= 0.5 and p['datasets'] != ['tpe3d']:
            best = max((game[j] for j in gt.query(g)), key=lambda gp: gp[0].intersection(g).area, default=None)
            if best and abs(best[1]['h'] - hh) > 6: issues.append({'track': nm, 'type': 'height_diff', 'at': list(g.centroid.coords[0]), 'overture': p['id'], 'src': best[1]['src'], 'h_game': best[1]['h'], 'h_overture': round(hh, 1), 'datasets': p['datasets']}); cnt['height_diff'] += 1
    for i in gi:
        g, p = game[i]
        if g.area < 40: continue
        cov = g.intersection(ou).area / g.area
        if cov < 0.2 and ou.distance(g) < 30: issues.append({'track': nm, 'type': 'extra_in_game', 'at': list(g.centroid.coords[0]), 'src': p['src'], 'area': round(g.area), 'covered': round(cov, 2)}); cnt['extra_in_game'] += 1
    summary['tracks'][nm] = {'overture': len(oi), 'game': len(gi), 'overture_area': round(ou.area), 'game_area': round(gu.area), 'overlap_area': round(ou.intersection(gu).area), **cnt}
json.dump({'summary': summary, 'issues': issues}, open(os.path.join(a.out, 'overture_check.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False, default=str)[:3000])
