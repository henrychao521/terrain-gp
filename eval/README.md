# eval/：建中周邊走廊的評分工具

給不同建模做法（A：Claude 管線、其他模型）用同一套標準比較。參考圖層在 `ref/clip/`（說明見 `ref/README.md`），座標一律是遊戲資料座標（TWD97 TM2 減 E 299000、N 2766400，單位公尺）。

## 檔案

| 檔案 | 內容 |
|---|---|
| `score.py` | 評分程式 |
| `labels.csv` | 人工標註樣本 50 棟（見下方） |
| `track_loop.json` | 環線的實際行駛中線、左右車道半寬、路面高度（`tools/test/node/world.js` 產生，和遊戲相同） |
| `baseline_A0_params.csv` | 遊戲現況（改之前）的建物參數，可當格式範例 |

## 用法

```
python3 eval/score.py <candidate_params.csv> --name 名稱 --out 結果.json --md 結果.md
python3 eval/score.py <candidate_params.csv> --tiles <放 t_3_3.gltf 等區塊的目錄> --name 名稱
python3 eval/score.py --tiles <目錄> --name 名稱            # 只跑射線檢查
```

需要 Python 的 shapely；`--tiles` 另外需要 Blender（環境變數 `BLENDER`，預設 `/Applications/Blender.app/Contents/MacOS/Blender`）。
`--tiles` 目錄要有和 `models/taipei/` 同名的 `t_3_3.gltf`、`t_3_4.gltf`、`t_4_3.gltf`、`t_4_4.gltf`（含 `.bin`、`tex/`），有 `.inst.json` 的話會一併檢查騎樓柱。

## candidate_params.csv 的格式

UTF-8、有標題列，一列一棟建物。走廊外的列會被忽略。

| 欄位 | 必填 | 內容 |
|---|---|---|
| `building_id` | 是 | 自訂的唯一代號 |
| `source_id` | 建議 | 輪廓來自哪裡：`tpe3d:<bid>`（`data/taipei.json` 建物序號）、`permit:<n>`（`ref/clip/permit.geojson` 的 `src_id`），或空白。和標註樣本比對時先用這欄對 `labels.csv` 的 `footprint_source_id`，對不到再用標註重心落在哪個輪廓裡 |
| `footprint_wkt` | 是 | 輪廓多邊形，WKT，資料座標（例如 `POLYGON ((2507 2890, 2559 2907, …))`） |
| `height_m` | 擇一 | 建物高度（m，地面到屋頂） |
| `floors` | 擇一 | 樓層數；沒有 `height_m` 時用 4.2 + (樓層 − 1) × 3.2 換算 |
| `roof_type` | 選填 | `flat_concrete`（灰色水泥平頂）、`flat_green`（綠色防水層平頂）、`metal_sheet`（鐵皮屋頂或加蓋）、`pitched_tile`（瓦片斜屋頂，含宮殿式琉璃瓦）、`dome`、`solar`（鋪滿太陽能板）、`mixed` |
| `arcade` | 選填 | `yes`／`no`（臨街面有沒有騎樓） |
| `use_class` | 選填 | `storefront`（一樓店面）、`residential`、`institutional`（學校、機關、博物館、公園內建物）、`religious` |
| `landmark` | 選填 | `yes`／`no` |

選填欄位空白就不計入該項正確率。

## 指標

| 指標 | 怎麼算 |
|---|---|
| 建照輪廓 IoU、重心偏移 | 走廊內每一筆建照套繪輪廓（面積 ≥ 30 m²，共 53 筆），和重疊超過 10% 的候選輪廓聯集算 IoU 與重心距離。沒有候選輪廓的算 IoU 0。建照只涵蓋民國 90 年以後的建物，而且有幾筆是施工中的工地 |
| 高度誤差 | 有樓層數的建照（17 筆）：重疊最多的候選建物高度，減去 4.2 + (樓層 − 1) × 3.2 |
| 標註樣本正確率 | `labels.csv` 中可判斷的列（`unknown`、`n/a` 不算）。`use_class` 的 `residential_mixed` 接受 `residential`、`storefront`、`mixed`；`roof_type` 的 `mixed` 接受 `mixed`、`metal_sheet`、`flat_concrete`。`building_present`：標註為沒有建物的地方，候選不該有建物 |
| 射線檢查 | 和 `tools/test/js/walls.js` 同規則（每隔一個取樣點、離路面 1 m、往左右射到路緣，462 個取樣點 × 2 = 924 條），另加 4 m／8 m 高的懸空檢查與騎樓柱 |

## labels.csv

用 `tools/jianzhong/label_sheets.py` 從走廊內 tpe3d 建物（面積 > 25 m²）隨機抽 50 棟（種子 2026，沿環線分五段各抽 10 棟），對著正射影像、建照套繪、使用分區逐棟判讀。

| 欄位 | 內容 |
|---|---|
| `row`、`building_id`、`bid`、`footprint_source_id` | 抽樣序號、`tpe3d:<bid>` |
| `permit_ids`、`floors`、`height_source` | 重疊的建照與其樓層（官方資料）；沒有建照的是 `unverified` |
| `h_tpe3d` | 遊戲現在的高度（參考，不是標準答案） |
| `building_present` | 影像上那裡現在有沒有建物（`no`：樹林、空地、工地） |
| `footprint_ok` | tpe3d 輪廓和影像上的屋頂是否吻合：`yes`／`partial`／`no` |
| `roof_type` | 影像判讀，類別同上 |
| `arcade` | 正射影像看不到騎樓：只有校園、機關內明顯退縮的建物標 `no`，其餘 `unknown` |
| `use_class` | `institutional`（依使用分區＋影像）、`religious`、`residential_mixed`（住宅區，看不出一樓是不是店面）、`none` |
| `landmark` | 宮殿式、圓頂等明顯的特殊建築標 `yes`；名稱未逐一查證 |
| `zone`、`centroid_x`、`centroid_y` | 使用分區、tpe3d 輪廓重心（資料座標） |
| `verified` | 這一列哪些欄位有依據（官方資料或影像清楚可見）；不在清單裡的欄位只是推測 |
| `notes` | 判讀說明 |

限制：

- 只有 2 棟有建照樓層可以核對高度（其餘 48 棟沒有官方樓層資料）；高度主要靠上面「建照 17 筆」那一項指標。
- 騎樓、一樓是不是店面從正上方看不到，大部分是 `unknown`。
- 判讀者是 A 管線（Claude）本身，建管線時看過這 50 張圖（`../work/labels/sheet_*.jpg`）。管線的規則沒有用這些標註調整；A 的分數仍應視為「標註者與受測者相同」的結果。
