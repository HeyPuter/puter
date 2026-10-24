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
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

// The tab's window and dialog plumbing isn't what these tests exercise.
vi.mock('../UIWindow.js', () => ({ default: vi.fn() }));
vi.mock('../UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('../UIContextMenu.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = globalThis.i18n ?? (key => key);
window.icons = {};

const { default: TabFiles, failedUploadsMessage, rebasePath, typeSelectTarget } = await import('./TabFiles.js');

const TRASH = '/alice/Trash';

/** A Files tab listing `rows` in `currentPath`, with its footer. */
const mountListing = (rows, currentPath = TRASH) => {
    document.body.innerHTML = `
        <div class="window">
            <div class="files-tab">
                <div class="files">${rows.map(name => `<div class="row item" data-path="${currentPath}/${name}" data-size="10"></div>`).join('')}</div>
                <div class="files-footer">
                    <span class="files-footer-item-count"></span>
                    <span class="files-footer-separator"></span>
                    <span class="files-footer-selected-items"></span>
                </div>
                <div class="files-selection-actions"></div>
            </div>
        </div>`;
    TabFiles.$el_window = $('.window');
    TabFiles.currentPath = currentPath;
    TabFiles.updateFooterStats();
};

const footer = () => $('.files-footer-item-count').text();

describe('TabFiles emptying the Trash', () => {
    beforeEach(() => {
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
    });

    it('shows the empty notice and a zero count once the Trash is emptied here', async () => {
        mountListing(['a.txt', 'b.txt']);
        expect(footer()).toContain('2 items');
        // What a confirmed empty_trash does to the listing.
        window.empty_trash = vi.fn(async () => {
            $('.item').remove();
        });

        await TabFiles.emptyTrash();

        expect(window.empty_trash).toHaveBeenCalledTimes(1);
        expect($('.files-empty-notice').length).toBe(1);
        expect(footer()).toContain('0 items');
    });

    it('leaves a Trash the user chose not to empty as it was', async () => {
        mountListing(['a.txt']);
        window.empty_trash = vi.fn(async () => {});

        await TabFiles.emptyTrash();

        expect($('.item').length).toBe(1);
        expect($('.files-empty-notice').length).toBe(0);
        expect(footer()).toContain('1 item');
    });

    it('touches nothing when the listing is not the Trash', () => {
        mountListing([], '/alice/Documents');
        $('.files-footer-item-count').text('stale');

        TabFiles.syncEmptiedTrash();

        expect($('.files-empty-notice').length).toBe(0);
        expect(footer()).toBe('stale');
    });
});

describe('failedUploadsMessage', () => {
    it('puts each failed item on its own line', () => {
        const message = failedUploadsMessage({ failedItems: [
            { path: '/alice/a.txt', message: 'Too large' },
            { name: 'b.txt' },
            { requestIndex: 3 },
        ] });
        // UIAlert keeps <br> and encodes the rest; a "\n" would collapse into a space.
        expect(message.split('<br>').slice(1)).toEqual([
            '- /alice/a.txt (Too large)',
            '- b.txt',
            '- item 3',
        ]);
        expect(message).not.toContain('\n');
    });

    it('has nothing to say when no item is named', () => {
        expect(failedUploadsMessage({ message: 'offline' })).toBeNull();
        expect(failedUploadsMessage(undefined)).toBeNull();
    });
});

describe('TabFiles.moveDraggedRows', () => {
    const rowAt = (rowPath) => $(`<div class="row item" data-path="${rowPath}"></div>`)[0];

    beforeEach(() => {
        window.user = { username: 'alice' };
        window.move_items = vi.fn(async () => {});
    });

    it('leaves out rows dropped back into the folder they are in', async () => {
        const stays = rowAt('/alice/Documents/a.txt');
        const moves = rowAt('/alice/Pictures/b.png');

        await TabFiles.moveDraggedRows([stays, moves], '/alice/Documents');

        expect(window.move_items).toHaveBeenCalledWith([moves], '/alice/Documents');
    });

    it('leaves out the target folder and any folder holding it', async () => {
        const target = rowAt('/alice/Documents/Work');
        const ancestor = rowAt('/alice/Documents');
        const moves = rowAt('/alice/Pictures/b.png');

        await TabFiles.moveDraggedRows([target, ancestor, moves], '/alice/Documents/Work');

        expect(window.move_items).toHaveBeenCalledWith([moves], '/alice/Documents/Work');
    });

    it('moves nothing when every row is already there', async () => {
        await TabFiles.moveDraggedRows([rowAt('/alice/Documents/a.txt'), rowAt('/alice/Documents/b.txt')], '/alice/Documents');

        expect(window.move_items).not.toHaveBeenCalled();
    });
});

describe('TabFiles.dropRowsInto', () => {
    const rowAt = (rowPath) => $(`<div class="row item" data-path="${rowPath}" data-uid="u-${rowPath}"></div>`)[0];

    beforeEach(() => {
        window.user = { username: 'alice' };
        window.trash_path = TRASH;
        window.feature_flags = { create_shortcut: true };
        window.move_items = vi.fn(async () => {});
        window.copy_items = vi.fn(async () => {});
        window.create_shortcut = vi.fn(async () => {});
    });

    it('copies on Ctrl, makes shortcuts on Alt, moves otherwise', async () => {
        const row = rowAt('/alice/Documents/a.txt');

        await TabFiles.dropRowsInto([row], '/alice/Pictures', { ctrlKey: true });
        expect(window.copy_items).toHaveBeenCalledWith([row], '/alice/Pictures');

        await TabFiles.dropRowsInto([row], '/alice/Pictures', { altKey: true });
        expect(window.create_shortcut).toHaveBeenCalledWith('a.txt', false, '/alice/Pictures', null, 'u-/alice/Documents/a.txt', '/alice/Documents/a.txt');

        await TabFiles.dropRowsInto([row], '/alice/Pictures', {});
        expect(window.move_items).toHaveBeenCalledWith([row], '/alice/Pictures');
    });

    it('trashes what is dropped on the Trash whatever the modifier', async () => {
        const row = rowAt('/alice/Documents/a.txt');

        await TabFiles.dropRowsInto([row], TRASH, { ctrlKey: true });
        await TabFiles.dropRowsInto([row], TRASH, { altKey: true });

        expect(window.copy_items).not.toHaveBeenCalled();
        expect(window.create_shortcut).not.toHaveBeenCalled();
        expect(window.move_items).toHaveBeenCalledTimes(2);
        expect(window.move_items).toHaveBeenCalledWith([row], TRASH);
    });
});

describe('rebasePath', () => {
    it('moves the folder itself and anything under it', () => {
        expect(rebasePath('/alice/Proj', '/alice/Proj', '/alice/Proj2')).toBe('/alice/Proj2');
        expect(rebasePath('/alice/Proj/src/a', '/alice/Proj', '/alice/Proj2')).toBe('/alice/Proj2/src/a');
    });

    it('leaves siblings that only share a prefix, and non-strings, alone', () => {
        expect(rebasePath('/alice/Projects', '/alice/Proj', '/alice/Proj2')).toBe('/alice/Projects');
        expect(rebasePath(null, '/alice/Proj', '/alice/Proj2')).toBe(null);
    });
});

describe('TabFiles.rebaseNavHistory', () => {
    it('points Back/Forward entries at a renamed folder', () => {
        window.dashboard_nav_history = ['/alice', '/alice/Proj', '/alice/Proj/src', '/alice/Projects'];

        TabFiles.rebaseNavHistory('/alice/Proj', '/alice/Proj2');

        expect(window.dashboard_nav_history).toEqual(['/alice', '/alice/Proj2', '/alice/Proj2/src', '/alice/Projects']);
    });
});

describe('TabFiles opening a folder that fails to list', () => {
    beforeEach(() => {
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
        window.puter = { fs: { readdir: vi.fn(async () => {
            throw new Error('not found');
        }) } };
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('moves to that folder and creates nothing in it', async () => {
        mountListing([], '/alice/Documents');
        TabFiles.renderingDirectory = false;
        TabFiles.trashedNames ??= new Map();

        await TabFiles.renderDirectory('/alice/Gone');

        expect(TabFiles.currentPath).toBe('/alice/Gone');
        expect($('.files').text()).toContain("couldn't be opened");
        expect(TabFiles.acceptsNewItems('/alice/Gone')).toBe(false);
        expect(TabFiles.acceptsNewItems('/alice/Documents')).toBe(true);
        expect(TabFiles.renderingDirectory).toBe(false);
    });
});

describe('TabFiles opening a folder during a refresh', () => {
    beforeEach(() => {
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
    });

    it('opens it, and the refresh gives way', async () => {
        mountListing([], '/alice/Documents');
        TabFiles.renderingDirectory = false;
        TabFiles.trashedNames ??= new Map();
        let finishRefresh;
        window.puter = { fs: { readdir: vi.fn(({ path }) => (path === '/alice/Documents'
            ? new Promise(resolve => {
                finishRefresh = resolve;
            })
            : Promise.resolve([]))) } };

        const refresh = TabFiles.renderDirectory('/alice/Documents');
        await TabFiles.renderDirectory('/alice/Pictures');
        expect(TabFiles.currentPath).toBe('/alice/Pictures');

        finishRefresh([]);
        await refresh;
        expect(TabFiles.currentPath).toBe('/alice/Pictures');
        expect(TabFiles.renderingDirectory).toBe(false);
    });
});

describe('TabFiles New Folder', () => {
    beforeEach(() => {
        window.user = { username: 'alice', directories: {} };
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
        window.global_element_id = 1;
        window.activate_item_name_editor = vi.fn();
        window.actions_history = [{ operation: 'upload', data: ['/alice/Documents/notes.txt'] }];
        window.puter = { fs: { mkdir: vi.fn(async () => ({
            uid: 'f1', name: 'New Folder', path: '/alice/Documents/New Folder', is_dir: true,
        })) } };
        vi.spyOn(TabFiles, 'renderItem').mockImplementation(async (file) => {
            $('.files').append(`<div class="row item" data-uid="${file.uid}" data-path="${file.path}"></div>`);
        });
        vi.spyOn(TabFiles, 'insertAtSortedPosition').mockImplementation(() => {});
        vi.spyOn(TabFiles, 'applyColumnWidths').mockImplementation(() => {});
    });

    it('is what Undo takes back, not the upload before it', async () => {
        mountListing([], '/alice/Documents');
        TabFiles.renderingDirectory = false;
        TabFiles._creatingItem = 0;

        await TabFiles.createFolderInstant('/alice/Documents');

        const last = window.actions_history.at(-1);
        expect(last.operation).toBe('create_folder');
        expect($(last.data).attr('data-path')).toBe('/alice/Documents/New Folder');
    });

    it('is made, not dropped, while the folder is refreshing', async () => {
        mountListing([], '/alice/Documents');
        TabFiles.trashedNames ??= new Map();
        TabFiles._creatingItem = 0;
        window.home_path = '/alice';
        window.puter.fs.readdir = vi.fn(async () => []);
        TabFiles.renderingDirectory = true;
        TabFiles.refreshInFlight = true;

        await TabFiles.createFolderInstant('/alice/Documents');

        expect(window.puter.fs.mkdir).toHaveBeenCalled();
        expect(TabFiles.renderingDirectory).toBe(false);
    });
});

describe('TabFiles.moveClipboardItems', () => {
    beforeEach(() => {
        window.user = { username: 'alice' };
        window.actions_history = [{ operation: 'upload', data: ['/alice/Documents/notes.txt'] }];
        window.clipboard = [{ path: '/alice/Documents/a.txt', uid: 'a1' }];
        window.puter = { fs: { move: vi.fn(async () => ({
            moved: { uid: 'a1', name: 'a.txt', path: '/alice/Pictures/a.txt', is_dir: false },
        })) } };
    });

    it('is what Undo takes back, not the upload before it', async () => {
        await TabFiles.moveClipboardItems('/alice/Pictures');

        const last = window.actions_history.at(-1);
        expect(last.operation).toBe('move');
        expect(last.data).toEqual([expect.objectContaining({
            original_path: '/alice/Documents/a.txt',
            options: expect.objectContaining({ uid: 'a1', path: '/alice/Pictures/a.txt' }),
        })]);
    });
});

describe('TabFiles refreshing a folder during a refresh of it', () => {
    beforeEach(() => {
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
        vi.spyOn(TabFiles, 'renderItem').mockImplementation(async (file) => {
            $('.files').append(`<div class="row item" data-uid="${file.uid}" data-path="${file.path}" data-name="${file.name}"></div>`);
        });
    });

    it("shows the later listing, not the earlier one's", async () => {
        mountListing([], '/alice/Documents');
        TabFiles.renderingDirectory = false;
        TabFiles.trashedNames ??= new Map();
        const entry = name => ({ uid: name, name, path: `/alice/Documents/${name}`, is_dir: false, size: 1, modified: 0 });
        let finishFirst;
        window.puter = { fs: { readdir: vi.fn()
            .mockImplementationOnce(() => new Promise(resolve => {
                finishFirst = resolve;
            }))
            .mockImplementationOnce(async () => [entry('a.txt'), entry('b.txt')]) } };

        const first = TabFiles.renderDirectory('/alice/Documents', { consistency: 'strong' });
        await TabFiles.renderDirectory('/alice/Documents', { consistency: 'strong' });
        finishFirst([entry('a.txt')]);
        await first;

        expect($('.files .row').map((_, r) => r.getAttribute('data-name')).get().sort()).toEqual(['a.txt', 'b.txt']);
        expect(TabFiles.renderingDirectory).toBe(false);
    });
});

describe('TabFiles.toggleSelectMode', () => {
    beforeEach(() => {
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
    });

    it('shows the action bar for rows selected before it was entered', () => {
        mountListing(['a.txt', 'b.txt'], '/alice/Documents');
        $('.files .row').first().addClass('selected');
        TabFiles.selectModeActive = false;

        TabFiles.toggleSelectMode();

        expect($('.files-selection-actions').hasClass('visible')).toBe(true);
        TabFiles.toggleSelectMode();
        expect($('.files-selection-actions').hasClass('visible')).toBe(false);
    });
});

describe('TabFiles footer', () => {
    it('gives sizes as the rows do', () => {
        window.trash_path = TRASH;
        mountListing(['a.txt'], '/alice/Documents');
        $('.files .row').attr('data-size', '1536').addClass('selected');
        TabFiles.updateFooterStats();
        expect($('.files-footer-item-count').text()).toContain('1.5 KB');
        expect($('.files-footer-selected-items').text()).toContain('1.5 KB');

        $('.files .row').attr('data-size', '0');
        TabFiles.updateFooterStats();
        expect($('.files-footer-item-count').text()).toContain('0 B');
    });
});

describe('typeSelectTarget', () => {
    const names = ['notes', 'readme', 'report-a', 'report-b', 'zip'];

    it('steps through the names a repeated letter starts', () => {
        expect(typeSelectTarget(names, -1, 'r')).toBe(1);
        expect(typeSelectTarget(names, 1, 'r')).toBe(2);
        expect(typeSelectTarget(names, 2, 'rr')).toBe(3);
        expect(typeSelectTarget(names, 3, 'rrr')).toBe(1);
        expect(typeSelectTarget(names, 0, 'r')).toBe(1);
    });

    it('keeps a selected row a longer prefix still matches', () => {
        expect(typeSelectTarget(names, 3, 're')).toBe(3);
        expect(typeSelectTarget(names, 1, 'rep')).toBe(2);
        expect(typeSelectTarget(names, 0, 'rep')).toBe(2);
    });

    it('finds nothing to select for a prefix nothing has', () => {
        expect(typeSelectTarget(names, 0, 'q')).toBe(-1);
    });
});
