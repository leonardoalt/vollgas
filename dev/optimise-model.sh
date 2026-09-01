#!/usr/bin/env bash
# Prepare a downloaded CC-BY glTF for shipping.
#
#   dev/optimise-model.sh <in.glb> <out.glb> [textureSize] [simplifyRatio] [error]
#
# `error` is meshoptimizer's bound, relative to the mesh's own size, and it is
# what actually binds: the lorry came out identical at --ratio 0.45 and 0.30
# because the default 0.0012 stopped both long before the ratio did. Its wheels
# are 1.4 m across, so 0.0012 is under two millimetres on them and the rims
# barely decimate. 0.005 takes it from 36.3 k to 17.9 k triangles with nothing
# visible lost at any distance you meet a lorry from.
#
# Deliberately NOT `gltf-transform optimize`. That macro runs `palette`, which
# merges materials and renames them to PaletteMaterial001, 002, ... — and every
# fitting decision in src/carModels.js keys off material names: which mesh is
# paint to tint, which is glass, which is a badge to drop. It also runs
# `flatten`, which discards the node names the wheel matcher uses. The passes
# below are the ones that shrink a file without destroying what identifies it.
#
# Typical result on Daniel Zhabotinsky's models: 1.3-9 MB -> 200-600 KB, with
# triangle counts untouched.
set -euo pipefail
IN=$1; OUT=$2; TEX=${3:-512}; RATIO=${4:-}; ERR=${5:-0.0012}
GT="npx --yes @gltf-transform/cli@4.4.2"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

$GT dedup  "$IN"        "$TMP/a.glb"  > /dev/null
$GT prune  "$TMP/a.glb" "$TMP/b.glb"  > /dev/null
if [ -n "$RATIO" ]; then
  $GT simplify "$TMP/b.glb" "$TMP/b2.glb" --ratio "$RATIO" --error "$ERR" > /dev/null
  mv "$TMP/b2.glb" "$TMP/b.glb"
fi
# resize inflates the file (it decodes to PNG); webp puts it back, much smaller
$GT resize "$TMP/b.glb" "$TMP/c.glb" --width "$TEX" --height "$TEX" > /dev/null
$GT webp   "$TMP/c.glb" "$TMP/d.glb" > /dev/null
# meshopt rather than Draco on purpose: MeshoptDecoder is an ES module that
# bundles, so there is no extra decoder file to fetch at runtime.
$GT meshopt "$TMP/d.glb" "$OUT" > /dev/null

printf '%-46s %8s KB -> %7s KB\n' "$(basename "$OUT")" \
  "$(( $(stat -c%s "$IN") / 1024 ))" "$(( $(stat -c%s "$OUT") / 1024 ))"
