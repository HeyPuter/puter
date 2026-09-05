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
 * The call that leaves the platform, against a stub standing in for the events
 * dispatcher.
 *
 * What is pinned here is everything on this side of the wire: the internal
 * headers that get an invocation past the dispatcher, the body, the token it
 * carries and what that token is allowed to do, and what each answer does to
 * the delivery — settled, dropped, or held for longer each time until the
 * subscription stops. The runtime on the far side is exercised in
 * `workerRuntime.integration.test.ts`.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    EVENTS_CONSECUTIVE_FAILURES,
    deliveryBackoffMs,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import {
    EVENTS_WORKER_SESSION_NAME,
    eventsInvokeKey,
    eventsWorkerScript,
} from './workerRuntime.js';
import { handlerSetHash } from './workerSource.js';

const BOOT_TIMEOUT_MS = 120_000;
/** Short enough that a hung handler is a test case rather than a stall. */
const INVOKE_TIMEOUT_MS = 300;
const HANDLER = 'ingestUpload';
const INTERNAL_SECRET = 'events-internal-secret';
const SOURCE =
    'async ({ event, ctx }) => { console.log(event.path, ctx.label); }';

interface StubCall {
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body: {
        handler?: string;
        token?: string;
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
/** Whether the stub's answer carries the handled header, as a real one would. */
let answerHandled = true;

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
                headers: {
                    auth: req.headers['x-puter-internal-auth'] as string,
                    script: req.headers['x-puter-events-script'] as string,
                    app: req.headers['x-puter-events-app'] as string,
                    key: req.headers['x-puter-events-key'] as string,
                },
                body: JSON.parse(raw || '{}') as StubCall['body'],
            });
            if (answer === 'hang') return;
            // Stands in for the dispatcher forwarding a genuine answer from
            // the script, so it carries the marker a real one would — unless
            // a test is specifically simulating something that never reached one.
            res.writeHead(
                answer,
                answerHandled ? { 'x-puter-events-handled': '1' } : {},
            ).end();
        });
    });
    await new Promise<void>((resolve) =>
        stub.listen(0, '127.0.0.1', () => resolve()),
    );
    return `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
};

const subscribe = async (token: string = appToken): Promise<string> => {
    const response = await fetch(new URL('/events/subscribe', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
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

/**
 * A second app, isolated from the shared fixture, for tests that revoke or
 * uninstall — so they don't take the rest of the suite's app down with them.
 */
const makeWorkerApp = async (): Promise<{
    appUid: string;
    appToken: string;
    actor: Actor;
}> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, userId],
    );
    const { actor } = await env.server.services.auth.authenticate(
        env.users.user.token,
    );
    await env.server.services.permission.grantUserAppPermission(
        actor!,
        uid,
        `fs:${anchorUid}:list`,
    );
    await env.server.services.permission.grantUserAppPermission(
        actor!,
        uid,
        EVENTS_BACKGROUND_PERMISSION,
    );
    const token = await env.server.services.auth.getUserAppToken(actor!, uid);
    await env.server.stores.eventHandler.publish({
        appUid: uid,
        name: HANDLER,
        source: SOURCE,
    });
    return { appUid: uid, appToken: token, actor: actor! };
};

/** The reused `events:handlers` worker session for (userId, appUid), if any. */
const workerSessionFor = async (forAppUid: string) => {
    const rows = await env.server.stores.session.getByUserId(userId, {
        includeRevoked: true,
    });
    return rows.find(
        (row: {
            kind: string;
            app_uid: string;
            meta?: { worker_name?: string };
        }) =>
            row.kind === 'worker' &&
            row.app_uid === forAppUid &&
            row.meta?.worker_name === EVENTS_WORKER_SESSION_NAME,
    );
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
    // Started first: the dispatcher's address is config, so it has to be known
    // before the server boots.
    calls = [];
    const dispatcherUrl = await startStub();

    env = await setupPuterTestEnv({
        events: {
            enabled: true,
            workerRuntime: true,
            invokeTimeoutMs: INVOKE_TIMEOUT_MS,
            dispatcherUrl,
            internalSecret: INTERNAL_SECRET,
        },
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
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    await env?.shutdown();
});

beforeEach(async () => {
    vi.useRealTimers();
    calls = [];
    answer = 200;
    answerHandled = true;
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
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
        expect(call.path).toBe('/invoke');
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
            // `touch()` calls the service directly, with no request actor in
            // context — an unknown actor is never "self".
            self: false,
        });
    });

    it('gets past the dispatcher with the internal secret and a derived key', async () => {
        await subscribe();

        await touch('headers.txt');
        await invoked(1);

        const { headers } = calls[0];
        expect(headers.auth).toBe(INTERNAL_SECRET);
        expect(headers.app).toBe(appUid);

        const script = eventsWorkerScript(
            handlerSetHash(
                await env.server.stores.eventHandler.setForApp(appUid),
            ),
            // No `workers.internetExposedUrl` in this test's config.
            '',
        );
        expect(headers.script).toBe(script);
        expect(headers.key).toBe(eventsInvokeKey(INTERNAL_SECRET, script));
        // Derived per script, so what reaches a worker is never the secret
        // that reaches the dispatcher.
        expect(headers.key).not.toContain(INTERNAL_SECRET);
    });

    it('carries a token that acts as the app does for the subscriber, not a grant of its own', async () => {
        await subscribe();

        await touch('token.txt');
        await invoked(1);

        const token = calls[0].body.token;
        expect(typeof token).toBe('string');

        const { actor } = await env.server.services.auth.authenticate(token!);
        expect(actor!.user?.id).toBe(userId);
        expect(actor!.effectiveApp?.uid).toBe(appUid);
        // A worker session, the same shape `puter.workers.*` gets — not an
        // access token minted with a one-off set of permissions.
        expect(actor!.session?.kind).toBe('worker');

        const permission = env.server.services.permission;
        await expect(
            permission.check(actor!, `fs:${anchorUid}:list`),
        ).resolves.toBe(true);
        // The app was never granted write on the anchor, so this is still
        // false — but for the ordinary reason (no such grant), not because
        // the token is capped at whatever mode the subscription was made
        // under.
        await expect(
            permission.check(actor!, `fs:${anchorUid}:write`),
        ).resolves.toBe(false);
        // The app's `events:background` grant has nothing to do with this
        // subscription's own anchor, and the token still carries it: it is
        // the app's whole standing for this user, not a slice of it.
        await expect(
            permission.check(actor!, EVENTS_BACKGROUND_PERMISSION),
        ).resolves.toBe(true);

        // No hard expiry: revocable through the session row, like any other
        // worker session, rather than aged out on a timer.
        const decoded = env.server.services.token.verify('auth', token!) as {
            exp?: number;
        };
        expect(decoded.exp).toBeUndefined();
    });

    it('mints the same app identity for a row on the app`s own kv namespace', async () => {
        await subscribeKv('widget');

        const actor = (await env.server.services.auth.authenticate(appToken))
            .actor!;
        await runWithContext({ actor }, () =>
            env.server.drivers.kvStore.set({ key: 'widget', value: 'x' }),
        );
        await invoked(1);

        const token = calls[0].body.token!;
        const tokenActor = (await env.server.services.auth.authenticate(token))
            .actor!;
        expect(tokenActor.effectiveApp?.uid).toBe(appUid);
        // Not scoped to the kv row that triggered this delivery: the same
        // app identity also reaches the anchor an unrelated fs subscription
        // was made under.
        await expect(
            env.server.services.permission.check(
                tokenActor,
                `fs:${anchorUid}:list`,
            ),
        ).resolves.toBe(true);
    });

    it('mints nothing once the background consent is gone', async () => {
        const subId = await subscribe();
        const { actor } = await env.server.services.auth.authenticate(
            env.users.user.token,
        );

        try {
            await env.server.services.permission.revokeUserAppPermission(
                actor!,
                appUid,
                EVENTS_BACKGROUND_PERMISSION,
            );
            // The revocation settle takes the row out of service on its own,
            // but it is a best-effort listener — put the row back so what is
            // under test is the delivery path with the consent already gone.
            await vi.waitFor(async () =>
                expect(
                    (await durable().getBySubId(subId))?.suspendedAt,
                ).not.toBeNull(),
            );
            await env.server.clients.db.write(
                'UPDATE `event_subscriptions` SET `suspended_at` = NULL, ' +
                    '`suspended_reason` = NULL WHERE `sub_id` = ?',
                [subId],
            );
            events().invalidateUser(userId);
            await env.server.stores.eventSubscription.markRegionCold(userId);
            await durable().warmRegion(userId);

            await touch('revoked.txt');
            await vi.waitFor(async () =>
                expect(await pending().depth(subId)).toBe(1),
            );
            await events().sweepPending();

            // Deferred rather than run: nothing was invoked, and the delivery
            // is still owed rather than dropped.
            expect(calls).toEqual([]);
            expect(await pending().depth(subId)).toBe(1);
        } finally {
            await env.server.services.permission.grantUserAppPermission(
                actor!,
                appUid,
                EVENTS_BACKGROUND_PERMISSION,
            );
        }
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

    it('holds a 4xx with no handled marker for retry rather than dropping it', async () => {
        // Nothing said this reached the script — an edge 404, a WAF — so it
        // must not read as the handler's own refusal.
        answer = 404;
        answerHandled = false;
        const subId = await subscribe();

        await touch('unmarked.txt');
        await invoked(1);

        await vi.waitFor(async () =>
            expect(await heldForMs(subId)).toBeGreaterThan(0),
        );
        expect(await pending().depth(subId)).toBe(1);
    });

    it('holds one it could not answer, for longer each time', async () => {
        answer = 500;
        const subId = await subscribe();

        await touch('failing.txt');
        await invoked(1);

        const waits: number[] = [];
        for (
            let attempt = 1;
            attempt < EVENTS_CONSECUTIVE_FAILURES;
            attempt++
        ) {
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

        expect(waits.map((wait) => Math.round(wait / 1000))).toEqual([
            2, 4, 8, 16,
        ]);

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
        for (
            let attempt = 1;
            attempt < EVENTS_CONSECUTIVE_FAILURES;
            attempt++
        ) {
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
        const subId = await subscribe();
        // Unpublished after the fact: the app's set now hashes to nothing, so
        // there is no script to name and nowhere to send the delivery.
        await env.server.stores.eventHandler.remove(appUid, HANDLER);

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
            await env.server.stores.eventHandler.publish({
                appUid,
                name: HANDLER,
                source: SOURCE,
            });
        }
    });

    it('drops the deploy for a suspended owner rather than addressing it', async () => {
        const subId = await subscribe();
        await env.server.clients.db.write(
            'UPDATE user SET suspended = 1 WHERE id = ?',
            [userId],
        );
        await env.server.stores.user.invalidateById(userId);

        try {
            await touch('suspended-owner.txt');
            await vi.waitFor(async () =>
                expect(await heldForMs(subId)).toBeGreaterThan(0),
            );
            expect(await pending().depth(subId)).toBe(1);
            // A suspended owner is nobody to address: nothing was called.
            expect(calls).toEqual([]);
        } finally {
            await env.server.clients.db.write(
                'UPDATE user SET suspended = 0 WHERE id = ?',
                [userId],
            );
            await env.server.stores.user.invalidateById(userId);
        }
    });
});

describe("what withdrawing an app's standing does to its worker session", () => {
    it('revokes the session once background consent is withdrawn', async () => {
        const app = await makeWorkerApp();
        await subscribe(app.appToken);
        await touch('consent-revoked.txt');
        await invoked(1);
        const token = calls[0].body.token!;
        expect((await workerSessionFor(app.appUid))?.revoked_at).toBeNull();

        await env.server.services.permission.revokeUserAppPermission(
            app.actor,
            app.appUid,
            EVENTS_BACKGROUND_PERMISSION,
        );

        await vi.waitFor(async () =>
            expect(
                (await workerSessionFor(app.appUid))?.revoked_at,
            ).not.toBeNull(),
        );
        await expect(
            env.server.services.auth.authenticate(token),
        ).resolves.toMatchObject({
            reauth: { reason: 'session_revoked' },
        });
    });

    it('revokes the session when the app is uninstalled wholesale', async () => {
        const app = await makeWorkerApp();
        await subscribe(app.appToken);
        await touch('uninstalled.txt');
        await invoked(1);
        const token = calls[0].body.token!;
        expect((await workerSessionFor(app.appUid))?.revoked_at).toBeNull();

        await env.server.services.permission.revokeUserAppAll(
            app.actor,
            app.appUid,
        );

        await vi.waitFor(async () =>
            expect(
                (await workerSessionFor(app.appUid))?.revoked_at,
            ).not.toBeNull(),
        );
        await expect(
            env.server.services.auth.authenticate(token),
        ).resolves.toMatchObject({
            reauth: { reason: 'session_revoked' },
        });
    });

    it('leaves the session alone when an unrelated grant is revoked', async () => {
        const app = await makeWorkerApp();
        await subscribe(app.appToken);
        await touch('unrelated-grant.txt');
        await invoked(1);
        const token = calls[0].body.token!;

        await env.server.services.permission.revokeUserAppPermission(
            app.actor,
            app.appUid,
            `fs:${anchorUid}:list`,
        );
        // Best-effort and async — nothing to wait *for* on the "stays alive"
        // side, so give the listener a beat before asserting the negative.
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect((await workerSessionFor(app.appUid))?.revoked_at).toBeNull();
        await expect(
            env.server.services.auth.authenticate(token),
        ).resolves.toMatchObject({ actor: expect.anything() });
    });

    it('mints a fresh session on the next delivery after a re-grant', async () => {
        const app = await makeWorkerApp();
        await subscribe(app.appToken);
        await touch('regrant-before.txt');
        await invoked(1);
        const staleToken = calls[0].body.token!;
        const staleRow = await workerSessionFor(app.appUid);

        await env.server.services.permission.revokeUserAppPermission(
            app.actor,
            app.appUid,
            EVENTS_BACKGROUND_PERMISSION,
        );
        await vi.waitFor(async () =>
            expect(
                (await workerSessionFor(app.appUid))?.revoked_at,
            ).not.toBeNull(),
        );

        await env.server.services.permission.grantUserAppPermission(
            app.actor,
            app.appUid,
            EVENTS_BACKGROUND_PERMISSION,
        );

        // The withdrawn consent settled the durable row along with the
        // session, so a fresh subscribe is needed to get another delivery.
        calls.length = 0;
        await subscribe(app.appToken);
        await touch('regrant-after.txt');
        await invoked(1);

        const freshToken = calls[0].body.token!;
        expect(freshToken).not.toBe(staleToken);
        const freshRow = await workerSessionFor(app.appUid);
        expect(freshRow?.uuid).not.toBe(staleRow?.uuid);
        expect(freshRow?.revoked_at).toBeNull();
        await expect(
            env.server.services.auth.authenticate(freshToken),
        ).resolves.toMatchObject({ actor: expect.anything() });
    });
});
