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

export interface ChannelTouch {
    time: Time;
    price: number;
    label: string; // "A1", "A2"... for TL, "C1", "C2"... for Channel line
    barIndex: number;
}

export interface ChannelData {
    id: string;
    type: 'up' | 'down';
    startIndex: number;
    startTime: Time;
    startPrice: number;
    slope: number; // Price delta per bar index in arithmetic space
    isLog?: boolean; // True if calculated in logarithmic price space
    logSlope?: number; // Delta ln(price) per bar index in log space
    offset: number; // Arithmetic vertical distance or Log vertical ln-distance
    anchorBar: {
        index: number;
        price: number;
        time: Time;
    };
    tlTouches: ChannelTouch[];
    chTouches: ChannelTouch[];
    totalTouches: number;
    tolerancePct: number;
    isBroken: boolean; // Pierced basic trendline -> Reversal (Gambar 102 & 107)
    isAccelerated: boolean; // Pierced channel line -> Acceleration (Gambar 103 & 106)
    isWeakened: boolean; // Failed to reach channel line -> Weakening warning (Gambar 110 & 111)
    breakIndex: number;
    label: string;
    lastBarIndex: number;
    lastTime: Time;
}

class ChannelPaneRenderer implements IPrimitivePaneRenderer {
    private _channels: ChannelData[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        channels: ChannelData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._channels = channels;
        this._series = series;
        this._chart = chart;
    }

