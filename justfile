set shell := ["fish", "-c"]

[parallel]
dev: db web frontend

db:
    docker compose up db -d

web:
    cargo watch -x 'run -p seki-web'

frontend:
    cd seki-web/frontend && pnpm run dev
