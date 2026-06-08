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

import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './dbError.js';

describe('isUniqueViolation', () => {
    it('matches UNIQUE / PRIMARY KEY violations across the supported drivers', () => {
        expect(isUniqueViolation({ code: '23505' })).toBe(true); // postgres
        expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(
            true,
        );
        expect(
            isUniqueViolation({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' }),
        ).toBe(true);
        expect(isUniqueViolation({ code: 'ER_DUP_ENTRY' })).toBe(true); // mysql
        expect(isUniqueViolation({ errno: 1062 })).toBe(true); // mysql errno
    });

    it('does NOT match other constraint / error kinds, which must bubble up', () => {
        // The bare parent code can be a CHECK / NOT NULL / FK violation.
        expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT' })).toBe(false);
        expect(
            isUniqueViolation({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }),
        ).toBe(false);
        expect(isUniqueViolation({ code: '23502' })).toBe(false); // pg NOT NULL
        expect(isUniqueViolation({ code: '23503' })).toBe(false); // pg FK
        expect(isUniqueViolation({ errno: 1452 })).toBe(false); // mysql FK
    });

    it('is safe on non-error inputs', () => {
        expect(isUniqueViolation(null)).toBe(false);
        expect(isUniqueViolation(undefined)).toBe(false);
        expect(isUniqueViolation('boom')).toBe(false);
        expect(isUniqueViolation({})).toBe(false);
    });
});
