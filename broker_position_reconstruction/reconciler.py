"""Reconciliation module comparing estimated broker positions with insider / reported ownership."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union
from broker_position_reconstruction.models import InsiderRecord, PositionRecord, ReconciliationRecord


def reconcile_positions(
    position_records: List[PositionRecord],
    insider_records: List[InsiderRecord],
    broker_entity_map: Optional[Dict[str, str]] = None,
) -> List[ReconciliationRecord]:
    """Compares estimated broker positions against reported insider / controller data.
    
    Invariants:
    - Never forces values to match.
    - Discrepancies are explicitly reported with difference and percentage.
    - If broker_entity_map is provided (e.g. {'XL': 'Controlling Shareholder'}), it pairs them;
      otherwise it compares on matching dates.
    """
    reconciliation_results: List[ReconciliationRecord] = []
    broker_map = broker_entity_map or {}

    # Index position records by (date, broker)
    pos_by_date_broker: Dict[Tuple[str, str], PositionRecord] = {}
    for p in position_records:
        pos_by_date_broker[(p.date, p.broker)] = p

    # Index latest position by broker
    latest_by_broker: Dict[str, PositionRecord] = {}
    for p in sorted(position_records, key=lambda x: x.date):
        latest_by_broker[p.broker] = p

    for ins in insider_records:
        matched_broker = None

        # Check if mapped to a specific broker
        for brk, ent in broker_map.items():
            if ent.lower() in ins.person_entity.lower() or ins.person_entity.lower() in ent.lower():
                matched_broker = brk
                break

        # If no explicit mapping, compare against top holding brokers or compare on date
        candidate_brokers = [matched_broker] if matched_broker else list(latest_by_broker.keys())

        for brk in candidate_brokers:
            # Check exact date first, fallback to latest position on or before date
            pos_rec = pos_by_date_broker.get((ins.date, brk))
            if not pos_rec:
                # Find latest prior to ins.date
                priors = [p for (d, b), p in pos_by_date_broker.items() if b == brk and d <= ins.date]
                if priors:
                    pos_rec = max(priors, key=lambda x: x.date)

            if pos_rec:
                est_pos = pos_rec.estimated_position
                # Reported position in lots
                rep_pos = ins.lots if ins.lots > 0 else (ins.ownership_after_transaction or 0.0) / 100.0

                diff = est_pos - rep_pos
                diff_pct = (diff / rep_pos * 100.0) if rep_pos > 0 else None

                notes = []
                if matched_broker:
                    notes.append(f"Mapped broker {brk} to {ins.person_entity}")
                else:
                    notes.append(f"Unmapped comparison with broker {brk}")

                if diff != 0:
                    notes.append(f"Discrepancy: {diff:+,.0f} lots ({diff_pct:+.1f}%)" if diff_pct is not None else f"Discrepancy: {diff:+,.0f} lots")
                else:
                    notes.append("Positions perfectly aligned.")

                rec = ReconciliationRecord(
                    date=ins.date,
                    symbol=pos_rec.symbol,
                    broker=brk,
                    reported_entity=ins.person_entity,
                    estimated_position=round(est_pos, 2),
                    reported_position=round(rep_pos, 2),
                    difference=round(diff, 2),
                    difference_percentage=round(diff_pct, 2) if diff_pct is not None else None,
                    notes="; ".join(notes),
                )
                reconciliation_results.append(rec)

    return reconciliation_results
