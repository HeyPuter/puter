import { suite } from '../harness/types.ts';

/**
 * The relay-token endpoints are part of the core backend and run keyless;
 * only the relay itself (`wisp.server`) is external. Socket-level tests
 * are capability-gated on `net.wisp`.
 */
export default suite('net', {
    'relay-token create mints a token': async (t) => {
        const res = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/create`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${t.env.users.user.token}`,
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({}),
            },
        );
        t.assert.equal(res.status, 200);
        const body = (await res.json()) as { token?: string };
        t.assert.ok(body.token, 'response should include a token');
        t.assert.ok('server' in body, 'response should include the server field');
    },

    'relay-token verify accepts a freshly minted token': async (t) => {
        const createRes = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/create`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${t.env.users.user.token}`,
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({}),
            },
        );
        const { token } = (await createRes.json()) as { token: string };

        const verifyRes = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/verify`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({ token }),
            },
        );
        t.assert.equal(verifyRes.status, 200);
    },

    'relay-token verify rejects garbage': async (t) => {
        const res = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/verify`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({ token: 'not-a-real-wisp-token' }),
            },
        );
        t.assert.ok(res.status !== 200, 'garbage token should not verify');
    },

    'generateWispV1URL embeds a relay token': {
        requires: ['net.wisp'],
        fn: async (t) => {
            const url = await t.puter.net.generateWispV1URL();
            t.assert.ok(
                url.startsWith('ws'),
                `wisp URL should point at the configured relay, got: ${url}`,
            );
        },
    },
});
