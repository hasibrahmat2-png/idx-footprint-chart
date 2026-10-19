import type {
    ISeriesPrimitive,
    SeriesAttachedParameter,
    SeriesType,
    Time,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    PrimitivePaneViewZOrder,
    ISeriesApi,
    IChartApiBase,
    Logical,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/**
 * Format price to maximum 5 significant digits (front and back of comma combined).
 * Matches fmt_5sig from ghost_candle_exness_indie.py.
 */
export function fmt5sig(val: number): string {
    if (isNaN(val) || !isFinite(val)) return '0';
    const absV = Math.abs(val);
    if (absV === 0) return '0';
    const intPart = Math.floor(absV);
    const intLen = intPart === 0 ? 0 : intPart.toString().length;
    if (intLen >= 5) {
        return Math.round(val).toString();
    }
    const decPlaces = Math.max(0, 5 - intLen);
    const rounded = Number(val.toFixed(decPlaces));
    let s = rounded.toString();
    if (s.includes('.')) {
        const parts = s.split('.');
        const dec = parts[1].substring(0, decPlaces);
        return parts[0] + (dec.length > 0 ? '.' + dec : '');
    }
    return s;
}

/**
 * Formats volume numbers using Indonesian compact notation (rb, jt, m).
 * - Below 1,000: raw integer (e.g. '50', '500')
 * - 1,000 to <1,000,000: 'rb' (ribu, e.g. '100 rb', '590 rb')
 * - 1,000,000 to <1,000,000,000: 'jt' (juta, e.g. '1 jt', '1.5 jt')
 * - >= 1,000,000,000: 'm' (miliar, e.g. '1 m', '2.5 m')
 */
export function formatIndoVolume(val: number): string {
    if (isNaN(val) || !isFinite(val) || val <= 0) return '0';
    if (val >= 1_000_000_000) {
        const num = val / 1_000_000_000;
        const str = num >= 10 ? num.toFixed(1) : num.toFixed(2);
        const trimmed = parseFloat(str).toString();
        return `${trimmed} m`;
    }
    if (val >= 1_000_000) {
        const num = val / 1_000_000;
        const str = num >= 10 ? num.toFixed(1) : num.toFixed(2);
        const trimmed = parseFloat(str).toString();
        return `${trimmed} jt`;
    }
    if (val >= 1_000) {
        const num = val / 1_000;
        const str = num >= 10 ? num.toFixed(1) : num.toFixed(2);
        const trimmed = parseFloat(str).toString();
        return `${trimmed} rb`;
    }
    return Math.round(val).toString();
}

/**
 * IDX (Indonesian Stock Exchange) Fraksi Harga (Tick Size)
 * Below Rp200: Tick size is Rp1
 * Rp200 to <Rp500: Tick size is Rp2
 * Rp500 to <Rp2,000: Tick size is Rp5
 * Rp2,000 to <Rp5,000: Tick size is Rp10
 * Rp5,000 and above: Tick size is Rp25
 */
export function getIdxTickSize(price: number): number {
    if (price < 200) return 1;
    if (price < 500) return 2;
    if (price < 2000) return 5;
    if (price < 5000) return 10;
    return 25;
}

/**
 * Rounds a price to a valid IDX tick size.
 * @param price Raw price value
 * @param direction 'down' (floor) for ceiling limits (ARA), 'up' (ceil) for floor limits (ARB)
 */
export function roundToIdxTick(price: number, direction: 'down' | 'up' = 'down'): number {
    if (price <= 0) return 1;
    const tick = getIdxTickSize(price);
    let rounded = direction === 'down'
        ? Math.floor(price / tick) * tick
        : Math.ceil(price / tick) * tick;

    // Verify if the rounded price landed in another tick size band
    const finalTick = getIdxTickSize(rounded);
    if (finalTick !== tick) {
        rounded = direction === 'down'
            ? Math.floor(price / finalTick) * finalTick
            : Math.ceil(price / finalTick) * finalTick;
    }
    return rounded;
}

export interface IdxLimitResult {
    refClose: number;
    araPrice: number;
    arbPrice: number;
    araPercent: number;       // Statutory percentage (35, 25, 20) or ADR %
    arbPercent: number;       // Statutory percentage (15) or ADR %
    actualAraPercent: number; // Effective percentage after tick rounding
    actualArbPercent: number; // Effective percentage after tick rounding
    tickSize: number;
    isForex?: boolean;
    headerLabel?: string;
    upperLabel?: string;
    lowerLabel?: string;
    closeLabel?: string;
    watermarkUpper?: string;
    watermarkLower?: string;
}

/**
 * Calculates official IDX ARA & ARB boundaries from reference close price
 * Rules:
 * - Price <= Rp 200: ARA 35%, ARB 15% (price floor is Rp 1 across the exchange)
 * - > Rp 200 – Rp 5,000: ARA 25%, ARB 15%
 * - > Rp 5,000: ARA 20%, ARB 15%
 * - Minimum Floor: Rp 1 (no Rp 50 lock / FCA floor elimination)
 */
export function calculateIdxLimits(refClose: number): IdxLimitResult {
    let araPercent = 25;
    const arbPercent = 15;

    if (refClose <= 200) {
        araPercent = 35;
    } else if (refClose <= 5000) {
        araPercent = 25;
    } else {
        araPercent = 20;
    }

    const rawAra = refClose * (1 + araPercent / 100);
    const rawArb = refClose * (1 - arbPercent / 100);

    // Floor ARA to valid tick so price does NOT exceed the statutory percentage
    let araPrice = roundToIdxTick(rawAra, 'down');

    // Ceil ARB to valid tick so price does NOT fall below the statutory percentage
    let arbPrice = roundToIdxTick(rawArb, 'up');

    const tickSize = getIdxTickSize(refClose);

    // Ensure at least 1 tick movement if rounding results in reference price
    if (araPrice <= refClose) {
        araPrice = refClose + tickSize;
    }
    if (arbPrice >= refClose && refClose > 1) {
        arbPrice = refClose - tickSize;
    }

    // Minimum price floor is Rp 1 across the board (no Rp 50 lock / FCA floor)
    const minFloor = 1;
    if (arbPrice < minFloor) {
        arbPrice = minFloor;
    }

    const actualAraPercent = Number((((araPrice - refClose) / refClose) * 100).toFixed(2));
    const actualArbPercent = Number((((arbPrice - refClose) / refClose) * 100).toFixed(2));

    const sAraSign = actualAraPercent >= 0 ? '+' : '';
    const upperLabel = `ARA +${araPercent}%: ${araPrice} (${sAraSign}${actualAraPercent.toFixed(1)}%)`;
    const lowerLabel = `ARB -${arbPercent}%: ${arbPrice} (${actualArbPercent.toFixed(1)}%)`;

    return {
        refClose,
        araPrice,
        arbPrice,
        araPercent,
        arbPercent,
        actualAraPercent,
        actualArbPercent,
        tickSize,
        isForex: false,
        headerLabel: 'IDX ARA/ARB STATUTORY LIMITS',
        upperLabel,
        lowerLabel,
        closeLabel: `Close: ${refClose}`,
    };
}

/**
 * Computes 14-period Average True Range (ADR) from candlestick data.
 */
export function computeForexAdr(bars: any[], period: number = 14): number {
    if (!bars || bars.length < 2) return 0;
    const count = Math.min(period, bars.length - 1);
    let trSum = 0;
    for (let i = bars.length - count; i < bars.length; i++) {
        const bar = bars[i];
        const prev = bars[i - 1];
        const high = typeof bar.high === 'number' ? bar.high : bar.close;
        const low = typeof bar.low === 'number' ? bar.low : bar.close;
        const prevClose = typeof prev.close === 'number' ? prev.close : prev.open;
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trSum += tr;
    }
    return count > 0 ? trSum / count : 0;
}

/**
 * Calculates next day volatility projection for Forex / Commodities / Crypto based on ADR
 */
export function calculateForexLimits(refClose: number, adr: number, decimals: number = 4): IdxLimitResult {
    const safeAdr = adr > 0 ? adr : (refClose * 0.007);
    const rawHigh = refClose + safeAdr;
    const rawLow = Math.max(0.00001, refClose - safeAdr);
    const araPercent = refClose > 0 ? ((rawHigh - refClose) / refClose) * 100 : 0;
    const arbPercent = refClose > 0 ? ((refClose - rawLow) / refClose) * 100 : 0;

    const araPrice = Number(rawHigh.toFixed(decimals));
    const arbPrice = Number(rawLow.toFixed(decimals));
    const actualAraPercent = Number(araPercent.toFixed(2));
    const actualArbPercent = Number((-arbPercent).toFixed(2));

    const upperLabel = `ADR High (+${actualAraPercent.toFixed(1)}%): ${fmt5sig(araPrice)}`;
    const lowerLabel = `ADR Low (${actualArbPercent.toFixed(1)}%): ${fmt5sig(arbPrice)}`;

    return {
        refClose,
        araPrice,
        arbPrice,
        araPercent: actualAraPercent,
        arbPercent: Number(arbPercent.toFixed(2)),
        actualAraPercent,
        actualArbPercent,
        tickSize: Math.pow(10, -decimals),
        isForex: true,
        headerLabel: 'FOREX ADR VOLATILITY ENVELOPE',
        upperLabel,
        lowerLabel,
        closeLabel: `Close: ${fmt5sig(refClose)}`,
    };
}

export interface GhostCandleHudData {
    usedPct: number;
    usedRatio: number;
    leftPct: number;
    isExhausted: boolean;
    adxVal: number;
    plusDi: number;
    minusDi: number;
    isBullish: boolean;
    isStrong: boolean;
    isChop: boolean;
    atrVal: number;
    slBuffer: number;
    currVolume?: number;
    avgVolume20?: number;
    volumeUsedPct?: number;
    volumeLeftPct?: number;
    isVolumeBreakout?: boolean;
    isVolumeExhausted?: boolean;
    showHud: boolean;
    hudLine1: string;
    hudLine2: string;
    hudLine3: string;
    hudLine4?: string;
}

export interface GhostCandleData {
    targetBarIndex: number;
    refClose: number;
    limits: IdxLimitResult;
    // Volatility Envelope (ADR Boundaries matching ghost_candle_exness_indie.py)
    adrVal: number;
    adrHigh: number;
    adrLow: number;
    pctAdrHigh: number;
    pctAdrLow: number;
    sAdrHigh: string;
    sAdrLow: string;
    adrHighLabel: string;
    adrLowLabel: string;
    // Ghost Candle Body Bounds (ARA/ARB for Daily IHSG, ADR High/Low for Intraday & Forex)
    candleHigh: number;
    candleLow: number;
    symbol?: string;
    visible?: boolean;
    hud?: GhostCandleHudData;
    isForex?: boolean;
    lineBars?: number;
    startFromPrevBar?: boolean;
    currentActiveTf?: string;
}

/**
 * Calculates complete Ghost Candle and Institutional HUD metrics
 * across all timeframes (1m, 5m, 15m, 1h, 1D, etc.).
 * Includes Ceiling +1.0 ADR, Floor -1.0 ADR, and statutory ARA/ARB for IHSG.
 */
export function computeGhostCandleData(
    currentBars: any[],
    _cachedDailyBars: any[] | null,
    symbol: string,
    refClose: number,
    isForex: boolean,
    currentActiveTf: string,
    precision: number = 2
): GhostCandleData {
    const N = currentBars ? currentBars.length : 0;
    const targetBarIndex = N;

    // 1. Resolve timeframe reference close (strictly locked to PREVIOUS completed candle close)
    // Matches ghost_candle_exness_indie.py line 115: ref_close = self.close[1]
    let tfRefClose = refClose;
    if (currentActiveTf !== '1d' && N >= 2) {
        const prevBar = currentBars[N - 2];
        if (typeof prevBar.close === 'number' && prevBar.close > 0) {
            tfRefClose = prevBar.close;
        }
    } else if (currentActiveTf === '1d') {
        tfRefClose = refClose;
    }

    // 2. Compute ATR-14, +DM, -DM, and ADX-14 across completed historical bars (k = 1 .. safe_period) of current timeframe
    let trSum = 0;
    let plusDmSum = 0;
    let minusDmSum = 0;
    let safePeriod = 14;

    if (N >= 3) {
        safePeriod = Math.min(14, N - 2);
        const lastCompletedIdx = N - 2;
        for (let i = lastCompletedIdx; i > lastCompletedIdx - safePeriod && i >= 1; i--) {
            const bar = currentBars[i];
            const prev = currentBars[i - 1];
            const h = typeof bar.high === 'number' ? bar.high : bar.close;
            const l = typeof bar.low === 'number' ? bar.low : bar.close;
            const cPrev = typeof prev.close === 'number' ? prev.close : prev.open;
            const hPrev = typeof prev.high === 'number' ? prev.high : prev.close;
            const lPrev = typeof prev.low === 'number' ? prev.low : prev.close;

            const tr = Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev));
            trSum += tr;

            const upMove = h - hPrev;
            const downMove = lPrev - l;
            if (upMove > downMove && upMove > 0) {
                plusDmSum += upMove;
            }
            if (downMove > upMove && downMove > 0) {
                minusDmSum += downMove;
            }
        }
    }

    let atrVal = safePeriod > 0 ? (trSum / safePeriod) : (tfRefClose * 0.01);
    if (atrVal <= 0) atrVal = tfRefClose * 0.01;

    const plusDi = trSum > 0 ? (plusDmSum / trSum * 100) : 0;
    const minusDi = trSum > 0 ? (minusDmSum / trSum * 100) : 0;
    const diDiff = Math.abs(plusDi - minusDi);
    const diSum = plusDi + minusDi;
    const adxVal = diSum > 0 ? (diDiff / diSum * 100) : 0;

    const isBullish = plusDi >= minusDi;
    const isStrong = adxVal >= 25.0;
    const isChop = adxVal < 20.0;

    // 3. Timeframe-Adaptive Volatility Range (ADR / ATR Multiplier = 1.0)
    // Matches ghost_candle_exness_indie.py line 155: adr_val = atr_val * adr_mult
    const adrVal = atrVal;

    // 4. Volatility Levels (ADR Boundaries on Current Timeframe)
    // Matches ghost_candle_exness_indie.py lines 173-174:
    // ghost_high = ref_close + adr_val
    // ghost_low = ref_close - adr_val
    let adrHigh: number;
    let adrLow: number;
    let sAdrHigh: string;
    let sAdrLow: string;

    if (isForex) {
        adrHigh = Number((tfRefClose + adrVal).toFixed(precision));
        adrLow = Number(Math.max(0.00001, tfRefClose - adrVal).toFixed(precision));
        sAdrHigh = fmt5sig(adrHigh);
        sAdrLow = fmt5sig(adrLow);
    } else {
        // IHSG stocks: strictly round to valid IDX tick rules (min floor Rp 1)
        adrHigh = roundToIdxTick(tfRefClose + adrVal, 'down');
        adrLow = Math.max(1, roundToIdxTick(tfRefClose - adrVal, 'up'));
        sAdrHigh = adrHigh.toString();
        sAdrLow = adrLow.toString();
    }

    const pctAdrHigh = Number((((adrHigh - tfRefClose) / tfRefClose) * 100).toFixed(1));
    const pctAdrLow = Number((((tfRefClose - adrLow) / tfRefClose) * 100).toFixed(1));

    const sHighSign = pctAdrHigh >= 0 ? '+' : '';
    const adrHighLabel = `ADR High (${sHighSign}${pctAdrHigh.toFixed(1)}%): ${sAdrHigh}`;
    const adrLowLabel = `ADR Low (-${pctAdrLow.toFixed(1)}%): ${sAdrLow}`;

    // 5. Statutory ARA / ARB Limits (locked to statutory daily reference close for IHSG)
    const limits = isForex
        ? calculateForexLimits(tfRefClose, adrVal, precision)
        : calculateIdxLimits(refClose);

    // 6. Real-Time Capacity Used Calculation (Current Active Bar on Active Timeframe)
    // Matches ghost_candle_exness_indie.py lines 185-189:
    // curr_range = self.high[0] - self.low[0]
    // used_ratio = curr_range / adr_val
    let currRange = 0;
    if (N > 0) {
        const lastBar = currentBars[N - 1];
        const bh = typeof lastBar.high === 'number' ? lastBar.high : lastBar.close;
        const bl = typeof lastBar.low === 'number' ? lastBar.low : lastBar.close;
        currRange = Math.max(0, bh - bl);
    }

    const usedRatio = currRange / adrVal;
    const usedPct = Number((usedRatio * 100).toFixed(1));
    const leftPct = Number(Math.max(0, 100 - usedPct).toFixed(1));
    const isExhausted = usedPct >= 100;
    const sRatio = usedRatio.toFixed(2);

    // 6. Construct Institutional HUD String (Exact parity with ghost_candle_exness_indie.py)
    const line1 = isExhausted
        ? `ADR Used: ${usedPct.toFixed(1)}% (${sRatio} / 1.0 | Exhausted)`
        : `ADR Used: ${usedPct.toFixed(1)}% (${sRatio} / 1.0 | Left: ${leftPct.toFixed(1)}%)`;

    const sAdx = adxVal.toFixed(1);
    const sPlus = plusDi.toFixed(1);
    const sMinus = minusDi.toFixed(1);
    let line2 = '';
    if (isChop) {
        line2 = `Trend: ADX ${sAdx} [Chop / Sideways | Weak Momentum]`;
    } else if (isBullish) {
        const tag = isStrong ? 'Strong Bullish' : 'Moderate Bullish';
        line2 = `Trend: ADX ${sAdx} [${tag} | +DI: ${sPlus}, -DI: ${sMinus}]`;
    } else {
        const tag = isStrong ? 'Strong Bearish' : 'Moderate Bearish';
        line2 = `Trend: ADX ${sAdx} [${tag} | -DI: ${sMinus}, +DI: ${sPlus}]`;
    }

    const sAtr = isForex ? fmt5sig(atrVal) : (atrVal < 10 ? atrVal.toFixed(2) : Math.round(atrVal).toString());
    const sBuf = isForex ? fmt5sig(atrVal * 1.5) : (atrVal * 1.5 < 10 ? (atrVal * 1.5).toFixed(2) : Math.round(atrVal * 1.5).toString());
    const line3 = `Volatility: ATR-14: ${sAtr} | 1.5x SL Buffer: ${sBuf}`;

    // 7. Volume Capacity Gauge vs 20-Period Completed Candle SMA
    let currVolume = 0;
    if (N > 0) {
        const activeBar = currentBars[N - 1];
        if (activeBar && typeof activeBar.volume === 'number' && !isNaN(activeBar.volume)) {
            currVolume = Math.max(0, activeBar.volume);
        }
    }

    let volSum = 0;
    let volCount = 0;
    const volPeriod = 20;
    if (N >= 2) {
        const lastCompletedIdx = N - 2;
        const lookback = Math.min(volPeriod, lastCompletedIdx + 1);
        for (let i = lastCompletedIdx; i > lastCompletedIdx - lookback && i >= 0; i--) {
            const bar = currentBars[i];
            const v = bar && typeof bar.volume === 'number' && !isNaN(bar.volume) ? bar.volume : 0;
            volSum += v;
            volCount++;
        }
    }

    const avgVolume20 = volCount > 0 ? (volSum / volCount) : (currVolume > 0 ? currVolume : 1);
    const volRatio = avgVolume20 > 0 ? (currVolume / avgVolume20) : 0;
    const volumeUsedPct = Number((volRatio * 100).toFixed(1));
    const volumeLeftPct = Number(Math.max(0, 100 - volumeUsedPct).toFixed(1));
    const isVolumeBreakout = volumeUsedPct >= 100;

    const sCurrVol = formatIndoVolume(currVolume);
    const sAvgVol = formatIndoVolume(avgVolume20);
    const sVolUsed = Number.isInteger(volumeUsedPct) ? volumeUsedPct.toString() : volumeUsedPct.toFixed(1);
    const sVolLeft = Number.isInteger(volumeLeftPct) ? volumeLeftPct.toString() : volumeLeftPct.toFixed(1);

    const line4 = isVolumeBreakout
        ? `Volume: ${sVolUsed}% (${sCurrVol} / ${sAvgVol} | Breakout)`
        : `Volume: ${sVolUsed}% (${sCurrVol} / ${sAvgVol} | Left: ${sVolLeft}%)`;

    const hud: GhostCandleHudData = {
        usedPct,
        usedRatio,
        leftPct,
        isExhausted,
        adxVal,
        plusDi,
        minusDi,
        isBullish,
        isStrong,
        isChop,
        atrVal,
        slBuffer: atrVal * 1.5,
        currVolume,
        avgVolume20,
        volumeUsedPct,
        volumeLeftPct,
        isVolumeBreakout,
        isVolumeExhausted: isVolumeBreakout,
        showHud: true,
        hudLine1: line1,
        hudLine2: line2,
        hudLine3: line3,
        hudLine4: line4,
    };

    const isDaily = currentActiveTf.toLowerCase() === '1d';
    const isIhsgDaily = !isForex && isDaily;
    const candleHigh = isIhsgDaily ? limits.araPrice : adrHigh;
    const candleLow = isIhsgDaily ? limits.arbPrice : adrLow;

    return {
        targetBarIndex,
        refClose: tfRefClose,
        limits,
        adrVal,
        adrHigh,
        adrLow,
        pctAdrHigh,
        pctAdrLow,
        sAdrHigh,
        sAdrLow,
        adrHighLabel,
        adrLowLabel,
        candleHigh,
        candleLow,
        symbol,
        visible: true,
        hud,
        isForex,
        currentActiveTf,
        lineBars: 6,
        startFromPrevBar: true,
    };
}

