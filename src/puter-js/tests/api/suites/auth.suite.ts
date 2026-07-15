import { suite } from '../harness/types.ts';

export default suite('auth', {
    'getUser returns the authenticated user': async (t) => {
        const user = await t.puter.auth.getUser();
        t.assert.equal(user.username, t.env.users.user.username);
    },

    'isSignedIn reports true with a valid token': async (t) => {
        t.assert.equal(t.puter.auth.isSignedIn(), true);
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

    'regular user is rejected by admin-gated endpoints': async (t) => {
        const asUser = await fetch(`${t.env.apiOrigin}/serverInfo`, {
            headers: {
                Authorization: `Bearer ${t.env.users.user.token}`,
                Origin: t.env.apiOrigin,
            },
        });
        t.assert.equal(asUser.status, 403);
    },

    'admin user passes admin-gated endpoints': async (t) => {
        const asAdmin = await fetch(`${t.env.apiOrigin}/serverInfo`, {
            headers: {
                Authorization: `Bearer ${t.env.users.admin.token}`,
                Origin: t.env.apiOrigin,
            },
        });
        t.assert.equal(asAdmin.status, 200);
    },
});
