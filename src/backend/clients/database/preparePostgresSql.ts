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

export interface PreparedPostgresSql {
    text: string;
    parameterCount: number;
}

type ScannerState =
    | { kind: 'normal' }
    | { kind: 'singleQuote' }
    | { kind: 'doubleQuote' }
    | { kind: 'backtickIdentifier' }
    | { kind: 'lineComment' }
    | { kind: 'blockComment' }
    | { kind: 'dollarQuote'; tag: string };

const isLineCommentStart = (sql: string, index: number): boolean => {
    if (sql[index] !== '-' || sql[index + 1] !== '-') return false;
    const after = sql[index + 2];
    return after === undefined || /\s/u.test(after);
};

const readDollarQuoteTag = (sql: string, index: number): string | null => {
    const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index));
    return match?.[0] ?? null;
};

export const preparePostgresSql = (sql: string): PreparedPostgresSql => {
    let state: ScannerState = { kind: 'normal' };
    let parameterCount = 0;
    let out = '';

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i]!;
        const next = sql[i + 1];

        switch (state.kind) {
            case 'normal': {
                const dollarTag =
                    char === '$' ? readDollarQuoteTag(sql, i) : null;
                if (dollarTag) {
                    out += dollarTag;
                    i += dollarTag.length - 1;
                    state = { kind: 'dollarQuote', tag: dollarTag };
                    break;
                }
                if (char === "'") {
                    out += char;
                    state = { kind: 'singleQuote' };
                    break;
                }
                if (char === '"') {
                    out += char;
                    state = { kind: 'doubleQuote' };
                    break;
                }
                if (char === '`') {
                    out += '"';
                    state = { kind: 'backtickIdentifier' };
                    break;
                }
                if (isLineCommentStart(sql, i)) {
                    out += char;
                    if (char === '-') {
                        out += next ?? '';
                        i += 1;
                    }
                    state = { kind: 'lineComment' };
                    break;
                }
                if (char === '/' && next === '*') {
                    out += '/*';
                    i += 1;
                    state = { kind: 'blockComment' };
                    break;
                }
                if (char === '?') {
                    parameterCount += 1;
                    out += `$${parameterCount}`;
                    break;
                }
                out += char;
                break;
            }

            case 'singleQuote':
                out += char;
                if (char === "'" && next === "'") {
                    out += next;
                    i += 1;
                } else if (char === '\\' && next !== undefined) {
                    out += next;
                    i += 1;
                } else if (char === "'") {
                    state = { kind: 'normal' };
                }
                break;

            case 'doubleQuote':
                out += char;
                if (char === '"' && next === '"') {
                    out += next;
                    i += 1;
                } else if (char === '"') {
                    state = { kind: 'normal' };
                }
                break;

            case 'backtickIdentifier':
                if (char === '`' && next === '`') {
                    out += '`';
                    i += 1;
                } else if (char === '`') {
                    out += '"';
                    state = { kind: 'normal' };
                } else if (char === '"') {
                    out += '""';
                } else {
                    out += char;
                }
                break;

            case 'lineComment':
                out += char;
                if (char === '\n') {
                    state = { kind: 'normal' };
                }
                break;

            case 'blockComment':
                out += char;
                if (char === '*' && next === '/') {
                    out += '/';
                    i += 1;
                    state = { kind: 'normal' };
                }
                break;

            case 'dollarQuote':
                if (sql.startsWith(state.tag, i)) {
                    out += state.tag;
                    i += state.tag.length - 1;
                    state = { kind: 'normal' };
                } else {
                    out += char;
                }
                break;
        }
    }

    return { text: out, parameterCount };
};
