# indie:lang_version = 5
# Auto Support & Resistance (Auto S/R) Engine for Exness Web Terminal
# Renders True Horizontal Price Levels & Supply/Demand Zones using Indie Drawings
# Ported directly from lightweight-charts-master (Dow Theory Pivots & Zone Clusterer)

from math import isnan
from indie import indicator, color, line_style, MainContext, Optional, Var
from indie.drawings import LineSegment, Rectangle, AbsolutePosition

@indicator('Auto Support & Resistance', overlay_main_pane=True)
class Main(MainContext):
    def __init__(self):
        # Persistent drawing slots for rollback safety and dynamic updates
        self.res_line1 = self.new_var(Optional[LineSegment]())
        self.res_line2 = self.new_var(Optional[LineSegment]())
        self.res_line3 = self.new_var(Optional[LineSegment]())

        self.sup_line1 = self.new_var(Optional[LineSegment]())
        self.sup_line2 = self.new_var(Optional[LineSegment]())
        self.sup_line3 = self.new_var(Optional[LineSegment]())

        self.supply_box1 = self.new_var(Optional[Rectangle]())
        self.supply_box2 = self.new_var(Optional[Rectangle]())

        self.demand_box1 = self.new_var(Optional[Rectangle]())
        self.demand_box2 = self.new_var(Optional[Rectangle]())

    def calc(self):
        # 1. Expand series ring buffer capacity on EVERY bar so Indie never limits series to small history
        req_size = 150
        self.high.request_size(req_size)
        self.low.request_size(req_size)
        self.close.request_size(req_size)
        self.time.request_size(req_size)

        avail_bars = self.bar_index + 1
        if avail_bars < 25:
            return

        # 2. Only calculate and draw on the latest bar to save memory and avoid redundant history draws
        if not self.is_last_bar:
            return

        # 3. Clean up previously drawn items (Erase-First pattern for rollback safety)
        if self.res_line1.get() is not None:
            self.chart.erase(self.res_line1.get().value())
            self.res_line1.set(None)
        if self.res_line2.get() is not None:
            self.chart.erase(self.res_line2.get().value())
            self.res_line2.set(None)
        if self.res_line3.get() is not None:
            self.chart.erase(self.res_line3.get().value())
            self.res_line3.set(None)

        if self.sup_line1.get() is not None:
            self.chart.erase(self.sup_line1.get().value())
            self.sup_line1.set(None)
        if self.sup_line2.get() is not None:
            self.chart.erase(self.sup_line2.get().value())
            self.sup_line2.set(None)
        if self.sup_line3.get() is not None:
            self.chart.erase(self.sup_line3.get().value())
            self.sup_line3.set(None)

        if self.supply_box1.get() is not None:
            self.chart.erase(self.supply_box1.get().value())
            self.supply_box1.set(None)
        if self.supply_box2.get() is not None:
            self.chart.erase(self.supply_box2.get().value())
            self.supply_box2.set(None)

        if self.demand_box1.get() is not None:
            self.chart.erase(self.demand_box1.get().value())
            self.demand_box1.set(None)
        if self.demand_box2.get() is not None:
            self.chart.erase(self.demand_box2.get().value())
            self.demand_box2.set(None)

        # 4. Context coordinates & Dynamic Instrument Scale
        curr_price = self.close[0]
        curr_time = self.time[0]
        time_step = self.time[0] - self.time[1]
        end_time = curr_time + time_step * 8

        # Explicitly declare and initialize variables before if-blocks (Indie block-level scoping)
        cluster_threshold: float = 0.0
        zone_half: float = 0.0
        touch_tol: float = 0.0

        if curr_price > 50000.0:
            cluster_threshold = 200.0
            zone_half = 100.0
            touch_tol = 30.0
        elif curr_price > 1000.0:
            cluster_threshold = 5.0
            zone_half = 2.0
            touch_tol = 0.5
        elif curr_price > 20.0:
            cluster_threshold = 0.05
            zone_half = 0.03
            touch_tol = 0.008
        else:
            cluster_threshold = 0.0005
            zone_half = 0.0003
            touch_tol = 0.00008

        lookback = 6
        # Strictly bound max_bars to available bars on chart to prevent ANY out-of-bounds error
        # Max index accessed by i + j is: (max_bars - lookback - 1) + lookback = max_bars - 1
        # Touch loop accesses: kr from 0 to max_bars - 1
        # So we ensure max_bars <= avail_bars - 2!
        max_bars = avail_bars - 2
        if max_bars > 100:
            max_bars = 100
        if max_bars <= lookback * 2:
            return

        # 5. Detect Dow Theory Pivot Highs & Pivot Lows (6-bar symmetric window)
        # Stored strictly as parallel lists of floats - ZERO tuples used
        swing_high_prices: list[float] = []
        swing_high_times: list[float] = []
        swing_low_prices: list[float] = []
        swing_low_times: list[float] = []

        for i in range(lookback, max_bars - lookback):
            cand_high = self.high[i]
            is_ph = True
            for j in range(1, lookback + 1):
                if self.high[i - j] >= cand_high:
                    is_ph = False
                    break
                if self.high[i + j] >= cand_high:
                    is_ph = False
                    break
            if is_ph:
                swing_high_prices.append(cand_high)
                swing_high_times.append(self.time[i])

            cand_low = self.low[i]
            is_pl = True
            for j in range(1, lookback + 1):
                if self.low[i - j] <= cand_low:
                    is_pl = False
                    break
                if self.low[i + j] <= cand_low:
                    is_pl = False
                    break
            if is_pl:
                swing_low_prices.append(cand_low)
                swing_low_times.append(self.time[i])

        # 6. Role Reversal: classify pivots relative to current price
        above_prices: list[float] = []
        above_times: list[float] = []

        for idx_h in range(len(swing_high_prices)):
            p_h = swing_high_prices[idx_h]
            if p_h > curr_price:
                above_prices.append(p_h)
                above_times.append(swing_high_times[idx_h])

        for idx_l in range(len(swing_low_prices)):
            p_l = swing_low_prices[idx_l]
            if p_l > curr_price:
                above_prices.append(p_l)
                above_times.append(swing_low_times[idx_l])

        below_prices: list[float] = []
        below_times: list[float] = []

        for idx_bl in range(len(swing_low_prices)):
            p_bl = swing_low_prices[idx_bl]
            if p_bl < curr_price:
                below_prices.append(p_bl)
                below_times.append(swing_low_times[idx_bl])

        for idx_bh in range(len(swing_high_prices)):
            p_bh = swing_high_prices[idx_bh]
            if p_bh < curr_price:
                below_prices.append(p_bh)
                below_times.append(swing_high_times[idx_bh])

        # 7. In-place sorting of parallel lists without external functions
        # Sort above by price ascending (closest to price first)
        n_above = len(above_prices)
        for i_a in range(n_above):
            min_idx = i_a
            for j_a in range(i_a + 1, n_above):
                if above_prices[j_a] < above_prices[min_idx]:
                    min_idx = j_a
            if min_idx != i_a:
                tp_a = above_prices[i_a]
                above_prices[i_a] = above_prices[min_idx]
                above_prices[min_idx] = tp_a

                tt_a = above_times[i_a]
                above_times[i_a] = above_times[min_idx]
                above_times[min_idx] = tt_a

        # Sort below by price descending (closest to price first)
        n_below = len(below_prices)
        for i_b in range(n_below):
            max_idx = i_b
            for j_b in range(i_b + 1, n_below):
                if below_prices[j_b] > below_prices[max_idx]:
                    max_idx = j_b
            if max_idx != i_b:
                tp_b = below_prices[i_b]
                below_prices[i_b] = below_prices[max_idx]
                below_prices[max_idx] = tp_b

                tt_b = below_times[i_b]
                below_times[i_b] = below_times[max_idx]
                below_times[max_idx] = tt_b

        # 8. Cluster pivots into Supply & Demand Zones
        used_above: list[int] = []
        sup_zone_count = 0

        for k_a in range(n_above):
            if k_a in used_above:
                continue
            cluster_indices_a: list[int] = [k_a]
            for m_a in range(k_a + 1, n_above):
                if abs(above_prices[m_a] - above_prices[k_a]) <= cluster_threshold:
                    cluster_indices_a.append(m_a)
                    used_above.append(m_a)
                else:
                    break

            if len(cluster_indices_a) >= 2:
                used_above.append(k_a)
                if sup_zone_count < 2:
                    sum_pa = 0.0
                    earliest_ta = above_times[cluster_indices_a[0]]
                    for ci_a in cluster_indices_a:
                        sum_pa += above_prices[ci_a]
                        if above_times[ci_a] < earliest_ta:
                            earliest_ta = above_times[ci_a]
                    center_a = sum_pa / float(len(cluster_indices_a))
                    top_pa = center_a + zone_half
                    bot_pa = center_a - zone_half
                    if bot_pa < curr_price + touch_tol:
                        bot_pa = curr_price + touch_tol

                    if sup_zone_count == 0:
                        obj_sb1 = Rectangle(
                            AbsolutePosition(earliest_ta, top_pa),
                            AbsolutePosition(end_time, bot_pa),
                            line_style=line_style.DOTTED,
                            line_width=1,
                            line_color=color.RED(0.55),
                            bg_color=color.RED(0.16),
                            middle_line_style=line_style.DOTTED,
                            middle_line_width=1,
                            middle_line_color=color.RED(0.30)
                        )
                        self.supply_box1.set(obj_sb1)
                        self.chart.draw(obj_sb1)
                    elif sup_zone_count == 1:
                        obj_sb2 = Rectangle(
                            AbsolutePosition(earliest_ta, top_pa),
                            AbsolutePosition(end_time, bot_pa),
                            line_style=line_style.DOTTED,
                            line_width=1,
                            line_color=color.RED(0.55),
                            bg_color=color.RED(0.16),
                            middle_line_style=line_style.DOTTED,
                            middle_line_width=1,
                            middle_line_color=color.RED(0.30)
                        )
                        self.supply_box2.set(obj_sb2)
                        self.chart.draw(obj_sb2)
                    sup_zone_count += 1

        used_below: list[int] = []
        dem_zone_count = 0

        for k_b in range(n_below):
            if k_b in used_below:
                continue
            cluster_indices_b: list[int] = [k_b]
            for m_b in range(k_b + 1, n_below):
                if abs(below_prices[m_b] - below_prices[k_b]) <= cluster_threshold:
                    cluster_indices_b.append(m_b)
                    used_below.append(m_b)
                else:
                    break

            if len(cluster_indices_b) >= 2:
                used_below.append(k_b)
                if dem_zone_count < 2:
                    sum_pb = 0.0
                    earliest_tb = below_times[cluster_indices_b[0]]
                    for ci_b in cluster_indices_b:
                        sum_pb += below_prices[ci_b]
                        if below_times[ci_b] < earliest_tb:
                            earliest_tb = below_times[ci_b]
                    center_b = sum_pb / float(len(cluster_indices_b))
                    top_pb = center_b + zone_half
                    if top_pb > curr_price - touch_tol:
                        top_pb = curr_price - touch_tol
                    bot_pb = center_b - zone_half

                    if dem_zone_count == 0:
                        obj_db1 = Rectangle(
                            AbsolutePosition(earliest_tb, top_pb),
                            AbsolutePosition(end_time, bot_pb),
                            line_style=line_style.DOTTED,
                            line_width=1,
                            line_color=color.GREEN(0.55),
                            bg_color=color.GREEN(0.16),
                            middle_line_style=line_style.DOTTED,
                            middle_line_width=1,
                            middle_line_color=color.GREEN(0.30)
                        )
                        self.demand_box1.set(obj_db1)
                        self.chart.draw(obj_db1)
                    elif dem_zone_count == 1:
                        obj_db2 = Rectangle(
                            AbsolutePosition(earliest_tb, top_pb),
                            AbsolutePosition(end_time, bot_pb),
                            line_style=line_style.DOTTED,
                            line_width=1,
                            line_color=color.GREEN(0.55),
                            bg_color=color.GREEN(0.16),
                            middle_line_style=line_style.DOTTED,
                            middle_line_width=1,
                            middle_line_color=color.GREEN(0.30)
                        )
                        self.demand_box2.set(obj_db2)
                        self.chart.draw(obj_db2)
                    dem_zone_count += 1

        # 9. Render Standalone Horizontal Lines (Max 3 each)
        # Resistance Lines:
        drawn_res_prices: list[float] = []
        res_count = 0
        for k_ra in range(n_above):
            if k_ra in used_above:
                continue
            p_val_r = above_prices[k_ra]
            p_time_r = above_times[k_ra]

            too_close_r = False
            for el_pr in drawn_res_prices:
                if abs(p_val_r - el_pr) < cluster_threshold:
                    too_close_r = True
                    break
            if too_close_r:
                continue

            touches_r = 0
            last_hit_r = -20
            for kr in range(0, max_bars):
                if abs(self.high[kr] - p_val_r) <= touch_tol:
                    if (kr - last_hit_r) >= 10:
                        touches_r += 1
                        last_hit_r = kr
            lw_r = 1
            ls_r = line_style.DOTTED
            if touches_r >= 2:
                lw_r = 2
                ls_r = line_style.SOLID

            if res_count == 0:
                obj_r1 = LineSegment(
                    AbsolutePosition(p_time_r, p_val_r),
                    AbsolutePosition(end_time, p_val_r),
                    color=color.RED,
                    line_style=ls_r,
                    line_width=lw_r
                )
                self.res_line1.set(obj_r1)
                self.chart.draw(obj_r1)
                drawn_res_prices.append(p_val_r)
                res_count += 1
            elif res_count == 1:
                obj_r2 = LineSegment(
                    AbsolutePosition(p_time_r, p_val_r),
                    AbsolutePosition(end_time, p_val_r),
                    color=color.RED,
                    line_style=ls_r,
                    line_width=lw_r
                )
                self.res_line2.set(obj_r2)
                self.chart.draw(obj_r2)
                drawn_res_prices.append(p_val_r)
                res_count += 1
            elif res_count == 2:
                obj_r3 = LineSegment(
                    AbsolutePosition(p_time_r, p_val_r),
                    AbsolutePosition(end_time, p_val_r),
                    color=color.RED,
                    line_style=ls_r,
                    line_width=lw_r
                )
                self.res_line3.set(obj_r3)
                self.chart.draw(obj_r3)
                drawn_res_prices.append(p_val_r)
                res_count += 1
                break

        # Support Lines:
        drawn_sup_prices: list[float] = []
        sup_count = 0
        for k_sb in range(n_below):
            if k_sb in used_below:
                continue
            p_val_s = below_prices[k_sb]
            p_time_s = below_times[k_sb]

            too_close_s = False
            for el_ps in drawn_sup_prices:
                if abs(p_val_s - el_ps) < cluster_threshold:
                    too_close_s = True
                    break
            if too_close_s:
                continue

            touches_s = 0
            last_hit_s = -20
            for ks in range(0, max_bars):
                if abs(self.low[ks] - p_val_s) <= touch_tol:
                    if (ks - last_hit_s) >= 10:
                        touches_s += 1
                        last_hit_s = ks
            lw_s = 1
            ls_s = line_style.DOTTED
            if touches_s >= 2:
                lw_s = 2
                ls_s = line_style.SOLID

            if sup_count == 0:
                obj_s1 = LineSegment(
                    AbsolutePosition(p_time_s, p_val_s),
                    AbsolutePosition(end_time, p_val_s),
                    color=color.GREEN,
                    line_style=ls_s,
                    line_width=lw_s
                )
                self.sup_line1.set(obj_s1)
                self.chart.draw(obj_s1)
                drawn_sup_prices.append(p_val_s)
                sup_count += 1
            elif sup_count == 1:
                obj_s2 = LineSegment(
                    AbsolutePosition(p_time_s, p_val_s),
                    AbsolutePosition(end_time, p_val_s),
                    color=color.GREEN,
                    line_style=ls_s,
                    line_width=lw_s
                )
                self.sup_line2.set(obj_s2)
                self.chart.draw(obj_s2)
                drawn_sup_prices.append(p_val_s)
                sup_count += 1
            elif sup_count == 2:
                obj_s3 = LineSegment(
                    AbsolutePosition(p_time_s, p_val_s),
                    AbsolutePosition(end_time, p_val_s),
                    color=color.GREEN,
                    line_style=ls_s,
                    line_width=lw_s
                )
                self.sup_line3.set(obj_s3)
                self.chart.draw(obj_s3)
                drawn_sup_prices.append(p_val_s)
                sup_count += 1
                break

        return
