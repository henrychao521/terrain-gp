"""Colab job: judge street-level images with open vision-language models (街景體檢).

  python sv_vlm_job.py --models Qwen/Qwen3-VL-32B-Instruct[,mistralai/Mistral-Small-3.1-24B-Instruct-2503] [--batch 8] [--only ids.txt]

Input  /content/in/items.json: [{"id", "kind": "self" | "pair", "images": [relative paths under /content/in/]}]
Output /content/out/<model short name>.jsonl (one line per item: id, raw text, parsed JSON) and /content/out.zip.
kind "self": one game render, glitch checklist. kind "pair": [real photo, game render], scenery checklist.
Greedy decoding. Licences: Qwen3-VL (Apache-2.0), Mistral-Small-3.1 (Apache-2.0). No tokens or keys are used here.
"""
import argparse, gc, json, os, re, time, traceback, zipfile
import torch
from PIL import Image

SELF = ('This is a screenshot from a street racing video game set in Taipei, seen from the driver\'s eye on the road. '
        'Intentional and NOT errors: red/white plastic water barriers along the kerbs, a green-yellow-red guide stripe painted on the road, '
        'simple box-shaped scooters and AC units, repeated facade textures, flat grey ground, low-detail trees.\n'
        'Look for modelling glitches only. Answer with one JSON object, no other text:\n'
        '{"building_in_road": bool,  // a building, wall or column stands on the driven road surface\n'
        ' "floating": bool,  // an object or building hangs in the air with a visible gap below\n'
        ' "sunken": bool,  // an object is sunk into the ground or road\n'
        ' "z_fighting": bool,  // flickering / striped overlap of two coplanar surfaces\n'
        ' "broken_arcade": bool,  // arcade (covered walkway under buildings) with walls sticking out, missing columns over a gap, or shop fronts outside the building\n'
        ' "texture_error": bool,  // stretched, smeared, black, magenta or upside-down textures\n'
        ' "bad_signage": bool,  // signs floating, facing the wrong way, inside walls, or absurdly large\n'
        ' "overlapping_meshes": bool,  // two buildings or parts interpenetrating\n'
        ' "holes": bool,  // missing walls, see-through buildings, gaps in the road or ground\n'
        ' "where": "left" | "centre" | "right" | "several" | "none",\n'
        ' "worst": "short description of the worst glitch, or none",\n'
        ' "confidence": 0.0-1.0}')
PAIR = ('Image 1 is a real street photo in Taipei. Image 2 is a racing video game rendered from about the same position and direction '
        '(the game has simplified textures, red/white water barriers and a coloured guide stripe on the road - ignore those). '
        'Compare the SCENERY of the game with the real photo, item by item. Judge the left side and the right side of the road separately. '
        'Answer with one JSON object, no other text. For each item give the real value, the game value and whether they match:\n'
        '{"left_buildings": {"real": "none|low(1-3 floors)|mid(4-7)|high(8-15)|tower(16+)", "game": "...", "match": "yes|no|unclear"},\n'
        ' "right_buildings": {...same...},\n'
        ' "left_arcade": {"real": "yes|no|unclear", "game": "yes|no", "match": "yes|no|unclear"},  // 騎樓: covered walkway under the first floor along the street\n'
        ' "right_arcade": {...},\n'
        ' "left_use": {"real": "storefront|residential|institutional|park|none|unclear", "game": "...", "match": "..."},  // ground floor use facing the street\n'
        ' "right_use": {...},\n'
        ' "roofline": {"match": "yes|no|unclear", "note": "..."},  // overall skyline / roof shapes visible\n'
        ' "landmark": {"real": "name or none", "game": "name or none", "match": "yes|no|unclear"},  // temple, gate, memorial hall, station, notable building\n'
        ' "street_trees": {"real": "none|few|many", "game": "none|few|many", "match": "yes|no|unclear"},\n'
        ' "lanes_same_direction": {"real": int or null, "game": int or null, "match": "yes|no|unclear"},\n'
        ' "road_width": {"match": "yes|game_wider|game_narrower|unclear"},\n'
        ' "median": {"real": "none|line|barrier|planted|unclear", "game": "...", "match": "..."},\n'
        ' "sidewalk": {"real": "none|narrow|wide|unclear", "game": "...", "match": "..."},\n'
        ' "elevated_road": {"real": "yes|no", "game": "yes|no", "match": "yes|no|unclear"},  // viaduct / overpass visible\n'
        ' "missing_in_game": "objects in the photo that the game lacks, or none",\n'
        ' "extra_in_game": "objects in the game that are not in the photo, or none",\n'
        ' "same_place": "yes|no|unclear",  // do the two views plausibly show the same street and direction?\n'
        ' "confidence": 0.0-1.0}')
