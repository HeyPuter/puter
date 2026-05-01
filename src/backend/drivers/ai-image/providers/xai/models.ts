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

import type { IImageModel } from '../../types.js';

export const XAI_IMAGE_GENERATION_MODELS: IImageModel[] = [
    {
        puterId: 'x-ai:x-ai/grok-2-image',
        id: 'grok-2-image',
        aliases: ['grok-image', 'x-ai/grok-image', 'x-ai/grok-2-image'],
        name: 'Grok 2 Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 7, // $0.07 per image
        },
    },
];
