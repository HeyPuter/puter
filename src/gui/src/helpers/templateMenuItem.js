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
 * Builds the "New > User templates" entry for a file in the templates folder.
 * The menu renders `html` as markup, so the extension and name are encoded.
 *
 * @param {string} templatesPath - the templates folder
 * @param {string} fileName - the template file's name
 * @returns {{ path: string, html: string, extension: string, name: string }}
 */
export const templateMenuItem = (templatesPath, fileName) => {
    const extIndex = fileName.lastIndexOf('.');
    const name = extIndex === -1 ? fileName : fileName.slice(0, extIndex);
    let extension = extIndex === -1 ? '' : fileName.slice(extIndex + 1);
    if ( extension === 'txt' ) extension = 'text';

    return {
        path: path.join(templatesPath, fileName),
        html: `${html_encode(extension.toUpperCase())} ${html_encode(name)}`,
        extension,
        name: fileName,
    };
};
