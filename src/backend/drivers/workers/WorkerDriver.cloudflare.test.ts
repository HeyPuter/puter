/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */


/**
 * WorkerDriver with a deploy backend configured.
 *
 * The sibling WorkerDriver.test.ts runs on an install with no deploy backend,
 * so every write path stops at the 503 gate. Here the driver is fully
 * configured and only the edge HTTP call itself is stubbed (global `fetch`) —
 * that is the one external boundary. Everything below it (subdomain rows,
 * worker tokens, FS reads, notifications, and the hot-reload event wiring) is
 * the real stack.
 */

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
    type MockInstance,
} from 'vitest';

import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { resolveCallableMethods } from '../meta.js';
import {
    INTERNAL_ADMIN_DESTROY,
    INTERNAL_ADMISSION_BYPASS,
    INTERNAL_DEPLOY_TARGET,
    type WorkerDriver,
} from './WorkerDriver.js';

const ACCOUNT_ID = 'cf-account';
const AUTH_KEY = 'cf-auth-key';
const SCRIPTS_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`;

let server: PuterServer;
let target: WorkerDriver;
let fetchSpy: MockInstance<typeof fetch>;

const edgeResponse = (body: unknown, status = 200) =>
    ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }) as unknown as Response;

beforeAll(async () => {
    server = await setupTestServer({
        workers: { XAUTHKEY: AUTH_KEY, ACCOUNTID: ACCOUNT_ID },
    } as never);
    target = server.drivers.workers as unknown as WorkerDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(edgeResponse({ success: true, errors: [] }));
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- Fixtures --------------------------------------------------------

let seq = 0;

const makeUser = async () => {
    const username = `wkcf${seq++}${Math.random().toString(36).slice(2, 6)}`;
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

const inCtx = <T>(actor: Actor, fn: () => T | Promise<T>) =>
    runWithContext({ actor }, fn);

const writeSource = async (
    actor: Actor,
    userId: number,
    path: string,
    source: string,
): Promise<FSEntry> => {
    const { fsEntry } = await inCtx(actor, () =>
        server.services.fs.write(userId, {
            fileMetadata: {
                path,
                size: Buffer.byteLength(source),
                contentType: 'application/javascript',
                overwrite: true,
            },
            fileContent: Buffer.from(source),
        }),
    );
    return fsEntry;
};

const waitFor = async (
    predicate: () => boolean | Promise<boolean>,
    label: string,
) => {
    for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
};

const putCalls = () =>
    fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
    );
const deleteCalls = () =>
    fetchSpy.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );

const deployedToken = () => {
    const [, init] = putCalls().at(-1)!;
    const form = (init as RequestInit).body as FormData;
    const metadata = JSON.parse(form.get('metadata') as string);
    return metadata.bindings.find(
        (b: { name: string }) => b.name === 'puter_auth',
    ).text as string;
};

/** A fresh user with one deployed worker and the token it was deployed with. */
const deployWorker = async (label: string) => {
    const { user, actor } = await makeUser();
    const path = `/${user.username}/${label}.js`;
    const entry = await writeSource(actor, user.id, path, 'src');
    const name = `${label}-${user.username}`;
    await inCtx(actor, () =>
        target.create({ appId: '', workerName: name, filePath: path }),
    );
    return { user, actor, entry, name, token: deployedToken() };
};

const workerSession = (userId: number, workerName: string) =>
    server.stores.session.getWorker(userId, { appUid: null, workerName });

// -- create ----------------------------------------------------------

describe('WorkerDriver.create with a configured deploy backend', () => {
    it('retains its deployment backend after a separate local server starts', async () => {
        const localServer = await setupTestServer({
            workers: { localServer: true },
        } as never);
        await localServer.shutdown();
        const { actor, user } = await makeUser();
        const path = `/${user.username}/backend.js`;
        await writeSource(actor, user.id, path, 'export default {}');
        const name = `backend-${user.username}`;
        expect(
            await inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: name,
                    filePath: path,
                }),
            ),
        ).toMatchObject({ success: true, url: `https://${name}.puter.work` });
        expect(putCalls()).toHaveLength(1);
    });

    it('creates the subdomain row, deploys the source, and returns the worker URL', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        const entry = await writeSource(
            actor,
            user.id,
            path,
            'export default { fetch() {} }',
        );
        const name = `wk-${user.username}`;

        const result = await inCtx(actor, () =>
            target.create({
                appId: '',
                workerName: name,
                filePath: path,
            }),
        );

        expect(result).toEqual({
            success: true,
            errors: [],
            url: `https://${name}.puter.work`,
            app_uid: null,
            app_name: null,
        });

        const [url, init] = putCalls()[0]!;
        expect(url).toBe(`${SCRIPTS_BASE}/${name}/`);
        expect((init as RequestInit).method).toBe('PUT');
        expect((init as RequestInit).headers).toEqual({
            Authorization: `Bearer ${AUTH_KEY}`,
        });

        const row = await server.stores.subdomain.getBySubdomain(
            `workers.puter.${name}`,
        );
        expect(row).toBeTruthy();
        expect(Number(row!.user_id)).toBe(user.id);
        expect(Number(row!.root_dir_id)).toBe(entry.id);
    });

    it('names the app a bound worker runs as, and lists it with the worker', async () => {
        const { user, actor } = await makeUser();
        const app = await server.stores.app.create(
            {
                name: `bound-${user.username}`,
                title: `bound-${user.username}`,
                index_url: `https://bound-${user.username}.example.com/`,
            },
            { ownerUserId: user.id },
        );
        const path = `/${user.username}/bound.js`;
        await writeSource(actor, user.id, path, 'export default {}');
        const name = `bound-${user.username}`;

        const result = await inCtx(actor, () =>
            target.create({ appId: app.uid, workerName: name, filePath: path }),
        );

        expect(result).toMatchObject({
            success: true,
            app_uid: app.uid,
            app_name: app.name,
        });
        const listed = (
            (await inCtx(actor, () =>
                target.getFilePaths({ workerName: name }),
            )) as Array<{ app_uid: string | null; app_name: string | null }>
        )[0];
        expect(listed).toMatchObject({ app_uid: app.uid, app_name: app.name });
    });

    describe('redeployed under a different app', () => {
        const seedBound = async () => {
            const { user, actor } = await makeUser();
            const makeApp = (label: string) =>
                server.stores.app.create(
                    {
                        name: `${label}-${user.username}`,
                        title: `${label}-${user.username}`,
                        index_url: `https://${label}-${user.username}.example.com/`,
                    },
                    { ownerUserId: user.id },
                );
            const first = await makeApp('first');
            const second = await makeApp('second');
            const path = `/${user.username}/rebind.js`;
            await writeSource(actor, user.id, path, 'v1');
            const name = `rebind-${user.username}`;
            const deploy = (appId: string) =>
                inCtx(actor, () =>
                    target.create({ appId, workerName: name, filePath: path }),
                );
            await deploy(first.uid);
            const firstToken = deployedToken();
            return {
                user,
                actor,
                path,
                name,
                first,
                second,
                deploy,
                firstToken,
            };
        };

        const appOf = async (token: string) =>
            (await server.services.auth.authenticate(token)).actor
                ?.effectiveApp?.uid;

        const listed = async (actor: Actor, name: string) =>
            (
                (await inCtx(actor, () =>
                    target.getFilePaths({ workerName: name }),
                )) as Array<{ app_uid: string | null; app_name: string | null }>
            )[0];

        it('moves the worker row to the app its new token acts as', async () => {
            const { actor, name, second, deploy } = await seedBound();

            const result = await deploy(second.uid);

            expect(result).toMatchObject({ app_uid: second.uid });
            expect(await listed(actor, name)).toMatchObject({
                app_uid: second.uid,
                app_name: second.name,
            });
            const row = await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            );
            expect(Number(row!.app_owner)).toBe(second.id);
        });

        it('hot-reloads as the new app, not the one it was first bound to', async () => {
            const { user, actor, path, second, deploy } = await seedBound();
            await deploy(second.uid);
            const notifySpy = vi.spyOn(server.services.notification, 'notify');

            await writeSource(actor, user.id, path, 'v2');

            await waitFor(
                () => notifySpy.mock.calls.length > 0,
                'hot-reload notification',
            );
            expect(notifySpy).toHaveBeenCalledWith(
                [user.id],
                expect.anything(),
                expect.objectContaining({ appUid: second.uid }),
            );
        });

        it('drops the binding when redeployed with no app', async () => {
            const { actor, name, deploy, firstToken } = await seedBound();

            expect(await deploy('')).toMatchObject({ app_uid: null });
            expect(await listed(actor, name)).toMatchObject({
                app_uid: null,
                app_name: null,
            });
            expect(await server.services.auth.authenticate(firstToken)).toEqual(
                { invalid: true },
            );
            expect(
                (await server.services.auth.authenticate(deployedToken()))
                    .actor,
            ).toBeTruthy();
        });

        it('revokes the old app`s token once the new one is deployed', async () => {
            const { second, deploy, firstToken } = await seedBound();

            await deploy(second.uid);

            expect(await server.services.auth.authenticate(firstToken)).toEqual(
                { invalid: true },
            );
            expect(await appOf(deployedToken())).toBe(second.uid);
        });

        it('leaves the old binding and its token alone when the redeploy fails', async () => {
            const { name, first, second, deploy, firstToken } =
                await seedBound();
            fetchSpy.mockResolvedValue(
                edgeResponse({
                    success: false,
                    errors: [{ message: 'script too large' }],
                }),
            );

            expect(await deploy(second.uid)).toMatchObject({ success: false });

            expect(await appOf(firstToken)).toBe(first.uid);
            const row = await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            );
            expect(Number(row!.app_owner)).toBe(first.id);
        });
    });

    it('sends the puter_auth secret and puter_endpoint binding in the deploy metadata', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'source');
        const name = `bind-${user.username}`;

        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: path }),
        );

        const [, init] = putCalls()[0]!;
        const form = (init as RequestInit).body as FormData;
        const metadata = JSON.parse(form.get('metadata') as string);
        expect(metadata.body_part).toBe('swCode');
        expect(metadata.compatibility_flags).toEqual([
            'global_fetch_strictly_public',
        ]);
        const bindings = Object.fromEntries(
            metadata.bindings.map(
                (b: { name: string; type: string; text: string }) => [
                    b.name,
                    b,
                ],
            ),
        );
        expect(bindings.puter_auth.type).toBe('secret_text');
        expect(typeof bindings.puter_auth.text).toBe('string');
        expect(bindings.puter_auth.text.length).toBeGreaterThan(0);
        expect(bindings.puter_endpoint).toMatchObject({
            type: 'plain_text',
            text: 'https://api.puter.com',
        });
    });

    it('prepends the puter.js preamble to the deployed source', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        const marker = '/*__worker_body_marker__*/';
        await writeSource(actor, user.id, path, marker);

        await inCtx(actor, () =>
            target.create({
                appId: '',
                workerName: `pre-${user.username}`,
                filePath: path,
            }),
        );

        const form = (putCalls()[0]![1] as RequestInit).body as FormData;
        const code = await (form.get('swCode') as Blob).text();
        expect(code.endsWith(marker)).toBe(true);
        // The preamble is what gives worker code access to puter.js.
        expect(code.length).toBeGreaterThan(marker.length);
    });

    it('redeploying the same name updates the existing row instead of duplicating it', async () => {
        const { user, actor } = await makeUser();
        const first = `/${user.username}/one.js`;
        const second = `/${user.username}/two.js`;
        await writeSource(actor, user.id, first, 'v1');
        const secondEntry = await writeSource(actor, user.id, second, 'v2');
        const name = `redeploy-${user.username}`;

        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: first }),
        );
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: second }),
        );

        const rows = await server.stores.subdomain.listByUserIdAndPrefix(
            user.id,
            'workers.puter.',
        );
        expect(
            rows.filter((r) => r.subdomain === `workers.puter.${name}`),
        ).toHaveLength(1);
        const row = await server.stores.subdomain.getBySubdomain(
            `workers.puter.${name}`,
        );
        expect(Number(row!.root_dir_id)).toBe(secondEntry.id);
    });

    // Anything pricing workers keys off this event, so a redeploy leaking one
    // through would bill the user again for a worker they already own.
    it('announces `worker.create` for a new worker but not for a redeploy', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'v1');
        const name = `announce-${user.username}`;

        const announced: string[] = [];
        const listener = (_key: unknown, data: { workerName: string }) => {
            announced.push(data.workerName);
        };
        server.clients.event.on(
            'worker.create',
            listener as Parameters<typeof server.clients.event.on>[1],
        );

        try {
            await inCtx(actor, () =>
                target.create({ appId: '', workerName: name, filePath: path }),
            );
            await inCtx(actor, () =>
                target.create({ appId: '', workerName: name, filePath: path }),
            );
            // The rehydrate shape: an existing worker redeployed past the
            // admission gates because it is already ours.
            await inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: name,
                    filePath: path,
                    [INTERNAL_ADMISSION_BYPASS]: true,
                }),
            );
        } finally {
            server.clients.event.off(
                'worker.create',
                listener as Parameters<typeof server.clients.event.off>[1],
            );
        }

        expect(announced).toEqual([name]);
    });

    it('rejects a name already taken by another user with 409', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const name = `taken-${owner.user.username}`;
        const ownerPath = `/${owner.user.username}/worker.js`;
        await writeSource(owner.actor, owner.user.id, ownerPath, 'mine');
        await inCtx(owner.actor, () =>
            target.create({ appId: '', workerName: name, filePath: ownerPath }),
        );

        const strangerPath = `/${stranger.user.username}/worker.js`;
        await writeSource(
            stranger.actor,
            stranger.user.id,
            strangerPath,
            'theirs',
        );

        await expect(
            inCtx(stranger.actor, () =>
                target.create({
                    appId: '',
                    workerName: name,
                    filePath: strangerPath,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 409, legacyCode: 'conflict' });
    });

    it('reports a lost uniqueness race as 409, not a 500', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'export default {}');

        // The name check and the insert are two statements, and the check may
        // answer from cache or a replica, so a name can be claimed in between
        // and only the unique index catches it. The in-memory sqlite schema has
        // no unique index on `subdomain` (mysql and postgres do), so the losing
        // insert is what gets stubbed here. A raw driver error would escape as
        // a 500 carrying the index name and the subdomain.
        const dup = Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
        });
        vi.spyOn(server.stores.subdomain, 'create').mockRejectedValueOnce(dup);

        await expect(
            inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: `race-${user.username}`,
                    filePath: path,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 409, legacyCode: 'conflict' });
    });

    it('lets a non-uniqueness insert failure surface as a server error', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'export default {}');

        vi.spyOn(server.stores.subdomain, 'create').mockRejectedValueOnce(
            new Error('connection lost'),
        );

        await expect(
            inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: `boom-${user.username}`,
                    filePath: path,
                }),
            ),
        ).rejects.toThrow('connection lost');
    });

    it('rejects a source that is not a real FS file with 400', async () => {
        const { user, actor } = await makeUser();
        // A data URL resolves to bytes but carries no fsentry, so there is
        // nothing to bind the worker subdomain to.
        await expect(
            inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: `inline-${user.username}`,
                    filePath: 'data:text/javascript;base64,Y29uc3QgYSA9IDE7',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
        expect(putCalls()).toHaveLength(0);
    });

    // The file's owner keeps editing rights at any share level, and later
    // redeploys read the file as the worker's owner.
    it.each(['read', 'write', 'manage'] as const)(
        'refuses a source file shared with the actor at %s',
        async (mode) => {
            const owner = await makeUser();
            const holder = await makeUser();
            const path = `/${owner.user.username}/worker.js`;
            const entry = await writeSource(
                owner.actor,
                owner.user.id,
                path,
                'v1',
            );
            await server.services.acl.setUserUser(
                owner.actor,
                holder.actor,
                {
                    path: entry.path,
                    resolveAncestors: () =>
                        server.services.fs.getAncestorChain(entry.path),
                },
                mode,
            );
            const name = `borrowed-${mode}-${holder.user.username}`;

            await expect(
                inCtx(holder.actor, () =>
                    target.create({
                        appId: '',
                        workerName: name,
                        filePath: path,
                    }),
                ),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
            expect(putCalls()).toHaveLength(0);
            expect(
                await server.stores.subdomain.getBySubdomain(
                    `workers.puter.${name}`,
                ),
            ).toBeNull();
            expect(
                await server.stores.session.getWorker(holder.user.id, {
                    workerName: name,
                }),
            ).toBeNull();
        },
    );

    it('refuses repointing an existing worker at another user’s file', async () => {
        const { user, actor } = await makeUser();
        const other = await makeUser();
        const own = `/${user.username}/worker.js`;
        const ownEntry = await writeSource(actor, user.id, own, 'v1');
        const foreign = `/${other.user.username}/worker.js`;
        const foreignEntry = await writeSource(
            other.actor,
            other.user.id,
            foreign,
            'v2',
        );
        await server.services.acl.setUserUser(
            other.actor,
            actor,
            {
                path: foreignEntry.path,
                resolveAncestors: () =>
                    server.services.fs.getAncestorChain(foreignEntry.path),
            },
            'read',
        );
        const name = `repoint-${user.username}`;
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: own }),
        );

        await expect(
            inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: name,
                    filePath: foreign,
                    [INTERNAL_ADMISSION_BYPASS]: true,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(putCalls()).toHaveLength(1);
        const row = await server.stores.subdomain.getBySubdomain(
            `workers.puter.${name}`,
        );
        expect(Number(row!.root_dir_id)).toBe(ownEntry.id);
    });

    describe('to an internal deploy target', () => {
        const deployTo = (actor: Actor, filePath: string, scriptName: string) =>
            inCtx(actor, () =>
                target.create({
                    appId: '',
                    workerName: scriptName,
                    filePath,
                    [INTERNAL_DEPLOY_TARGET]: { scriptName },
                }),
            );

        it('deploys the deployer’s own file', async () => {
            const { user, actor } = await makeUser();
            const path = `/${user.username}/site.worker.js`;
            await writeSource(actor, user.id, path, 'export default {}');
            const scriptName = `dt-own-${user.username}`;
            expect(await deployTo(actor, path, scriptName)).toMatchObject({
                success: true,
            });
            expect(putCalls()).toHaveLength(1);
        });

        it('refuses a file another user owns, even with manage on it', async () => {
            const owner = await makeUser();
            const deployer = await makeUser();
            const path = `/${owner.user.username}/site.worker.js`;
            const entry = await writeSource(
                owner.actor,
                owner.user.id,
                path,
                'v1',
            );
            await server.services.acl.setUserUser(
                owner.actor,
                deployer.actor,
                {
                    path: entry.path,
                    resolveAncestors: () =>
                        server.services.fs.getAncestorChain(entry.path),
                },
                'manage',
            );
            const scriptName = `dt-foreign-${deployer.user.username}`;
            await expect(
                deployTo(deployer.actor, path, scriptName),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'forbidden',
            });
            expect(putCalls()).toHaveLength(0);
            expect(
                await workerSession(deployer.user.id, scriptName),
            ).toBeNull();
        });
    });

    it('surfaces an edge deploy failure with stack lines rebased past the preamble', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'boom');
        const preambleLines =
            (await import('./WorkerDriver.js')).getWorkerPreamble().split('\n')
                .length - 1;

        fetchSpy.mockResolvedValueOnce(
            edgeResponse({
                success: false,
                errors: [
                    {
                        message: `SyntaxError: bad\n    at worker.js:${preambleLines + 12}:5\n    at other.js:3:1`,
                    },
                ],
            }),
        );

        const result = (await inCtx(actor, () =>
            target.create({
                appId: '',
                workerName: `fail-${user.username}`,
                filePath: path,
            }),
        )) as { success: boolean; errors: string[]; url: null };

        expect(result.success).toBe(false);
        expect(result.url).toBeNull();
        // The injected preamble must not shift the line numbers the user sees.
        expect(result.errors[0]).toContain('at worker.js:12:5');
        expect(result.errors[0]).toContain('at other.js:3:1');
        expect(result.errors[0]).toContain('SyntaxError: bad');
    });

    it('returns 500 when the acting user row no longer exists', async () => {
        const ghost: Actor = {
            user: {
                id: 987_654,
                uuid: uuidv4(),
                username: 'ghost',
                email: 'ghost@test.local',
                email_confirmed: true,
            } as Actor['user'],
        };
        await expect(
            inCtx(ghost, () =>
                target.create({
                    appId: '',
                    workerName: 'ghost-worker',
                    // Inline source: a path would 404 before the user lookup.
                    filePath: 'data:application/javascript,export default {}',
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 500,
            legacyCode: 'internal_error',
        });
    });
});

