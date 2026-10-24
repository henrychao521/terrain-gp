"""Compare the game's carriageway with the official Taipei road layers along a circuit (D1 / D2, docs/賽道修正_2026-10.md).

  python3 tools/streetview/road_widths.py <out.json> <track.json> [<track.json> ...]

track.json: tools/test/node/world.js output (centreline x / z, left normal lx / lz, half widths hwL / hwR, road names).
Official layers (ref/raw/, see ref/SOURCES.md; EPSG:3826, OGDL v1):
  road8m/8mroadup/Road.shp   臺北市寬度超過8公尺道路GIS圖資: road reserve polygons (kerb to kerb incl. sidewalks), ROADWIDTH
  sidewalk/TP_SIDEWORK.json  臺北市人行道範圍圖: sidewalk polygons
Every 25 m a line across the road (±45 m along the left normal) is cut by the reserve polygon under the centreline;
the sidewalks are taken out; the piece under the centreline is the official carriageway. Per sample: its left and right
edge (m from the game's centreline), width, centre offset (+ = left of the direction of travel). Stretches of the same
road are summarised by the median. A stretch is flagged when the width differs by > 2 m, or the centre by > 2 m.
Dual carriageways (the game drives one half of a road mapped as two one-way ways): the official cut runs from kerb to
kerb across both halves (medians are not in the sidewalk layer), so the half's width is estimated twice, from the
right kerb (2 x its distance from the way, the way being centred in its half) and from the opposite way (kerb-to-kerb
width minus the distance between the two ways); "wDir" is used when both agree within 2 m.
"""
import json, math, os, statistics, sys
import shapefile
from shapely.geometry import shape, LineString, Point
from shapely.ops import unary_union, transform
from shapely.strtree import STRtree

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.environ.get('JZ_REF', os.path.join(REPO, 'ref'))
E0, N0 = 299000.0, 2766400.0
shift = lambda g: transform(lambda x, y, z=None: (x - E0, y - N0), g)


def load_reserve():
    r = shapefile.Reader(os.path.join(REF, 'raw', 'road8m', '8mroadup', 'Road.shp'), encoding='utf-8')
    names = [f[0] for f in r.fields[1:]]
    out = []
    for sr in r.iterShapeRecords():
        try: g = shift(shape(sr.shape.__geo_interface__)).buffer(0)
        except Exception: continue
        if not g.is_empty: out.append((g, dict(zip(names, sr.record))))
    return out


def load_sidewalks():
    fc = json.load(open(os.path.join(REF, 'raw', 'sidewalk', 'TP_SIDEWORK.json')))
    out = []
    for f in fc['features']:
        try: g = shift(shape(f['geometry'])).buffer(0)
        except Exception: continue
        if not g.is_empty: out.append(g)
    return out


def pieces(g):
    return [p for p in (g.geoms if hasattr(g, 'geoms') else [g]) if p.length > 0]


