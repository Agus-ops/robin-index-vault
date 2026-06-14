#!/usr/bin/env bash
set -euo pipefail

cd /opt/robin-index-vault

while true; do
  echo "========================================"
  echo "[KEEPER] $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "========================================"

  EXEC=1 npm run oracle-keeper || true
  EXEC=1 npm run reward-keeper || true

  echo
  echo "[KEEPER] sleeping 4 hours..."
  sleep 14400
done
