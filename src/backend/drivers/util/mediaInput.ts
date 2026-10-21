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

/**
 * Image and video inputs that name a Puter file. Large media reaches the AI
 * drivers this way rather than inline: the file is read within the caller's
 * access, then handed to a provider that fetches it itself as a short-lived
 * URL, or streamed or loaded right before the upstream call.
 */

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { FSService } from '../../services/fs/FSService.js';
import {
    decodeStrictBase64,
    sniffImageMime,
    sniffVideoMime,
} from '../../util/mediaSniff.js';
import { secureFetch } from '../../util/secureHttp.js';
import { dataUriBytes, parseDataUri } from './dataUri.js';
import {
    fileInputTooLarge,
    openFileInputStream,
    readBoundedBody,
    resolveFileInput,
    resolveFileInputEntry,
} from './fileInput.js';
import { isHttpUrl } from './imageInput.js';
import { isUpstreamTimeoutError } from './upstreamErrors.js';

export interface MediaInputDeps {
    stores: Parameters<typeof resolveFileInput>[0];
    fs: FSService;
}

/** A source video sent inline as a data URI; larger ones come as a URL or file. */
export const MAX_INLINE_VIDEO_BYTES = 1024 * 1024;

/** Most image inputs one request may name as Puter files. */
export const MAX_PUTER_IMAGE_INPUTS = 32;
/** Stored size of all of one request's Puter file image inputs together. */
export const MAX_PUTER_IMAGE_INPUT_BYTES = 32 * 1024 * 1024;

const PUTER_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);

/** Covers the `ftyp` box and the EBML DocType that `sniffVideoMime` reads. */
const VIDEO_SNIFF_BYTES = 64;
/** Base64 characters decoded to tell raw image data from a path. */
const BASE64_SNIFF_CHARS = 24;

const badRequest = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

const notAVideo = (): HttpError =>
    badRequest('input_video must be an MP4, QuickTime, WebM or Matroska video');

/**
 * Whether a string media input names a Puter file: an absolute or `~/` path.
 * Raw base64 of a JPEG also starts with `/`, so a string whose head decodes to
 * an image is not a path. Only the head is decoded, so large inputs cost
 * nothing extra.
 */
export function isPuterFilePath(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (value.startsWith('~/')) return true;
    if (!value.startsWith('/')) return false;
    const head = decodeStrictBase64(value.slice(0, BASE64_SNIFF_CHARS));
    return !head || !sniffImageMime(head);
}

/**
 * Bytes a `data:` URI carries, estimated from its length without parsing it, so
 * an oversized URI is refused before a regexp or decode runs over it.
 */
export function dataUriByteLength(uri: string): number {
    const comma = uri.indexOf(',');
    if (comma === -1) return 0;
    const header = uri.slice(0, comma);
    const payload = uri.length - comma - 1;
    return header.includes(';base64') ? Math.floor((payload * 3) / 4) : payload;
}

/**
 * The image inputs among `values` that are Puter file paths, read within the
 * caller's access and returned as data URIs keyed by path. Every size is
 * checked from the file's metadata before any is read.
 */
export async function readPuterImageInputs(
    deps: MediaInputDeps,
    actor: Actor,
    values: unknown[],
): Promise<Map<string, string>> {
    const paths = [...new Set(values.filter(isPuterFilePath))];
    const inlined = new Map<string, string>();
    if (paths.length === 0) return inlined;
    if (paths.length > MAX_PUTER_IMAGE_INPUTS) {
        throw badRequest(
            `At most ${MAX_PUTER_IMAGE_INPUTS} image inputs can be Puter files`,
        );
    }

    const files = await Promise.all(
        paths.map((path) =>
            resolveFileInput(deps.stores, deps.fs, actor, path, {
                maxBytes: MAX_PUTER_IMAGE_INPUT_BYTES,
            }),
        ),
    );
    const totalBytes = files.reduce(
        (sum, file) => sum + (file.fsEntry?.size ?? 0),
        0,
    );
    if (totalBytes > MAX_PUTER_IMAGE_INPUT_BYTES) {
        throw fileInputTooLarge(MAX_PUTER_IMAGE_INPUT_BYTES);
    }

    const loaded = await Promise.all(files.map((file) => file.load()));
    loaded.forEach(({ buffer }, i) => {
        const mimeType = sniffImageMime(buffer);
        if (!mimeType || !PUTER_IMAGE_MIME_TYPES.has(mimeType)) {
            throw badRequest(
                'Image inputs must be PNG, JPEG, WebP or GIF images',
            );
        }
        inlined.set(
            paths[i]!,
            `data:${mimeType};base64,${buffer.toString('base64')}`,
        );
    });
    return inlined;
}

/**
 * A Puter file the caller can read, as a presigned URL for a provider that
 * fetches the video itself. The first bytes must be a video, and their type is
 * what the URL serves.
 */
export async function signedPuterVideoUrl(
    deps: MediaInputDeps,
    actor: Actor,
    path: string,
    {
        maxBytes,
        expiresInSeconds,
    }: { maxBytes: number; expiresInSeconds: number },
): Promise<string> {
    const entry = await resolveFileInputEntry(
        deps.stores,
        deps.fs,
        actor,
        path,
    );
    if ((entry.size ?? 0) > maxBytes) throw fileInputTooLarge(maxBytes);
    if (!entry.size) throw notAVideo();

    const s3 = deps.stores.s3Object;
    const object = {
        bucket: s3.resolveBucket(entry.bucket),
        objectKey: entry.uuid,
    };
    const region = s3.resolveRegion(entry.bucketRegion);
    const { body } = await s3.getObjectStream(
        { ...object, range: `bytes=0-${VIDEO_SNIFF_BYTES - 1}` },
        region,
    );
    const head = (await readHead(body, VIDEO_SNIFF_BYTES)).head;
    body.destroy();
    const mimeType = sniffVideoMime(head);
    if (!mimeType) throw notAVideo();

    return s3.createSignedReadUrl(
        { ...object, expiresInSeconds, contentType: mimeType },
        region,
    );
}

