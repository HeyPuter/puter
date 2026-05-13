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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock
// redis) and re-registers StaticPagesController's inline lambda
// routes onto a fresh PuterRouter. Tests run against the live wired
// stores (user, group), DB client, and EventClient — no method spies
// or stub services. Each test seeds the data it needs (user rows,
// listed apps) directly through the real stores.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.staticPages.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    contentType?: string;
}

const makeReq = (init: {
    query?: Record<string, unknown>;
    hostname?: string;
    protocol?: string;
}): Request => {
    return {
        body: {},
        query: init.query ?? {},
        params: {},
        headers: {},
        hostname: init.hostname ?? 'test.local',
        protocol: init.protocol ?? 'https',
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
    const res = {
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        type: vi.fn((value: string) => {
            captured.contentType = value;
            return res;
        }),
        setHeader: vi.fn(() => res),
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
    await handler(req, res, () => {
        throw new Error('handler called next() unexpectedly');
    });
};

interface TestUser {
    id: number;
    uuid: string;
    username: string;
    email: string;
    email_confirm_token: string;
}

const makeUser = async (
    overrides: {
        email_confirmed?: 0 | 1;
        unsubscribed?: 0 | 1;
    } = {},
): Promise<TestUser> => {
    const username = `spc-${Math.random().toString(36).slice(2, 10)}`;
    const uuid = uuidv4();
    const email = `${username}@test.local`;
    const token = `tok-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid,
        password: null,
        email,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    // Layer the test-specific shape on top of the row (clean_email is
    // populated by `create`; we just stamp the confirmation token here).
    await server.stores.user.update(created.id, {
        email_confirm_token: token,
        email_confirmed: overrides.email_confirmed ?? 0,
        unsubscribed: overrides.unsubscribed ?? 0,
    });
    return { id: created.id, uuid, username, email, email_confirm_token: token };
};

// ── /robots.txt ─────────────────────────────────────────────────────

describe('StaticPagesController GET /robots.txt', () => {
    it('disallows known SEO bots and points to the sitemap', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/robots.txt',
            makeReq({ protocol: 'https' }),
            res,
        );
        expect(captured.contentType).toBe('text/plain');
        const body = String(captured.body);
        expect(body).toContain('User-agent: AhrefsBot');
        expect(body).toContain('User-agent: SemrushBot');
        expect(body).toContain('Disallow: /');
        // Sitemap URL is built off the request protocol + configured domain
        // (or req.hostname if domain is unset).
        expect(body).toMatch(/Sitemap: https:\/\/[^/]+\/sitemap\.xml/);
    });
});

// ── /sitemap.xml ────────────────────────────────────────────────────

describe('StaticPagesController GET /sitemap.xml', () => {
    it('lists docs + each approved-for-listing app', async () => {
        const { id: userId } = await makeUser();
        // Seed an approved app via the real AppStore. `approved_for_listing`
        // is in the store's READ_ONLY_COLUMNS (admin-controlled), so we
        // flip it via a direct DB write after the row is created.
        const name = `app-${Math.random().toString(36).slice(2, 10)}`;
        await server.stores.app.create(
            {
                name,
                title: name,
                description: '',
                index_url: `https://example.com/${name}/`,
            },
            { ownerUserId: userId },
        );
        await server.clients.db.write(
            'UPDATE `apps` SET `approved_for_listing` = 1 WHERE `name` = ?',
            [name],
        );

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/sitemap.xml',
            makeReq({ protocol: 'https' }),
            res,
        );
        expect(captured.contentType).toBe('application/xml');
        const body = String(captured.body);
        expect(body).toContain(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        );
        // Docs subdomain entry is always present.
        expect(body).toMatch(/<loc>https:\/\/docs\.[^<]+<\/loc>/);
        // The seeded approved app appears.
        expect(body).toContain(`/app/${name}`);
    });

    it('omits non-approved apps', async () => {
        const { id: userId } = await makeUser();
        const hidden = `hidden-${Math.random().toString(36).slice(2, 10)}`;
        await server.stores.app.create(
            {
                name: hidden,
                title: hidden,
                description: '',
                index_url: `https://example.com/${hidden}/`,
                approved_for_listing: 0,
            },
            { ownerUserId: userId },
        );

        const { res, captured } = makeRes();
        await callRoute('get', '/sitemap.xml', makeReq({}), res);
        expect(String(captured.body)).not.toContain(`/app/${hidden}`);
    });
});

// ── /unsubscribe ────────────────────────────────────────────────────

