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

import type { IChatModel } from '../../types.js';

type MiniMaxChatModel = IChatModel & {
    apiModel: string;
};

// Hardcoded from MiniMax OpenAI-compatible API docs and pay-as-you-go pricing:
// https://platform.minimax.io/docs/api-reference/text-openai-api
// https://platform.minimax.io/docs/guides/pricing-paygo
export const MINIMAX_MODELS: MiniMaxChatModel[] = [
    // -- MiniMax M3 (Flagship) --------------------------------------
    // MiniMax Sparse Attention, 1M context, native multimodal input.
    {
        puterId: 'minimax:minimax/minimax-m3',
        id: 'minimax-m3',
        apiModel: 'MiniMax-M3',
        name: 'MiniMax M3',
        aliases: ['minimax/minimax-m3', 'MiniMax-M3', 'minimax/MiniMax-M3'],
        modalities: { input: ['text', 'image', 'video'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 1_048_576,
        max_tokens: 512_000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30, // $0.30 per 1M (input <= 512k tokens)
            completion_tokens: 120, // $1.20 per 1M
            cached_tokens: 6, // $0.06 per 1M
        },
    },

    // -- MiniMax M2.7 -----------------------------------------------
    {
        puterId: 'minimax:minimax/minimax-m2.7',
        id: 'minimax-m2.7',
        apiModel: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        aliases: [
            'minimax/minimax-m2.7',
            'MiniMax-M2.7',
            'minimax/MiniMax-M2.7',
        ],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30, // $0.30 per 1M
            completion_tokens: 120, // $1.20 per 1M
            cached_tokens: 6, // $0.06 per 1M
        },
    },
    {
        puterId: 'minimax:minimax/minimax-m2.7-highspeed',
        id: 'minimax-m2.7-highspeed',
        apiModel: 'MiniMax-M2.7-highspeed',
        name: 'MiniMax M2.7 Highspeed',
        aliases: [
            'minimax/minimax-m2.7-highspeed',
            'MiniMax-M2.7-highspeed',
            'minimax/MiniMax-M2.7-highspeed',
        ],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 60, // $0.60 per 1M
            completion_tokens: 240, // $2.40 per 1M
            cached_tokens: 6, // $0.06 per 1M
        },
    },

    // -- MiniMax M2.5 -----------------------------------------------
    {
        puterId: 'minimax:minimax/minimax-m2.5',
        id: 'minimax-m2.5',
        apiModel: 'MiniMax-M2.5',
        name: 'MiniMax M2.5',
        aliases: [
            'minimax/minimax-m2.5',
            'MiniMax-M2.5',
            'minimax/MiniMax-M2.5',
        ],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30, // $0.30 per 1M
            completion_tokens: 120, // $1.20 per 1M
            cached_tokens: 3, // $0.03 per 1M
        },
    },
    {
        puterId: 'minimax:minimax/minimax-m2.5-highspeed',
        id: 'minimax-m2.5-highspeed',
        apiModel: 'MiniMax-M2.5-highspeed',
        name: 'MiniMax M2.5 Highspeed',
        aliases: [
            'minimax/minimax-m2.5-highspeed',
            'MiniMax-M2.5-highspeed',
            'minimax/MiniMax-M2.5-highspeed',
        ],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 60, // $0.60 per 1M
            completion_tokens: 240, // $2.40 per 1M
            cached_tokens: 3, // $0.03 per 1M
        },
    },

    // -- MiniMax M2.1 -----------------------------------------------
    {
        puterId: 'minimax:minimax/minimax-m2.1',
        id: 'minimax-m2.1',
        apiModel: 'MiniMax-M2.1',
        name: 'MiniMax M2.1',
        aliases: [
            'minimax/minimax-m2.1',
            'MiniMax-M2.1',
            'minimax/MiniMax-M2.1',
        ],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30, // $0.30 per 1M
            completion_tokens: 120, // $1.20 per 1M
            cached_tokens: 3, // $0.03 per 1M
        },
    },
    {
        puterId: 'minimax:minimax/minimax-m2.1-highspeed',
        id: 'minimax-m2.1-highspeed',
        apiModel: 'MiniMax-M2.1-highspeed',
        name: 'MiniMax M2.1 Highspeed',
        aliases: [
            'minimax/minimax-m2.1-highspeed',
            'MiniMax-M2.1-highspeed',
            'minimax/MiniMax-M2.1-highspeed',
        ],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 60, // $0.60 per 1M
            completion_tokens: 240, // $2.40 per 1M
            cached_tokens: 3, // $0.03 per 1M
        },
    },

    // -- MiniMax M2 -------------------------------------------------
    {
        puterId: 'minimax:minimax/minimax-m2',
        id: 'minimax-m2',
        apiModel: 'MiniMax-M2',
        name: 'MiniMax M2',
        aliases: ['minimax/minimax-m2', 'MiniMax-M2', 'minimax/MiniMax-M2'],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: 204_800,
        max_tokens: 196_608,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 30, // $0.30 per 1M
            completion_tokens: 120, // $1.20 per 1M
            cached_tokens: 3, // $0.03 per 1M
        },
    },
];
