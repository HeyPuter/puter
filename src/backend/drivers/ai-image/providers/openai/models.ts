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

export const OPEN_AI_IMAGE_GENERATION_MODELS: IImageModel[] = [
    {
        puterId: 'openai:openai/gpt-image-2.5-sunburst',
        id: 'gpt-image-2.5-sunburst',
        aliases: [
            'openai/gpt-image-2.5-sunburst',
            'gpt-image-2.5-sunburst-2026-09-08',
        ],
        name: 'GPT Image 2.5 Sunburst',
        version: '2.5',
        costs_currency: 'usd-cents',
        index_cost_key: 'low:1024x1024',
        costs: {
            // Text tokens (per 1M tokens)
            text_input: 500, // $5.00
            text_cached_input: 125, // $1.25
            // Image tokens (per 1M tokens)
            image_input: 800, // $8.00
            image_cached_input: 200, // $2.00
            image_output: 3000, // $30.00
            'low:1024x1024': 0.588,
        },
        allowedQualityLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
    },
    {
        puterId: 'openai:openai/gpt-image-2.5-flare',
        id: 'gpt-image-2.5-flare',
        aliases: [
            'openai/gpt-image-2.5-flare',
            'gpt-image-2.5-flare-2026-09-08',
        ],
        name: 'GPT Image 2.5 Flare',
        version: '2.5',
        costs_currency: 'usd-cents',
        index_cost_key: 'low:1024x1024',
        costs: {
            // Text tokens (per 1M tokens)
            text_input: 500, // $5.00
            text_cached_input: 125, // $1.25
            // Image tokens (per 1M tokens)
            image_input: 800, // $8.00
            image_cached_input: 200, // $2.00
            image_output: 3000, // $30.00
            'low:1024x1024': 0.588,
        },
        allowedQualityLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
    },
    {
        puterId: 'openai:openai/gpt-image-2',
        id: 'gpt-image-2',
        aliases: ['openai/gpt-image-2', 'gpt-image-2-2026-04-21'],
        name: 'GPT Image 2',
        version: '2.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'low:1024x1024',
        costs: {
            // Text tokens (per 1M tokens)
            text_input: 500, // $5.00
            text_cached_input: 125, // $1.25
            text_output: 1000, // $10.00
            // Image tokens (per 1M tokens)
            image_input: 800, // $8.00
            image_cached_input: 200, // $2.00
            image_output: 3000, // $30.00
            'low:1024x1024': 0.588,
        },
        allowedQualityLevels: ['low', 'medium', 'high', 'auto'],
    },
];
