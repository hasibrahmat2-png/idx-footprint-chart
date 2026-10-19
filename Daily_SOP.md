# 🌅 Daily Startup SOP (Standard Operating Procedure)

This is your master daily routine to fetch fresh data (Daily, Intraday, Broker Summary, and Footprint), process the unified pipeline, and launch your live WebSocket bridge and TypeScript charting server.

---

### 📍 Step 1: Scrape Fresh Data (Raw CSVs)
Open your terminal and navigate to your project root:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
```

**A. Set your Token (Only needs to be done once per terminal session):**
```bash
read -s -p "Enter Stockbit Token: " STOCKBIT_TOKEN && export STOCKBIT_TOKEN && echo ""
```

**B. Scrape Daily Historical Candles (Updates the `data/` folder):**
Reads `ihsg_list.csv` and incrementally updates missing trading days:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
python3 stockbit_daily_historical_scraper.py -f ihsg_list.csv
```

**C. Scrape 1-Minute Intraday Candles (Saved to `data_intraday/`):**
Auto-resumes only today's missing candles for existing stocks; downloads full history for new stocks:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
python3 stockbit_intraday_scraper.py -f ihsg_list.csv
```

**D. Scrape Broker Summary & Bandarmology (Saved to `data_broker_summary/`):**
Incrementally queries missing trading days up to today:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
python3 stockbit_broker_summary_scraper.py -f ihsg_list.csv --days 30
```

**E. Scrape Running Trades (Footprint Data):**
*(Optional: only for targeted active stocks for the current month)*:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
python3 stockbit_running_trade_scraper_v2.py KAQI --month 2026-09 --output-dir KAQI_running_trades
python3 stockbit_running_trade_scraper_v2.py JELI --month 2026-09 --output-dir JELI_running_trades
```

---

### ⚙️ Step 2: Update & Process Chart Data
Run your master pipeline script. This will automatically calculate footprint bars, merge EOD metrics, and **generate pristine JSON files directly into the TypeScript public folder** (`indicator-examples/public/`):
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
bash update_all.sh
# Or run directly: python3 build_unified_charts.py
```

---

### 🚀 Step 3: Launch the Live Platform

#### Terminal 1: Real-Time Running Trades Bridge Daemon
Connects to upstream `wss://stock.arjum.com/ws/running-trade` with your authenticated `STOCK_API_KEY`, filters by the 753-stock IHSG whitelist from `ihsg_stocks.json`, and re-broadcasts clean ticks locally on `ws://localhost:8765`:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/
node live_trade_bridge.mjs
# (Python alternative: python3 live_trade_bridge.py)
```
> **Note (Outside Market Hours / Offline Testing)**:
> To simulate continuous market ticks outside 09:00–15:50 WIB:
> ```bash
> cd /home/hasibrahmat2/lightweight-charts-master/
> node mock_trade_emitter.mjs
> ```

#### Terminal 2: Activate the Web Chart Server
Navigate into the Vite environment and start the development server:
```bash
cd /home/hasibrahmat2/lightweight-charts-master/indicator-examples/
npm run dev -- --host
```

**Link to Open:**
👉 **`http://localhost:5173/src/my-footprint-ts/`** (or port `5174`)

---

### 🧪 Step 4: Verification & Type Checking
```bash
# Run unit test for IHSG running trade stream filtering:
cd /home/hasibrahmat2/lightweight-charts-master/
node tests/test_ihsg_stream_filter.mjs

# Compile and type-check TypeScript:
cd /home/hasibrahmat2/lightweight-charts-master/indicator-examples/
npm run build
```
