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
 * Shape and minting of `user.referral_code`.
 *
 * A referral code is a public, shareable handle for one account, so the only
 * mechanism here is "what a code may look like" and "produce a fresh one". What
 * a redemption is worth, and when a pattern of redemptions is abuse, is decided
 * elsewhere.
 *
 * Codes have exactly ONE canonical form — upper case — and every boundary
 * normalizes to it before touching a database or a counter. Two reasons:
 *
 * - Collations disagree. MySQL's `latin1_swedish_ci` matches a code
 *   case-insensitively, SQLite and Postgres do not, so `ab12cd34` resolving to
 *   an account would depend on the engine.
 * - Anything that counts redemptions per code keys off the code string. Left
 *   un-normalized, `AB12CD34` and `Ab12cd34` are one code to the lookup and two
 *   to the counters, which is a free way around any per-code cap.
 */
import crypto from 'crypto';

/** `user.referral_code` is `varchar(16)`; a longer value can't be stored. */
export const REFERRAL_CODE_MAX_LENGTH = 16;

/** Length of a newly minted code. 32^8 ≈ 1.1e12 possibilities. */
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Accepted canonical shape. Deliberately wider than the mint alphabet below:
 * codes minted by earlier versions of the program drew from the full
 * alphanumeric set, and they must keep resolving.
 */
export const REFERRAL_CODE_SHAPE = new RegExp(
    `^[A-Z0-9]{4,${REFERRAL_CODE_MAX_LENGTH}}$`,
);

/**
 * Crockford base32 — the alphanumerics minus `I`, `L`, `O` and `U`. Dropping
 * the letters that read as digits keeps a code transcribable from a screen or
 * over the phone, and dropping `U` keeps most accidental profanity out of a
 * code users are asked to share.
 */
const MINT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The canonical form of a client- or DB-supplied code, or null when the value
 * can't be a code at all. Everything that looks a code up, stores one, or
 * counts against one goes through here first.
 */
export const normalizeReferralCode = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return REFERRAL_CODE_SHAPE.test(normalized) ? normalized : null;
};

/**
 * Mint a fresh code. Uniqueness is not this function's job — it is held by the
 * unique index on `user.referral_code`, and callers retry on violation.
 *
 * `crypto.randomInt` rather than `Math.random`: a code that can be derived from
 * an account id (as an earlier seeded-RNG version could) lets anyone
 * reconstruct another user's code and spend their referral allowance for them.
 */
export const generateReferralCode = (length = REFERRAL_CODE_LENGTH): string => {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += MINT_ALPHABET[crypto.randomInt(0, MINT_ALPHABET.length)];
    }
    return code;
};
