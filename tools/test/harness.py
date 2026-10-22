"""Shared plumbing for tools/test/run.py: static server, Chrome, and driving the game's menu."""
import contextlib
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
JS_DIR = os.path.join(HERE, 'js')


class HarnessError(RuntimeError):
    """The check could not run (not a failed threshold)."""


def log(*a):
    print('[tgp-test]', *a, file=sys.stderr, flush=True)


def sleep(secs):
    """Wait in Python rather than in Playwright (page.wait_for_timeout): Ctrl-C and SIGTERM interrupt time.sleep,
    while Playwright's sync API swallows them until its call returns."""
    end = time.time() + secs
    while (left := end - time.time()) > 0:
        time.sleep(min(0.25, left))


def interruptible():
    """Ctrl-C and SIGTERM both stop a run with KeyboardInterrupt (the browser, server and copy are cleaned up)."""
    import signal

    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)


def js(name):
    with open(os.path.join(JS_DIR, name), encoding='utf-8') as f:
        return f.read()


def git_info(path):
    try:
        head = subprocess.run(['git', '-C', path, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, timeout=10)
        if head.returncode:
            return {'commit': None, 'dirty': None}
        dirty = subprocess.run(['git', '-C', path, 'status', '--porcelain', '--', 'game.js', 'index.html', 'data', 'models'],
                               capture_output=True, text=True, timeout=10).stdout.strip()
        return {'commit': head.stdout.strip(), 'dirty': bool(dirty)}  # dirty: the served files differ from the commit
    except (OSError, subprocess.SubprocessError):
        return {'commit': None, 'dirty': None}


# ---- static server: python's default http.server listens with a backlog of 5 and drops connections when Chrome
# fetches dozens of tiles at once; this one queues 256 and answers each request on its own thread
class _Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # a rebuilt copy is always read fresh
        super().end_headers()


class StaticServer(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return  # Chrome cancelled the request
        super().handle_error(request, client_address)


@contextlib.contextmanager
def serve(root):
    srv = StaticServer(('127.0.0.1', 0), functools.partial(_Handler, directory=root))  # port 0: any free port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f'http://127.0.0.1:{srv.server_address[1]}/'
    finally:
        srv.shutdown()
        srv.server_close()


# ---- Chrome: the installed Google Chrome (channel="chrome") with a window; WebGL needs the real GPU
CHROME_ARGS = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']


@contextlib.contextmanager
def chrome(headless=False):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=headless, args=CHROME_ARGS)
        try:
            yield b
        finally:
            try:
                b.close()
            except Exception:  # already gone (Ctrl-C reaches the driver too)
                pass


# console messages that are not errors in the game: the favicon nobody asked for, and tiles without an
# instance list (game.js fetches <tile>.inst.json and treats a 404 as "no instances")
IGNORED = [
    lambda text, url: 'Failed to load resource' in text and (url.endswith('/favicon.ico') or url.endswith('.inst.json')),
]

SET_CONTROLS = """(c) => { const out = {};
  for (const [id, v] of Object.entries(c)) { const el = document.getElementById(id); if (!el) throw new Error('no menu control #' + id);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    out[id] = el.type === 'checkbox' ? el.checked : +el.value; }
  return out; }"""


class Game:
    """One page of the instrumented game."""

    def __init__(self, browser, url, needs=(), viewport=(1000, 600), dpr=1):
        self.url, self.needs = url, needs
        self.pg = browser.new_page(viewport={'width': viewport[0], 'height': viewport[1]}, device_scale_factor=dpr)
        # a fresh profile would get the first-run tutorial offer over the menus: mark it as seen (other prefs stay default)
        self.pg.add_init_script("try { if (!localStorage.getItem('tgp-prefs')) localStorage.setItem('tgp-prefs', JSON.stringify({ tut: true })); } catch (e) {}")
        self.errors, self.warnings = [], []
        self.pg.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)[:300]))
        self.pg.on('console', self._console)

    def _console(self, m):
        if m.type != 'error':
            return
        loc = (m.location or {}).get('url', '') if isinstance(m.location, dict) else ''
        if any(f(m.text, loc) for f in IGNORED):
            return
        self.errors.append('console.error: ' + m.text[:300] + (f' [{loc}]' if loc else ''))

    def open(self, quality=None):
        self.pg.goto(self.url + 'index.html', wait_until='load')
        try:
            self.pg.wait_for_function('!!window.TGP', timeout=60000)
        except Exception:
            raise HarnessError('window.TGP never appeared (game.js failed to boot?) ' + '; '.join(self.errors[:3]))
        missing = self.pg.evaluate('TGP.missing || []')
        need = sorted(set(missing) & set(self.needs))
        if need:
            raise HarnessError(f'game.js no longer has {need}: update EXPORTS in tools/test/instrument.py and the check')
        if missing:
            self.warnings.append(f'TGP.missing (not needed by this check): {missing}')
        if quality:
            self.pg.evaluate("q => { TGP.setup.quality = q; TGP.applyQuality(q); }", quality)
        return self

    def controls(self, **c):
        return self.pg.evaluate(SET_CONTROLS, c)

    def race_mode(self, mode):
        self.pg.evaluate("m => document.querySelector(`#raceMode button[data-r=\"${m}\"]`).click()", mode)

    def taipei(self, preset):
        pg = self.pg
        if not pg.evaluate("TGP.setup.map === 'taipei' && !!TGP.CITY.taipei"):
            pg.click('#mapTabs button[data-m="taipei"]')
        pg.wait_for_function("TGP.CITY.taipei && TGP.setup.map === 'taipei' && !document.querySelector('#btnStart').disabled", timeout=90000)
        pg.click('.step[data-pane="track"]')
        btn = f'#tpPresets button[data-c="{preset}"]'
        if pg.locator(btn).count() != 1:
            raise HarnessError(f'no Taipei preset {preset} in the menu')
        pg.click(btn)
        pg.wait_for_timeout(300)
        return pg.locator(btn).inner_text()

    def start(self, until=('lights', 'race'), timeout=90000):
        self.pg.click('#btnStart')
        cond = ' || '.join(f"TGP.state.mode === '{m}'" for m in until)
        self.pg.wait_for_function(cond, timeout=timeout)

    def run(self, name, arg=None):
        return self.pg.evaluate(js(name), arg)

    def close(self):
        try:
            self.pg.close()
        except Exception:
            pass


def dump(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1), flush=True)
