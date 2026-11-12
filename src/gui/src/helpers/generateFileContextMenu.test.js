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

vi.mock('../UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIWindowItemProperties.js', () => ({ default: vi.fn() }));
vi.mock('./openItem.js', () => ({ default: vi.fn() }));
vi.mock('./openWithAI.js', () => ({ default: vi.fn() }));
vi.mock('./launchApp.js', () => ({ default: vi.fn() }));
vi.mock('./pathOwner.js', () => ({ is_owned_by_me: vi.fn(() => false) }));
vi.mock('./sharedAccess.js', () => ({
    can_rename: async () => false,
    can_restructure: async () => false,
    can_share: vi.fn(async () => false),
    invalidate_shared_roots: vi.fn(),
}));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
globalThis.def = globalThis.def ?? ((value) => value);
globalThis.use = globalThis.use ?? (() => class {});
window.feature_flags = {};
window.clipboard = [];
window.trash_path = '/me/Trash';
window.icons = {};

const { default: generate_file_context_menu } =
    await import('./generateFileContextMenu.js');
const { default: launch_app } = await import('./launchApp.js');
const { default: UIAlert } = await import('../UI/UIAlert.js');
const { can_share } = await import('./sharedAccess.js');
const { is_owned_by_me } = await import('./pathOwner.js');

const sharedRow = () => {
    const row = document.createElement('div');
    row.setAttribute('data-path', '/ann/uid-1/notes.txt');
    row.setAttribute('data-name', 'notes.txt');
    row.setAttribute('data-shared_with_me', '1');
    row.setAttribute('data-share_mode', 'read');
    return row;
};

const labels = async (fsentry) => {
    const items = await generate_file_context_menu({
        element: sharedRow(),
        fsentry: {
            name: 'notes.txt',
            path: '/ann/uid-1/notes.txt',
            ...fsentry,
        },
        associated_app_name: 'editor',
    });
    return items.filter((item) => item !== '-').map((item) => item.html);
};

it('offers Remove from Shared on a share made to the user', async () => {
    expect(await labels({})).toContain('share_remove_from_shared');
});

it('does not offer it on a share held through a team', async () => {
    const team = { uid: 'team-1', name: 'Acme', handle: null };
    expect(await labels({ holder_team: team })).not.toContain(
        'share_remove_from_shared',
    );
    expect(await labels({ holderTeam: team })).not.toContain(
        'share_remove_from_shared',
    );
});

describe('Share', () => {
    const shareItem = async (options) => {
        can_share.mockResolvedValueOnce(true);
        const items = await generate_file_context_menu({
            element: sharedRow(),
            fsentry: { name: 'notes.txt', path: '/ann/uid-1/notes.txt' },
            associated_app_name: 'editor',
            ...options,
        });
        return items.find((item) => item !== '-' && item.html === 'share_ellipsis');
    };

    it('hands the item to onShare', async () => {
        const onShare = vi.fn();
        await (await shareItem({ onShare })).onClick();
        expect(onShare).toHaveBeenCalledWith(expect.objectContaining({
            name: 'notes.txt',
            path: '/ann/uid-1/notes.txt',
        }));
    });

    it('is left out without onShare', async () => {
        expect(await shareItem({})).toBeUndefined();
    });
});

describe('Publish as Website', () => {
    const publishItem = async (options) => {
        is_owned_by_me.mockReturnValueOnce(true);
        can_share.mockResolvedValueOnce(true);
        const row = document.createElement('div');
        row.setAttribute('data-path', '/me/Site');
        row.setAttribute('data-name', 'Site');
        const items = await generate_file_context_menu({
            element: row,
            fsentry: { uid: 'dir-1', name: 'Site', path: '/me/Site', is_dir: true },
            associated_app_name: 'editor',
            ...options,
        });
        return items.find((item) => item !== '-' && item.html === 'publish_as_website');
    };

    it('hands the folder to onPublishWebsite', async () => {
        const onPublishWebsite = vi.fn();
        await (await publishItem({ onPublishWebsite })).onClick();
        expect(onPublishWebsite).toHaveBeenCalledWith({
            uid: 'dir-1',
            name: 'Site',
            path: '/me/Site',
        });
    });

    it('is left out without onPublishWebsite', async () => {
        expect(await publishItem({})).toBeUndefined();
    });
});

