/**
 * tests/test_live_date_isolation.mjs
 * 
 * Verifies live running trade date isolation:
 * 1. Live trades on 11 September 2026 do NOT mutate or merge into 10 September 2026 bars.
 * 2. New daily candle for 11 September is created and appended with strict ascending timestamp.
 * 3. Friday Session 2 (14:00 WIB) and Session 1 (09:00 WIB) timestamps are accurately resolved.
 * 4. merge1mFootprintIntoDaily synthesizes today's daily bar from 1m data while leaving yesterday pristine.
 */

import assert from 'assert';

console.log('=== Running Live Running Trade Date Isolation Tests ===\n');

// 1. Replicate getWibComponents logic from main.ts
function getWibComponents(timeSecInput, timeStrInput, simulatedNowUtcMs) {
    const nowUtcMs = simulatedNowUtcMs !== undefined ? simulatedNowUtcMs : Date.now();
    const wibNowMs = nowUtcMs + (7 * 3600 * 1000);
    const wibNowDate = new Date(wibNowMs);

    let y = wibNowDate.getUTCFullYear();
    let m = wibNowDate.getUTCMonth();
    let d = wibNowDate.getUTCDate();
    let dayOfWeek = wibNowDate.getUTCDay();

    let hour = wibNowDate.getUTCHours();
    let minute = wibNowDate.getUTCMinutes();
    let second = wibNowDate.getUTCSeconds();

    if (timeStrInput && typeof timeStrInput === 'string' && timeStrInput.includes(':')) {
        const parts = timeStrInput.split(':');
        if (parts.length >= 2) {
            const hParsed = parseInt(parts[0], 10);
            const mParsed = parseInt(parts[1], 10);
            const sParsed = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
            if (!isNaN(hParsed) && !isNaN(mParsed)) {
                hour = hParsed;
                minute = mParsed;
                second = isNaN(sParsed) ? 0 : sParsed;
            }
        }
    } else if (timeSecInput && timeSecInput > 0) {
        const dObj = new Date((timeSecInput > 1e11 ? Math.floor(timeSecInput / 1000) : timeSecInput) * 1000);
        y = dObj.getUTCFullYear();
        m = dObj.getUTCMonth();
        d = dObj.getUTCDate();
        dayOfWeek = dObj.getUTCDay();
        hour = dObj.getUTCHours();
        minute = dObj.getUTCMinutes();
        second = dObj.getUTCSeconds();
    }

    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

    const wibTsSec = Math.floor(Date.UTC(y, m, d, hour, minute, second) / 1000);
    const dailyTs = Math.floor(Date.UTC(y, m, d, 0, 0, 0) / 1000);

    const isFriday = (dayOfWeek === 5);
    const isSesi1 = isFriday ? (hour < 12) : (hour < 12 || (hour === 12 && minute <= 30));
    const sessionNum = isSesi1 ? 1 : 2;
    const sessionTs = sessionNum === 1
        ? Math.floor(Date.UTC(y, m, d, 9, 0, 0) / 1000)
        : (isFriday 
            ? Math.floor(Date.UTC(y, m, d, 14, 0, 0) / 1000)
            : Math.floor(Date.UTC(y, m, d, 13, 30, 0) / 1000));

    return {
        y, m, d,
        dayOfWeek,
        isFriday,
        hour, minute, second,
        dateStr,
        timeStr,
        wibTsSec,
        dailyTs,
        isSesi1,
        sessionNum,
        sessionTs,
    };
}

// ----------------------------------------------------
// Test Case 1: Friday 11 September 2026 Session 2 Parsing
// ----------------------------------------------------
console.log('[Test 1] Testing getWibComponents on Friday 11 September 2026 Session 2...');
// Simulate Friday 11 September 2026, 14:15:30 WIB (UTC: 07:15:30)
const simulatedSept11UtcMs = Date.UTC(2026, 8, 11, 7, 15, 30);
const wibRes = getWibComponents(undefined, '14:15:30', simulatedSept11UtcMs);

