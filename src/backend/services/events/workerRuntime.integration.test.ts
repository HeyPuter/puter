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
 * The events worker runtime, end to end and with nothing stubbed: publishing
 * handlers deploys a real worker through the local worker backend, a write
 * under a watched folder is claimed, invoked over HTTP, executed inside the
 * worker runtime, and the answer settles (or fails) the lease.
 *
 * The observable side effect is the design's own example — the handler calls
 * `fetch(ctx.endpoint, …)` — because that is what a delivered token's
 * environment can always do. The handler also reports the token it ran as, so
 * the suite can pin, server-side, that what reached the worker is the
 * subscriber scoped to exactly the subscription's grant. (The general FS/KV
 * HTTP routes still refuse access tokens — `allowAccessToken` is per-route —
 * so in-worker `user.fs`/`user.kv` calls are a surface still to be opened,
 * not something this suite can assert yet.)
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
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { EVENTS_WORKER_FILE_PREFIX } from './workerSource.js';

const BOOT_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 60_000;
/** Long enough for a cold dispatch, short enough to test the timeout path. */
const INVOKE_TIMEOUT_MS = 3_000;

interface SinkPost {
    kind: string;
    path?: string;
    label?: string;
    token?: string;
}

const INGEST_SOURCE = `async ({ event, ctx, user, fetch, ack }) => {
    await fetch(ctx.sink, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            kind: 'ingest',
            path: event.path,
            label: ctx.label,
            token: user.authToken,
        }),
    });
    await ack();
}`;
const EXPLODE_SOURCE = "async () => { throw new Error('boom'); }";
// A hang with real pending I/O — the runtime fails a promise with none —
// so the invoker's timeout is the only thing that can end the attempt.
const SLEEPY_SOURCE = 'async ({ ctx, fetch }) => { await fetch(ctx.hang); }';

let env: PuterTestEnv;
let userId: number;
let anchor: string;
let anchorUid: string;
let appUid: string;
let appToken: string;
let workerName: string;
let workerUrl: string;
let sink: http.Server;
let sinkUrl: string;
let sinkPosts: SinkPost[];
let workerCreates: number;

const events = () => env.server.services.events;
const pending = () => env.server.stores.pendingDelivery;
const durable = () => env.server.stores.durableSubscription;
const subdomainRow = () =>
    env.server.stores.subdomain.getBySubdomain(`workers.puter.${workerName}`);

const readBody = async (req: http.IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
};

const startSink = async (): Promise<string> => {
    sink = http.createServer((req, res) => {
        // `/hang` never answers — what a handler that outlives its invocation
        // window is made of.
        if (req.url === '/hang') return;
        void readBody(req).then((raw) => {
            sinkPosts.push(JSON.parse(raw || '{}') as SinkPost);
            res.writeHead(200).end();
        });
    });
    await new Promise<void>((resolve) =>
        sink.listen(0, '127.0.0.1', () => resolve()),
    );
    return `http://127.0.0.1:${(sink.address() as AddressInfo).port}`;
};

const api = async (
    method: 'GET' | 'POST',
    path: string,
    body?: object,
): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(new URL(path, env.apiOrigin), {
        method,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${appToken}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
    };
};

const subscribe = async (
    handlerName: string,
    context?: object,
): Promise<string> => {
    const response = await api('POST', '/events/subscribe', {
        subject: `fs:${anchor}`,
        delivery: 'single',
        handlerName,
        targets: ['worker'],
        ...(context ? { context } : {}),
    });
    expect(response.status).toBe(200);
    return String(response.body.subId);
};

const touch = (name: string): Promise<unknown> =>
    env.server.services.fs.touch(userId, { path: `${anchor}/${name}` });

