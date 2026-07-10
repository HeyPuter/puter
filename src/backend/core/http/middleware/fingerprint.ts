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

import type { RequestHandler } from 'express';
import { computeNetworkFingerprint } from './rateLimit.js';
import '../expressAugmentation';

/**
 * Conservative charset/length for the client-supplied device fingerprint. It
 * becomes part of KV keys downstream (abuse extension), so anything outside
 * this shape is dropped to `undefined` rather than trusted. Kept in sync with
 * the abuse extension's `DEVICE_FINGERPRINT_SHAPE`; the core only enforces the
 * shape, never any abuse policy built on the value.
 */
const DEVICE_FINGERPRINT_SHAPE = /^[A-Za-z0-9._-]{8,128}$/;

/** Header the GUI may send the device fingerprint on for non-signup requests. */
const DEVICE_FINGERPRINT_HEADER = 'x-puter-device-fingerprint';

function readDeviceFingerprint(req: {
    body?: unknown;
    headers?: Record<string, unknown>;
}): string | undefined {
    // Body first (what /signup already sends), then a header fallback so
    // authenticated, bodyless-or-different-shape requests can still carry it.
    const body = req.body as { fingerprint?: unknown } | undefined;
    const candidate =
        (typeof body?.fingerprint === 'string'
            ? body.fingerprint
            : undefined) ??
        (typeof req.headers?.[DEVICE_FINGERPRINT_HEADER] === 'string'
            ? (req.headers[DEVICE_FINGERPRINT_HEADER] as string)
            : undefined);
    if (candidate && DEVICE_FINGERPRINT_SHAPE.test(candidate)) return candidate;
    return undefined;
}

/**
 * Stamp request-scoped fingerprints onto `req` so any downstream gate, handler,
 * or service (via the ALS `Context.get('req')`) can read them without recomputing:
 *
 *   - `req.networkFingerprint` — always set; a coarse IP+headers hash (the
 *     anchor of the rate limiter's default key). Server-derived, so it can't be
 *     forged away, but it's coarse (shared behind NAT/VPN, rotates with UA).
 *   - `req.deviceFingerprint` — set only when the client supplied a well-shaped
 *     device fingerprint (ThumbmarkJS hash) in the body or the
 *     `x-puter-device-fingerprint` header; `undefined` otherwise. Client-supplied
 *     and spoofable, but stable per real device across IP rotation. The rate
 *     limiter's 'fingerprint' strategy appends it to the network hash so each
 *     device behind a shared network gets its own bucket.
 *
 * Install AFTER the body parsers (so the body fingerprint is readable) and
 * before `requestContext` (so the snapshot into ALS already carries them).
 * Never rejects — a missing/invalid device fingerprint is simply absent.
 */
export const createFingerprintMiddleware = (): RequestHandler => {
    return (req, _res, next) => {
        req.networkFingerprint = computeNetworkFingerprint(req);
        req.deviceFingerprint = readDeviceFingerprint(req);
        next();
    };
};
