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

import type { Command } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSilentRedis } from '../../testFixtures/silentRedis';
import type { IConfig } from '../../types';
import { sendAsUndo } from './commandTimeout';
import { RedisClient } from './RedisClient';

const config = (redis: Record<string, unknown>): IConfig =>
    ({ port: 0, extensions: [], redis }) as unknown as IConfig;

type ClusterOptions = {
    redisOptions?: { tls?: unknown; connectTimeout?: number };
    clusterRetryStrategy?: (attempts: number) => number;
};

const optionsOf = (client: RedisClient): ClusterOptions =>
    (client as unknown as { options: ClusterOptions }).options;

describe('RedisClient — in-process mock', () => {
    let client: RedisClient | null = null;

    afterEach(async () => {
        if (client) await client.onServerShutdown();
        client = null;
    });

    it('falls back to the mock when no startup nodes are configured', async () => {
        client = new RedisClient(config({}));
        await client.set('greeting', 'hello');
        await expect(client.get('greeting')).resolves.toBe('hello');
    });

    it('honours an explicit mock request even with startup nodes present', async () => {
        client = new RedisClient(
            config({
                useMock: true,
                startupNodes: [{ host: 'redis.internal', port: 6379 }],
            }),
        );
        await client.set('k', 'v');
        await expect(client.get('k')).resolves.toBe('v');
    });

    it('exposes the shutdown hook directly on the cluster instance', () => {
        client = new RedisClient(config({}));
        expect(typeof client.onServerShutdown).toBe('function');
    });

    it('disconnects when a clean quit fails', async () => {
        const instance = new RedisClient(config({}));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(instance, 'quit').mockRejectedValue(new Error('quit refused'));
        const disconnect = vi.spyOn(instance, 'disconnect');

        await instance.onServerShutdown();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            '[redis] failed to quit redis client cleanly',
            expect.any(Error),
        );
        warn.mockRestore();
    });
});

describe('RedisClient — real cluster wiring', () => {
    let client: RedisClient | null = null;

    afterEach(() => {
        client?.disconnect();
        client = null;
    });

    const startupNodes = [{ host: '127.0.0.1', port: 7001 }];

    it('enables TLS by default and bounds the connect timeout', () => {
        client = new RedisClient(config({ startupNodes }));
        expect(optionsOf(client).redisOptions?.tls).toEqual({});
        expect(optionsOf(client).redisOptions?.connectTimeout).toBe(10000);
    });

    it('lets a plain-TCP deployment opt out of TLS', () => {
        client = new RedisClient(config({ startupNodes, tls: false }));
        expect(optionsOf(client).redisOptions?.tls).toBeUndefined();
    });

    it('backs off on cluster retries up to a ceiling', () => {
        client = new RedisClient(config({ startupNodes, tls: false }));
        const retry = optionsOf(client).clusterRetryStrategy!;
        expect(retry(0)).toBe(100);
        expect(retry(5)).toBe(600);
        expect(retry(100)).toBe(2000);
    });

    it('treats startup churn as a warning and everything else as an error', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        client = new RedisClient(config({ startupNodes, tls: false }));

        client.emit('error', new Error('None of startup nodes is available'));
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('startup issue while connecting'),
        );

        const fatal = new Error('WRONGPASS invalid credentials');
        client.emit('error', fatal);
        expect(error).toHaveBeenCalledWith('[redis] cluster error', fatal);

        warn.mockRestore();
        error.mockRestore();
    });

    it('applies the same triage to per-node errors', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        client = new RedisClient(config({ startupNodes, tls: false }));

        const transient = new Error('boom');
        transient.name = 'ClusterAllFailedError';
        client.emit('node error', transient, '127.0.0.1:7001');
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(
                'startup issue for cluster node 127.0.0.1:7001',
            ),
        );

        const fatal = new Error('node exploded');
        client.emit('node error', fatal, '127.0.0.1:7002');
        expect(error).toHaveBeenCalledWith(
            '[redis] cluster node error (127.0.0.1:7002)',
            fatal,
        );

        // Non-Error payloads are stringified rather than crashing the handler.
        client.emit('node error', 'None of startup nodes is available', 'n3');
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('startup issue for cluster node n3'),
        );

        warn.mockRestore();
        error.mockRestore();
    });

    it('logs the transport lifecycle once each', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        client = new RedisClient(config({ startupNodes, tls: false }));

        client.emit('connect');
        client.emit('ready');

        expect(log).toHaveBeenCalledWith('[redis] cluster transport connected');
        expect(log).toHaveBeenCalledWith('[redis] cluster ready');
        log.mockRestore();
    });
});

