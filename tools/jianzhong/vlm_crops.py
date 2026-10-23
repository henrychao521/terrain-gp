"""Orthophoto crops of every corridor footprint (tpe3d and permit) for the VLM roof / presence pass.

  python3 tools/jianzhong/vlm_crops.py <out dir> [all|roofshape]   -> <out>/crops/<id>.jpg, <out>/index.json, <out>/crops.zip

Each crop is north-up, the footprint's bounding box plus 12 m, resized to 448 px, with the footprint outlined in red.
The crops are derived from the NLSC orthophoto (not openly licensed): they are uploaded only to the Colab VM that
classifies them and are never committed or published.
"""
import json, os, sys, zipfile
from PIL import Image, ImageDraw
from shapely.geometry import shape
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF

out = sys.argv[1]; SET = sys.argv[2] if len(sys.argv) > 2 else 'all'; os.makedirs(os.path.join(out, 'crops'), exist_ok=True)
L = lambda n: json.load(open(os.path.join(REF, 'clip', n + '.geojson')))['features']
area = shape(L('corridor')[0]['geometry'])
meta = json.load(open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.json'))); img = Image.open(os.path.join(REF, 'ortho_PHOTO2_z19_twd97.png')).convert('RGB')
res, ox, oy1, W, H = meta['res'], meta['x0'], meta['y1'], meta['width'], meta['height']
if SET == 'roofshape':  # second pass: OSM landmarks and every building on institutional land (data/corridors/jianzhong.json)
    from shapely.geometry import Polygon
    C = json.load(open(os.path.join(os.path.dirname(REF), 'data', 'corridors', 'jianzhong.json')))['buildings']
    items = [('lm:' + f['properties']['n'], shape(f['geometry'])) for f in L('osm_landmarks') if f['properties'].get('n')] + [(b['src'], Polygon(b['ring'])) for b in C if b['use'] in ('institutional', 'religious')]
else:
    items = [(f['id'], shape(f['geometry'])) for f in L('game_buildings')] + [(f['properties']['src_id'], shape(f['geometry'])) for f in L('permit')]
index = []
for fid, g in items:
    if not g.is_valid: g = g.buffer(0)
    if g.is_empty or not area.intersects(g): continue
    x0, y0, x1, y1 = g.bounds; m = 12; side = max(x1 - x0, y1 - y0) + 2 * m; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    X0, Y1 = cx - side / 2, cy + side / 2
    px0, py0 = int((X0 - ox) / res), int((oy1 - Y1) / res); px1, py1 = px0 + int(side / res), py0 + int(side / res)
    inside = px0 >= 0 and py0 >= 0 and px1 <= W and py1 <= H
    crop = img.crop((px0, py0, px1, py1)).resize((448, 448), Image.LANCZOS); d = ImageDraw.Draw(crop); s = 448 / side
    for poly in getattr(g, 'geoms', [g]): d.line([((x - X0) * s, (Y1 - y) * s) for x, y in poly.exterior.coords], fill=(255, 0, 0), width=3)
    name = fid.replace(':', '_') + '.jpg'; crop.save(os.path.join(out, 'crops', name), quality=90)
    index.append({'id': fid, 'file': name, 'side_m': round(side, 1), 'area_m2': round(g.area, 1), 'in_ortho': inside})
json.dump(index, open(os.path.join(out, 'index.json'), 'w'), indent=0)
with zipfile.ZipFile(os.path.join(out, 'crops.zip'), 'w') as z:
    z.write(os.path.join(out, 'index.json'), 'index.json')
    for it in index: z.write(os.path.join(out, 'crops', it['file']), 'crops/' + it['file'])
print('crops', len(index), 'outside ortho', sum(not i['in_ortho'] for i in index))
