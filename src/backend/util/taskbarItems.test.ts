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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../server.ts';
import { setupTestServer } from '../testUtil.ts';
import { getTaskbarItems } from './taskbarItems.ts';

describe('getTaskbarItems', () => {
    let server: PuterServer;
    let deps: Parameters<typeof getTaskbarItems>[1];

    beforeAll(async () => {
        server = await setupTestServer();
        deps = {
            clients: server.clients,
            stores: server.stores,
            apiBaseUrl: 'https://api.puter.com',
        } as unknown as Parameters<typeof getTaskbarItems>[1];
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async (taskbarItems?: unknown) => {
        const username = `tb-${Math.random().toString(36).slice(2, 10)}`;
        const created = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        } as never);
        if (taskbarItems !== undefined) {
            await server.stores.user.update(created.id, {
                taskbar_items:
                    typeof taskbarItems === 'string'
                        ? taskbarItems
                        : JSON.stringify(taskbarItems),
            });
        }
        return (await server.stores.user.getById(created.id))!;
    };

    const makeApp = async (ownerUserId: number, overrides = {}) => {
        const name = `tb-app-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.app.create(
            {
                name,
                title: `Title ${name}`,
                index_url: `https://${name}.example.com/`,
                description: 'a test app',
                ...overrides,
            },
            { ownerUserId },
        );
    };

    it('seeds the default taskbar for a user that has none, and persists it', async () => {
        const user = await makeUser();
        expect(user.taskbar_items).toBeFalsy();

        await getTaskbarItems(user as never, deps);

        const [row] = await server.clients.db.read(
            'SELECT `taskbar_items` FROM `user` WHERE `id` = ?',
            [user.id],
        );
        const stored = JSON.parse(String(row.taskbar_items));
        expect(stored.map((e: { name: string }) => e.name)).toContain(
            'app-center',
        );
        // The cached row must not keep serving the pre-seed value.
        expect(
            (await server.stores.user.getById(user.id))?.taskbar_items,
        ).toBeTruthy();
    });

    it('resolves entries by name, uid and id', async () => {
        const owner = await makeUser([]);
        const byName = await makeApp(owner.id);
        const byUid = await makeApp(owner.id);
        const byId = await makeApp(owner.id);

        const user = await makeUser([
            { name: byName.name, type: 'app' },
            { uid: byUid.uid, type: 'app' },
            { id: byId.id, type: 'app' },
        ]);

        const items = await getTaskbarItems(user as never, deps);
        expect(items.map((i) => i.uid)).toEqual([
            byName.uid,
            byUid.uid,
            byId.uid,
        ]);
        expect(items[0]).toMatchObject({
            uuid: byName.uid,
            name: byName.name,
            title: byName.title,
            godmode: false,
            maximize_on_start: false,
            description: 'a test app',
        });
    });

    it('skips non-app entries, the explorer pin, and unresolvable apps', async () => {
        const owner = await makeUser([]);
        const app = await makeApp(owner.id);
        const user = await makeUser([
            { name: 'explorer', type: 'app' },
            { name: 'nothing-here', type: 'app' },
            { name: app.name, type: 'separator' },
            { type: 'app' },
            { name: app.name, type: 'app' },
        ]);

        const items = await getTaskbarItems(user as never, deps);
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe(app.name);
    });

    it('falls back to an empty taskbar when the stored JSON is corrupt', async () => {
        const user = await makeUser('{not json');
        expect(await getTaskbarItems(user as never, deps)).toEqual([]);
    });

    it('accepts an already-parsed taskbar array on the user row', async () => {
        const owner = await makeUser([]);
        const app = await makeApp(owner.id);
        const user = await makeUser([]);

        const items = await getTaskbarItems(
            { ...user, taskbar_items: [{ name: app.name, type: 'app' }] },
            deps,
        );
        expect(items.map((i) => i.name)).toEqual([app.name]);
    });

    it('builds a sized icon URL by default and drops the icon on request', async () => {
        const owner = await makeUser([]);
        const app = await makeApp(owner.id);
        const user = await makeUser([{ name: app.name, type: 'app' }]);

        const withIcon = await getTaskbarItems(user as never, deps, {
            iconSize: 64,
        });
        expect(withIcon[0].icon).toBe(
            `https://api.puter.com/app-icon/${app.uid}/64`,
        );

        const withoutIcon = await getTaskbarItems(user as never, deps, {
            noIcons: true,
        });
        expect('icon' in withoutIcon[0]).toBe(false);
    });

    it('falls back to the raw icon column when no API base URL is configured', async () => {
        const owner = await makeUser([]);
        const app = await makeApp(owner.id, {
            icon: 'https://cdn.example.com/i.png',
        });
        const user = await makeUser([{ name: app.name, type: 'app' }]);

        const items = await getTaskbarItems(
            user as never,
            {
                ...deps,
                apiBaseUrl: undefined,
            } as never,
        );
        expect(items[0].icon).toBe('https://cdn.example.com/i.png');
    });

    it('reports null for an app with no icon and no API base URL', async () => {
        const owner = await makeUser([]);
        const app = await makeApp(owner.id);
        const user = await makeUser([{ name: app.name, type: 'app' }]);

        const items = await getTaskbarItems(
            user as never,
            {
                ...deps,
                apiBaseUrl: undefined,
            } as never,
        );
        expect(items[0].icon).toBeNull();
    });
});
