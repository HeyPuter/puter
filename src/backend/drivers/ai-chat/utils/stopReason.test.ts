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
import { fromFinishReason, toFinishReason } from './stopReason.js';

describe('toFinishReason', () => {
    it.each([
        ['end_turn', 'stop'],
        ['stop_sequence', 'stop'],
        ['max_tokens', 'length'],
        ['tool_use', 'tool_calls'],
        ['refusal', 'content_filter'],
    ])('maps %s to %s', (stop, expected) => {
        expect(toFinishReason(stop)).toBe(expected);
    });

    it('passes an unmapped vendor reason through verbatim', () => {
        expect(toFinishReason('pause_turn')).toBe('pause_turn');
    });

    it('returns undefined for an absent or empty reason', () => {
        expect(toFinishReason(undefined)).toBeUndefined();
        expect(toFinishReason(null)).toBeUndefined();
        expect(toFinishReason('')).toBeUndefined();
    });
});

describe('fromFinishReason', () => {
    it.each([
        ['stop', 'end_turn'],
        ['length', 'max_tokens'],
        ['tool_calls', 'tool_use'],
        ['function_call', 'tool_use'],
        ['content_filter', 'refusal'],
    ])('maps %s to %s', (finishReason, expected) => {
        expect(fromFinishReason(finishReason)).toBe(expected);
    });

    it('passes an unmapped finish reason through verbatim', () => {
        expect(fromFinishReason('something_else')).toBe('something_else');
    });

    it('returns undefined for an absent or empty reason', () => {
        expect(fromFinishReason(undefined)).toBeUndefined();
        expect(fromFinishReason(null)).toBeUndefined();
        expect(fromFinishReason('')).toBeUndefined();
    });
});
