import {
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
import { CanvasRenderingTarget2D } from 'fancy-canvas';

export type StructureType = 'BOS' | 'CHoCH';
export type StructureDirection = 'bullish' | 'bearish';

export interface SwingPoint {
    index: number;
    time: Time;
    price: number;
    type: 'high' | 'low';
    isMajor: boolean;
    isStrong?: boolean;
    isWeak?: boolean;
    crossed: boolean;
}

export interface StructureBreakLine {
    id: string;
    type: StructureType;
    direction: StructureDirection;
    anchorIndex: number;
    breakIndex: number;
    anchorTime: Time;
    breakTime: Time;
    price: number;
    isMajor: boolean;
    isSweepOnly?: boolean;
}

export interface FvgBox {
    id: string;
    direction: StructureDirection;
    startIndex: number;
    startTime: Time;
    endIndex: number;
    endTime: Time;
    topPrice: number;
    bottomPrice: number;
    midPrice: number; // 50% Consequent Encroachment (CE)
    isMitigated: boolean;
    mitigatedIndex?: number;
}

export interface OrderBlockBox {
    id: string;
    direction: StructureDirection;
    startIndex: number;
    startTime: Time;
    endIndex: number;
    endTime: Time;
    topPrice: number;
    bottomPrice: number;
    isMitigated: boolean;
    mitigatedIndex?: number;
    inDiscountOrPremium: boolean;
}

export interface DealingRange {
    highPrice: number;
    lowPrice: number;
    equilibriumPrice: number;
    highIndex: number;
    lowIndex: number;
}

export interface MarketStructureData {
    swings: SwingPoint[];
    breaks: StructureBreakLine[];
    fvgs: FvgBox[];
    orderBlocks: OrderBlockBox[];
    dealingRange?: DealingRange;
    currentTrend: 'bullish' | 'bearish';
    lastBarIndex: number;
    showZigzag: boolean;
    showFvg: boolean;
    showOrderBlocks: boolean;
    showDealingRange: boolean;
    breakConfirmationMode: 'close' | 'wick';
    isIndex?: boolean;
    isForex?: boolean;
    pricePrecision?: number;
    ticker?: string;
}

export interface MarketStructureOptions {
    minorLookback?: number;       // default: 4
    majorLookback?: number;       // default: 15
    fvgAtrMultiplier?: number;    // default: 0.25
    showZigzag?: boolean;         // default: true
    showFvg?: boolean;            // default: true
    showOrderBlocks?: boolean;    // default: true
    showDealingRange?: boolean;   // default: true
    breakMode?: 'close' | 'wick'; // default: 'close'
    basePip?: number;
    touchTolerance?: number;
    pricePrecision?: number;
    isIndex?: boolean;
    isForex?: boolean;
    ticker?: string;
}

/**
 * Helper to format price cleanly based on asset type
 */
function formatPriceString(price: number, isIndex?: boolean, isForex?: boolean, ticker?: string, precision?: number): string {
    const sym = (ticker || '').toUpperCase();
    if (sym.includes('XAU') || sym.includes('GOLD')) {
        return '$' + price.toFixed(2);
    }
    if (isIndex) {
        return price.toFixed(2);
    }
    if (isForex) {
        return price.toFixed(precision ?? 4);
    }
    // IDX Regular Equities
    if (price >= 1000) {
        return Math.round(price).toLocaleString();
    }
    return Math.round(price).toString();
}

/**
 * High-performance deterministic market structure detection engine.
 * Implements:
 *   - Dynamic Uncrossed Swing Stack (prevents all-time extreme freezing)
 *   - Type 1 Candle Body Close BOS / CHoCH
 *   - Type 2 Wick Liquidity Sweeps
 *   - High-Probability Order Blocks strictly in Discount (<50% EQ) or Premium (>50% EQ)
 *   - Touch-bar Order Block & FVG mitigation termination
 *   - Strong Low (SL) & Weak High (TP) actionable levels
 */
export function detectMarketStructure(
    candles: any[],
    options: MarketStructureOptions = {}
): MarketStructureData {
    const minorLen = options.minorLookback ?? 4;
    const majorLen = options.majorLookback ?? 15;
    const n = candles.length;

    const basePip = options.basePip ?? 1.0;
    const touchTol = options.touchTolerance ?? (options.isIndex ? 0.20 : 0.50);

    if (n < 10) {
        return {
            swings: [],
            breaks: [],
            fvgs: [],
            orderBlocks: [],
            currentTrend: 'bullish',
            lastBarIndex: Math.max(0, n - 1),
            showZigzag: true,
            showFvg: true,
            showOrderBlocks: true,
            showDealingRange: true,
            breakConfirmationMode: 'close',
            isIndex: options.isIndex,
            isForex: options.isForex,
            pricePrecision: options.pricePrecision,
            ticker: options.ticker,
        };
    }

    // 1. Calculate ATR(14) using Float32Array buffer
    const atrs = new Float32Array(n);
    let trSum = 0;
    for (let i = 0; i < n; i++) {
        const cur = candles[i];
        const prev = i > 0 ? candles[i - 1] : cur;
        const tr = Math.max(
            cur.high - cur.low,
            Math.abs(cur.high - prev.close),
            Math.abs(cur.low - prev.close)
        );
        if (i < 14) {
            trSum += tr;
            atrs[i] = trSum / (i + 1);
        } else {
            atrs[i] = (atrs[i - 1] * 13 + tr) / 14;
        }
    }

    // 2. Identify Fractal Swing Points (bounded to recent 400 bars for 60 FPS)
    const scanStart = Math.max(0, n - 400);
    const candidateSwings: SwingPoint[] = [];

    for (let i = scanStart + minorLen; i < n - minorLen; i++) {
        const cur = candles[i];
        // Flat dormant candle suppression (cur.high === cur.low skipped, eliminates 159 fake pivots at Rp 50)
        if (cur.high === cur.low) continue;

        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= minorLen; j++) {
            if (candles[i - j].high > cur.high || candles[i + j].high > cur.high) isHigh = false;
            if (candles[i - j].low < cur.low || candles[i + j].low < cur.low) isLow = false;
            if (!isHigh && !isLow) break;
        }

        if (isHigh) {
            let isMajorHigh = true;
            if (i >= majorLen && i < n - majorLen) {
                for (let j = 1; j <= majorLen; j++) {
                    if (candles[i - j].high > cur.high || candles[i + j].high > cur.high) {
                        isMajorHigh = false;
                        break;
                    }
                }
            } else {
                isMajorHigh = false;
            }
            candidateSwings.push({
                index: i,
                time: cur.time,
                price: cur.high,
                type: 'high',
                isMajor: isMajorHigh,
                crossed: false,
            });
        }

        if (isLow) {
            let isMajorLow = true;
            if (i >= majorLen && i < n - majorLen) {
                for (let j = 1; j <= majorLen; j++) {
                    if (candles[i - j].low < cur.low || candles[i + j].low < cur.low) {
                        isMajorLow = false;
                        break;
                    }
                }
            } else {
                isMajorLow = false;
            }
            candidateSwings.push({
                index: i,
                time: cur.time,
                price: cur.low,
                type: 'low',
                isMajor: isMajorLow,
                crossed: false,
            });
        }
    }

    candidateSwings.sort((a, b) => a.index - b.index);

    // Filter candidate swings into strictly alternating Zigzag (High -> Low -> High -> Low)
    const alternatingSwings: SwingPoint[] = [];
    for (const sw of candidateSwings) {
        if (alternatingSwings.length === 0) {
            alternatingSwings.push({ ...sw });
        } else {
            const last = alternatingSwings[alternatingSwings.length - 1];
            if (last.type === sw.type) {
                // Keep more extreme point
                if (sw.type === 'high' && sw.price > last.price) {
                    alternatingSwings[alternatingSwings.length - 1] = { ...sw };
                } else if (sw.type === 'low' && sw.price < last.price) {
                    alternatingSwings[alternatingSwings.length - 1] = { ...sw };
                }
            } else {
                alternatingSwings.push({ ...sw });
            }
        }
    }

    // 3. Dynamic Uncrossed Structural Swing Stack & Event State Machine
    let trend: 'bullish' | 'bearish' = 'bullish';
    const uncrossedHighs: SwingPoint[] = [];
    const uncrossedLows: SwingPoint[] = [];
    const structureBreaks: StructureBreakLine[] = [];
    const rawOrderBlocks: OrderBlockBox[] = [];

    const breakMode = options.breakMode ?? 'close';

    // Map swings by confirmation index (swing confirmed at sw.index + minorLen)
    const swingByConfirmIndex = new Map<number, SwingPoint>();
    for (const sw of alternatingSwings) {
        swingByConfirmIndex.set(sw.index + minorLen, sw);
    }

    let activeStrongLow: SwingPoint | null = null;
    let lastDealingRangeLow = 0;
    let lastDealingRangeHigh = 0;

    for (let i = scanStart; i < n; i++) {
        const c = candles[i];

        // Register any newly confirmed swing
        const newlyConfirmed = swingByConfirmIndex.get(i);
        if (newlyConfirmed) {
            if (newlyConfirmed.type === 'high') {
                uncrossedHighs.push(newlyConfirmed);
            } else {
                uncrossedLows.push(newlyConfirmed);
            }
        }

        // Test Bullish Break against immediate most recent uncrossed High
        if (uncrossedHighs.length > 0) {
            const recentHigh = uncrossedHighs[uncrossedHighs.length - 1];
            if (i > recentHigh.index) {
                const isBreak = breakMode === 'close'
                    ? (c.close > recentHigh.price)
                    : (c.high > recentHigh.price);
                const isSweep = c.high > recentHigh.price && c.close <= recentHigh.price;

                if (isBreak) {
                    const brkType: StructureType = trend === 'bullish' ? 'BOS' : 'CHoCH';
                    recentHigh.crossed = true;
                    recentHigh.isWeak = true; // Target reached
                    uncrossedHighs.pop();

                    structureBreaks.push({
                        id: `brk-bull-${recentHigh.index}-${i}`,
                        type: brkType,
                        direction: 'bullish',
                        anchorIndex: recentHigh.index,
                        breakIndex: i,
                        anchorTime: recentHigh.time,
                        breakTime: c.time,
                        price: recentHigh.price,
                        isMajor: recentHigh.isMajor,
                        isSweepOnly: false,
                    });

                    // Strong Low is the lowest low point of the pullback wave preceding this breakout
                    let minLowPrice = Infinity;
                    let minLowIndex = recentHigh.index;
                    for (let k = recentHigh.index; k <= i; k++) {
                        if (candles[k].low < minLowPrice) {
                            minLowPrice = candles[k].low;
                            minLowIndex = k;
                        }
                    }

                    // Locate and mark the Strong Low swing point
                    const matchedLow = alternatingSwings.find(s => s.type === 'low' && Math.abs(s.index - minLowIndex) <= 2);
                    if (matchedLow) {
                        matchedLow.isStrong = true;
                        activeStrongLow = matchedLow;
                    }

                    lastDealingRangeLow = minLowPrice;
                    lastDealingRangeHigh = c.high;
                    const eq = (lastDealingRangeLow + lastDealingRangeHigh) / 2.0;

                    // Locate High-Probability Demand Order Block in the impulse leg
                    // Must reside strictly in the DISCOUNT ZONE (< 50% Equilibrium)
                    for (let k = i - 1; k >= Math.max(recentHigh.index, 0); k--) {
                        if (candles[k].close < candles[k].open) { // last down-close candle
                            const obTop = candles[k].high;
                            const obBot = candles[k].low;

                            if (obTop < eq) { // Valuation Filter: Discount Zone only!
                                // Check subsequent mitigation
                                let isMitigated = false;
                                let mitigatedIdx = n - 1;
                                for (let m = k + 1; m < n; m++) {
                                    if (candles[m].low <= obTop) {
                                        isMitigated = true;
                                        mitigatedIdx = m;
                                        break;
                                    }
                                }

                                rawOrderBlocks.push({
                                    id: `ob-bull-${k}`,
                                    direction: 'bullish',
                                    startIndex: k,
                                    startTime: candles[k].time,
                                    endIndex: isMitigated ? mitigatedIdx : n - 1,
                                    endTime: candles[isMitigated ? mitigatedIdx : n - 1].time,
                                    topPrice: obTop,
                                    bottomPrice: obBot,
                                    isMitigated,
                                    mitigatedIndex: isMitigated ? mitigatedIdx : undefined,
                                    inDiscountOrPremium: true,
                                });
                                break;
                            }
                        }
                    }

                    trend = 'bullish';
                } else if (isSweep && (c.high - recentHigh.price >= touchTol)) {
                    // Check if already swept on this anchor to prevent duplicate SW+BOS
                    const alreadySwept = structureBreaks.some(
                        b => b.anchorIndex === recentHigh.index && b.isSweepOnly
                    );
                    if (!alreadySwept) {
                        structureBreaks.push({
                            id: `sweep-bull-${recentHigh.index}-${i}`,
                            type: 'BOS',
                            direction: 'bullish',
                            anchorIndex: recentHigh.index,
                            breakIndex: i,
                            anchorTime: recentHigh.time,
                            breakTime: c.time,
                            price: recentHigh.price,
                            isMajor: recentHigh.isMajor,
                            isSweepOnly: true,
                        });
                    }
                }
            }
        }

        // Test Bearish Break against immediate most recent uncrossed Low
        if (uncrossedLows.length > 0) {
            const recentLow = uncrossedLows[uncrossedLows.length - 1];
            if (i > recentLow.index) {
                const isBreak = breakMode === 'close'
                    ? (c.close < recentLow.price)
                    : (c.low < recentLow.price);
                const isSweep = c.low < recentLow.price && c.close >= recentLow.price;

                if (isBreak) {
                    const brkType: StructureType = trend === 'bearish' ? 'BOS' : 'CHoCH';
                    recentLow.crossed = true;
                    recentLow.isWeak = true; // Target reached
                    uncrossedLows.pop();

                    structureBreaks.push({
                        id: `brk-bear-${recentLow.index}-${i}`,
                        type: brkType,
                        direction: 'bearish',
                        anchorIndex: recentLow.index,
                        breakIndex: i,
                        anchorTime: recentLow.time,
                        breakTime: c.time,
                        price: recentLow.price,
                        isMajor: recentLow.isMajor,
                        isSweepOnly: false,
                    });

                    // Strong High is the highest high point of the rally wave preceding this breakdown
                    let maxHighPrice = -Infinity;
                    let maxHighIndex = recentLow.index;
                    for (let k = recentLow.index; k <= i; k++) {
                        if (candles[k].high > maxHighPrice) {
                            maxHighPrice = candles[k].high;
                            maxHighIndex = k;
                        }
                    }

                    const matchedHigh = alternatingSwings.find(s => s.type === 'high' && Math.abs(s.index - maxHighIndex) <= 2);
                    if (matchedHigh) {
                        matchedHigh.isStrong = true;
                    }

                    lastDealingRangeHigh = maxHighPrice;
                    lastDealingRangeLow = c.low;
                    const eq = (lastDealingRangeLow + lastDealingRangeHigh) / 2.0;

                    // Locate High-Probability Supply Order Block in the impulse leg
                    // Must reside strictly in the PREMIUM ZONE (> 50% Equilibrium)
                    for (let k = i - 1; k >= Math.max(recentLow.index, 0); k--) {
                        if (candles[k].close > candles[k].open) { // last up-close candle
                            const obTop = candles[k].high;
                            const obBot = candles[k].low;

                            if (obBot > eq) { // Valuation Filter: Premium Zone only!
                                let isMitigated = false;
                                let mitigatedIdx = n - 1;
                                for (let m = k + 1; m < n; m++) {
                                    if (candles[m].high >= obBot) {
                                        isMitigated = true;
                                        mitigatedIdx = m;
                                        break;
                                    }
                                }

                                rawOrderBlocks.push({
                                    id: `ob-bear-${k}`,
                                    direction: 'bearish',
                                    startIndex: k,
                                    startTime: candles[k].time,
                                    endIndex: isMitigated ? mitigatedIdx : n - 1,
                                    endTime: candles[isMitigated ? mitigatedIdx : n - 1].time,
                                    topPrice: obTop,
                                    bottomPrice: obBot,
                                    isMitigated,
                                    mitigatedIndex: isMitigated ? mitigatedIdx : undefined,
                                    inDiscountOrPremium: true,
                                });
                                break;
                            }
                        }
                    }

                    trend = 'bearish';
                } else if (isSweep && (recentLow.price - c.low >= touchTol)) {
                    const alreadySwept = structureBreaks.some(
                        b => b.anchorIndex === recentLow.index && b.isSweepOnly
                    );
                    if (!alreadySwept) {
                        structureBreaks.push({
                            id: `sweep-bear-${recentLow.index}-${i}`,
                            type: 'BOS',
                            direction: 'bearish',
                            anchorIndex: recentLow.index,
                            breakIndex: i,
                            anchorTime: recentLow.time,
                            breakTime: c.time,
                            price: recentLow.price,
                            isMajor: recentLow.isMajor,
                            isSweepOnly: true,
                        });
                    }
                }
            }
        }
    }

    // 4. 3-Bar Fair Value Gap (FVG) Detection with Pip & ATR Minimum Floor
    const fvgBoxes: FvgBox[] = [];
    const minAtrMult = options.fvgAtrMultiplier ?? 0.25;

    for (let i = scanStart + 2; i < n; i++) {
        const cur = candles[i];
        const prev2 = candles[i - 2];
        const minGap = Math.max(atrs[i] * minAtrMult, basePip * (options.isIndex ? 1.0 : 0.5));

        // Bullish FVG (Mitigasi saat harga pullback menembus masuk ke dalam gap)
        if (cur.low - prev2.high >= minGap) {
            const topPrice = cur.low;
            const bottomPrice = prev2.high;
            let isMitigated = false;
            let mitigatedIndex = n - 1;

            for (let k = i + 1; k < n; k++) {
                if (candles[k].low <= (topPrice - touchTol)) {
                    isMitigated = true;
                    mitigatedIndex = k;
                    break;
                }
            }

            fvgBoxes.push({
                id: `fvg-bull-${i}`,
                direction: 'bullish',
                startIndex: i - 1,
                startTime: candles[i - 1].time,
                endIndex: isMitigated ? mitigatedIndex : n - 1,
                endTime: candles[isMitigated ? mitigatedIndex : n - 1].time,
                topPrice,
                bottomPrice,
                midPrice: (topPrice + bottomPrice) / 2,
                isMitigated,
                mitigatedIndex: isMitigated ? mitigatedIndex : undefined,
            });
        }

        // Bearish FVG (Mitigasi saat harga rally menembus masuk ke dalam gap)
        if (prev2.low - cur.high >= minGap) {
            const topPrice = prev2.low;
            const bottomPrice = cur.high;
            let isMitigated = false;
            let mitigatedIndex = n - 1;

            for (let k = i + 1; k < n; k++) {
                if (candles[k].high >= (bottomPrice + touchTol)) {
                    isMitigated = true;
                    mitigatedIndex = k;
                    break;
                }
            }

            fvgBoxes.push({
                id: `fvg-bear-${i}`,
                direction: 'bearish',
                startIndex: i - 1,
                startTime: candles[i - 1].time,
                endIndex: isMitigated ? mitigatedIndex : n - 1,
                endTime: candles[isMitigated ? mitigatedIndex : n - 1].time,
                topPrice,
                bottomPrice,
                midPrice: (topPrice + bottomPrice) / 2,
                isMitigated,
                mitigatedIndex: isMitigated ? mitigatedIndex : undefined,
            });
        }
    }

    // 5. Pruning & Cleanliness Filtering:
    // Only keep at most 3 active unmitigated Order Blocks, and 3 active unmitigated FVGs.
    // Filter out mitigated boxes older than 15 bars to completely prevent "wall of boxes" clutter.
    const activeOrderBlocks = rawOrderBlocks
        .filter(ob => !ob.isMitigated || (ob.mitigatedIndex && (n - 1 - ob.mitigatedIndex) <= 15))
        .slice(-3);

    const activeFvgs = fvgBoxes
        .filter(fvg => !fvg.isMitigated || (fvg.mitigatedIndex && (n - 1 - fvg.mitigatedIndex) <= 15))
        .slice(-3);

    // 6. Scoped Dealing Range (Anchored from latest confirmed Strong Low to Current Candle)
    let dealingRange: DealingRange | undefined = undefined;
    if (lastDealingRangeLow > 0 && lastDealingRangeHigh > lastDealingRangeLow) {
        dealingRange = {
            highPrice: lastDealingRangeHigh,
            lowPrice: lastDealingRangeLow,
            equilibriumPrice: (lastDealingRangeHigh + lastDealingRangeLow) / 2.0,
            highIndex: n - 1,
            lowIndex: activeStrongLow ? activeStrongLow.index : scanStart,
        };
    }

    return {
        swings: alternatingSwings,
        breaks: structureBreaks,
        fvgs: activeFvgs,
        orderBlocks: activeOrderBlocks,
        dealingRange,
        currentTrend: trend,
        lastBarIndex: Math.max(0, n - 1),
        showZigzag: options.showZigzag ?? true,
        showFvg: options.showFvg ?? true,
        showOrderBlocks: options.showOrderBlocks ?? true,
        showDealingRange: options.showDealingRange ?? true,
        breakConfirmationMode: breakMode,
        isIndex: options.isIndex,
        isForex: options.isForex,
        pricePrecision: options.pricePrecision,
        ticker: options.ticker,
    };
}

