import { CustomData, Time, LineData, CustomSeriesOptions, LineWidth, ISeriesPrimitive, SeriesAttachedParameter, IPrimitivePaneView, IChartApi, LineSeriesPartialOptions, ISeriesApi } from 'https://esm.sh/lightweight-charts@5.2.1/dist/typings.d.ts';

type TimeValue = Time;
type PatchOperation = 'append' | 'upsert' | 'replace' | 'remove';
type OrderFlowAggregationMode = 'tick-derived' | 'price-level-bars' | 'ohlc-synthetic';
interface InstrumentContext {
    instrumentId: string;
    symbol: string;
    tickSize: number;
    pricePrecision: number;
    volumePrecision?: number;
    timezone: string;
    defaultSessionTemplateId?: string;
}
interface SessionSegment {
    dayOfWeek: number;
    start: string;
    end: string;
}
interface SessionDefinition {
    sessionId: string;
    label: string;
    timezone?: string;
    segments: SessionSegment[];
    resetsStudies?: boolean;
}
interface PriceLevelVolume {
    price: number;
    bidVolume: number;
    askVolume: number;
    tradeCount?: number;
    totalVolume?: number;
    delta?: number;
    attributes?: Record<string, unknown>;
}
interface OrderFlowBar extends CustomData<TimeValue> {
    open: number;
    high: number;
    low: number;
    close: number;
    levels: PriceLevelVolume[];
    totalVolume?: number;
    delta?: number;
    bidVolume?: number;
    askVolume?: number;
    tradeCount?: number;
    vwap?: number;
    pocPrice?: number;
    pocVolume?: number;
    deltaMin?: number;
    deltaMax?: number;
    sessionId?: string;
    metadata?: Record<string, unknown>;
}
interface AggregatedMarketBar extends CustomData<TimeValue> {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap?: number;
    tradeCount?: number;
    bidVolume?: number;
    askVolume?: number;
    delta?: number;
    deltaMin?: number;
    deltaMax?: number;
    pocPrice?: number;
    pocVolume?: number;
    sessionId?: string;
    metadata?: Record<string, unknown>;
}
interface OrderFlowBatch {
    instrument: InstrumentContext;
    sessions?: SessionDefinition[];
    bars: OrderFlowBar[];
}
interface OrderFlowPatch {
    operation: PatchOperation;
    bars?: OrderFlowBar[];
    correctedTimes?: TimeValue[];
    metadata?: Record<string, unknown>;
}
interface TradeTick {
    time: number;
    price: number;
    size: number;
    exchange?: string;
    side?: 'buy' | 'sell' | 'unknown';
    attributes?: Record<string, unknown>;
}
interface QuoteTick {
    time: number;
    bidPrice: number;
    askPrice: number;
    bidSize: number;
    askSize: number;
    attributes?: Record<string, unknown>;
}
interface OrderFlowTickStreamUpdate {
    trades?: TradeTick[];
    quotes?: QuoteTick[];
    metadata?: Record<string, unknown>;
}
interface TickSessionChunk {
    file: string;
    kind: 'trades' | 'quotes';
    compression?: 'gzip' | 'none';
    timeFrom: number;
    timeTo: number;
    tickCount: number;
    complete?: boolean;
}
interface TickSessionManifest {
    symbol: string;
    sessionDate: string;
    timezone: string;
    sourceMode: OrderFlowAggregationMode;
    tradesAvailable: boolean;
    quotesAvailable?: boolean;
    complete: boolean;
    chunks?: TickSessionChunk[];
    notes?: string[];
}
interface NormalizationOptions {
    instrument?: InstrumentContext;
    sessions?: SessionDefinition[];
    deriveSessions?: boolean;
}
interface VwapPoint extends LineData<TimeValue> {
    sessionId?: string;
}

type NumericRoundingMode = 'round' | 'ceil' | 'floor';
interface NumericTextFormatOptions {
    digits: number;
    rounding: NumericRoundingMode;
}
interface CompactNumericFormatOptions {
    integerDigits: number;
    decimalDigits: number;
    rounding: NumericRoundingMode;
    suffixVisible: boolean;
}
declare function clampDecimalDigits(digits: number): number;
declare function clampIntegerDigits(digits: number): number;
declare function roundToDigits(value: number, digits: number, rounding?: NumericRoundingMode): number;
declare function formatNumericValue(value: number, options: NumericTextFormatOptions): string;
declare function formatCompactNumericValue(value: number, options: CompactNumericFormatOptions): string;

