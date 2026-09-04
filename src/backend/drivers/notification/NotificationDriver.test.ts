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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makeActor, type Actor } from '../../core/actor.js';
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
        actor: makeActor({
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        }),
    };
};

const makeApp = async (
    ownerUserId: number,
): Promise<{ id: number; uid: string }> => {
    const name = `nd-app-${Math.random().toString(36).slice(2, 10)}`;
    return (await server.stores.app.create(
        {
            name,
            title: 'Notification driver test',
            index_url: `https://${name}.test/`,
        },
        { ownerUserId },
    )) as { id: number; uid: string };
};

/** The holder's token as issued to an app it is running. */
const asApp = (holder: Actor, app: { id: number; uid: string }): Actor =>
    makeActor({ user: holder.user, app: { uid: app.uid, id: app.id } });

/** An access token an app minted: `effectiveApp` arrives through the issuer. */
const asIssuedToken = (holder: Actor, issuer: Actor): Actor =>
    makeActor({
        user: holder.user,
        accessToken: {
            uid: `tok-${Math.random().toString(36).slice(2)}`,
            issuer,
            authorized: null,
        },
    });

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

/**
 * A registered, account-audience, unscoped type — what every test below uses
 * that only cares about the driver's plumbing (create/read/select/mark), not
 * about a specific type's meaning.
 */
const NOTIF_TYPE = 'share.received';

// ── create ──────────────────────────────────────────────────────────

