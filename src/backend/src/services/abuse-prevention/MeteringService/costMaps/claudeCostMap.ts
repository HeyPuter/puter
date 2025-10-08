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

export const CLAUDE_COST_MAP = {
    // Claude Sonnet 4.5
    "claude:claude-sonnet-4-5-20250929:input": 300,
    "claude:claude-sonnet-4-5-20250929:output": 1500,

    // Claude Opus 4.1
    "claude:claude-opus-4-1-20250805:input": 1500,
    "claude:claude-opus-4-1-20250805:output": 7500,

    // Claude Opus 4
    "claude:claude-opus-4-20250514:input": 1500,
    "claude:claude-opus-4-20250514:output": 7500,

    // Claude Sonnet 4
    "claude:claude-sonnet-4-20250514:input": 300,
    "claude:claude-sonnet-4-20250514:output": 1500,

    // Claude 3.7 Sonnet
    "claude:claude-3-7-sonnet-20250219:input": 300,
    "claude:claude-3-7-sonnet-20250219:output": 1500,

    // Claude 3.5 Sonnet (Oct 2024)
    "claude:claude-3-5-sonnet-20241022:input": 300,
    "claude:claude-3-5-sonnet-20241022:output": 1500,

    // Claude 3.5 Sonnet (June 2024)
    "claude:claude-3-5-sonnet-20240620:input": 300,
    "claude:claude-3-5-sonnet-20240620:output": 1500,

    // Claude 3 Haiku
    "claude:claude-3-haiku-20240307:input": 25,
    "claude:claude-3-haiku-20240307:output": 125,
};