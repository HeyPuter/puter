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

import { describe, it, expect } from 'vitest';
import { starts_hidden } from './starts_hidden.js';

describe('starts_hidden', () => {
    it('shows an ordinary app launched the ordinary way', () => {
        expect(starts_hidden({ background: false }, { name: 'editor' })).toBe(false);
        expect(starts_hidden({}, {})).toBe(false);
        expect(starts_hidden(undefined, undefined)).toBe(false);
    });

    it('hides an app that always runs windowless', () => {
        expect(starts_hidden({ background: true }, {})).toBe(true);
    });

    it('hides a launch that asked to start in the background', () => {
        expect(starts_hidden({}, { background: true })).toBe(true);
    });

    it('only treats an explicit true as a background launch', () => {
        // The flag arrives over IPC from another app, so anything truthy-ish
        // must not be able to hide a window by accident.
        expect(starts_hidden({}, { background: 'yes' })).toBe(false);
        expect(starts_hidden({}, { background: 1 })).toBe(false);
        expect(starts_hidden({}, { background: false })).toBe(false);
    });
});
