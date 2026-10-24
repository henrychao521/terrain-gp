# 回歸測試與量測工具

開發時用來確認「改了東西沒有弄壞」的檢查，以及量測賽車、電腦車與畫面效能的工具，全部從 `tools/test/run.py` 執行。

每次執行會做這幾件事：

1. 把 checkout 複製一份到 `tools/test/.out/www-<程序編號>/`，並修改**複本**的 `game.js`（`instrument.py`），把遊戲內部的物件掛到 `window.TGP`、加上各階段的計時器。repo 裡的 `game.js` 不會被改到。
2. 在本機空閒的 port 開一個靜態檔案伺服器（只聽 127.0.0.1）。
3. 用 Playwright 開本機的 Google Chrome（有視窗），跑指定的檢查。
4. 在 stdout 印出一個 JSON（進度訊息印在 stderr，所以可以直接 `> 結果.json`），結束後刪掉複本、關掉伺服器和瀏覽器。

## 需要的環境

- Python 3.8 以上，`pip install playwright`。不需要 `playwright install`：用的是電腦上已安裝的 Google Chrome（`channel="chrome"`）。
- 網路：three.js 從 cdnjs／jsDelivr 載入，Draco 解碼器從 gstatic 載入。
- 有螢幕的環境：Chrome 一定要開視窗（不是 headless），WebGL 才會用真的 GPU。`--headless` 可以試，但 WebGL 可能不能用或改成軟體算繪，結果不可信。
- 不必另外開 `python -m http.server`。Python 內建的伺服器一次只排 5 個連線，Chrome 同時抓幾十個街景區塊時會斷線；這裡用的是多執行緒、佇列 256 的版本（`harness.py` 的 `StaticServer`）。

## 用法

```
python3 tools/test/run.py quick                       # walls + line + ai（每條賽道 60 秒）+ envelope，約 35 秒
python3 tools/test/run.py walls  [--presets 0,1,2] [--tile-timeout 90]
python3 tools/test/run.py line   [--presets 0,1,2] [--shots 截圖目錄]
python3 tools/test/run.py ai     [--presets 0,1,2] [--seeds 1,2] [--secs 240] [--count 5] [--skill 0.45] [--max-player-contact 1]
python3 tools/test/run.py envelope [--setup '{"aero": 0.2}']
python3 tools/test/run.py bench  [--preset 0] [--quality high] [--ai 5] [--secs 30] [--shot 檔案.png] [--min-fps 50]
python3 tools/test/run.py novice [--preset 0] [--secs 60] [--quality low] [--max-spins N] [--max-hits N]
```

共用選項要放在檢查名稱**前面**：

| 選項 | 說明 |
|---|---|
| `--src 路徑` | 要測的 checkout（預設：這個 repo）。可以拿另一個分支的 worktree 來比較。 |
| `--out-root 目錄` | 複本放在哪個目錄底下（預設 `tools/test/.out`，已列入 `.gitignore`）。 |
| `--keep` | 跑完保留複本（例如想用瀏覽器打開看看）。 |
| `--url 網址` | 不自己建複本和伺服器，直接測別人已經做好、修改過的複本。 |
| `--headless` | 不開視窗（見上面的限制）。 |

結束代碼：

| 代碼 | 意思 |
|---|---|
| 0 | 每項門檻都通過 |
| 1 | 有門檻沒通過，原因列在 JSON 的 `failures` |
| 2 | 檢查沒辦法跑（錨點對不上、頁面沒載入、逾時等），原因在 `harnessError` |
| 130 | 被 Ctrl-C 或 SIGTERM 中斷 |

不論哪一項檢查，頁面出現 JavaScript 錯誤（`pageerror`）或 `console.error` 都算失敗。只有兩種訊息會略過：瀏覽器自己去抓的 `favicon.ico`，以及街景區塊沒有 `.inst.json` 時的 404（遊戲本來就把它當成「這塊沒有附加物件」）。

JSON 的 `src` 會記下測的是哪個 commit，以及 `game.js`、`index.html`、`data`、`models` 有沒有未提交的修改（`dirty`），方便比對前後結果。

## 各項檢查

