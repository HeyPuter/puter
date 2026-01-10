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

// Keyboard Shortcuts Tab
export default {
    id: 'keyboard-shortcuts',
    title_i18n_key: 'keyboard_shortcuts',
    icon: 'keyboard.svg',
    html: () => {
        // Define keyboard shortcuts with their descriptions
        const shortcuts = [
            { category: 'General', items: [
                { keys: ['Ctrl/⌘', 'F'], description: 'Open Search' },
                { keys: ['Ctrl/⌘', 'Z'], description: 'Undo last action' },
                { keys: ['Esc'], description: 'Close menus/dialogs' },
                { keys: ['F1'], description: 'Open Keyboard Shortcuts' },
            ]},
            { category: 'Navigation', items: [
                { keys: ['↑', '↓', '←', '→'], description: 'Navigate items' },
                { keys: ['Enter'], description: 'Open selected item' },
                { keys: ['Tab'], description: 'Move focus to next element' },
            ]},
            { category: 'File Management', items: [
                { keys: ['Ctrl/⌘', 'C'], description: 'Copy selected items' },
                { keys: ['Ctrl/⌘', 'V'], description: 'Paste items' },
                { keys: ['Ctrl/⌘', 'X'], description: 'Cut selected items' },
                { keys: ['Delete'], description: 'Move to Trash' },
                { keys: ['Shift', 'Delete'], description: 'Permanently delete' },
            ]},
            { category: 'Windows', items: [
                { keys: ['Alt', 'F4'], description: 'Close window' },
            ]},
        ];

        // Build the HTML
        let html = `
            <div class="keyboard-shortcuts-container" style="padding: 20px;">
                <h2 style="margin-bottom: 20px; font-size: 18px; font-weight: 600;">Keyboard Shortcuts</h2>
                <p style="margin-bottom: 20px; color: #888; font-size: 14px;">
                    Use these keyboard shortcuts to navigate and perform actions quickly in Puter.
                    On Mac, use ⌘ (Command) instead of Ctrl.
                </p>
        `;

        shortcuts.forEach(category => {
            html += `
                <div class="shortcut-category" style="margin-bottom: 24px;">
                    <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #666;">${category.category}</h3>
                    <div class="shortcut-list">
            `;
            
            category.items.forEach(shortcut => {
                const keysHtml = shortcut.keys.map(key => 
                    `<kbd style="display: inline-block; padding: 4px 8px; font-family: monospace; font-size: 12px; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; margin-right: 4px; color: #333;">${key}</kbd>`
                ).join('<span style="margin-right: 4px; color: #888;">+</span>');
                
                html += `
                    <div class="shortcut-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
                        <span class="shortcut-description" style="font-size: 14px;">${shortcut.description}</span>
                        <span class="shortcut-keys">${keysHtml}</span>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });

        html += `
            </div>
        `;

        return html;
    }
};
