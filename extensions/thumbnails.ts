import {
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

// ── thumbnail.created ───────────────────────────────────────────────
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

    const key = crypto.randomUUID();
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

        const key = crypto.randomUUID();
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

    if (thumb.startsWith('s3://')) {
        const [bucket, key] = thumb.slice(5).split('/');
        entry.thumbnail = await getSignedUrl(
            presignClient,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 604800 },
        );
    } else if (
        thumb.startsWith('https') &&
        thumb.includes(new URL(deps.bucketEndpoint).hostname)
    ) {
        // Legacy format — remove after full migration
        const [bucket, key] = new URL(thumb).pathname.slice(1).split('/');
        entry.thumbnail = await getSignedUrl(
            presignClient,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 604800 },
        );
    } else if (thumb.startsWith('data')) {
        // Inline data-URL migration: upload to S3 and update the DB entry.
        const key = crypto.randomUUID();
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

export const handleFsRemoveNodeThumbnail = async (
    payload: { target: Record<string, unknown> },
    deps: { s3: S3Client },
): Promise<void> => {
    const thumbnailUrl = payload.target.thumbnail as string | undefined;
    if (!thumbnailUrl || !thumbnailUrl.startsWith('s3://')) return;

    const [bucket, key] = thumbnailUrl.slice(5).split('/');
    await deps.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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

// ── thumbnail.upload.prepare ────────────────────────────────────────
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

// ── thumbnail.read ──────────────────────────────────────────────────
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

// ── fs.remove.node ──────────────────────────────────────────────────
// Delete S3 thumbnail when the file is removed.

extension.on(
    'fs.remove.node',
    async (_key, payload: { target: Record<string, unknown> }) => {
        await handleFsRemoveNodeThumbnail(payload, { s3: getClient() });
    },
);
