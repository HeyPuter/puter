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

// Microcents per character, per OpenAI TTS model. A model with token costs
// below is held at this rate and billed by the tokens OpenAI reports.
export const OPENAI_TTS_COSTS: Record<string, number> = {
    'gpt-4o-mini-tts': 1500,
    'tts-1': 1500,
    'tts-1-hd': 3000,
};

// Microcents per token: $0.60/1M text input, $12/1M audio output.
export const OPENAI_TTS_TOKEN_COSTS: Record<
    string,
    { input: number; outputAudio: number }
> = {
    'gpt-4o-mini-tts': { input: 60, outputAudio: 1200 },
};
