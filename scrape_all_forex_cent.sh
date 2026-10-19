#!/bin/bash
# ==============================================================================
# Scrape All 12 Forex/Commodities/Crypto Cent Instruments from Exness
# Server: Exness-MT5Real20 (real20) | Account: 159936924 | Timezone: WIB (UTC+7)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SYMBOLS=(
  "XAUUSDc"
  "EURUSDc"
  "GBPUSDc"
  "USDJPYc"
  "AUDUSDc"
  "USDCHFc"
  "USDHKDc"
  "EURJPYc"
  "AUDJPYc"
  "AUDCHFc"
  "XAGUSDc"
  "BTCUSDc"
)

echo "=========================================================="
echo "  SCRAPING 12 FOREX/CRYPTO CENT INSTRUMENTS (WIB UTC+7)"
echo "=========================================================="

echo ""
echo "=== Step 1: Mengunduh Intraday 1M Candles (WIB UTC+7) ==="
for s in "${SYMBOLS[@]}"; do
  echo ""
  echo ">>> [1M Intraday] Mengunduh $s ..."
  python3 "$SCRIPT_DIR/exness_intraday_scraper.py" --symbol "$s" --start-date 2026-03-01 --allowed-months 3,4,9,10 --tz WIB
done

echo ""
echo "=== Step 2: Mengunduh Daily EOD Candles ==="
for s in "${SYMBOLS[@]}"; do
  echo ""
  echo ">>> [Daily EOD] Mengunduh $s ..."
  python3 "$SCRIPT_DIR/exness_daily_historical_scraper.py" --symbol "$s"
done

echo ""
echo "=== Step 3: Membangun Unified Web Chart JSONs ==="
for s in "${SYMBOLS[@]}"; do
  echo ""
  echo ">>> [Unified Chart] Membangun $s ..."
  python3 "$SCRIPT_DIR/build_unified_charts.py" --no-screener "$s"
done

echo ""
echo "=== Step 4: Menata Symlink Alias untuk Kompatibilitas UI ==="
cd "$SCRIPT_DIR/indicator-examples/public"
for s in "${SYMBOLS[@]}"; do
  base="${s%c}"
  for tf in "1d" "1m"; do
    target_real="${s}_${tf}.json"
    # Cari file fisik yang menampung data
    for cand in "${base}M_${tf}.json" "${base}m_${tf}.json" "${base}C_${tf}.json" "${base}_${tf}.json" "${s}_${tf}.json"; do
      if [ -f "$cand" ] && [ ! -L "$cand" ]; then
        if [ "$cand" != "$target_real" ]; then
          mv -f "$cand" "$target_real"
        fi
        break
      fi
    done
    
    # Hapus symlink lama agar tidak error "same file"
    rm -f "${base}_${tf}.json" "${base}m_${tf}.json" "${base}M_${tf}.json" "${base}C_${tf}.json"
    
    # Buat symlink baru mengarah ke target_real
    ln -sf "$target_real" "${base}_${tf}.json"
    ln -sf "$target_real" "${base}m_${tf}.json"
    ln -sf "$target_real" "${base}M_${tf}.json"
    ln -sf "$target_real" "${base}C_${tf}.json"
  done
done

cd "$SCRIPT_DIR/data"
for s in "${SYMBOLS[@]}"; do
  base="${s%c}"
  rm -f "${base}.csv" "${base}m.csv" "${base}M.csv" "${base}C.csv"
  ln -sf "${s}.csv" "${base}.csv"
  ln -sf "${s}.csv" "${base}m.csv"
  ln -sf "${s}.csv" "${base}M.csv"
  ln -sf "${s}.csv" "${base}C.csv"
done

cd "$SCRIPT_DIR"
echo ""
echo "=========================================================="
echo "  SELESAI! Seluruh 12 instrumen cent telah disinkronkan."
echo "=========================================================="
