#!/usr/bin/env bash
# Apply the current migrations to a copy of the production database and fail
# loudly if any do not apply cleanly. Runs before the release build so a bad
# migration is caught cheaply instead of at install time on the Pi.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-sqwxl@pi5.local}"
REMOTE_DB_PATH="${REMOTE_DB_PATH:-}"
if [[ -z "$REMOTE_DB_PATH" ]]; then
    if [[ -n "${APP_DIR:-}" ]]; then
        REMOTE_DB_PATH="$APP_DIR/data/seki.db"
    else
        REMOTE_DB_PATH="~/seki/data/seki.db"
    fi
fi
LOCAL_COPY="$(mktemp /tmp/seki-migration-check.XXXXXX.db)"
REMOTE_COPY="/tmp/seki-migration-check.db"

cleanup() {
    rm -f "$LOCAL_COPY"
    ssh "$DEPLOY_HOST" "rm -f '$REMOTE_COPY'" 2>/dev/null || true
}
trap cleanup EXIT

echo "Building migration checker..."
cargo build --quiet -p seki-web

echo "Pulling a copy of the production DB from $DEPLOY_HOST..."
ssh "$DEPLOY_HOST" REMOTE_DB_PATH="$REMOTE_DB_PATH" REMOTE_COPY="$REMOTE_COPY" \
    'python3 - << "EOF"
import os, sqlite3
src = sqlite3.connect(os.path.expanduser(os.environ["REMOTE_DB_PATH"]))
dst = sqlite3.connect(os.environ["REMOTE_COPY"])
src.backup(dst)
dst.close()
src.close()
EOF'
scp -q "$DEPLOY_HOST:$REMOTE_COPY" "$LOCAL_COPY"

echo "Checking migrations against the production DB copy..."
"$ROOT_DIR/target/debug/seki-web" --check-migrations "$LOCAL_COPY"
