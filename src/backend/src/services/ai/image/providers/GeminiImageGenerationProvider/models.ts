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

export const GEMINI_IMAGE_GENERATION_MODELS: IImageModel[] = [
    {
        id: 'gemini-2.5-flash-image',
        aliases: ['gemini-2.5-flash-image-preview'],
        name: 'Gemini 2.5 Flash Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1024x1024',
        allowedQualityLevels: [''],
        costs: {
            '1x1': 3.9, // $0.039 per image
            '2x3': 3.9, // $0.039 per image
            '3x2': 3.9, // $0.039 per image
            '3x4': 3.9, // $0.039 per image
            '4x3': 3.9, // $0.039 per image
            '4x5': 3.9, // $0.039 per image
            '5x4': 3.9, // $0.039 per image
            '9x16': 3.9, // $0.039 per image
            '16x9': 3.9, // $0.039 per image
            '21x9': 3.9, // $0.039 per image
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
        id: 'gemini-3-pro-image',
        name: 'Gemini 3 Pro Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: '1024x1024',
        aliases: ['gemini-3-pro-image-preview'],
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
            '1K:1x1': 13.51, // $0.1351 per image
            '1K:2x3': 13.51, // $0.1351 per image
            '1K:3x2': 13.51, // $0.1351 per image
            '1K:3x4': 13.51, // $0.1351 per image
            '1K:4x3': 13.51, // $0.1351 per image
            '1K:4x5': 13.51, // $0.1351 per image
            '1K:5x4': 13.51, // $0.1351 per image
            '1K:9x16': 13.51, // $0.1351 per image
            '1K:16x9': 13.51, // $0.1351 per image
            '1K:21x9': 13.51, // $0.1351 per image
            '2K:1x1': 13.51, // $0.1351 per image
            '2K:2x3': 13.51, // $0.1351 per image
            '2K:3x2': 13.51, // $0.1351 per image
            '2K:3x4': 13.51, // $0.1351 per image
            '2K:4x3': 13.51, // $0.1351 per image
            '2K:4x5': 13.51, // $0.1351 per image
            '2K:5x4': 13.51, // $0.1351 per image
            '2K:9x16': 13.51, // $0.1351 per image
            '2K:16x9': 13.51, // $0.1351 per image
            '2K:21x9': 13.51, // $0.1351 per image
            '4K:1x1': 24.1, // $0.24 per image
            '4K:2x3': 24.1, // $0.24 per image
            '4K:3x2': 24.1, // $0.24 per image
            '4K:3x4': 24.1, // $0.24 per image
            '4K:4x3': 24.1, // $0.24 per image
            '4K:4x5': 24.1, // $0.24 per image
            '4K:5x4': 24.1, // $0.24 per image
            '4K:9x16': 24.1, // $0.24 per image
            '4K:16x9': 24.1, // $0.24 per image
            '4K:21x9': 24.1, // $0.24 per image
        },
    },
];
