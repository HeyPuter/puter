import {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extension } from '@heyputer/backend/src/extensions';
import crypto from 'node:crypto';
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

const mintThumbnailKey = (): string =>
    `${THUMBNAIL_KEY_PREFIX}${crypto.randomUUID()}`;

/**
 * Extract the object key from a stored thumbnail pointer, or null when the
 * pointer isn't one this extension minted.
 *
 * `fsentries.thumbnail` is writable through the FS API, so neither half of the
 * stored string is trusted: the bucket is discarded (callers always pass their
 * own) and the key must sit under {@link THUMBNAIL_KEY_PREFIX} with a random
 * uuid. Honouring an arbitrary key would lend this extension's storage
 * credentials to whatever object the caller named — in the shared-bucket layout
 * that is every user's file, since an fs object's key is its fsentry uuid.
 * Legacy bare-uuid thumbnails fail the check and are treated as absent; they
 * are indistinguishable from a planted pointer, so there is nothing safer to do
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
    const id = key.slice(THUMBNAIL_KEY_PREFIX.length);
    return UUID_PATTERN.test(id) ? key : null;
};

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

// -- thumbnail.created -----------------------------------------------
// Intercept data-URL thumbnails before they hit the DB: upload to S3
// and replace the URL with an s3:// pointer.

export async function handleThumbnailCreated(
    event: Record<string, unknown>,
    deps: { s3: S3Client; bucketName: string },
): Promise<void> {
    const url = event.url;
    if (typeof url !== 'string' || !url.startsWith('data:')) return;

    const decoded = await decodeAndValidateThumbnail(url);
    if (!decoded) {
        event.url = null;
        return;
    }

    const key = mintThumbnailKey();
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

        if (item.size !== undefined) {
            const size = Number(item.size);
            if (
                !Number.isFinite(size) ||
                size < 0 ||
                size > MAX_THUMBNAIL_BYTES
            )
                continue;
        }

        const key = mintThumbnailKey();
        const command = new PutObjectCommand({
            Bucket: deps.bucketName,
            Key: key,
            ContentType: contentType,
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

    if (
        thumb.startsWith('s3://') ||
        // Legacy format — remove after full migration
        (thumb.startsWith('https') &&
            thumb.includes(new URL(deps.bucketEndpoint).hostname))
    ) {
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
        const key = mintThumbnailKey();
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
        const uuid = entry.uuid ?? entry.uid;
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
        db: { write: (sql: string, params: unknown[]) => Promise<unknown> };
    },
): Promise<void> => {
    const copy = payload.copy;
    const thumbnailUrl = copy?.thumbnail;
    if (!copy || !copy.uuid || typeof thumbnailUrl !== 'string') return;

    // Same trust rule as the read and remove paths: only touch objects this
    // extension minted.
    const sourceKey = resolveThumbnailKey(thumbnailUrl);
    if (!sourceKey) return;

    // The copied row points at the SAME S3 object as its source, and
    // fs.remove.node deletes the pointed-to object — so the first removal
    // among the sharers (an overwrite, a trash purge) would break every
    // other sharer's thumbnail. Give the copy an object of its own.
    const newKey = mintThumbnailKey();
    try {
        await deps.s3.send(
            new CopyObjectCommand({
                Bucket: deps.bucketName,
                CopySource: `${deps.bucketName}/${sourceKey}`,
                Key: newKey,
            }),
        );
    } catch (err) {
        // The shared object is already gone (e.g. a sharer was removed
        // before this fix existed) — the pointer is dead either way, so
        // drop it rather than leave the row advertising a thumbnail it
        // doesn't have.
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
    payload: { target: { thumbnail?: string | null } },
    deps: { s3: S3Client; bucketName: string },
): Promise<void> => {
    const thumbnailUrl = payload.target.thumbnail;
    if (!thumbnailUrl) return;

    // Same trust rule as the read path, and load-bearing for the same reason:
    // the pointer decides which object gets deleted, so a key we didn't mint
    // would let the owner of one file destroy an object belonging to someone
    // else just by naming it here.
    const key = resolveThumbnailKey(thumbnailUrl);
    if (!key) return;

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
    });
});
