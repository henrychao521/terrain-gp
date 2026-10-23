#!/usr/bin/env python3
import os
import sys
import math
import json
import argparse
import datetime
import urllib.request
import urllib.parse
import urllib.error
import numpy as np

try:
    import pyproj
except ImportError:
    pyproj = None

try:
    from PIL import Image
except ImportError:
    Image = None


def epsg3826_to_wgs84(E, N):
    """Convert EPSG:3826 (E, N in metres) to WGS84 (lon, lat in deg)."""
    is_scalar = np.isscalar(E)
    E = np.atleast_1d(np.asarray(E, dtype=float))
    N = np.atleast_1d(np.asarray(N, dtype=float))

    a = 6378137.0
    f = 1.0 / 298.257222101
    e2 = 2.0 * f - f * f
    e = math.sqrt(e2)
    n = f / (2.0 - f)
    n2 = n * n
    n3 = n * n2
    n4 = n2 * n2

    A = (a / (1.0 + n)) * (1.0 + 0.25 * n2 + (1.0 / 64.0) * n4)
    beta1 = 0.5 * n - (2.0 / 3.0) * n2 + (37.0 / 96.0) * n3 - (1.0 / 360.0) * n4
    beta2 = (1.0 / 48.0) * n2 + (1.0 / 15.0) * n3 - (437.0 / 1440.0) * n4
    beta3 = (17.0 / 480.0) * n3 - (37.0 / 840.0) * n4
    beta4 = (4397.0 / 161280.0) * n4

    k0 = 0.9999
    x0 = 250000.0
    y0 = 0.0
    lon0 = math.radians(121.0)

    eta = (E - x0) / (k0 * A)
    xi = (N - y0) / (k0 * A)

    xi0 = (
        xi
        - beta1 * np.sin(2.0 * xi) * np.cosh(2.0 * eta)
        - beta2 * np.sin(4.0 * xi) * np.cosh(4.0 * eta)
        - beta3 * np.sin(6.0 * xi) * np.cosh(6.0 * eta)
        - beta4 * np.sin(8.0 * xi) * np.cosh(8.0 * eta)
    )

    eta0 = (
        eta
        - beta1 * np.cos(2.0 * xi) * np.sinh(2.0 * eta)
        - beta2 * np.cos(4.0 * xi) * np.sinh(4.0 * eta)
        - beta3 * np.cos(6.0 * xi) * np.sinh(6.0 * eta)
        - beta4 * np.cos(8.0 * xi) * np.sinh(8.0 * eta)
    )

    sinh_eta0 = np.sinh(eta0)
    cos_xi0 = np.cos(xi0)
    sin_xi0 = np.sin(xi0)

    denom = np.sqrt(sinh_eta0 * sinh_eta0 + cos_xi0 * cos_xi0)
    sinh_psi = sin_xi0 / np.maximum(denom, 1e-15)
    psi = np.arcsinh(sinh_psi)

    dlam = np.arctan2(sinh_eta0, cos_xi0)
    lam = lon0 + dlam

    phi = np.arctan(sinh_psi)
    for _ in range(5):
        sin_p = np.sin(phi)
        cos_p = np.cos(phi)
        psi_cur = np.arcsinh(np.tan(phi)) - e * np.arctanh(e * sin_p)
        diff = psi - psi_cur
        dphi = diff * (1.0 - e2 * sin_p * sin_p) * cos_p / (1.0 - e2)
        phi = phi + dphi

    lon = np.degrees(lam)
    lat = np.degrees(phi)

    if is_scalar:
        return float(lon[0]), float(lat[0])
    return lon, lat


