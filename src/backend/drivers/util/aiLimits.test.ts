/**
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
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import {
    resolveDriverMethodConcurrent,
    resolveDriverMethodRateLimit,
    validateDriverConcurrent,
    validateDriverRateLimit,
} from '../meta.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from './aiLimits.js';

// The shared AI policy is consumed verbatim by 8 drivers — these tests
// are the single guard against an accidental tuning slip (or a typo
// during a refactor) silently changing every AI driver's limits at once.

describe('AI_RATE_LIMIT', () => {
    it('pins the documented tier values', () => {
        expect(AI_RATE_LIMIT.default).toEqual({
            limit: 200,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 60,
                [DEFAULT_TEMP_SUBSCRIPTION]: 40,
            },
        });
    });

    it('passes the same validator the @Driver decorator runs at boot', () => {
        // If validation ever tightens, the AI policy must keep up.
        expect(() =>
            validateDriverRateLimit(AI_RATE_LIMIT, 'AI_RATE_LIMIT'),
        ).not.toThrow();
    });

    it('resolves the same spec for any method since only `default` is set', () => {
        const a = resolveDriverMethodRateLimit(AI_RATE_LIMIT, 'complete');
        const b = resolveDriverMethodRateLimit(AI_RATE_LIMIT, 'generate');
        expect(a).toEqual(b);
        expect(a).toBe(AI_RATE_LIMIT.default);
    });

    it('orders the tiers correctly: temp < free < base', () => {
        // Catches an accidental swap of the two subscription overrides.
        const base = AI_RATE_LIMIT.default!.limit;
        const free =
            AI_RATE_LIMIT.default!.bySubscription![DEFAULT_FREE_SUBSCRIPTION];
        const temp =
            AI_RATE_LIMIT.default!.bySubscription![DEFAULT_TEMP_SUBSCRIPTION];
        expect(temp).toBeLessThan(free);
        expect(free).toBeLessThan(base);
    });
});

describe('AI_CONCURRENT', () => {
    it('pins the documented tier values', () => {
        expect(AI_CONCURRENT.default).toEqual({
            limit: 20,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 6,
                [DEFAULT_TEMP_SUBSCRIPTION]: 4,
            },
        });
    });

    it('passes the same validator the @Driver decorator runs at boot', () => {
        expect(() =>
            validateDriverConcurrent(AI_CONCURRENT, 'AI_CONCURRENT'),
        ).not.toThrow();
    });

    it('resolves the same spec for any method since only `default` is set', () => {
        expect(resolveDriverMethodConcurrent(AI_CONCURRENT, 'complete')).toBe(
            AI_CONCURRENT.default,
        );
        expect(resolveDriverMethodConcurrent(AI_CONCURRENT, 'generate')).toBe(
            AI_CONCURRENT.default,
        );
    });

    it('orders the tiers correctly: temp < free < base', () => {
        const base = AI_CONCURRENT.default!.limit;
        const free =
            AI_CONCURRENT.default!.bySubscription![DEFAULT_FREE_SUBSCRIPTION];
        const temp =
            AI_CONCURRENT.default!.bySubscription![DEFAULT_TEMP_SUBSCRIPTION];
        expect(temp).toBeLessThan(free);
        expect(free).toBeLessThan(base);
    });
});
