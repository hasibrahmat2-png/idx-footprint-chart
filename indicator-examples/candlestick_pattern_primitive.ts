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
import { DetectedCandlestickPattern } from './candlestick-pattern-detector';

export interface CandlestickPatternPrimitiveData {
    patterns: DetectedCandlestickPattern[];
    visible: boolean;
}

interface LabelBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

let fontInjected = false;

/**
 * Dynamically injects handwritten fonts ('Caveat' & 'Patrick Hand') into the document head
 * once so the blackboard teacher handwriting style renders authentically across all platforms.
 */
function ensureHandwritingFontLoaded(): void {
    if (fontInjected || typeof document === 'undefined') return;
    fontInjected = true;
    try {
        const id = 'lw-handwriting-font-link';
        if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href =
                'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Patrick+Hand&display=swap';
            document.head.appendChild(link);
        }
    } catch {
        // Fallback to native OS handwriting fonts if offline
    }
}

const HANDWRITTEN_FONT_STACK =
    '700 15px "Caveat", "Patrick Hand", "Segoe Print", "Bradley Hand", "Chalkboard SE", "Marker Felt", "Comic Sans MS", cursive, sans-serif';

/**
 * Deterministic 32-bit FNV-1a hash from pattern ID so each hand-drawn circle has
 * a unique asymmetric shape that stays rock-solid when scrolling or zooming the chart.
 */
