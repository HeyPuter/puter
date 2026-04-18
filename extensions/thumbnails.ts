import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extension } from '@heyputer/backend/src/extensions';
import crypto from 'node:crypto';
const clients = extension.import('client');

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

// S3 client + bucket config — lazily resolved after boot from config.
let s3Client: S3Client | null = null;
let thumbnailBucketName = 'puter-local';
let extensionBucketEndpoint = 'http://127.0.0.1:4566/puter-local/';

function getClient (): S3Client {
    if ( s3Client ) return s3Client;

    // Top-level `thumbnailStore` config when the extension should use a
    // dedicated S3 bucket instead of the main one.
    const thumbStore = extension.config.thumbnailStore;

    if ( thumbStore?.endpoint && thumbStore.credentials ) {
        s3Client = new S3Client({
            region: 'auto',
            endpoint: thumbStore.endpoint,
            credentials: thumbStore.credentials,
        });
        thumbnailBucketName = thumbStore.name ?? 'puter-local';
        extensionBucketEndpoint = thumbStore.endpoint;
    } else {
        // Fall back to the project's S3 wrapper. `clients.s3` is the Puter
        // `S3Client` wrapper (region-cache + lifecycle), not an AWS
        // `S3Client`. Call `.get()` to obtain the underlying AWS client that
        // `getSignedUrl` / `.send(command)` both expect.
        const wrapper = clients.s3;
        s3Client = wrapper.get();
    }
    return s3Client;
}

function base64ParseDataUrl (dataURL: string) {
    dataURL = dataURL.slice(5);
    const mimeType = dataURL.split(';')[0];
    const data = Buffer.from(dataURL.split(',')[1], 'base64');
    return { mimeType, data };
}

function estimateDataUrlSize (dataURL: string) {
    const commaIndex = dataURL.indexOf(',');
    const base64 = commaIndex === -1 ? dataURL : dataURL.slice(commaIndex + 1);
    return Math.ceil(base64.length * 3 / 4);
}

// ── thumbnail.created ───────────────────────────────────────────────
// Intercept data-URL thumbnails before they hit the DB: upload to S3
// and replace the URL with an s3:// pointer.

extension.on('thumbnail.created', async (event: Record<string, unknown>) => {
    const url = event.url;
    if ( typeof url !== 'string' || !url.startsWith('data:') ) return;
    if ( estimateDataUrlSize(url) > MAX_THUMBNAIL_BYTES ) {
        event.url = null;
        return;
    }

    const key = crypto.randomUUID();
    event.url = `s3://${thumbnailBucketName}/${key}`;

    const { mimeType, data } = base64ParseDataUrl(url);
    await getClient().send(new PutObjectCommand({
        Bucket: thumbnailBucketName,
        Key: key,
        Body: data,
        ContentType: mimeType,
    }));
});

// ── thumbnail.upload.prepare ────────────────────────────────────────
// Generate pre-signed upload URLs so the client can PUT directly to S3.

extension.on('thumbnail.upload.prepare', async (event: Record<string, unknown>) => {
    if ( !event || !Array.isArray(event.items) ) return;
    const client = getClient();

    for ( const item of event.items as Array<Record<string, unknown>> ) {
        if ( !item || typeof item !== 'object' ) {
            throw new Error('thumbnail.upload.prepare item is invalid');
        }

        const contentType = typeof item.contentType === 'string' ? item.contentType.trim() : '';
        if ( ! contentType ) continue;

        if ( item.size !== undefined ) {
            const size = Number(item.size);
            if ( !Number.isFinite(size) || size < 0 || size > MAX_THUMBNAIL_BYTES ) continue;
        }

        const key = crypto.randomUUID();
        const command = new PutObjectCommand({
            Bucket: thumbnailBucketName,
            Key: key,
            ContentType: contentType,
        });
        item.uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
        item.thumbnailUrl = `s3://${thumbnailBucketName}/${key}`;
    }
});

// ── thumbnail.read ──────────────────────────────────────────────────
// Convert s3:// or legacy https:// thumbnails to signed URLs.

extension.on('thumbnail.read', async (entry: Record<string, unknown>) => {
    const thumb = entry.thumbnail;
    if ( typeof thumb !== 'string' || !thumb ) return;
    const client = getClient();

    if ( thumb.startsWith('s3://') ) {
        const [bucket, key] = thumb.slice(5).split('/');
        entry.thumbnail = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 604800 },
        );
    } else if ( thumb.startsWith('https') && thumb.includes(new URL(extensionBucketEndpoint).hostname) ) {
        // Legacy format — remove after full migration
        const [bucket, key] = new URL(thumb).pathname.slice(1).split('/');
        entry.thumbnail = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 604800 },
        );
    } else if ( thumb.startsWith('data') ) {
        // Inline data-URL migration: upload to S3 and update the DB entry.
        const key = crypto.randomUUID();
        const { mimeType, data } = base64ParseDataUrl(thumb);
        const newUrl = `s3://${thumbnailBucketName}/${key}`;

        await client.send(new PutObjectCommand({
            Bucket: thumbnailBucketName,
            Key: key,
            Body: data,
            ContentType: mimeType,
        }));

        // Best-effort async DB update
        const uuid = entry.uuid ?? entry.uid;
        if ( uuid ) {
            clients.db.write(
                'UPDATE `fsentries` SET `thumbnail` = ? WHERE `uuid` = ?',
                [newUrl, uuid],
            ).catch((err: unknown) => console.warn('[thumbnails] inline migration failed', err));
        }

        entry.thumbnail = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: thumbnailBucketName, Key: key }),
            { expiresIn: 604800 },
        );
    }
});

// ── fs.remove.node ──────────────────────────────────────────────────
// Delete S3 thumbnail when the file is removed.

extension.on('fs.remove.node', async ({ target }: { target: Record<string, unknown> }) => {
    const thumbnailUrl = target.thumbnail as string | undefined;
    if ( !thumbnailUrl || !thumbnailUrl.startsWith('s3://') ) return;

    const [bucket, key] = thumbnailUrl.slice(5).split('/');
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
});