def wgs84_to_epsg3826(lon, lat):
    """Convert WGS84 (lon, lat in deg) to EPSG:3826 (E, N in metres)."""
    is_scalar = np.isscalar(lon)
    lon = np.atleast_1d(np.asarray(lon, dtype=float))
    lat = np.atleast_1d(np.asarray(lat, dtype=float))

    a = 6378137.0
    f = 1.0 / 298.257222101
    e2 = 2.0 * f - f * f
    e = math.sqrt(e2)
    n = f / (2.0 - f)
    n2 = n * n
    n3 = n * n2
    n4 = n2 * n2

    A = (a / (1.0 + n)) * (1.0 + 0.25 * n2 + (1.0 / 64.0) * n4)
    alpha1 = 0.5 * n - (2.0 / 3.0) * n2 + (5.0 / 16.0) * n3 + (41.0 / 180.0) * n4
    alpha2 = (13.0 / 48.0) * n2 - 0.6 * n3 + (557.0 / 1440.0) * n4
    alpha3 = (61.0 / 240.0) * n3 - (103.0 / 140.0) * n4
    alpha4 = (49561.0 / 161280.0) * n4

    k0 = 0.9999
    x0 = 250000.0
    y0 = 0.0
    lon0 = math.radians(121.0)

    phi = np.radians(lat)
    lam = np.radians(lon)
    dlam = lam - lon0

    sin_phi = np.sin(phi)
    tan_phi = np.tan(phi)
    psi = np.arcsinh(tan_phi) - e * np.arctanh(e * sin_phi)

    sinh_psi = np.sinh(psi)
    cos_dlam = np.cos(dlam)
    sin_dlam = np.sin(dlam)

    xi0 = np.arctan2(sinh_psi, cos_dlam)
    eta0 = np.arcsinh(sin_dlam / np.sqrt(sinh_psi * sinh_psi + cos_dlam * cos_dlam))

    xi = (
        xi0
        + alpha1 * np.sin(2.0 * xi0) * np.cosh(2.0 * eta0)
        + alpha2 * np.sin(4.0 * xi0) * np.cosh(4.0 * eta0)
        + alpha3 * np.sin(6.0 * xi0) * np.cosh(6.0 * eta0)
        + alpha4 * np.sin(8.0 * xi0) * np.cosh(8.0 * eta0)
    )

    eta = (
        eta0
        + alpha1 * np.cos(2.0 * xi0) * np.sinh(2.0 * eta0)
        + alpha2 * np.cos(4.0 * xi0) * np.sinh(4.0 * eta0)
        + alpha3 * np.cos(6.0 * xi0) * np.sinh(6.0 * eta0)
        + alpha4 * np.cos(8.0 * xi0) * np.sinh(8.0 * eta0)
    )

    E = x0 + k0 * A * eta
    N = y0 + k0 * A * xi

    if is_scalar:
        return float(E[0]), float(N[0])
    return E, N


class _CoordTransformer:
    def __init__(self, from_crs: str, to_crs: str):
        self.from_crs = from_crs
        self.to_crs = to_crs
        self._trans = None
        if pyproj is not None:
            try:
                self._trans = pyproj.Transformer.from_crs(
                    from_crs, to_crs, always_xy=True
                )
            except Exception:
                self._trans = None

    def transform(self, x, y):
        if self._trans is not None:
            return self._trans.transform(x, y)
        if "3826" in self.from_crs and "4326" in self.to_crs:
            return epsg3826_to_wgs84(x, y)
        elif "4326" in self.from_crs and "3826" in self.to_crs:
            return wgs84_to_epsg3826(x, y)
        return x, y


def load_token() -> str:
    token_path = os.path.expanduser("~/.config/mapillary/token.env")
    if not os.path.exists(token_path):
        raise RuntimeError(f"Token file not found: {token_path}")
    with open(token_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("MAPILLARY_TOKEN="):
                token = line[len("MAPILLARY_TOKEN=") :].strip()
                return token
    raise RuntimeError("MAPILLARY_TOKEN not found in token file")


def _safe_network_get_json(url: str, token: str = None) -> dict:
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "MapillaryTrackPicker/1.0"}
        )
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            return json.loads(data.decode("utf-8"))
    except Exception as e:
        msg = str(e)
        if token and token in msg:
            msg = msg.replace(token, "***")
        raise RuntimeError(msg) from None


def _safe_download_image(url: str, dest_path: str):
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "MapillaryTrackPicker/1.0"}
        )
        with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as out_f:
            out_f.write(resp.read())
    except Exception as e:
        raise RuntimeError("Failed to download image from CDN") from None


