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

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { claimRateLimit } from '../../core/http/middleware/rateLimit.js';
import { seedKvShareHandles } from '../../services/kvShare/kvShareTestUtil.js';
import { KV_GLOBAL_APP_KEY } from '../../stores/systemKv/SystemKVStore.js';
import {
    EVENTS_KV_HANDLE_LIMIT,
    EVENTS_KV_HANDLES_PER_USER,
    KV_SHARE_BATCH_MAX,
    KV_SHARE_GRANT_LIMITS,
    KV_SHARE_LOOKUP_LIMIT,
} from '../events/limits.js';

const BOOT_TIMEOUT_MS = 120_000;

const call = (
    env: PuterTestEnv,
    method: string,
    path: string,
    token?: string,
    body?: unknown,
) =>
    fetch(new URL(path, env.apiOrigin), {
        method,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

const resetBudgets = async (env: PuterTestEnv) => {
    for (const name of [env.users.user.username, env.users.other.username]) {
        const user = await env.server.stores.user.getByUsername(name);
        for (const scope of [
            EVENTS_KV_HANDLE_LIMIT.scope,
            KV_SHARE_LOOKUP_LIMIT.scope,
            ...KV_SHARE_GRANT_LIMITS.map((window) => window.scope),
        ])
            await env.server.clients.redis.del(`rate:${scope}:${user!.id}`);
    }
};

describe('/kv/shares', () => {
    let env: PuterTestEnv;
    let ownerUuid: string;
    const req = (
        method: string,
        path: string,
        token?: string,
        body?: unknown,
    ) => call(env, method, path, token, body);

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            events: { enabled: true, kvHandles: true },
            kv: { shareHandles: true },
            unlimitedMetering: true,
        } as IConfig);
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        ownerUuid = owner!.uuid as string;
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
    });

    beforeEach(async () => {
        await resetBudgets(env);
    });

    const shareWithOther = async (body: Record<string, unknown> = {}) => {
        const res = await req('POST', '/kv/shares', env.users.user.token, {
            prefix: `http-${uuidv4().slice(0, 8)}:`,
            recipient: env.users.other.username,
            ...body,
        });
        expect(res.status).toBe(200);
        return (await res.json()) as Record<string, unknown>;
    };

    it('shares at read by default and answers in the owner`s shape', async () => {
        const shared = await shareWithOther({ label: 'Groceries' });
        expect(Object.keys(shared).sort()).toEqual(
            [
                'access',
                'appUid',
                'createdAt',
                'handle',
                'holder',
                'label',
                'notify',
                'prefix',
            ].sort(),
        );
        expect(shared).toMatchObject({
            access: 'read',
            appUid: null,
            holder: env.users.other.username,
            label: 'Groceries',
            notify: false,
        });
    });

    it('takes notify, keeps it on a re-share that leaves it out, and shows it to both sides', async () => {
        const prefix = `notify-${uuidv4().slice(0, 8)}:`;
        const on = await shareWithOther({ prefix, notify: true });
        expect(on).toMatchObject({ prefix, notify: true });

        const kept = await shareWithOther({ prefix, access: 'write' });
        expect(kept).toMatchObject({ handle: on.handle, notify: true });

        const listed = async (path: string, token: string) =>
            (
                (await (await req('GET', path, token)).json()) as {
                    items: Array<Record<string, unknown>>;
                }
            ).items.find((row) => row.handle === on.handle);
        expect(
            await listed('/kv/shares?limit=200', env.users.user.token),
        ).toMatchObject({ notify: true });
        expect(
            await listed('/kv/shares/with-me?limit=200', env.users.other.token),
        ).toMatchObject({ notify: true });

        const off = await shareWithOther({ prefix, notify: false });
        expect(off).toMatchObject({ handle: on.handle, notify: false });

        const refused = await req('POST', '/kv/shares', env.users.user.token, {
            prefix,
            recipient: env.users.other.username,
            notify: 'yes',
        });
        expect(refused.status).toBe(400);
        await expect(refused.json()).resolves.toMatchObject({
            code: 'kv_share_notify_invalid',
        });
    });

    it('takes the recipient as an object too, and refuses an address', async () => {
        await shareWithOther({
            recipient: { username: env.users.other.username },
            access: 'write',
        });
        const refused = await req('POST', '/kv/shares', env.users.user.token, {
            prefix: 'address:',
            recipient: 'someone@example.com',
        });
        expect(refused.status).toBe(400);
        await expect(refused.json()).resolves.toMatchObject({
            code: 'invalid_recipient',
        });
    });

    it('lists what was shared out, and what was shared with the holder without the owner', async () => {
        const shared = await shareWithOther({ access: 'write', label: 'Trip' });

        const byMe = await req(
            'GET',
            '/kv/shares?limit=200',
            env.users.user.token,
        );
        const byMePage = (await byMe.json()) as {
            items: Array<Record<string, unknown>>;
        };
        expect(
            byMePage.items.find((row) => row.handle === shared.handle),
        ).toEqual({
            handle: shared.handle,
            prefix: shared.prefix,
            access: 'write',
            appUid: null,
            holder: env.users.other.username,
            label: 'Trip',
            notify: false,
            createdAt: shared.createdAt,
            revokedAt: null,
            revokedBy: null,
        });

        const withMe = await req(
            'GET',
            '/kv/shares/with-me?limit=200',
            env.users.other.token,
        );
        const withMeText = await withMe.text();
        const withMePage = JSON.parse(withMeText) as {
            items: Array<Record<string, unknown>>;
        };
        expect(
            withMePage.items.find((row) => row.handle === shared.handle),
        ).toEqual({
            handle: shared.handle,
            access: 'write',
            appUid: null,
            label: 'Trip',
            notify: false,
            createdAt: shared.createdAt,
        });
        expect(withMeText).not.toContain(env.users.user.username);
        expect(withMeText).not.toContain(ownerUuid);
        expect(withMeText).not.toContain(String(shared.prefix));
    });

    it('lets the holder unshare, and shows the owner they did', async () => {
        const shared = await shareWithOther();
        const removed = await req(
            'DELETE',
            `/kv/shares/${shared.handle}`,
            env.users.other.token,
        );
        expect(removed.status).toBe(200);
        await expect(removed.json()).resolves.toMatchObject({
            handle: shared.handle,
        });

        const byMe = (await (
            await req('GET', '/kv/shares?limit=200', env.users.user.token)
        ).json()) as { items: Array<Record<string, unknown>> };
        expect(
            byMe.items.find((row) => row.handle === shared.handle),
        ).toMatchObject({ revokedBy: 'holder' });
    });

    it('keeps the owner and prefix out of the holder`s grant audit after they unshare', async () => {
        const shared = await shareWithOther({ access: 'write' });
        const segment = String(shared.prefix).slice(0, -1);
        const other = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        // A row an earlier build filed under the holder.
        await env.server.stores.permission.auditUserUserPerm({
            holder_user_id: other!.id,
            issuer_user_id: other!.id,
            permission: `kv-share-write:${ownerUuid}:os-global:${segment}`,
            action: 'revoke',
            reason: 'kv share handle unshared',
        });
        const removed = await req(
            'DELETE',
            `/kv/shares/${shared.handle}`,
            env.users.other.token,
        );
        expect(removed.status).toBe(200);

        // The revoke is filed under the owner, who granted it.
        const auditOf = async (token: string) => {
            const res = await req('GET', '/share/audit?limit=200', token);
            expect(res.status).toBe(200);
            return await res.text();
        };
        await vi.waitFor(async () => {
            const owners = JSON.parse(await auditOf(env.users.user.token)) as {
                items: Array<Record<string, unknown>>;
            };
            expect(owners.items).toContainEqual(
                expect.objectContaining({
                    action: 'revoke',
                    issuer: env.users.user.username,
                    holder: env.users.other.username,
                    permission: expect.stringContaining(segment),
                }),
            );
        });

        const holders = await auditOf(env.users.other.token);
        expect(holders).not.toContain(ownerUuid);
        expect(holders).not.toContain(segment);
    });

    it('lets the owner revoke', async () => {
        const shared = await shareWithOther();
        const removed = await req(
            'DELETE',
            `/kv/shares/${shared.handle}`,
            env.users.user.token,
        );
        expect(removed.status).toBe(200);
    });

    it('answers anyone else, and an unknown handle, with the same 404', async () => {
        const shared = await shareWithOther();
        const stranger = await createTestUser(env.server, {
            username: `kvs-${uuidv4().slice(0, 8)}`,
            password: 'pw-test-1234',
        });
        const strangers = await req(
            'DELETE',
            `/kv/shares/${shared.handle}`,
            stranger.token,
        );
        const unknownHandle = `kvh-${uuidv4()}`;
        const unknown = await req(
            'DELETE',
            `/kv/shares/${unknownHandle}`,
            env.users.user.token,
        );
        expect(strangers.status).toBe(404);
        expect(unknown.status).toBe(404);
        const a = (await strangers.json()) as Record<string, unknown>;
        const b = (await unknown.json()) as Record<string, unknown>;
        expect(a.code).toBe(b.code);
        expect(a.message).toBe(`No such handle: ${shared.handle}`);
        expect(b.message).toBe(`No such handle: ${unknownHandle}`);
    });

    it('turns an anonymous caller away', async () => {
        const res = await req('GET', '/kv/shares');
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    describe('filtering a listing', () => {
        type Page = { items: Array<Record<string, unknown>>; total?: number };
        let appUid: string;
        let inApp: Record<string, unknown>;
        let global: Record<string, unknown>;

        const page = async (path: string, token: string) => {
            const res = await req('GET', path, token);
            return { status: res.status, body: (await res.json()) as Page };
        };
        const handlesOf = (body: Page) => body.items.map((row) => row.handle);

        const makeApp = async () => {
            const owner = await env.server.stores.user.getByUsername(
                env.users.user.username,
            );
            const name = `kv-http-${uuidv4().slice(0, 8)}`;
            return env.server.stores.app.create(
                {
                    name,
                    title: 'Listing App',
                    index_url: `https://${name}.example.test/index.html`,
                },
                { ownerUserId: owner!.id },
            );
        };

        /** The token the desktop launches the app with, for `token`'s user. */
        const appToken = async (token: string, uid: string) => {
            const res = await req('POST', '/auth/get-user-app-token', token, {
                app_uid: uid,
            });
            expect(res.status).toBe(200);
            return ((await res.json()) as { token: string }).token;
        };

        beforeAll(async () => {
            await resetBudgets(env);
            appUid = (await makeApp()).uid;
            inApp = await shareWithOther({ appUid });
            global = await shareWithOther();
        });

        it('lists every app`s shares for the account, or one app`s, or the app-less store`s with `null`', async () => {
            for (const path of ['/kv/shares', '/kv/shares/with-me']) {
                const token =
                    path === '/kv/shares'
                        ? env.users.user.token
                        : env.users.other.token;
                const all = await page(`${path}?limit=200`, token);
                expect(handlesOf(all.body)).toEqual(
                    expect.arrayContaining([inApp.handle, global.handle]),
                );

                const one = await page(
                    `${path}?limit=200&appUid=${appUid}`,
                    token,
                );
                expect(handlesOf(one.body)).toEqual([inApp.handle]);

                const appLess = await page(
                    `${path}?limit=200&appUid=null`,
                    token,
                );
                expect(handlesOf(appLess.body)).toContain(global.handle);
                expect(
                    appLess.body.items.every((row) => row.appUid === null),
                ).toBe(true);

                const bad = await page(`${path}?appUid=not-an-app`, token);
                expect(bad.status).toBe(400);
            }
        });

        it('keeps an app to its own namespace, refusing any other it names', async () => {
            const token = await appToken(env.users.other.token, appUid);
            const own = await page('/kv/shares/with-me?limit=200', token);
            expect(handlesOf(own.body)).toEqual([inApp.handle]);
            const named = await page(
                `/kv/shares/with-me?limit=200&appUid=${appUid}`,
                token,
            );
            expect(handlesOf(named.body)).toEqual([inApp.handle]);

            const otherApp = (await makeApp()).uid;
            for (const appUidParam of ['null', otherApp]) {
                const refused = await page(
                    `/kv/shares/with-me?appUid=${appUidParam}`,
                    token,
                );
                expect(refused.status).toBe(403);
                expect(refused.body).toMatchObject({
                    code: 'events_kv_handle_outside_namespace',
                });
            }
        });

        it('narrows what was shared out to live or revoked shares, all by default', async () => {
            const gone = await shareWithOther({ appUid });
            await req(
                'DELETE',
                `/kv/shares/${gone.handle}`,
                env.users.user.token,
            );
            const at = async (state?: string) =>
                page(
                    `/kv/shares?limit=200&appUid=${appUid}` +
                        (state ? `&state=${state}` : ''),
                    env.users.user.token,
                );

            expect(handlesOf((await at()).body)).toEqual([
                inApp.handle,
                gone.handle,
            ]);
            expect(handlesOf((await at('all')).body)).toEqual([
                inApp.handle,
                gone.handle,
            ]);
            expect(handlesOf((await at('live')).body)).toEqual([inApp.handle]);
            expect(handlesOf((await at('revoked')).body)).toEqual([
                gone.handle,
            ]);
            const bad = await at('stopped');
            expect(bad.status).toBe(400);
        });
    });

    describe('with several recipients', () => {
        let third: { username: string; uuid: string; id: number };
        // Holds seeded rows, so no recipient's per-holder cap is what trips.
        let filler: number;
        let ownerId: number;

        beforeAll(async () => {
            const username = `kv-batch-${uuidv4().slice(0, 8)}`;
            await createTestUser(env.server, {
                username,
                password: 'pw-test-1234',
            });
            const row = await env.server.stores.user.getByUsername(username);
            third = { username, uuid: row!.uuid as string, id: row!.id! };
            ownerId = (await env.server.stores.user.getByUsername(
                env.users.user.username,
            ))!.id!;
            const fillerName = `kv-filler-${uuidv4().slice(0, 8)}`;
            await createTestUser(env.server, {
                username: fillerName,
                password: 'pw-test-1234',
            });
            filler = (await env.server.stores.user.getByUsername(fillerName))!
                .id!;
        });

        const shareMany = (body: Record<string, unknown>) =>
            req('POST', '/kv/shares', env.users.user.token, {
                prefix: `batch-${uuidv4().slice(0, 8)}:`,
                ...body,
            });

        it('reports each recipient on its own item, in order', async () => {
            const res = await shareMany({
                recipients: [
                    env.users.other.username,
                    'nobody-by-this-name',
                    env.users.user.username,
                    'someone@example.com',
                    { uid: third.uuid },
                ],
                access: 'write',
                label: 'Team list',
            });
            expect(res.status).toBe(200);
            const { items } = (await res.json()) as {
                items: Record<string, unknown>[];
            };
            expect(items).toHaveLength(5);
            expect(items[0]).toMatchObject({
                recipient: env.users.other.username,
                handle: expect.any(String),
                access: 'write',
                holder: env.users.other.username,
                label: 'Team list',
                appUid: null,
            });
            expect(items[1]).toEqual({
                recipient: 'nobody-by-this-name',
                error: {
                    message: expect.any(String),
                    code: 'subject_does_not_exist',
                },
            });
            expect(items[2]).toMatchObject({
                error: { code: 'bad_request' },
            });
            expect(items[3]).toMatchObject({
                error: { code: 'invalid_recipient' },
            });
            expect(items[4]).toMatchObject({
                recipient: { uid: third.uuid },
                holder: third.username,
            });
            expect(items[4].handle).not.toBe(items[0].handle);
        });

        it('answers a recipient named twice with the one share', async () => {
            const res = await shareMany({
                recipients: [third.username, { uid: third.uuid }],
            });
            const { items } = (await res.json()) as {
                items: Record<string, unknown>[];
            };
            expect(items[0].handle).toEqual(expect.any(String));
            expect(items[1].handle).toBe(items[0].handle);
        });

        it('refuses a malformed batch outright', async () => {
            for (const body of [
                { recipients: [] },
                { recipients: 'alice' },
                {
                    recipients: Array.from(
                        { length: KV_SHARE_BATCH_MAX + 1 },
                        (_, i) => `user-${i}`,
                    ),
                },
                {
                    recipient: env.users.other.username,
                    recipients: [env.users.other.username],
                },
            ]) {
                const res = await shareMany(body);
                expect(res.status).toBe(400);
                await expect(res.json()).resolves.toMatchObject({
                    code: 'bad_request',
                });
            }
        });

        it('refuses the whole batch when it would pass the account cap', async () => {
            const prefix = `batch-cap-${uuidv4().slice(0, 8)}:`;
            const existing = await shareMany({
                prefix,
                recipients: [env.users.other.username],
            });
            const [standing] = (
                (await existing.json()) as { items: { handle: string }[] }
            ).items;
            try {
                const { total } =
                    await env.server.stores.kvShareHandle.countLiveForOwner(
                        ownerId,
                    );
                // One slot left.
                await seedKvShareHandles(env.server, {
                    ownerUserId: ownerId,
                    ownerUuid,
                    granteeUserId: filler,
                    count: EVENTS_KV_HANDLES_PER_USER.limit - total - 1,
                    appUid: () => KV_GLOBAL_APP_KEY,
                });

                const refused = await shareMany({
                    prefix: `batch-over-${uuidv4().slice(0, 8)}:`,
                    recipients: [env.users.other.username, third.username],
                });
                expect(refused.status).toBe(409);
                await expect(refused.json()).resolves.toMatchObject({
                    code: 'events_kv_handle_limit_reached',
                });
                expect(
                    (
                        await env.server.stores.kvShareHandle.countLiveForOwner(
                            ownerId,
                        )
                    ).total,
                ).toBe(EVENTS_KV_HANDLES_PER_USER.limit - 1);

                // The standing share takes no slot, so one new one still fits.
                const fits = await shareMany({
                    prefix,
                    recipients: [env.users.other.username, third.username],
                });
                expect(fits.status).toBe(200);
                const { items } = (await fits.json()) as {
                    items: Record<string, unknown>[];
                };
                expect(items[0].handle).toBe(standing.handle);
                expect(items[1]).toMatchObject({ holder: third.username });
            } finally {
                await env.server.clients.db.write(
                    'DELETE FROM `kv_share_handles` WHERE `owner_user_id` = ?',
                    [ownerId],
                );
            }
        });

        it('spends the grant budget per recipient, all or nothing', async () => {
            const [minute] = KV_SHARE_GRANT_LIMITS;
            await claimRateLimit(
                `${minute.scope}:${ownerId}`,
                minute.limit,
                minute.window,
                minute.limit - 1,
            );
            try {
                const refused = await shareMany({
                    recipients: [env.users.other.username, third.username],
                });
                expect(refused.status).toBe(429);
                await expect(refused.json()).resolves.toMatchObject({
                    code: 'too_many_requests',
                });
            } finally {
                await resetBudgets(env);
            }
        });
    });

    describe('sharing again', () => {
        let ownerId: number;
        let third: string;

        beforeAll(async () => {
            third = `kv-again-${uuidv4().slice(0, 8)}`;
            await createTestUser(env.server, {
                username: third,
                password: 'pw-test-1234',
            });
            ownerId = (await env.server.stores.user.getByUsername(
                env.users.user.username,
            ))!.id!;
        });

        const shareAt = (prefix: string, body: Record<string, unknown>) =>
            req('POST', '/kv/shares', env.users.user.token, {
                prefix,
                ...body,
            });

        /** Leaves `left` units in one of the owner's windows. */
        const drain = (
            window: { scope: string; limit: number; window: number },
            left = 0,
        ) =>
            claimRateLimit(
                `${window.scope}:${ownerId}`,
                window.limit,
                window.window,
                window.limit - left,
            );

        it('spends neither the mint nor the grant budget when every share stays as it is', async () => {
            const prefix = `again-${uuidv4().slice(0, 8)}:`;
            const recipients = [env.users.other.username, third];
            const made = (await (
                await shareAt(prefix, { recipients, label: 'Room' })
            ).json()) as { items: Array<{ handle: string }> };
            await drain(EVENTS_KV_HANDLE_LIMIT);
            for (const window of KV_SHARE_GRANT_LIMITS) await drain(window);
            try {
                const again = await shareAt(prefix, {
                    recipients: [...recipients, third],
                });
                expect(again.status).toBe(200);
                const { items } = (await again.json()) as {
                    items: Array<{ handle: string; label: string }>;
                };
                expect(items.map((item) => item.handle)).toEqual([
                    made.items[0].handle,
                    made.items[1].handle,
                    made.items[1].handle,
                ]);
                expect(items[0].label).toBe('Room');

                const single = await shareAt(prefix, {
                    recipient: env.users.other.username,
                    access: 'read',
                });
                expect(single.status).toBe(200);
            } finally {
                await resetBudgets(env);
            }
        });

        it('spends the mint budget on a change, and grant units only on recipients without the share', async () => {
            const prefix = `again-${uuidv4().slice(0, 8)}:`;
            const other = env.users.other.username;
            expect((await shareAt(prefix, { recipient: other })).status).toBe(
                200,
            );
            for (const window of KV_SHARE_GRANT_LIMITS) await drain(window);
            try {
                // A level change on a standing share takes no grant unit.
                const raised = await shareAt(prefix, {
                    recipients: [other],
                    access: 'write',
                });
                expect(raised.status).toBe(200);

                // Naming an unknown user next to it costs what a new share
                // would, so the window refuses both.
                for (const extra of ['nobody-by-this-name', third]) {
                    const refused = await shareAt(prefix, {
                        recipients: [other, extra],
                        access: 'write',
                    });
                    expect(refused.status).toBe(429);
                }
            } finally {
                await resetBudgets(env);
            }

            await drain(EVENTS_KV_HANDLE_LIMIT);
            try {
                const lowered = await shareAt(prefix, {
                    recipient: other,
                    access: 'read',
                });
                expect(lowered.status).toBe(429);
                await expect(lowered.json()).resolves.toMatchObject({
                    code: 'too_many_requests',
                });
            } finally {
                await resetBudgets(env);
            }
        });

        it('counts turning notify on or off as a change', async () => {
            const prefix = `again-${uuidv4().slice(0, 8)}:`;
            const other = env.users.other.username;
            expect((await shareAt(prefix, { recipient: other })).status).toBe(
                200,
            );
            await drain(EVENTS_KV_HANDLE_LIMIT);
            try {
                expect(
                    (await shareAt(prefix, { recipient: other })).status,
                ).toBe(200);
                expect(
                    (
                        await shareAt(prefix, {
                            recipient: other,
                            notify: true,
                        })
                    ).status,
                ).toBe(429);
            } finally {
                await resetBudgets(env);
            }
        });

        it('spends the lookup budget on every recipient named', async () => {
            const prefix = `again-${uuidv4().slice(0, 8)}:`;
            const other = env.users.other.username;
            expect((await shareAt(prefix, { recipient: other })).status).toBe(
                200,
            );
            await resetBudgets(env);
            await drain(KV_SHARE_LOOKUP_LIMIT, 1);
            try {
                expect(
                    (await shareAt(prefix, { recipient: other })).status,
                ).toBe(200);
                const refused = await shareAt(prefix, { recipient: other });
                expect(refused.status).toBe(429);
                await expect(refused.json()).resolves.toMatchObject({
                    code: 'too_many_requests',
                });
            } finally {
                await resetBudgets(env);
            }
        });
    });
});

