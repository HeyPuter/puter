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

/**
 * The call that leaves the platform, against a stub standing in for an app's
 * events worker.
 *
 * The worker runtime is not built yet, so what is pinned here is everything on
 * this side of the wire: the body, the token it carries and what that token is
 * allowed to do, and what each answer does to the delivery — settled, dropped,
 * or held for longer each time until the subscription stops.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EVENTS_CONSECUTIVE_FAILURES,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';

const BOOT_TIMEOUT_MS = 120_000;
/** Short enough that a hung handler is a test case rather than a stall. */
const INVOKE_TIMEOUT_MS = 300;
const HANDLER = 'ingestUpload';
const SOURCE = 'async ({ event, ctx }) => { console.log(event.path, ctx.label); }';

interface StubCall {
    method: string;
    path: string;
    auth: string | undefined;
    body: {
        handler?: string;
        event?: Record<string, unknown>;
        ctx?: Record<string, unknown>;
    };
}

let env: PuterTestEnv;
let userId: number;
let anchor: string;
let anchorUid: string;
let appUid: string;
let appToken: string;
let stub: http.Server;
let calls: StubCall[];
/** What the stub answers with, or `hang` for a handler that never does. */
let answer: number | 'hang' = 200;

const events = () => env.server.services.events;
const pending = () => env.server.stores.pendingDelivery;
const durable = () => env.server.stores.durableSubscription;

const readBody = async (req: http.IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
};

const startStub = async (): Promise<string> => {
    stub = http.createServer((req, res) => {
        void readBody(req).then((raw) => {
            calls.push({
                method: req.method ?? '',
                path: req.url ?? '',
                auth: req.headers['puter-auth'] as string | undefined,
                body: JSON.parse(raw || '{}') as StubCall['body'],
            });
            if (answer === 'hang') return;
            res.writeHead(answer).end();
        });
    });
    await new Promise<void>((resolve) =>
        stub.listen(0, '127.0.0.1', () => resolve()),
    );
    return `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
};

const subscribe = async (): Promise<string> => {
    const response = await fetch(new URL('/events/subscribe', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${appToken}`,
        },
        body: JSON.stringify({
            subject: `fs:${anchor}`,
            delivery: 'single',
            handlerName: HANDLER,
            targets: ['worker'],
            context: { label: 'ingest' },
        }),
    });
    const body = (await response.json()) as { subId: string };
    expect(response.status).toBe(200);
    return body.subId;
};

/** A durable KV subscription on the app's own namespace, targeting the worker. */
const subscribeKv = async (key: string): Promise<string> => {
    const response = await fetch(new URL('/events/subscribe', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${appToken}`,
        },
        body: JSON.stringify({
            subject: `kv:${key}`,
            delivery: 'single',
            handlerName: HANDLER,
            targets: ['worker'],
        }),
    });
    const body = (await response.json()) as { subId: string };
    expect(response.status).toBe(200);
    return body.subId;
};

/** One write under the anchor, which is one delivery owed to the handler. */
const touch = async (name: string): Promise<void> => {
    await env.server.services.fs.touch(userId, { path: `${anchor}/${name}` });
};

const invoked = (count: number): Promise<void> =>
    vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(count), {
        timeout: 5_000,
        interval: 25,
    });

/** Move time past whatever the failed delivery is being held for. */
const jump = (ms: number): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + ms);
};

/** How much longer the one in-flight delivery is being held. */
const heldForMs = async (subId: string): Promise<number> => {
    const [, score] = await env.server.clients.redis.zrange(
        `ev:ql:{${subId}}`,
        0,
        0,
        'WITHSCORES',
    );
    return Number(score) - Date.now();
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, invokeTimeoutMs: INVOKE_TIMEOUT_MS },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        unlimitedMetering: true,
    } as IConfig);

    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    anchor = `/${env.users.user.username}/invoker`;
    await env.server.services.fs.mkdir(userId, {
        path: anchor,
        createMissingParents: true,
    });
    anchorUid = (await env.server.stores.fsEntry.getEntryByPath(anchor))!.uid;

    appUid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [appUid, appUid, appUid, `https://${appUid}.example/`, userId],
    );
    const { actor } = await env.server.services.auth.authenticate(
        env.users.user.token,
    );
    await env.server.services.permission.grantUserAppPermission(
        actor!,
        appUid,
        `fs:${anchorUid}:list`,
    );
    await env.server.services.permission.grantUserAppPermission(
        actor!,
        appUid,
        EVENTS_BACKGROUND_PERMISSION,
    );
    appToken = await env.server.services.auth.getUserAppToken(actor!, appUid);
    await env.server.stores.eventHandler.publish({
        appUid,
        name: HANDLER,
        source: SOURCE,
    });

    calls = [];
    const origin = await startStub();
    env.server.clients.eventsWorkerInvoker.setResolver({
        resolveInvokeUrl: () => Promise.resolve(origin),
    });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    await env?.shutdown();
});

