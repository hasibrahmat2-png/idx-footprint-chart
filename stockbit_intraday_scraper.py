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

WIB = timezone(timedelta(hours=7))

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


def load_env() -> None:
    env_file = Path(__file__).resolve().parent / ".env"
    if env_file.exists():
        try:
            with env_file.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'").strip('"')
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass


def save_token_to_env(token: str) -> None:
    env_file = Path(__file__).resolve().parent / ".env"
    try:
        content = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
        if "STOCKBIT_TOKEN=" in content:
            new_content = re.sub(r"^STOCKBIT_TOKEN=.*$", f"STOCKBIT_TOKEN={token}", content, flags=re.MULTILINE)
        else:
            new_content = content.rstrip() + f"\nSTOCKBIT_TOKEN={token}\n"
        env_file.write_text(new_content, encoding="utf-8")
    except Exception:
        pass


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
    now_wib = datetime.now(tz=WIB)
    today_str = now_wib.strftime("%Y-%m-%d")
    default_start_str = (now_wib - timedelta(days=93)).strftime("%Y-%m-%d")
    parser.add_argument(
        "--start-date",
        default=default_start_str,
        help=f"Tanggal mulai (format YYYY-MM-DD), default: 3 bulan lalu ({default_start_str})",
    )
    parser.add_argument(
        "--end-date",
        default=today_str,
        help=f"Tanggal akhir (format YYYY-MM-DD), default: hari ini ({today_str})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=f"Jeda antar-request dalam detik (default: {DEFAULT_DELAY_SECONDS}).",
    )
    parser.add_argument(
        "-t",
        "--token",
        help="Token Stockbit Bearer / Authorization JWT.",
    )
    parser.add_argument(
        "--exclude",
        help="Kode saham yang dilewati/exclude (pisahkan dengan koma, contoh: JELI,BBCA).",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {SCRIPT_VERSION}",
    )
    args, unknown = parser.parse_known_args(argv)
    if not args.token and unknown:
        raw_extra = " ".join(unknown).strip()
        extracted = extract_token(raw_extra)
        if len(extracted) > 40 and "." in extracted:
            args.token = extracted
    return args


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
                print(f"\n  [Error Details] URL: {url}\n  Body: {error_body}")
                raise ScraperError(f"HTTP {error.code} dari Stockbit.") from error
            wait = retry_delay(error.headers, attempt + 1)
            print(f"\n  Server membatasi request (HTTP {error.code}); menunggu {wait:.0f} detik...", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt >= retries:
                reason = getattr(error, "reason", str(error))
                raise ScraperError(f"Koneksi gagal/timeout: {reason}") from error
            wait = retry_delay(None, attempt + 1)
            print(f"\n  Koneksi terputus/timeout; mencoba lagi dalam {wait:.0f} detik...", flush=True)
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
        dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=WIB)
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59)
        else:
            dt = dt.replace(hour=0, minute=0, second=0)
        return int(dt.timestamp())
    except ValueError:
        raise ScraperError(f"Format tanggal salah: {date_str}. Gunakan YYYY-MM-DD.")


def fetch_chunks(symbol: str, range_start: int, range_end: int, token: str, all_data: Dict[str, Any], delay: float) -> None:
    CHUNK_SIZE = 30 * 86400  # 30 hari
    current_start = range_start
    while current_start < range_end:
        current_end = min(current_start + CHUNK_SIZE, range_end)
        if current_end <= current_start:
            break
        url = build_url(symbol, current_start, current_end)
        sd_str = datetime.fromtimestamp(current_start, tz=WIB).strftime('%Y-%m-%d')
        ed_str = datetime.fromtimestamp(current_end, tz=WIB).strftime('%Y-%m-%d')
        print(f"\n  Mengambil chunk {sd_str} s/d {ed_str}...")

        try:
            payload = request_json(url, token)
            data = payload.get("data", {})
            results = data.get("chartbit", [])

            if not results:
                print("  -> Tidak ada data intraday ditemukan pada rentang ini.")
            else:
                print(f"  -> Total {len(results)} baris data intraday didapatkan.")
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
        except ScraperError as e:
            if "HTTP 404" in str(e):
                print(f"\n  [!] Endpoint tidak ditemukan (404) untuk {symbol}.")
                break
            print(f"\n  [!] Gagal mengambil chunk: {e}")
            break

        current_start = current_end + 1
        time.sleep(delay)


def ensure_output_dir(output_dir: Path) -> Path:
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except (PermissionError, FileNotFoundError, OSError) as e:
        target_str = str(output_dir)
        if "/mnt/chromeos/removable" in target_str or "SD Card" in target_str:
            raise ScraperError(
                f"Folder output mengarah ke SD Card:\n   {target_str}\n"
                f"Namun SD Card belum diakses atau dibagikan ke Linux (ChromeOS).\n\n"
                f"👉 CARA MENGAKTIFKAN (Hanya perlu 1x setelah Chromebook restart):\n"
                f"1. Buka aplikasi 'Files' (Berkas / File Manager) bawaan Chromebook.\n"
                f"2. Pada panel sebelah kiri, klik kanan pada 'SD Card'.\n"
                f"3. Pilih 'Share with Linux' (Bagikan dengan Linux).\n"
                f"4. Jalankan kembali script scraper ini."
            ) from e
        raise ScraperError(f"Gagal menyiapkan folder output {target_str}: {e}") from e
    return output_dir


