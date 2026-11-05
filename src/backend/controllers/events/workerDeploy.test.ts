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
 * `EventsWorkerDeployer` against stubbed layers — no real Cloudflare, no real
 * database — pinning the in-flight keying and the per-app deploy throttle
 * without booting the full test server.
 */

import MockRedis from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import type { fetch as undiciFetch } from 'undici';
import {
    DispatcherInvokeTransport,
    EVENTS_DEPLOYED_HEADER,
    EVENTS_DISPATCH_ERROR_HEADER,
    EVENTS_HANDLED_HEADER,
    EventsWorkerInvokerClient,
    type EventsInvokeCall,
} from '../../clients/events/EventsWorkerInvokerClient.js';
import { INTERNAL_DEPLOY_TARGET } from '../../drivers/workers/WorkerDriver.js';
import {
    EVENTS_USER_WORKER_DEPLOYS_PER_HOUR,
    EVENTS_WORKER_DEPLOYS_PER_HOUR,
} from './limits.js';
import {
    EventsWorkerDeployer,
    LocalEventsInvokeTransport,
    type EventsDeployOptions,
    type EventsDeployOutcome,
} from './workerDeploy.js';
import {
    eventsWorkerScript,
    userHandlerScript,
} from '../../services/events/workerRuntime.js';
import {
    appHandlerScope,
    hashContent,
    type HandlerScope,
} from '../../stores/events/EventHandlerStore.js';
import { handlerSetHash } from '../../services/events/workerSource.js';
import type { IConfig } from '../../types.js';

const SOURCE_HASH = 'a'.repeat(64);
const SCRIPT = eventsWorkerScript(
    handlerSetHash([{ name: 'h', sourceHash: SOURCE_HASH }]),
    '',
);

interface Owner {
    ownerUserId: number;
    suspended?: boolean;
}

/** The private layers shape `EventsWorkerDeployer` takes — not exported. */
type Layers = ConstructorParameters<typeof EventsWorkerDeployer>[0];

/** Stub layers whose only real dependency is a fresh redis mock. */
const makeLayers = (
    owners: Record<string, Owner | null>,
    events: Record<string, unknown> = {},
) => {
    const redis = new MockRedis.Cluster(['redis://localhost:7001']);
    const created: string[] = [];
    const targets: Array<Record<string, unknown>> = [];
    /** Apps whose handler sources were read, once per read. */
    const sourceReads: string[] = [];
    const layers = {
        config: {
            events: {
                workerRuntime: true,
                internalSecret: 'sekret',
                ...events,
            },
            // `#namespace()` needs a local-worker shape to resolve without
            // throwing — this stub never reaches a real Cloudflare or
            // Miniflare deploy either way.
            workers: { localServer: true },
        } as IConfig,
        clients: { redis },
        stores: {
            eventHandler: {
                setForApp: async () => [{ name: 'h', sourceHash: SOURCE_HASH }],
                allForApp: async ({ appUid }: { appUid: string }) => {
                    sourceReads.push(appUid);
                    return [
                        {
                            appUid,
                            name: 'h',
                            source: 'async () => {}',
                            sourceHash: SOURCE_HASH,
                            createdAt: 0,
                            updatedAt: 0,
                        },
                    ];
                },
            },
            app: {
                getByUid: async (appUid: string) => {
                    const owner = owners[appUid];
                    return owner === null || owner === undefined
                        ? null
                        : { owner_user_id: owner.ownerUserId };
                },
            },
            user: {
                getByUuid: async (uuid: string) => {
                    const owner = Object.values(owners).find(
                        (o) => `uuid-${o?.ownerUserId}` === uuid,
                    );
                    if (!owner) return null;
                    return {
                        id: owner.ownerUserId,
                        uuid,
                        username: `user-${owner.ownerUserId}`,
                        suspended: owner.suspended ?? false,
                    };
                },
                getById: async (id: number) => {
                    const owner = Object.values(owners).find(
                        (o) => o?.ownerUserId === id,
                    );
                    if (!owner) return null;
                    return {
                        id,
                        uuid: `uuid-${id}`,
                        username: `user-${id}`,
                        suspended: owner.suspended ?? false,
                    };
                },
            },
        },
        services: {},
        drivers: {
            workers: {
                create: async (args: {
                    workerName: string;
                    [INTERNAL_DEPLOY_TARGET]?: Record<string, unknown>;
                }) => {
                    created.push(args.workerName);
                    targets.push(args[INTERNAL_DEPLOY_TARGET] ?? {});
                    return { success: true, errors: [] };
                },
            },
        },
    };
    return {
        layers: layers as unknown as Layers,
        created,
        targets,
        redis,
        sourceReads,
    };
};

