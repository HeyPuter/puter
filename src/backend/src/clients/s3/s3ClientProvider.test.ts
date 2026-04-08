import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    PutObjectCommand,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateLegacyStorageToS3 } from './s3ClientProvider.ts';

describe('migrateLegacyStorageToS3', () => {
    const cleanupPaths: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanupPaths.splice(0).map(async p => {
            await fs.rm(p, { force: true, recursive: true }).catch(() => undefined);
        }));
    });

    it('returns without sending requests when legacy storage is missing', async () => {
        const send = vi.fn();
        const legacyPath = path.join(os.tmpdir(), `puter-s3-missing-${Date.now()}`);

        const result = await migrateLegacyStorageToS3({
            client: { send } as any,
            legacyPath,
        });

        expect(result).toEqual({
            migratedFileCount: 0,
            scannedEntryCount: 0,
        });
        expect(send).not.toHaveBeenCalled();
    });

    it('migrates simple files and ignores non-file entries', async () => {
        const send = vi.fn().mockResolvedValue({});
        const legacyPath = await fs.mkdtemp(path.join(os.tmpdir(), 'puter-s3-simple-'));
        cleanupPaths.push(legacyPath);

        await fs.writeFile(path.join(legacyPath, 'hello.txt'), 'hello world');
        await fs.writeFile(path.join(legacyPath, 'config.json'), '{"enabled":true}');
        await fs.mkdir(path.join(legacyPath, 'nested-dir'));
        await fs.writeFile(path.join(legacyPath, 'nested-dir', 'ignored.txt'), 'ignored');

        const result = await migrateLegacyStorageToS3({
            bucket: 'test-bucket',
            client: { send } as any,
            legacyPath,
        });

        expect(result).toEqual({
            migratedFileCount: 2,
            scannedEntryCount: 3,
        });
        expect(send).toHaveBeenCalledTimes(2);

        const migratedKeys = send.mock.calls
            .map(([command]) => command.input.Key)
            .sort();
        expect(migratedKeys).toEqual(['config.json', 'hello.txt']);

        send.mock.calls.forEach(([command]) => {
            expect(command).toBeInstanceOf(PutObjectCommand);
            expect(command.input.Bucket).toBe('test-bucket');
        });

        expect(existsSync(legacyPath)).toBe(false);
    });

    it('uses multipart migration when file exceeds configured put-object limit', async () => {
        const send = vi.fn(async command => {
            if ( command instanceof CreateMultipartUploadCommand ) {
                return { UploadId: 'upload-1' };
            }
            if ( command instanceof UploadPartCommand ) {
                return { ETag: `etag-${command.input.PartNumber}` };
            }
            if ( command instanceof CompleteMultipartUploadCommand ) {
                return {};
            }
            throw new Error(`Unexpected command: ${command.constructor.name}`);
        });

        const legacyPath = await fs.mkdtemp(path.join(os.tmpdir(), 'puter-s3-multipart-'));
        cleanupPaths.push(legacyPath);

        await fs.writeFile(path.join(legacyPath, 'big.bin'), Buffer.from('abcdefghijklmnopq'));

        const result = await migrateLegacyStorageToS3({
            bucket: 'test-bucket',
            client: { send } as any,
            legacyPath,
            multipartPartSizeBytes: 6,
            putObjectLimitBytes: 8,
        });

        expect(result).toEqual({
            migratedFileCount: 1,
            scannedEntryCount: 1,
        });

        const createCalls = send.mock.calls.filter(([command]) => command instanceof CreateMultipartUploadCommand);
        const uploadCalls = send.mock.calls.filter(([command]) => command instanceof UploadPartCommand);
        const completeCalls = send.mock.calls.filter(([command]) => command instanceof CompleteMultipartUploadCommand);
        const putObjectCalls = send.mock.calls.filter(([command]) => command instanceof PutObjectCommand);

        expect(createCalls).toHaveLength(1);
        expect(uploadCalls).toHaveLength(3);
        expect(completeCalls).toHaveLength(1);
        expect(putObjectCalls).toHaveLength(0);

        const partNumbers = uploadCalls.map(([command]) => command.input.PartNumber);
        expect(partNumbers).toEqual([1, 2, 3]);

        const partLengths = uploadCalls.map(([command]) => command.input.Body.length);
        expect(partLengths).toEqual([6, 6, 5]);

        const completedParts = completeCalls[0][0].input.MultipartUpload.Parts;
        expect(completedParts).toEqual([
            { ETag: 'etag-1', PartNumber: 1 },
            { ETag: 'etag-2', PartNumber: 2 },
            { ETag: 'etag-3', PartNumber: 3 },
        ]);

        expect(existsSync(legacyPath)).toBe(false);
    });

    it('aborts multipart upload when an upload part fails', async () => {
        const send = vi.fn(async command => {
            if ( command instanceof CreateMultipartUploadCommand ) {
                return { UploadId: 'upload-2' };
            }
            if ( command instanceof UploadPartCommand ) {
                throw new Error('part failed');
            }
            if ( command instanceof AbortMultipartUploadCommand ) {
                return {};
            }
            return {};
        });

        const legacyPath = await fs.mkdtemp(path.join(os.tmpdir(), 'puter-s3-multipart-fail-'));
        cleanupPaths.push(legacyPath);

        await fs.writeFile(path.join(legacyPath, 'will-fail.bin'), Buffer.from('123456789'));

        await expect(migrateLegacyStorageToS3({
            client: { send } as any,
            legacyPath,
            multipartPartSizeBytes: 5,
            putObjectLimitBytes: 6,
        })).rejects.toThrow('part failed');

        const abortCalls = send.mock.calls.filter(([command]) => command instanceof AbortMultipartUploadCommand);
        expect(abortCalls).toHaveLength(1);
        expect(existsSync(legacyPath)).toBe(true);
    });
});
