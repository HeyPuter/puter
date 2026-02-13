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

import { IImageModel } from '../types';

export type CloudflareBillingScheme =
    | 'tile-plus-step'
    | 'step-only'
    | 'flux2-dev-tile-step'
    | 'flux2-klein-4b-tile'
    | 'flux2-klein-9b-mp';

export type CloudflareImageModel = IImageModel & {
    billingScheme: CloudflareBillingScheme;
    defaultSteps?: number;
    requiresMultipart?: boolean;
};

// Source: Cloudflare Workers AI docs and model pages.
// Pricing values are in USD microcents for billing units.
export const CLOUDFLARE_IMAGE_GENERATION_MODELS: CloudflareImageModel[] = [
    {
        puterId: 'workers-ai:black-forest-labs/flux-1-schnell',
        id: '@cf/black-forest-labs/flux-1-schnell',
        aliases: ['black-forest-labs/flux-1-schnell'],
        name: 'FLUX.1 Schnell',
        costs_currency: 'usd-microcents',
        index_cost_key: 'step',
        costs: {
            tile_512: 5280,
            step: 10560,
        },
        billingScheme: 'tile-plus-step',
        defaultSteps: 4,
    },
    {
        puterId: 'workers-ai:leonardo/lucid-origin',
        id: '@cf/leonardo/lucid-origin',
        aliases: ['leonardo/lucid-origin'],
        name: 'Lucid Origin',
        costs_currency: 'usd-microcents',
        index_cost_key: 'step',
        costs: {
            tile_512: 699600,
            step: 13200,
        },
        billingScheme: 'tile-plus-step',
        defaultSteps: 25,
    },
    {
        puterId: 'workers-ai:leonardo/phoenix-1.0',
        id: '@cf/leonardo/phoenix-1.0',
        aliases: ['leonardo/phoenix-1.0'],
        name: 'Phoenix 1.0',
        costs_currency: 'usd-microcents',
        index_cost_key: 'step',
        costs: {
            tile_512: 583000,
            step: 11000,
        },
        billingScheme: 'tile-plus-step',
        defaultSteps: 25,
    },
    {
        puterId: 'workers-ai:black-forest-labs/flux-2-dev',
        id: '@cf/black-forest-labs/flux-2-dev',
        aliases: ['black-forest-labs/flux-2-dev'],
        name: 'FLUX.2 Dev',
        costs_currency: 'usd-microcents',
        index_cost_key: 'input_tile_512_per_step',
        costs: {
            input_tile_512_per_step: 21000,
            output_tile_512_per_step: 41000,
        },
        billingScheme: 'flux2-dev-tile-step',
        defaultSteps: 25,
        requiresMultipart: true,
    },
    {
        puterId: 'workers-ai:black-forest-labs/flux-2-klein-4b',
        id: '@cf/black-forest-labs/flux-2-klein-4b',
        aliases: ['black-forest-labs/flux-2-klein-4b'],
        name: 'FLUX.2 Klein 4B',
        costs_currency: 'usd-microcents',
        index_cost_key: 'input_tile_512',
        costs: {
            input_tile_512: 5900,
            output_tile_512: 28700,
        },
        billingScheme: 'flux2-klein-4b-tile',
        requiresMultipart: true,
    },
    {
        puterId: 'workers-ai:black-forest-labs/flux-2-klein-9b',
        id: '@cf/black-forest-labs/flux-2-klein-9b',
        aliases: ['black-forest-labs/flux-2-klein-9b'],
        name: 'FLUX.2 Klein 9B',
        costs_currency: 'usd-microcents',
        index_cost_key: 'first_mp',
        costs: {
            first_mp: 1500000,
            subsequent_mp: 200000,
            input_image_mp: 200000,
        },
        billingScheme: 'flux2-klein-9b-mp',
        requiresMultipart: true,
    },
];
