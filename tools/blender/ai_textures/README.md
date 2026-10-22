# AI 生成貼圖

Stable Diffusion XL base 1.0（CreativeML Open RAIL++-M）在 Google Colab（L4）生成，加 circular padding 成無縫貼圖；
生成腳本在使用者的 `~/3d/colab-jobs/tgp/gen_textures.py`。每張都人工檢查過，只留可用的（seed 1000 那組）。

| 檔案 | 內容 | 一張貼圖代表的實際大小 |
|---|---|---|
| facade_ai_cream / pink / grey | 馬賽克磁磚公寓立面（含鐵窗） | 寬 12 m × 高 12.8 m（約 4 層） |
| facade_ai_concrete | 老式水泥公寓立面（含陽台） | 寬 12 m × 高 12.8 m |
| roof_ai_0 / 1 | 平屋頂（綠色防水層） | 16 m × 16 m |
| facade_ai_blue_green_tile / green_tile_apts / yellow_tile_apts / brown_brick_tile / white_tile_apts / grey_wash | 低樓層公寓（≤24 m）的各色磁磚、洗石子立面 | 12 m × 12.8 m |
| facade_ai_old_concrete_balcony | 老式水泥公寓（陽台植栽） | 12 m × 12.8 m |
| facade_ai_condo_1990s / hotel_tiles / shophouse_arcade / school_corridor | 中樓層（24–42 m）：大樓、商旅、街屋、學校 | 12 m × 12.8 m |
| facade_ai_glass_office_v2 / stone_office | 高樓（>42 m）辦公大樓 | 12 m × 12.8 m |
| facade_ai_red_brick_old | 老紅磚建築（偶爾用在低矮舊屋） | 12 m × 12.8 m |
| shop_ai_convenience / hardware / oldwood / bakery / shutters_a / shutters_b / shutters_c | 騎樓下的一樓店面（只左右無縫，**沒有文字**；店名招牌帶由 `make_textures.py` 用程式畫上真的中文） | 寬 12 m × 高 3.7 m |

店面貼圖由 `tools/colab/shops_job.py` 生成：SDXL 的捲積只在左右方向環繞補邊，上下維持原本的補零；24 張裡挑 7 張正面、沒有假字的，再裁掉最上面 14%（那裡最容易出現招牌和假字）。

`normals/`：每張貼圖對應的法線圖（凹凸細節），用 Marigold Normals v1.1（OpenRAIL++）在 Colab 上計算；
為了無縫，先把貼圖拼成 3×3 再推算、取中間一塊。

出處：AI 生成（Colab SDXL）。
