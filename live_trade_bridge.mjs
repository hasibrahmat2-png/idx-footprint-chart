/**
 * live_trade_bridge.mjs - Real-Time IDX Running Trades Upstream Bridge
 * 
 * Connects to upstream WebSocket (wss://stock.arjum.com/ws/running-trade)
 * with the required authentication headers (X-API-Key), and re-broadcasts
 * live trades to local browser clients on ws://localhost:8765.
 */

import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';

// Process-level crash protection to prevent daemon exits on unhandled network/webhook errors
process.on('uncaughtException', (err) => {
    console.error('[Bridge] Uncaught Exception:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Bridge] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

// Load .env if present
const envPath = path.resolve(process.cwd(), '.env');
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
            console.warn('[Bridge] Warning loading .env:', e.message);
        }
    }
}
loadEnv();

function saveEnvConfig(newEntries) {
    try {
        let content = '';
        if (fs.existsSync(envPath)) {
            content = fs.readFileSync(envPath, 'utf8');
        }
        for (const [key, value] of Object.entries(newEntries)) {
            if (value === undefined || value === null) continue;
            process.env[key] = String(value);
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(content)) {
                content = content.replace(regex, `${key}=${value}`);
            } else {
                content = content.trim() + `\n${key}=${value}\n`;
            }
        }
        fs.writeFileSync(envPath, content.trim() + '\n');
        console.log(`[Bridge] Successfully updated environment config in ${envPath}`);
    } catch (e) {
        console.error('[Bridge] Failed to save config to .env:', e.message);
    }
}

function saveEnvKey(newKey) {
    saveEnvConfig({ STOCK_API_KEY: newKey });
}

// Alert Streaming Configuration Helpers
function getAlertConfig() {
    const discordUrl = process.env.DISCORD_WEBHOOK_URL || '';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
    const discordEnabled = process.env.DISCORD_ALERT_ENABLED !== 'false';
    const telegramEnabled = process.env.TELEGRAM_ALERT_ENABLED !== 'false';
    const supportAlertEnabled = process.env.SUPPORT_ALERT_ENABLED !== 'false';
    const volumeAlertEnabled = process.env.VOLUME_ALERT_ENABLED !== 'false';
    const cooldownMinutes = parseInt(process.env.ALERT_COOLDOWN_MINUTES || '5', 10);

    return {
        type: 'alert_config',
        discordConfigured: !!discordUrl,
        discordWebhookUrl: discordUrl,
        discordWebhookMasked: discordUrl ? `${discordUrl.slice(0, 35)}••••••••` : '',
        discordEnabled,
        telegramConfigured: !!(telegramToken && telegramChatId),
        telegramToken: telegramToken,
        telegramBotToken: telegramToken,
        telegramTokenMasked: telegramToken ? `${telegramToken.slice(0, 8)}••••••••` : '',
        telegramChatId: telegramChatId || '',
        telegramEnabled,
        supportAlertEnabled,
        volumeAlertEnabled,
        cooldownMinutes
    };
}

// Discord and Telegram Alert Dispatcher Functions
const TIER_COLORS = {
    1: 0x00C853, // Emerald Green (Priority 1: Buy Zone)
    2: 0x2962FF, // Deep Sky Blue (Priority 2: Sup >= 2x)
    3: 0xFFB300, // Amber (Priority 3: Low 1x)
    broken: 0xD50000 // Red (Support Broken)
};