type ImbalanceSide = 'buy' | 'sell' | 'none';
interface FootprintLevelModel {
    price: number;
    bidVolume: number;
    askVolume: number;
    totalVolume: number;
    delta: number;
    imbalanceSide: ImbalanceSide;
    isStackedImbalance: boolean;
    isPointOfControl: boolean;
    volumeRatioToMax: number;
    volumeRatioToAverage: number;
    deltaRatioToMaxAbs: number;
    absoluteDeltaRatioToMaxAbs: number;
    heat: number;
}
interface FootprintBarModel {
    time: TimeValue;
    open: number;
    high: number;
    low: number;
    close: number;
    priceStep: number | null;
    totalVolume: number;
    delta: number;
    sessionId?: string;
    levels: FootprintLevelModel[];
    maxLevelVolume: number;
    maxAbsDelta: number;
    averageLevelVolume: number;
}
interface ProfileLevel {
    price: number;
    bidVolume: number;
    askVolume: number;
    totalVolume: number;
    delta: number;
    ratio: number;
}
interface ProfileValueArea {
    high: number;
    low: number;
}
interface ProfileModel {
    scopeId: string;
    levels: ProfileLevel[];
    maxVolume: number;
    pointOfControl: number | null;
    valueArea: ProfileValueArea | null;
    fromTime?: TimeValue;
    toTime?: TimeValue;
    label?: string;
}
interface DeltaSummaryColumnModel {
    time: TimeValue;
    delta: number;
    maxDelta: number;
    minDelta: number;
    cumulativeDelta: number;
    cumulativeDeltaToVolumeRatio: number;
    volume: number;
}

type FootprintTextMode = 'bid-ask' | 'total' | 'delta' | 'none';
type FootprintCandlePosition = 'left' | 'middle' | 'right';
/**
 * Width values accept either device pixels or a percentage of the current bar spacing.
 */
type ResponsiveWidthValue = number | `${number}%`;
type HorizontalAlignment = 'left' | 'right';
type ProfileScope = {
    kind: 'visible-range';
} | {
    kind: 'session';
    sessionIds?: string[];
} | {
    kind: 'fixed-range';
    from: TimeValue;
    to: TimeValue;
};
type VwapResetMode = 'session' | 'continuous';
type DeltaSummaryColumnKey = Exclude<keyof DeltaSummaryColumnModel, 'time'>;
type DeltaSummaryMetric = DeltaSummaryColumnKey;
type FootprintMetricPlacement = 'top' | 'bottom';
type FootprintMetricAlignment = 'left' | 'center' | 'right';
type FootprintBidAskShadingMetric = 'volume/max' | 'volume/average';
type FootprintBidAskFillMode = 'by-side' | 'by-delta' | 'by-total-volume';
type FootprintBidAskSeparatorMode = 'line' | 'letter' | 'none';
type FootprintSingleCellShadingMetric = 'volume/max' | 'volume/average' | 'absolute-delta/max-abs';
type FootprintMetricValueKey = keyof Pick<FootprintBarModel, 'open' | 'high' | 'low' | 'close' | 'delta' | 'totalVolume' | 'maxLevelVolume' | 'maxAbsDelta' | 'averageLevelVolume'>;
type MetricStyleKey = 'metric0' | 'metric1' | 'metric2' | 'metric3' | 'metric4' | 'metric5' | 'metric6' | 'metric7' | 'metric8' | 'metric9';
type MetricStyleVariant = 'primary' | 'secondary';
type MetricStyleVariantMode = MetricStyleVariant | 'auto';
interface MetricStyleToken {
    color: string;
    font: string;
    border?: string;
    backgroundColor?: string;
    paddingX?: number;
    paddingY?: number;
}
interface MetricStylePaletteEntry {
    primary: MetricStyleToken;
    secondary?: Partial<MetricStyleToken>;
}
type MetricStylePalette = Partial<Record<MetricStyleKey, MetricStylePaletteEntry>>;
/**
 * Width constraints used by footprint bars and delta-summary columns.
 */
