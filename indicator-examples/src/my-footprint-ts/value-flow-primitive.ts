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
    Logical,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface ValueFlowBar {
    time: Time;
    logicalIndex: number;
    buyValue: number;   // Foreign Buy (Green)
    sellValue: number;  // Foreign Sell (Red)
    totalValue?: number; // Total Traded Value (IDR)
}

export interface ValueFlowOptions {
    buyColor: string;  // Foreign Buy (Green)
    sellColor: string; // Foreign Sell (Red)
}

class ValueFlowPaneRenderer implements IPrimitivePaneRenderer {
    private _bars: ValueFlowBar[] = [];
    private _options: ValueFlowOptions;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        bars: ValueFlowBar[],
        options: ValueFlowOptions,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._bars = bars;
        this._options = options;
        this._series = series;
        this._chart = chart;
    }

    public update(
        bars: ValueFlowBar[],
        options: ValueFlowOptions,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._bars = bars;
        this._options = options;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || this._bars.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            const x0 = timeScale.logicalToCoordinate(0 as Logical);
            const x1 = timeScale.logicalToCoordinate(1 as Logical);
            const barSpacing = (x0 !== null && x1 !== null) ? Math.max(1, Math.abs(x1 - x0)) : 10;

            // Total slot width for the 2 grouped bars side-by-side
            const groupWidth = Math.max(2, Math.min(60, Math.round(barSpacing * 0.76)));
            const gap = groupWidth > 4 ? 1 : 0;
            const singleBarWidth = Math.max(1, Math.floor((groupWidth - gap) / 2));
            const actualGroupWidth = (singleBarWidth * 2) + gap;

            // Zero level coordinate (pane floor)
            const yZeroCoord = this._series!.priceToCoordinate(0) ?? mediaSize.height;

            for (const bar of this._bars) {
                // Viewport culling for 60 FPS performance
                if (visibleRange) {
                    if (bar.logicalIndex < visibleRange.from - 2 || bar.logicalIndex > visibleRange.to + 2) {
                        continue;
                    }
                }

                const xCenter = timeScale.logicalToCoordinate(bar.logicalIndex as Logical);
                if (xCenter === null) continue;

                const xStart = Math.round(xCenter - actualGroupWidth / 2);
                const xBuy = xStart;
                const xSell = xStart + singleBarWidth + gap;

                // 1. Green Bar: Foreign Buy
                if (bar.buyValue > 0) {
                    const yBuy = this._series!.priceToCoordinate(bar.buyValue) ?? yZeroCoord;
                    if (yZeroCoord > yBuy) {
                        const hBuy = Math.max(1, yZeroCoord - yBuy);
                        ctx.fillStyle = this._options.buyColor;
                        ctx.fillRect(xBuy, yBuy, singleBarWidth, hBuy);
                    }
                }

                // 2. Red Bar: Foreign Sell
                if (bar.sellValue > 0) {
                    const ySell = this._series!.priceToCoordinate(bar.sellValue) ?? yZeroCoord;
                    if (yZeroCoord > ySell) {
                        const hSell = Math.max(1, yZeroCoord - ySell);
                        ctx.fillStyle = this._options.sellColor;
                        ctx.fillRect(xSell, ySell, singleBarWidth, hSell);
                    }
                }
            }
        });
    }
}

class ValueFlowPaneView implements IPrimitivePaneView {
    private _renderer: ValueFlowPaneRenderer;

    constructor(
        bars: ValueFlowBar[],
        options: ValueFlowOptions,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new ValueFlowPaneRenderer(bars, options, series, chart);
    }

    public update(
        bars: ValueFlowBar[],
        options: ValueFlowOptions,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(bars, options, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'bottom'; // Renders behind lines (Average line and % line)
    }

    public renderer(): IPrimitivePaneRenderer {
        return this._renderer;
    }
}

export class ValueFlowGroupedBarPrimitive implements ISeriesPrimitive<Time> {
    private _paneView: ValueFlowPaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _bars: ValueFlowBar[] = [];
    private _options: ValueFlowOptions;
    private _requestUpdate?: () => void;

    constructor(options?: Partial<ValueFlowOptions>) {
        this._options = {
            buyColor: options?.buyColor || '#4CAF50',
            sellColor: options?.sellColor || '#FF5252',
        };
        this._paneView = new ValueFlowPaneView(this._bars, this._options, null, null);
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._requestUpdate = param.requestUpdate;
        this._paneView.update(this._bars, this._options, this._series, this._chart);
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = undefined;
    }

    public updateAllViews(): void {
        this._paneView.update(this._bars, this._options, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public setData(bars: ValueFlowBar[]): void {
        this._bars = bars;
        this.updateAllViews();
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }

    public applyOptions(options: Partial<ValueFlowOptions>): void {
        this._options = { ...this._options, ...options };
        this.updateAllViews();
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }
}

// Backward-compatible alias
export { ValueFlowGroupedBarPrimitive as ValueFlowStackedBarPrimitive };
