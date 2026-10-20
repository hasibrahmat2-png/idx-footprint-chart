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
import { DetectedChartPattern } from './chart-pattern-detector';

export interface ChartPatternPrimitiveData {
    patterns: DetectedChartPattern[];
    visible: boolean;
    isForex: boolean;
}

function fmtPrice(val: number, isForex: boolean): string {
    if (isForex) {
        if (val >= 100) return val.toFixed(2);
        if (val >= 1) return val.toFixed(4);
        return val.toFixed(5);
    }
    return Math.round(val).toLocaleString('id-ID');
}

class ChartPatternPaneRenderer implements IPrimitivePaneRenderer {
    private _data: ChartPatternPrimitiveData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: ChartPatternPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: ChartPatternPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || !this._data || this._data.visible === false) return;
        if (!this._data.patterns || this._data.patterns.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            const isForex = this._data!.isForex;

            for (const pat of this._data!.patterns) {
                // Viewport culling to preserve 60 FPS on Chromebook Celeron
                if (visibleRange) {
                    if (pat.endIndex < visibleRange.from - 20 || pat.startIndex > visibleRange.to + 20) {
                        continue;
                    }
                }

                const isBullish = pat.direction === 'bullish';
                const isReached = pat.status === 'target_reached';
                const isFailed = pat.status === 'failed';

                // Color palette matching ghost candle
                const baseColor = isBullish ? '#26A69A' : '#EF5350';
                const lineColor = (isReached || isFailed)
                    ? (isBullish ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)')
                    : (isBullish ? 'rgba(38, 166, 154, 0.95)' : 'rgba(239, 83, 80, 0.95)');
                const textColor = (isReached || isFailed)
                    ? (isBullish ? 'rgba(38, 166, 154, 0.55)' : 'rgba(239, 83, 80, 0.55)')
                    : baseColor;

                // 1. Draw Pattern Boundary, Contour & Neckline Lines
                ctx.save();
                for (const line of pat.lines) {
                    const x1 = timeScale.timeToCoordinate(line.x1Time) ?? timeScale.logicalToCoordinate(line.x1Index as Logical);
                    const x2 = timeScale.timeToCoordinate(line.x2Time) ?? timeScale.logicalToCoordinate(line.x2Index as Logical);
                    if (x1 === null || x2 === null) continue;

                    const y1 = this._series!.priceToCoordinate(line.y1Price);
                    const y2 = this._series!.priceToCoordinate(line.y2Price);
                    if (y1 === null || y2 === null) continue;

                    ctx.beginPath();
                    ctx.strokeStyle = line.color || lineColor;

                    if (line.role === 'neckline') {
                        ctx.lineWidth = 1.8;
                    } else if (line.role === 'connector' || line.role === 'box_wall') {
                        ctx.lineWidth = 1.4;
                    } else if (line.role === 'measured_move') {
                        ctx.lineWidth = 1.2;
                    } else {
                        ctx.lineWidth = 1.5;
                    }

                    if (line.style === 'dotted') {
                        ctx.setLineDash([2, 3]);
                    } else if (line.style === 'dashed') {
                        ctx.setLineDash([5, 4]);
                    } else {
                        ctx.setLineDash([]);
                    }

                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    // If target ray, draw bracket ticks at target level
                    if (line.role === 'target_ray') {
                        ctx.setLineDash([]);
                        ctx.beginPath();
                        ctx.moveTo(x2 - 4, y2 - 4);
                        ctx.lineTo(x2 + 4, y2 - 4);
                        ctx.moveTo(x2 - 4, y2 + 4);
                        ctx.lineTo(x2 + 4, y2 + 4);
                        ctx.stroke();
                    }
                }
                ctx.restore();

                // 2. Draw Anchor Pivot Markers (Minimalist 2.5px Dot + Truly Transparent Floating Label)
                ctx.save();
                for (const anc of pat.anchors) {
                    const ax = timeScale.timeToCoordinate(anc.time) ?? timeScale.logicalToCoordinate(anc.index as Logical);
                    if (ax === null || ax < -30 || ax > width + 30) continue;
                    const ay = this._series!.priceToCoordinate(anc.price);
                    if (ay === null) continue;

                    // Anchor Dot
                    ctx.beginPath();
                    ctx.fillStyle = lineColor;
                    ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
                    ctx.fill();

                    // Anchor Text Badge (e.g. LS, H, RS, N1, N2, T1, T2, Apex, R1, S1) - Truly Transparent Floating Text
                    // Strict adherence to Obsidian Vault Invariant: zero rectangular background boxes, zero borders
                    if (anc.label && anc.label.length > 0) {
                        ctx.font = 'bold 9px "JetBrains Mono", Inter, -apple-system, sans-serif';
                        const isHigh = anc.label.includes('H') || anc.label.includes('LS') || anc.label.includes('RS') || anc.label.includes('T') || anc.label.includes('R') || anc.label.includes('Rim') || anc.label.includes('Peak') || anc.label.includes('Top') || anc.label.includes('Apex');
                        const badgeY = isHigh ? ay - 6 : ay + 6;

                        ctx.fillStyle = lineColor;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = isHigh ? 'bottom' : 'top';
                        ctx.fillText(anc.label, ax, badgeY);
                    }
                }
                ctx.restore();

                // 3. Floating Transparent Text Label: <Nama Pola> Target <Harga> (±X.X%) Vol <Ratio>x [<Status>]
                // Placed near the pattern end or breakout point
                const labelAnchor = pat.anchors[pat.anchors.length - 1];
                const lx = timeScale.timeToCoordinate(labelAnchor.time) ?? timeScale.logicalToCoordinate(labelAnchor.index as Logical);
                if (lx === null || lx < -100 || lx > width + 100) continue;

                const targetY = this._series!.priceToCoordinate(pat.targetPrice);
                const anchorY = this._series!.priceToCoordinate(labelAnchor.price);
                if (targetY === null || anchorY === null) continue;

                const targetStr = fmtPrice(pat.targetPrice, isForex);
                const signStr = pat.targetPercent >= 0 ? `+${pat.targetPercent.toFixed(1)}%` : `${pat.targetPercent.toFixed(1)}%`;
                const volStr = `${pat.volumeRatio.toFixed(1)}x`;

                let statusBadge = pat.status.toUpperCase();
                if (pat.specialFlag === 'hound_of_baskervilles') {
                    statusBadge = 'HOUND OF BASKERVILLES TRAP';
                }

                const fullLabel = `${pat.name} Target ${targetStr} (${signStr}) Vol ${volStr} [${statusBadge}]`;

                ctx.save();
                ctx.font = 'bold 10px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = textColor;
                ctx.textBaseline = 'middle';

                const textWidth = ctx.measureText(fullLabel).width;
                let textX = lx + 6;
                if (textX + textWidth > width - 10) {
                    textX = lx - textWidth - 6;
                    ctx.textAlign = 'left';
                } else {
                    ctx.textAlign = 'left';
                }

                const textY = (anchorY + targetY) / 2;
                ctx.fillText(fullLabel, textX, textY);
                ctx.restore();
            }
        });
    }
}

class ChartPatternPaneView implements IPrimitivePaneView {
    private _renderer: ChartPatternPaneRenderer;

    constructor(
        data: ChartPatternPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new ChartPatternPaneRenderer(data, series, chart);
    }

    public update(
        data: ChartPatternPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public renderer(): IPrimitivePaneRenderer {
        return this._renderer;
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }
}

export class ChartPatternPrimitive implements ISeriesPrimitive<Time> {
    private _data: ChartPatternPrimitiveData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _paneView: ChartPatternPaneView;

    constructor() {
        this._paneView = new ChartPatternPaneView(null, null, null);
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

    public setData(data: ChartPatternPrimitiveData | null): void {
        this._data = data;
        this._paneView.update(this._data, this._series, this._chart);
        this._series?.applyOptions({});
    }

    public clearData(): void {
        this.setData(null);
    }

    public updateAllViews(): void {
        this._paneView.update(this._data, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }
}
