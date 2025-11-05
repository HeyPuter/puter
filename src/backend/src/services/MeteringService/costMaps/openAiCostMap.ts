
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

export const OPENAI_COST_MAP = {
    // GPT-5 models
    'openai:gpt-5-2025-08-07:prompt_tokens': 125,
    'openai:gpt-5-2025-08-07:cached_tokens': 13,
    'openai:gpt-5-2025-08-07:completion_tokens': 1000,
    'openai:gpt-5-mini-2025-08-07:prompt_tokens': 25,
    'openai:gpt-5-mini-2025-08-07:cached_tokens': 3,
    'openai:gpt-5-mini-2025-08-07:completion_tokens': 200,
    'openai:gpt-5-nano-2025-08-07:prompt_tokens': 5,
    'openai:gpt-5-nano-2025-08-07:cached_tokens': 1,
    'openai:gpt-5-nano-2025-08-07:completion_tokens': 40,
    'openai:gpt-5-chat-latest:prompt_tokens': 125,
    'openai:gpt-5-chat-latest:cached_tokens': 13,
    'openai:gpt-5-chat-latest:completion_tokens': 1000,

    // GPT-4o models
    'openai:gpt-4o:prompt_tokens': 250,
    'openai:gpt-4o:cached_tokens': 125,
    'openai:gpt-4o:completion_tokens': 1000,
    'openai:gpt-4o-mini:prompt_tokens': 15,
    'openai:gpt-4o-mini:cached_tokens': 8,
    'openai:gpt-4o-mini:completion_tokens': 60,

    // O1 models
    'openai:o1:prompt_tokens': 1500,
    'openai:o1:cached_tokens': 750,
    'openai:o1:completion_tokens': 6000,
    'openai:o1-mini:prompt_tokens': 110,
    'openai:o1-mini:completion_tokens': 440,
    'openai:o1-pro:prompt_tokens': 15000,
    'openai:o1-pro:completion_tokens': 60000,

    // O3 models
    'openai:o3:prompt_tokens': 200,
    'openai:o3:cached_tokens': 50,
    'openai:o3:completion_tokens': 800,
    'openai:o3-mini:prompt_tokens': 110,
    'openai:o3-mini:cached_tokens': 55,
    'openai:o3-mini:completion_tokens': 440,

    // O4 models
    'openai:o4-mini:prompt_tokens': 110,
    'openai:o4-mini:completion_tokens': 440,

    // GPT-4.1 models
    'openai:gpt-4.1:prompt_tokens': 200,
    'openai:gpt-4.1:cached_tokens': 50,
    'openai:gpt-4.1:completion_tokens': 800,
    'openai:gpt-4.1-mini:prompt_tokens': 40,
    'openai:gpt-4.1-mini:cached_tokens': 10,
    'openai:gpt-4.1-mini:completion_tokens': 160,
    'openai:gpt-4.1-nano:prompt_tokens': 10,
    'openai:gpt-4.1-nano:cached_tokens': 2,
    'openai:gpt-4.1-nano:completion_tokens': 40,

    // GPT-4.5 preview
    'openai:gpt-4.5-preview:prompt_tokens': 7500,
    'openai:gpt-4.5-preview:completion_tokens': 15000,

    // Text-to-speech models (per character, microcents)
    'openai:gpt-4o-mini-tts:character': 1500,
    'openai:tts-1:character': 1500,
    'openai:tts-1-hd:character': 3000,

    // Speech-to-text models (per second, microcents)
    'openai:gpt-4o-transcribe:second': 10000,
    'openai:gpt-4o-mini-transcribe:second': 5000,
    'openai:gpt-4o-transcribe-diarize:second': 10000,
    'openai:whisper-1:second': 10000,
};
