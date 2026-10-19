#!/usr/bin/env python3
"""Root CLI entrypoint for Broker Position Reconstruction & Insider Activity Reconciliation.

Usage:
  python3 reconstruct_broker_positions.py -s JELI --free-float 2660000
  python3 reconstruct_broker_positions.py -i data_broker_summary/ -s MDIA
  python3 reconstruct_broker_positions.py -s JELI --insider-file insider_activity.csv
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional, Sequence

from broker_position_reconstruction.importer import parse_broker_summary
from broker_position_reconstruction.engine import generate_position_history, to_dataframe
from broker_position_reconstruction.insider import process_insider_activity
from broker_position_reconstruction.reconciler import reconcile_positions
from broker_position_reconstruction.cli import (
    print_summary_table,
    print_reconciliation_table,
    save_position_history,
)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rekonstruksi ESTIMATED stock position broker dan rekonsiliasi kepemilikan insider."
    )
    parser.add_argument(
        "-s",
        "--symbol",
        default="JELI",
        help="Kode saham yang dianalisis (default: JELI).",
    )
    parser.add_argument(
        "-i",
        "--input",
        default="data_broker_summary",
        help="Path file CSV/XLSX atau folder data broker summary (default: data_broker_summary).",
    )
    parser.add_argument(
        "--free-float",
        type=float,
        default=None,
        help="Jumlah total saham free float dalam satuan LOT (misalnya 2660000 untuk JELI).",
    )
    parser.add_argument(
        "--ipo-price",
        type=float,
        default=None,
        help="Harga IPO opsional untuk cost basis shortfall pada tanggal IPO.",
    )
    parser.add_argument(
        "--is-ipo",
        action="store_true",
        help="Tandai bahwa tanggal pertama pada dataset adalah tanggal IPO saham.",
    )
    parser.add_argument(
        "--insider-file",
        default=None,
        help="File CSV/JSON laporan transaksi insider/pemegang saham pengendali untuk rekonsiliasi.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="data_broker_positions",
        help="Folder penyimpanan file hasil rekonstruksi CSV dan JSON (default: data_broker_positions).",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=15,
        help="Jumlah broker teratas yang ditampilkan di tabel ringkasan (default: 15).",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="Tanggal tertentu (format YYYY-MM-DD) yang ingin ditampilkan di tabel terminal. Default: tanggal terakhir.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Tampilkan log deteksi skema kolom dan progres detail.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    symbol = args.symbol.strip().upper()

    print("\n" + "=" * 80)
    print(f" BROKER POSITION RECONSTRUCTION ENGINE - {symbol}")
    print("=" * 80)
    print(f" Sumber Input    : {args.input}")
    print(f" Free Float      : {f'{args.free_float:,.0f} lot' if args.free_float else 'Tidak diset'}")
    print(f" Harga IPO       : {f'Rp {args.ipo_price}' if args.ipo_price else '-'}")
    print(f" Folder Output   : {args.output_dir}/\n")

    try:
        # 1. Parse broker summary data
        transactions = parse_broker_summary(
            source=args.input,
            symbol=symbol,
            verbose=args.verbose,
        )

        if not transactions:
            print(f"[!] Tidak ada transaksi broker yang ditemukan untuk {symbol} di {args.input}.", file=sys.stderr)
            return 1

        all_dates = sorted(list(set(t.date for t in transactions)))
        unique_brokers = set(t.broker_code for t in transactions)
        print(f" Memuat {len(transactions)} catatan transaksi dari {len(all_dates)} tanggal perdagangan ({all_dates[0]} s/d {all_dates[-1]}).")
        print(f" Total broker terdeteksi: {len(unique_brokers)} broker.")

        # 2. Generate running position reconstruction
        records = generate_position_history(
            transactions=transactions,
            free_float=args.free_float,
            ipo_price=args.ipo_price,
            is_ipo_start=args.is_ipo,
        )

        # 3. Save position history to CSV and JSON
        output_dir = Path(args.output_dir).expanduser().resolve()
        csv_path = save_position_history(records, output_dir, symbol)
        print(f" Hasil lengkap berhasil disimpan ke: {csv_path.name} & {symbol}_estimated_positions.json")

        # 4. Print summary table for requested or latest date
        display_date = args.date or all_dates[-1]
        print_summary_table(
            records=records,
            date_str=display_date,
            symbol=symbol,
            free_float=args.free_float,
            top_n=args.top,
        )

        # 5. Optional reconciliation with insider data
        if args.insider_file:
            insiders = process_insider_activity(args.insider_file)
            reconciliations = reconcile_positions(records, insiders)
            print_reconciliation_table(reconciliations)

        return 0

    except Exception as e:
        print(f"\n[ERROR] Gagal memproses rekonstruksi posisi: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
