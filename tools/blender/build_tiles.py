"""Build every Taipei scenery tile and write models/taipei/tiles.json.

  python3 tools/blender/build_tiles.py <texture dir> <tile list json> [tile size m] [parallel jobs]

The tile list holds [i, j] grid cells (tile size metres, origin TWD97 E 299000 / N 2766400); pick the cells a
circuit passes through. Textures come from tools/blender/make_textures.py.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
TEX, LIST = sys.argv[1], sys.argv[2]; TS = float(sys.argv[3]) if len(sys.argv) > 3 else 700; JOBS = int(sys.argv[4]) if len(sys.argv) > 4 else 3
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
cells = json.load(open(LIST)); os.makedirs('models/taipei', exist_ok=True)
def build(c):
    i, j = c; x0, y0 = i * TS, j * TS; out = f'models/taipei/t_{i}_{j}.gltf'
    r = subprocess.run([BLENDER, '-b', '--factory-startup', '--python', 'tools/blender/build_tile.py', '--', 'data', TEX, str(x0), str(x0 + TS), str(y0), str(y0 + TS), out], capture_output=True, text=True)
    line = [l for l in r.stdout.splitlines() if l.startswith(('wrote', 'buildings', 'Traceback', 'Error'))]
    print(i, j, ' | '.join(line), flush=True)
    return {'file': os.path.basename(out), 'x0': x0, 'x1': x0 + TS, 'y0': y0, 'y1': y0 + TS} if os.path.exists(out) else None
with ThreadPoolExecutor(JOBS) as ex: tiles = [t for t in ex.map(build, cells) if t]
json.dump({'note': 'Blender-built scenery tiles (tools/blender/build_tiles.py). Bounds in metres east/north of TWD97 E 299000 / N 2766400.', 'tiles': tiles},
          open('models/taipei/tiles.json', 'w'), ensure_ascii=False, indent=1)
print('tiles', len(tiles))
