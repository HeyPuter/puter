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
 * Resolves once no element matching `selector` is left on `doc`'s body, such
 * as a dialog's overlay after its exit transition.
 *
 * @param {Document} doc
 * @param {string} selector
 * @returns {Promise<void>}
 */
export const overlayGone = (doc, selector) => new Promise((resolve) => {
    const gone = () => !doc.querySelector(selector);
    if ( gone() ) return resolve();
    const observer = new doc.defaultView.MutationObserver(() => {
        if ( ! gone() ) return;
        observer.disconnect();
        resolve();
    });
    observer.observe(doc.body, { childList: true });
});
