/**
 * Types for the `puter-image-generation` driver interface.
 */

export type ImagePricingUnit = 'per-image' | 'per-MP' | 'per-tier';

export interface IImageModel {
    id: string;
    name: string;
    puterId?: string;
    provider?: string;
    aliases?: string[];
    description?: string;
    version?: string;
    costs_currency: string;
    index_cost_key?: string;
    index_input_cost_key?: string;
    costs: Record<string, number>;
    /**
     * How `costs` should be interpreted:
     * - 'per-image': flat cost per generated image (key: 'per-image')
     * - 'per-MP':    cost scales with width*height/1e6 (key: '1MP')
     * - 'per-tier':  cost is picked by `quality` (keys: e.g. '1K','2K','4K')
     * Defaults to 'per-MP' when unset (legacy behavior).
     */
    pricing_unit?: ImagePricingUnit;
    /**
     * For per-tier models: resolves an abstract aspect ratio (keyed `{w}:{h}`)
     * + quality tier (e.g. '1K'/'2K'/'4K') to concrete pixel dimensions sent
     * to the provider. Only consulted when `pricing_unit === 'per-tier'`.
     */
    resolution_map?: Record<string, Record<string, { w: number; h: number }>>;
    allowedQualityLevels?: string[];
    allowedRatios?: { w: number; h: number }[];
}

export interface IGenerateParams {
    prompt: string;
    ratio?: { w: number; h: number };
    model?: string;
    provider?: string;
    test_mode?: boolean;
    quality?: string;
    input_image?: string;
    input_image_mime_type?: string;
    input_images?: string[];
}

export interface IImageProvider {
    generate (params: IGenerateParams): Promise<string>;
    models (): Promise<IImageModel[]> | IImageModel[];
    getDefaultModel (): string;
}
