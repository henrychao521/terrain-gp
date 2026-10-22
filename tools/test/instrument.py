"""Copy a Terrain GP checkout and patch the copy's game.js so test scripts can reach the game's internals.

The game is one IIFE with nothing on window. The patched copy adds:
  - window.TGP: the objects and functions the checks use (car, W, RACE, setup, state, physicsStep, ...);
    TGP.missing lists any name that no longer exists in game.js
  - TGP.PERF: milliseconds spent per phase (physics, computer drivers, render, HUD, whole frame on the CPU)
  - window.__camLock: set it to true to stop the chase camera from moving (for screenshots)

Only the copy is changed, never the checkout. Every patch is anchored on an exact piece of game.js; if game.js
changes so that an anchor no longer matches exactly once, this stops with an error naming the anchor.
Update the anchor below to match the new code (keep the patch itself the same).

The copy goes to a directory inside a dedicated output root (default tools/test/.out). Before an existing output
directory is replaced it must pass every check in check_output_dir() and carry the marker file this script writes;
anything else is refused, never deleted.

usage: python3 tools/test/instrument.py <checkout> <output dir> [--out-root DIR]
"""
import argparse
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT_ROOT = os.path.join(HERE, '.out')
MARKER = '.tgp-instrumented-copy'  # written into every copy; a directory without it is never deleted

# what TGP exposes; each name is read through a closure so a renamed variable shows up in TGP.missing instead of
# breaking the page at boot
EXPORTS = [
    'sun', 'SUN_DIR', 'Sq', 'sky', 'RACE', 'opponentsStep', 'setupGrid', 'wrapGap', 'renderer', 'POST', 'state',
    'setup', 'CITY', 'PERF', 'scene', 'applyQuality', 'camera', 'car', 'physicsStep', 'readInput', 'inp', 'keys',
    'touch', 'W', 'placeCar', 'SPEC', 'genPreset', 'buildWorld', 'TER', 'selectMap', 'gearLogic',
]
EXTRA = {'buildProfileFn': 'buildProfile', 'q': '() => qLevel'}  # exported under another name / as an expression


def _export_js():
    items = [f'{k}: () => {k}' for k in EXPORTS] + [f'{k}: () => {v}' for k, v in EXTRA.items()]
    return ('window.TGP = (() => { const o = { instrumented: true, missing: [] }, get = { ' + ', '.join(items) + ' };\n'
            '  for (const k in get) { try { o[k] = get[k](); } catch (e) { o.missing.push(k); } } return o; })();\n')


# (name, anchor in game.js, replacement); each anchor must occur exactly once
PATCHES = [
    ('perf counters',
     "(() => {\n'use strict';\n",
     "(() => {\n'use strict';\nconst PERF = { phys: 0, opp: 0, rend: 0, hud: 0, cpu: 0 };\n"),
    ('physics timer',
     "while (acc >= DT) { physicsStep(DT, inp); acc -= DT; state.t += DT; }",
     "{ const _t = performance.now(); while (acc >= DT) { physicsStep(DT, inp); acc -= DT; state.t += DT; } PERF.phys += performance.now() - _t; }"),
    ('opponents timer',
     "    opponentsStep(dt);\n",
     "    { const _t = performance.now(); opponentsStep(dt); PERF.opp += performance.now() - _t; }\n"),
    ('render timer',
     "  if (POST.on && POST.comp) { POST.grade.uniforms.time.value = (now / 1000) % 100; POST.comp.render(); } else renderer.render(scene, camera);",
     "  { const _t = performance.now(); if (POST.on && POST.comp) { POST.grade.uniforms.time.value = (now / 1000) % 100; POST.comp.render(); } else renderer.render(scene, camera); PERF.rend += performance.now() - _t; }"),
    ('hud timer',
     "  hud(dt); standingsHud(dt); updateAudio();\n",
     "  { const _t = performance.now(); hud(dt); standingsHud(dt); updateAudio(); PERF.hud += performance.now() - _t; }\n  PERF.cpu += performance.now() - now;\n"),
    ('camera lock',
     "function updateCamera(dt) {\n",
     "function updateCamera(dt) {\n  if (window.__camLock) return;\n"),
    ('window.TGP export',
     "requestAnimationFrame(frame);\n})();",
     "requestAnimationFrame(frame);\n" + _export_js() + "})();"),
]

TOP_SKIP = {'.git', 'tools', 'node_modules'}  # left out of the copy (top level only); the server needs none of them
ANY_SKIP = {'__pycache__', '.DS_Store'}


