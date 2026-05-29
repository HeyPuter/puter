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

const CONTEXT_WINDOW = 204_800;
const MAX_OUTPUT_TOKENS = 196_608;

type MiniMaxChatModel = IChatModel & {
    apiModel: string;
};

const minimaxModel = (
    apiModel: string,
    name: string,
    costs: IChatModel['costs'],
): MiniMaxChatModel => {
    const id = apiModel.toLowerCase();
    return {
        puterId: `minimax:minimax/${id}`,
        id,
        apiModel,
        name,
        aliases: [`minimax/${id}`, apiModel, `minimax/${apiModel}`],
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        tool_call: true,
        context: CONTEXT_WINDOW,
        max_tokens: MAX_OUTPUT_TOKENS,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs,
    };
};

// Hardcoded from MiniMax OpenAI-compatible API docs and pay-as-you-go pricing:
// https://platform.minimax.io/docs/api-reference/text-openai-api
// https://platform.minimax.io/docs/guides/pricing-paygo
export const MINIMAX_MODELS: MiniMaxChatModel[] = [
    minimaxModel('MiniMax-M2.7', 'MiniMax M2.7', usdPerMToken(0.3, 1.2, 0.06)),
    minimaxModel(
        'MiniMax-M2.7-highspeed',
        'MiniMax M2.7 Highspeed',
        usdPerMToken(0.6, 2.4, 0.06),
    ),
    minimaxModel('MiniMax-M2.5', 'MiniMax M2.5', usdPerMToken(0.3, 1.2, 0.03)),
    minimaxModel(
        'MiniMax-M2.5-highspeed',
        'MiniMax M2.5 Highspeed',
        usdPerMToken(0.6, 2.4, 0.03),
    ),
    minimaxModel('MiniMax-M2.1', 'MiniMax M2.1', usdPerMToken(0.3, 1.2, 0.03)),
    minimaxModel(
        'MiniMax-M2.1-highspeed',
        'MiniMax M2.1 Highspeed',
        usdPerMToken(0.6, 2.4, 0.03),
    ),
    minimaxModel('MiniMax-M2', 'MiniMax M2', usdPerMToken(0.3, 1.2, 0.03)),
];
