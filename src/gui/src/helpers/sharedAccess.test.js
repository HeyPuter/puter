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
    can_rename,
    can_restructure,
    can_share,
    invalidate_shared_roots,
    remember_shared_roots,
    shared_mode_for,
} from './sharedAccess.js';

const CONTENTS = '11111111-1111-1111-1111-111111111111';
const PHOTOS = '22222222-2222-2222-2222-222222222222';
const BUDGET = '33333333-3333-3333-3333-333333333333';
const REPORT = '44444444-4444-4444-4444-444444444444';

describe('shared_access', () => {
    beforeEach(() => {
        invalidate_shared_roots();
        globalThis.window = { user: { username: 'sharemate' }, trash_path: '/sharemate/Trash' };
        // Shared roots arrive masked: `/{owner}/{uid}/{name}`.
        remember_shared_roots([
            { path: `/jf/${CONTENTS}/Contents`, mode: 'write' },
            { path: `/jf/${PHOTOS}/Photos`, mode: 'read' },
            { path: `/jf/${BUDGET}/Budget`, mode: 'manage' },
            { path: `/jf/${REPORT}/report.pdf`, mode: 'write' },
        ]);
    });

    describe('shared_mode_for', () => {
        it('reports the mode held on a shared root', async () => {
            expect(await shared_mode_for(`/jf/${PHOTOS}/Photos`)).toBe('read');
        });

        it('inherits the mode down into the folder', async () => {
            expect(await shared_mode_for(`/jf/${PHOTOS}/Photos/2024/a.jpg`)).toBe('read');
        });

        it('prefers the nearest shared ancestor', async () => {
            remember_shared_roots([
                { path: '/jf/Documents', mode: 'read' },
                { path: `/jf/${CONTENTS}/Contents`, mode: 'write' },
            ]);
            expect(await shared_mode_for(`/jf/${CONTENTS}/Contents/a.txt`)).toBe(
                'write',
            );
        });

        it('reports nothing outside every shared root', async () => {
            expect(await shared_mode_for(`/jf/${CONTENTS}/Private/a.txt`)).toBe(null);
        });
    });

    describe('can_restructure', () => {
        it('allows an item inside a folder shared for writing', async () => {
            expect(
                await can_restructure(`/jf/${CONTENTS}/Contents/a.txt`),
            ).toBe(true);
        });

        it('allows an item nested deeper in that folder', async () => {
            expect(
                await can_restructure(`/jf/${CONTENTS}/Contents/sub/a.txt`),
            ).toBe(true);
        });

        it('allows an item inside a folder shared for managing', async () => {
            expect(await can_restructure(`/jf/${BUDGET}/Budget/q1.xlsx`)).toBe(true);
        });

        it('refuses the shared folder itself', async () => {
            expect(await can_restructure(`/jf/${CONTENTS}/Contents`)).toBe(false);
        });

        it('refuses a file shared directly', async () => {
            expect(await can_restructure(`/jf/${REPORT}/report.pdf`)).toBe(false);
        });

        it('refuses inside a folder shared read-only', async () => {
            expect(await can_restructure(`/jf/${PHOTOS}/Photos/a.jpg`)).toBe(false);
        });

        it('refuses a path that is not shared at all', async () => {
            expect(await can_restructure(`/jf/${CONTENTS}/Private/a.txt`)).toBe(false);
        });

        it('refuses a non-string path', async () => {
            expect(await can_restructure(undefined)).toBe(false);
        });

        it('allows your own items, shared or not', async () => {
            expect(await can_restructure('/sharemate/Documents/a.txt')).toBe(
                true,
            );
        });
    });

    describe('can_share', () => {
        it('allows your own items', async () => {
            expect(await can_share('/sharemate/Documents/a.txt')).toBe(true);
        });

        it('refuses someone else\u2019s item held short of manage', async () => {
            expect(await can_share(`/jf/${CONTENTS}/Contents/a.txt`)).toBe(false);
            expect(await can_share(`/jf/${PHOTOS}/Photos`, 'read')).toBe(false);
        });

        it('allows an item held with manage', async () => {
            expect(await can_share(`/jf/${BUDGET}/Budget`)).toBe(true);
        });

        it('allows an item inside a folder held with manage', async () => {
            // The row itself carries a mode only at a shared root.
            expect(await can_share(`/jf/${BUDGET}/Budget/q1.xlsx`)).toBe(true);
        });

        it('takes the row\u2019s own mode without a lookup', async () => {
            invalidate_shared_roots();
            expect(await can_share('/jf/whatever/a.txt', 'manage')).toBe(true);
        });

        it('refuses trashed items, yours included', async () => {
            expect(await can_share('/sharemate/Trash')).toBe(false);
            expect(await can_share('/sharemate/Trash/a.txt')).toBe(false);
        });

        it('refuses an empty or non-string path', async () => {
            expect(await can_share('')).toBe(false);
            expect(await can_share(undefined)).toBe(false);
        });
    });

    describe('can_rename', () => {
        it('allows a file shared directly for writing', async () => {
            expect(await can_rename(`/jf/${REPORT}/report.pdf`)).toBe(true);
        });

        it('refuses a shared folder root, even with write', async () => {
            expect(await can_rename(`/jf/${CONTENTS}/Contents`, true)).toBe(false);
        });

        it('refuses a shared folder root held with manage', async () => {
            expect(await can_rename(`/jf/${BUDGET}/Budget`, true)).toBe(false);
        });

        it('allows items inside a folder shared for writing', async () => {
            expect(await can_rename(`/jf/${CONTENTS}/Contents/a.txt`)).toBe(true);
            expect(
                await can_rename(`/jf/${CONTENTS}/Contents/sub`, true),
            ).toBe(true);
        });

        it('refuses anything shared read-only', async () => {
            expect(await can_rename(`/jf/${PHOTOS}/Photos`, true)).toBe(false);
            expect(await can_rename(`/jf/${PHOTOS}/Photos/a.jpg`)).toBe(false);
        });

        it('refuses a path that is not shared at all', async () => {
            expect(await can_rename(`/jf/${CONTENTS}/Private/a.txt`)).toBe(false);
        });

        it('refuses a non-string path', async () => {
            expect(await can_rename(undefined)).toBe(false);
        });

        it('allows your own items', async () => {
            expect(await can_rename('/sharemate/Documents/a.txt')).toBe(true);
            expect(await can_rename('/sharemate/Documents', true)).toBe(true);
        });
    });
});
