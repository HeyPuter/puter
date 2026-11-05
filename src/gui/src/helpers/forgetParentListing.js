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

import path from '../lib/path.js';

/**
 * Drops puter.js's cached listing of the folder that holds `item_path`, so
 * the next listing of it is read fresh. For changes to an item the server
 * sends no fs event about (a website added to or removed from a folder),
 * which the cached listing would go on showing the old way.
 *
 * @param {string} item_path
 * @returns {void}
 */
export default function forget_parent_listing (item_path) {
    if ( typeof puter.fsCacheKey !== 'function' || ! puter._cache ) return;
    puter._cache.del(puter.fsCacheKey('readdir', path.dirname(item_path)));
}
