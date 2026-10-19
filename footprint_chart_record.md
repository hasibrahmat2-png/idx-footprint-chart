# Footprint Chart System Skeleton & Record

This document serves as a complete record of the architecture and fixes we implemented to build your custom Footprint Chart using TradingView Lightweight Charts.

## 1. Data Preparation (`prepare_data.py`)

Our Python script reads raw intraday trade CSV files and bundles them into a format TradingView can read.

**Key Steps & Fixes:**
*   **Time Bucketing:** Iterates through a directory of CSVs and aggregates trades simultaneously into **1m, 5m, 15m, 1h, and 1d** timeframes.
*   **Timezone Fix:** Forced Python to interpret the CSV timestamps as UTC (`tzinfo=timezone.utc`) so they don't get shifted by server local time. This fixed the chart starting at `05:55` instead of `08:55`.
*   **Volume in Lots:** Instead of using raw `shares`, we extract the `lot` column so the footprint numbers remain readable (e.g., `34.9k` instead of massive numbers).
*   **Price Action:** Only processed Regular Market Board trades (`market_board == 'RG'`).
*   **Aggregation:** Captured Open, High, Low, Close for each candle, and grouped Bid (Sell) / Ask (Buy) volumes at every specific price point within that candle.

## 2. Chart Rendering (`my-footprint-demo.html`)

We used **TradingView Lightweight Charts v5.1.0** along with the **lightweight-orderflow-charts v0.2.0** plugin.

### General Chart Setup
*   **Responsive Fullscreen:** Enabled `autoSize: true` and CSS `100vw`/`100vh` to fill the entire browser viewport seamlessly.
*   **Theme:** Implemented the modern TradingView default light theme with a `#ffffff` background and light grey `#e1e3e8` grid lines.
*   **Time Axis:** Explicitly enabled `timeVisible: true` to show intraday times (like 08:55).

### Footprint & Orderflow Customization
*   **Candle Placement:** We set the candle `position` to `'middle'`, which cleanly splits the Bid volume on the left and Ask volume on the right.
*   **Candle Thickness:** We set the `widthRatio` to `0.2` so the candle sits comfortably in the middle without squashing or blocking the table data.
*   **Material Colors:** We overwrote the default theme colors with standard Material UI colors:
    *   `bullishCandleColor: '#4CAF50'` (Material Green 500)
    *   `bearishCandleColor: '#FF5252'` (Material Red 500)
*   **Wick Colors:** We enabled `showWicks: true` and set `candleWickColor: '#888888'` (a neutral grey). We had to use a single grey color because the community plugin physically does not support dual-colored wicks on a single series.

### Advanced Features & Tooling
*   **Dynamic Fraksi Harga (IDX Tick Size):** Implemented a Javascript function that dynamically detects the correct Indonesian Stock Exchange tick size (1, 2, 5, 10, or 25) based on the asset's current price. It automatically adjusts the footprint ladder clustering so there are no empty gaps.
*   **Timeframe Toolbar:** Built a floating CSS toolbar that fetches and hot-swaps `data_1m.json`, `data_5m.json`, etc., dynamically based on the selected button.
*   **Candlestick Toggle:** Built a "Toggle Footprint" button that instantly replaces the footprint table with a native TradingView `CandlestickSeries`, giving you a perfectly normal chart view when you want it.

## 3. How to Run (Terminal Commands)

Whenever you want to start this project from scratch or process new data, run these commands in your Linux terminal from the project folder:

**to update the data**

    bash /home/hasibrahmat2/lightweight-charts-master/scrape_all_history.sh

**Step 1: Process the CSV Data**
You can pass a single CSV file or an entire folder of CSVs. The script will output the JSON files automatically.
```bash
    bash /home/hasibrahmat2/lightweight-charts-master/update_all.sh
```

**Step 2: Start the Local Web Server**
Browsers block local HTML files from loading JSON files directly due to CORS security. You must spin up a local server.
```bash
python3 -m http.server 8000
```

