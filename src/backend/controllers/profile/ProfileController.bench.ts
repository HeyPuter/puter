import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';

describe('profile', () => {
    let etag = '';

    const seed = async (env: BenchEnv) => {
        const user = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        await env.server.services.profile.updateProfile(user!, {
            displayName: 'Bench',
            bio: 'Read by a benchmark',
        });
        const response = await env.request('/profile');
        etag = response.headers.get('etag') ?? '';
    };

    const env = useBenchEnv({ seed });

    env.scenario('read my own profile', async () => {
        await env.request('/profile');
    });

    // A browser returning to the dashboard revalidates the copy it holds.
    env.scenario('revalidate my own profile', async () => {
        const response = await fetch(new URL('/profile', env.apiOrigin), {
            headers: {
                authorization: `Bearer ${env.users.user.token}`,
                'if-none-match': etag,
                // Without it fetch sends `no-cache`, which never gets a 304.
                'cache-control': 'max-age=0',
            },
        });
        await response.text();
        if (response.status !== 304) {
            throw new Error(`GET /profile answered ${response.status}`);
        }
    });
});
