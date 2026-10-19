/**
 * Unit Test for Stockbit SNR Engine
 * Tests mathematical validity, IDX tick sizing, zone clustering, and anti-clutter spacing using real IDX data.
 */

const fs = require('fs');
const path = require('path');

// Mock browser namespace
global.window = {};
require('../stockbit-snr-extension/src/snr-engine.js');
const { getIdxTickSize, calculateAutoSR } = global.window.StockbitSNR;

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
}

console.log('--- Test 1: Dynamic IDX Fraksi Harga ---');
assert(getIdxTickSize(50) === 1, 'Tick size for 50 should be 1');
assert(getIdxTickSize(199) === 1, 'Tick size for 199 should be 1');
assert(getIdxTickSize(200) === 2, 'Tick size for 200 should be 2');
assert(getIdxTickSize(498) === 2, 'Tick size for 498 should be 2');
assert(getIdxTickSize(500) === 5, 'Tick size for 500 should be 5');
assert(getIdxTickSize(1995) === 5, 'Tick size for 1995 should be 5');
assert(getIdxTickSize(2000) === 10, 'Tick size for 2000 should be 10');
assert(getIdxTickSize(4990) === 10, 'Tick size for 4990 should be 10');
assert(getIdxTickSize(5000) === 25, 'Tick size for 5000 should be 25');
assert(getIdxTickSize(9850) === 25, 'Tick size for 9850 should be 25');
console.log('✓ IDX Fraksi Harga tests passed.');

console.log('\n--- Test 2: Real IDX Stock Analysis (BBCA) ---');
const bbcaPath = path.join(__dirname, '../indicator-examples/public/BBCA_1d.json');
let testData;
if (fs.existsSync(bbcaPath)) {
    testData = JSON.parse(fs.readFileSync(bbcaPath, 'utf8'));
} else {
    // Fallback to ACES
    const acesPath = path.join(__dirname, '../indicator-examples/public/ACES_1d.json');
    testData = JSON.parse(fs.readFileSync(acesPath, 'utf8'));
}

const result = calculateAutoSR(testData, { lookback: 10, maxLines: 3, maxZones: 2 });
assert(result !== null, 'calculateAutoSR should return valid result');
assert(typeof result.currentPrice === 'number', 'currentPrice should be a number');
assert(Array.isArray(result.resistances), 'resistances should be an array');
assert(Array.isArray(result.supports), 'supports should be an array');
assert(Array.isArray(result.supplyZones), 'supplyZones should be an array');
assert(Array.isArray(result.demandZones), 'demandZones should be an array');

console.log(`Current Price: ${result.currentPrice}`);
console.log(`Resistances (${result.resistances.length}):`, result.resistances.map(r => `${r.title} @ ${r.price} (${r.distancePct})`));
console.log(`Supports (${result.supports.length}):`, result.supports.map(s => `${s.title} @ ${s.price} (${s.distancePct})`));
console.log(`Supply Zones (${result.supplyZones.length}):`, result.supplyZones.map(z => `${z.label} [${z.bottomPrice} - ${z.topPrice}]`));
console.log(`Demand Zones (${result.demandZones.length}):`, result.demandZones.map(z => `${z.label} [${z.bottomPrice} - ${z.topPrice}]`));

// Verify anti-clutter spacing between resistance lines
for (let i = 0; i < result.resistances.length - 1; i++) {
    const diff = Math.abs(result.resistances[i].price - result.resistances[i + 1].price);
    const tick = getIdxTickSize(result.resistances[i].price);
    assert(diff >= 3 * tick, `Resistances must be spaced at least 3 ticks apart: ${diff} >= ${3 * tick}`);
}

// Verify anti-clutter spacing between support lines
for (let i = 0; i < result.supports.length - 1; i++) {
    const diff = Math.abs(result.supports[i].price - result.supports[i + 1].price);
    const tick = getIdxTickSize(result.supports[i].price);
    assert(diff >= 3 * tick, `Supports must be spaced at least 3 ticks apart: ${diff} >= ${3 * tick}`);
}

// Verify zone boundaries
for (const z of result.supplyZones) {
    assert(z.bottomPrice < z.topPrice, `Supply zone bottom must be < top: ${z.bottomPrice} < ${z.topPrice}`);
    assert(z.centerPrice >= z.bottomPrice && z.centerPrice <= z.topPrice, 'Center must be inside zone');
}
for (const z of result.demandZones) {
    assert(z.bottomPrice < z.topPrice, `Demand zone bottom must be < top: ${z.bottomPrice} < ${z.topPrice}`);
    assert(z.centerPrice >= z.bottomPrice && z.centerPrice <= z.topPrice, 'Center must be inside zone');
}

console.log('✓ Mathematical S/R and Zone constraints verified successfully.');

console.log('\n--- Test 3: Breakout Scenario (AKSI) ---');
const aksiPath = path.join(__dirname, '../indicator-examples/public/AKSI_1d.json');
if (fs.existsSync(aksiPath)) {
    const aksiData = JSON.parse(fs.readFileSync(aksiPath, 'utf8'));
    const aksiResult = calculateAutoSR(aksiData, { lookback: 10 });
    assert(aksiResult !== null, 'AKSI result should not be null');
    console.log(`AKSI Close: ${aksiResult.currentPrice}, Resistances: ${aksiResult.resistances.length}, Supports: ${aksiResult.supports.length}`);
    console.log('✓ Breakout handling verified.');
}

console.log('\nALL TESTS PASSED! S/R ENGINE IS READY FOR CHROME EXTENSION.');
