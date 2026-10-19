# indie:lang_version = 5
# Automated Market Structure (SMC) Engine for Exness Web Terminal & TakeProfit
# Ported directly from lightweight-charts-master (market-structure-primitive.ts, Phases 191 & 192)
# Features: BOS & CHoCH Structure Breaks, Liquidity Sweeps, High-Probability Order Blocks in Discount/Premium,
# Fair Value Gaps (FVG) with 50% Consequent Encroachment (CE), Scoped Dealing Range Equilibrium (50% EQ),
# Actionable Strong Low (SL invalidation) and Weak High (TP target) Badges, Multi-Instrument Pip Scaling

from math import isnan
from indie import indicator, param, color, line_style, MainContext, Optional, Var
from indie.drawings import LineSegment, Rectangle, LabelAbs, AbsolutePosition, callout_position

@indicator('Auto Market Structure (SMC)', overlay_main_pane=True)
@param.bool('show_bos_choch', default=True, title='Show BOS & CHoCH Break Lines')
@param.bool('show_sweeps', default=True, title='Show Liquidity Sweeps')
@param.bool('show_order_blocks', default=True, title='Show Order Blocks (Discount/Premium)')
@param.bool('show_fvg', default=True, title='Show Fair Value Gaps (50% CE)')
@param.bool('show_dealing_range', default=True, title='Show 50% Dealing Range Equilibrium')
@param.bool('show_trade_badges', default=True, title='Show Strong Low (SL) & Weak High (TP)')
@param.int('lookback', default=4, min=2, max=10, title='Fractal Pivot Lookback (Bars)')
@param.int('max_lookback', default=400, min=100, max=500, title='Analysis Lookback Window (Bars)')
class Main(MainContext):
    def __init__(self):
        # 1. Structure Break slots (12 lines + 12 floating labels for wide 400-bar view)
        self.brk_line1 = self.new_var(Optional[LineSegment]())
        self.brk_line2 = self.new_var(Optional[LineSegment]())
        self.brk_line3 = self.new_var(Optional[LineSegment]())
        self.brk_line4 = self.new_var(Optional[LineSegment]())
        self.brk_line5 = self.new_var(Optional[LineSegment]())
        self.brk_line6 = self.new_var(Optional[LineSegment]())
        self.brk_line7 = self.new_var(Optional[LineSegment]())
        self.brk_line8 = self.new_var(Optional[LineSegment]())
        self.brk_line9 = self.new_var(Optional[LineSegment]())
        self.brk_line10 = self.new_var(Optional[LineSegment]())
        self.brk_line11 = self.new_var(Optional[LineSegment]())
        self.brk_line12 = self.new_var(Optional[LineSegment]())

        self.brk_lbl1 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl2 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl3 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl4 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl5 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl6 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl7 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl8 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl9 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl10 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl11 = self.new_var(Optional[LabelAbs]())
        self.brk_lbl12 = self.new_var(Optional[LabelAbs]())

        # 2. High-Probability Order Block slots (up to 4 boxes + 4 badges)
        self.ob_box1 = self.new_var(Optional[Rectangle]())
        self.ob_box2 = self.new_var(Optional[Rectangle]())
        self.ob_box3 = self.new_var(Optional[Rectangle]())
        self.ob_box4 = self.new_var(Optional[Rectangle]())
        self.ob_lbl1 = self.new_var(Optional[LabelAbs]())
        self.ob_lbl2 = self.new_var(Optional[LabelAbs]())
        self.ob_lbl3 = self.new_var(Optional[LabelAbs]())
        self.ob_lbl4 = self.new_var(Optional[LabelAbs]())

        # 3. Fair Value Gap (FVG) slots (up to 4 boxes with 50% CE midline + 4 badges)
        self.fvg_box1 = self.new_var(Optional[Rectangle]())
        self.fvg_box2 = self.new_var(Optional[Rectangle]())
        self.fvg_box3 = self.new_var(Optional[Rectangle]())
        self.fvg_box4 = self.new_var(Optional[Rectangle]())
        self.fvg_lbl1 = self.new_var(Optional[LabelAbs]())
        self.fvg_lbl2 = self.new_var(Optional[LabelAbs]())
        self.fvg_lbl3 = self.new_var(Optional[LabelAbs]())
        self.fvg_lbl4 = self.new_var(Optional[LabelAbs]())

        # 4. Scoped Dealing Range 50% Equilibrium (1 line + 1 label)
        self.eq_line = self.new_var(Optional[LineSegment]())
        self.eq_lbl = self.new_var(Optional[LabelAbs]())

        # 5. Actionable Trade Management Badges
        self.strong_low_lbl = self.new_var(Optional[LabelAbs]())
        self.weak_high_lbl = self.new_var(Optional[LabelAbs]())

    def calc(self, show_bos_choch: bool, show_sweeps: bool, show_order_blocks: bool,
             show_fvg: bool, show_dealing_range: bool, show_trade_badges: bool,
             lookback: int, max_lookback: int):
        # 1. Expand series ring buffer capacity on EVERY bar for Chromebook safety
        req_size = 450
        self.high.request_size(req_size)
        self.low.request_size(req_size)
        self.open.request_size(req_size)
        self.close.request_size(req_size)
        self.time.request_size(req_size)

        avail_bars = self.bar_index + 1
        if avail_bars < 30:
            return

        # 2. Only calculate and draw on the latest bar to conserve CPU/RAM on Chromebook
        if not self.is_last_bar:
            return

        # 3. Clean up previously drawn items (Erase-First pattern for rollback safety)
        if self.brk_line1.get() is not None:
            self.chart.erase(self.brk_line1.get().value())
            self.brk_line1.set(None)
        if self.brk_line2.get() is not None:
            self.chart.erase(self.brk_line2.get().value())
            self.brk_line2.set(None)
        if self.brk_line3.get() is not None:
            self.chart.erase(self.brk_line3.get().value())
            self.brk_line3.set(None)
        if self.brk_line4.get() is not None:
            self.chart.erase(self.brk_line4.get().value())
            self.brk_line4.set(None)
        if self.brk_line5.get() is not None:
            self.chart.erase(self.brk_line5.get().value())
            self.brk_line5.set(None)
        if self.brk_line6.get() is not None:
            self.chart.erase(self.brk_line6.get().value())
            self.brk_line6.set(None)
        if self.brk_line7.get() is not None:
            self.chart.erase(self.brk_line7.get().value())
            self.brk_line7.set(None)
        if self.brk_line8.get() is not None:
            self.chart.erase(self.brk_line8.get().value())
            self.brk_line8.set(None)
        if self.brk_line9.get() is not None:
            self.chart.erase(self.brk_line9.get().value())
            self.brk_line9.set(None)
        if self.brk_line10.get() is not None:
            self.chart.erase(self.brk_line10.get().value())
            self.brk_line10.set(None)
        if self.brk_line11.get() is not None:
            self.chart.erase(self.brk_line11.get().value())
            self.brk_line11.set(None)
        if self.brk_line12.get() is not None:
            self.chart.erase(self.brk_line12.get().value())
            self.brk_line12.set(None)

        if self.brk_lbl1.get() is not None:
            self.chart.erase(self.brk_lbl1.get().value())
            self.brk_lbl1.set(None)
        if self.brk_lbl2.get() is not None:
            self.chart.erase(self.brk_lbl2.get().value())
            self.brk_lbl2.set(None)
        if self.brk_lbl3.get() is not None:
            self.chart.erase(self.brk_lbl3.get().value())
            self.brk_lbl3.set(None)
        if self.brk_lbl4.get() is not None:
            self.chart.erase(self.brk_lbl4.get().value())
            self.brk_lbl4.set(None)
        if self.brk_lbl5.get() is not None:
            self.chart.erase(self.brk_lbl5.get().value())
            self.brk_lbl5.set(None)
        if self.brk_lbl6.get() is not None:
            self.chart.erase(self.brk_lbl6.get().value())
            self.brk_lbl6.set(None)
        if self.brk_lbl7.get() is not None:
            self.chart.erase(self.brk_lbl7.get().value())
            self.brk_lbl7.set(None)
        if self.brk_lbl8.get() is not None:
            self.chart.erase(self.brk_lbl8.get().value())
            self.brk_lbl8.set(None)
        if self.brk_lbl9.get() is not None:
            self.chart.erase(self.brk_lbl9.get().value())
            self.brk_lbl9.set(None)
        if self.brk_lbl10.get() is not None:
            self.chart.erase(self.brk_lbl10.get().value())
            self.brk_lbl10.set(None)
        if self.brk_lbl11.get() is not None:
            self.chart.erase(self.brk_lbl11.get().value())
            self.brk_lbl11.set(None)
        if self.brk_lbl12.get() is not None:
            self.chart.erase(self.brk_lbl12.get().value())
            self.brk_lbl12.set(None)

        if self.ob_box1.get() is not None:
            self.chart.erase(self.ob_box1.get().value())
            self.ob_box1.set(None)
        if self.ob_box2.get() is not None:
            self.chart.erase(self.ob_box2.get().value())
            self.ob_box2.set(None)
        if self.ob_box3.get() is not None:
            self.chart.erase(self.ob_box3.get().value())
            self.ob_box3.set(None)
        if self.ob_box4.get() is not None:
            self.chart.erase(self.ob_box4.get().value())
            self.ob_box4.set(None)

        if self.ob_lbl1.get() is not None:
            self.chart.erase(self.ob_lbl1.get().value())
            self.ob_lbl1.set(None)
        if self.ob_lbl2.get() is not None:
            self.chart.erase(self.ob_lbl2.get().value())
            self.ob_lbl2.set(None)
        if self.ob_lbl3.get() is not None:
            self.chart.erase(self.ob_lbl3.get().value())
            self.ob_lbl3.set(None)
        if self.ob_lbl4.get() is not None:
            self.chart.erase(self.ob_lbl4.get().value())
            self.ob_lbl4.set(None)

        if self.fvg_box1.get() is not None:
            self.chart.erase(self.fvg_box1.get().value())
            self.fvg_box1.set(None)
        if self.fvg_box2.get() is not None:
            self.chart.erase(self.fvg_box2.get().value())
            self.fvg_box2.set(None)
        if self.fvg_box3.get() is not None:
            self.chart.erase(self.fvg_box3.get().value())
            self.fvg_box3.set(None)
        if self.fvg_box4.get() is not None:
            self.chart.erase(self.fvg_box4.get().value())
            self.fvg_box4.set(None)

        if self.fvg_lbl1.get() is not None:
            self.chart.erase(self.fvg_lbl1.get().value())
            self.fvg_lbl1.set(None)
        if self.fvg_lbl2.get() is not None:
            self.chart.erase(self.fvg_lbl2.get().value())
            self.fvg_lbl2.set(None)
        if self.fvg_lbl3.get() is not None:
            self.chart.erase(self.fvg_lbl3.get().value())
            self.fvg_lbl3.set(None)
        if self.fvg_lbl4.get() is not None:
            self.chart.erase(self.fvg_lbl4.get().value())
            self.fvg_lbl4.set(None)

        if self.eq_line.get() is not None:
            self.chart.erase(self.eq_line.get().value())
            self.eq_line.set(None)
        if self.eq_lbl.get() is not None:
            self.chart.erase(self.eq_lbl.get().value())
            self.eq_lbl.set(None)

        if self.strong_low_lbl.get() is not None:
            self.chart.erase(self.strong_low_lbl.get().value())
            self.strong_low_lbl.set(None)
        if self.weak_high_lbl.get() is not None:
            self.chart.erase(self.weak_high_lbl.get().value())
            self.weak_high_lbl.set(None)

        # 4. Dynamic Instrument Pip Scale & Tolerances
        curr_price = self.close[0]
        time_step = self.time[0] - self.time[1]

        base_pip: float = 0.0001
        touch_tol: float = 0.00012

        if curr_price > 50000.0:  # BTC/USD
            base_pip = 10.0
            touch_tol = 15.0
        elif curr_price > 1000.0:  # Gold XAU/USD
            base_pip = 1.0
            touch_tol = 0.50
        elif curr_price > 20.0:  # JPY pairs / Silver / IDX Equities
            base_pip = 0.01
            touch_tol = 0.012
        else:  # Standard Forex (EUR, GBP, AUD)
            base_pip = 0.0001
            touch_tol = 0.00012

        # 5. Extract Chronological Historical Arrays (matching 400-bar window)
        max_bars = max_lookback
        if avail_bars < max_bars:
            max_bars = avail_bars

        times: list[float] = []
        highs: list[float] = []
        lows: list[float] = []
        opens: list[float] = []
        closes: list[float] = []

        for k in range(max_bars - 1, -1, -1):
            times.append(self.time[k])
            highs.append(self.high[k])
            lows.append(self.low[k])
            opens.append(self.open[k])
            closes.append(self.close[k])

        n_bars = len(closes)
        if n_bars < 25:
            return

        # ATR-14 Volatility for FVG minimum gap threshold (matching Float32Array in TS)
        tr_sum: float = 0.0
        atrs: list[float] = []
        for i_atr in range(n_bars):
            cur_h = highs[i_atr]
            cur_l = lows[i_atr]
            cur_c = closes[i_atr]
            prev_c = closes[i_atr - 1] if i_atr > 0 else cur_c
            tr = max(cur_h - cur_l, abs(cur_h - prev_c), abs(cur_l - prev_c))
            if i_atr < 14:
                tr_sum += tr
                atrs.append(tr_sum / float(i_atr + 1))
            else:
                prev_atr = atrs[i_atr - 1]
                atrs.append((prev_atr * 13.0 + tr) / 14.0)

        # 6. Fractal Pivot Detection with Flat Candle Suppression (Strict matching with JS)
        cand_sw_idx: list[int] = []
        cand_sw_price: list[float] = []
        cand_sw_time: list[float] = []
        cand_sw_type: list[int] = []  # 1 for High, -1 for Low

        for i in range(lookback, n_bars - lookback):
            h_i = highs[i]
            l_i = lows[i]

            # Suppress dormant flat candles (cur.high == cur.low)
            if h_i == l_i:
                continue

            is_h = True
            is_l = True
            for j in range(1, lookback + 1):
                if highs[i - j] > h_i or highs[i + j] > h_i:
                    is_h = False
                if lows[i - j] < l_i or lows[i + j] < l_i:
                    is_l = False
                if not is_h and not is_l:
                    break

            if is_h:
                cand_sw_idx.append(i)
                cand_sw_price.append(h_i)
                cand_sw_time.append(times[i])
                cand_sw_type.append(1)

            if is_l:
                cand_sw_idx.append(i)
                cand_sw_price.append(l_i)
                cand_sw_time.append(times[i])
                cand_sw_type.append(-1)

        # 7. Strictly Alternating Zigzag
        alt_idx: list[int] = []
        alt_price: list[float] = []
        alt_time: list[float] = []
        alt_type: list[int] = []

        n_cands = len(cand_sw_idx)
        for c_i in range(n_cands):
            c_idx = cand_sw_idx[c_i]
            c_p = cand_sw_price[c_i]
            c_t = cand_sw_time[c_i]
            c_typ = cand_sw_type[c_i]

            if len(alt_idx) == 0:
                alt_idx.append(c_idx)
                alt_price.append(c_p)
                alt_time.append(c_t)
                alt_type.append(c_typ)
            else:
                last_typ = alt_type[-1]
                if last_typ == c_typ:
                    if c_typ == 1 and c_p > alt_price[-1]:
                        alt_idx[-1] = c_idx
                        alt_price[-1] = c_p
                        alt_time[-1] = c_t
                    elif c_typ == -1 and c_p < alt_price[-1]:
                        alt_idx[-1] = c_idx
                        alt_price[-1] = c_p
                        alt_time[-1] = c_t
                else:
                    alt_idx.append(c_idx)
                    alt_price.append(c_p)
                    alt_time.append(c_t)
                    alt_type.append(c_typ)

        # 8. Dynamic Uncrossed Swing Stack State Machine & Structure Breaks
        trend = 1  # 1 for Bullish, -1 for Bearish
        uncrossed_h_idx: list[int] = []
        uncrossed_h_price: list[float] = []
        uncrossed_h_time: list[float] = []

        uncrossed_l_idx: list[int] = []
        uncrossed_l_price: list[float] = []
        uncrossed_l_time: list[float] = []

        # Break storage
        brk_types: list[str] = []
        brk_dirs: list[int] = []  # 1 Bullish, -1 Bearish
        brk_prices: list[float] = []
        brk_start_times: list[float] = []
        brk_end_times: list[float] = []
        brk_is_sweeps: list[bool] = []

        # Order block storage
        ob_dirs: list[int] = []
        ob_tops: list[float] = []
        ob_bots: list[float] = []
        ob_start_times: list[float] = []
        ob_end_times: list[float] = []
        ob_is_mits: list[bool] = []

        # Trade pivots tracking
        strong_low_p: float = 0.0
        strong_low_t: float = 0.0
        weak_high_p: float = 0.0
        weak_high_t: float = 0.0

        dr_low: float = 0.0
        dr_high: float = 0.0
        dr_start_t: float = 0.0

        n_alt = len(alt_idx)

        for bar_i in range(n_bars):
            # Check newly confirmed swing at bar_i (bar_i == alt_idx[k] + lookback)
            for k_a in range(n_alt):
                if alt_idx[k_a] + lookback == bar_i:
                    if alt_type[k_a] == 1:
                        uncrossed_h_idx.append(alt_idx[k_a])
                        uncrossed_h_price.append(alt_price[k_a])
                        uncrossed_h_time.append(alt_time[k_a])
                    else:
                        uncrossed_l_idx.append(alt_idx[k_a])
                        uncrossed_l_price.append(alt_price[k_a])
                        uncrossed_l_time.append(alt_time[k_a])

            c_close = closes[bar_i]
            c_high = highs[bar_i]
            c_low = lows[bar_i]
            c_time = times[bar_i]

            # Bullish Break Check
            if len(uncrossed_h_price) > 0:
                rh_idx = uncrossed_h_idx[-1]
                rh_p = uncrossed_h_price[-1]
                rh_t = uncrossed_h_time[-1]

                if bar_i > rh_idx:
                    if c_close > rh_p:
                        b_type = '+BOS' if trend == 1 else '+CHoCH'
                        brk_types.append(b_type)
                        brk_dirs.append(1)
                        brk_prices.append(rh_p)
                        brk_start_times.append(rh_t)
                        brk_end_times.append(c_time)
                        brk_is_sweeps.append(False)

                        uncrossed_h_idx.pop()
                        uncrossed_h_price.pop()
                        uncrossed_h_time.pop()

                        # Strong Low discovery: lowest point in pullback wave
                        min_pb_l = c_low
                        min_pb_t = c_time
                        for k_pb in range(rh_idx, bar_i + 1):
                            if lows[k_pb] < min_pb_l:
                                min_pb_l = lows[k_pb]
                                min_pb_t = times[k_pb]

                        strong_low_p = min_pb_l
                        strong_low_t = min_pb_t
                        weak_high_p = rh_p
                        weak_high_t = rh_t

                        dr_low = min_pb_l
                        dr_high = c_high
                        dr_start_t = min_pb_t
                        eq_p = (dr_low + dr_high) / 2.0

                        # Bullish Demand Order Block in Discount Zone (< 50% EQ)
                        for k_ob in range(bar_i - 1, rh_idx, -1):
                            if closes[k_ob] < opens[k_ob]:  # Bearish candle
                                ob_top = highs[k_ob]
                                ob_bot = lows[k_ob]
                                if ob_top < eq_p:  # Discount Zone filter
                                    # Check subsequent touch mitigation
                                    is_mit = False
                                    mit_t = times[-1]
                                    for m_ob in range(k_ob + 1, n_bars):
                                        if lows[m_ob] <= ob_top:
                                            is_mit = True
                                            mit_t = times[m_ob]
                                            break
                                    ob_dirs.append(1)
                                    ob_tops.append(ob_top)
                                    ob_bots.append(ob_bot)
                                    ob_start_times.append(times[k_ob])
                                    ob_end_times.append(mit_t if is_mit else times[-1] + time_step * 6.0)
                                    ob_is_mits.append(is_mit)
                                    break

                        trend = 1
                    elif c_high > rh_p and c_close <= rh_p and show_sweeps:
                        # Sweep of liquidity (deduplicated per anchor)
                        if c_high - rh_p >= touch_tol:
                            already_swept = False
                            for s_k in range(len(brk_prices)):
                                if brk_start_times[s_k] == rh_t and brk_is_sweeps[s_k]:
                                    already_swept = True
                                    break
                            if not already_swept:
                                brk_types.append('SWEEP')
                                brk_dirs.append(1)
                                brk_prices.append(rh_p)
                                brk_start_times.append(rh_t)
                                brk_end_times.append(c_time)
                                brk_is_sweeps.append(True)

            # Bearish Break Check
            if len(uncrossed_l_price) > 0:
                rl_idx = uncrossed_l_idx[-1]
                rl_p = uncrossed_l_price[-1]
                rl_t = uncrossed_l_time[-1]

                if bar_i > rl_idx:
                    if c_close < rl_p:
                        b_type = '-BOS' if trend == -1 else '-CHoCH'
                        brk_types.append(b_type)
                        brk_dirs.append(-1)
                        brk_prices.append(rl_p)
                        brk_start_times.append(rl_t)
                        brk_end_times.append(c_time)
                        brk_is_sweeps.append(False)

                        uncrossed_l_idx.pop()
                        uncrossed_l_price.pop()
                        uncrossed_l_time.pop()

                        # Strong High discovery
                        max_pb_h = c_high
                        for k_pb in range(rl_idx, bar_i + 1):
                            if highs[k_pb] > max_pb_h:
                                max_pb_h = highs[k_pb]

                        dr_low = c_low
                        dr_high = max_pb_h
                        dr_start_t = times[rl_idx]
                        eq_p = (dr_low + dr_high) / 2.0

                        # Bearish Supply Order Block in Premium Zone (> 50% EQ)
                        for k_ob in range(bar_i - 1, rl_idx, -1):
                            if closes[k_ob] > opens[k_ob]:  # Bullish candle
                                ob_top = highs[k_ob]
                                ob_bot = lows[k_ob]
                                if ob_bot > eq_p:  # Premium Zone filter
                                    is_mit = False
                                    mit_t = times[-1]
                                    for m_ob in range(k_ob + 1, n_bars):
                                        if highs[m_ob] >= ob_bot:
                                            is_mit = True
                                            mit_t = times[m_ob]
                                            break
                                    ob_dirs.append(-1)
                                    ob_tops.append(ob_top)
                                    ob_bots.append(ob_bot)
                                    ob_start_times.append(times[k_ob])
                                    ob_end_times.append(mit_t if is_mit else times[-1] + time_step * 6.0)
                                    ob_is_mits.append(is_mit)
                                    break

                        trend = -1
                    elif c_low < rl_p and c_close >= rl_p and show_sweeps:
                        if rl_p - c_low >= touch_tol:
                            already_swept = False
                            for s_k in range(len(brk_prices)):
                                if brk_start_times[s_k] == rl_t and brk_is_sweeps[s_k]:
                                    already_swept = True
                                    break
                            if not already_swept:
                                brk_types.append('SWEEP')
                                brk_dirs.append(-1)
                                brk_prices.append(rl_p)
                                brk_start_times.append(rl_t)
                                brk_end_times.append(c_time)
                                brk_is_sweeps.append(True)

        # 9. Fair Value Gap (3-bar) Detection with Touch Penetration Mitigation
        fvg_dirs: list[int] = []
        fvg_tops: list[float] = []
        fvg_bots: list[float] = []
        fvg_mids: list[float] = []
        fvg_start_times: list[float] = []
        fvg_end_times: list[float] = []
        fvg_is_mits: list[bool] = []

        for i_fvg in range(2, n_bars):
            min_fvg_gap = max(atrs[i_fvg] * 0.25, base_pip * 0.5)
            # Bullish FVG
            if lows[i_fvg] - highs[i_fvg - 2] >= min_fvg_gap:
                f_top = lows[i_fvg]
                f_bot = highs[i_fvg - 2]
                f_mid = (f_top + f_bot) / 2.0
                is_f_mit = False
                mit_f_t = times[-1]
                for m_f in range(i_fvg + 1, n_bars):
                    if lows[m_f] <= (f_top - touch_tol):
                        is_f_mit = True
                        mit_f_t = times[m_f]
                        break
                fvg_dirs.append(1)
                fvg_tops.append(f_top)
                fvg_bots.append(f_bot)
                fvg_mids.append(f_mid)
                fvg_start_times.append(times[i_fvg - 1])
                fvg_end_times.append(mit_f_t if is_f_mit else times[-1] + time_step * 6.0)
                fvg_is_mits.append(is_f_mit)

            # Bearish FVG
            if lows[i_fvg - 2] - highs[i_fvg] >= min_fvg_gap:
                f_top = lows[i_fvg - 2]
                f_bot = highs[i_fvg]
                f_mid = (f_top + f_bot) / 2.0
                is_f_mit = False
                mit_f_t = times[-1]
                for m_f in range(i_fvg + 1, n_bars):
                    if highs[m_f] >= (f_bot + touch_tol):
                        is_f_mit = True
                        mit_f_t = times[m_f]
                        break
                fvg_dirs.append(-1)
                fvg_tops.append(f_top)
                fvg_bots.append(f_bot)
                fvg_mids.append(f_mid)
                fvg_start_times.append(times[i_fvg - 1])
                fvg_end_times.append(mit_f_t if is_f_mit else times[-1] + time_step * 6.0)
                fvg_is_mits.append(is_f_mit)

        # ---------------------------------------------------------------------
        # ---------------------------------------------------------------------
        # 10. RENDER DRAWINGS: Structure Breaks (Up to 12 slots for wide view)
        # Palette: Mint Green (#26A69A), Salmon Red (#EF5350), Gold (#FFB300)
        # ---------------------------------------------------------------------
        c_mint = color.rgba(38, 166, 154, 1.0)
        c_salmon = color.rgba(239, 83, 80, 1.0)
        c_gold = color.rgba(255, 179, 0, 1.0)
        c_trans = color.rgba(0, 0, 0, 0.01)

        if show_bos_choch and len(brk_prices) > 0:
            n_brks = len(brk_prices)
            start_brk = max(0, n_brks - 12)
            slot_brk = 0

            for b_i in range(start_brk, n_brks):
                b_p = brk_prices[b_i]
                b_t1 = brk_start_times[b_i]
                b_t2 = brk_end_times[b_i]
                b_dir = brk_dirs[b_i]
                b_txt = brk_types[b_i]
                b_is_swp = brk_is_sweeps[b_i]

                # Pre-declare l_col and l_style in loop scope before any if/elif
                l_col = c_mint
                l_style = line_style.DASHED

                if b_is_swp:
                    l_col = c_gold
                    l_style = line_style.DOTTED
                elif b_txt == '+CHoCH':
                    l_col = c_mint
                    l_style = line_style.SOLID
                elif b_txt == '-CHoCH':
                    l_col = c_salmon
                    l_style = line_style.SOLID
                elif b_dir == 1:
                    l_col = c_mint
                    l_style = line_style.DASHED
                else:
                    l_col = c_salmon
                    l_style = line_style.DASHED

                pos_s = AbsolutePosition(b_t1, b_p)
                pos_e = AbsolutePosition(b_t2, b_p)
                line_obj = LineSegment(pos_s, pos_e, color=l_col, line_style=l_style, line_width=1)

                mid_t = (b_t1 + b_t2) / 2.0
                pos_mid = AbsolutePosition(mid_t, b_p)
                lbl_obj = LabelAbs(
                    b_txt,
                    pos_mid,
                    font_size=10,
                    text_color=l_col,
                    bg_color=c_trans,
                    callout_position=callout_position.TOP_LEFT
                )

                if slot_brk == 0:
                    self.brk_line1.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl1.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 1:
                    self.brk_line2.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl2.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 2:
                    self.brk_line3.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl3.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 3:
                    self.brk_line4.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl4.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 4:
                    self.brk_line5.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl5.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 5:
                    self.brk_line6.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl6.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 6:
                    self.brk_line7.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl7.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 7:
                    self.brk_line8.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl8.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 8:
                    self.brk_line9.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl9.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 9:
                    self.brk_line10.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl10.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 10:
                    self.brk_line11.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl11.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_brk == 11:
                    self.brk_line12.set(line_obj)
                    self.chart.draw(line_obj)
                    self.brk_lbl12.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                slot_brk += 1

        # ---------------------------------------------------------------------
        # 11. RENDER DRAWINGS: High-Probability Order Blocks (Up to 4 boxes)
        # Palette: Mint Green (#26A69A), Salmon Red (#EF5350)
        # ---------------------------------------------------------------------
        if show_order_blocks and len(ob_tops) > 0:
            # Prioritize active unmitigated first, then recent
            n_obs = len(ob_tops)
            ob_draw_indices: list[int] = []
            for ob_k in range(n_obs - 1, -1, -1):
                if not ob_is_mits[ob_k]:
                    ob_draw_indices.append(ob_k)
                    if len(ob_draw_indices) == 4:
                        break
            if len(ob_draw_indices) < 4:
                for ob_k in range(n_obs - 1, -1, -1):
                    if ob_k not in ob_draw_indices:
                        ob_draw_indices.append(ob_k)
                        if len(ob_draw_indices) == 4:
                            break

            for slot_ob in range(len(ob_draw_indices)):
                o_idx = ob_draw_indices[slot_ob]
                o_dir = ob_dirs[o_idx]
                o_top = ob_tops[o_idx]
                o_bot = ob_bots[o_idx]
                o_t1 = ob_start_times[o_idx]
                o_t2 = ob_end_times[o_idx]
                o_mit = ob_is_mits[o_idx]

                # Pre-declare ob_c, bg_c in loop scope before any if/else
                is_b = (o_dir == 1)
                ob_c = c_mint
                bg_c = color.rgba(38, 166, 154, 0.16)

                if is_b:
                    ob_c = c_mint
                    if o_mit:
                        bg_c = color.rgba(38, 166, 154, 0.06)
                    else:
                        bg_c = color.rgba(38, 166, 154, 0.16)
                else:
                    ob_c = c_salmon
                    if o_mit:
                        bg_c = color.rgba(239, 83, 80, 0.06)
                    else:
                        bg_c = color.rgba(239, 83, 80, 0.16)

                pos_s = AbsolutePosition(o_t1, o_top)
                pos_e = AbsolutePosition(o_t2, o_bot)

                box_obj = Rectangle(
                    pos_s,
                    pos_e,
                    line_style=line_style.DASHED if o_mit else line_style.SOLID,
                    line_width=1,
                    line_color=ob_c,
                    bg_color=bg_c
                )

                txt_tag = f"{'+OB' if is_b else '-OB'}{' [MIT]' if o_mit else ''}"
                lbl_obj = LabelAbs(
                    txt_tag,
                    pos_s,
                    font_size=9,
                    text_color=ob_c,
                    bg_color=c_trans,
                    callout_position=callout_position.BOTTOM_RIGHT
                )

                if slot_ob == 0:
                    self.ob_box1.set(box_obj)
                    self.chart.draw(box_obj)
                    self.ob_lbl1.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_ob == 1:
                    self.ob_box2.set(box_obj)
                    self.chart.draw(box_obj)
                    self.ob_lbl2.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_ob == 2:
                    self.ob_box3.set(box_obj)
                    self.chart.draw(box_obj)
                    self.ob_lbl3.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_ob == 3:
                    self.ob_box4.set(box_obj)
                    self.chart.draw(box_obj)
                    self.ob_lbl4.set(lbl_obj)
                    self.chart.draw(lbl_obj)

        # ---------------------------------------------------------------------
        # 12. RENDER DRAWINGS: Fair Value Gaps (Up to 4 boxes with 50% CE midline)
        # Palette: Mint Green (#26A69A), Salmon Red (#EF5350)
        # ---------------------------------------------------------------------
        if show_fvg and len(fvg_tops) > 0:
            n_fvgs = len(fvg_tops)
            fvg_draw_indices: list[int] = []
            for f_k in range(n_fvgs - 1, -1, -1):
                if not fvg_is_mits[f_k]:
                    fvg_draw_indices.append(f_k)
                    if len(fvg_draw_indices) == 4:
                        break
            if len(fvg_draw_indices) < 4:
                for f_k in range(n_fvgs - 1, -1, -1):
                    if f_k not in fvg_draw_indices:
                        fvg_draw_indices.append(f_k)
                        if len(fvg_draw_indices) == 4:
                            break

            for slot_fvg in range(len(fvg_draw_indices)):
                f_idx = fvg_draw_indices[slot_fvg]
                f_dir = fvg_dirs[f_idx]
                f_top = fvg_tops[f_idx]
                f_bot = fvg_bots[f_idx]
                f_t1 = fvg_start_times[f_idx]
                f_t2 = fvg_end_times[f_idx]
                f_mit = fvg_is_mits[f_idx]

                # Pre-declare f_stroke, f_bg, f_mid_c, f_text_c in loop scope before any if/else
                is_bf = (f_dir == 1)
                f_stroke = color.rgba(38, 166, 154, 0.50)
                f_bg = color.rgba(38, 166, 154, 0.12)
                f_mid_c = color.rgba(38, 166, 154, 0.70)
                f_text_c = c_mint

                if is_bf:
                    f_stroke = color.rgba(38, 166, 154, 0.50)
                    if f_mit:
                        f_bg = color.rgba(38, 166, 154, 0.04)
                    else:
                        f_bg = color.rgba(38, 166, 154, 0.12)
                    f_mid_c = color.rgba(38, 166, 154, 0.70)
                    f_text_c = c_mint
                else:
                    f_stroke = color.rgba(239, 83, 80, 0.50)
                    if f_mit:
                        f_bg = color.rgba(239, 83, 80, 0.04)
                    else:
                        f_bg = color.rgba(239, 83, 80, 0.12)
                    f_mid_c = color.rgba(239, 83, 80, 0.70)
                    f_text_c = c_salmon

                pos_fs = AbsolutePosition(f_t1, f_top)
                pos_fe = AbsolutePosition(f_t2, f_bot)

                # Rectangle natively supports middle line for 50% Consequent Encroachment (CE)
                fvg_box = Rectangle(
                    pos_fs,
                    pos_fe,
                    line_style=line_style.SOLID,
                    line_width=1,
                    line_color=f_stroke,
                    bg_color=f_bg,
                    middle_line_style=line_style.DOTTED,
                    middle_line_width=1,
                    middle_line_color=f_mid_c
                )

                txt_f = f"{'+FVG' if is_bf else '-FVG'}{' [MIT]' if f_mit else ''}"
                lbl_fvg = LabelAbs(
                    txt_f,
                    pos_fs,
                    font_size=9,
                    text_color=f_text_c,
                    bg_color=c_trans,
                    callout_position=callout_position.BOTTOM_RIGHT
                )

                if slot_fvg == 0:
                    self.fvg_box1.set(fvg_box)
                    self.chart.draw(fvg_box)
                    self.fvg_lbl1.set(lbl_fvg)
                    self.chart.draw(lbl_fvg)
                elif slot_fvg == 1:
                    self.fvg_box2.set(fvg_box)
                    self.chart.draw(fvg_box)
                    self.fvg_lbl2.set(lbl_fvg)
                    self.chart.draw(lbl_fvg)
                elif slot_fvg == 2:
                    self.fvg_box3.set(fvg_box)
                    self.chart.draw(fvg_box)
                    self.fvg_lbl3.set(lbl_fvg)
                    self.chart.draw(lbl_fvg)
                elif slot_fvg == 3:
                    self.fvg_box4.set(fvg_box)
                    self.chart.draw(fvg_box)
                    self.fvg_lbl4.set(lbl_fvg)
                    self.chart.draw(lbl_fvg)

        # ---------------------------------------------------------------------
        # 13. RENDER DRAWINGS: 50% Dealing Range Equilibrium (Gold #FFB300)
        # ---------------------------------------------------------------------
        if show_dealing_range and dr_high > dr_low:
            eq_val = (dr_high + dr_low) / 2.0
            pos_eq_s = AbsolutePosition(dr_start_t, eq_val)
            pos_eq_e = AbsolutePosition(times[-1] + time_step * 6.0, eq_val)

            eq_line_obj = LineSegment(
                pos_eq_s,
                pos_eq_e,
                color=color.rgba(255, 179, 0, 0.75),
                line_style=line_style.DOTTED,
                line_width=1
            )
            self.eq_line.set(eq_line_obj)
            self.chart.draw(eq_line_obj)

            eq_lbl_obj = LabelAbs(
                f"EQ 50% ({eq_val:.2f})",
                pos_eq_s,
                font_size=9,
                text_color=c_gold,
                bg_color=c_trans,
                callout_position=callout_position.TOP_LEFT
            )
            self.eq_lbl.set(eq_lbl_obj)
            self.chart.draw(eq_lbl_obj)

        # ---------------------------------------------------------------------
        # 14. RENDER DRAWINGS: Strong Low (SL) & Weak High (TP) Badges
        # ---------------------------------------------------------------------
        if show_trade_badges:
            if strong_low_p > 0.0 and strong_low_t > 0.0:
                pos_sl = AbsolutePosition(strong_low_t, strong_low_p)
                sl_lbl = LabelAbs(
                    f"STRONG LOW (SL: {strong_low_p:.2f})",
                    pos_sl,
                    font_size=10,
                    text_color=c_mint,
                    bg_color=c_trans,
                    callout_position=callout_position.BOTTOM_LEFT
                )
                self.strong_low_lbl.set(sl_lbl)
                self.chart.draw(sl_lbl)

            if weak_high_p > 0.0 and weak_high_t > 0.0:
                pos_tp = AbsolutePosition(weak_high_t, weak_high_p)
                tp_lbl = LabelAbs(
                    f"WEAK HIGH (TP: {weak_high_p:.2f})",
                    pos_tp,
                    font_size=10,
                    text_color=c_gold,
                    bg_color=c_trans,
                    callout_position=callout_position.TOP_LEFT
                )
                self.weak_high_lbl.set(tp_lbl)
                self.chart.draw(tp_lbl)
