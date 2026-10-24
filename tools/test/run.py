#!/usr/bin/env python3
"""Terrain GP regression and measurement checks. See tools/test/README.md.

Each run copies the checkout into tools/test/.out, patches the copy (instrument.py), serves it on a free local port,
drives it in Google Chrome with Playwright, prints one JSON object on stdout and exits with
  0  every threshold passed      1  a threshold failed (see "failures")
  2  the check could not run     130  interrupted (Ctrl-C)

  python3 tools/test/run.py walls            buildings inside the carriageway, Taipei presets
  python3 tools/test/run.py line             racing line inside the road, lap time centre vs line
  python3 tools/test/run.py ai               computer drivers, faster than real time
  python3 tools/test/run.py envelope         car performance on flat tarmac
  python3 tools/test/run.py quick            walls + line + ai (60 s per preset) + envelope
  python3 tools/test/run.py bench            frame rate (real time, alone on the machine)
  python3 tools/test/run.py novice           keyboard novice bot (real time, alone on the machine)
  python3 tools/test/run.py phys             physics / clipping audit in Node, no browser (tools/test/physaudit.py)
  python3 tools/test/run.py quick --no-browser   only the checks that need no Chrome (phys, quick set); lists the skipped ones
"""
import argparse
import contextlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import harness as H  # noqa: E402
import instrument as I  # noqa: E402
import physaudit as PA  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))

# thresholds (README.md, "各項檢查")
AI_CONTACT_PER_240S = 12.0  # summed car-to-car contact seconds, scaled to a 240 s race
AI_OFFROAD_PER_240S = 2.0   # summed off-road seconds of all computer cars, scaled to a 240 s race
AI_PLAYER_CONTACT_PER_240S = 1.0  # computer cars touching the player's car parked on the grid, scaled to a 240 s race
AI_SCALE_MIN_SECS = 120     # shorter runs are judged as if they lasted this long: the start alone has some contact


def ints(s):
    return [int(x) for x in str(s).split(',') if x.strip() != '']


class Report:
    def __init__(self, check):
        self.check, self.t0 = check, time.time()
        self.results, self.failures, self.errors, self.warnings = [], [], [], []

    def fail(self, msg):
        H.log('FAIL', msg)
        self.failures.append(msg)

    def page(self, g):
        self.errors += g.errors
        self.warnings += [w for w in g.warnings if w not in self.warnings]

    def out(self, src):
        if self.errors:
            self.failures.append(f'{len(self.errors)} console / page error(s)')
        return {'check': self.check, 'ok': not self.failures, 'failures': self.failures, 'results': self.results,
                'errors': self.errors[:20], 'warnings': self.warnings, 'src': src, 'elapsedSec': round(time.time() - self.t0)}


@contextlib.contextmanager
def session(a):
    """yields (browser, url) for an instrumented copy of a.src (or for --url)"""
    if a.url:
        with H.chrome(a.headless) as br:
            yield br, a.url.rstrip('/') + '/'
        return
    dst = os.path.join(a.out_root, f'www-{os.getpid()}')
    H.log('instrumenting', os.path.realpath(a.src), '->', dst)
    I.instrument(a.src, dst, a.out_root)
    try:
        with H.serve(dst) as url, H.chrome(a.headless) as br:
            H.log('serving', url)
            yield br, url
    finally:
        if a.keep:
            H.log('kept', dst)
        else:
            I.remove_copy(dst, a.out_root, a.src)


# ---------------------------------------------------------------- walls / line
NEEDS_TRACK = ['W', 'RACE', 'scene', 'Sq', 'buildWorld', 'buildProfileFn', 'CITY', 'setup', 'placeCar', 'car', 'state']


