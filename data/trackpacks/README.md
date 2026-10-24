# 選用賽道包（track packs）

不在預設清單裡的賽道放在這裡。遊戲**只會載入 `game.js` 的 `TRACK_PACKS` 列出的檔案**；沒列出的賽道包不會被下載，選單裡也不會出現任何按鈕或名稱。

## 啟用

把檔案加進 `game.js` 的清單（一行）：

```js
const TRACK_PACKS = ['data/trackpacks/campus_a.json'];
```

臺北地圖的賽道會出現在「臺北預設環線」最後面，按鈕文字是賽道的 `name`。要改顯示名稱，改賽道包裡的 `name` 即可。

## 格式

```json
{
  "pack": "檔名代號",
  "tracks": [
    { "id": "唯一代號", "name": "按鈕文字", "map": "taipei", "elevated": false,
      "loop": [[X, Y], ...] }
  ]
}
```

- `loop`：依行駛順序的路口，**資料座標**（公尺，TWD97 TM2 減去 E 299000、N 2766400，和 `data/taipei.json` 相同），遊戲會吸附到最近的路口再用路網連成環線，和三條預設環線相同。
- `map`：目前只支援 `taipei`。
- `elevated`：路線需要高架道路時為 `true`。
- 其他欄位（`lengthM`、`direction`、`note`）只是說明，遊戲不讀。

## 測試（不必啟用）

```
python3 tools/test/physaudit.py --pack data/trackpacks/campus_a.json --track campus_a
node tools/test/node/world.js <instrument.py 的複本> '{"pack": "data/trackpacks/campus_a.json", "id": "campus_a"}'
```

## 目前的賽道包

| 檔案 | 賽道 | 狀態 |
|---|---|---|
| `campus_a.json` | 一條校園周邊的街道環線（1,862 m，逆時針） | 未啟用：需取得該校書面同意後才列入 `TRACK_PACKS` |
