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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';
import { billableAudioSeconds } from './SpeechToTextProvider.js';

describe('billableAudioSeconds', () => {
    it('bills the reported seconds, rounded up', () => {
        expect(billableAudioSeconds(3.2, 60, 64_000)).toBe(4);
        expect(billableAudioSeconds(0.1, 60, 64_000)).toBe(1);
    });

    it('holds the reported seconds to what the file could contain', () => {
        // 125,000 bytes hold at most 1,000 seconds of audio.
        expect(billableAudioSeconds(2 ** 53, 60, 125_000)).toBe(1000);
        expect(billableAudioSeconds(1e308, 60, 125_000)).toBe(1000);
        expect(billableAudioSeconds(600, 28, 441_078)).toBe(600);
    });

    it('bills the estimate when nothing usable is reported', () => {
        for (const reported of [undefined, null, '42', NaN, Infinity, 0, -5]) {
            expect(billableAudioSeconds(reported, 60, 64_000)).toBe(60);
        }
    });
});