describe('EventsWorkerDeployer.ensure', () => {
    it('keys in-flight deploys by app and script, not script alone', async () => {
        // Two apps whose handler sets hash identically, and so deploy as the
        // same script; only one has a live owner. Both `ensure()` calls run
        // synchronously back to back — keying the in-flight map by script
        // alone would collapse the second call into the first's outcome.
        const { layers } = makeLayers({
            'app-a': { ownerUserId: 1 },
            'app-b': { ownerUserId: 2, suspended: true },
        });
        const deployer = new EventsWorkerDeployer(layers);

        const [a, b] = await Promise.all([
            deployer.ensure(appHandlerScope('app-a'), SCRIPT),
            deployer.ensure(appHandlerScope('app-b'), SCRIPT),
        ]);
        expect(a).toBe('deployed');
        expect(b).toBe('no-owner');
    });

    it('refuses once the app has deployed past the hourly cap, before reading or building any source', async () => {
        const { layers, redis, sourceReads, created } = makeLayers({
            'app-c': { ownerUserId: 3 },
        });
        const deployer = new EventsWorkerDeployer(layers);
        const hour = new Date().toISOString().slice(0, 13);
        await redis.set(
            `ev:deploys:{app-c}:${hour}`,
            String(EVENTS_WORKER_DEPLOYS_PER_HOUR),
        );

        expect(await deployer.ensure(appHandlerScope('app-c'), SCRIPT)).toBe(
            'throttled',
        );
        expect(sourceReads).toEqual([]);
        expect(created).toEqual([]);
    });

    it('answers a stale script without spending the hourly cap', async () => {
        const { layers, redis, sourceReads } = makeLayers({
            'app-e': { ownerUserId: 5 },
        });
        const deployer = new EventsWorkerDeployer(layers);
        const stale = eventsWorkerScript(
            handlerSetHash([{ name: 'h', sourceHash: 'b'.repeat(64) }]),
            '',
        );

        expect(await deployer.ensure(appHandlerScope('app-e'), stale)).toBe(
            'stale',
        );
        expect(sourceReads).toEqual([]);
        const hour = new Date().toISOString().slice(0, 13);
        expect(await redis.get(`ev:deploys:{app-e}:${hour}`)).toBeNull();
    });

    it('passes events.workerCpuMs to the deploy target', async () => {
        const { layers, targets } = makeLayers(
            { 'app-f': { ownerUserId: 6 } },
            { workerCpuMs: 50 },
        );
        const deployer = new EventsWorkerDeployer(layers);
        expect(await deployer.ensure(appHandlerScope('app-f'), SCRIPT)).toBe(
            'deployed',
        );
        expect(targets[0]!.cpuMs).toBe(50);
    });

    it('passes no cpuMs when events.workerCpuMs is unset', async () => {
        const { layers, targets } = makeLayers({ 'app-g': { ownerUserId: 7 } });
        const deployer = new EventsWorkerDeployer(layers);
        expect(await deployer.ensure(appHandlerScope('app-g'), SCRIPT)).toBe(
            'deployed',
        );
        expect(targets[0]!.cpuMs).toBeUndefined();
    });

    it('deploys normally under the cap', async () => {
        const { layers } = makeLayers({ 'app-d': { ownerUserId: 4 } });
        const deployer = new EventsWorkerDeployer(layers);
        expect(await deployer.ensure(appHandlerScope('app-d'), SCRIPT)).toBe(
            'deployed',
        );
    });
});

/** A server's schedules with a deploy gate that records and can refuse. */
const withGate = (
    layers: Layers,
    refuse: (capped: boolean) => boolean = () => false,
) => {
    const gated: Array<{ script: string; capped: boolean }> = [];
    const gate = {
        gateDeploy: async (
            script: string,
            options: { capped: boolean },
            deploy: () => Promise<EventsDeployOutcome>,
        ): Promise<EventsDeployOutcome> => {
            gated.push({ script, capped: options.capped });
            return refuse(options.capped) ? 'busy' : deploy();
        },
    };
    const deployer = new EventsWorkerDeployer({
        ...layers,
        services: { ...layers.services, schedules: gate },
    } as unknown as Layers);
    return { deployer, gated };
};

