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
import { HttpError } from '../../core/http/HttpError.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { encodeCursor } from '../../util/pagination.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSEntry, FSEntryCreateInput } from './FSEntry.js';
import { FSEntryStore } from './FSEntryStore.js';

let server: PuterServer;
let store: FSEntryStore;

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.fsEntry as FSEntryStore;
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

interface StoreUser {
    userId: number;
    home: string;
}

const makeUser = async (): Promise<StoreUser> => {
    const username = `fsx-${Math.random().toString(36).slice(2, 10)}`;
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
    return { userId: created.id, home: `/${username}` };
};

const createFile = async (
    user: StoreUser,
    path: string,
    over: Partial<FSEntryCreateInput> = {},
): Promise<FSEntry> =>
    store.createEntry({
        userId: user.userId,
        uuid: uuidv4(),
        path,
        size: 1,
        contentType: 'text/plain',
        bucket: 'puter-local',
        bucketRegion: 'us-west-2',
        ...over,
    });

const caught = async (run: () => Promise<unknown>): Promise<HttpError> => {
    let error: unknown = null;
    try {
        await run();
    } catch (e) {
        error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
};

describe('FSEntryStore held bytes', () => {
    it('sums the sizes of everything one account holds', async () => {
        const user = await makeUser();
        expect(await store.getHeldBytes(user.userId)).toBe(0);

        await createFile(user, `${user.home}/Documents/a.bin`, { size: 40 });
        await createFile(user, `${user.home}/Documents/b.bin`, { size: 2 });

        expect(await store.getHeldBytes(user.userId)).toBe(42);
    });

    it('reads several accounts at once, with zero for one holding nothing', async () => {
        const holder = await makeUser();
        const other = await makeUser();
        const empty = await makeUser();
        await createFile(holder, `${holder.home}/Documents/a.bin`, {
            size: 300,
        });
        await createFile(other, `${other.home}/Documents/b.bin`, { size: 5 });
        const unknownId = 2_000_000_000;

        const held = await store.getHeldBytesForUsers([
            holder.userId,
            other.userId,
            holder.userId,
            empty.userId,
            unknownId,
            'not-an-id' as unknown as number,
        ]);

        expect([...held.entries()]).toEqual([
            [holder.userId, 300],
            [other.userId, 5],
            [empty.userId, 0],
            [unknownId, 0],
        ]);
    });

    it('answers for no accounts without a query', async () => {
        const read = vi.spyOn(server.clients.db, 'read');

        expect((await store.getHeldBytesForUsers([])).size).toBe(0);
        expect(
            (await store.getHeldBytesForUsers(null as unknown as number[]))
                .size,
        ).toBe(0);
        expect(read).not.toHaveBeenCalled();
    });

    it('caps the allowance at the configured device storage when storage is unlimited', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/a.bin`, { size: 9 });
        const unlimited = new FSEntryStore(
            {
                port: 0,
                extensions: [],
                is_storage_limited: false,
                available_device_storage: 12_345,
            },
            server.clients as ConstructorParameters<typeof FSEntryStore>[1],
            server.stores as ConstructorParameters<typeof FSEntryStore>[2],
        );

        expect(await unlimited.getUserStorageAllowance(user.userId)).toEqual({
            curr: 9,
            max: 12_345,
        });
    });
});

describe('FSEntryStore unusable cache', () => {
    it('reads the row when the cached entry is not valid JSON', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/c.txt`);
        await server.clients.redis.set(
            `prodfsv2:fsentry:uuid:${file.uuid}`,
            '{"uuid":',
        );

        const entry = await store.getEntryByUuid(file.uuid);

        expect(entry).toMatchObject({ uuid: file.uuid, path: file.path });
        // The read repaired the cache.
        expect(
            JSON.parse(
                (await server.clients.redis.get(
                    `prodfsv2:fsentry:uuid:${file.uuid}`,
                ))!,
            ),
        ).toMatchObject({ uuid: file.uuid });
    });

    it('reads the row when the cache cannot be reached', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/d.txt`);
        vi.spyOn(server.clients.redis, 'get').mockRejectedValue(
            new Error('cache down'),
        );

        expect(await store.getEntryById(file.id)).toMatchObject({
            uuid: file.uuid,
            path: file.path,
        });
    });
});

describe('FSEntryStore lookups and directory resolution edges', () => {
    it('answers a lookup of no paths with an empty list', async () => {
        const user = await makeUser();
        expect(await store.getEntriesByPathsForUser(user.userId, [])).toEqual(
            [],
        );
    });

    it('refuses to create directories beneath a file', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/leaf.txt`);

        const error = await caught(() =>
            store.ensureDirectoriesForUserWithCreated(user.userId, [
                { path: `${file.path}/sub/dir`, createPaths: true },
            ]),
        );

        expect(error.statusCode).toBe(409);
        expect(error.message).toBe('Path is not a directory: leaf.txt');
        expect(await store.getEntryByPath(`${file.path}/sub`)).toBeNull();
    });

    it('refuses to create the root directory', async () => {
        const user = await makeUser();

        const error = await caught(() =>
            store.resolveParentDirectory(user.userId, '/', true),
        );

        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Cannot create root directory');
    });

    it('rejects a descendants cursor that pins an unknown sort field', async () => {
        const user = await makeUser();

        const error = await caught(() =>
            store.listDescendantsPage(user.userId, user.home, {
                maxDepth: 2,
                cursor: encodeCursor({ v: 'x', s: 'owner', o: 'asc' }),
            }),
        );

        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('unsupported sort field');
    });
});

describe('FSEntryStore thumbnail batch', () => {
    it('reports a lone update whose write fails as rejected', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/t.png`);
        const failure = new Error('write refused');
        vi.spyOn(server.clients.db, 'write').mockRejectedValueOnce(failure);

        const results = await store.updateEntryThumbnailsByUuidForUser(
            user.userId,
            [{ uuid: file.uuid, thumbnail: 'data:image/png;base64,AA==' }],
        );

        expect(results).toEqual([{ status: 'rejected', reason: failure }]);
        vi.restoreAllMocks();
        const [row] = (await server.clients.db.read(
            'SELECT thumbnail FROM fsentries WHERE uuid = ?',
            [file.uuid],
        )) as Array<{ thumbnail: string | null }>;
        expect(row?.thumbnail).toBeNull();
    });
});

describe('FSEntryStore created timestamp', () => {
    it('touches only the created time when asked to', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/born.txt`);
        await server.clients.db.write(
            'UPDATE fsentries SET accessed = 11, modified = 12, created = 13 WHERE uuid = ?',
            [file.uuid],
        );
        await store.invalidateEntryCacheByUuid(file.uuid);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2030-01-02T03:04:05Z'));
        const now = Math.floor(Date.now() / 1000);

        const touched = await store.touchEntryTimestamps(file.uuid, {
            setCreated: true,
        });

        expect(touched).toMatchObject({
            accessed: 11,
            modified: 12,
            created: now,
        });
        const [row] = (await server.clients.db.read(
            'SELECT accessed, modified, created FROM fsentries WHERE uuid = ?',
            [file.uuid],
        )) as Array<Record<string, number>>;
        expect(row).toMatchObject({ accessed: 11, modified: 12, created: now });
    });
});
