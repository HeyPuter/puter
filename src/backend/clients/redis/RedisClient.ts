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

import Redis, { Cluster, Command, ReplyError } from 'ioredis';
import MockRedis from 'ioredis-mock';
import type { IConfig, WithLifecycle } from '../../types';
import {
    isCommandTimeout,
    isSendingUndo,
    REDIS_UNAVAILABLE_MESSAGE,
} from './commandTimeout';

const redisStartupRetryMaxDelayMs = 2000;
const redisSlotsRefreshTimeoutMs = 5000;
const redisConnectTimeoutMs = 10000;
const defaultCommandTimeoutMs = 2000;
const defaultFailFastMs = 5000;
const redisBootRetryRegex =
    /Cluster(All)?FailedError|None of startup nodes is available/i;

const formatRedisError = (error: unknown): string => {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
};

const attachClusterEventHandlers = (clusterClient: Cluster): void => {
    clusterClient.once('connect', () => {
        console.log('[redis] cluster transport connected');
    });

    clusterClient.once('ready', () => {
        console.log('[redis] cluster ready');
    });

    clusterClient.on('error', (error: unknown) => {
        const errorText = formatRedisError(error);
        if (redisBootRetryRegex.test(errorText)) {
            console.warn(
                `[redis] startup issue while connecting to cluster; retrying automatically (${errorText})`,
            );
            return;
        }
        console.error('[redis] cluster error', error);
    });

    clusterClient.on('node error', (error: unknown, nodeKey: string) => {
        const errorText = formatRedisError(error);
        if (redisBootRetryRegex.test(errorText)) {
            console.warn(
                `[redis] startup issue for cluster node ${nodeKey}; retrying automatically (${errorText})`,
            );
            return;
        }
        console.error(`[redis] cluster node error (${nodeKey})`, error);
    });
};

// A timed-out command is not withdrawn: queued or sent, it may still run.
class TimedCluster extends Redis.Cluster {
    commandTimeoutMs = 0;
    failFastMs = 0;
    #openUntil = 0;
    #probing = false;
    // The offline queue re-enters sendCommand; admit each command once.
    #admitted = new WeakSet<Command>();
    // A pipeline writes only once all its commands are in; admit all or none.
    #pipelines = new WeakMap<object, boolean>();

    constructor(...args: ConstructorParameters<typeof Redis.Cluster>) {
        super(...args);
        this.on('ready', () => this.#close());
    }

    override sendCommand(...args: Parameters<Cluster['sendCommand']>) {
        const [command, stream] = args;
        if (
            this.commandTimeoutMs <= 0 ||
            Command.checkFlag('BLOCKING_COMMANDS', command.name)
        ) {
            return super.sendCommand(...args);
        }
        // Pipeline retries resend commands whose error reply cleared the timer.
        if (this.#admitted.has(command) || command.name === 'asking') {
            this.#admitted.add(command);
            command.setTimeout(this.commandTimeoutMs);
            return super.sendCommand(...args);
        }
        const pipeline = (stream as { isPipeline?: boolean } | undefined)
            ?.isPipeline
            ? (stream as object)
            : null;
        let admit = pipeline ? this.#pipelines.get(pipeline) : undefined;
        let probe = false;
        if (admit === undefined) {
            ({ admit, probe } = this.#admit(command.name));
            if (pipeline) this.#pipelines.set(pipeline, admit);
        }
        if (!admit) {
            command.reject(new Error(REDIS_UNAVAILABLE_MESSAGE));
            return command.promise;
        }
        this.#admitted.add(command);
        // Not redisOptions.commandTimeout: that misses the cluster's queue.
        command.setTimeout(this.commandTimeoutMs);
        command.promise.then(
            () => this.#settled(probe, 'answered'),
            (error: unknown) =>
                this.#settled(
                    probe,
                    error instanceof ReplyError
                        ? 'answered'
                        : isCommandTimeout(error)
                          ? 'timedOut'
                          : 'failed',
                ),
        );
        return super.sendCommand(...args);
    }

    #admit(name: string): { admit: boolean; probe: boolean } {
        // The ready check sends CLUSTER INFO; failing it would block 'ready'.
        if (this.#openUntil === 0 || isSendingUndo() || name === 'cluster') {
            return { admit: true, probe: false };
        }
        if (this.#probing || Date.now() < this.#openUntil) {
            return { admit: false, probe: false };
        }
        this.#probing = true;
        return { admit: true, probe: true };
    }

