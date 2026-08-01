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
import { splitPostgresStatements } from './splitPostgresStatements';

describe('splitPostgresStatements', () => {
    it('splits on semicolons and trims each statement', () => {
        expect(
            splitPostgresStatements('SELECT 1;\n  SELECT 2 ;\nSELECT 3'),
        ).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
    });

    it('drops empty statements from stray semicolons', () => {
        expect(splitPostgresStatements(';;SELECT 1;;')).toEqual(['SELECT 1']);
    });

    it('returns nothing for whitespace-only input', () => {
        expect(splitPostgresStatements('   \n\t ')).toEqual([]);
    });

    it('keeps semicolons inside single-quoted literals', () => {
        expect(
            splitPostgresStatements("INSERT INTO t VALUES ('a;b'); SELECT 1"),
        ).toEqual(["INSERT INTO t VALUES ('a;b')", 'SELECT 1']);
    });

    it('handles doubled and backslash-escaped quotes in literals', () => {
        expect(
            splitPostgresStatements("SELECT 'it''s; fine'; SELECT 2"),
        ).toEqual(["SELECT 'it''s; fine'", 'SELECT 2']);
        expect(splitPostgresStatements("SELECT E'a\\'; b'; SELECT 2")).toEqual([
            "SELECT E'a\\'; b'",
            'SELECT 2',
        ]);
    });

    it('keeps semicolons inside quoted identifiers', () => {
        expect(
            splitPostgresStatements('SELECT "we;ird" FROM t; SELECT 2'),
        ).toEqual(['SELECT "we;ird" FROM t', 'SELECT 2']);
    });

    it('handles a doubled quote inside a quoted identifier', () => {
        expect(
            splitPostgresStatements('SELECT "we""ird;x" FROM t; SELECT 2'),
        ).toEqual(['SELECT "we""ird;x" FROM t', 'SELECT 2']);
    });

    it('ignores semicolons inside line comments', () => {
        expect(
            splitPostgresStatements('SELECT 1 -- trailing; note\n; SELECT 2'),
        ).toEqual(['SELECT 1 -- trailing; note', 'SELECT 2']);
    });

    it('ignores semicolons inside block comments', () => {
        expect(
            splitPostgresStatements('SELECT /* a; b */ 1; SELECT 2'),
        ).toEqual(['SELECT /* a; b */ 1', 'SELECT 2']);
    });

    it('keeps a whole dollar-quoted function body together', () => {
        const sql = [
            'CREATE FUNCTION bump() RETURNS trigger AS $$',
            'BEGIN',
            '  NEW.updated_at := now();',
            '  RETURN NEW;',
            'END;',
            '$$ LANGUAGE plpgsql;',
            'SELECT 1',
        ].join('\n');

        const statements = splitPostgresStatements(sql);
        expect(statements).toHaveLength(2);
        expect(statements[0]).toContain('RETURN NEW;');
        expect(statements[0].endsWith('$$ LANGUAGE plpgsql')).toBe(true);
        expect(statements[1]).toBe('SELECT 1');
    });

    it('respects a tagged dollar quote and its nested untagged pair', () => {
        const sql = 'SELECT $body$ inner $$ still; inside $body$; SELECT 2';
        expect(splitPostgresStatements(sql)).toEqual([
            'SELECT $body$ inner $$ still; inside $body$',
            'SELECT 2',
        ]);
    });

    it('treats a bare dollar sign as ordinary text', () => {
        expect(splitPostgresStatements('SELECT 1 $ 2; SELECT 3')).toEqual([
            'SELECT 1 $ 2',
            'SELECT 3',
        ]);
    });

    it('emits an unterminated final statement', () => {
        expect(
            splitPostgresStatements('SELECT 1; SELECT 2 -- no newline'),
        ).toEqual(['SELECT 1', 'SELECT 2 -- no newline']);
    });
});
