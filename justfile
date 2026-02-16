set shell := ["fish", "-c"]

[parallel]
dev: db wasm server frontend

db:
    docker compose up db -d

wasm:
    cargo watch -w go-engine -w go-engine-wasm -s 'wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm'

frontend:
    cd seki-web/frontend && pnpm run dev

server:
    cargo watch -x 'run -p seki-web'
