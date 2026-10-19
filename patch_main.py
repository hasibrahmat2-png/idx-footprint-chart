import re
import sys

with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

# Replace renderTerminalAlertRowHtml
row_html_replacement = """
        function renderTerminalAlertRowHtml(item: SupportAlertCandidate, tab: 'detected' | 'follow'): string {
            const isFx = getInstrumentFormatInfo(item.symbol, item.currentPrice).isForex;
            const effectiveChgPct = item.changePercentage || 0;
            const chgSign = effectiveChgPct > 0 ? '+' : '';
            const chgColor = effectiveChgPct > 0 ? 'text-green' : (effectiveChgPct < 0 ? 'text-red' : '');
            
            const priceFormatted = formatTerminalPrice(item.currentPrice, isFx);
            const priceDisplay = `${priceFormatted} <br><span style="font-size: 10px;">(${chgSign}${effectiveChgPct.toFixed(2)}%)</span>`;

            // Setup label
            const setupTag = item.primarySupport.isZone 
                ? `Zone ${formatTerminalPrice(item.primarySupport.price, isFx)}` 
                : `Sup ${formatTerminalPrice(item.primarySupport.price, isFx)}`;
            
            // ADR Combined
            const adrLow = item.adrLow ?? Math.max(1, item.refClose * 0.98);
            const adrHigh = item.adrHigh ?? (item.refClose * 1.02);
            const usedPct = item.adrUsedPct ?? 0;
            const usedColor = usedPct >= 100 ? '#e05252' : (usedPct >= 80 ? '#d97706' : '#8f95a0');
            const adrDisplay = `${formatTerminalPrice(adrLow, isFx)} - ${formatTerminalPrice(adrHigh, isFx)}<br><span style="font-size: 10px; color: ${usedColor};">${usedPct.toFixed(1)}% Used</span>`;

            // Trend (ADX)
            const adxVal = item.adxVal ?? 0;
            let adxClass = '';
            let adxLabel = 'Chop';
            if (item.isChop || adxVal < 20) {
                adxClass = '';
                adxLabel = 'Chop';
            } else if (item.isBullish) {
                adxClass = 'text-green';
                adxLabel = item.isStrong ? 'Str Bull' : 'Bullish';
            } else {
                adxClass = 'text-red';
                adxLabel = item.isStrong ? 'Str Bear' : 'Bearish';
            }
            const adxDisplay = `${adxLabel} <br><span style="font-size: 10px;">(${adxVal.toFixed(1)})</span>`;

            // Volatility
            const atrVal = item.atrVal ?? 0;
            const slBuffer = item.slBuffer ?? (atrVal * 1.5);
            const atrDisplay = `${formatTerminalPrice(atrVal, isFx)} <br><span style="font-size: 10px;">SL: ${formatTerminalPrice(slBuffer, isFx)}</span>`;

            // Volume
            const volPct = item.volumeUsedPct ?? 0;
            const volColor = volPct >= 100 ? 'text-green' : (volPct >= 50 ? '#d97706' : '#8f95a0');
            const volDisplay = `${volPct.toFixed(1)}% <br><span style="font-size: 10px; color: ${volColor};">${volPct >= 100 ? 'Breakout' : (volPct >= 50 ? 'High Pace' : 'Normal')}</span>`;

            const actionsHtml = tab === 'detected'
                ? `<div style="display: flex; gap: 3px; justify-content: center;">
                    <button class="btn-term-action btn-term-follow btn-follow" data-sym="${item.symbol}" title="Follow Through (+)">+ Follow</button>
                    <button class="btn-term-action btn-term-dismiss btn-dismiss" data-sym="${item.symbol}" title="Dismiss (✕)">✕</button>
                   </div>`
                : `<div style="display: flex; gap: 3px; justify-content: center;">
                    <button class="btn-term-action btn-term-unfollow btn-unfollow" data-sym="${item.symbol}" title="Unfollow">✕ Unfollow</button>
                   </div>`;

            const cardId = tab === 'follow' ? `alert-row-follow-${item.symbol}` : `alert-row-detected-${item.symbol}`;
            const testingClass = item.status === 'testing' ? ' testing-active' : '';

            let rowHtml = `
                <tr class="alert-row screener-row ${testingClass}" id="${cardId}" data-symbol="${item.symbol}">
                    <td class="symbol-cell sticky-col">
                        <span class="symbol-icon">${item.symbol.slice(0, 1)}</span>
                        <div style="display: flex; flex-direction: column;">
                            <span class="symbol-name">${item.symbol}</span>
                            <span style="font-size: 10px; color: #8f95a0;">P${item.priorityTier} - ${setupTag}</span>
                        </div>
                    </td>
                    <td class="text-right alert-price ${chgColor}">${priceDisplay}</td>
                    <td class="text-right adr-combined-cell">${adrDisplay}</td>
                    <td class="text-right ${adxClass}">${adxDisplay}</td>
                    <td class="text-right atr-combined-cell">${atrDisplay}</td>
                    <td class="text-right vol-combined-cell">${volDisplay}</td>
                    <td class="text-center">
                        ${actionsHtml}
                    </td>
                </tr>
            `;

            if (tab === 'follow') {
                const firstStr = item.firstTouchLog 
                    ? `<code>${item.firstTouchLog.time}</code> • Rp ${formatTerminalPrice(item.firstTouchLog.price, isFx)} (${item.firstTouchLog.changePercent >= 0 ? '+' : ''}${item.firstTouchLog.changePercent.toFixed(1)}%)`
                    : '-';
                const prevStr = item.prevAlertLog 
                    ? `<code>${item.prevAlertLog.time}</code> • Rp ${formatTerminalPrice(item.prevAlertLog.price, isFx)} (${item.prevAlertLog.changePercent >= 0 ? '+' : ''}${item.prevAlertLog.changePercent.toFixed(1)}%)`
                    : '-';
                const currentStr = item.currentAlertLog 
                    ? `<code>${item.currentAlertLog.time}</code> • Rp ${formatTerminalPrice(item.currentAlertLog.price, isFx)} (${item.currentAlertLog.changePercent >= 0 ? '+' : ''}${item.currentAlertLog.changePercent.toFixed(1)}%)`
                    : 'Monitoring...';

                rowHtml += `
                    <tr class="alert-movement-row" id="alert-movement-row-${item.symbol}" data-symbol="${item.symbol}">
                        <td colspan="7" style="padding: 4px 6px; font-size: 10px; color: #8f95a0; text-align: left; background: #fafafa;">
                            <span style="font-weight: 600; color: #1e2329;">Log:</span>
                            First: ${firstStr} • Prev: ${prevStr} • Now: ${currentStr}
                        </td>
                    </tr>
                `;
            }

            return rowHtml;
        }
"""

