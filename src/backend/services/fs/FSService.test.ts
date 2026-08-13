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
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { appDataPermission } from '../permission/appDataScopes.js';
import { PuterServer } from '../../server.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { toPendingUploadSessionKey } from '../../stores/fs/pendingUploadSessionHelpers.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSService } from './FSService.js';
import { UNLIMITED_STORAGE_ALLOWANCE } from './FSService.js';

// ── Harness ─────────────────────────────────────────────────────────
//
// One real PuterServer (in-memory sqlite + in-memory S3 + mock redis).
// Tests drive the live FSService against real stores, so path resolution,
// S3 round trips, quota accounting and cache invalidation are all exercised
// for real. Only the S3 client is stubbed, and only where a specific
// upstream failure has to be forced.

let server: PuterServer;
let fs: FSService;

beforeAll(async () => {
    server = await setupTestServer();
    fs = server.services.fs as unknown as FSService;
});

afterAll(async () => {
    await server?.shutdown();
});

interface TestUser {
    userId: number;
    username: string;
    uuid: string;
    home: string;
    actor: Actor;
}

const makeUser = async (
    over: { free_storage?: number } = {},
): Promise<TestUser> => {
    const username = `fss-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: over.free_storage ?? 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        username: refreshed.username,
        uuid: refreshed.uuid,
        home: `/${refreshed.username}`,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

const writeFile = async (
    user: TestUser,
    path: string,
    content: string,
    extra: Record<string, unknown> = {},
): Promise<FSEntry> => {
    const result = await fs.write(user.userId, {
        fileMetadata: {
            path,
            size: Buffer.byteLength(content),
            contentType: 'text/plain',
            ...extra,
        },
        fileContent: content,
    });
    return result.fsEntry;
};

const readBack = async (entry: FSEntry, range?: string): Promise<string> => {
    const result = await fs.readContent(entry, range ? { range } : {});
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
};

const caught = async (run: () => Promise<unknown>): Promise<HttpError> => {
    const error = await run().then(
        () => null,
        (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
};

/**
 * Back-date a live upload session's `expiresAt` while leaving its storage TTL
 * in the future. A session normally shares one value for both, so simply
 * waiting it out would make it unreadable and the service would report a plain
 * "not found" instead of reaching its expiry handling.
 */
const expirePendingSession = async (sessionId: string): Promise<void> => {
    const key = toPendingUploadSessionKey(sessionId);
    const { res: stored } = await server.stores.kv.get({ key });
    await server.stores.kv.batchPut({
        items: [
            {
                key,
                value: {
                    ...(stored as Record<string, unknown>),
                    expiresAt: Date.now() - 1000,
                },
                expireAt: Math.ceil((Date.now() + 60 * 60 * 1000) / 1000),
            },
        ],
    });
};

const entryAt = (user: TestUser, path: string) =>
    server.stores.fsEntry.getEntryByPath(`${user.home}${path}`, {
        useTryHardRead: true,
        skipCache: true,
    });

describe('FSService write input validation', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it.each([
        ['an empty path', '   ', 'Path cannot be empty'],
        ['a bare tilde', '~', 'Home path must be resolved before write'],
        ['a tilde path', '~/a.txt', 'Home path must be resolved before write'],
        ['parent traversal', '/a/../b.txt', 'Invalid path'],
        ['a double slash', '/a//b.txt', 'Invalid path'],
    ])('rejects %s', async (_label, path, message) => {
        const error = await caught(() => writeFile(user, path, 'x'));
        expect(error.statusCode).toBe(400);
        expect(error.legacyCode).toBe('bad_request');
        expect(error.message).toBe(message);
    });

    it('refuses to write to the root path', async () => {
        const error = await caught(() => writeFile(user, '/', 'x'));
        expect(error.statusCode).toBe(400);
        expect(error.legacyCode).toBe('cannot_write_to_root');
    });

    it('rejects a negative or unparseable size', async () => {
        for (const size of [-1, Number.NaN, 'abc']) {
            const error = await caught(() =>
                fs.write(user.userId, {
                    fileMetadata: {
                        path: `${user.home}/Documents/sized.txt`,
                        size: size as number,
                    },
                    fileContent: 'x',
                }),
            );
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe('Invalid file size');
        }
    });

    it('normalizes a trailing slash and a missing leading slash', async () => {
        const trailing = await writeFile(
            user,
            `${user.home}/Documents/trailing/`,
            'a',
        );
        expect(trailing.path).toBe(`${user.home}/Documents/trailing`);

        const relative = await writeFile(
            user,
            `${user.username}/Documents/relative.txt`,
            'b',
        );
        expect(relative.path).toBe(`${user.home}/Documents/relative.txt`);
    });

    it('strips the reserved objectKey key from object and JSON-string metadata', async () => {
        const fromObject = await writeFile(
            user,
            `${user.home}/Documents/meta-object.txt`,
            'a',
            { metadata: { objectKey: 'attacker-key', keep: 1 } },
        );
        expect(JSON.parse(fromObject.metadata!)).toEqual({
            keep: 1,
            contentType: 'text/plain',
        });

        const fromJson = await writeFile(
            user,
            `${user.home}/Documents/meta-json.txt`,
            'a',
            { metadata: JSON.stringify({ objectKey: 'nope', keep: 2 }) },
        );
        expect(JSON.parse(fromJson.metadata!)).toEqual({ keep: 2 });
    });

    it('passes through metadata shapes that are not key/value objects', async () => {
        const notJson = await writeFile(
            user,
            `${user.home}/Documents/meta-plain.txt`,
            'a',
            { metadata: 'not json at all' },
        );
        expect(notJson.metadata).toBe('not json at all');

        const jsonArray = await writeFile(
            user,
            `${user.home}/Documents/meta-array.txt`,
            'a',
            { metadata: '[1,2,3]' },
        );
        expect(jsonArray.metadata).toBe('[1,2,3]');

        // A null client metadata contributes nothing of its own.
        const nullMeta = await writeFile(
            user,
            `${user.home}/Documents/meta-null.txt`,
            'a',
            { metadata: null },
        );
        expect(JSON.parse(nullMeta.metadata!)).toEqual({
            contentType: 'text/plain',
        });
    });

    it('accepts the legacy snake_case dedupe_name alias', async () => {
        await writeFile(user, `${user.home}/Documents/alias.txt`, 'a');
        const deduped = await writeFile(
            user,
            `${user.home}/Documents/alias.txt`,
            'b',
            { dedupe_name: true },
        );
        expect(deduped.path).toBe(`${user.home}/Documents/alias (1).txt`);
    });
});

describe('FSService write payload handling', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    const write = (
        name: string,
        fileContent: unknown,
        encoding?: string,
    ): Promise<FSEntry> =>
        fs
            .write(user.userId, {
                fileMetadata: {
                    path: `${user.home}/Documents/${name}`,
                    size: 0,
                    contentType: 'application/octet-stream',
                },
                fileContent: fileContent as Parameters<
                    FSService['write']
                >[1]['fileContent'],
                ...(encoding
                    ? {
                          encoding: encoding as Parameters<
                              FSService['write']
                          >[1]['encoding'],
                      }
                    : {}),
            })
            .then((result) => result.fsEntry);

    it('accepts a Buffer body and records its byte length', async () => {
        const entry = await write('buffer.bin', Buffer.from('buffered'));
        expect(entry.size).toBe(8);
        expect(await readBack(entry)).toBe('buffered');
    });

    it('accepts a base64 payload object', async () => {
        const entry = await write('payload.bin', {
            base64: Buffer.from('payload').toString('base64'),
        });
        expect(entry.size).toBe(7);
        expect(await readBack(entry)).toBe('payload');
    });

    it('decodes a base64 string when the encoding says so', async () => {
        const entry = await write(
            'b64.bin',
            Buffer.from('decoded').toString('base64'),
            'base64',
        );
        expect(await readBack(entry)).toBe('decoded');
    });

    it('honours a non-default string encoding', async () => {
        const entry = await write('hex.bin', '68656c6c6f', 'hex');
        expect(await readBack(entry)).toBe('hello');
    });

    it('accepts a Uint8Array and an ArrayBuffer', async () => {
        const bytes = new TextEncoder().encode('typed');
        expect(await readBack(await write('typed.bin', bytes))).toBe('typed');

        const arrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        );
        expect(await readBack(await write('ab.bin', arrayBuffer))).toBe(
            'typed',
        );
    });

    it('streams a Node readable and reports the streamed size and hash', async () => {
        const tracker = {
            total: 0,
            progress: 0,
            setTotal: vi.fn(),
            add: 0,
        } as unknown as {
            total: number;
            progress: number;
            setTotal: (total: number) => void;
            add: (amount: number) => void;
        };
        let added = 0;
        tracker.add = (amount: number) => {
            added += amount;
            tracker.progress = added;
        };

        const result = await fs.write(
            user.userId,
            {
                fileMetadata: {
                    path: `${user.home}/Documents/stream.bin`,
                    size: 0,
                    contentType: 'text/plain',
                },
                fileContent: Readable.from(['abc', 'defg']),
            },
            tracker,
        );

        expect(result.fsEntry.size).toBe(7);
        expect(added).toBe(7);
        // sha256('abcdefg')
        expect(result.contentHashSha256).toBe(
            '7d1a54127b222502f5b79b5fb0803061152a44f92b37e23c6527baf665d4da9a',
        );
        expect(await readBack(result.fsEntry)).toBe('abcdefg');
    });

    it('accepts a web ReadableStream', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('web '));
                controller.enqueue(new TextEncoder().encode('stream'));
                controller.close();
            },
        });
        const entry = await write('web.bin', stream);
        expect(entry.size).toBe(10);
        expect(await readBack(entry)).toBe('web stream');
    });

    it('accepts a Blob', async () => {
        const entry = await write('blob.bin', new Blob(['blobbed']));
        expect(entry.size).toBe(7);
        expect(await readBack(entry)).toBe('blobbed');
    });

    it('rejects a payload shape it cannot upload', async () => {
        const error = await caught(() => write('bad.bin', 12345));
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Unsupported file content payload');
    });

    it('fails only the request when the source aborts mid-stream', async () => {
        // A client disconnecting mid-upload destroys the source. The byte
        // counter sitting between it and the upload must not turn that into an
        // unhandled 'error' event, which would end the whole process.
        const uncaught: unknown[] = [];
        const onUncaught = (error: unknown) => uncaught.push(error);
        process.on('uncaughtException', onUncaught);

        const source = new Readable({
            read() {
                this.push('partial');
                this.destroy(
                    Object.assign(new Error('aborted'), {
                        code: 'ECONNRESET',
                    }),
                );
            },
        });

        try {
            const outcome = await write('aborted.bin', source).then(
                () => null,
                (error: unknown) => error,
            );
            expect(outcome).toBeInstanceOf(Error);
            // Drain the microtask and nextTick queues so a stray 'error'
            // event has somewhere to land before the assertion below.
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            process.off('uncaughtException', onUncaught);
        }

        expect(uncaught).toEqual([]);
        // Generous timeout: the object-store client retries the torn-off body
        // before giving up, which puts the rejection just past the default.
    }, 20_000);
});

describe('FSService overwrite and dedupe resolution', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('refuses an unrequested overwrite with the wire code the GUI keys on', async () => {
        await writeFile(user, `${user.home}/Documents/dup.txt`, 'first');
        const error = await caught(() =>
            writeFile(user, `${user.home}/Documents/dup.txt`, 'second'),
        );
        expect(error.statusCode).toBe(409);
        expect(error.legacyCode).toBe('item_with_same_name_exists');
        expect(error.fields).toEqual({ entry_name: 'dup.txt' });
    });

    it('reuses the same object key and row on an explicit overwrite', async () => {
        const first = await writeFile(
            user,
            `${user.home}/Documents/over.txt`,
            'aaa',
        );
        const second = await writeFile(
            user,
            `${user.home}/Documents/over.txt`,
            'bbbbb',
            { overwrite: true },
        );

        expect(second.uuid).toBe(first.uuid);
        expect(second.size).toBe(5);
        expect(await readBack(second)).toBe('bbbbb');
    });

    it('dedupes into an unused " (n)" name, skipping names already taken', async () => {
        await writeFile(user, `${user.home}/Documents/d.txt`, 'a');
        await writeFile(user, `${user.home}/Documents/d (1).txt`, 'a');

        const deduped = await writeFile(
            user,
            `${user.home}/Documents/d.txt`,
            'b',
            { dedupeName: true },
        );
        expect(deduped.path).toBe(`${user.home}/Documents/d (2).txt`);
    });

    it('refuses to overwrite a directory with a file', async () => {
        await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/adir`,
        });
        const error = await caught(() =>
            writeFile(user, `${user.home}/Documents/adir`, 'x', {
                overwrite: true,
            }),
        );
        expect(error.statusCode).toBe(409);
        expect(error.legacyCode).toBe('cannot_overwrite_a_directory');
    });

    it('creates missing parents only when asked', async () => {
        const missing = await caught(() =>
            writeFile(user, `${user.home}/Documents/nope/deep/a.txt`, 'x'),
        );
        expect(missing.statusCode).toBe(404);

        const created = await writeFile(
            user,
            `${user.home}/Documents/made/deep/a.txt`,
            'x',
            { createMissingParents: true },
        );
        expect(created.path).toBe(`${user.home}/Documents/made/deep/a.txt`);
        expect((await entryAt(user, '/Documents/made/deep'))?.isDir).toBe(true);
    });
});

