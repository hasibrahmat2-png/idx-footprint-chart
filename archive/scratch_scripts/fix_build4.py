import re

with open('build_unified_charts.py', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "daily_candles[ts] = {" in line:
        # The volume line is around i+6
        for j in range(i, i+15):
            if '"volume": float(row.get(\'lot\'' in lines[j]:
                lines[j] = lines[j].replace("float(row.get('lot', row.get('volume', 0) / 100))", "float(row.get('volume', 0))")
                break
        break

with open('build_unified_charts.py', 'w') as f:
    f.writelines(lines)
