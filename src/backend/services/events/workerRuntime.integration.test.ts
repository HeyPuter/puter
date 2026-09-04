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
 * writes rows and deploys nothing, the first delivery brings the script up in
 * the local worker backend, and the handler runs inside it with the arguments
 * the invocation carried and no ambient token of its own.
 *
 * The observable side effect is the design's own example — the handler calls
 * `fetch(ctx.sink, …)` — because that is what a delivered token's environment
 * can always do. The handler also reports the token it ran as and what the
 * isolate left lying around, so the suite can pin, from inside the worker, that
 * a handler is the subscriber and nothing more.
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
import { EVENTS_INVOKE_PATH } from '../../clients/events/EventsWorkerInvokerClient.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { eventsInvokeKey, eventsWorkerScript } from './workerRuntime.js';
import { handlerSetHash } from './workerSource.js';

const BOOT_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 60_000;
/** Long enough for a cold deploy, short enough to test the timeout path. */
const INVOKE_TIMEOUT_MS = 20_000;
const INTERNAL_SECRET = 'events-internal-secret';

interface SinkPost {
    kind: string;
    path?: string;
    label?: string;
    token?: string;
    /** What the isolate exposes to handler code, reported from inside it. */
    ambient?: Record<string, string>;
    /** What `user.fs.stat(event.path)` answered, or the error it raised. */
    stat?: { name?: string; error?: string };
}

const INGEST_SOURCE = `async ({ event, ctx, user, fetch, ack }) => {
    // The design's own example: the handler looks the changed node up as the
    // subscriber, through the token the delivery carried.
    const stat = event.path
        ? await user.fs.stat(event.path).then(
              (entry) => ({ name: entry.name }),
              (err) => ({ error: String(err && err.code || err) }),
          )
        : undefined;
    await fetch(ctx.sink, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            kind: ctx.kind || 'ingest',
            path: event.path,
            label: ctx.label,
            stat,
            token: user.authToken,
            ambient: {
                me: typeof me,
                router: typeof router,
                puterAuth: typeof puter_auth,
                invokeKey: typeof events_invoke_key,
            },
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
let sink: http.Server;
let sinkUrl: string;
let sinkPosts: SinkPost[];
let workerCreates: number;

const events = () => env.server.services.events;
const pending = () => env.server.stores.pendingDelivery;
const durable = () => env.server.stores.durableSubscription;
const localWorkers = () => env.server.services.localworkerservice;

/** The script the app's published set currently deploys as. */
const scriptName = async (): Promise<string> =>
    eventsWorkerScript(
        handlerSetHash(await env.server.stores.eventHandler.setForApp(appUid)),
    );

/** Whether that script is up in the local worker backend. */
const isResident = async (script: string): Promise<boolean> =>
    (await localWorkers().dispatchEventsWorker(
        new Request(`http://${script}.workers.puter.localhost/`, {
            method: 'GET',
        }),
    )) !== null;

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

const publishAll = (
    handlers: { name: string; source: string }[],
): Promise<{ status: number; body: Record<string, unknown> }> =>
    api('POST', '/events/handlers/publishAll', { handlers });

