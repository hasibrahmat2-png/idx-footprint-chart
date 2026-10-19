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

export interface StructureAnchor {
    time: Time;
    price: number;
    label: string; // e.g. "A", "B", "C", "B1", "C1"
    barIndex: number;
}

export interface HorizontalStep {
    id: string;
    label: string; // "S2", "S3", "S4" or "R2", "R3", "R4"
    anchor: StructureAnchor;
    price: number;
    formattedPrice?: string;
    isBroken: boolean;
}

export interface CounterTrendline {
    type: 'tentative_down' | 'tentative_up';
    pattern: 'failure_swing' | 'double_top' | 'double_bottom';
    anchor1: StructureAnchor; // B1
    anchor2: StructureAnchor; // C1
    slope: number;
    logSlope?: number;
}

export interface TrendStructureData {
    id: string;
    type: 'uptrend' | 'downtrend';
    majorTrendline: {
        label: string; // "S1" or "R1"
        anchor1: StructureAnchor;
        anchor2: StructureAnchor;
        slope: number;
        logSlope?: number;
        isBroken: boolean;
        breakIndex?: number;
    };
    horizontalSteps: HorizontalStep[]; // S2, S3, S4... or R2, R3, R4...
    counterTrend?: CounterTrendline;
    isLog?: boolean;
    tolerancePct: number;
    status: 'major_intact' | 'major_broken' | 'failure_swing' | 'double_top_risk' | 'double_bottom_risk';
    lastBarIndex: number;
    lastTime: Time;
    currentPrice: number;
}

