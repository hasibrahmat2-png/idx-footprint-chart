#!/usr/bin/env python3
"""
Process Forex trade history and cash transactions from Exness (History forex/),
calculate metrics, cashflow, and export public JSON for the TradingView Footprint Charting platform.
"""

import os
import sys
import json
import csv
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "indicator-examples" / "public"
DATA_DIR = BASE_DIR / "data"

FOREX_HISTORY_DIR = Path("/home/hasibrahmat2/History forex")
DEFAULT_CSV = FOREX_HISTORY_DIR / "01_01_2007-14_10_2026.csv"

# Deposit & Withdrawal data provided by user
USER_CASH_TRANSACTIONS = [
    {
        "id": "598455250950",
        "datetime": "2026-03-09 16:50:00",
        "date": "2026-03-09",
        "time": "16:50:00",
        "command": "DEPOSIT",
        "method": "QRIS",
        "account": "159936924",
        "amount": 10014.0,
        "currency": "USC",
        "status": "Done"
    },
    {
        "id": "613776416774",
        "datetime": "2026-03-22 01:57:00",
        "date": "2026-03-22",
        "time": "01:57:00",
        "command": "WITHDRAW",
        "method": "Internet Banking",
        "account": "159936924",
        "amount": 1500.0,
        "currency": "USC",
        "status": "Sent"
    }
]


def resolve_csv_path(custom_path=None) -> Path:
    if custom_path:
        p = Path(custom_path).resolve()
        if p.exists():
            return p
        print(f"Warning: File spesifik '{custom_path}' tidak ditemukan. Mencari file terbaru...")

    # 1. Cek folder History forex
    if FOREX_HISTORY_DIR.exists():
        csv_files = sorted(
            list(FOREX_HISTORY_DIR.glob("*.csv")),
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )
        if csv_files:
            return csv_files[0]

    # 2. Cek root /home/hasibrahmat2/
    user_home = Path("/home/hasibrahmat2")
    home_csvs = sorted(
        list(user_home.glob("01_01_2007-*.csv")),
        key=lambda f: f.stat().st_mtime,
        reverse=True
    )
    if home_csvs:
        return home_csvs[0]

    return DEFAULT_CSV


