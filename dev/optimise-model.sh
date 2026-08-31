#!/usr/bin/env bash
# Prepare a downloaded CC-BY glTF for shipping.
#
#   dev/optimise-model.sh <in.glb> <out.glb> [textureSize] [simplifyRatio]
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
IN=$1; OUT=$2; TEX=${3:-512}; RATIO=${4:-}
GT="npx --yes @gltf-transform/cli@4.4.2"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

$GT dedup  "$IN"        "$TMP/a.glb"  > /dev/null
$GT prune  "$TMP/a.glb" "$TMP/b.glb"  > /dev/null
if [ -n "$RATIO" ]; then
  $GT simplify "$TMP/b.glb" "$TMP/b2.glb" --ratio "$RATIO" --error 0.0012 > /dev/null
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
