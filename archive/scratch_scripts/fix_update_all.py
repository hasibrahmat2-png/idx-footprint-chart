import re
with open("update_all.sh", "r") as f:
    text = f.read()

text = text.replace('process_ticker "JELI" "JELI_last_month_trades"', 'process_ticker "JELI" "JELI_running_trades"')

with open("update_all.sh", "w") as f:
    f.write(text)

