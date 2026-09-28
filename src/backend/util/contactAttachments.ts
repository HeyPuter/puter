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

import Busboy from 'busboy';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { sniffImageMime, sniffVideoMime } from './mediaSniff.js';

/**
 * Screenshots and recordings attached to Contact Us, which end up in support's
 * inbox. Type comes from the bytes and the file name is rebuilt, so nothing the
 * sender declared reaches the mail.
 */

/** Max files on one submission. */
export const MAX_ATTACHMENTS = 5;

/** Max decoded size of any one file. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Max size of all files on one submission; base64 in the mail stays under 25
 * MB.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Max characters kept from the caller's file name, before the extension. */
export const MAX_ATTACHMENT_NAME_LENGTH = 80;

/**
 * Accepted sniffed MIME types and the extension each is sent under. SVG is
 * excluded: it carries script.
 */
export const ATTACHMENT_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
};

/**
 * Stripped from file names: control characters (CR/LF could break out of
 * `Content-Disposition`), bidi overrides that disguise an extension, and
 * quotes.
 */
const UNSAFE_NAME_CHARS_REGEX =
    /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069"'\\;]/g;

const mb = (bytes: number): number => Math.round(bytes / (1024 * 1024));
const TOO_LARGE_CLAUSE = `is too large (max ${mb(MAX_ATTACHMENT_BYTES)} MB per file)`;

/** One validated attachment, in the shape nodemailer takes. */
export interface ValidatedAttachment {
    /** Safe display name; extension always matches `contentType`. */
    filename: string;
    /** Sniffed, allow-listed MIME type. */
    contentType: string;
    content: Buffer;
    size: number;
}

/** Stored on the feedback row in place of the payloads. */
export interface AttachmentMetadata {
    name: string;
    type: string;
    size: number;
}

export type AttachmentVerdict =
    | { ok: true; attachment: ValidatedAttachment }
    | { ok: false; reason: string };

export type ContactSubmissionVerdict =
    | {
          ok: true;
          /** The `message` field as sent; the caller validates it. */
          message: string | undefined;
          attachments: ValidatedAttachment[];
      }
    | { ok: false; status: 400 | 413; reason: string };

/**
 * Reduce a caller-supplied file name to a safe display label and give it the
 * extension implied by `extension` (derived from the sniffed type, never from
 * the name). Falls back to `attachment-<n>` when nothing usable survives.
 */
export function sanitizeAttachmentName(
    raw: unknown,
    index: number,
    extension: string,
): string {
    let base = '';
    if (typeof raw === 'string') {
        base = (raw.split(/[/\\]/).pop() ?? '')
            .normalize('NFC')
            .replace(UNSAFE_NAME_CHARS_REGEX, '')
            // Drop the caller's extension — the real one is appended below.
            .replace(/\.[A-Za-z0-9]{1,10}$/, '')
            // No hidden files or `..` if the name is ever written to disk.
            .replace(/^[.\s]+/, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_ATTACHMENT_NAME_LENGTH)
            .trim();
    }
    if (base.length === 0) base = `attachment-${index + 1}`;
    return `${base}.${extension}`;
}

/** Check a file's sniffed type against the allow-list; give it a safe name. */
export function validateAttachment(
    bytes: Buffer,
    rawName: unknown,
    index: number,
): AttachmentVerdict {
    const label = `attachment ${index + 1}`;
    if (bytes.length === 0) {
        return { ok: false, reason: `${label} is empty` };
    }
    const sniffed = sniffImageMime(bytes) ?? sniffVideoMime(bytes);
    const extension = sniffed ? ATTACHMENT_MIME_EXTENSIONS[sniffed] : undefined;
    if (!sniffed || !extension) {
        return {
            ok: false,
            reason: `${label} is not a supported image or video`,
        };
    }
    return {
        ok: true,
        attachment: {
            filename: sanitizeAttachmentName(rawName, index, extension),
            contentType: sniffed,
            content: bytes,
            size: bytes.length,
        },
    };
}

/**
 * Read a multipart submission: one `message` field plus `attachments` files.
 * Caps are enforced as parts arrive. On failure the rest of the body is
 * discarded so the error still reaches the client, up to `maxBodyBytes`; past
 * that the request is destroyed. `reason` never echoes caller input.
 */
