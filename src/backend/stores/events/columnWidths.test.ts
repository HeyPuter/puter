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

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareMigrationFilenames } from '../../clients/database/migrationFilenames.js';
import { isHttpError } from '../../core/http/HttpError.js';
import {
    assertColumnWidths,
    ENUM_COLUMNS,
    EVENT_SUBSCRIPTION_WIDTHS,
    KV_SHARE_HANDLE_WIDTHS,
} from './columnWidths.js';

/** One character past a column's width. */
const over = (spec: { max: number }): string => 'a'.repeat(spec.max + 1);

/** The message of the rejection `run` must produce. */
const messageFor = (run: () => void): string => {
    try {
        run();
    } catch (err) {
        if (isHttpError(err)) return err.message;
        throw err;
    }
    throw new Error('expected assertColumnWidths to throw');
};

const expectTooLarge = (run: () => void): void => {
    try {
        run();
    } catch (err) {
        if (!isHttpError(err)) throw err;
        expect(err.statusCode).toBe(413);
        expect(err.legacyCode).toBe('events_value_too_large');
        return;
    }
    throw new Error('expected assertColumnWidths to throw');
};

describe.each([
    ['EVENT_SUBSCRIPTION_WIDTHS', EVENT_SUBSCRIPTION_WIDTHS],
    ['KV_SHARE_HANDLE_WIDTHS', KV_SHARE_HANDLE_WIDTHS],
] as const)('%s', (_label, widths) => {
    for (const [key, spec] of Object.entries(widths)) {
        it(`accepts \`${key}\` right at ${spec.max} characters`, () => {
            expect(() =>
                assertColumnWidths(widths, { [key]: 'a'.repeat(spec.max) }),
            ).not.toThrow();
        });

        it(`refuses \`${key}\` one character over ${spec.max}`, () => {
            expectTooLarge(() =>
                assertColumnWidths(widths, {
                    [key]: 'a'.repeat(spec.max + 1),
                }),
            );
        });
    }
});

describe('assertColumnWidths', () => {
    it('skips null and undefined values', () => {
        expect(() =>
            assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
                anchorUid: null,
                anchorPath: undefined,
            }),
        ).not.toThrow();
    });

    it('reports the caller-facing field name, not the object key', () => {
        expect(
            messageFor(() =>
                assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
                    anchorUid: over(EVENT_SUBSCRIPTION_WIDTHS.anchorUid),
                }),
            ),
        ).toBe('`anchor.uid` may not exceed 40 characters');

        expect(
            messageFor(() =>
                assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
                    anchorPath: over(EVENT_SUBSCRIPTION_WIDTHS.anchorPath),
                }),
            ),
        ).toContain('`anchor.path`');

        expect(
            messageFor(() =>
                assertColumnWidths(KV_SHARE_HANDLE_WIDTHS, {
                    keyPrefix: over(KV_SHARE_HANDLE_WIDTHS.keyPrefix),
                }),
            ),
        ).toContain('`prefix`');
    });

    it('falls back to the object key when no field label is set', () => {
        expect(
            messageFor(() =>
                assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
                    token: over(EVENT_SUBSCRIPTION_WIDTHS.token),
                }),
            ),
        ).toBe('`token` may not exceed 255 characters');
    });

    it('rejects a value made entirely of astral characters at half the real capacity', () => {
        // An astral character is 2 code units to JS and 1 character to MySQL,
        // so a run of them is rejected early — never late.
        const max = EVENT_SUBSCRIPTION_WIDTHS.appUid.max;
        const atLimit = '\u{1F600}'.repeat(max / 2);
        const overLimit = '\u{1F600}'.repeat(max / 2 + 1);
        expect(atLimit.length).toBe(max);

        expect(() =>
            assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, { appUid: atLimit }),
        ).not.toThrow();
        expectTooLarge(() =>
            assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
                appUid: overLimit,
            }),
        );
    });
});

// -- Schema drift ------------------------------------------------------

const MIGRATIONS_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../clients/database/migrations/mysql',
);

/**
 * The width of every `(var)char` column a table declares, as of the last
 * migration that touched it: the initial `CREATE TABLE`, then every later
 * `MODIFY [COLUMN]` in numeric migration order.
 */
const declaredWidths = (table: string): Map<string, number> => {
    const widths = new Map<string, number>();
    const columnPattern = /`(\w+)`\s+(?:var)?char\((\d+)\)/gi;
    const files = readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort(compareMigrationFilenames);

    for (const file of files) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

        const create = new RegExp(
            `CREATE TABLE IF NOT EXISTS \`${table}\`[\\s\\S]*?\\)\\s*ENGINE=`,
            'i',
        ).exec(sql)?.[0];
        if (create)
            for (const m of create.matchAll(columnPattern))
                widths.set(m[1], Number(m[2]));

        const alterPattern = new RegExp(
            `ALTER TABLE \`${table}\`\\s+MODIFY(?:\\s+COLUMN)?\\s+` +
                '`(\\w+)`\\s+(?:var)?char\\((\\d+)\\)',
            'gi',
        );
        for (const m of sql.matchAll(alterPattern))
            widths.set(m[1], Number(m[2]));
    }

    return widths;
};

describe('declared column widths, read from the mysql migrations', () => {
    it.each([
        ['event_subscriptions', EVENT_SUBSCRIPTION_WIDTHS],
        ['kv_share_handles', KV_SHARE_HANDLE_WIDTHS],
    ] as const)(
        '%s: every guarded column matches its migration width',
        (table, widths) => {
            const declared = declaredWidths(table);
            for (const spec of Object.values(widths))
                expect(declared.get(spec.column)).toBe(spec.max);
        },
    );

    it.each([
        ['event_subscriptions', EVENT_SUBSCRIPTION_WIDTHS],
        ['kv_share_handles', KV_SHARE_HANDLE_WIDTHS],
    ] as const)(
        '%s: every declared char/varchar column is guarded or a known enum',
        (table, widths) => {
            const guarded = new Set(
                Object.values(widths).map((spec) => spec.column),
            );
            const declared = declaredWidths(table);
            // Without this the loop below passes on an empty parse.
            expect(declared.size).toBeGreaterThanOrEqual(guarded.size);
            for (const column of declared.keys())
                expect(
                    guarded.has(column) || ENUM_COLUMNS.includes(column),
                ).toBe(true);
        },
    );
});
