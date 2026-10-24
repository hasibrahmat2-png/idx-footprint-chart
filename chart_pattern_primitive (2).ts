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
    ITimeScaleApi,
    Logical,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DetectedChartPattern } from './chart-pattern-detector';

export interface ChartPatternPrimitiveData {
    patterns: DetectedChartPattern[];
    visible: boolean;
    isForex: boolean;
}

interface LabelBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

function fmtPrice(val: number, isForex: boolean): string {
    if (isForex) {
        if (val >= 100) return val.toFixed(2);
        if (val >= 1) return val.toFixed(4);
        return val.toFixed(5);
    }
    return Math.round(val).toLocaleString('id-ID');
}

/**
 * Resolves X coordinate reliably even when `logicalIndex` projects into the future
 * beyond the last loaded bar (`time === undefined`).
 */
function resolveX(
    timeScale: ITimeScaleApi<Time>,
    time: Time | undefined,
    logicalIndex: number
): number | null {
    if (time !== undefined) {
        const coord = timeScale.timeToCoordinate(time);
        if (coord !== null) return coord;
    }
    return timeScale.logicalToCoordinate(logicalIndex as Logical);
}

/**
 * Draws crisp floating text with a dark halo stroke (zero rectangular background boxes,
 * zero borders — strictly honoring the Obsidian Vault Invariant while ensuring 100% legibility over candles).
 */
function drawHaloText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fillColor: string,
    align: CanvasTextAlign = 'left',
    baseline: CanvasTextBaseline = 'middle',
    font: string = 'bold 10px "JetBrains Mono", Inter, -apple-system, sans-serif'
): void {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = 'rgba(11, 14, 20, 0.88)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.restore();
}

/**
 * Draws a small directional arrowhead at (x2, y2) pointing from (x1, y1)
 */
