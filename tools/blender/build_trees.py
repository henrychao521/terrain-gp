"""Street-tree models for Terrain GP from TRELLIS.2 image-to-3D output (see tools/colab/trees_job.py): low-poly game
models in tools/blender/trees/ (build_props.py puts them in props.gltf), plus a side-view impostor atlas the game draws on
crossed cards beyond the near range.

  blender -b --factory-startup --python tools/blender/build_trees.py -- <dir with camphor/luan/palm/tall .glb> <repo root>

TRELLIS foliage is thousands of thin open leaf shells: a plain decimate eats them. So each tree is thickened, voxel
remeshed into one closed hull, decimated, and the original's colour is baked onto the hull.
The banyan has no model of its own (SDXL kept drawing bonsai or cropped trunks): it is the camphor, wider and darker,
which is also how the two read from a car in Taipei - broad evergreen domes.
"""
import bpy, sys, os, math, json
import numpy as np

src, root = sys.argv[sys.argv.index('--') + 1:][:2]
TREES = [  # game kind order; height (m) as NATIVE_H in game.js; voxel size as a fraction of the height (sparse crowns
    # need coarser voxels so neighbouring leaves merge into clumps instead of falling apart into flakes)
    ('tree_camphor', 'camphor', 9.5, (1, 1, 1), (1, 1, 1), 0.006),
    ('tree_banyan', 'camphor', 8.5, (1.4, 1.4, 1), (0.7, 0.8, 0.66), 0.006),
    ('tree_luan', 'luan', 9.0, (1, 1, 1), (1, 1, 1), 0.013),
    ('tree_palm', 'palm', 9.8, (1, 1, 1), (1, 1, 1), 0.006),
    ('tree_tall', 'tall', 10.5, (1, 1, 1), (1, 1, 1), 0.013),
]
FACES, TEX = 3500, 512
out_models = os.path.join(root, 'tools/blender/trees'); os.makedirs(out_models, exist_ok=True)
out_props = os.path.join(root, 'models/props'); os.makedirs(out_props, exist_ok=True)


def select(*objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]


def load(name, height, stretch, tint):
    """the TRELLIS model as one mesh: base centre at the origin, `height` metres tall, optionally stretched and tinted"""
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(src, name + '.glb'))
    meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']; select(*meshes)
    if len(meshes) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.parent = None; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    co = np.array([v.co for v in o.data.vertices]); mn, mx = co.min(0), co.max(0); s = height / (mx[2] - mn[2])
    co = (co - [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]]) * s * np.array(stretch)
    o.data.vertices.foreach_set('co', co.ravel().astype(np.float32)); o.data.update()
    if tint != (1, 1, 1):
        nt = o.data.materials[0].node_tree; bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        tex = next(l.from_node for l in nt.links if l.to_socket == bsdf.inputs['Base Color'] and l.from_node.type == 'TEX_IMAGE')
        img = tex.image.copy(); px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4); px[:, :3] *= np.array(tint, dtype=np.float32)
        img.pixels = px.ravel().tolist(); tex.image = img
    return o


def low_poly(hi, name, height, voxf):
    lo = hi.copy(); lo.data = hi.data.copy(); bpy.context.scene.collection.objects.link(lo); lo.name = lo.data.name = name; select(lo)
    vox = voxf * height
    for kind, setup in (('SOLIDIFY', lambda m: (setattr(m, 'thickness', vox * 2.5), setattr(m, 'offset', 0))),
                        ('REMESH', lambda m: (setattr(m, 'mode', 'VOXEL'), setattr(m, 'voxel_size', vox), setattr(m, 'use_smooth_shade', True)))):
        m = lo.modifiers.new(kind, kind); setup(m); bpy.ops.object.modifier_apply(modifier=m.name)
    for _ in range(3):  # decimate can stop short of the ratio on a remeshed hull: repeat
        if len(lo.data.polygons) <= FACES * 1.05: break
        m = lo.modifiers.new('dec', 'DECIMATE'); m.ratio = FACES / len(lo.data.polygons); bpy.ops.object.modifier_apply(modifier='dec')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004); bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img; nt.nodes.active = tn
    bsdf = nt.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.9
    lo.data.materials.clear(); lo.data.materials.append(mat)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
    b = sc.render.bake; b.use_selected_to_active = True; b.cage_extrusion = vox * 2.5; b.max_ray_distance = vox * 10; b.margin = 4
    b.use_pass_direct = False; b.use_pass_indirect = False; b.use_pass_color = True
    select(hi, lo); bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    nt.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
    return lo


info = []
for name, srcname, height, stretch, tint, voxf in TREES:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hi = load(srcname, height, stretch, tint); lo = low_poly(hi, name, height, voxf)
    co = np.array([v.co for v in lo.data.vertices]); w = float(max(np.ptp(co[:, 0]), np.ptp(co[:, 1])))
    info.append({'name': name, 'faces': len(lo.data.polygons), 'w': round(w, 2), 'h': round(float(co[:, 2].max()), 2)})
    select(lo); bpy.ops.export_scene.gltf(filepath=os.path.join(out_models, name + '.glb'), use_selection=True, export_yup=True, export_image_format='WEBP')
    print('TREE', info[-1])

# impostor atlas from the full-detail models: square cells, orthographic side view, transparent background,
# flat ambient light only (the game lights the cards itself)
CELL = 512
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError: sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = CELL * len(TREES), CELL; sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
cells = []
for i, (name, srcname, height, stretch, tint, _) in enumerate(TREES):
    o = load(srcname, height, stretch, tint); o.name = name
    co = np.array([v.co for v in o.data.vertices]); f = max(float(np.ptp(co[:, 0])), float(np.ptp(co[:, 1])), float(co[:, 2].max())) * 1.03
    o.scale = (1 / f,) * 3; o.location = (i + 0.5, 0, 0)  # cell i spans x in [i, i + 1], z in [0, 1]
    cells.append({'name': name, 'size': round(f, 2)})
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = len(TREES); cam.location = (len(TREES) / 2, -20, 0.5); cam.rotation_euler = (math.radians(90), 0, 0)
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
png = os.path.join(out_props, 'trees_atlas.png'); sc.render.filepath = png; bpy.ops.render.render(write_still=True)
json.dump({'cols': len(cells), 'cells': cells}, open(os.path.join(out_props, 'trees_atlas.json'), 'w'), indent=1)
print('ATLAS', png, cells)
