/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
    puter_output_path?: string;
    [key: string]: unknown;
}

export interface IImageProvider {
    generate(params: IGenerateParams): Promise<string>;
    models(): Promise<IImageModel[]> | IImageModel[];
    getDefaultModel(): string;
}
