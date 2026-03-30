import crypto from 'crypto';
import { Cluster } from 'ioredis';
import { redisClient } from '../../../clients/redis/redisSingleton.js';
import { Context } from '../../../util/context.js';
import { Actor } from '../../auth/Actor.js';
import { DEFAULT_FREE_SUBSCRIPTION, DEFAULT_TEMP_SUBSCRIPTION } from '../../MeteringService/consts.js';
import type {
    CheckAndIncrementConcurrentOptions,
    ConcurrentLimitConfig,
    ConcurrentPermit,
    GroupLimitConfig,
    SimpleLimitConfig,
} from './types.js';

const defaultLeaseMs = 60 * 1000;
const maxAcquireAttempts = 5;

const tempGroup = DEFAULT_TEMP_SUBSCRIPTION;
const freeGroup = DEFAULT_FREE_SUBSCRIPTION;

const hasOwn = (object: unknown, key: string): boolean => {
    if ( !object || typeof object !== 'object' ) return false;
    return Object.prototype.hasOwnProperty.call(object, key);
};

const isPositiveFiniteNumber = (value: unknown): value is number =>
    Number.isFinite(value) && Number(value) > 0;

const isSimpleLimitConfig = (
    config: ConcurrentLimitConfig,
): config is SimpleLimitConfig =>
    hasOwn(config, 'limit') &&
    isPositiveFiniteNumber((config as SimpleLimitConfig).limit);

const isGroupLimitConfig = (
    config: ConcurrentLimitConfig,
): config is GroupLimitConfig => {
    if ( typeof config !== 'object' || config === null || Array.isArray(config) ) {
        return false;
    }
    if ( hasOwn(config, 'limit') ) {
        return false;
    }
    const groups = Object.keys(config);
    if ( groups.length === 0 ) return false;
    for ( const group of groups ) {
        const groupConfig = (config as GroupLimitConfig)[group];
        if ( !groupConfig || !isPositiveFiniteNumber(groupConfig.limit) ) {
            return false;
        }
    }
    return true;
};

const cloneLimitConfig = (config: ConcurrentLimitConfig): ConcurrentLimitConfig =>
    JSON.parse(JSON.stringify(config)) as ConcurrentLimitConfig;

// TODO DS: expand this to block at middleware layer
export class ConcurrentRequestLimiter {
    #redis: Cluster;
    #limitsByKey: Map<string, ConcurrentLimitConfig>;

    get #eventService () {
        return Context.get('services').get('event');
    }

    constructor ({ redis = redisClient }: { redis?: Cluster } = {}) {
        this.#redis = redis;
        this.#limitsByKey = new Map();
    }

    #isTemporaryUser (actor: Actor) {
        const user = actor?.type?.user;
        if ( ! user ) return true;
        return !(user.email) || !(user.email_confirmed);
    };

    async #getActorUserGroup (actor: Actor, noSub = false) {
        const userSubscriptionEvent = { actor, userSubscriptionId: '' };
        if ( ! noSub ) {
            await this.#eventService.emit('metering:getUserSubscription', userSubscriptionEvent); // will set userSubscription property on event
        }

        if ( userSubscriptionEvent.userSubscriptionId && !noSub ) {
            return userSubscriptionEvent.userSubscriptionId;
        }

        if ( this.#isTemporaryUser(actor) ) {
            return tempGroup;
        }

        return freeGroup;
    };

    registerLimitKey (key: string, config: ConcurrentLimitConfig): void {
        if ( typeof key !== 'string' || key.length === 0 ) {
            throw new TypeError('key must be a non-empty string');
        }

        if ( !isSimpleLimitConfig(config) && !isGroupLimitConfig(config) ) {
            throw new TypeError(
                'config must be {limit:number} or {[userGroup]:{limit:number}}',
            );
        }

        this.#limitsByKey.set(key, cloneLimitConfig(config));
    }

    hasLimitKey (key: string): boolean {
        return this.#limitsByKey.has(key);
    }

    async checkAndIncrementConcurrent (
        options: CheckAndIncrementConcurrentOptions,
    ) {
        const { actor, key } = options;
        const leaseMs = options.leaseMs ?? defaultLeaseMs;

        if ( typeof key !== 'string' || key.length === 0 ) {
            throw new TypeError('key must be a non-empty string');
        }
        if ( ! isPositiveFiniteNumber(leaseMs) ) {
            throw new TypeError('leaseMs must be a positive number');
        }

        const userId = actor?.type?.user?.uuid;
        if ( ! userId ) {
            throw new Error('actor user id is required for concurrency checks');
        }

        const userGroup = await this.#getActorUserGroup(actor);
        const limit = this.#resolveLimit({ key, userGroup });
        const redisKey = this.#toRedisKey({ key, userId });
        const token = this.#createToken();

        for ( let attempt = 0; attempt < maxAcquireAttempts; attempt++ ) {
            const now = Date.now();
            const expiresAt = now + leaseMs;

            await this.#redis.zremrangebyscore(redisKey, '-inf', now);
            await this.#redis.watch(redisKey);
            try {
                const activeCountRaw = await this.#redis.zcard(redisKey);
                const activeCount = Number(activeCountRaw) || 0;
                if ( activeCount >= limit ) {
                    await this.#redis.unwatch();
                    return {
                        allowed: false,
                        limit,
                        activeCount,
                        userGroup,
                    };
                }

                const transaction = this.#redis.multi();
                transaction.zadd(redisKey, expiresAt, token);
                transaction.pexpire(redisKey, leaseMs);
                const transactionResult = await transaction.exec();

                if ( transactionResult === null ) {
                    continue;
                }

                const permit: ConcurrentPermit = {
                    key,
                    redisKey,
                    token,
                    userId,
                    userGroup,
                    limit,
                    expiresAt,
                };

                return {
                    allowed: true,
                    limit,
                    activeCount: activeCount + 1,
                    userGroup,
                    permit,
                };
            } catch ( error: unknown ) {
                await this.#redis.unwatch();
                throw error;
            }
        }

        throw new Error(
            `failed to acquire concurrency permit for ${key} after ${maxAcquireAttempts} attempts`,
        );
    }

    async decrementConcurrent (
        permit: ConcurrentPermit | null | undefined,
    ): Promise<void> {
        if ( ! permit ) return;
        if ( !permit.redisKey || !permit.token ) return;
        await this.#redis.zrem(permit.redisKey, permit.token);
    }

    #resolveLimit ({
        key,
        userGroup,
    }: {
        key: string;
        userGroup: string;
    }): number {
        const config = this.#limitsByKey.get(key);
        if ( ! config ) {
            throw new Error(`no concurrent limit config for key: ${key}`);
        }

        if ( isSimpleLimitConfig(config) ) {
            return config.limit;
        }

        if ( hasOwn(config, userGroup) ) {
            return config[userGroup].limit;
        }

        if ( hasOwn(config, 'default') ) {
            return config.default.limit;
        }

        throw new Error(
            `no concurrent limit group config for key: ${key} and userGroup: ${userGroup}`,
        );
    }

    #toRedisKey ({
        key,
        userId,
    }: {
        key: string;
        userId: string;
    }): string {
        return `concurrency:${encodeURIComponent(key)}:${encodeURIComponent(userId)}`;
    }

    #createToken (): string {
        if ( typeof crypto.randomUUID === 'function' ) {
            return crypto.randomUUID();
        }
        return crypto.randomBytes(16).toString('hex');
    }
}
