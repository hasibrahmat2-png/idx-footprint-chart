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

export function getIdxTickSize(price: number): number {
    if (price < 200) return 1;
    if (price < 500) return 2;
    if (price < 2000) return 5;
    if (price < 5000) return 10;
    return 25;
}

export function formatCompactVolume(val: number): string {
    if (val === 0) return '0';
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1_000_000) {
        return sign + (abs / 1_000_000).toFixed(1) + 'M';
    }
    if (abs >= 1_000) {
        return sign + (abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + 'K';
    }
    return sign + String(Math.round(abs));
}

export interface FootprintLevelData {
    price: number;
    bidVolume: number;
    askVolume: number;
    totalVolume?: number;
    delta?: number;
    imbalanceSide?: 'buy' | 'sell' | null;
}

export interface FootprintHistogramBar {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    levels?: FootprintLevelData[];
    priceStep?: number;
    [key: string]: any;
}

export interface FootprintHistogramOptions {
    visible?: boolean;
    candleWidthRatio?: number;
    bullishCandleColor?: string;
    bearishCandleColor?: string;
    wickColor?: string;
    bidBarColor?: string;
    askBarColor?: string;
    pocBorderColor?: string;
    pocBorderWidth?: number;
    showCandle?: boolean;
    showText?: boolean;
    textColor?: string;
    buyVolumeColor?: string;
    buyImbalanceColor?: string;
    sellImbalanceColor?: string;
    showDeltaBadge?: boolean;
}

const DEFAULT_OPTIONS: Required<FootprintHistogramOptions> = {
    visible: false,
    candleWidthRatio: 0.18,
    bullishCandleColor: '#26a69a',
    bearishCandleColor: '#ef5350',
    wickColor: '#888888',
    bidBarColor: 'rgba(239, 83, 80, 0.42)',   // Salmon / Red for sell aggressive
    askBarColor: 'rgba(38, 166, 154, 0.42)',  // Mint / Green for buy aggressive
    pocBorderColor: '#F59E0B',                 // Gold / Amber border
    pocBorderWidth: 1.5,
    showCandle: true,
    showText: true,
    textColor: '#E2E8F0',
    buyVolumeColor: '#000000',                 // Solid black for buy volume numbers
    buyImbalanceColor: '#00E676',              // Bright green for buy aggression
    sellImbalanceColor: '#FF3D00',             // Bright red for sell aggression
    showDeltaBadge: true,
};

