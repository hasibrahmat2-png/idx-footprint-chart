#!/usr/bin/env python3
"""
Fetch complete trade and transaction history from Stockbit Carina API (Jan 2026 - Present),
run full FIFO reconciliation for closed trades and open portfolio positions, and export
both clean CSV files and the public JSON for the TradingView Footprint Charting platform.
"""

import os
import sys
import json
import csv
import re
import getpass
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_DIR = BASE_DIR / "indicator-examples" / "public"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

def extract_token(raw: str) -> str:
    text = raw.strip()
    header_match = re.search(r"(?im)^\s*authorization\s*:\s*bearer\s+([^\s]+)", text)
    if header_match:
        return header_match.group(1).strip()
    bearer_match = re.search(r"(?i)\bbearer\s+([^\s]+)", text)
    if bearer_match:
        return bearer_match.group(1).strip()
    return text.strip().strip('"').strip("'")

def get_headers():
    token = os.environ.get("STOCKBIT_TOKEN", "").strip()
    if not token:
        if sys.stdin.isatty():
            print(
                "\nToken hanya dipakai di memori selama proses dan tidak ditulis ke file.\n"
                "Gunakan token baru dari sesi Stockbit yang aktif; jangan kirim token kepada siapa pun."
            )
            try:
                token = getpass.getpass("Tempel token Authorization/Bearer (teks tidak akan terlihat): ")
            except Exception:
                token = input("Tempel token Authorization/Bearer: ")
        else:
            raise ValueError("Environment variable STOCKBIT_TOKEN belum diset.")
            
    token = extract_token(token)
    if not token:
        raise ValueError("Token tidak boleh kosong.")
        
    if not token.startswith("Bearer "):
        token = f"Bearer {token}"
        
    return {
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

# Actual IPO allotment adjustments (when oversubscribed, requested shares > allotted shares)
# Based on actual user allocation:
# - JELI IPO: 1 lot (100 shares) @ Rp 900 allotted (oversubscribed from 3 lots requested)
# - PRDL IPO: 1 lot (100 shares) @ Rp 120 allotted (oversubscribed from 10 lots requested)
IPO_ALLOTMENT_ADJUSTMENTS = {
    "411199205": {"symbol": "JELI", "lot": 1, "shares": 100, "amount": 90000.0, "netamount": 90000.0},
    "411200344": {"symbol": "PRDL", "lot": 1, "shares": 100, "amount": 12000.0, "netamount": 12000.0},
}

def fetch_all_history():
    all_records = []
    page = 1
    headers = get_headers()
    
    print("Fetching trade history from Stockbit Carina API...")
    while True:
        url = f"https://carina.stockbit.com/history?page={page}&limit=100&period=1+year&start=&end=&action=&keyword="
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
                history = data.get("data", {}).get("history", [])
                meta = data.get("data", {}).get("meta", {})
                max_page = meta.get("max_page", page)
                
                items_in_page = 0
                for month_group in history:
                    for item in month_group.get("history_list", []):
                        all_records.append(item)
                        items_in_page += 1
                        
                print(f"  Page {page}/{max_page}: retrieved {items_in_page} transactions (Total: {len(all_records)})")
                
                if not history or items_in_page == 0 or page >= max_page:
                    break
                page += 1
        except Exception as e:
            print(f"Warning: Error fetching page {page} from Carina API: {e}")
            break
            
    return all_records

def load_cached_trades():
    all_csv_path = DATA_DIR / "stockbit_transactions_all_2026.csv"
    trades_csv_path = DATA_DIR / "stockbit_trade_history_2026.csv"
    target_path = all_csv_path if all_csv_path.exists() else trades_csv_path
    if not target_path.exists():
        return []
    records = []
    with open(target_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            tid = str(r.get("id", ""))
            lot = int(float(r.get("lot") or 0))
            shares = int(float(r.get("shares") or 0))
            amount = float(r.get("amount") or 0)
            netamount = float(r.get("netamount") or 0)
            if tid in IPO_ALLOTMENT_ADJUSTMENTS:
                adj = IPO_ALLOTMENT_ADJUSTMENTS[tid]
                lot = adj["lot"]
                shares = adj["shares"]
                amount = adj["amount"]
                netamount = adj["netamount"]
            records.append({
                "id": tid,
                "timestamp": int(float(r.get("timestamp") or 0)),
                "datetime": r.get("datetime", ""),
                "date": r.get("date", ""),
                "time": r.get("time", ""),
                "command": r.get("command", "").upper(),
                "symbol": r.get("symbol", "").upper(),
                "price": float(r.get("price") or 0),
                "lot": lot,
                "shares": shares,
                "amount": amount,
                "fee": float(r.get("fee") or 0),
                "netamount": netamount,
                "realized_amount": float(r.get("realized_amount") or 0),
                "realized_percentage": float(r.get("realized_percentage") or 0),
                "status": r.get("status", "MATCH"),
                "is_day_trade": r.get("is_day_trade") == "True",
                "display_as": r.get("display_as", "")
            })
    return records

def reconcile_fifo_positions(trades):
    trades.sort(key=lambda x: (int(x["timestamp"]), str(x["id"])))

    open_buys = defaultdict(list)
    closed_positions = []

    for t in trades:
        sym = t["symbol"].upper()
        cmd = t["command"].upper()
        qty = int(t["shares"])
        lot = int(t["lot"])
        price = float(t["price"])
        ts = int(t["timestamp"])
        dt = t["datetime"]
        date = t["date"]
        fee = float(t.get("fee") or 0)
        
        if cmd in ("BUY", "IPO"):
            open_buys[sym].append({
                "id": str(t["id"]),
                "timestamp": ts,
                "datetime": dt,
                "date": date,
                "time": t.get("time", ""),
                "price": price,
                "lot": lot,
                "shares": qty,
                "remaining_shares": qty,
                "fee": fee
            })
        elif cmd in ("SELL", "FORCE SELL DAY TRADE"):
            sell_shares = qty
            matched_buys = []
            realized_amount = float(t.get("realized_amount") or 0)
            realized_pct = float(t.get("realized_percentage") or 0)
            
            while sell_shares > 0 and open_buys[sym]:
                first_buy = open_buys[sym][0]
                matched_qty = min(sell_shares, first_buy["remaining_shares"])
                matched_buys.append({
                    "buy": first_buy,
                    "shares": matched_qty,
                    "lot": matched_qty // 100
                })
                first_buy["remaining_shares"] -= matched_qty
                sell_shares -= matched_qty
                if first_buy["remaining_shares"] == 0:
                    open_buys[sym].pop(0)
                    
            if matched_buys:
                tot_matched = sum(m["shares"] for m in matched_buys)
                entry_price = sum(m["buy"]["price"] * m["shares"] for m in matched_buys) / tot_matched if tot_matched else price
                entry_time = matched_buys[0]["buy"]["timestamp"]
                entry_dt = matched_buys[0]["buy"]["datetime"]
                entry_date = matched_buys[0]["buy"]["date"]
                
                closed_positions.append({
                    "id": str(t["id"]),
                    "symbol": sym,
                    "entry_time": entry_time,
                    "entry_datetime": entry_dt,
                    "entry_date": entry_date,
                    "entry_price": round(entry_price, 2),
                    "exit_time": ts,
                    "exit_datetime": dt,
                    "exit_date": date,
                    "exit_price": price,
                    "shares": qty,
                    "lot": lot,
                    "realized_amount": round(realized_amount, 2),
                    "realized_percentage": round(realized_pct, 2),
                    "is_win": realized_amount >= 0,
                    "is_day_trade": str(t.get("is_day_trade")).lower() == "true" or entry_date == date,
                    "is_open": False
                })

    # Extract open portfolio positions
    open_positions = []
    for sym, buys in open_buys.items():
        remaining = [b for b in buys if b["remaining_shares"] > 0]
        if not remaining:
            continue
        tot_shares = sum(b["remaining_shares"] for b in remaining)
        avg_price = sum(b["price"] * b["remaining_shares"] for b in remaining) / tot_shares
        first_buy = remaining[0]
        open_positions.append({
            "id": f"OPEN_{sym}_{first_buy['id']}",
            "symbol": sym,
            "entry_time": first_buy["timestamp"],
            "entry_datetime": first_buy["datetime"],
            "entry_date": first_buy["date"],
            "entry_price": round(avg_price, 2),
            "shares": tot_shares,
            "lot": tot_shares // 100,
            "total_cost": round(avg_price * tot_shares, 2),
            "fee": round(sum(b["fee"] * (b["remaining_shares"] / b["shares"]) for b in remaining if b["shares"] > 0), 2),
            "is_open": True,
            "is_win": False,
            "is_day_trade": False,
            "batches": [{
                "id": b["id"],
                "price": b["price"],
                "shares": b["remaining_shares"],
                "lot": b["remaining_shares"] // 100,
                "datetime": b["datetime"]
            } for b in remaining]
        })

    # Sort open positions by symbol
    open_positions.sort(key=lambda x: x["symbol"])

    summary = {
        "total_trades": len(trades),
        "total_positions": len(closed_positions),
        "total_open_positions": len(open_positions),
        "wins": len([p for p in closed_positions if p["is_win"]]),
        "losses": len([p for p in closed_positions if not p["is_win"]]),
        "total_realized_pnl": round(sum(p["realized_amount"] for p in closed_positions), 2),
        "win_rate": round(len([p for p in closed_positions if p["is_win"]]) / len(closed_positions) * 100, 1) if closed_positions else 0
    }

    return closed_positions, open_positions, summary

def process_and_export(raw_records=None):
    parsed = []
    
    if raw_records:
        for r in raw_records:
            date_raw = r.get("date", "").strip()
            time_raw = r.get("time", "").strip()
            
            dt_str = ""
            iso_date = ""
            ts = 0
            try:
                dt = datetime.strptime(f"{date_raw} {time_raw}", "%d %b %Y %H:%M:%S")
                iso_date = dt.strftime("%Y-%m-%d")
                dt_str = dt.strftime("%Y-%m-%d %H:%M:%S")
                ts = int(dt.replace(tzinfo=timezone.utc).timestamp())
            except Exception:
                iso_date = date_raw
                dt_str = f"{date_raw} {time_raw}"

            tid = str(r.get("id", ""))
            lot = int(r.get("lot") or 0)
            shares = int(r.get("shares") or 0)
            amount = float(r.get("amount") or 0)
            netamount = float(r.get("netamount") or 0)
            if tid in IPO_ALLOTMENT_ADJUSTMENTS:
                adj = IPO_ALLOTMENT_ADJUSTMENTS[tid]
                lot = adj["lot"]
                shares = adj["shares"]
                amount = adj["amount"]
                netamount = adj["netamount"]

            parsed.append({
                "id": tid,
                "timestamp": ts,
                "datetime": dt_str,
                "date": iso_date,
                "time": time_raw,
                "command": r.get("command", "").upper(),
                "symbol": r.get("symbol", "").upper(),
                "price": float(r.get("price") or 0),
                "lot": lot,
                "shares": shares,
                "amount": amount,
                "fee": float(r.get("fee") or 0),
                "netamount": netamount,
                "realized_amount": float(r.get("realized_amount") or 0),
                "realized_percentage": float(r.get("realized_percentage") or 0),
                "status": r.get("status", ""),
                "is_day_trade": r.get("is_day_trade", False),
                "display_as": r.get("display_as", "")
            })
    else:
        parsed = load_cached_trades()

    parsed.sort(key=lambda x: (int(x["timestamp"]), str(x["id"])))

    trades_only = [x for x in parsed if x["command"] in ("BUY", "SELL", "FORCE SELL DAY TRADE", "IPO")]
    
    # Run FIFO reconciliation
    closed_positions, open_positions, summary = reconcile_fifo_positions(trades_only)

    # 1. Export CSVs
    fieldnames = [
        "id", "timestamp", "datetime", "date", "time", "command", "symbol",
        "price", "lot", "shares", "amount", "fee", "netamount",
        "realized_amount", "realized_percentage", "status", "is_day_trade", "display_as"
    ]

    all_csv_path = DATA_DIR / "stockbit_transactions_all_2026.csv"
    root_csv_path = Path("/home/hasibrahmat2/stockbit_transactions_all_2026.csv")
    trades_csv_path = DATA_DIR / "stockbit_trade_history_2026.csv"
    root_trades_path = Path("/home/hasibrahmat2/stockbit_trade_history_2026.csv")

    if raw_records:
        for p in [all_csv_path, root_csv_path]:
            with open(p, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(parsed)
                
        for p in [trades_csv_path, root_trades_path]:
            with open(p, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(trades_only)

    # 2. Compute Cashflow & Capital Statistics
    import statistics
    deposits_vals = [float(x.get("netamount") or x.get("amount") or 0) for x in parsed if x["command"] == "DEPOSIT"]
    withdraws_vals = [float(x.get("netamount") or x.get("amount") or 0) for x in parsed if x["command"] == "WITHDRAW"]
    pos_costs = [p["entry_price"] * p["shares"] for p in closed_positions]

    events = []
    for p in closed_positions:
        en_t = p.get("entry_time") or 0
        ex_t = p.get("exit_time") or 0
        cost = p["entry_price"] * p["shares"]
        if en_t and ex_t:
            events.append((en_t, cost, 1))
            events.append((ex_t, -cost, 0))
    for p in open_positions:
        en_t = p.get("entry_time") or 0
        cost = p["entry_price"] * p["shares"]
        if en_t:
            events.append((en_t, cost, 1))
    events.sort(key=lambda e: (e[0], e[2]))

    running_cap = 0
    peak_cap = 0
    peak_time = 0
    for ts, delta, _ in events:
        running_cap += delta
        if running_cap > peak_cap:
            peak_cap = running_cap
            peak_time = ts

    # User's IDX environment date is 2026-10-03 (Hari Ini)
    processed_date_str = "2026-10-03"
    processed_date_fmt = "3 Oktober 2026"

    cashflow_summary = {
        "processed_date": processed_date_str,
        "processed_date_formatted": processed_date_fmt,
        "deposits": {
            "count": len(deposits_vals),
            "total": sum(deposits_vals),
            "mean": statistics.mean(deposits_vals) if deposits_vals else 0,
            "median": statistics.median(deposits_vals) if deposits_vals else 0,
            "min": min(deposits_vals) if deposits_vals else 0,
            "max": max(deposits_vals) if deposits_vals else 0
        },
        "withdrawals": {
            "count": len(withdraws_vals),
            "total": sum(withdraws_vals),
            "mean": statistics.mean(withdraws_vals) if withdraws_vals else 0,
            "median": statistics.median(withdraws_vals) if withdraws_vals else 0,
            "min": min(withdraws_vals) if withdraws_vals else 0,
            "max": max(withdraws_vals) if withdraws_vals else 0
        },
        "net_cash_flow": sum(deposits_vals) - sum(withdraws_vals),
        "capital_per_trade": {
            "total_turnover": sum(pos_costs),
            "mean": statistics.mean(pos_costs) if pos_costs else 0,
            "median": statistics.median(pos_costs) if pos_costs else 0,
            "min": min(pos_costs) if pos_costs else 0,
            "max": max(pos_costs) if pos_costs else 0,
            "peak_concurrent": peak_cap,
            "peak_datetime": datetime.fromtimestamp(peak_time).strftime("%Y-%m-%d %H:%M:%S") if peak_time else ""
        },
        "distribution": {
            "under_50k": sum(1 for c in pos_costs if c < 50000),
            "range_50k_100k": sum(1 for c in pos_costs if 50000 <= c < 100000),
            "range_100k_200k": sum(1 for c in pos_costs if 100000 <= c < 200000),
            "above_200k": sum(1 for c in pos_costs if c >= 200000),
            "total_positions": len(pos_costs)
        },
        "recent_cash_transactions": [
            {
                "id": str(x["id"]),
                "datetime": x["datetime"],
                "date": x["date"],
                "time": x["time"],
                "command": x["command"],
                "amount": float(x.get("netamount") or x.get("amount") or 0),
                "status": x.get("status", "SUCCESS")
            }
            for x in parsed if x["command"] in ("DEPOSIT", "WITHDRAW")
        ][-25:]
    }

    # 3. Export Public JSON for TradingView Chart Engine & Drawers
    json_data = {
        "summary": summary,
        "trades": trades_only,
        "positions": closed_positions,
        "open_positions": open_positions,
        "cashflow": cashflow_summary
    }

    public_json_path = PUBLIC_DIR / "stockbit_trade_history_2026.json"
    data_json_path = DATA_DIR / "stockbit_trade_history_2026.json"

    for p in [public_json_path, data_json_path]:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2)

    print("\n--- Summary Portofolio Trading 2026 ---")
    print(f"Total Transaksi Saham  : {len(trades_only)}")
    print(f"  Closed Positions     : {len(closed_positions)} (Wins: {summary['wins']}, Losses: {summary['losses']})")
    print(f"  Win Rate             : {summary['win_rate']:.1f}%")
    print(f"  Net Realized P&L     : Rp {summary['total_realized_pnl']:,.2f}")
    print(f"  Open Portfolio       : {len(open_positions)} saham aktif")
    for op in open_positions:
        print(f"    - {op['symbol']:<4} : {op['lot']:>2} lot ({op['shares']} lembar) @ avg Rp {op['entry_price']:,.0f} | Masuk: {op['entry_date']}")

    print(f"\nGenerated Chart JSON : {public_json_path} ({len(json.dumps(json_data))} bytes)")
    return json_data

if __name__ == "__main__":
    is_cached_mode = "--cached" in sys.argv or "--offline" in sys.argv
    records = None
    if not is_cached_mode:
        try:
            records = fetch_all_history()
        except Exception as e:
            print(f"Notice: Failed to fetch live history ({e}), falling back to cached CSV.")
            records = None

    process_and_export(records)
