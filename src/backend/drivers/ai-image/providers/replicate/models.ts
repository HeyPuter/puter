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
    imageInputKey?: string; // our `input_images`
    singleImageInputKey?: string; // our `input_image`
    /** Cost map used when `go_fast: true` (e.g. flux-2-dev fast mode). */
    costs_go_fast?: Record<string, number>;
    /** Cost maps keyed by Leonardo `generation_mode`; falls back to `costs`. */
    costs_by_generation_mode?: Record<string, Record<string, number>>;
    /** Whitelist of caller-supplied params (canonical names) that are forwarded to Replicate. */
    allowed_params?: string[];
    /** Renames canonical param keys to the model's native API names (e.g. `steps` → `num_inference_steps`). */
    param_aliases?: Record<string, string>;
    /** Per-key value transforms (default + suffix) applied after `param_aliases`. */
    param_transforms?: Record<string, { suffix?: string; default?: unknown }>;
};

const ALIAS_FORMAT = { response_format: 'output_format' };
const ALIAS_FORMAT_STEPS = { ...ALIAS_FORMAT, steps: 'num_inference_steps' };

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
        allowed_params: [
            'seed',
            'response_format',
            'output_quality',
            'output_megapixels',
            'safety_tolerance',
        ],
        param_aliases: { ...ALIAS_FORMAT, output_megapixels: 'resolution' },
        param_transforms: { resolution: { suffix: ' MP' } },
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
        allowed_params: [
            'seed',
            'response_format',
            'output_quality',
            'disable_safety_checker',
            'go_fast',
        ],
        param_aliases: ALIAS_FORMAT,
        param_transforms: { go_fast: { default: true } },
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
        allowed_params: [
            'seed',
            'guidance',
            'response_format',
            'output_quality',
            'disable_safety_checker',
            'output_megapixels',
        ],
        param_aliases: ALIAS_FORMAT,
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
        allowed_params: [
            'seed',
            'response_format',
            'output_quality',
            'disable_safety_checker',
            'output_megapixels',
        ],
        param_aliases: ALIAS_FORMAT,
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
        allowed_params: [
            'seed',
            'steps',
            'response_format',
            'output_quality',
            'disable_safety_checker',
            'output_megapixels',
        ],
        param_aliases: {
            ...ALIAS_FORMAT_STEPS,
            output_megapixels: 'megapixels',
        },
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
        allowed_params: [
            'seed',
            'response_format',
            'output_quality',
            'safety_tolerance',
            'prompt_upsampling',
        ],
        param_aliases: ALIAS_FORMAT,
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
        costs: {
            output: 1.65, // standard: 11 units * $0.0015/unit = $0.0165
        },
        costs_by_generation_mode: {
            standard: { output: 1.65 },
            ultra: { output: 7.65 }, // 51 units * $0.0015/unit = $0.0765
        },
        billingScheme: 'per-image',
        allowed_params: [
            'style',
            'contrast',
            'prompt_enhance',
            'generation_mode',
        ],
    },
    {
        id: 'leonardoai/phoenix-1.0',
        replicateId: 'leonardoai/phoenix-1.0',
        puterId: 'replicate:leonardoai/phoenix-1.0',
        aliases: ['phoenix-1.0', 'leonardo/phoenix-1.0'],
        name: 'Phoenix 1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3.75, // quality default: 25 units * $0.0015/unit = $0.0375
        },
        costs_by_generation_mode: {
            fast: { output: 1.8 }, // 12 units * $0.0015/unit = $0.018
            quality: { output: 3.75 }, // 25 units * $0.0015/unit = $0.0375
            ultra: { output: 7.5 }, // 50 units * $0.0015/unit = $0.075
        },
        billingScheme: 'per-image',
        allowed_params: [
            'style',
            'contrast',
            'prompt_enhance',
            'generation_mode',
        ],
    },
];
