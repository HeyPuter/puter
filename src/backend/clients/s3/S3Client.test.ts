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

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types';
import { S3Client } from './S3Client';

const LOCAL_BUCKET = 'puter-local';

/**
 * The multipart helper takes its command sender as a parameter, so the failure
 * paths can be driven without a live endpoint.
 */
type S3Internals = {
    awsConfig: { endpoint?: string };
    migrateLegacyStorage(opts?: {
        bucket?: string;
        legacyPath?: string;
    }): Promise<{ migratedFileCount: number; scannedEntryCount: number }>;
    uploadMultipart(args: {
        bucket: string;
        client: { send: (command: unknown) => Promise<unknown> };
        filePath: string;
        fileSize: number;
        key: string;
    }): Promise<void>;
};

const internals = (client: S3Client) => client as unknown as S3Internals;

const localConfig = (): IConfig =>
    ({
        port: 0,
        extensions: [],
        s3: { localConfig: { inMemory: true } },
    }) as unknown as IConfig;

const startLocal = async (): Promise<S3Client> => {
    const client = new S3Client(localConfig());
    await client.onServerStart();
    return client;
};

const objectBody = async (
    client: S3Client,
    key: string,
): Promise<string | undefined> => {
    const result = await client
        .get()
        .send(new GetObjectCommand({ Bucket: LOCAL_BUCKET, Key: key }));
    return result.Body?.transformToString();
};

describe('S3Client — local development endpoint', () => {
    let client: S3Client;

    beforeEach(async () => {
        client = await startLocal();
    });

    afterEach(async () => {
        await client.onServerShutdown();
    });

    it('points clients at the in-process object store', async () => {
        await client
            .get()
            .send(
                new GetObjectCommand({
                    Bucket: LOCAL_BUCKET,
                    Key: 'definitely-absent',
                }),
            )
            .then(
                () => {
                    throw new Error('expected a missing-key failure');
                },
                (error: { name?: string }) => {
                    expect(error.name).toBe('NoSuchKey');
                },
            );
    });

    it('reuses one client per region and mints a new one per region', () => {
        const first = client.get('us-west-2');
        expect(client.get('us-west-2')).toBe(first);
        expect(client.get('eu-central-1')).not.toBe(first);
    });

    it('serves presigning from the same client when no public endpoint is set', () => {
        expect(client.getForPresign('us-west-2')).toBe(client.get('us-west-2'));
    });

    it('keeps modest upload thresholds so the local store is not overwhelmed', () => {
        expect(client.maxSingleUploadSize).toBe(10 * 1024 * 1024);
        expect(client.partSize).toBe(5 * 1024 * 1024);
    });
});

describe('S3Client — remote endpoint configuration', () => {
    let local: S3Client;
    let remote: S3Client | null = null;

    beforeEach(async () => {
        local = await startLocal();
    });

    afterEach(async () => {
        if (remote) await remote.onServerShutdown();
        remote = null;
        await local.onServerShutdown();
    });

    const remoteConfig = (extra: Record<string, unknown>): IConfig =>
        ({
            port: 0,
            extensions: [],
            s3: {
                s3Config: {
                    endpoint: internals(local).awsConfig.endpoint,
                    accessKeyId: 'fakeAccessKeyId',
                    secretAccessKey: 'fakeSecretAccessKey',
                    region: 'us-west-2',
                    forcePathStyle: true,
                    ...extra,
                },
            },
        }) as unknown as IConfig;

    it('talks to a configured S3-compatible endpoint', async () => {
        remote = new S3Client(remoteConfig({}));
        await remote.onServerStart();

        await remote
            .get()
            .send(new GetObjectCommand({ Bucket: LOCAL_BUCKET, Key: 'nope' }))
            .then(
                () => {
                    throw new Error('expected a missing-key failure');
                },
                (error: { name?: string }) => {
                    expect(error.name).toBe('NoSuchKey');
                },
            );
    });

    it('signs browser-facing URLs against the public endpoint', async () => {
        remote = new S3Client(
            remoteConfig({ publicEndpoint: 'https://cdn.example.test' }),
        );
        await remote.onServerStart();

        const presign = remote.getForPresign('us-west-2');
        expect(presign).not.toBe(remote.get('us-west-2'));
        // Cached per region like the regular client map.
        expect(remote.getForPresign('us-west-2')).toBe(presign);
        expect(remote.getForPresign('eu-central-1')).not.toBe(presign);
    });

    it('shares one client when the public endpoint matches the private one', async () => {
        const endpoint = internals(local).awsConfig.endpoint;
        remote = new S3Client(remoteConfig({ publicEndpoint: endpoint }));
        await remote.onServerStart();

        expect(remote.getForPresign('us-west-2')).toBe(remote.get('us-west-2'));
    });

    it('raises the upload thresholds when using the ambient credential chain', async () => {
        remote = new S3Client({
            port: 0,
            extensions: [],
            s3: { s3Config: { useCredentialChain: true } },
        } as unknown as IConfig);
        await remote.onServerStart();

        expect(remote.partSize).toBe(64 * 1024 * 1024);
        expect(remote.maxSingleUploadSize).toBe(128 * 1024 * 1024);
    });
});

