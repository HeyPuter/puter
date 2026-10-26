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
import { EVENTS_KV_HANDLE_LIMIT } from '../events/limits.js';

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
        await env.server.clients.redis.del(
            `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${user!.id}`,
        );
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
                'prefix',
            ].sort(),
        );
        expect(shared).toMatchObject({
            access: 'read',
            appUid: null,
            holder: env.users.other.username,
            label: 'Groceries',
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
