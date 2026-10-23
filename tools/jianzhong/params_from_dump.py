"""Write a build dump (tools/blender/build_tile.py with TGP_DUMP) as eval/ params CSV (schema in eval/README.md).

  python3 tools/jianzhong/params_from_dump.py <dump dir> <prefix> <out.csv>

What the tile builder chose for each building: footprint after clear_roads, height, roof (the AI roofs are green
waterproofing, the drawn one grey concrete), arcade, use (storefront when the arcade got shop textures,
institutional when a param file said so, else residential), landmark (param file only).
"""
import csv, glob, json, os, sys
from shapely.geometry import Polygon
d, prefix, out = sys.argv[1:4]
rows = []
for f in sorted(glob.glob(os.path.join(d, f'{prefix}_t_*.json'))):
    for b in json.load(open(f))['buildings']:
        if b.get('dropped'): continue
        g = Polygon(b['ring']);
        if not g.is_valid: g = g.buffer(0)
        p = b.get('params') or {}
        roof = p.get('roof') or b.get('roof') or 'flat_green'
        use = p.get('use') or ('storefront' if b.get('shops') else 'residential')
        rows.append({'building_id': b.get('id') or f"tpe3d:{b['bid']}", 'source_id': b.get('src') or f"tpe3d:{b['bid']}", 'footprint_wkt': g.wkt, 'height_m': round(b['h'], 2), 'floors': p.get('floors') or '',
                     'roof_type': roof, 'arcade': 'yes' if b.get('arcade') else 'no', 'use_class': use, 'landmark': 'yes' if p.get('landmark') else 'no'})
w = csv.DictWriter(open(out, 'w', newline='', encoding='utf-8'), fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print('rows', len(rows))
