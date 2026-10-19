import csv
import json
import os
import glob
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_INTRADAY_DIR = os.path.join(BASE_DIR, "data_intraday")
PUBLIC_DIR = os.path.join(BASE_DIR, "indicator-examples", "public")
SD_CARD_RT_DIR = "/mnt/chromeos/removable/SD Card/idx_running_trades"

# Global cache for dt_str -> ts
time_cache = {}
def fast_parse_time(dt_str):
    if dt_str not in time_cache:
        # Fake UTC for WIB (assume dt_str is in WIB, convert as if it were UTC)
        # Using fromisoformat is 10-20x faster than strptime
        time_cache[dt_str] = int(datetime.fromisoformat(dt_str.replace(' ', 'T')).replace(tzinfo=timezone.utc).timestamp())
    return time_cache[dt_str]


def round_time_ts(ts, delta_sec):
    return (ts // delta_sec) * delta_sec

def find_data_file(directory, filename):
    exact = os.path.join(directory, filename)
    if os.path.exists(exact):
        return exact
    if os.path.exists(directory):
        low = filename.lower()
        for entry in os.listdir(directory):
            if entry.lower() == low:
                return os.path.join(directory, entry)
        if filename.endswith('_intraday.csv'):
            sym = filename[:-len('_intraday.csv')].lower().rstrip('mc')
            for entry in os.listdir(directory):
                if entry.lower().endswith('_intraday.csv'):
                    entry_sym = entry[:-len('_intraday.csv')].lower().rstrip('mc')
                    if entry_sym == sym:
                        return os.path.join(directory, entry)
    return exact

def build_unified(symbol):
    print(f"\nMemproses {symbol}...")
    
    # 1. Load Daily Data
    daily_file = find_data_file(DATA_DIR, f"{symbol}.csv")
    daily_candles = {}
    if os.path.exists(daily_file):
        with open(daily_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    dt = datetime.strptime(row['date'], "%Y-%m-%d").replace(tzinfo=timezone.utc)
                    ts = int(dt.timestamp())
                    daily_candles[ts] = {
                        "time": ts,
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                        "volume": float(row.get('volume', 0)),
                        "value": float(row.get('value', 0)),
                        "average": float(row.get('average', 0)),
                        "frequency": float(row.get('frequency', 0)),
                        "change": float(row.get('change', 0)),
                        "change_percentage": float(row.get('change_percentage', 0)),
                        "foreign_buy": float(row.get('foreign_buy', 0)),
                        "foreign_sell": float(row.get('foreign_sell', 0)),
                        "net_foreign": float(row.get('net_foreign', 0)),
                        "levels": []
                    }
                except (ValueError, KeyError):
                    continue
    print(f"  -> {len(daily_candles)} daily candles loaded.")

    # 2. Load 1m Intraday Data
    intraday_file = find_data_file(DATA_INTRADAY_DIR, f"{symbol}_intraday.csv")
    intraday_1m = {}
    if os.path.exists(intraday_file):
        with open(intraday_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    ts = fast_parse_time(row['datetime'])
                    intraday_1m[ts] = {
                        "time": ts,
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                        "volume": float(row["lot"]) if "lot" in row and row["lot"] else float(row.get("volume", 0)) / 100,
                        "levels": []
                    }
                except (ValueError, KeyError):
                    continue
    print(f"  -> {len(intraday_1m)} 1-minute candles loaded.")

    # 3. Process Running Trades and Inject Footprint Profiles (1m and 1d)
    sd_rt_dir = os.path.join(SD_CARD_RT_DIR, f"{symbol}_running_trades")
    if os.path.exists(sd_rt_dir):
        rt_dir = sd_rt_dir
    else:
        rt_dir = find_data_file(BASE_DIR, f"{symbol}_running_trades")
    rt_files = glob.glob(os.path.join(rt_dir, "*.csv"))
    if rt_files:
        print(f"  -> Ditemukan {len(rt_files)} file running trade di {symbol}_running_trades/...")
        profiles_1m = defaultdict(lambda: defaultdict(lambda: {'bid': 0, 'ask': 0}))
        profiles_1d = defaultdict(lambda: defaultdict(lambda: {'bid': 0, 'ask': 0}))
        broker_1m = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0])))
        broker_1d = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0])))
        broker_totals = defaultdict(int)
        candle_builder_1m = defaultdict(lambda: {'open': None, 'high': -float('inf'), 'low': float('inf'), 'close': None, 'volume': 0})
        candle_builder_1d = defaultdict(lambda: {'open': None, 'high': -float('inf'), 'low': float('inf'), 'close': None, 'volume': 0})
        
        for file in sorted(rt_files):
            with open(file, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if row.get('market_board') != 'RG':
                        continue
                    
                    try:
                        dt_str = f"{row['date']} {row['time']}"
                        ts_rt = fast_parse_time(dt_str)
                        price = float(row['price'])
                        vol = int(row['lot'])
                        action = row.get('action', row.get('type', ''))
                    except (ValueError, KeyError):
                        continue
                        
                    is_buy = (action.upper() == 'BUY')
                    is_sell = (action.upper() == 'SELL')
                    if not (is_buy or is_sell):
                        continue
                    
                    bucket_1m = round_time_ts(ts_rt, 60)
                    bucket_1d = round_time_ts(ts_rt, 86400)

                    b_raw = row.get('buyer', '').strip()
                    s_raw = row.get('seller', '').strip()
                    b_broker = b_raw.split()[0].upper() if b_raw else ''
                    s_broker = s_raw.split()[0].upper() if s_raw else ''
                    
                    if is_buy:
                        profiles_1m[bucket_1m][price]['ask'] += vol
                        profiles_1d[bucket_1d][price]['ask'] += vol
                        if b_broker:
                            broker_1m[bucket_1m][b_broker][price][0] += vol
                            broker_1d[bucket_1d][b_broker][price][0] += vol
                            broker_totals[b_broker] += vol
                        if s_broker:
                            broker_1m[bucket_1m][s_broker][price][3] += vol
                            broker_1d[bucket_1d][s_broker][price][3] += vol
                            broker_totals[s_broker] += vol
                    elif is_sell:
                        profiles_1m[bucket_1m][price]['bid'] += vol
                        profiles_1d[bucket_1d][price]['bid'] += vol
                        if s_broker:
                            broker_1m[bucket_1m][s_broker][price][2] += vol
                            broker_1d[bucket_1d][s_broker][price][2] += vol
                            broker_totals[s_broker] += vol
                        if b_broker:
                            broker_1m[bucket_1m][b_broker][price][1] += vol
                            broker_1d[bucket_1d][b_broker][price][1] += vol
                            broker_totals[b_broker] += vol

                    # Synthesize candle stats if base candle is missing
                    cb1m = candle_builder_1m[bucket_1m]
                    if cb1m['open'] is None:
                        cb1m['open'] = price
                    cb1m['close'] = price
                    if price > cb1m['high']: cb1m['high'] = price
                    if price < cb1m['low']: cb1m['low'] = price
                    cb1m['volume'] += vol

                    cb1d = candle_builder_1d[bucket_1d]
                    if cb1d['open'] is None:
                        cb1d['open'] = price
                    cb1d['close'] = price
                    if price > cb1d['high']: cb1d['high'] = price
                    if price < cb1d['low']: cb1d['low'] = price
                    cb1d['volume'] += vol

        # Auto-create missing 1m candles from running trades
        for ts, cb in candle_builder_1m.items():
            if ts not in intraday_1m:
                intraday_1m[ts] = {
                    "time": ts,
                    "open": cb['open'],
                    "high": cb['high'],
                    "low": cb['low'],
                    "close": cb['close'],
                    "volume": float(cb['volume']),
                    "levels": []
                }

        # Auto-create missing 1d candles from running trades
        for ts, cb in candle_builder_1d.items():
            if ts not in daily_candles:
                daily_candles[ts] = {
                    "time": ts,
                    "open": cb['open'],
                    "high": cb['high'],
                    "low": cb['low'],
                    "close": cb['close'],
                    "volume": float(cb['volume']),
                    "levels": []
                }

        # Inject profiles into 1m candles
        for ts, candle in intraday_1m.items():
            if ts in profiles_1m:
                levels = []
                for price, vols in sorted(profiles_1m[ts].items()):
                    levels.append({
                        "price": price,
                        "bidVolume": vols['bid'],
                        "askVolume": vols['ask']
                    })
                candle['levels'] = levels

        # Inject profiles into 1d candles
        for ts, candle in daily_candles.items():
            if ts in profiles_1d:
                levels = []
                for price, vols in sorted(profiles_1d[ts].items()):
                    levels.append({
                        "price": price,
                        "bidVolume": vols['bid'],
                        "askVolume": vols['ask']
                    })
                candle['levels'] = levels

        injected_1m = sum(1 for c in intraday_1m.values() if c.get('levels'))
        injected_1d = sum(1 for c in daily_candles.values() if c.get('levels'))
        print(f"  -> Selesai memproses running trades: {injected_1m} bar 1m dan {injected_1d} bar daily memiliki footprint levels.")
    else:
        print(f"  -> [Info] Folder {symbol}_running_trades/ tidak ditemukan atau kosong. Tidak ada data footprint diinjeksi.")

    # 4. Save to JSON (1m and 1d only; 5m, 15m, 1h, 1S are synthesized dynamically in TypeScript)
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    
    export_targets = [
        ('1m', intraday_1m),
        ('1d', daily_candles),
    ]
    
    for tf, candles_dict in export_targets:
        if not candles_dict:
            continue
        sorted_candles = [candles_dict[ts] for ts in sorted(candles_dict.keys())]
        
        # Strip empty levels to prevent frontend crashes
        for c in sorted_candles:
            if 'levels' in c and not c['levels']:
                del c['levels']
                
        out_path = os.path.join(PUBLIC_DIR, f"{symbol}_{tf}.json")
        with open(out_path, 'w') as f:
            json.dump(sorted_candles, f)
        print(f"  -> Saved {out_path} ({len(sorted_candles)} candles)")

    # 5. Save companion broker profiles JSON if running trade data was processed
    if rt_files and broker_totals:
        sorted_brokers = sorted(broker_totals.keys(), key=lambda x: broker_totals[x], reverse=True)
        out_1d = {}
        for ts, b_map in broker_1d.items():
            out_1d[str(ts)] = {}
            for b, p_map in b_map.items():
                out_1d[str(ts)][b] = [{'p': p, 'ba': v[0], 'bp': v[1], 'sa': v[2], 'sp': v[3]} for p, v in sorted(p_map.items())]

        out_1m = {}
        for ts, b_map in broker_1m.items():
            out_1m[str(ts)] = {}
            for b, p_map in b_map.items():
                out_1m[str(ts)][b] = [{'p': p, 'ba': v[0], 'bp': v[1], 'sa': v[2], 'sp': v[3]} for p, v in sorted(p_map.items())]

        broker_profiles_obj = {
            "symbol": symbol,
            "brokers": sorted_brokers,
            "data_1d": out_1d,
            "data_1m": out_1m,
        }
        bp_path = os.path.join(PUBLIC_DIR, f"{symbol}_broker_profiles.json")
        with open(bp_path, 'w') as f:
            json.dump(broker_profiles_obj, f)
        print(f"  -> Saved {bp_path} ({len(sorted_brokers)} brokers tracked)")

def generate_screener(public_dir=None):
    if public_dir is None:
        public_dir = PUBLIC_DIR
    print("\n[SCREENER] Generating baseline screener_data.json...")
    stock_names = {}
    stocks_ref_path = os.path.join(public_dir, "idx_stocks.json")
    if not os.path.exists(stocks_ref_path):
        stocks_ref_path = os.path.join(BASE_DIR, "nama saham dan broker", "idx_stocks.json")
    if os.path.exists(stocks_ref_path):
        try:
            with open(stocks_ref_path, 'r', encoding='utf-8') as f:
                stock_catalog = json.load(f)
                stock_names = stock_catalog.get("ticker_to_name", {})
                print(f"  -> Loaded {len(stock_names)} stock names from {stocks_ref_path}")
        except Exception as e:
            print(f"  [!] Note: could not load idx_stocks.json: {e}")

    screener_data = []
    pattern = os.path.join(public_dir, "*_1d.json")
    for filepath in sorted(glob.glob(pattern)):
        filename = os.path.basename(filepath)
        symbol = filename.replace("_1d.json", "")
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if not data or not isinstance(data, list):
                continue
            
            data.sort(key=lambda x: x.get("time", 0))
            latest = data[-1]
            prev = data[-2] if len(data) >= 2 else None
            price = float(latest.get("close") or 0)
            if prev and prev.get("close"):
                prev_close = float(prev.get("close") or 0)
            else:
                prev_close = price - float(latest.get("change") or 0)
            if prev_close <= 0:
                prev_close = price
            change = float(latest.get("change", price - prev_close))
            change_percentage = float(latest.get("change_percentage") or (((change / prev_close) * 100) if prev_close else 0))

            # Calculate 20-day historical volume SMA (excluding current/latest day)
            prev_bars = data[-21:-1] if len(data) >= 21 else data[:-1]
            if prev_bars:
                vol_sma_20 = round(sum(float(b.get("volume") or 0) for b in prev_bars) / len(prev_bars), 2)
            else:
                vol_sma_20 = 0.0

            screener_data.append({
                "symbol": symbol,
                "name": stock_names.get(symbol, ""),
                "price": price,
                "prev_close": prev_close,
                "change": change,
                "change_percentage": round(change_percentage, 2),
                "value": float(latest.get("value") or 0),
                "volume": float(latest.get("volume") or 0),
                "vol_sma_20": vol_sma_20,
                "frequency": float(latest.get("frequency") or 0),
                "net_foreign": float(latest.get("net_foreign") or 0),
                "time": latest.get("time", 0)
            })
        except Exception as e:
            print(f"Error processing {filename}: {e}")
            
    out_file = os.path.join(public_dir, "screener_data.json")
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(screener_data, f)
    print(f"  -> Successfully generated {out_file} ({len(screener_data)} symbols)!")

if __name__ == "__main__":
    no_screener = "--no-screener" in sys.argv
    cli_args = [a for a in sys.argv[1:] if a != "--no-screener"]

    if cli_args and cli_args[0] == '--screener-only':
        generate_screener()
    elif cli_args and not cli_args[0].startswith('-'):
        # Process specific symbol(s)
        for sym in cli_args:
            build_unified(sym.upper())
        if not no_screener:
            generate_screener()
    else:
        symbols = set()
        for f in glob.glob(os.path.join(DATA_DIR, "*.csv")):
            symbols.add(os.path.basename(f).replace('.csv', ''))
        for f in glob.glob(os.path.join(DATA_INTRADAY_DIR, "*_intraday.csv")):
            symbols.add(os.path.basename(f).replace('_intraday.csv', ''))
            
        for sym in sorted(symbols):
            build_unified(sym)
            
        if not no_screener:
            generate_screener()