describe('the schedules` deploy gate', () => {
    it('is skipped without schedules, or with schedules that have no gate', async () => {
        const { layers, created } = makeLayers({ 'app-x': { ownerUserId: 1 } });
        await expect(
            new EventsWorkerDeployer(layers).ensure(
                appHandlerScope('app-x'),
                SCRIPT,
                {
                    lane: 'schedule',
                },
            ),
        ).resolves.toBe('deployed');
        const gateless = new EventsWorkerDeployer({
            ...layers,
            services: { ...layers.services, schedules: {} },
        } as unknown as Layers);
        await expect(
            gateless.ensure(appHandlerScope('app-x'), SCRIPT, {
                lane: 'schedule',
            }),
        ).resolves.toBe('deployed');
        expect(created).toEqual([SCRIPT, SCRIPT]);
    });

    it('takes every deploy, capped only for a schedule run', async () => {
        const { layers, created } = makeLayers({ 'app-x': { ownerUserId: 1 } });
        const { deployer, gated } = withGate(layers);

        await expect(
            deployer.ensure(appHandlerScope('app-x'), SCRIPT),
        ).resolves.toBe('deployed');
        await expect(
            deployer.ensure(appHandlerScope('app-x'), SCRIPT, {
                lane: 'schedule',
            }),
        ).resolves.toBe('deployed');
        expect(gated).toEqual([
            { script: SCRIPT, capped: false },
            { script: SCRIPT, capped: true },
        ]);
        expect(created).toEqual([SCRIPT, SCRIPT]);
    });

    it('answers a refused schedule run busy, and a delivery still deploys', async () => {
        const { layers, created } = makeLayers({ 'app-x': { ownerUserId: 1 } });
        const { deployer } = withGate(layers, (capped) => capped);

        await expect(
            deployer.ensure(appHandlerScope('app-x'), SCRIPT, {
                lane: 'schedule',
            }),
        ).resolves.toBe('busy');
        await expect(
            deployer.ensure(appHandlerScope('app-x'), SCRIPT),
        ).resolves.toBe('deployed');
        expect(created).toEqual([SCRIPT]);
    });

    it('lets deliveries that join a schedule run`s refused deploy deploy once', async () => {
        const { layers, created } = makeLayers({ 'app-x': { ownerUserId: 1 } });
        const { deployer, gated } = withGate(layers, (capped) => capped);

        const scheduled = deployer.ensure(appHandlerScope('app-x'), SCRIPT, {
            lane: 'schedule',
        });
        const deliveries = [
            deployer.ensure(appHandlerScope('app-x'), SCRIPT),
            deployer.ensure(appHandlerScope('app-x'), SCRIPT),
        ];
        await expect(scheduled).resolves.toBe('busy');
        await expect(Promise.all(deliveries)).resolves.toEqual([
            'deployed',
            'deployed',
        ]);
        expect(created).toEqual([SCRIPT]);
        expect(gated.map((g) => g.capped)).toEqual([true, false]);
    });

    it('lets a schedule run join a delivery`s deploy in flight', async () => {
        const { layers, created } = makeLayers({ 'app-x': { ownerUserId: 1 } });
        const { deployer, gated } = withGate(layers, (capped) => capped);

        const delivery = deployer.ensure(appHandlerScope('app-x'), SCRIPT);
        const scheduled = deployer.ensure(appHandlerScope('app-x'), SCRIPT, {
            lane: 'schedule',
        });
        await expect(Promise.all([delivery, scheduled])).resolves.toEqual([
            'deployed',
            'deployed',
        ]);
        expect(gated).toEqual([{ script: SCRIPT, capped: false }]);
        expect(created).toEqual([SCRIPT]);
    });
});

