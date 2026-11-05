/*
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

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import { FSService } from './FSService.js';

/** Removing an app "with its data" takes its AppData folder too. */
describe('uninstalling an app with its data', () => {
    let env: PuterTestEnv;
    const pageSize = FSService.SUBTREE_PAGE_SIZE;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    afterEach(() => {
        FSService.SUBTREE_PAGE_SIZE = pageSize;
        vi.restoreAllMocks();
    });

    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        });

    const exists = async (path: string) =>
        (await env.server.stores.fsEntry.getEntryByPath(path, {
            skipCache: true,
        })) !== null;

    const launch = async (origin: string) => {
        const launched = await post(
            '/auth/get-user-app-token',
            env.users.user.token,
            { origin },
        );
        expect(launched.status).toBe(200);
        return (await launched.json()) as { token: string; app_uid: string };
    };

    /**
     * An app with `count` files in its AppData, plus a folder whose name
     * extends its uid.
     */
    const installWithFiles = async (count: number) => {
        const { username, token } = env.users.user;
        const origin = `https://uninstall-${Math.random().toString(36).slice(2, 10)}.example.com`;
        const app = await launch(origin);
        expect(
            (
                await post('/auth/request-app-root-dir', app.token, {
                    app_uid: app.app_uid,
                })
            ).status,
        ).toBe(200);
        const root = `/${username}/AppData/${app.app_uid}`;
        const files: string[] = [];
        for (let i = 0; i < count; i++) {
            const path = `${root}/notes-${i}.txt`;
            const written = await post('/fs/write', app.token, {
                fileMetadata: { path, size: 1, contentType: 'text/plain' },
                fileContent: 'x',
            });
            expect(written.status).toBe(200);
            files.push(path);
        }
        const lookalike = `${root}-keep`;
        expect(
            (await post('/fs/mkdir', token, { path: lookalike })).status,
        ).toBe(200);
        return { app, origin, root, files, lookalike };
    };

    const uninstall = (appUid: string, deleteData: boolean) =>
        post('/auth/revoke-user-app', env.users.user.token, {
            app_uid: appUid,
            permission: '*',
            deleteData,
        });

    it("deletes exactly the app's AppData folder", async () => {
        const { app, root, files, lookalike } = await installWithFiles(3);

        expect((await uninstall(app.app_uid, true)).status).toBe(200);

        await vi.waitFor(async () => expect(await exists(root)).toBe(false));
        for (const file of files) expect(await exists(file)).toBe(false);
        expect(await exists(lookalike)).toBe(true);
    });

    /** A site rooted at `dir`, serving an index.html written by the app. */
    const hostSite = async (appToken: string, dir: string) => {
        const written = await post('/fs/write', appToken, {
            fileMetadata: {
                path: `${dir}/index.html`,
                size: 6,
                contentType: 'text/html',
            },
            fileContent: 'hosted',
        });
        expect(written.status).toBe(200);
        const entry = (await env.server.stores.fsEntry.getEntryByPath(dir, {
            skipCache: true,
        }))!;
        const subdomain = `uninstall-${Math.random().toString(36).slice(2, 10)}`;
        await env.server.stores.subdomain.create({
            userId: entry.userId,
            subdomain,
            rootDirId: entry.id,
        });
        const port = new URL(env.origin).port;
        const serve = () =>
            fetch(
                `http://${subdomain}.site.puter.localhost:${port}/index.html`,
            );
        const served = await serve();
        expect(served.status).toBe(200);
        expect(await served.text()).toBe('hosted');
        return serve;
    };

    it.each([
        ['a folder inside it', '/www/public'],
        ['the folder itself', ''],
    ])('keeps AppData that hosts a site at %s', async (_case, sub) => {
        const { app, root, files } = await installWithFiles(2);
        const siteDir = `${root}${sub}`;
        if (sub) {
            const made = await post('/fs/mkdir', app.token, {
                path: siteDir,
                create_missing_parents: true,
            });
            expect(made.status).toBe(200);
        }
        const serve = await hostSite(app.token, siteDir);
        const warn = vi.spyOn(console, 'warn');

        expect((await uninstall(app.app_uid, true)).status).toBe(200);

        await vi.waitFor(() =>
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining(`kept uninstalled app data at ${root}`),
            ),
        );
        const served = await serve();
        expect(served.status).toBe(200);
        expect(await served.text()).toBe('hosted');
        for (const file of files) expect(await exists(file)).toBe(true);
    });

    it('keeps the folder without deleteData', async () => {
        const { app, root, files } = await installWithFiles(1);
        const checks = vi.spyOn(
            env.server.stores.fsEntry,
            'deleteEntries',
        );

        expect((await uninstall(app.app_uid, false)).status).toBe(200);

        expect(checks).not.toHaveBeenCalled();
        expect(await exists(root)).toBe(true);
        expect(await exists(files[0]!)).toBe(true);
    });

    it('stops once the user authorizes the app again', async () => {
        FSService.SUBTREE_PAGE_SIZE = 1;
        const { app, origin, root, files } = await installWithFiles(4);
        const { fsEntry, permission } = env.server.stores;

        // The app is opened again right after its first file is deleted.
        const deleteEntries = fsEntry.deleteEntries.bind(fsEntry);
        let reopened = false;
        vi.spyOn(fsEntry, 'deleteEntries').mockImplementation(
            async (entries) => {
                await deleteEntries(entries);
                if (!reopened) {
                    reopened = true;
                    await launch(origin);
                }
            },
        );
        const listGrants =
            permission.listUserAppPermsFromPrimary.bind(permission);
        let sawGrant = false;
        vi.spyOn(permission, 'listUserAppPermsFromPrimary').mockImplementation(
            async (userId, appId) => {
                const rows = await listGrants(userId, appId);
                if (rows.length > 0) sawGrant = true;
                return rows;
            },
        );

        expect((await uninstall(app.app_uid, true)).status).toBe(200);

        await vi.waitFor(() => expect(sawGrant).toBe(true));
        const left = (await Promise.all(files.map(exists))).filter(Boolean);
        expect(left).toHaveLength(files.length - 1);
        expect(await exists(root)).toBe(true);
    });
});
