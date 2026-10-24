#!/usr/bin/env python3
"""Score one modelling arm of the 建中 corridor against the official layers and the labelled sample.

  python3 eval/score.py <candidate_params.csv> [--tiles <dir with t_*.gltf>] [--name A] [--out result.json] [--md result.md]
  python3 eval/score.py --tiles <dir> [--name B]          (tiles only: the walls check)

Schema of candidate_params.csv: see eval/README.md. Needs shapely; --tiles also needs Blender
(BLENDER env, default /Applications/Blender.app/Contents/MacOS/Blender) and runs tools/test/blender_walls.py on
eval/track_loop.json. Reference layers come from ref/clip/ (tools/jianzhong/prep_ref.py; override with --ref).
Prints the JSON; --md writes a markdown table.
"""
import argparse, csv, json, math, os, statistics, subprocess, sys, tempfile
from shapely import wkt
from shapely.geometry import shape, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE)
ap = argparse.ArgumentParser(); ap.add_argument('params', nargs='?'); ap.add_argument('--tiles'); ap.add_argument('--name', default='candidate')
ap.add_argument('--ref', default=os.path.join(REPO, 'ref')); ap.add_argument('--labels', default=os.path.join(HERE, 'labels.csv'))
ap.add_argument('--track', default=os.path.join(HERE, 'track_loop.json')); ap.add_argument('--out'); ap.add_argument('--md')
a = ap.parse_args()
if not a.params and not a.tiles: ap.error('give candidate_params.csv and/or --tiles')
L = lambda n: json.load(open(os.path.join(a.ref, 'clip', n + '.geojson')))['features']
area = shape(L('corridor')[0]['geometry'])
FLOOR_H = lambda f: 4.2 + (f - 1) * 3.2  # ground floor 4.2 m, upper floors 3.2 m (Taipei walk-ups and mid-rises)
R = {'arm': a.name, 'params': a.params, 'tiles': a.tiles}


def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None


def yn(v):
    v = (v or '').strip().lower()
    return {'yes': 'yes', 'y': 'yes', '1': 'yes', 'true': 'yes', 'no': 'no', 'n': 'no', '0': 'no', 'false': 'no'}.get(v, v or None)


if a.params:
    rows = list(csv.DictReader(open(a.params, encoding='utf-8')))
    C = []
    for r in rows:
        try: g = wkt.loads(r['footprint_wkt'])
        except Exception: continue
        if not g.is_valid: g = g.buffer(0)
        if g.is_empty: continue
        h = num(r.get('height_m')); fl = num(r.get('floors'))
        if h is None and fl: h = FLOOR_H(fl)
        C.append({'id': r.get('building_id'), 'src': r.get('source_id') or '', 'g': g, 'h': h, 'floors': fl, 'roof': (r.get('roof_type') or '').strip() or None,
                  'arcade': yn(r.get('arcade')), 'use': (r.get('use_class') or '').strip() or None, 'landmark': yn(r.get('landmark'))})
    C = [c for c in C if c['g'].intersects(area)]
    R['buildings'] = len(C)
    tree = STRtree([c['g'] for c in C])
    near = lambda g: [C[i] for i in tree.query(g)]
    # 1. footprints against the official permit outlines (buildings permitted 2001+)
    ious, offs, herr, hrel, matched = [], [], [], [], 0
    permits = [(shape(f['geometry']), f['properties']) for f in L('permit')]
    permits = [(g if g.is_valid else g.buffer(0), p) for g, p in permits]
    for g, p in permits:
        if not area.contains(g.centroid) or g.area < 30: continue
        cand = [c for c in near(g) if c['g'].intersection(g).area > 0.1 * min(c['g'].area, g.area)]
        if not cand: ious.append(0.0); continue
        u = unary_union([c['g'] for c in cand]); iou = g.intersection(u).area / g.union(u).area
        ious.append(iou); offs.append(g.centroid.distance(u.centroid)); matched += 1
        if p.get('floors'):
            best = max(cand, key=lambda c: c['g'].intersection(g).area)
            if best['h'] is not None:
                est = FLOOR_H(p['floors']); herr.append(best['h'] - est); hrel.append(abs(best['h'] - est) / est)
    R['footprint'] = {'permits': len(ious), 'matched': matched, 'iou_mean': round(statistics.mean(ious), 3) if ious else None, 'iou_median': round(statistics.median(ious), 3) if ious else None,
                      'centroid_offset_m_mean': round(statistics.mean(offs), 2) if offs else None, 'centroid_offset_m_median': round(statistics.median(offs), 2) if offs else None}
    R['height_vs_permit_floors'] = {'n': len(herr), 'mae_m': round(statistics.mean(abs(e) for e in herr), 2) if herr else None, 'bias_m': round(statistics.mean(herr), 2) if herr else None,
                                    'mape': round(statistics.mean(hrel), 3) if hrel else None, 'floor_height_rule': 'h = 4.2 + (floors - 1) * 3.2'}
    # 2. the labelled sample
    lab = list(csv.DictReader(open(a.labels, encoding='utf-8')))
    acc = {k: [0, 0] for k in ('roof_type', 'arcade', 'use_class', 'landmark', 'building_present')}
    per = []
    for l in lab:
        pt = Point(float(l['centroid_x']), float(l['centroid_y']))
        cand = [c for c in C if c['src'] == l['footprint_source_id']] or [c for c in near(pt.buffer(1.0)) if c['g'].buffer(0.5).contains(pt)]
        c = max(cand, key=lambda c: c['g'].intersection(pt.buffer(5)).area) if cand else None
        if l['building_present'] in ('yes', 'no'):
            ok = (c is not None) == (l['building_present'] == 'yes'); acc['building_present'][0] += ok; acc['building_present'][1] += 1
        if c is None or l['building_present'] != 'yes': continue
        for k, ck in (('roof_type', 'roof'), ('arcade', 'arcade'), ('use_class', 'use'), ('landmark', 'landmark')):
            truth = l[k]
            if truth in ('unknown', 'n/a', '') or c[ck] is None: continue
            pred = c[ck]
            if k == 'use_class' and truth == 'residential_mixed': ok = pred in ('residential', 'storefront', 'residential_mixed', 'mixed')
            elif k == 'roof_type' and truth == 'mixed': ok = pred in ('mixed', 'metal_sheet', 'flat_concrete')
            else: ok = pred == truth
            acc[k][0] += ok; acc[k][1] += 1
            per.append({'row': l['row'], 'field': k, 'truth': truth, 'pred': pred, 'ok': bool(ok)})
    R['labels'] = {k: {'correct': v[0], 'n': v[1], 'acc': round(v[0] / v[1], 3) if v[1] else None} for k, v in acc.items()}
    R['label_mismatches'] = [p for p in per if not p['ok']][:80]

