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
EnvironmentFile=-$APP_DIR/current/release.env
ExecStart=$APP_DIR/current/bin/seki-web
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

if [[ ! -f "$ENV_FILE" ]]; then
    VAPID_PRIVATE_PEM="$(mktemp)"
    openssl ecparam -name prime256v1 -genkey -noout -out "$VAPID_PRIVATE_PEM"
    VAPID_PRIVATE_KEY="$(openssl ec -in "$VAPID_PRIVATE_PEM" -outform DER | tail -c +8 | head -c 32 | base64 | tr -d '=' | tr '/+' '_-')"
    VAPID_PUBLIC_KEY="$(openssl ec -in "$VAPID_PRIVATE_PEM" -pubout -outform DER | tail -c 65 | base64 | tr -d '=' | tr '/+' '_-')"
    rm -f "$VAPID_PRIVATE_PEM"

    cat >"$ENV_FILE" <<EOF
DATABASE_URL=sqlite://$DATA_DIR/seki.db
PORT=3000
BASE_URL=https://pi.basilisk-aeolian.ts.net
ENVIRONMENT=production
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
EOF
fi

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME.service"

echo "Installed $SERVICE_FILE"
echo "Edit $ENV_FILE if needed."
