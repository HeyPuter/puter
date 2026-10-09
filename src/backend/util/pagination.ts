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
    createCipheriv,
    createDecipheriv,
    hkdfSync,
    randomBytes,
} from 'node:crypto';
import { HttpError } from '../core/http';

/**
 * Shared pagination envelope for list endpoints. A response carries `cursor`
 * only when more pages exist; `total` only when the request asked for it via
 * `includeTotal`. Pages may hold fewer than `limit` items (post-query
 * filtering) — clients iterate until `cursor` is absent.
 */
export interface PageResult<T> {
    items: T[];
    cursor?: string;
    total?: number;
}

export const encodeCursor = (
    payload?: Record<string, unknown>,
): string | undefined => {
    if (!payload || Object.keys(payload).length === 0) return undefined;
    return Buffer.from(JSON.stringify(payload)).toString('base64');
};

export const decodeCursor = (
    cursor?: string | Record<string, unknown> | null,
    label = 'cursor',
): Record<string, unknown> | undefined => {
    if (cursor === undefined || cursor === null) return undefined;
    if (typeof cursor === 'object') return cursor;
    const trimmed = cursor.trim();
    if (trimmed === '') return undefined;
    try {
        return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
        try {
            return JSON.parse(trimmed);
        } catch {
            throw new HttpError(400, `invalid ${label}`, {
                legacyCode: 'bad_request',
            });
        }
    }
};

// -- Sealed cursors ---------------------------------------------------

const SEALED_CURSOR_VERSION = 1;
const SEAL_IV_BYTES = 12;
const SEAL_TAG_BYTES = 16;
const SEAL_HEADER_BYTES = 1 + SEAL_IV_BYTES + SEAL_TAG_BYTES;

let sealKeyMemo: { secret: string; key: Buffer } | null = null;

/** Derived under its own label, so no other use of `secret` shares this key. */
const sealKey = (secret: string): Buffer => {
    if (sealKeyMemo?.secret !== secret)
        sealKeyMemo = {
            secret,
            key: Buffer.from(
                hkdfSync('sha256', secret, '', 'puter:pagination-cursor', 32),
            ),
        };
    return sealKeyMemo.key;
};

/**
 * A cursor its holder cannot read, for keysets over a global sequence: a plain
 * one would let two pages show how fast the whole table grows. Encrypted and
 * authenticated, so an altered cursor is refused like any malformed one.
 * Without a secret it is a plain `encodeCursor` cursor.
 */
export const sealCursor = (
    payload: Record<string, unknown> | undefined,
    secret: string | undefined,
): string | undefined => {
    if (!payload || Object.keys(payload).length === 0) return undefined;
    if (!secret) return encodeCursor(payload);
    const iv = randomBytes(SEAL_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', sealKey(secret), iv);
    const body = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
    ]);
    return Buffer.concat([
        Buffer.from([SEALED_CURSOR_VERSION]),
        iv,
        cipher.getAuthTag(),
        body,
    ]).toString('base64url');
};

const unsealCursor = (
    cursor: string,
    secret: string,
): Record<string, unknown> | null => {
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.length <= SEAL_HEADER_BYTES || raw[0] !== SEALED_CURSOR_VERSION)
        return null;
    try {
        const decipher = createDecipheriv(
            'aes-256-gcm',
            sealKey(secret),
            raw.subarray(1, 1 + SEAL_IV_BYTES),
        );
        decipher.setAuthTag(raw.subarray(1 + SEAL_IV_BYTES, SEAL_HEADER_BYTES));
        const parsed: unknown = JSON.parse(
            Buffer.concat([
                decipher.update(raw.subarray(SEAL_HEADER_BYTES)),
                decipher.final(),
            ]).toString('utf8'),
        );
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};

/**
 * Read a cursor `sealCursor` produced. A plain cursor still reads, so a client
 * holding one from before cursors were sealed does not start over.
 */
export const openCursor = (
    cursor: string | Record<string, unknown> | null | undefined,
    secret: string | undefined,
    label = 'cursor',
): Record<string, unknown> | undefined => {
    if (typeof cursor === 'string' && secret) {
        const opened = unsealCursor(cursor.trim(), secret);
        if (opened) return opened;
    }
    return decodeCursor(cursor, label);
};

export const normalizeLimit = (
    limit: unknown,
    { cap, label = 'limit' }: { cap?: number; label?: string } = {},
): number | undefined => {
    if (limit === undefined || limit === null) return undefined;
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HttpError(400, `${label} must be a positive number`, {
            legacyCode: 'bad_request',
        });
    }
    const floored = Math.floor(parsed);
    return cap !== undefined ? Math.min(floored, cap) : floored;
};

export const normalizeOffset = (
    offset: unknown,
    { cap, label = 'offset' }: { cap?: number; label?: string } = {},
): number | undefined => {
    if (offset === undefined || offset === null) return undefined;
    const parsed = Number(offset);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new HttpError(400, `${label} must be a non-negative number`, {
            legacyCode: 'bad_request',
        });
    }
    const floored = Math.floor(parsed);
    if (cap !== undefined && floored > cap) {
        throw new HttpError(400, `${label} may not exceed ${cap}`, {
            legacyCode: 'bad_request',
        });
    }
    return floored;
};
