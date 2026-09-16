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

import type { ReplicateImageModel } from './models.js';

// Input fields follow the model API schemas; priceSource identifies each billing schedule.
export const ADDITIONAL_REPLICATE_IMAGE_MODELS: ReplicateImageModel[] = [
    {
        id: 'adirik/realvisxl-v3.0-turbo',
        replicateId: 'adirik/realvisxl-v3.0-turbo',
        puterId: 'replicate:adirik/realvisxl-v3.0-turbo',
        name: 'realvisxl v3.0 turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/adirik/realvisxl-v3.0-turbo#pricing',
        replicateVersion:
            '3dc73c805b11b4b01a60555e532fd3ab3f0e60d26f6584d9b8ba7e1b95858243',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 768,
            },
            height: {
                type: 'integer',
                default: 768,
            },
            prompt: {
                type: 'string',
            },
            refine: {
                type: 'string',
                enum: [
                    'no_refiner',
                    'expert_ensemble_refiner',
                    'base_image_refiner',
                ],
                default: 'no_refiner',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                    'DPM++_SDE_Karras',
                ],
                default: 'DPM++_SDE_Karras',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            refine_steps: {
                type: 'integer',
            },
            guidance_scale: {
                type: 'number',
                default: 2,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: false,
            },
            high_noise_frac: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            negative_prompt: {
                type: 'string',
                default:
                    '(worst quality, low quality, illustration, 3d, 2d, painting, cartoons, sketch), open mouth',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 25,
                minimum: 1,
                maximum: 500,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'ai-forever/kandinsky-2.2',
        replicateId: 'ai-forever/kandinsky-2.2',
        puterId: 'replicate:ai-forever/kandinsky-2.2',
        name: 'kandinsky 2.2',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource: 'https://replicate.com/ai-forever/kandinsky-2.2#pricing',
        replicateVersion:
            'ad9d7879fbffa2874e1d909d1d37d9bc682889cc65b31f7bb00d2362619f194a',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                enum: [
                    384, 512, 576, 640, 704, 768, 960, 1024, 1152, 1280, 1536,
                    1792, 2048,
                ],
                default: 512,
            },
            height: {
                type: 'integer',
                enum: [
                    384, 512, 576, 640, 704, 768, 960, 1024, 1152, 1280, 1536,
                    1792, 2048,
                ],
                default: 512,
            },
            prompt: {
                type: 'string',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpeg', 'png'],
                default: 'webp',
            },
            negative_prompt: {
                type: 'string',
            },
            num_inference_steps: {
                type: 'integer',
                default: 75,
                minimum: 1,
                maximum: 500,
            },
            num_inference_steps_prior: {
                type: 'integer',
                default: 25,
                minimum: 1,
                maximum: 500,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'ai-forever/kandinsky-2',
        replicateId: 'ai-forever/kandinsky-2',
        puterId: 'replicate:ai-forever/kandinsky-2',
        name: 'kandinsky 2',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource: 'https://replicate.com/ai-forever/kandinsky-2#pricing',
        replicateVersion:
            '3c6374e7a9a17e01afe306a5218cc67de55b19ea536466d6ea2602cfecea40a9',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                enum: [256, 288, 432, 512, 576, 768, 1024],
                default: 512,
            },
            height: {
                type: 'integer',
                enum: [256, 288, 432, 512, 576, 768, 1024],
                default: 512,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: ['ddim_sampler', 'p_sampler', 'plms_sampler'],
                default: 'p_sampler',
            },
            batch_size: {
                type: 'integer',
                enum: [1, 2, 3, 4],
                default: 1,
            },
            prior_steps: {
                type: 'string',
                default: '5',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            guidance_scale: {
                type: 'number',
                default: 4,
                minimum: 1,
                maximum: 20,
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            prior_cf_scale: {
                type: 'integer',
                default: 4,
            },
            num_inference_steps: {
                type: 'integer',
                default: 50,
                minimum: 1,
                maximum: 500,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'black-forest-labs/flux-1.1-pro-ultra',
        replicateId: 'black-forest-labs/flux-1.1-pro-ultra',
        puterId: 'replicate:black-forest-labs/flux-1.1-pro-ultra',
        name: 'flux 1.1 pro ultra',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 6,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 6,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-1.1-pro-ultra#pricing',
        inputSchema: {
            raw: {
                type: 'boolean',
                default: false,
            },
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '21:9',
                    '16:9',
                    '3:2',
                    '4:3',
                    '5:4',
                    '1:1',
                    '4:5',
                    '3:4',
                    '2:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            image_prompt: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            image_prompt_strength: {
                type: 'number',
                default: 0.1,
                minimum: 0,
                maximum: 1,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-2-flex',
        replicateId: 'black-forest-labs/flux-2-flex',
        puterId: 'replicate:black-forest-labs/flux-2-flex',
        name: 'flux 2 flex',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: {
            input_mp: 6,
            output_mp: 6,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    input_mp: 6,
                    output_mp: 6,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-2-flex#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            steps: {
                type: 'integer',
                default: 30,
                minimum: 1,
                maximum: 50,
            },
            width: {
                type: 'integer',
                minimum: 256,
                maximum: 2048,
            },
            height: {
                type: 'integer',
                minimum: 256,
                maximum: 2048,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 4.5,
                minimum: 1.5,
                maximum: 10,
            },
            resolution: {
                type: 'string',
                enum: ['match_input_image', '0.5 MP', '1 MP', '2 MP', '4 MP'],
                default: '1 MP',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    'custom',
                    '1:1',
                    '16:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '3:4',
                    '4:3',
                ],
                default: '1:1',
            },
            input_images: {
                type: 'array',
                default: [],
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 5,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: true,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-2-max',
        replicateId: 'black-forest-labs/flux-2-max',
        puterId: 'replicate:black-forest-labs/flux-2-max',
        name: 'flux 2 max',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: {
            run: 4,
            input_mp: 3,
            output_mp: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    run: 4,
                    input_mp: 3,
                    output_mp: 3,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-2-max#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                minimum: 256,
                maximum: 2048,
            },
            height: {
                type: 'integer',
                minimum: 256,
                maximum: 2048,
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: ['match_input_image', '0.5 MP', '1 MP', '2 MP', '4 MP'],
                default: '1 MP',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    'custom',
                    '1:1',
                    '16:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '3:4',
                    '4:3',
                ],
                default: '1:1',
            },
            input_images: {
                type: 'array',
                default: [],
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 5,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-canny-dev',
        replicateId: 'black-forest-labs/flux-canny-dev',
        puterId: 'replicate:black-forest-labs/flux-canny-dev',
        name: 'flux canny dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2.5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-canny-dev#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 30,
                minimum: 0,
                maximum: 100,
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25', 'match_input'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            control_image: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'control_image'],
    },
    {
        id: 'black-forest-labs/flux-canny-pro',
        replicateId: 'black-forest-labs/flux-canny-pro',
        puterId: 'replicate:black-forest-labs/flux-canny-pro',
        name: 'flux canny pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-canny-pro#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            steps: {
                type: 'integer',
                default: 50,
                minimum: 15,
                maximum: 50,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 30,
                minimum: 1,
                maximum: 100,
            },
            control_image: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'control_image'],
    },
    {
        id: 'black-forest-labs/flux-depth-dev',
        replicateId: 'black-forest-labs/flux-depth-dev',
        puterId: 'replicate:black-forest-labs/flux-depth-dev',
        name: 'flux depth dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2.5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-depth-dev#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 10,
                minimum: 0,
                maximum: 100,
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25', 'match_input'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            control_image: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'control_image'],
    },
    {
        id: 'black-forest-labs/flux-depth-pro',
        replicateId: 'black-forest-labs/flux-depth-pro',
        puterId: 'replicate:black-forest-labs/flux-depth-pro',
        name: 'flux depth pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-depth-pro#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            steps: {
                type: 'integer',
                default: 50,
                minimum: 15,
                maximum: 50,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 30,
                minimum: 1,
                maximum: 100,
            },
            control_image: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'control_image'],
    },
    {
        id: 'black-forest-labs/flux-dev-lora',
        replicateId: 'black-forest-labs/flux-dev-lora',
        puterId: 'replicate:black-forest-labs/flux-dev-lora',
        name: 'flux dev lora',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3.2,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3.2,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-dev-lora#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            go_fast: {
                type: 'boolean',
                default: true,
            },
            guidance: {
                type: 'number',
                default: 3,
                minimum: 0,
                maximum: 10,
            },
            extra_lora: {
                type: 'string',
            },
            lora_scale: {
                type: 'number',
                default: 1,
                minimum: -1,
                maximum: 3,
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '21:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '3:4',
                    '4:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            lora_weights: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            extra_lora_scale: {
                type: 'number',
                default: 1,
                minimum: -1,
                maximum: 3,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-dev',
        replicateId: 'black-forest-labs/flux-dev',
        puterId: 'replicate:black-forest-labs/flux-dev',
        name: 'flux dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/black-forest-labs/flux-dev#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            go_fast: {
                type: 'boolean',
                default: true,
            },
            guidance: {
                type: 'number',
                default: 3,
                minimum: 0,
                maximum: 10,
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '21:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '3:4',
                    '4:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-fill-dev',
        replicateId: 'black-forest-labs/flux-fill-dev',
        puterId: 'replicate:black-forest-labs/flux-fill-dev',
        name: 'flux fill dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-fill-dev#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 30,
                minimum: 0,
                maximum: 100,
            },
            lora_scale: {
                type: 'number',
                default: 1,
                minimum: -1,
                maximum: 3,
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25', 'match_input'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            lora_weights: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'image'],
    },
    {
        id: 'black-forest-labs/flux-fill-pro',
        replicateId: 'black-forest-labs/flux-fill-pro',
        puterId: 'replicate:black-forest-labs/flux-fill-pro',
        name: 'flux fill pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-fill-pro#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            steps: {
                type: 'integer',
                default: 50,
                minimum: 15,
                maximum: 50,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 60,
                minimum: 1.5,
                maximum: 100,
            },
            outpaint: {
                type: 'string',
                enum: [
                    'None',
                    'Zoom out 1.5x',
                    'Zoom out 2x',
                    'Make square',
                    'Left outpaint',
                    'Right outpaint',
                    'Top outpaint',
                    'Bottom outpaint',
                ],
                default: 'None',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'image'],
    },
    {
        id: 'black-forest-labs/flux-kontext-max',
        replicateId: 'black-forest-labs/flux-kontext-max',
        puterId: 'replicate:black-forest-labs/flux-kontext-max',
        name: 'flux kontext max',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 8,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 8,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-kontext-max#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            input_image: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '21:9',
                    '9:21',
                    '2:1',
                    '1:2',
                ],
                default: 'match_input_image',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'png',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 0,
                maximum: 6,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-kontext-pro',
        replicateId: 'black-forest-labs/flux-kontext-pro',
        puterId: 'replicate:black-forest-labs/flux-kontext-pro',
        name: 'flux kontext pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-kontext-pro#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            input_image: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '21:9',
                    '9:21',
                    '2:1',
                    '1:2',
                ],
                default: 'match_input_image',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'png',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 0,
                maximum: 6,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-pro-finetuned',
        unavailableReason:
            'Replicate cannot connect to its upstream BFL endpoint.',
        replicateId: 'black-forest-labs/flux-pro-finetuned',
        puterId: 'replicate:black-forest-labs/flux-pro-finetuned',
        name: 'flux pro finetuned',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 6,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 6,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-pro-finetuned#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            steps: {
                type: 'integer',
                default: 40,
                minimum: 1,
                maximum: 50,
            },
            width: {
                type: 'integer',
                minimum: 256,
                maximum: 1440,
            },
            height: {
                type: 'integer',
                minimum: 256,
                maximum: 1440,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 3,
                minimum: 2,
                maximum: 5,
            },
            finetune_id: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'custom',
                    '1:1',
                    '16:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '3:4',
                    '4:3',
                ],
                default: '1:1',
            },
            image_prompt: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            finetune_strength: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 2,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt', 'finetune_id'],
    },
    {
        id: 'black-forest-labs/flux-pro',
        replicateId: 'black-forest-labs/flux-pro',
        puterId: 'replicate:black-forest-labs/flux-pro',
        name: 'flux pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 5.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 5.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/black-forest-labs/flux-pro#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            steps: {
                type: 'integer',
                default: 25,
                minimum: 1,
                maximum: 50,
            },
            width: {
                type: 'integer',
                minimum: 256,
                maximum: 1440,
            },
            height: {
                type: 'integer',
                minimum: 256,
                maximum: 1440,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 3,
                minimum: 2,
                maximum: 5,
            },
            interval: {
                type: 'number',
                default: 2,
                minimum: 1,
                maximum: 4,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'custom',
                    '1:1',
                    '16:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '3:4',
                    '4:3',
                ],
                default: '1:1',
            },
            image_prompt: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'black-forest-labs/flux-redux-dev',
        replicateId: 'black-forest-labs/flux-redux-dev',
        puterId: 'replicate:black-forest-labs/flux-redux-dev',
        name: 'flux redux dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2.5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-redux-dev#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            guidance: {
                type: 'number',
                default: 3,
                minimum: 0,
                maximum: 10,
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            redux_image: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '21:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '3:4',
                    '4:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['redux_image'],
        promptKey: false,
    },
    {
        id: 'black-forest-labs/flux-redux-schnell',
        replicateId: 'black-forest-labs/flux-redux-schnell',
        puterId: 'replicate:black-forest-labs/flux-redux-schnell',
        name: 'flux redux schnell',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 0.3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 0.3,
                },
            },
        ],
        priceSource:
            'https://replicate.com/black-forest-labs/flux-redux-schnell#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            megapixels: {
                type: 'string',
                enum: ['1', '0.25'],
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            redux_image: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '21:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '3:4',
                    '4:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 4,
                minimum: 1,
                maximum: 4,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['redux_image'],
        promptKey: false,
    },
    {
        id: 'bria/fibo',
        replicateId: 'bria/fibo',
        puterId: 'replicate:bria/fibo',
        name: 'fibo',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource: 'https://replicate.com/bria/fibo#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '16:9',
                ],
                default: '1:1',
            },
            guidance_scale: {
                type: 'integer',
                minimum: 3,
                maximum: 5,
            },
            negative_prompt: {
                type: 'string',
            },
            structured_prompt: {
                type: 'string',
                default: '',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'bria/image-3.2',
        replicateId: 'bria/image-3.2',
        puterId: 'replicate:bria/image-3.2',
        name: 'image 3.2',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource: 'https://replicate.com/bria/image-3.2#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '16:9',
                ],
                default: '1:1',
            },
            enhance_image: {
                type: 'boolean',
                default: false,
            },
            guidance_scale: {
                type: 'number',
                minimum: 3,
                maximum: 5,
            },
            negative_prompt: {
                type: 'string',
            },
            prompt_enhancement: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'bytedance/sdxl-lightning-4step',
        replicateId: 'bytedance/sdxl-lightning-4step',
        puterId: 'replicate:bytedance/sdxl-lightning-4step',
        name: 'sdxl lightning 4step',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource:
            'https://replicate.com/bytedance/sdxl-lightning-4step#pricing',
        replicateVersion:
            '6f7a773af6fc3e8de9d5a3c00be77c17308914bf67772726aff83496ba1e3bbe',
        inputSchema: {
            seed: {
                type: 'integer',
                default: 0,
            },
            width: {
                type: 'integer',
                default: 1024,
                minimum: 256,
                maximum: 1280,
            },
            height: {
                type: 'integer',
                default: 1024,
                minimum: 256,
                maximum: 1280,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                    'DPM++2MSDE',
                ],
                default: 'K_EULER',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 50,
            },
            negative_prompt: {
                type: 'string',
                default: 'worst quality, low quality',
            },
            num_inference_steps: {
                type: 'integer',
                default: 4,
                minimum: 1,
                maximum: 10,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'bytedance/seedream-3',
        unavailableReason: 'Replicate reports upstream service unavailability.',
        replicateId: 'bytedance/seedream-3',
        puterId: 'replicate:bytedance/seedream-3',
        name: 'seedream 3',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3,
                },
            },
        ],
        priceSource: 'https://replicate.com/bytedance/seedream-3#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            size: {
                type: 'string',
                enum: ['small', 'regular', 'big'],
                default: 'regular',
            },
            width: {
                type: 'integer',
                default: 2048,
                minimum: 512,
                maximum: 2048,
            },
            height: {
                type: 'integer',
                default: 2048,
                minimum: 512,
                maximum: 2048,
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '3:4',
                    '4:3',
                    '16:9',
                    '9:16',
                    '2:3',
                    '3:2',
                    '21:9',
                    'custom',
                ],
                default: '16:9',
            },
            guidance_scale: {
                type: 'number',
                default: 2.5,
                minimum: 1,
                maximum: 10,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'bytedance/seedream-4.5',
        replicateId: 'bytedance/seedream-4.5',
        puterId: 'replicate:bytedance/seedream-4.5',
        name: 'seedream 4.5',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource: 'https://replicate.com/bytedance/seedream-4.5#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: ['2K', '4K', 'custom'],
                default: '2K',
            },
            width: {
                type: 'integer',
                default: 2048,
                minimum: 1024,
                maximum: 4096,
            },
            height: {
                type: 'integer',
                default: 2048,
                minimum: 1024,
                maximum: 4096,
            },
            prompt: {
                type: 'string',
            },
            max_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 15,
            },
            image_input: {
                type: 'array',
                default: [],
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '4:3',
                    '3:4',
                    '4:5',
                    '5:4',
                    '16:9',
                    '9:16',
                    '3:2',
                    '2:3',
                    '21:9',
                    '9:21',
                ],
                default: 'match_input_image',
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
            sequential_image_generation: {
                type: 'string',
                enum: ['disabled', 'auto'],
                default: 'disabled',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'bytedance/seedream-4',
        replicateId: 'bytedance/seedream-4',
        puterId: 'replicate:bytedance/seedream-4',
        name: 'seedream 4',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3,
                },
            },
        ],
        priceSource: 'https://replicate.com/bytedance/seedream-4#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: ['1K', '2K', '4K', 'custom'],
                default: '2K',
            },
            width: {
                type: 'integer',
                default: 2048,
                minimum: 1024,
                maximum: 4096,
            },
            height: {
                type: 'integer',
                default: 2048,
                minimum: 1024,
                maximum: 4096,
            },
            prompt: {
                type: 'string',
            },
            max_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 15,
            },
            image_input: {
                type: 'array',
                default: [],
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '4:3',
                    '3:4',
                    '16:9',
                    '9:16',
                    '3:2',
                    '2:3',
                    '21:9',
                ],
                default: 'match_input_image',
            },
            enhance_prompt: {
                type: 'boolean',
                default: true,
            },
            sequential_image_generation: {
                type: 'string',
                enum: ['disabled', 'auto'],
                default: 'disabled',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'bytedance/seedream-5-lite',
        replicateId: 'bytedance/seedream-5-lite',
        puterId: 'replicate:bytedance/seedream-5-lite',
        name: 'seedream 5 lite',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/bytedance/seedream-5-lite#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: ['2K', '3K'],
                default: '2K',
            },
            prompt: {
                type: 'string',
            },
            max_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 15,
            },
            image_input: {
                type: 'array',
                default: [],
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '4:3',
                    '3:4',
                    '16:9',
                    '9:16',
                    '3:2',
                    '2:3',
                    '21:9',
                ],
                default: 'match_input_image',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpeg'],
                default: 'png',
            },
            sequential_image_generation: {
                type: 'string',
                enum: ['disabled', 'auto'],
                default: 'disabled',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'comfyui/any-comfyui-workflow',
        replicateId: 'comfyui/any-comfyui-workflow',
        puterId: 'replicate:comfyui/any-comfyui-workflow',
        name: 'any comfyui workflow',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/comfyui/any-comfyui-workflow#pricing',
        replicateVersion:
            '16d0a881fbfc066f0471a3519a347db456fe8cbcbd53abb435a50a74efaeb427',
        inputSchema: {
            input_file: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            workflow_json: {
                type: 'string',
                default: '',
                minLength: 1,
            },
            output_quality: {
                type: 'integer',
                default: 95,
                minimum: 0,
                maximum: 100,
            },
            randomise_seeds: {
                type: 'boolean',
                default: true,
            },
            force_reset_cache: {
                type: 'boolean',
                default: false,
            },
            return_temp_files: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['workflow_json'],
        promptKey: false,
    },
    {
        id: 'datacte/proteus-v0.2',
        replicateId: 'datacte/proteus-v0.2',
        puterId: 'replicate:datacte/proteus-v0.2',
        name: 'proteus v0.2',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/datacte/proteus-v0.2#pricing',
        replicateVersion:
            '06775cd262843edbde5abab958abdbb65a0a6b58ca301c9fd78fa55c775fc019',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'KarrasDPM',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: 'worst quality, low quality',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 20,
                minimum: 1,
                maximum: 100,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'datacte/proteus-v0.3',
        replicateId: 'datacte/proteus-v0.3',
        puterId: 'replicate:datacte/proteus-v0.3',
        name: 'proteus v0.3',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/datacte/proteus-v0.3#pricing',
        replicateVersion:
            'b28b79d725c8548b173b6a19ff9bffd16b9b80df5b18b8dc5cb9e1ee471bfa48',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                    'DPM++2MSDE',
                ],
                default: 'DPM++2MSDE',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: 'worst quality, low quality',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 20,
                minimum: 1,
                maximum: 100,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'fermatresearch/sdxl-controlnet-lora',
        replicateId: 'fermatresearch/sdxl-controlnet-lora',
        puterId: 'replicate:fermatresearch/sdxl-controlnet-lora',
        name: 'sdxl controlnet lora',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/fermatresearch/sdxl-controlnet-lora#pricing',
        replicateVersion:
            '3bb13fe1c33c35987b33792b01b71ed6529d03f165d1c2416375859f09ca9fef',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            refine: {
                type: 'string',
                enum: ['no_refiner', 'base_image_refiner'],
                default: 'base_image_refiner',
            },
            img2img: {
                type: 'boolean',
            },
            strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            lora_scale: {
                type: 'number',
                default: 0.95,
                minimum: 0,
                maximum: 1,
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            lora_weights: {
                type: 'string',
            },
            refine_steps: {
                type: 'integer',
                default: 10,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            condition_scale: {
                type: 'number',
                default: 1.1,
                minimum: 0,
                maximum: 2,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            num_inference_steps: {
                type: 'integer',
                default: 30,
                minimum: 1,
                maximum: 500,
            },
        },
        requiredInputs: ['image'],
    },
    {
        id: 'fofr/latent-consistency-model',
        replicateId: 'fofr/latent-consistency-model',
        puterId: 'replicate:fofr/latent-consistency-model',
        name: 'latent consistency model',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource:
            'https://replicate.com/fofr/latent-consistency-model#pricing',
        replicateVersion:
            '683d19dc312f7a9f0428b04429a9ccefd28dbf7785fef083ad5cf991b65f406f',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 768,
            },
            height: {
                type: 'integer',
                default: 768,
            },
            prompt: {
                type: 'string',
            },
            num_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 50,
            },
            control_image: {
                type: 'string',
            },
            guidance_scale: {
                type: 'number',
                default: 8,
                minimum: 1,
                maximum: 20,
            },
            archive_outputs: {
                type: 'boolean',
                default: false,
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            sizing_strategy: {
                type: 'string',
                enum: ['width/height', 'input_image', 'control_image'],
                default: 'width/height',
            },
            lcm_origin_steps: {
                type: 'integer',
                default: 50,
                minimum: 1,
            },
            canny_low_threshold: {
                type: 'number',
                default: 100,
                minimum: 1,
                maximum: 255,
            },
            num_inference_steps: {
                type: 'integer',
                default: 8,
                minimum: 1,
                maximum: 50,
            },
            canny_high_threshold: {
                type: 'number',
                default: 200,
                minimum: 1,
                maximum: 255,
            },
            control_guidance_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            control_guidance_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
            controlnet_conditioning_scale: {
                type: 'number',
                default: 2,
                minimum: 0.1,
                maximum: 4,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'fofr/sdxl-emoji',
        replicateId: 'fofr/sdxl-emoji',
        puterId: 'replicate:fofr/sdxl-emoji',
        name: 'sdxl emoji',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/fofr/sdxl-emoji#pricing',
        replicateVersion:
            'dee76b5afde21b0f01ed7925f0665b7e879c50ee718c5f78a9d38e04d523cc5e',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            refine: {
                type: 'string',
                enum: [
                    'no_refiner',
                    'expert_ensemble_refiner',
                    'base_image_refiner',
                ],
                default: 'no_refiner',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            lora_scale: {
                type: 'number',
                default: 0.6,
                minimum: 0,
                maximum: 1,
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            refine_steps: {
                type: 'integer',
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            high_noise_frac: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            replicate_weights: {
                type: 'string',
            },
            num_inference_steps: {
                type: 'integer',
                default: 50,
                minimum: 1,
                maximum: 500,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'fofr/sdxl-multi-controlnet-lora',
        replicateId: 'fofr/sdxl-multi-controlnet-lora',
        puterId: 'replicate:fofr/sdxl-multi-controlnet-lora',
        name: 'sdxl multi controlnet lora',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/fofr/sdxl-multi-controlnet-lora#pricing',
        replicateVersion:
            '89eb212b3d1366a83e949c12a4b45dfe6b6b313b594cb8268e864931ac9ffb16',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 768,
            },
            height: {
                type: 'integer',
                default: 768,
            },
            prompt: {
                type: 'string',
            },
            refine: {
                type: 'string',
                enum: ['no_refiner', 'base_image_refiner'],
                default: 'no_refiner',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            lora_scale: {
                type: 'number',
                default: 0.6,
                minimum: 0,
                maximum: 1,
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            controlnet_1: {
                type: 'string',
                enum: [
                    'none',
                    'edge_canny',
                    'illusion',
                    'depth_leres',
                    'depth_midas',
                    'soft_edge_pidi',
                    'soft_edge_hed',
                    'lineart',
                    'lineart_anime',
                    'openpose',
                ],
                default: 'none',
            },
            controlnet_2: {
                type: 'string',
                enum: [
                    'none',
                    'edge_canny',
                    'illusion',
                    'depth_leres',
                    'depth_midas',
                    'soft_edge_pidi',
                    'soft_edge_hed',
                    'lineart',
                    'lineart_anime',
                    'openpose',
                ],
                default: 'none',
            },
            controlnet_3: {
                type: 'string',
                enum: [
                    'none',
                    'edge_canny',
                    'illusion',
                    'depth_leres',
                    'depth_midas',
                    'soft_edge_pidi',
                    'soft_edge_hed',
                    'lineart',
                    'lineart_anime',
                    'openpose',
                ],
                default: 'none',
            },
            lora_weights: {
                type: 'string',
            },
            refine_steps: {
                type: 'integer',
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            sizing_strategy: {
                type: 'string',
                enum: [
                    'width_height',
                    'input_image',
                    'controlnet_1_image',
                    'controlnet_2_image',
                    'controlnet_3_image',
                    'mask_image',
                ],
                default: 'width_height',
            },
            controlnet_1_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            controlnet_2_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            controlnet_3_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            controlnet_1_image: {
                type: 'string',
            },
            controlnet_1_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            controlnet_2_image: {
                type: 'string',
            },
            controlnet_2_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            controlnet_3_image: {
                type: 'string',
            },
            controlnet_3_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 30,
                minimum: 1,
                maximum: 500,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
            controlnet_1_conditioning_scale: {
                type: 'number',
                default: 0.75,
                minimum: 0,
                maximum: 4,
            },
            controlnet_2_conditioning_scale: {
                type: 'number',
                default: 0.75,
                minimum: 0,
                maximum: 4,
            },
            controlnet_3_conditioning_scale: {
                type: 'number',
                default: 0.75,
                minimum: 0,
                maximum: 4,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'fofr/sticker-maker',
        replicateId: 'fofr/sticker-maker',
        puterId: 'replicate:fofr/sticker-maker',
        name: 'sticker maker',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/fofr/sticker-maker#pricing',
        replicateVersion:
            '4acb778eb059772225ec213948f0660867b2e03f277448f18cf1800b96a65a1a',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            steps: {
                type: 'integer',
                default: 17,
            },
            width: {
                type: 'integer',
                default: 1152,
            },
            height: {
                type: 'integer',
                default: 1152,
            },
            prompt: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 90,
                minimum: 0,
                maximum: 100,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            number_of_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 10,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'google/nano-banana-2',
        replicateId: 'google/nano-banana-2',
        puterId: 'replicate:google/nano-banana-2',
        name: 'nano banana 2',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 6.7,
            'output:1K': 6.7,
            'output:2K': 10.1,
            'output:4K': 15.1,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                when: {
                    resolution: '1K',
                },
                costs: {
                    output: 6.7,
                },
            },
            {
                when: {
                    resolution: '2K',
                },
                costs: {
                    output: 10.1,
                },
            },
            {
                when: {
                    resolution: '4K',
                },
                costs: {
                    output: 15.1,
                },
            },
        ],
        priceSource: 'https://replicate.com/google/nano-banana-2#pricing',
        inputSchema: {
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: ['1K', '2K', '4K'],
                default: '1K',
            },
            image_input: {
                type: 'array',
                default: [],
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '1:4',
                    '1:8',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:1',
                    '4:3',
                    '4:5',
                    '5:4',
                    '8:1',
                    '9:16',
                    '16:9',
                    '21:9',
                ],
                default: 'match_input_image',
            },
            image_search: {
                type: 'boolean',
                default: false,
            },
            google_search: {
                type: 'boolean',
                default: false,
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'google/nano-banana-pro',
        replicateId: 'google/nano-banana-pro',
        puterId: 'replicate:google/nano-banana-pro',
        name: 'nano banana pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 15,
            'output:1K': 15,
            'output:2K': 15,
            'output:4K': 30,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                when: {
                    resolution: '1K',
                },
                costs: {
                    output: 15,
                },
            },
            {
                when: {
                    resolution: '2K',
                },
                costs: {
                    output: 15,
                },
            },
            {
                when: {
                    resolution: '4K',
                },
                costs: {
                    output: 30,
                },
            },
        ],
        priceSource: 'https://replicate.com/google/nano-banana-pro#pricing',
        inputSchema: {
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: ['1K', '2K', '4K'],
                default: '2K',
            },
            image_input: {
                type: 'array',
                default: [],
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '16:9',
                    '21:9',
                ],
                default: 'match_input_image',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
            safety_filter_level: {
                type: 'string',
                enum: [
                    'block_low_and_above',
                    'block_medium_and_above',
                    'block_only_high',
                ],
                default: 'block_only_high',
            },
            allow_fallback_model: {
                type: 'boolean',
                default: false,
                enum: [false],
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'google/nano-banana',
        replicateId: 'google/nano-banana',
        puterId: 'replicate:google/nano-banana',
        name: 'nano banana',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3.9,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3.9,
                },
            },
        ],
        priceSource: 'https://replicate.com/google/nano-banana#pricing',
        inputSchema: {
            prompt: {
                type: 'string',
            },
            image_input: {
                type: 'array',
                default: [],
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'match_input_image',
                    '1:1',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '9:16',
                    '16:9',
                    '21:9',
                ],
                default: 'match_input_image',
            },
            output_format: {
                type: 'string',
                enum: ['jpg', 'png'],
                default: 'jpg',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v2-turbo',
        replicateId: 'ideogram-ai/ideogram-v2-turbo',
        puterId: 'replicate:ideogram-ai/ideogram-v2-turbo',
        name: 'ideogram v2 turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/ideogram-ai/ideogram-v2-turbo#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: [
                    'None',
                    'Auto',
                    'General',
                    'Realistic',
                    'Design',
                    'Render 3D',
                    'Anime',
                ],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:10',
                    '10:16',
                    '3:1',
                    '1:3',
                ],
                default: '1:1',
            },
            negative_prompt: {
                type: 'string',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v2',
        replicateId: 'ideogram-ai/ideogram-v2',
        puterId: 'replicate:ideogram-ai/ideogram-v2',
        name: 'ideogram v2',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 8,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 8,
                },
            },
        ],
        priceSource: 'https://replicate.com/ideogram-ai/ideogram-v2#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: [
                    'None',
                    'Auto',
                    'General',
                    'Realistic',
                    'Design',
                    'Render 3D',
                    'Anime',
                ],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:10',
                    '10:16',
                    '3:1',
                    '1:3',
                ],
                default: '1:1',
            },
            negative_prompt: {
                type: 'string',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v2a-turbo',
        replicateId: 'ideogram-ai/ideogram-v2a-turbo',
        puterId: 'replicate:ideogram-ai/ideogram-v2a-turbo',
        name: 'ideogram v2a turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2.5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/ideogram-ai/ideogram-v2a-turbo#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: [
                    'None',
                    'Auto',
                    'General',
                    'Realistic',
                    'Design',
                    'Render 3D',
                    'Anime',
                ],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:10',
                    '10:16',
                    '3:1',
                    '1:3',
                ],
                default: '1:1',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v2a',
        replicateId: 'ideogram-ai/ideogram-v2a',
        puterId: 'replicate:ideogram-ai/ideogram-v2a',
        name: 'ideogram v2a',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource: 'https://replicate.com/ideogram-ai/ideogram-v2a#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: [
                    'None',
                    'Auto',
                    'General',
                    'Realistic',
                    'Design',
                    'Render 3D',
                    'Anime',
                ],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:10',
                    '10:16',
                    '3:1',
                    '1:3',
                ],
                default: '1:1',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v3-balanced',
        replicateId: 'ideogram-ai/ideogram-v3-balanced',
        puterId: 'replicate:ideogram-ai/ideogram-v3-balanced',
        name: 'ideogram v3 balanced',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 6,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 6,
                },
            },
        ],
        priceSource:
            'https://replicate.com/ideogram-ai/ideogram-v3-balanced#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '800x1280',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: ['None', 'Auto', 'General', 'Realistic', 'Design'],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:3',
                    '3:1',
                    '1:2',
                    '2:1',
                    '9:16',
                    '16:9',
                    '10:16',
                    '16:10',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '1:1',
                ],
                default: '1:1',
            },
            style_preset: {
                type: 'string',
                enum: [
                    'None',
                    '80s Illustration',
                    '90s Nostalgia',
                    'Abstract Organic',
                    'Analog Nostalgia',
                    'Art Brut',
                    'Art Deco',
                    'Art Poster',
                    'Aura',
                    'Avant Garde',
                    'Bauhaus',
                    'Blueprint',
                    'Blurry Motion',
                    'Bright Art',
                    'C4D Cartoon',
                    "Children's Book",
                    'Collage',
                    'Coloring Book I',
                    'Coloring Book II',
                    'Cubism',
                    'Dark Aura',
                    'Doodle',
                    'Double Exposure',
                    'Dramatic Cinema',
                    'Editorial',
                    'Emotional Minimal',
                    'Ethereal Party',
                    'Expired Film',
                    'Flat Art',
                    'Flat Vector',
                    'Forest Reverie',
                    'Geo Minimalist',
                    'Glass Prism',
                    'Golden Hour',
                    'Graffiti I',
                    'Graffiti II',
                    'Halftone Print',
                    'High Contrast',
                    'Hippie Era',
                    'Iconic',
                    'Japandi Fusion',
                    'Jazzy',
                    'Long Exposure',
                    'Magazine Editorial',
                    'Minimal Illustration',
                    'Mixed Media',
                    'Monochrome',
                    'Nightlife',
                    'Oil Painting',
                    'Old Cartoons',
                    'Paint Gesture',
                    'Pop Art',
                    'Retro Etching',
                    'Riviera Pop',
                    'Spotlight 80s',
                    'Stylized Red',
                    'Surreal Collage',
                    'Travel Poster',
                    'Vintage Geo',
                    'Vintage Poster',
                    'Watercolor',
                    'Weird',
                    'Woodblock Print',
                ],
                default: 'None',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
            style_reference_images: {
                type: 'array',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v3-quality',
        replicateId: 'ideogram-ai/ideogram-v3-quality',
        puterId: 'replicate:ideogram-ai/ideogram-v3-quality',
        name: 'ideogram v3 quality',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 9,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 9,
                },
            },
        ],
        priceSource:
            'https://replicate.com/ideogram-ai/ideogram-v3-quality#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '800x1280',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: ['None', 'Auto', 'General', 'Realistic', 'Design'],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:3',
                    '3:1',
                    '1:2',
                    '2:1',
                    '9:16',
                    '16:9',
                    '10:16',
                    '16:10',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '1:1',
                ],
                default: '1:1',
            },
            style_preset: {
                type: 'string',
                enum: [
                    'None',
                    '80s Illustration',
                    '90s Nostalgia',
                    'Abstract Organic',
                    'Analog Nostalgia',
                    'Art Brut',
                    'Art Deco',
                    'Art Poster',
                    'Aura',
                    'Avant Garde',
                    'Bauhaus',
                    'Blueprint',
                    'Blurry Motion',
                    'Bright Art',
                    'C4D Cartoon',
                    "Children's Book",
                    'Collage',
                    'Coloring Book I',
                    'Coloring Book II',
                    'Cubism',
                    'Dark Aura',
                    'Doodle',
                    'Double Exposure',
                    'Dramatic Cinema',
                    'Editorial',
                    'Emotional Minimal',
                    'Ethereal Party',
                    'Expired Film',
                    'Flat Art',
                    'Flat Vector',
                    'Forest Reverie',
                    'Geo Minimalist',
                    'Glass Prism',
                    'Golden Hour',
                    'Graffiti I',
                    'Graffiti II',
                    'Halftone Print',
                    'High Contrast',
                    'Hippie Era',
                    'Iconic',
                    'Japandi Fusion',
                    'Jazzy',
                    'Long Exposure',
                    'Magazine Editorial',
                    'Minimal Illustration',
                    'Mixed Media',
                    'Monochrome',
                    'Nightlife',
                    'Oil Painting',
                    'Old Cartoons',
                    'Paint Gesture',
                    'Pop Art',
                    'Retro Etching',
                    'Riviera Pop',
                    'Spotlight 80s',
                    'Stylized Red',
                    'Surreal Collage',
                    'Travel Poster',
                    'Vintage Geo',
                    'Vintage Poster',
                    'Watercolor',
                    'Weird',
                    'Woodblock Print',
                ],
                default: 'None',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
            style_reference_images: {
                type: 'array',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'ideogram-ai/ideogram-v3-turbo',
        replicateId: 'ideogram-ai/ideogram-v3-turbo',
        puterId: 'replicate:ideogram-ai/ideogram-v3-turbo',
        name: 'ideogram v3 turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3,
                },
            },
        ],
        priceSource:
            'https://replicate.com/ideogram-ai/ideogram-v3-turbo#pricing',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
                maximum: 2147483647,
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            resolution: {
                type: 'string',
                enum: [
                    'None',
                    '512x1536',
                    '576x1408',
                    '576x1472',
                    '576x1536',
                    '640x1344',
                    '640x1408',
                    '640x1472',
                    '640x1536',
                    '704x1152',
                    '704x1216',
                    '704x1280',
                    '704x1344',
                    '704x1408',
                    '704x1472',
                    '736x1312',
                    '768x1088',
                    '768x1216',
                    '768x1280',
                    '768x1344',
                    '800x1280',
                    '832x960',
                    '832x1024',
                    '832x1088',
                    '832x1152',
                    '832x1216',
                    '832x1248',
                    '864x1152',
                    '896x960',
                    '896x1024',
                    '896x1088',
                    '896x1120',
                    '896x1152',
                    '960x832',
                    '960x896',
                    '960x1024',
                    '960x1088',
                    '1024x832',
                    '1024x896',
                    '1024x960',
                    '1024x1024',
                    '1088x768',
                    '1088x832',
                    '1088x896',
                    '1088x960',
                    '1120x896',
                    '1152x704',
                    '1152x832',
                    '1152x864',
                    '1152x896',
                    '1216x704',
                    '1216x768',
                    '1216x832',
                    '1248x832',
                    '1280x704',
                    '1280x768',
                    '1280x800',
                    '1312x736',
                    '1344x640',
                    '1344x704',
                    '1344x768',
                    '1408x576',
                    '1408x640',
                    '1408x704',
                    '1472x576',
                    '1472x640',
                    '1472x704',
                    '1536x512',
                    '1536x576',
                    '1536x640',
                ],
                default: 'None',
            },
            style_type: {
                type: 'string',
                enum: ['None', 'Auto', 'General', 'Realistic', 'Design'],
                default: 'None',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:3',
                    '3:1',
                    '1:2',
                    '2:1',
                    '9:16',
                    '16:9',
                    '10:16',
                    '16:10',
                    '2:3',
                    '3:2',
                    '3:4',
                    '4:3',
                    '4:5',
                    '5:4',
                    '1:1',
                ],
                default: '1:1',
            },
            style_preset: {
                type: 'string',
                enum: [
                    'None',
                    '80s Illustration',
                    '90s Nostalgia',
                    'Abstract Organic',
                    'Analog Nostalgia',
                    'Art Brut',
                    'Art Deco',
                    'Art Poster',
                    'Aura',
                    'Avant Garde',
                    'Bauhaus',
                    'Blueprint',
                    'Blurry Motion',
                    'Bright Art',
                    'C4D Cartoon',
                    "Children's Book",
                    'Collage',
                    'Coloring Book I',
                    'Coloring Book II',
                    'Cubism',
                    'Dark Aura',
                    'Doodle',
                    'Double Exposure',
                    'Dramatic Cinema',
                    'Editorial',
                    'Emotional Minimal',
                    'Ethereal Party',
                    'Expired Film',
                    'Flat Art',
                    'Flat Vector',
                    'Forest Reverie',
                    'Geo Minimalist',
                    'Glass Prism',
                    'Golden Hour',
                    'Graffiti I',
                    'Graffiti II',
                    'Halftone Print',
                    'High Contrast',
                    'Hippie Era',
                    'Iconic',
                    'Japandi Fusion',
                    'Jazzy',
                    'Long Exposure',
                    'Magazine Editorial',
                    'Minimal Illustration',
                    'Mixed Media',
                    'Monochrome',
                    'Nightlife',
                    'Oil Painting',
                    'Old Cartoons',
                    'Paint Gesture',
                    'Pop Art',
                    'Retro Etching',
                    'Riviera Pop',
                    'Spotlight 80s',
                    'Stylized Red',
                    'Surreal Collage',
                    'Travel Poster',
                    'Vintage Geo',
                    'Vintage Poster',
                    'Watercolor',
                    'Weird',
                    'Woodblock Print',
                ],
                default: 'None',
            },
            magic_prompt_option: {
                type: 'string',
                enum: ['Auto', 'On', 'Off'],
                default: 'Auto',
            },
            style_reference_images: {
                type: 'array',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'jagilley/controlnet-scribble',
        // ControlNet returns the detected control map before the generated sample.
        outputIndex: 1,
        replicateId: 'jagilley/controlnet-scribble',
        puterId: 'replicate:jagilley/controlnet-scribble',
        name: 'controlnet scribble',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource:
            'https://replicate.com/jagilley/controlnet-scribble#pricing',
        replicateVersion:
            '435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117',
        inputSchema: {
            eta: {
                type: 'number',
                default: 0,
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            scale: {
                type: 'number',
                default: 9,
                minimum: 0.1,
                maximum: 30,
            },
            prompt: {
                type: 'string',
            },
            a_prompt: {
                type: 'string',
                default: 'best quality, extremely detailed',
            },
            n_prompt: {
                type: 'string',
                default:
                    'longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
            },
            ddim_steps: {
                type: 'integer',
                default: 20,
            },
            num_samples: {
                type: 'string',
                enum: ['1', '4'],
                default: '1',
            },
            image_resolution: {
                type: 'string',
                enum: ['256', '512', '768'],
                default: '512',
            },
        },
        requiredInputs: ['image', 'prompt'],
    },
    {
        id: 'lucataco/dreamshaper-xl-turbo',
        replicateId: 'lucataco/dreamshaper-xl-turbo',
        puterId: 'replicate:lucataco/dreamshaper-xl-turbo',
        name: 'dreamshaper xl turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/lucataco/dreamshaper-xl-turbo#pricing',
        replicateVersion:
            '0a1710e0187b01a255302738ca0158ff02a22f4638679533e111082f9dd1b615',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 2,
                minimum: 1,
                maximum: 20,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            num_inference_steps: {
                type: 'integer',
                default: 6,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'lucataco/open-dalle-v1.1',
        replicateId: 'lucataco/open-dalle-v1.1',
        puterId: 'replicate:lucataco/open-dalle-v1.1',
        name: 'open dalle v1.1',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/lucataco/open-dalle-v1.1#pricing',
        replicateVersion:
            '1c7d4c8dec39c7306df7794b28419078cb9d18b9213ab1c21fdc46a1deca0144',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'KarrasDPM',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: 'worst quality, low quality',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 60,
                minimum: 1,
                maximum: 100,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'lucataco/realistic-vision-v5.1',
        replicateId: 'lucataco/realistic-vision-v5.1',
        puterId: 'replicate:lucataco/realistic-vision-v5.1',
        name: 'realistic vision v5.1',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/lucataco/realistic-vision-v5.1#pricing',
        replicateVersion:
            '2c8e954decbf70b7607a4414e5785ef9e4de4b8c51d50fb8b8b349160e0ef6bb',
        inputSchema: {
            seed: {
                type: 'integer',
                default: 0,
            },
            steps: {
                type: 'integer',
                default: 20,
                minimum: 0,
                maximum: 100,
            },
            width: {
                type: 'integer',
                default: 512,
                minimum: 0,
                maximum: 1920,
            },
            height: {
                type: 'integer',
                default: 728,
                minimum: 0,
                maximum: 1920,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 5,
            },
            scheduler: {
                type: 'string',
                enum: ['EulerA', 'MultistepDPM-Solver'],
                default: 'EulerA',
            },
            negative_prompt: {
                type: 'string',
            },
        },
        requiredInputs: [],
    },
    {
        id: 'lucataco/ssd-1b',
        replicateId: 'lucataco/ssd-1b',
        puterId: 'replicate:lucataco/ssd-1b',
        name: 'ssd 1b',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/lucataco/ssd-1b#pricing',
        replicateVersion:
            'b19e3639452c59ce8295b82aba70a231404cb062f2eb580ea894b31e8ce5bbb6',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 768,
            },
            height: {
                type: 'integer',
                default: 768,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            lora_scale: {
                type: 'number',
                default: 0.6,
                minimum: 0,
                maximum: 1,
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            batched_prompt: {
                type: 'boolean',
                default: false,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: 'scary, cartoon, painting',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            replicate_weights: {
                type: 'string',
            },
            num_inference_steps: {
                type: 'integer',
                default: 25,
                minimum: 1,
                maximum: 500,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'luma/photon-flash',
        replicateId: 'luma/photon-flash',
        puterId: 'replicate:luma/photon-flash',
        name: 'photon flash',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 1,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 1,
                },
            },
        ],
        priceSource: 'https://replicate.com/luma/photon-flash#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
                default: '16:9',
            },
            image_reference: {
                type: 'string',
            },
            style_reference: {
                type: 'string',
            },
            character_reference: {
                type: 'string',
            },
            image_reference_url: {
                type: 'string',
            },
            style_reference_url: {
                type: 'string',
            },
            image_reference_weight: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
            style_reference_weight: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
            character_reference_url: {
                type: 'string',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'luma/photon',
        replicateId: 'luma/photon',
        puterId: 'replicate:luma/photon',
        name: 'photon',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3,
                },
            },
        ],
        priceSource: 'https://replicate.com/luma/photon#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: ['1:1', '3:4', '4:3', '9:16', '16:9', '9:21', '21:9'],
                default: '16:9',
            },
            image_reference_url: {
                type: 'string',
            },
            style_reference_url: {
                type: 'string',
            },
            image_reference_weight: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
            style_reference_weight: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
            character_reference_url: {
                type: 'string',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'minimax/image-01',
        replicateId: 'minimax/image-01',
        puterId: 'replicate:minimax/image-01',
        name: 'image 01',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 1,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 1,
                },
            },
        ],
        priceSource: 'https://replicate.com/minimax/image-01#pricing',
        inputSchema: {
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '4:3',
                    '3:2',
                    '2:3',
                    '3:4',
                    '9:16',
                    '21:9',
                ],
                default: '1:1',
            },
            number_of_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 9,
            },
            prompt_optimizer: {
                type: 'boolean',
                default: true,
            },
            subject_reference: {
                type: 'string',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'nvidia/sana-sprint-1.6b',
        replicateId: 'nvidia/sana-sprint-1.6b',
        puterId: 'replicate:nvidia/sana-sprint-1.6b',
        name: 'sana sprint 1.6b',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.1525,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.1525,
                },
            },
        ],
        priceSource: 'https://replicate.com/nvidia/sana-sprint-1.6b#pricing',
        replicateVersion:
            '038aee6907b53a5c148780983e39a50ce7cd0747b4e2642e78387f48cf36039a',
        inputSchema: {
            seed: {
                type: 'integer',
                default: -1,
            },
            width: {
                type: 'integer',
                default: 1024,
                minimum: 256,
                maximum: 4096,
            },
            height: {
                type: 'integer',
                default: 1024,
                minimum: 256,
                maximum: 4096,
            },
            prompt: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'jpg',
            },
            guidance_scale: {
                type: 'number',
                default: 4.5,
                minimum: 1,
                maximum: 20,
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            inference_steps: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 4,
            },
            intermediate_timesteps: {
                type: 'number',
                default: 1.3,
                minimum: 1,
                maximum: 1.5,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'nvidia/sana',
        replicateId: 'nvidia/sana',
        puterId: 'replicate:nvidia/sana',
        name: 'sana',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.1525,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.1525,
                },
            },
        ],
        priceSource: 'https://replicate.com/nvidia/sana#pricing',
        replicateVersion:
            'c6b5d2b7459910fec94432e9e1203c3cdce92d6db20f714f1355747990b52fa6',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            model_variant: {
                type: 'string',
                enum: [
                    '1600M-1024px',
                    '1600M-1024px-multilang',
                    '1600M-512px',
                    '600M-1024px-multilang',
                    '600M-512px-multilang',
                ],
                default: '1600M-1024px',
            },
            guidance_scale: {
                type: 'number',
                default: 5,
                minimum: 1,
                maximum: 20,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            pag_guidance_scale: {
                type: 'number',
                default: 2,
                minimum: 1,
                maximum: 20,
            },
            num_inference_steps: {
                type: 'integer',
                default: 18,
                minimum: 1,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'openai/gpt-image-1.5',
        replicateId: 'openai/gpt-image-1.5',
        puterId: 'replicate:openai/gpt-image-1.5',
        name: 'gpt image 1.5',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 13.6,
            'output:auto': 13.6,
            'output:low': 1.3,
            'output:medium': 5,
            'output:high': 13.6,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                when: {
                    quality: 'auto',
                },
                costs: {
                    output: 13.6,
                },
            },
            {
                when: {
                    quality: 'low',
                },
                costs: {
                    output: 1.3,
                },
            },
            {
                when: {
                    quality: 'medium',
                },
                costs: {
                    output: 5,
                },
            },
            {
                when: {
                    quality: 'high',
                },
                costs: {
                    output: 13.6,
                },
            },
        ],
        priceSource: 'https://replicate.com/openai/gpt-image-1.5#pricing',
        inputSchema: {
            prompt: {
                type: 'string',
            },
            quality: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'auto'],
                default: 'auto',
            },
            user_id: {
                type: 'string',
            },
            background: {
                type: 'string',
                enum: ['auto', 'transparent', 'opaque'],
                default: 'auto',
            },
            moderation: {
                type: 'string',
                enum: ['auto', 'low'],
                default: 'auto',
            },
            aspect_ratio: {
                type: 'string',
                enum: ['1:1', '3:2', '2:3'],
                default: '1:1',
            },
            input_images: {
                type: 'array',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpeg', 'webp'],
                default: 'webp',
            },
            input_fidelity: {
                type: 'string',
                enum: ['low', 'high'],
                default: 'low',
            },
            number_of_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 10,
            },
            output_compression: {
                type: 'integer',
                default: 90,
                minimum: 0,
                maximum: 100,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'openai/gpt-image-2',
        replicateId: 'openai/gpt-image-2',
        puterId: 'replicate:openai/gpt-image-2',
        name: 'gpt image 2',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 12.8,
            'output:auto': 12.8,
            'output:low': 1.2,
            'output:medium': 4.7,
            'output:high': 12.8,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                when: {
                    quality: 'auto',
                },
                costs: {
                    output: 12.8,
                },
            },
            {
                when: {
                    quality: 'low',
                },
                costs: {
                    output: 1.2,
                },
            },
            {
                when: {
                    quality: 'medium',
                },
                costs: {
                    output: 4.7,
                },
            },
            {
                when: {
                    quality: 'high',
                },
                costs: {
                    output: 12.8,
                },
            },
        ],
        priceSource: 'https://replicate.com/openai/gpt-image-2#pricing',
        inputSchema: {
            prompt: {
                type: 'string',
            },
            quality: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'auto'],
                default: 'auto',
            },
            user_id: {
                type: 'string',
                default: null,
            },
            background: {
                type: 'string',
                enum: ['auto', 'transparent', 'opaque'],
                default: 'auto',
            },
            moderation: {
                type: 'string',
                enum: ['auto', 'low'],
                default: 'auto',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '3:2',
                    '2:3',
                    '4:3',
                    '3:4',
                    '16:9',
                    '9:16',
                    'auto',
                    '1024x1024',
                    '1536x1024',
                    '1024x1536',
                    '1536x1152',
                    '1152x1536',
                    '2048x2048',
                    '2048x1152',
                    '1152x2048',
                    '3840x2160',
                    '2160x3840',
                ],
                default: '1:1',
            },
            input_images: {
                type: 'array',
                default: null,
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpeg', 'webp'],
                default: 'webp',
            },
            number_of_images: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 10,
            },
            output_compression: {
                type: 'integer',
                default: 90,
                minimum: 0,
                maximum: 100,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'playgroundai/playground-v2.5-1024px-aesthetic',
        replicateId: 'playgroundai/playground-v2.5-1024px-aesthetic',
        puterId: 'replicate:playgroundai/playground-v2.5-1024px-aesthetic',
        name: 'playground v2.5 1024px aesthetic',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource:
            'https://replicate.com/playgroundai/playground-v2.5-1024px-aesthetic#pricing',
        replicateVersion:
            'a45f82a1382bed5c7aeb861dac7c7d191b0fdf74d8d57c4a0e6ed7d4d0bf7d24',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 1024,
                minimum: 256,
                maximum: 1536,
            },
            height: {
                type: 'integer',
                default: 1024,
                minimum: 256,
                maximum: 1536,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                    'DPM++2MKarras',
                    'DPMSolver++',
                ],
                default: 'DPMSolver++',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 3,
                minimum: 0.1,
                maximum: 20,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            negative_prompt: {
                type: 'string',
                default: 'ugly, deformed, noisy, blurry, distorted',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 25,
                minimum: 1,
                maximum: 60,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'prunaai/flux-fast',
        replicateId: 'prunaai/flux-fast',
        puterId: 'replicate:prunaai/flux-fast',
        name: 'flux fast',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 0.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 0.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/flux-fast#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
                default: -1,
            },
            prompt: {
                type: 'string',
            },
            guidance: {
                type: 'number',
                default: 3.5,
            },
            image_size: {
                type: 'integer',
                default: 1024,
            },
            speed_mode: {
                type: 'string',
                enum: [
                    'Lightly Juiced 🍊 (more consistent)',
                    'Juiced 🔥 (default)',
                    'Extra Juiced 🔥 (more speed)',
                    'Blink of an eye 👁️',
                ],
                default: 'Extra Juiced 🔥 (more speed)',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '21:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '3:4',
                    '4:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'jpg',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 1,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 28,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/hidream-l1-dev',
        replicateId: 'prunaai/hidream-l1-dev',
        puterId: 'replicate:prunaai/hidream-l1-dev',
        name: 'hidream l1 dev',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.1525,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.1525,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/hidream-l1-dev#pricing',
        replicateVersion:
            '4dfcd146c0def4812455415f55556f6bc84025dcb15193cf1977f01bd384d191',
        inputSchema: {
            seed: {
                type: 'integer',
                default: -1,
            },
            prompt: {
                type: 'string',
            },
            model_type: {
                type: 'string',
                enum: ['dev'],
                default: 'dev',
            },
            resolution: {
                type: 'string',
                enum: [
                    '1024 × 1024 (Square)',
                    '768 × 1360 (Portrait)',
                    '1360 × 768 (Landscape)',
                    '880 × 1168 (Portrait)',
                    '1168 × 880 (Landscape)',
                    '1248 × 832 (Landscape)',
                    '832 × 1248 (Portrait)',
                ],
                default: '1024 × 1024 (Square)',
            },
            speed_mode: {
                type: 'string',
                enum: [
                    'Unsqueezed 🍋 (highest quality)',
                    'Lightly Juiced 🍊 (more consistent)',
                    'Juiced 🔥 (more speed)',
                    'Extra Juiced 🚀 (even more speed)',
                ],
                default: 'Lightly Juiced 🍊 (more consistent)',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 100,
                minimum: 1,
                maximum: 100,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/hidream-l1-fast',
        unavailableReason: 'Replicate reports a read timeout while generating.',
        replicateId: 'prunaai/hidream-l1-fast',
        puterId: 'replicate:prunaai/hidream-l1-fast',
        name: 'hidream l1 fast',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 0.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 0.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/hidream-l1-fast#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
                default: -1,
            },
            prompt: {
                type: 'string',
            },
            model_type: {
                type: 'string',
                default: 'fast',
            },
            resolution: {
                type: 'string',
                enum: [
                    '1024 × 1024 (Square)',
                    '768 × 1360 (Portrait)',
                    '1360 × 768 (Landscape)',
                    '880 × 1168 (Portrait)',
                    '1168 × 880 (Landscape)',
                    '1248 × 832 (Landscape)',
                    '832 × 1248 (Portrait)',
                ],
                default: '1024 × 1024 (Square)',
            },
            speed_mode: {
                type: 'string',
                enum: [
                    'Unsqueezed 🍋 (highest quality)',
                    'Lightly Juiced 🍊 (more consistent)',
                    'Juiced 🔥 (more speed)',
                    'Extra Juiced 🚀 (even more speed)',
                ],
                default: 'Extra Juiced 🚀 (even more speed)',
            },
            aspect_ratio: {
                type: 'string',
                default: '',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 100,
                minimum: 1,
                maximum: 100,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/hidream-l1-full',
        replicateId: 'prunaai/hidream-l1-full',
        puterId: 'replicate:prunaai/hidream-l1-full',
        name: 'hidream l1 full',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.1525,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.1525,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/hidream-l1-full#pricing',
        replicateVersion:
            '03d58532fd29e39fd2ed80e86c3da1cebec28ef2734081cf1366710d30388f42',
        inputSchema: {
            seed: {
                type: 'integer',
                default: -1,
            },
            prompt: {
                type: 'string',
            },
            model_type: {
                type: 'string',
                enum: ['full'],
                default: 'full',
            },
            resolution: {
                type: 'string',
                enum: [
                    '1024 × 1024 (Square)',
                    '768 × 1360 (Portrait)',
                    '1360 × 768 (Landscape)',
                    '880 × 1168 (Portrait)',
                    '1168 × 880 (Landscape)',
                    '1248 × 832 (Landscape)',
                    '832 × 1248 (Portrait)',
                ],
                default: '1024 × 1024 (Square)',
            },
            speed_mode: {
                type: 'string',
                enum: [
                    'Unsqueezed 🍋 (highest quality)',
                    'Lightly Juiced 🍊 (more consistent)',
                    'Juiced 🔥 (more speed)',
                    'Extra Juiced 🚀 (even more speed)',
                ],
                default: 'Lightly Juiced 🍊 (more consistent)',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 100,
                minimum: 1,
                maximum: 100,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/p-image-lora',
        replicateId: 'prunaai/p-image-lora',
        puterId: 'replicate:prunaai/p-image-lora',
        name: 'p image lora',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 0.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 0.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/p-image-lora#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
                default: null,
            },
            width: {
                type: 'integer',
                default: null,
                minimum: 256,
                maximum: 1440,
            },
            height: {
                type: 'integer',
                default: null,
                minimum: 256,
                maximum: 1440,
            },
            prompt: {
                type: 'string',
            },
            lora_scale: {
                type: 'number',
                default: 0.5,
                minimum: -1,
                maximum: 3,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    'custom',
                ],
                default: '16:9',
            },
            lora_weights: {
                type: 'string',
                default: null,
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/p-image',
        replicateId: 'prunaai/p-image',
        puterId: 'replicate:prunaai/p-image',
        name: 'p image',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 0.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 0.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/p-image#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                minimum: 256,
                maximum: 1440,
            },
            height: {
                type: 'integer',
                minimum: 256,
                maximum: 1440,
            },
            prompt: {
                type: 'string',
            },
            lora_scale: {
                type: 'number',
                default: 0.5,
                minimum: -1,
                maximum: 3,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    'custom',
                ],
                default: '16:9',
            },
            lora_weights: {
                type: 'string',
            },
            prompt_upsampling: {
                type: 'boolean',
                default: false,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/sdxl-lightning',
        replicateId: 'prunaai/sdxl-lightning',
        puterId: 'replicate:prunaai/sdxl-lightning',
        name: 'sdxl lightning',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/sdxl-lightning#pricing',
        replicateVersion:
            '123d4264aec4d1c81d8bf142e0d90d6fd4c346f1a869406019f6d1653882d7c3',
        inputSchema: {
            seed: {
                type: 'integer',
                default: 42,
            },
            prompt: {
                type: 'string',
            },
            num_images: {
                type: 'integer',
                default: 1,
            },
            image_width: {
                type: 'integer',
                default: 1024,
            },
            image_height: {
                type: 'integer',
                default: 1024,
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'jpg',
            },
            guidance_scale: {
                type: 'number',
                default: 0,
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 1,
                maximum: 100,
            },
            num_inference_steps: {
                type: 'integer',
                default: 4,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/wan-2.2-image',
        replicateId: 'prunaai/wan-2.2-image',
        puterId: 'replicate:prunaai/wan-2.2-image',
        name: 'wan 2.2 image',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/wan-2.2-image#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            juiced: {
                type: 'boolean',
                default: false,
            },
            prompt: {
                type: 'string',
            },
            megapixels: {
                type: 'integer',
                enum: [1, 2],
                default: 2,
            },
            aspect_ratio: {
                type: 'string',
                enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
                default: '16:9',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'jpg',
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 1,
                maximum: 100,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'prunaai/z-image-turbo',
        replicateId: 'prunaai/z-image-turbo',
        puterId: 'replicate:prunaai/z-image-turbo',
        name: 'z image turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'output_mp',
        costs: {
            output_mp: 0.5,
            'output_mp:0.5': 0.25,
            'output_mp:1': 0.5,
            'output_mp:2': 1,
            'output_mp:3': 1.5,
            'output_mp:4': 2,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                when: {
                    megapixels: '0.5',
                },
                costs: {
                    output_mp: 0.25,
                },
            },
            {
                when: {
                    megapixels: '1',
                },
                costs: {
                    output_mp: 0.5,
                },
            },
            {
                when: {
                    megapixels: '2',
                },
                costs: {
                    output_mp: 1,
                },
            },
            {
                when: {
                    megapixels: '3',
                },
                costs: {
                    output_mp: 1.5,
                },
            },
            {
                when: {
                    megapixels: '4',
                },
                costs: {
                    output_mp: 2,
                },
            },
        ],
        priceSource: 'https://replicate.com/prunaai/z-image-turbo#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                default: 1024,
                minimum: 64,
                maximum: 2048,
            },
            height: {
                type: 'integer',
                default: 1024,
                minimum: 64,
                maximum: 2048,
            },
            prompt: {
                type: 'string',
            },
            go_fast: {
                type: 'boolean',
                default: false,
            },
            megapixels: {
                type: 'string',
                default: '1',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            aspect_ratio: {
                type: 'string',
            },
            model_version: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['png', 'jpg', 'webp'],
                default: 'jpg',
            },
            guidance_scale: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 20,
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            negative_prompt: {
                type: 'string',
            },
            safety_tolerance: {
                type: 'integer',
                default: 2,
                minimum: 1,
                maximum: 6,
            },
            num_inference_steps: {
                type: 'integer',
                default: 8,
                minimum: 1,
                maximum: 50,
            },
            enable_safety_checker: {
                type: 'boolean',
                default: false,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: true,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'quiverai/arrow-1.1-max',
        unavailableReason:
            'Replicate generation fails even with the minimal input schema.',
        replicateId: 'quiverai/arrow-1.1-max',
        puterId: 'replicate:quiverai/arrow-1.1-max',
        name: 'arrow 1.1 max',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 25,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 25,
                },
            },
        ],
        priceSource: 'https://replicate.com/quiverai/arrow-1.1-max#pricing',
        inputSchema: {
            top_p: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            prompt: {
                type: 'string',
            },
            references: {
                type: 'array',
                default: [],
            },
            temperature: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 2,
            },
            instructions: {
                type: 'string',
                default: '',
            },
            presence_penalty: {
                type: 'number',
                default: 0,
                minimum: -2,
                maximum: 2,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'quiverai/arrow-1.1',
        unavailableReason:
            'Replicate generation fails even with the minimal input schema.',
        replicateId: 'quiverai/arrow-1.1',
        puterId: 'replicate:quiverai/arrow-1.1',
        name: 'arrow 1.1',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 20,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 20,
                },
            },
        ],
        priceSource: 'https://replicate.com/quiverai/arrow-1.1#pricing',
        inputSchema: {
            top_p: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            prompt: {
                type: 'string',
            },
            references: {
                type: 'array',
                maxItems: 4,
                default: [],
            },
            temperature: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 2,
            },
            instructions: {
                type: 'string',
                default: '',
            },
            presence_penalty: {
                type: 'number',
                default: 0,
                minimum: -2,
                maximum: 2,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'qwen/qwen-image',
        replicateId: 'qwen/qwen-image',
        puterId: 'replicate:qwen/qwen-image',
        name: 'qwen image',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2.5,
                },
            },
        ],
        priceSource: 'https://replicate.com/qwen/qwen-image#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            go_fast: {
                type: 'boolean',
                default: true,
            },
            guidance: {
                type: 'number',
                default: 3,
                minimum: 0,
                maximum: 10,
            },
            strength: {
                type: 'number',
                default: 0.9,
                minimum: 0,
                maximum: 1,
            },
            image_size: {
                type: 'string',
                enum: ['optimize_for_quality', 'optimize_for_speed'],
                default: 'optimize_for_quality',
            },
            lora_scale: {
                type: 'number',
                default: 1,
            },
            aspect_ratio: {
                type: 'string',
                enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
                default: '16:9',
            },
            lora_weights: {
                type: 'string',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            enhance_prompt: {
                type: 'boolean',
                default: false,
            },
            output_quality: {
                type: 'integer',
                default: 80,
                minimum: 0,
                maximum: 100,
            },
            negative_prompt: {
                type: 'string',
                default: ' ',
            },
            extra_lora_scale: {
                type: 'array',
            },
            replicate_weights: {
                type: 'string',
            },
            extra_lora_weights: {
                type: 'array',
            },
            num_inference_steps: {
                type: 'integer',
                default: 30,
                minimum: 1,
                maximum: 50,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'recraft-ai/recraft-v3-svg',
        replicateId: 'recraft-ai/recraft-v3-svg',
        puterId: 'replicate:recraft-ai/recraft-v3-svg',
        name: 'recraft v3 svg',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 8,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 8,
                },
            },
        ],
        priceSource: 'https://replicate.com/recraft-ai/recraft-v3-svg#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: [
                    '1024x1024',
                    '1365x1024',
                    '1024x1365',
                    '1536x1024',
                    '1024x1536',
                    '1820x1024',
                    '1024x1820',
                    '1024x2048',
                    '2048x1024',
                    '1434x1024',
                    '1024x1434',
                    '1024x1280',
                    '1280x1024',
                    '1024x1707',
                    '1707x1024',
                ],
                default: '1024x1024',
            },
            style: {
                type: 'string',
                enum: [
                    'any',
                    'engraving',
                    'line_art',
                    'line_circuit',
                    'linocut',
                ],
                default: 'any',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'Not set',
                    '1:1',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:9',
                    '9:16',
                    '1:2',
                    '2:1',
                    '7:5',
                    '5:7',
                    '4:5',
                    '5:4',
                    '3:5',
                    '5:3',
                ],
                default: 'Not set',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'recraft-ai/recraft-v3',
        replicateId: 'recraft-ai/recraft-v3',
        puterId: 'replicate:recraft-ai/recraft-v3',
        name: 'recraft v3',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource: 'https://replicate.com/recraft-ai/recraft-v3#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: [
                    '1024x1024',
                    '1365x1024',
                    '1024x1365',
                    '1536x1024',
                    '1024x1536',
                    '1820x1024',
                    '1024x1820',
                    '1024x2048',
                    '2048x1024',
                    '1434x1024',
                    '1024x1434',
                    '1024x1280',
                    '1280x1024',
                    '1024x1707',
                    '1707x1024',
                ],
                default: '1024x1024',
            },
            style: {
                type: 'string',
                enum: [
                    'any',
                    'realistic_image',
                    'digital_illustration',
                    'digital_illustration/pixel_art',
                    'digital_illustration/hand_drawn',
                    'digital_illustration/grain',
                    'digital_illustration/infantile_sketch',
                    'digital_illustration/2d_art_poster',
                    'digital_illustration/handmade_3d',
                    'digital_illustration/hand_drawn_outline',
                    'digital_illustration/engraving_color',
                    'digital_illustration/2d_art_poster_2',
                    'realistic_image/b_and_w',
                    'realistic_image/hard_flash',
                    'realistic_image/hdr',
                    'realistic_image/natural_light',
                    'realistic_image/studio_portrait',
                    'realistic_image/enterprise',
                    'realistic_image/motion_blur',
                ],
                default: 'any',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'Not set',
                    '1:1',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:9',
                    '9:16',
                    '1:2',
                    '2:1',
                    '7:5',
                    '5:7',
                    '4:5',
                    '5:4',
                    '3:5',
                    '5:3',
                ],
                default: 'Not set',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'recraft-ai/recraft-v4-pro-svg',
        replicateId: 'recraft-ai/recraft-v4-pro-svg',
        puterId: 'replicate:recraft-ai/recraft-v4-pro-svg',
        name: 'recraft v4 pro svg',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 30,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 30,
                },
            },
        ],
        priceSource:
            'https://replicate.com/recraft-ai/recraft-v4-pro-svg#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: [
                    '2048x2048',
                    '3072x1536',
                    '1536x3072',
                    '2560x1664',
                    '1664x2560',
                    '2432x1792',
                    '1792x2432',
                    '2304x1792',
                    '1792x2304',
                    '1664x2688',
                    '2560x1792',
                    '1792x2560',
                    '2688x1536',
                    '1536x2688',
                ],
                default: '2048x2048',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'Not set',
                    '1:1',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:9',
                    '9:16',
                    '1:2',
                    '2:1',
                    '4:5',
                    '5:4',
                    '6:10',
                    '14:10',
                    '10:14',
                ],
                default: 'Not set',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'recraft-ai/recraft-v4-pro',
        replicateId: 'recraft-ai/recraft-v4-pro',
        puterId: 'replicate:recraft-ai/recraft-v4-pro',
        name: 'recraft v4 pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 25,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 25,
                },
            },
        ],
        priceSource: 'https://replicate.com/recraft-ai/recraft-v4-pro#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: [
                    '2048x2048',
                    '3072x1536',
                    '1536x3072',
                    '2560x1664',
                    '1664x2560',
                    '2432x1792',
                    '1792x2432',
                    '2304x1792',
                    '1792x2304',
                    '1664x2688',
                    '2560x1792',
                    '1792x2560',
                    '2688x1536',
                    '1536x2688',
                ],
                default: '2048x2048',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'Not set',
                    '1:1',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:9',
                    '9:16',
                    '1:2',
                    '2:1',
                    '4:5',
                    '5:4',
                    '6:10',
                    '14:10',
                    '10:14',
                ],
                default: 'Not set',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'recraft-ai/recraft-v4-styles-pro-svg',
        replicateId: 'recraft-ai/recraft-v4-styles-pro-svg',
        puterId: 'replicate:recraft-ai/recraft-v4-styles-pro-svg',
        name: 'recraft v4 styles pro svg',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 12,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 12,
                },
            },
        ],
        priceSource:
            'https://replicate.com/recraft-ai/recraft-v4-styles-pro-svg#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: [
                    '2048x2048',
                    '3072x1536',
                    '1536x3072',
                    '2560x1664',
                    '1664x2560',
                    '2432x1792',
                    '1792x2432',
                    '2304x1792',
                    '1792x2304',
                    '1664x2688',
                    '2560x1792',
                    '1792x2560',
                    '2688x1536',
                    '1536x2688',
                ],
                default: '2048x2048',
            },
            prompt: {
                type: 'string',
            },
            style_id: {
                type: 'string',
                default: '',
            },
            style_match: {
                type: 'string',
                enum: ['precise', 'flexible'],
                default: 'precise',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'Not set',
                    '1:1',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:9',
                    '9:16',
                    '1:2',
                    '2:1',
                    '4:5',
                    '5:4',
                    '6:10',
                    '14:10',
                    '10:14',
                ],
                default: 'Not set',
            },
            style_reference_images: {
                type: 'array',
            },
        },
        requiredInputs: ['prompt', 'style_reference_images'],
    },
    {
        id: 'recraft-ai/recraft-v4-svg',
        replicateId: 'recraft-ai/recraft-v4-svg',
        puterId: 'replicate:recraft-ai/recraft-v4-svg',
        name: 'recraft v4 svg',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 8,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 8,
                },
            },
        ],
        priceSource: 'https://replicate.com/recraft-ai/recraft-v4-svg#pricing',
        inputSchema: {
            size: {
                type: 'string',
                enum: [
                    '1024x1024',
                    '1536x768',
                    '768x1536',
                    '1280x832',
                    '832x1280',
                    '1216x896',
                    '896x1216',
                    '1152x896',
                    '896x1152',
                    '832x1344',
                    '1280x896',
                    '896x1280',
                    '1344x768',
                    '768x1344',
                ],
                default: '1024x1024',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'Not set',
                    '1:1',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '16:9',
                    '9:16',
                    '1:2',
                    '2:1',
                    '14:10',
                    '10:14',
                    '4:5',
                    '5:4',
                    '6:10',
                ],
                default: 'Not set',
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'sdxl-based/realvisxl-v3-multi-controlnet-lora',
        replicateId: 'sdxl-based/realvisxl-v3-multi-controlnet-lora',
        puterId: 'replicate:sdxl-based/realvisxl-v3-multi-controlnet-lora',
        name: 'realvisxl v3 multi controlnet lora',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource:
            'https://replicate.com/sdxl-based/realvisxl-v3-multi-controlnet-lora#pricing',
        replicateVersion:
            '90a4a3604cd637cb9f1a2bdae1cfa9ed869362ca028814cdce310a78e27daade',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 768,
            },
            height: {
                type: 'integer',
                default: 768,
            },
            prompt: {
                type: 'string',
            },
            refine: {
                type: 'string',
                enum: ['no_refiner', 'base_image_refiner'],
                default: 'no_refiner',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            lora_scale: {
                type: 'number',
                default: 0.6,
                minimum: 0,
                maximum: 1,
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            controlnet_1: {
                type: 'string',
                enum: [
                    'none',
                    'edge_canny',
                    'illusion',
                    'depth_leres',
                    'depth_midas',
                    'soft_edge_pidi',
                    'soft_edge_hed',
                    'lineart',
                    'lineart_anime',
                    'openpose',
                ],
                default: 'none',
            },
            controlnet_2: {
                type: 'string',
                enum: [
                    'none',
                    'edge_canny',
                    'illusion',
                    'depth_leres',
                    'depth_midas',
                    'soft_edge_pidi',
                    'soft_edge_hed',
                    'lineart',
                    'lineart_anime',
                    'openpose',
                ],
                default: 'none',
            },
            controlnet_3: {
                type: 'string',
                enum: [
                    'none',
                    'edge_canny',
                    'illusion',
                    'depth_leres',
                    'depth_midas',
                    'soft_edge_pidi',
                    'soft_edge_hed',
                    'lineart',
                    'lineart_anime',
                    'openpose',
                ],
                default: 'none',
            },
            lora_weights: {
                type: 'string',
            },
            refine_steps: {
                type: 'integer',
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: false,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            sizing_strategy: {
                type: 'string',
                enum: [
                    'width_height',
                    'input_image',
                    'controlnet_1_image',
                    'controlnet_2_image',
                    'controlnet_3_image',
                    'mask_image',
                ],
                default: 'width_height',
            },
            controlnet_1_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            controlnet_2_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            controlnet_3_end: {
                type: 'number',
                default: 1,
                minimum: 0,
                maximum: 1,
            },
            controlnet_1_image: {
                type: 'string',
            },
            controlnet_1_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            controlnet_2_image: {
                type: 'string',
            },
            controlnet_2_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            controlnet_3_image: {
                type: 'string',
            },
            controlnet_3_start: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 1,
            },
            num_inference_steps: {
                type: 'integer',
                default: 30,
                minimum: 1,
                maximum: 500,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
            controlnet_1_conditioning_scale: {
                type: 'number',
                default: 0.75,
                minimum: 0,
                maximum: 4,
            },
            controlnet_2_conditioning_scale: {
                type: 'number',
                default: 0.75,
                minimum: 0,
                maximum: 4,
            },
            controlnet_3_conditioning_scale: {
                type: 'number',
                default: 0.75,
                minimum: 0,
                maximum: 4,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'sourceful/riverflow-2.0-pro',
        replicateId: 'sourceful/riverflow-2.0-pro',
        puterId: 'replicate:sourceful/riverflow-2.0-pro',
        name: 'riverflow 2.0 pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 15,
            font: 3,
            'output:1K': 15,
            'font:1K': 3,
            'output:2K': 15,
            'font:2K': 3,
            'output:4K': 33,
            'font:4K': 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                when: {
                    resolution: '1K',
                },
                costs: {
                    output: 15,
                    font: 3,
                },
            },
            {
                when: {
                    resolution: '2K',
                },
                costs: {
                    output: 15,
                    font: 3,
                },
            },
            {
                when: {
                    resolution: '4K',
                },
                costs: {
                    output: 33,
                    font: 3,
                },
            },
        ],
        priceSource:
            'https://replicate.com/sourceful/riverflow-2.0-pro#pricing',
        inputSchema: {
            font_urls: {
                type: 'array',
                maxItems: 2,
            },
            font_texts: {
                type: 'array',
            },
            resolution: {
                type: 'string',
                enum: ['1K', '2K', '4K'],
                default: '1K',
            },
            init_images: {
                type: 'array',
            },
            instruction: {
                type: 'string',
                minLength: 2,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    'auto',
                    '21:9',
                    '16:9',
                    '3:2',
                    '4:3',
                    '5:4',
                    '1:1',
                    '4:5',
                    '3:4',
                    '2:3',
                    '9:16',
                ],
                default: 'auto',
            },
            transparency: {
                type: 'boolean',
                default: false,
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'png'],
                default: 'webp',
            },
            enhance_prompt: {
                type: 'boolean',
                default: false,
            },
            max_iterations: {
                type: 'integer',
                default: 3,
                minimum: 1,
                maximum: 3,
            },
            safety_checker: {
                type: 'boolean',
                default: true,
            },
            super_resolution_refs: {
                type: 'array',
            },
        },
        requiredInputs: ['instruction'],
        promptKey: 'instruction',
    },
    {
        id: 'stability-ai/sdxl',
        replicateId: 'stability-ai/sdxl',
        puterId: 'replicate:stability-ai/sdxl',
        name: 'sdxl',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.0975,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.0975,
                },
            },
        ],
        priceSource: 'https://replicate.com/stability-ai/sdxl#pricing',
        replicateVersion:
            '7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            width: {
                type: 'integer',
                default: 1024,
            },
            height: {
                type: 'integer',
                default: 1024,
            },
            prompt: {
                type: 'string',
            },
            refine: {
                type: 'string',
                enum: [
                    'no_refiner',
                    'expert_ensemble_refiner',
                    'base_image_refiner',
                ],
                default: 'no_refiner',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'DPMSolverMultistep',
                    'HeunDiscrete',
                    'KarrasDPM',
                    'K_EULER_ANCESTRAL',
                    'K_EULER',
                    'PNDM',
                ],
                default: 'K_EULER',
            },
            lora_scale: {
                type: 'number',
                default: 0.6,
                minimum: 0,
                maximum: 1,
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            refine_steps: {
                type: 'integer',
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 50,
            },
            apply_watermark: {
                type: 'boolean',
                default: true,
            },
            high_noise_frac: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            negative_prompt: {
                type: 'string',
                default: '',
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
                minimum: 0,
                maximum: 1,
            },
            replicate_weights: {
                type: 'string',
            },
            num_inference_steps: {
                type: 'integer',
                default: 50,
                minimum: 1,
                maximum: 500,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'stability-ai/stable-diffusion-3.5-large-turbo',
        replicateId: 'stability-ai/stable-diffusion-3.5-large-turbo',
        puterId: 'replicate:stability-ai/stable-diffusion-3.5-large-turbo',
        name: 'stable diffusion 3.5 large turbo',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 4,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 4,
                },
            },
        ],
        priceSource:
            'https://replicate.com/stability-ai/stable-diffusion-3.5-large-turbo#pricing',
        inputSchema: {
            cfg: {
                type: 'number',
                default: 1,
                minimum: 1,
                maximum: 10,
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '16:9',
                    '1:1',
                    '21:9',
                    '2:3',
                    '3:2',
                    '4:5',
                    '5:4',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            negative_prompt: {
                type: 'string',
            },
            prompt_strength: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'stability-ai/stable-diffusion-3.5-large',
        replicateId: 'stability-ai/stable-diffusion-3.5-large',
        puterId: 'replicate:stability-ai/stable-diffusion-3.5-large',
        name: 'stable diffusion 3.5 large',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 6.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 6.5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/stability-ai/stable-diffusion-3.5-large#pricing',
        inputSchema: {
            cfg: {
                type: 'number',
                default: 5,
                minimum: 1,
                maximum: 10,
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '16:9',
                    '1:1',
                    '21:9',
                    '2:3',
                    '3:2',
                    '4:5',
                    '5:4',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            negative_prompt: {
                type: 'string',
            },
            prompt_strength: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'stability-ai/stable-diffusion-3.5-medium',
        replicateId: 'stability-ai/stable-diffusion-3.5-medium',
        puterId: 'replicate:stability-ai/stable-diffusion-3.5-medium',
        name: 'stable diffusion 3.5 medium',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3.5,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3.5,
                },
            },
        ],
        priceSource:
            'https://replicate.com/stability-ai/stable-diffusion-3.5-medium#pricing',
        inputSchema: {
            cfg: {
                type: 'number',
                default: 5,
                minimum: 1,
                maximum: 10,
            },
            seed: {
                type: 'integer',
            },
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '16:9',
                    '1:1',
                    '21:9',
                    '2:3',
                    '3:2',
                    '4:5',
                    '5:4',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            negative_prompt: {
                type: 'string',
            },
            prompt_strength: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'stability-ai/stable-diffusion',
        replicateId: 'stability-ai/stable-diffusion',
        puterId: 'replicate:stability-ai/stable-diffusion',
        name: 'stable diffusion',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource:
            'https://replicate.com/stability-ai/stable-diffusion#pricing',
        replicateVersion:
            'ac732df83cea7fff18b8472768c88ad041fa750ff7682a21affe81863cbe77e4',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                enum: [
                    64, 128, 192, 256, 320, 384, 448, 512, 576, 640, 704, 768,
                    832, 896, 960, 1024,
                ],
                default: 768,
            },
            height: {
                type: 'integer',
                enum: [
                    64, 128, 192, 256, 320, 384, 448, 512, 576, 640, 704, 768,
                    832, 896, 960, 1024,
                ],
                default: 768,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: [
                    'DDIM',
                    'K_EULER',
                    'DPMSolverMultistep',
                    'K_EULER_ANCESTRAL',
                    'PNDM',
                    'KLMS',
                ],
                default: 'DPMSolverMultistep',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 20,
            },
            negative_prompt: {
                type: 'string',
            },
            num_inference_steps: {
                type: 'integer',
                default: 50,
                minimum: 1,
                maximum: 500,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'tencent/hunyuan-image-3',
        replicateId: 'tencent/hunyuan-image-3',
        puterId: 'replicate:tencent/hunyuan-image-3',
        name: 'hunyuan image 3',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 8,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 8,
                },
            },
        ],
        priceSource: 'https://replicate.com/tencent/hunyuan-image-3#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            prompt: {
                type: 'string',
            },
            go_fast: {
                type: 'boolean',
                default: true,
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '21:9',
                    '3:2',
                    '2:3',
                    '4:5',
                    '5:4',
                    '3:4',
                    '4:3',
                    '9:16',
                    '9:21',
                ],
                default: '1:1',
            },
            output_format: {
                type: 'string',
                enum: ['webp', 'jpg', 'png'],
                default: 'webp',
            },
            output_quality: {
                type: 'integer',
                default: 95,
                minimum: 0,
                maximum: 100,
            },
            disable_safety_checker: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'tstramer/material-diffusion',
        replicateId: 'tstramer/material-diffusion',
        puterId: 'replicate:tstramer/material-diffusion',
        name: 'material diffusion',
        costs_currency: 'usd-cents',
        index_cost_key: 'second',
        costs: {
            second: 0.14,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    second: 0.14,
                },
            },
        ],
        priceSource:
            'https://replicate.com/tstramer/material-diffusion#pricing',
        replicateVersion:
            'a42692c54c0f407f803a0a8a9066160976baedb77c91171a01730f9b0d7beeff',
        inputSchema: {
            mask: {
                type: 'string',
            },
            seed: {
                type: 'integer',
            },
            width: {
                type: 'integer',
                enum: [
                    128, 256, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960,
                    1024,
                ],
                default: 512,
            },
            height: {
                type: 'integer',
                enum: [
                    128, 256, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960,
                    1024,
                ],
                default: 512,
            },
            prompt: {
                type: 'string',
            },
            scheduler: {
                type: 'string',
                enum: ['DDIM', 'K-LMS', 'PNDM'],
                default: 'K-LMS',
            },
            init_image: {
                type: 'string',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 10,
            },
            guidance_scale: {
                type: 'number',
                default: 7.5,
                minimum: 1,
                maximum: 20,
            },
            prompt_strength: {
                type: 'number',
                default: 0.8,
            },
            num_inference_steps: {
                type: 'integer',
                default: 50,
                minimum: 1,
                maximum: 500,
            },
        },
        requiredInputs: [],
    },
    {
        id: 'wan-video/wan-2.7-image-pro',
        replicateId: 'wan-video/wan-2.7-image-pro',
        puterId: 'replicate:wan-video/wan-2.7-image-pro',
        name: 'wan 2.7 image pro',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3,
                },
            },
        ],
        priceSource:
            'https://replicate.com/wan-video/wan-2.7-image-pro#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            size: {
                type: 'string',
                enum: [
                    '1K',
                    '2K',
                    '4K',
                    '1024*1024',
                    '2048*2048',
                    '4096*4096',
                    '1280*720',
                    '720*1280',
                    '2048*1152',
                    '1152*2048',
                    '4096*2304',
                    '2304*4096',
                    '1024*768',
                    '768*1024',
                    '2048*1536',
                    '1536*2048',
                    '4096*3072',
                    '3072*4096',
                ],
                default: '2K',
            },
            images: {
                type: 'array',
                default: [],
            },
            prompt: {
                type: 'string',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            thinking_mode: {
                type: 'boolean',
                default: true,
            },
            image_set_mode: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'wan-video/wan-2.7-image',
        replicateId: 'wan-video/wan-2.7-image',
        puterId: 'replicate:wan-video/wan-2.7-image',
        name: 'wan 2.7 image',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 3,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 3,
                },
            },
        ],
        priceSource: 'https://replicate.com/wan-video/wan-2.7-image#pricing',
        inputSchema: {
            seed: {
                type: 'integer',
            },
            size: {
                type: 'string',
                enum: [
                    '1K',
                    '2K',
                    '1024*1024',
                    '2048*2048',
                    '1280*720',
                    '720*1280',
                    '2048*1152',
                    '1152*2048',
                    '1024*768',
                    '768*1024',
                    '2048*1536',
                    '1536*2048',
                ],
                default: '2K',
            },
            images: {
                type: 'array',
                default: [],
            },
            prompt: {
                type: 'string',
            },
            num_outputs: {
                type: 'integer',
                default: 1,
                minimum: 1,
                maximum: 4,
            },
            thinking_mode: {
                type: 'boolean',
                default: true,
            },
            image_set_mode: {
                type: 'boolean',
                default: false,
            },
        },
        requiredInputs: ['prompt'],
    },
    {
        id: 'xai/grok-imagine-image',
        replicateId: 'xai/grok-imagine-image',
        puterId: 'replicate:xai/grok-imagine-image',
        name: 'grok imagine image',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 2,
        },
        billingScheme: 'metered',
        billingRates: [
            {
                costs: {
                    output: 2,
                },
            },
        ],
        priceSource: 'https://replicate.com/xai/grok-imagine-image#pricing',
        inputSchema: {
            image: {
                type: 'string',
            },
            prompt: {
                type: 'string',
            },
            aspect_ratio: {
                type: 'string',
                enum: [
                    '1:1',
                    '16:9',
                    '9:16',
                    '4:3',
                    '3:4',
                    '3:2',
                    '2:3',
                    '2:1',
                    '1:2',
                    '19.5:9',
                    '9:19.5',
                    '20:9',
                    '9:20',
                    'auto',
                ],
                default: '1:1',
            },
        },
        requiredInputs: ['prompt'],
    },
];