// =============================================================================
// BACKGROUND RENDERER (zOrder: 'bottom')
// High-Probability Discount/Premium Order Blocks, FVGs, Dealing Range 50% EQ
// =============================================================================
export class MarketStructureBackgroundRenderer implements IPrimitivePaneRenderer {
    private _data: MarketStructureData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || !this._data) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            if (!visibleRange) return;

            const data = this._data!;
            const width = mediaSize.width;

            // -----------------------------------------------------------------
            // 1. Scoped Dealing Range: Premium vs Discount & 50% Equilibrium
            // -----------------------------------------------------------------
            if (data.showDealingRange && data.dealingRange) {
                const dr = data.dealingRange;
                const yHigh = this._series!.priceToCoordinate(dr.highPrice);
                const yLow = this._series!.priceToCoordinate(dr.lowPrice);
                const yEq = this._series!.priceToCoordinate(dr.equilibriumPrice);

                const xStartCoord = timeScale.logicalToCoordinate(dr.lowIndex as Logical);
                const xStart = xStartCoord !== null ? Math.max(0, xStartCoord) : 0;
                const rangeWidth = Math.max(10, width - xStart);

                if (yHigh !== null && yLow !== null && yEq !== null) {
                    ctx.save();
                    const topY = Math.min(yHigh, yLow);
                    const botY = Math.max(yHigh, yLow);

                    // Premium Zone (Soft Salmon Tint matching Ghost Candle Red)
                    ctx.fillStyle = 'rgba(239, 83, 80, 0.04)';
                    ctx.fillRect(xStart, topY, rangeWidth, Math.max(0, yEq - topY));

                    // Discount Zone (Soft Mint Tint matching Ghost Candle Green)
                    ctx.fillStyle = 'rgba(38, 166, 154, 0.04)';
                    ctx.fillRect(xStart, yEq, rangeWidth, Math.max(0, botY - yEq));

                    // 50% Equilibrium Dotted Line (Ghost Candle Gold #FFB300)
                    ctx.strokeStyle = 'rgba(255, 179, 0, 0.75)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(xStart, yEq);
                    ctx.lineTo(width, yEq);
                    ctx.stroke();

                    // Truly Transparent Floating EQ 50% Label
                    ctx.font = '10px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", monospace';
                    ctx.fillStyle = '#FFB300';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'bottom';
                    const eqLabel = `EQ 50% (${formatPriceString(dr.equilibriumPrice, data.isIndex, data.isForex, data.ticker, data.pricePrecision)})`;
                    ctx.fillText(eqLabel, Math.max(20, xStart + 8), yEq - 2);
                    ctx.restore();
                }
            }

            // -----------------------------------------------------------------
            // 2. High-Probability Order Block (OB) Zones with Transparent Badges
            // -----------------------------------------------------------------
            if (data.showOrderBlocks && data.orderBlocks.length > 0) {
                ctx.save();
                for (const ob of data.orderBlocks) {
                    if (ob.endIndex < visibleRange.from || ob.startIndex > visibleRange.to) continue;

                    const x1 = timeScale.logicalToCoordinate(ob.startIndex as Logical);
                    const x2 = timeScale.logicalToCoordinate(ob.endIndex as Logical);
                    const yTop = this._series!.priceToCoordinate(ob.topPrice);
                    const yBot = this._series!.priceToCoordinate(ob.bottomPrice);

                    if (x1 === null || yTop === null || yBot === null) continue;
                    const rx2 = x2 !== null ? x2 : width;
                    const boxW = Math.max(4, rx2 - x1);
                    const minY = Math.min(yTop, yBot);
                    const boxH = Math.max(2, Math.abs(yBot - yTop));

                    const isBull = ob.direction === 'bullish';
                    const fillColor = isBull
                        ? (ob.isMitigated ? 'rgba(38, 166, 154, 0.06)' : 'rgba(38, 166, 154, 0.16)')
                        : (ob.isMitigated ? 'rgba(239, 83, 80, 0.06)' : 'rgba(239, 83, 80, 0.16)');
                    const strokeColor = isBull ? '#26A69A' : '#EF5350';

                    ctx.fillStyle = fillColor;
                    ctx.fillRect(x1, minY, boxW, boxH);

                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 1;
                    ctx.setLineDash(ob.isMitigated ? [2, 2] : [3, 2]);
                    ctx.strokeRect(x1, minY, boxW, boxH);

                    // Transparent Floating Text Badge: +OB or -OB with Price Tag
                    ctx.font = 'bold 9px "JetBrains Mono", Inter, -apple-system, monospace';
                    ctx.fillStyle = strokeColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    const pStr = formatPriceString(isBull ? ob.topPrice : ob.bottomPrice, data.isIndex, data.isForex, data.ticker, data.pricePrecision);
                    const obText = `${isBull ? '+OB' : '-OB'} (${pStr})${ob.isMitigated ? ' [MIT]' : ''}`;
                    ctx.fillText(obText, x1 + 4, minY + 3);
                }
                ctx.restore();
            }

            // -----------------------------------------------------------------
            // 3. Translucent Fair Value Gap (FVG) Boxes with Transparent Badges
            // -----------------------------------------------------------------
            if (data.showFvg && data.fvgs.length > 0) {
                ctx.save();
                for (const fvg of data.fvgs) {
                    if (fvg.endIndex < visibleRange.from || fvg.startIndex > visibleRange.to) continue;

                    const x1 = timeScale.logicalToCoordinate(fvg.startIndex as Logical);
                    const x2 = timeScale.logicalToCoordinate(fvg.endIndex as Logical);
                    const yTop = this._series!.priceToCoordinate(fvg.topPrice);
                    const yBot = this._series!.priceToCoordinate(fvg.bottomPrice);
                    const yMid = this._series!.priceToCoordinate(fvg.midPrice);

                    if (x1 === null || yTop === null || yBot === null) continue;
                    const rx2 = x2 !== null ? x2 : width;
                    const boxW = Math.max(3, rx2 - x1);
                    const minY = Math.min(yTop, yBot);
                    const boxH = Math.max(1, Math.abs(yBot - yTop));

                    const isBull = fvg.direction === 'bullish';
                    const fillColor = isBull
                        ? (fvg.isMitigated ? 'rgba(38, 166, 154, 0.04)' : 'rgba(38, 166, 154, 0.12)')
                        : (fvg.isMitigated ? 'rgba(239, 83, 80, 0.04)' : 'rgba(239, 83, 80, 0.12)');
                    const strokeColor = isBull ? 'rgba(38, 166, 154, 0.50)' : 'rgba(239, 83, 80, 0.50)';

                    ctx.fillStyle = fillColor;
                    ctx.fillRect(x1, minY, boxW, boxH);

                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([]);
                    ctx.strokeRect(x1, minY, boxW, boxH);

                    // 50% Consequent Encroachment (CE) dashed midline
                    if (yMid !== null && !fvg.isMitigated) {
                        ctx.strokeStyle = isBull ? 'rgba(38, 166, 154, 0.70)' : 'rgba(239, 83, 80, 0.70)';
                        ctx.setLineDash([2, 3]);
                        ctx.beginPath();
                        ctx.moveTo(x1, yMid);
                        ctx.lineTo(x1 + boxW, yMid);
                        ctx.stroke();
                    }

                    // Floating Badge: +FVG or -FVG
                    ctx.font = '9px "JetBrains Mono", Inter, -apple-system, monospace';
                    ctx.fillStyle = isBull ? '#26A69A' : '#EF5350';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    ctx.fillText(`${isBull ? '+FVG' : '-FVG'}${fvg.isMitigated ? ' [MIT]' : ''}`, x1 + 4, minY + 2);
                }
                ctx.restore();
            }
        });
    }
}

