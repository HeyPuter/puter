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

import { expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIWindowItemProperties.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIWindowPublishWorker.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIWindowShare.js', () => ({ default: vi.fn() }));
vi.mock('./publishAsWebsite.js', () => ({ default: vi.fn() }));
vi.mock('./ensureCanPublish.js', () => ({ default: vi.fn() }));
vi.mock('./openItem.js', () => ({ default: vi.fn() }));
vi.mock('./openWithAI.js', () => ({ default: vi.fn() }));
vi.mock('./launchApp.js', () => ({ default: vi.fn() }));
vi.mock('./pathOwner.js', () => ({ is_owned_by_me: () => false }));
vi.mock('./sharedAccess.js', () => ({
    can_rename: async () => false,
    can_restructure: async () => false,
    can_share: async () => false,
    invalidate_shared_roots: vi.fn(),
}));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.def = globalThis.def ?? ((value) => value);
globalThis.use = globalThis.use ?? (() => class {});
window.feature_flags = {};
window.clipboard = [];
window.trash_path = '/me/Trash';

const { default: generate_file_context_menu } =
    await import('./generateFileContextMenu.js');

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
