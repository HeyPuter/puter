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

import { createHash } from 'node:crypto';

const RANGE_API = 'https://api.pwnedpasswords.com/range/';
/** A padded range answer is well under this. */
const MAX_RANGE_BYTES = 512 * 1024;

/**
 * A password's SHA-1, split for a k-anonymity range lookup: only `prefix`
 * leaves the server. Never log or store either half.
 */
export interface PasswordRange {
    prefix: string;
    suffix: string;
}

export const passwordRange = (password: string): PasswordRange => {
    const hex = createHash('sha1')
        .update(password, 'utf8')
        .digest('hex')
        .toUpperCase();
    return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
};

/**
 * Whether the range lists the suffix with a non-zero count (padding rows count
 * 0). `failed` carries only a status or error name, never the range.
 */
export async function lookupPasswordRange(
    range: PasswordRange,
    timeoutMs: number,
): Promise<{ hit: boolean } | { failed: string }> {
    try {
        const response = await fetch(`${RANGE_API}${range.prefix}`, {
            headers: { 'Add-Padding': 'true' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            await response.body?.cancel();
            return { failed: `status ${response.status}` };
        }
        const body = await readCapped(response);
        if (body === null) return { failed: 'oversized response' };
        for (const line of body.split('\n')) {
            const [suffix, count] = line.trim().split(':');
            if (suffix?.toUpperCase() === range.suffix) {
                return { hit: Number(count) > 0 };
            }
        }
        return { hit: false };
    } catch (e) {
        return { failed: e instanceof Error ? e.name : 'error' };
    }
}

async function readCapped(response: Response): Promise<string | null> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RANGE_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}
