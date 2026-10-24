import { Time } from 'lightweight-charts';

export type PatternCategory = 'reversal' | 'continuation';

export type PatternType =
    | 'head_and_shoulders'
    | 'inverted_head_and_shoulders'
    | 'double_top'
    | 'double_bottom'
    | 'triple_top'
    | 'triple_bottom'
    | 'horn_top'
    | 'horn_bottom'
    | 'symmetrical_triangle'
    | 'ascending_triangle'
    | 'descending_triangle'
    | 'bullish_flag'
    | 'bearish_flag'
    | 'bullish_pennant'
    | 'bearish_pennant'
    | 'rising_wedge'
    | 'falling_wedge'
    | 'bullish_rectangle'
    | 'bearish_rectangle'
    | 'cup_and_handle';

export type ChartPatternMode = PatternType | 'all' | 'reversal' | 'continuation' | 'off';

export const REVERSAL_PATTERN_TYPES: PatternType[] = [
    'head_and_shoulders',
    'inverted_head_and_shoulders',
    'double_top',
    'double_bottom',
    'triple_top',
    'triple_bottom',
    'horn_top',
    'horn_bottom',
];

export const CONTINUATION_PATTERN_TYPES: PatternType[] = [
    'symmetrical_triangle',
    'ascending_triangle',
    'descending_triangle',
    'bullish_flag',
    'bearish_flag',
    'bullish_pennant',
    'bearish_pennant',
    'rising_wedge',
    'falling_wedge',
    'bullish_rectangle',
    'bearish_rectangle',
    'cup_and_handle',
];

export interface PatternAnchor {
    index: number;
    time: Time;
    price: number;
    label: string; // e.g. "LS", "H", "RS", "T1", "T2", "Apex", "Rim", "Cup Base"
}

export interface PatternLine {
    x1Time?: Time;
    y1Price: number;
    x2Time?: Time;
    y2Price: number;
    x1Index: number;
    x2Index: number;
    style: 'solid' | 'dashed' | 'dotted';
    role:
        | 'neckline'
        | 'upper_boundary'
        | 'lower_boundary'
        | 'flagpole'
        | 'target_ray'
        | 'connector'
        | 'measured_move'
        | 'box_wall'
        | 'cup_curve';
    color?: string;
    /** Optional quadratic Bezier control point for smooth U-shaped Cup curves */
    ctrlIndex?: number;
    ctrlPrice?: number;
}

export interface PatternPolygonPoint {
    index: number;
    time?: Time;
    price: number;
}

export interface DetectedChartPattern {
    id: string;
    category: PatternCategory;
    type: PatternType;
    name: string;
    direction: 'bullish' | 'bearish';
    status: 'forming' | 'breakout' | 'pullback' | 'target_reached' | 'failed';
    anchors: PatternAnchor[];
    lines: PatternLine[];
    /** Subtle polygon vertices used by the primitive renderer to shade the pattern interior */
    fillPolygon?: PatternPolygonPoint[];
    breakoutPrice?: number;
    breakoutTime?: Time;
    breakoutIndex?: number;
    targetPrice: number;
    targetPercent: number; // e.g. +14.2% or -8.5%
    volumeRatio: number; // breakout bar volume / SMA20 volume
    isVolumeConfirmed: boolean;
    specialFlag?: 'hound_of_baskervilles' | 'apex_approaching' | 'handle_deep';
    note?: string;
    startIndex: number;
    endIndex: number;
    qualityScore?: number;
}

interface SwingPoint {
    index: number;
    time: Time;
    price: number;
    type: 'high' | 'low';
}

/**
 * Safely resolve time at a given bar index (returns undefined when index projects beyond the last bar)
 */
function safeTime(candles: any[], idx: number): Time | undefined {
    if (idx >= 0 && idx < candles.length) {
        return candles[idx].time;
    }
    return undefined;
}

/**
 * Compute 14-period Average True Range (ATR) for volatility-normalized swing & pattern filtering.
 * Adapts automatically across any timeframe (1m, 5m, 1H, 1D) and asset class (XAUUSD, Forex, IDX).
 */
function computeAtr14(candles: any[]): Float64Array {
    const n = candles.length;
    const atr = new Float64Array(n);
    if (n === 0) return atr;

    let sumTr = 0;
    for (let i = 0; i < n; i++) {
        const cur = candles[i];
        const prevClose = i > 0 ? candles[i - 1].close : cur.open;
        const tr = Math.max(
            cur.high - cur.low,
            Math.abs(cur.high - prevClose),
            Math.abs(cur.low - prevClose)
        );
        if (i < 14) {
            sumTr += tr;
            atr[i] = sumTr / (i + 1);
        } else {
            atr[i] = (atr[i - 1] * 13 + tr) / 14;
        }
    }
    return atr;
}

/**
 * Compute 20-period Volume SMA
 */
function computeVolumeSma20(candles: any[]): Float64Array {
    const n = candles.length;
    const volSma = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const v = candles[i].volume || 0;
        sum += v;
        if (i < 20) {
            volSma[i] = sum / (i + 1);
        } else {
            sum -= candles[i - 20].volume || 0;
            volSma[i] = sum / 20;
        }
    }
    return volSma;
}

/**
 * Detect fractal alternating swing points (ZigZag) using pure ATR-normalized amplitude filtering.
 * Works identically on 5m Gold/Forex and Daily IDX stocks without arbitrary price-% distortion.
 */
function extractAlternatingSwings(
    candles: any[],
    atr: Float64Array,
    scanStart: number,
    n: number,
    lookback: number = 5
): SwingPoint[] {
    const rawSwings: SwingPoint[] = [];

    for (let i = scanStart + lookback; i < n - 2; i++) {
        const cur = candles[i];
        if (cur.high === cur.low) continue; // Flat dormant candle suppression (FCA Rp 1 filter)

        const rightSpan = Math.min(lookback, n - 1 - i);
        if (rightSpan < 2) continue;

        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= lookback; j++) {
            if (candles[i - j].high > cur.high) isHigh = false;
            if (candles[i - j].low < cur.low) isLow = false;
        }
        for (let j = 1; j <= rightSpan; j++) {
            if (candles[i + j].high > cur.high) isHigh = false;
            if (candles[i + j].low < cur.low) isLow = false;
        }

        if (isHigh) {
            rawSwings.push({ index: i, time: cur.time, price: cur.high, type: 'high' });
        }
        if (isLow) {
            rawSwings.push({ index: i, time: cur.time, price: cur.low, type: 'low' });
        }
    }

    rawSwings.sort((a, b) => a.index - b.index);

    // Strictly alternate High -> Low -> High -> Low keeping extreme pivots & folding micro-noise
    const alternating: SwingPoint[] = [];
    for (const sw of rawSwings) {
        if (alternating.length === 0) {
            alternating.push({ ...sw });
        } else {
            const last = alternating[alternating.length - 1];
            if (last.type === sw.type) {
                if (sw.type === 'high' && sw.price >= last.price) {
                    alternating[alternating.length - 1] = { ...sw };
                } else if (sw.type === 'low' && sw.price <= last.price) {
                    alternating[alternating.length - 1] = { ...sw };
                }
            } else {
                const localAtr = atr[sw.index] || Math.abs( curPriceFallback(candles, sw.index) * 0.005 );
                const minRequiredMove = localAtr * 1.15;
                const legMove = Math.abs(sw.price - last.price);

                if (legMove >= minRequiredMove) {
                    alternating.push({ ...sw });
                } else if (alternating.length >= 2) {
                    const prevSame = alternating[alternating.length - 2];
                    if (
                        (sw.type === 'high' && sw.price > prevSame.price) ||
                        (sw.type === 'low' && sw.price < prevSame.price)
                    ) {
                        alternating.pop();
                        alternating[alternating.length - 1] = { ...sw };
                    }
                }
            }
        }
    }

    return alternating;
}

function curPriceFallback(candles: any[], idx: number): number {
    return candles[idx]?.close || 1;
}

/**
 * Computes bearish measured-move target price.
 * For normal volatility (height <= 20% of breakout price), uses standard linear projection (breakPrice - height).
 * For high-volatility / wide-range swings (e.g. IDX stocks like BUMI where height is 35%-60% of price) or log-scale charts,
 * uses geometric/proportional projection: breakPrice * (breakPrice / (breakPrice + height)) so target is visually equal
 * on log charts and never projects unrealistic -65% crashes or negative prices.
 */
function calcBearishTarget(breakPrice: number, height: number): number {
    if (breakPrice <= 0 || height <= 0) return Math.max(0.0001, breakPrice - height);
    const ratio = height / breakPrice;
    if (ratio <= 0.20) {
        return Math.max(0.0001, breakPrice - height);
    }
    // Smooth geometric projection for wide swings
    return Math.max(0.0001, breakPrice * (breakPrice / (breakPrice + height)));
}

/**
 * Verify true structural Prior Major Trend before a Reversal pattern (Bab 21.1 requirement).
 * - For a Bottom Reversal (Double/Triple Bottom, Inverted H&S):
 *   The market before the first bottom B1 must have descended from a high that is ABOVE the pattern's
 *   Neckline by at least `0.25 * patternHeight`, and must NOT have come from a lower low below B1!
 *   (Prevents misclassifying a pullback inside an uptrend as a Double Bottom, as seen on XAUUSD 5m).
 * - For a Top Reversal (Double/Triple Top, H&S):
 *   The market before the first top T1 must have rallied from a low that is BELOW the pattern's
 *   Neckline by at least `0.25 * patternHeight`, and must NOT have come from a higher high above T1!
 */
function hasReversalPriorTrend(
    candles: any[],
    patternStartIndex: number,
    expectedPriorDirection: 'uptrend' | 'downtrend',
    necklinePrice: number,
    patternExtremePrice: number,
    patternHeight: number,
    lookbackBars: number = 35
): boolean {
    const fromIdx = Math.max(0, patternStartIndex - lookbackBars);
    if (patternStartIndex - fromIdx < 8) return false;

    let maxPriorHigh = -Infinity;
    let minPriorLow = Infinity;
    for (let i = fromIdx; i < patternStartIndex; i++) {
        if (candles[i].high > maxPriorHigh) maxPriorHigh = candles[i].high;
        if (candles[i].low < minPriorLow) minPriorLow = candles[i].low;
    }

    if (expectedPriorDirection === 'downtrend') {
        // Prior trend must be a genuine Downtrend coming from above the Neckline,
        // and B1 must be the lowest point (no significantly lower low in the prior window)
        const cameFromAboveNeckline = maxPriorHigh >= necklinePrice + patternHeight * 0.2;
        const isGenuineLow = minPriorLow >= patternExtremePrice - patternHeight * 0.15;
        return cameFromAboveNeckline && isGenuineLow;
    } else {
        // Prior trend must be a genuine Uptrend coming from below the Neckline,
        // and T1 must be the highest point (no significantly higher high in the prior window)
        const cameFromBelowNeckline = minPriorLow <= necklinePrice - patternHeight * 0.2;
        const isGenuineHigh = maxPriorHigh <= patternExtremePrice + patternHeight * 0.15;
        return cameFromBelowNeckline && isGenuineHigh;
    }
}

/**
 * Verify prior directional trend for Continuation patterns (Bab 21.2).
 */
function hasContinuationPriorTrend(
    candles: any[],
    atr: Float64Array,
    patternStartIndex: number,
    expectedDirection: 'uptrend' | 'downtrend',
    lookbackBars: number = 25,
    minAtrMultiple: number = 1.8
): boolean {
    const fromIdx = Math.max(0, patternStartIndex - lookbackBars);
    if (patternStartIndex - fromIdx < 6) return false;

    const startPrice = candles[patternStartIndex].close;
    const earlierPrice = candles[fromIdx].close;
    const refAtr = atr[patternStartIndex] || startPrice * 0.005;

    if (expectedDirection === 'uptrend') {
        return startPrice - earlierPrice >= refAtr * minAtrMultiple;
    } else {
        return earlierPrice - startPrice >= refAtr * minAtrMultiple;
    }
}

/**
 * Envelope Containment Check: Ensures intermediate candles between startIdx and endIdx
 * do not violate the upper or lower boundary lines during pattern formation.
 */
