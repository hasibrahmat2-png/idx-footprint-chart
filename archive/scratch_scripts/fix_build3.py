import re

with open('build_unified_charts.py', 'r') as f:
    content = f.read()

# Fix 1m timestamp logic
content = content.replace("ts = int(row['unix_timestamp'])", "dt = datetime.strptime(row['datetime'], '%Y-%m-%d %H:%M:%S')\n                    ts = int(dt.replace(tzinfo=timezone.utc).timestamp())")

# Fix 1m volume logic (use lot instead of volume)
content = content.replace("\"volume\": float(row.get('volume', 0)),", "\"volume\": float(row.get('lot', row.get('volume', 0) / 100)),")

with open('build_unified_charts.py', 'w') as f:
    f.write(content)
