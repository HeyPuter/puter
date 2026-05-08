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
// redis) and re-registers SystemController's inline lambda routes
// onto a fresh PuterRouter so each handler is reachable. Tests then
// drive the captured handler with stub req/res — the underlying
// services (health, db, drivers) are the live wired ones.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.system.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `sysc-${Math.random().toString(36).slice(2, 10)}`;
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
}

const makeReq = (init: {
    body?: unknown;
    actor?: Actor;
}): Request => {
    return {
        body: init.body ?? {},
        query: {},
        headers: {},
        actor: init.actor,
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
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

// ── /healthcheck ────────────────────────────────────────────────────

describe('SystemController GET /healthcheck', () => {
    it('returns the live ServerHealthService status payload', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/healthcheck', makeReq({}), res);
        // Live status — boot is complete and the in-memory DB is up,
        // so ok=true is the expected steady state for this harness.
        expect(captured.body).toMatchObject({ ok: true });
        expect(captured.statusCode).toBe(200);
    });
});

// ── /version ────────────────────────────────────────────────────────

describe('SystemController GET /version', () => {
    it('returns version-shape JSON with environment + deploy_timestamp', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/version', makeReq({}), res);
        const body = captured.body as Record<string, unknown>;
        // Default config has no `version` set — falls through to
        // npm_package_version (set when running under vitest) or 'unknown'.
        expect(typeof body.version).toBe('string');
        // Default test config carries env='dev' from config.default.json.
        expect(body.environment).toBe('dev');
        expect(typeof body.deploy_timestamp).toBe('number');
    });
});

// ── /contactUs ──────────────────────────────────────────────────────

describe('SystemController POST /contactUs', () => {
    it('throws 400 when message is missing', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({ body: {}, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when message is not a string', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({ body: { message: 12345 }, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when message exceeds 100,000 characters', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/contactUs',
                makeReq({
                    body: { message: 'x'.repeat(100_001) },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('persists feedback into the DB on success', async () => {
        const { actor, userId } = await makeUser();
        const message = `hello ${Math.random().toString(36).slice(2)}`;
        const { res, captured } = makeRes();
        await callRoute(
            'post',
            '/contactUs',
            makeReq({ body: { message }, actor }),
            res,
        );
        expect(captured.body).toEqual({});

        // The row landed in the real `feedback` table for the right user.
        const rows = (await server.clients.db.read(
            'SELECT `user_id`, `message` FROM `feedback` WHERE `user_id` = ? AND `message` = ?',
            [userId, message],
        )) as Array<{ user_id: number; message: string }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.message).toBe(message);
    });
});

// ── /whoarewe ───────────────────────────────────────────────────────

describe('SystemController GET /whoarewe', () => {
    it('returns the configured Puter identity payload', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/whoarewe', makeReq({}), res);
        expect(captured.body).toMatchObject({
            name: 'Puter',
            environment: 'dev',
        });
    });
});

// ── /lsmod ──────────────────────────────────────────────────────────

describe('SystemController GET /lsmod', () => {
    it('lists wired drivers grouped by interface', async () => {
        const { res, captured } = makeRes();
        await callRoute('get', '/lsmod', makeReq({}), res);
        const body = captured.body as {
            interfaces: Record<
                string,
                { implementors: Record<string, { isDefault: boolean }> }
            >;
        };
        expect(body.interfaces).toBeDefined();
        // Test harness wires the full driver registry; at least one
        // driver/interface pair must come through.
        expect(Object.keys(body.interfaces).length).toBeGreaterThan(0);
        for (const iface of Object.values(body.interfaces)) {
            expect(Object.keys(iface.implementors).length).toBeGreaterThan(0);
        }
    });
});

// ── lifecycle ───────────────────────────────────────────────────────

describe('SystemController.onServerPrepareShutdown', () => {
    it('flips the global drain flag', () => {
        // Reset before the call so the assertion is meaningful even
        // when earlier code in the same process already tripped it.
        (
            globalThis as unknown as { __puter_draining?: boolean }
        ).__puter_draining = false;
        server.controllers.system.onServerPrepareShutdown();
        expect(
            (globalThis as unknown as { __puter_draining?: boolean })
                .__puter_draining,
        ).toBe(true);
    });
});
