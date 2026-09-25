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

const { confirmUrlFileAccess, urlFileLaunchOptions } = await import('./confirmUrlFileAccess.js');

const APP = 'app-uid-1';
const FILE = '/alice/Documents/notes.txt';
const FILE_UID = '2b7d8c1e-4f3a-4b6c-9d1e-0a1b2c3d4e5f';

let permissionDialog;
let appHoldsPermissions;
const deps = (stat) => ({ stat, permissionDialog, appHoldsPermissions });

beforeEach(() => {
    permissionDialog = vi.fn(async () => true);
    appHoldsPermissions = vi.fn(async () => false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('urlFileLaunchOptions', () => {
    it('sends a uid and a path down different launch options, both gated', () => {
        expect(urlFileLaunchOptions(FILE_UID)).toEqual({ file_uid: FILE_UID, confirm_file_access: true });
        expect(urlFileLaunchOptions(FILE)).toEqual({ file_path: FILE, confirm_file_access: true });
        expect(urlFileLaunchOptions('~/notes.txt')).toEqual({ file_path: '~/notes.txt', confirm_file_access: true });
    });

    it('is empty without a value', () => {
        expect(urlFileLaunchOptions(null)).toEqual({});
        expect(urlFileLaunchOptions('')).toEqual({});
    });
});

describe('confirmUrlFileAccess', () => {
    it('asks for write on the named file and hands it back when the user allows', async () => {
        const stat = vi.fn(async () => ({ uid: FILE_UID, path: FILE, is_dir: false }));
        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP, appName: 'notepad' }, deps(stat),
        )).resolves.toEqual({ uid: FILE_UID, path: FILE });
        expect(stat).toHaveBeenCalledWith({ path: FILE });
        expect(permissionDialog).toHaveBeenCalledWith({
            app_uid: APP,
            app_name: 'notepad',
            permission: `fs:${FILE_UID}:write`,
            create: false,
        });
    });

    it('resolves a uid the same way, with the path the viewer may use', async () => {
        const masked = `/alice/${FILE_UID}/notes.txt`;
        const stat = vi.fn(async () => ({ uid: FILE_UID, path: masked, is_dir: false }));
        await expect(confirmUrlFileAccess(
            { uid: FILE_UID, appUid: APP }, deps(stat),
        )).resolves.toEqual({ uid: FILE_UID, path: masked });
        expect(stat).toHaveBeenCalledWith({ uid: FILE_UID });
        expect(permissionDialog).toHaveBeenCalledWith(expect.objectContaining({
            permission: `fs:${FILE_UID}:write`,
        }));
    });

    // The reason this gate stopped asking on every launch of the same link.
    it('hands the file over without prompting when the app already holds the grant', async () => {
        const stat = vi.fn(async () => ({ uid: FILE_UID, path: FILE, is_dir: false }));
        appHoldsPermissions = vi.fn(async () => true);

        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP, appName: 'notepad' }, deps(stat),
        )).resolves.toEqual({ uid: FILE_UID, path: FILE });

        expect(appHoldsPermissions).toHaveBeenCalledWith([`fs:${FILE_UID}:write`], APP);
        expect(permissionDialog).not.toHaveBeenCalled();
    });

    // A check that couldn't be made is not consent, and must not fail the launch either.
    it('prompts when the check for an existing grant throws', async () => {
        const stat = vi.fn(async () => ({ uid: FILE_UID, path: FILE, is_dir: false }));
        appHoldsPermissions = vi.fn(async () => { throw new Error('network down'); });

        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP }, deps(stat),
        )).resolves.toEqual({ uid: FILE_UID, path: FILE });
        expect(permissionDialog).toHaveBeenCalled();
    });

    it('reports a refusal when the user denies', async () => {
        permissionDialog = vi.fn(async () => false);
        const stat = vi.fn(async () => ({ uid: FILE_UID, path: FILE, is_dir: false }));
        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP }, deps(stat),
        )).resolves.toBeNull();
    });

    it('refuses a directory without prompting — the grant would cover the tree', async () => {
        const stat = vi.fn(async () => ({ uid: 'dir-uid', path: '/alice', is_dir: true }));
        await expect(confirmUrlFileAccess(
            { path: '/alice', appUid: APP }, deps(stat),
        )).resolves.toBeNull();
        expect(permissionDialog).not.toHaveBeenCalled();
    });

    it('refuses a file it cannot stat', async () => {
        const stat = vi.fn(async () => { throw new Error('404'); });
        await expect(confirmUrlFileAccess(
            { path: FILE, appUid: APP }, deps(stat),
        )).resolves.toBeNull();
        await expect(confirmUrlFileAccess(
            { uid: FILE_UID, appUid: APP }, deps(stat),
        )).resolves.toBeNull();
        expect(permissionDialog).not.toHaveBeenCalled();
    });

    it('refuses without a file or an app to name the grant against', async () => {
        const stat = vi.fn(async () => ({ uid: FILE_UID, path: FILE, is_dir: false }));
        await expect(confirmUrlFileAccess({ path: FILE }, deps(stat)))
            .resolves.toBeNull();
        await expect(confirmUrlFileAccess({ appUid: APP }, deps(stat)))
            .resolves.toBeNull();
        expect(stat).not.toHaveBeenCalled();
        expect(permissionDialog).not.toHaveBeenCalled();
    });
});
