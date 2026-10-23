#!/bin/bash
# Rebuild the four Blender tiles of the 建中 corridor from data/corridors/jianzhong.json and check them.
#   tools/jianzhong/rebuild.sh <texture dir> <work dir>
# Run from the repo root. Steps: derive_params (if the VLM answers exist) -> build_tile.py for t_3_3 t_3_4 t_4_3 t_4_4
# (models/taipei/tiles.json is not touched: the tile bounds stay the same) -> dumps -> walls on the loop and the presets.
set -euo pipefail
TEX=$1; WORK=$2; PY=${PY:-python3}; BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
HEAVY=${HEAVY:-}  # e.g. /Volumes/Work/ios-apps/tools/heavy.sh on the shared MacBook
mkdir -p "$WORK/dump"
for ij in 3_3 3_4 4_3 4_4; do
  i=${ij%_*}; j=${ij#*_}; x0=$((i*700)); y0=$((j*700))
  TGP_DUMP="$WORK/dump/after_t_$ij.json" $HEAVY "$BLENDER" -b --factory-startup --python tools/blender/build_tile.py -- data "$TEX" $x0 $((x0+700)) $y0 $((y0+700)) models/taipei/t_$ij.gltf 2>&1 | grep -E "^(buildings|wrote|bridge)|Error|Traceback" || true
done
$HEAVY "$BLENDER" -b --factory-startup --python tools/test/blender_walls.py -- . "$WORK/walls_after_loop.json" eval/track_loop.json 2>&1 | grep blender_walls
for p in 0 1 2; do [ -f "$WORK/track_preset$p.json" ] || echo "missing $WORK/track_preset$p.json (node tools/test/node/world.js)"; done
$HEAVY "$BLENDER" -b --factory-startup --python tools/test/blender_walls.py -- . "$WORK/walls_after_presets.json" "$WORK/track_preset0.json" "$WORK/track_preset1.json" "$WORK/track_preset2.json" 2>&1 | grep blender_walls
