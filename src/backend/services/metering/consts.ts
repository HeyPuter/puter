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

export const GLOBAL_APP_KEY = 'os-global';
export const METRICS_PREFIX = 'metering';
export const POLICY_PREFIX = 'policy';
/** dots in usage types are escaped so they don't collide with kv nested paths */
export const PERIOD_ESCAPE = '_dot_';
export const DEFAULT_FREE_SUBSCRIPTION = 'user_free';
export const DEFAULT_TEMP_SUBSCRIPTION = 'temp_free';
