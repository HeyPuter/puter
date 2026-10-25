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
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

// The tab's window and dialog plumbing isn't what these tests exercise.
vi.mock('../UIWindow.js', () => ({ default: vi.fn() }));
vi.mock('../UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('../UIContextMenu.js', () => ({ default: vi.fn() }));
vi.mock('../../helpers/generateFileContextMenu.js', () => ({ default: vi.fn(async () => []) }));
vi.mock('../../helpers/itemIcon.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { default: vi.fn(actual.default) };
});

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = globalThis.i18n ?? (key => key);
window.icons = {};

const { default: TabFiles, failedUploadsMessage, rebasePath, typeSelectTarget } = await import('./TabFiles.js');
const { default: generateFileContextMenu } = await import('../../helpers/generateFileContextMenu.js');
const { default: itemIcon } = await import('../../helpers/itemIcon.js');

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

describe('TabFiles.updateNavButtonStates', () => {
    it('takes a disabled arrow out of the Tab order and puts it back', () => {
        document.body.innerHTML = `
            <div class="window">
                <img class="path-btn path-btn-back" tabindex="0">
                <img class="path-btn path-btn-forward" tabindex="0">
                <img class="path-btn path-btn-up" tabindex="0">
            </div>`;
        TabFiles.$el_window = $('.window');
        TabFiles.currentPath = '/alice/Documents';
        window.dashboard_nav_history = ['/alice', '/alice/Documents'];
        window.dashboard_nav_history_current_position = 1;

        TabFiles.updateNavButtonStates();

        expect($('.path-btn-back').attr('tabindex')).toBe('0');
        expect($('.path-btn-forward').attr('tabindex')).toBe('-1');
        expect($('.path-btn-forward').attr('aria-disabled')).toBe('true');
    });
});

describe('TabFiles cancelling a drag that opened a folder', () => {
    beforeEach(() => {
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
    });

    it('goes back even while that folder is still loading', async () => {
        mountListing([], '/alice/Documents');
        TabFiles.renderingDirectory = false;
        TabFiles.trashedNames ??= new Map();
        window.puter = { fs: { readdir: vi.fn(({ path }) => (path === '/alice/Pictures'
            ? new Promise(() => {})
            : Promise.resolve([]))) } };
        window.dashboard_nav_history = ['/alice/Documents'];
        window.dashboard_nav_history_current_position = 0;

        TabFiles.springLoadedOriginalPath = '/alice/Documents';
        TabFiles.pushNavHistory('/alice/Pictures');
        void TabFiles.renderDirectory('/alice/Pictures');
        TabFiles.navigateBackFromSpringLoad();
        await vi.waitFor(() => expect(TabFiles.renderingDirectory).toBe(false));

        expect(TabFiles.currentPath).toBe('/alice/Documents');
        expect(window.dashboard_nav_history_current_position).toBe(0);
    });
});