describe('Publish as Worker', () => {
    const publishItem = async (options) => {
        is_owned_by_me.mockReturnValueOnce(true);
        const row = document.createElement('div');
        row.setAttribute('data-path', '/me/worker.js');
        row.setAttribute('data-name', 'worker.js');
        const items = await generate_file_context_menu({
            element: row,
            fsentry: { uid: 'file-1', name: 'worker.js', path: '/me/worker.js' },
            associated_app_name: 'editor',
            ...options,
        });
        return items.find((item) => item !== '-' && item.html === 'publish_as_serverless_worker');
    };

    it('hands the file to onPublishWorker', async () => {
        const onPublishWorker = vi.fn();
        await (await publishItem({ onPublishWorker })).onClick();
        expect(onPublishWorker).toHaveBeenCalledWith({
            uid: 'file-1',
            name: 'worker.js',
            path: '/me/worker.js',
        });
    });

    it('is left out without onPublishWorker', async () => {
        expect(await publishItem({})).toBeUndefined();
    });
});

describe('Remove from Shared', () => {
    const remove = async (fsentry) => {
        const row = sharedRow();
        document.body.append(row);
        const onRemovedFromShared = vi.fn();
        window.user = { username: 'me' };
        globalThis.puter = { fs: { unshare: vi.fn(async () => ({ revoked: 1 })) } };
        const items = await generate_file_context_menu({
            element: row,
            fsentry: { name: 'notes.txt', path: '/ann/uid-1/notes.txt', ...fsentry },
            associated_app_name: 'editor',
            onRemovedFromShared,
        });
        await items.find((item) => item.html === 'share_remove_from_shared').onClick();
        expect(puter.fs.unshare).toHaveBeenCalledWith('/ann/uid-1/notes.txt', 'me');
        expect(onRemovedFromShared).toHaveBeenCalledTimes(1);
        return row;
    };

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('takes the row away once the user has left it', async () => {
        expect((await remove({})).isConnected).toBe(false);
    });

    it('keeps the row for the listing to update when a team still shares it', async () => {
        expect((await remove({ also_team_share: true })).isConnected).toBe(true);
    });
});

describe('Open With', () => {
    const editor = { name: 'editor', title: 'Editor', uuid: 'app-editor' };
    const viewer = { name: 'viewer', title: 'Viewer', uuid: 'app-viewer' };

    /** Clicks the Open With entry for the app at `index`. */
    const openWith = async (index, options = {}) => {
        const row = sharedRow();
        row.setAttribute('data-uid', 'file-1');
        const items = await generate_file_context_menu({
            element: row,
            fsentry: { name: 'notes.txt', path: '/ann/uid-1/notes.txt' },
            suggested_apps: [editor, viewer],
            ...options,
        });
        const submenu = items.find((item) => item.html === 'open_with').items;
        await submenu[index].onClick();
    };

    beforeEach(() => {
        window.user_preferences = {};
        window.mutate_user_preferences = vi.fn();
        vi.spyOn(window, 'open').mockImplementation(() => tab);
    });

    let tab;
    beforeEach(() => {
        tab = { close: vi.fn() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        launch_app.mockClear();
        UIAlert.mockReset();
    });

    it('opens the app in a new tab when asked to', async () => {
        await openWith(0, { openWithInNewTab: true });
        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(launch_app).toHaveBeenCalledWith(expect.objectContaining({
            name: 'editor',
            file_uid: 'file-1',
            newTab: tab,
        }));
    });

    it('opens the tab after the make-default prompt is answered', async () => {
        let openedBeforeAnswer = null;
        UIAlert.mockImplementation(async () => {
            openedBeforeAnswer = window.open.mock.calls.length > 0;
            return 'yes';
        });
        await openWith(1, { openWithInNewTab: true });
        expect(openedBeforeAnswer).toBe(false);
        expect(window.open).toHaveBeenCalledOnce();
        expect(window.mutate_user_preferences).toHaveBeenCalled();
        expect(launch_app).toHaveBeenCalledWith(expect.objectContaining({ name: 'viewer', newTab: tab }));
    });

    it('opens in-page when the popup blocker refuses the tab', async () => {
        window.open.mockReturnValue(null);
        await openWith(0, { openWithInNewTab: true });
        expect(launch_app.mock.calls[0][0]).not.toHaveProperty('newTab');
    });

    it('opens in-page on the desktop', async () => {
        await openWith(0);
        expect(window.open).not.toHaveBeenCalled();
        expect(launch_app.mock.calls[0][0]).not.toHaveProperty('newTab');
    });
});
