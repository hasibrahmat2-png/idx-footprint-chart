# Stockbit Automated Support & Resistance Chrome Extension (Manifest V3)

A lightweight, zero-configuration Chrome Extension that injects automated Dow Theory Support & Resistance, Touch Counting, IDX Fraksi Harga clustering, and Supply/Demand Zones directly onto the real Stockbit platform (`stockbit.com`).

---

## Features

- **Ported Directly from your TypeScript Platform**: 100% mathematical parity with the algorithms in `my-footprint-ts/main.ts`.
- **Dynamic IDX Fraksi Harga**: Automatically applies Indonesian Stock Exchange tick sizes (1, 2, 5, 10, 25).
- **Multi-Touch Classification**:
  - **1 touch**: `High (1x)` / `Low (1x)` dotted line.
  - **2+ touches**: `Res (Nx)` / `Sup (Nx)` solid high-conviction line.
- **Supply & Demand Zones**: Clusters swings occurring within 3 ticks into shaded Supply & Demand areas.
- **Breakout & Breakdown Memory**: If price breaks out to multi-period highs (e.g. ATH), the engine searches backward through historical swings to preserve overhead resistance targets.
- **Live Stockbit Orderbook Badging**: Automatically highlights Bid and Offer rows matching S/R levels with subtle badges (`[RES 3x]`, `[SUP 2x]`, `[SUPPLY]`, `[DEMAND]`).
- **Draggable & Collapsible HUD**: Smooth dark-mode floating widget matching Stockbit's UI with quick minimize to a compact pill badge.
- **TradingView Canvas Hook**: Automatically connects to Stockbit's embedded `window.tvWidget` to draw horizontal lines and zone rectangles directly on Chartbit.

---

## How to Install in Chrome / Brave / Edge (Takes 10 Seconds)

1. Open your browser and go to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click the **Load unpacked** button (top-left).
4. Browse to and select the `stockbit-snr-extension` folder inside this workspace:
   ```text
   /home/hasibrahmat2/lightweight-charts-master/stockbit-snr-extension
   ```
5. Done! The extension is now active and ready.

---

## How to Use

1. Log into [Stockbit](https://stockbit.com).
2. Open any stock page (e.g., `https://stockbit.com/symbol/BBCA`, `/symbol/JELI`, or `/symbol/TLKM`).
3. The **Auto S/R HUD** will immediately appear in the top-right corner showing:
   - Current Price
   - Nearest Resistance with distance percentage (e.g., `368 (+3.37%) [3x]`)
   - Nearest Support with distance percentage (e.g., `318 (-10.67%) [3x]`)
   - 3-Tick Supply & Demand Zones
4. Switch to the **Orderbook** tab: you will see real-time `[RES]` and `[SUP]` badges on the corresponding price rows.
5. Click the extension icon in the Chrome toolbar to adjust pivot lookbacks (5, 10, 15, 20 bars) or toggle zones.

---

## Directory Structure

```
stockbit-snr-extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── icons/                     # Extension icons (16, 48, 128)
├── src/
│   ├── snr-engine.js          # Dow Theory S/R, Fraksi Harga, Touch Counter & Zones
│   ├── stockbit-api.js        # Automatic token extraction & Exodus API candle fetcher
│   ├── hud-overlay.js         # Modern Stockbit-styled floating HUD & Orderbook highlighter
│   ├── chart-hook.js          # Injected into page context for direct TradingView shape drawing
│   └── content.js             # Content script coordinator & SPA navigation observer
├── popup/
│   ├── popup.html             # Extension settings modal
│   ├── popup.js               # Settings sync & message dispatcher
│   └── popup.css              # Dark theme styling for settings
├── styles/
│   └── hud.css                # Polished Stockbit fintech stylesheet
└── README.md                  # This file
```
