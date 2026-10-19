import re
with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    text = f.read()

text = text.replace("except urllib.error.URLError as error:", "except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:")

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(text)