export function readContactSubmission(
    req: Readable & { headers: IncomingHttpHeaders },
    {
        maxMessageBytes,
        maxBodyBytes,
    }: { maxMessageBytes: number; maxBodyBytes: number },
): Promise<ContactSubmissionVerdict> {
    return new Promise((resolve) => {
        let parser: Busboy.Busboy;
        try {
            parser = Busboy({
                headers: req.headers,
                // Browsers send non-ASCII file names as raw UTF-8.
                defParamCharset: 'utf8',
                // Busboy trips a limit on reaching it, hence the + 1.
                limits: {
                    fields: 1,
                    fieldSize: maxMessageBytes + 1,
                    files: MAX_ATTACHMENTS,
                    fileSize: MAX_ATTACHMENT_BYTES + 1,
                },
            });
        } catch {
            // Missing or malformed boundary.
            resolve({
                ok: false,
                status: 400,
                reason: 'malformed multipart body',
            });
            return;
        }

        let message: string | undefined;
        const received: { name: string; chunks: Buffer[]; size: number }[] = [];
        let totalBytes = 0;
        let settled = false;

        const fail = (status: 400 | 413, reason: string) => {
            if (settled) return;
            settled = true;
            req.unpipe(parser);
            received.length = 0;
            req.resume();
            resolve({ ok: false, status, reason });
        };

        parser.on('field', (name, value, info) => {
            if (name !== 'message') {
                return fail(400, 'unexpected form field');
            }
            if (info.valueTruncated) {
                return fail(400, '`message` is too long');
            }
            message = value;
        });

        parser.on('file', (name, stream, info) => {
            // Busboy errors an unfinished file stream when the body ends
            // early; unhandled, that crashes the process.
            stream.on('error', () =>
                fail(400, 'attachment upload was interrupted'),
            );
            if (settled) {
                stream.resume();
                return;
            }
            if (name !== 'attachments') {
                stream.resume();
                return fail(400, 'unexpected form field');
            }

            const label = `attachment ${received.length + 1}`;
            const entry = {
                name: info.filename,
                chunks: [] as Buffer[],
                size: 0,
            };
            received.push(entry);
            stream.on('limit', () => fail(413, `${label} ${TOO_LARGE_CLAUSE}`));
            stream.on('data', (chunk: Buffer) => {
                if (settled) return;
                totalBytes += chunk.length;
                if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
                    return fail(
                        413,
                        `attachments are too large in total (max ${mb(MAX_TOTAL_ATTACHMENT_BYTES)} MB)`,
                    );
                }
                entry.chunks.push(chunk);
                entry.size += chunk.length;
            });
        });

        parser.on('fieldsLimit', () => fail(400, 'unexpected form field'));
        parser.on('filesLimit', () =>
            fail(400, `too many attachments (max ${MAX_ATTACHMENTS})`),
        );
        parser.on('error', () => fail(400, 'malformed multipart body'));
        req.on('error', () => fail(400, 'attachment upload was interrupted'));

        parser.on('close', () => {
            if (settled) return;
            settled = true;
            const attachments: ValidatedAttachment[] = [];
            for (const [i, entry] of received.entries()) {
                const verdict = validateAttachment(
                    Buffer.concat(entry.chunks, entry.size),
                    entry.name,
                    i,
                );
                if (verdict.ok === false) {
                    resolve({ ok: false, status: 400, reason: verdict.reason });
                    return;
                }
                attachments.push(verdict.attachment);
            }
            resolve({ ok: true, message, attachments });
        });

        req.pipe(parser);

        let bytesRead = 0;
        req.on('data', (chunk: Buffer) => {
            bytesRead += chunk.length;
            if (bytesRead <= maxBodyBytes) return;
            fail(413, 'request body is too large');
            req.destroy();
        });
    });
}

/** Names and sizes for the stored feedback row — never the payloads. */
export function attachmentMetadata(
    attachments: ValidatedAttachment[],
): AttachmentMetadata[] {
    return attachments.map((a) => ({
        name: a.filename,
        type: a.contentType,
        size: a.size,
    }));
}

/** Body manifest, so a recipient can tell if a gateway stripped the files. */
export function attachmentSummary(attachments: ValidatedAttachment[]): string {
    const lines = attachments.map(
        (a) => `- ${a.filename} (${a.contentType}, ${formatBytes(a.size)})`,
    );
    return [`Attachments (${attachments.length}):`, ...lines].join('\n');
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
