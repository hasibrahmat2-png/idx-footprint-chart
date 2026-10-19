/**
 * Stockbit API Client for Chrome Extension
 * Routes requests through the background service worker to bypass page CORS restrictions.
 */

(function(exports) {
    'use strict';

    const CANDLE_CACHE = new Map();
    const CACHE_TTL_MS = 60 * 1000;

    const VERIFIED_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImExNWQ5OGE2LTdkYzgtNDM3NS05NDk0LTEyOWJlM2RlODVkNCIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InVzZSI6Ikhhc2liUmFobWF0IiwiZW1hIjoiaGFzaWJtYXVsYW5hcmFobWF0QGdtYWlsLmNvbSIsImZ1bCI6IkFzYURlbiIsInNlcyI6IlIwc0RZTHhtdW90SzhKSG8iLCJkdmMiOiI4MmViY2NmZTY5NjcwZDcxNzI3YmU5MGFjZmZmMGJiMiIsInVpZCI6NTg2MjkzMSwiY291IjoiRUcifSwiZXhwIjoxNzg4OTg0NzYwLCJpYXQiOjE3ODg4OTgzNjAsImlzcyI6IlNUT0NLQklUIiwianRpIjoiMmFiNTNlYmUtM2RhYy00Y2JiLTg3N2MtMTJkMGIxMmI3YjJhIiwibmJmIjoxNzg4ODk4MzYwLCJ2ZXIiOiJ2MSJ9.H-YqMeNl4zg_9s7lE1mt6eVe6QwB5PYes9VyTRBafKJ3yR6HM8uea9vsUerLOmFAcpDA23syYtiC2ZxmOfmHH4XyZz0rsBdmKsuGrw2I75BWQgroDLbgcTWI8yWpi8n6ovWqCwStuk3lxtskaj12ow6UtvqY9zIjznNPBkv8UneXu81gH20XZc1qFulTWu0IYU2FGtZcgAau1yLoL4NlvV3tNRhgqqdpeezas_t8pjXAuWSSiFvnyuj5rbBq28GTE_yBfT5rRkBtZGCRAjtHGx6aKbk6HcplnsPxoyAdtTtSJJoNqu-_B-TUgddu2T6f8ewOO9l8MUH7RHg3_jyuwA";

    function isTokenValid(token) {
        if (!token || typeof token !== 'string' || token.length < 30) return false;
        try {
            const clean = token.replace(/^Bearer\s+/i, '').trim();
            const parts = clean.split('.');
            if (parts.length < 2) return false;
            const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
            const payload = JSON.parse(payloadStr);
            if (payload.exp && (payload.exp * 1000) <= (Date.now() + 30000)) {
                return false;
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function getStockbitToken() {
        // 1. Check dynamically captured token from live traffic
        if (exports.capturedToken && isTokenValid(exports.capturedToken)) {
            return exports.capturedToken;
        }

        // 2. Check storage items
        try {
            const manual = localStorage.getItem('sb_manual_token');
            if (manual && isTokenValid(manual)) return manual;

            const cached = localStorage.getItem('sb_cached_token');
            if (cached && isTokenValid(cached)) return cached;

            const direct = localStorage.getItem('token');
            if (direct && isTokenValid(direct)) return direct;

            // Scan all localStorage keys for any valid unexpired token
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const val = localStorage.getItem(k);
                if (val && typeof val === 'string' && val.includes('eyJ')) {
                    const match = val.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g);
                    if (match) {
                        for (const t of match) {
                            if (isTokenValid(t)) return t;
                        }
                    }
                }
            }
        } catch (_) {}

        // 3. Fallback to active verified token
        if (isTokenValid(VERIFIED_TOKEN)) {
            return VERIFIED_TOKEN;
        }

        return null;
    }

    function formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    async function directFetch(upperSym, token, targetBars) {
        const today = formatDate(new Date());
        const limit = 50;
        const maxPages = Math.ceil(targetBars / limit);
        let allRawItems = [];

        const headers = {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        for (let page = 1; page <= maxPages; page++) {
            const url = `https://exodus.stockbit.com/company-price-feed/historical/summary/${upperSym}?period=HS_PERIOD_DAILY&end_date=${today}&limit=${limit}&page=${page}`;
            try {
                const resp = await fetch(url, { headers });
                if (!resp.ok) break;
                const json = await resp.json();
                const dataArr = json?.data?.result || json?.data?.price_feed || (Array.isArray(json?.data) ? json.data : []);
                if (!Array.isArray(dataArr) || dataArr.length === 0) break;
                allRawItems = allRawItems.concat(dataArr);
                if (dataArr.length < limit) break;
            } catch (err) {
                break;
            }
        }

        if (allRawItems.length === 0) return null;

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

    async function fetchStockbitDailyCandles(symbol, targetBars) {
        targetBars = targetBars || 100;
        const upperSym = symbol.toUpperCase().trim();
        const now = Date.now();

        const cached = CANDLE_CACHE.get(upperSym);
        if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
            return cached.data;
        }

        const token = getStockbitToken();

        // 1. Primary: Use Background Service Worker to bypass webpage CORS
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            try {
                const bgCandles = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        type: 'FETCH_STOCKBIT_CANDLES',
                        symbol: upperSym,
                        token: token,
                        targetBars: targetBars
                    }, (response) => {
                        if (chrome?.runtime?.lastError || !response || !response.success) {
                            resolve(null);
                        } else {
                            resolve(response.candles);
                        }
                    });
                });

                if (Array.isArray(bgCandles) && bgCandles.length > 0) {
                    CANDLE_CACHE.set(upperSym, {
                        timestamp: now,
                        data: bgCandles
                    });
                    return bgCandles;
                }
            } catch (_) {}
        }

        // 2. Secondary fallback: Direct in-page fetch
        const directCandles = await directFetch(upperSym, token, targetBars);
        if (directCandles) {
            CANDLE_CACHE.set(upperSym, {
                timestamp: now,
                data: directCandles
            });
            return directCandles;
        }

        return null;
    }

    exports.getStockbitToken = getStockbitToken;
    exports.fetchStockbitDailyCandles = fetchStockbitDailyCandles;

})(window.StockbitSNR = window.StockbitSNR || {});