async function sendDiscordAlert(payload, isTest = false) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        return { success: false, error: 'DISCORD_WEBHOOK_URL not configured in .env' };
    }

    if (isTest) {
        const body = {
            username: "IDX Footprint Alerts",
            avatar_url: "https://stockbit.com/favicon.ico",
            embeds: [{
                title: "🔔 [TEST ALERT] Discord Alert Stream Connected!",
                description: "Test notification from **IDX Footprint Chart & Follow Through Alert System**.\nYour Discord webhook is configured and operating correctly.",
                color: 0x2962FF,
                fields: [
                    { name: "Channel Status", value: "✅ Online & Listening", inline: true },
                    { name: "Timestamp", value: new Date().toLocaleTimeString('id-ID') + ' WIB', inline: true }
                ],
                footer: { text: "IDX Footprint Chart • Follow Through Stream" },
                timestamp: new Date().toISOString()
            }]
        };
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Discord HTTP ${res.status}: ${txt}`);
        }
        return { success: true };
    }

    if (payload.alertType === 'volume_breakout') {
        const isFull = (payload.ratioPercent || 0) >= 100;
        const statusColor = isFull ? 0xFF6D00 : 0x00B0FF; // Deep Amber for Full, Vivid Blue for Early Pace
        const icon = isFull ? '🔥' : '⚡';
        const chgSign = ((payload.changePercent || 0) >= 0 ? '+' : '');
        const priceFormatted = `Rp ${Number(payload.price || 0).toLocaleString('id-ID')} (${chgSign}${Number(payload.changePercent || 0).toFixed(2)}%)`;
        const embed = {
            title: `${icon} [${payload.symbol}] ${payload.paceLabel || '20D Volume Breakout'}`,
            description: `Stock **$${payload.symbol}** surged past 20-Day SMA Volume benchmark: **${Number(payload.ratioPercent || 0).toFixed(1)}%**!`,
            color: statusColor,
            fields: [
                { name: "🏷️ Current Price", value: priceFormatted, inline: true },
                { name: "📊 Volume Hari Ini", value: `${Number(payload.intradayLot || 0).toLocaleString('id-ID')} Lot`, inline: true },
                { name: "📈 20D SMA Volume", value: `${Number(payload.volSma20 || 0).toLocaleString('id-ID')} Lot`, inline: true },
                { name: "⚡ RVOL Ratio", value: `${Number(payload.ratioPercent || 0).toFixed(1)}%`, inline: true },
                { name: "🕒 Jam Terdeteksi", value: `${payload.crossedAtTime || new Date().toLocaleTimeString('id-ID') + ' WIB'}`, inline: true }
            ],
            footer: { text: "IDX Footprint Chart • 20D Volume Alert" },
            timestamp: new Date().toISOString()
        };
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: "IDX Footprint Alerts",
                avatar_url: "https://stockbit.com/favicon.ico",
                embeds: [embed]
            })
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Discord HTTP ${res.status}: ${txt}`);
        }
        return { success: true };
    }

    const color = payload.status === 'broken' ? TIER_COLORS.broken : (TIER_COLORS[payload.priorityTier] || 0x2962FF);
    const statusIcon = payload.status === 'testing' ? '🎯' : (payload.status === 'broken' ? '⚠️' : '🛡️');
    const statusLabel = payload.status === 'testing' ? 'TESTING SUPPORT NOW' : (payload.status === 'broken' ? 'SUPPORT BROKEN' : 'HOLDING ABOVE SUPPORT');
    const chgSign = (payload.changePercent >= 0 ? '+' : '');
    const priceFormatted = `Rp ${Number(payload.price).toLocaleString('id-ID')} (${chgSign}${Number(payload.changePercent).toFixed(2)}%)`;

    let supportDesc = payload.supportLabel || 'Support Level';
    if (payload.isZone && payload.zoneBottom && payload.zoneTop) {
        supportDesc = `Demand Zone [${payload.zoneBottom} - ${payload.zoneTop}]`;
    }

    const distSign = (payload.distanceTicks || 0) >= 0 ? '+' : '';
    const distanceDesc = `${distSign}${payload.distanceTicks || 0} ticks (${((payload.distancePercent || 0) >= 0 ? '+' : '')}${Number(payload.distancePercent || 0).toFixed(1)}%)`;

    function formatMovementEntryDiscord(entry, fallback) {
        if (!entry || !entry.time) return fallback;
        const sign = (entry.changePercent || 0) >= 0 ? '+' : '';
        const stText = entry.status ? ` (${entry.status})` : '';
        return `\`${entry.time}\` • Rp ${Number(entry.price).toLocaleString('id-ID')} (${sign}${Number(entry.changePercent).toFixed(2)}%) • ${entry.label || 'Support'}${stText}`;
    }

    const firstEntryStr = formatMovementEntryDiscord(payload.firstTouch, "Belum ada sentuhan hari ini");
    const prevEntryStr = formatMovementEntryDiscord(payload.prevAlert, "None (Initial Touch Today)");
    const currEntryStr = formatMovementEntryDiscord(payload.currentAlert, `\`${payload.time || 'Now'}\` • Rp ${Number(payload.price).toLocaleString('id-ID')} (${chgSign}${Number(payload.changePercent).toFixed(2)}%) • ${supportDesc} (${payload.status})`);
    const movementLogVal = `1️⃣ **First:** ${firstEntryStr}\n2️⃣ **Prev:** ${prevEntryStr}\n3️⃣ **Now:** ${currEntryStr}`;

    const embed = {
        title: `${statusIcon} [${payload.symbol}] ${statusLabel}`,
        description: `Follow Through stock **$${payload.symbol}** is interacting with **${supportDesc}**.`,
        color: color,
        fields: [
            { name: "🏷️ Current Price", value: priceFormatted, inline: true },
            { name: "🛡️ Primary Support", value: `Tier ${payload.priorityTier}: ${supportDesc}`, inline: true },
            { name: "📏 Distance", value: distanceDesc, inline: true },
            { name: "📈 Ghost ARA / ARB", value: `ARA: Rp ${Number(payload.araPrice || 0).toLocaleString('id-ID')} | ARB: Rp ${Number(payload.arbPrice || 0).toLocaleString('id-ID')}`, inline: false },
            { name: "📋 Movement Log (Hari Ini)", value: movementLogVal, inline: false },
            { name: "🕒 Waktu", value: `${payload.time || new Date().toLocaleTimeString('id-ID') + ' WIB'}`, inline: true }
        ],
        footer: { text: "IDX Footprint Chart • Follow Through Stream" },
        timestamp: new Date().toISOString()
    };

    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: "IDX Footprint Alerts",
            avatar_url: "https://stockbit.com/favicon.ico",
            embeds: [embed]
        })
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Discord HTTP ${res.status}: ${txt}`);
    }
    return { success: true };
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMovementEntryTelegram(entry, fallback) {
    if (!entry || !entry.time) return `<i>${fallback}</i>`;
    const sign = (entry.changePercent || 0) >= 0 ? '+' : '';
    const stText = entry.status ? ` [${escapeHtml(entry.status.toUpperCase())}]` : '';
    return `<code>${escapeHtml(entry.time)}</code> • Rp ${Number(entry.price).toLocaleString('id-ID')} (<code>${sign}${Number(entry.changePercent).toFixed(2)}%</code>) • ${escapeHtml(entry.label || 'Support')}${stText}`;
}

async function sendTelegramAlert(payload, isTest = false) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        return { success: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in .env' };
    }

    let text = '';
    if (isTest) {
        text = `🔔 <b>[TEST ALERT] Telegram Alert Stream Connected!</b>\n\n` +
               `Test notification from <b>IDX Footprint Chart & Follow Through Alert System</b>.\n` +
               `Status: ✅ Online & Operating Correctly\n` +
               `🕒 Waktu: <code>${new Date().toLocaleTimeString('id-ID')} WIB</code>`;
    } else if (payload.alertType === 'volume_breakout') {
        const isFull = (payload.ratioPercent || 0) >= 100;
        const icon = isFull ? '🔥' : '⚡';
        const chgSign = ((payload.changePercent || 0) >= 0 ? '+' : '');
        const priceStr = `Rp ${Number(payload.price || 0).toLocaleString('id-ID')} (<code>${chgSign}${Number(payload.changePercent || 0).toFixed(2)}%</code>)`;
        const paceTitle = payload.paceLabel || '20D Volume Breakout';

        text = `${icon} <b>VOLUME BREAKOUT ALERT: $${escapeHtml(payload.symbol)}</b>\n\n` +
               `⚡ <b>Status:</b> <code>${escapeHtml(paceTitle)}</code>\n` +
               `🏷️ <b>Harga:</b> ${priceStr}\n` +
               `📊 <b>Volume Hari Ini:</b> <code>${Number(payload.intradayLot || 0).toLocaleString('id-ID')} Lot</code>\n` +
               `📈 <b>Rata-rata 20D:</b> <code>${Number(payload.volSma20 || 0).toLocaleString('id-ID')} Lot</code> (<b>${Number(payload.ratioPercent || 0).toFixed(1)}%</b>)\n` +
               `🕒 <b>Waktu Terdeteksi:</b> <code>${escapeHtml(payload.crossedAtTime || new Date().toLocaleTimeString('id-ID') + ' WIB')}</code>\n\n` +
               `#${payload.symbol} #IDX #VolumeBreakout`;
    } else {
        const statusIcon = payload.status === 'testing' ? '🎯' : (payload.status === 'broken' ? '⚠️' : '🛡️');
        const statusLabel = payload.status === 'testing' ? 'TESTING SUPPORT NOW' : (payload.status === 'broken' ? 'SUPPORT BROKEN' : 'HOLDING ABOVE SUPPORT');
        const chgSign = (payload.changePercent >= 0 ? '+' : '');
        const priceStr = `Rp ${Number(payload.price).toLocaleString('id-ID')} (<code>${chgSign}${Number(payload.changePercent).toFixed(2)}%</code>)`;
        
        let supportDesc = payload.supportLabel || 'Support Level';
        if (payload.isZone && payload.zoneBottom && payload.zoneTop) {
            supportDesc = `Demand Zone [${payload.zoneBottom} - ${payload.zoneTop}]`;
        }
        const distSign = (payload.distanceTicks || 0) >= 0 ? '+' : '';
        const distStr = `${distSign}${payload.distanceTicks || 0} ticks (${((payload.distancePercent || 0) >= 0 ? '+' : '')}${Number(payload.distancePercent || 0).toFixed(1)}%)`;
        const ghostStr = `ARA: Rp ${Number(payload.araPrice || 0).toLocaleString('id-ID')} | ARB: Rp ${Number(payload.arbPrice || 0).toLocaleString('id-ID')}`;

        const firstTgStr = formatMovementEntryTelegram(payload.firstTouch, "Belum ada sentuhan hari ini");
        const prevTgStr = formatMovementEntryTelegram(payload.prevAlert, "None (Initial Touch Today)");
        const currTgStr = formatMovementEntryTelegram(payload.currentAlert, `${payload.time || 'Now'} • Rp ${Number(payload.price).toLocaleString('id-ID')} (${chgSign}${Number(payload.changePercent).toFixed(2)}%) • ${supportDesc} [${(payload.status || '').toUpperCase()}]`);

        text = `${statusIcon} <b>FOLLOW THROUGH ALERT: $${payload.symbol}</b>\n\n` +
               `⚡ <b>Status:</b> <code>${statusLabel}</code>\n` +
               `🏷️ <b>Harga:</b> ${priceStr}\n` +
               `🛡️ <b>Level:</b> Priority ${payload.priorityTier} (${escapeHtml(supportDesc)})\n` +
               `📏 <b>Jarak:</b> <code>${distStr}</code>\n` +
               `📈 <b>Ghost Limits:</b> ${ghostStr}\n` +
               `🕒 <b>Waktu:</b> ${payload.time || new Date().toLocaleTimeString('id-ID') + ' WIB'}\n\n` +
               `📋 <b>Movement Log (Hari Ini):</b>\n` +
               `1️⃣ <b>First:</b> ${firstTgStr}\n` +
               `2️⃣ <b>Prev:</b> ${prevTgStr}\n` +
               `3️⃣ <b>Now:</b> ${currTgStr}\n\n` +
               `#${payload.symbol} #IDX #SupportAlert`;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        })
    });

    const respJson = await res.json();
    if (!res.ok || !respJson.ok) {
        throw new Error(`Telegram API Error: ${respJson.description || res.statusText}`);
    }
    return { success: true };
}

