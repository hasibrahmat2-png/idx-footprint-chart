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

export interface FanAnchor {
    time: Time;
    price: number;
    label: string; // "O" (Origin), "1", "A", "B", "C"
    barIndex: number;
}

export interface FanLine {
    lineIndex: 1 | 2 | 3;
    anchor: FanAnchor;
    slope: number; // arithmetic price delta per bar
    logSlope?: number; // log space delta per bar
    isBroken: boolean;
    breakIndex: number;
    breakPrice?: number;
}

export interface FanData {
    id: string;
    type: 'bullish' | 'bearish'; // 'bullish' = downtrend reversal, 'bearish' = uptrend reversal
    origin: FanAnchor;
    lines: FanLine[]; // exactly lines 1, 2, 3
    testPullbacks?: FanAnchor[]; // Point B (tests of broken lines)
    isLog?: boolean;
    tolerancePct: number;
    status: 'line1_intact' | 'line1_broken' | 'line2_broken' | 'reversal_confirmed';
    label: string;
    lastBarIndex: number;
    lastTime: Time;
    currentPrice: number;
}

class FanPaneRenderer implements IPrimitivePaneRenderer {
    private _fans: FanData[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        fans: FanData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._fans = fans;
        this._series = series;
        this._chart = chart;
    }

    public update(
        fans: FanData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._fans = fans;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || this._fans.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;
            const height = mediaSize.height;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            for (const fan of this._fans) {
                const isBullish = fan.type === 'bullish';
                const mainColor = isBullish ? '#26A69A' : '#EF5350';
                const highlightColor = isBullish ? '#2962FF' : '#E53935';

                const rightExt = visibleRange
                    ? Math.max(fan.lastBarIndex + 8, Math.ceil(visibleRange.to) + 4)
                    : fan.lastBarIndex + 8;

                // 1. Origin Coordinate
                const ox = timeScale.logicalToCoordinate(fan.origin.barIndex as Logical);
                const oy = this._series!.priceToCoordinate(fan.origin.price);
                if (ox === null || oy === null) continue;

                // 2. Compute Ray Endpoints for Lines 1, 2, and 3
                interface LineEndpoint {
                    line: FanLine;
                    x: number;
                    y: number;
                    anchorX: number | null;
                    anchorY: number | null;
                }

                const endpoints: LineEndpoint[] = [];

                for (const line of fan.lines) {
                    let endPrice = (fan.isLog && line.logSlope !== undefined)
                        ? fan.origin.price * Math.exp(line.logSlope * (rightExt - fan.origin.barIndex))
                        : fan.origin.price + line.slope * (rightExt - fan.origin.barIndex);

                    if (!isFinite(endPrice) || isNaN(endPrice)) endPrice = fan.origin.price;

                    const lx = timeScale.logicalToCoordinate(rightExt as Logical);
                    const ly = this._series!.priceToCoordinate(endPrice);

                    const ax = timeScale.logicalToCoordinate(line.anchor.barIndex as Logical);
                    const ay = this._series!.priceToCoordinate(line.anchor.price);

                    if (lx !== null && ly !== null) {
                        endpoints.push({ line, x: lx, y: ly, anchorX: ax, anchorY: ay });
                    }
                }

                if (endpoints.length < 3) continue;

                // Sort endpoints by lineIndex (1, 2, 3)
                endpoints.sort((a, b) => a.line.lineIndex - b.line.lineIndex);

                const ep1 = endpoints[0];
                const ep2 = endpoints[1];
                const ep3 = endpoints[2];

                // 3. Draw Translucent Webbing / Shaded Wedges
                ctx.save();
                // Wedge 1: Line 1 to Line 2
                ctx.fillStyle = isBullish ? 'rgba(38, 166, 154, 0.05)' : 'rgba(239, 83, 80, 0.05)';
                ctx.beginPath();
                ctx.moveTo(ox, oy);
                ctx.lineTo(ep1.x, ep1.y);
                ctx.lineTo(ep2.x, ep2.y);
                ctx.closePath();
                ctx.fill();

                // Wedge 2: Line 2 to Line 3
                ctx.fillStyle = isBullish ? 'rgba(38, 166, 154, 0.09)' : 'rgba(239, 83, 80, 0.09)';
                ctx.beginPath();
                ctx.moveTo(ox, oy);
                ctx.lineTo(ep2.x, ep2.y);
                ctx.lineTo(ep3.x, ep3.y);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // 4. Draw Radiating Fan Lines
                for (let i = 0; i < endpoints.length; i++) {
                    const ep = endpoints[i];
                    const isLine3 = ep.line.lineIndex === 3;
                    const isBroken = ep.line.isBroken;

                    ctx.save();
                    if (isLine3) {
                        // Line 3: Critical reversal line
                        ctx.strokeStyle = fan.status === 'reversal_confirmed' ? highlightColor : mainColor;
                        ctx.lineWidth = fan.status === 'reversal_confirmed' ? 2.5 : 2.0;
                        if (isBroken) {
                            ctx.setLineDash([6, 3]);
                        } else {
                            ctx.setLineDash([]);
                        }
                    } else {
                        // Line 1 and Line 2
                        ctx.strokeStyle = isBroken ? 'rgba(120, 123, 134, 0.65)' : mainColor;
                        ctx.lineWidth = isBroken ? 1.5 : 2.0;
                        if (isBroken) {
                            ctx.setLineDash([4, 4]); // Dashed when broken into internal trendline
                        } else {
                            ctx.setLineDash([]);
                        }
                    }

                    ctx.beginPath();
                    ctx.moveTo(ox, oy);
                    ctx.lineTo(ep.x, ep.y);
                    ctx.stroke();
                    ctx.restore();

                    // Line Label at right margin
                    ctx.save();
                    ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.fillStyle = isLine3 && fan.status === 'reversal_confirmed' ? highlightColor : (isBroken ? '#787b86' : mainColor);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const lineLabelText = isLine3 ? 'Fan 3 (Reversal Trigger)' : `Fan ${ep.line.lineIndex}`;
                    ctx.fillText(lineLabelText, ep.x + 8, ep.y);
                    ctx.restore();
                }

                // 5. Render Touch Anchor Badges (O, 1, A, B, C)
                const renderAnchorPill = (x: number, y: number, text: string, bgColor: string, isOrigin: boolean = false) => {
                    ctx.save();
                    // Anchor circle dot
                    ctx.fillStyle = bgColor;
                    ctx.beginPath();
                    ctx.arc(x, y, isOrigin ? 4.5 : 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    // Pill badge
                    ctx.font = 'bold 9px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const offsetY = isBullish ? (isOrigin ? -16 : 14) : (isOrigin ? 14 : -16);

                    // Clean transparent label without background or border
                    ctx.fillStyle = bgColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, x, y + offsetY);
                    ctx.restore();
                };

                // Draw Origin Anchor
                renderAnchorPill(ox, oy, `Origin [O]`, mainColor, true);

                // Draw Line Anchors: Line 1 -> "1", Line 2 -> "A", Line 3 -> "C"
                for (const ep of endpoints) {
                    if (ep.anchorX !== null && ep.anchorY !== null) {
                        const lbl = ep.line.lineIndex === 1 ? '1' : (ep.line.lineIndex === 2 ? 'A' : 'C');
                        const dotColor = ep.line.lineIndex === 3 && fan.status === 'reversal_confirmed' ? highlightColor : mainColor;
                        renderAnchorPill(ep.anchorX, ep.anchorY, lbl, dotColor);
                    }
                }

                // Draw Pullback Tests (Point B) if present
                if (fan.testPullbacks) {
                    for (const pb of fan.testPullbacks) {
                        const pbx = timeScale.logicalToCoordinate(pb.barIndex as Logical);
                        const pby = this._series!.priceToCoordinate(pb.price);
                        if (pbx !== null && pby !== null) {
                            renderAnchorPill(pbx, pby, 'B (Pullback Test)', '#FFA726');
                        }
                    }
                }

                // 6. Diagnostic Status Badge near Current Bar
                const currX = timeScale.logicalToCoordinate(fan.lastBarIndex as Logical);
                const currY = this._series!.priceToCoordinate(fan.currentPrice);

                if (currX !== null && currY !== null) {
                    ctx.save();
                    let statusText = '';
                    let badgeBg = 'rgba(28, 32, 48, 0.92)';
                    let badgeBorder = mainColor;

                    if (fan.status === 'reversal_confirmed') {
                        statusText = isBullish
                            ? '🎯 [Reversal Confirmed] Breakout Fan 3 (Downtrend -> Uptrend)'
                            : '🚨 [Reversal Confirmed] Pierced Fan 3 (Uptrend -> Downtrend)';
                        badgeBg = isBullish ? 'rgba(41, 98, 255, 0.92)' : 'rgba(229, 57, 53, 0.92)';
                        badgeBorder = '#ffffff';
                    } else if (fan.status === 'line2_broken') {
                        statusText = `⚠️ Fan 2 Broken (Testing Reversal Trigger Fan 3)`;
                        badgeBorder = '#FFA726';
                    } else if (fan.status === 'line1_broken') {
                        statusText = `⚠️ Fan 1 Broken (Testing Fan 2 Support/Resistance)`;
                        badgeBorder = '#FFA726';
                    } else {
                        statusText = isBullish ? 'Bullish Fan (Line 1 Intact)' : 'Bearish Fan (Line 1 Intact)';
                        badgeBorder = mainColor;
                    }

                    ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const sMetrics = ctx.measureText(statusText);
                    const sWidth = sMetrics.width + 14;
                    const sHeight = 18;

                    const sX = Math.min(width - sWidth - 12, currX + 14);
                    const sY = Math.max(10, Math.min(height - sHeight - 10, currY - sHeight / 2));

                    ctx.fillStyle = badgeBg;
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(sX, sY, sWidth, sHeight, 3);
                    } else {
                        ctx.rect(sX, sY, sWidth, sHeight);
                    }
                    ctx.fill();

                    ctx.strokeStyle = badgeBorder;
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(statusText, sX + sWidth / 2, sY + sHeight / 2);
                    ctx.restore();
                }
            }
        });
    }
}

