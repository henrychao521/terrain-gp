"""Build one Taipei scenery tile in Blender and export it as glTF for Terrain GP.

  blender -b --factory-startup --python tools/blender/build_tile.py -- <data dir> <texture dir> X0 X1 Y0 Y1 <out.gltf>

Exports glTF with external textures in tex/ next to the file, so every tile shares one copy of each texture.
Repeated small parts (window cages, AC units, arcade columns, rooftop tanks) are not modelled per copy: their
positions go to <out>.inst.json (int16 decimetres from the tile corner, yaw in 1e-4 rad, base64) and the game draws
them as instanced meshes. Signboards stay in the glTF and carry the node extra "detail" so distant tiles hide them.

X/Y: metres east / north of TWD97 E 299000 / N 2766400 (the frame of data/taipei.json).
Blender axes: x east, y north, z up, origin at the map centre; glTF export turns that into the game's world frame.
"""
import bpy, bmesh, json, math, base64, random, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
DATA, TEX, X0, X1, Y0, Y1, OUT = argv[0], argv[1], *map(float, argv[2:6]), argv[6]
T = json.load(open(f'{DATA}/taipei.json')); O = json.load(open(f'{DATA}/taipei_osm.json'))
SX, SY = T['nx'] * T['d'], T['ny'] * T['d']
R = random.Random(5)
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- terrain height (same DEM the game uses)
zr = base64.b64decode(T['z']); NX, NY, DD = T['nx'], T['ny'], T['d']
def dem(X, Y):
    fi = min(max(X / DD - 0.5, 0), NX - 1.001); fj = min(max(Y / DD - 0.5, 0), NY - 1.001); i, j = int(fi), int(fj); a, b = fi - i, fj - j
    def z(ii, jj): o = jj * NX + ii; v = zr[2 * o] | (zr[2 * o + 1] << 8); return (v - 65536 if v > 32767 else v) / 100
    return z(i, j) * (1 - a) * (1 - b) + z(i + 1, j) * a * (1 - b) + z(i, j + 1) * (1 - a) * b + z(i + 1, j + 1) * a * b
B = lambda X, Y: (X - SX / 2, Y - SY / 2)  # data -> blender xy
inside = lambda X, Y: X0 <= X <= X1 and Y0 <= Y <= Y1

