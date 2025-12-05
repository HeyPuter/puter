/**
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

import UIWindow from './UIWindow.js';

async function UIWindowKeyboardShortcuts (options) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? '⌘' : 'Ctrl';
    const altKey = isMac ? '⌥' : 'Alt';
    const deleteKey = isMac ? '⌫' : 'Delete';

    // Define all keyboard shortcuts organized by category
    const shortcutCategories = [
        {
            title_i18n: 'shortcuts_general',
            shortcuts: [
                { keys: [`${modKey}`, 'F'], description_i18n: 'shortcut_search' },
                { keys: [`${modKey}`, '?'], description_i18n: 'shortcut_show_shortcuts' },
                { keys: ['F1'], description_i18n: 'shortcut_show_shortcuts' },
                { keys: ['Esc'], description_i18n: 'shortcut_close_dialog' },
            ],
        },
        {
            title_i18n: 'shortcuts_file_management',
            shortcuts: [
                { keys: [`${modKey}`, 'A'], description_i18n: 'shortcut_select_all' },
                { keys: [`${modKey}`, 'C'], description_i18n: 'shortcut_copy' },
                { keys: [`${modKey}`, 'X'], description_i18n: 'shortcut_cut' },
                { keys: [`${modKey}`, 'V'], description_i18n: 'shortcut_paste' },
                { keys: [`${modKey}`, 'Z'], description_i18n: 'shortcut_undo' },
                { keys: [deleteKey], description_i18n: 'shortcut_move_to_trash' },
                { keys: isMac ? [`${altKey}`, `${modKey}`, `${deleteKey}`] : ['Shift', 'Delete'], description_i18n: 'shortcut_delete_permanently' },
            ],
        },
        {
            title_i18n: 'shortcuts_navigation',
            shortcuts: [
                { keys: ['↑', '↓', '←', '→'], description_i18n: 'shortcut_navigate_items' },
                { keys: ['Enter'], description_i18n: 'shortcut_open_selected' },
                { keys: ['Shift', '↑↓←→'], description_i18n: 'shortcut_extend_selection' },
            ],
        },
        {
            title_i18n: 'shortcuts_windows',
            shortcuts: [
                { keys: ['Ctrl', 'W'], description_i18n: 'shortcut_close_window' },
            ],
        },
    ];

    let h = '';
    h += '<div class="keyboard-shortcuts-window">';
    h += `<h2 class="keyboard-shortcuts-title">${i18n('keyboard_shortcuts')}</h2>`;
    h += `<p class="keyboard-shortcuts-subtitle">${i18n('keyboard_shortcuts_subtitle')}</p>`;

    shortcutCategories.forEach(category => {
        h += '<div class="keyboard-shortcuts-category">';
        h += `<h3 class="keyboard-shortcuts-category-title">${i18n(category.title_i18n)}</h3>`;
        h += '<div class="keyboard-shortcuts-list">';

        category.shortcuts.forEach(shortcut => {
            h += '<div class="keyboard-shortcut-item">';
            h += '<div class="keyboard-shortcut-keys">';
            shortcut.keys.forEach((key, index) => {
                h += `<kbd class="keyboard-shortcut-key">${html_encode(key)}</kbd>`;
                if ( index < shortcut.keys.length - 1 ) {
                    h += '<span class="keyboard-shortcut-plus">+</span>';
                }
            });
            h += '</div>';
            h += `<span class="keyboard-shortcut-description">${i18n(shortcut.description_i18n)}</span>`;
            h += '</div>';
        });

        h += '</div>';
        h += '</div>';
    });

    h += '<div class="keyboard-shortcuts-footer">';
    h += `<p class="keyboard-shortcuts-tip">${i18n('keyboard_shortcuts_tip')}</p>`;
    h += '</div>';
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('keyboard_shortcuts'),
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        window_class: 'window-keyboard-shortcuts',
        width: 550,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        draggable_body: false,
        single_instance: true,
        app: 'keyboard-shortcuts',
        onAppend: function (this_window) {
        },
        window_css: {
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            height: 'initial',
            'background-color': 'rgb(245, 247, 249)',
            'backdrop-filter': 'blur(3px)',
            padding: '0',
            overflow: 'auto',
            'max-height': 'calc(100vh - 150px)',
        },
    });

    return el_window;
}

export default UIWindowKeyboardShortcuts;