// Parse CLI flags
const args = process.argv.slice(2);
let cliKey = '';
let cliPort = 8765;
let cliUpstream = '';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) {
        cliKey = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
        cliPort = parseInt(args[++i], 10);
    } else if (args[i] === '--upstream' && args[i + 1]) {
        cliUpstream = args[++i];
    }
}

const LOCAL_PORT = cliPort || parseInt(process.env.LOCAL_WS_PORT || '8765', 10);
const UPSTREAM_URL = cliUpstream || process.env.UPSTREAM_WS_URL || 'wss://stock.arjum.com/ws/running-trade';
let API_KEY = cliKey || process.env.STOCK_API_KEY || process.env.IDX_API_KEY || process.env.ARJUM_API_KEY || '';

const localWss = new WebSocketServer({ port: LOCAL_PORT });

console.log(`\n======================================================`);
console.log(` [LIVE IDX RUNNING TRADES BRIDGE]`);
console.log(` Local Server : ws://localhost:${LOCAL_PORT}`);
console.log(` Upstream URL : ${UPSTREAM_URL}`);
console.log(` API Key      : ${API_KEY ? `${API_KEY.slice(0, 12)}•••••••• (${API_KEY.length} chars)` : '(none configured)'}`);
console.log(`======================================================\n`);

const UPSTREAM_PING_INTERVAL_MS = 20000; // 20s keep-alive ping to upstream
const UPSTREAM_INACTIVITY_LIMIT_MS = 60000; // 60s without any messages during market trading hours
const CLIENT_PING_INTERVAL_MS = 30000; // 30s local client ping
const HEARTBEAT_BROADCAST_INTERVAL_MS = 10000; // 10s bridge_heartbeat broadcast

const BRIDGE_START_TIME = Date.now();
let upstreamSocket = null;
let reconnectTimer = null;
let upstreamPingTimer = null;
let isUpstreamAlive = true;
let lastUpstreamMessageTimestamp = Date.now();
let lastTradeTimestamp = null;
let totalTradesForwarded = 0;
let totalReconnectCount = 0;
let reconnectAttempts = 0;
const BACKOFF_DELAYS = [1000, 2000, 5000, 10000, 20000];

let latestSnapshot = null;
let latestTop5 = null;
let lastMarketStatus = null;
let lastErrorCode = null;
let lastErrorMessage = '';

function isMarketHoursWIB() {
    // Jakarta is UTC+7
    const now = new Date();
    const wibDate = new Date(now.getTime() + 7 * 3600 * 1000);
    const day = wibDate.getUTCDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
    if (day === 0 || day === 6) return false;

    const wibHours = wibDate.getUTCHours();
    const wibMinutes = wibDate.getUTCMinutes();
    const minutesOfDay = wibHours * 60 + wibMinutes;

    // IDX Trading Schedule:
    // Sesi 1: 08:55 - 12:05 WIB (Senin s/d Jumat tetap selesai jam 12:00)
    // Sesi 2:
    //   Jumat: 13:55 - 16:15 WIB (mulai 14:00)
    //   Senin - Kamis: 13:25 - 16:15 WIB (mulai 13:30)
    if (day === 5) {
        return (minutesOfDay >= 535 && minutesOfDay <= 725) || (minutesOfDay >= 835 && minutesOfDay <= 975);
    } else {
        return (minutesOfDay >= 535 && minutesOfDay <= 725) || (minutesOfDay >= 805 && minutesOfDay <= 975);
    }
}

// =========================================================================
// In-Memory Intraday 1-Minute Accumulator & Today's Daily Candles Storage
// =========================================================================
const intraday1mCache = new Map(); // symbol -> Array of { time, open, high, low, close, volume, levels }
const todayDailyCandles = new Map(); // symbol -> DailyCandleRecord for today (all ihsg_list.csv)

const DATA_TEMP_DIR = path.resolve(process.cwd(), 'data_temp');
const TODAY_CANDLES_FILE = path.join(DATA_TEMP_DIR, 'today_candles.json');
const TODAY_INTRADAY_DIR = path.join(DATA_TEMP_DIR, 'intraday_1m');

function getWibNowSec(timeStr) {
    if (typeof timeStr === 'number' && timeStr > 1e9) {
        return Math.floor(timeStr);
    }
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();

    let h = (utcHours + 7) % 24;
    let m = utcMinutes;
    let s = utcSeconds;

    if (timeStr && typeof timeStr === 'string' && timeStr.includes(':')) {
        const parts = timeStr.split(':');
        if (parts.length >= 2) {
            h = parseInt(parts[0], 10);
            m = parseInt(parts[1], 10);
            s = parts[2] ? parseInt(parts[2], 10) : 0;
        }
    }

    const wibDate = new Date(now.getTime() + 7 * 3600 * 1000);
    const y = wibDate.getUTCFullYear();
    const mo = wibDate.getUTCMonth();
    const d = wibDate.getUTCDate();

    return Math.floor(Date.UTC(y, mo, d, h, m, s) / 1000);
}

