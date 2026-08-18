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

// Access levels the sharing dialogs offer, shared so the two can't drift.

// The API also accepts `see` and `list`, a developer-level distinction with no
// place in these dialogs; a row already set to one is shown as-is.
export const MODES = ['read', 'write', 'manage'];

/**
 * Human-readable label for an access mode, ready to drop into HTML.
 *
 * Already HTML-safe — encoding it again renders the `&` in "Can edit & share".
 *
 * @param {string} mode
 * @returns {string} HTML-safe label
 */
export const mode_label = (mode) => {
    if ( mode === 'write' ) return i18n('share_access_write');
    if ( mode === 'manage' ) return i18n('share_access_manage');
    if ( mode === 'read' ) return i18n('share_access_read');
    return html_encode(mode);
};

/**
 * `<option>` markup for a mode `<select>`, with `current` selected.
 *
 * A mode outside `MODES` is listed first rather than dropped, so opening a
 * dialog on a `see`/`list` grant doesn't silently rewrite it.
 *
 * @param {string} current
 * @returns {string} HTML-safe markup
 */
export const options_for = (current) => {
    const modes = MODES.includes(current) ? MODES : [current, ...MODES];
    return modes
        .map(
            (mode) =>
                `<option value="${html_encode(mode)}"${mode === current ? ' selected' : ''}>${mode_label(mode)}</option>`,
        )
        .join('');
};
