# 行道樹模型

遊戲近處用的 5 種行道樹（每棵約 3,500 面＋512 px 貼圖）。遠處用同一批模型的側拍貼圖集（`models/props/trees_atlas.webp`）。

| 檔案 | 用在 | 來源 |
|---|---|---|
| tree_camphor | 樟樹等闊葉樹 | SDXL 照片 → TRELLIS.2 |
| tree_banyan | 榕樹 | SDXL 照片 → TRELLIS.2（寫法見下方「榕樹」） |
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

TRELLIS.2 的 o-voxel 和 CuMesh 裡的 cubvh 都會從 GitLab 抓 Eigen，GitLab 忙線時會整個安裝失敗，所以 `trees_job.py` 改從 GitHub 的 Eigen 鏡像抓同一個版本（git 依 commit 編號取出，內容完全一樣）。

### 榕樹

- 提示詞裡寫「banyan」「Chinese」「gnarled」，或要求白底棚拍時，SDXL 一直畫成盆景、滿地盤根，或只拍到樹幹。
- 改成只描述外形：一棵粗壯淺灰樹幹、又寬又密的深綠圓頂樹冠、幾條細細的氣根，並寫成「單獨長在草地上、從遠處拍到整棵樹、陰天」的風景照，再用 BiRefNet 把樹從天空和草地中去背。這樣生成的 20 張都沒有再出現盆景；挑出樹冠完整、樹幹清楚的 2 張各轉 2 次 3D，最後用的是 SDXL seed 44、TRELLIS seed 7 那一個。
- 這張照片是在霧濛濛的陰天拍的，顏色偏灰，所以 `build_trees.py` 在材質裡分高度調色：樹冠調成深綠，樹幹維持淺灰（烘焙貼圖與遠景貼圖集都會套用）。
- 照片裡是公園中自由生長的大樹，樹冠寬度是樹高的 1.57 倍；行道樹會修剪，所以水平方向縮成 0.85 倍（約為樹高的 1.34 倍）。樹冠又寬又密，減面時需要較粗的體素（樹高的 1.2%），才能減到預定面數。

## 授權

- 模型與貼圖皆為「AI 生成（SDXL＋TRELLIS.2）」。
- SDXL 1.0：CreativeML Open RAIL++-M。
- TRELLIS.2：MIT。
- BiRefNet：MIT。
- DINOv3：TRELLIS.2 用的影像特徵模型，DINOv3 License。
- 沒有使用 TRELLIS.2 預設的去背模型 RMBG-2.0，因為它只限非商業用途。
