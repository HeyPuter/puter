import { describe, expect, it } from 'vitest';
import { setupPuterTestEnv } from './testUtil.ts';

// Exercises the client-facing test environment: a real HTTP listener on an
// ephemeral port, deterministic seeded users, and both auth paths clients
// use (pre-minted session token, and a real password login).
describe('setupPuterTestEnv', () => {
    it('boots a reachable server with working credentials', async () => {
        const env = await setupPuterTestEnv();
        try {
            const who = await fetch(`${env.apiOrigin}/whoami`, {
                headers: {
                    Authorization: `Bearer ${env.users.user.token}`,
                    Origin: env.apiOrigin,
                },
            });
            expect(who.status).toBe(200);
            const whoBody = (await who.json()) as { username: string };
            expect(whoBody.username).toBe(env.users.user.username);

            // /login is a root-only route — it lives on the root origin,
            // not the api subdomain.
            const login = await fetch(`${env.origin}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: env.origin,
                },
                body: JSON.stringify({
                    username: env.users.admin.username,
                    password: env.users.admin.password,
                }),
            });
            expect(login.status).toBe(200);
            const loginBody = (await login.json()) as { token?: string };
            expect(loginBody.token).toBeTruthy();
        } finally {
            await env.shutdown();
        }
    }, 120_000);
});