interface WidthRangeOptions {
    min: ResponsiveWidthValue;
    max: ResponsiveWidthValue;
}
interface ColorScaleStop {
    /**
     * Stop offsets are normalized between 0 and 1.
     */
    offset: number;
    color: string;
}
interface ColorScaleRangeOptions {
    /**
     * Raw metric value that maps to stop offset `0`.
     */
    from: number;
    /**
     * Raw metric value that maps to stop offset `1`.
     */
    to: number;
    clamp: boolean;
    invert: boolean;
}
interface ColorScaleOptions {
    range: ColorScaleRangeOptions;
    stops: ColorScaleStop[];
}
type ColorScalePartialOptions = Omit<Partial<ColorScaleOptions>, 'range' | 'stops'> & {
    range?: Partial<ColorScaleRangeOptions>;
    stops?: ColorScaleStop[];
};
/**
 * Diverging range used by the candle heatmap helper.
 *
 * The range is split around `threshold`. Values near `min` resolve toward `downColor`, while values
 * near `max` resolve toward `upColor`.
 */
interface CandleHeatmapRangeOptions {
    min: number;
    minShadeThreshold?: number;
    threshold: number;
    maxShadeThreshold?: number;
    max: number;
}
type CandleHeatmapShader = 'alpha' | 'hue';
/**
 * Configures metric-driven candle coloring for a standard candlestick series.
 *
 * `noOfShades: 1` collapses the mapping to two solid colors split by `threshold`.
 * `noOfShades: 0` uses a continuous mapping with 256 internal steps.
 */
