#!/bin/bash
# ==============================================================================
# Update XAUUSDc (Gold Cent / Exness) Pipeline: Scrape & Build Unified Web Charts
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "  SINKRONISASI & UPDATE DATA XAUUSD (GOLD CENT) EXNESS"
echo "=========================================================="

# 1. Update Daily Historical EOD
echo ""
echo "=== Step 1: Update Daily EOD Candles (data/XAUUSDc.csv) ==="
python3 "$SCRIPT_DIR/exness_daily_historical_scraper.py" --symbol XAUUSDc "$@"

# 2. Update Intraday 1M Candles (WIB UTC+7)
echo ""
echo "=== Step 2: Update Intraday 1M Candles (data_intraday/XAUUSDc_intraday.csv) ==="
python3 "$SCRIPT_DIR/exness_intraday_scraper.py" --symbol XAUUSDc --start-date 2026-03-01 --allowed-months 3,4,9,10 --tz WIB "$@"

# 3. Generate Unified Chart JSONs for Web Client
echo ""
echo "=== Step 3: Rebuild Unified JSONs (indicator-examples/public/) ==="
python3 "$SCRIPT_DIR/build_unified_charts.py" --no-screener XAUUSDc

# 4. Maintain Alias Symlinks
cd "$SCRIPT_DIR/indicator-examples/public"
ln -sf XAUUSDC_1d.json XAUUSDc_1d.json 2>/dev/null || ln -sf XAUUSDc_1d.json XAUUSDC_1d.json
ln -sf XAUUSDc_1d.json XAUUSD_1d.json
ln -sf XAUUSDc_1d.json XAUUSDm_1d.json
ln -sf XAUUSDc_1d.json XAUUSDM_1d.json

ln -sf XAUUSDC_1m.json XAUUSDc_1m.json 2>/dev/null || ln -sf XAUUSDc_1m.json XAUUSDC_1m.json
ln -sf XAUUSDc_1m.json XAUUSD_1m.json
ln -sf XAUUSDc_1m.json XAUUSDm_1m.json
ln -sf XAUUSDc_1m.json XAUUSDM_1m.json

cd "$SCRIPT_DIR/data"
ln -sf XAUUSDc.csv XAUUSD.csv
ln -sf XAUUSDc.csv XAUUSDm.csv
ln -sf XAUUSDc.csv XAUUSDM.csv
ln -sf XAUUSDc.csv XAUUSDC.csv

cd "$SCRIPT_DIR"

echo ""
echo "=========================================================="
echo "  SELESAI! Data XAUUSDc terbaru siap ditampilkan di web."
echo "=========================================================="
