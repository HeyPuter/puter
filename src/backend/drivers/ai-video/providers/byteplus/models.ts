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

/**
 * Ark-specific model behavior the shared IVideoModel shape can't carry. Keyed
 * by model id.
 */
export interface BytePlusVideoSpec {
    /** Valid `duration` range (integer seconds) and Ark's default. */
    duration: { min: number; max: number; default: number };
    /**
     * 16:9 output dimensions per resolution key, from the create-task API's
     * ratio table. Used only for pre-flight cost estimates — actual billing
     * uses the `usage.completion_tokens` the task reports.
     */
    dims: Record<string, { w: number; h: number }>;
    /** Supports `generate_audio` (Seedance 2.0 series + 1.5 Pro). */
    supportsAudio: boolean;
    /** Supports first+last frame image-to-video. */
    supportsLastFrame: boolean;
    /** Supports multimodal `reference_image` inputs (Seedance 2.0 series). */
    supportsReferenceImages: boolean;
    /** Supports the `seed` param (not the Seedance 2.0 series). */
    supportsSeed: boolean;
}

// Duration ladder for the driver's normalization: element 0 is the fallback
// default, the rest enumerate the model's contiguous valid range.
const seconds = (def: number, min: number, max: number): number[] => [
    def,
    ...Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(
        (s) => s !== def,
    ),
];

const FPS = [24];

// USD per million tokens → usd-cents per token.
const perMToken = (usd: number): number => (usd * 100) / 1_000_000;

// Hardcoded from https://docs.byteplus.com/en/docs/ModelArk/1544106 (pricing,
// "online inference / input without video" rates — reference-video input is
// not exposed through this driver) and the create-task API reference
// https://docs.byteplus.com/en/docs/ModelArk/1520757 (capabilities).
//
// Video is billed per token: tokens ≈ duration × width × height × fps / 1024,
// with the authoritative count returned as `usage.completion_tokens`.
// `default-duration-per-video` is the estimated cents for a 5s clip at the
// model's default resolution — it exists for cross-provider cost sorting and
// display, not billing.
//
// dreamina-seedance-2-5-260628 is priced on the pricing page but the API
// reference still lists its API access as "available soon", so it's
// deliberately absent here.
export const BYTEPLUS_VIDEO_GENERATION_MODELS: IVideoModel[] = [
    {
        id: 'dreamina-seedance-2-0-260128',
        puterId: 'byteplus:byteplus/dreamina-seedance-2-0-260128',
        aliases: [
            'dreamina-seedance-2-0',
            'byteplus/dreamina-seedance-2-0',
            'seedance-2-0',
        ],
        name: 'Dreamina Seedance 2.0',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'video_tokens:480p': perMToken(7.0),
            'video_tokens:720p': perMToken(7.0),
            'video_tokens:1080p': perMToken(7.7),
            'video_tokens:4k': perMToken(4.0),
            'default-duration-per-video': 76,
        },
        durationSeconds: seconds(5, 4, 15),
        dimensions: ['720p', '480p', '1080p', '4k'],
        fps: FPS,
        defaultUsageKey:
            'byteplus-video-generation:dreamina-seedance-2-0-260128:video_tokens:720p',
    },
    {
        id: 'dreamina-seedance-2-0-fast-260128',
        puterId: 'byteplus:byteplus/dreamina-seedance-2-0-fast-260128',
        aliases: [
            'dreamina-seedance-2-0-fast',
            'byteplus/dreamina-seedance-2-0-fast',
            'seedance-2-0-fast',
        ],
        name: 'Dreamina Seedance 2.0 Fast',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            video_tokens: perMToken(5.6),
            'default-duration-per-video': 60,
        },
        durationSeconds: seconds(5, 4, 15),
        dimensions: ['720p', '480p'],
        fps: FPS,
        defaultUsageKey:
            'byteplus-video-generation:dreamina-seedance-2-0-fast-260128:video_tokens',
    },
    {
        id: 'dreamina-seedance-2-0-mini-260615',
        puterId: 'byteplus:byteplus/dreamina-seedance-2-0-mini-260615',
        aliases: [
            'dreamina-seedance-2-0-mini',
            'byteplus/dreamina-seedance-2-0-mini',
            'seedance-2-0-mini',
        ],
        name: 'Dreamina Seedance 2.0 Mini',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            video_tokens: perMToken(3.5),
            'default-duration-per-video': 38,
        },
        durationSeconds: seconds(5, 4, 15),
        dimensions: ['720p', '480p'],
        fps: FPS,
        defaultUsageKey:
            'byteplus-video-generation:dreamina-seedance-2-0-mini-260615:video_tokens',
    },
    {
        id: 'seedance-1-5-pro-251215',
        puterId: 'byteplus:byteplus/seedance-1-5-pro-251215',
        aliases: ['seedance-1-5-pro', 'byteplus/seedance-1-5-pro'],
        name: 'Seedance 1.5 Pro',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            'video_tokens:audio': perMToken(2.4),
            'video_tokens:silent': perMToken(1.2),
            'default-duration-per-video': 26,
        },
        durationSeconds: seconds(5, 4, 12),
        dimensions: ['720p', '480p', '1080p'],
        fps: FPS,
        defaultUsageKey:
            'byteplus-video-generation:seedance-1-5-pro-251215:video_tokens:audio',
    },
    {
        id: 'seedance-1-0-pro-250528',
        puterId: 'byteplus:byteplus/seedance-1-0-pro-250528',
        aliases: ['seedance-1-0-pro', 'byteplus/seedance-1-0-pro'],
        name: 'Seedance 1.0 Pro',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            video_tokens: perMToken(2.5),
            'default-duration-per-video': 61,
        },
        durationSeconds: seconds(5, 2, 12),
        dimensions: ['1080p', '480p', '720p'],
        fps: FPS,
        defaultUsageKey:
            'byteplus-video-generation:seedance-1-0-pro-250528:video_tokens',
    },
    {
        id: 'seedance-1-0-pro-fast-251015',
        puterId: 'byteplus:byteplus/seedance-1-0-pro-fast-251015',
        aliases: ['seedance-1-0-pro-fast', 'byteplus/seedance-1-0-pro-fast'],
        name: 'Seedance 1.0 Pro Fast',
        costs_currency: 'usd-cents',
        output_cost_key: 'default-duration-per-video',
        costs: {
            video_tokens: perMToken(1.0),
            'default-duration-per-video': 24,
        },
        durationSeconds: seconds(5, 2, 12),
        dimensions: ['1080p', '480p', '720p'],
        fps: FPS,
        defaultUsageKey:
            'byteplus-video-generation:seedance-1-0-pro-fast-251015:video_tokens',
    },
];