| 檢查 | 量什麼 | 正常結果（2026-10 現況） | 失敗條件 | 時間 | 要獨佔這台電腦？ |
|---|---|---|---|---|---|
| `walls` | 臺北賽道上有沒有建物長在車道裡 | 三條預設環線都是 0 | 撞到建物的射線 > 0、街景區塊沒載入完、沒有建物可測 | 約 15 秒 | 不用 |
| `line` | 最佳行車線有沒有跑出路面、有沒有比中線快 | 跑出路面 0 個取樣點，三條都比中線快 7～10% | 跑出路面 > 0、行車線比中線慢 | 約 8 秒 | 不用 |
| `ai` | 電腦車互相比賽（超車、碰撞、跑出路面、被套圈、閃過停住的玩家車） | 沒有車落後一圈；碰撞每 240 秒多半 1～8 秒；碰到玩家車 0 秒 | 有車落後一圈以上、碰撞每 240 秒超過 12 秒、跑出路面每 240 秒超過 2 秒、碰到停住的玩家車每 240 秒超過 1 秒 | 每場 240 秒約 3 秒 | 不用 |
| `envelope` | 賽車在平坦柏油上的性能 | 極速約 309 km/h、100→200 km/h 約 2.3 秒 | 車子離開柏油、量不到極速 | 約 3 秒 | 不用 |
| `bench` | 畫面更新率、每一幀各階段花的時間 | 依機器而定，只能同一台前後比 | 只有 `--min-fps` 時才判斷 | 實際 30 秒＋載入 | **要** |
| `novice` | 新手機器人實際開 60 秒會不會打滑、撞牆 | 三條賽道 0 次打滑、0 次撞牆 | 只有給 `--max-spins`／`--max-hits` 時才判斷 | 實際 60 秒＋載入 | **要** |
| `phys` | 不開瀏覽器：Node 跑真正的 game.js，穿牆、車身進建物、瞬移、卡住、電腦車互相重疊／停住（`physaudit.py`） | 2026-10：電腦車重疊 0、頂牆 3 秒內脫困、建物 0；彎道口瞬移與高速撞牆 0.6～0.7 m 見 docs/賽道修正_2026-10.md | 建物、索引跳動、瞬移、自動油門卡住、電腦車重疊或停住 > 0、穿過護欄 > 0.8 m、頂牆沒脫困 | 每條賽道約 3 秒 | 不用 |

時間是在 M4 Max 上量的。臺北預設環線：0＝中正紀念堂環線（5.2 km）、1＝萬華艋舺環線（3.4 km）、2＝大安仁愛短程（1.9 km）。

### walls：建物不能長在車道裡

選好預設環線、重建世界，等這條賽道用到的 Blender 街景區塊全部載入後，從中線每隔一個取樣點（約 4 m）、離路面 1 m 高的地方，往左右各射一條射線，長度剛好到路緣（`W.hwL`／`W.hwR`）。射線碰到區塊裡的建物或地標網格，就表示有建物站在車道上（遊戲裡會變成一道看不見的牆或穿模）。

- 「沒有建物可測」也算失敗：區塊沒載入時射線什麼都打不到，會得到假的 0。
- 只檢查 Blender 區塊裡的建物；區塊範圍外由遊戲即時產生的建物不在這項檢查內。
- 另外會輸出路線摘要：全長、高架路段長度、150° 以上的髮夾彎、經過的道路與長度。
- 現況：三條都是 0；區塊 27／20／15 塊全部載入，建物網格 878／647／533 個。

### line：最佳行車線

行車線（`RACE.line`）是在建立世界時算的，這項檢查讀出：

- `out`：行車線離路緣不到 1.3 m（車寬一半加一點餘裕）的取樣點數，必須是 0。`outAt` 列出前幾個位置。
- `lapCentre`／`lapLine`：沿中線、沿行車線的速度規劃算出的單圈時間，行車線一定要比較快。
- `linePace`：電腦車用來換算速度的比例；`profileMs`：重算一次速度規劃花的毫秒數。
- `--shots 目錄`：另外開跑，把車放在最急的彎前 45 m，截一張路面導引線的圖。

現況（物理校準後）：

| 預設環線 | 中線單圈 | 行車線單圈 | 跑出路面 |
|---|---|---|---|
| 0 中正紀念堂環線 | 81.6 秒 | 75.7 秒 | 0 |
| 1 萬華艋舺環線 | 59.2 秒 | 55.0 秒 | 0 |
| 2 大安仁愛短程 | 39.3 秒 | 35.4 秒 | 0 |

### ai：電腦車模擬

