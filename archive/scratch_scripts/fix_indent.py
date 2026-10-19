with open('build_unified_charts.py', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'daily_candles[ts] = {' in line:
        lines[i] = '                    daily_candles[ts] = {\n'
        break

with open('build_unified_charts.py', 'w') as f:
    f.writelines(lines)