class FootprintHistogramPaneRenderer implements IPrimitivePaneRenderer {
    private _bars: FootprintHistogramBar[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _visible: boolean = false;
    private _options: Required<FootprintHistogramOptions>;

    constructor(
        bars: FootprintHistogramBar[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean,
        options: Required<FootprintHistogramOptions>
    ) {
        this._bars = bars;
        this._series = series;
        this._chart = chart;
        this._visible = visible;
        this._options = options;
    }

    public update(
        bars: FootprintHistogramBar[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean,
        options: Required<FootprintHistogramOptions>
    ): void {
        this._bars = bars;
        this._series = series;
        this._chart = chart;
        this._visible = visible;
        this._options = options;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._visible || !this._series || !this._chart || this._bars.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const timeScale = this._chart!.timeScale();

            // Estimate default bar spacing
            let defaultBarSpacing = 45;
            try {
                const tsOptions = (timeScale as any).options?.();
                if (tsOptions && typeof tsOptions.barSpacing === 'number') {
                    defaultBarSpacing = tsOptions.barSpacing;
                }
            } catch (_) {}

            const barsCount = this._bars.length;

            for (let i = 0; i < barsCount; i++) {
                const bar = this._bars[i];
                const xCoord = timeScale.timeToCoordinate(bar.time);
                if (xCoord === null || xCoord < -150 || xCoord > mediaSize.width + 150) {
                    continue;
                }

                // Compute dynamic bar width from neighboring coordinates if available
                let barWidth = defaultBarSpacing;
                if (i + 1 < barsCount) {
                    const nextX = timeScale.timeToCoordinate(this._bars[i + 1].time);
                    if (nextX !== null) {
                        barWidth = Math.max(Math.abs(nextX - xCoord), 12);
                    }
                } else if (i > 0) {
                    const prevX = timeScale.timeToCoordinate(this._bars[i - 1].time);
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
        bar: FootprintHistogramBar,
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
            // Wick
            ctx.strokeStyle = this._options.wickColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(candleCenterX, highY);
            ctx.lineTo(candleCenterX, lowY);
            ctx.stroke();

            // Body
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
            ctx.fillStyle = candleColor;
            ctx.fillRect(candleLeft, bodyTop, candleWidth, bodyHeight);
            ctx.strokeStyle = candleColor;
            ctx.strokeRect(candleLeft, bodyTop, candleWidth, bodyHeight);
            ctx.restore();
        }

        // 3. Draw Footprint Intrabar Histogram Profile
        const levels = bar.levels;
        if (!levels || levels.length === 0) return;

        // Find max total volume across this candle for proportional bar scaling
        let maxVolume = 1;
        let candleTotalDelta = 0;
        for (const lvl of levels) {
            const tot = lvl.totalVolume ?? (lvl.bidVolume + lvl.askVolume);
            if (tot > maxVolume) maxVolume = tot;
            candleTotalDelta += (lvl.delta ?? (lvl.askVolume - lvl.bidVolume));
        }

        const tickSize = bar.priceStep || getIdxTickSize(bar.close);
        const numLevels = levels.length;

        // Sort levels ascending by price
        const sortedLevels = [...levels].sort((a, b) => a.price - b.price);

        let minRowTop = Infinity;
        let maxRowBottom = -Infinity;

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
            maxRowBottom = Math.max(maxRowBottom, rowBottom);

            const totVol = lvl.totalVolume ?? (lvl.bidVolume + lvl.askVolume);
            const isPOC = totVol === maxVolume;

            // Proportional horizontal bar length
            const barRatio = Math.min(Math.max(totVol / maxVolume, 0), 1);
            const barLen = Math.max(Math.round(barRatio * histWidth), 2);

            // Split Bar Fill: Bid (left) vs Ask (right)
            const bidRatio = totVol > 0 ? (lvl.bidVolume / totVol) : 0.5;
            const bidPartW = Math.round(barLen * bidRatio);
            const askPartW = barLen - bidPartW;

            ctx.save();

            // Background subtle grid row track
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(histLeft, rowTop, histWidth, rowHeight);

            // Bid Portion (Sell Aggression - Red/Salmon)
            if (bidPartW > 0) {
                ctx.fillStyle = this._options.bidBarColor;
                ctx.fillRect(histLeft, rowTop, bidPartW, rowHeight);
            }

            // Ask Portion (Buy Aggression - Green/Mint)
            if (askPartW > 0) {
                ctx.fillStyle = this._options.askBarColor;
                ctx.fillRect(histLeft + bidPartW, rowTop, askPartW, rowHeight);
            }

            // Subtle row border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 0.6;
            ctx.strokeRect(histLeft, rowTop, histWidth, rowHeight);

            // Point of Control (POC) Golden Box
            if (isPOC) {
                ctx.strokeStyle = this._options.pocBorderColor;
                ctx.lineWidth = this._options.pocBorderWidth;
                ctx.strokeRect(histLeft, rowTop, histWidth, rowHeight);
            }

            // Numbers on top of the bar
            if (this._options.showText && barWidth >= 32 && rowHeight >= 8) {
                const fontSize = Math.min(9, Math.max(7, Math.floor(rowHeight * 0.72)));
                ctx.font = `bold ${fontSize}px "SF Mono", Menlo, Consolas, monospace`;
                ctx.textBaseline = 'middle';

                const bidText = formatCompactVolume(lvl.bidVolume);
                const askText = formatCompactVolume(lvl.askVolume);

                // Diagonal Imbalance color overrides
                const isSellImbalance = lvl.imbalanceSide === 'sell';

                // Bid volume (Left)
                ctx.fillStyle = isSellImbalance ? this._options.sellImbalanceColor : this._options.textColor;
                ctx.textAlign = 'left';
                ctx.fillText(bidText, histLeft + 3, rowTop + rowHeight / 2);

                // Ask volume (Right - Buy Volume)
                ctx.fillStyle = this._options.buyVolumeColor;
                ctx.textAlign = 'right';
                ctx.fillText(askText, histLeft + histWidth - 3, rowTop + rowHeight / 2);
            } else if (this._options.showText && barWidth >= 20 && rowHeight >= 7) {
                // Compact mode: show total volume in the middle
                const fontSize = Math.min(8, Math.max(6, Math.floor(rowHeight * 0.7)));
                ctx.font = `${fontSize}px "SF Mono", Menlo, Consolas, monospace`;
                ctx.fillStyle = this._options.textColor;
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

class FootprintHistogramPaneView implements IPrimitivePaneView {
    private _renderer: FootprintHistogramPaneRenderer;

    constructor(
        bars: FootprintHistogramBar[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean,
        options: Required<FootprintHistogramOptions>
    ) {
        this._renderer = new FootprintHistogramPaneRenderer(bars, series, chart, visible, options);
    }

    public update(
        bars: FootprintHistogramBar[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean,
        options: Required<FootprintHistogramOptions>
    ): void {
        this._renderer.update(bars, series, chart, visible, options);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }

    public renderer(): IPrimitivePaneRenderer {
        return this._renderer;
    }
}

export class FootprintHistogramPrimitive implements ISeriesPrimitive<Time> {
    private _data: FootprintHistogramBar[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _paneView: FootprintHistogramPaneView;
    private _visible: boolean = false;
    private _options: Required<FootprintHistogramOptions>;
    private _requestUpdate?: () => void;

    constructor(options: Partial<FootprintHistogramOptions> = {}) {
        this._options = {
            ...DEFAULT_OPTIONS,
            ...options,
        };
        this._visible = this._options.visible;
        this._paneView = new FootprintHistogramPaneView(
            this._data,
            null,
            null,
            this._visible,
            this._options
        );
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._requestUpdate = param.requestUpdate;

        // Ensure canvas re-renders when user scrolls or zooms the chart
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

    public setData(bars: FootprintHistogramBar[]): void {
        this._data = bars;
        this.updateAllViews();
    }

    public update(bar: FootprintHistogramBar): void {
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

    public setOptions(options: Partial<FootprintHistogramOptions>): void {
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
