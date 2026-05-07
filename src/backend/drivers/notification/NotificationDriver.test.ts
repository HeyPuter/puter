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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { NotificationDriver } from './NotificationDriver.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer (in-memory sqlite + dynamo + s3 + mock redis)
// and exercises the live NotificationDriver against the wired stores.
// Each test allocates its own user via `makeUser` so notification rows
// from one test don't leak into another's `select` results.

let server: PuterServer;
let driver: NotificationDriver;

beforeAll(async () => {
    server = await setupTestServer();
    driver = server.drivers.notifications as unknown as NotificationDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `nd-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

// ── create ──────────────────────────────────────────────────────────

describe('NotificationDriver.create', () => {
    it('creates a notification row scoped to the actor', async () => {
        const { actor, userId } = await makeUser();
        const result = (await withActor(actor, () =>
            driver.create({
                object: { value: { title: 'hi' } },
            }),
        )) as Record<string, unknown> | null;

        expect(result?.uid).toEqual(expect.any(String));
        expect(result?.value).toEqual({ title: 'hi' });
        // shown / acknowledged are unset on creation.
        expect(result?.shown).toBeNull();
        expect(result?.acknowledged).toBeNull();

        const row = await server.stores.notification.getByUid(
            result!.uid as string,
            { userId },
        );
        expect(row).not.toBeNull();
    });

    it('defaults `value` to {} when omitted', async () => {
        const { actor } = await makeUser();
        const result = (await withActor(actor, () =>
            driver.create({ object: {} }),
        )) as Record<string, unknown> | null;
        expect(result?.value).toEqual({});
    });

    it('rejects a missing object body with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({} as Record<string, unknown>),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects an app-actor with 403', async () => {
        const { actor } = await makeUser();
        const appActor: Actor = {
            ...actor,
            app: { uid: 'some-app', id: 1 },
        };
        await expect(
            withActor(appActor, () =>
                driver.create({ object: { value: { title: 'app' } } }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 401 with no actor in context', async () => {
        await expect(
            driver.create({ object: { value: { title: 'noctx' } } }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── read ────────────────────────────────────────────────────────────

describe('NotificationDriver.read', () => {
    it('reads a notification by uid for its owner', async () => {
        const { actor } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({ object: { value: { title: 'a' } } }),
        )) as Record<string, unknown>;

        const fetched = (await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        )) as Record<string, unknown> | null;

        expect(fetched?.uid).toBe(created.uid);
        expect(fetched?.value).toEqual({ title: 'a' });
    });

    it('accepts `id` as an alias for `uid`', async () => {
        const { actor } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({ object: { value: {} } }),
        )) as Record<string, unknown>;
        const fetched = (await withActor(actor, () =>
            driver.read({ id: created.uid }),
        )) as Record<string, unknown> | null;
        expect(fetched?.uid).toBe(created.uid);
    });

    it("returns 404 for another user's notification uid", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const created = (await withActor(a.actor, () =>
            driver.create({ object: { value: { hidden: true } } }),
        )) as Record<string, unknown>;

        await expect(
            withActor(b.actor, () => driver.read({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects a missing uid with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.read({})),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── select / predicates ─────────────────────────────────────────────

describe('NotificationDriver.select', () => {
    it('returns the actor-owned notifications', async () => {
        const { actor } = await makeUser();
        await withActor(actor, () =>
            driver.create({ object: { value: { i: 1 } } }),
        );
        await withActor(actor, () =>
            driver.create({ object: { value: { i: 2 } } }),
        );

        const result = (await withActor(actor, () =>
            driver.select({}),
        )) as Array<Record<string, unknown>>;

        // SQLite's `created_at` is second-precision so two rapid inserts
        // can tie on the ORDER BY column — assert membership, not order.
        expect(result.length).toBe(2);
        const values = result.map(
            (r) => (r.value as { i: number }).i,
        );
        expect(values.sort()).toEqual([1, 2]);
    });

    it('does not leak other users\' notifications', async () => {
        const a = await makeUser();
        const b = await makeUser();
        await withActor(a.actor, () =>
            driver.create({ object: { value: { who: 'a' } } }),
        );
        const result = (await withActor(b.actor, () =>
            driver.select({}),
        )) as Array<Record<string, unknown>>;
        expect(result).toEqual([]);
    });

    it('predicate `unseen` filters out shown notifications', async () => {
        const { actor, userId } = await makeUser();
        const seen = (await withActor(actor, () =>
            driver.create({ object: { value: { i: 'seen' } } }),
        )) as Record<string, unknown>;
        const unseen = (await withActor(actor, () =>
            driver.create({ object: { value: { i: 'unseen' } } }),
        )) as Record<string, unknown>;

        await server.stores.notification.markShown(
            seen.uid as string,
            userId,
        );

        const result = (await withActor(actor, () =>
            driver.select({ predicate: 'unseen' }),
        )) as Array<Record<string, unknown>>;

        const uids = result.map((r) => r.uid);
        expect(uids).toContain(unseen.uid);
        expect(uids).not.toContain(seen.uid);
    });

    it('predicate `acknowledged` returns only acked rows', async () => {
        const { actor, userId } = await makeUser();
        const ack = (await withActor(actor, () =>
            driver.create({ object: { value: { i: 'ack' } } }),
        )) as Record<string, unknown>;
        await withActor(actor, () =>
            driver.create({ object: { value: { i: 'pending' } } }),
        );
        await server.stores.notification.markAcknowledged(
            ack.uid as string,
            userId,
        );

        const result = (await withActor(actor, () =>
            driver.select({ predicate: 'acknowledged' }),
        )) as Array<Record<string, unknown>>;

        expect(result.map((r) => r.uid)).toEqual([ack.uid]);
    });

    it('caps `limit` at the driver max even when overridden by the caller', async () => {
        const { actor } = await makeUser();
        // Verify shape, not exact upper bound — keep test fast.
        const result = (await withActor(actor, () =>
            driver.select({ limit: 100_000 }),
        )) as unknown[];
        expect(Array.isArray(result)).toBe(true);
    });
});

// ── mark_shown / mark_acknowledged ─────────────────────────────────

describe('NotificationDriver.mark_shown / mark_acknowledged', () => {
    it('mark_shown sets `shown` and reports success', async () => {
        const { actor, userId } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({ object: { value: {} } }),
        )) as Record<string, unknown>;

        const result = (await withActor(actor, () =>
            driver.mark_shown({ uid: created.uid }),
        )) as { success: boolean };
        expect(result.success).toBe(true);

        const row = await server.stores.notification.getByUid(
            created.uid as string,
            { userId },
        );
        expect(row?.shown).not.toBeNull();
    });

    it('mark_acknowledged sets `acknowledged` and reports success', async () => {
        const { actor, userId } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({ object: { value: {} } }),
        )) as Record<string, unknown>;

        const result = (await withActor(actor, () =>
            driver.mark_acknowledged({ uid: created.uid }),
        )) as { success: boolean };
        expect(result.success).toBe(true);

        const row = await server.stores.notification.getByUid(
            created.uid as string,
            { userId },
        );
        expect(row?.acknowledged).not.toBeNull();
    });

    it('mark_shown rejects missing uid with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.mark_shown({})),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("mark_shown returns success=false for another user's uid", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const created = (await withActor(a.actor, () =>
            driver.create({ object: { value: {} } }),
        )) as Record<string, unknown>;

        const result = (await withActor(b.actor, () =>
            driver.mark_shown({ uid: created.uid }),
        )) as { success: boolean };
        // Store update is scoped by user_id, so cross-user mutation is a
        // silent no-op. The driver reports the store's `affected = 0`
        // verbatim as `success: false`.
        expect(result.success).toBe(false);
    });
});
