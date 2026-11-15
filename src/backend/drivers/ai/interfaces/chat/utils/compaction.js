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
 * Inline-compaction opt-in helpers.
 *
 * The driver-facing surface exposes a single provider-neutral opt-in
 * (`compaction: boolean | { trigger_tokens }` on `ICompleteArguments`), plus a
 * raw `context_management` escape hatch for callers hitting `/responses` with
 * the OpenAI-native shape. This module reads the opt-in; each dialect maps it
 * to its own SDK shape (`toOpenAiContextManagement` in the OpenAI protocol,
 * `toAnthropicContextManagement` in the Claude provider).
 */

/**
 * @param {boolean | { trigger_tokens?: number } | undefined} compaction
 * @returns {{ enabled: boolean; trigger_tokens?: number }}
 */
export const readCompaction = (compaction) => {
    if (compaction === true) return { enabled: true };
    if (compaction && typeof compaction === 'object') {
        return {
            enabled: true,
            ...(typeof compaction.trigger_tokens === 'number'
                ? { trigger_tokens: compaction.trigger_tokens }
                : {}),
        };
    }
    return { enabled: false };
};

/**
 * Whether the request opted into inline compaction by any route.
 *
 * @param {{
 *     compaction?: boolean | { trigger_tokens?: number };
 *     context_management?: unknown;
 * }} args
 */
export const wantsCompaction = (args) =>
    args.context_management !== undefined ||
    readCompaction(args.compaction).enabled;

/**
 * Whether the (normalized) message list carries a round-tripped compaction
 * artifact. Such a request must route through a compaction-capable surface even
 * if it didn't request _new_ compaction — chat.completions can't represent a
 * compaction content block, and Anthropic needs its compaction beta to accept
 * one as input.
 *
 * @param {unknown} messages
 */
export const messagesHaveCompaction = (messages) =>
    Array.isArray(messages) &&
    messages.some(
        (m) =>
            Array.isArray(m?.content) &&
            m.content.some((c) => c && c.type === 'compaction'),
    );
