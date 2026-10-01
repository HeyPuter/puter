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
 * True when `err` is a UNIQUE / PRIMARY KEY constraint violation, across the
 * three database drivers Puter runs on. Use to make an "insert if absent"
 * idempotent in the face of a lost check-then-insert race — only a duplicate is
 * swallowed; CHECK / NOT NULL / FK / type violations still bubble up.
 *
 * Better-sqlite3 surfaces `SqliteError.code`; mysql2 surfaces `.code` and
 * `.errno` (1062 = ER_DUP_ENTRY); pg surfaces SQLSTATE `23505`.
 */
export function isUniqueViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const { code, errno } = err as { code?: string; errno?: number };
    // Match only UNIQUE / PRIMARY KEY violations. The bare `SQLITE_CONSTRAINT`
    // parent code is intentionally excluded so CHECK / NOT NULL / FK / type
    // violations still bubble up rather than being silently swallowed.
    if (
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === 'ER_DUP_ENTRY' ||
        code === '23505'
    ) {
        return true;
    }
    return errno === 1062;
}

/**
 * True when a write was rejected because the row it references is gone. Only
 * mysql names that case, so elsewhere this is any foreign-key mismatch — use it
 * at an insert site, where that's the same thing.
 */
export function isMissingParentViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const { code, errno } = err as { code?: string; errno?: number };
    if (
        code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        code === 'ER_NO_REFERENCED_ROW' ||
        code === 'ER_NO_REFERENCED_ROW_2' ||
        code === '23503'
    ) {
        return true;
    }
    return errno === 1216 || errno === 1452; // mysql; 1452 is the InnoDB form
}
