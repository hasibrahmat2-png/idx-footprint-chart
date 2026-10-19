#!/usr/bin/env python3
"""
temp_live_trade_recorder.py - Perekam Running Trade Sementara (Auto-Delete Saat Bursa Tutup)
========================================================================================
Merekam tick-by-tick running trade dari WebSocket (wss://stock.arjum.com/ws/running-trade)
ke dalam direktori sementara (RAM Disk /dev/shm atau /tmp) TANPA menyentuh folder data/
atau data_intraday/, dan OTOMATIS MENGHAPUS seluruh file ketika bursa tutup (16:00 WIB).

Fitur Utama:
- 0 Byte Memori SSD Permanen: Menulis ke direktori sementara atau RAM disk.
- Auto-Cleanup Otomatis: Terhapus otomatis begitu status pasar 'closed' atau jam >= 16:00 WIB.
- Stream Buffering: Tidak menumpuk data di RAM, langsung flush per baris (aman untuk RAM 4GB).
- Isolasi Penuh: Bebas konflik dengan build_unified_charts.py, data/, dan data_intraday/.

meow
"""

from __future__ import annotations

import atexit
import csv
import json
import os
import shutil
import signal
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional
from websockets.sync.client import connect

# WIB Timezone (Jakarta UTC+7)
WIB = timezone(timedelta(hours=7))

# Lokasi penyimpanan sementara (Prioritas: RAM Disk /dev/shm -> /tmp)
DEFAULT_TEMP_DIR = Path("/dev/shm/idx_temp_trades") if Path("/dev/shm").exists() else Path("/tmp/idx_temp_trades")
UPSTREAM_WS_URL = "wss://stock.arjum.com/ws/running-trade"

CSV_HEADER = [
    "time",
    "symbol",
    "price",
    "action",
    "lot",
    "value",
    "change_pct",
    "trade_number",
    "market_board"
]


def load_api_key() -> str:
    """Membaca STOCK_API_KEY dari environment atau file .env."""
    key = os.environ.get("STOCK_API_KEY") or os.environ.get("IDX_API_KEY") or ""
    if key:
        return key.strip().strip("'\"")

    env_path = Path(".env")
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("STOCK_API_KEY="):
                        return line.split("=", 1)[1].strip().strip("'\"")
                    elif line.startswith("IDX_API_KEY="):
                        return line.split("=", 1)[1].strip().strip("'\"")
        except Exception:
            pass
    return ""


class TempTradeRecorder:
    def __init__(self, temp_dir: Path, auto_delete_on_exit: bool = True):
        self.temp_dir = temp_dir
        self.auto_delete_on_exit = auto_delete_on_exit
        self.file_handles: Dict[str, csv.writer] = {}
        self.raw_files: Dict[str, any] = {}
        self.total_trades = 0
        self.cleaned_up = False

        # Inisialisasi folder sementara
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        print(f"[+] Lokasi Penyimpanan Sementara: {self.temp_dir} (RAM Disk / Temp)")

    def get_writer(self, symbol: str) -> csv.writer:
        """Membuka file CSV per saham secara streaming jika belum dibuka."""
        if symbol not in self.file_handles:
            csv_path = self.temp_dir / f"{symbol}_live_temp.csv"
            is_new = not csv_path.exists()
            f = open(csv_path, "a", newline="", encoding="utf-8")
            self.raw_files[symbol] = f
            writer = csv.writer(f)
            if is_new:
                writer.writerow(CSV_HEADER)
                f.flush()
            self.file_handles[symbol] = writer
        return self.file_handles[symbol]

    def record_trade(self, data: dict):
        """Mencatat 1 transaksi ke file sementara."""
        sym = (data.get("t") or data.get("symbol") or data.get("code") or "").upper()
        if not sym or (data.get("market_board") and data.get("market_board") != "RG"):
            return

        writer = self.get_writer(sym)
        price = data.get("p") or data.get("price") or 0
        lot = data.get("l") or data.get("lot") or 0
        action = (data.get("c") or data.get("action") or "BUY").upper()
        val = data.get("v") or data.get("value") or (price * lot * 100)
        time_str = data.get("a") or data.get("time") or datetime.now(WIB).strftime("%H:%M:%S")

        writer.writerow([
            time_str,
            sym,
            price,
            action,
            lot,
            val,
            data.get("pc", ""),
            data.get("tn", ""),
            data.get("market_board", "RG")
        ])
        self.raw_files[sym].flush()
        self.total_trades += 1

    def cleanup_all(self, reason: str = "Bursa Tutup"):
        """Menghapus seluruh file sementara dan membersihkan memori."""
        if self.cleaned_up:
            return
        self.cleaned_up = True

        print(f"\n--- [!] TRIGGER CLEANUP: {reason} ---")
        # Tutup semua file handle
        for f in self.raw_files.values():
            try:
                f.close()
            except Exception:
                pass
        self.file_handles.clear()
        self.raw_files.clear()

        # Hapus folder sementara
        if self.temp_dir.exists():
            try:
                shutil.rmtree(self.temp_dir)
                print(f"[✓] SUKSES: Folder {self.temp_dir} telah dihapus otomatis.")
                print(f"[+] Total {self.total_trades:,} transaksi sementara dibersihkan (0 Byte tersisa di SSD).")
            except Exception as e:
                print(f"[!] Gagal menghapus {self.temp_dir}: {e}")


