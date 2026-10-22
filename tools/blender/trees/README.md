# 行道樹模型

遊戲近處用的 5 種行道樹（每棵約 3,500 面＋512 px 貼圖）。遠處用同一批模型的側拍貼圖集（`models/props/trees_atlas.webp`）。

| 檔案 | 用在 | 來源 |
|---|---|---|
| tree_camphor | 樟樹等闊葉樹 | SDXL 照片 → TRELLIS.2 |
| tree_banyan | 榕樹 | 由樟樹模型放寬 1.4 倍、葉色調深（SDXL 一直把榕樹畫成盆景或被切掉的樹幹） |
| tree_luan | 臺灣欒樹 | SDXL 照片 → TRELLIS.2 |
| tree_palm | 大王椰子等棕櫚 | SDXL 照片 → TRELLIS.2 |
| tree_tall | 小葉欖仁等高瘦樹 | SDXL 照片 → TRELLIS.2 |

## 怎麼產生

1. `tools/colab/trees_job.py`（Colab A100，透過 `colab-job` 執行）：
   - 用 SDXL 1.0 生成單棵樹的照片，再用 BiRefNet 去背。
   - 用 TRELLIS.2 轉成 3D 模型。
   - `patch_sdpa.py` 讓 TRELLIS.2 改用 PyTorch 內建的注意力運算，不必依賴 flash-attn／xformers。
2. `tools/blender/build_trees.py`：
   - TRELLIS 的葉子是很多單面薄片，直接減面會把葉子吃光。所以先加厚、做體素重建成一個封閉外殼，再減面，最後把原模型的顏色烘到新貼圖上。
   - 另外用原始高面數模型側拍，輸出遠處用的貼圖集。
3. `tools/blender/build_props.py`：把這 5 個模型放進 `models/props/props.gltf`。

## 授權

- 模型與貼圖皆為「AI 生成（SDXL＋TRELLIS.2）」。
- SDXL 1.0：CreativeML Open RAIL++-M。
- TRELLIS.2：MIT。
- BiRefNet：MIT。
- DINOv3：TRELLIS.2 用的影像特徵模型，DINOv3 License。
- 沒有使用 TRELLIS.2 預設的去背模型 RMBG-2.0，因為它只限非商業用途。
