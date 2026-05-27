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
import { compareMigrationFilenames } from './MySQLDatabaseClient.js';

describe('compareMigrationFilenames', () => {
    it('orders numbered migrations numerically, not lexically', () => {
        const input = [
            'mysql_mig_10.sql',
            'mysql_mig_2.sql',
            'mysql_mig_1.sql',
            'mysql_mig_9.sql',
            'mysql_mig_3.sql',
        ];
        const sorted = [...input].sort(compareMigrationFilenames);
        expect(sorted).toEqual([
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_3.sql',
            'mysql_mig_9.sql',
            'mysql_mig_10.sql',
        ]);
    });

    it('keeps mig_10 after mig_9 when the real prod set is shuffled', () => {
        // Reflects the current migrations/mysql/ listing — guards against
        // a future "let's just rename to padded" suggestion accidentally
        // re-introducing the lex bug if the rename is incomplete.
        const real = [
            'mysql_mig_9.sql',
            'mysql_mig_3.sql',
            'mysql_mig_10.sql',
            'mysql_mig_1.sql',
            'mysql_mig_7.sql',
            'mysql_mig_5.sql',
            'mysql_mig_2.sql',
            'mysql_mig_4.sql',
            'mysql_mig_8.sql',
            'mysql_mig_6.sql',
        ];
        const sorted = [...real].sort(compareMigrationFilenames);
        for (let i = 1; i <= sorted.length; i += 1) {
            expect(sorted[i - 1]).toBe(`mysql_mig_${i}.sql`);
        }
    });

    it('sorts non-numeric filenames after numbered ones, lexically among themselves', () => {
        // Numbered files always run first (they're the canonical history);
        // unmatched names follow in localeCompare order. Mixing the two
        // sets prevents a vendor dump from accidentally wedging itself
        // between mig_4 and mig_5 if it happened to lex-sort there.
        const mixed = [
            'mysql_mig_2.sql',
            'mysql_vendor_dump.sql',
            'mysql_mig_10.sql',
            'mysql_bootstrap.sql',
            'mysql_mig_1.sql',
        ];
        const sorted = [...mixed].sort(compareMigrationFilenames);
        expect(sorted).toEqual([
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_10.sql',
            'mysql_bootstrap.sql',
            'mysql_vendor_dump.sql',
        ]);
    });

    it('is stable for already-sorted input', () => {
        const sorted = [
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_10.sql',
            'mysql_mig_11.sql',
        ];
        expect([...sorted].sort(compareMigrationFilenames)).toEqual(sorted);
    });
});