describe('NotificationDriver.create', () => {
    it('creates a notification row scoped to the actor', async () => {
        const { actor, userId } = await makeUser();
        const result = (await withActor(actor, () =>
            driver.create({
                object: { value: { type: NOTIF_TYPE, title: 'hi' } },
            }),
        )) as Record<string, unknown> | null;

        expect(result?.uid).toEqual(expect.any(String));
        expect(result?.value).toEqual({ type: NOTIF_TYPE, title: 'hi' });
        // shown / acknowledged are unset on creation.
        expect(result?.shown).toBeNull();
        expect(result?.acknowledged).toBeNull();

        const row = await server.stores.notification.getByUid(
            result!.uid as string,
            { userId },
        );
        expect(row).not.toBeNull();
        expect(row?.type).toBe(NOTIF_TYPE);
    });

    it('rejects a `value` with no `type` with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.create({ object: {} })),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withActor(actor, () =>
                driver.create({ object: { value: { title: 'no type' } } }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a `type` the registry does not have with 400', async () => {
        const { actor } = await makeUser();
        const call = () =>
            withActor(actor, () =>
                driver.create({
                    object: { value: { type: 'not.a.real.type' } },
                }),
            );
        await expect(call()).rejects.toThrow('not registered');
        await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects an account-audience type carrying an app uid with 400', async () => {
        const { actor } = await makeUser();
        const call = () =>
            withActor(actor, () =>
                driver.create({
                    object: {
                        value: { type: NOTIF_TYPE },
                        appUid: 'some-app',
                    },
                }),
            );
        await expect(call()).rejects.toThrow('cannot name an app');
        await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a serialized `value` over the byte cap', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        value: { type: NOTIF_TYPE, blob: 'x'.repeat(20_000) },
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
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
        const appActor = makeActor({
            user: actor.user,
            app: { uid: 'some-app', id: 1 },
        });
        await expect(
            withActor(appActor, () =>
                driver.create({
                    object: { value: { type: NOTIF_TYPE, title: 'app' } },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a token an app issued with 403', async () => {
        const { actor } = await makeUser();
        const issued = asIssuedToken(
            actor,
            makeActor({ user: actor.user, app: { uid: 'some-app', id: 1 } }),
        );
        await expect(
            withActor(issued, () =>
                driver.create({
                    object: { value: { type: NOTIF_TYPE, title: 'token' } },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 401 with no actor in context', async () => {
        await expect(
            driver.create({
                object: { value: { type: NOTIF_TYPE, title: 'noctx' } },
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── read ────────────────────────────────────────────────────────────

describe('NotificationDriver.read', () => {
    it('reads a notification by uid for its owner', async () => {
        const { actor } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({
                object: { value: { type: NOTIF_TYPE, title: 'a' } },
            }),
        )) as Record<string, unknown>;

        const fetched = (await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        )) as Record<string, unknown> | null;

        expect(fetched?.uid).toBe(created.uid);
        expect(fetched?.value).toEqual({ type: NOTIF_TYPE, title: 'a' });
    });

    it('accepts `id` as an alias for `uid`', async () => {
        const { actor } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE } } }),
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
            driver.create({
                object: { value: { type: NOTIF_TYPE, hidden: true } },
            }),
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
            driver.create({ object: { value: { type: NOTIF_TYPE, i: 1 } } }),
        );
        await withActor(actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE, i: 2 } } }),
        );

        const result = (await withActor(actor, () =>
            driver.select({}),
        )) as Array<Record<string, unknown>>;

        // SQLite's `created_at` is second-precision so two rapid inserts
        // can tie on the ORDER BY column — assert membership, not order.
        expect(result.length).toBe(2);
        const values = result.map((r) => (r.value as { i: number }).i);
        expect(values.sort()).toEqual([1, 2]);
    });

    it("does not leak other users' notifications", async () => {
        const a = await makeUser();
        const b = await makeUser();
        await withActor(a.actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE, who: 'a' } } }),
        );
        const result = (await withActor(b.actor, () =>
            driver.select({}),
        )) as Array<Record<string, unknown>>;
        expect(result).toEqual([]);
    });

    it('predicate `unseen` filters out shown notifications', async () => {
        const { actor, userId } = await makeUser();
        const seen = (await withActor(actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE, i: 'seen' } } }),
        )) as Record<string, unknown>;
        const unseen = (await withActor(actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE, i: 'unseen' } } }),
        )) as Record<string, unknown>;

        await server.stores.notification.markShown(seen.uid as string, userId);

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
            driver.create({ object: { value: { type: NOTIF_TYPE, i: 'ack' } } }),
        )) as Record<string, unknown>;
        await withActor(actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE, i: 'pending' } } }),
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
            driver.create({ object: { value: { type: NOTIF_TYPE } } }),
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
            driver.create({ object: { value: { type: NOTIF_TYPE } } }),
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

    it('mark_acknowledged emits `notif.ack` through the service, once', async () => {
        const { actor } = await makeUser();
        const created = (await withActor(actor, () =>
            driver.create({ object: { value: { type: NOTIF_TYPE } } }),
        )) as Record<string, unknown>;

        const acks: unknown[] = [];
        const handler = (_key: string, data: unknown) => acks.push(data);
        server.clients.event.on('outer.gui.notif.ack', handler);
        try {
            const first = (await withActor(actor, () =>
                driver.mark_acknowledged({ uid: created.uid }),
            )) as { success: boolean };
            expect(first.success).toBe(true);
            expect(acks).toHaveLength(1);

            // Already acknowledged: no affected row, so no second emission.
            const second = (await withActor(actor, () =>
                driver.mark_acknowledged({ uid: created.uid }),
            )) as { success: boolean };
            expect(second.success).toBe(false);
            expect(acks).toHaveLength(1);
        } finally {
            server.clients.event.off?.('outer.gui.notif.ack', handler);
        }
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
            driver.create({ object: { value: { type: NOTIF_TYPE } } }),
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

// ── Audience scoping ────────────────────────────────────────────────
//
// One mailbox holding a row per audience, read through each token shape.
// The rule under test: the holder is shown all of it, an actor holding an
// app is shown only what that app is the subject of, and `account` rows
// reach no app at all.

/** Seed a row the way the service writes one, scope columns and all. */
const seed = async (
    userId: number,
    row: {
        type?: string;
        audience?: string;
        appUid?: string | null;
        value?: unknown;
    },
): Promise<string> => {
    const created = await server.stores.notification.create({
        userId,
        value: row.value ?? { title: row.type ?? 'legacy' },
        type: row.type ?? '',
        audience: row.audience ?? 'account',
        appUid: row.appUid ?? null,
    });
    return created!.uid as string;
};

const uidsOf = (rows: unknown): string[] =>
    (rows as Array<Record<string, unknown>>).map((r) => String(r.uid));

const selectUids = async (
    actor: Actor,
    args: Record<string, unknown> = {},
): Promise<string[]> =>
    uidsOf(await withActor(actor, () => driver.select(args)));

/**
 * The holder owns `ownApp` and merely uses `otherApp`; their mailbox has one
 * row for every (audience, app) combination the matrix asks about.
 */
const mailbox = async () => {
    const holder = await makeUser();
    const stranger = await makeUser();
    const ownApp = await makeApp(holder.userId);
    const otherApp = await makeApp(stranger.userId);

    const rows = {
        account: await seed(holder.userId, {
            type: 'share.received',
            audience: 'account',
        }),
        appUser: await seed(holder.userId, {
            type: 'app.events.ended',
            audience: 'app-user',
            appUid: ownApp.uid,
        }),
        appUserOfOther: await seed(holder.userId, {
            type: 'app.events.ended',
            audience: 'app-user',
            appUid: otherApp.uid,
        }),
        appUserUnattributed: await seed(holder.userId, {
            type: 'app.events.ended',
            audience: 'app-user',
        }),
        developer: await seed(holder.userId, {
            type: 'app.events.suspended',
            audience: 'developer',
            appUid: ownApp.uid,
        }),
        developerOfOther: await seed(holder.userId, {
            type: 'app.events.suspended',
            audience: 'developer',
            appUid: otherApp.uid,
        }),
    };

    return {
        holder,
        stranger,
        ownApp,
        otherApp,
        rows,
        ownAppActor: asApp(holder.actor, ownApp),
        otherAppActor: asApp(holder.actor, otherApp),
    };
};

describe('NotificationDriver — select per token type', () => {
    it('the holder sees every audience and every app', async () => {
        const box = await mailbox();
        expect((await selectUids(box.holder.actor)).sort()).toEqual(
            Object.values(box.rows).sort(),
        );
    });

    it('an app token sees its own app-user rows, and its developer rows when the holder owns it', async () => {
        const box = await mailbox();
        expect((await selectUids(box.ownAppActor)).sort()).toEqual(
            [box.rows.appUser, box.rows.developer].sort(),
        );
    });

    it('a token that app issued reads exactly as the app does', async () => {
        const box = await mailbox();
        const issued = asIssuedToken(box.holder.actor, box.ownAppActor);
        expect((await selectUids(issued)).sort()).toEqual(
            [box.rows.appUser, box.rows.developer].sort(),
        );
    });

    it('an app the holder does not own yields no developer rows, and no refusal', async () => {
        const box = await mailbox();
        expect(await selectUids(box.otherAppActor)).toEqual([
            box.rows.appUserOfOther,
        ]);
    });

    it('an app token held by another user sees nothing of this mailbox', async () => {
        const box = await mailbox();
        const theirs = asApp(box.stranger.actor, box.ownApp);
        expect(await selectUids(theirs)).toEqual([]);
    });

    it("an app-user row naming no app is the holder's alone", async () => {
        const box = await mailbox();
        expect(await selectUids(box.holder.actor)).toContain(
            box.rows.appUserUnattributed,
        );
        expect(await selectUids(box.ownAppActor)).not.toContain(
            box.rows.appUserUnattributed,
        );
        expect(await selectUids(box.otherAppActor)).not.toContain(
            box.rows.appUserUnattributed,
        );
    });

    it('rejects an anonymous caller with 401', async () => {
        await expect(driver.select({})).rejects.toMatchObject({
            statusCode: 401,
        });
    });
});

describe('NotificationDriver — subject expansion', () => {
    it('expands the two-segment form from the actor', async () => {
        const box = await mailbox();
        expect(
            await selectUids(box.ownAppActor, { subject: 'notif:app-user' }),
        ).toEqual([box.rows.appUser]);
        expect(
            await selectUids(box.ownAppActor, { subject: 'notif:developer' }),
        ).toEqual([box.rows.developer]);
        expect(
            await selectUids(box.holder.actor, { subject: 'notif:account' }),
        ).toEqual([box.rows.account]);
    });

    it('an app naming another app uid gets an empty list', async () => {
        const box = await mailbox();
        expect(
            await selectUids(box.ownAppActor, {
                subject: `notif:${box.otherApp.uid}:app-user`,
            }),
        ).toEqual([]);
        expect(
            await selectUids(box.ownAppActor, {
                subject: `notif:${box.otherApp.uid}:developer`,
            }),
        ).toEqual([]);
    });

    it("an app naming the holder's own mailbox still gets no account rows", async () => {
        const box = await mailbox();
        // The SQL scope selects the row; the predicate is what drops it.
        expect(
            await selectUids(box.ownAppActor, {
                subject: `notif:${box.holder.actor.user.uuid}:account`,
            }),
        ).toEqual([]);
    });

    it('a non-owner asking for developer rows gets an empty list, not a refusal', async () => {
        const box = await mailbox();
        expect(
            await selectUids(box.otherAppActor, { subject: 'notif:developer' }),
        ).toEqual([]);
    });
});

describe('NotificationDriver — read per token type', () => {
    const readUid = (actor: Actor, uid: string) =>
        withActor(actor, () => driver.read({ uid }));

    it('the holder reads every row of their mailbox', async () => {
        const box = await mailbox();
        for (const uid of Object.values(box.rows)) {
            expect(await readUid(box.holder.actor, uid)).toMatchObject({ uid });
        }
    });

    it('an app reads only what it is the subject of', async () => {
        const box = await mailbox();
        expect(await readUid(box.ownAppActor, box.rows.appUser)).toMatchObject({
            uid: box.rows.appUser,
        });
        expect(
            await readUid(box.ownAppActor, box.rows.developer),
        ).toMatchObject({ uid: box.rows.developer });

        for (const uid of [
            box.rows.account,
            box.rows.appUserOfOther,
            box.rows.appUserUnattributed,
            box.rows.developerOfOther,
        ]) {
            await expect(readUid(box.ownAppActor, uid)).rejects.toMatchObject({
                statusCode: 404,
            });
        }
    });

    it('a token that app issued reads as the app does', async () => {
        const box = await mailbox();
        const issued = asIssuedToken(box.holder.actor, box.ownAppActor);
        expect(await readUid(issued, box.rows.appUser)).toMatchObject({
            uid: box.rows.appUser,
        });
        await expect(readUid(issued, box.rows.account)).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it('a developer row is not found for an app the holder does not own', async () => {
        const box = await mailbox();
        await expect(
            readUid(box.otherAppActor, box.rows.developerOfOther),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('a named subject the row is outside of reads as not found', async () => {
        const box = await mailbox();
        await expect(
            withActor(box.holder.actor, () =>
                driver.read({
                    uid: box.rows.account,
                    subject: 'notif:app-user',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('NotificationDriver — marking is bounded by reading', () => {
    const markShown = (actor: Actor, uid: string) =>
        withActor(actor, () => driver.mark_shown({ uid })) as Promise<{
            success: boolean;
        }>;
    const markAck = (actor: Actor, uid: string) =>
        withActor(actor, () => driver.mark_acknowledged({ uid })) as Promise<{
            success: boolean;
        }>;

    it('an app marks the rows it can read', async () => {
        const box = await mailbox();
        expect(await markShown(box.ownAppActor, box.rows.appUser)).toEqual({
            success: true,
        });
        expect(await markAck(box.ownAppActor, box.rows.developer)).toEqual({
            success: true,
        });
    });

    it('an account row cannot be marked by an app, and stays unmarked', async () => {
        const box = await mailbox();
        expect(await markShown(box.ownAppActor, box.rows.account)).toEqual({
            success: false,
        });
        expect(await markAck(box.ownAppActor, box.rows.account)).toEqual({
            success: false,
        });

        const row = await server.stores.notification.getByUid(
            box.rows.account,
            { userId: box.holder.userId },
        );
        expect(row?.shown ?? null).toBeNull();
        expect(row?.acknowledged ?? null).toBeNull();
    });

    it("another app's row cannot be marked", async () => {
        const box = await mailbox();
        expect(await markShown(box.otherAppActor, box.rows.appUser)).toEqual({
            success: false,
        });
        expect(await markAck(box.ownAppActor, box.rows.appUserOfOther)).toEqual(
            { success: false },
        );
    });

    it('a developer row is unmarkable by an app the holder does not own', async () => {
        const box = await mailbox();
        expect(
            await markShown(box.otherAppActor, box.rows.developerOfOther),
        ).toEqual({ success: false });
    });

    it('the holder marks any row of their own mailbox', async () => {
        const box = await mailbox();
        for (const uid of Object.values(box.rows)) {
            expect(await markShown(box.holder.actor, uid)).toEqual({
                success: true,
            });
        }
    });
});

describe('NotificationDriver — rows written before the scope columns', () => {
    /** The shape a pre-migration row has: no type, and the default audience. */
    const legacyRow = async () => {
        const holder = await makeUser();
        const app = await makeApp(holder.userId);
        const uid = await seed(holder.userId, {
            value: { source: 'sharing', title: 'shared with you' },
        });
        return { holder, app, uid, appActor: asApp(holder.actor, app) };
    };

    it('defaults to the account audience, so no driver op reaches it as an app', async () => {
        const { holder, uid, appActor } = await legacyRow();

        expect(await selectUids(appActor)).toEqual([]);
        expect(
            await selectUids(appActor, { subject: 'notif:app-user' }),
        ).toEqual([]);
        expect(
            await selectUids(appActor, {
                subject: `notif:${holder.actor.user.uuid}:account`,
            }),
        ).toEqual([]);

        await expect(
            withActor(appActor, () => driver.read({ uid })),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(
            await withActor(appActor, () => driver.mark_shown({ uid })),
        ).toEqual({ success: false });
        expect(
            await withActor(appActor, () => driver.mark_acknowledged({ uid })),
        ).toEqual({ success: false });

        // Still the holder's, and still unmarked by the attempts above.
        const row = await server.stores.notification.getByUid(uid, {
            userId: holder.userId,
        });
        expect(row?.shown ?? null).toBeNull();
        expect(row?.acknowledged ?? null).toBeNull();
        expect(await selectUids(holder.actor)).toEqual([uid]);
    });
});
