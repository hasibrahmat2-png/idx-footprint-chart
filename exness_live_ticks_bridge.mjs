/**
 * exness_live_ticks_bridge.mjs - Real-Time Exness Ticks & Candlestick Streaming Bridge
 * 
 * Connects to Exness Real-Time API WebSocket (wss://rtapi-sg.useusecapwaskeyyepjamlaw.com/rtapi/mt5/trial6/v2/ws/ticks/accounts/414399831)
 * with the required subprotocols ('exness-ws-protocol', JWT), maintains continuous
 * live ticks, aggregates 1M & Daily OHLC candlesticks with hybrid REST gap-filling,
 * and re-broadcasts real-time trades/candles to Lightweight Charts web clients on ws://localhost:8765.
 */

import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = __dirname;

// Global process crash protection
process.on('uncaughtException', (err) => {
    console.error('[Exness Bridge] Uncaught Exception:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Exness Bridge] Unhandled Rejection:', promise, 'reason:', reason);
});

// Load .env
const envPath = path.resolve(BASE_DIR, '.env');
function loadEnv() {
    if (fs.existsSync(envPath)) {
        try {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const idx = trimmed.indexOf('=');
                if (idx !== -1) {
                    const k = trimmed.slice(0, idx).trim();
                    const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
                    process.env[k] = v;
                }
            }
        } catch (e) {
            console.warn('[Exness Bridge] Warning reading .env:', e.message);
        }
    }
}
loadEnv();

// Configuration & CLI flags
const args = process.argv.slice(2);
let cliPort = null;
let cliToken = null;
let cliAccount = null;
let cliServer = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) cliPort = parseInt(args[++i], 10);
    else if (args[i] === '--token' && args[i + 1]) cliToken = args[++i];
    else if (args[i] === '--account' && args[i + 1]) cliAccount = args[++i];
    else if (args[i] === '--server' && args[i + 1]) cliServer = args[++i];
}

