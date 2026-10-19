"""Data models for Broker Position Reconstruction & Insider Reconciliation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class BrokerTransaction:
    """Represents daily trading activity for a broker in a specific stock."""
    date: str
    broker_code: str
    symbol: str = ""
    buy_lot: float = 0.0
    buy_value: float = 0.0
    buy_average_price: Optional[float] = None
    sell_lot: float = 0.0
    sell_value: float = 0.0
    sell_average_price: Optional[float] = None

    def __post_init__(self) -> None:
        # Standardize broker code
        self.broker_code = self.broker_code.strip().upper()
        if self.symbol:
            self.symbol = self.symbol.strip().upper()

        # Resolve buy average price if missing
        if self.buy_average_price is None or self.buy_average_price == 0:
            if self.buy_lot > 0 and self.buy_value > 0:
                # Check if buy_value is total IDR and lot is 100 shares
                raw_avg = self.buy_value / self.buy_lot
                # In IDX: 1 lot = 100 shares. If value is total IDR, price per share is value / (lot * 100)
                # But if value was already per lot, raw_avg is used.
                # Standard Stockbit value is total IDR (e.g. 3M IDR for 44,000 lots @ 680)
                if raw_avg > 10000 and self.buy_value / (self.buy_lot * 100) < 50000:
                    self.buy_average_price = round(self.buy_value / (self.buy_lot * 100), 2)
                else:
                    self.buy_average_price = round(raw_avg, 2)
            else:
                self.buy_average_price = None

        # Resolve sell average price if missing
        if self.sell_average_price is None or self.sell_average_price == 0:
            if self.sell_lot > 0 and self.sell_value > 0:
                raw_avg = self.sell_value / self.sell_lot
                if raw_avg > 10000 and self.sell_value / (self.sell_lot * 100) < 50000:
                    self.sell_average_price = round(self.sell_value / (self.sell_lot * 100), 2)
                else:
                    self.sell_average_price = round(raw_avg, 2)
            else:
                self.sell_average_price = None


@dataclass
class BrokerState:
    """Maintains the running reconstructed position and cost basis for a broker."""
    broker_code: str
    symbol: str = ""
    position: float = 0.0
    average_cost: Optional[float] = None
    implied_initial_position: float = 0.0
    implied_initial_average: Optional[float] = None
    total_bought_lots: float = 0.0
    total_sold_lots: float = 0.0
    total_realized_sell_value: float = 0.0
    shortfall_history: List[Dict[str, Any]] = field(default_factory=list)
    position_source: str = "none"


@dataclass
class PositionRecord:
    """Output table row representing reconstructed broker state on a specific date."""
    date: str
    broker: str
    buy_lot: float
    buy_avg: Optional[float]
    sell_lot: float
    sell_avg: Optional[float]
    estimated_position: float
    estimated_average_cost: Optional[float]
    implied_initial_position: float
    implied_initial_average: Optional[float]
    realized_sell_value: float
    estimated_unrealized_cost: float
    position_source: str
    symbol: str = ""
    pct_free_float: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date,
            "broker": self.broker,
            "symbol": self.symbol,
            "buy_lot": self.buy_lot,
            "buy_avg": self.buy_avg,
            "sell_lot": self.sell_lot,
            "sell_avg": self.sell_avg,
            "estimated_position": self.estimated_position,
            "estimated_average_cost": self.estimated_average_cost,
            "implied_initial_position": self.implied_initial_position,
            "implied_initial_average": self.implied_initial_average,
            "realized_sell_value": self.realized_sell_value,
            "estimated_unrealized_cost": self.estimated_unrealized_cost,
            "position_source": self.position_source,
            "pct_free_float": self.pct_free_float,
        }


@dataclass
class InsiderRecord:
    """Represents insider or major shareholder transaction/ownership report."""
    date: str
    person_entity: str
    role: str = ""
    transaction_type: str = "OTHER"  # BUY, SELL, CROSSING, CORPORATE_ACTION, OTHER
    shares: float = 0.0
    lots: float = 0.0
    price: Optional[float] = None
    ownership_after_transaction: Optional[float] = None
    symbol: str = ""

    def __post_init__(self) -> None:
        if self.lots == 0.0 and self.shares > 0.0:
            self.lots = round(self.shares / 100.0, 2)
        elif self.shares == 0.0 and self.lots > 0.0:
            self.shares = round(self.lots * 100.0, 2)
        self.transaction_type = self.transaction_type.upper()


@dataclass
class ReconciliationRecord:
    """Comparison between estimated broker position and reported ownership."""
    date: str
    symbol: str
    broker: str
    reported_entity: str
    estimated_position: float
    reported_position: float
    difference: float
    difference_percentage: Optional[float]
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date,
            "symbol": self.symbol,
            "broker": self.broker,
            "reported_entity": self.reported_entity,
            "estimated_position": self.estimated_position,
            "reported_position": self.reported_position,
            "difference": self.difference,
            "difference_percentage": self.difference_percentage,
            "notes": self.notes,
        }
