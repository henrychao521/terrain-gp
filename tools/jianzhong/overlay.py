"""Draw reference and game layers over the orthophoto (data frame, north up).

  python3 tools/jianzhong/overlay.py <out.png> [--bbox X0,Y0,X1,Y1] [--scale 0.5] [--layers a,b,...] [--render tiles_top.png]
         [--track track.json] [--walls walls.json] [--labels] [--fade 0.35]

layers: ortho, game (tpe3d footprints, red), permit (cyan), road8m (yellow), sidewalk (green), osm (OSM carriageway edges
centre ± width/2, magenta), track (driven centreline and the game's hwL / hwR edges, white/orange), walls (ray hits, red dots),
render (a Blender top-down render of the tiles, aligned by its .json, blended over the photo).
"""
import argparse, json, math, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, load_track

ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--bbox'); ap.add_argument('--scale', type=float, default=0.5)
ap.add_argument('--layers', default='ortho,game,permit,road8m,osm,track,walls'); ap.add_argument('--render'); ap.add_argument('--track'); ap.add_argument('--walls')
ap.add_argument('--labels', action='store_true'); ap.add_argument('--fade', type=float, default=0.0); ap.add_argument('--ortho', default='ortho_PHOTO2_z19_twd97')
ap.add_argument('--title', default=''); ap.add_argument('--issues')
a = ap.parse_args(); L = set(a.layers.split(','))
meta = json.load(open(os.path.join(REF, a.ortho + '.json'))); img = Image.open(os.path.join(REF, a.ortho + '.png')).convert('RGB')
res = meta['res']; ox, oy1 = meta['x0'], meta['y1']
if a.bbox: X0, Y0, X1, Y1 = map(float, a.bbox.split(','))
else: X0, Y0, X1, Y1 = ox, oy1 - meta['height'] * res, ox + meta['width'] * res, oy1
crop = img.crop((int((X0 - ox) / res), int((oy1 - Y1) / res), int((X1 - ox) / res), int((oy1 - Y0) / res)))
s = a.scale  # output pixels per data metre = s / res
W, H = int(crop.width * s), int(crop.height * s)
base = crop.resize((W, H), Image.LANCZOS) if 'ortho' in L else Image.new('RGB', (W, H), (40, 40, 40))  # without 'ortho' only the image's extent is used
if a.fade: base = Image.blend(base, Image.new('RGB', base.size, (255, 255, 255)), a.fade)
ppm = s / res
P = lambda x, y: ((x - X0) * ppm, (Y1 - y) * ppm)
if a.render:
    rm = json.load(open(a.render[:-4] + '.json')); r = Image.open(a.render).convert('RGBA')
    # the render covers rm x0..x1, y0..y1 (data metres); paste the part inside the bbox
    rx = r.width / (rm['x1'] - rm['x0'])
    rc = r.crop((int((X0 - rm['x0']) * rx), int((rm['y1'] - Y1) * rx), int((X1 - rm['x0']) * rx), int((rm['y1'] - Y0) * rx))).resize((W, H), Image.LANCZOS)
    base = Image.alpha_composite(base.convert('RGBA'), rc).convert('RGB')
ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
lw = max(1, int(round(ppm * 0.35)))


def rings(g):
    t = g['type']; cs = g['coordinates']
    if t == 'Polygon': return [cs[0]] + cs[1:]
    if t == 'MultiPolygon': return [r for p in cs for r in p]
    if t == 'LineString': return [cs]
    if t == 'MultiLineString': return cs
    return []


def layer(name, col, fill=None, closed=True, width=lw):
    fc = json.load(open(os.path.join(REF, 'clip', name + '.geojson')))
    for f in fc['features']:
        for r in rings(f['geometry']):
            pts = [P(x, y) for x, y, *_ in r]
            if len(pts) < 2: continue
            if fill and closed: d.polygon(pts, fill=fill)
            d.line(pts + ([pts[0]] if closed else []), fill=col, width=width)
    return fc


if 'road8m' in L: layer('road8m', (255, 220, 0, 230), fill=(255, 220, 0, 40))
if 'sidewalk' in L: layer('sidewalk', (60, 220, 90, 220), fill=(60, 220, 90, 50))
if 'permit' in L: layer('permit', (0, 230, 255, 255), width=lw + 1)
if 'game' in L:
    fc = json.load(open(os.path.join(REF, 'clip', 'game_buildings.geojson')))
    try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', max(9, int(ppm * 1.6)))
    except OSError: font = None
    for f in fc['features']:
        for r in rings(f['geometry']):
            pts = [P(x, y) for x, y in r]; d.line(pts + [pts[0]], fill=(255, 50, 50, 255), width=lw)
        if a.labels:
            cs = rings(f['geometry'])[0]; cx = sum(p[0] for p in cs) / len(cs); cy = sum(p[1] for p in cs) / len(cs)
            d.text(P(cx, cy), str(f['properties']['bid']), fill=(255, 255, 255, 255), font=font, anchor='mm', stroke_width=2, stroke_fill=(0, 0, 0, 255))
