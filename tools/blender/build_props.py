"""Street props for Terrain GP, modelled in Blender: five Taipei street-tree groups, a water-filled barrier (水馬),
a street lamp, a traffic-signal head and a parked scooter (機車). Exported as one glTF; each prop is a top-level node, origin at its base.
The trees come from tools/blender/trees/ (built by build_trees.py from TRELLIS.2 models) when those files exist;
otherwise the procedural ones below are used.

  blender -b --factory-startup --python tools/blender/build_props.py -- <out.gltf>

Props are drawn as instances, so materials are neutral where the game tints per instance (barrier red/white,
tree foliage) and colours come from vertex colours elsewhere.
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, noise

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
R = random.Random(3)

def mat(name, rgb=(1, 1, 1), rough=0.7, metal=0.0, emit=None, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in rgb], 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if vcol:
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Col'; nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    if emit: b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 2.0
    return m

def finish(bm, name, materials):
    me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
    for m in materials: me.materials.append(m)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); return o

def vcolor(bm):
    return bm.loops.layers.color.new('Col')

# ---------------- trees
BARK = mat('bark', (0.33, 0.27, 0.22), 0.9)
LEAF = mat('leaf', (1, 1, 1), 0.85, vcol=True)
def tree(name, crown_r, crown_h, trunk_h, lumps, palette, flowers=None, spread=1.0):
    bm = bmesh.new(); col = vcolor(bm)
    # trunk with a slight lean, and three main limbs into the crown
    lean = Vector((R.uniform(-0.15, 0.15), R.uniform(-0.15, 0.15), 0))
    def limb(a, b2, r0, r1, seg=6):
        d = (b2 - a); up = d.normalized(); side = up.cross(Vector((0, 0, 1)) if abs(up.z) < 0.9 else Vector((1, 0, 0))).normalized(); s2 = up.cross(side)
        ring = lambda c, r: [bm.verts.new(c + (side * math.cos(2 * math.pi * i / seg) + s2 * math.sin(2 * math.pi * i / seg)) * r) for i in range(seg)]
        r0v, r1v = ring(a, r0), ring(b2, r1)
        for i in range(seg):
            f = bm.faces.new((r0v[i], r0v[(i + 1) % seg], r1v[(i + 1) % seg], r1v[i])); f.material_index = 0
    top = Vector((0, 0, trunk_h)) + lean
    limb(Vector((0, 0, -0.3)), top, 0.26, 0.17)
    for k in range(3):
        a = 2 * math.pi * k / 3 + R.uniform(-0.3, 0.3)
        limb(top, top + Vector((math.cos(a) * crown_r * 0.45 * spread, math.sin(a) * crown_r * 0.45 * spread, crown_h * 0.45)), 0.15, 0.06, 5)
    # crown: lumpy icospheres, darker underneath, a few flower clusters
    centre = top + Vector((0, 0, crown_h * 0.45))
    for k in range(lumps):
        th = R.uniform(0, 2 * math.pi); rr = crown_r * spread * math.sqrt(R.uniform(0, 1)) * 0.75; zz = R.uniform(-0.35, 0.45) * crown_h
        c = centre + Vector((math.cos(th) * rr, math.sin(th) * rr, zz)); s = R.uniform(0.45, 0.62) * crown_r
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in res['verts']:
            n = v.co.copy(); lump = 1 + 0.22 * noise.noise(n * 2.3 + c)
            v.co = c + Vector((n.x * s * lump, n.y * s * lump, n.z * s * 0.82 * lump))
        faces = {f for v in res['verts'] for f in v.link_faces}
        base = Vector(palette[R.randrange(len(palette))])
        for f in faces:
            f.material_index = 1
            for l in f.loops:
                p = l.vert.co; shade = 0.62 + 0.38 * max(0.0, min(1.0, (p.z - (centre.z - crown_h * 0.5)) / crown_h)); jit = 1 + 0.12 * noise.noise(p * 1.7)
                cc = base * shade * jit
                if flowers and noise.noise(p * 0.9 + Vector((k, 0, 0))) > 0.18: cc = Vector(flowers[int(abs(noise.noise(p * 3.1)) * 10) % len(flowers)]) * (0.75 + 0.25 * shade)
                l[col] = (*[min(1.0, x) for x in cc], 1)
    return finish(bm, name, [BARK, LEAF])

camphor = tree('tree_camphor', 3.6, 6.0, 3.2, 9, [(0.20, 0.36, 0.14), (0.24, 0.40, 0.16), (0.18, 0.32, 0.12)])
banyan = tree('tree_banyan', 4.6, 5.0, 2.8, 11, [(0.16, 0.32, 0.12), (0.20, 0.35, 0.14)], spread=1.15)
luan = tree('tree_luan', 3.2, 5.4, 3.4, 8, [(0.26, 0.42, 0.16), (0.30, 0.44, 0.18)], flowers=[(0.86, 0.70, 0.12), (0.80, 0.42, 0.30), (0.74, 0.36, 0.28)])
# tall narrow crown (楓香, 黑板樹, 小葉欖仁, 白千層, pines): stacked lumps tapering upward
def tall_tree(name):
    bm = bmesh.new(); col = vcolor(bm); seg = 6
    r0 = [bm.verts.new((math.cos(2 * math.pi * i / seg) * 0.22, math.sin(2 * math.pi * i / seg) * 0.22, -0.3)) for i in range(seg)]
    r1 = [bm.verts.new((math.cos(2 * math.pi * i / seg) * 0.1, math.sin(2 * math.pi * i / seg) * 0.1, 9.0)) for i in range(seg)]
    for i in range(seg): bm.faces.new((r0[i], r0[(i + 1) % seg], r1[(i + 1) % seg], r1[i])).material_index = 0
    for k in range(6):
        z = 3.0 + k * 1.15; s = 2.2 * (1 - k / 7.5)
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0); base = Vector((0.17, 0.33, 0.13)) * (0.9 + 0.1 * k / 6)
        for v in res['verts']:
            n = v.co.copy(); lump = 1 + 0.2 * noise.noise(n * 2.1 + Vector((0, 0, k)))
            v.co = Vector((n.x * s * lump, n.y * s * lump, z + n.z * s * 0.7 * lump))
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = 1
            for l in f.loops: sh = 0.65 + 0.35 * max(0.0, min(1.0, (l.vert.co.z - 2.5) / 8)); l[col] = (*[min(1.0, c * sh) for c in base], 1)
    return finish(bm, name, [BARK, LEAF])
# palm (大王椰子, 蒲葵, 海棗): smooth grey trunk, crown of drooping fronds
def palm(name):
    bm = bmesh.new(); col = vcolor(bm); seg = 8; H = 9.5
    rings = [[bm.verts.new((math.cos(2 * math.pi * i / seg) * r, math.sin(2 * math.pi * i / seg) * r, z)) for i in range(seg)] for z, r in ((-0.3, 0.32), (1.0, 0.3), (5.0, 0.24), (H - 0.6, 0.22), (H, 0.28))]
    for a, b2 in zip(rings, rings[1:]):
        for i in range(seg): bm.faces.new((a[i], a[(i + 1) % seg], b2[(i + 1) % seg], b2[i])).material_index = 0
    for k in range(12):  # fronds: a bent strip of quads, wider in the middle
        ang = 2 * math.pi * k / 12 + R.uniform(-0.15, 0.15); dx, dy = math.cos(ang), math.sin(ang); px, py = -dy, dx
        pts = []
        for j in range(7):
            t = j / 6; reach = 4.2 * t; droop = 1.6 * t * t - 0.8 * t; w = 0.55 * math.sin(math.pi * min(1, t * 1.1 + 0.05))
            c = Vector((dx * reach, dy * reach, H + 0.2 - droop * 1.6)); pts.append((c + Vector((px, py, 0)) * w, c - Vector((px, py, 0)) * w))
        for j in range(6):
            f = bm.faces.new((bm.verts.new(pts[j][0]), bm.verts.new(pts[j + 1][0]), bm.verts.new(pts[j + 1][1]), bm.verts.new(pts[j][1]))); f.material_index = 1
            for l in f.loops: l[col] = (0.20, 0.38 + 0.05 * (k % 3), 0.12, 1)
    return finish(bm, name, [mat('palm_trunk', (0.62, 0.6, 0.55), 0.8), LEAF])
tall = tall_tree('tree_tall'); palmt = palm('tree_palm')
TREE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trees')
def textured_tree(name):  # the TRELLIS.2-derived model replaces the procedural stand-in of the same name
    f = os.path.join(TREE_DIR, name + '.glb')
    if not os.path.exists(f): return None
    old = bpy.data.objects[name]; bpy.data.objects.remove(old)
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=f)
    o = next(x for x in bpy.data.objects if x not in before and x.type == 'MESH'); o.parent = None; o.name = name; return o
camphor, banyan, luan, tall, palmt = [textured_tree(n) or o for n, o in (('tree_camphor', camphor), ('tree_banyan', banyan), ('tree_luan', luan), ('tree_tall', tall), ('tree_palm', palmt))]

# ---------------- 水馬: hollow plastic water barrier, 1.2 m long, waisted profile, fill cap and forklift slots
SHELL = mat('barrier_shell', (1, 1, 1), 0.5)
DARK = mat('barrier_slot', (0.12, 0.12, 0.12), 0.8)
def water_barrier():
    bm = bmesh.new()
    prof = [(-0.23, 0.0), (0.23, 0.0), (0.22, 0.18), (0.15, 0.32), (0.15, 0.55), (0.11, 0.78), (0.0, 0.8), (-0.11, 0.78), (-0.15, 0.55), (-0.15, 0.32), (-0.22, 0.18)]
    L = 0.6
    a = [bm.verts.new((-L, y, z)) for y, z in prof]; b2 = [bm.verts.new((L, y, z)) for y, z in prof]
    n = len(prof)
    for i in range(n):
        f = bm.faces.new((a[i], a[(i + 1) % n], b2[(i + 1) % n], b2[i])); f.material_index = 0
    fa = bm.faces.new(a[::-1]); fa.material_index = 0; fb = bm.faces.new(b2); fb.material_index = 0
    # interlocking lugs at the ends, the fill cap on top, two forklift slots in the base
    for x in (-L - 0.06, L + 0.06):
        r = bmesh.ops.create_cube(bm, size=1.0); [setattr(v, 'co', Vector((x + v.co.x * 0.12, v.co.y * 0.16, 0.5 + v.co.z * 0.5))) for v in r['verts']]
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.07, radius2=0.07, depth=0.05); [setattr(v, 'co', v.co + Vector((0.25, 0, 0.82))) for v in r['verts']]
    for x in (-0.3, 0.3):
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']: v.co = Vector((x + v.co.x * 0.22, v.co.y * 0.48, 0.07 + v.co.z * 0.1))
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 1
    return finish(bm, 'water_barrier', [SHELL, DARK])
barrier = water_barrier()

# ---------------- street lamp: tapered grey pole, curved single arm, flat LED head (local +x points over the road)
POLE = mat('lamp_pole', (0.55, 0.57, 0.58), 0.45, 0.7)
LED = mat('lamp_led', (0.95, 0.95, 0.9), 0.3, emit=(1.0, 0.97, 0.88))
def street_lamp():
    bm = bmesh.new()
    seg = 8
    def tube(pts, r0, r1):
        rings = []
        for i, p in enumerate(pts):
            t = i / (len(pts) - 1); r = r0 + (r1 - r0) * t
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized(); side = d.cross(Vector((0, 1, 0))).normalized(); s2 = d.cross(side)
            rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / seg) + s2 * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
        for a, b2 in zip(rings, rings[1:]):
            for k in range(seg): bm.faces.new((a[k], a[(k + 1) % seg], b2[(k + 1) % seg], b2[k])).material_index = 0
    tube([Vector((0, 0, z)) for z in (0, 4, 8.6)], 0.12, 0.07)
    arm = [Vector((0, 0, 8.6))] + [Vector((math.sin(a) * 1.4, 0, 8.6 + (1 - math.cos(a)) * -0.2 + math.sin(a) * 0.6)) for a in (0.4, 0.8, 1.2, 1.57)]
    tube(arm, 0.07, 0.05)
    end = arm[-1]
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']: v.co = end + Vector((0.45 + v.co.x * 0.9, v.co.y * 0.32, -0.08 + v.co.z * 0.14))
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']: v.co = end + Vector((0.45 + v.co.x * 0.8, v.co.y * 0.26, -0.16 + v.co.z * 0.02))
    for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 1
    return finish(bm, 'street_lamp', [POLE, LED])
lamp = street_lamp()

# ---------------- traffic-signal head: horizontal three-lamp housing with visors and a backplate (faces -y)
HOUSE = mat('signal_house', (0.12, 0.13, 0.14), 0.6)
LENS = mat('signal_lens', (1, 1, 1), 0.2)  # lamp colours come from the game per instance
def signal_head():
    bm = bmesh.new()
    def box(c, s, mi):
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']: v.co = Vector((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + v.co.z * s[2]))
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = mi
    box((0, 0.05, 0), (1.5, 0.04, 0.55), 0)   # backplate
    box((0, 0, 0), (1.25, 0.3, 0.4), 0)       # housing
    for i, x in enumerate((-0.4, 0.0, 0.4)):
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.13, radius2=0.13, depth=0.02)
        for v in r['verts']: v.co = Vector((x + v.co.x, -0.16, v.co.y)) if True else v.co
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 1
        # visor: half tube over the lens
        seg = 6; ring0 = []; ring1 = []
        for k in range(seg + 1):
            a = math.pi * k / seg
            ring0.append(bm.verts.new((x + math.cos(a) * 0.16, -0.16, math.sin(a) * 0.16))); ring1.append(bm.verts.new((x + math.cos(a) * 0.16, -0.42, math.sin(a) * 0.16)))
        for k in range(seg): bm.faces.new((ring0[k], ring1[k], ring1[k + 1], ring0[k + 1])).material_index = 0
    return finish(bm, 'signal_head', [HOUSE, LENS])
signal = signal_head()

# ---------------- 機車: a step-through scooter as parked in rows under Taipei arcades; ~1.8 m long along local +x,
# body panels white so the game can tint each instance, seat, tyres and bars dark
BODY = mat('scooter_body', (1, 1, 1), 0.35)
TRIM = mat('scooter_trim', (0.08, 0.08, 0.09), 0.7)
LAMP = mat('scooter_lamp', (0.95, 0.95, 0.9), 0.2, emit=(0.9, 0.9, 0.85))
def scooter():
    bm = bmesh.new()
    def block(c, s, mi, taper=None):  # box centred at c with size s; taper scales the top face in y
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']:
            k = (taper if (taper and v.co.z > 0) else 1.0)
            v.co = Vector((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1] * k, c[2] + v.co.z * s[2]))
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = mi
    def wheel(x):
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.24, radius2=0.24, depth=0.12)
        for v in r['verts']: v.co = Vector((x + v.co.x, v.co.z, 0.24 + v.co.y))
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 1
    wheel(0.62); wheel(-0.6)
    block((0.0, 0, 0.32), (0.75, 0.32, 0.12), 0)          # floorboard
    block((0.58, 0, 0.62), (0.16, 0.42, 0.75), 0, 0.75)    # leg shield / front apron
    block((-0.42, 0, 0.55), (0.75, 0.38, 0.42), 0, 0.85)   # rear body over the engine
    block((-0.4, 0, 0.82), (0.7, 0.3, 0.1), 1)             # seat
    block((0.66, 0, 1.02), (0.08, 0.08, 0.36), 1)          # steering column
    block((0.66, 0, 1.18), (0.1, 0.68, 0.05), 1)           # handlebar
    block((0.72, 0, 1.06), (0.1, 0.22, 0.14), 0)           # headlight housing
    block((0.775, 0, 1.06), (0.01, 0.16, 0.08), 2)         # headlight
    block((-0.81, 0, 0.66), (0.02, 0.24, 0.07), 2)         # tail light
    block((0.62, 0, 0.5), (0.3, 0.1, 0.06), 0)             # front mudguard
    return finish(bm, 'scooter', [BODY, TRIM, LAMP])
scoot = scooter()

objs = [camphor, banyan, luan, tall, palmt, barrier, lamp, signal, scoot]
for i, o in enumerate(objs): o.location = (i * 12, 0, 0)  # spread out for previews; the game ignores node offsets
for o in objs: print(o.name, len(o.data.polygons), 'faces')
bpy.ops.object.select_all(action='SELECT')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLTF_SEPARATE', use_selection=True, export_yup=True, export_apply=True,
                          export_vertex_color='ACTIVE', export_image_format='WEBP', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=8)
print('wrote', OUT)