    public update(
        channels: ChannelData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._channels = channels;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || this._channels.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;
            const height = mediaSize.height;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            for (const ch of this._channels) {
                const isUp = ch.type === 'up';
                const mainColor = isUp ? '#26A69A' : '#EF5350';
                const corridorColor = isUp ? 'rgba(38, 166, 154, 0.04)' : 'rgba(239, 83, 80, 0.04)';
                const midColor = isUp ? 'rgba(38, 166, 154, 0.55)' : 'rgba(239, 83, 80, 0.55)';

                // Compute right boundary for ray extension (cutoff at breakIndex + 4 if broken)
                const rightExt = ch.isBroken && ch.breakIndex > 0
                    ? Math.min(ch.lastBarIndex, ch.breakIndex + 4)
                    : (visibleRange ? Math.max(ch.lastBarIndex + 8, Math.ceil(visibleRange.to) + 4) : ch.lastBarIndex + 8);

                // 1. Basic Trendline Coordinates
                const x1 = timeScale.logicalToCoordinate(ch.startIndex as Logical);
                const yTl1 = this._series!.priceToCoordinate(ch.startPrice);

                let tlPrice2 = (ch.isLog && ch.logSlope !== undefined)
                    ? ch.startPrice * Math.exp(ch.logSlope * (rightExt - ch.startIndex))
                    : ch.startPrice + ch.slope * (rightExt - ch.startIndex);
                if (!isFinite(tlPrice2) || isNaN(tlPrice2)) tlPrice2 = ch.startPrice;

                const x2 = timeScale.logicalToCoordinate(rightExt as Logical);
                const yTl2 = this._series!.priceToCoordinate(tlPrice2);

                if (x1 === null || yTl1 === null || x2 === null || yTl2 === null) continue;

                // 2. Parallel Channel Line Coordinates (Offset)
                let chPrice1: number;
                let chPrice2: number;
                let midPrice1: number;
                let midPrice2: number;

                if (ch.isLog) {
                    const factor = Math.exp(isUp ? ch.offset : -ch.offset);
                    const midFactor = Math.exp(isUp ? 0.5 * ch.offset : -0.5 * ch.offset);
                    chPrice1 = ch.startPrice * factor;
                    chPrice2 = tlPrice2 * factor;
                    midPrice1 = ch.startPrice * midFactor;
                    midPrice2 = tlPrice2 * midFactor;
                } else {
                    const delta = isUp ? ch.offset : -ch.offset;
                    chPrice1 = ch.startPrice + delta;
                    chPrice2 = tlPrice2 + delta;
                    midPrice1 = ch.startPrice + 0.5 * delta;
                    midPrice2 = tlPrice2 + 0.5 * delta;
                }

                const yCh1 = this._series!.priceToCoordinate(chPrice1);
                const yCh2 = this._series!.priceToCoordinate(chPrice2);
                const yMid1 = this._series!.priceToCoordinate(midPrice1);
                const yMid2 = this._series!.priceToCoordinate(midPrice2);

                if (yCh1 === null || yCh2 === null) continue;

                // 3. Shaded Parallel Corridor
                ctx.save();
                ctx.fillStyle = ch.isBroken ? 'rgba(120, 123, 134, 0.05)' : corridorColor;
                ctx.beginPath();
                ctx.moveTo(x1, yTl1);
                ctx.lineTo(x2, yTl2);
                ctx.lineTo(x2, yCh2);
                ctx.lineTo(x1, yCh1);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // 4. Draw 50% Midline (Equilibrium / Median line)
                if (yMid1 !== null && yMid2 !== null) {
                    ctx.save();
                    ctx.strokeStyle = midColor;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(x1, yMid1);
                    ctx.lineTo(x2, yMid2);
                    ctx.stroke();
                    ctx.restore();
                }

                // 5. Draw Basic Trendline
                ctx.save();
                ctx.strokeStyle = mainColor;
                if (ch.isBroken) {
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeStyle = 'rgba(120, 123, 134, 0.6)';
                } else {
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.moveTo(x1, yTl1);
                ctx.lineTo(x2, yTl2);
                ctx.stroke();
                ctx.restore();

                // 6. Draw Parallel Channel Line
                ctx.save();
                if (ch.isAccelerated) {
                    // Acceleration Breakout: Bright active royal blue highlight
                    ctx.strokeStyle = '#2962FF';
                    ctx.lineWidth = 2.5;
                    ctx.setLineDash([]);
                } else if (ch.isBroken) {
                    ctx.strokeStyle = 'rgba(120, 123, 134, 0.6)';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([3, 3]);
                } else {
                    ctx.strokeStyle = mainColor;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.moveTo(x1, yCh1);
                ctx.lineTo(x2, yCh2);
                ctx.stroke();
                ctx.restore();

                // 7. Render All Touches (TL: A1..An / B1..Bn, CH: C1..Cn)
                const renderTouches = (touches: ChannelTouch[], isChannelLine: boolean) => {
                    for (const touch of touches) {
                        const tx = timeScale.logicalToCoordinate(touch.barIndex as Logical);
                        const ty = this._series!.priceToCoordinate(touch.price);

                        if (tx === null || ty === null) continue;
                        if (tx < -30 || tx > width + 30 || ty < -30 || ty > height + 30) continue;

                        const touchColor = isChannelLine
                            ? (ch.isAccelerated ? '#2962FF' : mainColor)
                            : mainColor;

                        // Dot anchor
                        ctx.save();
                        ctx.fillStyle = touchColor;
                        ctx.beginPath();
                        ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.2;
                        ctx.stroke();

                        // Vertical guide connector
                        // Uptrend: TL touches below, CH touches above
                        // Downtrend: TL touches above, CH touches below
                        const placeBelow = isUp ? !isChannelLine : isChannelLine;
                        const badgeOffset = placeBelow ? 18 : -18;
                        const badgeCenterY = ty + badgeOffset;

                        ctx.strokeStyle = isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([2, 2]);
                        ctx.beginPath();
                        ctx.moveTo(tx, ty + (placeBelow ? 4 : -4));
                        ctx.lineTo(tx, badgeCenterY + (placeBelow ? -7 : 7));
                        ctx.stroke();

                        // Touch Label: Clean transparent text without background or border
                        ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        ctx.fillStyle = touchColor;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(touch.label, tx, badgeCenterY);
                        ctx.restore();
                    }
                };

                renderTouches(ch.tlTouches, false);
                renderTouches(ch.chTouches, true);

                // 8. Status & Diagnostic Badge near Current Bar / Break Point: Clean transparent text without background or border
                const badgeBarIdx = (ch.isBroken && ch.breakIndex > 0) ? Math.min(ch.lastBarIndex, ch.breakIndex + 2) : ch.lastBarIndex;
                const currX = timeScale.logicalToCoordinate(badgeBarIdx as Logical);
                const currTl = (ch.isLog && ch.logSlope !== undefined)
                    ? ch.startPrice * Math.exp(ch.logSlope * (badgeBarIdx - ch.startIndex))
                    : ch.startPrice + ch.slope * (badgeBarIdx - ch.startIndex);
                const currMid = ch.isLog
                    ? currTl * Math.exp(isUp ? 0.5 * ch.offset : -0.5 * ch.offset)
                    : currTl + (isUp ? 0.5 * ch.offset : -0.5 * ch.offset);
                const currY = this._series!.priceToCoordinate(currMid);

                if (currX !== null && currY !== null) {
                    ctx.save();
                    let statusText = ch.label;
                    let statusColor = mainColor;

                    if (ch.isBroken) {
                        statusText = `[Break] ${ch.label}`;
                        statusColor = '#787b86';
                    } else if (ch.isAccelerated) {
                        statusText = `⚡ [Accel] ${ch.label}`;
                        statusColor = '#2962FF';
                    } else if (ch.isWeakened) {
                        statusText = `⚠️ [Weakness] ${ch.label}`;
                        statusColor = '#FFA726';
                    }

                    ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const sMetrics = ctx.measureText(statusText);
                    const sWidth = sMetrics.width + 8;
                    const sHeight = 16;

                    const sX = Math.min(width - sWidth - 10, currX + 12);
                    const sY = Math.max(10, Math.min(height - sHeight - 10, currY - sHeight / 2));

                    ctx.fillStyle = statusColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(statusText, sX, sY + sHeight / 2);
                    ctx.restore();
                }
            }
        });
    }
}

class ChannelPaneView implements IPrimitivePaneView {
    private _renderer: ChannelPaneRenderer;

    constructor(
        channels: ChannelData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new ChannelPaneRenderer(channels, series, chart);
    }

    public update(
        channels: ChannelData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(channels, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

export class ChannelPrimitive implements ISeriesPrimitive<Time> {
    private _paneView: ChannelPaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _requestUpdate: (() => void) | null = null;
    private _channels: ChannelData[] = [];

    constructor() {
        this._paneView = new ChannelPaneView([], null, null);
    }

    public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
        this._series = param.series;
        this._chart = param.chart as IChartApiBase<Time>;
        this._requestUpdate = param.requestUpdate;
        this._paneView.update(this._channels, this._series, this._chart);
        if (this._requestUpdate) this._requestUpdate();
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = null;
        this._paneView.update([], null, null);
    }

    public updateAllViews(): void {
        this._paneView.update(this._channels, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public setChannels(channels: ChannelData[]): void {
        this._channels = channels;
        this._paneView.update(this._channels, this._series, this._chart);
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }

    public clearChannels(): void {
        this._channels = [];
        this._paneView.update([], this._series, this._chart);
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }
}