**Step 3: Open the Chart**
Open your Chrome browser and navigate to:
[http://localhost:8000/my-footprint-demo.html](http://localhost:8000/my-footprint-demo.html)

## 4. Final Code Skeletons

### `prepare_data.py`
```python
import csv
import json
import os
import glob
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

def round_time(dt, delta):
    # Special handling for 1 day: bucket by calendar day (00:00)
    if delta == timedelta(days=1):
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt - (dt - datetime.min) % delta

filenames = []
if len(sys.argv) > 1:
    for arg in sys.argv[1:]:
        if os.path.isdir(arg):
            filenames.extend(glob.glob(os.path.join(arg, "*.csv")))
        else:
            filenames.append(arg)
else:
    filenames.append('running_trade_TMPO_2026-08-26.csv')

# Define timeframes
timeframes = {
    '1m': timedelta(minutes=1),
    '5m': timedelta(minutes=5),
    '15m': timedelta(minutes=15),
    '1h': timedelta(hours=1),
    '1d': timedelta(days=1)
}

bars_by_tf = {tf: {} for tf in timeframes}

for filename in filenames:
    print(f"Processing {filename}...")
    with open(filename, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['market_board'] != 'RG':
                continue

            dt_str = f"{row['date']} {row['time']}"
            try:
                dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
                
            price = float(row['price'])
            lots = float(row['lot'])
            action = row['action'].strip().lower()

            for tf_name, delta in timeframes.items():
                bar_time = round_time(dt, delta)
                bar_key = bar_time.strftime("%Y-%m-%d %H:%M:%S")
                
                tf_bars = bars_by_tf[tf_name]

                if bar_key not in tf_bars:
                    tf_bars[bar_key] = {
                        'time': int(bar_time.replace(tzinfo=timezone.utc).timestamp()),
                        'open': price,
                        'high': price,
                        'low': price,
                        'close': price,
                        'levels_map': defaultdict(lambda: {'bidVolume': 0, 'askVolume': 0})
                    }
                
                bar = tf_bars[bar_key]
                bar['high'] = max(bar['high'], price)
                bar['low'] = min(bar['low'], price)
                bar['close'] = price
                
                if action == 'sell':
                    bar['levels_map'][price]['bidVolume'] += lots
                elif action == 'buy':
                    bar['levels_map'][price]['askVolume'] += lots
                else:
                    bar['levels_map'][price]['askVolume'] += lots

for tf_name, tf_bars in bars_by_tf.items():
    output = []
    for bar_key in sorted(tf_bars.keys()):
        bar = tf_bars[bar_key]
        levels = []
        for p in sorted(bar['levels_map'].keys(), reverse=True):
            v = bar['levels_map'][p]
            levels.append({
                'price': p,
                'bidVolume': v['bidVolume'],
                'askVolume': v['askVolume']
            })
        bar['levels'] = levels
        del bar['levels_map']
        output.append(bar)

    out_name = f'data_{tf_name}.json'
    with open(out_name, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"Generated {len(output)} bars for {tf_name} -> {out_name}")
```

### `my-footprint-demo.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My First Footprint Chart</title>
    <style>
        body, html {
            background-color: #e2e2e2;
            color: #111;
            font-family: sans-serif;
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden; /* Prevent scrollbars */
        }

        #main-layout {
            display: flex;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        }
        #chart-container {
            flex: 1;
            height: 100%;
            position: relative;
            min-width: 0; /* Important for flex child */
        }
        #sidebar {
            width: 25%;
            background: #fff;
            border-left: 1px solid #ccc;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }
        #sidebar-header {
            padding: 10px;
            font-weight: bold;
            border-bottom: 1px solid #ddd;
            font-size: 16px;
            display: flex;
            justify-content: space-between;
        }
        .sidebar-tabs {
            display: flex;
            flex-wrap: wrap;
            border-bottom: 1px solid #ddd;
            background: #f9f9f9;
        }
        .tab-btn {
            flex: 1 0 33%;
            border: none;
            background: none;
            padding: 8px 4px;
            font-size: 11px;
            cursor: pointer;
            text-align: center;
            border-right: 1px solid #ddd;
            border-bottom: 1px solid #ddd;
            box-sizing: border-box;
        }
        .tab-btn.active {
            background: #fff;
            font-weight: bold;
            border-bottom: 2px solid #2196F3;
        }
        .sidebar-table-wrap {
            flex: 1;
            overflow-y: auto;
        }
        .sidebar-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .sidebar-table th {
            position: sticky;
            top: 0;
            background: #eee;
            padding: 6px;
            text-align: right;
            border-bottom: 1px solid #ddd;
        }
        .sidebar-table th:first-child { text-align: left; }
        .sidebar-table td {
            padding: 6px;
            text-align: right;
            border-bottom: 1px solid #eee;
            cursor: pointer;
        }
        .sidebar-table td:first-child { text-align: left; font-weight: bold; }
        .sidebar-table tr:hover { background: #f5f5f5; }
        
        /* Format positive/negative */
        .val-pos { color: #4CAF50; }
        .val-neg { color: #FF5252; }
        /* old #chart-container replaced */
        .hidden-chart-container {
            width: 100vw;
            height: 100vh;
            position: relative;
        }
        
        #toolbar {
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 10;
            display: flex;
            gap: 10px;
            background: #fff;
            padding: 5px;
            border-radius: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #ccc;
        }

        .btn {
            background: #fff;
            border: 1px solid #aaa;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
        }
        .btn:hover {
            background: #f0f0f0;
        }
        .btn.active {
            background: #e0e0e0;
            font-weight: bold;
            border-color: #888;
        }

        #legend {
            position: absolute;
            left: 20px;
            top: 65px; /* Below the toolbar */
            z-index: 10;
            font-size: 14px;
            background: rgba(255, 255, 255, 0.85);
            padding: 6px 10px;
            border-radius: 4px;
            pointer-events: none; /* Let mouse clicks pass through to the chart */
            display: none;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #ddd;
        }
        .legend-val {
            font-weight: bold;
            margin-right: 12px;
        }
    </style>
</head>
<body>
    <div id="main-layout">
    <div id="chart-container">
        <div id="toolbar">
            <input type="text" id="ticker-input" value="JELI" placeholder="Ticker" class="btn" style="width: 60px; font-weight: bold; text-transform: uppercase;">
            <button id="toggle-btn" class="btn" style="margin-left: 10px;">Toggle Footprint</button>
            <button id="auto-sr-btn" class="btn" style="margin-right: 20px;">Auto S/R</button>
            <button class="btn tf-btn" data-tf="1m">1m</button>
            <button class="btn tf-btn active" data-tf="5m">5m</button>
            <button class="btn tf-btn" data-tf="15m">15m</button>
            <button class="btn tf-btn" data-tf="1h">1h</button>
            <button class="btn tf-btn" data-tf="1d">1D</button>
            <div style="border-left: 1px solid #ccc; margin: 0 5px;"></div>
            <button id="screener-btn" class="btn">Screener</button>
        </div>
        <div id="legend"></div>
    </div>
    
    <div id="sidebar">
        <div id="sidebar-header">
            <span>Movers</span>
            <span style="cursor:pointer;" id="close-sidebar-btn">✖</span>
        </div>
        <div class="sidebar-tabs">
            <button class="tab-btn active" data-sort="gainer">Top Gainer</button>
            <button class="tab-btn" data-sort="loser">Top Loser</button>
            <button class="tab-btn" data-sort="value">Top Value</button>
            <button class="tab-btn" data-sort="volume">Top Vol</button>
            <button class="tab-btn" data-sort="freq">Top Freq</button>
            <button class="tab-btn" data-sort="netbuy">Net F.Buy</button>
            <button class="tab-btn" data-sort="netsell">Net F.Sell</button>
        </div>
        <div class="sidebar-table-wrap">
            <table class="sidebar-table">
                <thead>
                    <tr>
                        <th style="cursor:pointer;" onclick="setSort('symbol')">Sym</th>
                        <th style="cursor:pointer;" onclick="setSort('price')">Price</th>
                        <th style="cursor:pointer;" onclick="setSort('change_percentage')">%Chg</th>
                        <th style="cursor:pointer;" onclick="setSort('value')" title="Value">Val</th>
                        <th style="cursor:pointer;" onclick="setSort('volume')" title="Volume">Vol</th>
                        <th style="cursor:pointer;" onclick="setSort('frequency')" title="Frequency">Frq</th>
                        <th style="cursor:pointer;" onclick="setSort('net_foreign')" title="Net Foreign">N.F.</th>
                    </tr>
                </thead>
                <tbody id="screener-tbody">
                    <!-- Populated by JS -->
                </tbody>
            </table>
        </div>
    </div>
    </div> <!-- main-layout end -->

    <script type="module">
        import { createChart, CandlestickSeries, CrosshairMode } from 'https://esm.sh/lightweight-charts@5.1.0';
        import { 
            createFootprintSeries, 
            clusterOrderFlowBarsByMintick,
            ORDER_FLOW_STYLE_PRESETS,
            ORDER_FLOW_THEME_PRESETS
        } from 'https://esm.sh/lightweight-orderflow-charts@0.2.0?deps=lightweight-charts@5.1.0';

        const chartContainer = document.getElementById('chart-container');
        
        try {
            const chart = createChart(chartContainer, {
                autoSize: true, // Fix for chart not sizing to container automatically
                layout: {
                    background: { color: '#ffffff' }, // White background
                    textColor: '#111',
                },
                grid: {
                    vertLines: { color: '#e1e3e8' }, // Light grid lines
                    horzLines: { color: '#e1e3e8' },
                },
                timeScale: {
                    timeVisible: true,
                    secondsVisible: false,
                },
            });

            
        // =============== SCREENER LOGIC ===============
        let screenerData = [];
        
        const sidebar = document.getElementById('sidebar');
        const screenerTbody = document.getElementById('screener-tbody');
        
        document.getElementById('screener-btn').addEventListener('click', () => {
            if(sidebar.style.display === 'flex') {
                sidebar.style.display = 'none';
            } else {
                sidebar.style.display = 'flex';
                if(screenerData.length === 0) loadScreenerData();
            }
        });

        let sortKey = 'change_percentage';
        let sortDir = 'desc';
        window.setSort = function(key) {
            if (sortKey === key) {
                sortDir = sortDir === 'desc' ? 'asc' : 'desc';
            } else {
                sortKey = key;
                sortDir = 'desc';
            }
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            renderScreener();
        };

        

        document.getElementById("close-sidebar-btn").addEventListener("click", () => { sidebar.style.display = "none"; });


        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                let srt = e.target.getAttribute('data-sort');
                if (srt === 'gainer') { sortKey = 'change_percentage'; sortDir = 'desc'; }
                else if (srt === 'loser') { sortKey = 'change_percentage'; sortDir = 'asc'; }
                else if (srt === 'value') { sortKey = 'value'; sortDir = 'desc'; }
                else if (srt === 'volume') { sortKey = 'volume'; sortDir = 'desc'; }
                else if (srt === 'freq') { sortKey = 'frequency'; sortDir = 'desc'; }
                else if (srt === 'netbuy') { sortKey = 'net_foreign'; sortDir = 'desc'; }
                else if (srt === 'netsell') { sortKey = 'net_foreign'; sortDir = 'asc'; }
                
                document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            renderScreener();
            });
        });

        async function loadScreenerData() {
            try {
                const res = await fetch('screener_data.json');
                screenerData = await res.json();
                document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            renderScreener();
            } catch(e) {
                console.error("Failed to load screener data", e);
            }
        }
        
        function formatNumber(num) {
            if(Math.abs(num) >= 1e9) return (num/1e9).toFixed(1) + 'B';
            if(Math.abs(num) >= 1e6) return (num/1e6).toFixed(1) + 'M';
            if(Math.abs(num) >= 1e3) return (num/1e3).toFixed(1) + 'K';
            return num.toString();
        }

        function renderScreener() {
            let sorted = [...screenerData];
            
            sorted.sort((a, b) => {
                let valA = a[sortKey];
                let valB = b[sortKey];
                if (typeof valA === 'string') {
                    return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                return sortDir === 'asc' ? valA - valB : valB - valA;
            });
            
            // Render top 100 to give plenty of scrollable results
            screenerTbody.innerHTML = sorted.slice(0, 100).map(item => {
                let nfColor = item.net_foreign > 0 ? 'val-pos' : (item.net_foreign < 0 ? 'val-neg' : '');
                let chgColor = item.change_percentage > 0 ? 'val-pos' : (item.change_percentage < 0 ? 'val-neg' : '');

                return `<tr onclick="document.getElementById('ticker-input').value='${item.symbol}'; document.getElementById('ticker-input').dispatchEvent(new Event('change'))">
                    <td>${item.symbol}</td>
                    <td>${item.price}</td>
                    <td class="${chgColor}">${(item.change_percentage||0).toFixed(2)}%</td>
                    <td>${formatNumber(item.value)}</td>
                    <td>${formatNumber(item.volume)}</td>
                    <td>${formatNumber(item.frequency)}</td>
                    <td class="${nfColor}">${formatNumber(item.net_foreign)}</td>
                </tr>`;
            }).join('');
        }
        // ==============================================

            const footprintOptions = {
                ...ORDER_FLOW_STYLE_PRESETS.orderFlowReference.footprint,
                ...ORDER_FLOW_THEME_PRESETS.chartDarkPro.footprint,
                candle: {
                    ...ORDER_FLOW_STYLE_PRESETS.orderFlowReference.footprint.candle,
                    ...ORDER_FLOW_THEME_PRESETS.chartDarkPro.footprint.candle,
                    position: 'middle',
                    showWicks: true,
                    widthRatio: 0.2, // Make it thinner
                },
                style: {
                    ...ORDER_FLOW_STYLE_PRESETS.orderFlowReference.footprint.style,
                    ...ORDER_FLOW_THEME_PRESETS.chartDarkPro.footprint.style,
                    bullishCandleColor: '#4CAF50', // Material Green 500
                    bearishCandleColor: '#FF5252', // Material Red 500
                    candleWickColor: '#888888', // Neutral grey for wicks
                },
                ladder: {
                    ...ORDER_FLOW_STYLE_PRESETS.orderFlowReference.footprint.ladder,
                    ...ORDER_FLOW_THEME_PRESETS.chartDarkPro.footprint.ladder,
                    priceStep: 5, // JELI tick size is 5 (price > 1000)
                }
            };

            const footprintSeries = chart.addCustomSeries(createFootprintSeries(footprintOptions));

            // Create a native candlestick series (hidden by default)
            const nativeCandles = chart.addSeries(CandlestickSeries, {
                upColor: '#4CAF50',
                downColor: '#FF5252',
                borderUpColor: '#4CAF50',
                borderDownColor: '#FF5252',
                wickUpColor: '#4CAF50',
                wickDownColor: '#FF5252',
                visible: false // Hidden initially
            });

            // Toggle Button Logic
            let footprintVisible = true;
            document.getElementById('toggle-btn').addEventListener('click', () => {
                footprintVisible = !footprintVisible;
                footprintSeries.applyOptions({ visible: footprintVisible });
                nativeCandles.applyOptions({ visible: !footprintVisible });
            });

            function getIdxTickSize(price) {
                if (price < 200) return 1;
                if (price < 500) return 2;
                if (price < 2000) return 5;
                if (price < 5000) return 10;
                return 25;
            }

            // Global state to store the raw data so we can access volume
            let currentChartData = [];
            let currentActiveTf = '5m';

            function loadTimeframe(tf) {
                currentActiveTf = tf;
                const ticker = document.getElementById('ticker-input').value.toUpperCase();
                
                fetch(`${ticker}_${tf}.json`)
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        return response.json();
                    })
                    .then(data => {
                        if (!data || data.length === 0) return;
                        
                        currentChartData = data; // Save for crosshair

                        // Dynamically determine the tick size based on the most recent price
                        const lastPrice = data[data.length - 1].close;
                        const dynamicTickSize = getIdxTickSize(lastPrice);

                        nativeCandles.setData(data);

                        // If the data has footprint levels (like our generated 1m/5m/etc files)
                        if (data[data.length - 1] && data[data.length - 1].levels) {
                            footprintSeries.applyOptions({
                                ladder: { priceStep: dynamicTickSize }
                            });
                            const safeData = data.map(d => d.levels ? d : { ...d, levels: [] });
                            const clusteredData = clusterOrderFlowBarsByMintick(safeData, dynamicTickSize, dynamicTickSize);
                            footprintSeries.setData(clusteredData);
                            
                            // Re-enable footprint view if it was hidden
                            document.getElementById('toggle-btn').style.display = 'inline-block';
                            if (footprintVisible) {
                                footprintSeries.applyOptions({ visible: true });
                                nativeCandles.applyOptions({ visible: false });
                            }
                        } else {
                            // This is raw daily data with no footprint
                            footprintSeries.setData([]);
                            footprintSeries.applyOptions({ visible: false });
                            nativeCandles.applyOptions({ visible: true });
                            // Hide the toggle button since there is no footprint to toggle
                            document.getElementById('toggle-btn').style.display = 'none';
                        }
                        
                        chart.timeScale().fitContent();
                    })
                    .catch(err => {
                        console.error("Failed to load tf", tf, err);
                        alert(`Could not find ${tf} data for ${ticker}. Make sure you generated it!`);
                    });
            }

            // Listen for user pressing Enter in the ticker input
            document.getElementById('ticker-input').addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    loadTimeframe(currentActiveTf);
                }
            });

            // Timeframe buttons
            document.querySelectorAll('.tf-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    loadTimeframe(e.target.dataset.tf);
                });
            });

            // Auto Support/Resistance Logic
            let activePriceLines = [];
            const autoSrBtn = document.getElementById('auto-sr-btn');
            
            autoSrBtn.addEventListener('click', () => {
                // If lines are already drawn, clear them and turn off (Toggle OFF)
                if (activePriceLines.length > 0) {
                    activePriceLines.forEach(line => {
                        nativeCandles.removePriceLine(line.native);
                        footprintSeries.removePriceLine(line.footprint);
                    });
                    activePriceLines = [];
                    autoSrBtn.classList.remove('active');
                    return;
                }

                // Otherwise, calculate and draw them (Toggle ON)
                if (!currentChartData || currentChartData.length === 0) return;

                const lookback = 10; // Number of bars to check left and right for a swing high/low
                let resLevels = [];
                let supLevels = [];

                for (let i = lookback; i < currentChartData.length - lookback; i++) {
                    const currentBar = currentChartData[i];
                    
                    // Check Pivot High
                    let isPivotHigh = true;
                    for (let j = 1; j <= lookback; j++) {
                        if (currentChartData[i - j].high > currentBar.high || currentChartData[i + j].high > currentBar.high) {
                            isPivotHigh = false;
                            break;
                        }
                    }
                    if (isPivotHigh) resLevels.push(currentBar.high);

                    // Check Pivot Low
                    let isPivotLow = true;
                    for (let j = 1; j <= lookback; j++) {
                        if (currentChartData[i - j].low < currentBar.low || currentChartData[i + j].low < currentBar.low) {
                            isPivotLow = false;
                            break;
                        }
                    }
                    if (isPivotLow) supLevels.push(currentBar.low);
                }

                // Get the most recent 3 unique resistance and 3 unique support levels
                resLevels = [...new Set(resLevels)].slice(-3);
                supLevels = [...new Set(supLevels)].slice(-3);

                // Draw Resistance Lines (Red)
                resLevels.forEach(price => {
                    const lineOptions = { price: price, color: '#FF5252', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Res' };
                    activePriceLines.push({
                        native: nativeCandles.createPriceLine(lineOptions),
                        footprint: footprintSeries.createPriceLine(lineOptions)
                    });
                });

                // Draw Support Lines (Green)
                supLevels.forEach(price => {
                    const lineOptions = { price: price, color: '#4CAF50', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Sup' };
                    activePriceLines.push({
                        native: nativeCandles.createPriceLine(lineOptions),
                        footprint: footprintSeries.createPriceLine(lineOptions)
                    });
                });

                autoSrBtn.classList.add('active');
            });

            // Enable Magnet Mode crosshair (TradingView style snapping)
            chart.applyOptions({
                crosshair: {
                    mode: CrosshairMode.Magnet,
                }
            });

            // Formatter for large volume numbers (e.g. 15000 -> 15k)
            function formatVolume(vol) {
                if (vol >= 1000000000) return (vol / 1000000000).toFixed(2) + 'B';
                if (vol >= 1000000) return (vol / 1000000).toFixed(2) + 'M';
                if (vol >= 1000) return (vol / 1000).toFixed(1) + 'k';
                return vol.toString();
            }

            // Crosshair Legend Logic (TradingView style Top-Left OHLC + Vol + Extra)
            const legend = document.getElementById('legend');
            chart.subscribeCrosshairMove(param => {
                if (
                    param.point === undefined ||
                    !param.time ||
                    param.point.x < 0 ||
                    param.point.x > chartContainer.clientWidth ||
                    param.point.y < 0 ||
                    param.point.y > chartContainer.clientHeight
                ) {
                    legend.style.display = 'none';
                    return;
                }

                const data = param.seriesData.get(nativeCandles);
                if (!data) {
                    legend.style.display = 'none';
                    return;
                }

                // Find the full bar data to calculate total volume and get extra fields
                const fullBar = currentChartData.find(b => b.time === param.time);
                let totalVolume = 0;
                let extraHtml = '';

                if (fullBar) {
                    if (fullBar.volume !== undefined) {
                        // This is daily CSV data
                        totalVolume = fullBar.volume;
                        
                        const avg = fullBar.average;
                        const val = formatVolume(fullBar.value);
                        const freq = fullBar.frequency;
                        const chg = fullBar.change;
                        const pct = fullBar.change_percentage;
                        const fBuy = formatVolume(fullBar.foreign_buy);
                        const fSell = formatVolume(fullBar.foreign_sell);
                        const netF = formatVolume(fullBar.net_foreign);
                        
                        const chgColor = chg >= 0 ? '#4CAF50' : '#FF5252';
                        const netFColor = fullBar.net_foreign >= 0 ? '#4CAF50' : '#FF5252';

                        extraHtml = `
                            <br>
                            <span style="color: #666; font-size: 12px;">Avg</span> <span class="legend-val" style="font-size: 12px;">${avg}</span>
                            <span style="color: #666; font-size: 12px;">Val</span> <span class="legend-val" style="font-size: 12px;">${val}</span>
                            <span style="color: #666; font-size: 12px;">Freq</span> <span class="legend-val" style="font-size: 12px;">${freq}</span>
                            <span style="color: #666; font-size: 12px;">Chg</span> <span class="legend-val" style="font-size: 12px; color: ${chgColor}">${chg} (${pct}%)</span>
                            <br>
                            <span style="color: #666; font-size: 12px;">F.Buy</span> <span class="legend-val" style="font-size: 12px;">${fBuy}</span>
                            <span style="color: #666; font-size: 12px;">F.Sell</span> <span class="legend-val" style="font-size: 12px;">${fSell}</span>
                            <span style="color: #666; font-size: 12px;">Net.F</span> <span class="legend-val" style="font-size: 12px; color: ${netFColor}">${netF}</span>
                        `;
                    } else if (fullBar.levels) {
                        // This is Footprint Data
                        totalVolume = fullBar.levels.reduce((acc, lvl) => acc + lvl.bidVolume + lvl.askVolume, 0);
                    }
                }

                legend.style.display = 'block';
                
                const O = data.open;
                const H = data.high;
                const L = data.low;
                const C = data.close;
                const color = C >= O ? '#4CAF50' : '#FF5252';

                legend.innerHTML = `
                    <span style="color: #666;">O</span> <span class="legend-val" style="color: ${color}">${O}</span>
                    <span style="color: #666;">H</span> <span class="legend-val" style="color: ${color}">${H}</span>
                    <span style="color: #666;">L</span> <span class="legend-val" style="color: ${color}">${L}</span>
                    <span style="color: #666;">C</span> <span class="legend-val" style="color: ${color}">${C}</span>
                    <span style="color: #666;">Vol</span> <span class="legend-val" style="color: #111;">${formatVolume(totalVolume)}</span>
                    ${extraHtml}
                `;
            });

            // Load initial
            loadTimeframe('5m');
        } catch (err) {
            chartContainer.innerHTML = `<div style="color: red; padding: 20px;">Error initializing chart: ${err.message}</div>`;
            console.error(err);
        }
    </script>
</body>
</html>

```


## How to Update the Chart Data (All-in-One Guide)

We have consolidated the entire data processing workflow into a single bash script (`update_all.sh`). 

Whenever you scrape new EOD data to `~/data/` and new running trades to `JELI_last_month_trades/`, simply run this from the `lightweight-charts-master` folder:

```bash
./update_all.sh
```

**What this script does behind the scenes:**
1. Runs `bulk_convert_daily.py`: Converts all daily EOD data from `~/data/` into standard `*_1d.json` files for the screener and charts.
2. Runs `prepare_data.py JELI_last_month_trades`: Processes the JELI running trades to build footprint charts across all timeframes.
3. Automatically renames `data_*.json` to `JELI_*.json`.
4. Runs `merge_history.py JELI`: Injects the daily EOD metrics (Net Foreign, Value, Volume, etc.) from `~/data/JELI.csv` into `JELI_1d.json`.
5. Runs `build_screener.py`: Compiles the updated metrics for all stocks into `screener_data.json` so the sidebar displays the latest values.

## Latest Session Progress (September 2, 2026)

In this session, we focused on workflow automation, fixing edge-case bugs in the scraping architecture, and attempting a live-data integration.

### 1. Live Data Architecture Experiment (Reverted)
- **Goal:** We attempted to build a live-updating quote feed for all 800+ stocks during market hours without relying on the heavy footprint tick-data (which would be too intensive to scrape for the whole market).
- **Implementation:** We built `live_market_feeder.py` using the `yfinance` library to bulk-download quotes, and injected a `setInterval` loop into `my-footprint-demo.html` to ping the live JSON file every 3 seconds.
- **Result:** The ChromeOS (Crostini) network layer completely locked up and froze. The `yfinance` library's multi-threaded approach attempted to open 500+ simultaneous HTTP connections, overwhelming the local network constraints.
- **Resolution:** We completely uninstalled `yfinance` (`pip3 uninstall yfinance`), deleted the python feeder script, and removed the polling engine from the HTML file to return the environment to a perfectly stable, clean state. Future live-data attempts will strictly use the Stockbit API via single-threaded, controlled requests.

### 2. Scraper Bug Fix (Timezone / Partial Data Caching)
- **The Bug:** `stockbit_running_trade_scraper_v2.py` was failing to update the most recent day (e.g., September 2nd). If a user ran the scraper at noon, a partial CSV was created. If they ran it again at 3 PM, the script saw the file existed and was >500 bytes, so it assumed the day was "finished" and skipped it. This was exacerbated by potential system clock drift (the system thinking it was tomorrow, rendering today a "past" day).
- **The Fix:** We modified the script's `run_scraper` logic. Now, if the requested `target_date` matches `today_str` (the current system day), it **never** skips the file. Instead, it actively deletes the old partial CSV (`expected_path.unlink()`) and re-downloads the entire day's trades to guarantee the user has the absolute latest data.

### 3. All-in-One Data Pipeline (`update_all.sh`)
- **The Problem:** The user had a perfectly functioning but highly manual 5-step process to compile the final charts.
- **The Solution:** We created a master bash script (`update_all.sh`) that automates the entire daily data update process into a single command:
  1. `python3 bulk_convert_daily.py`: Scans `~/data/` and converts all EOD CSVs into `*_1d.json` files, preserving extended metrics (Net Foreign, Value, Volume, etc.) across thousands of historical candles for all stocks.
  2. `python3 prepare_data.py JELI_last_month_trades`: Compiles the raw running trade CSVs for JELI into 1m, 5m, 15m, and 1h footprint JSONs.
  3. **File Renaming:** Automatically maps the hardcoded `data_*.json` outputs from `prepare_data.py` to `JELI_*.json`.
  4. `python3 merge_history.py JELI`: Takes the newly generated footprint JSON and injects the EOD metrics from `~/data/JELI.csv` so the 1D footprint chart contains accurate volume and net foreign data.
  5. `python3 build_screener.py`: Iterates over every single `*_1d.json` file in the folder, extracts the latest day's metrics, and rebuilds `screener_data.json` to instantly update the UI sidebar.

### 4. Auto Support and Resistance (S/R) Feature
- **Where it lives:** Built directly into the `my-footprint-demo.html` UI (triggered by the "Auto S/R" button).
- **How it works (The JavaScript Logic):** 
  - It scans the currently loaded chart data using a 10-bar lookback window to identify structural Pivot Highs and Pivot Lows.
  - A Pivot High (Resistance) is defined as a candle whose high is strictly greater than the highs of the 10 candles before it and the 10 candles after it.
  - A Pivot Low (Support) is defined as a candle whose low is strictly lower than the lows of the 10 candles before it and the 10 candles after it.
  - The script extracts the 3 most recent unique Resistance levels and 3 most recent unique Support levels.
- **Visuals:** 
  - Draws Resistance lines in **Red** (`#FF5252`, dashed) across both the candlestick chart and footprint chart.
  - Draws Support lines in **Green** (`#4CAF50`, dashed) across both charts.
- **Agent Note:** Because the AI cannot "see" the UI, if the user asks for S/R levels, the agent must run the same 10-bar lookback math on the JSON data to know what lines the Javascript is rendering on the screen.

### 5. UI Architecture & Layout (my-footprint-demo.html)
- **Screener Sidebar Toggle:** 
  - The screener is designed as a collapsible sidebar on the left rather than a permanent page split.
  - When toggled **ON**, the screener takes up exactly 25% of the screen width, and the charts resize to 75%.
  - When toggled **OFF**, the screener hides entirely, and the charts dynamically expand back to 100% full-screen width.
- **Screener Sorting & Presets (Tabs vs Headers):**
  - **Tabs (Presets):** Function as pre-configured "Screener Types" (e.g., Top Volume, Top Value, Top Foreign). Clicking a tab instantly filters and sorts the table based on that specific strategy.
  - **Clickable Headers (Manual Sort):** The table headers (`Price`, `Vol`, `Val`, `N.For`, etc.) are clickable, allowing the user to manually override the active tab's sort and organize the data ascending/descending by any specific metric.
- **Data Source:** The screener populates its table directly from `screener_data.json`, which is rebuilt daily by `build_screener.py` using the extended metrics injected from the EOD data.

### 6. Ajaib Running Trade Scraper Integration
- **The Problem:** Stockbit's running trade API strictly limits historical intraday data, returning empty arrays (`[]`) when querying dates prior to "today". This broke our ability to scrape footprint history.
- **The Solution:** We migrated the running trade scraping architecture to **Ajaib** (`ajaib_running_trade_scraper.py`).
- **Implementation Details:**
  - **Reverse Pagination:** Ajaib's API paginates backwards from `last_timestamp`. We generate the current millisecond timestamp (`time.time() * 1000`) and loop `page=1`, `page=2`, etc., until we hit the morning open.
  - **Data Mapping:** The script automatically reverses the JSON array to chronological order and maps Ajaib's proprietary keys (e.g., `buyer_type` "D") into the exact same Stockbit CSV format we previously used (`BROKER_TYPE_LOCAL`), ensuring perfect backwards compatibility with `prepare_data.py`.
  - **Security:** Ajaib JWT tokens expire strictly in 15 minutes. The script requires pasting a fresh token before execution.

### 7. Multi-Ticker Orchestration (`update_all.sh`)
- **The Problem:** The original `update_all.sh` was hardcoded to process only the `JELI` footprint folder. The user needed it to support the new `KAQI` Ajaib footprint data simultaneously.
- **The Solution:** We refactored `update_all.sh` to use a bash function `process_ticker()`. It now seamlessly loops through multiple folders:
  ```bash
  process_ticker "JELI" "JELI_last_month_trades"
  process_ticker "KAQI" "KAQI_running_trades"
  ```
  It processes footprints for both tickers, merges their daily histories from `~/data/`, and cleanly updates the global screener in one go.

### 8. Historical EOD Footprint Plugin Crash Fix
- **The Problem:** We merge years of historical EOD CSV data into the 1D footprint JSON (`KAQI_1d.json`). These older candles do not have intraday `.levels` (footprints). The `lightweight-orderflow-charts` plugin (`clusterOrderFlowBarsByMintick`) crashed when iterating over bars with missing `.levels`, which completely blanked out the 1D chart.
- **The Fix:** We modified `my-footprint-demo.html` to inject empty level arrays into historical data before passing it to the plugin:
  ```javascript
  const safeData = data.map(d => d.levels ? d : { ...d, levels: [] });
  const clusteredData = clusterOrderFlowBarsByMintick(safeData, ...);
  ```
  Additionally, the "Toggle Footprint" button visibility check was updated to inspect `data[data.length - 1].levels` (the most recent day) rather than `data[0]` (the oldest day from 2010), ensuring the button accurately appears for stocks that have footprints today.

### `update_all.sh`
```bash
#!/bin/bash
set -e

echo "=== Step 1: Converting all daily EOD data to JSON ==="
python3 bulk_convert_daily.py

process_ticker() {
    TICKER=$1
    FOLDER=$2
    if [ -d "$FOLDER" ]; then
        echo "=== Step 2: Generating footprint data for $TICKER ==="
        python3 prepare_data.py "$FOLDER"
        
        echo "=== Step 3: Renaming footprint files for $TICKER ==="
        mv data_1m.json ${TICKER}_1m.json
        mv data_5m.json ${TICKER}_5m.json
        mv data_15m.json ${TICKER}_15m.json
        mv data_1h.json ${TICKER}_1h.json
        mv data_1d.json ${TICKER}_1d.json
        
        echo "=== Step 4: Merging EOD metrics into $TICKER footprints ==="
        python3 merge_history.py "$TICKER"
    else
        echo "Warning: Folder $FOLDER not found. Skipping footprint processing for $TICKER."
    fi
}

# Proses JELI dan KAQI secara berurutan
process_ticker "JELI" "JELI_last_month_trades"
process_ticker "KAQI" "KAQI_running_trades"

echo "=== Step 5: Rebuilding Screener ==="
python3 build_screener.py

echo "=== ALL DONE! ==="
```

### `bulk_convert_daily.py`
```python
import os
import csv
import json
import glob

data_dir = "data"
out_dir = "/home/hasibrahmat2/lightweight-charts-master"

csv_files = glob.glob(os.path.join(data_dir, "*.csv"))

for csv_file in csv_files:
    ticker = os.path.basename(csv_file).replace('.csv', '')
    output_file = os.path.join(out_dir, f"{ticker}_1d.json")
    
    output = []
    try:
        with open(csv_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    bar = {
                        "time": row['date'],
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                    }
                    
                    # Add extra fields if they exist and are valid numbers
                    def safe_float(val):
                        try:
                            return float(val)
                        except:
                            return 0.0

                    if 'average' in row: bar['average'] = safe_float(row['average'])
                    if 'volume' in row: bar['volume'] = safe_float(row['volume'])
                    if 'value' in row: bar['value'] = safe_float(row['value'])
                    if 'frequency' in row: bar['frequency'] = safe_float(row['frequency'])
                    if 'change' in row: bar['change'] = safe_float(row['change'])
                    if 'change_percentage' in row: bar['change_percentage'] = safe_float(row['change_percentage'])
                    if 'foreign_buy' in row: bar['foreign_buy'] = safe_float(row['foreign_buy'])
                    if 'foreign_sell' in row: bar['foreign_sell'] = safe_float(row['foreign_sell'])
                    if 'net_foreign' in row: bar['net_foreign'] = safe_float(row['net_foreign'])
                    
                    output.append(bar)
                except Exception as e:
                    continue
                    
        # Only save if we got data
        if output:
            with open(output_file, 'w') as f:
                json.dump(output, f)
            print(f"Converted {ticker} ({len(output)} candles with extended data)")
    except Exception as e:
        print(f"Error processing {ticker}: {e}")

print("Bulk conversion complete!")
```

### `merge_history.py`
```python
import json
import csv
import sys
import os
import datetime

def get_ymd(ts):
    dt = datetime.datetime.utcfromtimestamp(ts)
    return dt.strftime("%Y-%m-%d")

def merge_history(ticker):
    csv_file = f"data/{ticker}.csv"
    json_file = f"{ticker}_1d.json"
    
    if not os.path.exists(csv_file):
        print(f"Error: {csv_file} not found.")
        return
        
    merged = {}
    
    # 1. Load footprint JSON data FIRST
    json_count = 0
    if os.path.exists(json_file):
        print(f"Loading footprint data from {json_file}...")
        with open(json_file, 'r') as f:
            try:
                footprint_data = json.load(f)
                for item in footprint_data:
                    ymd = get_ymd(item['time'])
                    if ymd not in merged or 'levels' in item:
                        merged[ymd] = item
                    json_count += 1
            except Exception as e:
                print(f"Warning: Could not parse {json_file}")
                
    # 2. Load historical CSV data and merge fields
    print(f"Loading historical data from {csv_file}...")
    with open(csv_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                ymd = row['date']
                dt = datetime.datetime.strptime(ymd, "%Y-%m-%d").replace(hour=12) 
                ts = int(dt.timestamp())
                
                # If we don't have it, create it
                if ymd not in merged:
                    merged[ymd] = {
                        "time": ts,
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                    }
                
                # In ALL cases (whether it existed in JSON or not), inject the missing daily metrics!
                merged[ymd]["volume"] = float(row.get('volume', 0))
                merged[ymd]["value"] = float(row.get('value', 0))
                merged[ymd]["frequency"] = float(row.get('frequency', 0))
                merged[ymd]["change"] = float(row.get("change", 0))
                merged[ymd]["change_percentage"] = float(row.get('change_percentage', 0))
                merged[ymd]["net_foreign"] = float(row.get('net_foreign', 0))
                merged[ymd]["foreign_buy"] = float(row.get('foreign_buy', 0))
                merged[ymd]["foreign_sell"] = float(row.get('foreign_sell', 0))
                if 'average' in row:
                    merged[ymd]["average"] = float(row.get('average', 0))
                
            except Exception as e:
                pass
                
    # 3. Sort by time and save back to JSON
    sorted_data = sorted(list(merged.values()), key=lambda x: x['time'])
    
    with open(json_file, 'w') as f:
        json.dump(sorted_data, f)
        
    print(f"\nSuccess! Merged {ticker} data.")
    print(f"Total days in final chart: {len(sorted_data)}")
    print(f"Saved to {json_file}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 merge_history.py <TICKER>")
    else:
        merge_history(sys.argv[1].upper())
```

### `build_screener.py`
```python
import json
import glob
import os

def build_screener():
    screener_data = []
    
    # Find all 1d json files
    for filepath in glob.glob("*_1d.json"):
        filename = os.path.basename(filepath)
        symbol = filename.replace("_1d.json", "")
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                
            if not data:
                continue
                
            # Get the latest day's data
            latest = data[-1]
            
            screener_data.append({
                "symbol": symbol,
                "price": latest.get("close", 0),
                "change_percentage": latest.get("change_percentage", 0),
                "value": latest.get("value", 0),
                "volume": latest.get("volume", 0),
                "frequency": latest.get("frequency", 0),
                "net_foreign": latest.get("net_foreign", 0)
            })
        except Exception as e:
            print(f"Error processing {filename}: {e}")
            
    # Write to screener_data.json
    with open("screener_data.json", 'w') as f:
        json.dump(screener_data, f)
        
    print(f"Successfully generated screener_data.json with {len(screener_data)} symbols!")

if __name__ == "__main__":
    build_screener()
```

### `ajaib_running_trade_scraper.py` (Located in ~/trading_script/tools/)
```python
import sys
import json
import urllib.request
import getpass
import argparse
import time
import csv
from pathlib import Path

def format_value(val):
    if val >= 1_000_000_000:
        return f"{val/1_000_000_000:.1f}B"
    elif val >= 1_000_000:
        return f"{val/1_000_000:.1f}M"
    elif val >= 1_000:
        return f"{val/1_000:.1f}K"
    return str(val)

def main():
    parser = argparse.ArgumentParser(description="Ajaib Running Trade Scraper")
    parser.add_argument("symbol", help="Kode saham (contoh: KAQI)")
    parser.add_argument("-o", "--output-dir", default=".", help="Folder output")
    parser.add_argument("--delay", type=float, default=0.55, help="Delay per page")
    args = parser.parse_args()

    token = getpass.getpass("Token Ajaib (dimulai dengan eyJ...): ").strip()
    if not token:
        print("Token kosong.")
        return

    if token.lower().startswith("jwt "):
        token = token[4:]
    elif token.lower().startswith("bearer "):
        token = token[7:]

    symbol = args.symbol.upper()
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    current_date = time.strftime("%Y-%m-%d")
    out_file = out_dir / f"running_trade_{symbol}_{current_date}.csv"
    
    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Authorization': f'jwt {token}',
        'Origin': 'https://trade.ajaib.co.id',
        'Referer': 'https://trade.ajaib.co.id/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'X-App-Mode': 'PRO',
        'X-Platform': 'WEB',
        'X-Product': 'stock-mf'
    }

    start_timestamp = int(time.time() * 1000)
    page = 1
    page_size = 80
    
    all_trades = []
    
    print(f"\nMengunduh data Ajaib untuk {symbol} hari ini ({current_date})...")
    
    while True:
        url = f"https://ht2.ajaib.co.id/api/v1/stock/detail/{symbol}/running_trades/?direction=DESC&last_timestamp={start_timestamp}&page={page}&page_size={page_size}"
        req = urllib.request.Request(url, headers=headers)
        
        try:
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
                results = data.get("results", [])
                
                if not results:
                    break
                    
                all_trades.extend(results)
                print(f"Halaman {page} | diterima {len(results)} | total sementara {len(all_trades)} | waktu paling lama {results[-1]['time']}", flush=True)
                
                page += 1
                time.sleep(args.delay)
                
        except Exception as e:
            print(f"Error pada halaman {page}: {e}")
            break

    if not all_trades:
        print("Tidak ada data ditemukan.")
        return
        
    print(f"\nMembalikkan urutan {len(all_trades)} baris agar kronologis...")
    all_trades.reverse()
    
    csv_headers = [
        "date", "time", "code", "id", "trade_number", "price", "change", "change_val", 
        "action", "lot", "volume", "value", "value_formatted", "buyer", "buyer_type", 
        "seller", "seller_type", "market_board", "buy_order_number", "sell_order_number", 
        "group_order_number", "is_broker_exists"
    ]
    
    print(f"Menyimpan ke {out_file}...")
    with open(out_file, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(csv_headers)
        for t in all_trades:
            # Format pemetaan Stockbit
            date = t.get("date", "")
            time_str = t.get("time", "")
            code = t.get("stock_code", symbol)
            trade_num = str(t.get("trade_num", ""))
            price = t.get("price", 0)
            change = f"{t.get('return_pct', 0)}%"
            action = str(t.get("side", "")).lower()
            lot = t.get("lot", 0)
            volume = lot * 100
            value = volume * price
            
            buyer = f"{t.get('buyer', '')} [D]" if t.get("buyer_type") == "D" else f"{t.get('buyer', '')} [F]"
            seller = f"{t.get('seller', '')} [D]" if t.get("seller_type") == "D" else f"{t.get('seller', '')} [F]"
            b_type = "BROKER_TYPE_LOCAL" if t.get("buyer_type") == "D" else "BROKER_TYPE_FOREIGN"
            s_type = "BROKER_TYPE_LOCAL" if t.get("seller_type") == "D" else "BROKER_TYPE_FOREIGN"
            
            writer.writerow([
                date, time_str, code, trade_num, trade_num, price, change, "", 
                action, lot, volume, value, format_value(value), buyer, b_type, 
                seller, s_type, t.get("market_type", "RG"), "", "", "", "true"
            ])
            
    print("\nSELESAI!")
    print(f"Berhasil menyimpan {len(all_trades)} trades ke {out_file}")

if __name__ == "__main__":
    main()
```

## 9. Stockbit Scraper Stealth Ban Fixes & Automation
When pulling heavy historical running trade data using Stockbit, they enforce a "Stealth Ban" rate limit. This happens exactly after 3 requests in a row (~240 trades). Rather than giving an HTTP 429 error, the API silently returns an empty array `[]` to trick the scraper into thinking the day has finished early.

**Fixes Applied to `stockbit_running_trade_scraper_v2.py`:**
1. **60-Second Retry Trick:** When the script receives an empty array, it now pauses for 60 seconds and tries again. This successfully bypasses the Stockbit penalty box without crashing.
2. **Automatic Day-Rolling:** The script loops the 60-second retry up to 5 times. If it fails 5 times in a row, it automatically assumes the day naturally ended (at 08:55 AM) or is a holiday, and cleanly moves to the next day without asking for user `y/N` input. This allows you to leave the script running overnight while you sleep.
3. **Preventing `_2` File Duplication:** Previously, if a day failed and left a corrupted file under 500 bytes, the script would avoid skipping it, but mistakenly save the fresh data as `_2.csv`. This was fixed by forcing the script to overwrite the corrupt file instead. 
4. **Environment Variable Tokens:** Because `getpass.getpass()` halts the terminal waiting for manual input, chaining months together using `&&` would cause the script to freeze. We modified the script to accept a `STOCKBIT_TOKEN` environment variable so you can queue multiple months sequentially completely hands-free.

**How to run multiple months automatically overnight:**
```bash
read -s -p "Tempel Token Stockbit: " STOCKBIT_TOKEN && export STOCKBIT_TOKEN && echo "" && \
python3 stockbit_running_trade_scraper_v2.py KAQI --month 2026-07 --output-dir KAQI_running_trades && \
python3 stockbit_running_trade_scraper_v2.py KAQI --month 2026-08 --output-dir KAQI_running_trades && \
python3 stockbit_running_trade_scraper_v2.py KAQI --month 2026-09 --output-dir KAQI_running_trades
```

## 11. TypeScript Migration & Stockbit UI Upgrade

### UI/UX Refinements (Stockbit & TradingView Clone)
- **Global Font**: Integrated the **'Inter'** Google Font with antialiasing for a softer, modern, professional fintech aesthetic.
- **Screener Horizontal Tabs**: Modified the `.sidebar-tabs` to be a horizontally scrollable container (`overflow-x: auto`, `flex-wrap: nowrap`) to match modern app designs.
- **Dropdown Menus**: 
  - Added a pinned "⋮" (More Options) button next to the screener tabs with a floating dropdown menu for future filtering capabilities.
  - Added an "Indicators ▾" dropdown button to the main toolbar to toggle technical overlays.
- **Input Styling**: Centered the lookback period (`#tl-period`) text by completely hiding the native browser spinner arrows (`::-webkit-inner-spin-button`) and applying a subtle TradingView-like background (`#f0f3fa`).

### Architecture: TypeScript Migration (`my-footprint-ts`)
To leverage the official TradingView lightweight-charts indicator plugins (which are written in strictly-typed TypeScript and require bundling), the vanilla HTML project was cloned into the `indicator-examples` Vite ecosystem.
- **Directory Structure**: Created `src/my-footprint-ts/` with `index.html` and extracted the JavaScript into `main.ts`.
- **Package Management**: Installed `lightweight-orderflow-charts` natively via `npm install` and transitioned from CDN (`esm.sh`) to local Node imports.
- **Static Asset Serving**: Migrated all raw `*.json` stock data files to the `public/` folder so the Vite dev server can serve them at the root path (`/`).
- **Server Address**: The TypeScript sandbox is now accessible locally via `http://localhost:5175/src/my-footprint-ts/`.

### TradingView Native Indicator Plugins Integrated
- **Moving Average & Median Price**: Directly imported `calculateMovingAverageIndicatorValues` and `calculateMedianPriceIndicatorValues` from the TV example plugins.
- **Dynamic Calculation**: Linked the Moving Average `length` parameter to the user's `tl-period` input box. Changing the input (e.g., from 20 to 50) instantly recalculates the MA data and dynamically updates the series and dropdown UI labels to `SMA (50)`.

### Bugs Encountered & Fixed
1. **JSON Fetch 404 in TS Server**: 
   - *Bug*: Relative fetches (`fetch('screener_data.json')`) failed in the nested Vite directory. 
   - *Fix*: Prefixed paths with a slash (`/screener_data.json`) to target Vite's `public/` directory and changed the default ticker to `KAQI` to ensure out-of-the-box data loads.
2. **Indicator Silent Crash (String Timestamps)**:
   - *Bug*: Loading `1d` data (like `BUMI_1d.json`) passed string timestamps (e.g., `"2003-01-01"`) to the TV indicator plugins. The plugin's `ensureTimestampData` helper strictly threw an error for non-numeric times, silently crashing the indicator calculation and freezing the MA line.
   - *Fix*: Added a normalization loop to parse date strings into standard UNIX numeric timestamps before passing data to the plugins (`Math.floor(new Date(d.time).getTime() / 1000)`).
3. **Candles Rendering as Vertical Lines (Barcode Effect)**:
   - *Bug*: Loading a long history (e.g., 5000+ daily candles) and applying `chart.timeScale().fitContent()` compressed the candles so tightly they rendered as 1px vertical lines.
   - *Fix*: Replaced `fitContent()` with `setVisibleLogicalRange()` mathematically calculated to only display the most recent 150 candles by default upon loading a new stock.
4. **Visual "Bug" - SMA Line Length**:
   - *Clarification*: The user noted the MA line "doesn't reach the edge". Explained that mathematically, an SMA 20 requires 19 blank periods at the beginning (left edge), and visually, lines are drawn connecting the *center* of the x-axis time coordinate, which leaves empty space on the right side of a wide footprint box.