function getWibDateString() {
    const now = new Date();
    const wibDate = new Date(now.getTime() + 7 * 3600 * 1000);
    const y = wibDate.getUTCFullYear();
    const mo = String(wibDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(wibDate.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
}

let currentCacheDate = getWibDateString();

// Load rehydrated candles from data_temp/today_candles.json on startup
function loadTodayCandlesFromTemp() {
    try {
        if (!fs.existsSync(DATA_TEMP_DIR)) {
            fs.mkdirSync(DATA_TEMP_DIR, { recursive: true });
        }
        if (fs.existsSync(TODAY_CANDLES_FILE)) {
            const raw = fs.readFileSync(TODAY_CANDLES_FILE, 'utf8');
            const data = JSON.parse(raw);
            const todayStr = getWibDateString();
            if (data && data.date === todayStr && typeof data.candles === 'object') {
                for (const [sym, c] of Object.entries(data.candles)) {
                    todayDailyCandles.set(sym.toUpperCase(), c);
                }
                console.log(`[Bridge] Rehydrated ${todayDailyCandles.size} provisional candles for today (${todayStr}) from data_temp/today_candles.json`);
            } else {
                // Outdated or different date, clean only data_temp/today_candles.json
                console.log(`[Bridge] Purging outdated temporary candles (${data?.date || 'unknown'} -> ${todayStr})...`);
                fs.unlinkSync(TODAY_CANDLES_FILE);
            }
        }
    } catch (err) {
        console.warn('[Bridge] Warning loading data_temp/today_candles.json:', err.message);
    }
}
loadTodayCandlesFromTemp();

// Load rehydrated intraday 1m footprint bars from data_temp/intraday_1m/ on startup
function loadTodayIntradayFromTemp() {
    try {
        if (!fs.existsSync(TODAY_INTRADAY_DIR)) {
            fs.mkdirSync(TODAY_INTRADAY_DIR, { recursive: true });
            return;
        }
        const files = fs.readdirSync(TODAY_INTRADAY_DIR);
        const todayStr = getWibDateString();
        let loadedCount = 0;
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const fullPath = path.join(TODAY_INTRADAY_DIR, file);
            try {
                const raw = fs.readFileSync(fullPath, 'utf8');
                const data = JSON.parse(raw);
                if (data && data.date === todayStr && Array.isArray(data.bars)) {
                    const sym = (data.symbol || file.replace('.json', '')).toUpperCase();
                    intraday1mCache.set(sym, data.bars);
                    loadedCount++;
                } else {
                    // Outdated file from previous session
                    fs.unlinkSync(fullPath);
                }
            } catch (err) {}
        }
        if (loadedCount > 0) {
            console.log(`[Bridge] Rehydrated ${loadedCount} symbols intraday 1M footprint for today (${todayStr}) from data_temp/intraday_1m/`);
        }
    } catch (err) {
        console.warn('[Bridge] Warning loading data_temp/intraday_1m/:', err.message);
    }
}
loadTodayIntradayFromTemp();

let isTempCandlesDirty = false;
const dirtyIntradaySymbols = new Set();
let saveTempCandlesTimer = null;

function scheduleSaveTodayCandles(sym) {
    isTempCandlesDirty = true;
    if (sym) {
        dirtyIntradaySymbols.add(sym.toUpperCase());
    }
    if (!saveTempCandlesTimer) {
        saveTempCandlesTimer = setTimeout(() => {
            saveTempCandlesTimer = null;
            flushTodayCandlesToDisk();
        }, 3000); // 3-second debounce (smooth, 0 CPU, 0 SSD wear)
    }
}

function flushTodayCandlesToDisk() {
    // 1. Flush Daily Candles
    if (isTempCandlesDirty) {
        isTempCandlesDirty = false;
        try {
            if (!fs.existsSync(DATA_TEMP_DIR)) {
                fs.mkdirSync(DATA_TEMP_DIR, { recursive: true });
            }
            const payload = {
                date: getWibDateString(),
                updatedAt: new Date().toISOString(),
                count: todayDailyCandles.size,
                candles: Object.fromEntries(todayDailyCandles)
            };
            fs.writeFileSync(TODAY_CANDLES_FILE, JSON.stringify(payload));
        } catch (e) {
            console.error('[Bridge] Error saving data_temp/today_candles.json:', e.message);
        }
    }

    // 2. Flush Dirty Intraday 1M Footprint Symbols
    if (dirtyIntradaySymbols.size > 0) {
        const symbolsToFlush = Array.from(dirtyIntradaySymbols);
        dirtyIntradaySymbols.clear();
        try {
            if (!fs.existsSync(TODAY_INTRADAY_DIR)) {
                fs.mkdirSync(TODAY_INTRADAY_DIR, { recursive: true });
            }
            const todayStr = getWibDateString();
            for (const sym of symbolsToFlush) {
                const bars = intraday1mCache.get(sym);
                if (bars && bars.length > 0) {
                    const filePath = path.join(TODAY_INTRADAY_DIR, `${sym}.json`);
                    fs.writeFileSync(filePath, JSON.stringify({
                        date: todayStr,
                        symbol: sym,
                        count: bars.length,
                        updatedAt: new Date().toISOString(),
                        bars: bars
                    }));
                }
            }
        } catch (e) {
            console.error('[Bridge] Error saving data_temp/intraday_1m/:', e.message);
        }
    }
}

let hasPurged1615Date = '';

// Strictly purges ONLY data_temp/today_candles.json and data_temp/intraday_1m/ at 16:15 WIB (market close)
function checkAutoPurge1615Wib() {
    const now = new Date();
    // Strict WIB (UTC+7) representation directly from UTC milliseconds
    const wibDate = new Date(now.getTime() + (7 * 3600 * 1000));
    const day = wibDate.getUTCDay(); // 0 is Sun, 6 is Sat, 1-5 is Mon-Fri
    if (day === 0 || day === 6) return;

    const hour = wibDate.getUTCHours();
    const minute = wibDate.getUTCMinutes();
    const minutesOfDay = hour * 60 + minute;
    const todayStr = getWibDateString();

    // 16:15 WIB is 16 * 60 + 15 = 975 minutes
    // Purge window triggers strictly after market close (16:15 WIB until 23:59 WIB)
    if (minutesOfDay >= 975 && hasPurged1615Date !== todayStr) {
        if (todayDailyCandles.size > 0 || intraday1mCache.size > 0 || fs.existsSync(TODAY_CANDLES_FILE) || fs.existsSync(TODAY_INTRADAY_DIR)) {
            console.log(`[Bridge] 16:15 WIB reached (Sesi bursa selesai). Membersihkan HANYA folder data_temp...`);
            todayDailyCandles.clear();
            intraday1mCache.clear();
            dirtyIntradaySymbols.clear();
            hasPurged1615Date = todayStr;
            
            // STRICTLY ONLY DELETE data_temp/today_candles.json
            try {
                if (fs.existsSync(TODAY_CANDLES_FILE)) {
                    fs.unlinkSync(TODAY_CANDLES_FILE);
                    console.log(`[Bridge] Berhasil menghapus file sementara: ${TODAY_CANDLES_FILE}`);
                }
            } catch (err) {
                console.error(`[Bridge] Gagal menghapus ${TODAY_CANDLES_FILE}:`, err.message);
            }

            // Clean data_temp/intraday_1m/
            try {
                if (fs.existsSync(TODAY_INTRADAY_DIR)) {
                    fs.rmSync(TODAY_INTRADAY_DIR, { recursive: true, force: true });
                    fs.mkdirSync(TODAY_INTRADAY_DIR, { recursive: true });
                    console.log(`[Bridge] Berhasil mengosongkan folder sementara: ${TODAY_INTRADAY_DIR}`);
                }
            } catch (err) {
                console.error(`[Bridge] Gagal membersihkan ${TODAY_INTRADAY_DIR}:`, err.message);
            }

            broadcastToClients({ type: 'today_candles_purged', time: '16:15 WIB' });
        }
    }
}

// Check 16:15 WIB purge condition every 15 seconds
setInterval(checkAutoPurge1615Wib, 15000);

function checkAndPurgeIfNewDay() {
    const todayStr = getWibDateString();
    if (currentCacheDate !== todayStr && (intraday1mCache.size > 0 || todayDailyCandles.size > 0)) {
        console.log(`[Bridge] Pergantian hari bursa (${currentCacheDate} -> ${todayStr}). Membersihkan cache hari kemarin.`);
        intraday1mCache.clear();
        todayDailyCandles.clear();
        dirtyIntradaySymbols.clear();
        if (fs.existsSync(TODAY_CANDLES_FILE)) {
            try { fs.unlinkSync(TODAY_CANDLES_FILE); } catch (e) {}
        }
        if (fs.existsSync(TODAY_INTRADAY_DIR)) {
            try {
                fs.rmSync(TODAY_INTRADAY_DIR, { recursive: true, force: true });
                fs.mkdirSync(TODAY_INTRADAY_DIR, { recursive: true });
            } catch (e) {}
        }
        currentCacheDate = todayStr;
    }
}

// Periodic check to auto-purge RAM cache only upon date rollover (every 60s)
setInterval(checkAndPurgeIfNewDay, 60000);

function ingestTradeToIntradayCache(trade) {
    if (!trade) return;
    checkAndPurgeIfNewDay();
    if (trade.market_board && trade.market_board !== 'RG') return;
    const sym = (trade.t || trade.symbol || trade.code || '').toUpperCase();
    if (!sym || (allowedStocksSet.size > 0 && !allowedStocksSet.has(sym))) return;

    const price = Number(trade.p ?? trade.price);
    if (!price || isNaN(price)) return;
    const lot = Number(trade.l ?? trade.lot) || (trade.shares ? Math.round(trade.shares / 100) : 1);
    const isBuy = (trade.c || trade.action || 'BUY').toUpperCase() === 'BUY';
    const timeStr = trade.a || trade.time;
    const timeSec = trade.timeSec || getWibNowSec(timeStr);
    const minuteTs = Math.floor(timeSec / 60) * 60;

    // 1. Ingest into 1-minute bars
    let bars = intraday1mCache.get(sym);
    if (!bars) {
        bars = [];
        intraday1mCache.set(sym, bars);
    }

    const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
    if (lastBar && lastBar.time === minuteTs) {
        lastBar.high = Math.max(lastBar.high, price);
        lastBar.low = Math.min(lastBar.low, price);
        lastBar.close = price;
        lastBar.volume += lot;
        if (!lastBar.levels) lastBar.levels = [];
        let lvl = lastBar.levels.find(l => l.price === price);
        if (!lvl) {
            lvl = { price, bidVolume: isBuy ? 0 : lot, askVolume: isBuy ? lot : 0 };
            lastBar.levels.push(lvl);
            lastBar.levels.sort((a, b) => a.price - b.price);
        } else {
            if (isBuy) lvl.askVolume += lot;
            else lvl.bidVolume += lot;
        }
    } else if (!lastBar || minuteTs > lastBar.time) {
        const newBar = {
            time: minuteTs,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: lot,
            levels: [{
                price,
                bidVolume: isBuy ? 0 : lot,
                askVolume: isBuy ? lot : 0
            }]
        };
        bars.push(newBar);
    }

    // 2. Ingest into Today's Daily Provisional Candle Accumulator (for all ihsg_list.csv)
    const todayDateStr = getWibDateString();
    const d = new Date(timeSec * 1000);
    const dailyTs = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0) / 1000);

    let dailyBar = todayDailyCandles.get(sym);
    if (!dailyBar || dailyBar.dateStr !== todayDateStr) {
        dailyBar = {
            symbol: sym,
            time: dailyTs,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: lot,
            value: price * lot * 100,
            frequency: 1,
            change: Number(trade.chg ?? trade.change ?? 0),
            change_percentage: Number(trade.pc ?? trade.change_percentage ?? 0),
            lastTime: timeStr || new Date().toLocaleTimeString('id-ID'),
            dateStr: todayDateStr
        };
        todayDailyCandles.set(sym, dailyBar);
    } else {
        dailyBar.high = Math.max(dailyBar.high, price);
        dailyBar.low = Math.min(dailyBar.low, price);
        dailyBar.close = price;
        dailyBar.volume += lot;
        dailyBar.value += (price * lot * 100);
        dailyBar.frequency += 1;
        dailyBar.lastTime = timeStr || dailyBar.lastTime;
        if (trade.pc !== undefined) dailyBar.change_percentage = Number(trade.pc);
        if (trade.change !== undefined) dailyBar.change = Number(trade.change);
    }
    scheduleSaveTodayCandles(sym);
}

