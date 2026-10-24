# Terrain GP

F1 風格的瀏覽器賽車，可用高度圖、臺北實測地形或 OpenStreetMap 地圖當賽道。

線上試玩：https://henrychao521.github.io/terrain-gp/

- `index.html`、`game.js`：遊戲本體（three.js r128，從 cdnjs／jsDelivr 載入）。
- `data/taipei.json`：臺北街道賽資料，由 `tools/prep_taipei.py` 從 [xindian-flood-sim](https://github.com/henrychao521/xindian-flood-sim) 的 `data/processed`（20 m DEM、3D 建物、OSM 道路）打包而成。
  重新產生：`python3 tools/prep_taipei.py <xindian-flood-sim 路徑>/data/processed`（在本 repo 根目錄執行）。

- `data/taipei_osm.json`：臺北街道賽的實際道路細節（車道數、路寬、單行道、行道樹、公園、號誌與路名、斑馬線、地標 3D 造型），行道樹與公園樹木來自臺北市政府工務局公園路燈工程管理處的樹木資料（政府資料開放授權條款第1版，data.gov.tw/dataset/128274，約 2.7 萬棵，含樹種與樹高）；由 `tools/prep_taipei_osm.py` 從 OpenStreetMap 原始圖資（api.openstreetmap.org 0.01° 分塊下載）產生：`python3 tools/prep_taipei_osm.py <分塊目錄>`。

- `models/taipei/`：用 Blender 建模的臺北街景區塊（700 m 一塊，全圖 48 塊；遊戲只載入賽道 1.2 km 內的區塊），包含建物的騎樓、鐵窗、冷氣、直立招牌、屋頂水塔，高架道路與橋，以及東門、中正紀念堂、國家戲劇院／音樂廳、自由廣場牌樓等地標。由 `tools/blender/` 的腳本產生：
  ```
  python3 tools/blender/make_textures.py <貼圖目錄>
  python3 tools/blender/build_tiles.py <貼圖目錄> tools/blender/all_tiles.json 700 4
  blender -b --factory-startup --python tools/blender/build_props.py -- models/props/props.gltf
  ```
  區塊範圍登記在 `models/taipei/tiles.json`；範圍內的建物與地標改用 Blender 模型，範圍外仍由遊戲即時產生。公寓立面與屋頂貼圖是 AI 生成（Colab SDXL，`tools/blender/ai_textures/`，見該目錄說明）。鐵窗、冷氣、騎樓柱、水塔以位置清單（`*.inst.json`）儲存，遊戲用 instancing 繪製。`models/props/` 是 Blender 建模的行道樹（樟樹、榕樹、台灣欒樹）、水馬、路燈與號誌燈頭；樹和水馬在鏡頭附近換成模型，遠處用簡化版本。

- `data/corridors/`：個別走廊的逐棟建物參數（輪廓、高度、屋頂、騎樓、用途、地標），`build_tile.py` 在範圍內改用它；目前有建中周邊（`tools/jianzhong/derive_params.py` 產生，說明見 `docs/jianzhong/`）。

- `tools/test/`：回歸測試與量測工具（建物有沒有長在車道裡、行車線、電腦車模擬、賽車性能、畫面效能、新手機器人）。`python3 tools/test/run.py quick` 約 35 秒跑完不需要獨佔電腦的檢查，說明見 `tools/test/README.md`。

線上對戰使用 claude.ai Artifact 的即時房間功能，只在 claude.ai 上開啟時可用；GitHub Pages 版本支援單人計時與電腦對手。

資料來源：內政部國土測繪中心 2025 年 20 m DEM（政府資料開放授權條款第 1 版）；臺北市 3D 近似建物模型（sheethub/tpe3d）；道路 © OpenStreetMap contributors（ODbL）。