/** What the events dispatcher calls when a script is not in its namespace. */
const rehydrate = async (
    body: object,
    secret: string | null = INTERNAL_SECRET,
): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(
        new URL('/events/worker/rehydrate', env.apiOrigin),
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(secret === null ? {} : { 'x-puter-internal-auth': secret }),
            },
            body: JSON.stringify(body),
        },
    );
    return {
        status: response.status,
        body: (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
        >,
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

const delivered = (count = 1): Promise<void> =>
    vi.waitFor(() => expect(sinkPosts.length).toBeGreaterThanOrEqual(count), {
        timeout: 30_000,
        interval: 50,
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
            internalSecret: INTERNAL_SECRET,
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

    // Whatever prices ordinary workers keys off this announcement; count it.
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

describe('publishing handlers', () => {
    it(
        'writes rows and deploys nothing',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const response = await publishAll([
                { name: 'ingest', source: INGEST_SOURCE },
                { name: 'explode', source: EXPLODE_SOURCE },
                { name: 'sleepy', source: SLEEPY_SOURCE },
            ]);
            expect(response.status).toBe(200);
            // The response says what was published, and nothing about workers:
            // a publish is a database write, on nobody's deploy path.
            expect(Object.keys(response.body)).toEqual(['handlers']);

            const script = await scriptName();
            expect(script).toMatch(/^evw-[a-f0-9]{32}$/);
            expect(await isResident(script)).toBe(false);
        },
    );

    it(
        'claims no worker of the owner`s, under any name',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const script = await scriptName();
            // No registry row: not addressable at a worker subdomain, not
            // listable, and not deletable as though it were the owner's.
            expect(
                await env.server.stores.subdomain.getBySubdomain(
                    `workers.puter.${script}`,
                ),
            ).toBeFalsy();
            const { actor } = await env.server.services.auth.authenticate(
                env.users.user.token,
            );
            const listed = (await runWithContext({ actor: actor! }, () =>
                env.server.drivers.workers.getFilePaths({
                    workerName: script,
                }),
            )) as unknown[];
            expect(listed).toEqual([]);
            // And so nothing that prices worker creations was ever told.
            expect(workerCreates).toBe(0);
        },
    );
});

describe('single delivery through the real worker', () => {
    it(
        'deploys on the first delivery, runs the handler, and settles the lease',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const script = await scriptName();
            expect(await isResident(script)).toBe(false);

            const subId = await subscribe('ingest', {
                sink: sinkUrl,
                label: 'e2e',
            });
            await touch('note.txt');
            await delivered();

            expect(sinkPosts[0]).toMatchObject({
                kind: 'ingest',
                path: `${anchor}/note.txt`,
                label: 'e2e',
            });
            // The delivery itself is what brought the script up.
            expect(await isResident(script)).toBe(true);

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
            await delivered();

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

            // And that token gets through the API: the read routes admit it,
            // and the ACL lets it see what the subscription could list.
            expect(sinkPosts[0].stat).toEqual({ name: 'scoped.txt' });
        },
    );

    it(
        'runs it in an isolate with no token and no router of its own',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            await subscribe('ingest', { sink: sinkUrl, label: 'ambient' });
            await touch('ambient.txt');
            await delivered();

            // The owner's worker token, the `me` built from it, and the router
            // that would let handler code answer anything else: none of them
            // exist in an events worker.
            expect(sinkPosts[0].ambient).toEqual({
                me: 'undefined',
                router: 'undefined',
                puterAuth: 'undefined',
                // Read once by the runtime and dropped before handler code ran.
                invokeKey: 'undefined',
            });
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
                    { timeout: 30_000, interval: 50 },
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
                { timeout: 30_000, interval: 50 },
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
                { timeout: 40_000, interval: 100 },
            );
            expect(Date.now() - started).toBeGreaterThanOrEqual(
                INVOKE_TIMEOUT_MS - 100,
            );
            // Still owed, and re-held for the failure backoff rather than the
            // fresh claim lease it started under.
            const held = await heldForMs(subId);
            expect(held).toBeGreaterThan(0);
            expect(await pending().depth(subId)).toBe(1);
            expect(sinkPosts).toHaveLength(0);
        },
    );
});

describe('what can reach a deployed events worker', () => {
    it(
        'nothing on the worker domain, and nothing without the invoke key',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const script = await scriptName();
            await subscribe('ingest', { sink: sinkUrl });
            await touch('reachable.txt');
            await delivered();
            expect(await isResident(script)).toBe(true);

            // The host an ordinary worker answers on resolves through the
            // registry, and an events worker has no row in it.
            const overHttp = await fetch(
                new URL(EVENTS_INVOKE_PATH, env.apiOrigin),
                {
                    method: 'POST',
                    headers: {
                        host: `${script}.workers.puter.localhost`,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({ handler: 'ingest' }),
                },
            );
            expect(overHttp.status).toBe(404);

            const invokeWith = async (
                key: string,
            ): Promise<number | undefined> =>
                (
                    await localWorkers().dispatchEventsWorker(
                        new Request(
                            `http://${script}.workers.puter.localhost${EVENTS_INVOKE_PATH}`,
                            {
                                method: 'POST',
                                headers: {
                                    'content-type': 'application/json',
                                    'x-puter-events-key': key,
                                },
                                body: JSON.stringify({
                                    handler: 'ingest',
                                    token: 'stolen',
                                    event: { path: 'direct' },
                                    ctx: { sink: sinkUrl, kind: 'direct' },
                                }),
                            },
                        ),
                    )
                )?.status;

            // Reaching the isolate is not enough: without the derived key the
            // handler does not run, and the answer stays retriable.
            expect(await invokeWith('')).toBe(500);
            expect(await invokeWith('k1:guessed')).toBe(500);
            expect(sinkPosts).toHaveLength(1);

            // With it, the same call runs — the key is the whole difference.
            expect(
                await invokeWith(eventsInvokeKey(INTERNAL_SECRET, script)),
            ).toBe(200);
            expect(sinkPosts).toHaveLength(2);
            expect(sinkPosts[1].kind).toBe('direct');
        },
    );
});

