"""Position history generation engine for Broker Position Reconstruction."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union
from broker_position_reconstruction.models import BrokerState, BrokerTransaction, PositionRecord
from broker_position_reconstruction.calculator import update_broker_day


def generate_position_history(
    transactions: List[BrokerTransaction],
    free_float: Optional[float] = None,
    ipo_price: Optional[float] = None,
    is_ipo_start: bool = False,
) -> List[PositionRecord]:
    """Reconstructs daily estimated stock positions and weighted average costs.
    
    Invariants:
    - Processed strictly chronologically by date.
    - Positions never drop below zero.
    - Sells while holding do not alter remaining average acquisition cost.
    - Sells exceeding inventory increase implied_initial_position without negative balances.
    - Returns a list of PositionRecord objects (convertible to pandas DataFrame).
    """
    if not transactions:
        return []

    # Sort strictly chronologically by date
    sorted_txs = sorted(transactions, key=lambda t: (t.date, t.symbol, t.broker_code))

    # Determine unique dates in order
    all_dates = sorted(list(set(t.date for t in sorted_txs)))
    first_date = all_dates[0] if all_dates else ""

    # Group transactions by (symbol, broker_code)
    tx_by_sym_brk: Dict[Tuple[str, str], Dict[str, BrokerTransaction]] = {}
    all_symbols = set()
    all_brokers = set()

    for tx in sorted_txs:
        sym = tx.symbol
        brk = tx.broker_code
        all_symbols.add(sym)
        all_brokers.add(brk)
        pair = (sym, brk)
        if pair not in tx_by_sym_brk:
            tx_by_sym_brk[pair] = {}
        tx_by_sym_brk[pair][tx.date] = tx

    records: List[PositionRecord] = []

    # Process each symbol independently
    for sym in sorted(all_symbols):
        # State tracking per broker
        states: Dict[str, BrokerState] = {}

        # Iterate chronologically across all dates for this symbol
        for dt in all_dates:
            is_first_date = (dt == first_date) and is_ipo_start

            # Find brokers active on this date or currently holding a position
            for brk in sorted(all_brokers):
                pair = (sym, brk)
                tx = tx_by_sym_brk.get(pair, {}).get(dt)

                if brk not in states:
                    states[brk] = BrokerState(broker_code=brk, symbol=sym)

                state = states[brk]

                # If no transaction today and broker has no position and no implied, skip generating idle rows
                if tx is None:
                    if state.position == 0 and state.implied_initial_position == 0:
                        continue
                    buy_lot = 0.0
                    buy_avg = None
                    sell_lot = 0.0
                    sell_avg = None
                else:
                    buy_lot = tx.buy_lot
                    buy_avg = tx.buy_average_price
                    sell_lot = tx.sell_lot
                    sell_avg = tx.sell_average_price

                # Update running state
                update_broker_day(
                    state=state,
                    buy_lot=buy_lot,
                    buy_avg=buy_avg,
                    sell_lot=sell_lot,
                    sell_avg=sell_avg,
                    date=dt,
                    is_ipo_date=is_first_date,
                    ipo_price=ipo_price,
                )

                # Calculate unrealized cost (position * average_cost * 100 shares per lot)
                unrealized_cost = 0.0
                if state.position > 0 and state.average_cost is not None:
                    unrealized_cost = round(state.position * state.average_cost * 100.0, 2)

                # Calculate % of Free Float if free_float is provided
                pct_ff = None
                if free_float and free_float > 0:
                    pct_ff = round((state.position / free_float) * 100.0, 4)

                rec = PositionRecord(
                    date=dt,
                    broker=brk,
                    symbol=sym,
                    buy_lot=buy_lot,
                    buy_avg=buy_avg,
                    sell_lot=sell_lot,
                    sell_avg=sell_avg,
                    estimated_position=round(state.position, 2),
                    estimated_average_cost=round(state.average_cost, 2) if state.average_cost is not None else None,
                    implied_initial_position=round(state.implied_initial_position, 2),
                    implied_initial_average=round(state.implied_initial_average, 2) if state.implied_initial_average is not None else None,
                    realized_sell_value=round(state.total_realized_sell_value, 2),
                    estimated_unrealized_cost=unrealized_cost,
                    position_source=state.position_source,
                    pct_free_float=pct_ff,
                )
                records.append(rec)

    # Sort final records by date, then estimated_position descending
    records.sort(key=lambda r: (r.date, r.symbol, -r.estimated_position, r.broker))
    return records


def to_dataframe(records: List[PositionRecord]) -> Any:
    """Converts a list of PositionRecord to a pandas DataFrame if pandas is installed,
    otherwise returns a list of dictionaries.
    """
    dict_list = [r.to_dict() for r in records]
    try:
        import sys
        if '/home/hasibrahmat2/.local/lib/python3.11/site-packages' not in sys.path:
            sys.path.insert(0, '/home/hasibrahmat2/.local/lib/python3.11/site-packages')
        import pandas as pd
        return pd.DataFrame(dict_list)
    except ImportError:
        return dict_list
