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
            expect(() =>
                authService.getUserAppToken(
                    { user: undefined } as unknown as Actor,
                    'app-foo',
                ),
            ).toThrow(/Actor must be a user/);
        });

        it('signs an app-under-user JWT carrying user_uid + app_uid', async () => {
            const user = await makeUser();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
            } as Actor;
            const appUid = `app-${uuidv4()}`;
            const token = authService.getUserAppToken(actor, appUid);
            const decoded = server.services.token.verify('auth', token) as {
                type: string;
                user_uid: string;
                app_uid: string;
            };
            expect(decoded.type).toBe('app-under-user');
            expect(decoded.user_uid).toBe(user.uuid);
            expect(decoded.app_uid).toBe(appUid);
        });

        it('includes the session claim when actor.session.uid is set', async () => {
            const user = await makeUser();
            const sessionUuid = uuidv4();
            const actor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                session: { uid: sessionUuid },
            } as Actor;
            const appUid = `app-${uuidv4()}`;
            const token = authService.getUserAppToken(actor, appUid);
            const decoded = server.services.token.verify('auth', token) as {
                session: string;
            };
            expect(decoded.session).toBe(sessionUuid);
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
            const token = authService.createPrivateAssetToken({
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
            expect(decoded.sessionUuid).toBe(sessionUuid);
        });

        it('verifyPrivateAssetToken throws 401 when expected app_uid mismatches', async () => {
            const user = await makeUser();
            const appA = `app-${uuidv4()}`;
            const appB = `app-${uuidv4()}`;
            const token = authService.createPrivateAssetToken({
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
            const token = authService.createPrivateAssetToken({
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
            const token = authService.createPublicHostedActorToken({
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

        it('verifyPublicHostedActorToken rejects a private-kind token (kind mismatch)', () => {
            const user = { uuid: uuidv4() };
            const privateToken = authService.createPrivateAssetToken({
                appUid: `app-${uuidv4()}`,
                userUid: user.uuid,
            });
            expect(() =>
                authService.verifyPublicHostedActorToken(privateToken),
            ).toThrow();
        });
    });
});
