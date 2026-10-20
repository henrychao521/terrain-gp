# Terrain GP

F1 風格的瀏覽器賽車，可用高度圖、臺北實測地形或 OpenStreetMap 地圖當賽道。

線上試玩：https://henrychao521.github.io/terrain-gp/

- `index.html`、`game.js`：遊戲本體（three.js r128，從 cdnjs／jsDelivr 載入）。
- `data/taipei.json`：臺北街道賽資料，由 `tools/prep_taipei.py` 從 [xindian-flood-sim](https://github.com/henrychao521/xindian-flood-sim) 的 `data/processed`（20 m DEM、3D 建物、OSM 道路）打包而成。
  重新產生：`python3 tools/prep_taipei.py <xindian-flood-sim 路徑>/data/processed`（在本 repo 根目錄執行）。

- `data/taipei_osm.json`：臺北街道賽的實際道路細節（車道數、路寬、單行道、行道樹、公園、號誌與路名、斑馬線、地標 3D 造型），由 `tools/prep_taipei_osm.py` 從 OpenStreetMap 原始圖資（api.openstreetmap.org 0.01° 分塊下載）產生：`python3 tools/prep_taipei_osm.py <分塊目錄>`。

線上對戰使用 claude.ai Artifact 的即時房間功能，只在 claude.ai 上開啟時可用；GitHub Pages 版本支援單人計時與電腦對手。

資料來源：內政部國土測繪中心 2025 年 20 m DEM（政府資料開放授權條款第 1 版）；臺北市 3D 近似建物模型（sheethub/tpe3d）；道路 © OpenStreetMap contributors（ODbL）。
