"""Street-level views of a Taipei circuit as the game builds it, rendered in Blender (no browser).

  blender -b --factory-startup --python tools/streetview/blender_render.py -- <repo> <track.json> <scene.json> <out dir> <poses.json|track> [options JSON]

<track.json> and <scene.json> come from `node tools/test/node/world.js <copy> '{"preset": N, "dump": "<scene.json>"}'`:
the centreline, and every mesh the game puts in W.group near the track (ground, road, kerbs, sidewalks, green areas,
water barriers, lamps, signals, procedural buildings) plus the street trees it keeps. Added here, because glTF does not
load in Node: the Blender tiles the track passes through (models/taipei/*.gltf with their arcade columns, scooters,
AC units and rooftop tanks from .inst.json as simple boxes) and the five street-tree models of models/props/props.gltf
at the game's tree spots (geometry-nodes instances, same scale rule as game.js).

Poses:
  track            every `every` m of the centreline, looking along (fwd) and against (rev) the direction of travel,
                   `eye` m above the road surface (default 1.6), horizontal field of view `fov` (default 70 deg)
  <poses.json>     [{"id": ..., "X": data m, "Y": data m, "heading": compass deg (0 north, clockwise), "fov": deg,
                     "pitch": deg (optional), "w": px, "h": px, "eye": m (optional)}, ...]
Writes <out>/<id>.jpg and <out>/views.json (pose, road name, nearest centreline sample).
Options: every, eye, fov, w, h, samples, ks (list of samples, track mode), dirs, pad (tile margin m), tiles (file list),
         tile_dir (render another set of tiles with the same names), only (list of pose ids).
"""
import base64, bpy, bmesh, json, math, os, struct, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
REPO, TRACK, SCENE, OUT, POSES = argv[:5]; OPT = json.loads(argv[5]) if len(argv) > 5 else {}
os.makedirs(OUT, exist_ok=True)
t = json.load(open(TRACK)); SX, SY = t['sx'], t['sz']; n = t['n']
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
EYE, FOV = OPT.get('eye', 1.6), OPT.get('fov', 70)

# ---------------------------------------------------------------- DEM (same as the game)
T = json.load(open(os.path.join(REPO, 'data', 'taipei.json'))); zr = base64.b64decode(T['z']); NX, NY, DD = T['nx'], T['ny'], T['d']
def dem(X, Y):
    fi = min(max(X / DD - 0.5, 0), NX - 1.001); fj = min(max(Y / DD - 0.5, 0), NY - 1.001); i, j = int(fi), int(fj); a_, b_ = fi - i, fj - j
    def z(ii, jj): o = jj * NX + ii; v = zr[2 * o] | (zr[2 * o + 1] << 8); return (v - 65536 if v > 32767 else v) / 100
    return z(i, j) * (1 - a_) * (1 - b_) + z(i + 1, j) * a_ * (1 - b_) + z(i, j + 1) * (1 - a_) * b_ + z(i + 1, j + 1) * a_ * b_

# ---------------------------------------------------------------- poses
def nearest_k(bx, by):
    return min(range(n), key=lambda k: (t['x'][k] - bx) ** 2 + (-t['z'][k] - by) ** 2)
poses = []
if POSES == 'track':
    step = max(1, round(OPT.get('every', 25) / t['ds']))
    for k in OPT.get('ks') or range(0, n, step):
        for dirn in OPT.get('dirs', ['fwd', 'rev']):
            tx, ty = -t['lz'][k], -t['lx'][k]  # travel direction in blender xy (left (lx,-lz) rotated -90 deg)
            if dirn == 'rev': tx, ty = -tx, -ty
            hd = math.degrees(math.atan2(tx, ty)) % 360
            poses.append({'id': f'{k:04d}_{dirn}', 'k': k, 'dir': dirn, 'X': t['x'][k] + SX / 2, 'Y': SY / 2 - t['z'][k],
                          'heading': round(hd, 2), 'fov': FOV, 'w': OPT.get('w', 960), 'h': OPT.get('h', 540), 'on_track': True})
else:
    poses = json.load(open(POSES))
if OPT.get('only'): poses = [p for p in poses if p['id'] in set(OPT['only'])]
bx_ = [p['X'] - SX / 2 for p in poses]; by_ = [p['Y'] - SY / 2 for p in poses]

