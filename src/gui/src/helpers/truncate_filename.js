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

import path from '../lib/path.js';

export const DEFAULT_TRUNCATE_LENGTH = 20;

/**
 * A function that truncates a file name if it exceeds a certain length, while preserving the file extension.
 * An ellipsis character '…' is added to indicate the truncation. If the original filename is short enough,
 * it is returned unchanged.
 *
 * @param {string} input - The original filename to be potentially truncated.
 * @param {number} max_length - The maximum length for the filename. If the original filename (excluding the extension) exceeds this length, it will be truncated.
 *
 * @returns {string} The truncated filename with preserved extension if original filename is too long; otherwise, the original filename.
 *
 * @example
 *
 * let truncatedFilename = truncate_filename('really_long_filename.txt', 10);
 * // truncatedFilename would be something like 'really_lo…me.txt'
 *
 */
const truncate_filename = (input, max_length = DEFAULT_TRUNCATE_LENGTH) => {
    const extname = path.extname(`/${ input}`);

    if ( (input.length - 15) > max_length ) {
        if ( extname !== '' )
        {
            return `${input.substring(0, max_length) }…${ input.slice(-1 * (extname.length + 2))}`;
        }
        else
        {
            return `${input.substring(0, max_length) }…`;
        }
    }
    return input;
};

export default truncate_filename;
