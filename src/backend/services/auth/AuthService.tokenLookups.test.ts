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

// Token auth starts its identity lookups together. These tests hold it to a
// one-lookup-at-a-time reference: the same result for every token and row
// state, and the same first error when lookups fail, whatever order they fail
// in.

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { setupTestServer } from '../../testUtil.js';
import { isGodmodeApp } from '../../util/godmodeApps.js';
import { EVENTS_WORKER_SESSION_NAME } from '../events/workerRuntime.js';
import type { AuthResult, AuthService } from './AuthService.js';
import type { SessionRow } from './types.js';

type Decoded = Record<string, unknown> & { type: string };

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Token auth as it read before its lookups overlapped: one at a time. */
const sequentialAuthenticate = async (
    server: PuterServer,
    decoded: Decoded,
): Promise<AuthResult> => {
    const { stores, services } = server;
    const d = decoded as Record<string, never>;

    const actorUser = (user: UserRow) => {
        const { password: _password, ...rest } = user;
        return {
            ...rest,
            email: user.email ?? null,
            suspended: user.suspended ?? false,
            email_confirmed: user.email_confirmed ?? false,
            requires_email_confirmation:
                user.requires_email_confirmation ?? false,
            phone: user.phone ?? null,
            requires_phone_verification:
                user.requires_phone_verification ?? false,
            requires_card_verification:
                user.requires_card_verification ?? false,
        };
    };
    const sessionOf = (session: SessionRow | null) =>
        session ? { uid: session.uuid, kind: session.kind ?? null } : null;
    const ended = (
        row: SessionRow | null,
        authId?: string,
    ): AuthResult | null => {
        let reason: 'session_revoked' | 'session_expired';
        if (row?.revoked_at != null) reason = 'session_revoked';
        else if (row?.expires_at != null && row.expires_at <= nowSeconds())
            reason = 'session_expired';
        else return null;
        return {
            reauth:
                authId === undefined ? { reason } : { reason, auth_id: authId },
        };
    };
    const workerStillDeployed = async (userId: number) => {
        if (!d.worker) return true;
        if (d.worker_name === EVENTS_WORKER_SESSION_NAME) return true;
        if (!d.worker_name) return false;
        const row = await stores.subdomain.getBySubdomain(
            `${WORKER_SUBDOMAIN_PREFIX}${d.worker_name}`,
        );
        if (!row || Number(row.user_id) !== Number(userId)) return false;
        return !d.worker_uid || row.uuid === d.worker_uid;
    };
    const originBlock = async (app: { index_url?: unknown }) => {
        const indexUrl = app.index_url;
        if (typeof indexUrl !== 'string' || !indexUrl) return null;
        const block =
            await services.appOriginBlocklist.isOriginBlocked(indexUrl);
        return block.blocked ? { reason: block.reason } : null;
    };
    const notBeforeOf = (app: { created_epoch?: unknown }) => {
        const created = Number(app?.created_epoch);
        if (!Number.isFinite(created) || created <= 0) return null;
        return created - 60;
    };
    const createdBefore = (row: SessionRow | null, nb: number | null) => {
        if (nb === null || !row) return false;
        const createdAt = Number(row.created_at);
        return createdAt > 0 && createdAt < nb;
    };
    const applyHandlerDepth = (actor: Actor) => {
        const handlerDepth = d.handler_depth as number | undefined;
        if (!Number.isSafeInteger(handlerDepth) || handlerDepth! <= 0) return;
        actor.handlerDepth = handlerDepth;
        if (Number.isSafeInteger(d.exp)) actor.handlerExpiresAt = d.exp;
    };

    if (d.type === 'session' || d.type === 'gui') {
        const user = await stores.user.getByUuid(d.user_uid);
        if (!user) return { invalid: true };
        const sessionUuid = d.session_uid ?? d.uuid;
        const rawRow = sessionUuid
            ? ((await stores.session.getByUuidAny(
                  sessionUuid,
              )) as SessionRow | null)
            : null;
        const authId =
            d.worker || (rawRow?.kind ?? 'web') !== 'web'
                ? undefined
                : user.uuid;
        const end = ended(rawRow, authId);
        if (end) return end;
        if (!rawRow) return { invalid: true };
        if (!(await workerStillDeployed(user.id))) return { invalid: true };
        return {
            actor: makeActor({
                user: actorUser(user),
                session: sessionOf(rawRow),
            }),
        };
    }

    if (d.type === 'app-under-user') {
        const user = await stores.user.getByUuid(d.user_uid);
        if (!user) return { invalid: true };
        const app = await stores.app.getByUid(d.app_uid);
        if (!app) return { invalid: true };
        const blocked = await originBlock(app);
        if (blocked) return { blocked };
        let rawRow: SessionRow | null = null;
        if (d.session_uid) {
            rawRow = (await stores.session.getByUuidAny(
                d.session_uid,
            )) as SessionRow | null;
        }
        const end = ended(rawRow);
        if (end) return end;
        if (!rawRow) return { invalid: true };
        const nb = notBeforeOf(app);
        const createdAt = Number(rawRow.created_at);
        if (nb !== null && createdAt > 0 && createdAt < nb) {
            return { reauth: { reason: 'session_revoked' } };
        }
        if (!(await workerStillDeployed(user.id))) return { invalid: true };
        const actor = makeActor({
            user: actorUser(user),
            app: { uid: app.uid, id: app.id },
            session: sessionOf(rawRow),
        });
        applyHandlerDepth(actor);
        return { actor };
    }

    if (d.type === 'access-token') {
        if (!d.token_uid || !d.user_uid) return { invalid: true };
        const user = await stores.user.getByUuid(d.user_uid);
        if (!user) return { invalid: true };
        let session: SessionRow | null = null;
        let parentSession: SessionRow | null = null;
        if (d.session_uid) {
            const rawRow = (await stores.session.getByUuidAny(
                d.session_uid,
            )) as SessionRow | null;
            const end = ended(rawRow);
            if (end) return end;
            if (!rawRow) return { invalid: true };
            if (rawRow.parent_session_id) {
                const parent = (await stores.session.getByUuidAny(
                    rawRow.parent_session_id,
                )) as SessionRow | null;
                if (!parent) return { reauth: { reason: 'session_revoked' } };
                const parentEnded = ended(parent);
                if (parentEnded) return parentEnded;
                parentSession = parent;
            }
            session = rawRow;
        }
        let authorizer: Actor;
        if (d.app_uid) {
            const app = await stores.app.getByUid(d.app_uid);
            if (!app) return { invalid: true };
            const blocked = await originBlock(app);
            if (blocked) return { blocked };
            const nb = notBeforeOf(app);
            if (createdBefore(session, nb) || createdBefore(parentSession, nb))
                return { reauth: { reason: 'session_revoked' } };
            authorizer = makeActor({
                user: actorUser(user),
                app: { uid: app.uid, id: app.id },
                session: null,
            });
        } else {
            authorizer = makeActor({ user: actorUser(user), session: null });
        }
        let godmodeApp: { uid: string; id: number } | null = null;
        if (d.godmode_app_uid !== undefined) {
            if (d.app_uid || d.full_access !== true) return { invalid: true };
            const app = await stores.app.getByUid(d.godmode_app_uid);
            if (!app || !isGodmodeApp(app)) return { invalid: true };
            godmodeApp = { uid: app.uid, id: app.id };
        }
        const actor = makeActor({
            user: actorUser(user),
            accessToken: {
                uid: d.token_uid,
                issuer: authorizer,
                authorized: null,
                fullAccess: !d.app_uid && d.full_access === true,
                ...(godmodeApp ? { godmodeApp } : {}),
            },
        });
        applyHandlerDepth(actor);
        return { actor };
    }

    return { invalid: true };
};

