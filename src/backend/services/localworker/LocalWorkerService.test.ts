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

import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SubdomainRow } from '../../stores/subdomain/SubdomainStore.js';
import type { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { getWorkerPreamble } from '../../drivers/workers/WorkerDriver.js';
import type { LocalWorkerService } from './LocalWorkerService.js';

let server: PuterServer;
let localWorkers: LocalWorkerService;
let ownerUserId: number;
let ownerUsername: string;

beforeAll(async () => {
    server = await setupTestServer({
        // Miniflare binds this into every local worker; the constructor
        // rejects an undefined binding value.
        api_base_url: 'http://api.puter.localhost:4100',
    } as never);
    localWorkers = server.services
        .localworkerservice as unknown as LocalWorkerService;
    const created = await createTestUser(server, {
        username: 'lws',
        password: 'local-worker-password',
    });
    ownerUsername = created.username;
    const row = await server.stores.user.getByUsername(created.username);
    ownerUserId = row!.id;
}, 60_000);

afterAll(async () => {
    localWorkers?.onServerShutdown();
    await server?.shutdown();
}, 60_000);

/** Write a worker source file into the owner's home and return its entry. */
const writeSource = async (
    filename: string,
    source: string,
): Promise<{ id: number; uuid: string }> => {
    const path = `/${ownerUsername}/${filename}`;
    await server.services.fs.write(ownerUserId, {
        fileMetadata: {
            path,
            size: Buffer.byteLength(source),
            contentType: 'text/javascript',
            overwrite: true,
            createMissingParents: true,
        },
        fileContent: Readable.from(Buffer.from(source)),
    });
    const entry = await server.stores.fsEntry.getEntryByPath(path);
    return { id: entry!.id as number, uuid: String(entry!.uuid) };
};

const subdomainRow = (over: Partial<SubdomainRow>): SubdomainRow =>
    ({
        user_id: ownerUserId,
        app_owner: null,
        root_dir_id: null,
        ...over,
    }) as SubdomainRow;

describe('LocalWorkerService.reconstructDeployArgs', () => {
    it('mints a user-scoped worker session token and prepends the preamble', async () => {
        const src = await writeSource(
            'worker-a.js',
            "export default { fetch: () => new Response('a') };",
        );
        const [name, authorization, code] =
            await localWorkers.reconstructDeployArgs(
                'worker-a',
                subdomainRow({ root_dir_id: src.id }),
            );

        const source = "export default { fetch: () => new Response('a') };";

        expect(name).toBe('worker-a');
        // Assert the concatenation contract directly against the preamble the
        // driver actually loaded. `src/worker/dist/` is a gitignored build
        // artifact, so asserting a non-empty prefix instead would make this
        // test pass or fail on whether the tree happens to be built.
        expect(code).toBe(getWorkerPreamble() + source);

        // The credential is a real worker session token for the owner.
        const auth = await server.services.auth.authenticate(authorization);
        expect(auth.actor?.user?.id).toBe(ownerUserId);
        expect(auth.actor?.session?.kind).toBe('worker');
    });

    it('mints an app-scoped token when the worker belongs to an app', async () => {
        const src = await writeSource(
            'worker-b.js',
            "export default { fetch: () => new Response('b') };",
        );
        const app = await (
            server.stores.app.create as unknown as (
                f: Record<string, unknown>,
                o: { ownerUserId: number },
            ) => Promise<{ id: number; uid: string }>
        )(
            {
                name: `lws-app-${Date.now()}`,
                title: 'LWS app',
                index_url: 'https://lws-app.test/',
            },
            { ownerUserId },
        );

        const [, authorization] = await localWorkers.reconstructDeployArgs(
            'worker-b',
            subdomainRow({ root_dir_id: src.id, app_owner: app.id }),
        );

        const auth = await server.services.auth.authenticate(authorization);
        expect(auth.actor?.app?.uid).toBe(app.uid);
        expect(auth.actor?.user?.id).toBe(ownerUserId);
    });

    it('refuses when the owning user no longer exists', async () => {
        await expect(
            localWorkers.reconstructDeployArgs(
                'worker-ghost',
                subdomainRow({ user_id: 999_999, root_dir_id: 1 }),
            ),
        ).rejects.toThrow('Owner seems to not exist');
    });

    it('refuses when the owning app no longer exists', async () => {
        const src = await writeSource('worker-c.js', 'export default {};');
        await expect(
            localWorkers.reconstructDeployArgs(
                'worker-c',
                subdomainRow({ root_dir_id: src.id, app_owner: 999_999 }),
            ),
        ).rejects.toThrow(/existant application/);
    });

    it('refuses a worker whose subdomain has no source file', async () => {
        await expect(
            localWorkers.reconstructDeployArgs(
                'worker-d',
                subdomainRow({ root_dir_id: null }),
            ),
        ).rejects.toThrow(/no root_dir_id/);
    });

    it('refuses when the source entry id points at nothing', async () => {
        await expect(
            localWorkers.reconstructDeployArgs(
                'worker-e',
                subdomainRow({ root_dir_id: 999_999 }),
            ),
        ).rejects.toThrow(/source file not found/);
    });
});

describe('LocalWorkerService.cfCallLocal', () => {
    it('404s a request for a worker with no subdomain row', async () => {
        const res = await localWorkers.cfCallLocal(
            `unknown-${Date.now()}`,
            new Request('http://x.localhost/'),
        );
        expect(res.status).toBe(404);
        expect(await res.text()).toBe('subdomain not found');
    });
});

describe('LocalWorkerService.cfDeleteLocal', () => {
    it('mirrors the upstream delete response shape', async () => {
        expect(await localWorkers.cfDeleteLocal('never-deployed')).toEqual({
            success: true,
            errors: [],
            messages: [],
            result: { id: 'never-deployed' },
        });
    });
});

describe('LocalWorkerService.cfDeployLocal', () => {
    it('deploys, serves a request, and stops serving after delete', async () => {
        const name = `lws-live-${Date.now()}`;
        const deployed = await localWorkers.cfDeployLocal(
            name,
            'test-authorization',
            `addEventListener('fetch', (e) => {
                e.respondWith(new Response('hello ' + puter_auth));
            });`,
        );

        expect(deployed.success).toBe(true);
        expect(deployed.errors).toEqual([]);
        expect(deployed.url).toContain(`${name}.workers.puter.localhost`);

        const res = await localWorkers.cfCallLocal(
            name,
            new Request('http://worker.localhost/hi'),
        );
        // The binding carries the authorization the deploy was given.
        expect(await res.text()).toBe('hello test-authorization');

        await localWorkers.cfDeleteLocal(name);
        // With the instance disposed and no subdomain row, the next call 404s.
        const after = await localWorkers.cfCallLocal(
            name,
            new Request('http://worker.localhost/hi'),
        );
        expect(after.status).toBe(404);
    }, 60_000);

    it('reports failure instead of throwing when the runtime rejects the options', async () => {
        const result = await localWorkers.cfDeployLocal(
            'bad-worker',
            'auth',
            // `script` and `scriptPath` are mutually exclusive; the Miniflare
            // constructor validates eagerly and throws.
            undefined as unknown as string,
        );
        expect(result).toEqual({ success: false, errors: [], url: null });
    });
});
