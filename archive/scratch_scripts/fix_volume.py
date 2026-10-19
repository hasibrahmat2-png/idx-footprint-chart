import re
with open('build_unified_charts.py', 'r') as f:
    content = f.read()

# Fix 1m loading to include volume
content = content.replace('"close": float(row[\'close\']),', '"close": float(row[\'close\']),\n                        "volume": float(row.get(\'volume\', 0)),')

# Fix resampled dict init to include volume
content = content.replace('"close": c_1m[\'close\'],', '"close": c_1m[\'close\'],\n                    "volume": c_1m.get(\'volume\', 0),')

# Fix resampled aggregation to sum volume
content = content.replace('resampled_candles[tf][bucket_ts][\'close\'] = c_1m[\'close\']', 'resampled_candles[tf][bucket_ts][\'close\'] = c_1m[\'close\']\n                resampled_candles[tf][bucket_ts][\'volume\'] += c_1m.get(\'volume\', 0)')

with open('build_unified_charts.py', 'w') as f:
    f.write(content)