# ---------- materials
AI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai_textures')
def img_mat(name, file, rough=0.8, emit=0.0, metal=0.0, path=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(path or f'{TEX}/{file}.png'); tex.extension = 'REPEAT'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    npath = os.path.join(AI_DIR, 'normals', name + '_n.jpg') if path else f'{TEX}/{file}_n.png'  # AI textures keep theirs in ai_textures/normals
    if npath and os.path.exists(npath):  # Marigold normal map computed on Colab
        nimg = nt.nodes.new('ShaderNodeTexImage'); nimg.image = bpy.data.images.load(npath); nimg.image.colorspace_settings.name = 'Non-Color'; nimg.extension = 'REPEAT'
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.8
        nt.links.new(nimg.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if emit: nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = emit
    return m
def col_mat(name, rgb, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in rgb], 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal; return m
MAT = {k: img_mat(k, k) for k in ('facade_mosaic_cream', 'facade_mosaic_pink', 'facade_mosaic_grey', 'facade_concrete', 'roof')}
MAT['facade_glass'] = img_mat('facade_glass', 'facade_glass', rough=0.15, metal=0.3)
# AI-generated facades and roofs (tools/blender/ai_textures, SDXL on Colab) replace the drawn ones when present
AI = {f[:-4]: os.path.join(AI_DIR, f) for f in sorted(os.listdir(AI_DIR)) if f.endswith('.jpg') and f.startswith(('facade_ai_', 'roof_ai_'))} if os.path.isdir(AI_DIR) else {}
for k, v in AI.items(): MAT[k] = img_mat(k, k, path=v, rough=0.9 if k.startswith('roof') else 0.8)
AI_FOR = {'facade_mosaic_cream': 'facade_ai_cream', 'facade_mosaic_pink': 'facade_ai_pink', 'facade_mosaic_grey': 'facade_ai_grey', 'facade_concrete': 'facade_ai_concrete'}
AI_GROUPS = {  # walk-ups up to 24 m, mid-rise to 42 m, towers above; red brick only now and then on low old buildings
    'res': ['cream', 'pink', 'grey', 'blue_green_tile', 'green_tile_apts', 'yellow_tile_apts', 'brown_brick_tile', 'white_tile_apts', 'grey_wash'],
    'old': ['concrete', 'old_concrete_balcony'], 'mid': ['condo_1990s', 'hotel_tiles', 'shophouse_arcade', 'school_corridor', 'concrete'],
    'high': ['glass_office_v2', 'stone_office'], 'brick': ['red_brick_old']}
def ai_facade(h, hsh):
    grp = 'high' if h > 42 else 'mid' if h > 24 else ('brick' if h < 15 and hsh % 23 == 0 else 'old' if hsh % 7 == 0 else 'res')
    names = [n for n in AI_GROUPS[grp] if 'facade_ai_' + n in MAT]
    if grp == 'high' and hsh % 3 == 0: return 'facade_glass'  # keep some of the drawn glass towers for variety
    return 'facade_ai_' + names[(hsh // 7) % len(names)] if names else None
FACADE_REPEAT = lambda mat: (12.0, 12.8) if mat.startswith('facade_ai') else (6.0, 6.4)  # metres covered by one texture tile
MAT['storefront'] = img_mat('storefront', 'storefront', emit=0.35)
MAT['signboards'] = img_mat('signboards', 'signboards', rough=0.4, emit=0.8)
MAT['signs_h'] = img_mat('signs_h', 'signs_h', rough=0.4, emit=0.6)
SHOP_AI = sorted(f[:-4] for f in os.listdir(TEX) if f.startswith('storefront_ai_') and f.endswith('.png') and not f.endswith('_n.png'))  # make_textures.py composites
for k in SHOP_AI: MAT[k] = img_mat(k, k, emit=0.25)
for k in ('roof_concrete_a', 'roof_concrete_b', 'roof_concrete_c', 'roof_metal_red', 'roof_metal_blue', 'roof_metal_green', 'roof_metal_grey', 'roof_solar', 'tile_green', 'tile_slate'):
    if os.path.exists(f'{TEX}/{k}.png'): MAT[k] = img_mat(k, k, rough=0.35 if k.startswith('tile') else 0.6 if 'metal' in k or 'solar' in k else 0.9, metal=0.4 if 'metal' in k else 0.0)
MAT['tile_blue'] = img_mat('tile_blue', 'tile_blue', rough=0.3); MAT['tile_gold'] = img_mat('tile_gold', 'tile_gold', rough=0.3); MAT['tile_orange'] = img_mat('tile_orange', 'tile_orange', rough=0.35)
for k, rgb, r, mt in [('cage', (0.55, 0.56, 0.55), 0.5, 0.6), ('ac', (0.86, 0.86, 0.83), 0.6, 0), ('ceiling', (0.62, 0.6, 0.56), 0.9, 0), ('column', (0.7, 0.68, 0.63), 0.8, 0),
                      ('tank', (0.82, 0.84, 0.86), 0.3, 0.8), ('marble', (0.93, 0.92, 0.89), 0.35, 0), ('stone', (0.62, 0.58, 0.52), 0.85, 0), ('lacquer', (0.56, 0.1, 0.08), 0.45, 0),
                      ('gold', (0.85, 0.65, 0.2), 0.3, 0.8), ('dark', (0.08, 0.07, 0.06), 0.9, 0), ('stairs', (0.85, 0.84, 0.8), 0.6, 0), ('lattice', (0.42, 0.12, 0.08), 0.6, 0),
                      ('deck', (0.33, 0.33, 0.34), 0.85, 0), ('concrete', (0.72, 0.71, 0.68), 0.8, 0)]:
    MAT[k] = col_mat(k, rgb, r, mt)

# ---------- mesh builder: one bmesh per material keeps the export to one primitive per material
DETAIL = {'signboards', 'signs_h'}
INST = {'cage': [], 'ac': [], 'column': [], 'tank': [], 'scooter': []}
def inst(kind, bx, by, z, yaw):  # blender coords -> int16 decimetres from the tile's south-west corner
    ox, oy = B(X0, Y0); INST[kind].extend((round((bx - ox) * 10), round((by - oy) * 10), round(z * 10), round(((yaw + math.pi) % (2 * math.pi) - math.pi) * 10000)))
WALL_FACES = (0, 1, 3, 5)  # box faces kept for things fixed to a wall: the two ends, the front and the underside
class Builder:
    def __init__(self): self.bm = {}; self.uv = {}
    def _b(self, mat):
        if mat not in self.bm: b = bmesh.new(); self.bm[mat] = b; self.uv[mat] = b.loops.layers.uv.new('UVMap')
        return self.bm[mat]
    def face(self, mat, pts, uvs=None):
        b = self._b(mat); vs = [b.verts.new(p) for p in pts]
        try: f = b.faces.new(vs)
        except ValueError: return
        if uvs:
            for l, uv in zip(f.loops, uvs): l[self.uv[mat]].uv = uv
    def quad(self, mat, a, b2, c, d, uvs=None): self.face(mat, [a, b2, c, d], uvs)
    def box(self, mat, cx, cy, cz, sx, sy, sz, yaw=0.0, uvscale=1.0, faces=None):
        c, s = math.cos(yaw), math.sin(yaw)
        P = lambda x, y, z: (cx + x * c - y * s, cy + x * s + y * c, cz + z)
        hx, hy = sx / 2, sy / 2; v = [P(-hx, -hy, 0), P(hx, -hy, 0), P(hx, hy, 0), P(-hx, hy, 0), P(-hx, -hy, sz), P(hx, -hy, sz), P(hx, hy, sz), P(-hx, hy, sz)]
        for fi, f in enumerate(((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0))):
            if faces is None or fi in faces: self.face(mat, [v[i] for i in f], [(0, 0), (uvscale, 0), (uvscale, uvscale), (0, uvscale)])
    def cyl(self, mat, cx, cy, z0, r, h, seg=10, r2=None):
        r2 = r if r2 is None else r2
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            self.quad(mat, (cx + r * math.cos(a0), cy + r * math.sin(a0), z0), (cx + r * math.cos(a1), cy + r * math.sin(a1), z0), (cx + r2 * math.cos(a1), cy + r2 * math.sin(a1), z0 + h), (cx + r2 * math.cos(a0), cy + r2 * math.sin(a0), z0 + h), [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1)])
        self.face(mat, [(cx + r2 * math.cos(2 * math.pi * i / seg), cy + r2 * math.sin(2 * math.pi * i / seg), z0 + h) for i in range(seg)])
    def to_object(self, name):
        objs = []
        for mat, b in self.bm.items():
            m = bpy.data.meshes.new(f'{name}_{mat}'); b.normal_update(); b.to_mesh(m); m.materials.append(MAT[mat])
            o = bpy.data.objects.new(f'{name}_{mat}', m); bpy.context.scene.collection.objects.link(o); objs.append(o)
            if mat in DETAIL: o['detail'] = 1
        return objs

def ccw(ring):
    a = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    return ring if a > 0 else ring[::-1]
def offset_ring(ring, offs):
    """Move each edge i (ring[i] -> ring[i+1]) inward by offs[i]; vertices go to the intersection of neighbouring offset edges."""
    n = len(ring); out = []
    for i in range(n):
        p, q, r = Vector(ring[i - 1]), Vector(ring[i]), Vector(ring[(i + 1) % n])
        d0 = (q - p).normalized(); d1 = (r - q).normalized(); n0 = Vector((-d0.y, d0.x)); n1 = Vector((-d1.y, d1.x))
        a0 = p + n0 * offs[i - 1]; a1 = q + n1 * offs[i]; den = d0.x * d1.y - d0.y * d1.x
        if abs(den) < 1e-3: out.append(tuple(q + n1 * offs[i])); continue
        t = ((a1.x - a0.x) * d1.y - (a1.y - a0.y) * d1.x) / den; pt = a0 + d0 * t
        out.append(tuple(pt) if (pt - q).length < 8 else tuple(q + n1 * offs[i]))
    return out

# ---------- streets near an edge (for arcades, signs and cages)
road_segs = []
for r in O['roads']:
    if r[5] > 0: continue
    p = [(r[6 + 2 * i] / 10, r[7 + 2 * i] / 10) for i in range((len(r) - 6) // 2)]
    for a, b in zip(p, p[1:]):
        if X0 - 60 <= (a[0] + b[0]) / 2 <= X1 + 60 and Y0 - 60 <= (a[1] + b[1]) / 2 <= Y1 + 60: road_segs.append((a, b, r[4] / 10, r[0]))
def clear_roads(ring):
    """Push footprint corners out of every carriageway (the 3D-model footprints and OSM roads don't line up exactly,
    and the game's track uses at least 3.6 m half width). Returns None when the building itself stands in a road."""
    out = [list(p) for p in ring]
    cx0 = sum(p[0] for p in ring) / len(ring); cy0 = sum(p[1] for p in ring) / len(ring)
    for _ in range(2):
        for v in out:
            for (ax, ay), (bx, by), w, c in road_segs:
                if c > 5: continue
                dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1; f = min(1, max(0, ((v[0] - ax) * dx + (v[1] - ay) * dy) / l2))
                px, py = ax + dx * f, ay + dy * f; d = math.hypot(v[0] - px, v[1] - py); half = max(w / 2, 3.6) + 0.6
                if d < half:
                    # push toward the side of the street the building stands on: a corner past the centreline used to be
                    # pushed to the far kerb, stretching the building across the road (南海路, tpe3d 2410)
                    ln = math.sqrt(l2); nx_, ny_ = -dy / ln, dx / ln
                    sd = 1 if (cx0 - ax) * nx_ + (cy0 - ay) * ny_ >= 0 else -1
                    if 0 < f < 1 or d < 1e-3: v[0] = px + nx_ * sd * half; v[1] = py + ny_ * sd * half
                    else: v[0] = px + (v[0] - px) / d * half; v[1] = py + (v[1] - py) / d * half
    gx = sum(p[0] for p in out) / len(out); gy = sum(p[1] for p in out) / len(out)
    return None if street_dist(gx, gy) < 0 else [tuple(p) for p in out]
def street_dist(X, Y):
    best = 1e9
    for (ax, ay), (bx, by), w, c in road_segs:
        dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1; f = min(1, max(0, ((X - ax) * dx + (Y - ay) * dy) / l2))
        best = min(best, math.hypot(X - ax - dx * f, Y - ay - dy * f) - w / 2)
    return best

# ---------- landmarks first, so ordinary buildings inside them are skipped
_groups = {}
for i, l in enumerate(O['landmarks']): _groups.setdefault(l['n'] or f'#{i}', []).append(l)
LM = []
for g in _groups.values():  # a landmark goes to the one tile that holds the centroid of all its parts
    xs = [l['p'][2 * i] / 10 for l in g for i in range(len(l['p']) // 2)]; ys = [l['p'][2 * i + 1] / 10 for l in g for i in range(len(l['p']) // 2)]
    if inside(sum(xs) / len(xs), sum(ys) / len(ys)): LM.extend(g)
def ring_of(p): return ccw([(p[2 * i] / 10, p[2 * i + 1] / 10) for i in range(len(p) // 2)])
def pip(x, y, r):
    c = False
    for i in range(len(r)):
        (x1, y1), (x2, y2) = r[i - 1], r[i]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1): c = not c
    return c
lm_rings = [ring_of(l['p']) for l in LM]

def obb(ring):
    """Oriented box of a footprint: centre, half length, half width, angle of the long side."""
    best = None
    for i in range(len(ring)):
        (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % len(ring)]; ang = math.atan2(y1 - y0, x1 - x0); c, s = math.cos(-ang), math.sin(-ang)
        xs = [x * c - y * s for x, y in ring]; ys = [x * s + y * c for x, y in ring]; area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if best is None or area < best[0]:
            mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2; ci, si = math.cos(ang), math.sin(ang)
            best = (area, (mx * ci - my * si, mx * si + my * ci), (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2, ang)
    _, ctr, hl, hw, ang = best
    if hw > hl: hl, hw, ang = hw, hl, ang + math.pi / 2
    return ctr, hl, hw, ang

def chinese_roof(bld, mat, cx, cy, ang, hl, hw, z0, H, hip=True, lift=0.8, poly=None, steps=7, ridge_mat='gold'):
    """Curved roof with upturned corners. Rectangle (hip roof with a ridge when hip) or, with poly, a pyramidal roof over a polygon."""
    c, s = math.cos(ang), math.sin(ang)
    rings = []
    for k in range(steps + 1):
        t = k / steps; z = z0 + H * t ** 1.6
        if poly:
            ring = [(cx + (x - cx) * (1 - t), cy + (y - cy) * (1 - t)) for x, y in poly] if k < steps else [(cx, cy)] * len(poly)
        else:
            a, b = hl - t * (hw if hip else 0), hw * (1 - t) if k < steps else 0.01
            loc = [(-a, -b), (a, -b), (a, b), (-a, b)]; ring = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in loc]
        # subdivide edges and lift the corners (the corner rises, the middle of the eave stays low)
        pts = []
        n = len(ring)
        for i in range(n):
            p, q = ring[i], ring[(i + 1) % n]
            for j in range(4):
                f = j / 4; corner = (1 - min(f, 1 - f) * 2) ** 3; lz = lift * (1 - t) ** 2 * corner
                pts.append((p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, z + lz))
        rings.append(pts)
    m = len(rings[0])
    for k in range(steps):
        for i in range(m):
            a, b2 = rings[k][i], rings[k][(i + 1) % m]; cc, d = rings[k + 1][(i + 1) % m], rings[k + 1][i]
            bld.quad(mat, a, b2, cc, d, [(i / 4, k / steps * 3), ((i + 1) / 4, k / steps * 3), ((i + 1) / 4, (k + 1) / steps * 3), (i / 4, (k + 1) / steps * 3)])
    # underside of the eave so the roof reads from below
    bld.face('lattice', [p for p in rings[0]][::-1])
    if not poly and hip:  # ridge beam
        a = hl - hw; bld.box(ridge_mat, cx, cy, z0 + H - 0.1, 2 * a + 0.6, 0.5, 0.6, ang)

def platform(bld, ring, z0, h, mat='stone'):
    n = len(ring)
    for i in range(n):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
        bld.quad(mat, (*B(ax, ay), z0), (*B(bx, by), z0), (*B(bx, by), z0 + h), (*B(ax, ay), z0 + h), [(0, 0), (L / 4, 0), (L / 4, h / 4), (0, h / 4)])
    bld.face(mat, [(*B(x, y), z0 + h) for x, y in ring])

def colonnade(bld, ctr, hl, hw, ang, z0, h, inset, spacing=4.5, r=0.45):
    c, s = math.cos(ang), math.sin(ang); a, b = hl - inset, hw - inset
    for sx, sy, L in ((1, 0, a), (0, 1, b)):
        nn = max(2, int(2 * L / spacing))
        for i in range(nn + 1):
            t = -L + 2 * L * i / nn
            for sgn in (-1, 1):
                x, y = (t, sgn * b) if sx else (sgn * a, t)
                bld.cyl('lacquer', ctr[0] + x * c - y * s, ctr[1] + x * s + y * c, z0, r, h, 10)

GATE_CUTS = []
def cut_gate_passages(objs):
    # boolean the arched passage (box + half cylinder) out of the stone platform
    stone = [o for o in objs if o.name.endswith('_stone')]
    if not stone or not GATE_CUTS: return
    for (cx, cy), hw, ang, z0 in GATE_CUTS:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, z0 + 1.6)); box = bpy.context.active_object; box.scale = (hw * 2 + 4, 4.0, 3.2); box.rotation_euler = (0, 0, ang)
        bpy.ops.mesh.primitive_cylinder_add(radius=2.0, depth=hw * 2 + 4, location=(cx, cy, z0 + 3.2), rotation=(0, math.pi / 2, ang)); cyl = bpy.context.active_object
        for cutter in (box, cyl):
            for o in stone:
                m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cutter; m.solver = 'EXACT'
                bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='cut')
            bpy.data.objects.remove(cutter)
def build_landmarks():
    bld = Builder(); done = set()
    by_name = {}
    for l, r in zip(LM, lm_rings): by_name.setdefault(l['n'], []).append((l, r))
    for name, items in by_name.items():
        z0 = min(dem(x, y) for _, r in items for x, y in r) - 0.3
        if name == '臺北府城東門' or name in ('臺北府城南門', '臺北府城小南門'):
            ring = items[0][1]; (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy)
            platform(bld, ring, z0, 6.0)
            GATE_CUTS.append((cb, hw, ang + math.pi / 2, z0))  # arched passage through the short side
            # pavilion: red columns, lattice walls, double eaves
            colonnade(bld, cb, hl * 0.78, hw * 0.78, ang, z0 + 6, 4.2, 0.6, spacing=3.2, r=0.32)
            c, s = math.cos(ang), math.sin(ang)
            bld.box('lattice', cb[0], cb[1], z0 + 6, hl * 1.3, hw * 1.3, 4.0, ang)
            chinese_roof(bld, 'tile_orange', cb[0], cb[1], ang, hl * 0.95 + 1.0, hw * 0.95 + 1.0, z0 + 10.0, 1.2, hip=True, lift=0.9, steps=3)
            bld.box('lattice', cb[0], cb[1], z0 + 10.6, hl * 1.2, hw * 1.2, 1.6, ang)
            chinese_roof(bld, 'tile_orange', cb[0], cb[1], ang, hl * 0.85 + 0.8, hw * 0.85 + 0.8, z0 + 12.0, 3.4, hip=True, lift=1.0)
            done.add(name); continue
        if name == '中正紀念堂':
            parts = sorted(items, key=lambda it: it[0]['mh'])
            base = max(parts, key=lambda it: len(it[1]) and abs(sum(it[1][i][0] * it[1][(i + 1) % len(it[1])][1] - it[1][(i + 1) % len(it[1])][0] * it[1][i][1] for i in range(len(it[1])))))[1]
            # three-tier white platform with the main stair on the west
            (cx, cy), hl, hw, ang = obb(base); cb = B(cx, cy)
            for k, (f, h) in enumerate(((1.0, 5.0), (0.9, 5.0), (0.8, 4.5))):
                bld.box('marble', cb[0], cb[1], z0 + k * 5.0 if k < 2 else z0 + 10.0, 2 * hl * f, 2 * hw * f, h, ang)
            west = min(range(4), key=lambda q: math.cos(ang + q * math.pi / 2))  # side facing west (-x)
            wa = ang + west * math.pi / 2; dx, dy = math.cos(wa), math.sin(wa); ext = hl if west % 2 == 0 else hw
            sw = 2 * (hw if west % 2 == 0 else hl) * 0.42  # the broad west stair, centred on the hall
            for st in range(30):
                d = ext + 30 - st * 1.0
                bld.box('stairs', cb[0] + dx * d, cb[1] + dy * d, z0, 1.05, sw, 14.5 * (st + 1) / 30, wa)
            hall = [it for it in parts if it[0]['mh'] >= 14 and it[0]['rs'] == 'flat' and it[0]['h'] <= 39]
            body = max(hall, key=lambda it: len(it[1]))[1] if hall else base
            (hx, hy), hhl, hhw, hang = obb(body); hb = B(hx, hy)
            bld.box('marble', hb[0], hb[1], z0 + 14.5, 2 * hhl, 2 * hhw, 24.0, hang)
            bld.box('dark', hb[0] + dx * (hhl + 0.05), hb[1] + dy * (hhl + 0.05), z0 + 14.5, 0.2, 7.0, 13.0, wa)  # the great west door
            roofp = [it for it in parts if it[0]['rs'] == 'pyramidal']
            poly = [B(x, y) for x, y in (roofp[0][1] if roofp else body)]
            pcx = sum(p[0] for p in poly) / len(poly); pcy = sum(p[1] for p in poly) / len(poly)
            big = [(pcx + (x - pcx) * 1.25, pcy + (y - pcy) * 1.25) for x, y in poly]
            chinese_roof(bld, 'tile_blue', pcx, pcy, 0, 0, 0, z0 + 38.5, 6.0, poly=[(x, y) for x, y in big], lift=1.4, steps=4)
            drum = [(pcx + (x - pcx) * 0.72, pcy + (y - pcy) * 0.72) for x, y in poly]
            for i in range(len(drum)):
                a, b2 = drum[i], drum[(i + 1) % len(drum)]; bld.quad('marble', (*a, z0 + 42), (*b2, z0 + 42), (*b2, z0 + 50), (*a, z0 + 50))
            chinese_roof(bld, 'tile_blue', pcx, pcy, 0, 0, 0, z0 + 50, 17.0, poly=[(pcx + (x - pcx) * 1.05, pcy + (y - pcy) * 1.05) for x, y in poly], lift=1.6)
            bld.cyl('gold', pcx, pcy, z0 + 66.5, 0.9, 4.0, 12, r2=0.15)
            done.add(name); continue
        if name in ('國家戲劇院', '國家音樂廳'):
            ring = items[0][1]; (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy)
            platform(bld, ring, z0, 6.0)
            colonnade(bld, cb, hl, hw, ang, z0 + 6, 13.0, 3.5, spacing=5.0, r=0.6)
            bld.box('lattice', cb[0], cb[1], z0 + 6, 2 * (hl - 7), 2 * (hw - 7), 13.0, ang)
            chinese_roof(bld, 'tile_gold', cb[0], cb[1], ang, hl - 1.0, hw - 1.0, z0 + 19.0, 3.0, hip=True, lift=1.3, steps=3)
            bld.box('lattice', cb[0], cb[1], z0 + 21.5, 2 * (hl - 10), 2 * (hw - 10), 3.5, ang)
            chinese_roof(bld, 'tile_gold', cb[0], cb[1], ang, hl - 4.0, hw - 4.0, z0 + 25.0, 12.0, hip=True, lift=1.6)
            done.add(name); continue
        # 自由廣場 gate, 大忠門, 大孝門 and other historic buildings: OSM parts as walls, curved blue roofs on the top parts
        ov = {k: v for c in CORR for k, v in (c.get('landmarks') or {}).get(name, {}).items() if k in ('h', 'rs', 'rh', 'rc', 'facade')}  # corridor parameters
        for l, ring in items:
            if ov: l = {**l, **{k: v for k, v in ov.items() if k != 'facade'}, 'h': max(l['h'], ov.get('h', 0)) if l['h'] >= max(it[0]['h'] for it in items) else l['h']}
            top = z0 + l['h']; rh = l['rh'] if l['rs'] not in ('flat', 'dome') else 0
            walls_top = top - rh
            mat = 'marble' if name in ('自由廣場門', '大忠門', '大孝門') else ov['facade'] if ov.get('facade') in MAT else 'facade_concrete'
            n = len(ring)
            for i in range(n):
                (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
                bld.quad(mat, (*B(ax, ay), z0 + l['mh']), (*B(bx, by), z0 + l['mh']), (*B(bx, by), walls_top), (*B(ax, ay), walls_top), [(0, 0), (L / 6, 0), (L / 6, (walls_top - z0) / 6.4), (0, (walls_top - z0) / 6.4)])
            if rh:
                (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy)
                rmat = {'green': 'tile_green', 'grey': 'tile_slate'}.get(l.get('rc') or '') if {'green': 'tile_green', 'grey': 'tile_slate'}.get(l.get('rc') or '') in MAT else 'tile_blue' if (l.get('rc') or '') in ('blue', '') else 'tile_gold'
                chinese_roof(bld, rmat, cb[0], cb[1], ang, hl + 1.2, hw + 1.2, walls_top, rh, hip=True, lift=0.7, ridge_mat='gold' if rmat != 'tile_green' else rmat)
            else:
                bld.face('marble' if mat == 'marble' else 'roof', [(*B(x, y), walls_top) for x, y in ring])
                if l['rs'] == 'dome' and l['h'] >= max(it[0]['h'] for it in items):  # corridor parameter: a dome on the tallest part
                    (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy); rr = min(hl, hw) * 0.85; dm = 'tile_green' if 'tile_green' in MAT else 'tile_blue'
                    bld.cyl(dm, cb[0], cb[1], walls_top, rr, rr * 0.45, 16, r2=rr * 0.75); bld.cyl(dm, cb[0], cb[1], walls_top + rr * 0.45, rr * 0.75, rr * 0.4, 16, r2=0.4)
    return bld.to_object('landmarks')

# ---------- corridors with per-building parameters (data/corridors/*.json, tools/jianzhong/derive_params.py)
# Inside a corridor's area the data/taipei.json buildings are replaced by the corridor's own list: footprints already
# cleared of the roads, heights from permits, and roof / arcade / use / landmark decided per building.
CORR = []
for f in sorted(os.listdir(os.path.join(DATA, 'corridors'))) if os.path.isdir(os.path.join(DATA, 'corridors')) else []:
    if f.endswith('.json'): CORR.append(json.load(open(os.path.join(DATA, 'corridors', f))))
CORR_AREAS = [[tuple(p) for p in c['area']] for c in CORR]
CORR_REPLACES = {bi for c in CORR for bi in c.get('replaces', [])}  # data/taipei.json buildings the corridors rebuild
def simple_ring(r):
    """no two non-adjacent edges cross (offset_ring can fold concave footprints)"""
    n = len(r)
    def cross(p, q, a, b):
        d = lambda u, v, w: (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])
        return d(p, q, a) * d(p, q, b) < 0 and d(a, b, p) * d(a, b, q) < 0
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1: continue
            if cross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n]): return False
    return True
def near_ring(x, y, r, tol=0.05):
    for i in range(len(r)):
        (ax, ay), (bx, by) = r[i], r[(i + 1) % len(r)]; dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1
        f = min(1, max(0, ((x - ax) * dx + (y - ay) * dy) / l2))
        if math.hypot(x - ax - dx * f, y - ay - dy * f) < tol: return True
    return False
INST_FACADES = ['school_corridor', 'concrete', 'grey_wash', 'white_tile_apts']
LANDMARK_FACADE = {'redhouse': 'red_brick_old', 'palace': 'cream', 'temple': 'red_brick_old', 'dome': 'white_tile_apts'}

# ---------- ordinary buildings
DUMP = []  # final footprint and choices per building, written to $TGP_DUMP (debugging and the corridor audit)
def build_buildings():
    bld = Builder(); stats = dict(n=0, cages=0, signs=0, arcades=0)
    pal = ['facade_mosaic_cream', 'facade_mosaic_pink', 'facade_mosaic_grey']
    for bi, b in enumerate(T['buildings']):
        h = b[0] / 10; pts = b[1:]; ring = [(pts[2 * i], pts[2 * i + 1]) for i in range(len(pts) // 2)]
        if len(ring) < 3: continue
        gx = sum(p[0] for p in ring) / len(ring); gy = sum(p[1] for p in ring) / len(ring)
        if not inside(gx, gy) or any(pip(gx, gy, r) for r in lm_rings) or bi in CORR_REPLACES or any(pip(gx, gy, r) for r in CORR_AREAS): continue
        one_building(bld, stats, pal, bi, h, ring, gx, gy)
    for c in CORR:
        for ci, P in enumerate(c['buildings']):
            ring = [tuple(p) for p in P['ring']]; gx = sum(p[0] for p in ring) / len(ring); gy = sum(p[1] for p in ring) / len(ring)
            if inside(gx, gy) and not any(pip(gx, gy, r) for r in lm_rings): one_building(bld, stats, pal, 1000000 + ci, P['h'], ring, gx, gy, P)
    print('buildings', stats)
    return bld.to_object('buildings')

def one_building(bld, stats, pal, bi, h, ring, gx, gy, P=None):
    """One ordinary building. P: corridor parameters (footprint already clear of the roads), or None for data/taipei.json."""
    if True:
        ring0 = ccw(ring); ring = clear_roads(ring0) if P is None else ring0
        if ring is None or len(ring) < 3: stats['dropped'] = stats.get('dropped', 0) + 1; DUMP.append({'bid': bi, 'dropped': True, 'ring0': ring0, 'h': h}); return
        ring = ccw(ring); hsh = (bi * 2654435761) & 0xffffffff
        fam = ('facade_concrete' if hsh % 3 == 0 else 'facade_glass') if h > 42 else [pal[hsh % 3], 'facade_concrete', 'facade_glass'][hsh % 3] if h > 24 else ('facade_concrete' if hsh % 5 == 0 else pal[hsh % 3])
        if AI:  # AI facades by building height; the drawn ones remain the fallback
            fam = ai_facade(h, hsh) or (AI_FOR[fam] if AI_FOR.get(fam) in AI else fam)
        use = P['use'] if P else None; lmk = P.get('landmark') if P else None
        if P and AI:  # schools, offices and museums get institutional facades; landmarks their own
            pick = LANDMARK_FACADE.get(lmk) or (INST_FACADES[(hsh // 7) % len(INST_FACADES)] if use in ('institutional', 'religious') else None)
            if pick and 'facade_ai_' + pick in MAT: fam = 'facade_ai_' + pick
        rx, ry = FACADE_REPEAT(fam)
        base = min(dem(x, y) for x, y in ring) - 1.5; top = dem(gx, gy) + h
        n = len(ring)
        street = []
        for i in range(n):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
            if L < 3: street.append(False); continue
            nx_, ny_ = (by - ay) / L, -(bx - ax) / L  # outward normal of a CCW ring
            street.append(street_dist((ax + bx) / 2 + nx_ * 4, (ay + by) / 2 + ny_ * 4) < 6)
        lowrise = h <= 40 and fam != 'facade_glass'
        painted_grilles = fam.startswith('facade_ai')  # the AI facades already show window grilles; 3D cages would not line up with them
        arcade = (lowrise and h >= 7) if P is None else bool(P['arcade']) and h >= 7
        shops = (P is None or use == 'storefront')
        details = P is None or use in ('storefront', 'residential')  # no cages, AC units or signboards on schools, offices, landmarks
        g0 = base + 1.5 + 4.5  # top of the ground floor
        inner = offset_ring(ring, [3.0 if (arcade and street[i]) else 0 for i in range(n)]) if arcade and any(street) else ring
        if inner is not ring and (not simple_ring(inner) or not all(pip(x, y, ring) or near_ring(x, y, ring) for x, y in inner)):
            arcade, inner = False, ring; stats['arcade_dropped'] = stats.get('arcade_dropped', 0) + 1  # folded inner ring: shop walls would stick out of the building
        DUMP.append({'bid': bi, 'id': P and P['id'], 'src': P and P['src'], 'params': P and {k: P.get(k) for k in ('roof', 'use', 'landmark', 'floors', 'arcade')}, 'ring0': ring0, 'ring': ring, 'inner': inner if inner is not ring else None, 'h': h, 'base': base, 'top': top, 'facade': fam, 'arcade': arcade and any(street), 'street': street, 'shops': bool(arcade and shops and SHOP_AI and hsh % 5)})
        per = 0.0
        for i in range(n):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
            A, Bp = B(ax, ay), B(bx, by)
            low = g0 if arcade else base
            # upper facade
            bld.quad(fam, (*A, low), (*Bp, low), (*Bp, top), (*A, top), [(per / rx, (low - base) / ry), ((per + L) / rx, (low - base) / ry), ((per + L) / rx, (top - base) / ry), (per / rx, (top - base) / ry)])
            if arcade:
                (ix, iy), (jx, jy) = inner[i], inner[(i + 1) % n]; Ai, Bi = B(ix, iy), B(jx, jy); Li = math.hypot(jx - ix, jy - iy)
                shop = (SHOP_AI[(hsh // 3 + i) % len(SHOP_AI)] if SHOP_AI and hsh % 5 else 'storefront') if shops else fam
                bld.quad(shop if street[i] else fam, (*Ai, base), (*Bi, base), (*Bi, g0), (*Ai, g0), [(0, 0), (Li / 12, 0), (Li / 12, 1), (0, 1)] if street[i] else None)
                if street[i]:  # arcade ceiling and columns along the kerb side
                    bld.quad('ceiling', (*A, g0), (*Ai, g0), (*Bi, g0), (*Bp, g0)); stats['arcades'] += 1
                    ux, uy = (bx - ax) / L, (by - ay) / L; nx_, ny_ = uy, -ux  # along the street, and out of the building
                    for k in range(int(L // 4.2) + 1):
                        f = min(1, (k * 4.2 + 0.3) / max(L, 0.1)); px, py = ax + (bx - ax) * f, ay + (by - ay) * f
                        px -= uy * 0.35; py += ux * 0.35
                        inst('column', *B(px, py), base, math.atan2(uy, ux))
                    # 橫式招牌: one lit sign per bay on the fascia above the arcade
                    for k in range(int(L // 4.2)) if shops else ():
                        if R.random() < 0.25: continue
                        s0, s1 = k * 4.2 + 0.45, k * 4.2 + 4.05; zs = g0 + 0.15 + R.choice((0, 0, 0.3))
                        p0 = B(ax + ux * s0 + nx_ * 0.12, ay + uy * s0 + ny_ * 0.12); p1 = B(ax + ux * s1 + nx_ * 0.12, ay + uy * s1 + ny_ * 0.12)
                        si = R.randrange(32); u0, v0 = (si % 4) / 4, 1 - (si // 4 + 1) / 8
                        bld.quad('signs_h', (*p0, zs), (*p1, zs), (*p1, zs + 1.0), (*p0, zs + 1.0), [(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.125), (u0, v0 + 0.125)]); stats['hsigns'] = stats.get('hsigns', 0) + 1
                    # 機車 parked side by side across the arcade, nose to the shops or to the street, gaps here and there
                    s = 0.9 if shops else L
                    while s < L - 0.9:
                        if R.random() < 0.5: s += R.uniform(1.5, 4.0); continue
                        px, py = ax + ux * s - nx_ * 1.55, ay + uy * s - ny_ * 1.55
                        yaw = math.atan2(-ny_, -nx_) + (math.pi if R.random() < 0.5 else 0) + R.uniform(-0.15, 0.15)
                        inst('scooter', *B(px, py), dem(px, py), yaw); stats['scooters'] = stats.get('scooters', 0) + 1
                        s += R.uniform(0.68, 0.8)
            # street-face details on walk-ups: window cages, AC units, vertical signboards
            if lowrise and details and street[i] and L > 4:
                ux, uy = (bx - ax) / L, (by - ay) / L; nx_, ny_ = uy, -ux; yaw = math.atan2(uy, ux)
                floors = int((top - g0) // 3.2)
                for fl in range(floors):
                    zf = g0 + fl * 3.2
                    for k in range(int(L // 3)):
                        if R.random() > 0.55: continue
                        f = (k + 0.5) * 3 / L; px, py = ax + (bx - ax) * f + nx_ * 0.2, ay + (by - ay) * f + ny_ * 0.2
                        if not painted_grilles: inst('cage', *B(px, py), zf + 0.6, yaw); stats['cages'] += 1
                        if R.random() < 0.35: inst('ac', *B(px + ux * 0.9 + nx_ * 0.25, py + uy * 0.9 + ny_ * 0.25), zf + 0.15, yaw)
                if h < 30 and shops:
                    for k in range(int(L // 7)):
                        if R.random() > 0.6: continue
                        f = (k + 0.5) * 7 / L; px, py = ax + (bx - ax) * f + nx_ * 0.9, ay + (by - ay) * f + ny_ * 0.9
                        si = R.randrange(16); u0, v0 = (si % 8) / 8, 1 - (si // 8 + 1) / 2; u1, v1 = u0 + 1 / 8, v0 + 1 / 2
                        hs = min(6.5, top - g0 - 0.5)
                        if hs < 2.5: continue
                        cx, cy = B(px, py); dx, dy = nx_ * 0.6, ny_ * 0.6; tx, ty = ux * 0.13, uy * 0.13
                        for side in (-1, 1):  # both faces of the light box read along the street
                            ox, oy = tx * side, ty * side
                            pts = [(cx - dx + ox, cy - dy + oy, g0 + 0.3), (cx + dx + ox, cy + dy + oy, g0 + 0.3), (cx + dx + ox, cy + dy + oy, g0 + 0.3 + hs), (cx - dx + ox, cy - dy + oy, g0 + 0.3 + hs)]
                            uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
                            if side > 0: pts, uvs = pts[::-1], [uvs[1], uvs[0], uvs[3], uvs[2]]
                            bld.face('signboards', pts, uvs)
                        stats['signs'] += 1
            per += L
        # flat roof, rooftop water tank and stair hut
        roofs = [k for k in ('roof_ai_0', 'roof_ai_1') if k in AI]
        rm, rs = (roofs[hsh % len(roofs)], 16) if roofs else ('roof', 8)
        kind = P['roof'] if P else 'flat_green'
        pick = lambda names: [k for k in names if k in MAT]
        if kind in ('flat_concrete', 'mixed', 'dome') and pick(('roof_concrete_a', 'roof_concrete_b', 'roof_concrete_c')): ks = pick(('roof_concrete_a', 'roof_concrete_b', 'roof_concrete_c')); rm, rs = ks[hsh % len(ks)], 16
        elif kind == 'metal_sheet' and pick(('roof_metal_red', 'roof_metal_blue', 'roof_metal_green', 'roof_metal_grey')): ks = pick(('roof_metal_red', 'roof_metal_blue', 'roof_metal_green', 'roof_metal_grey')); rm, rs = ks[(hsh // 5) % len(ks)], 8
        elif kind == 'solar' and 'roof_solar' in MAT: rm, rs = 'roof_solar', 16
        if kind == 'pitched_tile':  # hip roof over the footprint's oriented box; glazed green for palace style, slate for 紅樓
            (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy)
            mat = {'palace': 'tile_green', 'redhouse': 'tile_slate', 'temple': 'tile_orange'}.get(lmk, 'tile_slate' if 'tile_slate' in MAT else 'tile_orange')
            mat = mat if mat in MAT else 'tile_orange'
            bld.face('roof', [(*B(x, y), top) for x, y in ring], [((x - X0) / 8, (y - Y0) / 8) for x, y in ring])
            chinese_roof(bld, mat, cb[0], cb[1], ang, hl + 0.8, hw + 0.8, top, min(6.0, max(2.5, hw * 0.55)), hip=True, lift=0.9 if lmk in ('palace', 'temple') else 0.15, steps=4, ridge_mat='gold' if lmk == 'temple' else mat)
        else:
            bld.face(rm, [(*B(x, y), top) for x, y in ring], [((x - X0) / rs, (y - Y0) / rs) for x, y in ring])
            if kind == 'dome':
                (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy); rr = min(hl, hw) * 0.85
                bld.cyl('tile_green' if 'tile_green' in MAT else 'tile_blue', cb[0], cb[1], top, rr, rr * 0.45, 16, r2=rr * 0.75); bld.cyl('tile_green' if 'tile_green' in MAT else 'tile_blue', cb[0], cb[1], top + rr * 0.45, rr * 0.75, rr * 0.4, 16, r2=0.4)
            elif h < 60 and details and R.random() < 0.6:
                inst('tank', *B(gx + R.uniform(-2, 2), gy + R.uniform(-2, 2)), top + 0.3, 0.0)
            if kind == 'mixed' and 'roof_metal_grey' in MAT:  # 鐵皮加蓋 on part of the roof
                (cx, cy), hl, hw, ang = obb(ring); bld.box('roof_metal_grey', *B(cx, cy), top, hl * 1.1, hw * 1.1, 2.6, ang)
            elif h < 60 and kind != 'dome' and R.random() < 0.4:
                bld.box('facade_concrete', *B(gx, gy), top, 3.0, 2.6, 2.8, R.uniform(0, math.pi))
        stats['n'] += 1

def build_bridges():
    bld = Builder(); cnt = 0
    for br in O.get('bridges', []):
        c, lay, w, g0, g1 = br[0], br[1], br[2] / 10, br[3], br[4]
        pts0 = [(br[6 + 2 * i] / 10, br[7 + 2 * i] / 10) for i in range((len(br) - 6) // 2)]
        pts = pts0[:1]  # pieces of at most 8 m, so a ramp's low end is judged where it is (華翠大橋 runs 178 m in one segment)
        for a, b2 in zip(pts0, pts0[1:]):
            m = max(1, math.ceil(math.dist(a, b2) / 8.0)); pts += [(a[0] + (b2[0] - a[0]) * q / m, a[1] + (b2[1] - a[1]) * q / m) for q in range(1, m + 1)]
        S = [0.0]
        for a, b2 in zip(pts, pts[1:]): S.append(S[-1] + math.dist(a, b2))
        L, full = S[-1], 6.5 * lay
        def hgt(sv):  # ramps fall at 5 % toward an end that meets a surface street
            h = full
            if g0: h = min(h, sv * 0.05)
            if g1: h = min(h, (L - sv) * 0.05)
            return max(h, 0.6)
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            if not inside((ax + bx) / 2, (ay + by) / 2): continue
            ln = math.dist(pts[i], pts[i + 1])
            if ln < 0.5: continue
            ux, uy = (bx - ax) / ln, (by - ay) / ln; nx_, ny_ = -uy, ux; hw = w / 2
            # the low tail of a ramp that runs alongside a surface street (華翠大橋 onto 艋舺大道) would stand as a 1 m
            # wall in that street's carriageway: leave it out, the ramp meets the street there anyway
            if min(hgt(S[i]), hgt(S[i + 1])) < 2.5 and street_dist((ax + bx) / 2, (ay + by) / 2) < hw: continue
            za, zb = dem(ax, ay) + hgt(S[i]), dem(bx, by) + hgt(S[i + 1])
            A = lambda off, X, Y: B(X + nx_ * off, Y + ny_ * off)
            # deck top, underside, edges and parapets
            bld.quad('deck', (*A(-hw, ax, ay), za), (*A(-hw, bx, by), zb), (*A(hw, bx, by), zb), (*A(hw, ax, ay), za))
            bld.quad('concrete', (*A(hw, ax, ay), za - 1.2), (*A(hw, bx, by), zb - 1.2), (*A(-hw, bx, by), zb - 1.2), (*A(-hw, ax, ay), za - 1.2))
            for off in (-hw, hw):
                o2 = off + (0.25 if off > 0 else -0.25)
                bld.quad('concrete', (*A(off, ax, ay), za - 1.2), (*A(off, bx, by), zb - 1.2), (*A(off, bx, by), zb + 0.9), (*A(off, ax, ay), za + 0.9))
                bld.quad('concrete', (*A(o2, ax, ay), za - 1.2), (*A(o2, bx, by), zb - 1.2), (*A(o2, bx, by), zb + 0.9), (*A(o2, ax, ay), za + 0.9))
                bld.quad('concrete', (*A(off, ax, ay), za + 0.9), (*A(off, bx, by), zb + 0.9), (*A(o2, bx, by), zb + 0.9), (*A(o2, ax, ay), za + 0.9))
            # piers every 30 m where the deck is high enough to need them
            for k in range(int(S[i] // 30) + 1, int(S[i + 1] // 30) + 1):
                f = (k * 30 - S[i]) / ln; px, py = ax + (bx - ax) * f, ay + (by - ay) * f; zt = za + (zb - za) * f - 1.2; zg = dem(px, py) - 0.5
                if zt - zg > 2.5:
                    bld.box('concrete', *B(px, py), zg, 1.8, min(w * 0.6, 6.0), zt - zg, math.atan2(uy, ux))
                    bld.box('concrete', *B(px, py), zt - 1.0, 1.8, w * 0.9, 1.0, math.atan2(uy, ux))  # pier cap
            cnt += 1
    print('bridge segments', cnt)
    return bld.to_object('bridges')

lm_objs = build_landmarks(); cut_gate_passages(lm_objs); b_objs = build_buildings() + build_bridges()
# final footprints of the ordinary buildings in this tile (after road clearance, corridor parameters, dropped ones left out):
# the game draws the minimap and keeps street trees out of buildings with these instead of data/taipei.json inside the tile.
# tools/blender/footprints.py merges every <tile>.foot.json into models/taipei/footprints.json.
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
json.dump({'x0': X0, 'x1': X1, 'y0': Y0, 'y1': Y1, 'b': [[round(d['h'] * 10)] + [round(v * 10) for p in d['ring'] for v in p] for d in DUMP if not d.get('dropped')]},
          open(OUT[:-5] + '.foot.json', 'w'), separators=(',', ':'))
if os.environ.get('TGP_DUMP'):
    json.dump({'x0': X0, 'x1': X1, 'y0': Y0, 'y1': Y1, 'buildings': DUMP}, open(os.environ['TGP_DUMP'], 'w'))
    if os.environ.get('TGP_DUMP_ONLY') == '1': print('dumped', len(DUMP)); sys.exit(0)

# ---------- ambient occlusion baked into vertex colours (needs a ground to occlude against; the ground is not exported)
bpy.ops.mesh.primitive_plane_add(size=1); ground = bpy.context.active_object; ground.name = 'ao_ground'
gx0, gy0 = B(X0, Y0); gx1, gy1 = B(X1, Y1); ground.scale = ((gx1 - gx0) + 200, (gy1 - gy0) + 200, 1); ground.location = ((gx0 + gx1) / 2, (gy0 + gy1) / 2, min(dem(X0, Y0), dem(X1, Y1)) - 0.2)
scn = bpy.context.scene; scn.render.engine = 'CYCLES'; scn.cycles.samples = 24
if os.environ.get('TGP_BAKE_GPU') == '1':  # parallel Blender instances deadlock on Metal's shader cache, so the GPU is opt-in
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices(); [setattr(d, 'use', True) for d in prefs.devices]; scn.cycles.device = 'GPU'
    except Exception as e: print('cpu bake', e)
scn.world = bpy.data.worlds.new('w'); scn.world.light_settings.distance = 12.0
for o in lm_objs + b_objs:
    o.data.color_attributes.new('Col', 'BYTE_COLOR', 'POINT'); o.data.color_attributes.active_color = o.data.color_attributes['Col']
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
bpy.data.objects.remove(ground)

# ---------- export
bpy.ops.object.select_all(action='SELECT')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLTF_SEPARATE', export_texture_dir='tex', use_selection=True, export_yup=True, export_apply=True,
                          export_extras=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=8, export_draco_normal_quantization=8,
                          export_image_format='WEBP', export_vertex_color='ACTIVE', export_all_vertex_colors=False)
import struct
json.dump({'x0': X0, 'y0': Y0, **{k: base64.b64encode(struct.pack(f'<{len(v)}h', *v)).decode() for k, v in INST.items()}}, open(OUT[:-5] + '.inst.json', 'w'))
binf = OUT[:-5] + '.bin'
print('wrote', OUT, (os.path.getsize(OUT) + (os.path.getsize(binf) if os.path.exists(binf) else 0)) // 1024, 'KB')
