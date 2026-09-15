import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor } from '../src/backend/core/actor.ts';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../src/backend/testUtil.ts';

// Route-gate coverage: who may reach which payments route, exercised over
// HTTP so the `RouteOptions` gates run. The handler-level suite in
// payments.test.ts bypasses them by design.

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

let counter = 0;

/** breez.tips stand-in; every other host goes to the real fetch. */
const fakeBreezTips = async (url: URL): Promise<Response> => {
    const wellKnown = url.pathname.match(/^\/\.well-known\/lnurlp\/([^/]+)$/);
    if (wellKnown) {
        return jsonResponse(200, {
            callback: `https://breez.tips/lnurlp/${wellKnown[1]}/invoice`,
            minSendable: 1000,
            maxSendable: 100_000_000_000,
            commentAllowed: 255,
            tag: 'payRequest',
        });
    }
    if (/^\/lnurlp\/[^/]+\/invoice$/.test(url.pathname)) {
        const hash = `hash${++counter}`;
        return jsonResponse(200, {
            pr: `lnbc1fake${hash}`,
            routes: [],
            verify: `https://breez.tips/verify/${hash}`,
        });
    }
    if (url.pathname.startsWith('/verify/')) {
        return jsonResponse(200, { status: 'OK', settled: false });
    }
    return jsonResponse(404, { status: 'ERROR', reason: 'unknown route' });
};

describe('payments routes over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        const realFetch = globalThis.fetch;
        vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
            const url = new URL(
                typeof input === 'string' || input instanceof URL
                    ? String(input)
                    : (input as Request).url,
            );
            if (url.hostname === 'breez.tips') return fakeBreezTips(url);
            return realFetch(input as string, init);
        });
    }, 120_000);

    afterAll(async () => {
        vi.unstubAllGlobals();
        await env?.shutdown();
    });

    const request = (
        method: string,
        path: string,
        token: string,
        body?: unknown,
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    const makeUser = async () =>
        createTestUser(env.server, {
            username: `pay${Math.random().toString(36).slice(2, 9)}`,
            password: 'puter-test-user-password',
        });

    /** An app owned by `owner`, plus a token for `user` acting through it. */
    const appTokenFor = async (
        owner: { username: string },
        user: { username: string },
    ) => {
        const ownerRow = await env.server.stores.user.getByUsername(
            owner.username,
        );
        const app = await env.server.stores.app.create(
            {
                name: `payapp-${Math.random().toString(36).slice(2, 9)}`,
                title: 'Pay app',
                index_url: `https://pay-${Math.random().toString(36).slice(2, 9)}.test/`,
            },
            { ownerUserId: ownerRow!.id },
        );
        const userRow = await env.server.stores.user.getByUsername(
            user.username,
        );
        const token = await env.server.services.auth.getUserAppToken(
            makeActor({ user: userRow! }),
            app!.uid,
        );
        return { app: app!, token };
    };

    it('lets a developer manage settings from their session and API token, never from an app', async () => {
        const developer = await makeUser();
        const payer = await makeUser();
        const { token: appToken } = await appTokenFor(developer, payer);

        const saved = await request('PUT', '/payments/settings', developer.token, {
            lightningAddress: 'dev@breez.tips',
        });
        expect(saved.status).toBe(200);

        const viaApiToken = await request('GET', '/payments/settings', developer.apiToken);
        expect(viaApiToken.status).toBe(200);
        expect(await viaApiToken.json()).toMatchObject({ lightningAddress: 'dev@breez.tips' });

        for (const [method, path] of [
            ['GET', '/payments/settings'],
            ['PUT', '/payments/settings'],
            ['GET', '/payments/charges'],
        ] as const) {
            const res = await request(method, path, appToken, method === 'PUT' ? { lightningAddress: null } : undefined);
            expect(res.status, `${method} ${path} from an app`).toBe(403);
        }
    });

    it('lets an app charge its owner’s address but not choose another', async () => {
        const developer = await makeUser();
        const payer = await makeUser();
        const stranger = await makeUser();
        const { app, token: appToken } = await appTokenFor(developer, payer);
        await request('PUT', '/payments/settings', developer.token, {
            lightningAddress: 'dev@breez.tips',
        });

        const created = await request('POST', '/payments/charges', appToken, {
            amountSats: 21,
            description: 'Gate test',
        });
        expect(created.status).toBe(201);
        const charge = (await created.json()) as { id: string; lightningAddress: string; appUid: string };
        expect(charge.lightningAddress).toBe('dev@breez.tips');
        expect(charge.appUid).toBe(app.uid);

        const redirected = await request('POST', '/payments/charges', appToken, {
            amountSats: 21,
            lightningAddress: 'attacker@breez.tips',
        });
        expect(redirected.status).toBe(403);
        expect(await redirected.json()).toMatchObject({ code: 'lightning_address_override_forbidden' });

        // Payer (through the app) and developer can read it; a stranger cannot.
        expect((await request('GET', `/payments/charges/${charge.id}`, appToken)).status).toBe(200);
        expect((await request('GET', `/payments/charges/${charge.id}`, developer.token)).status).toBe(200);
        expect((await request('GET', `/payments/charges/${charge.id}/qr`, appToken)).status).toBe(200);
        expect((await request('GET', `/payments/charges/${charge.id}`, stranger.token)).status).toBe(404);

        const listed = await request('GET', '/payments/charges', developer.token);
        expect(listed.status).toBe(200);
        const page = (await listed.json()) as { items: { id: string }[] };
        expect(page.items.map((c) => c.id)).toContain(charge.id);
    });

    it('rejects anonymous requests', async () => {
        const res = await fetch(new URL('/payments/charges', env.apiOrigin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ amountSats: 21 }),
        });
        expect(res.status).toBe(401);
    });
});