describe('LocalEventsInvokeTransport', () => {
    it('renders each request as it goes out, after a cold deploy', async () => {
        const bodies: string[] = [];
        let resident = false;
        const transport = new LocalEventsInvokeTransport(
            {
                localworkerservice: {
                    dispatchEventsWorker: async (request: Request) => {
                        bodies.push(await request.text());
                        if (!resident) return null;
                        return new Response(null, {
                            status: 200,
                            headers: { 'x-puter-events-handled': '1' },
                        });
                    },
                },
            } as never,
            {
                ensure: async () => {
                    resident = true;
                    return 'deployed';
                },
                scopeFor: async (appUid: string) => appHandlerScope(appUid),
            } as unknown as EventsWorkerDeployer,
        );
        let renders = 0;
        const call: EventsInvokeCall = {
            script: SCRIPT,
            appUid: 'app-x',
            key: 'k',
            body: '{"n":0}',
            timeoutMs: 5000,
            render: () => `{"n":${++renders}}`,
        };
        await expect(transport.send(call)).resolves.toMatchObject({
            status: 200,
        });
        expect(bodies).toEqual(['{"n":1}', '{"n":2}']);
    });
});

describe('deploy-on-miss of an evicted script', () => {
    it('redeploys the evicted script, then resends the run with the deployed marker', async () => {
        const { layers, created } = makeLayers({ 'app-m': { ownerUserId: 8 } });
        // The namespace only has the script once the deploy lands: before
        // that the dispatcher answers a miss.
        let resident = false;
        layers.drivers.workers.create = (async (args: {
            workerName: string;
        }) => {
            created.push(args.workerName);
            resident = true;
            return { success: true, errors: [] };
        }) as never;
        const deployer = new EventsWorkerDeployer(layers);

        const sent: boolean[] = [];
        const fetchImpl = (async (_url: string, init?: RequestInit) => {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            sent.push(headers[EVENTS_DEPLOYED_HEADER] === '1');
            if (resident)
                return new Response(null, {
                    status: 200,
                    headers: { [EVENTS_HANDLED_HEADER]: '1' },
                });
            return new Response(null, {
                status: 404,
                headers: { [EVENTS_DISPATCH_ERROR_HEADER]: 'missing' },
            });
        }) as unknown as typeof undiciFetch;

        const client = new EventsWorkerInvokerClient({
            events: { workerRuntime: true },
        } as IConfig);
        client.setTransport(
            new DispatcherInvokeTransport('http://dispatcher', 's', {
                fetchImpl,
            }),
        );
        client.setMissHandler((appUid, script, options) =>
            deployer.ensure(appHandlerScope(appUid), script, options),
        );

        const result = await client.invoke({
            script: SCRIPT,
            appUid: 'app-m',
            handler: 'h',
            token: 't',
            key: 'k',
            event: {},
            ctx: {},
        });

        expect(result).toEqual({ outcome: 'settled', status: 200 });
        expect(created).toEqual([SCRIPT]);
        // One miss, then the resend carrying the deployed marker.
        expect(sent).toEqual([false, true]);
    });
});

// The redis mock is shared across tests, so each one uses its own app and code.
let fresh = 0;
const nextApp = () => `app-u${++fresh}`;
const userScope = (holder: number, appUid: string) => ({ appUid, holder });
const sourceN = (label: string) =>
    `async () => { await ${label}${++fresh}(); }`;
const scriptOf = (name: string, source: string) =>
    userHandlerScript({ name, sourceHash: hashContent(source) }, '');

type Sets = Record<number, Array<{ name: string; source: string }>>;

/** Layers whose handler sets are per holder (0 is the app's own). */
const withSets = (layers: Layers, sets: Sets) => {
    const handlersOf = (scope: { appUid: string; holder: number }) =>
        (sets[scope.holder] ?? []).map((h) => ({
            appUid: scope.appUid,
            name: h.name,
            source: h.source,
            sourceHash: hashContent(h.source),
            createdAt: 0,
            updatedAt: 0,
        }));
    const store = layers.stores.eventHandler as unknown as Record<
        string,
        unknown
    >;
    store.setForApp = async (scope: { appUid: string; holder: number }) =>
        handlersOf(scope).map(({ name, sourceHash }) => ({ name, sourceHash }));
    store.allForApp = async (scope: { appUid: string; holder: number }) =>
        handlersOf(scope);
};

const holders = (...ids: number[]) =>
    Object.fromEntries(
        ids.map((id) => [`holder-${id}`, { ownerUserId: id }]),
    ) as Record<string, Owner>;

