---
name: idx-footprint-platform
description: >-
  Workflows, SOPs, and commands for the IDX Footprint Charting platform,
  including scraping daily/intraday/running trade data from Stockbit/Ajaib,
  running the build_unified_charts.py pipeline, serving the Vite + TypeScript frontend,
  and developing Lightweight Charts v5 plugins and indicators.
---

# IDX Footprint Platform & Lightweight Charts Runbook

This skill provides step-by-step procedures for managing data feeds, updating charts, running the local web application, and extending TradingView Lightweight Charts features.

## 1. Daily Operations Runbook

### Step 1: Set Stockbit Auth Token
Token is valid per terminal session:
```bash
read -s -p "Enter Stockbit Token: " STOCKBIT_TOKEN && export STOCKBIT_TOKEN && echo ""
```

### Step 2: Scrape Raw CSV Data
```bash
# A. Daily Historical EOD (incremental update to data/)
python3 stockbit_daily_historical_scraper.py -f ihsg_list.csv

# B. Intraday 1M Candles (Auto-resumes: only today's candles for existing stocks, full 3 months for new stocks like JELI)
python3 stockbit_intraday_scraper.py -f ihsg_list.csv

# C. Running Trades (Footprint tick data)
python3 stockbit_running_trade_scraper_v2.py JELI --month 2026-09 --output-dir JELI_running_trades
python3 stockbit_running_trade_scraper_v2.py KAQI --month 2026-09 --output-dir KAQI_running_trades
```

*Note on Stealth Bans*: If Stockbit returns `[]`, the scraper automatically waits 60s (up to 2 retries) before safely proceeding.

### Step 3: Run Unified Data Pipeline
Transforms all raw CSVs into unified multi-timeframe JSON files and rebuilds the screener:
```bash
# 1. Process all symbols, resample timeframes, and inject footprint levels directly to public/
python3 build_unified_charts.py

# 2. Rebuild screener metrics
python3 build_screener.py
```

### Step 4: Launch Frontend Dev Server
```bash
cd /home/hasibrahmat2/lightweight-charts-master/indicator-examples
npm run dev -- --host
```
Open URL: `http://localhost:5173/src/my-footprint-ts/` (or port 5174).

---

## 2. Library Development & Testing (Upstream Lightweight Charts)

When modifying or compiling the core Lightweight Charts library:

```bash
# Build the core library
npm install
npm run build:prod

# Run unit tests & verification
npm run test
npm run verify

# Create a clean debug sandbox
cd debug
npm run init
npm run create my-test
npm run serve my-test

# Scaffold a new custom plugin
npm create lwc-plugin@latest
```
