"""Download the NLSC orthophoto (WMTS, Web Mercator tiles) over the corridor and resample it into the data frame.

  python3 tools/jianzhong/fetch_ortho.py [--zoom 19] [--layer PHOTO2] [--res 0.25]

Writes ref/ortho/<layer>_z<zoom>/<z>_<y>_<x>.jpg (raw tiles, kept for provenance) and
ref/ortho_<layer>_twd97.png + .json (north-up image in TWD97, res m/pixel, origin = top-left corner in data metres).
Only the bounding box of the loop ±160 m is fetched (about 160 tiles at zoom 19). 2 requests at a time.
"""
import argparse, json, math, os, sys, time, io
from concurrent.futures import ThreadPoolExecutor
import subprocess
import numpy as np
from PIL import Image
from pyproj import Transformer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, E0, N0, LOOP

ap = argparse.ArgumentParser(); ap.add_argument('--zoom', type=int, default=19); ap.add_argument('--layer', default='PHOTO2'); ap.add_argument('--res', type=float, default=0.25)
ap.add_argument('--pad', type=float, default=160); a = ap.parse_args()
URL = 'https://wmts.nlsc.gov.tw/wmts/{layer}/default/GoogleMapsCompatible/{z}/{y}/{x}'
xs = [p[0] for p in LOOP]; ys = [p[1] for p in LOOP]
X0, X1, Y0, Y1 = min(xs) - a.pad, max(xs) + a.pad, min(ys) - a.pad, max(ys) + a.pad
to_ll = Transformer.from_crs(3826, 4326, always_xy=True); to_tm = Transformer.from_crs(4326, 3826, always_xy=True)
z = a.zoom; n = 2 ** z
def tile_xy(lon, lat): return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
cs = [tile_xy(*to_ll.transform(E0 + X, N0 + Y)) for X in (X0, X1) for Y in (Y0, Y1)]
tx0, tx1 = int(min(c[0] for c in cs)), int(max(c[0] for c in cs)); ty0, ty1 = int(min(c[1] for c in cs)), int(max(c[1] for c in cs))
d = os.path.join(REF, 'ortho', f'{a.layer}_z{z}'); os.makedirs(d, exist_ok=True)
def get(t):
    x, y = t; f = os.path.join(d, f'{z}_{y}_{x}.jpg')
    if os.path.exists(f) and os.path.getsize(f) > 0: return 'cached'
    for k in range(4):
        # curl, not Python's ssl: the NLSC certificate lacks a Subject Key Identifier and Python 3.13+ rejects it
        r = subprocess.run(['curl', '-s', '-o', f + '.part', '-w', '%{http_code} %{content_type}', URL.format(layer=a.layer, z=z, y=y, x=x)], capture_output=True, text=True)
        code, _, ctype = r.stdout.partition(' ')
        if code == '200' and ctype.startswith('image'): os.replace(f + '.part', f); return 'ok'
        if os.path.exists(f + '.part'): os.remove(f + '.part')
        if code == '404': return '404'
        time.sleep(1 + k)
    return 'fail'
todo = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
with ThreadPoolExecutor(2) as ex: st = list(ex.map(get, todo))
print('tiles', len(todo), {s: st.count(s) for s in set(st)})
# mosaic in Web Mercator pixel space
W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
mos = Image.new('RGB', (W, H), (0, 0, 0))
for (x, y) in todo:
    f = os.path.join(d, f'{z}_{y}_{x}.jpg')
    if os.path.exists(f):
        try: mos.paste(Image.open(f).convert('RGB'), ((x - tx0) * 256, (y - ty0) * 256))
        except Exception as e: print('bad tile', f, e)
M = np.asarray(mos)
# output grid in TWD97 (data frame), north up
ow, oh = int((X1 - X0) / a.res), int((Y1 - Y0) / a.res)
gx = X0 + (np.arange(ow) + 0.5) * a.res; gy = Y1 - (np.arange(oh) + 0.5) * a.res
GX, GY = np.meshgrid(gx, gy)
lon, lat = to_ll.transform(E0 + GX, N0 + GY)
px = ((lon + 180) / 360 * n - tx0) * 256 - 0.5; py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - ty0) * 256 - 0.5
# bilinear
x0 = np.clip(np.floor(px).astype(int), 0, W - 2); y0 = np.clip(np.floor(py).astype(int), 0, H - 2); fx = np.clip(px - x0, 0, 1)[..., None]; fy = np.clip(py - y0, 0, 1)[..., None]
out = (M[y0, x0] * (1 - fx) * (1 - fy) + M[y0, x0 + 1] * fx * (1 - fy) + M[y0 + 1, x0] * (1 - fx) * fy + M[y0 + 1, x0 + 1] * fx * fy).astype(np.uint8)
base = os.path.join(REF, f'ortho_{a.layer}_z{z}_twd97')
Image.fromarray(out).save(base + '.png', optimize=True)
json.dump({'layer': a.layer, 'zoom': z, 'res': a.res, 'x0': X0, 'y1': Y1, 'width': ow, 'height': oh, 'frame': 'data metres east/north of TWD97 E 299000 / N 2766400; pixel (i, j) centre = (x0 + (i+0.5)*res, y1 - (j+0.5)*res)',
           'source': URL.format(layer=a.layer, z='{z}', y='{y}', x='{x}'), 'fetched': time.strftime('%Y-%m-%d')}, open(base + '.json', 'w'), indent=1)
print('wrote', base + '.png', ow, oh)
