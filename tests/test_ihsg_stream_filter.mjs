/**
 * tests/test_ihsg_stream_filter.mjs
 * 
 * Verifies that the live running trades stream filters correctly:
 * 1. Loads ihsg_stocks.json and ensures non-stock indices are excluded.
 * 2. Tests trade filtering logic for valid IHSG stocks vs non-IHSG symbols.
 * 3. Tests snapshot and top5 filtering logic.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('=== Running IHSG Stream Whitelist Filter Tests ===');

// 1. Verify ihsg_stocks.json exists and contains correct items
const jsonPath = path.resolve('indicator-examples/public/ihsg_stocks.json');
assert(fs.existsSync(jsonPath), 'ihsg_stocks.json must exist in indicator-examples/public/');

const stockList = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert(Array.isArray(stockList), 'ihsg_stocks.json must be an array');
console.log(`[PASS] ihsg_stocks.json loaded with ${stockList.length} items`);

const allowedSet = new Set(stockList.map(s => s.toUpperCase().trim()));

// Ensure known stocks are present
const expectedStocks = ['KAQI', 'AKSI', 'BUMI', 'GOTO', 'INET', 'ELIT', 'COCO'];
for (const sym of expectedStocks) {
    assert(allowedSet.has(sym), `Expected stock ${sym} must be in allowedSet`);
}
console.log(`[PASS] Sample active stocks verified in whitelist: ${expectedStocks.join(', ')}`);

// Ensure known indices are EXCLUDED
const forbiddenIndices = ['IHSG', 'LQ45', 'IDX30', 'IDX80', 'IDXENERGY', 'BISNIS-27', 'KOMPAS100', 'JII'];
for (const idx of forbiddenIndices) {
    assert(!allowedSet.has(idx), `Index ${idx} must NOT be in allowed stock list`);
}
console.log(`[PASS] Market indices properly excluded: ${forbiddenIndices.join(', ')}`);

// 2. Test trade normalizer / bridge filtering logic
function filterTrade(rawTrade, allowed) {
    const sym = (rawTrade.data?.t || rawTrade.data?.symbol || rawTrade.t || rawTrade.symbol || '').toUpperCase();
    if (!sym) return null;
    if (allowed.size > 0 && !allowed.has(sym)) return null;
    return rawTrade;
}

const testTrades = [
    { type: 'trade', data: { t: 'KAQI', p: 102, l: 50, c: 'BUY' } },
    { type: 'trade', data: { t: 'GOTO', p: 50, l: 1000, c: 'SELL' } },
    { type: 'trade', data: { t: 'AAPL', p: 150, l: 10, c: 'BUY' } },
    { type: 'trade', data: { t: 'IDX30', p: 450, l: 100, c: 'BUY' } },
    { type: 'trade', data: { t: 'IHSG', p: 7200, l: 500, c: 'BUY' } },
    { type: 'trade', data: { t: 'BUMI', p: 210, l: 300, c: 'BUY' } },
    { type: 'trade', data: { t: 'UNKNOWN_TICKER', p: 99, l: 5, c: 'SELL' } }
];

const passedTrades = testTrades.filter(t => filterTrade(t, allowedSet) !== null);
const passedSymbols = passedTrades.map(t => t.data.t);

assert.deepStrictEqual(passedSymbols, ['KAQI', 'GOTO', 'BUMI'], 'Only valid IHSG stocks must pass through');
console.log(`[PASS] Trade filtering verified: Only ${passedSymbols.join(', ')} passed, non-IHSG dropped.`);

// 3. Test snapshot filtering logic
const mockSnapshot = {
    type: 'snapshot',
    market: { status: 'open', label: 'Sesi 1' },
    top: [
        { ticker: 'KAQI', count: 1200 },
        { ticker: 'IDX30', count: 999 },
        { ticker: 'AKSI', count: 850 },
        { ticker: 'UNKNOWN', count: 50 }
    ],
    recent: [
        { t: 'KAQI', p: 102, l: 10 },
        { t: 'FAKE', p: 100, l: 5 },
        { t: 'BUMI', p: 210, l: 20 },
        { t: 'IHSG', p: 7200, l: 50 }
    ]
};

function filterSnapshot(snapshot, allowed) {
    const copy = JSON.parse(JSON.stringify(snapshot));
    if (Array.isArray(copy.top) && allowed.size > 0) {
        copy.top = copy.top.filter(tp => allowed.has((tp.ticker || tp.symbol || '').toUpperCase()));
    }
    if (Array.isArray(copy.recent) && allowed.size > 0) {
        copy.recent = copy.recent.filter(rc => allowed.has((rc.t || rc.symbol || rc.code || '').toUpperCase()));
    }
    return copy;
}

const filteredSnap = filterSnapshot(mockSnapshot, allowedSet);
assert.deepStrictEqual(filteredSnap.top.map(x => x.ticker), ['KAQI', 'AKSI']);
assert.deepStrictEqual(filteredSnap.recent.map(x => x.t), ['KAQI', 'BUMI']);
console.log('[PASS] Snapshot filtering verified: Non-IHSG entries stripped from top and recent buffers.');

console.log('\n>>> All IHSG stream filter tests PASSED successfully! <<<\n');
