// @vitest-environment jsdom
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./launchApp.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
// Encodes like the real i18n() unless told not to.
globalThis.i18n = (key, vars, encode = true) => {
    const text = vars?.ext ? `${key}:${vars.ext}` : key;
    return encode ? html_encode(text) : text;
};
window.icons = {};

const { default: build_open_with_items } = await import('./openWithItems.js');
const { default: launch_app } = await import('./launchApp.js');

const EDITOR = { name: 'editor', title: 'Editor', uuid: 'app-editor' };
const CODE = { name: 'code', title: 'Code', uuid: 'app-code' };
const MARKUS = { name: 'markus', title: 'Markus <b>', uuid: 'app-markus' };

const fileRow = (filePath = '/alice/Documents/Notes.MD') => {
    const row = document.createElement('div');
    row.setAttribute('data-path', filePath);
    row.setAttribute('data-name', filePath.split('/').pop());
    row.setAttribute('data-uid', 'file-1');
    return row;
};

const apps = (items) => items.filter(item => item !== '-' && !item.items);
const alwaysMenu = (items) => items.find(item => item.items);

beforeEach(() => {
    window.user_preferences = {};
    window.mutate_user_preferences = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    launch_app.mockClear();
});

describe('build_open_with_items', () => {
    it('lists the apps in the server order when no default is saved', () => {
        const items = build_open_with_items(fileRow(), [EDITOR, CODE, MARKUS]);
        expect(apps(items).map(item => item.html)).toEqual(['Editor', 'Code', 'Markus &lt;b&gt;']);
    });

    it('moves the saved default to the top', () => {
        window.user_preferences['default_apps.md'] = MARKUS.uuid;
        const items = build_open_with_items(fileRow(), [EDITOR, CODE, MARKUS]);
        expect(apps(items).map(item => item.html)).toEqual(['Markus &lt;b&gt;', 'Editor', 'Code']);
    });

    it('keeps the server order when the saved default is no longer suggested', () => {
        window.user_preferences['default_apps.md'] = 'app-gone';
        const items = build_open_with_items(fileRow(), [EDITOR, CODE]);
        expect(apps(items).map(item => item.html)).toEqual(['Editor', 'Code']);
    });

    it('opens the file in the chosen app without saving a default', () => {
        const row = fileRow();
        apps(build_open_with_items(row, [EDITOR, CODE]))[1].onClick();
        expect(launch_app).toHaveBeenCalledWith({
            name: 'code',
            file_path: '/alice/Documents/Notes.MD',
            window_title: 'Notes.MD',
            file_uid: 'file-1',
        });
        expect(window.mutate_user_preferences).not.toHaveBeenCalled();
    });

    it('opens the chosen app in a new tab when asked to', () => {
        const tab = {};
        vi.spyOn(window, 'open').mockImplementation(() => tab);
        apps(build_open_with_items(fileRow(), [EDITOR, CODE], { inNewTab: true }))[0].onClick();
        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(launch_app).toHaveBeenCalledWith(expect.objectContaining({ name: 'editor', newTab: tab }));
    });

    it('says when no app can open the file', () => {
        for ( const suggested of [undefined, [], [null]] ) {
            expect(build_open_with_items(fileRow(), suggested)).toEqual([
                { html: 'no_suitable_apps_found', disabled: true },
            ]);
        }
    });

    it('skips missing entries in the suggestions', () => {
        const items = build_open_with_items(fileRow(), [null, EDITOR, CODE]);
        expect(apps(items).map(item => item.html)).toEqual(['Editor', 'Code']);
    });
});

describe('Always Open … Files With', () => {
    it('names the lowercased extension and checks the app a double-click uses', () => {
        const always = alwaysMenu(build_open_with_items(fileRow(), [EDITOR, CODE]));
        expect(always.html).toBe('always_open_ext_files_with:.md');
        expect(always.label).toBe('always_open_ext_files_with:.md');
        expect(always.items.map(item => [item.html, item.checked])).toEqual([['Editor', true], ['Code', false]]);
    });

    it('checks the saved default and keeps the server order', () => {
        window.user_preferences['default_apps.md'] = CODE.uuid;
        const always = alwaysMenu(build_open_with_items(fileRow(), [EDITOR, CODE]));
        expect(always.items.map(item => [item.html, item.checked])).toEqual([['Editor', false], ['Code', true]]);
    });

    it('checks a default saved by app name', () => {
        window.user_preferences['default_apps.md'] = 'code';
        const always = alwaysMenu(build_open_with_items(fileRow(), [EDITOR, CODE]));
        expect(always.items.find(item => item.checked).html).toBe('Code');
    });

    // UIContextMenu encodes a submenu row's `html` itself; the touch menu
    // renders `label` as HTML.
    it('gives each menu the extension encoded once', () => {
        const always = alwaysMenu(build_open_with_items(fileRow('/bob/a.<img src=x onerror=alert(1)>'), [EDITOR, CODE]));
        expect(always.html).toBe('always_open_ext_files_with:.<img src=x onerror=alert(1)>');
        expect(always.label).toBe('always_open_ext_files_with:.&lt;img src=x onerror=alert(1)&gt;');
    });

    it('saves only the chosen app for the extension', () => {
        alwaysMenu(build_open_with_items(fileRow(), [EDITOR, CODE])).items[1].onClick();
        expect(window.mutate_user_preferences).toHaveBeenCalledWith({ 'default_apps.md': CODE.uuid });
        expect(launch_app).not.toHaveBeenCalled();
    });

    it('is left out when only one app can open the file', () => {
        expect(alwaysMenu(build_open_with_items(fileRow(), [EDITOR]))).toBeUndefined();
    });

    it('is left out for a file without an extension', () => {
        expect(alwaysMenu(build_open_with_items(fileRow('/alice/Makefile'), [EDITOR, CODE]))).toBeUndefined();
        expect(alwaysMenu(build_open_with_items(fileRow('/alice/.bashrc'), [EDITOR, CODE]))).toBeUndefined();
        expect(alwaysMenu(build_open_with_items(fileRow('/alice/notes.'), [EDITOR, CODE]))).toBeUndefined();
    });
});
