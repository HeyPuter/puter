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

/**
 * The open, save and directory pickers UIWindow shows for
 * `is_openFileDialog`, `is_saveFileDialog` and `is_directoryPicker`: the
 * listing (FilePicker), the bar of buttons under it, and the answer sent to
 * whoever asked, an app window or the page that opened the popup.
 */

import path from '../../lib/path.js';
import UIAlert from '../UIAlert.js';
import FilePicker from './FilePicker.js';
import { folderAcceptsNewItems } from '../Dashboard/fileListing.js';

/** @typedef {import('./FilePicker.js').FilePickerMode} FilePickerMode */

/**
 * The UIWindow options a picker reads.
 *
 * @typedef {Object} FilePickerDialogOptions
 * @property {boolean} [is_openFileDialog]
 * @property {boolean} [is_saveFileDialog]
 * @property {boolean} [is_directoryPicker]
 * @property {string} path - The folder it opens in
 * @property {boolean} selectable_body - Whether more than one item can be picked
 * @property {string | string[]} [allowed_file_types] - Extensions and MIME types an open picker accepts
 * @property {string} [saveFileDialog_default_filename]
 * @property {string} [initiating_app_uuid] - The app the picked items are signed for
 * @property {boolean} [return_to_parent_window] - Answer the page that opened this popup
 * @property {string | null} [parent_uuid] - Answer this app window
 * @property {() => void} [onDialogCancel] - Cancel was pressed, or the picker closed without an answer and has no on_close
 * @property {() => void} [on_close]
 * @property {(target_path: string, el_window: HTMLElement) => void} [onSaveFileDialogSave]
 */

/**
 * @param {Object} options - UIWindow options
 * @returns {boolean}
 */
export function isFilePickerDialog (options) {
    return !! (options.is_openFileDialog || options.is_saveFileDialog || options.is_directoryPicker);
}

/**
 * @param {FilePickerDialogOptions} options
 * @returns {FilePickerMode}
 */
export function filePickerMode (options) {
    if ( options.is_saveFileDialog ) return 'save';
    if ( options.is_directoryPicker ) return 'directory';
    return 'open';
}

/**
 * Allowed types as the comma-separated string the type check reads.
 *
 * @param {string | string[] | undefined} allowed
 * @returns {string}
 */
export function allowedTypesString (allowed) {
    if ( Array.isArray(allowed) ) return allowed.join(',');
    return allowed ? String(allowed) : '';
}

/**
 * The bar under the listing: the file name and Save, or Upload and Open,
 * or Select, each with Cancel.
 *
 * @param {FilePickerDialogOptions} options
 * @returns {string} HTML
 */
export function filePickerPromptHtml (options) {
    const cancel = `<button type="button" class="dashboard-dialog-btn filedialog-cancel-btn">${i18n('cancel')}</button>`;
    const primary = (cls, label, disabled) => `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-primary ${cls}${disabled ? ' disabled' : ''}"${disabled ? ' disabled' : ''}>${label}</button>`;
    const mode = filePickerMode(options);

    if ( mode === 'save' ) {
        const name = options.saveFileDialog_default_filename ?? '';
        return `<div class="window-filedialog-prompt">
            <div class="window-filedialog-prompt-row">
                <input type="text" class="savefiledialog-filename" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="${i18n('name')}" value="${window.html_encode(name)}">
                ${cancel}
                ${primary('savefiledialog-save-btn', i18n('save'), name === '')}
            </div>
        </div>`;
    }

    if ( mode === 'directory' ) {
        return `<div class="window-filedialog-prompt">
            <div class="window-filedialog-prompt-row window-filedialog-prompt-buttons">
                ${cancel}
                ${primary('directorypicker-select-btn', i18n('select'), false)}
            </div>
        </div>`;
    }

    return `<div class="window-filedialog-prompt">
        <div class="window-filedialog-upload-here" role="button" tabindex="0"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
  <path fill-rule="evenodd" d="M7.646 5.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 6.707V10.5a.5.5 0 0 1-1 0V6.707L6.354 7.854a.5.5 0 1 1-.708-.708z"/>
  <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383m.653.757c-.757.653-1.153 1.44-1.153 2.056v.448l-.445.049C2.064 6.805 1 7.952 1 9.318 1 10.785 2.23 12 3.781 12h8.906C13.98 12 15 10.988 15 9.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 4.825 10.328 3 8 3a4.53 4.53 0 0 0-2.941 1.1z"/>
</svg> ${i18n('upload')}</div>
        <div class="window-filedialog-prompt-row window-filedialog-prompt-buttons">
            ${cancel}
            ${primary('openfiledialog-open-btn', i18n('open'), true)}
        </div>
    </div>`;
}