describe('/events/kv-handles beside /kv/shares', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            events: { enabled: true, kvHandles: true },
            kv: { shareHandles: true },
            unlimitedMetering: true,
        } as IConfig);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
    });

    it('keeps its own request and response shapes, at watch by default', async () => {
        const minted = await call(
            env,
            'POST',
            '/events/kv-handles',
            env.users.user.token,
            {
                granteeUsername: env.users.other.username,
                prefix: 'alias-shape:',
            },
        );
        expect(minted.status).toBe(200);
        const body = (await minted.json()) as Record<string, unknown>;
        expect(body).toEqual({ handle: body.handle, prefix: 'alias-shape:' });

        const listed = (await (
            await call(
                env,
                'GET',
                '/events/kv-handles?limit=200',
                env.users.user.token,
            )
        ).json()) as { items: Array<Record<string, unknown>> };
        const row = listed.items.find((one) => one.handle === body.handle);
        expect(row).toMatchObject({
            prefix: 'alias-shape:',
            appUid: 'os-global',
            granteeUsername: env.users.other.username,
            access: 'watch',
            revokedBy: null,
        });
        expect(row).not.toHaveProperty('holder');

        // The alias revoke stays the owner's: the holder is told it is absent.
        const byHolder = await call(
            env,
            'DELETE',
            `/events/kv-handles/${body.handle}`,
            env.users.other.token,
        );
        expect(byHolder.status).toBe(404);
    });

    it('hands back a share it finds at the level it has, unless the body names one', async () => {
        const shared = (await (
            await call(env, 'POST', '/kv/shares', env.users.user.token, {
                prefix: 'alias-keep:',
                recipient: env.users.other.username,
                access: 'write',
            })
        ).json()) as Record<string, unknown>;
        const accessOf = async () => {
            const listed = (await (
                await call(
                    env,
                    'GET',
                    '/kv/shares?limit=200',
                    env.users.user.token,
                )
            ).json()) as { items: Array<Record<string, unknown>> };
            return listed.items.find((one) => one.handle === shared.handle)
                ?.access;
        };
        const mintAlias = (extra: Record<string, unknown> = {}) =>
            call(env, 'POST', '/events/kv-handles', env.users.user.token, {
                granteeUsername: env.users.other.username,
                prefix: 'alias-keep:',
                ...extra,
            });

        const again = await mintAlias();
        expect(again.status).toBe(200);
        await expect(again.json()).resolves.toEqual({
            handle: shared.handle,
            prefix: 'alias-keep:',
        });
        expect(await accessOf()).toBe('write');

        expect((await mintAlias({ access: 'read' })).status).toBe(200);
        expect(await accessOf()).toBe('read');
    });
});

