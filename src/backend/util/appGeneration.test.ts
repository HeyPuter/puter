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
    APP_CLOCK_SKEW_SECONDS,
    appGenerationStart,
    predatesApp,
} from './appGeneration.js';

describe('app generations', () => {
    const app = { created_epoch: 10_000 };

    it('starts a clock-skew allowance before the app row was created', () => {
        expect(appGenerationStart(app)).toBe(10_000 - APP_CLOCK_SKEW_SECONDS);
    });

    it('has no start without a creation time', () => {
        for (const row of [null, undefined, {}, { created_epoch: 0 }])
            expect(appGenerationStart(row)).toBeNull();
    });

    it('counts only records made before that start as older', () => {
        const start = 10_000 - APP_CLOCK_SKEW_SECONDS;
        expect(predatesApp(start - 1, app)).toBe(true);
        expect(predatesApp(start, app)).toBe(false);
        expect(predatesApp(10_000 + 5, app)).toBe(false);
        expect(predatesApp(1, null)).toBe(false);
    });
});