function cleanToken(raw) {
    if (!raw) return '';
    let t = String(raw).trim();
    t = t.replace(/^Sec-WebSocket-Protocol:\s*/i, '');
    t = t.replace(/^exness-ws-protocol\s*,\s*/i, '');
    t = t.replace(/^Bearer\s+/i, '');
    t = t.replace(/^['"]|['"]$/g, '').trim();
    return t;
}

const LOCAL_PORT = cliPort || parseInt(process.env.LOCAL_WS_PORT || '8765', 10);
const SERVER = cliServer || process.env.EXNESS_SERVER || 'trial6';
const ACCOUNT = cliAccount || process.env.EXNESS_ACCOUNT || '414399831';
const HOST_BASE = process.env.EXNESS_HOST || 'rtapi-sg.useusecapwaskeyyepjamlaw.com';
const UPSTREAM_WS_URL = `wss://${HOST_BASE}/rtapi/mt5/${SERVER}/v2/ws/ticks/accounts/${ACCOUNT}`;
const REST_BASE_URL = `https://${HOST_BASE}/rtapi/mt5/${SERVER}/v2/accounts/${ACCOUNT}`;
const RAW_TOKEN = cliToken || process.env.EXNESS_TOKEN || '';
const EXNESS_TOKEN = cleanToken(RAW_TOKEN);

if (cliToken) {
    try {
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (envContent.includes('EXNESS_TOKEN=')) {
            envContent = envContent.replace(/^EXNESS_TOKEN=.*$/m, `EXNESS_TOKEN=${EXNESS_TOKEN}`);
        } else {
            envContent = envContent.trim() + `\nEXNESS_TOKEN=${EXNESS_TOKEN}\n`;
        }
        fs.writeFileSync(envPath, envContent.trim() + '\n');
    } catch (e) {}
}

if (!EXNESS_TOKEN) {
    console.error('❌ Error: EXNESS_TOKEN tidak ditemukan di .env maupun CLI arguments.');
    console.error('Silakan set EXNESS_TOKEN di file .env atau jalankan: node exness_live_ticks_bridge.mjs --token <TOKEN>');
    process.exit(1);
}

// 12 Standard Traded Forex/Commodities/Crypto Pairs
const DEFAULT_INSTRUMENTS = [
    'XAUUSDm', 'BTCUSDm', 'EURUSDm', 'USDJPYm', 'AUDUSDm',
    'GBPUSDm', 'XAGUSDm', 'USDHKDm', 'AUDCHFm', 'EURJPYm',
    'AUDJPYm', 'USDCHFm'
];

function toExnessSymbol(sym) {
    if (!sym) return '';
    const s = String(sym).trim();
    if (s.endsWith('M')) return s.slice(0, -1) + 'm';
    if (s.endsWith('C')) return s.slice(0, -1) + 'c';
    if (!s.endsWith('m') && !s.endsWith('c')) return s + 'm';
    return s;
}

// Active State
const activeInstruments = new Set(DEFAULT_INSTRUMENTS);
const lastPrices = new Map(); // sym -> { bid, ask, timeMs, direction }
const minuteCandles = new Map(); // sym -> { time, open, high, low, close, volume }
const dailyCandles = new Map(); // sym -> { time, open, high, low, close, volume, prevClose }
const recent1mBarsCache = new Map(); // sym -> Array of { time, open, high, low, close, volume }
let upstreamWs = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let lastTickReceivedTs = 0;
let isReconnecting = false;

// -----------------------------------------------------------------------------
// 1. Local WebSocket Server (Broadcasting to Browser on ws://localhost:8765)
// -----------------------------------------------------------------------------
let localWss = null;
try {
    localWss = new WebSocketServer({ port: LOCAL_PORT });
    console.log(`[Exness Bridge] Local WebSocket Server listening on ws://localhost:${LOCAL_PORT}`);
} catch (e) {
    console.error(`[Exness Bridge] Gagal membuka port ${LOCAL_PORT}:`, e.message);
    process.exit(1);
}

localWss.on('connection', (clientWs, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[Local Client] Connected from ${clientIp}`);

    // Send initial snapshot of all active instruments
    clientWs.send(JSON.stringify({
        type: 'snapshot',
        market: { status: 'OPEN', timestamp: Math.floor(Date.now() / 1000) },
        recent: [],
        top: []
    }));

    if (dailyCandles.size > 0) {
        clientWs.send(JSON.stringify({
            type: 'today_candles_snapshot',
            count: dailyCandles.size,
            candles: Object.fromEntries(dailyCandles)
        }));
    }

    // Handle client commands
    clientWs.on('message', (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.action === 'subscribe_symbol' && data.symbol) {
                const exSym = toExnessSymbol(data.symbol);
                if (!activeInstruments.has(exSym)) {
                    activeInstruments.add(exSym);
                    subscribeUpstream([exSym]);
                }
            } else if (data.action === 'get_intraday' && data.symbol) {
                const reqSym = String(data.symbol);
                const exSym = toExnessSymbol(reqSym);
                const bars = recent1mBarsCache.get(exSym) || (minuteCandles.get(exSym) ? [minuteCandles.get(exSym)] : []);
                const todayBar = dailyCandles.get(exSym) || null;
                clientWs.send(JSON.stringify({
                    type: 'intraday_snapshot',
                    symbol: reqSym,
                    bars: bars,
                    todayDailyBar: todayBar
                }));
            } else if (data.action === 'get_today_candle' && data.symbol) {
                const reqSym = String(data.symbol);
                const exSym = toExnessSymbol(reqSym);
                clientWs.send(JSON.stringify({
                    type: 'today_candle',
                    symbol: reqSym,
                    candle: dailyCandles.get(exSym) || null
                }));
            } else if (data.action === 'get_today_candles_all') {
                clientWs.send(JSON.stringify({
                    type: 'today_candles_snapshot',
                    count: dailyCandles.size,
                    candles: Object.fromEntries(dailyCandles)
                }));
            } else if (data.action === 'get_alert_config') {
                clientWs.send(JSON.stringify({
                    type: 'alert_config_response',
                    config: { sound: true, popup: true }
                }));
            }
        } catch (e) {
            // Ignore malformed client payload
        }
    });

    clientWs.on('close', () => {
        console.log(`[Local Client] Disconnected`);
    });
});

function broadcastToClients(data) {
    if (!localWss) return;
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    for (const client of localWss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}

// -----------------------------------------------------------------------------
// 2. Hybrid REST Gap-Filling (When WebSocket is reconnected after disconnect)
// -----------------------------------------------------------------------------
async function fillGapIfAny(symbol, fromSec, toSec) {
    const gapSec = toSec - fromSec;
    if (gapSec < 60) return; // Less than 1 minute gap, no candle missed

    const count = Math.min(Math.ceil(gapSec / 60) + 1, 100);
    const url = `${REST_BASE_URL}/instruments/${symbol}/candles?time_frame=1&from=${fromSec}&count=${count}&price=bid`;

    try {
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${EXNESS_TOKEN}`,
                'Origin': 'https://my.exness.com',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            }
        });

        if (!res.ok) return;
        const data = await res.json();
        const candles = data.candles || [];
        if (candles.length > 0) {
            console.log(`[Gap-Fill] 🩹 Berhasil menambal ${candles.length} candle untuk ${symbol} yang sempat terlewat.`);
            broadcastToClients({
                type: 'intraday_snapshot',
                symbol: symbol,
                bars: candles.map(c => ({
                    time: c.time || c.t,
                    open: c.open || c.o,
                    high: c.high || c.h,
                    low: c.low || c.l,
                    close: c.close || c.c,
                    volume: c.volume || c.v || 1
                }))
            });
        }
    } catch (e) {
        console.warn(`[Gap-Fill] Gagal mengambil candle gap untuk ${symbol}:`, e.message);
    }
}

