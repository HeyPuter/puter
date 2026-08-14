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

import { beforeEach, describe, expect, it } from 'vitest';
import {
    can_restructure,
    invalidate_shared_roots,
    remember_shared_roots,
    shared_mode_for,
} from './shared_access.js';

describe('shared_access', () => {
    beforeEach(() => {
        invalidate_shared_roots();
        remember_shared_roots([
            { path: '/jf/Documents/Contents', mode: 'write' },
            { path: '/jf/Photos', mode: 'read' },
            { path: '/jf/Budget', mode: 'manage' },
            { path: '/jf/report.pdf', mode: 'write' },
        ]);
    });

    describe('shared_mode_for', () => {
        it('reports the mode held on a shared root', async () => {
            expect(await shared_mode_for('/jf/Photos')).toBe('read');
        });

        it('inherits the mode down into the folder', async () => {
            expect(await shared_mode_for('/jf/Photos/2024/a.jpg')).toBe('read');
        });

        it('prefers the nearest shared ancestor', async () => {
            remember_shared_roots([
                { path: '/jf/Documents', mode: 'read' },
                { path: '/jf/Documents/Contents', mode: 'write' },
            ]);
            expect(await shared_mode_for('/jf/Documents/Contents/a.txt')).toBe(
                'write',
            );
        });

        it('reports nothing outside every shared root', async () => {
            expect(await shared_mode_for('/jf/Private/a.txt')).toBe(null);
        });
    });

    describe('can_restructure', () => {
        it('allows an item inside a folder shared for writing', async () => {
            expect(
                await can_restructure('/jf/Documents/Contents/a.txt'),
            ).toBe(true);
        });

        it('allows an item nested deeper in that folder', async () => {
            expect(
                await can_restructure('/jf/Documents/Contents/sub/a.txt'),
            ).toBe(true);
        });

        it('allows an item inside a folder shared for managing', async () => {
            expect(await can_restructure('/jf/Budget/q1.xlsx')).toBe(true);
        });

        it('refuses the shared folder itself', async () => {
            expect(await can_restructure('/jf/Documents/Contents')).toBe(false);
        });

        it('refuses a file shared directly', async () => {
            expect(await can_restructure('/jf/report.pdf')).toBe(false);
        });

        it('refuses inside a folder shared read-only', async () => {
            expect(await can_restructure('/jf/Photos/a.jpg')).toBe(false);
        });

        it('refuses a path that is not shared at all', async () => {
            expect(await can_restructure('/jf/Private/a.txt')).toBe(false);
        });

        it('refuses a non-string path', async () => {
            expect(await can_restructure(undefined)).toBe(false);
        });
    });
});
