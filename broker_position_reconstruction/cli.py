"""Command Line Interface for Broker Position Reconstruction."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from broker_position_reconstruction.models import PositionRecord, ReconciliationRecord
from broker_position_reconstruction.importer import parse_broker_summary
from broker_position_reconstruction.insider import process_insider_activity
from broker_position_reconstruction.reconciler import reconcile_positions
from broker_position_reconstruction.engine import generate_position_history, to_dataframe


def format_num(val: Optional[float], decimals: int = 1) -> str:
    if val is None:
        return "-"
    abs_v = abs(val)
    sign = "-" if val < 0 else ""
    if abs_v >= 1e12:
        return f"{sign}{abs_v / 1e12:.2f}T"
    if abs_v >= 1e9:
        return f"{sign}{abs_v / 1e9:.2f}B"
    if abs_v >= 1e6:
        return f"{sign}{abs_v / 1e6:.2f}M"
    if abs_v >= 1e3:
        return f"{sign}{abs_v / 1e3:.1f}K"
    return f"{sign}{abs_v:.{decimals}f}"


def print_summary_table(
    records: List[PositionRecord],
    date_str: str,
    symbol: str,
    free_float: Optional[float] = None,
    top_n: int = 15,
) -> None:
    """Renders a high-contrast terminal table showing estimated positions per broker on a specific date."""
    # Filter for the target date
    day_recs = [r for r in records if r.date == date_str]
    # Sort by estimated_position descending
    day_recs.sort(key=lambda r: -r.estimated_position)

    tot_est_pos = sum(r.estimated_position for r in day_recs)
    tot_unrealized = sum(r.estimated_unrealized_cost for r in day_recs)
    tot_implied = sum(r.implied_initial_position for r in day_recs)

    print("\n" + "=" * 115)
    print(f" ESTIMATED BROKER POSITIONS (NOT ACTUAL HOLDINGS) - {symbol} ({date_str})")
    if free_float:
        ff_str = format_num(free_float, 2)
        pct_tracked = (tot_est_pos / free_float * 100.0) if free_float > 0 else 0.0
        print(f" Free Float: {ff_str} Lots ({free_float:,.0f}) | Tracked by Active Brokers: {format_num(tot_est_pos)} Lots ({pct_tracked:.1f}%)")
    print(f" Total Est. Position: {format_num(tot_est_pos)} Lots | Est. Unrealized Cost: Rp {format_num(tot_unrealized)} | Total Implied: {format_num(tot_implied)} Lots")
    print("-" * 115)
    
    header = (
        f" {'#':<3} {'BROKER':<6} {'EST. POSITION':>14} "
        f"{'% FREE FLOAT':>13} {'EST. AVG COST':>14} {'UNREALIZED COST':>16} "
        f"{'IMPLIED POS':>12} {'IMPLIED AVG':>12} {'SOURCE':<14}"
    )
    print(header)
    print("-" * 115)

    displayed = day_recs[:top_n]
    for idx, r in enumerate(displayed, start=1):
        pos_str = f"{r.estimated_position:,.0f}"
        ff_str = f"{r.pct_free_float:.2f}%" if r.pct_free_float is not None else "-"
        avg_str = f"Rp {r.estimated_average_cost:,.2f}" if r.estimated_average_cost is not None else "-"
        unreal_str = f"Rp {format_num(r.estimated_unrealized_cost)}"
        imp_str = f"{r.implied_initial_position:,.0f}" if r.implied_initial_position > 0 else "-"
        imp_avg_str = f"Rp {r.implied_initial_average:,.0f}" if r.implied_initial_average is not None else "-"
        src_str = r.position_source

        line = (
            f" {idx:<3} {r.broker:<6} {pos_str:>14} "
            f"{ff_str:>13} {avg_str:>14} {unreal_str:>16} "
            f"{imp_str:>12} {imp_avg_str:>12} {src_str:<14}"
        )
        print(line)

    if len(day_recs) > top_n:
        print(f" ... dan {len(day_recs) - top_n} broker lainnya.")
    print("=" * 115)
    print(" Catatan Penting: Broker Summary mencerminkan lalu lintas transaksi nasabah melalui broker,")
    print(" bukan kepemilikan aset resmi sekuritas. Gunakan data ini semata-mata sebagai estimasi akumulasi.\n")


def print_reconciliation_table(reconciliations: List[ReconciliationRecord]) -> None:
    """Renders table comparing estimated broker positions against reported insider ownership."""
    if not reconciliations:
        return

    print("\n" + "=" * 115)
    print(" RECONCILIATION: ESTIMATED BROKER POSITIONS VS REPORTED INSIDER OWNERSHIP")
    print("-" * 115)
    print(f" {'DATE':<11} {'BROKER':<7} {'REPORTED ENTITY':<30} {'EST. POS (LOT)':>15} {'REP. POS (LOT)':>15} {'DIFF (LOT)':>13} {'DISCREPANCY':>12}")
    print("-" * 115)

    for r in reconciliations:
        pct_str = f"{r.difference_percentage:+.1f}%" if r.difference_percentage is not None else "-"
        print(
            f" {r.date:<11} {r.broker:<7} {r.reported_entity[:28]:<30} "
            f"{r.estimated_position:>15,.0f} {r.reported_position:>15,.0f} "
            f"{r.difference:>13,.0f} {pct_str:>12}"
        )
    print("=" * 115 + "\n")


def save_position_history(
    records: List[PositionRecord],
    output_dir: Path,
    symbol: str,
) -> Path:
    """Exports full position reconstruction history to CSV and JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_file = output_dir / f"{symbol}_estimated_positions.csv"
    json_file = output_dir / f"{symbol}_estimated_positions.json"

    fieldnames = [
        "date",
        "broker",
        "symbol",
        "buy_lot",
        "buy_avg",
        "sell_lot",
        "sell_avg",
        "estimated_position",
        "estimated_average_cost",
        "implied_initial_position",
        "implied_initial_average",
        "realized_sell_value",
        "estimated_unrealized_cost",
        "position_source",
        "pct_free_float",
    ]

    # Write CSV
    with csv_file.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in records:
            writer.writerow(r.to_dict())

    # Write JSON
    with json_file.open("w", encoding="utf-8") as f:
        json.dump([r.to_dict() for r in records], f, indent=2, ensure_ascii=False)

    return csv_file