const SEEDANCE_2_0_DIMS = {
    '480p': { w: 864, h: 496 },
    '720p': { w: 1280, h: 720 },
    '1080p': { w: 1920, h: 1080 },
    '4k': { w: 3840, h: 2160 },
};

const SEEDANCE_1_0_DIMS = {
    '480p': { w: 864, h: 480 },
    '720p': { w: 1248, h: 704 },
    '1080p': { w: 1920, h: 1088 },
};

export const BYTEPLUS_VIDEO_SPECS: Record<string, BytePlusVideoSpec> = {
    'dreamina-seedance-2-0-260128': {
        duration: { min: 4, max: 15, default: 5 },
        dims: SEEDANCE_2_0_DIMS,
        supportsAudio: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        supportsSeed: false,
    },
    'dreamina-seedance-2-0-fast-260128': {
        duration: { min: 4, max: 15, default: 5 },
        dims: SEEDANCE_2_0_DIMS,
        supportsAudio: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        supportsSeed: false,
    },
    'dreamina-seedance-2-0-mini-260615': {
        duration: { min: 4, max: 15, default: 5 },
        dims: SEEDANCE_2_0_DIMS,
        supportsAudio: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        supportsSeed: false,
    },
    'seedance-1-5-pro-251215': {
        duration: { min: 4, max: 12, default: 5 },
        dims: SEEDANCE_2_0_DIMS,
        supportsAudio: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        supportsSeed: true,
    },
    'seedance-1-0-pro-250528': {
        duration: { min: 2, max: 12, default: 5 },
        dims: SEEDANCE_1_0_DIMS,
        supportsAudio: false,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        supportsSeed: true,
    },
    'seedance-1-0-pro-fast-251015': {
        duration: { min: 2, max: 12, default: 5 },
        dims: SEEDANCE_1_0_DIMS,
        supportsAudio: false,
        supportsLastFrame: false,
        supportsReferenceImages: false,
        supportsSeed: true,
    },
};
