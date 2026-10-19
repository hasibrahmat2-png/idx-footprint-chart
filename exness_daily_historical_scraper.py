#!/usr/bin/env python3
"""Download daily historical price data for Forex / Commodities (XAUUSD, etc.) from Exness.

The script connects to Exness MT5 Web API:
    https://rtapi-sg.useusecapwaskeyyepjamlaw.com/rtapi/mt5/{server}/v2/accounts/{account}/instruments/{symbol}/candles?time_frame=1440&from={ts}&count={count}&price={bid|ask}

It supports incremental updates. For each symbol, it checks the latest date
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

DEFAULT_HOST = "https://rtapi-sg.useusecapwaskeyyepjamlaw.com"
DEFAULT_SERVER = "real20"
DEFAULT_ACCOUNT = "159936924"
DEFAULT_SYMBOL = "XAUUSDc"
DEFAULT_TIMEFRAME = 1440  # 1440 minutes = 1 day
DEFAULT_PRICE = "bid"

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    try:
        with ENV_PATH.open("r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if not _line or _line.startswith("#") or "=" not in _line:
                    continue
                _k, _v = _line.split("=", 1)
                _k = _k.strip()
                _v = _v.strip().strip("'").strip('"')
                if _k not in os.environ and _k.startswith("EXNESS_"):
                    os.environ[_k] = _v
    except Exception:
        pass

SCRIPT_VERSION = "1.0.0"
BATCH_COUNT = -5000
DEFAULT_DELAY_SECONDS = 0.3
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
    """The supplied Exness token is missing, invalid, or expired."""


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unduh data riwayat harga harian Forex/Komoditas (XAUUSD, dll) dari Exness."
    )
    parser.add_argument(
        "-s",
        "--symbol",
        default=DEFAULT_SYMBOL,
        help=f"Kode instrumen Exness, misalnya XAUUSDm (default: {DEFAULT_SYMBOL}).",
    )
    parser.add_argument(
        "-f",
        "--symbols-file",
        help="File teks/CSV berisi daftar kode instrumen (satu per baris atau kolom pertama).",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="data",
        help="Folder hasil CSV (default: folder 'data').",
    )
    parser.add_argument(
        "--server",
        default=os.environ.get("EXNESS_SERVER", DEFAULT_SERVER),
        help=f"Server MT5 Exness (default: {DEFAULT_SERVER}).",
    )
    parser.add_argument(
        "--account",
        default=os.environ.get("EXNESS_ACCOUNT", DEFAULT_ACCOUNT),
        help=f"Account ID Exness (default: {DEFAULT_ACCOUNT}).",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("EXNESS_HOST", DEFAULT_HOST),
        help=f"Base Host Exness API (default: {DEFAULT_HOST}).",
    )
    parser.add_argument(
        "--price",
        default=DEFAULT_PRICE,
        choices=["bid", "ask"],
        help=f"Jenis harga (default: {DEFAULT_PRICE}).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=f"Jeda antar-request dalam detik (default: {DEFAULT_DELAY_SECONDS}).",
    )
    parser.add_argument(
        "--token",
        help="Token JWT Bearer Exness (disarankan via env EXNESS_TOKEN atau prompt interaktif).",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {SCRIPT_VERSION}",
    )
    return parser.parse_args(argv)


def normalize_symbol(raw: str) -> str:
    symbol = raw.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,20}", symbol):
        raise ScraperError(f"Kode instrumen tidak valid: {raw}")
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
            if first_col and first_col.upper() not in ("SYMBOL", "TICKER", "INSTRUMENT"):
                try:
                    symbols.append(normalize_symbol(first_col))
                except ScraperError:
                    pass

    if not symbols:
        raise ScraperError(f"Tidak ada kode instrumen yang valid di dalam {file_path}")

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
        raise AuthenticationError("Token sudah kedaluwarsa. Login ulang ke Exness.")


def build_url(
    host: str,
    server: str,
    account: str,
    symbol: str,
    timeframe: int,
    from_ts: int,
    count: int,
    price: str,
) -> str:
    params = urllib.parse.urlencode(
        {
            "time_frame": str(timeframe),
            "from": str(from_ts),
            "count": str(count),
            "price": price,
        }
    )
    base = host.rstrip("/")
    return f"{base}/rtapi/mt5/{server}/v2/accounts/{account}/instruments/{symbol}/candles?{params}"


def retry_delay(headers: Any, attempt: int) -> float:
    retry_after = headers.get("Retry-After") if headers else None
    if retry_after:
        try:
            return max(float(retry_after), 1.0)
        except ValueError:
            pass
    return min(2**attempt, 30)


def request_json(
    url: str, token: str, timeout: int = DEFAULT_TIMEOUT_SECONDS, retries: int = 6
) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Origin": "https://my.exness.com",
        "Referer": "https://my.exness.com/",
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
                    f"Exness menolak request (HTTP {error.code}). Token mungkin kedaluwarsa atau dilarang."
                ) from error
            retryable = error.code == 429 or 500 <= error.code <= 599
            if not retryable or attempt >= retries:
                error_body = error.read().decode("utf-8", errors="replace")
                print(f"  [Error Details] URL: {url}\n  Body: {error_body}")
                raise ScraperError(f"HTTP {error.code} dari Exness.") from error
            wait = retry_delay(error.headers, attempt + 1)
            print(
                f"  Server membatasi request (HTTP {error.code}); menunggu {wait:.0f} detik...",
                flush=True,
            )
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt >= retries:
                reason = getattr(error, "reason", str(error))
                raise ScraperError(f"Koneksi gagal/timeout: {reason}") from error
            wait = retry_delay(None, attempt + 1)
            print(
                f"  Koneksi terputus/timeout; mencoba lagi dalam {wait:.0f} detik...",
                flush=True,
            )
            time.sleep(wait)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ScraperError("Respons Exness bukan JSON yang valid.") from error
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


def process_symbol(
    symbol: str,
    token: str,
    output_dir: Path,
    config: Dict[str, Any],
    delay: float,
) -> None:
    print(f"\n=== Memproses instrumen: {symbol} ===")
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / f"{symbol}.csv"

    last_date = get_last_saved_date(filepath)
    if last_date:
        print(f"  Data terakhir tersimpan: {last_date}")
    else:
        print("  Belum ada data sebelumnya. Mengunduh riwayat penuh...")

    now_ms = int(time.time() * 1000)
    new_rows: Dict[str, Dict[str, Any]] = {}
    curr_from_ms = now_ms

    while True:
        url = build_url(
            host=config["host"],
            server=config["server"],
            account=config["account"],
            symbol=symbol,
            timeframe=DEFAULT_TIMEFRAME,
            from_ts=curr_from_ms,
            count=BATCH_COUNT,
            price=config["price"],
        )
        try:
            payload = request_json(url, token)
        except ScraperError as e:
            if "HTTP 404" in str(e):
                print(f"  [!] Endpoint/instrumen tidak ditemukan (404) untuk {symbol}.")
                break
            raise

        candles = payload.get("price_history", [])
        if not candles:
            print("  Tidak ada candle lebih lama yang dikembalikan.")
            break

        added_in_batch = 0
        hit_existing = False

        for c in candles:
            ts_sec = c["t"] / 1000.0
            row_date = datetime.fromtimestamp(ts_sec, tz=timezone.utc).strftime("%Y-%m-%d")

            # Jika data tersimpan ada dan row_date < last_date, kita bisa berhenti setelah batch ini
            if last_date and row_date < last_date:
                hit_existing = True
                continue

            o = float(c.get("o", 0))
            h = float(c.get("h", 0))
            l = float(c.get("l", 0))
            cl = float(c.get("c", 0))
            v = int(c.get("v", 0))
            avg = round((h + l + cl) / 3.0, 5)
            change = round(cl - o, 5)
            change_percentage = round((change / o) * 100.0, 2) if o else 0.0

            new_rows[row_date] = {
                "date": row_date,
                "open": o,
                "high": h,
                "low": l,
                "close": cl,
                "average": avg,
                "volume": v,
                "value": 0,
                "frequency": 0,
                "change": change,
                "change_percentage": change_percentage,
                "foreign_buy": 0,
                "foreign_sell": 0,
                "net_foreign": 0,
            }
            added_in_batch += 1

        earliest_batch_date = datetime.fromtimestamp(
            candles[0]["t"] / 1000.0, tz=timezone.utc
        ).strftime("%Y-%m-%d")
        latest_batch_date = datetime.fromtimestamp(
            candles[-1]["t"] / 1000.0, tz=timezone.utc
        ).strftime("%Y-%m-%d")

        print(
            f"  Batch: {earliest_batch_date} s/d {latest_batch_date} | {len(candles)} candle didapat (baru/update: {added_in_batch})"
        )

        if hit_existing or len(candles) < abs(BATCH_COUNT):
            if hit_existing:
                print("  Mencapai data yang sudah ada di CSV. Selesai sinkronisasi.")
            break

        # Pindah ke candle lebih lampau
        earliest_t = candles[0]["t"]
        curr_from_ms = earliest_t - 1
        time.sleep(delay)

    if not new_rows and last_date:
        print("  Data CSV sudah yang paling mutakhir. Tidak ada data baru.")
        return

    print(f"  Total {len(new_rows)} tanggal baru/diperbarui.")

    # Gabungkan dengan data eksisting dan urutkan berdasarkan tanggal
    all_data = read_existing_data(filepath)
    for date_key, row in new_rows.items():
        all_data[date_key] = row

    sorted_dates = sorted(all_data.keys())

    # Tulis atomic ke file CSV
    temp_filepath = filepath.with_suffix(".tmp.csv")
    with temp_filepath.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for date_key in sorted_dates:
            writer.writerow(all_data[date_key])

    os.replace(temp_filepath, filepath)
    print(f"  Berhasil menyimpan ke {filepath.name} (Total baris: {len(sorted_dates)})")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        print(f"\nExness Daily Historical Scraper v{SCRIPT_VERSION}")

        script_dir = Path(__file__).resolve().parent
        symbols = []
        if args.symbols_file:
            sym_file = Path(args.symbols_file).expanduser()
            if not sym_file.exists() and (script_dir / args.symbols_file).exists():
                sym_file = script_dir / args.symbols_file
            symbols = load_symbols(str(sym_file))
            print(f"Memuat {len(symbols)} kode instrumen dari {sym_file}")
        elif args.symbol:
            symbols = [normalize_symbol(args.symbol)]
        else:
            raw_symbol = input(
                f"Kode instrumen Exness (tekan Enter untuk default '{DEFAULT_SYMBOL}'): "
            ).strip()
            if raw_symbol:
                symbols = [normalize_symbol(raw_symbol)]
            else:
                symbols = [DEFAULT_SYMBOL]

        raw_token = args.token or os.environ.get("EXNESS_TOKEN")
        if not raw_token:
            print(
                "\nToken hanya dipakai di memori selama proses dan tidak ditulis ke file.\n"
                "Gunakan token baru dari sesi Exness yang aktif; jangan kirim token kepada siapa pun."
            )
            raw_token = getpass.getpass(
                "Tempel token Authorization/Bearer Exness (teks tidak akan terlihat): "
            )
        else:
            print("\nMenggunakan Exness Token dari environment variable EXNESS_TOKEN atau argumen.")

        token = extract_token(raw_token)
        raw_token = ""
        validate_token(token)

        output_dir = Path(args.output_dir).expanduser()
        if (
            not output_dir.is_absolute()
            and not output_dir.exists()
            and (script_dir / args.output_dir).exists()
        ):
            output_dir = script_dir / args.output_dir
        output_dir = output_dir.resolve()
        print(f"Folder penyimpanan: {output_dir}/")

        config = {
            "host": args.host,
            "server": args.server,
            "account": args.account,
            "price": args.price,
        }

        for symbol in symbols:
            process_symbol(symbol, token, output_dir, config, args.delay)
            time.sleep(args.delay)

        print("\nSELESAI. Semua instrumen telah diproses.")
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
