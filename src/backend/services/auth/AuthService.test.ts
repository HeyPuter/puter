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

import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { FULL_API_ACCESS } from '../permission/consts.js';
import { AuthService } from './AuthService.js';

function createAuthService(): AuthService {
    const [config, clients, stores, services] = [
        {},
        {},
        {},
        {},
    ] as ConstructorParameters<typeof AuthService>;
    return new AuthService(config, clients, stores, services);
}

describe('AuthService.createAccessToken', () => {
    it('rejects access-token actors so scoped tokens cannot mint broader tokens', async () => {
        const authService = createAuthService();
        const issuer: Actor = {
            user: {
                uuid: 'user-issuer',
                id: 1,
                username: 'issuer',
            },
        };
        const actor: Actor = {
            user: {
                uuid: 'user-issuer',
                id: 1,
                username: 'issuer',
            },
            accessToken: {
                uid: 'token-existing',
                issuer,
                authorized: null,
            },
        };

        await expect(
            authService.createAccessToken(actor, [['fs:abc:read']]),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'forbidden',
        });
    });

    it('rejects when the actor has no user', async () => {
        const authService = createAuthService();
        await expect(
            authService.createAccessToken(
                { user: undefined } as unknown as Actor,
                [['fs:abc:read']],
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a full-access mint by an app-under-user actor', async () => {
        // Apps may hold scoped grants but must not be able to escalate to a
        // blanket account-wide token. This throws on actor shape, before any
        // DB / permission interaction, so the mock service is sufficient.
        const authService = createAuthService();
        const appActor = {
            user: { uuid: 'user-issuer', id: 1, username: 'issuer' },
            app: { id: 0, uid: 'app-x' },
        } as Actor;
        await expect(
            authService.createAccessToken(appActor, [[FULL_API_ACCESS]]),
        ).rejects.toMatchObject({ statusCode: 403, legacyCode: 'forbidden' });
    });
});

// ── Real-server integration tests ───────────────────────────────────

describe('AuthService (integration)', () => {
    let server: PuterServer;
    let authService: AuthService;

    beforeAll(async () => {
        server = await setupTestServer();
        authService = server.services.auth as unknown as AuthService;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `as-${Math.random().toString(36).slice(2, 10)}`;
        const u = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });
        return u;
    };

    describe('authenticateFromToken', () => {
        it('returns null for a malformed/unverifiable token', async () => {
            const actor = await authService.authenticateFromToken('not-a-jwt');
            expect(actor).toBeNull();
        });

        it('returns null for a JWT signed with the wrong kind', async () => {
            // Sign with the `otp` kind — `authenticateFromToken` calls
            // `verify('auth', ...)` so a different-kind token fails verify
            // and falls through to null.
            const otpJwt = server.services.token.sign(
                'otp',
                { user_uid: uuidv4(), purpose: 'something' },
                { expiresIn: '5m' },
            );
            const actor = await authService.authenticateFromToken(otpJwt);
            expect(actor).toBeNull();
        });

        it('returns null for a legacy token (no `type` field)', async () => {
            const legacyJwt = server.services.token.sign(
                'auth',
                { user_uid: uuidv4() },
                { expiresIn: '5m' },
            );
            expect(
                await authService.authenticateFromToken(legacyJwt),
            ).toBeNull();
        });

        it('returns null for a session token whose session row is gone', async () => {
            const fakeSessionJwt = server.services.token.sign('auth', {
                type: 'session',
                version: '0.0.0',
                uuid: uuidv4(),
                user_uid: uuidv4(),
            });
            expect(
                await authService.authenticateFromToken(fakeSessionJwt),
            ).toBeNull();
        });

        it('resolves a real session token to a user actor', async () => {
            const user = await makeUser();
            const { token } = await authService.createSessionToken(user, {});
            const actor = await authService.authenticateFromToken(token);
            expect(actor).toBeTruthy();
            expect(actor!.user.uuid).toBe(user.uuid);
            expect(actor!.session?.uid).toBeTruthy();
        });

        it('returns null for an app-under-user token referencing a missing user', async () => {
            const jwt = server.services.token.sign('auth', {
                type: 'app-under-user',
                version: '0.0.0',
                user_uid: uuidv4(),
                app_uid: 'app-doesnotexist',
            });
            expect(await authService.authenticateFromToken(jwt)).toBeNull();
        });
    });

    // ── Rich `authenticate()` result shape ──────────────────────────

    describe('authenticate (reauth signal)', () => {
        it('returns { actor } for a healthy v2 session token', async () => {
            const user = await makeUser();
            const { token } = await authService.createSessionToken(user, {});
            const result = await authService.authenticate(token);
            expect(result.actor?.user.uuid).toBe(user.uuid);
            expect(result.reauth).toBeUndefined();
            expect(result.invalid).toBeUndefined();
        });

        it('returns { reauth: session_revoked } when the row is soft-revoked', async () => {
            const user = await makeUser();
            const { token, session } = await authService.createSessionToken(
                user,
                {},
            );
            await server.stores.session.removeByUuid(
                (session as { uuid: string }).uuid,
            );
            const result = await authService.authenticate(token);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_revoked',
                auth_id: user.uuid,
            });
        });

        it('returns { reauth: session_expired } when expires_at is in the past', async () => {
            const user = await makeUser();
            const { token, session } = await authService.createSessionToken(
                user,
                {},
            );
            // Backdate expires_at directly — the mint path sets it
            // 30d in the future, so we have to forcibly age it for the
            // test.
            await server.clients.db.write(
                'UPDATE `sessions` SET `expires_at` = ? WHERE `uuid` = ?',
                [
                    Math.floor(Date.now() / 1000) - 60,
                    (session as { uuid: string }).uuid,
                ],
            );
            // Invalidate the cached row so getByUuidAny re-reads from DB.
            await server.clients.redis.del(
                `sessions:v2:uuid:${(session as { uuid: string }).uuid}`,
            );
            const result = await authService.authenticate(token);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_expired',
                auth_id: user.uuid,
            });
        });

        it('returns { invalid } for a malformed token', async () => {
            const result = await authService.authenticate('not-a-jwt');
            expect(result.invalid).toBe(true);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toBeUndefined();
        });

        it('overlays reauth.token_v1 onto the actor when the token verifies via the legacy secret', async () => {
            // Hand-mint a v1-shape token with the legacy secret (no kid).
            // Compress the same way TokenService does so it round-trips
            // after verify.
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const legacyJwt = jwt.sign(
                {
                    // v1 compression: type=session → t='s', uuid → u, user_uid → uu
                    t: 's',
                    u: Buffer.from(
                        (session as { uuid: string }).uuid.replace(/-/g, ''),
                        'hex',
                    ).toString('base64'),
                    uu: Buffer.from(
                        user.uuid.replace(/-/g, ''),
                        'hex',
                    ).toString('base64'),
                },
                'dev-jwt-secret-change-me',
            );
            const result = await authService.authenticate(legacyJwt);
            // The actor is resolved (row exists and is active) AND the
            // reauth signal fires so SDK clients migrate.
            expect(result.actor?.user.uuid).toBe(user.uuid);
            expect(result.reauth?.reason).toBe('token_v1');
        });

        // ── App-under-user verify path ─────────────────────────────

        // Helper: insert a minimal app row so the verify path's
        // `stores.app.getByUid(decoded.app_uid)` lookup succeeds. Without
        // a real row the verify falls through to `{ invalid: true }`
        // before it ever checks the session state we want to test.
        const makeApp = async (): Promise<string> => {
            const uid = `app-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [
                    uid,
                    `n-${uid}`,
                    `t-${uid}`,
                    `https://${uid}.example/`,
                    1,
                ],
            );
            return uid;
        };

        it('app-under-user: returns reauth.session_revoked when the app session is revoked', async () => {
            const user = await makeUser();
            const appUid = await makeApp();
            const appToken = await authService.getUserAppToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                appUid,
            );
            // Pull the session_uid claim out of the JWT so we revoke
            // the exact row the verify path will look up.
            const decoded = server.services.token.verify(
                'auth',
                appToken,
            ) as { session_uid: string };
            await server.stores.session.removeByUuid(decoded.session_uid);

            const result = await authService.authenticate(appToken);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_revoked',
                auth_id: user.uuid,
            });
        });

        it('app-under-user: returns reauth.session_expired when the app session expires_at is in the past', async () => {
            const user = await makeUser();
            const appUid = await makeApp();
            const appToken = await authService.getUserAppToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                appUid,
            );
            const decoded = server.services.token.verify(
                'auth',
                appToken,
            ) as { session_uid: string };
            await server.clients.db.write(
                'UPDATE `sessions` SET `expires_at` = ? WHERE `uuid` = ?',
                [Math.floor(Date.now() / 1000) - 60, decoded.session_uid],
            );
            await server.clients.redis.del(
                `sessions:v2:uuid:${decoded.session_uid}`,
            );

            const result = await authService.authenticate(appToken);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_expired',
                auth_id: user.uuid,
            });
        });

        // ── Access-token verify path ───────────────────────────────

        it('access-token: returns reauth.session_revoked when the access-token session is revoked', async () => {
            const user = await makeUser();
            // Use the auto-implicated `user:<own-uuid>:email:read`
            // permission so the createAccessToken permission-subset
            // check passes without a separate grant; the permission
            // identity isn't what this test exercises.
            const accessToken = await authService.createAccessToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                [[`user:${user.uuid}:email:read`]],
            );
            const decoded = server.services.token.verify(
                'auth',
                accessToken,
            ) as { session_uid: string };
            await server.stores.session.removeByUuid(decoded.session_uid);

            const result = await authService.authenticate(accessToken);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_revoked',
                auth_id: user.uuid,
            });
        });

        it('access-token: returns reauth.session_expired when the access-token session expires_at is in the past', async () => {
            const user = await makeUser();
            // Pass a short expiresIn so the row gets a non-NULL
            // expires_at to start with — the verify path's expired-row
            // check only fires when expires_at is non-NULL.
            const accessToken = await authService.createAccessToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                [[`user:${user.uuid}:email:read`]],
                { expiresIn: '1h' },
            );
            const decoded = server.services.token.verify(
                'auth',
                accessToken,
            ) as { session_uid: string };
            await server.clients.db.write(
                'UPDATE `sessions` SET `expires_at` = ? WHERE `uuid` = ?',
                [Math.floor(Date.now() / 1000) - 60, decoded.session_uid],
            );
            await server.clients.redis.del(
                `sessions:v2:uuid:${decoded.session_uid}`,
            );

            const result = await authService.authenticate(accessToken);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_expired',
                auth_id: user.uuid,
            });
        });
    });

    describe('createSessionToken / createGuiToken / createSessionTokenForSession', () => {
        it('creates a session and signs verifiable session+GUI tokens', async () => {
            const user = await makeUser();
            const out = await authService.createSessionToken(user, {
                user_agent: 'test',
            });
            expect(out.session).toBeTruthy();
            expect(typeof out.token).toBe('string');
            expect(typeof out.gui_token).toBe('string');
            // Tokens differ — session vs. GUI type.
            expect(out.token).not.toBe(out.gui_token);

            const sessionDecoded = server.services.token.verify('auth', out.token) as {
                type: string;
            };
            expect(sessionDecoded.type).toBe('session');
            const guiDecoded = server.services.token.verify(
                'auth',
                out.gui_token,
            ) as { type: string };
            expect(guiDecoded.type).toBe('gui');
        });

        it('createGuiToken signs a gui token bound to a user + session uuid', async () => {
            const user = await makeUser();
            // Auth-token uuid fields go through UUID compression in the
            // signer, so a literal non-UUID string here would round-trip
            // back as garbage. Always pass real UUIDs.
            const sessionUuid = uuidv4();
            const token = authService.createGuiToken(user, sessionUuid);
            const decoded = server.services.token.verify('auth', token) as {
                type: string;
                user_uid: string;
                uuid: string;
            };
            expect(decoded.type).toBe('gui');
            expect(decoded.user_uid).toBe(user.uuid);
            expect(decoded.uuid).toBe(sessionUuid);
        });

        it('createSessionTokenForSession signs a session token bound to a user + session uuid', async () => {
            const user = await makeUser();
            const token = authService.createSessionTokenForSession(
                user,
                uuidv4(),
            );
            const decoded = server.services.token.verify('auth', token) as {
                type: string;
            };
            expect(decoded.type).toBe('session');
        });
    });

    describe('removeSessionByToken', () => {
        it('is a no-op on a malformed token (does not throw)', async () => {
            await expect(
                authService.removeSessionByToken('not-a-jwt'),
            ).resolves.toBeUndefined();
        });

        it('is a no-op on a token whose type is neither session nor gui', async () => {
            const otpJwt = server.services.token.sign(
                'auth',
                { type: 'access-token', token_uid: uuidv4(), user_uid: uuidv4() },
                { expiresIn: '5m' },
            );
            await expect(
                authService.removeSessionByToken(otpJwt),
            ).resolves.toBeUndefined();
        });

        it('removes the underlying session row for a valid session token', async () => {
            const user = await makeUser();
            const { token, session } = await authService.createSessionToken(
                user,
                {},
            );
            const sessionUuid = (session as { uuid: string }).uuid;
            // Sanity-check the row exists.
            expect(
                await server.stores.session.getByUuid(sessionUuid),
            ).toBeTruthy();

            await authService.removeSessionByToken(token);
            expect(
                await server.stores.session.getByUuid(sessionUuid),
            ).toBeFalsy();
        });
    });

    describe('listSessions / revokeSession', () => {
        it('listSessions returns [] for an actor without a user.id', async () => {
            const rows = await authService.listSessions({
                user: { id: undefined },
            } as unknown as Actor);
            expect(rows).toEqual([]);
        });

        it('listSessions returns rows for the actor and flags the current one', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {
                user_agent: 'agent',
            });
            const sessionUuid = (session as { uuid: string }).uuid;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: sessionUuid },
            } as unknown as Actor;
            const rows = await authService.listSessions(actor);
            expect(rows.length).toBeGreaterThan(0);
            const match = rows.find(
                (r) => (r as { uuid: string }).uuid === sessionUuid,
            );
            expect(match).toBeTruthy();
            expect((match as { current: boolean }).current).toBe(true);
        });

        it('revokeSession removes the session row', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            await authService.revokeSession(sessionUuid);
            expect(
                await server.stores.session.getByUuid(sessionUuid),
            ).toBeFalsy();
        });

        it('listSessions excludes kind="asset" rows', async () => {
            // Asset rows are per-cookie children of `web` rows, revoked
            // transitively via the cascade — surfacing them in the
            // manage-sessions UI as standalone entries would be confusing.
            const user = await makeUser();
            const { session: webSession } =
                await authService.createSessionToken(user, {});
            const webUuid = (webSession as { uuid: string }).uuid;
            const assetRow = await server.stores.session.create(user.id, {
                kind: 'asset',
                parent_session_id: webUuid,
            });
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: webUuid },
            } as unknown as Actor;
            const rows = await authService.listSessions(actor);
            expect(
                rows.find(
                    (r) =>
                        (r as { uuid: string }).uuid ===
                        (assetRow as { uuid: string }).uuid,
                ),
            ).toBeUndefined();
            expect(
                rows.find((r) => (r as { uuid: string }).uuid === webUuid),
            ).toBeTruthy();
        });

        it('listSessions enriches rows with kind / expires_at / last_ip / created_via', async () => {
            // Manage-sessions GUI keys on these fields to render the rich
            // row layout (kind badge, IP, expires-in). Lock the shape so
            // future GUI work can rely on them.
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {
                user_agent: 'shape-probe',
                ip: '203.0.113.7',
            });
            const sessionUuid = (session as { uuid: string }).uuid;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: sessionUuid },
            } as unknown as Actor;
            const rows = await authService.listSessions(actor);
            const row = rows.find(
                (r) => (r as { uuid: string }).uuid === sessionUuid,
            ) as Record<string, unknown> | undefined;
            expect(row).toBeTruthy();
            expect(row!.kind).toBe('web');
            expect(typeof row!.created_at).toBe('number');
            expect(typeof row!.last_activity).toBe('number');
            expect(row!.expires_at).toEqual(expect.any(Number));
            expect(row!.last_ip).toBe('203.0.113.7');
            // app_uid / app are null for web rows; present for app rows.
            expect(row!.app_uid).toBeNull();
            expect(row!.app).toBeNull();
            // parent_session_id is null for top-level web rows but the
            // field must be present so the GUI tree-builder can key on
            // it; same for last_user_agent (powers UA→browser/OS render).
            expect(row!).toHaveProperty('parent_session_id');
            expect(row!.parent_session_id).toBeNull();
            expect(row!).toHaveProperty('last_user_agent');
        });

        it('listSessions surfaces parent_session_id and last_user_agent for derived rows', async () => {
            // GUI tree-nesting (PUT-1025) reads `parent_session_id` to
            // attach children under the right parent; the UA parser
            // reads `last_user_agent`. If either drops out of the
            // projection the GUI degrades to a flat list with no client
            // label.
            const user = await makeUser();
            const { session: parent } = await authService.createSessionToken(
                user,
                { ip: '198.51.100.1', user_agent: 'parent-ua' },
            );
            const parentUuid = (parent as { uuid: string }).uuid;
            const child = await server.stores.session.create(user.id, {
                kind: 'app',
                parent_session_id: parentUuid,
                last_user_agent: 'child-ua',
                last_ip: '198.51.100.2',
            });
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: parentUuid },
            } as unknown as Actor;
            const rows = await authService.listSessions(actor);
            const childRow = rows.find(
                (r) =>
                    (r as { uuid: string }).uuid ===
                    (child as { uuid: string }).uuid,
            ) as Record<string, unknown> | undefined;
            expect(childRow).toBeTruthy();
            expect(childRow!.parent_session_id).toBe(parentUuid);
            expect(childRow!.last_user_agent).toBe('child-ua');
        });

        it('listSessions joins kind="app" rows with the apps table', async () => {
            // App rows carry an `app_uid`; AuthService.listSessions does a
            // batch lookup against the apps table so the GUI doesn't need a
            // second round trip. If the app row exists, the response
            // includes a non-null `app: { uid, name, title, icon }`.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `icon`, `description`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    appUid,
                    `app_name_${Math.random().toString(36).slice(2, 10)}`,
                    'Listed App Title',
                    'data:image/png;base64,ICON',
                    '',
                    `https://${Math.random().toString(36).slice(2, 10)}.example`,
                    user.id ?? null,
                ],
            );
            await server.stores.session.create(user.id, {
                kind: 'app',
                app_uid: appUid,
            });
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as unknown as Actor;
            const rows = await authService.listSessions(actor);
            const appRow = rows.find(
                (r) => (r as { kind?: string }).kind === 'app',
            ) as Record<string, unknown> | undefined;
            expect(appRow).toBeTruthy();
            expect(appRow!.app_uid).toBe(appUid);
            const app = appRow!.app as { title: string; icon: string };
            expect(app.title).toBe('Listed App Title');
            expect(app.icon).toBe('data:image/png;base64,ICON');
        });

        it('listSessions sorts the actor’s current session first, then by last_activity desc', async () => {
            // Manage-sessions GUI anchors "you are here" at the top of the
            // list; downstream rendering doesn't re-sort, so the backend
            // order is what users see.
            const user = await makeUser();
            const { session: olderSession } =
                await authService.createSessionToken(user, {});
            const { session: newerSession } =
                await authService.createSessionToken(user, {});
            const { session: currentSession } =
                await authService.createSessionToken(user, {});
            const olderUuid = (olderSession as { uuid: string }).uuid;
            const newerUuid = (newerSession as { uuid: string }).uuid;
            const currentUuid = (currentSession as { uuid: string }).uuid;
            // Bump `last_activity` to FUTURE values — updateActivity has
            // a `last_activity < ?` guard that skips no-op updates, so
            // any past timestamp gets silently dropped after the fresh
            // rows created above stamped `last_activity = now`.
            const future = Math.floor(Date.now() / 1000) + 60_000;
            await server.stores.session.updateActivity(olderUuid, future);
            await server.stores.session.updateActivity(newerUuid, future + 1000);
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: currentUuid },
            } as unknown as Actor;
            const rows = await authService.listSessions(actor);
            const ourRows = rows.filter((r) =>
                [olderUuid, newerUuid, currentUuid].includes(
                    (r as { uuid: string }).uuid,
                ),
            );
            expect(
                (ourRows[0] as { uuid: string; current: boolean }).uuid,
            ).toBe(currentUuid);
            expect((ourRows[0] as { current: boolean }).current).toBe(true);
            // Newer non-current row comes before the older one.
            const newerIdx = ourRows.findIndex(
                (r) => (r as { uuid: string }).uuid === newerUuid,
            );
            const olderIdx = ourRows.findIndex(
                (r) => (r as { uuid: string }).uuid === olderUuid,
            );
            expect(newerIdx).toBeLessThan(olderIdx);
        });
    });

    describe('authenticate (ctx threading: IP/UA roam refresh)', () => {
        // The touch path is throttled per-uuid by TOUCH_THROTTLE_MS, so a
        // fresh session won't fire updateActivity again on the next
        // authenticate() call. Backdating `last_activity` AND the
        // in-memory throttle map is the smallest surgery to make the
        // touch deterministic from the test.
        const ageSessionForTouch = async (sessionUuid: string) => {
            const ancient = Math.floor(Date.now() / 1000) - 3600;
            await server.clients.db.write(
                'UPDATE `sessions` SET `last_activity` = ? WHERE `uuid` = ?',
                [ancient, sessionUuid],
            );
            // The store's in-memory throttle is keyed on uuid — clear it
            // so the next touch isn't coalesced by the recent-create
            // entry from createSessionToken.
            const store = server.stores.session as unknown as {
                ['#lastSessionTouchMs']?: Map<string, number>;
            };
            // Private field access via the public clear path: a `clear()`
            // helper isn't exposed, so we re-construct the touch by
            // running it once with a long-ago timestamp that the SQL
            // guard accepts. Simpler: read raw row directly after
            // authenticate to confirm column was rewritten.
            // (Throttle map values live on the instance — but at module
            // boundary across `describe`s they should be empty for a
            // fresh uuid.)
            void store; // intentional no-op — kept as a docstring anchor
            await server.clients.redis.del(
                `sessions:v2:uuid:${sessionUuid}`,
            );
        };

        const readRawRow = async (uuid: string) => {
            const rows = await server.clients.db.read(
                'SELECT `last_ip`, `last_user_agent` FROM `sessions` WHERE `uuid` = ? LIMIT 1',
                [uuid],
            );
            return rows[0] as
                | { last_ip: string | null; last_user_agent: string | null }
                | undefined;
        };

        it('session token: passing ctx.ip and ctx.userAgent refreshes the row', async () => {
            const user = await makeUser();
            const { token, session } = await authService.createSessionToken(
                user,
                { ip: '1.1.1.1', user_agent: 'old-ua' },
            );
            const sessionUuid = (session as { uuid: string }).uuid;
            await ageSessionForTouch(sessionUuid);

            await authService.authenticate(token, {
                ip: '9.9.9.9',
                userAgent: 'new-ua',
            });

            const row = await readRawRow(sessionUuid);
            expect(row?.last_ip).toBe('9.9.9.9');
            expect(row?.last_user_agent).toBe('new-ua');
        });

        it('session token: omitting ctx leaves last_ip / last_user_agent unchanged', async () => {
            const user = await makeUser();
            const { token, session } = await authService.createSessionToken(
                user,
                { ip: '5.5.5.5', user_agent: 'stable-ua' },
            );
            const sessionUuid = (session as { uuid: string }).uuid;
            await ageSessionForTouch(sessionUuid);

            await authService.authenticate(token);

            const row = await readRawRow(sessionUuid);
            expect(row?.last_ip).toBe('5.5.5.5');
            expect(row?.last_user_agent).toBe('stable-ua');
        });

        it('app-under-user token: ctx refreshes the app session row', async () => {
            const user = await makeUser();
            // makeApp helper from the outer describe isn't in scope; inline a minimal app row.
            const appUid = `app-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [
                    appUid,
                    `n-${appUid}`,
                    `t-${appUid}`,
                    `https://${appUid}.example/`,
                    1,
                ],
            );
            const appToken = await authService.getUserAppToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                appUid,
            );
            const decoded = server.services.token.verify(
                'auth',
                appToken,
            ) as { session_uid: string };
            await ageSessionForTouch(decoded.session_uid);

            await authService.authenticate(appToken, {
                ip: '10.0.0.1',
                userAgent: 'app-roam-ua',
            });

            const row = await readRawRow(decoded.session_uid);
            expect(row?.last_ip).toBe('10.0.0.1');
            expect(row?.last_user_agent).toBe('app-roam-ua');
        });

        it('access-token: ctx refreshes the access-token session row', async () => {
            const user = await makeUser();
            const accessToken = await authService.createAccessToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                [[`user:${user.uuid}:email:read`]],
                { expiresIn: '1h' },
            );
            const decoded = server.services.token.verify(
                'auth',
                accessToken,
            ) as { session_uid: string };
            await ageSessionForTouch(decoded.session_uid);

            await authService.authenticate(accessToken, {
                ip: '203.0.113.20',
                userAgent: 'at-roam-ua',
            });

            const row = await readRawRow(decoded.session_uid);
            expect(row?.last_ip).toBe('203.0.113.20');
            expect(row?.last_user_agent).toBe('at-roam-ua');
        });
    });

    describe('setSessionLabel', () => {
        it('throws 403 when actor has no user', async () => {
            await expect(
                authService.setSessionLabel(
                    { user: undefined } as unknown as Actor,
                    uuidv4(),
                    'x',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('throws 404 when the uuid does not exist', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            await expect(
                authService.setSessionLabel(actor, uuidv4(), 'nope'),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('throws 404 when the uuid belongs to another user', async () => {
            const owner = await makeUser();
            const interloper = await makeUser();
            const { session } = await authService.createSessionToken(owner, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const interloperActor = {
                user: {
                    id: interloper.id,
                    uuid: interloper.uuid,
                    username: interloper.username,
                },
            } as Actor;
            await expect(
                authService.setSessionLabel(
                    interloperActor,
                    sessionUuid,
                    'pwned',
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('renames the row for the owning user', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            await authService.setSessionLabel(actor, sessionUuid, 'My Laptop');
            const rows = await server.clients.db.read(
                'SELECT `label` FROM `sessions` WHERE `uuid` = ?',
                [sessionUuid],
            );
            expect((rows[0] as { label: string }).label).toBe('My Laptop');
        });

        it('trims whitespace and caps at 64 characters', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            // Lead/trail whitespace + 80 chars of body — expect trim then 64-char cap.
            const padded = '   ' + 'a'.repeat(80) + '   ';
            await authService.setSessionLabel(actor, sessionUuid, padded);
            const rows = await server.clients.db.read(
                'SELECT `label` FROM `sessions` WHERE `uuid` = ?',
                [sessionUuid],
            );
            const stored = (rows[0] as { label: string }).label;
            expect(stored.length).toBe(64);
            expect(stored).toBe('a'.repeat(64));
        });

        it('stores null when label is empty / whitespace / explicit null', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {
                user_agent: 'unused',
            });
            const sessionUuid = (session as { uuid: string }).uuid;
            // Seed with a non-null label so we can prove a follow-up null clears it.
            await server.clients.db.write(
                'UPDATE `sessions` SET `label` = ? WHERE `uuid` = ?',
                ['initial', sessionUuid],
            );
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;

            for (const empty of ['', '   ', null]) {
                await authService.setSessionLabel(
                    actor,
                    sessionUuid,
                    empty as string | null,
                );
                const rows = await server.clients.db.read(
                    'SELECT `label` FROM `sessions` WHERE `uuid` = ?',
                    [sessionUuid],
                );
                expect((rows[0] as { label: string | null }).label).toBeNull();
                // Re-seed for the next iteration.
                await server.clients.db.write(
                    'UPDATE `sessions` SET `label` = ? WHERE `uuid` = ?',
                    ['initial', sessionUuid],
                );
            }
        });
    });

    describe('createWorkerSessionToken / createWorkerAppToken', () => {
        // The test config's v2 jwt_secret is the source of truth for
        // verifying claims; go through TokenService to mirror how
        // production decodes the same tokens.
        const decodeAuth = (token: string): Record<string, unknown> => {
            return server.services.token.verify('auth', token) as Record<
                string,
                unknown
            >;
        };

        const readMeta = (row: Record<string, unknown>) =>
            (typeof row.meta === 'string'
                ? (JSON.parse(row.meta as string) as Record<string, unknown>)
                : (row.meta as Record<string, unknown>)) ?? {};

        it('createWorkerSessionToken mints a kind="worker" row tagged meta.worker_name with the WORKER_WINDOW_SECONDS expiry', async () => {
            const user = await makeUser();
            const before = Math.floor(Date.now() / 1000);
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const { session, token, gui_token } =
                await authService.createWorkerSessionToken(user, workerName, {
                    user_agent: 'worker-agent',
                });

            const row = (await server.stores.session.getByUuid(
                (session as { uuid: string }).uuid,
            )) as Record<string, unknown>;
            expect(row.kind).toBe('worker');
            expect(row.app_uid).toBeNull();
            // expires_at lands in the ~99-year window — assert lower
            // bound only so the test isn't fragile to small drift or a
            // future constant adjustment.
            expect(row.expires_at as number).toBeGreaterThanOrEqual(
                before + 50 * 365 * 24 * 60 * 60,
            );
            const meta = readMeta(row);
            expect(meta.worker).toBe(true);
            expect(meta.worker_name).toBe(workerName);

            // Both JWTs carry the worker + worker_name claims so
            // downstream code can distinguish without a DB hit.
            expect(decodeAuth(token).worker).toBe(true);
            expect(decodeAuth(token).worker_name).toBe(workerName);
            expect(decodeAuth(gui_token).worker).toBe(true);
            expect(decodeAuth(gui_token).worker_name).toBe(workerName);
        });

        it('createWorkerSessionToken is idempotent on (user, worker_name) — redeploys reuse the row', async () => {
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const a = await authService.createWorkerSessionToken(
                user,
                workerName,
            );
            const b = await authService.createWorkerSessionToken(
                user,
                workerName,
            );
            expect((a.session as { uuid: string }).uuid).toBe(
                (b.session as { uuid: string }).uuid,
            );
        });

        it('createWorkerSessionToken with different worker_names mints distinct rows for the same user', async () => {
            const user = await makeUser();
            const a = await authService.createWorkerSessionToken(
                user,
                `wk-${Math.random().toString(36).slice(2, 8)}-a`,
            );
            const b = await authService.createWorkerSessionToken(
                user,
                `wk-${Math.random().toString(36).slice(2, 8)}-b`,
            );
            expect((a.session as { uuid: string }).uuid).not.toBe(
                (b.session as { uuid: string }).uuid,
            );
        });

        it('createWorkerSessionToken rejects an empty workerName (400)', async () => {
            const user = await makeUser();
            await expect(
                authService.createWorkerSessionToken(user, ''),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('createWorkerAppToken mints a kind="worker" row with worker_name + WORKER_WINDOW_SECONDS expiry', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const before = Math.floor(Date.now() / 1000);
            const token = await authService.createWorkerAppToken(
                actor,
                appUid,
                workerName,
            );

            const decoded = decodeAuth(token);
            expect(decoded.type).toBe('app-under-user');
            expect(decoded.worker).toBe(true);
            expect(decoded.worker_name).toBe(workerName);
            expect(decoded.app_uid).toBe(appUid);
            expect(decoded.user_uid).toBe(user.uuid);

            const row = (await server.stores.session.getByUuid(
                decoded.session_uid as string,
            )) as Record<string, unknown>;
            expect(row.kind).toBe('worker');
            expect(row.app_uid).toBe(appUid);
            expect(row.expires_at as number).toBeGreaterThanOrEqual(
                before + 50 * 365 * 24 * 60 * 60,
            );
            const meta = readMeta(row);
            expect(meta.worker).toBe(true);
            expect(meta.worker_name).toBe(workerName);
        });

        it('createWorkerAppToken is idempotent on (user, app, worker_name)', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const a = await authService.createWorkerAppToken(
                actor,
                appUid,
                workerName,
            );
            const b = await authService.createWorkerAppToken(
                actor,
                appUid,
                workerName,
            );
            expect((decodeAuth(a) as { session_uid: string }).session_uid).toBe(
                (decodeAuth(b) as { session_uid: string }).session_uid,
            );
        });

        it('createWorkerAppToken coexists with an interactive app session for the same (user, app)', async () => {
            // The point of `kind="worker"` is precisely to avoid the
            // `idx_sessions_user_app_active` collision that bit us
            // pre-schema-carve-out. Verify: getUserAppToken creates the
            // interactive `kind="app"` row, then createWorkerAppToken
            // for the SAME (user, app) succeeds and yields a distinct
            // row with kind="worker".
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const interactiveJwt = await authService.getUserAppToken(
                actor,
                appUid,
            );
            const interactiveDecoded = decodeAuth(interactiveJwt);
            const interactiveSessionUid =
                interactiveDecoded.session_uid as string;

            const workerJwt = await authService.createWorkerAppToken(
                actor,
                appUid,
                workerName,
            );
            const workerDecoded = decodeAuth(workerJwt);
            const workerSessionUid = workerDecoded.session_uid as string;

            expect(workerSessionUid).not.toBe(interactiveSessionUid);

            const interactiveRow = (await server.stores.session.getByUuid(
                interactiveSessionUid,
            )) as Record<string, unknown>;
            const workerRow = (await server.stores.session.getByUuid(
                workerSessionUid,
            )) as Record<string, unknown>;
            expect(interactiveRow.kind).toBe('app');
            expect(workerRow.kind).toBe('worker');
            expect(workerRow.app_uid).toBe(appUid);
        });

        it('createWorkerAppToken with different worker_names under the same (user, app) mints distinct rows', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const a = await authService.createWorkerAppToken(
                actor,
                appUid,
                `wk-${Math.random().toString(36).slice(2, 8)}-a`,
            );
            const b = await authService.createWorkerAppToken(
                actor,
                appUid,
                `wk-${Math.random().toString(36).slice(2, 8)}-b`,
            );
            expect((decodeAuth(a) as { session_uid: string }).session_uid).not.toBe(
                (decodeAuth(b) as { session_uid: string }).session_uid,
            );
        });

        it('createWorkerAppToken refuses an actor with no user (403)', async () => {
            await expect(
                authService.createWorkerAppToken(
                    { user: undefined } as unknown as Actor,
                    'app-x',
                    'wk-x',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('createWorkerAppToken rejects an empty workerName (400)', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            await expect(
                authService.createWorkerAppToken(
                    actor,
                    `app-${uuidv4()}`,
                    '',
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('createWorkerAppToken refuses an app actor targeting a different app (403)', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { uid: `app-${uuidv4()}` },
            } as Actor;
            await expect(
                authService.createWorkerAppToken(
                    actor,
                    `app-${uuidv4()}`,
                    'wk-x',
                ),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        });

        // ── Revocation flow ────────────────────────────────────────

        it('revokeSession on a worker session — authenticate returns reauth.session_revoked', async () => {
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const { token, session } =
                await authService.createWorkerSessionToken(user, workerName);
            const sessionUuid = (session as { uuid: string }).uuid;

            await authService.revokeSession(sessionUuid);

            const result = await authService.authenticate(token);
            expect(result.actor).toBeUndefined();
            expect(result.reauth).toEqual({
                reason: 'session_revoked',
                auth_id: user.uuid,
            });
        });

        it('createWorkerSessionToken after revoke mints a new session uuid (composite cache invalidates)', async () => {
            // Pre-fix, the worker composite cache could short-circuit
            // back to the revoked row. Verify cache invalidation runs on
            // revoke so the re-create produces a fresh row.
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const first = await authService.createWorkerSessionToken(
                user,
                workerName,
            );
            const firstUuid = (first.session as { uuid: string }).uuid;
            await authService.revokeSession(firstUuid);

            const second = await authService.createWorkerSessionToken(
                user,
                workerName,
            );
            const secondUuid = (second.session as { uuid: string }).uuid;
            expect(secondUuid).not.toBe(firstUuid);

            // The new JWT authenticates; the old one does not.
            const oldResult = await authService.authenticate(first.token);
            const newResult = await authService.authenticate(second.token);
            expect(oldResult.actor).toBeUndefined();
            expect(newResult.actor?.user.uuid).toBe(user.uuid);
        });

        it('createWorkerAppToken after revoke mints a new session uuid', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const firstJwt = await authService.createWorkerAppToken(
                actor,
                appUid,
                workerName,
            );
            const firstDecoded = server.services.token.verify(
                'auth',
                firstJwt,
            ) as { session_uid: string };
            await authService.revokeSession(firstDecoded.session_uid);

            const secondJwt = await authService.createWorkerAppToken(
                actor,
                appUid,
                workerName,
            );
            const secondDecoded = server.services.token.verify(
                'auth',
                secondJwt,
            ) as { session_uid: string };
            expect(secondDecoded.session_uid).not.toBe(
                firstDecoded.session_uid,
            );
        });

        it('removeSessionByToken on a worker token soft-revokes the row', async () => {
            // The logout / signout path lands here. Worker JWTs carry
            // type='session' so the same code path applies; verify it
            // flips revoked_at and authenticate stops resolving the actor.
            const user = await makeUser();
            const workerName = `wk-${Math.random().toString(36).slice(2, 8)}`;
            const { token, session } =
                await authService.createWorkerSessionToken(user, workerName);
            const sessionUuid = (session as { uuid: string }).uuid;

            await authService.removeSessionByToken(token);

            const result = await authService.authenticate(token);
            expect(result.actor).toBeUndefined();
            expect(result.reauth?.reason).toBe('session_revoked');

            // Row still present, just soft-revoked.
            const rows = (await server.clients.db.read(
                'SELECT `revoked_at` FROM `sessions` WHERE `uuid` = ? LIMIT 1',
                [sessionUuid],
            )) as Array<{ revoked_at: number | null }>;
            expect(rows[0]?.revoked_at).not.toBeNull();
        });
    });

    describe('appUidFromOrigin', () => {
        it('throws 400 for an unparseable origin string', async () => {
            await expect(
                authService.appUidFromOrigin('not-a-url'),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('returns a deterministic app-<uuid> for arbitrary origins', async () => {
            const origin = `https://stable-${uuidv4()}.example.com`;
            const a = await authService.appUidFromOrigin(origin);
            const b = await authService.appUidFromOrigin(origin);
            expect(a).toBe(b);
            expect(a).toMatch(/^app-/);
        });

        it.each([
            'javascript:alert(document.domain)',
            'data:text/html,<script>alert(1)</script>',
            'file:///etc/passwd',
            'vbscript:msgbox(1)',
        ])('throws 400 for non-http(s) scheme %s', async (origin) => {
            // These parse fine via `new URL()` but must never become a
            // bootstrap app `index_url` — that would be a stored XSS /
            // code-execution vector when launched as `iframe.src`.
            await expect(
                authService.appUidFromOrigin(origin),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('subdomainOwnerIdFromOrigin', () => {
        // Test servers inherit the four hosting domains (production:
        // puter.site / puter.host / puter.app / puter.dev) from
        // config.default.json.
        it.each([
            'site.puter.localhost',
            'host.puter.localhost',
            'app.puter.localhost',
            'dev.puter.localhost',
        ])(
            'returns the subdomain owner for an origin under %s',
            async (hostingDomain) => {
                const user = await makeUser();
                const subdomain = `own-${Math.random().toString(36).slice(2, 10)}`;
                await server.stores.subdomain.create({
                    userId: user.id,
                    subdomain,
                });
                await expect(
                    authService.subdomainOwnerIdFromOrigin(
                        `https://${subdomain}.${hostingDomain}`,
                    ),
                ).resolves.toBe(user.id);
            },
        );

        it('matches a hosted origin that carries an explicit port', async () => {
            const user = await makeUser();
            const subdomain = `own-${Math.random().toString(36).slice(2, 10)}`;
            await server.stores.subdomain.create({
                userId: user.id,
                subdomain,
            });
            await expect(
                authService.subdomainOwnerIdFromOrigin(
                    `http://${subdomain}.site.puter.localhost:4100`,
                ),
            ).resolves.toBe(user.id);
        });

        it('returns null for an origin outside the hosting domains', async () => {
            await expect(
                authService.subdomainOwnerIdFromOrigin(
                    `https://external-${uuidv4()}.example.com`,
                ),
            ).resolves.toBeNull();
        });

        it('returns null for a subdomain of the main domain', async () => {
            // `<sub>.puter.localhost` sits under the main `domain`, not a
            // hosting domain — no owner resolves even when a subdomain row
            // with the same name exists.
            const user = await makeUser();
            const subdomain = `own-${Math.random().toString(36).slice(2, 10)}`;
            await server.stores.subdomain.create({
                userId: user.id,
                subdomain,
            });
            await expect(
                authService.subdomainOwnerIdFromOrigin(
                    `https://${subdomain}.puter.localhost`,
                ),
            ).resolves.toBeNull();
        });

        it('returns null for an unregistered subdomain and for the apex host', async () => {
            await expect(
                authService.subdomainOwnerIdFromOrigin(
                    `https://ghost-${uuidv4().slice(0, 8)}.site.puter.localhost`,
                ),
            ).resolves.toBeNull();
            await expect(
                authService.subdomainOwnerIdFromOrigin(
                    'https://site.puter.localhost',
                ),
            ).resolves.toBeNull();
        });

        it('returns null for an unparseable origin', async () => {
            await expect(
                authService.subdomainOwnerIdFromOrigin('not-a-url'),
            ).resolves.toBeNull();
        });
    });

    describe('app origin blocklist enforcement', () => {
        // The blocklist service caches with a TTL, so seed the row then
        // invalidate the in-memory snapshot to force a reload for the test.
        const blockOrigin = async (
            domain: string,
            includeSubdomains = false,
        ) => {
            await server.clients.db.write(
                'INSERT INTO `blocked_app_origins` (`domain`, `include_subdomains`) VALUES (?, ?)',
                [domain, includeSubdomains ? 1 : 0],
            );
            (
                server.services.appOriginBlocklist as {
                    invalidate: () => void;
                }
            ).invalidate();
        };

        it('appUidFromOrigin throws 403 app_blocked for a blocked exact host', async () => {
            const host = `blocked-${uuidv4()}.example.com`;
            await blockOrigin(host);
            await expect(
                authService.appUidFromOrigin(`https://${host}/`),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'app_blocked',
            });
        });

        it('appUidFromOrigin throws for a subdomain of an include_subdomains entry', async () => {
            const apex = `evil-${uuidv4()}.example.com`;
            await blockOrigin(apex, true);
            await expect(
                authService.appUidFromOrigin(`https://app.${apex}/`),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'app_blocked',
            });
        });

        it('appUidFromOrigin still resolves an unrelated origin', async () => {
            const uid = await authService.appUidFromOrigin(
                `https://fine-${uuidv4()}.example.com/`,
            );
            expect(uid).toMatch(/^app-/);
        });

        it('rejects an already-issued app token once its origin is blocked', async () => {
            const user = await makeUser();
            const host = `late-block-${uuidv4()}.example.com`;
            const appUid = `app-${uuidv4()}`;
            // App row carries the to-be-blocked host as its index_url.
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [appUid, `n-${appUid}`, `t-${appUid}`, `https://${host}/`, 1],
            );
            const appToken = await authService.getUserAppToken(
                {
                    user: {
                        id: user.id,
                        uuid: user.uuid,
                        username: user.username,
                    },
                } as Actor,
                appUid,
            );

            // Before blocking the token authenticates normally.
            const ok = await authService.authenticate(appToken);
            expect(ok.actor?.app?.uid).toBe(appUid);

            // After blocking the same token is rejected with the blocked signal.
            await blockOrigin(host);
            const blocked = await authService.authenticate(appToken);
            expect(blocked.actor).toBeUndefined();
            expect(blocked.blocked).toBeTruthy();
        });
    });

    describe('getUserAppToken', () => {
        it('throws 403 when actor has no user', async () => {
            await expect(
                authService.getUserAppToken(
                    { user: undefined } as unknown as Actor,
                    'app-foo',
                ),
            ).rejects.toThrow(/Actor must be a user/);
        });

        it('signs an app-under-user JWT carrying user_uid + app_uid', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const appUid = `app-${uuidv4()}`;
            const token = await authService.getUserAppToken(actor, appUid);
            const decoded = server.services.token.verify('auth', token) as {
                type: string;
                user_uid: string;
                app_uid: string;
            };
            expect(decoded.type).toBe('app-under-user');
            expect(decoded.user_uid).toBe(user.uuid);
            expect(decoded.app_uid).toBe(appUid);
        });

        it('binds the JWT to a kind="app" session row and reuses it on repeat calls', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const appUid = `app-${uuidv4()}`;
            const first = await authService.getUserAppToken(actor, appUid);
            const second = await authService.getUserAppToken(actor, appUid);
            const decodedFirst = server.services.token.verify(
                'auth',
                first,
            ) as { session_uid: string };
            const decodedSecond = server.services.token.verify(
                'auth',
                second,
            ) as { session_uid: string };
            // Idempotent per (user_id, app_uid) — both tokens reference the
            // same app session row.
            expect(decodedFirst.session_uid).toBe(decodedSecond.session_uid);
        });

        // Delegation scope: a scoped actor (app-under-user or access-token)
        // may only mint a token for its own app; only a root user session
        // may request a token for an arbitrary app.
        it('lets an app actor mint a token for its own app', async () => {
            const user = await makeUser();
            const ownApp = `app-${uuidv4()}`;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { uid: ownApp },
            } as Actor;
            const token = await authService.getUserAppToken(actor, ownApp);
            const decoded = server.services.token.verify('auth', token) as {
                app_uid: string;
            };
            expect(decoded.app_uid).toBe(ownApp);
        });

        it('refuses an app actor minting a token for a different app (403)', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { uid: `app-${uuidv4()}` },
            } as Actor;
            await expect(
                authService.getUserAppToken(actor, `app-${uuidv4()}`),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        });

        it('refuses an access-token actor minting an app token (403)', async () => {
            const user = await makeUser();
            const issuer = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                accessToken: { uid: `tok-${uuidv4()}`, issuer, authorized: null },
            } as Actor;
            await expect(
                authService.getUserAppToken(actor, `app-${uuidv4()}`),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        });

        it('lets a root user session mint a token for any app', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const anyApp = `app-${uuidv4()}`;
            const token = await authService.getUserAppToken(actor, anyApp);
            const decoded = server.services.token.verify('auth', token) as {
                app_uid: string;
            };
            expect(decoded.app_uid).toBe(anyApp);
        });
    });

    describe('createAccessToken / revokeAccessToken', () => {
        it('creates a verifiable access-token JWT for a user actor', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(actor, [
                [`user:${user.uuid}:email:read`],
            ]);
            const decoded = server.services.token.verify('auth', jwt) as {
                type: string;
                user_uid: string;
                token_uid: string;
            };
            expect(decoded.type).toBe('access-token');
            expect(decoded.user_uid).toBe(user.uuid);
            expect(decoded.token_uid).toBeTruthy();
        });

        it('revokeAccessToken removes by JWT (signature-verified ownership)', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(actor, [
                [`user:${user.uuid}:email:read`],
            ]);
            await authService.revokeAccessToken(actor, jwt);

            // Row is gone.
            const decoded = server.services.token.verify('auth', jwt) as {
                token_uid: string;
            };
            const rows = (await server.clients.db.read(
                'SELECT 1 FROM `access_token_permissions` WHERE `token_uid` = ? LIMIT 1',
                [decoded.token_uid],
            )) as unknown[];
            expect(rows).toHaveLength(0);
        });

        it('revokeAccessToken rejects with 404 when the token belongs to another user', async () => {
            const u1 = await makeUser();
            const u2 = await makeUser();
            const a1 = {
                user: { id: u1.id, uuid: u1.uuid, username: u1.username },
            } as Actor;
            const a2 = {
                user: { id: u2.id, uuid: u2.uuid, username: u2.username },
            } as Actor;
            const jwt = await authService.createAccessToken(a1, [
                [`user:${u1.uuid}:email:read`],
            ]);
            await expect(
                authService.revokeAccessToken(a2, jwt),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('revokeAccessToken removes by raw token UUID when the actor is the authorizer', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(actor, [
                [`user:${user.uuid}:email:read`],
            ]);
            const decoded = server.services.token.verify('auth', jwt) as {
                token_uid: string;
            };
            await authService.revokeAccessToken(actor, decoded.token_uid);
            const rows = (await server.clients.db.read(
                'SELECT 1 FROM `access_token_permissions` WHERE `token_uid` = ? LIMIT 1',
                [decoded.token_uid],
            )) as unknown[];
            expect(rows).toHaveLength(0);
        });

        it('revokeAccessToken throws 400 on a JWT that is not an access-token', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const sessionJwt = server.services.token.sign('auth', {
                type: 'session',
                version: '0.0.0',
                uuid: uuidv4(),
                user_uid: user.uuid,
            });
            await expect(
                authService.revokeAccessToken(actor, sessionJwt),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('revokeAccessToken throws 403 when the actor has no user', async () => {
            await expect(
                authService.revokeAccessToken(
                    { user: undefined } as unknown as Actor,
                    'whatever',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        // Regression for the post-#1001 token-inval check: an
        // app-under-user actor must be able to mint a token for a file
        // inside its own AppData. Without the `app-owns-appdata`
        // implicator the issuer-subset gate 403s these — even though
        // ACLService already allows the equivalent fs.read via its own
        // short-circuit. puter-js getReadURL is the canonical caller.
        it('app-under-user actor can mint fs:<uuid>:read for a file inside its own AppData', async () => {
            const user = await makeUser();
            await generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                user,
            );
            const appUid = `app-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [
                    appUid,
                    `n-${appUid}`,
                    `t-${appUid}`,
                    `https://${appUid}.example/`,
                    user.id,
                ],
            );

            const appDataPath = `/${user.username}/AppData/${appUid}`;
            await server.services.fs.mkdir(user.id, {
                path: appDataPath,
                createMissingParents: true,
            } as never);
            const body = Buffer.from('hello');
            await server.services.fs.write(user.id, {
                fileMetadata: {
                    path: `${appDataPath}/note.txt`,
                    size: body.byteLength,
                    contentType: 'text/plain',
                },
                fileContent: body,
            } as never);
            const fileEntry = await server.stores.fsEntry.getEntryByPath(
                `${appDataPath}/note.txt`,
            );
            expect(fileEntry).not.toBeNull();

            const appActor: Actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { id: 0, uid: appUid },
            } as Actor;

            const jwt = await authService.createAccessToken(appActor, [
                [`fs:${fileEntry!.uuid}:read`],
            ]);
            expect(typeof jwt).toBe('string');
        });

        // Negative side of the implicator: a file the user owns but
        // that lives *outside* the app's AppData must still be
        // rejected — the issuer-subset gate is the only thing
        // preventing an authorized app from minting a token over
        // arbitrary user-owned uuids.
        it('app-under-user actor cannot mint fs:<uuid>:read for a user-owned file outside its AppData', async () => {
            const user = await makeUser();
            await generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                user,
            );
            const appUid = `app-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
                [
                    appUid,
                    `n-${appUid}`,
                    `t-${appUid}`,
                    `https://${appUid}.example/`,
                    user.id,
                ],
            );

            const body = Buffer.from('secret');
            await server.services.fs.write(user.id, {
                fileMetadata: {
                    path: `/${user.username}/Documents/secret.txt`,
                    size: body.byteLength,
                    contentType: 'text/plain',
                },
                fileContent: body,
            } as never);
            const fileEntry = await server.stores.fsEntry.getEntryByPath(
                `/${user.username}/Documents/secret.txt`,
            );
            expect(fileEntry).not.toBeNull();

            const appActor: Actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { id: 0, uid: appUid },
            } as Actor;

            await expect(
                authService.createAccessToken(appActor, [
                    [`fs:${fileEntry!.uuid}:read`],
                ]),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
        });

        // -- Full-API-access tokens --

        it('mints a full-access token for a user actor and stores the label', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(
                actor,
                [[FULL_API_ACCESS]],
                { label: 'My CLI' },
            );
            const decoded = server.services.token.verify('auth', jwt) as {
                type: string;
                token_uid: string;
                session_uid: string;
                full_access?: boolean;
            };
            expect(decoded.type).toBe('access-token');

            // Full access is carried as a signed claim — NOT a stored grant.
            expect(decoded.full_access).toBe(true);
            const permRows = (await server.clients.db.read(
                'SELECT `permission` FROM `access_token_permissions` WHERE `token_uid` = ?',
                [decoded.token_uid],
            )) as Array<{ permission: string }>;
            expect(permRows).toHaveLength(0);

            // The label lands on the access-token session row so it shows
            // (and is revocable) in the manage-sessions UI.
            const sessRows = (await server.clients.db.read(
                'SELECT `label`, `kind` FROM `sessions` WHERE `uuid` = ?',
                [decoded.session_uid],
            )) as Array<{ label: string; kind: string }>;
            expect(sessRows[0]?.kind).toBe('access_token');
            expect(sessRows[0]?.label).toBe('My CLI');
        });

        it('full-access token resolves any permission the issuing user holds, but a scoped token does not', async () => {
            const user = await makeUser();
            await generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                user,
            );
            const body = Buffer.from('secret');
            await server.services.fs.write(user.id, {
                fileMetadata: {
                    path: `/${user.username}/Documents/secret.txt`,
                    size: body.byteLength,
                    contentType: 'text/plain',
                },
                fileContent: body,
            } as never);
            const fileEntry = await server.stores.fsEntry.getEntryByPath(
                `/${user.username}/Documents/secret.txt`,
            );
            expect(fileEntry).not.toBeNull();

            const userActor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;

            // Full-access token: the owner fs:read resolves *through the
            // issuer*, even though the token holds no fs grant of its own.
            const fullJwt = await authService.createAccessToken(userActor, [
                [FULL_API_ACCESS],
            ]);
            const fullActor =
                await authService.authenticateFromToken(fullJwt);
            expect(fullActor).toBeTruthy();
            // The signed claim is surfaced on the actor — this flag is what the
            // resource gate and the permission scan both key off.
            expect(fullActor!.accessToken?.fullAccess).toBe(true);
            expect(
                await server.services.permission.check(
                    fullActor!,
                    `fs:${fileEntry!.uuid}:read`,
                ),
            ).toBe(true);

            // A scoped token (granted an unrelated permission) gets NO owner
            // fs access — access-token actors are excluded from the owner
            // implicator, so this stays the pre-existing behaviour.
            const scopedJwt = await authService.createAccessToken(userActor, [
                [`user:${user.uuid}:email:read`],
            ]);
            const scopedActor =
                await authService.authenticateFromToken(scopedJwt);
            expect(scopedActor).toBeTruthy();
            expect(scopedActor!.accessToken?.fullAccess).toBeFalsy();
            expect(
                await server.services.permission.check(
                    scopedActor!,
                    `fs:${fileEntry!.uuid}:read`,
                ),
            ).toBe(false);
        });
    });

    describe('private-asset / public hosted-actor tokens', () => {
        it('private-asset cookie name and options shape', () => {
            expect(authService.getPrivateAssetCookieName()).toBe(
                'puter.private.asset.token',
            );
            const opts = authService.getPrivateAssetCookieOptions({
                requestHostname: 'example.test',
            });
            expect(opts.httpOnly).toBe(true);
            expect(opts.path).toBe('/');
            expect(typeof opts.maxAge).toBe('number');
            expect(opts.hostname).toBe('example.test');
        });

        it('public hosted-actor cookie name', () => {
            expect(authService.getPublicHostedActorCookieName()).toBe(
                'puter.public.hosted.actor.token',
            );
        });

        it('private-asset token round-trips and validates session binding', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const appUid = `app-${uuidv4()}`;
            const token = await authService.createPrivateAssetToken({
                appUid,
                userUid: user.uuid,
                sessionUuid,
                subdomain: 'priv',
            });
            const decoded = await authService.verifyPrivateAssetToken(token, {
                expectedAppUid: appUid,
                expectedSubdomain: 'priv',
            });
            expect(decoded.userUid).toBe(user.uuid);
            expect(decoded.appUid).toBe(appUid);
            expect(decoded.subdomain).toBe('priv');
            // v2 cookies carry the *asset* session row's uuid, not the
            // web session's. The asset row is parented to the web
            // session so logout cascade still invalidates the cookie.
            expect(typeof decoded.sessionUuid).toBe('string');
            expect(decoded.sessionUuid).not.toBe(sessionUuid);
        });

        it('verifyPrivateAssetToken throws 401 when expected app_uid mismatches', async () => {
            const user = await makeUser();
            const appA = `app-${uuidv4()}`;
            const appB = `app-${uuidv4()}`;
            const token = await authService.createPrivateAssetToken({
                appUid: appA,
                userUid: user.uuid,
            });
            await expect(
                authService.verifyPrivateAssetToken(token, {
                    expectedAppUid: appB,
                }),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('verifyPrivateAssetToken throws 401 when the bound session is gone', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const token = await authService.createPrivateAssetToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
                sessionUuid,
            });
            await authService.revokeSession(sessionUuid);
            await expect(
                authService.verifyPrivateAssetToken(token),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('public hosted-actor token round-trips and enforces expectations', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const token = await authService.createPublicHostedActorToken({
                appUid,
                userUid: user.uuid,
                host: 'host.example',
            });
            const decoded = await authService.verifyPublicHostedActorToken(
                token,
                {
                    expectedAppUid: appUid,
                    expectedHost: 'host.example',
                },
            );
            expect(decoded.userUid).toBe(user.uuid);
            expect(decoded.appUid).toBe(appUid);
            expect(decoded.host).toBe('host.example');
        });

        it('verifyPublicHostedActorToken rejects a private-kind token (kind mismatch)', async () => {
            const user = { uuid: uuidv4() };
            const privateToken = await authService.createPrivateAssetToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
            });
            await expect(
                authService.verifyPublicHostedActorToken(privateToken),
            ).rejects.toThrow();
        });

        // -- v2 hosted-asset migration --

        it('v2 cookie names', () => {
            expect(authService.getPrivateAssetCookieNameV2()).toBe(
                'puter_private_asset_token_v2',
            );
            expect(authService.getPublicHostedActorCookieNameV2()).toBe(
                'puter_public_hosted_actor_token_v2',
            );
        });

        it('private-asset v2 token carries auth_id pulled from the web session', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const token = await authService.createPrivateAssetToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
                sessionUuid,
            });
            const decoded = await authService.verifyPrivateAssetToken(token);
            expect(decoded.authId).toBe(user.uuid);
        });

        it('public hosted-actor v2 token carries auth_id pulled from the web session', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const token = await authService.createPublicHostedActorToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
                sessionUuid,
                host: 'host.example',
            });
            const decoded = await authService.verifyPublicHostedActorToken(token);
            expect(decoded.authId).toBe(user.uuid);
        });

        it('verifyPublicHostedActorToken 401s when the bound session is revoked', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const token = await authService.createPublicHostedActorToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
                sessionUuid,
                host: 'host.example',
            });
            await authService.revokeSession(sessionUuid);
            await expect(
                authService.verifyPublicHostedActorToken(token),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('private-asset cookie revoked when parent web session is revoked (cascade)', async () => {
            const user = await makeUser();
            const { session } = await authService.createSessionToken(user, {});
            const sessionUuid = (session as { uuid: string }).uuid;
            const token = await authService.createPrivateAssetToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
                sessionUuid,
            });
            // verify passes initially
            await authService.verifyPrivateAssetToken(token);
            // revokeCascade on the parent kills the asset row too
            await authService.revokeSession(sessionUuid);
            await expect(
                authService.verifyPrivateAssetToken(token),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('v1 hosted-asset token verifies with legacy:true while allow_v1_tokens is on', async () => {
            // Hand-mint a v1-shape hosted-asset token signed with the
            // legacy secret. v1 compression uses the same short keys but
            // no `kid` header, so TokenService.verify routes it to the
            // legacy secret and tags the result `legacy: true`.
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const v1Token = jwt.sign(
                {
                    k: 'pr', // kind=private
                    uu: Buffer.from(
                        user.uuid.replace(/-/g, ''),
                        'hex',
                    ).toString('base64'),
                    au: Buffer.from(
                        appUid.slice('app-'.length).replace(/-/g, ''),
                        'hex',
                    ).toString('base64'),
                },
                'dev-jwt-secret-change-me',
            );
            const decoded = await authService.verifyPrivateAssetToken(v1Token);
            expect(decoded.legacy).toBe(true);
            expect(decoded.userUid).toBe(user.uuid);
        });
    });

    // ── Revoke coverage ─────────────────────────────────────────────

    describe('revokeAccessToken raw-uuid session-row coverage', () => {
        // The JWT-input branch has always flipped the session row's
        // revoked_at. The raw-uuid gap is closed by the
        // `sessions.access_token_uid` column, which lets revoke find
        // the row for v2-minted tokens even when no JWT was presented.

        it('soft-revokes the v2 session row when revoked by raw token_uid', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(actor, [
                [`user:${user.uuid}:email:read`],
            ]);
            const decoded = server.services.token.verify('auth', jwt) as {
                token_uid: string;
                session_uid: string;
            };

            // Confirm session row is active before revoke.
            const before = await server.stores.session.getByUuid(
                decoded.session_uid,
            );
            expect(before).toBeTruthy();

            await authService.revokeAccessToken(actor, decoded.token_uid);

            // Row is soft-revoked, not just permissions-stripped.
            const after = await server.stores.session.getByUuid(
                decoded.session_uid,
            );
            expect(after).toBeNull();
        });
    });

    describe('revokeAllSessions', () => {
        it('throws 403 when actor has no user', async () => {
            await expect(
                authService.revokeAllSessions({
                    user: undefined,
                } as unknown as Actor),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('revokes every web session except the caller by default', async () => {
            const user = await makeUser();
            const otherDevice = await authService.createSessionToken(user, {});
            const otherUuid = (otherDevice.session as { uuid: string }).uuid;
            const currentDevice = await authService.createSessionToken(user, {});
            const currentUuid = (currentDevice.session as { uuid: string })
                .uuid;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: currentUuid },
            } as unknown as Actor;

            await authService.revokeAllSessions(actor);

            // Caller's session survives.
            expect(
                await server.stores.session.getByUuid(currentUuid),
            ).toBeTruthy();
            // Other device's session is gone.
            expect(
                await server.stores.session.getByUuid(otherUuid),
            ).toBeNull();
        });

        it('with includeCurrent=true also revokes the caller', async () => {
            const user = await makeUser();
            const currentDevice = await authService.createSessionToken(user, {});
            const currentUuid = (currentDevice.session as { uuid: string })
                .uuid;
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: currentUuid },
            } as unknown as Actor;

            await authService.revokeAllSessions(actor, {
                includeCurrent: true,
            });

            expect(
                await server.stores.session.getByUuid(currentUuid),
            ).toBeNull();
        });

        it('leaves app authorizations alone by default', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const appUid = `app-${uuidv4()}`;
            // Mint an app authorization (creates a kind='app' session row).
            await authService.getUserAppToken(actor, appUid);

            // Plus a web session that revoke-all should touch.
            const web = await authService.createSessionToken(user, {});
            const webUuid = (web.session as { uuid: string }).uuid;

            await authService.revokeAllSessions({
                user: actor.user,
                session: { uid: 'unrelated' },
            } as unknown as Actor);

            // Web is gone, app survives.
            expect(
                await server.stores.session.getByUuid(webUuid),
            ).toBeNull();
            const appSession = await server.stores.session.getOrCreateApp(
                user.id,
                appUid,
            );
            expect(appSession?.revoked_at ?? null).toBeNull();
        });

        it('with includeApps=true also revokes app authorizations', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const appUid = `app-${uuidv4()}`;
            const appToken = await authService.getUserAppToken(actor, appUid);
            const appDecoded = server.services.token.verify('auth', appToken) as {
                session_uid: string;
            };

            await authService.revokeAllSessions(
                {
                    user: actor.user,
                    session: { uid: 'unrelated' },
                } as unknown as Actor,
                { includeApps: true },
            );

            expect(
                await server.stores.session.getByUuid(appDecoded.session_uid),
            ).toBeNull();
        });
    });

    // ── migrate-token ───────────────────────────────────────────────

    describe('migrateLegacyToken', () => {
        // Hand-mint v1 tokens using the same compression dict the
        // TokenService's verify path will decompress against.

        const encodeUuid = (u: string): string =>
            Buffer.from(u.replace(/-/g, ''), 'hex').toString('base64');

        const signV1AccessToken = (opts: {
            tokenUid: string;
            userUid: string;
            appUid?: string;
        }): string => {
            const payload: Record<string, unknown> = {
                t: 't',
                token_uid: opts.tokenUid,
                uu: encodeUuid(opts.userUid),
            };
            if (opts.appUid) {
                payload.au = encodeUuid(
                    opts.appUid.startsWith('app-')
                        ? opts.appUid.slice('app-'.length)
                        : opts.appUid,
                );
            }
            return jwt.sign(payload, 'dev-jwt-secret-change-me');
        };

        const signV1AppToken = (opts: {
            userUid: string;
            appUid: string;
        }): string => {
            const stripped = opts.appUid.startsWith('app-')
                ? opts.appUid.slice('app-'.length)
                : opts.appUid;
            return jwt.sign(
                {
                    t: 'au',
                    uu: encodeUuid(opts.userUid),
                    au: encodeUuid(stripped),
                },
                'dev-jwt-secret-change-me',
            );
        };

        const signV1SessionToken = (opts: {
            userUid: string;
            sessionUuid: string;
        }): string =>
            jwt.sign(
                {
                    t: 's',
                    u: encodeUuid(opts.sessionUuid),
                    uu: encodeUuid(opts.userUid),
                },
                'dev-jwt-secret-change-me',
            );

        it('migrates a v1 access-token to a v2 token preserving token_uid', async () => {
            const user = await makeUser();
            const tokenUid = uuidv4();
            const v1 = signV1AccessToken({
                tokenUid,
                userUid: user.uuid,
            });

            const result = await authService.migrateLegacyToken(v1);

            expect(result.kind).toBe('access_token');
            expect(result.auth_id).toBe(user.uuid);
            expect(typeof result.session_uid).toBe('string');

            // v2 token re-verifies and carries the same token_uid +
            // a fresh session_uid.
            const decoded = server.services.token.verify('auth', result.token) as {
                type: string;
                token_uid: string;
                session_uid: string;
                user_uid: string;
            };
            expect(decoded.type).toBe('access-token');
            expect(decoded.token_uid).toBe(tokenUid);
            expect(decoded.user_uid).toBe(user.uuid);
            expect(decoded.session_uid).toBe(result.session_uid);
        });

        it('access-token migration is idempotent (same session_uid on retry)', async () => {
            const user = await makeUser();
            const tokenUid = uuidv4();
            const v1 = signV1AccessToken({ tokenUid, userUid: user.uuid });

            const first = await authService.migrateLegacyToken(v1);
            const second = await authService.migrateLegacyToken(v1);

            expect(first.session_uid).toBe(second.session_uid);
        });

        it('migrates a v1 app-under-user token to a v2 token', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const v1 = signV1AppToken({
                userUid: user.uuid,
                appUid,
            });

            const result = await authService.migrateLegacyToken(v1);

            expect(result.kind).toBe('app');
            expect(result.auth_id).toBe(user.uuid);
            const decoded = server.services.token.verify('auth', result.token) as {
                type: string;
                app_uid: string;
                user_uid: string;
                session_uid: string;
            };
            expect(decoded.type).toBe('app-under-user');
            expect(decoded.app_uid).toBe(appUid);
            expect(decoded.user_uid).toBe(user.uuid);
            expect(decoded.session_uid).toBe(result.session_uid);
        });

        it('app-token migration is idempotent on (user_id, app_uid)', async () => {
            const user = await makeUser();
            const appUid = `app-${uuidv4()}`;
            const v1a = signV1AppToken({ userUid: user.uuid, appUid });
            const v1b = signV1AppToken({ userUid: user.uuid, appUid });

            const first = await authService.migrateLegacyToken(v1a);
            const second = await authService.migrateLegacyToken(v1b);

            expect(first.session_uid).toBe(second.session_uid);
        });

        it('returns 409 reauth_required for v1 session tokens', async () => {
            const user = await makeUser();
            const v1 = signV1SessionToken({
                userUid: user.uuid,
                sessionUuid: uuidv4(),
            });

            await expect(
                authService.migrateLegacyToken(v1),
            ).rejects.toMatchObject({
                statusCode: 409,
                code: 'reauth_required',
            });
        });

        it('rejects v2 tokens with 401 (nothing to migrate)', async () => {
            const user = await makeUser();
            const v2 = await authService.createAccessToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                [[`user:${user.uuid}:email:read`]],
            );
            await expect(
                authService.migrateLegacyToken(v2),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('rejects garbage tokens with 401', async () => {
            await expect(
                authService.migrateLegacyToken('not-a-jwt'),
            ).rejects.toMatchObject({ statusCode: 401 });
        });

        it('returns 410 for app tokens when allow_v1_app_migration=false', async () => {
            // Use a scoped server with the flag flipped — toggling
            // `this.config` on the shared server would race with other
            // tests.
            const scopedServer = await setupTestServer({
                allow_v1_app_migration: false,
            } as never);
            try {
                const scopedAuth = scopedServer.services.auth as unknown as
                    AuthService;
                const user = await scopedServer.stores.user.create({
                    username: `mt-${uuidv4().slice(0, 8)}`,
                    uuid: uuidv4(),
                    password: null,
                    email: `mt-${uuidv4().slice(0, 8)}@test.local`,
                    free_storage: 100 * 1024 * 1024,
                    requires_email_confirmation: false,
                });
                const appUid = `app-${uuidv4()}`;
                const v1App = signV1AppToken({
                    userUid: user.uuid,
                    appUid,
                });
                await expect(
                    scopedAuth.migrateLegacyToken(v1App),
                ).rejects.toMatchObject({
                    statusCode: 410,
                    code: 'app_migration_disabled',
                });
                // Access-token migration stays on regardless.
                const v1AccessToken = signV1AccessToken({
                    tokenUid: uuidv4(),
                    userUid: user.uuid,
                });
                const ok = await scopedAuth.migrateLegacyToken(v1AccessToken);
                expect(ok.kind).toBe('access_token');
            } finally {
                await scopedServer.shutdown();
            }
        });
    });
});
