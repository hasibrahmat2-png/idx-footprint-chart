import { D as DeltaSummarySeriesPartialOptions, F as FootprintSeriesPartialOptions, V as VolumeProfilePartialOptions, a as VolumeFootprintPartialOptions, S as SessionVolumeProfilePartialOptions, b as FootprintTextMode, c as FootprintBidAskFillMode, d as FootprintBidAskSeparatorMode, e as FootprintCandlePosition, N as NumericRoundingMode, M as MetricStyleKey, f as MetricStylePaletteEntry, g as DeltaSummaryColumnKey, h as DeltaSummaryRowStylePartialOptions, C as CandleHeatmapPartialOptions, i as FootprintMetricItemPartialOptions, j as FootprintStyleOptions, k as FootprintShadingPartialOptions, l as ColorScaleRangeOptions, O as OrderFlowBar, m as NormalizationOptions, n as OrderFlowBatch, o as OrderFlowPatch, p as SessionDefinition, q as DeltaSummaryColumnModel, I as ImbalanceSide, r as FootprintSeriesOptions, s as FootprintBarModel, P as ProfileModel, T as TimeValue, t as ProfileLevel, u as ProfileValueArea, v as PriceLevelVolume, w as VwapOptions, x as VwapPoint, y as DeltaSummarySeriesOptions, z as VolumeFootprintOptions, A as MetricStyleToken, B as InstrumentContext, E as TradeTick, Q as QuoteTick, G as OrderFlowTickStreamUpdate, H as ColorScaleOptions, J as AggregatedMarketBar, K as MetricStylePalette, L as MetricStyleVariant, R as MetricStyleVariantMode } from './createVwapController-CUMvd7Dz.d.ts';
export { U as CandleHeatmapOptions, W as CandleHeatmapRangeOptions, X as CandleHeatmapShader, Y as ColorScalePartialOptions, Z as ColorScaleStop, _ as CompactNumericFormatOptions, $ as DEFAULT_CANDLE_HEATMAP_OPTIONS, a0 as DEFAULT_DELTA_SUMMARY_ROW_STYLES, a1 as DEFAULT_DELTA_SUMMARY_SERIES_OPTIONS, a2 as DEFAULT_FOOTPRINT_CANDLE_OPTIONS, a3 as DEFAULT_FOOTPRINT_LADDER_OPTIONS, a4 as DEFAULT_FOOTPRINT_LAYOUT_OPTIONS, a5 as DEFAULT_FOOTPRINT_METRIC_PRESETS, a6 as DEFAULT_FOOTPRINT_POINT_OF_CONTROL_OPTIONS, a7 as DEFAULT_FOOTPRINT_SERIES_OPTIONS, a8 as DEFAULT_FOOTPRINT_SHADING_OPTIONS, a9 as DEFAULT_FOOTPRINT_STYLE, aa as DEFAULT_FOOTPRINT_SUMMARY_OPTIONS, ab as DEFAULT_SESSION_VOLUME_PROFILE_OPTIONS, ac as DEFAULT_VOLUME_FOOTPRINT_OPTIONS, ad as DEFAULT_VOLUME_PROFILE_OPTIONS, ae as DEFAULT_VWAP_OPTIONS, af as DeltaSummaryMetric, ag as DeltaSummaryRowStyleOptions, ah as FootprintBidAskShadingMetric, ai as FootprintCandleOptions, aj as FootprintLayoutOptions, ak as FootprintLevelModel, al as FootprintMetricAlignment, am as FootprintMetricItemOptions, an as FootprintMetricPlacement, ao as FootprintMetricRenderContext, ap as FootprintMetricStyleOptions, aq as FootprintMetricStyleResolverResult, ar as FootprintMetricValueKey, as as FootprintPointOfControlOptions, at as FootprintShadingOptions, au as FootprintSingleCellShadingMetric, av as HorizontalAlignment, aw as NumericTextFormatOptions, ax as OrderFlowAggregationMode, ay as PatchOperation, az as PointOfControlOptions, aA as ProfileScope, aB as ResponsiveWidthValue, aC as SessionSegment, aD as SessionVolumeProfileOptions, aE as TickSessionChunk, aF as TickSessionManifest, aG as VolumeProfileOptions, aH as VolumeProfileStyleOptions, aI as WidthRangeOptions, aJ as clampDecimalDigits, aK as clampIntegerDigits, aL as createFootprintMetricPresets, aM as createSessionVolumeProfilePrimitive, aN as createVolumeProfilePrimitive, aO as createVwapController, aP as formatCompactNumericValue, aQ as formatNumericValue, aR as mergeCandleHeatmapOptions, aS as mergeDeltaSummarySeriesOptions, aT as mergeFootprintSeriesOptions, aU as mergeSessionVolumeProfileOptions, aV as mergeVolumeProfileOptions, aW as mergeVwapOptions, aX as roundToDigits } from './createVwapController-CUMvd7Dz.d.ts';
import * as lightweight_charts from 'https://esm.sh/lightweight-charts@5.2.1/dist/typings.d.ts';
import { CandlestickSeriesPartialOptions, HistogramSeriesPartialOptions, LineSeriesPartialOptions, CandlestickData, ICustomSeriesPaneView, ISeriesPrimitive, SeriesAttachedParameter, IPrimitivePaneView, IChartApi } from 'https://esm.sh/lightweight-charts@5.2.1/dist/typings.d.ts';

