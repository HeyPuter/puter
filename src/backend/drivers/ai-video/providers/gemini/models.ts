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

import { IVideoModel } from '../../types.js';

export interface IGeminiVideoModel extends IVideoModel {
    aspectRatios: string[];
    resolutions: string[];
    supportsImageInput: boolean;
    supportsReferenceImages: boolean;
}

// Dimension strings used by the service layer for validation.
const STANDARD_DIMENSIONS = ['1280x720', '720x1280', '1920x1080', '1080x1920'];
const DIMENSIONS_WITH_4K = [...STANDARD_DIMENSIONS, '3840x2160', '2160x3840'];

// https://ai.google.dev/gemini-api/docs/video
// https://ai.google.dev/gemini-api/docs/pricing
export const GEMINI_VIDEO_GENERATION_MODELS: IGeminiVideoModel[] = [
    {
        puterId: 'google:google/veo-2.0',
        id: 'veo-2.0-generate-001',
        name: 'Veo 2.0',
        costs_currency: 'usd-cents',
        costs: { 'per-second': 35 },
        output_cost_key: 'per-second',
        durationSeconds: [5, 6, 8],
        dimensions: ['1280x720', '720x1280'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: [],
        supportsImageInput: true,
        supportsReferenceImages: false,
    },
    {
        puterId: 'google:google/veo-3.0',
        id: 'veo-3.0-generate-001',
        name: 'Veo 3.0',
        costs_currency: 'usd-cents',
        costs: { 'per-second': 40 },
        output_cost_key: 'per-second',
        durationSeconds: [4, 6, 8],
        dimensions: STANDARD_DIMENSIONS,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        supportsImageInput: true,
        supportsReferenceImages: false,
    },
    {
        puterId: 'google:google/veo-3.0-fast',
        id: 'veo-3.0-fast-generate-001',
        name: 'Veo 3.0 Fast',
        costs_currency: 'usd-cents',
        costs: { 'per-second': 15 },
        output_cost_key: 'per-second',
        durationSeconds: [4, 6, 8],
        dimensions: STANDARD_DIMENSIONS,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        supportsImageInput: true,
        supportsReferenceImages: false,
    },
    {
        puterId: 'google:google/veo-3.1',
        id: 'veo-3.1-generate-preview',
        name: 'Veo 3.1',
        costs_currency: 'usd-cents',
        costs: { 'per-second': 40, 'per-second-4k': 60 },
        output_cost_key: 'per-second',
        durationSeconds: [4, 6, 8],
        dimensions: DIMENSIONS_WITH_4K,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p', '4k'],
        supportsImageInput: true,
        supportsReferenceImages: true,
    },
    {
        puterId: 'google:google/veo-3.1-fast',
        id: 'veo-3.1-fast-generate-preview',
        name: 'Veo 3.1 Fast',
        costs_currency: 'usd-cents',
        costs: { 'per-second': 15, 'per-second-4k': 35 },
        output_cost_key: 'per-second',
        durationSeconds: [4, 6, 8],
        dimensions: DIMENSIONS_WITH_4K,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p', '4k'],
        supportsImageInput: true,
        supportsReferenceImages: true,
    },
    {
        puterId: 'google:google/veo-3.1-lite',
        id: 'veo-3.1-lite-generate-preview',
        name: 'Veo 3.1 Lite',
        costs_currency: 'usd-cents',
        costs: { 'per-second': 5, 'per-second-1080p': 8 },
        output_cost_key: 'per-second',
        durationSeconds: [4, 6, 8],
        dimensions: STANDARD_DIMENSIONS,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        supportsImageInput: true,
        supportsReferenceImages: false,
    },
];
