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

export interface DowAnchor {
    time: Time;
    price: number;
    label: string;      // "A", "B", "C", "D"
    role: string;       // "Res", "Low", "HH", "HL", "Sup", "High", "LH", "LL"
    barIndex: number;
}

export type DowSignalType =
    | 'valid_buy'                 // Gambar 133 (Valid Buy: HH + HL + Res Break)
    | 'valid_sell'                // Gambar 134 (Valid Sell: LH + LL + Sup Break)
    | 'unconfirmed_sell_gbr135'   // Gambar 135 (LL formed, but missing LH)
    | 'unconfirmed_sell_gbr136'   // Gambar 136 (LH formed, but Support intact)
    | 'unconfirmed_buy_gbr137'    // Gambar 137 (HH formed, but missing HL)
    | 'unconfirmed_buy_gbr138'    // Gambar 138 (HL formed, but Resistance intact)
    | 'dilemma_leg1'              // Gambar 139 (High volume breakdown, potential Leg 1)
    | 'dilemma_normal_pullback';  // Gambar 139 (Low volume normal correction)

export interface DowValidationData {
    id: string;
    signalType: DowSignalType;
    direction: 'bullish' | 'bearish' | 'neutral';
    anchors: {
        A: DowAnchor;
        B: DowAnchor;
        C: DowAnchor;
        D: DowAnchor;
    };
    triggerLine: {
        level: number;
        formattedLevel?: string;
        type: 'resistance' | 'support';
        isBroken: boolean;
    };
    statusTitle: string;
    statusBadge: string;
    statusDetail: string;
    volumeRatio?: number;
    lastBarIndex: number;
    lastTime: Time;
    currentPrice: number;
    isLog?: boolean;
}

class DowValidationPaneRenderer implements IPrimitivePaneRenderer {
    private _data: DowValidationData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: DowValidationData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: DowValidationData | null,
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

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            const data = this._data!;
            const isBullish = data.direction === 'bullish';
            const mainColor = isBullish ? '#26A69A' : (data.direction === 'bearish' ? '#EF5350' : '#FFA726');

            const rightExt = visibleRange
                ? Math.max(data.lastBarIndex + 8, Math.ceil(visibleRange.to) + 4)
                : data.lastBarIndex + 8;

            const rightX = timeScale.logicalToCoordinate(rightExt as Logical) ?? width;

            // =========================================================================
            // 1. Draw Trigger Line across Anchor A
            // =========================================================================
            const trigY = this._series!.priceToCoordinate(data.triggerLine.level);
            const trigStartX = timeScale.logicalToCoordinate(data.anchors.A.barIndex as Logical);

            if (trigY !== null && trigStartX !== null) {
                ctx.save();
                ctx.strokeStyle = data.triggerLine.type === 'resistance' ? '#26A69A' : '#EF5350';
                ctx.lineWidth = data.triggerLine.isBroken ? 2.0 : 1.5;
                ctx.setLineDash([6, 4]);

                ctx.beginPath();
                ctx.moveTo(trigStartX, trigY);
                ctx.lineTo(rightX, trigY);
                ctx.stroke();
                ctx.restore();

                // Right Margin Trigger Label
                ctx.save();
                ctx.font = 'bold 9px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const lvlStr = data.triggerLine.formattedLevel || (data.triggerLine.level >= 100 ? data.triggerLine.level.toFixed(0) : (data.triggerLine.level >= 2 ? data.triggerLine.level.toFixed(2) : data.triggerLine.level.toFixed(4)));
                const trigLabel = data.triggerLine.type === 'resistance'
                    ? `Dow Buy Trigger (Res ${lvlStr})`
                    : `Dow Sell Trigger (Sup ${lvlStr})`;
                const m = ctx.measureText(trigLabel);
                const bW = m.width + 10;
                const bH = 15;
                const bX = Math.min(width - bW - 6, rightX + 6);
                const bY = trigY - bH / 2;

                ctx.fillStyle = 'rgba(28, 32, 48, 0.90)';
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') ctx.roundRect(bX, bY, bW, bH, 3);
                else ctx.rect(bX, bY, bW, bH);
                ctx.fill();

                ctx.strokeStyle = data.triggerLine.type === 'resistance' ? '#26A69A' : '#EF5350';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(trigLabel, bX + bW / 2, bY + bH / 2);
                ctx.restore();
            }

