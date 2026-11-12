/*
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

/** Types for the `puter-image-generation` driver interface. */

export type ImagePricingUnit = 'per-image' | 'per-MP' | 'per-tier';

export interface ImageDimensions {
    w: number;
    h: number;
}

export type ImageSize = ImageDimensions & { kind: 'aspect' | 'pixels' };

export interface IImageModel {
    /** Excludes this provider route from discovery and generation. */
    excludedForDataPolicy?: 'training' | 'thirdPartySharing';
    /** Legacy dimension pairs below this pixel count are aspect hints. */
    pixelSizeThreshold?: number;
    /**
     * Routable by id but hidden from discovery, e.g. deprecated upstream but
     * not yet shut down.
     */
    delisted?: boolean;
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
     *
     * - 'per-image': flat cost per generated image (key: 'per-image')
     * - 'per-MP': cost scales with width*height/1e6 (key: '1MP')
     * - 'per-tier': cost is picked by `quality` (keys: e.g. '1K','2K','4K')
     *   Defaults to 'per-MP' when unset (legacy behavior).
     */
    pricing_unit?: ImagePricingUnit;
    /** Maps aspect ratios and quality tiers to concrete output dimensions. */
    resolution_map?: Record<string, Record<string, { w: number; h: number }>>;
    allowedQualityLevels?: string[];
    allowedRatios?: { w: number; h: number }[];
}

export interface IGenerateParams {
    prompt: string;
    ratio?: ImageDimensions;
    /** Parsed by the driver; never taken from caller input. */
    imageSize?: ImageSize;
    model?: string;
    provider?: string;
    test_mode?: boolean;
    quality?: string;
    resolution?: string;
    input_image?: string;
    input_image_mime_type?: string;
    input_images?: string[];
    puter_output_path?: string;
    [key: string]: unknown;
}

export interface IImageProvider {
    /** Retired IDs and aliases that must not silently route to another provider. */
    retiredModelAliases?: readonly string[];
    /** Optional per-alias explanation surfaced in the rejection message. */
    retiredModelReasons?: Readonly<Record<string, string>>;
    generate(params: IGenerateParams): Promise<string>;
    models(): Promise<IImageModel[]> | IImageModel[];
    getDefaultModel(): string;
}