describe('StaticPagesController GET /unsubscribe', () => {
    it('renders an error when user_uuid is missing', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/unsubscribe', makeReq({}), res);
        expect(String(captured.body)).toContain('user_uuid is required');
    });

    it('renders an error when the user does not exist', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/unsubscribe',
            makeReq({
                query: { user_uuid: '00000000-0000-0000-0000-000000000000' },
            }),
            res,
        );
        expect(String(captured.body)).toContain('User not found');
    });

    it('flips unsubscribed=1 on the real user row', async () => {
        const user = await makeUser({ unsubscribed: 0 });
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/unsubscribe',
            makeReq({ query: { user_uuid: user.uuid } }),
            res,
        );
        expect(String(captured.body)).toContain(
            'You have successfully unsubscribed',
        );
        const refreshed = await server.stores.user.getById(user.id);
        // User store stores booleans as 1/0 in sqlite; both forms are accepted.
        expect(Boolean(refreshed?.unsubscribed)).toBe(true);
    });

    it('reports already-unsubscribed without re-writing', async () => {
        const user = await makeUser({ unsubscribed: 1 });
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/unsubscribe',
            makeReq({ query: { user_uuid: user.uuid } }),
            res,
        );
        expect(String(captured.body)).toContain('already unsubscribed');
    });
});

// ── /confirm-email-by-token ─────────────────────────────────────────

describe('StaticPagesController GET /confirm-email-by-token', () => {
    it('renders an error when user_uuid is missing', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({ query: { token: 'whatever' } }),
            res,
        );
        expect(String(captured.body)).toContain('user_uuid is required');
    });

    it('renders an error when token is missing', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({ query: { user_uuid: 'u-uuid' } }),
            res,
        );
        expect(String(captured.body)).toContain('token is required');
    });

    it('renders an error when the user does not exist', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({
                query: {
                    user_uuid: '00000000-0000-0000-0000-000000000000',
                    token: 'x',
                },
            }),
            res,
        );
        expect(String(captured.body)).toContain('user not found');
    });

    it('rejects an invalid token without modifying the user', async () => {
        const user = await makeUser({ email_confirmed: 0 });
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({
                query: { user_uuid: user.uuid, token: 'wrong' },
            }),
            res,
        );
        expect(String(captured.body)).toContain('invalid token');
        const refreshed = await server.stores.user.getById(user.id);
        expect(Boolean(refreshed?.email_confirmed)).toBe(false);
    });

    it('reports already-confirmed without re-writing', async () => {
        const user = await makeUser({ email_confirmed: 1 });
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({
                query: {
                    user_uuid: user.uuid,
                    token: user.email_confirm_token,
                },
            }),
            res,
        );
        expect(String(captured.body)).toContain('Email already confirmed');
    });

    it('confirms the email and clears the token on the real user row', async () => {
        const user = await makeUser({ email_confirmed: 0 });
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({
                query: {
                    user_uuid: user.uuid,
                    token: user.email_confirm_token,
                },
            }),
            res,
        );
        expect(String(captured.body)).toContain('successfully confirmed');

        const refreshed = await server.stores.user.getById(user.id);
        expect(Boolean(refreshed?.email_confirmed)).toBe(true);
        expect(refreshed?.email_confirm_token).toBeNull();
        // requires_email_confirmation is also cleared by the controller.
        expect(Boolean(refreshed?.requires_email_confirmation)).toBe(false);
    });

    it('rejects when the email is already confirmed on a different account', async () => {
        // Duplicate-email gate fires only when the existing row is
        // (a) email_confirmed=1 and (b) has a non-null password — the
        // controller's EXISTS check requires both. `makeUser` writes
        // password=null so we have to pin one in directly.
        const ownerUser = await makeUser({ email_confirmed: 1 });
        await server.clients.db.write(
            'UPDATE `user` SET `password` = ? WHERE `id` = ?',
            ['hashed-pw', ownerUser.id],
        );

        // Second user with the same email; controller will refuse to
        // confirm them because the original already owns the address.
        const duplicateUuid = uuidv4();
        const duplicateUsername = `dup-${Math.random().toString(36).slice(2, 8)}`;
        await server.clients.db.write(
            'INSERT INTO `user` (`uuid`, `username`, `email`, `clean_email`, `email_confirmed`, `password`, `email_confirm_token`) VALUES (?, ?, ?, ?, 0, NULL, ?)',
            [
                duplicateUuid,
                duplicateUsername,
                ownerUser.email,
                ownerUser.email.toLowerCase(),
                'tok-dup',
            ],
        );

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/confirm-email-by-token',
            makeReq({
                query: {
                    user_uuid: duplicateUuid,
                    token: 'tok-dup',
                },
            }),
            res,
        );
        expect(String(captured.body)).toContain(
            'confirmed on a different account',
        );
    });
});