describe('token auth lookups match a sequential read', () => {
    let server: PuterServer;
    let authService: AuthService;

    // Row fixtures every matrix below draws from.
    let user: UserRow;
    const missing = () => uuidv4();
    const sessions: Record<string, string> = {};
    const apps: Record<string, string> = {};
    let workerName: string;
    let workerUid: string;

    const signAndVerify = (payload: Record<string, unknown>) => {
        const token = server.services.token.sign('auth', payload);
        return {
            token,
            decoded: server.services.token.verify<Decoded>('auth', token),
        };
    };

    const insertApp = async (
        label: string,
        columns: { index_url?: string; godmode?: number; timestamp?: string },
    ) => {
        const uid = `app-${uuidv4()}`;
        const names = ['uid', 'name', 'title', 'index_url', 'owner_user_id'];
        const values: unknown[] = [
            uid,
            `n-${uid}`,
            `t-${uid}`,
            columns.index_url ?? `https://${label}-${uuidv4()}.example.com/`,
            user.id,
        ];
        if (columns.godmode !== undefined) {
            names.push('godmode');
            values.push(columns.godmode);
        }
        if (columns.timestamp !== undefined) {
            names.push('timestamp');
            values.push(columns.timestamp);
        }
        await server.clients.db.write(
            `INSERT INTO \`apps\` (${names.map((n) => `\`${n}\``).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
            values,
        );
        apps[label] = uid;
    };

    beforeAll(async () => {
        server = await setupTestServer();
        authService = server.services.auth as unknown as AuthService;

        const username = `tl-${Math.random().toString(36).slice(2, 10)}`;
        user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });

        const create = async (
            label: string,
            opts: Record<string, unknown> = {},
        ) => {
            const row = (await server.stores.session.create(
                user.id,
                opts,
            )) as SessionRow;
            sessions[label] = row.uuid;
            return row;
        };
        const past = nowSeconds() - 60;
        const future = nowSeconds() + 3600;
        await create('web', { kind: 'web', expires_at: future });
        await create('webRevoked', { kind: 'web', expires_at: future });
        await server.stores.session.revokeCascade(sessions.webRevoked);
        await create('webExpired', { kind: 'web', expires_at: past });
        await create('app', { kind: 'app', expires_at: future });
        await create('child', {
            kind: 'access_token',
            parent_session_id: sessions.web,
        });
        await create('childOfMissing', {
            kind: 'access_token',
            parent_session_id: missing(),
        });
        await create('childOfRevoked', {
            kind: 'access_token',
            parent_session_id: sessions.webRevoked,
        });
        await create('childOfExpired', {
            kind: 'access_token',
            parent_session_id: sessions.webExpired,
        });
        sessions.missing = missing();

        await insertApp('plain', {});
        await insertApp('godmode', { godmode: 1 });
        // Created "after" every session above, so its sessions predate it.
        await insertApp('recreated', { timestamp: '2099-01-01 00:00:00' });
        const blockedHost = `blocked-${uuidv4()}.example.com`;
        await server.clients.db.write(
            'INSERT INTO `blocked_app_origins` (`domain`, `include_subdomains`) VALUES (?, ?)',
            [blockedHost, 0],
        );
        (
            server.services.appOriginBlocklist as { invalidate: () => void }
        ).invalidate();
        await insertApp('blocked', { index_url: `https://${blockedHost}/` });
        apps.missing = `app-${uuidv4()}`;

        workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
        const workerRow = await server.stores.subdomain.create({
            userId: user.id,
            subdomain: `${WORKER_SUBDOMAIN_PREFIX}${workerName}`,
            appOwner: null,
        });
        workerUid = workerRow.uuid;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const workerVariants = (): Array<Record<string, unknown>> => [
        {},
        { worker: true, worker_name: workerName, worker_uid: workerUid },
        { worker: true, worker_name: workerName, worker_uid: uuidv4() },
        { worker: true, worker_name: workerName },
        { worker: true, worker_name: `gone-${workerName}` },
        { worker: true },
        { worker: true, worker_name: EVENTS_WORKER_SESSION_NAME },
    ];

    const sessionTokens = (): Array<Record<string, unknown>> => {
        const out: Array<Record<string, unknown>> = [];
        for (const type of ['session', 'gui']) {
            for (const userUid of [user.uuid, missing()]) {
                for (const label of [
                    'web',
                    'webRevoked',
                    'webExpired',
                    'app',
                    'missing',
                    null,
                ]) {
                    const sessionFields =
                        label === null
                            ? [{}]
                            : [
                                  { session_uid: sessions[label] },
                                  { uuid: sessions[label] },
                              ];
                    for (const sessionField of sessionFields) {
                        for (const worker of workerVariants()) {
                            out.push({
                                type,
                                version: '2',
                                user_uid: userUid,
                                ...sessionField,
                                ...worker,
                            });
                        }
                    }
                }
            }
        }
        return out;
    };

    const appTokens = (): Array<Record<string, unknown>> => {
        const out: Array<Record<string, unknown>> = [];
        for (const userUid of [user.uuid, missing()]) {
            for (const appLabel of [
                'plain',
                'godmode',
                'recreated',
                'blocked',
                'missing',
            ]) {
                for (const sessionLabel of [
                    'app',
                    'webRevoked',
                    'webExpired',
                    'missing',
                    null,
                ]) {
                    for (const worker of workerVariants()) {
                        for (const depth of [{}, { handler_depth: 2 }]) {
                            out.push({
                                type: 'app-under-user',
                                version: '2',
                                user_uid: userUid,
                                app_uid: apps[appLabel],
                                ...(sessionLabel
                                    ? { session_uid: sessions[sessionLabel] }
                                    : {}),
                                ...worker,
                                ...depth,
                            });
                        }
                    }
                }
            }
        }
        return out;
    };

    const accessTokens = (): Array<Record<string, unknown>> => {
        const out: Array<Record<string, unknown>> = [
            { type: 'access-token', version: '2', user_uid: user.uuid },
            { type: 'access-token', version: '2', token_uid: uuidv4() },
        ];
        for (const userUid of [user.uuid, missing()]) {
            for (const sessionLabel of [
                null,
                'app',
                'child',
                'childOfMissing',
                'childOfRevoked',
                'childOfExpired',
                'webRevoked',
                'webExpired',
                'missing',
            ]) {
                for (const appLabel of [
                    null,
                    'plain',
                    'recreated',
                    'blocked',
                    'missing',
                ]) {
                    for (const fullAccess of [undefined, true, false]) {
                        for (const godmodeLabel of [
                            undefined,
                            'godmode',
                            'plain',
                            'missing',
                        ]) {
                            out.push({
                                type: 'access-token',
                                version: '2',
                                token_uid: uuidv4(),
                                user_uid: userUid,
                                ...(sessionLabel
                                    ? { session_uid: sessions[sessionLabel] }
                                    : {}),
                                ...(appLabel
                                    ? { app_uid: apps[appLabel] }
                                    : {}),
                                ...(fullAccess === undefined
                                    ? {}
                                    : { full_access: fullAccess }),
                                ...(godmodeLabel === undefined
                                    ? {}
                                    : { godmode_app_uid: apps[godmodeLabel] }),
                            });
                        }
                    }
                }
            }
        }
        return out;
    };

    const expectParity = async (payloads: Array<Record<string, unknown>>) => {
        const outcomes = new Set<string>();
        for (const payload of payloads) {
            const { token, decoded } = signAndVerify(payload);
            const expected = await sequentialAuthenticate(server, decoded);
            const actual = await authService.authenticate(token, {
                touch: false,
            });
            expect(actual, JSON.stringify(payload)).toEqual(expected);
            outcomes.add(Object.keys(expected).join(','));
        }
        return outcomes;
    };

    it('session and GUI tokens', async () => {
        const outcomes = await expectParity(sessionTokens());
        // The matrix reaches every kind of answer.
        expect([...outcomes].sort()).toEqual(['actor', 'invalid', 'reauth']);
    });

    it('app-under-user tokens', async () => {
        const outcomes = await expectParity(appTokens());
        expect([...outcomes].sort()).toEqual([
            'actor',
            'blocked',
            'invalid',
            'reauth',
        ]);
    });

    it('access tokens', async () => {
        const outcomes = await expectParity(accessTokens());
        expect([...outcomes].sort()).toEqual([
            'actor',
            'blocked',
            'invalid',
            'reauth',
        ]);
    });

    // -- Failing lookups ---------------------------------------------

    type LookupName =
        | 'user'
        | 'session'
        | 'parent'
        | 'app'
        | 'godmodeApp'
        | 'worker';

    const restorers: Array<() => void> = [];
    const restoreLookups = () => {
        for (const restore of restorers.splice(0).reverse()) restore();
    };

    /**
     * Patched by hand rather than with `vi.spyOn`: a spy subscribes to the
     * promise it returns, which would hide a rejection nothing else awaits.
     */
    const patch = <T extends object, K extends keyof T>(
        target: T,
        key: K,
        impl: T[K],
    ) => {
        const own = Object.getOwnPropertyDescriptor(target, key);
        (target as Record<K, unknown>)[key] = impl;
        restorers.push(() => {
            if (own) Object.defineProperty(target, key, own);
            else delete (target as Record<K, unknown>)[key];
        });
    };

    /**
     * Fail the named lookups, each after its own delay, so failures land in an
     * order unrelated to the order they are checked in.
     */
    const failLookups = (
        failing: Set<LookupName>,
        ids: { parent?: string; godmodeApp?: string },
        delays: Record<LookupName, number>,
    ) => {
        const settle = async <T>(
            name: LookupName,
            real: () => Promise<T>,
        ): Promise<T> => {
            await new Promise((resolve) => setTimeout(resolve, delays[name]));
            if (failing.has(name)) throw new Error(`${name} lookup failed`);
            return real();
        };
        const { user: userStore, session, app, subdomain } = server.stores;
        const getByUuid = userStore.getByUuid.bind(userStore);
        const getByUuidAny = session.getByUuidAny.bind(session);
        const getByUid = app.getByUid.bind(app);
        const getBySubdomain = subdomain.getBySubdomain.bind(subdomain);
        patch(userStore, 'getByUuid', (uuid: string) =>
            settle('user', () => getByUuid(uuid)),
        );
        patch(session, 'getByUuidAny', (uuid: string) =>
            settle(uuid === ids.parent ? 'parent' : 'session', () =>
                getByUuidAny(uuid),
            ),
        );
        patch(app, 'getByUid', (uid: string) =>
            settle(uid === ids.godmodeApp ? 'godmodeApp' : 'app', () =>
                getByUid(uid),
            ),
        );
        patch(subdomain, 'getBySubdomain', (name: string) =>
            settle('worker', () => getBySubdomain(name)),
        );
    };

    const outcomeOf = async (run: () => Promise<AuthResult>) => {
        try {
            return { result: await run() };
        } catch (error) {
            return { error: (error as Error).message };
        }
    };

    const subsets = <T>(items: T[]): T[][] =>
        items.reduce<T[][]>(
            (acc, item) => [...acc, ...acc.map((s) => [...s, item])],
            [[]],
        );

    const expectSameFirstError = async (
        payload: Record<string, unknown>,
        names: LookupName[],
        ids: { parent?: string; godmodeApp?: string },
    ) => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            const { token, decoded } = signAndVerify(payload);
            const forward = Object.fromEntries(
                names.map((name, i) => [name, i * 3]),
            ) as Record<LookupName, number>;
            const backward = Object.fromEntries(
                names.map((name, i) => [name, (names.length - i) * 3]),
            ) as Record<LookupName, number>;
            for (const failing of subsets(names)) {
                for (const delays of [forward, backward]) {
                    failLookups(new Set(failing), ids, delays);
                    const expected = await outcomeOf(() =>
                        sequentialAuthenticate(server, decoded),
                    );
                    const actual = await outcomeOf(() =>
                        authService.authenticate(token, { touch: false }),
                    );
                    restoreLookups();
                    expect(
                        actual,
                        `${JSON.stringify(payload)} failing=${failing}`,
                    ).toEqual(expected);
                }
            }
            // Let lookups nobody awaited finish failing.
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(unhandled).toEqual([]);
        } finally {
            restoreLookups();
            process.off('unhandledRejection', onUnhandled);
        }
    };

    it('surfaces the same first error for a session token', async () => {
        await expectSameFirstError(
            {
                type: 'session',
                version: '2',
                user_uid: user.uuid,
                session_uid: sessions.web,
                worker: true,
                worker_name: workerName,
                worker_uid: workerUid,
            },
            ['user', 'session', 'worker'],
            {},
        );
    });

    it('surfaces the same first error for an app-under-user token', async () => {
        await expectSameFirstError(
            {
                type: 'app-under-user',
                version: '2',
                user_uid: user.uuid,
                app_uid: apps.plain,
                session_uid: sessions.app,
                worker: true,
                worker_name: workerName,
                worker_uid: workerUid,
            },
            ['user', 'app', 'session', 'worker'],
            {},
        );
    });

    it('surfaces the same first error for an access token', async () => {
        await expectSameFirstError(
            {
                type: 'access-token',
                version: '2',
                token_uid: uuidv4(),
                user_uid: user.uuid,
                session_uid: sessions.child,
                app_uid: apps.plain,
            },
            ['user', 'session', 'parent', 'app'],
            { parent: sessions.web },
        );
        await expectSameFirstError(
            {
                type: 'access-token',
                version: '2',
                token_uid: uuidv4(),
                user_uid: user.uuid,
                session_uid: sessions.child,
                full_access: true,
                godmode_app_uid: apps.godmode,
            },
            ['user', 'session', 'parent', 'godmodeApp'],
            { parent: sessions.web, godmodeApp: apps.godmode },
        );
    });
});
