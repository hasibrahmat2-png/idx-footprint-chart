# indie:lang_version = 5
# Automated Parallel Channels Engine for Exness Web Terminal & TakeProfit
# Ported directly from lightweight-charts-master (Bab 12 Standards, Phase 161, 163, 164)
# Intervening Dow Pivot High/Low Anchor C1, Return Line Touch Confluence,
# Dominant Market Structure Filter (Intact > Broken, Touch Confluence & EMA 20 Trend Bias)

from math import isnan
from indie import indicator, param, color, line_style, MainContext, Optional, Var
from indie.drawings import Channel, LabelAbs, AbsolutePosition, callout_position

@indicator('Auto Parallel Channels', overlay_main_pane=True)
@param.str('filter_mode', default='Intact Only', options=['Intact Only', 'All (Intact & Broken)'], title='Filter Mode')
@param.bool('show_channel', default=True, title='Show Dominant Parallel Channel')
@param.int('lookback', default=9, min=4, max=25, title='Pivot Window (Bars)')
@param.int('line_bars_ahead', default=8, min=1, max=30, title='Channel Extension (Bars Ahead)')
@param.bool('show_labels', default=True, title='Show Channel Status Badge')
class Main(MainContext):
    def __init__(self):
        # Persistent drawing slots for rollback safety and dynamic updates
        self.channel_slot = self.new_var(Optional[Channel]())
        self.label_slot = self.new_var(Optional[LabelAbs]())

    def calc(self, filter_mode: str, show_channel: bool, lookback: int,
             line_bars_ahead: int, show_labels: bool):
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

        # 1. Clean up previously drawn items (Erase-First pattern)
        if self.channel_slot.get() is not None:
            self.chart.erase(self.channel_slot.get().value())
            self.channel_slot.set(None)

        if self.label_slot.get() is not None:
            self.chart.erase(self.label_slot.get().value())
            self.label_slot.set(None)

        if not show_channel:
            return

        # 2. Dynamic Instrument Pip Scale & ATR-14 Volatility
        curr_price = self.close[0]
        base_pip: float = 0.0001
        touch_tol: float = 0.00012
        break_buf: float = 0.00025

        if curr_price > 50000.0:  # BTC/USD
            base_pip = 10.0
            touch_tol = 15.0
            break_buf = 25.0
        elif curr_price > 1000.0:  # Gold XAU/USD / IDX Indices
            base_pip = 1.0
            touch_tol = 1.2
            break_buf = 2.0
        elif curr_price > 20.0:  # JPY pairs / Silver XAG/USD
            base_pip = 0.01
            touch_tol = 0.012
            break_buf = 0.02
        else:  # Standard Forex pairs
            base_pip = 0.0001
            touch_tol = 0.00012
            break_buf = 0.00025

        # ATR-14
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

        # 3. Extract Dow Theory Pivot Lows (A) and Pivot Highs (B)
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

        # 4. Form Up-Channel Candidates (A1 -> A2 baseline, intervening pivot high C1)
        up_ch_i1: list[int] = []
        up_ch_p1: list[float] = []
        up_ch_t1: list[float] = []
        up_ch_slope: list[float] = []
        up_ch_width: list[float] = []
        up_ch_touches: list[int] = []
        up_ch_is_broken: list[bool] = []
        up_ch_break_idx: list[int] = []
        up_ch_last_touch: list[int] = []

        n_p_low = len(p_low_i)
        n_p_high = len(p_high_i)

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

                # Intervening Peak Anchor C1 Invariant: must be a verified pivot high between i2 and i1
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

                # Zero close penetration below lower baseline between anchors
                violated = False
                for k_vt in range(i2 + 1, i1):
                    rp = p1 + slope * float(i1 - k_vt)
                    if self.close[k_vt] < rp:
                        violated = True
                        break
                if violated:
                    continue

                # Forward tracking: return line touches, baseline touches, breaks
                tl_touches = 2
                ch_touches = 1  # C1
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

                    # Break test: close pierces below baseline
                    if c_fwd < rp_base - break_buf:
                        is_broken = True
                        break_idx = k_fwd
                        break

                    if h_fwd - rp_base > max_bounce:
                        max_bounce = h_fwd - rp_base

                    # Baseline touch
                    if (last_tl_touch - k_fwd >= 8) and (max_bounce >= max(0.65 * cur_atr, base_pip * 2.0)):
                        if (abs(l_fwd - rp_base) <= touch_tol) or (l_fwd <= rp_base and c_fwd >= rp_base):
                            tl_touches += 1
                            last_tl_touch = k_fwd
                            max_bounce = 0.0

                    # Return line touch
                    if abs(last_ch_touch - k_fwd) >= 6:
                        if (abs(h_fwd - rp_return) <= touch_tol) or (h_fwd >= rp_return and c_fwd <= rp_return):
                            ch_touches += 1
                            last_ch_touch = k_fwd

                total_touches = tl_touches + ch_touches
                # Return line confirmation: >= 2 touches on upper line OR >= 4 total touches
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

        # 5. Form Down-Channel Candidates (B1 -> B2 baseline, intervening pivot low C1)
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

                # Intervening Trough Anchor C1 Invariant: must be a verified pivot low between i2 and i1
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

                # Zero close penetration above upper baseline
                violated = False
                for k_vt in range(i2 + 1, i1):
                    rp = p1 + slope * float(i1 - k_vt)
                    if self.close[k_vt] > rp:
                        violated = True
                        break
                if violated:
                    continue

                tl_touches = 2
                ch_touches = 1  # C1
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

                    # Break test: close pierces above upper baseline
                    if c_fwd > rp_base + break_buf:
                        is_broken = True
                        break_idx = k_fwd
                        break

                    if rp_base - l_fwd > max_drop:
                        max_drop = rp_base - l_fwd

                    # Baseline touch
                    if (last_tl_touch - k_fwd >= 8) and (max_drop >= max(0.65 * cur_atr, base_pip * 2.0)):
                        if (abs(h_fwd - rp_base) <= touch_tol) or (h_fwd >= rp_base and c_fwd <= rp_base):
                            tl_touches += 1
                            last_tl_touch = k_fwd
                            max_drop = 0.0

                    # Return line touch
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

        # 6. Dominant Market Structure Selection Filter (Bab 12)
        intact_only = (filter_mode == 'Intact Only')

        # Select Best Up-Channel
        best_up_idx = -1
        for idx in range(len(up_ch_i1)):
            if intact_only and up_ch_is_broken[idx]:
                continue
            if best_up_idx < 0:
                best_up_idx = idx
                continue
            # Unbroken prioritized over broken
            a_brk = 1 if up_ch_is_broken[best_up_idx] else 0
            b_brk = 1 if up_ch_is_broken[idx] else 0
            if b_brk < a_brk:
                best_up_idx = idx
            elif b_brk == a_brk:
                if up_ch_touches[idx] > up_ch_touches[best_up_idx]:
                    best_up_idx = idx
                elif up_ch_touches[idx] == up_ch_touches[best_up_idx]:
                    if up_ch_last_touch[idx] < up_ch_last_touch[best_up_idx]:
                        best_up_idx = idx

        # Select Best Down-Channel
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
                elif dn_ch_touches[idx] == dn_ch_touches[best_dn_idx]:
                    if dn_ch_last_touch[idx] < dn_ch_last_touch[best_dn_idx]:
                        best_dn_idx = idx

        # Dominant Conflict Resolution: Pick single dominant channel
        chosen_type = ''  # 'up' or 'down'
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
                # Both intact OR both broken: check touches & EMA 20 bias
                up_tch = up_ch_touches[best_up_idx]
                dn_tch = dn_ch_touches[best_dn_idx]
                if up_tch >= dn_tch + 2:
                    chosen_type = 'up'
                elif dn_tch >= up_tch + 2:
                    chosen_type = 'down'
                else:
                    # Calculate EMA 20 over recent bars
                    ema_p = min(20, avail_bars)
                    k_ema = 2.0 / float(ema_p + 1)
                    cur_ema = self.close[ema_p - 1]
                    for idx_e in range(ema_p - 2, -1, -1):
                        cur_ema = self.close[idx_e] * k_ema + cur_ema * (1.0 - k_ema)
                    if self.close[0] >= cur_ema:
                        chosen_type = 'up'
                    else:
                        chosen_type = 'down'

        if chosen_type == '':
            return

        # 7. Render Dominant Channel
        time_step = self.time[0] - self.time[1]

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

            pos_a = AbsolutePosition(t1, p1)
            pos_b = AbsolutePosition(end_t, end_p)

            ch_obj = Channel(
                pos_a,
                pos_b,
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
                pos_lbl = AbsolutePosition(end_t, end_p + ch_width * 0.5)
                lbl_obj = LabelAbs(
                    status_txt,
                    pos_lbl,
                    font_size=11,
                    text_color=l_color,
                    bg_color=color.rgba(0, 0, 0, 0.01),
                    callout_position=callout_position.TOP_RIGHT
                )
                self.label_slot.set(lbl_obj)
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

            # In Indie Channel: point_a and point_b define the lower line segment with positive channel_width
            pos_a_lower = AbsolutePosition(t1, p1 - ch_width)
            pos_b_lower = AbsolutePosition(end_t, end_p_upper - ch_width)

            ch_obj = Channel(
                pos_a_lower,
                pos_b_lower,
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
                pos_lbl = AbsolutePosition(end_t, end_p_upper - ch_width * 0.5)
                lbl_obj = LabelAbs(
                    status_txt,
                    pos_lbl,
                    font_size=11,
                    text_color=l_color,
                    bg_color=color.rgba(0, 0, 0, 0.01),
                    callout_position=callout_position.BOTTOM_RIGHT
                )
                self.label_slot.set(lbl_obj)
                self.chart.draw(lbl_obj)

        return
