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

/**
 * The API key from the first config block that has one. Every AI driver reads
 * the same fields, so a key works whichever driver a provider is used through.
 */
export function readProviderKey(
    ...cfgs: Array<Record<string, unknown> | undefined>
): string | undefined {
    for (const cfg of cfgs) {
        if (!cfg) continue;
        for (const field of ['apiKey', 'secret_key', 'api_key', 'key']) {
            const value = cfg[field];
            if (typeof value === 'string' && value) return value;
        }
    }
    return undefined;
}