def track(br, url, rep, presets, walls, line, tile_timeout, shots=None):
    for c in presets:
        g = H.Game(br, url, NEEDS_TRACK, viewport=(1280, 720)).open()
        try:
            name = g.taipei(c)
            H.log(f'preset {c} {name}: building')
            g.pg.evaluate('TGP.buildWorld()')
            r = {'preset': c, 'name': name}
            if line:
                L = r['line'] = g.run('line.js')
                if L['out'] > 0:
                    rep.fail(f'preset {c}: racing line leaves the road at {L["out"]} samples, first {L["outAt"][:3]}')
                if L['lapLine'] > L['lapCentre']:
                    rep.fail(f'preset {c}: racing line lap {L["lapLine"]} s is slower than the centreline {L["lapCentre"]} s')
            if walls:
                try:
                    g.pg.wait_for_function('TGP.W.activeTiles && TGP.W.tiles && TGP.W.tiles.length >= TGP.W.activeTiles.length', timeout=tile_timeout * 1000)
                except Exception:
                    pass  # reported below as missing tiles
                Wr = r['walls'] = g.run('walls.js')
                if Wr['tilesWanted'] == 0 or Wr['buildingMeshes'] == 0:
                    rep.fail(f'preset {c}: no Blender tile buildings to test against (tiles {Wr["tiles"]}/{Wr["tilesWanted"]})')
                elif Wr['tiles'] < Wr['tilesWanted']:
                    rep.fail(f'preset {c}: only {Wr["tiles"]}/{Wr["tilesWanted"]} tiles loaded within {tile_timeout} s')
                if Wr['walls'] > 0:
                    rep.fail(f'preset {c}: {Wr["walls"]} rays hit a building inside the road, first {Wr["wallsAt"][:3]}')
            if shots:
                os.makedirs(shots, exist_ok=True)
                g.controls(previewOn=False, lineGuide=True)
                g.start()
                r['shotAt'] = g.run('line_shot.js')
                g.pg.wait_for_timeout(1500)
                r['shot'] = os.path.abspath(os.path.join(shots, f'line_{c}.png'))
                g.pg.screenshot(path=r['shot'])
            rep.results.append(r)
        finally:
            rep.page(g)
            g.close()


# ---------------------------------------------------------------- ai
NEEDS_AI = ['W', 'RACE', 'state', 'setup', 'setupGrid', 'opponentsStep', 'wrapGap', 'car', 'CITY']


def ai(br, url, rep, presets, seeds, secs, count, skill, max_contact, max_offroad, max_player=AI_PLAYER_CONTACT_PER_240S):
    scale = 240 / max(secs, AI_SCALE_MIN_SECS)
    for c in presets:
        for seed in seeds:
            g = H.Game(br, url, NEEDS_AI, viewport=(800, 500)).open()
            try:
                name = g.taipei(c)
                g.race_mode('ai')
                g.controls(aiCount=count, aiSkill=skill, previewOn=False)
                g.start()
                H.log(f'preset {c} {name} seed {seed}: {secs:g} s with {count} computer cars')
                r = g.run('ai_sim.js', {'secs': secs, 'seed': seed, 'count': count, 'skill': skill})
                if abs(r['skillSetting'] - skill) > 1e-6 or r['cars'] != count:
                    raise H.HarnessError(f'the race ran with skill {r["skillSetting"]} / {r["cars"]} cars, not {skill} / {count}')
                r = {'preset': c, 'name': name, 'seed': seed, 'secs': secs, **r,
                     'contactPer240s': round(r['contactSec'] * scale, 1), 'offroadPer240s': round(r['offroadSec'] * scale, 1),
                     'playerContactPer240s': round(r['playerContactSec'] * scale, 2)}
                tag = f'preset {c} seed {seed}'
                if r['lappedCars']:
                    rep.fail(f'{tag}: {r["lappedCars"]} computer car(s) a lap or more behind the leader (spread {r["spread"]} m, lap {r["trackM"]} m)')
                if r['contactPer240s'] > max_contact:
                    rep.fail(f'{tag}: contact {r["contactSec"]} s in {secs:g} s = {r["contactPer240s"]} s per 240 s (limit {max_contact})')
                if r['offroadPer240s'] > max_offroad:
                    rep.fail(f'{tag}: off-road {r["offroadSec"]} s in {secs:g} s = {r["offroadPer240s"]} s per 240 s (limit {max_offroad})')
                if r['playerContactPer240s'] > max_player:
                    rep.fail(f'{tag}: computer cars touched the parked player for {r["playerContactSec"]} s in {secs:g} s = {r["playerContactPer240s"]} s per 240 s (limit {max_player})')
                rep.results.append(r)
            finally:
                rep.page(g)
                g.close()


