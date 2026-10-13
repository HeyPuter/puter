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

export type XaiImageModel = IImageModel & {
    defaultQuality?: string;
    defaultEditQuality?: string;
};

// Costs are in usd-cents (1 = $0.01): a per-image output rate by resolution
// (and, for 2.0, quality) plus a per-input-image `media_input` rate on edits.
// Rates per https://docs.x.ai/developers/pricing. The 2.0 output tiers are
// refreshed from the `pricing` matrix of GET /v1/image-generation-models (see
// catalog.ts); every other rate here is curated, since the endpoint lists no
// media-input price and its `image_price` unit is ambiguous.
export const XAI_IMAGE_GENERATION_MODELS: XaiImageModel[] = [
    {
        puterId: 'x-ai:x-ai/grok-imagine-image',
        id: 'grok-imagine-image',
        aliases: [
            'grok-image',
            'x-ai/grok-image',
            'x-ai/grok-imagine-image',
            'grok-imagine-image-2026-03-02',
        ],
        name: 'Grok Imagine Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-image',
        index_cost_key: 'output:1k',
        costs: {
            'output:1k': 2, // $0.02 per image
            'output:2k': 2, // $0.02 per image
            media_input: 0.2, // $0.002 per input image (edits)
        },
        allowedQualityLevels: ['1k', '2k'],
    },
    {
        puterId: 'x-ai:x-ai/grok-imagine-image-2.0',
        id: 'grok-imagine-image-2.0',
        aliases: ['x-ai/grok-imagine-image-2.0'],
        name: 'Grok Imagine Image 2.0',
        version: '2.0',
        defaultQuality: 'low',
        defaultEditQuality: 'medium',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-image',
        index_cost_key: 'output:1k:low',
        costs: {
            'output:1k:low': 4,
            'output:2k:low': 6,
            'output:1k:medium': 6,
            'output:2k:medium': 8,
            media_input: 1,
        },
        allowedQualityLevels: ['low', 'medium', 'auto'],
    },
];
