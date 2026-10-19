import csv
import json
import os
import glob
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

def round_time(dt, delta):
    # Special handling for 1 day: bucket by calendar day (00:00)
    if delta == timedelta(days=1):
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt - (dt - datetime.min) % delta

filenames = []
if len(sys.argv) > 1:
    for arg in sys.argv[1:]:
        if os.path.isdir(arg):
            filenames.extend(glob.glob(os.path.join(arg, "*.csv")))
        else:
            filenames.append(arg)
else:
    filenames.append('running_trade_TMPO_2026-08-26.csv')

# Define timeframes
timeframes = {
    '1m': timedelta(minutes=1),
    '5m': timedelta(minutes=5),
    '15m': timedelta(minutes=15),
    '1h': timedelta(hours=1),
    '1d': timedelta(days=1)
}

bars_by_tf = {tf: {} for tf in timeframes}

for filename in filenames:
    print(f"Processing {filename}...")
    with open(filename, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['market_board'] != 'RG':
                continue

            dt_str = f"{row['date']} {row['time']}"
            try:
                dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
                
            price = float(row['price'])
            lots = float(row['lot'])
            action = row['action'].strip().lower()

            for tf_name, delta in timeframes.items():
                bar_time = round_time(dt, delta)
                bar_key = bar_time.strftime("%Y-%m-%d %H:%M:%S")
                
                tf_bars = bars_by_tf[tf_name]

                if bar_key not in tf_bars:
                    tf_bars[bar_key] = {
                        'time': int(bar_time.replace(tzinfo=timezone.utc).timestamp()),
                        'open': price,
                        'high': price,
                        'low': price,
                        'close': price,
                        'levels_map': defaultdict(lambda: {'bidVolume': 0, 'askVolume': 0})
                    }
                
                bar = tf_bars[bar_key]
                bar['high'] = max(bar['high'], price)
                bar['low'] = min(bar['low'], price)
                bar['close'] = price
                
                if action == 'sell':
                    bar['levels_map'][price]['bidVolume'] += lots
                elif action == 'buy':
                    bar['levels_map'][price]['askVolume'] += lots
                else:
                    bar['levels_map'][price]['askVolume'] += lots

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

    out_name = f'data_{tf_name}.json'
    with open(out_name, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"Generated {len(output)} bars for {tf_name} -> {out_name}")