# ---------------------------------------------------------------- envelope
NEEDS_ENV = ['car', 'setup', 'genPreset', 'TER', 'buildWorld', 'state', 'W', 'SPEC', 'placeCar', 'keys', 'physicsStep', 'gearLogic', 'inp']


ENVELOPE_SETUP = {'level': 'pro', 'tc': True, 'abs': True, 'esc': False}  # the calibration conditions of tools/f1/README.md


def envelope(br, url, rep, setup_json):
    import json
    g = H.Game(br, url, NEEDS_ENV).open()
    try:
        g.pg.wait_for_timeout(1000)
        r = g.run('envelope.js', {'setup': {**ENVELOPE_SETUP, **(json.loads(setup_json) if setup_json else {})}})
        if r['maxSurf'] != 0:
            rep.fail(f'the car left the tarmac during the runs (surface {r["maxSurf"]}): the numbers are not tarmac numbers')
        if not r['top_kmh'] or r['t_100_200_s'] is None:
            rep.fail(f'no top speed / 100-200 km/h time: {r["top_kmh"]} / {r["t_100_200_s"]}')
        rep.results.append(r)
    finally:
        rep.page(g)
        g.close()


# ---------------------------------------------------------------- bench / novice (real time)
def alone_warning(rep):
    load = os.getloadavg()[0]
    cores = os.cpu_count() or 1
    msg = f'real-time check: run it alone on the machine (load average now {load:.1f} on {cores} cores)'
    H.log(msg)
    if load > cores * 0.25:
        rep.warnings.append(f'machine busy during a real-time check: load average {load:.1f} on {cores} cores; numbers are not comparable')
    return round(load, 1)


def bench(br, url, rep, preset, quality, ai_count, secs, shot, min_fps):
    load = alone_warning(rep)
    g = H.Game(br, url, ['PERF', 'renderer', 'applyQuality', 'q', 'state', 'RACE', 'setup', 'CITY'], viewport=(1600, 900), dpr=2).open(quality)
    try:
        name = g.taipei(preset)
        g.race_mode('ai')
        g.controls(aiCount=ai_count, autogas=True, previewOn=False)
        t0 = time.time()
        g.start(until=('lights', 'race'))
        build_ms = round((time.time() - t0) * 1000)
        g.pg.wait_for_function("TGP.state.mode === 'race'", timeout=30000)
        g.run('bench.js', {'phase': 'begin'})
        g.pg.keyboard.down('ArrowUp')
        H.log(f'measuring {secs:g} s ({quality}, {ai_count} computer cars, preset {preset} {name})')
        H.sleep(secs)
        r = {'preset': preset, 'name': name, 'qualityAsked': quality, 'secs': secs, 'build_ms': build_ms, 'load1': load, **g.run('bench.js', {'phase': 'end'})}
        if shot:
            r['shot'] = os.path.abspath(shot)
            g.pg.screenshot(path=r['shot'])
        if min_fps and r['fps'] < min_fps:
            rep.fail(f'{r["fps"]} fps is below --min-fps {min_fps}')
        rep.results.append(r)
    finally:
        rep.page(g)
        g.close()


