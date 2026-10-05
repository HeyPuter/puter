import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extension } from '@heyputer/backend/src/extensions';
import { isMissingObjectError } from '@heyputer/backend/src/stores/fs/S3ObjectStore';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
const clients = extension.import('client');

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_THUMBNAIL_PIXELS = 64e6;

// Namespace every object this extension writes. An fs object's key is its
// bare fsentry uuid and the default config points `thumbnailStore.name` at
// the same bucket as `s3_bucket`, so without a prefix of our own there is no
// way to tell a thumbnail we minted from any other object in the deployment.
const THUMBNAIL_KEY_PREFIX = 'thumbnails/';
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string =>
    typeof value === 'string' && UUID_PATTERN.test(value);

// `thumbnails/<entry uuid>/<random uuid>`: the entry segment binds the object
// to the entry it was minted for, which is what writes and deletes check.
const mintThumbnailKey = (entryUuid: string): string =>
    `${THUMBNAIL_KEY_PREFIX}${entryUuid}/${crypto.randomUUID()}`;

/**
 * Extract the object key from a stored thumbnail pointer, or null when the
 * pointer isn't one this extension minted.
 *
 * `fsentries.thumbnail` is writable through the FS API, so neither half of the
 * stored string is trusted: the bucket is discarded (callers always pass their
 * own) and the key must sit under {@link THUMBNAIL_KEY_PREFIX} as either
 * `<uuid>` (minted before keys were bound to entries) or `<entry uuid>/<uuid>`.
 * Honouring an arbitrary key would lend this extension's storage credentials to
 * whatever object the caller named — in the shared-bucket layout that is every
 * user's file, since an fs object's key is its fsentry uuid. Bare-uuid keys
 * from before the prefix fail the check and are treated as absent; they are
 * indistinguishable from a planted pointer, so there is nothing safer to do
 * with them than stop signing them.
 */
const resolveThumbnailKey = (pointer: string): string | null => {
    let key: string;
    if (pointer.startsWith('s3://')) {
        const rest = pointer.slice('s3://'.length);
        const slash = rest.indexOf('/');
        if (slash === -1) return null;
        key = rest.slice(slash + 1);
    } else {
        let pathname: string;
        try {
            pathname = new URL(pointer).pathname;
        } catch {
            return null;
        }
        const segments = pathname.replace(/^\/+/, '').split('/');
        segments.shift(); // bucket
        key = segments.join('/');
    }
    if (!key.startsWith(THUMBNAIL_KEY_PREFIX)) return null;
    const segments = key.slice(THUMBNAIL_KEY_PREFIX.length).split('/');
    return segments.length <= 2 && segments.every(isUuid) ? key : null;
};

// The entry a resolved key was minted for. Null for an unbound key, whose
// holder can't be told apart from a row that copied or planted the pointer.
const thumbnailKeyOwner = (key: string): string | null => {
    const segments = key.slice(THUMBNAIL_KEY_PREFIX.length).split('/');
    return segments.length === 2 ? segments[0] : null;
};

// Whether a stored thumbnail names an object in our storage. Anything else is
// an external image URL the client supplied: shown as given, never copied or
// deleted.
const isStoragePointer = (pointer: string, bucketEndpoint: string): boolean =>
    pointer.startsWith('s3://') ||
    // Legacy format — remove after full migration
    (pointer.startsWith('https') &&
        pointer.includes(new URL(bucketEndpoint).hostname));

// S3 client + bucket config — lazily resolved after boot from config.
let s3Client: S3Client | null = null;
let s3PresignClient: S3Client | null = null;
let thumbnailBucketName = 'puter-local';
let extensionBucketEndpoint = 'http://127.0.0.1:4566/puter-local/';

function resolveClients(): { send: S3Client; presign: S3Client } {
    if (s3Client && s3PresignClient) {
        return { send: s3Client, presign: s3PresignClient };
    }

    // Top-level `thumbnailStore` config when the extension should use a
    // dedicated S3 bucket instead of the main one.
    const thumbStore = extension.config.thumbnailStore;

    if (thumbStore?.endpoint && thumbStore.credentials) {
        s3Client = new S3Client({
            region: 'auto',
            endpoint: thumbStore.endpoint,
            credentials: thumbStore.credentials,
        });
        // Dedicated thumbnail buckets use a single endpoint for both
        // server-side ops and browser-facing presigned URLs.
        s3PresignClient = s3Client;
        thumbnailBucketName = thumbStore.name ?? 'puter-local';
        extensionBucketEndpoint = thumbStore.endpoint;
    } else {
        // Fall back to the project's S3 wrapper. `clients.s3` is the Puter
        // `S3Client` wrapper (region-cache + lifecycle), not an AWS
        // `S3Client`. `.get()` is for server-side ops (uses the internal
        // `endpoint`); `.getForPresign()` is for browser-facing presigned
        // URLs (uses `publicEndpoint` when configured — required for
        // self-host where the docker-internal endpoint isn't reachable
        // from the browser).
        const wrapper = clients.s3;
        s3Client = wrapper.get();
        s3PresignClient = wrapper.getForPresign();
    }
    return { send: s3Client, presign: s3PresignClient };
}

