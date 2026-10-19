import json
import csv
import sys
import os
import datetime

def get_ymd(ts):
    dt = datetime.datetime.utcfromtimestamp(ts)
    return dt.strftime("%Y-%m-%d")

def merge_history(ticker):
    csv_file = f"data/{ticker}.csv"
    json_file = f"{ticker}_1d.json"
    
    if not os.path.exists(csv_file):
        print(f"Error: {csv_file} not found.")
        return
        
    merged = {}
    
    # 1. Load footprint JSON data FIRST
    json_count = 0
    if os.path.exists(json_file):
        print(f"Loading footprint data from {json_file}...")
        with open(json_file, 'r') as f:
            try:
                footprint_data = json.load(f)
                for item in footprint_data:
                    ymd = get_ymd(item['time'])
                    if ymd not in merged or 'levels' in item:
                        merged[ymd] = item
                    json_count += 1
            except Exception as e:
                print(f"Warning: Could not parse {json_file}")
                
    # 2. Load historical CSV data and merge fields
    print(f"Loading historical data from {csv_file}...")
    with open(csv_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                ymd = row['date']
                dt = datetime.datetime.strptime(ymd, "%Y-%m-%d").replace(hour=12) 
                ts = int(dt.timestamp())
                
                # If we don't have it, create it
                if ymd not in merged:
                    merged[ymd] = {
                        "time": ts,
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                    }
                
                # In ALL cases (whether it existed in JSON or not), inject the missing daily metrics!
                merged[ymd]["volume"] = float(row.get('volume', 0))
                merged[ymd]["value"] = float(row.get('value', 0))
                merged[ymd]["frequency"] = float(row.get('frequency', 0))
                merged[ymd]["change"] = float(row.get("change", 0))
                merged[ymd]["change_percentage"] = float(row.get('change_percentage', 0))
                merged[ymd]["net_foreign"] = float(row.get('net_foreign', 0))
                merged[ymd]["foreign_buy"] = float(row.get('foreign_buy', 0))
                merged[ymd]["foreign_sell"] = float(row.get('foreign_sell', 0))
                if 'average' in row:
                    merged[ymd]["average"] = float(row.get('average', 0))
                
            except Exception as e:
                pass
                
    # 3. Sort by time and save back to JSON
    sorted_data = sorted(list(merged.values()), key=lambda x: x['time'])
    
    with open(json_file, 'w') as f:
        json.dump(sorted_data, f)
        
    print(f"\nSuccess! Merged {ticker} data.")
    print(f"Total days in final chart: {len(sorted_data)}")
    print(f"Saved to {json_file}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 merge_history.py <TICKER>")
    else:
        merge_history(sys.argv[1].upper())
