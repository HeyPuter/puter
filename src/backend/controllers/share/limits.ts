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

import type { RouteRateLimit } from '../../core/http/types';

// Shared like `fs/limits.ts` is shared: the scope only ties counters
// together if every caller passes the same spec.

/**
 * Two windows: a burst ceiling, and a daily one so a slow drip can't add up to
 * a mail-merge. Neither bounds _shares_ — one request carries many — which is
 * what `ShareService`'s per-day quota is for.
 */
export const SHARE_LIMIT: RouteRateLimit[] = [
    { scope: 'share:mutate', limit: 60, window: 60_000, key: 'user' },
    {
        scope: 'share:mutate-daily',
        limit: 500,
        window: 24 * 60 * 60_000,
        key: 'user',
    },
];

/**
 * One bucket for every share-listing read. The `/share` routes gate on it, and
 * `stat` charges it imperatively when `return_shares` asks for the same listing
 * work — otherwise the flag runs share listings under `fs:stat`'s far more
 * generous budget.
 */
export const SHARE_LIST_LIMIT: RouteRateLimit = {
    scope: 'share:list',
    limit: 600,
    window: 60_000,
    key: 'user',
};
