"""Colab job: classify each footprint crop with a vision-language model (roof type, is there a building).

Runs on the VM from /content (tools/jianzhong/vlm_crops.py makes crops.zip):
  python roof_vlm_job.py crops.zip out.json [model id]

Default model: Qwen/Qwen3-VL-8B-Instruct (Apache-2.0). Greedy decoding, one JSON answer per crop; the raw text is
kept so a bad parse can be checked. Writes partial results every 25 crops (out.json is fetched even after a crash).
"""
import json, os, re, sys, time, zipfile
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForImageTextToText

src, out = sys.argv[1], sys.argv[2]; MODEL = sys.argv[3] if len(sys.argv) > 3 else 'Qwen/Qwen3-VL-8B-Instruct'
z = zipfile.ZipFile(src); z.extractall('/content/crops_in'); idx = json.load(open('/content/crops_in/index.json'))
proc = AutoProcessor.from_pretrained(MODEL)
# a model too large for the card in bf16 is loaded in 4-bit NF4 (bitsandbytes): e.g. Qwen3-VL-32B on a 40 GB A100
free = torch.cuda.get_device_properties(0).total_memory / 2**30; big = '32B' in MODEL or '30B' in MODEL
if big and free < 70:
    from transformers import BitsAndBytesConfig
    q = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
    model = AutoModelForImageTextToText.from_pretrained(MODEL, quantization_config=q, device_map='cuda').eval(); MODEL += ' (4-bit NF4)'
else:
    model = AutoModelForImageTextToText.from_pretrained(MODEL, torch_dtype=torch.bfloat16, device_map='cuda').eval()
print('model', MODEL, 'GPU GB', round(free, 1), flush=True)
PROMPT = (
    'This is a north-up aerial orthophoto of central Taipei (about {side} m across). A red outline marks one building footprint from an old '
    'city 3D model. Look only inside the red outline and answer with one JSON object, no other text:\n'
    '{{"present": "building" | "partial" | "none" | "construction",  // is there a building roof inside the outline today? partial = the outline covers only part of a roof or half of it is ground/trees; none = trees, open ground, parking or road; construction = demolished site or building under construction\n'
    ' "roof": "flat_concrete" | "flat_green" | "metal_sheet" | "pitched_tile" | "dome" | "solar" | "mixed" | "none",  // flat_concrete = grey/white flat concrete roof; flat_green = flat roof with green waterproof coating; metal_sheet = corrugated metal roof or metal rooftop shed covering most of it; pitched_tile = sloped tiled roof incl. palace-style glazed tiles; solar = mostly covered by solar panels; mixed = several kinds\n'
    ' "rooftop": "none" | "tanks" | "sheds" | "garden",\n'
    ' "storeys_guess": integer or null,  // from shadows and context, only if you can\n'
    ' "special": "none" | "palace" | "temple" | "dome" | "school" | "tower",\n'
    ' "confidence": 0.0-1.0}}')
res = {}
t0 = time.time()
for i, it in enumerate(idx):
    im = Image.open(os.path.join('/content/crops_in/crops', it['file'])).convert('RGB')
    msgs = [{'role': 'user', 'content': [{'type': 'image', 'image': im}, {'type': 'text', 'text': PROMPT.format(side=int(it['side_m']))}]}]
    inp = proc.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors='pt').to('cuda')
    with torch.no_grad(): o = model.generate(**inp, max_new_tokens=160, do_sample=False)
    txt = proc.batch_decode(o[:, inp['input_ids'].shape[1]:], skip_special_tokens=True)[0]
    m = re.search(r'\{.*\}', txt, re.S); ans = None
    if m:
        try: ans = json.loads(re.sub(r'//[^\n]*', '', m.group(0)))
        except Exception: ans = None
    res[it['id']] = {'raw': txt, 'ans': ans, 'in_ortho': it['in_ortho']}
    if i % 25 == 0:
        json.dump({'model': MODEL, 'done': i + 1, 'n': len(idx), 'sec': round(time.time() - t0), 'results': res}, open(out, 'w'))
        print(i + 1, '/', len(idx), round(time.time() - t0), 's', flush=True)
json.dump({'model': MODEL, 'done': len(idx), 'n': len(idx), 'sec': round(time.time() - t0), 'results': res}, open(out, 'w'))
print('done', len(idx), round(time.time() - t0), 's')