describe('EventsWorkerDeployer in a user scope', () => {
    it('deploys the one handler whose script was asked for, as the holder', async () => {
        const app = nextApp();
        const a = sourceN('a');
        const b = sourceN('b');
        const { layers, created, targets } = makeLayers(holders(10));
        withSets(layers, {
            10: [
                { name: 'a', source: a },
                { name: 'b', source: b },
            ],
        });
        const deployer = new EventsWorkerDeployer(layers);

        const script = scriptOf('b', b);
        expect(await deployer.ensure(userScope(10, app), script)).toBe(
            'deployed',
        );

        expect(created).toEqual([script]);
        const target = targets[0]!;
        expect(target.tags).toEqual([`events-app:${app}`, 'user:uuid-10']);
        // One handler's script: the other one's code is not in it.
        expect(target.source).toContain(b);
        expect(target.source).not.toContain(a);
    });

    it('answers a script no handler of the scope matches as stale, before the throttle', async () => {
        const app = nextApp();
        const { layers, redis, created } = makeLayers(holders(10));
        withSets(layers, { 10: [{ name: 'a', source: sourceN('a') }] });
        const deployer = new EventsWorkerDeployer(layers);

        expect(
            await deployer.ensure(
                userScope(10, app),
                scriptOf('b', sourceN('b')),
            ),
        ).toBe('stale');
        expect(created).toEqual([]);
        const hour = new Date().toISOString().slice(0, 13);
        expect(await redis.get(`ev:deploys:{${app}}:10:${hour}`)).toBeNull();
    });

    it('answers a scope with no handlers as no-handlers', async () => {
        const { layers } = makeLayers(holders(10));
        withSets(layers, {});
        const deployer = new EventsWorkerDeployer(layers);
        expect(
            await deployer.ensure(
                userScope(10, nextApp()),
                scriptOf('a', sourceN('a')),
            ),
        ).toBe('no-handlers');
    });

    it('does not deploy for a holder that is suspended or gone', async () => {
        const source = sourceN('a');
        const { layers, created } = makeLayers({
            'holder-10': { ownerUserId: 10, suspended: true },
        });
        withSets(layers, {
            10: [{ name: 'a', source }],
            11: [{ name: 'a', source }],
        });
        const deployer = new EventsWorkerDeployer(layers);
        const script = scriptOf('a', source);
        const app = nextApp();

        expect(await deployer.ensure(userScope(10, app), script)).toBe(
            'no-owner',
        );
        expect(await deployer.ensure(userScope(11, app), script)).toBe(
            'no-owner',
        );
        expect(created).toEqual([]);
    });

    it('gives each scope its own hourly cap, apart from the app scope', async () => {
        const app = nextApp();
        const source = sourceN('a');
        const { layers, created } = makeLayers({
            ...holders(10, 11),
            [app]: { ownerUserId: 12 },
        });
        withSets(layers, {
            0: [{ name: 'a', source }],
            10: [{ name: 'a', source }],
            11: [{ name: 'a', source }],
        });
        const deployer = new EventsWorkerDeployer(layers);
        const script = scriptOf('a', source);

        for (let i = 0; i < EVENTS_USER_WORKER_DEPLOYS_PER_HOUR; i++)
            expect(await deployer.ensure(userScope(10, app), script)).toBe(
                'deployed',
            );
        expect(await deployer.ensure(userScope(10, app), script)).toBe(
            'throttled',
        );
        expect(created).toHaveLength(EVENTS_USER_WORKER_DEPLOYS_PER_HOUR);

        // Another holder of the same app, and the app's own scope, still go.
        expect(await deployer.ensure(userScope(11, app), script)).toBe(
            'deployed',
        );
        expect(await deployer.ensure(appHandlerScope(app), script)).toBe(
            'deployed',
        );
    });

    it('collapses concurrent deploys of one script across holders into one upload', async () => {
        const app = nextApp();
        const source = sourceN('a');
        const { layers, created } = makeLayers(holders(10, 11));
        withSets(layers, {
            10: [{ name: 'a', source }],
            11: [{ name: 'a', source }],
        });
        const deployer = new EventsWorkerDeployer(layers);
        const script = scriptOf('a', source);

        await Promise.all([
            deployer.ensure(userScope(10, app), script),
            deployer.ensure(userScope(10, app), script),
            deployer.ensure(userScope(11, app), script),
            deployer.ensure(userScope(11, nextApp()), script),
        ]);
        expect(created).toHaveLength(1);
    });

    it('names a script for identical code the same under any holder and app', async () => {
        const source = sourceN('a');
        const { layers, created } = makeLayers(holders(10, 11));
        withSets(layers, {
            10: [{ name: '@x', source }],
            11: [{ name: '@x', source }],
        });
        const deployer = new EventsWorkerDeployer(layers);
        const script = scriptOf('@x', source);

        expect(await deployer.ensure(userScope(10, nextApp()), script)).toBe(
            'deployed',
        );
        expect(await deployer.ensure(userScope(11, nextApp()), script)).toBe(
            'deployed',
        );
        expect(created).toEqual([script, script]);
    });
});

