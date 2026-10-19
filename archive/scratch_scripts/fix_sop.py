with open('Daily_SOP.md', 'r') as f:
    sop = f.read()

# Replace relative python commands with absolute paths
sop = sop.replace(
    "python3 stockbit_daily_historical_scraper.py", 
    "python3 /home/hasibrahmat2/lightweight-charts-master/stockbit_daily_historical_scraper.py"
)
sop = sop.replace(
    "python3 stockbit_intraday_scraper.py", 
    "python3 /home/hasibrahmat2/lightweight-charts-master/stockbit_intraday_scraper.py"
)
sop = sop.replace(
    "python3 stockbit_running_trade_scraper_v2.py", 
    "python3 /home/hasibrahmat2/lightweight-charts-master/stockbit_running_trade_scraper_v2.py"
)
sop = sop.replace(
    "./update_all.sh", 
    "bash /home/hasibrahmat2/lightweight-charts-master/update_all.sh"
)

# And in Step 3
sop = sop.replace(
    "cd indicator-examples\nnpm run dev -- --host",
    "cd /home/hasibrahmat2/lightweight-charts-master/indicator-examples\nnpm run dev -- --host"
)

with open('Daily_SOP.md', 'w') as f:
    f.write(sop)
