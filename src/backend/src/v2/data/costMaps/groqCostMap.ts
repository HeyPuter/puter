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

export const GROQ_COST_MAP = {
    // Gemma models
    'groq:gemma2-9b-it:prompt_tokens': 20,
    'groq:gemma2-9b-it:completion_tokens': 20,
    'groq:gemma-7b-it:prompt_tokens': 7,
    'groq:gemma-7b-it:completion_tokens': 7,

    // Llama 3 Groq Tool Use Preview
    'groq:llama3-groq-70b-8192-tool-use-preview:prompt_tokens': 89,
    'groq:llama3-groq-70b-8192-tool-use-preview:completion_tokens': 89,
    'groq:llama3-groq-8b-8192-tool-use-preview:prompt_tokens': 19,
    'groq:llama3-groq-8b-8192-tool-use-preview:completion_tokens': 19,

    // Llama 3.1
    'groq:llama-3.1-70b-versatile:prompt_tokens': 59,
    'groq:llama-3.1-70b-versatile:completion_tokens': 79,
    'groq:llama-3.1-70b-specdec:prompt_tokens': 59,
    'groq:llama-3.1-70b-specdec:completion_tokens': 99,
    'groq:llama-3.1-8b-instant:prompt_tokens': 5,
    'groq:llama-3.1-8b-instant:completion_tokens': 8,

    // Llama Guard
    'groq:meta-llama/llama-guard-4-12b:prompt_tokens': 20,
    'groq:meta-llama/llama-guard-4-12b:completion_tokens': 20,
    'groq:llama-guard-3-8b:prompt_tokens': 20,
    'groq:llama-guard-3-8b:completion_tokens': 20,

    // Prompt Guard
    'groq:meta-llama/llama-prompt-guard-2-86m:prompt_tokens': 4,
    'groq:meta-llama/llama-prompt-guard-2-86m:completion_tokens': 4,

    // Llama 3.2 Preview
    'groq:llama-3.2-1b-preview:prompt_tokens': 4,
    'groq:llama-3.2-1b-preview:completion_tokens': 4,
    'groq:llama-3.2-3b-preview:prompt_tokens': 6,
    'groq:llama-3.2-3b-preview:completion_tokens': 6,
    'groq:llama-3.2-11b-vision-preview:prompt_tokens': 18,
    'groq:llama-3.2-11b-vision-preview:completion_tokens': 18,
    'groq:llama-3.2-90b-vision-preview:prompt_tokens': 90,
    'groq:llama-3.2-90b-vision-preview:completion_tokens': 90,

    // Llama 3 8k/70B
    'groq:llama3-70b-8192:prompt_tokens': 59,
    'groq:llama3-70b-8192:completion_tokens': 79,
    'groq:llama3-8b-8192:prompt_tokens': 5,
    'groq:llama3-8b-8192:completion_tokens': 8,

    // Mixtral
    'groq:mixtral-8x7b-32768:prompt_tokens': 24,
    'groq:mixtral-8x7b-32768:completion_tokens': 24,
};