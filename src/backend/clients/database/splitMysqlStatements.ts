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

/**
 * DELIMITER-aware splitter for MySQL dump / migration files.
 *
 * Splits `sql` into individual statements using the active statement
 * delimiter (default `;`). Recognises `DELIMITER X` lines, single-quoted
 * strings, double-quoted strings, backtick-quoted identifiers, line
 * comments (`-- `, `#`) and block comments (`/* ... *\/`). DELIMITER
 * directives are stripped from the output (they're a client-side concept,
 * not server SQL).
 *
 * Returns trimmed, non-empty statements without the trailing delimiter.
 */
export function splitMysqlStatements(sql: string): string[] {
    const out: string[] = [];
    let buf = '';
    let delim = ';';
    let i = 0;
    const n = sql.length;

    // We process the input line-by-line for DELIMITER detection, but track
    // multi-line state (strings / block comments) across lines.
    type State =
        | 'normal'
        | 'sq' // single-quoted string
        | 'dq' // double-quoted string
        | 'bt' // backtick-quoted identifier
        | 'block'; // /* ... */
    let state: State = 'normal';

    const pushStatement = () => {
        const trimmed = buf.trim();
        if (trimmed.length > 0) out.push(trimmed);
        buf = '';
    };

    while (i < n) {
        // At the start of each line in `normal` state, check for DELIMITER
        // and full-line comments. We're at line start iff `i === 0` or the
        // previous char was a newline.
        const atLineStart = i === 0 || sql[i - 1] === '\n';
        if (atLineStart && state === 'normal') {
            // Find end of current line (without consuming).
            let lineEnd = sql.indexOf('\n', i);
            if (lineEnd === -1) lineEnd = n;
            const line = sql.slice(i, lineEnd);

            // DELIMITER directive — only valid when the current statement
            // buffer is empty (i.e. between statements). MySQL CLI accepts
            // it almost anywhere, but in practice it's always between
            // statements; rejecting mid-statement keeps the parser simple
            // and predictable.
            const delimMatch = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
            if (delimMatch && buf.trim() === '') {
                delim = delimMatch[1];
                // skip the line including the trailing newline (if any)
                i = lineEnd + 1;
                buf = '';
                continue;
            }
        }

        const c = sql[i];
        const next = i + 1 < n ? sql[i + 1] : '';

        if (state === 'sq') {
            buf += c;
            if (c === '\\' && i + 1 < n) {
                buf += sql[i + 1];
                i += 2;
                continue;
            }
            if (c === "'") {
                if (next === "'") {
                    // SQL-style escaped quote
                    buf += "'";
                    i += 2;
                    continue;
                }
                state = 'normal';
            }
            i++;
            continue;
        }

        if (state === 'dq') {
            buf += c;
            if (c === '\\' && i + 1 < n) {
                buf += sql[i + 1];
                i += 2;
                continue;
            }
            if (c === '"') {
                if (next === '"') {
                    buf += '"';
                    i += 2;
                    continue;
                }
                state = 'normal';
            }
            i++;
            continue;
        }

        if (state === 'bt') {
            buf += c;
            if (c === '`') {
                if (next === '`') {
                    buf += '`';
                    i += 2;
                    continue;
                }
                state = 'normal';
            }
            i++;
            continue;
        }

        if (state === 'block') {
            buf += c;
            if (c === '*' && next === '/') {
                buf += '/';
                i += 2;
                state = 'normal';
                continue;
            }
            i++;
            continue;
        }

        // state === 'normal'
        // Line comments: `-- ` or `--\n` or `--$` (MySQL requires whitespace
        // or EOL after `--`); also `#` to EOL.
        if (
            (c === '-' &&
                next === '-' &&
                (sql[i + 2] === undefined || /\s/.test(sql[i + 2]))) ||
            c === '#'
        ) {
            // consume to end-of-line; keep the comment in the buffer so the
            // statement text remains faithful (mysql server tolerates it)
            const lineEnd = sql.indexOf('\n', i);
            const end = lineEnd === -1 ? n : lineEnd;
            buf += sql.slice(i, end);
            i = end;
            continue;
        }

        if (c === '/' && next === '*') {
            buf += '/*';
            i += 2;
            state = 'block';
            continue;
        }

        if (c === "'") {
            buf += c;
            i++;
            state = 'sq';
            continue;
        }

        if (c === '"') {
            buf += c;
            i++;
            state = 'dq';
            continue;
        }

        if (c === '`') {
            buf += c;
            i++;
            state = 'bt';
            continue;
        }

        // Delimiter match
        if (sql.startsWith(delim, i)) {
            // emit current buffer (without the delimiter)
            pushStatement();
            i += delim.length;
            continue;
        }

        buf += c;
        i++;
    }

    // Flush trailing content (no terminating delimiter is allowed for the
    // last statement, but we still try)
    pushStatement();
    return out;
}
