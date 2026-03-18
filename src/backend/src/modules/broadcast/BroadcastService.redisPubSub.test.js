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

    it('re-emits only outer.gui/pub events from redis pubsub payloads', async () => {
        await redisClient.publish('broadcast.webhook.events', JSON.stringify({
            sourceId: 'other-instance',
            events: [
                { key: 'outer.gui.notif.message', data: { id: 'gui-1' }, meta: {} },
                { key: 'outer.pub.notice', data: { id: 'pub-1' }, meta: {} },
                { key: 'outer.cacheUpdate', data: { cacheKey: 'skip-me' }, meta: {} },
            ],
        }));

        await wait();

        expect(eventService.emit).toHaveBeenCalledTimes(2);
        expect(eventService.emit).toHaveBeenNthCalledWith(
            1,
            'outer.gui.notif.message',
            { id: 'gui-1' },
            expect.objectContaining({ from_outside: true }),
        );
        expect(eventService.emit).toHaveBeenNthCalledWith(
            2,
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
});