從選單開一場「電腦對手」比賽，然後不經過畫面，直接用固定步長（1/60 秒）呼叫 `opponentsStep()`，比實際時間快很多。`Math.random` 換成有種子的版本，同一個種子每次結果都一樣。玩家的車停在發車格不動，所以每一圈電腦車也要閃過一台停住的車。

模擬裡沒有跑玩家車的物理（`physicsStep`），電腦車擦到它時，`bump()` 會把它推開、給它速度，但它不會自己動也不會停下來：電腦車會以為前面有一台時速幾十公里、其實停著的車，而被推走的車還會被電腦車一路頂著走（以前種子 2 的中正紀念堂環線就是這樣，一台電腦車頂著玩家車開了 1.6 km，落後 2.2 km）。所以每一步之後都把玩家車放回發車格、速度歸零，擦到的時間另外算成 `playerContactSec`。

預設：5 台電腦車、強度 0.45（選單預設值）、每場 240 秒、種子 1。輸出：

- `contactSec`：任兩台車前後距離 < 4.4 m、左右 < 1.8 m 的時間總和；`contactKind` 分成並排（side）／追撞（tail），以及兩台車當時在做什麼（P 超車、D 防守、E 犯錯）；`contactWhere` 是碰撞最多的路段。
- `offroadSec`：電腦車輪子出了柏油的時間總和。
- `playerContactSec`：電腦車碰到停在發車格的玩家車的時間總和。
- `overtakes`：每 0.1 秒檢查一次，名次有變動的次數。
- `spread`：第一名到最後一名差幾公尺；`lappedCars`：落後第一名一整圈以上的車數，必須是 0。
- `best`：每台車的最快圈；`skillSetting`／`skillMean`：這場實際用的強度設定，以及各車的速度係數平均（確認參數真的有套用）。

門檻用「每 240 秒」換算（`contactPer240s`、`offroadPer240s`、`playerContactPer240s`）：碰撞 12 秒、跑出路面 2 秒、碰到玩家車 1 秒，可以用 `--max-contact`、`--max-offroad`、`--max-player-contact` 調整。短於 120 秒的場次一律當作 120 秒換算，因為光是起跑就會有一點碰撞，不換算會被放大。

現況（240 秒、種子 1～12、三條預設環線共 36 場）：碰撞 0～11.9 秒、跑出路面最多 1.1 秒、超車 0～10 次、碰到玩家車 0 秒、最前到最後 53～429 m、沒有車被套圈；最快圈中正紀念堂約 85～88 秒、萬華艋舺約 61～63 秒、大安仁愛約 40～42 秒。同一個種子的結果會因為任何一點行為改變而整場不同，比較前後版本請看多個種子的總和，不要只看單一種子。

舊版腳本的問題已修正：以前在按「開始」前改 `setup.aiSkill`，但開始比賽時選單會用滑桿的值蓋掉，所以命令列給的強度其實沒有作用。現在會先設定選單的滑桿，模擬開始前再設定一次 `setup`，輸出也會列出實際用到的強度。

### envelope：賽車性能（平坦柏油）

純物理計算（每秒 240 步的 `physicsStep`），不看畫面：

- 從 60 km/h 全油門直線加速：極速 `top_kmh`、100→200 km/h 的時間 `t_100_200_s`、各速度區間的加速 G 值 `accel_g`。
- 從極速全力煞車到 70 km/h：各速度區間的減速 G 值 `brake_g`、煞車距離 `brake_dist_m`。
- 定速慢慢加大轉向，車子失去抓地（側滑角 > 0.35 rad）前的最大側向 G 值 `lat_g`（80、125、175、225、275 km/h）。

條件和 `tools/f1/README.md` 校準時相同：專業模式、循跡控制和防鎖死開啟、車身穩定關閉（`setupUsed` 會列出實際設定）。用 `--setup` 可以在這個基礎上再改，例如 `--setup '{"level": "easy", "esc": true}'` 就是新手模式。

賽道是 60 m 寬的平坦地形，而且每個取樣點的路寬都設成極大，車子不管跑到哪裡都在柏油上。舊的 `handling.js` 把車放在原點，那裡其實是草地，量到的是草地的數字；現在輸出的 `maxSurf`（跑過的最差路面：0 柏油、1 路緣石、2 草地、3 碎石）必須是 0，否則算失敗。

現況（2026-10-22 物理校準後，`6f09a6b`）：