/** A source video as bytes to stream into an upstream request. */
export interface VideoInputStream {
    /** Sniffed from the first bytes; null when they aren't a known video. */
    mimeType: string | null;
    /** Exact, so the upstream request can declare its length. */
    byteLength: number;
    chunks: AsyncIterable<Buffer> | Iterable<Buffer>;
    /** Releases the source when the bytes won't be read. */
    cancel(): void;
}

/**
 * A source video for a provider that takes the bytes: a data URI is decoded, a
 * web URL fetched and a Puter file read within the caller's access. Web URLs
 * and Puter files stream when their length is known; `timeoutMs` bounds a web
 * URL's whole download.
 */
export async function openVideoInput(
    deps: MediaInputDeps,
    actor: Actor,
    input: string,
    {
        maxBytes,
        timeoutMs,
        signal,
    }: { maxBytes: number; timeoutMs: number; signal?: AbortSignal },
): Promise<VideoInputStream> {
    if (input.startsWith('data:')) {
        if (dataUriByteLength(input) > maxBytes) {
            throw fileInputTooLarge(maxBytes);
        }
        const uri = parseDataUri(input, 'application/octet-stream');
        if (!uri) throw badRequest('Invalid data URL');
        return fromBuffer(dataUriBytes(uri));
    }

    if (isHttpUrl(input)) {
        signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(timeoutMs);
        const fetchSignal = signal
            ? AbortSignal.any([signal, timeout])
            : timeout;
        let response: Response;
        try {
            response = await secureFetch(input, { signal: fetchSignal });
        } catch (err) {
            throw sourceFetchError(err, signal, timeoutMs);
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw badRequest(
                `Failed to fetch input_video (status ${response.status})`,
            );
        }
        const declared = Number(response.headers.get('content-length'));
        const encoding = response.headers.get('content-encoding');
        // A decoded body differs from its declared length, so it's buffered.
        if (
            response.body &&
            Number.isSafeInteger(declared) &&
            declared > 0 &&
            (!encoding || encoding === 'identity')
        ) {
            if (declared > maxBytes) {
                await response.body.cancel();
                throw fileInputTooLarge(maxBytes);
            }
            try {
                return await fromStream(
                    Readable.fromWeb(response.body as WebReadableStream),
                    declared,
                );
            } catch (err) {
                throw sourceFetchError(err, signal, timeoutMs);
            }
        }
        try {
            return fromBuffer(await readBoundedBody(response, maxBytes));
        } catch (err) {
            throw sourceFetchError(err, signal, timeoutMs);
        }
    }

    const opened = await openFileInputStream(
        deps.stores,
        deps.fs,
        actor,
        input,
        { maxBytes },
    );
    if (opened.contentLength !== null) {
        return fromStream(opened.body, opened.contentLength);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of opened.body) {
        total += chunk.byteLength;
        if (total > maxBytes) {
            opened.body.destroy();
            throw fileInputTooLarge(maxBytes);
        }
        chunks.push(chunk);
    }
    return fromBuffer(Buffer.concat(chunks, total));
}

function sourceFetchError(
    err: unknown,
    signal: AbortSignal | undefined,
    timeoutMs: number,
): unknown {
    if (signal?.aborted) return signal.reason;
    if (err instanceof HttpError) return err;
    if (isUpstreamTimeoutError(err)) {
        return badRequest(
            `Timed out fetching input_video after ${timeoutMs} ms`,
        );
    }
    return badRequest('Failed to fetch input_video');
}

function fromBuffer(bytes: Buffer): VideoInputStream {
    return {
        mimeType: sniffVideoMime(bytes),
        byteLength: bytes.byteLength,
        chunks: [bytes],
        cancel: () => {},
    };
}

async function fromStream(
    body: Readable,
    byteLength: number,
): Promise<VideoInputStream> {
    const { head, rest } = await readHead(body, VIDEO_SNIFF_BYTES);
    return {
        mimeType: sniffVideoMime(head),
        byteLength,
        chunks: rest,
        cancel: () => body.destroy(),
    };
}

/**
 * Reads at least `bytes` from `body` (less only if it ends first), and returns
 * them with an iterable that replays them before the remainder.
 */
async function readHead(
    body: Readable,
    bytes: number,
): Promise<{ head: Buffer; rest: AsyncIterable<Buffer> }> {
    // A body converted from a web stream yields Uint8Arrays.
    const iterator = body[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
    const nextChunk = async (): Promise<Buffer | undefined> => {
        const next = await iterator.next();
        if (next.done) return undefined;
        const chunk = next.value;
        return Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    };
    const read: Buffer[] = [];
    let total = 0;
    while (total < bytes) {
        const chunk = await nextChunk();
        if (!chunk) break;
        read.push(chunk);
        total += chunk.byteLength;
    }
    async function* rest(): AsyncGenerator<Buffer> {
        try {
            yield* read;
            for (;;) {
                const chunk = await nextChunk();
                if (!chunk) return;
                yield chunk;
            }
        } finally {
            body.destroy();
        }
    }
    return { head: Buffer.concat(read, total), rest: rest() };
}
