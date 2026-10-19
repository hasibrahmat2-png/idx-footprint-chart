import re
with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    text = f.read()

new_loop = """            for day in range(1, num_days + 1):
                date_obj = datetime(year, month, day)
                if date_obj.weekday() >= 5:
                    continue
                if date_obj.date() > datetime.today().date():
                    print(f"\\n[!] {date_obj.date()} ada di masa depan. Menghentikan scraping untuk bulan ini.")
                    break"""

text = re.sub(r"\s*for day in range\(1, num_days \+ 1\):\n\s+date_obj = datetime\(year, month, day\)\n\s+if date_obj\.weekday\(\) >= 5:\n\s+continue", "\n" + new_loop, text)

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(text)

