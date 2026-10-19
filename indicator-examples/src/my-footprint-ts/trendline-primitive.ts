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

export interface TrendlineTouch {
    time: Time;
    price: number;
    label: string; // "A1", "A2", "A3" or "B1", "B2", "B3"
    barIndex: number;
}

export type TrendlineStrength = 'tentative' | 'normal' | 'strong' | 'major';

export interface TrendlineData {
    id: string;
    type: 'up' | 'down';
    tier?: 'major' | 'accelerated' | 'normal';
    status: 'tentative' | 'valid'; // 2 touches = tentative, 3+ touches = valid
    strength?: TrendlineStrength; // tiered strength: tentative (2x), normal (3x), strong (4x), major (5x+)
    startIndex: number;
    startTime: Time;
    startPrice: number;
    slope: number; // price delta per bar index
    isLog?: boolean; // true if calculated in logarithmic price space
    logSlope?: number; // delta ln(price) per bar index in log space
    touches: TrendlineTouch[];
    tolerancePct: number; // e.g. 0.007 for 0.7%
    isBroken: boolean;
    breakIndex?: number;
    label: string;
    lastBarIndex: number;
    lastTime: Time;
    visible?: boolean;
}

class TrendlinePaneRenderer implements IPrimitivePaneRenderer {
    private _lines: TrendlineData[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        lines: TrendlineData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._lines = lines;
        this._series = series;
        this._chart = chart;
    }

