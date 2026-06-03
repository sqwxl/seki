#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KATAGO_DIR="${KATAGO_DIR:-"$ROOT/vendor/KataGo"}"
BUILD_DIR="${BUILD_DIR:-/tmp/katago-onnx-build}"
OUT="${1:-/tmp/katago-export-onnx}"
BREW_PREFIX="${BREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
PROTOC="${PROTOC:-"$BREW_PREFIX/bin/protoc"}"
CXX="${CXX:-g++}"
PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-"$BREW_PREFIX/lib/pkgconfig"}"

if [[ ! -d "$KATAGO_DIR/cpp" ]]; then
  echo "Missing KataGo source at $KATAGO_DIR" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

"$PROTOC" \
  --cpp_out="$BUILD_DIR" \
  --proto_path="$KATAGO_DIR/cpp/external/onnx" \
  "$KATAGO_DIR/cpp/external/onnx/onnx.proto"

"$CXX" -std=c++17 -O2 -ffunction-sections -fdata-sections \
  -I"$KATAGO_DIR/cpp" \
  -I"$KATAGO_DIR/cpp/external/filesystem-1.5.8/include" \
  -I"$BUILD_DIR" \
  "$ROOT/tools/katago-export-onnx.cpp" \
  "$KATAGO_DIR/cpp/neuralnet/onnxmodelbuilder.cpp" \
  "$KATAGO_DIR/cpp/neuralnet/desc.cpp" \
  "$KATAGO_DIR/cpp/neuralnet/modelversion.cpp" \
  "$KATAGO_DIR/cpp/game/rules.cpp" \
  "$KATAGO_DIR/cpp/core/global.cpp" \
  "$KATAGO_DIR/cpp/core/fileutils.cpp" \
  "$KATAGO_DIR/cpp/core/sha2.cpp" \
  "$KATAGO_DIR/cpp/core/md5.cpp" \
  "$KATAGO_DIR/cpp/core/datetime.cpp" \
  "$BUILD_DIR/onnx.pb.cc" \
  $(PKG_CONFIG_PATH="$PKG_CONFIG_PATH" pkg-config --libs --cflags protobuf) \
  -lz -pthread -Wl,--gc-sections \
  -o "$OUT"

echo "Built $OUT"
