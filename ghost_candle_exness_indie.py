# indie:lang_version = 5
# Forex ADR Volatility & Institutional HUD for Exness Web Terminal & TakeProfit
# Fixed Upper/Lower ADR Boundaries, Clean ATR Volatility Metrics & ADX Trend Regime
# Zero Flicker Architecture (Pattern 3 In-Place Update, Zero Erase)
# Multi-Timeframe Adaptive (1m to 1Y, 4h), Max 5 Significant Digits

from math import isnan
from indie import indicator, param, color, line_style, MainContext
from indie.drawings import LineSegment, LabelAbs, AbsolutePosition, callout_position

def fmt_5sig(val: float) -> str:
    """Format price to maximum 5 significant digits (front and back of comma combined)."""
    if isnan(val):
        return '0'
    abs_v = abs(val)
    if abs_v == 0.0:
        return '0'
    int_part = int(abs_v)
    int_len = len(str(int_part))
    if int_len >= 5:
        return str(int(round(val)))
    dec_places = 5 - int_len
    rounded = round(val, dec_places)
    s = str(rounded)
    if '.' in s:
        parts = s.split('.')
        dec = parts[1][:dec_places]
        return parts[0] + ('.' + dec if len(dec) > 0 else '')
    return s

@indicator('Forex ADR Volatility & Institutional HUD', overlay_main_pane=True)
@param.int('adr_period', default=14, min=2, max=50, title='ADR Lookback Period')
@param.float('adr_mult', default=1.0, min=0.1, max=5.0, step=0.1, title='ADR Range Multiplier')
@param.int('line_bars', default=6, min=1, max=30, title='Line Extension (Bars Ahead)')
@param.bool('start_from_prev_bar', default=True, title='Start From Previous Close Bar')
@param.bool('show_hud', default=True, title='Show Institutional HUD')
class Main(MainContext):
    def __init__(self):
        # Persistent drawing objects created ONCE in __init__ (Pattern 3 in TakeProfit Indie)
        # Reusing identical instances with in-place position updates eliminates canvas DOM destruction,
        # completely preventing any flickering/blinking (100% fixed & rock solid).
        dummy_pos = AbsolutePosition(0.0, 0.0)
        pure_trans = color.rgba(0, 0, 0, 0.01)

        # 1. Upper Dotted Line (ADR High / Bullish TP Target)
        self.line_high = LineSegment(
            dummy_pos, dummy_pos,
            color=color.rgba(38, 166, 154, 0.85),
            line_style=line_style.DOTTED,
            line_width=1
        )

        # 2. Lower Dotted Line (ADR Low / Bearish TP Target)
        self.line_low = LineSegment(
            dummy_pos, dummy_pos,
            color=color.rgba(239, 83, 80, 0.85),
            line_style=line_style.DOTTED,
            line_width=1
        )

        # 3. Upper ADR High Badge (Truly Transparent, Floating Text)
        self.lbl_high = LabelAbs(
            "",
            dummy_pos,
            font_size=10,
            text_color=color.rgba(38, 166, 154, 1.0),
            bg_color=pure_trans,
            callout_position=callout_position.TOP_RIGHT
        )

        # 4. Lower ADR Low Badge (Truly Transparent, Floating Text)
        self.lbl_low = LabelAbs(
            "",
            dummy_pos,
            font_size=10,
            text_color=color.rgba(239, 83, 80, 1.0),
            bg_color=pure_trans,
            callout_position=callout_position.BOTTOM_RIGHT
        )

        # 5. Institutional Multi-Metric HUD Badge (Center Position, Floating Gold Text)
        self.lbl_hud = LabelAbs(
            "",
            dummy_pos,
            font_size=10,
            text_color=color.rgba(255, 179, 0, 1.0),
            bg_color=pure_trans,
            callout_position=callout_position.TOP_RIGHT
        )

    def calc(self, adr_period: int, adr_mult: float, line_bars: int, start_from_prev_bar: bool, show_hud: bool):
        # 1. Expand series ring buffer capacity on EVERY bar
        req_size = 150
        self.high.request_size(req_size)
        self.low.request_size(req_size)
        self.close.request_size(req_size)
        self.time.request_size(req_size)

        avail_bars = self.bar_index + 1
        if avail_bars < 20:
            return

        # 2. Only calculate and draw on the latest bar
        if not self.is_last_bar:
            return

        # 3. Context Coordinates & Time Step
        curr_time = self.time[0]
        prev_time = self.time[1]
        time_step = curr_time - prev_time
        if time_step <= 0.0:
            time_step = 60.0

        # 4. Reference Anchor: strictly locked to PREVIOUS completed candle close (self.close[1])
        ref_close = self.close[1]

        # 5. Compute ATR, +DM, -DM across completed historical bars (1 .. safe_period)
        safe_period = adr_period
        if safe_period > avail_bars - 3:
            safe_period = avail_bars - 3
        if safe_period < 2:
            safe_period = 2

        tr_sum = 0.0
        plus_dm_sum = 0.0
        minus_dm_sum = 0.0

        for k in range(1, safe_period + 1):
            h_k = self.high[k]
            l_k = self.low[k]
            c_prev = self.close[k + 1]

            tr1 = h_k - l_k
            tr2 = abs(h_k - c_prev)
            tr3 = abs(l_k - c_prev)

            tr = tr1
            if tr2 > tr:
                tr = tr2
            if tr3 > tr:
                tr = tr3
            tr_sum += tr

            h_prev = self.high[k + 1]
            l_prev = self.low[k + 1]
            up_move = h_k - h_prev
            down_move = l_prev - l_k

            if up_move > down_move and up_move > 0.0:
                plus_dm_sum += up_move
            if down_move > up_move and down_move > 0.0:
                minus_dm_sum += down_move

        atr_val = tr_sum / float(safe_period)
        adr_val = atr_val * adr_mult
        if adr_val <= 0.0:
            adr_val = ref_close * 0.01 * adr_mult
        if atr_val <= 0.0:
            atr_val = adr_val

        # 6. Directional Indicators (+DI, -DI, ADX/DX)
        plus_di = (plus_dm_sum / tr_sum * 100.0) if tr_sum > 0.0 else 0.0
        minus_di = (minus_dm_sum / tr_sum * 100.0) if tr_sum > 0.0 else 0.0
        di_diff = abs(plus_di - minus_di)
        di_sum = plus_di + minus_di
        adx_val = (di_diff / di_sum * 100.0) if di_sum > 0.0 else 0.0

        is_bullish = plus_di >= minus_di
        is_strong = adx_val >= 25.0
        is_chop = adx_val < 20.0

        # 7. Upper & Lower Volatility Levels (ADR Boundaries)
        ghost_high = ref_close + adr_val
        ghost_low = ref_close - adr_val
        if ghost_low < 0.00001:
            ghost_low = 0.00001

        pct_up = ((ghost_high - ref_close) / ref_close) * 100.0
        pct_down = ((ref_close - ghost_low) / ref_close) * 100.0

        s_ghost_high = fmt_5sig(ghost_high)
        s_ghost_low = fmt_5sig(ghost_low)

        # 8. Real-Time ADR Capacity Used Calculation
        curr_range = self.high[0] - self.low[0]
        used_ratio = curr_range / adr_val
        used_pct = round(used_ratio * 100.0, 1)
        s_ratio = str(round(used_ratio, 2))

        # 9. Geometry Coordinates
        line_start = prev_time if start_from_prev_bar else curr_time
        line_end = curr_time + time_step * float(line_bars)

        # 10. Update ADR Lines & Badges
        self.line_high.point_a = AbsolutePosition(line_start, ghost_high)
        self.line_high.point_b = AbsolutePosition(line_end, ghost_high)
        self.lbl_high.text = 'ADR High (+' + str(round(pct_up, 1)) + '%): ' + s_ghost_high
        self.lbl_high.position = AbsolutePosition(line_end, ghost_high)

        self.line_low.point_a = AbsolutePosition(line_start, ghost_low)
        self.line_low.point_b = AbsolutePosition(line_end, ghost_low)
        self.lbl_low.text = 'ADR Low (-' + str(round(pct_down, 1)) + '%): ' + s_ghost_low
        self.lbl_low.position = AbsolutePosition(line_end, ghost_low)

        # 11. Construct Institutional HUD String (Clean Text, Zero Icons/Emojis)
        if show_hud:
            # Line 1: ADR Capacity Gauge
            line1 = ''
            if used_pct >= 100.0:
                line1 = 'ADR Used: ' + str(used_pct) + '% (' + s_ratio + ' / 1.0 | Exhausted)'
            else:
                left_pct = str(round(100.0 - used_pct, 1))
                line1 = 'ADR Used: ' + str(used_pct) + '% (' + s_ratio + ' / 1.0 | Left: ' + left_pct + '%)'

            # Line 2: Trend Regime (ADX / DMI)
            s_adx = str(round(adx_val, 1))
            s_plus = str(round(plus_di, 1))
            s_minus = str(round(minus_di, 1))
            line2 = ''
            if is_chop:
                line2 = 'Trend: ADX ' + s_adx + ' [Chop / Sideways | Weak Momentum]'
            elif is_bullish:
                trend_tag = 'Strong Bullish' if is_strong else 'Moderate Bullish'
                line2 = 'Trend: ADX ' + s_adx + ' [' + trend_tag + ' | +DI: ' + s_plus + ', -DI: ' + s_minus + ']'
            else:
                trend_tag = 'Strong Bearish' if is_strong else 'Moderate Bearish'
                line2 = 'Trend: ADX ' + s_adx + ' [' + trend_tag + ' | -DI: ' + s_minus + ', +DI: ' + s_plus + ']'

            # Line 3: Volatility Metrics (Raw ATR-14 and 1.5x SL Buffer for Manual Entry)
            s_atr = fmt_5sig(atr_val)
            s_atr_buf = fmt_5sig(atr_val * 1.5)
            line3 = 'Volatility: ATR-14: ' + s_atr + ' | 1.5x SL Buffer: ' + s_atr_buf

            hud_text = line1 + '\n' + line2 + '\n' + line3
            self.lbl_hud.text = hud_text
            self.lbl_hud.position = AbsolutePosition(line_end, ref_close)
            self.chart.draw(self.lbl_hud)
        else:
            self.lbl_hud.text = ""
            self.chart.draw(self.lbl_hud)

        # 12. Render Fixed Lines & Badges
        self.chart.draw(self.line_high)
        self.chart.draw(self.line_low)
        self.chart.draw(self.lbl_high)
        self.chart.draw(self.lbl_low)

        return
