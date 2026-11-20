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

import { describe, expect, it } from 'vitest';
import { toAnthropicContextManagement } from './contextManagement.js';

describe('toAnthropicContextManagement', () => {
    it('returns undefined when compaction is off', () => {
        expect(toAnthropicContextManagement({})).toBeUndefined();
    });

    it('builds a compact_20260112 edit from `true`', () => {
        expect(toAnthropicContextManagement({ compaction: true })).toEqual({
            edits: [{ type: 'compact_20260112' }],
        });
    });

    it('maps trigger_tokens to an input_tokens trigger', () => {
        expect(
            toAnthropicContextManagement({
                compaction: { trigger_tokens: 2000 },
            }),
        ).toEqual({
            edits: [
                {
                    type: 'compact_20260112',
                    trigger: { type: 'input_tokens', value: 2000 },
                },
            ],
        });
    });

    it('passes a raw context_management payload through verbatim', () => {
        const raw = { edits: [{ type: 'compact_20260112' }] };
        expect(
            toAnthropicContextManagement({ context_management: raw }),
        ).toBe(raw);
    });
});
