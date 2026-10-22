"""Performance envelope of a real F1 car from OpenF1 (api.openf1.org, free historical data): fastest qualifying lap of
a few 2024 events -> top speed, acceleration and braking by speed band, lateral g by speed band.
Runs on a Colab CPU runtime because the Studio's school network blocks the API. Output: /content/f1_stats.json"""
import json, time, urllib.request, urllib.parse
import numpy as np
from scipy.signal import savgol_filter

API = 'https://api.openf1.org/v1/'
def get(ep, **q):
    url = API + ep + '?' + urllib.parse.urlencode(q, safe='<>=')
    for i in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r: return json.load(r)
        except Exception as e:
            print('retry', ep, e, flush=True); time.sleep(3 * (i + 1))
    raise RuntimeError('failed ' + url)

G = 9.81
def stats(country):
    ses = [s for s in get('sessions', year=2024, country_name=country) if s['session_name'] == 'Qualifying'][0]
    laps = [l for l in get('laps', session_key=ses['session_key']) if l.get('lap_duration') and l.get('date_start')]
    best = min(laps, key=lambda l: l['lap_duration'])
    t0 = best['date_start']; dur = best['lap_duration']
    from datetime import datetime, timedelta
    a = datetime.fromisoformat(t0.replace('Z', '+00:00')); b = a + timedelta(seconds=dur)
    rng = {'date>': a.isoformat(), 'date<': b.isoformat()}
    car = get('car_data', session_key=ses['session_key'], driver_number=best['driver_number'], **rng)
    loc = get('location', session_key=ses['session_key'], driver_number=best['driver_number'], **rng)
    ts = lambda r: datetime.fromisoformat(r['date'].replace('Z', '+00:00')).timestamp()
    ct = np.array([ts(r) for r in car]); cv = np.array([r['speed'] for r in car]) / 3.6
    lt = np.array([ts(r) for r in loc]); lx = np.array([r['x'] for r in loc]) / 10; ly = np.array([r['y'] for r in loc]) / 10
    # common 10 Hz clock, then distance from speed, then a 2 m distance grid
    T = np.arange(max(ct[0], lt[0]), min(ct[-1], lt[-1]), 0.1)
    V = np.interp(T, ct, cv); X = np.interp(T, lt, lx); Y = np.interp(T, lt, ly)
    D = np.concatenate([[0], np.cumsum((V[1:] + V[:-1]) / 2 * 0.1)])
    grid = np.arange(0, D[-1], 2.0)
    Vg = savgol_filter(np.interp(grid, D, V), 15, 2); Xg = savgol_filter(np.interp(grid, D, X), 25, 3); Yg = savgol_filter(np.interp(grid, D, Y), 25, 3)
    ax = Vg * np.gradient(Vg, grid)
    dx, dy = np.gradient(Xg, grid), np.gradient(Yg, grid); ddx, ddy = np.gradient(dx, grid), np.gradient(dy, grid)
    kap = np.abs(dx * ddy - dy * ddx) / np.maximum((dx * dx + dy * dy) ** 1.5, 1e-9); ay = Vg ** 2 * kap
    def band(arr, lo, hi, q):
        m = (Vg * 3.6 >= lo) & (Vg * 3.6 < hi); return round(float(np.percentile(arr[m], q)) / G, 2) if m.sum() > 5 else None
    # time and distance from 100 to 200 km/h and braking distance 300 -> 100 km/h, measured along the lap
    def runs(arr_v, up):
        out = []
        for i in range(1, len(arr_v)):
            if up and arr_v[i - 1] < 100 / 3.6 <= arr_v[i]:
                j = i
                while j < len(arr_v) and arr_v[j] < 200 / 3.6 and arr_v[j] >= arr_v[j - 1] - 0.3: j += 1
                if j < len(arr_v) and arr_v[j] >= 200 / 3.6: out.append(round(float(np.sum(2.0 / Vg[i:j])), 2))
        return out
    return {
        'event': f"2024 {country} Q", 'driver': best['driver_number'], 'lap_s': dur, 'lap_km': round(float(D[-1]) / 1000, 3),
        'top_kmh': round(float(Vg.max() * 3.6), 1), 'min_kmh': round(float(Vg.min() * 3.6), 1),
        'accel_g': {f'{lo}-{hi}': band(ax, lo, hi, 95) for lo, hi in ((60, 120), (120, 180), (180, 240), (240, 300), (300, 360))},
        'brake_g': {f'{lo}-{hi}': band(-ax, lo, hi, 98) for lo, hi in ((80, 150), (150, 220), (220, 290), (290, 360))},
        'lat_g': {f'{lo}-{hi}': band(ay, lo, hi, 97) for lo, hi in ((60, 100), (100, 150), (150, 200), (200, 250), (250, 300))},
        't_100_200_s': runs(Vg, True)[:3],
    }

res = []
for c in ('Singapore', 'Italy', 'Monaco'):
    try: res.append(stats(c)); print(json.dumps(res[-1]), flush=True)
    except Exception as e: print('ERR', c, repr(e)[:200], flush=True)
json.dump(res, open('/content/f1_stats.json', 'w'), indent=1)
