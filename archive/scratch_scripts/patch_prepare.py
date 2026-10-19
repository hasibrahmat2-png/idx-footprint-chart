import sys

with open("prepare_data.py", "r") as f:
    content = f.read()

# Replace bars_by_tf initialization
content = content.replace("bars_by_tf = {tf: {} for tf in timeframes}", "bars_by_ticker_tf = defaultdict(lambda: {tf: {} for tf in timeframes})")

# Extract ticker from filename
content = content.replace("with open(filename, 'r', encoding='utf-8-sig') as f:", """import os
    ticker = os.path.basename(filename).split('_')[2]
    with open(filename, 'r', encoding='utf-8-sig') as f:""")

# Update tf_bars access
content = content.replace("tf_bars = bars_by_tf[tf_name]", "tf_bars = bars_by_ticker_tf[ticker][tf_name]")

# Update the output loop
old_loop = """for tf_name, tf_bars in bars_by_tf.items():
    output = []
    for bar_key in sorted(tf_bars.keys()):
        bar = tf_bars[bar_key]
        levels = []
        for p in sorted(bar['levels_map'].keys(), reverse=True):
            v = bar['levels_map'][p]
            levels.append({
                'price': p,
                'bidVolume': v['bidVolume'],
                'askVolume': v['askVolume']
            })
        bar['levels'] = levels
        del bar['levels_map']
        output.append(bar)

    out_name = f'data_{tf_name}.json'
    with open(out_name, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"Generated {len(output)} bars for {tf_name} -> {out_name}")"""

new_loop = """for ticker, bars_by_tf in bars_by_ticker_tf.items():
    for tf_name, tf_bars in bars_by_tf.items():
        output = []
        for bar_key in sorted(tf_bars.keys()):
            bar = tf_bars[bar_key]
            levels = []
            for p in sorted(bar['levels_map'].keys(), reverse=True):
                v = bar['levels_map'][p]
                levels.append({
                    'price': p,
                    'bidVolume': v['bidVolume'],
                    'askVolume': v['askVolume']
                })
            bar['levels'] = levels
            del bar['levels_map']
            output.append(bar)

        out_name = f'{ticker}_{tf_name}.json'
        with open(out_name, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"Generated {len(output)} bars for {ticker} {tf_name} -> {out_name}")"""

content = content.replace(old_loop, new_loop)

with open("prepare_data.py", "w") as f:
    f.write(content)