assert.strictEqual(wibRes.dateStr, '2026-09-11', 'Date must be 2026-09-11');
assert.strictEqual(wibRes.dayOfWeek, 5, 'Day of week must be 5 (Friday)');
assert.strictEqual(wibRes.isFriday, true, 'isFriday must be true');
assert.strictEqual(wibRes.isSesi1, false, '14:15:30 must be Session 2');
assert.strictEqual(wibRes.sessionNum, 2, 'Session number must be 2');

const expectedDaily11 = Math.floor(Date.UTC(2026, 8, 11, 0, 0, 0) / 1000);
const expectedSession2Fri = Math.floor(Date.UTC(2026, 8, 11, 14, 0, 0) / 1000);
const expectedWibTs11 = Math.floor(Date.UTC(2026, 8, 11, 14, 15, 30) / 1000);

assert.strictEqual(wibRes.dailyTs, expectedDaily11, 'dailyTs must match Fake UTC midnight of 2026-09-11');
assert.strictEqual(wibRes.sessionTs, expectedSession2Fri, 'Friday session 2 must be 14:00:00 WIB');
assert.strictEqual(wibRes.wibTsSec, expectedWibTs11, 'wibTsSec must match 14:15:30 WIB');
console.log('  -> PASS: Friday 11 September Session 2 correctly resolved to 14:00 WIB\n');

// ----------------------------------------------------
// Test Case 2: Thursday 10 September 2026 Session 2 Parsing
// ----------------------------------------------------
console.log('[Test 2] Testing getWibComponents on Thursday 10 September 2026 Session 2...');
const simulatedSept10UtcMs = Date.UTC(2026, 8, 10, 7, 0, 0);
const wibResThu = getWibComponents(undefined, '14:00:00', simulatedSept10UtcMs);

assert.strictEqual(wibResThu.dateStr, '2026-09-10');
assert.strictEqual(wibResThu.isFriday, false);
assert.strictEqual(wibResThu.sessionNum, 2);
const expectedSession2Thu = Math.floor(Date.UTC(2026, 8, 10, 13, 30, 0) / 1000);
assert.strictEqual(wibResThu.sessionTs, expectedSession2Thu, 'Thursday session 2 must be 13:30:00 WIB');
console.log('  -> PASS: Thursday 10 September Session 2 correctly resolved to 13:30 WIB\n');

// ----------------------------------------------------
// Test Case 3: Ingesting Live 11 September Tick into 10 September Daily Cache
// ----------------------------------------------------
console.log('[Test 3] Testing Daily Cache Ingestion: 11 September tick arriving with 10 September history...');

const sept10DailyTs = Math.floor(Date.UTC(2026, 8, 10, 0, 0, 0) / 1000);
const sept11DailyTs = Math.floor(Date.UTC(2026, 8, 11, 0, 0, 0) / 1000);

const cached1dData = [
    {
        time: Math.floor(Date.UTC(2026, 8, 9, 0, 0, 0) / 1000),
        open: 100, high: 105, low: 98, close: 102, volume: 5000
    },
    {
        time: sept10DailyTs,
        open: 102, high: 110, low: 101, close: 108, volume: 8000,
        levels: [{ price: 108, bidVolume: 3000, askVolume: 5000 }]
    }
];

// Clone 10 September bar before ingestion for strict integrity check
const originalSept10Bar = JSON.parse(JSON.stringify(cached1dData[1]));

// Simulated tick arriving on 11 September Session 2
const tick = {
    time: Math.floor(Date.UTC(2026, 8, 11, 14, 20, 0) / 1000),
    timeStr: '14:20:00',
    dailyTs: sept11DailyTs,
    price: 115,
    lot: 250,
    action: 'BUY'
};