// -- destroy ---------------------------------------------------------

describe('WorkerDriver.destroy with a configured deploy backend', () => {
    it('deletes at the edge and removes the subdomain row', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'src');
        const name = `del-${user.username}`;
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: path }),
        );

        fetchSpy.mockResolvedValueOnce(edgeResponse({ success: true }));
        const result = await inCtx(actor, () =>
            target.destroy({ workerName: name }),
        );

        expect(result).toEqual({
            success: true,
            errors: [],
            messages: [],
            result: { id: name },
        });
        const [url, init] = deleteCalls()[0]!;
        expect(url).toBe(`${SCRIPTS_BASE}/${name}/`);
        expect((init as RequestInit).headers).toEqual({
            Authorization: `Bearer ${AUTH_KEY}`,
        });
        expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeFalsy();
    });

    it('reports a refused edge delete as 502 and keeps the row and the worker session', async () => {
        const { user, actor, name, token } = await deployWorker('refused');

        fetchSpy.mockResolvedValueOnce(
            edgeResponse(
                {
                    success: false,
                    errors: [{ code: 10000, message: 'Internal error' }],
                },
                500,
            ),
        );
        await expect(
            inCtx(actor, () => target.destroy({ workerName: name })),
        ).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'worker_takedown_failed',
            message:
                'Cloudflare refused to remove the script; nothing was deleted.',
            fields: { status: 500 },
        });

        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();
        expect(await workerSession(user.id, name)).toBeTruthy();
        expect(
            (await server.services.auth.authenticate(token)).actor,
        ).toBeTruthy();
    });

    it('keeps the row when the edge answers 200 with success:false', async () => {
        const { actor, name } = await deployWorker('softfail');

        fetchSpy.mockResolvedValueOnce(
            edgeResponse({ success: false, errors: [{ code: 10001 }] }),
        );
        await expect(
            inCtx(actor, () => target.destroy({ workerName: name })),
        ).rejects.toMatchObject({ statusCode: 502 });

        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();
    });

    it('reports an edge delete that times out as 504 and keeps the row', async () => {
        const { actor, name } = await deployWorker('slow');

        fetchSpy.mockRejectedValueOnce(
            new DOMException('The operation was aborted', 'TimeoutError'),
        );
        await expect(
            inCtx(actor, () => target.destroy({ workerName: name })),
        ).rejects.toMatchObject({
            statusCode: 504,
            legacyCode: 'worker_takedown_timeout',
        });

        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();
    });

    it('reports a transport failure as 504 and keeps the row', async () => {
        const { actor, name } = await deployWorker('unreachable');

        fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
        await expect(
            inCtx(actor, () => target.destroy({ workerName: name })),
        ).rejects.toMatchObject({
            statusCode: 504,
            legacyCode: 'worker_takedown_timeout',
        });

        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();
    });

    it('lets any other failure before the edge answers surface as itself', async () => {
        const { actor, name } = await deployWorker('ownerr');

        fetchSpy.mockRejectedValueOnce(new Error('config unavailable'));
        const err = (await inCtx(actor, () =>
            target.destroy({ workerName: name }),
        ).catch((e: unknown) => e)) as Error & { statusCode?: number };
        expect(err.message).toBe('config unavailable');
        expect(err.statusCode).toBeUndefined();

        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();
    });

    it('tears down in order: script, then sessions, then row', async () => {
        const { user, actor, name } = await deployWorker('order');
        const store = server.stores.subdomain;
        let seenAtRowDelete: { edgeDeletes: number; sessionGone: boolean } = {
            edgeDeletes: -1,
            sessionGone: false,
        };
        const deleteSpy = vi
            .spyOn(store, 'deleteByUuid')
            .mockImplementation(async (...args) => {
                seenAtRowDelete = {
                    edgeDeletes: deleteCalls().length,
                    sessionGone: !(await workerSession(user.id, name)),
                };
                deleteSpy.mockRestore();
                return store.deleteByUuid(...args);
            });

        await inCtx(actor, () => target.destroy({ workerName: name }));

        expect(seenAtRowDelete).toEqual({ edgeDeletes: 1, sessionGone: true });
    });

    it('keeps the row when the sessions cannot be dropped, and a retry finishes the job', async () => {
        const { actor, name } = await deployWorker('retry');
        vi.spyOn(
            server.services.auth,
            'deleteWorkerSessionsByName',
        ).mockRejectedValueOnce(new Error('session store unavailable'));

        await expect(
            inCtx(actor, () => target.destroy({ workerName: name })),
        ).rejects.toThrow('session store unavailable');
        expect(deleteCalls()).toHaveLength(1);
        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();

        const retried = await inCtx(actor, () =>
            target.destroy({ workerName: name }),
        );
        expect(retried).toEqual({
            success: true,
            errors: [],
            messages: [],
            result: { id: name },
        });
        expect(deleteCalls()).toHaveLength(2);
        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeFalsy();
    });

    it('treats a script the edge no longer has (code 10007) as taken down', async () => {
        const { user, actor, name } = await deployWorker('gone10007');

        fetchSpy.mockResolvedValueOnce(
            edgeResponse(
                {
                    success: false,
                    errors: [
                        {
                            code: 10007,
                            message: 'workers.api.error.script_not_found',
                        },
                    ],
                },
                404,
            ),
        );
        const result = await inCtx(actor, () =>
            target.destroy({ workerName: name }),
        );

        expect(result).toEqual({
            success: true,
            errors: [],
            messages: [],
            result: { id: name },
        });
        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeFalsy();
        expect(await workerSession(user.id, name)).toBeNull();
    });

    it('lowercases the requested name before looking the worker up', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'src');
        const name = `case-${user.username}`;
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: path }),
        );

        await inCtx(actor, () =>
            target.destroy({ workerName: name.toUpperCase() }),
        );

        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeFalsy();
    });
});

