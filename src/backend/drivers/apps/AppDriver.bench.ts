import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';

describe('apps', () => {
    let appUid = '';
    const appUids: string[] = [];

    const apps = (method: string, args: Record<string, unknown>) =>
        env.request('/drivers/call', {
            json: { interface: 'puter-apps', method, args },
        });

    const seed = async (env: BenchEnv) => {
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const created = [];
        for (let i = 0; i < 20; i++) {
            created.push(
                await env.server.stores.app.create(
                    {
                        name: `bench-app-${i}`,
                        title: `Bench app ${i}`,
                        index_url: `https://bench-app-${i}.test/`,
                    },
                    { ownerUserId: owner!.id },
                ),
            );
        }
        appUids.push(...created.map((app) => app.uid));
        appUid = appUids[0]!;
        // The first launch of an app records a grant; later ones are the hot path.
        await env.request('/auth/get-user-app-token', {
            json: { app_uid: appUid },
        });
    };

    const env = useBenchEnv({ seed });
    let run = 0;

    env.scenario('list my 20 apps', async () => {
        await apps('select', { predicate: ['user-can-edit'] });
    });

    env.scenario('read an app by name', async () => {
        await apps('read', { id: { name: 'bench-app-0' } });
    });

    env.scenario('look up an app by name on launch', async () => {
        await env.request('/apps/bench-app-0');
    });

    env.scenario('look up three apps by name in one request', async () => {
        await env.request('/apps/bench-app-1|bench-app-2|bench-app-3');
    });

    env.scenario('mint an app token on a repeat launch', async () => {
        await env.request('/auth/get-user-app-token', {
            json: { app_uid: appUid },
        });
    });

    env.scenario('list the launcher apps', async () => {
        await env.request('/get-launch-apps');
    });

    env.scenario('record an app open', async () => {
        await env.request('/rao', { json: { app_uid: appUid } });
    });

    env.scenario('create an app', async () => {
        const name = `bench-created-${run++}`;
        await apps('create', {
            object: {
                name,
                title: 'Created by a benchmark',
                index_url: `https://${name}.test/`,
            },
        });
    });

    // A fresh app each run, so no run reads what the run before it wrote.
    let updates = 5;
    env.scenario('update an app', async () => {
        await apps('update', {
            uid: appUids[updates++],
            object: { title: 'Retitled by a benchmark' },
        });
    });
});
