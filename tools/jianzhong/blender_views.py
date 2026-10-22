"""Render Blender tiles for the corridor audit: a top-down orthographic image, and street-level views along the loop.

  blender -b --factory-startup --python tools/jianzhong/blender_views.py -- <repo> <track.json> <out dir> <mode> [options as JSON]

mode top:    {"bbox": [X0, Y0, X1, Y1], "ppm": 2}  -> <out>/top.png + top.json (data-frame bounds; transparent where empty)
mode street: {"every": 25, "w": 960, "h": 540}      -> <out>/s_<k>_<fwd|rev>.png, views from 1.3 m above the centreline
             (the driver's eye), looking along / against the direction of travel, plus <out>/street.json

The scene: the tiles the loop passes through (models/taipei/*.gltf, imported with their textures), the arcade columns
and scooters of <tile>.inst.json as simple boxes, a DEM ground and the carriageway (hwL / hwR) as a dark ribbon, so a
building standing in the road shows up. Signboards and other detail stay as exported. EEVEE, sun + sky light.
"""
import base64, bpy, bmesh, json, math, os, struct, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
REPO, TRACK, OUT, MODE = argv[:4]; OPT = json.loads(argv[4]) if len(argv) > 4 else {}
os.makedirs(OUT, exist_ok=True)
t = json.load(open(TRACK)); SX, SY = t['sx'], t['sz']
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

# ---- tiles near the loop
xs, zs = t['x'], t['z']; pad = OPT.get('pad', 160)
files = OPT.get('tiles') or [a['file'] for a in t['activeTiles'] if not (a['x1'] < min(xs) - pad or a['x0'] > max(xs) + pad or a['z1'] < min(zs) - pad or a['z0'] > max(zs) + pad)]
for f in files:
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, f))
    p = os.path.join(REPO, f[:-5] + '.inst.json')
    if os.path.exists(p):
        js = json.load(open(p)); ox, oy = js['x0'] - SX / 2, js['y0'] - SY / 2
        for kind, size, col in (('column', (0.55, 0.55, 6.0), (0.62, 0.6, 0.55)), ('scooter', (1.8, 0.65, 1.1), (0.75, 0.75, 0.78)), ('tank', (1.5, 1.5, 1.4), (0.8, 0.82, 0.85))):
            raw = base64.b64decode(js.get(kind, '') or b''); a = struct.unpack(f'<{len(raw) // 2}h', raw)
            if not a: continue
            bm = bmesh.new()
            for i in range(0, len(a), 4):
                cx, cy, z, yaw = ox + a[i] / 10, oy + a[i + 1] / 10, a[i + 2] / 10, -a[i + 3] / 10000
                g = bmesh.ops.create_cube(bm, size=1.0)['verts']
                for v in g:
                    x, y, zz = v.co.x * size[0], v.co.y * size[1], (v.co.z + 0.5) * size[2]
                    v.co = Vector((cx + x * math.cos(yaw) - y * math.sin(yaw), cy + x * math.sin(yaw) + y * math.cos(yaw), z + zz))
            me = bpy.data.meshes.new(kind); bm.to_mesh(me); o = bpy.data.objects.new(kind + '_inst', me); scn.collection.objects.link(o)
            m = bpy.data.materials.new(kind); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*col, 1); me.materials.append(m)

# ---- DEM ground and the carriageway
T = json.load(open(os.path.join(REPO, 'data', 'taipei.json'))); zr = base64.b64decode(T['z']); NX, NY, DD = T['nx'], T['ny'], T['d']
def dem(X, Y):
    fi = min(max(X / DD - 0.5, 0), NX - 1.001); fj = min(max(Y / DD - 0.5, 0), NY - 1.001); i, j = int(fi), int(fj); a_, b_ = fi - i, fj - j
    def z(ii, jj): o = jj * NX + ii; v = zr[2 * o] | (zr[2 * o + 1] << 8); return (v - 65536 if v > 32767 else v) / 100
    return z(i, j) * (1 - a_) * (1 - b_) + z(i + 1, j) * a_ * (1 - b_) + z(i, j + 1) * (1 - a_) * b_ + z(i + 1, j + 1) * a_ * b_
X0d, X1d = min(xs) + SX / 2 - 400, max(xs) + SX / 2 + 400; Y0d, Y1d = SY / 2 - max(zs) - 400, SY / 2 - min(zs) + 400
bm = bmesh.new(); step = 10; cols_ = int((X1d - X0d) / step) + 1; rows = int((Y1d - Y0d) / step) + 1
V = [[bm.verts.new((X0d + i * step - SX / 2, Y0d + j * step - SY / 2, dem(X0d + i * step, Y0d + j * step) - 0.15)) for i in range(cols_)] for j in range(rows)]
for j in range(rows - 1):
    for i in range(cols_ - 1): bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