describe('FSService storage allowance', () => {
    let limitedServer: PuterServer;
    let limitedFs: FSService;

    beforeAll(async () => {
        limitedServer = await setupTestServer({
            is_storage_limited: true,
        } as never);
        limitedFs = limitedServer.services.fs as unknown as FSService;
    });

    afterAll(async () => {
        await limitedServer?.shutdown();
    });

    // A fresh account per test: the allowance is SUM(size) over the user's
    // own entries, so sharing one would couple the cases together.
    const quotaUser = async (freeStorage: number) => {
        const username = `fsq-${Math.random().toString(36).slice(2, 10)}`;
        const created = await limitedServer.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: freeStorage,
            requires_email_confirmation: false,
        });
        await generateDefaultFsentries(
            limitedServer.clients.db,
            limitedServer.stores.user,
            created,
        );
        const home = `/${username}`;
        return {
            userId: created.id,
            home,
            write: (name: string, body: string, max?: number) =>
                limitedFs.write(
                    created.id,
                    {
                        fileMetadata: {
                            path: `${home}/Documents/${name}`,
                            size: Buffer.byteLength(body),
                        },
                        fileContent: body,
                    },
                    undefined,
                    max,
                ),
        };
    };

    it('reports the user allowance and rejects an unparseable user id', async () => {
        const user = await quotaUser(64);

        await expect(
            limitedFs.getUsersStorageAllowance(user.userId),
        ).resolves.toEqual({ curr: 0, max: 64 });
        await expect(
            limitedFs.getUsersStorageAllowance(String(user.userId)),
        ).resolves.toEqual({ curr: 0, max: 64 });

        await user.write('used.txt', 'x'.repeat(20));
        await expect(
            limitedFs.getUsersStorageAllowance(user.userId),
        ).resolves.toEqual({ curr: 20, max: 64 });

        const error = await caught(() =>
            limitedFs.getUsersStorageAllowance('not-a-number'),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Invalid user id');
    });

    it('rejects a write that would exceed the allowance', async () => {
        const user = await quotaUser(64);
        const error = await caught(() =>
            user.write('too-big.txt', 'x'.repeat(65)),
        );
        expect(error.statusCode).toBe(413);
        expect(error.legacyCode).toBe('storage_limit_reached');
    });

    it('lets a per-request override raise the ceiling', async () => {
        const user = await quotaUser(64);
        await expect(
            user.write('raised.txt', 'x'.repeat(65), 1024),
        ).resolves.toMatchObject({ wasOverwrite: false });
    });

    it('writes past a full account when the caller waives the quota', async () => {
        const user = await quotaUser(64);
        await user.write('fills-it.txt', 'x'.repeat(64));
        await expect(user.write('over.txt', 'x')).rejects.toMatchObject({
            statusCode: 413,
        });

        await expect(
            user.write(
                'system.png',
                'x'.repeat(80),
                UNLIMITED_STORAGE_ALLOWANCE,
            ),
        ).resolves.toMatchObject({ wasOverwrite: false });
    });

    it('waives the quota for a batch too', async () => {
        const user = await quotaUser(64);
        await user.write('fills-it.txt', 'x'.repeat(64));

        await expect(
            limitedFs.batchWrites(
                user.userId,
                [
                    {
                        fileMetadata: {
                            path: `${user.home}/Documents/sys1.txt`,
                            size: 40,
                        },
                        fileContent: 'x'.repeat(40),
                    },
                    {
                        fileMetadata: {
                            path: `${user.home}/Documents/sys2.txt`,
                            size: 40,
                        },
                        fileContent: 'x'.repeat(40),
                    },
                ],
                UNLIMITED_STORAGE_ALLOWANCE,
            ),
        ).resolves.toHaveLength(2);
    });

    it('never lets an override lower the ceiling', async () => {
        const user = await quotaUser(64);
        await expect(
            user.write('within.txt', 'x'.repeat(60), 1),
        ).resolves.toMatchObject({ wasOverwrite: false });
    });

    it('ignores a nonsensical override', async () => {
        const user = await quotaUser(64);
        for (const override of [-5, Number.POSITIVE_INFINITY, Number.NaN]) {
            await expect(
                user.write(`bad-${override}.txt`, 'x'.repeat(65), override),
            ).rejects.toMatchObject({ statusCode: 413 });
        }
    });

    it('counts the whole batch against the allowance, not each item alone', async () => {
        const user = await quotaUser(64);
        const error = await caught(() =>
            limitedFs.batchWrites(user.userId, [
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/b1.txt`,
                        size: 40,
                    },
                    fileContent: 'x'.repeat(40),
                },
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/b2.txt`,
                        size: 40,
                    },
                    fileContent: 'x'.repeat(40),
                },
            ]),
        );
        expect(error.statusCode).toBe(413);
        expect(error.legacyCode).toBe('storage_limit_reached');
    });

    it('discounts the size of the file being overwritten', async () => {
        const user = await quotaUser(64);
        const path = `${user.home}/Documents/replace.txt`;
        await limitedFs.write(user.userId, {
            fileMetadata: { path, size: 60 },
            fileContent: 'x'.repeat(60),
        });

        // 60 of 64 bytes are already used: the write only fits because the
        // overwritten entry's own size is released first.
        await expect(
            limitedFs.write(user.userId, {
                fileMetadata: { path, size: 60, overwrite: true },
                fileContent: 'y'.repeat(60),
            }),
        ).resolves.toMatchObject({ wasOverwrite: true });
    });

    it('rejects a signed write that would exceed the allowance', async () => {
        const user = await quotaUser(64);
        const error = await caught(() =>
            limitedFs.startUrlWrite(user.userId, {
                fileMetadata: {
                    path: `${user.home}/Documents/signed-big.txt`,
                    size: 65,
                },
            }),
        );
        expect(error.statusCode).toBe(413);
    });

    it('rejects a copy that would exceed the allowance', async () => {
        const user = await quotaUser(64);
        const { fsEntry: source } = await user.write(
            'orig.txt',
            'x'.repeat(40),
        );
        const documents = (await limitedServer.stores.fsEntry.getEntryByPath(
            `${user.home}/Documents`,
        ))!;

        const error = await caught(() =>
            limitedFs.copy(user.userId, {
                source,
                destinationParent: documents,
                newName: 'orig-copy.txt',
            }),
        );
        expect(error.statusCode).toBe(413);
        expect(error.legacyCode).toBe('storage_limit_reached');
        expect(
            await limitedServer.stores.fsEntry.getEntryByPath(
                `${user.home}/Documents/orig-copy.txt`,
            ),
        ).toBeNull();
    });

    it('counts the whole subtree when copying a directory', async () => {
        const user = await quotaUser(64);
        await limitedFs.mkdir(user.userId, {
            path: `${user.home}/Documents/tree`,
        });
        await limitedFs.write(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/tree/a.txt`,
                size: 20,
            },
            fileContent: 'x'.repeat(20),
        });
        await limitedFs.write(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/tree/b.txt`,
                size: 20,
            },
            fileContent: 'x'.repeat(20),
        });
        const source = (await limitedServer.stores.fsEntry.getEntryByPath(
            `${user.home}/Documents/tree`,
        ))!;
        const desktop = (await limitedServer.stores.fsEntry.getEntryByPath(
            `${user.home}/Desktop`,
        ))!;

        // 40 of 64 bytes are used; duplicating the tree would need 40 more.
        const error = await caught(() =>
            limitedFs.copy(user.userId, {
                source,
                destinationParent: desktop,
            }),
        );
        expect(error.statusCode).toBe(413);
        expect(
            await limitedServer.stores.fsEntry.getEntryByPath(
                `${user.home}/Desktop/tree`,
            ),
        ).toBeNull();
    });

    it('discounts the entry an overwriting copy replaces', async () => {
        const user = await quotaUser(64);
        const { fsEntry: source } = await user.write('src.txt', 'x'.repeat(30));
        await user.write('dst.txt', 'y'.repeat(30));
        const documents = (await limitedServer.stores.fsEntry.getEntryByPath(
            `${user.home}/Documents`,
        ))!;

        // 60 of 64 bytes are used: the copy only fits because overwriting
        // dst.txt releases its 30 first.
        const copy = await limitedFs.copy(user.userId, {
            source,
            destinationParent: documents,
            newName: 'dst.txt',
            overwrite: true,
        });
        expect(copy.size).toBe(30);
    });

    it('lets a per-request override raise the ceiling for a copy', async () => {
        const user = await quotaUser(64);
        const { fsEntry: source } = await user.write(
            'over.txt',
            'x'.repeat(40),
        );
        const documents = (await limitedServer.stores.fsEntry.getEntryByPath(
            `${user.home}/Documents`,
        ))!;

        await expect(
            limitedFs.copy(user.userId, {
                source,
                destinationParent: documents,
                newName: 'over-copy.txt',
                storageAllowanceMax: 1024,
            }),
        ).resolves.toMatchObject({ size: 40 });
    });

    it('rejects a batch signed write that would exceed the allowance', async () => {
        const user = await quotaUser(64);
        const error = await caught(() =>
            limitedFs.batchStartUrlWrites(user.userId, [
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/s1.txt`,
                        size: 40,
                    },
                },
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/s2.txt`,
                        size: 40,
                    },
                },
            ]),
        );
        expect(error.statusCode).toBe(413);
    });
});

