import re
with open('stockbit_intraday_scraper.py', 'r') as f:
    content = f.read()

# Fix the broken string
content = re.sub(r'print\(f\"\\n\n=== Memproses saham: \{symbol\} ===\"\)', r'print(f"\\n=== Memproses saham: {symbol} ===")', content)

with open('stockbit_intraday_scraper.py', 'w') as f:
    f.write(content)
