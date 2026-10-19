#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

LOG_FILE="$SCRIPT_DIR/today_and_backfill.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================================="
echo " [OLDEST-FIRST RESCUE BACKFILL ORDERFLOW PIPELINE]"
echo " Waktu Mulai: $(date)"
echo " Strategi: Prioritaskan Tanggal Terlama (2026-09-02) sebelum Di-Purge"
echo " Target: 2026-09-02 s/d 2026-09-18"
echo "=========================================================="

TARGET_DATES=(
    "2026-09-04" # Sisa saham 04 Sep (resume dari MAYA)
    "2026-09-07" # Senin, 7 Sep
    "2026-09-08" # Selasa, 8 Sep
    "2026-09-09" # Rabu, 9 Sep
    "2026-09-10" # Kamis, 10 Sep
    "2026-09-11" # Jumat, 11 Sep
    "2026-09-14" # Senin, 14 Sep
    "2026-09-15" # Selasa, 15 Sep
    "2026-09-16" # Rabu, 16 Sep
    "2026-09-17" # Kamis, 17 Sep
    "2026-09-18" # Jumat (Sisa 35 saham)
)

TOTAL_DATES=${#TARGET_DATES[@]}
CURRENT_IDX=1

for target_d in "${TARGET_DATES[@]}"; do
    echo ""
    echo "----------------------------------------------------------"
    echo " [STEP $CURRENT_IDX / $TOTAL_DATES] Mengunduh Tanggal: $target_d"
    echo "----------------------------------------------------------"
    python3 "$SCRIPT_DIR/idxedgepro_running_trade_scraper.py" -d "$target_d" -w 8
    
    # Cek apakah kuota habis setelah tanggal ini
    if [ -f "$SCRIPT_DIR/data/last_scraped_footprint_status.json" ]; then
        STATUS=$(grep '"status":' "$SCRIPT_DIR/data/last_scraped_footprint_status.json" | head -n 1 | cut -d'"' -f4)
        if [ "$STATUS" = "QUOTA_EXHAUSTED" ]; then
            echo ""
            echo "=========================================================="
            echo " [!] KUOTA HARIAN ARJUM HABIS pada tanggal $target_d"
            echo " Status lengkap tersimpan di data/last_scraped_footprint_status.json"
            echo "=========================================================="
            break
        fi
    fi
    CURRENT_IDX=$((CURRENT_IDX + 1))
done

# Otomatis Reconcile Web Chart
echo ""
echo "----------------------------------------------------------"
echo " [STEP RECONCILE] Menjalankan update_all.sh untuk Rekonsiliasi Web Chart"
echo "----------------------------------------------------------"
bash "$SCRIPT_DIR/update_all.sh"

echo ""
echo "=========================================================="
echo " ORDERFLOW PIPELINE SELESAI!"
echo " Waktu Selesai: $(date)"
echo "=========================================================="
