/*
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
import type { Actor } from '../../core/actor.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { AppFeedbackService } from '../../services/feedback/AppFeedbackService.js';
import { setupTestServer } from '../../testUtil.js';

// Boots one real PuterServer (in-memory sqlite + mocked externals) and
// registers AppFeedbackController's decorated routes onto a fresh
// PuterRouter. Tests drive the captured handlers with stub req/res; the
// stores/services underneath are the live wired ones, so rows land in the
// real `app_feedback` table.

let server: PuterServer;
let router: PuterRouter;

beforeAll(async () => {
    server = await setupTestServer();
    router = new PuterRouter();
    server.controllers.appFeedback.registerRoutes(router);
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `fdbk-${Math.random().toString(36).slice(2, 10)}`;
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

const makeApp = async (
    ownerUserId: number,
    opts: { feedbackEnabled?: boolean; indexUrl?: string; name?: string } = {},
) => {
    const name =
        opts.name ?? `fdbk-app-${Math.random().toString(36).slice(2, 10)}`;
    return await server.stores.app.create(
        {
            name,
            title: `Feedback Test ${name}`,
            index_url: opts.indexUrl ?? `https://${name}.example.com`,
            ...(opts.feedbackEnabled ? { feedback_enabled: 1 } : {}),
        },
        { ownerUserId },
    );
};

const confirmOwnerEmail = async (userId: number) => {
    await server.clients.db.write(
        'UPDATE `user` SET `email_confirmed` = ? WHERE `id` = ?',
        [server.clients.db.booleanValue(true), userId],
    );
    const user = await server.stores.user.getById(userId);
    if (user) await server.stores.user.invalidate(user);
};

const makeReq = (init: {
    body?: unknown;
    actor?: Actor;
    query?: Record<string, unknown>;
}): Request => {
    return {
        body: init.body ?? {},
        query: init.query ?? {},
        headers: {},
        actor: init.actor,
    } as unknown as Request;
};

const makeRes = () => {
    const captured: { statusCode: number; body: unknown } = {
        statusCode: 200,
        body: undefined,
    };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

const findRoute = (method: string, path: string) => {
    const route = router.routes.find(
        (r) => r.method === method && r.path === path,
    );
    if (!route) throw new Error(`No ${method.toUpperCase()} ${path} route`);
    return route;
};

const callRoute = async (
    method: string,
    path: string,
    req: Request,
    res: Response,
) => {
    const handler: RequestHandler = findRoute(method, path).handler;
    await handler(req, res, () => {
        throw new Error('handler called next() unexpectedly');
    });
};

const submit = (actor: Actor, body: unknown) => {
    const { res, captured } = makeRes();
    return callRoute('post', '/', makeReq({ body, actor }), res).then(
        () => captured,
    );
};

// ── Route gates ─────────────────────────────────────────────────────

describe('AppFeedbackController route options', () => {
    it('rejects app actors and cross-origin pages on submit', () => {
        const { options } = findRoute('post', '/');
        // requireUserActor is what makes feedback impossible to submit
        // programmatically with an app token; guiOriginOnly keeps
        // cross-origin browser pages out even with a leaked user token.
        expect(options.requireUserActor).toBe(true);
        expect(options.guiOriginOnly).toBe(true);
    });

    it('stacks a per-user budget with a per-IP backstop', () => {
        const { options } = findRoute('post', '/');
        const limits = options.rateLimit;
        expect(Array.isArray(limits)).toBe(true);
        const keys = (limits as Array<{ key?: unknown }>).map((l) => l.key);
        expect(keys).toContain('user');
        expect(keys).toContain('ip');
    });

    it('requires a user actor on the target pre-flight too', () => {
        const { options } = findRoute('get', '/target');
        expect(options.requireUserActor).toBe(true);
    });
});

// ── GET /app-feedback/target ────────────────────────────────────────

describe('AppFeedbackController GET /target', () => {
    it('throws 400 when neither or both of app/origin are given', async () => {
        const { actor } = await makeUser();
        for (const query of [
            {},
            { app: 'x', origin: 'https://x.example.com' },
        ]) {
            const { res } = makeRes();
            await expect(
                callRoute('get', '/target', makeReq({ query, actor }), res),
            ).rejects.toMatchObject({ statusCode: 400 });
        }
    });

    it('reports enabled:false for an unknown app', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/target',
            makeReq({ query: { app: 'no-such-app-xyz' }, actor }),
            res,
        );
        expect(captured.body).toEqual({ enabled: false, app: null });
    });

    it('reports enabled:false for an app that has not opted in', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId);
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/target',
            makeReq({ query: { app: app.name }, actor }),
            res,
        );
        expect(captured.body).toMatchObject({ enabled: false });
    });

    it('reports enabled:true with canonical title/name for an opted-in app', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/target',
            makeReq({ query: { app: app.uid }, actor }),
            res,
        );
        expect(captured.body).toEqual({
            enabled: true,
            app: { name: app.name, title: app.title },
        });
    });

    it('resolves an opted-in app whose name starts with "app-"', async () => {
        const { userId: ownerId } = await makeUser();
        const name = `app-fdbk-${Math.random().toString(36).slice(2, 10)}`;
        const app = await makeApp(ownerId, { feedbackEnabled: true, name });
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/target',
            makeReq({ query: { app: name }, actor }),
            res,
        );
        expect(captured.body).toEqual({
            enabled: true,
            app: { name: app.name, title: app.title },
        });
    });

    it('resolves an origin to the app whose index_url it matches', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const origin = new URL(app.index_url).origin;
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/target',
            makeReq({ query: { origin }, actor }),
            res,
        );
        expect(captured.body).toEqual({
            enabled: true,
            app: { name: app.name, title: app.title },
        });
    });

    it('reports enabled:false for an origin with no registered app', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await callRoute(
            'get',
            '/target',
            makeReq({
                query: { origin: 'https://nobody-registered.example.com' },
                actor,
            }),
            res,
        );
        expect(captured.body).toEqual({ enabled: false, app: null });
    });
});

// ── POST /app-feedback ──────────────────────────────────────────────

describe('AppFeedbackController POST /', () => {
    it('throws 400 when message is missing or not a string', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor } = await makeUser();
        for (const message of [undefined, 12345, '']) {
            await expect(
                submit(actor, { app: app.name, message }),
            ).rejects.toMatchObject({ statusCode: 400 });
        }
    });

    it('throws 400 when both app and origin are given', async () => {
        const { actor } = await makeUser();
        await expect(
            submit(actor, {
                app: 'x',
                origin: 'https://x.example.com',
                message: 'hi',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 403 feedback_not_enabled when the app has not opted in', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId);
        const { actor } = await makeUser();
        await expect(
            submit(actor, { app: app.name, message: 'hi there' }),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'feedback_not_enabled',
        });
    });

    it('throws 403 for an unknown app and an unknown origin alike', async () => {
        const { actor } = await makeUser();
        await expect(
            submit(actor, { app: 'no-such-app-xyz', message: 'hi' }),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            submit(actor, {
                origin: 'https://nobody-registered.example.com',
                message: 'hi',
            }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 400 when the message exceeds the length limit', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor } = await makeUser();
        await expect(
            submit(actor, {
                app: app.name,
                message: 'x'.repeat(
                    AppFeedbackService.MESSAGE_MAX_LENGTH + 1,
                ),
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('stores a normalized row and responds with an empty object', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor, userId } = await makeUser();
        const captured = await submit(actor, {
            app: app.uid,
            message: '  Great\r\napp!   ',
            context: 'app',
        });
        expect(captured.body).toEqual({});

        const rows = (await server.clients.db.read(
            'SELECT * FROM `app_feedback` WHERE `user_id` = ?',
            [userId],
        )) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            app_uid: app.uid,
            message: 'Great\napp!',
            source_env: 'app',
            source_origin: null,
        });
        // Engine-agnostic reads: pg returns BIGINT as string and BOOLEAN as
        // boolean, sqlite returns numbers for both.
        expect(Number(rows[0].app_id)).toBe(app.id);
        expect(Boolean(rows[0].email_sent)).toBe(false);
        expect(typeof rows[0].uid).toBe('string');
        expect(Number.isFinite(Number(rows[0].created_at))).toBe(true);
    });

    it('records the attested origin on web submissions', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const origin = new URL(app.index_url).origin;
        const { actor, userId } = await makeUser();
        await submit(actor, { origin, message: 'from the web', context: 'web' });

        const rows = (await server.clients.db.read(
            'SELECT `source_env`, `source_origin` FROM `app_feedback` WHERE `user_id` = ?',
            [userId],
        )) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            source_env: 'web',
            source_origin: origin,
        });
    });

    it('enforces the per-user-per-app daily cap with 429', async () => {
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor, userId } = await makeUser();
        const since = Math.floor(Date.now() / 1000);
        for (let i = 0; i < AppFeedbackService.PER_USER_APP_DAILY_LIMIT; i++) {
            await server.stores.appFeedback.create({
                appId: app.id,
                appUid: app.uid,
                userId,
                message: `seed ${i}`,
            });
        }
        expect(
            await server.stores.appFeedback.countByUserAndAppSince(
                userId,
                app.id,
                since - 60,
            ),
        ).toBe(AppFeedbackService.PER_USER_APP_DAILY_LIMIT);
        await expect(
            submit(actor, { app: app.name, message: 'one too many' }),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });
    });

    it('enforces the per-user daily cap across apps with 429', async () => {
        const { userId: ownerId } = await makeUser();
        const target = await makeApp(ownerId, { feedbackEnabled: true });
        const other = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor, userId } = await makeUser();
        for (let i = 0; i < AppFeedbackService.PER_USER_DAILY_LIMIT; i++) {
            await server.stores.appFeedback.create({
                appId: other.id,
                appUid: other.uid,
                userId,
                message: `seed ${i}`,
            });
        }
        await expect(
            submit(actor, { app: target.name, message: 'over the limit' }),
        ).rejects.toMatchObject({ statusCode: 429 });
    });
});

// ── Owner email delivery ────────────────────────────────────────────

describe('AppFeedbackService owner email', () => {
    const mockEmailReady = () => {
        vi.spyOn(server.clients.email, 'isConfigured', 'get').mockReturnValue(
            true,
        );
        return vi
            .spyOn(server.clients.email, 'send')
            .mockResolvedValue(undefined);
    };

    it('emails the confirmed owner with the verified sender email + reply-to', async () => {
        const send = mockEmailReady();
        const { userId: ownerId } = await makeUser();
        await confirmOwnerEmail(ownerId);
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor, userId } = await makeUser();
        // A verified sender email is what gets shared and used as reply-to.
        await confirmOwnerEmail(userId);
        const sender = (await server.stores.user.getById(userId))!;

        await submit(actor, { app: app.name, message: 'hello dev' });

        const owner = (await server.stores.user.getById(ownerId))!;
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            owner.email,
            'app-user-feedback',
            expect.objectContaining({
                owner_username: owner.username,
                sender_username: sender.username,
                sender_email: sender.email,
                app_name: app.name,
                message: 'hello dev',
            }),
            expect.objectContaining({ replyTo: sender.email }),
        );

        const rows = (await server.clients.db.read(
            'SELECT `email_sent` FROM `app_feedback` WHERE `user_id` = ?',
            [userId],
        )) as Array<{ email_sent: unknown }>;
        expect(Boolean(rows[0]?.email_sent)).toBe(true);
    });

    it('does not share an unverified sender email (no reply-to)', async () => {
        const send = mockEmailReady();
        const { userId: ownerId } = await makeUser();
        await confirmOwnerEmail(ownerId);
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        // Sender's email is left unverified (makeUser does not confirm it).
        const { actor } = await makeUser();

        await submit(actor, { app: app.name, message: 'hello dev' });

        expect(send).toHaveBeenCalledTimes(1);
        const [, , values, options] = send.mock.calls[0];
        expect((values as Record<string, unknown>).sender_email).toBeNull();
        expect((options as { replyTo?: string } | undefined)?.replyTo).toBeUndefined();
    });

    it('stores but does not email when the owner email is unconfirmed', async () => {
        const send = mockEmailReady();
        const { userId: ownerId } = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor, userId } = await makeUser();

        await submit(actor, { app: app.name, message: 'hello dev' });

        expect(send).not.toHaveBeenCalled();
        const rows = (await server.clients.db.read(
            'SELECT `email_sent` FROM `app_feedback` WHERE `user_id` = ?',
            [userId],
        )) as Array<{ email_sent: unknown }>;
        expect(Boolean(rows[0]?.email_sent)).toBe(false);
    });

    it('suppresses email past the per-app daily cap but still stores', async () => {
        const send = mockEmailReady();
        const { userId: ownerId } = await makeUser();
        await confirmOwnerEmail(ownerId);
        const app = await makeApp(ownerId, { feedbackEnabled: true });

        // Seed the cap with already-emailed rows from other users.
        for (
            let i = 0;
            i < AppFeedbackService.PER_APP_DAILY_EMAIL_LIMIT;
            i++
        ) {
            const { userId: seedUserId } = await makeUser();
            const row = await server.stores.appFeedback.create({
                appId: app.id,
                appUid: app.uid,
                userId: seedUserId,
                message: `seed ${i}`,
            });
            await server.stores.appFeedback.markEmailSent(row.id);
        }

        const { actor, userId } = await makeUser();
        const captured = await submit(actor, {
            app: app.name,
            message: 'past the cap',
        });
        expect(captured.body).toEqual({});
        expect(send).not.toHaveBeenCalled();

        const rows = (await server.clients.db.read(
            'SELECT `email_sent` FROM `app_feedback` WHERE `user_id` = ?',
            [userId],
        )) as Array<{ email_sent: unknown }>;
        expect(rows).toHaveLength(1);
        expect(Boolean(rows[0]?.email_sent)).toBe(false);
    });

    it('a failing email send never fails the request', async () => {
        vi.spyOn(server.clients.email, 'isConfigured', 'get').mockReturnValue(
            true,
        );
        vi.spyOn(server.clients.email, 'send').mockRejectedValue(
            new Error('smtp down'),
        );
        const { userId: ownerId } = await makeUser();
        await confirmOwnerEmail(ownerId);
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const { actor, userId } = await makeUser();

        const captured = await submit(actor, {
            app: app.name,
            message: 'still stored',
        });
        expect(captured.body).toEqual({});
        const rows = (await server.clients.db.read(
            'SELECT `email_sent` FROM `app_feedback` WHERE `user_id` = ?',
            [userId],
        )) as Array<{ email_sent: unknown }>;
        expect(rows).toHaveLength(1);
        expect(Boolean(rows[0]?.email_sent)).toBe(false);
    });
});

// ── Message normalization ───────────────────────────────────────────

describe('AppFeedbackService.normalizeMessage', () => {
    it('unifies newlines, strips control chars, and trims', () => {
        const service = server.services.appFeedback;
        expect(service.normalizeMessage('  a\r\nb\rc   ')).toBe(
            'a\nb\nc',
        );
        expect(service.normalizeMessage('keep\ttabs\nand\nnewlines')).toBe(
            'keep\ttabs\nand\nnewlines',
        );
        expect(service.normalizeMessage('a\u0000b\u0007c\u007F')).toBe('abc');
    });

    it('returns null for non-strings and whitespace-only input', () => {
        const service = server.services.appFeedback;
        expect(service.normalizeMessage(42)).toBeNull();
        expect(service.normalizeMessage('   \n\t  ')).toBeNull();
        expect(service.normalizeMessage(null)).toBeNull();
    });
});
