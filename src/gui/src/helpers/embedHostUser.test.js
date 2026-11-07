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
import { embedHostUser } from './embedHostUser.js';

const UUID = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';

describe('embedHostUser', () => {
    it('reads the user uuid from the fragment', () => {
        expect(embedHostUser(`#user=${UUID}`)).toBe(UUID);
        expect(embedHostUser(`#other=1&user=${UUID}`)).toBe(UUID);
    });

    it('lower-cases the uuid', () => {
        expect(embedHostUser(`#user=${UUID.toUpperCase()}`)).toBe(UUID);
    });

    it.each(['', '#', '#user=', '#user=admin', `#user=${UUID}x`, `#user= ${UUID}`, `#uid=${UUID}`, undefined])(
        'is null for %j', hash => {
            expect(embedHostUser(hash)).toBeNull();
        },
    );
});