// Safely terminates a WebSocket removing listeners to prevent duplicate close events
function terminateSocket(ws) {
    if (!ws) return;
    try {
        ws.removeAllListeners();
        ws.on('error', () => {}); // Ignore late errors
        ws.terminate();
    } catch (e) {}
    if (ws === upstreamSocket) {
        upstreamSocket = null;
    }
}

function scheduleReconnect(delay) {
    clearTimeout(reconnectTimer);
    clearInterval(upstreamPingTimer);
    totalReconnectCount++;
    console.log(`[Bridge] Reconnecting to upstream in ${delay / 1000}s... (attempt ${reconnectAttempts + 1}, total reconnects: ${totalReconnectCount})`);
    reconnectTimer = setTimeout(connectUpstream, delay);
}

// Load allowed IHSG stocks whitelist
const allowedStocksSet = new Set();
function loadIhsgWhitelist() {
    try {
        const jsonPath = path.resolve(process.cwd(), 'indicator-examples/public/ihsg_stocks.json');
        if (fs.existsSync(jsonPath)) {
            const list = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            for (const s of list) {
                allowedStocksSet.add(s.toUpperCase().trim());
            }
            console.log(`[Bridge] Loaded ${allowedStocksSet.size} allowed stocks from ihsg_stocks.json`);
            return;
        }
    } catch (e) {
        console.warn('[Bridge] Warning loading ihsg_stocks.json:', e.message);
    }

    try {
        const csvPath = path.resolve(process.cwd(), 'ihsg_list.csv');
        if (fs.existsSync(csvPath)) {
            const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
            const INDEX_SET = new Set([
                'IHSG', 'LQ45', 'IDX30', 'IDX80', 'IDXSMC-COM', 'IDXSMC-LIQ', 'IDXHIDIV20', 'IDXBUMN20',
                'IDXG30', 'IDXV30', 'IDXQ30', 'IDXESGL', 'IDXLQ45LCL', 'IDXMESBUMN', 'JII', 'JII70', 'ISSI',
                'KOMPAS100', 'MNC36', 'INVESTOR33', 'BISNIS-27', 'PEFINDO25', 'I-GRADE', 'SMINFRA18',
                'SRI-KEHATI', 'IDXPEFINDOPB', 'MBX', 'DBX', 'IDXENERGY', 'IDXBASIC', 'IDXINDUST', 'IDXCYCLIC',
                'IDXNONCYC', 'IDXHEALTH', 'IDXFINANCE', 'IDXPROPERT', 'IDXTECHNO', 'IDXINFRA', 'IDXTRANS', 'SYMBOL'
            ]);
            for (const line of lines) {
                const s = line.trim().toUpperCase();
                if (!s || INDEX_SET.has(s) || s.includes('-') || s.length > 5) continue;
                allowedStocksSet.add(s);
            }
            console.log(`[Bridge] Loaded ${allowedStocksSet.size} allowed stocks from ihsg_list.csv`);
        }
    } catch (e) {
        console.warn('[Bridge] Warning loading ihsg_list.csv:', e.message);
    }
}
loadIhsgWhitelist();

