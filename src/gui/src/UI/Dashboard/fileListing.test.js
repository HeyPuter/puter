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

import { beforeEach, describe, expect, it } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = globalThis.i18n ?? (key => key);
window.html_encode = value => jQuery('<div>').text(value).html();
window.icons = new Proxy({}, { get: (_, name) => `/icons/${String(name)}` });

const {
    breadcrumbsHtml,
    createFileRow,
    directoriesHtml,
    folderAcceptsNewItems,
    formatFileSize,
    nextRowIndex,
    sharedListingEntry,
    sortFileEntries,
} = await import('./fileListing.js');

beforeEach(() => {
    window.user = { username: 'alice' };
    window.home_path = '/alice';
    window.desktop_path = '/alice/Desktop';
    window.docs_path = '/alice/Documents';
    window.pictures_path = '/alice/Pictures';
    window.public_path = '/alice/Public';
    window.videos_path = '/alice/Videos';
    window.trash_path = '/alice/Trash';
    window.shared_path = 'puter://shared';
    window.root_dirname = 'Puter';
    window.global_element_id = 1;
    window.locale = 'en';
    window.determine_website_url = () => null;
});

const crumbs = (html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return [...el.querySelectorAll('.dirname')].map(c => [c.getAttribute('data-path'), c.textContent]);
};

describe('formatFileSize', () => {
    it('reads sizes as the listing shows them', () => {
        expect(formatFileSize(0)).toBe('0 B');
        expect(formatFileSize(undefined)).toBe('0 B');
        expect(formatFileSize(1536)).toBe('1.5 KB');
        expect(formatFileSize(1024 ** 6 * 3)).toBe('3072 PB');
    });
});

describe('breadcrumbsHtml', () => {
    it('gives a crumb per folder below the root, without a root crumb', () => {
        expect(crumbs(breadcrumbsHtml('/alice/Desktop/'))).toEqual([['/alice', 'alice'], ['/alice/Desktop', 'Desktop']]);
    });

    it('shows the root as its own crumb only at the root', () => {
        expect(crumbs(breadcrumbsHtml('/'))).toEqual([['/', 'Puter']]);
    });

    it('shows the Shared view as one crumb', () => {
        expect(crumbs(breadcrumbsHtml('puter://shared'))).toEqual([['puter://shared', 'shared']]);
    });

    it('names a crumb as nameFor says, such as a trashed folder', () => {
        const html = breadcrumbsHtml('/alice/Trash/uid-1', { nameFor: p => (p === '/alice/Trash/uid-1' ? 'Old <b>' : undefined) });
        expect(crumbs(html)).toEqual([['/alice', 'alice'], ['/alice/Trash', 'trash'], ['/alice/Trash/uid-1', 'Old <b>']]);
    });
});

describe('directoriesHtml', () => {
    it('lists the standard folders, Shared and Trash, or leaves Trash out', () => {
        const folders = (html) => [...jQuery(html).find('li')].map(li => li.getAttribute('data-folder'));
        expect(folders(directoriesHtml())).toEqual(['Home', 'Desktop', 'Documents', 'Pictures', 'Public', 'Videos', 'Shared', 'Trash']);
        expect(folders(directoriesHtml({ trash: false }))).not.toContain('Trash');
    });
});

describe('createFileRow', () => {
    it('keeps names and paths raw in its attributes and encoded in its cells', () => {
        const row = createFileRow({ uid: 'u1', name: 'a&b <c>.txt', path: '/alice/a&b <c>.txt', size: 2048, modified: 1 }, { image: 'i.svg', type: 'icon' });
        expect(row.getAttribute('data-name')).toBe('a&b <c>.txt');
        expect(row.getAttribute('data-path')).toBe('/alice/a&b <c>.txt');
        expect(row.querySelector('.item-name').textContent).toBe('a&b <c>.txt');
        expect(row.querySelector('.item-size').textContent).toBe('2 KB');
        expect(row.classList.contains('file')).toBe(true);
    });

    it('shows a trashed item under the name it had, and dims a dot-file', () => {
        const row = createFileRow({ uid: 'u2', name: '.uid', path: '/alice/Trash/.uid', is_dir: true, modified: 1, metadata: JSON.stringify({ original_name: 'Old' }) }, { image: 'i.svg', type: 'icon' });
        expect(row.getAttribute('data-name')).toBe('Old');
        expect(row.classList.contains('item-revealed')).toBe(true);
        expect(row.querySelector('.item-size').textContent).toBe('');
    });
});

describe('sortFileEntries', () => {
    const entries = [
        { name: 'b.txt', size: 1, modified: 3 },
        { name: 'Folder', is_dir: true, size: 0, modified: 1 },
        { name: 'a10.txt', size: 5, modified: 2 },
        { name: 'a2.txt', size: 5, modified: 4 },
    ];

    it('puts folders first and orders names as a file manager does', () => {
        expect(sortFileEntries(entries, 'name', 'asc').map(e => e.name)).toEqual(['Folder', 'a2.txt', 'a10.txt', 'b.txt']);
    });

    it('flips the order within each group when descending', () => {
        expect(sortFileEntries(entries, 'name', 'desc').map(e => e.name)).toEqual(['Folder', 'b.txt', 'a10.txt', 'a2.txt']);
    });

    it('breaks ties on size by name', () => {
        expect(sortFileEntries(entries, 'size', 'asc').map(e => e.name)).toEqual(['Folder', 'b.txt', 'a2.txt', 'a10.txt']);
    });
});

describe('nextRowIndex', () => {
    const layout = { current: 4, count: 10, cols: 3, pageRows: 2 };

    it('moves by one, by a line, to the ends, and by a screen', () => {
        expect(nextRowIndex(37, layout)).toBe(3);
        expect(nextRowIndex(39, layout)).toBe(5);
        expect(nextRowIndex(38, layout)).toBe(1);
        expect(nextRowIndex(40, layout)).toBe(7);
        expect(nextRowIndex(36, layout)).toBe(0);
        expect(nextRowIndex(35, layout)).toBe(9);
        expect(nextRowIndex(33, layout)).toBe(0);
        expect(nextRowIndex(34, layout)).toBe(9);
    });

    it('stays inside the listing and ignores other keys', () => {
        expect(nextRowIndex(38, { ...layout, current: 1 })).toBe(0);
        expect(nextRowIndex(40, { ...layout, current: 8 })).toBe(9);
        expect(nextRowIndex(13, layout)).toBe(4);
    });
});

describe('folderAcceptsNewItems', () => {
    it('refuses the root, the Trash and what is in it, and the Shared view', () => {
        expect(folderAcceptsNewItems('/alice/Desktop')).toBe(true);
        expect(folderAcceptsNewItems('/')).toBe(false);
        expect(folderAcceptsNewItems('/alice/Trash')).toBe(false);
        expect(folderAcceptsNewItems('/alice/Trash/x')).toBe(false);
        expect(folderAcceptsNewItems('puter://shared')).toBe(false);
        expect(folderAcceptsNewItems(null)).toBe(false);
    });
});

describe('sharedListingEntry', () => {
    it('turns a share into a listing entry', () => {
        expect(sharedListingEntry({ entryUid: 'u', path: '/bob/x/notes.txt', isDir: false, mode: 'read', issuer: 'bob', owner: 'bob' }))
            .toMatchObject({ uid: 'u', name: 'notes.txt', is_dir: false, shared_with_me: true, share_mode: 'read', shared_by: 'bob' });
    });
});
