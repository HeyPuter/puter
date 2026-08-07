import {
    GetObjectCommand,
    PutObjectCommand,
    type S3Client,
} from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { PuterServer } from '../src/backend/server.ts';
import { setupTestServer } from '../src/backend/testUtil.ts';
import {
    handleFsCopyNodeThumbnail,
    handleFsRemoveNodeThumbnail,
    handleThumbnailCreated,
    handleThumbnailRead,
    handleThumbnailUploadPrepare,
} from './thumbnails.ts';

// 1x1 transparent PNG — smallest valid image sharp will accept.
const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const BUCKET = 'puter-local';

// Keys the extension will accept back: its own `thumbnails/<uuid>` namespace.
const mintedKey = () => `thumbnails/${crypto.randomUUID()}`;

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
        await server?.shutdown();
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

describe('thumbnails extension — handleThumbnailUploadPrepare', () => {
    let server: PuterServer;
    let s3Presign: S3Client;

    beforeAll(async () => {
        server = await setupTestServer();
        s3Presign = server.clients.s3.getForPresign();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('returns early when event has no items array', async () => {
        const event: Record<string, unknown> = {};
        await handleThumbnailUploadPrepare(event, {
            s3Presign,
            bucketName: BUCKET,
        });
        // No items property added — handler is a no-op.
        expect(event).toEqual({});
    });

    it('throws when items array contains a non-object entry', async () => {
        await expect(
            handleThumbnailUploadPrepare(
                { items: ['not-an-object'] } as unknown as Record<
                    string,
                    unknown
                >,
                { s3Presign, bucketName: BUCKET },
            ),
        ).rejects.toThrow('thumbnail.upload.prepare item is invalid');
    });

    it('skips items without a contentType (no upload URL minted)', async () => {
        const item: Record<string, unknown> = { contentType: '' };
        await handleThumbnailUploadPrepare(
            { items: [item] },
            { s3Presign, bucketName: BUCKET },
        );
        expect(item.uploadUrl).toBeUndefined();
        expect(item.thumbnailUrl).toBeUndefined();
    });

    it('skips items whose size exceeds the max thumbnail bytes', async () => {
        const item: Record<string, unknown> = {
            contentType: 'image/png',
            size: 999_999_999,
        };
        await handleThumbnailUploadPrepare(
            { items: [item] },
            { s3Presign, bucketName: BUCKET },
        );
        expect(item.uploadUrl).toBeUndefined();
        expect(item.thumbnailUrl).toBeUndefined();
    });

    it('mints a presigned uploadUrl and an s3:// thumbnailUrl for valid items', async () => {
        const item: Record<string, unknown> = {
            contentType: 'image/png',
            size: 1024,
        };
        await handleThumbnailUploadPrepare(
            { items: [item] },
            { s3Presign, bucketName: BUCKET },
        );
        expect(typeof item.uploadUrl).toBe('string');
        expect((item.uploadUrl as string).startsWith('http')).toBe(true);
        expect(typeof item.thumbnailUrl).toBe('string');
        expect(
            (item.thumbnailUrl as string).startsWith(`s3://${BUCKET}/`),
        ).toBe(true);
    });
});

describe('thumbnails extension — handleThumbnailRead', () => {
    let server: PuterServer;
    let s3: S3Client;
    let s3Presign: S3Client;

    const stubDb = { write: vi.fn().mockResolvedValue(undefined) };

    beforeAll(async () => {
        server = await setupTestServer();
        s3 = server.clients.s3.get();
        s3Presign = server.clients.s3.getForPresign();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('rewrites an s3:// thumbnail into a presigned https URL', async () => {
        // Seed an object so the presigned URL points at something real
        // (the signer itself doesn't validate existence, but this keeps
        // the test honest).
        const key = mintedKey();
        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                Body: Buffer.from(TINY_PNG_BASE64, 'base64'),
                ContentType: 'image/png',
            }),
        );

        const entry: Record<string, unknown> = {
            thumbnail: `s3://${BUCKET}/${key}`,
        };
        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: 'http://127.0.0.1:4566/puter-local/',
            db: stubDb,
        });

        expect(typeof entry.thumbnail).toBe('string');
        expect((entry.thumbnail as string).startsWith('http')).toBe(true);
    });

    // `fsentries.thumbnail` is writable through the FS API, so a stored
    // pointer is attacker input. Signing one the extension didn't mint would
    // hand out a presigned read of an arbitrary object — including another
    // user's file, whose key is its fsentry uuid in this same bucket.
    it.each([
        // Shaped exactly like an fs object key (and like a legacy thumbnail
        // row) — indistinguishable from a planted pointer, so it fails closed.
        [
            "another user's file object",
            `s3://${BUCKET}/${crypto.randomUUID()}`,
        ],
        [
            'a key outside the thumbnails namespace',
            `s3://${BUCKET}/secrets/dump`,
        ],
        [
            'a namespace-lookalike key',
            `s3://${BUCKET}/thumbnails/../${crypto.randomUUID()}`,
        ],
        ['a non-uuid inside the namespace', `s3://${BUCKET}/thumbnails/etc`],
    ])('refuses to presign a pointer naming %s', async (_label, thumbnail) => {
        const entry: Record<string, unknown> = { thumbnail };
        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: 'http://127.0.0.1:4566/puter-local/',
            db: stubDb,
        });
        expect(entry.thumbnail).toBeNull();
    });

    it('signs against its own bucket, ignoring the one in the pointer', async () => {
        const key = mintedKey();
        const entry: Record<string, unknown> = {
            thumbnail: `s3://attacker-named-bucket/${key}`,
        };
        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: 'http://127.0.0.1:4566/puter-local/',
            db: stubDb,
        });
        // Signed for OUR bucket; `attacker-named-bucket` never reached S3.
        const signed = entry.thumbnail as string;
        expect(signed.startsWith('http')).toBe(true);
        expect(signed).not.toContain('attacker-named-bucket');
        expect(signed).toContain(BUCKET);
    });

    it('leaves the thumbnail untouched when not s3/https/data', async () => {
        const entry: Record<string, unknown> = { thumbnail: 'about:blank' };
        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: 'http://127.0.0.1:4566/puter-local/',
            db: stubDb,
        });
        expect(entry.thumbnail).toBe('about:blank');
    });

    it('returns early when the thumbnail is missing or non-string', async () => {
        const entry: Record<string, unknown> = {};
        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: 'http://127.0.0.1:4566/puter-local/',
            db: stubDb,
        });
        expect(entry.thumbnail).toBeUndefined();
    });

    it('migrates an inline data: URL by uploading to S3 and updating the DB row', async () => {
        const entry: Record<string, unknown> = {
            uuid: 'fs-entry-uuid',
            thumbnail: `data:image/png;base64,${TINY_PNG_BASE64}`,
        };

        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: 'http://127.0.0.1:4566/puter-local/',
            db: stubDb,
        });

        // The handler should have replaced the data URL with a signed
        // S3 URL and kicked off the DB migration write.
        expect(typeof entry.thumbnail).toBe('string');
        expect((entry.thumbnail as string).startsWith('http')).toBe(true);
        // Allow the best-effort write microtask to settle.
        await Promise.resolve();
        expect(stubDb.write).toHaveBeenCalledWith(
            'UPDATE `fsentries` SET `thumbnail` = ? WHERE `uuid` = ?',
            [expect.stringMatching(/^s3:\/\//), 'fs-entry-uuid'],
        );
    });
});

