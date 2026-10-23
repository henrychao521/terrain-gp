#!/usr/bin/env python3
"""skyline.py - Generate far-terrain skyline impostors and landmarks for Taipei."""

import argparse
import json
import math
import os
import sys
import urllib.request

import duckdb
import numpy as np
from pyproj import Transformer
import shapely
import shapely.ops
import tifffile


def download_tile(lat: int, lon: int, cache_dir: str) -> str:
    """Download Copernicus GLO-30 tile if not already present in cache_dir."""
    tile_name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
    file_name = f"{tile_name}.tif"
    url = f"https://copernicus-dem-30m.s3.amazonaws.com/{tile_name}/{file_name}"
    out_path = os.path.join(cache_dir, file_name)

    if os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
        return out_path

    os.makedirs(cache_dir, exist_ok=True)
    temp_path = out_path + ".tmp"
    print(f"Downloading DEM tile: {file_name}...")
    req = urllib.request.Request(url, headers={"User-Agent": "skyline-generator/1.0"})
    with urllib.request.urlopen(req) as resp, open(temp_path, "wb") as f:
        total = resp.headers.get("Content-Length")
        total_bytes = int(total) if total and total.isdigit() else None
        downloaded = 0
        chunk_size = 1024 * 1024
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total_bytes:
                pct = downloaded / total_bytes * 100.0
                print(
                    f"\r  Progress: {downloaded / (1024 * 1024):.1f} MB / "
                    f"{total_bytes / (1024 * 1024):.1f} MB ({pct:.1f}%)",
                    end="",
                    flush=True,
                )
            else:
                print(f"\r  Progress: {downloaded / (1024 * 1024):.1f} MB", end="", flush=True)
    print()
    os.replace(temp_path, out_path)
    return out_path


def build_dem(cache_dir: str):
    """Load DEM tiles for (25, 121) and (24, 121) and return a bilinear dem(lon, lat) function."""
    path_25 = download_tile(25, 121, cache_dir)
    path_24 = download_tile(24, 121, cache_dir)

    arr_25 = tifffile.imread(path_25).astype(np.float32)
    arr_24 = tifffile.imread(path_24).astype(np.float32)

    if arr_25.ndim == 3:
        arr_25 = arr_25[0]
    if arr_24.ndim == 3:
        arr_24 = arr_24[0]

    nrows_25, ncols_25 = arr_25.shape
    nrows_24, ncols_24 = arr_24.shape

    # Copernicus tiles at lat 24 and 25 share the same column count (3600)
    if ncols_25 == ncols_24:
        combined = np.vstack([arr_25, arr_24])
    else:
        # Fallback if column counts differ
        combined = arr_25

    total_rows, total_cols = combined.shape
    lat_top = 26.0
    lon_left = 121.0
    lat_height = 2.0 if ncols_25 == ncols_24 else 1.0
    lon_width = 1.0

    # Clean no-data and sea values (< -100) -> 0.0
    valid_data = np.where((combined < -100.0) | np.isnan(combined), 0.0, combined).astype(np.float32)

    lat_scale = total_rows / lat_height
    lon_scale = total_cols / lon_width

    def dem(lon, lat):
        is_scalar = np.isscalar(lon) and np.isscalar(lat)
        lon_arr = np.atleast_1d(np.asarray(lon, dtype=np.float64))
        lat_arr = np.atleast_1d(np.asarray(lat, dtype=np.float64))

        u = (lat_top - lat_arr) * lat_scale - 0.5
        v = (lon_arr - lon_left) * lon_scale - 0.5

        i0 = np.floor(u).astype(np.int64)
        j0 = np.floor(v).astype(np.int64)
        i1 = i0 + 1
        j1 = j0 + 1

        du = u - i0
        dv = v - j0

        in_bounds = (u >= 0.0) & (u <= total_rows - 1.0) & (v >= 0.0) & (v <= total_cols - 1.0)

        i0_c = np.clip(i0, 0, total_rows - 1)
        i1_c = np.clip(i1, 0, total_rows - 1)
        j0_c = np.clip(j0, 0, total_cols - 1)
        j1_c = np.clip(j1, 0, total_cols - 1)

        v00 = valid_data[i0_c, j0_c]
        v01 = valid_data[i0_c, j1_c]
        v10 = valid_data[i1_c, j0_c]
        v11 = valid_data[i1_c, j1_c]

        val = (
            (1.0 - du) * (1.0 - dv) * v00
            + (1.0 - du) * dv * v01
            + du * (1.0 - dv) * v10
            + du * dv * v11
        )
        val = np.where(in_bounds, val, 0.0)
        val = np.where(val < 0.0, 0.0, val)

        if is_scalar:
            return float(val[0])
        return val

    return dem


