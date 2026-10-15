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

export const GEMINI_DEFAULT_RATIO = { w: 1024, h: 1024 };

// Estimated image output token counts for pre-flight cost checks.
// These are based on Google's published pricing equivalences.
// https://ai.google.dev/gemini-api/docs/image-generation#aspect_ratios_and_image_size
// https://ai.google.dev/gemini-api/docs/pricing
export const GEMINI_ESTIMATED_IMAGE_TOKENS: Record<string, number> = {
    'gemini-nano-banana-2.1:1K': 1120,
    'gemini-nano-banana-2.1:2K': 1680,
    'gemini-nano-banana-2.1:4K': 3780,

    'gemini-3-pro-image:1K': 1120,
    'gemini-3-pro-image:2K': 1120,
    'gemini-3-pro-image:4K': 2000,

    'gemini-3.1-flash-image:512': 747,
    'gemini-3.1-flash-image:1K': 1120,
    'gemini-3.1-flash-image:2K': 1680,
    'gemini-3.1-flash-image:4K': 2520,

    'gemini-3.1-flash-lite-image:1K': 1120,
};

// Estimated text and thinking output tokens per image for pre-flight cost
// checks. Google bills these at the model's text output rate; samples taken
// 2026-10-11 ran 380-425 on 3.1 Flash, about 400 on 3.1 Flash Lite, 270 on
// 3 Pro, and 440-1122 on Nano Banana 2.1.
export const GEMINI_ESTIMATED_TEXT_OUTPUT_TOKENS: Record<string, number> = {
    'gemini-nano-banana-2.1': 1000,
    'gemini-3-pro-image': 300,
    'gemini-3.1-flash-image': 450,
    'gemini-3.1-flash-lite-image': 450,
};

export const GEMINI_IMAGE_GENERATION_MODELS: IImageModel[] = [
    {
        // Keep the existing provider default for callers that omit a model.
        puterId: 'google:google/gemini-3.1-flash-image',
        id: 'gemini-3.1-flash-image',
        name: 'Gemini 3.1 Flash Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        index_input_cost_key: 'input',
        aliases: [
            'gemini-3.1-flash-image-preview',
            'google/gemini-3.1-flash-image-preview',
            'google/gemini-3.1-flash-image',
            'google:google/gemini-3.1-flash-image-preview',
        ],
        allowedQualityLevels: ['512', '1K', '2K', '4K'],
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 1, h: 4 },
            { w: 1, h: 8 },
            { w: 2, h: 3 },
            { w: 3, h: 2 },
            { w: 3, h: 4 },
            { w: 4, h: 1 },
            { w: 4, h: 3 },
            { w: 4, h: 5 },
            { w: 5, h: 4 },
            { w: 8, h: 1 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
            { w: 21, h: 9 },
        ],
        costs: {
            input: 50, // $0.50 per 1M input tokens (text/image)
            output: 300, // $3.00 per 1M output tokens (text and thinking)
            output_image: 6000, // $60.00 per 1M output image tokens
            '1K:1x1': 6.7,
        },
    },
    {
        puterId: 'google:google/gemini-nano-banana-2.1',
        id: 'gemini-nano-banana-2.1',
        name: 'Gemini Nano Banana 2.1',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        index_input_cost_key: 'input',
        aliases: ['google/gemini-nano-banana-2.1', 'nano-banana-2.1'],
        allowedQualityLevels: ['1K', '2K', '4K'],
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 1, h: 4 },
            { w: 1, h: 8 },
            { w: 2, h: 3 },
            { w: 3, h: 2 },
            { w: 3, h: 4 },
            { w: 4, h: 1 },
            { w: 4, h: 3 },
            { w: 4, h: 5 },
            { w: 5, h: 4 },
            { w: 8, h: 1 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
            { w: 21, h: 9 },
        ],
        costs: {
            input: 150, // $1.50 per 1M input tokens (text/image)
            output: 750, // $7.50 per 1M output tokens (text and thinking)
            output_image: 3000, // $30.00 per 1M output image tokens
            '1K:1x1': 3.36,
        },
    },
    {
        puterId: 'google:google/gemini-3.1-flash-lite-image',
        id: 'gemini-3.1-flash-lite-image',
        name: 'Gemini 3.1 Flash Lite Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        index_input_cost_key: 'input',
        aliases: ['google/gemini-3.1-flash-lite-image'],
        allowedQualityLevels: ['1K'], // 2K and 4K are unsupported
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 2, h: 3 },
            { w: 3, h: 2 },
            { w: 3, h: 4 },
            { w: 4, h: 3 },
            { w: 4, h: 5 },
            { w: 5, h: 4 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
            { w: 21, h: 9 },
        ],
        costs: {
            input: 25, // $0.25 per 1M input tokens (text/image)
            output: 150, // $1.50 per 1M output tokens (text and thinking)
            output_image: 3000, // $30.00 per 1M output image tokens
            '1K:1x1': 3.36, // 1120 tokens @ $30/1M = $0.0336 per 1K image
        },
    },
    {
        puterId: 'google:google/gemini-3-pro-image',
        id: 'gemini-3-pro-image',
        name: 'Gemini 3 Pro Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        index_input_cost_key: 'input',
        aliases: [
            'gemini-3-pro-image-preview',
            'google/gemini-3-pro-image-preview',
            'google/gemini-3-pro-image',
            'google:google/gemini-3-pro-image-preview',
            'nano-banana-pro',
            'nano-banana-pro-preview',
        ],
        allowedQualityLevels: ['1K', '2K', '4K'],
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 2, h: 3 },
            { w: 3, h: 2 },
            { w: 3, h: 4 },
            { w: 4, h: 3 },
            { w: 4, h: 5 },
            { w: 5, h: 4 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
            { w: 21, h: 9 },
        ],
        costs: {
            input: 200, // $2.00 per 1M input tokens (text/image)
            output: 1200, // $12.00 per 1M output tokens (text and thinking)
            output_image: 12000, // $120.00 per 1M output image tokens
            '1K:1x1': 13.4,
        },
    },
];
