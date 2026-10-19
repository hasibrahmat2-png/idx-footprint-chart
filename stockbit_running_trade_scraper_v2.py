#!/usr/bin/env python3
"""Download one symbol's Stockbit Running Trade for the current market day.

The script uses Stockbit's observed cursor pagination:

    first request: sort=ASC, limit=80
    next request:  same query plus trade_number=<last trade_number>

Authentication is requested interactively and is never written to disk.
Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import base64
import calendar
import csv
import getpass
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
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

WIB = timezone(timedelta(hours=7))


BASE_URL = "https://exodus.stockbit.com/order-trade/running-trade"
ORDER_BY = "RUNNING_TRADE_ORDER_BY_TIME"
SCRIPT_VERSION = "2.1.0"
PAGE_LIMIT = 1000
DEFAULT_DELAY_SECONDS = 0.55
DEFAULT_TIMEOUT_SECONDS = 35
DEFAULT_MAX_PAGES = 10_000

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


class ScraperError(RuntimeError):
    """A user-facing scraper error."""


class AuthenticationError(ScraperError):
    """The supplied Stockbit token is missing, invalid, or expired."""


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Unduh seluruh Running Trade satu saham untuk hari pasar berjalan "
            "dan simpan sebagai CSV."
        )
    )
    parser.add_argument(
        "symbol",
        nargs="?",
        help="Kode saham, misalnya DOOH. Jika kosong, akan ditanyakan.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default=".",
        help="Folder hasil CSV (default: folder saat ini).",
    )
    parser.add_argument(
        "-m",
        "--month",
        help="Bulan yang ingin diunduh (format: YYYY-MM). Contoh: 2024-05",
    )
    parser.add_argument(
        "--last-month",
        action="store_true",
        help="Unduh data 1 bulan terakhir (mundur 30 hari dari hari ini).",
    )
    parser.add_argument(
        "-d",
        "--date",
        help="Unduh data untuk tanggal spesifik (format: YYYY-MM-DD). Contoh: 2026-07-07",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=(
            "Jeda antar-request dalam detik "
            f"(default: {DEFAULT_DELAY_SECONDS})."
        ),
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help="Pengaman jumlah halaman maksimum.",
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
        raise ScraperError("Kode saham tidak valid.")
    return symbol


def extract_token(raw: str) -> str:
    """Accept a bare token, `Bearer ...`, or an Authorization header line."""
    text = raw.strip()
    header_match = re.search(
        r"(?im)^\s*authorization\s*:\s*bearer\s+([^\s]+)", text
    )
    if header_match:
        return header_match.group(1).strip()

    bearer_match = re.search(r"(?i)\bbearer\s+([^\s]+)", text)
    if bearer_match:
        return bearer_match.group(1).strip()

    return text.strip().strip('"').strip("'")


def decode_jwt_payload(token: str) -> Optional[Dict[str, Any]]:
    """Decode JWT metadata locally without verifying or exposing its contents."""
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


def build_url(symbol: str, cursor: Optional[str] = None, target_date: Optional[str] = None) -> str:
    parameters: List[Tuple[str, str]] = [
        ("symbols[]", symbol),
        ("sort", "ASC"),
        ("limit", str(PAGE_LIMIT)),
        ("order_by", ORDER_BY),
    ]
    if target_date:
        parameters.append(("date", target_date))
    if cursor:
        parameters.append(("trade_number", cursor))
    return f"{BASE_URL}?{urllib.parse.urlencode(parameters)}"


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
    *,
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
                raise AuthenticationError(
                    "Stockbit menolak token. Login ulang lalu gunakan token baru."
                ) from error

            retryable = error.code == 429 or 500 <= error.code <= 599
            if not retryable or attempt >= retries:
                raise ScraperError(f"HTTP {error.code} dari Stockbit.") from error

            wait = retry_delay(error.headers, attempt + 1)
            print(
                f"  Server membatasi request (HTTP {error.code}); "
                f"menunggu {wait:.0f} detik...",
                flush=True,
            )
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            if attempt >= retries:
                reason = getattr(error, "reason", error)
                raise ScraperError(f"Koneksi gagal: {reason}") from error
            wait = retry_delay(None, attempt + 1)
            print(f"  Koneksi terputus; mencoba lagi dalam {wait:.0f} detik...", flush=True)
            time.sleep(wait)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ScraperError("Respons Stockbit bukan JSON yang valid.") from error

    raise ScraperError("Request gagal setelah beberapa percobaan.")


def extract_page(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    data = payload.get("data")
    if not isinstance(data, dict):
        message = payload.get("message") or "Respons tidak memiliki objek data."
        raise ScraperError(str(message))

    rows = data.get("running_trade")
    if not isinstance(rows, list):
        raise ScraperError("Respons tidak memiliki data.running_trade[].")

    valid_rows = [row for row in rows if isinstance(row, dict)]
    return data, valid_rows


def integer_value(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    cleaned = str(value).strip().replace(",", "")
    try:
        return int(float(cleaned))
    except ValueError:
        return default


def percentage_value(value: Any) -> Any:
    if value is None or value == "":
        return ""
    cleaned = str(value).strip().replace("%", "").replace("+", "")
    try:
        return float(cleaned)
    except ValueError:
        return ""


def normalize_row(row: Dict[str, Any], market_date: str) -> Dict[str, Any]:
    lot = integer_value(row.get("lot"))
    value = row.get("value") if isinstance(row.get("value"), dict) else {}

    return {
        "date": market_date,
        "time": row.get("time", ""),
        "code": row.get("code", ""),
        "id": str(row.get("id", "")),
        "trade_number": str(row.get("trade_number", "")),
        "price": integer_value(row.get("price")),
        "change": row.get("change", ""),
        "change_pct": percentage_value(row.get("change")),
        "action": str(row.get("action", "")).lower(),
        "lot": lot,
        "shares": lot * 100,
        "value_idr": integer_value(value.get("raw")),
        "value_display": value.get("formatted", ""),
        "buyer": row.get("buyer", ""),
        "buyer_type": row.get("buyer_type", ""),
        "seller": row.get("seller", ""),
        "seller_type": row.get("seller_type", ""),
        "market_board": row.get("market_board", ""),
        "buy_order_number": str(row.get("buy_order_number", "")),
        "sell_order_number": str(row.get("sell_order_number", "")),
        "group_order_number": str(row.get("group_order_number", "")),
        "is_broker_exists": str(bool(row.get("is_broker_exists"))).lower(),
    }


def unique_output_paths(output_dir: Path, symbol: str, market_date: str) -> Tuple[Path, Path]:
    safe_date = re.sub(r"[^0-9-]", "-", market_date) or datetime.now(WIB).strftime("%Y-%m-%d")
    stem = f"running_trade_{symbol}_{safe_date}"
    
    final_path = output_dir / f"{stem}.csv"
    partial_path = output_dir / f"{stem}.partial.csv"
    
    # Overwrite by default. If a previous run failed and left a < 500 byte file, we will just overwrite it.
    return final_path, partial_path


def format_integer(value: int) -> str:
    return f"{value:,}".replace(",", ".")


def run_scraper(
    symbol: str,
    token: str,
    output_dir: Path,
    delay: float,
    max_pages: int,
    target_date: Optional[str] = None,
) -> Optional[Path]:
    if target_date:
        expected_path = output_dir / f"running_trade_{symbol}_{target_date}.csv"
        # If file exists and is larger than 500 bytes (has actual data), skip it
        if expected_path.exists() and expected_path.stat().st_size > 500:
            print(f"  [!] Data {target_date} sudah lengkap ({expected_path.name}). Skipping...", flush=True)
            return expected_path

    first_payload = request_json(build_url(symbol, target_date=target_date), token)
    first_data, _ = extract_page(first_payload)

    if not first_data or not first_data.get("date"):
        print(f"  [!] Tidak ada data untuk tanggal {target_date or 'hari ini'}. (Mungkin hari libur)", flush=True)
        return None

    # Strictly enforce target_date as market_date if target_date was specified!
    market_date = target_date if target_date else str(first_data.get("date") or datetime.now(WIB).strftime("%Y-%m-%d"))

    output_dir.mkdir(parents=True, exist_ok=True)
    final_path, partial_path = unique_output_paths(output_dir, symbol, market_date)

    if first_data.get("is_open_market") is True:
        print("PERINGATAN: market masih terbuka; data dapat terus bertambah.")

    seen_ids = set()
    cursor: Optional[str] = None
    payload = first_payload
    pages = 0
    received_rows = 0
    written_rows = 0
    duplicate_rows = 0
    total_lot = 0
    total_value = 0
    buy_lot = 0
    sell_lot = 0
    last_trade_number = ""

    try:
        with partial_path.open("w", encoding="utf-8-sig", newline="") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writeheader()

            while True:
                pages += 1
                if pages > max_pages:
                    raise ScraperError(
                        f"Pengaman menghentikan proses setelah {max_pages} halaman."
                    )
                data, rows = extract_page(payload)                # ==== USER MAGIC RETRY LOGIC ====
                if not rows:
                    last_time = getattr(sys.modules[__name__], 'last_recorded_time', 'Belum ada data')
                    print(f"\n[!] Array kosong (Waktu terakhir: {last_time}). Mencoba menembus stealth ban...")
                    
                    success = False
                    for retry in range(1, 3):
                        print(f"  -> Menunggu 60 detik (Percobaan {retry}/2)...")
                        time.sleep(60)
                        
                        payload = request_json(build_url(symbol, cursor, target_date=target_date), token)
                        data, rows = extract_page(payload)
                        
                        if rows:
                            print(f"\n[BINGO!] Data berhasil didapatkan setelah {retry} menit!")
                            success = True
                            break
                            
                    if not success:
                        print(f"\n[GAGAL/SELESAI] Setelah 2 menit menunggu, tidak ada data baru dari Stockbit.")
                        print("Mengasumsikan hari ini sudah selesai atau libur. Otomatis berpindah ke hari berikutnya...")
                        break
                # ================================

                received_rows += len(rows)

                for raw_row in rows:

                    trade_id = str(raw_row.get("id", "")).strip()
                    if trade_id and trade_id in seen_ids:
                        duplicate_rows += 1
                        continue
                    if trade_id:
                        seen_ids.add(trade_id)
                    row = normalize_row(raw_row, str(data.get("date") or market_date))
                    writer.writerow(row)
                    written_rows += 1
                    
                    setattr(sys.modules[__name__], 'last_recorded_time', row.get('time', '-'))


                    lot = int(row["lot"])
                    value_idr = int(row["value_idr"])
                    total_lot += lot
                    total_value += value_idr
                    if row["action"] == "buy":
                        buy_lot += lot
                    elif row["action"] == "sell":
                        sell_lot += lot

                output_file.flush()
                last_time = rows[-1].get("time", "-") if rows else "-"
                print(
                    f"Halaman {pages:>4} | diterima {len(rows):>2} | "
                    f"tersimpan {format_integer(written_rows):>8} | waktu {last_time}",
                    flush=True,
                )

                # Stockbit can return a partial batch in the middle of a session
                # (for example 60 rows) even though a later cursor still exists.
                # The only reliable end signal observed is an empty batch.
                if not rows:
                    break

                next_cursor = str(rows[-1].get("trade_number", "")).strip()
                if not next_cursor:
                    raise ScraperError(
                        "Baris terakhir tidak mempunyai trade_number untuk pagination."
                    )
                if next_cursor == cursor:
                    raise ScraperError(
                        "Cursor trade_number tidak bergerak; proses dihentikan agar tidak berulang."
                    )

                last_trade_number = next_cursor
                print(f"  Cursor berikutnya: {next_cursor}", flush=True)
                cursor = next_cursor
                time.sleep(delay)
                payload = request_json(build_url(symbol, cursor, target_date=target_date), token)

        os.replace(partial_path, final_path)
    except BaseException:
        if partial_path.exists():
            print(f"File parsial dipertahankan: {partial_path}", file=sys.stderr)
        raise

    print("\nSELESAI")
    print(f"Tanggal        : {market_date}")
    print(f"Versi script   : {SCRIPT_VERSION}")
    print(f"Transaksi      : {format_integer(written_rows)}")
    print(f"Baris diterima : {format_integer(received_rows)}")
    print(f"Duplikat ID    : {format_integer(duplicate_rows)}")
    print(f"Total lot      : {format_integer(total_lot)}")
    print(f"Buy lot        : {format_integer(buy_lot)}")
    print(f"Sell lot       : {format_integer(sell_lot)}")
    print(f"Delta lot      : {format_integer(buy_lot - sell_lot)}")
    print(f"Total value    : Rp{format_integer(total_value)}")
    print(f"Trade terakhir : {last_trade_number or '-'}")
    print(f"File           : {final_path}")
    return final_path


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        print(f"Stockbit Running Trade Scraper v{SCRIPT_VERSION}")
        raw_symbol = args.symbol or input("Kode saham (contoh DOOH): ")
        symbol = normalize_symbol(raw_symbol)

        if args.delay < 0.25:
            raise ScraperError("Gunakan --delay minimal 0.25 detik.")
        if args.max_pages < 1:
            raise ScraperError("--max-pages harus lebih besar dari nol.")

        print(
            "\nToken hanya dipakai di memori selama proses dan tidak ditulis ke file.\n"
            "Gunakan token baru dari sesi Stockbit yang aktif; jangan kirim token kepada siapa pun."
        )
        raw_token = os.environ.get("STOCKBIT_TOKEN")
        if not raw_token:
            raw_token = getpass.getpass("Tempel token Authorization/Bearer (teks tidak akan terlihat): ")
        token = extract_token(raw_token)
        raw_token = ""
        validate_token(token)

        output_dir = Path(args.output_dir).expanduser().resolve()
        
        if getattr(args, "last_month", False):
            print(f"\nMengunduh Running Trade {symbol} untuk 1 bulan terakhir (dihitung mundur)...")
            print(f"File akan disimpan di folder: {output_dir.name}/")
            today = datetime.now(WIB)
            
            # Iterate backwards from today to 30 days ago
            for i in range(30):
                date_obj = today - timedelta(days=i)
                if date_obj.weekday() >= 5: # Skip Sabtu/Minggu
                    continue
                    
                date_str = date_obj.strftime("%Y-%m-%d")
                print(f"\n=== Memproses tanggal {date_str} ===")
                run_scraper(symbol, token, output_dir, args.delay, args.max_pages, target_date=date_str)
        elif getattr(args, "month", None):
            try:
                year, month = map(int, args.month.split("-"))
                _, num_days = calendar.monthrange(year, month)
            except ValueError:
                raise ScraperError("Format --month salah. Gunakan YYYY-MM (contoh: 2024-05)")
                
            print(f"\nMengunduh Running Trade {symbol} untuk bulan {args.month} secara kronologis...")
            print(f"File akan disimpan di folder: {output_dir.name}/")
            for day in range(1, num_days + 1):
                date_obj = datetime(year, month, day, tzinfo=WIB)
                if date_obj.weekday() >= 5:
                    continue
                if date_obj.date() > datetime.now(WIB).date():
                    print(f"\n[!] {date_obj.date()} ada di masa depan. Menghentikan scraping untuk bulan ini.")
                    break
                    
                date_str = date_obj.strftime("%Y-%m-%d")
                print(f"\n=== Memproses tanggal {date_str} ===")
                run_scraper(symbol, token, output_dir, args.delay, args.max_pages, target_date=date_str)
        elif getattr(args, "date", None):
            date_str = args.date
            print(f"\nMengunduh Running Trade {symbol} untuk tanggal spesifik {date_str}...")
            run_scraper(symbol, token, output_dir, args.delay, args.max_pages, target_date=date_str)
        else:
            print(f"\nMengunduh Running Trade {symbol} secara kronologis...")
            run_scraper(symbol, token, output_dir, args.delay, args.max_pages)
            
        token = ""
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
