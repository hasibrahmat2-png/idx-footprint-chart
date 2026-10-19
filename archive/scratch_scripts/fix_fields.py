import re
with open('build_unified_charts.py', 'r') as f:
    content = f.read()

replacement = """                    daily_candles[ts] = {
                        "time": ts,
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                        "volume": float(row.get('volume', 0)),
                        "value": float(row.get('value', 0)),
                        "frequency": float(row.get('frequency', 0)),
                        "change_percentage": float(row.get('change_percentage', 0)),
                        "net_foreign": float(row.get('net_foreign', 0)),
                        "levels": []
                    }"""

content = re.sub(r'daily_candles\[ts\] = \{\n.*?\"levels\": \[\]\n\s*\}', replacement, content, flags=re.DOTALL)
with open('build_unified_charts.py', 'w') as f:
    f.write(content)