function getStatusPayload() {
    const isConn = upstreamSocket ? upstreamSocket.readyState === WebSocket.OPEN : false;
    return {
        type: 'bridge_status',
        connected: isConn,
        status: upstreamSocket ? (isConn ? 'connected' : 'connecting') : 'disconnected',
        upstreamUrl: UPSTREAM_URL,
        hasKey: !!API_KEY,
        apiKeyMasked: API_KEY ? `${API_KEY.slice(0, 10)}••••••••` : '',
        market: lastMarketStatus,
        allowedStocksCount: allowedStocksSet.size,
        intradayCacheCount: intraday1mCache.size,
        errorCode: lastErrorCode,
        errorMessage: lastErrorMessage,
        alertConfig: getAlertConfig(),
        uptimeSec: Math.floor((Date.now() - BRIDGE_START_TIME) / 1000),
        totalTradesForwarded,
        totalReconnectCount,
        lastTradeAgeSec: lastTradeTimestamp ? Math.floor((Date.now() - lastTradeTimestamp) / 1000) : null
    };
}

function broadcastToClients(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const client of localWss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

function connectUpstream() {
    clearTimeout(reconnectTimer);
    clearInterval(upstreamPingTimer);

    if (upstreamSocket) {
        terminateSocket(upstreamSocket);
    }

    if (!API_KEY) {
        console.warn(`[Bridge] No API key configured. Waiting for API key from client or .env...`);
        lastErrorCode = 4401;
        lastErrorMessage = 'No API key configured. Please set your API key in .env or via the web UI.';
        broadcastToClients(getStatusPayload());
        return;
    }

    console.log(`[Bridge] Connecting to upstream ${UPSTREAM_URL}...`);
    broadcastToClients(getStatusPayload());

    const headers = {
        'X-API-Key': API_KEY
    };

    try {
        upstreamSocket = new WebSocket(UPSTREAM_URL, { headers });

        upstreamSocket.on('open', () => {
            console.log(`[Bridge] Upstream connected! Forwarding live trades with keep-alive heartbeat.`);
            reconnectAttempts = 0;
            lastErrorCode = null;
            lastErrorMessage = '';
            isUpstreamAlive = true;
            lastUpstreamMessageTimestamp = Date.now();
            clearTimeout(reconnectTimer);
            clearInterval(upstreamPingTimer);

            // Start 20s keep-alive ping and inactivity watchdog
            upstreamPingTimer = setInterval(() => {
                if (!upstreamSocket || upstreamSocket.readyState !== WebSocket.OPEN) return;

                // 1. Check if upstream answered our previous ping
                if (!isUpstreamAlive) {
                    console.warn(`[Bridge] Upstream heartbeat timeout (no pong received within 20s). Terminating dead/zombie connection...`);
                    terminateSocket(upstreamSocket);
                    scheduleReconnect(1000);
                    return;
                }

                // 2. Check market hours inactivity (>60s without trade/message during active session)
                const now = Date.now();
                if (isMarketHoursWIB() && (now - lastUpstreamMessageTimestamp > UPSTREAM_INACTIVITY_LIMIT_MS)) {
                    console.warn(`[Bridge] Inactivity timeout during market hours (>60s without data). Refreshing upstream stream...`);
                    terminateSocket(upstreamSocket);
                    scheduleReconnect(1000);
                    return;
                }

                // 3. Send ping frame
                isUpstreamAlive = false;
                try {
                    upstreamSocket.ping();
                } catch (e) {
                    console.warn(`[Bridge] Failed to send ping: ${e.message}`);
                    terminateSocket(upstreamSocket);
                    scheduleReconnect(1000);
                }
            }, UPSTREAM_PING_INTERVAL_MS);

            broadcastToClients(getStatusPayload());
        });

        upstreamSocket.on('pong', () => {
            isUpstreamAlive = true;
            lastUpstreamMessageTimestamp = Date.now();
        });

        upstreamSocket.on('ping', () => {
            isUpstreamAlive = true;
            lastUpstreamMessageTimestamp = Date.now();
            try {
                if (upstreamSocket && upstreamSocket.readyState === WebSocket.OPEN) {
                    upstreamSocket.pong();
                }
            } catch (e) {}
        });

        upstreamSocket.on('message', (data) => {
            isUpstreamAlive = true;
            lastUpstreamMessageTimestamp = Date.now();
            const rawStr = data.toString();
            try {
                const parsed = JSON.parse(rawStr);
                if (parsed.type === 'snapshot') {
                    if (parsed.market) lastMarketStatus = parsed.market;
                    if (Array.isArray(parsed.top) && allowedStocksSet.size > 0) {
                        parsed.top = parsed.top.filter(tp => {
                            const sym = (tp.ticker || tp.symbol || '').toUpperCase();
                            return allowedStocksSet.has(sym);
                        });
                    }
                    if (Array.isArray(parsed.recent) && allowedStocksSet.size > 0) {
                        parsed.recent = parsed.recent.filter(rc => {
                            const sym = (rc.t || rc.symbol || rc.code || '').toUpperCase();
                            return allowedStocksSet.has(sym);
                        });
                    }
                    latestSnapshot = JSON.stringify(parsed);
                    console.log(`[Bridge] Received snapshot (${parsed.recent?.length || 0} trades retained). Market: ${parsed.market?.label || parsed.market?.status || 'active'}`);
                    broadcastToClients(latestSnapshot);
                    return;
                } else if (parsed.type === 'top5') {
                    if (Array.isArray(parsed.top) && allowedStocksSet.size > 0) {
                        parsed.top = parsed.top.filter(tp => {
                            const sym = (tp.ticker || tp.symbol || '').toUpperCase();
                            return allowedStocksSet.has(sym);
                        });
                    }
                    latestTop5 = JSON.stringify(parsed);
                    broadcastToClients(latestTop5);
                    return;
                } else if (parsed.type === 'trade' && parsed.data) {
                    const sym = (parsed.data.t || parsed.data.symbol || parsed.data.code || '').toUpperCase();
                    if (allowedStocksSet.size > 0 && !allowedStocksSet.has(sym)) {
                        return;
                    }
                    ingestTradeToIntradayCache(parsed.data);
                    totalTradesForwarded++;
                    lastTradeTimestamp = Date.now();
                } else if (parsed.symbol || parsed.t || parsed.code) {
                    const sym = (parsed.symbol || parsed.t || parsed.code).toUpperCase();
                    if (allowedStocksSet.size > 0 && !allowedStocksSet.has(sym)) {
                        return;
                    }
                    ingestTradeToIntradayCache(parsed);
                    totalTradesForwarded++;
                    lastTradeTimestamp = Date.now();
                } else if (Array.isArray(parsed) && allowedStocksSet.size > 0) {
                    const filtered = parsed.filter(item => {
                        const sym = (item.t || item.symbol || item.code || '').toUpperCase();
                        return allowedStocksSet.has(sym);
                    });
                    if (filtered.length === 0) return;
                    for (const item of filtered) {
                        ingestTradeToIntradayCache(item);
                    }
                    totalTradesForwarded += filtered.length;
                    lastTradeTimestamp = Date.now();
                    broadcastToClients(JSON.stringify(filtered));
                    return;
                }
            } catch (e) {}

            // Forward to all local browser clients
            broadcastToClients(rawStr);
        });

        upstreamSocket.on('error', (err) => {
            console.warn(`[Bridge] Upstream socket error: ${err.message}`);
            lastErrorMessage = err.message;
        });

        upstreamSocket.on('close', (code, reason) => {
            clearInterval(upstreamPingTimer);
            const reasonStr = reason ? reason.toString() : '';
            lastErrorCode = code;
            let explanation = '';

            if (code === 1000) {
                explanation = 'Normal closure (server session reset / 20-minute cycle). Reconnecting immediately...';
            } else if (code === 4401) {
                explanation = 'Unauthorized / Invalid API Key. Please verify your API key in dashboard.';
            } else if (code === 4403) {
                explanation = 'Forbidden / Paid User Required. Your payment may still be pending confirmation by admin.';
            } else if (code === 4408) {
                explanation = 'Connection Superseded (Takeover). Another connection is active with your account (Max 1 connection per owner).';
            } else {
                explanation = `Connection closed with code ${code} (${reasonStr || 'No reason provided'}).`;
            }

            console.warn(`[Bridge] Upstream disconnected (${code}): ${explanation}`);
            lastErrorMessage = explanation;
            upstreamSocket = null;

            broadcastToClients({
                type: 'bridge_error',
                code,
                reason: reasonStr,
                explanation
            });
            broadcastToClients(getStatusPayload());

            // Handle reconnect strategy
            if (code === 1000) {
                // Immediate fast reconnect after server session expiration
                scheduleReconnect(1000);
            } else if (code === 4401 || code === 4403) {
                console.log(`[Bridge] Auth notice (${code}). Retrying in 30s in case subscription or key updates...`);
                scheduleReconnect(30000);
            } else if (code === 4408) {
                console.log(`[Bridge] Connection takeover (4408). Waiting 15s before reconnecting...`);
                scheduleReconnect(15000);
            } else {
                const delay = BACKOFF_DELAYS[Math.min(reconnectAttempts, BACKOFF_DELAYS.length - 1)];
                reconnectAttempts++;
                scheduleReconnect(delay);
            }
        });
    } catch (err) {
        console.error(`[Bridge] Failed to create upstream WebSocket:`, err);
        lastErrorMessage = err.message;
        scheduleReconnect(2000);
    }
}

// Local client handling
localWss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    console.log(`[Bridge] Local browser connected! (Total clients: ${localWss.clients.size})`);

    // Send immediate status
    ws.send(JSON.stringify(getStatusPayload()));

    // Send cached snapshot and top5 if available
    if (latestSnapshot) {
        ws.send(latestSnapshot);
    }
    if (latestTop5) {
        ws.send(latestTop5);
    }
    // Send today's provisional candles snapshot for all active stocks in ihsg_list.csv
    if (todayDailyCandles.size > 0) {
        ws.send(JSON.stringify({
            type: 'today_candles_snapshot',
            count: todayDailyCandles.size,
            candles: Object.fromEntries(todayDailyCandles)
        }));
    }

    // Handle incoming commands from browser client
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.action === 'set_api_key' && data.apiKey) {
                console.log(`[Bridge] Received API key update from browser client.`);
                API_KEY = data.apiKey.trim();
                saveEnvKey(API_KEY);
                clearTimeout(reconnectTimer);
                reconnectAttempts = 0;
                connectUpstream();
            } else if (data.action === 'reconnect') {
                console.log(`[Bridge] Manual reconnect requested by browser client.`);
                clearTimeout(reconnectTimer);
                reconnectAttempts = 0;
                connectUpstream();
            } else if (data.action === 'get_intraday' && data.symbol) {
                const sym = String(data.symbol).toUpperCase().trim();
                const bars = intraday1mCache.get(sym) || [];
                const todayBar = todayDailyCandles.get(sym) || null;
                ws.send(JSON.stringify({
                    type: 'intraday_snapshot',
                    symbol: sym,
                    bars: bars,
                    todayDailyBar: todayBar
                }));
            } else if (data.action === 'get_today_candle' && data.symbol) {
                const sym = String(data.symbol).toUpperCase().trim();
                const todayBar = todayDailyCandles.get(sym) || null;
                ws.send(JSON.stringify({
                    type: 'today_candle',
                    symbol: sym,
                    candle: todayBar
                }));
            } else if (data.action === 'get_today_candles_all') {
                ws.send(JSON.stringify({
                    type: 'today_candles_snapshot',
                    count: todayDailyCandles.size,
                    candles: Object.fromEntries(todayDailyCandles)
                }));
            } else if (data.action === 'get_status') {
                ws.send(JSON.stringify(getStatusPayload()));
            } else if (data.action === 'get_alert_config') {
                ws.send(JSON.stringify(getAlertConfig()));
            } else if (data.action === 'set_alert_config') {
                const updates = {};
                if (data.discordWebhookUrl !== undefined) updates.DISCORD_WEBHOOK_URL = data.discordWebhookUrl.trim();
                if (data.discordEnabled !== undefined) updates.DISCORD_ALERT_ENABLED = data.discordEnabled ? 'true' : 'false';
                const token = data.telegramToken !== undefined ? data.telegramToken : data.telegramBotToken;
                if (token !== undefined) updates.TELEGRAM_BOT_TOKEN = token.trim();
                if (data.telegramChatId !== undefined) updates.TELEGRAM_CHAT_ID = data.telegramChatId.trim();
                if (data.telegramEnabled !== undefined) updates.TELEGRAM_ALERT_ENABLED = data.telegramEnabled ? 'true' : 'false';
                if (data.supportAlertEnabled !== undefined) updates.SUPPORT_ALERT_ENABLED = data.supportAlertEnabled ? 'true' : 'false';
                if (data.volumeAlertEnabled !== undefined) updates.VOLUME_ALERT_ENABLED = data.volumeAlertEnabled ? 'true' : 'false';
                if (data.cooldownMinutes !== undefined) updates.ALERT_COOLDOWN_MINUTES = String(data.cooldownMinutes);
                saveEnvConfig(updates);
                const cfg = getAlertConfig();
                broadcastToClients(JSON.stringify(cfg));
                ws.send(JSON.stringify({ type: 'alert_config_saved', success: true, config: cfg }));
            } else if (data.action === 'test_alert') {
                const channel = data.channel || 'all';
                console.log(`[Bridge] Testing alert stream for channel: ${channel}`);
                let discordSuccess = false, discordError = null;
                let telegramSuccess = false, telegramError = null;

                if (channel === 'discord' || channel === 'all') {
                    try {
                        const res = await sendDiscordAlert(null, true);
                        discordSuccess = res.success;
                        if (!res.success) discordError = res.error;
                    } catch (e) {
                        discordError = e.message;
                    }
                }
                if (channel === 'telegram' || channel === 'all') {
                    try {
                        const res = await sendTelegramAlert(null, true);
                        telegramSuccess = res.success;
                        if (!res.success) telegramError = res.error;
                    } catch (e) {
                        telegramError = e.message;
                    }
                }
                ws.send(JSON.stringify({
                    type: 'alert_test_result',
                    channel,
                    discord: { success: discordSuccess, error: discordError },
                    telegram: { success: telegramSuccess, error: telegramError }
                }));
            } else if ((data.action === 'dispatch_alert' || data.action === 'dispatch_volume_alert') && data.payload) {
                const payload = data.payload;
                const isVol = payload.alertType === 'volume_breakout' || data.action === 'dispatch_volume_alert';

                if (isVol && process.env.VOLUME_ALERT_ENABLED === 'false') {
                    console.log(`[Bridge] Skipping Volume Breakout alert for $${payload.symbol} (VOLUME_ALERT_ENABLED is false).`);
                    return;
                }
                if (!isVol && process.env.SUPPORT_ALERT_ENABLED === 'false') {
                    console.log(`[Bridge] Skipping Support alert for $${payload.symbol} (SUPPORT_ALERT_ENABLED is false).`);
                    return;
                }

                if (isVol) {
                    console.log(`[Bridge] Dispatching 20D Volume Breakout alert for $${payload.symbol} (${payload.ratioPercent}%)...`);
                } else {
                    console.log(`[Bridge] Dispatching Follow Through alert for $${payload.symbol} (${payload.status})...`);
                }
                let discordSent = false, telegramSent = false;
                let discordErr = null, telegramErr = null;

                if (process.env.DISCORD_ALERT_ENABLED !== 'false' && process.env.DISCORD_WEBHOOK_URL) {
                    try {
                        await sendDiscordAlert(payload, false);
                        discordSent = true;
                    } catch (e) {
                        discordErr = e.message;
                        console.error(`[Bridge] Discord alert error for $${payload.symbol}:`, e.message);
                    }
                }
                if (process.env.TELEGRAM_ALERT_ENABLED !== 'false' && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                    try {
                        await sendTelegramAlert(payload, false);
                        telegramSent = true;
                    } catch (e) {
                        telegramErr = e.message;
                        console.error(`[Bridge] Telegram alert error for $${payload.symbol}:`, e.message);
                    }
                }
                ws.send(JSON.stringify({
                    type: 'alert_dispatch_result',
                    symbol: payload.symbol,
                    discord: { sent: discordSent, error: discordErr },
                    telegram: { sent: telegramSent, error: telegramErr }
                }));
            }
        } catch (e) {
            console.warn(`[Bridge] Error parsing message from local client:`, e.message);
        }
    });

    ws.on('close', () => {
        console.log(`[Bridge] Local browser disconnected. (Remaining: ${localWss.clients.size})`);
    });
});