class TrendStructurePaneRenderer implements IPrimitivePaneRenderer {
    private _data: TrendStructureData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: TrendStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: TrendStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || !this._data) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;
            const height = mediaSize.height;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            const data = this._data!;
            const isUptrend = data.type === 'uptrend';
            const mainColor = isUptrend ? '#26A69A' : '#EF5350';
            const alertColor = '#FFA726'; // Amber for failure swings and warnings

            const rightExt = visibleRange
                ? Math.max(data.lastBarIndex + 8, Math.ceil(visibleRange.to) + 4)
                : data.lastBarIndex + 8;

            const rightX = timeScale.logicalToCoordinate(rightExt as Logical) ?? width;

            // =========================================================================
            // 1. Draw Major Dynamic Trendline (S1 or R1)
            // =========================================================================
            const maj = data.majorTrendline;
            const x1 = timeScale.logicalToCoordinate(maj.anchor1.barIndex as Logical);
            const y1 = this._series!.priceToCoordinate(maj.anchor1.price);
            const x2 = timeScale.logicalToCoordinate(maj.anchor2.barIndex as Logical);
            const y2 = this._series!.priceToCoordinate(maj.anchor2.price);

            if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                let endPrice = (data.isLog && maj.logSlope !== undefined)
                    ? maj.anchor1.price * Math.exp(maj.logSlope * (rightExt - maj.anchor1.barIndex))
                    : maj.anchor1.price + maj.slope * (rightExt - maj.anchor1.barIndex);

                if (!isFinite(endPrice) || isNaN(endPrice)) endPrice = maj.anchor1.price;
                const endY = this._series!.priceToCoordinate(endPrice);

                if (endY !== null) {
                    ctx.save();
                    ctx.strokeStyle = maj.isBroken ? 'rgba(120, 123, 134, 0.75)' : mainColor;
                    ctx.lineWidth = maj.isBroken ? 1.5 : 2.5;
                    if (maj.isBroken) {
                        ctx.setLineDash([5, 4]);
                    } else {
                        ctx.setLineDash([]);
                    }

                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(rightX, endY);
                    ctx.stroke();
                    ctx.restore();

                    // Label at right margin
                    ctx.save();
                    ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.fillStyle = maj.isBroken ? '#787b86' : mainColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const majTitle = isUptrend ? `S1 (Major Up-Trendline)` : `R1 (Major Down-Trendline)`;
                    ctx.fillText(majTitle, rightX + 8, endY);
                    ctx.restore();
                }

                // Render Anchor Dots for S1 / R1
                const renderDot = (x: number, y: number, text: string) => {
                    ctx.save();
                    ctx.fillStyle = mainColor;
                    ctx.beginPath();
                    ctx.arc(x, y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    // Pill label
                    ctx.font = 'bold 9px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    const m = ctx.measureText(text);
                    const bW = m.width + 8;
                    const bH = 14;
                    const offY = isUptrend ? 13 : -13;
                    const bX = x - bW / 2;
                    const bY = y + offY - bH / 2;

                    ctx.fillStyle = 'rgba(28, 32, 48, 0.88)';
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') ctx.roundRect(bX, bY, bW, bH, 3);
                    else ctx.rect(bX, bY, bW, bH);
                    ctx.fill();
                    ctx.strokeStyle = mainColor;
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, bX + bW / 2, bY + bH / 2);
                    ctx.restore();
                };

                renderDot(x1, y1, maj.anchor1.label);
                renderDot(x2, y2, maj.anchor2.label);
            }

            // =========================================================================
            // 2. Draw Horizontal Staircase Steps (S2, S3, S4... / R2, R3, R4...)
            // =========================================================================
            data.horizontalSteps.forEach((step, idx) => {
                const stepY = this._series!.priceToCoordinate(step.price);
                const stepStartX = timeScale.logicalToCoordinate(step.anchor.barIndex as Logical);
                if (stepY === null || stepStartX === null) return;

                ctx.save();
                // Step line from anchor to right margin
                ctx.strokeStyle = step.isBroken ? 'rgba(120, 123, 134, 0.55)' : (isUptrend ? '#26A69A' : '#EF5350');
                ctx.lineWidth = step.label === 'S2' || step.label === 'R2' ? 1.8 : 1.2;
                ctx.setLineDash([4, 3]);

                ctx.beginPath();
                ctx.moveTo(stepStartX, stepY);
                ctx.lineTo(rightX, stepY);
                ctx.stroke();
                ctx.restore();

                // Anchor Dot & Vertical Guide
                ctx.save();
                ctx.fillStyle = isUptrend ? '#26A69A' : '#EF5350';
                ctx.beginPath();
                ctx.arc(stepStartX, stepY, 3.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();

                // Step Pill Badge at right edge
                ctx.save();
                ctx.font = 'bold 9px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const stepPriceStr = step.formattedPrice || (step.price >= 100 ? step.price.toFixed(0) : (step.price >= 2 ? step.price.toFixed(2) : step.price.toFixed(4)));
                const stepText = `${step.label} [${stepPriceStr}]${idx === 0 ? (isUptrend ? ' (Floor)' : ' (Ceiling)') : ''}`;
                const m = ctx.measureText(stepText);

                // Clean transparent label without background or border
                ctx.fillStyle = step.isBroken ? '#787b86' : (isUptrend ? '#26A69A' : '#EF5350');
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(stepText, Math.min(width - m.width - 6, rightX + 6), stepY);
                ctx.restore();
            });

            // =========================================================================
            // 3. Draw Counter-Trendline (Scenario IIA Failure Swing or IIB Double Top/Bottom)
            // =========================================================================
            if (data.counterTrend) {
                const ct = data.counterTrend;
                const bx = timeScale.logicalToCoordinate(ct.anchor1.barIndex as Logical);
                const by = this._series!.priceToCoordinate(ct.anchor1.price);
                const cx = timeScale.logicalToCoordinate(ct.anchor2.barIndex as Logical);
                const cy = this._series!.priceToCoordinate(ct.anchor2.price);

                if (bx !== null && by !== null && cx !== null && cy !== null) {
                    let endPrice = (data.isLog && ct.logSlope !== undefined)
                        ? ct.anchor1.price * Math.exp(ct.logSlope * (rightExt - ct.anchor1.barIndex))
                        : ct.anchor1.price + ct.slope * (rightExt - ct.anchor1.barIndex);

                    if (!isFinite(endPrice) || isNaN(endPrice)) endPrice = ct.anchor2.price;
                    const endY = this._series!.priceToCoordinate(endPrice);

                    if (endY !== null) {
                        ctx.save();
                        ctx.strokeStyle = alertColor;
                        ctx.lineWidth = 2.0;
                        ctx.setLineDash([4, 4]);

                        ctx.beginPath();
                        ctx.moveTo(bx, by);
                        ctx.lineTo(rightX, endY);
                        ctx.stroke();
                        ctx.restore();

                        // Line Label
                        ctx.save();
                        ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        ctx.fillStyle = alertColor;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        const ctTitle = ct.pattern === 'failure_swing'
                            ? (isUptrend ? 'Tentative Down-Trendline (Pre-H&S)' : 'Tentative Up-Trendline (Pre-Inv H&S)')
                            : (ct.pattern === 'double_top' ? 'Double Top Resistance' : 'Double Bottom Support');
                        ctx.fillText(ctTitle, rightX + 8, endY);
                        ctx.restore();
                    }

                    // Render Anchor Badges B1 and C1
                    const renderAlertDot = (x: number, y: number, text: string) => {
                        ctx.save();
                        ctx.fillStyle = alertColor;
                        ctx.beginPath();
                        ctx.arc(x, y, 4, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();

                        ctx.font = 'bold 9px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        const m = ctx.measureText(text);
                        const bW = m.width + 8;
                        const bH = 14;
                        const offY = isUptrend ? -14 : 14;
                        const bX = x - bW / 2;
                        const bY = y + offY - bH / 2;

                        ctx.fillStyle = 'rgba(28, 32, 48, 0.90)';
                        ctx.beginPath();
                        if (typeof ctx.roundRect === 'function') ctx.roundRect(bX, bY, bW, bH, 3);
                        else ctx.rect(bX, bY, bW, bH);
                        ctx.fill();
                        ctx.strokeStyle = alertColor;
                        ctx.lineWidth = 1;
                        ctx.stroke();

                        ctx.fillStyle = '#ffffff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(text, bX + bW / 2, bY + bH / 2);
                        ctx.restore();
                    };

                    renderAlertDot(bx, by, ct.anchor1.label);
                    renderAlertDot(cx, cy, ct.anchor2.label);
                }
            }

            // =========================================================================
            // 4. Status & Diagnostics Badge near Latest Candle
            // =========================================================================
            const currX = timeScale.logicalToCoordinate(data.lastBarIndex as Logical);
            const currY = this._series!.priceToCoordinate(data.currentPrice);

            if (currX !== null && currY !== null) {
                ctx.save();
                let statusText = '';
                let badgeBg = 'rgba(28, 32, 48, 0.92)';
                let badgeBorder = mainColor;

                if (data.status === 'failure_swing') {
                    statusText = isUptrend
                        ? '⚠️ [Failure Swing] Lower High C1 (Pre-Head & Shoulders Warning)'
                        : '⚡ [Failure Swing] Higher Low C1 (Pre-Inverted H&S Warning)';
                    badgeBg = 'rgba(255, 167, 38, 0.92)';
                    badgeBorder = '#ffffff';
                } else if (data.status === 'double_top_risk') {
                    statusText = '⚠️ [Double Top] Tested Peak B1 (Watch S2 Neckline Trigger)';
                    badgeBg = 'rgba(239, 83, 80, 0.92)';
                    badgeBorder = '#ffffff';
                } else if (data.status === 'double_bottom_risk') {
                    statusText = '⚡ [Double Bottom] Tested Low B1 (Watch R2 Neckline Trigger)';
                    badgeBg = 'rgba(38, 166, 154, 0.92)';
                    badgeBorder = '#ffffff';
                } else if (data.status === 'major_broken') {
                    statusText = isUptrend
                        ? `🚨 [Break] S1 Broken -> Testing Floor ${data.horizontalSteps[0]?.label || 'S2'}`
                        : `🎯 [Breakout] R1 Broken -> Testing Ceiling ${data.horizontalSteps[0]?.label || 'R2'}`;
                    badgeBorder = '#FFA726';
                } else {
                    statusText = isUptrend
                        ? `Uptrend Structure (S1 Major Trendline & Staircase Floor S2-S${data.horizontalSteps.length + 1} Intact)`
                        : `Downtrend Structure (R1 Major Trendline & Staircase Ceiling R2-R${data.horizontalSteps.length + 1} Intact)`;
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
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(statusText, sX + 7, sY + sHeight / 2);
                ctx.restore();
            }
        });
    }
}

class TrendStructurePaneView implements IPrimitivePaneView {
    private _renderer: TrendStructurePaneRenderer;

    constructor(
        data: TrendStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new TrendStructurePaneRenderer(data, series, chart);
    }

    public update(
        data: TrendStructureData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public renderer(): IPrimitivePaneRenderer {
        return this._renderer;
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }
}

export class TrendStructurePrimitive implements ISeriesPrimitive<Time> {
    private _data: TrendStructureData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _paneView: TrendStructurePaneView;

    constructor() {
        this._paneView = new TrendStructurePaneView(this._data, this._series, this._chart);
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._paneView.update(this._data, this._series, this._chart);
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._paneView.update(null, null, null);
    }

    public updateAllViews(): void {
        this._paneView.update(this._data, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public setStructure(data: TrendStructureData | null): void {
        this._data = data;
        this.updateAllViews();
        if (this._series) {
            this._series.applyOptions({});
        }
    }

    public clearStructure(): void {
        this._data = null;
        this.updateAllViews();
        if (this._series) {
            this._series.applyOptions({});
        }
    }
}
