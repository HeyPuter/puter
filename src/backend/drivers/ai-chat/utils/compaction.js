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
 * Inline-compaction translation helpers.
 *
 * The driver-facing surface exposes a single provider-neutral opt-in
 * (`compaction: boolean | { trigger_tokens }` on `ICompleteArguments`), plus a
 * raw `context_management` escape hatch for callers hitting `/responses` with
 * the OpenAI-native shape. These helpers map that neutral opt-in to each
 * provider's SDK shape so the providers stay free of opt-in-parsing logic.
 */

/**
 * @param {boolean | { trigger_tokens?: number } | undefined} compaction
 * @returns {{ enabled: boolean, trigger_tokens?: number }}
 */
const readCompaction = (compaction) => {
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
 * Build OpenAI Responses `context_management` from the neutral opt-in. A raw
 * `context_management` passthrough (already in OpenAI shape) wins.
 *
 * @param {{ compaction?: boolean | { trigger_tokens?: number }, context_management?: unknown }} args
 * @returns {Array<{ type: 'compaction', compact_threshold?: number }> | undefined}
 */
export const toOpenAiContextManagement = (args) => {
    if (args.context_management !== undefined) {
        return /** @type {any} */ (args.context_management);
    }
    const { enabled, trigger_tokens } = readCompaction(args.compaction);
    if (!enabled) return undefined;
    return [
        {
            type: 'compaction',
            ...(trigger_tokens !== undefined
                ? { compact_threshold: trigger_tokens }
                : {}),
        },
    ];
};

/**
 * Build Anthropic `context_management` (beta `compact-2026-01-12`) from the
 * neutral opt-in. A raw `context_management` passthrough wins.
 *
 * @param {{ compaction?: boolean | { trigger_tokens?: number }, context_management?: unknown }} args
 * @returns {{ edits: Array<Record<string, unknown>> } | undefined}
 */
export const toAnthropicContextManagement = (args) => {
    if (args.context_management !== undefined) {
        return /** @type {any} */ (args.context_management);
    }
    const { enabled, trigger_tokens } = readCompaction(args.compaction);
    if (!enabled) return undefined;
    return {
        edits: [
            {
                type: 'compact_20260112',
                ...(trigger_tokens !== undefined
                    ? {
                          trigger: {
                              type: 'input_tokens',
                              value: trigger_tokens,
                          },
                      }
                    : {}),
            },
        ],
    };
};

/**
 * Whether the request opted into inline compaction by any route.
 *
 * @param {{ compaction?: boolean | { trigger_tokens?: number }, context_management?: unknown }} args
 */
export const wantsCompaction = (args) =>
    args.context_management !== undefined ||
    readCompaction(args.compaction).enabled;

/**
 * Whether the (normalized) message list carries a round-tripped compaction
 * artifact. Such a request must route through a compaction-capable surface even
 * if it didn't request *new* compaction — chat.completions can't represent a
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
