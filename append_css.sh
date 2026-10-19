cat << 'CSS_BLOCK' >> indicator-examples/src/my-footprint-ts/index.html

/* Terminal Grid Light Mode CSS */
.alert-term-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'JetBrains Mono', 'SF Mono', 'Roboto Mono', Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    color: #0f172a;
    background: #ffffff;
}

.alert-term-table thead {
    position: sticky;
    top: 0;
    z-index: 10;
}

.alert-term-table th {
    background: #f1f5f9;
    color: #334155;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 10px;
    padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0;
    text-align: left;
    white-space: nowrap;
}

.alert-term-table td {
    padding: 6px 12px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: middle;
    white-space: nowrap;
}

.alert-term-table .text-right { text-align: right; }
.alert-term-table .text-center { text-align: center; }

.alert-term-table .sticky-col {
    position: sticky;
    left: 0;
    background: inherit;
    z-index: 5;
    box-shadow: 1px 0 0 #e2e8f0;
}
.alert-term-table th.sticky-col {
    z-index: 11;
    background: #f1f5f9;
}

.alert-row {
    background: #ffffff;
    cursor: pointer;
    transition: background-color 0.1s ease;
}
.alert-row:nth-child(even) { background: #f8fafc; }
.alert-row:hover { background: #f1f5f9 !important; }
.alert-row.testing-active { background: #dcfce7 !important; }

.alert-category-row td {
    background: #f1f5f9;
    color: #334155;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 6px 12px;
    border-top: 2px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
}

.alert-movement-row td {
    padding: 4px 12px 8px 12px;
    border-bottom: 1px solid #e2e8f0;
    font-family: 'JetBrains Mono', 'SF Mono', 'Roboto Mono', monospace;
    font-size: 10px;
    color: #64748b;
    background: #f8fafc;
}
.alert-movement-row code {
    background: #e2e8f0;
    padding: 1px 4px;
    border-radius: 3px;
    color: #334155;
    font-family: inherit;
}

.alert-ticker-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.alert-ticker-sym {
    font-weight: 700;
    font-size: 13px;
    color: #0f172a;
}

.alert-p-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 4px;
    border-radius: 4px;
}
.alert-p-badge.p1 { background: #dcfce7; color: #16a34a; }
.alert-p-badge.p2 { background: #fef3c7; color: #d97706; }
.alert-p-badge.p3 { background: #f1f5f9; color: #64748b; }

.alert-setup-tag { font-size: 10px; color: #64748b; }
.alert-price-val { font-weight: 600; font-size: 12px; }

.alert-chg-pill {
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
}
.alert-chg-pill.pos { color: #16a34a; background: #dcfce7; }
.alert-chg-pill.neg { color: #dc2626; background: #fee2e2; }
.alert-chg-pill.neu { color: #64748b; background: #f1f5f9; }

.adr-range-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: space-between;
}
.adr-low-val, .adr-high-val { font-size: 10px; color: #64748b; }

.adr-pos-bar {
    width: 60px;
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    position: relative;
}
.adr-pos-dot {
    position: absolute;
    width: 8px;
    height: 8px;
    background: #0f172a;
    border-radius: 50%;
    top: -2px;
    transform: translateX(-50%);
}

.adr-used-cell {
    display: flex;
    align-items: center;
    gap: 6px;
}
.adr-used-pct {
    font-weight: 600;
    width: 38px;
    text-align: right;
}
.adr-used-track {
    width: 50px;
    height: 6px;
    background: #e2e8f0;
    border-radius: 3px;
    overflow: hidden;
}
.adr-used-fill { height: 100%; transition: width 0.3s ease; }
.adr-left-label { font-size: 10px; color: #64748b; width: 50px; }

.adx-trend-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    display: inline-block;
}
.adx-trend-badge.bull { color: #16a34a; background: #dcfce7; }
.adx-trend-badge.bear { color: #dc2626; background: #fee2e2; }
.adx-trend-badge.chop { color: #64748b; background: #f1f5f9; }

.atr-cell span { display: block; }
.atr-sl-text { font-size: 9px; color: #64748b; }

.vol-cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
}
.vol-pct { font-weight: 600; }
.vol-badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
}
.vol-badge.breakout { background: #dcfce7; color: #16a34a; font-weight: 700; }
.vol-badge.highpace { background: #fef3c7; color: #d97706; font-weight: 600; }
.vol-badge.normal { background: #f1f5f9; color: #64748b; }

.btn-term-action {
    background: transparent;
    border: 1px solid #cbd5e1;
    color: #475569;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
}
.btn-term-action:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #94a3b8;
}
.btn-term-follow:hover {
    background: #dcfce7;
    color: #16a34a;
    border-color: #16a34a;
}
.btn-term-dismiss:hover, .btn-term-unfollow:hover {
    background: #fee2e2;
    color: #dc2626;
    border-color: #dc2626;
}
CSS_BLOCK
