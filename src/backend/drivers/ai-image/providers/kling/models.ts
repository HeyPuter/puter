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

import type { IImageModel } from '../../types.js';

export type KlingImageModel = IImageModel & {
    /** `generations` takes one reference image; `omni-image` takes several. */
    endpoint: 'generations' | 'omni-image';
    maxInputImages: number;
    /** Whether `aspect_ratio: 'auto'` may be sent with input images. */
    autoRatio: boolean;
};

const RATIOS = [
    { w: 16, h: 9 },
    { w: 9, h: 16 },
    { w: 1, h: 1 },
    { w: 4, h: 3 },
    { w: 3, h: 4 },
    { w: 3, h: 2 },
    { w: 2, h: 3 },
    { w: 21, h: 9 },
];

// usd-cents per image from https://kling.ai/document-api/pricing/base/image
// (1 unit = $0.0035). Cost keys are the output resolution tier; Image 2.1
// prices text-to-image and image-to-image apart. Capabilities per
// https://kling.ai/document-api/guides/capability-map/image.
export const KLING_IMAGE_GENERATION_MODELS: KlingImageModel[] = [
    {
        id: 'kling-v3',
        puterId: 'kling:kling/kling-v3',
        aliases: ['kling/kling-v3', 'kling-image-3.0'],
        name: 'Kling Image 3.0',
        version: '3.0',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-tier',
        index_cost_key: '1k',
        costs: { '1k': 2.8, '2k': 2.8 },
        allowedQualityLevels: ['1k', '2k'],
        allowedRatios: RATIOS,
        endpoint: 'generations',
        maxInputImages: 1,
        autoRatio: false,
    },
    {
        id: 'kling-v3-omni',
        puterId: 'kling:kling/kling-v3-omni',
        aliases: ['kling/kling-v3-omni', 'kling-image-3.0-omni'],
        name: 'Kling Image 3.0 Omni',
        version: '3.0',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-tier',
        index_cost_key: '1k',
        costs: { '1k': 2.8, '2k': 2.8, '4k': 5.6 },
        allowedQualityLevels: ['1k', '2k', '4k'],
        allowedRatios: RATIOS,
        endpoint: 'omni-image',
        maxInputImages: 10,
        autoRatio: true,
    },
    {
        id: 'kling-image-o1',
        puterId: 'kling:kling/kling-image-o1',
        aliases: ['kling/kling-image-o1'],
        name: 'Kling Image O1',
        version: 'o1',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-tier',
        index_cost_key: '1k',
        costs: { '1k': 2.8, '2k': 2.8 },
        allowedQualityLevels: ['1k', '2k'],
        allowedRatios: RATIOS,
        endpoint: 'omni-image',
        maxInputImages: 10,
        autoRatio: true,
    },
    {
        id: 'kling-v2-1',
        puterId: 'kling:kling/kling-v2-1',
        aliases: ['kling/kling-v2-1', 'kling-image-2.1'],
        name: 'Kling Image 2.1',
        version: '2.1',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-tier',
        index_cost_key: '1k',
        costs: {
            '1k': 1.4,
            '2k': 1.4,
            '1k:image-to-image': 2.8,
            '2k:image-to-image': 2.8,
        },
        allowedQualityLevels: ['1k', '2k'],
        allowedRatios: RATIOS,
        endpoint: 'generations',
        maxInputImages: 1,
        autoRatio: false,
    },
];