// Periodic heartbeat broadcast to local browser clients (every 10s)
setInterval(() => {
    const isConn = upstreamSocket ? upstreamSocket.readyState === WebSocket.OPEN : false;
    const hbPayload = JSON.stringify({
        type: 'bridge_heartbeat',
        uptimeSec: Math.floor((Date.now() - BRIDGE_START_TIME) / 1000),
        upstreamConnected: isConn,
        upstreamStatus: upstreamSocket ? (isConn ? 'connected' : 'connecting') : 'disconnected',
        lastTradeAgeSec: lastTradeTimestamp ? Math.floor((Date.now() - lastTradeTimestamp) / 1000) : null,
        lastMessageAgeSec: Math.floor((Date.now() - lastUpstreamMessageTimestamp) / 1000),
        totalTradesForwarded,
        totalReconnectCount,
        clientCount: localWss.clients.size,
        errorCode: lastErrorCode
    });
    broadcastToClients(hbPayload);
}, HEARTBEAT_BROADCAST_INTERVAL_MS);

// Prune disconnected/stale local browser sockets (every 30s)
setInterval(() => {
    for (const ws of localWss.clients) {
        if (ws.isAlive === false) {
            try { ws.terminate(); } catch (e) {}
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch (e) {
            try { ws.terminate(); } catch (err) {}
        }
    }
}, CLIENT_PING_INTERVAL_MS);

// Initial upstream connection
connectUpstream();

