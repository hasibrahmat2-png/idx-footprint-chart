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
    x1Time: Time;
    y1Price: number;
    x2Time: Time;
    y2Price: number;
    x1Index: number;
    x2Index: number;
    style: 'solid' | 'dashed' | 'dotted';
    role: 'neckline' | 'upper_boundary' | 'lower_boundary' | 'flagpole' | 'target_ray' | 'connector' | 'measured_move' | 'box_wall' | 'cup_curve';
    color?: string;
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
}

interface SwingPoint {
    index: number;
    time: Time;
    price: number;
    type: 'high' | 'low';
}

/**
 * Detect fractal alternating swing points (ZigZag)
 */
function extractAlternatingSwings(candles: any[], scanStart: number, n: number, lookback: number = 5): SwingPoint[] {
    const rawSwings: SwingPoint[] = [];

    for (let i = scanStart + lookback; i < n - lookback; i++) {
        const cur = candles[i];
        if (cur.high === cur.low) continue; // Flat dormant candle suppression (FCA Rp 1 filter)

        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= lookback; j++) {
            if (candles[i - j].high > cur.high || candles[i + j].high > cur.high) isHigh = false;
            if (candles[i - j].low < cur.low || candles[i + j].low < cur.low) isLow = false;
        }

        if (isHigh) {
            rawSwings.push({ index: i, time: cur.time, price: cur.high, type: 'high' });
        }
        if (isLow) {
            rawSwings.push({ index: i, time: cur.time, price: cur.low, type: 'low' });
        }
    }

    rawSwings.sort((a, b) => a.index - b.index);

    // Strictly alternate High -> Low -> High -> Low
    const alternating: SwingPoint[] = [];
    for (const sw of rawSwings) {
        if (alternating.length === 0) {
            alternating.push({ ...sw });
        } else {
            const last = alternating[alternating.length - 1];
            if (last.type === sw.type) {
                if (sw.type === 'high' && sw.price > last.price) {
                    alternating[alternating.length - 1] = { ...sw };
                } else if (sw.type === 'low' && sw.price < last.price) {
                    alternating[alternating.length - 1] = { ...sw };
                }
            } else {
                alternating.push({ ...sw });
            }
        }
    }

    return alternating;
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
            sum -= (candles[i - 20].volume || 0);
            volSma[i] = sum / 20;
        }
    }
    return volSma;
}

interface PatternLifecycleResult {
    status: DetectedChartPattern['status'];
    breakoutIndex?: number;
    breakoutPrice?: number;
    breakoutTime?: Time;
    volumeRatio: number;
    isVolumeConfirmed: boolean;
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
    breakoutSlope: number = 0,
    originIndex?: number
): PatternLifecycleResult {
    const n = candles.length;
    let breakoutIdx = -1;
    let breakoutPrice = 0;
    let breakoutTime: Time | undefined = undefined;
    let status: DetectedChartPattern['status'] = 'forming';

    const origIdx = originIndex !== undefined ? originIndex : patternEndIndex;

    for (let b = patternEndIndex + 1; b < n; b++) {
        const bar = candles[b];
        if (!bar) continue;

        const curBreakLevel = breakoutSlope !== 0
            ? breakoutLevel + breakoutSlope * (b - origIdx)
            : breakoutLevel;

        if (breakoutIdx === -1) {
            // Forming phase: check breakout or early invalidation
            if (direction === 'bullish') {
                if (bar.close < invalidationLevel * 0.985) {
                    status = 'failed';
                    break;
                }
                if (bar.close > curBreakLevel) {
                    breakoutIdx = b;
                    breakoutPrice = bar.close;
                    breakoutTime = bar.time;
                    status = 'breakout';
                    // Check if the breakout candle itself reached target
                    if (bar.high >= targetPrice) {
                        status = 'target_reached';
                        break;
                    }
                }
            } else {
                if (bar.close > invalidationLevel * 1.015) {
                    status = 'failed';
                    break;
                }
                if (bar.close < curBreakLevel) {
                    breakoutIdx = b;
                    breakoutPrice = bar.close;
                    breakoutTime = bar.time;
                    status = 'breakout';
                    // Check if the breakdown candle itself reached target
                    if (bar.low <= targetPrice) {
                        status = 'target_reached';
                        break;
                    }
                }
            }
        } else {
            // Post-breakout phase: check target reached, throwback pullback, or post-breakout failure
            if (direction === 'bullish') {
                if (bar.high >= targetPrice) {
                    status = 'target_reached';
                    break;
                }
                if (bar.close < curBreakLevel * 0.97) {
                    status = 'failed';
                    break;
                }
                if (bar.low <= curBreakLevel * 1.015 && bar.close >= curBreakLevel * 0.99) {
                    status = 'pullback';
                }
            } else {
                if (bar.low <= targetPrice) {
                    status = 'target_reached';
                    break;
                }
                if (bar.close > curBreakLevel * 1.03) {
                    status = 'failed';
                    break;
                }
                if (bar.high >= curBreakLevel * 0.985 && bar.close <= curBreakLevel * 1.01) {
                    status = 'pullback';
                }
            }
        }
    }

    const evalBarIdx = breakoutIdx !== -1 ? breakoutIdx : patternEndIndex;
    const v = (candles[evalBarIdx]?.volume) || 0;
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
    };
}

/**
 * Deduplicate and cluster overlapping patterns using Non-Maximum Suppression (NMS).
 * Eliminates bunched/stacked duplicates (e.g. 10 Triple Tops within 15 bars on Forex)
 * and resolves cross-pattern conflicts (e.g. Triple Top vs Double Top).
 */
