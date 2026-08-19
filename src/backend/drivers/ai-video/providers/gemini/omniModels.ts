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

import { IVideoModel } from '../../types.js';

export interface IGeminiOmniModel extends IVideoModel {
    aspectRatios: string[];
    supportsImageInput: boolean;
    supportsReferenceImages: boolean;
}

/**
 * Video tokens Google bills per second of 720p output.
 *
 * Omni prices video as output tokens, not as clip length, and exposes no
 * duration parameter. This ratio is the only bridge between the two, and it is
 * what turns a wallet balance into "can this request run at all".
 *
 * https://ai.google.dev/gemini-api/docs/pricing
 */
export const OMNI_VIDEO_TOKENS_PER_SECOND_720P = 5792;

/**
 * Longest clip Omni is documented to produce, used for the affordability
 * pre-check. Nothing caps generation at request time, so the gate has to assume
 * the worst case rather than clamp toward it the way Veo does.
 */
export const OMNI_MAX_BILLED_SECONDS = 8;

// https://ai.google.dev/gemini-api/docs/omni
// https://ai.google.dev/gemini-api/docs/pricing
//
// Unsupported by the model, and therefore ignored rather than forwarded:
// `negative_prompt`, `seconds`/`duration` (the model chooses its own length),
// `fps`, `seed`, `guidance_scale`, and system instructions. `durationSeconds`
// is null so the driver does not normalise a duration the upstream will not
// honour.
export const GEMINI_OMNI_VIDEO_MODELS: IGeminiOmniModel[] = [
    {
        puterId: 'google:google/gemini-omni-flash',
        id: 'gemini-omni-flash-preview',
        name: 'Gemini Omni Flash',
        costs_currency: 'usd-cents',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 150,
            completion_tokens: 900,
            video_tokens: 1750,
            // Derived, published for parity with the Veo entries so callers
            // comparing models see one number in the same unit.
            'per-second': 10,
        },
        output_cost_key: 'video_tokens',
        durationSeconds: null,
        dimensions: ['1280x720', '720x1280'],
        aspectRatios: ['16:9', '9:16'],
        supportsImageInput: true,
        supportsReferenceImages: true,
        promptSupported: true,
    },
];