| 項目 | 數值 |
|---|---|
| 極速 | 309.1 km/h |
| 100→200 km/h | 2.32 秒 |
| 加速 60～120／120～180／180～240／240～300 km/h | 1.41／1.41／1.28／0.70 G |
| 煞車 80～150／150～220／220～290 km/h | 2.67／4.75／6.98 G，煞車距離 90 m |
| 側向 80／125／175／225／275 km/h | 2.19／2.93／3.56／4.53／5.60 G |

這些數字只要調整物理就會變：改了 `SPEC`、`aeroOf`、輪胎摩擦係數的 PR，請一併更新這張表。新手模式（`{"level": "easy", "esc": true}`）比較慢：100→200 km/h 約 2.9 秒，側向 2.0 G@80、4.4 G@275 km/h。

### bench：畫面效能（要獨佔這台電腦）

開一場臺北「電腦對手」比賽（預設 1600×900、2 倍像素密度、高畫質、5 台電腦車、自動油門），開跑後量 30 秒：

- `fps`、`p50_ms`／`p95_ms`／`p99_ms`：每一幀間隔的中位數與百分位數。
- `phys_ms`、`opp_ms`、`rend_ms`、`hud_ms`、`cpu_ms`：每一幀花在物理、電腦車、送出算繪指令（CPU 端）、HUD，以及整幀 CPU 的平均毫秒數。
- `calls`、`tris`：每一幀的 draw call 數與三角形數；`build_ms`：按「開始」到世界建好的時間。

這是實際時間的量測，同一台電腦上有其他工作（其他 Chrome、Blender、編譯、另一個測試）時數字就不能比。執行時會印出系統負載，負載超過 CPU 核心數的四分之一時，JSON 的 `warnings` 會註明「數字不能比較」。沒有固定的標準值：要比較就在同一台電腦、同樣設定下跑改動前後各一次。

### novice：新手機器人（要獨佔這台電腦）

用鍵盤操作的「新手」實際開 60 秒：開自動油門，每 1/60 秒看中線前方 18 m（或 0.7 秒）的點，只按左、右或不按，反應延遲約 0.12 秒。計算打滑次數（側滑角 > 0.5 rad 且車速 > 18 km/h）和撞牆次數（撞擊力道 > 2，0.8 秒內只算一次），並記下每次打滑當下的狀態，以及第一次打滑前約 0.2 秒的逐格紀錄。

PR #19 的結果是三條賽道都 0 次打滑、0 次撞牆。這也是實際時間的測試（機器人的反應時間以真實時間計），一樣要單獨執行。

## 中斷

Ctrl-C 或 SIGTERM 會停止檢查，並關掉瀏覽器和伺服器、刪掉複本，結束代碼 130。`bench`、`novice` 量測中可以立刻停；正在等 Playwright 的步驟（例如等臺北資料載入）時，要等那一步做完才會停。

## 檔案

| 檔案 | 用途 |
|---|---|
| `run.py` | 主程式：命令列、門檻判斷、JSON 輸出 |
| `harness.py` | 共用：靜態伺服器、開 Chrome、操作選單（選臺北預設環線、設定滑桿、開始比賽）、收集頁面錯誤 |
| `instrument.py` | 複製 checkout 並修改複本的 `game.js`；也可以單獨用：`python3 tools/test/instrument.py <checkout> tools/test/.out/www` |
| `js/walls.js` | 建物射線檢查與路線摘要 |
| `js/line.js`、`js/line_shot.js` | 行車線統計；截圖前把車放到最急的彎前 |
| `js/ai_sim.js` | 電腦車快轉模擬 |
| `js/envelope.js` | 賽車性能 |
| `js/bench.js` | 畫面效能（開始／結束兩個階段） |
| `js/novice.js` | 新手機器人（開始／結束兩個階段） |

每個 `js/*.js` 都是一個函式，由 Playwright 的 `page.evaluate` 在遊戲頁面裡執行，透過 `window.TGP` 存取遊戲。

## instrument.py：錨點與安全規則

`game.js` 是一整個 IIFE，外面拿不到任何東西，所以要在複本裡加幾行。每一處修改都對準 `game.js` 裡一段原樣的程式碼（錨點），**每個錨點必須剛好出現一次**；`game.js` 改動後如果對不上，會停下來並說明是哪個錨點，請把 `instrument.py` 裡的錨點改成新的程式碼，修改的內容保持不變。`window.TGP` 裡的名稱是逐一讀取的，`game.js` 裡改名或刪掉的變數會列在 `TGP.missing`；檢查用得到的名稱不見了會直接停止，用不到的只會出現在 `warnings`。