describe('FSService batch writes', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('returns an empty result for an empty batch', async () => {
        await expect(fs.batchWrites(user.userId, [])).resolves.toEqual([]);
        const prepared = await fs.prepareBatchWrites(user.userId, []);
        expect(prepared).toMatchObject({ userId: user.userId, items: [] });
        await expect(
            fs.assertStorageAllowanceForPreparedBatch(prepared),
        ).resolves.toBeUndefined();
    });

    it('writes every item and reports per-item overwrite state', async () => {
        await writeFile(user, `${user.home}/Documents/batch-b.txt`, 'old');

        const results = await fs.batchWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/batch-a.txt`,
                    size: 1,
                },
                fileContent: 'A',
            },
            {
                fileMetadata: {
                    path: `${user.home}/Documents/batch-b.txt`,
                    size: 3,
                    overwrite: true,
                },
                fileContent: 'BBB',
            },
        ]);

        expect(results.map((result) => result.wasOverwrite)).toEqual([
            false,
            true,
        ]);
        expect(await readBack(results[0]!.fsEntry)).toBe('A');
        expect(await readBack(results[1]!.fsEntry)).toBe('BBB');
    });

    it('rejects a batch that targets the same path twice', async () => {
        const error = await caught(() =>
            fs.batchWrites(user.userId, [
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/same.txt`,
                        size: 1,
                        overwrite: true,
                    },
                    fileContent: 'A',
                },
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/same.txt`,
                        size: 1,
                        overwrite: true,
                    },
                    fileContent: 'B',
                },
            ]),
        );
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('duplicate target path');
    });

    it('dedupes a within-batch collision instead of failing when asked', async () => {
        const results = await fs.batchWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/dd.txt`,
                    size: 1,
                    dedupeName: true,
                },
                fileContent: 'A',
            },
            {
                fileMetadata: {
                    path: `${user.home}/Documents/dd.txt`,
                    size: 1,
                    dedupeName: true,
                },
                fileContent: 'B',
            },
        ]);

        expect(results.map((result) => result.fsEntry.path)).toEqual([
            `${user.home}/Documents/dd.txt`,
            `${user.home}/Documents/dd (1).txt`,
        ]);
    });

    it('reports the metadata index that has no prepared item', async () => {
        const prepared = await fs.prepareBatchWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/prep.txt`,
                    size: 1,
                },
            },
        ]);

        const error = await caught(() =>
            fs.uploadPreparedBatchItem({
                preparedBatch: prepared,
                itemIndex: 7,
                fileContent: 'x',
            }),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('index 7');
    });

    it('fails finalization when an upload result is missing', async () => {
        const prepared = await fs.prepareBatchWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/partial.txt`,
                    size: 1,
                },
            },
        ]);

        const error = await caught(() =>
            fs.finalizePreparedBatchWrites(prepared, []),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe(
            'Some batch files were missing upload content',
        );
        // The row was never created.
        expect(await entryAt(user, '/Documents/partial.txt')).toBeNull();
    });

    it('carries the uploaded thumbnail and content hash through finalization', async () => {
        const prepared = await fs.prepareBatchWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/thumbed.txt`,
                    size: 5,
                },
                thumbnailData: 'data:image/png;base64,AAAA',
            },
        ]);
        const uploaded = await fs.uploadPreparedBatchItem({
            preparedBatch: prepared,
            itemIndex: 0,
            fileContent: 'hello',
        });
        expect(uploaded.uploadedSize).toBe(5);

        const [finalized] = await fs.finalizePreparedBatchWrites(prepared, [
            uploaded,
        ]);
        expect(finalized?.requestedThumbnail).toBe(
            'data:image/png;base64,AAAA',
        );
        expect(finalized?.contentHashSha256).toBe(
            '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        );
    });

    it('removes newly uploaded objects when one item of the batch fails', async () => {
        const deleteObject = vi.spyOn(server.stores.s3Object, 'deleteObject');
        const uploadFromServer = vi
            .spyOn(server.stores.s3Object, 'uploadFromServer')
            .mockImplementationOnce(async () => undefined)
            .mockImplementationOnce(async () => {
                throw new Error('s3 upload failed');
            });

        await expect(
            fs.batchWrites(user.userId, [
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/rollback-a.txt`,
                        size: 1,
                    },
                    fileContent: 'A',
                },
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/rollback-b.txt`,
                        size: 1,
                    },
                    fileContent: 'B',
                },
            ]),
        ).rejects.toThrow('s3 upload failed');

        expect(deleteObject).toHaveBeenCalledTimes(1);
        expect(await entryAt(user, '/Documents/rollback-a.txt')).toBeNull();
        expect(await entryAt(user, '/Documents/rollback-b.txt')).toBeNull();

        uploadFromServer.mockRestore();
        deleteObject.mockRestore();
    });

    it('leaves an overwritten object in place when cleaning up a failed batch', async () => {
        const existing = await writeFile(
            user,
            `${user.home}/Documents/keepme.txt`,
            'original',
        );
        const deleteObject = vi.spyOn(server.stores.s3Object, 'deleteObject');

        const prepared = await fs.prepareBatchWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/keepme.txt`,
                    size: 1,
                    overwrite: true,
                },
            },
        ]);
        await fs.cleanupPreparedBatchUploads(prepared, [
            {
                index: 0,
                objectKey: existing.uuid,
                uploadedSize: 1,
                contentHashSha256: null,
            },
        ]);

        expect(deleteObject).not.toHaveBeenCalled();
        deleteObject.mockRestore();
    });
});

describe('FSService signed (direct-to-S3) writes', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    const start = (path: string, over: Record<string, unknown> = {}) =>
        fs.startUrlWrite(user.userId, {
            fileMetadata: { path, size: 5, contentType: 'text/plain' },
            ...over,
        });

    it('issues a single-part upload session backed by a pending row', async () => {
        const response = await start(`${user.home}/Documents/signed.txt`);

        expect(response.uploadMode).toBe('single');
        expect(response.url).toContain(response.objectKey);
        expect(response.bucket).toBe('puter-local');
        expect(response.bucketRegion).toBe('us-west-2');
        expect(response.contentType).toBe('text/plain');

        const session = await server.stores.fsEntry.getPendingEntryBySessionId(
            response.sessionId,
        );
        expect(session).toMatchObject({
            userId: user.userId,
            targetPath: `${user.home}/Documents/signed.txt`,
            targetName: 'signed.txt',
            parentPath: `${user.home}/Documents`,
            status: 'pending',
            uploadMode: 'single',
            objectKey: response.objectKey,
        });
    });

    it('completes a signed upload and records the true uploaded size', async () => {
        const response = await start(`${user.home}/Documents/reconcile.txt`);
        // The client declared 5 bytes; PUT 11 through the presigned URL.
        const uploaded = await fetch(response.url!, {
            method: 'PUT',
            body: 'hello world',
            headers: { 'content-type': 'text/plain' },
        });
        expect(uploaded.ok).toBe(true);

        const completed = await fs.completeUrlWrite(user.userId, {
            uploadId: response.sessionId,
        });

        expect(completed.wasOverwrite).toBe(false);
        expect(completed.fsEntry.size).toBe(11);
        expect(await readBack(completed.fsEntry)).toBe('hello world');
    });

    it('keeps the declared size when the object was never uploaded', async () => {
        const response = await start(`${user.home}/Documents/nobytes.txt`);
        const completed = await fs.completeUrlWrite(user.userId, {
            uploadId: response.sessionId,
        });
        expect(completed.fsEntry.size).toBe(5);
    });

    it('creates a directory entry instead of an upload session', async () => {
        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/signed-dir`,
                size: 0,
                createMissingParents: true,
            },
            directory: true,
        });

        expect(response.sessionId).toBe('');
        expect(response.directoryCreated).toBe(true);
        expect(response.contentType).toBe('inode/directory');
        expect(response.fsEntry?.isDir).toBe(true);

        const again = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/signed-dir`,
                size: 0,
                createMissingParents: true,
            },
            directory: true,
        });
        expect(again.directoryCreated).toBe(false);
        expect(again.objectKey).toBe(response.objectKey);
    });

    it('switches to multipart when the declared size exceeds the single-upload limit', async () => {
        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/big.bin`,
                size: fs.getMaxSingleUploadSize() * 2,
                contentType: 'application/octet-stream',
            },
        });

        expect(response.uploadMode).toBe('multipart');
        expect(response.multipartUploadId).toBeTruthy();
        expect(response.multipartPartCount).toBe(2);
        expect(response.multipartPartUrls).toHaveLength(2);

        await fs.abortUrlWrite(user.userId, response.sessionId);
    });

    it('aborts the multipart upload when the pending row cannot be written', async () => {
        const abort = vi.spyOn(server.stores.s3Object, 'abortMutipartUpload');
        const createPendingEntry = vi
            .spyOn(server.stores.fsEntry, 'createPendingEntry')
            .mockRejectedValueOnce(new Error('redis unavailable'));

        await expect(
            fs.startUrlWrite(user.userId, {
                fileMetadata: {
                    path: `${user.home}/Documents/orphan.bin`,
                    size: fs.getMaxSingleUploadSize() * 2,
                },
                uploadMode: 'multipart',
            }),
        ).rejects.toThrow('redis unavailable');
        expect(abort).toHaveBeenCalledTimes(1);

        createPendingEntry.mockRestore();
        abort.mockRestore();
    });

    it('rejects completion of an unknown, foreign, or already-consumed session', async () => {
        const unknown = await caught(() =>
            fs.completeUrlWrite(user.userId, { uploadId: 'nope' }),
        );
        expect(unknown.statusCode).toBe(404);

        const response = await start(`${user.home}/Documents/guarded.txt`);
        const foreign = await caught(() =>
            fs.completeUrlWrite(user.userId + 99_999, {
                uploadId: response.sessionId,
            }),
        );
        expect(foreign.statusCode).toBe(403);
        expect(foreign.legacyCode).toBe('forbidden');

        await fs.completeUrlWrite(user.userId, {
            uploadId: response.sessionId,
        });
        const replayed = await caught(() =>
            fs.completeUrlWrite(user.userId, { uploadId: response.sessionId }),
        );
        expect(replayed.statusCode).toBe(409);
        expect(replayed.message).toContain('status=completed');
    });

    it('fails an expired session and marks it failed', async () => {
        const response = await start(`${user.home}/Documents/expired.txt`);
        await expirePendingSession(response.sessionId);
        const markFailed = vi.spyOn(
            server.stores.fsEntry,
            'markPendingEntryFailed',
        );

        const error = await caught(() =>
            fs.completeUrlWrite(user.userId, { uploadId: response.sessionId }),
        );

        expect(error.statusCode).toBe(400);
        expect(error.legacyCode).toBe('session_required');
        expect(markFailed).toHaveBeenCalledWith(
            response.sessionId,
            'Upload session expired',
        );
        expect(await entryAt(user, '/Documents/expired.txt')).toBeNull();
        markFailed.mockRestore();
    });

    it('requires parts to complete a multipart session and marks it failed', async () => {
        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/mp-noparts.bin`,
                size: fs.getMaxSingleUploadSize() * 2,
            },
            uploadMode: 'multipart',
        });

        const error = await caught(() =>
            fs.completeUrlWrite(user.userId, { uploadId: response.sessionId }),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe(
            'Multipart upload completion requires parts',
        );
        expect(
            (
                await server.stores.fsEntry.getPendingEntryBySessionId(
                    response.sessionId,
                )
            )?.status,
        ).toBe('failed');

        await server.stores.s3Object.abortMutipartUpload(
            response.multipartUploadId!,
            response.bucketRegion,
            response.bucket,
            response.objectKey,
        );
    });

    it('aborts a session, deleting the staged object and marking it aborted', async () => {
        const response = await start(`${user.home}/Documents/aborted.txt`);
        await fetch(response.url!, { method: 'PUT', body: 'staged' });
        const deleteObject = vi.spyOn(server.stores.s3Object, 'deleteObject');

        await fs.abortUrlWrite(user.userId, response.sessionId);

        expect(deleteObject).toHaveBeenCalledWith(
            response.bucket,
            response.objectKey,
            response.bucketRegion,
        );
        expect(
            (
                await server.stores.fsEntry.getPendingEntryBySessionId(
                    response.sessionId,
                )
            )?.status,
        ).toBe('aborted');
        deleteObject.mockRestore();
    });

    it('ignores an abort for an unknown session and refuses a foreign one', async () => {
        await expect(
            fs.abortUrlWrite(user.userId, 'no-such-session'),
        ).resolves.toBeUndefined();

        const response = await start(`${user.home}/Documents/foreign.txt`);
        const error = await caught(() =>
            fs.abortUrlWrite(user.userId + 99_999, response.sessionId),
        );
        expect(error.statusCode).toBe(403);
    });
});

