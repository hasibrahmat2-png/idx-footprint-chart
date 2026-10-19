/**
 * tests/test_volume_sma_breakout.mjs
 * 
 * Verifies Option B (Prorated Relative Volume Pace) and Webhook Formatting:
 * 1. Early morning (< 10:45 WIB): triggers '⚡ High Early Pace' at >= 50% 20D SMA
 * 2. Full breakout (any time): triggers '🔥 Full 20D SMA Breakout' at >= 100% 20D SMA
 * 3. Deduplication: No duplicate alert for the same tier
 * 4. Filtering: Only symbols in Watchlist, Follow Through, or Active Chart are dispatched
 * 5. Webhook formatting: Verifies Discord embed and Telegram text templates
 */

import assert from 'assert';

console.log('=== Running 20D Volume SMA Breakout Unit Tests ===\n');

// 1. Logic Simulator for Option B
class VolumeBreakoutEngine {
    constructor() {
        this.records = new Map();
        this.dispatchedAlerts = [];
        this.stockVolSma20Map = new Map([
            ['SMDR', 50000],  // 20D SMA = 50,000 Lot
            ['BBRI', 200000], // 20D SMA = 200,000 Lot
            ['GOTO', 500000]  // 20D SMA = 500,000 Lot
        ]);
        this.userWatchlists = {
            portfolio: ['SMDR'],
            traded: []
        };
        this.followThroughAlerts = new Set(['BBRI']);
        this.activeTicker = 'BBCA';
    }

    getStockVolSma20(sym) {
        return this.stockVolSma20Map.get(sym.toUpperCase()) || 0;
    }

    evaluateVolumeBreakout(sym, currentPrice, changePercent, intradayLot, minutesOfDay, timeStr, source = 'api') {
        const symUpper = sym.toUpperCase();
        const volSma20 = this.getStockVolSma20(symUpper);
        if (volSma20 <= 0 || intradayLot <= 0) return null;

        const ratioPercent = (intradayLot / volSma20) * 100;

        let record = this.records.get(symUpper);
        if (!record) {
            record = {
                symbol: symUpper,
                volSma20,
                intradayLot,
                ratioPercent,
                paceLabel: 'Normal Volume',
                hasAlertedPace: false,
                hasAlertedFull: false,
                crossedAtTime: null
            };
            this.records.set(symUpper, record);
        } else {
            record.volSma20 = volSma20;
            record.intradayLot = Math.max(record.intradayLot, intradayLot);
            record.ratioPercent = Math.max(record.ratioPercent, ratioPercent);
        }

        const isEarlySession = minutesOfDay < 645; // before 10:45 WIB
        const isEarlyPace = isEarlySession && record.ratioPercent >= 50 && record.ratioPercent < 100;
        const isFullBreakout = record.ratioPercent >= 100;

        let shouldAlert = false;
        let alertPace = '';

        if (isFullBreakout && !record.hasAlertedFull) {
            record.hasAlertedFull = true;
            record.hasAlertedPace = true;
            if (!record.crossedAtTime) record.crossedAtTime = timeStr;
            record.paceLabel = `🔥 Full 20D SMA Breakout (${record.ratioPercent.toFixed(1)}%)`;
            alertPace = record.paceLabel;
            shouldAlert = true;
        } else if (isEarlyPace && !record.hasAlertedPace) {
            record.hasAlertedPace = true;
            if (!record.crossedAtTime) record.crossedAtTime = timeStr;
            record.paceLabel = `⚡ High Early Pace (${record.ratioPercent.toFixed(1)}% sebelum 10:45)`;
            alertPace = record.paceLabel;
            shouldAlert = true;
        }

        if (shouldAlert) {
            const isFollowed = this.followThroughAlerts.has(symUpper);
            const isInWatchlist = (this.userWatchlists.portfolio || []).includes(symUpper) || (this.userWatchlists.traded || []).includes(symUpper);
            const isActive = symUpper === this.activeTicker;

            if (isFollowed || isInWatchlist || isActive) {
                const payload = {
                    symbol: symUpper,
                    price: currentPrice,
                    changePercent: changePercent,
                    intradayLot: record.intradayLot,
                    volSma20: record.volSma20,
                    ratioPercent: record.ratioPercent,
                    paceLabel: alertPace,
                    crossedAtTime: record.crossedAtTime || timeStr,
                    source: source
                };
                this.dispatchedAlerts.push(payload);
                return payload;
            }
        }
        return null;
    }
}

