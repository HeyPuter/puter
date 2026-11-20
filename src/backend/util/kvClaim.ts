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

import type { SystemKVStore } from '../stores/systemKv/SystemKVStore.js';

/**
 * Claim `key` in the system KV for `ttlSeconds`: true for the one caller whose
 * write landed, false while an earlier claim is live or when the store failed.
 * For one-shot notices, where a missed one beats a repeated one.
 */
export async function claimOnce(
    kv: Pick<SystemKVStore, 'set'>,
    key: string,
    ttlSeconds: number,
): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    try {
        const { res } = await kv.set({
            key,
            value: now,
            expireAt: now + ttlSeconds,
            onlyIfAbsent: true,
        });
        return res === true;
    } catch (e) {
        console.warn(`[kv-claim] ${key} failed:`, e);
        return false;
    }
}
