"""Build one Taipei scenery tile in Blender and export it as glTF for Terrain GP.

  blender -b --factory-startup --python tools/blender/build_tile.py -- <data dir> <texture dir> X0 X1 Y0 Y1 <out.glb>

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
def img_mat(name, file, rough=0.8, emit=0.0, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(f'{TEX}/{file}.png'); tex.extension = 'REPEAT'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    if emit: nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = emit
    return m
def col_mat(name, rgb, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in rgb], 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal; return m
MAT = {k: img_mat(k, k) for k in ('facade_mosaic_cream', 'facade_mosaic_pink', 'facade_mosaic_grey', 'facade_concrete', 'roof')}
MAT['facade_glass'] = img_mat('facade_glass', 'facade_glass', rough=0.15, metal=0.3)
MAT['storefront'] = img_mat('storefront', 'storefront', emit=0.35)
MAT['signboards'] = img_mat('signboards', 'signboards', rough=0.4, emit=0.8)
MAT['tile_blue'] = img_mat('tile_blue', 'tile_blue', rough=0.3); MAT['tile_gold'] = img_mat('tile_gold', 'tile_gold', rough=0.3); MAT['tile_orange'] = img_mat('tile_orange', 'tile_orange', rough=0.35)
for k, rgb, r, mt in [('cage', (0.55, 0.56, 0.55), 0.5, 0.6), ('ac', (0.86, 0.86, 0.83), 0.6, 0), ('ceiling', (0.62, 0.6, 0.56), 0.9, 0), ('column', (0.7, 0.68, 0.63), 0.8, 0),
                      ('tank', (0.82, 0.84, 0.86), 0.3, 0.8), ('marble', (0.93, 0.92, 0.89), 0.35, 0), ('stone', (0.62, 0.58, 0.52), 0.85, 0), ('lacquer', (0.56, 0.1, 0.08), 0.45, 0),
                      ('gold', (0.85, 0.65, 0.2), 0.3, 0.8), ('dark', (0.08, 0.07, 0.06), 0.9, 0), ('stairs', (0.85, 0.84, 0.8), 0.6, 0), ('lattice', (0.42, 0.12, 0.08), 0.6, 0)]:
    MAT[k] = col_mat(k, rgb, r, mt)

# ---------- mesh builder: one bmesh per material keeps the export to one primitive per material
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
    def box(self, mat, cx, cy, cz, sx, sy, sz, yaw=0.0, uvscale=1.0):
        c, s = math.cos(yaw), math.sin(yaw)
        P = lambda x, y, z: (cx + x * c - y * s, cy + x * s + y * c, cz + z)
        hx, hy = sx / 2, sy / 2; v = [P(-hx, -hy, 0), P(hx, -hy, 0), P(hx, hy, 0), P(-hx, hy, 0), P(-hx, -hy, sz), P(hx, -hy, sz), P(hx, hy, sz), P(-hx, hy, sz)]
        for f in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)):
            self.face(mat, [v[i] for i in f], [(0, 0), (uvscale, 0), (uvscale, uvscale), (0, uvscale)])
    def cyl(self, mat, cx, cy, z0, r, h, seg=10, r2=None):
        r2 = r if r2 is None else r2
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            self.quad(mat, (cx + r * math.cos(a0), cy + r * math.sin(a0), z0), (cx + r * math.cos(a1), cy + r * math.sin(a1), z0), (cx + r2 * math.cos(a1), cy + r2 * math.sin(a1), z0 + h), (cx + r2 * math.cos(a0), cy + r2 * math.sin(a0), z0 + h), [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1)])
        self.face(mat, [(cx + r2 * math.cos(2 * math.pi * i / seg), cy + r2 * math.sin(2 * math.pi * i / seg), z0 + h) for i in range(seg)])
    def to_object(self, name):
        me = bpy.data.meshes.new(name); objs = []
        for mat, b in self.bm.items():
            m = bpy.data.meshes.new(f'{name}_{mat}'); b.normal_update(); b.to_mesh(m); m.materials.append(MAT[mat])
            o = bpy.data.objects.new(f'{name}_{mat}', m); bpy.context.scene.collection.objects.link(o); objs.append(o)
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
def street_dist(X, Y):
    best = 1e9
    for (ax, ay), (bx, by), w, c in road_segs:
        dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1; f = min(1, max(0, ((X - ax) * dx + (Y - ay) * dy) / l2))
        best = min(best, math.hypot(X - ax - dx * f, Y - ay - dy * f) - w / 2)
    return best

# ---------- landmarks first, so ordinary buildings inside them are skipped
LM = [l for l in O['landmarks'] if any(inside(l['p'][2 * i] / 10, l['p'][2 * i + 1] / 10) for i in range(len(l['p']) // 2))]
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
        for l, ring in items:
            top = z0 + l['h']; rh = l['rh'] if l['rs'] != 'flat' else 0
            walls_top = top - rh
            mat = 'marble' if name in ('自由廣場門', '大忠門', '大孝門') else 'facade_concrete'
            n = len(ring)
            for i in range(n):
                (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
                bld.quad(mat, (*B(ax, ay), z0 + l['mh']), (*B(bx, by), z0 + l['mh']), (*B(bx, by), walls_top), (*B(ax, ay), walls_top), [(0, 0), (L / 6, 0), (L / 6, (walls_top - z0) / 6.4), (0, (walls_top - z0) / 6.4)])
            if rh:
                (cx, cy), hl, hw, ang = obb(ring); cb = B(cx, cy)
                chinese_roof(bld, 'tile_blue' if (l.get('rc') or '') in ('blue', '') else 'tile_gold', cb[0], cb[1], ang, hl + 1.2, hw + 1.2, walls_top, rh, hip=True, lift=0.7)
            else: bld.face('marble' if mat == 'marble' else 'roof', [(*B(x, y), walls_top) for x, y in ring])
    return bld.to_object('landmarks')

# ---------- ordinary buildings
def build_buildings():
    bld = Builder(); stats = dict(n=0, cages=0, signs=0, arcades=0)
    pal = ['facade_mosaic_cream', 'facade_mosaic_pink', 'facade_mosaic_grey']
    for bi, b in enumerate(T['buildings']):
        h = b[0] / 10; pts = b[1:]; ring = [(pts[2 * i], pts[2 * i + 1]) for i in range(len(pts) // 2)]
        if len(ring) < 3: continue
        gx = sum(p[0] for p in ring) / len(ring); gy = sum(p[1] for p in ring) / len(ring)
        if not inside(gx, gy) or any(pip(gx, gy, r) for r in lm_rings): continue
        ring = ccw(ring); hsh = (bi * 2654435761) & 0xffffffff
        fam = ('facade_concrete' if hsh % 3 == 0 else 'facade_glass') if h > 42 else [pal[hsh % 3], 'facade_concrete', 'facade_glass'][hsh % 3] if h > 24 else ('facade_concrete' if hsh % 5 == 0 else pal[hsh % 3])
        base = min(dem(x, y) for x, y in ring) - 1.5; top = dem(gx, gy) + h
        n = len(ring)
        street = []
        for i in range(n):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
            if L < 3: street.append(False); continue
            nx_, ny_ = (by - ay) / L, -(bx - ax) / L  # outward normal of a CCW ring
            street.append(street_dist((ax + bx) / 2 + nx_ * 4, (ay + by) / 2 + ny_ * 4) < 6)
        lowrise = h <= 40 and fam != 'facade_glass'
        arcade = lowrise and h >= 7
        g0 = base + 1.5 + 4.5  # top of the ground floor
        inner = offset_ring(ring, [3.0 if (arcade and street[i]) else 0 for i in range(n)]) if arcade and any(street) else ring
        per = 0.0
        for i in range(n):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]; L = math.hypot(bx - ax, by - ay)
            A, Bp = B(ax, ay), B(bx, by)
            low = g0 if arcade else base
            # upper facade
            bld.quad(fam, (*A, low), (*Bp, low), (*Bp, top), (*A, top), [(per / 6, (low - base) / 6.4), ((per + L) / 6, (low - base) / 6.4), ((per + L) / 6, (top - base) / 6.4), (per / 6, (top - base) / 6.4)])
            if arcade:
                (ix, iy), (jx, jy) = inner[i], inner[(i + 1) % n]; Ai, Bi = B(ix, iy), B(jx, jy); Li = math.hypot(jx - ix, jy - iy)
                bld.quad('storefront' if street[i] else fam, (*Ai, base), (*Bi, base), (*Bi, g0), (*Ai, g0), [(0, 0), (Li / 12, 0), (Li / 12, 1), (0, 1)] if street[i] else None)
                if street[i]:  # arcade ceiling and columns along the kerb side
                    bld.quad('ceiling', (*A, g0), (*Ai, g0), (*Bi, g0), (*Bp, g0)); stats['arcades'] += 1
                    for k in range(int(L // 4.2) + 1):
                        f = min(1, (k * 4.2 + 0.3) / max(L, 0.1)); px, py = ax + (bx - ax) * f, ay + (by - ay) * f
                        ux, uy = (bx - ax) / L, (by - ay) / L; px -= uy * 0.35; py += ux * 0.35
                        bld.box('column', *B(px, py), base, 0.55, 0.55, 4.5 + 1.5, math.atan2(uy, ux))
            # street-face details on walk-ups: window cages, AC units, vertical signboards
            if lowrise and street[i] and L > 4:
                ux, uy = (bx - ax) / L, (by - ay) / L; nx_, ny_ = uy, -ux; yaw = math.atan2(uy, ux)
                floors = int((top - g0) // 3.2)
                for fl in range(floors):
                    zf = g0 + fl * 3.2
                    for k in range(int(L // 3)):
                        if R.random() > 0.55: continue
                        f = (k + 0.5) * 3 / L; px, py = ax + (bx - ax) * f + nx_ * 0.2, ay + (by - ay) * f + ny_ * 0.2
                        bld.box('cage', *B(px, py), zf + 0.6, 2.0, 0.4, 1.7, yaw); stats['cages'] += 1
                        if R.random() < 0.35: bld.box('ac', *B(px + ux * 0.9 + nx_ * 0.25, py + uy * 0.9 + ny_ * 0.25), zf + 0.15, 0.8, 0.35, 0.5, yaw)
                if h < 30:
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
        bld.face('roof', [(*B(x, y), top) for x, y in ring], [((x - X0) / 8, (y - Y0) / 8) for x, y in ring])
        if h < 60 and R.random() < 0.6:
            bld.cyl('tank', *B(gx + R.uniform(-2, 2), gy + R.uniform(-2, 2)), top + 0.3, 0.75, 1.4, 10)
        if h < 60 and R.random() < 0.4:
            bld.box('facade_concrete', *B(gx, gy), top, 3.0, 2.6, 2.8, R.uniform(0, math.pi))
        stats['n'] += 1
    print('buildings', stats)
    return bld.to_object('buildings')

lm_objs = build_landmarks(); cut_gate_passages(lm_objs); b_objs = build_buildings()

# ---------- ambient occlusion baked into vertex colours (needs a ground to occlude against; the ground is not exported)
bpy.ops.mesh.primitive_plane_add(size=1); ground = bpy.context.active_object; ground.name = 'ao_ground'
gx0, gy0 = B(X0, Y0); gx1, gy1 = B(X1, Y1); ground.scale = ((gx1 - gx0) + 200, (gy1 - gy0) + 200, 1); ground.location = ((gx0 + gx1) / 2, (gy0 + gy1) / 2, min(dem(X0, Y0), dem(X1, Y1)) - 0.2)
scn = bpy.context.scene; scn.render.engine = 'CYCLES'; scn.cycles.samples = 24
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices(); [setattr(d, 'use', True) for d in prefs.devices]; scn.cycles.device = 'GPU'
except Exception as e: print('cpu bake', e)
scn.world = bpy.data.worlds.new('w'); scn.world.light_settings.distance = 12.0
for o in lm_objs + b_objs:
    o.data.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER'); o.data.color_attributes.active_color = o.data.color_attributes['Col']
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
bpy.data.objects.remove(ground)

# ---------- export
bpy.ops.object.select_all(action='SELECT')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                          export_image_format='WEBP', export_vertex_color='ACTIVE', export_all_vertex_colors=False)
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