def process_forex_history(target_csv=None):
    csv_path = resolve_csv_path(target_csv)
    if not csv_path.exists():
        print(f"File tidak ditemukan: {csv_path}")
        return

    print(f"Memproses CSV Forex: {csv_path}")

    trades = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                open_dt = datetime.fromisoformat(r["opening_time_utc"]).replace(tzinfo=timezone.utc)
                close_dt = datetime.fromisoformat(r["closing_time_utc"]).replace(tzinfo=timezone.utc)
                open_ts = int(open_dt.timestamp())
                close_ts = int(close_dt.timestamp())

                pnl = float(r.get("profit") or 0)
                lot = float(r.get("lots") or 0)
                op = float(r.get("opening_price") or 0)
                cp = float(r.get("closing_price") or 0)
                t_type = (r.get("type") or "buy").upper()

                if op > 0:
                    if t_type == "BUY":
                        pct = round(((cp - op) / op) * 100, 2)
                    else:
                        pct = round(((op - cp) / op) * 100, 2)
                else:
                    pct = 0.0

                sl = float(r["stop_loss"]) if r.get("stop_loss") else None
                tp = float(r["take_profit"]) if r.get("take_profit") else None
                comm = float(r["commission"]) if r.get("commission") else 0.0
                sw = float(r["swap"]) if r.get("swap") else 0.0

                trades.append({
                    "id": str(r.get("ticket")),
                    "ticket": str(r.get("ticket")),
                    "symbol": r.get("symbol", "").strip(),
                    "type": t_type,
                    "command": t_type,
                    "entry_time": open_ts,
                    "entry_datetime": open_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "entry_date": open_dt.strftime("%Y-%m-%d"),
                    "entry_price": op,
                    "exit_time": close_ts,
                    "exit_datetime": close_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "exit_date": close_dt.strftime("%Y-%m-%d"),
                    "exit_price": cp,
                    "lot": lot,
                    "shares": lot,
                    "stop_loss": sl,
                    "take_profit": tp,
                    "commission": comm,
                    "swap": sw,
                    "realized_amount": round(pnl, 2),
                    "realized_percentage": pct,
                    "is_win": pnl > 0,
                    "is_day_trade": open_dt.strftime("%Y-%m-%d") == close_dt.strftime("%Y-%m-%d"),
                    "is_open": False,
                    "close_reason": r.get("close_reason", "").strip(),
                    "currency": "USC"
                })
            except Exception as e:
                pass

    trades.sort(key=lambda x: x["exit_time"])

    wins = [t for t in trades if t["is_win"]]
    losses = [t for t in trades if not t["is_win"]]
    gross_profit = sum(t["realized_amount"] for t in wins)
    gross_loss = abs(sum(t["realized_amount"] for t in losses))
    net_pnl = sum(t["realized_amount"] for t in trades)

    summary = {
        "total_trades": len(trades),
        "total_positions": len(trades),
        "total_open_positions": 0,
        "wins": len(wins),
        "losses": len(losses),
        "total_realized_pnl": round(net_pnl, 2),
        "win_rate": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0.0,
        "currency": "USC"
    }

    # Cashflow statistics
    deposits_vals = [x["amount"] for x in USER_CASH_TRANSACTIONS if x["command"] == "DEPOSIT"]
    withdraws_vals = [x["amount"] for x in USER_CASH_TRANSACTIONS if x["command"] == "WITHDRAW"]

    # Dynamic processed date from latest trade or today
    latest_exit = trades[-1]["exit_date"] if trades else datetime.now().strftime("%Y-%m-%d")
    id_months = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    try:
        p_dt = datetime.strptime(latest_exit, "%Y-%m-%d")
        proc_date_fmt = f"{p_dt.day} {id_months[p_dt.month]} {p_dt.year}"
    except Exception:
        proc_date_fmt = latest_exit

    cashflow_summary = {
        "processed_date": latest_exit,
        "processed_date_formatted": proc_date_fmt,
        "currency": "USC",
        "deposits": {
            "count": len(deposits_vals),
            "total": sum(deposits_vals),
            "mean": sum(deposits_vals) / len(deposits_vals) if deposits_vals else 0,
            "median": deposits_vals[0] if deposits_vals else 0,
            "min": min(deposits_vals) if deposits_vals else 0,
            "max": max(deposits_vals) if deposits_vals else 0
        },
        "withdrawals": {
            "count": len(withdraws_vals),
            "total": sum(withdraws_vals),
            "mean": sum(withdraws_vals) / len(withdraws_vals) if withdraws_vals else 0,
            "median": withdraws_vals[0] if withdraws_vals else 0,
            "min": min(withdraws_vals) if withdraws_vals else 0,
            "max": max(withdraws_vals) if withdraws_vals else 0
        },
        "net_cash_flow": sum(deposits_vals) - sum(withdraws_vals),
        "recent_cash_transactions": USER_CASH_TRANSACTIONS
    }

    json_data = {
        "summary": summary,
        "trades": trades,
        "positions": trades,
        "open_positions": [],
        "cashflow": cashflow_summary
    }

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    out_pub = PUBLIC_DIR / "forex_trade_history_2026.json"
    out_dat = DATA_DIR / "forex_trade_history_2026.json"

    for p in [out_pub, out_dat]:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2)

    print(f"Berhasil memproses {len(trades)} transaksi forex.")
    print(f"Win: {len(wins)}, Loss: {len(losses)}, Win Rate: {summary['win_rate']}%, Net PnL: {summary['total_realized_pnl']} USC")
    print(f"File tersimpan di: {out_pub} dan {out_dat}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else None
    process_forex_history(target)

