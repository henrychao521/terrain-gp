# 參考圖資來源（建中周邊走廊）

下載日期：2026-10-23。原始檔放在 `ref/raw/`、`ref/ortho/`，不進 git（`.gitignore` 只放行這份與 `README.md`）。
重新下載：`tools/jianzhong/fetch_ortho.py`（正射影像），其餘四份用下表的網址以 `curl -L` 取得後解壓到對應目錄，再跑 `tools/jianzhong/prep_ref.py`。

| 檔案（ref/raw/…） | 資料集 | 發布機關 | 下載網址 | 授權 | 日期／版本 | 解析度、內容 |
|---|---|---|---|---|---|---|
| `permit/taipei_1151005.*`（zip 3.38 MB） | 臺北市建築執照套繪圖（data.gov.tw 151936） | 臺北市建築管理工程處 | https://data.taipei/api/dataset/af067fb6-9e47-4f4c-a484-e72eba161319/resource/ccdfe8df-ef54-4c13-a93d-ba42968ced3b/download | 政府資料開放授權條款－第1版 | 檔案 2026-10-05；收錄民國 90–115 年核發的建照 | SHP 多邊形，TWD97 TM2（EPSG:3826）；`bud_floor` 樓層、`bud_const` 構造、`budatt_no` 建照號。全市 10,052 筆，走廊內 61 筆。民國 90 年以前的建物沒有 |
| `road8m/8mroadup/Road.*`（zip 3.07 MB） | 臺北市寬度超過8公尺道路GIS圖資（data.gov.tw 156810） | 臺北市政府工務局新建工程處 | https://data.taipei/api/dataset/ee2e4015-8844-48fb-aa57-31209909b0fc/resource/074a401d-45a2-4748-bf62-7d5372d53d45/download | 政府資料開放授權條款－第1版 | 檔案 2025-09；測繪 103–105 年 | SHP 多邊形（每個路段一塊道路用地），EPSG:3826；`ROADWIDTH`、`CEN_MEDIAN`、`SWALK_AREA`。走廊內 62 塊 |
| `roadwidth/roadsize2.*`（zip 1.06 MB） | 臺北市道路寬度（data.gov.tw 137761） | 臺北市政府都市發展局 | https://data.taipei/api/dataset/068be2c7-eea1-4303-91f8-fbf50c9b2aec/resource/f8fc1725-b1df-4701-9bdf-c26939904b4e/download | 政府資料開放授權條款－第1版 | 檔案 2023-12 | SHP 線（都市計畫路寬標註，例如 25M），EPSG:3826。走廊內 150 筆 |
| `sidewalk/TP_SIDEWORK.json`（24.4 MB） | 臺北市人行道範圍圖（data.gov.tw 134905） | 臺北市政府工務局新建工程處 | https://data.taipei/api/dataset/715d3a83-8445-4496-b6bf-b0900538b7e7/resource/b11d6142-1d71-41d5-a843-7b7cfcea61ef/download | 政府資料開放授權條款－第1版 | 下載當日版本 | GeoJSON 多邊形，EPSG:3826；`SW_WTH` 人行道寬、`SW_DIRECT` 側別。走廊內 135 筆 |
| `zoning/zoning_detail_poly.*`（zip 4.19 MB，檔名 `細計-面`） | 臺北市都市計畫使用分區圖 全市細計（data.gov.tw 156197） | 臺北市政府都市發展局 | https://data.taipei/api/dataset/3bab0a01-7936-4218-8cb5-f74dfcb43dda/resource/0cb6e68a-87c1-4846-b766-bcde3ebe179c/download | 政府資料開放授權條款－第1版 | 更新至民國 114 年 1 月 | SHP 多邊形（zip 內沒有 .prj，座標是 TWD97 TM2；多邊形繞向相反，`prep_ref.py` 用奇偶規則重組）。走廊內 147 塊 |
| `../ortho/PHOTO2_z19/*.jpg`（168 張圖磚，3.4 MB） | 臺灣通用正射影像 `PHOTO2`（WMTS） | 內政部國土測繪中心 | `https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/19/{y}/{x}` | **不是**政府資料開放授權條款。適用「國土測繪圖資服務雲使用條款」（https://maps.nlsc.gov.tw/pro/use_clause.jsp）：可公開顯示並附來源，但不得大量下載；不代表取得著作權 | 影像浮水印「NLSC 2024」 | z19，約 0.27 m／像素（z20 是放大內插）。EPSG:3857，`fetch_ortho.py` 重新取樣到 TWD97（0.25 m）。高樓有倒向，不是真正射 |

另外沿用遊戲原本的資料：`data/taipei.json` 建物（臺北市自動化3D近似建物模型，經 sheethub/tpe3d 轉檔；臺北市開放資料授權）、`data/taipei_osm.json` 道路（© OpenStreetMap contributors，ODbL）。

## 正射影像的使用範圍（重要）

使用者原本以為正射影像是政府資料開放授權條款；實際查證不是（見上表）。所以這次只把它當「比對與顯示」用：

- 只抓走廊範圍一次（168 張，相當於在地圖上瀏覽這一區），不進 git、不散布原圖。
- 文件裡的套疊圖都標明「內政部國土測繪中心 PHOTO2 正射影像」來源，屬於條款允許的公開顯示。
- 不拿來訓練任何生成模型（貼圖 LoRA 不用它）。
- 建物參數表裡從影像判讀的欄位（屋頂類型）是人工或模型「看圖判斷的事實」，不是影像本身；這點是否可以放進公開 repo，列為待決定事項。

## 查過但不能用的來源

| 來源 | 原因 |
|---|---|
| NLSC 三維建物模型（3D Tiles／I3S，LOD1，有 `BUILD_H`、`BUILD_NO`） | 服務條款只允許宣傳或表示使用該服務；離線資料臺北市不供應。不拿來比對也不拿來建模 |
| NLSC 3D Tiles 的立面貼圖 | 是通用磚牆、窗戶樣板拼出來的，不是實拍；授權同上 |
| 臺北市 1/1000 數值地形圖建物層 | 要申請，取得後不得上網散布（需都發局書面核准） |
| 臺灣通用電子地圖建物向量 | 付費商品；開放版只到 1/18,000，看不出單棟 |
| 斜拍航照、實景 3D（地政局多維度測繪系統） | 只能線上瀏覽，沒有開放下載 |
| 臺北市宗教建築3D模型庫（data.gov.tw 121136，OGDL，有實拍立面貼圖） | 授權乾淨，但最近的一棟離建中約 1.5 km，而且是寺廟教堂，不代表這一帶的街屋立面 |
