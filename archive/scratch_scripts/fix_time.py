import re
with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    text = f.read()

text = text.replace("import time\n                            time.sleep(60)", "time.sleep(60)")

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(text)

