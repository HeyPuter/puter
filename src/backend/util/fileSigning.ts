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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../core/http/HttpError.js';
import type { FSEntry } from '../stores/fs/FSEntry.js';

/**
 * File URL signing. A signed URL carries `uid`, `expires` and `signature`; that
 * shape is fixed by existing clients.
 *
 * Signatures are an HMAC over uid, action, expiry and the entry's owner when
 * signed, and verify only while the entry still has that owner. Signatures
 * issued before owner binding, `sha256(<uid>/<action>/<secret>/<expires>)`,
 * still verify without the owner check by default — `allowLegacySignatures`
 * (config `legacy_file_signatures`) turns that off. Both formats are hex in
 * the same param, so the verifier tries each. A `write` signature also
 * satisfies `read`.
 */

export type SignAction = 'read' | 'write';

export interface SigningConfig {
    secret: string;
    apiBaseUrl: string;
    /** Accept the pre-owner-binding signature format. Default true. */
    allowLegacySignatures?: boolean;
}

export interface SignedFile {
    uid: string;
    expires: number;
    signature: string;
    url: string;
    read_url: string;
    write_url?: string;
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

function computeLegacySignature(
    uid: string,
    action: SignAction,
    secret: string,
    expires: number,
): string {
    return sha256(`${uid}/${action}/${secret}/${expires}`);
}

function computeOwnerBoundSignature(
    uid: string,
    action: SignAction,
    ownerUserId: number,
    secret: string,
    expires: number,
): string {
    // Purpose-labelled key, so no other token signed with the platform secret
    // can be replayed as a file signature.
    const key = createHmac('sha256', secret)
        .update('puter-fs:signed-url')
        .digest();
    return createHmac('sha256', key)
        .update(`${uid}/${action}/${ownerUserId}/${expires}`)
        .digest('hex');
}

/**
 * Constant-time equality for the hex signature strings. A plain `===`
 * short-circuits on the first differing character, leaking a byte-by-byte
 * timing oracle on the one value an attacker controls and submits repeatedly.
 * Length mismatch (or non-hex input) returns false without a timing-variable
 * compare.
 */
function signaturesEqual(provided: string, expected: string): boolean {
    if (provided.length !== expected.length) return false;
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    // Malformed hex yields a shorter buffer than the hex length implies;
    // timingSafeEqual requires equal lengths, so guard before comparing.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Lifetime for a signature over an entry the signer doesn't own.
 *
 * `verifySignature` checks the signature, expiry and owner, never the ACL, so a
 * URL handed to a recipient keeps working after their access is revoked. This
 * is what bounds that window; the durable fix is a per-entry signature epoch
 * the owner can bump.
 */
export const NON_OWNER_SIGNATURE_TTL_SECONDS = 60 * 60;

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
    const signature = computeOwnerBoundSignature(
        entry.uuid,
        'read',
        entry.userId,
        config.secret,
        expires,
    );
    const writeSignature = computeOwnerBoundSignature(
        entry.uuid,
        'write',
        entry.userId,
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

export interface SignedQuery {
    uid?: string;
    expires?: string | number;
    signature?: string;
}

/**
 * Read the signed params off a request and reject missing or expired ones.
 * Needs no lookup, so callers can run it before resolving the entry.
 */
export function parseSignedQuery(query: SignedQuery): {
    uid: string;
    expires: number;
    signature: string;
} {
    const uid = typeof query.uid === 'string' ? query.uid : '';
    const signature =
        typeof query.signature === 'string' ? query.signature : '';
    const expires = Number(query.expires);
    if (!uid)
        throw new HttpError(403, '`uid` is required for signature-based auth', {
            legacyCode: 'forbidden',
        });
    if (!signature)
        throw new HttpError(
            403,
            '`signature` is required for signature-based auth',
            { legacyCode: 'forbidden' },
        );
    if (!Number.isFinite(expires))
        throw new HttpError(
            403,
            '`expires` is required for signature-based auth',
            { legacyCode: 'forbidden' },
        );

    if (expires < Date.now() / 1000) {
        throw new HttpError(403, 'Authentication failed. Signature expired.', {
            legacyCode: 'forbidden',
        });
    }
    return { uid, expires, signature };
}

/**
 * Legacy (pre-owner-binding) signatures have no expiry on being phased out, so
 * operators need a way to see usage trend toward zero. Logs at most once per
 * `LEGACY_SIGNATURE_WARN_INTERVAL_MS`, with the count of hits since the last
 * log — never the uid or signature itself.
 */
const LEGACY_SIGNATURE_WARN_INTERVAL_MS = 5 * 60 * 1000;
let legacySignatureHits = 0;
let legacySignatureWindowStart = 0;

function noteLegacySignatureAccepted(): void {
    legacySignatureHits++;
    const now = Date.now();
    if (now - legacySignatureWindowStart < LEGACY_SIGNATURE_WARN_INTERVAL_MS)
        return;
    console.warn(
        `[fileSigning] accepted ${legacySignatureHits} request(s) authorized by a pre-owner-binding (legacy) file signature`,
    );
    legacySignatureHits = 0;
    legacySignatureWindowStart = now;
}

/**
 * Verify a request's URL signature for a given action. A valid `write`
 * signature also authorises `read`. `ownerUserId` is the entry's current owner,
 * or null when it doesn't exist; then only a pre-binding signature can pass.
 * Throws HttpError(403) on mismatch, expired signatures, or missing params.
 */
export function verifySignature(
    query: SignedQuery,
    action: SignAction,
    config: SigningConfig,
    ownerUserId: number | null,
): void {
    const { uid, expires, signature } = parseSignedQuery(query);
    const actions: SignAction[] =
        action === 'write' ? ['write'] : ['write', action];
    const allowLegacy = config.allowLegacySignatures ?? true;
    for (const candidate of actions) {
        if (
            ownerUserId !== null &&
            signaturesEqual(
                signature,
                computeOwnerBoundSignature(
                    uid,
                    candidate,
                    ownerUserId,
                    config.secret,
                    expires,
                ),
            )
        )
            return;
        if (
            allowLegacy &&
            signaturesEqual(
                signature,
                computeLegacySignature(uid, candidate, config.secret, expires),
            )
        ) {
            noteLegacySignatureAccepted();
            return;
        }
    }

    throw new HttpError(403, 'Authentication failed', {
        legacyCode: 'forbidden',
    });
}

/**
 * Non-throwing variant that returns whether the signature is valid for the
 * given action. Useful when callers want to attempt `write` auth and fall back
 * to `read` without triggering error propagation.
 */
export function isSignatureValid(
    query: SignedQuery,
    action: SignAction,
    config: SigningConfig,
    ownerUserId: number | null,
): boolean {
    try {
        verifySignature(query, action, config, ownerUserId);
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
