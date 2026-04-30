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

export interface IGeminiImageModel extends IImageModel {
    apiType?: 'generateContent' | 'generateImages';
}

export const GEMINI_DEFAULT_RATIO = { w: 1024, h: 1024 };

// Estimated image output token counts for pre-flight cost checks.
// These are based on Google's published pricing equivalences.
// https://ai.google.dev/gemini-api/docs/image-generation#aspect_ratios_and_image_size
export const GEMINI_ESTIMATED_IMAGE_TOKENS: Record<string, number> = {
    'gemini-2.5-flash-image': 1290,

    'gemini-3-pro-image-preview:1K': 1120,
    'gemini-3-pro-image-preview:2K': 1120,
    'gemini-3-pro-image-preview:4K': 2000,

    'gemini-3.1-flash-image-preview:512': 747,
    'gemini-3.1-flash-image-preview:1K': 1120,
    'gemini-3.1-flash-image-preview:2K': 1680,
    'gemini-3.1-flash-image-preview:4K': 2520,
};

export const GEMINI_IMAGE_GENERATION_MODELS: IGeminiImageModel[] = [
    {
        puterId: 'google:google/gemini-2.5-flash-image',
        id: 'gemini-2.5-flash-image',
        aliases: [
            'gemini-2.5-flash-image-preview',
            'gemini-2.5-flash-image',
            'google/gemini-2.5-flash-image-preview',
            'google/gemini-2.5-flash-image',
            'google:google/gemini-2.5-flash-image-preview',
        ],

        name: 'Gemini 2.5 Flash Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1x1',
        index_input_cost_key: 'input',
        allowedQualityLevels: [''],
        costs: {
            input: 30, // $0.30 per 1M input tokens (text/image)
            output: 250, // $2.50 per 1M output tokens (text and thinking)
            output_image: 3000, // $30.00 per 1M output image tokens
            '1x1': 3.9,
        },
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
    },
    {
        puterId: 'google:google/gemini-3-pro-image-preview',
        id: 'gemini-3-pro-image-preview',
        name: 'Gemini 3 Pro Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        index_input_cost_key: 'input',
        aliases: [
            'gemini-3-pro-image-preview',
            'gemini-3-pro-image',
            'google/gemini-3-pro-image-preview',
            'google/gemini-3-pro-image',
            'google:google/gemini-3-pro-image-preview',
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
    {
        puterId: 'google:google/gemini-3.1-flash-image-preview',
        id: 'gemini-3.1-flash-image-preview',
        name: 'Gemini 3.1 Flash Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        index_input_cost_key: 'input',
        aliases: [
            'gemini-3.1-flash-image-preview',
            'gemini-3.1-flash-image',
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
            input: 25, // $0.25 per 1M input tokens (text/image)
            output: 150, // $1.50 per 1M output tokens (text and thinking)
            output_image: 6000, // $60.00 per 1M output image tokens
            '1K:1x1': 6.7,
        },
    },

    // -- Imagen models (use generateImages API) --
    {
        puterId: 'google:google/imagen-4.0-fast',
        id: 'imagen-4.0-fast-generate-001',
        apiType: 'generateImages',
        name: 'Imagen 4.0 Fast',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'per-image',
        aliases: [
            'imagen-4.0-fast',
            'google/imagen-4.0-fast',
            'google:google/imagen-4.0-fast',
        ],
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 3, h: 4 },
            { w: 4, h: 3 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
        ],
        costs: {
            'per-image': 2, // $0.02 per image
        },
    },
    {
        puterId: 'google:google/imagen-4.0',
        id: 'imagen-4.0-generate-001',
        apiType: 'generateImages',
        name: 'Imagen 4.0',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'per-image',
        aliases: [
            'imagen-4.0',
            'google/imagen-4.0',
            'google:google/imagen-4.0',
        ],
        allowedQualityLevels: ['1K', '2K'],
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 3, h: 4 },
            { w: 4, h: 3 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
        ],
        costs: {
            'per-image': 4, // $0.04 per image
        },
    },
    {
        puterId: 'google:google/imagen-4.0-ultra',
        id: 'imagen-4.0-ultra-generate-001',
        apiType: 'generateImages',
        name: 'Imagen 4.0 Ultra',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'per-image',
        aliases: [
            'imagen-4.0-ultra',
            'google/imagen-4.0-ultra',
            'google:google/imagen-4.0-ultra',
        ],
        allowedQualityLevels: ['1K', '2K'],
        allowedRatios: [
            { w: 1, h: 1 },
            { w: 3, h: 4 },
            { w: 4, h: 3 },
            { w: 9, h: 16 },
            { w: 16, h: 9 },
        ],
        costs: {
            'per-image': 6, // $0.06 per image
        },
    },
];
