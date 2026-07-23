import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

/**
 * Worker deploys go through the same pipeline the workerd runner uses
 * (SDK `workers.create` → WorkerDriver → local workerd). The test env
 * always routes deploys locally (see harness/capabilities.ts), so these
 * run on every platform. Names must be unique per test — deploys land on
 * one shared local workerd.
 */
const WORKER_SOURCE = `
router.custom('GET', '/ping', async () => ({ pong: true }));
router.post('/echo', async ({ request }) => {
    const body = await request.json();
    return { echoed: body };
});
router.get('/posts/:category/:id', async ({ params }) => params);
router.get('/teapot', async () => new Response('no coffee', { status: 418 }));
router.get('/whoami', async ({ user }) => {
    if (!user || !user.puter) return { authed: false };
    const me = await user.puter.getUser();
    return { authed: true, username: me.username };
});
`;

const deployWorker = async (t: TestContext, name: string) => {
    const sourcePath = `${home(t)}/workers-suite-${name}.js`;
    await t.puter.fs.write(sourcePath, WORKER_SOURCE);
    return await t.puter.workers.create(name, sourcePath);
};

export default suite('workers', {
    'create deploys a worker and returns its url': async (t) => {
        const created = await deployWorker(t, 'workers-suite-create');
        t.assert.ok(created.success, 'create should succeed');
        t.assert.ok(created.url, 'create should return the worker url');
    },

    'created worker responds over http': async (t) => {
        const created = await deployWorker(t, 'workers-suite-exec');
        const res = await t.puter.workers.exec(`${created.url}/ping`);
        t.assert.equal(res.status, 200);
        const body = await res.json();
        t.assert.deepEqual(body, { pong: true });
    },

    'exec POSTs a body and reads the JSON response': async (t) => {
        const created = await deployWorker(t, 'workers-suite-echo');
        const res = await t.puter.workers.exec(`${created.url}/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hello: 'worker' }),
        });
        t.assert.equal(res.status, 200);
        t.assert.deepEqual(await res.json(), { echoed: { hello: 'worker' } });
    },

    'a worker resolves route parameters': async (t) => {
        const created = await deployWorker(t, 'workers-suite-params');
        const res = await t.puter.workers.exec(`${created.url}/posts/tech/42`);
        t.assert.deepEqual(await res.json(), { category: 'tech', id: '42' });
    },

    'a worker can return a custom status code': async (t) => {
        const created = await deployWorker(t, 'workers-suite-status');
        const res = await t.puter.workers.exec(`${created.url}/teapot`);
        t.assert.equal(res.status, 418);
        t.assert.equal(await res.text(), 'no coffee');
    },

    'exec runs the worker in the calling user context': async (t) => {
        const created = await deployWorker(t, 'workers-suite-userctx');
        const res = await t.puter.workers.exec(`${created.url}/whoami`);
        const body = await res.json();
        t.assert.equal(body.authed, true, 'user.puter should be populated');
        t.assert.equal(body.username, t.env.users.user.username);
    },

    'get returns the deployed worker': async (t) => {
        await deployWorker(t, 'workers-suite-get');
        const worker = await t.puter.workers.get('workers-suite-get');
        t.assert.ok(worker, 'get should return the worker');
    },

    'list includes deployed workers': async (t) => {
        await deployWorker(t, 'workers-suite-listed');
        const workers = await t.puter.workers.list();
        t.assert.ok(
            JSON.stringify(workers).includes('workers-suite-listed'),
            'list should mention the deployed worker',
        );
    },

    'list pages with cursors and reports totals': async (t) => {
        await deployWorker(t, 'workers-suite-pg-a');
        await deployWorker(t, 'workers-suite-pg-b');

        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        let total: number | undefined;
        do {
            const page = (await t.puter.workers.list({
                limit: 1,
                cursor,
                includeTotal: true,
            })) as {
                items: Array<{ name: string }>;
                cursor?: string;
                total?: number;
            };
            t.assert.ok(Array.isArray(page.items), 'page should carry items');
            t.assert.ok(page.items.length <= 1, 'page respects limit');
            seen.push(...page.items.map((w) => w.name));
            total = page.total;
            cursor = page.cursor;
        } while (cursor);

        t.assert.ok(
            seen.includes('workers-suite-pg-a') &&
                seen.includes('workers-suite-pg-b'),
            'both deployed workers should appear while paging',
        );
        t.assert.ok((total ?? 0) >= 2, 'total should count deployed workers');
    },

    'list with stream iterates pages via for await': async (t) => {
        await deployWorker(t, 'workers-suite-st-a');
        await deployWorker(t, 'workers-suite-st-b');

        const seen: string[] = [];
        let pages = 0;
        for await (const page of t.puter.workers.list({ stream: true, limit: 1 }) as AsyncIterable<{
            items: Array<{ name: string }>;
            cursor?: string;
        }>) {
            pages++;
            t.assert.ok(page.items.length <= 1, 'stream pages respect limit');
            seen.push(...page.items.map((w) => w.name));
        }
        t.assert.ok(pages >= 2, 'stream should yield multiple pages');
        t.assert.ok(
            seen.includes('workers-suite-st-a') &&
                seen.includes('workers-suite-st-b'),
            'both deployed workers should appear while streaming',
        );
    },

    'delete removes the worker': async (t) => {
        await deployWorker(t, 'workers-suite-delete');
        const deleted = await t.puter.workers.delete('workers-suite-delete');
        t.assert.equal(deleted, true);
        const worker = await t.puter.workers.get('workers-suite-delete');
        t.assert.ok(!worker, 'deleted worker should no longer be returned');
    },
});