def osm_ways():
    o = json.load(open(os.path.join(REPO, 'data', 'taipei_osm.json')))
    return [(r[1], LineString([(r[6 + 2 * i] / 10, r[7 + 2 * i] / 10) for i in range((len(r) - 6) // 2)])) for r in o['roads'] if r[5] == 0 and len(r) >= 10]


def main():
    out_path, tracks = sys.argv[1], sys.argv[2:]
    ways = osm_ways(); wtree = STRtree([w for _, w in ways])
    res = load_reserve(); rtree = STRtree([g for g, _ in res])
    sws = load_sidewalks(); stree = STRtree(sws)
    report = {'note': __doc__.split('\n\n')[0], 'tracks': []}
    for tp in tracks:
        t = json.load(open(tp)); n, ds = t['n'], t['ds']; step = max(1, round(25 / ds))
        samples = []
        for k in range(0, n, step):
            X, Y = t['x'][k] + t['sx'] / 2, t['sz'] / 2 - t['z'][k]
            lx, ly = t['lx'][k], -t['lz'][k]  # left of travel, data frame
            P = Point(X, Y); cut = LineString([(X - lx * 45, Y - ly * 45), (X + lx * 45, Y + ly * 45)])
            cand = [res[i] for i in rtree.query(P.buffer(4))]
            cand = [c for c in cand if c[0].distance(P) < 4]
            if not cand: samples.append({'k': k, 'road': t['rname'][k], 'miss': 'no reserve'}); continue
            reserve = unary_union([c[0] for c in cand]); rw = max(float(c[1].get('ROADWIDTH') or 0) for c in cand)
            seg = cut.intersection(reserve)
            near_sw = [sws[i] for i in stree.query(seg.buffer(1))] if not seg.is_empty else []
            carr = seg.difference(unary_union(near_sw)) if near_sw else seg
            ps = sorted(pieces(carr), key=lambda p: p.distance(P))
            if not ps or ps[0].distance(P) > 3: samples.append({'k': k, 'road': t['rname'][k], 'miss': 'centre on sidewalk'}); continue
            p0 = ps[0]; a, b = p0.coords[0], p0.coords[-1]
            off = lambda q: (q[0] - X) * lx + (q[1] - Y) * ly
            L, R = max(off(a), off(b)), -min(off(a), off(b))
            # the opposite half of a dual carriageway: nearest same-name way crossing the cut on the left
            sep = None
            for i in wtree.query(cut):
                nm, w = ways[i]
                if nm != t['rname'][k]: continue
                x = cut.intersection(w)
                for q in (x.geoms if hasattr(x, 'geoms') else [x]):
                    if q.is_empty or q.geom_type != 'Point': continue
                    o_ = off((q.x, q.y))
                    if 3 < o_ < 40 and (sep is None or o_ < sep): sep = o_
            samples.append({'k': k, 'road': t['rname'][k], 'two': t['two'][k], 'lanes': t['lanes'][k], 'gameL': t['hwL'][k], 'gameR': t['hwR'][k],
                            'offL': round(L, 2), 'offR': round(R, 2), 'width': round(L + R, 2), 'centre': round((L - R) / 2, 2), 'reserveW': rw,
                            'sep': round(sep, 2) if sep else None, 'w1': round(2 * R, 2), 'w2': round(L + R - sep, 2) if sep else None,
                            'X': round(X, 1), 'Y': round(Y, 1)})
        # stretches: consecutive samples on the same road
        st = []
        for s in samples:
            if not st or st[-1]['road'] != s['road']: st.append({'road': s['road'], 's': []})
            st[-1]['s'].append(s)
        stretches = []
        for g in st:
            ok = [s for s in g['s'] if 'width' in s]
            if not ok: stretches.append({'road': g['road'], 'samples': len(g['s']), 'measured': 0}); continue
            med = lambda key: round(statistics.median(s[key] for s in ok), 2)
            game_w = med('gameL') + med('gameR'); w = med('width'); c = med('centre')
            dual = any(s['two'] == 0 for s in ok) and sum(1 for s in ok if s.get('sep')) > len(ok) / 2
            w1 = med('w1'); w2s = [s['w2'] for s in ok if s.get('w2')]; w2 = round(statistics.median(w2s), 2) if w2s else None
            wdir = round((w1 + w2) / 2, 1) if dual and w2 is not None and abs(w1 - w2) <= 2 else None
            spread = round(statistics.pstdev([s['w1'] for s in ok]), 2) if len(ok) > 1 else 0
            stretches.append({'road': g['road'], 'k0': g['s'][0]['k'], 'k1': g['s'][-1]['k'], 'samples': len(g['s']), 'measured': len(ok), 'gameW': round(game_w, 2),
                              'officialW': w, 'diffW': round(w - game_w, 2), 'centre': c, 'reserveW': med('reserveW'), 'dual': dual,
                              'w1': w1, 'w2': w2, 'w1sd': spread, 'wDir': wdir, 'diffDir': round(wdir - game_w, 2) if wdir else None,
                              'flag': (abs(w - game_w) > 2 or abs(c) > 2) if not dual else (wdir is not None and abs(wdir - game_w) > 2),
                              'from': [g['s'][0]['X'], g['s'][0]['Y']], 'to': [g['s'][-1]['X'], g['s'][-1]['Y']]})
        flagged_samples = sum(1 for s in samples if 'width' in s and abs(s['width'] - s['gameL'] - s['gameR']) > 2)
        report['tracks'].append({'track': os.path.basename(tp), 'spec': t.get('spec'), 'samples': len(samples), 'measured': sum('width' in s for s in samples),
                                 'widthOff2m': flagged_samples, 'stretches': stretches, 'perSample': samples})
        print(os.path.basename(tp), 'samples', len(samples), 'width off > 2 m', flagged_samples)
        for s in stretches:
            if s.get('measured'):
                print(f"  {s['road']:<10} k{s['k0']:>4}-{s['k1']:<4} game {s['gameW']:5.1f}  kerb-kerb {s['officialW']:5.1f}  centre {s['centre']:+5.1f}  " + (f"dual: 2xR {s['w1']:5.1f} (sd {s['w1sd']}) W-sep {s['w2']}  -> {s['wDir']}" if s['dual'] else '') + f" {'FLAG' if s['flag'] else ''}")
    json.dump(report, open(out_path, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
