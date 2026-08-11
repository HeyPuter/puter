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

export const META_MODELS: IChatModel[] = [
    {
        puterId: 'meta:meta/muse-spark-1.2',
        id: 'meta:muse-spark-1.2',
        aliases: ['meta/muse-spark-1.2', 'muse-spark-1.2'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        context: 1048576,
        max_tokens: 8192,
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125, // micro-cents per token
            completion_tokens: 425, // micro-cents per token
            cached_tokens: 0,
        },
    },
    {
        puterId: 'meta:meta/muse-spark-1.1',
        id: 'meta:muse-spark-1.1',
        aliases: ['meta/muse-spark-1.1', 'muse-spark-1.1'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        context: 1048576,
        max_tokens: 8192,
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 125,
            completion_tokens: 425,
            cached_tokens: 0,
        },
    },
    {
        puterId: 'meta:meta/muse-code-1.0',
        id: 'meta:muse-code-1.0',
        aliases: ['meta/muse-code-1.0', 'muse-code-1.0'],
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        context: 1048576,
        max_tokens: 8192,
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 150,
            completion_tokens: 500,
            cached_tokens: 0,
        },
    },
];
