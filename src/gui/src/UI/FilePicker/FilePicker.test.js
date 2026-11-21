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

vi.mock('../UIAlert.js', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('../UIContextMenu.js', () => ({ default: vi.fn(() => ({})) }));
vi.mock('../../helpers/itemIcon.js', () => ({ default: vi.fn(async () => ({ image: 'icon.svg', type: 'icon' })) }));
vi.mock('../../helpers/listAllShared.js', () => ({ default: vi.fn(async () => []) }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = globalThis.i18n ?? (key => key);
window.html_encode = value => jQuery('<div>').text(value).html();
window.icons = new Proxy({}, { get: (_, name) => `/icons/${String(name)}` });
window.matchMedia = () => ({ matches: false, addEventListener () {} });
Element.prototype.scrollIntoView = function () {};
// The window's close runs its remove handlers, as jQuery UI's does in the GUI.
jQuery.fn.close = function () {
    this.trigger('remove');
    this.remove();
    return this;
};

const { default: UIContextMenu } = await import('../UIContextMenu.js');
const { pickerAccepts } = await import('./FilePicker.js');
const { filePickerPromptHtml, initFilePickerDialog } = await import('./filePickerDialog.js');

const DESKTOP = '/alice/Desktop';
const folders = {
    '/alice': [
        { uid: 'd', name: 'Desktop', path: DESKTOP, is_dir: true, modified: 1 },
        { uid: 'ad', name: 'AppData', path: '/alice/AppData', is_dir: true, modified: 1 },
        { uid: 'tr', name: 'Trash', path: '/alice/Trash', is_dir: true, modified: 1 },
    ],
    [DESKTOP]: [
        { uid: 'f1', name: 'notes.txt', path: `${DESKTOP}/notes.txt`, size: 3, modified: 1 },
        { uid: 'f2', name: 'photo.png', path: `${DESKTOP}/photo.png`, size: 3, modified: 1, type: 'image/png' },
        { uid: 'h1', name: '.hidden', path: `${DESKTOP}/.hidden`, size: 1, modified: 1 },
        { uid: 'k', name: 'Kids', path: `${DESKTOP}/Kids`, is_dir: true, modified: 1 },
    ],
    [`${DESKTOP}/Kids`]: [],
    '/alice/Trash': [
        { uid: 't1', name: 'old.txt', path: '/alice/Trash/old.txt', size: 3, modified: 1 },
    ],
};

const settle = async () => {
    for ( let i = 0; i < 5; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};

beforeEach(() => {
    Object.assign(window, {
        user: { username: 'alice' },
        home_path: '/alice',
        desktop_path: DESKTOP,
        docs_path: '/alice/Documents',
        pictures_path: '/alice/Pictures',
        public_path: '/alice/Public',
        videos_path: '/alice/Videos',
        trash_path: '/alice/Trash',
        shared_path: 'puter://shared',
        root_dirname: 'Puter',
        global_element_id: 1,
        locale: 'en',
        isMobile: {},
        user_preferences: {},
        determine_website_url: () => null,
        privacy_aware_path: p => p.replace('/alice', '~'),
        validate_fsentry_name: () => true,
        check_fsentry_against_allowed_file_types_string: (entry, allowed) => ! allowed
            || allowed.split(',').some(ext => entry.name.endsWith(ext.trim())),
        puter: {
            kv: { get: vi.fn(async () => null) },
            fs: {
                readdir: vi.fn(async ({ path }) => {
                    if ( ! folders[path] ) throw new Error('not found');
                    return folders[path].map(entry => ({ ...entry }));
                }),
                sign: vi.fn(async (_app, items) => ({
                    items: items.length === 1
                        ? { fsentry_name: items[0].path.split('/').pop(), uid: items[0].uid, path: items[0].path }
                        : items.map(item => ({ fsentry_name: item.path.split('/').pop(), uid: item.uid, path: item.path })),
                })),
            },
        },
    });
    delete window.dashboard_object;
    delete window.deliverPopupTokenToOpener;
});

afterEach(() => {
    document.body.innerHTML = '';
});

/** A picker window as UIWindow draws it, with the listing in it once loaded. */
const openDialog = async (options) => {
    const el_window = document.createElement('div');
    el_window.className = 'window window-filedialog';
    el_window.setAttribute('data-element_uuid', 'picker-1');
    el_window.setAttribute('data-iframe_msg_uid', '7');
    el_window.innerHTML = `<div class="window-disable-mask"><div class="busy-indicator"></div></div><div class="window-body"></div>${filePickerPromptHtml(options)}`;
    document.body.append(el_window);
    const picker = initFilePickerDialog(el_window, { path: DESKTOP, selectable_body: false, ...options });
    await settle();
    return { el_window, picker, $: (selector) => jQuery(el_window).find(selector) };
};

/** An app window that asked for the picker, recording what it's sent. */
const appWindow = () => {
    const el = document.createElement('div');
    el.className = 'window';
    el.setAttribute('data-element_uuid', 'app-1');
    const iframe = document.createElement('iframe');
    iframe.className = 'window-app-iframe';
    el.append(iframe);
    document.body.append(el);
    const posted = [];
    iframe.contentWindow.postMessage = (data) => posted.push(data);
    const opened = [];
    el.addEventListener('file_opened', (e) => opened.push(e.detail));
    return { posted, opened };
};

const rowNames = (dialog) => dialog.$('.files .row.item').map((_, row) => row.getAttribute('data-name')).get();
const rowNamed = (dialog, name) => dialog.$(`.files .row.item[data-name="${name}"]`);

describe('pickerAccepts', () => {
    it('takes folders in every mode, and files only of the allowed types outside a directory picker', () => {
        expect(pickerAccepts({ is_dir: true, name: 'a' }, 'directory', '')).toBe(true);
        expect(pickerAccepts({ name: 'a.txt' }, 'directory', '')).toBe(false);
        expect(pickerAccepts({ name: 'a.txt' }, 'open', '.png')).toBe(false);
        expect(pickerAccepts({ name: 'a.png' }, 'save', '.png')).toBe(true);
    });
});

describe('FilePicker listing', () => {
    it('lists folders first, without hidden files, and leaves AppData and Trash out of Home', async () => {
        const dialog = await openDialog({ is_openFileDialog: true });
        expect(rowNames(dialog)).toEqual(['Kids', 'notes.txt', 'photo.png']);

        dialog.$('.directories [data-folder="Home"]').trigger('click');
        await settle();
        expect(rowNames(dialog)).toEqual(['Desktop']);
        expect(dialog.el_window.getAttribute('data-path')).toBe('/alice');
    });

    it('greys out files of other types, and every file in a directory picker', async () => {
        const open = await openDialog({ is_openFileDialog: true, allowed_file_types: ['.png'] });
        expect(rowNamed(open, 'notes.txt').hasClass('item-disabled')).toBe(true);
        expect(rowNamed(open, 'photo.png').hasClass('item-disabled')).toBe(false);
        document.body.innerHTML = '';

        const dir = await openDialog({ is_directoryPicker: true });
        expect(rowNamed(dir, 'photo.png').hasClass('item-disabled')).toBe(true);
        expect(rowNamed(dir, 'Kids').hasClass('item-disabled')).toBe(false);
    });

    it('says so when a folder can\'t be listed', async () => {
        const dialog = await openDialog({ is_openFileDialog: true, path: '/alice/Missing' });
        expect(dialog.$('.files-notice').text()).toBe('folder_open_failed');
        expect(dialog.picker.acceptsNewItemsHere()).toBe(false);
    });

    it('goes into a double-clicked folder and back', async () => {
        const dialog = await openDialog({ is_openFileDialog: true });
        rowNamed(dialog, 'Kids').trigger('dblclick');
        await settle();
        expect(dialog.el_window.getAttribute('data-path')).toBe(`${DESKTOP}/Kids`);
        expect(dialog.$('.files-empty-notice').length).toBe(1);

        dialog.$('.path-btn-back').trigger('click');
        await settle();
        expect(dialog.el_window.getAttribute('data-path')).toBe(DESKTOP);
        expect(dialog.$('.path-btn-forward').hasClass('path-btn-disabled')).toBe(false);
    });

    it('sorts by a column header, flipping the order on a second click', async () => {
        const dialog = await openDialog({ is_openFileDialog: true });
        dialog.$('.header .columns .sortable[data-sort="name"]').trigger('click');
        // The header answers the click before the listing arrives.
        expect(dialog.$('.sortable[data-sort="name"]').hasClass('sort-desc')).toBe(true);
        await settle();
        expect(rowNames(dialog)).toEqual(['Kids', 'photo.png', 'notes.txt']);
        expect(dialog.$('.sortable[data-sort="name"]').hasClass('sort-desc')).toBe(true);
    });
});

describe('FilePicker resizing', () => {
    it('fits the names again when the listing\'s width changes', async () => {
        let resized;
        vi.stubGlobal('ResizeObserver', class {
            constructor (callback) {
                resized = callback;
            }
            observe () {}
            disconnect () {}
        });
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });
        try {
            const dialog = await openDialog({ is_openFileDialog: true });
            const $name = rowNamed(dialog, 'notes.txt').find('.item-name').text('no…txt');
            Object.defineProperty(dialog.$('.files')[0], 'clientWidth', { configurable: true, value: 500 });

            resized();

            expect($name.text()).toBe('notes.txt');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('FilePicker selection', () => {
    it('keeps one item selected unless the picker takes several', async () => {
        const single = await openDialog({ is_openFileDialog: true });
        rowNamed(single, 'notes.txt').trigger('click');
        rowNamed(single, 'photo.png').trigger(jQuery.Event('click', { metaKey: true }));
        expect(single.picker.selectedEntries().map(e => e.name)).toEqual(['photo.png']);
        document.body.innerHTML = '';

        const multiple = await openDialog({ is_openFileDialog: true, selectable_body: true });
        rowNamed(multiple, 'notes.txt').trigger('click');
        rowNamed(multiple, 'photo.png').trigger(jQuery.Event('click', { metaKey: true }));
        expect(multiple.picker.selectedEntries().map(e => e.name)).toEqual(['notes.txt', 'photo.png']);
    });

    it('selects a range with Shift', async () => {
        const dialog = await openDialog({ is_openFileDialog: true, selectable_body: true });
        rowNamed(dialog, 'Kids').trigger('click');
        rowNamed(dialog, 'photo.png').trigger(jQuery.Event('click', { shiftKey: true }));
        expect(dialog.picker.selectedEntries().map(e => e.name)).toEqual(['Kids', 'notes.txt', 'photo.png']);
    });

    it('never selects a greyed-out file', async () => {
        const dialog = await openDialog({ is_directoryPicker: true });
        rowNamed(dialog, 'notes.txt').trigger('click');
        expect(dialog.picker.selectedEntries()).toEqual([]);
    });

    it('moves with the arrow keys, skipping greyed-out files', async () => {
        const dialog = await openDialog({ is_openFileDialog: true, allowed_file_types: '.png' });
        const key = (k, which) => dialog.$('.files').trigger(jQuery.Event('keydown', { key: k, which }));
        dialog.$('.files')[0].focus();
        key('ArrowDown', 40);
        expect(dialog.picker.selectedEntries().map(e => e.name)).toEqual(['Kids']);
        key('ArrowDown', 40);
        expect(dialog.picker.selectedEntries().map(e => e.name)).toEqual(['photo.png']);
    });
});

describe('FilePicker keyboard focus', () => {
    const press = (key, which) => jQuery(document.activeElement).trigger(jQuery.Event('keydown', { key, which }));

    it('opens the row the arrows moved to with Enter, after a click on a sidebar folder', async () => {
        const app = appWindow();
        const dialog = await openDialog({ is_openFileDialog: true, parent_uuid: 'app-1' });
        dialog.$('.directories [data-folder="Desktop"]')[0].focus();

        press('ArrowDown', 40);
        press('ArrowDown', 40);
        expect(document.activeElement).toBe(dialog.$('.files')[0]);
        expect(dialog.picker.selectedEntries().map(e => e.name)).toEqual(['notes.txt']);

        press('Enter', 13);
        await settle();
        expect(app.posted[0]).toMatchObject({ msg: 'fileOpenPicked', items: [{ uid: 'f1' }] });
    });

    it('takes the keyboard from a focused button when a name is typed', async () => {
        const dialog = await openDialog({ is_openFileDialog: true });
        dialog.$('.sort-btn')[0].focus();

        press('p', 80);

        expect(dialog.picker.selectedEntries().map(e => e.name)).toEqual(['photo.png']);
        expect(document.activeElement).toBe(dialog.$('.files')[0]);
    });

    it('keeps the keyboard on the listing after a click on a crumb', async () => {
        const dialog = await openDialog({ is_openFileDialog: true });
        const crumb = dialog.$('.path-breadcrumbs .dirname').first();
        crumb[0].focus();

        crumb.trigger('click');
        await settle();

        expect(dialog.el_window.getAttribute('data-path')).toBe('/alice');
        expect(document.activeElement).toBe(dialog.$('.files')[0]);
    });

    it('takes the keyboard back when a menu closes with it on nothing', async () => {
        const dialog = await openDialog({ is_openFileDialog: true });
        dialog.$('.sort-btn').trigger('click');
        const menu = UIContextMenu.mock.results.at(-1).value;
        document.activeElement.blur();
        expect(document.activeElement).toBe(document.body);

        menu.onClose();

        expect(document.activeElement).toBe(dialog.$('.files')[0]);
    });

    it('leaves the keyboard in the name field when a menu closes', async () => {
        const dialog = await openDialog({ is_saveFileDialog: true, saveFileDialog_default_filename: 'draft.txt' });
        dialog.$('.view-toggle-btn').trigger('click');
        const menu = UIContextMenu.mock.results.at(-1).value;
        dialog.$('.savefiledialog-filename')[0].focus();

        menu.onClose();

        expect(document.activeElement).toBe(dialog.$('.savefiledialog-filename')[0]);
    });

    it('returns to the listing when Enter ends a rename', async () => {
        window.rename_file = vi.fn();
        const dialog = await openDialog({ is_openFileDialog: true });
        const $editor = rowNamed(dialog, 'notes.txt').find('.item-name-editor').show().addClass('item-name-editor-active').val('renamed.txt');
        $editor[0].focus();

        $editor.trigger(jQuery.Event('keydown', { key: 'Enter', which: 13 }));

        expect(window.rename_file).toHaveBeenCalled();
        expect(document.activeElement).toBe(dialog.$('.files')[0]);
    });
});

describe('FilePicker rename', () => {
    it('fits the name to its row again when the rename fails', async () => {
        // As rename_file does on an error: the old name back, cut short.
        window.rename_file = vi.fn((_entry, _newName, _oldName, _oldPath, _row, el_name, _icon, _editor, _url, _undo, onDone) => {
            jQuery(el_name).text('not…txt');
            onDone(null);
        });
        const dialog = await openDialog({ is_openFileDialog: true });
        const $row = rowNamed(dialog, 'notes.txt');

        $row.find('.item-name-editor').addClass('item-name-editor-active').val('photo.png').trigger('focusout');

        expect(window.rename_file).toHaveBeenCalled();
        expect($row.find('.item-name').text()).toBe('notes.txt');
    });
});

describe('open picker', () => {
    it('enables Open for a selected file, and sends the signed file to the app window', async () => {
        const app = appWindow();
        const dialog = await openDialog({ is_openFileDialog: true, parent_uuid: 'app-1', initiating_app_uuid: 'app-uid' });
        const $open = dialog.$('.openfiledialog-open-btn');
        expect($open.prop('disabled')).toBe(true);
        rowNamed(dialog, 'Kids').trigger('click');
        expect($open.prop('disabled')).toBe(true);
        rowNamed(dialog, 'notes.txt').trigger('click');
        expect($open.prop('disabled')).toBe(false);

        $open.trigger('click');
        await settle();

        expect(window.puter.fs.sign).toHaveBeenCalledWith('app-uid', [{ uid: 'f1', action: 'write', path: `${DESKTOP}/notes.txt` }]);
        expect(app.posted).toEqual([expect.objectContaining({
            msg: 'fileOpenPicked',
            original_msg_id: '7',
            items: [expect.objectContaining({ uid: 'f1', path: '~/Desktop/notes.txt' })],
            // The single item's own fields, for older callers.
            fsentry_name: 'notes.txt',
        })]);
        expect(app.opened).toEqual([[expect.objectContaining({ uid: 'f1' })]]);
        expect(document.body.contains(dialog.el_window)).toBe(false);
    });

    it('picks a double-clicked file the same way', async () => {
        const app = appWindow();
        const dialog = await openDialog({ is_openFileDialog: true, parent_uuid: 'app-1' });
        rowNamed(dialog, 'photo.png').trigger('dblclick');
        await settle();
        expect(app.posted[0]).toMatchObject({ msg: 'fileOpenPicked', items: [{ uid: 'f2' }] });
    });

    it('answers the page that opened its popup at the attested origin, after the token', async () => {
        const calls = [];
        window.deliverPopupTokenToOpener = () => calls.push('token');
        const opener = { postMessage: (data, origin) => calls.push([data.msg, origin]) };
        Object.defineProperty(window, 'opener', { value: opener, configurable: true });
        window.openerOrigin = 'https://app.example';
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        const open = vi.spyOn(window, 'open').mockImplementation(() => ({ close () {} }));
        try {
            const dialog = await openDialog({ is_openFileDialog: true, return_to_parent_window: true });
            rowNamed(dialog, 'notes.txt').trigger('dblclick');
            await settle();
            expect(calls).toEqual(['token', ['fileOpenPicked', 'https://app.example']]);
            expect(close).toHaveBeenCalled();
        } finally {
            close.mockRestore();
            open.mockRestore();
            delete window.opener;
        }
    });

    it('tells an app window it was cancelled when it closes without an answer', async () => {
        const onDialogCancel = vi.fn();
        const dialog = await openDialog({ is_openFileDialog: true, parent_uuid: 'app-1', onDialogCancel });
        jQuery(dialog.el_window).close();
        expect(onDialogCancel).toHaveBeenCalledTimes(1);
    });

    it('leaves the cancel to on_close when the caller has one, and says nothing after an answer', async () => {
        const onDialogCancel = vi.fn();
        const withOnClose = await openDialog({ is_openFileDialog: true, parent_uuid: 'app-1', onDialogCancel, on_close: () => {} });
        jQuery(withOnClose.el_window).close();
        expect(onDialogCancel).not.toHaveBeenCalled();

        appWindow();
        const answered = await openDialog({ is_openFileDialog: true, parent_uuid: 'app-1', onDialogCancel });
        rowNamed(answered, 'notes.txt').trigger('dblclick');
        await settle();
        expect(onDialogCancel).not.toHaveBeenCalled();
    });
});

describe('directory picker', () => {
    it('picks the folder it is in when none is selected, by its path', async () => {
        const app = appWindow();
        const dialog = await openDialog({ is_directoryPicker: true, parent_uuid: 'app-1', initiating_app_uuid: 'app-uid' });
        dialog.$('.directorypicker-select-btn').trigger('click');
        await settle();
        expect(window.puter.fs.sign).toHaveBeenCalledWith('app-uid', [{ action: 'write', path: DESKTOP }]);
        expect(app.posted).toEqual([{ msg: 'directoryPicked', original_msg_id: '7', items: [expect.objectContaining({ path: '~/Desktop' })] }]);
    });

    it('can\'t pick the Shared view itself', async () => {
        const dialog = await openDialog({ is_directoryPicker: true, parent_uuid: 'app-1' });
        dialog.$('.directories [data-folder="Shared"]').trigger('click');
        await settle();
        expect(dialog.$('.directorypicker-select-btn').prop('disabled')).toBe(true);
    });
});

describe('save picker', () => {
    it('names the save after a clicked file, and keeps what was typed through a re-listing', async () => {
        const onSaveFileDialogSave = vi.fn();
        const dialog = await openDialog({ is_saveFileDialog: true, saveFileDialog_default_filename: 'draft.txt', onSaveFileDialogSave });
        const $name = dialog.$('.savefiledialog-filename');
        expect($name.val()).toBe('draft.txt');

        rowNamed(dialog, 'notes.txt').trigger('click');
        expect($name.val()).toBe('notes.txt');
        $name.val('mine.txt');
        await dialog.picker.refresh();
        expect($name.val()).toBe('mine.txt');

        dialog.$('.savefiledialog-save-btn').trigger('click');
        expect(onSaveFileDialogSave).toHaveBeenCalledWith(`${DESKTOP}/mine.txt`, dialog.el_window);
    });

    it('saves over a double-clicked file\'s name', async () => {
        const onSaveFileDialogSave = vi.fn();
        const dialog = await openDialog({ is_saveFileDialog: true, saveFileDialog_default_filename: 'draft.txt', onSaveFileDialogSave });
        rowNamed(dialog, 'photo.png').trigger('dblclick');
        expect(onSaveFileDialogSave).toHaveBeenCalledWith(`${DESKTOP}/photo.png`, dialog.el_window);
    });

    it('can\'t save without a name or into the Shared view', async () => {
        const dialog = await openDialog({ is_saveFileDialog: true, saveFileDialog_default_filename: '' });
        const $save = dialog.$('.savefiledialog-save-btn');
        expect($save.prop('disabled')).toBe(true);
        dialog.$('.savefiledialog-filename').val('a.txt').trigger('input');
        await settle();
        expect($save.prop('disabled')).toBe(false);

        dialog.$('.directories [data-folder="Shared"]').trigger('click');
        await settle();
        expect($save.prop('disabled')).toBe(true);
    });

    it('saves into a folder that was just opened, before its listing arrives', async () => {
        const onSaveFileDialogSave = vi.fn();
        const dialog = await openDialog({ is_saveFileDialog: true, saveFileDialog_default_filename: 'draft.txt', onSaveFileDialogSave });
        const readdir = window.puter.fs.readdir.getMockImplementation();
        let list;
        window.puter.fs.readdir.mockImplementation(args => new Promise((resolve) => {
            list = () => resolve(readdir(args));
        }));

        rowNamed(dialog, 'Kids').trigger('dblclick');
        dialog.$('.savefiledialog-save-btn').trigger('click');
        expect(onSaveFileDialogSave).toHaveBeenCalledWith(`${DESKTOP}/Kids/draft.txt`, dialog.el_window);

        list();
        await settle();
        dialog.$('.savefiledialog-save-btn').trigger('click');
        expect(onSaveFileDialogSave).toHaveBeenLastCalledWith(`${DESKTOP}/Kids/draft.txt`, dialog.el_window);
    });

    it('doesn\'t save over a double-clicked file where nothing can be saved', async () => {
        const onSaveFileDialogSave = vi.fn();
        const dialog = await openDialog({ is_saveFileDialog: true, saveFileDialog_default_filename: 'draft.txt', path: '/alice/Trash', onSaveFileDialogSave });
        expect(dialog.$('.savefiledialog-save-btn').prop('disabled')).toBe(true);

        rowNamed(dialog, 'old.txt').trigger('dblclick');

        expect(onSaveFileDialogSave).not.toHaveBeenCalled();
    });

    it('cancels through onDialogCancel', async () => {
        const onDialogCancel = vi.fn();
        const dialog = await openDialog({ is_saveFileDialog: true, onDialogCancel });
        dialog.$('.filedialog-cancel-btn').trigger('click');
        expect(onDialogCancel).toHaveBeenCalledTimes(1);
    });
});

describe('view preferences', () => {
    it('opens in the Files tab\'s view and sort', async () => {
        window.dashboard_object = { currentView: 'grid', sortColumn: 'size', sortDirection: 'desc' };
        const dialog = await openDialog({ is_openFileDialog: true });
        expect(dialog.$('.files').hasClass('files-grid-view')).toBe(true);
        expect(dialog.$('.sortable[data-sort="size"]').hasClass('sort-desc')).toBe(true);
    });
});