describe('thumbnails extension — handleFsRemoveNodeThumbnail', () => {
    let server: PuterServer;
    let s3: S3Client;

    beforeAll(async () => {
        server = await setupTestServer();
        s3 = server.clients.s3.get();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('deletes the S3 object referenced by an s3:// thumbnail URL', async () => {
        const key = mintedKey();
        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                Body: Buffer.from(TINY_PNG_BASE64, 'base64'),
                ContentType: 'image/png',
            }),
        );

        await handleFsRemoveNodeThumbnail(
            { target: { thumbnail: `s3://${BUCKET}/${key}` } },
            { s3, bucketName: BUCKET },
        );

        // GetObject should now error because the key was deleted.
        await expect(
            s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })),
        ).rejects.toThrow();
    });

    // The destructive half of the same confused deputy: the stored pointer
    // decides which object is deleted, so a key the extension didn't mint
    // must never reach DeleteObject.
    it('does not delete an object the pointer names but we did not mint', async () => {
        const victimKey = crypto.randomUUID(); // shaped like an fs object key
        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: victimKey,
                Body: Buffer.from(TINY_PNG_BASE64, 'base64'),
                ContentType: 'image/png',
            }),
        );

        await handleFsRemoveNodeThumbnail(
            { target: { thumbnail: `s3://${BUCKET}/${victimKey}` } },
            { s3, bucketName: BUCKET },
        );

        const survivor = await s3.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: victimKey }),
        );
        expect(survivor.ContentType).toBe('image/png');
    });

    it('is a no-op when the target has no thumbnail', async () => {
        // Should not throw or attempt a delete.
        await handleFsRemoveNodeThumbnail(
            { target: {} },
            { s3, bucketName: BUCKET },
        );
    });

    it('is a no-op when the thumbnail URL is not an s3:// pointer', async () => {
        await handleFsRemoveNodeThumbnail(
            { target: { thumbnail: 'https://cdn.example.com/x.png' } },
            { s3, bucketName: BUCKET },
        );
    });
});