def is_market_closed_wib() -> bool:
    """Mengecek apakah waktu saat ini sudah melewati jam penutupan bursa (>= 16:00 WIB)."""
    now = datetime.now(WIB)
    # 0 = Senin .. 4 = Jumat, 5 = Sabtu, 6 = Minggu
    if now.weekday() in (5, 6):
        return True
    close_time = now.replace(hour=16, minute=0, second=0, microsecond=0)
    return now >= close_time


def run_recorder():
    api_key = load_api_key()
    if not api_key:
        print("[!] ERROR: STOCK_API_KEY tidak ditemukan di .env atau environment variable.")
        sys.exit(1)

    recorder = TempTradeRecorder(DEFAULT_TEMP_DIR, auto_delete_on_exit=True)

    # Register exit handlers agar jika user menekan Ctrl+C file sementara tetap bersih
    def signal_handler(sig, frame):
        print("\n[!] Dihentikan oleh user (Ctrl+C).")
        recorder.cleanup_all(reason="Program Dihentikan")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    atexit.register(lambda: recorder.cleanup_all(reason="Program Selesai"))

    print("\n" + "=" * 65)
    print(" [IDX RUNNING TRADE TEMP RECORDER - AUTO-DELETE]")
    print(f" Upstream WS  : {UPSTREAM_WS_URL}")
    print(f" Target Temp  : {DEFAULT_TEMP_DIR}")
    print(f" Auto Delete  : Saat bursa tutup (16:00 WIB) atau status 'closed'")
    print(f" Target Folder: ISOLASI PENUH (data/ dan data_intraday/ AMAN)")
    print("=" * 65 + "\n")

    while True:
        # Cek jika bursa sudah tutup sebelum koneksi
        if is_market_closed_wib():
            print("[i] Saat ini bursa sedang TUTUP (Closed / Akhir Pekan).")
            print("[i] File sementara otomatis dibersihkan. Menunggu sesi bursa berikutnya...")
            recorder.cleanup_all(reason="Bursa Sedang Tutup")
            time.sleep(30)
            continue

        try:
            print(f"[+] Menghubungkan ke WebSocket stream: {UPSTREAM_WS_URL} ...", flush=True)
            with connect(UPSTREAM_WS_URL, additional_headers={"X-API-Key": api_key}) as ws:
                print("[✓] Terhubung ke IDX Running Trade stream!", flush=True)

                for raw in ws:
                    # 1. Cek jam bursa secara periodik
                    if is_market_closed_wib():
                        print("\n[!] Jam telah menunjukkan >= 16:00 WIB (Bursa Tutup)!")
                        recorder.cleanup_all(reason="Bursa Tutup Pukul 16:00 WIB")
                        break

                    msg = json.loads(raw)
                    msg_type = msg.get("type")

                    # 2. Tangani Snapshot status pasar
                    if msg_type == "snapshot" or "market" in msg:
                        market_info = msg.get("market") or {}
                        status = market_info.get("status", "").lower()
                        print(f"[i] Status Pasar: {status.upper()} (Sesi: {market_info.get('session', '-')})")
                        if status == "closed":
                            recorder.cleanup_all(reason="Status Pasar: CLOSED dari Server")
                            print("[i] Menunggu 60 detik sebelum memeriksa status pasar kembali...\n")
                            time.sleep(60)
                            break

                    # 3. Tangani Match Trade
                    elif msg_type == "trade":
                        data = msg.get("data") or {}
                        recorder.record_trade(data)
                        if recorder.total_trades % 250 == 0:
                            print(f"    -> {recorder.total_trades:,} transaksi sementara tercatat di RAM...", end="\r", flush=True)

                    elif msg_type == "top5":
                        pass

        except Exception as e:
            print(f"[!] Koneksi WebSocket terputus: {e}. Mencoba reconnect dalam 5 detik...")
            time.sleep(5)


if __name__ == "__main__":
    run_recorder()
