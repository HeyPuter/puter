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

import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';
import { generateEmailConfirmCode, hashPassword } from './credentials.js';

describe('hashPassword', () => {
    it('returns a bcrypt hash that verifies against the plaintext', async () => {
        const hash = await hashPassword('correct horse');
        expect(hash).toMatch(/^\$2[aby]\$08\$/);
        expect(await bcrypt.compare('correct horse', hash)).toBe(true);
        expect(await bcrypt.compare('wrong horse', hash)).toBe(false);
    });
});

describe('generateEmailConfirmCode', () => {
    it('returns six digits with no leading zero', () => {
        for (let i = 0; i < 50; i++) {
            expect(generateEmailConfirmCode()).toMatch(/^[1-9]\d{5}$/);
        }
    });
});
