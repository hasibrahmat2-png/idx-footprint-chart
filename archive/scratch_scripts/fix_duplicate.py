import re
with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    text = f.read()

# Replace unique_output_paths to just return the paths without the while loop
new_func = """def unique_output_paths(output_dir: Path, symbol: str, market_date: str) -> Tuple[Path, Path]:
    safe_date = re.sub(r"[^0-9-]", "-", market_date) or datetime.now().strftime("%Y-%m-%d")
    stem = f"running_trade_{symbol}_{safe_date}"
    
    final_path = output_dir / f"{stem}.csv"
    partial_path = output_dir / f"{stem}.partial.csv"
    
    # Overwrite by default. If a previous run failed and left a < 500 byte file, we will just overwrite it.
    return final_path, partial_path"""

text = re.sub(r"def unique_output_paths.*?return final_path, partial_path\n\s+counter \+= 1", new_func, text, flags=re.DOTALL)

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(text)

