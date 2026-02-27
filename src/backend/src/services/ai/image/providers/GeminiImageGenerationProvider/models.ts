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

export const GEMINI_DEFAULT_RATIO = { w: 1024, h: 1024 };

// Estimated image output token counts for pre-flight cost checks.
// These are based on Google's published pricing equivalences.
export const GEMINI_ESTIMATED_IMAGE_TOKENS: Record<string, number> = {
    // Flash: all output images up to 1024x1024 consume 1290 tokens
    'gemini-2.5-flash-image': 1290,
    // 3 Pro 1K/2K: output images from 1024x1024 to 2048x2048 consume 1120 tokens
    'gemini-3-pro-image-preview:1K': 1120,
    'gemini-3-pro-image-preview:2K': 1120,
    // 3 Pro 4K: output images up to 4096x4096 consume 2000 tokens
    'gemini-3-pro-image-preview:4K': 2000,
};

export const GEMINI_IMAGE_GENERATION_MODELS: IImageModel[] = [
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
        index_cost_key: 'output_image',
        index_input_cost_key: 'input',
        allowedQualityLevels: [''],
        costs: {
            input: 30, // $0.30 per 1M input tokens (text/image)
            output: 15, // $0.15 per 1M output text tokens (same as 2.5 Flash text)
            output_image: 3000, // $30.00 per 1M output image tokens
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
        index_cost_key: 'output_image',
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
        },
    },
    {
        puterId: 'google:google/gemini-3.1-flash-image-preview',
        id: 'gemini-3.1-flash-image-preview',
        name: 'Gemini 3.1 Flash Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1K:1x1',
        aliases: [
            'gemini-3.1-flash-image-preview',
            'gemini-3.1-flash-image',
            'google/gemini-3.1-flash-image-preview',
            'google/gemini-3.1-flash-image',
            'google:google/gemini-3.1-flash-image-preview',
        ],
        allowedQualityLevels: ['0.5K', '1K', '2K', '4K'],
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
            input: 25, // $0.25 per 1M input tokens, however google counts them
            output: 150, // $1.50 per 1M output tokens, however google counts them
            '0.5K:1x1': 4.5, // $0.045 per image
            '0.5K:1x4': 4.5, // $0.045 per image
            '0.5K:1x8': 4.5, // $0.045 per image
            '0.5K:2x3': 4.5, // $0.045 per image
            '0.5K:3x2': 4.5, // $0.045 per image
            '0.5K:3x4': 4.5, // $0.045 per image
            '0.5K:4x1': 4.5, // $0.045 per image
            '0.5K:4x3': 4.5, // $0.045 per image
            '0.5K:4x5': 4.5, // $0.045 per image
            '0.5K:5x4': 4.5, // $0.045 per image
            '0.5K:8x1': 4.5, // $0.045 per image
            '0.5K:9x16': 4.5, // $0.045 per image
            '0.5K:16x9': 4.5, // $0.045 per image
            '0.5K:21x9': 4.5, // $0.045 per image
            '1K:1x1': 6.7, // $0.067 per image
            '1K:1x4': 6.7, // $0.067 per image
            '1K:1x8': 6.7, // $0.067 per image
            '1K:2x3': 6.7, // $0.067 per image
            '1K:3x2': 6.7, // $0.067 per image
            '1K:3x4': 6.7, // $0.067 per image
            '1K:4x1': 6.7, // $0.067 per image
            '1K:4x3': 6.7, // $0.067 per image
            '1K:4x5': 6.7, // $0.067 per image
            '1K:5x4': 6.7, // $0.067 per image
            '1K:8x1': 6.7, // $0.067 per image
            '1K:9x16': 6.7, // $0.067 per image
            '1K:16x9': 6.7, // $0.067 per image
            '1K:21x9': 6.7, // $0.067 per image
            '2K:1x1': 10.1, // $0.101 per image
            '2K:1x4': 10.1, // $0.101 per image
            '2K:1x8': 10.1, // $0.101 per image
            '2K:2x3': 10.1, // $0.101 per image
            '2K:3x2': 10.1, // $0.101 per image
            '2K:3x4': 10.1, // $0.101 per image
            '2K:4x1': 10.1, // $0.101 per image
            '2K:4x3': 10.1, // $0.101 per image
            '2K:4x5': 10.1, // $0.101 per image
            '2K:5x4': 10.1, // $0.101 per image
            '2K:8x1': 10.1, // $0.101 per image
            '2K:9x16': 10.1, // $0.101 per image
            '2K:16x9': 10.1, // $0.101 per image
            '2K:21x9': 10.1, // $0.101 per image
            '4K:1x1': 15.1, // $0.151 per image
            '4K:1x4': 15.1, // $0.151 per image
            '4K:1x8': 15.1, // $0.151 per image
            '4K:2x3': 15.1, // $0.151 per image
            '4K:3x2': 15.1, // $0.151 per image
            '4K:3x4': 15.1, // $0.151 per image
            '4K:4x1': 15.1, // $0.151 per image
            '4K:4x3': 15.1, // $0.151 per image
            '4K:4x5': 15.1, // $0.151 per image
            '4K:5x4': 15.1, // $0.151 per image
            '4K:8x1': 15.1, // $0.151 per image
            '4K:9x16': 15.1, // $0.151 per image
            '4K:16x9': 15.1, // $0.151 per image
            '4K:21x9': 15.1, // $0.151 per image
        },
    },
];