function isEnvelopeRespected(
    candles: any[],
    startIdx: number,
    endIdx: number,
    upperPriceAt: (idx: number) => number,
    lowerPriceAt: (idx: number) => number,
    maxHeightViolationRatio: number = 0.12
): boolean {
    for (let i = startIdx + 1; i < endIdx; i++) {
        const c = candles[i];
        if (!c) continue;
        const up = upperPriceAt(i);
        const lo = lowerPriceAt(i);
        const h = up - lo;
        if (h <= 0) return false;
        const tol = h * maxHeightViolationRatio;
        if (c.close > up + tol || c.close < lo - tol) return false;
        if (c.high > up + tol * 1.8 || c.low < lo - tol * 1.8) return false;
    }
    return true;
}

interface PatternLifecycleResult {
    status: DetectedChartPattern['status'];
    breakoutIndex?: number;
    breakoutPrice?: number;
    breakoutTime?: Time;
    volumeRatio: number;
    isVolumeConfirmed: boolean;
    failedAtIndex?: number;
    failedPrice?: number;
}

/**
 * Evaluates whether a detected pattern has broken out, reached its price target,
 * pulled back for a throwback retest, or failed/invalidated based on subsequent bars.
 */
function evaluatePatternLifecycle(
    candles: any[],
    volSma: Float64Array,
    patternEndIndex: number,
    direction: 'bullish' | 'bearish',
    breakoutLevel: number,
    targetPrice: number,
    invalidationLevel: number,
    patternHeight: number,
    breakoutSlope: number = 0,
    originIndex?: number,
    maxWaitBars: number = 25
): PatternLifecycleResult {
    const n = candles.length;
    let breakoutIdx = -1;
    let breakoutPrice = 0;
    let breakoutTime: Time | undefined = undefined;
    let failedAtIndex: number | undefined = undefined;
    let failedPrice: number | undefined = undefined;
    let status: DetectedChartPattern['status'] = 'forming';

    const origIdx = originIndex !== undefined ? originIndex : patternEndIndex;
    const invBuffer = patternHeight * 0.1;

    for (let b = patternEndIndex + 1; b < n; b++) {
        const bar = candles[b];
        if (!bar) continue;

        const curBreakLevel =
            breakoutSlope !== 0
                ? breakoutLevel + breakoutSlope * (b - origIdx)
                : breakoutLevel;

        if (breakoutIdx === -1) {
            if (b - patternEndIndex > maxWaitBars) {
                status = 'failed';
                failedAtIndex = b;
                failedPrice = bar.close;
                break;
            }

            if (direction === 'bullish') {
                if (bar.close < invalidationLevel - invBuffer) {
                    status = 'failed';
                    failedAtIndex = b;
                    failedPrice = bar.close;
                    break;
                }
                if (bar.close > curBreakLevel) {
                    breakoutIdx = b;
                    breakoutPrice = bar.close;
                    breakoutTime = bar.time;
                    status = 'breakout';
                    if (bar.high >= targetPrice) {
                        status = 'target_reached';
                        break;
                    }
                }
            } else {
                if (bar.close > invalidationLevel + invBuffer) {
                    status = 'failed';
                    failedAtIndex = b;
                    failedPrice = bar.close;
                    break;
                }
                if (bar.close < curBreakLevel) {
                    breakoutIdx = b;
                    breakoutPrice = bar.close;
                    breakoutTime = bar.time;
                    status = 'breakout';
                    if (bar.low <= targetPrice) {
                        status = 'target_reached';
                        break;
                    }
                }
            }
        } else {
            // Post-breakout phase: lock reference at breakout bar
            const postBreakRef =
                breakoutSlope !== 0
                    ? breakoutLevel + breakoutSlope * (breakoutIdx - origIdx)
                    : breakoutLevel;

            if (direction === 'bullish') {
                if (bar.high >= targetPrice) {
                    status = 'target_reached';
                    break;
                }
                if (bar.close < invalidationLevel || bar.close < postBreakRef - patternHeight * 0.18) {
                    status = 'failed';
                    failedAtIndex = b;
                    failedPrice = bar.close;
                    break;
                }
                if (
                    bar.low <= postBreakRef + patternHeight * 0.15 &&
                    bar.close >= postBreakRef - patternHeight * 0.08
                ) {
                    status = 'pullback';
                }
            } else {
                if (bar.low <= targetPrice) {
                    status = 'target_reached';
                    break;
                }
                if (bar.close > invalidationLevel || bar.close > postBreakRef + patternHeight * 0.18) {
                    status = 'failed';
                    failedAtIndex = b;
                    failedPrice = bar.close;
                    break;
                }
                if (
                    bar.high >= postBreakRef - patternHeight * 0.15 &&
                    bar.close <= postBreakRef + patternHeight * 0.08
                ) {
                    status = 'pullback';
                }
            }
        }
    }

    const evalBarIdx =
        breakoutIdx !== -1
            ? breakoutIdx
            : failedAtIndex !== undefined
              ? failedAtIndex
              : patternEndIndex;
    const v = candles[evalBarIdx]?.volume || 0;
    const avg = volSma[evalBarIdx] || 1;
    const volumeRatio = avg > 0 ? v / avg : 1.0;
    const isVolumeConfirmed = volumeRatio >= 1.25;

    return {
        status,
        breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
        breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
        breakoutTime,
        volumeRatio,
        isVolumeConfirmed,
        failedAtIndex,
        failedPrice,
    };
}

/**
 * Score pattern quality for Global Non-Maximum Suppression (NMS)
 */
function computePatternScore(p: DetectedChartPattern, totalBars: number): number {
    let score = 0;

    if (p.status === 'breakout') score += 260;
    else if (p.status === 'pullback') score += 240;
    else if (p.status === 'forming') score += 200;
    else if (p.status === 'target_reached') score += 160;
    else if (p.specialFlag === 'hound_of_baskervilles') score += 220;
    else score -= 500;

    if (p.isVolumeConfirmed) score += 65;

    if (p.type === 'head_and_shoulders' || p.type === 'inverted_head_and_shoulders') score += 55;
    else if (p.type === 'triple_top' || p.type === 'triple_bottom') score += 85;
    else if (p.type === 'cup_and_handle') score += 50;
    else if (
        p.type === 'ascending_triangle' ||
        p.type === 'descending_triangle' ||
        p.type === 'symmetrical_triangle'
    ) {
        score += 35;
    } else if (p.type === 'double_top' || p.type === 'double_bottom') {
        score += 30;
    }

    const distanceFromRightEdge = Math.max(0, totalBars - 1 - p.endIndex);
    score += Math.max(0, 120 - distanceFromRightEdge * 0.5);

    const span = p.endIndex - p.startIndex;
    score += Math.min(50, span * 0.8);

    return score;
}

/**
 * Global Cross-Pattern Non-Maximum Suppression (NMS).
 * Resolves overlaps across ALL pattern types so two patterns never stack on top of each other.
 */
function deduplicatePatternsGlobal(
    patterns: DetectedChartPattern[],
    totalBars: number,
    maxPatterns: number
): DetectedChartPattern[] {
    const validCandidates = patterns.filter(
        (p) => p.status !== 'failed' || p.specialFlag === 'hound_of_baskervilles'
    );

    if (validCandidates.length === 0) return [];

    // Suppress stale "forming" patterns that ended more than 18 bars ago without breaking out
    const freshCandidates = validCandidates.filter((p) => {
        if (p.status === 'forming' && totalBars - 1 - p.endIndex > 18) {
            return false;
        }
        return true;
    });

    const scored = freshCandidates.map((p) => {
        const s = computePatternScore(p, totalBars);
        p.qualityScore = s;
        return { pat: p, score: s };
    });

    scored.sort((a, b) => b.score - a.score);

    const retained: DetectedChartPattern[] = [];

    for (const item of scored) {
        const cand = item.pat;
        let isOverlapping = false;

        for (const existing of retained) {
            const overlapStart = Math.max(cand.startIndex, existing.startIndex);
            const overlapEnd = Math.min(cand.endIndex, existing.endIndex);
            const overlapBars = Math.max(0, overlapEnd - overlapStart);

            const candSpan = Math.max(1, cand.endIndex - cand.startIndex);
            const existSpan = Math.max(1, existing.endIndex - existing.startIndex);
            const minSpan = Math.min(candSpan, existSpan);
            const endDistance = Math.abs(cand.endIndex - existing.endIndex);

            if (overlapBars / minSpan >= 0.25 || endDistance <= 15) {
                isOverlapping = true;
                break;
            }
        }

        if (!isOverlapping) {
            retained.push(cand);
            if (retained.length >= maxPatterns) break;
        }
    }

    return retained;
}

/**
 * Main Detection Function for Bab 21 Chart Patterns
 */
