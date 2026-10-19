import {
    ISeriesPrimitive,
    SeriesAttachedParameter,
    SeriesType,
    Time,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    PrimitivePaneViewZOrder,
    ISeriesApi,
    IChartApiBase,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { getIdxTickSize, formatCompactVolume } from './footprint-histogram-primitive';

export interface BrokerLevelData {
    price: number;
    bidVolume: number;
    askVolume: number;
    totalVolume?: number;
    delta?: number;
    imbalanceSide?: 'buy' | 'sell' | null;
    // 4-quadrant order flow dimensions
    buyAgg?: number;
    buyPas?: number;
    sellAgg?: number;
    sellPas?: number;
}

export interface BrokerProfileBar {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    levels?: BrokerLevelData[];
    priceStep?: number;
    [key: string]: any;
}

export interface BrokerProfileOptions {
    visible?: boolean;
    candleWidthRatio?: number;
    bullishCandleColor?: string;
    bearishCandleColor?: string;
    wickColor?: string;
    // 4-shade colors
    sellAggColor?: string;     // Bright Red: Aggressive Sell (HAKI)
    sellPasColor?: string;     // Faded Red: Passive Sell (Pasang Offer)
    buyPasColor?: string;      // Faded Green: Passive Buy (Antri Bid)
    buyAggColor?: string;      // Bright Green: Aggressive Buy (HAKA)
    pocBorderColor?: string;   // Gold POC border
    pocBorderWidth?: number;
    showCandle?: boolean;
    showText?: boolean;
    sellVolumeColor?: string;  // Pure white for sell numbers (identical to footprint)
    buyVolumeColor?: string;   // Pure black for buy numbers (identical to footprint)
    showDeltaBadge?: boolean;
    activeBroker?: string;     // 'ALL' default, or 2-letter broker code
}

const DEFAULT_BROKER_PROFILE_OPTIONS: Required<BrokerProfileOptions> = {
    visible: false,
    candleWidthRatio: 0.18,
    bullishCandleColor: '#26a69a',
    bearishCandleColor: '#ef5350',
    wickColor: '#888888',
    sellAggColor: 'rgba(239, 83, 80, 0.85)',   // Bright Red
    sellPasColor: 'rgba(239, 83, 80, 0.42)',   // Faded Red (warna asli footprint)
    buyPasColor: 'rgba(38, 166, 154, 0.42)',   // Faded Green (warna asli footprint)
    buyAggColor: 'rgba(38, 166, 154, 0.85)',   // Bright Green
    pocBorderColor: '#F59E0B',                 // Gold / Amber border
    pocBorderWidth: 1.5,
    showCandle: true,
    showText: true,
    sellVolumeColor: '#ffffff',                // Pure white for sell volume numbers
    buyVolumeColor: '#000000',                 // Pure black for buy volume numbers
    showDeltaBadge: true,
    activeBroker: 'ALL',
};

class BrokerProfileRenderer implements IPrimitivePaneRenderer {
    private _data: BrokerProfileBar[];
    private _series: ISeriesApi<SeriesType> | null;
    private _chart: IChartApiBase<Time> | null;
    private _visible: boolean;
    private _options: Required<BrokerProfileOptions>;

    constructor(
        data: BrokerProfileBar[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean,
        options: Required<BrokerProfileOptions>
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
        this._visible = visible;
        this._options = options;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._visible || !this._series || !this._chart || this._data.length === 0) {
            return;
        }

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const timeScale = this._chart!.timeScale();

            let defaultBarSpacing = 45;
            try {
                const tsOptions = (timeScale as any).options?.();
                if (tsOptions && typeof tsOptions.barSpacing === 'number') {
                    defaultBarSpacing = tsOptions.barSpacing;
                }
            } catch (_) {}

            const barsCount = this._data.length;

            for (let i = 0; i < barsCount; i++) {
                const bar = this._data[i];
                const xCoord = timeScale.timeToCoordinate(bar.time);
                if (xCoord === null || xCoord < -150 || xCoord > mediaSize.width + 150) {
                    continue;
                }

                let barWidth = defaultBarSpacing;
                if (i + 1 < barsCount) {
                    const nextX = timeScale.timeToCoordinate(this._data[i + 1].time);
                    if (nextX !== null) {
                        barWidth = Math.max(Math.abs(nextX - xCoord), 12);
                    }
                } else if (i > 0) {
                    const prevX = timeScale.timeToCoordinate(this._data[i - 1].time);
                    if (prevX !== null) {
                        barWidth = Math.max(Math.abs(xCoord - prevX), 12);
                    }
                }

                this._renderBar(ctx, bar, xCoord, barWidth);
            }
        });
    }

    private _renderBar(
        ctx: CanvasRenderingContext2D,
        bar: BrokerProfileBar,
        x: number,
        barWidth: number
    ): void {
        const halfWidth = barWidth / 2;
        const left = Math.round(x - halfWidth);
        const right = left + barWidth;

        // 1. Layout Partitioning
        let candleWidth = 0;
        let candleLeft = left;
        let candleCenterX = left;
        const gap = 3;
        let histLeft = left + 2;
        let histWidth = Math.max(barWidth - 4, 8);

        if (this._options.showCandle) {
            candleWidth = Math.max(4, Math.min(12, Math.round(barWidth * this._options.candleWidthRatio)));
            candleLeft = left + 2;
            candleCenterX = candleLeft + candleWidth / 2;
            histLeft = candleLeft + candleWidth + gap;
            histWidth = Math.max(right - histLeft - 2, 8);
        }

        // 2. Draw Left Price Candle (Wick + Body)
        const openY = this._series!.priceToCoordinate(bar.open);
        const closeY = this._series!.priceToCoordinate(bar.close);
        const highY = this._series!.priceToCoordinate(bar.high);
        const lowY = this._series!.priceToCoordinate(bar.low);

        if (openY !== null && closeY !== null && highY !== null && lowY !== null) {
            const isBull = bar.close >= bar.open;
            const candleColor = isBull ? this._options.bullishCandleColor : this._options.bearishCandleColor;

            ctx.save();
            ctx.strokeStyle = this._options.wickColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(candleCenterX, highY);
            ctx.lineTo(candleCenterX, lowY);
            ctx.stroke();

            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
            ctx.fillStyle = candleColor;
            ctx.fillRect(candleLeft, bodyTop, candleWidth, bodyHeight);
            ctx.strokeStyle = candleColor;
            ctx.strokeRect(candleLeft, bodyTop, candleWidth, bodyHeight);
            ctx.restore();
        }

        // 3. Draw 4-Shade Horizontal Order Flow Profile
        const levels = bar.levels;
        if (!levels || levels.length === 0) return;

        const isAllMode = !this._options.activeBroker || this._options.activeBroker === 'ALL';

        // Find max total volume across this candle for proportional bar scaling
        let maxVolume = 1;
        let candleTotalDelta = 0;
        for (const lvl of levels) {
            const bAgg = lvl.buyAgg || 0;
            const bPas = lvl.buyPas || 0;
            const sAgg = lvl.sellAgg || 0;
            const sPas = lvl.sellPas || 0;
            const tot = isAllMode ? (lvl.totalVolume ?? (lvl.bidVolume + lvl.askVolume)) : (bAgg + bPas + sAgg + sPas);
            if (tot > maxVolume) maxVolume = tot;
            candleTotalDelta += (lvl.delta ?? (lvl.askVolume - lvl.bidVolume));
        }

        const tickSize = bar.priceStep || getIdxTickSize(bar.close);
        const numLevels = levels.length;
        const sortedLevels = [...levels].sort((a, b) => a.price - b.price);

        let minRowTop = Infinity;

        for (let i = 0; i < numLevels; i++) {
            const lvl = sortedLevels[i];
            const currentY = this._series!.priceToCoordinate(lvl.price);
            if (currentY === null) continue;

            const upperY = this._series!.priceToCoordinate(lvl.price + tickSize / 2) ?? (currentY - 7);
            const lowerY = this._series!.priceToCoordinate(lvl.price - tickSize / 2) ?? (currentY + 7);

            const rowTop = Math.min(upperY, lowerY);
            const rowBottom = Math.max(upperY, lowerY);
            const rowHeight = Math.max(rowBottom - rowTop, 1.2);

            minRowTop = Math.min(minRowTop, rowTop);

            const bAgg = lvl.buyAgg || 0;
            const bPas = lvl.buyPas || 0;
            const sAgg = lvl.sellAgg || 0;
            const sPas = lvl.sellPas || 0;

            const totSell = isAllMode ? lvl.bidVolume : (sAgg + sPas);
            const totBuy = isAllMode ? lvl.askVolume : (bAgg + bPas);
            const totVol = isAllMode ? (lvl.totalVolume ?? (lvl.bidVolume + lvl.askVolume)) : (totSell + totBuy);

            // STRICT DOMAIN INVARIANT: Never render rows with 0 volume!
            if (totVol <= 0) continue;

            const isPOC = totVol === maxVolume;

            // Proportional horizontal bar length
            const barRatio = Math.min(Math.max(totVol / maxVolume, 0), 1);
            const barLen = Math.max(Math.round(barRatio * histWidth), 2);

            ctx.save();

            // Background subtle grid row track
            ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
            ctx.fillRect(histLeft, rowTop, histWidth, rowHeight);

            if (isAllMode) {
                // ALL Mode: 4-Shade Representation of Total Market Flow
                // Left half (Sell side): Sell Aggressive (bright red) + Sell Passive (faded red)
                // Right half (Buy side): Buy Passive (faded green) + Buy Aggressive (bright green)
                const sellPartW = Math.round(barLen * 0.5);
                const buyPartW = barLen - sellPartW;

                // Sell Side (Left)
                if (sellPartW > 0) {
                    const saRatio = totVol > 0 ? (lvl.bidVolume / totVol) : 0.5;
                    const saW = Math.round(sellPartW * saRatio);
                    const spW = sellPartW - saW;
                    if (saW > 0) {
                        ctx.fillStyle = this._options.sellAggColor; // Bright Red (HAKI Aggressive)
                        ctx.fillRect(histLeft, rowTop, saW, rowHeight);
                    }
                    if (spW > 0) {
                        ctx.fillStyle = this._options.sellPasColor; // Faded Red (Pasang Offer Passive)
                        ctx.fillRect(histLeft + saW, rowTop, spW, rowHeight);
                    }
                }

                // Buy Side (Right)
                if (buyPartW > 0) {
                    const bpRatio = totVol > 0 ? (lvl.bidVolume / totVol) : 0.5;
                    const bpW = Math.round(buyPartW * bpRatio);
                    const baW = buyPartW - bpW;
                    if (bpW > 0) {
                        ctx.fillStyle = this._options.buyPasColor; // Faded Green (Antri Bid Passive)
                        ctx.fillRect(histLeft + sellPartW, rowTop, bpW, rowHeight);
                    }
                    if (baW > 0) {
                        ctx.fillStyle = this._options.buyAggColor; // Bright Green (HAKA Aggressive)
                        ctx.fillRect(histLeft + sellPartW + bpW, rowTop, baW, rowHeight);
                    }
                }
            } else {
                // Specific Broker Mode: Proportional 4-Quadrant Order Matching
                const sellPartW = totVol > 0 ? Math.round(barLen * (totSell / totVol)) : 0;
                const buyPartW = barLen - sellPartW;

                // Broker Sell Side (Left)
                if (sellPartW > 0) {
                    const saRatio = totSell > 0 ? (sAgg / totSell) : 0.5;
                    const saW = Math.round(sellPartW * saRatio);
                    const spW = sellPartW - saW;
                    if (saW > 0) {
                        ctx.fillStyle = this._options.sellAggColor; // Bright Red
                        ctx.fillRect(histLeft, rowTop, saW, rowHeight);
                    }
                    if (spW > 0) {
                        ctx.fillStyle = this._options.sellPasColor; // Faded Red
                        ctx.fillRect(histLeft + saW, rowTop, spW, rowHeight);
                    }
                }

                // Broker Buy Side (Right)
                if (buyPartW > 0) {
                    const bpRatio = totBuy > 0 ? (bPas / totBuy) : 0.5;
                    const bpW = Math.round(buyPartW * bpRatio);
                    const baW = buyPartW - bpW;
                    if (bpW > 0) {
                        ctx.fillStyle = this._options.buyPasColor; // Faded Green
                        ctx.fillRect(histLeft + sellPartW, rowTop, bpW, rowHeight);
                    }
                    if (baW > 0) {
                        ctx.fillStyle = this._options.buyAggColor; // Bright Green
                        ctx.fillRect(histLeft + sellPartW + bpW, rowTop, baW, rowHeight);
                    }
                }
            }

            // Subtle row border
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
            ctx.lineWidth = 0.6;
            ctx.strokeRect(histLeft, rowTop, histWidth, rowHeight);

            // Point of Control (POC) Golden Box
            if (isPOC) {
                ctx.strokeStyle = this._options.pocBorderColor;
                ctx.lineWidth = this._options.pocBorderWidth;
                ctx.strokeRect(histLeft, rowTop, histWidth, rowHeight);
            }

            // Numbers on top of the bar:
            // Sell volume: Pure WHITE (#ffffff)
            // Buy volume: Pure BLACK (#000000)
            if (this._options.showText && barWidth >= 32 && rowHeight >= 8) {
                const fontSize = Math.min(9, Math.max(7, Math.floor(rowHeight * 0.72)));
                ctx.font = `bold ${fontSize}px "SF Mono", Menlo, Consolas, monospace`;
                ctx.textBaseline = 'middle';

                const sellText = formatCompactVolume(totSell);
                const buyText = formatCompactVolume(totBuy);

                // Sell volume (Left) - WHITE
                ctx.fillStyle = this._options.sellVolumeColor;
                ctx.textAlign = 'left';
                ctx.fillText(sellText, histLeft + 3, rowTop + rowHeight / 2);

                // Buy volume (Right) - BLACK
                ctx.fillStyle = this._options.buyVolumeColor;
                ctx.textAlign = 'right';
                ctx.fillText(buyText, histLeft + histWidth - 3, rowTop + rowHeight / 2);
            } else if (this._options.showText && barWidth >= 20 && rowHeight >= 7) {
                // Compact mode: show total volume in the middle
                const fontSize = Math.min(8, Math.max(6, Math.floor(rowHeight * 0.7)));
                ctx.font = `bold ${fontSize}px "SF Mono", Menlo, Consolas, monospace`;
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatCompactVolume(totVol), histLeft + histWidth / 2, rowTop + rowHeight / 2);
            }

            ctx.restore();
        }

        // 4. Candle Top Delta Summary Badge
        if (this._options.showDeltaBadge && barWidth >= 34 && Number.isFinite(minRowTop)) {
            ctx.save();
            const isPosDelta = candleTotalDelta >= 0;
            const deltaBadgeText = (isPosDelta ? '+' : '') + formatCompactVolume(candleTotalDelta);
            const badgeY = Math.max(12, minRowTop - 8);
            const badgeX = histLeft + histWidth / 2;

            ctx.font = 'bold 8.5px "SF Mono", Menlo, Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const textWidth = ctx.measureText(deltaBadgeText).width;
            const bWidth = textWidth + 8;
            const bHeight = 12;

            ctx.fillStyle = isPosDelta ? 'rgba(38, 166, 154, 0.22)' : 'rgba(239, 83, 80, 0.22)';
            ctx.strokeStyle = isPosDelta ? '#26a69a' : '#ef5350';
            ctx.lineWidth = 0.8;
            ctx.fillRect(badgeX - bWidth / 2, badgeY - bHeight / 2, bWidth, bHeight);
            ctx.strokeRect(badgeX - bWidth / 2, badgeY - bHeight / 2, bWidth, bHeight);

            ctx.fillStyle = isPosDelta ? '#26a69a' : '#ef5350';
            ctx.fillText(deltaBadgeText, badgeX, badgeY);
            ctx.restore();
        }
    }
}

