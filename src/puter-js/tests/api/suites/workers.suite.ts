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
router.post('/own-kv-set', async ({ request }) => {
    const { key, value } = await request.json();
    await me.puter.kv.set(key, value);
    return { ok: true };
});
`;

const deployWorker = async (
    t: TestContext,
    name: string,
    options?: { sandbox?: boolean },
) => {
    const sourcePath = `${home(t)}/workers-suite-${name}.js`;
    await t.puter.fs.write(sourcePath, WORKER_SOURCE);
    return options === undefined
        ? await t.puter.workers.create(name, sourcePath)
        : await t.puter.workers.create(name, sourcePath, options);
};

/** `apps.get` rejects for a missing app, so presence needs a try/catch. */
const appExists = async (t: TestContext, name: string) => {
    try {
        return !!(await t.puter.apps.get(name));
    } catch {
        return false;
    }
};

export default suite('workers', {
    'create deploys a worker and returns its url': async (t) => {
        const created = await deployWorker(t, 'workers-suite-create');
        t.assert.ok(created.success, 'create should succeed');
        t.assert.ok(created.url, 'create should return the worker url');
    },

    // A user token sandboxes by default, so each worker gets its own app
    // identity — and therefore its own KV/AppData namespace.
    'create sandboxes the worker under its own app by default': async (t) => {
        const name = 'workers-suite-sbx-default';
        await deployWorker(t, name);
        t.assert.equal(
            await appExists(t, `sandbox-${name}`),
            true,
            'a sandbox app should own the worker',
        );
    },

    'create with sandbox false leaves the worker unsandboxed': async (t) => {
        const name = 'workers-suite-sbx-off';
        const created = await deployWorker(t, name, { sandbox: false });
        t.assert.ok(created.success, 'create should succeed');
        t.assert.equal(
            await appExists(t, `sandbox-${name}`),
            false,
            'no sandbox app should be created',
        );
    },

    // The reason sandboxing exists: `me.puter` inside the worker resolves to
    // the sandbox app, so its KV lands somewhere the deploying identity can't
    // read. Without a sandbox the worker shares the deployer's namespace.
    'a sandboxed worker writes KV outside the deployer namespace': async (t) => {
        const created = await deployWorker(t, 'workers-suite-kv-sbx', {
            sandbox: true,
        });
        const key = `workers-suite-kv-sbx-${Date.now()}`;
        const res = await t.puter.workers.exec(`${created.url}/own-kv-set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: 'from-sandboxed-worker' }),
        });
        t.assert.equal(res.status, 200);
        t.assert.equal(
            await t.puter.kv.get(key),
            null,
            'sandboxed worker KV must not be visible to the deployer',
        );
    },

    'an unsandboxed worker shares the deployer KV namespace': async (t) => {
        const created = await deployWorker(t, 'workers-suite-kv-plain', {
            sandbox: false,
        });
        const key = `workers-suite-kv-plain-${Date.now()}`;
        const res = await t.puter.workers.exec(`${created.url}/own-kv-set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: 'from-plain-worker' }),
        });
        t.assert.equal(res.status, 200);
        t.assert.equal(
            await t.puter.kv.get(key),
            'from-plain-worker',
            'unsandboxed worker shares the deployer namespace',
        );
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

    'create binds the worker to a named app': async (t) => {
        const appName = 'workers-suite-host-app';
        await t.puter.apps.create(appName, 'https://example.com/worker-host');
        const name = 'workers-suite-bound';
        const sourcePath = `${home(t)}/workers-suite-${name}.js`;
        await t.puter.fs.write(sourcePath, WORKER_SOURCE);
        const created = await t.puter.workers.create(name, sourcePath, appName);
        t.assert.ok(created.success, 'create should succeed');
        t.assert.equal(
            await appExists(t, `sandbox-${name}`),
            false,
            'binding to an app should not create a sandbox app',
        );
    },

    'create with an unknown app name rejects with app_not_found': async (t) => {
        const sourcePath = `${home(t)}/workers-suite-unknown-app.js`;
        await t.puter.fs.write(sourcePath, WORKER_SOURCE);
        const err = await t.assert.rejects(
            () =>
                t.puter.workers.create(
                    'workers-suite-unknown-app',
                    sourcePath,
                    'workers-suite-no-such-app',
                ),
            'binding to a nonexistent app should reject',
        );
        t.assert.equal((err as { code?: string })?.code, 'app_not_found');
        t.assert.equal(
            (err as { message?: string })?.message,
            "No app named 'workers-suite-no-such-app' in your account",
        );
    },

    'create records the deployment under the user-workers key': async (t) => {
        const name = 'workers-suite-recorded';
        const created = await deployWorker(t, name);
        const record = (await t.puter.kv.get('user-workers')) as Record<
            string,
            { url?: string; filePath?: string }
        >;
        t.assert.ok(record, 'the worker registry key should exist');
        t.assert.equal(record[name]?.url, created.url);
        t.assert.equal(
            record[name]?.filePath,
            `${home(t)}/workers-suite-${name}.js`,
        );
    },

    'worker names are matched case-insensitively': async (t) => {
        await deployWorker(t, 'workers-suite-case');
        const worker = await t.puter.workers.get('WORKERS-SUITE-CASE');
        t.assert.ok(worker, 'an uppercase name should find the worker');
    },

    'get of an unknown worker resolves to nothing': async (t) => {
        const worker = await t.puter.workers.get('workers-suite-never-deployed');
        t.assert.equal(worker, undefined);
    },

    'delete of an unknown worker rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.workers.delete('workers-suite-not-deployed'),
            'deleting a worker that was never deployed should reject',
        );
    },

    'list with an offset returns a single page': async (t) => {
        await deployWorker(t, 'workers-suite-off-a');
        await deployWorker(t, 'workers-suite-off-b');
        const page = (await t.puter.workers.list({ limit: 1, offset: 1 })) as {
            items?: Array<{ name: string }>;
        } | Array<{ name: string }>;
        const items = Array.isArray(page) ? page : (page.items ?? []);
        t.assert.equal(items.length, 1, 'offset paging returns one row');
    },

    'list with stream rejects offset client-side': async (t) => {
        let err: { code?: string; message?: string } | undefined;
        try {
            t.puter.workers.list({ stream: true, offset: 1 } as never);
        } catch (e) {
            err = e as typeof err;
        }
        t.assert.equal(err?.code, 'invalid_request');
        t.assert.equal(
            err?.message,
            '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.',
        );
    },

    'exec with x-puter-no-auth drops the session': async (t) => {
        const created = await deployWorker(t, 'workers-suite-noauth');
        const res = await t.puter.workers.exec(`${created.url}/whoami`, {
            headers: { 'x-puter-no-auth': '1' },
        });
        t.assert.equal(res.status, 200);
        t.assert.deepEqual(await res.json(), { authed: false });
    },

    'exec keeps an explicitly supplied puter-auth header': async (t) => {
        const created = await deployWorker(t, 'workers-suite-explicit-auth');
        const res = await t.puter.workers.exec(`${created.url}/whoami`, {
            headers: { 'puter-auth': t.env.users.other.token },
        });
        const body = await res.json();
        t.assert.equal(body.authed, true);
        t.assert.equal(body.username, t.env.users.other.username);
    },

    'delete removes the worker': async (t) => {
        await deployWorker(t, 'workers-suite-delete');
        const deleted = await t.puter.workers.delete('workers-suite-delete');
        t.assert.equal(deleted, true);
        const worker = await t.puter.workers.get('workers-suite-delete');
        t.assert.ok(!worker, 'deleted worker should no longer be returned');
    },
});
