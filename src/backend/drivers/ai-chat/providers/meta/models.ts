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

const K = 1_000;

// The whole Muse Spark line shares a 1M-token context and a 128K output
// ceiling. Reasoning tokens are billed as output and count against the
// ceiling, so there is no separate thinking rate to track.
const CONTEXT = 1_048_576;
const MAX_OUTPUT = 128 * K;

// Muse Spark takes text, image, video, audio and PDF, and returns text.
const MULTIMODAL = ['text', 'image', 'video', 'audio', 'pdf'];

const metaModel = (
    id: string,
    name: string,
    costs: IChatModel['costs'],
    description: string,
): IChatModel => ({
    puterId: `meta:meta/${id}`,
    id,
    name,
    aliases: [`meta/${id}`],
    description,
    modalities: { input: MULTIMODAL, output: ['text'] },
    open_weights: false,
    tool_call: true,
    context: CONTEXT,
    max_tokens: MAX_OUTPUT,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs,
});

// Hardcoded from https://ai.developer.meta.com/docs/models/ (catalog) and
// https://ai.developer.meta.com/docs/pricing-rate-limits/ (rate card).
//
// `muse-spark-1.2-contributor` is documented alongside these — the same
// weights at a twelfth of the price in exchange for Meta training on what is
// sent to it — but it is not listed by `GET /models` and answers 404, so the
// discount tier evidently has to be enabled on the account first. It is left
// out rather than advertised as a model we can't serve; add it back with the
// standard rates swapped for usdPerMToken(0.1, 0.2, 0.002) once an enrolled
// key confirms it, and keep it free of any alias the entries below answer to
// so its training terms can never capture their traffic.
export const META_MODELS: IChatModel[] = [
    metaModel(
        'muse-spark-1.2',
        'Muse Spark 1.2',
        usdPerMToken(1.25, 4.25, 0.15),
        'Reasoning model optimized for coding and long-horizon agentic work. Prompts are not used to train Meta models.',
    ),
    metaModel(
        'muse-spark-1.1',
        'Muse Spark 1.1',
        usdPerMToken(1.25, 4.25, 0.15),
        'Previous-generation Muse Spark reasoning model. Prompts are not used to train Meta models.',
    ),
];
