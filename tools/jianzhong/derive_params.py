"""Derive per-building modelling parameters for the 建中 corridor (training (a): model-assisted analysis).

  python3 tools/jianzhong/derive_params.py [--vlm work/vlm/vlm_8b.json] [--track eval/track_loop.json]
      -> data/corridors/jianzhong.json (read by tools/blender/build_tile.py), eval/A_params.csv, <work>/derive_log.json

Inputs: ref/clip/*.geojson (official OGDL layers + the game's tpe3d buildings and OSM roads), the VLM answers for
each footprint crop (tools/colab/roof_vlm_job.py), the game's centreline of the loop.

Rules (fixed before looking at the scores; documented in docs/jianzhong/進度報告.md):
 1. Presence: a tpe3d footprint is dropped when the VLM says "none" or "construction" with confidence >= 0.7.
 2. Newer buildings: a permit footprint (臺北市建照套繪, 2001+) the VLM sees as a building replaces every tpe3d
    footprint lying >= 50 % inside it; a permit the VLM sees as construction/none clears them (empty site).
 3. Height: permit floors -> 4.2 + (floors - 1) * 3.2 m; otherwise tpe3d height.
 4. Clean-up: make valid, remove spikes (0.4 m opening), simplify 0.3 m.
 5. Road clearance: footprint minus (official road reserve (8m 道路圖資) ∪ the game's carriageway of the loop + 1.5 m
    ∪ every other OSM street at max(w/2, 3.6) + 0.6 m, as build_tile.py's clear_roads). Largest piece kept,
    holes dropped, < 15 m² dropped.
 6. Overlaps: footprints are accepted taller-first; each later one loses what earlier ones cover (holes dropped, so
    a lower building around a taller part keeps its outline); a nested part within 1 m of the same height is merged away.
 7. Roof: VLM class when confidence >= 0.5, else a colour rule on the orthophoto pixels inside the footprint.
 8. Use: institutional by zoning (學校、機關、郵政、公園、保存區…), religious when the VLM sees a temple;
    else storefront when the arcade rule fires or the building fronts a road >= 12 m wide, else residential.
 9. Arcade probability (騎樓): 0.10 + 0.45 (fronts a road reserve >= 15 m wide, edge within 2 m of it) or + 0.25 (12–15 m)
    + 0.20 (h >= 10 m) + 0.10 (no sidewalk polygon wider than 2 m in front) − 0.70 (institutional); arcade when >= 0.5.
10. Landmarks: VLM "palace" / "dome" / "temple" in institutional or religious use; 建中紅樓 = tpe3d:5801 (assigned
    by hand: the only pitched historic roof by the 南海路 gate of the 高中用地 block; see the report).
"""
import argparse, colorsys, csv, json, math, os, sys
import numpy as np
from PIL import Image
from shapely.geometry import shape, Polygon, LineString, Point, mapping
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import make_valid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, REPO, WORK

ap = argparse.ArgumentParser(); ap.add_argument('--vlm', nargs='*', default=[os.path.join(WORK, 'vlm', 'vlm_32b.json'), os.path.join(WORK, 'vlm', 'vlm_8b.json')]); ap.add_argument('--track', default=os.path.join(REPO, 'eval', 'track_loop.json'))
ap.add_argument('--out', default=os.path.join(REPO, 'data', 'corridors', 'jianzhong.json')); ap.add_argument('--csv', default=os.path.join(REPO, 'eval', 'A_params.csv'))
a = ap.parse_args()
L = lambda n: json.load(open(os.path.join(REF, 'clip', n + '.geojson')))['features']
area = shape(L('corridor')[0]['geometry'])
# one or more VLM runs, most trusted first (Qwen3-VL-32B, then 8B). Combined per field: the answers that agree win;
# when they disagree the first model's answer is used, with its confidence halved.
RUNS = [json.load(open(f)) for f in a.vlm if os.path.exists(f)]
MODELS = [r['model'] for r in RUNS]
INST = {'高中用地', '國小用地', '機關用地', '郵政用地', '保存區', '社福及機關用地', '變電所用地', '公園用地', '交通用地'}
FLOOR_H = lambda f: 4.2 + (f - 1) * 3.2
log = {'dropped_vlm': [], 'replaced_by_permit': [], 'site_cleared': [], 'merged_nested': [], 'too_small_after_clearance': [], 'manual': []}


