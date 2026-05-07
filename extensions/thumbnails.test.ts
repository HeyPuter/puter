import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { PuterServer } from '../src/backend/server.ts';
import { setupTestServer } from '../src/backend/testUtil.ts';
import { handleThumbnailCreated } from './thumbnails.ts';

// 1x1 transparent PNG — smallest valid image sharp will accept.
const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const BUCKET = 'puter-local';

const streamToBuffer = async (
    body: { transformToByteArray: () => Promise<Uint8Array> } | undefined,
): Promise<Buffer> => {
    if (!body) throw new Error('s3 GetObject returned no body');
    return Buffer.from(await body.transformToByteArray());
};

describe('thumbnails extension — handleThumbnailCreated', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server.shutdown();
    });

    it('uploads a valid data: URL thumbnail to S3 and rewrites event.url to an s3:// pointer', async () => {
        const s3 = server.clients.s3.get();
        const event: Record<string, unknown> = {
            url: `data:image/png;base64,${TINY_PNG_BASE64}`,
        };

        await handleThumbnailCreated(event, { s3, bucketName: BUCKET });

        expect(typeof event.url).toBe('string');
        const newUrl = event.url as string;
        expect(newUrl.startsWith(`s3://${BUCKET}/`)).toBe(true);

        const key = newUrl.slice(`s3://${BUCKET}/`.length);
        const obj = await s3.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        );
        expect(obj.ContentType).toBe('image/png');

        const expected = Buffer.from(TINY_PNG_BASE64, 'base64');
        const actual = await streamToBuffer(obj.Body as never);
        expect(actual.equals(expected)).toBe(true);
    });

    it('sets event.url to null when the data: URL does not decode to a valid image', async () => {
        const s3 = server.clients.s3.get();
        const event: Record<string, unknown> = {
            url: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`,
        };

        await handleThumbnailCreated(event, { s3, bucketName: BUCKET });

        expect(event.url).toBeNull();
    });

    it('leaves event.url untouched when the URL is not a data: URL', async () => {
        const s3 = server.clients.s3.get();
        const original = 'https://example.com/thumb.png';
        const event: Record<string, unknown> = { url: original };

        await handleThumbnailCreated(event, { s3, bucketName: BUCKET });

        expect(event.url).toBe(original);
    });

    it('returns without writing to S3 when event.url is missing', async () => {
        const s3 = server.clients.s3.get();
        const event: Record<string, unknown> = {};

        await handleThumbnailCreated(event, { s3, bucketName: BUCKET });

        expect(event.url).toBeUndefined();
    });
});
