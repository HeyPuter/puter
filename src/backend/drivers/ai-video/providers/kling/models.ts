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

// Prices are per second of output from
// https://kling.ai/document-api/pricing/base/video (1 unit = $0.14). Cost keys
// are `per-second:<resolution>`, with `:audio` for native audio and
// `:video-input` when a source video is edited.
// `default-duration-per-video` is a 5-second clip at the default resolution,
// for cross-provider sorting and display only.
export const KLING_VIDEO_GENERATION_MODELS: IVideoModel[] = [
    {
        id: 'kling-3.0-turbo',
        puterId: 'kling:kling/kling-3.0-turbo',
        aliases: ['kling/kling-3.0-turbo', 'kling-v3-turbo'],
        name: 'Kling 3.0 Turbo',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 11.2,
            'per-second:1080p': 14,
            'default-duration-per-video': 56,
        },
        durationSeconds: seconds(5, 3, 15),
        dimensions: ['720p', '1080p'],
        fps: [24],
    },
    {
        id: 'kling-3.0',
        puterId: 'kling:kling/kling-3.0',
        aliases: ['kling/kling-3.0', 'kling-v3'],
        name: 'Kling 3.0',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 8.4,
            'per-second:1080p': 11.2,
            'per-second:4k': 42,
            'per-second:720p:audio': 12.6,
            'per-second:1080p:audio': 16.8,
            'per-second:4k:audio': 42,
            'default-duration-per-video': 42,
        },
        durationSeconds: seconds(5, 3, 15),
        dimensions: ['720p', '1080p', '4k'],
        fps: [24],
    },
    {
        id: 'kling-3.0-omni',
        puterId: 'kling:kling/kling-3.0-omni',
        aliases: ['kling/kling-3.0-omni', 'kling-v3-omni'],
        name: 'Kling 3.0 Omni',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 8.4,
            'per-second:1080p': 11.2,
            'per-second:4k': 42,
            'per-second:720p:audio': 11.2,
            'per-second:1080p:audio': 14,
            'per-second:4k:audio': 42,
            'per-second:720p:video-input': 12.6,
            'per-second:1080p:video-input': 16.8,
            'per-second:4k:video-input': 42,
            'default-duration-per-video': 42,
        },
        durationSeconds: seconds(5, 3, 15),
        dimensions: ['720p', '1080p', '4k'],
        fps: [24],
        videoInput: true,
    },
    {
        id: 'kling-o1',
        puterId: 'kling:kling/kling-o1',
        aliases: ['kling/kling-o1', 'kling-video-o1'],
        name: 'Kling O1',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 8.4,
            'per-second:1080p': 11.2,
            'per-second:720p:video-input': 12.6,
            'per-second:1080p:video-input': 16.8,
            'default-duration-per-video': 42,
        },
        durationSeconds: seconds(5, 3, 10),
        dimensions: ['720p', '1080p'],
        fps: [24],
        videoInput: true,
    },
    {
        id: 'kling-2.6',
        puterId: 'kling:kling/kling-2.6',
        aliases: ['kling/kling-2.6', 'kling-v2-6'],
        name: 'Kling 2.6',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 4.2,
            'per-second:1080p': 7,
            'per-second:1080p:audio': 14,
            'default-duration-per-video': 21,
        },
        durationSeconds: [5, 10],
        dimensions: ['720p', '1080p'],
        fps: [24],
    },
    {
        id: 'kling-2.5-turbo',
        puterId: 'kling:kling/kling-2.5-turbo',
        aliases: ['kling/kling-2.5-turbo', 'kling-v2-5-turbo'],
        name: 'Kling 2.5 Turbo',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'per-second:720p': 4.2,
            'per-second:1080p': 7,
            'default-duration-per-video': 21,
        },
        durationSeconds: [5, 10],
        dimensions: ['720p', '1080p'],
        fps: [24],
    },
];

// Capabilities per the model pages under
// https://kling.ai/document-api/api/video and the capability map
// https://kling.ai/document-api/guides/capability-map/video.
export const KLING_VIDEO_SPECS: Record<string, KlingVideoSpec> = {
    'kling-3.0-turbo': {
        textPath: '/text-to-video/kling-3.0-turbo',
        imagePath: '/image-to-video/kling-3.0-turbo',
        audio: 'always',
        lastFrame: false,
        maxReferenceImages: 0,
        maxReferenceImagesWithVideo: 0,
        maxPromptChars: 3072,
        maxImagePromptChars: 2500,
    },
    'kling-3.0': {
        textPath: '/text-to-video/kling-3.0',
        imagePath: '/image-to-video/kling-3.0',
        audio: 'optional',
        lastFrame: true,
        maxReferenceImages: 0,
        maxReferenceImagesWithVideo: 0,
        maxPromptChars: 3072,
    },
    'kling-3.0-omni': {
        omniPath: '/omni-video/kling-3.0-omni',
        audio: 'optional',
        lastFrame: true,
        maxReferenceImages: 7,
        maxReferenceImagesWithVideo: 4,
        maxSourceSeconds: 15.5,
        maxPromptChars: 3072,
    },
    'kling-o1': {
        omniPath: '/omni-video/kling-o1',
        audio: 'none',
        lastFrame: true,
        maxReferenceImages: 7,
        maxReferenceImagesWithVideo: 4,
        maxSourceSeconds: 10,
        firstFrameOnlySeconds: [5, 10],
        framePairExcludesReferences: true,
        maxPromptChars: 2500,
    },
    'kling-2.6': {
        textPath: '/text-to-video/kling-2.6',
        imagePath: '/image-to-video/kling-2.6',
        audio: '1080p',
        lastFrame: '1080p',
        maxReferenceImages: 0,
        maxReferenceImagesWithVideo: 0,
        maxPromptChars: 2500,
    },
    'kling-2.5-turbo': {
        textPath: '/text-to-video/kling-2.5-turbo',
        imagePath: '/image-to-video/kling-2.5-turbo',
        audio: 'none',
        lastFrame: '1080p',
        maxReferenceImages: 0,
        maxReferenceImagesWithVideo: 0,
        maxPromptChars: 2500,
    },
};
