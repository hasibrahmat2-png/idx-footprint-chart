#!/usr/bin/env python3
"""Download daily historical price data for IHSG stocks from Stockbit.

The script uses Stockbit's historical summary endpoint:
    https://exodus.stockbit.com/company-price-feed/historical/summary/{symbol}

It supports incremental updates. For each stock, it checks the latest date
in the existing CSV and only fetches new data since that date.
"""

from __future__ import annotations

import argparse
import base64
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
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


BASE_URL = "https://exodus.stockbit.com/company-price-feed/historical/summary"
SCRIPT_VERSION = "1.0.0"
PAGE_LIMIT = 50
DEFAULT_DELAY_SECONDS = 0.55
DEFAULT_TIMEOUT_SECONDS = 35

CSV_FIELDS = [
    "date",
    "open",
    "high",
    "low",
    "close",
    "average",
    "volume",
    "value",
    "frequency",
    "change",
    "change_percentage",
    "foreign_buy",
    "foreign_sell",
    "net_foreign",
]


class ScraperError(RuntimeError):
    """A user-facing scraper error."""


class AuthenticationError(ScraperError):
    """The supplied Stockbit token is missing, invalid, or expired."""


def load_env() -> None:
    env_file = Path(__file__).resolve().parent / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'").strip('"')
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unduh data riwayat harga harian saham IHSG dari Stockbit."
    )
    parser.add_argument(
        "-s",
        "--symbol",
        help="Kode saham tunggal, misalnya JELI.",
    )
    parser.add_argument(
        "-f",
        "--symbols-file",
        help="File teks/CSV berisi daftar kode saham (satu per baris atau kolom pertama).",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="data",
        help="Folder hasil CSV (default: folder 'data').",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=f"Jeda antar-request dalam detik (default: {DEFAULT_DELAY_SECONDS}).",
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
    with path.open("r", encoding="utf-8") as f:
        # Simple heuristic to handle both TXT and CSV
        for line in f:
            line = line.strip()
            if not line:
                continue
            # If CSV, take the first column
            parts = line.split(",")
            first_col = parts[0].strip().strip('"').strip("'")
            if first_col and first_col.upper() != "SYMBOL" and first_col.upper() != "TICKER": # skip common headers
                try:
                    symbols.append(normalize_symbol(first_col))
                except ScraperError:
                    pass
    
    if not symbols:
        raise ScraperError(f"Tidak ada kode saham yang valid di dalam {file_path}")
    
    # Deduplicate while preserving order
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


def build_url(symbol: str, end_date: str, page: int) -> str:
    parameters: List[Tuple[str, str]] = [
        ("period", "HS_PERIOD_DAILY"),
        ("end_date", end_date),
        ("limit", str(PAGE_LIMIT)),
        ("page", str(page)),
    ]
    return f"{BASE_URL}/{symbol}?{urllib.parse.urlencode(parameters)}"


def retry_delay(headers: Any, attempt: int) -> float:
    retry_after = headers.get("Retry-After") if headers else None
    if retry_after:
        try:
            return max(float(retry_after), 1.0)
        except ValueError:
            pass
    return min(2**attempt, 30)


def request_json(url: str, token: str, timeout: int = DEFAULT_TIMEOUT_SECONDS, retries: int = 6) -> Dict[str, Any]:
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
                raise AuthenticationError("Stockbit menolak token. Login ulang lalu gunakan token baru.") from error
            retryable = error.code == 429 or 500 <= error.code <= 599
            if not retryable or attempt >= retries:
                error_body = error.read().decode('utf-8', errors='replace')
                print(f"  [Error Details] URL: {url}\n  Body: {error_body}")
                raise ScraperError(f"HTTP {error.code} dari Stockbit.") from error
            wait = retry_delay(error.headers, attempt + 1)
            print(f"  Server membatasi request (HTTP {error.code}); menunggu {wait:.0f} detik...", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt >= retries:
                reason = getattr(error, "reason", str(error))
                raise ScraperError(f"Koneksi gagal/timeout: {reason}") from error
            wait = retry_delay(None, attempt + 1)
            print(f"  Koneksi terputus/timeout; mencoba lagi dalam {wait:.0f} detik...", flush=True)
            time.sleep(wait)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ScraperError("Respons Stockbit bukan JSON yang valid.") from error
    raise ScraperError("Request gagal setelah beberapa percobaan.")


def get_last_saved_date(filepath: Path) -> Optional[str]:
    if not filepath.exists():
        return None
    last_date = None
    try:
        with filepath.open("r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("date"):
                    last_date = row["date"]
    except Exception:
        return None
    return last_date


def read_existing_data(filepath: Path) -> Dict[str, Dict[str, Any]]:
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


def process_symbol(symbol: str, token: str, output_dir: Path, delay: float) -> None:
    print(f"\n=== Memproses saham: {symbol} ===")
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / f"{symbol}.csv"
    
    last_date = get_last_saved_date(filepath)
    if last_date:
        print(f"  Data terakhir tersimpan: {last_date}")
    else:
        print("  Belum ada data sebelumnya. Mengunduh semua riwayat...")
        
    end_date = datetime.now().strftime("%Y-%m-%d")
    
    print(f"  Mencari data mundur dari {end_date}...")
    
    new_rows = []
    page = 1
    stop_fetching = False
    
    while not stop_fetching:
        url = build_url(symbol, end_date, page)
        try:
            payload = request_json(url, token)
        except ScraperError as e:
            if "HTTP 404" in str(e):
                print(f"  [!] Endpoint tidak ditemukan (404) untuk {symbol}. Saham mungkin tidak ada.")
                break
            raise
            
        data = payload.get("data", {})
        results = data.get("result", [])
        
        if not results:
            break
            
        added_in_page = 0
        for row in results:
            row_date = row.get("date", "")
            
            # If we hit a date that is strictly older than our last saved date, we stop
            # We process '==' to allow overwriting partial intraday data with the final closing data
            if last_date and row_date < last_date:
                stop_fetching = True
                continue
                
            new_rows.append({
                "date": row_date,
                "open": row.get("open", ""),
                "high": row.get("high", ""),
                "low": row.get("low", ""),
                "close": row.get("close", ""),
                "average": row.get("average", ""),
                "volume": row.get("volume", ""),
                "value": row.get("value", ""),
                "frequency": row.get("frequency", ""),
                "change": row.get("change", ""),
                "change_percentage": row.get("change_percentage", ""),
                "foreign_buy": row.get("foreign_buy", ""),
                "foreign_sell": row.get("foreign_sell", ""),
                "net_foreign": row.get("net_foreign", ""),
            })
            added_in_page += 1
            
        print(f"  Halaman {page:>2} | Disimpan {added_in_page:>2} baris baru")
        
        if stop_fetching:
            print("  Mencapai data yang sudah ada. Berhenti mencari.")
            break
            
        paginate = data.get("paginate", {})
        next_page = paginate.get("next_page")
        if not next_page:
            break
            
        page += 1
        time.sleep(delay)
        
    if not new_rows:
        print("  Tidak ada data baru ditemukan pada rentang tanggal ini.")
        return
        
    print(f"  Total {len(new_rows)} baris data baru didapatkan.")
    
    # Merge with existing data and sort by date
    all_data = read_existing_data(filepath)
    for row in new_rows:
        all_data[row["date"]] = row
        
    sorted_dates = sorted(all_data.keys())
    
    # Write back to CSV
    temp_filepath = filepath.with_suffix(".tmp.csv")
    with temp_filepath.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for date_key in sorted_dates:
            writer.writerow(all_data[date_key])
            
    os.replace(temp_filepath, filepath)
    print(f"  Berhasil menyimpan ke {filepath.name} (Total baris: {len(sorted_dates)})")


def main(argv: Optional[Sequence[str]] = None) -> int:
    load_env()
    args = parse_args(argv)
    try:
        print(f"\nStockbit Daily Historical Scraper v{SCRIPT_VERSION}")
        
        script_dir = Path(__file__).resolve().parent
        symbols = []
        if args.symbols_file:
            sym_file = Path(args.symbols_file).expanduser()
            if not sym_file.exists() and (script_dir / args.symbols_file).exists():
                sym_file = script_dir / args.symbols_file
            symbols = load_symbols(str(sym_file))
            print(f"Memuat {len(symbols)} kode saham dari {sym_file}")
        elif args.symbol:
            symbols = [normalize_symbol(args.symbol)]
        else:
            raw_symbol = input("Kode saham tunggal (contoh JELI) atau tekan Enter untuk skip: ")
            if raw_symbol:
                symbols = [normalize_symbol(raw_symbol)]
            else:
                raw_file = input("Path ke file CSV/TXT berisi daftar saham: ")
                if raw_file:
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
        print(f"\nFolder penyimpanan: {output_dir}/")
        
        for symbol in symbols:
            process_symbol(symbol, token, output_dir, args.delay)
            time.sleep(args.delay)
            
        print("\nSELESAI. Semua saham telah diproses.")
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
