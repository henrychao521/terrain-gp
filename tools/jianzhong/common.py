"""Shared settings for the 建中 corridor tools (tools/jianzhong/).

Data frame: metres east / north of TWD97 TM2 (EPSG:3826) E 299000 / N 2766400, as in data/taipei.json.
Game world frame: x = X - 2800, z = 2100 - Y (data/taipei.json is 280 x 210 cells of 20 m).
"""
import json, math, os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.environ.get('JZ_REF', os.path.join(REPO, 'ref'))          # raw downloads and clipped reference layers (gitignored)
WORK = os.environ.get('JZ_WORK', os.path.join(os.path.dirname(REPO), 'work'))  # scratch outputs outside the repo
E0, N0 = 299000.0, 2766400.0
SX, SY = 5600.0, 4200.0
# the loop tested by the iOS port: 南海路 (westbound) → 和平西路二、一段 → 重慶南路三、二段, counter-clockwise
LOOP = [[2915, 3002], [2700, 2962], [2470, 2878], [2760, 2655], [3050, 2510], [2995, 2760]]
CLIP_M = 150.0  # corridor: within this distance of the driven centreline


def data_to_world(X, Y): return X - SX / 2, SY / 2 - Y
def world_to_data(x, z): return x + SX / 2, SY / 2 - z


def load_track(path=None):
    """centreline of the loop as built by the game (tools/test/node/world.js output)"""
    t = json.load(open(path or os.environ.get('JZ_TRACK') or os.path.join(WORK, 'track_loop_before.json')))  # JZ_TRACK: another circuit (tools/streetview)
    t['X'] = [x + SX / 2 for x in t['x']]; t['Y'] = [SY / 2 - z for z in t['z']]
    return t


def corridor_polygon(track=None, dist=CLIP_M):
    from shapely.geometry import Polygon
    t = track or load_track()
    return Polygon(list(zip(t['X'], t['Y']))).buffer(dist, join_style=2) if dist >= 0 else None


def corridor_band(track=None, dist=CLIP_M):
    """±dist of the centreline (inside and outside the loop)"""
    from shapely.geometry import LinearRing
    t = track or load_track()
    return LinearRing(list(zip(t['X'], t['Y']))).buffer(dist)