me = bpy.data.meshes.new('ground'); bm.to_mesh(me); g = bpy.data.objects.new('ground', me); scn.collection.objects.link(g)
m = bpy.data.materials.new('ground'); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.33, 0.3, 1); me.materials.append(m)
n = t['n']; bm = bmesh.new(); L, R = [], []
for k in range(n):
    x, y = t['x'][k], -t['z'][k]; lx, ly = t['lx'][k], -t['lz'][k]; zz = t['surf'][k] + 0.03
    L.append(bm.verts.new((x + lx * t['hwL'][k], y + ly * t['hwL'][k], zz))); R.append(bm.verts.new((x - lx * t['hwR'][k], y - ly * t['hwR'][k], zz)))
for k in range(n): bm.faces.new((R[k], R[(k + 1) % n], L[(k + 1) % n], L[k]))
me = bpy.data.meshes.new('road'); bm.to_mesh(me); r = bpy.data.objects.new('road', me); scn.collection.objects.link(r)
m = bpy.data.materials.new('road'); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.06, 0.06, 0.065, 1); me.materials.append(m)
# kerb lines (white) at hwL / hwR so the carriageway edge reads in street views
for side, arr in ((1, 'hwL'), (-1, 'hwR')):
    bm = bmesh.new(); A = []; B2 = []
    for k in range(n):
        x, y = t['x'][k], -t['z'][k]; lx, ly = t['lx'][k] * side, -t['lz'][k] * side; w = t[arr][k]; zz = t['surf'][k] + 0.05
        A.append(bm.verts.new((x + lx * (w - 0.25), y + ly * (w - 0.25), zz))); B2.append(bm.verts.new((x + lx * w, y + ly * w, zz)))
    for k in range(n): bm.faces.new((A[k], A[(k + 1) % n], B2[(k + 1) % n], B2[k]))
    me = bpy.data.meshes.new('kerb'); bm.to_mesh(me); o = bpy.data.objects.new('kerb', me); scn.collection.objects.link(o)
    mm = bpy.data.materials.new('kerb'); mm.use_nodes = True; bs = mm.node_tree.nodes['Principled BSDF']; bs.inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1); me.materials.append(mm)

# ---- light and render settings
w = bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.62, 0.72, 0.85, 1); bg.inputs['Strength'].default_value = 0.9
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scn.collection.objects.link(sun); sun.data.energy = 3.2; sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(-35))
scn.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
try: scn.eevee.taa_render_samples = OPT.get('samples', 16)
except Exception: pass
scn.view_settings.view_transform = 'Standard'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam); scn.camera = cam

if MODE == 'top':
    X0, Y0, X1, Y1 = OPT['bbox']; ppm = OPT.get('ppm', 2)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(X1 - X0, Y1 - Y0); cam.location = ((X0 + X1) / 2 - SX / 2, (Y0 + Y1) / 2 - SY / 2, 400); cam.rotation_euler = (0, 0, 0)
    cam.data.clip_end = 1000
    scn.render.resolution_x = int((X1 - X0) * ppm); scn.render.resolution_y = int((Y1 - Y0) * ppm)
    if OPT.get('hide_ground'): g.hide_render = True; r.hide_render = True; [setattr(o, 'hide_render', True) for o in bpy.data.objects if o.name.startswith('kerb')]
    scn.render.film_transparent = bool(OPT.get('hide_ground'))
    scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'
    scn.render.filepath = os.path.join(OUT, OPT.get('name', 'top') + '.png'); bpy.ops.render.render(write_still=True)
    json.dump({'x0': X0, 'y0': Y0, 'x1': X1, 'y1': Y1, 'ppm': ppm, 'tiles': files}, open(os.path.join(OUT, OPT.get('name', 'top') + '.json'), 'w'))
else:
    every = OPT.get('every', 25); scn.render.resolution_x = OPT.get('w', 960); scn.render.resolution_y = OPT.get('h', 540)
    cam.data.lens_unit = 'FOV'; cam.data.angle = math.radians(OPT.get('fov', 80)); cam.data.clip_end = 1500
    scn.render.image_settings.file_format = 'JPEG'; scn.render.image_settings.quality = 82
    step = max(1, round(every / t['ds'])); shots = []
    ks = OPT.get('ks') or list(range(0, n, step))
    for k in ks:
        for dirn in OPT.get('dirs', ['fwd', 'rev']):
            x, y = t['x'][k], -t['z'][k]; tx, ty = -t['lz'][k], -t['lx'][k]  # travel direction in blender xy (left (lx,-lz) rotated -90°)
            if dirn == 'rev': tx, ty = -tx, -ty
            cam.location = (x, y, t['surf'][k] + 1.3)
            cam.rotation_euler = (math.radians(88), 0, math.atan2(ty, tx) - math.pi / 2)
            f = os.path.join(OUT, f's_{k:04d}_{dirn}.jpg'); scn.render.filepath = f; bpy.ops.render.render(write_still=True)
            shots.append({'k': k, 'dir': dirn, 'file': os.path.basename(f), 'road': t['rname'][k], 'data': [round(t['x'][k] + SX / 2, 1), round(SY / 2 - t['z'][k], 1)], 's_m': round(k * t['ds'])})
    json.dump({'shots': shots, 'tiles': files}, open(os.path.join(OUT, 'street.json'), 'w'), ensure_ascii=False, indent=1)
print('views done', MODE, len(files))
