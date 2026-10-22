"""Realistic street-tree models for Terrain GP: SDXL photo of one isolated tree -> BiRefNet cut-out -> TRELLIS.2 image-to-3D GLB.
Models: SDXL base 1.0 (OpenRAIL++-M), ZhengPeng7/BiRefNet (MIT), microsoft/TRELLIS.2-4B (MIT) + facebook/dinov3 (DINOv3 License).
The pipeline's default background remover (briaai/RMBG-2.0) is non-commercial, so it is swapped for BiRefNet.
Input: /content/hf_token. Output: /content/trees.tgz with img/<name>_<seed>.png (cut-outs), glb/<name>_<seed>.glb, logs/."""
import os, sys, subprocess, time, tarfile, glob, json

T0 = time.time()
for d in ('img', 'glb', 'logs'): os.makedirs(f'/content/{d}', exist_ok=True)


def sh(cmd, log=None, env=None):
    print(f'\n$ {cmd[:160]}   [{(time.time() - T0) / 60:.1f} min]', flush=True)
    f = open(f'/content/logs/{log}.log', 'a') if log else None
    p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, bufsize=1)
    tail = []
    for line in p.stdout:
        if f: f.write(line)
        tail = (tail + [line])[-30:]
        if not log or line.startswith(('DONE', 'ERR', 'Successfully installed')): print(line, end='', flush=True)
    p.wait()
    if f: f.close()
    if p.returncode:
        print(''.join(tail), flush=True)
        raise RuntimeError(f'command failed ({p.returncode}): {cmd[:160]}')


TREES = {  # only the species still missing; picked cut-outs come in /content/pick.tgz
    'banyan': 'a single large old evergreen shade tree in a Taipei park, short thick smooth grey trunk that splits into a few heavy limbs, a very wide dense dome-shaped canopy of small glossy dark green leaves, wider than it is tall',
}
OLD = {
    'camphor': 'a single mature camphor tree (Cinnamomum camphora) growing on a city sidewalk, short straight grey-brown trunk, broad dense rounded crown of glossy light green leaves',
    'banyan': 'a single old Chinese banyan tree (Ficus microcarpa), thick gnarled trunk with a few hanging aerial roots, very wide dense dark green spreading crown',
    'luan': 'a single Taiwan golden rain tree (Koelreuteria elegans) in autumn, slender trunk, rounded open crown of green leaves topped with clusters of yellow flowers and pink seed pods',
    'palm': 'a single royal palm tree (Roystonea regia), tall smooth pale grey columnar trunk, green crown shaft, crown of long arching feathery fronds at the top',
    'tall': 'a single tall Madagascar almond tree (Terminalia mantaly) street tree, straight upright trunk with neat horizontal tiers of branches and small bright green leaves, narrow pagoda-like shape',
}
SUFFIX = ', the whole tree fully visible from the base of the trunk to the top of the crown, side view, centered, isolated on a plain pure white background, photorealistic, soft even daylight, sharp detail'
NEG = 'bonsai, pot, planter, exposed roots, gnarled root mass, cropped, cut off, multiple trees, forest, ground, grass, people, building, car, text, watermark, frame, border, shadow, painting, illustration, cartoon'