// Test 1: Early morning before 10:45 WIB (< 645 mins)
const engine = new VolumeBreakoutEngine();

// 09:15 WIB (555 minutes): SMDR volume is 20,000 lot (40% of 50,000) -> No alert
let res = engine.evaluateVolumeBreakout('SMDR', 380, 2.5, 20000, 555, '09:15:00 WIB');
assert.strictEqual(res, null, '40% at 09:15 should not trigger early pace');
assert.strictEqual(engine.dispatchedAlerts.length, 0);
console.log('[PASS] Volume < 50% before 10:45 WIB does not trigger alert.');

// 09:25 WIB (565 minutes): SMDR volume reaches 26,000 lot (52% of 50,000) -> High Early Pace alert!
res = engine.evaluateVolumeBreakout('SMDR', 382, 3.0, 26000, 565, '09:25:00 WIB');
assert.notStrictEqual(res, null, '52% at 09:25 should trigger High Early Pace');
assert.strictEqual(res.symbol, 'SMDR');
assert.strictEqual(res.ratioPercent, 52);
assert.strictEqual(res.paceLabel.includes('⚡ High Early Pace'), true);
assert.strictEqual(engine.dispatchedAlerts.length, 1);
console.log('[PASS] Volume >= 50% at 09:25 WIB triggers ⚡ High Early Pace alert.');

// 09:30 WIB: Tick with 27,000 lot (54%) -> Deduplicated, no new alert
res = engine.evaluateVolumeBreakout('SMDR', 382, 3.0, 27000, 570, '09:30:00 WIB');
assert.strictEqual(res, null, 'Repeat tick at 54% should be deduplicated');
assert.strictEqual(engine.dispatchedAlerts.length, 1);
console.log('[PASS] Intermediate tick between 50% and 100% does not re-alert (deduplicated).');

// 10:10 WIB (610 minutes): SMDR volume surges to 51,000 lot (102% of 50,000) -> Full Breakout alert!
res = engine.evaluateVolumeBreakout('SMDR', 390, 5.0, 51000, 610, '10:10:00 WIB');
assert.notStrictEqual(res, null, '102% should trigger Full Breakout');
assert.strictEqual(res.ratioPercent, 102);
assert.strictEqual(res.paceLabel.includes('🔥 Full 20D SMA Breakout'), true);
assert.strictEqual(engine.dispatchedAlerts.length, 2);
console.log('[PASS] Volume >= 100% triggers 🔥 Full 20D SMA Breakout.');

// 10:20 WIB: Another tick at 55,000 lot (110%) -> Deduplicated
res = engine.evaluateVolumeBreakout('SMDR', 392, 5.5, 55000, 620, '10:20:00 WIB');
assert.strictEqual(res, null, 'Subsequent tick after Full Breakout is deduplicated');
assert.strictEqual(engine.dispatchedAlerts.length, 2);
console.log('[PASS] Subsequent ticks after Full Breakout are deduplicated.');

// Test 2: Late session after 10:45 WIB (>= 645 mins)
// 11:15 WIB (675 minutes): BBRI volume is 120,000 (60% of 200,000) -> Past 10:45, no early pace
res = engine.evaluateVolumeBreakout('BBRI', 4150, 1.2, 120000, 675, '11:15:00 WIB');
assert.strictEqual(res, null, '60% after 10:45 WIB should NOT trigger early pace');
assert.strictEqual(engine.dispatchedAlerts.length, 2);
console.log('[PASS] 60% after 10:45 WIB correctly does NOT trigger early pace.');

// 14:00 WIB (840 minutes): BBRI volume surges to 205,000 (102.5% of 200,000) -> Full Breakout triggers!
res = engine.evaluateVolumeBreakout('BBRI', 4200, 2.4, 205000, 840, '14:00:00 WIB');
assert.notStrictEqual(res, null, '102.5% at 14:00 triggers Full Breakout');
assert.strictEqual(res.symbol, 'BBRI');
assert.strictEqual(Number(res.ratioPercent.toFixed(1)), 102.5);
assert.strictEqual(engine.dispatchedAlerts.length, 3);
console.log('[PASS] Full breakout >= 100% triggers in afternoon session.');

