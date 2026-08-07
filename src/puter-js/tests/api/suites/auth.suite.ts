import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

/**
 * Auth plumbing the public `.d.ts` deliberately leaves out: the reauth
 * coordinator the network layer drives on a 401, the boot-time v1→v2 token
 * migration, and the SDK event bus those two report through.
 */
type PuterAuthInternals = {
    authToken: string | null;
    env: string;
    triggerReauth: (signal?: {
        reason?: string;
        auth_id?: string;
    }) => Promise<void>;
    _silentMigrateV1Token: (token: string | null) => Promise<boolean>;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
};

const internals = (t: TestContext) => t.puter as unknown as PuterAuthInternals;

/** Run `fn` with the SDK's token cleared, restoring it afterwards. */
const withoutToken = async (t: TestContext, fn: () => Promise<void>) => {
    const p = internals(t);
    const token = p.authToken;
    p.authToken = null;
    try {
        await fn();
    } finally {
        p.authToken = token;
    }
};

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

    // Both worker environments must refuse signOut. No platform here reports
    // 'web-worker' (workerd reports 'service-worker'), so the env is forced to
    // reach the guard for each value it is meant to cover.
    'signOut is refused in every worker environment': async (t) => {
        const realEnv = t.puter.env;
        try {
            for (const env of ['web-worker', 'service-worker'] as const) {
                t.puter.env = env;
                await t.assert.rejects(
                    async () => t.puter.auth.signOut(),
                    `signOut should be refused when env is ${env}`,
                );
                t.assert.equal(
                    t.puter.auth.isSignedIn(),
                    true,
                    `a refused signOut must leave the token intact (env ${env})`,
                );
            }
        } finally {
            t.puter.env = realEnv;
            t.puter.setAuthToken(t.env.users.user.token);
        }
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

    // -- getUser callback forms --

    'getUser invokes the success callback it is given': async (t) => {
        let fromCallback: { username?: string } | null = null;
        const user = await t.puter.auth.getUser({
            success: (value) => {
                fromCallback = value as { username?: string };
            },
        });
        t.assert.equal(user.username, t.env.users.user.username);
        t.assert.ok(fromCallback, 'the success callback should have run');
        t.assert.equal(fromCallback!.username, user.username);
    },

    'getUser accepts a positional success callback': async (t) => {
        let fromCallback: { username?: string } | null = null;
        const user = await (
            t.puter.auth.getUser as (
                success: (value: unknown) => void,
            ) => Promise<{ username: string }>
        )((value) => {
            fromCallback = value as { username?: string };
        });
        t.assert.equal(user.username, t.env.users.user.username);
        t.assert.equal(fromCallback!.username, user.username);
    },

    'puter.getUser resolves the whoami payload': async (t) => {
        const user = await t.puter.getUser();
        t.assert.equal(user.username, t.env.users.user.username);
        t.assert.equal(typeof user.uuid, 'string');
    },

    'puter.getUser also takes an options object with callbacks': async (t) => {
        let fromCallback: { username?: string } | null = null;
        const user = await t.puter.getUser({
            success: (value) => {
                fromCallback = value as { username?: string };
            },
            error: () => {
                throw new Error('the error callback should not run');
            },
        });
        t.assert.equal(user.username, t.env.users.user.username);
        t.assert.equal(fromCallback!.username, user.username);
    },

    // -- Signed-out behaviour --

    'getUser fails fast with 401 when the SDK holds no token': async (t) => {
        await withoutToken(t, async () => {
            t.assert.equal(t.puter.auth.isSignedIn(), false);
            const error = (await t.assert.rejects(async () =>
                t.puter.auth.getUser(),
            )) as { status?: number; message?: string };
            t.assert.equal(error.status, 401);
            t.assert.equal(error.message, 'Unauthorized');
        });
    },

    'whoami fails fast with 401 when the SDK holds no token': async (t) => {
        await withoutToken(t, async () => {
            const error = (await t.assert.rejects(() =>
                t.puter.auth.whoami(),
            )) as { status?: number; message?: string };
            t.assert.equal(error.status, 401);
            t.assert.equal(error.message, 'Unauthorized');
        });
    },

    // A token the backend rejects routes through the reauth coordinator rather
    // than surfacing the raw 401. Restricted to the non-interactive runtimes:
    // on `web` the same response drives the sign-in popup, which a headless
    // suite has no way to answer.
    'a token the backend rejects routes through reauth': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const p = internals(t);
            p.authToken = 'auth-suite-not-a-real-token';
            try {
                const error = (await t.assert.rejects(() =>
                    t.puter.auth.getUser(),
                )) as { code?: string };
                t.assert.equal(error.code, 'reauth_required');
                t.assert.equal(
                    p.authToken,
                    null,
                    'the rejected token must be dropped before reauth runs',
                );
            } finally {
                // Reauth drops the token, so restore through the public setter
                // to re-notify the modules holding a connection.
                t.puter.setAuthToken(t.env.users.user.token);
            }
        },
    },

    // -- Usage reporting --

    'deployment-wide usage is refused for a non-admin': async (t) => {
        const usage = (await (
            t.puter.auth as unknown as {
                getGlobalUsage: () => Promise<Record<string, unknown>>;
            }
        ).getGlobalUsage()) as { code?: string; message?: string };
        t.assert.equal(usage.code, 'forbidden');
        t.assert.equal(usage.message, 'Only admins may request this resource');
    },

    // -- Reauth coordination --

    // Every environment without a UI surface has to report reauth as a
    // structured error rather than driving a prompt. `env` is forced so the
    // guard is reached from whichever runtime is executing.
    'reauth rejects with a structured error where no prompt can be shown': async (
        t,
    ) => {
        const p = internals(t);
        const realEnv = p.env;
        const seen: Array<{ reason?: string; auth_id?: string }> = [];
        const dispose = p.on('puter.auth.reauth_required', (payload) => {
            seen.push(payload as { reason?: string; auth_id?: string });
        });
        try {
            for (const env of ['nodejs', 'web-worker', 'service-worker']) {
                p.env = env;
                const error = (await t.assert.rejects(() =>
                    p.triggerReauth({
                        reason: 'session_expired',
                        auth_id: `auth-${env}`,
                    }),
                )) as { code?: string; reason?: string; auth_id?: string };
                t.assert.equal(error.code, 'reauth_required');
                t.assert.equal(error.reason, 'session_expired');
                t.assert.equal(error.auth_id, `auth-${env}`);
                t.assert.equal(
                    p.authToken,
                    null,
                    'the poisoned token must be dropped before reauth runs',
                );
            }
            t.assert.equal(seen.length, 3, 'each attempt notifies subscribers');
            t.assert.deepEqual(seen[0], {
                reason: 'session_expired',
                auth_id: 'auth-nodejs',
            });
        } finally {
            dispose();
            p.env = realEnv;
            t.puter.setAuthToken(t.env.users.user.token);
        }
    },

    'parallel reauth callers share a single attempt': async (t) => {
        const p = internals(t);
        const realEnv = p.env;
        let notifications = 0;
        const dispose = p.on('puter.auth.reauth_required', () => {
            notifications++;
        });
        try {
            p.env = 'nodejs';
            const first = p.triggerReauth({ reason: 'first' });
            const second = p.triggerReauth({ reason: 'second' });
            const firstError = (await t.assert.rejects(() => first)) as {
                reason?: string;
            };
            const secondError = (await t.assert.rejects(() => second)) as {
                reason?: string;
            };
            t.assert.equal(firstError.reason, 'first');
            t.assert.equal(
                secondError.reason,
                'first',
                'the second caller joins the first attempt',
            );
            t.assert.equal(notifications, 1);
        } finally {
            dispose();
            p.env = realEnv;
            t.puter.setAuthToken(t.env.users.user.token);
        }
    },

    // Inside the Puter GUI the host renders its own modal, so the SDK stays
    // out of the way and resolves instead of rejecting.
    'reauth is a no-op inside the Puter GUI': async (t) => {
        const p = internals(t);
        const realEnv = p.env;
        try {
            p.env = 'gui';
            t.assert.equal(await p.triggerReauth({ reason: 'whatever' }), undefined);
            t.assert.equal(p.authToken, null);
        } finally {
            p.env = realEnv;
            t.puter.setAuthToken(t.env.users.user.token);
        }
        t.assert.equal(t.puter.auth.isSignedIn(), true);
    },

    'a throwing reauth subscriber does not break the flow': async (t) => {
        const p = internals(t);
        const realEnv = p.env;
        let reached = false;
        const disposeBad = p.on('puter.auth.reauth_required', () => {
            throw new Error('subscriber blew up');
        });
        const disposeGood = p.on('puter.auth.reauth_required', () => {
            reached = true;
        });
        try {
            p.env = 'gui';
            await p.triggerReauth({ reason: 'x' });
            t.assert.equal(reached, true);
        } finally {
            disposeBad();
            disposeGood();
            p.env = realEnv;
            t.puter.setAuthToken(t.env.users.user.token);
        }
    },
});