// -- operator teardown ------------------------------------------------

describe('WorkerDriver operator teardown (INTERNAL_ADMIN_DESTROY)', () => {
    const rowOf = (name: string) =>
        server.stores.subdomain.getBySubdomain(`workers.puter.${name}`, {
            primary: true,
        });

    /** Collects every `subdomain.delete` announced while `fn` runs. */
    const announced = async <T>(fn: () => Promise<T>) => {
        const seen: unknown[] = [];
        const handler = (_key: string, data: unknown) => {
            seen.push(data);
        };
        server.clients.event.on('subdomain.delete', handler as never);
        try {
            return { result: await fn(), seen };
        } finally {
            server.clients.event.off('subdomain.delete', handler as never);
        }
    };

    it('takes the script down before the row, drops the session, and announces the delete once', async () => {
        const { user, name, token } = await deployWorker('op');
        const row = (await rowOf(name))!;
        const store = server.stores.subdomain;
        let seenAtRowDelete = { edgeDeletes: -1, sessionGone: false };
        const deleteSpy = vi
            .spyOn(store, 'deleteByUuid')
            .mockImplementation(async (...args) => {
                seenAtRowDelete = {
                    edgeDeletes: deleteCalls().length,
                    sessionGone: !(await workerSession(user.id, name)),
                };
                deleteSpy.mockRestore();
                return store.deleteByUuid(...args);
            });

        const { result, seen } = await announced(() =>
            target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid }),
        );

        expect(result).toEqual({
            subdomain: `workers.puter.${name}`,
            userId: user.id,
            workerName: name,
        });
        const [url] = deleteCalls()[0]!;
        expect(url).toBe(`${SCRIPTS_BASE}/${name}/`);
        expect(seenAtRowDelete).toEqual({ edgeDeletes: 1, sessionGone: true });
        expect(await rowOf(name)).toBeNull();
        expect(await workerSession(user.id, name)).toBeNull();
        expect(await server.services.auth.authenticate(token)).toEqual({
            invalid: true,
        });
        expect(seen).toEqual([
            {
                subdomain: `workers.puter.${name}`,
                uid: row.uuid,
                userId: user.id,
            },
        ]);

        // The driver's own listener hears this and leaves the script alone.
        await new Promise((r) => setTimeout(r, 50));
        expect(deleteCalls()).toHaveLength(1);
    });

    it('reports a refused edge delete as 502 and keeps the row and session', async () => {
        const { user, name, token } = await deployWorker('oprefused');
        const row = (await rowOf(name))!;

        fetchSpy.mockResolvedValueOnce(
            edgeResponse(
                {
                    success: false,
                    errors: [{ code: 10000, message: 'edge-only detail' }],
                },
                500,
            ),
        );
        const { seen } = await announced(async () => {
            const err = (await target[INTERNAL_ADMIN_DESTROY]({
                uuid: row.uuid,
            }).catch((e: unknown) => e)) as {
                statusCode: number;
                legacyCode: string;
                message: string;
                fields: unknown;
            };
            expect(err).toMatchObject({
                statusCode: 502,
                legacyCode: 'worker_takedown_failed',
                message:
                    'Cloudflare refused to remove the script; nothing was deleted.',
                fields: { status: 500 },
            });
            // Cloudflare's own text stays out of what the caller sees.
            expect(JSON.stringify([err.message, err.fields])).not.toContain(
                'edge-only detail',
            );
        });

        expect(await rowOf(name)).toMatchObject({ uuid: row.uuid });
        expect(await workerSession(user.id, name)).toBeTruthy();
        expect(
            (await server.services.auth.authenticate(token)).actor,
        ).toBeTruthy();
        expect(seen).toEqual([]);
    });

    it('keeps the row when the edge answers 200 with success:false', async () => {
        const { name } = await deployWorker('opsoft');
        const row = (await rowOf(name))!;

        fetchSpy.mockResolvedValueOnce(
            edgeResponse({ success: false, errors: [] }),
        );
        await expect(
            target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid }),
        ).rejects.toMatchObject({ statusCode: 502 });

        expect(await rowOf(name)).toMatchObject({ uuid: row.uuid });
    });

    it('treats script-not-found (code 10007) as taken down', async () => {
        const { name } = await deployWorker('op10007');
        const row = (await rowOf(name))!;

        fetchSpy.mockResolvedValueOnce(
            edgeResponse(
                {
                    success: false,
                    errors: [
                        {
                            code: 10007,
                            message: 'workers.api.error.script_not_found',
                        },
                    ],
                },
                404,
            ),
        );
        await expect(
            target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid }),
        ).resolves.toMatchObject({ workerName: name });

        expect(await rowOf(name)).toBeNull();
    });

    it('treats a bare 404 with no usable body as a refusal and keeps the row', async () => {
        const { name } = await deployWorker('op404');
        const row = (await rowOf(name))!;

        fetchSpy.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => {
                throw new SyntaxError('not json');
            },
        } as unknown as Response);
        await expect(
            target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid }),
        ).rejects.toMatchObject({ statusCode: 502, fields: { status: 404 } });

        expect(await rowOf(name)).toMatchObject({ uuid: row.uuid });
    });

    it('treats a 404 that could not be routed (code 7003) as a refusal and keeps the row', async () => {
        const { name } = await deployWorker('op7003');
        const row = (await rowOf(name))!;

        fetchSpy.mockResolvedValueOnce(
            edgeResponse(
                {
                    success: false,
                    errors: [
                        {
                            code: 7003,
                            message: 'Could not route to /accounts/x/workers',
                        },
                    ],
                },
                404,
            ),
        );
        await expect(
            target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid }),
        ).rejects.toMatchObject({
            statusCode: 502,
            legacyCode: 'worker_takedown_failed',
        });

        expect(await rowOf(name)).toMatchObject({ uuid: row.uuid });
    });

    it('reports a timed-out edge delete as 504 with no edge text, and keeps the row', async () => {
        const { name } = await deployWorker('opslow');
        const row = (await rowOf(name))!;

        fetchSpy.mockRejectedValueOnce(
            new DOMException('edge-only timeout detail', 'TimeoutError'),
        );
        const err = (await target[INTERNAL_ADMIN_DESTROY]({
            uuid: row.uuid,
        }).catch((e: unknown) => e)) as {
            message: string;
            fields: unknown;
        };
        expect(err).toMatchObject({
            statusCode: 504,
            legacyCode: 'worker_takedown_timeout',
        });
        expect(JSON.stringify([err.message, err.fields ?? null])).not.toContain(
            'edge-only',
        );

        expect(await rowOf(name)).toMatchObject({ uuid: row.uuid });
    });

    it('keeps the row when the sessions cannot be dropped, and a retry finishes the job', async () => {
        const { name } = await deployWorker('opretry');
        const row = (await rowOf(name))!;
        vi.spyOn(
            server.services.auth,
            'deleteWorkerSessionsByName',
        ).mockRejectedValueOnce(new Error('session store unavailable'));

        const { seen } = await announced(async () =>
            expect(
                target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid }),
            ).rejects.toThrow('session store unavailable'),
        );
        expect(deleteCalls()).toHaveLength(1);
        expect(await rowOf(name)).toMatchObject({ uuid: row.uuid });
        expect(seen).toEqual([]);

        await target[INTERNAL_ADMIN_DESTROY]({ uuid: row.uuid });
        expect(deleteCalls()).toHaveLength(2);
        expect(await rowOf(name)).toBeNull();
    });

    it('skips only its own announcement: a re-created worker of the same name is still taken down', async () => {
        const { user, actor, name } = await deployWorker('opsame');
        const first = (await rowOf(name))!;
        await target[INTERNAL_ADMIN_DESTROY]({ uuid: first.uuid });
        await new Promise((r) => setTimeout(r, 50));
        expect(deleteCalls()).toHaveLength(1);

        // Same name, new row: a delete announced for it is not the one above.
        await inCtx(actor, () =>
            target.create({
                appId: '',
                workerName: name,
                filePath: `/${user.username}/opsame.js`,
            }),
        );
        const second = (await rowOf(name))!;
        expect(second.uuid).not.toBe(first.uuid);
        await server.stores.subdomain.deleteByUuid(second.uuid);
        server.clients.event.emit(
            'subdomain.delete',
            {
                subdomain: `workers.puter.${name}`,
                uid: second.uuid,
                userId: Number(second.user_id),
            },
            {},
        );

        await waitFor(
            async () => deleteCalls().length === 2,
            'edge delete for the re-created worker',
        );
    });

    it('returns 404 for a row that is not a worker, and leaves it alone', async () => {
        const { user } = await makeUser();
        const site = await server.stores.subdomain.create({
            userId: user.id,
            subdomain: `site-${user.username}`,
            rootDirId: null,
            associatedAppId: null,
        });

        await expect(
            target[INTERNAL_ADMIN_DESTROY]({ uuid: site.uuid }),
        ).rejects.toMatchObject({ statusCode: 404, legacyCode: 'not_found' });

        expect(deleteCalls()).toEqual([]);
        expect(
            await server.stores.subdomain.getByUuid(site.uuid, {
                primary: true,
            }),
        ).toBeTruthy();
    });

    it('returns 404 for an unknown or missing uuid', async () => {
        await expect(
            target[INTERNAL_ADMIN_DESTROY]({ uuid: uuidv4() }),
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
            target[INTERNAL_ADMIN_DESTROY]({} as { uuid: string }),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(deleteCalls()).toEqual([]);
    });

    it('is not on the /drivers/call surface', () => {
        const callable = resolveCallableMethods(target);
        expect([...callable].sort()).toEqual([
            'create',
            'destroy',
            'getFilePaths',
            'getLoggingUrl',
        ]);
        expect(callable.has(String(INTERNAL_ADMIN_DESTROY.description))).toBe(
            false,
        );
    });
});

