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

const DATA_URI_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

export interface DataUri {
    /** Lowercased; `defaultMimeType` when the URI names none. */
    mimeType: string;
    base64: boolean;
    data: string;
}

/**
 * Split a `data:` URI into its MIME type, base64 flag and payload. Returns null
 * for anything that isn't a data URI. RFC 2397 defaults the type to text/plain;
 * callers that know better pass their own.
 */
export function parseDataUri(
    url: string,
    defaultMimeType = 'text/plain',
): DataUri | null {
    const match = DATA_URI_PATTERN.exec(url);
    if (!match) return null;
    const params = (match[2] ?? '')
        .split(';')
        .filter(Boolean)
        .map((p) => p.trim().toLowerCase());
    return {
        mimeType: (match[1] || defaultMimeType).toLowerCase(),
        base64: params.includes('base64'),
        data: match[3] ?? '',
    };
}

/** The bytes a data URI carries: base64-decoded, or percent-decoded text. */
export function dataUriBytes(uri: DataUri): Buffer {
    if (uri.base64) return Buffer.from(uri.data, 'base64');
    try {
        return Buffer.from(decodeURIComponent(uri.data));
    } catch {
        throw new HttpError(400, 'Invalid data URL', {
            legacyCode: 'bad_request',
        });
    }
}
