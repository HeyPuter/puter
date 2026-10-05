import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { FSController } from '../src/backend/controllers/fs/FSController.ts';
import type {
    ClientSignedWriteResponse,
    CompleteWriteRequest,
    SignedWriteRequest,
} from '../src/backend/controllers/fs/requestTypes.ts';
import type { Actor } from '../src/backend/core/actor.ts';
import { runWithContext } from '../src/backend/core/context.ts';
import { PuterServer } from '../src/backend/server.ts';
import { setupTestServer } from '../src/backend/testUtil.ts';
import { generateDefaultFsentries } from '../src/backend/util/userProvisioning.ts';
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
const BUCKET_ENDPOINT = 'http://127.0.0.1:4566/puter-local/';

// Keys the extension mints: `thumbnails/<entry uuid>/<uuid>`.
const mintedKey = (entryUuid: string = crypto.randomUUID()) =>
    `thumbnails/${entryUuid}/${crypto.randomUUID()}`;
// Minted before keys were bound to an entry.
const legacyKey = () => `thumbnails/${crypto.randomUUID()}`;

const putObject = async (s3: S3Client, key: string, body: Buffer) => {
    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: body,
            ContentType: 'image/png',
        }),
    );
};

const objectExists = async (s3: S3Client, key: string) => {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return true;
    } catch {
        return false;
    }
};

const streamToBuffer = async (
    body: { transformToByteArray: () => Promise<Uint8Array> } | undefined,
): Promise<Buffer> => {
    if (!body) throw new Error('s3 GetObject returned no body');
    return Buffer.from(await body.transformToByteArray());
};