describe('S3Client — legacy storage migration', () => {
    let client: S3Client;
    let dir: string;

    beforeEach(async () => {
        client = await startLocal();
        dir = mkdtempSync(join(tmpdir(), 'puter-s3-legacy-'));
    });

    afterEach(async () => {
        rmSync(dir, { recursive: true, force: true });
        await client.onServerShutdown();
    });

    it('does nothing when there is no legacy directory', async () => {
        await expect(
            internals(client).migrateLegacyStorage({
                legacyPath: join(dir, 'absent'),
            }),
        ).resolves.toEqual({ migratedFileCount: 0, scannedEntryCount: 0 });
    });

    it('uploads each legacy file, skips directories, then removes the tree', async () => {
        const small = 'small-file-contents';
        writeFileSync(join(dir, 'small.txt'), small);
        writeFileSync(join(dir, 'other.txt'), 'other');
        mkdirSync(join(dir, 'a-subdirectory'));

        await expect(
            internals(client).migrateLegacyStorage({ legacyPath: dir }),
        ).resolves.toEqual({ migratedFileCount: 2, scannedEntryCount: 3 });

        await expect(objectBody(client, 'small.txt')).resolves.toBe(small);
        await expect(objectBody(client, 'other.txt')).resolves.toBe('other');
        expect(existsSync(dir)).toBe(false);
    });

    it('switches to a multipart upload for a file over the single-put limit', async () => {
        // S3 requires every part but the last to be at least 5 MiB, so the
        // fixture has to straddle that for real.
        client.maxSingleUploadSize = 1024 * 1024;
        client.partSize = 5 * 1024 * 1024;
        const body = 'X'.repeat(6 * 1024 * 1024);
        writeFileSync(join(dir, 'large.bin'), body);

        await expect(
            internals(client).migrateLegacyStorage({ legacyPath: dir }),
        ).resolves.toEqual({ migratedFileCount: 1, scannedEntryCount: 1 });
        await expect(objectBody(client, 'large.bin')).resolves.toBe(body);
    });
});

describe('S3Client — multipart failure handling', () => {
    let client: S3Client;
    let dir: string;
    let filePath: string;

    beforeEach(async () => {
        client = await startLocal();
        dir = mkdtempSync(join(tmpdir(), 'puter-s3-multipart-'));
        filePath = join(dir, 'part-source.bin');
        writeFileSync(filePath, 'Y'.repeat(30));
        client.partSize = 10;
    });

    afterEach(async () => {
        rmSync(dir, { recursive: true, force: true });
        await client.onServerShutdown();
    });

    const commandName = (command: unknown) =>
        (command as { constructor: { name: string } }).constructor.name;

    it('fails when the store will not open a multipart upload', async () => {
        const send = vi.fn(async () => ({}));

        await expect(
            internals(client).uploadMultipart({
                bucket: LOCAL_BUCKET,
                client: { send },
                filePath,
                fileSize: 30,
                key: 'no-upload-id',
            }),
        ).rejects.toThrow('Failed to start multipart upload');
    });

    it('aborts the upload when a part comes back without an ETag', async () => {
        const sent: string[] = [];
        const send = vi.fn(async (command: unknown) => {
            const name = commandName(command);
            sent.push(name);
            if (name === 'CreateMultipartUploadCommand') {
                return { UploadId: 'upload-1' };
            }
            if (name === 'UploadPartCommand') return {};
            return {};
        });

        await expect(
            internals(client).uploadMultipart({
                bucket: LOCAL_BUCKET,
                client: { send },
                filePath,
                fileSize: 30,
                key: 'etag-less',
            }),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });

        expect(sent).toEqual([
            'CreateMultipartUploadCommand',
            'UploadPartCommand',
            'AbortMultipartUploadCommand',
        ]);
    });

    it('sends one part per chunk and completes with every ETag', async () => {
        const parts: { PartNumber: number; ContentLength: number }[] = [];
        let completed: { ETag: string; PartNumber: number }[] | undefined;
        const send = vi.fn(async (command: unknown) => {
            const name = commandName(command);
            const input = (command as { input: Record<string, unknown> }).input;
            if (name === 'CreateMultipartUploadCommand') {
                return { UploadId: 'upload-1' };
            }
            if (name === 'UploadPartCommand') {
                parts.push({
                    PartNumber: input.PartNumber as number,
                    ContentLength: input.ContentLength as number,
                });
                return { ETag: `etag-${input.PartNumber}` };
            }
            if (name === 'CompleteMultipartUploadCommand') {
                completed = (
                    input.MultipartUpload as {
                        Parts: { ETag: string; PartNumber: number }[];
                    }
                ).Parts;
            }
            return {};
        });

        client.partSize = 12;
        await internals(client).uploadMultipart({
            bucket: LOCAL_BUCKET,
            client: { send },
            filePath,
            fileSize: 30,
            key: 'chunked',
        });

        expect(parts).toEqual([
            { PartNumber: 1, ContentLength: 12 },
            { PartNumber: 2, ContentLength: 12 },
            { PartNumber: 3, ContentLength: 6 },
        ]);
        expect(completed).toEqual([
            { ETag: 'etag-1', PartNumber: 1 },
            { ETag: 'etag-2', PartNumber: 2 },
            { ETag: 'etag-3', PartNumber: 3 },
        ]);
    });

    it('aborts and rethrows when completing the upload fails', async () => {
        const sent: string[] = [];
        const send = vi.fn(async (command: unknown) => {
            const name = commandName(command);
            sent.push(name);
            if (name === 'CreateMultipartUploadCommand') {
                return { UploadId: 'upload-1' };
            }
            if (name === 'UploadPartCommand') return { ETag: 'etag' };
            if (name === 'CompleteMultipartUploadCommand') {
                throw new Error('complete rejected');
            }
            return {};
        });

        await expect(
            internals(client).uploadMultipart({
                bucket: LOCAL_BUCKET,
                client: { send },
                filePath,
                fileSize: 30,
                key: 'incomplete',
            }),
        ).rejects.toThrow('complete rejected');

        expect(sent.at(-1)).toBe('AbortMultipartUploadCommand');
    });
});