if a.tiles:
    blender = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
    out = tempfile.mktemp(suffix='.json')
    env = dict(os.environ, TGP_TILE_DIR=os.path.abspath(a.tiles))
    p = subprocess.run([blender, '-b', '--factory-startup', '--python', os.path.join(REPO, 'tools', 'test', 'blender_walls.py'), '--', REPO, out, a.track], capture_output=True, text=True, env=env)
    if not os.path.exists(out): R['walls'] = {'error': (p.stdout + p.stderr)[-800:]}
    else:
        w = json.load(open(out))['results'][0]
        R['walls'] = {'rays': w['rays'], 'walls_1m': w['walls'], 'overhang_4_8m': w['overhang'], 'columns_in_road': w['columns'], 'tiles': w['tilesTested'], 'building_meshes': w['buildingMeshes'],
                      'first': w['wallsAt'][:5]}
        os.remove(out)

js = json.dumps(R, ensure_ascii=False, indent=1)
print(js)
if a.out: open(a.out, 'w').write(js)
if a.md:
    def g(path, d=R):
        for k in path.split('.'): d = (d or {}).get(k) if isinstance(d, dict) else None
        return '–' if d is None else d
    lines = [f'| 指標 | {a.name} |', '|---|---|',
             f"| 建物數（走廊內） | {g('buildings')} |",
             f"| 建照輪廓 IoU 平均／中位數（{g('footprint.permits')} 筆） | {g('footprint.iou_mean')}／{g('footprint.iou_median')} |",
             f"| 重心偏移 平均／中位數（m） | {g('footprint.centroid_offset_m_mean')}／{g('footprint.centroid_offset_m_median')} |",
             f"| 高度誤差 MAE／偏差（m，{g('height_vs_permit_floors.n')} 筆有樓層） | {g('height_vs_permit_floors.mae_m')}／{g('height_vs_permit_floors.bias_m')} |"]
    for k, zh in (('building_present', '有無建物'), ('roof_type', '屋頂類型'), ('arcade', '騎樓'), ('use_class', '用途'), ('landmark', '地標')):
        lines.append(f"| 標註樣本：{zh} 正確率 | {g('labels.' + k + '.acc')}（{g('labels.' + k + '.correct')}/{g('labels.' + k + '.n')}） |")
    lines += [f"| 環線射線：建物在車道（1 m） | {g('walls.walls_1m')}／{g('walls.rays')} |", f"| 樓上懸在車道（4／8 m） | {g('walls.overhang_4_8m')} |", f"| 騎樓柱在車道 | {g('walls.columns_in_road')} |"]
    open(a.md, 'w').write('\n'.join(lines) + '\n')
