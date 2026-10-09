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

/**
 * A hosted origin's app uid is derived from the origin, so once an app is
 * deleted whoever registers the freed subdomain next is handed the same uid.
 * Sessions made for the earlier app must not authenticate as the new one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makeActor } from '../../core/actor.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;

beforeAll(async () => {
    env = await setupPuterTestEnv();
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

const api = (path: string, token: string, body?: unknown) =>
    fetch(new URL(path, env.apiOrigin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

const call = async (
    token: string,
    iface: string,
    method: string,
    args: unknown,
) => {
    const res = await api('/drivers/call', token, {
        interface: iface,
        method,
        args,
    });
    const text = await res.text();
    let json: { result?: unknown } | null = null;
    try {
        json = JSON.parse(text);
    } catch {
        // Non-JSON error body; the status carries the answer.
    }
    return { status: res.status, text, json };
};

const signIn = async (token: string, origin: string) => {
    const res = await api('/auth/get-user-app-token', token, { origin });
    expect(res.status).toBe(200);
    return (await res.json()) as { token: string; app_uid: string };
};

const sessionUid = (token: string) =>
    (
        env.server.services.token.verify('auth', token) as {
            session_uid: string;
        }
    ).session_uid;

const isRevoked = async (uuid: string) => {
    const rows = (await env.server.clients.db.read(
        'SELECT `revoked_at` FROM `sessions` WHERE `uuid` = ?',
        [uuid],
    )) as Array<{ revoked_at: number | null }>;
    return rows[0]?.revoked_at != null;
};

const mkSiteDir = async (username: string) => {
    const row = await env.server.stores.user.getByUsername(username);
    const path = `/${username}/site-${uuidv4().slice(0, 8)}`;
    await env.server.services.fs.mkdir(row!.id, {
        path,
        createMissingParents: true,
    } as never);
    return path;
};

// Moves a session's creation time back, as if it were made long before now,
// and drops cached copies so the next read sees it.
const backdateSession = async (uuid: string, seconds: number) => {
    await env.server.clients.db.write(
        'UPDATE `sessions` SET `created_at` = `created_at` - ? WHERE `uuid` = ?',
        [seconds, uuid],
    );
    await env.server.clients.redis.flushall();
};

const createApp = async () => {
    const owner = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    const app = await (
        env.server.stores.app.create as unknown as (
            fields: Record<string, unknown>,
            opts: { ownerUserId: number },
        ) => Promise<{ id: number; uid: string }>
    )(
        {
            name: `uid-${uuidv4()}`,
            title: 'Uid reuse',
            index_url: `https://${uuidv4()}.example/`,
        },
        { ownerUserId: owner!.id },
    );
    return { app, actor: makeActor({ user: owner! }) };
};

/** A file in the user's AppData for `appUid`, and an app-minted read token. */
const mintAppDataReadToken = async (
    appToken: string,
    username: string,
    appUid: string,
) => {
    const userRow = await env.server.stores.user.getByUsername(username);
    const entry = (await env.server.services.fs.touch(userRow!.id, {
        path: `/${username}/AppData/${appUid}/${uuidv4()}.txt`,
        createMissingParents: true,
    } as never)) as { uuid: string };
    const res = await api('/auth/create-access-token', appToken, {
        permissions: [`fs:${entry.uuid}:read`],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { token } = (await res.json()) as { token: string };
    return { file: entry.uuid, token };
};

const authenticate = (token: string) =>
    env.server.services.auth.authenticate(token) as Promise<{
        actor?: unknown;
        reauth?: { reason: string };
    }>;

describe('an app uid that returns after its app was deleted', () => {
    it("stops the deleted app's sessions authenticating as the next app on its origin", async () => {
        const devA = env.users.other;
        const visitor = env.users.user;
        const devB = await createTestUser(env.server, {
            username: `devb${uuidv4().slice(0, 8)}`,
            password: 'dev-b-password-123',
        });

        const sub = `shop-${uuidv4().slice(0, 8)}`;
        const origin = `http://${sub}.site.puter.localhost`;

        const aCreate = await call(devA.token, 'puter-subdomains', 'create', {
            object: {
                subdomain: sub,
                root_dir: await mkSiteDir(devA.username),
            },
        });
        expect(aCreate.status, aCreate.text).toBe(200);

        const { token: tokenA, app_uid: uid } = await signIn(
            visitor.token,
            origin,
        );
        const set = await call(tokenA, 'puter-kvstore', 'set', {
            key: 'notes',
            value: 'a-era',
        });
        expect(set.status, set.text).toBe(200);

        const delApp = await call(devA.token, 'puter-apps', 'delete', { uid });
        expect(delApp.status, delApp.text).toBe(200);
        const delSite = await call(devA.token, 'puter-subdomains', 'delete', {
            id: { subdomain: sub },
        });
        expect(delSite.status, delSite.text).toBe(200);
        // The earlier app's session was made well before the next app exists.
        await backdateSession(sessionUid(tokenA), 3600);

        const bCreate = await call(devB.token, 'puter-subdomains', 'create', {
            object: {
                subdomain: sub,
                root_dir: await mkSiteDir(devB.username),
            },
        });
        expect(bCreate.status, bCreate.text).toBe(200);

        const { token: tokenB, app_uid: uidB } = await signIn(
            visitor.token,
            origin,
        );
        // The uid itself is reused; only the old credentials are cut.
        expect(uidB).toBe(uid);
        expect(sessionUid(tokenB)).not.toBe(sessionUid(tokenA));
        expect(await isRevoked(sessionUid(tokenA))).toBe(true);

        expect((await api('/whoami', tokenA)).status).toBe(401);
        expect((await api('/whoami', tokenB)).status).toBe(200);
        const setB = await call(tokenB, 'puter-kvstore', 'set', {
            key: 'card',
            value: 'b-era',
        });
        expect(setB.status, setB.text).toBe(200);
        const getA = await call(tokenA, 'puter-kvstore', 'get', {
            key: 'card',
        });
        expect(getA.status).toBe(401);
    });

    it('stops an access token the deleted app minted from authenticating as the next app', async () => {
        const devA = env.users.other;
        const visitor = env.users.user;
        const devB = await createTestUser(env.server, {
            username: `devb${uuidv4().slice(0, 8)}`,
            password: 'dev-b-password-123',
        });

        const sub = `shop-${uuidv4().slice(0, 8)}`;
        const origin = `http://${sub}.site.puter.localhost`;

        const aCreate = await call(devA.token, 'puter-subdomains', 'create', {
            object: {
                subdomain: sub,
                root_dir: await mkSiteDir(devA.username),
            },
        });
        expect(aCreate.status, aCreate.text).toBe(200);
        const { token: appTokenA, app_uid: uid } = await signIn(
            visitor.token,
            origin,
        );
        const { file, token: scopedA } = await mintAppDataReadToken(
            appTokenA,
            visitor.username,
            uid,
        );

        const delApp = await call(devA.token, 'puter-apps', 'delete', { uid });
        expect(delApp.status, delApp.text).toBe(200);
        const delSite = await call(devA.token, 'puter-subdomains', 'delete', {
            id: { subdomain: sub },
        });
        expect(delSite.status, delSite.text).toBe(200);
        await backdateSession(sessionUid(appTokenA), 3600);
        await backdateSession(sessionUid(scopedA), 3600);

        // The next developer's sign-in brings the uid back.
        const bCreate = await call(devB.token, 'puter-subdomains', 'create', {
            object: {
                subdomain: sub,
                root_dir: await mkSiteDir(devB.username),
            },
        });
        expect(bCreate.status, bCreate.text).toBe(200);
        expect((await signIn(devB.token, origin)).app_uid).toBe(uid);

        expect((await authenticate(scopedA)).reauth?.reason).toBe(
            'session_revoked',
        );
        const stat = await api('/stat', scopedA, { uid: file });
        expect(stat.status).toBe(401);
    });

    it('keeps an access token its unchanged app minted', async () => {
        const { app, actor } = await createApp();
        const appToken = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        const { token } = await mintAppDataReadToken(
            appToken,
            env.users.user.username,
            app.uid,
        );
        expect((await authenticate(token)).actor).toBeTruthy();
    });

    it("keeps an unchanged app's session and token", async () => {
        const { app, actor } = await createApp();
        const first = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        const second = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        expect(sessionUid(second)).toBe(sessionUid(first));
        expect((await authenticate(first)).actor).toBeTruthy();
    });

    it('accepts a session made just before its app, within clock skew', async () => {
        const { app, actor } = await createApp();
        const token = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        await backdateSession(sessionUid(token), 30);
        expect((await authenticate(token)).actor).toBeTruthy();
    });

    it('replaces a worker session older than its app', async () => {
        const { app, actor } = await createApp();
        const workerName = `w-${uuidv4().slice(0, 8)}`;
        const old = await env.server.services.auth.createWorkerAppToken(
            actor,
            app.uid,
            workerName,
        );
        await backdateSession(sessionUid(old), 3600);
        expect((await authenticate(old)).reauth?.reason).toBe(
            'session_revoked',
        );

        const fresh = await env.server.services.auth.createWorkerAppToken(
            actor,
            app.uid,
            workerName,
        );
        expect(sessionUid(fresh)).not.toBe(sessionUid(old));
        expect(await isRevoked(sessionUid(old))).toBe(true);
        expect((await authenticate(fresh)).actor).toBeTruthy();
    });

    it('rejects a stale app token with no auth_id or reauth_token', async () => {
        const { app, actor } = await createApp();
        const token = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        await backdateSession(sessionUid(token), 3600);

        const res = await api('/whoami', token);
        expect(res.status).toBe(401);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.code).toBe('reauth_required');
        expect(body.reauth_token).toBeUndefined();
        expect(body.auth_id).toBeUndefined();
    });
});
