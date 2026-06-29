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
import { AppOriginBlocklistService } from './AppOriginBlocklistService.js';

type Row = {
    domain: string;
    include_subdomains: number;
    reason?: string | null;
};

const makeService = (
    rows: Row[],
    read?: () => Promise<unknown>,
): { service: AppOriginBlocklistService; reads: { count: number } } => {
    const reads = { count: 0 };
    const db = {
        read:
            read ??
            (async () => {
                reads.count++;
                return rows;
            }),
    };
    const service = new AppOriginBlocklistService(
        {} as never,
        { db } as never,
        {} as never,
        {} as never,
    );
    return { service, reads };
};

describe('AppOriginBlocklistService', () => {
    describe('isHostBlocked — exact entries', () => {
        it('matches the exact host only', async () => {
            const { service } = makeService([
                { domain: 'some.evil.com', include_subdomains: 0 },
            ]);
            expect(await service.isHostBlocked('some.evil.com')).toEqual({
                blocked: true,
                reason: undefined,
            });
            expect((await service.isHostBlocked('evil.com')).blocked).toBe(
                false,
            );
            expect(
                (await service.isHostBlocked('x.some.evil.com')).blocked,
            ).toBe(false);
        });
    });

    describe('isHostBlocked — include_subdomains entries', () => {
        it('matches the apex and any subdomain, but not lookalikes', async () => {
            const { service } = makeService([
                { domain: 'evil.com', include_subdomains: 1, reason: 'abuse' },
            ]);
            expect(await service.isHostBlocked('evil.com')).toEqual({
                blocked: true,
                reason: 'abuse',
            });
            expect((await service.isHostBlocked('a.evil.com')).blocked).toBe(
                true,
            );
            expect((await service.isHostBlocked('a.b.evil.com')).blocked).toBe(
                true,
            );
            // Suffix-but-not-subdomain must NOT match.
            expect((await service.isHostBlocked('notevil.com')).blocked).toBe(
                false,
            );
            expect((await service.isHostBlocked('evil.com.org')).blocked).toBe(
                false,
            );
        });
    });

    describe('normalization', () => {
        it('lowercases, strips port, and ignores empty input', async () => {
            const { service } = makeService([
                { domain: 'evil.com', include_subdomains: 1 },
            ]);
            expect((await service.isHostBlocked('A.EVIL.COM')).blocked).toBe(
                true,
            );
            expect(
                (await service.isHostBlocked('a.evil.com:8080')).blocked,
            ).toBe(true);
            expect((await service.isHostBlocked('')).blocked).toBe(false);
        });

        it('normalizes stored entries too (uppercase/leading dot)', async () => {
            const { service } = makeService([
                { domain: '.Evil.COM', include_subdomains: 1 },
            ]);
            expect((await service.isHostBlocked('a.evil.com')).blocked).toBe(
                true,
            );
        });
    });

    describe('isOriginBlocked', () => {
        it('extracts the host from a full URL', async () => {
            const { service } = makeService([
                { domain: 'evil.com', include_subdomains: 1 },
            ]);
            expect(
                (await service.isOriginBlocked('https://app.evil.com/path?q=1'))
                    .blocked,
            ).toBe(true);
            expect(
                (await service.isOriginBlocked('https://good.com/')).blocked,
            ).toBe(false);
        });

        it('accepts a scheme-less origin', async () => {
            const { service } = makeService([
                { domain: 'evil.com', include_subdomains: 0 },
            ]);
            expect((await service.isOriginBlocked('evil.com')).blocked).toBe(
                true,
            );
        });
    });

    describe('caching', () => {
        it('reuses the cached snapshot within the TTL', async () => {
            const { service, reads } = makeService([
                { domain: 'evil.com', include_subdomains: 0 },
            ]);
            await service.isHostBlocked('evil.com');
            await service.isHostBlocked('evil.com');
            expect(reads.count).toBe(1);
        });

        it('reloads after invalidate()', async () => {
            const { service, reads } = makeService([
                { domain: 'evil.com', include_subdomains: 0 },
            ]);
            await service.isHostBlocked('evil.com');
            service.invalidate();
            await service.isHostBlocked('evil.com');
            expect(reads.count).toBe(2);
        });
    });

    describe('resilience', () => {
        it('fails open (not blocked) when the DB read throws', async () => {
            const { service } = makeService([], async () => {
                throw new Error('no such table: blocked_app_origins');
            });
            expect((await service.isHostBlocked('evil.com')).blocked).toBe(
                false,
            );
        });
    });
});