interface OrderFlowStylePresetPack {
    id: string;
    label: string;
    footprint?: FootprintSeriesPartialOptions;
    volumeFootprint?: VolumeFootprintPartialOptions;
    volumeProfile?: VolumeProfilePartialOptions;
    sessionVolumeProfile?: SessionVolumeProfilePartialOptions;
    deltaSummary?: DeltaSummarySeriesPartialOptions;
}
declare const CLASSIC_REFERENCE_FOOTPRINT_OPTIONS: FootprintSeriesPartialOptions;
declare const ORDER_FLOW_DELTA_FOOTPRINT_OPTIONS: FootprintSeriesPartialOptions;
declare const DARK_REFERENCE_FOOTPRINT_BASE_OPTIONS: FootprintSeriesPartialOptions;
declare const DARK_REFERENCE_DELTA_SUMMARY_OPTIONS: DeltaSummarySeriesPartialOptions;
declare const CLASSIC_REFERENCE_DELTA_SUMMARY_OPTIONS: DeltaSummarySeriesPartialOptions;
declare const CORN_REFERENCE_FOOTPRINT_OPTIONS: FootprintSeriesPartialOptions;
declare const VOLUME_FOOTPRINT_REFERENCE_OPTIONS: VolumeFootprintPartialOptions;
declare const LEFT_ALIGNED_REFERENCE_VOLUME_PROFILE_OPTIONS: VolumeProfilePartialOptions;
declare const SHADED_REFERENCE_VOLUME_PROFILE_OPTIONS: VolumeProfilePartialOptions;
declare const SHADED_REFERENCE_FOOTPRINT_OPTIONS: FootprintSeriesPartialOptions;
declare const SHADED_REFERENCE_DELTA_SUMMARY_OPTIONS: DeltaSummarySeriesPartialOptions;
declare const ORDER_FLOW_REFERENCE_FOOTPRINT_OPTIONS: FootprintSeriesPartialOptions;
declare const ORDER_FLOW_STYLE_PRESETS: {
    modernDark: {
        id: string;
        label: string;
        footprint: {
            pointOfControl: {
                visible: false;
            };
        };
    };
    classicReference: {
        id: string;
        label: string;
        footprint: FootprintSeriesPartialOptions;
        deltaSummary: DeltaSummarySeriesPartialOptions;
    };
    darkReferenceBase: {
        id: string;
        label: string;
        footprint: FootprintSeriesPartialOptions;
        deltaSummary: DeltaSummarySeriesPartialOptions;
    };
    cornReference: {
        id: string;
        label: string;
        footprint: FootprintSeriesPartialOptions;
        deltaSummary: DeltaSummarySeriesPartialOptions;
    };
    volumeFootprintReference: {
        id: string;
        label: string;
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
    };
    shadedReference: {
        id: string;
        label: string;
        footprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        deltaSummary: DeltaSummarySeriesPartialOptions;
    };
    orderFlowReference: {
        id: string;
        label: string;
        footprint: FootprintSeriesPartialOptions;
    };
};

