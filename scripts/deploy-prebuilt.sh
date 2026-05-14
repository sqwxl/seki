#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${REMOTE_NAME:-pi}"
APP_DIR="${APP_DIR:-}"
SERVICE_NAME="${SERVICE_NAME:-seki}"
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-seki-deploy}"

resolve_deploy_host() {
    local remote_url
    remote_url="$(git -C "$ROOT_DIR" remote get-url "$REMOTE_NAME")"

    case "$remote_url" in
        ssh://*)
            printf '%s\n' "$remote_url" | sed -E 's#ssh://([^/]+)/.*#\1#'
            ;;
        *:*)
            printf '%s\n' "${remote_url%%:*}"
            ;;
        *)
            echo "Unsupported remote URL: $remote_url" >&2
            exit 1
            ;;
    esac
}

DEPLOY_HOST="${DEPLOY_HOST:-$(resolve_deploy_host)}"
ARCHIVE_PATH="$("$ROOT_DIR/scripts/package-release.sh")"
ARCHIVE_NAME="$(basename "$ARCHIVE_PATH")"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
REMOTE_ARCHIVE_PATH="$REMOTE_TMP_DIR/$ARCHIVE_NAME"
REMOTE_ENV_PREFIX="SERVICE_NAME='$SERVICE_NAME'"

if [[ -n "$APP_DIR" ]]; then
    REMOTE_ENV_PREFIX="APP_DIR='$APP_DIR' $REMOTE_ENV_PREFIX"
fi

echo "Uploading release to $DEPLOY_HOST"
ssh "$DEPLOY_HOST" "mkdir -p '$REMOTE_TMP_DIR'"
scp \
    "$ARCHIVE_PATH" \
    "$ROOT_DIR/scripts/setup-runtime-service.sh" \
    "$ROOT_DIR/scripts/install-release.sh" \
    "$DEPLOY_HOST:$REMOTE_TMP_DIR/"

echo "Installing release on $DEPLOY_HOST"
ssh "$DEPLOY_HOST" \
    "chmod +x '$REMOTE_TMP_DIR/setup-runtime-service.sh' '$REMOTE_TMP_DIR/install-release.sh' && \
     $REMOTE_ENV_PREFIX bash '$REMOTE_TMP_DIR/setup-runtime-service.sh' && \
     $REMOTE_ENV_PREFIX RELEASE_ID='$RELEASE_ID' bash '$REMOTE_TMP_DIR/install-release.sh' '$REMOTE_ARCHIVE_PATH'"

echo "Deployed release $RELEASE_ID to $DEPLOY_HOST"
