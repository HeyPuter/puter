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
import {
    deliveryBackoffMs,
    EVENTS_RETRY_BASE_MS,
    EVENTS_RETRY_MAX_MS,
} from './retryBackoff.js';

describe('deliveryBackoffMs', () => {
    it('doubles from the base per failure and stops at the ceiling', () => {
        expect(deliveryBackoffMs(0)).toBe(EVENTS_RETRY_BASE_MS);
        expect(deliveryBackoffMs(1)).toBe(EVENTS_RETRY_BASE_MS);
        expect(deliveryBackoffMs(3)).toBe(EVENTS_RETRY_BASE_MS * 4);
        expect(deliveryBackoffMs(50)).toBe(EVENTS_RETRY_MAX_MS);
    });
});
