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

export interface TradePosition {
    id: string;
    symbol: string;
    entryTime: number; // Unix seconds
    entryDatetime: string;
    entryDate: string; // YYYY-MM-DD
    entryPrice: number;
    exitTime: number; // Unix seconds
    exitDatetime: string;
    exitDate: string; // YYYY-MM-DD
    exitPrice: number;
    shares: number;
    lot: number;
    realizedAmount: number;
    realizedPercentage: number;
    isWin: boolean;
    isDayTrade: boolean;
    entryBarIndex?: number;
    exitBarIndex?: number;
    showBox?: boolean;
    entryBarLow?: number;
    entryBarHigh?: number;
    exitBarLow?: number;
    exitBarHigh?: number;
    isOpen?: boolean;
    currentPrice?: number;
    currency?: string;
    type?: string;
    command?: string;
    isFocused?: boolean;
}

class TradePositionPaneRenderer implements IPrimitivePaneRenderer {
    private _positions: TradePosition[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _visible: boolean = true;

    constructor(
        positions: TradePosition[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean = true
    ) {
        this._positions = positions;
        this._series = series;
        this._chart = chart;
        this._visible = visible;
    }

    public update(
        positions: TradePosition[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean
    ): void {
        this._positions = positions;
        this._series = series;
        this._chart = chart;
        this._visible = visible;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._visible || !this._series || !this._chart || this._positions.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const timeScale = this._chart!.timeScale();
            const occupiedBadges: { x: number; y: number; w: number; h: number }[] = [];

            for (const pos of this._positions) {
                // Determine horizontal coordinates
                let x1: number | null = null;
                let x2: number | null = null;

                if (pos.entryBarIndex !== undefined && pos.entryBarIndex >= 0) {
                    x1 = timeScale.logicalToCoordinate(pos.entryBarIndex as Logical);
                }
                if (pos.exitBarIndex !== undefined && pos.exitBarIndex >= 0) {
                    x2 = timeScale.logicalToCoordinate(pos.exitBarIndex as Logical);
                }

                // Fallback to timeToCoordinate if bar indices are not directly mapped
                if (x1 === null) {
                    x1 = timeScale.timeToCoordinate(pos.entryTime as Time);
                }
                if (x2 === null) {
                    x2 = timeScale.timeToCoordinate(pos.exitTime as Time);
                }

                // If both are completely off-screen / non-existent, skip
                if (x1 === null && x2 === null) continue;

                // Adjust single-bar or intraday day-trade minimum width
                if (x1 !== null && x2 === null) x2 = x1 + 24;
                if (x2 !== null && x1 === null) x1 = x2 - 24;

                let minX = Math.min(x1!, x2!);
                let maxX = Math.max(x1!, x2!);

                if (maxX - minX < 20) {
                    const mid = (minX + maxX) / 2;
                    minX = mid - 12;
                    maxX = mid + 12;
                }

                // Determine vertical coordinates from prices
                const yEntry = this._series!.priceToCoordinate(pos.entryPrice);
                const yExit = this._series!.priceToCoordinate(pos.exitPrice);

                if (yEntry === null && yExit === null) continue;

                const validYEntry = yEntry !== null ? yEntry : (yExit !== null ? yExit : mediaSize.height / 2);
                const validYExit = yExit !== null ? yExit : (yEntry !== null ? yEntry : mediaSize.height / 2);

                const minY = Math.min(validYEntry, validYExit);
                const maxY = Math.max(validYEntry, validYExit);
                const boxHeight = Math.max(4, maxY - minY);
                const boxWidth = maxX - minX;

                const isGain = pos.isWin;
                const showBox = pos.showBox !== false;
                const isOpen = Boolean(pos.isOpen);

                let fillColor = isGain ? 'rgba(38, 166, 154, 0.22)' : 'rgba(239, 83, 80, 0.22)';
                let borderColor = isGain ? '#26A69A' : '#EF5350';

                if (isOpen) {
                    fillColor = isGain ? 'rgba(38, 166, 154, 0.16)' : (pos.realizedAmount < 0 ? 'rgba(239, 83, 80, 0.16)' : 'rgba(41, 98, 255, 0.16)');
                    borderColor = isGain ? '#26A69A' : (pos.realizedAmount < 0 ? '#EF5350' : '#2962FF');
                }

                ctx.save();

                // 1. Shaded Half-Box (ONLY on 5m / Intraday when showBox is true)
                if (showBox) {
                    ctx.fillStyle = fillColor;
                    ctx.fillRect(minX, minY, boxWidth, boxHeight);

                    // Boundary Border
                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(minX, minY, boxWidth, boxHeight);

                    // Entry & Exit Horizontal Level Lines (subtle dashed inside)
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(minX, validYEntry);
                    ctx.lineTo(maxX, validYEntry);
                    if (!isOpen) {
                        ctx.moveTo(minX, validYExit);
                        ctx.lineTo(maxX, validYExit);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else if (isOpen) {
                    // Daily Open Position: Dashed horizontal entry price line extending to latest candle
                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = 1.2;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(minX, validYEntry);
                    ctx.lineTo(maxX, validYEntry);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Calculate candle wick levels so triangles sit above/below the candle wick instead of inside the body
                const refEntryLow = (pos.entryBarLow !== undefined && pos.entryBarLow !== null) ? pos.entryBarLow : pos.entryPrice;
                const refExitHigh = (pos.exitBarHigh !== undefined && pos.exitBarHigh !== null) ? pos.exitBarHigh : pos.exitPrice;

                const yWickLow = this._series!.priceToCoordinate(refEntryLow);
                const yWickHigh = this._series!.priceToCoordinate(refExitHigh);

                const arrowBaseYLow = yWickLow !== null ? yWickLow : validYEntry;
                const arrowBaseYHigh = yWickHigh !== null ? yWickHigh : validYExit;

                const isSingleBar = Math.abs(x1! - x2!) < 6;
                const arrowEntryX = isSingleBar ? (x1! - 5) : x1!;
                const arrowExitX = isSingleBar ? (x2! + 5) : x2!;

                // 2. Entry Arrow (▲ BUY) placed strictly BELOW the candle wick pointing UP
                ctx.fillStyle = '#26A69A';
                ctx.beginPath();
                ctx.moveTo(arrowEntryX, arrowBaseYLow + 3);
                ctx.lineTo(arrowEntryX - 5, arrowBaseYLow + 12);
                ctx.lineTo(arrowEntryX + 5, arrowBaseYLow + 12);
                ctx.closePath();
                ctx.fill();

                // 3. Exit Arrow (▼ SELL) placed strictly ABOVE the candle wick pointing DOWN (Only when CLOSED)
                if (!isOpen) {
                    ctx.fillStyle = isGain ? '#26A69A' : '#EF5350';
                    ctx.beginPath();
                    ctx.moveTo(arrowExitX, arrowBaseYHigh - 3);
                    ctx.lineTo(arrowExitX - 5, arrowBaseYHigh - 12);
                    ctx.lineTo(arrowExitX + 5, arrowBaseYHigh - 12);
                    ctx.closePath();
                    ctx.fill();
                }

                // 4. Floating Performance Badge with Anti-Collision Placement & High Readability
                const pctSign = pos.realizedPercentage >= 0 ? '+' : '';
                const amtSign = pos.realizedAmount >= 0 ? '+' : '';
                const isForex = pos.currency === 'USC' || (pos.symbol && pos.symbol.endsWith('c')) || (pos.symbol && pos.symbol.startsWith('XAU'));
                const amtFormatted = isForex
                    ? `${amtSign}${pos.realizedAmount.toFixed(1)} USC`
                    : `${amtSign}Rp ${Math.round(pos.realizedAmount).toLocaleString('id-ID')}`;

                let pnlText = '';
                if (isOpen) {
                    if (pos.realizedAmount !== undefined && pos.realizedAmount !== 0) {
                        pnlText = `OPEN ${pctSign}${pos.realizedPercentage.toFixed(1)}% (${amtFormatted}) | ${pos.lot}${isForex ? '' : 'L'}`;
                    } else {
                        const priceStr = isForex ? String(pos.entryPrice) : `Rp ${pos.entryPrice.toLocaleString('id-ID')}`;
                        pnlText = `OPEN | ${pos.lot}${isForex ? '' : 'L'} @ ${priceStr}`;
                    }
                } else if (pos.isFocused) {
                    const timePrefix = (pos.entryDatetime && pos.exitDatetime)
                        ? `${pos.entryDatetime.slice(11, 16)} → ${pos.exitDatetime.slice(11, 16)} | `
                        : '';
                    pnlText = `🎯 ${timePrefix}${pctSign}${pos.realizedPercentage.toFixed(2)}% (${amtFormatted}) | ${pos.lot}${isForex ? ' Lot' : 'L'}`;
                } else {
                    // Concise, readable badge that fits cleanly without colliding
                    pnlText = `${pctSign}${pos.realizedPercentage.toFixed(1)}% (${amtFormatted})`;
                }
                
                ctx.font = pos.isFocused
                    ? 'bold 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                    : 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const textMetrics = ctx.measureText(pnlText);
                const badgeW = textMetrics.width + 12;
                const badgeH = pos.isFocused ? 20 : 17;
                const badgeX = showBox 
                    ? minX + (boxWidth - badgeW) / 2
                    : (x1! + x2!) / 2 - badgeW / 2;
                
                // Base Y position: above box / SELL arrow if gain, below if loss
                let badgeY = showBox
                    ? (isGain ? Math.min(minY - badgeH - 6, arrowBaseYHigh - 16 - badgeH) : Math.max(maxY + 6, arrowBaseYLow + 16))
                    : (isOpen 
                        ? (arrowBaseYLow + 16)
                        : (isGain ? arrowBaseYHigh - 14 - badgeH - 4 : arrowBaseYLow + 14 + 4));

                // Anti-Collision Algorithm: prevent overlapping badges across close trades
                for (let attempt = 0; attempt < 6; attempt++) {
                    let hasCollision = false;
                    for (const ob of occupiedBadges) {
                        const xOverlap = (badgeX < ob.x + ob.w + 4) && (badgeX + badgeW + 4 > ob.x);
                        const yOverlap = (badgeY < ob.y + ob.h + 2) && (badgeY + badgeH + 2 > ob.y);
                        if (xOverlap && yOverlap) {
                            hasCollision = true;
                            // Stagger vertically
                            if (isGain) {
                                badgeY = ob.y - badgeH - 4;
                            } else {
                                badgeY = ob.y + ob.h + 4;
                            }
                            break;
                        }
                    }
                    if (!hasCollision) break;
                }
                occupiedBadges.push({ x: badgeX, y: badgeY, w: badgeW, h: badgeH });

                // Clean transparent text without background or border
                ctx.font = 'bold 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.fillStyle = pos.isFocused ? '#2962ff' : (isGain ? '#089981' : '#f23645');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pnlText, badgeX + badgeW / 2, badgeY + badgeH / 2);

                ctx.restore();
            }
        });
    }
}

class TradePositionPaneView implements IPrimitivePaneView {
    private _renderer: TradePositionPaneRenderer;

    constructor(
        positions: TradePosition[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean = true
    ) {
        this._renderer = new TradePositionPaneRenderer(positions, series, chart, visible);
    }

    public update(
        positions: TradePosition[],
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null,
        visible: boolean
    ): void {
        this._renderer.update(positions, series, chart, visible);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'top'; // Trade executions render on top of candles for crisp visibility
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

export class TradePositionPrimitive implements ISeriesPrimitive<Time> {
    private _paneView: TradePositionPaneView;
    private _positions: TradePosition[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _visible: boolean = true;

    constructor() {
        this._paneView = new TradePositionPaneView(this._positions, this._series, this._chart, this._visible);
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._paneView.update(this._positions, this._series, this._chart, this._visible);
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._paneView.update(this._positions, null, null, this._visible);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public updateAllViews(): void {
        this._paneView.update(this._positions, this._series, this._chart, this._visible);
    }

    public setVisible(visible: boolean): void {
        this._visible = visible;
        this._paneView.update(this._positions, this._series, this._chart, this._visible);
        this.requestUpdate();
    }

    public isVisible(): boolean {
        return this._visible;
    }

    public setPositions(positions: TradePosition[]): void {
        this._positions = positions;
        this._paneView.update(this._positions, this._series, this._chart, this._visible);
        this.requestUpdate();
    }

    public getPositions(): TradePosition[] {
        return this._positions;
    }

    public requestUpdate(): void {
        if (this._series) {
            // Trigger redrawing by updating series views
            (this._series as any).applyOptions?.({});
        }
    }
}
