"""Terrain GP texture job 3: ground-floor shop fronts under a Taipei arcade (騎樓), as strips that tile left-right
(SDXL base 1.0, circular padding along x only), plus normal maps for them (Marigold, x-tiled).
No lettering is wanted: the shop-name band is drawn by the game's own texture script on top, with real characters.
Output: /content/job3.tgz with shops/<name>_<seed>.png and normals/<name>_<seed>_n.png"""
import os, time, tarfile, subprocess, sys
subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'diffusers', 'transformers', 'accelerate'], check=True)
import torch, torch.nn.functional as F
from PIL import Image
from diffusers import StableDiffusionXLPipeline, MarigoldNormalsPipeline

T0 = time.time()
for d in ('shops', 'normals'): os.makedirs(f'/content/{d}', exist_ok=True)


def wrap_x(conv):
    """pad circularly along x (left-right wrap) and with zeros along y, as the model was trained (replicate along y streaks)"""
    ph, pw = conv.padding if isinstance(conv.padding, tuple) else (conv.padding, conv.padding)
    if not (ph or pw): return
    conv.padding = (0, 0)
    conv.register_forward_pre_hook(lambda m, a: (F.pad(F.pad(a[0], (pw, pw, 0, 0), mode='circular'), (0, 0, ph, ph)),))


try:
    pipe = StableDiffusionXLPipeline.from_pretrained('stabilityai/stable-diffusion-xl-base-1.0', torch_dtype=torch.float16, variant='fp16', use_safetensors=True).to('cuda')
    for m in list(pipe.unet.modules()) + list(pipe.vae.modules()):
        if isinstance(m, torch.nn.Conv2d): wrap_x(m)
    NEG = ('text, letters, chinese characters, calligraphy, words, numbers, signage, sign board, banner, logo, brand, poster, menu, label, watermark, '
           'illustration, cartoon, drawing, vector art, flat design, painting, 3d render, people, person, car, '
           'sky, perspective, vanishing point, tilted, diagonal, vignette, blurry, frame, border')
    FLAT = ('orthographic straight-on front view, shop fronts parallel to the image plane, a row of small shops side by side, '
            'seen from the sidewalk under a covered arcade, even soft daylight, real photograph taken with a DSLR, high detail, no text')
    SHOPS = {
        'grocery': 'ground floor of a Taipei street: small family grocery shops with open fronts, shelves of snacks and drinks, plastic crates, warm interior lights, grey terrazzo floor',
        'eatery': 'ground floor of a Taipei street: small noodle and dumpling eateries with stainless steel counters, steamers, round plastic stools and tables, warm lights',
        'shutters': 'ground floor of a Taipei street: a row of closed metal rolling shutters in grey, green and blue, a few potted plants, tiled floor, quiet early morning',
        'clinic': 'ground floor of a Taipei street: a bright clean pharmacy and dental clinic behind glass walls, white interior, shelves of boxes, glass doors',
        'hardware': 'ground floor of a Taipei street: a crowded hardware store with tools, buckets and hoses hanging in the open front, cardboard boxes, fluorescent light',
        'tea': 'ground floor of a Taipei street: a small bubble tea shop counter with sealing machines and cups, a bakery with glass display cases, bright lights',
        'convenience': 'ground floor of a Taipei street: a brightly lit convenience store behind glass, aisles of shelves, fridges with drinks, automatic glass door',
        'oldwood': 'ground floor of an old Taipei street: traditional shops with wooden folding doors and old wooden counters, herbal medicine drawers, warm dim light',
    }
    g = torch.Generator('cuda')
    for name, desc in SHOPS.items():
        for seed in (310, 311, 312):
            g.manual_seed(seed)
            pipe(desc + ', ' + FLAT, negative_prompt=NEG, num_inference_steps=32, guidance_scale=6.5, width=1536, height=576, generator=g).images[0].save(f'/content/shops/{name}_{seed}.png')
        print('shop', name, round(time.time() - T0), flush=True)
    del pipe; torch.cuda.empty_cache()

    mg = MarigoldNormalsPipeline.from_pretrained('prs-eth/marigold-normals-v1-1', variant='fp16', torch_dtype=torch.float16).to('cuda')
    for f in sorted(os.listdir('/content/shops')):
        im = Image.open(f'/content/shops/{f}').convert('RGB').resize((1024, 384)); big = Image.new('RGB', (3072, 384))
        for i in range(3): big.paste(im, (i * 1024, 0))
        n = mg(big, processing_resolution=3072, num_inference_steps=4, ensemble_size=1).prediction
        mg.image_processor.visualize_normals(n)[0].crop((1024, 0, 2048, 384)).save(f'/content/normals/{f[:-4]}_n.png')
    print('normals done', round(time.time() - T0), flush=True)
    print('JOB_OK', flush=True)
finally:
    with tarfile.open('/content/job3.tgz', 'w:gz') as tf:
        for d in ('shops', 'normals'):
            if os.path.exists(f'/content/{d}'): tf.add(f'/content/{d}', arcname=d)
    print('total', round(time.time() - T0), 's', flush=True)
