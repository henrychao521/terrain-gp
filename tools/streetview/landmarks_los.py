#!/usr/bin/env python3
"""landmarks_los.py - Taipei racing game line-of-sight analysis for landmarks."""

import argparse
import base64
import glob
import json
import math
import os
import re
import sys
import numpy as np
import shapely
import shapely.geometry
from shapely.strtree import STRtree


def to_compass_deg(dx: float, dy: float) -> float:
  """Convert 2D vector (dx: east, dy: north) to compass heading [0, 360)."""
  return math.degrees(math.atan2(dx, dy)) % 360.0


def angle_diff(a: float, b: float) -> float:
  """Smallest angular difference between two compass angles in degrees."""
  return abs((a - b + 180.0) % 360.0 - 180.0)


def load_effective_buildings(
    taipei_path: str, osm_path: str, corridors_dir: str
):
  """Load taipei.json, replace corridor buildings, add OSM landmark polygons."""
  with open(taipei_path, 'r', encoding='utf-8') as f:
    taipei = json.load(f)

  replaced_indices = set()
  corridor_buildings = []
  if corridors_dir and os.path.isdir(corridors_dir):
    for cpath in glob.glob(os.path.join(corridors_dir, '*.json')):
      try:
        with open(cpath, 'r', encoding='utf-8') as cf:
          cdata = json.load(cf)
          replaced_indices.update(cdata.get('replaces', []))
          for cb in cdata.get('buildings', []):
            ring = cb.get('ring', [])
            h = float(cb.get('h', 0.0))
            if len(ring) >= 3 and h > 0:
              poly = shapely.Polygon(ring)
              if not poly.is_valid:
                poly = poly.buffer(0)
              if not poly.is_empty:
                corridor_buildings.append((poly, h))
      except Exception:
        pass

  taipei_buildings = []
  for idx, b in enumerate(taipei.get('buildings', [])):
    if idx in replaced_indices:
      continue
    h = float(b[0]) * 0.1  # decimetres to metres
    coords = [(b[i], b[i + 1]) for i in range(1, len(b), 2)]
    if len(coords) >= 3 and h > 0:
      poly = shapely.Polygon(coords)
      if not poly.is_valid:
        poly = poly.buffer(0)
      if not poly.is_empty:
        taipei_buildings.append((poly, h))

  osm_landmarks = []
  if osm_path and os.path.isfile(osm_path):
    with open(osm_path, 'r', encoding='utf-8') as f:
      osm = json.load(f)
    for lm in osm.get('landmarks', []):
      p = lm.get('p', [])
      h = float(lm.get('h', 0.0))
      if len(p) >= 6 and h > 0:
        coords = [(p[i] * 0.1, p[i + 1] * 0.1) for i in range(0, len(p), 2)]
        poly = shapely.Polygon(coords)
        if not poly.is_valid:
          poly = poly.buffer(0)
        if not poly.is_empty:
          osm_landmarks.append((poly, h))

  effective = taipei_buildings + corridor_buildings + osm_landmarks
  return taipei, effective