interface OrderFlowSurfaceTheme {
    backgroundColor: string;
    textColor: string;
    gridColor: string;
    gridVisible: boolean;
    borderColor: string;
    crosshairColor: string;
    panelBackground: string;
    panelBorder: string;
}
interface OrderFlowThemePresetPack extends OrderFlowStylePresetPack {
    mode: 'dark' | 'light';
    description: string;
    surface: OrderFlowSurfaceTheme;
    candleSeries?: CandlestickSeriesPartialOptions;
    candleHeatmap?: CandleHeatmapPartialOptions;
    volumeSeries?: HistogramSeriesPartialOptions;
    volumeDeltaPivotSeries?: CandlestickSeriesPartialOptions;
    volumeDeltaPivotBaseline?: LineSeriesPartialOptions;
}
declare const ORDER_FLOW_THEME_PRESETS: {
    smoothLight: {
        id: string;
        label: string;
        mode: "light";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            ladder: {
                textMode?: FootprintTextMode | undefined;
                rowHeight?: number | undefined;
                priceStep?: number | undefined;
                showHeatmap?: boolean | undefined;
                bidAskFillMode?: FootprintBidAskFillMode | undefined;
                imbalanceRatio?: number | undefined;
                stackedImbalanceLength?: number | undefined;
                highlightImbalances?: boolean | undefined;
                highlightStackedImbalances?: boolean | undefined;
                highlightImbalanceText?: boolean | undefined;
                highlightDiagonalDominance?: boolean | undefined;
                diagonalDominanceFactor?: number | undefined;
                separatorMode?: FootprintBidAskSeparatorMode | undefined;
                separatorLabel?: string | undefined;
                separatorGap?: number | undefined;
                cellPadding?: number | undefined;
                borderWidth?: number | undefined;
                cellBorderWidth?: number | undefined;
                stackedImbalanceBorderWidth?: number | undefined;
                minOpacity?: number | undefined;
                maxOpacity?: number | undefined;
            };
            candle: {
                visible?: boolean | undefined;
                position?: FootprintCandlePosition | undefined;
                widthRatio?: number | undefined;
                minWidth?: number | undefined;
                maxWidth?: number | undefined;
                gap?: number | undefined;
                showWicks?: boolean | undefined;
            };
            style: {
                separatorColor: string;
                separatorFont: string;
                positiveImbalanceTextColor: string;
                positiveImbalanceTextFont: string;
                negativeImbalanceTextColor: string;
                negativeImbalanceTextFont: string;
                diagonalDominanceColor: string;
                diagonalDominanceFont: string;
                bidFillColor: string;
                askFillColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                bidTextColor?: string | undefined;
                askTextColor?: string | undefined;
                neutralTextColor?: string | undefined;
                positiveDeltaColor?: string | undefined;
                negativeDeltaColor?: string | undefined;
                bullishCandleColor?: string | undefined;
                bearishCandleColor?: string | undefined;
                candleWickColor?: string | undefined;
                candleBorderColor?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                ladderBorderColor?: string | undefined;
                cellBorderColor?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            shading: {
                positiveDeltaScale: {
                    range: {
                        from: number;
                        to: number;
                        clamp: true;
                        invert: false;
                    };
                    stops: {
                        offset: number;
                        color: string;
                    }[];
                };
                negativeDeltaScale: {
                    range: {
                        from: number;
                        to: number;
                        clamp: true;
                        invert: false;
                    };
                    stops: {
                        offset: number;
                        color: string;
                    }[];
                };
                neutralScale: {
                    range: {
                        from: number;
                        to: number;
                        clamp: true;
                        invert: false;
                    };
                    stops: {
                        offset: number;
                        color: string;
                    }[];
                };
            };
            pointOfControl: {
                borderWidth: number | undefined;
                backgroundColor: string;
                borderColor: string;
                visible: true;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            cellBorderColor: string;
            labelTextColor: string;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    midnightTerminal: {
        id: string;
        label: string;
        mode: "dark";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                bidTextColor: string;
                askTextColor: string;
                candleBorderColor: string;
                ladderBorderColor: string;
                cellBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                neutralTextColor?: string | undefined;
                positiveDeltaColor?: string | undefined;
                negativeDeltaColor?: string | undefined;
                bullishCandleColor?: string | undefined;
                bearishCandleColor?: string | undefined;
                candleWickColor?: string | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                bidFillColor?: string | undefined;
                askFillColor?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            pointOfControl: {
                borderWidth: number | undefined;
                borderColor: string;
                backgroundColor: string;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            labelTextColor: string;
            cellBorderColor: string;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    chartDarkPro: {
        id: string;
        label: string;
        mode: "dark";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: Partial<FootprintStyleOptions> | undefined;
            shading: FootprintShadingPartialOptions | undefined;
            pointOfControl: {
                borderWidth: number | undefined;
                borderColor: string;
                backgroundColor: string;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            labelTextColor: string | undefined;
            cellBorderColor: string | undefined;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotBaseline: {
            color: string;
            lineWidth: 1;
            lineStyle: 2;
            lastValueVisible: false;
            priceLineVisible: false;
            crosshairMarkerVisible: false;
        };
    };
    depthHeat: {
        id: string;
        label: string;
        mode: "dark";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                askFillColor: string;
                buyImbalanceColor: string;
                candleBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                bidTextColor?: string | undefined;
                askTextColor?: string | undefined;
                neutralTextColor?: string | undefined;
                positiveDeltaColor?: string | undefined;
                negativeDeltaColor?: string | undefined;
                bullishCandleColor?: string | undefined;
                bearishCandleColor?: string | undefined;
                candleWickColor?: string | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                bidFillColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                ladderBorderColor?: string | undefined;
                cellBorderColor?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            pointOfControl: {
                borderWidth: number | undefined;
                borderColor: string;
                backgroundColor: string;
            };
            shading: {
                askScale: {
                    stops: {
                        offset: number;
                        color: string;
                    }[];
                    range?: Partial<ColorScaleRangeOptions>;
                };
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            cellBorderColor: string;
            labelBackgroundColor: string;
            labelTextColor: string | undefined;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    cobaltWorkstation: {
        id: string;
        label: string;
        mode: "dark";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                askTextColor: string;
                candleBorderColor: string;
                ladderBorderColor: string;
                cellBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                bidTextColor?: string | undefined;
                neutralTextColor?: string | undefined;
                positiveDeltaColor?: string | undefined;
                negativeDeltaColor?: string | undefined;
                bullishCandleColor?: string | undefined;
                bearishCandleColor?: string | undefined;
                candleWickColor?: string | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                bidFillColor?: string | undefined;
                askFillColor?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            pointOfControl: {
                borderWidth: number | undefined;
                borderColor: string;
                backgroundColor: string;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            cellBorderColor: string;
            labelBackgroundColor: string;
            labelTextColor: string | undefined;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    obsidianMinimal: {
        id: string;
        label: string;
        mode: "dark";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                bidFillColor: string;
                askFillColor: string;
                candleBorderColor: string;
                ladderBorderColor: string;
                cellBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                bidTextColor?: string | undefined;
                askTextColor?: string | undefined;
                neutralTextColor?: string | undefined;
                positiveDeltaColor?: string | undefined;
                negativeDeltaColor?: string | undefined;
                bullishCandleColor?: string | undefined;
                bearishCandleColor?: string | undefined;
                candleWickColor?: string | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            pointOfControl: {
                borderWidth: number | undefined;
                borderColor: string;
                backgroundColor: string;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            cellBorderColor: string;
            labelTextColor: string | undefined;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    paperClassic: {
        id: string;
        label: string;
        mode: "light";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: Partial<FootprintStyleOptions> | undefined;
            pointOfControl: {
                borderColor: string;
                backgroundColor: string;
                visible: true;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            labelTextColor: string | undefined;
            cellBorderColor: string | undefined;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    clinicalHighContrast: {
        id: string;
        label: string;
        mode: "light";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                textColor: string;
                neutralTextColor: string;
                bidTextColor: string;
                askTextColor: string;
                positiveDeltaColor: string;
                negativeDeltaColor: string;
                bullishCandleColor: string;
                bearishCandleColor: string;
                candleWickColor: string;
                candleBorderColor: string;
                ladderBorderColor: string;
                cellBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                bidFillColor?: string | undefined;
                askFillColor?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            pointOfControl: {
                borderWidth: number;
                borderColor: string;
                backgroundColor: string;
                visible: true;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            labelTextColor: string;
            cellBorderColor: string;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    ivoryTerminal: {
        id: string;
        label: string;
        mode: "light";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                bidTextColor: string;
                askTextColor: string;
                positiveDeltaColor: string;
                negativeDeltaColor: string;
                bullishCandleColor: string;
                bearishCandleColor: string;
                candleBorderColor: string;
                ladderBorderColor: string;
                cellBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                neutralTextColor?: string | undefined;
                candleWickColor?: string | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                bidFillColor?: string | undefined;
                askFillColor?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            shading: {
                neutralScale: {
                    range: {
                        from: number;
                        to: number;
                        clamp: true;
                        invert: false;
                    };
                    stops: {
                        offset: number;
                        color: string;
                    }[];
                };
            };
            pointOfControl: {
                borderWidth: number;
                borderColor: string;
                backgroundColor: string;
                visible: true;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            labelTextColor: string;
            cellBorderColor: string;
            rowStyles: {
                delta: {
                    positiveFillColor: string;
                    negativeFillColor: string;
                    neutralFillColor: string;
                    textColor: string;
                };
                maxDelta: {
                    positiveFillColor: string;
                    negativeFillColor: string;
                    neutralFillColor: string;
                    textColor: string;
                };
                minDelta: {
                    positiveFillColor: string;
                    negativeFillColor: string;
                    neutralFillColor: string;
                    textColor: string;
                };
                cumulativeDelta: {
                    positiveFillColor: string;
                    negativeFillColor: string;
                    neutralFillColor: string;
                    textColor: string;
                };
                cumulativeDeltaToVolumeRatio: {
                    positiveFillColor: string;
                    negativeFillColor: string;
                    neutralFillColor: string;
                    textColor: string;
                };
                volume: {
                    positiveFillColor: string;
                    negativeFillColor: string;
                    neutralFillColor: string;
                    textColor: string;
                };
            };
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        candleHeatmap: CandleHeatmapPartialOptions;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
    frostUi: {
        id: string;
        label: string;
        mode: "light";
        description: string;
        surface: OrderFlowSurfaceTheme;
        footprint: {
            style: {
                bidTextColor: string;
                askTextColor: string;
                positiveDeltaColor: string;
                negativeDeltaColor: string;
                bullishCandleColor: string;
                bearishCandleColor: string;
                candleBorderColor: string;
                ladderBorderColor: string;
                cellBorderColor: string;
                fontFamily?: string | undefined;
                fontSize?: number | undefined;
                priceDecimalDigits?: number | undefined;
                priceRounding?: NumericRoundingMode | undefined;
                valueIntegerDigits?: number | undefined;
                valueDecimalDigits?: number | undefined;
                valueRounding?: NumericRoundingMode | undefined;
                valueUnitVisible?: boolean | undefined;
                textColor?: string | undefined;
                neutralTextColor?: string | undefined;
                candleWickColor?: string | undefined;
                separatorColor?: string | undefined;
                separatorFont?: string | undefined;
                bidFillColor?: string | undefined;
                askFillColor?: string | undefined;
                buyImbalanceColor?: string | undefined;
                sellImbalanceColor?: string | undefined;
                metricStyles?: Partial<Record<MetricStyleKey, MetricStylePaletteEntry>> | undefined;
                imbalanceMetricStyleKey?: MetricStyleKey | null | undefined;
                positiveImbalanceTextColor?: string | undefined;
                positiveImbalanceTextFont?: string | undefined;
                negativeImbalanceTextColor?: string | undefined;
                negativeImbalanceTextFont?: string | undefined;
                diagonalDominanceColor?: string | undefined;
                diagonalDominanceFont?: string | undefined;
                buyImbalanceFillColor?: string | undefined;
                sellImbalanceFillColor?: string | undefined;
                stackedBuyImbalanceFillColor?: string | undefined;
                stackedSellImbalanceFillColor?: string | undefined;
                stackedImbalanceOutline?: string | undefined;
                profileBidColor?: string | undefined;
                profileAskColor?: string | undefined;
                valueAreaColor?: string | undefined;
                sessionLabelColor?: string | undefined;
            };
            pointOfControl: {
                borderWidth: number;
                borderColor: string;
                backgroundColor: string;
                visible: true;
            };
            summary: {
                items: FootprintMetricItemPartialOptions[] | undefined;
            };
        };
        volumeFootprint: FootprintSeriesPartialOptions;
        volumeProfile: VolumeProfilePartialOptions;
        sessionVolumeProfile: SessionVolumeProfilePartialOptions;
        deltaSummary: {
            labelBackgroundColor: string;
            cellBorderColor: string;
            labelTextColor: string | undefined;
            rowStyles: Partial<Record<DeltaSummaryColumnKey, DeltaSummaryRowStylePartialOptions>> | undefined;
        };
        candleSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeSeries: lightweight_charts.DeepPartial<lightweight_charts.HistogramStyleOptions & lightweight_charts.SeriesOptionsCommon>;
        volumeDeltaPivotSeries: lightweight_charts.DeepPartial<lightweight_charts.CandlestickStyleOptions & lightweight_charts.SeriesOptionsCommon>;
    };
};

declare function normalizeBars(bars: OrderFlowBar[], options?: Pick<NormalizationOptions, 'sessions' | 'deriveSessions'>): OrderFlowBar[];
declare function normalizeOrderFlowBatch(batch: OrderFlowBatch, options?: NormalizationOptions): OrderFlowBatch;

declare function normalizeOrderFlowPatch(patch: OrderFlowPatch, options?: NormalizationOptions): OrderFlowPatch;

declare function applyOrderFlowPatch(currentBars: OrderFlowBar[], patch: OrderFlowPatch): OrderFlowBar[];

declare function resolveSessionId(bar: OrderFlowBar, sessions: SessionDefinition[]): string | undefined;
declare function resolveSessions(bars: OrderFlowBar[], sessions?: SessionDefinition[]): OrderFlowBar[];

declare function buildDeltaSummaryColumns(bars: OrderFlowBar[]): DeltaSummaryColumnModel[];

interface DerivedFootprintLevel {
    price: number;
    bidVolume: number;
    askVolume: number;
    totalVolume: number;
    delta: number;
    imbalanceSide: ImbalanceSide;
    isStackedImbalance: boolean;
}
interface DerivedFootprintMetrics {
    totalVolume: number;
    delta: number;
    maxLevelVolume: number;
    maxAbsDelta: number;
    levels: DerivedFootprintLevel[];
}
interface DeriveFootprintMetricOptions {
    imbalanceRatio: number;
    stackedImbalanceLength: number;
}
declare function deriveFootprintMetrics(bar: OrderFlowBar, options: DeriveFootprintMetricOptions): DerivedFootprintMetrics;

declare function buildFootprintBarModel(bar: OrderFlowBar, options: FootprintSeriesOptions): FootprintBarModel;

declare function buildProfile(bars: OrderFlowBar[], scopeId: string, valueAreaPercent?: number, label?: string): ProfileModel;

declare function buildVisibleRangeProfile(bars: OrderFlowBar[], from?: TimeValue, to?: TimeValue, valueAreaPercent?: number): {
    fromTime: lightweight_charts.Time | undefined;
    toTime: lightweight_charts.Time | undefined;
    scopeId: string;
    levels: ProfileLevel[];
    maxVolume: number;
    pointOfControl: number | null;
    valueArea: ProfileValueArea | null;
    label?: string;
};

declare function buildSessionProfiles(bars: OrderFlowBar[], valueAreaPercent?: number): ProfileModel[];

interface OhlcLike {
    open: number;
    high: number;
    low: number;
    close: number;
}
declare const MIN_MINTICK: number;
declare const MAX_MINTICK: number;
declare const DEFAULT_MINTICK_CANDIDATES: readonly [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1];
declare function normalizeMintick(mintick: number | null | undefined, sourceTickSize?: number): number | null;
declare function bucketPriceToMintick(value: number, mintick: number, sourceTickSize?: number): number;
declare function buildSupportedMinticks(sourceTickSize: number, candidates?: readonly number[]): number[];
declare function clusterPriceLevelsByMintick(levels: PriceLevelVolume[], mintick: number, sourceTickSize?: number): PriceLevelVolume[];
declare function clusterOhlcBarByMintick<T extends OhlcLike>(bar: T, mintick: number, sourceTickSize?: number): T;
declare function clusterOhlcBarsByMintick<T extends OhlcLike>(bars: readonly T[], mintick: number, sourceTickSize?: number): T[];
declare function clusterOrderFlowBarByMintick(bar: OrderFlowBar, mintick: number, sourceTickSize?: number): OrderFlowBar;
declare function clusterOrderFlowBarsByMintick(bars: readonly OrderFlowBar[], mintick: number, sourceTickSize?: number): OrderFlowBar[];

interface CandleHeatmapBarLike extends OhlcLike {
    time: TimeValue;
}
type CandleHeatmapSide = 'min' | 'max';
interface CandleHeatmapColorResolution {
    color: string;
    side: CandleHeatmapSide;
    intensity: number;
}
interface ResolveCandleHeatmapColorInput {
    value: number | null | undefined;
    options?: CandleHeatmapPartialOptions;
    backgroundColor?: string;
}
interface BuildCandleHeatmapSeriesDataInput<TBar extends CandleHeatmapBarLike> {
    bars: readonly TBar[];
    options?: CandleHeatmapPartialOptions;
    backgroundColor?: string;
    getValue: (bar: TBar, index: number, bars: readonly TBar[]) => number | null | undefined;
}
declare function resolveCandleHeatmapColor(input: ResolveCandleHeatmapColorInput): CandleHeatmapColorResolution | null;
declare function buildCandleHeatmapSeriesData<TBar extends CandleHeatmapBarLike>(input: BuildCandleHeatmapSeriesDataInput<TBar>): CandlestickData<TimeValue>[];

interface VolumeDeltaSourceBar {
    time: TimeValue;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    delta?: number;
}
interface VolumeDeltaPivotPoint extends CandlestickData<TimeValue> {
    delta: number;
}
interface BuildVolumeDeltaPivotSeriesDataOptions {
    intervalSeconds?: number;
}
declare function buildVolumeDeltaPivotSeriesData(chartBars: VolumeDeltaSourceBar[], lowerTimeframeBars: VolumeDeltaSourceBar[], options?: BuildVolumeDeltaPivotSeriesDataOptions): VolumeDeltaPivotPoint[];

declare function computeVwapSeriesData(bars: OrderFlowBar[], options?: Partial<VwapOptions>): VwapPoint[];

declare function createDeltaSummarySeries(options?: DeltaSummarySeriesPartialOptions): ICustomSeriesPaneView<TimeValue, OrderFlowBar, DeltaSummarySeriesOptions>;

declare function createFootprintSeries(options?: FootprintSeriesPartialOptions): ICustomSeriesPaneView<TimeValue, OrderFlowBar, FootprintSeriesOptions>;

declare function createVolumeFootprintSeries(options?: VolumeFootprintPartialOptions): ICustomSeriesPaneView<TimeValue, OrderFlowBar, VolumeFootprintOptions>;

interface SeriesMetricPrimitiveItem {
    id: string;
    text: string;
    placement?: 'above' | 'below';
    offset?: number;
    orientation?: 'horizontal' | 'vertical';
    style: MetricStyleToken;
}
interface SeriesMetricPrimitiveDatum {
    time: TimeValue;
    anchorPrice: number;
    items: SeriesMetricPrimitiveItem[];
}
interface SeriesMetricPrimitiveConfig {
    data: SeriesMetricPrimitiveDatum[];
}
declare class SeriesMetricPrimitive implements ISeriesPrimitive<TimeValue> {
    private readonly paneView;
    private readonly renderer;
    private attachedParam?;
    private data;
    constructor(config: SeriesMetricPrimitiveConfig);
    attached(param: SeriesAttachedParameter<TimeValue, 'Candlestick'>): void;
    detached(): void;
    paneViews(): readonly IPrimitivePaneView[];
    updateAllViews(): void;
    setData(data: SeriesMetricPrimitiveDatum[]): void;
}
declare function createSeriesMetricPrimitive(config: SeriesMetricPrimitiveConfig): SeriesMetricPrimitive;

interface CreateOrderFlowTickStreamControllerConfig {
    instrument: InstrumentContext;
    intervalSeconds: number;
    sessions?: SessionDefinition[];
    deriveSessions?: boolean;
}
interface OrderFlowTickStreamResult {
    bars: OrderFlowBar[];
    patches: OrderFlowPatch[];
    streamActive: boolean;
}
interface OrderFlowTickStreamController {
    push(update: OrderFlowTickStreamUpdate): OrderFlowTickStreamResult;
    getBars(): OrderFlowBar[];
    reset(): void;
}
interface BuildOrderFlowBarsFromTicksInput extends CreateOrderFlowTickStreamControllerConfig {
    trades?: TradeTick[];
    quotes?: QuoteTick[];
}
declare function createOrderFlowTickStreamController(config: CreateOrderFlowTickStreamControllerConfig): OrderFlowTickStreamController;
declare function buildOrderFlowBarsFromTicks(input: BuildOrderFlowBarsFromTicksInput): OrderFlowBar[];

declare function withAlpha(color: string, alpha: number): string;
declare function createAlphaColorScale(color: string, minAlpha: number, maxAlpha: number, range?: Partial<ColorScaleRangeOptions>): ColorScaleOptions;
declare function resolveColorScale(scale: ColorScaleOptions, value: number): string;

interface NumericRange {
    from: number;
    to: number;
}
interface ChartViewPaneStateSnapshot {
    paneIndex: number;
    priceScaleId: string;
    priceRange: NumericRange | null;
}
interface ChartViewStateSnapshot {
    version: 1;
    timeRange: NumericRange | null;
    panes: ChartViewPaneStateSnapshot[];
}
interface CaptureChartViewStateOptions {
    paneIndices?: number[];
    priceScaleId?: string;
}
declare function isChartViewStateSnapshot(value: unknown): value is ChartViewStateSnapshot;
declare function captureChartViewState(chart: IChartApi, options?: CaptureChartViewStateOptions): ChartViewStateSnapshot;
declare function restoreChartViewState(chart: IChartApi, snapshot: ChartViewStateSnapshot | null | undefined): void;

interface AutoFitPriceScaleOptions {
    paneIndex?: number;
    priceScaleId?: string;
    topInsetRatio?: number;
    bottomInsetRatio?: number;
}
interface AutoFitPriceScaleResult {
    enabled: boolean;
    paneIndex: number;
    priceScaleId: string;
    topInsetRatio: number;
    bottomInsetRatio: number;
}
declare function setPriceScaleAutoFit(chart: IChartApi, enabled: boolean, options?: AutoFitPriceScaleOptions): AutoFitPriceScaleResult;

declare function buildAggregatedMarketBarFromOrderFlowBar(bar: OrderFlowBar): AggregatedMarketBar;
declare function buildAggregatedMarketBarsFromOrderFlowBars(bars: readonly OrderFlowBar[]): AggregatedMarketBar[];
declare function aggregateMarketBarsByInterval(bars: readonly AggregatedMarketBar[], intervalSeconds: number): AggregatedMarketBar[];
declare function aggregateOrderFlowBarsByInterval(bars: readonly OrderFlowBar[], intervalSeconds: number): OrderFlowBar[];

interface PriceLike {
    price: number;
}
declare function inferPricePrecision(step: number): number;
declare function roundToPriceStep(value: number, step: number, precision?: number): number;
declare function inferPriceStep(levels: PriceLike[]): number | null;
declare function buildPriceGrid(low: number, high: number, step: number, precision?: number): number[];

declare const METRIC_STYLE_KEYS: MetricStyleKey[];
declare function resolveMetricStyleVariant(rawValue: number | null, mode?: MetricStyleVariantMode): MetricStyleVariant;
declare function resolveMetricStyleToken(palette: MetricStylePalette, key: MetricStyleKey, variant?: MetricStyleVariant): MetricStyleToken;
declare function parseMetricBorderShorthand(border?: string): {
    color: string | null;
    width: number;
};

export { AggregatedMarketBar, type AutoFitPriceScaleOptions, type AutoFitPriceScaleResult, type BuildCandleHeatmapSeriesDataInput, type BuildOrderFlowBarsFromTicksInput, type BuildVolumeDeltaPivotSeriesDataOptions, CLASSIC_REFERENCE_DELTA_SUMMARY_OPTIONS, CLASSIC_REFERENCE_FOOTPRINT_OPTIONS, CORN_REFERENCE_FOOTPRINT_OPTIONS, type CandleHeatmapBarLike, type CandleHeatmapColorResolution, CandleHeatmapPartialOptions, type CandleHeatmapSide, type CaptureChartViewStateOptions, type ChartViewPaneStateSnapshot, type ChartViewStateSnapshot, ColorScaleOptions, ColorScaleRangeOptions, type CreateOrderFlowTickStreamControllerConfig, DARK_REFERENCE_DELTA_SUMMARY_OPTIONS, DARK_REFERENCE_FOOTPRINT_BASE_OPTIONS, DEFAULT_MINTICK_CANDIDATES, DeltaSummaryColumnKey, DeltaSummaryColumnModel, DeltaSummarySeriesOptions, DeltaSummarySeriesPartialOptions, FootprintBarModel, FootprintCandlePosition, FootprintMetricItemPartialOptions, FootprintSeriesOptions, FootprintSeriesPartialOptions, FootprintShadingPartialOptions, FootprintStyleOptions, InstrumentContext, LEFT_ALIGNED_REFERENCE_VOLUME_PROFILE_OPTIONS, MAX_MINTICK, METRIC_STYLE_KEYS, MIN_MINTICK, MetricStyleKey, MetricStylePalette, MetricStylePaletteEntry, MetricStyleToken, MetricStyleVariant, MetricStyleVariantMode, NormalizationOptions, type NumericRange, NumericRoundingMode, ORDER_FLOW_DELTA_FOOTPRINT_OPTIONS, ORDER_FLOW_REFERENCE_FOOTPRINT_OPTIONS, ORDER_FLOW_STYLE_PRESETS, ORDER_FLOW_THEME_PRESETS, type OhlcLike, OrderFlowBar, OrderFlowBatch, OrderFlowPatch, type OrderFlowStylePresetPack, type OrderFlowSurfaceTheme, type OrderFlowThemePresetPack, type OrderFlowTickStreamController, type OrderFlowTickStreamResult, OrderFlowTickStreamUpdate, PriceLevelVolume, ProfileLevel, ProfileModel, QuoteTick, type ResolveCandleHeatmapColorInput, SHADED_REFERENCE_DELTA_SUMMARY_OPTIONS, SHADED_REFERENCE_FOOTPRINT_OPTIONS, SHADED_REFERENCE_VOLUME_PROFILE_OPTIONS, SeriesMetricPrimitive, type SeriesMetricPrimitiveDatum, type SeriesMetricPrimitiveItem, SessionDefinition, SessionVolumeProfilePartialOptions, TimeValue, TradeTick, VOLUME_FOOTPRINT_REFERENCE_OPTIONS, type VolumeDeltaPivotPoint, type VolumeDeltaSourceBar, VolumeFootprintOptions, VolumeFootprintPartialOptions, VolumeProfilePartialOptions, VwapOptions, VwapPoint, aggregateMarketBarsByInterval, aggregateOrderFlowBarsByInterval, applyOrderFlowPatch, bucketPriceToMintick, buildAggregatedMarketBarFromOrderFlowBar, buildAggregatedMarketBarsFromOrderFlowBars, buildCandleHeatmapSeriesData, buildDeltaSummaryColumns, buildFootprintBarModel, buildOrderFlowBarsFromTicks, buildPriceGrid, buildProfile, buildSessionProfiles, buildSupportedMinticks, buildVisibleRangeProfile, buildVolumeDeltaPivotSeriesData, captureChartViewState, clusterOhlcBarByMintick, clusterOhlcBarsByMintick, clusterOrderFlowBarByMintick, clusterOrderFlowBarsByMintick, clusterPriceLevelsByMintick, computeVwapSeriesData, createAlphaColorScale, createDeltaSummarySeries, createFootprintSeries, createOrderFlowTickStreamController, createSeriesMetricPrimitive, createVolumeFootprintSeries, deriveFootprintMetrics, inferPricePrecision, inferPriceStep, isChartViewStateSnapshot, normalizeBars, normalizeMintick, normalizeOrderFlowBatch, normalizeOrderFlowPatch, parseMetricBorderShorthand, resolveCandleHeatmapColor, resolveColorScale, resolveMetricStyleToken, resolveMetricStyleVariant, resolveSessionId, resolveSessions, restoreChartViewState, roundToPriceStep, setPriceScaleAutoFit, withAlpha };
