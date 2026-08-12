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
import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { configContainer } from '../../exports.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { S3ObjectStore } from './S3ObjectStore.js';

// ── Harness ─────────────────────────────────────────────────────────
//
// Two seams are used deliberately:
//
//  * the real in-process S3 server booted by `setupTestServer()` — proves
//    the commands this store builds are actually accepted, and that bytes
//    round-trip;
//  * a `send`-recording fake standing in for the regional S3 client (a real
//    external boundary) — the only way to reach upstream-failure, chunking
//    and multipart-lifecycle branches deterministically.

let server: PuterServer;
const region = 'us-west-2';
const bucket = 'puter-local';

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const store = (): S3ObjectStore => server.stores.s3Object as S3ObjectStore;

const readAll = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
};

const putObject = async (key: string, body: string | Buffer) => {
    await store().uploadFromServer(
        {
            bucket,
            objectKey: key,
            contentType: 'text/plain',
            body,
        },
        region,
    );
};

type SentCommand = { name: string; input: Record<string, unknown> };

/**
 * Build a store wired to a fake regional client. `respond` maps a command name
 * to the SDK response the store should see; anything unmapped resolves to
 * `{}`.
 */
const makeFakeStore = (options: {
    respond?: (command: SentCommand) => unknown;
    maxSingleUploadSize?: number;
    partSize?: number;
    config?: IConfig;
    /**
     * Presigning is local crypto against a real client's endpoint resolver, so
     * tests that need a signed URL borrow the live client for that half while
     * keeping the recording fake for `send`.
     */
    realPresign?: boolean;
}) => {
    const sent: SentCommand[] = [];
    const send = vi.fn(async (command: unknown) => {
        const entry: SentCommand = {
            name: (command as { constructor: { name: string } }).constructor
                .name,
            input: (command as { input: Record<string, unknown> }).input,
        };
        sent.push(entry);
        return (options.respond?.(entry) as object) ?? {};
    });
    const client = { send };
    const clients = {
        s3: {
            get: vi.fn(() => client),
            getForPresign: vi.fn(() =>
                options.realPresign ? server.clients.s3.get(region) : client,
            ),
            maxSingleUploadSize: options.maxSingleUploadSize ?? 10,
            partSize: options.partSize ?? 5,
        },
    };
    const fakeStore = new S3ObjectStore(
        options.config ?? ({ port: 0, extensions: [] } as IConfig),
        clients as unknown as ConstructorParameters<typeof S3ObjectStore>[1],
        {} as ConstructorParameters<typeof S3ObjectStore>[2],
    );
    return { store: fakeStore, sent, send, clients };
};

const names = (sent: SentCommand[]) => sent.map((command) => command.name);

describe('S3ObjectStore region and bucket fallbacks', () => {
    it('falls back to configured region then to the built-in default', () => {
        expect(store().resolveRegion('eu-central-1')).toBe('eu-central-1');

        const { store: configured } = makeFakeStore({
            config: { port: 0, extensions: [], s3_region: 'eu-west-1' },
        });
        expect(configured.resolveRegion(null)).toBe('eu-west-1');

        const { store: regionOnly } = makeFakeStore({
            config: { port: 0, extensions: [], region: 'ap-south-1' },
        });
        expect(regionOnly.resolveRegion(undefined)).toBe('ap-south-1');

        const { store: bare } = makeFakeStore({});
        expect(bare.resolveRegion(null)).toBe('us-west-2');
    });

    it('falls back to the configured bucket then to the built-in default', () => {
        const { store: configured } = makeFakeStore({
            config: { port: 0, extensions: [], s3_bucket: 'configured' },
        });
        expect(configured.resolveBucket('explicit')).toBe('explicit');
        expect(configured.resolveBucket(null)).toBe('configured');

        const { store: bare } = makeFakeStore({});
        expect(bare.resolveBucket(undefined)).toBe('puter-local');
    });

    it('exposes the client upload thresholds', () => {
        const { store: sized } = makeFakeStore({
            maxSingleUploadSize: 1234,
            partSize: 99,
        });
        expect(sized.getMaxSingleUploadSize()).toBe(1234);
        expect(sized.getMultipartPartSize()).toBe(99);
    });
});

