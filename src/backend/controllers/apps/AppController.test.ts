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
import { runWithContext } from '../../core/context.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock
// redis) and re-registers AppController's inline lambda routes onto a
// fresh PuterRouter so each handler is reachable. Tests run against
// the live wired AppDriver, AppStore, DB client, and EventClient —
// no method spies. Apps are created via the real AppDriver so
// ownership / approval / metadata behave exactly like prod.

let server: PuterServer;
let router: PuterRouter;

interface CrudQDriver {
    create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    read: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    select: (args: Record<string, unknown>) => Promise<unknown[]>;
    isNameAvailable: (name: string) => Promise<boolean>;
}
let driver: CrudQDriver;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.apps.registerRoutes(router);
    driver = server.drivers.apps as unknown as CrudQDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `apc-${Math.random().toString(36).slice(2, 10)}`;
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

const withActor = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const uniqueName = (prefix: string) =>
    `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const uniqueIndexUrl = () =>
    `https://example-${Math.random().toString(36).slice(2, 10)}.test/`;

const createApp = async (
    actor: Actor,
    overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
    withActor(actor, () =>
        driver.create({
            object: {
                name: uniqueName('app'),
                title: 'Test App',
                description: 'desc',
                index_url: uniqueIndexUrl(),
                ...overrides,
            },
        }),
    );

interface CapturedResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    redirectStatus?: number;
    redirectUrl?: string;
}

const makeReq = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
    actor?: Actor | unknown;
}): Request => {
    return {
        body: init.body ?? {},
        query: init.query ?? {},
        params: init.params ?? {},
        headers: {},
        actor: init.actor,
    } as unknown as Request;
};

