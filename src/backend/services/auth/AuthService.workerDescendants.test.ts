import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    const isPreamble = (p: unknown) =>
        /src\/worker\/dist\/(workerPreamble|eventsWorkerPreamble)\.js$/.test(
            String(p),
        );
    const existsSync = ((p: Parameters<typeof actual.existsSync>[0]) =>
        isPreamble(p) || actual.existsSync(p)) as typeof actual.existsSync;
    const readFileSync = ((p: unknown, ...rest: unknown[]) =>
        isPreamble(p)
            ? 'var __PUTER_PREAMBLE_VERSION__ = "secscan";\n'
            : (actual.readFileSync as (...a: unknown[]) => unknown)(
                  p,
                  ...rest,
              )) as typeof actual.readFileSync;
    return {
        ...actual,
        default: { ...actual, existsSync, readFileSync },
        existsSync,
        readFileSync,
    };
});

import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import type { WorkerDriver } from '../../drivers/workers/WorkerDriver.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';

let server: PuterServer;
let workers: WorkerDriver;
let deployedTokens: string[];

beforeAll(async () => {
    server = await setupTestServer({
        workers: { XAUTHKEY: 'cf-auth-key', ACCOUNTID: 'cf-account' },
    } as never);
    workers = server.drivers.workers as unknown as WorkerDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    deployedTokens = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = (init as RequestInit | undefined)?.body;
        if (body instanceof FormData) {
            const metadata = JSON.parse(String(body.get('metadata')));
            const binding = metadata.bindings.find(
                (b: { name: string }) => b.name === 'puter_auth',
            );
            if (binding) deployedTokens.push(binding.text);
        }
        return {
            json: async () => ({ success: true, errors: [] }),
        } as unknown as Response;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

let seq = 0;
const makeUser = async () => {
    const username = `sc09u${seq++}${Math.random().toString(36).slice(2, 6)}`;
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
    const actor = makeActor({
        user: { ...user, email_confirmed: true },
    }) as Actor;
    return { user, actor };
};

const inCtx = <T>(actor: Actor, fn: () => T | Promise<T>) =>
    runWithContext({ actor }, fn);

const authenticates = async (token: string) =>
    Boolean((await server.services.auth.authenticate(token)).actor);

describe('uninstalling an app and the workers it deployed', () => {
    it('revokes a worker bound to a child app on uninstall', async () => {
        const dev = await makeUser();
        const { user, actor: rootActor } = await makeUser();

        const app = await server.stores.app.create(
            {
                name: `sc09-app-${uuidv4().slice(0, 8)}`,
                title: 'Third-party app',
                index_url: `https://sc09-${uuidv4().slice(0, 8)}.example.test/`,
            },
            { ownerUserId: dev.user.id },
        );

        const appToken = await inCtx(rootActor, () =>
            server.services.auth.getUserAppToken(rootActor, app.uid),
        );
        const appActor = (await server.services.auth.authenticate(appToken))
            .actor!;
        expect(appActor.effectiveApp?.uid).toBe(app.uid);

        const child = (await inCtx(appActor, () =>
            (
                server.drivers.apps as unknown as {
                    create: (a: unknown) => Promise<{ uid: string }>;
                }
            ).create({
                object: {
                    name: `sc09-child-${uuidv4().slice(0, 8)}`,
                    title: 'Child',
                    index_url: 'https://worker-sandbox.puter.com/',
                },
                options: { dedupe_name: true },
            }),
        )) as { uid: string };
        const childRow = await server.stores.app.getByUid(child.uid);
        expect(Number(childRow!.app_owner)).toBe(Number(app.id));

        const dir = `/${user.username}/AppData/${app.uid}`;
        await inCtx(rootActor, () =>
            server.services.fs.mkdir(user.id, {
                path: dir,
                createMissingParents: true,
            }),
        );
        const source = 'router.get("/", () => "ok");';
        await inCtx(rootActor, () =>
            server.services.fs.write(user.id, {
                fileMetadata: {
                    path: `${dir}/w.js`,
                    size: Buffer.byteLength(source),
                    contentType: 'application/javascript',
                    overwrite: true,
                },
                fileContent: Buffer.from(source),
            }),
        );

        const selfName = `sc09-self-${uuidv4().slice(0, 8)}`;
        const childName = `sc09-child-${uuidv4().slice(0, 8)}`;
        await inCtx(appActor, () =>
            workers.create({
                appId: '',
                workerName: selfName,
                filePath: `${dir}/w.js`,
            }),
        );
        const selfToken = deployedTokens.at(-1)!;
        await inCtx(appActor, () =>
            workers.create({
                appId: child.uid,
                workerName: childName,
                filePath: `${dir}/w.js`,
            }),
        );
        const childToken = deployedTokens.at(-1)!;

        const grandchild = await server.stores.app.create(
            {
                name: `grandchild-${uuidv4().slice(0, 8)}`,
                title: 'Nested app',
                index_url: 'https://nested.example.test/',
            },
            { ownerUserId: user.id, appOwner: Number(childRow!.id) },
        );
        const nestedSession = await server.stores.session.getOrCreateWorker(
            user.id,
            {
                appUid: grandchild.uid,
                workerName: `nested-${uuidv4()}`,
            },
        );
        const otherUser = await makeUser();
        const otherSession = await server.stores.session.getOrCreateWorker(
            otherUser.user.id,
            {
                appUid: child.uid,
                workerName: `other-${uuidv4()}`,
            },
        );
        const unrelated = await server.stores.session.getOrCreateWorker(
            user.id,
            {
                appUid: `app-${uuidv4()}`,
                workerName: `unrelated-${uuidv4()}`,
            },
        );

        expect(await authenticates(selfToken)).toBe(true);
        expect(await authenticates(childToken)).toBe(true);

        await inCtx(rootActor, () =>
            server.controllers.auth.handleRevokeUserApp(
                {
                    body: { app_uid: app.uid, permission: '*' },
                    headers: {},
                    actor: rootActor,
                } as never,
                { json: () => undefined } as never,
            ),
        );

        expect(await authenticates(selfToken)).toBe(false);
        expect(await authenticates(childToken)).toBe(false);
        expect(
            await server.stores.session.getByUuid(nestedSession.uuid),
        ).toBeNull();
        expect(
            await server.stores.session.getByUuid(otherSession.uuid),
        ).not.toBeNull();
        expect(
            await server.stores.session.getByUuid(unrelated.uuid),
        ).not.toBeNull();
    });
});