def build_raster(taipei: dict, effective_buildings: list):
  """Rasterize DEM + building roofs into a 5m grid over 5600x4200m area."""
  raw_z = base64.b64decode(taipei['z'])
  nx_dem = int(taipei['nx'])
  ny_dem = int(taipei['ny'])
  d_dem = float(taipei.get('d', 20.0))
  dem_raw = (
      np.frombuffer(raw_z, dtype='<i2')
      .reshape((ny_dem, nx_dem))
      .astype(np.float32)
      * 0.01
  )

  # Resample DEM bilinearly onto 5m grid (nx=1120, ny=840)
  nx_grid = 1120
  ny_grid = 840
  ix_arr = np.arange(nx_grid, dtype=np.float32)
  iy_arr = np.arange(ny_grid, dtype=np.float32)

  u = (ix_arr + 0.5) * (5.0 / d_dem) - 0.5
  v = (iy_arr + 0.5) * (5.0 / d_dem) - 0.5

  i0 = np.clip(np.floor(u).astype(np.int32), 0, nx_dem - 2)
  i1 = i0 + 1
  fu = np.clip(u - i0, 0.0, 1.0)

  j0 = np.clip(np.floor(v).astype(np.int32), 0, ny_dem - 2)
  j1 = j0 + 1
  fv = np.clip(v - j0, 0.0, 1.0)

  interp_x = dem_raw[:, i0] * (1.0 - fu) + dem_raw[:, i1] * fu
  dem_grid = interp_x[j0, :] * (1.0 - fv[:, None]) + interp_x[j1, :] * fv[
      :, None
  ]

  # Rasterize building roofs
  roof_grid = np.zeros((ny_grid, nx_grid), dtype=np.float32)
  for poly, h in effective_buildings:
    minx, miny, maxx, maxy = poly.bounds
    ix0 = max(0, int(minx // 5.0))
    ix1 = min(nx_grid - 1, int(maxx // 5.0))
    iy0 = max(0, int(miny // 5.0))
    iy1 = min(ny_grid - 1, int(maxy // 5.0))
    if ix0 > ix1 or iy0 > iy1:
      continue

    xs = (np.arange(ix0, ix1 + 1, dtype=np.float32) + 0.5) * 5.0
    ys = (np.arange(iy0, iy1 + 1, dtype=np.float32) + 0.5) * 5.0
    xx, yy = np.meshgrid(xs, ys)
    inside = shapely.contains_xy(poly, xx.ravel(), yy.ravel()).reshape(xx.shape)
    if np.any(inside):
      sub = roof_grid[iy0 : iy1 + 1, ix0 : ix1 + 1]
      roof_grid[iy0 : iy1 + 1, ix0 : ix1 + 1] = np.maximum(
          sub, np.where(inside, h, sub)
      )

  raster_inside = dem_grid + roof_grid
  return raster_inside


def sample_ray_heights(xs, ys, raster_inside, skyline_data, skyline_towers):
  """Sample ground/building elevation for points (xs, ys) inside and outside."""
  hs = np.empty_like(xs, dtype=np.float32)
  in_g = (xs >= 0.0) & (xs < 5600.0) & (ys >= 0.0) & (ys < 4200.0)

  if np.any(in_g):
    ixs = np.clip((xs[in_g] * 0.2).astype(np.int32), 0, 1119)
    iys = np.clip((ys[in_g] * 0.2).astype(np.int32), 0, 839)
    hs[in_g] = raster_inside[iys, ixs]

  out_g = ~in_g
  if np.any(out_g):
    cx, cy = skyline_data['centre']
    radii = skyline_data['radii']
    sky_h = skyline_data['h']
    dx = xs[out_g] - cx
    dy = ys[out_g] - cy
    r = np.hypot(dx, dy)
    az = np.degrees(np.arctan2(dx, dy)) % 360.0

    r_c = np.clip(r, radii[0], radii[-1])
    az0 = np.floor(az).astype(np.int32) % 360
    az1 = (az0 + 1) % 360
    faz = az - np.floor(az)

    r_idx = np.searchsorted(radii, r_c)
    r0 = np.clip(r_idx - 1, 0, len(radii) - 2)
    r1 = r0 + 1
    fr = (r_c - radii[r0]) / (radii[r1] - radii[r0])

    val = (1.0 - fr) * (
        (1.0 - faz) * sky_h[r0, az0] + faz * sky_h[r0, az1]
    ) + fr * ((1.0 - faz) * sky_h[r1, az0] + faz * sky_h[r1, az1])
    hs[out_g] = val

    # Test skyline towers for samples outside game area
    if skyline_towers:
      out_indices = np.where(out_g)[0]
      xs_out = xs[out_g]
      ys_out = ys[out_g]
      for t_poly, t_top, (t_minx, t_miny, t_maxx, t_maxy) in skyline_towers:
        t_mask = (
            (xs_out >= t_minx)
            & (xs_out <= t_maxx)
            & (ys_out >= t_miny)
            & (ys_out <= t_maxy)
        )
        if np.any(t_mask):
          ins = shapely.contains_xy(t_poly, xs_out[t_mask], ys_out[t_mask])
          if np.any(ins):
            hit_global_idxs = out_indices[t_mask][ins]
            hs[hit_global_idxs] = np.maximum(hs[hit_global_idxs], t_top)

  return hs


def obstruction_profile(
    x0,
    y0,
    eye,
    x1,
    y1,
    top,
    base,
    kind,
    raster_inside,
    skyline_data,
    skyline_towers=None,
):
  """Calculate top_angle, max obstruction_angle, and visibility along the ray."""
  dx = x1 - x0
  dy = y1 - y0
  d = math.hypot(dx, dy)
  if d < 150.0:
    return False, 0.0, -90.0

  c_d = (d * d) / (2.0 * 6371000.0) * 0.87
  eff_top = top - c_d
  eff_base = base - c_d
  top_angle = math.degrees(math.atan((eff_top - eye) / d))
  base_angle = math.degrees(math.atan((eff_base - eye) / d))

  is_peak = kind == 'peak'
  stop_margin = 300.0 if is_peak else 60.0
  s_end = min(d - 50.0, d - stop_margin)

  if s_end < 5.0:
    obstruction_angle = -90.0
  else:
    s_5 = np.arange(5.0, min(3000.0, s_end) + 0.1, 5.0, dtype=np.float32)
    if s_end > 3000.0:
      s_50 = np.arange(3050.0, s_end + 0.1, 50.0, dtype=np.float32)
      s_all = np.concatenate([s_5, s_50]) if len(s_50) > 0 else s_5
    else:
      s_all = s_5

    ratio = s_all / d
    xs = x0 + ratio * dx
    ys = y0 + ratio * dy

    hs = sample_ray_heights(
        xs, ys, raster_inside, skyline_data, skyline_towers
    )
    c_s = (s_all * s_all) / (2.0 * 6371000.0) * 0.87
    angs = np.degrees(np.arctan((hs - c_s - eye) / s_all))
    obstruction_angle = float(np.max(angs)) if len(angs) > 0 else -90.0

  real_visible = top_angle > (obstruction_angle + 0.05)
  if real_visible:
    visible_deg = max(0.0, top_angle - max(obstruction_angle, base_angle))
  else:
    visible_deg = 0.0

  return real_visible, visible_deg, obstruction_angle


def main():
  parser = argparse.ArgumentParser(
      description='Taipei landmark line-of-sight validator.'
  )
  parser.add_argument(
      '--tracks',
      nargs='+',
      required=True,
      help='name=path pairs for track json files',
  )
  parser.add_argument(
      '--landmarks', required=True, help='Path to LANDMARKS.json'
  )
  parser.add_argument('--skyline', required=True, help='Path to skyline.json')
  parser.add_argument('--taipei', required=True, help='Path to taipei.json')
  parser.add_argument(
      '--osm', default=None, help='Path to taipei_osm.json (optional)'
  )
  parser.add_argument(
      '--corridors', default=None, help='Path to corridors dir (optional)'
  )
  parser.add_argument('--out', required=True, help='Output OUT.json path')
  parser.add_argument('--md', required=True, help='Output OUT.md path')
  parser.add_argument(
      '--every', type=float, default=100.0, help='Viewpoint step in metres'
  )
  parser.add_argument(
      '--impostors',
      action='store_true',
      help='Enable skyline impostor matching',
  )
  args = parser.parse_args()

  # Parse track definitions
  track_paths = {}
  for item in args.tracks:
    if '=' in item:
      tname, tpath = item.split('=', 1)
      track_paths[tname] = tpath
    else:
      track_paths[os.path.splitext(os.path.basename(item))[0]] = item

  # Load inputs
  with open(args.landmarks, 'r', encoding='utf-8') as f:
    landmarks = json.load(f)

  with open(args.skyline, 'r', encoding='utf-8') as f:
    skyline_raw = json.load(f)
  skyline_data = {
      'centre': skyline_raw['centre'],
      'radii': np.array(skyline_raw['radii'], dtype=np.float32),
      'h': np.array(skyline_raw['h'], dtype=np.float32),
  }

  skyline_towers = []
  for st in skyline_raw.get('towers', []):
    ring = st.get('ring', [])
    if len(ring) >= 3:
      poly = shapely.Polygon(ring)
      if poly.is_valid and not poly.is_empty:
        t_top = float(st.get('base', 0.0)) + float(st.get('h', 0.0))
        skyline_towers.append((poly, t_top, poly.bounds))

  # Build obstruction raster & spatial index
  taipei, effective_buildings = load_effective_buildings(
      args.taipei, args.osm, args.corridors
  )
  raster_inside = build_raster(taipei, effective_buildings)

  building_polys = [b[0] for b in effective_buildings]
  building_tree = STRtree(building_polys) if building_polys else None

  out_tracks = {}
  md_lines = ['# 賽道地標視線檢查報告\n']

  for tname, tpath in track_paths.items():
    with open(tpath, 'r', encoding='utf-8') as f:
      track = json.load(f)

    n_pts = int(track['n'])
    ds = float(track['ds'])
    sx = float(track.get('sx', 5600.0))
    sz = float(track.get('sz', 4200.0))
    xs_w = track['x']
    zs_w = track['z']
    lxs_w = track['lx']
    lzs_w = track['lz']
    surfs = track['surf']

    active_tiles = set()
    for at in track.get('activeTiles', []):
      m = re.search(r't_(\d+)_(\d+)', at.get('file', ''))
      if m:
        active_tiles.add((int(m.group(1)), int(m.group(2))))

    step = max(1, int(round(args.every / ds)))
    sampled_indices = list(range(0, n_pts, step))

    viewpoints = []
    for idx in sampled_indices:
      s_m = idx * ds
      # Convert world to data frame
      X = xs_w[idx] + sx * 0.5
      Y = sz * 0.5 - zs_w[idx]
      eye = surfs[idx] + 1.6

      # Left vector (lx, lz) in game world -> in data frame (lx, -lz).
      # Rotated -90 deg: dx = -(-lz) = lz, dy = -lx.
      # Specification: (-lz, -lx)
      dx = -lzs_w[idx]
      dy = -lxs_w[idx]
      fwd_heading = to_compass_deg(dx, dy)
      rev_heading = (fwd_heading + 180.0) % 360.0

      viewpoints.append({
          's_m': s_m,
          'X': X,
          'Y': Y,
          'eye': eye,
          'fwd_heading': fwd_heading,
          'rev_heading': rev_heading,
      })

    total_viewpoints = len(viewpoints) * 2

    # Evaluate each landmark
    landmark_results = []
    for lm in landmarks:
      lm_name = lm.get('name')
      kind = lm.get('kind', 'named')
      lX = float(lm['X'])
      lY = float(lm['Y'])
      top = float(lm['top'])
      base = float(lm.get('base') if lm.get('base') is not None else 0.0)
      lm_h = float(lm.get('height') or 0.0)
      inside = bool(lm.get('inside_game_area', False))

      # Game status
      if inside:
        tile_I = int(lX // 700.0)
        tile_J = int(lY // 700.0)
        tile_loaded = (tile_I, tile_J) in active_tiles
        if kind == 'peak':
          status = 'terrain' if tile_loaded else 'tile_not_loaded'
        else:
          pt = shapely.geometry.Point(lX, lY)
          found_any = False
          max_found_h = 0.0
          if building_tree is not None:
            cands = building_tree.query(
                shapely.box(lX - 40.0, lY - 40.0, lX + 40.0, lY + 40.0)
            )
            for b_idx in cands:
              poly, b_h = effective_buildings[b_idx]
              if poly.distance(pt) <= 40.0:
                found_any = True
                if b_h > max_found_h:
                  max_found_h = b_h
          if not found_any:
            status = 'missing'
          elif max_found_h >= 0.6 * lm_h:
            status = 'present' if tile_loaded else 'tile_not_loaded'
          else:
            status = 'too_low'
      else:
        if args.impostors:
          if kind == 'peak':
            status = 'impostor'
          else:
            pt = shapely.geometry.Point(lX, lY)
            near_tower = False
            for t_poly, _, _ in skyline_towers:
              if t_poly.distance(pt) <= 60.0:
                near_tower = True
                break
            status = 'impostor' if near_tower else 'absent'
        else:
          status = 'absent'

      # Check viewpoints
      dists = []
      seen_in_view = 0
      seen_any = 0
      max_visible_deg = 0.0
      example_viewpoints = []

      for vp in viewpoints:
        d = math.hypot(lX - vp['X'], lY - vp['Y'])
        dists.append(d)
        if d < 150.0:
          continue

        bearing = to_compass_deg(lX - vp['X'], lY - vp['Y'])
        diff_fwd = angle_diff(bearing, vp['fwd_heading'])
        diff_rev = angle_diff(bearing, vp['rev_heading'])
        in_view_fwd = diff_fwd <= 40.0
        in_view_rev = diff_rev <= 40.0

        real_vis, vis_deg, _ = obstruction_profile(
            vp['X'],
            vp['Y'],
            vp['eye'],
            lX,
            lY,
            top,
            base,
            kind,
            raster_inside,
            skyline_data,
            skyline_towers,
        )

        if real_vis:
          seen_any += 2  # Both forward and reverse see it in 360 space
          if vis_deg > max_visible_deg:
            max_visible_deg = vis_deg

          if in_view_fwd:
            seen_in_view += 1
            if len(example_viewpoints) < 5:
              example_viewpoints.append({
                  's_m': round(vp['s_m'], 1),
                  'dir': 'fwd',
                  'X': round(vp['X'], 1),
                  'Y': round(vp['Y'], 1),
                  'heading': round(vp['fwd_heading'], 1),
                  'bearing': round(bearing, 1),
                  'd': round(d, 1),
                  'visible_deg': round(vis_deg, 3),
              })

          if in_view_rev:
            seen_in_view += 1
            if len(example_viewpoints) < 5:
              example_viewpoints.append({
                  's_m': round(vp['s_m'], 1),
                  'dir': 'rev',
                  'X': round(vp['X'], 1),
                  'Y': round(vp['Y'], 1),
                  'heading': round(vp['rev_heading'], 1),
                  'bearing': round(bearing, 1),
                  'd': round(d, 1),
                  'visible_deg': round(vis_deg, 3),
              })

      d_min = min(dists) if dists else 0.0
      d_max = max(dists) if dists else 0.0

      # Far plane & fog
      if d_min > 12000.0 and status != 'impostor':
        status = 'beyond_far'
      fog_min_d = float(math.exp(-((d_min * 0.00017) ** 2)))

      landmark_results.append({
          'name': lm_name,
          'kind': kind,
          'status': status,
          'd_min': round(d_min, 1),
          'd_max': round(d_max, 1),
          'fog_min_d': round(fog_min_d, 4),
          'seen_in_view': seen_in_view,
          'seen_any': seen_any,
          'max_visible_deg': round(max_visible_deg, 3),
          'example_viewpoints': example_viewpoints,
      })

    out_tracks[tname] = {
        'viewpoints': total_viewpoints,
        'landmarks': landmark_results,
    }

    # Markdown Table
    visible_landmarks = [
        l for l in landmark_results if l['seen_in_view'] > 0
    ]
    visible_landmarks.sort(key=lambda x: x['seen_in_view'], reverse=True)

    md_lines.append(f'## {tname}\n')
    md_lines.append(
        '| 地標 | 種類 | 真實可見點數(行進方向) | 最大可見高度(度) | 距離 |'
        ' 遊戲狀態 |'
    )
    md_lines.append('| --- | --- | --- | --- | --- | --- |')
    for vl in visible_landmarks:
      name_disp = vl['name'] if vl['name'] else '未命名'
      dist_disp = f"{vl['d_min']:.0f} - {vl['d_max']:.0f} m"
      md_lines.append(
          f"| {name_disp} | {vl['kind']} | {vl['seen_in_view']} |"
          f" {vl['max_visible_deg']:.2f} | {dist_disp} | {vl['status']} |"
      )
    md_lines.append('\n')

  # Write OUT.json
  os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
  with open(args.out, 'w', encoding='utf-8') as f:
    json.dump({'tracks': out_tracks}, f, ensure_ascii=False, indent=2)

  # Write OUT.md
  os.makedirs(os.path.dirname(os.path.abspath(args.md)), exist_ok=True)
  with open(args.md, 'w', encoding='utf-8') as f:
    f.write('\n'.join(md_lines))


if __name__ == '__main__':
  main()