table_html_replacement = """
        function renderTerminalAlertTableHtml(candidates: SupportAlertCandidate[], tab: 'detected' | 'follow'): string {
            let tbodyHtml = '';
            let currentHeaderTier: number | null = null;

            for (const item of candidates) {
                syncAlertMovementTransition(item, item.currentPrice, item.changePercentage || 0, tab === 'follow');
                if (item.priorityTier !== currentHeaderTier) {
                    currentHeaderTier = item.priorityTier;
                    const headerTitle = currentHeaderTier === 1 
                        ? 'PRIORITY 1: GREEN BUY ZONE (DEMAND)' 
                        : (currentHeaderTier === 2 
                            ? 'PRIORITY 2: TESTED SUPPORT (>=2 TOUCHES)' 
                            : 'PRIORITY 3: SINGLE SWING LOW (1 TOUCH)');
                    const tierCount = candidates.filter(c => c.priorityTier === currentHeaderTier).length;
                    tbodyHtml += `
                        <tr class="alert-category-row">
                            <td colspan="7" class="text-left" style="background: #f1f5f9; font-weight: 600; font-size: 11px;">${headerTitle} (${tierCount})</td>
                        </tr>
                    `;
                }
                tbodyHtml += renderTerminalAlertRowHtml(item, tab);
            }

            return `
                <div class="sidebar-table-wrap table-container" style="overflow-x: auto;">
                    <table class="sidebar-table movers-table">
                        <thead>
                            <tr>
                                <th class="text-left sticky-col" style="min-width: 110px;">Ticker & Setup</th>
                                <th class="text-right" style="min-width: 80px;">Price</th>
                                <th class="text-right" style="min-width: 100px;">ADR (Used%)</th>
                                <th class="text-right" style="min-width: 80px;">Trend</th>
                                <th class="text-right" style="min-width: 80px;">ATR (SL)</th>
                                <th class="text-right" style="min-width: 80px;">Volume</th>
                                <th class="text-center" style="min-width: 60px;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tbodyHtml}
                        </tbody>
                    </table>
                </div>
            `;
        }
"""

