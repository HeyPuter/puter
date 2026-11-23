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
import { estimateTextTokens } from '../../shared/tokenEstimate.js';
import {
    estimateImagePromptTokens,
    reportedTokenCount,
} from './imageTokens.js';

describe('estimateImagePromptTokens', () => {
    it('estimates the trimmed prompt, at least one token', () => {
        expect(estimateImagePromptTokens('  a red fox in snow  ')).toBe(
            Math.max(1, estimateTextTokens('a red fox in snow')),
        );
        expect(estimateImagePromptTokens('a')).toBeGreaterThanOrEqual(1);
    });

    it('is zero for a blank prompt', () => {
        expect(estimateImagePromptTokens('   ')).toBe(0);
    });
});

describe('reportedTokenCount', () => {
    it('floors a usable count', () => {
        expect(reportedTokenCount(0)).toBe(0);
        expect(reportedTokenCount(1290)).toBe(1290);
        expect(reportedTokenCount(12.7)).toBe(12);
    });

    it('reads anything else as zero', () => {
        for (const value of [-1, Number.NaN, Infinity, '12', null, undefined]) {
            expect(reportedTokenCount(value)).toBe(0);
        }
    });
});
