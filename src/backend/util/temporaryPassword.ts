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

// The credential a team administrator hands a member out of band. It is
// minted by the team service and spent at login, so the two halves live here
// rather than one layer importing the other.

import { randomBytes } from 'node:crypto';

/** Unambiguous alphabet -- no 0/O or 1/l, since a human retypes this. */
const TEMP_PASSWORD_ALPHABET =
    'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** How long an unused temporary password keeps working. */
export const TEMP_PASSWORD_TTL_SECONDS = 24 * 60 * 60;

/** ~95 bits, generated rather than chosen so it is never a reused pattern. */
export const generateTemporaryPassword = (length = 16): string => {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
    }
    return out;
};

/** Unix seconds at which a temporary password issued now stops working. */
export const temporaryPasswordExpiry = (now = Date.now()): number =>
    Math.floor(now / 1000) + TEMP_PASSWORD_TTL_SECONDS;

/**
 * Whether this account's password is an expired temporary one. A null column is
 * every password the account chose itself, which never expires.
 */
export const isTemporaryPasswordExpired = (
    user: { temp_password_expires_at?: unknown } | undefined,
    now = Date.now(),
): boolean => {
    const expiresAt = Number(user?.temp_password_expires_at ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
    return Math.floor(now / 1000) >= expiresAt;
};
