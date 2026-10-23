"""Combine the pair judgements (real Mapillary photo vs game render) into issues, second-opinion lists and street observations.

  python3 tools/streetview/pairs_analyse.py <tag> [--second <second model jsonl>]

Reads <work>/vlm/svpair<tag>/out/Qwen3-VL-32B-Instruct.jsonl (primary), <work>/mapillary/poses.json, and optionally the
second family's answers (Mistral-Small on the disputed pairs). Writes in <work>/pairs_<tag>/:
  second_ids.txt   pairs for the second family: any mismatch on a driving-scale item, low confidence, or not the same place
  summary.json     per track: pairs, same-place rate, mismatches per item (primary, and confirmed by both families)
  observations.json  arcade / ground-floor use per side seen in the photo (primary, confident, same place; for derive_params --street);
                     where the second family answered, both must agree
"""
import argparse, json, os
from collections import Counter, defaultdict
ap = argparse.ArgumentParser(); ap.add_argument('tag'); ap.add_argument('--second', default=''); ap.add_argument('--poses', default=''); a = ap.parse_args()
W = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), 'streetview', 'work')
import glob
P = {p['id']: p for f in (sorted(glob.glob(a.poses)) if a.poses else [f'{W}/mapillary/poses.json']) for p in json.load(open(f))}
prim = {}
for l in open(f'{W}/vlm/svpair{a.tag}/out/Qwen3-VL-32B-Instruct.jsonl'):
    r = json.loads(l); prim[r['id']] = r['parsed'] or {}
sec = {}
if a.second and os.path.exists(a.second):
    for l in open(a.second):
        r = json.loads(l); sec[r['id']] = r['parsed'] or {}
ITEMS = ['left_buildings', 'right_buildings', 'left_arcade', 'right_arcade', 'left_use', 'right_use', 'landmark', 'street_trees', 'lanes_same_direction', 'road_width', 'median', 'sidewalk', 'elevated_road', 'roofline']
MAJOR = ['left_buildings', 'right_buildings', 'landmark', 'street_trees', 'lanes_same_direction', 'road_width', 'elevated_road', 'left_arcade', 'right_arcade', 'left_use', 'right_use']
def m(d, k): v = d.get(k); return (v.get('match') if isinstance(v, dict) else None) or 'unclear'
def conf(d):
    try: return float(d.get('confidence') or 0)
    except (TypeError, ValueError): return 0.0
os.makedirs(f'{W}/pairs_{a.tag}', exist_ok=True)
second, summ, obs, issues = [], defaultdict(lambda: {'pairs': 0, 'same_place': 0, 'mismatch': Counter(), 'confirmed': Counter(), 'second_checked': 0}), [], []
for pid, d in prim.items():
    tr = pid.rsplit('_', 2)[0]; s = summ[tr]; s['pairs'] += 1
    same = d.get('same_place') == 'yes'; s['same_place'] += same
    mis = [k for k in MAJOR if m(d, k) in ('no', 'game_wider', 'game_narrower')]
    if mis or conf(d) < 0.6 or not same: second.append(pid)
    if not same: continue
    e = sec.get(pid)
    if e is not None: s['second_checked'] += 1
    for k in mis:
        s['mismatch'][k] += 1
        both = e is not None and e.get('same_place') == 'yes' and m(e, k) == m(d, k)
        if both: s['confirmed'][k] += 1
        p = P.get(pid, {})
        issues.append({'id': pid, 'track': tr, 'item': k, 'primary': d.get(k), 'second': e.get(k) if e else None, 'confirmed': both, 'X': p.get('X'), 'Y': p.get('Y'), 'heading': p.get('heading'),
                       'missing': d.get('missing_in_game'), 'extra': d.get('extra_in_game')})
    if conf(d) < 0.6: continue
    p = P.get(pid)
    if not p: continue
    for side, sd in (('left', 'L'), ('right', 'R')):
        arc, use = (d.get(f'{side}_arcade') or {}).get('real'), (d.get(f'{side}_use') or {}).get('real')
        if e is not None:  # the second family looked at this pair: keep only what both see
            if (e.get(f'{side}_arcade') or {}).get('real') != arc: arc = None
            if (e.get(f'{side}_use') or {}).get('real') != use: use = None
        if arc in ('yes', 'no') or use in ('storefront', 'residential', 'institutional'):
            obs.append({'id': pid, 'track': tr, 'X': p['X'], 'Y': p['Y'], 'heading': p['heading'], 'side': sd, 'arcade': arc if arc in ('yes', 'no') else None, 'use': use if use in ('storefront', 'residential', 'institutional') else None})
open(f'{W}/pairs_{a.tag}/second_ids.txt', 'w').write('\n'.join(second))
json.dump({t: {**v, 'mismatch': dict(v['mismatch']), 'confirmed': dict(v['confirmed'])} for t, v in summ.items()}, open(f'{W}/pairs_{a.tag}/summary.json', 'w'), ensure_ascii=False, indent=1)
json.dump(obs, open(f'{W}/pairs_{a.tag}/observations.json', 'w'), ensure_ascii=False)
json.dump(issues, open(f'{W}/pairs_{a.tag}/issues.json', 'w'), ensure_ascii=False, indent=1)
print('pairs', len(prim), 'second', len(second), 'observations', len(obs), 'issues', len(issues), 'confirmed', sum(i['confirmed'] for i in issues))
