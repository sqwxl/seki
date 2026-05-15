#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/seki-web/frontend"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-$ROOT_DIR/dist/deploy}"
BUILD_TARGET="aarch64-unknown-linux-gnu"
TOOLBOX_CONTAINER="seki-build"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
TARGET_SUFFIX="-$BUILD_TARGET"
TOOLBOX_TERM="${TOOLBOX_TERM:-xterm-256color}"

toolbox_cmd() {
    env TERM="$TOOLBOX_TERM" toolbox "$@"
}

toolbox_run() {
    toolbox_cmd run --container "$TOOLBOX_CONTAINER" "$@"
}

toolbox_build_release_binary() {
    if ! toolbox_run true >/dev/null 2>&1; then
        echo "Creating toolbox container $TOOLBOX_CONTAINER (ubuntu 24.04)" >&2
        toolbox_cmd create --distro ubuntu --release 24.04 "$TOOLBOX_CONTAINER" >&2
    fi

    if ! toolbox_run bash -c \
        'dpkg -s crossbuild-essential-arm64 pkg-config >/dev/null 2>&1'; then
        echo "Installing cross-build packages in toolbox $TOOLBOX_CONTAINER" >&2
        toolbox_run bash -c \
            'sudo apt-get update && sudo apt-get install -y crossbuild-essential-arm64 pkg-config' >&2
    fi

    echo "Ensuring Rust target $BUILD_TARGET exists in toolbox $TOOLBOX_CONTAINER" >&2
    toolbox_run rustup target add "$BUILD_TARGET" >&2

    echo "Building release server binary in toolbox $TOOLBOX_CONTAINER" >&2
    toolbox_run env \
        CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="${CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER:-aarch64-linux-gnu-gcc}" \
        bash -c "cd '$ROOT_DIR' && cargo build --release -p seki-web --target '$BUILD_TARGET'"
}

cd "$ROOT_DIR"

if ! command -v toolbox >/dev/null 2>&1; then
    echo "toolbox is required for Pi deploy builds, but it is not installed or not on PATH" >&2
    exit 1
fi

ARCHIVE_BASENAME="seki-$GIT_SHA$TARGET_SUFFIX"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "Installing frontend dependencies" >&2
pnpm --dir "$FRONTEND_DIR" install --frozen-lockfile

echo "Building WASM bundle" >&2
rm -rf "$ROOT_DIR/seki-web/static/wasm"
wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

echo "Building frontend bundle" >&2
rm -rf "$ROOT_DIR/seki-web/static/dist"
pnpm --dir "$FRONTEND_DIR" run build

echo "Generating OpenAPI spec" >&2
cargo run -p seki-web --bin gen-openapi > "$ROOT_DIR/seki-web/static/openapi.json"

toolbox_build_release_binary
BIN_PATH="$ROOT_DIR/target/$BUILD_TARGET/release/seki-web"

mkdir -p "$ARTIFACTS_DIR" "$STAGE_DIR/bin"
cp "$BIN_PATH" "$STAGE_DIR/bin/seki-web"
cp -R "$ROOT_DIR/seki-web/static" "$STAGE_DIR/static"

tar -C "$STAGE_DIR" -czf "$ARTIFACTS_DIR/$ARCHIVE_BASENAME.tar.gz" .

echo "$ARTIFACTS_DIR/$ARCHIVE_BASENAME.tar.gz"
