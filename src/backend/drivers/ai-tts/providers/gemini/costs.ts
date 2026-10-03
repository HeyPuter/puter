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

// Gemini TTS pricing in USD per 1M tokens (launch pricing through
// 2026-12-31; both rates double on 2027-01-01):
//   gemini-3.8-flash-tts:       input $0.50, output (audio) $9.00
//   gemini-3.8-flash-lite-tts:  input $0.50, output (audio) $6.00
//
// Audio output tokens = ~25 tokens/second of audio.
//
// Costs here are in USD-cents per 1M tokens for input and output.
export const GEMINI_TTS_COSTS: Record<
    string,
    { input: number; output_audio: number }
> = {
    'gemini-3.8-flash-tts': {
        input: 50, // $0.50 per 1M tokens
        output_audio: 900, // $9.00 per 1M tokens
    },
    'gemini-3.8-flash-lite-tts': {
        input: 50, // $0.50 per 1M tokens
        output_audio: 600, // $6.00 per 1M tokens
    },
};