def valid(g):
    g = make_valid(g) if not g.is_valid else g
    if g.geom_type != 'Polygon':
        ps = [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
        g = max(ps, key=lambda p: p.area) if ps else Polygon()
    return Polygon(g.exterior) if not g.is_empty else g


def vlm(fid):
    answers = []
    for run in RUNS:
        ans = ((run['results'].get(fid) or {}).get('ans')) or {}
        if not isinstance(ans, dict) or not ans: continue
        try: conf = float(ans.get('confidence', 0) or 0)
        except (TypeError, ValueError): conf = 0.0
        answers.append((ans, conf))
    if not answers: return {}, 0.0
    ans, conf = dict(answers[0][0]), answers[0][1]
    for other, oc in answers[1:]:
        for k in ('present', 'roof', 'special'):
            if other.get(k) != ans.get(k): ans['disagree_' + k] = other.get(k)
        conf = conf * 0.5 if (ans.get('disagree_present') or ans.get('disagree_roof')) else max(conf, oc)
    return ans, conf


# ---------- official layers
reserve = unary_union([shape(f['geometry']).buffer(0) for f in L('road8m')])
road8 = [(shape(f['geometry']).buffer(0), f['properties']) for f in L('road8m')]
sidewalks = [(shape(f['geometry']).buffer(0), f['properties']) for f in L('sidewalk')]
zoning = [(shape(f['geometry']).buffer(0), f['properties']) for f in L('zoning')]
def zone_at(p): return min(((g.area, pr['zone'] or pr['short']) for g, pr in zoning if g.contains(p)), default=(0, None))[1]

# the game's carriageway of the loop (+1.5 m) and every OSM street like clear_roads (+0.6 m)
t = json.load(open(a.track)); n = t['n']; X = [x + 2800 for x in t['x']]; Y = [2100 - z for z in t['z']]
quads = []
for k in range(n):
    j = (k + 1) % n; lx, ly = t['lx'][k], -t['lz'][k]; lx2, ly2 = t['lx'][j], -t['lz'][j]
    hl, hr, hl2, hr2 = t['hwL'][k] + 1.5, t['hwR'][k] + 1.5, t['hwL'][j] + 1.5, t['hwR'][j] + 1.5
    quads.append(Polygon([(X[k] + lx * hl, Y[k] + ly * hl), (X[j] + lx2 * hl2, Y[j] + ly2 * hl2), (X[j] - lx2 * hr2, Y[j] - ly2 * hr2), (X[k] - lx * hr, Y[k] - ly * hr)]).buffer(0.01))
carriage = unary_union(quads)
osm = []
for f in L('osm_roads'):
    p = f['properties']
    if p['layer'] > 0 or p['cls'] > 5: continue
    osm.append(LineString(f['geometry']['coordinates']).buffer(max(p['width_m'] / 2, 3.6) + 0.6, cap_style=2))
forbid = unary_union([reserve, carriage] + osm)

# ---------- orthophoto colour fallback for the roof
meta = json.load(open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.json'))); ortho = np.asarray(Image.open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.png')).convert('RGB'))
def roof_colour(g):
    x0, y0, x1, y1 = g.bounds; res = meta['res']
    i0, i1 = int((x0 - meta['x0']) / res), int((x1 - meta['x0']) / res); j0, j1 = int((meta['y1'] - y1) / res), int((meta['y1'] - y0) / res)
    if i0 < 0 or j0 < 0 or i1 >= ortho.shape[1] or j1 >= ortho.shape[0]: return None
    px = []
    for j in range(j0, j1, 2):
        for i in range(i0, i1, 2):
            if g.contains(Point(meta['x0'] + (i + 0.5) * res, meta['y1'] - (j + 0.5) * res)): px.append(ortho[j, i])
    if len(px) < 10: return None
    r, gg, b = (np.median(np.array(px), axis=0) / 255).tolist(); h, l, s = colorsys.rgb_to_hls(r, gg, b)
    if s < 0.18 or l > 0.7: return 'flat_concrete'
    if 0.25 < h < 0.5 and s > 0.2: return 'flat_green'
    return 'metal_sheet'

# ---------- candidates
cands = []
for f in L('game_buildings'):
    g = valid(shape(f['geometry']))
    if g.is_empty or not area.contains(g.centroid): continue
    ans, conf = vlm(f['id'])
    if ans.get('present') in ('none', 'construction') and conf >= 0.7: log['dropped_vlm'].append({'id': f['id'], 'present': ans['present'], 'conf': conf}); continue
    cands.append({'src': f['id'], 'g': g, 'h': f['properties']['height_m'], 'floors': None, 'permit': None})
for f in L('permit'):
    g = valid(shape(f['geometry'])); p = f['properties']
    if g.is_empty or not area.contains(g.centroid) or g.area < 30: continue
    ans, conf = vlm(p['src_id']); built = ans.get('present') in ('building', 'partial') or (not ans and p['floors'])
    inside = [c for c in cands if c['permit'] is None and c['g'].intersection(g).area >= 0.5 * c['g'].area]
    for c in inside: cands.remove(c)
    if built:
        h = FLOOR_H(p['floors']) if p['floors'] else max([c['h'] for c in inside] or [10.0])
        cands.append({'src': p['src_id'], 'g': g, 'h': h, 'floors': p['floors'], 'permit': p['permit']}); log['replaced_by_permit'].append({'permit': p['src_id'], 'floors': p['floors'], 'replaced': [c['src'] for c in inside]})
    else: log['site_cleared'].append({'permit': p['src_id'], 'vlm': ans.get('present'), 'removed': [c['src'] for c in inside]})

# ---------- clean, clear the roads, resolve overlaps (taller first)
for c in cands:
    g = c['g'].buffer(-0.4, join_style=2).buffer(0.4, join_style=2).simplify(0.3)
    c['g'] = valid(g) if not g.is_empty else c['g']