describe('FSService multipart part signing', () => {
    let user: TestUser;
    let sessionId: string;
    let objectKey: string;
    let multipartUploadId: string;

    beforeAll(async () => {
        user = await makeUser();
        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/parts.bin`,
                size: fs.getMaxSingleUploadSize() * 3,
            },
            uploadMode: 'multipart',
        });
        sessionId = response.sessionId;
        objectKey = response.objectKey;
        multipartUploadId = response.multipartUploadId!;
    });

    afterAll(async () => {
        await server.stores.s3Object
            .abortMutipartUpload(
                multipartUploadId,
                'us-west-2',
                'puter-local',
                objectKey,
            )
            .catch(() => undefined);
    });

    it('signs the requested unique part numbers', async () => {
        const response = await fs.signMultipartParts(user.userId, {
            uploadId: sessionId,
            partNumbers: [1, 2, 2],
        });

        expect(response.multipartPartUrls.map((p) => p.partNumber)).toEqual([
            1, 2,
        ]);
        expect(response.multipartUploadId).toBe(multipartUploadId);
        expect(response.objectKey).toBe(objectKey);
        expect(response.expiresAt).toBeGreaterThan(Date.now());
    });

    it.each([
        [
            'a missing uploadId',
            { uploadId: '', partNumbers: [1] },
            'Missing uploadId',
        ],
        [
            'an empty part list',
            { uploadId: 'x', partNumbers: [] },
            'Missing partNumbers',
        ],
        [
            'a non-array part list',
            { uploadId: 'x', partNumbers: null },
            'Missing partNumbers',
        ],
    ])('rejects %s', async (_label, request, message) => {
        const error = await caught(() =>
            fs.signMultipartParts(
                user.userId,
                request as Parameters<FSService['signMultipartParts']>[1],
            ),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe(message);
    });

    it.each([[0], [-1], [1.5]])(
        'rejects the invalid part number %s',
        async (partNumber) => {
            const error = await caught(() =>
                fs.signMultipartParts(user.userId, {
                    uploadId: sessionId,
                    partNumbers: [partNumber],
                }),
            );
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe('Invalid partNumbers');
        },
    );

    it('rejects a part number beyond the session part count', async () => {
        const error = await caught(() =>
            fs.signMultipartParts(user.userId, {
                uploadId: sessionId,
                partNumbers: [99],
            }),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Part number exceeds multipart part count');
    });

    it('rejects an unknown session and a session owned by someone else', async () => {
        const unknown = await caught(() =>
            fs.signMultipartParts(user.userId, {
                uploadId: 'nope',
                partNumbers: [1],
            }),
        );
        expect(unknown.statusCode).toBe(404);

        const foreign = await caught(() =>
            fs.signMultipartParts(user.userId + 99_999, {
                uploadId: sessionId,
                partNumbers: [1],
            }),
        );
        expect(foreign.statusCode).toBe(403);
    });

    it('rejects a single-part session', async () => {
        const single = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/single-parts.txt`,
                size: 4,
            },
        });
        const error = await caught(() =>
            fs.signMultipartParts(user.userId, {
                uploadId: single.sessionId,
                partNumbers: [1],
            }),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Upload session is not multipart');
    });

    it('rejects and fails an expired session', async () => {
        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/parts-expired.bin`,
                size: fs.getMaxSingleUploadSize() * 2,
            },
            uploadMode: 'multipart',
        });
        await expirePendingSession(response.sessionId);
        const markFailed = vi.spyOn(
            server.stores.fsEntry,
            'markPendingEntryFailed',
        );

        const error = await caught(() =>
            fs.signMultipartParts(user.userId, {
                uploadId: response.sessionId,
                partNumbers: [1],
            }),
        );

        expect(error.statusCode).toBe(400);
        expect(error.legacyCode).toBe('session_required');
        expect(markFailed).toHaveBeenCalledWith(
            response.sessionId,
            'Upload session expired',
        );
        markFailed.mockRestore();

        await server.stores.s3Object
            .abortMutipartUpload(
                response.multipartUploadId!,
                response.bucketRegion,
                response.bucket,
                response.objectKey,
            )
            .catch(() => undefined);
    });
});

describe('FSService batch signed writes', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('returns nothing for an empty batch', async () => {
        await expect(fs.batchStartUrlWrites(user.userId, [])).resolves.toEqual(
            [],
        );
        await expect(
            fs.batchCompleteUrlWrite(user.userId, []),
        ).resolves.toEqual([]);
    });

    it('mixes directory and file requests and preserves request order', async () => {
        const responses = await fs.batchStartUrlWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/bsw-dir`,
                    size: 0,
                    createMissingParents: true,
                },
                directory: true,
            },
            {
                fileMetadata: {
                    path: `${user.home}/Documents/bsw-file.txt`,
                    size: 3,
                    contentType: 'text/plain',
                },
            },
        ]);

        expect(responses[0]?.contentType).toBe('inode/directory');
        expect(responses[0]?.directoryCreated).toBe(true);
        expect(responses[1]?.url).toBeTruthy();
        expect(responses[1]?.sessionId).toBeTruthy();
    });

    it('rejects two directory requests for the same path', async () => {
        const error = await caught(() =>
            fs.batchStartUrlWrites(user.userId, [
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/dupdir`,
                        size: 0,
                        createMissingParents: true,
                    },
                    directory: true,
                },
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/dupdir`,
                        size: 0,
                        createMissingParents: true,
                    },
                    directory: true,
                },
            ]),
        );
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('duplicate target path');
    });

    it('reports the directories it had to create along the way', async () => {
        const result = await fs.batchStartUrlWritesWithCreatedDirectories(
            user.userId,
            [
                {
                    fileMetadata: {
                        path: `${user.home}/Documents/auto/created/f.txt`,
                        size: 1,
                        createMissingParents: true,
                    },
                },
            ],
        );

        expect(
            result.createdDirectoryEntries.map((entry) => entry.path).sort(),
        ).toEqual([
            `${user.home}/Documents/auto`,
            `${user.home}/Documents/auto/created`,
        ]);
    });

    it('completes a batch of sessions and rejects duplicate upload ids', async () => {
        const responses = await fs.batchStartUrlWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/bc-1.txt`,
                    size: 2,
                },
            },
            {
                fileMetadata: {
                    path: `${user.home}/Documents/bc-2.txt`,
                    size: 2,
                },
            },
        ]);
        await fetch(responses[0]!.url!, { method: 'PUT', body: 'ab' });
        await fetch(responses[1]!.url!, { method: 'PUT', body: 'cdef' });

        const duplicate = await caught(() =>
            fs.batchCompleteUrlWrite(user.userId, [
                { uploadId: responses[0]!.sessionId },
                { uploadId: responses[0]!.sessionId },
            ]),
        );
        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.message).toContain('duplicate upload session ids');

        const completed = await fs.batchCompleteUrlWrite(user.userId, [
            { uploadId: responses[0]!.sessionId },
            { uploadId: responses[1]!.sessionId },
        ]);
        expect(completed.map((result) => result.fsEntry.size)).toEqual([2, 4]);
        expect(completed.map((result) => result.fsEntry.path)).toEqual([
            `${user.home}/Documents/bc-1.txt`,
            `${user.home}/Documents/bc-2.txt`,
        ]);
    });

    it('rejects a batch containing an unknown, foreign or consumed session', async () => {
        const unknown = await caught(() =>
            fs.batchCompleteUrlWrite(user.userId, [{ uploadId: 'nope' }]),
        );
        expect(unknown.statusCode).toBe(404);

        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/bc-guard.txt`,
                size: 1,
            },
        });
        const foreign = await caught(() =>
            fs.batchCompleteUrlWrite(user.userId + 99_999, [
                { uploadId: response.sessionId },
            ]),
        );
        expect(foreign.statusCode).toBe(403);

        await fs.batchCompleteUrlWrite(user.userId, [
            { uploadId: response.sessionId },
        ]);
        const replayed = await caught(() =>
            fs.batchCompleteUrlWrite(user.userId, [
                { uploadId: response.sessionId },
            ]),
        );
        expect(replayed.statusCode).toBe(409);
    });

    it('marks every expired session in the batch failed', async () => {
        const response = await fs.startUrlWrite(user.userId, {
            fileMetadata: {
                path: `${user.home}/Documents/bc-expired.txt`,
                size: 1,
            },
        });
        await expirePendingSession(response.sessionId);
        const markFailed = vi.spyOn(
            server.stores.fsEntry,
            'markPendingEntriesFailed',
        );

        const error = await caught(() =>
            fs.batchCompleteUrlWrite(user.userId, [
                { uploadId: response.sessionId },
            ]),
        );

        expect(error.statusCode).toBe(400);
        expect(error.legacyCode).toBe('session_required');
        expect(markFailed).toHaveBeenCalledWith(
            [response.sessionId],
            'Upload session expired',
        );
        markFailed.mockRestore();
    });

    it('fails the whole batch and marks the session failed when a multipart completion has no parts', async () => {
        const responses = await fs.batchStartUrlWrites(user.userId, [
            {
                fileMetadata: {
                    path: `${user.home}/Documents/bc-mp.bin`,
                    size: fs.getMaxSingleUploadSize() * 2,
                },
                uploadMode: 'multipart',
            },
        ]);

        const error = await caught(() =>
            fs.batchCompleteUrlWrite(user.userId, [
                { uploadId: responses[0]!.sessionId },
            ]),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe(
            'Multipart upload completion requires parts',
        );
        expect(
            (
                await server.stores.fsEntry.getPendingEntryBySessionId(
                    responses[0]!.sessionId,
                )
            )?.status,
        ).toBe('failed');

        await server.stores.s3Object
            .abortMutipartUpload(
                responses[0]!.multipartUploadId!,
                responses[0]!.bucketRegion,
                responses[0]!.bucket,
                responses[0]!.objectKey,
            )
            .catch(() => undefined);
    });
});

