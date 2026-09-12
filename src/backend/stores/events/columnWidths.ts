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

import { HttpError } from '../../core/http/HttpError.js';

/** How wide one column is, and the name a caller knows the value by. */
interface ColumnWidth {
    /** Column in the migrations, so a schema change is greppable from here. */
    column: string;
    max: number;
    /** Caller-facing name for the error message; defaults to the key. */
    field?: string;
}

export const EVENT_SUBSCRIPTION_WIDTHS = {
    subId: { column: 'sub_id', max: 80 },
    token: { column: 'token', max: 255 },
    appUid: { column: 'app_uid', max: 40 },
    subject: { column: 'subject', max: 4096 },
    anchorUid: { column: 'anchor_uid', max: 40, field: 'anchor.uid' },
    anchorPath: { column: 'anchor_path', max: 4096, field: 'anchor.path' },
    match: { column: 'match', max: 1024 },
    handlerName: { column: 'handler_name', max: 128 },
    permission: { column: 'permission', max: 1024 },
} as const satisfies Record<string, ColumnWidth>;

export const KV_SHARE_HANDLE_WIDTHS = {
    handle: { column: 'handle', max: 64 },
    appUid: { column: 'app_uid', max: 40 },
    keyPrefix: { column: 'key_prefix', max: 1024, field: 'prefix' },
    permission: { column: 'permission', max: 1024 },
} as const satisfies Record<string, ColumnWidth>;

/** Columns on these tables held to a server-side enum rather than a width. */
export const ENUM_COLUMNS: readonly string[] = [
    'delivery',
    'ops',
    'suspended_reason',
];

const valueTooLong = (field: string, max: number): HttpError =>
    new HttpError(413, `\`${field}\` may not exceed ${max} characters`, {
        legacyCode: 'events_value_too_large',
    });

/**
 * Refuse a value the column would otherwise truncate. A truncated grant string
 * is a different grant, so this cannot be left to the database's `sql_mode`.
 *
 * Counts UTF-16 code units, not code points, like every other length check in
 * this codebase — it only ever rejects early relative to MySQL, never late.
 */
export const assertColumnWidths = <K extends string>(
    widths: Record<K, ColumnWidth>,
    values: Partial<Record<K, string | null | undefined>>,
): void => {
    for (const key of Object.keys(values) as K[]) {
        const value = values[key];
        if (typeof value !== 'string') continue;
        const spec = widths[key];
        if (value.length > spec.max)
            throw valueTooLong(spec.field ?? key, spec.max);
    }
};
