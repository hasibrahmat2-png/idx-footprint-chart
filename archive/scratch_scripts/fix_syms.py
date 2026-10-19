with open('build_unified_charts.py', 'r') as f:
    content = f.read()

content = content.replace('for sym in ["GRPH"]:', 'for sym in sorted(symbols):')

with open('build_unified_charts.py', 'w') as f:
    f.write(content)

