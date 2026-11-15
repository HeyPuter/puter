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

import type { ICompleteArguments } from '../../../interfaces/chat/types.js';
import { readCompaction } from '../../../interfaces/chat/utils/compaction.js';

/**
 * Anthropic `context_management` (beta `compact-2026-01-12`) from the neutral
 * `compaction` opt-in. A raw `context_management` passthrough wins.
 */
export const toAnthropicContextManagement = (
    args: Pick<ICompleteArguments, 'compaction' | 'context_management'>,
): { edits: Record<string, unknown>[] } | undefined => {
    if (args.context_management !== undefined) {
        return args.context_management as { edits: Record<string, unknown>[] };
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
