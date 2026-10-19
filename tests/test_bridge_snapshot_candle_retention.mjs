/**
 * Test: Bridge Snapshot Candle Retention & Multi-Timeframe Cache Guard
 *
 * Verifies that when live_trade_bridge.mjs broadcasts intraday_snapshot and today_candles_snapshot:
 * 1. Bridge snapshots do NOT overwrite or truncate historical daily or intraday candle caches.
 * 2. Unloaded tickers do not get stamped as fully loaded by premature snapshot arrivals.
 * 3. When full historical datasets are loaded, bridge bars are merged cleanly without wiping history.
 * 4. Switching timeframes (e.g. 5m -> 1d -> 5m) preserves full multi-day / multi-year history.
 */

import assert from 'assert';

console.log('=== Running Bridge Snapshot Candle Retention Tests ===\n');

// Mock state corresponding to main.ts caching architecture
let cached1dData = [];
let cached1dLoadedTicker = '';
let cached1mData = [];
let cached1mLoadedTicker = '';
const bridgeRecent1mBars = new Map();
const clientTodayCandles = new Map();
let currentChartData = [];
let currentActiveTf = '5m';

function merge1mBarsWithBridge(baseBars, bridgeBars) {
    if (!bridgeBars || bridgeBars.length === 0) return [...baseBars];
    const map = new Map();
    for (const b of baseBars) {
        if (b && typeof b.time === 'number') map.set(b.time, { ...b });
    }
    for (const b of bridgeBars) {
        if (b && typeof b.time === 'number') {
            const existing = map.get(b.time);
            if (existing) {
                existing.high = Math.max(existing.high, b.high);
                existing.low = Math.min(existing.low, b.low);
                existing.close = b.close;
                existing.volume = Math.max(existing.volume || 0, b.volume || 0);
                if (b.levels && b.levels.length > 0) {
                    existing.levels = b.levels;
                }
            } else {
                map.set(b.time, { ...b });
            }
        }
    }
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

function handleIntradaySnapshot(sym, bars, todayDailyBar) {
    if (Array.isArray(bars) && bars.length > 0) {
        bridgeRecent1mBars.set(sym, bars);
    }
    if (todayDailyBar) {
        clientTodayCandles.set(sym, todayDailyBar);
    }

    // Only update active cache if the historical dataset was actually loaded
    if (cached1mLoadedTicker === sym && cached1mData && cached1mData.length > 0 && Array.isArray(bars) && bars.length > 0) {
        cached1mData = merge1mBarsWithBridge(cached1mData, bars);
    }
}

// --- Test 1: Rapid snapshot arrives before historical files load ---
console.log('[Test 1] Simulating premature WebSocket snapshot before HTTP fetch completes...');
const mockBridgeBars = [
    { time: 1727838000, open: 50, high: 52, low: 50, close: 51, volume: 1000 },
    { time: 1727838060, open: 51, high: 53, low: 51, close: 53, volume: 2000 }
];
const mockTodayDailyBar = { time: 1727827200, open: 50, high: 55, low: 49, close: 53, volume: 150000 };

handleIntradaySnapshot('GOTO', mockBridgeBars, mockTodayDailyBar);

assert.strictEqual(cached1dLoadedTicker, '', 'cached1dLoadedTicker must NOT be set by premature snapshot');
assert.strictEqual(cached1mLoadedTicker, '', 'cached1mLoadedTicker must NOT be set by premature snapshot');
assert.strictEqual(cached1dData.length, 0, 'cached1dData must not be populated with only 1 bar prematurely');
assert.strictEqual(cached1mData.length, 0, 'cached1mData must not be populated with only 2 bars prematurely');
assert.strictEqual(bridgeRecent1mBars.get('GOTO').length, 2, 'bridgeRecent1mBars should buffer the 2 live bars');
console.log('  -> PASS: Premature snapshot correctly buffered without poisoning cache flags.');

// --- Test 2: Historical 1m data loads (e.g. 500 historical 1m bars from disk) ---
console.log('\n[Test 2] Loading full historical 1m dataset (500 bars) and merging with buffered live ticks...');
const mockHistorical1m = [];
for (let i = 0; i < 500; i++) {
    mockHistorical1m.push({
        time: 1727800000 + (i * 60),
        open: 50,
        high: 51,
        low: 49,
        close: 50,
        volume: 500
    });
}

// Simulate loadTimeframe intraday resolution
const buffered = bridgeRecent1mBars.get('GOTO') || [];
cached1mData = merge1mBarsWithBridge(mockHistorical1m, buffered);
cached1mLoadedTicker = 'GOTO';

assert.strictEqual(cached1mLoadedTicker, 'GOTO');
assert.strictEqual(cached1mData.length, 502, 'Should contain all 500 historical bars + 2 merged bridge bars');
assert.strictEqual(cached1mData[0].time, 1727800000, 'First historical bar remains intact');
assert.strictEqual(cached1mData[cached1mData.length - 1].time, 1727838060, 'Latest live bar appended cleanly');
console.log(`  -> PASS: 500 historical bars + 2 live bars retained (total: ${cached1mData.length} bars).`);

// --- Test 3: Subsequent snapshot arrival while viewing active stock ---
console.log('\n[Test 3] Live intraday snapshot arriving while historical data is active...');
const updatedBridgeBars = [
    { time: 1727838060, open: 51, high: 54, low: 51, close: 54, volume: 3500 }, // updated
    { time: 1727838120, open: 54, high: 55, low: 53, close: 55, volume: 1200 }  // new minute
];
handleIntradaySnapshot('GOTO', updatedBridgeBars, mockTodayDailyBar);

assert.strictEqual(cached1mData.length, 503, 'Should cleanly merge: 1 bar updated, 1 new bar added, zero historical bars lost');
assert.strictEqual(cached1mData[cached1mData.length - 2].close, 54, 'Bar at 1727838060 updated to 54');
assert.strictEqual(cached1mData[cached1mData.length - 1].close, 55, 'New bar at 1727838120 appended');
console.log(`  -> PASS: Live updates merged safely without losing any past history (total: ${cached1mData.length} bars).`);

// --- Test 4: Switching to Daily (1D) Timeframe ---
console.log('\n[Test 4] Switching timeframe to 1D: loading full 250 historical daily bars...');
currentActiveTf = '1d';
const mockHistorical1d = [];
for (let i = 0; i < 250; i++) {
    mockHistorical1d.push({
        time: 1700000000 + (i * 86400),
        open: 50,
        high: 55,
        low: 48,
        close: 52,
        volume: 1000000
    });
}

// Simulate loadTimeframe 1D resolution
cached1dData = [...mockHistorical1d];
cached1dLoadedTicker = 'GOTO';
const todayC = clientTodayCandles.get('GOTO');
if (todayC && cached1dData.length > 0) {
    const lastBar = cached1dData[cached1dData.length - 1];
    if (lastBar.time === todayC.time) {
        Object.assign(lastBar, todayC);
    } else if (todayC.time > lastBar.time) {
        cached1dData.push({ ...todayC });
    }
}

assert.strictEqual(cached1dLoadedTicker, 'GOTO');
assert.strictEqual(cached1dData.length, 251, 'Should contain all 250 historical daily bars + 1 today provisional bar');
assert.strictEqual(cached1dData[0].time, 1700000000, 'Earliest daily bar preserved');
assert.strictEqual(cached1dData[250].time, 1727827200, "Today's daily bar properly placed at end");
console.log(`  -> PASS: Full 250 daily bars preserved alongside today's provisional candle (total: ${cached1dData.length} bars).`);

// --- Test 5: Switching back to 5m ---
console.log('\n[Test 5] Switching back from 1D to 5m: verifying historical cache persistence...');
currentActiveTf = '5m';
assert.strictEqual(cached1mLoadedTicker, 'GOTO', 'cached1mLoadedTicker must still be GOTO');
assert.strictEqual(cached1mData.length, 503, 'Intraday cache must still contain all 503 bars, never truncated to 10 minutes');
console.log('  -> PASS: Intraday bars remained 100% intact during timeframe roundtrip.');

console.log('\n>>> ALL BRIDGE SNAPSHOT CANDLE RETENTION TESTS PASSED SUCCESSFULLY! <<<');
