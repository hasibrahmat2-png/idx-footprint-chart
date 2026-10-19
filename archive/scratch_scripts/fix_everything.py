import re

# 1. Revert UI Javascript shift
with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

target = """                        // ABSOLUTE MATHEMATICAL FIX FOR ALL TIMEZONES (EGYPT/LONDON/JAKARTA/ETC)
                        // This forces the True UTC timestamp to display exactly as WIB in the user's local browser timezone
                        if (tf !== '1d') {
                            const jakartaOffsetMins = 7 * 60; // WIB is UTC+7
                            const localOffsetMins = new Date().getTimezoneOffset(); // e.g. -180 in Egypt, 0 in London, -420 in Jakarta
                            const shiftSeconds = (jakartaOffsetMins + localOffsetMins) * 60;
                            data.forEach(d => {
                                d.time += shiftSeconds;
                            });
                        }"""

content = content.replace(target, "")

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)

# 2. Revert Python timezone to Fake UTC (remove - 25200)
with open('build_unified_charts.py', 'r') as f:
    py_content = f.read()

py_content = py_content.replace(
    "time_cache[dt_str] = int(datetime.fromisoformat(dt_str.replace(' ', 'T')).replace(tzinfo=timezone.utc).timestamp()) - 25200",
    "time_cache[dt_str] = int(datetime.fromisoformat(dt_str.replace(' ', 'T')).replace(tzinfo=timezone.utc).timestamp())"
)

with open('build_unified_charts.py', 'w') as f:
    f.write(py_content)
