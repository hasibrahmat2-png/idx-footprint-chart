#!/bin/bash
set -e

# Define your stocks here
# Define your months here
MONTHS=("2026-07" "2026-08" "2026-09")

read -p "Masukkan daftar saham (pisahkan dengan spasi, contoh: KAQI BBCA): " input_stocks
read -s -p "Tempel Token Stockbit: " STOCKBIT_TOKEN
export STOCKBIT_TOKEN
echo ""

# Convert input string into array
read -a STOCKS <<< "$input_stocks"

for stock in "${STOCKS[@]}"; do
    # Buat folder output otomatis (contoh: KAQI_running_trades)
    OUT_DIR="${stock}_running_trades"
    mkdir -p "$OUT_DIR"
    
    for month in "${MONTHS[@]}"; do
        echo ""
        echo "=========================================================="
        echo "🚀 MEMULAI SCRAPING: $stock | BULAN: $month"
        echo "=========================================================="
        
        python3 stockbit_running_trade_scraper_v2.py "$stock" --month "$month" --output-dir "$OUT_DIR"
    done
done

echo ""
echo "🎉 SEMUA SAHAM SELESAI DISCRAPE!"
