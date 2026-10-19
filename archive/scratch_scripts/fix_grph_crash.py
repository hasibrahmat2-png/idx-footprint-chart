with open('build_unified_charts.py', 'r') as f:
    content = f.read()

content = content.replace(
    "ts_rt = fast_parse_time(dt_str).replace(tzinfo=timezone.utc)",
    "ts_rt = fast_parse_time(dt_str)"
)

with open('build_unified_charts.py', 'w') as f:
    f.write(content)
