"""Clip the official reference layers and the game's own layers to the corridor, in the data frame.

  python3 tools/jianzhong/prep_ref.py

Inputs (ref/raw/, downloaded as listed in ref/SOURCES.md):
  permit/taipei_1151005.shp   臺北市建築執照套繪圖 (OGDL v1): footprints of buildings permitted 2001+, bud_floor
  road8m/8mroadup/Road.shp     臺北市寬度超過8公尺道路GIS圖資 (OGDL v1): road surface polygons, ROADWIDTH
  roadwidth/roadsize2.shp      臺北市道路寬度 (OGDL v1): planned road width labels (lines)
  sidewalk/TP_SIDEWORK.json    臺北市人行道範圍圖 (OGDL v1): sidewalk polygons, SW_WTH
  zoning/zoning_detail_poly.shp 臺北市都市計畫使用分區圖 全市細計 (OGDL v1): zoning polygons (no .prj in the zip; TWD97 TM2)
All of them are TWD97 TM2 (EPSG:3826); the data frame is the same projection shifted by (299000, 2766400).

Outputs (ref/clip/*.geojson, coordinates in data metres): permit.geojson, road8m.geojson, roadwidth.geojson,
sidewalk.geojson, zoning.geojson, game_buildings.geojson (data/taipei.json, tpe3d), osm_roads.geojson (data/taipei_osm.json, with
the game's carriageway width), osm_landmarks.geojson, corridor.geojson (the ±150 m band and the driven centreline).
"""
import json, os, sys
import shapefile
from shapely.geometry import shape, mapping, Polygon, LineString, MultiPolygon, LinearRing
from shapely.ops import transform
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REF, REPO, E0, N0, load_track, corridor_band, CLIP_M

RAW, OUT = os.path.join(REF, 'raw'), os.path.join(REF, 'clip')
os.makedirs(OUT, exist_ok=True)
shift = lambda g: transform(lambda x, y, z=None: (x - E0, y - N0), g)
track = load_track(); band = corridor_band(track, CLIP_M); ring = LinearRing(list(zip(track['X'], track['Y'])))
area = band.union(Polygon(ring))  # the band plus the block inside the loop (建中 and its neighbours)
if os.environ.get('JZ_BAND_ONLY') == '1': area = band  # long circuits (tools/streetview): only the ±150 m band
for ex in filter(None, os.environ.get('JZ_EXCLUDE', '').split(':')):  # areas of corridors already built (data/corridors/*.json)
    area = area.difference(Polygon(json.load(open(ex))['area']).buffer(0))
if area.geom_type == 'MultiPolygon': area = max(area.geoms, key=lambda g: g.area)


def write(name, feats, note):
    json.dump({'type': 'FeatureCollection', 'name': name, 'note': note, 'features': feats}, open(os.path.join(OUT, name + '.geojson'), 'w'), ensure_ascii=False)
    print(name, len(feats))


def evenodd(shp):
    """polygon from shapefile parts by the even-odd rule (the zoning file has its rings wound the wrong way)"""
    pts, parts = shp.points, list(shp.parts) + [len(shp.points)]
    g = None
    for a, b in zip(parts, parts[1:]):
        if b - a < 3: continue
        q = Polygon(pts[a:b]).buffer(0)
        g = q if g is None else g.symmetric_difference(q)
    return g if g is not None else Polygon()


def from_shp(path, enc='utf-8', even_odd=False):
    r = shapefile.Reader(path, encoding=enc)
    names = [f[0] for f in r.fields[1:]]
    for sr in r.iterShapeRecords():
        try: g = shift(evenodd(sr.shape) if even_odd else shape(sr.shape.__geo_interface__))
        except Exception: continue
        yield g, dict(zip(names, sr.record))


def clean(v):
    if isinstance(v, float): return round(v, 3)
    if isinstance(v, (bytes, bytearray)): return v.decode('utf-8', 'replace')
    return v if isinstance(v, (int, str)) or v is None else str(v)


# permits: one feature per permit polygon, id = row index in the city-wide file
feats = []
for i, (g, p) in enumerate(from_shp(os.path.join(RAW, 'permit', 'taipei_1151005'))):
    if not g.is_valid: g = g.buffer(0)
    if g.is_empty or not g.intersects(area): continue
    feats.append({'type': 'Feature', 'id': f'permit:{i}', 'properties': {'src_id': f'permit:{i}', 'floors': int(p['bud_floor'] or 0) or None, 'const': p['bud_const'], 'permit': p['budatt_no'], 'area_m2': round(g.area, 1)}, 'geometry': mapping(g)})
write('permit', feats, '臺北市建築執照套繪圖 taipei_1151005 (臺北市建築管理工程處, OGDL v1). floors=bud_floor (None when 0/missing). Only buildings permitted 2001-2026.')

feats = []
for g, p in from_shp(os.path.join(RAW, 'road8m', '8mroadup', 'Road')):
    if not g.is_valid: g = g.buffer(0)
    if g.is_empty or not g.intersects(area): continue
    feats.append({'type': 'Feature', 'id': 'road8m:' + str(p['OBJECTID']), 'properties': {k: clean(p[k]) for k in ('OBJECTID', 'ROAD_ID', 'ROADNAME', 'ROADWIDTH', 'CEN_MEDIAN', 'CAR_MEDIAN', 'SWALK_AREA', 'AVG', 'MAX', 'MIN')}, 'geometry': mapping(g)})
