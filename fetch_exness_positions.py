#!/usr/bin/env python3
"""
fetch_exness_positions.py - Automated Exness Data Sync Pipeline:
1. Fetches Active Open Positions & Orders (/v1/accounts/.../positions)
2. Fetches Closed Trade History (/v2/accounts/.../positions/history)
3. Formats & saves to indicator-examples/public/ and data/ for Watchlist, Trade History & Calendar
"""

import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

WIB = timezone(timedelta(hours=7))

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
PUBLIC_DIR = BASE_DIR / "indicator-examples" / "public"
DATA_DIR = BASE_DIR / "data"

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


def load_env():
    env_vars = {}
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("\"'")
    return env_vars


def sync_exness_all():
    env = load_env()
    token = os.environ.get("EXNESS_TOKEN") or env.get("EXNESS_TOKEN", "")
    server = env.get("EXNESS_SERVER") or os.environ.get("EXNESS_SERVER", "real20")
    account = env.get("EXNESS_ACCOUNT") or os.environ.get("EXNESS_ACCOUNT", "159936924")
    host = env.get("EXNESS_HOST") or os.environ.get("EXNESS_HOST", "rtapi-sg.useusecapwaskeyyepjamlaw.com")

    token = token.replace("Bearer ", "").strip()
    if not token:
        print("[Exness Sync] EXNESS_TOKEN tidak ditemukan di .env", file=sys.stderr)
        return False

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Origin": "https://my.exness.com",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    }

    # =========================================================================
    # 1. FETCH OPEN POSITIONS & ORDERS
    # =========================================================================
    url_positions = f"https://{host}/rtapi/mt5/{server}/v1/accounts/{account}/positions"
    url_orders = f"https://{host}/rtapi/mt5/{server}/v1/accounts/{account}/orders"

    open_positions = []
    orders = []

    try:
        req = urllib.request.Request(url_positions, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            open_positions = data.get("positions", [])
    except Exception as e:
        print(f"[Exness Sync] Gagal fetch open positions: {e}", file=sys.stderr)

    try:
        req = urllib.request.Request(url_orders, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            orders = data.get("orders", [])
    except Exception:
        pass

    formatted_open_positions = []
    seen_tickets = set()

    for p in open_positions:
        t_id = str(p.get("ticket_id") or p.get("position_id") or p.get("id"))
        if t_id in seen_tickets:
            continue
        seen_tickets.add(t_id)

        o_raw_ts = p.get("open_time") or p.get("time") or 0
        o_ts = int(o_raw_ts / 1000) if o_raw_ts > 1e11 else int(o_raw_ts)
        o_dt = datetime.fromtimestamp(o_ts, tz=WIB)
        o_dt_str = o_dt.strftime("%Y-%m-%d %H:%M:%S")
        o_date_str = o_dt.strftime("%Y-%m-%d")
        o_chart_ts = int(datetime.fromisoformat(o_dt_str).replace(tzinfo=timezone.utc).timestamp())

        is_short = p.get("type") == 1
        t_type = "SELL" if is_short else "BUY"
        op = float(p.get("open_price", 0))
        cur_p = float(p.get("current_price", 0) or p.get("close_price", 0) or op)
        lot = float(p.get("volume", 0))
        pnl = float(p.get("profit", 0))
        pct = round(((cur_p - op) / op * 100 * (-1 if is_short else 1)), 2) if op > 0 else 0.0

        formatted_open_positions.append({
            "id": t_id,
            "ticket": t_id,
            "symbol": p.get("instrument") or p.get("symbol", ""),
            "type": t_type,
            "command": t_type,
            "entry_time": o_chart_ts,
            "entry_time_utc": o_ts,
            "entry_datetime": o_dt_str,
            "entry_date": o_date_str,
            "entry_price": op,
            "current_price": cur_p,
            "exit_time": 0,
            "exit_datetime": "",
            "exit_date": "",
            "exit_price": cur_p,
            "lot": lot,
            "shares": lot,
            "stop_loss": float(p["sl"]) if p.get("sl") else None,
            "take_profit": float(p["tp"]) if p.get("tp") else None,
            "sl": float(p["sl"]) if p.get("sl") else None,
            "tp": float(p["tp"]) if p.get("tp") else None,
            "commission": float(p.get("commission", 0)),
            "swap": float(p.get("swap", 0)),
            "realized_amount": round(pnl, 2),
            "realized_percentage": pct,
            "is_win": pnl >= 0,
            "is_day_trade": False,
            "is_open": True,
            "is_pending": False,
            "currency": "USC"
        })

    open_payload = {
        "status": "ok",
        "account": account,
        "server": server,
        "positions_count": len(formatted_open_positions),
        "orders_count": len(orders),
        "positions": formatted_open_positions,
        "raw_positions": open_positions,
        "orders": orders,
        "updated_at": int(datetime.now(timezone.utc).timestamp()),
    }

    for p in [PUBLIC_DIR / "exness_open_positions.json", DATA_DIR / "exness_open_positions.json"]:
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(open_payload, f, indent=2)

    print(f"[Exness Sync] Open Positions tersimpan: {len(open_positions)} posisi aktif, {len(orders)} pending order.")

    # =========================================================================
    # 2. FETCH CLOSED TRADE HISTORY (positions/history)
    # =========================================================================
    url_history = f"https://{host}/rtapi/mt5/{server}/v2/accounts/{account}/positions/history?from_date=1767225600000&to_date=4102444800000&show_balance=false"

    raw_history = []
    try:
        req = urllib.request.Request(url_history, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            raw_history = data.get("positions", [])
    except Exception as e:
        print(f"[Exness Sync] Gagal fetch trade history: {e}", file=sys.stderr)
        return False

    formatted_trades = []
    current_month_prefix = datetime.now(WIB).strftime("%Y-%m")  # e.g. "2026-10"

    for p in raw_history:
        open_raw_ts = p.get("open_time", 0)
        close_raw_ts = p.get("close_time", 0)
        open_ts = int(open_raw_ts / 1000) if open_raw_ts > 1e11 else int(open_raw_ts)
        close_ts = int(close_raw_ts / 1000) if close_raw_ts > 1e11 else int(close_raw_ts)

        # Convert strictly to Western Indonesia Time (WIB, UTC+7) to match chart candles
        open_dt = datetime.fromtimestamp(open_ts, tz=WIB)
        close_dt = datetime.fromtimestamp(close_ts, tz=WIB)

        open_dt_str = open_dt.strftime("%Y-%m-%d %H:%M:%S")
        open_date_str = open_dt.strftime("%Y-%m-%d")
        close_dt_str = close_dt.strftime("%Y-%m-%d %H:%M:%S")
        close_date_str = close_dt.strftime("%Y-%m-%d")

        # User Request: HANYA tampilkan trade history forex bulan ini saja.
        # Data bulan Maret (2026-03) dan April (2026-04) dihapus/diabaikan.
        if not close_date_str.startswith(current_month_prefix):
            continue

        # Fake UTC timestamp matching Lightweight Charts time scale (where chart bars are WIB formatted as UTC)
        open_chart_ts = int(datetime.fromisoformat(open_dt_str).replace(tzinfo=timezone.utc).timestamp())
        close_chart_ts = int(datetime.fromisoformat(close_dt_str).replace(tzinfo=timezone.utc).timestamp())

        is_short = p.get("type") == 1
        t_type = "SELL" if is_short else "BUY"
        op = float(p.get("open_price", 0))
        cp = float(p.get("close_price", 0))
        lot = float(p.get("volume", 0))
        pnl = float(p.get("profit", 0))

        pct = round(((cp - op) / op * 100 * (-1 if is_short else 1)), 2) if op > 0 else 0.0

        formatted_trades.append({
            "id": str(p.get("ticket_id") or p.get("position_id")),
            "ticket": str(p.get("ticket_id") or p.get("position_id")),
            "symbol": p.get("instrument", ""),
            "type": t_type,
            "command": t_type,
            "entry_time": open_chart_ts,
            "entry_time_utc": open_ts,
            "entry_datetime": open_dt_str,
            "entry_date": open_date_str,
            "entry_price": op,
            "exit_time": close_chart_ts,
            "exit_time_utc": close_ts,
            "exit_datetime": close_dt_str,
            "exit_date": close_date_str,
            "exit_price": cp,
            "lot": lot,
            "shares": lot,
            "stop_loss": float(p["sl"]) if p.get("sl") else None,
            "take_profit": float(p["tp"]) if p.get("tp") else None,
            "sl": float(p["sl"]) if p.get("sl") else None,
            "tp": float(p["tp"]) if p.get("tp") else None,
            "commission": float(p.get("commission", 0)),
            "swap": float(p.get("swap", 0)),
            "realized_amount": round(pnl, 2),
            "realized_percentage": pct,
            "is_win": pnl >= 0,
            "is_day_trade": open_date_str == close_date_str,
            "is_open": False,
            "close_reason": p.get("comment", "") or ("tp" if p.get("reason") == 4 else ("sl" if p.get("reason") == 3 else "user")),
            "currency": "USC"
        })

    # Sort chronological by exit time
    formatted_trades.sort(key=lambda x: x["exit_time"])

    wins = [t for t in formatted_trades if t["is_win"]]
    losses = [t for t in formatted_trades if not t["is_win"]]
    gross_profit = sum(t["realized_amount"] for t in wins)
    gross_loss = abs(sum(t["realized_amount"] for t in losses))
    net_pnl = sum(t["realized_amount"] for t in formatted_trades)

    summary = {
        "total_trades": len(formatted_trades),
        "total_positions": len(formatted_trades) + len(formatted_open_positions),
        "total_open_positions": len(formatted_open_positions),
        "wins": len(wins),
        "losses": len(losses),
        "total_realized_pnl": round(net_pnl, 2),
        "win_rate": round(len(wins) / len(formatted_trades) * 100, 1) if formatted_trades else 0.0,
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0.0,
        "currency": "USC"
    }

    # Transaksi cashflow yang relevan dengan bulan ini
    current_cash_txs = [x for x in USER_CASH_TRANSACTIONS if x.get("date", "").startswith(current_month_prefix)]
    deposits_vals = [x["amount"] for x in current_cash_txs if x["command"] == "DEPOSIT"]
    withdraws_vals = [x["amount"] for x in current_cash_txs if x["command"] == "WITHDRAW"]
    latest_exit = formatted_trades[-1]["exit_date"] if formatted_trades else datetime.now(WIB).strftime("%Y-%m-%d")

    cashflow_summary = {
        "processed_date": latest_exit,
        "processed_date_formatted": latest_exit,
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
        "recent_cash_transactions": current_cash_txs
    }

    history_json = {
        "summary": summary,
        "trades": formatted_trades,
        "positions": formatted_trades,
        "open_positions": formatted_open_positions,
        "cashflow": cashflow_summary
    }

    for p in [PUBLIC_DIR / "forex_trade_history_2026.json", DATA_DIR / "forex_trade_history_2026.json"]:
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(history_json, f, indent=2)

    print(f"[Exness Sync] Closed Trade History tersimpan: {len(formatted_trades)} transaksi (Win Rate: {summary['win_rate']}%, Net PnL: {summary['total_realized_pnl']} USC).")
    return True


if __name__ == "__main__":
    sync_exness_all()