describe('S3ObjectStore object round trips', () => {
    it('uploads, reads back, and reports the stored size', async () => {
        const key = uuidv4();
        await putObject(key, 'hello world');

        const result = await store().getObjectStream(
            { bucket, objectKey: key },
            region,
        );
        expect(result.contentLength).toBe(11);
        expect(result.contentType).toBe('text/plain');
        expect(result.contentRange).toBeNull();
        expect((await readAll(result.body)).toString()).toBe('hello world');

        await expect(store().headObjectSize(bucket, key, region)).resolves.toBe(
            11,
        );
    });

    it('serves a byte range and reports the content range', async () => {
        const key = uuidv4();
        await putObject(key, 'abcdefghij');

        const result = await store().getObjectStream(
            { bucket, objectKey: key, range: 'bytes=2-5' },
            region,
        );
        expect((await readAll(result.body)).toString()).toBe('cdef');
        expect(result.contentRange).toBe('bytes 2-5/10');
        expect(result.contentLength).toBe(4);
    });

    it('surfaces NoSuchKey for a missing object', async () => {
        const error = await store()
            .getObjectStream({ bucket, objectKey: uuidv4() }, region)
            .then(
                () => null,
                (e: unknown) => e,
            );
        expect((error as { name?: string })?.name).toBe('NoSuchKey');
    });

    it('deletes a single object', async () => {
        const key = uuidv4();
        await putObject(key, 'bye');
        await store().deleteObject(bucket, key, region);

        await expect(
            store().getObjectStream({ bucket, objectKey: key }, region),
        ).rejects.toMatchObject({ name: 'NoSuchKey' });
    });

    it('deletes a batch of objects and no-ops on an empty batch', async () => {
        const keys = [uuidv4(), uuidv4()];
        for (const key of keys) await putObject(key, 'x');

        await store().deleteObjects({ bucket, objectKeys: [] }, region);
        await store().deleteObjects({ bucket, objectKeys: keys }, region);

        for (const key of keys) {
            await expect(
                store().getObjectStream({ bucket, objectKey: key }, region),
            ).rejects.toMatchObject({ name: 'NoSuchKey' });
        }
    });

    it('server-side copies bytes to a new key without touching the source', async () => {
        const sourceKey = uuidv4();
        const destinationKey = uuidv4();
        await putObject(sourceKey, 'copy me');

        await store().copyObject(
            {
                sourceBucket: bucket,
                sourceKey,
                destinationBucket: bucket,
                destinationKey,
                contentType: 'text/plain',
                metadataDirective: 'REPLACE',
            },
            region,
        );

        const copied = await store().getObjectStream(
            { bucket, objectKey: destinationKey },
            region,
        );
        expect((await readAll(copied.body)).toString()).toBe('copy me');
        await expect(
            store().headObjectSize(bucket, sourceKey, region),
        ).resolves.toBe(7);
    });

    it('mints a presigned single-upload URL bound to the object key', async () => {
        const key = uuidv4();
        const before = Date.now();
        const result = await store().createSignedUploadUrl(
            {
                bucket,
                objectKey: key,
                size: 10,
                contentType: 'text/plain',
                uploadMode: 'single',
                expiresInSeconds: 900,
            },
            region,
        );

        expect(result.uploadMode).toBe('single');
        expect(result.url).toContain(key);
        expect(result.url).toContain('X-Amz-Signature');
        expect(result.expiresAt).toBeGreaterThanOrEqual(before + 900 * 1000);
        expect(result.multipartUploadId).toBeUndefined();
    });

    it('opens a real multipart upload when the declared size exceeds the single-upload limit', async () => {
        const key = uuidv4();
        // The effective part size is never below the single-upload limit.
        const partSize = store().getMaxSingleUploadSize();
        const result = await store().createSignedUploadUrl(
            {
                bucket,
                objectKey: key,
                size: partSize * 2 + 1,
                contentType: 'application/octet-stream',
                uploadMode: 'single',
                expiresInSeconds: 900,
            },
            region,
        );

        expect(result.uploadMode).toBe('multipart');
        expect(result.multipartUploadId).toBeTruthy();
        expect(result.multipartPartSize).toBe(partSize);
        expect(result.multipartPartCount).toBe(3);
        expect(result.multipartPartUrls).toHaveLength(3);
        expect(result.multipartPartUrls?.[0]?.partNumber).toBe(1);
        expect(result.multipartPartUrls?.[0]?.url).toContain('partNumber=1');
        expect(result.url).toBeUndefined();

        await store().abortMutipartUpload(
            result.multipartUploadId as string,
            region,
            bucket,
            key,
        );
    });

    it('clamps the presign expiry into the one-minute to one-hour window', async () => {
        const key = uuidv4();
        const tooShort = await store().createSignedUploadUrl(
            {
                bucket,
                objectKey: key,
                size: 1,
                contentType: 'text/plain',
                uploadMode: 'single',
                expiresInSeconds: 1,
            },
            region,
        );
        expect(tooShort.url).toContain('X-Amz-Expires=60');

        const tooLong = await store().createSignedUploadUrl(
            {
                bucket,
                objectKey: key,
                size: 1,
                contentType: 'text/plain',
                uploadMode: 'single',
                expiresInSeconds: 60 * 60 * 24,
            },
            region,
        );
        expect(tooLong.url).toContain('X-Amz-Expires=3600');
    });

    it('signs the requested part numbers of an existing multipart upload', async () => {
        const key = uuidv4();
        const opened = await store().createSignedUploadUrl(
            {
                bucket,
                objectKey: key,
                size: store().getMultipartPartSize() * 3,
                contentType: 'application/octet-stream',
                uploadMode: 'multipart',
                expiresInSeconds: 900,
            },
            region,
        );

        const partUrls = await store().createSignedMultipartPartUrls(
            {
                bucket,
                objectKey: key,
                multipartUploadId: opened.multipartUploadId as string,
                partNumbers: [2, 3],
                expiresInSeconds: 900,
            },
            region,
        );

        expect(partUrls.map((part) => part.partNumber)).toEqual([2, 3]);
        expect(partUrls[0]?.url).toContain('partNumber=2');

        await store().abortMutipartUpload(
            opened.multipartUploadId as string,
            region,
            bucket,
            key,
        );
    });

    it('stores an empty object when a multipart-sized stream yields no bytes', async () => {
        // Reuse the live S3 endpoint but shrink the thresholds so the
        // multipart branch is reachable without moving megabytes.
        const smallLimitStore = new S3ObjectStore(
            configContainer,
            {
                s3: {
                    get: () => server.clients.s3.get(region),
                    getForPresign: () => server.clients.s3.get(region),
                    maxSingleUploadSize: 8,
                    partSize: 8,
                },
            } as unknown as ConstructorParameters<typeof S3ObjectStore>[1],
            {} as ConstructorParameters<typeof S3ObjectStore>[2],
        );

        const key = uuidv4();
        await smallLimitStore.uploadFromServer(
            {
                bucket,
                objectKey: key,
                contentType: 'text/plain',
                // Unknown length on a Readable always takes the multipart path.
                body: Readable.from([]),
            },
            region,
        );

        await expect(store().headObjectSize(bucket, key, region)).resolves.toBe(
            0,
        );
    });
});