update_dom_replacement = """
        function updateAlertCardDom(sym: string, alert: SupportAlertCandidate) {
            const cardEl = document.getElementById(`alert-row-follow-${sym}`) || document.getElementById(`alert-row-detected-${sym}`);
            if (!cardEl) return;

            const isFx = getInstrumentFormatInfo(alert.symbol, alert.currentPrice).isForex;

            const effectiveChgPct = alert.changePercentage || 0;
            const chgSign = effectiveChgPct > 0 ? '+' : '';
            const chgColor = effectiveChgPct > 0 ? 'text-green' : (effectiveChgPct < 0 ? 'text-red' : '');
            const priceFormatted = formatTerminalPrice(alert.currentPrice, isFx);
            const priceDisplay = `${priceFormatted} <br><span style="font-size: 10px;">(${chgSign}${effectiveChgPct.toFixed(2)}%)</span>`;

            const priceEl = cardEl.querySelector('.alert-price');
            if (priceEl) {
                priceEl.innerHTML = priceDisplay;
                priceEl.className = `text-right alert-price ${chgColor}`;
            }

            // 4. ADR Range Position Dot
            const adrLow = alert.adrLow ?? Math.max(1, alert.refClose * 0.98);
            const adrHigh = alert.adrHigh ?? (alert.refClose * 1.02);
            
            // 5. ADR Used Gauge & Real-time Capacity
            if (alert.adrVal && alert.adrVal > 0) {
                const curRange = Math.abs(alert.currentPrice - alert.refClose);
                const liveAdrUsedPct = Math.min(200, (curRange / alert.adrVal) * 100);
                alert.adrUsedPct = Number(liveAdrUsedPct.toFixed(1));
                alert.adrUsedRatio = Number((liveAdrUsedPct / 100).toFixed(2));
                alert.adrLeftPct = Number(Math.max(0, 100 - liveAdrUsedPct).toFixed(1));
                alert.isAdrExhausted = liveAdrUsedPct >= 100;
            }
            const usedPct = alert.adrUsedPct ?? 0;
            const usedColor = usedPct >= 100 ? '#e05252' : (usedPct >= 80 ? '#d97706' : '#8f95a0');
            const adrDisplay = `${formatTerminalPrice(adrLow, isFx)} - ${formatTerminalPrice(adrHigh, isFx)}<br><span style="font-size: 10px; color: ${usedColor};">${usedPct.toFixed(1)}% Used</span>`;
            
            const adrCell = cardEl.querySelector('.adr-combined-cell');
            if (adrCell) adrCell.innerHTML = adrDisplay;

            // 6. Volume Ratio & Breakout Badge
            const currentLot = alert.intradayLot || alert.currVolume || 0;
            const volSma = alert.volSma20 || alert.avgVolume20 || getStockVolSma20(sym);
            const rvol = volSma > 0 ? (currentLot / volSma) * 100 : (alert.volumeUsedPct ?? 0);
            alert.currVolume = currentLot;
            alert.avgVolume20 = volSma;
            alert.volumeUsedPct = Number(rvol.toFixed(1));
            alert.isVolumeBreakout = rvol >= 100;

            const volColor = rvol >= 100 ? 'text-green' : (rvol >= 50 ? '#d97706' : '#8f95a0');
            const volDisplay = `${rvol.toFixed(1)}% <br><span style="font-size: 10px; color: ${volColor};">${rvol >= 100 ? 'Breakout' : (rvol >= 50 ? 'High Pace' : 'Normal')}</span>`;
            const volCell = cardEl.querySelector('.vol-combined-cell');
            if (volCell) volCell.innerHTML = volDisplay;

            // 7. Movement Log Trail (Follow Through Tab)
            const movRow = document.getElementById(`alert-movement-row-${sym}`);
            if (movRow) {
                const tdEl = movRow.querySelector('td');
                if (tdEl) {
                    const firstStr = alert.firstTouchLog 
                        ? `<code>${alert.firstTouchLog.time}</code> • Rp ${formatTerminalPrice(alert.firstTouchLog.price, isFx)} (${alert.firstTouchLog.changePercent >= 0 ? '+' : ''}${alert.firstTouchLog.changePercent.toFixed(1)}%)`
                        : '-';
                    const prevStr = alert.prevAlertLog 
                        ? `<code>${alert.prevAlertLog.time}</code> • Rp ${formatTerminalPrice(alert.prevAlertLog.price, isFx)} (${alert.prevAlertLog.changePercent >= 0 ? '+' : ''}${alert.prevAlertLog.changePercent.toFixed(1)}%)`
                        : '-';
                    const currentStr = alert.currentAlertLog 
                        ? `<code>${alert.currentAlertLog.time}</code> • Rp ${formatTerminalPrice(alert.currentAlertLog.price, isFx)} (${alert.currentAlertLog.changePercent >= 0 ? '+' : ''}${alert.currentAlertLog.changePercent.toFixed(1)}%)`
                        : 'Monitoring...';

                    tdEl.innerHTML = `
                        <span style="font-weight: 600; color: #1e2329;">Log:</span>
                        First: ${firstStr} • Prev: ${prevStr} • Now: ${currentStr}
                    `;
                }
            }

            cardEl.classList.toggle('testing-active', alert.status === 'testing');
        }
"""

# Regex substitution
content = re.sub(r'function renderTerminalAlertRowHtml.*?(?=\n        function renderTerminalAlertTableHtml)', row_html_replacement.strip() + '\n', content, flags=re.DOTALL)
content = re.sub(r'function renderTerminalAlertTableHtml.*?(?=\n        function renderAlertsUI)', table_html_replacement.strip() + '\n', content, flags=re.DOTALL)
content = re.sub(r'function updateAlertCardDom.*?(?=\n        function updateFollowThroughLiveTrade)', update_dom_replacement.strip() + '\n', content, flags=re.DOTALL)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)

print("Patch applied")
