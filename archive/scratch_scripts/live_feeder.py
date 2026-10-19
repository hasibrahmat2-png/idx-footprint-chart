import urllib.request
import urllib.error
import json
import time
import datetime
import os
import sys

# Replace this with your actual token!
TOKEN = "YOUR_STOCKBIT_TOKEN_HERE"

def fetch_live_trades(symbol, cursor):
    url = f"https://api.stockbit.com/v2.1/stream/running_trade?symbols[]={symbol}&sort=ASC&limit=250&order_by=trade_number"
    if cursor:
        url += f"&trade_number={cursor}"
        
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {TOKEN}",
        "User-Agent": "Mozilla/5.0"
    })
    
    try:
        with urllib.request.urlopen(req) as response:
            payload = json.loads(response.read().decode())
            data = payload.get("data", {})
            return data.get("running_trade", []), data.get("pagination", {})
    except Exception as e:
        print(f"API Error: {e}")
        return [], {}

def process_trades_into_candle(trades, current_candle):
    for trade in trades:
        price = int(trade.get("price", 0))
        action = str(trade.get("action", "")).lower()
        lot = int(trade.get("lot", 0))
        
        if price == 0: continue
            
        if current_candle["open"] == 0:
            current_candle["open"] = price
            current_candle["high"] = price
            current_candle["low"] = price
            
        current_candle["high"] = max(current_candle["high"], price)
        current_candle["low"] = min(current_candle["low"], price)
        current_candle["close"] = price
        current_candle["volume"] += lot
        
        # Add to footprint levels
        if price not in current_candle["levels_map"]:
            current_candle["levels_map"][price] = {"bidVolume": 0, "askVolume": 0}
            
        if action == "buy":
            current_candle["levels_map"][price]["askVolume"] += lot
        elif action == "sell":
            current_candle["levels_map"][price]["bidVolume"] += lot
            
    # Format levels for Lightweight Charts
    levels_list = []
    for p in sorted(current_candle["levels_map"].keys(), reverse=True):
        levels_list.append({
            "price": p,
            "bidVolume": current_candle["levels_map"][p]["bidVolume"],
            "askVolume": current_candle["levels_map"][p]["askVolume"]
        })
    current_candle["levels"] = levels_list
    
    return current_candle

def run_feeder(symbol):
    print(f"Starting Live Feeder for {symbol}...")
    cursor = None
    
    # Initialize an empty daily candle
    now = datetime.datetime.now()
    midnight = now.replace(hour=12, minute=0, second=0, microsecond=0)
    
    current_candle = {
        "time": int(midnight.timestamp()),
        "open": 0, "high": 0, "low": 0, "close": 0,
        "volume": 0,
        "levels_map": {},
        "levels": []
    }
    
    while True:
        trades, pagination = fetch_live_trades(symbol, cursor)
        
        if trades:
            print(f"Fetched {len(trades)} new trades...")
            current_candle = process_trades_into_candle(trades, current_candle)
            
            # Save the updated candle so the HTML chart can read it
            with open(f"indicator-examples/public/live_{symbol}.json", "w") as f:
                # We save a copy without levels_map to match format
                clean_candle = current_candle.copy()
                del clean_candle["levels_map"]
                json.dump(clean_candle, f)
                
            cursor = pagination.get("next_cursor")
            
        time.sleep(3)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 live_feeder.py <TICKER>")
    else:
        run_feeder(sys.argv[1].upper())
