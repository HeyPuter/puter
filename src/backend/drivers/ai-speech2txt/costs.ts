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

// Microcents per second of audio, per OpenAI transcription model.
export const SPEECH_TO_TEXT_COSTS: Record<string, number> = {
    'openai:gpt-4o-transcribe:second': 10000,
    'openai:gpt-4o-mini-transcribe:second': 5000,
    'openai:gpt-4o-transcribe-diarize:second': 10000,
    'openai:whisper-1:second': 10000,
};