interface CandleHeatmapOptions {
    range: CandleHeatmapRangeOptions;
    downColor: string;
    upColor: string;
    wickDownColor?: string;
    wickUpColor?: string;
    borderDownColor?: string;
    borderUpColor?: string;
    borderVisible: boolean;
    shadeWicks: boolean;
    noOfShades: number;
    shader: CandleHeatmapShader;
}
type CandleHeatmapPartialOptions = Omit<Partial<CandleHeatmapOptions>, 'range'> & {
    range?: Partial<CandleHeatmapRangeOptions>;
};
interface FootprintStyleOptions {
    fontFamily: string;
    fontSize: number;
    priceDecimalDigits: number;
    priceRounding: NumericRoundingMode;
    valueIntegerDigits: number;
    valueDecimalDigits: number;
    valueRounding: NumericRoundingMode;
    valueUnitVisible: boolean;
    textColor: string;
    bidTextColor: string;
    askTextColor: string;
    neutralTextColor: string;
    positiveDeltaColor: string;
    negativeDeltaColor: string;
    bullishCandleColor: string;
    bearishCandleColor: string;
    candleWickColor: string;
    candleBorderColor: string;
    separatorColor: string;
    separatorFont: string;
    bidFillColor: string;
    askFillColor: string;
    buyImbalanceColor: string;
    sellImbalanceColor: string;
    metricStyles: MetricStylePalette;
    imbalanceMetricStyleKey: MetricStyleKey | null;
    positiveImbalanceTextColor: string;
    positiveImbalanceTextFont: string;
    negativeImbalanceTextColor: string;
    negativeImbalanceTextFont: string;
    diagonalDominanceColor: string;
    diagonalDominanceFont: string;
    buyImbalanceFillColor: string;
    sellImbalanceFillColor: string;
    stackedBuyImbalanceFillColor: string;
    stackedSellImbalanceFillColor: string;
    stackedImbalanceOutline: string;
    ladderBorderColor: string;
    cellBorderColor: string;
    profileBidColor: string;
    profileAskColor: string;
    valueAreaColor: string;
    sessionLabelColor: string;
}
interface FootprintLadderOptions {
    textMode: FootprintTextMode;
    rowHeight: number;
    /**
     * Explicit price step used to place ladder rows. Set this to the instrument tick size when the
     * provided levels are sparse or aggregated.
     */
    priceStep: number;
    showHeatmap: boolean;
    bidAskFillMode: FootprintBidAskFillMode;
    imbalanceRatio: number;
    stackedImbalanceLength: number;
    highlightImbalances: boolean;
    highlightStackedImbalances: boolean;
    highlightImbalanceText: boolean;
    highlightDiagonalDominance: boolean;
    diagonalDominanceFactor: number;
    separatorMode: FootprintBidAskSeparatorMode;
    separatorLabel: string;
    separatorGap: number;
    cellPadding: number;
    borderWidth: number;
    cellBorderWidth: number;
    stackedImbalanceBorderWidth: number;
    minOpacity: number;
    maxOpacity: number;
}
interface FootprintCandleOptions {
    visible: boolean;
    position: FootprintCandlePosition;
    widthRatio: number;
    minWidth: number;
    maxWidth: number;
    gap: number;
    showWicks: boolean;
}
interface FootprintLayoutOptions {
    barWidth: WidthRangeOptions;
}
interface FootprintMetricStyleOptions {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontShorthand?: string;
    textColor: string;
    positiveTextColor: string;
    negativeTextColor: string;
    neutralTextColor: string;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderShorthand?: string;
    paddingX: number;
    paddingY: number;
}
interface FootprintMetricRenderContext {
    bar: FootprintBarModel;
    item: FootprintMetricItemOptions;
    placement: FootprintMetricPlacement;
    rawValue: number | null;
}
type FootprintMetricStyleResolverResult = Partial<FootprintMetricStyleOptions> & {
    visible?: boolean;
};
interface FootprintMetricItemOptions {
    id: string;
    visible: boolean;
    placement: FootprintMetricPlacement;
    metricStyleKey?: MetricStyleKey | null;
    metricStyleVariant?: MetricStyleVariantMode;
    valueKey?: FootprintMetricValueKey;
    label?: string;
    formatter?: (context: FootprintMetricRenderContext) => string | number | null;
    styleResolver?: (context: FootprintMetricRenderContext) => FootprintMetricStyleResolverResult | null;
    offset: number;
    align: FootprintMetricAlignment;
    minSpacing: number;
    style: FootprintMetricStyleOptions;
}
type FootprintMetricItemPartialOptions = Omit<Partial<FootprintMetricItemOptions>, 'id' | 'style'> & {
    id: string;
    style?: Partial<FootprintMetricStyleOptions>;
};
interface FootprintSummaryOptions {
    stackGap: number;
    items: FootprintMetricItemOptions[];
}
type FootprintSummaryPartialOptions = Omit<Partial<FootprintSummaryOptions>, 'items'> & {
    items?: FootprintMetricItemPartialOptions[];
};
interface FootprintPointOfControlOptions {
    visible: boolean;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
}
interface FootprintShadingOptions {
    bidAskMetric: FootprintBidAskShadingMetric;
    singleCellMetric: FootprintSingleCellShadingMetric;
    bidScale: ColorScaleOptions;
    askScale: ColorScaleOptions;
    positiveDeltaScale: ColorScaleOptions;
    negativeDeltaScale: ColorScaleOptions;
    neutralScale: ColorScaleOptions;
}
type FootprintShadingPartialOptions = Omit<Partial<FootprintShadingOptions>, 'bidScale' | 'askScale' | 'positiveDeltaScale' | 'negativeDeltaScale' | 'neutralScale'> & {
    bidScale?: ColorScalePartialOptions;
    askScale?: ColorScalePartialOptions;
    positiveDeltaScale?: ColorScalePartialOptions;
    negativeDeltaScale?: ColorScalePartialOptions;
    neutralScale?: ColorScalePartialOptions;
};
interface FootprintSeriesOptions extends CustomSeriesOptions {
    layout: FootprintLayoutOptions;
    candle: FootprintCandleOptions;
    ladder: FootprintLadderOptions;
    shading: FootprintShadingOptions;
    pointOfControl: FootprintPointOfControlOptions;
    summary: FootprintSummaryOptions;
    style: FootprintStyleOptions;
}
type FootprintSeriesPartialOptions = Omit<Partial<FootprintSeriesOptions>, 'layout' | 'candle' | 'ladder' | 'shading' | 'pointOfControl' | 'summary' | 'style'> & {
    layout?: Partial<FootprintLayoutOptions>;
    candle?: Partial<FootprintCandleOptions>;
    ladder?: Partial<FootprintLadderOptions>;
    shading?: FootprintShadingPartialOptions;
    pointOfControl?: Partial<FootprintPointOfControlOptions>;
    summary?: FootprintSummaryPartialOptions;
    style?: Partial<FootprintStyleOptions>;
};
interface PointOfControlOptions {
    backgroundColor: string;
    borderColor: string;
    lineWidth: number;
}
interface VolumeProfileStyleOptions {
    profileBidColor: string;
    profileAskColor: string;
    valueAreaColor: string;
    sessionLabelColor: string;
}
interface VolumeProfileOptions {
    widthRatio: number;
    align: HorizontalAlignment;
    scope: ProfileScope;
    valueAreaPercent: number;
    showPointOfControl: boolean;
    showValueArea: boolean;
    opacity: number;
    pointOfControl: PointOfControlOptions;
    style: VolumeProfileStyleOptions;
}
interface SessionVolumeProfileOptions extends VolumeProfileOptions {
    sessions?: SessionDefinition[];
    showSessionLabels: boolean;
}
interface VolumeFootprintOptions extends FootprintSeriesOptions {
}
type VolumeFootprintPartialOptions = FootprintSeriesPartialOptions;
type VolumeProfilePartialOptions = Omit<Partial<VolumeProfileOptions>, 'pointOfControl' | 'style'> & {
    pointOfControl?: Partial<PointOfControlOptions>;
    style?: Partial<VolumeProfileStyleOptions>;
};
type SessionVolumeProfilePartialOptions = Omit<Partial<SessionVolumeProfileOptions>, 'pointOfControl' | 'style'> & {
    pointOfControl?: Partial<PointOfControlOptions>;
    style?: Partial<VolumeProfileStyleOptions>;
};
interface DeltaSummaryRowStyleOptions {
    positiveFillColor: string;
    negativeFillColor: string;
    neutralFillColor: string;
    positiveFillScale: ColorScaleOptions;
    negativeFillScale: ColorScaleOptions;
    neutralFillScale: ColorScaleOptions;
    textColor: string;
}
type DeltaSummaryRowStylePartialOptions = Omit<Partial<DeltaSummaryRowStyleOptions>, 'positiveFillScale' | 'negativeFillScale' | 'neutralFillScale'> & {
    positiveFillScale?: ColorScalePartialOptions;
    negativeFillScale?: ColorScalePartialOptions;
    neutralFillScale?: ColorScalePartialOptions;
};
interface DeltaSummarySeriesOptions extends CustomSeriesOptions {
    /**
     * The rendered summary rows, selected by `DeltaSummaryColumnModel` keys.
     */
    rows: DeltaSummaryColumnKey[];
    rowLabels: Partial<Record<DeltaSummaryColumnKey, string>>;
    rowHeight: number;
    columnWidth: WidthRangeOptions;
    labelWidth: number;
    showLabels: boolean;
    fontFamily: string;
    fontSize: number;
    labelBackgroundColor: string;
    labelTextColor: string;
    cellBorderColor: string;
    cellBorderWidth: number;
    minOpacity: number;
    maxOpacity: number;
    rowStyles: Record<DeltaSummaryColumnKey, DeltaSummaryRowStyleOptions>;
}
type DeltaSummarySeriesPartialOptions = Omit<Partial<DeltaSummarySeriesOptions>, 'columnWidth' | 'rowLabels' | 'rowStyles'> & {
    columnWidth?: Partial<WidthRangeOptions>;
    rowLabels?: Partial<Record<DeltaSummaryColumnKey, string>>;
    rowStyles?: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>>;
};
interface VwapOptions {
    color: string;
    lineWidth: LineWidth;
    resetMode: VwapResetMode;
    sessions?: SessionDefinition[];
}
declare function createFootprintMetricPresets(style?: FootprintStyleOptions): Record<'delta' | 'volume', FootprintMetricItemOptions>;
declare const DEFAULT_FOOTPRINT_STYLE: FootprintStyleOptions;
declare const DEFAULT_FOOTPRINT_LAYOUT_OPTIONS: FootprintLayoutOptions;
declare const DEFAULT_FOOTPRINT_CANDLE_OPTIONS: FootprintCandleOptions;
declare const DEFAULT_FOOTPRINT_LADDER_OPTIONS: FootprintLadderOptions;
declare const DEFAULT_FOOTPRINT_POINT_OF_CONTROL_OPTIONS: FootprintPointOfControlOptions;
declare const DEFAULT_FOOTPRINT_METRIC_PRESETS: Record<"delta" | "volume", FootprintMetricItemOptions>;
declare const DEFAULT_FOOTPRINT_SUMMARY_OPTIONS: FootprintSummaryOptions;
declare const DEFAULT_FOOTPRINT_SHADING_OPTIONS: FootprintShadingOptions;
declare const DEFAULT_FOOTPRINT_SERIES_OPTIONS: FootprintSeriesOptions;
declare const DEFAULT_VOLUME_PROFILE_OPTIONS: VolumeProfileOptions;
declare const DEFAULT_SESSION_VOLUME_PROFILE_OPTIONS: SessionVolumeProfileOptions;
declare const DEFAULT_VOLUME_FOOTPRINT_OPTIONS: VolumeFootprintOptions;
declare const DEFAULT_DELTA_SUMMARY_ROW_STYLES: Record<DeltaSummaryColumnKey, DeltaSummaryRowStyleOptions>;
declare const DEFAULT_DELTA_SUMMARY_SERIES_OPTIONS: DeltaSummarySeriesOptions;
declare const DEFAULT_VWAP_OPTIONS: VwapOptions;
declare const DEFAULT_CANDLE_HEATMAP_OPTIONS: CandleHeatmapOptions;
declare function mergeFootprintSeriesOptions(options?: FootprintSeriesPartialOptions): FootprintSeriesOptions;
declare function mergeVolumeProfileOptions(options?: VolumeProfilePartialOptions): VolumeProfileOptions;
declare function mergeSessionVolumeProfileOptions(options?: SessionVolumeProfilePartialOptions): SessionVolumeProfileOptions;
declare function mergeDeltaSummarySeriesOptions(options?: DeltaSummarySeriesPartialOptions): DeltaSummarySeriesOptions;
declare function mergeVwapOptions(options?: Partial<VwapOptions>): VwapOptions;
declare function mergeCandleHeatmapOptions(options?: CandleHeatmapPartialOptions): CandleHeatmapOptions;

