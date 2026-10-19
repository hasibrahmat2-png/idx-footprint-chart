#!/usr/bin/env python3
"""Comprehensive Unit Tests for Broker Position Reconstruction & Insider Reconciliation.

Covers the 12 required test specifications:
1. BUY without SELL
2. SELL after BUY
3. SELL when position is zero
4. BUY after position returns to zero
5. Multiple BUY transactions at different prices
6. Multiple SELL transactions
7. Implied initial position
8. IPO using ipo_price
9. Position reaches zero
10. Insider Activity does not match broker data
11. Multiple brokers
12. Multiple stocks
"""

import tempfile
import unittest
from pathlib import Path
from broker_position_reconstruction.models import (
    BrokerTransaction,
    InsiderRecord,
)
from broker_position_reconstruction.calculator import (
    calculate_average_price,
    calculate_running_position,
)
from broker_position_reconstruction.importer import parse_broker_summary
from broker_position_reconstruction.engine import generate_position_history
from broker_position_reconstruction.insider import process_insider_activity
from broker_position_reconstruction.reconciler import reconcile_positions


class TestBrokerPositionReconstruction(unittest.TestCase):

    def test_01_buy_without_sell(self):
        """Case 1: BUY without SELL establishes position and cost basis."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="PD", buy_lot=1000, buy_average_price=1000, sell_lot=0)
        ]
        history = generate_position_history(txs)
        self.assertEqual(len(history), 1)
        rec = history[0]
        self.assertEqual(rec.estimated_position, 1000)
        self.assertEqual(rec.estimated_average_cost, 1000)
        self.assertEqual(rec.implied_initial_position, 0)
        self.assertEqual(rec.position_source, "observed")

    def test_02_sell_after_buy(self):
        """Case 2: SELL after BUY decreases position but keeps average cost unchanged."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="PD", buy_lot=600, buy_average_price=1000, sell_lot=0),
            BrokerTransaction(date="2026-01-02", broker_code="PD", buy_lot=0, sell_lot=200, sell_average_price=1200),
        ]
        history = generate_position_history(txs)
        rec1 = [h for h in history if h.date == "2026-01-01"][0]
        rec2 = [h for h in history if h.date == "2026-01-02"][0]

        self.assertEqual(rec1.estimated_position, 600)
        self.assertEqual(rec1.estimated_average_cost, 1000)

        # Selling 200 lots @ 1200 leaves 400 lots @ 1000 unchanged
        self.assertEqual(rec2.estimated_position, 400)
        self.assertEqual(rec2.estimated_average_cost, 1000)
        self.assertEqual(rec2.implied_initial_position, 0)

    def test_03_sell_when_position_is_zero(self):
        """Case 3: SELL when position is zero triggers implied initial position and keeps pos=0 (never negative)."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="PD", buy_lot=0, sell_lot=600, sell_average_price=1200),
        ]
        history = generate_position_history(txs)
        self.assertEqual(len(history), 1)
        rec = history[0]
        self.assertEqual(rec.estimated_position, 0)  # Never negative
        self.assertIsNone(rec.estimated_average_cost)
        self.assertEqual(rec.implied_initial_position, 600)
        self.assertEqual(rec.implied_initial_average, 1200)
        self.assertEqual(rec.position_source, "implied_initial")

    def test_04_buy_after_position_returns_to_zero(self):
        """Case 4: BUY after position returns to zero restarts average cost from the new BUY price."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="PD", buy_lot=500, buy_average_price=1000, sell_lot=0),
            BrokerTransaction(date="2026-01-02", broker_code="PD", buy_lot=0, sell_lot=500, sell_average_price=1100),
            BrokerTransaction(date="2026-01-03", broker_code="PD", buy_lot=300, buy_average_price=1500, sell_lot=0),
        ]
        history = generate_position_history(txs)
        rec2 = [h for h in history if h.date == "2026-01-02"][0]
        rec3 = [h for h in history if h.date == "2026-01-03"][0]

        self.assertEqual(rec2.estimated_position, 0)
        self.assertIsNone(rec2.estimated_average_cost)

        self.assertEqual(rec3.estimated_position, 300)
        self.assertEqual(rec3.estimated_average_cost, 1500)  # Restarted cleanly

    def test_05_multiple_buys_at_different_prices(self):
        """Case 5: Multiple BUY transactions properly calculate weighted average cost."""
        # 1000 @ 1000, then 500 @ 1100 -> (1000*1000 + 500*1100) / 1500 = 1,033.33
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="XL", buy_lot=1000, buy_average_price=1000, sell_lot=0),
            BrokerTransaction(date="2026-01-02", broker_code="XL", buy_lot=500, buy_average_price=1100, sell_lot=0),
        ]
        history = generate_position_history(txs)
        rec2 = [h for h in history if h.date == "2026-01-02"][0]
        self.assertEqual(rec2.estimated_position, 1500)
        self.assertAlmostEqual(rec2.estimated_average_cost, 1033.33, places=2)

    def test_06_multiple_sells(self):
        """Case 6: Multiple SELL transactions maintain original average cost."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="XL", buy_lot=1000, buy_average_price=500, sell_lot=0),
            BrokerTransaction(date="2026-01-02", broker_code="XL", buy_lot=0, sell_lot=300, sell_average_price=600),
            BrokerTransaction(date="2026-01-03", broker_code="XL", buy_lot=0, sell_lot=200, sell_average_price=700),
        ]
        history = generate_position_history(txs)
        rec2 = [h for h in history if h.date == "2026-01-02"][0]
        rec3 = [h for h in history if h.date == "2026-01-03"][0]

        self.assertEqual(rec2.estimated_position, 700)
        self.assertEqual(rec2.estimated_average_cost, 500)

        self.assertEqual(rec3.estimated_position, 500)
        self.assertEqual(rec3.estimated_average_cost, 500)

    def test_07_implied_initial_position(self):
        """Case 7: Selling more than current inventory accumulates shortfall into implied_initial_position."""
        # Start 0, Sell 200 -> Shortfall 200
        # Then Buy 500 @ 1000 -> Pos 500
        # Then Sell 700 @ 1200 -> Shortfall 200 -> Implied becomes 400
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="MG", buy_lot=0, sell_lot=200, sell_average_price=1000),
            BrokerTransaction(date="2026-01-02", broker_code="MG", buy_lot=500, buy_average_price=1100, sell_lot=0),
            BrokerTransaction(date="2026-01-03", broker_code="MG", buy_lot=0, sell_lot=700, sell_average_price=1200),
        ]
        history = generate_position_history(txs)
        rec1 = [h for h in history if h.date == "2026-01-01"][0]
        rec2 = [h for h in history if h.date == "2026-01-02"][0]
        rec3 = [h for h in history if h.date == "2026-01-03"][0]

        self.assertEqual(rec1.estimated_position, 0)
        self.assertEqual(rec1.implied_initial_position, 200)

        self.assertEqual(rec2.estimated_position, 500)
        self.assertEqual(rec2.implied_initial_position, 200)

        self.assertEqual(rec3.estimated_position, 0)
        self.assertEqual(rec3.implied_initial_position, 400)
        self.assertEqual(rec3.position_source, "mixed")

    def test_08_ipo_using_ipo_price(self):
        """Case 8: Implied initial position on IPO date uses ipo_price as initial cost basis."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="CC", buy_lot=0, sell_lot=600, sell_average_price=1500)
        ]
        history = generate_position_history(txs, ipo_price=1000, is_ipo_start=True)
        self.assertEqual(len(history), 1)
        rec = history[0]
        self.assertEqual(rec.estimated_position, 0)
        self.assertEqual(rec.implied_initial_position, 600)
        # Should use ipo_price (1000), not sell price (1500)
        self.assertEqual(rec.implied_initial_average, 1000)
        self.assertEqual(rec.position_source, "implied_initial")

    def test_09_position_reaches_zero(self):
        """Case 9: Position exactly reaching zero sets average cost to null."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="YP", buy_lot=400, buy_average_price=800, sell_lot=0),
            BrokerTransaction(date="2026-01-02", broker_code="YP", buy_lot=0, sell_lot=400, sell_average_price=900),
        ]
        history = generate_position_history(txs)
        rec2 = [h for h in history if h.date == "2026-01-02"][0]
        self.assertEqual(rec2.estimated_position, 0)
        self.assertIsNone(rec2.estimated_average_cost)

    def test_10_insider_activity_does_not_match_broker_data(self):
        """Case 10: Insider Activity discrepancy is reported explicitly without forcing match."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="XL", symbol="TEST", buy_lot=10000, buy_average_price=500, sell_lot=0),
        ]
        history = generate_position_history(txs)

        insiders = [
            InsiderRecord(
                date="2026-01-01",
                person_entity="Direktur Utama PT Test",
                role="Controller",
                transaction_type="SELL",
                shares=2000000,  # 20,000 lots
                price=520,
                ownership_after_transaction=80000000,
                symbol="TEST",
            )
        ]

        recon = reconcile_positions(
            position_records=history,
            insider_records=insiders,
            broker_entity_map={"XL": "Direktur Utama PT Test"},
        )
        self.assertEqual(len(recon), 1)
        r = recon[0]
        self.assertEqual(r.broker, "XL")
        self.assertEqual(r.estimated_position, 10000)
        self.assertEqual(r.reported_position, 20000)
        # Discrepancy is 10000 - 20000 = -10000 lots (-50.0%)
        self.assertEqual(r.difference, -10000)
        self.assertAlmostEqual(r.difference_percentage, -50.0, places=1)
        self.assertIn("Discrepancy", r.notes)

    def test_11_multiple_brokers(self):
        """Case 11: Multiple brokers are tracked concurrently with completely isolated positions."""
        txs = [
            BrokerTransaction(date="2026-01-01", broker_code="XL", buy_lot=1000, buy_average_price=200, sell_lot=0),
            BrokerTransaction(date="2026-01-01", broker_code="MG", buy_lot=500, buy_average_price=210, sell_lot=0),
            BrokerTransaction(date="2026-01-02", broker_code="XL", buy_lot=0, sell_lot=400, sell_average_price=220),
            BrokerTransaction(date="2026-01-02", broker_code="MG", buy_lot=300, buy_average_price=215, sell_lot=0),
        ]
        history = generate_position_history(txs)
        day2_xl = [h for h in history if h.date == "2026-01-02" and h.broker == "XL"][0]
        day2_mg = [h for h in history if h.date == "2026-01-02" and h.broker == "MG"][0]

        # XL: bought 1000 @ 200, sold 400 -> remaining 600 @ 200
        self.assertEqual(day2_xl.estimated_position, 600)
        self.assertEqual(day2_xl.estimated_average_cost, 200)

        # MG: bought 500 @ 210, then 300 @ 215 -> (500*210 + 300*215)/800 = 211.875
        self.assertEqual(day2_mg.estimated_position, 800)
        self.assertAlmostEqual(day2_mg.estimated_average_cost, 211.88, places=2)

    def test_12_multiple_stocks(self):
        """Case 12: Multiple stocks are partitioned cleanly across brokers."""
        txs = [
            BrokerTransaction(date="2026-01-01", symbol="BBCA", broker_code="XL", buy_lot=1000, buy_average_price=9000, sell_lot=0),
            BrokerTransaction(date="2026-01-01", symbol="BUMI", broker_code="XL", buy_lot=50000, buy_average_price=200, sell_lot=0),
            BrokerTransaction(date="2026-01-02", symbol="BBCA", broker_code="XL", buy_lot=0, sell_lot=300, sell_average_price=9200),
            BrokerTransaction(date="2026-01-02", symbol="BUMI", broker_code="XL", buy_lot=0, sell_lot=10000, sell_average_price=210),
        ]
        history = generate_position_history(txs)
        day2_bbca = [h for h in history if h.date == "2026-01-02" and h.symbol == "BBCA" and h.broker == "XL"][0]
        day2_bumi = [h for h in history if h.date == "2026-01-02" and h.symbol == "BUMI" and h.broker == "XL"][0]

        self.assertEqual(day2_bbca.estimated_position, 700)
        self.assertEqual(day2_bbca.estimated_average_cost, 9000)

        self.assertEqual(day2_bumi.estimated_position, 40000)
        self.assertEqual(day2_bumi.estimated_average_cost, 200)

    def test_13_importer_subfolder_and_flat_support(self):
        """Case 13: Importer parses both dedicated subfolder and legacy flat folder structures."""
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            # Create subfolder structure: base / TEST / TEST_2026-01-01_2026-01-01.csv
            sub = base / "TEST"
            sub.mkdir(parents=True, exist_ok=True)

            csv_content = (
                "side,rank,symbol,broker_code,type,lot,shares,value,avg_price,freq,from_date,to_date\n"
                "BUY,1,TEST,PD,Lokal,500,50000,50000000,1000,10,2026-01-01,2026-01-01\n"
                "SELL,1,TEST,PD,Lokal,100,10000,10500000,1050,5,2026-01-01,2026-01-01\n"
            )
            detail_file = sub / "TEST_2026-01-01_2026-01-01.csv"
            detail_file.write_text(csv_content, encoding="utf-8")

            # Also create summary time series file (should be ignored by ladder importer)
            summary_file = sub / "TEST.csv"
            summary_file.write_text("date,symbol,broker_accdist\n2026-01-01,TEST,Accumulation\n", encoding="utf-8")

            # 1. Parse pointing to root dir with symbol="TEST"
            txs_from_root = parse_broker_summary(base, symbol="TEST")
            self.assertEqual(len(txs_from_root), 1)
            self.assertEqual(txs_from_root[0].broker_code, "PD")
            self.assertEqual(txs_from_root[0].buy_lot, 500)
            self.assertEqual(txs_from_root[0].sell_lot, 100)

            # 2. Parse pointing directly to subfolder
            txs_from_sub = parse_broker_summary(sub, symbol="TEST")
            self.assertEqual(len(txs_from_sub), 1)
            self.assertEqual(txs_from_sub[0].buy_lot, 500)

            # 3. Test legacy flat structure
            flat_file = base / "FLAT_2026-01-01_2026-01-01.csv"
            flat_file.write_text(
                "side,rank,symbol,broker_code,type,lot,shares,value,avg_price,freq,from_date,to_date\n"
                "BUY,1,FLAT,CC,Lokal,300,30000,30000000,1000,10,2026-01-01,2026-01-01\n",
                encoding="utf-8",
            )
            txs_flat = parse_broker_summary(base, symbol="FLAT")
            self.assertEqual(len(txs_flat), 1)
            self.assertEqual(txs_flat[0].broker_code, "CC")
            self.assertEqual(txs_flat[0].buy_lot, 300)


if __name__ == "__main__":
    unittest.main()
