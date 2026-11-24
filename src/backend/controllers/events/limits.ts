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

import { userWindow } from '../../services/events/limits.js';

// Extensions written against this path keep resolving the limits here.
export * from '../../services/events/limits.js';

// -- Route gates -----------------------------------------------------
//
// The HTTP routes' own rate limits. The quotas and caps the events service
// enforces live in `services/events/limits.ts`; both are published in
// `rate-limits-and-quotas.md`.

/**
 * Subscription listings per minute, per user. Reads an index and returns one
 * page, so it is budgeted well above the verbs that write.
 */
export const EVENTS_LIST_LIMIT = userWindow('events:list', 120);

/**
 * Missed-event fetches per minute, per user.
 *
 * A keyset page off one index, so it is budgeted like the other listings — a
 * client catching up after a disconnect walks a handful of pages once, not a
 * page per event.
 */
export const EVENTS_FETCH_LIMIT = userWindow('events:fetch', 120);

/** Handler listings per minute, per user. Reads an index, so budgeted higher. */
export const EVENTS_HANDLER_LIST_LIMIT = userWindow(
    'events:handlers:list',
    120,
);

/**
 * Events worker listings per minute, per user. Same shape as the handler
 * listing.
 */
export const EVENTS_WORKER_LIST_LIMIT = userWindow('events:workers:list', 120);
