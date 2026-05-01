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

export const MANAGE_PERM_PREFIX = 'manage';
export const PERM_KEY_PREFIX = 'perm';

/**
 * De-facto placeholder permission for permission rewrites that do not grant
 * any access.
 */
export const PERMISSION_FOR_NOTHING_IN_PARTICULAR =
    'permission-for-nothing-in-particular';

/** TTL (seconds) for redis-cached permission scan readings. */
export const PERMISSION_SCAN_CACHE_TTL_SECONDS = 20;
