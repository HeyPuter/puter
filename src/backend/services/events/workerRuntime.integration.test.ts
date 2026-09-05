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
 * a handler acts with the app's own authority for the subscriber — reaching
 * its AppData and KV like any other app session — and not the account's own,
 * or anything the app itself was never granted.
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
import { appSocketRoom, SocketService } from '../socket/SocketService.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import {
    EVENTS_WORKER_SESSION_NAME,
    eventsInvokeKey,
    eventsWorkerScript,
} from './workerRuntime.js';
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
    /** Whether a write into the app's own AppData went through, and as what. */
    appDataWrite?: { ok: boolean; name?: string; error?: string };
    /** Whether a `user.kv.set` + `user.kv.get` round-trip agreed. */
    kv?: { roundTrip: boolean };
    /** What stat-ing a path outside the app's grants answered. */
    outsideStat?: { name?: string; error?: string };
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

    // Opt-in probes, only run when a test asks for them via ctx — so every
    // other delivery in this suite pays for none of this.
    let appDataWrite;
    if (ctx.appDataFile) {
        appDataWrite = await user.fs
            .write(ctx.appDataFile, 'written from the handler', {
                createMissingParents: true,
            })
            .then(
                (entry) => ({ ok: true, name: entry.name }),
                (err) => ({ ok: false, error: String(err && err.code || err) }),
            );
    }
    let kv;
    if (ctx.kvKey) {
        await user.kv.set(ctx.kvKey, ctx.kvValue);
        kv = { roundTrip: (await user.kv.get(ctx.kvKey)) === ctx.kvValue };
    }
    let outsideStat;
    if (ctx.outsidePath) {
        outsideStat = await user.fs.stat(ctx.outsidePath).then(
            (entry) => ({ name: entry.name }),
            (err) => ({ error: String(err && err.code || err) }),
        );
    }

    await fetch(ctx.sink, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            kind: ctx.kind || 'ingest',
            path: event.path,
            label: ctx.label,
            stat,
            appDataWrite,
            kv,
            outsideStat,
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
const socketService = () =>
    env.server.services.socket as unknown as SocketService;
const pending = () => env.server.stores.pendingDelivery;
const durable = () => env.server.stores.durableSubscription;
const localWorkers = () => env.server.services.localworkerservice;

/** The script the app's published set currently deploys as. */
const scriptName = async (): Promise<string> =>
    eventsWorkerScript(
        handlerSetHash(await env.server.stores.eventHandler.setForApp(appUid)),
        // No `workers.internetExposedUrl` in this test's config, so the scope
        // this backend binds is empty.
        '',
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

/**
 * A real `Host` header against the local-worker proxy. `fetch()` drops a
 * `host` header it is handed (a forbidden header per the Fetch spec), so it
 * cannot exercise hostname-based routing at all — this goes in under
 * `http.request`, which does not filter it.
 */
const requestWithHost = (
    host: string,
    path: string,
    body: unknown,
): Promise<{ status: number }> =>
    new Promise((resolve, reject) => {
        const req = http.request(
            new URL(path, env.apiOrigin),
            {
                method: 'POST',
                headers: { host, 'content-type': 'application/json' },
            },
            (res) => {
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
            },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });

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

/**
 * Like `subscribe`, but with no `targets` override — the default
 * (`['socket', 'worker']`) rather than the `['worker']` the rest of this suite
 * pins. Only this leaves `socket` in play, which is what a background
 * delivery's own client (wrongly) showing up in the app's delivery room would
 * actually steer onto.
 */
const subscribeWithSocketTarget = async (
    handlerName: string,
    context?: object,
): Promise<string> => {
    const response = await api('POST', '/events/subscribe', {
        subject: `fs:${anchor}`,
        delivery: 'single',
        handlerName,
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
        'hands the handler the app`s own authority for the subscriber, not a grant of its own',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            // Owned by the subscriber, but never shared with the app in any
            // way — what a background handler must still not reach.
            const outsideDir = `/${env.users.user.username}/evw-e2e-private`;
            const outsidePath = `${outsideDir}/secret.txt`;
            await env.server.services.fs.mkdir(userId, {
                path: outsideDir,
                createMissingParents: true,
            });
            await env.server.services.fs.touch(userId, { path: outsidePath });

            await subscribe('ingest', {
                sink: sinkUrl,
                label: 'scope',
                appDataFile: 'events-worker-note.txt',
                kvKey: 'events-worker-key',
                kvValue: 'events-worker-value',
                outsidePath,
            });
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
            // A worker session — the same shape a deployed worker's own token
            // carries — not a one-off access token minted for this delivery.
            expect(actor!.session?.kind).toBe('worker');

            // The subscription's own grant still reads.
            expect(sinkPosts[0].stat).toEqual({ name: 'scoped.txt' });
            // The app's own AppData is reachable — the same reach it has from
            // a tab — regardless of what the subscription was ever made on.
            expect(sinkPosts[0].appDataWrite).toEqual({
                ok: true,
                name: 'events-worker-note.txt',
            });
            // Same story for the app's own key-value namespace.
            expect(sinkPosts[0].kv).toEqual({ roundTrip: true });
            // But full app authority is still not the account's own: a file
            // the app was never granted stays out of reach.
            expect(sinkPosts[0].outsideStat).toEqual({
                error: 'subject_does_not_exist',
            });

            // No hard expiry: this is a session, revoked like any other
            // worker session rather than aged out on a timer.
            const decoded = env.server.services.token.verify('auth', token!) as {
                exp?: number;
            };
            expect(decoded.exp).toBeUndefined();

            // A second delivery for the same (user, app) reuses the same
            // session row rather than minting a new one each time.
            await touch('scoped-again.txt');
            await delivered(2);
            const secondToken = sinkPosts[1].token;
            const second = (
                await env.server.services.auth.authenticate(secondToken!)
            ).actor!;
            expect(second.session?.uid).toBe(actor!.session?.uid);

            const workerSessions = (
                await env.server.stores.session.getByUserId(userId)
            ).filter(
                (row: { kind?: string; meta?: { worker_name?: string } }) =>
                    row.kind === 'worker' &&
                    row.meta?.worker_name === EVENTS_WORKER_SESSION_NAME,
            );
            expect(workerSessions).toHaveLength(1);
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

describe('the client a handler runs as', () => {
    it(
        'never joins the app`s delivery room, so a later single delivery is not steered onto it',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const room = appSocketRoom(userId, appUid);
            // `subscribeWithSocketTarget` leaves `socket` a live option for
            // this delivery — the ordinary `subscribe()` helper pins
            // `targets: ['worker']` specifically to avoid exercising this.
            await subscribeWithSocketTarget('ingest', { sink: sinkUrl });

            await touch('first.txt');
            await delivered(1);
            // The handler's own client opened no socket in the room its
            // delivery would be preferred on.
            expect(socketService().has({ room })).toBe(false);

            // If the first delivery had left one, this one would waste up to
            // two lease lapses on it (`SINGLE_SOCKET_ATTEMPTS`) before falling
            // back to the worker — many seconds at this suite's lease length.
            // Landing well under that proves it went straight to the worker.
            const startedSecond = Date.now();
            await touch('second.txt');
            await delivered(2);
            expect(Date.now() - startedSecond).toBeLessThan(5_000);

            expect(socketService().has({ room })).toBe(false);
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
            // local-worker proxy (`cfCallLocal`), and an events worker is
            // deployed under its own registry key — never findable there,
            // and it has no `subdomains` row for the proxy to fall back to.
            const overHttp = await requestWithHost(
                `${script}.workers.puter.localhost`,
                EVENTS_INVOKE_PATH,
                { handler: 'ingest' },
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
            // Matches the edge dispatcher's own `appUid` validation.
            expect(
                (await rehydrate({ script: await scriptName(), appUid: 'nope' }))
                    .status,
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
        'refuses with a retriable 502 once this app has deployed past the hourly cap',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const script = await scriptName();
            const hour = new Date().toISOString().slice(0, 13);
            await env.server.clients.redis.set(
                `ev:deploys:{${appUid}}:${hour}`,
                '9999',
            );

            try {
                const throttled = await rehydrate({ script, appUid });
                expect(throttled.status).toBe(502);
                expect(throttled.body).toEqual({
                    deployed: false,
                    reason: 'throttled',
                });
            } finally {
                await env.server.clients.redis.del(
                    `ev:deploys:{${appUid}}:${hour}`,
                );
            }
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
