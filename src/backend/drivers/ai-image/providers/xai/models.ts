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

// Costs are in usd-cents (1 = $0.01). xAI's "Grok Imagine" image API bills a
// per-image output rate by resolution tier (1k/2k) plus, for edits, a
// per-input-image "media input" rate. Rates per the xAI Imagine pricing table:
// https://docs.x.ai/developers/pricing
//   grok-imagine-image          media $0.002  | 1k $0.02 | 2k $0.02
//   grok-imagine-image-quality  media $0.01   | 1k $0.05 | 2k $0.07
//   grok-imagine-image-2.0      media $0.01   | low 1k $0.04, 2k $0.06 | medium 1k $0.06, 2k $0.08
// The pricing page only prints a flat $0.04 for 2.0 while the models listing
// reports $0.06; the release notes say images bill at the quality served, so
// the 2.0 tiers above are the best public reading, not a vendor table.
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
        puterId: 'x-ai:x-ai/grok-imagine-image-quality',
        id: 'grok-imagine-image-quality',
        aliases: [
            'x-ai/grok-imagine-image-quality',
            'grok-imagine-image-quality-20260403',
            'grok-imagine-image-quality-latest',
            'grok-imagine-image-pro',
        ],
        name: 'Grok Imagine Image (Quality)',
        version: '1.0',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-image',
        index_cost_key: 'output:1k',
        costs: {
            'output:1k': 5, // $0.05 per image
            'output:2k': 7, // $0.07 per image
            media_input: 1, // $0.01 per input image (edits)
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
