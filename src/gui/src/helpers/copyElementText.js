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
 * Copies the text an element shows. Without clipboard access (an insecure
 * origin has no `navigator.clipboard` at all), the element is selected for
 * the legacy copy and stays selected to copy by hand.
 *
 * @param {HTMLElement} el
 * @param {string} [text] What to copy when it isn't the element's own text.
 * @returns {Promise<boolean>} Whether the clipboard has it now.
 */
export default async function copyElementText (el, text = el.textContent) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        try {
            return document.execCommand('copy');
        } catch {
            return false;
        }
    }
}
