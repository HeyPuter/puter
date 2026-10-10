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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
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
    const written = () => {
        const write = vi.spyOn(server.services.fs, 'write');
        write.mockResolvedValueOnce(undefined as never);
        return write;
    };

    it('writes the bytes of a data URI with its declared type', async () => {
        const write = written();
        await saveGeneratedMediaToFS(
            server.services.fs,
            actor,
            `data:image/webp;base64,${Buffer.from('img').toString('base64')}`,
            '/alice/a.webp',
            { noun: 'image', defaultType: 'application/octet-stream' },
        );
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
