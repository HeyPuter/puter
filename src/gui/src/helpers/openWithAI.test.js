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

import { afterEach, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./launchApp.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;

const { default: launch_app } = await import('./launchApp.js');
const { default: openWithAI } = await import('./openWithAI.js');

const fileRow = (attrs = {}) => {
    const row = document.createElement('div');
    const all = {
        'data-uid': 'uid-1',
        'data-path': '/user/Documents/notes.txt',
        'data-name': 'notes.txt',
        'data-shortcut_to': '',
        'data-shortcut_to_path': '',
        ...attrs,
    };
    for ( const [name, value] of Object.entries(all) ) row.setAttribute(name, value);
    return row;
};

afterEach(() => {
    vi.clearAllMocks();
});

it('launches the AI app with the file, as Open With does', () => {
    openWithAI(fileRow());

    expect(launch_app).toHaveBeenCalledWith({
        name: 'ai',
        file_path: '/user/Documents/notes.txt',
        file_uid: 'uid-1',
        window_title: 'notes.txt',
    });
});

it('opens a shortcut\'s target rather than the shortcut', () => {
    openWithAI(fileRow({
        'data-uid': 'shortcut-uid',
        'data-path': '/user/Desktop/notes.txt',
        'data-shortcut_to': 'target-uid',
        'data-shortcut_to_path': '/user/Documents/report.txt',
    }));

    expect(launch_app).toHaveBeenCalledWith(expect.objectContaining({
        file_path: '/user/Documents/report.txt',
        file_uid: 'target-uid',
        window_title: 'report.txt',
    }));
});
