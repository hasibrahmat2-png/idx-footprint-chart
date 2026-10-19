#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Step 1: Generating Unified Footprint and Intraday Data ==="
echo "Membaca data/ (1d), data_intraday/ (1m), dan menggabungkan Running Trades..."
python3 "$SCRIPT_DIR/build_unified_charts.py" "$@"

echo "=== Step 2: Rebuilding Screener ==="
python3 "$SCRIPT_DIR/build_screener.py"

echo "=== Step 3: Reconciling Trade History & Open Portfolio ==="
python3 "$SCRIPT_DIR/fetch_stockbit_trade_history.py" --cached

echo "=== Step 4: Reconciling Forex Trade History & Cashflow ==="
python3 "$SCRIPT_DIR/process_forex_history.py"

echo "=== ALL DONE! Data siap digunakan di Web ==="
