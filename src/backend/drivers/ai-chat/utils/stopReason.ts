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

/**
 * Conversion between the Anthropic `stop_reason` vocabulary and the OpenAI
 * `finish_reason` vocabulary, in both directions. A reason with no analog on
 * the other side passes through verbatim — collapsing e.g. Anthropic's
 * `pause_turn` to `stop` would erase a "continue this turn" signal callers need
 * to act on.
 */

const STOP_TO_FINISH: Record<string, string> = {
    end_turn: 'stop',
    stop_sequence: 'stop',
    max_tokens: 'length',
    tool_use: 'tool_calls',
    refusal: 'content_filter',
};

const FINISH_TO_STOP: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    function_call: 'tool_use',
    content_filter: 'refusal',
};

/** Anthropic `stop_reason` → OpenAI `finish_reason`. */
export const toFinishReason = (
    stop: string | undefined | null,
): string | undefined => {
    if (typeof stop !== 'string' || stop === '') return undefined;
    return STOP_TO_FINISH[stop] ?? stop;
};

/** OpenAI `finish_reason` → Anthropic-vocabulary `stop_reason`. */
export const fromFinishReason = (
    finishReason: string | undefined | null,
): string | undefined => {
    if (typeof finishReason !== 'string' || finishReason === '') {
        return undefined;
    }
    return FINISH_TO_STOP[finishReason] ?? finishReason;
};

/**
 * Some providers report a bare `stop` / `end_turn` even on a turn that produced
 * tool calls — promote it to the tool-call vocabulary so a caller watching
 * `finish_reason`/`stop_reason` doesn't miss them. Any other reason (`length`,
 * `content_filter`, a provider-specific value) passes through.
 */
export function promoteStopForToolCalls(
    reason: string,
    sawToolCalls: boolean,
    toolCallReason: string,
): string;
export function promoteStopForToolCalls(
    reason: string | undefined,
    sawToolCalls: boolean,
    toolCallReason: string,
): string | undefined;
export function promoteStopForToolCalls(
    reason: string | undefined,
    sawToolCalls: boolean,
    toolCallReason: string,
): string | undefined {
    if (!sawToolCalls) return reason;
    return reason === 'stop' || reason === 'end_turn' ? toolCallReason : reason;
}
