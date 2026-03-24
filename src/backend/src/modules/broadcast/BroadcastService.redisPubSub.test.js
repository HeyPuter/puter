import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { redisClient } from '../../clients/redis/redisSingleton.js';
import { BroadcastService } from './BroadcastService.js';

const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

describe('BroadcastService redis pubsub', () => {
    let eventService;
    let service;

    beforeAll(async () => {
        eventService = {
            on: vi.fn(),
            emit: vi.fn(async () => {
            }),
        };

        service = new BroadcastService({
            services: {
                get: (name) => {
                    if ( name === 'event' ) return eventService;
                    throw new Error(`unexpected service lookup: ${name}`);
                },
            },
            config: {
                domain: 'puter.com',
                protocol: 'https',
                server_id: 'test-broadcast-a',
                services: {
                    broadcast: {
                        peers: [],
                    },
                },
            },
            name: 'broadcast',
            args: {},
            context: {
                get: () => ({ use: () => ({}) }),
            },
        });

        await service._init();
    });

    afterAll(async () => {
    });

    beforeEach(() => {
        eventService.emit.mockClear();
    });

    it('re-emits only outer.pub events from redis pubsub payloads', async () => {
        await redisClient.publish('broadcast.webhook.events', JSON.stringify({
            sourceId: 'other-instance',
            events: [
                { key: 'outer.gui.notif.message', data: { id: 'gui-1' }, meta: {} },
                { key: 'outer.pub.notice', data: { id: 'pub-1' }, meta: {} },
                { key: 'outer.cacheUpdate', data: { cacheKey: 'skip-me' }, meta: {} },
            ],
        }));

        await wait();

        expect(eventService.emit).toHaveBeenCalledTimes(1);
        expect(eventService.emit).toHaveBeenNthCalledWith(
            1,
            'outer.pub.notice',
            { id: 'pub-1' },
            expect.objectContaining({ from_outside: true }),
        );
    });

    it('ignores malformed redis pubsub payloads', async () => {
        await redisClient.publish('broadcast.webhook.events', 'not-json');
        await wait();

        await redisClient.publish('broadcast.webhook.events', JSON.stringify({
            sourceId: 'other-instance',
            events: [{ bad: 'shape' }],
        }));
        await wait();

        expect(eventService.emit).not.toHaveBeenCalled();
    });

    it('publishes local outer.pub events to redis pubsub for replicas', async () => {
        const publishSpy = vi.spyOn(redisClient, 'publish');
        try {
            await service.outBroadcastEventHandler('outer.pub.notice', { id: 'pub-local' }, {});
            await wait();

            const publishCall = publishSpy.mock.calls.find(([channel]) => channel === 'broadcast.webhook.events');
            expect(publishCall).toBeDefined();
            const [channel, payload] = publishCall;
            expect(channel).toBe('broadcast.webhook.events');

            const parsedPayload = JSON.parse(payload);
            expect(parsedPayload.sourceId).toBeDefined();
            expect(parsedPayload.events).toEqual([
                {
                    key: 'outer.pub.notice',
                    data: { id: 'pub-local' },
                    meta: {},
                },
            ]);
        } finally {
            publishSpy.mockRestore();
        }
    });

    it('does not publish local outer.gui events to redis pubsub', async () => {
        const publishSpy = vi.spyOn(redisClient, 'publish');
        try {
            await service.outBroadcastEventHandler('outer.gui.notif.message', { id: 'gui-local' }, {});
            await wait();

            const publishCall = publishSpy.mock.calls.find(([channel]) => channel === 'broadcast.webhook.events');
            expect(publishCall).toBeUndefined();
        } finally {
            publishSpy.mockRestore();
        }
    });

    it('does not rebroadcast events marked from_outside', async () => {
        const publishSpy = vi.spyOn(redisClient, 'publish');
        try {
            await service.outBroadcastEventHandler('outer.gui.notif.message', { id: 'outside' }, {
                from_outside: true,
            });
            await wait();

            expect(publishSpy).not.toHaveBeenCalled();
        } finally {
            publishSpy.mockRestore();
        }
    });

    it('ignores redis pubsub payloads with this instance sourceId', async () => {
        const publishSpy = vi.spyOn(redisClient, 'publish');
        try {
            await service.outBroadcastEventHandler('outer.pub.notice', { id: 'self-source' }, {});
            await wait();

            const publishCall = publishSpy.mock.calls.find(([channel]) => channel === 'broadcast.webhook.events');
            expect(publishCall).toBeDefined();
            const [_channel, payload] = publishCall;

            eventService.emit.mockClear();
            await redisClient.publish('broadcast.webhook.events', payload);
            await wait();

            expect(eventService.emit).not.toHaveBeenCalled();
        } finally {
            publishSpy.mockRestore();
        }
    });
});