if 'osm' in L:
    fc = json.load(open(os.path.join(REF, 'clip', 'osm_roads.geojson')))
    for f in fc['features']:
        p = f['properties']
        if p['layer'] > 0 or p['cls'] > 5: continue
        cs = f['geometry']['coordinates']; hw = p['width_m'] / 2
        for sd in (1, -1):
            pts = []
            for i in range(len(cs)):
                a0 = cs[max(0, i - 1)]; a1 = cs[min(len(cs) - 1, i + 1)]; dx, dy = a1[0] - a0[0], a1[1] - a0[1]; l = math.hypot(dx, dy) or 1
                pts.append(P(cs[i][0] - dy / l * hw * sd, cs[i][1] + dx / l * hw * sd))
            d.line(pts, fill=(255, 0, 255, 200), width=lw)
        d.line([P(x, y) for x, y in cs], fill=(255, 0, 255, 120), width=max(1, lw // 2))
if 'track' in L:
    t = load_track(a.track) if a.track else load_track()
    n = t['n']; X, Y = t['X'], t['Y']
    # left of travel in the data frame: game (lx, lz) -> data (lx, -lz)
    for side, hw, col in ((1, t['hwL'], (255, 140, 0, 255)), (-1, t['hwR'], (255, 140, 0, 255))):
        pts = [P(X[k] + t['lx'][k] * hw[k] * side, Y[k] - t['lz'][k] * hw[k] * side) for k in range(n)]
        d.line(pts + [pts[0]], fill=col, width=lw + 1)
    d.line([P(X[k], Y[k]) for k in range(n)] + [P(X[0], Y[0])], fill=(255, 255, 255, 220), width=lw)
if 'walls' in L and a.walls:
    for r in json.load(open(a.walls))['results']:
        for h in r['wallsAt']:
            x, y = P(*h['data']); rr = max(3, lw * 2); d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 0, 0, 255), outline=(255, 255, 255, 255))
COL = {'intrusion_wall': (255, 0, 0), 'intrusion_overhang': (255, 120, 0), 'intrusion_column': (255, 0, 160), 'footprint_in_road_reserve': (255, 230, 0), 'stretched_footprint': (255, 0, 0),
       'arcade_ring_broken': (200, 0, 255), 'invalid_footprint': (200, 0, 255), 'overlapping_buildings': (0, 200, 255), 'nested_building': (0, 120, 255), 'coplanar_roof': (0, 60, 255),
       'missing_building': (0, 255, 120), 'dropped_building': (0, 255, 120), 'extra_building': (120, 255, 0), 'wrong_height': (255, 255, 255), 'wrong_use_storefront': (255, 150, 200),
       'road_edge_offset': (255, 255, 0), 'sunken_object': (150, 150, 150)}
if a.issues:
    for it in json.load(open(a.issues))['issues']:
        x, y = P(*it['at']); c = COL.get(it['type'], (255, 255, 255)); rr = max(4, lw * 3)
        d.rectangle([x - rr, y - rr, x + rr, y + rr], outline=(*c, 255), width=max(2, lw)) if it['type'].startswith(('missing', 'dropped', 'extra')) else d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(*c, 230), outline=(0, 0, 0, 255))
    try: lf = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 15)
    except OSError: lf = None
    used = sorted({it['type'] for it in json.load(open(a.issues))['issues']}); ly = 40
    d.rectangle([W - 250, 30, W - 5, 36 + 19 * len(used)], fill=(0, 0, 0, 170))
    for t in used: d.ellipse([W - 244, ly, W - 232, ly + 12], fill=(*COL.get(t, (255, 255, 255)), 255)); d.text((W - 226, ly - 3), t, fill=(255, 255, 255, 255), font=lf); ly += 19
out = Image.alpha_composite(base.convert('RGBA'), ov).convert('RGB')
dd = ImageDraw.Draw(out)
try: f2 = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 18)
except OSError: f2 = None
src = ('底圖：內政部國土測繪中心 PHOTO2 正射影像（2024，國土測繪圖資服務雲，僅供比對顯示，不得放進公開 repo）' if 'ortho' in L
       else '底圖：遊戲區塊的 Blender 俯視渲染' if a.render else '底圖：無（只畫向量圖層）')
cap = (a.title + '　' if a.title else '') + src
dd.rectangle([0, H - 26, W, H], fill=(0, 0, 0)); dd.text((6, H - 23), cap, fill=(255, 255, 255), font=f2)
# scale bar 50 m
bx = 10; dd.rectangle([bx, 10, bx + 50 * ppm, 16], fill=(255, 255, 255)); dd.text((bx, 18), '50 m', fill=(255, 255, 255), font=f2, stroke_width=2, stroke_fill=(0, 0, 0))
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True); out.save(a.out, optimize=True)
print('wrote', a.out, out.size)
