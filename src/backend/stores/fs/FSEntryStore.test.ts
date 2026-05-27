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
import type { IConfig } from '../../types';
import { FSEntryStore } from './FSEntryStore.js';

describe('FSEntryStore', () => {
    it('quotes camelCase storage allowance aliases for Postgres', async () => {
        const queries: string[] = [];
        const config: IConfig = {
            port: 0,
            extensions: [],
            is_storage_limited: true,
            storage_capacity: 1000,
        };
        const clients = {
            db: {
                quoteIdentifier: (identifier: string) => `"${identifier}"`,
                read: async (query: string) => {
                    queries.push(query);
                    if (query.includes('SUM(size)')) {
                        return [{ totalUsage: 321 }];
                    }
                    return [{ freeStorage: 654 }];
                },
            },
            event: {
                emitAndWait: async () => undefined,
            },
        };
        const store = new FSEntryStore(
            config,
            clients as ConstructorParameters<typeof FSEntryStore>[1],
            {} as ConstructorParameters<typeof FSEntryStore>[2],
        );

        await expect(store.getUserStorageAllowance(42)).resolves.toEqual({
            curr: 321,
            max: 654,
        });
        expect(queries).toEqual([
            'SELECT COALESCE(SUM(size), 0) AS "totalUsage" FROM fsentries WHERE user_id = ?',
            'SELECT free_storage AS "freeStorage" FROM "user" WHERE id = ? LIMIT 1',
        ]);
    });
});
