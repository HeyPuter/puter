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

vi.mock('../UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./itemIcon.js', () => ({
    default: vi.fn(async () => ({ image: '', type: 'icon' })),
}));
vi.mock('./listAllShared.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) =>
    jQuery('<div>')
        .text(value ?? '')
        .html();
globalThis.puter = { fs: { stat: vi.fn(), readdir: vi.fn() } };
jQuery.fn.removeItems = function () {
    return this.remove();
};
window.icons = {};
Object.assign(window, {
    Transaction: class {
        start() {}
        end() {}
    },
    shared_path: '/alice/Shared',
    trash_path: '/alice/Trash',
    user_preferences: {},
    desktop_item_positions: {},
    check_fsentry_against_allowed_file_types_string: () => true,
    sort_items: () => {},
    update_explorer_footer_item_count: () => {},
    update_window_layout: () => {},
    update_details_layout_sort_visuals: () => {},
});

const { default: refresh_item_container } =
    await import('./refreshItemContainer.js');
const { default: UIItem } = await import('../UI/UIItem.js');
const { default: list_all_shared } = await import('./listAllShared.js');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('refresh_item_container in the Shared view', () => {
    it('flags rows shared through a team, and only those', async () => {
        list_all_shared.mockResolvedValue([
            {
                entryUid: 'u-1',
                name: 'a.txt',
                path: '/bob/u-1/a.txt',
                isDir: false,
                mode: 'read',
                issuer: 'bob',
                owner: 'bob',
            },
            {
                entryUid: 'u-2',
                name: 'b.txt',
                path: '/bob/u-2/b.txt',
                isDir: false,
                mode: 'read',
                issuer: 'bob',
                owner: 'bob',
                holderTeam: { uid: 't-1', name: 'Acme' },
            },
        ]);
        document.body.innerHTML =
            '<div class="window"><div class="item-container" data-path="/alice/Shared"></div></div>';

        refresh_item_container($('.item-container'));

        await vi.waitFor(() => expect(UIItem).toHaveBeenCalledTimes(2));
        const [direct, team] = UIItem.mock.calls.map(([options]) => options);
        expect(direct).toMatchObject({
            uid: 'u-1',
            shared_with_me: true,
            share_mode: 'read',
            shared_by: 'bob',
            is_team_share: false,
        });
        expect(team).toMatchObject({
            uid: 'u-2',
            shared_with_me: true,
            is_team_share: true,
        });
    });

    it('flags a direct share the team holds too', async () => {
        list_all_shared.mockResolvedValue([
            {
                entryUid: 'u-1',
                name: 'a.txt',
                path: '/bob/u-1/a.txt',
                isDir: false,
                mode: 'read',
                issuer: 'bob',
                owner: 'bob',
                alsoHeldByTeam: true,
            },
        ]);
        document.body.innerHTML =
            '<div class="window"><div class="item-container" data-path="/alice/Shared"></div></div>';

        refresh_item_container($('.item-container'));

        await vi.waitFor(() => expect(UIItem).toHaveBeenCalledTimes(1));
        expect(UIItem.mock.calls[0][0]).toMatchObject({
            is_team_share: false,
            is_also_team_share: true,
        });
    });
});

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

const fileEntry = (dir, name) => ({
    uid: `${dir}/${name}`,
    name,
    path: `${dir}/${name}`,
    is_dir: false,
});

// Points the window at a new folder the way update_window_path does, then refreshes it.
const navigate = (path) => {
    $('.window').attr('data-path', path);
    $('.item-container').attr('data-path', path);
    refresh_item_container($('.item-container'));
};

const renderedPaths = () => UIItem.mock.calls.map(([options]) => options.path);

describe('refresh_item_container after the window moves to another folder', () => {
    let pending;

    beforeEach(() => {
        pending = { stat: {}, readdir: {} };
        puter.fs.stat.mockImplementation(({ path }) => {
            pending.stat[path] = deferred();
            return pending.stat[path].promise;
        });
        puter.fs.readdir.mockImplementation(({ path }) => {
            pending.readdir[path] ??= deferred();
            return pending.readdir[path].promise;
        });
        document.body.innerHTML =
            '<div class="window"><div class="item-container"></div></div>';
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('ignores a stat for the folder it left', async () => {
        navigate('/alice');
        navigate('/alice/Pictures');

        pending.stat['/alice/Pictures'].resolve({ id: 'pictures', name: 'Pictures' });
        pending.stat['/alice'].resolve({ id: 'home', name: 'alice' });
        await vi.waitFor(() => expect($('.window').attr('data-uid')).toBe('pictures'));
        await new Promise((r) => setTimeout(r, 0));

        expect($('.window').attr('data-path')).toBe('/alice/Pictures');
        expect($('.window').attr('data-uid')).toBe('pictures');
    });

    it('stores a folder name holding HTML characters on the window as it is', async () => {
        navigate('/alice/R&D');

        pending.stat['/alice/R&D'].resolve({ id: 'rd', name: 'R&D' });
        await vi.waitFor(() => expect($('.window').attr('data-uid')).toBe('rd'));

        expect($('.window').attr('data-name')).toBe('R&D');
    });

    it('drops a listing that arrives just before the window moves on', async () => {
        vi.useFakeTimers();
        navigate('/alice/Documents');

        // A listing slower than 1s waits another second before rendering.
        await vi.advanceTimersByTimeAsync(1100);
        pending.readdir['/alice/Documents'].resolve([fileEntry('/alice/Documents', 'a.txt')]);
        await vi.advanceTimersByTimeAsync(0);

        navigate('/alice/Pictures');
        pending.readdir['/alice/Pictures'].resolve([fileEntry('/alice/Pictures', 'b.png')]);
        await vi.advanceTimersByTimeAsync(1000);

        expect(renderedPaths()).toEqual(['/alice/Pictures/b.png']);
    });

    it('renders a folder once when it is refreshed again before the first listing arrives', async () => {
        navigate('/alice/Documents');
        navigate('/alice/Pictures');
        navigate('/alice/Documents');

        pending.readdir['/alice/Documents'].resolve([fileEntry('/alice/Documents', 'a.txt')]);
        pending.readdir['/alice/Pictures'].resolve([fileEntry('/alice/Pictures', 'b.png')]);
        await vi.waitFor(() => expect(UIItem).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 10));

        expect(renderedPaths()).toEqual(['/alice/Documents/a.txt']);
    });
});
