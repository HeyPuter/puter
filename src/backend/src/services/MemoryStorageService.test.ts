import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import MemoryStorageService from './MemoryStorageService';

describe('MemoryStorageService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'memory-storage': MemoryStorageService,
        },
        initLevelString: 'construct',
    });

    const memoryStorage = testKernel.services!.get('memory-storage') as MemoryStorageService;

    it('should be instantiated', () => {
        expect(memoryStorage).toBeInstanceOf(MemoryStorageService);
    });

    it('should create read stream from memory file', async () => {
        const mockFile = {
            content: Buffer.from('test content'),
        };

        const stream = await memoryStorage.create_read_stream('test-uuid', {
            memory_file: mockFile,
        });

        expect(stream).toBeInstanceOf(Readable);
    });

    it('should read content from stream', async () => {
        const testContent = 'Hello, World!';
        const mockFile = {
            content: Buffer.from(testContent),
        };

        const stream = await memoryStorage.create_read_stream('test-uuid', {
            memory_file: mockFile,
        }) as Readable;

        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        const result = Buffer.concat(chunks).toString();
        expect(result).toBe(testContent);
    });

    it('should throw error when memory_file is not provided', async () => {
        await expect(
            memoryStorage.create_read_stream('test-uuid', {})
        ).rejects.toThrow('MemoryStorageService.create_read_stream: memory_file is required');
    });

    it('should handle empty content', async () => {
        const mockFile = {
            content: Buffer.from(''),
        };

        const stream = await memoryStorage.create_read_stream('test-uuid', {
            memory_file: mockFile,
        }) as Readable;

        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        const result = Buffer.concat(chunks).toString();
        expect(result).toBe('');
    });

    it('should handle binary content', async () => {
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF]);
        const mockFile = {
            content: binaryData,
        };

        const stream = await memoryStorage.create_read_stream('test-uuid', {
            memory_file: mockFile,
        }) as Readable;

        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        const result = Buffer.concat(chunks);
        expect(result).toEqual(binaryData);
    });
});