describe('FSService reads', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('streams file content and honours a byte range', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/read.txt`,
            'abcdefghij',
        );

        expect(await readBack(entry)).toBe('abcdefghij');

        const ranged = await fs.readContent(entry, { range: 'bytes=2-4' });
        expect(ranged.contentRange).toBe('bytes 2-4/10');
        const chunks: Buffer[] = [];
        for await (const chunk of ranged.body) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe('cde');
    });

    it('refuses to read a directory', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/readdir`,
        });
        const error = await caught(() => fs.readContent(dir));
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Cannot read content of a directory');
    });

    it('refuses to read a shortcut without resolving it first', async () => {
        const target = await writeFile(
            user,
            `${user.home}/Documents/target.txt`,
            'x',
        );
        const parent = (await entryAt(user, '/Documents'))!;
        const shortcut = await fs.mkshortcut(user.userId, {
            parent,
            name: 'link',
            target,
        });

        const error = await caught(() => fs.readContent(shortcut));
        expect(error.statusCode).toBe(400);
        expect(error.legacyCode).toBe('shortcut_target_not_found');
    });

    it('returns an empty stream for a file that never had a backing object', async () => {
        const touched = await fs.touch(user.userId, {
            path: `${user.home}/Documents/empty.txt`,
        });
        const result = await fs.readContent(touched);

        expect(result.contentLength).toBe(0);
        expect(result.etag).toBeNull();
        expect(result.lastModified).toBeInstanceOf(Date);
        expect(await readBack(touched)).toBe('');
    });

    it('deletes the row and reports 404 when the backing object has vanished', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/ghost.txt`,
            'boo',
        );
        await server.stores.s3Object.deleteObject(
            entry.bucket!,
            entry.uuid,
            entry.bucketRegion!,
        );
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        const error = await caught(() => fs.readContent(entry));
        expect(error.statusCode).toBe(404);
        expect(error.legacyCode).toBe('subject_does_not_exist');
        expect(error.fields).toEqual({ path: entry.path, uid: entry.uuid });
        expect(await entryAt(user, '/Documents/ghost.txt')).toBeNull();

        consoleError.mockRestore();
    });

    it('propagates a non-NoSuchKey storage failure unchanged', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/broken.txt`,
            'x',
        );
        const getObjectStream = vi
            .spyOn(server.stores.s3Object, 'getObjectStream')
            .mockRejectedValueOnce(new Error('connection reset'));

        await expect(fs.readContent(entry)).rejects.toThrow('connection reset');
        // The row must survive an error that is not "object is gone".
        expect(await entryAt(user, '/Documents/broken.txt')).not.toBeNull();

        getObjectStream.mockRestore();
    });

    it('lists, counts and searches a directory tree', async () => {
        const root = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/tree`,
        });
        await writeFile(user, `${user.home}/Documents/tree/a.txt`, 'aaa');
        await writeFile(user, `${user.home}/Documents/tree/b.txt`, 'bb');
        await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/tree/sub`,
        });
        await writeFile(user, `${user.home}/Documents/tree/sub/c.txt`, 'c');

        const children = await fs.listDirectory(root.uuid, {
            sortBy: 'name',
            sortOrder: 'asc',
        });
        expect(children.map((entry) => entry.name)).toEqual([
            'a.txt',
            'b.txt',
            'sub',
        ]);
        await expect(fs.countDirectory(root.uuid)).resolves.toBe(3);

        const firstPage = await fs.listDirectoryPage(root.uuid, { limit: 2 });
        expect(firstPage.entries).toHaveLength(2);
        expect(firstPage.cursor).toBeTruthy();
        const secondPage = await fs.listDirectoryPage(root.uuid, {
            limit: 2,
            cursor: firstPage.cursor,
        });
        expect(secondPage.entries).toHaveLength(1);

        const deep = await fs.listDirectoryTreePage(
            user.userId,
            `${user.home}/Documents/tree`,
            { maxDepth: 2 },
        );
        expect(deep.entries.map((entry) => entry.name).sort()).toEqual([
            'a.txt',
            'b.txt',
            'c.txt',
            'sub',
        ]);
        await expect(
            fs.countDirectoryTree(
                user.userId,
                `${user.home}/Documents/tree`,
                1,
            ),
        ).resolves.toBe(3);

        await expect(
            fs.getSubtreeSize(user.userId, `${user.home}/Documents/tree`),
        ).resolves.toBe(6);

        const found = await fs.searchByName(user.userId, 'c.txt');
        expect(found.map((entry) => entry.path)).toContain(
            `${user.home}/Documents/tree/sub/c.txt`,
        );

        const scoped = await fs.searchByName(
            user.userId,
            'c.txt',
            10,
            `${user.home}/Desktop`,
        );
        expect(scoped).toEqual([]);
    });

    it('answers existence and walks the ancestor chain', async () => {
        await writeFile(user, `${user.home}/Documents/anc.txt`, 'x');

        await expect(
            fs.entryExistsByPath(`${user.home}/Documents/anc.txt`),
        ).resolves.toBe(true);
        await expect(
            fs.entryExistsByPath(`${user.home}/Documents/missing.txt`),
        ).resolves.toBe(false);

        const chain = await fs.getAncestorChain(
            `${user.home}/Documents/anc.txt`,
        );
        expect(chain.map((node) => node.path)).toEqual([
            `${user.home}/Documents/anc.txt`,
            `${user.home}/Documents`,
            user.home,
        ]);
    });
});

