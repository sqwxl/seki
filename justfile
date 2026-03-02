set shell := ["fish", "-c"]

[parallel]
dev: db wasm-hot server-hot frontend-hot

db:
    docker compose up db -d

wasm-hot:
    cargo watch -w go-engine -w go-engine-wasm -s 'wasm-pack build go-engine-wasm --target web --out-dir ../seki-web/static/wasm'

frontend-hot:
    cd seki-web/frontend && pnpm run dev

server-hot:
    cargo watch -i .claude/worktrees -x 'run -p seki-web'

server:
    cargo run -p seki-web
