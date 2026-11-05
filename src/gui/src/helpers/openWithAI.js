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

import launch_app from './launchApp.js';
import path from '../lib/path.js';

const AI_APP_NAME = 'ai';

/**
 * Opens a file or folder row (desktop item or dashboard row) in the AI app the
 * same way "Open With" opens it in any other app. A shortcut opens its target.
 *
 * @param {Element} el_item
 * @returns {Promise<unknown>} the launch_app result
 */
const openWithAI = (el_item) => {
    const $item = $(el_item);
    const file_path = $item.attr('data-shortcut_to_path') || $item.attr('data-path');
    const file_uid = $item.attr('data-shortcut_to') || $item.attr('data-uid');
    return launch_app({
        name: AI_APP_NAME,
        file_path,
        file_uid,
        window_title: path.basename(file_path),
    });
};

export default openWithAI;