describe('S3ObjectStore upload sizing', () => {
    it('sends ContentLength derived from sizeHint for a stream of known length', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 100,
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Readable.from(['abc']),
                sizeHint: 3,
            },
            region,
        );

        expect(names(sent)).toEqual(['PutObjectCommand']);
        expect(sent[0]?.input.ContentLength).toBe(3);
    });

    it('prefers an explicit contentLength over sizeHint and over the buffer length', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 100,
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Buffer.from('abcdef'),
                contentLength: 6,
                sizeHint: 99,
            },
            region,
        );
        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k2',
                contentType: 'text/plain',
                body: 'abcdefgh',
            },
            region,
        );

        expect(sent[0]?.input.ContentLength).toBe(6);
        expect(sent[1]?.input.ContentLength).toBe(8);
    });

    it('omits ContentLength when a stream has no declared length, and goes multipart', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 100,
            partSize: 100,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag-1' },
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Readable.from(['abc']),
            },
            region,
        );

        expect(names(sent)).toEqual([
            'CreateMultipartUploadCommand',
            'UploadPartCommand',
            'CompleteMultipartUploadCommand',
        ]);
    });

    it('splits a buffer body into parts of the resolved part size', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag' },
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Buffer.from('0123456789'),
            },
            region,
        );

        const parts = sent.filter(
            (command) => command.name === 'UploadPartCommand',
        );
        expect(parts.map((part) => part.input.PartNumber)).toEqual([1, 2, 3]);
        expect(parts.map((part) => part.input.ContentLength)).toEqual([
            4, 4, 2,
        ]);
        const complete = sent.at(-1);
        expect(complete?.name).toBe('CompleteMultipartUploadCommand');
        expect(
            (complete?.input.MultipartUpload as { Parts: unknown[] }).Parts,
        ).toHaveLength(3);
    });

    it('splits a string body the same way as a buffer', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag' },
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: '0123456789',
                contentLength: 10,
            },
            region,
        );

        expect(
            sent
                .filter((command) => command.name === 'UploadPartCommand')
                .map((part) => part.input.ContentLength),
        ).toEqual([4, 4, 2]);
    });

    it('never uses a part size below the single-upload limit', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 8,
            partSize: 2,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag' },
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Buffer.from('0123456789abcdef'),
            },
            region,
        );

        expect(
            sent
                .filter((command) => command.name === 'UploadPartCommand')
                .map((part) => part.input.ContentLength),
        ).toEqual([8, 8]);
    });
});

