#!/usr/bin/env python3
"""Download broker summary and bandarmology detector data for IHSG stocks from Stockbit.

The script uses Stockbit's market detectors endpoint:
    https://exodus.stockbit.com/marketdetectors/{symbol}?from={from_date}&to={to_date}&transaction_type={type}&market_board={board}&investor_type={investor}&limit={limit}

Incremental Updates (like stockbit_daily_historical_scraper.py):
- For each stock, it checks the latest recorded date in data_broker_summary/{symbol}.csv.
- If data already exists, it only fetches missing trading days from the last recorded date up to today.
- If no data exists yet, it downloads historical data back from today to --from-date or --days lookback.
- Merges new records with existing records and sorts chronologically.

Features:
- Single stock mode (-s TICKER) or batch mode from file (-f data/ihsg_list.csv).
- Works with STOCKBIT_TOKEN environment variable or interactive masked prompt:
    read -s -p "Enter Stockbit Token: " STOCKBIT_TOKEN && export STOCKBIT_TOKEN && echo ""
- Saves:
  1) data_broker_summary/{symbol}.csv: Daily time series of Bandarmology metrics.
  2) data_broker_summary/{symbol}_{date}_{date}.csv: Detailed per-day broker ladder (top 25 buyers & sellers).
  3) data_broker_summary/{symbol}_{date}_{date}.json: Raw API JSON payload.
  4) data_broker_summary/bandar_detector_summary.csv: Market-wide screener summary for latest date.
- Terminal table visualization showing Top Buyers vs Top Sellers side-by-side.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import csv
import getpass
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

WIB = timezone(timedelta(hours=7))

BASE_URL = "https://exodus.stockbit.com/marketdetectors"
SCRIPT_VERSION = "2.1.0"
DEFAULT_DELAY_SECONDS = 0.55
DEFAULT_TIMEOUT_SECONDS = 35
DEFAULT_LIMIT = 25
DEFAULT_LOOKBACK_DAYS = 30
DEFAULT_WORKERS = 5
CONSECUTIVE_EMPTY_SKIP = 7

TRANSACTION_TYPE_CHOICES = {
    "GROSS": "TRANSACTION_TYPE_GROSS",
    "NET": "TRANSACTION_TYPE_NET",
    "TRANSACTION_TYPE_GROSS": "TRANSACTION_TYPE_GROSS",
    "TRANSACTION_TYPE_NET": "TRANSACTION_TYPE_NET",
}

MARKET_BOARD_CHOICES = {
    "REGULER": "MARKET_BOARD_REGULER",
    "RG": "MARKET_BOARD_REGULER",
    "ALL": "MARKET_BOARD_ALL",
    "NEGOSIASI": "MARKET_BOARD_NEGOSIASI",
    "NG": "MARKET_BOARD_NEGOSIASI",
    "TUNAI": "MARKET_BOARD_TUNAI",
    "TN": "MARKET_BOARD_TUNAI",
    "MARKET_BOARD_REGULER": "MARKET_BOARD_REGULER",
    "MARKET_BOARD_ALL": "MARKET_BOARD_ALL",
    "MARKET_BOARD_NEGOSIASI": "MARKET_BOARD_NEGOSIASI",
    "MARKET_BOARD_TUNAI": "MARKET_BOARD_TUNAI",
}

INVESTOR_TYPE_CHOICES = {
    "ALL": "INVESTOR_TYPE_ALL",
    "DOMESTIC": "INVESTOR_TYPE_DOMESTIC",
    "LOKAL": "INVESTOR_TYPE_DOMESTIC",
    "FOREIGN": "INVESTOR_TYPE_FOREIGN",
    "ASING": "INVESTOR_TYPE_FOREIGN",
    "INVESTOR_TYPE_ALL": "INVESTOR_TYPE_ALL",
    "INVESTOR_TYPE_DOMESTIC": "INVESTOR_TYPE_DOMESTIC",
    "INVESTOR_TYPE_FOREIGN": "INVESTOR_TYPE_FOREIGN",
}

BROKER_DETAIL_CSV_FIELDS = [
    "side",
    "rank",
    "symbol",
    "broker_code",
    "type",
    "lot",
    "shares",
    "value",
    "avg_price",
    "freq",
    "from_date",
    "to_date",
]

DAILY_SUMMARY_FIELDS = [
    "date",
    "symbol",
    "broker_accdist",
    "average_price",
    "total_buyer",
    "total_seller",
    "buyer_seller_diff",
    "total_value",
    "total_volume_lot",
    "top1_accdist",
    "top1_amount",
    "top1_percent",
    "top1_vol",
    "top3_accdist",
    "top3_amount",
    "top3_percent",
    "top3_vol",
    "top5_accdist",
    "top5_amount",
    "top5_percent",
    "top5_vol",
    "top10_accdist",
    "top10_amount",
    "top10_percent",
    "top10_vol",
    "top_buyers",
    "top_sellers",
]


class ScraperError(RuntimeError):
    """A user-facing scraper error."""


class AuthenticationError(ScraperError):
    """The supplied Stockbit token is missing, invalid, or expired."""


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    now_wib = datetime.now(tz=WIB)
    today_str = now_wib.strftime("%Y-%m-%d")

    parser = argparse.ArgumentParser(
        description="Unduh data Broker Summary dan Bandarmology Detector saham IHSG dari Stockbit secara inkremental."
    )
    parser.add_argument(
        "-s",
        "--symbol",
        help="Kode saham tunggal, misalnya MDIA atau BBCA.",
    )
    parser.add_argument(
        "-f",
        "--symbols-file",
        help="File teks/CSV berisi daftar kode saham (default: data/ihsg_list.csv jika ada).",
    )
    parser.add_argument(
        "--from-date",
        "--from",
        dest="from_date",
        default=None,
        help="Tanggal mulai (format YYYY-MM-DD). Jika tidak diisi, otomatis mengambil dari tanggal terakhir tersimpan s/d hari ini.",
    )
    parser.add_argument(
        "--to-date",
        "--to",
        dest="to_date",
        default=today_str,
        help=f"Tanggal akhir (format YYYY-MM-DD), default: hari ini ({today_str}).",
    )
    parser.add_argument(
        "--days",
        "--lookback",
        dest="lookback_days",
        type=int,
        default=DEFAULT_LOOKBACK_DAYS,
        help=f"Jumlah hari ke belakang untuk saham baru yang belum punya data (default: {DEFAULT_LOOKBACK_DAYS} hari).",
    )
    parser.add_argument(
        "--transaction-type",
        default="TRANSACTION_TYPE_GROSS",
        help="Tipe transaksi: TRANSACTION_TYPE_GROSS (default) atau TRANSACTION_TYPE_NET (atau GROSS/NET).",
    )
    parser.add_argument(
        "--market-board",
        default="MARKET_BOARD_REGULER",
        help="Papan pasar: MARKET_BOARD_REGULER (default), ALL, NEGOSIASI, TUNAI.",
    )
    parser.add_argument(
        "--investor-type",
        default="INVESTOR_TYPE_ALL",
        help="Tipe investor: INVESTOR_TYPE_ALL (default), DOMESTIC, FOREIGN.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Jumlah broker buyer/seller yang diambil per tanggal (default: {DEFAULT_LIMIT}, max 50).",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="data_broker_summary",
        help="Folder penyimpanan file CSV dan JSON (default: data_broker_summary).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=f"Jeda antar-request dalam detik (default: {DEFAULT_DELAY_SECONDS}).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Paksa unduh ulang data untuk tanggal yang sudah tersimpan sebelumnya.",
    )
    parser.add_argument(
        "--no-json",
        action="store_true",
        help="Jangan simpan file JSON mentah dari API (hanya simpan CSV).",
    )
    parser.add_argument(
        "-w",
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Jumlah worker thread untuk mengunduh tanggal secara bersamaan per saham (default: {DEFAULT_WORKERS}, max: 10).",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {SCRIPT_VERSION}",
    )
    return parser.parse_args(argv)


def normalize_symbol(raw: str) -> str:
    symbol = raw.strip().upper()
    if not re.fullmatch(r"[A-Z0-9._-]{1,20}", symbol):
        raise ScraperError(f"Kode saham tidak valid: {raw}")
    return symbol


def load_symbols(file_path: str) -> List[str]:
    path = Path(file_path)
    if not path.exists():
        raise ScraperError(f"File tidak ditemukan: {file_path}")

    symbols = []
    with path.open("r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            first_col = parts[0].strip().strip('"').strip("'")
            if first_col and first_col.upper() not in ("SYMBOL", "TICKER", "KODE"):
                try:
                    symbols.append(normalize_symbol(first_col))
                except ScraperError:
                    pass

    if not symbols:
        raise ScraperError(f"Tidak ada kode saham yang valid di dalam {file_path}")

    seen = set()
    result = []
    for s in symbols:
        if s not in seen:
            seen.add(s)
            result.append(s)
    return result


def extract_token(raw: str) -> str:
    text = raw.strip()
    header_match = re.search(r"(?im)^\s*authorization\s*:\s*bearer\s+([^\s]+)", text)
    if header_match:
        return header_match.group(1).strip()
    bearer_match = re.search(r"(?i)\bbearer\s+([^\s]+)", text)
    if bearer_match:
        return bearer_match.group(1).strip()
    return text.strip().strip('"').strip("'")


def decode_jwt_payload(token: str) -> Optional[Dict[str, Any]]:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
        value = json.loads(decoded.decode("utf-8"))
        return value if isinstance(value, dict) else None
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def validate_token(token: str) -> None:
    if len(token) < 40 or any(character.isspace() for character in token):
        raise AuthenticationError("Format token tidak valid.")
    payload = decode_jwt_payload(token)
    if not payload:
        return
    expiry = payload.get("exp")
    if isinstance(expiry, (int, float)) and expiry <= time.time():
        raise AuthenticationError("Token sudah kedaluwarsa. Login ulang ke Stockbit.")


def safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "":
        return default
    try:
        return int(round(float(val)))
    except (ValueError, TypeError):
        return default


def format_currency(val: float) -> str:
    abs_v = abs(val)
    sign = "-" if val < 0 else ""
    if abs_v >= 1e12:
        return f"{sign}{abs_v / 1e12:.2f} T"
    if abs_v >= 1e9:
        return f"{sign}{abs_v / 1e9:.2f} B"
    if abs_v >= 1e6:
        return f"{sign}{abs_v / 1e6:.2f} M"
    if abs_v >= 1e3:
        return f"{sign}{abs_v / 1e3:.2f} K"
    return f"{sign}{abs_v:.0f}"


def format_lot(val: float) -> str:
    abs_v = abs(val)
    sign = "-" if val < 0 else ""
    if abs_v >= 1e9:
        return f"{sign}{abs_v / 1e9:.2f}B"
    if abs_v >= 1e6:
        return f"{sign}{abs_v / 1e6:.2f}M"
    if abs_v >= 1e3:
        return f"{sign}{abs_v / 1e3:.1f}K"
    return f"{sign}{abs_v:.0f}"


def retry_delay(headers: Any, attempt: int) -> float:
    retry_after = headers.get("Retry-After") if headers else None
    if retry_after:
        try:
            return max(float(retry_after), 1.0)
        except ValueError:
            pass
    return min(2**attempt, 30)


def request_json(
    url: str,
    token: str,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    retries: int = 6,
) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Origin": "https://stockbit.com",
        "Referer": "https://stockbit.com/",
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Cache-Control": "no-cache",
    }

    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ScraperError("Respons API bukan objek JSON.")
            return payload
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                error_body = error.read().decode("utf-8", errors="replace")
                if "policy" in error_body.lower():
                    raise ScraperError(f"Akses ditolak (Policy/Firewall): {error_body}") from error
                raise AuthenticationError(
                    "Stockbit menolak token. Login ulang lalu gunakan token baru."
                ) from error
            retryable = error.code == 429 or 500 <= error.code <= 599
            if not retryable or attempt >= retries:
                error_body = error.read().decode("utf-8", errors="replace")
                raise ScraperError(f"HTTP {error.code} dari Stockbit: {error_body[:200]}") from error
            wait = retry_delay(error.headers, attempt + 1)
            print(f"  [HTTP {error.code}] Rate limit tercapai; menunggu {wait:.0f} detik...", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt >= retries:
                reason = getattr(error, "reason", str(error))
                raise ScraperError(f"Koneksi gagal/timeout: {reason}") from error
            wait = retry_delay(None, attempt + 1)
            print(f"  Koneksi timeout; mencoba lagi dalam {wait:.0f} detik...", flush=True)
            time.sleep(wait)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ScraperError("Respons Stockbit bukan JSON yang valid.") from error

    raise ScraperError("Request gagal setelah beberapa percobaan.")


def build_url(
    symbol: str,
    from_date: str,
    to_date: str,
    transaction_type: str,
    market_board: str,
    investor_type: str,
    limit: int,
) -> str:
    params = [
        ("from", from_date),
        ("to", to_date),
        ("transaction_type", transaction_type),
        ("market_board", market_board),
        ("investor_type", investor_type),
        ("limit", str(limit)),
    ]
    return f"{BASE_URL}/{symbol}?{urllib.parse.urlencode(params)}"


def migrate_existing_files_for_symbol(symbol: str, output_dir: Path, symbol_dir: Path) -> None:
    """Ensure all legacy flat files for this symbol in output_dir are moved to symbol_dir."""
    if output_dir.resolve() == symbol_dir.resolve():
        return
    patterns = [
        f"{symbol}.csv",
        f"{symbol}_*.csv",
        f"{symbol}_*.json",
    ]
    for pat in patterns:
        for p in list(output_dir.glob(pat)):
            if p.is_file():
                dest = symbol_dir / p.name
                if not dest.exists():
                    try:
                        shutil.move(str(p), str(dest))
                    except Exception as e:
                        print(f"  [Peringatan] Gagal memindahkan {p.name} ke {symbol_dir}: {e}")
                else:
                    try:
                        p.unlink()
                    except Exception:
                        pass


def migrate_all_legacy_flat_files(output_dir: Path) -> None:
    """Migrate any legacy flat files in output_dir into dedicated output_dir/{symbol}/ subfolders."""
    if not output_dir.exists() or not output_dir.is_dir():
        return

    for item in list(output_dir.iterdir()):
        if not item.is_file():
            continue
        if item.name.startswith(".") or item.name.endswith(".tmp.csv") or item.name.endswith(".tmp.json"):
            continue
        if item.name == "bandar_detector_summary.csv":
            continue

        symbol = None
        # Check per-day detail file: {symbol}_YYYY-MM-DD_YYYY-MM-DD.csv / .json
        m_day = re.match(r"^([A-Z0-9._-]+)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.(csv|json)$", item.name, re.I)
        if m_day:
            symbol = m_day.group(1).upper()
        else:
            # Check symbol summary file: {symbol}.csv
            m_sym = re.match(r"^([A-Z0-9._-]+)\.csv$", item.name, re.I)
            if m_sym and m_sym.group(1).lower() != "bandar_detector_summary":
                symbol = m_sym.group(1).upper()

        if symbol:
            symbol_dir = output_dir / symbol
            symbol_dir.mkdir(parents=True, exist_ok=True)
            dest = symbol_dir / item.name
            if not dest.exists():
                try:
                    shutil.move(str(item), str(dest))
                except Exception as e:
                    print(f"  [Peringatan] Gagal memindahkan {item.name} ke {symbol_dir}: {e}")
            else:
                try:
                    item.unlink()
                except Exception:
                    pass


def get_last_saved_date(symbol: str, target_dir: Path, fallback_dir: Optional[Path] = None) -> Optional[str]:
    """Check last saved date from symbol daily summary CSV or per-day CSV files."""
    dirs_to_check = [target_dir]
    if fallback_dir and fallback_dir.resolve() != target_dir.resolve():
        dirs_to_check.append(fallback_dir)

    for directory in dirs_to_check:
        if not directory or not directory.exists():
            continue

        symbol_file = directory / f"{symbol}.csv"
        if symbol_file.exists():
            last_date = None
            try:
                with symbol_file.open("r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        if row.get("date"):
                            last_date = row["date"]
                if last_date:
                    return last_date
            except Exception:
                pass

        # Check per-day files {symbol}_YYYY-MM-DD_YYYY-MM-DD.csv
        pattern = re.compile(rf"^{re.escape(symbol)}_(\d{{4}}-\d{{2}}-\d{{2}})_(\d{{4}}-\d{{2}}-\d{{2}})\.csv$")
        dates = []
        for p in directory.glob(f"{symbol}_*.csv"):
            m = pattern.match(p.name)
            if m:
                dates.append(m.group(2))
        if dates:
            return max(dates)

    return None


def read_existing_symbol_data(filepath: Path) -> Dict[str, Dict[str, Any]]:
    """Read existing daily bandarmology rows indexed by date."""
    if not filepath.exists():
        return {}
    data_by_date = {}
    try:
        with filepath.open("r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("date"):
                    data_by_date[row["date"]] = row
    except Exception:
        pass
    return data_by_date


def get_trading_days(
    start_date_str: str,
    end_date_str: str,
    symbol: Optional[str] = None,
) -> List[str]:
    """Generate list of trading days between start and end (skipping weekends and holidays)."""
    # 1. If data/{symbol}.csv exists, leverage its actual historical trading calendar
    if symbol:
        daily_csv = Path(f"data/{symbol}.csv")
        if daily_csv.exists():
            known_dates = set()
            try:
                with daily_csv.open("r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        d = row.get("date")
                        if d and start_date_str <= d <= end_date_str:
                            known_dates.add(d)
                # If today is a weekday and trading, include today even if daily CSV hasn't scraped today yet
                now_wib = datetime.now(tz=WIB)
                today_str = now_wib.strftime("%Y-%m-%d")
                if now_wib.weekday() < 5 and start_date_str <= today_str <= end_date_str:
                    known_dates.add(today_str)
                if known_dates:
                    return sorted(known_dates)
            except Exception:
                pass

    # 2. Otherwise generate Monday-Friday business days
    start_dt = datetime.strptime(start_date_str, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date_str, "%Y-%m-%d")

    dates: List[str] = []
    curr = start_dt
    while curr <= end_dt:
        if curr.weekday() < 5:  # Monday = 0, Friday = 4
            dates.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)

    return sorted(dates)


def print_terminal_table(
    symbol: str,
    date_str: str,
    bandar: Dict[str, Any],
    buy_rows: List[Dict[str, Any]],
    sell_rows: List[Dict[str, Any]],
) -> None:
    action = bandar.get("broker_accdist") or "Neutral"
    t1 = bandar.get("top1") or {}
    t3 = bandar.get("top3") or {}

    t1_str = f"{t1.get('accdist', '-')}"
    if "percent" in t1:
        t1_str += f" ({t1['percent']:.1f}%)"
    t3_str = f"{t3.get('accdist', '-')}"
    if "percent" in t3:
        t3_str += f" ({t3['percent']:.1f}%)"

    tot_val = format_currency(safe_float(bandar.get("value")))
    tot_vol = format_lot(safe_float(bandar.get("volume")))
    n_buyers = bandar.get("total_buyer", 0)
    n_sellers = bandar.get("total_seller", 0)

    print("\n" + "=" * 80)
    print(f" BROKER SUMMARY: {symbol}  ({date_str})")
    print(f" Bandar Detector : {action} | Top 1: {t1_str} | Top 3: {t3_str}")
    print(f" Buyers: {n_buyers} | Sellers: {n_sellers} | Total Val: {tot_val} | Vol: {tot_vol} Lot")
    print("-" * 80)
    print("  # BUYER  TYPE      LOT     VALUE    AVG  |  # SELLER TYPE      LOT     VALUE    AVG")
    print("-" * 80)

    max_rows = min(10, max(len(buy_rows), len(sell_rows)))
    if max_rows == 0:
        print("                 (Tidak ada transaksi / data kosong)")
    else:
        for i in range(max_rows):
            if i < len(buy_rows):
                b = buy_rows[i]
                b_str = f"{i+1:2d} {b['broker_code']:<5} {b['type']:<5} {format_lot(b['lot']):>7} {format_currency(b['value']):>9} {b['avg_price']:>6.1f}"
            else:
                b_str = " " * 38

            if i < len(sell_rows):
                s = sell_rows[i]
                s_str = f"{i+1:2d} {s['broker_code']:<5} {s['type']:<5} {format_lot(s['lot']):>7} {format_currency(s['value']):>9} {s['avg_price']:>6.1f}"
            else:
                s_str = ""

            print(f" {b_str} | {s_str}")
    print("=" * 80 + "\n")


def parse_broker_data(
    symbol: str,
    date_str: str,
    payload_data: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    bs = payload_data.get("broker_summary") or {}
    bandar = payload_data.get("bandar_detector") or {}

    buy_list = bs.get("brokers_buy") or []
    sell_list = bs.get("brokers_sell") or []

    buy_rows: List[Dict[str, Any]] = []
    for idx, b in enumerate(buy_list, start=1):
        buy_rows.append({
            "side": "BUY",
            "rank": idx,
            "symbol": symbol,
            "broker_code": b.get("netbs_broker_code", ""),
            "type": b.get("type", "Lokal"),
            "lot": safe_int(b.get("blot")),
            "shares": safe_int(b.get("blotv")),
            "value": safe_float(b.get("bval")),
            "avg_price": round(safe_float(b.get("netbs_buy_avg_price")), 2),
            "freq": safe_int(b.get("freq")),
            "from_date": date_str,
            "to_date": date_str,
        })

    sell_rows: List[Dict[str, Any]] = []
    for idx, s in enumerate(sell_list, start=1):
        sell_rows.append({
            "side": "SELL",
            "rank": idx,
            "symbol": symbol,
            "broker_code": s.get("netbs_broker_code", ""),
            "type": s.get("type", "Lokal"),
            "lot": safe_int(s.get("slot")),
            "shares": safe_int(s.get("slotv")),
            "value": safe_float(s.get("sval")),
            "avg_price": round(safe_float(s.get("netbs_sell_avg_price")), 2),
            "freq": safe_int(s.get("freq")),
            "from_date": date_str,
            "to_date": date_str,
        })

    t1 = bandar.get("top1") or {}
    t3 = bandar.get("top3") or {}
    t5 = bandar.get("top5") or {}
    t10 = bandar.get("top10") or {}

    top_b_strs = [
        f"{r['broker_code']}:{format_lot(r['lot'])}@{r['avg_price']:.0f}"
        for r in buy_rows[:3]
    ]
    top_s_strs = [
        f"{r['broker_code']}:{format_lot(r['lot'])}@{r['avg_price']:.0f}"
        for r in sell_rows[:3]
    ]

    daily_summary = {
        "date": date_str,
        "symbol": symbol,
        "broker_accdist": bandar.get("broker_accdist", ""),
        "average_price": round(safe_float(bandar.get("average")), 2),
        "total_buyer": safe_int(bandar.get("total_buyer")),
        "total_seller": safe_int(bandar.get("total_seller")),
        "buyer_seller_diff": safe_int(bandar.get("number_broker_buysell")),
        "total_value": safe_float(bandar.get("value")),
        "total_volume_lot": safe_int(bandar.get("volume")),
        "top1_accdist": t1.get("accdist", ""),
        "top1_amount": safe_float(t1.get("amount")),
        "top1_percent": round(safe_float(t1.get("percent")), 2),
        "top1_vol": safe_int(t1.get("vol")),
        "top3_accdist": t3.get("accdist", ""),
        "top3_amount": safe_float(t3.get("amount")),
        "top3_percent": round(safe_float(t3.get("percent")), 2),
        "top3_vol": safe_int(t3.get("vol")),
        "top5_accdist": t5.get("accdist", ""),
        "top5_amount": safe_float(t5.get("amount")),
        "top5_percent": round(safe_float(t5.get("percent")), 2),
        "top5_vol": safe_int(t5.get("vol")),
        "top10_accdist": t10.get("accdist", ""),
        "top10_amount": safe_float(t10.get("amount")),
        "top10_percent": round(safe_float(t10.get("percent")), 2),
        "top10_vol": safe_int(t10.get("vol")),
        "top_buyers": ", ".join(top_b_strs),
        "top_sellers": ", ".join(top_s_strs),
    }

    return buy_rows, sell_rows, daily_summary


def save_daily_ladder_files(
    symbol: str,
    date_str: str,
    output_dir: Path,
    buy_rows: List[Dict[str, Any]],
    sell_rows: List[Dict[str, Any]],
    raw_payload: Optional[Dict[str, Any]] = None,
    save_json: bool = True,
) -> None:
    csv_file = output_dir / f"{symbol}_{date_str}_{date_str}.csv"
    temp_csv = output_dir / f"{symbol}_{date_str}_{date_str}.tmp.csv"

    all_rows = buy_rows + sell_rows
    with temp_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=BROKER_DETAIL_CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in all_rows:
            writer.writerow(row)
    os.replace(temp_csv, csv_file)

    if save_json and raw_payload:
        json_file = output_dir / f"{symbol}_{date_str}_{date_str}.json"
        temp_json = output_dir / f"{symbol}_{date_str}_{date_str}.tmp.json"
        with temp_json.open("w", encoding="utf-8") as f:
            json.dump(raw_payload, f, indent=2, ensure_ascii=False)
        os.replace(temp_json, json_file)


def update_symbol_time_series_csv(
    symbol: str,
    output_dir: Path,
    new_daily_rows: List[Dict[str, Any]],
) -> Path:
    """Merge new daily rows into data_broker_summary/{symbol}.csv like stockbit_daily_historical_scraper.py."""
    filepath = output_dir / f"{symbol}.csv"
    all_data = read_existing_symbol_data(filepath)

    for row in new_daily_rows:
        all_data[row["date"]] = row

    sorted_dates = sorted(all_data.keys())
    temp_filepath = filepath.with_suffix(".tmp.csv")
    with temp_filepath.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=DAILY_SUMMARY_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for d in sorted_dates:
            writer.writerow(all_data[d])

    os.replace(temp_filepath, filepath)
    return filepath


def update_consolidated_summary(
    output_dir: Path,
    latest_summaries: List[Dict[str, Any]],
) -> Path:
    summary_file = output_dir / "bandar_detector_summary.csv"
    existing_map: Dict[str, Dict[str, Any]] = {}

    if summary_file.exists():
        try:
            with summary_file.open("r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    sym = row.get("symbol")
                    if sym:
                        existing_map[sym] = row
        except Exception as e:
            print(f"  [Peringatan] Gagal membaca bandar_detector_summary.csv: {e}")

    for s in latest_summaries:
        existing_map[s["symbol"]] = s

    sorted_symbols = sorted(existing_map.keys())
    temp_summary = output_dir / "bandar_detector_summary.tmp.csv"
    with temp_summary.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=DAILY_SUMMARY_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for sym in sorted_symbols:
            writer.writerow(existing_map[sym])

    os.replace(temp_summary, summary_file)
    return summary_file


def is_empty_summary(summary: Optional[Dict[str, Any]]) -> bool:
    """Check if a daily summary represents an empty/no-activity trading day."""
    if summary is None:
        return True
    vol = safe_int(summary.get("total_volume_lot"))
    buyers = safe_int(summary.get("total_buyer"))
    sellers = safe_int(summary.get("total_seller"))
    return vol == 0 and buyers == 0 and sellers == 0


def fetch_single_date(
    symbol: str,
    d: str,
    symbol_dir: Path,
    token: str,
    transaction_type: str,
    market_board: str,
    investor_type: str,
    limit: int,
    save_json: bool,
    force: bool,
    today_str: str,
) -> Tuple[str, Optional[Dict[str, Any]], Optional[Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]], Optional[Exception]]:
    """Fetch a single date's broker data. Thread-safe — no shared mutable state.

    Returns:
        (date_str, daily_summary_dict, (buy_rows, sell_rows, payload_data), error)
        On success error is None; on failure daily_summary and detail are None.
    """
    try:
        json_file = symbol_dir / f"{symbol}_{d}_{d}.json"

        # Check disk cache first (skip API call if data exists locally)
        if not force and d != today_str and json_file.exists() and json_file.stat().st_size > 50:
            try:
                with json_file.open("r", encoding="utf-8") as f:
                    resp = json.load(f)
                payload_data = resp.get("data") or {}
                buy_rows, sell_rows, daily_summary = parse_broker_data(symbol, d, payload_data)
                return (d, daily_summary, (buy_rows, sell_rows, payload_data), None)
            except Exception:
                pass  # Fall through to API fetch

        url = build_url(
            symbol=symbol,
            from_date=d,
            to_date=d,
            transaction_type=transaction_type,
            market_board=market_board,
            investor_type=investor_type,
            limit=limit,
        )

        resp = request_json(url, token)
        payload_data = resp.get("data") or {}

        buy_rows, sell_rows, daily_summary = parse_broker_data(
            symbol=symbol,
            date_str=d,
            payload_data=payload_data,
        )

        save_daily_ladder_files(
            symbol=symbol,
            date_str=d,
            output_dir=symbol_dir,
            buy_rows=buy_rows,
            sell_rows=sell_rows,
            raw_payload=resp,
            save_json=save_json,
        )

        return (d, daily_summary, (buy_rows, sell_rows, payload_data), None)

    except Exception as e:
        return (d, None, None, e)


def process_symbol_incremental(
    symbol: str,
    token: str,
    output_dir: Path,
    delay: float,
    start_date_arg: Optional[str] = None,
    end_date_arg: Optional[str] = None,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    transaction_type: str = "TRANSACTION_TYPE_GROSS",
    market_board: str = "MARKET_BOARD_REGULER",
    investor_type: str = "INVESTOR_TYPE_ALL",
    limit: int = DEFAULT_LIMIT,
    save_json: bool = True,
    force: bool = False,
    is_single: bool = False,
    max_workers: int = DEFAULT_WORKERS,
) -> Optional[Dict[str, Any]]:
    # Create dedicated subfolder for each stock: data_broker_summary/{symbol}/
    symbol_dir = output_dir / symbol
    symbol_dir.mkdir(parents=True, exist_ok=True)
    migrate_existing_files_for_symbol(symbol, output_dir, symbol_dir)

    today_str = datetime.now(tz=WIB).strftime("%Y-%m-%d")
    end_date = end_date_arg or today_str

    last_date = get_last_saved_date(symbol, symbol_dir, fallback_dir=output_dir)

    if last_date:
        if is_single:
            print(f"  Data terakhir tersimpan: {last_date}")
        if start_date_arg:
            start_date = start_date_arg
        else:
            # Incremental: fetch from last_date up to end_date
            start_date = last_date
    else:
        if is_single:
            print(f"  Belum ada data sebelumnya. Mengunduh riwayat mundur dari {end_date}...")
        if start_date_arg:
            start_date = start_date_arg
        else:
            calc_start = datetime.now(tz=WIB) - timedelta(days=lookback_days)
            start_date = calc_start.strftime("%Y-%m-%d")

    target_dates = get_trading_days(start_date, end_date, symbol=symbol)

    if not target_dates:
        if is_single:
            print(f"  Tidak ada tanggal perdagangan dalam rentang {start_date} s/d {end_date}.")
        return None

    # Filter dates that actually need downloading
    dates_to_fetch = []
    for d in target_dates:
        detail_csv = symbol_dir / f"{symbol}_{d}_{d}.csv"
        # If force is true, or date is today (allow updating closing data), or file doesn't exist
        if force or d == today_str or not detail_csv.exists() or detail_csv.stat().st_size <= 50:
            dates_to_fetch.append(d)

    if not dates_to_fetch:
        if is_single:
            print(f"  Data sudah lengkap dan terbaru ({last_date}).")
        # Return the latest summary from existing data
        all_data = read_existing_symbol_data(symbol_dir / f"{symbol}.csv")
        if all_data:
            latest_k = max(all_data.keys())
            return all_data[latest_k]
        return None

    # Determine effective worker count
    effective_workers = min(max(max_workers, 1), 10, len(dates_to_fetch))

    if is_single:
        if effective_workers > 1:
            print(f"  Mengunduh broker summary untuk {len(dates_to_fetch)} tanggal dengan {effective_workers} worker: {dates_to_fetch[0]} .. {dates_to_fetch[-1]}")
        else:
            print(f"  Mengunduh broker summary untuk {len(dates_to_fetch)} tanggal: {dates_to_fetch[0]} .. {dates_to_fetch[-1]}")

    new_daily_rows: List[Dict[str, Any]] = []
    last_fetched_payload: Optional[Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]] = None

    fetch_start = time.time()
    error_count = 0
    skipped_empty = False

    if effective_workers <= 1:
        # Serial mode (backward compatible, --workers 1)
        consecutive_empty = 0
        for d_idx, d in enumerate(dates_to_fetch, start=1):
            d_str, daily_summary, detail_data, error = fetch_single_date(
                symbol=symbol,
                d=d,
                symbol_dir=symbol_dir,
                token=token,
                transaction_type=transaction_type,
                market_board=market_board,
                investor_type=investor_type,
                limit=limit,
                save_json=save_json,
                force=force,
                today_str=today_str,
            )

            if error is not None:
                # AuthenticationError is always fatal — stop everything
                if isinstance(error, AuthenticationError):
                    raise error
                # Other errors: skip this date and continue
                error_count += 1
                if is_single:
                    print(f"    [!] Gagal tanggal {d}: {error} -> Lewati")
                elif error_count <= 3:
                    # Only print first few errors in batch mode to avoid spam
                    print(f" [!] {d}: {error}", end="", flush=True)
                consecutive_empty += 1  # Treat errors as empty for skip logic
                if d_idx < len(dates_to_fetch):
                    time.sleep(delay)
                continue

            if daily_summary:
                new_daily_rows.append(daily_summary)
            if detail_data:
                last_fetched_payload = detail_data

            # Track consecutive empty days
            if is_empty_summary(daily_summary):
                consecutive_empty += 1
            else:
                consecutive_empty = 0

            if is_single and len(dates_to_fetch) > 1 and daily_summary:
                action = daily_summary.get("broker_accdist") or "Neutral"
                tot_v = format_currency(daily_summary.get("total_value", 0))
                empty_tag = " (kosong)" if is_empty_summary(daily_summary) else ""
                print(f"    [{d_idx}/{len(dates_to_fetch)}] {d}: {action:<8} | Val: {tot_v}{empty_tag}")

            # Skip to next stock if CONSECUTIVE_EMPTY_SKIP days in a row are empty
            if consecutive_empty >= CONSECUTIVE_EMPTY_SKIP:
                remaining = len(dates_to_fetch) - d_idx
                if remaining > 0:
                    skipped_empty = True
                    if is_single:
                        print(f"    ⏭ {consecutive_empty} hari berturut-turut kosong, melewati {remaining} tanggal tersisa")
                    break

            if d_idx < len(dates_to_fetch):
                time.sleep(delay)
    else:
        # Concurrent mode: submit dates in batches to allow early termination
        # Process in chronological batches of `effective_workers` to detect consecutive empty runs
        total = len(dates_to_fetch)
        completed = 0
        consecutive_empty = 0
        batch_start = 0

        while batch_start < total:
            batch_end = min(batch_start + effective_workers, total)
            batch_dates = dates_to_fetch[batch_start:batch_end]
            batch_results: List[Tuple[str, Optional[Dict[str, Any]], Optional[Tuple], Optional[Exception]]] = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=effective_workers) as executor:
                futures: Dict[concurrent.futures.Future, str] = {}
                stagger_delay = delay / effective_workers

                for i, d in enumerate(batch_dates):
                    if i > 0:
                        time.sleep(stagger_delay)
                    fut = executor.submit(
                        fetch_single_date,
                        symbol=symbol,
                        d=d,
                        symbol_dir=symbol_dir,
                        token=token,
                        transaction_type=transaction_type,
                        market_board=market_board,
                        investor_type=investor_type,
                        limit=limit,
                        save_json=save_json,
                        force=force,
                        today_str=today_str,
                    )
                    futures[fut] = d

                for fut in concurrent.futures.as_completed(futures):
                    d_str, daily_summary, detail_data, error = fut.result()
                    completed += 1

                    if error is not None:
                        # AuthenticationError is always fatal
                        if isinstance(error, AuthenticationError):
                            for remaining_fut in futures:
                                remaining_fut.cancel()
                            raise error
                        # Other errors: skip this date
                        error_count += 1
                        if is_single:
                            print(f"    [!] Gagal tanggal {d_str}: {error} -> Lewati")
                        batch_results.append((d_str, None, None, error))
                        continue

                    batch_results.append((d_str, daily_summary, detail_data, None))

                    if is_single and total > 1 and daily_summary:
                        action = daily_summary.get("broker_accdist") or "Neutral"
                        tot_v = format_currency(daily_summary.get("total_value", 0))
                        empty_tag = " (kosong)" if is_empty_summary(daily_summary) else ""
                        print(f"    [{completed}/{total}] {d_str}: {action:<8} | Val: {tot_v}{empty_tag}")

            # Sort this batch chronologically for proper consecutive-empty tracking
            batch_results.sort(key=lambda x: x[0])

            for d_str, daily_summary, detail_data, err in batch_results:
                if err is not None:
                    consecutive_empty += 1
                    continue
                if daily_summary:
                    new_daily_rows.append(daily_summary)
                if detail_data:
                    last_fetched_payload = detail_data
                if is_empty_summary(daily_summary):
                    consecutive_empty += 1
                else:
                    consecutive_empty = 0

            # Check consecutive empty threshold after each batch
            if consecutive_empty >= CONSECUTIVE_EMPTY_SKIP:
                remaining = total - batch_end
                if remaining > 0:
                    skipped_empty = True
                    if is_single:
                        print(f"    ⏭ {consecutive_empty} hari berturut-turut kosong, melewati {remaining} tanggal tersisa")
                    break

            batch_start = batch_end

    fetch_elapsed = time.time() - fetch_start

    if is_single and len(dates_to_fetch) > 1:
        skip_info = ""
        if error_count > 0:
            skip_info += f", {error_count} gagal"
        if skipped_empty:
            skip_info += f", sisa dilewati (kosong)"
        print(f"    ✓ Selesai {len(new_daily_rows)} tanggal dalam {fetch_elapsed:.1f}s ({effective_workers} worker{skip_info})")

    # Merge into data_broker_summary/{symbol}/{symbol}.csv
    if new_daily_rows:
        update_symbol_time_series_csv(symbol, symbol_dir, new_daily_rows)

    # If single mode, show formatted terminal table for latest fetched date
    if is_single and last_fetched_payload:
        buy_rows, sell_rows, pdata = last_fetched_payload
        print_terminal_table(
            symbol=symbol,
            date_str=new_daily_rows[-1]["date"],
            bandar=pdata.get("bandar_detector") or {},
            buy_rows=buy_rows,
            sell_rows=sell_rows,
        )

    return new_daily_rows[-1] if new_daily_rows else None


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        print(f"Stockbit Broker Summary & Bandarmology Scraper v{SCRIPT_VERSION}")

        tx_type = TRANSACTION_TYPE_CHOICES.get(
            args.transaction_type.upper(), "TRANSACTION_TYPE_GROSS"
        )
        mb_board = MARKET_BOARD_CHOICES.get(
            args.market_board.upper(), "MARKET_BOARD_REGULER"
        )
        inv_type = INVESTOR_TYPE_CHOICES.get(
            args.investor_type.upper(), "INVESTOR_TYPE_ALL"
        )
        limit = max(1, min(args.limit, 50))
        max_workers = max(1, min(args.workers, 10))

        script_dir = Path(__file__).resolve().parent
        symbols: List[str] = []
        is_single = False

        if args.symbol:
            symbols = [normalize_symbol(args.symbol)]
            is_single = True
        elif args.symbols_file:
            sym_file = Path(args.symbols_file).expanduser()
            if not sym_file.exists() and (script_dir / args.symbols_file).exists():
                sym_file = script_dir / args.symbols_file
            symbols = load_symbols(str(sym_file))
            print(f"Memuat {len(symbols)} kode saham dari {sym_file}")
        else:
            default_ihsg_path = Path("data/ihsg_list.csv")
            if not default_ihsg_path.exists() and (script_dir / "data/ihsg_list.csv").exists():
                default_ihsg_path = script_dir / "data/ihsg_list.csv"
            if default_ihsg_path.exists():
                symbols = load_symbols(str(default_ihsg_path))
                print(f"Menggunakan default daftar IHSG: {default_ihsg_path} ({len(symbols)} saham)")
            else:
                raw_symbol = input("Kode saham tunggal (contoh MDIA) atau tekan Enter untuk input file: ")
                if raw_symbol.strip():
                    symbols = [normalize_symbol(raw_symbol)]
                    is_single = True
                else:
                    raw_file = input("Path ke file CSV/TXT berisi daftar saham: ")
                    if raw_file.strip():
                        sym_file = Path(raw_file).expanduser()
                        if not sym_file.exists() and (script_dir / raw_file).exists():
                            sym_file = script_dir / raw_file
                        symbols = load_symbols(str(sym_file))
                        print(f"Memuat {len(symbols)} kode saham dari {sym_file}")
                    else:
                        raise ScraperError("Harus memasukkan kode saham atau file.")

        raw_token = os.environ.get("STOCKBIT_TOKEN")
        if not raw_token:
            print(
                "\nToken hanya dipakai di memori selama proses dan tidak ditulis ke file.\n"
                "Gunakan token baru dari sesi Stockbit yang aktif; jangan kirim token kepada siapa pun."
            )
            raw_token = getpass.getpass("Tempel token Authorization/Bearer (teks tidak akan terlihat): ")
        else:
            print("\nMenggunakan Stockbit Token dari environment variable STOCKBIT_TOKEN.")

        token = extract_token(raw_token)
        raw_token = ""
        validate_token(token)

        output_dir = Path(args.output_dir).expanduser()
        if not output_dir.is_absolute() and not output_dir.exists() and (script_dir / args.output_dir).exists():
            output_dir = script_dir / args.output_dir
        output_dir = output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        migrate_all_legacy_flat_files(output_dir)
        print(f"Folder penyimpanan: {output_dir}/ (subfolder per saham: {output_dir}/<KODE>/)")
        print(f"Mode inkremental: mengunduh dari tanggal terakhir s/d {args.to_date}")
        print(f"Parameter: {tx_type}, {mb_board}, {inv_type}, limit={limit}, workers={max_workers}")
        print(f"Total saham yang akan diproses: {len(symbols)}\n")

        processed_summaries: List[Dict[str, Any]] = []
        start_time = time.time()
        skipped_count = 0
        success_count = 0
        error_count = 0

        for idx, symbol in enumerate(symbols, start=1):
            try:
                if not is_single:
                    print(f"[{idx}/{len(symbols)}] Memproses {symbol}...", end="", flush=True)

                summary = process_symbol_incremental(
                    symbol=symbol,
                    token=token,
                    output_dir=output_dir,
                    delay=args.delay,
                    start_date_arg=args.from_date,
                    end_date_arg=args.to_date,
                    lookback_days=args.lookback_days,
                    transaction_type=tx_type,
                    market_board=mb_board,
                    investor_type=inv_type,
                    limit=limit,
                    save_json=not args.no_json,
                    force=args.force,
                    is_single=is_single,
                    max_workers=max_workers,
                )

                if summary is None:
                    skipped_count += 1
                    if not is_single:
                        print(" Sudah terbaru -> Lewati", flush=True)
                else:
                    success_count += 1
                    processed_summaries.append(summary)
                    if not is_single:
                        action = summary.get("broker_accdist") or "Neutral"
                        t3_p = summary.get("top3_percent", 0.0)
                        tot_v = format_currency(summary.get("total_value", 0))
                        dt = summary.get("date", "")
                        print(f" {dt} [{action:<7} (Top 3: {t3_p:>5.1f}%) | Val: {tot_v:>8}] -> Berhasil", flush=True)

                if len(processed_summaries) > 0 and len(processed_summaries) % 10 == 0:
                    update_consolidated_summary(output_dir, processed_summaries)

                if idx < len(symbols):
                    time.sleep(args.delay)

            except AuthenticationError:
                raise
            except Exception as e:
                error_count += 1
                if not is_single:
                    print(f" GAGAL ({e})", flush=True)
                else:
                    print(f"  [!] Gagal memproses {symbol}: {e}", flush=True)

        if processed_summaries:
            update_consolidated_summary(output_dir, processed_summaries)

        elapsed = time.time() - start_time
        print(f"\nSELESAI dalam {elapsed:.1f}s.")
        print(f"Berhasil: {success_count}, Dilewati: {skipped_count}, Gagal: {error_count}")
        print(f"Folder data: {output_dir}/")
        print(f"File ringkasan pasar: {output_dir / 'bandar_detector_summary.csv'}")

        return 0

    except KeyboardInterrupt:
        print("\nDibatalkan oleh pengguna.", file=sys.stderr)
        return 130
    except AuthenticationError as error:
        print(f"\nGAGAL AUTENTIKASI: {error}", file=sys.stderr)
        return 2
    except ScraperError as error:
        print(f"\nGAGAL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
