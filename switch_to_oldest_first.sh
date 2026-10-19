#!/bin/bash
TARGET_PID=1872
PARENT_PID=1867

echo "[WATCHER] Menunggu proses download 2026-10-13 (PID $TARGET_PID) selesai..."
while kill -0 "$TARGET_PID" 2>/dev/null; do
    sleep 3
done

echo "[WATCHER] Download 2026-10-13 selesai! Menghentikan parent pipeline lama (PID $PARENT_PID)..."
kill -9 "$PARENT_PID" 2>/dev/null || true

echo "[WATCHER] Meluncurkan run_oldest_first_backfill.sh (Mulai 2026-09-02 Batas Terlama)..."
exec /home/hasibrahmat2/lightweight-charts-master/run_oldest_first_backfill.sh