interface VolumeProfilePrimitiveConfig {
    bars: OrderFlowBar[];
    options?: VolumeProfilePartialOptions;
}
declare class VolumeProfilePrimitive implements ISeriesPrimitive<TimeValue> {
    private readonly options;
    private readonly paneRenderer;
    private readonly paneView;
    private attachedParam?;
    private bars;
    private renderState;
    constructor(config: VolumeProfilePrimitiveConfig);
    attached(param: SeriesAttachedParameter<TimeValue, 'Custom'>): void;
    detached(): void;
    paneViews(): readonly IPrimitivePaneView[];
    updateAllViews(): void;
    setData(bars: OrderFlowBar[]): void;
}
declare function createVolumeProfilePrimitive(config: VolumeProfilePrimitiveConfig): VolumeProfilePrimitive;

interface SessionProfilePrimitiveConfig {
    bars: OrderFlowBar[];
    options?: SessionVolumeProfilePartialOptions;
}
declare class SessionVolumeProfilePrimitive implements ISeriesPrimitive<TimeValue> {
    private readonly options;
    private readonly paneRenderer;
    private readonly paneView;
    private attachedParam?;
    private bars;
    private renderState;
    constructor(config: SessionProfilePrimitiveConfig);
    attached(param: SeriesAttachedParameter<TimeValue, 'Custom'>): void;
    detached(): void;
    paneViews(): readonly IPrimitivePaneView[];
    updateAllViews(): void;
    setData(bars: OrderFlowBar[]): void;
}
declare function createSessionVolumeProfilePrimitive(config: SessionProfilePrimitiveConfig): SessionVolumeProfilePrimitive;