class BrokerProfilePaneView implements IPrimitivePaneView {
    private _data: BrokerProfileBar[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _visible: boolean = false;
    private _options: Required<BrokerProfileOptions>;

    constructor(options: Required<BrokerProfileOptions>) {
        this._options = options;
    }

    public update(
        data: BrokerProfileBar[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean,
        options: Required<BrokerProfileOptions>
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
        this._visible = visible;
        this._options = options;
    }

    public renderer(): IPrimitivePaneRenderer {
        return new BrokerProfileRenderer(
            this._data,
            this._series,
            this._chart,
            this._visible,
            this._options
        );
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }
}

export class BrokerProfilePrimitive implements ISeriesPrimitive<Time> {
    private _data: BrokerProfileBar[] = [];
    private _options: Required<BrokerProfileOptions>;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _requestUpdate?: () => void;
    private _visible: boolean = false;
    private _paneView: BrokerProfilePaneView;

    constructor(options: BrokerProfileOptions = {}) {
        this._options = {
            ...DEFAULT_BROKER_PROFILE_OPTIONS,
            ...options,
        };
        this._visible = this._options.visible;
        this._paneView = new BrokerProfilePaneView(this._options);
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._requestUpdate = param.requestUpdate;

        this._chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            if (this._visible && this._requestUpdate) {
                this._requestUpdate();
            }
        });

        this.updateAllViews();
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = undefined;
        this._paneView.update([], null, null, false, this._options);
    }