describe('TabFiles image preview', () => {
    it('closes once the row it shows is gone', () => {
        window.trash_path = TRASH;
        mountListing(['a.png'], '/alice/Pictures');
        $('.files .row').attr('data-uid', 'u1');
        $('body').append('<div class="image-preview-popover"></div>');
        TabFiles.previewOpen = true;
        TabFiles.previewCurrentUid = 'u1';

        TabFiles.updateFooterStats();
        expect(TabFiles.previewOpen).toBe(true);

        $('.files .row').remove();
        TabFiles.updateFooterStats();
        expect(TabFiles.previewOpen).toBe(false);
        expect($('.image-preview-popover')).toHaveLength(0);
    });

    it('is not offered for a file named after an image type', async () => {
        mountListing(['png'], '/alice/Pictures');
        $('.files .row').attr({ 'data-uid': 'u1', 'data-name': 'png', 'data-is_dir': '0' });
        window.puter = { fs: { getReadURL: vi.fn(async () => 'https://example.test/png') } };
        TabFiles.previewOpen = false;

        await TabFiles.showImagePreview($('.files .row'));

        expect(window.puter.fs.getReadURL).not.toHaveBeenCalled();
        expect(TabFiles.previewOpen).toBe(false);
    });

    it('can be cancelled while its image is still loading', async () => {
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        TabFiles.trashedNames ??= new Map();
        TabFiles.renderingDirectory = false;
        mountListing(['a.png'], '/alice/Pictures');
        $('.files .row').attr({ 'data-uid': 'u1', 'data-name': 'a.png', 'data-is_dir': '0' });
        let finishUrl;
        window.puter = { fs: {
            getReadURL: vi.fn(() => new Promise(resolve => {
                finishUrl = resolve;
            })),
            readdir: vi.fn(async () => []),
        } };

        const preview = TabFiles.showImagePreview($('.files .row'));
        expect(TabFiles.previewOpen).toBe(true);
        // Opening another folder meanwhile, as a double-click on one would.
        await TabFiles.renderDirectory('/alice/Documents');
        finishUrl('https://example.test/a.png');
        await preview;

        expect(TabFiles.previewOpen).toBe(false);
        expect($('.image-preview-popover')).toHaveLength(0);
    });

    it('closes, rather than showing the last image, when the next one fails to load', async () => {
        mountListing(['b.png'], '/alice/Pictures');
        $('.files .row').attr({ 'data-uid': 'u2', 'data-name': 'b.png', 'data-is_dir': '0' });
        $('body').append('<div class="image-preview-popover" data-uid="u1"></div>');
        TabFiles.previewOpen = true;
        TabFiles.previewCurrentUid = 'u1';
        window.puter = { fs: { getReadURL: vi.fn(async () => { throw new Error('gone'); }) } };
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await TabFiles.showImagePreview($('.files .row'));

        expect(TabFiles.previewOpen).toBe(false);
        expect($('.image-preview-popover')).toHaveLength(0);
        vi.restoreAllMocks();
    });
});

describe('TabFiles.acceptsNewItems', () => {
    it('refuses a folder shared to view only, and takes one shared to edit', async () => {
        const { remember_shared_roots } = await import('../../helpers/sharedAccess.js');
        window.user = { username: 'alice' };
        window.trash_path = TRASH;
        remember_shared_roots([
            { path: '/bob/Photos', mode: 'read' },
            { path: '/bob/Drafts', mode: 'write' },
        ]);

        expect(TabFiles.acceptsNewItems('/bob/Photos')).toBe(false);
        expect(TabFiles.acceptsNewItems('/bob/Photos/2024')).toBe(false);
        expect(TabFiles.acceptsNewItems('/bob/Drafts')).toBe(true);
        expect(TabFiles.acceptsNewItems('/alice/Documents')).toBe(true);
    });
});

describe('TabFiles.applyHiddenRule', () => {
    it('hides a row renamed to a dot-name, or dims it when hidden files show', () => {
        window.trash_path = TRASH;
        mountListing(['a.txt', 'b.txt'], '/alice/Documents');
        window.user_preferences = { show_hidden_files: false };

        expect(TabFiles.applyHiddenRule($('.files .row').first(), '.a.txt')).toBe(false);
        expect($('.files .row')).toHaveLength(1);

        window.user_preferences = { show_hidden_files: true };
        expect(TabFiles.applyHiddenRule($('.files .row').first(), '.b.txt')).toBe(true);
        expect($('.files .row').first().hasClass('item-revealed')).toBe(true);
        TabFiles.applyHiddenRule($('.files .row').first(), 'b.txt');
        expect($('.files .row').first().hasClass('item-revealed')).toBe(false);
    });
});