// -- worker rows deleted elsewhere ------------------------------------

describe('WorkerDriver on subdomain.delete', () => {
    const waitForDelete = async (url: string) => {
        for (let i = 0; i < 100; i++) {
            if (deleteCalls().some(([u]) => u === url)) return;
            await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error(`no DELETE to ${url}`);
    };

    it('takes the script down when its owner’s account is deleted', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/worker.js`;
        await writeSource(actor, user.id, path, 'src');
        const name = `acct-${user.username}`;
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: path }),
        );

        await server.services.userAccount.cascadeDelete(user.id);

        await waitForDelete(`${SCRIPTS_BASE}/${name}/`);
    });

    it('leaves the edge alone for a site that is not a worker', async () => {
        server.clients.event.emit(
            'subdomain.delete',
            { subdomain: 'plain-site', uid: uuidv4() },
            {},
        );
        await new Promise((r) => setTimeout(r, 50));
        expect(deleteCalls()).toEqual([]);
    });
});

// -- getFilePaths ----------------------------------------------------

describe('WorkerDriver.getFilePaths source resolution', () => {
    it('reports the bound source path and uid for each worker', async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/listed.js`;
        const entry = await writeSource(actor, user.id, path, 'src');
        const name = `listed-${user.username}`;
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: path }),
        );

        const rows = (await inCtx(actor, () =>
            target.getFilePaths({}),
        )) as Array<{
            name: string;
            url: string;
            file_path: string | null;
            file_uid: string | null;
            app_uid: string | null;
            app_name: string | null;
            created_at: string | null;
        }>;

        const row = rows.find((r) => r.name === name)!;
        expect(row).toBeDefined();
        expect(row.url).toBe(`https://${name}.puter.work`);
        expect(row.file_path).toBe(path);
        expect(row.file_uid).toBe(entry.uuid);
        expect(row.app_uid).toBeNull();
        expect(row.app_name).toBeNull();
        expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports null source fields for a worker with no bound file', async () => {
        const { user, actor } = await makeUser();
        await server.stores.subdomain.create({
            userId: user.id,
            subdomain: `workers.puter.orphan-${user.username}`,
            rootDirId: null,
            associatedAppId: null,
            appOwner: null,
        });

        const rows = (await inCtx(actor, () =>
            target.getFilePaths({ workerName: `orphan-${user.username}` }),
        )) as Array<{ file_path: string | null; file_uid: string | null }>;

        expect(rows).toHaveLength(1);
        expect(rows[0]!.file_path).toBeNull();
        expect(rows[0]!.file_uid).toBeNull();
    });
});