// =============================================================================
// FOREGROUND RENDERER (zOrder: 'top')
// ZigZag legs, BOS / CHoCH lines, Strong Low (SL), Weak High (TP), Swing Dots
// =============================================================================
export class MarketStructureForegroundRenderer implements IPrimitivePaneRenderer {
    private _data: MarketStructureData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || !this._data) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx } = scope;
            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            if (!visibleRange) return;

            const data = this._data!;

            // -----------------------------------------------------------------
            // 1. Draw ZigZag Legs (Neutral Grey Dotted Trace)
            // -----------------------------------------------------------------
            if (data.showZigzag && data.swings.length >= 2) {
                ctx.save();
                ctx.strokeStyle = 'rgba(120, 123, 134, 0.45)';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();

                let started = false;
                for (const sw of data.swings) {
                    const x = timeScale.logicalToCoordinate(sw.index as Logical);
                    const y = this._series!.priceToCoordinate(sw.price);
                    if (x !== null && y !== null) {
                        if (!started) {
                            ctx.moveTo(x, y);
                            started = true;
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                }
                ctx.stroke();
                ctx.restore();
            }

            // -----------------------------------------------------------------
            // 2. Draw Horizontal BOS / CHoCH / SWEEP Lines with Transparent Floating Text
            // Zero boxes, zero borders, 1:1 Ghost Candle typography
            // -----------------------------------------------------------------
            if (data.breaks.length > 0) {
                for (const brk of data.breaks) {
                    if (brk.breakIndex < visibleRange.from || brk.anchorIndex > visibleRange.to) continue;

                    const x1 = timeScale.logicalToCoordinate(brk.anchorIndex as Logical);
                    const x2 = timeScale.logicalToCoordinate(brk.breakIndex as Logical);
                    const y = this._series!.priceToCoordinate(brk.price);
                    if (x1 === null || x2 === null || y === null) continue;

                    const isBull = brk.direction === 'bullish';
                    const isBOS = brk.type === 'BOS';
                    const isSweep = brk.isSweepOnly ?? false;

                    // Color: Mint Green for Bullish, Salmon Red for Bearish, Gold for Sweeps
                    const mainColor = isSweep ? '#FFB300' : (isBull ? '#26A69A' : '#EF5350');

                    ctx.save();
                    ctx.strokeStyle = mainColor;
                    ctx.lineWidth = brk.isMajor ? 1.6 : 1.2;
                    ctx.setLineDash(isSweep ? [2, 2] : (isBOS ? [4, 3] : []));

                    ctx.beginPath();
                    ctx.moveTo(x1, y);
                    ctx.lineTo(x2, y);
                    ctx.stroke();
                    ctx.restore();

                    // Truly Transparent Floating Text Label (Centered on line, NO BOX, NO BORDER)
                    ctx.save();
                    ctx.font = 'bold 10px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    ctx.fillStyle = mainColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';

                    const tagText = isSweep
                        ? 'SWEEP'
                        : `${isBull ? '+' : '-'}${brk.type}`;
                    const midX = (x1 + x2) / 2;

                    ctx.fillText(tagText, midX, y - 2);
                    ctx.restore();
                }
            }

            // -----------------------------------------------------------------
            // 3. Draw Swing Apex Dots & Actionable Badges (Strong Low SL, Weak High TP)
            // -----------------------------------------------------------------
            ctx.save();
            for (const sw of data.swings) {
                if (sw.index < visibleRange.from || sw.index > visibleRange.to) continue;

                const x = timeScale.logicalToCoordinate(sw.index as Logical);
                const y = this._series!.priceToCoordinate(sw.price);
                if (x === null || y === null) continue;

                const isHigh = sw.type === 'high';
                const dotColor = isHigh ? '#EF5350' : '#26A69A';

                ctx.fillStyle = dotColor;
                ctx.beginPath();
                ctx.arc(x, y, sw.isMajor ? 3.5 : 2.5, 0, Math.PI * 2);
                ctx.fill();

                if (sw.isMajor) {
                    ctx.strokeStyle = '#FFB300';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }

                // Actionable Risk Management Badges:
                // Strong Low: SL Invalidation level
                if (sw.isStrong && !isHigh) {
                    ctx.font = 'bold 9px "JetBrains Mono", Inter, monospace';
                    ctx.fillStyle = '#26A69A';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText('STRONG LOW (SL)', x, y + 5);
                }

                // Weak High: Primary TP Liquidity Target
                if (sw.isWeak && isHigh) {
                    ctx.font = 'bold 9px "JetBrains Mono", Inter, monospace';
                    ctx.fillStyle = '#FFB300';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText('WEAK HIGH (TP)', x, y - 5);
                }
            }
            ctx.restore();
        });
    }
}

