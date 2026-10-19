"""Core mathematical calculations for Broker Position Reconstruction.

Invariants:
- Estimated position must NEVER be negative.
- Shortfalls trigger an implied_initial_position back-adjustment.
- Sells while holding a position DO NOT change the average acquisition price.
- When position reaches zero, average cost is reset to None.
"""

from __future__ import annotations

from typing import Optional, Tuple
from broker_position_reconstruction.models import BrokerState


def calculate_average_price(
    previous_position: float,
    previous_average_price: Optional[float],
    buy_lot: float,
    buy_average_price: float,
) -> float:
    """Calculate the new weighted average acquisition cost after a BUY transaction.
    
    Formula:
        new_average_price = (prev_pos * prev_avg + buy_lot * buy_avg) / (prev_pos + buy_lot)
    """
    if buy_lot <= 0:
        return previous_average_price if previous_average_price is not None else buy_average_price

    if previous_position <= 0 or previous_average_price is None:
        return round(buy_average_price, 4)

    total_lots = previous_position + buy_lot
    weighted_total = (previous_position * previous_average_price) + (buy_lot * buy_average_price)
    return round(weighted_total / total_lots, 4)


def calculate_running_position(
    previous_position: float,
    buy_lot: float,
    sell_lot: float,
) -> Tuple[float, float]:
    """Calculate the updated position and any shortfall that would cause position < 0.
    
    Returns:
        (new_position, shortfall)
    """
    raw_net = previous_position + buy_lot - sell_lot
    if raw_net < 0:
        shortfall = -raw_net
        return 0.0, shortfall
    return raw_net, 0.0


def apply_implied_initial_position(
    state: BrokerState,
    shortfall: float,
    sell_price: Optional[float],
    date: str,
    is_ipo: bool = False,
    ipo_price: Optional[float] = None,
) -> None:
    """Perform implied initial position adjustment when sells exceed tracked inventory.
    
    Prevents negative inventory by assuming the broker previously acquired shares
    prior to or at the start of the observation period.
    """
    if shortfall <= 0:
        return

    # Determine cost basis for the shortfall
    if is_ipo and ipo_price is not None:
        cost_basis = ipo_price
    elif sell_price is not None:
        cost_basis = sell_price
    elif ipo_price is not None:
        cost_basis = ipo_price
    else:
        cost_basis = 0.0

    prev_implied = state.implied_initial_position
    prev_avg = state.implied_initial_average or 0.0
    new_implied = prev_implied + shortfall

    if prev_implied <= 0 or state.implied_initial_average is None:
        state.implied_initial_average = round(cost_basis, 4) if cost_basis > 0 else None
    else:
        if cost_basis > 0:
            weighted_cost = (prev_implied * prev_avg) + (shortfall * cost_basis)
            state.implied_initial_average = round(weighted_cost / new_implied, 4)

    state.implied_initial_position = new_implied

    state.shortfall_history.append({
        "date": date,
        "shortfall": shortfall,
        "cost_basis_used": cost_basis,
        "is_ipo": is_ipo,
        "total_implied": state.implied_initial_position,
        "implied_avg": state.implied_initial_average,
    })


def update_broker_day(
    state: BrokerState,
    buy_lot: float,
    buy_avg: Optional[float],
    sell_lot: float,
    sell_avg: Optional[float],
    date: str,
    is_ipo_date: bool = False,
    ipo_price: Optional[float] = None,
) -> None:
    """Processes a single day's trading activity for a broker, updating running state."""
    prev_pos = state.position
    prev_avg = state.average_cost

    # Step 1: Incorporate BUY if any
    if buy_lot > 0:
        state.total_bought_lots += buy_lot
        effective_buy_avg = buy_avg if buy_avg is not None else (ipo_price or 0.0)
        state.average_cost = calculate_average_price(prev_pos, prev_avg, buy_lot, effective_buy_avg)
        interim_pos = prev_pos + buy_lot
    else:
        interim_pos = prev_pos

    # Step 2: Incorporate SELL if any
    if sell_lot > 0:
        state.total_sold_lots += sell_lot
        effective_sell_avg = sell_avg if sell_avg is not None else 0.0
        # In IDX: 1 lot = 100 shares. Total realized value = sell_lot * sell_avg * 100
        state.total_realized_sell_value += (sell_lot * effective_sell_avg * 100.0)

        new_pos, shortfall = calculate_running_position(interim_pos, 0.0, sell_lot)

        if shortfall > 0:
            apply_implied_initial_position(
                state=state,
                shortfall=shortfall,
                sell_price=sell_avg,
                date=date,
                is_ipo=is_ipo_date,
                ipo_price=ipo_price,
            )
            state.position = 0.0
            state.average_cost = None
        else:
            state.position = new_pos
            if state.position == 0.0:
                state.average_cost = None
            # If position remains > 0, average_cost is unchanged
    else:
        state.position = interim_pos

    # Step 3: Determine position source label
    if state.implied_initial_position > 0:
        if state.total_bought_lots > 0:
            state.position_source = "mixed"
        else:
            state.position_source = "implied_initial"
    elif state.total_bought_lots > 0:
        state.position_source = "observed"
    else:
        state.position_source = "none"
