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

import { IVideoModel } from '../types.js';

export const OPENAI_VIDEO_ALLOWED_SECONDS = [4, 8, 12] as const;

export const OPENAI_VIDEO_MODELS: IVideoModel[] = [
    {
        id: 'sora-2',
        puterId: 'openai:openai/sora-2',
        aliases: ['openai/sora-2'],
        name: 'Sora 2',
        costs_currency: 'usd-cents',
        costs: {
            'per-second': 10,
            'default-duration-per-video': 40,
        },
        output_cost_key: 'default-duration-per-video',
        durationSeconds: OPENAI_VIDEO_ALLOWED_SECONDS.slice(),
        dimensions: ['720x1280', '1280x720'],
        defaultUsageKey: 'openai:sora-2:default',
    },
    {
        id: 'sora-2-pro',
        puterId: 'openai:openai/sora-2-pro',
        aliases: ['openai/sora-2-pro'],
        name: 'Sora 2 Pro',
        costs_currency: 'usd-cents',
        costs: {
            'per-second': 30,
            'default-duration-per-video': 120,
            'per-second-xl': 50,
            'default-duration-per-video-xl': 200,
            'per-second-xxl': 70,
            'default-duration-per-video-xxl': 280,
        },
        output_cost_key: 'default-duration-per-video',
        durationSeconds: OPENAI_VIDEO_ALLOWED_SECONDS.slice(),
        dimensions: ['720x1280', '1280x720', '1024x1792', '1792x1024', '1080x1920', '1920x1080'],
        defaultUsageKey: 'openai:sora-2-pro:default',
    },
];