PROMPTS = {'self': SELF, 'pair': PAIR}

ap = argparse.ArgumentParser(); ap.add_argument('--models', default='Qwen/Qwen3-VL-32B-Instruct'); ap.add_argument('--batch', type=int, default=8)
ap.add_argument('--only', default=''); ap.add_argument('--max-new', type=int, default=700)
a = ap.parse_args()
IN, OUT = '/content/in', '/content/out'; os.makedirs(OUT, exist_ok=True)
ITEMS = json.load(open(f'{IN}/items.json'))
if a.only and os.path.exists(a.only): keep = set(open(a.only).read().split()); ITEMS = [i for i in ITEMS if i['id'] in keep]
RUN = {'gpu': torch.cuda.get_device_name(0), 'torch': torch.__version__, 'n': len(ITEMS), 'models': {}}
def log(*x): print(time.strftime('%H:%M:%S'), *x, flush=True)

def parse(txt):
    m = re.search(r'\{.*\}', txt or '', re.S)
    if not m: return None
    s = re.sub(r'//[^\n]*', '', m.group(0))
    for t in (s, re.sub(r',\s*([}\]])', r'\1', s)):
        try: return json.loads(t)
        except Exception: pass
    return None

def run_model(name):
    from transformers import AutoProcessor, AutoModelForImageTextToText
    t0 = time.time(); proc = AutoProcessor.from_pretrained(name)
    tok = getattr(proc, 'tokenizer', None)
    if tok is not None: tok.padding_side = 'left'
    model = AutoModelForImageTextToText.from_pretrained(name, dtype=torch.bfloat16, device_map='cuda', attn_implementation='sdpa').eval()
    tl = time.time() - t0; log('loaded', name, round(tl), 's', round(torch.cuda.max_memory_allocated() / 2**30, 1), 'GB')
    fn = f"{OUT}/{name.split('/')[-1]}.jsonl"; done = set()
    if os.path.exists(fn): done = {json.loads(l)['id'] for l in open(fn)}
    f = open(fn, 'a'); bad = 0; todo = [i for i in ITEMS if i['id'] not in done]
    for s in range(0, len(todo), a.batch):
        bb = todo[s:s + a.batch]
        msgs = [[{'role': 'user', 'content': [{'type': 'image', 'image': Image.open(f"{IN}/{p}").convert('RGB')} for p in it['images']] + [{'type': 'text', 'text': PROMPTS[it['kind']]}]}] for it in bb]
        try:
            inp = proc.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors='pt', padding=True).to('cuda')
            if 'pixel_values' in inp: inp['pixel_values'] = inp['pixel_values'].to(torch.bfloat16)
            with torch.no_grad(): out = model.generate(**inp, max_new_tokens=a.max_new, do_sample=False, temperature=None, top_p=None, top_k=None)
            txts = proc.batch_decode(out[:, inp['input_ids'].shape[1]:], skip_special_tokens=True)
        except Exception:
            txts = ['ERROR ' + traceback.format_exc()[-600:]] * len(bb)
        for it, t in zip(bb, txts):
            d = parse(t); bad += d is None
            f.write(json.dumps({'id': it['id'], 'raw': t, 'parsed': d}, ensure_ascii=False) + '\n')
        f.flush()
        if (s // a.batch) % 10 == 0: log(name, s + len(bb), '/', len(todo))
    f.close()
    RUN['models'][name] = {'n': len(todo), 'unparsed': bad, 'load_sec': round(tl), 'sec': round(time.time() - t0), 'peak_gb': round(torch.cuda.max_memory_allocated() / 2**30, 1)}
    del model; gc.collect(); torch.cuda.empty_cache(); torch.cuda.reset_peak_memory_stats()

try:
    for m in a.models.split(','):
        try: run_model(m)
        except Exception: RUN['models'][m] = {'error': traceback.format_exc()[-1500:]}; log('FAILED', m); traceback.print_exc()
finally:
    json.dump(RUN, open(f'{OUT}/run.json', 'w'), indent=1)
    with zipfile.ZipFile('/content/out.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for fn in os.listdir(OUT): z.write(f'{OUT}/{fn}', fn)
    log('done', json.dumps(RUN)[:1500])
