"""Merge the final building footprints of the Blender tiles into models/taipei/footprints.json (D3, docs/賽道修正_2026-10.md).

  python3 tools/blender/footprints.py                         merge models/taipei/*.foot.json (written by build_tile.py)
  python3 tools/blender/footprints.py --from-dump <dump.json>... also take tiles from TGP_DUMP files of earlier builds

build_tile.py writes <tile>.foot.json next to each tile it builds: the footprints exactly as built (road clearance,
corridor parameters; dropped buildings left out). The game replaces the data/taipei.json buildings whose centre lies in
such a tile with these, so the minimap and the street-tree occupancy match the 3D city. Tiles never rebuilt since this
file existed keep their data/taipei.json buildings. Entries already in footprints.json stay unless a newer source
for the same tile is given. Coordinates: decimetres east / north of TWD97 E 299000 / N 2766400; each building is
[height dm, x0, y0, x1, y1, ...] (ring without the closing point).
"""
import glob, json, os, sys

OUT = 'models/taipei/footprints.json'


def tile_name(x0, y0, size=700):
    return f't_{round(x0 / size)}_{round(y0 / size)}'


def from_dump(path):
    d = json.load(open(path))
    b = [[round(e['h'] * 10)] + [round(v * 10) for p in e['ring'] for v in p] for e in d['buildings'] if not e.get('dropped')]
    return tile_name(d['x0'], d['y0']), {'x0': d['x0'], 'x1': d['x1'], 'y0': d['y0'], 'y1': d['y1'], 'b': b}


def main():
    args = sys.argv[1:]
    cur = json.load(open(OUT)) if os.path.exists(OUT) else {}
    tiles = cur.get('tiles', {})
    if args[:1] == ['--from-dump']:
        for f in args[1:]:
            name, t = from_dump(f); tiles[name] = t; print('dump', name, len(t['b']))
    for f in sorted(glob.glob('models/taipei/t_*.foot.json')):
        t = json.load(open(f)); name = os.path.basename(f)[:-len('.foot.json')]; tiles[name] = t; print('tile', name, len(t['b']))
    out = {'note': 'Final building footprints of the Blender tiles (tools/blender/footprints.py); [height dm, x, y, ...] in decimetres east / north of TWD97 E 299000 / N 2766400.',
           'tiles': dict(sorted(tiles.items()))}
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, len(tiles), 'tiles', sum(len(t['b']) for t in tiles.values()), 'buildings', os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