describe('the deployed marker', () => {
    const setup = () => {
        const source = sourceN('a');
        const made = makeLayers(holders(10, 11));
        withSets(made.layers, {
            10: [{ name: 'a', source }],
            11: [{ name: 'a', source }],
        });
        return {
            ...made,
            deployer: new EventsWorkerDeployer(made.layers),
            script: scriptOf('a', source),
            app: nextApp(),
        };
    };

    it('is left by a user-scope deploy with a ttl under a day', async () => {
        const { deployer, redis, script, app } = setup();
        await deployer.ensure(userScope(10, app), script);
        const ttl = await redis.ttl(`ev:deployed:${script}`);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThan(24 * 60 * 60);
    });

    it('lets an eager deploy skip the upload another holder already made', async () => {
        const { deployer, created, script, app } = setup();
        expect(await deployer.deployEagerly(userScope(10, app), script)).toBe(
            'deployed',
        );
        expect(await deployer.deployEagerly(userScope(11, app), script)).toBe(
            'deployed',
        );
        expect(created).toEqual([script]);
    });

    it('spends no throttle on a skipped eager deploy', async () => {
        const { deployer, redis, script, app } = setup();
        await deployer.deployEagerly(userScope(10, app), script);
        await deployer.deployEagerly(userScope(11, app), script);
        const hour = new Date().toISOString().slice(0, 13);
        expect(await redis.get(`ev:deploys:{${app}}:11:${hour}`)).toBeNull();
    });

    it('never skips a deploy-on-miss', async () => {
        const { deployer, created, script, app } = setup();
        await deployer.deployEagerly(userScope(10, app), script);
        expect(await deployer.ensure(userScope(11, app), script)).toBe(
            'deployed',
        );
        expect(created).toEqual([script, script]);
    });

    it('is not left by an app-scope deploy', async () => {
        const app = nextApp();
        const source = sourceN('a');
        const { layers, redis, created } = makeLayers({
            [app]: { ownerUserId: 4 },
        });
        withSets(layers, { 0: [{ name: 'a', source }] });
        const deployer = new EventsWorkerDeployer(layers);
        const script = scriptOf('a', source);
        await deployer.ensure(appHandlerScope(app), script);
        expect(created).toEqual([script]);
        expect(await redis.get(`ev:deployed:${script}`)).toBeNull();
    });

    it('still deploys eagerly when the marker cannot be read', async () => {
        const { deployer, redis, created, script, app } = setup();
        await deployer.deployEagerly(userScope(10, app), script);
        const get = redis.get.bind(redis);
        redis.get = (async (key: string) => {
            if (key.startsWith('ev:deployed:')) throw new Error('down');
            return get(key);
        }) as never;
        expect(await deployer.deployEagerly(userScope(11, app), script)).toBe(
            'deployed',
        );
        expect(created).toEqual([script, script]);
    });
});

describe('scopeFor', () => {
    it('reads no holder as the app scope, and resolves a uuid to the user scope', async () => {
        const { layers } = makeLayers(holders(10));
        const deployer = new EventsWorkerDeployer(layers);
        expect(await deployer.scopeFor('app-u')).toEqual({
            appUid: 'app-u',
            holder: 0,
        });
        expect(await deployer.scopeFor('app-u', '')).toEqual({
            appUid: 'app-u',
            holder: 0,
        });
        expect(await deployer.scopeFor('app-u', 'uuid-10')).toEqual({
            appUid: 'app-u',
            holder: 10,
        });
        expect(await deployer.scopeFor('app-u', 'uuid-99')).toBeNull();
    });
});

