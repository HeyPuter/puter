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
import { generateDefaultFsentries } from '../../util/userProvisioning.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock
// redis) and re-registers DesktopController's inline lambda routes
// onto a fresh PuterRouter so each handler is reachable. Each test
// makes its own user via `makeUser` and exercises the live controller
// against the real wired stores (user, fsEntry) and DB client.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.desktop.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `dc-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
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

// ── /set-desktop-bg ─────────────────────────────────────────────────

describe('DesktopController POST /set-desktop-bg', () => {
    it('persists url/color/fit on the user row', async () => {
        const { actor, userId } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'post',
            '/set-desktop-bg',
            makeReq({
                body: {
                    url: 'https://cdn.test/wallpaper.png',
                    color: '#000000',
                    fit: 'cover',
                },
                actor,
            }),
            res,
        );
        expect(captured.body).toEqual({});

        const refreshed = await server.stores.user.getById(userId);
        expect(refreshed?.desktop_bg_url).toBe(
            'https://cdn.test/wallpaper.png',
        );
        expect(refreshed?.desktop_bg_color).toBe('#000000');
        expect(refreshed?.desktop_bg_fit).toBe('cover');
    });

    it('persists only the supplied fields (partial update)', async () => {
        const { actor, userId } = await makeUser();
        const { res } = makeRes();
        await callRoute(
            'post',
            '/set-desktop-bg',
            makeReq({ body: { color: '#ffffff' }, actor }),
            res,
        );
        const refreshed = await server.stores.user.getById(userId);
        expect(refreshed?.desktop_bg_color).toBe('#ffffff');
        // Untouched fields remain at their column default.
        expect(refreshed?.desktop_bg_url).toBeFalsy();
        expect(refreshed?.desktop_bg_fit).toBeFalsy();
    });

    it('passes through `null` to clear a field', async () => {
        const { actor, userId } = await makeUser();
        // First populate, then clear.
        const populate = makeRes();
        await callRoute(
            'post',
            '/set-desktop-bg',
            makeReq({
                body: { url: 'https://cdn.test/x.png' },
                actor,
            }),
            populate.res,
        );
        const before = await server.stores.user.getById(userId);
        expect(before?.desktop_bg_url).toBe('https://cdn.test/x.png');

        const clear = makeRes();
        await callRoute(
            'post',
            '/set-desktop-bg',
            makeReq({ body: { url: null }, actor }),
            clear.res,
        );
        const after = await server.stores.user.getById(userId);
        expect(after?.desktop_bg_url).toBeNull();
    });

    it('throws 400 when url is not a string or null', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set-desktop-bg',
                makeReq({ body: { url: 123 }, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when no fields are provided', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set-desktop-bg',
                makeReq({ body: {}, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── /update-taskbar-items ───────────────────────────────────────────

describe('DesktopController POST /update-taskbar-items', () => {
    it('persists items as a JSON-encoded string', async () => {
        const { actor, userId } = await makeUser();
        const items = [{ name: 'editor' }, { name: 'browser' }];
        const { res } = makeRes();
        await callRoute(
            'post',
            '/update-taskbar-items',
            makeReq({ body: { items }, actor }),
            res,
        );

        const refreshed = await server.stores.user.getById(userId);
        expect(refreshed?.taskbar_items).toBe(JSON.stringify(items));
    });

    it('throws 400 when items is missing', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/update-taskbar-items',
                makeReq({ body: {}, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when items is not an array', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/update-taskbar-items',
                makeReq({ body: { items: 'oops' }, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── /set_layout ─────────────────────────────────────────────────────

describe('DesktopController POST /set_layout', () => {
    it('persists the new layout on the matching fsentry', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const documents = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );
        expect(documents).not.toBeNull();

        const { res, captured } = makeRes();
        await callRoute(
            'post',
            '/set_layout',
            makeReq({
                body: { item_uid: documents!.uuid, layout: 'icons' },
                actor,
            }),
            res,
        );
        expect(captured.body).toEqual({});

        const refreshed = await server.stores.fsEntry.getEntryByUuid(
            documents!.uuid,
        );
        expect(refreshed?.layout).toBe('icons');
    });

    it('resolves by item_path when item_uid is omitted', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Pictures`;

        const { res } = makeRes();
        await callRoute(
            'post',
            '/set_layout',
            makeReq({
                body: { item_path: path, layout: 'list' },
                actor,
            }),
            res,
        );

        const refreshed = await server.stores.fsEntry.getEntryByPath(path);
        expect(refreshed?.layout).toBe('list');
    });

    it('throws 400 for an unknown layout value', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const documents = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );

        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set_layout',
                makeReq({
                    body: { item_uid: documents!.uuid, layout: 'gallery' },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when neither item_uid nor item_path is supplied', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set_layout',
                makeReq({ body: { layout: 'icons' }, actor }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 404 when the fsentry cannot be resolved', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set_layout',
                makeReq({
                    body: {
                        item_uid: '00000000-0000-0000-0000-000000000000',
                        layout: 'icons',
                    },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("throws 403 when the fsentry belongs to another user", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const ownerUsername = owner.actor.user!.username!;
        const ownerEntry = await server.stores.fsEntry.getEntryByPath(
            `/${ownerUsername}/Documents`,
        );

        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set_layout',
                makeReq({
                    body: { item_uid: ownerEntry!.uuid, layout: 'icons' },
                    actor: intruder.actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });

        // Owner's entry remains untouched.
        const refreshed = await server.stores.fsEntry.getEntryByUuid(
            ownerEntry!.uuid,
        );
        expect(refreshed?.layout).toBeFalsy();
    });
});

// ── /set_sort_by ────────────────────────────────────────────────────

describe('DesktopController POST /set_sort_by', () => {
    it('persists sort_by + sort_order on the matching fsentry', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const documents = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );

        const { res, captured } = makeRes();
        await callRoute(
            'post',
            '/set_sort_by',
            makeReq({
                body: {
                    item_uid: documents!.uuid,
                    sort_by: 'name',
                    sort_order: 'desc',
                },
                actor,
            }),
            res,
        );
        expect(captured.body).toEqual({});

        const refreshed = await server.stores.fsEntry.getEntryByUuid(
            documents!.uuid,
        );
        expect(refreshed?.sortBy).toBe('name');
        expect(refreshed?.sortOrder).toBe('desc');
    });

    it('defaults sort_order to "asc" when omitted', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const pictures = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Pictures`,
        );

        const { res } = makeRes();
        await callRoute(
            'post',
            '/set_sort_by',
            makeReq({
                body: { item_uid: pictures!.uuid, sort_by: 'modified' },
                actor,
            }),
            res,
        );

        const refreshed = await server.stores.fsEntry.getEntryByUuid(
            pictures!.uuid,
        );
        expect(refreshed?.sortBy).toBe('modified');
        expect(refreshed?.sortOrder).toBe('asc');
    });

    it('throws 400 for an unknown sort_by value', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const docs = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );

        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set_sort_by',
                makeReq({
                    body: { item_uid: docs!.uuid, sort_by: 'random' },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 for an invalid sort_order', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        const docs = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        );

        const { res } = makeRes();
        await expect(
            callRoute(
                'post',
                '/set_sort_by',
                makeReq({
                    body: {
                        item_uid: docs!.uuid,
                        sort_by: 'name',
                        sort_order: 'sideways',
                    },
                    actor,
                }),
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});