def novice(br, url, rep, preset, secs, quality, max_spins, max_hits):
    load = alone_warning(rep)
    g = H.Game(br, url, ['car', 'W', 'keys', 'state', 'setup', 'CITY', 'applyQuality'], viewport=(1000, 600)).open(quality)
    try:
        name = g.taipei(preset)
        g.controls(autogas=True, previewOn=False)
        g.start(until=('race',))
        g.run('novice.js', {'phase': 'begin'})
        H.log(f'novice driving {secs:g} s on preset {preset} {name}')
        H.sleep(secs)
        r = {'preset': preset, 'name': name, 'secs': secs, 'load1': load, **g.run('novice.js', {'phase': 'end'})}
        if max_spins is not None and r['spins'] > max_spins:
            rep.fail(f'{r["spins"]} spins (limit {max_spins})')
        if max_hits is not None and r['wallHits'] > max_hits:
            rep.fail(f'{r["wallHits"]} wall hits (limit {max_hits})')
        rep.results.append(r)
    finally:
        rep.page(g)
        g.close()


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default=REPO, help='checkout to test (default: this repo)')
    ap.add_argument('--out-root', default=I.DEFAULT_OUT_ROOT, help='where the instrumented copy goes (default: tools/test/.out)')
    ap.add_argument('--url', help='test an already instrumented copy at this URL instead of building and serving one')
    ap.add_argument('--keep', action='store_true', help='keep the instrumented copy afterwards')
    ap.add_argument('--headless', action='store_true', help='headless Chrome (WebGL may be missing or software-rendered)')
    sub = ap.add_subparsers(dest='check', required=True)

    def presets(p, default='0,1,2'):
        p.add_argument('--presets', type=ints, default=ints(default), help=f'Taipei presets, comma separated (default {default})')

    p = sub.add_parser('walls', help='buildings inside the carriageway (Taipei presets)')
    presets(p)
    p.add_argument('--tile-timeout', type=int, default=90, help='seconds to wait for the Blender tiles (default 90)')
    p = sub.add_parser('line', help='racing line inside the road, lap time centre vs line')
    presets(p)
    p.add_argument('--shots', help='also save a screenshot before the tightest corner of each preset into this directory')
    p = sub.add_parser('ai', help='computer drivers raced faster than real time')
    presets(p)
    p.add_argument('--seeds', type=ints, default=[1], help='random seeds, comma separated (default 1)')
    p.add_argument('--secs', type=float, default=240, help='simulated seconds per race (default 240)')
    p.add_argument('--count', type=int, default=5, help='computer cars (default 5)')
    p.add_argument('--skill', type=float, default=0.45, help='computer strength 0..1 (default 0.45, the menu default)')
    p.add_argument('--max-contact', type=float, default=AI_CONTACT_PER_240S, help=f'contact seconds per 240 s (default {AI_CONTACT_PER_240S})')
    p.add_argument('--max-offroad', type=float, default=AI_OFFROAD_PER_240S, help=f'off-road seconds per 240 s (default {AI_OFFROAD_PER_240S})')
    p.add_argument('--max-player-contact', type=float, default=AI_PLAYER_CONTACT_PER_240S, help=f'seconds of touching the parked player per 240 s (default {AI_PLAYER_CONTACT_PER_240S})')
    p = sub.add_parser('envelope', help='car performance envelope on flat tarmac')
    p.add_argument('--setup', help='JSON overrides for the game setup, on top of the calibration setup (pro, TC and ABS on, '
                   'ESC off), e.g. \'{"aero": 0.2}\' or \'{"level": "easy", "esc": true}\'')
    p = sub.add_parser('quick', help='walls + line + ai (short) + envelope')
    presets(p)
    p.add_argument('--ai-secs', type=float, default=60, help='simulated seconds per ai race (default 60)')
    p.add_argument('--no-browser', action='store_true', help='run only what needs no Chrome (the Node physics audit) and list the rest as skipped')
    p = sub.add_parser('phys', help='physics and clipping audit in Node, no browser (tools/test/physaudit.py)')
    presets(p)
    p.add_argument('--set', default='full', choices=sorted(PA.SETS))
    p = sub.add_parser('bench', help='frame rate in a Taipei race (real time; run alone)')
    p.add_argument('--preset', type=int, default=0)
    p.add_argument('--quality', default='high', choices=['low', 'mid', 'high'])
    p.add_argument('--ai', type=int, default=5, help='computer cars (default 5)')
    p.add_argument('--secs', type=float, default=30, help='measured seconds (default 30)')
    p.add_argument('--shot', help='save a screenshot at the end to this file')
    p.add_argument('--min-fps', type=float, help='fail below this frame rate')
    p = sub.add_parser('novice', help='keyboard novice bot with automatic throttle (real time; run alone)')
    p.add_argument('--preset', type=int, default=0)
    p.add_argument('--secs', type=float, default=60, help='seconds of driving (default 60)')
    p.add_argument('--quality', default='low', choices=['low', 'mid', 'high'])
    p.add_argument('--max-spins', type=int)
    p.add_argument('--max-hits', type=int)
    a = ap.parse_args()
    H.interruptible()

    src = None if a.url else {'path': os.path.realpath(a.src), **H.git_info(a.src)}
    if a.check == 'phys' or (a.check == 'quick' and a.no_browser):
        try:
            out, _ = PA.run(os.path.realpath(a.src), a.presets, getattr(a, 'set', 'quick') if a.check == 'phys' else 'quick', a.out_root)
        except (I.InstrumentError, OSError) as e:
            H.dump({'check': a.check, 'ok': False, 'harnessError': str(e), 'src': src})
            return 2
        out['src'] = src
        if a.check == 'quick':
            import subprocess
            unit = {}
            for t in ('opponents_test.js', 'recover_test.js'):  # P1 / P2 regression tests on the game.js code itself
                r = subprocess.run(['node', os.path.join(HERE, 'node', t), os.path.join(os.path.realpath(a.src), 'game.js')], capture_output=True, text=True, timeout=600)
                unit[t] = {'ok': r.returncode == 0, 'out': r.stdout.strip().split('\n')}
                if r.returncode: out['failures'].append(f'{t}: ' + ' / '.join(l for l in r.stdout.split('\n') if 'FAIL' in l)); out['ok'] = False
            out = {'check': 'quick', 'src': src, 'checks': {'phys': out, 'unit': unit}, 'skipped': ['walls+line（要 Chrome 的 WebGL 射線與行車線）', 'ai（瀏覽器內的電腦車比賽）', 'envelope（瀏覽器內的性能包絡）'],
                   'ok': out['ok'], 'failures': ['phys: ' + f for f in out['failures']]}
        H.dump(out)
        return 0 if out['ok'] else 1
    try:
        with session(a) as (br, url):
            if a.check == 'quick':
                out = {'check': 'quick', 'src': src, 'checks': {}}
                for name, fn in (('walls+line', lambda r: track(br, url, r, a.presets, True, True, 90)),
                                 ('ai', lambda r: ai(br, url, r, a.presets, [1], a.ai_secs, 5, 0.45, AI_CONTACT_PER_240S, AI_OFFROAD_PER_240S)),
                                 ('envelope', lambda r: envelope(br, url, r, None))):
                    rep = Report(name)
                    fn(rep)
                    out['checks'][name] = rep.out(src)
                out['ok'] = all(c['ok'] for c in out['checks'].values())
                out['failures'] = [f'{n}: {f}' for n, c in out['checks'].items() for f in c['failures']]
            else:
                rep = Report(a.check)
                if a.check == 'walls':
                    track(br, url, rep, a.presets, True, False, a.tile_timeout)
                elif a.check == 'line':
                    track(br, url, rep, a.presets, False, True, 0, a.shots)
                elif a.check == 'ai':
                    ai(br, url, rep, a.presets, a.seeds, a.secs, a.count, a.skill, a.max_contact, a.max_offroad, a.max_player_contact)
                elif a.check == 'envelope':
                    envelope(br, url, rep, a.setup)
                elif a.check == 'bench':
                    bench(br, url, rep, a.preset, a.quality, a.ai, a.secs, a.shot, a.min_fps)
                elif a.check == 'novice':
                    novice(br, url, rep, a.preset, a.secs, a.quality, a.max_spins, a.max_hits)
                out = rep.out(src)
    except KeyboardInterrupt:
        H.log('interrupted')
        return 130
    except (H.HarnessError, I.InstrumentError) as e:
        H.dump({'check': a.check, 'ok': False, 'harnessError': str(e), 'src': src})
        return 2
    except Exception as e:  # Playwright timeouts and the like: the check did not run
        H.dump({'check': a.check, 'ok': False, 'harnessError': f'{type(e).__name__}: {str(e)[:500]}', 'src': src})
        return 2
    H.dump(out)
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
