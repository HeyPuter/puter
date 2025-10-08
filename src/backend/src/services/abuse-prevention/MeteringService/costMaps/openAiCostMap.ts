
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
    "openai:gpt-5-2025-08-07:input": 125,
    "openai:gpt-5-2025-08-07:output": 1000,
    "openai:gpt-5-mini-2025-08-07:input": 25,
    "openai:gpt-5-mini-2025-08-07:output": 200,
    "openai:gpt-5-nano-2025-08-07:input": 5,
    "openai:gpt-5-nano-2025-08-07:output": 40,
    "openai:gpt-5-chat-latest:input": 125,
    "openai:gpt-5-chat-latest:output": 1000,

    // GPT-4o models
    "openai:gpt-4o:input": 250,
    "openai:gpt-4o:output": 1000,
    "openai:gpt-4o-mini:input": 15,
    "openai:gpt-4o-mini:output": 60,

    // O1 models
    "openai:o1:input": 1500,
    "openai:o1:output": 6000,
    "openai:o1-mini:input": 300,
    "openai:o1-mini:output": 1200,
    "openai:o1-pro:input": 15000,
    "openai:o1-pro:output": 60000,

    // O3 models
    "openai:o3:input": 1000,
    "openai:o3:output": 4000,
    "openai:o3-mini:input": 110,
    "openai:o3-mini:output": 440,

    // O4 models
    "openai:o4-mini:input": 110,
    "openai:o4-mini:output": 440,

    // GPT-4.1 models
    "openai:gpt-4.1:input": 200,
    "openai:gpt-4.1:output": 800,
    "openai:gpt-4.1-mini:input": 40,
    "openai:gpt-4.1-mini:output": 160,
    "openai:gpt-4.1-nano:input": 10,
    "openai:gpt-4.1-nano:output": 40,

    // GPT-4.5 preview
    "openai:gpt-4.5-preview:input": 7500,
    "openai:gpt-4.5-preview:output": 15000,
};
