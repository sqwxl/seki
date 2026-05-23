set shell := ["bash", "-cu"]

deps:
    cargo binstall wasm-pack && cargo binstall watchexec-cli
    pnpm install
    pnpm exec lefthook install

wasm-hot:
    watchexec -w go-engine -w go-engine-wasm -- wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm

frontend-hot:
    pnpm --dir seki-web/frontend run dev

serve-hot:
    watchexec -r -w seki-web -- env DATABASE_URL=sqlite://seki.db cargo run -p seki-web --bin seki-web

services:
    docker compose up -d mailpit

[parallel]
run-hot: wasm-hot serve-hot frontend-hot

katago:
    watchexec -r -w seki-gtp -- cargo run -p seki-gtp -- --config gtp.toml

deploy:
    bash scripts/deploy-prebuilt.sh
