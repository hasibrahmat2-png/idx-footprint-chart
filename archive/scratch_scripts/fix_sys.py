import re
with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    text = f.read()

text = text.replace("import sys\n                    setattr(sys.modules", "setattr(sys.modules")

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(text)