function getClient(): S3Client {
    return resolveClients().send;
}

function getPresignClient(): S3Client {
    return resolveClients().presign;
}

function base64ParseDataUrl(dataURL: string) {
    dataURL = dataURL.slice(5);
    const mimeType = dataURL.split(';')[0];
    const data = Buffer.from(dataURL.split(',')[1], 'base64');
    return { mimeType, data };
}

// Strictly decode a data: URL and validate the decoded image. Encoded-string
// length lies about decoded byte count (whitespace, padding) and says nothing
// about pixel count — a 2MB PNG can decompress to hundreds of MB of raster.
async function decodeAndValidateThumbnail(
    dataURL: string,
): Promise<{ mimeType: string; data: Buffer } | null> {
    const commaIdx = dataURL.indexOf(',');
    if (commaIdx === -1) return null;
    const mimeType = dataURL.slice(5, commaIdx).split(';')[0];

    const data = Buffer.from(dataURL.slice(commaIdx + 1), 'base64');
    if (data.length === 0 || data.length > MAX_THUMBNAIL_BYTES) return null;

    try {
        await sharp(data, {
            limitInputPixels: MAX_THUMBNAIL_PIXELS,
            density: 72,
            failOn: 'error',
        }).metadata();
    } catch {
        return null;
    }

    return { mimeType, data };
}

// A storage pointer a client hands back after a presigned upload is kept only
// if it names a key minted for this entry and an object within the size bound.
async function vetUploadedThumbnail(
    pointer: string,
    entryUuid: unknown,
    deps: { s3: S3Client; bucketName: string },
): Promise<string | null> {
    const key = resolveThumbnailKey(pointer);
    if (!key || thumbnailKeyOwner(key) !== entryUuid) return null;

    let size: number | undefined;
    try {
        const head = await deps.s3.send(
            new HeadObjectCommand({ Bucket: deps.bucketName, Key: key }),
        );
        size = head.ContentLength;
    } catch (err) {
        if (!isMissingObjectError(err)) {
            console.warn(
                '[thumbnails] failed to check uploaded thumbnail',
                err,
            );
        }
        return null;
    }
    if (typeof size !== 'number') return null;
    if (size > MAX_THUMBNAIL_BYTES) {
        // Only reachable on a store that doesn't enforce the signed length.
        // The key is this entry's own, so removing it is safe.
        try {
            await deps.s3.send(
                new DeleteObjectCommand({ Bucket: deps.bucketName, Key: key }),
            );
        } catch (err) {
            console.warn(
                '[thumbnails] failed to remove oversized thumbnail',
                err,
            );
        }
        return null;
    }
    return `s3://${deps.bucketName}/${key}`;
}

// -- thumbnail.created -----------------------------------------------
// Intercept data-URL thumbnails before they hit the DB: upload to S3
// and replace the URL with an s3:// pointer bound to the entry.

export async function handleThumbnailCreated(
    event: Record<string, unknown>,
    deps: { s3: S3Client; bucketName: string; bucketEndpoint: string },
): Promise<void> {
    const url = event.url;
    if (typeof url !== 'string') return;

    if (!url.startsWith('data:')) {
        if (isStoragePointer(url, deps.bucketEndpoint)) {
            event.url = await vetUploadedThumbnail(url, event.uuid, deps);
        }
        return;
    }

    const entryUuid = event.uuid;
    if (!isUuid(entryUuid)) {
        event.url = null;
        return;
    }

    const decoded = await decodeAndValidateThumbnail(url);
    if (!decoded) {
        event.url = null;
        return;
    }

    const key = mintThumbnailKey(entryUuid);
    event.url = `s3://${deps.bucketName}/${key}`;

    await deps.s3.send(
        new PutObjectCommand({
            Bucket: deps.bucketName,
            Key: key,
            Body: decoded.data,
            ContentType: decoded.mimeType,
        }),
    );
}