function drawArrowhead(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    size: number = 4.5
): void {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - size * Math.cos(angle - Math.PI / 6),
        y2 - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        x2 - size * Math.cos(angle + Math.PI / 6),
        y2 - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
            const height = mediaSize.height;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            const isForex = this._data!.isForex;
            const placedLabels: LabelBox[] = [];

            const resolveNonOverlappingY = (
                x: number,
                preferredY: number,
                w: number,
                h: number,
                shiftUp: boolean
            ): number => {
                let curY = Math.max(14, Math.min(height - 14, preferredY));
                const step = shiftUp ? -13 : 13;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const hasCollision = placedLabels.some(
                        (b) =>
                            Math.abs(x - b.x) < (w + b.w) * 0.55 &&
                            Math.abs(curY - b.y) < (h + b.h) * 0.65
                    );
                    if (!hasCollision) break;
                    curY = Math.max(14, Math.min(height - 14, curY + step));
                }
                placedLabels.push({ x, y: curY, w, h });
                return curY;
            };

            for (const pat of this._data!.patterns) {
                if (visibleRange) {
                    if (
                        pat.endIndex < visibleRange.from - 25 ||
                        pat.startIndex > visibleRange.to + 25
                    ) {
                        continue;
                    }
                }

                const isBullish = pat.direction === 'bullish';
                const isDimmed = pat.status === 'target_reached' || pat.status === 'failed';

                const primaryColor = isDimmed
                    ? isBullish
                        ? 'rgba(38, 166, 154, 0.52)'
                        : 'rgba(239, 83, 80, 0.52)'
                    : isBullish
                      ? 'rgba(38, 166, 154, 0.96)'
                      : 'rgba(239, 83, 80, 0.96)';

                const connectorColor = isDimmed
                    ? isBullish
                        ? 'rgba(38, 166, 154, 0.30)'
                        : 'rgba(239, 83, 80, 0.30)'
                    : isBullish
                      ? 'rgba(38, 166, 154, 0.62)'
                      : 'rgba(239, 83, 80, 0.62)';

                const fillColor = isDimmed
                    ? isBullish
                        ? 'rgba(38, 166, 154, 0.03)'
                        : 'rgba(239, 83, 80, 0.03)'
                    : isBullish
                      ? 'rgba(38, 166, 154, 0.075)'
                      : 'rgba(239, 83, 80, 0.075)';

                const labelColor = isDimmed
                    ? isBullish
                        ? 'rgba(38, 166, 154, 0.68)'
                        : 'rgba(239, 83, 80, 0.68)'
                    : isBullish
                      ? '#26A69A'
                      : '#EF5350';

                // -----------------------------------------------------------------
                // 1. Draw Subtle Geometric Polygon Fill
                // -----------------------------------------------------------------
                if (pat.fillPolygon && pat.fillPolygon.length >= 3) {
                    const pts: Array<{ x: number; y: number }> = [];
                    for (const v of pat.fillPolygon) {
                        const vx = resolveX(timeScale, v.time, v.index);
                        const vy = this._series!.priceToCoordinate(v.price);
                        if (vx !== null && vy !== null) {
                            pts.push({ x: vx, y: vy });
                        }
                    }
                    if (pts.length >= 3) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(pts[0].x, pts[0].y);
                        for (let k = 1; k < pts.length; k++) {
                            ctx.lineTo(pts[k].x, pts[k].y);
                        }
                        ctx.closePath();
                        ctx.fillStyle = fillColor;
                        ctx.fill();
                        ctx.restore();
                    }
                }

                // -----------------------------------------------------------------
                // 2. Draw Pattern Lines with Clear Visual Hierarchy
                // -----------------------------------------------------------------
                let targetRayCoords: { x1: number; x2: number; y: number } | null = null;

                ctx.save();
                for (const line of pat.lines) {
                    const x1 = resolveX(timeScale, line.x1Time, line.x1Index);
                    const x2 = resolveX(timeScale, line.x2Time, line.x2Index);
                    if (x1 === null || x2 === null) continue;

                    const y1 = this._series!.priceToCoordinate(line.y1Price);
                    const y2 = this._series!.priceToCoordinate(line.y2Price);
                    if (y1 === null || y2 === null) continue;

                    if (
                        line.role === 'cup_curve' &&
                        line.ctrlIndex !== undefined &&
                        line.ctrlPrice !== undefined
                    ) {
                        const baseX = resolveX(timeScale, undefined, line.ctrlIndex);
                        const baseY = this._series!.priceToCoordinate(line.ctrlPrice);
                        if (baseX !== null && baseY !== null) {
                            const cpx = 2 * baseX - 0.5 * (x1 + x2);
                            const cpy = 2 * baseY - 0.5 * (y1 + y2);

                            ctx.beginPath();
                            ctx.moveTo(x1, y1);
                            ctx.quadraticCurveTo(cpx, cpy, x2, y2);
                            ctx.closePath();
                            ctx.fillStyle = fillColor;
                            ctx.fill();

                            ctx.beginPath();
                            ctx.setLineDash([]);
                            ctx.lineWidth = 1.75;
                            ctx.strokeStyle = primaryColor;
                            ctx.moveTo(x1, y1);
                            ctx.quadraticCurveTo(cpx, cpy, x2, y2);
                            ctx.stroke();
                            continue;
                        }
                    }

                    if (line.role === 'neckline') {
                        ctx.strokeStyle = primaryColor;
                        ctx.lineWidth = 1.85;
                        ctx.setLineDash([]);
                    } else if (
                        line.role === 'upper_boundary' ||
                        line.role === 'lower_boundary' ||
                        line.role === 'flagpole'
                    ) {
                        ctx.strokeStyle = primaryColor;
                        ctx.lineWidth = 1.65;
                        ctx.setLineDash(line.style === 'dashed' ? [5, 4] : []);
                    } else if (line.role === 'connector') {
                        ctx.strokeStyle = connectorColor;
                        ctx.lineWidth = 1.25;
                        // Respect dashed style for unconfirmed FORMING leg toward neckline
                        ctx.setLineDash(line.style === 'dashed' ? [4, 4] : []);
                    } else if (line.role === 'box_wall') {
                        ctx.strokeStyle = connectorColor;
                        ctx.lineWidth = 1.15;
                        ctx.setLineDash([3, 3]);
                    } else if (line.role === 'measured_move') {
                        ctx.strokeStyle = connectorColor;
                        ctx.lineWidth = 1.15;
                        ctx.setLineDash([2, 3]);
                    } else if (line.role === 'target_ray') {
                        ctx.strokeStyle = primaryColor;
                        ctx.lineWidth = 1.55;
                        ctx.setLineDash([6, 4]);
                        targetRayCoords = { x1, x2, y: y2 };
                    } else {
                        ctx.strokeStyle = primaryColor;
                        ctx.lineWidth = 1.4;
                        ctx.setLineDash([]);
                    }

                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    if (
                        line.role === 'measured_move' &&
                        Math.abs(y2 - y1) > 14 &&
                        Math.abs(y2 - (this._series!.priceToCoordinate(pat.targetPrice) ?? -999)) < 3
                    ) {
                        drawArrowhead(ctx, x1, y1, x2, y2, primaryColor, 4.5);
                    }

                    if (line.role === 'target_ray') {
                        ctx.setLineDash([]);
                        ctx.beginPath();
                        ctx.arc(x2, y2, 2.5, 0, Math.PI * 2);
                        ctx.fillStyle = primaryColor;
                        ctx.fill();
                    }
                }
                ctx.restore();

                // -----------------------------------------------------------------
                // 3. Draw Anchor Pivot Dots & Minimalist Pivot Badges
                // -----------------------------------------------------------------
                let minAnchorY = Infinity;
                let maxAnchorY = -Infinity;
                let sumAnchorX = 0;
                let validAnchorCount = 0;

                ctx.save();
                for (const anc of pat.anchors) {
                    const ax = resolveX(timeScale, anc.time, anc.index);
                    if (ax === null) continue;
                    const ay = this._series!.priceToCoordinate(anc.price);
                    if (ay === null) continue;

                    if (ay < minAnchorY) minAnchorY = ay;
                    if (ay > maxAnchorY) maxAnchorY = ay;
                    sumAnchorX += ax;
                    validAnchorCount++;

                    if (ax < -30 || ax > width + 30) continue;

                    ctx.beginPath();
                    ctx.fillStyle = primaryColor;
                    ctx.arc(ax, ay, 2.6, 0, Math.PI * 2);
                    ctx.fill();

                    if (anc.label && anc.label.length > 0) {
                        const isTopAnchor =
                            anc.label.startsWith('H') ||
                            anc.label.startsWith('LS') ||
                            anc.label.startsWith('RS') ||
                            anc.label.startsWith('T') ||
                            anc.label.startsWith('R') ||
                            anc.label === 'N' && pat.type === 'double_bottom' ||
                            anc.label === 'P1' ||
                            anc.label === 'P2' ||
                            anc.label === 'B';
                        const badgeY = isTopAnchor ? ay - 7 : ay + 7;
                        drawHaloText(
                            ctx,
                            anc.label,
                            ax,
                            badgeY,
                            labelColor,
                            'center',
                            isTopAnchor ? 'bottom' : 'top',
                            'bold 9px "JetBrains Mono", Inter, -apple-system, sans-serif'
                        );
                    }
                }
                ctx.restore();

                if (validAnchorCount === 0) continue;

                // -----------------------------------------------------------------
                // 4. Draw Breakout Marker (if pattern has broken out)
                // -----------------------------------------------------------------
                if (pat.breakoutIndex !== undefined && pat.breakoutPrice !== undefined) {
                    const bx = resolveX(timeScale, pat.breakoutTime, pat.breakoutIndex);
                    const by = this._series!.priceToCoordinate(pat.breakoutPrice);
                    if (bx !== null && by !== null && bx >= 0 && bx <= width) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.strokeStyle = primaryColor;
                        ctx.lineWidth = 1.6;
                        ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.restore();
                    }
                }

                // -----------------------------------------------------------------
                // 5. Separated Pattern Title Header & Target Price Label
                // -----------------------------------------------------------------
                const centerX = Math.max(
                    60,
                    Math.min(width - 140, sumAnchorX / validAnchorCount)
                );

                let statusBadge = pat.status.toUpperCase();
                if (pat.specialFlag === 'hound_of_baskervilles') {
                    statusBadge = 'HOUND TRAP';
                } else if (pat.specialFlag === 'apex_approaching' && pat.status === 'forming') {
                    statusBadge = 'APEX ZONE';
                }

                const volTag =
                    pat.status !== 'forming'
                        ? ` · Vol ${pat.volumeRatio.toFixed(1)}x${pat.isVolumeConfirmed ? '✓' : ''}`
                        : '';
                const headerText = `${pat.name} [${statusBadge}${volTag}]`;

                const isInvertedPattern =
                    pat.type === 'inverted_head_and_shoulders' ||
                    pat.type === 'double_bottom' ||
                    pat.type === 'triple_bottom' ||
                    pat.type === 'horn_bottom';
                const rawHeaderY = isInvertedPattern ? maxAnchorY + 20 : minAnchorY - 18;
                const headerWidth = headerText.length * 6.2;
                const safeHeaderY = resolveNonOverlappingY(
                    centerX,
                    rawHeaderY,
                    headerWidth,
                    14,
                    !isInvertedPattern
                );

                drawHaloText(
                    ctx,
                    headerText,
                    centerX,
                    safeHeaderY,
                    labelColor,
                    'center',
                    'middle',
                    'bold 10px "JetBrains Mono", Inter, -apple-system, sans-serif'
                );

                if (targetRayCoords) {
                    const targetStr = fmtPrice(pat.targetPrice, isForex);
                    const signStr =
                        pat.targetPercent >= 0
                            ? `+${pat.targetPercent.toFixed(1)}%`
                            : `${pat.targetPercent.toFixed(1)}%`;
                    const prefix = pat.status === 'forming' ? 'Est. Target' : 'Target';
                    const targetLabel = `${prefix} ${targetStr} (${signStr})`;
                    const targetLabelW = targetLabel.length * 6.0;

                    const preferRight = targetRayCoords.x2 + 6 + targetLabelW < width - 8;
                    const tx = preferRight ? targetRayCoords.x2 + 6 : targetRayCoords.x2 - 4;
                    const tAlign: CanvasTextAlign = preferRight ? 'left' : 'right';
                    const tRawY = preferRight
                        ? targetRayCoords.y
                        : isBullish
                          ? targetRayCoords.y - 9
                          : targetRayCoords.y + 9;

                    const safeTargetY = resolveNonOverlappingY(
                        tx,
                        tRawY,
                        targetLabelW,
                        13,
                        isBullish
                    );

                    drawHaloText(
                        ctx,
                        targetLabel,
                        tx,
                        safeTargetY,
                        labelColor,
                        tAlign,
                        'middle',
                        'bold 9.5px "JetBrains Mono", Inter, -apple-system, sans-serif'
                    );
                }
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