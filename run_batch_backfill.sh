#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

LOG_FILE="$SCRIPT_DIR/batch_backfill.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================================="
echo " [5-DAY TARGET ORDERFLOW BACKFILL PIPELINE]"
echo " Waktu Mulai: $(date)"
echo " Target: 1 Tanggal Terlama + 4 Tanggal Terbaru yang Belum"
echo "=========================================================="

TARGET_DATES=(
    "2026-08-31" # 1 Tanggal Terlama (Senin, 31 Agustus 2026)
    "2026-09-25" # Tanggal Terbaru yang Belum #1 (Jumat, 25 Sep 2026)
    "2026-09-24" # Tanggal Terbaru yang Belum #2 (Kamis, 24 Sep 2026)
    "2026-09-23" # Tanggal Terbaru yang Belum #3 (Rabu, 23 Sep 2026)
    "2026-09-22" # Tanggal Terbaru yang Belum #4 (Selasa, 22 Sep 2026)
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
echo " 5-DAY TARGET ORDERFLOW BACKFILL PIPELINE SELESAI!"
echo " Waktu Selesai: $(date)"
echo "=========================================================="