複本的目錄在每次執行前後都會被刪除，所以有這些限制（全部用解析過符號連結的實際路徑比較，`/tmp` 和 `/private/tmp` 視為同一個地方）：

- 複本一定要在輸出根目錄（預設 `tools/test/.out`，可用 `--out-root` 指定）**底下的子目錄**，不能是輸出根目錄本身。
- 輸出根目錄和複本都不能是、也不能包含：checkout、家目錄、`/`、`/tmp`、`/private/tmp`、系統暫存目錄。
- 輸出根目錄如果在 checkout 裡，只能是 `tools/test/.out`。
- 只會刪除 `instrument.py` 自己建立的目錄：建立複本時會寫入標記檔 `.tgp-instrumented-copy`，沒有這個檔案的目錄一律拒絕刪除，請自己確認後手動處理。

## 不開瀏覽器的版本（建中周邊走廊時加的）

不能開 Chrome 的環境可以用這兩支，結果和瀏覽器版一致（建中環線 19／924、三條預設環線的 walls 與 `line.js` 數字都對得上）：

```
python3 tools/test/instrument.py . tools/test/.out/node-a
node tools/test/node/world.js tools/test/.out/node-a '{"preset": 0}' > track0.json           # 或 {"loop": [[X, Y], ...]}；加 "check": "line.js" 一起跑行車線
blender -b --factory-startup --python tools/test/blender_walls.py -- . walls.json track0.json   # 可放多個 track.json
```

- `node/world.js` 在 Node 裡跑複本的 `game.js`（假 DOM、假 WebGL，three.js r128 快取在 `.cache/`），輸出中線、車道半寬、路面高度、用到的區塊。
- `blender_walls.py` 規則同 `js/walls.js`，另外輸出 4／8 m 高的懸空（`overhang`）與騎樓柱（`columns`）。`TGP_TILE_DIR` 可以指定另一組區塊。
- `ai`、`envelope` 沒有替代版本（假 DOM 的設定值和瀏覽器不同，envelope 數字對不上）。
- `world.js` 也能建自訂地形（丘陵練習場）：`'{"terrain": {"preset": "hills", "seed": 7, "track": 20251019}}'`（`track` 是 `randomTrack` 的種子；遊戲的「標準丘陵 A」是 20261024）。
- `js/height_mesh.js`（`"check": "height_mesh.js"`）：車道內每 0.5 m 比對物理高度 `Sq` 與實際畫出的三角形（地面網格、賽道柏油、臺北街道，讀各網格自己的索引），輸出最大值、p99、平均與最差位置。2026-10-24 的結果見 `docs/高度取樣與地圖模式檢查.md`。
- `node/geo_test.js`：地圖模式的幾何測試（OSM 經緯度換公尺對照 WGS84 大地線、z_x_y 圖磚的角點與實際大小、Terrarium 跨進位的斜坡解碼），`node tools/test/node/geo_test.js`，失敗時結束代碼 1。

## 不開瀏覽器的物理稽核（2026-10 加）

```
python3 tools/test/run.py phys [--presets 0,1,2] [--set full|quick]
python3 tools/test/physaudit.py --loop '[[X,Y],...]'            # 另外加一條環線（資料座標）
python3 tools/test/physaudit.py --pack data/trackpacks/campus_a.json --track campus_a
python3 tools/test/physaudit.py --setup '{"wideCorners": true}'   # 遊戲設定，例如初階較寬的轉彎區域
python3 tools/test/run.py quick --no-browser                     # phys（quick）＋ node/opponents_test.js、recover_test.js
node tools/test/node/opponents_test.js [game.js]                 # P1 電腦車間距（協作 AI 的四個情境，測 game.js 裡的程式）
node tools/test/node/recover_test.js [game.js]                   # P2 自動油門脫困
```

- 原本是 iOS 移植 CampusRacer 的 `tools/physaudit/`。`js/physaudit.js` 在 `node/world.js` 建好的世界裡照遊戲的 `frame()` 步驟開車（輸入 → 換檔 → 1/240 秒物理 → 計圈 → 電腦車），不畫畫面。
- 亂數固定（每個情境開頭用種子重設 `Math.random`，預設 1），同一個版本每次數字相同；「電腦車9台故意撞 種子8」排第一個，重現中正紀念堂起跑格頂牆卡住。
- `--set quick` 是 `run.py quick --no-browser` 用的短版。
