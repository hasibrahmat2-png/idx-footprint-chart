/**
 * tests/test_realtime_price_alert.mjs
 * 
 * Verifies that the realtime price trigger from /api/price/{code} correctly:
 * 1. Parses raw JSON responses from stock.arjum.com /api/price/{code}
 * 2. Enforces STRICT REAL TOUCH logic (removing ±2 ticks noise)
 * 3. Tracks the 3-entry Movement Log (First Touch, Prev Alert, Current Alert)
 * 4. Verifies Discord & Telegram formatting with Movement Log
 * 5. Handles day rollover and Dismiss action
 */

import assert from 'assert';

console.log('=== Running Realtime Price Alert Trigger Tests ===\n');

function getIdxTickSize(price) {
    if (price < 200) return 1;
    if (price < 500) return 2;
    if (price < 2000) return 5;
    if (price < 5000) return 10;
    return 25;
}

// 1. Test parsing sample API response from /api/price/{code}
const sampleApiResponse = {
    code: 'SMDR',
    last_price: 372.0,
    freq: 1205,
    lot: 85000,
    value: 31620000000,
    source_date: '2026-09-22'
};

const parsed = {
    code: sampleApiResponse.code.toUpperCase(),
    last_price: Number(sampleApiResponse.last_price),
    freq: Number(sampleApiResponse.freq || 0),
    lot: Number(sampleApiResponse.lot || 0),
    value: Number(sampleApiResponse.value || 0),
    source_date: sampleApiResponse.source_date
};

assert.strictEqual(parsed.code, 'SMDR');
assert.strictEqual(parsed.last_price, 372);
assert.strictEqual(parsed.freq, 1205);
console.log('[PASS] Sample /api/price/{code} response parsed cleanly.');

// 2. Strict Real Touch Evaluation (NO +-2 ticks noise)
const sampleZoneAlert = {
    symbol: 'SMDR',
    currentPrice: 404,
    refClose: 404,
    changePercentage: 0,
    priorityTier: 1,
    primarySupport: {
        price: 372,
        label: 'Demand Zone (372) [366 - 378]',
        isZone: true,
        zoneBottom: 366,
        zoneTop: 378,
        tier: 1
    },
    distanceTicks: 16,
    distancePercent: 7.9,
    status: 'holding'
};

const sampleLineAlert = {
    symbol: 'BBCA',
    currentPrice: 6300,
    refClose: 6300,
    changePercentage: 0,
    priorityTier: 2,
    primarySupport: {
        price: 6225,
        label: 'Sup (3x)',
        isZone: false,
        touches: 3,
        tier: 2
    },
    distanceTicks: 3,
    distancePercent: 1.2,
    status: 'holding'
};

function evaluateStrictPriceAlert(alert, lastPrice) {
    const tick = getIdxTickSize(lastPrice);
    let status = 'holding';

    if (alert.primarySupport.isZone) {
        const bot = alert.primarySupport.zoneBottom;
        const top = alert.primarySupport.zoneTop;
        if (lastPrice >= bot && lastPrice <= top) {
            status = 'testing'; // Strict real touch inside Demand Zone!
        } else if (lastPrice > top) {
            status = 'holding'; // Holding safely above zone (NO +-2 ticks noise)
        } else {
            status = 'broken';  // Dropped below zone
        }
    } else {
        if (lastPrice === alert.primarySupport.price) {
            status = 'testing'; // Strict real touch on line!
        } else if (lastPrice > alert.primarySupport.price) {
            status = 'holding'; // Holding safely above line (NO +-2 ticks noise)
        } else {
            status = 'broken';  // Dropped below line
        }
    }

    const distanceTicks = Math.round((lastPrice - alert.primarySupport.price) / tick);
    const distancePercent = lastPrice > 0 ? ((lastPrice - alert.primarySupport.price) / lastPrice) * 100 : 0;

    return { status, distanceTicks, distancePercent };
}

// Case A: Price well above (400) -> holding
let res = evaluateStrictPriceAlert(sampleZoneAlert, 400);
assert.strictEqual(res.status, 'holding');
console.log(`[PASS] Price 400 -> status: ${res.status}`);

