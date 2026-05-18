#!/usr/bin/env bash
set -euo pipefail

EXPECTED_RELEASE_ID="${1:-${RELEASE_ID:-}}"
if [[ -z "$EXPECTED_RELEASE_ID" ]]; then
    echo "usage: verify-release.sh <release-id>" >&2
    exit 1
fi
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/up}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
deadline=$((SECONDS + TIMEOUT_SECONDS))

while (( SECONDS < deadline )); do
    response="$(curl -fsS "$HEALTH_URL" || true)"
    current_release_id="$(
        printf '%s' "$response" | sed -n 's/.*"release_id":"\([^"]*\)".*/\1/p'
    )"

    if [[ "$current_release_id" == "$EXPECTED_RELEASE_ID" ]]; then
        exit 0
    fi

    sleep 1
done

echo "Timed out waiting for release $EXPECTED_RELEASE_ID at $HEALTH_URL" >&2
exit 1
