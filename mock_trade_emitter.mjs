/**
 * mock_trade_emitter.mjs - Real-Time IDX Running Trades WebSocket Streamer
 * 
 * Replays tick-level trades from KAQI, GRPH, ICON running trade CSVs
 * and generates live active market ticks across screener stocks.
 * Broadcasts on ws://localhost:8765 for the TypeScript charting frontend.
 */

import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const PORT = 8765;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n======================================================`);
console.log(` [LIVE RUNNING TRADES SIMULATOR]`);
console.log(` WebSocket Server listening on ws://localhost:${PORT}`);
console.log(`======================================================\n`);

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
        } catch (e) {}
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
        console.log(`[Simulator] Saved config to ${envPath}`);
    } catch (e) {
        console.error('[Simulator] Failed to save config to .env:', e.message);
    }
}

function getAlertConfig() {
    const discordUrl = process.env.DISCORD_WEBHOOK_URL || '';
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
    const discordEnabled = process.env.DISCORD_ALERT_ENABLED !== 'false';
    const telegramEnabled = process.env.TELEGRAM_ALERT_ENABLED !== 'false';
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
        cooldownMinutes
    };
}

const TIER_COLORS = {
    1: 0x00C853,
    2: 0x2962FF,
    3: 0xFFB300,
    broken: 0xD50000
};

async function sendDiscordAlert(payload, isTest = false) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return { success: false, error: 'DISCORD_WEBHOOK_URL not configured' };

    if (isTest) {
        const body = {
            username: "IDX Footprint Alerts (Simulator)",
            avatar_url: "https://stockbit.com/favicon.ico",
            embeds: [{
                title: "🔔 [TEST ALERT] Discord Alert Stream Connected!",
                description: "Test notification from **IDX Footprint Chart & Follow Through Alert System (Simulator)**.\nYour Discord webhook is configured and working properly.",
                color: 0x2962FF,
                fields: [
                    { name: "Channel Status", value: "✅ Online & Listening", inline: true },
                    { name: "Timestamp", value: new Date().toLocaleTimeString('id-ID') + ' WIB', inline: true }
                ],
                footer: { text: "IDX Footprint Chart • Simulator Mode" },
                timestamp: new Date().toISOString()
            }]
        };
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
    }

    if (payload.alertType === 'volume_breakout') {
        const isFull = (payload.ratioPercent || 0) >= 100;
        const statusColor = isFull ? 0xFF6D00 : 0x00B0FF;
        const icon = isFull ? '🔥' : '⚡';
        const chgSign = ((payload.changePercent || 0) >= 0 ? '+' : '');
        const priceFormatted = `Rp ${Number(payload.price || 0).toLocaleString('id-ID')} (${chgSign}${Number(payload.changePercent || 0).toFixed(2)}%)`;
        const embed = {
            title: `${icon} [${payload.symbol}] ${payload.paceLabel || '20D Volume Breakout'} (Simulator)`,
            description: `Stock **$${payload.symbol}** surged past 20-Day SMA Volume benchmark: **${Number(payload.ratioPercent || 0).toFixed(1)}%**!`,
            color: statusColor,
            fields: [
                { name: "🏷️ Current Price", value: priceFormatted, inline: true },
                { name: "📊 Volume Hari Ini", value: `${Number(payload.intradayLot || 0).toLocaleString('id-ID')} Lot`, inline: true },
                { name: "📈 20D SMA Volume", value: `${Number(payload.volSma20 || 0).toLocaleString('id-ID')} Lot`, inline: true },
                { name: "⚡ RVOL Ratio", value: `${Number(payload.ratioPercent || 0).toFixed(1)}%`, inline: true },
                { name: "🕒 Jam Terdeteksi", value: `${payload.crossedAtTime || new Date().toLocaleTimeString('id-ID') + ' WIB'}`, inline: true }
            ],
            footer: { text: "IDX Footprint Chart • 20D Volume Alert (Simulator)" },
            timestamp: new Date().toISOString()
        };
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: "IDX Footprint Alerts (Simulator)",
                avatar_url: "https://stockbit.com/favicon.ico",
                embeds: [embed]
            })
        });
        if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
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
    if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
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
    if (!token || !chatId) return { success: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured' };

    let text = '';
    if (isTest) {
        text = `🔔 <b>[TEST ALERT] Telegram Alert Stream Connected!</b>\n\n` +
               `Test notification from <b>IDX Footprint Chart & Follow Through Alert System (Simulator)</b>.\n` +
               `Status: ✅ Online & Operating Correctly\n` +
               `🕒 Waktu: <code>${new Date().toLocaleTimeString('id-ID')} WIB</code>`;
    } else if (payload.alertType === 'volume_breakout') {
        const isFull = (payload.ratioPercent || 0) >= 100;
        const icon = isFull ? '🔥' : '⚡';
        const chgSign = ((payload.changePercent || 0) >= 0 ? '+' : '');
        const priceStr = `Rp ${Number(payload.price || 0).toLocaleString('id-ID')} (<code>${chgSign}${Number(payload.changePercent || 0).toFixed(2)}%</code>)`;
        const paceTitle = payload.paceLabel || '20D Volume Breakout';

        text = `${icon} <b>VOLUME BREAKOUT ALERT: $${escapeHtml(payload.symbol)} (Simulator)</b>\n\n` +
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
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        })
    });
    const respJson = await res.json();
    if (!res.ok || !respJson.ok) throw new Error(`Telegram API Error: ${respJson.description || res.statusText}`);
    return { success: true };
}

