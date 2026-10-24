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
    tp?: number;
    sl?: number;
}

const TV_FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const TV_PALETTE = {
    profitHex: '#089981',
    profitFill: 'rgba(8, 153, 129, 0.14)',
    profitSideBorder: 'rgba(8, 153, 129, 0.28)',
    lossHex: '#F23645',
    lossFill: 'rgba(242, 54, 69, 0.14)',
    lossSideBorder: 'rgba(242, 54, 69, 0.28)',
    entryLine: '#787B86',
    connectorLine: 'rgba(120, 123, 134, 0.55)',
    badgeBg: 'rgba(255, 255, 255, 0.96)',
    badgeBorder: 'rgba(148, 163, 184, 0.65)',
    badgeDivider: 'rgba(226, 232, 240, 0.9)',
    textPrimary: '#1E293B',
    textSecondary: '#475569',
    textOnSolid: '#FFFFFF',
    nowPillBg: '#1E222D',
};

function drawTransparentTag(
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    topY: number,
    textColor: string,
    font: string = `700 10.5px ${TV_FONT_FAMILY}`,
    height: number = 16
): { x: number; y: number; w: number; h: number } {
    ctx.save();
    ctx.font = font;
    const textWidth = ctx.measureText(text).width;
    const pillW = Math.ceil(textWidth);
    const pillX = Math.round(centerX - pillW / 2);
    const pillY = Math.round(topY);

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, centerX, pillY + height / 2);
    ctx.restore();

    return { x: pillX, y: pillY, w: pillW, h: height };
}

