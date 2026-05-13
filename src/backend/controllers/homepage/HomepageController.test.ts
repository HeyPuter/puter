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
import type { Actor } from '../../core/actor.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock
// redis) and re-registers HomepageController's inline lambda routes
// onto a fresh PuterRouter so each handler is reachable. Tests
// exercise the live PuterHomepageService (it renders the shell HTML
// to res.send) and the real AppStore for /app/:name.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.homepage.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `hpc-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    contentType?: string;
}

const makeReq = (init: {
    params?: Record<string, unknown>;
    path?: string;
    actor?: Actor;
    hostname?: string;
    protocol?: string;
}): Request => {
    return {
        body: {},
        query: {},
        headers: {},
        params: init.params ?? {},
        path: init.path ?? '/',
        hostname: init.hostname ?? 'test.local',
        protocol: init.protocol ?? 'http',
        actor: init.actor,
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
    const res = {
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        send: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        set: vi.fn((key: string, value: string) => {
            if (key.toLowerCase() === 'content-type') {
                captured.contentType = value;
            }
            return res;
        }),
        setHeader: vi.fn((key: string, value: string) => {
            if (key.toLowerCase() === 'content-type') {
                captured.contentType = value;
            }
            return res;
        }),
        type: vi.fn((value: string) => {
            captured.contentType = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

const findHandler = (method: string, path: string): RequestHandler | null => {
    const route = router.routes.find(
        (r) => r.method === method && r.path === path,
    );
    return route?.handler ?? null;
};

const callRoute = async (
    method: string,
    path: string,
    req: Request,
    res: Response,
) => {
    const handler = findHandler(method, path);
    if (!handler) throw new Error(`No ${method.toUpperCase()} ${path} route`);
    await handler(req, res, () => {
        throw new Error('handler called next() unexpectedly');
    });
};

// ── Shell routes ────────────────────────────────────────────────────

describe('HomepageController shell routes', () => {
    it('renders the live shell HTML on the root path', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/', makeReq({ path: '/' }), res);
        // PuterHomepageService.send writes the rendered HTML via res.send.
        expect(typeof captured.body).toBe('string');
        const html = String(captured.body);
        expect(html).toMatch(/<!DOCTYPE html>/i);
        // The configured page title flows through the meta block.
        expect(html).toContain('Puter');
    });

    it('still serves the shell when an authenticated actor is present', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute('get', '/', makeReq({ path: '/', actor }), res);
        expect(typeof captured.body).toBe('string');
        expect(String(captured.body)).toMatch(/<!DOCTYPE html>/i);
    });

    it('serves the shell on /settings, /dashboard, /action, /@:username', async () => {
        for (const path of [
            '/settings',
            '/settings/*splat',
            '/dashboard',
            '/dashboard/',
            '/action/*splat',
            '/@:username',
        ]) {
            const { res, captured } = makeRes();
            await callRoute('get', path, makeReq({ path }), res);
            expect(typeof captured.body).toBe('string');
            expect(String(captured.body)).toMatch(/<!DOCTYPE html>/i);
        }
    });
});

// ── /app/:name ──────────────────────────────────────────────────────

describe('HomepageController GET /app/:name', () => {
    it('returns 404 (still renders the shell) when the app is unknown', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app/:name',
            makeReq({
                params: { name: 'no-such-app' },
                path: '/app/no-such-app',
            }),
            res,
        );
        expect(captured.statusCode).toBe(404);
        // The shell still renders so the client router can take over.
        expect(typeof captured.body).toBe('string');
        expect(String(captured.body)).toMatch(/<!DOCTYPE html>/i);
    });

    it('renders the shell with the app row in scope when the app exists', async () => {
        const { userId } = await makeUser();
        const name = `app-${Math.random().toString(36).slice(2, 10)}`;
        await server.stores.app.create(
            {
                name,
                title: 'Cool App',
                description: 'a real app row',
                index_url: `https://example.com/${name}/`,
                approved_for_listing: 1,
            },
            { ownerUserId: userId },
        );

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app/:name',
            makeReq({ params: { name }, path: `/app/${name}` }),
            res,
        );

        expect(captured.statusCode).toBe(200);
        // Shell payload is HTML; the app's title appears in the page meta.
        const html = String(captured.body);
        expect(html).toMatch(/<!DOCTYPE html>/i);
        expect(html).toContain('Cool App');
    });
});

// ── /show/* ─────────────────────────────────────────────────────────

describe('HomepageController GET /show/*splat', () => {
    it('emits a launch_app explorer call with the post-/show path', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/show/*splat',
            makeReq({ path: '/show/alice/Documents' }),
            res,
        );
        // The launch payload is JSON-serialized into the rendered HTML.
        // We assert the rendered shell included the explorer launch hint
        // pointing at the expected (slashed) path.
        const html = String(captured.body);
        expect(html).toContain('launch_app');
        expect(html).toContain('explorer');
        expect(html).toContain('/alice/Documents');
    });
});
