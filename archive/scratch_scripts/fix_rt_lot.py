import re
with open('build_unified_charts.py', 'r') as f:
    content = f.read()

content = content.replace("vol = int(row['volume'])", "vol = int(row['lot'])")

with open('build_unified_charts.py', 'w') as f:
    f.write(content)

