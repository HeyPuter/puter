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
    "groq:gemma2-9b-it:input": 20,
    "groq:gemma2-9b-it:output": 20,
    "groq:gemma-7b-it:input": 7,
    "groq:gemma-7b-it:output": 7,

    // Llama 3 Groq Tool Use Preview
    "groq:llama3-groq-70b-8192-tool-use-preview:input": 89,
    "groq:llama3-groq-70b-8192-tool-use-preview:output": 89,
    "groq:llama3-groq-8b-8192-tool-use-preview:input": 19,
    "groq:llama3-groq-8b-8192-tool-use-preview:output": 19,

    // Llama 3.1
    "groq:llama-3.1-70b-versatile:input": 59,
    "groq:llama-3.1-70b-versatile:output": 79,
    "groq:llama-3.1-70b-specdec:input": 59,
    "groq:llama-3.1-70b-specdec:output": 99,
    "groq:llama-3.1-8b-instant:input": 5,
    "groq:llama-3.1-8b-instant:output": 8,

    // Llama Guard
    "groq:meta-llama/llama-guard-4-12b:input": 20,
    "groq:meta-llama/llama-guard-4-12b:output": 20,
    "groq:llama-guard-3-8b:input": 20,
    "groq:llama-guard-3-8b:output": 20,

    // Prompt Guard
    "groq:meta-llama/llama-prompt-guard-2-86m:input": 4,
    "groq:meta-llama/llama-prompt-guard-2-86m:output": 4,

    // Llama 3.2 Preview
    "groq:llama-3.2-1b-preview:input": 4,
    "groq:llama-3.2-1b-preview:output": 4,
    "groq:llama-3.2-3b-preview:input": 6,
    "groq:llama-3.2-3b-preview:output": 6,
    "groq:llama-3.2-11b-vision-preview:input": 18,
    "groq:llama-3.2-11b-vision-preview:output": 18,
    "groq:llama-3.2-90b-vision-preview:input": 90,
    "groq:llama-3.2-90b-vision-preview:output": 90,

    // Llama 3 8k/70B
    "groq:llama3-70b-8192:input": 59,
    "groq:llama3-70b-8192:output": 79,
    "groq:llama3-8b-8192:input": 5,
    "groq:llama3-8b-8192:output": 8,

    // Mixtral
    "groq:mixtral-8x7b-32768:input": 24,
    "groq:mixtral-8x7b-32768:output": 24,
};