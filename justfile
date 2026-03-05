set shell := ["fish", "-c"]

[parallel]
dev: db wasm-hot server-hot frontend-hot

db:
    docker compose up db -d

wasm-hot:
    watchexec -w go-engine -w go-engine-wasm -- wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

frontend-hot:
    cd seki-web/frontend && pnpm run dev

server-hot:
    watchexec -i .claude/worktrees -- cargo run -p seki-web

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
