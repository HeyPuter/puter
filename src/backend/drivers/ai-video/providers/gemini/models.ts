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

export const GEMINI_OMNI_MODEL = 'gemini-omni-1.1-flash';

/**
 * Μ¢ per token (USD-cents per 1M tokens). Input of every modality shares one
 * rate; thinking and non-video output are billed as text.
 */
export interface GeminiOmniCosts {
    input: number;
    outputText: number;
    outputVideo: number;
}

export const GEMINI_OMNI_COSTS: GeminiOmniCosts = {
    input: 150, // $1.50 per 1M tokens
    outputText: 900, // $9.00 per 1M tokens
    outputVideo: 1750, // $17.50 per 1M tokens
};

// Billed per token, so no `durationSeconds` or `dimensions`: the driver would
// otherwise inject a duration and rewrite sizes this model does not take.
export const GEMINI_VIDEO_GENERATION_MODELS: IVideoModel[] = [
    {
        id: GEMINI_OMNI_MODEL,
        puterId: `google:google/${GEMINI_OMNI_MODEL}`,
        name: 'Gemini Omni 1.1 Flash',
        costs_currency: 'usd-cents',
        output_cost_key: 'output:video',
        // Cents per token, matching the usage types the provider records.
        costs: {
            input: GEMINI_OMNI_COSTS.input / 1_000_000,
            'output:text': GEMINI_OMNI_COSTS.outputText / 1_000_000,
            'output:video': GEMINI_OMNI_COSTS.outputVideo / 1_000_000,
        },
        promptLength: { min: 1, max: 4000 },
        videoInput: true,
        defaultUsageKey: `gemini-video-generation:${GEMINI_OMNI_MODEL}:output:video`,
    },
];
