import { test } from 'node:test';
import assert from 'node:assert';

// Dynamic import of the primitive module
const ghostModule = await import('../indicator-examples/src/my-footprint-ts/ghost-candle-primitive.ts');
const {
    getIdxTickSize,
    roundToIdxTick,
    calculateIdxLimits,
    calculateForexLimits,
    computeForexAdr,
    computeGhostCandleData,
    fmt5sig,
    formatIndoVolume,
} = ghostModule;

test('fmt5sig formatting matches 5 significant digits standard', () => {
    assert.strictEqual(fmt5sig(4200.1234), '4200.1');
    assert.strictEqual(fmt5sig(4068.61), '4068.6');
    assert.strictEqual(fmt5sig(65.7412), '65.741');
    assert.strictEqual(fmt5sig(1.08542), '1.0854');
    assert.strictEqual(fmt5sig(152.356), '152.36');
    assert.strictEqual(fmt5sig(68426.7), '68427');
    assert.strictEqual(fmt5sig(0), '0');
});

test('formatIndoVolume compact notation formats properly using rb, jt, and m', () => {
    assert.strictEqual(formatIndoVolume(0), '0');
    assert.strictEqual(formatIndoVolume(50), '50');
    assert.strictEqual(formatIndoVolume(999), '999');
    assert.strictEqual(formatIndoVolume(1000), '1 rb');
    assert.strictEqual(formatIndoVolume(100000), '100 rb');
    assert.strictEqual(formatIndoVolume(590000), '590 rb');
    assert.strictEqual(formatIndoVolume(1000000), '1 jt');
    assert.strictEqual(formatIndoVolume(1500000), '1.5 jt');
    assert.strictEqual(formatIndoVolume(10500000), '10.5 jt');
    assert.strictEqual(formatIndoVolume(1000000000), '1 m');
    assert.strictEqual(formatIndoVolume(2500000000), '2.5 m');
});

test('IDX Fraksi Harga (Tick Rules) & Statutory ARA/ARB Limits', () => {
    // 1. Below Rp200: Tick size 1, ARA 35%, ARB 15%
    const lim100 = calculateIdxLimits(100);
    assert.strictEqual(lim100.tickSize, 1);
    assert.strictEqual(lim100.araPrice, 135);
    assert.strictEqual(lim100.arbPrice, 85);
    assert.strictEqual(lim100.araPercent, 35);
    assert.strictEqual(lim100.arbPercent, 15);
    assert.strictEqual(lim100.actualAraPercent, 35.0);
    assert.strictEqual(lim100.actualArbPercent, -15.0);
    assert.strictEqual(lim100.upperLabel, 'ARA +35%: 135 (+35.0%)');
    assert.strictEqual(lim100.lowerLabel, 'ARB -15%: 85 (-15.0%)');

    // 2. Rp200 - <Rp500: Tick size 2, ARA 25%, ARB 15%
    // 300 * 1.25 = 375 -> rounded down to tick 2: 374
    // 300 * 0.85 = 255 -> rounded up to tick 2: 256
    const lim300 = calculateIdxLimits(300);
    assert.strictEqual(lim300.tickSize, 2);
    assert.strictEqual(lim300.araPrice, 374);
    assert.strictEqual(lim300.arbPrice, 256);
    assert.strictEqual(lim300.araPercent, 25);
    assert.strictEqual(lim300.arbPercent, 15);
    assert.strictEqual(lim300.upperLabel, 'ARA +25%: 374 (+24.7%)');
    assert.strictEqual(lim300.lowerLabel, 'ARB -15%: 256 (-14.7%)');

    // 3. Rp500 - <Rp2000: Tick size 5, ARA 25%, ARB 15%
    const lim1000 = calculateIdxLimits(1000);
    assert.strictEqual(lim1000.tickSize, 5);
    assert.strictEqual(lim1000.araPrice, 1250);
    assert.strictEqual(lim1000.arbPrice, 850);
    assert.strictEqual(lim1000.upperLabel, 'ARA +25%: 1250 (+25.0%)');
    assert.strictEqual(lim1000.lowerLabel, 'ARB -15%: 850 (-15.0%)');

    // 4. Rp2000 - <Rp5000: Tick size 10, ARA 25%, ARB 15%
    const lim3000 = calculateIdxLimits(3000);
    assert.strictEqual(lim3000.tickSize, 10);
    assert.strictEqual(lim3000.araPrice, 3750);
    assert.strictEqual(lim3000.arbPrice, 2550);
    assert.strictEqual(lim3000.upperLabel, 'ARA +25%: 3750 (+25.0%)');
    assert.strictEqual(lim3000.lowerLabel, 'ARB -15%: 2550 (-15.0%)');

    // 5. >= Rp5000: Tick size 25, ARA 20%, ARB 15%
    const lim8000 = calculateIdxLimits(8000);
    assert.strictEqual(lim8000.tickSize, 25);
    assert.strictEqual(lim8000.araPrice, 9600);
    assert.strictEqual(lim8000.arbPrice, 6800);
    assert.strictEqual(lim8000.araPercent, 20);
    assert.strictEqual(lim8000.upperLabel, 'ARA +20%: 9600 (+20.0%)');
    assert.strictEqual(lim8000.lowerLabel, 'ARB -15%: 6800 (-15.0%)');

    // 6. Minimum Floor Rp 1 (no Rp 50 lock / FCA deregulation)
    const lim2 = calculateIdxLimits(2);
    assert.strictEqual(lim2.arbPrice, 1);
});

