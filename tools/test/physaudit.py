#!/usr/bin/env python3
"""Physics and clipping audit without a browser: the real game.js runs in Node (tools/test/node/world.js) and
tools/test/js/physaudit.js drives the car through fixed scenarios on each Taipei preset.

  python3 tools/test/physaudit.py [--src CHECKOUT] [--presets 0,1,2] [--set quick|full] [--pack FILE --track ID]
  python3 tools/test/run.py phys ...            (same thing, through the common runner)

Prints one JSON object (per preset: static checks and every scenario's events) and exits 0 when every threshold
holds, 1 when one fails (listed in "failures"), 2 when it could not run. Deterministic: same checkout, same numbers.

What a scenario counts (physaudit.js): beyondWall (frames with the car centre > 5 cm past barrier - 1 m; maxOverWall the deepest, fails above 0.8 m), inBuilding (car body inside a
data/taipei.json footprint), kJump (track index jumps), teleport, spike / spikeWall (speed changes > 8 g), jolt
(vertical > 4 g), stuck (slower than 1 m/s for 3 s), aiAiDeep (computer cars closer than 1.2 m, pair-frames),
aiOverlapDeep (player and a computer car closer than 1.2 m), dist60M (metres driven in the first 60 s).
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import instrument as I  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
WORLD = os.path.join(HERE, 'node', 'world.js')
CHECK = os.path.join(HERE, 'js', 'physaudit.js')

SETS = {
    'full': [
        # first, on the fresh world: the player's car stopped on the 中正紀念堂 grid nose-first against the barrier (seed 8, P2)
        {'name': '電腦車9台故意撞 種子8', 'mode': 'ai', 'secs': 120, 'fps': 60, 'seed': 8},
        {'name': '一般 60fps', 'mode': 'normal', 'secs': 120, 'fps': 60},
        {'name': '一般 30fps', 'mode': 'normal', 'secs': 120, 'fps': 30},
        {'name': '一般 12fps 上限0.05', 'mode': 'normal', 'secs': 120, 'fps': 12, 'cap': 0.05},
        {'name': '一般 12fps 上限0.1', 'mode': 'normal', 'secs': 120, 'fps': 12, 'cap': 0.1},
        {'name': '貼左牆', 'mode': 'wall', 'secs': 90, 'fps': 60},
        {'name': '全油門不煞車', 'mode': 'nobrake', 'secs': 90, 'fps': 60},
        {'name': '逆向過起點', 'mode': 'wrong', 'secs': 40, 'fps': 60},
        {'name': '電腦車9台故意撞', 'mode': 'ai', 'secs': 120, 'fps': 60},
        {'name': '垂直頂牆（自動油門）', 'mode': 'perp', 'secs': 20, 'fps': 60},
        {'name': '垂直頂牆（手動油門）', 'mode': 'perp', 'secs': 20, 'fps': 60, 'autogas': False},
    ],
    'quick': [
        {'name': '電腦車9台故意撞 種子8', 'mode': 'ai', 'secs': 60, 'fps': 60, 'seed': 8},
        {'name': '一般 60fps', 'mode': 'normal', 'secs': 60, 'fps': 60},
        {'name': '電腦車9台故意撞', 'mode': 'ai', 'secs': 60, 'fps': 60},
        {'name': '垂直頂牆（自動油門）', 'mode': 'perp', 'secs': 20, 'fps': 60},
    ],
}
# events that must stay at 0 in every scenario (the others are reported, not judged)
ZERO = ['inBuilding', 'kJump', 'teleport']  # plus 'stuck' (the player's car with the automatic throttle) except driving the wrong way
MAX_OVER_WALL = 0.8             # m past "barrier - 1 m", measured per frame against the nearest sample: hard impacts at 100+ km/h read 0.6-0.7 m on main too (the contact resolves within a physics step); more than this is a real pass-through
ZERO_AI = ['aiAiDeep', 'aiStuck']  # computer cars never closer than 1.2 m (P1), never stopped for 3 s after their start
DROP = ['x', 'z', 'lx', 'lz', 'hwL', 'hwR', 'wallL', 'wallR', 'surf', 'elev', 'rname', 'two', 'lanes', 'activeTiles']


def run(src=REPO, presets=(0, 1, 2), set_name='full', out_root=I.DEFAULT_OUT_ROOT, extra_specs=(), judge_ai=True, timeout=1800):
    """returns (report dict, failures list)"""
    copy = os.path.join(out_root, f'www-phys-{os.getpid()}')
    I.instrument(src, copy, out_root)
    specs = [({'preset': p}, f'preset {p}') for p in presets] + list(extra_specs)
    out = {'check': 'phys', 'set': set_name, 'tracks': {}}
    fails = []
    try:
        for spec, label in specs:
            t0 = time.time()
            arg = {'scenarios': SETS[set_name], 'seed': 1}  # seeded: the same checkout always gives the same numbers
            r = subprocess.run(['node', WORLD, copy, json.dumps({**spec, 'check': CHECK, 'arg': arg})], capture_output=True, text=True, timeout=timeout)
            if r.returncode != 0:
                fails.append(f'{label}: world.js exit {r.returncode}: {r.stderr.strip()[-300:]}')
                continue
            d = json.loads(r.stdout)
            for k in DROP: d.pop(k, None)
            d['secs'] = round(time.time() - t0, 1)
            out['tracks'][label] = d
            chk = d.get('check') or {}
            if 'error' in chk:
                fails.append(f'{label}: {chk["error"][:200]}')
                continue
            if chk.get('stat', {}).get('bldInCorridor'):
                fails.append(f'{label}: 車子可到的範圍內有建物腳印 {chk["stat"]["bldInCorridor"]} 處')
            for run_ in chk.get('runs', []):
                if 'error' in run_:
                    fails.append(f'{label} {run_["name"]}: {run_["error"][:200]}')
                    continue
                ev = run_['ev']
                for k in ZERO + (ZERO_AI if judge_ai and run_['mode'] == 'ai' else []) + (['stuck'] if run_['mode'] in ('normal', 'ai', 'wall', 'nobrake') else []):
                    if ev.get(k):
                        fails.append(f'{label} {run_["name"]}: {k} = {ev[k]}')
                if ev.get('maxOverWall', 0) > MAX_OVER_WALL:
                    fails.append(f'{label} {run_["name"]}: 穿過護欄 {ev["maxOverWall"]} m')
                if run_['mode'] == 'perp' and run_.get('autogas', True) and run_.get('freedAt') is None and not run_.get('resets'):
                    fails.append(f'{label} {run_["name"]}: 頂牆後沒有脫困也沒有重置')
    finally:
        I.remove_copy(copy, out_root, src)
    out['ok'] = not fails
    out['failures'] = fails
    return out, fails


def ints(s):
    return [int(x) for x in s.split(',') if x.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default=REPO)
    ap.add_argument('--out-root', default=I.DEFAULT_OUT_ROOT)
    ap.add_argument('--presets', type=ints, default=[0, 1, 2])
    ap.add_argument('--set', default='full', choices=sorted(SETS))
    ap.add_argument('--pack', help='also audit a track from a track pack file (see data/trackpacks/README.md)')
    ap.add_argument('--track', help='track id inside --pack')
    ap.add_argument('--loop', help='also audit a loop given as JSON [[X, Y], ...] in data coordinates')
    ap.add_argument('--no-ai-judge', action='store_true', help='report computer-car overlaps without failing on them')
    a = ap.parse_args()
    extra = [({'pack': os.path.abspath(a.pack), 'id': a.track}, f'pack {a.track}')] if a.pack else []
    if a.loop: extra.append(({'loop': json.loads(a.loop)}, 'loop'))
    try:
        out, fails = run(os.path.realpath(a.src), a.presets, a.set, a.out_root, extra, not a.no_ai_judge)
    except (I.InstrumentError, subprocess.TimeoutExpired, OSError) as e:
        print(json.dumps({'check': 'phys', 'ok': False, 'harnessError': str(e)}, ensure_ascii=False))
        return 2
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
