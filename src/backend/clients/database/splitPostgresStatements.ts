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

type ScannerState =
    | { kind: 'normal' }
    | { kind: 'singleQuote' }
    | { kind: 'doubleQuote' }
    | { kind: 'lineComment' }
    | { kind: 'blockComment' }
    | { kind: 'dollarQuote'; tag: string };

const readDollarQuoteTag = (sql: string, index: number): string | null => {
    const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index));
    return match?.[0] ?? null;
};

export const splitPostgresStatements = (sql: string): string[] => {
    const statements: string[] = [];
    let state: ScannerState = { kind: 'normal' };
    let start = 0;

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i]!;
        const next = sql[i + 1];

        switch (state.kind) {
            case 'normal': {
                const dollarTag =
                    char === '$' ? readDollarQuoteTag(sql, i) : null;
                if (dollarTag) {
                    i += dollarTag.length - 1;
                    state = { kind: 'dollarQuote', tag: dollarTag };
                    break;
                }
                if (char === "'") {
                    state = { kind: 'singleQuote' };
                    break;
                }
                if (char === '"') {
                    state = { kind: 'doubleQuote' };
                    break;
                }
                if (char === '-' && next === '-') {
                    i += 1;
                    state = { kind: 'lineComment' };
                    break;
                }
                if (char === '/' && next === '*') {
                    i += 1;
                    state = { kind: 'blockComment' };
                    break;
                }
                if (char === ';') {
                    const statement = sql.slice(start, i).trim();
                    if (statement !== '') statements.push(statement);
                    start = i + 1;
                }
                break;
            }

            case 'singleQuote':
                if (char === "'" && next === "'") {
                    i += 1;
                } else if (char === '\\' && next !== undefined) {
                    i += 1;
                } else if (char === "'") {
                    state = { kind: 'normal' };
                }
                break;

            case 'doubleQuote':
                if (char === '"' && next === '"') {
                    i += 1;
                } else if (char === '"') {
                    state = { kind: 'normal' };
                }
                break;

            case 'lineComment':
                if (char === '\n') {
                    state = { kind: 'normal' };
                }
                break;

            case 'blockComment':
                if (char === '*' && next === '/') {
                    i += 1;
                    state = { kind: 'normal' };
                }
                break;

            case 'dollarQuote':
                if (sql.startsWith(state.tag, i)) {
                    i += state.tag.length - 1;
                    state = { kind: 'normal' };
                }
                break;
        }
    }

    const finalStatement = sql.slice(start).trim();
    if (finalStatement !== '') statements.push(finalStatement);
    return statements;
};
