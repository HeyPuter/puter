/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { posix as pathPosix } from 'node:path';
import { Readable } from 'node:stream';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { FSService } from '../../services/fs/FSService.js';
import { expandTildePath, resolveNode } from '../../services/fs/resolveNode.js';
import { hasNoBackingS3Object, type FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../stores/fs/S3ObjectStore.js';
import { mimeFromName } from '../../util/fileSigning.js';
import { secureFetch } from '../../util/secureHttp.js';

/**
 * Resolve a file-like input sent through the drivers API into a Buffer.
 *
 * Puter-js sends driver args as plain JSON (no multipart). `audio`, `source`,
 * and similar file fields arrive as one of: • a data URL string
 * (`data:image/png;base64,...`) • a web URL string
 * (`https://example.com/image.png`) • a plain path string
 * (`/alice/music/sample.mp3`) • an object with `{ path?, uid?, uuid? }`
 *
 * This helper collapses those shapes into `{ buffer, filename, mimeType }`.
 * Drivers that can hand a stream to their downstream (a mail transport, an
 * upload) use {@link openFileInputStream} instead and never hold the file.
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
        sqlId: number | null; // null in case of base64 URL or a future dynamodb FS.
    } | null;
}

/**
 * A Puter FS reference as drivers receive it: a path string or `{ path?, uid?,
 * uuid? }`.
 */
export type FileInputRef =
    | string
    | { path?: string; uid?: string; uuid?: string };

export interface OpenedFileInput {
    body: Readable;
    /** Object size when the store reports it; null when it does not. */
    contentLength: number | null;
    filename: string;
    mimeType: string;
    fsEntry: NonNullable<LoadedFile['fsEntry']>;
}

type FileInputStores = { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

const DATA_URL_PATTERN = /^data:([^;,]+)?(?:;([^,]*))?,(.*)$/s;

export async function loadFileInput(
    stores: FileInputStores,
    fsService: FSService,
    actor: Actor,
    input: unknown,
    options: { maxBytes?: number; acceptWebInput?: true } = {},
): Promise<LoadedFile> {
    if (!input) {
        throw new HttpError(400, 'Missing file input', {
            legacyCode: 'bad_request',
        });
    }
    requireActorUser(actor);

    // Data URL — decode base64/plain inline.
    if (typeof input === 'string' && input.startsWith('data:')) {
        const match = DATA_URL_PATTERN.exec(input);
        if (!match)
            throw new HttpError(400, 'Invalid data URL', {
                legacyCode: 'bad_request',
            });
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

    // Web URL — fetch via SSRF-guarded secureFetch.
    if (
        typeof input === 'string' &&
        (input.startsWith('https://') || input.startsWith('http://')) &&
        options.acceptWebInput
    ) {
        const response = await secureFetch(input);
        if (!response.ok) {
            throw new HttpError(
                400,
                `Failed to fetch URL (status ${response.status})`,
                { legacyCode: 'bad_request' },
            );
        }
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        assertMax(buffer, options.maxBytes);
        const contentType = response.headers.get('content-type');
        const mime =
            contentType?.split(';')[0]?.trim() ||
            mimeFromName(input) ||
            'application/octet-stream';
        return {
            buffer,
            filename: inferFilenameFromUrlOrPath(input),
            mimeType: mime,
            fsEntry: null,
        };
    }

    // Path string or object reference → resolve into FSEntry, then S3 read.
    const opened = await openFileInputStream(
        stores,
        fsService,
        actor,
        input as FileInputRef,
        options,
    );
    const buffer = await collectStream(opened.body, options.maxBytes);
    return {
        buffer,
        filename: opened.filename,
        mimeType: opened.mimeType,
        fsEntry: opened.fsEntry,
    };
}

/**
 * Resolve a Puter FS reference to its entry, with the checks every driver read
 * needs: it must be a file (not a directory, symlink or shortcut) and `actor`
 * must be allowed to read it.
 */
export async function resolveFileInputEntry(
    stores: FileInputStores,
    fsService: FSService,
    actor: Actor,
    input: FileInputRef,
): Promise<FSEntry> {
    requireActorUser(actor);
    const username = actor.user?.username;
    const expandPath = (path: string | undefined) =>
        path !== undefined ? expandTildePath(path, username) : undefined;
    const ref: { path?: string; uid?: string; uuid?: string } =
        typeof input === 'string'
            ? { path: expandPath(input) }
            : {
                  path: expandPath(
                      typeof input.path === 'string' ? input.path : undefined,
                  ),
                  uid: typeof input.uid === 'string' ? input.uid : undefined,
                  uuid: typeof input.uuid === 'string' ? input.uuid : undefined,
              };

    const entry = await resolveNode(stores.fsEntry, ref, { required: true });
    if (!entry)
        throw new HttpError(404, 'File not found', { legacyCode: 'not_found' });
    if (entry.isDir)
        throw new HttpError(400, 'Expected a file, got a directory', {
            legacyCode: 'bad_request',
        });
    if (entry.isShortcut || entry.isSymlink) {
        throw new HttpError(
            400,
            'Cannot load content of a symlink or shortcut directly',
            { legacyCode: 'shortcut_target_not_found' },
        );
    }
    // ACL gate: resolveNode does global UID/UUID/ID/path lookups, no
    // namespace check. Without this check, an attacker controlling
    // `path`/`uid`/`uuid` (e.g. AI chat `puter_path` content parts) could
    // exfiltrate any user's file. Must run before any read of the object.
    await fsService.checkFSAccess(entry, actor, 'read');
    return entry;
}

/**
 * Open a Puter FS reference as a stream of its bytes. Nothing is buffered: the
 * caller pipes `body` wherever it goes and owns its lifetime. A known size over
 * `maxBytes` is refused (413) before a byte is read; a size that is only
 * discovered while reading is the caller's to enforce.
 */
export async function openFileInputStream(
    stores: FileInputStores,
    fsService: FSService,
    actor: Actor,
    input: FileInputRef,
    options: { maxBytes?: number } = {},
): Promise<OpenedFileInput> {
    const entry = await resolveFileInputEntry(stores, fsService, actor, input);
    const fsEntry = {
        uuid: entry.uuid,
        path: entry.path,
        bucket: entry.bucket,
        bucketRegion: entry.bucketRegion,
        size: entry.size,
        sqlId: entry.id,
    };
    // Empty files (created via `touch`) have no backing S3 object —
    // getObjectStream would throw NoSuchKey, so return empty content.
    if (hasNoBackingS3Object(entry)) {
        return {
            body: Readable.from([]),
            contentLength: 0,
            filename: entry.name,
            mimeType: mimeFromName(entry.name) ?? 'application/octet-stream',
            fsEntry,
        };
    }
    const { body, contentType, contentLength } =
        await stores.s3Object.getObjectStream(
            {
                bucket: stores.s3Object.resolveBucket(entry.bucket),
                objectKey: entry.uuid,
            },
            stores.s3Object.resolveRegion(entry.bucketRegion),
        );
    if (contentLength && options.maxBytes && contentLength > options.maxBytes) {
        body.destroy();
        throw tooLarge(options.maxBytes);
    }
    return {
        body,
        contentLength: contentLength ?? null,
        filename: entry.name,
        mimeType:
            contentType ??
            mimeFromName(entry.name) ??
            'application/octet-stream',
        fsEntry,
    };
}

async function collectStream(
    body: Readable,
    maxBytes: number | undefined,
): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array);
        total += buf.byteLength;
        if (maxBytes && total > maxBytes) {
            body.destroy();
            throw tooLarge(maxBytes);
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks, total);
}

function requireActorUser(actor: Actor): void {
    if (!Number.isFinite(Number(actor?.user?.id ?? NaN))) {
        throw new HttpError(401, 'Unauthorized', {
            legacyCode: 'unauthorized',
        });
    }
}

function tooLarge(maxBytes: number): HttpError {
    return new HttpError(413, `File exceeds max size (${maxBytes} bytes)`, {
        legacyCode: 'storage_limit_reached',
    });
}

function assertMax(buffer: Buffer, maxBytes?: number): void {
    if (maxBytes && buffer.byteLength > maxBytes) {
        throw new HttpError(413, `Input exceeds max size (${maxBytes} bytes)`, {
            legacyCode: 'storage_limit_reached',
        });
    }
}

function filenameFromMime(mime: string): string {
    const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';
    return `input.${ext}`;
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
