import os
import csv
import json
import glob

data_dir = "data"
out_dir = "/home/hasibrahmat2/lightweight-charts-master"

csv_files = glob.glob(os.path.join(data_dir, "*.csv"))

for csv_file in csv_files:
    ticker = os.path.basename(csv_file).replace('.csv', '')
    output_file = os.path.join(out_dir, f"{ticker}_1d.json")
    
    output = []
    try:
        with open(csv_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    bar = {
                        "time": row['date'],
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                    }
                    
                    # Add extra fields if they exist and are valid numbers
                    def safe_float(val):
                        try:
                            return float(val)
                        except:
                            return 0.0

                    if 'average' in row: bar['average'] = safe_float(row['average'])
                    if 'volume' in row: bar['volume'] = safe_float(row['volume'])
                    if 'value' in row: bar['value'] = safe_float(row['value'])
                    if 'frequency' in row: bar['frequency'] = safe_float(row['frequency'])
                    if 'change' in row: bar['change'] = safe_float(row['change'])
                    if 'change_percentage' in row: bar['change_percentage'] = safe_float(row['change_percentage'])
                    if 'foreign_buy' in row: bar['foreign_buy'] = safe_float(row['foreign_buy'])
                    if 'foreign_sell' in row: bar['foreign_sell'] = safe_float(row['foreign_sell'])
                    if 'net_foreign' in row: bar['net_foreign'] = safe_float(row['net_foreign'])
                    
                    output.append(bar)
                except Exception as e:
                    continue
                    
        # Only save if we got data
        if output:
            with open(output_file, 'w') as f:
                json.dump(output, f)
            print(f"Converted {ticker} ({len(output)} candles with extended data)")
    except Exception as e:
        print(f"Error processing {ticker}: {e}")

print("Bulk conversion complete!")
