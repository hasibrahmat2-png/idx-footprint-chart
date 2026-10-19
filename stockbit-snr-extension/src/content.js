/**
 * Stockbit Automated S/R - Content Script Coordinator
 * Observes Stockbit SPA navigation, triggers S/R calculation, and syncs HUD & Orderbook.
 */

(function() {
    'use strict';

    let currentSymbol = null;
    let currentSRData = null;
    let lookbackPeriod = 10;
    let isAutoSREnabled = true;

    // Load saved settings
    try {
        if (chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['enabled', 'lookback'], (items) => {
                if (items.enabled !== undefined) isAutoSREnabled = items.enabled;
                if (items.lookback) lookbackPeriod = parseInt(items.lookback, 10);
                if (isAutoSREnabled && currentSymbol) {
                    processSymbol(currentSymbol, true);
                }
            });
        }
    } catch (_) {}

    // Universal Cross-Frame Broadcast Helper
    function broadcast(msg) {
        if (!msg || typeof msg !== 'object') return;
        try {
            window.postMessage(msg, '*');
        } catch (_) {}
        try {
            if (window.top && window.top !== window) {
                window.top.postMessage(msg, '*');
            }
        } catch (_) {}
        try {
            document.querySelectorAll('iframe').forEach(f => {
                try { f.contentWindow?.postMessage(msg, '*'); } catch (_) {}
            });
        } catch (_) {}
        try {
            const eventName = msg.type.toLowerCase().replace(/_/g, '-');
            document.dispatchEvent(new CustomEvent(eventName, { detail: msg }));
        } catch (_) {}
    }

    // Check if Stockbit is in unauthenticated / logged-out state
    function isStockbitLoggedOut() {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        for (const el of buttons) {
            const text = (el.innerText || '').trim().toLowerCase();
            if (text === 'login' || text === 'masuk') {
                // Check if it looks like a primary navigation login button
                const rect = el.getBoundingClientRect();
                if (rect.top < 150 && rect.width > 30) {
                    return true;
                }
            }
        }
        return false;
    }

    // Detect Symbol from Chart Legend, Search Input, DOM, or URL
    function extractSymbolFromPage() {
        // 1. Check TradingView Symbol Button & Legend Title inside Chartbit
        const tvSymBtn = document.querySelector('div[id*="header-toolbar-symbol-search"] button, button[id*="symbol-search"], div[data-name="legend-source-title"], .tv-header-symbol');
        if (tvSymBtn && tvSymBtn.innerText) {
            const text = tvSymBtn.innerText.trim().split(/[\s-]/)[0].toUpperCase();
            if (text.length >= 3 && text.length <= 6 && !['INDEX', 'WATCH', 'ORDER', 'NEWS', 'IHSG', 'COMPOSITE'].includes(text)) {
                return text;
            }
        }

        // 2. Check stock page symbol header
        const symEl = document.querySelector('[data-testid="symbol-name"], .symbol-name, h1');
        if (symEl && symEl.innerText) {
            const text = symEl.innerText.trim().split(' ')[0].toUpperCase();
            if (text.length >= 3 && text.length <= 6 && !['INDEX', 'WATCH', 'ORDER', 'NEWS', 'IHSG', 'COMPOSITE'].includes(text)) {
                return text;
            }
        }

        // 3. Check URL path
        const path = window.location.pathname;
        const match = path.match(/\/symbol\/([A-Za-z0-9]+)/i);
        if (match && match[1]) {
            const sym = match[1].toUpperCase();
            if (sym.length <= 6 && !['INDEX', 'WATCH', 'ORDER', 'NEWS', 'COMPOSITE'].includes(sym)) {
                return sym;
            }
        }

        return null;
    }

    // Helper: Runs S/R math on candles and updates HUD, Orderbook, and Chart shapes
    function renderCandlesSR(candles) {
        if (!candles || candles.length === 0 || !currentSymbol) return;
        const snr = window.StockbitSNR;
        if (!snr) return;

        const srResult = snr.calculateAutoSR(candles, {
            lookback: lookbackPeriod,
            maxLines: 3,
            maxZones: 2
        });

        if (!srResult) {
            snr.renderEmptyState(`Data candle tidak cukup untuk menghitung S/R ${currentSymbol}.`, () => processSymbol(currentSymbol, true));
            return;
        }

        currentSRData = srResult;

        // Update Floating HUD
        snr.updateHUD(currentSymbol, srResult, () => processSymbol(currentSymbol, true));

        // Highlight Orderbook rows
        snr.highlightOrderbook(srResult);

        // Multi-Channel Dispatch to TradingView Chart Hook
        // 1. DOM Bridge Element & CustomEvent
        try {
            let bridge = document.getElementById('sb-snr-bridge');
            if (!bridge) {
                bridge = document.createElement('div');
                bridge.id = 'sb-snr-bridge';
                bridge.style.display = 'none';
                document.documentElement.appendChild(bridge);
            }
            bridge.setAttribute('data-sr', JSON.stringify(srResult));
            document.dispatchEvent(new CustomEvent('sb-snr-update', { detail: srResult }));
        } catch (_) {}

        // 2. Universal Broadcast to top window and all child iframes
        broadcast({
            type: 'STOCKBIT_SNR_UPDATE_CHART',
            symbol: currentSymbol,
            srData: srResult
        });

        console.log(`[Stockbit SNR] Successfully analyzed ${currentSymbol}:`, {
            resistances: srResult.resistances.length,
            supports: srResult.supports.length,
            supplyZones: srResult.supplyZones.length,
            demandZones: srResult.demandZones.length
        });
    }

    // Main processing loop for a symbol
    async function processSymbol(symbol, force = false) {
        if (!isAutoSREnabled) {
            const root = document.getElementById('sb-snr-hud-root');
            if (root) root.style.display = 'none';
            return;
        }

        if (symbol === currentSymbol && !force && currentSRData) {
            return;
        }

        currentSymbol = symbol;
        const snr = window.StockbitSNR;
        if (!snr) return;

        const hudRoot = snr.initHUD(() => processSymbol(symbol, true));
        if (hudRoot) hudRoot.style.display = 'block';

        // Check if Stockbit is logged out
        if (isStockbitLoggedOut()) {
            snr.renderEmptyState(
                `⚠️ <strong>Belum Login ke Stockbit</strong><br><br>Chartbit tidak dapat menampilkan candle jika belum login.<br>Silakan klik tombol <strong>"Login"</strong> hijau di toolbar atas.`,
                () => processSymbol(symbol, true)
            );
            return;
        }

        snr.renderEmptyState(`Menganalisis ${symbol} (lookback: ${lookbackPeriod})...`, () => processSymbol(symbol, true));

        // Attempt 1: Request TradingView widget in memory to export current candles (zero-token, zero-auth)
        broadcast({ type: 'STOCKBIT_SNR_REQUEST_TV_EXPORT' });

        // Attempt 2: Fetch from Stockbit Exodus API via background service worker
        try {
            const candles = await snr.fetchStockbitDailyCandles(symbol, 150);
            if (candles && candles.length > 0) {
                renderCandlesSR(candles);
                return;
            }
        } catch (err) {
            console.warn(`[Stockbit SNR] API fetch attempt failed for ${symbol}:`, err);
        }

        // If not rendered yet after 1.5s, show prompt
        setTimeout(() => {
            if (!currentSRData && currentSymbol === symbol) {
                snr.renderEmptyState(
                    `Menunggu data candle ${symbol}. Silakan klik Auto-Detect dari Chart atau tempel Bearer token:`,
                    () => processSymbol(symbol, true)
                );
            }
        }, 1500);
    }

    // URL & SPA Change Observer
    let lastUrl = window.location.href;

    function checkRouteChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            const newSym = extractSymbolFromPage();
            if (newSym && newSym !== currentSymbol) {
                currentSRData = null;
                processSymbol(newSym);
            }
        }
    }

    const originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(this, arguments);
        checkRouteChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        checkRouteChange();
    };

    window.addEventListener('popstate', checkRouteChange);

    // Periodic check in case user navigated or orderbook re-rendered
    setInterval(() => {
        const sym = extractSymbolFromPage();
        if (sym && sym !== currentSymbol) {
            currentSRData = null;
            processSymbol(sym);
        } else if (currentSRData) {
            window.StockbitSNR?.highlightOrderbook(currentSRData);
        }
    }, 1500);

    // Initial run
    const initialSym = extractSymbolFromPage();
    if (initialSym) {
        processSymbol(initialSym);
    } else {
        window.StockbitSNR?.initHUD();
        window.StockbitSNR?.renderEmptyState('Buka halaman saham Stockbit (misal /symbol/BBCA) untuk melihat S/R');
    }

    // Listen for DOM CustomEvents from Chart Hook
    document.addEventListener('sb-snr-chart-rendered', (e) => {
        const detail = e.detail || {};
        const total = detail.total || (detail.linesCount || 0) + (detail.zonesCount || 0);
        window.StockbitSNR?.setChartStatus(`● ${total} on Chart`, true);
        console.log(`[Stockbit SNR] HUD updated: Chart rendered with ${total} items.`);
    });

    document.addEventListener('sb-snr-chart-empty', () => {
        window.StockbitSNR?.setChartStatus('⚠️ Chart Kosong', false);
    });

    document.addEventListener('sb-snr-chart-ready', () => {
        if (currentSRData) {
            renderCandlesSR(currentSRData.candles);
        } else if (currentSymbol) {
            broadcast({ type: 'STOCKBIT_SNR_REQUEST_TV_EXPORT' });
        }
    });

    document.addEventListener('sb-snr-symbol-changed', (e) => {
        const sym = e.detail?.symbol;
        if (sym && sym !== currentSymbol) {
            console.log(`[Stockbit SNR] Received symbol change event from TradingView: ${sym}`);
            currentSymbol = sym;
            currentSRData = null;
            processSymbol(sym, true);
        }
    });

    // Listen for window.postMessage across all frames
    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;

        // TradingView internal symbol changed (e.g. user typed in chart search)
        if (event.data.type === 'STOCKBIT_SNR_TV_SYMBOL_CHANGED') {
            const sym = event.data.symbol;
            if (sym && sym !== currentSymbol) {
                console.log(`[Stockbit SNR] TradingView chart switched symbol to: ${sym}`);
                currentSymbol = sym;
                currentSRData = null;
                processSymbol(sym, true);
            }
        }

        // Chart empty notification
        if (event.data.type === 'STOCKBIT_SNR_CHART_EMPTY') {
            window.StockbitSNR?.setChartStatus('⚠️ Chart Kosong', false);
        }

        // Chart render completed confirmation
        if (event.data.type === 'STOCKBIT_SNR_CHART_RENDERED') {
            const total = event.data.total || 0;
            window.StockbitSNR?.setChartStatus(`● ${total} on Chart`, true);
            console.log(`[Stockbit SNR] Received confirmation: ${total} shapes active on TradingView!`);
        }

        // Token captured from Stockbit's live network traffic
        if (event.data.type === 'STOCKBIT_SNR_TOKEN_CAPTURED') {
            const token = event.data.token;
            if (token && window.StockbitSNR) {
                console.log('[Stockbit SNR] Token captured from live page traffic!');
                window.StockbitSNR.capturedToken = token;
                try {
                    localStorage.setItem('sb_cached_token', token);
                } catch (_) {}
                if (currentSymbol && !currentSRData) {
                    processSymbol(currentSymbol, true);
                }
            }
        }

        // Candles exported directly from TradingView widget on screen
        if (event.data.type === 'STOCKBIT_SNR_TV_BARS_EXPORTED') {
            const candles = event.data.candles;
            if (Array.isArray(candles) && candles.length > 20) {
                console.log(`[Stockbit SNR] Received ${candles.length} bars directly from TradingView widget!`);
                renderCandlesSR(candles);
            }
        }
    });

    // Listen for messages from popup
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
                if (msg.type === 'TOGGLE_AUTO_SR') {
                    isAutoSREnabled = msg.enabled;
                    if (!isAutoSREnabled) {
                        const root = document.getElementById('sb-snr-hud-root');
                        if (root) root.style.display = 'none';
                        broadcast({ type: 'STOCKBIT_SNR_CLEAR_CHART' });
                    } else if (currentSymbol) {
                        processSymbol(currentSymbol, true);
                    }
                    sendResponse({ status: 'ok' });
                } else if (msg.type === 'SET_LOOKBACK') {
                    lookbackPeriod = parseInt(msg.lookback, 10) || 10;
                    if (currentSymbol) {
                        processSymbol(currentSymbol, true);
                    }
                    sendResponse({ status: 'ok' });
                }
            });
        }
    } catch (_) {}

    console.log('[Stockbit SNR] Content script coordinator active.');
})();