describe('LocalEventsInvokeTransport in a user scope', () => {
    it('deploys the holder`s script on a miss and refuses an unknown holder', async () => {
        const source = sourceN('a');
        const { layers, created } = makeLayers(holders(10));
        withSets(layers, { 10: [{ name: 'a', source }] });
        const deployer = new EventsWorkerDeployer(layers);
        let resident = false;
        const transport = new LocalEventsInvokeTransport(
            {
                localworkerservice: {
                    dispatchEventsWorker: async () => {
                        if (!resident) return null;
                        return new Response(null, {
                            status: 200,
                            headers: { 'x-puter-events-handled': '1' },
                        });
                    },
                },
            } as never,
            {
                ensure: async (
                    scope: HandlerScope,
                    script: string,
                    options: EventsDeployOptions,
                ) => {
                    const outcome = await deployer.ensure(
                        scope,
                        script,
                        options,
                    );
                    resident = outcome === 'deployed';
                    return outcome;
                },
                scopeFor: (appUid: string, holder?: string) =>
                    deployer.scopeFor(appUid, holder),
            } as unknown as EventsWorkerDeployer,
        );
        const script = scriptOf('a', source);
        const call: EventsInvokeCall = {
            script,
            appUid: nextApp(),
            holder: 'uuid-10',
            key: 'k',
            body: '{}',
            timeoutMs: 5000,
        };

        await expect(transport.send(call)).resolves.toMatchObject({
            status: 200,
        });
        expect(created).toEqual([script]);

        resident = false;
        await expect(
            transport.send({ ...call, holder: 'uuid-99' }),
        ).resolves.toMatchObject({ status: null, error: 'deploy: no-holder' });
        expect(created).toEqual([script]);
    });
});

describe('concurrent eager deploys of one script', () => {
    const setup = () => {
        const source = sourceN('a');
        const made = makeLayers(holders(10, 11));
        withSets(made.layers, {
            10: [{ name: 'a', source }],
            11: [{ name: 'a', source }],
        });
        return {
            ...made,
            script: scriptOf('a', source),
            app: nextApp(),
        };
    };

    it('upload once when two holders publish the same new code together', async () => {
        const { layers, created, script, app } = setup();
        const deployer = new EventsWorkerDeployer(layers);

        const outcomes = await Promise.all([
            deployer.deployEagerly(userScope(10, app), script),
            deployer.deployEagerly(userScope(11, app), script),
        ]);

        expect(outcomes).toEqual(['deployed', 'deployed']);
        expect(created).toEqual([script]);
    });

    it('skip the upload when the marker appears while they wait on the gate', async () => {
        const { layers, redis, created, script, app } = setup();
        // Another node's deploy of the script finishes before the gate opens.
        const gated = new EventsWorkerDeployer({
            ...layers,
            services: {
                schedules: {
                    gateDeploy: async (
                        _script: string,
                        _options: { capped: boolean },
                        deploy: () => Promise<EventsDeployOutcome>,
                    ) => {
                        await redis.set(`ev:deployed:${script}`, '1');
                        return deploy();
                    },
                },
            },
        } as unknown as Layers);

        expect(
            await gated.ensure(userScope(10, app), script, { eager: true }),
        ).toBe('deployed');
        expect(created).toEqual([]);
        // A miss still uploads, whatever the marker says.
        expect(await gated.ensure(userScope(11, app), script)).toBe('deployed');
        expect(created).toEqual([script]);
    });

    it('make a miss that joins an eager deploy deploy after it', async () => {
        const { layers, redis, created, script, app } = setup();
        const deployer = new EventsWorkerDeployer(layers);
        await redis.set(`ev:deployed:${script}`, '1');

        const eager = deployer.ensure(userScope(10, app), script, {
            eager: true,
        });
        const miss = deployer.ensure(userScope(11, app), script);

        expect(await eager).toBe('deployed');
        expect(await miss).toBe('deployed');
        // The eager one skipped on the marker; the miss uploaded.
        expect(created).toEqual([script]);
    });
});
