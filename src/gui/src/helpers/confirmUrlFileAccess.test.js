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

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The permission dialog this helper defaults to reads GUI plumbing as globals
// at import time; the tests inject their own dialog, but the module still loads.
globalThis.window = globalThis.window ?? {};
globalThis.i18n = globalThis.i18n ?? ((key) => key);

const { confirmUrlFileAccess } = await import('./confirmUrlFileAccess.js');

const APP = 'app-uid-1';
const FILE = '/alice/Documents/notes.txt';

let permissionDialog;
const deps = (stat) => ({ stat, permissionDialog });

beforeEach(() => {
    permissionDialog = vi.fn(async () => true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('confirmUrlFileAccess', () => {
    it('asks for write on the named file and reports the user allowing it', async () => {
        const stat = vi.fn(async () => ({ is_dir: false }));
        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP, appName: 'notepad' }, deps(stat),
        )).resolves.toBe(true);
        expect(permissionDialog).toHaveBeenCalledWith({
            app_uid: APP,
            app_name: 'notepad',
            permission: `fs:${FILE}:write`,
            create: false,
        });
    });

    it('reports a refusal when the user denies', async () => {
        permissionDialog = vi.fn(async () => false);
        const stat = vi.fn(async () => ({ is_dir: false }));
        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP }, deps(stat),
        )).resolves.toBe(false);
    });

    it('refuses a directory without prompting — the grant would cover the tree', async () => {
        const stat = vi.fn(async () => ({ is_dir: true }));
        await expect(confirmUrlFileAccess(
            { path: '/alice', appUid: APP }, deps(stat),
        )).resolves.toBe(false);
        expect(permissionDialog).not.toHaveBeenCalled();
    });

    it('refuses a path it cannot stat', async () => {
        const stat = vi.fn(async () => { throw new Error('404'); });
        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP }, deps(stat),
        )).resolves.toBe(false);
        expect(permissionDialog).not.toHaveBeenCalled();
    });

    it('refuses without a path or an app to name the grant against', async () => {
        const stat = vi.fn(async () => ({ is_dir: false }));
        await expect(confirmUrlFileAccess({ path: FILE }, deps(stat)))
            .resolves.toBe(false);
        await expect(confirmUrlFileAccess({ appUid: APP }, deps(stat)))
            .resolves.toBe(false);
        expect(stat).not.toHaveBeenCalled();
        expect(permissionDialog).not.toHaveBeenCalled();
    });
});
