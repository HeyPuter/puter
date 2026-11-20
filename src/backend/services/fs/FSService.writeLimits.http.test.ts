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

import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { FSService } from './FSService.js';

// Every route that streams straight onto a file's object: a body is held to
// its declared size, or to the owner's free storage when it declares none, so
// a refused write leaves the stored file and its recorded size as they were.
describe('direct writes past their declared size or the storage limit', () => {
    let env: PuterTestEnv;
    beforeAll(async () => {
        env = await setupPuterTestEnv({ is_storage_limited: true } as IConfig);
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const davAuth = (token: string) => ({
        authorization: `Basic ${Buffer.from(`-token:${token}`).toString('base64')}`,
    });
    const davOrigin = () => env.apiOrigin.replace('//api.', '//dav.');
    const post = (route: string, token: string, body: unknown) =>
        fetch(`${env.apiOrigin}${route}`, {
            method: 'POST',
            headers: { ...bearer(token), 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    const userIdOf = async (username: string) =>
        (await env.server.stores.user.getByUsername(username))!.id as number;
    const usage = async (userId: number) =>
        Number(
            (
                (await env.server.clients.db.read(
                    'SELECT COALESCE(SUM(size), 0) AS total FROM fsentries WHERE user_id = ?',
                    [userId],
                )) as Array<{ total: number }>
            )[0]!.total,
        );
    const leaveHeadroom = async (userId: number, bytes: number) => {
        await env.server.clients.db.write(
            'UPDATE user SET free_storage = ? WHERE id = ?',
            [(await usage(userId)) + bytes, userId],
        );
        await env.server.clients.redis.flushall();
    };
    const readBack = async (token: string, path: string) => {
        const res = await fetch(
            `${env.apiOrigin}/fs/read?${new URLSearchParams({ path })}`,
            { headers: bearer(token) },
        );
        expect(res.status).toBe(200);
        return res.text();
    };
    const statSize = async (token: string, path: string) =>
        ((await (await post('/fs/stat', token, { path })).json()) as {
            size: number;
        }).size;
    const seed = async (token: string, path: string, content = 'abc') => {
        const res = await post('/fs/write', token, {
            fileMetadata: {
                path,
                size: Buffer.byteLength(content),
                contentType: 'text/plain',
                overwrite: true,
            },
            fileContent: content,
        });
        expect(res.status).toBe(200);
    };
    const uploads = () =>
        vi.spyOn(env.server.stores.s3Object, 'uploadFromServer');
    const deletes = () => vi.spyOn(env.server.stores.s3Object, 'deleteObject');

    let token: string;
    let userId: number;
    let docs: string;
    beforeAll(async () => {
        token = env.users.user.token;
        userId = await userIdOf(env.users.user.username);
        docs = `/${env.users.user.username}/Documents`;
    });

    /** Asserts `path` still holds `abc`, recorded at 3 bytes, and usage held. */
    const expectUntouched = async (path: string, before: number) => {
        expect(await readBack(token, path)).toBe('abc');
        expect(await statSize(token, path)).toBe(3);
        expect(await usage(userId)).toBe(before);
    };

    it('/fs/write refuses an under-declared overwrite past the limit before uploading', async () => {
        const path = `${docs}/write.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);
        const before = await usage(userId);
        const upload = uploads();

        const res = await post('/fs/write', token, {
            fileMetadata: { path, size: 3, contentType: 'text/plain', overwrite: true },
            fileContent: 'Z'.repeat(200_000),
        });
        expect(res.status).toBe(413);
        expect(((await res.json()) as { code: string }).code).toBe(
            'storage_limit_reached',
        );
        expect(upload).not.toHaveBeenCalled();
        await expectUntouched(path, before);
    });

    it('/fs/write records the real size of an under-declared body that fits', async () => {
        const path = `${docs}/fits.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);

        const res = await post('/fs/write', token, {
            fileMetadata: { path, size: 3, contentType: 'text/plain', overwrite: true },
            fileContent: 'y'.repeat(500),
        });
        expect(res.status).toBe(200);
        expect(await statSize(token, path)).toBe(500);
    });

    it('/fs/batchWrite refuses an under-declared overwrite past the limit before uploading', async () => {
        const path = `${docs}/batch.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);
        const before = await usage(userId);
        const upload = uploads();

        const res = await post('/fs/batchWrite', token, [
            {
                fileMetadata: { path, size: 3, contentType: 'text/plain', overwrite: true },
                fileContent: 'X'.repeat(200_000),
            },
        ]);
        expect(res.status).toBe(413);
        expect(upload).not.toHaveBeenCalled();
        await expectUntouched(path, before);
    });

    it('multipart /fs/batchWrite holds a part that declares 0 to the free storage', async () => {
        const path = `${docs}/multipart.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);
        const before = await usage(userId);

        const form = new FormData();
        form.append(
            'manifest',
            JSON.stringify({
                items: [
                    {
                        fileMetadata: {
                            path,
                            size: 0,
                            contentType: 'text/plain',
                            overwrite: true,
                        },
                    },
                ],
            }),
        );
        form.append(
            'file',
            new Blob(['M'.repeat(300_000)], { type: 'text/plain' }),
            'multipart.txt',
        );
        const res = await fetch(`${env.apiOrigin}/fs/batchWrite`, {
            method: 'POST',
            headers: bearer(token),
            body: form,
        });
        expect(res.status).toBe(413);
        await expectUntouched(path, before);
    });

    it('multipart /fs/batchWrite refuses a part longer than its declared size', async () => {
        const path = `${docs}/multipart-declared.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 10 * 1024 * 1024);
        const before = await usage(userId);

        const form = new FormData();
        form.append(
            'manifest',
            JSON.stringify({
                items: [
                    {
                        fileMetadata: {
                            path,
                            size: 10,
                            contentType: 'text/plain',
                            overwrite: true,
                        },
                    },
                ],
            }),
        );
        form.append(
            'file',
            new Blob(['D'.repeat(300_000)], { type: 'text/plain' }),
            'multipart-declared.txt',
        );
        const res = await fetch(`${env.apiOrigin}/fs/batchWrite`, {
            method: 'POST',
            headers: bearer(token),
            body: form,
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { message: string }).message).toBe(
            'File content is longer than its declared size',
        );
        await expectUntouched(path, before);
    });

    it('a chunked WebDAV PUT, which declares 0, is held to the free storage', async () => {
        const path = `${docs}/dav.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);
        const before = await usage(userId);

        const chunk = new TextEncoder().encode('Y'.repeat(50_000));
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let i = 0; i < 4; i++) controller.enqueue(chunk);
                controller.close();
            },
        });
        const res = await fetch(`${davOrigin()}${path}`, {
            method: 'PUT',
            headers: { ...davAuth(token), 'content-type': 'text/plain' },
            body,
            duplex: 'half',
        } as RequestInit);
        expect(res.status).toBe(413);
        await expectUntouched(path, before);
    });

    it('a chunked WebDAV PUT that fits records its real size', async () => {
        const path = `${docs}/dav-fits.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);

        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('q'.repeat(400)));
                controller.enqueue(new TextEncoder().encode('q'.repeat(400)));
                controller.close();
            },
        });
        const res = await fetch(`${davOrigin()}${path}`, {
            method: 'PUT',
            headers: { ...davAuth(token), 'content-type': 'text/plain' },
            body,
            duplex: 'half',
        } as RequestInit);
        expect(res.status).toBeLessThan(300);
        expect(await statSize(token, path)).toBe(800);
        expect(await readBack(token, path)).toBe('q'.repeat(800));
    });

    it('a signed write URL, which declares 0, is held to the free storage', async () => {
        const path = `${docs}/signed.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 1000);
        const before = await usage(userId);

        const signRes = await post('/sign', token, {
            items: [{ path, action: 'write' }],
        });
        expect(signRes.status).toBe(200);
        const { signatures } = (await signRes.json()) as {
            signatures: Array<{ write_url: string }>;
        };
        const form = new FormData();
        form.append(
            'file',
            new Blob(['S'.repeat(300_000)], { type: 'text/plain' }),
            'signed.txt',
        );
        const res = await fetch(signatures[0]!.write_url, {
            method: 'POST',
            headers: bearer(token),
            body: form,
        });
        expect(res.status).toBe(413);
        await expectUntouched(path, before);
    });

    it("judges a write-share recipient's overwrite by the owner's free storage", async () => {
        const owner = env.users.other;
        const ownerId = await userIdOf(owner.username);
        const path = `/${owner.username}/Documents/shared.txt`;
        await seed(owner.token, path);
        const { uid } = (await (
            await post('/fs/stat', owner.token, { path })
        ).json()) as { uid: string };
        const share = await post('/share', owner.token, {
            recipients: [env.users.user.username],
            items: [{ uid }],
            mode: 'write',
        });
        expect(share.status).toBe(200);
        await leaveHeadroom(ownerId, 1000);
        const ownerBefore = await usage(ownerId);

        const res = await post('/fs/write', token, {
            fileMetadata: { path, size: 3, contentType: 'text/plain', overwrite: true },
            fileContent: 'W'.repeat(200_000),
        });
        expect(res.status).toBe(413);
        expect(await readBack(owner.token, path)).toBe('abc');
        expect(await statSize(owner.token, path)).toBe(3);
        expect(await usage(ownerId)).toBe(ownerBefore);
    });

    it('deletes the object of a new file whose write fails after the upload', async () => {
        const upload = uploads();
        const remove = deletes();
        const res = await post('/fs/write', token, {
            fileMetadata: {
                path: `${docs}/no-such-folder/x.txt`,
                size: 3,
                contentType: 'text/plain',
            },
            fileContent: 'abc',
        });
        expect(res.status).toBe(404);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls[0]![1]).toBe(
            upload.mock.calls[0]![0].objectKey,
        );
    });

    it('refuses a stream whose bytes past its declared size arrive on their own', async () => {
        const path = `${docs}/exact-then-more.txt`;
        await seed(token, path);
        await leaveHeadroom(userId, 10 * 1024 * 1024);
        const before = await usage(userId);
        const fs = env.server.services.fs as unknown as FSService;

        const error = await fs
            .write(userId, {
                fileMetadata: {
                    path,
                    size: 3,
                    contentType: 'text/plain',
                    overwrite: true,
                },
                fileContent: Readable.from([
                    Buffer.from('xyz'),
                    Buffer.from('more'),
                ]),
            })
            .then(
                () => null,
                (e: unknown) => e as { statusCode?: number },
            );
        expect(error?.statusCode).toBe(400);
        await expectUntouched(path, before);
    });
});
