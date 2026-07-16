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

    'delete removes the worker': async (t) => {
        await deployWorker(t, 'workers-suite-delete');
        const deleted = await t.puter.workers.delete('workers-suite-delete');
        t.assert.equal(deleted, true);
        const worker = await t.puter.workers.get('workers-suite-delete');
        t.assert.ok(!worker, 'deleted worker should no longer be returned');
    },
});