describe('RedisClient — command timeout', () => {
    let client: RedisClient | null = null;
    let silent: Awaited<ReturnType<typeof startSilentRedis>> | null = null;

    afterEach(async () => {
        client?.disconnect();
        client = null;
        await silent?.close();
        silent = null;
        vi.restoreAllMocks();
    });

    const connect = async (clusterReady: boolean, failFastMs = 0) => {
        silent = await startSilentRedis(clusterReady);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        client = new RedisClient(
            config({
                startupNodes: [{ host: '127.0.0.1', port: silent.port }],
                tls: false,
                commandTimeoutMs: 200,
                failFastMs,
            }),
        );
        return client;
    };

    const ready = async (failFastMs: number) => {
        const redis = await connect(true, failFastMs);
        await new Promise<void>((r) => redis.once('ready', () => r()));
        return redis;
    };

    it('rejects commands unsent for a while after one times out', async () => {
        const redis = await ready(60_000);
        await expect(redis.set('a', '1')).rejects.toThrow('Command timed out');

        const started = Date.now();
        for (const key of ['b', 'c', 'd']) {
            await expect(redis.get(key)).rejects.toThrow('Redis unavailable');
        }
        expect(Date.now() - started).toBeLessThan(250);
        const piped = await redis.pipeline().get('e').get('f').exec();
        expect(piped!.map(([error]) => error?.message)).toEqual([
            'Redis unavailable',
            'Redis unavailable',
        ]);
        await expect(
            redis.multi().set('g', '1').get('g').exec(),
        ).rejects.toThrow();
        expect(silent!.seen).toEqual(['set']);
    }, 5000);

    it('closes once a probe after the interval gets a reply', async () => {
        const redis = await ready(300);
        await expect(redis.set('a', '1')).rejects.toThrow('Command timed out');
        await expect(redis.get('b')).rejects.toThrow('Redis unavailable');

        silent!.answer();
        await new Promise((r) => setTimeout(r, 350));
        await expect(redis.get('c')).resolves.toBeNull();
        await expect(redis.get('d')).resolves.toBeNull();
        expect(silent!.seen).toEqual(['set', 'get', 'get']);
    }, 5000);

    it('sends an undo past the open breaker, behind the original', async () => {
        const redis = await ready(60_000);
        await expect(redis.set('lock', 't')).rejects.toThrow(
            'Command timed out',
        );
        await expect(redis.get('lock')).rejects.toThrow('Redis unavailable');

        const undo = sendAsUndo(() => redis.eval('return 1', 1, 'lock', 't'));
        silent!.answer();
        await expect(undo).resolves.toBe(1);
        expect(silent!.seen).toEqual(['set', 'eval']);
    }, 5000);

    it('times out a pipeline retried after MOVED replies onto a stalled node', async () => {
        silent = await startSilentRedis(true, { moved: 2 });
        client = new RedisClient(
            config({
                startupNodes: [{ host: '127.0.0.1', port: silent.port }],
                tls: false,
                commandTimeoutMs: 200,
                failFastMs: 0,
            }),
        );
        const redis = client;
        await new Promise<void>((r) => redis.once('ready', () => r()));

        const piped = await redis.pipeline().get('a{x}').get('b{x}').exec();
        expect(piped!.map(([error]) => error?.message)).toEqual([
            'Command timed out',
            'Command timed out',
        ]);
        expect(silent.seen).toEqual(['get', 'get', 'get', 'get']);
    }, 5000);

    it('stays open when a probe fails without a reply', async () => {
        const redis = await ready(300);
        await expect(redis.set('a', '1')).rejects.toThrow('Command timed out');
        await new Promise((r) => setTimeout(r, 350));

        const base = Object.getPrototypeOf(Object.getPrototypeOf(redis));
        const closed = vi
            .spyOn(base, 'sendCommand')
            .mockImplementationOnce((command: Command) => {
                command.reject(new Error('Connection is closed.'));
                return command.promise;
            });
        await expect(redis.get('b')).rejects.toThrow('Connection is closed.');
        closed.mockRestore();

        await expect(redis.get('c')).rejects.toThrow('Redis unavailable');
        expect(silent!.seen).toEqual(['set']);
    }, 5000);

    it('keeps sending every command when failFastMs is 0', async () => {
        const redis = await ready(0);
        await expect(redis.set('a', '1')).rejects.toThrow('Command timed out');
        await expect(redis.get('b')).rejects.toThrow('Command timed out');
        expect(silent!.seen).toEqual(['set', 'get']);
    }, 5000);

    it('rejects a command sent to a node that never answers', async () => {
        const redis = await connect(true);
        await new Promise<void>((r) => redis.once('ready', () => r()));

        const started = Date.now();
        await expect(redis.get('k')).rejects.toThrow('Command timed out');
        expect(Date.now() - started).toBeLessThan(2000);
    }, 5000);

    it('rejects a command queued while the cluster never becomes ready', async () => {
        const redis = await connect(false);

        await expect(redis.set('k', 'v')).rejects.toThrow('Command timed out');
        expect(redis.status).not.toBe('ready');
    }, 5000);

    it('leaves duplicate() clients without the timeout', async () => {
        const redis = await connect(false);
        const sub = redis.duplicate();
        try {
            const outcome = await Promise.race([
                sub.get('k').then(
                    () => 'settled',
                    () => 'settled',
                ),
                new Promise((r) => setTimeout(r, 600, 'pending')),
            ]);
            expect(outcome).toBe('pending');
        } finally {
            sub.disconnect();
        }
    }, 5000);

    it('defaults to a 2000 ms timeout and 5000 ms of failing fast', () => {
        client = new RedisClient(
            config({
                startupNodes: [{ host: '127.0.0.1', port: 7001 }],
                tls: false,
            }),
        );
        expect(
            (client as unknown as { commandTimeoutMs: number })
                .commandTimeoutMs,
        ).toBe(2000);
        expect((client as unknown as { failFastMs: number }).failFastMs).toBe(
            5000,
        );
    });
});
