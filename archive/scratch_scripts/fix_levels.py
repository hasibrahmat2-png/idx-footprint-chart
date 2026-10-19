import json
import glob

# Modify build_unified_charts.py to delete levels if empty
with open('build_unified_charts.py', 'r') as f:
    content = f.read()

# Wait, instead of regex, let's just do a blanket removal before saving.
# At the end, right before saving:
replace_target = """    # 4. Save to JSON
    os.makedirs('indicator-examples/public', exist_ok=True)
    for tf, candles_dict in resampled_candles.items():
        sorted_candles = [candles_dict[ts] for ts in sorted(candles_dict.keys())]
        out_path = f"indicator-examples/public/{symbol}_{tf}.json"
"""

replace_with = """    # 4. Save to JSON
    os.makedirs('indicator-examples/public', exist_ok=True)
    for tf, candles_dict in resampled_candles.items():
        sorted_candles = [candles_dict[ts] for ts in sorted(candles_dict.keys())]
        
        # Strip empty levels to prevent frontend crashes
        for c in sorted_candles:
            if 'levels' in c and not c['levels']:
                del c['levels']
                
        out_path = f"indicator-examples/public/{symbol}_{tf}.json"
"""

content = content.replace(replace_target, replace_with)

with open('build_unified_charts.py', 'w') as f:
    f.write(content)