# ---------------------------------------------------------------- tiles near the poses
pad = OPT.get('pad', 220)
def near(a): return not (a['x1'] < min(bx_) - pad or a['x0'] > max(bx_) + pad or -a['z0'] < min(by_) - pad or -a['z1'] > max(by_) + pad)
files = OPT.get('tiles') or [a['file'] for a in t['activeTiles'] if near(a)]
TILE_DIR = OPT.get('tile_dir')
tile_path = lambda f: os.path.join(TILE_DIR, os.path.basename(f)) if TILE_DIR else os.path.join(REPO, f)
def solid(name, rgb, rough=0.8, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    if alpha < 1: b.inputs['Alpha'].default_value = alpha
    return m
INST_KIND = (('column', (0.55, 0.55, 6.0), (0.62, 0.6, 0.55)), ('scooter', (1.8, 0.65, 1.1), (0.55, 0.56, 0.6)), ('tank', (1.5, 1.5, 1.4), (0.8, 0.82, 0.85)), ('ac', (0.8, 0.3, 0.55), (0.86, 0.86, 0.83)))
for f in files:
    p = tile_path(f)
    if not os.path.exists(p): continue
    bpy.ops.import_scene.gltf(filepath=p)
    ip = p[:-5] + '.inst.json'
    if os.path.exists(ip):
        js = json.load(open(ip)); ox, oy = js['x0'] - SX / 2, js['y0'] - SY / 2
        for kind, size, col in INST_KIND:
            raw = base64.b64decode(js.get(kind, '') or b''); a = struct.unpack(f'<{len(raw) // 2}h', raw)
            if not a: continue
            bm = bmesh.new()
            for i in range(0, len(a), 4):
                cx, cy, z, yaw = ox + a[i] / 10, oy + a[i + 1] / 10, a[i + 2] / 10, -a[i + 3] / 10000
                for v in bmesh.ops.create_cube(bm, size=1.0)['verts']:
                    x, y, zz = v.co.x * size[0], v.co.y * size[1], (v.co.z + 0.5) * size[2]
                    v.co = Vector((cx + x * math.cos(yaw) - y * math.sin(yaw), cy + x * math.sin(yaw) + y * math.cos(yaw), z + zz))
            me = bpy.data.meshes.new(kind); bm.to_mesh(me); o = bpy.data.objects.new(kind + '_inst', me); scn.collection.objects.link(o)
            me.materials.append(solid(kind, col))

# ---------------------------------------------------------------- the game's own meshes (scene dump)
S = json.load(open(SCENE))
TEXCOL = {'asphalt': (0.075, 0.075, 0.08), 'asphalt2': (0.085, 0.085, 0.09), 'walk': (0.42, 0.41, 0.39), 'grass': (0.12, 0.2, 0.06), 'pave': (0.3, 0.3, 0.29),
          'treeBroad': (0.08, 0.16, 0.05), 'treeCon': (0.06, 0.12, 0.05)}
srgb = lambda c: c ** 2.2
for gi, g in enumerate(S['groups']):
    if g.get('tex') in ('treeBroad', 'treeCon', 'tuft'): continue  # stand-in tree cards: the real models go in below
    P = struct.unpack(f'<{g["tris"] * 9}f', base64.b64decode(g['p'])); C = base64.b64decode(g['c'])
    bm = bmesh.new(); cl = bm.loops.layers.color.new('Col')
    for i in range(g['tris']):
        vs = [bm.verts.new((P[i * 9 + q * 3], -P[i * 9 + q * 3 + 2], P[i * 9 + q * 3 + 1])) for q in range(3)]
        try: f = bm.faces.new(vs)
        except ValueError: continue
        c = (C[i * 3] / 255, C[i * 3 + 1] / 255, C[i * 3 + 2] / 255, 1)
        for l in f.loops: l[cl] = c
    me = bpy.data.meshes.new(f'game_{gi}'); bm.to_mesh(me); o = bpy.data.objects.new(f'game_{gi}_{g.get("tex") or g["color"]}', me); scn.collection.objects.link(o)
    hexc = g['color']; base = tuple(srgb(int(hexc[i:i + 2], 16) / 255) for i in (0, 2, 4))
    if g.get('tex') in TEXCOL: base = TEXCOL[g['tex']]
    elif g.get('tex') == 'shader' or (g['color'] == 'ffffff' and g.get('vc') and not g.get('inst')): base = TEXCOL['pave']  # splat ground
    m = bpy.data.materials.new(f'gm_{gi}'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = g.get('rough') if isinstance(g.get('rough'), (int, float)) else 0.8
    if g.get('vc') or g.get('inst'):  # vertex / instance colours multiply the base colour, as in three.js
        at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'Col'; mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0; mul.inputs[6].default_value = (*base, 1); nt.links.new(at.outputs['Color'], mul.inputs[7]); nt.links.new(mul.outputs[2], b.inputs['Base Color'])
    else: b.inputs['Base Color'].default_value = (*base, 1)
    if g.get('transparent'): b.inputs['Alpha'].default_value = max(0.2, g.get('opacity') or 1.0)
    me.materials.append(m)

# ---------------------------------------------------------------- street trees: the props models at the game's spots
TREES = S.get('trees') or []
if TREES:
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'models', 'props', 'props.gltf')); new = set(bpy.data.objects) - before
    MODEL, NATIVE_H = ['tree_camphor', 'tree_banyan', 'tree_luan', 'tree_palm', 'tree_tall'], [9.5, 8.5, 9.0, 9.8, 10.5]
    roots = {o.name.split('.')[0]: o for o in new if o.parent is None}
    for o in new:  # park the source models far below the map
        if o.parent is None: o.location = (o.location.x, o.location.y, -5000)
    for kind, name in enumerate(MODEL):
        if name not in roots: continue
        src = roots[name]
        col = bpy.data.collections.new('src_' + name)
        def gather(o):
            yield o
            for c in o.children: yield from gather(c)
        for o in gather(src):
            for c in list(o.users_collection): c.objects.unlink(o)
            col.objects.link(o)
        src.location = (0, 0, 0)
        spots = [s for s in TREES if (s[3] if s[3] < 5 else 0) == kind]
        if not spots: continue
        me = bpy.data.meshes.new('pts_' + name); me.vertices.add(len(spots))
        hr = [math.sin(i * 12.9898) * 43758.5453 % 1 for i in range(len(spots))]
        me.vertices.foreach_set('co', [c for (x, z, s, k, pk) in spots for c in (x, -z, dem(x + SX / 2, SY / 2 - z) - 0.2)])
        a = me.attributes.new('sc', 'FLOAT', 'POINT'); a.data.foreach_set('value', [s * 9 / NATIVE_H[kind] for (x, z, s, k, pk) in spots])
        r = me.attributes.new('yaw', 'FLOAT', 'POINT'); r.data.foreach_set('value', [h * 6.283 for h in hr])
        po = bpy.data.objects.new('trees_' + name, me); scn.collection.objects.link(po)
        ng = bpy.data.node_groups.new('inst_' + name, 'GeometryNodeTree')
        ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry'); ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        N = ng.nodes; gi_ = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
        iop = N.new('GeometryNodeInstanceOnPoints'); ci = N.new('GeometryNodeCollectionInfo'); ci.inputs['Collection'].default_value = col; ci.inputs['Separate Children'].default_value = False; ci.inputs['Reset Children'].default_value = True
        ci.transform_space = 'ORIGINAL'
        sa = N.new('GeometryNodeInputNamedAttribute'); sa.data_type = 'FLOAT'; sa.inputs['Name'].default_value = 'sc'
        ya = N.new('GeometryNodeInputNamedAttribute'); ya.data_type = 'FLOAT'; ya.inputs['Name'].default_value = 'yaw'
        cx = N.new('ShaderNodeCombineXYZ')
        L = ng.links.new
        L(gi_.outputs[0], iop.inputs['Points']); L(ci.outputs[0], iop.inputs['Instance']); L(sa.outputs['Attribute'], iop.inputs['Scale']); L(ya.outputs['Attribute'], cx.inputs['Z']); L(cx.outputs[0], iop.inputs['Rotation'])
        L(iop.outputs[0], go.inputs[0])
        mod = po.modifiers.new('inst', 'NODES'); mod.node_group = ng
        col.hide_render = False
    # the source collections are not linked to the scene, so only the instances render