def get_largest_polygon(geom):
    """Extract the largest Polygon by area from any Shapely geometry."""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return geom
    if geom.geom_type == "MultiPolygon":
        return max(geom.geoms, key=lambda p: p.area)
    if geom.geom_type == "GeometryCollection":
        polys = []
        for g in geom.geoms:
            if g.geom_type == "Polygon":
                polys.append(g)
            elif g.geom_type == "MultiPolygon":
                polys.extend(g.geoms)
        if polys:
            return max(polys, key=lambda p: p.area)
    return None


def ensure_ccw(pts):
    """Ensure a sequence of 2D points is oriented counter-clockwise."""
    n = len(pts)
    if n < 3:
        return pts
    signed_area = sum(
        pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)
    )
    if signed_area < 0:
        return pts[::-1]
    return pts


def simplify_footprint(poly):
    """Simplify building polygon: tolerance 2.0, <= 16 vertices, CCW, rounded to 0.1m, no repeated end."""
    s = poly.simplify(2.0, preserve_topology=True)
    sp = get_largest_polygon(s)
    if sp is None or sp.is_empty:
        sp = poly

    coords = list(sp.exterior.coords)
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]

    if len(coords) > 16:
        tol = 2.0
        ch = sp.convex_hull.simplify(tol, preserve_topology=True)
        ch_p = get_largest_polygon(ch)
        if ch_p is not None and not ch_p.is_empty:
            ch_coords = list(ch_p.exterior.coords)
            if len(ch_coords) > 1 and ch_coords[0] == ch_coords[-1]:
                ch_coords = ch_coords[:-1]
            coords = ch_coords
        while len(coords) > 16 and tol < 50.0:
            tol *= 2.0
            ch = sp.convex_hull.simplify(tol, preserve_topology=True)
            ch_p = get_largest_polygon(ch)
            if ch_p is not None and not ch_p.is_empty:
                ch_coords = list(ch_p.exterior.coords)
                if len(ch_coords) > 1 and ch_coords[0] == ch_coords[-1]:
                    ch_coords = ch_coords[:-1]
                if len(ch_coords) >= 3:
                    coords = ch_coords

    coords = ensure_ccw(coords)
    ring = []
    for pt in coords:
        p = [round(float(pt[0]), 1), round(float(pt[1]), 1)]
        if not ring or p != ring[-1]:
            ring.append(p)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()

    if len(ring) < 3:
        minx, miny, maxx, maxy = poly.bounds
        ring = [
            [round(minx, 1), round(miny, 1)],
            [round(maxx, 1), round(miny, 1)],
            [round(maxx, 1), round(maxy, 1)],
            [round(minx, 1), round(maxy, 1)],
        ]
    return ring


