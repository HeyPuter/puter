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
 * @typedef {Object} PlaceholderReturn
 * @property {String} html: An html string that represents the placeholder
 * @property {String} id: The unique ID of the placeholder
 * @property {Function} replaceWith: A function that takes a DOM element
 *   as an argument and replaces the placeholder with it
 */

/**
 * Placeholder creates a simple element with a unique ID
 * as an HTML string.
 *
 * This can be useful where string concatenation is used
 * to build element trees.
 *
 * The `replaceWith` method can be used to replace the
 * placeholder with a real element.
 *
 * @returns {PlaceholderReturn}
 */
const Placeholder = def(() => {
    const id = Placeholder.get_next_id_();
    return {
        $: 'placeholder',
        html: `<div id="${id}"></div>`,
        id,
        replaceWith: (el) => {
            const place = document.getElementById(id);
            place.replaceWith(el);
        },
    };
}, 'util.Placeholder');

const anti_collision = 'a4d2cb6b85a1'; // Arbitrary random string
Placeholder.next_id_ = 0;
Placeholder.get_next_id_ = () => `${anti_collision}_${Placeholder.next_id_++}`;

export default Placeholder;