test('Forex ADR Volatility Envelope calculation', () => {
    const refClose = 4134.4;
    const adr = 65.7;
    const limFx = calculateForexLimits(refClose, adr, 1);
    assert.strictEqual(limFx.isForex, true);
    assert.strictEqual(limFx.araPrice, 4200.1);
    assert.strictEqual(limFx.arbPrice, 4068.7);
    assert.strictEqual(limFx.upperLabel, 'ADR High (+1.6%): 4200.1');
    assert.strictEqual(limFx.lowerLabel, 'ADR Low (-1.6%): 4068.7');
});

import fs from 'node:fs';

test('Multi-Timeframe Institutional HUD & Parity with ghost_candle_exness_indie.py using real datasets', () => {
    // 1. Forex test on real XAUUSD daily data
    const xauDaily = JSON.parse(fs.readFileSync(new URL('../indicator-examples/public/XAUUSDm_1d.json', import.meta.url), 'utf8'));
    const xauPrev = xauDaily[xauDaily.length - 2];

    const dataXau = computeGhostCandleData(
        xauDaily,
        xauDaily,
        'XAUUSD',
        xauPrev.close,
        true,
        '1d',
        1
    );

    assert.strictEqual(dataXau.isForex, true);
    assert.strictEqual(dataXau.lineBars, 6);
    assert.strictEqual(dataXau.startFromPrevBar, true);
    assert.ok(dataXau.adrHigh > dataXau.refClose, 'adrHigh should be greater than refClose');
    assert.ok(dataXau.adrLow < dataXau.refClose, 'adrLow should be less than refClose');
    assert.ok(dataXau.adrHighLabel.startsWith('ADR High (+'), `adrHighLabel should start with ADR High (+): got ${dataXau.adrHighLabel}`);
    assert.ok(dataXau.adrLowLabel.startsWith('ADR Low (-'), `adrLowLabel should start with ADR Low (-): got ${dataXau.adrLowLabel}`);
    assert.ok(dataXau.hud, 'HUD data should be present');
    assert.strictEqual(dataXau.hud.showHud, true);

    // Verify HUD lines: Clean text without emojis
    const line1 = dataXau.hud.hudLine1;
    const line2 = dataXau.hud.hudLine2;
    const line3 = dataXau.hud.hudLine3;
    const line4 = dataXau.hud.hudLine4;

    assert.ok(line1.startsWith('ADR Used:'), `Line 1 should start with ADR Used: got "${line1}"`);
    assert.ok(line2.startsWith('Trend: ADX'), `Line 2 should start with Trend: ADX: got "${line2}"`);
    assert.ok(line3.startsWith('Volatility: ATR-14:'), `Line 3 should start with Volatility: ATR-14: got "${line3}"`);
    assert.ok(line3.includes('| 1.5x SL Buffer:'), `Line 3 should include 1.5x SL Buffer: got "${line3}"`);
    assert.ok(line4, 'Line 4 (Volume) should be present');
    assert.ok(line4.startsWith('Volume:'), `Line 4 should start with Volume: got "${line4}"`);

    // Verify zero emojis
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]/u;
    assert.strictEqual(emojiRegex.test(line1), false, 'Line 1 must not contain emojis');
    assert.strictEqual(emojiRegex.test(line2), false, 'Line 2 must not contain emojis');
    assert.strictEqual(emojiRegex.test(line3), false, 'Line 3 must not contain emojis');
    assert.strictEqual(emojiRegex.test(line4), false, 'Line 4 must not contain emojis');

    // 2. Real IHSG Equity test on KAQI
    const kaqiDaily = JSON.parse(fs.readFileSync(new URL('../indicator-examples/public/KAQI_1d.json', import.meta.url), 'utf8'));
    const kaqiPrev = kaqiDaily[kaqiDaily.length - 2];

    const dataKaqi = computeGhostCandleData(
        kaqiDaily,
        kaqiDaily,
        'KAQI',
        kaqiPrev.close,
        false,
        '1d',
        0
    );

    assert.strictEqual(dataKaqi.isForex, false);
    // Statutory limits for KAQI (price <= 200 -> ARA 35%, ARB 15%)
    assert.ok(dataKaqi.limits.araPrice > kaqiPrev.close, 'ARA price must be above refClose');
    assert.ok(dataKaqi.limits.arbPrice < kaqiPrev.close, 'ARB price must be below refClose');
    assert.ok(dataKaqi.limits.upperLabel.startsWith('ARA +35%:'));
    assert.ok(dataKaqi.limits.lowerLabel.startsWith('ARB -15%:'));

    // Statistical Volatility Envelope (Ceiling +1.0 ADR & Floor -1.0 ADR)
    assert.ok(dataKaqi.adrHigh > kaqiPrev.close, 'IHSG adrHigh must be above refClose');
    assert.ok(dataKaqi.adrLow < kaqiPrev.close, 'IHSG adrLow must be below refClose');
    assert.ok(dataKaqi.adrHigh < dataKaqi.limits.araPrice, 'ADR High should normally be well within statutory ARA');
    assert.ok(dataKaqi.adrLow > dataKaqi.limits.arbPrice, 'ADR Low should normally be well above statutory ARB');
    assert.ok(dataKaqi.adrHighLabel.startsWith('ADR High (+'));
    assert.ok(dataKaqi.adrLowLabel.startsWith('ADR Low (-'));
});