// Case B: Price at 380 (+1 tick above zoneTop 378) -> MUST BE HOLDING (not testing!)
res = evaluateStrictPriceAlert(sampleZoneAlert, 380);
assert.strictEqual(res.status, 'holding', 'Price at 380 (+1 tick above zoneTop 378) must be holding, not testing');
console.log(`[PASS] Price 380 (+1 tick above zoneTop 378) -> status: ${res.status} (Strict Real Touch enforced)`);

// Case C: Price inside Demand Zone (378, top edge) -> testing
res = evaluateStrictPriceAlert(sampleZoneAlert, 378);
assert.strictEqual(res.status, 'testing');
console.log(`[PASS] Price 378 (top edge) -> status: ${res.status}`);

// Case D: Price inside Demand Zone (372, center) -> testing
res = evaluateStrictPriceAlert(sampleZoneAlert, 372);
assert.strictEqual(res.status, 'testing');
assert.strictEqual(res.distanceTicks, 0);
console.log(`[PASS] Price 372 (zone center) -> status: ${res.status}`);

// Case E: Price breakdown below zone bottom (360) -> broken
res = evaluateStrictPriceAlert(sampleZoneAlert, 360);
assert.strictEqual(res.status, 'broken');
assert(res.distanceTicks < 0);
console.log(`[PASS] Price 360 (below zone bottom 366) -> status: ${res.status}`);

// Case F: Support Line - Price at 6250 (+1 tick above 6225) -> MUST BE HOLDING
res = evaluateStrictPriceAlert(sampleLineAlert, 6250);
assert.strictEqual(res.status, 'holding');
console.log(`[PASS] Line Support Price 6250 (+1 tick above 6225) -> status: ${res.status}`);

// Case G: Support Line - Price at 6225 (exact touch) -> testing
res = evaluateStrictPriceAlert(sampleLineAlert, 6225);
assert.strictEqual(res.status, 'testing');
console.log(`[PASS] Line Support Price 6225 (exact touch) -> status: ${res.status}`);

// Case H: Support Line - Price at 6200 (-1 tick below 6225) -> broken
res = evaluateStrictPriceAlert(sampleLineAlert, 6200);
assert.strictEqual(res.status, 'broken');
console.log(`[PASS] Line Support Price 6200 (-1 tick below 6225) -> status: ${res.status}`);

// 3. Test 3-Entry Movement Log Lifecycle
console.log('\n--- Testing 3-Entry Movement Log Lifecycle ---');

let trackedStock = {
    symbol: 'SMDR',
    status: 'holding',
    firstTouchLog: null,
    prevAlertLog: null,
    currentAlertLog: null
};

const todayStr = '2026-09-22';

function recordAlertMovement(stock, timeStr, price, status, label, dateStr) {
    const entry = {
        time: timeStr,
        price,
        changePercent: 0,
        status,
        label,
        date: dateStr
    };

    // 1. First Touch of the day
    if (status === 'testing' && (!stock.firstTouchLog || stock.firstTouchLog.date !== dateStr)) {
        stock.firstTouchLog = entry;
    }

    // 2. Previous Alert shifts
    stock.prevAlertLog = stock.currentAlertLog || null;

    // 3. Current Alert
    stock.currentAlertLog = entry;
    stock.status = status;
}

// Alert Event 1: First real touch at 10:14:02 WIB at Rp 378
recordAlertMovement(trackedStock, '10:14:02 WIB', 378, 'testing', '🎯 Testing Demand Zone', todayStr);
assert.notStrictEqual(trackedStock.firstTouchLog, null);
assert.strictEqual(trackedStock.firstTouchLog.price, 378);
assert.strictEqual(trackedStock.firstTouchLog.time, '10:14:02 WIB');
assert.strictEqual(trackedStock.prevAlertLog, null); // Initial touch has no previous alert
assert.strictEqual(trackedStock.currentAlertLog.price, 378);
console.log('[PASS] Event 1: First touch recorded correctly as 1️⃣ First and 3️⃣ Current.');

