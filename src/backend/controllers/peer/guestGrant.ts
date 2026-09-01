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

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Guest TURN grants.
 *
 * A grant is a stateless, signed ticket an authenticated host hands to people
 * it invites, letting them mint TURN credentials without an account of their
 * own. It carries the identifier the resulting relay usage is attributed to —
 * the host's — so a guest's egress is metered and billed exactly as if the host
 * had relayed it, and an anonymous caller can never mint credentials that
 * nobody pays for.
 *
 * Grants are verified by signature alone; nothing is stored. That keeps the
 * check a single HMAC, at the cost of the ticket staying valid for its full
 * lifetime once issued — so lifetimes are short and the issuing route is
 * per-account rate limited.
 */

/**
 * Version prefix, included in the signed material so a future format can't be
 * swapped in under a signature made for this one.
 */
const GRANT_VERSION = 'pg1';

/**
 * Longest grant string we will do any work on. A real grant is ~150 bytes; the
 * cap keeps a malicious body from turning verification into a hashing job.
 */
const MAX_GRANT_LENGTH = 512;

/**
 * Base64url of 16 raw uuid bytes is 22 characters. A grant identifier is one
 * such segment for a user actor, or two joined by `:` for app-under-user —
 * matching `customIdentifier` in the peer controller.
 */
const IDENTIFIER_RE = /^[A-Za-z0-9_-]{22}(:[A-Za-z0-9_-]{22})?$/;

/** Decoded grant payload. Field names are short because they ride in a URL. */
interface GrantPayload {
    /** The `customIdentifier` relay usage is attributed to. */
    id: string;
    /** Expiry, seconds since the epoch. */
    exp: number;
    /** Random nonce, so two grants issued in the same second still differ. */
    n: string;
}

/** Why a grant was rejected. Distinguished so clients can react usefully. */
export type GrantRejection = 'malformed' | 'invalid' | 'expired';

/**
 * Discriminated on a string rather than a boolean so it narrows under the
 * project's non-strict build config too.
 */
export type GrantVerification =
    | { status: 'ok'; customIdentifier: string; expiresAt: number }
    | { status: GrantRejection };

const sign = (signedMaterial: string, secret: string): Buffer =>
    createHmac('sha256', secret).update(signedMaterial).digest();

/**
 * Issue a grant for `customIdentifier`, valid for `ttlSeconds`.
 *
 * @returns The grant string and its expiry (seconds since the epoch).
 */
export const signGuestGrant = ({
    customIdentifier,
    ttlSeconds,
    secret,
    now = Date.now(),
}: {
    customIdentifier: string;
    ttlSeconds: number;
    secret: string;
    now?: number;
}): { grant: string; expiresAt: number } => {
    const expiresAt = Math.floor(now / 1000) + ttlSeconds;
    const payload: GrantPayload = {
        id: customIdentifier,
        exp: expiresAt,
        n: randomBytes(12).toString('base64url'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signedMaterial = `${GRANT_VERSION}.${encoded}`;
    const signature = sign(signedMaterial, secret).toString('base64url');
    return { grant: `${signedMaterial}.${signature}`, expiresAt };
};

/**
 * Verify a grant and return the identifier its usage should be attributed to.
 *
 * The signature is checked before the payload is decoded, so a forged grant
 * never reaches the parser, and the identifier is re-validated against the
 * shape the upstream credential API accepts even though it arrives signed.
 */
export const verifyGuestGrant = ({
    grant,
    secret,
    now = Date.now(),
}: {
    grant: unknown;
    secret: string;
    now?: number;
}): GrantVerification => {
    if (
        typeof grant !== 'string' ||
        grant.length === 0 ||
        grant.length > MAX_GRANT_LENGTH
    ) {
        return { status: 'malformed' };
    }

    const parts = grant.split('.');
    if (parts.length !== 3) return { status: 'malformed' };
    const [version, encoded, signature] = parts as [string, string, string];
    if (version !== GRANT_VERSION) return { status: 'malformed' };

    const expected = sign(`${version}.${encoded}`, secret);
    const provided = Buffer.from(signature, 'base64url');
    if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
    ) {
        return { status: 'invalid' };
    }

    let payload: GrantPayload;
    try {
        payload = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as GrantPayload;
    } catch {
        return { status: 'malformed' };
    }

    if (
        !payload ||
        typeof payload.id !== 'string' ||
        !IDENTIFIER_RE.test(payload.id) ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp)
    ) {
        return { status: 'malformed' };
    }

    if (payload.exp * 1000 <= now) return { status: 'expired' };

    return {
        status: 'ok',
        customIdentifier: payload.id,
        expiresAt: payload.exp,
    };
};

/**
 * Read the claimed identifier out of a grant _without_ verifying it, for
 * rate-limit bucketing only.
 *
 * Bucketing has to happen before the handler runs, and a forged grant is
 * rejected there without reaching the upstream API — so an unverified read is
 * enough to put a host's guests in one bucket, and the worst a forger achieves
 * is choosing which bucket their own rejections land in. Never use this to
 * decide attribution.
 *
 * @returns The claimed identifier, or null if the grant doesn't parse.
 */
export const readClaimedGrantIdentifier = (grant: unknown): string | null => {
    if (typeof grant !== 'string' || grant.length > MAX_GRANT_LENGTH) {
        return null;
    }
    const parts = grant.split('.');
    if (parts.length !== 3 || parts[0] !== GRANT_VERSION) return null;
    try {
        const payload = JSON.parse(
            Buffer.from(parts[1]!, 'base64url').toString('utf8'),
        ) as { id?: unknown };
        if (
            typeof payload?.id !== 'string' ||
            !IDENTIFIER_RE.test(payload.id)
        ) {
            return null;
        }
        return payload.id;
    } catch {
        return null;
    }
};
