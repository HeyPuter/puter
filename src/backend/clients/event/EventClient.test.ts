import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import type { EventClient } from './EventClient.js';

describe('EventClient', () => {
    let server: PuterServer;
    let target: EventClient;

    beforeAll(async () => {
        server = await setupTestServer();
        target = server.clients.event as unknown as EventClient;
    });

    afterAll(async () => {
        await server.shutdown();
    });

    // Each test gets a fresh key so listeners registered by earlier tests
    // never collide with later ones (the client has no public way to
    // unsubscribe).
    let key: string;
    beforeEach(() => {
        key = `test.${Math.random().toString(36).slice(2)}`;
    });

    describe('on / emit', () => {
        it('invokes a listener registered for the exact key', () => {
            const listener = vi.fn();
            target.on(key, listener);
            target.emit(key, { hello: 'world' }, { source: 'test' });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                key,
                { hello: 'world' },
                { source: 'test' },
            );
        });

        it('does not invoke listeners registered under a different key', () => {
            const other = vi.fn();
            target.on(`${key}.other`, other);
            target.emit(key, {}, {});
            expect(other).not.toHaveBeenCalled();
        });

        it('invokes every listener registered for the same key', () => {
            const a = vi.fn();
            const b = vi.fn();
            target.on(key, a);
            target.on(key, b);
            target.emit(key, {}, {});
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        });

        it('does nothing when emitting a key with no listeners', () => {
            // Just asserts that no exception is thrown.
            expect(() =>
                target.emit(`${key}.nobody-home`, {}, {}),
            ).not.toThrow();
        });

        it('continues firing later listeners after one throws', () => {
            const errSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const bad = vi.fn(() => {
                throw new Error('boom');
            });
            const good = vi.fn();
            target.on(key, bad);
            target.on(key, good);
            target.emit(key, {}, {});
            expect(bad).toHaveBeenCalledTimes(1);
            expect(good).toHaveBeenCalledTimes(1);
            errSpy.mockRestore();
        });
    });

    describe('wildcard subscriptions', () => {
        it('matches every dot-extended descendant of a wildcard prefix', () => {
            const listener = vi.fn();
            target.on(`${key}.*`, listener);
            target.emit(`${key}.foo`, { v: 1 }, {});
            target.emit(`${key}.foo.bar`, { v: 2 }, {});
            expect(listener).toHaveBeenCalledTimes(2);
            expect(listener).toHaveBeenNthCalledWith(
                1,
                `${key}.foo`,
                { v: 1 },
                {},
            );
            expect(listener).toHaveBeenNthCalledWith(
                2,
                `${key}.foo.bar`,
                { v: 2 },
                {},
            );
        });

        it('fires both wildcard and exact-key subscribers for one emit', () => {
            const wild = vi.fn();
            const exact = vi.fn();
            target.on(`${key}.*`, wild);
            target.on(`${key}.thing`, exact);
            target.emit(`${key}.thing`, {}, {});
            expect(wild).toHaveBeenCalledTimes(1);
            expect(exact).toHaveBeenCalledTimes(1);
        });

        it('does not fire a wildcard listener for the prefix itself', () => {
            const wild = vi.fn();
            target.on(`${key}.*`, wild);
            target.emit(key, {}, {});
            expect(wild).not.toHaveBeenCalled();
        });

        it('fires wildcards at every nesting level for a deep emit', () => {
            const top = vi.fn();
            const mid = vi.fn();
            target.on(`${key}.*`, top);
            target.on(`${key}.a.*`, mid);
            target.emit(`${key}.a.b.c`, {}, {});
            expect(top).toHaveBeenCalledTimes(1);
            expect(mid).toHaveBeenCalledTimes(1);
        });
    });

    describe('emitAndWait', () => {
        it('awaits async listeners before resolving', async () => {
            let resolved = false;
            target.on(key, async () => {
                await new Promise((r) => setTimeout(r, 10));
                resolved = true;
            });
            await target.emitAndWait(key, {}, {});
            expect(resolved).toBe(true);
        });

        it('runs listeners sequentially so later ones see earlier mutations', async () => {
            target.on(key, (_k, data) => {
                (data as { steps: string[] }).steps.push('first');
            });
            target.on(key, async (_k, data) => {
                await new Promise((r) => setTimeout(r, 5));
                (data as { steps: string[] }).steps.push('second');
            });
            const data = { steps: [] as string[] };
            await target.emitAndWait(key, data, {});
            expect(data.steps).toEqual(['first', 'second']);
        });

        it('continues the chain when a listener throws', async () => {
            const errSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const after = vi.fn();
            target.on(key, () => {
                throw new Error('boom');
            });
            target.on(key, after);
            await target.emitAndWait(key, {}, {});
            expect(after).toHaveBeenCalledTimes(1);
            errSpy.mockRestore();
        });

        it('awaits wildcard listeners too', async () => {
            let resolved = false;
            target.on(`${key}.*`, async () => {
                await new Promise((r) => setTimeout(r, 10));
                resolved = true;
            });
            await target.emitAndWait(`${key}.child`, {}, {});
            expect(resolved).toBe(true);
        });
    });

    describe('lifecycle hooks', () => {
        it('onServerStart emits a serverStart event', () => {
            const listener = vi.fn();
            target.on('serverStart', listener);
            target.onServerStart();
            expect(listener).toHaveBeenCalledWith('serverStart', {}, {});
        });

        it('onServerPrepareShutdown emits a serverPrepareShutdown event', () => {
            const listener = vi.fn();
            target.on('serverPrepareShutdown', listener);
            target.onServerPrepareShutdown();
            expect(listener).toHaveBeenCalledWith(
                'serverPrepareShutdown',
                {},
                {},
            );
        });

        it('onServerShutdown emits a serverShutdown event', () => {
            const listener = vi.fn();
            target.on('serverShutdown', listener);
            target.onServerShutdown();
            expect(listener).toHaveBeenCalledWith('serverShutdown', {}, {});
        });
    });
});