class InstrumentError(RuntimeError):
    pass


def patch_source(s):
    for name, anchor, repl in PATCHES:
        n = s.count(anchor)
        if n != 1:
            raise InstrumentError(
                f'instrument: anchor "{name}" matches {n} times in game.js (needs exactly 1).\n'
                f'  anchor: {anchor[:100]!r}\n'
                f'  game.js changed: update this anchor in tools/test/instrument.py to the new code.')
        s = s.replace(anchor, repl)
    return s


def _inside(path, parent):
    """path is parent or below it (both real paths)"""
    return os.path.commonpath([path, parent]) == parent


def protected_paths(checkout):
    """Real paths that must never be the output directory or below it: the filesystem root, the home directory,
    the temporary directories and the checkout."""
    R = os.path.realpath
    return {R(p) for p in ('/', os.path.expanduser('~'), '/tmp', '/private/tmp', tempfile.gettempdir(), checkout)}


def check_output_dir(dst, out_root, checkout, protected=None, default_root=DEFAULT_OUT_ROOT):
    """Raise InstrumentError unless dst is a safe place to (re)create a copy. Pure: reads paths, changes nothing.
    Every comparison is between real paths (symlinks resolved), so /tmp and /private/tmp are the same place."""
    R = os.path.realpath
    dst_r, root_r, src_r = R(dst), R(out_root), R(checkout)
    prot = protected_paths(checkout) if protected is None else {R(p) for p in protected} | {src_r}
    for what, p in (('output root', root_r), ('output dir', dst_r)):
        for q in prot:
            if _inside(q, p):  # p is a protected path or one of its parents
                raise InstrumentError(f'instrument: refusing {what} {p}: it is, or contains, the protected path {q}')
    if not _inside(dst_r, root_r) or dst_r == root_r:
        raise InstrumentError(f'instrument: refusing output dir {dst_r}: it must be a subdirectory of the output root {root_r}')
    if _inside(root_r, src_r) and root_r != R(default_root):
        raise InstrumentError(f'instrument: refusing output root {root_r} inside the checkout; only {R(default_root)} may be')
    return dst_r


def _safe_wipe(dst_r):
    """Delete a previous copy: only a directory this script created (it carries the marker), never a symlink."""
    if not os.path.lexists(dst_r):
        return
    if os.path.islink(dst_r) or not os.path.isdir(dst_r) or not os.path.isfile(os.path.join(dst_r, MARKER)):
        raise InstrumentError(f'instrument: refusing to replace {dst_r}: it was not created by instrument.py '
                              f'(no {MARKER} marker). Remove it yourself if it really is disposable.')
    shutil.rmtree(dst_r)


def remove_copy(dst, out_root, checkout):
    """Delete a copy made by instrument() (same checks as before replacing one)."""
    _safe_wipe(check_output_dir(dst, out_root, checkout))


def _ignore(root_dir):
    def ign(d, names):
        skip = {n for n in names if n in ANY_SKIP}
        if os.path.realpath(d) == root_dir:
            skip |= {n for n in names if n in TOP_SKIP}
        return skip
    return ign


def instrument(src, dst, out_root=DEFAULT_OUT_ROOT):
    src_r = os.path.realpath(src)
    game = os.path.join(src_r, 'game.js')
    if not os.path.isfile(game) or not os.path.isfile(os.path.join(src_r, 'index.html')):
        raise InstrumentError(f'instrument: {src_r} is not a Terrain GP checkout (no game.js / index.html)')
    patched = patch_source(open(game, encoding='utf-8').read())  # check every anchor before touching anything
    dst_r = check_output_dir(dst, out_root, src_r)
    os.makedirs(os.path.realpath(out_root), exist_ok=True)
    _safe_wipe(dst_r)
    shutil.copytree(src_r, dst_r, ignore=_ignore(src_r))
    with open(os.path.join(dst_r, MARKER), 'w') as f:
        f.write(f'instrumented copy of {src_r}; made by tools/test/instrument.py, safe to delete\n')
    with open(os.path.join(dst_r, 'game.js'), 'w', encoding='utf-8') as f:
        f.write(patched)
    return dst_r


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('checkout')
    ap.add_argument('dst', help='output dir, must be inside --out-root')
    ap.add_argument('--out-root', default=DEFAULT_OUT_ROOT, help='dedicated output root (default: tools/test/.out)')
    a = ap.parse_args()
    try:
        print(instrument(a.checkout, a.dst, a.out_root))
    except InstrumentError as e:
        sys.exit(str(e))