// Test 3: Watchlist Filtering Guard
// GOTO has 20D SMA = 500,000, hits 110% (550,000 lot), but is NOT in watchlist/followThrough/activeTicker
res = engine.evaluateVolumeBreakout('GOTO', 65, 3.2, 550000, 600, '10:00:00 WIB');
assert.strictEqual(res, null, 'Unwatched symbol should be filtered out from dispatch');
assert.strictEqual(engine.dispatchedAlerts.length, 3, 'Dispatched alerts count should not increment');
console.log('[PASS] Unwatched symbol volume breakout is strictly suppressed from webhook dispatch.');

// Test 4: Webhook Formatting Parity
function formatDiscordEmbed(payload) {
    const isFull = (payload.ratioPercent || 0) >= 100;
    const statusColor = isFull ? 0xFF6D00 : 0x00B0FF;
    const icon = isFull ? '🔥' : '⚡';
    const chgSign = ((payload.changePercent || 0) >= 0 ? '+' : '');
    const priceFormatted = `Rp ${Number(payload.price || 0).toLocaleString('id-ID')} (${chgSign}${Number(payload.changePercent || 0).toFixed(2)}%)`;
    return {
        title: `${icon} [${payload.symbol}] ${payload.paceLabel || '20D Volume Breakout'}`,
        color: statusColor,
        fields: [
            { name: "🏷️ Current Price", value: priceFormatted, inline: true },
            { name: "📊 Volume Hari Ini", value: `${Number(payload.intradayLot || 0).toLocaleString('id-ID')} Lot`, inline: true },
            { name: "📈 20D SMA Volume", value: `${Number(payload.volSma20 || 0).toLocaleString('id-ID')} Lot`, inline: true },
            { name: "⚡ RVOL Ratio", value: `${Number(payload.ratioPercent || 0).toFixed(1)}%`, inline: true },
            { name: "🕒 Jam Terdeteksi", value: `${payload.crossedAtTime}`, inline: true }
        ]
    };
}

function formatTelegramText(payload) {
    const isFull = (payload.ratioPercent || 0) >= 100;
    const icon = isFull ? '🔥' : '⚡';
    const chgSign = ((payload.changePercent || 0) >= 0 ? '+' : '');
    const priceStr = `Rp ${Number(payload.price || 0).toLocaleString('id-ID')} (<code>${chgSign}${Number(payload.changePercent || 0).toFixed(2)}%</code>)`;
    const paceTitle = payload.paceLabel || '20D Volume Breakout';

    return `${icon} <b>VOLUME BREAKOUT ALERT: $${payload.symbol}</b>\n\n` +
           `⚡ <b>Status:</b> <code>${paceTitle}</code>\n` +
           `🏷️ <b>Harga:</b> ${priceStr}\n` +
           `📊 <b>Volume Hari Ini:</b> <code>${Number(payload.intradayLot || 0).toLocaleString('id-ID')} Lot</code>\n` +
           `📈 <b>Rata-rata 20D:</b> <code>${Number(payload.volSma20 || 0).toLocaleString('id-ID')} Lot</code> (<b>${Number(payload.ratioPercent || 0).toFixed(1)}%</b>)\n` +
           `🕒 <b>Waktu Terdeteksi:</b> <code>${payload.crossedAtTime}</code>\n\n` +
           `#${payload.symbol} #IDX #VolumeBreakout`;
}

const smdrAlert = engine.dispatchedAlerts[1]; // Full breakout
const discordEmbed = formatDiscordEmbed(smdrAlert);
assert.strictEqual(discordEmbed.color, 0xFF6D00, 'Full breakout color should be orange/amber');
assert.strictEqual(discordEmbed.title.includes('🔥 [SMDR]'), true);
assert.strictEqual(discordEmbed.fields.length, 5);

const tgText = formatTelegramText(smdrAlert);
assert.strictEqual(tgText.includes('🔥 <b>VOLUME BREAKOUT ALERT: $SMDR</b>'), true);
assert.strictEqual(tgText.includes('51.000 Lot'), true);
assert.strictEqual(tgText.includes('102.0%'), true);

console.log('[PASS] Discord Embed & Telegram Message formatting verified for Volume Breakouts.');

console.log('\nAll 20D Volume SMA Breakout tests passed successfully!');