describe('S3ObjectStore failure handling', () => {
    it('aborts the multipart upload and rethrows when a part upload fails', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) => {
                if (command.name === 'CreateMultipartUploadCommand') {
                    return { UploadId: 'upload-1' };
                }
                if (command.name === 'UploadPartCommand') {
                    throw new Error('part rejected');
                }
                return {};
            },
        });

        await expect(
            fake.uploadFromServer(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    body: Buffer.from('0123456789'),
                },
                region,
            ),
        ).rejects.toThrow('part rejected');
        expect(names(sent)).toContain('AbortMultipartUploadCommand');
    });

    it('fails when the multipart upload cannot be initialized', async () => {
        const { store: fake } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: () => ({}),
        });

        await expect(
            fake.uploadFromServer(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    body: Buffer.from('0123456789'),
                },
                region,
            ),
        ).rejects.toThrow('Failed to initialize multipart upload');
    });

    it('fails when a part upload comes back without an ETag', async () => {
        const { store: fake } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : {},
        });

        await expect(
            fake.uploadFromServer(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    body: Buffer.from('0123456789'),
                },
                region,
            ),
        ).rejects.toThrow('Multipart upload returned no ETag for part 1');
    });

    it('rejects a body type it cannot chunk', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : {},
        });

        await expect(
            fake.uploadFromServer(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    body: { nope: true } as never,
                    contentLength: 10,
                },
                region,
            ),
        ).rejects.toThrow('Unsupported body type for multipart upload');
        expect(names(sent)).toContain('AbortMultipartUploadCommand');
    });

    it('rejects an unchunkable item inside a Readable body', async () => {
        const { store: fake } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag' },
        });

        await expect(
            fake.uploadFromServer(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    body: Readable.from([{ nope: true }], {
                        objectMode: true,
                    }),
                },
                region,
            ),
        ).rejects.toThrow('Unsupported chunk type for multipart upload');
    });

    it('accepts a Uint8Array chunk from a stream', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag' },
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Readable.from([new Uint8Array([1, 2, 3, 4, 5, 6])], {
                    objectMode: true,
                }),
            },
            region,
        );

        expect(
            sent
                .filter((command) => command.name === 'UploadPartCommand')
                .map((part) => part.input.ContentLength),
        ).toEqual([4, 2]);
    });

    it('aborts every multipart upload it opened when one region entry fails', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 1,
            realPresign: true,
            respond: (command) => {
                if (command.name !== 'CreateMultipartUploadCommand') return {};
                if (command.input.Key === 'bad') throw new Error('s3 refused');
                return { UploadId: `upload-${String(command.input.Key)}` };
            },
        });

        await expect(
            fake.batchCreateSignedUploadUrls(
                [
                    {
                        bucket,
                        objectKey: 'good',
                        size: 100,
                        contentType: 'text/plain',
                        uploadMode: 'multipart',
                        expiresInSeconds: 900,
                    },
                    {
                        bucket,
                        objectKey: 'bad',
                        size: 100,
                        contentType: 'text/plain',
                        uploadMode: 'multipart',
                        expiresInSeconds: 900,
                    },
                ],
                region,
            ),
        ).rejects.toThrow('s3 refused');

        const aborted = sent.filter(
            (command) => command.name === 'AbortMultipartUploadCommand',
        );
        expect(aborted.map((command) => command.input.Key)).toEqual(['good']);
    });

    it('leaves already-signed single uploads alone while aborting the failed multipart sibling', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 1000,
            realPresign: true,
            respond: (command) => {
                if (command.name !== 'CreateMultipartUploadCommand') return {};
                throw new Error('s3 refused');
            },
        });

        await expect(
            fake.batchCreateSignedUploadUrls(
                [
                    {
                        bucket,
                        objectKey: 'small',
                        size: 10,
                        contentType: 'text/plain',
                        uploadMode: 'single',
                        expiresInSeconds: 900,
                    },
                    {
                        bucket,
                        objectKey: 'big',
                        size: 5000,
                        contentType: 'text/plain',
                        uploadMode: 'single',
                        expiresInSeconds: 900,
                    },
                ],
                region,
            ),
        ).rejects.toThrow('s3 refused');

        expect(names(sent)).toEqual(['CreateMultipartUploadCommand']);
    });

    it('aborts the upload it just opened when part-url signing fails', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 1,
            // No real presign client: `getSignedUrl` fails after the
            // multipart upload has already been created upstream.
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : {},
        });

        await expect(
            fake.batchCreateSignedUploadUrls(
                [
                    {
                        bucket,
                        objectKey: 'k',
                        size: 100,
                        contentType: 'text/plain',
                        uploadMode: 'multipart',
                        expiresInSeconds: 900,
                    },
                ],
                region,
            ),
        ).rejects.toThrow();

        expect(
            sent.filter(
                (command) => command.name === 'AbortMultipartUploadCommand',
            ),
        ).toHaveLength(1);
    });

    it('swallows a failing abort during multipart cleanup and still reports the original error', async () => {
        const { store: fake } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) => {
                if (command.name === 'CreateMultipartUploadCommand') {
                    return { UploadId: 'upload-1' };
                }
                if (command.name === 'UploadPartCommand') {
                    throw new Error('part rejected');
                }
                throw new Error('abort also failed');
            },
        });

        await expect(
            fake.uploadFromServer(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    body: Buffer.from('0123456789'),
                },
                region,
            ),
        ).rejects.toThrow('part rejected');
    });

    it('coalesces stream chunks across part boundaries and skips empty ones', async () => {
        const { store: fake, sent } = makeFakeStore({
            maxSingleUploadSize: 4,
            partSize: 4,
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : { ETag: 'etag' },
        });

        await fake.uploadFromServer(
            {
                bucket,
                objectKey: 'k',
                contentType: 'text/plain',
                body: Readable.from(
                    [
                        Buffer.from('ab'),
                        Buffer.alloc(0),
                        Buffer.from('cde'),
                        Buffer.from('fghi'),
                    ],
                    { objectMode: true },
                ),
            },
            region,
        );

        expect(
            sent
                .filter((command) => command.name === 'UploadPartCommand')
                .map((part) => part.input.ContentLength),
        ).toEqual([4, 4, 1]);
    });

    it('reports a generic failure when the rejection carries no Error', async () => {
        const { store: fake } = makeFakeStore({
            maxSingleUploadSize: 1,
            respond: (command) => {
                if (command.name === 'CreateMultipartUploadCommand') {
                    // eslint-disable-next-line @typescript-eslint/only-throw-error
                    throw 'plain string rejection';
                }
                return {};
            },
        });

        await expect(
            fake.batchCreateSignedUploadUrls(
                [
                    {
                        bucket,
                        objectKey: 'k',
                        size: 100,
                        contentType: 'text/plain',
                        uploadMode: 'multipart',
                        expiresInSeconds: 900,
                    },
                ],
                region,
            ),
        ).rejects.toThrow('Failed to create signed upload urls');
    });

    it('fails the batch when the multipart upload id is missing', async () => {
        const { store: fake } = makeFakeStore({
            maxSingleUploadSize: 1,
            respond: () => ({}),
        });

        await expect(
            fake.batchCreateSignedUploadUrls(
                [
                    {
                        bucket,
                        objectKey: 'k',
                        size: 100,
                        contentType: 'text/plain',
                        uploadMode: 'multipart',
                        expiresInSeconds: 900,
                    },
                ],
                region,
            ),
        ).rejects.toThrow('Failed to initialize multipart upload');
    });

    it('rejects a getObject response that carries no body', async () => {
        const { store: fake } = makeFakeStore({ respond: () => ({}) });

        await expect(
            fake.getObjectStream({ bucket, objectKey: 'k' }, region),
        ).rejects.toThrow('S3 getObject returned no body');
    });

    it('adapts a web stream body into a Node readable', async () => {
        const { store: fake } = makeFakeStore({
            respond: () => ({
                Body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('web'));
                        controller.close();
                    },
                }),
                ContentLength: 3,
            }),
        });

        const result = await fake.getObjectStream(
            { bucket, objectKey: 'k' },
            region,
        );
        expect((await readAll(result.body)).toString()).toBe('web');
        expect(result.contentType).toBeNull();
        expect(result.etag).toBeNull();
        expect(result.lastModified).toBeNull();
    });

    it('reports a null size when S3 omits ContentLength on HEAD', async () => {
        const { store: fake } = makeFakeStore({ respond: () => ({}) });
        await expect(
            fake.headObjectSize(bucket, 'k', region),
        ).resolves.toBeNull();
    });
});

