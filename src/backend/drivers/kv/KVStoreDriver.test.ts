import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Actor } from '../../core/actor.ts';
import { runWithContext } from '../../core/context.ts';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import type { KVStoreDriver } from './KVStoreDriver.ts';

describe('KVStoreDriver', () => {
    let server: PuterServer;
    let target: KVStoreDriver;
    beforeAll(async () => {
        server = await setupTestServer();
        target = server.drivers.kvStore;
    });
    const testActor: Actor = {
        user: {
            uuid: 'test-user',
            username: 'test-user',
            id: 1,
            email: 'test@test.com',
            email_confirmed: true,
        },
        app: {
            uid: 'test-app',
            id: 1,
        },
    };

    it('should set and get a value in the right scope', async () => {
        const res = await runWithContext({ actor: testActor }, async () => {
            const key = 'test-key';
            const value = 'test-value';
            await target.set({ key, value });
            return await target.get({ key });
        });
        expect(res).toBe('test-value');
    });

    afterAll(async () => {
        await server.shutdown();
    });
});
