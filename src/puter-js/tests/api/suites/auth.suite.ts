import { suite } from '../harness/types.ts';

export default suite('auth', {
    'getUser returns the authenticated user': async (t) => {
        const user = await t.puter.auth.getUser();
        t.assert.equal(user.username, t.env.users.user.username);
    },

    'whoami matches getUser': async (t) => {
        const whoami = await t.puter.auth.whoami();
        const user = await t.puter.auth.getUser();
        t.assert.equal(whoami.username, user.username);
        t.assert.equal(whoami.uuid, user.uuid);
    },

    'isSignedIn reports true with a valid token': async (t) => {
        t.assert.equal(t.puter.auth.isSignedIn(), true);
    },

    'signOut clears the session client-side': {
        // The SDK refuses signOut inside (service) workers.
        platforms: ['node', 'browser'],
        fn: async (t) => {
            // The browser platform shares one SDK instance across tests, so
            // always restore the token before finishing.
            try {
                t.puter.auth.signOut();
                t.assert.equal(t.puter.auth.isSignedIn(), false);
            } finally {
                t.puter.setAuthToken(t.env.users.user.token);
            }
            t.assert.equal(t.puter.auth.isSignedIn(), true);
        },
    },

    'a bogus token is rejected by the API': async (t) => {
        const res = await fetch(`${t.env.apiOrigin}/whoami`, {
            headers: {
                Authorization: 'Bearer not-a-real-token',
                Origin: t.env.apiOrigin,
            },
        });
        t.assert.equal(res.status, 401);
    },

    'password login issues a working token': async (t) => {
        const res = await fetch(`${t.env.origin}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: t.env.origin,
            },
            body: JSON.stringify({
                username: t.env.users.user.username,
                password: t.env.users.user.password,
            }),
        });
        t.assert.equal(res.status, 200);
        const body = (await res.json()) as { proceed: boolean; token?: string };
        t.assert.ok(body.token, 'login response should include a token');
    },

    'login with a wrong password fails': async (t) => {
        const res = await fetch(`${t.env.origin}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: t.env.origin,
            },
            body: JSON.stringify({
                username: t.env.users.user.username,
                password: 'definitely-not-the-password',
            }),
        });
        t.assert.ok(res.status !== 200, 'wrong password should not yield 200');
    },

    'getMonthlyUsage returns a usage report': async (t) => {
        const usage = await t.puter.auth.getMonthlyUsage();
        t.assert.ok(
            usage && typeof usage === 'object',
            'usage report should be an object',
        );
    },

    'getDetailedAppUsage without an appId rejects': async (t) => {
        await t.assert.rejects(
            () =>
                (
                    t.puter.auth.getDetailedAppUsage as (
                        appId?: unknown,
                    ) => Promise<unknown>
                )(),
            'getDetailedAppUsage should require an appId',
        );
    },

    'getDetailedAppUsage returns a report for an app': async (t) => {
        const app = await t.puter.apps.create(
            t.puter.randName(),
            'https://example.com/',
        );
        const usage = await t.puter.auth.getDetailedAppUsage(app.uid);
        t.assert.ok(
            usage && typeof usage === 'object',
            'detailed usage should be an object',
        );
    },

    'regular user is rejected by admin-gated endpoints': async (t) => {
        const asUser = await fetch(`${t.env.apiOrigin}/serverInfo`, {
            headers: {
                Authorization: `Bearer ${t.env.users.user.token}`,
                Origin: t.env.apiOrigin,
            },
        });
        t.assert.equal(asUser.status, 403);
    },

    // Admin-gated endpoints need a step-up on top of the session: the admin
    // re-proves identity, then replays the elevation as `x-puter-elevation`.
    // Without it a plain admin session is refused, so a leaked session alone
    // can't reach them.
    'admin session alone is refused by admin-gated endpoints': async (t) => {
        const noElevation = await fetch(`${t.env.apiOrigin}/serverInfo`, {
            headers: {
                Authorization: `Bearer ${t.env.users.admin.token}`,
                Origin: t.env.apiOrigin,
            },
        });
        t.assert.equal(noElevation.status, 403);
    },

    'admin user passes admin-gated endpoints after elevating': async (t) => {
        const elevate = await fetch(`${t.env.apiOrigin}/auth/elevate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${t.env.users.admin.token}`,
                Origin: t.env.apiOrigin,
            },
            body: JSON.stringify({ password: t.env.users.admin.password }),
        });
        t.assert.equal(elevate.status, 200);
        const { token: elevation } = (await elevate.json()) as {
            token?: string;
        };
        t.assert.ok(elevation, 'elevate response should include a token');

        const asAdmin = await fetch(`${t.env.apiOrigin}/serverInfo`, {
            headers: {
                Authorization: `Bearer ${t.env.users.admin.token}`,
                'x-puter-elevation': elevation!,
                Origin: t.env.apiOrigin,
            },
        });
        t.assert.equal(asAdmin.status, 200);
    },
});
