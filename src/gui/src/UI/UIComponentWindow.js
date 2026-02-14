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
import UIWindow from './UIWindow.js';
import Placeholder from '../util/Placeholder.js';
import JustHTML from './Components/JustHTML.js';

/**
 * @typedef {Object} UIComponentWindowOptions
 * @property {Component} [component] A component to render in the window
 * @property {string} [html] HTML string to render in the window (uses JustHTML component)
 */

/**
 * Render a UIWindow that contains an instance of Component or HTML string
 * @param {UIComponentWindowOptions} options
 */
export default async function UIComponentWindow (options) {
    const component = options.component ?? new JustHTML({ html: options.html ?? '' });
    const placeholder = Placeholder();

    const win = await UIWindow({
        ...options,

        body_content: placeholder.html,
    });

    component.attach(placeholder);
    component.focus();

    return win;
}
