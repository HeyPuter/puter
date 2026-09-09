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

import { describe, expect, it } from 'vitest';
import {
    generateTemporaryPassword,
    isTemporaryPasswordExpired,
    TEMP_PASSWORD_TTL_SECONDS,
    temporaryPasswordExpiry,
} from './temporaryPassword.js';

describe('generateTemporaryPassword', () => {
    it('avoids the glyphs a human would mistype', () => {
        const joined = Array.from({ length: 200 }, () =>
            generateTemporaryPassword(),
        ).join('');
        expect(joined).not.toMatch(/[0O1lI]/u);
    });

    it('never repeats a credential', () => {
        const seen = new Set(
            Array.from({ length: 200 }, () => generateTemporaryPassword()),
        );
        expect(seen.size).toBe(200);
    });
});

describe('isTemporaryPasswordExpired', () => {
    const now = 1_800_000_000_000;

    it('treats a password the account chose itself as never expiring', () => {
        expect(isTemporaryPasswordExpired({}, now)).toBe(false);
        expect(
            isTemporaryPasswordExpired({ temp_password_expires_at: null }, now),
        ).toBe(false);
    });

    it('accepts an unexpired credential', () => {
        const expiry = temporaryPasswordExpiry(now);
        expect(
            isTemporaryPasswordExpired(
                { temp_password_expires_at: expiry },
                now,
            ),
        ).toBe(false);
    });

    it('rejects one issued more than the TTL ago', () => {
        const expiry = temporaryPasswordExpiry(now);
        const later = now + (TEMP_PASSWORD_TTL_SECONDS + 1) * 1000;
        expect(
            isTemporaryPasswordExpired(
                { temp_password_expires_at: expiry },
                later,
            ),
        ).toBe(true);
    });

    it('reads the string postgres returns for a bigint column', () => {
        const expiry = String(temporaryPasswordExpiry(now));
        const later = now + (TEMP_PASSWORD_TTL_SECONDS + 1) * 1000;
        expect(
            isTemporaryPasswordExpired(
                { temp_password_expires_at: expiry },
                later,
            ),
        ).toBe(true);
    });
});