// -- Hot reload ------------------------------------------------------

describe('WorkerDriver hot reload', () => {
    const deployWorker = async () => {
        const { user, actor } = await makeUser();
        const path = `/${user.username}/hot.js`;
        const entry = await writeSource(actor, user.id, path, 'v1');
        const name = `hot-${user.username}`;
        await inCtx(actor, () =>
            target.create({ appId: '', workerName: name, filePath: path }),
        );
        return { user, actor, path, entry, name };
    };

    it('redeploys the worker when its source file is overwritten', async () => {
        const { user, actor, path, name } = await deployWorker();
        fetchSpy.mockClear();

        await writeSource(actor, user.id, path, 'v2-updated-body');

        await waitFor(() => putCalls().length > 0, 'hot-reload deploy');
        const [url, init] = putCalls()[0]!;
        expect(url).toBe(`${SCRIPTS_BASE}/${name}/`);
        const form = (init as RequestInit).body as FormData;
        const code = await (form.get('swCode') as Blob).text();
        expect(code.endsWith('v2-updated-body')).toBe(true);
    });

    it('notifies the owner after a successful hot-reload deploy', async () => {
        const { user, actor, path, name } = await deployWorker();
        const notifySpy = vi.spyOn(server.services.notification, 'notify');

        await writeSource(actor, user.id, path, 'v2');

        await waitFor(
            () => notifySpy.mock.calls.length > 0,
            'hot-reload notification',
        );
        expect(notifySpy).toHaveBeenCalledWith(
            [user.id],
            expect.objectContaining({
                title: `Successfully deployed https://${name}.puter.work`,
            }),
            expect.objectContaining({
                type: 'app.worker.deployed',
                appUid: null,
            }),
        );
    });

    it('notifies the owner with the failure detail when the redeploy is rejected', async () => {
        const { user, actor, path, name } = await deployWorker();
        const notifySpy = vi.spyOn(server.services.notification, 'notify');
        fetchSpy.mockResolvedValue(
            edgeResponse({
                success: false,
                errors: [{ message: 'script too large' }],
            }),
        );

        await writeSource(actor, user.id, path, 'v2');

        await waitFor(
            () => notifySpy.mock.calls.length > 0,
            'hot-reload failure notification',
        );
        const [, payload] = notifySpy.mock.calls[0]!;
        expect((payload as { title: string }).title).toContain(
            `Failed to deploy ${name}!`,
        );
        expect((payload as { title: string }).title).toContain(
            'script too large',
        );
    });

    it('tears the worker down when its source file is deleted', async () => {
        const { user, actor, path, name } = await deployWorker();
        fetchSpy.mockClear();
        // Resolved at delete time, as every caller does: the entry names the
        // workers bound to it.
        const entry = await server.stores.fsEntry.getEntryByPath(path);

        await inCtx(actor, () =>
            server.services.fs.remove(user.id, { entry: entry! }),
        );

        await waitFor(async () => {
            const row = await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            );
            return !row;
        }, 'subdomain row removal after source delete');
        expect(deleteCalls().map((call) => call[0])).toContain(
            `${SCRIPTS_BASE}/${name}/`,
        );
        expect(path).toContain(user.username);
    });

    it('tears the worker down when the delete nulls its root_dir_id', async () => {
        // MySQL and Postgres null `subdomains.root_dir_id` when its fsentry row
        // is deleted (FK ON DELETE SET NULL). SQLite's schema has no such FK,
        // so a trigger stands in for it.
        await server.clients.db.write(
            'CREATE TRIGGER test_subdomain_root_set_null AFTER DELETE ON fsentries ' +
                'BEGIN UPDATE subdomains SET root_dir_id = NULL WHERE root_dir_id = OLD.id; END',
        );
        try {
            const { user, actor, path, name } = await deployWorker();
            fetchSpy.mockClear();
            const entry = await server.stores.fsEntry.getEntryByPath(path);

            await inCtx(actor, () =>
                server.services.fs.remove(user.id, { entry: entry! }),
            );

            await waitFor(
                () => deleteCalls().length > 0,
                'edge delete after source delete',
            );
            expect(deleteCalls().map((call) => call[0])).toContain(
                `${SCRIPTS_BASE}/${name}/`,
            );
        } finally {
            await server.clients.db.write(
                'DROP TRIGGER IF EXISTS test_subdomain_root_set_null',
            );
        }
    });

    it('tears the worker down when its source file is moved to Trash', async () => {
        const { user, actor, entry, name } = await deployWorker();
        fetchSpy.mockClear();
        const trash = await server.stores.fsEntry.getEntryByPath(
            `/${user.username}/Trash`,
        );
        expect(trash).toBeTruthy();

        await inCtx(actor, () =>
            server.services.fs.move(user.id, {
                source: entry,
                destinationParent: trash!,
            }),
        );

        await waitFor(async () => {
            const row = await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            );
            return !row;
        }, 'subdomain row removal after trash move');
        expect(deleteCalls().map((call) => call[0])).toContain(
            `${SCRIPTS_BASE}/${name}/`,
        );
    });

    it('leaves the worker alone when its source file is moved somewhere other than Trash', async () => {
        const { user, actor, entry, name } = await deployWorker();
        fetchSpy.mockClear();
        const documents = await server.stores.fsEntry.getEntryByPath(
            `/${user.username}/Documents`,
        );

        await inCtx(actor, () =>
            server.services.fs.move(user.id, {
                source: entry,
                destinationParent: documents!,
            }),
        );

        // Give the (fire-and-forget) handler a chance to misbehave.
        await new Promise((r) => setTimeout(r, 120));
        expect(deleteCalls()).toHaveLength(0);
        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeTruthy();
    });

    it('ignores writes to files that no worker is bound to', async () => {
        const { user, actor } = await makeUser();
        fetchSpy.mockClear();

        await writeSource(
            actor,
            user.id,
            `/${user.username}/unrelated.js`,
            'first',
        );
        await writeSource(
            actor,
            user.id,
            `/${user.username}/unrelated.js`,
            'second',
        );

        await new Promise((r) => setTimeout(r, 120));
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('runs no subdomain query for a write, delete or move of a file no worker is bound to', async () => {
        const { user, actor } = await makeUser();
        const listSpy = vi.spyOn(
            server.stores.subdomain,
            'listByUserIdAndPrefix',
        );
        const batchSpy = vi.spyOn(server.stores.subdomain, 'getBySubdomains');
        const path = `/${user.username}/plain.js`;

        await writeSource(actor, user.id, path, 'first');
        const entry = await writeSource(actor, user.id, path, 'second');
        const trash = await server.stores.fsEntry.getEntryByPath(
            `/${user.username}/Trash`,
        );
        await inCtx(actor, () =>
            server.services.fs.move(user.id, {
                source: entry,
                destinationParent: trash!,
            }),
        );
        const moved = await server.stores.fsEntry.getEntryByUuid(entry.uuid);
        await inCtx(actor, () =>
            server.services.fs.remove(user.id, { entry: moved! }),
        );

        await new Promise((r) => setTimeout(r, 120));
        expect(listSpy).not.toHaveBeenCalled();
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('looks up a bound file’s worker rows with one primary batch read', async () => {
        const { user, actor, path, name } = await deployWorker();
        const listSpy = vi.spyOn(
            server.stores.subdomain,
            'listByUserIdAndPrefix',
        );
        const batchSpy = vi.spyOn(server.stores.subdomain, 'getBySubdomains');
        fetchSpy.mockClear();

        await writeSource(actor, user.id, path, 'v2');

        await waitFor(() => putCalls().length > 0, 'hot-reload deploy');
        expect(listSpy).not.toHaveBeenCalled();
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy).toHaveBeenCalledWith([`workers.puter.${name}`], {
            primary: true,
        });
    });

    // Deleting the app a worker is bound to deletes the worker row with it.
    // Were the row to survive unbound, the next source write would redeploy
    // it with an account-scoped token — a child app is enough to set that up.
    it('does not redeploy a worker whose app was deleted, and never falls back to an account-scoped token', async () => {
        const { user, actor } = await makeUser();
        const builder = await server.stores.app.create(
            {
                name: `builder-${user.username}`,
                title: 'builder',
                index_url: `https://builder-${user.username}.example.com/`,
            },
            { ownerUserId: user.id },
        );
        const child = await server.stores.app.create(
            {
                name: `child-${user.username}`,
                title: 'child',
                index_url: `https://child-${user.username}.example.com/`,
            },
            { ownerUserId: user.id, appOwner: builder.id },
        );
        const path = `/${user.username}/bound.js`;
        await writeSource(actor, user.id, path, 'v1');
        const name = `bound-${user.username}`;
        await inCtx(actor, () =>
            target.create({
                appId: child.uid,
                workerName: name,
                filePath: path,
            }),
        );

        // Uncached listing: the by-name cache would still serve the row.
        const rowsFor = () =>
            server.stores.subdomain.listByUserIdAndPrefix(
                user.id,
                `workers.puter.${name}`,
            );
        const [row] = await rowsFor();
        expect(Number(row!.app_owner)).toBe(child.id);

        await server.stores.app.delete(child.id);
        expect(await rowsFor()).toEqual([]);

        fetchSpy.mockClear();
        const sessionMint = vi.spyOn(
            server.services.auth,
            'createWorkerSessionToken',
        );
        await writeSource(actor, user.id, path, 'v2');

        await new Promise((r) => setTimeout(r, 120));
        expect(putCalls()).toHaveLength(0);
        expect(sessionMint).not.toHaveBeenCalled();
    });
});

// -- worker sessions --------------------------------------------------

describe('WorkerDriver keeps a worker`s token tied to the worker', () => {
    it('binds the deployed token to the worker row, and a redeploy keeps it', async () => {
        const { user, actor, name, token } = await deployWorker('bind');
        const row = await server.stores.subdomain.getBySubdomain(
            `workers.puter.${name}`,
        );
        const decoded = server.services.token.verify('auth', token) as {
            worker_uid?: string;
        };
        expect(decoded.worker_uid).toBe(row!.uuid);
        expect(
            (await server.services.auth.authenticate(token)).actor,
        ).toBeTruthy();

        await inCtx(actor, () =>
            target.create({
                appId: '',
                workerName: name,
                filePath: `/${user.username}/bind.js`,
            }),
        );
        const redeployed = server.services.token.verify(
            'auth',
            deployedToken(),
        ) as { worker_uid?: string };
        expect(redeployed.worker_uid).toBe(row!.uuid);
    });

    it('destroy deletes the worker`s session and leaves other workers alone', async () => {
        const kept = await deployWorker('kept');
        const { user, actor, name, token } = await deployWorker('gone');

        await inCtx(actor, () => target.destroy({ workerName: name }));

        expect(await workerSession(user.id, name)).toBeNull();
        expect(await server.services.auth.authenticate(token)).toEqual({
            invalid: true,
        });
        expect(await workerSession(kept.user.id, kept.name)).toBeTruthy();
        expect(
            (await server.services.auth.authenticate(kept.token)).actor,
        ).toBeTruthy();
    });

    it('deleting the source file deletes the worker`s session', async () => {
        const { user, actor, entry, name } = await deployWorker('srcdel');
        // Resolved at delete time, as every caller does: the entry names the
        // workers bound to it.
        const current = await server.stores.fsEntry.getEntryByUuid(entry.uuid);

        await inCtx(actor, () =>
            server.services.fs.remove(user.id, { entry: current! }),
        );

        await waitFor(
            async () => !(await workerSession(user.id, name)),
            'worker session removal after source delete',
        );
    });

    it('a worker row deleted elsewhere takes its session with it', async () => {
        const { user, name } = await deployWorker('elsewhere');
        const row = await server.stores.subdomain.getBySubdomain(
            `workers.puter.${name}`,
        );

        await server.stores.subdomain.deleteByUuid(String(row!.uuid));
        server.clients.event.emit(
            'subdomain.delete',
            {
                subdomain: `workers.puter.${name}`,
                uid: String(row!.uuid),
                userId: user.id,
            },
            {},
        );

        await waitFor(
            async () => !(await workerSession(user.id, name)),
            'worker session removal after subdomain.delete',
        );
    });
});
