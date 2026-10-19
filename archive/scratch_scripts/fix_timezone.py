with open('build_unified_charts.py', 'r') as f:
    content = f.read()

# Subtract 7 hours (25200 seconds) to convert WIB to true UTC timestamp
content = content.replace(
    "time_cache[dt_str] = int(datetime.fromisoformat(dt_str.replace(' ', 'T')).replace(tzinfo=timezone.utc).timestamp())",
    "time_cache[dt_str] = int(datetime.fromisoformat(dt_str.replace(' ', 'T')).replace(tzinfo=timezone.utc).timestamp()) - 25200"
)

# Also fix the Daily timestamps!
# dt = datetime.strptime(row['date'], "%Y-%m-%d").replace(tzinfo=timezone.utc)
# If we subtract 7 hours here? No! For Daily, TV expects UTC 00:00:00! So Daily timestamps should remain Fake UTC (00:00:00 UTC).

with open('build_unified_charts.py', 'w') as f:
    f.write(content)
