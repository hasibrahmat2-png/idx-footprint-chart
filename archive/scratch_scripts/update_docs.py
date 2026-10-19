import re

# Update Daily_SOP.md
with open('Daily_SOP.md', 'r') as f:
    sop = f.read()

sop = sop.replace('http://localhost:5175/src/my-footprint-ts/', 'http://localhost:5173/src/my-footprint-ts/')
sop = sop.replace('calculate footprint bars, merge EOD metrics, and **move all data seamlessly to the new TypeScript server folder**.', 'calculate footprint bars, merge EOD metrics, and **generate pristine JSON files directly into the TypeScript public folder**.')

with open('Daily_SOP.md', 'w') as f:
    f.write(sop)

# Update footprint_ts_record.md
with open('footprint_ts_record.md', 'r') as f:
    rec = f.read()

section_3_old = """### Scripts Updated
1.  **`update_all.sh`**: Added a new Step 4.5 that executes:
    `mv *.json indicator-examples/public/ 2>/dev/null || true`
2.  **`build_screener.py`**: Modified to read `*_1d.json` directly from `indicator-examples/public/` and output `screener_data.json` to the same public folder.
3.  **`live_feeder.py`**: Modified to save real-time data directly to `indicator-examples/public/live_{symbol}.json`.

### How to Run Data Updates
```bash
# From the root directory:
cd /home/hasibrahmat2/lightweight-charts-master/
./update_all.sh
```
This single command triggers the EOD bulk conversion, builds all footprint aggregations, moves the JSON files to the Vite public folder, and rebuilds the Screener JSON."""

section_3_new = """### Scripts Updated
1.  **`build_unified_charts.py`**: A highly optimized pipeline script that reads raw CSVs from `data/`, `data_intraday/`, and `*_running_trades/`, and generates fully merged OHLCV + Footprint JSON files directly into `indicator-examples/public/`.
2.  **`build_screener.py`**: Modified to read `*_1d.json` directly from `indicator-examples/public/` and output `screener_data.json` to the same public folder.
3.  **`update_all.sh`**: Simplified to only run the above two python scripts.

### How to Run Data Updates
```bash
# From the root directory:
cd /home/hasibrahmat2/lightweight-charts-master/
python3 build_unified_charts.py
python3 build_screener.py
```
*(Or simply run `./update_all.sh`)*"""

rec = rec.replace(section_3_old, section_3_new)

# Add timezone documentation
tz_doc = """
---

## 9. Timezone & Volume Fixes (True UTC vs Fake UTC)

### A. The "Volume vs Lot" Bug
Initially, the unified script misread the intraday data by extracting `volume` (shares) instead of `lot`. Since 1 Lot = 100 Shares on the IDX, all intraday footprints and resampled volumes (5m, 15m, 1h) were inflated by a factor of 100. This caused the frontend plugin to crash.
* **Fix**: The script now correctly checks for `row['lot']` or mathematically divides `row['volume'] / 100` if the lot column is missing.

### B. The "Timezone Shift" Bug
Previously, the vanilla HTML relied on **Fake UTC** (Python parsed `08:58 WIB` as `08:58 UTC`). When the chart was opened on a computer in Jakarta, it added 7 hours and displayed `15:58`.
* **Fix 1 (Backend)**: The Python script now subtracts `25200` seconds from the generated Unix timestamps. This strictly guarantees that the JSON contains **True UTC** timestamps (e.g. `08:58 WIB` is saved as `01:58 UTC`).
* **Fix 2 (Frontend)**: The UI (`main.ts`) has been permanently forced to use the Jakarta timezone via `localization: { timezone: 'Asia/Jakarta' }`. This ensures the chart will **always** convert the True UTC timestamp exactly back to `08:58`, regardless of whether the user's computer is physically located in Jakarta, Egypt, or anywhere else in the world.
"""

if "## 9. Timezone & Volume Fixes" not in rec:
    rec += tz_doc

with open('footprint_ts_record.md', 'w') as f:
    f.write(rec)
