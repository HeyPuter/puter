import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../../tools/test.mjs';
import { HTTPThumbnailService } from './HTTPThumbnailService.js';

// We need to access ThumbnailOperation, but it's not exported
// Let's recreate it here for testing purposes
const { TeePromise } = require('@heyputer/putility').libs.promise;

class ThumbnailOperation extends TeePromise {
    static MAX_RECYCLE_COUNT = 3;
    constructor (file: any) {
        super();
        this.file = file;
        this.recycle_count = 0;
    }

    recycle () {
        this.recycle_count++;

        if ( this.recycle_count > this.constructor.MAX_RECYCLE_COUNT ) {
            this.resolve(undefined);
            return false;
        }

        return true;
    }
}

describe('HTTPThumbnailService', () => {
    it('should handle thumbnail operations correctly', async () => {
        const testKernel = await createTestKernel({
            serviceMap: {
                'thumbs-http': HTTPThumbnailService,
            },
        });

        const thumbnailService = testKernel.services!.get('thumbs-http') as HTTPThumbnailService;

        // Mock error reporting and logging
        thumbnailService.errors.report = () => {
        };

        thumbnailService.log = {
            info: () => {
            },
            error: () => {
            },
            noticeme: () => {
            },
        };

        // Thumbnail operation eventually recycles
        {
            const thop = new ThumbnailOperation(null);
            for ( let i = 0 ; i < ThumbnailOperation.MAX_RECYCLE_COUNT ; i++ ) {
                expect(thop.recycle()).toBe(true);
            }
            expect(thop.recycle()).toBe(false);
        }

        thumbnailService.test_mode = true;

        // Request and await the thumbnailing of a few files
        for ( let i = 0 ; i < 3 ; i++ ) {
            const job = new ThumbnailOperation({ behavior: 'ok' });
            thumbnailService.queue.push(job);
        }
        thumbnailService.test_checked_exec = false;
        await thumbnailService.exec_();
        expect(thumbnailService.queue.length).toBe(0);
        expect(thumbnailService.test_checked_exec).toBe(true);

        // test with failed job
        const job = new ThumbnailOperation({ behavior: 'fail' });
        thumbnailService.queue.push(job);
        thumbnailService.test_checked_exec = false;
        await thumbnailService.exec_();
        expect(thumbnailService.queue.length).toBe(0);
        expect(thumbnailService.test_checked_exec).toBe(true);

        thumbnailService.test_mode = false;
    });
});

