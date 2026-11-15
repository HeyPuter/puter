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

import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ServerResponse } from 'node:http';
import path from 'node:path';
import { bench, expect } from 'vitest';
import type { PuterServer } from './server';
import { CACHE_TOMBSTONE_SUFFIX } from './stores/types';
import { setupPuterTestEnv, type PuterTestEnv } from './testUtil';
import type { IConfig } from './types';

/**
 * Where a round trip goes. `dbRead` is answered by a replica in the serving
 * region; `dbPrimaryRead` and `dbWrite` travel to the one writable primary.
 */
export type IoKind =
    | 'dbRead'
    | 'dbPrimaryRead'
    | 'dbWrite'
    | 'dynamoRead'
    | 'dynamoWrite'
    | 'redis'
    | 's3';

/**
 * Modeled milliseconds per round trip, for a region far from the SQL primary.
 * The in-memory test clients answer in microseconds, which hides exactly the
 * costs a distributed deployment pays.
 */
export const DISTRIBUTED_LATENCY_MS: Record<IoKind, number> = {
    dbRead: 2,
    dbPrimaryRead: 40,
    dbWrite: 40,
    dynamoRead: 4,
    dynamoWrite: 6,
    redis: 1,
    s3: 12,
};

/** `start` and `end` are readings of the modeled clock. */
export type IoCall = { kind: IoKind; op: string; start: number; end: number };

export type IoProfile = {
    /** Round trips per destination; absent means zero. */
    roundTrips: Partial<Record<IoKind, number>>;
    /**
     * The longest run of round trips that each began after the one before had
     * finished. Independent calls issued together count once.
     */
    serialStages: number;
    /**
     * Modeled round-trip latency along that critical path: what the caller
     * waits on I/O, with CPU time left out so it reads the same on any
     * machine.
     */
    latencyMs: number;
};

export type ScenarioResult = IoProfile & { name: string; iterations: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A clock that only round trips advance. A round trip stays pending until the
 * process has issued no further one for `quietMs` of real time, then the
 * earliest pending ones complete together and the clock jumps to that moment.
 * CPU time and scheduling jitter never reach it, so calls issued together
 * always read as parallel, on any machine.
 */
const createModeledClock = (quietMs: number) => {
    let now = 0;
    let pending: { at: number; resolve: () => void }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
        clearTimeout(timer);
        timer = pending.length ? setTimeout(advance, quietMs) : undefined;
    };
    const advance = () => {
        now = Math.min(...pending.map((p) => p.at));
        const due = pending.filter((p) => p.at === now);
        pending = pending.filter((p) => p.at !== now);
        for (const { resolve } of due) resolve();
        arm();
    };
    return {
        now: () => now,
        wait: (ms: number) =>
            new Promise<void>((resolve) => {
                pending.push({ at: now + ms, resolve });
                arm();
            }),
        flush: () => {
            clearTimeout(timer);
            for (const { resolve } of pending.splice(0)) resolve();
        },
    };
};

// Commands that park until data arrives; they belong to background pollers.
const BLOCKING_REDIS_COMMANDS =
    /^(xread|xreadgroup|blpop|brpop|blmove|bzpop|subscribe|psubscribe|ssubscribe)/;

// These hand back a batch; its `exec()` is the round trip.
const REDIS_BATCHES = ['pipeline', 'multi'];

const DYNAMO_METHODS: Record<string, IoKind> = {
    get: 'dynamoRead',
    batchGet: 'dynamoRead',
    query: 'dynamoRead',
    put: 'dynamoWrite',
    update: 'dynamoWrite',
    del: 'dynamoWrite',
    batchPut: 'dynamoWrite',
    batchDel: 'dynamoWrite',
};

export type IoInstrumentation = {
    /** Starts a recording window, dropping calls from the one before. */
    begin: () => void;
    /** Ends the window once in-flight and trailing background I/O settle. */
    end: () => Promise<IoCall[]>;
    /** The modeled clock, in milliseconds. */
    now: () => number;
    restore: () => void;
};