describe('thumbnails extension — handleFsCopyNodeThumbnail', () => {
    let server: PuterServer;
    let s3: S3Client;

    beforeAll(async () => {
        server = await setupTestServer();
        s3 = server.clients.s3.get();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('duplicates the shared thumbnail object and repoints the copied row', async () => {
        const sourceKey = mintedKey();
        const body = Buffer.from(TINY_PNG_BASE64, 'base64');
        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: sourceKey,
                Body: body,
                ContentType: 'image/png',
            }),
        );

        const copyUuid = crypto.randomUUID();
        const db = { write: vi.fn().mockResolvedValue(undefined) };
        await handleFsCopyNodeThumbnail(
            {
                copy: {
                    thumbnail: `s3://${BUCKET}/${sourceKey}`,
                    uuid: copyUuid,
                },
            },
            { s3, bucketName: BUCKET, db },
        );

        // The copied row was repointed at a fresh object...
        expect(db.write).toHaveBeenCalledTimes(1);
        const [, params] = db.write.mock.calls[0] as [string, [string, string]];
        const [newPointer, updatedUuid] = params;
        expect(updatedUuid).toBe(copyUuid);
        expect(newPointer.startsWith(`s3://${BUCKET}/thumbnails/`)).toBe(true);
        expect(newPointer).not.toBe(`s3://${BUCKET}/${sourceKey}`);

        // ...whose content matches, while the source object survives — so
        // deleting either entry can no longer break the other's thumbnail.
        const newKey = newPointer.slice(`s3://${BUCKET}/`.length);
        const duplicated = await s3.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: newKey }),
        );
        expect(
            (await streamToBuffer(duplicated.Body as never)).equals(body),
        ).toBe(true);
        const original = await s3.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: sourceKey }),
        );
        expect(original.ContentType).toBe('image/png');
    });

    it('drops the pointer when the shared object is already gone', async () => {
        const copyUuid = crypto.randomUUID();
        const db = { write: vi.fn().mockResolvedValue(undefined) };
        await handleFsCopyNodeThumbnail(
            {
                copy: {
                    thumbnail: `s3://${BUCKET}/${mintedKey()}`, // never uploaded
                    uuid: copyUuid,
                },
            },
            { s3, bucketName: BUCKET, db },
        );

        expect(db.write).toHaveBeenCalledTimes(1);
        const [sql, params] = db.write.mock.calls[0] as [string, [string]];
        expect(sql).toContain('NULL');
        expect(params).toEqual([copyUuid]);
    });

    it('does not duplicate an object the pointer names but we did not mint', async () => {
        const foreignKey = crypto.randomUUID(); // shaped like an fs object key
        const db = { write: vi.fn().mockResolvedValue(undefined) };
        await handleFsCopyNodeThumbnail(
            {
                copy: {
                    thumbnail: `s3://${BUCKET}/${foreignKey}`,
                    uuid: crypto.randomUUID(),
                },
            },
            { s3, bucketName: BUCKET, db },
        );
        expect(db.write).not.toHaveBeenCalled();
    });

    it('is a no-op when the copy has no thumbnail', async () => {
        const db = { write: vi.fn().mockResolvedValue(undefined) };
        await handleFsCopyNodeThumbnail(
            { copy: { thumbnail: null, uuid: crypto.randomUUID() } },
            { s3, bucketName: BUCKET, db },
        );
        expect(db.write).not.toHaveBeenCalled();
    });
});