class FanPaneView implements IPrimitivePaneView {
    private _renderer: FanPaneRenderer;

    constructor(
        fans: FanData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new FanPaneRenderer(fans, series, chart);
    }

    public update(
        fans: FanData[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(fans, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

export class FanPrimitive implements ISeriesPrimitive<Time> {
    private _paneView: FanPaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _requestUpdate: (() => void) | null = null;
    private _fans: FanData[] = [];

    constructor() {
        this._paneView = new FanPaneView([], null, null);
    }

    public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
        this._series = param.series;
        this._chart = param.chart as IChartApiBase<Time>;
        this._requestUpdate = param.requestUpdate;
        this._paneView.update(this._fans, this._series, this._chart);
        if (this._requestUpdate) this._requestUpdate();
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = null;
    }

    public setFans(fans: FanData[]): void {
        this._fans = fans;
        this._paneView.update(this._fans, this._series, this._chart);
        if (this._requestUpdate) this._requestUpdate();
    }

    public clearFans(): void {
        this._fans = [];
        this._paneView.update(this._fans, this._series, this._chart);
        if (this._requestUpdate) this._requestUpdate();
    }

    public updateAllViews(): void {
        this._paneView.update(this._fans, this._series, this._chart);
        if (this._requestUpdate) this._requestUpdate();
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }
}