describe('thumbnails extension — handleThumbnailCreated', () => {
    let server: PuterServer;
    let s3: S3Client;

    beforeAll(async () => {
        server = await setupTestServer();
        s3 = server.clients.s3.get();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const created = async (url: unknown, uuid?: unknown) => {
        const event: Record<string, unknown> = { url, uuid };
        await handleThumbnailCreated(event, {
            s3,
            bucketName: BUCKET,
            bucketEndpoint: BUCKET_ENDPOINT,
        });
        return event.url;
    };

    it('uploads a valid data: URL thumbnail under a key bound to the entry', async () => {
        const entryUuid = crypto.randomUUID();
        const newUrl = await created(
            `data:image/png;base64,${TINY_PNG_BASE64}`,
            entryUuid,
        );

        expect(typeof newUrl).toBe('string');
        expect(
            (newUrl as string).startsWith(
                `s3://${BUCKET}/thumbnails/${entryUuid}/`,
            ),
        ).toBe(true);

        const key = (newUrl as string).slice(`s3://${BUCKET}/`.length);
        const obj = await s3.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        );
        expect(obj.ContentType).toBe('image/png');

        const expected = Buffer.from(TINY_PNG_BASE64, 'base64');
        const actual = await streamToBuffer(obj.Body as never);
        expect(actual.equals(expected)).toBe(true);
    });

    it('sets event.url to null when the data: URL does not decode to a valid image', async () => {
        const url = await created(
            `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`,
            crypto.randomUUID(),
        );
        expect(url).toBeNull();
    });

    it('sets event.url to null for a data: URL with no entry to bind it to', async () => {
        const url = await created(`data:image/png;base64,${TINY_PNG_BASE64}`);
        expect(url).toBeNull();
    });

    // A documented SDK input: `thumbnail` / `thumbnailGenerator` may return
    // a plain URL. It never names our storage, so it is stored as given.
    it('leaves an external image URL untouched', async () => {
        const original = 'https://example.com/thumb.png';
        expect(await created(original, crypto.randomUUID())).toBe(original);
    });

    it('returns without writing to S3 when event.url is missing', async () => {
        const event: Record<string, unknown> = {};

        await handleThumbnailCreated(event, {
            s3,
            bucketName: BUCKET,
            bucketEndpoint: BUCKET_ENDPOINT,
        });

        expect(event.url).toBeUndefined();
    });

    it('keeps an uploaded pointer minted for the entry, normalised to our bucket', async () => {
        const entryUuid = crypto.randomUUID();
        const key = mintedKey(entryUuid);
        await putObject(s3, key, Buffer.from(TINY_PNG_BASE64, 'base64'));

        expect(
            await created(`s3://client-named-bucket/${key}`, entryUuid),
        ).toBe(`s3://${BUCKET}/${key}`);
    });

    // A thumbnail key is visible to anyone who can list the entry holding it.
    // Planting it on a file of one's own used to hand its deletion to them.
    it.each([
        ['a key minted for another entry', () => mintedKey()],
        ['a key that predates entry binding', legacyKey],
    ])('drops a pointer naming %s', async (_label, makeKey) => {
        const key = makeKey();
        await putObject(s3, key, Buffer.from(TINY_PNG_BASE64, 'base64'));

        expect(
            await created(`s3://${BUCKET}/${key}`, crypto.randomUUID()),
        ).toBeNull();
        expect(await objectExists(s3, key)).toBe(true);
    });

    it('drops a pointer whose object was never uploaded', async () => {
        const entryUuid = crypto.randomUUID();
        expect(
            await created(`s3://${BUCKET}/${mintedKey(entryUuid)}`, entryUuid),
        ).toBeNull();
    });

    it('drops and removes an uploaded object over the size bound', async () => {
        const entryUuid = crypto.randomUUID();
        const key = mintedKey(entryUuid);
        await putObject(s3, key, Buffer.alloc(2 * 1024 * 1024 + 1));

        expect(await created(`s3://${BUCKET}/${key}`, entryUuid)).toBeNull();
        expect(await objectExists(s3, key)).toBe(false);
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

    it.each([
        ['exceeds the max thumbnail bytes', { size: 999_999_999 }],
        ['is not declared', {}],
        ['is not a whole number', { size: 10.5 }],
    ])('skips items whose size %s', async (_label, sizeField) => {
        const item: Record<string, unknown> = {
            contentType: 'image/png',
            item_uid: crypto.randomUUID(),
            ...sizeField,
        };
        await handleThumbnailUploadPrepare(
            { items: [item] },
            { s3Presign, bucketName: BUCKET },
        );
        expect(item.uploadUrl).toBeUndefined();
        expect(item.thumbnailUrl).toBeUndefined();
    });

    it('skips items with no entry to bind the key to', async () => {
        const item: Record<string, unknown> = {
            contentType: 'image/png',
            size: 1024,
            item_uid: 'not-a-uuid',
        };
        await handleThumbnailUploadPrepare(
            { items: [item] },
            { s3Presign, bucketName: BUCKET },
        );
        expect(item.uploadUrl).toBeUndefined();
        expect(item.thumbnailUrl).toBeUndefined();
    });

    it('mints a size-bound upload URL for a key bound to the entry', async () => {
        const entryUuid = crypto.randomUUID();
        const item: Record<string, unknown> = {
            contentType: 'image/png',
            size: 1024,
            item_uid: entryUuid,
        };
        await handleThumbnailUploadPrepare(
            { items: [item] },
            { s3Presign, bucketName: BUCKET },
        );
        expect(typeof item.uploadUrl).toBe('string');
        expect((item.uploadUrl as string).startsWith('http')).toBe(true);
        expect(typeof item.thumbnailUrl).toBe('string');
        expect(
            (item.thumbnailUrl as string).startsWith(
                `s3://${BUCKET}/thumbnails/${entryUuid}/`,
            ),
        ).toBe(true);
        // A signed `content-length` makes the store refuse any other body size.
        const signedHeaders = new URL(
            item.uploadUrl as string,
        ).searchParams.get('X-Amz-SignedHeaders');
        expect(signedHeaders).toContain('content-length');
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

    // Thumbnails stored before keys were bound to entries keep displaying.
    it.each([
        ['an entry-bound key', () => mintedKey()],
        ['a key that predates entry binding', legacyKey],
    ])(
        'rewrites an s3:// thumbnail naming %s into a presigned https URL',
        async (_label, makeKey) => {
            // Seed an object so the presigned URL points at something real
            // (the signer itself doesn't validate existence, but this keeps
            // the test honest).
            const key = makeKey();
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
        },
    );

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
        [
            'a key nested deeper than the namespace allows',
            `s3://${BUCKET}/${mintedKey()}/${crypto.randomUUID()}`,
        ],
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
        const entryUuid = crypto.randomUUID();
        const entry: Record<string, unknown> = {
            uuid: entryUuid,
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
            [
                expect.stringMatching(
                    new RegExp(`^s3://${BUCKET}/thumbnails/${entryUuid}/`),
                ),
                entryUuid,
            ],
        );
    });

    it('leaves an inline data: URL as is when there is no entry to bind it to', async () => {
        const thumbnail = `data:image/png;base64,${TINY_PNG_BASE64}`;
        const entry: Record<string, unknown> = { thumbnail };
        await handleThumbnailRead(entry, {
            s3,
            s3Presign,
            bucketName: BUCKET,
            bucketEndpoint: BUCKET_ENDPOINT,
            db: stubDb,
        });
        expect(entry.thumbnail).toBe(thumbnail);
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

    const remove = (target: { thumbnail?: string | null; uuid?: string }) =>
        handleFsRemoveNodeThumbnail(
            { target },
            { s3, bucketName: BUCKET, bucketEndpoint: BUCKET_ENDPOINT },
        );

    it('deletes the object minted for the removed entry', async () => {
        const entryUuid = crypto.randomUUID();
        const key = mintedKey(entryUuid);
        await putObject(s3, key, Buffer.from(TINY_PNG_BASE64, 'base64'));

        await remove({ thumbnail: `s3://${BUCKET}/${key}`, uuid: entryUuid });

        expect(await objectExists(s3, key)).toBe(false);
    });

    // The destructive half of the same confused deputy: the stored pointer
    // decides which object is deleted, so only a key minted for the removed
    // entry may reach DeleteObject.
    it.each([
        // Shaped like an fs object key.
        [
            'an object outside the thumbnails namespace',
            () => crypto.randomUUID(),
        ],
        // Visible to anyone who can list the entry it belongs to.
        ["another entry's thumbnail", () => mintedKey()],
        // Can't be told apart from a planted or shared pointer.
        ['a thumbnail that predates entry binding', legacyKey],
    ])('does not delete %s', async (_label, makeKey) => {
        const victimKey = makeKey();
        await putObject(s3, victimKey, Buffer.from(TINY_PNG_BASE64, 'base64'));

        await remove({
            thumbnail: `s3://${BUCKET}/${victimKey}`,
            uuid: crypto.randomUUID(),
        });

        expect(await objectExists(s3, victimKey)).toBe(true);
    });

    it('does not delete through an external URL that names our key', async () => {
        const entryUuid = crypto.randomUUID();
        const key = mintedKey(entryUuid);
        await putObject(s3, key, Buffer.from(TINY_PNG_BASE64, 'base64'));

        await remove({
            thumbnail: `https://cdn.example.com/${BUCKET}/${key}`,
            uuid: entryUuid,
        });

        expect(await objectExists(s3, key)).toBe(true);
    });

    it('is a no-op when the target has no thumbnail', async () => {
        // Should not throw or attempt a delete.
        await remove({});
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

    const copyNode = async (
        thumbnail: string | null,
        copyUuid: string,
        client: S3Client = s3,
    ) => {
        const db = { write: vi.fn().mockResolvedValue(undefined) };
        await handleFsCopyNodeThumbnail(
            { copy: { thumbnail, uuid: copyUuid } },
            {
                s3: client,
                bucketName: BUCKET,
                bucketEndpoint: BUCKET_ENDPOINT,
                db,
            },
        );
        return db;
    };

    // The key the copied row was repointed at, asserting it is bound to it.
    const repointedKey = (
        db: Awaited<ReturnType<typeof copyNode>>,
        copyUuid: string,
    ): string => {
        expect(db.write).toHaveBeenCalledTimes(1);
        const [sql, [pointer, uuid]] = db.write.mock.calls[0] as [
            string,
            [string, string],
        ];
        expect(sql).toBe(
            'UPDATE `fsentries` SET `thumbnail` = ? WHERE `uuid` = ?',
        );
        expect(uuid).toBe(copyUuid);
        expect(pointer).toMatch(
            new RegExp(`^s3://${BUCKET}/thumbnails/${copyUuid}/`),
        );
        return pointer.slice(`s3://${BUCKET}/`.length);
    };

    it.each([
        ['an entry-bound key', () => mintedKey()],
        ['a key that predates entry binding', legacyKey],
    ])(
        'duplicates a thumbnail naming %s under a key bound to the copy',
        async (_label, makeKey) => {
            const sourceKey = makeKey();
            const body = Buffer.from(TINY_PNG_BASE64, 'base64');
            await putObject(s3, sourceKey, body);

            const copyUuid = crypto.randomUUID();
            const db = await copyNode(`s3://${BUCKET}/${sourceKey}`, copyUuid);

            // The copied row was repointed at a fresh object of its own...
            expect(db.write).toHaveBeenCalledTimes(1);
            const [, params] = db.write.mock.calls[0] as [
                string,
                [string, string],
            ];
            const [newPointer, updatedUuid] = params;
            expect(updatedUuid).toBe(copyUuid);
            expect(
                newPointer.startsWith(`s3://${BUCKET}/thumbnails/${copyUuid}/`),
            ).toBe(true);

            // ...whose content matches, while the source object survives — so
            // deleting either entry can no longer break the other's thumbnail.
            const newKey = newPointer.slice(`s3://${BUCKET}/`.length);
            const duplicated = await s3.send(
                new GetObjectCommand({ Bucket: BUCKET, Key: newKey }),
            );
            expect(duplicated.ContentType).toBe('image/png');
            expect(
                (await streamToBuffer(duplicated.Body as never)).equals(body),
            ).toBe(true);
            expect(await objectExists(s3, sourceKey)).toBe(true);
        },
    );

    // The SDK puts an endpoint's path in front of every Bucket/Key request but
    // not in front of a CopyObject source, so on such a store HeadObject finds
    // the source and CopyObject reports NoSuchKey.
    it('duplicates through a client whose endpoint carries a path', async () => {
        const endpoint = await s3.config.endpoint!();
        const client = new S3Client({
            region: await s3.config.region(),
            endpoint: `${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}/${BUCKET}`,
            credentials: await s3.config.credentials(),
            forcePathStyle: true,
        });
        const sourceKey = mintedKey();
        const body = Buffer.from(TINY_PNG_BASE64, 'base64');
        await putObject(client, sourceKey, body);

        const copyUuid = crypto.randomUUID();
        const db = await copyNode(
            `s3://${BUCKET}/${sourceKey}`,
            copyUuid,
            client,
        );

        const duplicated = await client.send(
            new GetObjectCommand({
                Bucket: BUCKET,
                Key: repointedKey(db, copyUuid),
            }),
        );
        expect(duplicated.ContentType).toBe('image/png');
        expect(
            (await streamToBuffer(duplicated.Body as never)).equals(body),
        ).toBe(true);
    });

    it("lets either entry's removal leave the other's thumbnail in place", async () => {
        const sourceUuid = crypto.randomUUID();
        const sourceKey = mintedKey(sourceUuid);
        const sourcePointer = `s3://${BUCKET}/${sourceKey}`;
        await putObject(s3, sourceKey, Buffer.from(TINY_PNG_BASE64, 'base64'));
        const remove = (thumbnail: string, uuid: string) =>
            handleFsRemoveNodeThumbnail(
                { target: { thumbnail, uuid } },
                { s3, bucketName: BUCKET, bucketEndpoint: BUCKET_ENDPOINT },
            );

        // Removing a copy leaves the source's object...
        const firstUuid = crypto.randomUUID();
        const firstKey = repointedKey(
            await copyNode(sourcePointer, firstUuid),
            firstUuid,
        );
        await remove(`s3://${BUCKET}/${firstKey}`, firstUuid);
        expect(await objectExists(s3, firstKey)).toBe(false);
        expect(await objectExists(s3, sourceKey)).toBe(true);

        // ...and removing the source leaves a copy's.
        const secondUuid = crypto.randomUUID();
        const secondKey = repointedKey(
            await copyNode(sourcePointer, secondUuid),
            secondUuid,
        );
        await remove(sourcePointer, sourceUuid);
        expect(await objectExists(s3, sourceKey)).toBe(false);
        expect(await objectExists(s3, secondKey)).toBe(true);
    });

    it('drops the pointer when the shared object is already gone', async () => {
        const copyUuid = crypto.randomUUID();
        const db = await copyNode(
            `s3://${BUCKET}/${mintedKey()}`, // never uploaded
            copyUuid,
        );

        expect(db.write).toHaveBeenCalledTimes(1);
        const [sql, params] = db.write.mock.calls[0] as [string, [string]];
        expect(sql).toContain('NULL');
        expect(params).toEqual([copyUuid]);
    });

    // Only reachable for objects uploaded before upload URLs were size-bound;
    // copying one would multiply bytes no allowance counts.
    it('drops the pointer instead of duplicating an object over the size bound', async () => {
        const sourceKey = legacyKey();
        await putObject(s3, sourceKey, Buffer.alloc(2 * 1024 * 1024 + 1));

        const copyUuid = crypto.randomUUID();
        const db = await copyNode(`s3://${BUCKET}/${sourceKey}`, copyUuid);

        expect(db.write).toHaveBeenCalledTimes(1);
        const [sql, params] = db.write.mock.calls[0] as [string, [string]];
        expect(sql).toContain('NULL');
        expect(params).toEqual([copyUuid]);
    });

    it('drops the pointer when the object outgrows the bound after its size was checked', async () => {
        const sourceKey = mintedKey();
        await putObject(s3, sourceKey, Buffer.from(TINY_PNG_BASE64, 'base64'));
        const sent: unknown[] = [];
        // Replaces the object between the HEAD and the GET.
        const racing = {
            send: async (command: unknown) => {
                sent.push(command);
                const result = await s3.send(command as never);
                if (command instanceof HeadObjectCommand) {
                    await putObject(
                        s3,
                        sourceKey,
                        Buffer.alloc(2 * 1024 * 1024 + 1),
                    );
                }
                return result;
            },
        } as unknown as S3Client;

        const copyUuid = crypto.randomUUID();
        const db = await copyNode(
            `s3://${BUCKET}/${sourceKey}`,
            copyUuid,
            racing,
        );

        expect(db.write).toHaveBeenCalledTimes(1);
        const [sql, params] = db.write.mock.calls[0] as [string, [string]];
        expect(sql).toContain('NULL');
        expect(params).toEqual([copyUuid]);
        expect(sent.some((c) => c instanceof PutObjectCommand)).toBe(false);
    });

    it('does not duplicate an object the pointer names but we did not mint', async () => {
        const foreignKey = crypto.randomUUID(); // shaped like an fs object key
        const db = await copyNode(
            `s3://${BUCKET}/${foreignKey}`,
            crypto.randomUUID(),
        );
        expect(db.write).not.toHaveBeenCalled();
    });

    it('leaves an external image URL to ride along as is', async () => {
        const sourceKey = legacyKey();
        await putObject(s3, sourceKey, Buffer.from(TINY_PNG_BASE64, 'base64'));
        const db = await copyNode(
            `https://cdn.example.com/${BUCKET}/${sourceKey}`,
            crypto.randomUUID(),
        );
        expect(db.write).not.toHaveBeenCalled();
    });

    it('is a no-op when the copy has no thumbnail', async () => {
        const db = await copyNode(null, crypto.randomUUID());
        expect(db.write).not.toHaveBeenCalled();
    });
});

// The flow `puter.fs.upload()` runs — start, PUT to the signed URLs, complete
// with the returned pointer — through the real controller and the listeners
// this extension registers.
describe('thumbnails extension — signed batch upload through /fs', () => {
    let server: PuterServer;
    let controller: FSController;
    const png = Buffer.from(TINY_PNG_BASE64, 'base64');

    beforeAll(async () => {
        server = await setupTestServer();
        controller = server.controllers.fs as unknown as FSController;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeActor = async (): Promise<{ actor: Actor; username: string }> => {
        const username = `thumb-${Math.random().toString(36).slice(2, 10)}`;
        const user = await server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });
        await generateDefaultFsentries(
            server.clients.db,
            server.stores.user,
            user,
        );
        return {
            username,
            actor: {
                user: {
                    id: user.id,
                    uuid: user.uuid,
                    username,
                    email: user.email ?? null,
                    email_confirmed: true,
                } as Actor['user'],
            },
        };
    };

    const call = async <B>(
        actor: Actor,
        handler: (req: Request, res: Response) => Promise<void>,
        body: B,
    ): Promise<unknown> => {
        let captured: unknown;
        const res = {
            json: (value: unknown) => {
                captured = value;
                return res;
            },
            status: () => res,
            setHeader: () => res,
        };
        const req = {
            body,
            query: {},
            headers: { 'content-type': 'application/json' },
            actor,
            user: { id: actor.user!.id, username: actor.user!.username },
        };
        await runWithContext({ actor }, () =>
            handler.call(
                controller,
                req as unknown as Request,
                res as unknown as Response,
            ),
        );
        return captured;
    };

    const upload = async (
        actor: Actor,
        path: string,
        thumbnailData: (
            started: ClientSignedWriteResponse,
        ) => string | undefined,
    ) => {
        const [started] = (await call<SignedWriteRequest[]>(
            actor,
            controller.startBatchWrites,
            [
                {
                    fileMetadata: { path, size: 4 },
                    thumbnailMetadata: {
                        contentType: 'image/png',
                        size: png.length,
                    },
                },
            ],
        )) as ClientSignedWriteResponse[];
        await fetch(started!.url!, { method: 'PUT', body: 'abcd' });
        if (started!.thumbnailUploadUrl) {
            await fetch(started!.thumbnailUploadUrl, {
                method: 'PUT',
                body: png,
                headers: { 'content-type': 'image/png' },
            });
        }
        const thumbnail = thumbnailData(started!);
        await call<CompleteWriteRequest[]>(
            actor,
            controller.completeBatchWrites,
            [
                {
                    uploadId: started!.sessionId,
                    ...(thumbnail === undefined
                        ? {}
                        : { thumbnailData: thumbnail }),
                },
            ],
        );
        return {
            started: started!,
            entry: (await server.stores.fsEntry.getEntryByPath(path))!,
        };
    };

    it('stores the pointer minted for the uploaded entry', async () => {
        const { actor, username } = await makeActor();
        const { started, entry } = await upload(
            actor,
            `/${username}/Documents/photo.png`,
            (s) => s.thumbnailUrl,
        );

        expect(started.thumbnailUrl).toMatch(
            new RegExp(`^s3://${BUCKET}/thumbnails/${entry.uuid}/`),
        );
        expect(entry.thumbnail).toBe(started.thumbnailUrl);
    });

    it("drops a pointer minted for another user's entry", async () => {
        const victim = await makeActor();
        const { entry: victimEntry } = await upload(
            victim.actor,
            `/${victim.username}/Documents/photo.png`,
            (s) => s.thumbnailUrl,
        );

        const attacker = await makeActor();
        const { entry } = await upload(
            attacker.actor,
            `/${attacker.username}/Documents/decoy.png`,
            () => victimEntry.thumbnail!,
        );

        expect(entry.thumbnail).toBeNull();
    });

    it('keeps an external image URL as given', async () => {
        const { actor, username } = await makeActor();
        const { entry } = await upload(
            actor,
            `/${username}/Documents/linked.png`,
            () => 'https://example.com/thumb.png',
        );
        expect(entry.thumbnail).toBe('https://example.com/thumb.png');
    });

    it('gives a copy its own thumbnail that survives moves and the source being removed', async () => {
        const { actor, username } = await makeActor();
        const s3 = server.clients.s3.get();
        const fs = server.services.fs;
        const { entry: source } = await upload(
            actor,
            `/${username}/Documents/photo.png`,
            (s) => s.thumbnailUrl,
        );
        const userId = source.userId;
        const sourceKey = source.thumbnail!.slice(`s3://${BUCKET}/`.length);
        const desktop = (await server.stores.fsEntry.getEntryByPath(
            `/${username}/Desktop`,
        ))!;
        // The listener writes the row directly, so read it the same way.
        const storedThumbnail = async (uuid: string) => {
            const [row] = (await server.clients.db.read(
                'SELECT `thumbnail` FROM `fsentries` WHERE `uuid` = ?',
                [uuid],
            )) as Array<{ thumbnail: string | null }>;
            return row?.thumbnail ?? null;
        };

        const copy = await runWithContext({ actor }, () =>
            fs.copy(userId, { source, destinationParent: desktop }),
        );
        // `fs.copy.node` is fire-and-forget.
        const copyPointer = await vi.waitFor(async () => {
            const pointer = await storedThumbnail(copy.uuid);
            expect(pointer).toMatch(
                new RegExp(`^s3://${BUCKET}/thumbnails/${copy.uuid}/`),
            );
            return pointer!;
        });
        const copyKey = copyPointer.slice(`s3://${BUCKET}/`.length);

        const documents = (await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        ))!;
        const moved = await runWithContext({ actor }, () =>
            fs.move(userId, {
                source: copy,
                destinationParent: documents,
                newName: 'moved.png',
            }),
        );
        expect(moved.uuid).toBe(copy.uuid);
        expect(await storedThumbnail(moved.uuid)).toBe(copyPointer);

        await runWithContext({ actor }, () =>
            fs.remove(userId, { entry: source }),
        );
        await vi.waitFor(async () => {
            expect(await objectExists(s3, sourceKey)).toBe(false);
        });
        expect(await objectExists(s3, copyKey)).toBe(true);
    });
});