const makeRes = () => {
    const captured: CapturedResponse = {
        statusCode: 200,
        body: undefined,
        headers: {},
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

// ── GET /apps ───────────────────────────────────────────────────────

describe('AppController GET /apps', () => {
    it('returns the apps the caller can edit (filtered by user-can-edit)', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const app = await createApp(owner.actor, { name: uniqueName('mine') });

        // Owner sees their own app.
        const { res: ownerRes, captured: ownerCaptured } = makeRes();
        await withActor(owner.actor, () =>
            callRoute(
                'get',
                '/apps',
                makeReq({ actor: owner.actor }),
                ownerRes,
            ),
        );
        const ownerApps = ownerCaptured.body as Array<{ uid: string }>;
        expect(ownerApps.some((a) => a.uid === app.uid)).toBe(true);

        // A different user does not.
        const { res: strangerRes, captured: strangerCaptured } = makeRes();
        await withActor(stranger.actor, () =>
            callRoute(
                'get',
                '/apps',
                makeReq({ actor: stranger.actor }),
                strangerRes,
            ),
        );
        const strangerApps = strangerCaptured.body as Array<{ uid: string }>;
        expect(strangerApps.every((a) => a.uid !== app.uid)).toBe(true);
    });
});

// ── GET /apps/nameAvailable ─────────────────────────────────────────

describe('AppController GET /apps/nameAvailable', () => {
    it('returns available=true for an unused name', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('avail');
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            callRoute(
                'get',
                '/apps/nameAvailable',
                makeReq({ query: { name }, actor }),
                res,
            ),
        );
        expect(captured.body).toEqual({ name, available: true });
    });

    it('returns available=false once an app with that name exists', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('taken');
        await createApp(actor, { name });

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            callRoute(
                'get',
                '/apps/nameAvailable',
                makeReq({ query: { name }, actor }),
                res,
            ),
        );
        expect(captured.body).toEqual({ name, available: false });
    });

    it('throws 400 when `name` query param is missing', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                callRoute(
                    'get',
                    '/apps/nameAvailable',
                    makeReq({ query: {}, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── POST /rao ───────────────────────────────────────────────────────

describe('AppController POST /rao', () => {
    it('throws 400 when neither body nor actor carries app_uid', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                callRoute(
                    'post',
                    '/rao',
                    makeReq({ body: {}, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 404 when the supplied app_uid does not exist', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                callRoute(
                    'post',
                    '/rao',
                    makeReq({
                        body: { app_uid: 'app-no-such-thing' },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('records the app_open in the DB on success', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);

        const { res, captured } = makeRes();
        await withActor(owner.actor, () =>
            callRoute(
                'post',
                '/rao',
                makeReq({ body: { app_uid: app.uid }, actor: owner.actor }),
                res,
            ),
        );
        expect(captured.body).toEqual({});

        const rows = (await server.clients.db.read(
            'SELECT `app_uid`, `user_id` FROM `app_opens` WHERE `app_uid` = ? AND `user_id` = ?',
            [app.uid, owner.userId],
        )) as Array<{ app_uid: string; user_id: number }>;
        expect(rows).toHaveLength(1);
    });

    it('falls back to actor.app.uid when the body omits app_uid', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);

        const { res, captured } = makeRes();
        const actorWithApp: unknown = {
            ...owner.actor,
            app: { uid: app.uid },
        };
        await withActor(owner.actor, () =>
            callRoute(
                'post',
                '/rao',
                makeReq({ body: {}, actor: actorWithApp }),
                res,
            ),
        );
        expect(captured.body).toEqual({});

        const rows = (await server.clients.db.read(
            'SELECT `app_uid` FROM `app_opens` WHERE `app_uid` = ? AND `user_id` = ?',
            [app.uid, owner.userId],
        )) as Array<{ app_uid: string }>;
        expect(rows.length).toBeGreaterThan(0);
    });
});

// ── GET /apps/:name (single + pipe-batched) ─────────────────────────

describe('AppController GET /apps/:name', () => {
    it('throws 404 for a single missing app', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                callRoute(
                    'get',
                    '/apps/:name',
                    makeReq({
                        params: { name: 'no-such-app' },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns a single app object for a single name', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);

        const { res, captured } = makeRes();
        await withActor(owner.actor, () =>
            callRoute(
                'get',
                '/apps/:name',
                makeReq({
                    params: { name: app.name },
                    actor: owner.actor,
                }),
                res,
            ),
        );
        expect(Array.isArray(captured.body)).toBe(false);
        const body = captured.body as Record<string, unknown>;
        expect(body.uid).toBe(app.uid);
        expect(body.privateAccess).toBeDefined();
    });

    it('returns an array (with nulls for unknowns) for pipe-separated batch', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);

        const { res, captured } = makeRes();
        await withActor(owner.actor, () =>
            callRoute(
                'get',
                '/apps/:name',
                makeReq({
                    params: { name: `${app.name}|missing-app` },
                    actor: owner.actor,
                }),
                res,
            ),
        );
        expect(Array.isArray(captured.body)).toBe(true);
        const arr = captured.body as unknown[];
        expect(arr).toHaveLength(2);
        expect((arr[0] as Record<string, unknown>).uid).toBe(app.uid);
        expect(arr[1]).toBeNull();
    });
});

// ── POST /query/app ─────────────────────────────────────────────────

describe('AppController POST /query/app', () => {
    it('returns [] for a non-array body', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            callRoute(
                'post',
                '/query/app',
                makeReq({ body: { not: 'an-array' }, actor }),
                res,
            ),
        );
        expect(captured.body).toEqual([]);
    });

    it('throws 400 when the array exceeds the 200-entry cap', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                callRoute(
                    'post',
                    '/query/app',
                    makeReq({
                        body: new Array(201).fill('x'),
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns approved-for-listing apps with the v1 marketplace shape', async () => {
        const owner = await makeUser();
        // Name must not start with `app-` — the controller treats names
        // with that prefix as UID lookups.
        const app = await createApp(owner.actor, {
            name: uniqueName('marketplace'),
            description: 'cool desc',
        });
        // approved_for_listing is admin-controlled and goes through the
        // store's READ_ONLY filter — flip it via a direct DB write
        // and invalidate the store's cache so the stale row doesn't
        // get served.
        await server.clients.db.write(
            'UPDATE `apps` SET `approved_for_listing` = 1 WHERE `uid` = ?',
            [app.uid],
        );
        await server.stores.app.invalidateByUid(app.uid as string);

        // Stranger queries by name and gets the v1 marketplace shape.
        const stranger = await makeUser();
        const { res, captured } = makeRes();
        await withActor(stranger.actor, () =>
            callRoute(
                'post',
                '/query/app',
                makeReq({ body: [app.name], actor: stranger.actor }),
                res,
            ),
        );

        const body = captured.body as Array<Record<string, unknown>>;
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
            uuid: app.uid,
            name: app.name,
            description: 'cool desc',
        });
        // Internal fields must be omitted.
        expect(body[0]?.id).toBeUndefined();
        expect(body[0]?.owner_user_id).toBeUndefined();
        expect(body[0]?.index_url).toBeUndefined();
    });

    it('skips selectors that are empty/oversize/non-string', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            callRoute(
                'post',
                '/query/app',
                makeReq({
                    body: [
                        '', // empty
                        'a'.repeat(201), // oversize
                        123, // wrong type
                    ],
                    actor,
                }),
                res,
            ),
        );
        expect(captured.body).toEqual([]);
    });

    it('hides unapproved, protected, non-owned apps from strangers', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor, {
            name: uniqueName('hidden'),
        });
        // The /query/app gate only fires when AppDriver.read denies
        // access — and that only happens for `protected` apps the
        // caller doesn't own / hasn't been granted access to.
        // `protected` is admin-controlled (READ_ONLY in AppStore), so
        // we flip it via a direct DB write.
        await server.clients.db.write(
            'UPDATE `apps` SET `protected` = 1 WHERE `uid` = ?',
            [app.uid],
        );
        await server.stores.app.invalidateByUid(app.uid as string);

        const stranger = await makeUser();
        const { res, captured } = makeRes();
        await withActor(stranger.actor, () =>
            callRoute(
                'post',
                '/query/app',
                makeReq({ body: [app.name], actor: stranger.actor }),
                res,
            ),
        );
        // Existence isn't surfaced — caller can't enumerate private apps.
        expect(captured.body).toEqual([]);
    });

    it('shows owners their own unapproved apps', async () => {
        const owner = await makeUser();
        // Avoid `app-` prefix so the controller looks up by name.
        const app = await createApp(owner.actor, {
            name: uniqueName('mine'),
        });

        const { res, captured } = makeRes();
        await withActor(owner.actor, () =>
            callRoute(
                'post',
                '/query/app',
                makeReq({ body: [app.name], actor: owner.actor }),
                res,
            ),
        );
        const body = captured.body as Array<Record<string, unknown>>;
        expect(body).toHaveLength(1);
        expect(body[0]?.uuid).toBe(app.uid);
    });

    it('looks up by UID when the selector starts with `app-`', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);
        await server.clients.db.write(
            'UPDATE `apps` SET `approved_for_listing` = 1 WHERE `uid` = ?',
            [app.uid],
        );
        await server.stores.app.invalidateByUid(app.uid as string);

        const { res, captured } = makeRes();
        await withActor(owner.actor, () =>
            callRoute(
                'post',
                '/query/app',
                makeReq({ body: [app.uid], actor: owner.actor }),
                res,
            ),
        );
        const body = captured.body as Array<Record<string, unknown>>;
        expect(body).toHaveLength(1);
        expect(body[0]?.name).toBe(app.name);
    });
});

