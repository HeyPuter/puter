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

import { IImageModel } from '../../types.js';

export type ReplicateBillingScheme = 'per-image' | 'megapixel';

export type ReplicateImageModel = IImageModel & {
    replicateId: string;
    billingScheme: ReplicateBillingScheme;
    imageInputKey?: string;
    singleImageInputKey?: string;
    supportsGoFast?: boolean;
    goFastDefault?: boolean;
    costs_go_fast?: Record<string, number>;
    resolutionInputKey?: string;
    resolutionSuffix?: string;
};

// Costs are in USD cents.
// Megapixel models: `output_mp` = cost per output megapixel, `input_mp` =
// cost per input megapixel (img2img). Some also carry a flat `run` cost.
// Per-image models: `output` = flat cost per generated image.
export const REPLICATE_IMAGE_GENERATION_MODELS: ReplicateImageModel[] = [
    // Black Forest Labs FLUX.2
    {
        id: 'black-forest-labs/flux-2-pro',
        replicateId: 'black-forest-labs/flux-2-pro',
        puterId: 'replicate:black-forest-labs/flux-2-pro',
        aliases: ['flux-2-pro'],
        name: 'FLUX.2 Pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: { run: 1.5, input_mp: 1.5, output_mp: 1.5 },
        billingScheme: 'megapixel',
        imageInputKey: 'input_images',
        resolutionInputKey: 'resolution',
        resolutionSuffix: ' MP',
    },
    {
        id: 'black-forest-labs/flux-2-dev',
        replicateId: 'black-forest-labs/flux-2-dev',
        puterId: 'replicate:black-forest-labs/flux-2-dev',
        aliases: ['flux-2-dev'],
        name: 'FLUX.2 Dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: { input_mp: 1.4, output_mp: 1.4 },
        costs_go_fast: { input_mp: 1.2, output_mp: 1.2 },
        billingScheme: 'megapixel',
        imageInputKey: 'input_images',
        supportsGoFast: true,
        goFastDefault: true,
        resolutionInputKey: 'output_megapixels',
    },
    {
        id: 'black-forest-labs/flux-2-klein-9b-base',
        replicateId: 'black-forest-labs/flux-2-klein-9b-base',
        puterId: 'replicate:black-forest-labs/flux-2-klein-9b-base',
        aliases: ['flux-2-klein-9b-base', 'flux-2-klein-9b'],
        name: 'FLUX.2 Klein 9B',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: { input_mp: 1.1, output_mp: 1.1 },
        billingScheme: 'megapixel',
        imageInputKey: 'images',
        resolutionInputKey: 'output_megapixels',
    },
    {
        id: 'black-forest-labs/flux-2-klein-4b',
        replicateId: 'black-forest-labs/flux-2-klein-4b',
        puterId: 'replicate:black-forest-labs/flux-2-klein-4b',
        aliases: ['flux-2-klein-4b'],
        name: 'FLUX.2 Klein 4B',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: { input_mp: 0.1, output_mp: 0.1 },
        billingScheme: 'megapixel',
        imageInputKey: 'images',
        resolutionInputKey: 'output_megapixels',
    },

    // Black Forest Labs FLUX.1
    {
        id: 'black-forest-labs/flux-schnell',
        replicateId: 'black-forest-labs/flux-schnell',
        puterId: 'replicate:black-forest-labs/flux-schnell',
        aliases: ['flux-schnell', 'flux-1-schnell'],
        name: 'FLUX.1 Schnell',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: { output: 0.3 },
        billingScheme: 'per-image',
    },
    {
        id: 'black-forest-labs/flux-1.1-pro',
        replicateId: 'black-forest-labs/flux-1.1-pro',
        puterId: 'replicate:black-forest-labs/flux-1.1-pro',
        aliases: ['flux-1.1-pro'],
        name: 'FLUX 1.1 Pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: { output: 4 },
        billingScheme: 'per-image',
        singleImageInputKey: 'image_prompt',
    },

    // Leonardo AI
    {
        id: 'leonardoai/lucid-origin',
        replicateId: 'leonardoai/lucid-origin',
        puterId: 'replicate:leonardoai/lucid-origin',
        aliases: ['lucid-origin', 'leonardo/lucid-origin'],
        name: 'Lucid Origin',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: { output: 1.65 },
        billingScheme: 'per-image',
    },
    {
        id: 'leonardoai/phoenix-1.0',
        replicateId: 'leonardoai/phoenix-1.0',
        puterId: 'replicate:leonardoai/phoenix-1.0',
        aliases: ['phoenix-1.0', 'leonardo/phoenix-1.0'],
        name: 'Phoenix 1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: { output: 3.75 },
        billingScheme: 'per-image',
    },
];
