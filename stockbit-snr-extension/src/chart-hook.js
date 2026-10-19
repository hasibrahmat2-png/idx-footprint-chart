/**
 * Stockbit Chart Hook (Main World Execution Context)
 * 1. Automatically captures active Bearer JWT token from live network calls
 * 2. Hooks TradingView.widget constructor safely via Proxy in window.top
 * 3. Extracts candles directly from TradingView chart memory (exportData) with zero authentication dependency
 * 4. Draws native horizontal lines (via createShape / createPositionLine) and supply/demand zones on Chartbit
 */

(function() {
    'use strict';

    // Only run in the top window. NEVER tamper with TradingView's internal iframes!
    if (window !== window.top) {
        return;
    }

    console.log('[Stockbit SNR ChartHook] Initialized in TOP frame');

    let capturedTvWidget = null;
    let capturedChart = null;
    let createdLines = [];
    let createdShapeIds = [];
    let retryInterval = null;

    // --- Universal Cross-Frame Broadcast Helper ---
    function broadcast(msg) {
        if (!msg || typeof msg !== 'object') return;
        try {
            window.postMessage(msg, '*');
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

    // --- 1. Automatic Live Token Interceptor ---
    function notifyTokenCaptured(token) {
        if (!token || token.length < 30) return;
        try {
            localStorage.setItem('sb_cached_token', token);
        } catch (_) {}
        broadcast({
            type: 'STOCKBIT_SNR_TOKEN_CAPTURED',
            token: token
        });
    }

    // Intercept window.fetch
    try {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            try {
                const init = args[1];
                if (init && init.headers) {
                    let auth = null;
                    if (init.headers instanceof Headers) {
                        auth = init.headers.get('Authorization') || init.headers.get('authorization');
                    } else if (typeof init.headers === 'object') {
                        auth = init.headers['Authorization'] || init.headers['authorization'];
                    }
                    if (auth && typeof auth === 'string' && auth.includes('Bearer eyJ')) {
                        const match = auth.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/);
                        if (match) notifyTokenCaptured(match[0]);
                    }
                }
            } catch (_) {}
            return originalFetch.apply(this, args);
        };
    } catch (_) {}

    // Intercept XMLHttpRequest
    try {
        const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
            try {
                if (header && header.toLowerCase() === 'authorization' && value && value.includes('Bearer eyJ')) {
                    const match = value.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/);
                    if (match) notifyTokenCaptured(match[0]);
                }
            } catch (_) {}
            return originalSetRequestHeader.apply(this, arguments);
        };
    } catch (_) {}

    // --- 2. Safe TradingView Widget Proxy Hook ---
    function attachToWidget(widget, sourceName) {
        if (!widget || widget.__sbAttached) return;
        widget.__sbAttached = true;
        capturedTvWidget = widget;
        window.__sbTvWidget = widget;
        window.tvWidget = widget;
        console.log(`[Stockbit SNR ChartHook] Successfully captured TradingView widget via ${sourceName}!`);

        function onReadyHandler() {
            console.log('[Stockbit SNR ChartHook] TradingView chart is READY!');
            try {
                if (typeof widget.activeChart === 'function') {
                    capturedChart = widget.activeChart();
                } else if (typeof widget.chart === 'function') {
                    capturedChart = widget.chart();
                }
            } catch (err) {
                console.warn('[Stockbit SNR ChartHook] Error getting chart from widget:', err);
            }

            // Sync active symbol directly from TradingView chart
            syncSymbolFromTradingView(capturedChart);

            // Render any pending S/R data
            if (window.__sbPendingSR) {
                renderShapesOnTradingView(window.__sbPendingSR);
            }

            // Notify content scripts
            broadcast({ type: 'STOCKBIT_SNR_CHART_READY' });

            // Export candles directly from chart memory
            setTimeout(tryExportBarsFromTradingView, 600);
        }

        try {
            if (typeof widget.onChartReady === 'function') {
                widget.onChartReady(onReadyHandler);
            } else {
                setTimeout(onReadyHandler, 800);
            }
        } catch (_) {
            setTimeout(onReadyHandler, 800);
        }
    }

    function tryExportBarsFromTradingView() {
        const chart = getActiveChart();
        if (!chart || typeof chart.exportData !== 'function') return false;

        try {
            chart.exportData({ includeTime: true, includeUserTime: false })
                .then(exported => {
                    if (exported && Array.isArray(exported.data) && exported.data.length > 0) {
                        const schema = exported.schema || [];
                        const timeIdx = schema.findIndex(s => s.name === 'time');
                        const openIdx = schema.findIndex(s => s.name === 'open');
                        const highIdx = schema.findIndex(s => s.name === 'high');
                        const lowIdx = schema.findIndex(s => s.name === 'low');
                        const closeIdx = schema.findIndex(s => s.name === 'close');
                        const volIdx = schema.findIndex(s => s.name === 'volume');

                        const candles = exported.data.map(row => ({
                            time: row[timeIdx >= 0 ? timeIdx : 0],
                            open: Number(row[openIdx >= 0 ? openIdx : 1]),
                            high: Number(row[highIdx >= 0 ? highIdx : 2]),
                            low: Number(row[lowIdx >= 0 ? lowIdx : 3]),
                            close: Number(row[closeIdx >= 0 ? closeIdx : 4]),
                            volume: Number(volIdx >= 0 ? row[volIdx] : 0)
                        })).filter(c => typeof c.close === 'number' && !isNaN(c.close) && c.close > 0);

                        if (candles.length > 0) {
                            console.log(`[Stockbit SNR ChartHook] Exported ${candles.length} bars directly from TradingView chart memory!`);
                            broadcast({
                                type: 'STOCKBIT_SNR_TV_BARS_EXPORTED',
                                candles: candles
                            });
                            return true;
                        }
                    }
                })
                .catch(err => {
                    console.log('[Stockbit SNR ChartHook] exportData error:', err);
                });
        } catch (_) {}
        return false;
    }

    function syncSymbolFromTradingView(chart) {
        if (!chart) return;
        try {
            let sym = null;
            if (typeof chart.symbol === 'function') {
                sym = chart.symbol();
            } else if (typeof chart.symbolExt === 'function') {
                const ext = chart.symbolExt();
                sym = ext ? ext.symbol : null;
            }

            if (sym && typeof sym === 'string') {
                const cleanSym = sym.split(':').pop().toUpperCase().trim();
                if (cleanSym && cleanSym.length >= 3 && cleanSym.length <= 6 && cleanSym !== 'IHSG' && cleanSym !== 'COMPOSITE') {
                    console.log(`[Stockbit SNR ChartHook] Detected active chart symbol: ${cleanSym}`);
                    broadcast({
                        type: 'STOCKBIT_SNR_TV_SYMBOL_CHANGED',
                        symbol: cleanSym
                    });
                }
            }

            if (typeof chart.onSymbolChanged === 'function' && !chart.__sbSymbolSubscribed) {
                chart.__sbSymbolSubscribed = true;
                chart.onSymbolChanged().subscribe(null, (symbolInfo) => {
                    let newSym = null;
                    if (typeof symbolInfo === 'string') {
                        newSym = symbolInfo;
                    } else if (symbolInfo && typeof symbolInfo === 'object') {
                        newSym = symbolInfo.name || symbolInfo.ticker || symbolInfo.symbol;
                    }
                    if (newSym) {
                        const clean = newSym.split(':').pop().toUpperCase().trim();
                        if (clean && clean.length >= 3 && clean.length <= 6 && clean !== 'IHSG' && clean !== 'COMPOSITE') {
                            console.log(`[Stockbit SNR ChartHook] TradingView onSymbolChanged: ${clean}`);
                            broadcast({
                                type: 'STOCKBIT_SNR_TV_SYMBOL_CHANGED',
                                symbol: clean
                            });
                            setTimeout(tryExportBarsFromTradingView, 500);
                        }
                    }
                });
            }
        } catch (err) {
            console.warn('[Stockbit SNR ChartHook] Error syncing symbol from TV:', err);
        }
    }

    function hookTradingViewWidget() {
        if (!window.TradingView || !window.TradingView.widget) return false;
        if (window.TradingView.widget.__sbWrapped) return true;

        const origWidget = window.TradingView.widget;
        const proxyWidget = new Proxy(origWidget, {
            construct(target, args, newTarget) {
                console.log('[Stockbit SNR ChartHook] new TradingView.widget() intercepted:', args[0]);
                const instance = Reflect.construct(target, args, newTarget);
                attachToWidget(instance, 'Proxy Constructor Hook');
                return instance;
            }
        });

        proxyWidget.__sbWrapped = true;
        try {
            window.TradingView.widget = proxyWidget;
            console.log('[Stockbit SNR ChartHook] TradingView.widget safely hooked via Proxy.');
            return true;
        } catch (_) {
            return false;
        }
    }

    // Attempt immediately, then poll every 50ms for up to 5 seconds
    if (!hookTradingViewWidget()) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (hookTradingViewWidget() || attempts >= 100) {
                clearInterval(interval);
            }
        }, 50);
    }

    // --- 3. React Fiber Scanner ---
    function findWidgetInFiber(domNode, depth = 0) {
        if (!domNode || depth > 15) return null;
        const fiberKey = Object.keys(domNode).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (!fiberKey) return null;

        function walk(fiber, d) {
            if (!fiber || d > 20) return null;
            if (fiber.memoizedProps) {
                for (const k in fiber.memoizedProps) {
                    const p = fiber.memoizedProps[k];
                    if (p && typeof p === 'object' && (typeof p.activeChart === 'function' || typeof p.chart === 'function')) {
                        return p;
                    }
                }
            }
            let state = fiber.memoizedState;
            while (state) {
                const ms = state.memoizedState;
                if (ms && typeof ms === 'object') {
                    if (typeof ms.activeChart === 'function' || typeof ms.chart === 'function') return ms;
                    if (ms.current && (typeof ms.current.activeChart === 'function' || typeof ms.current.chart === 'function')) {
                        return ms.current;
                    }
                }
                state = state.next;
            }
            const sn = fiber.stateNode;
            if (sn && typeof sn === 'object') {
                if (typeof sn.activeChart === 'function' || typeof sn.chart === 'function') return sn;
                if (sn.tvWidget && (typeof sn.tvWidget.activeChart === 'function' || typeof sn.tvWidget.chart === 'function')) {
                    return sn.tvWidget;
                }
            }
            return walk(fiber.return, d + 1) || walk(fiber.child, d + 1);
        }

        return walk(domNode[fiberKey], 0);
    }

    // --- 4. Resilient getActiveChart ---
    function getActiveChart() {
        if (capturedChart) {
            try {
                if (typeof capturedChart.createShape === 'function') return capturedChart;
            } catch (_) {}
        }

        if (capturedTvWidget) {
            try {
                if (typeof capturedTvWidget.activeChart === 'function') {
                    capturedChart = capturedTvWidget.activeChart();
                    return capturedChart;
                }
                if (typeof capturedTvWidget.chart === 'function') {
                    capturedChart = capturedTvWidget.chart();
                    return capturedChart;
                }
            } catch (_) {}
        }

        // Check global window variables
        const globals = [window.__sbTvWidget, window.tvWidget, window._tvWidget, window.tradingViewWidget, window.widget, window.TradingViewChart];
        for (const g of globals) {
            if (g) {
                try {
                    if (typeof g.activeChart === 'function') {
                        attachToWidget(g, 'Global Variable');
                        return g.activeChart();
                    }
                    if (typeof g.chart === 'function') {
                        attachToWidget(g, 'Global Variable');
                        return g.chart();
                    }
                    if (typeof g.createShape === 'function' || typeof g.createPositionLine === 'function') {
                        return g;
                    }
                } catch (_) {}
            }
        }

        // Scan window properties safely
        try {
            const keys = Object.getOwnPropertyNames(window);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k.startsWith('webkit') || k.startsWith('on') || k.length > 35) continue;
                try {
                    const val = window[k];
                    if (val && typeof val === 'object' && val !== window) {
                        if (typeof val.activeChart === 'function') {
                            attachToWidget(val, `window.${k}`);
                            return val.activeChart();
                        }
                        if (typeof val.chart === 'function' && typeof val.onChartReady === 'function') {
                            attachToWidget(val, `window.${k}`);
                            return val.chart();
                        }
                    }
                } catch (_) {}
            }
        } catch (_) {}

        // Scan iframes in document safely
        try {
            const iframes = document.querySelectorAll('iframe');
            for (let i = 0; i < iframes.length; i++) {
                try {
                    const cw = iframes[i].contentWindow;
                    if (!cw) continue;
                    if (cw.chart && (typeof cw.chart.createShape === 'function' || typeof cw.chart.createPositionLine === 'function')) {
                        return cw.chart;
                    }
                    const iframeGlobals = [cw.__sbTvWidget, cw.tvWidget, cw._tvWidget, cw.tradingViewWidget, cw.widget];
                    for (const ig of iframeGlobals) {
                        if (ig && typeof ig.activeChart === 'function') return ig.activeChart();
                        if (ig && typeof ig.chart === 'function') return ig.chart();
                    }
                } catch (_) {}
            }
        } catch (_) {}

        // Scan React Fiber on chart containers safely
        try {
            const containers = document.querySelectorAll('#tv_chart_container, [class*="chartContainer"], [class*="tradingview"], [id*="tradingview"]');
            for (let i = 0; i < containers.length; i++) {
                const w = findWidgetInFiber(containers[i]);
                if (w) {
                    attachToWidget(w, 'React Fiber');
                    if (typeof w.activeChart === 'function') return w.activeChart();
                    if (typeof w.chart === 'function') return w.chart();
                }
            }
        } catch (_) {}

        return null;
    }

    // --- 5. Shape & Line Rendering Engine ---
    function clearShapes() {
        const chart = getActiveChart();

        // Clear position lines
        createdLines.forEach(line => {
            try {
                if (typeof line.remove === 'function') line.remove();
            } catch (_) {}
        });
        createdLines = [];

        // Clear shape IDs
        if (chart && typeof chart.removeEntity === 'function') {
            createdShapeIds.forEach(id => {
                try {
                    chart.removeEntity(id);
                } catch (_) {}
            });
        }
        createdShapeIds = [];
    }

    function drawPriceLineOnChart(chart, config) {
        if (!chart) return false;
        let drawn = false;

        // Method A: createShape ('horizontal_line') - The native, reliable TradingView drawing primitive
        if (typeof chart.createShape === 'function') {
            try {
                let anchorTime = Math.floor(Date.now() / 1000) - 86400 * 30;
                try {
                    if (typeof chart.getVisibleRange === 'function') {
                        const vr = chart.getVisibleRange();
                        if (vr && vr.from) anchorTime = vr.from;
                    }
                } catch (_) {}

                const overrides = {
                    linecolor: config.color,
                    linewidth: config.touches >= 2 ? Math.min(config.touches, 3) : 1,
                    linestyle: config.touches >= 2 ? 0 : 2, // 0 = solid, 2 = dashed
                    showLabel: true,
                    text: config.title,
                    textcolor: config.color,
                    fontsize: 11,
                    bold: true,
                    horzLabelsAlign: 'right'
                };

                let shapeId = null;
                // Attempt with time & price
                try {
                    shapeId = chart.createShape(
                        { time: anchorTime, price: config.price },
                        {
                            shape: 'horizontal_line',
                            lock: true,
                            disableSelection: true,
                            disableSave: true,
                            disableUndo: true,
                            overrides: overrides
                        }
                    );
                } catch (_) {}

                // Attempt with price only (some TradingView library builds)
                if (!shapeId) {
                    try {
                        shapeId = chart.createShape(
                            { price: config.price },
                            {
                                shape: 'horizontal_line',
                                lock: true,
                                disableSelection: true,
                                disableSave: true,
                                disableUndo: true,
                                overrides: overrides
                            }
                        );
                    } catch (_) {}
                }

                if (shapeId) {
                    createdShapeIds.push(shapeId);
                    drawn = true;
                }
            } catch (e) {
                console.warn('[Stockbit SNR ChartHook] createShape horizontal_line failed:', e);
            }
        }

        // Method B: Also add createPositionLine as an enhancement for right price axis badge
        if (typeof chart.createPositionLine === 'function') {
            try {
                const line = chart.createPositionLine();
                if (line) {
                    if (typeof line.setPrice === 'function') line.setPrice(config.price);
                    if (typeof line.setText === 'function') line.setText(config.title);
                    if (typeof line.setLineColor === 'function') line.setLineColor(config.color);
                    if (typeof line.setBodyBorderColor === 'function') line.setBodyBorderColor(config.color);
                    if (typeof line.setBodyBackgroundColor === 'function') {
                        line.setBodyBackgroundColor(config.isResistance ? 'rgba(239, 83, 80, 0.3)' : 'rgba(38, 166, 154, 0.3)');
                    }
                    if (typeof line.setBodyTextColor === 'function') line.setBodyTextColor('#ffffff');
                    if (typeof line.setLineStyle === 'function') line.setLineStyle(config.touches >= 2 ? 0 : 2);
                    if (typeof line.setLineWidth === 'function') line.setLineWidth(Math.min(config.touches, 3));
                    if (typeof line.setLineLength === 'function') line.setLineLength(100);
                    createdLines.push(line);
                    drawn = true;
                }
            } catch (_) {}
        }

        return drawn;
    }

    function drawZoneBoxOnChart(chart, z) {
        if (!chart || typeof chart.createMultipointShape !== 'function') return false;

        let t1 = Math.floor(Date.now() / 1000) - 86400 * 90;
        let t2 = Math.floor(Date.now() / 1000) + 86400 * 30;
        try {
            if (typeof chart.getVisibleRange === 'function') {
                const vr = chart.getVisibleRange();
                if (vr && vr.from && vr.to) {
                    t1 = vr.from;
                    t2 = vr.to + Math.max(86400 * 7, Math.floor((vr.to - vr.from) * 0.15));
                }
            }
        } catch (_) {}

        try {
            const shapeId = chart.createMultipointShape(
                [
                    { time: t1, price: z.topPrice },
                    { time: t2, price: z.bottomPrice }
                ],
                {
                    shape: 'rectangle',
                    lock: true,
                    disableSelection: true,
                    disableSave: true,
                    disableUndo: true,
                    overrides: {
                        backgroundColor: z.isSupply ? 'rgba(239, 83, 80, 0.16)' : 'rgba(76, 175, 80, 0.16)',
                        color: z.isSupply ? 'rgba(239, 83, 80, 0.16)' : 'rgba(76, 175, 80, 0.16)',
                        bordercolor: z.isSupply ? '#ef5350' : '#4caf50',
                        linewidth: 1,
                        linestyle: 2,
                        fillBackground: true,
                        transparency: 84
                    }
                }
            );
            if (shapeId) {
                createdShapeIds.push(shapeId);
                return true;
            }
        } catch (e) {
            console.warn('[Stockbit SNR ChartHook] createMultipointShape rectangle failed:', e);
        }
        return false;
    }

    function renderShapesOnTradingView(srData) {
        if (!srData) return;
        window.__sbPendingSR = srData;

        const chart = getActiveChart();
        if (!chart) {
            console.log('[Stockbit SNR ChartHook] Active chart not found yet. Starting background polling retry...');
            startRetryPolling();
            return;
        }

        if (retryInterval) {
            clearInterval(retryInterval);
            retryInterval = null;
        }

        // Verify if chart has real candles and price scale
        let hasData = true;
        try {
            if (typeof chart.getVisibleRange === 'function') {
                const vr = chart.getVisibleRange();
                if (!vr || vr.from === null || isNaN(vr.from) || vr.from === 0) {
                    hasData = false;
                }
            }
        } catch (_) {}

        clearShapes();

        if (!hasData) {
            console.warn('[Stockbit SNR ChartHook] Chart has no candle data ("No data here" / unauthenticated).');
            broadcast({
                type: 'STOCKBIT_SNR_CHART_EMPTY',
                message: 'Chart has no data. Please check login state.'
            });
            return;
        }

        console.log('[Stockbit SNR ChartHook] Drawing S/R levels on TradingView chart...', {
            resistances: srData.resistances?.length || 0,
            supports: srData.supports?.length || 0,
            supplyZones: srData.supplyZones?.length || 0,
            demandZones: srData.demandZones?.length || 0
        });

        const resistances = srData.resistances || [];
        const supports = srData.supports || [];
        const supplyZones = srData.supplyZones || [];
        const demandZones = srData.demandZones || [];

        let linesCreated = 0;
        let zonesCreated = 0;

        // Draw Resistances
        resistances.forEach(r => {
            const ok = drawPriceLineOnChart(chart, {
                price: r.price,
                title: r.title,
                color: '#ef5350',
                touches: r.touches,
                isResistance: true
            });
            if (ok) linesCreated++;
        });

        // Draw Supports
        supports.forEach(s => {
            const ok = drawPriceLineOnChart(chart, {
                price: s.price,
                title: s.title,
                color: '#26a69a',
                touches: s.touches,
                isResistance: false
            });
            if (ok) linesCreated++;
        });

        // Draw Supply & Demand Zones
        const allZones = [
            ...supplyZones.map(z => ({ ...z, isSupply: true })),
            ...demandZones.map(z => ({ ...z, isSupply: false }))
        ];
        allZones.forEach(z => {
            const ok = drawZoneBoxOnChart(chart, z);
            if (ok) zonesCreated++;
        });

        const totalItems = linesCreated + zonesCreated;
        console.log(`[Stockbit SNR ChartHook] Successfully rendered ${linesCreated} lines and ${zonesCreated} zones on chart!`);

        // Notify content script & HUD of successful rendering
        broadcast({
            type: 'STOCKBIT_SNR_CHART_RENDERED',
            linesCount: linesCreated,
            zonesCount: zonesCreated,
            total: totalItems
        });
    }

    function startRetryPolling() {
        if (retryInterval) return;
        let attempts = 0;
        retryInterval = setInterval(() => {
            attempts++;
            const chart = getActiveChart();
            if (chart && window.__sbPendingSR) {
                clearInterval(retryInterval);
                retryInterval = null;
                console.log(`[Stockbit SNR ChartHook] Chart connected after ${attempts * 300}ms! Rendering levels...`);
                renderShapesOnTradingView(window.__sbPendingSR);
            } else if (attempts >= 40) { // 12 seconds
                clearInterval(retryInterval);
                retryInterval = null;
                console.warn('[Stockbit SNR ChartHook] Could not detect TradingView chart after 12 seconds.');
            }
        }, 300);
    }

    // --- 6. Event & Message Dispatch Listeners ---
    document.addEventListener('sb-snr-update', (e) => {
        if (e.detail) {
            renderShapesOnTradingView(e.detail);
        } else {
            const bridge = document.getElementById('sb-snr-bridge');
            if (bridge) {
                try {
                    const data = JSON.parse(bridge.getAttribute('data-sr') || '{}');
                    renderShapesOnTradingView(data);
                } catch (_) {}
            }
        }
    });

    document.addEventListener('sb-snr-clear', () => {
        clearShapes();
    });

    // Listen to window.postMessage
    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;

        if (event.data.type === 'STOCKBIT_SNR_UPDATE_CHART') {
            renderShapesOnTradingView(event.data.srData);
        } else if (event.data.type === 'STOCKBIT_SNR_CLEAR_CHART') {
            clearShapes();
        } else if (event.data.type === 'STOCKBIT_SNR_FORCE_REDRAW') {
            if (window.__sbPendingSR) {
                renderShapesOnTradingView(window.__sbPendingSR);
            }
        } else if (event.data.type === 'STOCKBIT_SNR_REQUEST_TV_EXPORT') {
            tryExportBarsFromTradingView();
        }
    });

    // Initial check for existing widget
    setTimeout(() => {
        getActiveChart();
    }, 1000);

})();