// Load allowed IHSG stocks whitelist
const allowedStocksSet = new Set();
try {
    const jsonPath = 'indicator-examples/public/ihsg_stocks.json';
    if (fs.existsSync(jsonPath)) {
        const list = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        for (const s of list) allowedStocksSet.add(s.toUpperCase().trim());
        console.log(`[Simulator] Loaded ${allowedStocksSet.size} allowed stocks from ihsg_stocks.json`);
    }
} catch (e) {
    console.warn('[Simulator] Could not load ihsg_stocks.json:', e.message);
}

// 1. Load active symbols from screener_data.json (filtered strictly to IHSG stocks)
let screenerSymbols = [];
try {
    const raw = fs.readFileSync('indicator-examples/public/screener_data.json', 'utf8');
    const screener = JSON.parse(raw);
    const validStocks = allowedStocksSet.size > 0 
        ? screener.filter(item => allowedStocksSet.has(item.symbol.toUpperCase()))
        : screener;
    screenerSymbols = validStocks.slice(0, 30); // Top 30 active IHSG symbols
    console.log(`Loaded ${screenerSymbols.length} active symbols from screener_data.json (strictly IHSG stocks)`);
} catch (e) {
    console.warn("Could not load screener_data.json, using default pool:", e.message);
    screenerSymbols = [
        { symbol: 'KAQI', price: 102 },
        { symbol: 'AKSI', price: 324 },
        { symbol: 'BUMI', price: 210 },
        { symbol: 'BULL', price: 436 },
        { symbol: 'INET', price: 366 },
        { symbol: 'ELIT', price: 280 },
        { symbol: 'FOLK', price: 187 },
        { symbol: 'GZCO', price: 199 },
        { symbol: 'COCO', price: 132 },
        { symbol: 'BIPI', price: 146 }
    ];
}

// 2. Load real historical KAQI running trade ticks
const realKaqiTrades = [];
async function loadKaqiTrades() {
    const dir = 'KAQI_running_trades';
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort();
    if (files.length === 0) return;
    
    // Pick the most recent CSV file
    const targetFile = path.join(dir, files[files.length - 1]);
    console.log(`Reading historical ticks from ${targetFile}...`);
    
    const fileStream = fs.createReadStream(targetFile);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    
    let header = null;
    for await (const line of rl) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (!header) {
            header = parts;
            continue;
        }
        
        const priceIdx = header.indexOf('price');
        const lotIdx = header.indexOf('lot');
        const actionIdx = header.indexOf('action');
        const boardIdx = header.indexOf('market_board');
        
        const board = boardIdx !== -1 ? parts[boardIdx] : 'RG';
        if (board !== 'RG') continue;
        
        const price = parseFloat(parts[priceIdx]);
        const lot = parseInt(parts[lotIdx], 10);
        const action = actionIdx !== -1 ? parts[actionIdx] : 'BUY';
        
        if (!isNaN(price) && !isNaN(lot)) {
            realKaqiTrades.push({
                symbol: 'KAQI',
                price,
                lot,
                action: action.toUpperCase(),
                market_board: 'RG'
            });
        }
    }
    console.log(`Loaded ${realKaqiTrades.length} real ticks for KAQI.`);
}

await loadKaqiTrades();

function getIdxTickSize(price) {
    if (price < 200) return 1;
    if (price < 500) return 2;
    if (price < 2000) return 5;
    if (price < 5000) return 10;
    return 25;
}

const intraday1mCache = new Map();

function ingestTradeToIntradayCache(trade) {
    if (!trade) return;
    const sym = (trade.symbol || trade.t || trade.code || '').toUpperCase();
    if (!sym) return;

    const price = Number(trade.price ?? trade.p);
    if (!price || isNaN(price)) return;
    const lot = Number(trade.lot ?? trade.l) || 1;
    const isBuy = (trade.action || trade.c || 'BUY').toUpperCase() === 'BUY';
    const timeSec = Number(trade.time) || Math.floor(Date.now() / 1000);
    const minuteTs = Math.floor(timeSec / 60) * 60;

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
        bars.push({
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
        });
    }
}

// Broadcast function to all active clients
function broadcast(tick) {
    ingestTradeToIntradayCache(tick);
    const payload = JSON.stringify(tick);
    for (const client of wss.clients) {
        if (client.readyState === 1) { // OPEN
            client.send(payload);
        }
    }
}

