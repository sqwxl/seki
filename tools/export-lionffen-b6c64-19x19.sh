#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BREW_PREFIX="${BREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
EXPORTER="${EXPORTER:-/tmp/katago-export-onnx}"
MODEL_URL="https://media.katagotraining.org/uploaded/networks/models_extra/lionffen_b6c64_3x3_v10.txt.gz"
MODEL_PATH="${MODEL_PATH:-/tmp/lionffen_b6c64_3x3_v10.txt.gz}"
OUT="$ROOT/seki-web/static/models/lionffen-b6c64-19x19/lionffen-b6c64-19x19.onnx"

if [[ ! -x "$EXPORTER" ]]; then
  "$ROOT/tools/build-katago-export-onnx.sh" "$EXPORTER"
fi

if [[ ! -f "$MODEL_PATH" ]]; then
  curl -L -o "$MODEL_PATH" "$MODEL_URL"
fi

mkdir -p "$(dirname "$OUT")"

LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-"$BREW_PREFIX/lib"}" \
  "$EXPORTER" "$MODEL_PATH" "$OUT" 19 true false
