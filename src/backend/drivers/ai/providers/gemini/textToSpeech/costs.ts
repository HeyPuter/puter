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

export const GEMINI_TTS_COSTS: Record<string, GeminiTTSCosts> = {
    'gemini-3.8-flash-tts': {
        input: 100, // $1.00 per 1M tokens
        output_audio: 1800, // $18.00 per 1M tokens
    },
    'gemini-3.8-flash-lite-tts': {
        input: 100, // $1.00 per 1M tokens
        output_audio: 1200, // $12.00 per 1M tokens
    },
};
