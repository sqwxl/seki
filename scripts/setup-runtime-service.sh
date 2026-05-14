#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/seki}"
SERVICE_NAME="${SERVICE_NAME:-seki}"
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_DIR/$SERVICE_NAME.service"
ENV_DIR="$HOME/.config/$SERVICE_NAME"
ENV_FILE="$ENV_DIR/$SERVICE_NAME.env"
DATA_DIR="$APP_DIR/data"

mkdir -p "$SYSTEMD_DIR" "$ENV_DIR" "$APP_DIR/releases" "$DATA_DIR"

cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=Seki web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/current
Environment=STATIC_DIR=$APP_DIR/current/static
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/current/bin/seki-web
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

if [[ ! -f "$ENV_FILE" ]]; then
    cat >"$ENV_FILE" <<EOF
DATABASE_URL=sqlite://$DATA_DIR/seki.db
PORT=3000
BASE_URL=http://localhost:3000
# ENVIRONMENT=production
EOF
fi

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME.service"

echo "Installed $SERVICE_FILE"
echo "Edit $ENV_FILE if needed."
