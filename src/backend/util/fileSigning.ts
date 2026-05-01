/**
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

import { createHash } from 'node:crypto';
import { HttpError } from '../core/http/HttpError.js';
import type { FSEntry } from '../stores/fs/FSEntry.js';

/**
 * HMAC-like file URL signing. The on-wire contract is fixed by existing
 * clients.
 *
 * Signature scheme: `sha256(<uid>/<action>/<secret>/<expires>)`. A `write`
 * signature is treated as a superset (it also satisfies `read`).
 */

export type SignAction = 'read' | 'write';

export interface SigningConfig {
    secret: string;
    apiBaseUrl: string;
}

export interface SignedFile {
    uid: string;
    expires: number;
    signature: string;
    url: string;
    read_url: string;
    write_url: string;
    metadata_url: string;
    fsentry_type: string | null;
    fsentry_is_dir: boolean;
    fsentry_name: string;
    fsentry_size: number | null;
    fsentry_accessed: number | null;
    fsentry_modified: number;
    fsentry_created: number | null;
}

function sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function computeSignature(
    uid: string,
    action: SignAction,
    secret: string,
    expires: number,
): string {
    return sha256(`${uid}/${action}/${secret}/${expires}`);
}

/**
 * Produce a signed-URL object. The default `expires` timestamp uses a
 * ~317k-year TTL (effectively permanent) — existing clients depend on that
 * default; callers that want shorter-lived signatures can pass their own
 * `ttlSeconds`.
 */
export function signFile(
    entry: FSEntry,
    config: SigningConfig,
    options: { ttlSeconds?: number } = {},
): SignedFile {
    const ttl = options.ttlSeconds ?? 9_999_999_999_999;
    const expires = Math.ceil(Date.now() / 1000) + ttl;
    const signature = computeSignature(
        entry.uuid,
        'read',
        config.secret,
        expires,
    );
    const writeSignature = computeSignature(
        entry.uuid,
        'write',
        config.secret,
        expires,
    );

    const sigParams = `uid=${entry.uuid}&expires=${expires}&signature=${signature}`;
    const writeParams = `uid=${entry.uuid}&expires=${expires}&signature=${writeSignature}`;
    const base = config.apiBaseUrl.replace(/\/$/, '');

    return {
        uid: entry.uuid,
        expires,
        signature,
        url: `${base}/file?${sigParams}`,
        read_url: `${base}/file?${sigParams}`,
        write_url: `${base}/writeFile?${writeParams}`,
        metadata_url: `${base}/itemMetadata?${sigParams}`,
        fsentry_type: mimeFromName(entry.name),
        fsentry_is_dir: entry.isDir,
        fsentry_name: entry.name,
        fsentry_size: entry.size,
        fsentry_accessed: entry.accessed,
        fsentry_modified: entry.modified,
        fsentry_created: entry.created,
    };
}

/**
 * Verify a request's URL signature for a given action. A valid `write`
 * signature also authorises `read`. Throws HttpError(403) on mismatch,
 * expired signatures, or missing params.
 */
export function verifySignature(
    query: { uid?: string; expires?: string | number; signature?: string },
    action: SignAction,
    config: SigningConfig,
): void {
    const uid = typeof query.uid === 'string' ? query.uid : '';
    const signature =
        typeof query.signature === 'string' ? query.signature : '';
    const expires = Number(query.expires);
    if (!uid)
        throw new HttpError(403, '`uid` is required for signature-based auth');
    if (!signature)
        throw new HttpError(
            403,
            '`signature` is required for signature-based auth',
        );
    if (!Number.isFinite(expires))
        throw new HttpError(
            403,
            '`expires` is required for signature-based auth',
        );

    if (expires < Date.now() / 1000) {
        throw new HttpError(403, 'Authentication failed. Signature expired.');
    }

    // Write signature satisfies any action.
    if (signature === computeSignature(uid, 'write', config.secret, expires))
        return;
    if (signature === computeSignature(uid, action, config.secret, expires))
        return;

    throw new HttpError(403, 'Authentication failed');
}

/**
 * Non-throwing variant that returns whether the signature is valid for the
 * given action. Useful when callers want to attempt `write` auth and fall
 * back to `read` without triggering error propagation.
 */
export function isSignatureValid(
    query: { uid?: string; expires?: string | number; signature?: string },
    action: SignAction,
    config: SigningConfig,
): boolean {
    try {
        verifySignature(query, action, config);
        return true;
    } catch {
        return false;
    }
}

// Minimal MIME type inference from file extension. Uses a small inline map
// to avoid pulling in `mime-types`. Callers that need complete coverage
// should import `mime-types` directly.
const MIME_BY_EXT: Record<string, string> = {
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    pdf: 'application/pdf',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
};

export function mimeFromName(name: string): string | null {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    const ext = name.slice(dot + 1).toLowerCase();
    return MIME_BY_EXT[ext] ?? null;
}
