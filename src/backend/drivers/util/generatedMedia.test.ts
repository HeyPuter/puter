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
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { resolveOutputPath, saveGeneratedMediaToFS } from './generatedMedia.js';

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));
vi.mock('../../util/secureHttp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util/secureHttp.js')>()),
    secureFetch: secureFetchMock,
}));

let server: PuterServer;
beforeAll(async () => {
    server = await setupTestServer();
});
afterAll(async () => {
    await server?.shutdown();
});

const actor = {
    user: { id: 42, uuid: 'u42', username: 'alice' },
} as unknown as Actor;

describe('resolveOutputPath', () => {
    it('expands ~ and normalizes the path once the parent is writable', async () => {
        const check = vi.spyOn(server.services.acl, 'check');
        check.mockResolvedValueOnce(true);
        expect(
            await resolveOutputPath(server.services, actor, ' ~/art/cat.png/ '),
        ).toBe('/alice/art/cat.png');
        expect(check.mock.calls[0]![1]).toMatchObject({ path: '/alice/art' });
        check.mockRestore();
    });

    it.each(['/', '/cat.png'])(
        'refuses %s, which writes into the root',
        async (path) => {
            await expect(
                resolveOutputPath(server.services, actor, path),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'cannot_write_to_root',
            });
        },
    );

    it('refuses a path that is not normalized', async () => {
        await expect(
            resolveOutputPath(server.services, actor, '/alice/../bob/x.png'),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses an actor without a user, and a parent it cannot write', async () => {
        await expect(
            resolveOutputPath(server.services, {} as Actor, '/a/b.png'),
        ).rejects.toMatchObject({ statusCode: 400 });

        const check = vi.spyOn(server.services.acl, 'check');
        check.mockResolvedValueOnce(false);
        await expect(
            resolveOutputPath(server.services, actor, '/bob/b.png'),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'access_denied',
        });
        check.mockRestore();
    });
});

