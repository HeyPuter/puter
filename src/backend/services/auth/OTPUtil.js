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

import { TOTP } from 'otpauth';
import crypto from 'node:crypto';
import hiBase32 from 'hi-base32';

// hi-base32 is CJS without static named-export detection, so destructure
// off the default import.
const { encode } = hiBase32;

/**
 * Standalone OTP utilities — no service class, just functions.
 */

export function createSecret(label) {
    const secret = genOtpSecret();
    const totp = new TOTP({
        issuer: 'puter.com',
        label,
        algorithm: 'SHA1',
        digits: 6,
        secret,
    });
    return { url: totp.toString(), secret };
}

export function createRecoveryCode() {
    const buffer = crypto.randomBytes(6);
    return encode(buffer).replace(/=/g, '').substring(0, 8);
}

export function verify(label, secret, code) {
    const totp = new TOTP({
        issuer: 'puter.com',
        label,
        algorithm: 'SHA1',
        digits: 6,
        secret,
    });
    const delta = totp.validate({ token: code });
    if (delta === null) return false;
    return [-1, 0, 1].includes(delta);
}

export function hashRecoveryCode(code) {
    return crypto
        .createHash('sha256')
        .update(code)
        .digest('base64')
        .slice(0, 22);
}

function genOtpSecret() {
    const buffer = crypto.randomBytes(15);
    return encode(buffer).replace(/=/g, '').substring(0, 24);
}
