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

/** USD-cents per 1M tokens: text input, and audio output (~25 tokens/s). */
export interface GeminiTTSCosts {
    input: number;
    output_audio: number;
}

/** The instant launch pricing ends and both rates double. */
export const GEMINI_TTS_LAUNCH_PRICING_ENDS = Date.UTC(2027, 0, 1);

/** Launch pricing, through 2026-12-31 UTC. */
export const GEMINI_TTS_COSTS: Record<string, GeminiTTSCosts> = {
    'gemini-3.8-flash-tts': {
        input: 50, // $0.50 per 1M tokens
        output_audio: 900, // $9.00 per 1M tokens
    },
    'gemini-3.8-flash-lite-tts': {
        input: 50, // $0.50 per 1M tokens
        output_audio: 600, // $6.00 per 1M tokens
    },
};

/** `model`'s rates in force at `at` (ms since epoch); undefined when unpriced. */
export const geminiTTSCostsAt = (
    model: string,
    at: number,
): GeminiTTSCosts | undefined => {
    const launch = GEMINI_TTS_COSTS[model];
    if (!launch || at < GEMINI_TTS_LAUNCH_PRICING_ENDS) return launch;
    return { input: launch.input * 2, output_audio: launch.output_audio * 2 };
};
