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
import { isHttpError } from './http/HttpError.js';
import {
    SCHEDULE_LIST_LIMIT_CAP,
    SCHEDULE_PEER_PATH,
    schedulesUnavailable,
} from './schedules.js';

describe('schedules contract', () => {
    it('answers an absent schedules service with a 503 events_disabled', () => {
        const err = schedulesUnavailable();
        expect(isHttpError(err)).toBe(true);
        expect(err.statusCode).toBe(503);
        expect(err.legacyCode).toBe('events_disabled');
        // Expected on a server without schedules, so it must not page.
        expect(err.noAlarm).toBe(true);
    });

    it('keeps the list cap and the peer path the extension relies on', () => {
        expect(SCHEDULE_LIST_LIMIT_CAP).toBe(200);
        expect(SCHEDULE_PEER_PATH).toBe('/broadcast/events/schedules');
    });
});