def select(images: list, track: dict, slot_m: float = 25.0, lat_m: float = 15.0) -> list:
    track_name = track.get("name", "track") if isinstance(track, dict) else str(track)
    n = int(track.get("n", 0))
    if n <= 0:
        return []

    ds = float(track.get("ds", 1.0))
    if "X" in track and "Y" in track:
        track_X = np.asarray(track["X"], dtype=float)
        track_Y = np.asarray(track["Y"], dtype=float)
    else:
        sx = float(track.get("sx", 0.0))
        sz = float(track.get("sz", 0.0))
        track_X = np.asarray(track["x"], dtype=float) + sx / 2.0
        track_Y = sz / 2.0 - np.asarray(track["z"], dtype=float)

    if "heading" in track:
        track_heading = np.asarray(track["heading"], dtype=float) % 360.0
    else:
        lx = np.asarray(track["lx"], dtype=float)
        lz = np.asarray(track["lz"], dtype=float)
        tx = -lz
        ty = -lx
        track_heading = (np.degrees(np.arctan2(tx, ty))) % 360.0

    if "lat" in track and "lon" in track:
        track_lat = np.asarray(track["lat"], dtype=float)
        track_lon = np.asarray(track["lon"], dtype=float)
    else:
        t_to_wgs = _CoordTransformer("EPSG:3826", "EPSG:4326")
        t_E = track_X + 299000.0
        t_N = track_Y + 2766400.0
        t_lon, t_lat = t_to_wgs.transform(t_E, t_N)
        track_lon = np.asarray(t_lon, dtype=float)
        track_lat = np.asarray(t_lat, dtype=float)

    s_max = (n - 1) * ds
    num_slots = int(s_max // slot_m) + 1

    slot_images = {i: [] for i in range(num_slots)}

    if images:
        img_X = np.array([float(img["X"]) for img in images], dtype=float)
        img_Y = np.array([float(img["Y"]) for img in images], dtype=float)
        track_pts = np.column_stack([track_X, track_Y])

        batch_size = 500
        for b_start in range(0, len(images), batch_size):
            b_end = min(b_start + batch_size, len(images))
            b_pts = np.column_stack([img_X[b_start:b_end], img_Y[b_start:b_end]])

            diff = b_pts[:, None, :] - track_pts[None, :, :]
            dists_sq = np.sum(diff * diff, axis=-1)
            nearest_k = np.argmin(dists_sq, axis=-1)
            min_dists = np.sqrt(dists_sq[np.arange(len(b_pts)), nearest_k])

            for idx_in_b, (k_near, d_val) in enumerate(zip(nearest_k, min_dists)):
                if d_val <= lat_m:
                    s_near = k_near * ds
                    s_idx = int(s_near // slot_m)
                    if 0 <= s_idx < num_slots:
                        orig_idx = b_start + idx_in_b
                        slot_images[s_idx].append(images[orig_idx])

    slots = []
    window_ms = 30 * 86400 * 1000

    for i in range(num_slots):
        k0 = min(max(0, int(round(i * slot_m / ds))), n - 1)
        slot_X_val = float(track_X[k0])
        slot_Y_val = float(track_Y[k0])
        slot_lat_val = float(track_lat[k0])
        slot_lon_val = float(track_lon[k0])
        fwd_hd = float(track_heading[k0]) % 360.0
        rev_hd = (fwd_hd + 180.0) % 360.0

        for d in ("fwd", "rev"):
            s_hd = fwd_hd if d == "fwd" else rev_hd

            candidates = []
            for img in slot_images[i]:
                is_pano = bool(img.get("is_pano")) or str(
                    img.get("camera_type", "")
                ).lower() in ("spherical", "equirectangular")
                img_hd = float(img.get("heading", 0.0)) % 360.0
                raw_diff = abs((img_hd - s_hd + 180.0) % 360.0 - 180.0)

                if is_pano:
                    cand_copy = dict(img)
                    cand_copy["_effective_diff"] = 0.0
                    cand_copy["_raw_diff"] = raw_diff
                    candidates.append(cand_copy)
                else:
                    if raw_diff <= 45.0 + 1e-7:
                        cand_copy = dict(img)
                        cand_copy["_effective_diff"] = raw_diff
                        cand_copy["_raw_diff"] = raw_diff
                        candidates.append(cand_copy)

            cand_years = sorted(
                list(
                    set(
                        datetime.datetime.fromtimestamp(
                            c["captured_at"] / 1000.0, tz=datetime.timezone.utc
                        ).year
                        for c in candidates
                        if "captured_at" in c
                    )
                )
            )

            pick = None
            if candidates:
                max_cap = max(c["captured_at"] for c in candidates)
                recent = [
                    c for c in candidates if (max_cap - c["captured_at"]) <= window_ms
                ]
                best_img = min(
                    recent,
                    key=lambda c: (
                        c["_effective_diff"],
                        -c["captured_at"],
                        str(c.get("id", "")),
                    ),
                )
                pick = {k: v for k, v in best_img.items() if not k.startswith("_")}
                is_best_pano = bool(pick.get("is_pano")) or str(
                    pick.get("camera_type", "")
                ).lower() in ("spherical", "equirectangular")
                pick["heading_diff"] = (
                    0.0 if is_best_pano else float(best_img["_raw_diff"])
                )
                pick["year"] = datetime.datetime.fromtimestamp(
                    best_img["captured_at"] / 1000.0, tz=datetime.timezone.utc
                ).year

            slot_dict = {
                "track": track_name,
                "slot": i,
                "s_m": i * slot_m,
                "dir": d,
                "k": k0,
                "X": slot_X_val,
                "Y": slot_Y_val,
                "lat": slot_lat_val,
                "lon": slot_lon_val,
                "heading": s_hd,
                "n_candidates": len(candidates),
                "pick": pick,
                "years": cand_years,
            }
            slots.append(slot_dict)

    return slots


def x5_rows(slots: list) -> list:
    groups = {}
    for s in slots:
        key = (s.get("track", ""), s.get("dir", ""))
        groups.setdefault(key, []).append(s)

    rows = []
    for (track_name, direction), track_slots in groups.items():
        track_slots.sort(key=lambda s: s.get("slot", 0))
        if not track_slots:
            continue

        slot_m_step = 25.0
        if len(track_slots) >= 2:
            diffs = [
                track_slots[j + 1]["s_m"] - track_slots[j]["s_m"]
                for j in range(len(track_slots) - 1)
                if track_slots[j + 1]["slot"] == track_slots[j]["slot"] + 1
            ]
            if diffs:
                slot_m_step = diffs[0]

        def is_bad(s):
            p = s.get("pick")
            if p is None:
                return True
            y = p.get("year")
            if y is None or y < 2022:
                return True
            return False

        runs = []
        curr_run = []
        for s in track_slots:
            if is_bad(s):
                if not curr_run:
                    curr_run.append(s)
                else:
                    if s.get("slot") == curr_run[-1].get("slot", 0) + 1:
                        curr_run.append(s)
                    else:
                        runs.append(curr_run)
                        curr_run = [s]
            else:
                if curr_run:
                    runs.append(curr_run)
                    curr_run = []
        if curr_run:
            runs.append(curr_run)

        for run in runs:
            first_s = run[0]
            last_s = run[-1]
            s_from = first_s.get("s_m", 0.0)
            s_to = last_s.get("s_m", 0.0) + slot_m_step

            picked_years = [
                s["pick"]["year"]
                for s in run
                if s.get("pick") is not None and s["pick"].get("year") is not None
            ]
            if not picked_years:
                reason = "沒有照片"
            else:
                newest = max(picked_years)
                reason = f"只有 2022 年以前的照片（最新 {newest}）"

            row = {
                "track": track_name,
                "dir": direction,
                "s_from": s_from,
                "s_to": s_to,
                "start_lat": first_s.get("lat", 0.0),
                "start_lon": first_s.get("lon", 0.0),
                "end_lat": last_s.get("lat", 0.0),
                "end_lon": last_s.get("lon", 0.0),
                "heading": first_s.get("heading", 0.0),
                "reason": reason,
            }
            rows.append(row)

    return rows


def _render_pano_crop(
    pano_path: str, out_path: str, slot_heading: float, img_heading: float
):
    if Image is None:
        return
    with Image.open(pano_path) as pano_img:
        pano_np = np.asarray(pano_img)
    if pano_np.ndim == 2:
        pano_np = np.stack([pano_np] * 3, axis=-1)
    elif pano_np.shape[2] > 3:
        pano_np = pano_np[:, :, :3]

    H_pano, W_pano = pano_np.shape[0], pano_np.shape[1]
    W, H = 1024, 576
    hfov_rad = math.radians(70.0)
    f = (W / 2.0) / math.tan(hfov_rad / 2.0)

    yaw_deg = slot_heading - img_heading
    yaw = math.radians(yaw_deg)
    cos_y = math.cos(yaw)
    sin_y = math.sin(yaw)

    u = np.arange(W, dtype=np.float32) - (W / 2.0) + 0.5
    v = (H / 2.0) - np.arange(H, dtype=np.float32) - 0.5
    uu, vv = np.meshgrid(u, v)

    rx = uu * cos_y + f * sin_y
    ry = vv
    rz = -uu * sin_y + f * cos_y

    rho = np.sqrt(rx * rx + ry * ry + rz * rz)
    theta = np.arcsin(np.clip(ry / rho, -1.0, 1.0))
    phi = np.arctan2(rx, rz)

    x_p = ((phi / (2.0 * np.pi) + 0.5) * W_pano) % W_pano
    y_p = (0.5 - theta / np.pi) * (H_pano - 1)
    y_p = np.clip(y_p, 0.0, H_pano - 1.0)

    x0 = np.floor(x_p).astype(np.int32)
    x1 = (x0 + 1) % W_pano
    y0 = np.floor(y_p).astype(np.int32)
    y1 = np.clip(y0 + 1, 0, H_pano - 1)

    wx = (x_p - x0)[..., None]
    wy = (y_p - y0)[..., None]

    top = (1.0 - wx) * pano_np[y0, x0] + wx * pano_np[y0, x1]
    bot = (1.0 - wx) * pano_np[y1, x0] + wx * pano_np[y1, x1]
    out = (1.0 - wy) * top + wy * bot

    out_img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    out_img.save(out_path, quality=95)


def _render_perspective_crop(persp_path: str, out_path: str, pick: dict) -> float:
    if Image is None:
        return 70.0
    with Image.open(persp_path) as persp_img:
        W_src, H_src = persp_img.size
        target_w, target_h = 1024, 576
        target_aspect = target_w / target_h
        src_aspect = W_src / H_src

        if src_aspect > target_aspect:
            w_crop = int(round(H_src * target_aspect))
            h_crop = H_src
            left = (W_src - w_crop) // 2
            top = 0
            right = left + w_crop
            bottom = H_src
        else:
            w_crop = W_src
            h_crop = int(round(W_src / target_aspect))
            left = 0
            top = (H_src - h_crop) // 2
            right = W_src
            bottom = top + h_crop

        cropped = persp_img.crop((left, top, right, bottom))
        resized = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)
        resized.save(out_path, quality=95)

    cam_params = pick.get("camera_parameters")
    if (
        cam_params
        and len(cam_params) > 0
        and cam_params[0] is not None
        and float(cam_params[0]) > 0
    ):
        f_rel = float(cam_params[0])
        focal_px = f_rel * max(W_src, H_src)
        fov = 2.0 * math.degrees(math.atan((w_crop / 2.0) / focal_px))
    else:
        tan_half = math.tan(math.radians(35.0))
        fov = 2.0 * math.degrees(math.atan((w_crop / float(W_src)) * tan_half))

    return fov


def main():
    parser = argparse.ArgumentParser(description="Mapillary track photo picker")
    parser.add_argument(
        "--tracks", nargs="+", required=True, help="name=path.json [name=path.json ...]"
    )
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--img-dir", required=True, help="Image directory")
    parser.add_argument(
        "--offline", action="store_true", help="Offline mode, read only cache"
    )
    parser.add_argument(
        "--slot", type=float, default=25.0, help="Slot length in metres (default 25)"
    )
    parser.add_argument(
        "--lat", type=float, default=15.0, help="Lateral tolerance in metres (default 15)"
    )
    args = parser.parse_args()

    out_dir = args.out
    img_dir = args.img_dir
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, "raw"), exist_ok=True)
    os.makedirs(os.path.join(img_dir, "crops"), exist_ok=True)

    token = None
    if not args.offline:
        token = load_token()

    t_to_wgs = _CoordTransformer("EPSG:3826", "EPSG:4326")
    t_from_wgs = _CoordTransformer("EPSG:4326", "EPSG:3826")

    tracks = {}
    for item in args.tracks:
        if "=" not in item:
            continue
        name, path = item.split("=", 1)
        with open(path, "r", encoding="utf-8") as f:
            t_data = json.load(f)
            t_data["name"] = name
            tracks[name] = t_data

    tile_step = 0.0015
    all_raw_images = {}

    for t_name, t_data in tracks.items():
        sx = float(t_data.get("sx", 0.0))
        sz = float(t_data.get("sz", 0.0))
        X = np.asarray(t_data["x"], dtype=float) + sx / 2.0
        Y = sz / 2.0 - np.asarray(t_data["z"], dtype=float)

        min_E = np.min(X) + 299000.0 - 40.0
        max_E = np.max(X) + 299000.0 + 40.0
        min_N = np.min(Y) + 2766400.0 - 40.0
        max_N = np.max(Y) + 2766400.0 + 40.0

        p1_lon, p1_lat = t_to_wgs.transform(min_E, min_N)
        p2_lon, p2_lat = t_to_wgs.transform(max_E, max_N)
        min_lon = min(p1_lon, p2_lon)
        max_lon = max(p1_lon, p2_lon)
        min_lat = min(p1_lat, p2_lat)
        max_lat = max(p1_lat, p2_lat)

        d_lon = max_lon - min_lon
        d_lat = max_lat - min_lat
        n_lon_tiles = max(1, int(math.ceil(d_lon / tile_step)))
        n_lat_tiles = max(1, int(math.ceil(d_lat / tile_step)))
        dlon_act = d_lon / n_lon_tiles
        dlat_act = d_lat / n_lat_tiles

        for ix in range(n_lon_tiles):
            for iy in range(n_lat_tiles):
                tile_min_lon = min_lon + ix * dlon_act
                tile_max_lon = min_lon + (ix + 1) * dlon_act
                tile_min_lat = min_lat + iy * dlat_act
                tile_max_lat = min_lat + (iy + 1) * dlat_act

                tile_id = (
                    f"tile_{tile_min_lon:.5f}_{tile_min_lat:.5f}_{tile_max_lon:.5f}_{tile_max_lat:.5f}".replace(
                        ".", "p"
                    ).replace(
                        "-", "m"
                    )
                )
                cache_path = os.path.join(out_dir, "raw", f"{tile_id}.json")

                tile_images = []
                if args.offline:
                    if os.path.exists(cache_path):
                        with open(cache_path, "r", encoding="utf-8") as cf:
                            c_data = json.load(cf)
                            tile_images = c_data.get("data", [])
                else:
                    if os.path.exists(cache_path):
                        with open(cache_path, "r", encoding="utf-8") as cf:
                            c_data = json.load(cf)
                            tile_images = c_data.get("data", [])
                    else:
                        base_url = "https://graph.mapillary.com/images"
                        params = {
                            "bbox": f"{tile_min_lon:.6f},{tile_min_lat:.6f},{tile_max_lon:.6f},{tile_max_lat:.6f}",
                            "limit": "2000",
                            "fields": "id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,camera_type,camera_parameters,is_pano,width,height,creator,sequence,thumb_1024_url,thumb_2048_url",
                            "access_token": token,
                        }
                        curr_url = f"{base_url}?{urllib.parse.urlencode(params)}"
                        while curr_url:
                            res_json = _safe_network_get_json(curr_url, token=token)
                            items = res_json.get("data", [])
                            tile_images.extend(items)
                            paging = res_json.get("paging", {})
                            curr_url = paging.get("next")

                        if len(tile_images) >= 2000:
                            print("WARNING tile hit the 2000-image limit:", tile_id, file=sys.stderr)
                        with open(cache_path, "w", encoding="utf-8") as cf:
                            json.dump({"data": tile_images}, cf)

                for img in tile_images:
                    img_id = str(img["id"])
                    if img_id not in all_raw_images:
                        geom = (
                            img.get("computed_geometry")
                            or img.get("geometry")
                            or {}
                        )
                        coords = geom.get("coordinates")
                        if not coords or len(coords) < 2:
                            continue
                        i_lon, i_lat = float(coords[0]), float(coords[1])
                        E, N = t_from_wgs.transform(i_lon, i_lat)
                        i_X = E - 299000.0
                        i_Y = N - 2766400.0

                        c_angle = img.get("computed_compass_angle")
                        if c_angle is None:
                            c_angle = img.get("compass_angle")
                        i_hd = float(c_angle) % 360.0 if c_angle is not None else 0.0

                        parsed_img = dict(img)
                        parsed_img["X"] = i_X
                        parsed_img["Y"] = i_Y
                        parsed_img["heading"] = i_hd
                        parsed_img["captured_at"] = int(img.get("captured_at", 0))
                        parsed_img["is_pano"] = bool(img.get("is_pano")) or str(
                            img.get("camera_type", "")
                        ).lower() in ("spherical", "equirectangular")
                        parsed_img["camera_type"] = img.get("camera_type", "")
                        all_raw_images[img_id] = parsed_img

    processed_images = list(all_raw_images.values())

    all_slots = []
    coverage_report = {}
    for t_name, t_data in tracks.items():
        t_slots = select(
            processed_images, t_data, slot_m=args.slot, lat_m=args.lat
        )
        all_slots.extend(t_slots)

        for d in ("fwd", "rev"):
            group = [s for s in t_slots if s["dir"] == d]
            slots_cnt = len(group)
            covered_cnt = sum(1 for s in group if s.get("pick") is not None)
            covered_2022plus_cnt = sum(
                1
                for s in group
                if s.get("pick") is not None
                and s["pick"].get("year") is not None
                and s["pick"]["year"] >= 2022
            )

            hist = {}
            creators = set()
            for s in group:
                p = s.get("pick")
                if p:
                    yr = str(p.get("year"))
                    hist[yr] = hist.get(yr, 0) + 1
                    c_info = p.get("creator")
                    if isinstance(c_info, dict):
                        u_name = c_info.get("username")
                        if u_name:
                            creators.add(u_name)
                    elif c_info:
                        creators.add(str(c_info))

            key = f"{t_name}_{d}"
            coverage_report[key] = {
                "track": t_name,
                "dir": d,
                "slots": slots_cnt,
                "covered": covered_cnt,
                "covered_2022plus": covered_2022plus_cnt,
                "year_histogram": hist,
                "distinct_creators": len(creators),
            }

    with open(os.path.join(out_dir, "slots.json"), "w", encoding="utf-8") as f:
        json.dump(all_slots, f, indent=2, ensure_ascii=False)

    with open(os.path.join(out_dir, "coverage.json"), "w", encoding="utf-8") as f:
        json.dump(coverage_report, f, indent=2, ensure_ascii=False)

    x5_result = x5_rows(all_slots)
    with open(os.path.join(out_dir, "x5.json"), "w", encoding="utf-8") as f:
        json.dump(x5_result, f, indent=2, ensure_ascii=False)

    poses = []
    for s in all_slots:
        pick = s.get("pick")
        if not pick:
            continue

        p_id = str(pick["id"])
        img_filename = f"{p_id}.jpg"
        img_path = os.path.join(img_dir, img_filename)

        if not os.path.exists(img_path):
            img_url = pick.get("thumb_2048_url") or pick.get("thumb_1024_url")
            if img_url:
                _safe_download_image(img_url, img_path)

        pose_id = f"{s['track']}_{s['slot']:03d}_{s['dir']}"
        crop_path = os.path.join(img_dir, "crops", f"{pose_id}.jpg")

        is_pano = bool(pick.get("is_pano")) or str(
            pick.get("camera_type", "")
        ).lower() in ("spherical", "equirectangular")

        if is_pano:
            if os.path.exists(img_path):
                _render_pano_crop(
                    img_path,
                    crop_path,
                    float(s["heading"]),
                    float(pick.get("heading", 0.0)),
                )
            pose_heading = float(s["heading"])
            pose_fov = 70.0
            pose_img = crop_path
        else:
            if os.path.exists(img_path):
                pose_fov = _render_perspective_crop(img_path, crop_path, pick)
            else:
                pose_fov = 70.0
            pose_heading = float(pick.get("heading", 0.0))
            pose_img = crop_path

        c_info = pick.get("creator")
        if isinstance(c_info, dict):
            c_username = c_info.get("username", "")
        else:
            c_username = str(c_info or "")

        cap_ts = pick.get("captured_at", 0) / 1000.0
        cap_iso = datetime.datetime.fromtimestamp(
            cap_ts, tz=datetime.timezone.utc
        ).isoformat()

        pose_entry = {
            "id": pose_id,
            "X": float(pick["X"]),
            "Y": float(pick["Y"]),
            "heading": pose_heading,
            "fov": pose_fov,
            "w": 1024,
            "h": 576,
            "img": pose_img,
            "mapillary_id": p_id,
            "creator_username": c_username,
            "captured_at": cap_iso,
            "licence": "CC BY-SA 4.0",
        }
        poses.append(pose_entry)

    with open(os.path.join(out_dir, "poses.json"), "w", encoding="utf-8") as f:
        json.dump(poses, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