// Simulate ingestion logic from main.ts
function ingestDailyTick(dataArray, liveTick) {
    const todayDailyTs = liveTick.dailyTs;
    const price = liveTick.price;
    const lot = liveTick.lot;
    const isBuy = liveTick.action === 'BUY';

    const lastDaily = dataArray[dataArray.length - 1];
    if (lastDaily.time === todayDailyTs) {
        lastDaily.high = Math.max(lastDaily.high, price);
        lastDaily.low = Math.min(lastDaily.low, price);
        lastDaily.close = price;
        lastDaily.volume += lot;
    } else if (todayDailyTs > lastDaily.time) {
        // Append new daily bar for today (11 September)
        const prevClose = lastDaily.close || price;
        const newDaily = {
            time: todayDailyTs,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: lot,
            value: price * lot * 100,
            frequency: 1,
            average: price,
            change: Number((price - prevClose).toFixed(2)),
            change_percentage: prevClose > 0 ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0,
            levels: [{
                price,
                bidVolume: isBuy ? 0 : lot,
                askVolume: isBuy ? lot : 0
            }]
        };
        dataArray.push(newDaily);
    }
}

ingestDailyTick(cached1dData, tick);

// Assertions
assert.strictEqual(cached1dData.length, 3, 'cached1dData must now contain 3 bars');
assert.deepStrictEqual(cached1dData[1], originalSept10Bar, '10 September bar must NOT be mutated or ruined!');
assert.strictEqual(cached1dData[2].time, sept11DailyTs, 'Bar index 2 must be for 11 September');
assert.strictEqual(cached1dData[2].open, 115);
assert.strictEqual(cached1dData[2].close, 115);
assert.strictEqual(cached1dData[2].volume, 250);
assert.strictEqual(cached1dData[2].change, 7, 'Change from Sept 10 close (108) to Sept 11 close (115) must be 7');

// Ingest another tick for Sept 11 to verify updating the new 11 Sept candle
const tick2 = {
    dailyTs: sept11DailyTs,
    price: 118,
    lot: 500,
    action: 'BUY'
};
ingestDailyTick(cached1dData, tick2);

assert.strictEqual(cached1dData.length, 3, 'Length must remain 3');
assert.strictEqual(cached1dData[2].close, 118);
assert.strictEqual(cached1dData[2].high, 118);
assert.strictEqual(cached1dData[2].volume, 750);
assert.deepStrictEqual(cached1dData[1], originalSept10Bar, '10 September bar must STILL be completely untouched!');
console.log('  -> PASS: 10 September bar remains 100% pristine; 11 September candle cleanly created and updated.\n');

// ----------------------------------------------------
// Test Case 4: merge1mFootprintIntoDaily Synthesizing 11 September Bar
// ----------------------------------------------------
console.log('[Test 4] Testing merge1mFootprintIntoDaily with 11 September intraday 1m bars...');

