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
import { usdPerMToken } from '../../utils/pricing.js';

export const MUSE_SPARK_DEFAULT_MODEL = 'muse-spark-1.2';

const museSpark = (model: {
    id: string;
    name: string;
    context: number;
    maxTokens: number;
    releaseDate: string;
    inputModalities: string[];
    costs: IChatModel['costs'];
}): IChatModel => ({
    puterId: `meta:meta/${model.id}`,
    id: model.id,
    name: model.name,
    aliases: [`meta/${model.id}`],
    modalities: { input: model.inputModalities, output: ['text'] },
    open_weights: false,
    tool_call: true,
    release_date: model.releaseDate,
    context: model.context,
    max_tokens: model.maxTokens,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs: model.costs,
});

// Hardcoded from https://models.dev/api.json and
// https://dev.meta.ai/docs/pricing-rate-limits.
//
// Meta also sells `muse-spark-1.2-contributor`: the same checkpoint at a tenth
// of the price in exchange for permission to train on the prompts and
// completions it serves. It stays out of this catalog — it needs a separate
// enrolment (a standard-tier key gets `model_not_found`), and its input rate
// would make it the cheapest route in the bucket, so listing it would quietly
// route callers' prompts into Meta's training set.
export const META_MODELS: IChatModel[] = [
    museSpark({
        id: 'muse-spark-1.2',
        name: 'Muse Spark 1.2',
        context: 1_048_576,
        maxTokens: 131_072,
        releaseDate: '2026-08-05',
        inputModalities: ['text', 'image', 'video', 'audio', 'pdf'],
        costs: usdPerMToken(1.25, 4.25, 0.15),
    }),
    museSpark({
        id: 'muse-spark-1.1',
        name: 'Muse Spark 1.1',
        context: 1_048_576,
        maxTokens: 32_000,
        releaseDate: '2026-04-08',
        inputModalities: ['text', 'image', 'video', 'pdf'],
        costs: usdPerMToken(1.25, 4.25, 0.15),
    }),
];