describe('S3Client — disk-backed local store', () => {
    let cwd: string;
    let dir: string;
    let client: S3Client | null = null;

    beforeEach(() => {
        cwd = process.cwd();
        dir = mkdtempSync(join(tmpdir(), 'puter-s3-disk-'));
    });

    afterEach(async () => {
        if (client) await client.onServerShutdown();
        client = null;
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
    });

    it('persists to the configured directories and drains legacy storage', async () => {
        // The legacy sweep resolves `storage/` against the working
        // directory, so the whole fixture lives in a throwaway cwd.
        process.chdir(dir);
        mkdirSync(join(dir, 'storage'));
        writeFileSync(join(dir, 'storage', 'legacy.txt'), 'from-disk');

        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        client = new S3Client({
            port: 0,
            extensions: [],
            s3: {
                localConfig: {
                    host: '127.0.0.1',
                    port: 0,
                    dataDir: join(dir, 'fauxqs-data'),
                    s3StorageDir: join(dir, 'fauxqs-s3'),
                },
            },
        } as unknown as IConfig);
        await client.onServerStart();

        expect(log).toHaveBeenCalledWith(
            '[s3] migrated 1 file(s) from legacy storage',
        );
        await expect(objectBody(client, 'legacy.txt')).resolves.toBe(
            'from-disk',
        );
        expect(existsSync(join(dir, 'storage'))).toBe(false);
        log.mockRestore();
    });
});

describe('S3Client — short reads during multipart', () => {
    let client: S3Client;
    let dir: string;

    beforeEach(async () => {
        client = await startLocal();
        dir = mkdtempSync(join(tmpdir(), 'puter-s3-short-'));
    });

    afterEach(async () => {
        rmSync(dir, { recursive: true, force: true });
        await client.onServerShutdown();
    });

    it('stops uploading parts once the file runs out early', async () => {
        const filePath = join(dir, 'truncated.bin');
        writeFileSync(filePath, 'Z'.repeat(20));
        client.partSize = 10;

        const parts: number[] = [];
        const send = vi.fn(async (command: unknown) => {
            const name = (command as { constructor: { name: string } })
                .constructor.name;
            const input = (command as { input: Record<string, unknown> }).input;
            if (name === 'CreateMultipartUploadCommand') {
                return { UploadId: 'upload-1' };
            }
            if (name === 'UploadPartCommand') {
                parts.push(input.ContentLength as number);
                return { ETag: `etag-${input.PartNumber}` };
            }
            return {};
        });

        // The caller's size is stale — the file is shorter than advertised.
        await internals(client).uploadMultipart({
            bucket: LOCAL_BUCKET,
            client: { send },
            filePath,
            fileSize: 50,
            key: 'truncated',
        });

        expect(parts).toEqual([10, 10]);
    });
});
