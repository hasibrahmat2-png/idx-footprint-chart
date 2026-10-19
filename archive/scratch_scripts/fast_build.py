import re

with open('build_unified_charts.py', 'r') as f:
    content = f.read()

# Replace round_time definition
content = re.sub(
    r'def round_time\(dt, delta\):\n.*?return dt - \(dt - datetime\.min\.replace\(tzinfo=timezone\.utc\)\) % delta',
    'def round_time_ts(ts, delta_sec):\n    return (ts // delta_sec) * delta_sec',
    content,
    flags=re.DOTALL
)

# Replace timeframes to use seconds
content = content.replace("timeframes = {\n        '1m': timedelta(minutes=1),\n        '5m': timedelta(minutes=5),\n        '15m': timedelta(minutes=15),\n        '1h': timedelta(hours=1),\n    }", "timeframes = {\n        '1m': 60,\n        '5m': 300,\n        '15m': 900,\n        '1h': 3600,\n    }")

# Replace the resampling loop logic
content = content.replace("dt = datetime.fromtimestamp(ts, tz=timezone.utc)", "")
content = content.replace("bucket_dt = round_time(dt, timeframes[tf])", "bucket_ts = round_time_ts(ts, timeframes[tf])")
content = content.replace("bucket_ts = int(bucket_dt.timestamp())", "")

# Replace footprint injection logic
content = content.replace("for tf, delta in list(timeframes.items()) + [('1d', timedelta(days=1))]:", "for tf, delta_sec in list(timeframes.items()) + [('1d', 86400)]:")
content = content.replace("bucket_dt = round_time(dt, delta)", "")
content = content.replace("bucket_ts = int(bucket_dt.replace(tzinfo=timezone.utc).timestamp())", "ts_rt = int(dt.timestamp())\n                        bucket_ts = round_time_ts(ts_rt, delta_sec)")

with open('build_unified_charts.py', 'w') as f:
    f.write(content)