describe('the deploy a dispatcher asks for', () => {
    it(
        'is refused without the internal secret',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            // A published set nothing has delivered for yet: the script it
            // names is not deployed anywhere.
            expect(
                (
                    await api('POST', '/events/handlers/publish', {
                        name: 'noop',
                        source: 'async ({ ack }) => { await ack(); }',
                    })
                ).status,
            ).toBe(200);
            const script = await scriptName();
            expect(await isResident(script)).toBe(false);

            for (const secret of [null, '', 'wrong-secret'])
                expect(
                    (await rehydrate({ script, appUid }, secret)).status,
                ).toBe(403);
            expect(await isResident(script)).toBe(false);
        },
    );

    it(
        'answers only for a script the app`s handlers currently name',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            expect(
                (await rehydrate({ script: 'not-a-script', appUid })).status,
            ).toBe(400);

            // Well-formed, but not what this app's set hashes to: nothing to
            // bring back, and no reason for the caller to retry.
            const stale = await rehydrate({
                script: `evw-${'0'.repeat(32)}`,
                appUid,
            });
            expect(stale.status).toBe(404);
            expect(stale.body).toEqual({ deployed: false, reason: 'stale' });
        },
    );

    it(
        'deploys the set, and says so idempotently',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const script = await scriptName();

            const first = await rehydrate({ script, appUid });
            expect(first.status).toBe(200);
            expect(first.body).toEqual({ deployed: true });
            expect(await isResident(script)).toBe(true);

            // Asked for again — every edge location that missed asks — the
            // same set redeploys to the same script and the same key.
            expect((await rehydrate({ script, appUid })).status).toBe(200);

            await subscribe('ingest', { sink: sinkUrl, label: 'rehydrated' });
            await touch('rehydrated.txt');
            await delivered();
            expect(sinkPosts[0]).toMatchObject({ label: 'rehydrated' });
        },
    );
});

describe('the worker follows the handler set', () => {
    it(
        'a changed set is a new script, and the old one is left behind',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const before = await scriptName();
            expect(await isResident(before)).toBe(true);

            const response = await api('POST', '/events/handlers/publish', {
                name: 'ingest',
                source: INGEST_SOURCE.replace(
                    "ctx.kind || 'ingest'",
                    "'ingest-v2'",
                ),
                replace: true,
            });
            expect(response.status).toBe(200);

            const after = await scriptName();
            expect(after).not.toBe(before);
            expect(await isResident(after)).toBe(false);

            await subscribe('ingest', { sink: sinkUrl, label: 'v2' });
            await touch('after-republish.txt');
            await delivered();

            expect(sinkPosts[0].kind).toBe('ingest-v2');
            expect(await isResident(after)).toBe(true);
            // Superseded, and addressed by nothing from here on.
            expect(await isResident(before)).toBe(true);
        },
    );

    it(
        'with the last handler gone there is nothing left to deploy',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const subId = await subscribe('ingest', { sink: sinkUrl });
            for (const name of ['ingest', 'explode', 'sleepy', 'noop'])
                expect(
                    (await api('POST', '/events/handlers/remove', { name }))
                        .status,
                ).toBe(200);

            // An empty set names no script, so nothing can be deployed for
            // this app again until something is published.
            expect(
                await env.server.stores.eventHandler.setForApp(appUid),
            ).toEqual([]);
            expect((await durable().getBySubId(subId))?.suspendedReason).toBe(
                'handler_not_found',
            );

            await touch('orphaned.txt');
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(sinkPosts).toHaveLength(0);
        },
    );
});
