import type {
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
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { fmt5sig, getIdxTickSize } from './ghost-candle-primitive';

export type GapType = 'Breakaway' | 'Runaway' | 'Exhaustion' | 'Common' | 'Island Reversal';
export type GapDirection = 'up' | 'down';
export type GapStatus = 'Open' | 'Close';

export interface GapItem {
    id: string;
    barIndex: number;
    time: Time;
    direction: GapDirection;
    type: GapType;
    status: GapStatus;
    bottomPrice: number;
    topPrice: number;
    volumeRatio: number;
    fillBarIndex?: number;
    fillTime?: Time;
    isForex?: boolean;
}

export interface GapPrimitiveData {
    gaps: GapItem[];
    visible?: boolean;
    isForex?: boolean;
}

/**
 * Canvas renderer for Bab 20 Gaps & Island Reversals.
 * Strictly complies with user specifications:
 * - Zero emojis (no 🟢, 🔴, 🟡, 🕳️, 🏝️)
 * - Zero rectangular background boxes / fill shading
 * - Zero tables
 * - Short vertical dashed line spanning the gap height
 * - Clean text: <Jenis Gap> <Harga Bawah>-<Harga Atas> Vol <Vol Ratio>x <Open|Close>
 * - Exact typography & color palette inherited from ghost candle (Mint #26A69A, Salmon #EF5350)
 */
class GapPaneRenderer implements IPrimitivePaneRenderer {
    private _data: GapPrimitiveData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: GapPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: GapPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || !this._chart || !this._data || this._data.visible === false) return;
        if (!this._data.gaps || this._data.gaps.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();

            for (const gap of this._data!.gaps) {
                // Viewport culling for 60 FPS performance on Chromebook
                if (visibleRange) {
                    if (gap.barIndex < visibleRange.from - 8 || gap.barIndex > visibleRange.to + 8) {
                        continue;
                    }
                }

                const x = timeScale.timeToCoordinate(gap.time) ?? timeScale.logicalToCoordinate(gap.barIndex as Logical);
                if (x === null || x < -50 || x > width + 50) continue;

                const yTop = this._series!.priceToCoordinate(gap.topPrice);
                const yBottom = this._series!.priceToCoordinate(gap.bottomPrice);
                if (yTop === null || yBottom === null) continue;

                const isUp = gap.direction === 'up';
                const isOpen = gap.status === 'Open';

                // Color palette identical to ghost candle:
                // Mint Teal (#26A69A) for Gap-Up / Bullish, Salmon Red (#EF5350) for Gap-Down / Bearish
                const baseColor = isUp ? '#26A69A' : '#EF5350';
                const lineColor = isOpen
                    ? (isUp ? 'rgba(38, 166, 154, 0.95)' : 'rgba(239, 83, 80, 0.95)')
                    : (isUp ? 'rgba(38, 166, 154, 0.50)' : 'rgba(239, 83, 80, 0.50)');

                const textColor = isOpen ? baseColor : (isUp ? 'rgba(38, 166, 154, 0.65)' : 'rgba(239, 83, 80, 0.65)');

                // 1. Short Vertical Dashed Line
                ctx.save();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = lineColor;
                ctx.setLineDash([3, 3]);

                ctx.beginPath();
                ctx.moveTo(x, yBottom);
                ctx.lineTo(x, yTop);
                ctx.stroke();

                // Small bracket ticks at top and bottom of the gap
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x - 2.5, yTop);
                ctx.lineTo(x + 2.5, yTop);
                ctx.moveTo(x - 2.5, yBottom);
                ctx.lineTo(x + 2.5, yBottom);
                ctx.stroke();
                ctx.restore();

                // 2. Text Label: <Jenis Gap> <Harga Bawah>-<Harga Atas> Vol <Vol Ratio>x <Open|Close>
                // Zero emojis, zero boxes, zero tables, truly transparent text
                let typeLabel = '';
                if (gap.type === 'Island Reversal') {
                    typeLabel = isUp ? 'Island Reversal Bullish' : 'Island Reversal Bearish';
                } else {
                    typeLabel = `${gap.type} ${isUp ? 'Gap-Up' : 'Gap-Down'}`;
                }

                let priceStr = '';
                if (gap.isForex) {
                    priceStr = `${fmt5sig(gap.bottomPrice)}-${fmt5sig(gap.topPrice)}`;
                } else {
                    priceStr = `${Math.round(gap.bottomPrice).toLocaleString('id-ID')}-${Math.round(gap.topPrice).toLocaleString('id-ID')}`;
                }

                const volStr = `${gap.volumeRatio.toFixed(1)}x`;
                const fullText = `${typeLabel} ${priceStr} Vol ${volStr} ${gap.status}`;

                ctx.save();
                ctx.font = 'bold 10px "JetBrains Mono", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = textColor;
                ctx.textBaseline = 'middle';

                const textW = ctx.measureText(fullText).width;
                let textX = x + 5;
                if (textX + textW > width - 8) {
                    textX = x - 5;
                    ctx.textAlign = 'right';
                } else {
                    ctx.textAlign = 'left';
                }

                const textY = (yTop + yBottom) / 2;
                ctx.fillText(fullText, textX, textY);
                ctx.restore();
            }
        });
    }
}