/**
 * Sharing asks for a confirmed email and nothing else. Booted with an SMS
 * provider configured, so a phone requirement would bite here if one were ever
 * added to these routes.
 */
describe('verification on the mint routes', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            events: { enabled: true, kvHandles: true },
            kv: { shareHandles: true },
            unlimitedMetering: true,
            strict_email_verification_required: true,
            prelude: { apiKey: 'test-key' },
        } as IConfig);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
    });

    const makeUser = async (
        patch: Record<string, unknown> = {},
    ): Promise<TestUserCredentials> => {
        const username = `kvv${uuidv4().slice(0, 8)}`;
        const creds = await createTestUser(env.server, {
            username,
            password: 'pw-test-1234',
        });
        if (Object.keys(patch).length > 0) {
            const row = await env.server.stores.user.getByUsername(username);
            await env.server.stores.user.update(row!.id, patch);
        }
        return creds;
    };

    const mintBoth = (owner: TestUserCredentials, prefix: string) =>
        Promise.all([
            call(env, 'POST', '/kv/shares', owner.token, {
                prefix: `${prefix}a:`,
                recipient: env.users.other.username,
            }),
            call(env, 'POST', '/events/kv-handles', owner.token, {
                prefix: `${prefix}b:`,
                granteeUsername: env.users.other.username,
            }),
        ]);

    it('refuses an account whose email is not confirmed, on both routes', async () => {
        const owner = await makeUser();
        for (const res of await mintBoth(owner, 'unconfirmed')) {
            expect(res.status).toBe(403);
            await expect(res.json()).resolves.toMatchObject({
                code: 'account_is_not_verified',
            });
        }
    });

    it('lets a confirmed account share with no phone and no card', async () => {
        const owner = await makeUser({
            email: `kvv-${uuidv4().slice(0, 8)}@example.invalid`,
            email_confirmed: 1,
        });
        for (const res of await mintBoth(owner, 'confirmed'))
            expect(res.status).toBe(200);
    });

    it('never gates listing or unsharing', async () => {
        const owner = await makeUser();
        for (const path of ['/kv/shares', '/kv/shares/with-me'])
            expect((await call(env, 'GET', path, owner.token)).status).toBe(
                200,
            );
        const removed = await call(
            env,
            'DELETE',
            `/kv/shares/kvh-${uuidv4()}`,
            owner.token,
        );
        expect(removed.status).toBe(404);
    });
});