const invokeDirect = (
    body: string,
    headers: Record<string, string> = {},
): Promise<Response> =>
    fetch(`${workerUrl}/__events/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
    });

/** Move time past whatever a failed delivery is being held for. */
const jump = (ms: number): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + ms);
};

const heldForMs = async (subId: string): Promise<number> => {
    const [, score] = await env.server.clients.redis.zrange(
        `ev:ql:{${subId}}`,
        0,
        0,
        'WITHSCORES',
    );
    return Number(score) - Date.now();
};

/** Consecutive failures recorded against a subscription's handler. */
const failuresOf = async (subId: string): Promise<number> =>
    Number((await env.server.clients.redis.get(`ev:qf:{${subId}}`)) ?? 0);

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: {
            enabled: true,
            workerRuntime: true,
            invokeTimeoutMs: INVOKE_TIMEOUT_MS,
        },
        workers: { localServer: true },
        unlimitedMetering: true,
    } as IConfig);

    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    anchor = `/${env.users.user.username}/evw-e2e`;
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

    sinkPosts = [];
    sinkUrl = await startSink();

    // Anything pricing workers keys off this announcement; count it.
    workerCreates = 0;
    env.server.clients.event.on('worker.create', () => {
        workerCreates++;
    });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await new Promise<void>((resolve) => {
        if (!sink) return resolve();
        // `/hang` connections never finish on their own.
        sink.closeAllConnections();
        sink.close(() => resolve());
    });
    await env?.shutdown();
});

beforeEach(async () => {
    vi.useRealTimers();
    sinkPosts = [];
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    events().invalidateUser(userId);
    await env.server.stores.eventSubscription.markRegionCold(userId);
    await durable().warmRegion(userId);
});

describe('publishing deploys the events worker', () => {
    it(
        'bakes the published set into one worker per app, through the normal deploy path',
        { timeout: BOOT_TIMEOUT_MS },
        async () => {
            const response = await api('POST', '/events/handlers/publishAll', {
                handlers: [
                    { name: 'ingest', source: INGEST_SOURCE },
                    { name: 'explode', source: EXPLODE_SOURCE },
                    { name: 'sleepy', source: SLEEPY_SOURCE },
                ],
            });
            expect(response.status).toBe(200);

            const worker = response.body.worker as Record<string, unknown>;
            expect(worker.action).toBe('deployed');
            workerName = String(worker.workerName);
            expect(workerName).toMatch(/^evw-[a-f0-9]{40}$/);
            workerUrl = String(worker.url);
            expect(workerUrl).toContain(`${workerName}.workers.puter.localhost`);

            // A real row in the workers registry, bound to a generated
            // artifact in the owner's app data — the shape every worker
            // consumer (rehydration, pricing) already reads.
            const row = await subdomainRow();
            expect(row).toBeTruthy();
            expect(Number(row!.user_id)).toBe(userId);
            const artifact = await env.server.stores.fsEntry.getEntryById(
                Number(row!.root_dir_id),
            );
            expect(artifact!.path).toContain(
                `/AppData/${appUid}/${EVENTS_WORKER_FILE_PREFIX}`,
            );

            // The pricing signal an ordinary first deploy emits — once.
            expect(workerCreates).toBe(1);
        },
    );

    it(
        'publishing the same set again deploys nothing',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const before = await subdomainRow();
            const response = await api('POST', '/events/handlers/publishAll', {
                handlers: [
                    { name: 'ingest', source: INGEST_SOURCE },
                    { name: 'explode', source: EXPLODE_SOURCE },
                    { name: 'sleepy', source: SLEEPY_SOURCE },
                ],
            });

            expect(
                (response.body.worker as Record<string, unknown>).action,
            ).toBe('none');
            const after = await subdomainRow();
            expect(Number(after!.root_dir_id)).toBe(
                Number(before!.root_dir_id),
            );
            expect(workerCreates).toBe(1);
        },
    );

    it(
        'the worker answers the invoke contract and nothing else',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            // No delivery token: nothing to run the handler as.
            const unauthenticated = await invokeDirect(
                JSON.stringify({ handler: 'ingest' }),
            );
            expect(unauthenticated.status).toBe(401);

            // Unknown name: terminal, the same body cannot do better.
            const unknown = await invokeDirect(
                JSON.stringify({ handler: 'nope' }),
                { 'puter-auth': 'irrelevant' },
            );
            expect(unknown.status).toBe(404);

            const garbage = await invokeDirect('not json', {
                'puter-auth': 'irrelevant',
            });
            expect(garbage.status).toBe(400);

            // A throw inside the real handler comes back as the retriable
            // class, carrying the handler's own words.
            const thrown = await invokeDirect(
                JSON.stringify({ handler: 'explode' }),
                { 'puter-auth': 'irrelevant' },
            );
            expect(thrown.status).toBe(500);
            expect(await thrown.json()).toEqual({ error: 'boom' });

            // The reserved route is the only one registered.
            const stray = await fetch(`${workerUrl}/anything`, {
                method: 'POST',
            });
            expect(stray.status).toBe(404);
        },
    );
});

describe('single delivery through the real worker', () => {
    it(
        'runs the handler, observes its side effect, and settles the lease',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const subId = await subscribe('ingest', {
                sink: sinkUrl,
                label: 'e2e',
            });

            await touch('note.txt');

            await vi.waitFor(
                () => expect(sinkPosts.length).toBeGreaterThanOrEqual(1),
                { timeout: 20_000, interval: 50 },
            );
            expect(sinkPosts[0]).toMatchObject({
                kind: 'ingest',
                path: `${anchor}/note.txt`,
                label: 'e2e',
            });

            // 2xx settled the lease: nothing owed, nothing redelivered.
            await vi.waitFor(async () =>
                expect(await pending().depth(subId)).toBe(0),
            );
            await events().sweepPending();
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(sinkPosts).toHaveLength(1);
        },
    );

    it(
        'hands the handler the subscriber, scoped to the grant and no further',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            await subscribe('ingest', { sink: sinkUrl, label: 'scope' });
            await touch('scoped.txt');
            await vi.waitFor(
                () => expect(sinkPosts.length).toBeGreaterThanOrEqual(1),
                { timeout: 20_000, interval: 50 },
            );

            // What the handler actually ran as, reported from inside the
            // worker rather than captured off a stub.
            const token = sinkPosts[0].token;
            expect(typeof token).toBe('string');

            const { actor } = await env.server.services.auth.authenticate(
                token!,
            );
            expect(actor!.user?.id).toBe(userId);
            expect(actor!.effectiveApp?.uid).toBe(appUid);

            const permission = env.server.services.permission;
            await expect(
                permission.check(actor!, `fs:${anchorUid}:list`),
            ).resolves.toBe(true);
            // The account owns the folder outright; the delivery does not.
            await expect(
                permission.check(actor!, `fs:${anchorUid}:write`),
            ).resolves.toBe(false);

            const decoded = env.server.services.token.verify(
                'auth',
                token!,
            ) as { exp: number; iat: number };
            expect(decoded.exp - decoded.iat).toBe(5 * 60);
        },
    );

    it(
        'a handler that throws is retried, then the subscription suspends',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const subId = await subscribe('explode');

            await touch('failing.txt');

            for (
                let attempt = 1;
                attempt < EVENTS_CONSECUTIVE_FAILURES;
                attempt++
            ) {
                // The worker's 500 came back and was recorded — not merely
                // claimed and still in flight.
                await vi.waitFor(
                    async () => expect(await failuresOf(subId)).toBe(attempt),
                    { timeout: 20_000, interval: 50 },
                );
                expect(await pending().depth(subId)).toBe(1);
                jump(deliveryBackoffMs(attempt) + 50);
                await events().sweepPending();
            }

            await vi.waitFor(
                async () =>
                    expect(
                        (await durable().getBySubId(subId))?.suspendedReason,
                    ).toBe('failures'),
                { timeout: 20_000, interval: 50 },
            );
        },
    );

    it(
        'a handler that never answers times out into a retry, not an ack',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const subId = await subscribe('sleepy', {
                hang: `${sinkUrl}/hang`,
            });

            const started = Date.now();
            await touch('hanging.txt');

            // Only the invoke timeout can record this failure — the handler
            // never answers — so reaching 1 is the timeout path itself.
            await vi.waitFor(
                async () => expect(await failuresOf(subId)).toBe(1),
                { timeout: 30_000, interval: 100 },
            );
            expect(Date.now() - started).toBeGreaterThanOrEqual(
                INVOKE_TIMEOUT_MS - 100,
            );
            // Still owed, and re-held for the failure backoff rather than the
            // fresh 30-second claim lease it started under.
            const held = await heldForMs(subId);
            expect(held).toBeGreaterThan(0);
            expect(held).toBeLessThan(25_000);
            expect(await pending().depth(subId)).toBe(1);
            expect(sinkPosts).toHaveLength(0);
        },
    );
});

describe('the worker follows the handler set', () => {
    it(
        'republishing changed source redeploys without a second creation announcement',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const before = await subdomainRow();
            const changed = INGEST_SOURCE.replace(
                "kind: 'ingest'",
                "kind: 'ingest-v2'",
            );
            const response = await api('POST', '/events/handlers/publish', {
                name: 'ingest',
                source: changed,
                replace: true,
            });
            expect(response.status).toBe(200);
            expect(
                (response.body.worker as Record<string, unknown>).action,
            ).toBe('deployed');

            const after = await subdomainRow();
            expect(Number(after!.root_dir_id)).not.toBe(
                Number(before!.root_dir_id),
            );
            // The superseded artifact is gone along with its binding.
            expect(
                await env.server.stores.fsEntry.getEntryById(
                    Number(before!.root_dir_id),
                ),
            ).toBeFalsy();
            // Redeploys are not new workers: no second pricing announcement.
            expect(workerCreates).toBe(1);

            const subId = await subscribe('ingest', {
                sink: sinkUrl,
                label: 'v2',
            });
            await touch('after-republish.txt');
            await vi.waitFor(
                () => expect(sinkPosts.length).toBeGreaterThanOrEqual(1),
                { timeout: 20_000, interval: 50 },
            );
            expect(sinkPosts[0].kind).toBe('ingest-v2');
            await vi.waitFor(async () =>
                expect(await pending().depth(subId)).toBe(0),
            );
        },
    );

    it(
        'removing the last handler tears the worker down',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            for (const name of ['ingest', 'explode']) {
                const removed = await api('POST', '/events/handlers/remove', {
                    name,
                });
                expect(
                    (removed.body.worker as Record<string, unknown>).action,
                ).toBe('deployed');
            }

            const beforeLast = await subdomainRow();
            const artifactId = Number(beforeLast!.root_dir_id);

            const last = await api('POST', '/events/handlers/remove', {
                name: 'sleepy',
            });
            expect((last.body.worker as Record<string, unknown>).action).toBe(
                'removed',
            );

            expect(await subdomainRow()).toBeFalsy();
            expect(
                await env.server.stores.fsEntry.getEntryById(artifactId),
            ).toBeFalsy();
        },
    );
});
