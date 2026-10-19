with open("scrape_all_history.sh", "r") as f:
    text = f.read()

import re

# Remove the hardcoded STOCKS
text = re.sub(r'STOCKS=\("KAQI" "JELI" "BBCA" "ASII"\)\s*', "", text)

# Insert the read prompt for stocks
new_prompt = """read -p "Masukkan daftar saham (pisahkan dengan spasi, contoh: KAQI BBCA): " input_stocks
read -s -p "Tempel Token Stockbit: " STOCKBIT_TOKEN
export STOCKBIT_TOKEN
echo ""

# Convert input string into array
read -a STOCKS <<< "$input_stocks"
"""

text = re.sub(r'read -s -p "Tempel Token Stockbit: " STOCKBIT_TOKEN\nexport STOCKBIT_TOKEN\necho ""\n', new_prompt, text)

with open("scrape_all_history.sh", "w") as f:
    f.write(text)