class GhostCandlePaneRenderer implements IPrimitivePaneRenderer {
    private _data: GhostCandleData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: GhostCandleData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: GhostCandleData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || !this._data || this._data.visible === false) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;

            const timeScale = this._chart!.timeScale();
            const data = this._data!;
            const limits = data.limits;
            const isForex = data.isForex ?? false;

            // Resolve bar coordinates
            const lastIndex = data.targetBarIndex - 1;
            const prevIndex = Math.max(0, lastIndex - 1);

            const lastX = timeScale.logicalToCoordinate(lastIndex as Logical);
            const prevX = timeScale.logicalToCoordinate(prevIndex as Logical);

            let barSpacing = 42;
            if (lastX !== null && prevX !== null) {
                barSpacing = Math.abs(Number(lastX) - Number(prevX));
            }
            if (barSpacing <= 0) barSpacing = 42;

            const currX = lastX !== null ? Number(lastX) : (prevX !== null ? Number(prevX) + barSpacing : width - 200);
            const startX = data.startFromPrevBar !== false ? (prevX !== null ? Number(prevX) : currX - barSpacing) : currX;
            const lineBars = data.lineBars || 6;
            const endX = currX + barSpacing * lineBars;

            // If coordinates are completely off-screen, skip
            if (endX < -50 || startX > width + 50) return;

            // Coordinates for ADR High and Low (+1.0 ADR Ceiling / -1.0 ADR Floor)
            const yClose = this._series!.priceToCoordinate(data.refClose);
            const yAdrHigh = this._series!.priceToCoordinate(data.adrHigh);
            const yAdrLow = this._series!.priceToCoordinate(data.adrLow);

            if (yClose === null || yAdrHigh === null || yAdrLow === null) return;

            // For IHSG stocks: statutory ARA & ARB coordinates
            let yAra: number | null = null;
            let yArb: number | null = null;
            if (!isForex && limits) {
                yAra = this._series!.priceToCoordinate(limits.araPrice);
                yArb = this._series!.priceToCoordinate(limits.arbPrice);
            }

            // Coordinates for ghost candle body bounds
            // Rule: Daily IHSG candle is governed by ARA/ARB; all other timeframes (intraday & forex) are governed by ADR ceiling/floor
            const isDaily = (data.currentActiveTf || '').toLowerCase() === '1d';
            const isIhsgDaily = !isForex && isDaily;
            const yCandleHigh = isIhsgDaily && yAra !== null ? yAra : (this._series!.priceToCoordinate(data.candleHigh) ?? yAdrHigh);
            const yCandleLow = isIhsgDaily && yArb !== null ? yArb : (this._series!.priceToCoordinate(data.candleLow) ?? yAdrLow);

            // =========================================================================
            // 0. Dual-Tone Translucent Ghost Candle Body (Faded Green & Faded Red)
            // =========================================================================
            if (yCandleHigh !== null && yCandleLow !== null) {
                const nextX = timeScale.logicalToCoordinate(data.targetBarIndex as Logical);
                const candleX = nextX !== null ? Number(nextX) : currX + barSpacing;
                const candleW = Math.max(12, Math.min(38, barSpacing * 0.75));
                const candleLeft = candleX - candleW / 2;
                const candleRight = candleX + candleW / 2;

                const topCoord = Math.min(yCandleHigh, yClose);
                const bottomCoord = Math.max(yCandleLow, yClose);

                // Upper Block (Ghost Green)
                const upperHeight = yClose - topCoord;
                if (upperHeight > 0) {
                    const gradGreen = ctx.createLinearGradient(0, yClose, 0, topCoord);
                    gradGreen.addColorStop(0, 'rgba(38, 166, 154, 0.42)');
                    gradGreen.addColorStop(1, 'rgba(38, 166, 154, 0.05)');
                    ctx.fillStyle = gradGreen;
                    ctx.fillRect(candleLeft, topCoord, candleW, upperHeight);

                    ctx.save();
                    ctx.strokeStyle = 'rgba(38, 166, 154, 0.85)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeRect(candleLeft, topCoord, candleW, upperHeight);
                    ctx.restore();
                }

                // Lower Block (Ghost Red)
                const lowerHeight = bottomCoord - yClose;
                if (lowerHeight > 0) {
                    const gradRed = ctx.createLinearGradient(0, yClose, 0, bottomCoord);
                    gradRed.addColorStop(0, 'rgba(239, 83, 80, 0.42)');
                    gradRed.addColorStop(1, 'rgba(239, 83, 80, 0.05)');
                    ctx.fillStyle = gradRed;
                    ctx.fillRect(candleLeft, yClose, candleW, lowerHeight);

                    ctx.save();
                    ctx.strokeStyle = 'rgba(239, 83, 80, 0.85)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeRect(candleLeft, yClose, candleW, lowerHeight);
                    ctx.restore();
                }

                // Divider Line at Reference Close
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(candleLeft, yClose);
                ctx.lineTo(candleRight, yClose);
                ctx.stroke();

                // Center Anchor Pip
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(candleX, yClose, 2.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // Watermarks inside body and header tag
                if (candleW >= 24) {
                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.font = 'bold 9px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

                    if (upperHeight >= 20) {
                        ctx.fillStyle = 'rgba(38, 166, 154, 0.6)';
                        const wmUpper = isIhsgDaily ? `ARA +${limits?.araPercent ?? 25}%` : '+1.0 ADR';
                        ctx.fillText(wmUpper, candleX, topCoord + upperHeight / 2);
                    }
                    if (lowerHeight >= 20) {
                        ctx.fillStyle = 'rgba(239, 83, 80, 0.6)';
                        const wmLower = isIhsgDaily ? `ARB -${limits?.arbPercent ?? 15}%` : '-1.0 ADR';
                        ctx.fillText(wmLower, candleX, yClose + lowerHeight / 2);
                    }

                    // Top Header above candle
                    ctx.font = 'bold 8px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
                    ctx.textBaseline = 'bottom';
                    const headerTag = isIhsgDaily ? 'GHOST CANDLE (ARA/ARB)' : 'GHOST CANDLE (ADR)';
                    ctx.fillText(headerTag, candleX, topCoord - 4);
                    ctx.restore();
                }
            }

            // =========================================================================
            // 1. Dotted Lines (Short Projection: from startX to endX)
            // =========================================================================
            ctx.save();
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);

            // ADR High Dotted Line (Mint #26A69A) - Ceiling +1.0 ADR
            ctx.strokeStyle = 'rgba(38, 166, 154, 0.85)';
            ctx.beginPath();
            ctx.moveTo(startX, yAdrHigh);
            ctx.lineTo(endX, yAdrHigh);
            ctx.stroke();

            // ADR Low Dotted Line (Salmon #EF5350) - Floor -1.0 ADR
            ctx.strokeStyle = 'rgba(239, 83, 80, 0.85)';
            ctx.beginPath();
            ctx.moveTo(startX, yAdrLow);
            ctx.lineTo(endX, yAdrLow);
            ctx.stroke();

            // FOR IHSG STOCKS: ALSO DRAW SHORT DOTTED LINES FOR STATUTORY ARA & ARB
            if (!isForex && limits) {
                if (yAra !== null) {
                    ctx.strokeStyle = 'rgba(38, 166, 154, 0.85)';
                    ctx.beginPath();
                    ctx.moveTo(startX, yAra);
                    ctx.lineTo(endX, yAra);
                    ctx.stroke();
                }

                if (yArb !== null) {
                    ctx.strokeStyle = 'rgba(239, 83, 80, 0.85)';
                    ctx.beginPath();
                    ctx.moveTo(startX, yArb);
                    ctx.lineTo(endX, yArb);
                    ctx.stroke();
                }
            }
            ctx.restore();

            // =========================================================================
            // 2. Badges at Line End (Truly Transparent Floating Text, NO BOX, NO BORDER)
            // =========================================================================
            ctx.save();
            ctx.font = 'bold 10px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            // ADR High Badge (Mint #26A69A) - Truly Transparent Floating Text
            const adrHighText = data.adrHighLabel;
            const adrHighW = ctx.measureText(adrHighText).width;
            const adrHighX = Math.max(6, Math.min(width - adrHighW - 6, endX + 6));
            ctx.fillStyle = '#26A69A';
            ctx.fillText(adrHighText, adrHighX, yAdrHigh);

            // ADR Low Badge (Salmon #EF5350) - Truly Transparent Floating Text
            const adrLowText = data.adrLowLabel;
            const adrLowW = ctx.measureText(adrLowText).width;
            const adrLowX = Math.max(6, Math.min(width - adrLowW - 6, endX + 6));
            ctx.fillStyle = '#EF5350';
            ctx.fillText(adrLowText, adrLowX, yAdrLow);

            // FOR IHSG STOCKS: ALSO DRAW STATUTORY ARA & ARB BADGES
            if (!isForex && limits && yAra !== null && yArb !== null) {
                // ARA Badge (Mint #26A69A) - Truly Transparent Floating Text
                const araText = limits.upperLabel || `ARA +${limits.araPercent}%: ${limits.araPrice} (${limits.actualAraPercent >= 0 ? '+' : ''}${limits.actualAraPercent.toFixed(1)}%)`;
                const araW = ctx.measureText(araText).width;
                const araX = Math.max(6, Math.min(width - araW - 6, endX + 6));
                ctx.fillStyle = '#26A69A';
                ctx.fillText(araText, araX, yAra);

                // ARB Badge (Salmon #EF5350) - Truly Transparent Floating Text
                const arbText = limits.lowerLabel || `ARB -${limits.arbPercent}%: ${limits.arbPrice} (${limits.actualArbPercent.toFixed(1)}%)`;
                const arbW = ctx.measureText(arbText).width;
                const arbX = Math.max(6, Math.min(width - arbW - 6, endX + 6));
                ctx.fillStyle = '#EF5350';
                ctx.fillText(arbText, arbX, yArb);
            }

            // =========================================================================
            // 3. Multi-Metric Institutional HUD (Clean Gold Text, Zero Emojis)
            // Truly Transparent Floating Text (zero rectangular boxes, zero borders)
            // =========================================================================
            const hud = data.hud;
            if (hud && hud.showHud !== false) {
                const line1 = hud.hudLine1;
                const line2 = hud.hudLine2;
                const line3 = hud.hudLine3;
                const line4 = hud.hudLine4 || '';

                ctx.font = '10px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", monospace';
                const m1 = ctx.measureText(line1).width;
                const m2 = ctx.measureText(line2).width;
                const m3 = ctx.measureText(line3).width;
                const m4 = line4 ? ctx.measureText(line4).width : 0;
                const maxTextW = Math.max(m1, m2, m3, m4);

                const hudX = Math.max(6, Math.min(width - maxTextW - 6, endX + 6));
                const lineHeight = 15;

                ctx.fillStyle = '#FFB300';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';

                if (line4) {
                    ctx.fillText(line1, hudX, yClose - 1.5 * lineHeight);
                    ctx.fillText(line2, hudX, yClose - 0.5 * lineHeight);
                    ctx.fillText(line3, hudX, yClose + 0.5 * lineHeight);
                    ctx.fillText(line4, hudX, yClose + 1.5 * lineHeight);
                } else {
                    ctx.fillText(line1, hudX, yClose - lineHeight);
                    ctx.fillText(line2, hudX, yClose);
                    ctx.fillText(line3, hudX, yClose + lineHeight);
                }
            }

            ctx.restore();
        });
    }
}

class GhostCandlePaneView implements IPrimitivePaneView {
    private _renderer: GhostCandlePaneRenderer;

    constructor(
        data: GhostCandleData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new GhostCandlePaneRenderer(data, series, chart);
    }

    public update(
        data: GhostCandleData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }

    public renderer(): IPrimitivePaneRenderer {
        return this._renderer;
    }
}

export class GhostCandlePrimitive implements ISeriesPrimitive<Time> {
    private _data: GhostCandleData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _paneView: GhostCandlePaneView;

    constructor() {
        this._paneView = new GhostCandlePaneView(null, null, null);
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._paneView.update(this._data, this._series, this._chart);
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._paneView.update(null, null, null);
    }

    public setData(data: GhostCandleData | null): void {
        this._data = data;
        this.updateAllViews();
    }

    public updateAllViews(): void {
        this._paneView.update(this._data, this._series, this._chart);
        if (this._series) {
            try {
                (this._series as any).applyOptions({});
            } catch (_) {}
        }
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }
}