describe('FSService mkdir, touch, rename and shortcuts', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('creates a directory and is idempotent for an existing one', async () => {
        const created = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/md`,
        });
        expect(created.isDir).toBe(true);

        const again = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/md`,
        });
        expect(again.uuid).toBe(created.uuid);
    });

    it('dedupes an existing directory name when asked', async () => {
        await fs.mkdir(user.userId, { path: `${user.home}/Documents/dd` });
        const deduped = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/dd`,
            dedupeName: true,
        });
        expect(deduped.path).toBe(`${user.home}/Documents/dd (1)`);
    });

    it('replaces a file occupant on overwrite and dedupes past one otherwise', async () => {
        await writeFile(user, `${user.home}/Documents/occupied`, 'x');
        const replaced = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/occupied`,
            overwrite: true,
        });
        expect(replaced.isDir).toBe(true);

        await writeFile(user, `${user.home}/Documents/occupied2`, 'x');
        const deduped = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/occupied2`,
            dedupeName: true,
        });
        expect(deduped.path).toBe(`${user.home}/Documents/occupied2 (1)`);
    });

    it('conflicts with an existing file when neither overwrite nor dedupe is set', async () => {
        await writeFile(user, `${user.home}/Documents/clash`, 'x');
        const error = await caught(() =>
            fs.mkdir(user.userId, { path: `${user.home}/Documents/clash` }),
        );
        expect(error.statusCode).toBe(409);
        expect(error.legacyCode).toBe('conflict');
    });

    it('creates intermediate directories only when asked', async () => {
        const missing = await caught(() =>
            fs.mkdir(user.userId, { path: `${user.home}/Documents/x/y/z` }),
        );
        expect(missing.statusCode).toBe(404);

        const created = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/p/q/r`,
            createMissingParents: true,
        });
        expect(created.path).toBe(`${user.home}/Documents/p/q/r`);
    });

    it('refuses to operate on root or directly under it', async () => {
        for (const path of ['/', '/toplevel']) {
            const error = await caught(() => fs.mkdir(user.userId, { path }));
            expect(error.statusCode).toBe(400);
        }
    });

    /**
     * Reproduce losing the mkdir race against a concurrent writer: the
     * existence probe finds nothing (it ran before the other writer's commit)
     * and the INSERT then trips the `(parent_id, name)` unique key. Both halves
     * are forced, because the probe otherwise sees the row and the sqlite test
     * schema indexes that pair without a unique constraint.
     */
    const simulateLostMkdirRace = (path: string) => {
        const store = server.stores.fsEntry;
        const db = server.clients.db;
        // Read the unpatched implementations off the prototypes: each spy
        // installs an own property, so these stay the real methods.
        const originalRead = (Object.getPrototypeOf(store) as typeof store)
            .getEntryByPath;
        const originalWrite = (Object.getPrototypeOf(db) as typeof db).write;

        const probeSpy = vi
            .spyOn(store, 'getEntryByPath')
            .mockImplementation(async (candidate, options) => {
                if (candidate === path && !options?.useTryHardRead) return null;
                return originalRead.call(store, candidate, options);
            });

        let insertRejected = false;
        const writeSpy = vi
            .spyOn(db, 'write')
            .mockImplementation(async (sql: string, params?: unknown[]) => {
                if (!insertRejected && sql.includes('INSERT INTO fsentries')) {
                    insertRejected = true;
                    const violation = Object.assign(
                        new Error(
                            'UNIQUE constraint failed: fsentries.parent_id, fsentries.name',
                        ),
                        { code: 'SQLITE_CONSTRAINT' },
                    );
                    throw violation;
                }
                return originalWrite.call(db, sql, params);
            });

        return () => {
            probeSpy.mockRestore();
            writeSpy.mockRestore();
        };
    };

    it('returns the racing directory when a concurrent mkdir wins the insert', async () => {
        const path = `${user.home}/Documents/raced`;
        const winner = await fs.mkdir(user.userId, { path });
        const restore = simulateLostMkdirRace(path);

        const raced = await fs.mkdir(user.userId, { path });

        expect(raced.uuid).toBe(winner.uuid);
        restore();
    });

    it('surfaces a conflict when the racing insert produced a file', async () => {
        const path = `${user.home}/Documents/racedfile`;
        await writeFile(user, path, 'x');
        const restore = simulateLostMkdirRace(path);

        const error = await caught(() => fs.mkdir(user.userId, { path }));

        expect(error.statusCode).toBe(409);
        expect(error.message).toContain(path);
        restore();
    });

    it('rethrows an insert failure that is not a unique-key violation', async () => {
        const db = server.clients.db;
        const originalWrite = (Object.getPrototypeOf(db) as typeof db).write;
        const writeSpy = vi
            .spyOn(db, 'write')
            .mockImplementation(async (sql: string, params?: unknown[]) => {
                if (sql.includes('INSERT INTO fsentries')) {
                    throw new Error('disk is full');
                }
                return originalWrite.call(db, sql, params);
            });

        await expect(
            fs.mkdir(user.userId, { path: `${user.home}/Documents/diskfull` }),
        ).rejects.toThrow('disk is full');

        writeSpy.mockRestore();
    });

    it('touches a new empty file and then bumps its timestamps', async () => {
        const created = await fs.touch(user.userId, {
            path: `${user.home}/Documents/touched.txt`,
        });
        expect(created.size).toBe(0);
        expect(created.isDir).toBe(false);
        expect(created.bucket).toBeNull();

        const bumped = await fs.touch(user.userId, {
            path: `${user.home}/Documents/touched.txt`,
            setModified: true,
            setAccessed: true,
        });
        expect(bumped.uuid).toBe(created.uuid);
    });

    it('renames a file in place', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/before.txt`,
            'x',
        );
        const renamed = await fs.rename(entry, 'after.txt');

        expect(renamed.name).toBe('after.txt');
        expect(renamed.path).toBe(`${user.home}/Documents/after.txt`);
        expect(await entryAt(user, '/Documents/before.txt')).toBeNull();
    });

    it('rewrites descendant paths when a directory is renamed', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/olddir`,
        });
        await writeFile(user, `${user.home}/Documents/olddir/inner.txt`, 'x');

        await fs.rename(dir, 'newdir');

        expect(
            await entryAt(user, '/Documents/newdir/inner.txt'),
        ).not.toBeNull();
        expect(await entryAt(user, '/Documents/olddir/inner.txt')).toBeNull();
    });

    it('rejects an invalid rename and a colliding one', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/ren.txt`,
            'x',
        );
        await writeFile(user, `${user.home}/Documents/taken.txt`, 'x');

        expect((await caught(() => fs.rename(entry, 'a/b'))).message).toBe(
            'Name cannot contain a slash',
        );
        expect((await caught(() => fs.rename(entry, '   '))).message).toBe(
            'Name cannot be empty',
        );
        expect(
            (await caught(() => fs.rename(entry, 'taken.txt'))).statusCode,
        ).toBe(409);

        // Renaming to the current name is a no-op that returns the same row.
        await expect(fs.rename(entry, 'ren.txt')).resolves.toBe(entry);
    });

    it('creates a shortcut, conflicts on a taken name and dedupes on request', async () => {
        const target = await writeFile(
            user,
            `${user.home}/Documents/sc-target.txt`,
            'x',
        );
        const parent = (await entryAt(user, '/Documents'))!;

        const shortcut = await fs.mkshortcut(user.userId, {
            parent,
            name: 'sc',
            target,
        });
        expect(shortcut.isShortcut).toBe(true);
        expect(shortcut.shortcutTo).toBe(target.id);

        const error = await caught(() =>
            fs.mkshortcut(user.userId, { parent, name: 'sc', target }),
        );
        expect(error.statusCode).toBe(409);

        const deduped = await fs.mkshortcut(user.userId, {
            parent,
            name: 'sc',
            target,
            dedupeName: true,
        });
        expect(deduped.name).toBe('sc (1)');
    });

    it('rejects a thumbnail update without an entry identifier', async () => {
        const error = await caught(() =>
            fs.updateEntryThumbnail(user.userId, '', 'data:image/png;base64,A'),
        );
        expect(error.statusCode).toBe(400);
    });

    it('updates a thumbnail on an owned entry', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/thumb.txt`,
            'x',
        );
        const updated = await fs.updateEntryThumbnail(
            user.userId,
            entry.uuid,
            'data:image/png;base64,AAA',
        );
        expect(updated.thumbnail).toBe('data:image/png;base64,AAA');
    });
});

describe('FSService remove', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('deletes a file row and its backing object', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/rm.txt`,
            'gone',
        );
        await fs.remove(user.userId, { entry });

        expect(await entryAt(user, '/Documents/rm.txt')).toBeNull();
        await expect(
            server.stores.s3Object.getObjectStream(
                { bucket: entry.bucket!, objectKey: entry.uuid },
                entry.bucketRegion!,
            ),
        ).rejects.toMatchObject({ name: 'NoSuchKey' });
    });

    it('still deletes the row when the storage delete fails', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/rm-fail.txt`,
            'x',
        );
        const deleteObject = vi
            .spyOn(server.stores.s3Object, 'deleteObject')
            .mockRejectedValueOnce(new Error('s3 down'));

        await fs.remove(user.userId, { entry });
        expect(await entryAt(user, '/Documents/rm-fail.txt')).toBeNull();
        deleteObject.mockRestore();
    });

    it('refuses to remove an entry owned by another user', async () => {
        const other = await makeUser();
        const entry = await writeFile(
            other,
            `${other.home}/Documents/theirs.txt`,
            'x',
        );

        const error = await caught(() => fs.remove(user.userId, { entry }));
        expect(error.statusCode).toBe(403);
        expect(error.legacyCode).toBe('forbidden');
        expect(
            await server.stores.fsEntry.getEntryByPath(entry.path, {
                skipCache: true,
            }),
        ).not.toBeNull();
    });

    it('refuses to remove a non-empty directory without recursion', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/nonempty`,
        });
        await writeFile(user, `${user.home}/Documents/nonempty/a.txt`, 'x');

        const error = await caught(() =>
            fs.remove(user.userId, { entry: dir }),
        );
        expect(error.statusCode).toBe(409);
        expect(error.message).toBe('Directory is not empty');
    });

    it('removes a whole tree recursively including backing objects', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/tree-rm`,
        });
        const file = await writeFile(
            user,
            `${user.home}/Documents/tree-rm/deep.txt`,
            'x',
        );
        await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/tree-rm/sub`,
        });

        await fs.remove(user.userId, { entry: dir, recursive: true });

        expect(await entryAt(user, '/Documents/tree-rm')).toBeNull();
        expect(await entryAt(user, '/Documents/tree-rm/sub')).toBeNull();
        await expect(
            server.stores.s3Object.getObjectStream(
                { bucket: file.bucket!, objectKey: file.uuid },
                file.bucketRegion!,
            ),
        ).rejects.toMatchObject({ name: 'NoSuchKey' });
    });

    it('empties a directory but keeps it when descendantsOnly is set', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/emptyme`,
        });
        await writeFile(user, `${user.home}/Documents/emptyme/a.txt`, 'x');

        await fs.remove(user.userId, {
            entry: dir,
            recursive: true,
            descendantsOnly: true,
        });

        expect(await entryAt(user, '/Documents/emptyme')).not.toBeNull();
        expect(await entryAt(user, '/Documents/emptyme/a.txt')).toBeNull();
    });

    it('removes an empty directory without recursion', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/emptydir`,
        });
        await fs.remove(user.userId, { entry: dir });
        expect(await entryAt(user, '/Documents/emptydir')).toBeNull();
    });

    it('wipes every entry a user owns', async () => {
        const doomed = await makeUser();
        await writeFile(doomed, `${doomed.home}/Documents/a.txt`, 'a');
        await fs.mkdir(doomed.userId, {
            path: `${doomed.home}/Documents/d`,
        });
        await fs.touch(doomed.userId, {
            path: `${doomed.home}/Documents/empty.txt`,
        });

        await fs.removeAllForUser(doomed.userId);

        const remaining = (await server.clients.db.read(
            'SELECT COUNT(*) AS c FROM fsentries WHERE user_id = ?',
            [doomed.userId],
        )) as Array<{ c: number }>;
        expect(Number(remaining[0]?.c)).toBe(0);
    });
});

describe('FSService move', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('moves a file into another directory', async () => {
        const entry = await writeFile(
            user,
            `${user.home}/Documents/mv.txt`,
            'x',
        );
        const destination = (await entryAt(user, '/Desktop'))!;

        const moved = await fs.move(user.userId, {
            source: entry,
            destinationParent: destination,
        });

        expect(moved.path).toBe(`${user.home}/Desktop/mv.txt`);
        expect(moved.parentUid).toBe(destination.uuid);
        expect(await entryAt(user, '/Documents/mv.txt')).toBeNull();
    });

    it('renames while moving and rewrites descendant paths', async () => {
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/mvdir`,
        });
        await writeFile(user, `${user.home}/Documents/mvdir/in.txt`, 'x');
        const destination = (await entryAt(user, '/Desktop'))!;

        const moved = await fs.move(user.userId, {
            source: dir,
            destinationParent: destination,
            newName: 'moveddir',
        });

        expect(moved.path).toBe(`${user.home}/Desktop/moveddir`);
        expect(await entryAt(user, '/Desktop/moveddir/in.txt')).not.toBeNull();
    });

    it('refuses to move another user’s entry', async () => {
        const other = await makeUser();
        const foreign = await writeFile(
            other,
            `${other.home}/Documents/foreign.txt`,
            'x',
        );
        const destination = (await entryAt(user, '/Desktop'))!;

        const error = await caught(() =>
            fs.move(user.userId, {
                source: foreign,
                destinationParent: destination,
            }),
        );
        expect(error.statusCode).toBe(403);
        expect(error.legacyCode).toBe('forbidden');
    });

    it('refuses a non-directory destination and a move into its own subtree', async () => {
        const file = await writeFile(
            user,
            `${user.home}/Documents/notadir.txt`,
            'x',
        );
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/selfmove`,
        });
        const inner = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/selfmove/inner`,
        });

        const notADir = await caught(() =>
            fs.move(user.userId, {
                source: dir,
                destinationParent: file,
            }),
        );
        expect(notADir.legacyCode).toBe('dest_is_not_a_directory');

        const intoItself = await caught(() =>
            fs.move(user.userId, {
                source: dir,
                destinationParent: inner,
            }),
        );
        expect(intoItself.legacyCode).toBe('cannot_move_directory_into_itself');
    });

    it('handles a destination collision by conflict, overwrite or dedupe', async () => {
        const destination = (await entryAt(user, '/Desktop'))!;
        await writeFile(user, `${user.home}/Desktop/coll.txt`, 'existing');

        const source = await writeFile(
            user,
            `${user.home}/Documents/coll.txt`,
            'incoming',
        );
        const conflict = await caught(() =>
            fs.move(user.userId, { source, destinationParent: destination }),
        );
        expect(conflict.statusCode).toBe(409);
        // v1 wire contract: the GUI's replace/skip prompts key on this
        // code + entry_name; a generic 'conflict' makes them fail silently.
        expect(conflict.legacyCode).toBe('item_with_same_name_exists');
        expect(conflict.fields).toMatchObject({ entry_name: 'coll.txt' });

        const deduped = await fs.move(user.userId, {
            source,
            destinationParent: destination,
            dedupeName: true,
        });
        expect(deduped.path).toBe(`${user.home}/Desktop/coll (1).txt`);

        const overwriter = await writeFile(
            user,
            `${user.home}/Documents/coll.txt`,
            'winner',
        );
        const overwritten = await fs.move(user.userId, {
            source: overwriter,
            destinationParent: destination,
            overwrite: true,
        });
        expect(overwritten.path).toBe(`${user.home}/Desktop/coll.txt`);
        expect(await readBack(overwritten)).toBe('winner');
    });

    it('replaces metadata on the moved entry and can clear it', async () => {
        const destination = (await entryAt(user, '/Desktop'))!;
        const entry = await writeFile(
            user,
            `${user.home}/Documents/meta-move.txt`,
            'x',
            { metadata: { keep: true } },
        );

        const moved = await fs.move(user.userId, {
            source: entry,
            destinationParent: destination,
            newMetadata: {
                original_path: entry.path,
                objectKey: 'should-be-stripped',
            },
        });
        expect(JSON.parse(moved.metadata!)).toEqual({
            original_path: entry.path,
        });

        const documents = (await entryAt(user, '/Documents'))!;
        const cleared = await fs.move(user.userId, {
            source: moved,
            destinationParent: documents,
            newMetadata: null,
        });
        expect(cleared.metadata).toBeNull();
    });
});