test('Timeframe-Adaptive ADR Ceiling Scaling (1m intraday vs 1d daily)', () => {
    const kaqiDaily = JSON.parse(fs.readFileSync(new URL('../indicator-examples/public/KAQI_1d.json', import.meta.url), 'utf8'));
    const kaqi1m = JSON.parse(fs.readFileSync(new URL('../indicator-examples/public/KAQI_1m.json', import.meta.url), 'utf8'));

    const last1mSlice = kaqi1m.slice(-30);
    const kaqi1mPrev = last1mSlice[last1mSlice.length - 2];
    const kaqi1dPrev = kaqiDaily[kaqiDaily.length - 2];

    const data1m = computeGhostCandleData(
        last1mSlice,
        kaqiDaily,
        'KAQI',
        kaqi1dPrev.close,
        false,
        '1m',
        0
    );

    const data1d = computeGhostCandleData(
        kaqiDaily,
        kaqiDaily,
        'KAQI',
        kaqi1dPrev.close,
        false,
        '1d',
        0
    );

    // Dynamic Timeframe Parity: 1m ATR is strictly tighter than 1d ATR
    assert.ok(data1m.adrVal < data1d.adrVal, `1m adrVal (${data1m.adrVal}) must be tighter than 1d adrVal (${data1d.adrVal})`);
    assert.ok(data1m.adrHigh < data1d.adrHigh, `1m adrHigh (${data1m.adrHigh}) must be tighter than 1d adrHigh (${data1d.adrHigh})`);
    assert.strictEqual(data1m.refClose, kaqi1mPrev.close, '1m data must anchor refClose to previous 1m candle');
    assert.strictEqual(data1d.refClose, kaqi1dPrev.close, '1d data must anchor refClose to previous 1d candle');

    // Invariant Audit: Daily IHSG candle is ARA/ARB, whereas Intraday candle is ADR ceiling/floor
    assert.strictEqual(data1d.candleHigh, data1d.limits.araPrice, 'Daily IHSG candleHigh must equal statutory araPrice');
    assert.strictEqual(data1d.candleLow, data1d.limits.arbPrice, 'Daily IHSG candleLow must equal statutory arbPrice');
    assert.strictEqual(data1m.candleHigh, data1m.adrHigh, 'Intraday 1m IHSG candleHigh must equal adrHigh');
    assert.strictEqual(data1m.candleLow, data1m.adrLow, 'Intraday 1m IHSG candleLow must equal adrLow');
});

test('Volume Capacity Gauge format and Breakout state', () => {
    // 1. Mock bars with high volume on active bar (150% -> Breakout)
    const mockBarsBreakout = [
        ...Array(20).fill(null).map(() => ({ high: 100, low: 95, close: 98, volume: 50000 })),
        { high: 101, low: 97, close: 100, volume: 75000 },
    ];

    const dataBreakout = computeGhostCandleData(mockBarsBreakout, null, 'TEST', 98, false, '5m', 0);
    assert.strictEqual(dataBreakout.hud.volumeUsedPct, 150.0);
    assert.strictEqual(dataBreakout.hud.isVolumeBreakout, true);
    assert.strictEqual(dataBreakout.hud.hudLine4, 'Volume: 150% (75 rb / 50 rb | Breakout)');

    // 2. Mock bars with normal volume under 100% (59% -> Left: 41%)
    const mockBarsNormal = [
        ...Array(20).fill(null).map(() => ({ high: 100, low: 95, close: 98, volume: 1000000 })),
        { high: 101, low: 97, close: 100, volume: 590000 },
    ];
    const dataNormal = computeGhostCandleData(mockBarsNormal, null, 'TEST', 98, false, '5m', 0);
    assert.strictEqual(dataNormal.hud.volumeUsedPct, 59.0);
    assert.strictEqual(dataNormal.hud.isVolumeBreakout, false);
    assert.strictEqual(dataNormal.hud.hudLine4, 'Volume: 59% (590 rb / 1 jt | Left: 41%)');
});


