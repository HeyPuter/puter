import { posix as pathPosix } from 'node:path';
import { HttpError } from '../../core/http/HttpError.js';
import { resolveNode } from '../../services/fs/resolveNode.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../stores/fs/S3ObjectStore.js';
import { mimeFromName } from '../../util/fileSigning.js';

/**
 * Resolve a file-like input sent through the drivers API into a Buffer.
 *
 * puter-js sends driver args as plain JSON (no multipart). `audio`, `source`,
 * and similar file fields arrive as one of:
 *   • a data URL string (`data:image/png;base64,...`)
 *   • a plain path string (`/alice/music/sample.mp3`)
 *   • an object with `{ path?, uid?, uuid? }`
 *
 * This helper collapses those shapes into `{ buffer, filename, mimeType }`.
 */

export interface LoadedFile {
    buffer: Buffer;
    filename: string;
    mimeType: string | null;
    // When the input was an FS reference (path/uid), carries the entry back
    // so drivers can do FS-specific things (e.g. S3 CopyObject for OCR) — null
    // for data-URL inputs.
    fsEntry: {
        uuid: string;
        path: string;
        bucket: string | null;
        bucketRegion: string | null;
        size: number | null;
    } | null;
}

const DATA_URL_PATTERN = /^data:([^;,]+)?(?:;([^,]*))?,(.*)$/s;

export async function loadFileInput(
    stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
    userId: number,
    input: unknown,
    options: { maxBytes?: number } = {},
): Promise<LoadedFile> {
    if (!input) {
        throw new HttpError(400, 'Missing file input');
    }

    // Data URL — decode base64/plain inline.
    if (typeof input === 'string' && input.startsWith('data:')) {
        const match = DATA_URL_PATTERN.exec(input);
        if (!match) throw new HttpError(400, 'Invalid data URL');
        const mime = match[1] ?? 'application/octet-stream';
        const encoding = (match[2] ?? '').trim();
        const payload = match[3] ?? '';
        const buffer =
            encoding.toLowerCase() === 'base64'
                ? Buffer.from(payload, 'base64')
                : Buffer.from(decodeURIComponent(payload));
        assertMax(buffer, options.maxBytes);
        return {
            buffer,
            filename: filenameFromMime(mime),
            mimeType: mime,
            fsEntry: null,
        };
    }

    // Path string or object reference → resolve into FSEntry, then S3 read.
    const ref: { path?: string; uid?: string; uuid?: string } =
        typeof input === 'string'
            ? { path: input }
            : (() => {
                  const record = input as Record<string, unknown>;
                  return {
                      path:
                          typeof record.path === 'string'
                              ? record.path
                              : undefined,
                      uid:
                          typeof record.uid === 'string'
                              ? record.uid
                              : undefined,
                      uuid:
                          typeof record.uuid === 'string'
                              ? record.uuid
                              : undefined,
                  };
              })();

    const entry = await resolveNode(stores.fsEntry, ref, {
        userId,
        required: true,
    });
    if (!entry) throw new HttpError(404, 'File not found');
    if (entry.isDir)
        throw new HttpError(400, 'Expected a file, got a directory');
    if (entry.isShortcut || entry.isSymlink) {
        throw new HttpError(
            400,
            'Cannot load content of a symlink or shortcut directly',
        );
    }
    if (!entry.bucket) {
        throw new HttpError(500, 'Entry has no backing storage');
    }

    // S3 object key is recorded in entry.metadata.objectKey when written by
    // fsv2; older rows fall back to the entry uuid.
    const objectKey = deriveObjectKey(entry);
    const { body, contentType, contentLength } =
        await stores.s3Object.getObjectStream(
            { bucket: entry.bucket, objectKey },
            stores.s3Object.resolveRegion(entry.bucketRegion),
        );
    if (contentLength && options.maxBytes && contentLength > options.maxBytes) {
        body.destroy();
        throw new HttpError(
            413,
            `File exceeds max size (${options.maxBytes} bytes)`,
        );
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array);
        total += buf.byteLength;
        if (options.maxBytes && total > options.maxBytes) {
            body.destroy();
            throw new HttpError(
                413,
                `File exceeds max size (${options.maxBytes} bytes)`,
            );
        }
        chunks.push(buf);
    }
    const buffer = Buffer.concat(chunks, total);
    const resolvedMime =
        contentType ?? mimeFromName(entry.name) ?? 'application/octet-stream';

    return {
        buffer,
        filename: entry.name,
        mimeType: resolvedMime,
        fsEntry: {
            uuid: entry.uuid,
            path: entry.path,
            bucket: entry.bucket,
            bucketRegion: entry.bucketRegion,
            size: entry.size,
        },
    };
}

function assertMax(buffer: Buffer, maxBytes?: number): void {
    if (maxBytes && buffer.byteLength > maxBytes) {
        throw new HttpError(413, `Input exceeds max size (${maxBytes} bytes)`);
    }
}

function filenameFromMime(mime: string): string {
    const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';
    return `input.${ext}`;
}

// Mirrors FSEntryService's private deriveObjectKeyFromEntry helper. fsv2-era
// rows persist an `objectKey` in metadata; older rows simply use the uuid.
function deriveObjectKey(entry: {
    uuid: string;
    metadata: string | null;
}): string {
    if (entry.metadata) {
        try {
            const parsed = JSON.parse(entry.metadata);
            if (
                parsed &&
                typeof parsed.objectKey === 'string' &&
                parsed.objectKey.length > 0
            ) {
                return parsed.objectKey;
            }
        } catch {
            // Not JSON — fall through.
        }
    }
    return entry.uuid;
}

export function inferFilenameFromUrlOrPath(
    value: string,
    fallback = 'input',
): string {
    try {
        const url = new URL(value);
        const basename = pathPosix.basename(url.pathname);
        if (basename) return basename;
    } catch {
        // Not a URL; try treating as a file path.
    }
    const basename = pathPosix.basename(value);
    return basename || fallback;
}
