"""Buildings inside the carriageway, checked in Blender instead of the browser (same rule as js/walls.js).

  blender -b --factory-startup --python tools/test/blender_walls.py -- <repo> <out.json> <track.json> [<track.json> ...]

Each track.json comes from tools/test/node/world.js (centreline, half widths, surface height, tiles). The Blender
tiles the track passes through (bounds within 20 m) are imported once; from every second centreline sample, 1 m
above the road, a ray goes sideways to the road edge on each side (hwL / hwR). A hit on a tile's building or
landmark mesh is a wall. Two extra counts that the browser check does not have: rays at 4 m and 8 m above the road
(upper floors overhanging the carriageway, which a car does not touch but which look wrong), and rays at 1 m against
the arcade columns of <tile>.inst.json (instanced in the game, so js/walls.js never sees them). Coordinates: the tiles are glTF in the game's world frame (x east, y up, z south);
Blender's importer turns that into x, -z, y.
"""
import base64, bpy, json, math, os, struct, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
REPO, OUT, TRACKS = argv[0], argv[1], argv[2:]
tracks = [json.load(open(p)) for p in TRACKS]
bpy.ops.wm.read_factory_settings(use_empty=True)


def near_tiles(t, pad=20.0):
    xs, zs = t['x'], t['z']
    x0, x1, z0, z1 = min(xs) - pad, max(xs) + pad, min(zs) - pad, max(zs) + pad
    out = []
    for a in t['activeTiles']:
        if a['x1'] < x0 or a['x0'] > x1 or a['z1'] < z0 or a['z0'] > z1: continue
        # finer: some sample within pad of the tile rectangle
        if any(a['x0'] - pad <= x <= a['x1'] + pad and a['z0'] - pad <= z <= a['z1'] + pad for x, z in zip(xs, zs)): out.append(a['file'])
    return out


files = sorted({f for t in tracks for f in near_tiles(t)})
trees, names, cols = [], [], []


def columns(f):
    """arcade columns of a tile (0.55 m square, 6 m tall, base at z), as one BVH"""
    p = os.path.join(REPO, f[:-5] + '.inst.json')
    if not os.path.exists(p): return None
    js = json.load(open(p)); raw = base64.b64decode(js.get('column', '') or b'')
    a = struct.unpack(f'<{len(raw) // 2}h', raw)
    ox, oy = js['x0'] - 2800.0, js['y0'] - 2100.0  # data -> blender xy (map 5600 x 4200 m)
    V, F = [], []
    for i in range(0, len(a), 4):
        cx, cy, z, yaw = ox + a[i] / 10, oy + a[i + 1] / 10, a[i + 2] / 10, a[i + 3] / 10000
        c, s_ = math.cos(-yaw), math.sin(-yaw)  # game yaw is about +y (up) with z south; in blender that is -yaw about z
        b = len(V)
        for dz in (0.0, 6.0):
            for qx, qy in ((-0.275, -0.275), (0.275, -0.275), (0.275, 0.275), (-0.275, 0.275)): V.append(Vector((cx + qx * c - qy * s_, cy + qx * s_ + qy * c, z + dz)))
        F += [(b, b + 1, b + 2, b + 3), (b + 4, b + 5, b + 6, b + 7)] + [(b + q, b + (q + 1) % 4, b + 4 + (q + 1) % 4, b + 4 + q) for q in range(4)]
    return BVHTree.FromPolygons(V, F) if F else None
for f in files:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, f))
    dg = bpy.context.evaluated_depsgraph_get()
    for o in set(bpy.data.objects) - before:
        if o.type != 'MESH' or not o.name.startswith(('buildings', 'landmarks')): continue
        eo = o.evaluated_get(dg); me = eo.to_mesh(); mw = o.matrix_world
        verts = [mw @ v.co for v in me.vertices]; polys = [tuple(p.vertices) for p in me.polygons]
        if polys: trees.append(BVHTree.FromPolygons(verts, polys)); names.append((os.path.basename(f), o.name.split('.')[0]))
        eo.to_mesh_clear()
    c = columns(f)
    if c: cols.append((os.path.basename(f), c))

results = []
for t, path in zip(tracks, TRACKS):
    n, at, rays = t['n'], [], 0
    for k in range(0, n, 2):
        for sd in (1, -1):
            hs = t['hwL'][k] if sd > 0 else t['hwR'][k]
            o = Vector((t['x'][k], -t['z'][k], t['surf'][k] + 1.0)); d = Vector((t['lx'][k] * sd, -t['lz'][k] * sd, 0.0)).normalized(); rays += 1
            best = None
            for tr, nm in zip(trees, names):
                loc, nrm, idx, dist = tr.ray_cast(o, d, hs)
                if loc is not None and (best is None or dist < best[0]): best = (dist, nm, loc)
            if best:
                at.append({'k': k, 'side': 'L' if sd > 0 else 'R', 'road': t['rname'][k], 'm': round(best[0], 1), 'halfWidth': round(hs, 1),
                           'mesh': best[1][1], 'tile': best[1][0], 'world': [round(best[2].x, 1), round(-best[2].y, 1)],
                           'data': [round(best[2].x + t['sx'] / 2, 1), round(t['sz'] / 2 + best[2].y, 1)]})
    # upper floors over the carriageway, and arcade columns standing in it
    over, colhits = [], []
    for k in range(0, n, 2):
        for sd in (1, -1):
            hs = t['hwL'][k] if sd > 0 else t['hwR'][k]; d = Vector((t['lx'][k] * sd, -t['lz'][k] * sd, 0.0)).normalized()
            for hgt in (4.0, 8.0):
                o = Vector((t['x'][k], -t['z'][k], t['surf'][k] + hgt))
                hit = min(((tr.ray_cast(o, d, hs)[3] or 1e9, nm) for tr, nm in zip(trees, names)), default=(1e9, None))
                if hit[0] < 1e8: over.append({'k': k, 'side': 'L' if sd > 0 else 'R', 'h': hgt, 'road': t['rname'][k], 'm': round(hit[0], 1), 'halfWidth': round(hs, 1), 'mesh': hit[1][1], 'tile': hit[1][0]}); break
            o = Vector((t['x'][k], -t['z'][k], t['surf'][k] + 1.0))
            for tf, tr in cols:
                loc, nrm, idx, dist = tr.ray_cast(o, d, hs)
                if loc is not None:
                    colhits.append({'k': k, 'side': 'L' if sd > 0 else 'R', 'road': t['rname'][k], 'm': round(dist, 1), 'halfWidth': round(hs, 1), 'tile': tf,
                                    'data': [round(loc.x + t['sx'] / 2, 1), round(t['sz'] / 2 + loc.y, 1)]}); break
    tiles_here = near_tiles(t)
    results.append({'track': os.path.basename(path), 'spec': t['spec'], 'walls': len(at), 'wallsAt': at, 'rays': rays,
                    'overhang': len(over), 'overhangAt': over, 'columns': len(colhits), 'columnsAt': colhits,
                    'tilesTested': tiles_here, 'buildingMeshes': sum(1 for nm in names if nm[0] in {os.path.basename(f) for f in tiles_here}),
                    'len': t['len'], 'viaductM': t['viaductM'], 'hairpins': t['hairpins'], 'route': t['route']})
json.dump({'tiles': files, 'results': results}, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('blender_walls', [(r['track'], r['walls'], r['overhang'], r['columns'], r['rays']) for r in results])