cands.sort(key=lambda c: (c['permit'] is None, -c['h']))
acc = []
for c in cands:
    g = valid(c['g'].difference(forbid))
    if g.is_empty or g.area < 15: log['too_small_after_clearance'].append(c['src']); continue
    for b in acc:
        if not g.intersects(b['g']): continue
        d = valid(g.difference(b['g'].buffer(0.05, join_style=2)))
        if d.is_empty or d.area < 15:
            if abs(b['h'] - c['h']) < 1.0 or d.is_empty: g = None; break
            continue  # nested lower building around a taller part: keep the outline
        g = d
    if g is None or g.area < 15: log['merged_nested'].append(c['src']); continue
    c['g'] = orient(g); acc.append(c)

# ---------- parameters
rows, out = [], []
for i, c in enumerate(acc):
    g = c['g']; rp = g.representative_point(); zone = zone_at(rp); ans, conf = vlm(c['src'])
    inst = zone in INST
    # frontage: footprint edges within 2 m of the official road reserve, and the widest such road
    best_w, front_sw = 0.0, None
    for rg, rpz in road8:
        if g.distance(rg) < 2.0 and rg.length > 0:
            w = float(rpz.get('ROADWIDTH') or 0); best_w = max(best_w, w)
    near_sw = [sp for sg, sp in sidewalks if g.distance(sg) < 3.0]
    wide_sw = any(float(sp.get('SW_WTH') or 0) > 2.0 for sp in near_sw)
    p = 0.10 + (0.45 if best_w >= 15 else 0.25 if best_w >= 12 else 0) + (0.20 if c['h'] >= 10 else 0) + (0.0 if wide_sw else 0.10) - (0.70 if inst else 0)
    p = max(0.0, min(1.0, p)); arcade = p >= 0.5
    roof = ans.get('roof') if conf >= 0.5 and ans.get('roof') not in (None, 'none') else (roof_colour(g) or 'flat_concrete')
    special = ans.get('special') if conf >= 0.5 else None
    use = 'institutional' if inst else 'religious' if special == 'temple' else 'storefront' if (arcade or best_w >= 12) else 'residential'
    landmark = None
    if special in ('palace', 'dome', 'temple') and use in ('institutional', 'religious'): landmark = special
    if c['src'] == 'tpe3d:5801': landmark = 'redhouse'; roof = 'pitched_tile'; log['manual'].append({'src': c['src'], 'landmark': 'redhouse'})
    if landmark in ('palace', 'temple', 'redhouse'): roof = 'pitched_tile'
    if landmark == 'dome': roof = 'dome'
    bid = f'jz:{i:04d}'
    out.append({'id': bid, 'src': c['src'], 'ring': [[round(x, 2), round(y, 2)] for x, y in list(g.exterior.coords)[:-1]], 'h': round(c['h'], 2), 'floors': c['floors'],
                'roof': roof, 'arcade': int(arcade), 'arcade_p': round(p, 2), 'use': use, 'landmark': landmark, 'zone': zone, 'road_w': best_w,
                'vlm': {k: ans.get(k) for k in ('present', 'roof', 'special', 'confidence')} if ans else None})
    rows.append({'building_id': bid, 'source_id': c['src'], 'footprint_wkt': g.wkt, 'height_m': round(c['h'], 2), 'floors': c['floors'] or '', 'roof_type': roof,
                 'arcade': 'yes' if arcade else 'no', 'use_class': use, 'landmark': 'yes' if landmark else 'no'})
os.makedirs(os.path.dirname(a.out), exist_ok=True)
json.dump({'note': '建中周邊走廊的建物參數（tools/jianzhong/derive_params.py）。tools/blender/build_tile.py 對重心落在 area 裡的 data/taipei.json 建物改用這裡的建物。座標：資料座標（TWD97 TM2 減 E 299000、N 2766400）。',
           'sources': '臺北市建築執照套繪圖、臺北市寬度超過8公尺道路GIS圖資、臺北市人行道範圍圖、臺北市都市計畫使用分區圖（皆為政府資料開放授權條款第1版）；臺北市自動化3D近似建物模型（tpe3d）；© OpenStreetMap contributors；屋頂類型與有無建物由視覺語言模型（' + '、'.join(MODELS or ['未使用']) + '）判讀國土測繪中心正射影像',
           'area': [[round(x, 1), round(y, 1)] for x, y in area.exterior.coords], 'buildings': out}, open(a.out, 'w'), ensure_ascii=False, separators=(',', ':'))
w = csv.DictWriter(open(a.csv, 'w', newline='', encoding='utf-8'), fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
json.dump(log, open(os.path.join(WORK, 'derive_log.json'), 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print('buildings', len(out), 'roof', Counter(b['roof'] for b in out), 'use', Counter(b['use'] for b in out), 'arcade', sum(b['arcade'] for b in out),
      'landmark', Counter(b['landmark'] for b in out if b['landmark']), {k: len(v) for k, v in log.items()})
