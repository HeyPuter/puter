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

import bcrypt from 'bcrypt';
import type { Request, RequestHandler, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { HttpError, isHttpError } from '../HttpError';
import type { OIDCService } from '../../../services/auth/OIDCService';
import type { TokenService } from '../../../services/auth/TokenService';
import { PuterServer } from '../../../server';
import type { UserStore } from '../../../stores/user/UserStore';
import { setupTestServer } from '../../../testUtil';
import type { IConfig } from '../../../types';
import { createUserProtectedGate } from './userProtected';

// ── Server-backed harness ───────────────────────────────────────────
//
// userProtected pulls user rows out of the real UserStore (and bypasses
// the cache via getByProperty {force:true}), so the cleanest way to
// exercise it is against a real test server. We then drive each of the
// three returned middlewares directly so we can assert their contracts
// without standing up routes.

let server: PuterServer;
let userStore: UserStore;
let oidcService: OIDCService;
let tokenService: TokenService;

beforeAll(async () => {
    server = await setupTestServer();
    userStore = server.stores.user as unknown as UserStore;
    oidcService = server.services.oidc as unknown as OIDCService;
    tokenService = server.services.token as unknown as TokenService;
});

afterAll(async () => {
    await server?.shutdown();
});

const baseConfig: IConfig = {
    cookie_name: 'puter_token',
    origin: 'https://test.local',
} as unknown as IConfig;

// `buildGate(...)[0]` = requireSessionCookie
// `buildGate(...)[1]` = refreshUser
// `buildGate(...)[2]` = verifyIdentity
const buildGate = (opts: { allowTempUsers?: boolean } = {}) =>
    createUserProtectedGate(
        {
            config: baseConfig,
            userStore,
            oidcService,
            tokenService,
        },
        opts,
    );

// Run one of the three middlewares and capture what it next-ed.
const run = async (
    mw: RequestHandler,
    req: Partial<Request>,
): Promise<unknown> => {
    const next = vi.fn();
    try {
        await mw(req as Request, {} as Response, next);
    } catch (err) {
        // The middleware throws HttpErrors instead of next(err) for some
        // synchronous branches; treat both shapes the same.
        return err;
    }
    return next.mock.calls[0]?.[0];
};

// ── User fixtures ───────────────────────────────────────────────────

const makeUserWithPassword = async (
    plainPassword: string,
    extra: Partial<{
        suspended: number;
        email: string | null;
        username: string;
    }> = {},
) => {
    const hash = await bcrypt.hash(plainPassword, 4);
    const username = extra.username ?? `up-${Math.random().toString(36).slice(2, 10)}`;
    const created = await userStore.create({
        username,
        uuid: uuidv4(),
        password: hash,
        email: extra.email !== undefined ? extra.email : `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    } as Parameters<UserStore['create']>[0]);
    if (extra.suspended) {
        await server.clients.db.write(
            'UPDATE user SET suspended = 1 WHERE id = ?',
            [created.id],
        );
    }
    // Force a fresh read so we don't fight the cache.
    return (await userStore.getByProperty('id', created.id, { force: true }))!;
};

const makeTempUser = async () => {
    const username = `tmp-${Math.random().toString(36).slice(2, 10)}`;
    const created = await userStore.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: null,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    } as Parameters<UserStore['create']>[0]);
    return (await userStore.getByProperty('id', created.id, { force: true }))!;
};

// ── 1. requireSessionCookie ─────────────────────────────────────────

describe('userProtected — requireSessionCookie (step 1)', () => {
    it('passes through when the session cookie is present and matches req.token', async () => {
        const [requireSessionCookie] = buildGate();
        const arg = await run(requireSessionCookie, {
            cookies: { puter_token: 'session-tok' },
            token: 'session-tok',
        });
        expect(arg).toBeUndefined();
    });

    it("passes through when the cookie is present and req.token is undefined (no probe-attached token)", async () => {
        // This covers test-only / bypass paths where the cookie is the
        // only credential. The guard only fires when `req.token` is set
        // AND differs from the cookie.
        const [requireSessionCookie] = buildGate();
        const arg = await run(requireSessionCookie, {
            cookies: { puter_token: 'session-tok' },
            // no req.token
        });
        expect(arg).toBeUndefined();
    });

    it('throws 401 session_required when the cookie is absent', async () => {
        const [requireSessionCookie] = buildGate();
        const arg = await run(requireSessionCookie, { cookies: {} });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(401);
        expect((arg as HttpError).legacyCode).toBe('session_required');
    });

    it('throws 401 when req.token came from a non-cookie source (Authorization, x-api-key, query)', async () => {
        // The whole point of this gate: confirm the request actually
        // carried the cookie (CSRF protection) rather than a header/query
        // token which an attacker could plant on a victim's browser.
        const [requireSessionCookie] = buildGate();
        const arg = await run(requireSessionCookie, {
            cookies: { puter_token: 'real-session' },
            token: 'some-other-token-from-header',
        });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(401);
    });

    it("honors a custom config.cookie_name", async () => {
        const gates = createUserProtectedGate({
            config: {
                cookie_name: 'custom_session',
                origin: 'https://test.local',
            } as unknown as IConfig,
            userStore,
            oidcService,
            tokenService,
        });
        const arg = await run(gates[0], {
            cookies: { custom_session: 'tok' },
            token: 'tok',
        });
        expect(arg).toBeUndefined();
    });
});

// ── 2. refreshUser ──────────────────────────────────────────────────

describe('userProtected — refreshUser (step 2)', () => {
    it("re-fetches the user row with force:true so a just-suspended account can't slip through cached actor data", async () => {
        // Cache the (unsuspended) row, then suspend at the DB, then run
        // the middleware — it must catch the suspension despite stale cache.
        const user = await makeUserWithPassword('hunter2');
        // Warm the cache with a cached read.
        await userStore.getByProperty('id', user.id);
        await server.clients.db.write(
            'UPDATE user SET suspended = 1 WHERE id = ?',
            [user.id],
        );

        const [, refreshUser] = buildGate();
        const req: Partial<Request> = { actor: { user: { id: user.id, uuid: user.uuid } } };
        const arg = await run(refreshUser, req);
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(403);
        expect((arg as HttpError).legacyCode).toBe('account_suspended');
    });

    it('passes through and stashes the fresh row on req.userProtected', async () => {
        const user = await makeUserWithPassword('hunter2');
        const [, refreshUser] = buildGate();
        const req: Partial<Request> = { actor: { user: { id: user.id, uuid: user.uuid } } };
        const arg = await run(refreshUser, req);
        expect(arg).toBeUndefined();
        expect((req as Request).userProtected?.user.uuid).toBe(user.uuid);
    });

    it("throws 401 when the actor lacks a user id (defensive — earlier gates should catch this)", async () => {
        const [, refreshUser] = buildGate();
        const arg = await run(refreshUser, { actor: undefined });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(401);
    });

    it("throws 404 when the actor's user row no longer exists", async () => {
        const [, refreshUser] = buildGate();
        const arg = await run(refreshUser, {
            actor: { user: { id: 99_999_999, uuid: 'ghost' } },
        });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(404);
    });
});

// ── 3. verifyIdentity ───────────────────────────────────────────────

describe('userProtected — verifyIdentity (step 3)', () => {
    const withUser = (
        user: Awaited<ReturnType<typeof makeUserWithPassword>>,
        rest: Partial<Request> = {},
    ): Partial<Request> => ({
        userProtected: { user },
        body: {},
        cookies: {},
        ...rest,
    });

    it('passes when req.body.password matches the bcrypt hash on the row', async () => {
        const user = await makeUserWithPassword('correct-horse-battery');
        const [, , verifyIdentity] = buildGate();
        const arg = await run(
            verifyIdentity,
            withUser(user, { body: { password: 'correct-horse-battery' } }),
        );
        expect(arg).toBeUndefined();
    });

    it("returns 400 password_mismatch when bcrypt says no", async () => {
        const user = await makeUserWithPassword('correct-horse');
        const [, , verifyIdentity] = buildGate();
        const arg = await run(
            verifyIdentity,
            withUser(user, { body: { password: 'wrong-guess' } }),
        );
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(400);
        expect((arg as HttpError).legacyCode).toBe('password_mismatch');
    });

    it("returns 403 password_required when password account submits no credentials", async () => {
        // No password in body, no revalidation cookie → reject.
        const user = await makeUserWithPassword('hunter2');
        const [, , verifyIdentity] = buildGate();
        const arg = await run(verifyIdentity, withUser(user));
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(403);
        expect((arg as HttpError).legacyCode).toBe('password_required');
    });

    it("accepts a valid puter_revalidation cookie in lieu of a password", async () => {
        const user = await makeUserWithPassword('hunter2');
        // Sign a real revalidation token via the real TokenService.
        const cookieValue = tokenService.sign('oidc-state', {
            purpose: 'revalidate',
            user_uuid: user.uuid,
        });
        const [, , verifyIdentity] = buildGate();
        const arg = await run(
            verifyIdentity,
            withUser(user, {
                cookies: { puter_revalidation: cookieValue },
            }),
        );
        expect(arg).toBeUndefined();
    });

    it("rejects a revalidation cookie whose user_uuid doesn't match the actor", async () => {
        // Critical: a leaked / replayed revalidation cookie from user A
        // must NOT let an attacker bypass identity check on user B's
        // session. Mismatched user_uuid → fall through to password_required.
        const userA = await makeUserWithPassword('a-pwd');
        const userB = await makeUserWithPassword('b-pwd');
        const cookieForA = tokenService.sign('oidc-state', {
            purpose: 'revalidate',
            user_uuid: userA.uuid,
        });
        const [, , verifyIdentity] = buildGate();
        const arg = await run(
            verifyIdentity,
            withUser(userB, {
                cookies: { puter_revalidation: cookieForA },
            }),
        );
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(403);
        expect((arg as HttpError).legacyCode).toBe('password_required');
    });

    it("rejects a cookie whose `purpose` is anything but 'revalidate'", async () => {
        // The `oidc-state` scope is shared with the OIDC login flow,
        // which uses different purposes. The cookie value must be
        // explicitly minted as a revalidation token to count.
        const user = await makeUserWithPassword('pwd');
        const wrongPurpose = tokenService.sign('oidc-state', {
            purpose: 'login',
            user_uuid: user.uuid,
        });
        const [, , verifyIdentity] = buildGate();
        const arg = await run(
            verifyIdentity,
            withUser(user, {
                cookies: { puter_revalidation: wrongPurpose },
            }),
        );
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).legacyCode).toBe('password_required');
    });

    it("falls through silently when the revalidation cookie is unparseable (bad signature)", async () => {
        const user = await makeUserWithPassword('pwd');
        const [, , verifyIdentity] = buildGate();
        const arg = await run(
            verifyIdentity,
            withUser(user, {
                cookies: { puter_revalidation: 'not.a.valid.jwt' },
            }),
        );
        expect(isHttpError(arg)).toBe(true);
        // Verify threw — we fell through to the no-credentials branch.
        expect((arg as HttpError).legacyCode).toBe('password_required');
    });
});

// ── Temp accounts (no password + no email) ──────────────────────────

describe('userProtected — temp user handling', () => {
    it('blocks temp users by default with 403 temporary_account', async () => {
        const tempUser = await makeTempUser();
        const [, , verifyIdentity] = buildGate();
        const arg = await run(verifyIdentity, {
            userProtected: { user: tempUser },
            body: {},
            cookies: {},
        });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(403);
        expect((arg as HttpError).legacyCode).toBe('temporary_account');
    });

    it('admits temp users only when allowTempUsers:true is configured', async () => {
        // This is the explicit opt-in for /delete-own-user, the one route
        // a temp account legitimately needs to reach.
        const tempUser = await makeTempUser();
        const [, , verifyIdentity] = buildGate({ allowTempUsers: true });
        const arg = await run(verifyIdentity, {
            userProtected: { user: tempUser },
            body: {},
            cookies: {},
        });
        expect(arg).toBeUndefined();
    });
});

// ── OIDC-only accounts (password === null but email is set) ─────────

describe('userProtected — OIDC-only accounts', () => {
    it('returns oidc_revalidation_required when a password-less user POSTs a password', async () => {
        // The user signed up with OIDC, so there's no password to compare.
        // The GUI should bounce them into the OIDC popup, not just say
        // "wrong password". The error carries the revalidation URL.
        const user = await makeUserWithPassword('seed-then-null');
        await server.clients.db.write(
            'UPDATE user SET password = NULL WHERE id = ?',
            [user.id],
        );
        const refreshed = (await userStore.getByProperty('id', user.id, {
            force: true,
        }))!;
        const [, , verifyIdentity] = buildGate();
        const arg = await run(verifyIdentity, {
            userProtected: { user: refreshed },
            body: { password: 'anything' },
            cookies: {},
        });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).statusCode).toBe(403);
        expect((arg as HttpError).legacyCode).toBe('oidc_revalidation_required');
    });

    it("returns oidc_revalidation_required when a password-less user submits no credentials", async () => {
        const user = await makeUserWithPassword('seed-then-null');
        await server.clients.db.write(
            'UPDATE user SET password = NULL WHERE id = ?',
            [user.id],
        );
        const refreshed = (await userStore.getByProperty('id', user.id, {
            force: true,
        }))!;
        const [, , verifyIdentity] = buildGate();
        const arg = await run(verifyIdentity, {
            userProtected: { user: refreshed },
            body: {},
            cookies: {},
        });
        expect(isHttpError(arg)).toBe(true);
        expect((arg as HttpError).legacyCode).toBe('oidc_revalidation_required');
    });
});
