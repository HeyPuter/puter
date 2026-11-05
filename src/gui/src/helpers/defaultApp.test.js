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
import { is_default_app, resolve_default_app } from './defaultApp.js';

const EDITOR = { uuid: 'app-11111111-1111-4111-8111-111111111111', name: 'editor', title: 'Editor' };
const MARKDOWN = { uuid: 'app-22222222-2222-4222-8222-222222222222', name: 'markdown-pro', title: 'Markdown Pro' };
const FILE = { uid: 'f0a1b2c3-d4e5-4f60-8172-839405162738', path: '/alice/Documents/notes.md' };

let suggested;
// What `puter-apps` read returns, by uid.
let apps;

/** The uid each `puter-apps` read asked for, with its params. */
const reads = () => globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).args);

beforeEach(() => {
    suggested = [EDITOR, MARKDOWN];
    apps = {
        [EDITOR.uuid]: { uid: EDITOR.uuid, name: 'editor', title: 'Editor', index_url: 'https://editor.test/' },
        [MARKDOWN.uuid]: { uid: MARKDOWN.uuid, name: 'markdown-pro', title: 'Markdown Pro', index_url: 'https://md.test/' },
    };
    globalThis.window = {
        api_origin: 'https://api.test',
        auth_token: 'tok',
        user_preferences: {},
        suggest_apps_for_fsentry: vi.fn(async () => suggested),
    };
    globalThis.fetch = vi.fn(async (_url, init) => {
        const app = apps[JSON.parse(init.body).args.uid] ?? null;
        return { ok: app !== null, json: async () => ({ success: true, result: app }) };
    });
});

describe('is_default_app', () => {
    it('matches a stored uid or a stored name', () => {
        expect(is_default_app(MARKDOWN.uuid, MARKDOWN)).toBe(true);
        expect(is_default_app('markdown-pro', MARKDOWN)).toBe(true);
        expect(is_default_app(EDITOR.uuid, MARKDOWN)).toBe(false);
    });

    it('never matches an unset preference', () => {
        expect(is_default_app(undefined, MARKDOWN)).toBe(false);
        expect(is_default_app('', { uuid: '', name: '' })).toBe(false);
    });
});

describe('resolve_default_app', () => {
    it('returns null without asking the server when no app is set for the extension', async () => {
        window.user_preferences['default_apps.txt'] = EDITOR.uuid;

        expect(await resolve_default_app(FILE)).toBeNull();
        expect(window.suggest_apps_for_fsentry).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('resolves a stored uid to that suggested app, read by uid', async () => {
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;

        expect(await resolve_default_app(FILE)).toBe(apps[MARKDOWN.uuid]);
        expect(window.suggest_apps_for_fsentry).toHaveBeenCalledWith(FILE);
        expect(reads()).toEqual([{ uid: MARKDOWN.uuid, params: { icon_size: 64 } }]);
    });

    it('reads the preference for the lowercased extension', async () => {
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;

        expect(await resolve_default_app({ ...FILE, path: '/alice/NOTES.MD' })).toBe(apps[MARKDOWN.uuid]);
    });

    it('resolves a stored name while that app is still suggested for the file', async () => {
        window.user_preferences['default_apps.md'] = 'markdown-pro';

        expect(await resolve_default_app(FILE)).toBe(apps[MARKDOWN.uuid]);
        expect(reads()).toEqual([{ uid: MARKDOWN.uuid, params: { icon_size: 64 } }]);
    });

    it('returns the app the uid names now, not a stale suggested name', async () => {
        // Cached suggestions still carry the old name, which another app has
        // since claimed. Launching by that name would open the other app.
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;
        apps[MARKDOWN.uuid] = { ...apps[MARKDOWN.uuid], name: 'markdown-pro-2' };

        const app = await resolve_default_app(FILE);
        expect(app.uid).toBe(MARKDOWN.uuid);
        expect(app.name).toBe('markdown-pro-2');
    });

    it('keeps the launch gates from the read', async () => {
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;
        const denied = { hasAccess: false, fallbackAppName: 'app-center' };
        apps[MARKDOWN.uuid] = { uid: MARKDOWN.uuid, name: 'markdown-pro', privateAccess: denied };

        expect((await resolve_default_app(FILE)).privateAccess).toBe(denied);
    });

    it('returns null when the suggested app can no longer be read', async () => {
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;
        delete apps[MARKDOWN.uuid];

        expect(await resolve_default_app(FILE)).toBeNull();
    });

    it('ignores a stored name once no suggested app carries it', async () => {
        // The app was renamed or deleted, and whoever holds the name now is
        // not an app suggested for this file.
        window.user_preferences['default_apps.md'] = 'markdown-pro';
        suggested = [EDITOR, { ...MARKDOWN, name: 'markdown-pro-2' }];

        expect(await resolve_default_app(FILE)).toBeNull();
    });

    it('ignores a stored uid whose app is no longer suggested', async () => {
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;
        suggested = [EDITOR];

        expect(await resolve_default_app(FILE)).toBeNull();
    });

    it('returns null when suggestions cannot be loaded', async () => {
        window.user_preferences['default_apps.md'] = MARKDOWN.uuid;
        window.suggest_apps_for_fsentry = vi.fn(async () => {
            throw new Error('network');
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await resolve_default_app(FILE)).toBeNull();
    });
});
