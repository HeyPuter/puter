import { beforeEach, describe, expect, it } from 'vitest';
import { redisClient } from '../../../clients/redis/redisSingleton.js';
import { Context } from '../../../util/context.js';
import { ConcurrentRequestLimiter } from './ConcurrentRequestLimiter.js';

const createId = () =>
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const setSubscriptionResolver = (subscriptionId = '') => {
    Context.root.set('services', {
        get: (serviceName: string) => {
            if ( serviceName !== 'event' ) return undefined;
            return {
                emit: async (
                    eventName: string,
                    payload: { userSubscriptionId?: string },
                ) => {
                    if ( eventName === 'metering:getUserSubscription' ) {
                        payload.userSubscriptionId = subscriptionId;
                    }
                },
            };
        },
    });
};

describe('ConcurrentRequestLimiter', () => {
    beforeEach(() => {
        setSubscriptionResolver();
    });

    it('registers simple limit config', async () => {
        const limiter = new ConcurrentRequestLimiter({ redis: redisClient });
        const key = `test.simple.${createId()}`;
        limiter.registerLimitKey(key, { limit: 2 });

        const first = await limiter.checkAndIncrementConcurrent({
            key,
            actor: {
                type: {
                    user: {
                        uuid: 'simple-user',
                        email: 'user@puter.dev',
                        email_confirmed: true,
                        password: 'hashed',
                    },
                },
            },
        });

        expect(first.allowed).toBe(true);
        await limiter.decrementConcurrent(first.permit);
    });

    it('enforces grouped limits from actor user group', async () => {
        const limiter = new ConcurrentRequestLimiter({ redis: redisClient });
        const key = `test.grouped.${createId()}`;
        limiter.registerLimitKey(key, {
            temp_free: { limit: 1 },
            user_free: { limit: 2 },
            default: { limit: 2 },
        });

        const tmpActor = {
            type: {
                user: {
                    uuid: 'tmp-user',
                    email: null,
                    password: null,
                },
            },
        };

        const first = await limiter.checkAndIncrementConcurrent({
            key,
            actor: tmpActor,
        });
        const second = await limiter.checkAndIncrementConcurrent({
            key,
            actor: tmpActor,
        });

        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(false);

        await limiter.decrementConcurrent(first.permit);
    });

    it('decrementConcurrent releases permit for later calls', async () => {
        const limiter = new ConcurrentRequestLimiter({ redis: redisClient });
        const key = `test.release.${createId()}`;
        limiter.registerLimitKey(key, {
            user_free: { limit: 1 },
            default: { limit: 1 },
        });

        const actor = {
            type: {
                user: {
                    uuid: 'free-user',
                    email: 'free@puter.dev',
                    email_confirmed: true,
                    password: 'hashed',
                },
            },
        };

        const first = await limiter.checkAndIncrementConcurrent({
            key,
            actor,
        });
        expect(first.allowed).toBe(true);

        const blocked = await limiter.checkAndIncrementConcurrent({
            key,
            actor,
        });
        expect(blocked.allowed).toBe(false);

        await limiter.decrementConcurrent(first.permit);

        const allowedAgain = await limiter.checkAndIncrementConcurrent({
            key,
            actor,
        });
        expect(allowedAgain.allowed).toBe(true);

        await limiter.decrementConcurrent(allowedAgain.permit);
    });

    it('maps paid group from active paid subscription tier', async () => {
        const limiter = new ConcurrentRequestLimiter({ redis: redisClient });
        const key = `test.paid.${createId()}`;
        setSubscriptionResolver('basic');

        limiter.registerLimitKey(key, {
            temp_free: { limit: 1 },
            user_free: { limit: 1 },
            basic: { limit: 2 },
            default: { limit: 1 },
        });

        const actor = {
            type: {
                user: {
                    uuid: 'paid-user',
                    email: 'paid@puter.dev',
                    email_confirmed: false,
                },
            },
        };

        const first = await limiter.checkAndIncrementConcurrent({
            key,
            actor,
        });
        const second = await limiter.checkAndIncrementConcurrent({
            key,
            actor,
        });
        const third = await limiter.checkAndIncrementConcurrent({
            key,
            actor,
        });

        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(true);
        expect(third.allowed).toBe(false);

        await limiter.decrementConcurrent(first.permit);
        await limiter.decrementConcurrent(second.permit);
    });
});
