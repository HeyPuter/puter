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

import { describe, expect, it } from 'vitest';
import { ModelCatalog } from './modelCatalog.js';

describe('ModelCatalog', () => {
    const a = {
        id: 'a',
        provider: 'p1',
        costs: { output: 10, note: Number.NaN },
    };
    const b = {
        id: 'b',
        puterId: 'p2:b',
        provider: 'p2',
        costs: { output: 5 },
    };
    const hidden = { id: 'hidden', provider: 'p1', costs: { output: 1 } };

    it('lists names by puterId, falling back to id, sorted', () => {
        expect(new ModelCatalog([b, a], [], 'aiImage').names).toEqual([
            'a',
            'p2:b',
        ]);
    });

    it('reports costs for every routable model once, listed or not', () => {
        const catalog = new ModelCatalog([a], [a, hidden, a], 'aiImage');
        expect(catalog.reportedCosts).toEqual([
            {
                usageType: 'p1:a:output',
                costValue: 10,
                source: 'driver:aiImage/p1',
            },
            {
                usageType: 'p1:hidden:output',
                costValue: 1,
                source: 'driver:aiImage/p1',
            },
        ]);
    });
});
