import { posix as pathPosix } from 'node:path';
import type { FSEntryService } from '../../services/fs/FSEntryService.js';
import { HttpError } from '../../core/http/HttpError.js';
import { resolveNode } from '../../services/fs/resolveNode.js';
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

export async function loadFileInput (
    fsEntryService: FSEntryService,
    userId: number,
    input: unknown,
    options: { maxBytes?: number } = {},
): Promise<LoadedFile> {
    if ( ! input ) {
        throw new HttpError(400, 'Missing file input');
    }

    // Data URL — decode base64/plain inline.
    if ( typeof input === 'string' && input.startsWith('data:') ) {
        const match = DATA_URL_PATTERN.exec(input);
        if ( ! match ) throw new HttpError(400, 'Invalid data URL');
        const mime = match[1] ?? 'application/octet-stream';
        const encoding = (match[2] ?? '').trim();
        const payload = match[3] ?? '';
        const buffer = encoding.toLowerCase() === 'base64'
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
    const ref: { path?: string; uid?: string; uuid?: string } = typeof input === 'string'
        ? { path: input }
        : (() => {
            const record = input as Record<string, unknown>;
            return {
                path: typeof record.path === 'string' ? record.path : undefined,
                uid: typeof record.uid === 'string' ? record.uid : undefined,
                uuid: typeof record.uuid === 'string' ? record.uuid : undefined,
            };
        })();

    const entry = await resolveNode(fsEntryService.entryRepository, ref, { userId, required: true });
    if ( ! entry ) throw new HttpError(404, 'File not found');
    if ( entry.isDir ) throw new HttpError(400, 'Expected a file, got a directory');

    const { body, contentType, contentLength } = await fsEntryService.readContent(entry);
    if ( contentLength && options.maxBytes && contentLength > options.maxBytes ) {
        throw new HttpError(413, `File exceeds max size (${options.maxBytes} bytes)`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await ( const chunk of body ) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += buf.byteLength;
        if ( options.maxBytes && total > options.maxBytes ) {
            body.destroy();
            throw new HttpError(413, `File exceeds max size (${options.maxBytes} bytes)`);
        }
        chunks.push(buf);
    }
    const buffer = Buffer.concat(chunks, total);
    const resolvedMime = contentType ?? mimeFromName(entry.name) ?? 'application/octet-stream';

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

function assertMax (buffer: Buffer, maxBytes?: number): void {
    if ( maxBytes && buffer.byteLength > maxBytes ) {
        throw new HttpError(413, `Input exceeds max size (${maxBytes} bytes)`);
    }
}

function filenameFromMime (mime: string): string {
    const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';
    return `input.${ext}`;
}

export function inferFilenameFromUrlOrPath (value: string, fallback = 'input'): string {
    try {
        const url = new URL(value);
        const basename = pathPosix.basename(url.pathname);
        if ( basename ) return basename;
    } catch {
        // Not a URL; try treating as a file path.
    }
    const basename = pathPosix.basename(value);
    return basename || fallback;
}