function getPrecisionForSymbol(symbol?: string, currency?: string): number {
    if (!symbol) return currency === 'USC' ? 2 : 0;
    const s = symbol.toUpperCase().trim().replace(/[MC]$/, '');
    if (s.startsWith('XAU') || s.startsWith('BTC') || s.startsWith('USTEC') || s.startsWith('US500') || s.startsWith('US30')) {
        return 2;
    }
    if (s.includes('JPY') || s.startsWith('XAG')) {
        return 3;
    }
    const fourDecPairs = ['AUDUSD', 'EURUSD', 'GBPUSD', 'USDCHF', 'AUDCHF', 'USDHKD', 'NZDUSD', 'USDCAD'];
    if (fourDecPairs.includes(s) || (s.length === 6 && (s.endsWith('USD') || s.endsWith('CHF')))) {
        return 4;
    }
    if (currency === 'USC' || symbol.endsWith('c') || symbol.endsWith('m')) {
        return 2;
    }
    return 0; // Default IHSG stocks
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
                if (x1 === null && pos.entryTime) {
                    x1 = timeScale.timeToCoordinate(pos.entryTime as Time);
                }
                if (x2 === null && pos.exitTime) {
                    x2 = timeScale.timeToCoordinate(pos.exitTime as Time);
                }

                // If both are completely off-screen / non-existent, skip
                if (x1 === null && x2 === null) continue;

                // Determine dynamic bar spacing around this position
                let barSpacing = 8;
                const refLogical = pos.entryBarIndex !== undefined && pos.entryBarIndex >= 0
                    ? pos.entryBarIndex
                    : (pos.exitBarIndex !== undefined && pos.exitBarIndex >= 0 ? pos.exitBarIndex : 0);
                const c0 = timeScale.logicalToCoordinate(refLogical as Logical);
                const c1 = timeScale.logicalToCoordinate((refLogical + 1) as Logical);
                if (c0 !== null && c1 !== null) {
                    barSpacing = Math.max(2, Math.abs(c1 - c0));
                }
                const halfBar = Math.max(1, barSpacing * 0.45);

                const isOpen = Boolean(pos.isOpen);

                if (x1 === null && x2 !== null) x1 = x2;
                if (x2 === null && x1 !== null) {
                    x2 = isOpen ? x1 + Math.max(halfBar * 2, 40) : x1;
                }

                // Exact horizontal bounds:
                // Entry candle center is x1, exit candle center is x2.
                // Shaded box spans from the left boundary of entry candle to right boundary of exit candle.
                let startX: number;
                let endX: number;

                if (isOpen) {
                    startX = x1! - halfBar;
                    // For active open positions, extend comfortably to the right into active space
                    endX = Math.max((x2 !== null ? x2 : x1!) + halfBar, startX + 140);
                } else {
                    const minCenter = Math.min(x1!, x2!);
                    const maxCenter = Math.max(x1!, x2!);
                    startX = minCenter - halfBar;
                    endX = maxCenter + halfBar;
                    if (endX - startX < halfBar * 2) {
                        endX = startX + halfBar * 2;
                    }
                }

                const minX = startX;
                const maxX = endX;
                const boxWidth = Math.max(2, endX - startX);
                const centerX = (startX + endX) / 2;

                // Determine vertical coordinates from prices
                const yEntry = this._series!.priceToCoordinate(pos.entryPrice);
                const yExit = this._series!.priceToCoordinate(pos.exitPrice);

                if (yEntry === null && yExit === null) continue;

                const validYEntry = yEntry !== null ? yEntry : (yExit !== null ? yExit : mediaSize.height / 2);
                const validYExit = yExit !== null ? yExit : (yEntry !== null ? yEntry : mediaSize.height / 2);

                const minY = Math.min(validYEntry, validYExit);
                const maxY = Math.max(validYEntry, validYExit);
                const boxHeight = Math.max(4, maxY - minY);

                const isGain = pos.isWin;
                const showBox = pos.showBox !== false;

                let fillColor = isGain ? TV_PALETTE.profitFill : TV_PALETTE.lossFill;
                let borderColor = isGain ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;

                if (isOpen) {
                    const openPositive = pos.realizedAmount >= 0;
                    fillColor = openPositive ? TV_PALETTE.profitFill : TV_PALETTE.lossFill;
                    borderColor = openPositive ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;
                }

                ctx.save();

                const isShort =
                    pos.type?.toUpperCase() === 'SELL' ||
                    pos.type?.toUpperCase() === 'SHORT' ||
                    pos.command?.toUpperCase() === 'SELL' ||
                    pos.command?.toUpperCase() === 'SHORT' ||
                    Boolean(pos.tp && pos.tp > 0 && pos.tp < pos.entryPrice) ||
                    Boolean(pos.sl && pos.sl > 0 && pos.sl > pos.entryPrice);

                const isForex =
                    pos.currency === 'USC' ||
                    Boolean(
                        pos.symbol &&
                            (pos.symbol.endsWith('c') ||
                                pos.symbol.endsWith('m') ||
                                pos.symbol.startsWith('XAU'))
                    );
                const decimals = getPrecisionForSymbol(pos.symbol, pos.currency);
                const fmt = (p: number) =>
                    decimals > 0 ? p.toFixed(decimals) : Math.round(p).toLocaleString('id-ID');

                const hasTpSl = Boolean((pos.tp && pos.tp > 0) || (pos.sl && pos.sl > 0));
                if (hasTpSl) {
                    const yEntryCoord = validYEntry;
                    const yTP = pos.tp && pos.tp > 0 ? this._series!.priceToCoordinate(pos.tp) : null;
                    const ySL = pos.sl && pos.sl > 0 ? this._series!.priceToCoordinate(pos.sl) : null;
                    const liveCurPrice =
                        pos.currentPrice && pos.currentPrice > 0
                            ? pos.currentPrice
                            : pos.exitPrice;
                    const yCur =
                        liveCurPrice && liveCurPrice > 0
                            ? this._series!.priceToCoordinate(liveCurPrice)
                            : null;

                    const targetDiff = pos.tp ? Math.abs(pos.tp - pos.entryPrice) : 0;
                    const stopDiff = pos.sl ? Math.abs(pos.sl - pos.entryPrice) : 0;
                    const targetPct = pos.entryPrice > 0 ? (targetDiff / pos.entryPrice) * 100 : 0;
                    const stopPct = pos.entryPrice > 0 ? (stopDiff / pos.entryPrice) * 100 : 0;
                    const rrRatio = stopDiff > 0 ? (targetDiff / stopDiff).toFixed(2) : '-';

                    // 1. Target / Profit Zone (TradingView Teal #089981)
                    if (yTP !== null) {
                        const profitTop = Math.min(yEntryCoord, yTP);
                        const profitBottom = Math.max(yEntryCoord, yTP);
                        const profitHeight = Math.max(2, profitBottom - profitTop);

                        // Soft TradingView fill
                        ctx.fillStyle = TV_PALETTE.profitFill;
                        ctx.fillRect(startX, profitTop, boxWidth, profitHeight);

                        // Subtle vertical side borders
                        ctx.strokeStyle = TV_PALETTE.profitSideBorder;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(startX, profitTop);
                        ctx.lineTo(startX, profitBottom);
                        ctx.moveTo(endX, profitTop);
                        ctx.lineTo(endX, profitBottom);
                        ctx.stroke();

                        // Crisp outer TP level line
                        ctx.strokeStyle = TV_PALETTE.profitHex;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.moveTo(startX, yTP);
                        ctx.lineTo(endX, yTP);
                        ctx.stroke();
                    }

                    // 2. Stop / Loss Zone (TradingView Red #F23645)
                    if (ySL !== null) {
                        const lossTop = Math.min(yEntryCoord, ySL);
                        const lossBottom = Math.max(yEntryCoord, ySL);
                        const lossHeight = Math.max(2, lossBottom - lossTop);

                        // Soft TradingView fill
                        ctx.fillStyle = TV_PALETTE.lossFill;
                        ctx.fillRect(startX, lossTop, boxWidth, lossHeight);

                        // Subtle vertical side borders
                        ctx.strokeStyle = TV_PALETTE.lossSideBorder;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(startX, lossTop);
                        ctx.lineTo(startX, lossBottom);
                        ctx.moveTo(endX, lossTop);
                        ctx.lineTo(endX, lossBottom);
                        ctx.stroke();

                        // Crisp outer SL level line
                        ctx.strokeStyle = TV_PALETTE.lossHex;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.moveTo(startX, ySL);
                        ctx.lineTo(endX, ySL);
                        ctx.stroke();
                    }

                    // 3. TradingView Diagonal Price Connector (Entry -> Current / Exit)
                    const connectorEndY = isOpen && yCur !== null ? yCur : validYExit;
                    const connectorEndX = isOpen && yCur !== null ? Math.min(endX, x2 ?? endX) : x2!;
                    ctx.strokeStyle = TV_PALETTE.connectorLine;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(x1!, yEntryCoord);
                    ctx.lineTo(connectorEndX, connectorEndY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // 4. Neutral TradingView Entry Separator Line (#787B86)
                    ctx.strokeStyle = TV_PALETTE.entryLine;
                    ctx.lineWidth = 1.25;
                    ctx.beginPath();
                    ctx.moveTo(startX, yEntryCoord);
                    ctx.lineTo(endX, yEntryCoord);
                    ctx.stroke();

                    // 5. Current Price Level Line & Compact Tag (when Open)
                    if (yCur !== null && isOpen) {
                        const isLiveProfit = pos.realizedAmount >= 0;
                        const curColor = isLiveProfit ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;

                        ctx.strokeStyle = curColor;
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        ctx.beginPath();
                        ctx.moveTo(startX, yCur);
                        ctx.lineTo(endX, yCur);
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Sleek right-aligned NOW tag (transparent, no border)
                        const nowLabel = `NOW ${fmt(liveCurPrice!)}`;
                        ctx.font = `700 9.5px ${TV_FONT_FAMILY}`;
                        ctx.fillStyle = curColor;
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(nowLabel, endX - 2, yCur - 2);
                    }

                    // 6. TP & SL Transparent Tags (No background, No border, No pipes)
                    if (yTP !== null) {
                        const tpLabel = `TP ${fmt(pos.tp!)}  +${targetDiff.toFixed(decimals)} (+${targetPct.toFixed(2)}%)`;
                        const tpH = 16;
                        const tpY = isShort ? yTP + 4 : yTP - tpH - 4;
                        drawTransparentTag(
                            ctx,
                            tpLabel,
                            centerX,
                            tpY,
                            TV_PALETTE.profitHex,
                            `700 10.5px ${TV_FONT_FAMILY}`,
                            tpH
                        );
                    }

                    if (ySL !== null) {
                        const slLabel = `SL ${fmt(pos.sl!)}  -${stopDiff.toFixed(decimals)} (-${stopPct.toFixed(2)}%)`;
                        const slH = 16;
                        const slY = isShort ? ySL - slH - 4 : ySL + 4;
                        drawTransparentTag(
                            ctx,
                            slLabel,
                            centerX,
                            slY,
                            TV_PALETTE.lossHex,
                            `700 10.5px ${TV_FONT_FAMILY}`,
                            slH
                        );
                    }

                    // 7. Central Info Text (Transparent Background, No Border, Zero Emojis, No Pipes)
                    const pnlSign = pos.realizedAmount >= 0 ? '+' : '';
                    const pnlFormatted = isForex
                        ? `${pnlSign}${pos.realizedAmount.toFixed(isOpen ? 2 : 1)} USC`
                        : `${pnlSign}Rp ${Math.round(pos.realizedAmount).toLocaleString('id-ID')}`;
                    const isPositivePnl = pos.realizedAmount >= 0;
                    const pnlColor = isPositivePnl ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;

                    const sideText = isShort ? 'SELL' : 'BUY';
                    const lotStr = pos.lot ? ` ${pos.lot}${isForex ? ' Lot' : 'L'}` : '';
                    const headerText = `${sideText}${lotStr} @ ${fmt(pos.entryPrice)}   R:R 1 : ${rrRatio}`;
                    const pnlPctStr =
                        pos.realizedPercentage !== undefined && (isOpen || pos.realizedPercentage !== 0)
                            ? ` (${pnlSign}${pos.realizedPercentage.toFixed(2)}%)`
                            : '';
                    const subText = `${isOpen ? 'Open PnL' : 'Closed PnL'}: ${pnlFormatted}${pnlPctStr}`;

                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    // Row 1: Entry details & Risk/Reward Ratio (above entry line)
                    ctx.font = `700 10.5px ${TV_FONT_FAMILY}`;
                    ctx.fillStyle = TV_PALETTE.textPrimary;
                    ctx.fillText(headerText, centerX, yEntryCoord - 9);

                    // Row 2: Live / Realized PnL (below entry line)
                    ctx.font = `700 11px ${TV_FONT_FAMILY}`;
                    ctx.fillStyle = pnlColor;
                    ctx.fillText(subText, centerX, yEntryCoord + 9);
                    ctx.restore();

                    // 8. Entry Direction Marker Triangle (Strictly aligned to entry bar center x1)
                    const refEntryLow =
                        pos.entryBarLow !== undefined && pos.entryBarLow !== null
                            ? pos.entryBarLow
                            : pos.entryPrice;
                    const refEntryHigh =
                        pos.entryBarHigh !== undefined && pos.entryBarHigh !== null
                            ? pos.entryBarHigh
                            : pos.entryPrice;
                    const yWickLow = this._series!.priceToCoordinate(refEntryLow);
                    const yWickHigh = this._series!.priceToCoordinate(refEntryHigh);
                    const entryArrowX = x1!;

                    if (isShort) {
                        const arrowY = yWickHigh !== null ? yWickHigh : yEntryCoord;
                        ctx.fillStyle = TV_PALETTE.lossHex;
                        ctx.beginPath();
                        ctx.moveTo(entryArrowX, arrowY - 3);
                        ctx.lineTo(entryArrowX - 5, arrowY - 11);
                        ctx.lineTo(entryArrowX + 5, arrowY - 11);
                        ctx.closePath();
                        ctx.fill();
                    } else {
                        const arrowY = yWickLow !== null ? yWickLow : yEntryCoord;
                        ctx.fillStyle = TV_PALETTE.profitHex;
                        ctx.beginPath();
                        ctx.moveTo(entryArrowX, arrowY + 3);
                        ctx.lineTo(entryArrowX - 5, arrowY + 11);
                        ctx.lineTo(entryArrowX + 5, arrowY + 11);
                        ctx.closePath();
                        ctx.fill();
                    }

                    // 9. Exit Marker for closed trade with TP/SL
                    if (!isOpen && x2 !== null) {
                        const exitArrowX = x2;
                        const refExitLow = pos.exitBarLow !== undefined && pos.exitBarLow !== null ? pos.exitBarLow : pos.exitPrice;
                        const refExitHigh = pos.exitBarHigh !== undefined && pos.exitBarHigh !== null ? pos.exitBarHigh : pos.exitPrice;
                        const yExitLow = this._series!.priceToCoordinate(refExitLow);
                        const yExitHigh = this._series!.priceToCoordinate(refExitHigh);

                        if (isShort) {
                            const exitY = yExitLow !== null ? yExitLow : validYExit;
                            ctx.fillStyle = isGain ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;
                            ctx.beginPath();
                            ctx.moveTo(exitArrowX, exitY + 3);
                            ctx.lineTo(exitArrowX - 5, exitY + 11);
                            ctx.lineTo(exitArrowX + 5, exitY + 11);
                            ctx.closePath();
                            ctx.fill();
                        } else {
                            const exitY = yExitHigh !== null ? yExitHigh : validYExit;
                            ctx.fillStyle = isGain ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;
                            ctx.beginPath();
                            ctx.moveTo(exitArrowX, exitY - 3);
                            ctx.lineTo(exitArrowX - 5, exitY - 11);
                            ctx.lineTo(exitArrowX + 5, exitY - 11);
                            ctx.closePath();
                            ctx.fill();
                        }
                    }

                    ctx.restore();
                    continue;
                }

                // Standard Trade Execution View (When no TP/SL levels are attached)
                if (showBox) {
                    ctx.fillStyle = fillColor;
                    ctx.fillRect(minX, minY, boxWidth, boxHeight);

                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = 1.25;
                    ctx.strokeRect(minX, minY, boxWidth, boxHeight);

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
                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = 1.2;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(minX, validYEntry);
                    ctx.lineTo(maxX, validYEntry);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                const refEntryLow =
                    pos.entryBarLow !== undefined && pos.entryBarLow !== null
                        ? pos.entryBarLow
                        : pos.entryPrice;
                const refExitHigh =
                    pos.exitBarHigh !== undefined && pos.exitBarHigh !== null
                        ? pos.exitBarHigh
                        : pos.exitPrice;

                const yWickLow = this._series!.priceToCoordinate(refEntryLow);
                const yWickHigh = this._series!.priceToCoordinate(refExitHigh);

                const arrowBaseYLow = yWickLow !== null ? yWickLow : validYEntry;
                const arrowBaseYHigh = yWickHigh !== null ? yWickHigh : validYExit;

                const isSingleBar = Math.abs(x1! - x2!) < 4;
                const arrowEntryX = isSingleBar ? x1! - 3 : x1!;
                const arrowExitX = isSingleBar ? x2! + 3 : x2!;

                if (isShort) {
                    // Entry Arrow (SELL) above entry candle wick pointing down
                    ctx.fillStyle = TV_PALETTE.lossHex;
                    ctx.beginPath();
                    ctx.moveTo(arrowEntryX, arrowBaseYHigh - 3);
                    ctx.lineTo(arrowEntryX - 5, arrowBaseYHigh - 11);
                    ctx.lineTo(arrowEntryX + 5, arrowBaseYHigh - 11);
                    ctx.closePath();
                    ctx.fill();

                    // Exit Arrow (BUY to close) below exit candle wick pointing up
                    if (!isOpen) {
                        ctx.fillStyle = isGain ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;
                        ctx.beginPath();
                        ctx.moveTo(arrowExitX, arrowBaseYLow + 3);
                        ctx.lineTo(arrowExitX - 5, arrowBaseYLow + 11);
                        ctx.lineTo(arrowExitX + 5, arrowBaseYLow + 11);
                        ctx.closePath();
                        ctx.fill();
                    }
                } else {
                    // Entry Arrow (BUY) below candle wick pointing up
                    ctx.fillStyle = TV_PALETTE.profitHex;
                    ctx.beginPath();
                    ctx.moveTo(arrowEntryX, arrowBaseYLow + 3);
                    ctx.lineTo(arrowEntryX - 5, arrowBaseYLow + 11);
                    ctx.lineTo(arrowEntryX + 5, arrowBaseYLow + 11);
                    ctx.closePath();
                    ctx.fill();

                    // Exit Arrow (SELL) above candle wick pointing down (when closed)
                    if (!isOpen) {
                        ctx.fillStyle = isGain ? TV_PALETTE.profitHex : TV_PALETTE.lossHex;
                        ctx.beginPath();
                        ctx.moveTo(arrowExitX, arrowBaseYHigh - 3);
                        ctx.lineTo(arrowExitX - 5, arrowBaseYHigh - 11);
                        ctx.lineTo(arrowExitX + 5, arrowBaseYHigh - 11);
                        ctx.closePath();
                        ctx.fill();
                    }
                }

                // Floating Performance Pill Badge (No Emojis, Clean Elevated Background)
                const pctSign = pos.realizedPercentage >= 0 ? '+' : '';
                const amtSign = pos.realizedAmount >= 0 ? '+' : '';
                const amtFormatted = isForex
                    ? `${amtSign}${pos.realizedAmount.toFixed(isOpen ? 2 : 1)} USC`
                    : `${amtSign}Rp ${Math.round(pos.realizedAmount).toLocaleString('id-ID')}`;

                let pnlText = '';
                if (isOpen) {
                    if (pos.realizedAmount !== undefined) {
                        pnlText = `OPEN ${pctSign}${(pos.realizedPercentage || 0).toFixed(2)}% (${amtFormatted})  ${pos.lot}${isForex ? ' Lot' : 'L'}`;
                    } else {
                        const priceStr = isForex
                            ? fmt(pos.entryPrice)
                            : `Rp ${pos.entryPrice.toLocaleString('id-ID')}`;
                        pnlText = `OPEN  ${pos.lot}${isForex ? ' Lot' : 'L'} @ ${priceStr}`;
                    }
                } else if (pos.isFocused) {
                    const timePrefix =
                        pos.entryDatetime && pos.exitDatetime
                            ? `${pos.entryDatetime.slice(11, 16)} - ${pos.exitDatetime.slice(11, 16)}  `
                            : '';
                    pnlText = `${timePrefix}${pctSign}${pos.realizedPercentage.toFixed(2)}% (${amtFormatted})  ${pos.lot}${isForex ? ' Lot' : 'L'}`;
                } else {
                    pnlText = `${pctSign}${pos.realizedPercentage.toFixed(1)}% (${amtFormatted})`;
                }

                ctx.font = pos.isFocused
                    ? `700 11px ${TV_FONT_FAMILY}`
                    : `700 10px ${TV_FONT_FAMILY}`;
                const textMetrics = ctx.measureText(pnlText);
                const badgeW = Math.ceil(textMetrics.width);
                const badgeH = pos.isFocused ? 18 : 16;
                const badgeX = showBox
                    ? Math.round(centerX - badgeW / 2)
                    : Math.round(arrowEntryX - badgeW / 2);

                let badgeY = showBox
                    ? isGain
                        ? Math.min(minY - badgeH - 6, arrowBaseYHigh - 15 - badgeH)
                        : Math.max(maxY + 6, arrowBaseYLow + 15)
                    : isOpen
                    ? arrowBaseYLow + 15
                    : isGain
                    ? arrowBaseYHigh - 14 - badgeH - 4
                    : arrowBaseYLow + 14 + 4;

                // Anti-Collision Algorithm
                for (let attempt = 0; attempt < 6; attempt++) {
                    let hasCollision = false;
                    for (const ob of occupiedBadges) {
                        const xOverlap = badgeX < ob.x + ob.w + 4 && badgeX + badgeW + 4 > ob.x;
                        const yOverlap = badgeY < ob.y + ob.h + 2 && badgeY + badgeH + 2 > ob.y;
                        if (xOverlap && yOverlap) {
                            hasCollision = true;
                            badgeY = isGain ? ob.y - badgeH - 4 : ob.y + ob.h + 4;
                            break;
                        }
                    }
                    if (!hasCollision) break;
                }
                occupiedBadges.push({ x: badgeX, y: badgeY, w: badgeW, h: badgeH });

                const accentColor = isOpen
                    ? pos.realizedAmount >= 0
                        ? TV_PALETTE.profitHex
                        : TV_PALETTE.lossHex
                    : isGain
                    ? TV_PALETTE.profitHex
                    : TV_PALETTE.lossHex;

                // Transparent Performance Badge Text (No Background, No Border)
                ctx.save();
                ctx.font = pos.isFocused
                    ? `700 11px ${TV_FONT_FAMILY}`
                    : `700 10px ${TV_FONT_FAMILY}`;
                ctx.fillStyle = accentColor;
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
        return 'top';
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
    private _requestUpdate?: () => void;
    private _visible: boolean = true;

    constructor() {
        this._paneView = new TradePositionPaneView(this._positions, this._series, this._chart, this._visible);
    }

    public attached(param: SeriesAttachedParameter<Time>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._requestUpdate = param.requestUpdate;
        this._paneView.update(this._positions, this._series, this._chart, this._visible);
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = undefined;
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
        if (this._requestUpdate) {
            this._requestUpdate();
        }
        if (this._series) {
            (this._series as any).applyOptions?.({});
        }
    }
}