export const handleThumbnailUploadPrepare = async (
    event: Record<string, unknown>,
    deps: { s3Presign: S3Client; bucketName: string },
): Promise<void> => {
    if (!event || !Array.isArray(event.items)) return;
    const presignClient = deps.s3Presign;

    for (const item of event.items as Array<Record<string, unknown>>) {
        if (!item || typeof item !== 'object') {
            throw new Error('thumbnail.upload.prepare item is invalid');
        }

        const contentType =
            typeof item.contentType === 'string' ? item.contentType.trim() : '';
        if (!contentType) continue;

        const size = item.size;
        if (
            typeof size !== 'number' ||
            !Number.isInteger(size) ||
            size < 0 ||
            size > MAX_THUMBNAIL_BYTES
        )
            continue;
        if (!isUuid(item.item_uid)) continue;

        const key = mintThumbnailKey(item.item_uid);
        const command = new PutObjectCommand({
            Bucket: deps.bucketName,
            Key: key,
            ContentType: contentType,
            // Signing covers `content-length`, so a body of any other size
            // fails the signature instead of landing.
            ContentLength: size,
        });
        item.uploadUrl = await getSignedUrl(presignClient, command, {
            expiresIn: 900,
        });
        item.thumbnailUrl = `s3://${deps.bucketName}/${key}`;
    }
};

export const handleThumbnailRead = async (
    entry: Record<string, unknown>,
    deps: {
        s3: S3Client;
        s3Presign: S3Client;
        bucketName: string;
        bucketEndpoint: string;
        db: { write: (sql: string, params: unknown[]) => Promise<unknown> };
    },
): Promise<void> => {
    const thumb = entry.thumbnail;
    if (typeof thumb !== 'string' || !thumb) return;
    const presignClient = deps.s3Presign;

    if (isStoragePointer(thumb, deps.bucketEndpoint)) {
        const key = resolveThumbnailKey(thumb);
        if (!key) {
            // Not a pointer we minted — refuse to sign it rather than hand
            // out a presigned read of whatever object it names.
            entry.thumbnail = null;
            return;
        }
        entry.thumbnail = await getSignedUrl(
            presignClient,
            new GetObjectCommand({ Bucket: deps.bucketName, Key: key }),
            { expiresIn: 604800 },
        );
    } else if (thumb.startsWith('data')) {
        // Inline data-URL migration: upload to S3 and update the DB entry.
        const uuid = entry.uuid ?? entry.uid;
        if (!isUuid(uuid)) return;
        const key = mintThumbnailKey(uuid);
        const { mimeType, data } = base64ParseDataUrl(thumb);
        const newUrl = `s3://${deps.bucketName}/${key}`;

        await deps.s3.send(
            new PutObjectCommand({
                Bucket: deps.bucketName,
                Key: key,
                Body: data,
                ContentType: mimeType,
            }),
        );

        // Best-effort async DB update
        if (uuid) {
            deps.db
                .write(
                    'UPDATE `fsentries` SET `thumbnail` = ? WHERE `uuid` = ?',
                    [newUrl, uuid],
                )
                .catch((err: unknown) =>
                    console.warn('[thumbnails] inline migration failed', err),
                );
        }

        entry.thumbnail = await getSignedUrl(
            presignClient,
            new GetObjectCommand({ Bucket: deps.bucketName, Key: key }),
            { expiresIn: 604800 },
        );
    }
};