type Patchable = Record<string, unknown>;
type AnyFn = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Records every database, KV, cache and object-store round trip on `server`,
 * and makes each take `latency` on a modeled clock. The SQL client also reports
 * a read replica, so replica-aware reads take the path they take in a
 * replicated deployment.
 */
export const instrumentClientIo = (
    server: PuterServer,
    latency: Record<IoKind, number> = DISTRIBUTED_LATENCY_MS,
    quietMs = 4,
): IoInstrumentation => {
    const clock = createModeledClock(quietMs);
    let calls: IoCall[] = [];
    let inFlight = 0;
    let lastActivity = 0;
    const restorers: (() => void)[] = [];
    // A client method that calls another one is still one round trip.
    const insideCall = new AsyncLocalStorage<true>();

    const patch = (target: Patchable, method: string, replacement: unknown) => {
        const own = Object.getOwnPropertyDescriptor(target, method);
        target[method] = replacement;
        restorers.push(() => {
            if (own) Object.defineProperty(target, method, own);
            else delete target[method];
        });
    };

    const record = (
        target: Patchable,
        method: string,
        kindOf: IoKind | ((args: unknown[]) => IoKind),
        opOf?: (args: unknown[]) => string,
    ) => {
        const original = target[method] as AnyFn | undefined;
        if (typeof original !== 'function') return;
        patch(target, method, function (this: unknown, ...args: unknown[]) {
            if (insideCall.getStore()) return original.apply(this, args);
            return insideCall.run(true, async () => {
                const kind =
                    typeof kindOf === 'function' ? kindOf(args) : kindOf;
                const call: IoCall = {
                    kind,
                    op: opOf ? opOf(args) : method,
                    start: clock.now(),
                    end: Infinity,
                };
                calls.push(call);
                inFlight++;
                try {
                    await clock.wait(latency[kind]);
                    call.end = clock.now();
                    return await original.apply(this, args);
                } finally {
                    lastActivity = performance.now();
                    inFlight--;
                }
            });
        });
    };

    const db = server.clients.db as unknown as Patchable;
    record(db, 'read', 'dbRead');
    record(db, 'pread', 'dbPrimaryRead');
    record(db, 'write', 'dbWrite');
    record(db, 'batchWrite', 'dbWrite');
    patch(db, 'hasReadReplica', () => true);

    const dynamo = server.clients.dynamo as unknown as Patchable;
    for (const [method, kind] of Object.entries(DYNAMO_METHODS)) {
        record(dynamo, method, kind);
    }

    // The mock keeps each command as an own function on the instance.
    const redis = server.clients.redis as unknown as Patchable;
    for (const name of Object.getOwnPropertyNames(redis)) {
        if (name.startsWith('_') || name.startsWith('on')) continue;
        if (REDIS_BATCHES.includes(name)) continue;
        if (BLOCKING_REDIS_COMMANDS.test(name)) continue;
        record(redis, name, 'redis');
    }
    for (const batch of REDIS_BATCHES) {
        const original = redis[batch] as AnyFn | undefined;
        if (typeof original !== 'function') continue;
        patch(redis, batch, function (this: unknown, ...args: unknown[]) {
            const pipeline = original.apply(this, args) as Patchable;
            record(pipeline, 'exec', 'redis', () => batch);
            return pipeline;
        });
    }

    const s3 = server.clients.s3 as unknown as Patchable;
    const s3Get = s3.get as AnyFn;
    const patchedS3 = new WeakSet<object>();
    patch(s3, 'get', function (this: unknown, ...args: unknown[]) {
        const client = s3Get.apply(this, args) as Patchable;
        if (!patchedS3.has(client)) {
            patchedS3.add(client);
            record(client, 'send', 's3', ([command]) =>
                String((command as object)?.constructor?.name),
            );
        }
        return client;
    });

    return {
        begin: () => {
            calls = [];
        },
        end: async () => {
            const window = calls;
            // Work a request leaves running after it answers is still load.
            const deadline = performance.now() + 1000;
            while (
                performance.now() < deadline &&
                (inFlight > 0 || performance.now() - lastActivity < quietMs + 2)
            ) {
                await sleep(2);
            }
            calls = [];
            return window;
        },
        now: clock.now,
        restore: () => {
            while (restorers.length) restorers.pop()!();
            clock.flush();
        },
    };
};