    public setData(bars: BrokerProfileBar[], broker?: string): void {
        this._data = bars;
        if (broker !== undefined) {
            this._options.activeBroker = broker;
        }
        this.updateAllViews();
    }

    public update(bar: BrokerProfileBar): void {
        if (this._data.length === 0) {
            this._data = [bar];
        } else {
            const lastBar = this._data[this._data.length - 1];
            if (lastBar.time === bar.time) {
                this._data[this._data.length - 1] = bar;
            } else {
                this._data.push(bar);
            }
        }
        this.updateAllViews();
    }

    public setVisible(visible: boolean): void {
        this._visible = visible;
        this._options.visible = visible;
        this.updateAllViews();
    }

    public isVisible(): boolean {
        return this._visible;
    }

    public setBroker(broker: string): void {
        this._options.activeBroker = broker;
        this.updateAllViews();
    }

    public getBroker(): string {
        return this._options.activeBroker || 'ALL';
    }

    public setOptions(options: Partial<BrokerProfileOptions>): void {
        this._options = {
            ...this._options,
            ...options,
        };
        this._visible = this._options.visible;
        this.updateAllViews();
    }

    public updateAllViews(): void {
        this._paneView.update(
            this._data,
            this._series,
            this._chart,
            this._visible,
            this._options
        );
        if (this._requestUpdate) {
            this._requestUpdate();
        }
        if (this._series) {
            try {
                (this._series as any).applyOptions({});
            } catch (_) {}
        }
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }
}