function hashSeed(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Returns a deterministic pseudo-random float in [0, 1] from a mutable seed.
 */
function nextRand(seedObj: { s: number }): number {
    let t = (seedObj.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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
 * Draws an asymmetrical, irregular hand-drawn loop like a teacher circling an important
 * word on a blackboard—complete with organic radial wobble, slight diagonal tilt,
 * unclosed/overlapping start-end tails, and a secondary chalk/marker pressure pass.
 */
function drawTeacherChalkCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    primaryColor: string,
    secondaryColor: string,
    seedStr: string
): void {
    const rng = { s: hashSeed(seedStr) };

    // Teacher's hand slant (-12 deg to +12 deg)
    const tiltAngle = (nextRand(rng) - 0.5) * 0.42;
    const cosTilt = Math.cos(tiltAngle);
    const sinTilt = Math.sin(tiltAngle);

    // Start near the top-left or top-right (around -110 deg to -60 deg)
    const startAngle = -Math.PI * (0.35 + nextRand(rng) * 0.35);
    // Teacher's stroke overshoots past a full 360 circle by 25 to 55 degrees
    const totalSweep = Math.PI * 2 + (0.42 + nextRand(rng) * 0.48);

    // Harmonic phases and amplitudes for organic asymmetry (never a geometric ellipse!)
    const p1 = nextRand(rng) * Math.PI * 2;
    const p2 = nextRand(rng) * Math.PI * 2;
    const p3 = nextRand(rng) * Math.PI * 2;
    const p4 = nextRand(rng) * Math.PI * 2;

    const a1 = 0.06 + nextRand(rng) * 0.06; // 1st harmonic lopsidedness
    const a2 = 0.05 + nextRand(rng) * 0.06; // 2nd harmonic pinch/bulge
    const a3 = 0.03 + nextRand(rng) * 0.04; // 3rd harmonic hand tremor
    const a4 = 0.015 + nextRand(rng) * 0.025; // 5th harmonic fine chalk wobble

    // Spiral drift so the end tail passes slightly outside or inside the starting tail
    const spiralDrift = (nextRand(rng) > 0.5 ? 1 : -1) * (0.1 + nextRand(rng) * 0.08);

    const steps = 44;

    const computePoint = (u: number, extraOffset: number = 0): { x: number; y: number } => {
        const theta = startAngle + u * totalSweep;

        // Entry and exit tail flair (teacher's hand lifting onto and off the board)
        let tailFlair = 0;
        if (u < 0.08) {
            tailFlair = (1 - u / 0.08) * 0.09;
        } else if (u > 0.88) {
            tailFlair = ((u - 0.88) / 0.12) * 0.11;
        }

        const radialWobble =
            1 +
            a1 * Math.sin(theta + p1) +
            a2 * Math.cos(2 * theta + p2) +
            a3 * Math.sin(3 * theta + p3) +
            a4 * Math.cos(5 * theta + p4) +
            spiralDrift * (u - 0.5) +
            tailFlair +
            extraOffset;

        const localX = rx * radialWobble * Math.cos(theta);
        const localY = ry * radialWobble * Math.sin(theta);

        // Apply hand slant rotation
        const rotX = localX * cosTilt - localY * sinTilt;
        const rotY = localX * sinTilt + localY * cosTilt;

        return { x: cx + rotX, y: cy + rotY };
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Dark board contrast under-stroke so the chalk circle pops cleanly over any candle wicks
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
        const pt = computePoint(s / steps, 0);
        if (s === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineWidth = 4.0;
    ctx.strokeStyle = 'rgba(11, 14, 20, 0.72)';
    ctx.stroke();

    // 2. Primary teacher chalk/marker hand-drawn stroke
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
        const pt = computePoint(s / steps, 0);
        if (s === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineWidth = 2.15;
    ctx.strokeStyle = primaryColor;
    ctx.stroke();

    // 3. Secondary sketchy chalk texture pass (slightly offset double-loop edge)
    ctx.beginPath();
    for (let s = 3; s <= steps - 4; s++) {
        const u = s / steps;
        const offset = 0.035 * Math.sin(u * Math.PI * 3 + p2);
        const pt = computePoint(u, offset);
        if (s === 3) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineWidth = 1.05;
    ctx.strokeStyle = secondaryColor;
    ctx.stroke();

    ctx.restore();
}

/**
 * Draws a short hand-drawn pointer tick & sketchy underline connecting the circle to the handwritten badge.
 */
function drawHandwrittenPointerAndUnderline(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    textWidth: number,
    isAbove: boolean,
    color: string,
    seedStr: string
): void {
    const rng = { s: hashSeed(seedStr + '_ptr') };
    const curveBend = (nextRand(rng) - 0.5) * 10;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Short hand-drawn connector tick from circle edge toward text
    const midX = (fromX + toX) * 0.5 + curveBend;
    const midY = (fromY + toY) * 0.5;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.quadraticCurveTo(midX, midY, toX, isAbove ? toY + 7 : toY - 7);
    ctx.lineWidth = 1.35;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Sketchy hand-drawn underline beneath the handwritten candle name
    const lineY = isAbove ? toY + 6 : toY + 8;
    const halfW = Math.min(textWidth * 0.48, 68);
    const waveY = (nextRand(rng) - 0.5) * 2.5;

    ctx.beginPath();
    ctx.moveTo(toX - halfW, lineY + waveY * 0.5);
    ctx.quadraticCurveTo(toX, lineY - waveY, toX + halfW, lineY + waveY * 0.3);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.restore();
}

/**
 * Renders the candle pattern name in a slightly tilted handwritten font with dark halo contrast.
 */
function drawHandwrittenBadge(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    seedStr: string
): number {
    const rng = { s: hashSeed(seedStr + '_txt') };
    // Subtle human handwriting tilt (-2.8 deg to +2.8 deg)
    const textTilt = (nextRand(rng) - 0.5) * 0.095;

    ctx.save();
    ctx.font = HANDWRITTEN_FONT_STACK;
    const measuredW = ctx.measureText(text).width;

    ctx.translate(x, y);
    ctx.rotate(textTilt);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // Dark blackboard halo outline (zero rectangular boxes, 100% legible over candles)
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(11, 14, 20, 0.90)';
    ctx.strokeText(text, 0, 0);

    // Handwritten chalk/marker ink fill
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);

    ctx.restore();
    return measuredW;
}

class CandlestickPatternPaneRenderer implements IPrimitivePaneRenderer {
    private _data: CandlestickPatternPrimitiveData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;

    constructor(
        data: CandlestickPatternPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._data = data;
        this._series = series;
        this._chart = chart;
    }

    public update(
        data: CandlestickPatternPrimitiveData | null,
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

        ensureHandwritingFontLoaded();

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;
            const height = mediaSize.height;

            const timeScale = this._chart!.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            const barSpacing = Math.max(
                4,
                Math.min(28, width / Math.max(20, visibleRange ? visibleRange.to - visibleRange.from : 80))
            );

            const placedBadges: LabelBounds[] = [];

            const resolveBadgePosition = (
                prefX: number,
                prefY: number,
                w: number,
                h: number,
                isBearishAbove: boolean
            ): { x: number; y: number } => {
                const clampedX = Math.max(w * 0.5 + 8, Math.min(width - w * 0.5 - 8, prefX));
                let curY = Math.max(16, Math.min(height - 16, prefY));
                const step = isBearishAbove ? -16 : 16;

                for (let attempt = 0; attempt < 5; attempt++) {
                    const hit = placedBadges.some(
                        (b) =>
                            Math.abs(clampedX - b.x) < (w + b.w) * 0.52 &&
                            Math.abs(curY - b.y) < (h + b.h) * 0.65
                    );
                    if (!hit) break;
                    curY = Math.max(16, Math.min(height - 16, curY + step));
                }

                placedBadges.push({ x: clampedX, y: curY, w, h });
                return { x: clampedX, y: curY };
            };

            for (const pat of this._data!.patterns) {
                // Viewport culling
                if (visibleRange) {
                    if (
                        pat.endIndex < visibleRange.from - 10 ||
                        pat.startIndex > visibleRange.to + 10
                    ) {
                        continue;
                    }
                }

                const xStart = resolveX(timeScale, pat.startTime, pat.startIndex);
                const xEnd = resolveX(timeScale, pat.endTime, pat.endIndex);
                if (xStart === null || xEnd === null) continue;

                const yHigh = this._series!.priceToCoordinate(pat.highPrice);
                const yLow = this._series!.priceToCoordinate(pat.lowPrice);
                if (yHigh === null || yLow === null) continue;

                const cx = (xStart + xEnd) * 0.5;
                if (cx < -50 || cx > width + 50) continue;

                const topY = Math.min(yHigh, yLow);
                const botY = Math.max(yHigh, yLow);
                const cy = (topY + botY) * 0.5;

                // Calculate organic envelope radii around the 1, 2, 3, or 5 candles
                const spanPx = Math.abs(xEnd - xStart);
                const rx = Math.max(barSpacing * 0.85, spanPx * 0.5 + barSpacing * 0.68, 12);
                const ry = Math.max((botY - topY) * 0.5 + 9, 14);

                // Strict color rule requested by user:
                // - Bullish candle pattern: Green circle & Green handwritten font
                // - Bearish candle pattern: Red circle & Red handwritten font
                const isBullish = pat.direction === 'bullish';
                const primaryColor = isBullish ? '#2ECC71' : '#FF5252';
                const secondaryColor = isBullish
                    ? 'rgba(46, 204, 113, 0.45)'
                    : 'rgba(255, 82, 82, 0.45)';

                // 1. Draw the asymmetrical teacher blackboard hand-drawn circle
                drawTeacherChalkCircle(
                    ctx,
                    cx,
                    cy,
                    rx,
                    ry,
                    primaryColor,
                    secondaryColor,
                    pat.id
                );

                // 2. Place handwritten pattern name badge (above circle for Bearish, below circle for Bullish)
                ctx.font = HANDWRITTEN_FONT_STACK;
                const estTextW = Math.max(pat.name.length * 7.5, ctx.measureText(pat.name).width);
                const isAbove = !isBullish; // Bearish at top -> label above; Bullish at bottom -> label below
                const rawBadgeY = isAbove ? cy - ry - 20 : cy + ry + 20;

                // Slight horizontal offset like a teacher writing the note next to the circle
                const rng = { s: hashSeed(pat.id + '_offset') };
                const offsetX = (nextRand(rng) - 0.5) * 18;

                const badgePos = resolveBadgePosition(
                    cx + offsetX,
                    rawBadgeY,
                    estTextW,
                    18,
                    isAbove
                );

                // 3. Draw hand-drawn pointer tick & underline
                const circleEdgeY = isAbove ? cy - ry * 0.95 : cy + ry * 0.95;
                drawHandwrittenPointerAndUnderline(
                    ctx,
                    cx,
                    circleEdgeY,
                    badgePos.x,
                    badgePos.y,
                    estTextW,
                    isAbove,
                    secondaryColor,
                    pat.id
                );

                // 4. Draw handwritten text badge
                drawHandwrittenBadge(
                    ctx,
                    pat.name,
                    badgePos.x,
                    badgePos.y,
                    primaryColor,
                    pat.id
                );
            }
        });
    }
}

class CandlestickPatternPaneView implements IPrimitivePaneView {
    private _renderer: CandlestickPatternPaneRenderer;

    constructor(
        data: CandlestickPatternPrimitiveData | null,
        series: ISeriesApi<SeriesType> | null,
        chart: IChartApiBase<Time> | null
    ) {
        this._renderer = new CandlestickPatternPaneRenderer(data, series, chart);
    }

    public update(
        data: CandlestickPatternPrimitiveData | null,
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

export class CandlestickPatternPrimitive implements ISeriesPrimitive<Time> {
    private _data: CandlestickPatternPrimitiveData | null = null;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _chart: IChartApiBase<Time> | null = null;
    private _paneView: CandlestickPatternPaneView;

    constructor() {
        this._paneView = new CandlestickPatternPaneView(null, null, null);
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

    public setData(data: CandlestickPatternPrimitiveData | null): void {
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