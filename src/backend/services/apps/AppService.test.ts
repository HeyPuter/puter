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

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const suffix = () => Math.random().toString(36).slice(2, 10);

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `apps-${suffix()}`;
    const user = await server.stores.user.create({
        username,
        uuid: randomUUID(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 1024,
        requires_email_confirmation: false,
    });
    return { actor: makeActor({ user }), userId: user.id };
};

const insertApp = async (
    ownerUserId: number,
    {
        isPrivate = false,
        isProtected = false,
        indexUrl = `https://${suffix()}.example.test/`,
    } = {},
): Promise<Record<string, unknown>> => {
    const uid = `app-${randomUUID()}`;
    await server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`, `is_private`, `protected`) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            uid,
            `svc-${suffix()}`,
            't',
            indexUrl,
            ownerUserId,
            isPrivate ? 1 : 0,
            isProtected ? 1 : 0,
        ],
    );
    return (await server.stores.app.getByUid(uid))!;
};

describe('AppService.filterReadable', () => {
    it('keeps unprotected and owned apps and drops protected ones without a grant', async () => {
        const viewer = await makeUser();
        const other = await makeUser();
        const open = await insertApp(other.userId);
        const own = await insertApp(viewer.userId, { isProtected: true });
        const guarded = await insertApp(other.userId, { isProtected: true });

        const readable = await server.services.app.filterReadable(
            [open, own, guarded],
            viewer.actor,
        );

        expect(readable.map((app) => app.uid)).toEqual([open.uid, own.uid]);
    });

    it('lets an app read itself even when protected', async () => {
        const viewer = await makeUser();
        const other = await makeUser();
        const guarded = await insertApp(other.userId, { isProtected: true });
        const asApp = makeActor({
            user: viewer.actor.user,
            app: { id: guarded.id as number, uid: guarded.uid as string },
        });

        const readable = await server.services.app.filterReadable(
            [guarded],
            asApp,
        );

        expect(readable).toHaveLength(1);
    });

    it('checks every protected app in one batched permission call', async () => {
        const viewer = await makeUser();
        const other = await makeUser();
        const guarded = await Promise.all(
            [0, 1, 2].map(() => insertApp(other.userId, { isProtected: true })),
        );
        const checkMany = vi.spyOn(server.services.permission, 'checkMany');
        const check = vi.spyOn(server.services.permission, 'check');
        try {
            await server.services.app.filterReadable(guarded, viewer.actor);
            expect(checkMany).toHaveBeenCalledTimes(1);
            expect(checkMany.mock.calls[0]![1]).toHaveLength(3);
            // Misses inside `checkMany` fall through to `check`; nothing else
            // reaches it directly.
            expect(check.mock.calls.length).toBeLessThanOrEqual(3);
        } finally {
            checkMany.mockRestore();
            check.mockRestore();
        }
    });
});

describe('AppService.views', () => {
    it('returns views aligned with the input and resolves the origin once per list', async () => {
        const { actor, userId } = await makeUser();
        const apps = await Promise.all(
            [0, 1, 2, 3].map(() => insertApp(userId)),
        );
        const origins = vi.spyOn(server.services.auth, 'appUidsFromOrigins');
        const filetypes = vi.spyOn(
            server.stores.app,
            'getFiletypeAssociationsByIds',
        );
        try {
            const views = await server.services.app.views(apps, actor);

            expect(views.map(({ view }) => view.uid)).toEqual(
                apps.map((app) => app.uid),
            );
            expect(origins).toHaveBeenCalledTimes(1);
            expect(filetypes).toHaveBeenCalledTimes(1);
            // Each row is its own origin's oldest app.
            for (const [i, { createdFromOrigin }] of views.entries()) {
                expect(createdFromOrigin).toBe(
                    new URL(apps[i]!.index_url as string).origin,
                );
            }
        } finally {
            origins.mockRestore();
            filetypes.mockRestore();
        }
    });

    it('gates a private app for non-owners and passes its owner without asking', async () => {
        const owner = await makeUser();
        const viewer = await makeUser();
        const app = await insertApp(owner.userId, { isPrivate: true });
        const emit = vi.spyOn(server.clients.event, 'emitAndWait');
        try {
            const [forOwner] = await server.services.app.views(
                [app],
                owner.actor,
            );
            const resolveCalls = () =>
                emit.mock.calls.filter(
                    (call) => call[0] === 'app.privateAccess.resolveLaunch',
                ).length;
            expect(forOwner!.view.index_url).toBe(app.index_url);
            expect(forOwner!.view.privateAccess?.checkedBy).toBe(
                'core/app-owner',
            );
            expect(resolveCalls()).toBe(0);

            const [forViewer] = await server.services.app.views(
                [app],
                viewer.actor,
                { source: 'test' },
            );
            expect(forViewer!.view).not.toHaveProperty('index_url');
            expect(forViewer!.view.privateAccess?.hasAccess).toBe(false);
            expect(resolveCalls()).toBe(1);
        } finally {
            emit.mockRestore();
        }
    });

    it('uses supplied filetypes instead of reading them', async () => {
        const { actor, userId } = await makeUser();
        const app = await insertApp(userId);
        const filetypes = vi.spyOn(
            server.stores.app,
            'getFiletypeAssociationsByIds',
        );
        try {
            const [result] = await server.services.app.views([app], actor, {
                filetypesByAppId: new Map([[app.id, ['md']]]),
            });
            expect(result!.view.filetype_associations).toEqual(['md']);
            expect(filetypes).not.toHaveBeenCalled();
        } finally {
            filetypes.mockRestore();
        }
    });
});
