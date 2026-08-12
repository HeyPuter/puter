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

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { runWithContext } from './context';
import { recordStorageOps } from './storageOps';

const withRequest = (fn: () => void): Request => {
    const req = {} as Request;
    runWithContext({ req }, fn);
    return req;
};

describe('recordStorageOps', () => {
    it('tallies each class on the request in scope', () => {
        const req = withRequest(() => {
            recordStorageOps('write');
            recordStorageOps('write', 3);
            recordStorageOps('read');
            recordStorageOps('delete', 2);
        });

        expect(req.storageOps).toEqual({ write: 4, read: 1, delete: 2 });
    });

    it('ignores counts that are not a positive number', () => {
        const req = withRequest(() => {
            recordStorageOps('write', 0);
            recordStorageOps('write', -1);
            recordStorageOps('write', Number.NaN);
        });

        expect(req.storageOps).toBeUndefined();
    });

    it('does nothing outside a request', () => {
        expect(() => recordStorageOps('write')).not.toThrow();
    });

    it('does nothing when the context carries no request', () => {
        expect(() =>
            runWithContext({}, () => recordStorageOps('write')),
        ).not.toThrow();
    });
});
