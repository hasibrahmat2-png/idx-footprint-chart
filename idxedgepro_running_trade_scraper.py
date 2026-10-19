#!/usr/bin/env python3
"""
idxedgepro_running_trade_scraper.py - 30-Day Running Trade Scraper via IDXEDGEPRO
================================================================================
Downloads historical tick-level running trade (done details) order flow data
from IDXEDGEPRO (stock.arjum.com/api/done-details) for Indonesian equities (IDX).

Outputs identical CSV schema and directory structure as stockbit_running_trade_scraper_v2.py
and KAQI_running_trades/ for 100% seamless, conflict-free integration with build_unified_charts.py.

Automatically stores output on SD Card (/mnt/chromeos/removable/SD Card/idx_running_trades)
and manages symlinks in the workspace root to preserve internal Chromebook storage (0 bytes SSD used).

meow
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

# WIB Timezone (Jakarta UTC+7)
WIB = timezone(timedelta(hours=7))

SCRIPT_VERSION = "1.0.0"
BASE_URL = "https://stock.arjum.com/api/done-details"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Standard Stockbit / KAQI Running Trade CSV Header (100% parity)
CSV_FIELDS = [
    "date",
    "time",
    "code",
    "id",
    "trade_number",
    "price",
    "change",
    "change_pct",
    "action",
    "lot",
    "shares",
    "value_idr",
    "value_display",
    "buyer",
    "buyer_type",
    "seller",
    "seller_type",
    "market_board",
    "buy_order_number",
    "sell_order_number",
    "group_order_number",
    "is_broker_exists",
]

DEFAULT_SD_CARD_DIR = Path("/mnt/chromeos/removable/SD Card/idx_running_trades")


SCRIPT_DIR = Path(__file__).resolve().parent


def load_env_api_key() -> str:
    """Read STOCK_API_KEY from .env or environment variable."""
    key = os.environ.get("STOCK_API_KEY") or os.environ.get("IDX_API_KEY") or ""
    if key:
        return key.strip().strip("'\"")

    for env_path in [Path(".env"), SCRIPT_DIR / ".env"]:
        if env_path.exists():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if line.startswith("STOCK_API_KEY="):
                            return line.split("=", 1)[1].strip().strip("'\"")
                        elif line.startswith("IDX_API_KEY="):
                            return line.split("=", 1)[1].strip().strip("'\"")
            except Exception:
                pass
    return ""


def is_valid_equity_symbol(sym: str) -> bool:
    """
    IDX equity tickers are strictly 4 uppercase alphabetic letters (A-Z).
    Excludes composite and sector indices like IHSG, ISSI, LQ45, IDXMESBUMN, etc.
    """
    s = sym.strip().upper()
    if len(s) != 4 or not s.isalpha():
        return False
    if s in ("IHSG", "ISSI"):
        return False
    return True


def load_ihsg_whitelist() -> List[str]:
    """Load clean 4-letter equity stock symbols, skipping composite indices."""
    for json_path in [Path("indicator-examples/public/ihsg_stocks.json"), SCRIPT_DIR / "indicator-examples/public/ihsg_stocks.json"]:
        if json_path.exists():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    stocks = json.load(f)
                    if isinstance(stocks, list) and len(stocks) > 0:
                        return [str(s).strip().upper() for s in stocks if is_valid_equity_symbol(str(s))]
            except Exception:
                pass

    for csv_path in [Path("ihsg_list.csv"), SCRIPT_DIR / "data/ihsg_list.csv", SCRIPT_DIR / "ihsg_list.csv"]:
        if csv_path.exists():
            symbols: List[str] = []
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                for row in csv.reader(f):
                    if row and is_valid_equity_symbol(row[0]):
                        symbols.append(row[0].strip().upper())
            if symbols:
                return symbols

    return []



def format_display_val(val: int) -> str:
    """Format numerical value into compact string (e.g. 7.9K, 1.5M, 2.5B)."""
    abs_v = abs(val)
    sign = "-" if val < 0 else ""
    if abs_v >= 1_000_000_000:
        return f"{sign}{abs_v / 1_000_000_000:.2f}B"
    if abs_v >= 1_000_000:
        return f"{sign}{abs_v / 1_000_000:.1f}M"
    if abs_v >= 1_000:
        return f"{sign}{abs_v / 1_000:.1f}K"
    return f"{sign}{abs_v}"


def normalize_api_trade(t: Dict[str, Any], symbol: str, target_date: str) -> Dict[str, Any]:
    """Map IDXEDGEPRO /api/done-details item to exact Stockbit CSV schema."""
    price = int(t.get("price_num") or t.get("price") or 0)
    lot = int(t.get("qty_num") or t.get("lot") or 0)
    val_raw = int(t.get("value_raw") or (price * lot * 100))
    action_str = str(t.get("action") or "").lower()

    buyer = str(t.get("buyer") or "")
    seller = str(t.get("seller") or "")
    buyer_type = str(t.get("buyer_type") or "D")
    seller_type = str(t.get("seller_type") or "D")

    return {
        "date": str(t.get("market_date") or target_date),
        "time": str(t.get("time") or ""),
        "code": symbol,
        "id": "",
        "trade_number": "",
        "price": price,
        "change": "",
        "change_pct": "",
        "action": action_str,
        "lot": lot,
        "shares": lot * 100,
        "value_idr": val_raw,
        "value_display": format_display_val(val_raw),
        "buyer": f"{buyer} [{buyer_type}]" if buyer else "",
        "buyer_type": f"BROKER_TYPE_{'FOREIGN' if buyer_type == 'F' else 'LOCAL'}",
        "seller": f"{seller} [{seller_type}]" if seller else "",
        "seller_type": f"BROKER_TYPE_{'FOREIGN' if seller_type == 'F' else 'LOCAL'}",
        "market_board": str(t.get("market_board") or "RG"),
        "buy_order_number": str(t.get("buy_order_number") or ""),
        "sell_order_number": str(t.get("sell_order_number") or ""),
        "group_order_number": "",
        "is_broker_exists": "true" if (buyer or seller) else "false",
    }


import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from concurrent.futures import ThreadPoolExecutor, as_completed


def create_session(api_key: str, max_workers: int = 10) -> requests.Session:
    """Create a high-performance persistent HTTP session with connection pooling."""
    session = requests.Session()
    session.headers.update({
        "X-API-Key": api_key,
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    })
    adapter = HTTPAdapter(
        pool_connections=max_workers * 2,
        pool_maxsize=max_workers * 2,
        max_retries=Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504, 520, 521, 522, 524, 525, 530])
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class DailyQuotaExhaustedError(Exception):
    """Raised when the IDXEDGEPRO server returns 429 indicating daily quota exhaustion."""
    pass


class ServerOutageError(Exception):
    """Raised when origin server or Cloudflare tunnel is temporarily down (502, 503, 504, 530)."""
    pass


def fetch_page_with_retry(
    session: requests.Session,
    symbol: str,
    date_str: str,
    page: int,
    per_page: int = 100,
    retries: int = 5,
) -> List[Dict[str, Any]]:
    """Fetch a single page with retries on rate limits (429) and Cloudflare tunnel errors (530/5xx)."""
    url = f"{BASE_URL}?code={symbol}&date={date_str}&page={page}&per_page={per_page}"
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, timeout=20)
            rem = resp.headers.get("x-ratelimit-remaining")
            if rem is not None and rem.isdigit() and int(rem) <= 1:
                raise DailyQuotaExhaustedError(f"x-ratelimit-remaining tersisa {rem}. Kuota harian habis.")
            if resp.status_code == 200:
                payload = resp.json()
                return payload.get("data") or []
            elif resp.status_code == 422:
                return []
            elif resp.status_code == 429:
                err_text = ""
                try:
                    body = resp.json()
                    err_text = str(body.get("detail") or "")
                except Exception:
                    err_text = resp.text
                if any(w in err_text.lower() for w in ["kuota", "habis", "limit harian", "quota"]) or resp.headers.get("x-ratelimit-remaining") == "0":
                    raise DailyQuotaExhaustedError(err_text or "Kuota harian akun kamu sudah habis.")
                wait_sec = min(2 ** (attempt + 1), 20)
                time.sleep(wait_sec)
                continue
            elif resp.status_code in (500, 502, 503, 504, 520, 521, 522, 524, 525, 530):
                wait_sec = min(3 * (attempt + 1), 15)
                time.sleep(wait_sec)
                continue
            elif resp.status_code in (401, 403):
                raise RuntimeError(f"HTTP {resp.status_code}: API Key tidak valid atau langganan diperlukan.")
        except DailyQuotaExhaustedError:
            raise
        except (requests.RequestException, TimeoutError) as err:
            if attempt >= retries:
                print(f"      [!] Gagal memuat hal {page}: {err}")
                return []
            time.sleep(min(2 ** attempt, 10))
    return []


def scrape_stock_date_concurrent(
    session: requests.Session,
    symbol: str,
    date_str: str,
    stock_dir: Path,
    max_workers: int = 8,
) -> int:
    """Download running trades for one stock on one date concurrently. Returns total trade count."""
    final_file = stock_dir / f"running_trade_{symbol}_{date_str}.csv"
    partial_file = stock_dir / f"running_trade_{symbol}_{date_str}.partial.csv"

    # Incremental Resume: Skip if completed CSV already exists and has data (> 200 bytes)
    if final_file.exists() and final_file.stat().st_size > 200:
        print(f"  [>] {date_str}: Sudah ada. Dilewati.", flush=True)
        return 0

    # 1. Fetch Page 1 to inspect total pages & total count with 5xx/530 retry
    url_p1 = f"{BASE_URL}?code={symbol}&date={date_str}&page=1&per_page=100"
    p1_json = None
    for attempt in range(6):
        try:
            r1 = session.get(url_p1, timeout=20)
            rem = r1.headers.get("x-ratelimit-remaining")
            if rem is not None and rem.isdigit() and int(rem) <= 1:
                raise DailyQuotaExhaustedError(f"x-ratelimit-remaining tersisa {rem}. Kuota harian habis.")
            if r1.status_code == 429:
                err_text = ""
                try:
                    err_text = str(r1.json().get("detail") or "")
                except Exception:
                    err_text = r1.text
                raise DailyQuotaExhaustedError(err_text or "HTTP 429: Kuota harian akun kamu sudah habis.")
            if r1.status_code in (500, 502, 503, 504, 520, 521, 522, 524, 525, 530):
                if attempt < 5:
                    wait_sec = min(5 * (attempt + 1), 30)
                    print(f"  [!] HTTP {r1.status_code} ({symbol} {date_str} hal 1). Server sibuk/tunnel error. Menunggu {wait_sec}s...", flush=True)
                    time.sleep(wait_sec)
                    continue
                else:
                    raise ServerOutageError(f"Server Arjum down/tunnel error (HTTP {r1.status_code}) pada {symbol} {date_str}.")
            if r1.status_code == 200:
                p1_json = r1.json()
                break
            else:
                return 0
        except DailyQuotaExhaustedError:
            raise
        except ServerOutageError:
            raise
        except (requests.RequestException, TimeoutError) as e:
            if attempt < 5:
                time.sleep(5)
                continue
            raise ServerOutageError(f"Koneksi gagal ke server Arjum pada {symbol} {date_str}: {e}")

    if not p1_json:
        return 0

    data1 = p1_json.get("data") or []
    total_pages = int(p1_json.get("total_pages") or 0)

    if not data1 and total_pages == 0:
        with open(final_file, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            writer.writeheader()
        print(f"  [-] {date_str}: Tidak ada transaksi hari ini (0 trades).", flush=True)
        return 0

    total_pages = min(total_pages, 5000)
    print(f"  [+] {date_str}: Mengunduh {total_pages} halaman paralel (~{total_pages * 100:,} transaksi)...", flush=True)

    # Store pages in memory dictionary {page_num: [trades]}
    pages_dict: Dict[int, List[Dict[str, Any]]] = {1: data1}

    if total_pages > 1:
        pages_to_fetch = list(range(2, total_pages + 1))
        completed_pages = 1

        def worker_fetch(p: int) -> Tuple[int, List[Dict[str, Any]]]:
            items = fetch_page_with_retry(session, symbol, date_str, p, per_page=100)
            return p, items

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_page = {executor.submit(worker_fetch, p): p for p in pages_to_fetch}
            for future in as_completed(future_to_page):
                try:
                    p, items = future.result()
                    pages_dict[p] = items
                    completed_pages += 1
                    if completed_pages % 25 == 0 or completed_pages == total_pages:
                        pct = (completed_pages / total_pages) * 100
                        print(f"      Halaman {completed_pages}/{total_pages} ({pct:.0f}%) selesai", end="\r", flush=True)
                except DailyQuotaExhaustedError:
                    for f in future_to_page:
                        f.cancel()
                    raise

    # Reconstruct in chronological ascending order (earliest trades first, latest trades last)
    # /api/done-details returns page 1 = latest, page N = earliest.
    # Within each page, items are newest first. So we iterate page N..1 and reverse the list.
    all_trades: List[Dict[str, Any]] = []
    for p in range(total_pages, 0, -1):
        page_items = pages_dict.get(p) or []
        for item in reversed(page_items):
            all_trades.append(normalize_api_trade(item, symbol, date_str))

    total_written = len(all_trades)

    # Write directly to partial CSV
    with open(partial_file, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(all_trades)

    # Atomic rename from .partial.csv to final .csv
    if partial_file.exists():
        if final_file.exists():
            final_file.unlink()
        partial_file.rename(final_file)

    print(f"\n  [✓] {date_str}: Selesai! {total_written:,} transaksi tersimpan.", flush=True)
    return total_written


import shutil


def setup_storage_paths(symbol: str, custom_output_dir: Optional[str] = None) -> Tuple[Path, Path]:
    """
    Resolve storage directory on SD Card or local directory.
    Saves strictly to SD Card without cluttering the local workspace with symlinks.
    Automatically migrates any existing physical folders on SSD to SD Card.
    """
    if custom_output_dir:
        target_base = Path(custom_output_dir).resolve()
    elif DEFAULT_SD_CARD_DIR.exists():
        target_base = DEFAULT_SD_CARD_DIR.resolve()
    else:
        target_base = Path(".").resolve()

    stock_dir = target_base / f"{symbol}_running_trades"
    stock_dir.mkdir(parents=True, exist_ok=True)

    # Clean up any leftover local symlinks in SCRIPT_DIR
    local_path = (SCRIPT_DIR / f"{symbol}_running_trades").resolve()
    if local_path != stock_dir.resolve():
        if local_path.is_symlink():
            try:
                local_path.unlink()
            except Exception:
                pass
        elif local_path.exists() and local_path.is_dir():
            print(f"  [+] Memindahkan data lokal {local_path} ke SD Card...")
            for f in local_path.glob("*.csv"):
                dest = stock_dir / f.name
                if not dest.exists():
                    shutil.move(str(f), str(dest))
                else:
                    f.unlink()
            try:
                local_path.rmdir()
            except Exception:
                shutil.rmtree(local_path, ignore_errors=True)

    return stock_dir, stock_dir



def get_target_dates(days: int = 30, specific_date: Optional[str] = None) -> List[str]:
    """Generate list of date strings descending (newest first), skipping weekends."""
    if specific_date:
        if "," in specific_date:
            return sorted([d.strip() for d in specific_date.split(",") if d.strip()], reverse=True)
        return [specific_date]

    now_wib = datetime.now(WIB)
    dates: List[str] = []
    for d in range(days):
        dt = now_wib - timedelta(days=d)
        if dt.weekday() in (5, 6):
            continue
        dates.append(dt.strftime("%Y-%m-%d"))
    return dates


def run_scraper():
    parser = argparse.ArgumentParser(
        description="Unduh running trade 30 hari IDXEDGEPRO ke SD Card dengan kecepatan tinggi (paralel)."
    )
    parser.add_argument("-s", "--symbol", help="Kode saham tunggal (contoh: KAQI, BBRI)")
    parser.add_argument("-f", "--file", help="File CSV daftar saham (default: ihsg_list.csv)")
    parser.add_argument("-d", "--date", help="Tanggal spesifik YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=30, help="Jumlah hari ke belakang (default: 30)")
    parser.add_argument("-w", "--workers", type=int, default=8, help="Jumlah worker HTTP paralel per hari (default: 8)")
    parser.add_argument("-o", "--output-dir", help="Direktori target penyimpanan (default: SD Card)")
    parser.add_argument("--key", help="STOCK_API_KEY dari IDXEDGEPRO")

    args = parser.parse_args()

    api_key = args.key or load_env_api_key()
    if not api_key:
        print("[!] ERROR: STOCK_API_KEY tidak ditemukan di .env atau argumen --key.")
        sys.exit(1)

    # Determine symbols (strictly 4-letter equity stocks, no indices)
    symbols: List[str] = []
    if args.symbol:
        sym = args.symbol.strip().upper()
        if not is_valid_equity_symbol(sym):
            print(f"[!] PERINGATAN: '{sym}' bukan kode saham 4-huruf yang valid, tetapi akan tetap diproses.")
        symbols = [sym]
    elif args.file:
        csv_file = Path(args.file)
        if not csv_file.exists():
            print(f"[!] ERROR: File {args.file} tidak ditemukan.")
            sys.exit(1)
        with open(csv_file, "r", encoding="utf-8-sig") as f:
            for row in csv.reader(f):
                if row and is_valid_equity_symbol(row[0]):
                    symbols.append(row[0].strip().upper())
    else:
        # Default to clean 4-letter IHSG equity whitelist
        symbols = load_ihsg_whitelist()

    if not symbols:
        print("[!] Tidak ada kode saham 4-huruf yang ditemukan.")
        sys.exit(1)


    target_dates = get_target_dates(days=args.days, specific_date=args.date)

    # Display execution banner
    storage_desc = args.output_dir or (str(DEFAULT_SD_CARD_DIR) if DEFAULT_SD_CARD_DIR.exists() else "Local project directory")
    print("\n" + "=" * 65)
    print(" [IDXEDGEPRO 30-DAY CONCURRENT RUNNING TRADE SCRAPER]")
    print(f" Target Saham      : {len(symbols)} saham ({symbols[0]} .. {symbols[-1]})")
    print(f" Rentang Tanggal   : {len(target_dates)} hari bursa ({target_dates[-1]} s/d {target_dates[0]})")
    print(f" Worker Paralel    : {args.workers} concurrent threads")
    print(f" Lokasi Output     : {storage_desc}")
    print(f" API Key           : {api_key[:10]}••••••••")
    print("=" * 65 + "\n")

    grand_total_trades = 0
    start_time = time.time()

    # Reusable HTTP session with connection pooling
    session = create_session(api_key, max_workers=args.workers)

    for idx, sym in enumerate(symbols, 1):
        stock_dir, _ = setup_storage_paths(sym, args.output_dir)
        print(f"\n--- [{idx}/{len(symbols)}] Memproses Saham: {sym} ---")

        stock_trades = 0
        for d_str in target_dates:
            try:
                count = scrape_stock_date_concurrent(
                    session=session,
                    symbol=sym,
                    date_str=d_str,
                    stock_dir=stock_dir,
                    max_workers=args.workers,
                )
                stock_trades += count
            except DailyQuotaExhaustedError as qe:
                status_file = Path("data/last_scraped_footprint_status.json")
                status_data = {
                    "status": "QUOTA_EXHAUSTED",
                    "target_date": d_str,
                    "last_symbol": sym,
                    "last_index": idx,
                    "total_symbols": len(symbols),
                    "remaining_symbols_count": len(symbols) - idx + 1,
                    "message": str(qe),
                    "timestamp": datetime.now(WIB).isoformat(),
                }
                try:
                    with open(status_file, "w", encoding="utf-8") as sf:
                        json.dump(status_data, sf, indent=2)
                except Exception:
                    pass
                print(f"\n\n{'=' * 65}")
                print(" [!] KUOTA HARIAN API IDXEDGEPRO SUDAH HABIS")
                print(f" Pesan Server : {qe}")
                print(f" Terhenti di  : Saham {sym} ({idx}/{len(symbols)}) tanggal {d_str}")
                print(f" Status File  : Tersimpan di {status_file}")
                print(f" Progres Aman : Semua data sebelum saham ini tersimpan utuh di SD Card.")
                print(" [i] TIPS: Kuota harian akan otomatis di-reset besok (00:00 WIB).")
                print("          Jalankan perintah yang sama besok, script otomatis melanjutkan!")
                print(f"{'=' * 65}\n")
                sys.exit(0)
            except ServerOutageError as soe:
                print(f"\n[!] Gangguan Server / Cloudflare Tunnel: {soe}", flush=True)
                print("[!] Menunggu 30 detik agar tunnel server pulih...", flush=True)
                time.sleep(30)
                try:
                    count = scrape_stock_date_concurrent(
                        session=session,
                        symbol=sym,
                        date_str=d_str,
                        stock_dir=stock_dir,
                        max_workers=args.workers,
                    )
                    stock_trades += count
                except Exception as e2:
                    print(f"  [!] Gagal setelah tunggu 30s: {e2}")
            except KeyboardInterrupt:
                print("\n[!] Dihentikan oleh pengguna (Ctrl+C). Progres telah disimpan.")
                sys.exit(0)
            except Exception as e:
                print(f"  [!] Gagal mengunduh {sym} {d_str}: {e}")

        grand_total_trades += stock_trades
        print(f"[+] Total transaksi {sym}: {stock_trades:,} transaksi tersimpan di {stock_dir}")

    elapsed = time.time() - start_time
    status_file = Path("data/last_scraped_footprint_status.json")
    status_data = {
        "status": "COMPLETED",
        "target_date": target_dates[0] if target_dates else "",
        "last_symbol": symbols[-1] if symbols else "",
        "total_symbols": len(symbols),
        "total_trades": grand_total_trades,
        "timestamp": datetime.now(WIB).isoformat(),
    }
    try:
        with open(status_file, "w", encoding="utf-8") as sf:
            json.dump(status_data, sf, indent=2)
    except Exception:
        pass

    print("\n" + "=" * 65)
    print(f" [SELESAI] Total: {grand_total_trades:,} transaksi diunduh dalam {elapsed / 60:.1f} menit ({elapsed:.1f}s).")
    print(f" Status File: {status_file}")
    print(f" Lokasi: {storage_desc}")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    run_scraper()

