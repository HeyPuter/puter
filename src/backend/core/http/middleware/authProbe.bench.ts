import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../../benchUtil.js';
import { makeActor } from '../../actor.js';

describe('auth', () => {
    let appToken = '';

    const seed = async (env: BenchEnv) => {
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const app = await env.server.stores.app.create(
            {
                name: 'auth-bench-app',
                title: 'Auth bench app',
                index_url: 'https://auth-bench-app.test/',
            },
            { ownerUserId: owner!.id },
        );
        appToken = await env.server.services.auth.getUserAppToken(
            makeActor({ user: owner! }),
            app.uid,
        );
    };

    const env = useBenchEnv({ seed });

    env.scenario('whoami with a session token', async () => {
        await env.request('/whoami');
    });

    env.scenario('whoami with a full-access API token', async () => {
        await env.request('/whoami', { token: env.users.user.apiToken });
    });

    env.scenario('whoami with a worker token', async () => {
        await env.request('/whoami', { token: env.users.user.workerToken });
    });

    env.scenario('whoami with an app token', async () => {
        await env.request('/whoami', { token: appToken });
    });

    env.scenario('log in with a password', async () => {
        const { username, password } = env.users.other;
        const response = await fetch(new URL('/login', env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const body = await response.text();
        if (!response.ok) {
            throw new Error(`POST /login answered ${response.status}: ${body}`);
        }
    });

    // A deployment whose extensions validate sign-ins, so the payload's reads
    // (known device, OIDC link, seat) run before the session is minted.
    env.scenario('log in with a sign-in validate listener', async () => {
        const { username, password } = env.users.user;
        const listener = async () => {};
        env.server.clients.event.on('puter.signin.validate', listener);
        try {
            const response = await fetch(new URL('/login', env.origin), {
                method: 'POST',
                // Its own client, so the scenario above leaves its login
                // limit untouched.
                headers: {
                    'content-type': 'application/json',
                    'user-agent': 'auth-bench-validate',
                },
                body: JSON.stringify({ username, password }),
            });
            const body = await response.text();
            if (!response.ok) {
                throw new Error(
                    `POST /login answered ${response.status}: ${body}`,
                );
            }
        } finally {
            env.server.clients.event.off('puter.signin.validate', listener);
        }
    });
});
