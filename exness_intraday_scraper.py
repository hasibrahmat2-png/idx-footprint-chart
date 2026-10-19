#!/usr/bin/env python3
"""Download intraday historical price data for Forex / Commodities (XAUUSD, etc.) from Exness.

The script connects to Exness MT5 Web API:
    https://rtapi-sg.useusecapwaskeyyepjamlaw.com/rtapi/mt5/{server}/v2/accounts/{account}/instruments/{symbol}/candles?time_frame=1&from={start_ts}&count=5000&price={bid|ask}

It accepts start and end dates, supports incremental cache updates (backfill past & forward sync future),
and outputs CSVs fully compatible with Lightweight Charts and unified chart builders.
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

DEFAULT_HOST = "https://rtapi-sg.useusecapwaskeyyepjamlaw.com"
DEFAULT_SERVER = "real20"
DEFAULT_ACCOUNT = "159936924"
DEFAULT_SYMBOL = "XAUUSDc"
DEFAULT_TIMEFRAME = 1  # 1 minute
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
BATCH_SIZE = 5000
DEFAULT_DELAY_SECONDS = 0.3
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
    "lot",
]

WIB = timezone(timedelta(hours=7))


class ScraperError(RuntimeError):
    """A user-facing scraper error."""


class AuthenticationError(ScraperError):
    """The supplied Exness token is missing, invalid, or expired."""


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unduh data riwayat harga intraday Forex/Komoditas (XAUUSD, dll) dari Exness."
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
        default="data_intraday",
        help="Folder hasil CSV (default: folder 'data_intraday').",
    )
    now_utc = datetime.now(tz=timezone.utc)
    today_str = now_utc.strftime("%Y-%m-%d")
    default_start_str = (now_utc - timedelta(days=93)).strftime("%Y-%m-%d")
    parser.add_argument(
        "--start-date",
        default=default_start_str,
        help=f"Tanggal mulai (format YYYY-MM-DD), default: ~3 bulan lalu ({default_start_str}).",
    )
    parser.add_argument(
        "--end-date",
        default=today_str,
        help=f"Tanggal akhir (format YYYY-MM-DD), default: hari ini ({today_str}).",
    )
    parser.add_argument(
        "--timeframe",
        "--time-frame",
        type=int,
        default=DEFAULT_TIMEFRAME,
        dest="timeframe",
        help=f"Timeframe candle dalam menit: 1, 5, 15, 30, 60, dst (default: {DEFAULT_TIMEFRAME}).",
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
        "--tz",
        choices=["UTC", "WIB", "LOCAL"],
        default="WIB",
        help="Zona waktu untuk kolom datetime (default: WIB). Catatan: unix_timestamp selalu UTC.",
    )
    parser.add_argument(
        "--exclude",
        help="Kode instrumen yang dilewati/exclude (pisahkan dengan koma).",
    )
    parser.add_argument(
        "--token",
        help="Token JWT Bearer Exness (disarankan via env EXNESS_TOKEN atau prompt interaktif).",
    )
    parser.add_argument(
        "--allowed-months",
        default=None,
        help="Daftar nomor bulan yang diizinkan (misal: '3,4,9,10'). Bulan lain akan diabaikan/dibersihkan.",
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
                print(f"\n  [Error Details] URL: {url}\n  Body: {error_body}")
                raise ScraperError(f"HTTP {error.code} dari Exness.") from error
            wait = retry_delay(error.headers, attempt + 1)
            print(
                f"\n  Server membatasi request (HTTP {error.code}); menunggu {wait:.0f} detik...",
                flush=True,
            )
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt >= retries:
                reason = getattr(error, "reason", str(error))
                raise ScraperError(f"Koneksi gagal/timeout: {reason}") from error
            wait = retry_delay(None, attempt + 1)
            print(
                f"\n  Koneksi terputus/timeout; mencoba lagi dalam {wait:.0f} detik...",
                flush=True,
            )
            time.sleep(wait)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ScraperError("Respons Exness bukan JSON yang valid.") from error
    raise ScraperError("Request gagal setelah beberapa percobaan.")


def read_existing_data(filepath: Path) -> Dict[str, Dict[str, Any]]:
    if not filepath.exists():
        return {}
    data_by_timestamp = {}
    try:
        with filepath.open("r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                ts = row.get("unix_timestamp")
                if ts:
                    data_by_timestamp[str(ts)] = row
    except Exception:
        pass
    return data_by_timestamp


def get_unix_timestamp(date_str: str, tz_info: timezone, is_end: bool = False) -> int:
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz_info)
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59)
        else:
            dt = dt.replace(hour=0, minute=0, second=0)
        return int(dt.timestamp())
    except ValueError:
        raise ScraperError(f"Format tanggal salah: {date_str}. Gunakan YYYY-MM-DD.")


def fetch_chunks(
    symbol: str,
    range_start_sec: int,
    range_end_sec: int,
    token: str,
    all_data: Dict[str, Any],
    config: Dict[str, Any],
    tz_info: timezone,
    delay: float,
    allowed_months: Optional[Set[int]] = None,
) -> None:
    range_start_ms = range_start_sec * 1000
    range_end_ms = range_end_sec * 1000
    curr_start_ms = range_start_ms
    timeframe = config["timeframe"]

    while curr_start_ms <= range_end_ms:
        url = build_url(
            host=config["host"],
            server=config["server"],
            account=config["account"],
            symbol=symbol,
            timeframe=timeframe,
            from_ts=curr_start_ms,
            count=BATCH_SIZE,
            price=config["price"],
        )

        curr_dt_str = datetime.fromtimestamp(
            curr_start_ms / 1000.0, tz=tz_info
        ).strftime("%Y-%m-%d %H:%M")
        print(f"\n  Mengambil data dari {curr_dt_str}...", end="", flush=True)

        try:
            payload = request_json(url, token)
        except ScraperError as e:
            if "HTTP 404" in str(e):
                print(f"\n  [!] Endpoint tidak ditemukan (404) untuk {symbol}.")
                break
            print(f"\n  [!] Gagal mengambil chunk: {e}")
            break

        candles = payload.get("price_history", [])
        if not candles:
            print(" -> Tidak ada candle ditemukan (mungkin pasar libur atau akhir riwayat).")
            break

        added_count = 0
        last_t = candles[-1]["t"]

        for c in candles:
            candle_t = c["t"]
            if candle_t > range_end_ms:
                continue

            unix_sec = int(candle_t / 1000)
            if allowed_months is not None:
                candle_m = datetime.fromtimestamp(unix_sec, tz=tz_info).month
                if candle_m not in allowed_months:
                    continue

            dt_str = datetime.fromtimestamp(unix_sec, tz=tz_info).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
            v = int(c.get("v", 0))

            all_data[str(unix_sec)] = {
                "datetime": dt_str,
                "unix_timestamp": str(unix_sec),
                "symbol": symbol,
                "open": c.get("o", ""),
                "high": c.get("h", ""),
                "low": c.get("l", ""),
                "close": c.get("c", ""),
                "volume": v,
                "value": 0,
                "frequency": 0,
                "foreign_buy": 0,
                "foreign_sell": 0,
                "lot": v,
            }
            added_count += 1

        batch_first_str = datetime.fromtimestamp(
            candles[0]["t"] / 1000.0, tz=tz_info
        ).strftime("%Y-%m-%d %H:%M")
        batch_last_str = datetime.fromtimestamp(
            last_t / 1000.0, tz=tz_info
        ).strftime("%Y-%m-%d %H:%M")

        print(
            f" -> {len(candles)} candle ({batch_first_str} s/d {batch_last_str} | +{added_count} baru/update)"
        )

        if last_t >= range_end_ms or len(candles) < BATCH_SIZE:
            break

        if last_t <= curr_start_ms:
            curr_start_ms += timeframe * 60 * 1000
        else:
            curr_start_ms = last_t + (timeframe * 60 * 1000)

        # Smart leap jika curr_start_ms jatuh pada bulan yang tidak diizinkan
        if allowed_months is not None:
            check_dt = datetime.fromtimestamp(curr_start_ms / 1000.0, tz=tz_info)
            if check_dt.month not in allowed_months:
                sorted_allowed = sorted(list(allowed_months))
                target_year = check_dt.year
                next_m = next((m for m in sorted_allowed if m > check_dt.month), None)
                if next_m is None:
                    next_m = sorted_allowed[0]
                    target_year += 1
                next_dt = datetime(target_year, next_m, 1, 0, 0, 0, tzinfo=tz_info)
                next_ms = int(next_dt.timestamp() * 1000)
                if next_ms > range_end_ms:
                    break
                print(
                    f"\n  [Smart Leap] Melompati periode non-aktif langsung ke {next_dt.strftime('%Y-%m-%d %H:%M')}..."
                )
                curr_start_ms = next_ms

        time.sleep(delay)



def process_symbol(
    symbol: str,
    token: str,
    output_dir: Path,
    start_ts: int,
    end_ts: int,
    config: Dict[str, Any],
    tz_info: timezone,
    delay: float,
    allowed_months: Optional[Set[int]] = None,
) -> None:
    print(f"\n=== Memproses instrumen: {symbol} ===")
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / f"{symbol}_intraday.csv"

    all_data = read_existing_data(filepath)

    if all_data:
        sorted_existing = sorted([int(x) for x in all_data.keys() if x.isdigit()])
        if sorted_existing:
            first_ts = sorted_existing[0]
            last_ts = sorted_existing[-1]
            first_dt_str = datetime.fromtimestamp(first_ts, tz=tz_info).strftime(
                "%Y-%m-%d %H:%M"
            )
            last_dt_str = datetime.fromtimestamp(last_ts, tz=tz_info).strftime(
                "%Y-%m-%d %H:%M"
            )
            print(
                f"  Data tersimpan: {first_dt_str} s/d {last_dt_str} ({len(sorted_existing)} baris)"
            )

            # 1. Backfill masa lalu (jika start_ts < first_ts)
            if start_ts < first_ts:
                print(
                    f"  [Backfill] Mengambil data mundur dari {datetime.fromtimestamp(start_ts, tz=tz_info).strftime('%Y-%m-%d')} s/d {first_dt_str}..."
                )
                fetch_chunks(
                    symbol,
                    start_ts,
                    first_ts - 60,
                    token,
                    all_data,
                    config,
                    tz_info,
                    delay,
                    allowed_months=allowed_months,
                )

            # 2. Forward sync masa depan (jika end_ts > last_ts)
            if end_ts > last_ts:
                print(
                    f"  [Update] Mengambil data terbaru dari {last_dt_str} s/d {datetime.fromtimestamp(end_ts, tz=tz_info).strftime('%Y-%m-%d')}..."
                )
                fetch_chunks(
                    symbol,
                    last_ts + 60,
                    end_ts,
                    token,
                    all_data,
                    config,
                    tz_info,
                    delay,
                    allowed_months=allowed_months,
                )

            if start_ts >= first_ts and end_ts <= last_ts:
                print("  -> Seluruh rentang waktu yang diminta sudah ada dalam cache.")
        else:
            fetch_chunks(
                symbol,
                start_ts,
                end_ts,
                token,
                all_data,
                config,
                tz_info,
                delay,
                allowed_months=allowed_months,
            )
    else:
        print("  Belum ada data sebelumnya. Mengunduh data penuh dari awal...")
        fetch_chunks(
            symbol,
            start_ts,
            end_ts,
            token,
            all_data,
            config,
            tz_info,
            delay,
            allowed_months=allowed_months,
        )

    # Filter kembali hanya bulan yang diizinkan sebelum disimpan
    if allowed_months is not None:
        all_data = {
            k: v
            for k, v in all_data.items()
            if datetime.fromtimestamp(int(k), tz=tz_info).month in allowed_months
        }

    sorted_ts = sorted(all_data.keys(), key=lambda x: int(x) if x.isdigit() else 0)

    # Tulis atomic ke file CSV
    temp_filepath = filepath.with_suffix(".tmp.csv")
    with temp_filepath.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for ts_key in sorted_ts:
            writer.writerow(all_data[ts_key])

    os.replace(temp_filepath, filepath)
    print(f"\n  Berhasil menyimpan ke {filepath.name} (Total baris saat ini: {len(sorted_ts)})")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        print(f"\nExness Intraday Historical Scraper v{SCRIPT_VERSION}")

        script_dir = Path(__file__).resolve().parent
        symbols = []
        if args.symbols_file:
            sym_file = Path(args.symbols_file).expanduser()
            if not sym_file.exists() and (script_dir / args.symbols_file).exists():
                sym_file = script_dir / args.symbols_file
            symbols = load_symbols(str(sym_file))
            print(f"\nMemuat {len(symbols)} kode instrumen dari {sym_file}")
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

        if args.exclude:
            excludes = {normalize_symbol(s) for s in args.exclude.split(",") if s.strip()}
            symbols = [s for s in symbols if s not in excludes]
            print(
                f"\nMelewati (exclude): {', '.join(sorted(excludes))} (Tersisa {len(symbols)} instrumen)"
            )

        if args.tz == "WIB":
            tz_info = WIB
        elif args.tz == "LOCAL":
            tz_info = datetime.now().astimezone().tzinfo or timezone.utc
        else:
            tz_info = timezone.utc

        start_ts = get_unix_timestamp(args.start_date, tz_info, is_end=False)
        now_ts = int(datetime.now(tz=tz_info).timestamp())
        end_ts = min(get_unix_timestamp(args.end_date, tz_info, is_end=True), now_ts)

        print(
            f"Rentang waktu ({args.tz}): {args.start_date} ({start_ts}) s/d {args.end_date} ({end_ts})"
        )

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

        allowed_months = None
        if args.allowed_months:
            allowed_months = {
                int(m.strip())
                for m in args.allowed_months.split(",")
                if m.strip().isdigit()
            }
            print(f"Filter bulan diizinkan aktif: {sorted(allowed_months)}")

        config = {
            "host": args.host,
            "server": args.server,
            "account": args.account,
            "price": args.price,
            "timeframe": args.timeframe,
        }

        for symbol in symbols:
            process_symbol(
                symbol,
                token,
                output_dir,
                start_ts,
                end_ts,
                config,
                tz_info,
                args.delay,
                allowed_months=allowed_months,
            )
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
