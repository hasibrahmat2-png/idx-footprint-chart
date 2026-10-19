with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if "raw_token = os.environ.get" in line:
        new_lines.append(line)
        continue
    if "if not raw_token:" in line:
        new_lines.append(line)
        continue
    if "raw_token = getpass.getpass(" in line:
        new_lines.append(line)
        skip = True
        continue
    
    if skip:
        new_lines.append(line)
        if '): "' in line:
            new_lines.pop()
        if ')' in line:
            skip = False
        continue

    new_lines.append(line)

# Let's just do a clean rewrite from scratch for that section