describe('saveGeneratedMediaToFS', () => {
    beforeEach(() => {
        vi.spyOn(server.services.acl, 'check').mockResolvedValue(true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const written = () => {
        const write = vi.spyOn(server.services.fs, 'write');
        write.mockResolvedValueOnce(undefined as never);
        return write;
    };

    it('re-checks write on the parent and skips the write once access is gone', async () => {
        const check = vi.mocked(server.services.acl.check);
        check.mockResolvedValue(false);
        const write = vi.spyOn(server.services.fs, 'write');
        expect(
            await saveGeneratedMediaToFS(
                server.services.fs,
                actor,
                `data:image/png;base64,${Buffer.from('img').toString('base64')}`,
                '/bob/shared/a.png',
                { noun: 'image', defaultType: 'application/octet-stream' },
            ),
        ).toBe(false);
        expect(check.mock.calls[0]![1]).toMatchObject({ path: '/bob/shared' });
        expect(check.mock.calls[0]![2]).toBe('write');
        expect(write).not.toHaveBeenCalled();
    });

    it('surfaces an access check that fails for another reason', async () => {
        vi.mocked(server.services.acl.check).mockRejectedValue(
            new Error('db down'),
        );
        const write = vi.spyOn(server.services.fs, 'write');
        await expect(
            saveGeneratedMediaToFS(
                server.services.fs,
                actor,
                `data:image/png;base64,${Buffer.from('img').toString('base64')}`,
                '/alice/a.png',
                { noun: 'image', defaultType: 'application/octet-stream' },
            ),
        ).rejects.toThrow('db down');
        expect(write).not.toHaveBeenCalled();
    });

    it('writes the bytes of a data URI with its declared type', async () => {
        const write = written();
        await expect(
            saveGeneratedMediaToFS(
                server.services.fs,
                actor,
                `data:image/webp;base64,${Buffer.from('img').toString('base64')}`,
                '/alice/a.webp',
                { noun: 'image', defaultType: 'application/octet-stream' },
            ),
        ).resolves.toBe(true);
        expect(write.mock.calls[0]![1].fileMetadata).toMatchObject({
            path: '/alice/a.webp',
            size: 3,
            contentType: 'image/webp',
        });
        write.mockRestore();
    });

    it('downloads a provider URL, falling back to the default type', async () => {
        const write = written();
        secureFetchMock.mockResolvedValueOnce(new Response('mp4-bytes'));
        await saveGeneratedMediaToFS(
            server.services.fs,
            actor,
            'https://cdn.example/clip.mp4',
            '/alice/clip.mp4',
            { noun: 'video', defaultType: 'video/mp4' },
        );
        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://cdn.example/clip.mp4',
            { skipProxy: true },
        );
        expect(write.mock.calls[0]![1].fileMetadata).toMatchObject({
            size: 9,
            contentType: 'text/plain;charset=UTF-8',
        });
        write.mockRestore();
    });

    it('surfaces a failed download as a 502 and writes nothing', async () => {
        const write = vi.spyOn(server.services.fs, 'write');
        secureFetchMock.mockResolvedValueOnce(
            new Response(null, { status: 404 }),
        );
        await expect(
            saveGeneratedMediaToFS(
                server.services.fs,
                actor,
                'https://cdn.example/gone.mp4',
                '/alice/gone.mp4',
                { noun: 'video', defaultType: 'video/mp4' },
            ),
        ).rejects.toMatchObject({
            statusCode: 502,
            message: 'Failed to fetch generated video for FS write: 404',
        });
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
    });

    it('refuses a result that is not a URL or data URI', async () => {
        await expect(
            saveGeneratedMediaToFS(
                server.services.fs,
                actor,
                { stream: null },
                '/alice/x.mp4',
                { noun: 'video', defaultType: 'video/mp4' },
            ),
        ).rejects.toMatchObject({ statusCode: 500 });
    });
});

describe('saveGeneratedMediaToFS into a shared folder', () => {
    const makeUser = async (): Promise<Actor> => {
        const username = `gm-${Math.random().toString(36).slice(2, 10)}`;
        const created = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });
        await generateDefaultFsentries(
            server.clients.db,
            server.stores.user,
            created,
        );
        const u = (await server.stores.user.getById(created.id))!;
        return {
            user: {
                id: u.id,
                uuid: u.uuid,
                username: u.username,
                email: u.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        };
    };
    const png = (text: string) =>
        `data:image/png;base64,${Buffer.from(text).toString('base64')}`;
    const media = { noun: 'image', defaultType: 'image/png' } as const;

    it('writes for a recipient with write, and not after the share is revoked', async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const folder = `/${owner.user!.username}/Documents`;
        const target = `${folder}/portrait.png`;
        const folderEntry = await server.stores.fsEntry.getEntryByPath(folder);
        const perm = `fs:${folderEntry!.uuid}:write`;
        await server.services.permission.grantUserUserPermission(
            owner,
            recipient.user!.username!,
            perm,
            {},
        );

        const resolved = await resolveOutputPath(
            server.services,
            recipient,
            target,
        );
        expect(
            await saveGeneratedMediaToFS(
                server.services.fs,
                recipient,
                png('first'),
                resolved,
                media,
            ),
        ).toBe(true);
        const first = await server.stores.fsEntry.getEntryByPath(target);
        expect(first!.size).toBe(5);

        // Revoked while a second job ran.
        await server.services.permission.revokeUserUserPermission(
            owner,
            recipient.user!.username!,
            perm,
        );
        expect(
            await saveGeneratedMediaToFS(
                server.services.fs,
                recipient,
                png('after-revoke'),
                resolved,
                media,
            ),
        ).toBe(false);
        const after = await server.stores.fsEntry.getEntryByPath(target);
        expect(after!.uuid).toBe(first!.uuid);
        expect(after!.size).toBe(5);
    });
});
