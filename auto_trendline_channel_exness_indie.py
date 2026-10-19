# indie:lang_version = 5
# Automated Trendlines & Parallel Channels Engine for Exness Web Terminal & TakeProfit
# Ported directly from lightweight-charts-master (Phase 161, 163, 164)
# Dow Theory Structural Swings, Tiered Strength Hierarchy, Shaded Corridors, Individual Line Controls

from math import isnan
from indie import indicator, param, color, line_style, MainContext, Optional, Var
from indie.drawings import LineSegment, Channel, LabelAbs, AbsolutePosition, callout_position

@indicator('Auto Trendlines & Channels', overlay_main_pane=True)
@param.str('filter_mode', default='Intact Only', options=['Intact Only', 'All (Intact & Broken)'], title='Filter Mode')
@param.bool('show_trendlines', default=True, title='Show Automated Trendlines')
@param.bool('show_up_tl1', default=True, title='Up-TL #1 (Primary Support Ray)')
@param.bool('show_up_tl2', default=True, title='Up-TL #2 (Secondary Support Ray)')
@param.bool('show_up_tl3', default=True, title='Up-TL #3 (Tertiary Support Ray)')
@param.bool('show_dn_tl1', default=True, title='Down-TL #1 (Primary Resistance Ray)')
@param.bool('show_dn_tl2', default=True, title='Down-TL #2 (Secondary Resistance Ray)')
@param.bool('show_dn_tl3', default=True, title='Down-TL #3 (Tertiary Resistance Ray)')
@param.bool('show_channel', default=True, title='Show Dominant Parallel Channel')
@param.int('lookback', default=9, min=4, max=25, title='Pivot Window (Bars)')
@param.int('line_bars_ahead', default=8, min=1, max=30, title='Line/Channel Extension (Bars Ahead)')
@param.bool('show_labels', default=True, title='Show Touch & Status Badges')
class Main(MainContext):
    def __init__(self):
        # 1. Trendline drawing slots
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

        # 2. Parallel Channel drawing slots
        self.channel_slot = self.new_var(Optional[Channel]())
        self.channel_lbl = self.new_var(Optional[LabelAbs]())

    def calc(self, filter_mode: str, show_trendlines: bool,
             show_up_tl1: bool, show_up_tl2: bool, show_up_tl3: bool,
             show_dn_tl1: bool, show_dn_tl2: bool, show_dn_tl3: bool,
             show_channel: bool, lookback: int, line_bars_ahead: int, show_labels: bool):
        req_size = 200
        self.high.request_size(req_size)
        self.low.request_size(req_size)
        self.close.request_size(req_size)
        self.time.request_size(req_size)

        avail_bars = self.bar_index + 1
        if avail_bars < 25:
            return

        if not self.is_last_bar:
            return

        # Clean previous items (Erase-First pattern for rollback safety)
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

        if self.channel_slot.get() is not None:
            self.chart.erase(self.channel_slot.get().value())
            self.channel_slot.set(None)

        if self.channel_lbl.get() is not None:
            self.chart.erase(self.channel_lbl.get().value())
            self.channel_lbl.set(None)

        # Dynamic Pip Scale & ATR-14
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
        elif curr_price > 1000.0:  # Gold XAU/USD / IDX Indices
            base_pip = 1.0
            touch_tol = 1.2
            break_buf = 2.0
            cluster_threshold = 4.0
        elif curr_price > 20.0:  # JPY pairs / Silver XAG/USD
            base_pip = 0.01
            touch_tol = 0.012
            break_buf = 0.02
            cluster_threshold = 0.05
        else:  # Standard Forex pairs
            base_pip = 0.0001
            touch_tol = 0.00012
            break_buf = 0.00025
            cluster_threshold = 0.0005

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

        # Shared Pivot Extraction (Single execution for maximum performance)
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

        n_p_low = len(p_low_i)
        n_p_high = len(p_high_i)
        intact_only = (filter_mode == 'Intact Only')
        time_step = self.time[0] - self.time[1]

        # ==========================================
        # SECTION A: AUTOMATED TRENDLINES
        # ==========================================
        if show_trendlines:
            # 1. Up-Trendlines
            up_cand_i1: list[int] = []
            up_cand_p1: list[float] = []
            up_cand_t1: list[float] = []
            up_cand_slope: list[float] = []
            up_cand_touches: list[int] = []
            up_cand_is_broken: list[bool] = []
            up_cand_break_idx: list[int] = []
            up_cand_last_touch: list[int] = []
            up_cand_end_price: list[float] = []

            for idx1 in range(n_p_low):
                i1 = p_low_i[idx1]
                p1 = p_low_p[idx1]
                t1 = p_low_t[idx1]
                for idx2 in range(n_p_low):
                    i2 = p_low_i[idx2]
                    p2 = p_low_p[idx2]
                    if i1 - i2 < 12:
                        continue
                    if p2 <= p1:
                        continue

                    slope = (p2 - p1) / float(i1 - i2)
                    if slope <= 0.0:
                        continue

                    slope_abs = abs(slope)
                    if slope_abs < 0.05 * base_pip or slope_abs > 60.0 * base_pip:
                        continue

                    # 50% Confirmation Rule (Bab 5)
                    inter_peak = -1e9
                    for k_pk in range(i2, i1 + 1):
                        if self.high[k_pk] > inter_peak:
                            inter_peak = self.high[k_pk]
                    v_dist = inter_peak - p2
                    min_rebound = max(0.45 * v_dist, base_pip * 1.5)
                    confirmed_50 = False
                    for k_rb in range(max(0, i2 - 25), i2):
                        if self.high[k_rb] >= p2 + min_rebound:
                            confirmed_50 = True
                            break
                    if not confirmed_50:
                        continue

                    # Zero close-penetration
                    violated = False
                    for k_vt in range(i2 + 1, i1):
                        rp = p1 + slope * float(i1 - k_vt)
                        if self.close[k_vt] < rp:
                            violated = True
                            break
                    if violated:
                        continue

                    touches = 2
                    is_broken = False
                    break_idx = -1
                    last_touch = i2
                    max_bounce = 0.0

                    for k_fwd in range(i2 - 1, -1, -1):
                        rp = p1 + slope * float(i1 - k_fwd)
                        c_fwd = self.close[k_fwd]
                        l_fwd = self.low[k_fwd]
                        h_fwd = self.high[k_fwd]

                        if c_fwd < rp - break_buf:
                            is_broken = True
                            break_idx = k_fwd
                            break

                        if h_fwd - rp > max_bounce:
                            max_bounce = h_fwd - rp

                        if (last_touch - k_fwd >= 8) and (max_bounce >= max(0.65 * cur_atr, base_pip * 2.0)):
                            if (abs(l_fwd - rp) <= touch_tol) or (l_fwd <= rp and c_fwd >= rp):
                                touches += 1
                                last_touch = k_fwd
                                max_bounce = 0.0

                    end_p = p1 + slope * float(i1)
                    up_cand_i1.append(i1)
                    up_cand_p1.append(p1)
                    up_cand_t1.append(t1)
                    up_cand_slope.append(slope)
                    up_cand_touches.append(touches)
                    up_cand_is_broken.append(is_broken)
                    up_cand_break_idx.append(break_idx)
                    up_cand_last_touch.append(last_touch)
                    up_cand_end_price.append(end_p)

            # Sort & Deduplicate Up-Trendlines
            n_up_cand = len(up_cand_i1)
            up_order: list[int] = []
            for o_i in range(n_up_cand):
                up_order.append(o_i)
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

            up_kept: list[int] = []
            for o_idx in up_order:
                if intact_only and up_cand_is_broken[o_idx]:
                    continue
                cand_i1 = up_cand_i1[o_idx]
                cand_slope = up_cand_slope[o_idx]
                cand_end = up_cand_end_price[o_idx]
                is_dup = False
                for kp in up_kept:
                    slope_diff = abs(cand_slope - up_cand_slope[kp]) / max(abs(cand_slope), abs(up_cand_slope[kp]), 1e-6)
                    if abs(cand_i1 - up_cand_i1[kp]) <= 4 and slope_diff < 0.08:
                        is_dup = True
                        break
                    if abs(cand_end - up_cand_end_price[kp]) < cluster_threshold and slope_diff < 0.12:
                        is_dup = True
                        break
                if not is_dup:
                    up_kept.append(o_idx)
                    if len(up_kept) >= 3:
                        break

            # Render Up-Trendlines
            c_teal = color.rgba(0, 191, 165, 0.95)
            c_gray = color.rgba(120, 123, 134, 0.6)

            for s_num in range(len(up_kept)):
                c_idx = up_kept[s_num]
                if s_num == 0 and not show_up_tl1:
                    continue
                if s_num == 1 and not show_up_tl2:
                    continue
                if s_num == 2 and not show_up_tl3:
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
                l_col = c_teal
                if is_broken:
                    ls = line_style.DOTTED
                    lw = 1
                    l_col = c_gray
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

                line_obj = LineSegment(AbsolutePosition(t1, p1), AbsolutePosition(end_t, end_p),
                                       color=l_col, line_style=ls, line_width=lw)
                if s_num == 0:
                    self.up_line1.set(line_obj)
                    self.chart.draw(line_obj)
                elif s_num == 1:
                    self.up_line2.set(line_obj)
                    self.chart.draw(line_obj)
                elif s_num == 2:
                    self.up_line3.set(line_obj)
                    self.chart.draw(line_obj)

                if show_labels:
                    st_text = 'Major' if touches >= 5 else ('Strong' if touches == 4 else ('Confirmed' if touches == 3 else 'Tentative'))
                    badge_text = f"Up-TL #{s_num + 1} ({touches}x {st_text})"
                    if is_broken:
                        badge_text = f"Broken Up-TL #{s_num + 1} ({touches}x)"
                    lbl_obj = LabelAbs(badge_text, AbsolutePosition(end_t, end_p), font_size=11,
                                       text_color=l_col, bg_color=color.rgba(0, 0, 0, 0.01),
                                       callout_position=callout_position.TOP_RIGHT)
                    if s_num == 0:
                        self.up_lbl1.set(lbl_obj)
                        self.chart.draw(lbl_obj)
                    elif s_num == 1:
                        self.up_lbl2.set(lbl_obj)
                        self.chart.draw(lbl_obj)
                    elif s_num == 2:
                        self.up_lbl3.set(lbl_obj)
                        self.chart.draw(lbl_obj)

            # 2. Down-Trendlines
            dn_cand_i1: list[int] = []
            dn_cand_p1: list[float] = []
            dn_cand_t1: list[float] = []
            dn_cand_slope: list[float] = []
            dn_cand_touches: list[int] = []
            dn_cand_is_broken: list[bool] = []
            dn_cand_break_idx: list[int] = []
            dn_cand_last_touch: list[int] = []
            dn_cand_end_price: list[float] = []

            for idx1 in range(n_p_high):
                i1 = p_high_i[idx1]
                p1 = p_high_p[idx1]
                t1 = p_high_t[idx1]
                for idx2 in range(n_p_high):
                    i2 = p_high_i[idx2]
                    p2 = p_high_p[idx2]
                    if i1 - i2 < 12:
                        continue
                    if p2 >= p1:
                        continue

                    slope = (p2 - p1) / float(i1 - i2)
                    if slope >= 0.0:
                        continue

                    slope_abs = abs(slope)
                    if slope_abs < 0.05 * base_pip or slope_abs > 60.0 * base_pip:
                        continue

                    inter_trough = 1e9
                    for k_tr in range(i2, i1 + 1):
                        if self.low[k_tr] < inter_trough:
                            inter_trough = self.low[k_tr]
                    v_dist = p2 - inter_trough
                    min_drop = max(0.45 * v_dist, base_pip * 1.5)
                    confirmed_50 = False
                    for k_dp in range(max(0, i2 - 25), i2):
                        if self.low[k_dp] <= p2 - min_drop:
                            confirmed_50 = True
                            break
                    if not confirmed_50:
                        continue

                    violated = False
                    for k_vt in range(i2 + 1, i1):
                        rp = p1 + slope * float(i1 - k_vt)
                        if self.close[k_vt] > rp:
                            violated = True
                            break
                    if violated:
                        continue

                    touches = 2
                    is_broken = False
                    break_idx = -1
                    last_touch = i2
                    max_drop = 0.0

                    for k_fwd in range(i2 - 1, -1, -1):
                        rp = p1 + slope * float(i1 - k_fwd)
                        c_fwd = self.close[k_fwd]
                        l_fwd = self.low[k_fwd]
                        h_fwd = self.high[k_fwd]

                        if c_fwd > rp + break_buf:
                            is_broken = True
                            break_idx = k_fwd
                            break

                        if rp - l_fwd > max_drop:
                            max_drop = rp - l_fwd

                        if (last_touch - k_fwd >= 8) and (max_drop >= max(0.65 * cur_atr, base_pip * 2.0)):
                            if (abs(h_fwd - rp) <= touch_tol) or (h_fwd >= rp and c_fwd <= rp):
                                touches += 1
                                last_touch = k_fwd
                                max_drop = 0.0

                    end_p = p1 + slope * float(i1)
                    dn_cand_i1.append(i1)
                    dn_cand_p1.append(p1)
                    dn_cand_t1.append(t1)
                    dn_cand_slope.append(slope)
                    dn_cand_touches.append(touches)
                    dn_cand_is_broken.append(is_broken)
                    dn_cand_break_idx.append(break_idx)
                    dn_cand_last_touch.append(last_touch)
                    dn_cand_end_price.append(end_p)

            # Sort & Deduplicate Down-Trendlines
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

            dn_kept: list[int] = []
            for o_idx in dn_order:
                if intact_only and dn_cand_is_broken[o_idx]:
                    continue
                cand_i1 = dn_cand_i1[o_idx]
                cand_slope = dn_cand_slope[o_idx]
                cand_end = dn_cand_end_price[o_idx]
                is_dup = False
                for kp in dn_kept:
                    slope_diff = abs(cand_slope - dn_cand_slope[kp]) / max(abs(cand_slope), abs(dn_cand_slope[kp]), 1e-6)
                    if abs(cand_i1 - dn_cand_i1[kp]) <= 4 and slope_diff < 0.08:
                        is_dup = True
                        break
                    if abs(cand_end - dn_cand_end_price[kp]) < cluster_threshold and slope_diff < 0.12:
                        is_dup = True
                        break
                if not is_dup:
                    dn_kept.append(o_idx)
                    if len(dn_kept) >= 3:
                        break

            # Render Down-Trendlines
            c_coral = color.rgba(255, 82, 82, 0.95)

            for s_num in range(len(dn_kept)):
                c_idx = dn_kept[s_num]
                if s_num == 0 and not show_dn_tl1:
                    continue
                if s_num == 1 and not show_dn_tl2:
                    continue
                if s_num == 2 and not show_dn_tl3:
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
                l_col = c_coral
                if is_broken:
                    ls = line_style.DOTTED
                    lw = 1
                    l_col = c_gray
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

                line_obj = LineSegment(AbsolutePosition(t1, p1), AbsolutePosition(end_t, end_p),
                                       color=l_col, line_style=ls, line_width=lw)
                if s_num == 0:
                    self.dn_line1.set(line_obj)
                    self.chart.draw(line_obj)
                elif s_num == 1:
                    self.dn_line2.set(line_obj)
                    self.chart.draw(line_obj)
                elif s_num == 2:
                    self.dn_line3.set(line_obj)
                    self.chart.draw(line_obj)

                if show_labels:
                    st_text = 'Major' if touches >= 5 else ('Strong' if touches == 4 else ('Confirmed' if touches == 3 else 'Tentative'))
                    badge_text = f"Down-TL #{s_num + 1} ({touches}x {st_text})"
                    if is_broken:
                        badge_text = f"Broken Down-TL #{s_num + 1} ({touches}x)"
                    lbl_obj = LabelAbs(badge_text, AbsolutePosition(end_t, end_p), font_size=11,
                                       text_color=l_col, bg_color=color.rgba(0, 0, 0, 0.01),
                                       callout_position=callout_position.BOTTOM_RIGHT)
                    if s_num == 0:
                        self.dn_lbl1.set(lbl_obj)
                        self.chart.draw(lbl_obj)
                    elif s_num == 1:
                        self.dn_lbl2.set(lbl_obj)
                        self.chart.draw(lbl_obj)
                    elif s_num == 2:
                        self.dn_lbl3.set(lbl_obj)
                        self.chart.draw(lbl_obj)

        # ==========================================
        # SECTION B: PARALLEL CHANNELS (BAB 12)
        # ==========================================
        if show_channel:
            up_ch_i1: list[int] = []
            up_ch_p1: list[float] = []
            up_ch_t1: list[float] = []
            up_ch_slope: list[float] = []
            up_ch_width: list[float] = []
            up_ch_touches: list[int] = []
            up_ch_is_broken: list[bool] = []
            up_ch_break_idx: list[int] = []
            up_ch_last_touch: list[int] = []

            for idx1 in range(n_p_low):
                i1 = p_low_i[idx1]
                p1 = p_low_p[idx1]
                t1 = p_low_t[idx1]
                for idx2 in range(n_p_low):
                    i2 = p_low_i[idx2]
                    p2 = p_low_p[idx2]
                    if i1 - i2 < 12:
                        continue
                    if p2 <= p1:
                        continue

                    slope = (p2 - p1) / float(i1 - i2)
                    if slope <= 0.0:
                        continue

                    slope_abs = abs(slope)
                    if slope_abs < 0.05 * base_pip or slope_abs > 60.0 * base_pip:
                        continue

                    # Intervening C1
                    max_peak_dist: float = -1e9
                    c1_idx = -1
                    for idx_h in range(n_p_high):
                        h_bar = p_high_i[idx_h]
                        if i2 < h_bar and h_bar < i1:
                            rp = p1 + slope * float(i1 - h_bar)
                            dist = p_high_p[idx_h] - rp
                            if dist > max_peak_dist:
                                max_peak_dist = dist
                                c1_idx = h_bar

                    if c1_idx < 0 or max_peak_dist < base_pip * 3.5:
                        continue

                    channel_width = max_peak_dist

                    violated = False
                    for k_vt in range(i2 + 1, i1):
                        rp = p1 + slope * float(i1 - k_vt)
                        if self.close[k_vt] < rp:
                            violated = True
                            break
                    if violated:
                        continue

                    tl_touches = 2
                    ch_touches = 1
                    is_broken = False
                    break_idx = -1
                    last_tl_touch = i2
                    last_ch_touch = c1_idx
                    max_bounce = 0.0

                    for k_fwd in range(i2 - 1, -1, -1):
                        rp_base = p1 + slope * float(i1 - k_fwd)
                        rp_return = rp_base + channel_width
                        c_fwd = self.close[k_fwd]
                        l_fwd = self.low[k_fwd]
                        h_fwd = self.high[k_fwd]

                        if c_fwd < rp_base - break_buf:
                            is_broken = True
                            break_idx = k_fwd
                            break

                        if h_fwd - rp_base > max_bounce:
                            max_bounce = h_fwd - rp_base

                        if (last_tl_touch - k_fwd >= 8) and (max_bounce >= max(0.65 * cur_atr, base_pip * 2.0)):
                            if (abs(l_fwd - rp_base) <= touch_tol) or (l_fwd <= rp_base and c_fwd >= rp_base):
                                tl_touches += 1
                                last_tl_touch = k_fwd
                                max_bounce = 0.0

                        if abs(last_ch_touch - k_fwd) >= 6:
                            if (abs(h_fwd - rp_return) <= touch_tol) or (h_fwd >= rp_return and c_fwd <= rp_return):
                                ch_touches += 1
                                last_ch_touch = k_fwd

                    total_touches = tl_touches + ch_touches
                    if ch_touches < 2 and total_touches < 4:
                        continue

                    up_ch_i1.append(i1)
                    up_ch_p1.append(p1)
                    up_ch_t1.append(t1)
                    up_ch_slope.append(slope)
                    up_ch_width.append(channel_width)
                    up_ch_touches.append(total_touches)
                    up_ch_is_broken.append(is_broken)
                    up_ch_break_idx.append(break_idx)
                    up_ch_last_touch.append(max(last_tl_touch, last_ch_touch))

            # Down-Channels
            dn_ch_i1: list[int] = []
            dn_ch_p1: list[float] = []
            dn_ch_t1: list[float] = []
            dn_ch_slope: list[float] = []
            dn_ch_width: list[float] = []
            dn_ch_touches: list[int] = []
            dn_ch_is_broken: list[bool] = []
            dn_ch_break_idx: list[int] = []
            dn_ch_last_touch: list[int] = []

            for idx1 in range(n_p_high):
                i1 = p_high_i[idx1]
                p1 = p_high_p[idx1]
                t1 = p_high_t[idx1]
                for idx2 in range(n_p_high):
                    i2 = p_high_i[idx2]
                    p2 = p_high_p[idx2]
                    if i1 - i2 < 12:
                        continue
                    if p2 >= p1:
                        continue

                    slope = (p2 - p1) / float(i1 - i2)
                    if slope >= 0.0:
                        continue

                    slope_abs = abs(slope)
                    if slope_abs < 0.05 * base_pip or slope_abs > 60.0 * base_pip:
                        continue

                    max_trough_dist: float = -1e9
                    c1_idx = -1
                    for idx_l in range(n_p_low):
                        l_bar = p_low_i[idx_l]
                        if i2 < l_bar and l_bar < i1:
                            rp = p1 + slope * float(i1 - l_bar)
                            dist = rp - p_low_p[idx_l]
                            if dist > max_trough_dist:
                                max_trough_dist = dist
                                c1_idx = l_bar

                    if c1_idx < 0 or max_trough_dist < base_pip * 3.5:
                        continue

                    channel_width = max_trough_dist

                    violated = False
                    for k_vt in range(i2 + 1, i1):
                        rp = p1 + slope * float(i1 - k_vt)
                        if self.close[k_vt] > rp:
                            violated = True
                            break
                    if violated:
                        continue

                    tl_touches = 2
                    ch_touches = 1
                    is_broken = False
                    break_idx = -1
                    last_tl_touch = i2
                    last_ch_touch = c1_idx
                    max_drop = 0.0

                    for k_fwd in range(i2 - 1, -1, -1):
                        rp_base = p1 + slope * float(i1 - k_fwd)
                        rp_return = rp_base - channel_width
                        c_fwd = self.close[k_fwd]
                        l_fwd = self.low[k_fwd]
                        h_fwd = self.high[k_fwd]

                        if c_fwd > rp_base + break_buf:
                            is_broken = True
                            break_idx = k_fwd
                            break

                        if rp_base - l_fwd > max_drop:
                            max_drop = rp_base - l_fwd

                        if (last_tl_touch - k_fwd >= 8) and (max_drop >= max(0.65 * cur_atr, base_pip * 2.0)):
                            if (abs(h_fwd - rp_base) <= touch_tol) or (h_fwd >= rp_base and c_fwd <= rp_base):
                                tl_touches += 1
                                last_tl_touch = k_fwd
                                max_drop = 0.0

                        if abs(last_ch_touch - k_fwd) >= 6:
                            if (abs(l_fwd - rp_return) <= touch_tol) or (l_fwd <= rp_return and c_fwd >= rp_return):
                                ch_touches += 1
                                last_ch_touch = k_fwd

                    total_touches = tl_touches + ch_touches
                    if ch_touches < 2 and total_touches < 4:
                        continue

                    dn_ch_i1.append(i1)
                    dn_ch_p1.append(p1)
                    dn_ch_t1.append(t1)
                    dn_ch_slope.append(slope)
                    dn_ch_width.append(channel_width)
                    dn_ch_touches.append(total_touches)
                    dn_ch_is_broken.append(is_broken)
                    dn_ch_break_idx.append(break_idx)
                    dn_ch_last_touch.append(max(last_tl_touch, last_ch_touch))

            # Select Best Up & Down
            best_up_idx = -1
            for idx in range(len(up_ch_i1)):
                if intact_only and up_ch_is_broken[idx]:
                    continue
                if best_up_idx < 0:
                    best_up_idx = idx
                    continue
                a_brk = 1 if up_ch_is_broken[best_up_idx] else 0
                b_brk = 1 if up_ch_is_broken[idx] else 0
                if b_brk < a_brk:
                    best_up_idx = idx
                elif b_brk == a_brk:
                    if up_ch_touches[idx] > up_ch_touches[best_up_idx]:
                        best_up_idx = idx

            best_dn_idx = -1
            for idx in range(len(dn_ch_i1)):
                if intact_only and dn_ch_is_broken[idx]:
                    continue
                if best_dn_idx < 0:
                    best_dn_idx = idx
                    continue
                a_brk = 1 if dn_ch_is_broken[best_dn_idx] else 0
                b_brk = 1 if dn_ch_is_broken[idx] else 0
                if b_brk < a_brk:
                    best_dn_idx = idx
                elif b_brk == a_brk:
                    if dn_ch_touches[idx] > dn_ch_touches[best_dn_idx]:
                        best_dn_idx = idx

            chosen_type = ''
            if best_up_idx >= 0 and best_dn_idx < 0:
                chosen_type = 'up'
            elif best_up_idx < 0 and best_dn_idx >= 0:
                chosen_type = 'down'
            elif best_up_idx >= 0 and best_dn_idx >= 0:
                up_brk = up_ch_is_broken[best_up_idx]
                dn_brk = dn_ch_is_broken[best_dn_idx]
                if not up_brk and dn_brk:
                    chosen_type = 'up'
                elif up_brk and not dn_brk:
                    chosen_type = 'down'
                else:
                    up_tch = up_ch_touches[best_up_idx]
                    dn_tch = dn_ch_touches[best_dn_idx]
                    if up_tch >= dn_tch + 2:
                        chosen_type = 'up'
                    elif dn_tch >= up_tch + 2:
                        chosen_type = 'down'
                    else:
                        ema_p = min(20, avail_bars)
                        k_ema = 2.0 / float(ema_p + 1)
                        cur_ema = self.close[ema_p - 1]
                        for idx_e in range(ema_p - 2, -1, -1):
                            cur_ema = self.close[idx_e] * k_ema + cur_ema * (1.0 - k_ema)
                        if self.close[0] >= cur_ema:
                            chosen_type = 'up'
                        else:
                            chosen_type = 'down'

            # Render Chosen Channel
            if chosen_type == 'up':
                idx = best_up_idx
                i1 = up_ch_i1[idx]
                p1 = up_ch_p1[idx]
                t1 = up_ch_t1[idx]
                slope = up_ch_slope[idx]
                ch_width = up_ch_width[idx]
                touches = up_ch_touches[idx]
                is_broken = up_ch_is_broken[idx]
                break_idx = up_ch_break_idx[idx]

                l_color = color.rgba(0, 191, 165, 0.9)
                bg_color = color.rgba(0, 191, 165, 0.04)
                ls = line_style.SOLID
                lw = 2
                if is_broken:
                    l_color = color.rgba(120, 123, 134, 0.6)
                    bg_color = color.rgba(120, 123, 134, 0.02)
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

                ch_obj = Channel(
                    AbsolutePosition(t1, p1),
                    AbsolutePosition(end_t, end_p),
                    channel_width=ch_width,
                    line_style=ls,
                    line_width=lw,
                    line_color=l_color,
                    bg_color=bg_color,
                    middle_line_style=line_style.DOTTED,
                    middle_line_width=1,
                    middle_line_color=l_color
                )
                self.channel_slot.set(ch_obj)
                self.chart.draw(ch_obj)

                if show_labels:
                    status_txt = f"Up-Channel ({touches}x Touches)"
                    if is_broken:
                        status_txt = f"Broken Up-Channel ({touches}x)"
                    lbl_obj = LabelAbs(
                        status_txt,
                        AbsolutePosition(end_t, end_p + ch_width * 0.5),
                        font_size=11,
                        text_color=l_color,
                        bg_color=color.rgba(0, 0, 0, 0.01),
                        callout_position=callout_position.TOP_RIGHT
                    )
                    self.channel_lbl.set(lbl_obj)
                    self.chart.draw(lbl_obj)

            elif chosen_type == 'down':
                idx = best_dn_idx
                i1 = dn_ch_i1[idx]
                p1 = dn_ch_p1[idx]
                t1 = dn_ch_t1[idx]
                slope = dn_ch_slope[idx]
                ch_width = dn_ch_width[idx]
                touches = dn_ch_touches[idx]
                is_broken = dn_ch_is_broken[idx]
                break_idx = dn_ch_break_idx[idx]

                l_color = color.rgba(255, 82, 82, 0.9)
                bg_color = color.rgba(255, 82, 82, 0.04)
                ls = line_style.SOLID
                lw = 2
                if is_broken:
                    l_color = color.rgba(120, 123, 134, 0.6)
                    bg_color = color.rgba(120, 123, 134, 0.02)
                    ls = line_style.DOTTED
                    lw = 1

                end_t: float = 0.0
                end_p_upper: float = 0.0
                if is_broken and break_idx >= 0:
                    cut_k = max(0, break_idx - 4)
                    end_t = self.time[cut_k]
                    end_p_upper = p1 + slope * float(i1 - cut_k)
                else:
                    end_t = self.time[0] + time_step * float(line_bars_ahead)
                    end_p_upper = p1 + slope * float(i1 + line_bars_ahead)

                ch_obj = Channel(
                    AbsolutePosition(t1, p1 - ch_width),
                    AbsolutePosition(end_t, end_p_upper - ch_width),
                    channel_width=ch_width,
                    line_style=ls,
                    line_width=lw,
                    line_color=l_color,
                    bg_color=bg_color,
                    middle_line_style=line_style.DOTTED,
                    middle_line_width=1,
                    middle_line_color=l_color
                )
                self.channel_slot.set(ch_obj)
                self.chart.draw(ch_obj)

                if show_labels:
                    status_txt = f"Down-Channel ({touches}x Touches)"
                    if is_broken:
                        status_txt = f"Broken Down-Channel ({touches}x)"
                    lbl_obj = LabelAbs(
                        status_txt,
                        AbsolutePosition(end_t, end_p_upper - ch_width * 0.5),
                        font_size=11,
                        text_color=l_color,
                        bg_color=color.rgba(0, 0, 0, 0.01),
                        callout_position=callout_position.BOTTOM_RIGHT
                    )
                    self.channel_lbl.set(lbl_obj)
                    self.chart.draw(lbl_obj)

        return
