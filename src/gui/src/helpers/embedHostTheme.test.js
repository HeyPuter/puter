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
import { embedHostTheme } from './embedHostTheme.js';

describe('embedHostTheme', () => {
    it('reads a forced theme from the fragment', () => {
        expect(embedHostTheme('#theme=dark')).toBe('dark');
        expect(embedHostTheme('#user=0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40&theme=light')).toBe('light');
    });

    it.each(['', '#', '#theme=', '#theme=Dark', '#theme=auto', '#scheme=dark', undefined])(
        'is null for %j', hash => {
            expect(embedHostTheme(hash)).toBeNull();
        },
    );
});