write('road8m', feats, '臺北市寬度超過8公尺道路GIS圖資 8mroadup (臺北市政府工務局新建工程處, OGDL v1). ROADWIDTH m; polygons are the road reserve (kerb line to kerb line incl. sidewalks where surveyed).')

feats = []
for g, p in from_shp(os.path.join(RAW, 'roadwidth', 'roadsize2')):
    if g.is_empty or not g.intersects(area): continue
    feats.append({'type': 'Feature', 'properties': {k: clean(v) for k, v in p.items()}, 'geometry': mapping(g)})
write('roadwidth', feats, '臺北市道路寬度 roadsize2 (臺北市政府都市發展局, OGDL v1): planned (都市計畫) road width labels.')

sw = json.load(open(os.path.join(RAW, 'sidewalk', 'TP_SIDEWORK.json')))
feats = []
for f in sw['features']:
    g = shift(shape(f['geometry']))
    if not g.is_valid: g = g.buffer(0)
    if g.is_empty or not g.intersects(area): continue
    feats.append({'type': 'Feature', 'id': 'sidewalk:' + str(f['properties'].get('ID')), 'properties': {k: clean(v) for k, v in f['properties'].items()}, 'geometry': mapping(g)})
write('sidewalk', feats, '臺北市人行道範圍圖 TP_SIDEWORK (臺北市政府工務局新建工程處, OGDL v1). SW_WTH sidewalk width m.')

feats = []
for g, p in from_shp(os.path.join(RAW, 'zoning', 'zoning_detail_poly'), enc='cp950', even_odd=True):
    if not g.is_valid: g = g.buffer(0)
    if g.is_empty or not g.intersects(area) or p['分區代碼'] in ('細部計畫範圍',) or (p['使用分區'] or p['分區簡稱']) in ('規劃範圍', '行政區'): continue
    feats.append({'type': 'Feature', 'properties': {'code': p['分區代碼'], 'short': p['分區簡稱'], 'zone': p['使用分區'], 'note': p['分區說明']}, 'geometry': mapping(g)})
write('zoning', feats, '臺北市都市計畫使用分區圖 全市細計 (臺北市政府都市發展局, OGDL v1, 更新至 114 年 1 月). zone = 使用分區')

# the game's own layers
T = json.load(open(os.path.join(REPO, 'data', 'taipei.json')))
feats = []
for i, b in enumerate(T['buildings']):
    pts = b[1:]; ring_ = [(pts[2 * k], pts[2 * k + 1]) for k in range(len(pts) // 2)]
    if len(ring_) < 3: continue
    g = Polygon(ring_)
    if not g.is_valid: g = g.buffer(0)
    if g.is_empty or not g.intersects(area): continue
    feats.append({'type': 'Feature', 'id': f'tpe3d:{i}', 'properties': {'bid': i, 'height_m': b[0] / 10, 'area_m2': round(g.area, 1)}, 'geometry': mapping(g)})
write('game_buildings', feats, 'data/taipei.json buildings (臺北市自動化3D近似建物模型 via sheethub/tpe3d), simplified by tools/prep_taipei.py; bid = index in data/taipei.json')

O = json.load(open(os.path.join(REPO, 'data', 'taipei_osm.json')))
feats = []
for i, r in enumerate(O['roads']):
    p = [(r[6 + 2 * k] / 10, r[7 + 2 * k] / 10) for k in range((len(r) - 6) // 2)]
    if len(p) < 2: continue
    g = LineString(p)
    if not g.intersects(area): continue
    feats.append({'type': 'Feature', 'id': f'osm:{i}', 'properties': {'rid': i, 'cls': r[0], 'name': r[1], 'oneway': r[2], 'lanes': r[3], 'width_m': r[4] / 10, 'layer': r[5]}, 'geometry': mapping(g)})
write('osm_roads', feats, 'data/taipei_osm.json roads (© OpenStreetMap contributors, ODbL); width_m is the carriageway width the game and build_tile.py use')
feats = []
for i, l in enumerate(O['landmarks']):
    p = l['p']; g = Polygon([(p[2 * k] / 10, p[2 * k + 1] / 10) for k in range(len(p) // 2)])
    if g.is_valid and g.intersects(area): feats.append({'type': 'Feature', 'id': f'lm:{i}', 'properties': {k: l[k] for k in l if k != 'p'}, 'geometry': mapping(g)})
write('osm_landmarks', feats, 'data/taipei_osm.json landmarks (OSM building parts with names)')
write('corridor', [{'type': 'Feature', 'properties': {'what': 'area', 'clip_m': CLIP_M}, 'geometry': mapping(area)},
                   {'type': 'Feature', 'properties': {'what': 'centreline', 'len_m': track['len']}, 'geometry': mapping(LineString(list(zip(track['X'], track['Y'])) + [(track['X'][0], track['Y'][0])]))}],
      'corridor: ±150 m of the driven centreline plus the block inside the loop; centreline from tools/test/node/world.js')
