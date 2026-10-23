"""Pack images for tools/colab/sv_vlm_job.py and run it on Colab through colab_job.py (G4, then A100).

  python3 tools/streetview/vlm_colab.py --name svself1 --items items.json --models Qwen/Qwen3-VL-32B-Instruct [--max-hours 3] [--max-cu 40]

items.json: [{"id", "kind", "images": [absolute local paths]}]. Images are copied (long side <= 1024 px, JPEG 85) into
in/<kind>/<n>.jpg; results land in <work>/vlm/<name>/out.zip (unzipped next to it).
"""
import argparse, json, os, subprocess, tarfile, zipfile
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('--name', required=True); ap.add_argument('--items', required=True); ap.add_argument('--models', default='Qwen/Qwen3-VL-32B-Instruct')
ap.add_argument('--gpu', default='G4,A100'); ap.add_argument('--max-hours', type=float, default=3); ap.add_argument('--max-cu', type=float, default=40); ap.add_argument('--batch', type=int, default=8)
a = ap.parse_args()
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W = os.path.join(os.path.dirname(REPO), 'streetview', 'work', 'vlm', a.name); os.makedirs(W + '/in', exist_ok=True)
items, out = json.load(open(a.items)), []
for i, it in enumerate(items):
    rel = []
    for j, p in enumerate(it['images']):
        r = f"{it['kind']}/{i:05d}_{j}.jpg"; d = os.path.join(W, 'in', r); os.makedirs(os.path.dirname(d), exist_ok=True)
        if not os.path.exists(d):
            im = Image.open(p).convert('RGB'); im.thumbnail((1024, 1024)); im.save(d, quality=85)
        rel.append(r)
    out.append({'id': it['id'], 'kind': it['kind'], 'images': rel})
json.dump(out, open(os.path.join(W, 'in', 'items.json'), 'w'))
tp = os.path.join(W, 'in.tar')
with tarfile.open(tp, 'w') as t: t.add(os.path.join(W, 'in'), 'in')
subprocess.run(f'cd {W} && rm -f in.tar.part* && split -b 40m in.tar in.tar.part', shell=True, check=True)
parts = sorted(os.path.join(W, f) for f in os.listdir(W) if f.startswith('in.tar.part'))
job = os.path.join(REPO, 'tools', 'colab', 'sv_vlm_job.py')
cmd = ('cat in.tar.part* > in.tar && tar xf in.tar && pip uninstall -y torchao >/dev/null 2>&1; pip -q install -U transformers accelerate 2>&1 | tail -2; '
       f'python sv_vlm_job.py --models {a.models} --batch {a.batch}')
r = subprocess.run(['python3', '/Users/Shared/colab-bridge/colab_job.py', 'run', '--name', a.name, '--tag', 'terrain-gp-streetview', '--gpu', a.gpu,
                    '--upload', job, *parts, '--cmd', cmd, '--fetch', f'/content/out.zip:{W}/out.zip', '--max-hours', str(a.max_hours), '--max-cu', str(a.max_cu)])
if os.path.exists(f'{W}/out.zip'): zipfile.ZipFile(f'{W}/out.zip').extractall(f'{W}/out')
print('VLM_COLAB_DONE', a.name, r.returncode, os.listdir(f'{W}/out') if os.path.isdir(f'{W}/out') else None)
