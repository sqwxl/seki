#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:?usage: install-release.sh /path/to/archive.tar.gz}"
APP_DIR="${APP_DIR:-$HOME/seki}"
SERVICE_NAME="${SERVICE_NAME:-seki}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"
CURRENT_LINK="$APP_DIR/current"

mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

if systemctl --user is-active --quiet "$SERVICE_NAME.service"; then
    systemctl --user restart "$SERVICE_NAME.service"
else
    systemctl --user start "$SERVICE_NAME.service"
fi

echo "Installed release to $RELEASE_DIR"