// -----------------------------------------------------------------------------
// 3. Upstream WebSocket Connection (Exness MT5 Real-Time Ticks)
// -----------------------------------------------------------------------------
function subscribeUpstream(symbols) {
    if (!upstreamWs || upstreamWs.readyState !== WebSocket.OPEN) return;
    const subMsg = JSON.stringify({
        id: crypto.randomUUID(),
        subscribe: {
            event: 'ticks',
            instruments: Array.from(symbols)
        }
    });
    upstreamWs.send(subMsg);
    console.log(`[Exness Bridge] 📡 Subscribed ke ${symbols.length} instrumen:`, symbols.slice(0, 5).join(', ') + (symbols.length > 5 ? '...' : ''));
}

function connectUpstream() {
    if (isReconnecting) return;
    clearTimeout(reconnectTimer);

    console.log(`[Exness Bridge] 🔄 Menyambungkan ke Upstream Exness: ${UPSTREAM_WS_URL}...`);

    try {
        upstreamWs = new WebSocket(UPSTREAM_WS_URL, ['exness-ws-protocol', EXNESS_TOKEN], {
            headers: {
                'Origin': 'https://my.exness.com',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            }
        });
    } catch (err) {
        console.error('[Exness Bridge] Inisialisasi WebSocket gagal:', err.message);
        scheduleReconnect();
        return;
    }

    upstreamWs.on('open', () => {
        console.log(`[Exness Bridge] ✅ TERHUBUNG ke Exness Real-Time Ticks!`);
        reconnectDelay = 1000;
        isReconnecting = false;

        // Gap filling if there was a disconnect
        const nowSec = Math.floor(Date.now() / 1000);
        if (lastTickReceivedTs > 0 && (nowSec - lastTickReceivedTs) >= 60) {
            console.log(`[Exness Bridge] Mendeteksi jeda koneksi ${(nowSec - lastTickReceivedTs)}s. Memeriksa gap-fill...`);
            for (const sym of activeInstruments) {
                fillGapIfAny(sym, lastTickReceivedTs, nowSec);
            }
        }

        // Subscribe to active instruments
        subscribeUpstream(Array.from(activeInstruments));
    });

    upstreamWs.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());

            // Handle system responses
            if (data.code !== undefined && data.code !== '200') {
                if (data.code === 401 || data.code === '401') {
                    console.error('\n❌ [Exness Bridge] Error 401: Token Exness kedaluwarsa / tidak valid.');
                    console.error('👉 Silakan salin token terbaru dari DevTools (Sec-WebSocket-Protocol) dan jalankan:');
                    console.error('   node exness_live_ticks_bridge.mjs --token <TOKEN_BARU>\n');
                    process.exit(1);
                }
                console.warn('[Exness Bridge] Server Notice/Error:', data.msg || data.code);
                return;
            }

            // Handle price tick: { i: "BTCUSDm", t: 1791143100246, b: 85432.97, a: 85442.97 }
            if (data.i && data.b !== undefined && data.a !== undefined) {
                handleIncomingTick(data);
            }
        } catch (e) {
            // Ignore non-JSON frames
        }
    });

    upstreamWs.on('unexpected-response', (req, res) => {
        if (res.statusCode === 401) {
            console.error('\n❌ [Exness Bridge] Error 401 Unauthorized: Token sesi Exness Anda telah kedaluwarsa / di-refresh oleh browser.');
            console.error('👉 Silakan salin token JWT terbaru dari tab DevTools (Sec-WebSocket-Protocol) dan jalankan:');
            console.error('   node exness_live_ticks_bridge.mjs --token <TOKEN_BARU>\n');
            process.exit(1);
        }
    });

    upstreamWs.on('error', (err) => {
        if (!err.message.includes('401')) {
            console.error('[Exness Bridge] ⚠️ Upstream Error:', err.message);
        }
    });

    upstreamWs.on('close', (code, reason) => {
        console.warn(`[Exness Bridge] 🔌 Upstream terputus (Code: ${code}, Reason: ${reason || 'Connection lost'}).`);
        scheduleReconnect();
    });
}

