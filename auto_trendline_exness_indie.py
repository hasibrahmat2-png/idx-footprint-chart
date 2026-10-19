# indie:lang_version = 5
# Automated Trendlines Engine for Exness Web Terminal & TakeProfit
# Ported directly from lightweight-charts-master (Phase 161, 163, 164)
# Strict Dow Theory Higher Lows (A1->A2) & Lower Highs (B1->B2), 45% Confirmation Rebound,
# Zero Close-Penetration, Forex Pip Scaling, Tiered Strength Hierarchy, Dynamic Status Badges & Individual Line Toggles

from math import isnan
from indie import indicator, param, color, line_style, MainContext, Optional, Var
from indie.drawings import LineSegment, LabelAbs, AbsolutePosition, callout_position

@indicator('Auto Trendlines', overlay_main_pane=True)
@param.str('filter_mode', default='Intact Only', options=['Intact Only', 'All (Intact & Broken)'], title='Filter Mode')
@param.bool('show_up_tl1', default=True, title='Up-TL #1 (Primary Support Ray)')
@param.bool('show_up_tl2', default=True, title='Up-TL #2 (Secondary Support Ray)')
@param.bool('show_up_tl3', default=True, title='Up-TL #3 (Tertiary Support Ray)')
@param.bool('show_dn_tl1', default=True, title='Down-TL #1 (Primary Resistance Ray)')
@param.bool('show_dn_tl2', default=True, title='Down-TL #2 (Secondary Resistance Ray)')
@param.bool('show_dn_tl3', default=True, title='Down-TL #3 (Tertiary Resistance Ray)')
@param.int('lookback', default=9, min=4, max=25, title='Pivot Window (Bars)')
@param.int('line_bars_ahead', default=8, min=1, max=30, title='Line Extension (Bars Ahead)')
@param.bool('show_labels', default=True, title='Show Touch & Status Badges')
class Main(MainContext):
    def __init__(self):
        # Persistent drawing slots (Erase-First pattern for rollback safety & dynamic updates)
        self.up_line1 = self.new_var(Optional[LineSegment]())
        self.up_line2 = self.new_var(Optional[LineSegment]())
        self.up_line3 = self.new_var(Optional[LineSegment]())

        self.up_lbl1 = self.new_var(Optional[LabelAbs]())
        self.up_lbl2 = self.new_var(Optional[LabelAbs]())
        self.up_lbl3 = self.new_var(Optional[LabelAbs]())

        self.dn_line1 = self.new_var(Optional[LineSegment]())
        self.dn_line2 = self.new_var(Optional[LineSegment]())
        self.dn_line3 = self.new_var(Optional[LineSegment]())

        self.dn_lbl1 = self.new_var(Optional[LabelAbs]())
        self.dn_lbl2 = self.new_var(Optional[LabelAbs]())
        self.dn_lbl3 = self.new_var(Optional[LabelAbs]())

    def calc(self, filter_mode: str, show_up_tl1: bool, show_up_tl2: bool, show_up_tl3: bool,
             show_dn_tl1: bool, show_dn_tl2: bool, show_dn_tl3: bool,
             lookback: int, line_bars_ahead: int, show_labels: bool):
        # 1. Expand series ring buffer capacity on EVERY bar so Indie never limits history
        req_size = 200
        self.high.request_size(req_size)
        self.low.request_size(req_size)
        self.close.request_size(req_size)
        self.time.request_size(req_size)

        avail_bars = self.bar_index + 1
        if avail_bars < 25:
            return

        # 2. Only calculate and draw on the latest bar to conserve CPU/RAM on Chromebook
        if not self.is_last_bar:
            return

        # 3. Clean up previously drawn items (Erase-First pattern for rollback safety)
        if self.up_line1.get() is not None:
            self.chart.erase(self.up_line1.get().value())
            self.up_line1.set(None)
        if self.up_line2.get() is not None:
            self.chart.erase(self.up_line2.get().value())
            self.up_line2.set(None)
        if self.up_line3.get() is not None:
            self.chart.erase(self.up_line3.get().value())
            self.up_line3.set(None)

        if self.up_lbl1.get() is not None:
            self.chart.erase(self.up_lbl1.get().value())
            self.up_lbl1.set(None)
        if self.up_lbl2.get() is not None:
            self.chart.erase(self.up_lbl2.get().value())
            self.up_lbl2.set(None)
        if self.up_lbl3.get() is not None:
            self.chart.erase(self.up_lbl3.get().value())
            self.up_lbl3.set(None)

        if self.dn_line1.get() is not None:
            self.chart.erase(self.dn_line1.get().value())
            self.dn_line1.set(None)
        if self.dn_line2.get() is not None:
            self.chart.erase(self.dn_line2.get().value())
            self.dn_line2.set(None)
        if self.dn_line3.get() is not None:
            self.chart.erase(self.dn_line3.get().value())
            self.dn_line3.set(None)

        if self.dn_lbl1.get() is not None:
            self.chart.erase(self.dn_lbl1.get().value())
            self.dn_lbl1.set(None)
        if self.dn_lbl2.get() is not None:
            self.chart.erase(self.dn_lbl2.get().value())
            self.dn_lbl2.set(None)
        if self.dn_lbl3.get() is not None:
            self.chart.erase(self.dn_lbl3.get().value())
            self.dn_lbl3.set(None)

        # 4. Instrument pip scaling & ATR-14 volatility calibration
        curr_price = self.close[0]
        base_pip: float = 0.0001
        touch_tol: float = 0.00012
        break_buf: float = 0.00025
        cluster_threshold: float = 0.0005

        if curr_price > 50000.0:  # BTC/USD
            base_pip = 10.0
            touch_tol = 15.0
            break_buf = 25.0
            cluster_threshold = 50.0
        elif curr_price > 1000.0:  # Gold XAU/USD or IDX Indices
            base_pip = 1.0
            touch_tol = 1.2
            break_buf = 2.0
            cluster_threshold = 4.0
        elif curr_price > 20.0:  # JPY pairs / Silver XAG/USD
            base_pip = 0.01
            touch_tol = 0.012
            break_buf = 0.02
            cluster_threshold = 0.05
        else:  # Standard Forex 4/5-decimal pairs (EUR/USD, GBP/USD)
            base_pip = 0.0001
            touch_tol = 0.00012
            break_buf = 0.00025
            cluster_threshold = 0.0005

        # ATR-14 calculation across completed historical bars k=1..14
        tr_sum: float = 0.0
        for k_atr in range(1, 15):
            h_k = self.high[k_atr]
            l_k = self.low[k_atr]
            c_prev = self.close[k_atr + 1]
            tr = max(h_k - l_k, abs(h_k - c_prev), abs(l_k - c_prev))
            tr_sum += tr
        cur_atr = tr_sum / 14.0
        min_prominence = max(0.60 * cur_atr, base_pip * 2.0)

        max_bars = min(150, avail_bars - 2)
        if max_bars <= lookback * 2:
            return

        # 5. Extract Dow Theory Pivot Lows (A) and Pivot Highs (B)
        # Stored strictly as parallel primitive lists for 100% Indie type-checker safety
        p_low_i: list[int] = []
        p_low_p: list[float] = []
        p_low_t: list[float] = []

        p_high_i: list[int] = []
        p_high_p: list[float] = []
        p_high_t: list[float] = []

        for i in range(lookback, max_bars - lookback):
            cand_low = self.low[i]
            is_pl = True
            left_rise: float = 0.0
            right_rise: float = 0.0
            for j in range(1, lookback + 1):
                if self.low[i - j] < cand_low or self.low[i + j] < cand_low:
                    is_pl = False
                    break
                left_rise = max(left_rise, self.low[i + j] - cand_low)
                right_rise = max(right_rise, self.low[i - j] - cand_low)
            if is_pl and (left_rise >= min_prominence or right_rise >= min_prominence):
                p_low_i.append(i)
                p_low_p.append(cand_low)
                p_low_t.append(self.time[i])

            cand_high = self.high[i]
            is_ph = True
            left_drop: float = 0.0
            right_drop: float = 0.0
            for j in range(1, lookback + 1):
                if self.high[i - j] > cand_high or self.high[i + j] > cand_high:
                    is_ph = False
                    break
                left_drop = max(left_drop, cand_high - self.high[i + j])
                right_drop = max(right_drop, cand_high - self.high[i - j])
            if is_ph and (left_drop >= min_prominence or right_drop >= min_prominence):
                p_high_i.append(i)
                p_high_p.append(cand_high)
                p_high_t.append(self.time[i])

        # 6. Detect Up-Trendlines (Higher Lows: A1 in past, A2 more recent -> i1 > i2, price2 > price1)
        up_cand_i1: list[int] = []
        up_cand_i2: list[int] = []
        up_cand_p1: list[float] = []
        up_cand_p2: list[float] = []
        up_cand_t1: list[float] = []
        up_cand_slope: list[float] = []
        up_cand_touches: list[int] = []
        up_cand_is_broken: list[bool] = []
        up_cand_break_idx: list[int] = []
        up_cand_last_touch: list[int] = []
        up_cand_end_price: list[float] = []

        n_p_low = len(p_low_i)
        for idx1 in range(n_p_low):
            i1 = p_low_i[idx1]
            p1 = p_low_p[idx1]
            t1 = p_low_t[idx1]
            for idx2 in range(n_p_low):
                i2 = p_low_i[idx2]
                p2 = p_low_p[idx2]
                # Distance check: A1 must be older than A2 by at least 12 bars (i1 > i2)
                if i1 - i2 < 12:
                    continue
                # Higher Low check (Dow Theory): A2 must be higher than A1
                if p2 <= p1:
                    continue

                slope = (p2 - p1) / float(i1 - i2)
                if slope <= 0.0:
                    continue

                # Slope sanity clamping (Pips per bar)
                slope_abs = abs(slope)
                if slope_abs < 0.05 * base_pip or slope_abs > 60.0 * base_pip:
                    continue

                # 50% Confirmation Rule (Bab 5):
                inter_peak = -1e9
                for k_pk in range(i2, i1 + 1):
                    if self.high[k_pk] > inter_peak:
                        inter_peak = self.high[k_pk]
                v_dist = inter_peak - p2
                min_rebound = max(0.45 * v_dist, base_pip * 1.5)
                confirmed_50 = False
                scan_limit_50 = max(0, i2 - 25)
                for k_rb in range(scan_limit_50, i2):
                    if self.high[k_rb] >= p2 + min_rebound:
                        confirmed_50 = True
                        break
                if not confirmed_50:
                    continue

                # Zero close-penetration between anchors
                violated = False
                for k_vt in range(i2 + 1, i1):
                    rp = p1 + slope * float(i1 - k_vt)
                    if self.close[k_vt] < rp:
                        violated = True
                        break
                if violated:
                    continue

                # Forward ray tracking from A2 towards bar 0
                touches = 2  # A1 + A2
                is_broken = False
                break_idx = -1
                last_touch = i2
                max_bounce = 0.0

                for k_fwd in range(i2 - 1, -1, -1):
                    rp = p1 + slope * float(i1 - k_fwd)
                    c_fwd = self.close[k_fwd]
                    l_fwd = self.low[k_fwd]
                    h_fwd = self.high[k_fwd]

                    # Valid Break: close pierces below ray buffer
                    if c_fwd < rp - break_buf:
                        is_broken = True
                        break_idx = k_fwd
                        break

                    if h_fwd - rp > max_bounce:
                        max_bounce = h_fwd - rp

                    # Touch test: >= 8 bars from last touch, price bounced away, low tests line
                    if (last_touch - k_fwd >= 8) and (max_bounce >= max(0.65 * cur_atr, base_pip * 2.0)):
                        is_touch = (abs(l_fwd - rp) <= touch_tol) or (l_fwd <= rp and c_fwd >= rp)
                        if is_touch:
                            touches += 1
                            last_touch = k_fwd
                            max_bounce = 0.0

                end_p = p1 + slope * float(i1)
                up_cand_i1.append(i1)
                up_cand_i2.append(i2)
                up_cand_p1.append(p1)
                up_cand_p2.append(p2)
                up_cand_t1.append(t1)
                up_cand_slope.append(slope)
                up_cand_touches.append(touches)
                up_cand_is_broken.append(is_broken)
                up_cand_break_idx.append(break_idx)
                up_cand_last_touch.append(last_touch)
                up_cand_end_price.append(end_p)

        # 7. Detect Down-Trendlines (Lower Highs: B1 in past, B2 more recent -> i1 > i2, price2 < price1)
        dn_cand_i1: list[int] = []
        dn_cand_i2: list[int] = []
        dn_cand_p1: list[float] = []
        dn_cand_p2: list[float] = []
        dn_cand_t1: list[float] = []
        dn_cand_slope: list[float] = []
        dn_cand_touches: list[int] = []
        dn_cand_is_broken: list[bool] = []
        dn_cand_break_idx: list[int] = []
        dn_cand_last_touch: list[int] = []
        dn_cand_end_price: list[float] = []

        n_p_high = len(p_high_i)
        for idx1 in range(n_p_high):
            i1 = p_high_i[idx1]
            p1 = p_high_p[idx1]
            t1 = p_high_t[idx1]
            for idx2 in range(n_p_high):
                i2 = p_high_i[idx2]
                p2 = p_high_p[idx2]
                if i1 - i2 < 12:
                    continue
                # Lower High check (Dow Theory): B2 must be lower than B1
                if p2 >= p1:
                    continue

                slope = (p2 - p1) / float(i1 - i2)
                if slope >= 0.0:
                    continue

                slope_abs = abs(slope)
                if slope_abs < 0.05 * base_pip or slope_abs > 60.0 * base_pip:
                    continue

                # 50% Confirmation Rule (Bab 5):
                inter_trough = 1e9
                for k_tr in range(i2, i1 + 1):
                    if self.low[k_tr] < inter_trough:
                        inter_trough = self.low[k_tr]
                v_dist = p2 - inter_trough
                min_drop = max(0.45 * v_dist, base_pip * 1.5)
                confirmed_50 = False
                scan_limit_50 = max(0, i2 - 25)
                for k_dp in range(scan_limit_50, i2):
                    if self.low[k_dp] <= p2 - min_drop:
                        confirmed_50 = True
                        break
                if not confirmed_50:
                    continue

                # Zero close-penetration between anchors
                violated = False
                for k_vt in range(i2 + 1, i1):
                    rp = p1 + slope * float(i1 - k_vt)
                    if self.close[k_vt] > rp:
                        violated = True
                        break
                if violated:
                    continue

                touches = 2  # B1 + B2
                is_broken = False
                break_idx = -1
                last_touch = i2
                max_drop = 0.0

                for k_fwd in range(i2 - 1, -1, -1):
                    rp = p1 + slope * float(i1 - k_fwd)
                    c_fwd = self.close[k_fwd]
                    l_fwd = self.low[k_fwd]
                    h_fwd = self.high[k_fwd]

                    # Valid Break: close pierces above ray buffer
                    if c_fwd > rp + break_buf:
                        is_broken = True
                        break_idx = k_fwd
                        break

                    if rp - l_fwd > max_drop:
                        max_drop = rp - l_fwd

                    # Touch test: >= 8 bars from last touch, price dropped away, high tests line
                    if (last_touch - k_fwd >= 8) and (max_drop >= max(0.65 * cur_atr, base_pip * 2.0)):
                        is_touch = (abs(h_fwd - rp) <= touch_tol) or (h_fwd >= rp and c_fwd <= rp)
                        if is_touch:
                            touches += 1
                            last_touch = k_fwd
                            max_drop = 0.0

                end_p = p1 + slope * float(i1)
                dn_cand_i1.append(i1)
                dn_cand_i2.append(i2)
                dn_cand_p1.append(p1)
                dn_cand_p2.append(p2)
                dn_cand_t1.append(t1)
                dn_cand_slope.append(slope)
                dn_cand_touches.append(touches)
                dn_cand_is_broken.append(is_broken)
                dn_cand_break_idx.append(break_idx)
                dn_cand_last_touch.append(last_touch)
                dn_cand_end_price.append(end_p)

        # 8. Structural Deduplication Helper:
        # Sort criteria: Unbroken first -> Touches count -> Recency (smaller k) -> Lifespan (larger i1)
        intact_only = (filter_mode == 'Intact Only')

        # Process Up-Trendlines:
        n_up_cand = len(up_cand_i1)
        up_order: list[int] = []
        for o_i in range(n_up_cand):
            up_order.append(o_i)
        # Custom bubble sort for Indie without complex key lambdas
        for s1 in range(n_up_cand):
            for s2 in range(s1 + 1, n_up_cand):
                idx_a = up_order[s1]
                idx_b = up_order[s2]
                brk_a = 1 if up_cand_is_broken[idx_a] else 0
                brk_b = 1 if up_cand_is_broken[idx_b] else 0
                swap = False
                if brk_a > brk_b:
                    swap = True
                elif brk_a == brk_b:
                    if up_cand_touches[idx_a] < up_cand_touches[idx_b]:
                        swap = True
                    elif up_cand_touches[idx_a] == up_cand_touches[idx_b]:
                        if up_cand_last_touch[idx_a] > up_cand_last_touch[idx_b]:
                            swap = True
                if swap:
                    up_order[s1] = idx_b
                    up_order[s2] = idx_a

        up_kept_indices: list[int] = []
        for o_idx in up_order:
            if intact_only and up_cand_is_broken[o_idx]:
                continue
            cand_i1 = up_cand_i1[o_idx]
            cand_slope = up_cand_slope[o_idx]
            cand_end = up_cand_end_price[o_idx]
            is_dup = False
            for kept_i in up_kept_indices:
                kp_i1 = up_cand_i1[kept_i]
                kp_slope = up_cand_slope[kept_i]
                kp_end = up_cand_end_price[kept_i]
                slope_diff = abs(cand_slope - kp_slope) / max(abs(cand_slope), abs(kp_slope), 1e-6)
                if abs(cand_i1 - kp_i1) <= 4 and slope_diff < 0.08:
                    is_dup = True
                    break
                if abs(cand_end - kp_end) < cluster_threshold and slope_diff < 0.12:
                    is_dup = True
                    break
            if not is_dup:
                up_kept_indices.append(o_idx)
                if len(up_kept_indices) >= 3:
                    break

        # Process Down-Trendlines:
        n_dn_cand = len(dn_cand_i1)
        dn_order: list[int] = []
        for o_i in range(n_dn_cand):
            dn_order.append(o_i)
        for s1 in range(n_dn_cand):
            for s2 in range(s1 + 1, n_dn_cand):
                idx_a = dn_order[s1]
                idx_b = dn_order[s2]
                brk_a = 1 if dn_cand_is_broken[idx_a] else 0
                brk_b = 1 if dn_cand_is_broken[idx_b] else 0
                swap = False
                if brk_a > brk_b:
                    swap = True
                elif brk_a == brk_b:
                    if dn_cand_touches[idx_a] < dn_cand_touches[idx_b]:
                        swap = True
                    elif dn_cand_touches[idx_a] == dn_cand_touches[idx_b]:
                        if dn_cand_last_touch[idx_a] > dn_cand_last_touch[idx_b]:
                            swap = True
                if swap:
                    dn_order[s1] = idx_b
                    dn_order[s2] = idx_a

        dn_kept_indices: list[int] = []
        for o_idx in dn_order:
            if intact_only and dn_cand_is_broken[o_idx]:
                continue
            cand_i1 = dn_cand_i1[o_idx]
            cand_slope = dn_cand_slope[o_idx]
            cand_end = dn_cand_end_price[o_idx]
            is_dup = False
            for kept_i in dn_kept_indices:
                kp_i1 = dn_cand_i1[kept_i]
                kp_slope = dn_cand_slope[kept_i]
                kp_end = dn_cand_end_price[kept_i]
                slope_diff = abs(cand_slope - kp_slope) / max(abs(cand_slope), abs(kp_slope), 1e-6)
                if abs(cand_i1 - kp_i1) <= 4 and slope_diff < 0.08:
                    is_dup = True
                    break
                if abs(cand_end - kp_end) < cluster_threshold and slope_diff < 0.12:
                    is_dup = True
                    break
            if not is_dup:
                dn_kept_indices.append(o_idx)
                if len(dn_kept_indices) >= 3:
                    break

        # 9. Render Selected Up-Trendlines
        time_step = self.time[0] - self.time[1]
        c_teal = color.rgba(0, 191, 165, 0.95)
        c_gray = color.rgba(120, 123, 134, 0.6)

        for slot_num in range(len(up_kept_indices)):
            c_idx = up_kept_indices[slot_num]
            if slot_num == 0 and not show_up_tl1:
                continue
            if slot_num == 1 and not show_up_tl2:
                continue
            if slot_num == 2 and not show_up_tl3:
                continue

            i1 = up_cand_i1[c_idx]
            p1 = up_cand_p1[c_idx]
            t1 = up_cand_t1[c_idx]
            slope = up_cand_slope[c_idx]
            touches = up_cand_touches[c_idx]
            is_broken = up_cand_is_broken[c_idx]
            break_idx = up_cand_break_idx[c_idx]

            ls = line_style.SOLID
            lw = 2
            l_color = c_teal
            if is_broken:
                ls = line_style.DOTTED
                lw = 1
                l_color = c_gray
            elif touches >= 5:
                lw = 3
            elif touches == 4:
                lw = 2
            elif touches == 3:
                ls = line_style.DASHED
                lw = 2
            else:
                ls = line_style.DOTTED
                lw = 1

            end_t: float = 0.0
            end_p: float = 0.0
            if is_broken and break_idx >= 0:
                cut_k = max(0, break_idx - 4)
                end_t = self.time[cut_k]
                end_p = p1 + slope * float(i1 - cut_k)
            else:
                end_t = self.time[0] + time_step * float(line_bars_ahead)
                end_p = p1 + slope * float(i1 + line_bars_ahead)

            pos_start = AbsolutePosition(t1, p1)
            pos_end = AbsolutePosition(end_t, end_p)
            line_obj = LineSegment(pos_start, pos_end, color=l_color, line_style=ls, line_width=lw)

            if slot_num == 0:
                self.up_line1.set(line_obj)
                self.chart.draw(line_obj)
            elif slot_num == 1:
                self.up_line2.set(line_obj)
                self.chart.draw(line_obj)
            elif slot_num == 2:
                self.up_line3.set(line_obj)
                self.chart.draw(line_obj)

            if show_labels:
                st_text = 'Major' if touches >= 5 else ('Strong' if touches == 4 else ('Confirmed' if touches == 3 else 'Tentative'))
                badge_text = f"Up-TL #{slot_num + 1} ({touches}x {st_text})"
                if is_broken:
                    badge_text = f"Broken Up-TL #{slot_num + 1} ({touches}x)"
                lbl_obj = LabelAbs(
                    badge_text,
                    pos_end,
                    font_size=11,
                    text_color=l_color,
                    bg_color=color.rgba(0, 0, 0, 0.01),
                    callout_position=callout_position.TOP_RIGHT
                )
                if slot_num == 0:
                    self.up_lbl1.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_num == 1:
                    self.up_lbl2.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_num == 2:
                    self.up_lbl3.set(lbl_obj)
                    self.chart.draw(lbl_obj)

        # 10. Render Selected Down-Trendlines
        c_coral = color.rgba(255, 82, 82, 0.95)

        for slot_num in range(len(dn_kept_indices)):
            c_idx = dn_kept_indices[slot_num]
            if slot_num == 0 and not show_dn_tl1:
                continue
            if slot_num == 1 and not show_dn_tl2:
                continue
            if slot_num == 2 and not show_dn_tl3:
                continue

            i1 = dn_cand_i1[c_idx]
            p1 = dn_cand_p1[c_idx]
            t1 = dn_cand_t1[c_idx]
            slope = dn_cand_slope[c_idx]
            touches = dn_cand_touches[c_idx]
            is_broken = dn_cand_is_broken[c_idx]
            break_idx = dn_cand_break_idx[c_idx]

            ls = line_style.SOLID
            lw = 2
            l_color = c_coral
            if is_broken:
                ls = line_style.DOTTED
                lw = 1
                l_color = c_gray
            elif touches >= 5:
                lw = 3
            elif touches == 4:
                lw = 2
            elif touches == 3:
                ls = line_style.DASHED
                lw = 2
            else:
                ls = line_style.DOTTED
                lw = 1

            end_t: float = 0.0
            end_p: float = 0.0
            if is_broken and break_idx >= 0:
                cut_k = max(0, break_idx - 4)
                end_t = self.time[cut_k]
                end_p = p1 + slope * float(i1 - cut_k)
            else:
                end_t = self.time[0] + time_step * float(line_bars_ahead)
                end_p = p1 + slope * float(i1 + line_bars_ahead)

            pos_start = AbsolutePosition(t1, p1)
            pos_end = AbsolutePosition(end_t, end_p)
            line_obj = LineSegment(pos_start, pos_end, color=l_color, line_style=ls, line_width=lw)

            if slot_num == 0:
                self.dn_line1.set(line_obj)
                self.chart.draw(line_obj)
            elif slot_num == 1:
                self.dn_line2.set(line_obj)
                self.chart.draw(line_obj)
            elif slot_num == 2:
                self.dn_line3.set(line_obj)
                self.chart.draw(line_obj)

            if show_labels:
                st_text = 'Major' if touches >= 5 else ('Strong' if touches == 4 else ('Confirmed' if touches == 3 else 'Tentative'))
                badge_text = f"Down-TL #{slot_num + 1} ({touches}x {st_text})"
                if is_broken:
                    badge_text = f"Broken Down-TL #{slot_num + 1} ({touches}x)"
                lbl_obj = LabelAbs(
                    badge_text,
                    pos_end,
                    font_size=11,
                    text_color=l_color,
                    bg_color=color.rgba(0, 0, 0, 0.01),
                    callout_position=callout_position.BOTTOM_RIGHT
                )
                if slot_num == 0:
                    self.dn_lbl1.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_num == 1:
                    self.dn_lbl2.set(lbl_obj)
                    self.chart.draw(lbl_obj)
                elif slot_num == 2:
                    self.dn_lbl3.set(lbl_obj)
                    self.chart.draw(lbl_obj)

        return
