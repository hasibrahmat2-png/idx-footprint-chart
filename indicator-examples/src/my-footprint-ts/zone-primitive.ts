import {
    ISeriesPrimitive,
    SeriesAttachedParameter,
    SeriesType,
    Time,
    IPrimitivePaneView,
    IPrimitivePaneRenderer,
    PrimitivePaneViewZOrder,
    ISeriesApi,
} from 'lightweight-charts';
import { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface SupplyDemandZone {
    centerPrice: number;
    topPrice: number;
    bottomPrice: number;
    type: 'supply' | 'demand';
    label?: string;
    clusterPrices?: number[];
}

class SupplyDemandPaneRenderer implements IPrimitivePaneRenderer {
    private _zones: SupplyDemandZone[] = [];
    private _series: ISeriesApi<SeriesType> | null = null;

    constructor(zones: SupplyDemandZone[], series: ISeriesApi<SeriesType> | null) {
        this._zones = zones;
        this._series = series;
    }

    public update(zones: SupplyDemandZone[], series: ISeriesApi<SeriesType> | null): void {
        this._zones = zones;
        this._series = series;
    }

    public draw(target: CanvasRenderingTarget2D): void {
        if (!this._series || this._zones.length === 0) return;

        target.useMediaCoordinateSpace((scope) => {
            const { context: ctx, mediaSize } = scope;
            const width = mediaSize.width;

            for (const zone of this._zones) {
                const yTopCoord = this._series!.priceToCoordinate(zone.topPrice);
                const yBotCoord = this._series!.priceToCoordinate(zone.bottomPrice);
                const yCenterCoord = this._series!.priceToCoordinate(zone.centerPrice);

                if (yTopCoord === null && yBotCoord === null) continue;

                const y1 = yTopCoord !== null ? yTopCoord : (yBotCoord !== null && zone.topPrice > zone.bottomPrice ? 0 : mediaSize.height);
                const y2 = yBotCoord !== null ? yBotCoord : (yTopCoord !== null && zone.bottomPrice < zone.topPrice ? mediaSize.height : 0);

                const minY = Math.min(y1, y2);
                const maxY = Math.max(y1, y2);
                const height = Math.max(2, maxY - minY);

                const isSupply = zone.type === 'supply';
                const fillColor = isSupply ? 'rgba(239, 83, 80, 0.16)' : 'rgba(76, 175, 80, 0.16)';
                const borderColor = isSupply ? 'rgba(239, 83, 80, 0.55)' : 'rgba(76, 175, 80, 0.55)';
                const textColor = isSupply ? '#EF5350' : '#4CAF50';

                // 1. Shaded zone background
                ctx.fillStyle = fillColor;
                ctx.fillRect(0, minY, width, height);

                // 2. Dashed top & bottom boundary lines
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(0, minY);
                ctx.lineTo(width, minY);
                ctx.moveTo(0, maxY);
                ctx.lineTo(width, maxY);
                ctx.stroke();

                // 3. Faint center line
                if (yCenterCoord !== null && yCenterCoord >= minY && yCenterCoord <= maxY) {
                    ctx.strokeStyle = isSupply ? 'rgba(239, 83, 80, 0.3)' : 'rgba(76, 175, 80, 0.3)';
                    ctx.setLineDash([2, 3]);
                    ctx.beginPath();
                    ctx.moveTo(0, yCenterCoord);
                    ctx.lineTo(width, yCenterCoord);
                    ctx.stroke();
                }

                ctx.setLineDash([]); // Reset line dash

                // 4. Clean badge positioned on the LEFT of the chart pane (TradingView style)
                // This completely eliminates collisions with price line labels, crosshairs, and right price axis badges!
                const labelText = zone.label || (isSupply ? `Supply Zone (${zone.centerPrice})` : `Demand Zone (${zone.centerPrice})`);
                ctx.font = 'bold 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const badgeX = 20; // Left-aligned

                // Clean transparent label without background or border
                ctx.fillStyle = textColor;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(labelText, badgeX, (minY + maxY) / 2);
            }
        });
    }
}

class SupplyDemandPaneView implements IPrimitivePaneView {
    private _renderer: SupplyDemandPaneRenderer;

    constructor(zones: SupplyDemandZone[], series: ISeriesApi<SeriesType> | null) {
        this._renderer = new SupplyDemandPaneRenderer(zones, series);
    }

    public update(zones: SupplyDemandZone[], series: ISeriesApi<SeriesType> | null): void {
        this._renderer.update(zones, series);
    }

    public zOrder(): PrimitivePaneViewZOrder {
        return 'bottom';
    }

    public renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }
}

export class SupplyDemandZonePrimitive implements ISeriesPrimitive<Time> {
    private _paneView: SupplyDemandPaneView;
    private _series: ISeriesApi<SeriesType> | null = null;
    private _requestUpdate: (() => void) | null = null;
    private _zones: SupplyDemandZone[] = [];

    constructor() {
        this._paneView = new SupplyDemandPaneView([], null);
    }

    public attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
        this._series = param.series;
        this._requestUpdate = param.requestUpdate;
        this._paneView.update(this._zones, this._series);
        if (this._requestUpdate) this._requestUpdate();
    }

    public detached(): void {
        this._series = null;
        this._requestUpdate = null;
        this._paneView.update([], null);
    }

    public updateAllViews(): void {
        this._paneView.update(this._zones, this._series);
    }

    public paneViews(): readonly IPrimitivePaneView[] {
        return [this._paneView];
    }

    public setZones(zones: SupplyDemandZone[]): void {
        this._zones = zones;
        this._paneView.update(this._zones, this._series);
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }

    public clearZones(): void {
        this._zones = [];
        this._paneView.update([], this._series);
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }
}