describe('TabFiles "Shared by" column width', () => {
    const SHARED = 'puter://shared';

    beforeEach(() => {
        // Earlier suites stub applyColumnWidths out.
        vi.restoreAllMocks();
        window.shared_path = SHARED;
        window.trash_path = TRASH;
        mountListing([], SHARED);
        TabFiles.columnWidths = { name: null, sharedBy: 160, size: 100, modified: 120 };
        // jsdom lays nothing out; give the listing a width.
        vi.spyOn($.fn, 'width').mockImplementation(function () {
            return this.hasClass('files') ? 530 : 0;
        });
        vi.spyOn(TabFiles, 'fitItemNames').mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it('leaves the auto-width name the larger part in a narrow listing', () => {
        TabFiles.applyColumnWidths();
        expect(TabFiles.columnGridTemplate).toBe('24px auto 4px 92px 4px 100px 4px 120px 4px 20px');
    });

    it('keeps its own width when another column is resized', () => {
        TabFiles.applyColumnWidths();
        TabFiles.adoptAppliedColumnWidths();
        expect(TabFiles.columnWidths.sharedBy).toBe(160);
    });

    it('leaves other columns room to resize as it is laid out', () => {
        expect(TabFiles.clampColumnWidth('size', 90)).toBe(90);
    });

    it('is resized only as far as it is laid out', () => {
        expect(TabFiles.clampColumnWidth('sharedBy', 200)).toBe(92);
    });
});

describe('TabFiles people filter across navigation', () => {
    const SHARED = 'puter://shared';
    const share = (name, sharer) => ({
        uid: name, name, path: `/${sharer}/${name}-uid/${name}`, is_dir: true, size: 0, modified: 0,
        shared_with_me: true, shared_by: sharer, owner: sharer,
    });
    const listed = () => $('.files .row').map((_, r) => r.getAttribute('data-name')).get().sort();

    beforeEach(() => {
        vi.restoreAllMocks();
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        window.trash_path = TRASH;
        window.shared_path = SHARED;
        window.byte_format = bytes => `${bytes} B`;
        window.puter = { fs: { readdir: vi.fn(async () => []) } };
        mountListing([], '/alice');
        $('.files-tab').prepend('<div class="shared-people-filter" hidden></div>');
        TabFiles.renderingDirectory = false;
        TabFiles.trashedNames ??= new Map();
        TabFiles.sharerFilter = null;
        // jsdom has no layout to scroll.
        Element.prototype.scrollIntoView ??= () => {};
        vi.spyOn(TabFiles, 'listSharedView').mockImplementation(async () => [share('a', 'ann'), share('b', 'bob')]);
        vi.spyOn(TabFiles, 'applyColumnWidths').mockImplementation(() => {});
        vi.spyOn(TabFiles, 'renderItem').mockImplementation(async (file) => {
            $('.files').append(`<div class="row item" data-uid="${file.uid}" data-path="${file.path}" data-name="${file.name}"></div>`);
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it('is still set on coming back out of a shared folder', async () => {
        await TabFiles.renderDirectory(SHARED);
        await TabFiles.setSharerFilter('bob');
        expect(listed()).toEqual(['b']);

        await TabFiles.renderDirectory('/bob/b-uid/b');
        await TabFiles.renderDirectory(SHARED);

        expect(TabFiles.sharerFilter).toBe('bob');
        expect(listed()).toEqual(['b']);
        expect($('.sharer-chip.active').attr('data-sharer')).toBe('bob');
    });

    it('gives way to show an item a share link or notification names', async () => {
        const uid = '5298098f-d8a2-41da-828f-867b9a7f0cce';
        TabFiles.listSharedView.mockImplementation(async () => [{ ...share('a', 'ann'), uid }, share('b', 'bob')]);
        await TabFiles.renderDirectory(SHARED);
        await TabFiles.setSharerFilter('bob');

        await TabFiles.selectSharedRows([`/ann/${uid}/a`]);

        expect(TabFiles.sharerFilter).toBeNull();
        expect(listed()).toEqual(['a', 'b']);
        expect($('.files .row.selected').attr('data-name')).toBe('a');
    });

    it('stays put when the named item is already shown', async () => {
        const uid = '5298098f-d8a2-41da-828f-867b9a7f0cce';
        TabFiles.listSharedView.mockImplementation(async () => [share('a', 'ann'), { ...share('b', 'bob'), uid }]);
        await TabFiles.renderDirectory(SHARED);
        await TabFiles.setSharerFilter('bob');

        await TabFiles.selectSharedRows([`/bob/${uid}/b`]);

        expect(TabFiles.sharerFilter).toBe('bob');
        expect($('.files .row.selected').attr('data-name')).toBe('b');
    });

    it('shows every folder to a drag that springs into Shared', async () => {
        await TabFiles.renderDirectory(SHARED);
        await TabFiles.setSharerFilter('bob');
        await TabFiles.renderDirectory('/bob/b-uid/b');

        window.an_item_is_being_dragged = true;
        try {
            await TabFiles.renderDirectory(SHARED);
        } finally {
            window.an_item_is_being_dragged = false;
        }

        expect(TabFiles.sharerFilter).toBeNull();
        expect(listed()).toEqual(['a', 'b']);
    });

    it('still filters when Shared fails to list again', async () => {
        await TabFiles.renderDirectory(SHARED);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        TabFiles.listSharedView.mockImplementation(async () => {
            throw new Error('offline');
        });

        await TabFiles.setSharerFilter('bob');

        expect(listed()).toEqual(['b']);
        expect($('.sharer-chip.active').attr('data-sharer')).toBe('bob');
        expect($('.files').text()).not.toContain("couldn't be opened");
    });

    it('still says a Shared it was asked to open could not be listed', async () => {
        await TabFiles.renderDirectory(SHARED);
        await TabFiles.renderDirectory('/alice/Documents');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        TabFiles.listSharedView.mockImplementation(async () => {
            throw new Error('offline');
        });

        await TabFiles.renderDirectory(SHARED);

        expect($('.files').text()).toContain("couldn't be opened");
    });

    it("clears once the user goes back to their own files", async () => {
        await TabFiles.renderDirectory(SHARED);
        await TabFiles.setSharerFilter('bob');

        await TabFiles.renderDirectory('/alice/Documents');
        await TabFiles.renderDirectory(SHARED);

        expect(TabFiles.sharerFilter).toBeNull();
        expect(listed()).toEqual(['a', 'b']);
    });
});

describe('TabFiles Remove from Shared', () => {
    const SHARED = 'puter://shared';

    beforeEach(() => {
        vi.restoreAllMocks();
        window.shared_path = SHARED;
        window.trash_path = TRASH;
        vi.spyOn(TabFiles, 'refreshKeepingSelection').mockImplementation(async () => {});
    });

    const removeFromShared = async () => {
        await TabFiles.generateContextMenuItems($('.files .row')[0], {});
        generateFileContextMenu.mock.lastCall[0].onRemovedFromShared();
    };

    it('lists Shared again, for the people filter and the empty notice', async () => {
        mountListing(['a'], SHARED);
        await removeFromShared();
        expect(TabFiles.refreshKeepingSelection).toHaveBeenCalledTimes(1);
    });

    it('leaves another folder the user has since opened alone', async () => {
        mountListing(['a'], '/alice/Documents');
        await removeFromShared();
        expect(TabFiles.refreshKeepingSelection).not.toHaveBeenCalled();
    });
});

describe('TabFiles sorting', () => {
    const entries = [
        { name: 'file10.txt', size: 5, modified: 3 },
        { name: 'dir10', is_dir: true, size: 0, modified: 1 },
        { name: 'file2.txt', size: 5, modified: 3 },
        { name: 'Beta', is_dir: true, size: 0, modified: 1 },
        { name: 'dir2', is_dir: true, size: 0, modified: 1 },
        { name: 'big.bin', size: 50, modified: 2 },
    ];
    const sorted = (column, direction) => {
        TabFiles.sortColumn = column;
        TabFiles.sortDirection = direction;
        return TabFiles.sortFiles(entries).map(e => e.name);
    };

    beforeEach(() => {
        TabFiles.currentPath = '/alice/Documents';
        window.shared_path = '/alice/Shared';
    });

    it('orders names with numbers by value, folders first', () => {
        expect(sorted('name', 'asc')).toEqual(['Beta', 'dir2', 'dir10', 'big.bin', 'file2.txt', 'file10.txt']);
    });

    it('breaks ties in size by name', () => {
        expect(sorted('size', 'asc')).toEqual(['Beta', 'dir2', 'dir10', 'file2.txt', 'file10.txt', 'big.bin']);
        expect(sorted('size', 'desc')).toEqual(['dir10', 'dir2', 'Beta', 'big.bin', 'file10.txt', 'file2.txt']);
    });

    it('shows trashed items by the name they had', () => {
        TabFiles.sortColumn = 'name';
        TabFiles.sortDirection = 'asc';
        const trashed = [
            { name: 'uid-b', metadata: JSON.stringify({ original_name: 'b.txt' }) },
            { name: 'uid-a', metadata: JSON.stringify({ original_name: 'a.txt' }) },
        ];
        expect(TabFiles.sortFiles(trashed).map(e => e.name)).toEqual(['uid-a', 'uid-b']);
    });

    it('puts an added row where a listing would', () => {
        TabFiles.sortColumn = 'size';
        TabFiles.sortDirection = 'asc';
        const listed = TabFiles.sortFiles(entries.filter(e => e.name !== 'file2.txt'));
        document.body.innerHTML = `<div class="window"><div class="files-tab"><div class="files">${listed.map(e => (
            `<div class="item row" data-name="${e.name}" data-is_dir="${e.is_dir ? 1 : 0}" data-size="${e.size}" data-modified="${e.modified}"></div>`
        )).join('')}</div></div></div>`;
        TabFiles.$el_window = $('.window');
        const $row = $('<div class="item row" data-name="file2.txt" data-is_dir="0"></div>').appendTo('.files');

        TabFiles.insertAtSortedPosition($row, { name: 'file2.txt', size: 5, modified: 3 });

        expect($('.files .row').map((_, r) => r.getAttribute('data-name')).get())
            .toEqual(['Beta', 'dir2', 'dir10', 'file2.txt', 'file10.txt', 'big.bin']);
    });
});

describe('TabFiles permanent delete', () => {
    beforeEach(() => {
        window.trash_path = TRASH;
        window.delete_item = vi.fn(async () => {});
        window.refresh_trash_state = vi.fn(async () => {});
    });

    it('asks about "this item" for one row and "these items" for several', async () => {
        const { default: UIAlert } = await import('../UIAlert.js');
        UIAlert.mockClear();
        UIAlert.mockResolvedValue('delete');
        mountListing(['a', 'b'], TRASH);
        const rows = $('.files .row').toArray();

        await TabFiles.deleteRowsPermanently([rows[0]]);
        expect(UIAlert.mock.calls[0][0].message).toMatch(/this item/);
        expect(window.delete_item).toHaveBeenCalledTimes(1);

        await TabFiles.deleteRowsPermanently(rows);
        expect(UIAlert.mock.calls[1][0].message).toMatch(/these items/);
        expect(window.delete_item).toHaveBeenCalledTimes(3);
    });

    it('deletes nothing when cancelled', async () => {
        const { default: UIAlert } = await import('../UIAlert.js');
        UIAlert.mockResolvedValue('cancel');
        mountListing(['a'], TRASH);

        await TabFiles.deleteRowsPermanently($('.files .row').toArray());
        expect(window.delete_item).not.toHaveBeenCalled();
    });
});

describe('TabFiles column widths that no longer fit', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        window.shared_path = 'puter://shared';
        window.trash_path = TRASH;
        mountListing([], '/alice/Documents');
        vi.spyOn($.fn, 'width').mockImplementation(function () {
            return this.hasClass('files') ? 1200 : 0;
        });
        vi.spyOn(TabFiles, 'fitItemNames').mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it('lay out at the defaults beside an auto-width name', () => {
        TabFiles.columnWidths = { name: null, sharedBy: 160, size: 100, modified: 1800 };
        TabFiles.applyColumnWidths();
        expect(TabFiles.columnGridTemplate).toBe('24px auto 4px 100px 4px 120px 4px 20px');
        expect(TabFiles.columnWidths.modified).toBe(1800);
    });

    it('stay as saved while they fit', () => {
        TabFiles.columnWidths = { name: null, sharedBy: 160, size: 100, modified: 900 };
        TabFiles.applyColumnWidths();
        expect(TabFiles.columnGridTemplate).toBe('24px auto 4px 100px 4px 900px 4px 20px');
    });
});

describe('TabFiles names in a narrow listing', () => {
    it('are not cut to the name column a wider listing was given', () => {
        const name = 'Quarterly financial report final version.pdf';
        document.body.innerHTML = `
            <div class="window"><div class="files-tab">
                <div class="header"><div class="columns" style="display: none"></div></div>
                <div class="files files-list-view">
                    <div class="row item" data-name="${name}"><pre class="item-name"></pre></div>
                </div>
            </div></div>`;
        TabFiles.$el_window = $('.window');
        TabFiles.currentView = 'list';
        TabFiles.appliedColumnWidths = { name: 120, sharedBy: 160, size: 60, modified: 80 };

        TabFiles.fitItemNames($('.files .item-name'));

        expect($('.files .item-name').text()).toBe(name);
    });
});

describe('TabFiles uploads', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        window.trash_path = TRASH;
        window.active_uploads = {};
        window.actions_history = [];
        window.show_save_account_notice_if_needed = vi.fn();
        const { default: UIWindowProgress } = await import('../UIWindowProgress.js');
        UIWindowProgress.mockResolvedValue({ set_status: vi.fn(), set_progress: vi.fn(), close: vi.fn(), show_error: vi.fn() });
        window.puter = { fs: { upload: vi.fn(async (items, dest, callbacks) => {
            await callbacks.init('op1', { abort: vi.fn() });
            await callbacks.success([{ path: `${dest}/new.txt` }]);
        }) } };
        vi.spyOn(TabFiles, 'renderDirectory').mockImplementation(async () => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it('into another folder leave the listing and its selection alone', async () => {
        mountListing(['a.txt', 'b.txt'], '/alice/Documents');
        $('.files .row').addClass('selected');

        TabFiles.uploadFiles([new File(['x'], 'new.txt')], '/alice/Documents/sub');
        await vi.waitFor(() => expect(window.actions_history).toHaveLength(1));

        expect(TabFiles.renderDirectory).not.toHaveBeenCalled();
        expect($('.files .row.selected')).toHaveLength(2);
    });

    it('into the folder on screen list it again', async () => {
        mountListing(['a.txt'], '/alice/Documents');

        TabFiles.uploadFiles([new File(['x'], 'new.txt')], '/alice/Documents');
        await vi.waitFor(() => expect(TabFiles.renderDirectory).toHaveBeenCalledWith('/alice/Documents', { consistency: 'strong' }));
    });
});

describe('TabFiles refreshing a folder whose icons are slow to read', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        window.user = { username: 'alice', directories: {} };
        window.home_path = '/alice';
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
        vi.spyOn(TabFiles, 'renderItem').mockImplementation(async (file) => {
            $('.files').append(`<div class="row item" data-uid="${file.uid}" data-path="${file.path}" data-name="${file.name}"></div>`);
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it('keeps the rows up until the new ones can be drawn', async () => {
        mountListing(['old.txt'], '/alice/Documents');
        TabFiles.renderingDirectory = false;
        TabFiles.trashedNames ??= new Map();
        window.puter = { fs: { readdir: vi.fn(async () => [
            { uid: 'w', name: 'site.weblink', path: '/alice/Documents/site.weblink', is_dir: false, size: 1, modified: 0 },
        ]) } };
        let finishIcon;
        itemIcon.mockImplementationOnce(() => new Promise(resolve => {
            finishIcon = resolve;
        }));

        const refresh = TabFiles.renderDirectory('/alice/Documents');
        await vi.waitFor(() => expect(finishIcon).toBeTypeOf('function'));
        expect($('.files .row').map((_, r) => r.getAttribute('data-path')).get()).toEqual(['/alice/Documents/old.txt']);

        finishIcon({ image: 'icon.svg', type: 'icon' });
        await refresh;
        expect($('.files .row').map((_, r) => r.getAttribute('data-name')).get()).toEqual(['site.weblink']);
    });
});