class GapPaneView implements IPrimitivePaneView {
    private _renderer: GapPaneRenderer;

    constructor(
        data: GapPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new GapPaneRenderer(data, series, chart);
    }

    public update(
        data: GapPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ): void {
        this._renderer.update(data, series, chart);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'normal';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

/**
 * Series Primitive for Bab 20 Gaps & Island Reversal
 */
export class GapPrimitive implements ISeriesPrimitive<Time> {
    private _paneView: GapPaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _data: GapPrimitiveData | null = null;
    private _requestUpdate: (() => void) | null = null;

    constructor() {
        this._paneView = new GapPaneView(null, null, null);
    }

    public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
        this._series = param.series;
        this._chart = param.chart;
        this._requestUpdate = param.requestUpdate;
        this.updateAllViews();
        if (this._requestUpdate) this._requestUpdate();
    }

    public detached(): void {
        this._series = null;
        this._chart = null;
        this._requestUpdate = null;
        this._paneView.update(null, null, null);
    }

    public updateAllViews(): void {
        this._paneView.update(this._data, this._series, this._chart);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public setData(data: GapPrimitiveData | null): void {
        this._data = data;
        this.updateAllViews();
        if (this._requestUpdate) {
            this._requestUpdate();
        } else if (this._series) {
            this._series.applyOptions({});
        }
    }

    public clearData(): void {
        this._data = null;
        this.updateAllViews();
        if (this._requestUpdate) {
            this._requestUpdate();
        } else if (this._series) {
            this._series.applyOptions({});
        }
    }
}

/**
 * Mathematical Gap Detection & Classification Engine (Bab 20 — Edianto Ong)
 * Classifies all gaps into:
 * 1. Common Gap (consolidation range, low volume, fast fill)
 * 2. Breakaway Gap (resistance/support breakout, vol >= 1.3x, persistent)
 * 3. Runaway / Measuring Gap (mid-trend continuation, vol >= 1.15x)
 * 4. Exhaustion Gap (late-trend climax, quickly filled in <= 5 bars)
 * 5. Island Reversal (opposing gaps leaving isolated island of 1-7 candles)
 */
export function computeGaps(candles: any[], isForex: boolean = false): GapItem[] {
    if (!candles || candles.length < 2) return [];

    const n = candles.length;
    const gaps: GapItem[] = [];

    // Calculate 20-period Simple Moving Average of Volume
    const smaVol: number[] = new Array(n);
    let runningSum = 0;
    for (let i = 0; i < n; i++) {
        const v = Number(candles[i].volume || 0);
        runningSum += v;
        if (i >= 20) {
            runningSum -= Number(candles[i - 20].volume || 0);
            smaVol[i] = runningSum / 20;
        } else {
            smaVol[i] = runningSum / (i + 1);
        }
    }

    // Step 1: Detect all individual gaps
    for (let i = 1; i < n; i++) {
        const prev = candles[i - 1];
        const cur = candles[i];

        const prevH = Number(prev.high);
        const prevL = Number(prev.low);
        const curH = Number(cur.high);
        const curL = Number(cur.low);

        if (!prevH || !prevL || !curH || !curL || isNaN(prevH) || isNaN(curH)) continue;

        let isGapUp = false;
        let isGapDown = false;
        let bottomPrice = 0;
        let topPrice = 0;

        const minTick = isForex ? 0.0001 : getIdxTickSize(prevH);

        // Gap-Up: cur.low > prev.high
        if (curL - prevH >= minTick) {
            isGapUp = true;
            bottomPrice = prevH;
            topPrice = curL;
        } else if (prevL - curH >= minTick) {
            // Gap-Down: cur.high < prev.low
            isGapDown = true;
            bottomPrice = curH;
            topPrice = prevL;
        }

        if (!isGapUp && !isGapDown) continue;

        // Check if gap is filled by any subsequent candle
        let status: GapStatus = 'Open';
        let fillBarIndex: number | undefined = undefined;
        let fillTime: Time | undefined = undefined;

        for (let k = i + 1; k < n; k++) {
            const nextL = Number(candles[k].low);
            const nextH = Number(candles[k].high);
            if (isGapUp) {
                if (nextL <= bottomPrice) {
                    status = 'Close';
                    fillBarIndex = k;
                    fillTime = candles[k].time;
                    break;
                }
            } else {
                if (nextH >= topPrice) {
                    status = 'Close';
                    fillBarIndex = k;
                    fillTime = candles[k].time;
                    break;
                }
            }
        }

        // Volume ratio vs 20-period SMA volume
        const curVol = Number(cur.volume || 0);
        const volRatio = smaVol[i] > 0 ? (curVol / smaVol[i]) : 1.0;

        // Lookback window (20 bars) prior to gap
        const lookbackStart = Math.max(0, i - 20);
        let priorHigh20 = -Infinity;
        let priorLow20 = Infinity;
        for (let j = lookbackStart; j < i; j++) {
            if (candles[j].high > priorHigh20) priorHigh20 = candles[j].high;
            if (candles[j].low < priorLow20) priorLow20 = candles[j].low;
        }

        // 10-bar prior return for trend momentum check
        const ret10Start = Math.max(0, i - 10);
        const ret10 = candles[ret10Start].close > 0
            ? (prev.close - candles[ret10Start].close) / candles[ret10Start].close
            : 0;

        const fillDuration = fillBarIndex !== undefined ? (fillBarIndex - i) : (n - i);

        // Gap classification per Bab 20
        let type: GapType = 'Common';

        if (isGapUp) {
            if (cur.open >= priorHigh20 && volRatio >= 1.3) {
                // Breakaway Gap-Up: Breakout above prior consolidation/resistance with strong volume
                type = 'Breakaway';
            } else if (ret10 > 0.04 && volRatio >= 1.15 && fillDuration >= 5) {
                // Runaway Gap-Up: Mid-trend continuation with good volume and not instantly closed
                type = 'Runaway';
            } else if (ret10 > 0.06 && fillDuration <= 5) {
                // Exhaustion Gap-Up: Climax at trend peak that fills quickly within 5 bars
                type = 'Exhaustion';
            } else {
                type = 'Common';
            }
        } else {
            if (cur.open <= priorLow20 && volRatio >= 1.3) {
                // Breakaway Gap-Down: Breakdown below prior support with strong volume
                type = 'Breakaway';
            } else if (ret10 < -0.04 && volRatio >= 1.15 && fillDuration >= 5) {
                // Runaway Gap-Down: Mid-downtrend continuation
                type = 'Runaway';
            } else if (ret10 < -0.06 && fillDuration <= 5) {
                // Exhaustion Gap-Down: Climax at trend low that fills quickly within 5 bars
                type = 'Exhaustion';
            } else {
                type = 'Common';
            }
        }

        gaps.push({
            id: `gap-${i}-${cur.time}`,
            barIndex: i,
            time: cur.time,
            direction: isGapUp ? 'up' : 'down',
            type,
            status,
            bottomPrice,
            topPrice,
            volumeRatio: volRatio,
            fillBarIndex,
            fillTime,
            isForex,
        });
    }

    // Step 2: Island Reversal Detection (Pairs of opposite gaps within 1-7 bars)
    for (let a = 0; a < gaps.length - 1; a++) {
        const gapA = gaps[a];
        for (let b = a + 1; b < gaps.length; b++) {
            const gapB = gaps[b];
            const deltaBars = gapB.barIndex - gapA.barIndex;
            if (deltaBars > 7) break; // Island must be 1 to 7 bars
            if (deltaBars < 1) continue;

            // Must be opposite directions
            if (gapA.direction === 'up' && gapB.direction === 'down') {
                // Bearish Island Reversal: Gap-Up followed by Gap-Down
                const overlap = gapB.topPrice >= gapA.bottomPrice && gapB.bottomPrice <= gapA.topPrice;
                if (overlap) {
                    let isolated = true;
                    for (let k = gapA.barIndex; k < gapB.barIndex; k++) {
                        if (candles[k].low < gapA.bottomPrice) {
                            isolated = false;
                            break;
                        }
                    }
                    if (isolated) {
                        gapB.type = 'Island Reversal';
                    }
                }
            } else if (gapA.direction === 'down' && gapB.direction === 'up') {
                // Bullish Island Reversal: Gap-Down followed by Gap-Up
                const overlap = gapB.bottomPrice <= gapA.topPrice && gapB.topPrice >= gapA.bottomPrice;
                if (overlap) {
                    let isolated = true;
                    for (let k = gapA.barIndex; k < gapB.barIndex; k++) {
                        if (candles[k].high > gapA.topPrice) {
                            isolated = false;
                            break;
                        }
                    }
                    if (isolated) {
                        gapB.type = 'Island Reversal';
                    }
                }
            }
        }
    }

    return gaps;
}
