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
import {
    INTERNAL_ADMISSION_BYPASS,
    type WorkerDriver,
} from './WorkerDriver.js';

const ACCOUNT_ID = 'cf-account';
const AUTH_KEY = 'cf-auth-key';
const SCRIPTS_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`;

let server: PuterServer;
let target: WorkerDriver;
let fetchSpy: MockInstance<typeof fetch>;

const edgeResponse = (body: unknown) =>
    ({ json: async () => body }) as unknown as Response;

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
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    );
const deleteCalls = () =>
    fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );

// -- create ----------------------------------------------------------

describe('WorkerDriver.create with a configured deploy backend', () => {
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
                    filePath: '/ghost/worker.js',
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

        expect(result).toEqual({ success: true });
        const [url, init] = deleteCalls()[0]!;
        expect(url).toBe(`${SCRIPTS_BASE}/${name}/`);
        expect((init as RequestInit).headers).toEqual({
            Authorization: `Bearer ${AUTH_KEY}`,
        });
        expect(
            await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            ),
        ).toBeFalsy();
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
            created_at: string | null;
        }>;

        const row = rows.find((r) => r.name === name)!;
        expect(row).toBeDefined();
        expect(row.url).toBe(`https://${name}.puter.work`);
        expect(row.file_path).toBe(path);
        expect(row.file_uid).toBe(entry.uuid);
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
                source: 'worker',
                title: `Successfully deployed https://${name}.puter.work`,
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
        const { user, actor, path, entry, name } = await deployWorker();
        fetchSpy.mockClear();

        await inCtx(actor, () => server.services.fs.remove(user.id, { entry }));

        await waitFor(async () => {
            const row = await server.stores.subdomain.getBySubdomain(
                `workers.puter.${name}`,
            );
            return !row;
        }, 'subdomain row removal after source delete');
        expect(deleteCalls().map(([u]) => u)).toContain(
            `${SCRIPTS_BASE}/${name}/`,
        );
        expect(path).toContain(user.username);
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
        expect(deleteCalls().map(([u]) => u)).toContain(
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
});
