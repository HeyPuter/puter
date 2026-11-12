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
import { messagesHaveCompaction, wantsCompaction } from './compaction.js';

describe('wantsCompaction', () => {
    it('is false without opt-in', () => {
        expect(wantsCompaction({})).toBe(false);
        expect(wantsCompaction({ compaction: false })).toBe(false);
    });

    it('is true for the neutral opt-in or a raw passthrough', () => {
        expect(wantsCompaction({ compaction: true })).toBe(true);
        expect(wantsCompaction({ compaction: { trigger_tokens: 1 } })).toBe(
            true,
        );
        expect(wantsCompaction({ context_management: [] })).toBe(true);
    });
});

describe('messagesHaveCompaction', () => {
    it('detects a round-tripped compaction content block', () => {
        expect(
            messagesHaveCompaction([
                { role: 'user', content: [{ type: 'text', text: 'hi' }] },
                {
                    role: 'assistant',
                    content: [
                        { type: 'compaction', encrypted_content: 'ENC' },
                    ],
                },
            ]),
        ).toBe(true);
    });

    it('is false for ordinary messages or non-arrays', () => {
        expect(
            messagesHaveCompaction([
                { role: 'user', content: [{ type: 'text', text: 'hi' }] },
            ]),
        ).toBe(false);
        expect(messagesHaveCompaction(undefined)).toBe(false);
        expect(messagesHaveCompaction('nope')).toBe(false);
    });
});
