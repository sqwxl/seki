set shell := ["fish", "-c"]

[parallel]
run-hot: build services wasm-hot serve-hot frontend-hot

run: build services serve

services:
    docker compose up -d db mailpit

wasm-hot:
    watchexec -w go-engine -w go-engine-wasm -- wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

frontend-hot:
    cd seki-web/frontend && pnpm run dev

serve-hot:
    watchexec -r -i .claude -i target -i node_modules -i seki-web/static/wasm -- cargo run -p seki-web

serve:
    cargo run -p seki-web

build: deps build-rs build-wasm build-js

deps:
    cargo binstall wasm-pack && cargo binstall watchexec-cli && cd seki-web/frontend && pnpm install 

build-rs:
    cargo build -p seki-web

build-wasm:
    wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

build-js:
    cd seki-web/frontend && pnpm run build
