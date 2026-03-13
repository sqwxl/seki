set shell := ["fish", "-c"]

[parallel]
run: services wasm-hot server-hot frontend-hot

services:
    docker compose up -d db mailpit

wasm-hot:
    watchexec -w go-engine -w go-engine-wasm -- wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

frontend-hot:
    cd seki-web/frontend && pnpm run dev

server-hot:
    watchexec -r -i .claude -i target -i node_modules -i seki-web/static/wasm -- cargo run -p seki-web

server:
    cargo run -p seki-web

setup: deps
    cargo build -p seki-web && cd seki-web/frontend && pnpm install && pnpm run build

deps:
    cargo binstall wasm-pack && cargo binstall watchexec-cli

build-rs:
    cargo build -p seki-web

build-frontend:
    cd seki-web/frontend && pnpm install && pnpm run build

build-wasm:
    wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm
