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
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSService } from './FSService.js';

// Multipart sessions against the in-process object store: every part is
// really PUT through its signed URL, so completion runs for real.

let server: PuterServer;
let fs: FSService;
let userId: number;
let home: string;

beforeAll(async () => {
    server = await setupTestServer();
    fs = server.services.fs as unknown as FSService;
    const username = `fsm-${Math.random().toString(36).slice(2, 10)}`;
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
    userId = created.id;
    home = `/${username}`;
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

type Started = Awaited<ReturnType<FSService['startUrlWrite']>>;

/**
 * PUTs `body` through the session's part URLs; returns the parts to complete
 * with.
 */
const putParts = async (started: Started, body: string) => {
    const partSize = started.multipartPartSize!;
    const parts: { partNumber: number; etag: string }[] = [];
    for (const { partNumber, url } of started.multipartPartUrls!) {
        const offset = (partNumber - 1) * partSize;
        const uploaded = await fetch(url, {
            method: 'PUT',
            body: body.slice(offset, offset + partSize),
        });
        expect(uploaded.status).toBe(200);
        parts.push({ partNumber, etag: uploaded.headers.get('etag')! });
    }
    return parts;
};

const readBack = async (entry: FSEntry): Promise<string> => {
    const result = await fs.readContent(entry);
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
};

const sessionStatus = async (sessionId: string) =>
    (await server.stores.fsEntry.getPendingEntryBySessionId(sessionId))?.status;

const caught = async (run: () => Promise<unknown>): Promise<Error> => {
    let error: unknown = null;
    try {
        await run();
    } catch (e) {
        error = e;
    }
    expect(error).toBeInstanceOf(Error);
    return error as Error;
};

describe('FSService multipart completion', () => {
    it('assembles the uploaded parts into the file', async () => {
        const path = `${home}/Documents/mp-one.txt`;
        const body = 'multipart body';
        const started = await fs.startUrlWrite(userId, {
            fileMetadata: { path, size: body.length },
            uploadMode: 'multipart',
        });
        expect(started.uploadMode).toBe('multipart');
        const parts = await putParts(started, body);

        const completed = await fs.completeUrlWrite(userId, {
            uploadId: started.sessionId,
            parts,
        });

        expect(completed.fsEntry).toMatchObject({ path, size: body.length });
        expect(await readBack(completed.fsEntry)).toBe(body);
        expect(await sessionStatus(started.sessionId)).toBe('completed');
    });

    it('completes a multipart and a single upload in one batch', async () => {
        const multipartPath = `${home}/Documents/mp-batch.txt`;
        const singlePath = `${home}/Documents/mp-batch-single.txt`;
        const [multipart, single] = await fs.batchStartUrlWrites(userId, [
            {
                fileMetadata: { path: multipartPath, size: 9 },
                uploadMode: 'multipart',
            },
            { fileMetadata: { path: singlePath, size: 5 } },
        ]);
        const parts = await putParts(multipart!, 'part-data');
        await fetch(single!.url!, { method: 'PUT', body: 'small' });

        const completed = await fs.batchCompleteUrlWrite(userId, [
            { uploadId: multipart!.sessionId, parts },
            { uploadId: single!.sessionId },
        ]);

        expect(completed.map((item) => item.fsEntry.path)).toEqual([
            multipartPath,
            singlePath,
        ]);
        expect(await readBack(completed[0]!.fsEntry)).toBe('part-data');
        expect(await readBack(completed[1]!.fsEntry)).toBe('small');
    });

    it('fails the batch and its session when the object store refuses the parts', async () => {
        const path = `${home}/Documents/mp-refused.txt`;
        const [started] = await fs.batchStartUrlWrites(userId, [
            { fileMetadata: { path, size: 4 }, uploadMode: 'multipart' },
        ]);
        // Nothing was uploaded, so the part named here does not exist.
        const error = await caught(() =>
            fs.batchCompleteUrlWrite(userId, [
                {
                    uploadId: started!.sessionId,
                    parts: [{ partNumber: 1, etag: '"missing"' }],
                },
            ]),
        );

        expect(error).not.toBeInstanceOf(HttpError);
        expect(await sessionStatus(started!.sessionId)).toBe('failed');
        expect(await server.stores.fsEntry.getEntryByPath(path)).toBeNull();
    });
});

describe('FSService batch-signed overwrite', () => {
    it('fails the session when its target moved after the url was signed', async () => {
        const path = `${home}/Documents/staged-batch-moved.txt`;
        const { fsEntry: existing } = await fs.write(userId, {
            fileMetadata: { path, size: 11, contentType: 'text/plain' },
            fileContent: 'OLD-CONTENT',
        });
        const [started] = await fs.batchStartUrlWrites(userId, [
            { fileMetadata: { path, size: 3, overwrite: true } },
        ]);
        await fetch(started!.url!, { method: 'PUT', body: 'NEW' });
        const documents = await server.stores.fsEntry.getEntryByPath(
            `${home}/Documents`,
        );
        const moved = await fs.move(userId, {
            source: existing,
            destinationParent: documents!,
            newName: 'staged-batch-moved-away.txt',
        });

        const error = await caught(() =>
            fs.batchCompleteUrlWrite(userId, [
                { uploadId: started!.sessionId },
            ]),
        );

        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(409);
        expect(await sessionStatus(started!.sessionId)).toBe('failed');
        // The file that moved away keeps its bytes.
        expect(await readBack(moved)).toBe('OLD-CONTENT');
    });
});

describe('FSService upload session lookups', () => {
    it('answers a lookup of no sessions without reading any', async () => {
        const read = vi.spyOn(
            server.stores.fsEntry,
            'getPendingEntriesBySessionIds',
        );

        expect(await fs.getUploadSessions(userId, [])).toEqual([]);
        expect(read).not.toHaveBeenCalled();
    });

    it('refuses to sign parts for a session that already failed', async () => {
        const started = await fs.startUrlWrite(userId, {
            fileMetadata: { path: `${home}/Documents/mp-failed.txt`, size: 4 },
            uploadMode: 'multipart',
        });
        await fs.abortUrlWrite(userId, started.sessionId);
        const status = await sessionStatus(started.sessionId);
        expect(status).not.toBe('pending');

        const error = await caught(() =>
            fs.signMultipartParts(userId, {
                uploadId: started.sessionId,
                partNumbers: [1],
            }),
        );

        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(409);
        expect(error.message).toBe(
            `Upload session is not pending (status=${status})`,
        );
    });
});

describe('FSService batch target resolution', () => {
    const entryAt = (path: string) =>
        server.stores.fsEntry.getEntryByPath(path, {
            useTryHardRead: true,
            skipCache: true,
        });

    it('rejects two new files aimed at one path', async () => {
        const path = `${home}/Documents/twice.txt`;
        const item = (fileContent: string) => ({
            fileMetadata: { path, size: 1 },
            fileContent,
        });

        const error = await caught(() =>
            fs.batchWrites(userId, [item('A'), item('B')]),
        );

        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(409);
        expect(error.message).toBe(
            'Batch contains duplicate target path: twice.txt',
        );
        expect(await entryAt(path)).toBeNull();
    });

    it('numbers deduped names past the ones the same batch already took', async () => {
        const item = (fileContent: string) => ({
            fileMetadata: {
                path: `${home}/Documents/dup.txt`,
                size: 1,
                dedupeName: true,
            },
            fileContent,
        });

        const written = await fs.batchWrites(userId, [
            item('A'),
            item('B'),
            item('C'),
        ]);

        expect(written.map((result) => result.fsEntry.name)).toEqual([
            'dup.txt',
            'dup (1).txt',
            'dup (2).txt',
        ]);
        expect(await readBack(written[2]!.fsEntry)).toBe('C');
    });

    it('refuses a directory request for a missing directory unless asked to create it', async () => {
        const path = `${home}/Documents/batch-dir`;
        const request = (createMissingParents: boolean) => ({
            fileMetadata: { path, size: 0, createMissingParents },
            directory: true,
        });

        const error = await caught(() =>
            fs.batchStartUrlWrites(userId, [request(false)]),
        );
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(404);
        expect(await entryAt(path)).toBeNull();

        await fs.batchStartUrlWrites(userId, [request(true)]);
        expect(await entryAt(path)).toMatchObject({ path, isDir: true });
    });
});
