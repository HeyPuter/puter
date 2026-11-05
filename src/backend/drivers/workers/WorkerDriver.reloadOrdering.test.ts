import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { WorkerDriver } from './WorkerDriver.js';

let server: PuterServer;
let target: WorkerDriver;

beforeAll(async () => {
    // Local runtime: hot reload subscribes, and deploys go through
    // `localworkerservice.cfDeployLocal`, which the test controls.
    server = await setupTestServer({
        workers: { localServer: true },
    } as never);
    target = server.drivers.workers as unknown as WorkerDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async () => {
    const username = `hr${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 50 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const user = (await server.stores.user.getById(created.id))!;
    const actor: Actor = {
        user: {
            id: user.id,
            uuid: user.uuid,
            username: user.username,
            email: user.email ?? null,
            email_confirmed: true,
        } as Actor['user'],
    };
    return { user, actor };
};

const write = (actor: Actor, userId: number, path: string, body: string) =>
    runWithContext({ actor }, () =>
        server.services.fs.write(userId, {
            fileMetadata: {
                path,
                size: Buffer.byteLength(body),
                contentType: 'application/javascript',
                overwrite: true,
            },
            fileContent: Buffer.from(body),
        }),
    );

const waitFor = async (predicate: () => boolean, label: string) => {
    for (let i = 0; i < 300; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
};

describe('worker hot reload ordering', () => {
    it('processes a queued save after the previous source lookup fails', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/retry.js`;
        await write(actor, user.id, path, 'v1');
        const name = `retry${Math.random().toString(36).slice(2, 8)}`;
        try {
            await runWithContext({ actor }, () =>
                target.create({ appId: '', workerName: name, filePath: path }),
            );
        } catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 503)
                throw error;
        }

        let lookupStarted = false;
        let failLookup!: (error: Error) => void;
        const pendingLookup = new Promise<never>((_resolve, reject) => {
            failLookup = reject;
        });
        const pread = server.clients.db.pread.bind(server.clients.db);
        vi.spyOn(server.clients.db, 'pread').mockImplementation(
            (query, params) => {
                if (
                    !lookupStarted &&
                    query.includes('FROM `subdomains` WHERE `subdomain` IN') &&
                    params?.includes(`${WORKER_SUBDOMAIN_PREFIX}${name}`)
                ) {
                    lookupStarted = true;
                    return pendingLookup;
                }
                return pread(query, params);
            },
        );
        let live: string | null = null;
        vi.spyOn(
            server.services.localworkerservice,
            'cfDeployLocal',
        ).mockImplementation(
            async (_name: string, _auth: unknown, code: string) => {
                live = code;
                return { success: true, errors: [], url: null } as never;
            },
        );

        await write(actor, user.id, path, 'v2');
        await waitFor(() => lookupStarted, 'source lookup to start');
        await write(actor, user.id, path, 'v3');
        await new Promise((resolve) => setImmediate(resolve));
        failLookup(new Error('temporary database outage'));
        await waitFor(
            () => live?.endsWith('v3') === true,
            'queued source to deploy',
        );
    });

    it('coalesces rapid saves and deploys the latest source after the pending deploy', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/order.js`;
        await write(actor, user.id, path, 'v1');
        const name = `order${Math.random().toString(36).slice(2, 8)}`;
        try {
            await runWithContext({ actor }, () =>
                target.create({ appId: '', workerName: name, filePath: path }),
            );
        } catch (e) {
            // No preamble in this tree: the initial deploy answers 503, after
            // the worker row is written. Hot reload doesn't need it.
            if ((e as { statusCode?: number }).statusCode !== 503) throw e;
        }

        // Records what is live, in the order deploys complete.
        let live: string | null = null;
        let started = 0;
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((r) => (releaseFirst = r));
        vi.spyOn(
            server.services.localworkerservice,
            'cfDeployLocal',
        ).mockImplementation(
            async (_name: string, _auth: unknown, code: string) => {
                const call = ++started;
                if (call === 1) await firstGate;
                live = code;
                return { success: true, errors: [], url: null } as never;
            },
        );

        await write(actor, user.id, path, 'v2');
        await waitFor(() => started === 1, 'first redeploy to start');
        await write(actor, user.id, path, 'v3');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(started).toBe(1);
        releaseFirst();
        await waitFor(
            () => started === 2 && live?.endsWith('v3') === true,
            'latest source to finish',
        );

        const stat = await server.stores.fsEntry.getEntryByPath(path);
        expect(stat).toBeTruthy();
        expect(live!.endsWith('v3')).toBe(true);
    });
});
