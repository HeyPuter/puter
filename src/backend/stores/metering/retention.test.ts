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
import {
    DEFAULT_METERING_RETENTION_MONTHS,
    meteringRecordExpiresAt,
    resolveMeteringRetentionMonths,
} from './retention.ts';

describe('resolveMeteringRetentionMonths', () => {
    it('defaults to 3 months when unset', () => {
        expect(resolveMeteringRetentionMonths({})).toBe(
            DEFAULT_METERING_RETENTION_MONTHS,
        );
    });

    it('defaults when the configured value is not a finite number', () => {
        expect(
            resolveMeteringRetentionMonths({
                meteringRetentionMonths: Number.NaN,
            }),
        ).toBe(DEFAULT_METERING_RETENTION_MONTHS);
        expect(
            resolveMeteringRetentionMonths({
                meteringRetentionMonths: Infinity,
            }),
        ).toBe(DEFAULT_METERING_RETENTION_MONTHS);
    });

    it('turns retention off for zero or negative', () => {
        expect(
            resolveMeteringRetentionMonths({ meteringRetentionMonths: 0 }),
        ).toBe(0);
        expect(
            resolveMeteringRetentionMonths({ meteringRetentionMonths: -1 }),
        ).toBe(0);
    });

    it('uses a configured positive value', () => {
        expect(
            resolveMeteringRetentionMonths({ meteringRetentionMonths: 6 }),
        ).toBe(6);
    });

    it('floors a fractional value, treating anything under 1 as off', () => {
        expect(
            resolveMeteringRetentionMonths({ meteringRetentionMonths: 0.5 }),
        ).toBe(0);
        expect(
            resolveMeteringRetentionMonths({ meteringRetentionMonths: 3.9 }),
        ).toBe(3);
    });
});

describe('meteringRecordExpiresAt', () => {
    it('keeps a September record through the following January', () => {
        const expiresAt = meteringRecordExpiresAt(
            'metering:actor:u-1:2026-09',
            3,
        );
        expect(expiresAt).toBe(Date.UTC(2027, 0, 1) / 1000);
    });

    it('rolls a December record into the following April', () => {
        const expiresAt = meteringRecordExpiresAt(
            'metering:actor:u-1:2026-12',
            3,
        );
        expect(expiresAt).toBe(Date.UTC(2027, 3, 1) / 1000);
    });

    it('applies to every metering key shape, not just the actor total', () => {
        expect(
            meteringRecordExpiresAt('metering:actor:u-1:app:app-1:2026-09', 3),
        ).toBe(Date.UTC(2027, 0, 1) / 1000);
        expect(meteringRecordExpiresAt('metering:puter:412:2026-09', 3)).toBe(
            Date.UTC(2027, 0, 1) / 1000,
        );
    });

    it('applies to a v2 key the same way — it still starts with "metering:"', () => {
        expect(
            meteringRecordExpiresAt('metering:v2:actor:u-1:2026-09', 3),
        ).toBe(Date.UTC(2027, 0, 1) / 1000);
        expect(
            meteringRecordExpiresAt(
                'metering:v2:actor:u-1:detail:5:2026-09',
                3,
            ),
        ).toBe(Date.UTC(2027, 0, 1) / 1000);
        expect(
            meteringRecordExpiresAt('metering:v2:puter:412:2026-09', 3),
        ).toBe(Date.UTC(2027, 0, 1) / 1000);
    });

    it('is undefined for a key with no month suffix', () => {
        expect(
            meteringRecordExpiresAt('metering:actor:u-1:apps', 3),
        ).toBeUndefined();
        expect(
            meteringRecordExpiresAt('metering:lastGlobalUsageCheck', 3),
        ).toBeUndefined();
    });

    it('is undefined for a suffix that is not a valid month', () => {
        expect(
            meteringRecordExpiresAt('metering:actor:u-1:2026-13', 3),
        ).toBeUndefined();
        expect(
            meteringRecordExpiresAt('metering:actor:u-1:2026-00', 3),
        ).toBeUndefined();
    });

    it('is undefined for a key outside the metering prefix', () => {
        expect(
            meteringRecordExpiresAt('policy:actor:u-1:addons:2026-09', 3),
        ).toBeUndefined();
    });

    it('is undefined when retention is off', () => {
        expect(
            meteringRecordExpiresAt('metering:actor:u-1:2026-09', 0),
        ).toBeUndefined();
    });
});
