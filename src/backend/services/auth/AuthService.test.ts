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

    // ── AUTH-4: rich `authenticate()` result shape ───────────────────

    describe('authenticate (AUTH-4 reauth signal)', () => {
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
            const accessToken = await authService.createAccessToken(
                {
                    user: { id: user.id, uuid: user.uuid, username: user.username },
                } as Actor,
                [['fs:abc:read']],
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
                [['fs:abc:read']],
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
    });

    describe('createAccessToken / revokeAccessToken', () => {
        it('creates a verifiable access-token JWT for a user actor', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(actor, [
                ['service:foo:ii:read'],
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
                ['service:foo:ii:read'],
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
                ['service:foo:ii:read'],
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
                ['service:foo:ii:read'],
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
            const decoded = authService.verifyPublicHostedActorToken(token, {
                expectedAppUid: appUid,
                expectedHost: 'host.example',
            });
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
            expect(() =>
                authService.verifyPublicHostedActorToken(privateToken),
            ).toThrow();
        });
    });

    // ── AUTH-5 (PUT-1019) revoke coverage ────────────────────────────

    describe('revokeAccessToken raw-uuid session-row coverage', () => {
        // The JWT-input branch has always flipped the session row's
        // revoked_at. AUTH-5 closes the raw-uuid gap: the new
        // `sessions.access_token_uid` column lets revoke find the row
        // for v2-minted tokens even when no JWT was presented.

        it('soft-revokes the v2 session row when revoked by raw token_uid', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const jwt = await authService.createAccessToken(actor, [
                ['service:foo:ii:read'],
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

    // ── SDK-1 (PUT-1021) migrate-token ────────────────────────────────

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
                [['service:foo:ii:read']],
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