/**
 * Puts the keyboard in a save picker's name field, with the name selected
 * up to its extension so typing replaces it.
 *
 * @param {HTMLElement} el_window
 * @returns {void}
 */
export function focusFileName (el_window) {
    const input = $(el_window).find('.savefiledialog-filename').get(0);
    if ( ! input ) return;
    const name = input.value;
    const extname = path.extname(`/${name}`);
    input.focus({ preventScroll: true });
    if ( extname !== '' ) input.setSelectionRange(0, name.length - extname.length);
    else input.select();
}

/**
 * @param {JQuery} $button
 * @param {boolean} enabled
 * @returns {void}
 */
const setEnabled = ($button, enabled) => {
    $button.prop('disabled', ! enabled).toggleClass('disabled', ! enabled);
};

/**
 * Draws the listing into a picker window and wires its buttons.
 *
 * @param {HTMLElement} el_window
 * @param {FilePickerDialogOptions} options
 * @returns {FilePicker}
 */
export function initFilePickerDialog (el_window, options) {
    const mode = filePickerMode(options);
    const $win = $(el_window);
    const $mask = () => $win.find('.window-disable-mask, .busy-indicator');
    const $filename = $win.find('.savefiledialog-filename');
    const $save = $win.find('.savefiledialog-save-btn');
    const $open = $win.find('.openfiledialog-open-btn');
    const $select = $win.find('.directorypicker-select-btn');
    const $upload = $win.find('.window-filedialog-upload-here');
    let lastSelection = '';
    let answering = false;
    let answered = false;
    let cancelled = false;

    // A save goes to the folder the user asked for, even before its listing arrives.
    const saveFolder = () => picker.pendingPath ?? picker.currentPath;
    const updateSaveButton = () => {
        setEnabled($save, $filename.val() !== '' && folderAcceptsNewItems(saveFolder()));
    };

    const picker = new FilePicker({
        el_window,
        el_body: $win.children('.window-body').get(0),
        mode,
        path: options.path,
        multiple: options.selectable_body,
        allowedFileTypes: allowedTypesString(options.allowed_file_types),
        onChange: () => {
            if ( picker.currentPath ) $win.attr('data-path', picker.currentPath);
            const entries = picker.selectedEntries();
            const key = entries.map(entry => entry.uid).join('\n');
            const selectionChanged = key !== lastSelection;
            lastSelection = key;

            if ( mode === 'open' ) {
                setEnabled($open, ! picker.loading && entries.some(entry => ! entry.is_dir));
                $upload.attr('aria-disabled', picker.acceptsNewItemsHere() ? 'false' : 'true');
            } else if ( mode === 'directory' ) {
                const folderHere = !! picker.currentPath && picker.currentPath !== picker.failedPath
                    && picker.currentPath !== window.shared_path && picker.currentPath !== '/';
                setEnabled($select, ! picker.loading && (entries.some(entry => entry.is_dir) || folderHere));
            } else {
                // A picked file names the save; a re-listing that keeps it
                // selected leaves whatever has been typed since.
                const files = entries.filter(entry => ! entry.is_dir);
                if ( selectionChanged && files.length === 1 ) $filename.val(files[0].name);
                updateSaveButton();
            }
        },
        onActivate: (entries) => {
            if ( mode === 'open' ) {
                answerWithPicked(entries, 'fileOpenPicked');
            } else if ( mode === 'save' && entries.length ) {
                $filename.val(entries[0].name);
                updateSaveButton();
                $save.trigger('click');
            }
        },
    });

    /**
     * Signs the picked items for the app that asked and sends them to it.
     *
     * @param {Array<{ uid?: string, path: string }>} entries
     * @param {'fileOpenPicked' | 'directoryPicked'} msg
     * @returns {Promise<void>}
     */
    const answerWithPicked = async (entries, msg) => {
        if ( answering || ! entries.length ) return;
        answering = true;
        $mask().show();
        let items;
        try {
            const signed = await window.puter.fs.sign(options.initiating_app_uuid, entries.map(entry => ({
                ...(entry.uid ? { uid: entry.uid } : {}),
                action: 'write',
                path: entry.path,
            })));
            items = (Array.isArray(signed.items) ? signed.items : [signed.items]).map(item => (typeof item.path === 'string'
                ? { ...item, path: window.privacy_aware_path(item.path) }
                : item));
        } catch ( err ) {
            console.error(err);
            answering = false;
            $mask().hide();
            await UIAlert({
                message: err?.message || i18n('error_unknown_cause', [], false),
                parent_uuid: $win.attr('data-element_uuid'),
            });
            return;
        }

        const message = { msg, original_msg_id: $win.attr('data-iframe_msg_uid'), items: [...items] };
        // Legacy: older callers (Polotno) read a single item off the message itself.
        const withLegacyItem = { ...message, ...(items.length === 1 ? items[0] : {}) };

        answered = true;
        if ( options.return_to_parent_window ) {
            // Before the answer: a popup's token rides out with it.
            window.deliverPopupTokenToOpener?.();
            window.opener.postMessage(withLegacyItem, window.openerOrigin);
            window.close();
            window.open('', '_self').close();
            return;
        }
        if ( options.parent_uuid ) {
            const $parent = $(`.window[data-element_uuid="${options.parent_uuid}"]`);
            const target_iframe = $parent.find('.window-app-iframe').get(0);
            target_iframe?.contentWindow?.postMessage(msg === 'fileOpenPicked' ? withLegacyItem : message, '*');
            target_iframe?.focus({ preventScroll: true });
            if ( msg === 'fileOpenPicked' ) {
                $parent.get(0)?.dispatchEvent(new CustomEvent('file_opened', { detail: [...items] }));
            }
            $win.close();
            return;
        }
        answered = false;
        answering = false;
        $mask().hide();
    };

    $open.on('click', () => {
        answerWithPicked(picker.selectedEntries().filter(entry => ! entry.is_dir), 'fileOpenPicked');
    });

    $select.on('click', () => {
        const folders = picker.selectedEntries().filter(entry => entry.is_dir);
        answerWithPicked(folders.length ? folders : [{ path: picker.currentPath }], 'directoryPicked');
    });

    $save.on('click', () => {
        // A double-click or Enter on a file gets here with Save disabled.
        if ( $save.prop('disabled') ) return;
        const filename = $filename.val();
        try {
            window.validate_fsentry_name(filename);
        } catch ( err ) {
            UIAlert(err.message, 'error', 'OK');
            return;
        }
        options.onSaveFileDialogSave?.(path.join(saveFolder(), filename), el_window);
    });
    $filename.on('keydown', (e) => {
        if ( e.key !== 'Enter' || e.originalEvent?.isComposing ) return;
        e.preventDefault();
        if ( ! $save.prop('disabled') ) $save.trigger('click');
    });
    $filename.on('input change paste', () => setTimeout(updateSaveButton, 0));

    $upload.on('click', () => picker.pickFilesToUpload());
    $upload.on('keydown', (e) => {
        if ( e.key !== 'Enter' && e.key !== ' ' ) return;
        e.preventDefault();
        e.stopPropagation();
        picker.pickFilesToUpload();
    });

    $win.find('.filedialog-cancel-btn').on('click', () => {
        cancelled = true;
        if ( options.return_to_parent_window ) {
            window.close();
            window.open('', '_self').close();
        }
        $win.hide(0, () => {
            const $parent = $(`.window[data-element_uuid="${options.parent_uuid}"]`);
            $parent.removeClass('window-disabled');
            $parent.find('.window-disable-mask').hide();
            $win.close();
        });
        options.onDialogCancel?.call(el_window);
    });

    // Escape and the close button close the window without Cancel. A caller
    // with no on_close of its own still hears the picker was cancelled.
    $win.on('remove', () => {
        if ( mode === 'save' || answered || cancelled || options.on_close ) return;
        options.onDialogCancel?.call(el_window);
    });

    picker.mount();
    if ( mode === 'save' ) {
        updateSaveButton();
        focusFileName(el_window);
    }
    return picker;
}