def run_duckdb_query(con, query_tpl: str, release: str):
    """Execute query with release fallback if S3 path does not exist."""
    fallbacks = ["2024-10-22.0", "2024-09-18.0", "2024-08-20.0"]
    candidates = [release] + [fb for fb in fallbacks if fb != release]
    last_err = None
    for cand in candidates:
        sql = query_tpl.format(release=cand)
        try:
            cur = con.execute(sql)
            cols = [desc[0] for desc in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            return rows, cand
        except Exception as e:
            last_err = e
            continue
    raise last_err


def main():
    parser = argparse.ArgumentParser(
        description="Build skyline impostors and landmarks for central Taipei."
    )
    parser.add_argument("--out-game", required=True, help="Path for game skyline JSON output")
    parser.add_argument("--out-landmarks", required=True, help="Path for landmarks JSON output")
    parser.add_argument("--cache", required=True, help="Cache directory for DEM raster tiles")
    parser.add_argument(
        "--release",
        default="2026-10-21.0",
        help="Overture Maps release version (default: 2026-10-21.0)",
    )
    args = parser.parse_args()

    # Transformers for coordinate frames:
    # Data frame: X = E - 299000, Y = N - 2766400 (metres)
    to_3826 = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
    to_4326 = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    def transform_to_df(geom):
        def _trans(x, y, z=None):
            E, N = to_3826.transform(x, y)
            X = E - 299000.0
            Y = N - 2766400.0
            if z is not None:
                return X, Y, z
            return X, Y

        return shapely.ops.transform(_trans, geom)

    # 1) Build DEM bilinear sampler
    dem = build_dem(args.cache)

    # 2) Far terrain on a polar grid around C = (2800, 2100)
    # Radii: 60 values geometric from 2400 m to 40000 m (round to 1 m)
    radii_arr = np.geomspace(2400, 40000, 60).round().astype(int)
    radii_list = [int(r) for r in radii_arr]

    # Azimuths: 0..359 (compass: 0 north, clockwise)
    az_deg = np.arange(360, dtype=np.float64)
    az_rad = np.deg2rad(az_deg)

    r_grid = radii_arr[:, None].astype(np.float64)
    az_grid = az_rad[None, :]

    X_grid = 2800.0 + r_grid * np.sin(az_grid)
    Y_grid = 2100.0 + r_grid * np.cos(az_grid)

    E_grid = X_grid + 299000.0
    N_grid = Y_grid + 2766400.0

    lon_grid, lat_grid = to_4326.transform(E_grid, N_grid)
    h_matrix = dem(lon_grid, lat_grid)
    h_matrix = np.round(h_matrix, 1)
    h_list = h_matrix.tolist()

    # 3) Connect DuckDB and query overture maps
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")

    towers_sql = """
    SELECT
        id,
        names.primary AS name,
        height,
        num_floors,
        ST_AsWKB(geometry) AS wkb
    FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*', hive_partitioning=1)
    WHERE bbox.xmin <= 121.75 AND bbox.xmax >= 121.35
      AND bbox.ymin <= 25.20 AND bbox.ymax >= 24.90
      AND (height >= 100 OR num_floors >= 30)
    """

    print("Querying tall towers via DuckDB...")
    tower_rows, used_rel = run_duckdb_query(con, towers_sql, args.release)
    print(f"Fetched {len(tower_rows)} tall building candidates (Overture release: {used_rel}).")

    game_towers = []
    landmarks_list = []
    seen_tower_ids = set()

    for row in tower_rows:
        if not row["wkb"]:
            continue
        try:
            geom = shapely.from_wkb(bytes(row["wkb"]))
        except Exception:
            continue
        if geom.is_empty:
            continue

        geom_df = transform_to_df(geom)
        centroid = geom_df.centroid
        X_c = float(centroid.x)
        Y_c = float(centroid.y)

        # Centroid outside game area (0 <= X <= 5600, 0 <= Y <= 4200) and within 25 km of C(2800, 2100)
        inside_game = (0.0 <= X_c <= 5600.0) and (0.0 <= Y_c <= 4200.0)
        dist_c = math.hypot(X_c - 2800.0, Y_c - 2100.0)

        if inside_game or dist_c > 25000.0:
            continue

        raw_h = row["height"]
        raw_nf = row["num_floors"]
        if raw_h is not None and not np.isnan(raw_h) and raw_h > 0:
            bldg_h = float(raw_h)
        elif raw_nf is not None and not np.isnan(raw_nf) and raw_nf > 0:
            bldg_h = float(raw_nf) * 3.6
        else:
            bldg_h = 100.0

        poly = get_largest_polygon(geom_df)
        if poly is None or poly.is_empty:
            continue

        ring = simplify_footprint(poly)

        # Base elevation at centroid
        lon_c, lat_c = to_4326.transform(X_c + 299000.0, Y_c + 2766400.0)
        base_elev = round(float(dem(lon_c, lat_c)), 1)
        h_val = round(bldg_h, 1)

        bldg_name = row["name"] if row["name"] else None
        bldg_id = row["id"]
        seen_tower_ids.add(bldg_id)

        game_towers.append({
            "name": bldg_name,
            "ring": ring,
            "base": base_elev,
            "h": h_val,
        })

        landmarks_list.append({
            "name": bldg_name,
            "kind": "tower",
            "X": round(X_c, 1),
            "Y": round(Y_c, 1),
            "base": base_elev,
            "top": round(base_elev + h_val, 1),
            "height": h_val,
            "inside_game_area": False,
            "source": f"Overture {bldg_id}",
        })

    # 4) Named landmarks without height filter
    named_sql = """
    SELECT
        id,
        names.primary AS name,
        height,
        num_floors,
        ST_AsWKB(geometry) AS wkb
    FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*', hive_partitioning=1)
    WHERE bbox.xmin <= 121.62 AND bbox.xmax >= 121.45
      AND bbox.ymin <= 25.10 AND bbox.ymax >= 24.98
      AND names.primary IS NOT NULL
    """

    print("Querying named landmarks via DuckDB...")
    named_rows, _ = run_duckdb_query(con, named_sql, used_rel)

    target_keywords = [
        "101",
        "新光人壽",
        "新光摩天",
        "總統府",
        "臺北車站",
        "台北車站",
        "中正紀念堂",
        "國家戲劇院",
        "國家音樂廳",
        "圓山大飯店",
        "臺北京站",
        "南山廣場",
        "國泰金融",
        "遠企",
    ]

    def get_effective_height(r):
        h = r["height"]
        nf = r["num_floors"]
        if h is not None and not np.isnan(h) and h > 0:
            return float(h)
        if nf is not None and not np.isnan(nf) and nf > 0:
            return float(nf) * 3.6
        return 0.0

    selected_named_rows = []
    seen_named_ids = set()

    for kw in target_keywords:
        matches = [r for r in named_rows if r["name"] and kw in r["name"]]
        if matches:
            tallest = max(matches, key=get_effective_height)
            if tallest["id"] not in seen_named_ids:
                seen_named_ids.add(tallest["id"])
                selected_named_rows.append(tallest)

    for row in selected_named_rows:
        if not row["wkb"]:
            continue
        try:
            geom = shapely.from_wkb(bytes(row["wkb"]))
        except Exception:
            continue
        if geom.is_empty:
            continue

        geom_df = transform_to_df(geom)
        centroid = geom_df.centroid
        X_c = float(centroid.x)
        Y_c = float(centroid.y)

        lon_c, lat_c = to_4326.transform(X_c + 299000.0, Y_c + 2766400.0)
        base_elev = round(float(dem(lon_c, lat_c)), 1)

        raw_h = row["height"]
        raw_nf = row["num_floors"]
        if raw_h is not None and not np.isnan(raw_h) and raw_h > 0:
            bldg_h = round(float(raw_h), 1)
        elif raw_nf is not None and not np.isnan(raw_nf) and raw_nf > 0:
            bldg_h = round(float(raw_nf) * 3.6, 1)
        else:
            bldg_h = None

        top_elev = round(base_elev + (bldg_h if bldg_h is not None else 0.0), 1)
        inside_game = bool(0.0 <= X_c <= 5600.0 and 0.0 <= Y_c <= 4200.0)

        landmarks_list.append({
            "name": row["name"],
            "kind": "named",
            "X": round(X_c, 1),
            "Y": round(Y_c, 1),
            "base": base_elev,
            "top": top_elev,
            "height": bldg_h,
            "inside_game_area": inside_game,
            "source": f"Overture {row['id']}",
        })

    # Peaks from Overture theme=base/type=land/*
    peaks_sql = """
    SELECT
        id,
        names.primary AS name,
        elevation,
        ST_AsWKB(geometry) AS wkb
    FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=base/type=land/*', hive_partitioning=1)
    WHERE class = 'peak'
      AND bbox.xmin <= 121.80 AND bbox.xmax >= 121.30
      AND bbox.ymin <= 25.30 AND bbox.ymax >= 24.85
      AND elevation IS NOT NULL
    """

    print("Querying mountain peaks via DuckDB...")
    peak_rows, _ = run_duckdb_query(con, peaks_sql, used_rel)
    print(f"Fetched {len(peak_rows)} peaks.")

    peak_count = 0
    for row in peak_rows:
        if not row["wkb"]:
            continue
        try:
            pt = shapely.from_wkb(bytes(row["wkb"]))
        except Exception:
            continue
        if pt.is_empty:
            continue

        pt_df = transform_to_df(pt)
        X_val = float(pt_df.x)
        Y_val = float(pt_df.y)

        base_elev = round(float(dem(pt.x, pt.y)), 1)
        elev = float(row["elevation"])
        inside_game = bool(0.0 <= X_val <= 5600.0 and 0.0 <= Y_val <= 4200.0)

        landmarks_list.append({
            "name": row["name"] if row["name"] else None,
            "kind": "peak",
            "X": round(X_val, 1),
            "Y": round(Y_val, 1),
            "base": base_elev,
            "top": round(elev, 1),
            "height": None,
            "inside_game_area": inside_game,
            "source": f"Overture {row['id']}",
        })
        peak_count += 1

    # Ensure output directories exist
    for out_f in [args.out_game, args.out_landmarks]:
        parent = os.path.dirname(os.path.abspath(out_f))
        if parent:
            os.makedirs(parent, exist_ok=True)

    # Write --out-game JSON
    attribution = (
        "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
        "provided under COPERNICUS by the European Union and ESA; "
        "© OpenStreetMap contributors / Overture Maps Foundation (ODbL)"
    )
    game_json_data = {
        "note": attribution,
        "centre": [2800, 2100],
        "az_step": 1,
        "radii": radii_list,
        "h": h_list,
        "towers": game_towers,
    }

    with open(args.out_game, "w", encoding="utf-8") as f:
        json.dump(game_json_data, f, separators=(",", ":"))

    # Write --out-landmarks JSON
    with open(args.out_landmarks, "w", encoding="utf-8") as f:
        json.dump(landmarks_list, f, separators=(",", ":"))

    # Summary
    max_terrain_h = float(np.max(h_matrix))
    tallest_tower = max(game_towers, key=lambda t: t["h"]) if game_towers else None
    tallest_name = tallest_tower["name"] if tallest_tower and tallest_tower["name"] else "Unknown"
    tallest_h = tallest_tower["h"] if tallest_tower else 0.0

    print("\n=== Generation Summary ===")
    print(f"Terrain grid size: {len(radii_list)} rings x {len(h_list[0])} azimuths")
    print(f"Max terrain height on grid: {max_terrain_h:.1f} m")
    print(f"Far towers count: {len(game_towers)}")
    if tallest_tower:
        print(f"Tallest tower: {tallest_name} ({tallest_h:.1f} m)")
    print(f"Named landmarks count: {len(selected_named_rows)}")
    print(f"Mountain peaks count: {peak_count}")
    print(f"Total entries in {args.out_landmarks}: {len(landmarks_list)}")
    print(f"Successfully generated {args.out_game} and {args.out_landmarks}.")


if __name__ == "__main__":
    main()
