# Daily Historical Scraper Walkthrough

We've successfully built a new scraper script to fetch daily historical data for IHSG stocks from Stockbit! 

## Changes Made
- Created a new script: `stockbit_daily_historical_scraper.py`
- Implemented robust error handling, rate-limiting, and an interactive Stockbit token prompt.
- Designed an **Incremental Update** system:
  - The script relies entirely on Stockbit's backwards chronological pagination instead of complex date queries.
  - When you run the script, it asks Stockbit for data starting from "today" backwards.
  - As soon as the script encounters a date that has already been saved to the CSV in a previous run, it automatically stops fetching.
  - This perfectly handles updating thousands of stocks simultaneously by only pulling down precisely what's missing since the last time you ran it.

## What Was Tested
- Initial download for `JELI` without existing data, fetching all available historical data from `end_date` backwards.
- Verified that HTTP 400 errors from sending an out-of-bounds `start_date` were fully resolved by removing `start_date` entirely.

## Validation Results
- The script successfully completed its run and generated `JELI.csv` with the correct JSON fields mapped into CSV columns.
- The CSV merges and sorts correctly to keep chronological order intact even though the API returns descending order. 

## How to run it going forward
To fetch data for a single symbol:
```bash
python3 ~/trading_script/tools/stockbit_daily_historical_scraper.py --symbol JELI
```

To fetch data for all symbols listed in a CSV file (e.g. `ihsg_list.csv`):
```bash
python3 ~/trading_script/tools/stockbit_daily_historical_scraper.py --symbols-file ~/trading_script/data/ihsg_list.csv
```

All data will be saved inside the `data/` folder in your current directory!
