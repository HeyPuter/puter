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

import type { Request, RequestHandler, Response } from 'express';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { runWithContext } from '../../core/context.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import type { OIDCService } from '../../services/auth/OIDCService.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

const TEST_ORIGIN = 'http://test.local';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer with a custom OIDC provider configured,
// then re-registers OIDCController's inline lambda routes onto a
// fresh PuterRouter so each handler is reachable. Tests run against
// the live wired OIDCService (real signState / verifyState, real
// findUserByProviderSub / linkProviderToUser, real createUserFromOIDC)
// and AuthService (real session token).
//
// The two methods that hit external HTTP — `exchangeCodeForTokens`
// and `getUserInfo` — are stubbed per-test with `vi.spyOn` so the
// callback flow can be exercised without standing up a fake IdP.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer({
        origin: TEST_ORIGIN,
        // A "custom" OIDC provider just needs static endpoints — no
        // discovery fetch happens. The endpoint URLs aren't actually
        // hit during the tests we keep here (we spy past them when
        // necessary), but they must be set so `getProviderConfig`
        // accepts the entry.
        oidc: {
            providers: {
                custom: {
                    client_id: 'test-client',
                    client_secret: 'test-secret',
                    authorization_endpoint:
                        'https://idp.test.invalid/authorize',
                    token_endpoint: 'https://idp.test.invalid/token',
                    userinfo_endpoint: 'https://idp.test.invalid/userinfo',
                },
            },
        },
    } as never);
    router = new PuterRouter();
    server.controllers.oidc.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    redirectStatus?: number;
    redirectUrl?: string;
    headers: Record<string, string>;
    cookies: Array<{ name: string; value: string; opts?: unknown }>;
    contentType?: string;
}

const makeReq = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
    method?: string;
}): Request => {
    return {
        body: init.body ?? {},
        query: init.query ?? {},
        params: init.params ?? {},
        headers: init.headers ?? {},
        method: init.method ?? 'GET',
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = {
        statusCode: 200,
        body: undefined,
        headers: {},
        cookies: [],
    };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        set: vi.fn((key: string, value: string) => {
            if (typeof key === 'string') {
                captured.headers[key.toLowerCase()] = value;
                if (key.toLowerCase() === 'content-type') {
                    captured.contentType = value;
                }
            }
            return res;
        }),
        setHeader: vi.fn(() => res),
        redirect: vi.fn((status: number | string, url?: string) => {
            if (typeof status === 'number' && typeof url === 'string') {
                captured.redirectStatus = status;
                captured.redirectUrl = url;
            } else if (typeof status === 'string') {
                captured.redirectStatus = 302;
                captured.redirectUrl = status;
            }
            return res;
        }),
        cookie: vi.fn((name: string, value: string, opts?: unknown) => {
            captured.cookies.push({ name, value, opts });
            return res;
        }),
        type: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

const findHandler = (method: string, path: string): RequestHandler => {
    const route = router.routes.find(
        (r) => r.method === method && r.path === path,
    );
    if (!route) throw new Error(`No ${method.toUpperCase()} ${path} route`);
    return route.handler;
};

const callRoute = async (
    method: string,
    path: string,
    req: Request,
    res: Response,
) => {
    const handler = findHandler(method, path);
    // OIDCService.createUserFromOIDC pulls `req` off the request
    // context (for IP / signup-validate hooks). Express middleware
    // sets it in production; the test driver mirrors that here.
    await runWithContext({ req }, () =>
        handler(req, res, () => {
            throw new Error('handler called next() unexpectedly');
        }),
    );
};

const oidc = (): OIDCService =>
    server.services.oidc as unknown as OIDCService;

// ── GET /auth/oidc/providers ────────────────────────────────────────

describe('OIDCController GET /auth/oidc/providers', () => {
    it('lists every provider whose config validates', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/providers',
            makeReq({}),
            res,
        );
        // We configured a single `custom` provider; the live service
        // walks the config and returns its id.
        expect(captured.body).toEqual({ providers: ['custom'] });
    });
});

// ── GET /auth/oidc/:provider/start ──────────────────────────────────

