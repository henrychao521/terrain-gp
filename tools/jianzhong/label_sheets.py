"""Draw the evaluation sample and make orthophoto crops for checking it by eye.

  python3 tools/jianzhong/label_sheets.py <out dir> [--n 50] [--seed 2026]

Sample: buildings of ref/clip/game_buildings.geojson whose centroid is in the corridor, larger than 25 m², drawn at
random but stratified so that every 1/5 of the loop (by nearest centreline sample) gets its share, and every permit
footprint that overlaps a sampled building is listed with it. Writes <out>/sample.json and contact sheets
<out>/sheet_XX.jpg: each cell is the orthophoto 20 m around the building, tpe3d outline red, permit outline cyan,
zoning name and the official floors in the caption.
"""
import argparse, json, math, os, random, sys
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import shape, Point
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, load_track

ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--n', type=int, default=50); ap.add_argument('--seed', type=int, default=2026); a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
L = lambda n: json.load(open(os.path.join(REF, 'clip', n + '.geojson')))['features']
area = shape(L('corridor')[0]['geometry']); track = load_track(); n = track['n']
blds = [(f['properties']['bid'], shape(f['geometry']), f['properties']['height_m']) for f in L('game_buildings')]
blds = [b for b in blds if area.contains(b[1].centroid) and b[1].area > 25]
permits = [(shape(f['geometry']), f['properties']) for f in L('permit')]
zoning = [(shape(f['geometry']), f['properties']) for f in L('zoning')]
def stratum(g):
    c = g.centroid; k = min(range(0, n, 4), key=lambda k: (track['X'][k] - c.x) ** 2 + (track['Y'][k] - c.y) ** 2); return min(4, k * 5 // n)
R = random.Random(a.seed); by = {}
for b in blds: by.setdefault(stratum(b[1]), []).append(b)
pick = []
for s in sorted(by): R.shuffle(by[s]); pick += by[s][:a.n // 5]
meta = json.load(open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.json'))); img = Image.open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.png')).convert('RGB')
res, ox, oy1 = meta['res'], meta['x0'], meta['y1']
font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 15)
cells, sample = [], []
for bid, g, h in pick:
    x0, y0, x1, y1 = g.bounds; m = 20; X0, Y0, X1, Y1 = x0 - m, y0 - m, x1 + m, y1 + m
    side = max(X1 - X0, Y1 - Y0); cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2; X0, X1, Y0, Y1 = cx - side / 2, cx + side / 2, cy - side / 2, cy + side / 2
    crop = img.crop((int((X0 - ox) / res), int((oy1 - Y1) / res), int((X1 - ox) / res), int((oy1 - Y0) / res))).resize((360, 360), Image.LANCZOS)
    d = ImageDraw.Draw(crop); s = 360 / side; P = lambda x, y: ((x - X0) * s, (Y1 - y) * s)
    pm = [(pg, pp) for pg, pp in permits if pg.intersects(g) and pg.intersection(g).area > 0.1 * min(pg.area, g.area)]
    for pg, _ in pm:
        for poly in getattr(pg, 'geoms', [pg]): d.line([P(*c) for c in poly.exterior.coords], fill=(0, 230, 255), width=2)
    d.line([P(*c) for c in g.exterior.coords], fill=(255, 40, 40), width=2)
    z = min(((zg.area, pr['zone'] or pr['short']) for zg, pr in zoning if zg.contains(g.representative_point())), default=(0, ''))[1]
    fl = ','.join(str(pp['floors']) for _, pp in pm if pp['floors'])
    cap = f"#{len(sample)} b{bid} h{h:.0f}m {z} {('建照' + fl + 'F') if fl else ''}"
    d.rectangle([0, 0, 360, 20], fill=(0, 0, 0)); d.text((3, 2), cap, fill=(255, 255, 0), font=font)
    d.line([(8, 350), (8 + 10 * s, 350)], fill=(255, 255, 255), width=3)  # 10 m
    cells.append(crop)
    sample.append({'row': len(sample), 'bid': bid, 'src_id': f'tpe3d:{bid}', 'permit_ids': [pp['src_id'] for _, pp in pm], 'permit_floors': [pp['floors'] for _, pp in pm],
                   'zone': z, 'h_tpe3d': h, 'centroid': [round(g.centroid.x, 1), round(g.centroid.y, 1)], 'area_m2': round(g.area, 1), 'stratum': stratum(g)})
for i in range(0, len(cells), 12):
    sh = Image.new('RGB', (4 * 360, 3 * 360)); [sh.paste(c, ((j % 4) * 360, (j // 4) * 360)) for j, c in enumerate(cells[i:i + 12])]
    sh.save(os.path.join(a.out, f'sheet_{i // 12:02d}.jpg'), quality=88)
json.dump(sample, open(os.path.join(a.out, 'sample.json'), 'w'), ensure_ascii=False, indent=1)
print('sample', len(sample), 'sheets', (len(cells) + 11) // 12)
