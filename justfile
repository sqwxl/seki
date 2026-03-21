set shell := ["fish", "-c"]

run-hot: hot-setup hot

run: build services serve

services:
    docker compose up -d db mailpit

wasm-hot:
    watchexec -w go-engine -w go-engine-wasm -- wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

frontend-hot:
    pnpm --dir seki-web/frontend run dev

serve-hot:
    watchexec -r -i .claude -i target -i node_modules -i seki-web/static/wasm -- cargo run -p seki-web

serve:
    cargo run -p seki-web

build: deps build-rs build-wasm build-js

deps:
    cargo binstall wasm-pack && cargo binstall watchexec-cli && pnpm --dir seki-web/frontend install

build-rs:
    cargo build -p seki-web

build-wasm:
    wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

build-js:
    pnpm --dir seki-web/frontend run build

hot-setup: deps services

[parallel]
hot: wasm-hot serve-hot frontend-hot

openapi:
    cargo run -p seki-web --bin gen-openapi > seki-web/frontend/openapi.json

generate-api-client: openapi
    pnpm --dir seki-web/frontend run generate-api-client
