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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { CreditHoldStore } from './CreditHoldStore.js';

let server: PuterServer;
let store: CreditHoldStore;

const user = () => `hold-user-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.creditHold as CreditHoldStore;
});

afterAll(async () => {
    await server?.shutdown();
});

describe('CreditHoldStore', () => {
    it('sums what an actor has taken', async () => {
        const id = user();
        expect(await store.outstanding(id)).toBe(0);

        await store.take(id, 1000);
        await store.take(id, 250);

        expect(await store.outstanding(id)).toBe(1250);
    });

    it('gives budget back on release', async () => {
        const id = user();
        const first = await store.take(id, 1000);
        await store.take(id, 500);

        await store.release(id, first);

        expect(await store.outstanding(id)).toBe(500);
    });

    it('releases at most once', async () => {
        const id = user();
        const member = await store.take(id, 900);
        await store.release(id, member);
        await store.release(id, member);

        expect(await store.outstanding(id)).toBe(0);
    });

    it('keeps actors separate', async () => {
        const [a, b] = [user(), user()];
        await store.take(a, 700);

        expect(await store.outstanding(b)).toBe(0);
    });

    // A deployment that dies mid-request never releases; without a deadline
    // the account would be short that budget until the month turned over.
    it('drops holds nobody released once they expire', async () => {
        const id = user();
        await store.take(id, 5000, 50);
        expect(await store.outstanding(id)).toBe(5000);

        await vi.waitFor(
            async () => {
                expect(await store.outstanding(id)).toBe(0);
            },
            { timeout: 2000, interval: 25 },
        );
    });

    // All of an actor's holds share one redis key, so a short-lived hold must
    // never pull the key's expiry in under a longer-lived one — key expiry
    // drops every hold in the set at once.
    it('never shortens the hold set’s expiry under a longer-lived hold', async () => {
        const id = user();
        await store.take(id, 1000); // default 10-minute TTL
        await store.take(id, 500, 50); // much shorter TTL

        const redis = server.clients.redis as unknown as {
            pttl: (key: string) => Promise<number>;
        };
        const pttl = await redis.pttl(`meter:holds:{${id}}`);
        // Still on the long hold's clock, not the short one's.
        expect(pttl).toBeGreaterThan(500_000);
    });

    it('refresh pushes a hold’s deadline out for a still-running operation', async () => {
        const id = user();
        const member = await store.take(id, 800, 50);

        await store.refresh(id, member); // default 10-minute TTL

        // Well past the original 50ms deadline, the hold is still counted.
        await new Promise((r) => setTimeout(r, 100));
        expect(await store.outstanding(id)).toBe(800);
    });

    it('ignores amounts that aren’t worth holding', async () => {
        const id = user();
        expect(await store.take(id, 0)).toBeNull();
        expect(await store.take(id, -5)).toBeNull();
        expect(await store.take(id, Number.NaN)).toBeNull();
        expect(await store.outstanding(id)).toBe(0);
    });

    // Holds gate spending, so an unreachable cache has to mean "no holds", not
    // "no spending" — the alternative is a cache blip presenting as every
    // account being out of credit.
    it('reads zero rather than failing when the cache is unreachable', async () => {
        const id = user();
        await store.take(id, 4000);

        const redis = server.clients.redis as unknown as {
            creditHoldSum: () => Promise<unknown>;
        };
        const spy = vi
            .spyOn(redis, 'creditHoldSum')
            .mockRejectedValue(new Error('cache down'));

        expect(await store.outstanding(id)).toBe(0);
        spy.mockRestore();
    });
});