export const handleFsCopyNodeThumbnail = async (
    payload: { copy?: { thumbnail?: string | null; uuid?: string } | null },
    deps: {
        s3: S3Client;
        bucketName: string;
        bucketEndpoint: string;
        db: { write: (sql: string, params: unknown[]) => Promise<unknown> };
    },
): Promise<void> => {
    const copy = payload.copy;
    const thumbnailUrl = copy?.thumbnail;
    if (!copy || !isUuid(copy.uuid) || typeof thumbnailUrl !== 'string') return;
    if (!isStoragePointer(thumbnailUrl, deps.bucketEndpoint)) return;

    // Same trust rule as the read and remove paths: only touch objects this
    // extension minted.
    const sourceKey = resolveThumbnailKey(thumbnailUrl);
    if (!sourceKey) return;

    // The copied row points at the SAME object as its source. Give the copy
    // an object of its own, bound to it, so removing either entry leaves the
    // other's thumbnail alone.
    const newKey = mintThumbnailKey(copy.uuid);
    try {
        // Nothing larger than an upload may produce gets duplicated; such an
        // object came in through an unbounded upload URL.
        const head = await deps.s3.send(
            new HeadObjectCommand({ Bucket: deps.bucketName, Key: sourceKey }),
        );
        if (
            typeof head.ContentLength !== 'number' ||
            head.ContentLength > MAX_THUMBNAIL_BYTES
        ) {
            throw new Error('thumbnail exceeds the size bound');
        }
        // Read and rewrite rather than CopyObject: a copy source skips any path
        // in the client's endpoint, so it can miss an object Bucket/Key reach.
        const source = await deps.s3.send(
            new GetObjectCommand({ Bucket: deps.bucketName, Key: sourceKey }),
        );
        // The object can be replaced after the HEAD; bound what gets buffered.
        if ((source.ContentLength ?? 0) > MAX_THUMBNAIL_BYTES) {
            (source.Body as Readable | undefined)?.destroy();
            throw new Error('thumbnail exceeds the size bound');
        }
        const body = await source.Body?.transformToByteArray();
        if (!body) throw new Error('thumbnail has no body');
        await deps.s3.send(
            new PutObjectCommand({
                Bucket: deps.bucketName,
                Key: newKey,
                Body: body,
                ContentType: source.ContentType,
            }),
        );
    } catch (err) {
        // The shared object is gone or oversized — drop the pointer rather
        // than leave the row advertising a thumbnail it doesn't have.
        await deps.db.write(
            'UPDATE `fsentries` SET `thumbnail` = NULL WHERE `uuid` = ?',
            [copy.uuid],
        );
        console.warn('[thumbnails] failed to duplicate thumbnail on copy', err);
        return;
    }

    await deps.db.write(
        'UPDATE `fsentries` SET `thumbnail` = ? WHERE `uuid` = ?',
        [`s3://${deps.bucketName}/${newKey}`, copy.uuid],
    );
};

export const handleFsRemoveNodeThumbnail = async (
    payload: { target: { thumbnail?: string | null; uuid?: string } },
    deps: { s3: S3Client; bucketName: string; bucketEndpoint: string },
): Promise<void> => {
    const { thumbnail: thumbnailUrl, uuid } = payload.target;
    if (!thumbnailUrl || !isStoragePointer(thumbnailUrl, deps.bucketEndpoint))
        return;

    // The pointer decides which object gets deleted, and a key is visible to
    // anyone who can list the entry holding it. Only a key minted for this
    // entry is deleted; an unbound one may be shared or planted, so it stays.
    const key = resolveThumbnailKey(thumbnailUrl);
    if (!key || thumbnailKeyOwner(key) !== uuid) return;

    await deps.s3.send(
        new DeleteObjectCommand({ Bucket: deps.bucketName, Key: key }),
    );
};

extension.on(
    'thumbnail.created',
    async (_key, event: Record<string, unknown>) => {
        await handleThumbnailCreated(event, {
            s3: getClient(),
            bucketName: thumbnailBucketName,
            bucketEndpoint: extensionBucketEndpoint,
        });
    },
);

// -- thumbnail.upload.prepare ----------------------------------------
// Generate pre-signed upload URLs so the client can PUT directly to S3.

extension.on(
    'thumbnail.upload.prepare',
    async (_key, event: Record<string, unknown>) => {
        await handleThumbnailUploadPrepare(event, {
            s3Presign: getPresignClient(),
            bucketName: thumbnailBucketName,
        });
    },
);

// -- thumbnail.read --------------------------------------------------
// Convert s3:// or legacy https:// thumbnails to signed URLs.

extension.on('thumbnail.read', async (_key, entry: Record<string, unknown>) => {
    await handleThumbnailRead(entry, {
        s3: getClient(),
        s3Presign: getPresignClient(),
        bucketName: thumbnailBucketName,
        bucketEndpoint: extensionBucketEndpoint,
        db: clients.db,
    });
});

// -- fs.copy.node ----------------------------------------------------
// A copied entry initially shares its source's thumbnail object; duplicate
// it so removing either entry can't break the other's thumbnail.

extension.on('fs.copy.node', async (_key, payload) => {
    await handleFsCopyNodeThumbnail(
        payload as {
            copy?: { thumbnail?: string | null; uuid?: string } | null;
        },
        {
            s3: getClient(),
            bucketName: thumbnailBucketName,
            bucketEndpoint: extensionBucketEndpoint,
            db: clients.db,
        },
    );
});

// -- fs.remove.node --------------------------------------------------
// Delete S3 thumbnail when the file is removed.

extension.on('fs.remove.node', async (_key, payload) => {
    await handleFsRemoveNodeThumbnail(payload, {
        s3: getClient(),
        bucketName: thumbnailBucketName,
        bucketEndpoint: extensionBucketEndpoint,
    });
});