/**
 * Notes when the in-process server ends a response. A client only sees the
 * answer after reading the body, by which time work the handler left running
 * may have finished and would pass for work the answer waited on.
 */
const trackResponses = (now: () => number) => {
    const end = ServerResponse.prototype.end;
    let lastEnded: number | undefined;
    ServerResponse.prototype.end = function (
        this: ServerResponse,
        ...args: unknown[]
    ) {
        lastEnded = now();
        return (end as AnyFn).apply(this, args);
    } as typeof end;
    return {
        begin: () => {
            lastEnded = undefined;
        },
        lastEnded: () => lastEnded,
        restore: () => {
            ServerResponse.prototype.end = end;
        },
    };
};

/**
 * `calls` as one profile. Only calls that finished by `answeredAt` can have
 * delayed the answer, so later ones count as round trips but not as latency.
 */
export const profileIo = (
    calls: IoCall[],
    answeredAt = Infinity,
    latency: Record<IoKind, number> = DISTRIBUTED_LATENCY_MS,
): IoProfile => {
    const roundTrips: Partial<Record<IoKind, number>> = {};
    for (const { kind } of calls)
        roundTrips[kind] = (roundTrips[kind] ?? 0) + 1;

    const awaited = calls
        .filter((call) => call.end <= answeredAt)
        .sort((a, b) => a.start - b.start);
    const stages: number[] = [];
    const waited: number[] = [];
    awaited.forEach((call, i) => {
        let stagesBefore = 0;
        let waitedBefore = 0;
        for (let j = 0; j < i; j++) {
            if (awaited[j]!.end > call.start) continue;
            stagesBefore = Math.max(stagesBefore, stages[j]!);
            waitedBefore = Math.max(waitedBefore, waited[j]!);
        }
        stages[i] = stagesBefore + 1;
        waited[i] = waitedBefore + latency[call.kind];
    });
    return {
        roundTrips,
        serialStages: Math.max(0, ...stages),
        latencyMs: Math.max(0, ...waited),
    };
};

/** The value most iterations agreed on; a stray background call is outvoted. */
const mostCommon = (values: number[]): number => {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
};

const summarize = (name: string, iterations: IoProfile[]): ScenarioResult => {
    const kinds = new Set(
        iterations.flatMap((i) => Object.keys(i.roundTrips) as IoKind[]),
    );
    const roundTrips: Partial<Record<IoKind, number>> = {};
    for (const kind of kinds) {
        const count = mostCommon(
            iterations.map((i) => i.roundTrips[kind] ?? 0),
        );
        if (count > 0) roundTrips[kind] = count;
    }
    return {
        name,
        roundTrips,
        // Real time spent between calls (a stream, a hash) can only make
        // unrelated calls look chained, never the reverse, so the lowest
        // reading is the true one.
        serialStages: Math.min(...iterations.map((i) => i.serialStages)),
        latencyMs: Math.min(...iterations.map((i) => i.latencyMs)),
        iterations: iterations.length,
    };
};

export type BenchEnv = PuterTestEnv & {
    /**
     * A request to the API origin carrying `token` (the regular test user's
     * session by default). Rejects unless the response is 2xx, and reads the
     * body to the end so the scenario covers the whole response.
     */
    request: (
        path: string,
        init?: RequestInit & { json?: unknown; token?: string },
    ) => Promise<Response>;
    /**
     * Registers a benchmark that runs `run` against this env under modeled
     * round-trip latency. Two unrecorded runs come first, so the recorded ones
     * see warm caches.
     */
    scenario: (
        name: string,
        run: () => Promise<unknown>,
        options?: { iterations?: number },
    ) => void;
};

