import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

describe('recursive readdir with offset', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = async (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    it('skips entries before applying the recursive page limit', async () => {
        const { username, token } = env.users.user;
        const base = `/${username}/Documents/rec-offset`;
        for (const path of [base, `${base}/a`, `${base}/b`, `${base}/c`]) {
            expect((await post('/fs/mkdir', token, { path })).status).toBe(200);
        }

        const list = async (body: Record<string, unknown>) => {
            const response = await post('/fs/readdir', token, {
                path: base,
                recursive: true,
                ...body,
            });
            expect(response.status).toBe(200);
            const page = (await response.json()) as {
                items: Array<{ name: string }>;
            };
            return page.items.map((item) => item.name);
        };

        expect(await list({ limit: 3 })).toEqual(['a', 'b', 'c']);
        // Non-recursive honours offset.
        const flat = await post('/fs/readdir', token, {
            path: base,
            limit: 1,
            offset: 2,
        });
        expect(
            ((await flat.json()) as Array<{ name: string }>).map((e) => e.name),
        ).toEqual(['c']);
        expect(await list({ limit: 1, offset: 2 })).toEqual(['c']);
        expect(await list({ offset: 2 })).toEqual(['c']);
        expect(await list({ offset: 20 })).toEqual([]);
        expect(await list({ limit: 1, offset: 1, sortOrder: 'desc' })).toEqual([
            'b',
        ]);
        const first = await post('/fs/readdir', token, {
            path: base,
            recursive: true,
            limit: 1,
            offset: 1,
        });
        const page = await first.json();
        expect(page.items.map((item: { name: string }) => item.name)).toEqual([
            'b',
        ]);
        expect(page.cursor).toBeTypeOf('string');
        expect(await list({ limit: 1, cursor: page.cursor })).toEqual(['c']);
        // A cursor wins over offset, and an invalid offset is ignored, as
        // recursive listings did before they honoured offset.
        expect(
            await list({ limit: 1, cursor: page.cursor, offset: 1 }),
        ).toEqual(['c']);
        expect(await list({ limit: 1, offset: -1 })).toEqual(['a']);
    });
});
