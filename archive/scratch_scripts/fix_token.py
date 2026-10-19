import re
with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    text = f.read()

new_token_logic = """        raw_token = os.environ.get("STOCKBIT_TOKEN")
        if not raw_token:
            raw_token = getpass.getpass(
                "Tempel token Authorization/Bearer (teks tidak akan terlihat): "
            )"""

text = re.sub(r"\s*raw_token = getpass\.getpass\(.*?\)", "\n" + new_token_logic, text, flags=re.DOTALL)

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(text)

