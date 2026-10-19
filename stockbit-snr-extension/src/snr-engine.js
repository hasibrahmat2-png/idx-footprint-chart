/**
 * Automated Support & Resistance (Dow Theory S/R & Supply/Demand Zones)
 * Ported directly from IDX Footprint Charting Platform (main.ts)
 */

(function(exports) {
    'use strict';

    function getIdxTickSize(price) {
        if (price < 200) return 1;
        if (price < 500) return 2;
        if (price < 2000) return 5;
        if (price < 5000) return 10;
        return 25;
    }

    function calculateAutoSR(candles, options) {
        options = options || {};
        const lookback = options.lookback || 10;
        const maxLines = options.maxLines !== undefined ? options.maxLines : 3;
        const maxZones = options.maxZones !== undefined ? options.maxZones : 2;

        if (!candles || candles.length < lookback * 2 + 1) {
            return null;
        }

        const currentBar = candles[candles.length - 1];
        if (!currentBar || typeof currentBar.close !== 'number') return null;
        const currentPrice = currentBar.close;

        // 1. Detect Pivot Highs & Pivot Lows
        const swings = [];
        for (let i = lookback; i < candles.length - lookback; i++) {
            const bar = candles[i];
            if (!bar || typeof bar.high !== 'number' || typeof bar.low !== 'number') continue;

            let isPivotHigh = true;
            for (let j = 1; j <= lookback; j++) {
                const prev = candles[i - j];
                const next = candles[i + j];
                if ((prev && prev.high > bar.high) || (next && next.high > bar.high)) {
                    isPivotHigh = false;
                    break;
                }
            }
            if (isPivotHigh) {
                swings.push({ type: 'high', price: bar.high, barIndex: i, time: bar.time });
            }

            let isPivotLow = true;
            for (let j = 1; j <= lookback; j++) {
                const prev = candles[i - j];
                const next = candles[i + j];
                if ((prev && prev.low < bar.low) || (next && next.low < bar.low)) {
                    isPivotLow = false;
                    break;
                }
            }
            if (isPivotLow) {
                swings.push({ type: 'low', price: bar.low, barIndex: i, time: bar.time });
            }
        }

        // 2. Separate into Levels Above (Resistance/Supply) and Levels Below (Support/Demand) - Role Reversal
        const aboveAll = swings.filter(s => s.price > currentPrice);
        const belowAll = swings.filter(s => s.price < currentPrice);

        // Lookback window: prioritize recent 500 bars
        const recentCutoff = Math.max(0, candles.length - 500);
        let recentAbove = aboveAll.filter(s => s.barIndex >= recentCutoff);
        let recentBelow = belowAll.filter(s => s.barIndex >= recentCutoff);

        // Breakout fallback
        if (recentAbove.length === 0) {
            recentAbove = aboveAll.slice(-15);
        } else if (recentAbove.length < 5 && aboveAll.length > recentAbove.length) {
            const older = aboveAll.slice(-5);
            const combined = [...older, ...recentAbove];
            recentAbove = combined.filter((s, idx, arr) => arr.findIndex(x => x.barIndex === s.barIndex) === idx);
        }

        // Breakdown fallback
        if (recentBelow.length === 0) {
            recentBelow = belowAll.slice(-15);
        } else if (recentBelow.length < 5 && belowAll.length > recentBelow.length) {
            const older = belowAll.slice(-5);
            const combined = [...older, ...recentBelow];
            recentBelow = combined.filter((s, idx, arr) => arr.findIndex(x => x.barIndex === s.barIndex) === idx);
        }

        // Count touches based on distinct swing pivots and significant price tests
        function countPriceTouches(price, isRes) {
            const swingMatches = swings.filter(s => Math.abs(s.price - price) < 0.001).length;
            let candleTests = 0;
            let lastK = -20;
            const searchStart = Math.max(0, candles.length - 500);
            for (let k = searchStart; k < candles.length; k++) {
                const b = candles[k];
                if (!b) continue;
                let hit = false;
                if (isRes && Math.abs(b.high - price) < 0.001) hit = true;
                else if (!isRes && Math.abs(b.low - price) < 0.001) hit = true;

                if (hit && (k - lastK) >= 10) {
                    candleTests++;
                    lastK = k;
                }
            }
            return Math.max(swingMatches, candleTests, 1);
        }

        // Process each side (Above or Below)
        function processSide(swingCandidates, isAbove) {
            if (!swingCandidates || swingCandidates.length === 0) {
                return { lines: [], zones: [] };
            }

            const uniquePrices = [];
            const priceToSwing = {};
            for (let k = swingCandidates.length - 1; k >= 0; k--) {
                const s = swingCandidates[k];
                if (!priceToSwing[s.price]) {
                    uniquePrices.push(s.price);
                    priceToSwing[s.price] = s;
                }
            }

            const sortedPrices = [...uniquePrices].sort((a, b) => a - b);

            // 1. Detect clusters of near prices (within 3 ticks)
            const clusters = [];
            const clusteredPrices = new Set();

            for (let i = 0; i < sortedPrices.length; i++) {
                const p1 = sortedPrices[i];
                if (clusteredPrices.has(p1)) continue;
                const tick = getIdxTickSize(p1);
                const group = [p1];
                for (let j = i + 1; j < sortedPrices.length; j++) {
                    const p2 = sortedPrices[j];
                    if (Math.abs(p2 - p1) <= 3 * tick) {
                        group.push(p2);
                    } else {
                        break;
                    }
                }
                if (group.length >= 2) {
                    group.forEach(p => clusteredPrices.add(p));
                    clusters.push(group);
                }
            }

            // 2. Build non-overlapping Supply or Demand Zones
            const zones = [];
            if (isAbove) {
                clusters.sort((a, b) => {
                    const cA = [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
                    const cB = [...b].sort((x, y) => x - y)[Math.floor(b.length / 2)];
                    return cA - cB;
                });
                let prevTop = currentPrice;
                for (const grp of clusters) {
                    const sortedGrp = [...grp].sort((a, b) => a - b);
                    const center = sortedGrp[Math.floor(sortedGrp.length / 2)];
                    const tick = getIdxTickSize(center);
                    const bot = Math.max(prevTop + tick, center - 3 * tick);
                    const top = Math.max(bot + tick, center + 3 * tick);
                    const adjustedCenter = Math.min(top, Math.max(bot, center));
                    zones.push({
                        centerPrice: adjustedCenter,
                        topPrice: top,
                        bottomPrice: bot,
                        type: 'supply',
                        clusterPrices: grp,
                        label: `Supply Zone (${adjustedCenter})`
                    });
                    prevTop = top;
                }
            } else {
                clusters.sort((a, b) => {
                    const cA = [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
                    const cB = [...b].sort((x, y) => x - y)[Math.floor(b.length / 2)];
                    return cB - cA;
                });
                let prevBot = currentPrice;
                for (const grp of clusters) {
                    const sortedGrp = [...grp].sort((a, b) => a - b);
                    const center = sortedGrp[Math.floor(sortedGrp.length / 2)];
                    const tick = getIdxTickSize(center);
                    const top = Math.min(prevBot - tick, center + 3 * tick);
                    const bot = Math.min(top - tick, center - 3 * tick);
                    const adjustedCenter = Math.min(top, Math.max(bot, center));
                    zones.push({
                        centerPrice: adjustedCenter,
                        topPrice: top,
                        bottomPrice: bot,
                        type: 'demand',
                        clusterPrices: grp,
                        label: `Demand Zone (${adjustedCenter})`
                    });
                    prevBot = bot;
                }
            }

            // 3. Build Lines - ONLY for prices that are NOT in a cluster and NOT inside any zone!
            const candidateLines = [];

            for (const p of uniquePrices) {
                if (clusteredPrices.has(p)) continue;
                const inAnyZone = zones.some(z => p >= z.bottomPrice && p <= z.topPrice);
                if (inAnyZone) continue;

                const touches = countPriceTouches(p, isAbove);
                const distPct = ((p - currentPrice) / currentPrice) * 100;
                const distSign = distPct >= 0 ? '+' : '';

                if (touches >= 2) {
                    candidateLines.push({
                        price: p,
                        touches: touches,
                        lineWidth: Math.min(4, touches),
                        lineStyle: 'solid',
                        title: `${isAbove ? 'Res' : 'Sup'} (${touches}x)`,
                        color: isAbove ? '#FF5252' : '#4CAF50',
                        distancePct: `${distSign}${distPct.toFixed(2)}%`
                    });
                } else {
                    candidateLines.push({
                        price: p,
                        touches: 1,
                        lineWidth: 1,
                        lineStyle: 'dotted',
                        title: `${isAbove ? 'High' : 'Low'} (1x)`,
                        color: isAbove ? '#FF5252' : '#4CAF50',
                        distancePct: `${distSign}${distPct.toFixed(2)}%`
                    });
                }
            }

            // 4. Anti-Clutter Filter: Spacing between lines must be at least 3 ticks!
            candidateLines.sort((a, b) => {
                if (b.touches !== a.touches) return b.touches - a.touches;
                return Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice);
            });

            const filteredLines = [];
            for (const l of candidateLines) {
                const tick = getIdxTickSize(l.price);
                const tooClose = filteredLines.some(fl => Math.abs(l.price - fl.price) < 3 * tick);
                if (!tooClose) {
                    filteredLines.push(l);
                }
            }

            // Sort final output:
            if (isAbove) {
                filteredLines.sort((a, b) => a.price - b.price);
                zones.sort((a, b) => a.centerPrice - b.centerPrice);
            } else {
                filteredLines.sort((a, b) => b.price - a.price);
                zones.sort((a, b) => b.centerPrice - a.centerPrice);
            }

            return {
                lines: filteredLines.slice(0, maxLines),
                zones: zones.slice(0, maxZones)
            };
        }

        const resResult = processSide(recentAbove, true);
        const supResult = processSide(recentBelow, false);

        return {
            currentPrice,
            resistances: resResult.lines,
            supports: supResult.lines,
            supplyZones: resResult.zones,
            demandZones: supResult.zones
        };
    }

    exports.getIdxTickSize = getIdxTickSize;
    exports.calculateAutoSR = calculateAutoSR;

})(window.StockbitSNR = window.StockbitSNR || {});
