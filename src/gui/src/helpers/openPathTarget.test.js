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

const launch_app = vi.fn();
const resolve_default_app = vi.fn();
const UIAlert = vi.fn();
vi.mock('./launchApp.js', () => ({ default: (...args) => launch_app(...args) }));
vi.mock('./defaultApp.js', () => ({ resolve_default_app: (...args) => resolve_default_app(...args) }));
vi.mock('../UI/UIAlert.js', () => ({ default: (...args) => UIAlert(...args) }));

const { files_route_hash, open_path_target } = await import('./openPathTarget.js');

// The hash the dashboard's route parser reads back into a Files path.
const parsed_path = (hash) => `/${decodeURIComponent(hash.slice(1)).split('/').filter(Boolean).slice(1).join('/')}`;

describe('files_route_hash', () => {
    it('round-trips a folder through the dashboard route parser', () => {
        for ( const dir of ['/alice/Public', '/alice/My Site', '/alice/50% off', '/alice/a#b'] ) {
            const hash = files_route_hash(dir);
            expect(hash.startsWith('#files/')).toBe(true);
            expect(parsed_path(hash)).toBe(dir);
        }
    });
});

describe('open_path_target', () => {
    let ajax;

    beforeEach(() => {
        launch_app.mockReset();
        resolve_default_app.mockReset();
        UIAlert.mockReset();
        ajax = vi.fn();
        globalThis.$ = { ajax };
        globalThis.window = { location: { hash: '', pathname: '/' }, api_origin: 'https://api.test' };
    });

    afterEach(() => {
        delete globalThis.$;
        delete globalThis.window;
    });

    it('opens a folder in the Files tab', async () => {
        await open_path_target('/alice/Public', { is_dir: true });
        expect(window.location.hash).toBe('#files/alice/Public');
        expect(launch_app).not.toHaveBeenCalled();
    });

    it('opens a file in the app it is associated with', async () => {
        await open_path_target('/alice/Public/site.html', {
            is_dir: false,
            associated_app: { name: 'viewer' },
        });
        expect(launch_app).toHaveBeenCalledWith({ name: 'viewer' });
    });

    it('opens a file with the user\'s default app for it', async () => {
        const app = { name: 'editor' };
        resolve_default_app.mockResolvedValue(app);
        await open_path_target('/alice/notes.txt', { is_dir: false, uid: 'u1' });
        expect(launch_app).toHaveBeenCalledWith({
            name: 'editor',
            app_obj: app,
            file_path: '/alice/notes.txt',
        });
    });

    it('falls back to the folder when no app can open the file', async () => {
        resolve_default_app.mockResolvedValue(null);
        ajax.mockResolvedValue({ suggested_apps: [] });
        await open_path_target('/alice/Public/blob.bin', { is_dir: false, uid: 'u1' });
        expect(UIAlert).toHaveBeenCalled();
        expect(launch_app).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('#files/alice/Public');
    });
});
