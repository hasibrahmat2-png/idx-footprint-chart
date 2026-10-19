import re

with open('build_unified_charts.py', 'r') as f:
    content = f.read()

# Add cache dictionary and function
cache_code = """
import sys
# Global cache for dt_str -> ts
time_cache = {}
def fast_parse_time(dt_str):
    if dt_str not in time_cache:
        # Fake UTC for WIB (assume dt_str is in WIB, convert as if it were UTC)
        # Using fromisoformat is 10-20x faster than strptime
        time_cache[dt_str] = int(datetime.fromisoformat(dt_str.replace(' ', 'T')).replace(tzinfo=timezone.utc).timestamp())
    return time_cache[dt_str]
"""
content = content.replace("from datetime import datetime, timedelta, timezone", "from datetime import datetime, timedelta, timezone\n" + cache_code)

# Replace the running trade parsing
target = """                    try:
                        dt_str = f"{row['date']} {row['time']}"
                        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")"""
replacement = """                    try:
                        dt_str = f"{row['date']} {row['time']}"
                        ts_rt = fast_parse_time(dt_str)"""
content = content.replace(target, replacement)

# Replace the inner loop dependency on dt
content = content.replace("ts_rt = int(dt.timestamp())", "")
content = content.replace("dt = datetime.strptime(row['datetime'], '%Y-%m-%d %H:%M:%S')\n                    ts = int(dt.replace(tzinfo=timezone.utc).timestamp())", "ts = fast_parse_time(row['datetime'])")

with open('build_unified_charts.py', 'w') as f:
    f.write(content)
