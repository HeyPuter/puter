import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';
import { makeActor } from '../../core/actor.js';

describe('kv', () => {
    let appToken = '';

    const kv = (
        method: string,
        args: Record<string, unknown>,
        token?: string,
    ) =>
        env.request('/drivers/call', {
            json: { interface: 'puter-kvstore', method, args },
            token,
        });

    const seed = async (env: BenchEnv) => {
        const put = (keys: string[], token?: string) =>
            kv(
                'batchPut',
                {
                    items: keys.map((key) => ({
                        key,
                        value: `value of ${key}`,
                    })),
                },
                token,
            );
        const numbered = (prefix: string, count: number) =>
            Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

        await put(['single', ...numbered('many', 20)]);
        // One per run of the delete scenario, with spares.
        await put(numbered('doomed', 12));
        // `other` holds exactly the keys the list scenario reads.
        await put(numbered('listed', 100), env.users.other.token);

        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const actor = makeActor({ user: owner! });
        const app = await env.server.stores.app.create(
            {
                name: 'kv-bench-app',
                title: 'KV bench app',
                index_url: 'https://kv-bench-app.test/',
            },
            { ownerUserId: owner!.id },
        );
        appToken = await env.server.services.auth.getUserAppToken(
            actor,
            app.uid,
        );
        await put(['single'], appToken);
    };

    const env = useBenchEnv({ seed });

    env.scenario('set a key', async () => {
        await kv('set', { key: 'written', value: 'a small value' });
    });

    env.scenario('get a key', async () => {
        await kv('get', { key: 'single' });
    });

    env.scenario('get 20 keys in one call', async () => {
        await kv('get', {
            key: Array.from({ length: 20 }, (_, i) => `many-${i}`),
        });
    });

    env.scenario('list 100 keys', async () => {
        await kv('list', { as: 'entries' }, env.users.other.token);
    });

    env.scenario('increment a counter', async () => {
        await kv('incr', { key: 'counter', pathAndAmountMap: { '': 1 } });
    });

    let deletes = 0;
    env.scenario('delete a key', async () => {
        await kv('del', { key: `doomed-${deletes++}` });
    });

    env.scenario('set a key as an app', async () => {
        await kv('set', { key: 'written', value: 'a small value' }, appToken);
    });

    env.scenario('get a key as an app', async () => {
        await kv('get', { key: 'single' }, appToken);
    });
});
