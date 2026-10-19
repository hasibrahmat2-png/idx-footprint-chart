import re

with open('footprint_ts_record.md', 'r') as f:
    rec = f.read()

# Let's just use regex to replace everything between "## 3. Python Data Pipeline Integrations (Update)" and "---"
pattern = r"(## 3\. Python Data Pipeline Integrations \(Update\)).*?(?=\n---)"
replacement = """## 3. Python Data Pipeline Integrations (Update)

To connect the legacy Python data scraper scripts to this new TypeScript environment, the pipeline was completely unified. Previous scripts (`bulk_convert_daily.py`, `prepare_data.py`) have been deprecated and replaced by a single, ultra-efficient processor: **`build_unified_charts.py`**.

### Scripts Updated
1.  **`build_unified_charts.py`**: A highly optimized pipeline script that reads raw CSVs from `data/`, `data_intraday/`, and `*_running_trades/`, and generates fully merged OHLCV + Footprint JSON files directly into `indicator-examples/public/`.
2.  **`build_screener.py`**: Modified to read `*_1d.json` directly from `indicator-examples/public/` and output `screener_data.json` to the same public folder.
3.  **`update_all.sh`**: Simplified to only run the above two python scripts.

### How to Run Data Updates
```bash
bash /home/hasibrahmat2/lightweight-charts-master/update_all.sh
```
This single command triggers the EOD bulk conversion, builds all footprint aggregations, and outputs pristine JSON files directly to the Vite public folder."""

rec = re.sub(pattern, replacement, rec, flags=re.DOTALL)

with open('footprint_ts_record.md', 'w') as f:
    f.write(rec)
