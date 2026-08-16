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

import { Context } from './context';
import './http/expressAugmentation';

/**
 * Object-store request classes. They are priced apart because they cost
 * different amounts per request: uploads, copies and multipart parts are the
 * expensive class, fetches and metadata lookups an order of magnitude cheaper,
 * and removals are not charged for at all.
 */
export type StorageOpClass = 'write' | 'read' | 'delete';

export type StorageOpCounts = Partial<Record<StorageOpClass, number>>;

/**
 * Tally object-store requests against the request that caused them.
 *
 * The counts ride on the express request rather than going straight to
 * metering, so that the whole cost of serving a request — its response bytes
 * and the object-store calls behind them — settles as one write when the
 * response ends. Work with no request in scope (boot, background sweeps)
 * tallies nothing, which is why this never throws when called outside one.
 */
export const recordStorageOps = (
    opClass: StorageOpClass,
    count: number = 1,
): void => {
    if (!Number.isFinite(count) || count <= 0) return;
    const req = Context.get('req');
    if (!req) return;
    const ops = (req.storageOps ??= {});
    ops[opClass] = (ops[opClass] ?? 0) + count;
};