describe('OIDCController GET /auth/oidc/:provider/start', () => {
    it('throws 404 for an unconfigured provider', async () => {
        const { res } = makeRes();
        await expect(
            callRoute(
                'get',
                '/auth/oidc/:provider/start',
                makeReq({ params: { provider: 'no-such-idp' } }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('redirects to the IdP authorization URL with a signed state', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/:provider/start',
            makeReq({ params: { provider: 'custom' } }),
            res,
        );

        expect(captured.redirectStatus).toBe(302);
        const url = new URL(captured.redirectUrl ?? '');
        expect(url.origin).toBe('https://idp.test.invalid');
        expect(url.pathname).toBe('/authorize');
        // Authorization URL carries the live-signed state token;
        // pull it back out and confirm the OIDC service can verify it.
        const state = url.searchParams.get('state');
        expect(state).toBeTruthy();
        const decoded = oidc().verifyState(state!);
        expect(decoded).toMatchObject({ provider: 'custom' });
    });

    it('returns 400 for the revalidate flow without user_uuid', async () => {
        const { res } = makeRes();
        await expect(
            callRoute(
                'get',
                '/auth/oidc/:provider/start',
                makeReq({
                    params: { provider: 'custom' },
                    query: { flow: 'revalidate' },
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('propagates popup query params (embedded_in_popup/msg_id/opener_origin) into state', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/:provider/start',
            makeReq({
                params: { provider: 'custom' },
                query: {
                    embedded_in_popup: 'true',
                    msg_id: 'msg-42',
                    opener_origin: 'http://opener.test',
                },
            }),
            res,
        );
        const state = new URL(captured.redirectUrl ?? '').searchParams.get(
            'state',
        );
        const decoded = oidc().verifyState(state!);
        expect(decoded).toMatchObject({
            provider: 'custom',
            embedded_in_popup: true,
            msg_id: 'msg-42',
            opener_origin: 'http://opener.test',
        });
        // The app redirect baked into state should be the popup landing page.
        expect(String(decoded?.redirect_uri)).toContain(
            '/action/sign-in?embedded_in_popup=true',
        );
        expect(String(decoded?.redirect_uri)).toContain('msg_id=msg-42');
    });

    it('propagates referrer into state when supplied', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/:provider/start',
            makeReq({
                params: { provider: 'custom' },
                query: { referrer: 'http://ref.test' },
            }),
            res,
        );
        const state = new URL(captured.redirectUrl ?? '').searchParams.get(
            'state',
        );
        const decoded = oidc().verifyState(state!);
        expect(decoded).toMatchObject({ referrer: 'http://ref.test' });
    });

    it('signs revalidate-flow state with user_uuid + flow=revalidate', async () => {
        const userUuid = uuidv4();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/:provider/start',
            makeReq({
                params: { provider: 'custom' },
                query: { flow: 'revalidate', user_uuid: userUuid },
            }),
            res,
        );
        const state = new URL(captured.redirectUrl ?? '').searchParams.get(
            'state',
        );
        const decoded = oidc().verifyState(state!);
        expect(decoded).toMatchObject({
            flow: 'revalidate',
            user_uuid: userUuid,
            provider: 'custom',
        });
        expect(String(decoded?.redirect_uri)).toContain(
            '/auth/revalidate-done',
        );
    });
});

// ── /auth/oidc/callback/login ───────────────────────────────────────

describe('OIDCController login callback', () => {
    it('redirects with auth_error=1 when the state is invalid', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state: 'not-a-real-token' } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
        expect(captured.redirectUrl).toContain('action=login');
    });

    it('redirects with auth_error=1 when code or state is missing', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: {} }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
    });

    it('creates a fresh user and sets the session cookie on first sign-in', async () => {
        // Sign a real state token so verifyState succeeds; spy past the
        // two methods that hit external HTTP.
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: 'http://test.local/',
        });
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `oidc-${Math.random().toString(36).slice(2, 8)}@test.local`;

        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'authcode', state } }),
            res,
        );

        // Session cookie was set with the configured cookie name.
        expect(captured.cookies).toHaveLength(1);
        expect(captured.cookies[0]?.value).toBeTruthy();
        // Same-origin redirect target is preserved.
        expect(captured.redirectUrl).toBe('http://test.local/');

        // The real OIDCService linked the new user — verify via the
        // live store.
        const linkedUser = await oidc().findUserByProviderSub(
            'custom',
            sub,
        );
        expect(linkedUser).not.toBeNull();
        expect(linkedUser?.email).toBe(email);
    });

    it('clamps redirect_uri to the configured origin (rejects external)', async () => {
        const state = oidc().signState({
            provider: 'custom',
            // External attacker-supplied target.
            redirect_uri: 'https://evil.test/steal',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub: `sub-${Math.random().toString(36).slice(2, 8)}`,
            email: `oidc-${Math.random().toString(36).slice(2, 8)}@test.local`,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );

        // Falls back to the configured origin since the requested URL
        // is on a different host.
        expect(captured.redirectUrl).toBe(TEST_ORIGIN);
    });

    it('redirects with auth_error when the token exchange fails', async () => {
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue(null);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
        expect(captured.redirectUrl).toContain('action=login');
    });

    it('redirects with auth_error when userinfo fetch fails', async () => {
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue(null as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
    });

    it('parses code/state from the POST body (Apple form_post)', async () => {
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `oidc-${Math.random().toString(36).slice(2, 8)}@test.local`;
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'post',
            '/auth/oidc/callback/login',
            makeReq({
                method: 'POST',
                body: { code: 'apple-code', state },
                query: {},
            }),
            res,
        );
        expect(captured.cookies).toHaveLength(1);
        expect(captured.redirectUrl).toBe(TEST_ORIGIN + '/');
    });

    it('signs in an existing account via provider/sub link (skips creation)', async () => {
        // Seed by running the linked-sub path first via createUserFromOIDC.
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `oidc-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);
        const firstUserId = created.user!.id;

        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);
        // If the controller hits the creation path, this is a bug — assert
        // we do NOT call createUserFromOIDC again for an already-linked sub.
        const createSpy = vi.spyOn(oidc(), 'createUserFromOIDC');

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.cookies).toHaveLength(1);
        expect(captured.redirectUrl).toBe(TEST_ORIGIN + '/');
        expect(createSpy).not.toHaveBeenCalled();
        // The same user row is reused.
        const reloaded = await oidc().findUserByProviderSub('custom', sub);
        expect(reloaded?.id).toBe(firstUserId);
    });

    it('redirects with auth_error when the user is suspended', async () => {
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `sus-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);
        // Flip the suspended bit on the existing row.
        await server.stores.user.update(created.user!.id, { suspended: 1 });

        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
        // No session cookie issued for suspended accounts.
        expect(captured.cookies).toHaveLength(0);
    });

    it('appends oidc_login=true and uses popup-style URL when state is from a popup flow', async () => {
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `oidc-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const popupRedirect = `${TEST_ORIGIN}/action/sign-in?embedded_in_popup=true&msg_id=msg-1`;
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: popupRedirect,
            embedded_in_popup: true,
            msg_id: 'msg-1',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.cookies).toHaveLength(1);
        expect(captured.redirectUrl).toContain('embedded_in_popup=true');
        expect(captured.redirectUrl).toContain('oidc_login=true');
    });

    it('uses popup-style error URL (msg_id + opener_origin) when the popup-state user is suspended', async () => {
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `pop-sus-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);
        await server.stores.user.update(created.user!.id, { suspended: 1 });

        // State carrying popup metadata so the error-redirect builder
        // takes the popup branch with opener_origin appended.
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: `${TEST_ORIGIN}/action/sign-in?embedded_in_popup=true&msg_id=msg-99`,
            embedded_in_popup: true,
            msg_id: 'msg-99',
            opener_origin: 'http://opener.test',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('embedded_in_popup=true');
        expect(captured.redirectUrl).toContain('msg_id=msg-99');
        expect(captured.redirectUrl).toContain('auth_error=1');
        // 'This account is suspended.' is not in ALLOWED_ERRORS, so the
        // builder falls back to 'unauthorized'.
        expect(captured.redirectUrl).toContain('message=unauthorized');
        expect(captured.redirectUrl).toContain(
            `opener_origin=${encodeURIComponent('http://opener.test')}`,
        );
    });

    it('links an OIDC identity to an existing CONFIRMED password account via email match', async () => {
        // Seed a password account whose email is already confirmed —
        // this is the only branch where the controller links an OIDC
        // identity to a pre-existing user it didn't create itself.
        const email = `confirmed-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const existing = await server.stores.user.create({
            username: `confirmed-${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'hashed',
            email,
            free_storage: 100 * 1024 * 1024,
        });
        await server.stores.user.update(existing.id, {
            email_confirmed: 1,
            requires_email_confirmation: 0,
        });

        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        // Session cookie issued and the OIDC identity now points at the
        // pre-existing password account (same id).
        expect(captured.cookies).toHaveLength(1);
        const linked = await oidc().findUserByProviderSub('custom', sub);
        expect(linked?.id).toBe(existing.id);
    });

    it('refuses to link to an existing account with an unconfirmed email', async () => {
        // Seed an existing UNCONFIRMED user with the OIDC-claimed email.
        const email = `pending-${Math.random().toString(36).slice(2, 8)}@test.local`;
        await server.stores.user.create({
            username: `pending-${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'hashed',
            email,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: true,
        });

        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: 'http://test.local/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub: `sub-${Math.random().toString(36).slice(2, 8)}`,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/login',
            makeReq({ query: { code: 'c', state } }),
            res,
        );

        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
    });
});

// ── /auth/oidc/callback/signup ──────────────────────────────────────

describe('OIDCController signup callback', () => {
    it('redirects to action=signup with auth_error on invalid state', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/signup',
            makeReq({ query: { code: 'c', state: 'not-a-token' } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('auth_error=1');
        expect(captured.redirectUrl).toContain('action=signup');
    });

    it('creates a fresh user without oidc_switched on first signup', async () => {
        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `signup-${Math.random().toString(36).slice(2, 8)}@test.local`;
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/signup',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.cookies).toHaveLength(1);
        expect(captured.redirectUrl).toBe(TEST_ORIGIN + '/');
        // Fresh creation — must NOT advertise "you've actually been signed in".
        expect(captured.redirectUrl).not.toContain('oidc_switched=login');
    });

    it('adds oidc_switched=login when signup hits an already-linked account', async () => {
        // Seed an account linked on (provider, sub) so the signup callback
        // resolves to `linked-sub` rather than creating a new user.
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `existing-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);

        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/signup',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.cookies).toHaveLength(1);
        expect(captured.redirectUrl).toContain('oidc_switched=login');
    });

    it('redirects to action=signup with auth_error when user resolution fails (unconfirmed email)', async () => {
        // Seed an UNCONFIRMED password account so the email-match path
        // in #resolveOrCreateOIDCUser refuses to link.
        const email = `pending-${Math.random().toString(36).slice(2, 8)}@test.local`;
        await server.stores.user.create({
            username: `pending-${Math.random().toString(36).slice(2, 8)}`,
            uuid: uuidv4(),
            password: 'hashed',
            email,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: true,
        });

        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub: `sub-${Math.random().toString(36).slice(2, 8)}`,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/signup',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('action=signup');
        expect(captured.redirectUrl).toContain('auth_error=1');
        expect(captured.cookies).toHaveLength(0);
    });

    it('redirects suspended users to action=signup with message=account_suspended', async () => {
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `sus-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);
        await server.stores.user.update(created.user!.id, { suspended: 1 });

        const state = oidc().signState({
            provider: 'custom',
            redirect_uri: TEST_ORIGIN + '/',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
            email,
            email_verified: true,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/signup',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toContain('action=signup');
        expect(captured.redirectUrl).toContain('message=account_suspended');
        expect(captured.cookies).toHaveLength(0);
    });
});

// ── /auth/oidc/callback/revalidate ──────────────────────────────────

describe('OIDCController revalidate callback', () => {
    it('returns 400 on invalid state', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: { code: 'c', state: 'not-a-token' } }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('returns 400 when the state has the wrong flow', async () => {
        // verifyState succeeds, but state.flow !== 'revalidate'.
        const state = oidc().signState({
            provider: 'custom',
            flow: 'login',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub: 'whatever',
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('returns 400 when no account exists for the OIDC sub', async () => {
        const state = oidc().signState({
            provider: 'custom',
            flow: 'revalidate',
            user_uuid: uuidv4(),
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub: `unlinked-${Math.random().toString(36).slice(2, 8)}`,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('returns 400 when code or state is missing on the revalidate callback', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: {} }),
            res,
        );
        // processCallback returns `error: 'Missing code or state.'`,
        // which the revalidate handler renders as a 400 text response.
        expect(captured.statusCode).toBe(400);
        expect(String(captured.body)).toContain('Missing');
    });

    it('returns 403 when the OIDC sub resolves to a different account than the session', async () => {
        // The linked account exists, but state.user_uuid points at someone else.
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `reval-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);

        const state = oidc().signState({
            provider: 'custom',
            flow: 'revalidate',
            // Mismatched uuid — caller is trying to revalidate someone
            // else's session with this OIDC identity.
            user_uuid: uuidv4(),
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.statusCode).toBe(403);
    });

    it('happy path: sets the revalidation cookie and redirects to redirect-done', async () => {
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `reval-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);
        const userUuid = created.user!.uuid;

        const state = oidc().signState({
            provider: 'custom',
            flow: 'revalidate',
            user_uuid: userUuid,
            redirect_uri: `${TEST_ORIGIN}/auth/revalidate-done`,
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        expect(captured.redirectStatus).toBe(302);
        expect(captured.redirectUrl).toBe(
            `${TEST_ORIGIN}/auth/revalidate-done`,
        );
        // puter_revalidation cookie is set with httpOnly + 5 min max age.
        expect(captured.cookies).toHaveLength(1);
        expect(captured.cookies[0]?.name).toBe('puter_revalidation');
        expect(captured.cookies[0]?.value).toBeTruthy();
        const opts = captured.cookies[0]?.opts as {
            httpOnly: boolean;
            maxAge: number;
            path: string;
        };
        expect(opts.httpOnly).toBe(true);
        expect(opts.maxAge).toBe(300 * 1000);
        expect(opts.path).toBe('/');
    });

    it('falls back to /auth/revalidate-done when state.redirect_uri is cross-origin', async () => {
        const sub = `sub-${Math.random().toString(36).slice(2, 8)}`;
        const email = `reval-${Math.random().toString(36).slice(2, 8)}@test.local`;
        const created = await runWithContext(
            { req: makeReq({}) },
            () =>
                oidc().createUserFromOIDC('custom', {
                    sub,
                    email,
                    email_verified: true,
                }),
        );
        expect(created.success).toBe(true);
        const userUuid = created.user!.uuid;

        const state = oidc().signState({
            provider: 'custom',
            flow: 'revalidate',
            user_uuid: userUuid,
            // Attacker-controlled host.
            redirect_uri: 'https://evil.test/take-the-cookie',
        });
        vi.spyOn(oidc(), 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'access',
            id_token: 'id',
        } as never);
        vi.spyOn(oidc(), 'getUserInfo').mockResolvedValue({
            sub,
        } as never);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/oidc/callback/revalidate',
            makeReq({ query: { code: 'c', state } }),
            res,
        );
        // Same-origin clamp falls back to the canonical landing page.
        expect(captured.redirectUrl).toBe(
            `${TEST_ORIGIN}/auth/revalidate-done`,
        );
    });
});

// ── GET /auth/revalidate-done ───────────────────────────────────────

describe('OIDCController GET /auth/revalidate-done', () => {
    it('renders the postMessage HTML body with the configured origin', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/auth/revalidate-done',
            makeReq({}),
            res,
        );
        expect(captured.contentType).toContain('text/html');
        const body = String(captured.body);
        expect(body).toContain('puter-revalidate-done');
        // The configured origin is JSON-stringified into the inline script.
        expect(body).toContain(JSON.stringify(TEST_ORIGIN));
    });
});
