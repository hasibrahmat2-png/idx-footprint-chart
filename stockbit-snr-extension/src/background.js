/**
 * Stockbit SNR - Background Service Worker (Manifest V3)
 * Handles privileged cross-origin API requests to exodus.stockbit.com using host_permissions.
 */

const VERIFIED_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImExNWQ5OGE2LTdkYzgtNDM3NS05NDk0LTEyOWJlM2RlODVkNCIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InVzZSI6Ikhhc2liUmFobWF0IiwiZW1hIjoiaGFzaWJtYXVsYW5hcmFobWF0QGdtYWlsLmNvbSIsImZ1bCI6IkFzYURlbiIsInNlcyI6IlIwc0RZTHhtdW90SzhKSG8iLCJkdmMiOiI4MmViY2NmZTY5NjcwZDcxNzI3YmU5MGFjZmZmMGJiMiIsInVpZCI6NTg2MjkzMSwiY291IjoiRUcifSwiZXhwIjoxNzg4OTg0NzYwLCJpYXQiOjE3ODg4OTgzNjAsImlzcyI6IlNUT0NLQklUIiwianRpIjoiMmFiNTNlYmUtM2RhYy00Y2JiLTg3N2MtMTJkMGIxMmI3YjJhIiwibmJmIjoxNzg4ODk4MzYwLCJ2ZXIiOiJ2MSJ9.H-YqMeNl4zg_9s7lE1mt6eVe6QwB5PYes9VyTRBafKJ3yR6HM8uea9vsUerLOmFAcpDA23syYtiC2ZxmOfmHH4XyZz0rsBdmKsuGrw2I75BWQgroDLbgcTWI8yWpi8n6ovWqCwStuk3lxtskaj12ow6UtvqY9zIjznNPBkv8UneXu81gH20XZc1qFulTWu0IYU2FGtZcgAau1yLoL4NlvV3tNRhgqqdpeezas_t8pjXAuWSSiFvnyuj5rbBq28GTE_yBfT5rRkBtZGCRAjtHGx6aKbk6HcplnsPxoyAdtTtSJJoNqu-_B-TUgddu2T6f8ewOO9l8MUH7RHg3_jyuwA";

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function isTokenValid(token) {
    if (!token || typeof token !== 'string' || token.length < 30) return false;
    try {
        const clean = token.replace(/^Bearer\s+/i, '').trim();
        const parts = clean.split('.');
        if (parts.length < 2) return false;
        const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(payloadStr);
        if (payload.exp && (payload.exp * 1000) <= (Date.now() + 30000)) {
            return false; // Expired or expiring within 30s
        }
        return true;
    } catch (_) {
        return false;
    }
}

async function getCookieToken() {
    try {
        if (chrome.cookies && chrome.cookies.getAll) {
            const cookies = await chrome.cookies.getAll({ domain: 'stockbit.com' });
            for (const c of cookies) {
                if (c.value && isTokenValid(c.value)) {
                    return c.value;
                }
            }
        }
    } catch (_) {}
    return null;
}

async function fetchDailyCandles(symbol, token, targetBars = 100) {
    let activeToken = token;
    if (!isTokenValid(activeToken)) {
        activeToken = await getCookieToken();
    }
    if (!isTokenValid(activeToken) && isTokenValid(VERIFIED_TOKEN)) {
        activeToken = VERIFIED_TOKEN;
    }

    if (!isTokenValid(activeToken)) {
        throw new Error('TOKEN_EXPIRED: Akses token Stockbit kedaluwarsa atau belum login.');
    }

    const today = formatDate(new Date());
    const limit = 50;
    const maxPages = Math.ceil(targetBars / limit);
    let allRawItems = [];

    for (let page = 1; page <= maxPages; page++) {
        const url = `https://exodus.stockbit.com/company-price-feed/historical/summary/${symbol}?period=HS_PERIOD_DAILY&end_date=${today}&limit=${limit}&page=${page}`;
        const resp = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${activeToken.replace(/^Bearer\s+/i, '')}`,
                'Origin': 'https://stockbit.com',
                'Referer': 'https://stockbit.com/'
            }
        });

        if (!resp.ok) {
            const errText = await resp.text();
            if (resp.status === 401 || resp.status === 403) {
                throw new Error(`TOKEN_EXPIRED: Akses token kedaluwarsa (${resp.status})`);
            }
            throw new Error(`Exodus API HTTP ${resp.status}: ${errText.slice(0, 100)}`);
        }

        const json = await resp.json();
        const dataArr = json?.data?.result || json?.data?.price_feed || (Array.isArray(json?.data) ? json.data : []);
        if (!Array.isArray(dataArr) || dataArr.length === 0) break;
        allRawItems = allRawItems.concat(dataArr);
        if (dataArr.length < limit) break;
    }

    if (allRawItems.length === 0) {
        throw new Error('No candle items returned from Stockbit API');
    }

    allRawItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return allRawItems.map(item => ({
        time: item.date,
        open: Number(item.open !== undefined ? item.open : item.close),
        high: Number(item.high !== undefined ? item.high : item.close),
        low: Number(item.low !== undefined ? item.low : item.close),
        close: Number(item.close),
        volume: Number(item.volume || 0),
        value: Number(item.value || 0)
    })).filter(c => !isNaN(c.close) && c.close > 0);
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FETCH_STOCKBIT_CANDLES') {
        fetchDailyCandles(msg.symbol, msg.token, msg.targetBars)
            .then(candles => sendResponse({ success: true, candles }))
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep channel open for async response
    }
});

console.log('[Stockbit SNR Background] Service worker active.');
