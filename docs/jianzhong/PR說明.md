# PR 說明草稿：建中周邊街景修正（fix/jianzhong-corridor）

給負責 terrain-gp 的對話：這個分支只動建中周邊走廊（南海路、和平西路一二段、重慶南路二三段），沒有改 `game.js`、`index.html`、`data/taipei.json`、`data/taipei_osm.json`。詳細內容見 `docs/jianzhong/進度報告.md`。

## 改了什麼

- **四個區塊重建**：`models/taipei/t_3_3`、`t_3_4`、`t_4_3`、`t_4_4`（`tiles.json` 不變），新增 10 張屋頂貼圖 `models/taipei/tex/roof_*.webp`、`tile_green.webp`、`tile_slate.webp`。其他 44 個區塊沒有重建。
- **`tools/blender/build_tile.py`**
  - 新功能：讀 `data/corridors/*.json`（每棟建物的輪廓、高度、屋頂、騎樓、用途、地標），範圍內與 `replaces` 列出的 `data/taipei.json` 建物改用它；OSM 地標可由它改高度與屋頂。沒有這個目錄時行為和原本一樣。
  - 修正 `clear_roads()`：頂點推回建物自己那一側。原本落在道路中線另一側的頂點會被推到對面路緣，建物被拉成橫跨馬路（南海路 19／924 的成因）。
  - 修正騎樓：`offset_ring()` 內縮後的輪廓自我交叉或跑出建物時，改成不做騎樓（原本一樓店面牆會穿出建物）。
  - `TGP_DUMP`／`TGP_DUMP_ONLY` 環境變數：輸出每棟建物最後的輪廓與選擇（除錯用）。
  - **注意**：上面兩項修正會影響之後重建的任何區塊（輪廓會變，對的方向）。
- **`tools/blender/make_textures.py`**：新增屋頂貼圖函式。重新產生時共用貼圖（招牌、店面、tile_gold 等）的亂數結果和 repo 裡的原檔不同，這個分支保留原檔沒有覆蓋。
- **`data/corridors/jianzhong.json`**：走廊 418 棟的參數，由 `tools/jianzhong/derive_params.py` 產生（官方建照、道路、人行道、使用分區＋VLM 判讀正射影像）。
- **不開瀏覽器的檢查**（新增，沒有改 `run.py`）：
  - `tools/test/node/world.js`：Node 裡跑 `game.js` 建賽道，輸出幾何；可加 `"check": "line.js"` 跑行車線檢查。
  - `tools/test/blender_walls.py`：Blender 版 walls 檢查，多了 4／8 m 懸空與騎樓柱。
- `tools/jianzhong/`、`tools/colab/roof_vlm_job.py`、`eval/`、`ref/README.md`、`ref/SOURCES.md`、`docs/jianzhong/`。`ref/` 其餘內容（原始下載、正射影像）在 `.gitignore`。

## 測試

| 檢查 | 結果 |
|---|---|
| 建中環線 walls（Blender 版，規則同 `js/walls.js`） | 19／924 → **0／924**；4／8 m 懸空 23 → 0；騎樓柱 2 → 0 |
| 三條預設環線 walls（Blender 版） | 0／0／0（和改之前相同） |
| `js/line.js`（Node 版） | 三條預設環線單圈時間與跑出路面 0，和 `tools/test/README.md` 相同 |
| `run.py quick` | **沒有跑**：使用者要求不開 Chrome。請在合併前用有 Chrome 的環境跑一次 `python3 tools/test/run.py quick` |

## 請另一個對話決定或處理

1. 南海路的 OSM 中線比實際偏南約 6 m（官方人行道圖層量得），遊戲車道南側壓在校地上；要不要改 `data/taipei_osm.json`。
2. 要不要把 Node／Blender 版檢查收進 `run.py`（例如 `run.py --no-browser walls`）。
3. 預設環線 1 在 `t_2_4` 有 2 條 8 m 高的懸空射線（原本就有）。
4. 建中環線目前只在 `eval/track_loop.json` 與測試裡，沒有加進 `TP_CIRCUITS`（校名賽道需校方同意）。

## 資料來源與授權（credits 可能要補）

- 臺北市建築執照套繪圖、臺北市寬度超過8公尺道路GIS圖資、臺北市人行道範圍圖、臺北市都市計畫使用分區圖：政府資料開放授權條款第1版。
- 屋頂類型、有無建物由 Qwen3-VL（Apache-2.0）判讀國土測繪中心正射影像；正射影像不是開放授權，原圖沒有放進 repo。是否需要在遊戲的出處欄加註，請一併決定。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