export function detectChartPatterns(
    candles: any[],
    _isForex: boolean = false,
    mode: ChartPatternMode = 'all'
): DetectedChartPattern[] {
    if (mode === 'off') return [];
    if (!candles || candles.length < 35) return [];

    const n = candles.length;
    const scanStart = Math.max(0, n - 320);
    const lookback = 4; // 4-bar fractal pivot with ATR filter captures closely-spaced Triple Bottom/Top swings

    const atr = computeAtr14(candles);
    const volSma = computeVolumeSma20(candles);
    const swings = extractAlternatingSwings(candles, atr, scanStart, n, lookback);
    if (swings.length < 4) return [];

    const patterns: DetectedChartPattern[] = [];

    const shouldScanReversal =
        mode === 'all' ||
        mode === 'reversal' ||
        REVERSAL_PATTERN_TYPES.includes(mode as PatternType);
    const shouldScanContinuation =
        mode === 'all' ||
        mode === 'continuation' ||
        CONTINUATION_PATTERN_TYPES.includes(mode as PatternType);

    // =========================================================================
    // 1. BAB 21.1: REVERSAL CHART PATTERNS
    // =========================================================================
    if (shouldScanReversal) {
        // --- 1.1 Head and Shoulders & Inverted Head and Shoulders ---
        for (let i = 0; i < swings.length - 4; i++) {
            const ls = swings[i];
            const n1 = swings[i + 1];
            const head = swings[i + 2];
            const n2 = swings[i + 3];
            const rs = swings[i + 4];

            const patternSpan = rs.index - ls.index;
            if (patternSpan < 14 || patternSpan > 140) continue;

            // Head and Shoulders (Top Reversal after Uptrend)
            if (
                ls.type === 'high' &&
                n1.type === 'low' &&
                head.type === 'high' &&
                n2.type === 'low' &&
                rs.type === 'high'
            ) {
                const maxNeck = Math.max(n1.price, n2.price);
                if (ls.price <= maxNeck || rs.price <= maxNeck) continue;

                const neckSlope = (n2.price - n1.price) / (n2.index - n1.index);
                const headNecklinePrice = n1.price + neckSlope * (head.index - n1.index);
                const headHeight = head.price - headNecklinePrice;
                const localAtr = atr[head.index] || head.price * 0.005;

                if (headHeight < localAtr * 2.2) continue;

                // Head must be genuinely prominent above both shoulders (>= 20% of total headHeight)
                const maxShoulder = Math.max(ls.price, rs.price);
                if (head.price - maxShoulder < headHeight * 0.2) continue;

                // Shoulders and Neckline must be balanced relative to pattern height
                if (Math.abs(ls.price - rs.price) > headHeight * 0.16) continue;
                if (Math.abs(n1.price - n2.price) > headHeight * 0.16) continue;

                const leftSpan = head.index - ls.index;
                const rightSpan = rs.index - head.index;
                if (Math.max(leftSpan, rightSpan) / Math.min(leftSpan, rightSpan) > 2.2) continue;

                if (
                    !hasReversalPriorTrend(
                        candles,
                        ls.index,
                        'uptrend',
                        Math.min(n1.price, n2.price),
                        head.price,
                        headHeight,
                        35
                    )
                ) {
                    continue;
                }

                const rsNeckPrice = n1.price + neckSlope * (rs.index - n1.index);
                const estTarget = calcBearishTarget(rsNeckPrice, headHeight);

                const lifecycle = evaluatePatternLifecycle(
                    candles,
                    volSma,
                    rs.index,
                    'bearish',
                    n1.price,
                    estTarget,
                    head.price,
                    headHeight,
                    neckSlope,
                    n1.index
                );

                // Hound of the Baskervilles (Bab 21.1 p.129)
                let isHoundTrap = false;
                if (
                    lifecycle.status === 'failed' &&
                    lifecycle.failedAtIndex !== undefined &&
                    lifecycle.failedPrice !== undefined &&
                    lifecycle.failedPrice > head.price &&
                    lifecycle.isVolumeConfirmed
                ) {
                    isHoundTrap = true;
                }

                const breakoutIdx = isHoundTrap
                    ? lifecycle.failedAtIndex!
                    : lifecycle.breakoutIndex !== undefined
                      ? lifecycle.breakoutIndex
                      : -1;
                const breakoutPrice = isHoundTrap
                    ? lifecycle.failedPrice!
                    : lifecycle.breakoutPrice || 0;

                // Projected breakout index when still FORMING (never collapse onto rs.index!)
                const avgLegBars = Math.max(4, Math.round((rs.index - n2.index) * 0.9));
                const projBreakIdx =
                    breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, rs.index + avgLegBars);
                const projNeckPrice = n1.price + neckSlope * (projBreakIdx - n1.index);
                const refBreakPrice = breakoutPrice > 0 ? breakoutPrice : projNeckPrice;

                const targetPrice = isHoundTrap
                    ? head.price + headHeight
                    : calcBearishTarget(refBreakPrice, headHeight);
                const targetPct = ((targetPrice - refBreakPrice) / refBreakPrice) * 100;

                const neckEndIdx = projBreakIdx + 8;
                const neckEndPrice = n1.price + neckSlope * (neckEndIdx - n1.index);
                const rayEndIdx = projBreakIdx + 12;
                const color = isHoundTrap ? '#26A69A' : '#EF5350';

                patterns.push({
                    id: `hs_${head.index}`,
                    category: 'reversal',
                    type: 'head_and_shoulders',
                    name: isHoundTrap
                        ? 'H&S (Hound of Baskervilles Bullish)'
                        : 'Head & Shoulders',
                    direction: isHoundTrap ? 'bullish' : 'bearish',
                    status: isHoundTrap ? 'breakout' : lifecycle.status,
                    specialFlag: isHoundTrap ? 'hound_of_baskervilles' : undefined,
                    anchors: [
                        { index: ls.index, time: ls.time, price: ls.price, label: 'LS' },
                        { index: n1.index, time: n1.time, price: n1.price, label: 'N1' },
                        { index: head.index, time: head.time, price: head.price, label: 'H' },
                        { index: n2.index, time: n2.time, price: n2.price, label: 'N2' },
                        { index: rs.index, time: rs.time, price: rs.price, label: 'RS' },
                    ],
                    fillPolygon: [
                        { index: ls.index, time: ls.time, price: n1.price + neckSlope * (ls.index - n1.index) },
                        { index: ls.index, time: ls.time, price: ls.price },
                        { index: n1.index, time: n1.time, price: n1.price },
                        { index: head.index, time: head.time, price: head.price },
                        { index: n2.index, time: n2.time, price: n2.price },
                        { index: rs.index, time: rs.time, price: rs.price },
                        { index: rs.index, time: rs.time, price: rsNeckPrice },
                    ],
                    lines: [
                        {
                            x1Index: ls.index, y1Price: ls.price,
                            x2Index: n1.index, y2Price: n1.price,
                            x1Time: ls.time, x2Time: n1.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: n1.index, y1Price: n1.price,
                            x2Index: head.index, y2Price: head.price,
                            x1Time: n1.time, x2Time: head.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: head.index, y1Price: head.price,
                            x2Index: n2.index, y2Price: n2.price,
                            x1Time: head.time, x2Time: n2.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: n2.index, y1Price: n2.price,
                            x2Index: rs.index, y2Price: rs.price,
                            x1Time: n2.time, x2Time: rs.time,
                            style: 'solid', role: 'connector', color,
                        },
                        // Right shoulder to breakout/projected neckline point
                        {
                            x1Index: rs.index, y1Price: rs.price,
                            x2Index: projBreakIdx, y2Price: refBreakPrice,
                            x1Time: rs.time, x2Time: safeTime(candles, projBreakIdx),
                            style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                            role: 'connector', color,
                        },
                        // Prominent Neckline
                        {
                            x1Index: ls.index,
                            y1Price: n1.price + neckSlope * (ls.index - n1.index),
                            x2Index: neckEndIdx,
                            y2Price: neckEndPrice,
                            x1Time: ls.time,
                            x2Time: safeTime(candles, neckEndIdx),
                            style: 'solid',
                            role: 'neckline',
                            color,
                        },
                        // Source Height (Head to Neckline) & Target Projection (Neckline to Target)
                        {
                            x1Index: head.index, y1Price: head.price,
                            x2Index: head.index, y2Price: headNecklinePrice,
                            x1Time: head.time, x2Time: head.time,
                            style: 'dotted', role: 'measured_move', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: refBreakPrice,
                            x2Index: projBreakIdx, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, projBreakIdx),
                            style: 'dotted', role: 'measured_move', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: targetPrice,
                            x2Index: rayEndIdx, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, rayEndIdx),
                            style: 'dashed', role: 'target_ray', color,
                        },
                    ],
                    breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                    breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: ls.index,
                    endIndex: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                });
            }

            // Inverted Head and Shoulders (Bottom Reversal after Downtrend)
            if (
                ls.type === 'low' &&
                n1.type === 'high' &&
                head.type === 'low' &&
                n2.type === 'high' &&
                rs.type === 'low'
            ) {
                const minNeck = Math.min(n1.price, n2.price);
                if (ls.price >= minNeck || rs.price >= minNeck) continue;

                const neckSlope = (n2.price - n1.price) / (n2.index - n1.index);
                const headNecklinePrice = n1.price + neckSlope * (head.index - n1.index);
                const headHeight = headNecklinePrice - head.price;
                const localAtr = atr[head.index] || head.price * 0.005;

                if (headHeight < localAtr * 2.2) continue;

                const minShoulder = Math.min(ls.price, rs.price);
                if (minShoulder - head.price < headHeight * 0.2) continue;

                if (Math.abs(ls.price - rs.price) > headHeight * 0.16) continue;
                if (Math.abs(n1.price - n2.price) > headHeight * 0.16) continue;

                const leftSpan = head.index - ls.index;
                const rightSpan = rs.index - head.index;
                if (Math.max(leftSpan, rightSpan) / Math.min(leftSpan, rightSpan) > 2.2) continue;

                if (
                    !hasReversalPriorTrend(
                        candles,
                        ls.index,
                        'downtrend',
                        Math.max(n1.price, n2.price),
                        head.price,
                        headHeight,
                        35
                    )
                ) {
                    continue;
                }

                const rsNeckPrice = n1.price + neckSlope * (rs.index - n1.index);
                const estTarget = rsNeckPrice + headHeight;

                const lifecycle = evaluatePatternLifecycle(
                    candles,
                    volSma,
                    rs.index,
                    'bullish',
                    n1.price,
                    estTarget,
                    head.price,
                    headHeight,
                    neckSlope,
                    n1.index
                );

                let isHoundTrap = false;
                if (
                    lifecycle.status === 'failed' &&
                    lifecycle.failedAtIndex !== undefined &&
                    lifecycle.failedPrice !== undefined &&
                    lifecycle.failedPrice < head.price &&
                    lifecycle.isVolumeConfirmed
                ) {
                    isHoundTrap = true;
                }

                const breakoutIdx = isHoundTrap
                    ? lifecycle.failedAtIndex!
                    : lifecycle.breakoutIndex !== undefined
                      ? lifecycle.breakoutIndex
                      : -1;
                const breakoutPrice = isHoundTrap
                    ? lifecycle.failedPrice!
                    : lifecycle.breakoutPrice || 0;

                const avgLegBars = Math.max(4, Math.round((rs.index - n2.index) * 0.9));
                const projBreakIdx =
                    breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, rs.index + avgLegBars);
                const projNeckPrice = n1.price + neckSlope * (projBreakIdx - n1.index);
                const refBreakPrice = breakoutPrice > 0 ? breakoutPrice : projNeckPrice;

                const targetPrice = isHoundTrap
                    ? calcBearishTarget(head.price, headHeight)
                    : refBreakPrice + headHeight;
                const targetPct = ((targetPrice - refBreakPrice) / refBreakPrice) * 100;

                const neckEndIdx = projBreakIdx + 8;
                const neckEndPrice = n1.price + neckSlope * (neckEndIdx - n1.index);
                const rayEndIdx = projBreakIdx + 12;
                const color = isHoundTrap ? '#EF5350' : '#26A69A';

                patterns.push({
                    id: `ihs_${head.index}`,
                    category: 'reversal',
                    type: 'inverted_head_and_shoulders',
                    name: isHoundTrap
                        ? 'Inv H&S (Hound of Baskervilles Bearish)'
                        : 'Inverted Head & Shoulders',
                    direction: isHoundTrap ? 'bearish' : 'bullish',
                    status: isHoundTrap ? 'breakout' : lifecycle.status,
                    specialFlag: isHoundTrap ? 'hound_of_baskervilles' : undefined,
                    anchors: [
                        { index: ls.index, time: ls.time, price: ls.price, label: 'LS' },
                        { index: n1.index, time: n1.time, price: n1.price, label: 'N1' },
                        { index: head.index, time: head.time, price: head.price, label: 'H' },
                        { index: n2.index, time: n2.time, price: n2.price, label: 'N2' },
                        { index: rs.index, time: rs.time, price: rs.price, label: 'RS' },
                    ],
                    fillPolygon: [
                        { index: ls.index, time: ls.time, price: n1.price + neckSlope * (ls.index - n1.index) },
                        { index: ls.index, time: ls.time, price: ls.price },
                        { index: n1.index, time: n1.time, price: n1.price },
                        { index: head.index, time: head.time, price: head.price },
                        { index: n2.index, time: n2.time, price: n2.price },
                        { index: rs.index, time: rs.time, price: rs.price },
                        { index: rs.index, time: rs.time, price: rsNeckPrice },
                    ],
                    lines: [
                        {
                            x1Index: ls.index, y1Price: ls.price,
                            x2Index: n1.index, y2Price: n1.price,
                            x1Time: ls.time, x2Time: n1.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: n1.index, y1Price: n1.price,
                            x2Index: head.index, y2Price: head.price,
                            x1Time: n1.time, x2Time: head.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: head.index, y1Price: head.price,
                            x2Index: n2.index, y2Price: n2.price,
                            x1Time: head.time, x2Time: n2.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: n2.index, y1Price: n2.price,
                            x2Index: rs.index, y2Price: rs.price,
                            x1Time: n2.time, x2Time: rs.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: rs.index, y1Price: rs.price,
                            x2Index: projBreakIdx, y2Price: refBreakPrice,
                            x1Time: rs.time, x2Time: safeTime(candles, projBreakIdx),
                            style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                            role: 'connector', color,
                        },
                        {
                            x1Index: ls.index,
                            y1Price: n1.price + neckSlope * (ls.index - n1.index),
                            x2Index: neckEndIdx,
                            y2Price: neckEndPrice,
                            x1Time: ls.time,
                            x2Time: safeTime(candles, neckEndIdx),
                            style: 'solid',
                            role: 'neckline',
                            color,
                        },
                        {
                            x1Index: head.index, y1Price: head.price,
                            x2Index: head.index, y2Price: headNecklinePrice,
                            x1Time: head.time, x2Time: head.time,
                            style: 'dotted', role: 'measured_move', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: refBreakPrice,
                            x2Index: projBreakIdx, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, projBreakIdx),
                            style: 'dotted', role: 'measured_move', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: targetPrice,
                            x2Index: rayEndIdx, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, rayEndIdx),
                            style: 'dashed', role: 'target_ray', color,
                        },
                    ],
                    breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                    breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: ls.index,
                    endIndex: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                });
            }
        }

        // --- 1.2 Double Tops/Bottoms & Horn Tops/Bottoms ---
        for (let i = 0; i < swings.length - 2; i++) {
            const p1 = swings[i];
            const mid = swings[i + 1];
            const p2 = swings[i + 2];

            const barSpan = p2.index - p1.index;
            const localAtr = atr[p2.index] || p2.price * 0.005;

            // Leg symmetry check: the two halves of the M/W (p1->mid and mid->p2) must be balanced
            const leg1 = mid.index - p1.index;
            const leg2 = p2.index - mid.index;
            if (Math.max(leg1, leg2) / Math.max(1, Math.min(leg1, leg2)) > 2.5) continue;

            // Double Tops (M-Shape) & Horn Tops
            if (p1.type === 'high' && mid.type === 'low' && p2.type === 'high') {
                const avgTop = (p1.price + p2.price) / 2;
                const height = avgTop - mid.price;
                if (height < localAtr * 2.0) continue;

                // CRITICAL FIX: Compare top difference against PATTERN HEIGHT (not raw asset price!)
                // T1 and T2 must be within 12% of the pattern height so the top is genuinely flat/horizontal
                const topDiffAbs = Math.abs(p1.price - p2.price);
                const isEqualTops = topDiffAbs <= height * 0.085 && topDiffAbs <= localAtr * 0.65;
                if (!isEqualTops) continue;

                const isHorn = barSpan >= 4 && barSpan <= 7;
                const isDoubleTop = !isHorn && barSpan >= 10 && barSpan <= 65;

                if (isDoubleTop || isHorn) {
                    const topLevel = Math.max(p1.price, p2.price);
                    if (
                        !hasReversalPriorTrend(
                            candles,
                            p1.index,
                            'uptrend',
                            mid.price,
                            topLevel,
                            height,
                            30
                        )
                    ) {
                        continue;
                    }

                    if (
                        !isEnvelopeRespected(
                            candles,
                            p1.index,
                            p2.index,
                            () => topLevel,
                            () => mid.price
                        )
                    ) {
                        continue;
                    }

                    const targetPrice = isHorn
                        ? calcBearishTarget(mid.price, height * 0.85)
                        : calcBearishTarget(mid.price, height);
                    const targetPct = ((targetPrice - mid.price) / mid.price) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        p2.index,
                        'bearish',
                        mid.price,
                        targetPrice,
                        topLevel,
                        height,
                        0,
                        p2.index,
                        isHorn ? 10 : 25
                    );

                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const breakoutPrice = lifecycle.breakoutPrice || 0;

                    // When FORMING, project the expected breakdown point forward by leg2 bars (never vertical on T2!)
                    const projBreakIdx =
                        breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, p2.index + leg2);
                    const refBreakPrice = breakoutPrice > 0 ? breakoutPrice : mid.price;
                    const neckEndIdx = projBreakIdx + 8;
                    const rayEndIdx = projBreakIdx + 12;
                    const color = '#EF5350';

                    patterns.push({
                        id: `${isHorn ? 'horn_top' : 'dt'}_${p2.index}`,
                        category: 'reversal',
                        type: isHorn ? 'horn_top' : 'double_top',
                        name: isHorn ? 'Horn Tops' : 'Double Tops',
                        direction: 'bearish',
                        status: lifecycle.status,
                        anchors: [
                            { index: p1.index, time: p1.time, price: p1.price, label: 'T1' },
                            { index: mid.index, time: mid.time, price: mid.price, label: 'N' },
                            { index: p2.index, time: p2.time, price: p2.price, label: 'T2' },
                        ],
                        fillPolygon: [
                            { index: p1.index, time: p1.time, price: mid.price },
                            { index: p1.index, time: p1.time, price: p1.price },
                            { index: mid.index, time: mid.time, price: mid.price },
                            { index: p2.index, time: p2.time, price: p2.price },
                            { index: p2.index, time: p2.time, price: mid.price },
                        ],
                        lines: [
                            // M-shape silhouette
                            {
                                x1Index: p1.index, y1Price: p1.price,
                                x2Index: mid.index, y2Price: mid.price,
                                x1Time: p1.time, x2Time: mid.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: mid.index, y1Price: mid.price,
                                x2Index: p2.index, y2Price: p2.price,
                                x1Time: mid.time, x2Time: p2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: p2.index, y1Price: p2.price,
                                x2Index: projBreakIdx, y2Price: refBreakPrice,
                                x1Time: p2.time, x2Time: safeTime(candles, projBreakIdx),
                                style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                                role: 'connector', color,
                            },
                            // Horizontal Resistance across T1-T2
                            {
                                x1Index: p1.index, y1Price: p1.price,
                                x2Index: p2.index, y2Price: p2.price,
                                x1Time: p1.time, x2Time: p2.time,
                                style: 'dashed', role: 'upper_boundary', color,
                            },
                            // Support Neckline across Valley N
                            {
                                x1Index: p1.index, y1Price: mid.price,
                                x2Index: neckEndIdx, y2Price: mid.price,
                                x1Time: p1.time, x2Time: safeTime(candles, neckEndIdx),
                                style: 'solid', role: 'neckline', color,
                            },
                            // Pattern Height H reference at N & Target Projection at projBreakIdx
                            {
                                x1Index: mid.index, y1Price: avgTop,
                                x2Index: mid.index, y2Price: mid.price,
                                x1Time: mid.time, x2Time: mid.time,
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: refBreakPrice,
                                x2Index: projBreakIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: targetPrice,
                                x2Index: rayEndIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, rayEndIdx),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                        breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: p1.index,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : p2.index,
                    });
                }
            }

            // Double Bottoms (W-Shape) & Horn Bottoms
            if (p1.type === 'low' && mid.type === 'high' && p2.type === 'low') {
                const avgBot = (p1.price + p2.price) / 2;
                const height = mid.price - avgBot;
                if (height < localAtr * 2.0) continue;

                // CRITICAL FIX: Compare bottom difference against PATTERN HEIGHT (not raw asset price!)
                // B1 and B2 must be within 12% of the pattern height so the bottom is genuinely flat/horizontal
                const botDiffAbs = Math.abs(p1.price - p2.price);
                const isEqualBottoms = botDiffAbs <= height * 0.085 && botDiffAbs <= localAtr * 0.65;
                if (!isEqualBottoms) continue;

                const isHorn = barSpan >= 4 && barSpan <= 7;
                const isDoubleBottom = !isHorn && barSpan >= 10 && barSpan <= 65;

                if (isDoubleBottom || isHorn) {
                    const botLevel = Math.min(p1.price, p2.price);
                    if (
                        !hasReversalPriorTrend(
                            candles,
                            p1.index,
                            'downtrend',
                            mid.price,
                            botLevel,
                            height,
                            30
                        )
                    ) {
                        continue;
                    }

                    if (
                        !isEnvelopeRespected(
                            candles,
                            p1.index,
                            p2.index,
                            () => mid.price,
                            () => botLevel
                        )
                    ) {
                        continue;
                    }

                    const targetPrice = isHorn ? mid.price + height * 0.85 : mid.price + height;
                    const targetPct = ((targetPrice - mid.price) / mid.price) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        p2.index,
                        'bullish',
                        mid.price,
                        targetPrice,
                        botLevel,
                        height,
                        0,
                        p2.index,
                        isHorn ? 10 : 25
                    );

                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const breakoutPrice = lifecycle.breakoutPrice || 0;

                    // When FORMING, project the expected breakout point forward by leg2 bars (never vertical on B2!)
                    const projBreakIdx =
                        breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, p2.index + leg2);
                    const refBreakPrice = breakoutPrice > 0 ? breakoutPrice : mid.price;
                    const neckEndIdx = projBreakIdx + 8;
                    const rayEndIdx = projBreakIdx + 12;
                    const color = '#26A69A';

                    patterns.push({
                        id: `${isHorn ? 'horn_bot' : 'db'}_${p2.index}`,
                        category: 'reversal',
                        type: isHorn ? 'horn_bottom' : 'double_bottom',
                        name: isHorn ? 'Horn Bottoms' : 'Double Bottoms',
                        direction: 'bullish',
                        status: lifecycle.status,
                        anchors: [
                            { index: p1.index, time: p1.time, price: p1.price, label: 'B1' },
                            { index: mid.index, time: mid.time, price: mid.price, label: 'N' },
                            { index: p2.index, time: p2.time, price: p2.price, label: 'B2' },
                        ],
                        fillPolygon: [
                            { index: p1.index, time: p1.time, price: mid.price },
                            { index: p1.index, time: p1.time, price: p1.price },
                            { index: mid.index, time: mid.time, price: mid.price },
                            { index: p2.index, time: p2.time, price: p2.price },
                            { index: p2.index, time: p2.time, price: mid.price },
                        ],
                        lines: [
                            // W-shape silhouette
                            {
                                x1Index: p1.index, y1Price: p1.price,
                                x2Index: mid.index, y2Price: mid.price,
                                x1Time: p1.time, x2Time: mid.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: mid.index, y1Price: mid.price,
                                x2Index: p2.index, y2Price: p2.price,
                                x1Time: mid.time, x2Time: p2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: p2.index, y1Price: p2.price,
                                x2Index: projBreakIdx, y2Price: refBreakPrice,
                                x1Time: p2.time, x2Time: safeTime(candles, projBreakIdx),
                                style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                                role: 'connector', color,
                            },
                            // Horizontal Support floor across B1-B2
                            {
                                x1Index: p1.index, y1Price: p1.price,
                                x2Index: p2.index, y2Price: p2.price,
                                x1Time: p1.time, x2Time: p2.time,
                                style: 'dashed', role: 'lower_boundary', color,
                            },
                            // Resistance Neckline across Peak N
                            {
                                x1Index: p1.index, y1Price: mid.price,
                                x2Index: neckEndIdx, y2Price: mid.price,
                                x1Time: p1.time, x2Time: safeTime(candles, neckEndIdx),
                                style: 'solid', role: 'neckline', color,
                            },
                            // Pattern Height H reference at N & Target Projection at projBreakIdx
                            {
                                x1Index: mid.index, y1Price: avgBot,
                                x2Index: mid.index, y2Price: mid.price,
                                x1Time: mid.time, x2Time: mid.time,
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: refBreakPrice,
                                x2Index: projBreakIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: targetPrice,
                                x2Index: rayEndIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, rayEndIdx),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                        breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: p1.index,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : p2.index,
                    });
                }
            }
        }

        // --- 1.3 Triple Tops & Triple Bottoms ---
        for (let i = 0; i < swings.length - 4; i++) {
            const s1 = swings[i];
            const v1 = swings[i + 1];
            const s2 = swings[i + 2];
            const v2 = swings[i + 3];
            const s3 = swings[i + 4];

            const span = s3.index - s1.index;
            if (span < 10 || span > 120) continue;

            // Triple Tops
            if (
                s1.type === 'high' &&
                v1.type === 'low' &&
                s2.type === 'high' &&
                v2.type === 'low' &&
                s3.type === 'high'
            ) {
                const supportPrice = Math.min(v1.price, v2.price);
                const avgTop = (s1.price + s2.price + s3.price) / 3;
                const height = avgTop - supportPrice;
                const localAtr = atr[s3.index] || avgTop * 0.005;

                if (height < localAtr * 2.0) continue;

                const maxTopSpread =
                    Math.max(s1.price, s2.price, s3.price) -
                    Math.min(s1.price, s2.price, s3.price);
                const valleySpread = Math.abs(v1.price - v2.price);

                if (maxTopSpread <= height * 0.12 && valleySpread <= height * 0.35) {
                    if (
                        !hasReversalPriorTrend(
                            candles,
                            s1.index,
                            'uptrend',
                            supportPrice,
                            avgTop,
                            height,
                            35
                        )
                    ) {
                        continue;
                    }

                    const targetPrice = calcBearishTarget(supportPrice, height);
                    const targetPct = ((targetPrice - supportPrice) / supportPrice) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        s3.index,
                        'bearish',
                        supportPrice,
                        targetPrice,
                        Math.max(s1.price, s2.price, s3.price),
                        height
                    );
                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const breakoutPrice = lifecycle.breakoutPrice || 0;
                    const projBreakIdx =
                        breakoutIdx !== -1
                            ? breakoutIdx
                            : Math.max(n - 1, s3.index + Math.max(4, s3.index - v2.index));
                    const refBreakPrice = breakoutPrice > 0 ? breakoutPrice : supportPrice;
                    const color = '#EF5350';

                    patterns.push({
                        id: `tt_${s3.index}`,
                        category: 'reversal',
                        type: 'triple_top',
                        name: 'Triple Tops',
                        direction: 'bearish',
                        status: lifecycle.status,
                        anchors: [
                            { index: s1.index, time: s1.time, price: s1.price, label: 'T1' },
                            { index: v1.index, time: v1.time, price: v1.price, label: 'V1' },
                            { index: s2.index, time: s2.time, price: s2.price, label: 'T2' },
                            { index: v2.index, time: v2.time, price: v2.price, label: 'V2' },
                            { index: s3.index, time: s3.time, price: s3.price, label: 'T3' },
                        ],
                        fillPolygon: [
                            { index: s1.index, time: s1.time, price: supportPrice },
                            { index: s1.index, time: s1.time, price: avgTop },
                            { index: s3.index, time: s3.time, price: avgTop },
                            { index: s3.index, time: s3.time, price: supportPrice },
                        ],
                        lines: [
                            {
                                x1Index: s1.index, y1Price: s1.price,
                                x2Index: v1.index, y2Price: v1.price,
                                x1Time: s1.time, x2Time: v1.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: v1.index, y1Price: v1.price,
                                x2Index: s2.index, y2Price: s2.price,
                                x1Time: v1.time, x2Time: s2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: s2.index, y1Price: s2.price,
                                x2Index: v2.index, y2Price: v2.price,
                                x1Time: s2.time, x2Time: v2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: v2.index, y1Price: v2.price,
                                x2Index: s3.index, y2Price: s3.price,
                                x1Time: v2.time, x2Time: s3.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: s3.index, y1Price: s3.price,
                                x2Index: projBreakIdx, y2Price: refBreakPrice,
                                x1Time: s3.time, x2Time: safeTime(candles, projBreakIdx),
                                style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                                role: 'connector', color,
                            },
                            {
                                x1Index: s1.index, y1Price: avgTop,
                                x2Index: s3.index, y2Price: avgTop,
                                x1Time: s1.time, x2Time: s3.time,
                                style: 'dashed', role: 'upper_boundary', color,
                            },
                            {
                                x1Index: s1.index, y1Price: supportPrice,
                                x2Index: projBreakIdx + 8, y2Price: supportPrice,
                                x1Time: s1.time, x2Time: safeTime(candles, projBreakIdx + 8),
                                style: 'solid', role: 'neckline', color,
                            },
                            {
                                x1Index: s2.index, y1Price: avgTop,
                                x2Index: s2.index, y2Price: supportPrice,
                                x1Time: s2.time, x2Time: s2.time,
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: refBreakPrice,
                                x2Index: projBreakIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: targetPrice,
                                x2Index: projBreakIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                        breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: s1.index,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : s3.index,
                    });
                }
            }

            // Triple Bottoms
            if (
                s1.type === 'low' &&
                v1.type === 'high' &&
                s2.type === 'low' &&
                v2.type === 'high' &&
                s3.type === 'low'
            ) {
                const resPrice = Math.max(v1.price, v2.price);
                const avgBot = (s1.price + s2.price + s3.price) / 3;
                const height = resPrice - avgBot;
                const localAtr = atr[s3.index] || resPrice * 0.005;

                if (height < localAtr * 2.0) continue;

                const maxBotSpread =
                    Math.max(s1.price, s2.price, s3.price) -
                    Math.min(s1.price, s2.price, s3.price);
                const peakSpread = Math.abs(v1.price - v2.price);

                if (maxBotSpread <= height * 0.12 && peakSpread <= height * 0.35) {
                    if (
                        !hasReversalPriorTrend(
                            candles,
                            s1.index,
                            'downtrend',
                            resPrice,
                            avgBot,
                            height,
                            35
                        )
                    ) {
                        continue;
                    }

                    const targetPrice = resPrice + height;
                    const targetPct = ((targetPrice - resPrice) / resPrice) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        s3.index,
                        'bullish',
                        resPrice,
                        targetPrice,
                        Math.min(s1.price, s2.price, s3.price),
                        height
                    );
                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const breakoutPrice = lifecycle.breakoutPrice || 0;
                    const projBreakIdx =
                        breakoutIdx !== -1
                            ? breakoutIdx
                            : Math.max(n - 1, s3.index + Math.max(4, s3.index - v2.index));
                    const refBreakPrice = breakoutPrice > 0 ? breakoutPrice : resPrice;
                    const color = '#26A69A';

                    patterns.push({
                        id: `tb_${s3.index}`,
                        category: 'reversal',
                        type: 'triple_bottom',
                        name: 'Triple Bottoms',
                        direction: 'bullish',
                        status: lifecycle.status,
                        anchors: [
                            { index: s1.index, time: s1.time, price: s1.price, label: 'B1' },
                            { index: v1.index, time: v1.time, price: v1.price, label: 'P1' },
                            { index: s2.index, time: s2.time, price: s2.price, label: 'B2' },
                            { index: v2.index, time: v2.time, price: v2.price, label: 'P2' },
                            { index: s3.index, time: s3.time, price: s3.price, label: 'B3' },
                        ],
                        fillPolygon: [
                            { index: s1.index, time: s1.time, price: resPrice },
                            { index: s1.index, time: s1.time, price: avgBot },
                            { index: s3.index, time: s3.time, price: avgBot },
                            { index: s3.index, time: s3.time, price: resPrice },
                        ],
                        lines: [
                            {
                                x1Index: s1.index, y1Price: s1.price,
                                x2Index: v1.index, y2Price: v1.price,
                                x1Time: s1.time, x2Time: v1.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: v1.index, y1Price: v1.price,
                                x2Index: s2.index, y2Price: s2.price,
                                x1Time: v1.time, x2Time: s2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: s2.index, y1Price: s2.price,
                                x2Index: v2.index, y2Price: v2.price,
                                x1Time: s2.time, x2Time: v2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: v2.index, y1Price: v2.price,
                                x2Index: s3.index, y2Price: s3.price,
                                x1Time: v2.time, x2Time: s3.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: s3.index, y1Price: s3.price,
                                x2Index: projBreakIdx, y2Price: refBreakPrice,
                                x1Time: s3.time, x2Time: safeTime(candles, projBreakIdx),
                                style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                                role: 'connector', color,
                            },
                            {
                                x1Index: s1.index, y1Price: avgBot,
                                x2Index: s3.index, y2Price: avgBot,
                                x1Time: s1.time, x2Time: s3.time,
                                style: 'dashed', role: 'lower_boundary', color,
                            },
                            {
                                x1Index: s1.index, y1Price: resPrice,
                                x2Index: projBreakIdx + 8, y2Price: resPrice,
                                x1Time: s1.time, x2Time: safeTime(candles, projBreakIdx + 8),
                                style: 'solid', role: 'neckline', color,
                            },
                            {
                                x1Index: s2.index, y1Price: avgBot,
                                x2Index: s2.index, y2Price: resPrice,
                                x1Time: s2.time, x2Time: s2.time,
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: refBreakPrice,
                                x2Index: projBreakIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: targetPrice,
                                x2Index: projBreakIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                        breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: s1.index,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : s3.index,
                    });
                }
            }
        }
    }

    // =========================================================================
    // 2. BAB 21.2: CONTINUATION CHART PATTERNS
    // =========================================================================
    if (shouldScanContinuation) {
        // --- 2.1 Triangles, Wedges & Rectangles (4 Alternating Swings) ---
        for (let i = 0; i < swings.length - 3; i++) {
            const sw1 = swings[i];
            const sw2 = swings[i + 1];
            const sw3 = swings[i + 2];
            const sw4 = swings[i + 3];

            const startIdx = sw1.index;
            const endIdx = sw4.index;
            const span = endIdx - startIdx;
            if (span < 12 || span > 110) continue;

            // Internal swing legs must be balanced in duration (prevents swallowing a long prior trend as leg 1)
            const leg1Bars = sw2.index - sw1.index;
            const leg2Bars = sw3.index - sw2.index;
            const leg3Bars = sw4.index - sw3.index;
            if (
                Math.min(leg1Bars, leg2Bars, leg3Bars) < 3 ||
                Math.max(leg1Bars, leg2Bars, leg3Bars) / Math.min(leg1Bars, leg2Bars, leg3Bars) > 2.8
            ) {
                continue;
            }

            let h1: SwingPoint, h2: SwingPoint, l1: SwingPoint, l2: SwingPoint;
            if (sw1.type === 'high') {
                h1 = sw1; l1 = sw2; h2 = sw3; l2 = sw4;
            } else {
                l1 = sw1; h1 = sw2; l2 = sw3; h2 = sw4;
            }

            if (h2.index === h1.index || l2.index === l1.index) continue;

            const upperSlope = (h2.price - h1.price) / (h2.index - h1.index);
            const lowerSlope = (l2.price - l1.price) / (l2.index - l1.index);

            const upperAt = (idx: number) => h1.price + upperSlope * (idx - h1.index);
            const lowerAt = (idx: number) => l1.price + lowerSlope * (idx - l1.index);

            const rawTop = Math.max(h1.price, h2.price);
            const rawBot = Math.min(l1.price, l2.price);
            const baseHeight = rawTop - rawBot;
            const endHeight = upperAt(endIdx) - lowerAt(endIdx);
            const localAtr = atr[endIdx] || h1.price * 0.005;

            if (baseHeight < localAtr * 2.0 || endHeight <= 0) continue;

            if (!isEnvelopeRespected(candles, startIdx, endIdx, upperAt, lowerAt, 0.12)) {
                continue;
            }

            // Height-relative boundary changes (timeframe/asset invariant)
            const upperDropRatio = (h1.price - h2.price) / baseHeight; // positive when upper line slopes down
            const lowerRiseRatio = (l2.price - l1.price) / baseHeight; // positive when lower line slopes up

            const isUpperFlat = Math.abs(upperDropRatio) <= 0.12;
            const isLowerFlat = Math.abs(lowerRiseRatio) <= 0.12;

            // 2.1.A Symmetrical Triangle: upper drops >= 18% of baseHeight, lower rises >= 18% of baseHeight
            if (
                upperDropRatio >= 0.18 &&
                lowerRiseRatio >= 0.18 &&
                endHeight < baseHeight * 0.75
            ) {
                const slopeRatio =
                    Math.max(Math.abs(upperSlope), Math.abs(lowerSlope)) /
                    Math.min(Math.abs(upperSlope), Math.abs(lowerSlope));

                if (slopeRatio <= 2.6) {
                    const apexIdx = Math.round(
                        (l1.price - h1.price + upperSlope * h1.index - lowerSlope * l1.index) /
                            (upperSlope - lowerSlope)
                    );
                    if (apexIdx > endIdx && apexIdx <= endIdx + 45) {
                        const apexPrice = upperAt(apexIdx);
                        const apexDist = apexIdx - startIdx;
                        const curPos = (n - 1 - startIdx) / apexDist;
                        const specialFlag =
                            curPos >= 0.65 && curPos <= 0.78 ? 'apex_approaching' : undefined;

                        const isPriorUp = hasContinuationPriorTrend(
                            candles,
                            atr,
                            startIdx,
                            'uptrend',
                            25,
                            1.4
                        );
                        const priorTrend: 'bullish' | 'bearish' = isPriorUp ? 'bullish' : 'bearish';
                        const breakLineAtEnd =
                            priorTrend === 'bullish' ? upperAt(endIdx) : lowerAt(endIdx);
                        const targetPrice =
                            priorTrend === 'bullish'
                                ? breakLineAtEnd + baseHeight
                                : calcBearishTarget(breakLineAtEnd, baseHeight);

                        const lifecycle = evaluatePatternLifecycle(
                            candles,
                            volSma,
                            endIdx,
                            priorTrend,
                            priorTrend === 'bullish' ? h1.price : l1.price,
                            targetPrice,
                            priorTrend === 'bullish' ? l2.price : h2.price,
                            baseHeight,
                            priorTrend === 'bullish' ? upperSlope : lowerSlope,
                            priorTrend === 'bullish' ? h1.index : l1.index
                        );

                        const breakoutIdx =
                            lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                        const projBreakIdx =
                            breakoutIdx !== -1
                                ? breakoutIdx
                                : Math.min(apexIdx - 2, Math.max(n - 1, endIdx + 4));
                        const refPrice =
                            lifecycle.breakoutPrice ||
                            (priorTrend === 'bullish'
                                ? upperAt(projBreakIdx)
                                : lowerAt(projBreakIdx));
                        const finalTarget =
                            priorTrend === 'bullish'
                                ? refPrice + baseHeight
                                : calcBearishTarget(refPrice, baseHeight);
                        const targetPct = ((finalTarget - refPrice) / refPrice) * 100;
                        const color = priorTrend === 'bullish' ? '#26A69A' : '#EF5350';

                        patterns.push({
                            id: `sym_tri_${endIdx}`,
                            category: 'continuation',
                            type: 'symmetrical_triangle',
                            name: `Symmetrical Triangle (${priorTrend === 'bullish' ? 'Bullish' : 'Bearish'})`,
                            direction: priorTrend,
                            status: lifecycle.status,
                            specialFlag,
                            anchors: [
                                { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                                { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                                { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                                { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                                {
                                    index: apexIdx,
                                    time: safeTime(candles, apexIdx) as Time,
                                    price: apexPrice,
                                    label: 'Apex',
                                },
                            ],
                            fillPolygon: [
                                { index: startIdx, time: safeTime(candles, startIdx), price: upperAt(startIdx) },
                                { index: apexIdx, time: safeTime(candles, apexIdx), price: apexPrice },
                                { index: startIdx, time: safeTime(candles, startIdx), price: lowerAt(startIdx) },
                            ],
                            lines: [
                                {
                                    x1Index: startIdx, y1Price: upperAt(startIdx),
                                    x2Index: apexIdx, y2Price: apexPrice,
                                    x1Time: safeTime(candles, startIdx),
                                    x2Time: safeTime(candles, apexIdx),
                                    style: 'solid', role: 'upper_boundary', color,
                                },
                                {
                                    x1Index: startIdx, y1Price: lowerAt(startIdx),
                                    x2Index: apexIdx, y2Price: apexPrice,
                                    x1Time: safeTime(candles, startIdx),
                                    x2Time: safeTime(candles, apexIdx),
                                    style: 'solid', role: 'lower_boundary', color,
                                },
                                {
                                    x1Index: sw1.index, y1Price: sw1.price,
                                    x2Index: sw2.index, y2Price: sw2.price,
                                    x1Time: sw1.time, x2Time: sw2.time,
                                    style: 'solid', role: 'connector', color,
                                },
                                {
                                    x1Index: sw2.index, y1Price: sw2.price,
                                    x2Index: sw3.index, y2Price: sw3.price,
                                    x1Time: sw2.time, x2Time: sw3.time,
                                    style: 'solid', role: 'connector', color,
                                },
                                {
                                    x1Index: sw3.index, y1Price: sw3.price,
                                    x2Index: sw4.index, y2Price: sw4.price,
                                    x1Time: sw3.time, x2Time: sw4.time,
                                    style: 'solid', role: 'connector', color,
                                },
                                {
                                    x1Index: startIdx, y1Price: upperAt(startIdx),
                                    x2Index: startIdx, y2Price: lowerAt(startIdx),
                                    x1Time: safeTime(candles, startIdx),
                                    x2Time: safeTime(candles, startIdx),
                                    style: 'dotted', role: 'measured_move', color,
                                },
                                {
                                    x1Index: projBreakIdx, y1Price: refPrice,
                                    x2Index: projBreakIdx, y2Price: finalTarget,
                                    x1Time: safeTime(candles, projBreakIdx),
                                    x2Time: safeTime(candles, projBreakIdx),
                                    style: 'dotted', role: 'measured_move', color,
                                },
                                {
                                    x1Index: projBreakIdx, y1Price: finalTarget,
                                    x2Index: projBreakIdx + 12, y2Price: finalTarget,
                                    x1Time: safeTime(candles, projBreakIdx),
                                    x2Time: safeTime(candles, projBreakIdx + 12),
                                    style: 'dashed', role: 'target_ray', color,
                                },
                            ],
                            breakoutPrice: lifecycle.breakoutPrice,
                            breakoutIndex: lifecycle.breakoutIndex,
                            breakoutTime: lifecycle.breakoutTime,
                            targetPrice: finalTarget,
                            targetPercent: targetPct,
                            volumeRatio: lifecycle.volumeRatio,
                            isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                            startIndex: startIdx,
                            endIndex: breakoutIdx !== -1 ? breakoutIdx : endIdx,
                        });
                    }
                }
            }

            // 2.1.B Ascending Triangle: flat horizontal resistance, rising lower line (>= 25% of baseHeight)
            else if (isUpperFlat && lowerRiseRatio >= 0.25 && lowerSlope > 0) {
                const resPrice = (h1.price + h2.price) / 2;
                const apexIdx = Math.min(
                    endIdx + 35,
                    Math.round(l1.index + (resPrice - l1.price) / lowerSlope)
                );
                if (apexIdx > endIdx) {
                    const targetPrice = resPrice + baseHeight;
                    const targetPct = ((targetPrice - resPrice) / resPrice) * 100;
                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        endIdx,
                        'bullish',
                        resPrice,
                        targetPrice,
                        l2.price,
                        baseHeight
                    );
                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const projBreakIdx =
                        breakoutIdx !== -1
                            ? breakoutIdx
                            : Math.min(apexIdx - 1, Math.max(n - 1, endIdx + 4));
                    const color = '#26A69A';

                    patterns.push({
                        id: `asc_tri_${endIdx}`,
                        category: 'continuation',
                        type: 'ascending_triangle',
                        name: 'Ascending Triangle',
                        direction: 'bullish',
                        status: lifecycle.status,
                        anchors: [
                            { index: h1.index, time: h1.time, price: h1.price, label: 'R1' },
                            { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                            { index: h2.index, time: h2.time, price: h2.price, label: 'R2' },
                            { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                        ],
                        fillPolygon: [
                            { index: startIdx, time: safeTime(candles, startIdx), price: resPrice },
                            { index: apexIdx, time: safeTime(candles, apexIdx), price: resPrice },
                            { index: l1.index, time: l1.time, price: l1.price },
                        ],
                        lines: [
                            {
                                x1Index: startIdx, y1Price: resPrice,
                                x2Index: apexIdx, y2Price: resPrice,
                                x1Time: safeTime(candles, startIdx),
                                x2Time: safeTime(candles, apexIdx),
                                style: 'solid', role: 'upper_boundary', color,
                            },
                            {
                                x1Index: l1.index, y1Price: l1.price,
                                x2Index: apexIdx, y2Price: resPrice,
                                x1Time: l1.time,
                                x2Time: safeTime(candles, apexIdx),
                                style: 'solid', role: 'lower_boundary', color,
                            },
                            {
                                x1Index: sw1.index, y1Price: sw1.price,
                                x2Index: sw2.index, y2Price: sw2.price,
                                x1Time: sw1.time, x2Time: sw2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: sw2.index, y1Price: sw2.price,
                                x2Index: sw3.index, y2Price: sw3.price,
                                x1Time: sw2.time, x2Time: sw3.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: sw3.index, y1Price: sw3.price,
                                x2Index: sw4.index, y2Price: sw4.price,
                                x1Time: sw3.time, x2Time: sw4.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: l1.index, y1Price: resPrice,
                                x2Index: l1.index, y2Price: l1.price,
                                x1Time: l1.time,
                                x2Time: l1.time,
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: resPrice,
                                x2Index: projBreakIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: targetPrice,
                                x2Index: projBreakIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: startIdx,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : endIdx,
                    });
                }
            }

            // 2.1.C Descending Triangle: falling upper line (>= 25% of baseHeight), flat horizontal support
            else if (upperDropRatio >= 0.25 && isLowerFlat && upperSlope < 0) {
                const supPrice = (l1.price + l2.price) / 2;
                const apexIdx = Math.min(
                    endIdx + 35,
                    Math.round(h1.index + (supPrice - h1.price) / upperSlope)
                );
                if (apexIdx > endIdx) {
                    const targetPrice = calcBearishTarget(supPrice, baseHeight);
                    const targetPct = ((targetPrice - supPrice) / supPrice) * 100;
                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        endIdx,
                        'bearish',
                        supPrice,
                        targetPrice,
                        h2.price,
                        baseHeight
                    );
                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const projBreakIdx =
                        breakoutIdx !== -1
                            ? breakoutIdx
                            : Math.min(apexIdx - 1, Math.max(n - 1, endIdx + 4));
                    const color = '#EF5350';

                    patterns.push({
                        id: `desc_tri_${endIdx}`,
                        category: 'continuation',
                        type: 'descending_triangle',
                        name: 'Descending Triangle',
                        direction: 'bearish',
                        status: lifecycle.status,
                        anchors: [
                            { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                            { index: l1.index, time: l1.time, price: l1.price, label: 'S1' },
                            { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                            { index: l2.index, time: l2.time, price: l2.price, label: 'S2' },
                        ],
                        fillPolygon: [
                            { index: h1.index, time: h1.time, price: h1.price },
                            { index: apexIdx, time: safeTime(candles, apexIdx), price: supPrice },
                            { index: startIdx, time: safeTime(candles, startIdx), price: supPrice },
                        ],
                        lines: [
                            {
                                x1Index: h1.index, y1Price: h1.price,
                                x2Index: apexIdx, y2Price: supPrice,
                                x1Time: h1.time,
                                x2Time: safeTime(candles, apexIdx),
                                style: 'solid', role: 'upper_boundary', color,
                            },
                            {
                                x1Index: startIdx, y1Price: supPrice,
                                x2Index: apexIdx, y2Price: supPrice,
                                x1Time: safeTime(candles, startIdx),
                                x2Time: safeTime(candles, apexIdx),
                                style: 'solid', role: 'lower_boundary', color,
                            },
                            {
                                x1Index: sw1.index, y1Price: sw1.price,
                                x2Index: sw2.index, y2Price: sw2.price,
                                x1Time: sw1.time, x2Time: sw2.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: sw2.index, y1Price: sw2.price,
                                x2Index: sw3.index, y2Price: sw3.price,
                                x1Time: sw2.time, x2Time: sw3.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: sw3.index, y1Price: sw3.price,
                                x2Index: sw4.index, y2Price: sw4.price,
                                x1Time: sw3.time, x2Time: sw4.time,
                                style: 'solid', role: 'connector', color,
                            },
                            {
                                x1Index: h1.index, y1Price: h1.price,
                                x2Index: h1.index, y2Price: supPrice,
                                x1Time: h1.time,
                                x2Time: h1.time,
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: supPrice,
                                x2Index: projBreakIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: projBreakIdx, y1Price: targetPrice,
                                x2Index: projBreakIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, projBreakIdx),
                                x2Time: safeTime(candles, projBreakIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: startIdx,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : endIdx,
                    });
                }
            }

            // 2.1.D Rising Wedge: both slope up, lower steeper than upper (converging bearish)
            else if (
                upperDropRatio < -0.15 &&
                lowerRiseRatio > Math.abs(upperDropRatio) * 1.35 &&
                endHeight < baseHeight * 0.72
            ) {
                const projEndIdx = endIdx + 10;
                const targetPrice = Math.max(0.0001, l1.price);
                const breakRef = lowerAt(endIdx);
                const targetPct = ((targetPrice - breakRef) / breakRef) * 100;
                const lifecycle = evaluatePatternLifecycle(
                    candles,
                    volSma,
                    endIdx,
                    'bearish',
                    l1.price,
                    targetPrice,
                    h2.price,
                    baseHeight,
                    lowerSlope,
                    l1.index
                );
                const breakoutIdx =
                    lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                const projBreakIdx =
                    breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, endIdx + 4);
                const color = '#EF5350';

                patterns.push({
                    id: `rise_wedge_${endIdx}`,
                    category: 'continuation',
                    type: 'rising_wedge',
                    name: 'Rising Wedge (Bearish)',
                    direction: 'bearish',
                    status: lifecycle.status,
                    anchors: [
                        { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                        { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                        { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                        { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                    ],
                    fillPolygon: [
                        { index: startIdx, time: safeTime(candles, startIdx), price: upperAt(startIdx) },
                        { index: projEndIdx, time: safeTime(candles, projEndIdx), price: upperAt(projEndIdx) },
                        { index: projEndIdx, time: safeTime(candles, projEndIdx), price: lowerAt(projEndIdx) },
                        { index: startIdx, time: safeTime(candles, startIdx), price: lowerAt(startIdx) },
                    ],
                    lines: [
                        {
                            x1Index: startIdx, y1Price: upperAt(startIdx),
                            x2Index: projEndIdx, y2Price: upperAt(projEndIdx),
                            x1Time: safeTime(candles, startIdx),
                            x2Time: safeTime(candles, projEndIdx),
                            style: 'solid', role: 'upper_boundary', color,
                        },
                        {
                            x1Index: startIdx, y1Price: lowerAt(startIdx),
                            x2Index: projEndIdx, y2Price: lowerAt(projEndIdx),
                            x1Time: safeTime(candles, startIdx),
                            x2Time: safeTime(candles, projEndIdx),
                            style: 'solid', role: 'lower_boundary', color,
                        },
                        {
                            x1Index: sw1.index, y1Price: sw1.price,
                            x2Index: sw2.index, y2Price: sw2.price,
                            x1Time: sw1.time, x2Time: sw2.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: sw2.index, y1Price: sw2.price,
                            x2Index: sw3.index, y2Price: sw3.price,
                            x1Time: sw2.time, x2Time: sw3.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: sw3.index, y1Price: sw3.price,
                            x2Index: sw4.index, y2Price: sw4.price,
                            x1Time: sw3.time, x2Time: sw4.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: lifecycle.breakoutPrice || lowerAt(projBreakIdx),
                            x2Index: projBreakIdx, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, projBreakIdx),
                            style: 'dotted', role: 'measured_move', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: targetPrice,
                            x2Index: projBreakIdx + 12, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, projBreakIdx + 12),
                            style: 'dashed', role: 'target_ray', color,
                        },
                    ],
                    breakoutPrice: lifecycle.breakoutPrice,
                    breakoutIndex: lifecycle.breakoutIndex,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: startIdx,
                    endIndex: breakoutIdx !== -1 ? breakoutIdx : endIdx,
                });
            }

            // 2.1.E Falling Wedge: both slope down, upper steeper than lower (converging bullish)
            else if (
                lowerRiseRatio < -0.15 &&
                upperDropRatio > Math.abs(lowerRiseRatio) * 1.35 &&
                endHeight < baseHeight * 0.72
            ) {
                const projEndIdx = endIdx + 10;
                const targetPrice = h1.price;
                const breakRef = upperAt(endIdx);
                const targetPct = ((targetPrice - breakRef) / breakRef) * 100;
                const lifecycle = evaluatePatternLifecycle(
                    candles,
                    volSma,
                    endIdx,
                    'bullish',
                    h1.price,
                    targetPrice,
                    l2.price,
                    baseHeight,
                    upperSlope,
                    h1.index
                );
                const breakoutIdx =
                    lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                const projBreakIdx =
                    breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, endIdx + 4);
                const color = '#26A69A';

                patterns.push({
                    id: `fall_wedge_${endIdx}`,
                    category: 'continuation',
                    type: 'falling_wedge',
                    name: 'Falling Wedge (Bullish)',
                    direction: 'bullish',
                    status: lifecycle.status,
                    anchors: [
                        { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                        { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                        { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                        { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                    ],
                    fillPolygon: [
                        { index: startIdx, time: safeTime(candles, startIdx), price: upperAt(startIdx) },
                        { index: projEndIdx, time: safeTime(candles, projEndIdx), price: upperAt(projEndIdx) },
                        { index: projEndIdx, time: safeTime(candles, projEndIdx), price: lowerAt(projEndIdx) },
                        { index: startIdx, time: safeTime(candles, startIdx), price: lowerAt(startIdx) },
                    ],
                    lines: [
                        {
                            x1Index: startIdx, y1Price: upperAt(startIdx),
                            x2Index: projEndIdx, y2Price: upperAt(projEndIdx),
                            x1Time: safeTime(candles, startIdx),
                            x2Time: safeTime(candles, projEndIdx),
                            style: 'solid', role: 'upper_boundary', color,
                        },
                        {
                            x1Index: startIdx, y1Price: lowerAt(startIdx),
                            x2Index: projEndIdx, y2Price: lowerAt(projEndIdx),
                            x1Time: safeTime(candles, startIdx),
                            x2Time: safeTime(candles, projEndIdx),
                            style: 'solid', role: 'lower_boundary', color,
                        },
                        {
                            x1Index: sw1.index, y1Price: sw1.price,
                            x2Index: sw2.index, y2Price: sw2.price,
                            x1Time: sw1.time, x2Time: sw2.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: sw2.index, y1Price: sw2.price,
                            x2Index: sw3.index, y2Price: sw3.price,
                            x1Time: sw2.time, x2Time: sw3.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: sw3.index, y1Price: sw3.price,
                            x2Index: sw4.index, y2Price: sw4.price,
                            x1Time: sw3.time, x2Time: sw4.time,
                            style: 'solid', role: 'connector', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: lifecycle.breakoutPrice || upperAt(projBreakIdx),
                            x2Index: projBreakIdx, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, projBreakIdx),
                            style: 'dotted', role: 'measured_move', color,
                        },
                        {
                            x1Index: projBreakIdx, y1Price: targetPrice,
                            x2Index: projBreakIdx + 12, y2Price: targetPrice,
                            x1Time: safeTime(candles, projBreakIdx),
                            x2Time: safeTime(candles, projBreakIdx + 12),
                            style: 'dashed', role: 'target_ray', color,
                        },
                    ],
                    breakoutPrice: lifecycle.breakoutPrice,
                    breakoutIndex: lifecycle.breakoutIndex,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: startIdx,
                    endIndex: breakoutIdx !== -1 ? breakoutIdx : endIdx,
                });
            }

            // 2.1.F Bullish & Bearish Rectangles: both upper and lower lines horizontal (Bab 21.2)
            else if (isUpperFlat && isLowerFlat && span >= 16) {
                const resPrice = (h1.price + h2.price) / 2;
                const supPrice = (l1.price + l2.price) / 2;
                const rangeHeight = resPrice - supPrice;

                if (rangeHeight >= localAtr * 1.8) {
                    const isUptrend = hasContinuationPriorTrend(
                        candles,
                        atr,
                        startIdx,
                        'uptrend',
                        25,
                        1.4
                    );
                    const targetPrice = isUptrend
                        ? resPrice + rangeHeight
                        : calcBearishTarget(supPrice, rangeHeight);
                    const breakRef = isUptrend ? resPrice : supPrice;
                    const targetPct = ((targetPrice - breakRef) / breakRef) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        endIdx,
                        isUptrend ? 'bullish' : 'bearish',
                        breakRef,
                        targetPrice,
                        isUptrend ? supPrice : resPrice,
                        rangeHeight
                    );
                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const boxRightIdx =
                        breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, endIdx + 4);
                    const color = isUptrend ? '#26A69A' : '#EF5350';

                    patterns.push({
                        id: `rect_${endIdx}`,
                        category: 'continuation',
                        type: isUptrend ? 'bullish_rectangle' : 'bearish_rectangle',
                        name: isUptrend ? 'Bullish Rectangle' : 'Bearish Rectangle',
                        direction: isUptrend ? 'bullish' : 'bearish',
                        status: lifecycle.status,
                        anchors: [
                            { index: h1.index, time: h1.time, price: h1.price, label: 'R1' },
                            { index: l1.index, time: l1.time, price: l1.price, label: 'S1' },
                            { index: h2.index, time: h2.time, price: h2.price, label: 'R2' },
                            { index: l2.index, time: l2.time, price: l2.price, label: 'S2' },
                        ],
                        fillPolygon: [
                            { index: startIdx, time: safeTime(candles, startIdx), price: resPrice },
                            { index: boxRightIdx, time: safeTime(candles, boxRightIdx), price: resPrice },
                            { index: boxRightIdx, time: safeTime(candles, boxRightIdx), price: supPrice },
                            { index: startIdx, time: safeTime(candles, startIdx), price: supPrice },
                        ],
                        lines: [
                            {
                                x1Index: startIdx, y1Price: resPrice,
                                x2Index: boxRightIdx, y2Price: resPrice,
                                x1Time: safeTime(candles, startIdx),
                                x2Time: safeTime(candles, boxRightIdx),
                                style: 'solid', role: 'upper_boundary', color,
                            },
                            {
                                x1Index: startIdx, y1Price: supPrice,
                                x2Index: boxRightIdx, y2Price: supPrice,
                                x1Time: safeTime(candles, startIdx),
                                x2Time: safeTime(candles, boxRightIdx),
                                style: 'solid', role: 'lower_boundary', color,
                            },
                            {
                                x1Index: startIdx, y1Price: supPrice,
                                x2Index: startIdx, y2Price: resPrice,
                                x1Time: safeTime(candles, startIdx),
                                x2Time: safeTime(candles, startIdx),
                                style: 'dashed', role: 'box_wall', color,
                            },
                            {
                                x1Index: boxRightIdx, y1Price: supPrice,
                                x2Index: boxRightIdx, y2Price: resPrice,
                                x1Time: safeTime(candles, boxRightIdx),
                                x2Time: safeTime(candles, boxRightIdx),
                                style: 'dashed', role: 'box_wall', color,
                            },
                            {
                                x1Index: boxRightIdx, y1Price: breakRef,
                                x2Index: boxRightIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, boxRightIdx),
                                x2Time: safeTime(candles, boxRightIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: boxRightIdx, y1Price: targetPrice,
                                x2Index: boxRightIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, boxRightIdx),
                                x2Time: safeTime(candles, boxRightIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: startIdx,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : endIdx,
                    });
                }
            }
        }

        // --- 2.2 Flags & Pennants (4 Swings: Impulse Flagpole + 3-Pivot Consolidation) ---
        for (let i = 0; i < swings.length - 3; i++) {
            const origin = swings[i];
            const poleTip = swings[i + 1];
            const cons1 = swings[i + 2];
            const cons2 = swings[i + 3];

            const poleBars = poleTip.index - origin.index;
            const consBars = cons2.index - poleTip.index;
            if (poleBars < 3 || poleBars > 12 || consBars < 4 || consBars > 22) continue;

            const localAtr = atr[poleTip.index] || poleTip.price * 0.005;

            // Bullish Flag & Bullish Pennant
            if (
                origin.type === 'low' &&
                poleTip.type === 'high' &&
                cons1.type === 'low' &&
                cons2.type === 'high'
            ) {
                const poleHeight = poleTip.price - origin.price;
                if (poleHeight < localAtr * 2.8) continue;

                const retraceDepth = (poleTip.price - cons1.price) / poleHeight;
                if (
                    retraceDepth >= 0.15 &&
                    retraceDepth <= 0.5 &&
                    cons2.price <= poleTip.price + poleHeight * 0.05
                ) {
                    const upperSlope = (cons2.price - poleTip.price) / (cons2.index - poleTip.index);
                    const isPennant =
                        upperSlope < 0 &&
                        cons2.price - cons1.price < (poleTip.price - cons1.price) * 0.75;
                    const lowerSlope = isPennant
                        ? (cons1.price + (poleTip.price - cons2.price) * 0.5 - cons1.price) /
                          Math.max(1, cons2.index - cons1.index)
                        : upperSlope;

                    const targetPrice = cons1.price + poleHeight; // AB = CD
                    const breakLevel = cons2.price;
                    const targetPct = ((targetPrice - breakLevel) / breakLevel) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        cons2.index,
                        'bullish',
                        breakLevel,
                        targetPrice,
                        cons1.price,
                        poleHeight,
                        upperSlope,
                        poleTip.index,
                        18
                    );

                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const flagEndIdx =
                        breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, cons2.index + 3);
                    const upperEndPrice = poleTip.price + upperSlope * (flagEndIdx - poleTip.index);
                    const lowerStartPrice = cons1.price - lowerSlope * (cons1.index - poleTip.index);
                    const lowerEndPrice = cons1.price + lowerSlope * (flagEndIdx - cons1.index);
                    const color = '#26A69A';

                    patterns.push({
                        id: `${isPennant ? 'bull_pennant' : 'bull_flag'}_${cons2.index}`,
                        category: 'continuation',
                        type: isPennant ? 'bullish_pennant' : 'bullish_flag',
                        name: isPennant ? 'Bullish Pennant (AB=CD)' : 'Bullish Flag (AB=CD)',
                        direction: 'bullish',
                        status: lifecycle.status,
                        anchors: [
                            { index: origin.index, time: origin.time, price: origin.price, label: 'A' },
                            { index: poleTip.index, time: poleTip.time, price: poleTip.price, label: 'B' },
                            { index: cons1.index, time: cons1.time, price: cons1.price, label: 'C' },
                            { index: cons2.index, time: cons2.time, price: cons2.price, label: 'D' },
                        ],
                        fillPolygon: [
                            { index: poleTip.index, time: poleTip.time, price: poleTip.price },
                            { index: flagEndIdx, time: safeTime(candles, flagEndIdx), price: upperEndPrice },
                            { index: flagEndIdx, time: safeTime(candles, flagEndIdx), price: lowerEndPrice },
                            { index: poleTip.index, time: poleTip.time, price: lowerStartPrice },
                        ],
                        lines: [
                            {
                                x1Index: origin.index, y1Price: origin.price,
                                x2Index: poleTip.index, y2Price: poleTip.price,
                                x1Time: origin.time, x2Time: poleTip.time,
                                style: 'solid', role: 'flagpole', color,
                            },
                            {
                                x1Index: poleTip.index, y1Price: poleTip.price,
                                x2Index: flagEndIdx, y2Price: upperEndPrice,
                                x1Time: poleTip.time, x2Time: safeTime(candles, flagEndIdx),
                                style: 'solid', role: 'upper_boundary', color,
                            },
                            {
                                x1Index: poleTip.index, y1Price: lowerStartPrice,
                                x2Index: flagEndIdx, y2Price: lowerEndPrice,
                                x1Time: poleTip.time, x2Time: safeTime(candles, flagEndIdx),
                                style: 'solid', role: 'lower_boundary', color,
                            },
                            {
                                x1Index: flagEndIdx, y1Price: lifecycle.breakoutPrice || upperEndPrice,
                                x2Index: flagEndIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, flagEndIdx),
                                x2Time: safeTime(candles, flagEndIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: flagEndIdx, y1Price: targetPrice,
                                x2Index: flagEndIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, flagEndIdx),
                                x2Time: safeTime(candles, flagEndIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: origin.index,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : cons2.index,
                    });
                }
            }

            // Bearish Flag & Bearish Pennant
            if (
                origin.type === 'high' &&
                poleTip.type === 'low' &&
                cons1.type === 'high' &&
                cons2.type === 'low'
            ) {
                const poleHeight = origin.price - poleTip.price;
                if (poleHeight < localAtr * 2.8) continue;

                const retraceDepth = (cons1.price - poleTip.price) / poleHeight;
                if (
                    retraceDepth >= 0.15 &&
                    retraceDepth <= 0.5 &&
                    cons2.price >= poleTip.price - poleHeight * 0.05
                ) {
                    const lowerSlope = (cons2.price - poleTip.price) / (cons2.index - poleTip.index);
                    const isPennant =
                        lowerSlope > 0 &&
                        cons1.price - cons2.price < (cons1.price - poleTip.price) * 0.75;
                    const upperSlope = isPennant
                        ? -((cons2.price - poleTip.price) * 0.5) /
                          Math.max(1, cons2.index - cons1.index)
                        : lowerSlope;

                    const targetPrice = calcBearishTarget(cons1.price, poleHeight); // AB = CD
                    const breakLevel = cons2.price;
                    const targetPct = ((targetPrice - breakLevel) / breakLevel) * 100;

                    const lifecycle = evaluatePatternLifecycle(
                        candles,
                        volSma,
                        cons2.index,
                        'bearish',
                        breakLevel,
                        targetPrice,
                        cons1.price,
                        poleHeight,
                        lowerSlope,
                        poleTip.index,
                        18
                    );

                    const breakoutIdx =
                        lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                    const flagEndIdx =
                        breakoutIdx !== -1 ? breakoutIdx : Math.max(n - 1, cons2.index + 3);
                    const lowerEndPrice = poleTip.price + lowerSlope * (flagEndIdx - poleTip.index);
                    const upperStartPrice = cons1.price - upperSlope * (cons1.index - poleTip.index);
                    const upperEndPrice = cons1.price + upperSlope * (flagEndIdx - cons1.index);
                    const color = '#EF5350';

                    patterns.push({
                        id: `${isPennant ? 'bear_pennant' : 'bear_flag'}_${cons2.index}`,
                        category: 'continuation',
                        type: isPennant ? 'bearish_pennant' : 'bearish_flag',
                        name: isPennant ? 'Bearish Pennant (AB=CD)' : 'Bearish Flag (AB=CD)',
                        direction: 'bearish',
                        status: lifecycle.status,
                        anchors: [
                            { index: origin.index, time: origin.time, price: origin.price, label: 'A' },
                            { index: poleTip.index, time: poleTip.time, price: poleTip.price, label: 'B' },
                            { index: cons1.index, time: cons1.time, price: cons1.price, label: 'C' },
                            { index: cons2.index, time: cons2.time, price: cons2.price, label: 'D' },
                        ],
                        fillPolygon: [
                            { index: poleTip.index, time: poleTip.time, price: upperStartPrice },
                            { index: flagEndIdx, time: safeTime(candles, flagEndIdx), price: upperEndPrice },
                            { index: flagEndIdx, time: safeTime(candles, flagEndIdx), price: lowerEndPrice },
                            { index: poleTip.index, time: poleTip.time, price: poleTip.price },
                        ],
                        lines: [
                            {
                                x1Index: origin.index, y1Price: origin.price,
                                x2Index: poleTip.index, y2Price: poleTip.price,
                                x1Time: origin.time, x2Time: poleTip.time,
                                style: 'solid', role: 'flagpole', color,
                            },
                            {
                                x1Index: poleTip.index, y1Price: upperStartPrice,
                                x2Index: flagEndIdx, y2Price: upperEndPrice,
                                x1Time: poleTip.time, x2Time: safeTime(candles, flagEndIdx),
                                style: 'solid', role: 'upper_boundary', color,
                            },
                            {
                                x1Index: poleTip.index, y1Price: poleTip.price,
                                x2Index: flagEndIdx, y2Price: lowerEndPrice,
                                x1Time: poleTip.time, x2Time: safeTime(candles, flagEndIdx),
                                style: 'solid', role: 'lower_boundary', color,
                            },
                            {
                                x1Index: flagEndIdx, y1Price: lifecycle.breakoutPrice || lowerEndPrice,
                                x2Index: flagEndIdx, y2Price: targetPrice,
                                x1Time: safeTime(candles, flagEndIdx),
                                x2Time: safeTime(candles, flagEndIdx),
                                style: 'dotted', role: 'measured_move', color,
                            },
                            {
                                x1Index: flagEndIdx, y1Price: targetPrice,
                                x2Index: flagEndIdx + 12, y2Price: targetPrice,
                                x1Time: safeTime(candles, flagEndIdx),
                                x2Time: safeTime(candles, flagEndIdx + 12),
                                style: 'dashed', role: 'target_ray', color,
                            },
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: origin.index,
                        endIndex: breakoutIdx !== -1 ? breakoutIdx : cons2.index,
                    });
                }
            }
        }

        // --- 2.3 Cup and Handle (Bullish Continuation - Bab 21.2) ---
        for (let i = 0; i < swings.length - 3; i++) {
            const leftRim = swings[i];
            const cupBottom = swings[i + 1];
            const rightRim = swings[i + 2];
            const handleBottom = swings[i + 3];

            if (
                leftRim.type === 'high' &&
                cupBottom.type === 'low' &&
                rightRim.type === 'high' &&
                handleBottom.type === 'low'
            ) {
                if (!hasContinuationPriorTrend(candles, atr, leftRim.index, 'uptrend', 25, 1.5)) {
                    continue;
                }

                const cupDuration = rightRim.index - leftRim.index;
                const handleDuration = handleBottom.index - rightRim.index;
                const rimLevel = (leftRim.price + rightRim.price) / 2;
                const cupDepth = rimLevel - cupBottom.price;
                const localAtr = atr[rightRim.index] || rimLevel * 0.005;

                if (cupDepth < localAtr * 2.5) continue;

                // Rims must be within 15% of cupDepth (height-normalized!)
                const rimDiffAbs = Math.abs(leftRim.price - rightRim.price);
                if (
                    cupDuration >= 15 &&
                    cupDuration <= 110 &&
                    handleDuration >= 2 &&
                    handleDuration <= Math.max(15, cupDuration * 0.4) &&
                    rimDiffAbs <= cupDepth * 0.15
                ) {
                    const handleRetrace = (rightRim.price - handleBottom.price) / cupDepth;

                    if (handleRetrace >= 0.08 && handleRetrace <= 0.5) {
                        const targetPrice = rimLevel + cupDepth;
                        const targetPct = ((targetPrice - rimLevel) / rimLevel) * 100;
                        const lifecycle = evaluatePatternLifecycle(
                            candles,
                            volSma,
                            handleBottom.index,
                            'bullish',
                            rimLevel,
                            targetPrice,
                            handleBottom.price,
                            cupDepth
                        );

                        const breakoutIdx =
                            lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                        const projBreakIdx =
                            breakoutIdx !== -1
                                ? breakoutIdx
                                : Math.max(n - 1, handleBottom.index + Math.max(3, handleDuration));
                        const color = '#26A69A';

                        patterns.push({
                            id: `cup_handle_${rightRim.index}`,
                            category: 'continuation',
                            type: 'cup_and_handle',
                            name: 'Cup and Handle',
                            direction: 'bullish',
                            status: lifecycle.status,
                            anchors: [
                                { index: leftRim.index, time: leftRim.time, price: leftRim.price, label: 'Rim L' },
                                { index: cupBottom.index, time: cupBottom.time, price: cupBottom.price, label: 'Base' },
                                { index: rightRim.index, time: rightRim.time, price: rightRim.price, label: 'Rim R' },
                                { index: handleBottom.index, time: handleBottom.time, price: handleBottom.price, label: 'Handle' },
                            ],
                            lines: [
                                {
                                    x1Index: leftRim.index,
                                    y1Price: leftRim.price,
                                    x2Index: rightRim.index,
                                    y2Price: rightRim.price,
                                    x1Time: leftRim.time,
                                    x2Time: rightRim.time,
                                    ctrlIndex: cupBottom.index,
                                    ctrlPrice: cupBottom.price,
                                    style: 'solid',
                                    role: 'cup_curve',
                                    color,
                                },
                                {
                                    x1Index: leftRim.index,
                                    y1Price: rimLevel,
                                    x2Index: projBreakIdx + 8,
                                    y2Price: rimLevel,
                                    x1Time: leftRim.time,
                                    x2Time: safeTime(candles, projBreakIdx + 8),
                                    style: 'solid',
                                    role: 'neckline',
                                    color,
                                },
                                {
                                    x1Index: rightRim.index,
                                    y1Price: rightRim.price,
                                    x2Index: handleBottom.index,
                                    y2Price: handleBottom.price,
                                    x1Time: rightRim.time,
                                    x2Time: handleBottom.time,
                                    style: 'solid',
                                    role: 'connector',
                                    color,
                                },
                                {
                                    x1Index: handleBottom.index,
                                    y1Price: handleBottom.price,
                                    x2Index: projBreakIdx,
                                    y2Price: lifecycle.breakoutPrice || rimLevel,
                                    x1Time: handleBottom.time,
                                    x2Time: safeTime(candles, projBreakIdx),
                                    style: breakoutIdx !== -1 ? 'solid' : 'dashed',
                                    role: 'connector',
                                    color,
                                },
                                {
                                    x1Index: cupBottom.index, y1Price: cupBottom.price,
                                    x2Index: cupBottom.index, y2Price: rimLevel,
                                    x1Time: cupBottom.time, x2Time: cupBottom.time,
                                    style: 'dotted', role: 'measured_move', color,
                                },
                                {
                                    x1Index: projBreakIdx, y1Price: lifecycle.breakoutPrice || rimLevel,
                                    x2Index: projBreakIdx, y2Price: targetPrice,
                                    x1Time: safeTime(candles, projBreakIdx),
                                    x2Time: safeTime(candles, projBreakIdx),
                                    style: 'dotted', role: 'measured_move', color,
                                },
                                {
                                    x1Index: projBreakIdx, y1Price: targetPrice,
                                    x2Index: projBreakIdx + 12, y2Price: targetPrice,
                                    x1Time: safeTime(candles, projBreakIdx),
                                    x2Time: safeTime(candles, projBreakIdx + 12),
                                    style: 'dashed', role: 'target_ray', color,
                                },
                            ],
                            breakoutPrice: lifecycle.breakoutPrice,
                            breakoutIndex: lifecycle.breakoutIndex,
                            breakoutTime: lifecycle.breakoutTime,
                            targetPrice,
                            targetPercent: targetPct,
                            volumeRatio: lifecycle.volumeRatio,
                            isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                            startIndex: leftRim.index,
                            endIndex: breakoutIdx !== -1 ? breakoutIdx : handleBottom.index,
                        });
                    }
                }
            }
        }
    }

    let filtered = patterns;
    if (mode !== 'all' && mode !== 'reversal' && mode !== 'continuation') {
        filtered = patterns.filter((p) => p.type === mode);
    }

    const maxAllowed =
        mode === 'all' || mode === 'reversal' || mode === 'continuation' ? 4 : 6;
    const deduplicated = deduplicatePatternsGlobal(filtered, n, maxAllowed);

    deduplicated.sort((a, b) => b.endIndex - a.endIndex);

    return deduplicated;
}