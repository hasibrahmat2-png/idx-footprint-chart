/**
 * tests/test_adaptive_polling_schedule.mjs
 * 
 * Verifies dynamic adaptive interval for price checking API based on IDX market hours:
 * - Jam 1 (09:00 - 09:55 WIB): 5 menit (300.000 ms)
 * - Jam 2 (10:00 - 10:45 WIB): 15 menit (900.000 ms)
 * - Jam-jam selanjutnya: 30 menit (1.800.000 ms)
 * - Istirahat sesi (12:00 - 13:30 / Jumat 11:30 - 14:00) & di luar bursa / akhir pekan: null (Pause)
 */

import assert from 'assert';

console.log('=== Running Adaptive Polling Schedule Unit Tests ===\n');

function evaluateAdaptiveInterval(wibDate) {
    const day = wibDate.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    if (day === 0 || day === 6) return null; // Weekend closed

    const hours = wibDate.getHours();
    const minutes = wibDate.getMinutes();
    const minutesOfDay = hours * 60 + minutes;

    // Jam 1: 09:00 - 09:55 WIB -> 5 menit (300,000 ms)
    if (minutesOfDay >= 540 && minutesOfDay < 600) {
        return 5 * 60 * 1000;
    }

    // Jam 2: 10:00 - 10:45 WIB -> 15 menit (900,000 ms)
    if (minutesOfDay >= 600 && minutesOfDay < 645) {
        return 15 * 60 * 1000;
    }

    // Jam-jam selanjutnya:
    // Sesi 1 lanjut (10:45 - 12:00, Jumat 11:30): setiap 30 menit (1,800,000 ms)
    const isFriday = day === 5;
    const s1End = isFriday ? (11 * 60 + 35) : (12 * 60 + 5);
    if (minutesOfDay >= 645 && minutesOfDay <= s1End) {
        return 30 * 60 * 1000;
    }

    // Sesi 2 (13:25 - 16:15): setiap 30 menit (1,800,000 ms)
    const s2Start = isFriday ? (13 * 60 + 55) : (13 * 60 + 25);
    const s2End = 16 * 60 + 15;
    if (minutesOfDay >= s2Start && minutesOfDay <= s2End) {
        return 30 * 60 * 1000;
    }

    // Di luar jam sesi: Pause
    return null;
}

function createWibDate(dayOfWeek, hours, minutes) {
    // 2026-09-28 is Monday (day 1)
    // 2026-09-29 is Tuesday (day 2)
    // 2026-10-02 is Friday (day 5)
    // 2026-10-03 is Saturday (day 6)
    // 2026-10-04 is Sunday (day 0)
    let baseDay = 28;
    if (dayOfWeek === 5) baseDay = 2; // Oct 2
    else if (dayOfWeek === 6) baseDay = 3; // Oct 3
    else if (dayOfWeek === 0) baseDay = 4; // Oct 4
    const month = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) ? 9 : 8; // 0-indexed: 8=Sep, 9=Oct
    const d = new Date(2026, month, baseDay, hours, minutes, 0, 0);
    return d;
}

// 1. Pre-market Monday 08:45 WIB -> null (paused)
const preMarket = createWibDate(1, 8, 45);
assert.strictEqual(evaluateAdaptiveInterval(preMarket), null, 'Pre-market should pause');
console.log('[PASS] 08:45 WIB -> Paused (null)');

// 2. Jam 1: Monday 09:05 WIB -> 5 minutes (300,000 ms)
const jam1Start = createWibDate(1, 9, 5);
assert.strictEqual(evaluateAdaptiveInterval(jam1Start), 300000, 'Jam 1 start should be 5 mins');
console.log('[PASS] 09:05 WIB -> 5 minutes (300,000 ms)');

// 3. Jam 1: Monday 09:54 WIB -> 5 minutes (300,000 ms)
const jam1End = createWibDate(1, 9, 54);
assert.strictEqual(evaluateAdaptiveInterval(jam1End), 300000, 'Jam 1 end should be 5 mins');
console.log('[PASS] 09:54 WIB -> 5 minutes (300,000 ms)');

// 4. Jam 2: Monday 10:05 WIB -> 15 minutes (900,000 ms)
const jam2Start = createWibDate(1, 10, 5);
assert.strictEqual(evaluateAdaptiveInterval(jam2Start), 900000, 'Jam 2 start should be 15 mins');
console.log('[PASS] 10:05 WIB -> 15 minutes (900,000 ms)');

// 5. Jam 2: Monday 10:44 WIB -> 15 minutes (900,000 ms)
const jam2End = createWibDate(1, 10, 44);
assert.strictEqual(evaluateAdaptiveInterval(jam2End), 900000, 'Jam 2 end should be 15 mins');
console.log('[PASS] 10:44 WIB -> 15 minutes (900,000 ms)');

// 6. Jam-jam selanjutnya: Monday 11:00 WIB -> 30 minutes (1,800,000 ms)
const jam3Later = createWibDate(1, 11, 0);
assert.strictEqual(evaluateAdaptiveInterval(jam3Later), 1800000, 'Jam 11:00 WIB should be 30 mins');
console.log('[PASS] 11:00 WIB -> 30 minutes (1,800,000 ms)');

// 7. Lunch break: Monday 12:30 WIB -> null (paused)
const lunchBreak = createWibDate(1, 12, 30);
assert.strictEqual(evaluateAdaptiveInterval(lunchBreak), null, 'Lunch break should pause');
console.log('[PASS] 12:30 WIB -> Paused during break (null)');

// 8. Session 2: Monday 14:00 WIB -> 30 minutes (1,800,000 ms)
const session2 = createWibDate(1, 14, 0);
assert.strictEqual(evaluateAdaptiveInterval(session2), 1800000, 'Session 2 should be 30 mins');
console.log('[PASS] 14:00 WIB -> 30 minutes (1,800,000 ms)');

// 9. Market Close: Monday 16:30 WIB -> null (paused)
const marketClosed = createWibDate(1, 16, 30);
assert.strictEqual(evaluateAdaptiveInterval(marketClosed), null, 'After market close should pause');
console.log('[PASS] 16:30 WIB -> Paused after market close (null)');

// 10. Friday early break: Friday 11:45 WIB -> null (paused for Friday prayers)
const friBreak = createWibDate(5, 11, 45);
assert.strictEqual(evaluateAdaptiveInterval(friBreak), null, 'Friday prayer break should pause');
console.log('[PASS] Friday 11:45 WIB -> Paused for Friday break (null)');

// 11. Weekend: Sunday 10:00 WIB -> null (paused)
const weekend = createWibDate(0, 10, 0);
assert.strictEqual(evaluateAdaptiveInterval(weekend), null, 'Weekend should pause');
console.log('[PASS] Sunday -> Paused (null)');

console.log('\nAll Adaptive Polling Schedule tests passed successfully!');