# ---------------------------------------------------------------- far skyline impostors (data/skyline.json), at their true positions
SKYF = os.path.join(REPO, 'data', 'skyline.json')
if OPT.get('skyline', True) and os.path.exists(SKYF):
    K = json.load(open(SKYF)); cx, cy = K['centre']; A = round(360 / K['az_step']); RR = K['radii']; HZ = (0.6 * 0.95, 0.71 * 0.95, 0.83 * 0.95)
    bm = bmesh.new(); cl = bm.loops.layers.color.new('Col'); V = []
    def hazed(rgb, d): f = min(0.92, 1 - math.exp(-d * 0.00017 * 0.36)); return tuple(c * (1 - f) + hz * f for c, hz in zip(rgb, HZ)) + (1,)
    for i, r in enumerate(RR):
        for a_ in range(A):
            az = math.radians(a_ * K['az_step']); V.append(bm.verts.new((cx + r * math.sin(az) - SX / 2, cy + r * math.cos(az) - SY / 2, K['h'][i][a_])))
    ins = lambda v: abs(v.co.x) < SX / 2 - 50 and abs(v.co.y) < SY / 2 - 50
    for i in range(len(RR) - 1):
        for a_ in range(A):
            q = [V[i * A + a_], V[i * A + (a_ + 1) % A], V[(i + 1) * A + (a_ + 1) % A], V[(i + 1) * A + a_]]
            if all(ins(v) for v in q): continue
            f = bm.faces.new(q); h = max(v.co.z for v in q); base = (0.28, 0.27, 0.25) if h < 25 else (0.08, 0.13, 0.065) if h < 250 else (0.045, 0.075, 0.035)
            for l in f.loops: l[cl] = hazed(base, RR[i])
    for tw in K.get('towers', []):
        ring = tw['ring']; d = math.hypot(sum(p[0] for p in ring) / len(ring) - cx, sum(p[1] for p in ring) / len(ring) - cy)
        lo_ = [bm.verts.new((X - SX / 2, Y - SY / 2, tw['base'])) for X, Y in ring]; up = [bm.verts.new((X - SX / 2, Y - SY / 2, tw['base'] + tw['h'])) for X, Y in ring]
        fs = [bm.faces.new((lo_[k], lo_[(k + 1) % len(ring)], up[(k + 1) % len(ring)], up[k])) for k in range(len(ring))]
        try: fs.append(bm.faces.new(up))
        except ValueError: pass
        for f in fs:
            for l in f.loops: l[cl] = hazed((0.27, 0.31, 0.36), d)
    me = bpy.data.meshes.new('skyline'); bm.to_mesh(me); o = bpy.data.objects.new('skyline', me); scn.collection.objects.link(o)
    m = bpy.data.materials.new('skyline'); m.use_nodes = True; nt = m.node_tree; em = nt.nodes.new('ShaderNodeEmission'); vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs[0], nt.nodes['Material Output'].inputs['Surface']); me.materials.append(m)
    SKY_CLIP = 45000