beforeEach(async () => {
    vi.useRealTimers();
    calls = [];
    answer = 200;
    await env.server.clients.db.write(
        'DELETE FROM `event_subscriptions`',
        [],
    );
    events().invalidateUser(userId);
    await env.server.stores.eventSubscription.markRegionCold(userId);
    await durable().warmRegion(userId);
});

describe('the call an owed delivery makes', () => {
    it('posts the handler, the event and the context to the app`s worker', async () => {
        await subscribe();

        await touch('note.txt');
        await invoked(1);

        const call = calls[0];
        expect(call.method).toBe('POST');
        expect(call.path).toBe('/__events/invoke');
        expect(call.body.handler).toBe(HANDLER);
        expect(call.body.ctx).toEqual({ label: 'ingest' });
        expect(Object.keys(call.body.event ?? {}).sort()).toEqual([
            'id',
            'op',
            'path',
            'self',
            'seq',
            'subject',
            'ts',
            'uid',
        ]);
        expect(call.body.event).toMatchObject({
            path: `${anchor}/note.txt`,
            self: true,
        });
    });

    it('carries a token that is the subscriber, the app, and nothing wider', async () => {
        await subscribe();

        await touch('token.txt');
        await invoked(1);

        const token = calls[0].auth;
        expect(typeof token).toBe('string');

        const { actor } = await env.server.services.auth.authenticate(token!);
        expect(actor!.user?.id).toBe(userId);
        expect(actor!.effectiveApp?.uid).toBe(appUid);

        const permission = env.server.services.permission;
        await expect(
            permission.check(actor!, `fs:${anchorUid}:list`),
        ).resolves.toBe(true);
        // The subscription was made under `list`, so the token stops there —
        // even though the account it acts for owns the folder outright.
        await expect(
            permission.check(actor!, `fs:${anchorUid}:write`),
        ).resolves.toBe(false);

        const decoded = env.server.services.token.verify('auth', token!) as {
            exp: number;
            iat: number;
        };
        expect(decoded.exp - decoded.iat).toBe(5 * 60);
    });

    it('mints no extra grant for a row on the app`s own kv namespace', async () => {
        // The app already holds `fs:${anchorUid}:list` at the account level
        // (see `beforeAll`) — proof, below, that a kv delivery's token cannot
        // spend a grant the app holds for a different reason entirely.
        await subscribeKv('widget');

        const actor = (await env.server.services.auth.authenticate(appToken))
            .actor!;
        await runWithContext({ actor }, () =>
            env.server.drivers.kvStore.set({ key: 'widget', value: 'x' }),
        );
        await invoked(1);

        const token = calls[0].auth!;
        const decoded = env.server.services.token.verify('auth', token) as {
            token_uid: string;
        };
        const rows = await env.server.clients.db.read(
            'SELECT `permission` FROM `access_token_permissions` WHERE `token_uid` = ?',
            [decoded.token_uid],
        );
        // Own-namespace kv has no grant behind it: nothing was minted at all.
        expect(rows).toEqual([]);

        const tokenActor = (
            await env.server.services.auth.authenticate(token)
        ).actor!;
        expect(tokenActor.effectiveApp?.uid).toBe(appUid);
        await expect(
            env.server.services.permission.check(
                tokenActor,
                `fs:${anchorUid}:list`,
            ),
        ).resolves.toBe(false);
    });

    it('settles the delivery when the handler takes it', async () => {
        const subId = await subscribe();

        await touch('settled.txt');
        await invoked(1);

        await vi.waitFor(async () =>
            expect(await pending().depth(subId)).toBe(0),
        );
    });
});

