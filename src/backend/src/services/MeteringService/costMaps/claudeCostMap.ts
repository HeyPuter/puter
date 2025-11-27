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
    // Claude Opus 4.5
    'claude:claude-opus-4-5:input_tokens': 500,
    'claude:claude-opus-4-5:ephemeral_5m_input_tokens': 500 * 1.25,
    'claude:claude-opus-4-5:ephemeral_1h_input_tokens': 500 * 2,
    'claude:claude-opus-4-5:cache_read_input_tokens': 500 * 0.1,
    'claude:claude-opus-4-5:output_tokens': 2500,

    'claude:claude-opus-4-5-20251101:input_tokens': 500,
    'claude:claude-opus-4-5-20251101:ephemeral_5m_input_tokens': 500 * 1.25,
    'claude:claude-opus-4-5-20251101:ephemeral_1h_input_tokens': 500 * 2,
    'claude:claude-opus-4-5-20251101:cache_read_input_tokens': 500 * 0.1,
    'claude:claude-opus-4-5-20251101:output_tokens': 2500,

    // Claude Sonnet 4.5
    'claude:claude-sonnet-4-5-20250929:input_tokens': 300,
    'claude:claude-sonnet-4-5-20250929:ephemeral_5m_input_tokens': 300 * 1.25,
    'claude:claude-sonnet-4-5-20250929:ephemeral_1h_input_tokens': 300 * 2,
    'claude:claude-sonnet-4-5-20250929:cache_read_input_tokens': 300 * 0.1,
    'claude:claude-sonnet-4-5-20250929:output_tokens': 1500,

    // Claude Opus 4.1
    'claude:claude-opus-4-1-20250805:input_tokens': 1500,
    'claude:claude-opus-4-1-20250805:ephemeral_5m_input_tokens': 1500 * 1.25,
    'claude:claude-opus-4-1-20250805:ephemeral_1h_input_tokens': 1500 * 2,
    'claude:claude-opus-4-1-20250805:cache_read_input_tokens': 1500 * 0.1,
    'claude:claude-opus-4-1-20250805:output_tokens': 7500,

    // Claude Opus 4
    'claude:claude-opus-4-20250514:input_tokens': 1500,
    'claude:claude-opus-4-20250514:ephemeral_5m_input_tokens': 1500 * 1.25,
    'claude:claude-opus-4-20250514:ephemeral_1h_input_tokens': 1500 * 2,
    'claude:claude-opus-4-20250514:cache_read_input_tokens': 1500 * 0.1,
    'claude:claude-opus-4-20250514:output_tokens': 7500,

    // Claude Sonnet 4
    'claude:claude-sonnet-4-20250514:input_tokens': 300,
    'claude:claude-sonnet-4-20250514:ephemeral_5m_input_tokens': 300 * 1.25,
    'claude:claude-sonnet-4-20250514:ephemeral_1h_input_tokens': 300 * 2,
    'claude:claude-sonnet-4-20250514:cache_read_input_tokens': 300 * 0.1,
    'claude:claude-sonnet-4-20250514:output_tokens': 1500,

    // Claude 3.7 Sonnet
    'claude:claude-3-7-sonnet-20250219:input_tokens': 300,
    'claude:claude-3-7-sonnet-20250219:ephemeral_5m_input_tokens': 300 * 1.25,
    'claude:claude-3-7-sonnet-20250219:ephemeral_1h_input_tokens': 300 * 2,
    'claude:claude-3-7-sonnet-20250219:cache_read_input_tokens': 300 * 0.1,
    'claude:claude-3-7-sonnet-20250219:output_tokens': 1500,

    // Claude 3.5 Sonnet (Oct 2024)
    'claude:claude-3-5-sonnet-20241022:input_tokens': 300,
    'claude:claude-3-5-sonnet-20241022:ephemeral_5m_input_tokens': 300 * 1.25,
    'claude:claude-3-5-sonnet-20241022:ephemeral_1h_input_tokens': 300 * 2,
    'claude:claude-3-5-sonnet-20241022:cache_read_input_tokens': 300 * 0.1,
    'claude:claude-3-5-sonnet-20241022:output_tokens': 1500,

    // Claude 3.5 Sonnet (June 2024)
    'claude:claude-3-5-sonnet-20240620:input_tokens': 300,
    'claude:claude-3-5-sonnet-20240620:ephemeral_5m_input_tokens': 300 * 1.25,
    'claude:claude-3-5-sonnet-20240620:ephemeral_1h_input_tokens': 300 * 2,
    'claude:claude-3-5-sonnet-20240620:cache_read_input_tokens': 300 * 0.1,
    'claude:claude-3-5-sonnet-20240620:output_tokens': 1500,

    // Claude 3 Haiku
    'claude:claude-3-haiku-20240307:input_tokens': 25,
    'claude:claude-3-haiku-20240307:ephemeral_5m_input_tokens': 25 * 1.25,
    'claude:claude-3-haiku-20240307:ephemeral_1h_input_tokens': 25 * 2,
    'claude:claude-3-haiku-20240307:cache_read_input_tokens': 25 * 0.1,
    'claude:claude-3-haiku-20240307:output_tokens': 125,
};