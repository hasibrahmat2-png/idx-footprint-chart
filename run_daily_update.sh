#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Simpan token jika sudah di-export oleh user di environment
EXISTING_STOCKBIT_TOKEN="$STOCKBIT_TOKEN"
EXISTING_EXNESS_TOKEN="$EXNESS_TOKEN"

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Kembalikan token jika user sebelumnya sudah meng-export di terminal
if [ -n "$EXISTING_STOCKBIT_TOKEN" ]; then
    export STOCKBIT_TOKEN="$EXISTING_STOCKBIT_TOKEN"
fi
if [ -n "$EXISTING_EXNESS_TOKEN" ]; then
    export EXNESS_TOKEN="$EXISTING_EXNESS_TOKEN"
fi

echo "=========================================================="
echo " Starting Full Market Daily Update Pipeline"
echo " Time: $(date)"
echo "=========================================================="

echo ""
echo "=== STEP 1/3: Updating Daily EOD Historical Data (752 Stocks) ==="
python3 "$SCRIPT_DIR/stockbit_daily_historical_scraper.py" -f "$SCRIPT_DIR/data/ihsg_list.csv" --delay 0.55

echo ""
echo "=== STEP 2/3: Updating 1M Intraday Historical Data (752 Stocks) ==="
python3 "$SCRIPT_DIR/stockbit_intraday_scraper.py" -f "$SCRIPT_DIR/data/ihsg_list.csv" --delay 0.55

echo ""
echo "=== STEP 3/3: Running update_all.sh (Reconcile Charts, Screener, Journal) ==="
bash "$SCRIPT_DIR/update_all.sh"

echo ""
echo "=========================================================="
echo " Full Market Daily Update Pipeline COMPLETED Successfully!"
echo " Time: $(date)"
echo "=========================================================="
