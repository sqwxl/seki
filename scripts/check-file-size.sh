#!/usr/bin/env bash
# Check that no non-test source file exceeds 500 lines.
# Usage: ./scripts/check-file-size.sh
# Exit 0 if clean, exit 1 if violations found.
set -euo pipefail

MAX_LINES=500
OUTPUT=$(mktemp)
trap 'rm -f "$OUTPUT"' EXIT

find go-engine/src go-engine-wasm/src seki-web/src seki-web/frontend/src \
  \( -name "*.rs" -o -name "*.ts" -o -name "*.tsx" \) \
  ! -path "*/__tests__/*" ! -path "*/tests/*" \
  -exec sh -c 'L=$(wc -l < "$1"); if [ "$L" -gt '"$MAX_LINES"' ]; then echo "$1: $L lines (max '"$MAX_LINES"')"; fi' _ {} \; > "$OUTPUT"

VIOLATION_COUNT=$(wc -l < "$OUTPUT")

if [ "$VIOLATION_COUNT" -gt 0 ]; then
  cat "$OUTPUT"
fi

echo ""
if [ "$VIOLATION_COUNT" -eq 0 ]; then
  echo "PASS: All source files <= $MAX_LINES lines."
  exit 0
else
  echo "FAIL: $VIOLATION_COUNT file(s) exceed $MAX_LINES lines."
  exit 1
fi
