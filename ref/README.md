# ref/：建中周邊走廊的參考圖層

這個目錄不進 git（只有這份說明與 `SOURCES.md` 進），內容可以用下列指令重建（在 repo 根目錄、用有 shapely／pyproj／pyshp／Pillow 的 Python）：

```
node tools/test/node/world.js <instrument.py 做的複本> '{"loop": [[2915,3002],[2700,2962],[2470,2878],[2760,2655],[3050,2510],[2995,2760]]}' > ../work/track_loop_before.json
python3 tools/jianzhong/fetch_ortho.py          # 正射影像（見 SOURCES.md 的使用限制）
python3 tools/jianzhong/prep_ref.py             # 裁切成 ref/clip/*.geojson
```

## 座標

全部是**遊戲資料座標**：公尺，TWD97 TM2（EPSG:3826）減去 E 299000、N 2766400（x 往東、y 往北），和 `data/taipei.json` 相同。
換回 EPSG:3826：`E = x + 299000`、`N = y + 2766400`。換成遊戲世界座標：`x_world = x − 2800`、`z_world = 2100 − y`。

範圍（`clip/corridor.geojson` 的 `area`）：環線實際行駛中線左右各 150 m，加上環線圍住的街廓（建中校園）。

## 檔案

| 檔案 | 內容 | 幾何 | 欄位（單位） | 來源／授權 |
|---|---|---|---|---|
| `ortho_PHOTO2_z19_twd97.png` + `.json` | 正射影像，北朝上 | 3600×3248 像素，0.25 m／像素 | `.json`：`x0`（左緣）、`y1`（上緣）、`res`；像素 (i, j) 中心 = (x0+(i+0.5)·res, y1−(j+0.5)·res) | 國土測繪中心 PHOTO2，**非開放授權**，只供比對顯示 |
| `clip/permit.geojson` | 建照套繪的建物輪廓 | Polygon／MultiPolygon | `src_id`（`permit:<全市檔列號>`）、`floors`（樓層，0 或缺值為 null）、`const`（構造）、`permit`（建照號）、`area_m2` | 臺北市建管處，OGDL v1；只有民國 90 年以後的建照 |
| `clip/road8m.geojson` | 道路用地（路段面） | Polygon | `ROADNAME`、`ROAD_ID`、`ROADWIDTH`（m）、`CEN_MEDIAN`（中央分隔面積 m²）、`SWALK_AREA`（人行道面積 m²） | 臺北市新工處，OGDL v1 |
| `clip/sidewalk.geojson` | 人行道範圍 | Polygon／MultiPolygon | `NAME_Road`、`SW_DIRECT`（側別）、`SW_WTH`（寬 m）、`PSTART`／`PEND` | 臺北市新工處，OGDL v1 |
| `clip/roadwidth.geojson` | 都市計畫路寬標註 | LineString | `road_width`（例如 `25M`）、`angle` | 臺北市都發局，OGDL v1 |
| `clip/zoning.geojson` | 都市計畫使用分區（細部計畫） | Polygon | `zone`（使用分區，例如 `高中用地`、`第三種住宅區`）、`code`、`short` | 臺北市都發局，OGDL v1 |
| `clip/game_buildings.geojson` | 遊戲現在用的建物（比較基準 A0） | Polygon | `bid`（`data/taipei.json` 的建物序號）、`height_m`、`area_m2`；feature id `tpe3d:<bid>` | 臺北市自動化3D近似建物模型（sheethub/tpe3d） |
| `clip/osm_roads.geojson` | 遊戲用的道路 | LineString | `rid`、`name`、`cls`、`oneway`、`lanes`、`width_m`（遊戲車道寬）、`layer` | © OpenStreetMap contributors，ODbL |
| `clip/osm_landmarks.geojson` | 遊戲的地標零件 | Polygon | OSM 的 `n`（名稱）、`h`、`mh`、`rs` 等 | ODbL |
| `clip/corridor.geojson` | 走廊範圍與行駛中線 | Polygon＋LineString | `what`（`area`／`centreline`）、`clip_m`、`len_m` | 由 `tools/test/node/world.js` 的中線產生 |
| `raw/`、`ortho/` | 原始下載檔 | | | 見 `SOURCES.md` |

注意：

- 建照套繪是「這張建照蓋的建物」輪廓，一張建照可能包含相連的好幾棟，也可能只是基地內的一部分；民國 90 年以前的建物（建中校舍、多數老公寓）沒有資料。
- 道路用地面包含人行道；車道邊線（路緣）用 `sidewalk.geojson` 的內緣判斷，沒有人行道的路段只能用道路用地邊界。
- 和平西路、重慶南路在這一段是有中央分隔的雙向道路，遊戲只開其中一側的車道，左側（分隔島那側）的官方「路緣」其實是對向車道的人行道，比較時只看右側（外側）。
