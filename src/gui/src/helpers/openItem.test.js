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

vi.mock('../UI/UIWindow.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIAlert.js', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('./launchApp.js', () => ({ default: vi.fn(async () => ({ launchResult: { launched: true } })) }));
vi.mock('./itemIcon.js', () => ({ default: vi.fn() }));
vi.mock('./defaultApp.js', () => ({ resolve_default_app: vi.fn(async () => null) }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.html_encode = value => jQuery('<div>').text(value).html();

const { default: launch_app } = await import('./launchApp.js');
const { default: UIAlert } = await import('../UI/UIAlert.js');
const { resolve_default_app } = await import('./defaultApp.js');
const { default: open_item } = await import('./openItem.js');

const row = ({ name = 'notes.txt', path = '/user/notes.txt', uid = 'file-1' } = {}) => {
    const el = document.createElement('div');
    for ( const [key, value] of Object.entries({
        'data-uid': uid,
        'data-path': path,
        'data-name': name,
        'data-is_dir': '0',
        'data-shortcut_to': '',
        'data-shortcut_to_path': '',
        'data-associated_app_name': '',
    }) ) {
        el.setAttribute(key, value);
    }
    document.body.appendChild(el);
    return el;
};

const newTab = () => ({ opener: window, location: { href: '' }, close: vi.fn() });

beforeEach(() => {
    window.trash_path = '/user/Trash';
    window.is_dashboard_mode = true;
    window.api_origin = 'https://api.puter.test';
    jQuery.ajax = vi.fn(async () => null);
    window.suggest_apps_for_fsentry = vi.fn(async () => []);
});

afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
});

describe('open_item with a new tab', () => {
    it("hands the tab to the file's default app", async () => {
        const app = { name: 'editor' };
        resolve_default_app.mockResolvedValueOnce(app);
        const tab = newTab();
        await open_item({ item: row(), newTab: tab });

        expect(launch_app).toHaveBeenCalledWith(expect.objectContaining({
            name: 'editor',
            file_uid: 'file-1',
            newTab: tab,
        }));
        expect(tab.close).not.toHaveBeenCalled();
    });

    it('closes the tab before offering a download when no app opens the file', async () => {
        const tab = newTab();
        let closedBeforeAlert = false;
        UIAlert.mockImplementation(async () => {
            closedBeforeAlert = tab.close.mock.calls.length === 1;
        });
        await open_item({ item: row({ name: 'data.bin', path: '/user/data.bin' }), newTab: tab });

        expect(launch_app).not.toHaveBeenCalled();
        expect(closedBeforeAlert).toBe(true);
        expect(tab.close).toHaveBeenCalledOnce();
    });

    it('closes the tab for a file in the trash', async () => {
        const tab = newTab();
        await open_item({ item: row({ path: '/user/Trash/notes.txt' }), newTab: tab });
        expect(tab.close).toHaveBeenCalledOnce();
        expect(launch_app).not.toHaveBeenCalled();
    });

    it('sends the tab to a web link, cut off from the dashboard', async () => {
        const tab = newTab();
        localStorage.setItem('weblink_link-1', 'https://example.com/page');
        await open_item({ item: row({ name: 'site.weblink', path: '/user/site.weblink', uid: 'link-1' }), newTab: tab });

        expect(tab.opener).toBeNull();
        expect(tab.location.href).toBe('https://example.com/page');
        expect(tab.close).not.toHaveBeenCalled();
    });
});

describe('open_item with no app for the file', () => {
    it('offers to download it', async () => {
        window.is_dashboard_mode = false;
        window.trigger_download = vi.fn();
        UIAlert.mockResolvedValueOnce('download_file');

        await open_item({ item: row({ name: 'data.bin', path: '/user/data.bin' }) });

        expect(UIAlert).toHaveBeenCalledTimes(1);
        expect(UIAlert.mock.calls[0][1].map(button => button.value ?? button.label)).toEqual(['download_file', 'Cancel']);
        expect(window.trigger_download).toHaveBeenCalledWith(['/user/data.bin']);
    });
});