// ── GET /app-icon/:app_uid(/:size) ──────────────────────────────────

describe('AppController GET /app-icon/:app_uid', () => {
    it('returns 400 for a missing app_uid param', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app-icon/:app_uid',
            makeReq({ params: { app_uid: '' } }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('returns 400 for an unsupported size param', async () => {
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app-icon/:app_uid/:size',
            makeReq({ params: { app_uid: 'app-1', size: '999' } }),
            res,
        );
        expect(captured.statusCode).toBe(400);
    });

    it('serves the default icon when the app row has no icon', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app-icon/:app_uid',
            makeReq({ params: { app_uid: app.uid } }),
            res,
        );
        // Default icon is SVG; CSP sandbox locks down script execution.
        expect(captured.headers['content-type']).toContain('image/svg+xml');
        expect(captured.headers['content-security-policy']).toContain(
            'sandbox',
        );
        expect(Buffer.isBuffer(captured.body)).toBe(true);
    });

    it('decodes a data URL icon and serves the declared MIME', async () => {
        const owner = await makeUser();
        const png = Buffer.from('mock-png-bytes');
        const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
        const app = await createApp(owner.actor, { icon: dataUrl });

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app-icon/:app_uid',
            makeReq({ params: { app_uid: app.uid } }),
            res,
        );

        expect(captured.headers['content-type']).toBe('image/png');
        expect(Buffer.isBuffer(captured.body)).toBe(true);
        expect((captured.body as Buffer).equals(png)).toBe(true);
    });

    it('falls back to the default icon when the data-URL MIME is not allowlisted', async () => {
        const owner = await makeUser();
        // text/html is NOT in the icon allowlist — must NOT be echoed back.
        // AppDriver.create rejects non-image MIMEs at write time, so we
        // bypass and store the dangerous icon directly in the DB.
        const app = await createApp(owner.actor);
        const dataUrl = `data:text/html;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
        await server.clients.db.write(
            'UPDATE `apps` SET `icon` = ? WHERE `uid` = ?',
            [dataUrl, app.uid],
        );

        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app-icon/:app_uid',
            makeReq({ params: { app_uid: app.uid } }),
            res,
        );
        // Falls back to default icon (SVG).
        expect(captured.headers['content-type']).toContain('image/svg+xml');
    });

    it('prepends the `app-` prefix when omitted from the param', async () => {
        const owner = await makeUser();
        const app = await createApp(owner.actor);

        // Strip the prefix; controller should re-add it before lookup.
        const stripped = String(app.uid).replace(/^app-/, '');
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/app-icon/:app_uid',
            makeReq({ params: { app_uid: stripped } }),
            res,
        );
        // Either the default icon (no `icon` column on the row) or a
        // configured one — both come back as 200, not 404.
        expect(captured.statusCode).toBe(200);
    });
});