describe('S3ObjectStore batching and command shapes', () => {
    it('chunks deletes at the 1000-key S3 limit', async () => {
        const { store: fake, sent } = makeFakeStore({});
        const objectKeys = Array.from({ length: 1001 }, (_, i) => `k${i}`);

        await fake.deleteObjects({ bucket, objectKeys }, region);

        expect(names(sent)).toEqual([
            'DeleteObjectsCommand',
            'DeleteObjectsCommand',
        ]);
        const chunkSizes = sent.map(
            (command) =>
                (command.input.Delete as { Objects: unknown[] }).Objects.length,
        );
        expect(chunkSizes).toEqual([1000, 1]);
    });

    it('url-encodes the source key of a copy', async () => {
        const { store: fake, sent } = makeFakeStore({});

        await fake.copyObject(
            {
                sourceBucket: 'src-bucket',
                sourceKey: 'a b/c+d',
                destinationBucket: 'dst-bucket',
                destinationKey: 'dst',
            },
            region,
        );

        expect(sent[0]?.input.CopySource).toBe('src-bucket/a%20b%2Fc%2Bd');
        expect(sent[0]?.input.ContentType).toBeUndefined();
        expect(sent[0]?.input.MetadataDirective).toBeUndefined();
    });

    it('sorts multipart completion parts by part number', async () => {
        const { store: fake, sent } = makeFakeStore({});

        await fake.completeMultipartUpload(
            {
                bucket,
                objectKey: 'k',
                multipartUploadId: 'upload-1',
                parts: [
                    { partNumber: 3, etag: 'c' },
                    { partNumber: 1, etag: 'a' },
                    { partNumber: 2, etag: 'b' },
                ],
            },
            region,
        );

        expect(
            (sent[0]?.input.MultipartUpload as { Parts: unknown[] }).Parts,
        ).toEqual([
            { PartNumber: 1, ETag: 'a' },
            { PartNumber: 2, ETag: 'b' },
            { PartNumber: 3, ETag: 'c' },
        ]);
    });

    it('sends the upload id when aborting', async () => {
        const { store: fake, sent } = makeFakeStore({});

        await fake.abortMutipartUpload('upload-1', region, bucket, 'k');

        expect(sent[0]).toMatchObject({
            name: 'AbortMultipartUploadCommand',
            input: { Bucket: bucket, Key: 'k', UploadId: 'upload-1' },
        });
    });
});

