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

const shortcutSections = () => ([
    {
        title: i18n('keyboard_shortcuts_general'),
        rows: [
            {
                action: i18n('keyboard_shortcuts_open_help'),
                keys: 'F1 / Ctrl+?',
            },
            {
                action: i18n('keyboard_shortcuts_search'),
                keys: 'Ctrl/Cmd + F',
            },
            {
                action: i18n('keyboard_shortcuts_close_window'),
                keys: 'Ctrl + W',
            },
            {
                action: i18n('keyboard_shortcuts_undo'),
                keys: 'Ctrl/Cmd + Z',
            },
            {
                action: i18n('keyboard_shortcuts_select_all'),
                keys: 'Ctrl/Cmd + A',
            },
            {
                action: i18n('keyboard_shortcuts_open_item'),
                keys: 'Enter',
            },
            {
                action: i18n('keyboard_shortcuts_close_menus'),
                keys: 'Esc',
            },
        ],
    },
    {
        title: i18n('keyboard_shortcuts_navigation'),
        rows: [
            {
                action: i18n('keyboard_shortcuts_arrow_navigation'),
                keys: 'Arrow Keys',
            },
            {
                action: i18n('keyboard_shortcuts_type_to_select'),
                keys: i18n('keyboard_shortcuts_type_to_select_keys'),
            },
        ],
    },
    {
        title: i18n('keyboard_shortcuts_files'),
        rows: [
            {
                action: i18n('keyboard_shortcuts_copy'),
                keys: 'Ctrl/Cmd + C',
            },
            {
                action: i18n('keyboard_shortcuts_cut'),
                keys: 'Ctrl/Cmd + X',
            },
            {
                action: i18n('keyboard_shortcuts_paste'),
                keys: 'Ctrl/Cmd + V',
            },
            {
                action: i18n('keyboard_shortcuts_delete'),
                keys: 'Delete (Win/Linux) / Cmd + Backspace (Mac)',
            },
            {
                action: i18n('keyboard_shortcuts_permanent_delete'),
                keys: 'Shift + Delete (Win/Linux) / Option + Cmd + Backspace (Mac)',
            },
        ],
    },
]);

export default {
    id: 'keyboard-shortcuts',
    title_i18n_key: 'keyboard_shortcuts',
    icon: 'shortcut.svg',
    html: () => {
        const sections = shortcutSections();
        const sectionHtml = sections.map(section => {
            const rows = section.rows.map(row => `
                <tr>
                    <td class="settings-shortcuts-action">${row.action}</td>
                    <td class="settings-shortcuts-keys"><span>${row.keys}</span></td>
                </tr>
            `).join('');

            return `
                <div class="settings-shortcuts-section">
                    <h2>${section.title}</h2>
                    <table class="settings-shortcuts-table">
                        <thead>
                            <tr>
                                <th>${i18n('keyboard_shortcuts_action')}</th>
                                <th>${i18n('keyboard_shortcuts_shortcut')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');

        return `
            <h1>${i18n('keyboard_shortcuts')}</h1>
            <p class="settings-shortcuts-intro">${i18n('keyboard_shortcuts_intro')}</p>
            ${sectionHtml}
        `;
    },
};