    public update(
        lines: TrendlineData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._lines = lines;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || this._lines.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;
            const height = mediaSize.height;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            for (const line of this._lines) {
                if (line.visible === false) continue;

                const isUp = line.type === 'up';
                const mainColor = isUp ? '#26A69A' : '#EF5350';

                // Compute right boundary for ray extension
                // If line is broken, terminate early (breakIndex + 4) so it doesn't clutter current price action
                let rightExt = visibleRange
                    ? Math.max(line.lastBarIndex + 8, Math.ceil(visibleRange.to) + 4)
                    : line.lastBarIndex + 8;

                if (line.isBroken && line.breakIndex !== undefined) {
                    rightExt = Math.min(rightExt, line.breakIndex + 4);
                }

                // 1. Ray Coordinates
                const x1 = timeScale.logicalToCoordinate(line.startIndex as Logical);
                const y1 = this._series!.priceToCoordinate(line.startPrice);

                let price2 = (line.isLog && line.logSlope !== undefined)
                    ? line.startPrice * Math.exp(line.logSlope * (rightExt - line.startIndex))
                    : line.startPrice + line.slope * (rightExt - line.startIndex);
                if (!isFinite(price2) || isNaN(price2)) price2 = line.startPrice;

                const x2 = timeScale.logicalToCoordinate(rightExt as Logical);
                const y2 = this._series!.priceToCoordinate(price2);

                if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

                // 2. Main Trendline Ray (Multi-Tiered Strength: Dotted, Dashed, Solid capped <= 2.5px)
                // Note: Shaded tolerance corridors removed per specification - clean line only.
                ctx.save();
                if (line.isBroken) {
                    // Broken line: Faint dotted line terminated near break point
                    ctx.strokeStyle = isUp ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)';
                    ctx.lineWidth = 1.0;
                    ctx.setLineDash([2, 4]);
                } else if (line.strength === 'tentative' || line.touches.length <= 2) {
                    // Tentative (2 touches): Thin dotted line
                    ctx.strokeStyle = isUp ? 'rgba(38, 166, 154, 0.85)' : 'rgba(239, 83, 80, 0.85)';
                    ctx.lineWidth = 1.0;
                    ctx.setLineDash([2, 3]);
                } else if (line.strength === 'normal' || line.touches.length === 3) {
                    // Normal / Confirmed (3 touches): Medium dashed line
                    ctx.strokeStyle = mainColor;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 4]);
                } else if (line.strength === 'strong' || line.touches.length === 4) {
                    // Strong (4 touches): Solid line 2.0px
                    ctx.strokeStyle = mainColor;
                    ctx.lineWidth = 2.0;
                    ctx.setLineDash([]);
                } else if (line.strength === 'major' || line.touches.length >= 5) {
                    // Major Base (5+ touches): Prominent solid line capped strictly at 2.5px (never thick as candle)
                    ctx.strokeStyle = isUp ? '#00BFA5' : '#FF5252';
                    ctx.lineWidth = 2.5;
                    ctx.setLineDash([]);
                } else {
                    ctx.strokeStyle = mainColor;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 4]);
                }

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                ctx.restore();

                // 3. Touch Badges (A1, A2, A3... or B1, B2, B3...)
                for (const touch of line.touches) {
                    const tx = timeScale.logicalToCoordinate(touch.barIndex as Logical);
                    const ty = this._series!.priceToCoordinate(touch.price);

                    if (tx === null || ty === null) continue;
                    if (tx < -30 || tx > width + 30 || ty < -30 || ty > height + 30) continue;

                    // Exact pivot touch anchor dot
                    ctx.save();
                    ctx.fillStyle = mainColor;
                    ctx.beginPath();
                    ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();

                    // Vertical guide connector
                    const badgeOffset = isUp ? 18 : -18;
                    const badgeCenterY = ty + badgeOffset;
                    ctx.strokeStyle = isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath();
                    ctx.moveTo(tx, ty + (isUp ? 4 : -4));
                    ctx.lineTo(tx, badgeCenterY + (isUp ? -7 : 7));
                    ctx.stroke();

                    // Touch Label: Clean transparent text without background or border
                    ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.fillStyle = mainColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(touch.label, tx, badgeCenterY);
                    ctx.restore();
                }

                // 4. Status & Classification Badge near Current Bar: Clean transparent text without background or border
                const currX = timeScale.logicalToCoordinate((line.isBroken && line.breakIndex !== undefined ? Math.min(line.lastBarIndex, line.breakIndex + 2) : line.lastBarIndex) as Logical);
                const currPrice = (line.isLog && line.logSlope !== undefined)
                    ? line.startPrice * Math.exp(line.logSlope * (line.lastBarIndex - line.startIndex))
                    : line.startPrice + line.slope * (line.lastBarIndex - line.startIndex);
                const currY = this._series!.priceToCoordinate(currPrice);

                if (currX !== null && currY !== null) {
                    ctx.save();
                    const statusText = line.isBroken
                        ? `[Break] ${line.label}`
                        : line.label;

                    ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const sMetrics = ctx.measureText(statusText);
                    const sWidth = sMetrics.width + 8;
                    const sHeight = 15;

                    // Position text slightly to the right of current bar
                    const sX = Math.min(width - sWidth - 8, currX + 10);
                    const sY = Math.max(10, Math.min(height - sHeight - 10, currY - sHeight / 2));

                    ctx.fillStyle = line.isBroken ? '#787b86' : mainColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(statusText, sX, sY + sHeight / 2);
                    ctx.restore();
                }
            }
        });
    }
}

class TrendlinePaneView implements IPrimitivePaneView {
    private _renderer: TrendlinePaneRenderer;

    constructor(
        lines: TrendlineData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new TrendlinePaneRenderer(lines, series, chart);
    }

    public update(
        lines: TrendlineData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(lines, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

export class TrendlinePrimitive implements ISeriesPrimitive<Time> {
    private _paneView: TrendlinePaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _requestUpdate: (() => void) | null = null;
    private _lines: TrendlineData[] = [];

    constructor() {
        this._paneView = new TrendlinePaneView([], null, null);
    }

    public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
        this._series = param.series;
        this._chart = param.chart as IChartApiBase<Time>;
        this._requestUpdate = param.requestUpdate;
        this._paneView.update(this._lines, this._series, this._chart);
        if (this._requestUpdate) this._requestUpdate();
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = null;
        this._paneView.update([], null, null);
    }

    public updateAllViews(): void {
        this._paneView.update(this._lines, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public setTrendlines(lines: TrendlineData[]): void {
        this._lines = lines;
        this._paneView.update(this._lines, this._series, this._chart);
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }

    public clearTrendlines(): void {
        this._lines = [];
        this._paneView.update([], this._series, this._chart);
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }
}
