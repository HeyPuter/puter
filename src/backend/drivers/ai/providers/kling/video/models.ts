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

import type { IVideoModel } from '../../../interfaces/video/types.js';

/** Kling-specific model behavior the shared IVideoModel shape can't carry. */
export interface KlingVideoSpec {
    /**
     * Path of the text-to-video endpoint; omni models take everything on
     * `omniPath`.
     */
    textPath?: string;
    /** Path of the image-to-video endpoint. */
    imagePath?: string;
    /** Path of the omni endpoint, which takes frames, references and a video. */
    omniPath?: string;
    /**
     * `always`: the clip always has a soundtrack and no switch is sent.
     * `optional`: `generate_audio` turns native audio on; off by default.
     * `1080p`: as `optional`, but only at 1080p. `none`: always silent.
     */
    audio: 'always' | 'optional' | '1080p' | 'none';
    /** Whether a last frame is accepted, and at which resolution. */
    lastFrame: false | true | '1080p';
    /** Reference images without and with a source video; 0 when unsupported. */
    maxReferenceImages: number;
    maxReferenceImagesWithVideo: number;
    /** Longest source video Kling accepts, which is also the output length. */
    maxSourceSeconds?: number;
    /** Durations allowed when the only input is a first frame. */
    firstFrameOnlySeconds?: number[];
    /** Whether a first + last frame pair excludes reference images. */
    framePairExcludesReferences?: boolean;
    maxPromptChars: number;
    /** Lower prompt limit on the image-to-video endpoint, where it differs. */
    maxImagePromptChars?: number;
}

// Duration ladder for the driver's normalization: element 0 is the fallback
// default, the rest enumerate the model's contiguous valid range.
const seconds = (def: number, min: number, max: number): number[] => [
    def,
    ...Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(
        (s) => s !== def,
    ),
];

// Prices are USD cents per second from https://kling.ai/dev/pricing.
// The default-duration price is a 5-second clip for sorting and display.
export const KLING_VIDEO_GENERATION_MODELS: IVideoModel[] = [
    {
        id: 'kling-4.0',
        puterId: 'kling:kling/kling-4.0',
        aliases: ['kling/kling-4.0'],
        name: 'Kling 4.0',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 15.7,
            'per-second:1080p': 23.55,
            'default-duration-per-video': 78.5,
        },
        durationSeconds: seconds(5, 3, 30),
        dimensions: ['720p', '1080p'],
        fps: [24],
    },
    {
        id: 'kling-4.0-flash',
        puterId: 'kling:kling/kling-4.0-flash',
        aliases: ['kling/kling-4.0-flash'],
        name: 'Kling 4.0 Flash',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 9.42,
            'default-duration-per-video': 47.1,
        },
        durationSeconds: seconds(5, 3, 20),
        dimensions: ['720p'],
        fps: [24],
    },
];

export const KLING_VIDEO_SPECS: Record<string, KlingVideoSpec> = {
    // Kling 4 takes 26,000 English characters but 11,000 non-English ones,
    // and enforces the lower limit itself.
    'kling-4.0-flash': {
        textPath: '/text-to-video/kling-4.0-flash',
        imagePath: '/image-to-video/kling-4.0-flash',
        audio: 'always',
        lastFrame: false,
        maxReferenceImages: 0,
        maxReferenceImagesWithVideo: 0,
        maxPromptChars: 26_000,
    },
    'kling-4.0': {
        textPath: '/text-to-video/kling-4.0',
        imagePath: '/image-to-video/kling-4.0',
        audio: 'always',
        lastFrame: true,
        maxReferenceImages: 0,
        maxReferenceImagesWithVideo: 0,
        maxPromptChars: 26_000,
    },
};
