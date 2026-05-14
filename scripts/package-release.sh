#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/seki-web/frontend"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-$ROOT_DIR/dist/deploy}"
BUILD_TARGET="${TARGET:-}"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
TARGET_SUFFIX=""

cd "$ROOT_DIR"

if [[ -n "$BUILD_TARGET" ]]; then
    TARGET_SUFFIX="-$BUILD_TARGET"
fi

ARCHIVE_BASENAME="seki-$GIT_SHA$TARGET_SUFFIX"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "Installing frontend dependencies"
pnpm --dir "$FRONTEND_DIR" install --frozen-lockfile

echo "Building WASM bundle"
rm -rf "$ROOT_DIR/seki-web/static/wasm"
wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

echo "Building frontend bundle"
rm -rf "$ROOT_DIR/seki-web/static/dist"
pnpm --dir "$FRONTEND_DIR" run build

echo "Building release server binary"
if [[ -n "$BUILD_TARGET" ]]; then
    cargo build --release -p seki-web --target "$BUILD_TARGET"
    BIN_PATH="$ROOT_DIR/target/$BUILD_TARGET/release/seki-web"
else
    cargo build --release -p seki-web
    BIN_PATH="$ROOT_DIR/target/release/seki-web"
fi

mkdir -p "$ARTIFACTS_DIR" "$STAGE_DIR/bin"
cp "$BIN_PATH" "$STAGE_DIR/bin/seki-web"
cp -R "$ROOT_DIR/seki-web/static" "$STAGE_DIR/static"

tar -C "$STAGE_DIR" -czf "$ARTIFACTS_DIR/$ARCHIVE_BASENAME.tar.gz" .

echo "$ARTIFACTS_DIR/$ARCHIVE_BASENAME.tar.gz"