// =============================================================================
// PANE VIEWS
// =============================================================================
class MarketStructureBackgroundPaneView implements IPrimitivePaneView {
    private _renderer: MarketStructureBackgroundRenderer;

    constructor(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new MarketStructureBackgroundRenderer(data, series, chart);
    }

    public update(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'bottom';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

class MarketStructureForegroundPaneView implements IPrimitivePaneView {
    private _renderer: MarketStructureForegroundRenderer;

    constructor(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new MarketStructureForegroundRenderer(data, series, chart);
    }

    public update(
        data: MarketStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

// =============================================================================
// MASTER PRIMITIVE CLASS
// =============================================================================
export class MarketStructurePrimitive implements ISeriesPrimitive<Time> {
    private _bgPaneView: MarketStructureBackgroundPaneView;
    private _fgPaneView: MarketStructureForegroundPaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _data: MarketStructureData | null = null;
    private _requestUpdate: (() => void) | null = null;

    constructor() {
        this._bgPaneView = new MarketStructureBackgroundPaneView(null, null, null);
        this._fgPaneView = new MarketStructureForegroundPaneView(null, null, null);
    }

    public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._requestUpdate = param.requestUpdate;
        this.updateAllViews();
        if (this._requestUpdate) this._requestUpdate();
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = null;
        this._bgPaneView.update(null, null, null);
        this._fgPaneView.update(null, null, null);
    }

    public updateAllViews(): void {
        this._bgPaneView.update(this._data, this._series, this._chart);
        this._fgPaneView.update(this._data, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._bgPaneView, this._fgPaneView];
    }

    public setData(data: MarketStructureData | null): void {
        this._data = data;
        this.updateAllViews();
        if (this._requestUpdate) {
            this._requestUpdate();
        } else if (this._series) {
            this._series.applyOptions({});
        }
    }

    public clearData(): void {
        this._data = null;
        this.updateAllViews();
        if (this._requestUpdate) {
            this._requestUpdate();
        } else if (this._series) {
            this._series.applyOptions({});
        }
    }
}
