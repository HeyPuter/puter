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

import type { StorageOpClass } from '../../core/storageOps';
import { toMicroCents } from './utils.js';

const BYTES_PER_GIB = 1024 * 1024 * 1024;

/**
 * Microcents per byte sent to a client, counted once for the whole response
 * rather than per subsystem — a file, a JSON body and a rendered page all leave
 * by the same door and cost the same per byte (~$0.12/GiB).
 */
export const EGRESS_COSTS = {
    'egress:bytes': toMicroCents(0.12 / BYTES_PER_GIB),
} as const;

/**
 * Microcents per object-store request. Requests are billed by class regardless
 * of how much data moves, so a directory of tiny files costs far more per byte
 * than one large one — which is what these price in. Removals are free.
 */
export const STORAGE_OP_COSTS = {
    'storage:write:ops': toMicroCents(0.005 / 1000),
    'storage:read:ops': toMicroCents(0.0004 / 1000),
    'storage:delete:ops': 0,
} as const;

export type StorageOpUsageType = keyof typeof STORAGE_OP_COSTS;

export const STORAGE_OP_USAGE_TYPES: Record<
    StorageOpClass,
    StorageOpUsageType
> = {
    write: 'storage:write:ops',
    read: 'storage:read:ops',
    delete: 'storage:delete:ops',
};