else: SKY_CLIP = 1500

# ---------------------------------------------------------------- light and render settings
w = bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.62, 0.72, 0.85, 1); bg.inputs['Strength'].default_value = 0.9
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scn.collection.objects.link(sun); sun.data.energy = 3.2; sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(-35))
scn.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
try: scn.eevee.taa_render_samples = OPT.get('samples', 16)
except Exception: pass
scn.view_settings.view_transform = 'Standard'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam); scn.camera = cam
cam.data.lens_unit = 'FOV'; cam.data.clip_start = 0.3; cam.data.clip_end = SKY_CLIP; cam.data.sensor_fit = 'HORIZONTAL'
scn.render.image_settings.file_format = 'JPEG'; scn.render.image_settings.quality = 85

def surf_at(X, Y):
    """road surface under a point: the centreline's surface height when the point is on the carriageway, else the DEM"""
    bx, by = X - SX / 2, Y - SY / 2; k = nearest_k(bx, by)
    dx, dy = bx - t['x'][k], by + t['z'][k]; lat = dx * t['lx'][k] + dy * -t['lz'][k]; hw = t['hwL'][k] if lat > 0 else t['hwR'][k]
    d = math.hypot(dx, dy); on = d < hw + 0.5 and abs(lat) <= hw + 0.5
    if on: return t['surf'][k], k, True
    if d < hw + 4: return max(dem(X, Y), t['surf'][k]) + 0.17, k, False  # the game's sidewalk band
    return dem(X, Y), k, False

views = []
for p in poses:
    z0, k, on = surf_at(p['X'], p['Y'])
    scn.render.resolution_x, scn.render.resolution_y = p.get('w', 960), p.get('h', 540)
    cam.data.angle = math.radians(p.get('fov', FOV))
    cam.location = (p['X'] - SX / 2, p['Y'] - SY / 2, z0 + p.get('eye', EYE))
    cam.rotation_euler = (math.radians(90 + p.get('pitch', 0)), 0, -math.radians(p['heading']))
    f = os.path.join(OUT, f"{p['id']}.jpg"); scn.render.filepath = f; bpy.ops.render.render(write_still=True)
    views.append({**p, 'file': os.path.basename(f), 'k': p.get('k', k), 'road': t['rname'][k], 'on_track': on, 'cam_z': round(z0 + p.get('eye', EYE), 2), 's_m': round(k * t['ds'])})
json.dump({'views': views, 'tiles': files, 'eye': EYE, 'track': os.path.basename(TRACK)}, open(os.path.join(OUT, 'views.json'), 'w'), ensure_ascii=False, indent=1)
print('views done', len(views), 'tiles', len(files))
