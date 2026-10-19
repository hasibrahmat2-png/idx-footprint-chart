"""
build_screener.py - Backward-compatible wrapper that invokes generate_screener()
from build_unified_charts.py to produce indicator-examples/public/screener_data.json
and ensures trade history & open portfolio positions are reconciled.
"""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from build_unified_charts import generate_screener

def build_screener():
    generate_screener()
    try:
        from fetch_stockbit_trade_history import process_and_export
        print("\n=== Reconciling Trade History & Open Portfolio Positions ===")
        process_and_export()
    except Exception as e:
        print(f"Notice: Trade history sync during screener build: {e}")

if __name__ == "__main__":
    build_screener()
