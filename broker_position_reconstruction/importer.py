"""Stockbit and generic file importer with automated column schema detection."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from broker_position_reconstruction.models import BrokerTransaction


COLUMN_ALIASES = {
    "date": ["date", "tanggal", "netbs_date", "from_date", "dt", "datetime", "waktu"],
    "broker_code": ["broker_code", "broker", "kode", "netbs_broker_code", "brk", "kode_broker", "broker_id"],
    "symbol": ["symbol", "saham", "kode_saham", "netbs_stock_code", "ticker"],
    "side": ["side", "tipe", "transaksi", "action", "bs"],
    "lot": ["lot", "volume_lot", "lots", "qty_lot", "blot", "slot"],
    "value": ["value", "nilai", "amount", "total_value", "bval", "sval"],
    "avg_price": ["avg_price", "average_price", "avg", "harga", "price", "netbs_buy_avg_price", "netbs_sell_avg_price"],
    "buy_lot": ["buy_lot", "blot", "lot_buy", "beli_lot", "buy_lots", "b_lot", "lot_beli"],
    "buy_value": ["buy_value", "bval", "nilai_beli", "buy_val", "b_val", "val_beli"],
    "buy_avg": ["buy_average_price", "buy_avg", "netbs_buy_avg_price", "avg_buy", "harga_beli", "b_avg"],
    "sell_lot": ["sell_lot", "slot", "lot_sell", "jual_lot", "sell_lots", "s_lot", "lot_jual"],
    "sell_value": ["sell_value", "sval", "nilai_jual", "sell_val", "s_val", "val_jual"],
    "sell_avg": ["sell_average_price", "sell_avg", "netbs_sell_avg_price", "avg_sell", "harga_jual", "s_avg"],
}


def detect_columns(headers: List[str], custom_mapping: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Detect and map raw file headers to standardized internal field names.
    
    Shows the detected mapping and validates required fields.
    """
    mapping = {}
    normalized_headers = {re.sub(r"[\s_]+", "_", h.strip().lower()): h for h in headers}

    if custom_mapping:
        for standard_key, custom_header in custom_mapping.items():
            if custom_header in headers:
                mapping[standard_key] = custom_header

    for standard_key, aliases in COLUMN_ALIASES.items():
        if standard_key in mapping:
            continue
        for alias in aliases:
            norm_alias = re.sub(r"[\s_]+", "_", alias.lower())
            if norm_alias in normalized_headers:
                mapping[standard_key] = normalized_headers[norm_alias]
                break

    return mapping


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