describe('S3ObjectStore request accounting', () => {
    const opsFor = async (fn: () => Promise<unknown>) => {
        const req = {} as Request;
        await runWithContext({ req }, fn);
        return req.storageOps;
    };

    it('counts a server-side upload, read and copy by class', async () => {
        const key = `ops-${uuidv4()}`;
        const ops = await opsFor(async () => {
            await putObject(key, 'hello');
            const read = await store().getObjectStream(
                { bucket, objectKey: key },
                region,
            );
            await readAll(read.body);
            await store().headObjectSize(bucket, key, region);
            await store().copyObject(
                {
                    sourceBucket: bucket,
                    sourceKey: key,
                    destinationBucket: bucket,
                    destinationKey: `${key}-copy`,
                },
                region,
            );
        });

        expect(ops).toEqual({ write: 2, read: 2 });
    });

    it('counts removals separately, one per batch request', async () => {
        const key = `ops-${uuidv4()}`;
        const ops = await opsFor(async () => {
            await putObject(key, 'hello');
            await store().deleteObject(bucket, key, region);
            await store().deleteObjects(
                { bucket, objectKeys: [`${key}-a`, `${key}-b`] },
                region,
            );
            await store().deleteObjects({ bucket, objectKeys: [] }, region);
        });

        expect(ops).toEqual({ write: 1, delete: 2 });
    });

    it('counts the uploads a signed multipart hands off to the client', async () => {
        const { store: fake } = makeFakeStore({
            respond: (command) =>
                command.name === 'CreateMultipartUploadCommand'
                    ? { UploadId: 'upload-1' }
                    : {},
            maxSingleUploadSize: 10,
            partSize: 10,
            realPresign: true,
        });

        const ops = await opsFor(() =>
            fake.batchCreateSignedUploadUrls(
                [
                    {
                        bucket,
                        objectKey: 'k',
                        contentType: 'text/plain',
                        size: 25,
                        uploadMode: 'multipart',
                        expiresInSeconds: 300,
                    },
                ],
                region,
            ),
        );

        // One to open the upload, then one per part the client will send.
        expect(ops).toEqual({ write: 4 });
    });

    it('counts a signed single upload the client makes directly', async () => {
        const ops = await opsFor(() =>
            store().createSignedUploadUrl(
                {
                    bucket,
                    objectKey: 'k',
                    contentType: 'text/plain',
                    size: 1,
                    uploadMode: 'single',
                    expiresInSeconds: 300,
                },
                region,
            ),
        );

        expect(ops).toEqual({ write: 1 });
    });

    it('tallies nothing outside a request', async () => {
        const key = `ops-${uuidv4()}`;
        await expect(putObject(key, 'hello')).resolves.not.toThrow();
    });
});
