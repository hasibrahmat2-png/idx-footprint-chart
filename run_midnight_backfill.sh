#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

LOG_FILE="$SCRIPT_DIR/midnight_backfill.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================================="
echo " [MIDNIGHT ORDERFLOW BACKFILL PIPELINE]"
echo " Waktu Server: $(date)"
echo " Target Mulai: 00:30 WIB (Sabtu, 10 Okt 2026)"
echo "=========================================================="

TARGET_EPOCH=1791567000 # 2026-10-10 00:30:00 WIB
NOW_EPOCH=$(date +%s)

if [ "$NOW_EPOCH" -lt "$TARGET_EPOCH" ]; then
    WAIT_SEC=$((TARGET_EPOCH - NOW_EPOCH))
    WAIT_MIN=$((WAIT_SEC / 60))
    echo "Menunggu ${WAIT_SEC} detik (~${WAIT_MIN} menit) hingga pukul 00:30 WIB..."
    sleep "$WAIT_SEC"
fi

echo ""
echo "=== PUKUL 00:30 WIB TERCAPAI. MEMULAI DOWNLOAD! ==="
echo "Waktu mulai eksekusi: $(date)"

# 1. Selesaikan sisa 59 saham hari ini (Jumat, 9 Oktober 2026)
echo ""
echo "----------------------------------------------------------"
echo " [STEP 1] Menyelesaikan Sisa 59 Saham: 2026-10-09"
echo "----------------------------------------------------------"
python3 "$SCRIPT_DIR/idxedgepro_running_trade_scraper.py" -d 2026-10-09 -w 8

# Cek apakah kuota habis di Step 1
if [ -f "$SCRIPT_DIR/data/last_scraped_footprint_status.json" ]; then
    STATUS=$(grep '"status":' "$SCRIPT_DIR/data/last_scraped_footprint_status.json" | head -n 1 | cut -d'"' -f4)
    if [ "$STATUS" = "QUOTA_EXHAUSTED" ]; then
        echo "=== [!] Kuota habis saat menyelesaikan 2026-10-09. Berhenti. ==="
        exit 0
    fi
fi

# 2. Loop Tanggal Mundur Minggu Lalu
BACKFILL_DATES=(
    "2026-10-02" # Jumat
    "2026-10-01" # Kamis
    "2026-09-30" # Rabu
    "2026-09-29" # Selasa
    "2026-09-28" # Senin
)

for target_d in "${BACKFILL_DATES[@]}"; do
    echo ""
    echo "----------------------------------------------------------"
    echo " [STEP 2] Mengunduh Tanggal Mundur: $target_d"
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
done

# 3. Otomatis Reconcile Web Chart
echo ""
echo "----------------------------------------------------------"
echo " [STEP 3] Menjalankan update_all.sh untuk Rekonsiliasi Web Chart"
echo "----------------------------------------------------------"
bash "$SCRIPT_DIR/update_all.sh"

echo ""
echo "=========================================================="
echo " MIDNIGHT ORDERFLOW BACKFILL PIPELINE SELESAI!"
echo " Waktu Selesai: $(date)"
echo "=========================================================="