def parse_csv_records(file_path: Path, column_mapping: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """Reads CSV with header detection."""
    with file_path.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        detected = detect_columns(fieldnames, custom_mapping=column_mapping)
        rows = list(reader)
    return rows, detected


def parse_xlsx_records(file_path: Path, column_mapping: Optional[Dict[str, str]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Reads XLSX using openpyxl if available."""
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("openpyxl tidak terpasang untuk membaca file .xlsx. Gunakan file .csv atau instal openpyxl.")

    wb = openpyxl.load_workbook(str(file_path), data_only=True)
    sheet = wb.active
    data_rows = list(sheet.iter_rows(values_only=True))
    if not data_rows:
        return [], {}

    headers = [str(cell) if cell is not None else "" for cell in data_rows[0]]
    detected = detect_columns(headers, custom_mapping=column_mapping)

    rows = []
    for r in data_rows[1:]:
        row_dict = {}
        for idx, h in enumerate(headers):
            if idx < len(r):
                row_dict[h] = r[idx]
        rows.append(row_dict)

    return rows, detected


def parse_broker_summary(
    source: Union[str, Path],
    symbol: Optional[str] = None,
    column_mapping: Optional[Dict[str, str]] = None,
    verbose: bool = False,
) -> List[BrokerTransaction]:
    """Universal parser for Stockbit broker summary files or directories.
    
    Supports:
    1. Directory of daily CSV files (e.g. data_broker_summary/ with JELI_YYYY-MM-DD_YYYY-MM-DD.csv)
    2. Single CSV/XLSX file with vertical BUY/SELL layout (side, broker_code, lot, value, avg_price)
    3. Single CSV/XLSX file with horizontal layout (date, broker, buy_lot, sell_lot...)
    """
    path = Path(source).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"File atau direktori tidak ditemukan: {source}")

    files_to_read: List[Path] = []
    if path.is_dir():
        if symbol:
            sym_clean = symbol.strip().upper()
            # 1. Check dedicated subfolder: path / sym_clean (e.g. data_broker_summary/JELI/)
            sub_dir = path / sym_clean
            if sub_dir.is_dir():
                files_to_read = sorted(sub_dir.glob(f"{sym_clean}_*.csv"))
                if not files_to_read:
                    files_to_read = sorted([
                        f for f in sub_dir.glob("*.csv")
                        if f.name != f"{sym_clean}.csv" and not f.name.endswith(".tmp.csv")
                    ])
            # 2. Fallback to flat directory: path / f"{sym_clean}_*.csv"
            if not files_to_read:
                files_to_read = sorted(path.glob(f"{sym_clean}_*.csv"))
        else:
            files_to_read = sorted(path.glob("*.csv"))
            # If no daily files at root, search subdirectories (e.g. data_broker_summary/*/*.csv)
            if not any("_" in f.stem for f in files_to_read):
                sub_files = sorted(path.glob("*/*.csv"))
                if sub_files:
                    files_to_read = sub_files

            # Filter out summary files like {symbol}.csv and bandar_detector_summary.csv
            files_to_read = [
                f for f in files_to_read
                if "_" in f.stem and f.name != "bandar_detector_summary.csv" and not f.name.endswith(".tmp.csv")
            ]
    else:
        files_to_read = [path]

    if not files_to_read:
        raise ValueError(f"Tidak ada file data yang ditemukan di {path}")

    # Map of (date, broker_code, symbol) -> aggregated activity
    merged_data: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    last_detected_map = {}

    for f in files_to_read:
        if f.suffix.lower() == ".xlsx":
            rows, detected = parse_xlsx_records(f, column_mapping)
        else:
            rows, detected = parse_csv_records(f, column_mapping)

        last_detected_map = detected

        # Validate minimum required fields
        has_broker = "broker_code" in detected
        has_side = "side" in detected
        has_buy_lot = "buy_lot" in detected
        has_sell_lot = "sell_lot" in detected

        if not has_broker:
            raise ValueError(f"Header kode broker tidak ditemukan di {f.name}. Deteksi kolom: {detected}")

        if not has_side and not (has_buy_lot or has_sell_lot):
            raise ValueError(f"Format transaksi tidak valid di {f.name}. Harus memiliki kolom 'side' atau 'buy_lot'/'sell_lot'.")

        broker_col = detected["broker_code"]
        date_col = detected.get("date")
        symbol_col = detected.get("symbol")

        # Determine date from filename if not in row (e.g. JELI_2026-08-10_2026-08-10.csv)
        file_date_match = re.search(r"(\d{4}-\d{2}-\d{2})", f.name)
        file_date_fallback = file_date_match.group(1) if file_date_match else ""

        for r in rows:
            raw_brk = r.get(broker_col)
            if not raw_brk:
                continue
            brk = str(raw_brk).strip().upper()

            # Date resolution
            dt = ""
            if date_col and r.get(date_col):
                raw_d = str(r.get(date_col)).strip()
                # Format YYYYMMDD -> YYYY-MM-DD
                if re.fullmatch(r"\d{8}", raw_d):
                    dt = f"{raw_d[:4]}-{raw_d[4:6]}-{raw_d[6:8]}"
                else:
                    dt = raw_d
            else:
                dt = file_date_fallback

            sym = symbol or ""
            if symbol_col and r.get(symbol_col):
                sym = str(r.get(symbol_col)).strip().upper()

            key = (dt, brk, sym)
            if key not in merged_data:
                merged_data[key] = {
                    "buy_lot": 0.0,
                    "buy_value": 0.0,
                    "buy_avg": None,
                    "sell_lot": 0.0,
                    "sell_value": 0.0,
                    "sell_avg": None,
                }

            rec = merged_data[key]

            # Case A: Vertical layout (side == BUY / SELL)
            if has_side:
                side_val = str(r.get(detected["side"], "")).strip().upper()
                lot_col = detected.get("lot")
                val_col = detected.get("value")
                avg_col = detected.get("avg_price")

                lot = _clean_num(r.get(lot_col)) if lot_col else 0.0
                val = _clean_num(r.get(val_col)) if val_col else 0.0
                avg = _clean_num(r.get(avg_col)) if avg_col else None

                if "BUY" in side_val or side_val == "B":
                    rec["buy_lot"] += lot
                    rec["buy_value"] += val
                    if avg is not None and avg > 0:
                        rec["buy_avg"] = avg
                elif "SELL" in side_val or side_val == "S":
                    rec["sell_lot"] += lot
                    rec["sell_value"] += val
                    if avg is not None and avg > 0:
                        rec["sell_avg"] = avg

            # Case B: Horizontal layout (buy_lot, sell_lot directly)
            else:
                b_lot = _clean_num(r.get(detected.get("buy_lot"))) if "buy_lot" in detected else 0.0
                b_val = _clean_num(r.get(detected.get("buy_value"))) if "buy_value" in detected else 0.0
                b_avg = _clean_num(r.get(detected.get("buy_avg"))) if "buy_avg" in detected else None

                s_lot = _clean_num(r.get(detected.get("sell_lot"))) if "sell_lot" in detected else 0.0
                s_val = _clean_num(r.get(detected.get("sell_value"))) if "sell_value" in detected else 0.0
                s_avg = _clean_num(r.get(detected.get("sell_avg"))) if "sell_avg" in detected else None

                rec["buy_lot"] += b_lot
                rec["buy_value"] += b_val
                if b_avg:
                    rec["buy_avg"] = b_avg
                rec["sell_lot"] += s_lot
                rec["sell_value"] += s_val
                if s_avg:
                    rec["sell_avg"] = s_avg

    if verbose:
        print("\n[Importer] Deteksi Kolom Berhasil:")
        for k, v in last_detected_map.items():
            print(f"  {k:<15} -> {v}")

    # Build sorted list of BrokerTransaction
    transactions: List[BrokerTransaction] = []
    # Sort by date, then broker
    sorted_keys = sorted(merged_data.keys(), key=lambda x: (x[0], x[1]))

    for (d, brk, sym) in sorted_keys:
        info = merged_data[(d, brk, sym)]
        tx = BrokerTransaction(
            date=d,
            broker_code=brk,
            symbol=sym,
            buy_lot=info["buy_lot"],
            buy_value=info["buy_value"],
            buy_average_price=info["buy_avg"],
            sell_lot=info["sell_lot"],
            sell_value=info["sell_value"],
            sell_average_price=info["sell_avg"],
        )
        transactions.append(tx)

    return transactions