function merge1mFootprintIntoDaily(dailyBars, bars1m) {
    if (!dailyBars || dailyBars.length === 0 || !bars1m || bars1m.length === 0) return dailyBars;

    const hasAnyLevels = bars1m.some(b => b.levels && b.levels.length > 0);
    if (!hasAnyLevels) return dailyBars;

    const dayLevels = new Map();
    for (let i = 0; i < bars1m.length; i++) {
        const b = bars1m[i];
        if (!b.levels || b.levels.length === 0) continue;

        const d = new Date(b.time * 1000);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        let map = dayLevels.get(dateKey);
        if (!map) {
            map = new Map();
            dayLevels.set(dateKey, map);
        }

        for (let j = 0; j < b.levels.length; j++) {
            const lvl = b.levels[j];
            const existing = map.get(lvl.price);
            if (existing) {
                existing.bidVolume += (lvl.bidVolume || 0);
                existing.askVolume += (lvl.askVolume || 0);
            } else {
                map.set(lvl.price, {
                    bidVolume: lvl.bidVolume || 0,
                    askVolume: lvl.askVolume || 0,
                });
            }
        }
    }

    if (dayLevels.size === 0) return dailyBars;

    const dailyDateKeys = new Set();
    const updatedBars = dailyBars.map(bar => {
        const d = new Date(bar.time * 1000);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dailyDateKeys.add(dateKey);

        const map = dayLevels.get(dateKey);
        if (map && map.size > 0) {
            const sortedPrices = Array.from(map.keys()).sort((a, b) => a - b);
            const levels = sortedPrices.map(p => {
                const l = map.get(p);
                return {
                    price: p,
                    bidVolume: l.bidVolume,
                    askVolume: l.askVolume,
                };
            });
            return { ...bar, levels };
        }
        return bar;
    });

    for (const [dateKey, map] of dayLevels.entries()) {
        if (!dailyDateKeys.has(dateKey)) {
            const [yStr, mStr, dStr] = dateKey.split('-');
            const y = parseInt(yStr, 10);
            const m = parseInt(mStr, 10) - 1;
            const day = parseInt(dStr, 10);
            const targetDailyTs = Math.floor(Date.UTC(y, m, day, 0, 0, 0) / 1000);

            const dayBars = bars1m.filter(b => {
                const bd = new Date(b.time * 1000);
                return bd.getUTCFullYear() === y && bd.getUTCMonth() === m && bd.getUTCDate() === day;
            });

            if (dayBars.length > 0) {
                let open = dayBars[0].open;
                let high = dayBars[0].high;
                let low = dayBars[0].low;
                let close = dayBars[dayBars.length - 1].close;
                let volume = 0;
                for (let k = 0; k < dayBars.length; k++) {
                    if (dayBars[k].high > high) high = dayBars[k].high;
                    if (dayBars[k].low < low) low = dayBars[k].low;
                    volume += (dayBars[k].volume || 0);
                }

                const sortedPrices = Array.from(map.keys()).sort((a, b) => a - b);
                const levels = sortedPrices.map(p => {
                    const l = map.get(p);
                    return {
                        price: p,
                        bidVolume: l.bidVolume,
                        askVolume: l.askVolume,
                    };
                });

                const prevBar = updatedBars.length > 0 ? updatedBars[updatedBars.length - 1] : null;
                const prevClose = prevBar ? prevBar.close : open;
                const chg = Number((close - prevClose).toFixed(2));
                const chgPct = prevClose > 0 ? Number(((close - prevClose) / prevClose * 100).toFixed(2)) : 0;

                updatedBars.push({
                    time: targetDailyTs,
                    open,
                    high,
                    low,
                    close,
                    volume,
                    value: close * volume * 100,
                    frequency: dayBars.length,
                    change: chg,
                    change_percentage: chgPct,
                    levels,
                });
            }
        }
    }

    updatedBars.sort((a, b) => a.time - b.time);
    return updatedBars;
}

// Daily bars only have 10 September
const dailyBarsOriginal = [
    {
        time: sept10DailyTs,
        open: 100, high: 105, low: 100, close: 105, volume: 1000
    }
];

// Intraday 1m bars have 11 September Session 2 trades
const bars1m = [
    {
        time: Math.floor(Date.UTC(2026, 8, 11, 14, 0, 0) / 1000),
        open: 105, high: 108, low: 105, close: 107, volume: 200,
        levels: [{ price: 107, bidVolume: 50, askVolume: 150 }]
    },
    {
        time: Math.floor(Date.UTC(2026, 8, 11, 14, 1, 0) / 1000),
        open: 107, high: 110, low: 107, close: 110, volume: 300,
        levels: [{ price: 110, bidVolume: 100, askVolume: 200 }]
    }
];

const merged = merge1mFootprintIntoDaily(dailyBarsOriginal, bars1m);
assert.strictEqual(merged.length, 2, 'Merged output must have 2 bars');
assert.strictEqual(merged[0].time, sept10DailyTs, 'First bar must be 10 September');
assert.strictEqual(merged[0].close, 105, '10 September close must be unchanged');
assert.strictEqual(merged[1].time, sept11DailyTs, 'Second bar must be 11 September');
assert.strictEqual(merged[1].open, 105);
assert.strictEqual(merged[1].high, 110);
assert.strictEqual(merged[1].low, 105);
assert.strictEqual(merged[1].close, 110);
assert.strictEqual(merged[1].volume, 500);
assert.strictEqual(merged[1].levels.length, 2);
console.log('  -> PASS: merge1mFootprintIntoDaily creates 11 September bar without touching 10 September.\n');

console.log('>>> ALL LIVE RUNNING TRADE DATE ISOLATION TESTS PASSED SUCCESSFULLY! <<<\n');