try:
    tok = open('/content/hf_token').read().strip(); os.remove('/content/hf_token')
    os.makedirs('/root/.cache/huggingface', exist_ok=True); open('/root/.cache/huggingface/token', 'w').write(tok)
    env = dict(os.environ, HF_TOKEN=tok, PYTHONUNBUFFERED='1')
    sh('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv; nvcc --version | tail -2; python -c "import torch;print(torch.__version__, torch.version.cuda)"')

    # ---- 1. SDXL photos + BiRefNet cut-outs (Colab's stock torch; torchao conflicts with new diffusers)
    open('/content/gen.py', 'w').write(r'''
import torch, json, sys
from diffusers import StableDiffusionXLPipeline
from transformers import AutoModelForImageSegmentation
from torchvision import transforms
TREES, SUFFIX, NEG = json.load(open('/content/trees.json'))
pipe = StableDiffusionXLPipeline.from_pretrained('stabilityai/stable-diffusion-xl-base-1.0', torch_dtype=torch.float16, variant='fp16', use_safetensors=True).to('cuda')
g = torch.Generator('cuda'); raw = []
for name, prompt in TREES.items():
    for seed in (31, 32, 33, 34):
        g.manual_seed(seed)
        im = pipe(prompt + SUFFIX, negative_prompt=NEG, num_inference_steps=32, guidance_scale=6.5, width=896, height=1152, generator=g).images[0]
        raw.append((f'{name}_{seed}', im)); print('DONE sdxl', name, seed, flush=True)
del pipe; torch.cuda.empty_cache()
seg = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).cuda().eval().half()
tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
for key, im in raw:
    with torch.no_grad(): m = seg(tf(im).unsqueeze(0).cuda().half())[-1].sigmoid().float().cpu()[0].squeeze()
    im = im.convert('RGBA'); im.putalpha(transforms.ToPILImage()(m).resize(im.size)); im.save(f'/content/img/{key}.png')
print('DONE cutouts', flush=True)
''')
    json.dump([TREES, SUFFIX, NEG], open('/content/trees.json', 'w'))
    sh('mkdir -p /content/img && tar xzf /content/pick.tgz -C /content/img && ls /content/img')
    sh('pip uninstall -y -q torchao; pip install -q -U diffusers accelerate timm kornia', log='pip_sdxl', env=env)
    sh('python /content/gen.py', log='gen', env=env)
    print(f'images done at {(time.time() - T0) / 60:.1f} min', flush=True)

    # ---- 2. TRELLIS.2 (PyTorch SDPA instead of flash-attn / xformers: no source build, no torch version lock-in)
    arch = subprocess.run("python -c \"import torch;c=torch.cuda.get_device_capability();print(f'{c[0]}.{c[1]}')\"", shell=True, capture_output=True, text=True).stdout.strip()
    env2 = dict(env, TORCH_CUDA_ARCH_LIST=arch, MAX_JOBS='8', ATTN_BACKEND='sdpa', SPARSE_ATTN_BACKEND='sdpa')
    sh('GIT_LFS_SKIP_SMUDGE=1 git clone -q --recursive -b main https://github.com/microsoft/TRELLIS.2.git /content/T2')
    sh('pip install -q "transformers==4.57.3" imageio imageio-ffmpeg easydict opencv-python-headless ninja trimesh zstandard lpips '
       'git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8', log='pip_t2', env=env2)
    sh('python /content/patch_sdpa.py /content/T2')
    for name, url, br in [('nvdiffrast', 'https://github.com/NVlabs/nvdiffrast.git', '-b v0.4.0'),
                          ('CuMesh', 'https://github.com/JeffreyXiang/CuMesh.git', '--recursive'),
                          ('FlexGEMM', 'https://github.com/JeffreyXiang/FlexGEMM.git', '--recursive')]:
        sh(f'git clone -q {br} {url} /tmp/ext/{name} && pip install /tmp/ext/{name} --no-build-isolation', log=f'build_{name}', env=env2)
    sh('cp -r /content/T2/o-voxel /tmp/ext/o-voxel && pip install /tmp/ext/o-voxel --no-build-isolation', log='build_ovoxel', env=env2)
    print(f'TRELLIS.2 install done at {(time.time() - T0) / 60:.1f} min', flush=True)

    open('/content/run_t2.py', 'w').write(r'''
import os, sys, glob, json, time
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
sys.path.insert(0, '/content/T2')
from huggingface_hub import snapshot_download
from PIL import Image
import torch, o_voxel
from trellis2.pipelines import Trellis2ImageTo3DPipeline
p = snapshot_download('microsoft/TRELLIS.2-4B')
cfg = json.load(open(p + '/pipeline.json')); cfg['args']['rembg_model']['args']['model_name'] = 'ZhengPeng7/BiRefNet'
local = '/content/t2model'; os.makedirs(local, exist_ok=True)
for f in os.listdir(p):
    if f != 'pipeline.json' and not os.path.exists(f'{local}/{f}'): os.symlink(f'{p}/{f}', f'{local}/{f}')
json.dump(cfg, open(local + '/pipeline.json', 'w'))
pipe = Trellis2ImageTo3DPipeline.from_pretrained(local); pipe.cuda()
for path in sorted(glob.glob('/content/img/*.png')):
    key = os.path.basename(path)[:-4]; t = time.time()
    try:
        mesh = pipe.run(Image.open(path), seed=1)[0]
        mesh.simplify(16777216)
        glb = o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords, attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], decimation_target=60000, texture_size=2048,
            remesh=True, remesh_band=1, remesh_project=0, verbose=False)
        glb.export(f'/content/glb/{key}.glb', extension_webp=True)
        print('DONE', key, round(time.time() - t, 1), 's', flush=True)
    except Exception as e:
        print('ERR', key, repr(e)[:300], flush=True)
    torch.cuda.empty_cache()
''')
    sh('cd /content/T2 && python /content/run_t2.py', log='trellis', env=env2)
finally:
    with tarfile.open('/content/trees.tgz', 'w:gz') as tf:
        for d in ('/content/img', '/content/glb', '/content/logs'):
            if os.path.exists(d): tf.add(d, arcname=os.path.basename(d))
    print(f'packed /content/trees.tgz at {(time.time() - T0) / 60:.1f} min', flush=True)