function scheduleReconnect() {
    isReconnecting = true;
    clearTimeout(reconnectTimer);
    console.log(`[Exness Bridge] Mencoba menyambung kembali dalam ${(reconnectDelay / 1000).toFixed(1)} detik...`);
    reconnectTimer = setTimeout(() => {
        isReconnecting = false;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
        connectUpstream();
    }, reconnectDelay);
}

// -----------------------------------------------------------------------------
// 4. Tick Processing & Candlestick Aggregation
// -----------------------------------------------------------------------------
function handleIncomingTick(tick) {
    const sym = tick.i;
    const timeMs = tick.t || Date.now();
    const timeSec = Math.floor(timeMs / 1000);
    const bid = Number(tick.b);
    const ask = Number(tick.a);
    lastTickReceivedTs = timeSec;

    // 1. Determine direction
    const prev = lastPrices.get(sym);
    let direction = 'up';
    if (prev) {
        if (bid > prev.bid) direction = 'up';
        else if (bid < prev.bid) direction = 'down';
        else direction = prev.direction || 'up';
    }
    lastPrices.set(sym, { bid, ask, timeMs, direction });

    // 2. Aggregate 1-Minute Candle
    const minuteTs = Math.floor(timeMs / 60000) * 60;
    let mCandle = minuteCandles.get(sym);
    let isNew1mBar = false;

    if (!mCandle || minuteTs > mCandle.time) {
        mCandle = {
            symbol: sym,
            time: minuteTs,
            open: bid,
            high: bid,
            low: bid,
            close: bid,
            volume: 1
        };
        minuteCandles.set(sym, mCandle);
        isNew1mBar = true;

        let bars = recent1mBarsCache.get(sym);
        if (!bars) {
            bars = [];
            recent1mBarsCache.set(sym, bars);
        }
        bars.push({ ...mCandle });
        if (bars.length > 500) bars.shift();
    } else {
        mCandle.close = bid;
        mCandle.high = Math.max(mCandle.high, bid);
        mCandle.low = Math.min(mCandle.low, bid);
        mCandle.volume++;

        let bars = recent1mBarsCache.get(sym);
        if (bars && bars.length > 0) {
            bars[bars.length - 1] = { ...mCandle };
        }
    }

    // 3. Aggregate Daily Candle
    const dailyTs = Math.floor(timeMs / 86400000) * 86400;
    let dCandle = dailyCandles.get(sym);
    if (!dCandle || dailyTs > dCandle.time) {
        dCandle = {
            symbol: sym,
            time: dailyTs,
            open: bid,
            high: bid,
            low: bid,
            close: bid,
            volume: 1
        };
        dailyCandles.set(sym, dCandle);
    } else {
        dCandle.close = bid;
        dCandle.high = Math.max(dCandle.high, bid);
        dCandle.low = Math.min(dCandle.low, bid);
        dCandle.volume++;
    }

    const timeStr = new Date(timeMs).toLocaleTimeString('en-US', { hour12: false });

    // 4. Broadcast normalized trade event for Running Tape & Screener
    broadcastToClients({
        type: 'trade',
        data: {
            symbol: sym,
            action: direction === 'up' ? 'BUY' : 'SELL',
            price: bid,
            lot: 1,
            value: bid,
            tradeNo: `${sym}-${timeMs}`,
            timeSec: timeSec,
            timeStr: timeStr,
            dailyTs: dailyTs
        }
    });

    // 5. Broadcast live candle update for the Active Timeframe
    broadcastToClients({
        type: 'today_candle',
        symbol: sym,
        candle: {
            symbol: sym,
            time: dailyTs,
            open: dCandle.open,
            high: dCandle.high,
            low: dCandle.low,
            close: dCandle.close,
            volume: dCandle.volume
        }
    });
}

// -----------------------------------------------------------------------------
// 5. Periodic Heartbeat & Console Telemetry (Every 5s)
// -----------------------------------------------------------------------------
setInterval(() => {
    if (lastPrices.size === 0) return;
    const gold = lastPrices.get('XAUUSDm');
    const btc = lastPrices.get('BTCUSDm');
    const eur = lastPrices.get('EURUSDm');

    const parts = [];
    if (gold) parts.push(`Gold: ${gold.bid.toFixed(2)} (${gold.direction === 'up' ? '🟢' : '🔴'})`);
    if (btc) parts.push(`BTC: ${btc.bid.toFixed(2)} (${btc.direction === 'up' ? '🟢' : '🔴'})`);
    if (eur) parts.push(`EURUSD: ${eur.bid.toFixed(5)}`);

    const clientCount = localWss ? localWss.clients.size : 0;
    process.stdout.write(`\r[Live Stream] ${parts.join(' | ')} | Clients: ${clientCount}   `);
}, 3000);

// Start
connectUpstream();