    #settled(
        probe: boolean,
        outcome: 'answered' | 'timedOut' | 'failed',
    ): void {
        if (probe) this.#probing = false;
        if (outcome === 'answered') return this.#close();
        // No reply either way, but only a timeout starts failing fast.
        if (outcome === 'failed' && this.#openUntil === 0) return;
        if (this.failFastMs <= 0) return;
        if (this.#openUntil === 0) {
            console.warn(
                `[redis] no reply within ${this.commandTimeoutMs}ms; failing fast, probing every ${this.failFastMs}ms`,
            );
        }
        this.#openUntil = Date.now() + this.failFastMs;
    }

    #close(): void {
        if (this.#openUntil === 0) return;
        this.#openUntil = 0;
        this.#probing = false;
        console.log('[redis] replies resumed; no longer failing fast');
    }
}

const buildCluster = (config: IConfig): Cluster => {
    const redisConfig = config.redis ?? {};
    const startupNodes = redisConfig.startupNodes ?? [];
    const useMock = redisConfig.useMock ?? startupNodes.length === 0;

    if (useMock) {
        console.log('connected to local redis mock');
        return new MockRedis.Cluster([
            'redis://localhost:7001',
        ]) as unknown as Cluster;
    }

    // TLS defaults on (matches the existing prod ElastiCache behavior).
    // Self-hosters running cluster mode against a plain-TCP Valkey set
    // `redis.tls: false` to opt out.
    const tlsEnabled = redisConfig.tls !== false;

    const cluster = new TimedCluster(
        startupNodes as ConstructorParameters<typeof Redis.Cluster>[0],
        {
            dnsLookup: (address, callback) => callback(null, address),
            clusterRetryStrategy: (attempts) =>
                Math.min(100 + attempts * 100, redisStartupRetryMaxDelayMs),
            retryDelayOnFailover: 50,
            retryDelayOnClusterDown: 50,
            retryDelayOnTryAgain: 50,
            slotsRefreshTimeout: redisSlotsRefreshTimeoutMs,
            enableOfflineQueue: true,
            redisOptions: {
                ...(tlsEnabled ? { tls: {} } : {}),
                connectTimeout: redisConnectTimeoutMs,
                maxRetriesPerRequest: 1,
            },
        },
    );
    cluster.commandTimeoutMs =
        redisConfig.commandTimeoutMs ?? defaultCommandTimeoutMs;
    cluster.failFastMs = redisConfig.failFastMs ?? defaultFailFastMs;
    attachClusterEventHandlers(cluster);
    console.log('connecting to redis from config');
    return cluster;
};

/**
 * The ioredis `Cluster` itself, with lifecycle methods attached; the
 * constructor below returns it.
 */
export type RedisClient = Cluster & WithLifecycle;

export const RedisClient = class RedisClient {
    constructor(config: IConfig) {
        const cluster = buildCluster(config);

        const onServerShutdown = async (): Promise<void> => {
            try {
                await cluster.quit();
            } catch (error) {
                console.warn(
                    '[redis] failed to quit redis client cleanly',
                    error,
                );
                cluster.disconnect();
            }
        };

        // Attach lifecycle hooks directly onto the cluster instance so the
        // server boot loop's `if (client.onServerShutdown) client.onServerShutdown()`
        // picks them up without a wrapper object.
        Object.assign(cluster, { onServerShutdown });

        return cluster as unknown as RedisClient;
    }
} as unknown as new (config: IConfig) => RedisClient;
