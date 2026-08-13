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

import {
    decodeStrictBase64,
    sniffImageMime,
    sniffVideoMime,
} from './mediaSniff.js';

/**
 * Validation for the screenshots and screen recordings people attach to the
 * Contact Us form. Everything here treats the submission as hostile: the caller
 * chooses the byte count, the file name and the claimed type, and the result is
 * emailed to a human at Puter who will open it.
 *
 * The posture, in order of what it stops:
 *
 * - **Volume** — a per-file cap, a per-submission total, and a count cap, each
 *   checked against decoded bytes rather than anything the caller declares.
 * - **Type** — the MIME type is sniffed from the payload and matched against an
 *   allow-list of images and videos. A declared type is never read, so it can't
 *   be used to smuggle anything past the list. `image/svg+xml` is deliberately
 *   absent: SVG carries script, and support tooling renders what it is sent.
 * - **File name** — the caller's name is reduced to a display label and the
 *   extension is re-derived from the sniffed type, so a payload can never
 *   arrive as `.html`/`.exe`, and a name can never carry the CR/LF or quoting
 *   characters that would break out of a `Content-Disposition` header.
 */

/** Max files on one submission. */
export const MAX_ATTACHMENTS = 5;

/** Max decoded size of any one file. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Max decoded size of all files on one submission. Bounded well under the 25 MB
 * message ceiling most mail providers enforce, since the outgoing mail carries
 * these base64-encoded (~4/3 the size) alongside the message body.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Max characters kept from the caller's file name, before the extension. */
export const MAX_ATTACHMENT_NAME_LENGTH = 80;

/**
 * Sniffed MIME types we accept, and the extension each one is stored under.
 * Between them these cover what the platforms people report bugs from actually
 * produce: PNG/JPEG screenshots, GIF captures, and MP4/QuickTime/WebM screen
 * recordings.
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
 * Ceiling on the encoded string we are willing to decode. Applied to the raw
 * field before any decoding so an oversized payload costs a length check rather
 * than a 10 MB allocation. Base64 is 4 characters per 3 bytes; the slack covers
 * padding and any line wrapping.
 */
const MAX_ATTACHMENT_BASE64_CHARS =
    Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 1024;

/**
 * Characters stripped from a file name outright: C0/C1 controls (CR and LF
 * would let a name break out of the `Content-Disposition` header), the bidi
 * overrides and isolates that make `report.4pm.exe` render as `report.exe.mp4`,
 * and the quoting characters that header would otherwise have to escape.
 */
const UNSAFE_NAME_CHARS_REGEX =
    /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069"'\\;]/g;

const mb = (bytes: number): number => Math.round(bytes / (1024 * 1024));
const tooLargeClause = (): string =>
    `is too large (max ${mb(MAX_ATTACHMENT_BYTES)} MB per file)`;

/** One validated attachment, in the shape nodemailer takes. */
export interface ValidatedAttachment {
    /** Safe display name; extension always matches `contentType`. */
    filename: string;
    /** Sniffed, allow-listed MIME type. */
    contentType: string;
    /** Decoded payload. */
    content: Buffer;
    /** Decoded byte count (`content.length`, carried for metadata). */
    size: number;
}

/** What gets recorded alongside the feedback row — names and sizes, no bytes. */
export interface AttachmentMetadata {
    name: string;
    type: string;
    size: number;
}

export type ContactAttachmentsVerdict =
    | { ok: true; attachments: ValidatedAttachment[] }
    | { ok: false; reason: string };

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
            // Leading dots would make the file hidden (and `..` traversable)
            // if anyone ever writes it to disk.
            .replace(/^[.\s]+/, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_ATTACHMENT_NAME_LENGTH)
            .trim();
    }
    if (base.length === 0) base = `attachment-${index + 1}`;
    return `${base}.${extension}`;
}

/**
 * Validate the `attachments` field of a Contact Us submission.
 *
 * Each entry is `{ name?: string, data: string }` where `data` is bare base64
 * (no `data:` prefix). Absent/null means "no attachments" and is not an error —
 * the field is optional.
 *
 * On failure the `reason` is safe to return to the caller: it names the
 * offending index and the rule it broke, and never echoes caller input back.
 */
export function validateContactAttachments(
    value: unknown,
): ContactAttachmentsVerdict {
    if (value === undefined || value === null) {
        return { ok: true, attachments: [] };
    }
    if (!Array.isArray(value)) {
        return { ok: false, reason: '`attachments` must be an array' };
    }
    if (value.length > MAX_ATTACHMENTS) {
        return {
            ok: false,
            reason: `too many attachments (max ${MAX_ATTACHMENTS})`,
        };
    }

    const attachments: ValidatedAttachment[] = [];
    let totalBytes = 0;

    for (let i = 0; i < value.length; i++) {
        const label = `attachment ${i + 1}`;
        const entry = value[i];
        if (
            typeof entry !== 'object' ||
            entry === null ||
            Array.isArray(entry)
        ) {
            return { ok: false, reason: `${label} must be an object` };
        }

        const { name, data } = entry as { name?: unknown; data?: unknown };
        if (typeof data !== 'string' || data.length === 0) {
            return {
                ok: false,
                reason: `${label} is missing base64 \`data\``,
            };
        }
        if (data.length > MAX_ATTACHMENT_BASE64_CHARS) {
            return { ok: false, reason: `${label} ${tooLargeClause()}` };
        }

        // Line-wrapped base64 is tolerated, but only whitespace is stripped —
        // any other character outside the alphabet fails the strict decode.
        const bytes = decodeStrictBase64(data.replace(/\s+/g, ''));
        if (!bytes) {
            return { ok: false, reason: `${label} is not valid base64` };
        }
        if (bytes.length > MAX_ATTACHMENT_BYTES) {
            return { ok: false, reason: `${label} ${tooLargeClause()}` };
        }

        totalBytes += bytes.length;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
            return {
                ok: false,
                reason: `attachments are too large in total (max ${mb(MAX_TOTAL_ATTACHMENT_BYTES)} MB)`,
            };
        }

        const sniffed = sniffImageMime(bytes) ?? sniffVideoMime(bytes);
        const extension = sniffed
            ? ATTACHMENT_MIME_EXTENSIONS[sniffed]
            : undefined;
        if (!sniffed || !extension) {
            return {
                ok: false,
                reason: `${label} is not a supported image or video`,
            };
        }

        attachments.push({
            filename: sanitizeAttachmentName(name, i, extension),
            contentType: sniffed,
            content: bytes,
            size: bytes.length,
        });
    }

    return { ok: true, attachments };
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

/**
 * A manifest to append to the support email's body. Mail gateways strip
 * attachments, and without this the recipient has no way to tell a message that
 * arrived intact from one that lost its screenshots on the way.
 */
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
