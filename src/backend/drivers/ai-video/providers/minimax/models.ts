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

import type { IVideoModel } from '../../types.js';

/** MiniMax-specific model behavior the shared IVideoModel shape can't carry. */
export interface MiniMaxVideoSpec {
    /** The model name as MiniMax spells it on the wire. */
    apiModel: string;
    /**
     * `v2`: the H3 task API, billed per second of output. `v1`: the Hailuo API,
     * billed per clip, whose result is fetched through a file id.
     */
    api: 'v1' | 'v2';
    /**
     * Frames and reference images together. MiniMax charges per image above
     * this quota, so more are refused rather than billed.
     */
    maxImages: number;
    /** Whether `reference_images` are taken (H3 reference-to-video). */
    references: boolean;
    lastFrame: boolean;
    /** Resolutions MiniMax renders only from a first frame. */
    imageOnlyResolutions?: string[];
    maxPromptChars: number;
}

// Duration ladder for the driver's normalization: element 0 is the fallback
// default, the rest enumerate the model's contiguous valid range.
const seconds = (def: number, min: number, max: number): number[] => [
    def,
    ...Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(
        (s) => s !== def,
    ),
];

// Prices from https://platform.minimax.io/docs/guides/pricing-video. H3 models
// are per second of output, keyed `per-second:<resolution>`; Hailuo models are
// per clip, keyed `per-video:<resolution>:<seconds>`, and a key's absence means
// the model doesn't offer that combination. `default-duration-per-video` is
// the default clip at the default resolution, for cross-provider sorting and
// display only.
export const MINIMAX_VIDEO_GENERATION_MODELS: IVideoModel[] = [
    {
        id: 'minimax-h3',
        puterId: 'minimax:minimax/minimax-h3',
        name: 'MiniMax H3',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:768p': 8,
            'per-second:2k': 13,
            'default-duration-per-video': 40,
        },
        durationSeconds: seconds(5, 4, 15),
        dimensions: ['768p', '2k'],
        fps: [24],
    },
    {
        id: 'minimax-h3-highspeed',
        puterId: 'minimax:minimax/minimax-h3-highspeed',
        name: 'MiniMax H3 Highspeed',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:768p': 6,
            'default-duration-per-video': 30,
        },
        durationSeconds: seconds(5, 4, 15),
        dimensions: ['768p'],
        fps: [24],
    },
    {
        id: 'minimax-h3-lite',
        puterId: 'minimax:minimax/minimax-h3-lite',
        name: 'MiniMax H3 Lite',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:768p': 4,
            'per-second:480p': 2.5,
            'default-duration-per-video': 20,
        },
        durationSeconds: seconds(5, 4, 15),
        dimensions: ['768p', '480p'],
        fps: [24],
    },
    {
        id: 'minimax-h3-max',
        puterId: 'minimax:minimax/minimax-h3-max',
        name: 'MiniMax H3 Max',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:768p': 8,
            'per-second:480p': 5,
            'default-duration-per-video': 40,
        },
        durationSeconds: seconds(5, 5, 15),
        dimensions: ['768p', '480p'],
        fps: [24],
    },
    {
        id: 'minimax-hailuo-2.3',
        puterId: 'minimax:minimax/minimax-hailuo-2.3',
        name: 'MiniMax Hailuo 2.3',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-video:768p:6': 28,
            'per-video:768p:10': 56,
            'per-video:1080p:6': 49,
            'default-duration-per-video': 28,
        },
        durationSeconds: [6, 10],
        dimensions: ['768p', '1080p'],
        fps: [24],
    },
    {
        id: 'minimax-hailuo-2.3-fast',
        puterId: 'minimax:minimax/minimax-hailuo-2.3-fast',
        name: 'MiniMax Hailuo 2.3 Fast',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-video:768p:6': 19,
            'per-video:768p:10': 32,
            'per-video:1080p:6': 33,
            'default-duration-per-video': 19,
        },
        durationSeconds: [6, 10],
        dimensions: ['768p', '1080p'],
        fps: [24],
    },
    {
        id: 'minimax-hailuo-02',
        puterId: 'minimax:minimax/minimax-hailuo-02',
        name: 'MiniMax Hailuo 02',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-video:768p:6': 28,
            'per-video:768p:10': 56,
            'per-video:1080p:6': 49,
            'per-video:512p:6': 10,
            'per-video:512p:10': 15,
            'default-duration-per-video': 28,
        },
        durationSeconds: [6, 10],
        dimensions: ['768p', '1080p', '512p'],
        fps: [24],
    },
];

// Capabilities per https://platform.minimax.io/docs/api-reference/video-generation-v2-create
// (H3) and the text-, image- and frames-to-video pages under
// https://platform.minimax.io/docs/api-reference/video-generation-t2v (Hailuo).
export const MINIMAX_VIDEO_SPECS: Record<string, MiniMaxVideoSpec> = {
    'minimax-h3': {
        apiModel: 'MiniMax-H3',
        api: 'v2',
        maxImages: 5,
        references: true,
        lastFrame: true,
        maxPromptChars: 7000,
    },
    'minimax-h3-highspeed': {
        apiModel: 'MiniMax-H3-Highspeed',
        api: 'v2',
        maxImages: 5,
        references: true,
        lastFrame: true,
        maxPromptChars: 7000,
    },
    'minimax-h3-lite': {
        apiModel: 'MiniMax-H3-Lite',
        api: 'v2',
        maxImages: 5,
        references: true,
        lastFrame: true,
        maxPromptChars: 7000,
    },
    'minimax-h3-max': {
        apiModel: 'MiniMax-H3-Max',
        api: 'v2',
        maxImages: 2,
        references: true,
        lastFrame: true,
        maxPromptChars: 7000,
    },
    'minimax-hailuo-2.3': {
        apiModel: 'MiniMax-Hailuo-2.3',
        api: 'v1',
        maxImages: 1,
        references: false,
        lastFrame: false,
        maxPromptChars: 2000,
    },
    'minimax-hailuo-2.3-fast': {
        apiModel: 'MiniMax-Hailuo-2.3-Fast',
        api: 'v1',
        maxImages: 1,
        references: false,
        lastFrame: false,
        maxPromptChars: 2000,
    },
    'minimax-hailuo-02': {
        apiModel: 'MiniMax-Hailuo-02',
        api: 'v1',
        maxImages: 2,
        references: false,
        lastFrame: true,
        imageOnlyResolutions: ['512p'],
        maxPromptChars: 2000,
    },
};
