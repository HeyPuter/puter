/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

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
import { makeActor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import { setupTestServer } from '../../testUtil.js';

let server: PuterServer;

beforeAll(async () => {
    // A deploy backend is configured so the driver subscribes to `subdomain.delete`.
    server = await setupTestServer({
        workers: { XAUTHKEY: 'cf-auth-key', ACCOUNTID: 'cf-account' },
    } as never);
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('WorkerDriver on an app delete cascade', () => {
    it('deletes the session of a worker that cascades away with its app', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, errors: [] }),
        } as unknown as Response);

        const username = `wkcas${Math.random().toString(36).slice(2, 8)}`;
        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 50 * 1024 * 1024,
            requires_email_confirmation: false,
        });
        const app = await server.stores.app.create(
            {
                name: `wkcas-${uuidv4()}`,
                title: 'Cascade',
                index_url: `https://wkcas-${uuidv4()}.test/`,
            },
            { ownerUserId: user.id },
        );

        const workerName = `cascade-${username}`;
        const row = await server.stores.subdomain.create({
            userId: user.id,
            subdomain: `${WORKER_SUBDOMAIN_PREFIX}${workerName}`,
            associatedAppId: app.id,
        });
        await server.services.auth.createWorkerSessionToken(
            makeActor({ user }),
            user,
            workerName,
            {},
            { workerUid: row.uuid },
        );
        const session = () =>
            server.stores.session.getWorker(user.id, {
                appUid: null,
                workerName,
            });
        expect(await session()).toBeTruthy();

        expect(await server.stores.app.delete(app.id)).toBe(true);
        await vi.waitFor(async () => expect(await session()).toBeNull());
        // SQLite reuses the deleted app's id; drop anything it left behind.
        await server.clients.db.write(
            'DELETE FROM `subdomains` WHERE `uuid` = ?',
            [row.uuid],
        );
    });
});
