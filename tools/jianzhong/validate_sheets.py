"""Random sample of the derived parameters, drawn over the orthophoto for checking by eye (phase 3 validation).

  python3 tools/jianzhong/validate_sheets.py <out dir> [--n 24] [--seed 7]

Different seed and different buildings from eval/labels.csv. Each cell: the corridor footprint (green), the tpe3d or
permit source footprint (red, thin), and the derived roof / use / arcade / height in the caption.
"""
import argparse, json, os, random, sys
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon, shape
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, REPO

ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--n', type=int, default=24); ap.add_argument('--seed', type=int, default=7); a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
C = json.load(open(os.path.join(REPO, 'data', 'corridors', 'jianzhong.json')))['buildings']
labelled = set()
import csv
for r in csv.DictReader(open(os.path.join(REPO, 'eval', 'labels.csv'), encoding='utf-8')): labelled.add(r['footprint_source_id'])
pool = [b for b in C if b['src'] not in labelled]
random.Random(a.seed).shuffle(pool); pick = pool[:a.n]
src = {f['id']: shape(f['geometry']) for f in json.load(open(os.path.join(REF, 'clip', 'game_buildings.geojson')))['features']}
src.update({f['properties']['src_id']: shape(f['geometry']) for f in json.load(open(os.path.join(REF, 'clip', 'permit.geojson')))['features']})
meta = json.load(open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.json'))); img = Image.open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.png')).convert('RGB')
res, ox, oy1 = meta['res'], meta['x0'], meta['y1']; font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 14)
cells, rows = [], []
for i, b in enumerate(pick):
    g = Polygon(b['ring']); x0, y0, x1, y1 = g.bounds; side = max(x1 - x0, y1 - y0) + 30; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; X0, Y1 = cx - side / 2, cy + side / 2
    crop = img.crop((int((X0 - ox) / res), int((oy1 - Y1) / res), int((X0 + side - ox) / res), int((oy1 - Y1 + side) / res))).resize((360, 360), Image.LANCZOS)
    d = ImageDraw.Draw(crop); s = 360 / side; P = lambda x, y: ((x - X0) * s, (Y1 - y) * s)
    sg = src.get(b['src'])
    if sg is not None:
        for poly in getattr(sg, 'geoms', [sg]): d.line([P(*c) for c in poly.exterior.coords], fill=(255, 60, 60), width=1)
    d.line([P(*c) for c in g.exterior.coords], fill=(60, 255, 60), width=3)
    cap = f"V{i} {b['roof']} {b['use']} 騎樓{'是' if b['arcade'] else '否'} {b['h']:.0f}m" + (f" {b['landmark']}" if b['landmark'] else '')
    d.rectangle([0, 0, 360, 19], fill=(0, 0, 0)); d.text((3, 2), cap, fill=(255, 255, 0), font=font)
    cells.append(crop); rows.append({'v': i, 'id': b['id'], 'src': b['src'], 'roof': b['roof'], 'use': b['use'], 'arcade': b['arcade'], 'h': b['h'], 'landmark': b['landmark']})
for k in range(0, len(cells), 12):
    sh = Image.new('RGB', (4 * 360, 3 * 360)); [sh.paste(c, ((j % 4) * 360, (j // 4) * 360)) for j, c in enumerate(cells[k:k + 12])]; sh.save(os.path.join(a.out, f'val_{k // 12:02d}.jpg'), quality=88)
json.dump(rows, open(os.path.join(a.out, 'validation_sample.json'), 'w'), ensure_ascii=False, indent=1)
print('validation sample', len(rows))
