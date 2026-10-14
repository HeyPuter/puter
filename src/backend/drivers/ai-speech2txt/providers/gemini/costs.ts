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

/**
 * µ¢ per token (USD-cents per 1M tokens): audio input, and text output with
 * thinking billed at the output rate. Text input has no published rate.
 */
export interface GeminiSpeechToTextCosts {
    inputAudio: number;
    outputText: number;
}

export const GEMINI_SPEECH_TO_TEXT_COSTS: Record<
    string,
    GeminiSpeechToTextCosts
> = {
    'gemini-3.5-transcribe': {
        inputAudio: 200, // $2.00 per 1M tokens
        outputText: 1200, // $12.00 per 1M tokens
    },
};
