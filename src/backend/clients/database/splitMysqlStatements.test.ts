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
import { splitMysqlStatements } from './splitMysqlStatements.js';

describe('splitMysqlStatements', () => {
    it('splits simple statements on default delimiter', () => {
        expect(splitMysqlStatements('SELECT 1; SELECT 2;')).toEqual([
            'SELECT 1',
            'SELECT 2',
        ]);
    });

    it('returns empty array for whitespace-only input', () => {
        expect(splitMysqlStatements('  \n\t  ')).toEqual([]);
    });

    it('keeps a trailing statement without terminating semicolon', () => {
        expect(splitMysqlStatements('SELECT 1;\nSELECT 2')).toEqual([
            'SELECT 1',
            'SELECT 2',
        ]);
    });

    it('ignores semicolons inside single-quoted strings', () => {
        expect(
            splitMysqlStatements("INSERT INTO t VALUES ('a;b'); SELECT 2;"),
        ).toEqual(["INSERT INTO t VALUES ('a;b')", 'SELECT 2']);
    });

    it("handles SQL '' escape inside single-quoted strings", () => {
        expect(
            splitMysqlStatements("SELECT 'it''s; ok'; SELECT 2;"),
        ).toEqual(["SELECT 'it''s; ok'", 'SELECT 2']);
    });

    it('handles backslash escape inside strings', () => {
        expect(
            splitMysqlStatements("SELECT 'a\\'b;c'; SELECT 2;"),
        ).toEqual(["SELECT 'a\\'b;c'", 'SELECT 2']);
    });

    it('ignores semicolons inside backtick identifiers', () => {
        expect(
            splitMysqlStatements('SELECT `weird;col` FROM t; SELECT 2;'),
        ).toEqual(['SELECT `weird;col` FROM t', 'SELECT 2']);
    });

    it('ignores semicolons inside double-quoted strings', () => {
        expect(splitMysqlStatements('SELECT "a;b"; SELECT 2;')).toEqual([
            'SELECT "a;b"',
            'SELECT 2',
        ]);
    });

    it('ignores semicolons in line comments', () => {
        expect(
            splitMysqlStatements(
                'SELECT 1; -- a;b\nSELECT 2; # c;d\nSELECT 3;',
            ),
        ).toEqual(['SELECT 1', '-- a;b\nSELECT 2', '# c;d\nSELECT 3']);
    });

    it('ignores semicolons in block comments (multi-line)', () => {
        expect(
            splitMysqlStatements('SELECT 1 /* a;\nb;c */; SELECT 2;'),
        ).toEqual(['SELECT 1 /* a;\nb;c */', 'SELECT 2']);
    });

    it('honours DELIMITER directive', () => {
        const sql = `
SELECT 1;
DELIMITER //
CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//
DELIMITER ;
SELECT 3;
`;
        expect(splitMysqlStatements(sql)).toEqual([
            'SELECT 1',
            'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END',
            'SELECT 3',
        ]);
    });

    it('handles a stored procedure that uses // delimiter end-to-end', () => {
        const sql = `DROP PROCEDURE IF EXISTS foo;
DELIMITER //
CREATE PROCEDURE foo(IN x INT)
BEGIN
  IF x > 0 THEN
    SET @s := 'hi;';
    SELECT @s;
  END IF;
END//
DELIMITER ;
DROP PROCEDURE IF EXISTS foo;
`;
        const stmts = splitMysqlStatements(sql);
        expect(stmts).toHaveLength(3);
        expect(stmts[0]).toBe('DROP PROCEDURE IF EXISTS foo');
        expect(stmts[1]).toContain('CREATE PROCEDURE foo');
        expect(stmts[1]).toContain("SET @s := 'hi;';");
        expect(stmts[2]).toBe('DROP PROCEDURE IF EXISTS foo');
    });

    it('strips DELIMITER lines from output even if no statement follows', () => {
        expect(splitMysqlStatements('DELIMITER //\nDELIMITER ;\n')).toEqual(
            [],
        );
    });

    it('does not treat -- without trailing whitespace as a comment', () => {
        // `--5` is "minus minus 5" (rare in practice but valid SQL).
        // MySQL requires whitespace after `--` for it to be a comment.
        expect(splitMysqlStatements('SELECT 1--5; SELECT 2;')).toEqual([
            'SELECT 1--5',
            'SELECT 2',
        ]);
    });
});
