#!/bin/bash
# ==============================================================================
# Update Forex & Indices (USDJPYc, EURUSDc, USTECc, US500c, US30c) Pipeline
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SYMBOLS_FILE="$SCRIPT_DIR/symbols_forex_indices.txt"
PAIRS=("USDJPYc" "EURUSDc" "USTECc" "US500c" "US30c")

echo "=========================================================="
echo "  SINKRONISASI & UPDATE DATA FOREX & INDICES EXNESS"
echo "  Symbols: ${PAIRS[*]}"
echo "=========================================================="

# 1. Update Daily Historical EOD
echo ""
echo "=== Step 1: Update Daily EOD Candles ==="
python3 "$SCRIPT_DIR/exness_daily_historical_scraper.py" --symbols-file "$SYMBOLS_FILE" "$@"

# 2. Update Intraday 1M Candles (WIB UTC+7)
echo ""
echo "=== Step 2: Update Intraday 1M Candles ==="
python3 "$SCRIPT_DIR/exness_intraday_scraper.py" --symbols-file "$SYMBOLS_FILE" --start-date 2026-03-01 --allowed-months 3,4,9,10 --tz WIB "$@"

# 3. Generate Unified Chart JSONs for Web Client
echo ""
echo "=== Step 3: Rebuild Unified JSONs (indicator-examples/public/) ==="
python3 "$SCRIPT_DIR/build_unified_charts.py" --no-screener USDJPYC EURUSDC USTECC US500C US30C

# 4. Maintain Alias Symlinks
echo ""
echo "=== Step 4: Maintaining Symlinks ==="
cd "$SCRIPT_DIR/indicator-examples/public"
for sym in "${PAIRS[@]}"; do
    base="${sym%[cCmMnN]}"
    upper_base="$(echo "$base" | tr '[:lower:]' '[:upper:]')"
    upper_c="${upper_base}C"
    lower_c="${upper_base}c"
    
    # 1d symlinks
    if [ -f "${upper_c}_1d.json" ]; then
        ln -sf "${upper_c}_1d.json" "${lower_c}_1d.json" 2>/dev/null || true
        ln -sf "${upper_c}_1d.json" "${upper_base}_1d.json" 2>/dev/null || true
        ln -sf "${upper_c}_1d.json" "${upper_base}m_1d.json" 2>/dev/null || true
        ln -sf "${upper_c}_1d.json" "${upper_base}M_1d.json" 2>/dev/null || true
    fi

    # 1m symlinks
    if [ -f "${upper_c}_1m.json" ]; then
        ln -sf "${upper_c}_1m.json" "${lower_c}_1m.json" 2>/dev/null || true
        ln -sf "${upper_c}_1m.json" "${upper_base}_1m.json" 2>/dev/null || true
        ln -sf "${upper_c}_1m.json" "${upper_base}m_1m.json" 2>/dev/null || true
        ln -sf "${upper_c}_1m.json" "${upper_base}M_1m.json" 2>/dev/null || true
    fi
done

cd "$SCRIPT_DIR/data"
for sym in "${PAIRS[@]}"; do
    base="${sym%[cCmMnN]}"
    upper_base="$(echo "$base" | tr '[:lower:]' '[:upper:]')"
    upper_c="${upper_base}C"
    lower_c="${upper_base}c"

    target_csv=""
    if [ -f "${lower_c}.csv" ]; then
        target_csv="${lower_c}.csv"
    elif [ -f "${upper_c}.csv" ]; then
        target_csv="${upper_c}.csv"
    fi

    if [ -n "$target_csv" ]; then
        ln -sf "$target_csv" "${upper_base}.csv" 2>/dev/null || true
        ln -sf "$target_csv" "${upper_c}.csv" 2>/dev/null || true
        ln -sf "$target_csv" "${lower_c}.csv" 2>/dev/null || true
        ln -sf "$target_csv" "${upper_base}m.csv" 2>/dev/null || true
        ln -sf "$target_csv" "${upper_base}M.csv" 2>/dev/null || true
    fi
done

cd "$SCRIPT_DIR"

echo ""
echo "=========================================================="
echo "  SELESAI! Data Forex & Indices terbaru siap ditampilkan di web."
echo "=========================================================="
