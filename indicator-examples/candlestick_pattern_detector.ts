import { Time } from 'lightweight-charts';

export type CandlestickCategory = 'reversal' | 'continuation';

export type CandlestickPatternType =
    // Bab 24.1 — Anatomi & Basic Continuation (1 Candle)
    | 'green_marubozu'
    | 'red_marubozu'
    // Bab 24.1 — Pola 1 Candle Bullish Reversal
    | 'southern_doji'
    | 'southern_long_leg_doji'
    | 'dragonfly'
    | 'hammer'
    | 'inverted_hammer'
    | 'bullish_belt_hold'
    // Bab 24.1 — Pola 1 Candle Bearish Reversal
    | 'northern_doji'
    | 'northern_long_leg_doji'
    | 'gravestone'
    | 'shooting_star'
    | 'hanging_man'
    | 'bearish_belt_hold'
    // Bab 24.1 — Pola 2 Candle Bullish Reversal
    | 'bullish_pregnant'
    | 'bullish_pregnant_cross'
    | 'bullish_homing_pigeon'
    | 'matching_low'
    | 'bullish_engulfing'
    | 'piercing_line'
    | 'tweezer_bottom'
    // Bab 24.1 — Pola 2 Candle Bearish Reversal
    | 'bearish_pregnant'
    | 'bearish_pregnant_cross'
    | 'bearish_homing_pigeon'
    | 'matching_high'
    | 'bearish_engulfing'
    | 'dark_cloud_cover'
    | 'tweezer_top'
    // Bab 24.2 — Pola 3 Candle Bullish Reversal
    | 'morning_star'
    | 'morning_doji_star'
    | 'bullish_abandoned_baby'
    | 'morning_tri_star'
    | 'three_green_soldiers'
    // Bab 24.2 — Pola 3 Candle Bearish Reversal
    | 'evening_star'
    | 'evening_doji_star'
    | 'bearish_abandoned_baby'
    | 'evening_tri_star'
    | 'three_red_crows'
    // Bab 24.2 — Pola Continuation (2 & 5 Candle)
    | 'upward_gap_tasuki'
    | 'rising_three'
    | 'downward_gap_tasuki'
    | 'falling_three'
    // Aliases
    | 'white_marubozu'
    | 'black_marubozu'
    | 'three_white_soldiers'
    | 'three_black_crows';

export type CandlestickPatternMode =
    | CandlestickPatternType
    | 'all'
    | 'bullish'
    | 'bearish'
    | 'reversal'
    | 'continuation'
    | '1_candle'
    | '2_candle'
    | '3_candle'
    | 'off';

export interface DetectedCandlestickPattern {
    id: string;
    type: CandlestickPatternType;
    name: string;
    category: CandlestickCategory;
    direction: 'bullish' | 'bearish';
    candleCount: 1 | 2 | 3 | 5;
    startIndex: number;
    endIndex: number;
    startTime: Time;
    endTime: Time;
    highPrice: number;
    lowPrice: number;
    qualityScore: number;
}

/**
 * Compute 14-period Average True Range (ATR) for volatility-normalized candle anatomy checks
 */