interface VwapController {
    series: ISeriesApi<'Line', TimeValue>;
    setData(bars: OrderFlowBar[]): void;
    applyPatch(patch: OrderFlowPatch): void;
    destroy(): void;
}
interface CreateVwapControllerConfig {
    chart: IChartApi;
    bars: OrderFlowBar[];
    options?: Partial<VwapOptions>;
    lineOptions?: LineSeriesPartialOptions;
    paneIndex?: number;
}
declare function createVwapController(config: CreateVwapControllerConfig): VwapController;

export { DEFAULT_CANDLE_HEATMAP_OPTIONS as $, type MetricStyleToken as A, type InstrumentContext as B, type CandleHeatmapPartialOptions as C, type DeltaSummarySeriesPartialOptions as D, type TradeTick as E, type FootprintSeriesPartialOptions as F, type OrderFlowTickStreamUpdate as G, type ColorScaleOptions as H, type ImbalanceSide as I, type AggregatedMarketBar as J, type MetricStylePalette as K, type MetricStyleVariant as L, type MetricStyleKey as M, type NumericRoundingMode as N, type OrderFlowBar as O, type ProfileModel as P, type QuoteTick as Q, type MetricStyleVariantMode as R, type SessionVolumeProfilePartialOptions as S, type TimeValue as T, type CandleHeatmapOptions as U, type VolumeProfilePartialOptions as V, type CandleHeatmapRangeOptions as W, type CandleHeatmapShader as X, type ColorScalePartialOptions as Y, type ColorScaleStop as Z, type CompactNumericFormatOptions as _, type VolumeFootprintPartialOptions as a, DEFAULT_DELTA_SUMMARY_ROW_STYLES as a0, DEFAULT_DELTA_SUMMARY_SERIES_OPTIONS as a1, DEFAULT_FOOTPRINT_CANDLE_OPTIONS as a2, DEFAULT_FOOTPRINT_LADDER_OPTIONS as a3, DEFAULT_FOOTPRINT_LAYOUT_OPTIONS as a4, DEFAULT_FOOTPRINT_METRIC_PRESETS as a5, DEFAULT_FOOTPRINT_POINT_OF_CONTROL_OPTIONS as a6, DEFAULT_FOOTPRINT_SERIES_OPTIONS as a7, DEFAULT_FOOTPRINT_SHADING_OPTIONS as a8, DEFAULT_FOOTPRINT_STYLE as a9, type ProfileScope as aA, type ResponsiveWidthValue as aB, type SessionSegment as aC, type SessionVolumeProfileOptions as aD, type TickSessionChunk as aE, type TickSessionManifest as aF, type VolumeProfileOptions as aG, type VolumeProfileStyleOptions as aH, type WidthRangeOptions as aI, clampDecimalDigits as aJ, clampIntegerDigits as aK, createFootprintMetricPresets as aL, createSessionVolumeProfilePrimitive as aM, createVolumeProfilePrimitive as aN, createVwapController as aO, formatCompactNumericValue as aP, formatNumericValue as aQ, mergeCandleHeatmapOptions as aR, mergeDeltaSummarySeriesOptions as aS, mergeFootprintSeriesOptions as aT, mergeSessionVolumeProfileOptions as aU, mergeVolumeProfileOptions as aV, mergeVwapOptions as aW, roundToDigits as aX, VolumeProfilePrimitive as aY, SessionVolumeProfilePrimitive as aZ, type VwapController as a_, DEFAULT_FOOTPRINT_SUMMARY_OPTIONS as aa, DEFAULT_SESSION_VOLUME_PROFILE_OPTIONS as ab, DEFAULT_VOLUME_FOOTPRINT_OPTIONS as ac, DEFAULT_VOLUME_PROFILE_OPTIONS as ad, DEFAULT_VWAP_OPTIONS as ae, type DeltaSummaryMetric as af, type DeltaSummaryRowStyleOptions as ag, type FootprintBidAskShadingMetric as ah, type FootprintCandleOptions as ai, type FootprintLayoutOptions as aj, type FootprintLevelModel as ak, type FootprintMetricAlignment as al, type FootprintMetricItemOptions as am, type FootprintMetricPlacement as an, type FootprintMetricRenderContext as ao, type FootprintMetricStyleOptions as ap, type FootprintMetricStyleResolverResult as aq, type FootprintMetricValueKey as ar, type FootprintPointOfControlOptions as as, type FootprintShadingOptions as at, type FootprintSingleCellShadingMetric as au, type HorizontalAlignment as av, type NumericTextFormatOptions as aw, type OrderFlowAggregationMode as ax, type PatchOperation as ay, type PointOfControlOptions as az, type FootprintTextMode as b, type FootprintBidAskFillMode as c, type FootprintBidAskSeparatorMode as d, type FootprintCandlePosition as e, type MetricStylePaletteEntry as f, type DeltaSummaryColumnKey as g, type DeltaSummaryRowStylePartialOptions as h, type FootprintMetricItemPartialOptions as i, type FootprintStyleOptions as j, type FootprintShadingPartialOptions as k, type ColorScaleRangeOptions as l, type NormalizationOptions as m, type OrderFlowBatch as n, type OrderFlowPatch as o, type SessionDefinition as p, type DeltaSummaryColumnModel as q, type FootprintSeriesOptions as r, type FootprintBarModel as s, type ProfileLevel as t, type ProfileValueArea as u, type PriceLevelVolume as v, type VwapOptions as w, type VwapPoint as x, type DeltaSummarySeriesOptions as y, type VolumeFootprintOptions as z };