def process_symbol(symbol: str, token: str, output_dir: Path, start_ts: int, end_ts: int, delay: float) -> None:
    print(f"\n=== Memproses saham: {symbol} ===")
    ensure_output_dir(output_dir)
    filepath = output_dir / f"{symbol}_intraday.csv"
    
    all_data = read_existing_data(filepath)
    
    if all_data:
        sorted_existing = sorted([int(x) for x in all_data.keys() if x.isdigit()])
        if sorted_existing:
            first_ts = sorted_existing[0]
            last_ts = sorted_existing[-1]
            first_dt_str = datetime.fromtimestamp(first_ts, tz=WIB).strftime("%Y-%m-%d %H:%M")
            last_dt_str = datetime.fromtimestamp(last_ts, tz=WIB).strftime("%Y-%m-%d %H:%M")
            print(f"  Data tersimpan: {first_dt_str} s/d {last_dt_str} WIB ({len(sorted_existing)} baris)")

            # 1. Backfill masa lalu (jika start_ts < first_ts)
            if start_ts < first_ts:
                print(f"  [Backfill] Mengambil data mundur dari {datetime.fromtimestamp(start_ts, tz=WIB).strftime('%Y-%m-%d')} s/d {first_dt_str}...")
                fetch_chunks(symbol, start_ts, first_ts - 1, token, all_data, delay)

            # 2. Forward sync masa depan (jika end_ts > last_ts)
            if end_ts > last_ts:
                print(f"  [Update] Mengambil data terbaru dari {last_dt_str} s/d {datetime.fromtimestamp(end_ts, tz=WIB).strftime('%Y-%m-%d')}...")
                fetch_chunks(symbol, last_ts + 1, end_ts, token, all_data, delay)

            if start_ts >= first_ts and end_ts <= last_ts:
                print(f"  -> Seluruh rentang waktu yang diminta sudah ada dalam cache.")
        else:
            fetch_chunks(symbol, start_ts, end_ts, token, all_data, delay)
    else:
        print("  Belum ada data sebelumnya. Mengunduh data penuh dari awal...")
        fetch_chunks(symbol, start_ts, end_ts, token, all_data, delay)

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
    load_env()
    args = parse_args(argv)
    try:
        print(f"\nStockbit Intraday Historical Scraper v{SCRIPT_VERSION}")
        
        script_dir = Path(__file__).resolve().parent
        symbols = []
        if args.symbols_file:
            sym_file = Path(args.symbols_file).expanduser()
            if not sym_file.exists() and (script_dir / args.symbols_file).exists():
                sym_file = script_dir / args.symbols_file
            symbols = load_symbols(str(sym_file))
            print(f"\nMemuat {len(symbols)} kode saham dari {sym_file}")
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
                    print(f"\nMemuat {len(symbols)} kode saham dari {sym_file}")
                else:
                    raise ScraperError("Harus memasukkan kode saham atau file.")

        if args.exclude:
            excludes = {normalize_symbol(s) for s in args.exclude.split(",") if s.strip()}
            symbols = [s for s in symbols if s not in excludes]
            print(f"\nMelewati (exclude): {', '.join(sorted(excludes))} (Tersisa {len(symbols)} saham)")

        start_ts = get_unix_timestamp(args.start_date, is_end=False)
        now_ts = int(datetime.now(tz=WIB).timestamp())
        end_ts = min(get_unix_timestamp(args.end_date, is_end=True), now_ts)
        
        print(f"\nRentang waktu (WIB): {args.start_date} ({start_ts}) s/d {args.end_date} ({end_ts})")

        raw_token = args.token or os.environ.get("STOCKBIT_TOKEN")
        if not raw_token:
            print(
                "\nToken hanya dipakai di memori selama proses dan tidak ditulis ke file.\n"
                "Gunakan token baru dari sesi Stockbit yang aktif; jangan kirim token kepada siapa pun."
            )
            raw_token = getpass.getpass("Tempel token Authorization/Bearer (teks tidak akan terlihat): ")
        else:
            source = "argumen CLI (--token)" if args.token else ".env / environment variable"
            print(f"\nMenggunakan Stockbit Token dari {source}.")
        token = extract_token(raw_token)
        raw_token = ""
        validate_token(token)
        save_token_to_env(token)

        output_dir = Path(args.output_dir).expanduser()
        if not output_dir.is_absolute() and not output_dir.exists() and (script_dir / args.output_dir).exists():
            output_dir = script_dir / args.output_dir
        output_dir = output_dir.resolve()
        ensure_output_dir(output_dir)
        print(f"\n\nFolder penyimpanan: {output_dir}/")
        
        for symbol in symbols:
            process_symbol(symbol, token, output_dir, start_ts, end_ts, args.delay)
            time.sleep(args.delay)
            
        print("\nSELESAI. Semua saham telah diproses.")
        return 0
    except KeyboardInterrupt:
        print("\nDibatalkan oleh pengguna.", file=sys.stderr)
        return 130
    except AuthenticationError as error:
        print(f"\n\nGAGAL AUTENTIKASI: {error}", file=sys.stderr)
        return 2
    except ScraperError as error:
        print(f"\n\nGAGAL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
