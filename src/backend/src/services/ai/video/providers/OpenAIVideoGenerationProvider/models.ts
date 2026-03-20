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
        version: '1.0',
        costs_currency: 'usd-cents',
        costs: {
            default: 10, // $0.10 per second
        },
        allowedDurationsSeconds: OPENAI_VIDEO_ALLOWED_SECONDS.slice(),
        allowedResolutions: ['720x1280', '1280x720'],
        defaultUsageKey: 'openai:sora-2:default',
    },
    {
        id: 'sora-2-pro',
        puterId: 'openai:openai/sora-2-pro',
        aliases: ['openai/sora-2-pro'],
        name: 'Sora 2 Pro',
        version: '1.0',
        costs_currency: 'usd-cents',
        costs: {
            default: 30, // $0.30 per second (720x1280 / 1280x720)
            xl: 50, // $0.50 per second (1024x1792 / 1792x1024)
            xxl: 70, // $0.70 per second (1080x1920 / 1920x1080)
        },
        allowedDurationsSeconds: OPENAI_VIDEO_ALLOWED_SECONDS.slice(),
        allowedResolutions: ['720x1280', '1280x720', '1024x1792', '1792x1024', '1080x1920', '1920x1080'],
        defaultUsageKey: 'openai:sora-2-pro:default',
    },
];