/**
 * Boots one in-memory backend for the bench file calling this, with client I/O
 * instrumented. The returned env is filled in before the first scenario runs;
 * `seed` runs once after boot, before latency applies.
 */
export const useBenchEnv = (
    options: {
        config?: IConfig;
        seed?: (env: BenchEnv) => Promise<void>;
    } = {},
): BenchEnv => {
    const testPath = expect.getState().testPath;
    const results: ScenarioResult[] = [];
    let io: IoInstrumentation | undefined;
    let responses: ReturnType<typeof trackResponses> | undefined;
    let booting: Promise<void> | undefined;
    let registered = 0;

    // Bench mode runs no `beforeAll`/`afterAll`, so the env boots with the
    // first scenario and shuts down after the last.
    const boot = async () => {
        Object.assign(env, await setupPuterTestEnv(options.config));
        await options.seed?.(env);
        await settle();
        io = instrumentClientIo(env.server);
        responses = trackResponses(io.now);
    };

    // Brings the server to the state it is in once the writes so far are a
    // few seconds old, without waiting for them to be.
    const settle = async () => {
        // A usage counter reads the KV store on every increment until its
        // first flush.
        await env.server.services.metering.flushBufferedUsages();
        for (let pass = 0; pass < 10; pass++) {
            if ((await env.server.stores.meteringBuffer.flushCycle()) === 0) {
                break;
            }
        }
        // A written row is read from the primary until its cache tombstone
        // lapses.
        const { redis } = env.server.clients;
        const tombstones = await redis.keys(`*${CACHE_TOMBSTONE_SUFFIX}`);
        if (tombstones.length) await redis.del(...tombstones);
    };

    const report = async () => {
        const outDir = process.env.PUTER_BENCH_IO_DIR;
        if (outDir && testPath) {
            mkdirSync(outDir, { recursive: true });
            const file = path.relative(process.cwd(), testPath);
            writeFileSync(
                path.join(
                    outDir,
                    `${file.replace(/[^a-zA-Z0-9.]+/g, '_')}.json`,
                ),
                JSON.stringify({ file, scenarios: results }, null, 2),
            );
        }
        if (results.length === registered) {
            io?.restore();
            responses?.restore();
            await env.shutdown();
        }
    };

    const env = {
        request: async (requestPath, init = {}) => {
            const { json, token = env.users.user.token, ...rest } = init;
            const method = rest.method ?? (json === undefined ? 'GET' : 'POST');
            const headers = new Headers(rest.headers);
            headers.set('authorization', `Bearer ${token}`);
            if (json !== undefined) {
                headers.set('content-type', 'application/json');
            }
            const response = await fetch(new URL(requestPath, env.apiOrigin), {
                ...rest,
                method,
                headers,
                ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
            });
            const body = await response.clone().text();
            if (!response.ok) {
                throw new Error(
                    `${method} ${requestPath} answered ${response.status}: ${body.slice(0, 300)}`,
                );
            }
            return response;
        },
        scenario: (name, run, { iterations = 7 } = {}) => {
            registered++;
            let recorded: IoProfile[] | null = null;
            bench(
                name,
                async () => {
                    io!.begin();
                    responses!.begin();
                    await run();
                    // A scenario that made no request answers when it returns.
                    const answeredAt = responses!.lastEnded() ?? io!.now();
                    recorded?.push(profileIo(await io!.end(), answeredAt));
                },
                {
                    time: 0,
                    iterations,
                    warmupTime: 0,
                    warmupIterations: 2,
                    // A scenario that fails must not report as a fast one.
                    throws: true,
                    setup: async (_task, mode) => {
                        await (booting ??= boot());
                        if (mode === 'run') await settle();
                        recorded = mode === 'run' ? [] : null;
                    },
                    teardown: async (_task, mode) => {
                        if (mode !== 'run' || !recorded?.length) return;
                        results.push(summarize(name, recorded));
                        await report();
                    },
                },
            );
        },
    } as BenchEnv;

    return env;
};