wss.on('connection', (ws) => {
    console.log(`[WebSocket] Browser client connected! (Active clients: ${wss.clients.size})`);
    
    // Send immediate alert configuration
    ws.send(JSON.stringify(getAlertConfig()));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.action === 'get_alert_config') {
                ws.send(JSON.stringify(getAlertConfig()));
            } else if (data.action === 'set_alert_config') {
                const updates = {};
                if (data.discordWebhookUrl !== undefined) updates.DISCORD_WEBHOOK_URL = data.discordWebhookUrl.trim();
                if (data.discordEnabled !== undefined) updates.DISCORD_ALERT_ENABLED = data.discordEnabled ? 'true' : 'false';
                const token = data.telegramToken !== undefined ? data.telegramToken : data.telegramBotToken;
                if (token !== undefined) updates.TELEGRAM_BOT_TOKEN = token.trim();
                if (data.telegramChatId !== undefined) updates.TELEGRAM_CHAT_ID = data.telegramChatId.trim();
                if (data.telegramEnabled !== undefined) updates.TELEGRAM_ALERT_ENABLED = data.telegramEnabled ? 'true' : 'false';
                if (data.cooldownMinutes !== undefined) updates.ALERT_COOLDOWN_MINUTES = String(data.cooldownMinutes);
                saveEnvConfig(updates);
                const cfg = getAlertConfig();
                for (const cl of wss.clients) {
                    if (cl.readyState === 1) cl.send(JSON.stringify(cfg));
                }
                ws.send(JSON.stringify({ type: 'alert_config_saved', success: true, config: cfg }));
            } else if (data.action === 'test_alert') {
                const channel = data.channel || 'all';
                console.log(`[Simulator] Testing alert stream for channel: ${channel}`);
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
                if (isVol) {
                    console.log(`[Simulator] Dispatching 20D Volume Breakout alert for $${payload.symbol} (${payload.ratioPercent}%)...`);
                } else {
                    console.log(`[Simulator] Dispatching Follow Through alert for $${payload.symbol} (${payload.status})...`);
                }
                let discordSent = false, telegramSent = false;
                let discordErr = null, telegramErr = null;

                if (process.env.DISCORD_ALERT_ENABLED !== 'false' && process.env.DISCORD_WEBHOOK_URL) {
                    try {
                        await sendDiscordAlert(payload, false);
                        discordSent = true;
                    } catch (e) {
                        discordErr = e.message;
                        console.error(`[Simulator] Discord alert error for $${payload.symbol}:`, e.message);
                    }
                }
                if (process.env.TELEGRAM_ALERT_ENABLED !== 'false' && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                    try {
                        await sendTelegramAlert(payload, false);
                        telegramSent = true;
                    } catch (e) {
                        telegramErr = e.message;
                        console.error(`[Simulator] Telegram alert error for $${payload.symbol}:`, e.message);
                    }
                }
                ws.send(JSON.stringify({
                    type: 'alert_dispatch_result',
                    symbol: payload.symbol,
                    discord: { sent: discordSent, error: discordErr },
                    telegram: { sent: telegramSent, error: telegramErr }
                }));
            } else if (data.action === 'get_intraday' && data.symbol) {
                const sym = String(data.symbol).toUpperCase().trim();
                const bars = intraday1mCache.get(sym) || [];
                ws.send(JSON.stringify({
                    type: 'intraday_snapshot',
                    symbol: sym,
                    bars: bars
                }));
            }
        } catch (e) {
            console.warn(`[Simulator] Error parsing message:`, e.message);
        }
    });

    ws.on('close', () => {
        console.log(`[WebSocket] Browser client disconnected. (Remaining: ${wss.clients.size})`);
    });
});

let kaqiIndex = 0;
let ticksEmitted = 0;

// Main streaming loop: Emits realistic continuous trades
setInterval(() => {
    if (wss.clients.size === 0) return;
    
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Emit real KAQI trade
    if (realKaqiTrades.length > 0) {
        const trade = realKaqiTrades[kaqiIndex % realKaqiTrades.length];
        kaqiIndex++;
        
        broadcast({
            ...trade,
            time: nowSec
        });
        ticksEmitted++;
    }

    // 2. Emit randomized screener market trades (simulate 5-10 market trades per cycle)
    const randomCount = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < randomCount; i++) {
        const item = screenerSymbols[Math.floor(Math.random() * screenerSymbols.length)];
        if (!item || item.symbol === 'KAQI') continue;

        const tickSize = getIdxTickSize(item.price);
        // Fluctuate by +/- 1 tick occasionally
        const move = (Math.random() < 0.25) ? (Math.random() < 0.5 ? tickSize : -tickSize) : 0;
        item.price = Math.max(tickSize, item.price + move);
        
        const action = Math.random() < 0.52 ? 'BUY' : 'SELL';
        const lot = Math.floor(Math.random() * 80) + 5;

        broadcast({
            symbol: item.symbol,
            price: item.price,
            lot,
            action,
            time: nowSec,
            market_board: 'RG'
        });
        ticksEmitted++;
    }

    if (ticksEmitted % 100 === 0) {
        console.log(`[Simulator] Emitted ${ticksEmitted} ticks across market. Connected clients: ${wss.clients.size}`);
    }
}, 250); // Every 250ms (~15-25 trades/sec)
