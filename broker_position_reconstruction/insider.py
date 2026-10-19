"""Insider Activity & Ownership Report processor."""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from broker_position_reconstruction.models import InsiderRecord


INSIDER_COLUMN_ALIASES = {
    "date": ["date", "tanggal", "waktu", "transaction_date"],
    "person_entity": ["person", "entity", "insider", "nama", "name", "pemilik", "shareholder", "controller"],
    "role": ["role", "jabatan", "position", "hubungan", "status"],
    "transaction_type": ["transaction_type", "type", "tipe", "aksi", "action", "transaksi"],
    "shares": ["shares", "jumlah_saham", "lembar", "qty_shares", "volume_shares"],
    "lots": ["lots", "lot", "jumlah_lot", "qty_lot"],
    "price": ["price", "harga", "avg_price", "harga_pelaksanaan"],
    "ownership_after": ["ownership_after_transaction", "after", "saham_setelah", "kepemilikan_akhir", "shares_after"],
    "symbol": ["symbol", "saham", "ticker", "kode"],
}


def _clean_num(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def process_insider_activity(
    source: Union[str, Path, List[Dict[str, Any]]],
    column_mapping: Optional[Dict[str, str]] = None,
) -> List[InsiderRecord]:
    """Parse Insider Activity / Ownership report data from CSV, JSON, or Python list.
    
    Standardizes transaction types: BUY, SELL, CROSSING, CORPORATE_ACTION, OTHER.
    """
    records: List[InsiderRecord] = []

    if isinstance(source, list):
        raw_rows = source
    else:
        path = Path(source).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"File insider tidak ditemukan: {source}")

        if path.suffix.lower() == ".json":
            import json
            with path.open("r", encoding="utf-8") as f:
                raw_rows = json.load(f)
                if not isinstance(raw_rows, list):
                    raw_rows = [raw_rows]
        else:
            with path.open("r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                raw_rows = list(reader)

    if not raw_rows:
        return []

    # Detect columns from first row
    first_keys = list(raw_rows[0].keys())
    detected = {}
    normalized_keys = {re.sub(r"[\s_]+", "_", k.strip().lower()): k for k in first_keys}

    if column_mapping:
        for standard_key, custom_col in column_mapping.items():
            if custom_col in first_keys:
                detected[standard_key] = custom_col

    for standard_key, aliases in INSIDER_COLUMN_ALIASES.items():
        if standard_key in detected:
            continue
        for alias in aliases:
            norm_alias = re.sub(r"[\s_]+", "_", alias.lower())
            if norm_alias in normalized_keys:
                detected[standard_key] = normalized_keys[norm_alias]
                break

    for r in raw_rows:
        date_col = detected.get("date")
        person_col = detected.get("person_entity")
        role_col = detected.get("role")
        type_col = detected.get("transaction_type")
        shares_col = detected.get("shares")
        lots_col = detected.get("lots")
        price_col = detected.get("price")
        after_col = detected.get("ownership_after")
        sym_col = detected.get("symbol")

        raw_type = str(r.get(type_col, "OTHER")).strip().upper()
        if "BUY" in raw_type or "BELI" in raw_type:
            tx_type = "BUY"
        elif "SELL" in raw_type or "JUAL" in raw_type:
            tx_type = "SELL"
        elif "CROSS" in raw_type or "NEGO" in raw_type:
            tx_type = "CROSSING"
        elif "CORP" in raw_type or "SPLIT" in raw_type or "RIGHT" in raw_type:
            tx_type = "CORPORATE_ACTION"
        else:
            tx_type = raw_type or "OTHER"

        sh = _clean_num(r.get(shares_col)) if shares_col else 0.0
        lt = _clean_num(r.get(lots_col)) if lots_col else 0.0
        pr = _clean_num(r.get(price_col)) if price_col else None
        oa = _clean_num(r.get(after_col)) if after_col else None

        rec = InsiderRecord(
            date=str(r.get(date_col, "")).strip(),
            person_entity=str(r.get(person_col, "Unknown")).strip(),
            role=str(r.get(role_col, "")).strip(),
            transaction_type=tx_type,
            shares=sh,
            lots=lt,
            price=pr,
            ownership_after_transaction=oa,
            symbol=str(r.get(sym_col, "")).strip().upper(),
        )
        records.append(rec)

    # Sort chronologically
    records.sort(key=lambda x: x.date)
    return records