describe('what each answer does to the delivery', () => {
    it('drops one the handler refused, and says so with a gap marker', async () => {
        answer = 400;
        const subId = await subscribe();

        await touch('refused.txt');
        await invoked(1);

        // The event is gone and a marker stands in its place, so the
        // subscription learns there was one rather than reading silence.
        await vi.waitFor(async () =>
            expect(await pending().depth(subId)).toBe(1),
        );
        answer = 200;
        const claimed = await pending().claim(subId, { leaseMs: 0 });
        expect(claimed?.event).toMatchObject({
            op: 'gap',
            reason: 'handler_rejected',
        });
        // It counted: a refusal is still a handler that did not work.
        await expect(
            env.server.clients.redis.get(`ev:qf:{${subId}}`),
        ).resolves.toBe('1');
    });

    it('holds one it could not answer, for longer each time', async () => {
        answer = 500;
        const subId = await subscribe();

        await touch('failing.txt');
        await invoked(1);

        const waits: number[] = [];
        for (let attempt = 1; attempt < EVENTS_CONSECUTIVE_FAILURES; attempt++) {
            await vi.waitFor(async () =>
                expect(await heldForMs(subId)).toBeGreaterThan(0),
            );
            waits.push(await heldForMs(subId));

            // Nothing may take it while it is held.
            await events().sweepPending();
            expect(calls).toHaveLength(attempt);

            jump(deliveryBackoffMs(attempt) + 50);
            await events().sweepPending();
            await invoked(attempt + 1);
        }

        expect(waits.map((wait) => Math.round(wait / 1000))).toEqual([2, 4, 8, 16]);

        // The fifth failure in a row is the one that stops it.
        await vi.waitFor(async () =>
            expect((await durable().getBySubId(subId))?.suspendedReason).toBe(
                'failures',
            ),
        );
        expect(calls).toHaveLength(EVENTS_CONSECUTIVE_FAILURES);
    });

    it('tells the developer their handler stopped working', async () => {
        answer = 503;
        const notify = vi.spyOn(env.server.services.notification, 'notify');
        const subId = await subscribe();

        await touch('notified.txt');
        for (let attempt = 1; attempt < EVENTS_CONSECUTIVE_FAILURES; attempt++) {
            await invoked(attempt);
            jump(deliveryBackoffMs(attempt) + 50);
            await events().sweepPending();
        }

        await vi.waitFor(() =>
            expect(notify).toHaveBeenCalledWith(
                [userId],
                expect.objectContaining({ handler: HANDLER }),
                expect.objectContaining({ type: 'app.events.suspended' }),
            ),
        );
        expect((await durable().getBySubId(subId))?.suspendedAt).not.toBeNull();
        notify.mockRestore();
    });

    it('takes a handler that never answers as one that could not', async () => {
        answer = 'hang';
        const subId = await subscribe();

        await touch('hanging.txt');
        await invoked(1);

        // Still owed, and held rather than dropped: nobody said no.
        await vi.waitFor(async () =>
            expect(await heldForMs(subId)).toBeGreaterThan(0),
        );
        expect(await pending().depth(subId)).toBe(1);
        answer = 200;
    });

    it('takes a handler that is too busy as one that could not', async () => {
        answer = 429;
        const subId = await subscribe();

        await touch('busy.txt');
        await invoked(1);

        await vi.waitFor(async () =>
            expect(await heldForMs(subId)).toBeGreaterThan(0),
        );
        expect(await pending().depth(subId)).toBe(1);
    });
});

describe('with no events worker to address', () => {
    it('counts the same as a handler that could not answer', async () => {
        env.server.clients.eventsWorkerInvoker.setResolver({
            resolveInvokeUrl: () => Promise.resolve(null),
        });
        const subId = await subscribe();

        try {
            await touch('unresolved.txt');
            for (
                let attempt = 1;
                attempt < EVENTS_CONSECUTIVE_FAILURES;
                attempt++
            ) {
                await vi.waitFor(async () =>
                    expect(await heldForMs(subId)).toBeGreaterThan(0),
                );
                jump(deliveryBackoffMs(attempt) + 50);
                await events().sweepPending();
            }

            await vi.waitFor(async () =>
                expect(
                    (await durable().getBySubId(subId))?.suspendedReason,
                ).toBe('failures'),
            );
            // Nothing was ever called: there was nowhere to call.
            expect(calls).toEqual([]);
        } finally {
            const origin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
            env.server.clients.eventsWorkerInvoker.setResolver({
                resolveInvokeUrl: () => Promise.resolve(origin),
            });
        }
    });
});
