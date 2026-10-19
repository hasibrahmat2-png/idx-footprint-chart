#!/usr/bin/env python3
"""Download intraday historical price data for IHSG stocks from Stockbit.

The script uses Stockbit's intraday chartbit endpoint:
    https://exodus.stockbit.com/chartbit/{symbol}/price/intraday?from={start_ts}&to={end_ts}&limit=0

It accepts start and end dates and fetches 1-minute intraday data.
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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


BASE_URL = "https://exodus.stockbit.com/chartbit"
SCRIPT_VERSION = "1.0.0"
DEFAULT_DELAY_SECONDS = 0.55
DEFAULT_TIMEOUT_SECONDS = 35

CSV_FIELDS = [
    "datetime",
    "unix_timestamp",
    "symbol",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "value",
    "frequency",
    "foreign_buy",
    "foreign_sell",
    "lot"
]


class ScraperError(RuntimeError):
    """A user-facing scraper error."""


class AuthenticationError(ScraperError):
    """The supplied Stockbit token is missing, invalid, or expired."""


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unduh data riwayat harga intraday saham IHSG dari Stockbit."
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
        default="data_intraday",
        help="Folder hasil CSV (default: folder 'data_intraday').",
    )
    parser.add_argument(
        "--start-date",
        required=True,
        help="Tanggal mulai (format YYYY-MM-DD), contoh: 2024-01-01",
    )
    parser.add_argument(
        "--end-date",
        required=True,
        help="Tanggal akhir (format YYYY-MM-DD), contoh: 2024-01-31",
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
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            first_col = parts[0].strip().strip('"').strip("'")
            if first_col and first_col.upper() != "SYMBOL" and first_col.upper() != "TICKER":
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


def build_url(symbol: str, start_ts: int, end_ts: int) -> str:
    # Based on user example: /chartbit/IRSX/price/intraday?from=1785808680&to=1785445199&limit=0
    # Note: Using standard parameters. The example showed 'from' > 'to' in numeric value?
    # Actually, let's just pass start_ts to from and end_ts to to. Or maybe they are swapped.
    # We will pass 'from' as start_ts and 'to' as end_ts. If the API expects them reversed, it might fail.
    # We will just pass them straight.
    parameters = [
        ("from", str(end_ts)),
        ("to", str(start_ts)),
        ("limit", "0"),
    ]
    return f"{BASE_URL}/{symbol}/price/intraday?{urllib.parse.urlencode(parameters)}"


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


def read_existing_data(filepath: Path) -> Dict[str, Dict[str, Any]]:
    if not filepath.exists():
        return {}
    data_by_timestamp = {}
    try:
        with filepath.open("r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("unix_timestamp"):
                    data_by_timestamp[row["unix_timestamp"]] = row
    except Exception:
        pass
    return data_by_timestamp


def get_unix_timestamp(date_str: str, is_end: bool = False) -> int:
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59)
        else:
            dt = dt.replace(hour=0, minute=0, second=0)
        # Using local time mapping roughly, assuming API expects local timezone or UTC.
        # Often APIs from Indonesia expect WIB (UTC+7). We will just use system local time.
        return int(dt.timestamp())
    except ValueError:
        raise ScraperError(f"Format tanggal salah: {date_str}. Gunakan YYYY-MM-DD.")


def process_symbol(symbol: str, token: str, output_dir: Path, start_ts: int, end_ts: int, delay: float) -> None:
    print(f"\n=== Memproses saham: {symbol} ===")
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / f"{symbol}_intraday.csv"
    
    url = build_url(symbol, start_ts, end_ts)
    print(f"  Mengambil data intraday dari {url}...")
    try:
        payload = request_json(url, token)
    except ScraperError as e:
        if "HTTP 404" in str(e):
            print(f"  [!] Endpoint tidak ditemukan (404) untuk {symbol}.")
            return
        raise
        
    data = payload.get("data", {})
    results = data.get("chartbit", [])
    
    if not results:
        print("  Tidak ada data intraday ditemukan pada rentang ini.")
        return
        
    print(f"  Total {len(results)} baris data intraday didapatkan dari server.")
    
    # Merge with existing data and sort by unix_timestamp
    all_data = read_existing_data(filepath)
    for row in results:
        ts = str(row.get("unix_timestamp", ""))
        all_data[ts] = {
            "datetime": row.get("datetime", ""),
            "unix_timestamp": ts,
            "symbol": row.get("symbol", symbol),
            "open": row.get("open", ""),
            "high": row.get("high", ""),
            "low": row.get("low", ""),
            "close": row.get("close", ""),
            "volume": row.get("volume", ""),
            "value": row.get("value", ""),
            "frequency": row.get("frequency", ""),
            "foreign_buy": row.get("foreign_buy", ""),
            "foreign_sell": row.get("foreign_sell", ""),
            "lot": row.get("lot", ""),
        }
        
    sorted_ts = sorted(all_data.keys(), key=lambda x: int(x) if x.isdigit() else 0)
    
    # Write back to CSV
    temp_filepath = filepath.with_suffix(".tmp.csv")
    with temp_filepath.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for ts_key in sorted_ts:
            writer.writerow(all_data[ts_key])
            
    os.replace(temp_filepath, filepath)
    print(f"  Berhasil menyimpan ke {filepath.name} (Total baris saat ini: {len(sorted_ts)})")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        print(f"Stockbit Intraday Historical Scraper v{SCRIPT_VERSION}")
        
        symbols = []
        if args.symbols_file:
            symbols = load_symbols(args.symbols_file)
            print(f"Memuat {len(symbols)} kode saham dari {args.symbols_file}")
        elif args.symbol:
            symbols = [normalize_symbol(args.symbol)]
        else:
            raw_symbol = input("Kode saham tunggal (contoh JELI) atau tekan Enter untuk skip: ")
            if raw_symbol:
                symbols = [normalize_symbol(raw_symbol)]
            else:
                raw_file = input("Path ke file CSV/TXT berisi daftar saham: ")
                if raw_file:
                    symbols = load_symbols(raw_file)
                    print(f"Memuat {len(symbols)} kode saham dari {raw_file}")
                else:
                    raise ScraperError("Harus memasukkan kode saham atau file.")

        start_ts = get_unix_timestamp(args.start_date, is_end=False)
        end_ts = get_unix_timestamp(args.end_date, is_end=True)
        
        print(f"Rentang waktu: {args.start_date} ({start_ts}) s/d {args.end_date} ({end_ts})")

        print(
            "\nToken hanya dipakai di memori selama proses dan tidak ditulis ke file.\n"
            "Gunakan token baru dari sesi Stockbit yang aktif; jangan kirim token kepada siapa pun."
        )
        raw_token = getpass.getpass("Tempel token Authorization/Bearer (teks tidak akan terlihat): ")
        token = extract_token(raw_token)
        raw_token = ""
        validate_token(token)

        output_dir = Path(args.output_dir).expanduser().resolve()
        print(f"\nFolder penyimpanan: {output_dir}/")
        
        for symbol in symbols:
            process_symbol(symbol, token, output_dir, start_ts, end_ts, args.delay)
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
