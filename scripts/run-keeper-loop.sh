#!/usr/bin/env bash
set -euo pipefail

cd /opt/robin-index-vault

while true; do
  echo "========================================"
  echo "[KEEPER] $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "========================================"

  EXEC=1 npm run oracle-keeper || true
  EXEC=1 npm run reward-keeper || true
  EXEC=1 npm run auto-allocate || true
  EXEC=1 npm run daily-tracker || true
  EXEC=1 npm run points-tracker || true
  cp /opt/robin-index-vault/data/points.json /opt/robin-index-vault/frontend/public/points.json || true

  echo
  echo "[KEEPER] sleeping 4 hours..."
  sleep 14400
done

# Loop terpisah untuk points + leaderboard (background)
points_loop() {
  while true; do
    echo "[POINTS] $(date) — updating points & leaderboard..."
    cd /opt/robin-index-vault
    EXEC=1 npm run points-tracker || true
    node scripts/sync-leaderboard.mjs || true
    echo "[POINTS] sleeping 10 minutes..."
    sleep 600
  done
}

points_loop &
