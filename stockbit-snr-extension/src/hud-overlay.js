/**
 * Stockbit S/R Floating HUD & Orderbook Highlighter
 * Creates a draggable, collapsible panel and decorates orderbook price rows.
 */

(function(exports) {
    'use strict';

    let hudRoot = null;
    let panelEl = null;
    let pillEl = null;
    let isCollapsed = false;
    let showTokenBar = false;
    let currentChartStatus = { text: '○ Syncing', active: false };

    function broadcast(msg) {
        if (!msg || typeof msg !== 'object') return;
        try { window.postMessage(msg, '*'); } catch (_) {}
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
    }

    function initHUD(onRefreshCallback) {
        if (document.getElementById('sb-snr-hud-root')) {
            return document.getElementById('sb-snr-hud-root');
        }

        hudRoot = document.createElement('div');
        hudRoot.id = 'sb-snr-hud-root';

        panelEl = document.createElement('div');
        panelEl.className = 'sb-snr-panel';

        pillEl = document.createElement('div');
        pillEl.className = 'sb-snr-pill';
        pillEl.title = 'Klik untuk memperbesar Analisis S/R';
        pillEl.addEventListener('click', () => {
            setCollapsed(false);
        });

        hudRoot.appendChild(panelEl);
        hudRoot.appendChild(pillEl);
        document.body.appendChild(hudRoot);

        makeDraggable(panelEl, hudRoot);

        try {
            if (localStorage.getItem('sb_snr_collapsed') === '1') {
                setCollapsed(true);
            }
        } catch (_) {}

        renderEmptyState('Mendeteksi saham Stockbit...');

        return hudRoot;
    }

    function setCollapsed(collapsed) {
        isCollapsed = collapsed;
        if (!panelEl || !pillEl) return;
        if (isCollapsed) {
            panelEl.style.display = 'none';
            pillEl.style.display = 'flex';
        } else {
            panelEl.style.display = 'block';
            pillEl.style.display = 'none';
        }
        try {
            localStorage.setItem('sb_snr_collapsed', isCollapsed ? '1' : '0');
        } catch (_) {}
    }

    function renderEmptyState(msg, onActionCallback) {
        if (!panelEl) return;
        panelEl.innerHTML = `
            <div class="sb-snr-header">
                <div class="sb-snr-title-group">
                    <span class="sb-snr-badge">S/R</span>
                    <span class="sb-snr-symbol">Auto S/R</span>
                </div>
                <div class="sb-snr-actions">
                    <button class="sb-snr-btn-icon" id="sb-snr-min-btn" title="Minimize">−</button>
                </div>
            </div>
            <div class="sb-snr-body">
                <div class="sb-snr-status-msg">${msg}</div>
                <div class="sb-snr-token-box">
                    <button id="sb-snr-detect-btn" class="sb-snr-btn-primary">🔄 Auto-Detect dari Chart</button>
                    <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                        <input type="password" id="sb-snr-token-input" placeholder="Atau tempel Bearer eyJ... token" class="sb-snr-input" />
                        <button id="sb-snr-save-token-btn" class="sb-snr-btn-secondary">Simpan Token & Analisis</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sb-snr-min-btn')?.addEventListener('click', () => setCollapsed(true));

        document.getElementById('sb-snr-detect-btn')?.addEventListener('click', () => {
            broadcast({ type: 'STOCKBIT_SNR_REQUEST_TV_EXPORT' });
            if (onActionCallback) onActionCallback();
        });

        document.getElementById('sb-snr-save-token-btn')?.addEventListener('click', () => {
            const input = document.getElementById('sb-snr-token-input');
            if (input && input.value.trim()) {
                let token = input.value.trim().replace(/^Bearer\s+/i, '');
                localStorage.setItem('sb_manual_token', token);
                exports.capturedToken = token;
                if (onActionCallback) onActionCallback();
            }
        });
    }

    function updateHUD(symbol, srData, onRefresh) {
        if (!panelEl || !srData) return;

        const currentPrice = srData.currentPrice;
        const resistances = srData.resistances || [];
        const supports = srData.supports || [];
        const supplyZones = srData.supplyZones || [];
        const demandZones = srData.demandZones || [];

        const nearestRes = resistances.length > 0 ? resistances[0] : null;
        const nearestSup = supports.length > 0 ? supports[0] : null;

        if (pillEl) {
            pillEl.innerHTML = `
                <span class="sb-snr-badge">${symbol}</span>
                ${nearestRes ? `<span class="sb-snr-pill-res">R: ${nearestRes.price.toLocaleString()}</span>` : ''}
                ${nearestSup ? `<span class="sb-snr-pill-sup">S: ${nearestSup.price.toLocaleString()}</span>` : ''}
            `;
        }

        let resHtml = '';
        if (resistances.length === 0) {
            resHtml = `<div class="sb-snr-status-msg">Tidak ada resisten terdekat (Breakout)</div>`;
        } else {
            resHtml = resistances.map(r => `
                <div class="sb-snr-level-row resistance">
                    <div class="sb-snr-level-info">
                        <span class="sb-snr-level-tag res">${r.touches >= 2 ? `Res ${r.touches}x` : 'High 1x'}</span>
                        <span class="sb-snr-level-price">${r.price.toLocaleString()}</span>
                    </div>
                    <span class="sb-snr-level-dist res">${r.distancePct}</span>
                </div>
            `).join('');
        }

        let supHtml = '';
        if (supports.length === 0) {
            supHtml = `<div class="sb-snr-status-msg">Tidak ada support terdekat (Breakdown)</div>`;
        } else {
            supHtml = supports.map(s => `
                <div class="sb-snr-level-row support">
                    <div class="sb-snr-level-info">
                        <span class="sb-snr-level-tag sup">${s.touches >= 2 ? `Sup ${s.touches}x` : 'Low 1x'}</span>
                        <span class="sb-snr-level-price">${s.price.toLocaleString()}</span>
                    </div>
                    <span class="sb-snr-level-dist sup">${s.distancePct}</span>
                </div>
            `).join('');
        }

        let zonesHtml = '';
        const allZones = [
            ...supplyZones.map(z => ({ ...z, side: 'supply' })),
            ...demandZones.map(z => ({ ...z, side: 'demand' }))
        ];

        if (allZones.length > 0) {
            zonesHtml = `
                <div class="sb-snr-section">
                    <div class="sb-snr-section-title">
                        <span>Supply & Demand Area</span>
                        <span>3-Tick Cluster</span>
                    </div>
                    ${allZones.map(z => `
                        <div class="sb-snr-zone-row ${z.side}">
                            <div class="sb-snr-zone-header ${z.side}">
                                <span>${z.side === 'supply' ? 'Supply Area' : 'Demand Area'}</span>
                                <span>Mid ${z.centerPrice.toLocaleString()}</span>
                            </div>
                            <div class="sb-snr-zone-range">
                                Range: ${z.bottomPrice.toLocaleString()} — ${z.topPrice.toLocaleString()}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        let statusClass = 'waiting';
        if (currentChartStatus.active) statusClass = 'active';
        else if (currentChartStatus.text.includes('⚠️') || currentChartStatus.text.includes('Kosong')) statusClass = 'warning';

        panelEl.innerHTML = `
            <div class="sb-snr-header" id="sb-snr-drag-handle">
                <div class="sb-snr-title-group">
                    <span class="sb-snr-badge">S/R</span>
                    <span class="sb-snr-symbol">${symbol}</span>
                    <span class="sb-snr-price">${currentPrice.toLocaleString()}</span>
                    <span id="sb-snr-chart-status" class="sb-snr-chart-status ${statusClass}">${currentChartStatus.text}</span>
                </div>
                <div class="sb-snr-actions">
                    <button class="sb-snr-btn-icon" id="sb-snr-token-toggle-btn" title="Token Settings">🔑</button>
                    <button class="sb-snr-btn-icon" id="sb-snr-redraw-btn" title="Gambar Ulang di Chart">📍</button>
                    <button class="sb-snr-btn-icon" id="sb-snr-refresh-btn" title="Perbarui Analisis">🔄</button>
                    <button class="sb-snr-btn-icon" id="sb-snr-min-btn" title="Minimize">−</button>
                </div>
            </div>
            <div id="sb-snr-token-quick-drawer" style="display: ${showTokenBar ? 'flex' : 'none'}; flex-direction: column; gap: 6px; padding: 8px 12px; background: #1a1e2b; border-bottom: 1px solid #2a2e39;">
                <input type="password" id="sb-snr-quick-token" placeholder="Bearer eyJ... token baru" class="sb-snr-input" style="font-size:10px;" />
                <div style="display:flex; gap:6px;">
                    <button id="sb-snr-quick-save" class="sb-snr-btn-primary" style="flex:1; padding:4px 8px; font-size:10px;">Simpan Token</button>
                    <button id="sb-snr-quick-export" class="sb-snr-btn-secondary" style="flex:1; padding:4px 8px; font-size:10px;">Detect dari Chart</button>
                </div>
            </div>
            <div class="sb-snr-body">
                <div class="sb-snr-section">
                    <div class="sb-snr-section-title">
                        <span>Resistances (Overhead)</span>
                        <span>Touch Count</span>
                    </div>
                    ${resHtml}
                </div>

                <div class="sb-snr-section">
                    <div class="sb-snr-section-title">
                        <span>Supports (Underlying)</span>
                        <span>Touch Count</span>
                    </div>
                    ${supHtml}
                </div>

                ${zonesHtml}
            </div>
        `;

        document.getElementById('sb-snr-min-btn')?.addEventListener('click', () => setCollapsed(true));
        document.getElementById('sb-snr-refresh-btn')?.addEventListener('click', () => {
            if (onRefresh) onRefresh();
        });
        document.getElementById('sb-snr-redraw-btn')?.addEventListener('click', () => {
            broadcast({ type: 'STOCKBIT_SNR_FORCE_REDRAW' });
            if (onRefresh) onRefresh();
        });
        document.getElementById('sb-snr-token-toggle-btn')?.addEventListener('click', () => {
            showTokenBar = !showTokenBar;
            const drawer = document.getElementById('sb-snr-token-quick-drawer');
            if (drawer) drawer.style.display = showTokenBar ? 'flex' : 'none';
        });
        document.getElementById('sb-snr-quick-save')?.addEventListener('click', () => {
            const input = document.getElementById('sb-snr-quick-token');
            if (input && input.value.trim()) {
                let token = input.value.trim().replace(/^Bearer\s+/i, '');
                localStorage.setItem('sb_manual_token', token);
                exports.capturedToken = token;
                showTokenBar = false;
                if (onRefresh) onRefresh();
            }
        });
        document.getElementById('sb-snr-quick-export')?.addEventListener('click', () => {
            broadcast({ type: 'STOCKBIT_SNR_REQUEST_TV_EXPORT' });
            showTokenBar = false;
            if (onRefresh) onRefresh();
        });

        makeDraggable(panelEl, hudRoot);
    }

    function highlightOrderbook(srData) {
        if (!srData) return;
        const resistances = srData.resistances || [];
        const supports = srData.supports || [];
        const supplyZones = srData.supplyZones || [];
        const demandZones = srData.demandZones || [];

        document.querySelectorAll('.sb-snr-ob-badge').forEach(b => b.remove());

        const resPrices = new Set(resistances.map(r => r.price));
        const supPrices = new Set(supports.map(s => s.price));

        const priceCells = document.querySelectorAll('table td, div[role="row"] div, div[data-testid*="price"]');
        priceCells.forEach(cell => {
            if (cell.childElementCount > 2) return;
            const text = cell.innerText.trim().replace(/,/g, '');
            const val = parseInt(text, 10);
            if (isNaN(val) || val <= 0 || val > 1000000) return;

            if (resPrices.has(val)) {
                const badge = document.createElement('span');
                badge.className = 'sb-snr-ob-badge res';
                const item = resistances.find(r => r.price === val);
                badge.innerText = item && item.touches >= 2 ? `RES ${item.touches}x` : 'RES';
                cell.appendChild(badge);
            } else if (supPrices.has(val)) {
                const badge = document.createElement('span');
                badge.className = 'sb-snr-ob-badge sup';
                const item = supports.find(s => s.price === val);
                badge.innerText = item && item.touches >= 2 ? `SUP ${item.touches}x` : 'SUP';
                cell.appendChild(badge);
            } else {
                const inSupply = supplyZones.some(z => val >= z.bottomPrice && val <= z.topPrice);
                const inDemand = demandZones.some(z => val >= z.bottomPrice && val <= z.topPrice);
                if (inSupply) {
                    const badge = document.createElement('span');
                    badge.className = 'sb-snr-ob-badge zone';
                    badge.innerText = 'SUPPLY';
                    cell.appendChild(badge);
                } else if (inDemand) {
                    const badge = document.createElement('span');
                    badge.className = 'sb-snr-ob-badge zone';
                    badge.innerText = 'DEMAND';
                    cell.appendChild(badge);
                }
            }
        });
    }

    function makeDraggable(element, container) {
        const handle = element.querySelector('#sb-snr-drag-handle') || element;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialRight = 20;
        let initialTop = 65;

        handle.onmousedown = function(e) {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = container.getBoundingClientRect();
            initialRight = window.innerWidth - rect.right;
            initialTop = rect.top;

            document.onmousemove = function(e) {
                if (!isDragging) return;
                const dx = startX - e.clientX;
                const dy = e.clientY - startY;

                container.style.right = `${Math.max(10, initialRight + dx)}px`;
                container.style.top = `${Math.max(10, initialTop + dy)}px`;
            };

            document.onmouseup = function() {
                isDragging = false;
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
    }

    function setChartStatus(text, isActive) {
        currentChartStatus = { text, active: !!isActive };
        const el = document.getElementById('sb-snr-chart-status');
        if (el) {
            el.innerText = text;
            let statusClass = 'waiting';
            if (isActive) {
                statusClass = 'active';
            } else if (text.includes('⚠️') || text.includes('Kosong') || text.includes('Login')) {
                statusClass = 'warning';
            }
            el.className = `sb-snr-chart-status ${statusClass}`;
        }
    }

    exports.initHUD = initHUD;
    exports.renderEmptyState = renderEmptyState;
    exports.updateHUD = updateHUD;
    exports.highlightOrderbook = highlightOrderbook;
    exports.setChartStatus = setChartStatus;

})(window.StockbitSNR = window.StockbitSNR || {});