            // =========================================================================
            // 2. Draw Swing Zigzag Connecting B -> A -> D -> C
            // =========================================================================
            const pts = [data.anchors.B, data.anchors.A, data.anchors.D, data.anchors.C];
            const coords: { x: number; y: number }[] = [];

            pts.forEach(pt => {
                const x = timeScale.logicalToCoordinate(pt.barIndex as Logical);
                const y = this._series!.priceToCoordinate(pt.price);
                if (x !== null && y !== null) coords.push({ x, y });
            });

            if (coords.length >= 2) {
                ctx.save();
                ctx.strokeStyle = 'rgba(120, 123, 134, 0.65)';
                ctx.lineWidth = 1.6;
                ctx.setLineDash([3, 3]);

                ctx.beginPath();
                ctx.moveTo(coords[0].x, coords[0].y);
                for (let i = 1; i < coords.length; i++) {
                    ctx.lineTo(coords[i].x, coords[i].y);
                }
                ctx.stroke();
                ctx.restore();
            }

            // =========================================================================
            // 3. Draw Anchor Badges (A, B, C, D)
            // =========================================================================
            pts.forEach(pt => {
                const x = timeScale.logicalToCoordinate(pt.barIndex as Logical);
                const y = this._series!.priceToCoordinate(pt.price);
                if (x === null || y === null) return;

                const isHighPivot = pt.role.includes('High') || pt.role.includes('Res') || pt.role.includes('HH') || pt.role.includes('LH');
                const dotColor = isHighPivot ? '#FFA726' : '#42A5F5';

                ctx.save();
                ctx.fillStyle = dotColor;
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Pill Label: e.g. "C (HH)" or "D (HL)"
                const text = `${pt.label} (${pt.role})`;
                ctx.font = 'bold 9px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const offY = isHighPivot ? -14 : 14;

                // Clean transparent label without background or border
                ctx.fillStyle = dotColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, x, y + offY);
                ctx.restore();
            });

            // =========================================================================
            // 4. Draw Diagnostic Status Badge near Current Candle: Clean transparent text without background or border
            // =========================================================================
            const curX = timeScale.logicalToCoordinate(data.lastBarIndex as Logical);
            const curY = this._series!.priceToCoordinate(data.currentPrice);

            if (curX !== null && curY !== null) {
                ctx.save();
                const badgeText = data.statusBadge;
                ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const m = ctx.measureText(badgeText);
                const bW = m.width + 16;
                const bX = Math.min(width - bW - 12, curX + 16);
                const bY = Math.max(30, curY - 35);

                // Status text: clean floating text
                ctx.fillStyle = mainColor;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(badgeText, bX, bY);
                ctx.restore();
            }
        });
    }
}

class DowValidationPaneView implements IPrimitivePaneView {
    private _renderer: DowValidationPaneRenderer;

    constructor(
        data: DowValidationData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new DowValidationPaneRenderer(data, series, chart);
    }

    public update(
        data: DowValidationData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }

    public renderer(): IPrimitivePaneRenderer {
        return this._renderer;
    }
}

export class DowValidationPrimitive implements ISeriesPrimitive<Time> {
    private _data: DowValidationData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _paneView: DowValidationPaneView;

    constructor() {
        this._paneView = new DowValidationPaneView(null, null, null);
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

    public setData(data: DowValidationData | null): void {
        this._data = data;
        this.updateAllViews();
    }

    public updateAllViews(): void {
        this._paneView.update(this._data, this._series, this._chart);
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
