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
echo " [TODAY (13 OKT) & HISTORICAL BACKFILL ORDERFLOW PIPELINE]"
echo " Waktu Mulai: $(date)"
echo " Target: 2026-10-13 (Hari Ini) + 2026-09-18 (Sisa) + Hari-Hari Sebelumnya"
echo "=========================================================="

TARGET_DATES=(
    "2026-10-13" # Hari Ini (Selasa, 13 Oktober 2026)
    "2026-09-18" # Sisa 35 saham 18 Sep (mulai KETR)
    "2026-09-17" # Kamis, 17 Sep
    "2026-09-16" # Rabu, 16 Sep
    "2026-09-15" # Selasa, 15 Sep
    "2026-09-14" # Senin, 14 Sep
    "2026-09-11" # Jumat, 11 Sep
    "2026-09-10" # Kamis, 10 Sep
    "2026-09-09" # Rabu, 9 Sep
    "2026-09-08" # Selasa, 8 Sep
    "2026-09-07" # Senin, 7 Sep
    "2026-09-04" # Jumat, 4 Sep
    "2026-09-03" # Kamis, 3 Sep
    "2026-09-02" # Rabu, 2 Sep
    "2026-09-01" # Selasa, 1 Sep
)

TOTAL_DATES=${#TARGET_DATES[@]}
CURRENT_IDX=1

for target_d in "${TARGET_DATES[@]}"; do
    echo ""
    echo "----------------------------------------------------------"
    echo " [STEP 1.$CURRENT_IDX / $TOTAL_DATES] Mengunduh Tanggal: $target_d"
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

# 2. Otomatis Reconcile Web Chart
echo ""
echo "----------------------------------------------------------"
echo " [STEP 2] Menjalankan update_all.sh untuk Rekonsiliasi Web Chart"
echo "----------------------------------------------------------"
bash "$SCRIPT_DIR/update_all.sh"

echo ""
echo "=========================================================="
echo " ORDERFLOW PIPELINE SELESAI!"
echo " Waktu Selesai: $(date)"
echo "=========================================================="
