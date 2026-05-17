set shell := ["bash", "-cu"]

run-hot: hot-setup hot

run: build services serve

deploy:
    bash scripts/deploy-prebuilt.sh

services:
    docker compose up -d mailpit

wasm-hot:
    watchexec -w go-engine -w go-engine-wasm -- wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

frontend-hot:
    pnpm --dir seki-web/frontend run dev

serve-hot:
    watchexec -r -- env DATABASE_URL=sqlite://seki.db cargo run -p seki-web --bin seki-web

serve:
    env DATABASE_URL=sqlite://seki.db cargo run -p seki-web --bin seki-web

build: deps build-rs build-wasm build-js

deps:
    cargo binstall wasm-pack && cargo binstall watchexec-cli
    pnpm install
    pnpm exec lefthook install

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
    cargo run -p seki-web --bin gen-openapi
