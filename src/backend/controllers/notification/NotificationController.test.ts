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

import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { NotificationController } from './NotificationController.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer with the live wired NotificationController.
// Tests seed real notification rows via the store, then drive the
// controller's `markAck` / `markRead` handlers with stub req/res
// objects. The controller's path through NotificationService updates
// the underlying row, so we verify behaviour by reading the store
// state back.

let server: PuterServer;
let controller: NotificationController;

beforeAll(async () => {
    server = await setupTestServer();
    controller =
        server.controllers.notification as unknown as NotificationController;
});

afterAll(async () => {
    await server?.shutdown();
});

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

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `nc-${Math.random().toString(36).slice(2, 10)}`;
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

// ── /notif/mark-ack ─────────────────────────────────────────────────

describe('NotificationController.markAck', () => {
    it('sets `acknowledged` on the underlying notification row', async () => {
        const { actor, userId } = await makeUser();
        const created = await server.stores.notification.create({
            userId,
            value: { title: 't' },
        });

        const { res, captured } = makeRes();
        await controller.markAck(
            makeReq({ body: { uid: created.uid }, actor }),
            res,
        );

        // Empty `{}` is the conventional success body for these routes.
        expect(captured.body).toEqual({});
        const after = await server.stores.notification.getByUid(
            created.uid as string,
            { userId },
        );
        expect(after?.acknowledged).not.toBeNull();
    });

    it('rejects a missing uid with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            controller.markAck(makeReq({ body: {}, actor }), res),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a non-string uid with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            controller.markAck(makeReq({ body: { uid: 123 }, actor }), res),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 when there is no actor on the request', async () => {
        const { res } = makeRes();
        await expect(
            controller.markAck(makeReq({ body: { uid: 'whatever' } }), res),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("does not flip another user's notification", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const created = await server.stores.notification.create({
            userId: a.userId,
            value: {},
        });

        const { res } = makeRes();
        await controller.markAck(
            makeReq({ body: { uid: created.uid }, actor: b.actor }),
            res,
        );

        const after = await server.stores.notification.getByUid(
            created.uid as string,
            { userId: a.userId },
        );
        // Store update is scoped by user_id — cross-user mutation is a
        // silent no-op rather than an error from the controller.
        expect(after?.acknowledged).toBeFalsy();
    });
});

// ── /notif/mark-read ────────────────────────────────────────────────

describe('NotificationController.markRead', () => {
    it('sets `shown` on the underlying notification row', async () => {
        const { actor, userId } = await makeUser();
        const created = await server.stores.notification.create({
            userId,
            value: {},
        });

        const { res, captured } = makeRes();
        await controller.markRead(
            makeReq({ body: { uid: created.uid }, actor }),
            res,
        );

        expect(captured.body).toEqual({});
        const after = await server.stores.notification.getByUid(
            created.uid as string,
            { userId },
        );
        expect(after?.shown).not.toBeNull();
        // Marking read should NOT also set acknowledged.
        expect(after?.acknowledged).toBeFalsy();
    });

    it('rejects an empty uid string with 400', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            controller.markRead(makeReq({ body: { uid: '' }, actor }), res),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 when there is no actor on the request', async () => {
        const { res } = makeRes();
        await expect(
            controller.markRead(makeReq({ body: { uid: 'x' } }), res),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});