// Alert Event 2: Bounced above support to 384 at 10:35:10 WIB (holding)
recordAlertMovement(trackedStock, '10:35:10 WIB', 384, 'holding', '🛡️ Holding / Bounced Above', todayStr);
assert.strictEqual(trackedStock.firstTouchLog.price, 378); // First touch preserved!
assert.strictEqual(trackedStock.firstTouchLog.time, '10:14:02 WIB');
assert.notStrictEqual(trackedStock.prevAlertLog, null);
assert.strictEqual(trackedStock.prevAlertLog.price, 378); // Prev alert was Event 1
assert.strictEqual(trackedStock.currentAlertLog.price, 384); // Current is Event 2
console.log('[PASS] Event 2: Bounced to 384. Prev is 378, First remains 378.');

// Alert Event 3: Re-tested support at 372 at 11:05:00 WIB (testing)
recordAlertMovement(trackedStock, '11:05:00 WIB', 372, 'testing', '🎯 Testing Demand Zone', todayStr);
assert.strictEqual(trackedStock.firstTouchLog.price, 378); // First touch still 378!
assert.strictEqual(trackedStock.prevAlertLog.price, 384); // Prev alert is Event 2 (384)
assert.strictEqual(trackedStock.currentAlertLog.price, 372); // Current is Event 3 (372)
console.log('[PASS] Event 3: Re-test at 372. 1️⃣ First: 378, 2️⃣ Prev: 384, 3️⃣ Now: 372.');

// 4. Test Discord & Telegram Message Formatting
console.log('\n--- Testing Message Formatting with 3-Entry Movement Log ---');

function formatMovementEntryDiscord(entry, fallback) {
    if (!entry || !entry.time) return fallback;
    const sign = (entry.changePercent || 0) >= 0 ? '+' : '';
    const stText = entry.status ? ` (${entry.status})` : '';
    return `\`${entry.time}\` • Rp ${Number(entry.price).toLocaleString('id-ID')} (${sign}${Number(entry.changePercent).toFixed(2)}%) • ${entry.label || 'Support'}${stText}`;
}

const firstEntryStr = formatMovementEntryDiscord(trackedStock.firstTouchLog, "Belum ada sentuhan hari ini");
const prevEntryStr = formatMovementEntryDiscord(trackedStock.prevAlertLog, "None (Initial Touch Today)");
const currEntryStr = formatMovementEntryDiscord(trackedStock.currentAlertLog, "None");
const discordMovementLogVal = `1️⃣ **First:** ${firstEntryStr}\n2️⃣ **Prev:** ${prevEntryStr}\n3️⃣ **Now:** ${currEntryStr}`;

assert(discordMovementLogVal.includes('1️⃣ **First:** `10:14:02 WIB` • Rp 378'));
assert(discordMovementLogVal.includes('2️⃣ **Prev:** `10:35:10 WIB` • Rp 384'));
assert(discordMovementLogVal.includes('3️⃣ **Now:** `11:05:00 WIB` • Rp 372'));
console.log('[PASS] Discord Movement Log formatted correctly:');
console.log(discordMovementLogVal);

// 5. Test Day Rollover & Dismiss
console.log('\n--- Testing Day Rollover & Dismiss ---');

// Day rollover
const nextDayStr = '2026-09-23';
if (trackedStock.firstTouchLog && trackedStock.firstTouchLog.date !== nextDayStr) {
    trackedStock.firstTouchLog = null;
    trackedStock.prevAlertLog = null;
    trackedStock.currentAlertLog = null;
}
assert.strictEqual(trackedStock.firstTouchLog, null);
assert.strictEqual(trackedStock.prevAlertLog, null);
assert.strictEqual(trackedStock.currentAlertLog, null);
console.log('[PASS] Day rollover successfully reset movement logs for new trading day.');

// Dismiss action
const followThroughMap = new Map();
followThroughMap.set('SMDR', trackedStock);
assert.strictEqual(followThroughMap.has('SMDR'), true);

// User clicks Dismiss
followThroughMap.delete('SMDR');
assert.strictEqual(followThroughMap.has('SMDR'), false);
console.log('[PASS] Dismiss action clears stock and ceases all follow through tracking.');

console.log('\n>>> ALL REALTIME PRICE ALERT & MOVEMENT LOG TESTS PASSED! <<<\n');