function deduplicatePatterns(patterns: DetectedChartPattern[], isForex: boolean): DetectedChartPattern[] {
    if (patterns.length <= 1) return patterns;

    const byType = new Map<PatternType, DetectedChartPattern[]>();
    for (const pat of patterns) {
        if (!byType.has(pat.type)) {
            byType.set(pat.type, []);
        }
        byType.get(pat.type)!.push(pat);
    }

    const deduplicated: DetectedChartPattern[] = [];
    const minDistance = isForex ? 30 : 20;

    for (const [, group] of byType.entries()) {
        if (group.length === 1) {
            deduplicated.push(group[0]);
            continue;
        }

        // Rank by Quality Score:
        // 1. target_reached (300) > breakout (200) > pullback (150) > forming (100) > failed (0)
        // 2. volume confirmed (+50)
        // 3. greater span (more solid formation)
        // 4. most recent end index
        const scored = group.map(p => {
            let score = 0;
            if (p.status === 'target_reached') score += 300;
            else if (p.status === 'breakout') score += 200;
            else if (p.status === 'pullback') score += 150;
            else if (p.status === 'forming') score += 100;

            if (p.isVolumeConfirmed) score += 50;

            const span = p.endIndex - p.startIndex;
            score += Math.min(100, span);
            score += p.endIndex * 0.1;
            return { pat: p, score };
        });

        scored.sort((a, b) => b.score - a.score);

        const retained: DetectedChartPattern[] = [];

        for (const item of scored) {
            const p = item.pat;
            let isDuplicate = false;

            for (const existing of retained) {
                const endDist = Math.abs(p.endIndex - existing.endIndex);
                const startDist = Math.abs(p.startIndex - existing.startIndex);

                const overlapStart = Math.max(p.startIndex, existing.startIndex);
                const overlapEnd = Math.min(p.endIndex, existing.endIndex);
                const overlap = Math.max(0, overlapEnd - overlapStart);
                const minSpan = Math.min(p.endIndex - p.startIndex, existing.endIndex - existing.startIndex);

                const priceDiff = Math.abs(p.targetPrice - existing.targetPrice) / Math.max(p.targetPrice, existing.targetPrice);

                if (
                    (endDist <= minDistance && priceDiff <= 0.08) ||
                    (startDist <= minDistance && priceDiff <= 0.08) ||
                    (minSpan > 0 && overlap / minSpan >= 0.35)
                ) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                retained.push(p);
            }
        }

        deduplicated.push(...retained);
    }

    // Cross-pattern suppression (e.g. Triple Top dominates Double Top in the same region)
    const result: DetectedChartPattern[] = [];
    for (const pat of deduplicated) {
        let isSuppressed = false;

        // If pat is double_top, check if any triple_top or head_and_shoulders covers it
        if (pat.type === 'double_top' || pat.type === 'horn_top') {
            for (const other of deduplicated) {
                if (other.type === 'triple_top' || other.type === 'head_and_shoulders') {
                    if (pat.startIndex >= other.startIndex - 5 && pat.endIndex <= other.endIndex + 15) {
                        isSuppressed = true;
                        break;
                    }
                }
            }
        }
        // If pat is double_bottom, check if any triple_bottom or inverted_head_and_shoulders covers it
        else if (pat.type === 'double_bottom' || pat.type === 'horn_bottom') {
            for (const other of deduplicated) {
                if (other.type === 'triple_bottom' || other.type === 'inverted_head_and_shoulders') {
                    if (pat.startIndex >= other.startIndex - 5 && pat.endIndex <= other.endIndex + 15) {
                        isSuppressed = true;
                        break;
                    }
                }
            }
        }

        if (!isSuppressed) {
            result.push(pat);
        }
    }

    return result;
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
    if (!candles || candles.length < 30) return [];

    const n = candles.length;
    const scanStart = Math.max(0, n - 350); // Bounded to 350 bars for 60 FPS performance on Chromebook
    const lookback = _isForex ? (n > 200 ? 7 : 5) : (n > 200 ? 5 : 4);
    const tolerance = _isForex ? 0.008 : 0.035;
    const swings = extractAlternatingSwings(candles, scanStart, n, lookback);
    if (swings.length < 5) return [];

    const volSma = computeVolumeSma20(candles);
    const patterns: DetectedChartPattern[] = [];

    const shouldScanReversal = mode === 'all' || mode === 'reversal' || REVERSAL_PATTERN_TYPES.includes(mode as PatternType);
    const shouldScanContinuation = mode === 'all' || mode === 'continuation' || CONTINUATION_PATTERN_TYPES.includes(mode as PatternType);

    // =========================================================================
    // 1. BAB 21.1: REVERSAL CHART PATTERNS
    // =========================================================================
    if (shouldScanReversal) {
        // --- 1.1 Head and Shoulders (Bearish Reversal) ---
        // Sequence of 5 pivots: Peak(LS) -> Valley(N1) -> Peak(H) -> Valley(N2) -> Peak(RS)
        for (let i = 0; i < swings.length - 4; i++) {
            const ls = swings[i];
            const n1 = swings[i + 1];
            const head = swings[i + 2];
            const n2 = swings[i + 3];
            const rs = swings[i + 4];

            if (ls.type === 'high' && n1.type === 'low' && head.type === 'high' && n2.type === 'low' && rs.type === 'high') {
                // Head must be strictly higher than both shoulders
                if (head.price > ls.price * 1.02 && head.price > rs.price * 1.02) {
                    // Shoulders should be roughly symmetrical in height (within 8%)
                    const shoulderDiff = Math.abs(ls.price - rs.price) / Math.max(ls.price, rs.price);
                    if (shoulderDiff <= 0.08) {
                        // Neckline slope check (n1 to n2)
                        const neckSlope = (n2.price - n1.price) / (n2.index - n1.index);
                        const headNecklinePrice = n1.price + neckSlope * (head.index - n1.index);
                        const headHeight = head.price - headNecklinePrice;

                        if (headHeight > 0) {
                            const estTarget = Math.max(1, (n1.price + neckSlope * (rs.index - n1.index)) - headHeight);
                            const lifecycle = evaluatePatternLifecycle(
                                candles, volSma, rs.index, 'bearish',
                                n1.price, estTarget, head.price,
                                neckSlope, n1.index
                            );

                            const breakoutPrice = lifecycle.breakoutPrice || 0;
                            const breakoutIdx = lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                            const targetPrice = breakoutIdx !== -1
                                ? Math.max(1, breakoutPrice - headHeight)
                                : estTarget;
                            const targetPct = breakoutPrice > 0 ? ((targetPrice - breakoutPrice) / breakoutPrice) * 100 : -10;

                            let status = lifecycle.status;
                            let specialFlag: DetectedChartPattern['specialFlag'];
                            if (status === 'failed' && breakoutIdx !== -1) {
                                specialFlag = 'hound_of_baskervilles';
                            }

                            patterns.push({
                                id: `hs_${head.index}`,
                                category: 'reversal',
                                type: 'head_and_shoulders',
                                name: specialFlag === 'hound_of_baskervilles'
                                    ? 'Head & Shoulders (Hound of Baskervilles Bullish Trap)'
                                    : 'Head & Shoulders',
                                direction: specialFlag === 'hound_of_baskervilles' ? 'bullish' : 'bearish',
                                status,
                                anchors: [
                                    { index: ls.index, time: ls.time, price: ls.price, label: 'LS' },
                                    { index: n1.index, time: n1.time, price: n1.price, label: 'N1' },
                                    { index: head.index, time: head.time, price: head.price, label: 'H' },
                                    { index: n2.index, time: n2.time, price: n2.price, label: 'N2' },
                                    { index: rs.index, time: rs.time, price: rs.price, label: 'RS' },
                                ],
                                lines: [
                                    // 1. Dotted contour tracing the entire Head & Shoulders silhouette
                                    {
                                        x1Index: ls.index, y1Price: ls.price,
                                        x2Index: n1.index, y2Price: n1.price,
                                        x1Time: ls.time, x2Time: n1.time,
                                        style: 'dotted', role: 'connector', color: '#EF5350'
                                    },
                                    {
                                        x1Index: n1.index, y1Price: n1.price,
                                        x2Index: head.index, y2Price: head.price,
                                        x1Time: n1.time, x2Time: head.time,
                                        style: 'dotted', role: 'connector', color: '#EF5350'
                                    },
                                    {
                                        x1Index: head.index, y1Price: head.price,
                                        x2Index: n2.index, y2Price: n2.price,
                                        x1Time: head.time, x2Time: n2.time,
                                        style: 'dotted', role: 'connector', color: '#EF5350'
                                    },
                                    {
                                        x1Index: n2.index, y1Price: n2.price,
                                        x2Index: rs.index, y2Price: rs.price,
                                        x1Time: n2.time, x2Time: rs.time,
                                        style: 'dotted', role: 'connector', color: '#EF5350'
                                    },
                                    {
                                        x1Index: rs.index, y1Price: rs.price,
                                        x2Index: breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, rs.index + 5),
                                        y2Price: breakoutIdx !== -1 ? breakoutPrice : (n1.price + neckSlope * (rs.index + 5 - n1.index)),
                                        x1Time: rs.time,
                                        x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, rs.index + 5)].time,
                                        style: 'dotted', role: 'connector', color: '#EF5350'
                                    },
                                    // 2. Neckline
                                    {
                                        x1Index: n1.index,
                                        y1Price: n1.price,
                                        x2Index: Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 15 : rs.index + 20)),
                                        y2Price: n1.price + neckSlope * ((breakoutIdx !== -1 ? breakoutIdx + 15 : rs.index + 20) - n1.index),
                                        x1Time: n1.time,
                                        x2Time: candles[Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 15 : rs.index + 20))].time,
                                        style: 'solid',
                                        role: 'neckline',
                                        color: '#EF5350',
                                    },
                                    // 3. Measured Move vertical lines
                                    {
                                        x1Index: head.index, y1Price: head.price,
                                        x2Index: head.index, y2Price: headNecklinePrice,
                                        x1Time: head.time, x2Time: head.time,
                                        style: 'dotted', role: 'measured_move', color: 'rgba(239, 83, 80, 0.75)'
                                    },
                                    {
                                        x1Index: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                                        y1Price: breakoutIdx !== -1 ? breakoutPrice : (n1.price + neckSlope * (rs.index - n1.index)),
                                        x2Index: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                                        y2Price: targetPrice,
                                        x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : rs.index].time,
                                        x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : rs.index].time,
                                        style: 'dotted', role: 'measured_move', color: 'rgba(239, 83, 80, 0.75)'
                                    },
                                    // 4. Target Ray
                                    {
                                        x1Index: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                                        y1Price: targetPrice,
                                        x2Index: Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : rs.index + 25)),
                                        y2Price: targetPrice,
                                        x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : rs.index].time,
                                        x2Time: candles[Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : rs.index + 25))].time,
                                        style: 'dashed',
                                        role: 'target_ray',
                                        color: '#EF5350',
                                    }
                                ],
                                breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                                breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                                breakoutTime: lifecycle.breakoutTime,
                                targetPrice,
                                targetPercent: targetPct,
                                volumeRatio: lifecycle.volumeRatio,
                                isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                                specialFlag,
                                startIndex: ls.index,
                                endIndex: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                            });
                        }
                    }
                }
            }

            // --- 1.2 Inverted Head and Shoulders (Bullish Reversal) ---
            if (ls.type === 'low' && n1.type === 'high' && head.type === 'low' && n2.type === 'high' && rs.type === 'low') {
                if (head.price < ls.price * 0.98 && head.price < rs.price * 0.98) {
                    const shoulderDiff = Math.abs(ls.price - rs.price) / Math.max(ls.price, rs.price);
                    if (shoulderDiff <= 0.08) {
                        const neckSlope = (n2.price - n1.price) / (n2.index - n1.index);
                        const headNecklinePrice = n1.price + neckSlope * (head.index - n1.index);
                        const headHeight = headNecklinePrice - head.price;

                        if (headHeight > 0) {
                            const estTarget = (n1.price + neckSlope * (rs.index - n1.index)) + headHeight;
                            const lifecycle = evaluatePatternLifecycle(
                                candles, volSma, rs.index, 'bullish',
                                n1.price, estTarget, head.price,
                                neckSlope, n1.index
                            );

                            const breakoutPrice = lifecycle.breakoutPrice || 0;
                            const breakoutIdx = lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;
                            const targetPrice = breakoutIdx !== -1
                                ? breakoutPrice + headHeight
                                : estTarget;
                            const targetPct = breakoutPrice > 0 ? ((targetPrice - breakoutPrice) / breakoutPrice) * 100 : 10;

                            let status = lifecycle.status;
                            let specialFlag: DetectedChartPattern['specialFlag'];
                            if (status === 'failed' && breakoutIdx !== -1) {
                                specialFlag = 'hound_of_baskervilles';
                            }

                            patterns.push({
                                id: `ihs_${head.index}`,
                                category: 'reversal',
                                type: 'inverted_head_and_shoulders',
                                name: specialFlag === 'hound_of_baskervilles'
                                    ? 'Inverted H&S (Hound of Baskervilles Bearish Trap)'
                                    : 'Inverted Head & Shoulders',
                                direction: specialFlag === 'hound_of_baskervilles' ? 'bearish' : 'bullish',
                                status,
                                anchors: [
                                    { index: ls.index, time: ls.time, price: ls.price, label: 'LS' },
                                    { index: n1.index, time: n1.time, price: n1.price, label: 'N1' },
                                    { index: head.index, time: head.time, price: head.price, label: 'H' },
                                    { index: n2.index, time: n2.time, price: n2.price, label: 'N2' },
                                    { index: rs.index, time: rs.time, price: rs.price, label: 'RS' },
                                ],
                                lines: [
                                    // 1. Dotted contour tracing the entire Inverted H&S silhouette
                                    {
                                        x1Index: ls.index, y1Price: ls.price,
                                        x2Index: n1.index, y2Price: n1.price,
                                        x1Time: ls.time, x2Time: n1.time,
                                        style: 'dotted', role: 'connector', color: '#26A69A'
                                    },
                                    {
                                        x1Index: n1.index, y1Price: n1.price,
                                        x2Index: head.index, y2Price: head.price,
                                        x1Time: n1.time, x2Time: head.time,
                                        style: 'dotted', role: 'connector', color: '#26A69A'
                                    },
                                    {
                                        x1Index: head.index, y1Price: head.price,
                                        x2Index: n2.index, y2Price: n2.price,
                                        x1Time: head.time, x2Time: n2.time,
                                        style: 'dotted', role: 'connector', color: '#26A69A'
                                    },
                                    {
                                        x1Index: n2.index, y1Price: n2.price,
                                        x2Index: rs.index, y2Price: rs.price,
                                        x1Time: n2.time, x2Time: rs.time,
                                        style: 'dotted', role: 'connector', color: '#26A69A'
                                    },
                                    {
                                        x1Index: rs.index, y1Price: rs.price,
                                        x2Index: breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, rs.index + 5),
                                        y2Price: breakoutIdx !== -1 ? breakoutPrice : (n1.price + neckSlope * (rs.index + 5 - n1.index)),
                                        x1Time: rs.time,
                                        x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, rs.index + 5)].time,
                                        style: 'dotted', role: 'connector', color: '#26A69A'
                                    },
                                    // 2. Neckline
                                    {
                                        x1Index: n1.index,
                                        y1Price: n1.price,
                                        x2Index: Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 15 : rs.index + 20)),
                                        y2Price: n1.price + neckSlope * ((breakoutIdx !== -1 ? breakoutIdx + 15 : rs.index + 20) - n1.index),
                                        x1Time: n1.time,
                                        x2Time: candles[Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 15 : rs.index + 20))].time,
                                        style: 'solid',
                                        role: 'neckline',
                                        color: '#26A69A',
                                    },
                                    // 3. Measured Move vertical lines
                                    {
                                        x1Index: head.index, y1Price: head.price,
                                        x2Index: head.index, y2Price: headNecklinePrice,
                                        x1Time: head.time, x2Time: head.time,
                                        style: 'dotted', role: 'measured_move', color: 'rgba(38, 166, 154, 0.75)'
                                    },
                                    {
                                        x1Index: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                                        y1Price: breakoutIdx !== -1 ? breakoutPrice : (n1.price + neckSlope * (rs.index - n1.index)),
                                        x2Index: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                                        y2Price: targetPrice,
                                        x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : rs.index].time,
                                        x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : rs.index].time,
                                        style: 'dotted', role: 'measured_move', color: 'rgba(38, 166, 154, 0.75)'
                                    },
                                    // 4. Target Ray
                                    {
                                        x1Index: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                                        y1Price: targetPrice,
                                        x2Index: Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : rs.index + 25)),
                                        y2Price: targetPrice,
                                        x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : rs.index].time,
                                        x2Time: candles[Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : rs.index + 25))].time,
                                        style: 'dashed',
                                        role: 'target_ray',
                                        color: '#26A69A',
                                    }
                                ],
                                breakoutPrice: breakoutPrice > 0 ? breakoutPrice : undefined,
                                breakoutIndex: breakoutIdx !== -1 ? breakoutIdx : undefined,
                                breakoutTime: lifecycle.breakoutTime,
                                targetPrice,
                                targetPercent: targetPct,
                                volumeRatio: lifecycle.volumeRatio,
                                isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                                specialFlag,
                                startIndex: ls.index,
                                endIndex: breakoutIdx !== -1 ? breakoutIdx : rs.index,
                            });
                        }
                    }
                }
            }
        }

        // --- 1.3 Double Tops & Double Bottoms (M & W Shapes) ---
        for (let i = 0; i < swings.length - 2; i++) {
            const p1 = swings[i];
            const mid = swings[i + 1];
            const p2 = swings[i + 2];

            // Double Tops (M-Shape): Peak -> Valley -> Peak
            if (p1.type === 'high' && mid.type === 'low' && p2.type === 'high') {
                const barSpan = p2.index - p1.index;
                const topDiff = Math.abs(p1.price - p2.price) / Math.max(p1.price, p2.price);
                const isHorn = barSpan >= 3 && barSpan <= 7;
                const isDoubleTop = !isHorn && barSpan >= 8 && barSpan <= 60 && topDiff <= tolerance;

                if (isDoubleTop || isHorn) {
                    const height = Math.max(p1.price, p2.price) - mid.price;
                    if (height > 0) {
                        const targetPrice = isHorn
                            ? (mid.price - height * 0.75) // Horn targets prior base swing
                            : Math.max(1, mid.price - height);
                        const targetPct = mid.price > 0 ? ((targetPrice - mid.price) / mid.price) * 100 : -5;

                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, p2.index, 'bearish',
                            mid.price, targetPrice, Math.max(p1.price, p2.price)
                        );

                        const breakoutPrice = lifecycle.breakoutPrice || 0;
                        const breakoutIdx = lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;

                        patterns.push({
                            id: `${isHorn ? 'horn_top' : 'dt'}_${p2.index}`,
                            category: 'reversal',
                            type: isHorn ? 'horn_top' : 'double_top',
                            name: isHorn ? 'Horn Tops' : 'Double Tops (M-Shape)',
                            direction: 'bearish',
                            status: lifecycle.status,
                            anchors: [
                                { index: p1.index, time: p1.time, price: p1.price, label: 'T1' },
                                { index: mid.index, time: mid.time, price: mid.price, label: 'Valley' },
                                { index: p2.index, time: p2.time, price: p2.price, label: 'T2' },
                            ],
                            lines: [
                                // 1. Dotted contour tracing the "M" shape
                                {
                                    x1Index: p1.index, y1Price: p1.price,
                                    x2Index: mid.index, y2Price: mid.price,
                                    x1Time: p1.time, x2Time: mid.time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                {
                                    x1Index: mid.index, y1Price: mid.price,
                                    x2Index: p2.index, y2Price: p2.price,
                                    x1Time: mid.time, x2Time: p2.time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                {
                                    x1Index: p2.index, y1Price: p2.price,
                                    x2Index: breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, p2.index + 5),
                                    y2Price: breakoutIdx !== -1 ? breakoutPrice : mid.price,
                                    x1Time: p2.time,
                                    x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, p2.index + 5)].time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                // 2. Upper boundary across peaks
                                {
                                    x1Index: p1.index, y1Price: p1.price,
                                    x2Index: Math.min(n - 1, p2.index + 5), y2Price: p2.price,
                                    x1Time: p1.time, x2Time: candles[Math.min(n - 1, p2.index + 5)].time,
                                    style: 'dotted', role: 'upper_boundary', color: '#EF5350'
                                },
                                // 3. Confirmation Neckline across Valley
                                {
                                    x1Index: mid.index,
                                    y1Price: mid.price,
                                    x2Index: Math.min(n - 1, p2.index + 15),
                                    y2Price: mid.price,
                                    x1Time: mid.time,
                                    x2Time: candles[Math.min(n - 1, p2.index + 15)].time,
                                    style: 'solid',
                                    role: 'neckline',
                                    color: '#EF5350',
                                },
                                // 4. Measured Move vertical lines
                                {
                                    x1Index: p1.index, y1Price: p1.price,
                                    x2Index: p1.index, y2Price: mid.price,
                                    x1Time: p1.time, x2Time: p1.time,
                                    style: 'dotted', role: 'measured_move', color: 'rgba(239, 83, 80, 0.75)'
                                },
                                {
                                    x1Index: breakoutIdx !== -1 ? breakoutIdx : p2.index,
                                    y1Price: breakoutIdx !== -1 ? breakoutPrice : mid.price,
                                    x2Index: breakoutIdx !== -1 ? breakoutIdx : p2.index,
                                    y2Price: targetPrice,
                                    x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : p2.index].time,
                                    x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : p2.index].time,
                                    style: 'dotted', role: 'measured_move', color: 'rgba(239, 83, 80, 0.75)'
                                },
                                // 5. Target Ray
                                {
                                    x1Index: p2.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, p2.index + 20),
                                    y2Price: targetPrice,
                                    x1Time: p2.time,
                                    x2Time: candles[Math.min(n - 1, p2.index + 20)].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#EF5350',
                                }
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

            // Double Bottoms (W-Shape): Valley -> Peak -> Valley
            if (p1.type === 'low' && mid.type === 'high' && p2.type === 'low') {
                const barSpan = p2.index - p1.index;
                const bottomDiff = Math.abs(p1.price - p2.price) / Math.max(p1.price, p2.price);
                const isHorn = barSpan >= 3 && barSpan <= 7;
                const isDoubleBottom = !isHorn && barSpan >= 8 && barSpan <= 60 && bottomDiff <= tolerance;

                if (isDoubleBottom || isHorn) {
                    const height = mid.price - Math.min(p1.price, p2.price);
                    if (height > 0) {
                        const targetPrice = mid.price + height;
                        const targetPct = mid.price > 0 ? ((targetPrice - mid.price) / mid.price) * 100 : 5;

                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, p2.index, 'bullish',
                            mid.price, targetPrice, Math.min(p1.price, p2.price)
                        );

                        const breakoutPrice = lifecycle.breakoutPrice || 0;
                        const breakoutIdx = lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;

                        patterns.push({
                            id: `${isHorn ? 'horn_bot' : 'db'}_${p2.index}`,
                            category: 'reversal',
                            type: isHorn ? 'horn_bottom' : 'double_bottom',
                            name: isHorn ? 'Horn Bottoms' : 'Double Bottoms (W-Shape)',
                            direction: 'bullish',
                            status: lifecycle.status,
                            anchors: [
                                { index: p1.index, time: p1.time, price: p1.price, label: 'B1' },
                                { index: mid.index, time: mid.time, price: mid.price, label: 'Peak' },
                                { index: p2.index, time: p2.time, price: p2.price, label: 'B2' },
                            ],
                            lines: [
                                // 1. Dotted contour tracing the "W" shape
                                {
                                    x1Index: p1.index, y1Price: p1.price,
                                    x2Index: mid.index, y2Price: mid.price,
                                    x1Time: p1.time, x2Time: mid.time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                {
                                    x1Index: mid.index, y1Price: mid.price,
                                    x2Index: p2.index, y2Price: p2.price,
                                    x1Time: mid.time, x2Time: p2.time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                {
                                    x1Index: p2.index, y1Price: p2.price,
                                    x2Index: breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, p2.index + 5),
                                    y2Price: breakoutIdx !== -1 ? breakoutPrice : mid.price,
                                    x1Time: p2.time,
                                    x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, p2.index + 5)].time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                // 2. Lower boundary across bottoms
                                {
                                    x1Index: p1.index, y1Price: p1.price,
                                    x2Index: Math.min(n - 1, p2.index + 5), y2Price: p2.price,
                                    x1Time: p1.time, x2Time: candles[Math.min(n - 1, p2.index + 5)].time,
                                    style: 'dotted', role: 'lower_boundary', color: '#26A69A'
                                },
                                // 3. Confirmation Neckline across Peak
                                {
                                    x1Index: mid.index,
                                    y1Price: mid.price,
                                    x2Index: Math.min(n - 1, p2.index + 15),
                                    y2Price: mid.price,
                                    x1Time: mid.time,
                                    x2Time: candles[Math.min(n - 1, p2.index + 15)].time,
                                    style: 'solid',
                                    role: 'neckline',
                                    color: '#26A69A',
                                },
                                // 4. Measured Move vertical lines
                                {
                                    x1Index: p1.index, y1Price: p1.price,
                                    x2Index: p1.index, y2Price: mid.price,
                                    x1Time: p1.time, x2Time: p1.time,
                                    style: 'dotted', role: 'measured_move', color: 'rgba(38, 166, 154, 0.75)'
                                },
                                {
                                    x1Index: breakoutIdx !== -1 ? breakoutIdx : p2.index,
                                    y1Price: breakoutIdx !== -1 ? breakoutPrice : mid.price,
                                    x2Index: breakoutIdx !== -1 ? breakoutIdx : p2.index,
                                    y2Price: targetPrice,
                                    x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : p2.index].time,
                                    x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : p2.index].time,
                                    style: 'dotted', role: 'measured_move', color: 'rgba(38, 166, 154, 0.75)'
                                },
                                // 5. Target Ray
                                {
                                    x1Index: p2.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, p2.index + 20),
                                    y2Price: targetPrice,
                                    x1Time: p2.time,
                                    x2Time: candles[Math.min(n - 1, p2.index + 20)].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#26A69A',
                                }
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
        }

        // --- 1.4 Triple Tops & Triple Bottoms ---
        for (let i = 0; i < swings.length - 4; i++) {
            const s1 = swings[i];
            const v1 = swings[i + 1];
            const s2 = swings[i + 2];
            const v2 = swings[i + 3];
            const s3 = swings[i + 4];

            // Triple Tops
            if (s1.type === 'high' && v1.type === 'low' && s2.type === 'high' && v2.type === 'low' && s3.type === 'high') {
                const diff1 = Math.abs(s1.price - s2.price) / s1.price;
                const diff2 = Math.abs(s2.price - s3.price) / s2.price;
                if (diff1 <= tolerance && diff2 <= tolerance) {
                    const supportPrice = Math.min(v1.price, v2.price);
                    const avgTop = (s1.price + s2.price + s3.price) / 3;
                    const height = avgTop - supportPrice;
                    if (height > 0) {
                        const targetPrice = Math.max(1, supportPrice - height);
                        const targetPct = ((targetPrice - supportPrice) / supportPrice) * 100;

                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, s3.index, 'bearish',
                            supportPrice, targetPrice, Math.max(s1.price, s2.price, s3.price)
                        );
                        const breakoutPrice = lifecycle.breakoutPrice || 0;
                        const breakoutIdx = lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;

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
                            lines: [
                                // 1. Dotted contour connecting all 3 tops and 2 valleys
                                {
                                    x1Index: s1.index, y1Price: s1.price,
                                    x2Index: v1.index, y2Price: v1.price,
                                    x1Time: s1.time, x2Time: v1.time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                {
                                    x1Index: v1.index, y1Price: v1.price,
                                    x2Index: s2.index, y2Price: s2.price,
                                    x1Time: v1.time, x2Time: s2.time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                {
                                    x1Index: s2.index, y1Price: s2.price,
                                    x2Index: v2.index, y2Price: v2.price,
                                    x1Time: s2.time, x2Time: v2.time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                {
                                    x1Index: v2.index, y1Price: v2.price,
                                    x2Index: s3.index, y2Price: s3.price,
                                    x1Time: v2.time, x2Time: s3.time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                {
                                    x1Index: s3.index, y1Price: s3.price,
                                    x2Index: breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, s3.index + 5),
                                    y2Price: breakoutIdx !== -1 ? breakoutPrice : supportPrice,
                                    x1Time: s3.time,
                                    x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, s3.index + 5)].time,
                                    style: 'dotted', role: 'connector', color: '#EF5350'
                                },
                                // 2. Upper boundary across T1-T2-T3
                                {
                                    x1Index: s1.index, y1Price: avgTop,
                                    x2Index: Math.min(n - 1, s3.index + 5), y2Price: avgTop,
                                    x1Time: s1.time, x2Time: candles[Math.min(n - 1, s3.index + 5)].time,
                                    style: 'dotted', role: 'upper_boundary', color: '#EF5350'
                                },
                                // 3. Lower boundary confirmation neckline
                                {
                                    x1Index: v1.index,
                                    y1Price: supportPrice,
                                    x2Index: Math.min(n - 1, s3.index + 15),
                                    y2Price: supportPrice,
                                    x1Time: v1.time,
                                    x2Time: candles[Math.min(n - 1, s3.index + 15)].time,
                                    style: 'solid',
                                    role: 'lower_boundary',
                                    color: '#EF5350',
                                },
                                // 4. Measured Move & Target Ray
                                {
                                    x1Index: s2.index, y1Price: avgTop,
                                    x2Index: s2.index, y2Price: supportPrice,
                                    x1Time: s2.time, x2Time: s2.time,
                                    style: 'dotted', role: 'measured_move', color: 'rgba(239, 83, 80, 0.75)'
                                },
                                {
                                    x1Index: breakoutIdx !== -1 ? breakoutIdx : s3.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : s3.index + 20)),
                                    y2Price: targetPrice,
                                    x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : s3.index].time,
                                    x2Time: candles[Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : s3.index + 20))].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#EF5350',
                                }
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

            // Triple Bottoms
            if (s1.type === 'low' && v1.type === 'high' && s2.type === 'low' && v2.type === 'high' && s3.type === 'low') {
                const diff1 = Math.abs(s1.price - s2.price) / s1.price;
                const diff2 = Math.abs(s2.price - s3.price) / s2.price;
                if (diff1 <= tolerance && diff2 <= tolerance) {
                    const resPrice = Math.max(v1.price, v2.price);
                    const avgBot = (s1.price + s2.price + s3.price) / 3;
                    const height = resPrice - avgBot;
                    if (height > 0) {
                        const targetPrice = resPrice + height;
                        const targetPct = ((targetPrice - resPrice) / resPrice) * 100;

                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, s3.index, 'bullish',
                            resPrice, targetPrice, Math.min(s1.price, s2.price, s3.price)
                        );
                        const breakoutPrice = lifecycle.breakoutPrice || 0;
                        const breakoutIdx = lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : -1;

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
                            lines: [
                                // 1. Dotted contour connecting all 3 bottoms and 2 peaks
                                {
                                    x1Index: s1.index, y1Price: s1.price,
                                    x2Index: v1.index, y2Price: v1.price,
                                    x1Time: s1.time, x2Time: v1.time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                {
                                    x1Index: v1.index, y1Price: v1.price,
                                    x2Index: s2.index, y2Price: s2.price,
                                    x1Time: v1.time, x2Time: s2.time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                {
                                    x1Index: s2.index, y1Price: s2.price,
                                    x2Index: v2.index, y2Price: v2.price,
                                    x1Time: s2.time, x2Time: v2.time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                {
                                    x1Index: v2.index, y1Price: v2.price,
                                    x2Index: s3.index, y2Price: s3.price,
                                    x1Time: v2.time, x2Time: s3.time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                {
                                    x1Index: s3.index, y1Price: s3.price,
                                    x2Index: breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, s3.index + 5),
                                    y2Price: breakoutIdx !== -1 ? breakoutPrice : resPrice,
                                    x1Time: s3.time,
                                    x2Time: candles[breakoutIdx !== -1 ? breakoutIdx : Math.min(n - 1, s3.index + 5)].time,
                                    style: 'dotted', role: 'connector', color: '#26A69A'
                                },
                                // 2. Lower boundary across B1-B2-B3
                                {
                                    x1Index: s1.index, y1Price: avgBot,
                                    x2Index: Math.min(n - 1, s3.index + 5), y2Price: avgBot,
                                    x1Time: s1.time, x2Time: candles[Math.min(n - 1, s3.index + 5)].time,
                                    style: 'dotted', role: 'lower_boundary', color: '#26A69A'
                                },
                                // 3. Upper boundary confirmation neckline
                                {
                                    x1Index: v1.index,
                                    y1Price: resPrice,
                                    x2Index: Math.min(n - 1, s3.index + 15),
                                    y2Price: resPrice,
                                    x1Time: v1.time,
                                    x2Time: candles[Math.min(n - 1, s3.index + 15)].time,
                                    style: 'solid',
                                    role: 'upper_boundary',
                                    color: '#26A69A',
                                },
                                // 4. Measured Move & Target Ray
                                {
                                    x1Index: s2.index, y1Price: avgBot,
                                    x2Index: s2.index, y2Price: resPrice,
                                    x1Time: s2.time, x2Time: s2.time,
                                    style: 'dotted', role: 'measured_move', color: 'rgba(38, 166, 154, 0.75)'
                                },
                                {
                                    x1Index: breakoutIdx !== -1 ? breakoutIdx : s3.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : s3.index + 20)),
                                    y2Price: targetPrice,
                                    x1Time: candles[breakoutIdx !== -1 ? breakoutIdx : s3.index].time,
                                    x2Time: candles[Math.min(n - 1, (breakoutIdx !== -1 ? breakoutIdx + 20 : s3.index + 20))].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#26A69A',
                                }
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
    }

    // =========================================================================
    // 2. BAB 21.2: CONTINUATION CHART PATTERNS
    // =========================================================================
    if (shouldScanContinuation) {
        // --- 2.1 Triangles & Wedges (Symmetrical, Ascending, Descending, Wedges) ---
        for (let i = 0; i < swings.length - 3; i++) {
            const sw1 = swings[i];
            const sw2 = swings[i + 1];
            const sw3 = swings[i + 2];
            const sw4 = swings[i + 3];

            // Extract highs and lows
            let h1: SwingPoint, h2: SwingPoint, l1: SwingPoint, l2: SwingPoint;
            if (sw1.type === 'high') {
                h1 = sw1; l1 = sw2; h2 = sw3; l2 = sw4;
            } else {
                l1 = sw1; h1 = sw2; l2 = sw3; h2 = sw4;
            }

            const upperSlope = (h2.price - h1.price) / (h2.index - h1.index);
            const lowerSlope = (l2.price - l1.price) / (l2.index - l1.index);

            const isUpperFlat = Math.abs(upperSlope) / h1.price < 0.0012;
            const isLowerFlat = Math.abs(lowerSlope) / l1.price < 0.0012;

            // Base height at widest left span
            const baseHeight = Math.abs(h1.price - l1.price);

            // Symmetrical Triangle: upper slopes down, lower slopes up
            if (upperSlope < 0 && lowerSlope > 0) {
                // Calculate Apex (intersection point)
                const apexIdx = Math.round((l1.price - h1.price + upperSlope * h1.index - lowerSlope * l1.index) / (upperSlope - lowerSlope));
                if (apexIdx > Math.max(h2.index, l2.index) && apexIdx <= Math.max(h2.index, l2.index) + 60) {
                    const startIdx = Math.min(h1.index, l1.index);
                    const apexDist = apexIdx - startIdx;
                    const curPos = (n - startIdx) / apexDist;
                    const specialFlag = (curPos >= 0.66 && curPos <= 0.75) ? 'apex_approaching' : undefined;

                    // Prior trend determines direction
                    const priorTrend = h1.price > (candles[Math.max(0, startIdx - 15)]?.close || h1.price) ? 'bullish' : 'bearish';
                    const targetPrice = priorTrend === 'bullish'
                        ? h2.price + baseHeight
                        : Math.max(1, l2.price - baseHeight);
                    const targetPct = ((targetPrice - candles[n - 1].close) / candles[n - 1].close) * 100;

                    const endIdx = Math.max(h2.index, l2.index);
                    const lifecycle = evaluatePatternLifecycle(
                        candles, volSma, endIdx, priorTrend,
                        priorTrend === 'bullish' ? h1.price : l1.price,
                        targetPrice,
                        priorTrend === 'bullish' ? l2.price : h2.price,
                        priorTrend === 'bullish' ? upperSlope : lowerSlope,
                        priorTrend === 'bullish' ? h1.index : l1.index
                    );

                    patterns.push({
                        id: `sym_tri_${Math.max(h2.index, l2.index)}`,
                        category: 'continuation',
                        type: 'symmetrical_triangle',
                        name: 'Symmetrical Triangle',
                        direction: priorTrend,
                        status: lifecycle.status,
                        anchors: [
                            { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                            { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                            { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                            { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                            ...(apexIdx < n ? [{ index: apexIdx, time: candles[Math.min(n - 1, apexIdx)].time, price: h1.price + upperSlope * (apexIdx - h1.index), label: 'Apex' }] : []),
                        ],
                        lines: [
                            // 1. Upper and Lower Boundary projecting to Apex
                            {
                                x1Index: h1.index,
                                y1Price: h1.price,
                                x2Index: Math.min(n - 1, apexIdx),
                                y2Price: h1.price + upperSlope * (Math.min(n - 1, apexIdx) - h1.index),
                                x1Time: h1.time,
                                x2Time: candles[Math.min(n - 1, apexIdx)].time,
                                style: 'dotted',
                                role: 'upper_boundary',
                                color: '#2962FF',
                            },
                            {
                                x1Index: l1.index,
                                y1Price: l1.price,
                                x2Index: Math.min(n - 1, apexIdx),
                                y2Price: l1.price + lowerSlope * (Math.min(n - 1, apexIdx) - l1.index),
                                x1Time: l1.time,
                                x2Time: candles[Math.min(n - 1, apexIdx)].time,
                                style: 'dotted',
                                role: 'lower_boundary',
                                color: '#2962FF',
                            },
                            // 2. Internal zigzag swing connectors showing the coil compression
                            {
                                x1Index: h1.index, y1Price: h1.price,
                                x2Index: l1.index, y2Price: l1.price,
                                x1Time: h1.time, x2Time: l1.time,
                                style: 'dotted', role: 'connector', color: 'rgba(41, 98, 255, 0.65)'
                            },
                            {
                                x1Index: l1.index, y1Price: l1.price,
                                x2Index: h2.index, y2Price: h2.price,
                                x1Time: l1.time, x2Time: h2.time,
                                style: 'dotted', role: 'connector', color: 'rgba(41, 98, 255, 0.65)'
                            },
                            {
                                x1Index: h2.index, y1Price: h2.price,
                                x2Index: l2.index, y2Price: l2.price,
                                x1Time: h2.time, x2Time: l2.time,
                                style: 'dotted', role: 'connector', color: 'rgba(41, 98, 255, 0.65)'
                            },
                            // 3. Vertical Base Line (Widest opening measured move)
                            {
                                x1Index: Math.min(h1.index, l1.index),
                                y1Price: Math.max(h1.price, l1.price),
                                x2Index: Math.min(h1.index, l1.index),
                                y2Price: Math.min(h1.price, l1.price),
                                x1Time: candles[Math.min(h1.index, l1.index)].time,
                                x2Time: candles[Math.min(h1.index, l1.index)].time,
                                style: 'dotted', role: 'measured_move', color: '#2962FF'
                            },
                            // 4. Target Ray
                            {
                                x1Index: Math.max(h2.index, l2.index),
                                y1Price: targetPrice,
                                x2Index: Math.min(n - 1, Math.max(h2.index, l2.index) + 20),
                                y2Price: targetPrice,
                                x1Time: candles[Math.max(h2.index, l2.index)].time,
                                x2Time: candles[Math.min(n - 1, Math.max(h2.index, l2.index) + 20)].time,
                                style: 'dashed', role: 'target_ray', color: '#2962FF'
                            }
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        specialFlag,
                        startIndex: startIdx,
                        endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : endIdx,
                    });
                }
            }

            // Ascending Triangle: upper flat, lower slopes up
            else if (isUpperFlat && lowerSlope > 0) {
                const targetPrice = h1.price + baseHeight;
                const targetPct = ((targetPrice - h1.price) / h1.price) * 100;
                const endIdx = Math.max(h2.index, l2.index);
                const lifecycle = evaluatePatternLifecycle(
                    candles, volSma, endIdx, 'bullish',
                    h1.price, targetPrice, l2.price
                );

                patterns.push({
                    id: `asc_tri_${Math.max(h2.index, l2.index)}`,
                    category: 'continuation',
                    type: 'ascending_triangle',
                    name: 'Ascending Triangle (Bullish)',
                    direction: 'bullish',
                    status: lifecycle.status,
                    anchors: [
                        { index: h1.index, time: h1.time, price: h1.price, label: 'R1' },
                        { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                        { index: h2.index, time: h2.time, price: h2.price, label: 'R2' },
                        { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                    ],
                    lines: [
                        // 1. Upper flat resistance
                        {
                            x1Index: h1.index,
                            y1Price: h1.price,
                            x2Index: Math.min(n - 1, l2.index + 15),
                            y2Price: h1.price,
                            x1Time: h1.time,
                            x2Time: candles[Math.min(n - 1, l2.index + 15)].time,
                            style: 'dotted',
                            role: 'upper_boundary',
                            color: '#26A69A',
                        },
                        // 2. Lower ascending trendline
                        {
                            x1Index: l1.index,
                            y1Price: l1.price,
                            x2Index: Math.min(n - 1, l2.index + 15),
                            y2Price: l1.price + lowerSlope * (Math.min(n - 1, l2.index + 15) - l1.index),
                            x1Time: l1.time,
                            x2Time: candles[Math.min(n - 1, l2.index + 15)].time,
                            style: 'dotted',
                            role: 'lower_boundary',
                            color: '#26A69A',
                        },
                        // 3. Internal zigzag swing connectors
                        {
                            x1Index: l1.index, y1Price: l1.price,
                            x2Index: h1.index, y2Price: h1.price,
                            x1Time: l1.time, x2Time: h1.time,
                            style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                        },
                        {
                            x1Index: h1.index, y1Price: h1.price,
                            x2Index: l2.index, y2Price: l2.price,
                            x1Time: h1.time, x2Time: l2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                        },
                        {
                            x1Index: l2.index, y1Price: l2.price,
                            x2Index: h2.index, y2Price: h2.price,
                            x1Time: l2.time, x2Time: h2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                        },
                        // 4. Vertical Base Line
                        {
                            x1Index: l1.index, y1Price: h1.price,
                            x2Index: l1.index, y2Price: l1.price,
                            x1Time: l1.time, x2Time: l1.time,
                            style: 'dotted', role: 'measured_move', color: '#26A69A'
                        },
                        // 5. Target Ray
                        {
                            x1Index: h2.index,
                            y1Price: targetPrice,
                            x2Index: Math.min(n - 1, h2.index + 20),
                            y2Price: targetPrice,
                            x1Time: h2.time,
                            x2Time: candles[Math.min(n - 1, h2.index + 20)].time,
                            style: 'dashed', role: 'target_ray', color: '#26A69A'
                        }
                    ],
                    breakoutPrice: lifecycle.breakoutPrice,
                    breakoutIndex: lifecycle.breakoutIndex,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: Math.min(h1.index, l1.index),
                    endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : endIdx,
                });
            }

            // Descending Triangle: upper slopes down, lower flat
            else if (upperSlope < 0 && isLowerFlat) {
                const targetPrice = Math.max(1, l1.price - baseHeight);
                const targetPct = ((targetPrice - l1.price) / l1.price) * 100;
                const endIdx = Math.max(h2.index, l2.index);
                const lifecycle = evaluatePatternLifecycle(
                    candles, volSma, endIdx, 'bearish',
                    l1.price, targetPrice, h2.price
                );

                patterns.push({
                    id: `desc_tri_${Math.max(h2.index, l2.index)}`,
                    category: 'continuation',
                    type: 'descending_triangle',
                    name: 'Descending Triangle (Bearish)',
                    direction: 'bearish',
                    status: lifecycle.status,
                    anchors: [
                        { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                        { index: l1.index, time: l1.time, price: l1.price, label: 'S1' },
                        { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                        { index: l2.index, time: l2.time, price: l2.price, label: 'S2' },
                    ],
                    lines: [
                        // 1. Lower flat support
                        {
                            x1Index: l1.index,
                            y1Price: l1.price,
                            x2Index: Math.min(n - 1, h2.index + 15),
                            y2Price: l1.price,
                            x1Time: l1.time,
                            x2Time: candles[Math.min(n - 1, h2.index + 15)].time,
                            style: 'dotted',
                            role: 'lower_boundary',
                            color: '#EF5350',
                        },
                        // 2. Upper descending trendline
                        {
                            x1Index: h1.index,
                            y1Price: h1.price,
                            x2Index: Math.min(n - 1, h2.index + 15),
                            y2Price: h1.price + upperSlope * (Math.min(n - 1, h2.index + 15) - h1.index),
                            x1Time: h1.time,
                            x2Time: candles[Math.min(n - 1, h2.index + 15)].time,
                            style: 'dotted',
                            role: 'upper_boundary',
                            color: '#EF5350',
                        },
                        // 3. Internal zigzag swing connectors
                        {
                            x1Index: h1.index, y1Price: h1.price,
                            x2Index: l1.index, y2Price: l1.price,
                            x1Time: h1.time, x2Time: l1.time,
                            style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                        },
                        {
                            x1Index: l1.index, y1Price: l1.price,
                            x2Index: h2.index, y2Price: h2.price,
                            x1Time: l1.time, x2Time: h2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                        },
                        {
                            x1Index: h2.index, y1Price: h2.price,
                            x2Index: l2.index, y2Price: l2.price,
                            x1Time: h2.time, x2Time: l2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                        },
                        // 4. Vertical Base Line
                        {
                            x1Index: h1.index, y1Price: h1.price,
                            x2Index: h1.index, y2Price: l1.price,
                            x1Time: h1.time, x2Time: h1.time,
                            style: 'dotted', role: 'measured_move', color: '#EF5350'
                        },
                        // 5. Target Ray
                        {
                            x1Index: l2.index,
                            y1Price: targetPrice,
                            x2Index: Math.min(n - 1, l2.index + 20),
                            y2Price: targetPrice,
                            x1Time: l2.time,
                            x2Time: candles[Math.min(n - 1, l2.index + 20)].time,
                            style: 'dashed', role: 'target_ray', color: '#EF5350'
                        }
                    ],
                    breakoutPrice: lifecycle.breakoutPrice,
                    breakoutIndex: lifecycle.breakoutIndex,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: Math.min(h1.index, l1.index),
                    endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : endIdx,
                });
            }

            // Rising Wedge: both slope up, lower steeper than upper (converging)
            else if (upperSlope > 0 && lowerSlope > 0 && lowerSlope > upperSlope * 1.15) {
                const targetPrice = Math.max(1, l1.price);
                const targetPct = ((targetPrice - candles[n - 1].close) / candles[n - 1].close) * 100;
                const endIdx = Math.max(h2.index, l2.index);
                const lifecycle = evaluatePatternLifecycle(
                    candles, volSma, endIdx, 'bearish',
                    l1.price, targetPrice, h2.price * 1.02,
                    lowerSlope, l1.index
                );

                patterns.push({
                    id: `rise_wedge_${Math.max(h2.index, l2.index)}`,
                    category: 'continuation',
                    type: 'rising_wedge',
                    name: 'Rising Wedge (Bearish Implication)',
                    direction: 'bearish',
                    status: lifecycle.status,
                    anchors: [
                        { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                        { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                        { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                        { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                    ],
                    lines: [
                        // 1. Converging boundaries
                        {
                            x1Index: h1.index,
                            y1Price: h1.price,
                            x2Index: Math.min(n - 1, h2.index + 15),
                            y2Price: h1.price + upperSlope * (Math.min(n - 1, h2.index + 15) - h1.index),
                            x1Time: h1.time,
                            x2Time: candles[Math.min(n - 1, h2.index + 15)].time,
                            style: 'dotted',
                            role: 'upper_boundary',
                            color: '#EF5350',
                        },
                        {
                            x1Index: l1.index,
                            y1Price: l1.price,
                            x2Index: Math.min(n - 1, h2.index + 15),
                            y2Price: l1.price + lowerSlope * (Math.min(n - 1, h2.index + 15) - l1.index),
                            x1Time: l1.time,
                            x2Time: candles[Math.min(n - 1, h2.index + 15)].time,
                            style: 'dotted',
                            role: 'lower_boundary',
                            color: '#EF5350',
                        },
                        // 2. Internal zigzag swing connectors
                        {
                            x1Index: l1.index, y1Price: l1.price,
                            x2Index: h1.index, y2Price: h1.price,
                            x1Time: l1.time, x2Time: h1.time,
                            style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                        },
                        {
                            x1Index: h1.index, y1Price: h1.price,
                            x2Index: l2.index, y2Price: l2.price,
                            x1Time: h1.time, x2Time: l2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                        },
                        {
                            x1Index: l2.index, y1Price: l2.price,
                            x2Index: h2.index, y2Price: h2.price,
                            x1Time: l2.time, x2Time: h2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                        },
                        // 3. Retracement line to wedge origin L1
                        {
                            x1Index: Math.max(h2.index, l2.index),
                            y1Price: targetPrice,
                            x2Index: Math.min(n - 1, Math.max(h2.index, l2.index) + 15),
                            y2Price: targetPrice,
                            x1Time: candles[Math.max(h2.index, l2.index)].time,
                            x2Time: candles[Math.min(n - 1, Math.max(h2.index, l2.index) + 15)].time,
                            style: 'dashed', role: 'target_ray', color: '#EF5350'
                        }
                    ],
                    breakoutPrice: lifecycle.breakoutPrice,
                    breakoutIndex: lifecycle.breakoutIndex,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: Math.min(h1.index, l1.index),
                    endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : endIdx,
                });
            }

            // Falling Wedge: both slope down, upper steeper than lower (converging)
            else if (upperSlope < 0 && lowerSlope < 0 && Math.abs(upperSlope) > Math.abs(lowerSlope) * 1.15) {
                const targetPrice = h1.price;
                const targetPct = ((targetPrice - candles[n - 1].close) / candles[n - 1].close) * 100;
                const endIdx = Math.max(h2.index, l2.index);
                const lifecycle = evaluatePatternLifecycle(
                    candles, volSma, endIdx, 'bullish',
                    h1.price, targetPrice, l2.price * 0.98,
                    upperSlope, h1.index
                );

                patterns.push({
                    id: `fall_wedge_${Math.max(h2.index, l2.index)}`,
                    category: 'continuation',
                    type: 'falling_wedge',
                    name: 'Falling Wedge (Bullish Implication)',
                    direction: 'bullish',
                    status: lifecycle.status,
                    anchors: [
                        { index: h1.index, time: h1.time, price: h1.price, label: 'H1' },
                        { index: l1.index, time: l1.time, price: l1.price, label: 'L1' },
                        { index: h2.index, time: h2.time, price: h2.price, label: 'H2' },
                        { index: l2.index, time: l2.time, price: l2.price, label: 'L2' },
                    ],
                    lines: [
                        // 1. Converging boundaries
                        {
                            x1Index: h1.index,
                            y1Price: h1.price,
                            x2Index: Math.min(n - 1, l2.index + 15),
                            y2Price: h1.price + upperSlope * (Math.min(n - 1, l2.index + 15) - h1.index),
                            x1Time: h1.time,
                            x2Time: candles[Math.min(n - 1, l2.index + 15)].time,
                            style: 'dotted',
                            role: 'upper_boundary',
                            color: '#26A69A',
                        },
                        {
                            x1Index: l1.index,
                            y1Price: l1.price,
                            x2Index: Math.min(n - 1, l2.index + 15),
                            y2Price: l1.price + lowerSlope * (Math.min(n - 1, l2.index + 15) - l1.index),
                            x1Time: l1.time,
                            x2Time: candles[Math.min(n - 1, l2.index + 15)].time,
                            style: 'dotted',
                            role: 'lower_boundary',
                            color: '#26A69A',
                        },
                        // 2. Internal zigzag swing connectors
                        {
                            x1Index: h1.index, y1Price: h1.price,
                            x2Index: l1.index, y2Price: l1.price,
                            x1Time: h1.time, x2Time: l1.time,
                            style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                        },
                        {
                            x1Index: l1.index, y1Price: l1.price,
                            x2Index: h2.index, y2Price: h2.price,
                            x1Time: l1.time, x2Time: h2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                        },
                        {
                            x1Index: h2.index, y1Price: h2.price,
                            x2Index: l2.index, y2Price: l2.price,
                            x1Time: h2.time, x2Time: l2.time,
                            style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                        },
                        // 3. Retracement line to wedge origin H1
                        {
                            x1Index: Math.max(h2.index, l2.index),
                            y1Price: targetPrice,
                            x2Index: Math.min(n - 1, Math.max(h2.index, l2.index) + 15),
                            y2Price: targetPrice,
                            x1Time: candles[Math.max(h2.index, l2.index)].time,
                            x2Time: candles[Math.min(n - 1, Math.max(h2.index, l2.index) + 15)].time,
                            style: 'dashed', role: 'target_ray', color: '#26A69A'
                        }
                    ],
                    breakoutPrice: lifecycle.breakoutPrice,
                    breakoutIndex: lifecycle.breakoutIndex,
                    breakoutTime: lifecycle.breakoutTime,
                    targetPrice,
                    targetPercent: targetPct,
                    volumeRatio: lifecycle.volumeRatio,
                    isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                    startIndex: Math.min(h1.index, l1.index),
                    endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : endIdx,
                });
            }
        }

        // --- 2.2 Flags & Pennants (Measured Move: AB = CD) ---
        // Flagpole: steep impulse move over 3–12 bars, followed by 5–25 bar channel/consolidation
        for (let i = 0; i < swings.length - 2; i++) {
            const origin = swings[i];
            const poleTop = swings[i + 1];
            const retrace = swings[i + 2];

            const poleBars = poleTop.index - origin.index;
            if (poleBars >= 3 && poleBars <= 14) {
                // Bullish Flag / Pennant: origin Low -> poleTop High -> retrace Low
                if (origin.type === 'low' && poleTop.type === 'high' && retrace.type === 'low') {
                    const poleHeight = poleTop.price - origin.price;
                    const retraceDepth = (poleTop.price - retrace.price) / poleHeight;

                    // Healthy flag retrace: 20% to 50% (shallow pullback)
                    if (retraceDepth >= 0.15 && retraceDepth <= 0.55) {
                        const targetPrice = poleTop.price + poleHeight; // AB = CD
                        const targetPct = ((targetPrice - poleTop.price) / poleTop.price) * 100;
                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, retrace.index, 'bullish',
                            poleTop.price, targetPrice, origin.price
                        );

                        patterns.push({
                            id: `bull_flag_${retrace.index}`,
                            category: 'continuation',
                            type: 'bullish_flag',
                            name: 'Bullish Flag (AB = CD)',
                            direction: 'bullish',
                            status: lifecycle.status,
                            anchors: [
                                { index: origin.index, time: origin.time, price: origin.price, label: 'Pole Start (A)' },
                                { index: poleTop.index, time: poleTop.time, price: poleTop.price, label: 'Pole Top (B)' },
                                { index: retrace.index, time: retrace.time, price: retrace.price, label: 'Flag Low (C)' },
                            ],
                            lines: [
                                // 1. Flagpole (Steep Impulse Move)
                                {
                                    x1Index: origin.index,
                                    y1Price: origin.price,
                                    x2Index: poleTop.index,
                                    y2Price: poleTop.price,
                                    x1Time: origin.time,
                                    x2Time: poleTop.time,
                                    style: 'dotted',
                                    role: 'flagpole',
                                    color: '#26A69A',
                                },
                                // 2. Flag Consolidation Channel (Upper and Lower Dotted Boundaries)
                                {
                                    x1Index: poleTop.index,
                                    y1Price: poleTop.price,
                                    x2Index: Math.min(n - 1, retrace.index + 8),
                                    y2Price: poleTop.price - (poleTop.price - retrace.price) * 0.4,
                                    x1Time: poleTop.time,
                                    x2Time: candles[Math.min(n - 1, retrace.index + 8)].time,
                                    style: 'dotted',
                                    role: 'upper_boundary',
                                    color: '#26A69A',
                                },
                                {
                                    x1Index: retrace.index,
                                    y1Price: retrace.price,
                                    x2Index: Math.min(n - 1, retrace.index + 8),
                                    y2Price: retrace.price - (poleTop.price - retrace.price) * 0.4,
                                    x1Time: retrace.time,
                                    x2Time: candles[Math.min(n - 1, retrace.index + 8)].time,
                                    style: 'dotted',
                                    role: 'lower_boundary',
                                    color: '#26A69A',
                                },
                                // 3. Internal connector inside the flag
                                {
                                    x1Index: poleTop.index, y1Price: poleTop.price,
                                    x2Index: retrace.index, y2Price: retrace.price,
                                    x1Time: poleTop.time, x2Time: retrace.time,
                                    style: 'dotted', role: 'connector', color: 'rgba(38, 166, 154, 0.65)'
                                },
                                // 4. Measured Move Flagpole Projection (AB = CD)
                                {
                                    x1Index: retrace.index,
                                    y1Price: retrace.price,
                                    x2Index: retrace.index,
                                    y2Price: targetPrice,
                                    x1Time: retrace.time,
                                    x2Time: retrace.time,
                                    style: 'dotted',
                                    role: 'measured_move',
                                    color: 'rgba(38, 166, 154, 0.75)',
                                },
                                // 5. Target Ray
                                {
                                    x1Index: retrace.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, retrace.index + 20),
                                    y2Price: targetPrice,
                                    x1Time: retrace.time,
                                    x2Time: candles[Math.min(n - 1, retrace.index + 20)].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#26A69A',
                                }
                            ],
                            breakoutPrice: lifecycle.breakoutPrice,
                            breakoutIndex: lifecycle.breakoutIndex,
                            breakoutTime: lifecycle.breakoutTime,
                            targetPrice,
                            targetPercent: targetPct,
                            volumeRatio: lifecycle.volumeRatio,
                            isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                            startIndex: origin.index,
                            endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : retrace.index,
                        });
                    }
                }

                // Bearish Flag / Pennant: origin High -> poleLow -> retrace High
                if (origin.type === 'high' && poleTop.type === 'low' && retrace.type === 'high') {
                    const poleHeight = origin.price - poleTop.price;
                    const retraceDepth = (retrace.price - poleTop.price) / poleHeight;

                    if (retraceDepth >= 0.15 && retraceDepth <= 0.55) {
                        const targetPrice = Math.max(1, poleTop.price - poleHeight); // AB = CD
                        const targetPct = ((targetPrice - poleTop.price) / poleTop.price) * 100;
                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, retrace.index, 'bearish',
                            poleTop.price, targetPrice, origin.price
                        );

                        patterns.push({
                            id: `bear_flag_${retrace.index}`,
                            category: 'continuation',
                            type: 'bearish_flag',
                            name: 'Bearish Flag (AB = CD)',
                            direction: 'bearish',
                            status: lifecycle.status,
                            anchors: [
                                { index: origin.index, time: origin.time, price: origin.price, label: 'Pole Start (A)' },
                                { index: poleTop.index, time: poleTop.time, price: poleTop.price, label: 'Pole Low (B)' },
                                { index: retrace.index, time: retrace.time, price: retrace.price, label: 'Flag High (C)' },
                            ],
                            lines: [
                                // 1. Flagpole (Steep Impulse Move)
                                {
                                    x1Index: origin.index,
                                    y1Price: origin.price,
                                    x2Index: poleTop.index,
                                    y2Price: poleTop.price,
                                    x1Time: origin.time,
                                    x2Time: poleTop.time,
                                    style: 'dotted',
                                    role: 'flagpole',
                                    color: '#EF5350',
                                },
                                // 2. Flag Consolidation Channel (Lower and Upper Dotted Boundaries)
                                {
                                    x1Index: poleTop.index,
                                    y1Price: poleTop.price,
                                    x2Index: Math.min(n - 1, retrace.index + 8),
                                    y2Price: poleTop.price + (retrace.price - poleTop.price) * 0.4,
                                    x1Time: poleTop.time,
                                    x2Time: candles[Math.min(n - 1, retrace.index + 8)].time,
                                    style: 'dotted',
                                    role: 'lower_boundary',
                                    color: '#EF5350',
                                },
                                {
                                    x1Index: retrace.index,
                                    y1Price: retrace.price,
                                    x2Index: Math.min(n - 1, retrace.index + 8),
                                    y2Price: retrace.price + (retrace.price - poleTop.price) * 0.4,
                                    x1Time: retrace.time,
                                    x2Time: candles[Math.min(n - 1, retrace.index + 8)].time,
                                    style: 'dotted',
                                    role: 'upper_boundary',
                                    color: '#EF5350',
                                },
                                // 3. Internal connector inside the flag
                                {
                                    x1Index: poleTop.index, y1Price: poleTop.price,
                                    x2Index: retrace.index, y2Price: retrace.price,
                                    x1Time: poleTop.time, x2Time: retrace.time,
                                    style: 'dotted', role: 'connector', color: 'rgba(239, 83, 80, 0.65)'
                                },
                                // 4. Measured Move Flagpole Projection (AB = CD)
                                {
                                    x1Index: retrace.index,
                                    y1Price: retrace.price,
                                    x2Index: retrace.index,
                                    y2Price: targetPrice,
                                    x1Time: retrace.time,
                                    x2Time: retrace.time,
                                    style: 'dotted',
                                    role: 'measured_move',
                                    color: 'rgba(239, 83, 80, 0.75)',
                                },
                                // 5. Target Ray
                                {
                                    x1Index: retrace.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, retrace.index + 20),
                                    y2Price: targetPrice,
                                    x1Time: retrace.time,
                                    x2Time: candles[Math.min(n - 1, retrace.index + 20)].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#EF5350',
                                }
                            ],
                            breakoutPrice: lifecycle.breakoutPrice,
                            breakoutIndex: lifecycle.breakoutIndex,
                            breakoutTime: lifecycle.breakoutTime,
                            targetPrice,
                            targetPercent: targetPct,
                            volumeRatio: lifecycle.volumeRatio,
                            isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                            startIndex: origin.index,
                            endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : retrace.index,
                        });
                    }
                }
            }
        }

        // --- 2.3 Rectangles (Trading Range Consolidation) ---
        for (let i = 0; i < swings.length - 3; i++) {
            const p1 = swings[i];
            const p2 = swings[i + 1];
            const p3 = swings[i + 2];
            const p4 = swings[i + 3];

            let h1: SwingPoint, h2: SwingPoint, l1: SwingPoint, l2: SwingPoint;
            if (p1.type === 'high') {
                h1 = p1; l1 = p2; h2 = p3; l2 = p4;
            } else {
                l1 = p1; h1 = p2; l2 = p3; h2 = p4;
            }

            const topDiff = Math.abs(h1.price - h2.price) / h1.price;
            const botDiff = Math.abs(l1.price - l2.price) / l1.price;

            if (topDiff <= tolerance && botDiff <= tolerance) {
                const rangeHeight = ((h1.price + h2.price) / 2) - ((l1.price + l2.price) / 2);
                if (rangeHeight > 0) {
                    const isUptrend = h1.price > (candles[Math.max(0, p1.index - 20)]?.close || h1.price);
                    const resPrice = (h1.price + h2.price) / 2;
                    const supPrice = (l1.price + l2.price) / 2;

                    const targetPrice = isUptrend ? resPrice + rangeHeight : Math.max(1, supPrice - rangeHeight);
                    const targetPct = isUptrend
                        ? ((targetPrice - resPrice) / resPrice) * 100
                        : ((targetPrice - supPrice) / supPrice) * 100;

                    const endIdx = Math.max(h2.index, l2.index);
                    const lifecycle = evaluatePatternLifecycle(
                        candles, volSma, endIdx, isUptrend ? 'bullish' : 'bearish',
                        isUptrend ? resPrice : supPrice,
                        targetPrice,
                        isUptrend ? supPrice * 0.98 : resPrice * 1.02
                    );

                    patterns.push({
                        id: `rect_${Math.max(h2.index, l2.index)}`,
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
                        lines: [
                            // 1. Full 4-sided Rectangle Box in Dotted Lines
                            {
                                x1Index: Math.min(h1.index, l1.index),
                                y1Price: resPrice,
                                x2Index: Math.min(n - 1, Math.max(h2.index, l2.index) + 10),
                                y2Price: resPrice,
                                x1Time: candles[Math.min(h1.index, l1.index)].time,
                                x2Time: candles[Math.min(n - 1, Math.max(h2.index, l2.index) + 10)].time,
                                style: 'dotted',
                                role: 'upper_boundary',
                                color: isUptrend ? '#26A69A' : '#EF5350',
                            },
                            {
                                x1Index: Math.min(h1.index, l1.index),
                                y1Price: supPrice,
                                x2Index: Math.min(n - 1, Math.max(h2.index, l2.index) + 10),
                                y2Price: supPrice,
                                x1Time: candles[Math.min(h1.index, l1.index)].time,
                                x2Time: candles[Math.min(n - 1, Math.max(h2.index, l2.index) + 10)].time,
                                style: 'dotted',
                                role: 'lower_boundary',
                                color: isUptrend ? '#26A69A' : '#EF5350',
                            },
                            // Left vertical wall
                            {
                                x1Index: Math.min(h1.index, l1.index),
                                y1Price: supPrice,
                                x2Index: Math.min(h1.index, l1.index),
                                y2Price: resPrice,
                                x1Time: candles[Math.min(h1.index, l1.index)].time,
                                x2Time: candles[Math.min(h1.index, l1.index)].time,
                                style: 'dotted',
                                role: 'box_wall',
                                color: isUptrend ? '#26A69A' : '#EF5350',
                            },
                            // Right vertical wall
                            {
                                x1Index: Math.max(h2.index, l2.index),
                                y1Price: supPrice,
                                x2Index: Math.max(h2.index, l2.index),
                                y2Price: resPrice,
                                x1Time: candles[Math.max(h2.index, l2.index)].time,
                                x2Time: candles[Math.max(h2.index, l2.index)].time,
                                style: 'dotted',
                                role: 'box_wall',
                                color: isUptrend ? '#26A69A' : '#EF5350',
                            },
                            // 2. Internal zigzag swing connectors showing the bouncing price
                            {
                                x1Index: p1.index, y1Price: p1.price,
                                x2Index: p2.index, y2Price: p2.price,
                                x1Time: p1.time, x2Time: p2.time,
                                style: 'dotted', role: 'connector',
                                color: isUptrend ? 'rgba(38, 166, 154, 0.65)' : 'rgba(239, 83, 80, 0.65)'
                            },
                            {
                                x1Index: p2.index, y1Price: p2.price,
                                x2Index: p3.index, y2Price: p3.price,
                                x1Time: p2.time, x2Time: p3.time,
                                style: 'dotted', role: 'connector',
                                color: isUptrend ? 'rgba(38, 166, 154, 0.65)' : 'rgba(239, 83, 80, 0.65)'
                            },
                            {
                                x1Index: p3.index, y1Price: p3.price,
                                x2Index: p4.index, y2Price: p4.price,
                                x1Time: p3.time, x2Time: p4.time,
                                style: 'dotted', role: 'connector',
                                color: isUptrend ? 'rgba(38, 166, 154, 0.65)' : 'rgba(239, 83, 80, 0.65)'
                            },
                            // 3. Measured Move vertical projection
                            {
                                x1Index: Math.max(h2.index, l2.index),
                                y1Price: isUptrend ? resPrice : supPrice,
                                x2Index: Math.max(h2.index, l2.index),
                                y2Price: targetPrice,
                                x1Time: candles[Math.max(h2.index, l2.index)].time,
                                x2Time: candles[Math.max(h2.index, l2.index)].time,
                                style: 'dotted',
                                role: 'measured_move',
                                color: isUptrend ? 'rgba(38, 166, 154, 0.75)' : 'rgba(239, 83, 80, 0.75)'
                            },
                            // 4. Target Ray
                            {
                                x1Index: Math.max(h2.index, l2.index),
                                y1Price: targetPrice,
                                x2Index: Math.min(n - 1, Math.max(h2.index, l2.index) + 20),
                                y2Price: targetPrice,
                                x1Time: candles[Math.max(h2.index, l2.index)].time,
                                x2Time: candles[Math.min(n - 1, Math.max(h2.index, l2.index) + 20)].time,
                                style: 'dashed',
                                role: 'target_ray',
                                color: isUptrend ? '#26A69A' : '#EF5350',
                            }
                        ],
                        breakoutPrice: lifecycle.breakoutPrice,
                        breakoutIndex: lifecycle.breakoutIndex,
                        breakoutTime: lifecycle.breakoutTime,
                        targetPrice,
                        targetPercent: targetPct,
                        volumeRatio: lifecycle.volumeRatio,
                        isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                        startIndex: Math.min(h1.index, l1.index),
                        endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : endIdx,
                    });
                }
            }
        }

        // --- 2.4 Cup and Handle (Bullish Continuation) ---
        // Requires: Origin Low A -> Left Rim Peak B -> Rounded Bottom -> Right Rim Peak C (C ≈ B) -> Handle
        for (let i = 0; i < swings.length - 3; i++) {
            const leftRim = swings[i];
            const cupBottom = swings[i + 1];
            const rightRim = swings[i + 2];
            const handleBottom = swings[i + 3];

            if (leftRim.type === 'high' && cupBottom.type === 'low' && rightRim.type === 'high' && handleBottom.type === 'low') {
                const cupDuration = rightRim.index - leftRim.index;
                const rimDiff = Math.abs(leftRim.price - rightRim.price) / leftRim.price;

                // Cup must be broad (>= 15 bars) and rims roughly equal (within 5%)
                if (cupDuration >= 15 && rimDiff <= 0.05) {
                    const cupDepth = Math.max(leftRim.price, rightRim.price) - cupBottom.price;
                    const handleRetrace = (rightRim.price - handleBottom.price) / cupDepth;

                    // Handle retrace must not exceed 50% of cup depth
                    if (handleRetrace <= 0.50 && handleRetrace >= 0.05) {
                        const targetPrice = rightRim.price + cupDepth;
                        const targetPct = ((targetPrice - rightRim.price) / rightRim.price) * 100;
                        const lifecycle = evaluatePatternLifecycle(
                            candles, volSma, handleBottom.index, 'bullish',
                            rightRim.price, targetPrice, cupBottom.price
                        );

                        patterns.push({
                            id: `cup_handle_${rightRim.index}`,
                            category: 'continuation',
                            type: 'cup_and_handle',
                            name: 'Cup and Handle (Bullish)',
                            direction: 'bullish',
                            status: lifecycle.status,
                            anchors: [
                                { index: leftRim.index, time: leftRim.time, price: leftRim.price, label: 'Left Rim' },
                                { index: cupBottom.index, time: cupBottom.time, price: cupBottom.price, label: 'Cup Base' },
                                { index: rightRim.index, time: rightRim.time, price: rightRim.price, label: 'Right Rim' },
                                { index: handleBottom.index, time: handleBottom.time, price: handleBottom.price, label: 'Handle' },
                            ],
                            lines: [
                                // 1. Smooth multi-segment U-shaped Cup Curve in Dotted Lines
                                {
                                    x1Index: leftRim.index,
                                    y1Price: leftRim.price,
                                    x2Index: Math.round(leftRim.index + (cupBottom.index - leftRim.index) * 0.5),
                                    y2Price: cupBottom.price + cupDepth * 0.3,
                                    x1Time: leftRim.time,
                                    x2Time: candles[Math.round(leftRim.index + (cupBottom.index - leftRim.index) * 0.5)].time,
                                    style: 'dotted',
                                    role: 'connector',
                                    color: '#26A69A',
                                },
                                {
                                    x1Index: Math.round(leftRim.index + (cupBottom.index - leftRim.index) * 0.5),
                                    y1Price: cupBottom.price + cupDepth * 0.3,
                                    x2Index: cupBottom.index,
                                    y2Price: cupBottom.price,
                                    x1Time: candles[Math.round(leftRim.index + (cupBottom.index - leftRim.index) * 0.5)].time,
                                    x2Time: cupBottom.time,
                                    style: 'dotted',
                                    role: 'connector',
                                    color: '#26A69A',
                                },
                                {
                                    x1Index: cupBottom.index,
                                    y1Price: cupBottom.price,
                                    x2Index: Math.round(cupBottom.index + (rightRim.index - cupBottom.index) * 0.5),
                                    y2Price: cupBottom.price + cupDepth * 0.3,
                                    x1Time: cupBottom.time,
                                    x2Time: candles[Math.round(cupBottom.index + (rightRim.index - cupBottom.index) * 0.5)].time,
                                    style: 'dotted',
                                    role: 'connector',
                                    color: '#26A69A',
                                },
                                {
                                    x1Index: Math.round(cupBottom.index + (rightRim.index - cupBottom.index) * 0.5),
                                    y1Price: cupBottom.price + cupDepth * 0.3,
                                    x2Index: rightRim.index,
                                    y2Price: rightRim.price,
                                    x1Time: candles[Math.round(cupBottom.index + (rightRim.index - cupBottom.index) * 0.5)].time,
                                    x2Time: rightRim.time,
                                    style: 'dotted',
                                    role: 'connector',
                                    color: '#26A69A',
                                },
                                // 2. Horizontal Rim Line
                                {
                                    x1Index: leftRim.index,
                                    y1Price: leftRim.price,
                                    x2Index: Math.min(n - 1, handleBottom.index + 15),
                                    y2Price: rightRim.price,
                                    x1Time: leftRim.time,
                                    x2Time: candles[Math.min(n - 1, handleBottom.index + 15)].time,
                                    style: 'dotted',
                                    role: 'upper_boundary',
                                    color: '#26A69A',
                                },
                                // 3. Handle Downward Channel
                                {
                                    x1Index: rightRim.index,
                                    y1Price: rightRim.price,
                                    x2Index: handleBottom.index,
                                    y2Price: handleBottom.price,
                                    x1Time: rightRim.time,
                                    x2Time: handleBottom.time,
                                    style: 'dotted',
                                    role: 'connector',
                                    color: '#26A69A',
                                },
                                {
                                    x1Index: handleBottom.index,
                                    y1Price: handleBottom.price,
                                    x2Index: Math.min(n - 1, handleBottom.index + 10),
                                    y2Price: rightRim.price,
                                    x1Time: handleBottom.time,
                                    x2Time: candles[Math.min(n - 1, handleBottom.index + 10)].time,
                                    style: 'dotted',
                                    role: 'connector',
                                    color: '#26A69A',
                                },
                                // 4. Measured Move: Vertical Cup Depth and Target Projection
                                {
                                    x1Index: rightRim.index,
                                    y1Price: cupBottom.price,
                                    x2Index: rightRim.index,
                                    y2Price: rightRim.price,
                                    x1Time: rightRim.time,
                                    x2Time: rightRim.time,
                                    style: 'dotted',
                                    role: 'measured_move',
                                    color: 'rgba(38, 166, 154, 0.75)',
                                },
                                {
                                    x1Index: rightRim.index,
                                    y1Price: rightRim.price,
                                    x2Index: rightRim.index,
                                    y2Price: targetPrice,
                                    x1Time: rightRim.time,
                                    x2Time: rightRim.time,
                                    style: 'dotted',
                                    role: 'measured_move',
                                    color: 'rgba(38, 166, 154, 0.75)',
                                },
                                // 5. Target Ray
                                {
                                    x1Index: handleBottom.index,
                                    y1Price: targetPrice,
                                    x2Index: Math.min(n - 1, handleBottom.index + 20),
                                    y2Price: targetPrice,
                                    x1Time: handleBottom.time,
                                    x2Time: candles[Math.min(n - 1, handleBottom.index + 20)].time,
                                    style: 'dashed',
                                    role: 'target_ray',
                                    color: '#26A69A',
                                }
                            ],
                            breakoutPrice: lifecycle.breakoutPrice,
                            breakoutIndex: lifecycle.breakoutIndex,
                            breakoutTime: lifecycle.breakoutTime,
                            targetPrice,
                            targetPercent: targetPct,
                            volumeRatio: lifecycle.volumeRatio,
                            isVolumeConfirmed: lifecycle.isVolumeConfirmed,
                            startIndex: leftRim.index,
                            endIndex: lifecycle.breakoutIndex !== undefined ? lifecycle.breakoutIndex : handleBottom.index,
                        });
                    }
                }
            }
        }
    }

    // 1. Deduplicate & cluster overlapping patterns using Non-Maximum Suppression (NMS)
    let deduplicated = deduplicatePatterns(patterns, _isForex);

    // 2. If a specific individual pattern type is requested, filter strictly for that pattern type
    let finalPatterns = deduplicated;
    if (mode !== 'all' && mode !== 'reversal' && mode !== 'continuation') {
        finalPatterns = deduplicated.filter(p => p.type === mode);
    }

    // 3. Sort patterns by end index descending (most recent first)
    finalPatterns.sort((a, b) => b.endIndex - a.endIndex);

    // Limit to top 15 most prominent non-conflicting patterns for crisp chart rendering
    return finalPatterns.slice(0, 15);
}
