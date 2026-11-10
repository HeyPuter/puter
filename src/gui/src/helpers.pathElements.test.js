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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./UI/Auth/UIAuthLogin.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();

await import('./helpers.js');
const { default: apply_item_added_to_containers } = await import('./helpers/applyItemAddedToContainers.js');
const { default: UIItem } = await import('./UI/UIItem.js');
const { atPath, retargetNavHistory, retargetPaths, underPath } = await import('./helpers/pathElements.js');

// A plain name, then names holding characters a selector or HTML treats specially.
const NAMES = ['Reports 2024', 'R&D', "Dan's files", 'the "big" one', 'a<b>c', 'back\\slash'];

const el = (className, attrs) => jQuery('<div>').addClass(className).attr(attrs).appendTo(document.body);

beforeEach(() => {
    document.body.innerHTML = '';
    jQuery.fx.off = true;
    jQuery.fn.close = vi.fn();
    jQuery.fn.removeItems = vi.fn();
    window.icons = { 'folder.svg': 'folder.svg' };
    window.actions_history = [];
    window.user = { username: 'alice' };
    window.update_window_path = vi.fn();
    window.sort_items = vi.fn();
    window.update_explorer_footer_item_count = vi.fn();
    window.update_explorer_footer_selected_items_count = vi.fn();
    window.determine_website_url = () => '';
    UIItem.mockClear();
});

describe.each(NAMES)('a folder named %s', (name) => {
    const folderPath = `/alice/${name}`;

    it('keeps its open subfolders and their items on the new path when renamed', async () => {
        const $item = el('item', { 'data-uid': 'u1', 'data-path': folderPath, 'data-name': name });
        const $crumb = el('window-navbar-path-dirname', { 'data-path': folderPath });
        const $subWindow = el('window', { 'data-path': `${folderPath}/sub` });
        const $subItem = el('item', { 'data-uid': 'u2', 'data-path': `${folderPath}/sub/a.txt` });
        globalThis.puter = { fs: { rename: ({ success }) => success({ uid: 'u1', name: 'Plain', is_dir: true }) } };

        await new Promise(resolve => {
            window.rename_file({ uid: 'u1', name, path: folderPath, is_dir: true }, 'Plain', name, folderPath,
                $item[0], null, null, null, '', false, resolve);
        });

        expect($item.attr('data-path')).toBe('/alice/Plain');
        expect($crumb.attr('data-path')).toBe('/alice/Plain');
        expect($crumb.text()).toBe('Plain');
        expect($subWindow.attr('data-path')).toBe('/alice/Plain/sub');
        expect($subItem.attr('data-path')).toBe('/alice/Plain/sub/a.txt');
    });

    it('closes the windows of its subfolders when deleted', async () => {
        const $item = el('item', { 'data-uid': 'u1', 'data-path': folderPath });
        el('window', { 'data-path': `${folderPath}/sub` });
        el('window', { 'data-path': '/alice/Other/sub' });
        el('item', { 'data-uid': 'u3', 'data-shortcut_to_path': folderPath });
        globalThis.puter = { fs: { delete: vi.fn().mockResolvedValue() } };

        await window.delete_item($item[0]);

        const closed = jQuery.fn.close.mock.contexts.flatMap($set => $set.toArray().map(w => jQuery(w).attr('data-path')));
        expect(closed).toEqual([`${folderPath}/sub`]);
        expect(puter.fs.delete).toHaveBeenCalled();
        expect(jQuery('[data-uid="u3"]').attr('data-shortcut_to_path')).toBe('');
    });

    it('shows an item another tab added to it', async () => {
        const $container = el('item-container', { 'data-path': folderPath });

        await apply_item_added_to_containers({ uid: 'u9', dirpath: folderPath, path: `${folderPath}/new.txt`, name: 'new.txt', is_dir: true });

        expect(UIItem).toHaveBeenCalledTimes(1);
        expect(UIItem.mock.calls[0][0].appendTo.toArray()).toEqual([$container[0]]);
    });
});

describe('retargetPaths', () => {
    it('ignores the case of the renamed path itself, and leaves its siblings alone', () => {
        const $window = el('window', { 'data-path': '/alice/docs' });
        const $sibling = el('item', { 'data-path': '/alice/Docs 2/a.txt' });

        retargetPaths('/alice/Docs', '/alice/Papers', 'Papers');

        expect($window.attr('data-path')).toBe('/alice/Papers');
        expect($sibling.attr('data-path')).toBe('/alice/Docs 2/a.txt');
    });

    it('writes a new name holding a replacement pattern as it is', () => {
        const $item = el('item', { 'data-path': '/alice/Docs/a.txt' });

        retargetPaths('/alice/Docs', '/alice/$& and $1', '$& and $1');

        expect($item.attr('data-path')).toBe('/alice/$& and $1/a.txt');
    });

    it('changes nothing when the old path is unknown', () => {
        const $item = el('item', { 'data-path': '/alice/Docs/a.txt' });

        retargetPaths(undefined, '/alice/Papers', 'Papers');

        expect($item.attr('data-path')).toBe('/alice/Docs/a.txt');
    });
});

describe.each([undefined, null, ''])('a lookup for the path %s', (missing) => {
    it('matches nothing, including elements that have no path', () => {
        el('item', { 'data-path': '/alice/a.txt', 'data-shortcut_to_path': '' });
        el('window', { 'data-path': '' });
        el('window', { 'data-path': '/alice/Docs' });

        expect(atPath('.item', missing, 'data-shortcut_to_path')).toHaveLength(0);
        expect(atPath('.window', missing)).toHaveLength(0);
        expect(underPath('.window', missing)).toHaveLength(0);
    });
});

describe('retargetNavHistory', () => {
    it('rewrites entries at or inside the old path and leaves the rest', () => {
        window.window_nav_history = {
            1: ['/alice', '/alice/A', '/alice/A/sub', '/alice/AB', 'puter://shared'],
            2: ['/alice/Documents'],
        };

        retargetNavHistory('/alice/A', '/alice/B');

        expect(window.window_nav_history[1]).toEqual(['/alice', '/alice/B', '/alice/B/sub', '/alice/AB', 'puter://shared']);
        expect(window.window_nav_history[2]).toEqual(['/alice/Documents']);
    });

    it('is applied by retargetPaths', () => {
        window.window_nav_history = { 1: ['/alice/A/sub'] };

        retargetPaths('/alice/A', '/alice/B', 'B');

        expect(window.window_nav_history[1]).toEqual(['/alice/B/sub']);
    });
});