function computeAtr14(candles: any[]): Float64Array {
    const n = candles.length;
    const atr = new Float64Array(n);
    if (n === 0) return atr;

    let sumTr = 0;
    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const prevClose = i > 0 ? candles[i - 1].close : c.open;
        const tr = Math.max(
            c.high - c.low,
            Math.abs(c.high - prevClose),
            Math.abs(c.low - prevClose)
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

interface CandleMetrics {
    open: number;
    high: number;
    low: number;
    close: number;
    range: number;
    body: number;
    bodyTop: number;
    bodyBottom: number;
    bodyMid: number;
    upperShadow: number;
    lowerShadow: number;
    isGreen: boolean;
    isRed: boolean;
    isWhite: boolean;
    isBlack: boolean;
    isDoji: boolean;
    isLongBody: boolean;
    isSmallBody: boolean;
}

/**
 * IDX Tick Size Rules (Fraksi Harga BEI):
 * < 200: Rp 1
 * 200 - 500: Rp 2
 * 500 - 2000: Rp 5
 * 2000 - 5000: Rp 10
 * >= 5000: Rp 25
 */
export function getIdxTickSize(price: number): number {
    if (price < 200) return 1;
    if (price < 500) return 2;
    if (price < 2000) return 5;
    if (price < 5000) return 10;
    return 25;
}

/**
 * Minimal tinggi candle (wick atas ke wick bawah) untuk saham IHSG
 * agar tidak memunculkan noise. Minimal 4 fraksi / 4 tick harga.
 * Contoh:
 * - Saham < 200: 111, 112, 113, 114 -> height 3 * 1 = 3
 * - Saham 200-500: 304, 306, 308, 310 -> height 3 * 2 = 6
 * - Saham > 500: 560, 565, 570, 575 -> height 3 * 5 = 15
 */
export function getIdxMinCandleHeight(price: number): number {
    const tick = getIdxTickSize(price);
    return 3 * tick - 1e-4;
}

function getCandleMetrics(c: any, localAtr: number): CandleMetrics {
    const open = c.open;
    const high = c.high;
    const low = c.low;
    const close = c.close;
    const range = Math.max(0.0000001, high - low);
    const body = Math.abs(close - open);
    const bodyTop = Math.max(open, close);
    const bodyBottom = Math.min(open, close);
    const bodyMid = (open + close) / 2;
    const upperShadow = high - bodyTop;
    const lowerShadow = bodyBottom - low;

    const isDoji = body <= range * 0.08 || body <= localAtr * 0.06;
    const isGreen = close > open && !isDoji;
    const isRed = close < open && !isDoji;
    const isWhite = isGreen;
    const isBlack = isRed;
    const isLongBody = body >= localAtr * 0.85 && body >= range * 0.55;
    const isSmallBody = body <= localAtr * 0.45 && body <= range * 0.38;

    return {
        open,
        high,
        low,
        close,
        range,
        body,
        bodyTop,
        bodyBottom,
        bodyMid,
        upperShadow,
        lowerShadow,
        isGreen,
        isRed,
        isWhite,
        isBlack,
        isDoji,
        isLongBody,
        isSmallBody,
    };
}

/**
 * Verifies that a reversal candlestick pattern occurs after a genuine prior trend
 * AND sits at a local swing extreme (prevents circling random Dojis/Hammers in sideways chop).
 */
function hasPriorTrendAndSwingExtreme(
    candles: any[],
    atr: Float64Array,
    startIndex: number,
    endIndex: number,
    priorTrend: 'uptrend' | 'downtrend',
    lookback: number = 8
): boolean {
    const fromIdx = Math.max(0, startIndex - lookback);
    if (startIndex - fromIdx < 4) return false;

    const refAtr = atr[startIndex] || Math.abs(candles[startIndex].close * 0.005);
    const firstOpen = candles[fromIdx].open;

    let patternHigh = -Infinity;
    let patternLow = Infinity;
    for (let i = startIndex; i <= endIndex; i++) {
        if (candles[i].high > patternHigh) patternHigh = candles[i].high;
        if (candles[i].low < patternLow) patternLow = candles[i].low;
    }

    if (priorTrend === 'downtrend') {
        // 1. Price must have fallen by at least 1.5x ATR over the lookback window
        let maxPriorHigh = firstOpen;
        let minPriorLow = Infinity;
        for (let i = fromIdx; i < startIndex; i++) {
            if (candles[i].high > maxPriorHigh) maxPriorHigh = candles[i].high;
            if (candles[i].low < minPriorLow) minPriorLow = candles[i].low;
        }
        if (maxPriorHigh - patternLow < refAtr * 1.5) return false;

        // 2. Pattern low must be at or near the lowest low of the recent window (local valley)
        if (patternLow > minPriorLow + refAtr * 0.25) return false;

        // 3. If subsequent bar exists, prefer confirmation (doesn't immediately crash lower)
        if (endIndex + 1 < candles.length) {
            if (candles[endIndex + 1].close < patternLow) return false;
        }
        return true;
    } else {
        // 1. Price must have risen by at least 1.5x ATR over the lookback window
        let minPriorLow = firstOpen;
        let maxPriorHigh = -Infinity;
        for (let i = fromIdx; i < startIndex; i++) {
            if (candles[i].low < minPriorLow) minPriorLow = candles[i].low;
            if (candles[i].high > maxPriorHigh) maxPriorHigh = candles[i].high;
        }
        if (patternHigh - minPriorLow < refAtr * 1.5) return false;

        // 2. Pattern high must be at or near the highest high of the recent window (local peak)
        if (patternHigh < maxPriorHigh - refAtr * 0.25) return false;

        // 3. If subsequent bar exists, prefer confirmation (doesn't immediately skyrocket higher)
        if (endIndex + 1 < candles.length) {
            if (candles[endIndex + 1].close > patternHigh) return false;
        }
        return true;
    }
}

/**
 * Verifies prior trend for Continuation candlestick patterns (Bab 24.2).
 */
function hasContinuationTrend(
    candles: any[],
    atr: Float64Array,
    startIndex: number,
    direction: 'uptrend' | 'downtrend',
    lookback: number = 8
): boolean {
    const fromIdx = Math.max(0, startIndex - lookback);
    if (startIndex - fromIdx < 4) return false;
    const refAtr = atr[startIndex] || Math.abs(candles[startIndex].close * 0.005);
    const diff = candles[startIndex].open - candles[fromIdx].close;
    return direction === 'uptrend' ? diff >= refAtr * 1.3 : -diff >= refAtr * 1.3;
}

/**
 * Deduplicates overlapping candlestick detections using Non-Maximum Suppression (NMS)
 * so multi-candle formations (e.g. Morning Star, Rising Three, Engulfing) automatically
 * suppress constituent single-candle detections inside the same bars, and adjacent circles
 * never pile on top of each other.
 */
function deduplicateCandlestickPatterns(
    raw: DetectedCandlestickPattern[],
    maxPatterns: number
): DetectedCandlestickPattern[] {
    if (raw.length <= 1) return raw;

    const sorted = [...raw].sort((a, b) => b.qualityScore - a.qualityScore);
    const retained: DetectedCandlestickPattern[] = [];

    for (const cand of sorted) {
        let isConflict = false;
        for (const existing of retained) {
            // Suppress if the bars overlap or are within 6 bars of each other
            const minGap = cand.direction === existing.direction ? 7 : 4;
            if (
                cand.startIndex <= existing.endIndex + minGap &&
                cand.endIndex >= existing.startIndex - minGap
            ) {
                isConflict = true;
                break;
            }
        }
        if (!isConflict) {
            retained.push(cand);
            if (retained.length >= maxPatterns) break;
        }
    }

    retained.sort((a, b) => a.startIndex - b.startIndex);
    return retained;
}

/**
 * Main Detection Engine for Bab 24.1 & Bab 24.2 Candlestick Patterns
 */
export function detectCandlestickPatterns(
    candles: any[],
    isForex: boolean = false,
    mode: CandlestickPatternMode = 'all'
): DetectedCandlestickPattern[] {
    if (mode === 'off' || !candles || candles.length < 15) return [];

    const n = candles.length;
    const scanStart = Math.max(8, n - 240);
    const atr = computeAtr14(candles);
    const rawPatterns: DetectedCandlestickPattern[] = [];

    const pushPattern = (
        type: CandlestickPatternType,
        name: string,
        category: CandlestickCategory,
        direction: 'bullish' | 'bearish',
        candleCount: 1 | 2 | 3 | 5,
        startIndex: number,
        endIndex: number,
        baseScore: number
    ) => {
        let highPrice = -Infinity;
        let lowPrice = Infinity;
        for (let k = startIndex; k <= endIndex; k++) {
            if (candles[k].high > highPrice) highPrice = candles[k].high;
            if (candles[k].low < lowPrice) lowPrice = candles[k].low;
        }

        // Filter Noise IHSG: Tinggi candle/pola minimal 4 tick (4 fraksi harga) dari ujung wick atas ke bawah
        if (!isForex) {
            const refPrice = candles[endIndex].close || (highPrice + lowPrice) / 2;
            const minHeight = getIdxMinCandleHeight(refPrice);

            // 1. Rentang total pola (dari wick terendah s/d wick tertinggi) harus minimal 4 tick
            if (highPrice - lowPrice < minHeight) {
                return;
            }

            // 2. Untuk pola 1-candle, candle tersebut wajib berjarak minimal 4 tick dari wick atas ke wick bawah
            if (candleCount === 1) {
                const c = candles[endIndex];
                if (c.high - c.low < minHeight) {
                    return;
                }
            } else if (candleCount === 2) {
                const c1 = candles[startIndex];
                const c2 = candles[endIndex];
                // Untuk pola 2-candle, setidaknya candle utama/penentu atau keduanya harus berukuran minimal 4 tick
                if (Math.max(c1.high - c1.low, c2.high - c2.low) < minHeight) {
                    return;
                }
            } else if (candleCount >= 3) {
                // Untuk pola 3-candle atau 5-candle, setidaknya candle pembalikan/impuls harus mencapai 4 tick
                let maxCdlH = 0;
                for (let k = startIndex; k <= endIndex; k++) {
                    const h = candles[k].high - candles[k].low;
                    if (h > maxCdlH) maxCdlH = h;
                }
                if (maxCdlH < minHeight) {
                    return;
                }
            }
        }

        // Recency bonus so recent actionable patterns are prioritized
        const recencyBonus = Math.max(0, 40 - (n - 1 - endIndex) * 0.2);

        // Next-bar confirmation bonus
        let confirmBonus = 0;
        if (endIndex + 1 < n) {
            const nextC = candles[endIndex + 1];
            if (direction === 'bullish' && nextC.close > candles[endIndex].close) {
                confirmBonus = 25;
            } else if (direction === 'bearish' && nextC.close < candles[endIndex].close) {
                confirmBonus = 25;
            }
        }

        rawPatterns.push({
            id: `cdl_${type}_${startIndex}_${endIndex}`,
            type,
            name,
            category,
            direction,
            candleCount,
            startIndex,
            endIndex,
            startTime: candles[startIndex].time,
            endTime: candles[endIndex].time,
            highPrice,
            lowPrice,
            qualityScore: baseScore + recencyBonus + confirmBonus,
        });
    };

    for (let i = scanStart; i < n; i++) {
        const cur = candles[i];
        if (!cur || cur.high === cur.low) continue; // Ignore flat dormant candles

        const localAtr = atr[i] || Math.abs(cur.close * 0.005);
        const m0 = getCandleMetrics(cur, localAtr);

        const isDown1 = hasPriorTrendAndSwingExtreme(candles, atr, i, i, 'downtrend', 8);
        const isUp1 = hasPriorTrendAndSwingExtreme(candles, atr, i, i, 'uptrend', 8);

        // Filter 1-candle pattern noise untuk IHSG: jika tinggi candle cur < 4 tick dari wick atas ke bawah, lewati pola 1-candle
        const isIdxUnder4Ticks = !isForex && (cur.high - cur.low < getIdxMinCandleHeight(cur.close));

        // =====================================================================
        // 1. BAB 24.1 — POLA 1 CANDLE (ANATOMI, BULLISH & BEARISH REVERSAL)
        // =====================================================================
        if (!isIdxUnder4Ticks) {
            // 1.1 Green Marubozu & Red Marubozu (Strong Continuation / Impulse)
            if (
                m0.isGreen &&
                m0.body >= localAtr * 1.4 &&
                m0.upperShadow <= m0.body * 0.04 &&
                m0.lowerShadow <= m0.body * 0.04 &&
                hasContinuationTrend(candles, atr, i, 'uptrend', 6)
            ) {
                pushPattern('green_marubozu', 'Green Marubozu', 'continuation', 'bullish', 1, i, i, 68);
            } else if (
                m0.isRed &&
                m0.body >= localAtr * 1.4 &&
                m0.upperShadow <= m0.body * 0.04 &&
                m0.lowerShadow <= m0.body * 0.04 &&
                hasContinuationTrend(candles, atr, i, 'downtrend', 6)
            ) {
                pushPattern('red_marubozu', 'Red Marubozu', 'continuation', 'bearish', 1, i, i, 68);
            }

            // 1.2 Bullish 1-Candle Reversals (at Swing Low after Downtrend)
            if (isDown1 && m0.range >= localAtr * 0.7) {
                if (m0.isDoji) {
                    if (m0.lowerShadow >= m0.range * 0.68 && m0.upperShadow <= m0.range * 0.15) {
                        pushPattern('dragonfly', 'Dragonfly Doji', 'reversal', 'bullish', 1, i, i, 82);
                    } else if (
                        m0.range >= localAtr * 1.35 &&
                        m0.upperShadow >= m0.range * 0.3 &&
                        m0.lowerShadow >= m0.range * 0.3
                    ) {
                        pushPattern(
                            'southern_long_leg_doji',
                            'Southern Long-Leg Doji',
                            'reversal',
                            'bullish',
                            1,
                            i,
                            i,
                            76
                        );
                    } else {
                        pushPattern('southern_doji', 'Southern Doji', 'reversal', 'bullish', 1, i, i, 70);
                    }
                } else if (
                    m0.isSmallBody &&
                    m0.lowerShadow >= m0.body * 2.2 &&
                    m0.lowerShadow >= m0.range * 0.58 &&
                    m0.upperShadow <= m0.range * 0.16
                ) {
                    pushPattern('hammer', 'Hammer', 'reversal', 'bullish', 1, i, i, 84);
                } else if (
                    m0.isSmallBody &&
                    m0.upperShadow >= m0.body * 2.2 &&
                    m0.upperShadow >= m0.range * 0.58 &&
                    m0.lowerShadow <= m0.range * 0.16
                ) {
                    pushPattern('inverted_hammer', 'Inverted Hammer', 'reversal', 'bullish', 1, i, i, 78);
                } else if (
                    i >= 1 &&
                    m0.isGreen &&
                    m0.isLongBody &&
                    m0.open < candles[i - 1].low &&
                    m0.lowerShadow <= m0.body * 0.05 &&
                    m0.upperShadow <= m0.body * 0.2
                ) {
                    pushPattern('bullish_belt_hold', 'Bullish Belt Hold', 'reversal', 'bullish', 1, i, i, 80);
                }
            }

            // 1.3 Bearish 1-Candle Reversals (at Swing High after Uptrend)
            if (isUp1 && m0.range >= localAtr * 0.7) {
                if (m0.isDoji) {
                    if (m0.upperShadow >= m0.range * 0.68 && m0.lowerShadow <= m0.range * 0.15) {
                        pushPattern('gravestone', 'Gravestone Doji', 'reversal', 'bearish', 1, i, i, 82);
                    } else if (
                        m0.range >= localAtr * 1.35 &&
                        m0.upperShadow >= m0.range * 0.3 &&
                        m0.lowerShadow >= m0.range * 0.3
                    ) {
                        pushPattern(
                            'northern_long_leg_doji',
                            'Northern Long-Leg Doji',
                            'reversal',
                            'bearish',
                            1,
                            i,
                            i,
                            76
                        );
                    } else {
                        pushPattern('northern_doji', 'Northern Doji', 'reversal', 'bearish', 1, i, i, 70);
                    }
                } else if (
                    m0.isSmallBody &&
                    m0.upperShadow >= m0.body * 2.2 &&
                    m0.upperShadow >= m0.range * 0.58 &&
                    m0.lowerShadow <= m0.range * 0.16
                ) {
                    pushPattern('shooting_star', 'Shooting Star', 'reversal', 'bearish', 1, i, i, 84);
                } else if (
                    m0.isSmallBody &&
                    m0.lowerShadow >= m0.body * 2.2 &&
                    m0.lowerShadow >= m0.range * 0.58 &&
                    m0.upperShadow <= m0.range * 0.16
                ) {
                    pushPattern('hanging_man', 'Hanging Man', 'reversal', 'bearish', 1, i, i, 78);
                } else if (
                    i >= 1 &&
                    m0.isRed &&
                    m0.isLongBody &&
                    m0.open > candles[i - 1].high &&
                    m0.upperShadow <= m0.body * 0.05 &&
                    m0.lowerShadow <= m0.body * 0.2
                ) {
                    pushPattern('bearish_belt_hold', 'Bearish Belt Hold', 'reversal', 'bearish', 1, i, i, 80);
                }
            }
        }

        // =====================================================================
        // 2. BAB 24.1 & 24.2 — POLA 2 CANDLE (REVERSAL & TASUKI CONTINUATION)
        // =====================================================================
        if (i >= 1) {
            const c1 = candles[i - 1];
            const m1 = getCandleMetrics(c1, atr[i - 1] || localAtr);
            const isDown2 = hasPriorTrendAndSwingExtreme(candles, atr, i - 1, i, 'downtrend', 8);
            const isUp2 = hasPriorTrendAndSwingExtreme(candles, atr, i - 1, i, 'uptrend', 8);
            const eqTol = localAtr * 0.08;

            // 2.1 Bullish 2-Candle Reversals (after Downtrend)
            if (isDown2) {
                // Bullish Engulfing: C1 red, C2 green long body engulfing C1 body
                if (
                    m1.isRed &&
                    m0.isGreen &&
                    m0.isLongBody &&
                    m0.bodyTop > m1.bodyTop &&
                    m0.bodyBottom < m1.bodyBottom &&
                    m0.body >= m1.body * 1.15
                ) {
                    pushPattern(
                        'bullish_engulfing',
                        'Bullish Engulfing',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        96
                    );
                }
                // Piercing Line: C1 long red, C2 green opens below C1 close and closes above C1 body midpoint
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m0.isGreen &&
                    m0.open < m1.close &&
                    m0.close > m1.bodyMid &&
                    m0.close < m1.open
                ) {
                    pushPattern(
                        'piercing_line',
                        'Piercing Line',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        93
                    );
                }
                // Bullish Pregnant Cross (Harami Cross): C1 long red, C2 Doji inside C1 body
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m0.isDoji &&
                    m0.bodyTop < m1.bodyTop &&
                    m0.bodyBottom > m1.bodyBottom
                ) {
                    pushPattern(
                        'bullish_pregnant_cross',
                        'Bullish Pregnant Cross',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        88
                    );
                }
                // Bullish Pregnant (Harami): C1 long red, C2 small green inside C1 body
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m0.isGreen &&
                    m0.body <= m1.body * 0.6 &&
                    m0.bodyTop < m1.bodyTop &&
                    m0.bodyBottom > m1.bodyBottom
                ) {
                    pushPattern(
                        'bullish_pregnant',
                        'Bullish Pregnant',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        86
                    );
                }
                // Bullish Homing Pigeon: C1 long red, C2 smaller red inside C1 body
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m0.isRed &&
                    m0.body <= m1.body * 0.6 &&
                    m0.bodyTop < m1.bodyTop &&
                    m0.bodyBottom > m1.bodyBottom
                ) {
                    pushPattern(
                        'bullish_homing_pigeon',
                        'Bullish Homing Pigeon',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        84
                    );
                }
                // Matching Low: C1 red, C2 red, C2 close == C1 close
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m0.isRed &&
                    m0.open < m1.open &&
                    Math.abs(m0.close - m1.close) <= eqTol
                ) {
                    pushPattern(
                        'matching_low',
                        'Matching Low',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        85
                    );
                }
                // Tweezer Bottom: C1 red, C2 green, L1 == L2
                else if (
                    m1.isRed &&
                    m0.isGreen &&
                    Math.abs(m1.low - m0.low) <= eqTol &&
                    (m1.range >= localAtr * 0.8 || m0.range >= localAtr * 0.8)
                ) {
                    pushPattern(
                        'tweezer_bottom',
                        'Tweezer Bottom',
                        'reversal',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        87
                    );
                }
            }

            // 2.2 Bearish 2-Candle Reversals (after Uptrend)
            if (isUp2) {
                // Bearish Engulfing: C1 green, C2 red long body engulfing C1 body
                if (
                    m1.isGreen &&
                    m0.isRed &&
                    m0.isLongBody &&
                    m0.bodyTop > m1.bodyTop &&
                    m0.bodyBottom < m1.bodyBottom &&
                    m0.body >= m1.body * 1.15
                ) {
                    pushPattern(
                        'bearish_engulfing',
                        'Bearish Engulfing',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        96
                    );
                }
                // Dark Cloud Cover: C1 long green, C2 red opens above C1 close and closes below C1 body midpoint
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m0.isRed &&
                    m0.open > m1.close &&
                    m0.close < m1.bodyMid &&
                    m0.close > m1.open
                ) {
                    pushPattern(
                        'dark_cloud_cover',
                        'Dark Cloud Cover',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        93
                    );
                }
                // Bearish Pregnant Cross (Harami Cross): C1 long green, C2 Doji inside C1 body
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m0.isDoji &&
                    m0.bodyTop < m1.bodyTop &&
                    m0.bodyBottom > m1.bodyBottom
                ) {
                    pushPattern(
                        'bearish_pregnant_cross',
                        'Bearish Pregnant Cross',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        88
                    );
                }
                // Bearish Pregnant (Harami): C1 long green, C2 small red inside C1 body
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m0.isRed &&
                    m0.body <= m1.body * 0.6 &&
                    m0.bodyTop < m1.bodyTop &&
                    m0.bodyBottom > m1.bodyBottom
                ) {
                    pushPattern(
                        'bearish_pregnant',
                        'Bearish Pregnant',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        86
                    );
                }
                // Bearish Homing Pigeon: C1 long green, C2 smaller green inside C1 body
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m0.isGreen &&
                    m0.body <= m1.body * 0.6 &&
                    m0.bodyTop < m1.bodyTop &&
                    m0.bodyBottom > m1.bodyBottom
                ) {
                    pushPattern(
                        'bearish_homing_pigeon',
                        'Bearish Homing Pigeon',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        84
                    );
                }
                // Matching High: C1 green, C2 green, C2 close == C1 close
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m0.isGreen &&
                    m0.open > m1.open &&
                    Math.abs(m0.close - m1.close) <= eqTol
                ) {
                    pushPattern(
                        'matching_high',
                        'Matching High',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        85
                    );
                }
                // Tweezer Top: C1 green, C2 red, H1 == H2
                else if (
                    m1.isGreen &&
                    m0.isRed &&
                    Math.abs(m1.high - m0.high) <= eqTol &&
                    (m1.range >= localAtr * 0.8 || m0.range >= localAtr * 0.8)
                ) {
                    pushPattern(
                        'tweezer_top',
                        'Tweezer Top',
                        'reversal',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        87
                    );
                }
            }

            // 2.3 Upward & Downward Gap Tasuki (Bab 24.2 Continuation)
            if (i >= 2) {
                const cPrev = candles[i - 2];
                // Upward Gap Tasuki: Uptrend -> C1 green gap-up above cPrev.high -> C2 red pullback with L2 > cPrev.high
                if (
                    m1.isGreen &&
                    m1.low > cPrev.high &&
                    m0.isRed &&
                    m0.open <= m1.close &&
                    m0.open >= m1.open &&
                    m0.close < m1.open &&
                    m0.low > cPrev.high &&
                    hasContinuationTrend(candles, atr, i - 1, 'uptrend', 6)
                ) {
                    pushPattern(
                        'upward_gap_tasuki',
                        'Upward Gap Tasuki',
                        'continuation',
                        'bullish',
                        2,
                        i - 1,
                        i,
                        92
                    );
                }
                // Downward Gap Tasuki: Downtrend -> C1 red gap-down below cPrev.low -> C2 green bounce with H2 < cPrev.low
                if (
                    m1.isRed &&
                    m1.high < cPrev.low &&
                    m0.isGreen &&
                    m0.open >= m1.close &&
                    m0.open <= m1.open &&
                    m0.close > m1.open &&
                    m0.high < cPrev.low &&
                    hasContinuationTrend(candles, atr, i - 1, 'downtrend', 6)
                ) {
                    pushPattern(
                        'downward_gap_tasuki',
                        'Downward Gap Tasuki',
                        'continuation',
                        'bearish',
                        2,
                        i - 1,
                        i,
                        92
                    );
                }
            }
        }

        // =====================================================================
        // 3. BAB 24.2 — POLA 3 CANDLE (BULLISH & BEARISH REVERSAL)
        // =====================================================================
        if (i >= 2) {
            const c1 = candles[i - 2];
            const c2 = candles[i - 1];
            const m1 = getCandleMetrics(c1, atr[i - 2] || localAtr);
            const m2 = getCandleMetrics(c2, atr[i - 1] || localAtr);
            const m3 = m0;

            const isDown3 = hasPriorTrendAndSwingExtreme(candles, atr, i - 2, i, 'downtrend', 8);
            const isUp3 = hasPriorTrendAndSwingExtreme(candles, atr, i - 2, i, 'uptrend', 8);

            // 3.1 Bullish 3-Candle Reversals (after Downtrend)
            if (isDown3) {
                // Bullish Abandoned Baby: C1 red, C2 gap-down (H2 < L1), C3 green gap-up (L3 > H2)
                if (
                    m1.isRed &&
                    m2.high < m1.low &&
                    m3.isGreen &&
                    m3.low > m2.high
                ) {
                    pushPattern(
                        'bullish_abandoned_baby',
                        'Bullish Abandoned Baby',
                        'reversal',
                        'bullish',
                        3,
                        i - 2,
                        i,
                        115
                    );
                }
                // Morning Doji Star: C1 long red, C2 Doji dropping below C1 body, C3 strong green closing into C1 body
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m2.isDoji &&
                    m2.bodyTop <= m1.bodyBottom + localAtr * 0.1 &&
                    m3.isGreen &&
                    m3.close >= m1.bodyMid
                ) {
                    pushPattern(
                        'morning_doji_star',
                        'Morning Doji Star',
                        'reversal',
                        'bullish',
                        3,
                        i - 2,
                        i,
                        110
                    );
                }
                // Morning Star: C1 long red, C2 small body at bottom, C3 strong green closing into C1 body
                else if (
                    m1.isRed &&
                    m1.isLongBody &&
                    m2.isSmallBody &&
                    m2.bodyBottom <= m1.bodyBottom &&
                    m2.bodyTop <= m1.bodyMid &&
                    m3.isGreen &&
                    m3.isLongBody &&
                    m3.close >= m1.bodyMid
                ) {
                    pushPattern(
                        'morning_star',
                        'Morning Star',
                        'reversal',
                        'bullish',
                        3,
                        i - 2,
                        i,
                        108
                    );
                }
                // Morning Tri Star: C1, C2, C3 all Doji / tiny body at bottom
                else if (
                    (m1.isDoji || m1.body <= localAtr * 0.15) &&
                    (m2.isDoji || m2.body <= localAtr * 0.15) &&
                    (m3.isDoji || m3.body <= localAtr * 0.15)
                ) {
                    pushPattern(
                        'morning_tri_star',
                        'Morning Tri Star',
                        'reversal',
                        'bullish',
                        3,
                        i - 2,
                        i,
                        104
                    );
                }
                // Three Green Soldiers: 3 consecutive long green candles stepping higher
                else if (
                    m1.isGreen &&
                    m2.isGreen &&
                    m3.isGreen &&
                    m1.body >= localAtr * 0.65 &&
                    m2.body >= localAtr * 0.65 &&
                    m3.body >= localAtr * 0.65 &&
                    m2.open >= m1.open &&
                    m2.open <= m1.close * 1.003 &&
                    m2.close > m1.close &&
                    m3.open >= m2.open &&
                    m3.open <= m2.close * 1.003 &&
                    m3.close > m2.close
                ) {
                    pushPattern(
                        'three_green_soldiers',
                        'Three Green Soldiers',
                        'reversal',
                        'bullish',
                        3,
                        i - 2,
                        i,
                        109
                    );
                }
            }

            // 3.2 Bearish 3-Candle Reversals (after Uptrend)
            if (isUp3) {
                // Bearish Abandoned Baby: C1 green, C2 gap-up (L2 > H1), C3 red gap-down (H3 < L2)
                if (
                    m1.isGreen &&
                    m2.low > m1.high &&
                    m3.isRed &&
                    m3.high < m2.low
                ) {
                    pushPattern(
                        'bearish_abandoned_baby',
                        'Bearish Abandoned Baby',
                        'reversal',
                        'bearish',
                        3,
                        i - 2,
                        i,
                        115
                    );
                }
                // Evening Doji Star: C1 long green, C2 Doji above C1 body, C3 strong red closing below C1 midpoint
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m2.isDoji &&
                    m2.bodyBottom >= m1.bodyTop - localAtr * 0.1 &&
                    m3.isRed &&
                    m3.close <= m1.bodyMid
                ) {
                    pushPattern(
                        'evening_doji_star',
                        'Evening Doji Star',
                        'reversal',
                        'bearish',
                        3,
                        i - 2,
                        i,
                        110
                    );
                }
                // Evening Star: C1 long green, C2 small body at top, C3 strong red closing below C1 midpoint
                else if (
                    m1.isGreen &&
                    m1.isLongBody &&
                    m2.isSmallBody &&
                    m2.bodyTop >= m1.bodyTop &&
                    m2.bodyBottom >= m1.bodyMid &&
                    m3.isRed &&
                    m3.isLongBody &&
                    m3.close <= m1.bodyMid
                ) {
                    pushPattern(
                        'evening_star',
                        'Evening Star',
                        'reversal',
                        'bearish',
                        3,
                        i - 2,
                        i,
                        108
                    );
                }
                // Evening Tri Star: C1, C2, C3 all Doji / tiny body at top
                else if (
                    (m1.isDoji || m1.body <= localAtr * 0.15) &&
                    (m2.isDoji || m2.body <= localAtr * 0.15) &&
                    (m3.isDoji || m3.body <= localAtr * 0.15)
                ) {
                    pushPattern(
                        'evening_tri_star',
                        'Evening Tri Star',
                        'reversal',
                        'bearish',
                        3,
                        i - 2,
                        i,
                        104
                    );
                }
                // Three Red Crows: 3 consecutive long red candles stepping lower
                else if (
                    m1.isRed &&
                    m2.isRed &&
                    m3.isRed &&
                    m1.body >= localAtr * 0.65 &&
                    m2.body >= localAtr * 0.65 &&
                    m3.body >= localAtr * 0.65 &&
                    m2.open <= m1.open &&
                    m2.open >= m1.close * 0.997 &&
                    m2.close < m1.close &&
                    m3.open <= m2.open &&
                    m3.open >= m2.close * 0.997 &&
                    m3.close < m2.close
                ) {
                    pushPattern(
                        'three_red_crows',
                        'Three Red Crows',
                        'reversal',
                        'bearish',
                        3,
                        i - 2,
                        i,
                        109
                    );
                }
            }
        }

        // =====================================================================
        // 4. BAB 24.2 — POLA 5 CANDLE CONTINUATION (RISING THREE & FALLING THREE)
        // =====================================================================
        if (i >= 4) {
            const c1 = candles[i - 4];
            const c2 = candles[i - 3];
            const c3 = candles[i - 2];
            const c4 = candles[i - 1];

            const m1 = getCandleMetrics(c1, atr[i - 4] || localAtr);
            const m2 = getCandleMetrics(c2, atr[i - 3] || localAtr);
            const m3 = getCandleMetrics(c3, atr[i - 2] || localAtr);
            const m4 = getCandleMetrics(c4, atr[i - 1] || localAtr);
            const m5 = m0;

            const insideC1Range =
                c2.high <= c1.high + localAtr * 0.15 &&
                c2.low >= c1.low - localAtr * 0.15 &&
                c3.high <= c1.high + localAtr * 0.15 &&
                c3.low >= c1.low - localAtr * 0.15 &&
                c4.high <= c1.high + localAtr * 0.15 &&
                c4.low >= c1.low - localAtr * 0.15 &&
                m2.body < m1.body * 0.65 &&
                m3.body < m1.body * 0.65 &&
                m4.body < m1.body * 0.65;

            // Rising Three: Uptrend -> C1 long green -> C2,C3,C4 small inside C1 range -> C5 long green closing > H1
            if (
                m1.isGreen &&
                m1.isLongBody &&
                insideC1Range &&
                m5.isGreen &&
                m5.isLongBody &&
                m5.close > m1.high &&
                hasContinuationTrend(candles, atr, i - 4, 'uptrend', 6)
            ) {
                pushPattern(
                    'rising_three',
                    'Rising Three',
                    'continuation',
                    'bullish',
                    5,
                    i - 4,
                    i,
                    118
                );
            }

            // Falling Three: Downtrend -> C1 long red -> C2,C3,C4 small inside C1 range -> C5 long red closing < L1
            if (
                m1.isRed &&
                m1.isLongBody &&
                insideC1Range &&
                m5.isRed &&
                m5.isLongBody &&
                m5.close < m1.low &&
                hasContinuationTrend(candles, atr, i - 4, 'downtrend', 6)
            ) {
                pushPattern(
                    'falling_three',
                    'Falling Three',
                    'continuation',
                    'bearish',
                    5,
                    i - 4,
                    i,
                    118
                );
            }
        }
    }

    // Filter according to requested mode
    let filtered = rawPatterns;
    if (mode === 'bullish' || mode === 'bearish') {
        filtered = rawPatterns.filter((p) => p.direction === mode);
    } else if (mode === 'reversal' || mode === 'continuation') {
        filtered = rawPatterns.filter((p) => p.category === mode);
    } else if (mode === '1_candle') {
        filtered = rawPatterns.filter((p) => p.candleCount === 1);
    } else if (mode === '2_candle') {
        filtered = rawPatterns.filter((p) => p.candleCount === 2);
    } else if (mode === '3_candle') {
        filtered = rawPatterns.filter((p) => p.candleCount === 3 || p.candleCount === 5);
    } else if (mode !== 'all') {
        const targetType =
            mode === 'white_marubozu' ? 'green_marubozu' :
            mode === 'black_marubozu' ? 'red_marubozu' :
            mode === 'three_white_soldiers' ? 'three_green_soldiers' :
            mode === 'three_black_crows' ? 'three_red_crows' : mode;
        filtered = rawPatterns.filter((p) => p.type === targetType || p.type === mode);
    }

    const maxAllowed = mode === 'all' ? 10 : 14;
    return deduplicateCandlestickPatterns(filtered, maxAllowed);
}