describe('FSService copy', () => {
    let user: TestUser;
    beforeAll(async () => {
        user = await makeUser();
    });

    it('copies a file, duplicating the bytes under a new key', async () => {
        const source = await writeFile(
            user,
            `${user.home}/Documents/cp.txt`,
            'contents',
        );
        const destination = (await entryAt(user, '/Desktop'))!;

        const copy = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
        });

        expect(copy.uuid).not.toBe(source.uuid);
        expect(copy.path).toBe(`${user.home}/Desktop/cp.txt`);
        expect(copy.size).toBe(8);
        expect(await readBack(copy)).toBe('contents');
        // The source survives.
        expect(await readBack(source)).toBe('contents');
    });

    it('copies a directory tree, recreating children under the new root', async () => {
        await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/cpdir/sub`,
            createMissingParents: true,
        });
        await writeFile(user, `${user.home}/Documents/cpdir/a.txt`, 'a');
        await writeFile(user, `${user.home}/Documents/cpdir/sub/b.txt`, 'b');
        const source = (await entryAt(user, '/Documents/cpdir'))!;
        const destination = (await entryAt(user, '/Desktop'))!;

        const copy = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
            newName: 'cpdir-copy',
        });

        expect(copy.path).toBe(`${user.home}/Desktop/cpdir-copy`);
        const copiedLeaf = await entryAt(user, '/Desktop/cpdir-copy/sub/b.txt');
        expect(copiedLeaf).not.toBeNull();
        expect(await readBack(copiedLeaf!)).toBe('b');
    });

    it('clones an empty file without touching storage', async () => {
        const source = await fs.touch(user.userId, {
            path: `${user.home}/Documents/cp-empty.txt`,
        });
        const destination = (await entryAt(user, '/Desktop'))!;
        const copyObject = vi.spyOn(server.stores.s3Object, 'copyObject');

        const copy = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
        });

        expect(copy.size).toBe(0);
        expect(copy.bucket).toBeNull();
        expect(copyObject).not.toHaveBeenCalled();
        copyObject.mockRestore();
    });

    it('clones shortcuts and symlinks as metadata only', async () => {
        const documents = (await entryAt(user, '/Documents'))!;
        const destination = (await entryAt(user, '/Desktop'))!;
        const target = await writeFile(
            user,
            `${user.home}/Documents/cp-target.txt`,
            'x',
        );

        const shortcut = await fs.mkshortcut(user.userId, {
            parent: documents,
            name: 'cp-shortcut',
            target,
        });
        const copiedShortcut = await fs.copy(user.userId, {
            source: shortcut,
            destinationParent: destination,
        });
        expect(copiedShortcut.isShortcut).toBe(true);
        expect(copiedShortcut.shortcutTo).toBe(target.id);

        const symlink = await server.stores.fsEntry.createNonFileEntry({
            userId: user.userId,
            parent: documents,
            name: 'cp-symlink',
            kind: 'symlink',
            symlinkPath: `${user.home}/Documents/cp-target.txt`,
        });
        const copiedSymlink = await fs.copy(user.userId, {
            source: symlink,
            destinationParent: destination,
        });
        expect(copiedSymlink.isSymlink).toBe(true);
        expect(copiedSymlink.symlinkPath).toBe(
            `${user.home}/Documents/cp-target.txt`,
        );
    });

    it('refuses a non-directory destination and a copy into its own subtree', async () => {
        const file = await writeFile(
            user,
            `${user.home}/Documents/cp-notadir.txt`,
            'x',
        );
        const dir = await fs.mkdir(user.userId, {
            path: `${user.home}/Documents/cp-self/inner`,
            createMissingParents: true,
        });
        const parentDir = (await entryAt(user, '/Documents/cp-self'))!;

        expect(
            (
                await caught(() =>
                    fs.copy(user.userId, {
                        source: parentDir,
                        destinationParent: file,
                    }),
                )
            ).legacyCode,
        ).toBe('dest_is_not_a_directory');

        expect(
            (
                await caught(() =>
                    fs.copy(user.userId, {
                        source: parentDir,
                        destinationParent: dir,
                    }),
                )
            ).legacyCode,
        ).toBe('cannot_copy_directory_into_itself');

        expect(
            (
                await caught(() =>
                    fs.copy(user.userId, {
                        source: parentDir,
                        destinationParent: parentDir,
                    }),
                )
            ).legacyCode,
        ).toBe('cannot_copy_directory_into_itself');
    });

    it('handles a destination collision by conflict, overwrite or dedupe', async () => {
        const destination = (await entryAt(user, '/Desktop'))!;
        const source = await writeFile(
            user,
            `${user.home}/Documents/cp-coll.txt`,
            'source',
        );
        await writeFile(user, `${user.home}/Desktop/cp-coll.txt`, 'existing');

        const conflict = await caught(() =>
            fs.copy(user.userId, {
                source,
                destinationParent: destination,
            }),
        );
        expect(conflict.statusCode).toBe(409);
        // v1 wire contract: the GUI's replace/skip prompts key on this
        // code + entry_name; a generic 'conflict' makes them fail silently.
        expect(conflict.legacyCode).toBe('item_with_same_name_exists');
        expect(conflict.fields).toMatchObject({ entry_name: 'cp-coll.txt' });

        const deduped = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
            dedupeName: true,
        });
        expect(deduped.path).toBe(`${user.home}/Desktop/cp-coll (1).txt`);

        const overwritten = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
            overwrite: true,
        });
        expect(await readBack(overwritten)).toBe('source');
    });

    it('does not see a phantom collision after the occupant is renamed', async () => {
        const destination = (await entryAt(user, '/Desktop'))!;
        const source = await writeFile(
            user,
            `${user.home}/Documents/phantom.txt`,
            'src',
        );

        // First copy occupies Desktop/phantom.txt (and primes the path cache).
        const first = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
        });
        expect(first.path).toBe(`${user.home}/Desktop/phantom.txt`);

        // Renaming the occupant frees the path...
        await fs.rename(first, 'phantom-renamed.txt');

        // ...so an immediate re-copy must succeed. A stale path-cache entry
        // for the old name used to surface a phantom conflict here — and a
        // Replace against it would have deleted the renamed file.
        const second = await fs.copy(user.userId, {
            source,
            destinationParent: destination,
        });
        expect(second.path).toBe(`${user.home}/Desktop/phantom.txt`);
    });

    it('cleans up and reports 404 when the source object has vanished', async () => {
        const source = await writeFile(
            user,
            `${user.home}/Documents/cp-ghost.txt`,
            'x',
        );
        await server.stores.s3Object.deleteObject(
            source.bucket!,
            source.uuid,
            source.bucketRegion!,
        );
        const destination = (await entryAt(user, '/Desktop'))!;
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        const error = await caught(() =>
            fs.copy(user.userId, { source, destinationParent: destination }),
        );
        expect(error.statusCode).toBe(404);
        expect(error.legacyCode).toBe('subject_does_not_exist');
        expect(await entryAt(user, '/Documents/cp-ghost.txt')).toBeNull();

        consoleError.mockRestore();
    });
});

describe('FSService access checks', () => {
    let owner: TestUser;
    let stranger: TestUser;
    let file: FSEntry;

    beforeAll(async () => {
        owner = await makeUser();
        stranger = await makeUser();
        file = await writeFile(owner, `${owner.home}/Documents/acl.txt`, 'x');
    });

    it('allows the owner to write their own file', async () => {
        await expect(
            fs.checkFSAccess(file, owner.actor, 'write'),
        ).resolves.toBeUndefined();
    });

    it('hides another user’s file behind a 404 rather than leaking its existence', async () => {
        const error = await caught(() =>
            fs.checkFSAccess(file, stranger.actor, 'read'),
        );
        expect(error.statusCode).toBe(404);
        expect(error.legacyCode).toBe('subject_does_not_exist');
    });

    it('allows a stranger once the owner grants read on the entry', async () => {
        await server.services.permission.grantUserUserPermission(
            owner.actor,
            stranger.username,
            `fs:${file.uuid}:read`,
        );

        await expect(
            fs.checkFSAccess(file, stranger.actor, 'read'),
        ).resolves.toBeUndefined();

        // …but not to write it.
        const error = await caught(() =>
            fs.checkFSAccess(file, stranger.actor, 'write'),
        );
        expect(error.statusCode).toBe(403);
        expect(error.legacyCode).toBe('access_denied');
    });

    it('rejects a missing entry', async () => {
        const error = await caught(() =>
            fs.checkFSAccess(null as unknown as FSEntry, owner.actor, 'read'),
        );
        expect(error.statusCode).toBe(400);
    });
});

describe('FSService permission rules', () => {
    let user: TestUser;
    let file: FSEntry;

    beforeAll(async () => {
        user = await makeUser();
        file = await writeFile(user, `${user.home}/Documents/perm.txt`, 'x');
    });

    it('rewrites a path-addressed fs permission to its uuid form', async () => {
        await expect(
            server.services.permission.rewritePermission(
                `fs:${file.path}:read`,
            ),
        ).resolves.toBe(`fs:${file.uuid}:read`);
    });

    it('keeps the manage prefix when rewriting', async () => {
        const rewritten = await server.services.permission.rewritePermission(
            `manage:fs:${file.path}:write`,
        );
        expect(rewritten).toBe(`manage:fs:${file.uuid}:write`);
    });

    it('rejects a path that does not resolve to an entry', async () => {
        const error = await caught(() =>
            server.services.permission.rewritePermission(
                `fs:${user.home}/Documents/missing.txt:read`,
            ),
        );
        expect(error.statusCode).toBe(404);
        expect(error.legacyCode).toBe('subject_does_not_exist');
    });

    it('leaves uuid-addressed and non-fs permissions untouched', async () => {
        await expect(
            server.services.permission.rewritePermission(
                `fs:${file.uuid}:read`,
            ),
        ).resolves.toBe(`fs:${file.uuid}:read`);
        await expect(
            server.services.permission.rewritePermission('kv:read'),
        ).resolves.toBe('kv:read');
    });

    it('grants the owner every fs mode on their own entry', async () => {
        for (const mode of ['see', 'list', 'read', 'write']) {
            await expect(
                server.services.permission.check(
                    user.actor,
                    `fs:${file.uuid}:${mode}`,
                ),
            ).resolves.toBe(true);
        }
    });

    it('does not grant a different user anything on that entry', async () => {
        const stranger = await makeUser();
        await expect(
            server.services.permission.check(
                stranger.actor,
                `fs:${file.uuid}:read`,
            ),
        ).resolves.toBe(false);
    });

    it('does not treat a missing entry as owned', async () => {
        await expect(
            server.services.permission.check(user.actor, `fs:${uuidv4()}:read`),
        ).resolves.toBe(false);
    });

    it('gives an app implicit access inside its own AppData subtree only', async () => {
        const appUid = `app-${uuidv4()}`;
        const appDataRoot = await fs.mkdir(user.userId, {
            path: `${user.home}/AppData/${appUid}`,
        });
        const inside = await writeFile(
            user,
            `${user.home}/AppData/${appUid}/state.json`,
            '{}',
        );
        const outside = await writeFile(
            user,
            `${user.home}/Documents/outside.json`,
            '{}',
        );
        const appActor = makeActor({
            user: user.actor.user,
            app: { uid: appUid },
        });

        await expect(
            server.services.permission.check(
                appActor,
                `fs:${appDataRoot.uuid}:write`,
            ),
        ).resolves.toBe(true);
        await expect(
            server.services.permission.check(
                appActor,
                `fs:${inside.uuid}:write`,
            ),
        ).resolves.toBe(true);
        await expect(
            server.services.permission.check(
                appActor,
                `fs:${outside.uuid}:write`,
            ),
        ).resolves.toBe(false);
    });

    it('explodes a wide fs mode into the narrower ones plus manage', async () => {
        const higher = await server.services.permission.getHigherPermissions(
            `fs:${file.uuid}:see`,
        );

        expect(higher).toEqual(
            expect.arrayContaining([
                `fs:${file.uuid}:see`,
                `fs:${file.uuid}:list`,
                `fs:${file.uuid}:read`,
                `fs:${file.uuid}:write`,
                `manage:fs:${file.uuid}`,
            ]),
        );
    });

    it('does not widen the narrowest mode', async () => {
        const higher = await server.services.permission.getHigherPermissions(
            `fs:${file.uuid}:write`,
        );
        expect(higher).not.toContain(`fs:${file.uuid}:read`);
    });
});

// -- Cross-app AppData (app-data:<uid>:fs:<class>) ----------------------

describe('FSService — cross-app AppData access', () => {
    let owner: TestUser;
    let calendar: { id: number; uid: string };
    let contacts: { id: number; uid: string };
    let calendarActor: Actor;
    let contactsFile: FSEntry;
    let contactsRoot: FSEntry;

    const makeRealApp = async (
        ownerUserId: number,
        fields: Record<string, unknown> = {},
    ): Promise<{ id: number; uid: string }> => {
        const name = `fsx-${uuidv4()}`;
        return (await server.stores.app.create(
            {
                name,
                title: 'FS cross-app test',
                index_url: `https://${name}.test/`,
                ...fields,
            },
            { ownerUserId },
        )) as { id: number; uid: string };
    };

    const grant = (permission: string) =>
        runWithContext({ actor: owner.actor }, () =>
            server.services.permission.grantUserAppPermission(
                owner.actor,
                calendar.uid,
                permission,
            ),
        );

    const asCalendar = <T>(fn: () => T | Promise<T>) =>
        runWithContext({ actor: calendarActor }, fn);

    /** An AppData subtree with one file in it, as opening the app would leave. */
    const seedAppData = async (
        appUid: string,
        name = 'state.json',
    ): Promise<FSEntry> => {
        await fs.mkdir(owner.userId, {
            path: `${owner.home}/AppData/${appUid}`,
            createMissingParents: true,
        });
        return writeFile(
            owner,
            `${owner.home}/AppData/${appUid}/${name}`,
            '{}',
        );
    };

    beforeEach(async () => {
        owner = await makeUser();
        calendar = await makeRealApp(owner.userId);
        contacts = await makeRealApp(owner.userId);
        calendarActor = makeActor({
            user: owner.actor.user,
            app: { uid: calendar.uid, id: calendar.id },
        });
        contactsRoot = await fs.mkdir(owner.userId, {
            path: `${owner.home}/AppData/${contacts.uid}`,
            createMissingParents: true,
        });
        contactsFile = await writeFile(
            owner,
            `${owner.home}/AppData/${contacts.uid}/state.json`,
            '{"a":1}',
        );
    });

    it('gives no access without a grant', async () => {
        await expect(
            server.services.permission.check(
                calendarActor,
                `fs:${contactsFile.uuid}:read`,
            ),
        ).resolves.toBe(false);
    });

    it('reads another app’s AppData with the read class', async () => {
        await grant(appDataPermission(contacts.uid, 'fs', 'read'));
        await expect(
            server.services.permission.check(
                calendarActor,
                `fs:${contactsFile.uuid}:read`,
            ),
        ).resolves.toBe(true);
        // Read does not carry write.
        await expect(
            server.services.permission.check(
                calendarActor,
                `fs:${contactsFile.uuid}:write`,
            ),
        ).resolves.toBe(false);
    });

    it('covers the subtree root and its descendants', async () => {
        await grant(appDataPermission(contacts.uid, 'fs', 'read'));
        for (const uuid of [contactsRoot.uuid, contactsFile.uuid]) {
            await expect(
                server.services.permission.check(
                    calendarActor,
                    `fs:${uuid}:read`,
                ),
            ).resolves.toBe(true);
        }
    });

    it('refuses when the target app has opted out of sharing', async () => {
        const closed = await makeRealApp(owner.userId, {
            metadata: JSON.stringify({ share_app_data: false }),
        });
        const closedFile = await seedAppData(closed.uid);
        await grant(appDataPermission(closed.uid, 'fs', 'read'));
        await expect(
            server.services.permission.check(
                calendarActor,
                `fs:${closedFile.uuid}:read`,
            ),
        ).resolves.toBe(false);
    });

    it('does not let a grant for one app reach another', async () => {
        const third = await makeRealApp(owner.userId);
        const thirdFile = await seedAppData(third.uid);
        await grant(appDataPermission(contacts.uid, 'fs', 'read'));
        await expect(
            server.services.permission.check(
                calendarActor,
                `fs:${thirdFile.uuid}:read`,
            ),
        ).resolves.toBe(false);
    });

    // -- The delete guard ------------------------------------------------

    it('refuses delete, move, and rename with only the write class', async () => {
        await grant(appDataPermission(contacts.uid, 'fs', 'write'));
        // ACL would allow all three: they ask for `fs:write`, which the grant
        // satisfies. The guard is what separates them.
        await expect(
            asCalendar(() => fs.remove(owner.userId, { entry: contactsFile })),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            asCalendar(() => fs.rename(contactsFile, 'renamed.json')),
        ).rejects.toMatchObject({ statusCode: 403 });

        const desktop = (await server.stores.fsEntry.getEntryByPath(
            `${owner.home}/Desktop`,
        ))!;
        await expect(
            asCalendar(() =>
                fs.move(owner.userId, {
                    source: contactsFile,
                    destinationParent: desktop as unknown as FSEntry,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows delete once the delete class is granted', async () => {
        await grant(appDataPermission(contacts.uid, 'fs', 'delete'));
        await asCalendar(() =>
            fs.remove(owner.userId, { entry: contactsFile }),
        );
        expect(
            await server.stores.fsEntry.getEntryByPath(contactsFile.path),
        ).toBeFalsy();
    });

    it('allows rename once the delete class is granted', async () => {
        await grant(appDataPermission(contacts.uid, 'fs', 'delete'));
        const renamed = await asCalendar(() =>
            fs.rename(contactsFile, 'renamed.json'),
        );
        expect(renamed.name).toBe('renamed.json');
    });

    it('leaves an app’s own AppData deletable', async () => {
        // The guard must only fire on a *foreign* subtree, or every app loses
        // the ability to clean up after itself.
        const ownFile = await seedAppData(calendar.uid, 'own.json');
        await asCalendar(() => fs.remove(owner.userId, { entry: ownFile }));
        expect(
            await server.stores.fsEntry.getEntryByPath(ownFile.path),
        ).toBeFalsy();
    });

    it('leaves the owning user unaffected by the guard', async () => {
        // No app actor in context at all — the plain user path must not change.
        await fs.remove(owner.userId, { entry: contactsFile });
        expect(
            await server.stores.fsEntry.getEntryByPath(contactsFile.path),
        ).toBeFalsy();
    });

    it('refuses an access-token actor whose issuer is the granted app', async () => {
        // The token carries no `app` of its own, so a guard keyed on `actor.app`
        // would skip entirely — failing open where the read/write implicator
        // fails closed.
        await grant(appDataPermission(contacts.uid, 'fs', 'write'));
        const tokenActor = makeActor({
            user: owner.actor.user,
            accessToken: {
                uid: 'tok-cross-app',
                issuer: calendarActor,
                fullAccess: false,
            },
        });

        await expect(
            runWithContext({ actor: tokenActor }, () =>
                fs.remove(owner.userId, { entry: contactsFile }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lets system-initiated repair through the guard', async () => {
        // Ghost-fsentry cleanup runs during an unrelated caller's *read*, so it
        // is not that caller's action. Without the opt-out the repair is refused
        // and the orphaned row is never reaped.
        await grant(appDataPermission(contacts.uid, 'fs', 'read'));
        await asCalendar(() =>
            fs.remove(owner.userId, {
                entry: contactsFile,
                systemInitiated: true,
            }),
        );
        expect(
            await server.stores.fsEntry.getEntryByPath(contactsFile.path),
        ).toBeFalsy();
    });
});
